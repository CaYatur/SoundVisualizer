/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.store

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/* Sayfa profil klasörünün dışına çıkamaz: yalnız bilinen adlar kabul edilir. */
class ProfileNamesTest {
    @Test
    fun knownNamesAreAllowed() {
        for (n in listOf("settings.json", "scenes.json", "library.json", "settings.v3-backup.json", "settings.broken.json",
            "settings.before-import.json", "scenes.before-import.json", "library.before-import.json")) {
            assertTrue(n, ProfileNames.allowed(n))
        }
    }

    @Test
    fun pathsAndUnknownNamesAreRefused() {
        for (n in listOf("", "../settings.json", "presets/../settings.json", "/data/x", "settings.json/", "Settings.json", "a.json", "settings.json\u0000")) {
            assertFalse(n, ProfileNames.allowed(n))
        }
    }
}
