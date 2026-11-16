/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.store

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.file.Files
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/* Masaüstü yedeği akıştan okunuyor; arşivden yol alınmıyor. */
class BackupReaderTest {
    private fun zip(vararg entries: Pair<String, ByteArray>): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { z ->
            for ((name, data) in entries) {
                z.putNextEntry(ZipEntry(name))
                z.write(data)
                z.closeEntry()
            }
        }
        return out.toByteArray()
    }

    @Test
    fun readsPresetsBeforeTheMetaAndCountsTheRest() {
        // Masaüstündeki sıra: presetler, kitaplıklar, dokular, videolar, en son backup.json
        val data = zip(
            "presets/ps_a1.json" to "{\"id\":\"ps_a1\"}".toByteArray(),
            "presets/../evil.json" to "x".toByteArray(),
            "presets/sub/x.json" to "x".toByteArray(),
            "libs/logos/a.png" to byteArrayOf(1),
            "textures/0-noise.jpg" to byteArrayOf(2),
            "media/0-clip.mp4" to byteArrayOf(3),
            "media/1-clip.mp4" to byteArrayOf(3),
            "backup.json" to "{\"type\":\"cayadev-visualizer-backup\"}".toByteArray(),
        )
        val staging = Files.createTempDirectory("sv-import").toFile()
        val r = BackupReader.read(ByteArrayInputStream(data), staging)
        assertEquals(setOf("ps_a1"), r.presets.keys)
        assertTrue(r.presets.getValue("ps_a1").parentFile == staging)
        assertEquals("{\"type\":\"cayadev-visualizer-backup\"}", String(r.meta!!))
        assertEquals(mapOf("libs" to 1, "textures" to 1, "media" to 2), r.later)
        // Yol taşıyan adlar hiç yazılmadı
        assertFalse(java.io.File(staging.parentFile, "evil.json").exists())
        assertEquals(1, staging.listFiles()!!.size)
        staging.deleteRecursively()
    }

    @Test
    fun tooLargeEntriesAreSkippedAndTheArchiveContinues() {
        val big = ByteArray(BackupReader.MAX_PRESET + 1)
        val data = zip("presets/big.json" to big, "presets/ok.json" to "{}".toByteArray(), "backup.json" to "{}".toByteArray())
        val staging = Files.createTempDirectory("sv-import").toFile()
        val r = BackupReader.read(ByteArrayInputStream(data), staging)
        assertEquals(1, r.skipped)
        assertEquals(setOf("ok"), r.presets.keys)
        assertArrayEquals("{}".toByteArray(), r.meta)
        staging.deleteRecursively()
    }

    @Test
    fun aPlainJsonFileIsNotAZipAndAZipWithoutMetaHasNone() {
        assertFalse(BackupReader.isZip("{\"ui\":1}".toByteArray()))
        val data = zip("presets/a.json" to "{}".toByteArray())
        assertTrue(BackupReader.isZip(data.copyOf(4)))
        val staging = Files.createTempDirectory("sv-import").toFile()
        assertNull(BackupReader.read(ByteArrayInputStream(data), staging).meta)
        staging.deleteRecursively()
    }

    @Test
    fun ratingMatchesTheDesktopRule() {
        assertEquals(3.0, PresetRating.of(null), 0.0)
        assertEquals(3.0, PresetRating.of("[preset00]\nzoom=1"), 0.0)
        assertEquals(4.0, PresetRating.of("[preset00]\nfRating=4.000000\nzoom=1"), 0.0)
        assertEquals(2.5, PresetRating.of("  FRATING = 2.5"), 0.0)
        assertEquals(5.0, PresetRating.of("fRating=9"), 0.0)
        assertEquals(0.0, PresetRating.of("fRating=-1"), 0.0)
        assertEquals(3.0, PresetRating.of("x fRating=1"), 0.0)
    }
}
