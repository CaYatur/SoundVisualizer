/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.store

import java.io.File
import java.net.URLEncoder
import org.json.JSONArray
import org.json.JSONObject

/* MASAÜSTÜ YEDEĞİNDEKİ KİTAPLIKLAR (Faz 4; masaüstündeki src/main/full-backup.js restore).

   Geri yükleme eklemeli: yedekteki öğe aynı kimlikle yazılır, aynı kimlik yerelde varsa
   yedektekiyle değişir, yedekte olmayan yerel öğeler silinmez (upsertManifest).
   - Söz kitaplığı → `lyrics-library/` (telefonun söz kitaplığı aynı biçim, LyricsLibrary).
   - Logo kitaplığı → `logo-library/` (motor logo katmanını `logoLibRead` ile okur).
   - Video kitaplığı → `media/lib-media/`, kitaplık dışı videolar → `media/restored/`;
     ikisi de `/files/` adresinden sayfaya açık (WebShell). Sahnelerdeki eski yollar
     (`ref`) yeni adrese eşlenir: tablo sayfaya döner, sayfa ayarı eşler (remapMedia).
   Arşiv güvenilmez veri: kimlik ve dosya adı denetlenir, hiçbir yol arşivden alınmaz. */
object LibraryRestore {
    private val SAFE_ID = Regex("^[A-Za-z0-9_-]{1,80}$")
    private val MEDIA_PATH = Regex("^media/(\\d{1,6}-[a-z0-9._-]{1,120})$")
    val EXT = mapOf(
        "logos" to listOf(".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"),
        "media" to listOf(".mp4", ".m4v", ".webm", ".mkv", ".mov", ".avi"),
        "lyrics" to listOf(".lrc", ".srt", ".txt"),
    )

    /** full-backup.js plainName: düz, kısa, ayırıcısız ad. */
    fun plainName(n: String): Boolean =
        n.isNotEmpty() && n.length <= 200 && !Regex("[\\\\/:\\u0000]").containsMatchIn(n) && n != "." && n != ".."

    fun isFile(key: String, name: String): Boolean = EXT[key]?.any { name.lowercase().endsWith(it) } == true

    fun upsertManifest(dir: File, items: List<JSONObject>) {
        val file = File(dir, "manifest.json")
        val list = try {
            val a = JSONObject(file.readText()).optJSONArray("items") ?: JSONArray()
            (0 until a.length()).mapNotNull { a.optJSONObject(it) }
        } catch (_: Exception) { emptyList() }
        val ids = items.map { it.optString("id") }.toSet()
        val next = items + list.filter { it.optString("id") !in ids }
        dir.mkdirs()
        val tmp = File(dir, "manifest.json.tmp")
        tmp.writeText(JSONObject().put("items", JSONArray(next)).toString(2))
        if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
    }

    private fun move(src: File, dst: File) {
        dst.parentFile?.mkdirs()
        // Aynı boyutta dosya zaten varsa (yeniden içe aktarma) olduğu gibi kalır
        if (dst.isFile && dst.length() == src.length()) { src.delete(); return }
        if (dst.exists()) dst.delete()
        if (!src.renameTo(dst)) { src.copyTo(dst, overwrite = true); src.delete() }
    }

    private fun enc(s: String): String = URLEncoder.encode(s, "UTF-8").replace("+", "%20")

