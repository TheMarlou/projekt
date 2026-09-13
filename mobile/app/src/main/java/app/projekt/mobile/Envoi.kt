package app.projekt.mobile

import android.content.Context
import android.os.Build
import android.provider.Settings
import androidx.work.BackoffPolicy
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Tout ce qui parle au PC. À appeler hors du fil principal : ces fonctions attendent le réseau. */
object Envoi {
    private val verrou = Any()

    data class Bilan(val joint: Boolean, val envoyes: Int, val restants: Int)

    /** « Galaxy S24 » sur un Samsung ; sinon marque et modèle. */
    fun nomAppareil(context: Context): String =
        runCatching { Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME) }.getOrNull()
            ?.takeIf { it.isNotBlank() }
            ?: "${Build.MANUFACTURER} ${Build.MODEL}".trim().replaceFirstChar { it.uppercase() }

    /** Dernière adresse qui a marché, puis celles du QR code, puis on crie sur le réseau. */
    private fun trouver(reglages: Reglages, pcId: String, adresses: List<String>, port: Int): Pair<String, Int>? {
        for (hote in (listOfNotNull(reglages.derniereAdresse) + adresses).distinct()) {
            if (ClientPc.repond(hote, port, pcId)) {
                reglages.derniereAdresse = hote
                return hote to port
            }
        }
        return ClientPc.decouvrir(pcId, port)?.also { reglages.derniereAdresse = it.first }
    }

    private fun lireProjets(reponse: JSONObject): List<ProjetPc> {
        val liste = reponse.optJSONArray("projets") ?: return emptyList()
        return List(liste.length()) { liste.getJSONObject(it).let { o -> ProjetPc(o.getString("id"), o.getString("nom")) } }
    }

    fun appairer(context: Context, infos: InfosAppairage): Result<Unit> = runCatching {
        val reglages = Reglages(context)
        reglages.derniereAdresse = null
        val (hote, port) = trouver(reglages, infos.pcId, infos.adresses, infos.port)
            ?: throw ErreurPc(
                // Les adresses essayées : de quoi comprendre sur quel réseau le PC était attendu.
                context.getString(R.string.pc_introuvable) +
                    " (" + infos.adresses.joinToString(", ") { "$it:${infos.port}" } + ")",
            )
        val reponse = ClientPc(infos.cle, reglages.appareil)
            .appeler(hote, port, "appairer", JSONObject().put("nom", nomAppareil(context)))
        reglages.pc = PcAppaire(infos.pcId, reponse.optString("pc", infos.nomPc), infos.cle, infos.adresses, port)
        reglages.derniereAdresse = hote
        reglages.projets = lireProjets(reponse)
        reglages.erreurPc = null
    }

    /** Vrai si le PC a répondu. */
    fun rafraichirProjets(context: Context): Boolean {
        val reglages = Reglages(context)
        val pc = reglages.pc ?: return false
        return try {
            val (hote, port) = trouver(reglages, pc.pcId, pc.adresses, pc.port) ?: return false
            val reponse = ClientPc(pc.cle, reglages.appareil).appeler(hote, port, "projets", JSONObject())
            reglages.projets = lireProjets(reponse)
            reglages.erreurPc = null
            if (port != pc.port) reglages.pc = pc.copy(port = port)
            MiseAJour.verifier(context, hote, port)
            true
        } catch (e: ErreurPc) {
            if (e.code == 401) reglages.erreurPc = context.getString(R.string.pc_oublie)
            false
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Prévient le PC que ce téléphone l'oublie : il le retire aussitôt de sa liste
     * (sinon il l'y affichait encore « connecté »). Au mieux : hors réseau, on oublie quand même.
     */
    fun oublierPc(context: Context) {
        val reglages = Reglages(context)
        val pc = reglages.pc ?: return
        runCatching {
            val hote = reglages.derniereAdresse ?: pc.adresses.firstOrNull() ?: return
            ClientPc(pc.cle, reglages.appareil).appeler(hote, pc.port, "oublier", JSONObject())
        }
    }

    /** Envoie la file d'attente, du plus ancien au plus récent. S'arrête au premier souci de réseau. */
    fun envoyerTout(context: Context): Bilan = synchronized(verrou) {
        val reglages = Reglages(context)
        val attente = FileAttente.enAttente(context).sortedBy { it.creeLe }
        val pc = reglages.pc ?: return Bilan(false, 0, attente.size)
        if (attente.isEmpty()) return Bilan(true, 0, 0)
        val (hote, port) = trouver(reglages, pc.pcId, pc.adresses, pc.port) ?: return Bilan(false, 0, attente.size)

        val client = ClientPc(pc.cle, reglages.appareil)
        var envoyes = 0
        for (element in attente) {
            try {
                client.appeler(hote, port, "envoi", JSONObject().put("element", element.pourPc()))
                FileAttente.marquerEnvoye(context, element)
                envoyes++
            } catch (e: ErreurPc) {
                if (e.code == 401) reglages.erreurPc = context.getString(R.string.pc_oublie)
                if (!e.definitive) break
                FileAttente.maj(context, element.copy(etat = Element.REFUSE, erreur = e.message))
            } catch (e: OutOfMemoryError) {
                FileAttente.maj(context, element.copy(etat = Element.REFUSE, erreur = context.getString(R.string.trop_lourd)))
            } catch (e: Exception) {
                // Réseau coupé en plein envoi : on réessaiera plus tard.
                break
            }
        }
        FileAttente.elaguer(context)
        Bilan(true, envoyes, FileAttente.enAttente(context).size)
    }
}

/** Envoi en arrière-plan : réessaie tout seul jusqu'à ce que le PC soit joignable. */
class EnvoiWorker(context: Context, parametres: WorkerParameters) : Worker(context, parametres) {
    override fun doWork(): Result {
        val bilan = Envoi.envoyerTout(applicationContext)
        if (bilan.restants == 0) {
            WorkManager.getInstance(applicationContext).cancelUniqueWork(PERIODIQUE)
            return Result.success()
        }
        return Result.retry()
    }

    companion object {
        private const val UNIQUE = "envoi"
        private const val PERIODIQUE = "envoi-periodique"

        fun planifier(context: Context) {
            val gestionnaire = WorkManager.getInstance(context)
            gestionnaire.enqueueUniqueWork(
                UNIQUE,
                ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<EnvoiWorker>()
                    .setInitialDelay(20, TimeUnit.SECONDS)
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                    .build(),
            )
            // Filet de sécurité : l'attente exponentielle peut monter à plusieurs heures.
            gestionnaire.enqueueUniquePeriodicWork(
                PERIODIQUE,
                ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<EnvoiWorker>(15, TimeUnit.MINUTES).build(),
            )
        }
    }
}
