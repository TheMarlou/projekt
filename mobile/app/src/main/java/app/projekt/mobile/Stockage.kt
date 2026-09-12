package app.projekt.mobile

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Base64
import java.util.UUID

/** Un élément du fichier : attendu ≤ 25 Mo, au-delà l'envoi en JSON chiffré serait trop lourd pour le téléphone. */
const val TAILLE_MAX_FICHIER = 25L * 1024 * 1024

data class PcAppaire(
    val pcId: String,
    val nomPc: String,
    val cle: ByteArray,
    val adresses: List<String>,
    val port: Int,
)

data class ProjetPc(val id: String, val nom: String)

/** Réglages de l'app. La clé du PC reste dans l'espace privé de l'app (sauvegarde Android désactivée). */
class Reglages(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("projekt", Context.MODE_PRIVATE)

    /** Identifiant de CE téléphone, tiré une fois pour toutes. */
    val appareil: String
        get() = prefs.getString("appareil", null) ?: UUID.randomUUID().toString().also {
            prefs.edit().putString("appareil", it).apply()
        }

    var pc: PcAppaire?
        get() = prefs.getString("pc", null)?.let { texte ->
            runCatching {
                val o = JSONObject(texte)
                PcAppaire(
                    pcId = o.getString("pcId"),
                    nomPc = o.getString("nomPc"),
                    cle = Base64.getDecoder().decode(o.getString("cle")),
                    adresses = o.optJSONArray("adresses")?.let { a -> List(a.length()) { a.getString(it) } }.orEmpty(),
                    port = o.getInt("port"),
                )
            }.getOrNull()
        }
        set(valeur) {
            val editeur = prefs.edit()
            if (valeur == null) {
                editeur.remove("pc").remove("derniereAdresse").remove("erreurPc")
            } else {
                editeur.putString(
                    "pc",
                    JSONObject()
                        .put("pcId", valeur.pcId)
                        .put("nomPc", valeur.nomPc)
                        .put("cle", Base64.getEncoder().encodeToString(valeur.cle))
                        .put("adresses", JSONArray(valeur.adresses))
                        .put("port", valeur.port)
                        .toString(),
                )
            }
            editeur.apply()
        }

    var derniereAdresse: String?
        get() = prefs.getString("derniereAdresse", null)
        set(v) = prefs.edit().putString("derniereAdresse", v).apply()

    /** Dernière erreur définitive du PC (téléphone oublié…), affichée dans l'app. */
    var erreurPc: String?
        get() = prefs.getString("erreurPc", null)
        set(v) = prefs.edit().putString("erreurPc", v).apply()

    var projets: List<ProjetPc>
        get() = runCatching {
            val a = JSONArray(prefs.getString("projets", "[]"))
            List(a.length()) { a.getJSONObject(it).let { o -> ProjetPc(o.getString("id"), o.getString("nom")) } }
        }.getOrDefault(emptyList())
        set(liste) = prefs.edit().putString(
            "projets",
            JSONArray(liste.map { JSONObject().put("id", it.id).put("nom", it.nom) }).toString(),
        ).apply()

    /** Version plus récente proposée par le PC, ou `null`. */
    var majDisponible: String?
        get() = prefs.getString("majDisponible", null)
        set(v) = prefs.edit().putString("majDisponible", v).apply()

    var dernierProjet: String?
        get() = prefs.getString("dernierProjet", null)
        set(v) = prefs.edit().putString("dernierProjet", v).apply()

    var fond: String
        get() = prefs.getString("fond", "dark") ?: "dark"
        set(v) = prefs.edit().putString("fond", v).apply()

    var accent: String
        get() = prefs.getString("accent", "mono") ?: "mono"
        set(v) = prefs.edit().putString("accent", v).apply()
}

