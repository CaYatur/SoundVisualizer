/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.store

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/* Doku adları masaüstündeki kurallarla (milkdrop-textures.js, full-backup.js portableName). */
class TextureNamesTest {
    @Test
    fun readableNamesFollowTheDesktopFolderRule() {
        for (n in listOf("worms.jpg", "Noise.PNG", "a b.webp", "x.jpeg", "t.gif", "t.bmp")) assertTrue(n, TextureNames.readable(n))
        for (n in listOf("", ".", "..", "a/b.png", "a\\b.png", "C:x.png", "x.txt", "x", ".png", "x.png\u0000")) assertFalse(n, TextureNames.readable(n))
        assertEquals("image/jpeg", TextureNames.mime("A.JPG"))
    }

    @Test
    fun portableNamesFollowTheDesktopBackupRule() {
        assertTrue(TextureNames.portable("worms.jpg"))
        for (n in listOf("a?b.png", "a*b.png", "con.png", "LPT1.jpg", "x.png ", "a<b.png", "a\u0001.png", "a:b.png")) assertFalse(n, TextureNames.portable(n))
        assertFalse(TextureNames.portable("a".repeat(197) + ".png"))
    }

    @Test
    fun listIsSortedAndUniqueIgnoringCase() {
        // İlk görülen ad kalır (A.png), sıralama UTF-16 kod sırası (JavaScript'in sort'u gibi)
        assertEquals(listOf("A.png", "b.jpg", "c.webp"), TextureNames.list(listOf("c.webp", "b.jpg", "A.png", "a.png", "notes.txt")))
    }
}
