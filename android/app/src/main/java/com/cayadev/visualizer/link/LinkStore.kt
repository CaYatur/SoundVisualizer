/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.link

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/* KAYITLI BİLGİSAYARLAR (docs/PHONE-LINK.md). Telefonun kimliği ve her bilgisayarın cihaz anahtarı
   Android Keystore'daki bir AES anahtarıyla şifreli yazılır; anahtar cihazdan çıkmaz, yedeğe
   (backup_rules) girmez. Biçim saf JSON (Codec), Keystore'suz birim testinde sınanır. */
class LinkStore(private val file: File, private val protect: Protector) {
    interface Protector {
        fun seal(plain: ByteArray): String
        fun unseal(text: String): ByteArray?
    }

    class Pc(
        val id: String, var name: String, var hosts: List<String>, var port: Int, val fingerprint: String,
        val device: String, val key: ByteArray, var level: String, var lastSeen: Long, var auto: Boolean,
    )

    var identity: LinkCrypto.Identity? = null
        private set
    val pcs = LinkedHashMap<String, Pc>()

    @Synchronized fun load() {
        pcs.clear()
        identity = null
        val text = try { if (file.exists()) AtomicFile(file).readFully().toString(Charsets.UTF_8) else "" } catch (e: Exception) { "" }
        val o = try { if (text.isEmpty()) JSONObject() else JSONObject(text) } catch (e: Exception) { JSONObject() }
        Codec.read(o, protect, this)
    }

    @Synchronized fun ensureIdentity(): LinkCrypto.Identity {
        identity?.let { return it }
        val id = LinkCrypto.newIdentity()
        identity = id
        save()
        return id
    }
    internal fun setIdentity(id: LinkCrypto.Identity?) { identity = id }

    @Synchronized fun put(pc: Pc) { pcs[pc.id] = pc; save() }
    @Synchronized fun remove(id: String) { pcs.remove(id); save() }
    @Synchronized fun touch(id: String, level: String?, hosts: List<String>?, port: Int?, name: String?) {
        val p = pcs[id] ?: return
        p.lastSeen = System.currentTimeMillis()
        if (level != null) p.level = level
        if (!hosts.isNullOrEmpty()) p.hosts = (hosts + p.hosts).distinct().take(6)
        if (port != null && port > 0) p.port = port
        if (!name.isNullOrEmpty()) p.name = name
        save()
    }

    @Synchronized fun save() {
        val af = AtomicFile(file)
        file.parentFile?.mkdirs()
        val s = af.startWrite()
        try {
            s.write(Codec.write(this, protect).toString().toByteArray(Charsets.UTF_8))
            af.finishWrite(s)
        } catch (e: Exception) { af.failWrite(s) }
    }

    /** Sayfaya giden liste: anahtarsız. */
    @Synchronized fun publicList(): JSONArray {
        val a = JSONArray()
        for (p in pcs.values) a.put(JSONObject().put("id", p.id).put("name", p.name).put("hosts", JSONArray(p.hosts)).put("port", p.port)
            .put("level", p.level).put("lastSeen", p.lastSeen).put("auto", p.auto))
        return a
    }

    object Codec {
        fun write(s: LinkStore, protect: Protector): JSONObject {
            val o = JSONObject().put("v", 1)
            s.identity?.let { o.put("identity", JSONObject().put("priv", protect.seal(LinkCrypto.scalarOf(it))).put("pub", LinkCrypto.b64u(it.pub))) }
            val a = JSONArray()
            for (p in s.pcs.values) a.put(JSONObject().put("id", p.id).put("name", p.name).put("hosts", JSONArray(p.hosts)).put("port", p.port)
                .put("fp", p.fingerprint).put("device", p.device).put("key", protect.seal(p.key)).put("level", p.level)
                .put("lastSeen", p.lastSeen).put("auto", p.auto))
            o.put("pcs", a)
            return o
        }
        fun read(o: JSONObject, protect: Protector, into: LinkStore) {
            val idj = o.optJSONObject("identity")
            if (idj != null) {
                val priv = protect.unseal(idj.optString("priv"))
                val pub = LinkCrypto.unb64u(idj.optString("pub"))
                if (priv != null && priv.size == 32 && pub != null && LinkCrypto.decodePoint(pub) != null) {
                    try { into.setIdentity(LinkCrypto.identityOf(priv, pub)) } catch (e: Exception) {}
                }
            }
            val a = o.optJSONArray("pcs") ?: JSONArray()
            for (i in 0 until a.length()) {
                val p = a.optJSONObject(i) ?: continue
                val key = protect.unseal(p.optString("key")) ?: continue
                if (key.size != 32) continue
                val hosts = p.optJSONArray("hosts")?.let { h -> (0 until h.length()).map { h.optString(it) }.filter { it.isNotEmpty() } } ?: emptyList()
                val id = p.optString("id")
                if (id.isEmpty()) continue
                into.pcs[id] = Pc(id, p.optString("name"), hosts, p.optInt("port"), p.optString("fp"), p.optString("device"), key,
                    p.optString("level", "full"), p.optLong("lastSeen"), p.optBoolean("auto", true))
            }
        }
    }

    /** Android Keystore: AES-256-GCM, anahtar cihazdan çıkmaz. Biçim "k:" + b64(iv || şifreli). */
    class KeystoreProtector : Protector {
        private val alias = "sv-link-store"
        private fun key(): SecretKey {
            val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            (ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
            val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            g.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build())
            return g.generateKey()
        }
        override fun seal(plain: ByteArray): String {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.ENCRYPT_MODE, key())
            return "k:" + LinkCrypto.b64u(c.iv + c.doFinal(plain))
        }
        override fun unseal(text: String): ByteArray? = try {
            if (!text.startsWith("k:")) null else {
                val raw = LinkCrypto.unb64u(text.substring(2)) ?: return null
                val c = Cipher.getInstance("AES/GCM/NoPadding")
                c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw.copyOfRange(0, 12)))
                c.doFinal(raw, 12, raw.size - 12)
            }
        } catch (e: Exception) { null }
    }
}
