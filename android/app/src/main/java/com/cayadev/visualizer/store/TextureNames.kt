/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.store

/* MILKDROP DOKU ADLARI (src/main/milkdrop-textures.js, src/main/full-backup.js).

   Doku klasörü düz: ad yol taşıyamaz, uzantı görsel olmalı. Yedekten gelen
   ad ayrıca masaüstünün "her sistemde yazılabilir ad" kuralından geçer
   (portableName). Liste masaüstündeki gibi SIRALI: `sampler_rand00` gibi
   yuvalar dokuyu listedeki sırasından seçiyor. Android çerçevesine bağlı
   değil, JVM birim testinde denetleniyor. */
object TextureNames {
    val MIME = mapOf(
        ".jpg" to "image/jpeg", ".jpeg" to "image/jpeg", ".png" to "image/png",
        ".gif" to "image/gif", ".bmp" to "image/bmp", ".webp" to "image/webp",
    )
    const val MAX_BYTES = 8 * 1024 * 1024
    private val RESERVED = Regex("^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\\.|$)", RegexOption.IGNORE_CASE)

    fun ext(name: String): String {
        val i = name.lastIndexOf('.')
        return if (i <= 0) "" else name.substring(i).lowercase()
    }

    fun mime(name: String): String = MIME[ext(name)] ?: ""

    /** Klasörde okunabilir ad (resolveTexture): boş değil, yol yok, sürücü öneki yok, görsel uzantı. */
    fun readable(name: String?): Boolean {
        if (name.isNullOrEmpty() || name == "." || name == "..") return false
        if (name.contains('/') || name.contains('\\') || name.contains('\u0000')) return false
        if (Regex("^[A-Za-z]:").containsMatchIn(name)) return false
        return mime(name).isNotEmpty()
    }

    /** Yedekten yazılabilecek ad (portableName ve görsel uzantı). */
    fun portable(name: String?): Boolean {
        if (!readable(name) || name!!.length > 200 || name.contains(':')) return false
        if (name.any { it in "<>\"|?*" || it.code < 0x20 }) return false
        if (name.endsWith('.') || name.endsWith(' ')) return false
        return !RESERVED.containsMatchIn(name)
    }

    /** Masaüstündeki liste: görsel dosyalar, büyük-küçük harf farkı yok sayılarak tekil, sıralı. */
    fun list(files: List<String>): List<String> {
        val seen = HashSet<String>()
        val out = ArrayList<String>()
        for (n in files) {
            if (!readable(n)) continue
            if (seen.add(n.lowercase())) out.add(n)
        }
        out.sort()
        return out
    }
}
