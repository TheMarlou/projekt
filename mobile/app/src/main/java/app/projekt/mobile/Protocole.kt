package app.projekt.mobile

import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException
import java.net.URI
import java.net.URL
import java.net.URLDecoder
import java.security.GeneralSecurityException
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Dialogue avec l'app bureau, en direct sur le réseau local (voir
 * `src-tauri/src/telephone.rs`, qui en est le miroir exact).
 *
 * Chaque requête est chiffrée et authentifiée en AES-256-GCM avec la clé reçue
 * par le QR code : paquet = nonce (12 octets) ‖ texte chiffré ‖ étiquette.
 * Les données associées (« route|appareil ») lient le message à sa route.
 */
object Chiffrement {
    private val aleatoire = SecureRandom()

    fun chiffrer(
        cle: ByteArray,
        aad: String,
        clair: ByteArray,
        nonce: ByteArray = ByteArray(12).also { aleatoire.nextBytes(it) },
    ): ByteArray {
        val algo = Cipher.getInstance("AES/GCM/NoPadding")
        algo.init(Cipher.ENCRYPT_MODE, SecretKeySpec(cle, "AES"), GCMParameterSpec(128, nonce))
        algo.updateAAD(aad.toByteArray(Charsets.UTF_8))
        return nonce + algo.doFinal(clair)
    }

    fun dechiffrer(cle: ByteArray, aad: String, paquet: ByteArray): ByteArray? {
        if (paquet.size < 12 + 16) return null
        return try {
            val algo = Cipher.getInstance("AES/GCM/NoPadding")
            algo.init(Cipher.DECRYPT_MODE, SecretKeySpec(cle, "AES"), GCMParameterSpec(128, paquet, 0, 12))
            algo.updateAAD(aad.toByteArray(Charsets.UTF_8))
            algo.doFinal(paquet, 12, paquet.size - 12)
        } catch (e: GeneralSecurityException) {
            null
        }
    }
}

/** Ce que porte le QR code affiché par le PC. */
data class InfosAppairage(
    val pcId: String,
    val nomPc: String,
    val cle: ByteArray,
    val adresses: List<String>,
    val port: Int,
)

/** `projekt://appairer?v=1&pc=…&n=…&k=…&h=ip1,ip2&p=47821` → infos, ou `null` si ce n'est pas un QR de Projekt. */
fun lireLienAppairage(lien: String): InfosAppairage? {
    val uri = runCatching { URI(lien.trim()) }.getOrNull() ?: return null
    if (uri.scheme != "projekt" || uri.host != "appairer") return null
    val params = (uri.rawQuery ?: return null).split("&").mapNotNull {
        val morceaux = it.split("=", limit = 2)
        if (morceaux.size == 2) morceaux[0] to URLDecoder.decode(morceaux[1], "UTF-8") else null
    }.toMap()
    if (params["v"] != "1") return null
    val pcId = params["pc"]?.takeIf { id -> id.isNotEmpty() && id.all { it.isLetterOrDigit() } } ?: return null
    val cle = runCatching { Base64.getUrlDecoder().decode(params["k"]) }.getOrNull()?.takeIf { it.size == 32 } ?: return null
    val port = params["p"]?.toIntOrNull()?.takeIf { it in 1..65535 } ?: return null
    val adresses = params["h"].orEmpty().split(",").map { it.trim() }.filter { it.isNotEmpty() }
    return InfosAppairage(pcId, params["n"] ?: "PC", cle, adresses, port)
}

class ErreurPc(message: String, val code: Int = 0) : Exception(message) {
    /** Réessayer ne changera rien (téléphone oublié par le PC, contenu refusé…). */
    val definitive get() = code in listOf(400, 401, 403, 410, 413)
}

class ClientPc(private val cle: ByteArray, private val appareil: String) {

