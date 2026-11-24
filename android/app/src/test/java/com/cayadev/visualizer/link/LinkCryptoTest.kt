/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.link

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/* Masaüstüyle bayt bayt eşlik: örnekleri src/main/phone-link.js üretti
   (android/tools/link-vectors.js). Telefon aynı girdiden aynı anahtarı, kanıtı, sayıyı ve
   şifreli kareyi bulamazsa iki uç birbirini anlamaz. */
class LinkCryptoTest {
    private val v: JSONObject = JSONObject(javaClass.classLoader!!.getResourceAsStream("link-vectors.json")!!.readBytes().toString(Charsets.UTF_8))
    private fun h(k: String): ByteArray = v.getString(k).chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    private val ph = LinkCrypto.identityOf(h("phPriv"), h("phPub"))
    private val pc = LinkCrypto.identityOf(h("pcPriv"), h("pcPub"))

    @Test fun ortakSirIkiYondenAyni() {
        assertArrayEquals(h("shared"), LinkCrypto.sharedSecret(ph, h("pcPub")))
        assertArrayEquals(h("shared"), LinkCrypto.sharedSecret(pc, h("phPub")))
    }

    @Test fun anahtarlarKanitlarVeSayi() {
        val np = h("np"); val nc = h("nc")
        val devKey = LinkCrypto.deviceKey(h("shared"), h("phPub"), h("pcPub"), np, nc)
        assertArrayEquals(h("devKey"), devKey)
        val k = LinkCrypto.sessionKeys(devKey, np, nc)
        assertArrayEquals(h("c2p"), k.c2p)
        assertArrayEquals(h("p2c"), k.p2c)
        assertEquals(v.getString("fingerprint"), LinkCrypto.b64u(LinkCrypto.fingerprint(h("pcPub"))))
        assertEquals(v.getString("sas"), LinkCrypto.sasDigits(h("phPub"), h("pcPub"), np, nc))
        assertArrayEquals(h("qrPhoneMac"), LinkCrypto.hmac(h("secret"), "sv-link-qr|phone|", h("phPub"), np))
        assertArrayEquals(h("qrPcMac"), LinkCrypto.hmac(h("secret"), "sv-link-qr|pc|", h("pcPub"), nc, h("phPub")))
        assertArrayEquals(h("codeProof"), LinkCrypto.hmac(v.getString("code").toByteArray(), "sv-link-code|", h("phPub")))
        assertArrayEquals(h("commit"), LinkCrypto.hmac(nc, "sv-link-commit|", h("pcPub"), h("phPub")))
        assertArrayEquals(h("resumeProof"), LinkCrypto.hmac(devKey, "sv-link-resume|phone|", np))
        assertArrayEquals(h("welcomeProof"), LinkCrypto.hmac(devKey, "sv-link-resume|pc|", np, nc))
        assertArrayEquals(h("hkdfLong"), LinkCrypto.hkdf(devKey, np, "uzun", 80))
    }

    @Test fun zarfEslikVeYenidenOynatma() {
        val k = LinkCrypto.SessionKeys(h("c2p"), h("p2c"))
        val s = LinkCrypto.phoneSealer(k)
        s.seal("ilk".toByteArray())
        assertArrayEquals(h("sealedC2pCtr2"), s.seal(v.getString("plain").toByteArray()))
        val o = LinkCrypto.phoneOpener(k)
        val frame = h("sealedP2cCtr1")
        assertEquals("{\"re\":\"1\",\"ok\":true}", String(o.open(frame)!!))
        assertNull("aynı kare ikinci kez", o.open(frame))
        val bad = h("sealedP2cCtr1").also { it[12] = (it[12].toInt() xor 1).toByte() }
        assertNull(LinkCrypto.phoneOpener(k).open(bad))
    }

    @Test fun noktaKodlamaVeYeniKimlik() {
        val id = LinkCrypto.newIdentity()
        assertEquals(65, id.pub.size)
        assertNotNull(LinkCrypto.decodePoint(id.pub))
        val back = LinkCrypto.identityOf(LinkCrypto.scalarOf(id), id.pub)
        assertArrayEquals(LinkCrypto.sharedSecret(id, h("pcPub")), LinkCrypto.sharedSecret(back, h("pcPub")))
        assertNull(LinkCrypto.decodePoint(ByteArray(65).also { it[0] = 4; it[1] = 1 }))
        assertNull(LinkCrypto.unb64u("a+b"))
    }
}
