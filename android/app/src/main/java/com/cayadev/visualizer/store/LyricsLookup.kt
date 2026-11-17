/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.store

import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

/* OTOMATİK SÖZ BULMA (masaüstündeki src/main/lyrics-lookup.js, #937).

   Sıra: önbellek → kullanıcının TANIMLADIĞI sağlayıcılar (yukarıdan aşağı, süre sınırlı).
   Sağlayıcı listesi varsayılan BOŞ; liste boşken hiçbir ağ isteği yapılmaz. Bulunan söz
   önbelleğe yazılır, aynı parça için ağa ikinci kez çıkılmaz. Hiçbir adım hata atmaz.

   Telefonda yan dosya (.lrc aynı klasörde) yok: çalan parçanın dosya yolu bilinmiyor
   (masaüstünde de canlı parça için yok, yalnız dışa aktarımda). Ağ isteği ana iş
   parçacığında yapılmaz (çağıran ayrı iş parçacığında). */
object LyricsLookup {
    private const val MAX_BYTES = 1024 * 1024
    private const val MAX_PROVIDERS = 8

    data class Provider(val name: String, val url: String, val enabled: Boolean, val format: String, val path: String)
    data class Config(val enabled: Boolean, val cache: Boolean, val providers: List<Provider>, val timeoutMs: Int)

    fun sanitize(raw: JSONObject?): Config {
        val c = raw ?: JSONObject()
        val list = c.optJSONArray("providers") ?: JSONArray()
        val providers = (0 until minOf(list.length(), MAX_PROVIDERS)).mapNotNull { i ->
            val p = list.optJSONObject(i) ?: return@mapNotNull null
            val url = p.optString("url").trim()
            if (!Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(url)) return@mapNotNull null
            Provider(
                name = p.optString("name").take(60),
                url = url.take(1000),
                enabled = p.optBoolean("enabled", true),
                format = if (p.optString("format") == "json") "json" else "lrc",
                path = p.optString("path").take(200),
            )
        }
        val t = c.optDouble("timeoutMs", Double.NaN)
        return Config(
            enabled = c.optBoolean("enabled", false),
            cache = c.optBoolean("cache", true),
            providers = providers,
            timeoutMs = if (!t.isNaN() && t >= 500) minOf(20000.0, t).toInt() else 4000,
        )
    }

    data class Meta(val title: String, val artist: String, val album: String, val duration: Double)

    /** {artist} {title} {album} {duration} URL kodlanarak; bilinmeyen yer tutucu boş. */
    fun fillTemplate(url: String, m: Meta): String = Regex("\\{(\\w+)\\}").replace(url) { r ->
        val v = when (r.groupValues[1]) {
            "artist" -> m.artist
            "title" -> m.title
            "album" -> m.album
            "duration" -> if (m.duration > 0) Math.round(m.duration).toString() else ""
            else -> ""
        }
        // encodeURIComponent gibi: boşluk %20
        URLEncoder.encode(v, "UTF-8").replace("+", "%20").replace("%21", "!").replace("%27", "'")
            .replace("%28", "(").replace("%29", ")").replace("%7E", "~")
    }

    /** "a.b.0.c": JSON içinde nokta yolu; dizi sırası sayıyla. */
    fun pickPath(root: Any?, path: String): Any? {
        if (path.isEmpty()) return root
        var cur: Any? = root
        for (k in path.split('.')) {
            cur = when (cur) {
                is JSONObject -> if (cur.has(k)) cur.opt(k) else null
                is JSONArray -> k.toIntOrNull()?.let { cur.opt(it) }
                else -> null
            }
            if (cur == null || cur == JSONObject.NULL) return null
        }
        return cur
    }

    fun looksLikeLyrics(s: String?): Boolean { val t = (s ?: "").trim(); return t.isNotEmpty() && t.length <= MAX_BYTES }

    // Sağlayıcı 200 ile hata sayfası da dönebilir: biçimlendirme söz değil, önbelleğe de girmez
    fun plausible(s: String?): Boolean =
        looksLikeLyrics(s) && !Regex("^\\s*(?:<(?:!doctype|html|\\?xml|head|body)\\b|\\{)", RegexOption.IGNORE_CASE).containsMatchIn(s!!)

