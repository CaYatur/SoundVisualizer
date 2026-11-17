/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.store

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

/* Söz kitaplığı ve otomatik bulma: kurallar masaüstüyle aynı (src/main/lyrics-library.js,
   src/main/lyrics-lookup.js). Ağ yok: sağlayıcı isteği sahte bir işlevle. */
class LyricsTest {
    private fun tmp(): File = Files.createTempDirectory("sv-lyrics").toFile()

    // ---- Kitaplık ----
    @Test
    fun guessesArtistAndTitleLikeTheDesktop() {
        assertEquals("Ayna" to "Gece Yol", LyricsLibrary.guessMeta("", "Ayna - Gece Yol.lrc"))
        assertEquals("Etiket" to "Başlık", LyricsLibrary.guessMeta("[ar:Etiket]\n[ti:Başlık]\n[00:01.00]a", "Dosya - Adı.lrc"))
        assertEquals("" to "Tek", LyricsLibrary.guessMeta("", "Tek.txt"))
        assertEquals("A" to "B - C", LyricsLibrary.guessMeta("", "A - B - C.srt"))
    }

    @Test
    fun addsListsReadsAndRejectsDuplicates() {
        val lib = LyricsLibrary(tmp())
        val text = "﻿[ar:Ayna]\n[ti:Gece Yol]\n[00:01.00]Birinci\n[00:03.00]İkinci\n"
        val r = lib.add("Ayna - Gece Yol.lrc", text.toByteArray(Charsets.UTF_8))
        assertTrue(r.toString(), r.getBoolean("ok"))
        val id = r.getJSONObject("item").getString("id")
        assertTrue(id.startsWith("lyr_"))
        assertEquals("Ayna", r.getJSONObject("item").getString("artist"))
        assertEquals("Gece Yol", r.getJSONObject("item").getString("title"))
        // BOM atılır
        assertEquals(text.substring(1), lib.read(id)!!.getString("text"))
        // Aynı metin ikinci kez eklenmez
        val again = lib.add("başka ad.lrc", text.toByteArray(Charsets.UTF_8))
        assertFalse(again.getBoolean("ok"))
        assertEquals("DUPLICATE", again.getString("error"))
        assertEquals(1, lib.list().length())
        val snap = lib.snapshot()
        assertEquals(1, snap.length())
        assertTrue(snap.getJSONObject(0).getString("text").contains("Birinci"))
    }

    @Test
    fun rejectsWrongTypeEmptyHugeAndBinary() {
        val lib = LyricsLibrary(tmp())
        assertEquals("TYPE", lib.add("a.mp3", "x".toByteArray()).getString("error"))
        assertEquals("SIZE", lib.add("a.lrc", ByteArray(0)).getString("error"))
        assertEquals("SIZE", lib.add("a.lrc", ByteArray(LyricsLibrary.MAX_BYTES + 1) { 'a'.code.toByte() }).getString("error"))
        assertEquals("TYPE", lib.add("a.lrc", byteArrayOf(0x61, 0x00, 0x62)).getString("error"))
        assertEquals(0, lib.list().length())
    }

    @Test
    fun manualEntryUpdateAndRemove() {
        val lib = LyricsLibrary(tmp())
        val r = lib.add("Elle.lrc", "[00:00.50]Merhaba".toByteArray(), "Sanatçı", "Parça")
        val id = r.getJSONObject("item").getString("id")
        assertEquals("Sanatçı", r.getJSONObject("item").getString("artist"))
        val u = lib.update(id, JSONObject().put("title", "Yeni").put("text", "[00:01.00]Değişti"))
        assertTrue(u.getBoolean("ok"))
        assertEquals("Yeni", lib.read(id)!!.getString("title"))
        assertEquals("[00:01.00]Değişti", lib.read(id)!!.getString("text"))
        lib.remove(id)
        assertEquals(0, lib.list().length())
        assertNull(lib.read(id))
    }

