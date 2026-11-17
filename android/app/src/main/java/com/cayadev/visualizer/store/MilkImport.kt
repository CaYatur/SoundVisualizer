/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.store

import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest

/* TELEFONDAN .milk İÇE AKTARMA (docs/android/PLAN.md Faz 4): kurallar masaüstüyle aynı.

   - Yalnız `.milk` ve `.milk2` (MilkDrop 3'ün çift preseti; motor içeriğinden tanıyor).
   - Dosya en çok 450 KB (src/main/milkdrop-import.js PRESET_MAX_BYTES; depo sınırı 512 KB
     JSON, kaçışlara pay), bir seferde en çok 600 dosya ve toplam 24 MB (masaüstünün
     "presets:import-milk" sınırları).
   - Metin önce katı UTF-8; olmazsa latin1 (masaüstündeki decodeText). Eski presetlerin
     çoğu Windows'un 8 bitlik kodlamasıyla yazılmış.
   - Preset metni mi: en az bir `ad=değer` satırı (masaüstündeki looksLikePreset). Derlenip
     derlenmediğine motor bakar.
   - Tekrar: aynı ad ve aynı içerik (ad + içeriğin SHA-1 özeti, masaüstündeki keyOf).
   Dokular bu yoldan gelmez: masaüstünün tam yedeğiyle (.svbackup) gelir. */
object MilkImport {
    const val MAX_BYTES = 450 * 1024
    const val MAX_FILES = 600
    const val MAX_TOTAL = 24L * 1024 * 1024

    private val KEY_LINE = Regex("^[ \\t]*[A-Za-z_][A-Za-z0-9_]*[ \\t]*=", RegexOption.MULTILINE)

    fun isPresetFile(name: String): Boolean {
        val n = name.lowercase()
        return n.endsWith(".milk") || n.endsWith(".milk2")
    }

    /** Dosya adı, uzantısız ve klasörsüz (masaüstündeki stem). */
    fun stem(name: String): String {
        val base = name.substringAfterLast('/').substringAfterLast('\\')
        val dot = base.lastIndexOf('.')
        return if (dot > 0) base.substring(0, dot) else base
    }

    fun looksLikePreset(text: String): Boolean = KEY_LINE.containsMatchIn(text)

    /** Katı UTF-8 (baştaki BOM atılır, TextDecoder gibi); geçersizse latin1. */
    fun decode(bytes: ByteArray): String {
        val strict = Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
        val s = try {
            strict.decode(ByteBuffer.wrap(bytes)).toString()
        } catch (e: CharacterCodingException) {
            return String(bytes, Charsets.ISO_8859_1)
        }
        return if (s.isNotEmpty() && s[0].code == 0xFEFF) s.substring(1) else s
    }

    /** Ad + içerik özeti; ayırıcı dosya adında olamayacak bir karakter. */
    fun key(name: String, source: String): String {
        val d = MessageDigest.getInstance("SHA-1").digest(source.toByteArray(Charsets.UTF_8))
        return name + "\u0000" + d.joinToString("") { "%02x".format(it) }
    }

    /** En çok [max] bayt; fazlası varsa null (dosyanın kalanı okunmaz). */
    fun readCapped(input: InputStream, max: Int): ByteArray? {
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(16 * 1024)
        var total = 0
        while (true) {
            val n = input.read(buf)
            if (n < 0) return out.toByteArray()
            total += n
            if (total > max) return null
            out.write(buf, 0, n)
        }
    }

    /** Masaüstündeki gibi `md_` + 12 onaltılık hane. */
    fun newId(random: java.util.Random = java.security.SecureRandom()): String {
        val b = ByteArray(6)
        random.nextBytes(b)
        return "md_" + b.joinToString("") { "%02x".format(it) }
    }
}