    fun cacheKey(m: Meta): String {
        val norm = { s: String -> s.trim().lowercase() }
        if (norm(m.title).isEmpty()) return ""
        val d = MessageDigest.getInstance("SHA-1").digest(listOf(norm(m.artist), norm(m.title), norm(m.album)).joinToString("\u0001").toByteArray(Charsets.UTF_8))
        return d.joinToString("") { "%02x".format(it) }.take(24)
    }

    fun readCache(dir: File, m: Meta): String? {
        val k = cacheKey(m)
        if (k.isEmpty()) return null
        return try { File(dir, "$k.lrc").readText().takeIf { looksLikeLyrics(it) } } catch (_: Exception) { null }
    }

    fun writeCache(dir: File, m: Meta, text: String): Boolean {
        val k = cacheKey(m)
        if (k.isEmpty() || !looksLikeLyrics(text)) return false
        return try {
            dir.mkdirs()
            val f = File(dir, "$k.lrc")
            val tmp = File(dir, "$k.lrc.tmp")
            tmp.writeText(text)
            tmp.renameTo(f) || run { f.delete(); tmp.renameTo(f) }
        } catch (_: Exception) { false }
    }

    /** Yalnız önbellek dosyaları silinir (anahtar biçimi: cacheKey). */
    fun clearCache(dir: File): Int {
        var n = 0
        for (f in dir.listFiles() ?: emptyArray()) {
            if (Regex("^[0-9a-f]{24}\\.lrc$").matches(f.name) && f.delete()) n++
        }
        return n
    }

    /** Ağ isteği (ayrı iş parçacığında çağrılmalı). */
    fun fetch(p: Provider, m: Meta, timeoutMs: Int, get: (String, String, Int) -> String? = ::httpGet): String? {
        val url = fillTemplate(p.url, m)
        if (!Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(url)) return null
        val body = try { get(url, if (p.format == "json") "application/json" else "text/plain", timeoutMs) } catch (_: Exception) { null } ?: return null
        if (body.isEmpty() || body.length > MAX_BYTES) return null
        if (p.format == "json") {
            val v = try { pickPath(JSONTokener(body).nextValue(), p.path) } catch (_: Exception) { null }
            return (v as? String)?.takeIf { plausible(it) }
        }
        return body.takeIf { plausible(it) }
    }

    fun httpGet(url: String, accept: String, timeoutMs: Int): String? {
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = timeoutMs
            c.readTimeout = timeoutMs
            c.instanceFollowRedirects = true
            c.setRequestProperty("Accept", accept)
            // Genel istemci adı: kullanıcıya ait bilgi gönderilmez
            c.setRequestProperty("User-Agent", "SoundVisualizer-Android (https://github.com/CaYatur/SoundVisualizer)")
            if (c.responseCode !in 200..299) return null
            val len = c.contentLengthLong
            if (len > MAX_BYTES) return null
            val bytes = c.inputStream.use { s ->
                val out = java.io.ByteArrayOutputStream()
                val buf = ByteArray(16 * 1024)
                while (true) {
                    val n = s.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    if (out.size() > MAX_BYTES) return null
                }
                out.toByteArray()
            }
            return String(bytes, Charsets.UTF_8)
        } finally {
            c.disconnect()
        }
    }

    /** Dönüş: { text, source: 'cache' | 'provider', provider? } ya da null. */
    fun lookup(rawConfig: JSONObject?, m: Meta, cacheDir: File, get: (String, String, Int) -> String? = ::httpGet): JSONObject? {
        val cfg = sanitize(rawConfig)
        if (!cfg.enabled || m.title.isBlank()) return null
        if (cfg.cache) readCache(cacheDir, m)?.let { return JSONObject().put("text", it).put("source", "cache") }
        for (p in cfg.providers) {
            if (!p.enabled) continue
            val text = fetch(p, m, cfg.timeoutMs, get) ?: continue
            if (cfg.cache) writeCache(cacheDir, m, text)
            return JSONObject().put("text", text).put("source", "provider").put("provider", p.name.ifEmpty { p.url })
        }
        return null
    }
}
