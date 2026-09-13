package app.projekt.mobile

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.EditText
import android.widget.GridLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import java.text.DateFormat
import java.util.Date
import kotlin.concurrent.thread

/** Écran de l'app : connexion au PC, note rapide, file d'attente et historique. */
class MainActivity : AppCompatActivity() {

    private enum class EtatPc { INCONNU, RECHERCHE, CONNECTE, INJOIGNABLE }

    private lateinit var reglages: Reglages
    private lateinit var ui: Ui
    private val c get() = ui.c

    private lateinit var cartePc: LinearLayout
    private lateinit var puces: LinearLayout
    private lateinit var carteFile: LinearLayout
    private lateinit var champNote: EditText

    private var etatPc = EtatPc.INCONNU
    private var projetChoisi: String? = null
    /** Dernier échec d'appairage, affiché dans la carte tant qu'on n'a pas réussi (recette du 13/09). */
    private var erreurAppairage: String? = null

    private val scanner = registerForActivityResult(ScanContract()) { resultat ->
        resultat.contents?.let { appairer(it) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Langue.appliquerParDefaut()
        enableEdgeToEdge()
        reglages = Reglages(this)
        ui = Ui(this, Themes.couleurs(reglages.fond, reglages.accent))
        projetChoisi = reglages.dernierProjet

        val contenu = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(ui.dp(18), ui.dp(12), ui.dp(18), ui.dp(28))
        }
        val defilement = ScrollView(this).apply {
            setBackgroundColor(c.fond)
            isFillViewport = true
            addView(contenu)
        }
        ViewCompat.setOnApplyWindowInsetsListener(defilement) { vue, insets ->
            val barres = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            vue.setPadding(barres.left, barres.top, barres.right, barres.bottom)
            insets
        }
        setContentView(defilement)
        WindowCompat.getInsetsController(window, defilement).apply {
            isAppearanceLightStatusBars = c.clair
            isAppearanceLightNavigationBars = c.clair
        }

        contenu.addView(entete())
        cartePc = ui.carte().also { contenu.addView(it) }
        contenu.addView(carteNote())
        carteFile = ui.carte().also { contenu.addView(it) }
        val version = runCatching { packageManager.getPackageInfo(packageName, 0).versionName }.getOrNull() ?: ""
        contenu.addView(ui.texte(getString(R.string.version, version), 12f, c.texteDim).apply { gravity = Gravity.CENTER }.avecMarge(haut = 18))

        lienRecu(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        lienRecu(intent)
    }

    override fun onResume() {
        super.onResume()
        afficherPc()
        afficherPuces()
        afficherFile()
        verifierPc()
    }

    /** QR code lu par l'appareil photo du téléphone plutôt que dans l'app. */
    private fun lienRecu(intent: Intent?) {
        val lien = intent?.data?.toString() ?: return
        if (lien.startsWith("projekt://")) appairer(lien)
    }

    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()

    // ——— En-tête ———————————————————————————————————————————————————————————————

    private fun entete(): View {
        val logo = ImageView(this).apply { setImageResource(R.mipmap.ic_launcher) }
        val titre = ui.texte(getString(R.string.app_name), 20f, gras = true)
        val theme = ui.bouton("◐", principal = false) { choisirTheme() }.apply {
            contentDescription = getString(R.string.theme_titre)
            textSize = 17f
            setPadding(ui.dp(12), ui.dp(4), ui.dp(12), ui.dp(6))
        }
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(logo, LinearLayout.LayoutParams(ui.dp(34), ui.dp(34)))
            addView(titre, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { marginStart = ui.dp(10) })
            addView(theme)
        }
    }

    // ——— PC ————————————————————————————————————————————————————————————————————

    private fun optionsScan() = ScanOptions()
        .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
        .setPrompt(getString(R.string.scan_invite))
        .setBeepEnabled(false)
        .setOrientationLocked(false)

