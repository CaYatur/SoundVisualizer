/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.export

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/* Sayfadan gelen ad dışa aktarım klasörünün dışına çıkamaz. */
class ExportNamesTest {
    private fun out(name: String?) = ExportNames.output(name, 42)

    @Test
    fun keepsReadableNames() {
        assertEquals("Gece Sürüşü.mp4", out("Gece Sürüşü"))
        assertEquals("song (live) v2.mp4", out("song (live) v2.mp4"))
        assertEquals("a.mp4", out("a.MP4"))
    }

    @Test
    fun dropsPathsAndHiddenNames() {
        for (n in listOf("../../shared_prefs/x", "/data/data/a/b", "..\\..\\x", "a/../../b", ".hidden", "..", "x\u0000y")) {
            val r = out(n)
            assertFalse(n, r.contains('/') || r.contains('\\') || r.startsWith("."))
            assertTrue(n, r.endsWith(".mp4"))
        }
        assertEquals("x.mp4", out("../../shared_prefs/x"))
    }

    @Test
    fun emptyNamesGetATimeName() {
        assertEquals("export-42.mp4", out(null))
        assertEquals("export-42.mp4", out(""))
        assertEquals("export-42.mp4", out(".."))
        assertEquals("export-42.mp4", out("///"))
    }

    @Test
    fun longNamesAreCut() {
        assertEquals(124, out("a".repeat(500)).length)
    }
}
