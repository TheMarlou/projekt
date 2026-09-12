package app.projekt.mobile

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.IntentCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.util.UUID
import kotlin.concurrent.thread

/**
 * « Partager → Projekt Mobile » : un petit panneau en bas de l'écran (choix du
 * 12/09), par-dessus TikTok ou la galerie. Aperçu, choix du projet, Envoyer.
 */
class PartageActivity : AppCompatActivity() {

    private data class Partage(
        val genre: String,
        val texte: String?,
        val sujet: String?,
        val uri: Uri?,
        val nom: String?,
        val mime: String?,
    )

    private lateinit var reglages: Reglages
    private lateinit var ui: Ui
    private var projetChoisi: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Langue.appliquerParDefaut()
        enableEdgeToEdge()
        reglages = Reglages(this)
        ui = Ui(this, Themes.couleurs(reglages.fond, reglages.accent))
        val c = ui.c
        val partages = lirePartages(intent)

        val panneau = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val r = ui.dp(20).toFloat()
            background = GradientDrawable().apply {
                setColor(c.surface)
                cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f)
            }
            isClickable = true
        }
        val racine = FrameLayout(this).apply {
            // Toucher l'app d'origine, au-dessus du panneau, referme le partage.
            setOnClickListener { finish() }
            addView(panneau, FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT, Gravity.BOTTOM))
        }
        ViewCompat.setOnApplyWindowInsetsListener(racine) { _, insets ->
            val bas = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime()).bottom
            panneau.setPadding(ui.dp(20), ui.dp(18), ui.dp(20), ui.dp(20) + bas)
            insets
        }
        setContentView(racine)

        panneau.addView(ui.texte(getString(R.string.partage_titre), 18f, gras = true))
        if (partages.isEmpty()) {
            panneau.addView(ui.texte(getString(R.string.partage_vide), 14f, c.texteDim).avecMarge(haut = 8))
            panneau.addView(ui.bouton(getString(R.string.fermer)) { finish() }.avecMarge(haut = 16))
            return
        }
        panneau.addView(apercu(partages).avecMarge(haut = 12))
        if (reglages.pc == null) {
            panneau.addView(ui.texte(getString(R.string.partage_non_appaire), 13.5f, c.danger).avecMarge(haut = 12))
        }

        val projets = reglages.projets
        projetChoisi = reglages.dernierProjet?.takeIf { id -> projets.any { it.id == id } } ?: projets.firstOrNull()?.id
        panneau.addView(ui.titreSection(getString(R.string.projet)).avecMarge(haut = 16))
        val puces = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        fun afficherPuces() {
            puces.removeAllViews()
            if (projets.isEmpty()) {
                puces.addView(ui.texte(getString(R.string.aucun_projet), 13f, c.texteDim))
                return
            }
            for (projet in projets) {
                puces.addView(ui.puce(projet.nom, projet.id == projetChoisi) {
                    projetChoisi = projet.id
                    afficherPuces()
                })
            }
        }
        afficherPuces()
        panneau.addView(HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            addView(puces)
        })

        lateinit var envoyer: TextView
        envoyer = ui.bouton(getString(R.string.envoyer)) { lancer(partages, envoyer) }
        val annuler = ui.bouton(getString(R.string.annuler), principal = false) { finish() }
        panneau.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(annuler, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
            addView(envoyer, LinearLayout.LayoutParams(0, WRAP_CONTENT, 2f).apply { marginStart = ui.dp(10) })
        }.avecMarge(haut = 20))
    }

    // ——— Ce qui est partagé ————————————————————————————————————————————————————————

    private fun lirePartages(intent: Intent): List<Partage> {
        val type = intent.type.orEmpty()
        return when (intent.action) {
            Intent.ACTION_SEND -> {
                val flux = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
                if (flux != null && (type.startsWith("image/") || type.startsWith("audio/"))) {
                    listOf(fichier(flux, type))
                } else {
                    val texte = intent.getStringExtra(Intent.EXTRA_TEXT)?.takeIf { it.isNotBlank() }
                    texte?.let { listOf(Partage("texte", it, intent.getStringExtra(Intent.EXTRA_SUBJECT), null, null, null)) }.orEmpty()
                }
            }
            Intent.ACTION_SEND_MULTIPLE ->
                IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
                    .map { fichier(it, contentResolver.getType(it) ?: type) }
                    .filter { it.mime.orEmpty().startsWith("image/") || it.mime.orEmpty().startsWith("audio/") }
            else -> emptyList()
        }
    }

    private fun fichier(uri: Uri, mime: String): Partage {
        val nom = runCatching {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { curseur ->
                if (curseur.moveToFirst()) curseur.getString(0) else null
            }
        }.getOrNull() ?: uri.lastPathSegment
        return Partage(if (mime.startsWith("audio/")) "audio" else "image", null, null, uri, nom, mime)
    }

    private fun apercu(partages: List<Partage>): View {
        val c = ui.c
        if (partages.size > 1) {
            val liste = partages.joinToString("\n") { "• " + (it.nom ?: it.texte ?: "") }
            return ui.texte(getString(R.string.n_elements, partages.size) + "\n" + liste, 14f, c.texteDim).apply { maxLines = 7 }
        }
        val partage = partages.first()
        if (partage.genre == "image" && partage.uri != null) {
            val image = ImageView(this).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                background = fondArrondi(c.surface2, ui.dp(10).toFloat())
                clipToOutline = true
                layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, ui.dp(190))
            }
            thread {
                val miniature = miniature(partage.uri)
                runOnUiThread { if (miniature != null && !isDestroyed) image.setImageBitmap(miniature) }
            }
            return image
        }
        val texte = if (partage.genre == "audio") "🎵  " + (partage.nom ?: getString(R.string.genre_audio)) else partage.texte.orEmpty()
        return ui.texte(texte, 14.5f).apply {
            maxLines = 5
            ellipsize = TextUtils.TruncateAt.END
            background = fondArrondi(c.surface2, ui.dp(10).toFloat(), c.bord, ui.dp(1))
            setPadding(ui.dp(12), ui.dp(10), ui.dp(12), ui.dp(10))
        }
    }

    /** Image réduite pour l'aperçu : une photo de 50 Mpx ne doit pas remplir la mémoire. */
    private fun miniature(uri: Uri): Bitmap? = runCatching {
        val bornes = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bornes) }
        var echelle = 1
        while (maxOf(bornes.outWidth, bornes.outHeight) / (echelle * 2) >= 900) echelle *= 2
        contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = echelle })
        }
    }.getOrNull()

    // ——— Envoi ——————————————————————————————————————————————————————————————————————

    private fun lancer(partages: List<Partage>, bouton: TextView) {
        bouton.isEnabled = false
        bouton.text = getString(R.string.envoi_en_cours)
        val projet = reglages.projets.find { it.id == projetChoisi }
        reglages.dernierProjet = projet?.id

        thread {
            var probleme: String? = null
            for (partage in partages) {
                try {
                    if (partage.uri == null) {
                        FileAttente.ajouter(this, Element.depuisTexte(partage.texte.orEmpty(), partage.sujet, projet))
                    } else {
                        val id = UUID.randomUUID().toString()
                        val copie = FileAttente.copierFichier(this, partage.uri, id, partage.genre, partage.mime, partage.nom)
                        FileAttente.ajouter(
                            this,
                            Element(
                                id = id,
                                genre = partage.genre,
                                projet = projet?.id,
                                nomProjet = projet?.nom,
                                texte = null,
                                url = null,
                                nom = partage.nom,
                                ext = copie.ext,
                                fichier = copie.chemin,
                                creeLe = System.currentTimeMillis(),
                            ),
                        )
                    }
                } catch (e: FichierTropGros) {
                    probleme = getString(R.string.trop_gros, partage.nom ?: "?")
                } catch (e: Exception) {
                    probleme = e.message ?: e.toString()
                }
            }
            val bilan = if (reglages.pc != null) Envoi.envoyerTout(this) else null
            if (bilan == null || bilan.restants > 0) EnvoiWorker.planifier(this)
            runOnUiThread {
                val message = probleme
                    ?: if (bilan != null && bilan.restants == 0) getString(R.string.envoye_ok) else getString(R.string.envoye_attente)
                Toast.makeText(applicationContext, message, Toast.LENGTH_LONG).show()
                finish()
            }
        }
    }
}