/** Un partage, en attente ou déjà envoyé (historique). */
data class Element(
    val id: String,
    /** texte · lien · image · audio */
    val genre: String,
    val projet: String?,
    val nomProjet: String?,
    val texte: String?,
    val url: String?,
    val nom: String?,
    val ext: String?,
    /** Copie locale du fichier, effacée une fois l'envoi confirmé. */
    val fichier: String?,
    val creeLe: Long,
    val etat: String = ATTENTE,
    val erreur: String? = null,
    val envoyeLe: Long? = null,
) {
    fun enJson(): JSONObject = JSONObject()
        .put("id", id).put("genre", genre).putOpt("projet", projet).putOpt("nomProjet", nomProjet)
        .putOpt("texte", texte).putOpt("url", url).putOpt("nom", nom).putOpt("ext", ext)
        .putOpt("fichier", fichier).put("creeLe", creeLe).put("etat", etat)
        .putOpt("erreur", erreur).putOpt("envoyeLe", envoyeLe)

    /** Ce que reçoit le PC (voir `ElementEntrant` dans telephone.rs). */
    fun pourPc(): JSONObject {
        val o = JSONObject()
            .put("id", id).put("genre", genre).putOpt("projet", projet).putOpt("texte", texte)
            .putOpt("url", url).putOpt("nom", nom).putOpt("ext", ext).put("creeLe", creeLe)
        fichier?.let { o.put("donnees", Base64.getEncoder().encodeToString(File(it).readBytes())) }
        return o
    }

    companion object {
        const val ATTENTE = "attente"
        const val ENVOYE = "envoye"
        const val REFUSE = "refuse"

        private val PREMIERE_URL = Regex("https?://[^\\s]+")

        fun deJson(o: JSONObject) = Element(
            id = o.getString("id"),
            genre = o.getString("genre"),
            projet = o.optString("projet").ifEmpty { null },
            nomProjet = o.optString("nomProjet").ifEmpty { null },
            texte = o.optString("texte").ifEmpty { null },
            url = o.optString("url").ifEmpty { null },
            nom = o.optString("nom").ifEmpty { null },
            ext = o.optString("ext").ifEmpty { null },
            fichier = o.optString("fichier").ifEmpty { null },
            creeLe = o.getLong("creeLe"),
            etat = o.optString("etat", ATTENTE),
            erreur = o.optString("erreur").ifEmpty { null },
            envoyeLe = if (o.has("envoyeLe")) o.getLong("envoyeLe") else null,
        )

        /** Texte partagé ou note rapide : s'il contient une adresse web, c'est un lien. */
        fun depuisTexte(texte: String, sujet: String?, projet: ProjetPc?): Element {
            val url = PREMIERE_URL.find(texte)?.value?.trimEnd('.', ',', ')', ';')
            // YouTube & co. mettent le titre dans le sujet et seulement l'adresse dans le texte.
            val complet = if (!sujet.isNullOrBlank() && url != null && texte.trim() == url) "$sujet\n$texte" else texte
            return Element(
                id = UUID.randomUUID().toString(),
                genre = if (url != null) "lien" else "texte",
                projet = projet?.id,
                nomProjet = projet?.nom,
                texte = complet,
                url = url,
                nom = null,
                ext = null,
                fichier = null,
                creeLe = System.currentTimeMillis(),
            )
        }
    }
}

class FichierTropGros : Exception()

data class Copie(val chemin: String, val ext: String)

/** File d'attente ET historique : un fichier JSON par élément, écrit de façon atomique. */
object FileAttente {
    private const val HISTORIQUE_MAX = 100
    private val IMAGES_LISIBLES_PAR_LE_PC = mapOf("image/jpeg" to "jpg", "image/png" to "png", "image/webp" to "webp", "image/gif" to "gif")
    private val SONS = mapOf(
        "audio/mpeg" to "mp3", "audio/mp3" to "mp3", "audio/mp4" to "m4a", "audio/x-m4a" to "m4a", "audio/aac" to "aac",
        "audio/ogg" to "ogg", "audio/opus" to "opus", "audio/wav" to "wav", "audio/x-wav" to "wav", "audio/flac" to "flac",
    )

    private fun dossier(ctx: Context) = File(ctx.filesDir, "elements").apply { mkdirs() }

