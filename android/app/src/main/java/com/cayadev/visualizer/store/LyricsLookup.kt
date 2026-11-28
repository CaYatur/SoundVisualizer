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

    /** Tam /api/get boşsa aynı kökte arama (masaüstü lyrics-lookup.js). */
    private fun catalogGet(url: String) =
        url.contains("/api/get?", ignoreCase = true) && url.contains("artist_name=") && url.contains("track_name=")

    /** "ve" aramayı boşaltır (Athena ve smle → 0 satır). Bağlaç ve yıl düşer. */
    private fun catalogSearch(url: String, m: Meta): String {
        val base = url.substringBefore("/api/get?")
        val year = Regex("^(19|20)\\d{2}$")
        val seen = LinkedHashSet<String>()
        for (t in tokens(m.artist) + tokens(m.title)) if (!year.matches(t)) seen.add(t)
        val cleaned = seen.joinToString(" ").take(180)
        val q = cleaned.ifBlank { listOf(m.artist, m.title).filter { it.isNotBlank() }.joinToString(" ").take(180) }
        return base + "/api/search?q=" + URLEncoder.encode(q, "UTF-8").replace("+", "%20")
    }

    private val fold = mapOf(
        'ı' to 'i', 'İ' to 'i', 'ş' to 's', 'Ş' to 's', 'ğ' to 'g', 'Ğ' to 'g',
        'ü' to 'u', 'Ü' to 'u', 'ö' to 'o', 'Ö' to 'o', 'ç' to 'c', 'Ç' to 'c',
    )
    private val joins = setOf("ile", "ve", "and", "feat", "ft", "featuring", "vs", "versus", "with", "und", "et", "plus")

    private fun norm(raw: String): String {
        val b = StringBuilder()
        for (ch in raw) {
            val f = fold[ch] ?: ch
            val c = when (f) {
                in 'A'..'Z' -> f.lowercaseChar()
                else -> f
            }
            if (c in 'a'..'z' || c in '0'..'9') b.append(c)
            else if (b.isNotEmpty() && b.last() != ' ') b.append(' ')
        }
        return b.toString().trim().removePrefix("the ")
    }

    private fun tokens(s: String) = norm(s).split(' ').filter { it.length >= 2 && it !in joins }

    private fun edit(a: String, b: String): Int {
        if (a.isEmpty()) return b.length
        if (b.isEmpty()) return a.length
        if (kotlin.math.abs(a.length - b.length) > 2) return 3
        val row = IntArray(b.length + 1) { it }
        for (i in 1..a.length) {
            var prev = row[0]
            row[0] = i
            for (j in 1..b.length) {
                val cur = row[j]
                val cost = if (a[i - 1] == b[j - 1]) 0 else 1
                row[j] = minOf(row[j] + 1, row[j - 1] + 1, prev + cost)
                prev = cur
            }
        }
        return row[b.length]
    }

    private fun nameClose(a: String, b: String): Boolean {
        if (a.isEmpty() || b.isEmpty()) return false
        if (a == b) return true
        val short = if (a.length <= b.length) a else b
        val long = if (a.length <= b.length) b else a
        if (short.length >= 4 && long.contains(short)) return true
        val lim = if (maxOf(a.length, b.length) >= 8) 2 else 1
        return minOf(a.length, b.length) >= 4 && edit(a, b) <= lim
    }

    /** Başlık oturur; yıl, bağlaç ve tekrarlanan başlık sanatçıdan düşer. Çok ad örtüşen kazanır. */
    fun pickHit(title: String, artist: String, duration: Double, rows: JSONArray): String {
        val qTitle = norm(title)
        if (qTitle.isEmpty()) return ""
        val titleSet = tokens(title).toSet()
        val need = tokens(artist).filter { it !in titleSet && !Regex("^(19|20)\\d{2}$").matches(it) }
        var bestScore = Double.NEGATIVE_INFINITY
        var best = ""
        for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: continue
            val rawTitle = row.optString("trackName").ifEmpty { row.optString("title") }
            val nt = norm(rawTitle)
            if (nt.isEmpty() || nt != qTitle) continue
            var cover = 1.0
            if (need.isNotEmpty()) {
                val have = tokens(row.optString("artistName").ifEmpty { row.optString("artist") }).toMutableList()
                var n = 0
                for (q in need) {
                    val idx = have.indexOfFirst { nameClose(q, it) }
                    if (idx >= 0) { have.removeAt(idx); n++ }
                }
                cover = n.toDouble() / need.size
                if (cover <= 0) continue
            }
            val synced = row.optString("syncedLyrics").trim()
            val plain = row.optString("plainLyrics").ifEmpty { row.optString("lyrics") }.trim()
            val text = synced.ifEmpty { plain }
            if (!plausible(text)) continue
            var score = cover * 10
            if (synced.isNotEmpty()) score += 0.4
            val dur = row.optDouble("duration", 0.0)
            if (duration > 0 && dur > 0) {
                val d = kotlin.math.abs(duration - dur)
                score += if (d <= 3) 0.6 else if (d <= 8) 0.2 else -0.4
            }
            if (score > bestScore) { bestScore = score; best = text }
        }
        return best
    }

    /** Ağ isteği (ayrı iş parçacığında çağrılmalı). */
    fun fetch(p: Provider, m: Meta, timeoutMs: Int, get: (String, String, Int) -> String? = ::httpGet): String? {
        val url = fillTemplate(p.url, m)
        if (!Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(url)) return null
        val body = try { get(url, if (p.format == "json") "application/json" else "text/plain", timeoutMs) } catch (_: Exception) { null }
        if (!body.isNullOrEmpty() && body.length <= MAX_BYTES) {
            if (p.format == "json") {
                val v = try { pickPath(JSONTokener(body).nextValue(), p.path) } catch (_: Exception) { null }
                val hit = (v as? String)?.takeIf { plausible(it) }
                if (hit != null) return hit
            } else if (plausible(body)) return body
        }
        if (!catalogGet(p.url)) return null
        val raw = try { get(catalogSearch(p.url, m), "application/json", timeoutMs) } catch (_: Exception) { null } ?: return null
        if (raw.isEmpty() || raw.length > MAX_BYTES) return null
        val rows = try { JSONTokener(raw).nextValue() as? JSONArray } catch (_: Exception) { null } ?: return null
        return pickHit(m.title, m.artist, m.duration, rows).takeIf { plausible(it) }
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
