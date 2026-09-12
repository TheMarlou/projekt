package app.projekt.mobile

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Base64

class ChiffrementTest {

    /**
     * Même vecteur que le test Rust `vecteur_commun_avec_android` (et recalculé à
     * part avec Node) : si les deux côtés ne produisent pas les mêmes octets, le
     * téléphone et le PC ne se comprendront pas.
     */
    @Test
    fun vecteurCommunAvecLePc() {
        val cle = ByteArray(32) { it.toByte() }
        val nonce = ByteArray(12) { (100 + it).toByte() }
        val paquet = Chiffrement.chiffrer(cle, "envoi|tel1", "{\"envoyeLe\":1}".toByteArray(), nonce)
        assertEquals("ZGVmZ2hpamtsbW5vMzm7CA+GL/tyB33S6xjJZSb5UVacf4iwF8dfDDfm", Base64.getEncoder().encodeToString(paquet))
    }

    @Test
    fun allerRetourEtFalsification() {
        val cle = ByteArray(32) { (it * 7).toByte() }
        val paquet = Chiffrement.chiffrer(cle, "envoi|tel1", "bonjour".toByteArray())
        assertArrayEquals("bonjour".toByteArray(), Chiffrement.dechiffrer(cle, "envoi|tel1", paquet))
        assertNull(Chiffrement.dechiffrer(cle, "projets|tel1", paquet))
        val abime = paquet.copyOf().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 1).toByte() }
        assertNull(Chiffrement.dechiffrer(cle, "envoi|tel1", abime))
        assertNull(Chiffrement.dechiffrer(ByteArray(32), "envoi|tel1", paquet))
    }

    @Test
    fun lectureDuQrCode() {
        val cle = ByteArray(32) { it.toByte() }
        val k = Base64.getUrlEncoder().withoutPadding().encodeToString(cle)
        val infos = lireLienAppairage("projekt://appairer?v=1&pc=ab12cd34&n=PC%20de%20Marlou&k=$k&h=192.168.1.20,10.0.0.5&p=47821")!!
        assertEquals("ab12cd34", infos.pcId)
        assertEquals("PC de Marlou", infos.nomPc)
        assertArrayEquals(cle, infos.cle)
        assertEquals(listOf("192.168.1.20", "10.0.0.5"), infos.adresses)
        assertEquals(47821, infos.port)
    }

    @Test
    fun qrCodeEtrangerRefuse() {
        assertNull(lireLienAppairage("https://example.com"))
        assertNull(lireLienAppairage("projekt://appairer?v=2&pc=ab&k=AAAA&p=1"))
        assertNull(lireLienAppairage("projekt://appairer?v=1&pc=ab&k=trop-courte&p=47821"))
    }
}
