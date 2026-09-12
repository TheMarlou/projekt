package app.projekt.mobile

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Mise à jour de l'app transmise par le PC (choix du 12/09) : l'app bureau
 * embarque le dernier Projekt-Mobile.apk et le sert sur le réseau local.
 *
 * Le fichier voyage en http:// non chiffré, et ce n'est pas un risque : Android
 * refuse d'installer une mise à jour qui n'est pas signée avec la MÊME clé que
 * l'app déjà installée. Un APK trafiqué serait simplement rejeté.
 */
object MiseAJour {

    fun versionInstallee(context: Context): Long =
        PackageInfoCompat.getLongVersionCode(context.packageManager.getPackageInfo(context.packageName, 0))

    /** Appelée après un contact réussi avec le PC. */
    fun verifier(context: Context, hote: String, port: Int) {
        val reglages = Reglages(context)
        runCatching {
            val connexion = (URL("http://$hote:$port/v1/mobile/version").openConnection() as HttpURLConnection).apply {
                connectTimeout = 1500
                readTimeout = 3000
            }
            try {
                if (connexion.responseCode != 200) {
                    reglages.majDisponible = null
                    return
                }
                val version = JSONObject(connexion.inputStream.use { String(it.readBytes(), Charsets.UTF_8) })
                reglages.majDisponible =
                    if (version.getLong("versionCode") > versionInstallee(context)) version.getString("versionName") else null
            } finally {
                connexion.disconnect()
            }
        }
    }

    fun telecharger(context: Context): File {
        val reglages = Reglages(context)
        val pc = reglages.pc ?: throw ErreurPc(context.getString(R.string.pc_aucun))
        val hote = reglages.derniereAdresse ?: throw ErreurPc(context.getString(R.string.pc_introuvable))
        val connexion = (URL("http://$hote:${pc.port}/v1/mobile/apk").openConnection() as HttpURLConnection).apply {
            connectTimeout = 2500
            readTimeout = 60_000
        }
        try {
            if (connexion.responseCode != 200) throw ErreurPc("erreur ${connexion.responseCode}", connexion.responseCode)
            val fichier = File(context.cacheDir, "maj/projekt-mobile.apk").apply { parentFile?.mkdirs() }
            connexion.inputStream.use { entree -> fichier.outputStream().use { entree.copyTo(it) } }
            return fichier
        } finally {
            connexion.disconnect()
        }
    }

    /** Vrai si l'installeur d'Android a été ouvert ; faux s'il faut d'abord autoriser l'app. */
    fun installer(activite: Activity, fichier: File): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activite.packageManager.canRequestPackageInstalls()) {
            activite.startActivity(
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activite.packageName}")),
            )
            return false
        }
        val uri = FileProvider.getUriForFile(activite, "${activite.packageName}.fichiers", fichier)
        activite.startActivity(
            Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        return true
    }
}