    /** Envoie un message chiffré à une route et renvoie la réponse déchiffrée. */
    fun appeler(hote: String, port: Int, route: String, charge: JSONObject): JSONObject {
        charge.put("envoyeLe", System.currentTimeMillis())
        val corps = Chiffrement.chiffrer(cle, "$route|$appareil", charge.toString().toByteArray(Charsets.UTF_8))
        val connexion = (URL("http://${hotePourUrl(hote)}:$port/v1/$route").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 2500
            // Une image ou un MP3 de plusieurs Mo peut prendre du temps sur un partage de connexion.
            readTimeout = 60_000
            doOutput = true
            setFixedLengthStreamingMode(corps.size)
            setRequestProperty("Content-Type", "application/octet-stream")
            setRequestProperty("X-Appareil", appareil)
        }
        try {
            connexion.outputStream.use { it.write(corps) }
            val code = connexion.responseCode
            val octets = (if (code in 200..299) connexion.inputStream else connexion.errorStream)?.use { it.readBytes() } ?: ByteArray(0)
            if (code != 200) throw ErreurPc(String(octets, Charsets.UTF_8).ifBlank { "erreur $code" }, code)
            val clair = Chiffrement.dechiffrer(cle, "$route-reponse|$appareil", octets) ?: throw ErreurPc("réponse illisible")
            return JSONObject(String(clair, Charsets.UTF_8))
        } finally {
            connexion.disconnect()
        }
    }

    companion object {
        /** Le PC répond-il à cette adresse, et est-ce bien LE bon PC ? */
        fun repond(hote: String, port: Int, pcId: String): Boolean = runCatching {
            val connexion = (URL("http://${hotePourUrl(hote)}:$port/v1/ping").openConnection() as HttpURLConnection).apply {
                connectTimeout = 1200
                readTimeout = 1500
            }
            try {
                connexion.responseCode == 200 &&
                    JSONObject(connexion.inputStream.use { String(it.readBytes(), Charsets.UTF_8) }).optString("pc") == pcId
            } finally {
                connexion.disconnect()
            }
        }.getOrDefault(false)

        /**
         * L'adresse du PC change souvent sur un partage de connexion : on crie
         * « PROJEKT?<id> » sur le réseau, et le bon PC répond avec son port.
         */
        fun decouvrir(pcId: String, port: Int, delaiMs: Int = 1500): Pair<String, Int>? = runCatching {
            DatagramSocket().use { socket ->
                socket.broadcast = true
                socket.soTimeout = delaiMs
                val question = "PROJEKT?$pcId".toByteArray()
                for (adresse in adressesDeDiffusion()) {
                    runCatching { socket.send(DatagramPacket(question, question.size, adresse, port)) }
                }
                val tampon = ByteArray(128)
                val fin = System.currentTimeMillis() + delaiMs
                while (System.currentTimeMillis() < fin) {
                    val paquet = DatagramPacket(tampon, tampon.size)
                    try {
                        socket.receive(paquet)
                    } catch (e: SocketTimeoutException) {
                        break
                    }
                    val reponse = String(paquet.data, 0, paquet.length)
                    val prefixe = "PROJEKT!$pcId|"
                    if (reponse.startsWith(prefixe)) {
                        val portPc = reponse.removePrefix(prefixe).trim().toIntOrNull() ?: port
                        return@use paquet.address.hostAddress?.let { it to portPc }
                    }
                }
                null
            }
        }.getOrNull()

        private fun adressesDeDiffusion(): List<InetAddress> {
            val locales = runCatching {
                NetworkInterface.getNetworkInterfaces().toList()
                    .filter { it.isUp && !it.isLoopback }
                    .flatMap { it.interfaceAddresses.mapNotNull { adresse -> adresse.broadcast } }
            }.getOrDefault(emptyList())
            return locales + InetAddress.getByName("255.255.255.255")
        }

        private fun hotePourUrl(hote: String) = if (hote.contains(':')) "[$hote]" else hote
    }
}
