/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.audio

/* PC'den gelen köprü sesi. 1 şimdiki düzey, 2 iki kat. Uçlar Int16 sınırında kesilir. */
object PcmGain {
    fun clamp(v: Double): Float {
        if (!v.isFinite()) return 1f
        val n = kotlin.math.round(v * 100.0) / 100.0
        return n.toFloat().coerceIn(0f, 2f)
    }

    fun scale(samples: ShortArray, count: Int, gain: Float): ShortArray {
        if (gain == 1f) return samples
        val n = count.coerceAtMost(samples.size)
        val out = ShortArray(n)
        if (gain == 0f) return out
        for (i in 0 until n) {
            val s = samples[i] * gain
            out[i] = when {
                s > 32767f -> 32767
                s < -32768f -> -32768
                else -> s.toInt()
            }.toShort()
        }
        return out
    }
}
