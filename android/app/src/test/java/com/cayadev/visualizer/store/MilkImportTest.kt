/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.store

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream

/* Telefondan .milk içe aktarma: kurallar masaüstüyle aynı (src/main/milkdrop-import.js). */
class MilkImportTest {
    @Test
    fun onlyMilkAndMilk2FilesAreTaken() {
        for (n in listOf("Aurora.milk", "B.MILK", "çift.milk2", "x.Milk2")) assertTrue(n, MilkImport.isPresetFile(n))
        for (n in listOf("a.milk.txt", "a.json", "milk", "a.milk3", "")) assertFalse(n, MilkImport.isPresetFile(n))
    }

    @Test
    fun nameIsTheFileStem() {
        assertEquals("Aurora", MilkImport.stem("Aurora.milk"))
        assertEquals("Ad v2.1", MilkImport.stem("klasör/Ad v2.1.milk"))
        assertEquals("x", MilkImport.stem("a\\b\\x.milk2"))
        // Noktayla başlayan ad uzantı sayılmaz (Node path.extname gibi)
        assertEquals(".milk", MilkImport.stem(".milk"))
    }

    @Test
    fun presetTextNeedsAKeyValueLine() {
        assertTrue(MilkImport.looksLikePreset("[preset00]\nfRating=3.000\nzoom=1.0\n"))
        assertTrue(MilkImport.looksLikePreset("  per_frame_1 = wave_r = 0.5;"))
        assertFalse(MilkImport.looksLikePreset(""))
        assertFalse(MilkImport.looksLikePreset("rastgele bir metin\n= değer yok"))
        assertFalse(MilkImport.looksLikePreset("1abc=2"))
    }

    @Test
    fun strictUtf8ElseLatin1() {
        assertEquals("ç=1", MilkImport.decode("ç=1".toByteArray(Charsets.UTF_8)))
        // Baştaki BOM atılır (TextDecoder gibi)
        assertEquals("a=1", MilkImport.decode(byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte(), 'a'.code.toByte(), '='.code.toByte(), '1'.code.toByte())))
        // Windows'un 8 bitlik kodlamasıyla yazılmış "é" UTF-8 değil: latin1
        assertEquals("café=1", MilkImport.decode(byteArrayOf('c'.code.toByte(), 'a'.code.toByte(), 'f'.code.toByte(), 0xE9.toByte(), '='.code.toByte(), '1'.code.toByte())))
    }

    @Test
    fun duplicateKeyIsNamePlusContent() {
        val a = MilkImport.key("Aurora", "zoom=1")
        assertEquals(a, MilkImport.key("Aurora", "zoom=1"))
        assertNotEquals(a, MilkImport.key("Aurora", "zoom=2"))
        assertNotEquals(a, MilkImport.key("Aurora2", "zoom=1"))
        assertTrue(a.startsWith("Aurora\u0000"))
        assertEquals(40, a.substringAfter('\u0000').length)
    }

    @Test
    fun readingStopsAtTheLimit() {
        val ten = ByteArray(10) { it.toByte() }
        assertEquals(10, MilkImport.readCapped(ByteArrayInputStream(ten), 10)!!.size)
        assertNull(MilkImport.readCapped(ByteArrayInputStream(ten), 9))
        assertEquals(450 * 1024, MilkImport.MAX_BYTES)
    }

    @Test
    fun idsFollowTheDesktopShapeAndTheStoreRule() {
        repeat(20) {
            val id = MilkImport.newId()
            assertTrue(id, Regex("^md_[0-9a-f]{12}$").matches(id))
            assertTrue(ProfileStore.ID.matches(id))
        }
    }
}
