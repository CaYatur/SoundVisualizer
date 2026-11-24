/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.link

import java.math.BigInteger
import java.nio.ByteBuffer
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPrivateKeySpec
import java.security.spec.ECPublicKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/* PC BAĞLANTISININ YAPI TAŞLARI (docs/PHONE-LINK.md). Masaüstündeki src/main/phone-link.js ile
   bayt bayt aynı: ECDH P-256 (sıkıştırılmamış 65 bayt nokta), HMAC-SHA256, HKDF-SHA256, altı
   rakamlı doğrulama sayısı, yön başına AES-256-GCM zarf. Eşlik, Node'un ürettiği sabit
   örneklerle sınanır (src/test/.../link/LinkCryptoTest.kt). Bağımlılık yok, yalnız JCA. */
object LinkCrypto {
    private const val CURVE = "secp256r1"

    class Identity(val priv: ECPrivateKey, val pub: ByteArray)

    private val params: ECParameterSpec by lazy {
        val g = KeyPairGenerator.getInstance("EC")
        g.initialize(ECGenParameterSpec(CURVE))
        (g.generateKeyPair().public as ECPublicKey).params
    }

    fun newIdentity(): Identity {
        val g = KeyPairGenerator.getInstance("EC")
        g.initialize(ECGenParameterSpec(CURVE))
        val kp = g.generateKeyPair()
        return Identity(kp.private as ECPrivateKey, encodePoint(kp.public as ECPublicKey))
    }

    /** Saklanan 32 baytlık gizli sayı + açık anahtardan kimlik. */
    fun identityOf(scalar: ByteArray, pub: ByteArray): Identity {
        val kf = KeyFactory.getInstance("EC")
        val priv = kf.generatePrivate(ECPrivateKeySpec(BigInteger(1, scalar), params)) as ECPrivateKey
        return Identity(priv, pub)
    }

    fun scalarOf(id: Identity): ByteArray = fixed(id.priv.s.toByteArray(), 32)

    private fun fixed(b: ByteArray, n: Int): ByteArray = when {
        b.size == n -> b
        b.size > n -> b.copyOfRange(b.size - n, b.size)
        else -> ByteArray(n - b.size) + b
    }

    fun encodePoint(k: ECPublicKey): ByteArray =
        byteArrayOf(0x04) + fixed(k.w.affineX.toByteArray(), 32) + fixed(k.w.affineY.toByteArray(), 32)