    private fun afficherPc() {
        cartePc.removeAllViews()
        val pc = reglages.pc
        if (pc == null) {
            cartePc.addView(ui.texte(getString(R.string.pc_aucun), 16f, gras = true))
            cartePc.addView(ui.texte(getString(R.string.pc_aide), 14f, c.texteDim).avecMarge(haut = 6))
            erreurAppairage?.let { cartePc.addView(ui.texte(it, 13.5f, c.danger).avecMarge(haut = 10)) }
            cartePc.addView(ui.bouton(getString(R.string.bouton_appairer)) { scanner.launch(optionsScan()) }.avecMarge(haut = 14))
            return
        }
        val (couleur, statut) = when (etatPc) {
            EtatPc.CONNECTE -> c.succes to getString(R.string.pc_connecte)
            EtatPc.INJOIGNABLE -> c.danger to (reglages.erreurPc ?: getString(R.string.pc_injoignable))
            else -> c.texteDim to getString(R.string.pc_recherche)
        }
        cartePc.addView(ui.rangee(ui.point(couleur), ui.texte(getString(R.string.pc_nom, pc.nomPc), 16f, gras = true), espace = 10))
        cartePc.addView(ui.texte(statut, 13.5f, c.texteDim).avecMarge(haut = 6))
        erreurAppairage?.let { cartePc.addView(ui.texte(it, 13.5f, c.danger).avecMarge(haut = 10)) }
        // Le PC a oublié ce téléphone : le moyen d'y remédier, bien en vue (recette du 13/09).
        if (reglages.erreurPc != null && etatPc == EtatPc.INJOIGNABLE) {
            cartePc.addView(ui.bouton(getString(R.string.bouton_reappairer)) { scanner.launch(optionsScan()) }.avecMarge(haut = 12))
        }
        val maj = reglages.majDisponible
        if (maj != null && etatPc == EtatPc.CONNECTE) {
            cartePc.addView(ui.texte(getString(R.string.maj_disponible, maj), 13.5f, c.accent).avecMarge(haut = 12))
            cartePc.addView(ui.bouton(getString(R.string.bouton_maj)) { mettreAJour() }.avecMarge(haut = 8))
        }
        cartePc.addView(
            ui.rangee(
                ui.bouton(getString(R.string.bouton_actualiser), principal = false) { verifierPc() },
                ui.bouton(getString(R.string.bouton_changer_pc), principal = false) { scanner.launch(optionsScan()) },
                ui.bouton(getString(R.string.bouton_oublier_pc), principal = false, danger = true) { oublierPc(pc) },
            ).let { rangee -> HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(rangee) } }
                .avecMarge(haut = 14),
        )
    }

    private fun mettreAJour() {
        toast(getString(R.string.maj_telechargement))
        thread {
            val resultat = runCatching { MiseAJour.telecharger(this) }
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                resultat
                    .onSuccess { fichier -> if (!MiseAJour.installer(this, fichier)) toast(getString(R.string.maj_autoriser)) }
                    .onFailure { toast(getString(R.string.maj_echec, it.message ?: it.toString())) }
            }
        }
    }

    private fun verifierPc() {
        if (reglages.pc == null) return
        etatPc = EtatPc.RECHERCHE
        afficherPc()
        thread {
            val joint = Envoi.rafraichirProjets(this)
            if (joint) Envoi.envoyerTout(this)
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                etatPc = if (joint) EtatPc.CONNECTE else EtatPc.INJOIGNABLE
                afficherPc()
                afficherPuces()
                afficherFile()
            }
        }
    }

    private fun appairer(lien: String) {
        val infos = lireLienAppairage(lien) ?: return toast(getString(R.string.qr_invalide))
        etatPc = EtatPc.RECHERCHE
        erreurAppairage = null
        afficherPc()
        toast(getString(R.string.appairage_en_cours))
        thread {
            val resultat = Envoi.appairer(this, infos)
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                resultat
                    .onSuccess {
                        erreurAppairage = null
                        toast(getString(R.string.appairage_ok, reglages.pc?.nomPc ?: infos.nomPc))
                        etatPc = EtatPc.CONNECTE
                    }
                    .onFailure {
                        erreurAppairage = getString(R.string.appairage_echec, it.message ?: it.toString()) +
                            "\n\n" + getString(R.string.appairage_aide)
                        toast(getString(R.string.appairage_echec, it.message ?: it.toString()))
                        etatPc = if (reglages.pc != null) EtatPc.INJOIGNABLE else EtatPc.INCONNU
                    }
                afficherPc()
                afficherPuces()
                afficherFile()
                if (resultat.isSuccess) lancerEnvoi()
            }
        }
    }

    private fun oublierPc(pc: PcAppaire) {
        AlertDialog.Builder(this)
            .setTitle(R.string.oublier_pc_titre)
            .setMessage(getString(R.string.oublier_pc_message, pc.nomPc))
            .setNegativeButton(R.string.annuler, null)
            .setPositiveButton(R.string.oublier) { _, _ ->
                thread {
                    Envoi.oublierPc(this)
                    runOnUiThread {
                        reglages.pc = null
                        reglages.projets = emptyList()
                        etatPc = EtatPc.INCONNU
                        erreurAppairage = null
                        afficherPc()
                        afficherPuces()
                        afficherFile()
                    }
                }
            }
            .show()
    }

    // ——— Note rapide ———————————————————————————————————————————————————————————

    private fun carteNote(): View = ui.carte().apply {
        addView(ui.titreSection(getString(R.string.note_titre)))
        puces = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.HORIZONTAL }
        addView(HorizontalScrollView(this@MainActivity).apply {
            isHorizontalScrollBarEnabled = false
            addView(puces)
        })
        champNote = ui.champ(getString(R.string.note_indice))
        addView(champNote.avecMarge(haut = 10))
        addView(ui.bouton(getString(R.string.envoyer)) { envoyerNote() }.avecMarge(haut = 10))
    }

    private fun afficherPuces() {
        puces.removeAllViews()
        val projets = reglages.projets
        if (projets.isEmpty()) {
            puces.addView(ui.texte(getString(R.string.aucun_projet), 13f, c.texteDim))
            return
        }
        if (projets.none { it.id == projetChoisi }) projetChoisi = projets.first().id
        for (projet in projets) {
            puces.addView(ui.puce(projet.nom, projet.id == projetChoisi) {
                projetChoisi = projet.id
                reglages.dernierProjet = projet.id
                afficherPuces()
            })
        }
    }

    private fun envoyerNote() {
        val texte = champNote.text.toString().trim()
        if (texte.isEmpty()) return
        FileAttente.ajouter(this, Element.depuisTexte(texte, null, reglages.projets.find { it.id == projetChoisi }))
        champNote.setText("")
        afficherFile()
        lancerEnvoi()
    }

    private fun lancerEnvoi() {
        thread {
            val bilan = Envoi.envoyerTout(this)
            if (bilan.restants > 0) EnvoiWorker.planifier(this)
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                if (reglages.pc != null) etatPc = if (bilan.joint) EtatPc.CONNECTE else EtatPc.INJOIGNABLE
                afficherPc()
                afficherFile()
            }
        }
    }

    // ——— File d'attente et historique ———————————————————————————————————————————

    private fun afficherFile() {
        carteFile.removeAllViews()
        carteFile.addView(ui.titreSection(getString(R.string.file_titre)))
        val elements = FileAttente.tous(this)
        val enAttente = elements.count { it.etat == Element.ATTENTE }
        if (enAttente > 0 && reglages.pc != null) {
            carteFile.addView(ui.bouton(getString(R.string.envoyer_maintenant, enAttente)) { lancerEnvoi() })
        }
        if (elements.isEmpty()) {
            carteFile.addView(ui.texte(getString(R.string.file_vide), 14f, c.texteDim))
            return
        }
        elements.forEachIndexed { i, element ->
            if (i > 0 || enAttente > 0) {
                carteFile.addView(View(this).apply { setBackgroundColor(c.bord) }, LinearLayout.LayoutParams(MATCH_PARENT, 1).apply {
                    topMargin = ui.dp(10)
                })
            }
            carteFile.addView(ligne(element))
        }
    }

    private fun ligne(element: Element): View {
        val icone = when (element.genre) {
            "image" -> "🖼"
            "audio" -> "🎵"
            "lien" -> "🔗"
            else -> "📝"
        }
        val libelle = when {
            element.genre == "image" -> element.nom ?: getString(R.string.genre_image)
            element.genre == "audio" -> element.nom ?: getString(R.string.genre_audio)
            !element.texte.isNullOrBlank() -> element.texte
            else -> element.url ?: getString(R.string.genre_lien)
        }
        val statut = when (element.etat) {
            Element.ATTENTE -> getString(R.string.etat_attente)
            Element.ENVOYE -> getString(R.string.etat_envoye, date(element.envoyeLe ?: element.creeLe))
            else -> getString(R.string.etat_refuse, element.erreur ?: "?")
        }

        val textes = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(ui.texte(libelle, 14f).apply {
                maxLines = 2
                ellipsize = TextUtils.TruncateAt.END
            })
            addView(ui.texte(listOfNotNull(element.nomProjet, statut).joinToString(" · "), 12f,
                if (element.etat == Element.REFUSE) c.danger else c.texteDim))
        }
        val ligne = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, ui.dp(10), 0, 0)
            addView(ui.texte(icone, 18f))
            addView(textes, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { marginStart = ui.dp(10) })
        }
        if (element.etat == Element.REFUSE) {
            ligne.addView(ui.puce(getString(R.string.renvoyer), false) {
                FileAttente.maj(this, element.copy(etat = Element.ATTENTE, erreur = null))
                afficherFile()
                lancerEnvoi()
            })
        }
        if (element.etat != Element.ENVOYE) {
            ligne.addView(ui.puce(getString(R.string.supprimer), false) {
                FileAttente.supprimer(this, element.id)
                afficherFile()
            })
        }
        return ligne
    }

    private fun date(ms: Long): String = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(ms))

    // ——— Thème ———————————————————————————————————————————————————————————————————

    private fun choisirTheme() {
        lateinit var dialogue: AlertDialog
        val vue = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = fondArrondi(c.surface, ui.dp(16).toFloat(), c.bord, ui.dp(1))
            setPadding(ui.dp(20), ui.dp(18), ui.dp(20), ui.dp(12))
        }
        vue.addView(ui.texte(getString(R.string.theme_titre), 18f, gras = true))

        vue.addView(ui.titreSection(getString(R.string.theme_fond)).avecMarge(haut = 16))
        val fonds = GridLayout(this).apply { columnCount = 2 }
        for (fond in Themes.FONDS) {
            fonds.addView(ui.puce(Themes.nom(fond.id, fond.nom), fond.id == reglages.fond) {
                reglages.fond = fond.id
                dialogue.dismiss()
                recreate()
            }.apply {
                // Aperçu du fond : le fond lui-même, avec une bande de sa surface (comme sur le PC).
                val apercu = GradientDrawable(
                    GradientDrawable.Orientation.LEFT_RIGHT,
                    intArrayOf(Color.parseColor(fond.fond), Color.parseColor(fond.fond), Color.parseColor(fond.surface2)),
                ).apply {
                    cornerRadius = ui.dp(3).toFloat()
                    setStroke(ui.dp(1), Color.parseColor(fond.bord))
                    setSize(ui.dp(18), ui.dp(14))
                }
                setCompoundDrawablesRelativeWithIntrinsicBounds(apercu, null, null, null)
                compoundDrawablePadding = ui.dp(8)
                layoutParams = GridLayout.LayoutParams().apply { setMargins(0, 0, ui.dp(8), ui.dp(8)) }
            })
        }
        vue.addView(fonds)

        vue.addView(ui.titreSection(getString(R.string.theme_couleur)).avecMarge(haut = 10))
        val accents = GridLayout(this).apply { columnCount = 5 }
        for (accent in Themes.ACCENTS) {
            accents.addView(View(this).apply {
                background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(Color.parseColor(accent.pastille))
                    if (accent.id == reglages.accent) setStroke(ui.dp(3), c.texte) else setStroke(ui.dp(1), c.bord)
                }
                contentDescription = Themes.nom(accent.id, accent.nom)
                setOnClickListener {
                    reglages.accent = accent.id
                    dialogue.dismiss()
                    recreate()
                }
                layoutParams = GridLayout.LayoutParams().apply {
                    width = ui.dp(36)
                    height = ui.dp(36)
                    setMargins(0, 0, ui.dp(14), ui.dp(14))
                }
            })
        }
        vue.addView(accents)

        // Langue de l'app (choix du 12/09) : français par défaut.
        vue.addView(ui.titreSection(getString(R.string.langue)).avecMarge(haut = 4))
        val langues = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        for ((code, nom) in Langue.LANGUES) {
            langues.addView(ui.puce(nom, Langue.actuelle() == code) {
                dialogue.dismiss()
                // Android recrée l'écran tout seul dans la nouvelle langue.
                if (Langue.actuelle() != code) Langue.choisir(code)
            })
        }
        vue.addView(langues)

        dialogue = AlertDialog.Builder(this).setView(vue).create()
        dialogue.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        dialogue.show()
    }
}
