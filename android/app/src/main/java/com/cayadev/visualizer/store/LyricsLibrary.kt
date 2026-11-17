/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.store

import java.io.File
import java.io.InputStream
import java.security.SecureRandom
import org.json.JSONArray
import org.json.JSONObject

/* SÖZ KİTAPLIĞI (Faz 4). Masaüstündeki src/main/lyrics-library.js'in kuralları:
   - Metin ayar dosyasına yazılmaz; `lyrics-library/` klasöründe, her söz kendi dosyasında,
     liste `manifest.json`'da ({ items: [{ id, name, file, artist, title, size, createdAt }] }).
   - Yalnız .lrc, .srt, .txt; en çok 1 MB; UTF-8 (baştaki BOM atılır); NUL içeren dosya söz değil.
   - Aynı metin ikinci kez eklenmez (aynı boy ve aynı metin: DUPLICATE).
   - Sanatçı ve parça adı içe aktarılırken LRC etiketlerinden ([ar:], [ti:]) ya da dosya adından
     ("Sanatçı - Parça") tahmin edilir (masaüstündeki lyrics-sync.js guessMeta).
   Masaüstü yedeğindeki `lyrics-library/` aynı biçimde olduğu için olduğu gibi okunur. */
class LyricsLibrary(val dir: File) {
    companion object {
        val EXT = listOf(".lrc", ".srt", ".txt")
        const val MAX_BYTES = 1024 * 1024
        private val rnd = SecureRandom()

        fun isLyricFile(name: String): Boolean = EXT.any { name.lowercase().endsWith(it) }
        fun extOf(name: String): String = EXT.firstOrNull { name.lowercase().endsWith(it) } ?: ""

        fun safeId(id: String?): String = (id ?: "").replace(Regex("[^A-Za-z0-9_-]"), "").take(80)

        fun newId(): String {
            val b = ByteArray(4)
            rnd.nextBytes(b)
            return "lyr_" + java.lang.Long.toString(System.currentTimeMillis(), 36) + "_" + b.joinToString("") { "%02x".format(it) }
        }

        /** UTF-8 metin; BOM atılır, NUL varsa null (söz değil). */
        fun decode(bytes: ByteArray): String? {
            var s = String(bytes, Charsets.UTF_8)
            if (s.isNotEmpty() && s[0].code == 0xFEFF) s = s.substring(1)
            return if (s.indexOf('\u0000') >= 0) null else s
        }

        /* LRC başlık etiketleri (masaüstündeki lyrics.js parse → meta). */
        private val TAG = Regex("^\\s*\\[(ar|artist|ti|title):([^\\]]*)]\\s*$", setOf(RegexOption.IGNORE_CASE, RegexOption.MULTILINE))

        /** Masaüstündeki guessMeta: önce etiketler, sonra "Sanatçı - Parça" dosya adı. */
        fun guessMeta(text: String, fileName: String): Pair<String, String> {
            var artist = ""
            var title = ""
            for (m in TAG.findAll(text)) {
                val k = m.groupValues[1].lowercase()
                val v = m.groupValues[2].trim()
                if ((k == "ar" || k == "artist") && artist.isEmpty()) artist = v
                if ((k == "ti" || k == "title") && title.isEmpty()) title = v
            }
            val base = fileName.replace(Regex("\\.[^.]+$"), "").trim()
            val parts = base.split(Regex("\\s+[-–—]\\s+"))
            if (artist.isEmpty() && parts.size >= 2) artist = parts[0].trim()
            if (title.isEmpty()) title = (if (parts.size >= 2) parts.drop(1).joinToString(" - ") else base).trim()
            return artist.take(200) to title.take(200)
        }
    }

    private val manifest get() = File(dir, "manifest.json")

    @Synchronized
    fun items(): MutableList<JSONObject> {
        return try {
            val a = JSONObject(manifest.readText()).optJSONArray("items") ?: JSONArray()
            (0 until a.length()).mapNotNull { a.optJSONObject(it) }.filter { it.optString("id").isNotEmpty() }.toMutableList()
        } catch (_: Exception) {
            mutableListOf()
        }
    }

    @Synchronized
    private fun save(items: List<JSONObject>) {
        dir.mkdirs()
        val tmp = File(dir, "manifest.json.tmp")
        tmp.writeText(JSONObject().put("items", JSONArray(items)).toString(2))
        if (!tmp.renameTo(manifest)) { manifest.delete(); tmp.renameTo(manifest) }
    }

    fun public(it: JSONObject): JSONObject = JSONObject()
        .put("id", it.optString("id"))
        .put("name", it.optString("name"))
        .put("artist", it.optString("artist"))
        .put("title", it.optString("title"))
        .put("size", it.optLong("size"))
        .put("createdAt", it.optLong("createdAt"))

    /* Kimlikten dosya: yalnız bu klasörde, düz bir ad, söz uzantısı. */
    private fun fileOf(it: JSONObject): File? {
        val f = it.optString("file")
        if (f.isEmpty() || f.contains('/') || f.contains('\\') || f == "." || f == ".." || !isLyricFile(f)) return null
        val file = File(dir, f)
        return if (file.isFile && file.length() <= MAX_BYTES && file.canonicalFile.parentFile == dir.canonicalFile) file else null
    }

