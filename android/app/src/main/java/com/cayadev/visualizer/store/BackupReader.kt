/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.store

import java.io.File
import java.io.InputStream
import java.util.zip.ZipInputStream

/* MASAÜSTÜ TAM YEDEĞİNİ OKUMA (.svbackup, src/main/full-backup.js).

   Arşiv Android'in dosya seçicisinden bir akış olarak geliyor; telefonun
   yerini doldurmamak için bütünü kopyalanmıyor, bir kez baştan sona okunuyor.
   Masaüstü `backup.json`'ı EN SONA yazıyor, bu yüzden presetler önce geçici
   bir klasöre alınıyor; hangilerinin işleneceğine sayfa, backup.json'ı
   doğruladıktan sonra karar veriyor (importCommit).

   Arşiv güvenilmez veri (masaüstündeki kural): hiçbir yol arşivden alınmıyor,
   preset kimliği ve boyutu denetleniyor. MilkDrop dokuları da geçici klasöre
   alınır (arşiv içi ad masaüstünün `<sıra>-<slug>` biçiminde); özgün adlarını
   backup.json taşıyor. Kitaplık dosyaları (logo, video, söz) ve kitaplık dışı videolar da
   geçici klasöre akıtılır (belleğe alınmadan, masaüstünün boyut sınırlarıyla); kayıtları
   işleme aşamasında backup.json'dan okunur (LibraryRestore).
   Android çerçevesine bağlı değil, JVM birim testinde denetleniyor. */
object BackupReader {
    val PRESET = Regex("^presets/([A-Za-z0-9_-]{1,80})\\.json$")

    /** full-backup.js: `textures/` + sıra + `-` + slug (ASCII, kısa). */
    val TEXTURE = Regex("^textures/(\\d{1,6}-[a-z0-9_.-]{1,60})$")
    /** full-backup.js: kitaplık dosyaları `libs/<kitaplık>/<dosya>` (özgün ad, kayıt backup.json'da). */
    val LIB = Regex("^libs/(logos|media|lyrics)/([^/\\\\:\\u0000]{1,200})$")
    /** Kitaplık dışı sahne videoları: `media/<sıra>-<slug>`. */
    val MEDIA = Regex("^media/(\\d{1,6}-[a-z0-9._-]{1,120})$")
    /** Masaüstü kitaplıklarının sınırları (logo-library.js, media-library.js, lyrics-library.js). */
    val LIB_MAX = mapOf("logos" to 24L * 1024 * 1024, "media" to 512L * 1024 * 1024, "lyrics" to 1024L * 1024)
    const val MEDIA_MAX = 2048L * 1024 * 1024
    const val MAX_META = 64 * 1024 * 1024
    const val MAX_PRESET = 8 * 1024 * 1024

    class Result(
        /** backup.json'ın baytları (yoksa null: tam yedek değil). */
        val meta: ByteArray?,
        /** Geçici klasöre alınan presetler: kimlik → dosya. */
        val presets: Map<String, File>,
        /** Okunamayan ya da sınırı aşan öğeler. */
        val skipped: Int,
        /** Geçici klasöre alınan dokular: arşiv içi ad (textures/ sonrası) → dosya. */
        val textures: Map<String, File>,
        /** Bu aşamada açılmayanlar (sınırı aşan ya da tanınmayan kitaplık dosyaları). */
        val later: Map<String, Int>,
        /** Geçici klasöre alınan kitaplık dosyaları: "<kitaplık>/<dosya>" → dosya. */
        val libs: Map<String, File> = emptyMap(),
        /** Geçici klasöre alınan kitaplık dışı videolar: arşiv içi ad (media/ sonrası) → dosya. */
        val media: Map<String, File> = emptyMap(),
    )

    /** Akışı diske yazar, en çok [max] bayt; aşarsa dosya silinir, false (akış sonuna kadar okunur). */
    fun copyLimited(input: InputStream, dest: File, max: Long): Boolean {
        dest.parentFile?.mkdirs()
        val buf = ByteArray(256 * 1024)
        var total = 0L
        var over = false
        dest.outputStream().use { out ->
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                total += n
                if (total > max) over = true
                if (!over) out.write(buf, 0, n)
            }
        }
        if (over || total == 0L) { dest.delete(); return false }
        return true
    }

    fun isZip(head: ByteArray): Boolean =
        head.size >= 4 && head[0] == 'P'.code.toByte() && head[1] == 'K'.code.toByte() && head[2] == 3.toByte() && head[3] == 4.toByte()

    /** En çok [max] bayt; aşarsa null (akış yine sonuna kadar okunur ki arşiv sürsün). */
    fun readLimited(input: InputStream, max: Int): ByteArray? {
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(64 * 1024)
        var total = 0L
        var over = false
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            total += n
            if (total > max) over = true
            if (!over) out.write(buf, 0, n)
        }
        return if (over) null else out.toByteArray()
    }

    fun read(input: InputStream, staging: File): Result {
        staging.deleteRecursively()
        staging.mkdirs()
        var meta: ByteArray? = null
        val presets = LinkedHashMap<String, File>()
        val textures = LinkedHashMap<String, File>()
        val texDir = File(staging, "textures")
        var skipped = 0
        val later = linkedMapOf("libs" to 0, "media" to 0)
        val libs = LinkedHashMap<String, File>()
        val media = LinkedHashMap<String, File>()
        ZipInputStream(input).use { z ->
            while (true) {
                val e = z.nextEntry ?: break
                if (e.isDirectory) continue
                val name = e.name
                val m = PRESET.matchEntire(name)
                val t = TEXTURE.matchEntire(name)
                val lb = LIB.matchEntire(name)
                val md = MEDIA.matchEntire(name)
                when {
                    name == "backup.json" -> meta = readLimited(z, MAX_META) ?: run { skipped++; null }
                    lb != null && lb.groupValues[2] != "." && lb.groupValues[2] != ".." -> {
                        val key = lb.groupValues[1]
                        val f = File(File(File(staging, "libs"), key), lb.groupValues[2])
                        if (copyLimited(z, f, LIB_MAX.getValue(key))) libs["$key/${lb.groupValues[2]}"] = f
                        else later["libs"] = later.getValue("libs") + 1
                    }
                    md != null -> {
                        val f = File(File(staging, "media"), md.groupValues[1])
                        if (copyLimited(z, f, MEDIA_MAX)) media[md.groupValues[1]] = f
                        else later["media"] = later.getValue("media") + 1
                    }
                    m != null -> {
                        val bytes = readLimited(z, MAX_PRESET)
                        if (bytes == null) skipped++
                        else {
                            val f = File(staging, m.groupValues[1] + ".json")
                            f.writeBytes(bytes)
                            presets[m.groupValues[1]] = f
                        }
                    }
                    t != null -> {
                        val bytes = readLimited(z, TextureNames.MAX_BYTES)
                        if (bytes == null) skipped++
                        else {
                            texDir.mkdirs()
                            val f = File(texDir, t.groupValues[1])
                            f.writeBytes(bytes)
                            textures[t.groupValues[1]] = f
                        }
                    }
                    else -> {
                        val top = name.substringBefore('/')
                        if (top in later) later[top] = later.getValue(top) + 1
                    }
                }
            }
        }
        // backup.json kitaplık kayıtları için işleme aşamasında yeniden okunur
        meta?.let { File(staging, "backup.json").writeBytes(it) }
        return Result(meta = meta, presets = presets, skipped = skipped, textures = textures, later = later, libs = libs, media = media)
    }
}