    /** 65 baytlık sıkıştırılmamış nokta → anahtar; eğri dışındaysa null.
        JCA noktanın eğri üstünde olduğunu DENETLEMİYOR (sınamada ölçüldü): eğri dışı nokta
        ECDH'de gizli anahtardan bilgi sızdırabilir, bu yüzden y² = x³ + ax + b (mod p) burada. */
    fun decodePoint(raw: ByteArray): ECPublicKey? {
        if (raw.size != 65 || raw[0] != 0x04.toByte()) return null
        return try {
            val x = BigInteger(1, raw.copyOfRange(1, 33))
            val y = BigInteger(1, raw.copyOfRange(33, 65))
            val curve = params.curve
            val p = (curve.field as java.security.spec.ECFieldFp).p
            if (x.signum() < 0 || y.signum() < 0 || x >= p || y >= p) return null
            val left = y.multiply(y).mod(p)
            val right = x.multiply(x).multiply(x).add(curve.a.multiply(x)).add(curve.b).mod(p)
            if (left != right) return null
            KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(ECPoint(x, y), params)) as ECPublicKey
        } catch (e: Exception) { null }
    }

    fun sharedSecret(id: Identity, otherPub: ByteArray): ByteArray {
        val other = decodePoint(otherPub) ?: throw IllegalArgumentException("bad-key")
        val ka = KeyAgreement.getInstance("ECDH")
        ka.init(id.priv)
        ka.doPhase(other, true)
        return fixed(ka.generateSecret(), 32)
    }

    fun sha256(vararg parts: ByteArray): ByteArray {
        val md = MessageDigest.getInstance("SHA-256")
        for (p in parts) md.update(p)
        return md.digest()
    }

    fun hmac(key: ByteArray, vararg parts: ByteArray): ByteArray {
        val m = Mac.getInstance("HmacSHA256")
        m.init(SecretKeySpec(key, "HmacSHA256"))
        for (p in parts) m.update(p)
        return m.doFinal()
    }
    fun hmac(key: ByteArray, label: String, vararg parts: ByteArray): ByteArray = hmac(key, label.toByteArray(Charsets.UTF_8), *parts)

    /** RFC 5869. Node `crypto.hkdfSync('sha256', ikm, salt, info, len)` ile aynı. */
    fun hkdf(ikm: ByteArray, salt: ByteArray, info: String, len: Int = 32): ByteArray {
        val prk = hmac(if (salt.isEmpty()) ByteArray(32) else salt, ikm)
        val out = ByteArray(len)
        var t = ByteArray(0)
        var pos = 0
        var i = 1
        while (pos < len) {
            t = hmac(prk, t, info.toByteArray(Charsets.UTF_8), byteArrayOf(i.toByte()))
            val n = minOf(t.size, len - pos)
            System.arraycopy(t, 0, out, pos, n)
            pos += n
            i++
        }
        return out
    }

    fun fingerprint(pub: ByteArray): ByteArray = sha256("sv-link-fp".toByteArray(), pub).copyOfRange(0, 16)

    fun sasDigits(devPub: ByteArray, pcPub: ByteArray, np: ByteArray, nc: ByteArray): String {
        val h = sha256("sv-link-sas".toByteArray(), devPub, pcPub, np, nc)
        val v = ByteBuffer.wrap(h, 0, 4).int.toLong() and 0xffffffffL
        return (v % 1000000L).toString().padStart(6, '0')
    }

    fun deviceKey(shared: ByteArray, devPub: ByteArray, pcPub: ByteArray, np: ByteArray, nc: ByteArray): ByteArray =
        hkdf(shared, np + nc, "sv-link-device|" + b64u(sha256(devPub, pcPub)), 32)

    class SessionKeys(val c2p: ByteArray, val p2c: ByteArray)
    fun sessionKeys(devKey: ByteArray, np: ByteArray, nc: ByteArray): SessionKeys = SessionKeys(
        hkdf(devKey, np + nc, "sv-link-session|phone-to-pc", 32),
        hkdf(devKey, np + nc, "sv-link-session|pc-to-phone", 32),
    )

    private val DIR_C2P = byteArrayOf('c'.code.toByte(), '2'.code.toByte(), 'p'.code.toByte(), 0)
    private val DIR_P2C = byteArrayOf('p'.code.toByte(), '2'.code.toByte(), 'c'.code.toByte(), 0)

    /** Telefon → PC zarfı. Sayaç her çağrıda artar. */
    class Sealer(private val key: ByteArray, private val dir: ByteArray) {
        private var ctr = 0L
        @Synchronized fun seal(plain: ByteArray): ByteArray {
            ctr += 1
            val c = ByteBuffer.allocate(8).putLong(ctr).array()
            val iv = dir + c
            val ci = Cipher.getInstance("AES/GCM/NoPadding")
            ci.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
            ci.updateAAD(iv)
            return c + ci.doFinal(plain)
        }
    }
    /** PC → telefon zarfını açar; sayaç geri giderse ya da doğrulanmazsa null. */
    class Opener(private val key: ByteArray, private val dir: ByteArray) {
        private var last = 0L
        @Synchronized fun open(frame: ByteArray): ByteArray? {
            if (frame.size < 8 + 16) return null
            val ctr = ByteBuffer.wrap(frame, 0, 8).long
            if (java.lang.Long.compareUnsigned(ctr, last) <= 0) return null
            val iv = dir + frame.copyOfRange(0, 8)
            return try {
                val de = Cipher.getInstance("AES/GCM/NoPadding")
                de.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
                de.updateAAD(iv)
                val out = de.doFinal(frame, 8, frame.size - 8)
                last = ctr
                out
            } catch (e: Exception) { null }
        }
    }
    fun phoneSealer(k: SessionKeys) = Sealer(k.c2p, DIR_C2P)
    fun phoneOpener(k: SessionKeys) = Opener(k.p2c, DIR_P2C)

    fun b64u(b: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(b)
    fun unb64u(s: String?): ByteArray? = try {
        if (s == null || !Regex("^[A-Za-z0-9_-]*$").matches(s) || s.length > 4096) null else Base64.getUrlDecoder().decode(s)
    } catch (e: Exception) { null }

    fun randomBytes(n: Int): ByteArray = ByteArray(n).also { java.security.SecureRandom().nextBytes(it) }
}
