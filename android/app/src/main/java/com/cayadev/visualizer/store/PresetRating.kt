/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.store

/* MILKDROP PRESETİNİN PUANI (src/shared/milkdrop-cycle.js fileRating).

   Sayfaya giden preset listesi MilkDrop kaynağını taşımıyor (masaüstündeki
   "lazy" liste, src/shared/preset-lean.js): kaynak ancak preset çizilecekken
   isteniyor. Rastgele seçim ise puana bakıyor ve puan kaynağın içinde
   (`fRating=`). Bu yüzden liste kurulurken puan burada okunur. Desen
   masaüstündekinin aynısı; android/js-tests/presets.test.js ikisini
   karşılaştırıyor. */
object PresetRating {
    const val PATTERN = "^[ \\t]*fRating[ \\t]*=[ \\t]*([-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?)"
    const val DEFAULT = 3.0
    private val RE = Regex(PATTERN, setOf(RegexOption.MULTILINE, RegexOption.IGNORE_CASE))

    fun of(source: String?): Double {
        if (source.isNullOrEmpty()) return DEFAULT
        val v = RE.find(source)?.groupValues?.get(1)?.toDoubleOrNull() ?: return DEFAULT
        return if (v.isFinite()) v.coerceIn(0.0, 5.0) else DEFAULT
    }
}