    /**
     * [staging]: BackupReader'ın klasörü (backup.json, libs/, media/). [filesDir]: uygulamanın
     * klasörü. [origin]: sayfanın adresi (https://appassets.androidplatform.net). [only]: işlenecek
     * kitaplıklar (logos, media, lyrics); kitaplık dışı videolar `media` ile gelir.
     * Dönüş: { logos, media, lyrics, videos, skipped, map: { eski yol → yeni adres } }.
     */
    fun restore(staging: File, filesDir: File, origin: String, only: Set<String>? = null): JSONObject {
        val counts = linkedMapOf("logos" to 0, "media" to 0, "lyrics" to 0, "videos" to 0, "skipped" to 0)
        val map = JSONObject()
        val metaFile = File(staging, "backup.json")
        val meta = try { JSONObject(metaFile.readText()) } catch (_: Exception) { null }
        val out = JSONObject()
        if (meta == null) return out.put("map", map).also { for ((k, v) in counts) it.put(k, v) }
        val dirs = mapOf(
            "logos" to File(filesDir, "logo-library"),
            "lyrics" to File(filesDir, "lyrics-library"),
            "media" to File(File(filesDir, "media"), "lib-media"),
        )
        val libs = meta.optJSONObject("libraries")
        for (key in listOf("logos", "media", "lyrics")) {
            // Kullanıcının seçmediği kitaplık (null: hepsi)
            if (only != null && key !in only) continue
            val items = libs?.optJSONObject(key)?.optJSONArray("items") ?: continue
            val kept = ArrayList<JSONObject>()
            for (i in 0 until items.length()) {
                val it = items.optJSONObject(i) ?: continue
                val id = it.optString("id")
                val file = it.optString("file")
                val src = File(File(File(staging, "libs"), key), file)
                if (!SAFE_ID.matches(id) || !plainName(file) || !isFile(key, file) || it.optString("path") != "libs/$key/$file" || !src.isFile) {
                    counts["skipped"] = counts.getValue("skipped") + 1
                    continue
                }
                val dst = File(dirs.getValue(key), file)
                try { move(src, dst) } catch (_: Exception) { counts["skipped"] = counts.getValue("skipped") + 1; continue }
                val item = JSONObject(it.toString())
                item.remove("ref")
                item.remove("path")
                kept.add(item)
                val ref = it.optString("ref")
                if (ref.isNotEmpty() && key == "media") map.put(ref, "$origin/files/lib-media/" + enc(file))
            }
            if (kept.isNotEmpty()) {
                try { upsertManifest(dirs.getValue(key), kept) } catch (_: Exception) { counts["skipped"] = counts.getValue("skipped") + kept.size; continue }
            }
            counts[key] = counts.getValue(key) + kept.size
            if (key == "media") counts["videos"] = counts.getValue("videos") + kept.size
        }
        // Kitaplık dışı videolar
        val media = (if (only == null || "media" in only) meta.optJSONArray("media") else null) ?: JSONArray()
        val restored = File(File(filesDir, "media"), "restored")
        for (i in 0 until media.length()) {
            val m = media.optJSONObject(i) ?: continue
            val ref = m.optString("ref")
            val inZip = MEDIA_PATH.matchEntire(m.optString("path"))?.groupValues?.get(1)
            val src = inZip?.let { File(File(staging, "media"), it) }
            if (ref.isEmpty() || src == null || !src.isFile) { counts["skipped"] = counts.getValue("skipped") + 1; continue }
            try { move(src, File(restored, inZip)) } catch (_: Exception) { counts["skipped"] = counts.getValue("skipped") + 1; continue }
            map.put(ref, "$origin/files/restored/" + enc(inZip))
            counts["videos"] = counts.getValue("videos") + 1
        }
        for ((k, v) in counts) out.put(k, v)
        return out.put("map", map)
    }

    /** Logo kitaplığından bir görsel: { id, name, kind, mime, b64 } ya da null (motorun logoLibRead'i). */
    fun readLogo(filesDir: File, id: String): JSONObject? {
        if (!SAFE_ID.matches(id)) return null
        val dir = File(filesDir, "logo-library")
        val items = try { JSONObject(File(dir, "manifest.json").readText()).optJSONArray("items") } catch (_: Exception) { null } ?: return null
        for (i in 0 until items.length()) {
            val it = items.optJSONObject(i) ?: continue
            if (it.optString("id") != id) continue
            val file = it.optString("file")
            if (!plainName(file) || !isFile("logos", file)) return null
            val f = File(dir, file)
            if (!f.isFile || f.length() > 24L * 1024 * 1024 || f.canonicalFile.parentFile != dir.canonicalFile) return null
            val mime = it.optString("mime").ifEmpty {
                when (file.substringAfterLast('.').lowercase()) { "png" -> "image/png"; "gif" -> "image/gif"; "webp" -> "image/webp"; "bmp" -> "image/bmp"; else -> "image/jpeg" }
            }
            return JSONObject().put("id", id).put("name", it.optString("name")).put("kind", it.optString("kind"))
                .put("mime", mime).put("b64", java.util.Base64.getEncoder().encodeToString(f.readBytes()))
        }
        return null
    }

    /** Kitaplık listesi (yalnız kayıtlar): logos | media. */
    fun list(filesDir: File, key: String): JSONArray {
        val dir = when (key) { "logos" -> File(filesDir, "logo-library"); "media" -> File(File(filesDir, "media"), "lib-media"); else -> return JSONArray() }
        return try { JSONObject(File(dir, "manifest.json").readText()).optJSONArray("items") ?: JSONArray() } catch (_: Exception) { JSONArray() }
    }
}
