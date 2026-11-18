/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.store

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.net.URLEncoder
import java.util.zip.Deflater
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/* TELEFON YEDEĞİ (.svbackup). Biçim masaüstünün tam yedeğiyle aynı (src/main/full-backup.js
   writeBackup): bilgisayar da açar, telefon da (BackupReader, LibraryRestore).

     presets/<kimlik>.json, libs/<kitaplık>/<dosya>, textures/<sıra>-<ad>, media/<sıra>-<ad>,
     en sonda backup.json

   Kullanıcı bölümleri seçer: arşive yalnız seçilenler girer. Dosyalar belleğe alınmadan akıtılır,
   ayar metni olduğu gibi yazılır (çözülüp yeniden kurulmaz). `sections` ve `phone` alanları
   telefona özel; masaüstü bilmediği alanları okumaz.
   Android çerçevesine bağlı değil, JVM birim testinde denetleniyor. */
object BackupWriter {
    const val TYPE = "cayadev-visualizer-backup"
    const val FORMAT = 1
    private val SAFE_ID = Regex("^[A-Za-z0-9_-]{1,80}$")

    /** Kitaplık dışı video: sahnedeki adres ([ref]), görünen ad, boyut ve açıcı. */
    class Video(val ref: String, val name: String, val size: Long, val open: () -> InputStream?)

    class Source(
        val filesDir: File,
        val presetsDir: File,
        val texturesDir: File,
        val origin: String,
        val sections: Set<String>,
        /** Seçilen bölümlerin ayarı (JSON metni). */
        val settings: String,
        /** Telefonun yerel tercihleri (JSON metni). */
        val local: String,
        val appVersion: String,
        val createdAt: String,
        val videos: List<Video> = emptyList(),
    )

    /** Masaüstündeki slug: ASCII, kısa ad. */
    fun slug(name: String): String {
        val dot = name.lastIndexOf('.')
        val ext = if (dot > 0) name.substring(dot).lowercase().replace(Regex("[^a-z0-9.]"), "").take(10) else ""
        val raw = if (dot > 0) name.substring(0, dot) else name
        val base = raw.lowercase().replace(Regex("[^a-z0-9_-]+"), "-").trim('-').take(40).trim('-').ifEmpty { "file" }
        return base + ext
    }

    fun libDir(filesDir: File, key: String): File = when (key) {
        "logos" -> File(filesDir, "logo-library")
        "lyrics" -> File(filesDir, "lyrics-library")
        else -> File(File(filesDir, "media"), "lib-media")
    }

    /** Kitaplığın yazılabilir kayıtları ve dosyaları. */
    fun libItems(filesDir: File, key: String): List<Pair<JSONObject, File>> {
        val dir = libDir(filesDir, key)
        val a = try { JSONObject(File(dir, "manifest.json").readText()).optJSONArray("items") } catch (_: Exception) { null } ?: return emptyList()
        val out = ArrayList<Pair<JSONObject, File>>()
        for (i in 0 until a.length()) {
            val it = a.optJSONObject(i) ?: continue
            val file = it.optString("file")
            if (!SAFE_ID.matches(it.optString("id")) || !LibraryRestore.plainName(file) || !LibraryRestore.isFile(key, file)) continue
            val f = File(dir, file)
            if (f.isFile) out.add(it to f)
        }
        return out
    }

    fun presetFiles(presetsDir: File): List<File> =
        presetsDir.listFiles { f -> f.isFile && f.name.endsWith(".json") && SAFE_ID.matches(f.name.removeSuffix(".json")) }.orEmpty().sortedBy { it.name }

    fun textureFiles(texturesDir: File): List<File> =
        texturesDir.listFiles { f -> f.isFile && TextureNames.portable(f.name) }.orEmpty().sortedBy { it.name }