    @Test
    fun manifestCannotPointOutsideTheFolder() {
        val dir = tmp()
        File(dir.parentFile, "dışarı.lrc").writeText("gizli")
        File(dir, "manifest.json").writeText(JSONObject().put("items", JSONArray().put(JSONObject().put("id", "lyr_x").put("file", "../dışarı.lrc"))).toString())
        assertNull(LyricsLibrary(dir).read("lyr_x"))
    }

    // ---- Otomatik bulma ----
    private val meta = LyricsLookup.Meta("Gece Yol", "Ayna", "İkinci", 201.4)

    @Test
    fun templateIsUrlEncodedLikeEncodeUriComponent() {
        assertEquals(
            "https://x/get?a=Ayna&t=Gece%20Yol&al=%C4%B0kinci&d=201&z=",
            LyricsLookup.fillTemplate("https://x/get?a={artist}&t={title}&al={album}&d={duration}&z={nope}", meta),
        )
    }

    @Test
    fun jsonPathAndPlausibility() {
        val root = JSONObject("{\"a\":{\"b\":[{\"c\":\"söz\"}]}}")
        assertEquals("söz", LyricsLookup.pickPath(root, "a.b.0.c"))
        assertNull(LyricsLookup.pickPath(root, "a.x"))
        assertTrue(LyricsLookup.plausible("[00:01.00] satır"))
        assertFalse(LyricsLookup.plausible("<!DOCTYPE html><html>"))
        assertFalse(LyricsLookup.plausible("{\"error\":1}"))
        assertFalse(LyricsLookup.plausible("   "))
    }

    private fun cfg(vararg providers: JSONObject, enabled: Boolean = true) =
        JSONObject().put("enabled", enabled).put("providers", JSONArray(providers.toList()))

    @Test
    fun noProvidersOrDisabledMeansNoNetwork() {
        val calls = mutableListOf<String>()
        val get: (String, String, Int) -> String? = { u, _, _ -> calls.add(u); null }
        assertNull(LyricsLookup.lookup(cfg(), meta, tmp(), get))
        assertNull(LyricsLookup.lookup(cfg(JSONObject().put("url", "https://a/{title}"), enabled = false), meta, tmp(), get))
        assertTrue(calls.isEmpty())
    }

    @Test
    fun providersInOrderThenCache() {
        val cache = tmp()
        val calls = mutableListOf<String>()
        val get: (String, String, Int) -> String? = { u, _, _ ->
            calls.add(u)
            when {
                u.startsWith("https://bad") -> "<html>hata</html>"
                u.startsWith("https://good") -> "{\"syncedLyrics\":\"[00:01.00]Birinci\"}"
                else -> null
            }
        }
        val c = cfg(
            JSONObject().put("name", "Bozuk").put("url", "https://bad/{title}").put("format", "lrc"),
            JSONObject().put("name", "Kapalı").put("url", "https://off/{title}").put("enabled", false),
            JSONObject().put("name", "İyi").put("url", "https://good/{artist}/{title}").put("format", "json").put("path", "syncedLyrics"),
        )
        val r = LyricsLookup.lookup(c, meta, cache, get)
        assertNotNull(r)
        assertEquals("[00:01.00]Birinci", r!!.getString("text"))
        assertEquals("provider", r.getString("source"))
        assertEquals("İyi", r.getString("provider"))
        assertEquals(listOf("https://bad/Gece%20Yol", "https://good/Ayna/Gece%20Yol"), calls)
        // İkinci kez ağa çıkılmaz: önbellek
        calls.clear()
        val again = LyricsLookup.lookup(c, meta, cache, get)
        assertEquals("cache", again!!.getString("source"))
        assertTrue(calls.isEmpty())
        assertEquals(1, LyricsLookup.clearCache(cache))
    }

    @Test
    fun onlyHttpProvidersUpToEight() {
        val list = (1..10).map { JSONObject().put("url", "https://p$it/{title}") } + JSONObject().put("url", "file:///etc/passwd")
        val c = LyricsLookup.sanitize(JSONObject().put("providers", JSONArray(list)))
        assertEquals(8, c.providers.size)
        assertTrue(c.providers.all { it.url.startsWith("https://") })
        assertEquals(4000, c.timeoutMs)
        assertFalse(c.enabled)
    }
}
