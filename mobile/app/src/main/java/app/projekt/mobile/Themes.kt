package app.projekt.mobile

import android.graphics.Color

/**
 * Les MÊMES thèmes que l'app bureau (`src/theme.ts`) : 7 fonds × 9 couleurs
 * principales (choix du 12/09). Réglés indépendamment du PC.
 */
data class Couleurs(
    val fond: Int,
    val surface: Int,
    val surface2: Int,
    val bord: Int,
    val texte: Int,
    val texteDim: Int,
    val accent: Int,
    val accentDoux: Int,
    val danger: Int,
    val succes: Int,
    val clair: Boolean,
)

object Themes {
    data class Fond(
        val id: String,
        val nom: String,
        val clair: Boolean,
        val fond: String,
        val surface: String,
        val surface2: String,
        val bord: String,
        val texte: String,
        val texteDim: String,
    )

    data class Accent(
        val id: String,
        val nom: String,
        val pastille: String,
        val sombre: Pair<String, String>,
        val clair: Pair<String, String>,
    )

    val FONDS = listOf(
        Fond("dark", "Sombre", false, "#14161c", "#1b1e26", "#20232c", "#2b2f3a", "#e9e7e0", "#9599a9"),
        Fond("nuit", "Nuit bleue", false, "#0f1626", "#151e31", "#1b2539", "#26324a", "#e6e9f2", "#8f9ab3"),
        Fond("foret", "Forêt", false, "#111a15", "#16221b", "#1c2a21", "#27382d", "#e4ebe3", "#8fa596"),
        Fond("prune", "Prune", false, "#1a1320", "#211828", "#281d30", "#372a42", "#ece4ef", "#a393ad"),
        Fond("light", "Clair", true, "#f2f3f6", "#ffffff", "#f5f6f9", "#dde0e6", "#1c1e26", "#6b7080"),
        Fond("papier", "Papier", true, "#f4efe4", "#fbf8f1", "#f1eadb", "#e0d6c2", "#2b261d", "#7a6f5c"),
        Fond("menthe", "Menthe", true, "#eef6f2", "#fbfefc", "#eff7f3", "#d3e5dc", "#1b2622", "#62776e"),
    )

    val ACCENTS = listOf(
        Accent("mono", "Monochrome", "#c7c7cf", "#e7e7ea" to "#33343a", "#22232a" to "#e6e6e9"),
        Accent("orange", "Orange", "#e8a33d", "#e8a33d" to "#3a2f18", "#a86a08" to "#f3e3c4"),
        Accent("jaune", "Jaune", "#e3c345", "#e3c345" to "#3a3217", "#8a6d00" to "#f3ead0"),
        Accent("rouge", "Rouge", "#e5655c", "#e5655c" to "#3a1c1a", "#b3261e" to "#f6dcda"),
        Accent("rose", "Rose", "#ec7fb4", "#ec7fb4" to "#3a1d2d", "#b8336f" to "#f7dce9"),
        Accent("violet", "Violet", "#a98cf0", "#a98cf0" to "#2a2440", "#6d43d6" to "#e7defb"),
        Accent("blue", "Bleu", "#5fa8ea", "#5fa8ea" to "#182a3d", "#1f66c9" to "#dae8fb"),
        Accent("cyan", "Cyan", "#3cc6d6", "#3cc6d6" to "#123238", "#0a7c8c" to "#d3eff2"),
        Accent("vert", "Vert", "#5fbf77", "#5fbf77" to "#1b3222", "#1f7a3a" to "#d9efe0"),
    )

    private val NOMS_EN = mapOf(
        "dark" to "Dark", "nuit" to "Night blue", "foret" to "Forest", "prune" to "Plum",
        "light" to "Light", "papier" to "Paper", "menthe" to "Mint",
        "mono" to "Monochrome", "orange" to "Orange", "jaune" to "Yellow", "rouge" to "Red", "rose" to "Pink",
        "violet" to "Purple", "blue" to "Blue", "cyan" to "Cyan", "vert" to "Green",
    )

    /** Nom affiché d'un fond ou d'une couleur, dans la langue de l'app. */
    fun nom(id: String, nomFrancais: String) = if (Langue.anglais()) NOMS_EN[id] ?: nomFrancais else nomFrancais

    /** Par défaut : sombre + blanc, comme le logo et l'app bureau. */
    fun couleurs(fondId: String, accentId: String): Couleurs {
        val fond = FONDS.find { it.id == fondId } ?: FONDS.first()
        val accent = ACCENTS.find { it.id == accentId } ?: ACCENTS.first()
        val paire = if (fond.clair) accent.clair else accent.sombre
        fun c(hex: String) = Color.parseColor(hex)
        return Couleurs(
            fond = c(fond.fond),
            surface = c(fond.surface),
            surface2 = c(fond.surface2),
            bord = c(fond.bord),
            texte = c(fond.texte),
            texteDim = c(fond.texteDim),
            accent = c(paire.first),
            accentDoux = c(paire.second),
            danger = c(if (fond.clair) "#b3261e" else "#e5655c"),
            succes = c(if (fond.clair) "#1f7a3a" else "#4ade80"),
            clair = fond.clair,
        )
    }
}
