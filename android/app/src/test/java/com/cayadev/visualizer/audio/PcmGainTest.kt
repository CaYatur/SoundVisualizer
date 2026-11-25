/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.audio

import org.junit.Assert.assertEquals
import org.junit.Test

class PcmGainTest {
    @Test
    fun unityLeavesSamples() {
        val src = shortArrayOf(1000, -1000)
        assertEquals(src, PcmGain.scale(src, src.size, 1f))
    }

    @Test
    fun doubleClips() {
        val out = PcmGain.scale(shortArrayOf(20000, -20000, 10), 3, 2f)
        assertEquals(3, out.size)
        assertEquals(32767.toShort(), out[0])
        assertEquals((-32768).toShort(), out[1])
        assertEquals(20.toShort(), out[2])
    }

    @Test
    fun clamp() {
        assertEquals(1f, PcmGain.clamp(Double.NaN))
        assertEquals(2f, PcmGain.clamp(9.0))
        assertEquals(0f, PcmGain.clamp(-1.0))
        assertEquals(1.5f, PcmGain.clamp(1.5))
    }
}