    /** Bölüm başına adet ve bayt (dışa aktarma sayfası gösterir). */
    fun plan(filesDir: File, presetsDir: File, texturesDir: File, videos: List<Video>): JSONObject {
        fun row(n: Int, bytes: Long) = JSONObject().put("count", n).put("bytes", bytes)
        val presets = presetFiles(presetsDir)
        val tex = textureFiles(texturesDir)
        val logos = libItems(filesDir, "logos")
        val lyrics = libItems(filesDir, "lyrics")
        val vids = libItems(filesDir, "media")
        return JSONObject()
            .put("presets", row(presets.size, presets.sumOf { it.length() }))
            .put("logos", row(logos.size, logos.sumOf { it.second.length() }))
            .put("lyrics", row(lyrics.size, lyrics.sumOf { it.second.length() }))
            .put("videos", row(vids.size + videos.size, vids.sumOf { it.second.length() } + videos.sumOf { it.size }))
            .put("textures", row(tex.size, tex.sumOf { it.length() }))
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")

    /**
     * Arşivi [out]'a yazar. [onProgress](yazılan, toplam) bayt; [cancelled] true dönerse durur.
     * Dönüş: bölüm başına yazılan adet.
     */
    fun write(out: OutputStream, s: Source, onProgress: (Long, Long) -> Unit = { _, _ -> }, cancelled: () -> Boolean = { false }): JSONObject {
        val on = s.sections
        val presets = if ("presets" in on) presetFiles(s.presetsDir) else emptyList()
        val libs = listOf("logos", "lyrics", "media").filter { (if (it == "media") "videos" else it) in on }.associateWith { libItems(s.filesDir, it) }
        val textures = if ("textures" in on) textureFiles(s.texturesDir) else emptyList()
        val videos = if ("videos" in on) s.videos else emptyList()
        val total = presets.sumOf { it.length() } + libs.values.sumOf { l -> l.sumOf { it.second.length() } } + textures.sumOf { it.length() } + videos.sumOf { it.size }
        var done = 0L
        val buf = ByteArray(256 * 1024)
        val z = ZipOutputStream(out.buffered(256 * 1024))
        fun copy(name: String, input: InputStream, level: Int) {
            z.setLevel(level)
            z.putNextEntry(ZipEntry(name))
            input.use {
                while (true) {
                    if (cancelled()) throw InterruptedException("cancelled")
                    val n = it.read(buf)
                    if (n < 0) break
                    z.write(buf, 0, n)
                    done += n
                    onProgress(done, total)
                }
            }
            z.closeEntry()
        }
        val presetNames = JSONArray()
        for (f in presets) {
            val name = "presets/" + f.name
            copy(name, f.inputStream(), Deflater.DEFAULT_COMPRESSION)
            presetNames.put(name)
        }
        val libraries = JSONObject()
        for ((key, items) in libs) {
            val list = JSONArray()
            for ((item, f) in items) {
                val file = item.optString("file")
                val path = "libs/$key/$file"
                // Video ve görseller zaten sıkışık: sıkıştırmak yalnız pili harcar
                copy(path, f.inputStream(), if (key == "lyrics") Deflater.DEFAULT_COMPRESSION else Deflater.NO_COMPRESSION)
                val rec = JSONObject(item.toString()).put("path", path)
                if (key == "media") rec.put("ref", s.origin + "/files/lib-media/" + enc(file))
                list.put(rec)
            }
            libraries.put(key, JSONObject().put("dir", "").put("items", list))
        }
        val texList = JSONArray()
        for (f in textures) {
            val path = "textures/" + texList.length() + "-" + slug(f.name)
            copy(path, f.inputStream(), Deflater.NO_COMPRESSION)
            texList.put(JSONObject().put("name", f.name).put("path", path).put("size", f.length()))
        }
        val mediaList = JSONArray()
        for (v in videos) {
            val input = v.open() ?: continue
            val path = "media/" + mediaList.length() + "-" + slug(v.name)
            copy(path, input, Deflater.NO_COMPRESSION)
            mediaList.put(JSONObject().put("ref", v.ref).put("name", v.name).put("path", path).put("size", v.size))
        }
        // Ayar metni çözülmeden yerine konur (data: adresli büyük ayarlar belleği ikiye katlamasın)
        z.setLevel(Deflater.DEFAULT_COMPRESSION)
        z.putNextEntry(ZipEntry("backup.json"))
        val w = z.writer(Charsets.UTF_8)
        w.write("{\"type\":" + JSONObject.quote(TYPE) + ",\"format\":" + FORMAT)
        w.write(",\"appVersion\":" + JSONObject.quote(s.appVersion) + ",\"platform\":\"android\",\"createdAt\":" + JSONObject.quote(s.createdAt))
        w.write(",\"settings\":")
        w.write(s.settings)
        w.write(",\"presets\":$presetNames,\"libraries\":$libraries,\"textures\":$texList,\"media\":$mediaList,\"videosLeftOut\":0,\"videoBytesLeftOut\":0")
        w.write(",\"sections\":" + JSONArray(on.toList()) + ",\"phone\":{\"local\":")
        w.write(s.local)
        w.write("}}")
        w.flush()
        z.closeEntry()
        z.finish()
        z.flush()
        return JSONObject().put("presets", presetNames.length()).put("logos", libs["logos"]?.size ?: 0).put("lyrics", libs["lyrics"]?.size ?: 0)
            .put("videos", (libs["media"]?.size ?: 0) + mediaList.length()).put("textures", texList.length()).put("bytes", total)
    }
}
