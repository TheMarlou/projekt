package app.projekt.mobile

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Petite boîte à outils d'interface. L'app est construite en code plutôt qu'en
 * XML : les couleurs viennent du thème choisi par l'utilisateur, à l'exécution.
 */

fun Context.dp(n: Int): Int = (n * resources.displayMetrics.density).toInt()

fun fondArrondi(couleur: Int, rayon: Float, bord: Int? = null, epaisseur: Int = 0): GradientDrawable =
    GradientDrawable().apply {
        setColor(couleur)
        cornerRadius = rayon
        if (bord != null && epaisseur > 0) setStroke(epaisseur, bord)
    }

/** Marge au-dessus, en gardant la largeur déjà choisie pour la vue. */
fun <T : View> T.avecMarge(haut: Int = 0): T {
    val parametres = layoutParams as? LinearLayout.LayoutParams ?: LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT)
    parametres.topMargin = context.dp(haut)
    layoutParams = parametres
    return this
}

class Ui(private val ctx: Context, val c: Couleurs) {
    fun dp(n: Int) = ctx.dp(n)

    fun texte(contenu: CharSequence, taille: Float = 15f, couleur: Int = c.texte, gras: Boolean = false) =
        TextView(ctx).apply {
            text = contenu
            textSize = taille
            setTextColor(couleur)
            setLineSpacing(0f, 1.15f)
            if (gras) typeface = Typeface.DEFAULT_BOLD
        }

    fun titreSection(contenu: String) = texte(contenu.uppercase(), 11f, c.texteDim).apply {
        typeface = Typeface.MONOSPACE
        letterSpacing = 0.08f
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { bottomMargin = dp(8) }
    }

    fun carte() = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        background = fondArrondi(c.surface, dp(14).toFloat(), c.bord, dp(1))
        setPadding(dp(16), dp(14), dp(16), dp(16))
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(12) }
    }

    fun bouton(contenu: String, principal: Boolean = true, danger: Boolean = false, action: () -> Unit) =
        TextView(ctx).apply {
            text = contenu
            textSize = 14f
            gravity = Gravity.CENTER
            val couleur = when {
                danger -> c.danger
                principal -> c.accent
                else -> c.texteDim
            }
            setTextColor(couleur)
            background = fondArrondi(
                if (principal) c.accentDoux else Color.TRANSPARENT,
                dp(8).toFloat(),
                if (principal || danger) couleur else c.bord,
                dp(1),
            )
            setPadding(dp(14), dp(10), dp(14), dp(10))
            isClickable = true
            isFocusable = true
            setOnClickListener { action() }
        }

    fun puce(contenu: String, actif: Boolean, action: () -> Unit) = TextView(ctx).apply {
        text = contenu
        textSize = 13.5f
        maxLines = 1
        setTextColor(if (actif) c.accent else c.texteDim)
        background = fondArrondi(
            if (actif) c.accentDoux else Color.TRANSPARENT,
            dp(16).toFloat(),
            if (actif) c.accent else c.bord,
            dp(1),
        )
        setPadding(dp(12), dp(7), dp(12), dp(7))
        isClickable = true
        setOnClickListener { action() }
        layoutParams = LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { marginEnd = dp(8) }
    }

    fun champ(indice: String) = EditText(ctx).apply {
        hint = indice
        setHintTextColor(c.texteDim)
        setTextColor(c.texte)
        textSize = 15f
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        minLines = 3
        maxLines = 8
        gravity = Gravity.TOP or Gravity.START
        background = fondArrondi(c.surface2, dp(8).toFloat(), c.bord, dp(1))
        setPadding(dp(12), dp(10), dp(12), dp(10))
    }

    fun rangee(vararg vues: View, espace: Int = 8) = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        vues.forEachIndexed { i, vue ->
            // Une vue qui a déjà sa taille (le point d'état) la garde : en WRAP_CONTENT,
            // une simple View prend TOUTE la place disponible (recette du 13/09 : un
            // ovale vert qui remplissait la carte).
            val parametres = (vue.layoutParams as? LinearLayout.LayoutParams)?.let { LinearLayout.LayoutParams(it) }
                ?: LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT)
            if (i > 0) parametres.marginStart = dp(espace)
            addView(vue, parametres)
        }
    }

    fun point(couleur: Int, taille: Int = 9) = View(ctx).apply {
        background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(couleur)
        }
        layoutParams = LinearLayout.LayoutParams(dp(taille), dp(taille))
    }
}
