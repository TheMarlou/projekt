package app.projekt.mobile

import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat

/**
 * Français ou anglais, réglé dans l'app (choix du 12/09) — le français par
 * défaut, même sur un téléphone réglé en anglais.
 */
object Langue {
    val LANGUES = listOf("fr" to "Français", "en" to "English")

    fun actuelle(): String = AppCompatDelegate.getApplicationLocales().toLanguageTags().substringBefore('-').ifEmpty { "fr" }

    /** Premier lancement : français. À appeler au début de chaque écran. */
    fun appliquerParDefaut() {
        if (AppCompatDelegate.getApplicationLocales().isEmpty) choisir("fr")
    }

    fun choisir(code: String) {
        AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(code))
    }

    fun anglais() = actuelle() == "en"
}
