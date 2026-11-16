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
   preset kimliği ve boyutu denetleniyor. Kitaplık dosyaları, dokular ve
   videolar bu aşamada açılmıyor, yalnız sayılıyor (Faz 4).
   Android çerçevesine bağlı değil, JVM birim testinde denetleniyor. */
object BackupReader {
    val PRESET = Regex("^presets/([A-Za-z0-9_-]{1,80})\\.json$")
    const val MAX_META = 64 * 1024 * 1024
    const val MAX_PRESET = 8 * 1024 * 1024

    class Result(
        /** backup.json'ın baytları (yoksa null: tam yedek değil). */
        val meta: ByteArray?,
        /** Geçici klasöre alınan presetler: kimlik → dosya. */
        val presets: Map<String, File>,
        /** Okunamayan ya da sınırı aşan öğeler. */
        val skipped: Int,
        /** Bu aşamada açılmayanlar: libs, textures, media. */
        val later: Map<String, Int>,
    )

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
        var skipped = 0
        val later = linkedMapOf("libs" to 0, "textures" to 0, "media" to 0)
        ZipInputStream(input).use { z ->
            while (true) {
                val e = z.nextEntry ?: break
                if (e.isDirectory) continue
                val name = e.name
                val m = PRESET.matchEntire(name)
                when {
                    name == "backup.json" -> meta = readLimited(z, MAX_META) ?: run { skipped++; null }
                    m != null -> {
                        val bytes = readLimited(z, MAX_PRESET)
                        if (bytes == null) skipped++
                        else {
                            val f = File(staging, m.groupValues[1] + ".json")
                            f.writeBytes(bytes)
                            presets[m.groupValues[1]] = f
                        }
                    }
                    else -> {
                        val top = name.substringBefore('/')
                        if (top in later) later[top] = later.getValue(top) + 1
                    }
                }
            }
        }
        return Result(meta, presets, skipped, later)
    }
}
