/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.store

import java.io.File
import java.io.InputStream
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

    /** Kitaplık listesi (yalnız kayıtlar): logos | media | images. */
    fun list(filesDir: File, key: String): JSONArray {
        val dir = dirOf(filesDir, key) ?: return JSONArray()
        return try { JSONObject(File(dir, "manifest.json").readText()).optJSONArray("items") ?: JSONArray() } catch (_: Exception) { JSONArray() }
    }

    private fun dirOf(filesDir: File, key: String): File? = when (key) {
        "logos" -> File(filesDir, "logo-library")
        "media" -> File(File(filesDir, "media"), "lib-media")
        "images" -> File(File(filesDir, "media"), "lib-images")
        else -> null
    }

    /**
     * Galeriden küçültülmüş resim (MediaPick.image data URL). Videolar gibi
     * `media/lib-images/` altında durur ve `/files/lib-images/` adresinden açılır.
     */
    fun importImage(filesDir: File, name: String, dataUrl: String): JSONObject {
        val comma = dataUrl.indexOf(',')
        if (!dataUrl.startsWith("data:image/") || comma < 1) throw IllegalArgumentException("bad-image")
        val bytes = try { java.util.Base64.getDecoder().decode(dataUrl.substring(comma + 1)) } catch (_: Exception) { throw IllegalArgumentException("bad-image") }
        return importImageBytes(filesDir, name, bytes)
    }

    /** Dosyadan gelen resim. Tür bayttan okunur; resim değilse ya da 8 MB üstündeyse alınmaz. */
    fun importImageBytes(filesDir: File, name: String, bytes: ByteArray): JSONObject {
        if (bytes.isEmpty() || bytes.size > 8 * 1024 * 1024) throw IllegalArgumentException("bad-image")
        val mime = when {
            bytes.size >= 3 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xD8.toByte() && bytes[2] == 0xFF.toByte() -> "image/jpeg"
            bytes.size >= 4 && bytes[0] == 0x89.toByte() && bytes[1] == 0x50.toByte() && bytes[2] == 0x4E.toByte() && bytes[3] == 0x47.toByte() -> "image/png"
            bytes.size >= 3 && bytes[0] == 0x47.toByte() && bytes[1] == 0x49.toByte() && bytes[2] == 0x46.toByte() -> "image/gif"
            bytes.size >= 12 && bytes[0] == 0x52.toByte() && bytes[1] == 0x49.toByte() && bytes[8] == 0x57.toByte() && bytes[9] == 0x45.toByte() -> "image/webp"
            bytes.size >= 2 && bytes[0] == 0x42.toByte() && bytes[1] == 0x4D.toByte() -> "image/bmp"
            else -> throw IllegalArgumentException("bad-image")
        }
        val ext = when (mime) { "image/png" -> ".png"; "image/gif" -> ".gif"; "image/webp" -> ".webp"; "image/bmp" -> ".bmp"; else -> ".jpg" }
        val id = "img_" + java.util.UUID.randomUUID().toString().replace("-", "").take(16)
        val file = id + ext
        if (!SAFE_ID.matches(id) || !plainName(file)) throw IllegalArgumentException("bad-image")
        val dir = dirOf(filesDir, "images") ?: throw IllegalArgumentException("bad-image")
        dir.mkdirs()
        val dst = File(dir, file)
        dst.writeBytes(bytes)
        val shown = name.trim().take(120).ifBlank { file }
        val item = JSONObject().put("id", id).put("name", shown).put("file", file).put("mime", mime)
        upsertManifest(dir, listOf(item))
        return item.put("url", "https://appassets.androidplatform.net/files/lib-images/" + enc(file))
    }

    /** Masaüstündeki video kitaplığıyla aynı tavan (512 MB) ve aynı kap imzası. */
    const val VIDEO_MAX = 512L * 1024 * 1024

    fun isVideoName(name: String): Boolean = videoExt(name) != null

    /**
     * Seçilen videoyu `media/lib-media/` altına akıtır. Başlık bir video kabı değilse
     * ya da dosya tavandan büyükse alınmaz; bütün dosya belleğe çekilmez.
     */
    fun importVideo(filesDir: File, name: String, input: InputStream): JSONObject {
        val ext = videoExt(name) ?: throw IllegalArgumentException("bad-video")
        val id = "vid_" + java.util.UUID.randomUUID().toString().replace("-", "").take(16)
        val file = id + ext
        if (!SAFE_ID.matches(id) || !plainName(file)) throw IllegalArgumentException("bad-video")
        val dir = dirOf(filesDir, "media") ?: throw IllegalArgumentException("bad-video")
        dir.mkdirs()
        val part = File(dir, "$file.part")
        val head = ByteArray(12)
        var headN = 0
        var total = 0L
        try {
            part.outputStream().use { out ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    if (headN < 12) {
                        val take = minOf(12 - headN, n)
                        System.arraycopy(buf, 0, head, headN, take)
                        headN += take
                    }
                    total += n
                    if (total > VIDEO_MAX) throw IllegalArgumentException("too-big")
                    out.write(buf, 0, n)
                }
            }
            if (total <= 0L || !looksLikeVideo(head, headN, total)) throw IllegalArgumentException("bad-video")
            val dst = File(dir, file)
            if (dst.isFile) dst.delete()
            if (!part.renameTo(dst)) { part.copyTo(dst, overwrite = true); part.delete() }
        } catch (e: Exception) {
            part.delete()
            throw e
        }
        val mime = when (ext) {
            ".webm" -> "video/webm"
            ".mkv" -> "video/x-matroska"
            ".mov" -> "video/quicktime"
            ".avi" -> "video/x-msvideo"
            else -> "video/mp4"
        }
        val shown = name.substringAfterLast('/').substringAfterLast('\\').trim().take(120).ifBlank { file }
        val item = JSONObject().put("id", id).put("name", shown).put("file", file).put("mime", mime).put("kind", "video")
        upsertManifest(dir, listOf(item))
        return item.put("url", "https://appassets.androidplatform.net/files/lib-media/" + enc(file))
    }

    /** src/main/media-library.js isVideoHead ile aynı: ftyp/moov, WebM, AVI. */
    fun looksLikeVideo(head: ByteArray, n: Int, total: Long): Boolean {
        if (n < 8) return false
        val box = String(head, 4, 4, Charsets.ISO_8859_1)
        if (box == "ftyp" || box == "moov" || box == "mdat" || box == "wide" || box == "free" || box == "skip" || box == "pnot") {
            val size = ((head[0].toInt() and 0xff) shl 24) or ((head[1].toInt() and 0xff) shl 16) or
                ((head[2].toInt() and 0xff) shl 8) or (head[3].toInt() and 0xff)
            if (size == 0 || size == 1) return true
            return size >= 8 && size.toLong() <= total
        }
        if (n >= 4 && head[0] == 0x1A.toByte() && head[1] == 0x45.toByte() && head[2] == 0xDF.toByte() && head[3] == 0xA3.toByte()) return true
        if (n >= 12 && String(head, 0, 4, Charsets.ISO_8859_1) == "RIFF" && String(head, 8, 4, Charsets.ISO_8859_1) == "AVI ") return true
        return false
    }

    private fun videoExt(name: String): String? {
        val n = name.lowercase()
        return listOf(".m4v", ".mp4", ".webm", ".mkv", ".mov", ".avi").firstOrNull { n.endsWith(it) }
    }

    /** Telefondaki kitaplık öğesini siler: logos, media (video) ya da images. Dosya klasörün dışına çıkamaz. */
    fun remove(filesDir: File, key: String, id: String): JSONObject {
        if (key != "logos" && key != "media" && key != "images") throw IllegalArgumentException("bad-library")
        if (!SAFE_ID.matches(id)) throw IllegalArgumentException("bad-id")
        val dir = dirOf(filesDir, key) ?: throw IllegalArgumentException("bad-library")
        val file = File(dir, "manifest.json")
        val items = try {
            val a = JSONObject(file.readText()).optJSONArray("items") ?: JSONArray()
            (0 until a.length()).mapNotNull { a.optJSONObject(it) }
        } catch (_: Exception) { emptyList() }
        val hit = items.find { it.optString("id") == id } ?: throw IllegalArgumentException("missing")
        val name = hit.optString("file")
        if (!plainName(name)) throw IllegalArgumentException("bad-file")
        val dst = File(dir, name)
        if (dst.isFile && dst.canonicalFile.parentFile == dir.canonicalFile) dst.delete()
        val next = items.filter { it.optString("id") != id }
        dir.mkdirs()
        val tmp = File(dir, "manifest.json.tmp")
        tmp.writeText(JSONObject().put("items", JSONArray(next)).toString(2))
        if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
        return JSONObject().put("id", id)
    }
}