    @Synchronized
    fun ajouter(ctx: Context, element: Element) = ecrire(ctx, element)

    @Synchronized
    fun maj(ctx: Context, element: Element) = ecrire(ctx, element)

    private fun ecrire(ctx: Context, element: Element) {
        val provisoire = File(dossier(ctx), "${element.id}.tmp")
        provisoire.writeText(element.enJson().toString())
        provisoire.renameTo(File(dossier(ctx), "${element.id}.json"))
    }

    @Synchronized
    fun tous(ctx: Context): List<Element> =
        dossier(ctx).listFiles { f -> f.name.endsWith(".json") }.orEmpty()
            .mapNotNull { runCatching { Element.deJson(JSONObject(it.readText())) }.getOrNull() }
            .sortedByDescending { it.creeLe }

    fun enAttente(ctx: Context) = tous(ctx).filter { it.etat == Element.ATTENTE }

    @Synchronized
    fun supprimer(ctx: Context, id: String) {
        tous(ctx).find { it.id == id }?.fichier?.let { File(it).delete() }
        File(dossier(ctx), "$id.json").delete()
    }

    /** Envoyé : la copie du fichier ne sert plus, seule la ligne d'historique reste. */
    @Synchronized
    fun marquerEnvoye(ctx: Context, element: Element) {
        element.fichier?.let { File(it).delete() }
        ecrire(ctx, element.copy(fichier = null, etat = Element.ENVOYE, erreur = null, envoyeLe = System.currentTimeMillis()))
    }

    fun elaguer(ctx: Context) {
        tous(ctx).filter { it.etat != Element.ATTENTE }.drop(HISTORIQUE_MAX).forEach { supprimer(ctx, it.id) }
    }

    /**
     * Copie le fichier partagé DANS l'app : l'autorisation de lire celui de la
     * galerie disparaît dès que le panneau de partage se ferme.
     */
    fun copierFichier(ctx: Context, uri: Uri, id: String, genre: String, mime: String?, nom: String?): Copie {
        val resolver = ctx.contentResolver
        val type = mime ?: resolver.getType(uri) ?: ""
        val extDuNom = nom?.substringAfterLast('.', "")?.lowercase()?.takeIf { it.length in 1..8 && it.all(Char::isLetterOrDigit) }

        if (genre == "image" && type !in IMAGES_LISIBLES_PAR_LE_PC && extDuNom !in listOf("jpg", "jpeg", "png", "webp", "gif")) {
            // HEIC des Samsung et autres formats que la vue du PC n'affiche pas : converti en JPEG.
            val image = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) }
                ?: throw IllegalStateException("image illisible")
            val fichier = File(dossier(ctx), "$id.jpg")
            fichier.outputStream().use { image.compress(Bitmap.CompressFormat.JPEG, 90, it) }
            image.recycle()
            if (fichier.length() > TAILLE_MAX_FICHIER) {
                fichier.delete()
                throw FichierTropGros()
            }
            return Copie(fichier.absolutePath, "jpg")
        }

        val ext = (if (genre == "image") IMAGES_LISIBLES_PAR_LE_PC[type] else SONS[type])
            ?: extDuNom?.let { if (it == "jpeg") "jpg" else it }
            ?: if (genre == "audio") "mp3" else "jpg"
        val fichier = File(dossier(ctx), "$id.$ext")
        val entree = resolver.openInputStream(uri) ?: throw IllegalStateException("fichier illisible")
        entree.use {
            fichier.outputStream().use { sortie ->
                val tampon = ByteArray(64 * 1024)
                var total = 0L
                while (true) {
                    val lus = entree.read(tampon)
                    if (lus < 0) break
                    total += lus
                    if (total > TAILLE_MAX_FICHIER) {
                        sortie.close()
                        fichier.delete()
                        throw FichierTropGros()
                    }
                    sortie.write(tampon, 0, lus)
                }
            }
        }
        return Copie(fichier.absolutePath, ext)
    }
}
