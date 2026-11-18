/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.store

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.file.Files

/* Telefonun yazdığı arşiv telefonun okuyucusundan geçer; yalnız seçilen bölümler girer. */
class BackupWriterTest {
    private fun fixture(): File {
        val root = Files.createTempDirectory("svb").toFile()
        File(root, "presets").mkdirs()
        File(root, "presets/p_1.json").writeText("{\"id\":\"p_1\",\"name\":\"Bir\"}")
        File(root, "presets/bad name.json").writeText("{}")
        File(root, "textures").mkdirs()
        File(root, "textures/Duman Doku.png").writeBytes(byteArrayOf(1, 2, 3))
        val logos = File(root, "logo-library").also { it.mkdirs() }
        File(logos, "a.png").writeBytes(byteArrayOf(9, 8))
        File(logos, "manifest.json").writeText("{\"items\":[{\"id\":\"l1\",\"name\":\"A\",\"file\":\"a.png\"},{\"id\":\"l2\",\"file\":\"yok.png\"}]}")
        val lyr = File(root, "lyrics-library").also { it.mkdirs() }
        File(lyr, "s.lrc").writeText("[00:01.00]Söz")
        File(lyr, "manifest.json").writeText("{\"items\":[{\"id\":\"s1\",\"name\":\"S\",\"file\":\"s.lrc\"}]}")
        return root
    }

    private fun build(root: File, sections: Set<String>, videos: List<BackupWriter.Video> = emptyList()): ByteArray {
        val out = ByteArrayOutputStream()
        BackupWriter.write(out, BackupWriter.Source(root, File(root, "presets"), File(root, "textures"), "https://o", sections,
            "{\"scenes\":[{\"id\":\"s\"}]}", "{\"sv-x\":\"1\"}", "1.2", "2026-11-19T00:00:00Z", videos))
        return out.toByteArray()
    }

    @Test fun `tüm bölümler okuyucudan geçer`() {
        val root = fixture()
        val v = BackupWriter.Video("https://o/content/abc", "Klip Bir.MP4", 3, { ByteArrayInputStream(byteArrayOf(5, 6, 7)) })
        val bytes = build(root, setOf("settings", "scenes", "presets", "logos", "lyrics", "videos", "textures"), listOf(v))
        val r = BackupReader.read(ByteArrayInputStream(bytes), File(root, "stage"))
        val meta = JSONObject(String(r.meta!!, Charsets.UTF_8))
        assertEquals(BackupWriter.TYPE, meta.getString("type"))
        assertEquals(1, meta.getInt("format"))
        assertEquals("android", meta.getString("platform"))
        assertEquals("s", meta.getJSONObject("settings").getJSONArray("scenes").getJSONObject(0).getString("id"))
        assertEquals("1", meta.getJSONObject("phone").getJSONObject("local").getString("sv-x"))
        assertEquals(setOf("p_1"), r.presets.keys)
        assertEquals(setOf("logos/a.png", "lyrics/s.lrc"), r.libs.keys)
        assertEquals(1, meta.getJSONObject("libraries").getJSONObject("logos").getJSONArray("items").length())
        val t = meta.getJSONArray("textures").getJSONObject(0)
        assertEquals("Duman Doku.png", t.getString("name"))
        assertTrue(BackupReader.TEXTURE.matches(t.getString("path")))
        val m = meta.getJSONArray("media").getJSONObject(0)
        assertEquals("https://o/content/abc", m.getString("ref"))
        assertTrue(BackupReader.MEDIA.matches(m.getString("path")))
        assertEquals(1, r.media.size)
        assertEquals(0, r.skipped)
    }

    @Test fun `seçilmeyen bölüm arşive girmez`() {
        val root = fixture()
        val r = BackupReader.read(ByteArrayInputStream(build(root, setOf("lyrics"))), File(root, "stage"))
        assertTrue(r.presets.isEmpty())
        assertTrue(r.textures.isEmpty())
        assertEquals(setOf("lyrics/s.lrc"), r.libs.keys)
        assertFalse(JSONObject(String(r.meta!!, Charsets.UTF_8)).getJSONObject("libraries").has("logos"))
    }

    @Test fun `arşiv adı masaüstündeki gibi`() {
        assertEquals("duman-doku.png", BackupWriter.slug("Duman Doku.PNG"))
        assertEquals("file.mp4", BackupWriter.slug("şş.mp4".replace("ş", "!")))
    }

    @Test fun `iptal yarım arşivi bırakır ve hata verir`() {
        val root = fixture()
        var failed = false
        try {
            BackupWriter.write(ByteArrayOutputStream(), BackupWriter.Source(root, File(root, "presets"), File(root, "textures"), "https://o", setOf("presets"), "{}", "{}", "1", "t"), cancelled = { true })
        } catch (_: InterruptedException) { failed = true }
        assertTrue(failed)
    }
}
