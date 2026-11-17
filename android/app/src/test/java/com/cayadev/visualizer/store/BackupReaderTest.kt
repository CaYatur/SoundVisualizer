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
        // Kitaplık dosyaları ve videolar da geçici klasöre alınıyor (Faz 4); sınır aşılmadı
        assertEquals(mapOf("libs" to 0, "media" to 0), r.later)
        assertEquals(setOf("logos/a.png"), r.libs.keys)
        assertEquals(setOf("0-clip.mp4", "1-clip.mp4"), r.media.keys)
        assertEquals(setOf("0-noise.jpg"), r.textures.keys)
        assertArrayEquals(byteArrayOf(2), r.textures.getValue("0-noise.jpg").readBytes())
        // Yol taşıyan adlar hiç yazılmadı
        assertFalse(java.io.File(staging.parentFile, "evil.json").exists())
        assertEquals(setOf("ps_a1.json", "textures", "libs", "media", "backup.json"), staging.listFiles()!!.map { it.name }.toSet())
        staging.deleteRecursively()
    }

    @Test
    fun librariesAreRestoredLikeTheDesktopAndVideosRemapped() {
        val meta = org.json.JSONObject()
            .put("type", "cayadev-visualizer-backup")
            .put("libraries", org.json.JSONObject()
                .put("lyrics", org.json.JSONObject().put("items", org.json.JSONArray()
                    .put(org.json.JSONObject().put("id", "lyr_1").put("file", "lyr_1.lrc").put("path", "libs/lyrics/lyr_1.lrc").put("artist", "Ayna").put("title", "Gece").put("name", "Ayna - Gece"))))
                .put("logos", org.json.JSONObject().put("items", org.json.JSONArray()
                    .put(org.json.JSONObject().put("id", "img_1").put("file", "img_1.png").put("path", "libs/logos/img_1.png").put("mime", "image/png").put("name", "Logo"))
                    // Yolu tutmayan kayıt atlanır
                    .put(org.json.JSONObject().put("id", "img_2").put("file", "img_2.png").put("path", "libs/logos/başka.png"))))
                .put("media", org.json.JSONObject().put("items", org.json.JSONArray()
                    .put(org.json.JSONObject().put("id", "vid_1").put("file", "vid_1.mp4").put("path", "libs/media/vid_1.mp4").put("ref", "C:\\Videolar\\klip.mp4")))))
            .put("media", org.json.JSONArray().put(org.json.JSONObject().put("ref", "D:\\a b.mp4").put("path", "media/0-a-b.mp4").put("name", "a b.mp4")))
        val data = zip(
            "libs/lyrics/lyr_1.lrc" to "[00:01.00]Bir".toByteArray(),
            "libs/logos/img_1.png" to byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47),
            "libs/logos/img_2.png" to byteArrayOf(1),
            "libs/media/vid_1.mp4" to byteArrayOf(9, 9),
            "media/0-a-b.mp4" to byteArrayOf(7),
            "backup.json" to meta.toString().toByteArray(),
        )
        val staging = Files.createTempDirectory("sv-import").toFile()
        val files = Files.createTempDirectory("sv-files").toFile()
        BackupReader.read(ByteArrayInputStream(data), staging)
        val r = LibraryRestore.restore(staging, files, "https://appassets.androidplatform.net")
        assertEquals(1, r.getInt("lyrics"))
        assertEquals(1, r.getInt("logos"))
        assertEquals(2, r.getInt("videos"))
        assertEquals(1, r.getInt("skipped"))
        val map = r.getJSONObject("map")
        assertEquals("https://appassets.androidplatform.net/files/lib-media/vid_1.mp4", map.getString("C:\\Videolar\\klip.mp4"))
        assertEquals("https://appassets.androidplatform.net/files/restored/0-a-b.mp4", map.getString("D:\\a b.mp4"))
        // Söz kitaplığı telefonun biçiminde okunur
        val lyr = LyricsLibrary(java.io.File(files, "lyrics-library")).read("lyr_1")
        assertEquals("[00:01.00]Bir", lyr!!.getString("text"))
        assertEquals("Ayna", lyr.getString("artist"))
        // Logo motora base64 gider
        val logo = LibraryRestore.readLogo(files, "img_1")
        assertEquals("image/png", logo!!.getString("mime"))
        assertTrue(LibraryRestore.readLogo(files, "../x") == null)
        staging.deleteRecursively()
        files.deleteRecursively()
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
    fun textureEntriesOutsideTheDesktopNamingAreNotStaged() {
        val data = zip("textures/../x.jpg" to byteArrayOf(1), "textures/Big Name.png" to byteArrayOf(1), "textures/a/b.png" to byteArrayOf(1), "textures/3-ok.png" to byteArrayOf(1))
        val staging = Files.createTempDirectory("sv-import").toFile()
        val r = BackupReader.read(ByteArrayInputStream(data), staging)
        assertEquals(setOf("3-ok.png"), r.textures.keys)
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
