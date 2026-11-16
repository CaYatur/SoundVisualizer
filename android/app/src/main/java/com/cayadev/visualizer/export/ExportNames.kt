/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.export

/* DIŞA AKTARIM DOSYA ADI (docs/android/PLAN.md 2.5).

   Ad sayfadan geliyor (şarkının ya da sahnenin adı). Klasör dışına çıkamaz:
   yol parçaları atılır, yalnız harf, rakam, boşluk ve . _ - ( ) kalır, baştaki
   noktalar silinir (gizli dosya ya da ".."), uzantı .mp4 olur. Boş kalırsa
   zamandan bir ad verilir. Android çerçevesine bağlı değil, JVM testinde
   denetleniyor. */
object ExportNames {
    private val UNSAFE = Regex("[^\\p{L}\\p{N} ._()-]")
    private const val MAX = 120

    fun output(name: String?, now: Long): String {
        val last = (name ?: "").substringAfterLast('/').substringAfterLast('\\')
        var base = UNSAFE.replace(last, "_").trim().trimStart('.').trim()
        if (base.lowercase().endsWith(".mp4")) base = base.dropLast(4).trimEnd()
        base = base.take(MAX).trimEnd()
        if (base.isEmpty() || base.all { it == '.' || it == '_' }) base = "export-$now"
        return "$base.mp4"
    }
}
