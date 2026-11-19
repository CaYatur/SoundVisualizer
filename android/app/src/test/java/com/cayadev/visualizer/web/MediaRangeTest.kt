/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MediaRangeTest {
    @Test
    fun aciksonluAralikDosyaninSonunaKadarGider() {
        assertEquals(MediaRange.Span(0, 99), MediaRange.parse("bytes=0-", 100))
        assertEquals(MediaRange.Span(40, 99), MediaRange.parse("bytes=40-", 100))
    }

    @Test
    fun kapaliAralikDosyayaKirpilir() {
        assertEquals(MediaRange.Span(10, 19), MediaRange.parse("bytes=10-19", 100))
        assertEquals(MediaRange.Span(90, 99), MediaRange.parse("bytes=90-500", 100))
    }

    @Test
    fun sondanOkuma() {
        assertEquals(MediaRange.Span(75, 99), MediaRange.parse("bytes=-25", 100))
        assertEquals(MediaRange.Span(0, 99), MediaRange.parse("bytes=-500", 100))
    }

    @Test
    fun dosyaDisiAralikReddedilir() {
        assertEquals(MediaRange.UNSATISFIABLE, MediaRange.parse("bytes=100-", 100))
        assertEquals(MediaRange.UNSATISFIABLE, MediaRange.parse("bytes=-0", 100))
    }

    @Test
    fun desteklenmeyenBaslikTamDosyaVerir() {
        assertNull(MediaRange.parse(null, 100))
        assertNull(MediaRange.parse("bytes=0-1,5-6", 100))
        assertNull(MediaRange.parse("items=0-1", 100))
        assertNull(MediaRange.parse("bytes=20-10", 100))
    }
}