    fun list(): JSONArray = JSONArray(items().map { public(it) })

    fun read(id: String): JSONObject? {
        val sid = safeId(id)
        val it = items().firstOrNull { x -> x.optString("id") == sid } ?: return null
        val f = fileOf(it) ?: return null
        val text = decode(f.readBytes()) ?: return null
        return JSONObject().put("id", sid).put("name", it.optString("name")).put("artist", it.optString("artist"))
            .put("title", it.optString("title")).put("text", text)
    }

    /** Motorun eşleştirdiği liste: metinleriyle. */
    fun snapshot(): JSONArray = JSONArray(items().mapNotNull { read(it.optString("id")) })

    /**
     * Bir söz ekler. [name] gösterilen ad (uzantılı dosya adı da olabilir). Dönüş:
     * { ok, item } ya da { ok:false, error: TYPE | SIZE | DUPLICATE | READ, item? }.
     */
    @Synchronized
    fun add(fileName: String, bytes: ByteArray, artist: String? = null, title: String? = null): JSONObject {
        val ext = extOf(fileName).ifEmpty { if (artist != null || title != null) ".lrc" else "" }
        if (ext.isEmpty()) return JSONObject().put("ok", false).put("error", "TYPE")
        if (bytes.isEmpty() || bytes.size > MAX_BYTES) return JSONObject().put("ok", false).put("error", "SIZE")
        val text = decode(bytes) ?: return JSONObject().put("ok", false).put("error", "TYPE")
        if (text.isBlank()) return JSONObject().put("ok", false).put("error", "SIZE")
        val list = items()
        for (it in list) {
            if (it.optLong("size") != bytes.size.toLong()) continue
            val f = fileOf(it) ?: continue
            if (decode(f.readBytes()) == text) return JSONObject().put("ok", false).put("error", "DUPLICATE").put("item", public(it))
        }
        val guess = guessMeta(text, fileName)
        val id = newId()
        dir.mkdirs()
        File(dir, id + ext).writeBytes(bytes)
        val stem = fileName.replace(Regex("\\.(lrc|srt|txt)$", RegexOption.IGNORE_CASE), "")
        val item = JSONObject()
            .put("id", id)
            .put("name", stem.ifBlank { id })
            .put("file", id + ext)
            .put("artist", (artist ?: guess.first).take(200))
            .put("title", (title ?: guess.second).take(200))
            .put("size", bytes.size)
            .put("createdAt", System.currentTimeMillis())
        list.add(0, item)
        save(list)
        return JSONObject().put("ok", true).put("item", public(item))
    }

    /** Birden çok dosya (belge seçiciden): { added:[item], duplicates, failed }. */
    fun importAll(files: List<Pair<String, () -> InputStream?>>): JSONObject {
        val added = JSONArray()
        var dup = 0
        var failed = 0
        for ((name, open) in files) {
            val bytes = try {
                open()?.use { s -> readCapped(s) }
            } catch (_: Exception) { null }
            if (bytes == null) { failed++; continue }
            val r = add(name, bytes)
            when {
                r.optBoolean("ok") -> added.put(r.getJSONObject("item"))
                r.optString("error") == "DUPLICATE" -> dup++
                else -> failed++
            }
        }
        return JSONObject().put("added", added).put("duplicates", dup).put("failed", failed)
    }

    private fun readCapped(s: InputStream): ByteArray? {
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(16 * 1024)
        while (true) {
            val n = s.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
            if (out.size() > MAX_BYTES) return null
        }
        return out.toByteArray()
    }

    @Synchronized
    fun update(id: String, patch: JSONObject): JSONObject {
        val sid = safeId(id)
        val list = items()
        val it = list.firstOrNull { x -> x.optString("id") == sid } ?: return JSONObject().put("ok", false).put("error", "MISSING")
        if (patch.has("artist")) it.put("artist", patch.optString("artist").take(200))
        if (patch.has("title")) it.put("title", patch.optString("title").take(200))
        if (patch.has("name")) it.put("name", patch.optString("name").take(200).ifBlank { it.optString("name") })
        if (patch.has("text")) {
            var body = patch.optString("text")
            if (body.isNotEmpty() && body[0].code == 0xFEFF) body = body.substring(1)
            if (body.indexOf('\u0000') >= 0) return JSONObject().put("ok", false).put("error", "TYPE")
            val bytes = body.toByteArray(Charsets.UTF_8)
            if (bytes.isEmpty() || bytes.size > MAX_BYTES) return JSONObject().put("ok", false).put("error", "SIZE")
            val f = fileOf(it) ?: return JSONObject().put("ok", false).put("error", "MISSING")
            f.writeBytes(bytes)
            it.put("size", bytes.size)
        }
        save(list)
        return JSONObject().put("ok", true).put("item", public(it))
    }

    @Synchronized
    fun remove(id: String): JSONObject {
        val sid = safeId(id)
        val list = items()
        val it = list.firstOrNull { x -> x.optString("id") == sid }
        if (it != null) {
            fileOf(it)?.delete()
            list.remove(it)
            save(list)
        }
        return JSONObject().put("ok", true)
    }
}
