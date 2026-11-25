/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.update

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/* Yeni sürüm uyarısı: GitHub'ın sürüm listesinden karar. Ağ yok; yanıtlar elle yazılmış
   örnekler (gerçek bir Android sürümü henüz yayımlanmadı). */
class AppUpdateTest {
    private fun rel(tag: String, draft: Boolean = false, pre: Boolean = false, body: String = "", url: String? = null, apk: Long = 0) =
        JSONObject().put("tag_name", tag).put("name", "SoundVisualizer " + tag).put("draft", draft).put("prerelease", pre)
            .put("body", body).put("published_at", "2026-12-01T10:00:00Z")
            .put("html_url", url ?: "https://github.com/CaYatur/SoundVisualizer/releases/tag/$tag")
            .put("assets", JSONArray().apply { if (apk > 0) put(JSONObject().put("name", "SoundVisualizer-$tag.apk").put("size", apk)) })

    private fun list(vararg r: JSONObject) = JSONArray().apply { r.forEach { put(it) } }.toString()

    @Test
    fun parsesVersionsAndIgnoresTheDevSuffix() {
        assertArrayEquals(intArrayOf(1, 2, 3), AppUpdate.parse("1.2.3"))
        assertArrayEquals(intArrayOf(1, 0, 0), AppUpdate.parse("1.0.0-dev"))
        assertArrayEquals(intArrayOf(4, 0, 1), AppUpdate.parse("v4.0.1"))
        assertNull(AppUpdate.parse("abc"))
        assertNull(AppUpdate.parse(""))
        assertTrue(AppUpdate.compare(intArrayOf(1, 10, 0), intArrayOf(1, 9, 9)) > 0)
        assertEquals(0, AppUpdate.compare(intArrayOf(1, 0, 0), intArrayOf(1, 0, 0)))
    }

    @Test
    fun onlyAndroidTagsCountAndDesktopReleasesAreIgnored() {
        // Masaüstü sürümleri (v4.0.0) aynı sayfada; Android uygulaması onları görmez
        val s = AppUpdate.evaluate(list(rel("v4.0.0"), rel("v9.9.9"), rel("android-v1.1.0")), "1.0.0", null)
        assertEquals("available", s.getString("status"))
        assertEquals("1.1.0", s.getString("latest"))
    }

    @Test
    fun noAndroidReleaseYetIsNotAnError() {
        val s = AppUpdate.evaluate(list(rel("v4.0.0"), rel("v3.1.7")), "1.0.0-dev", null)
        assertEquals("none", s.getString("status"))
        assertFalse(s.has("error"))
        assertEquals("none", AppUpdate.evaluate("[]", "1.0.0", null).getString("status"))
    }

    @Test
    fun draftsAndPrereleasesAreSkippedAndTheHighestWins() {
        val s = AppUpdate.evaluate(
            list(rel("android-v1.3.0", draft = true), rel("android-v1.4.0", pre = true), rel("android-v1.0.2"), rel("android-v1.2.0"), rel("android-v1.10.0-beta")),
            "1.0.0", null,
        )
        assertEquals("1.2.0", s.getString("latest"))
    }

    @Test
    fun sameOrOlderMeansUpToDateAndADevBuildOfThatVersionToo() {
        assertEquals("latest", AppUpdate.evaluate(list(rel("android-v1.0.0")), "1.0.0", null).getString("status"))
        assertEquals("latest", AppUpdate.evaluate(list(rel("android-v1.0.0")), "1.0.0-dev", null).getString("status"))
        assertEquals("latest", AppUpdate.evaluate(list(rel("android-v0.9.0")), "1.0.0", null).getString("status"))
        assertFalse(AppUpdate.evaluate(list(rel("android-v1.0.0", body = "notlar")), "1.0.0", null).has("notes"))
    }

    @Test
    fun skippedVersionIsMarkedButStillReported() {
        val s = AppUpdate.evaluate(list(rel("android-v1.1.0")), "1.0.0", "1.1.0")
        assertEquals("available", s.getString("status"))
        assertTrue(s.getBoolean("skipped"))
        // Daha yeni bir sürüm çıkınca atlama geçersiz
        assertFalse(AppUpdate.evaluate(list(rel("android-v1.2.0")), "1.0.0", "1.1.0").getBoolean("skipped"))
    }

    @Test
    fun onlyThisRepositorysGithubPageCanBeOpened() {
        val ok = AppUpdate.evaluate(list(rel("android-v1.1.0")), "1.0.0", null)
        assertEquals("https://github.com/CaYatur/SoundVisualizer/releases/tag/android-v1.1.0", ok.getString("url"))
        for (bad in listOf("https://evil.example/x", "http://github.com/CaYatur/SoundVisualizer/x", "https://github.com/someone/else", "javascript:alert(1)", "https://github.com/CaYatur/SoundVisualizer/ x")) {
            assertEquals(bad, AppUpdate.RELEASES_PAGE, AppUpdate.evaluate(list(rel("android-v1.1.0", url = bad)), "1.0.0", null).getString("url"))
        }
    }

    @Test
    fun notesBecomePlainTextAndLongNotesAreCut() {
        val n = AppUpdate.plainNotes("## Yenilikler\r\n\r\n- **PC bağlantısı** artık `QR` ile\n* [Belge](https://x.y) eklendi\n<!-- gizli -->\n\n\n\nSon")
        assertEquals("Yenilikler\n\n• PC bağlantısı artık QR ile\n• Belge eklendi\n\nSon", n)
        val long = AppUpdate.plainNotes("a".repeat(5000))
        assertEquals(1501, long.length)
        assertTrue(long.endsWith("…"))
    }

    @Test
    fun apkSizeIsReportedWhenTheReleaseHasOne() {
        assertEquals(19_000_000L, AppUpdate.evaluate(list(rel("android-v1.1.0", apk = 19_000_000)), "1.0.0", null).getLong("apkBytes"))
        assertFalse(AppUpdate.evaluate(list(rel("android-v1.1.0")), "1.0.0", null).has("apkBytes"))
    }

    @Test
    fun badResponsesAndHttpErrorsAreNamed() {
        assertEquals("bad-response", AppUpdate.evaluate("<html>", "1.0.0", null).getString("error"))
        assertEquals("bad-response", AppUpdate.evaluate("{\"message\":\"x\"}", "1.0.0", null).getString("error"))
        assertEquals("bad-version", AppUpdate.evaluate("[]", "?", null).getString("error"))
        assertEquals("rate", AppUpdate.check("1.0.0", null) { AppUpdate.HttpResult(403, null) }.getString("error"))
        assertEquals("rate", AppUpdate.check("1.0.0", null) { AppUpdate.HttpResult(429, null) }.getString("error"))
        assertEquals("server", AppUpdate.check("1.0.0", null) { AppUpdate.HttpResult(502, null) }.getString("error"))
        assertEquals("too-large", AppUpdate.check("1.0.0", null) { AppUpdate.HttpResult(-2, null) }.getString("error"))
        assertEquals("offline", AppUpdate.check("1.0.0", null) { throw java.net.UnknownHostException("api.github.com") }.getString("error"))
        assertEquals("timeout", AppUpdate.check("1.0.0", null) { throw java.net.SocketTimeoutException() }.getString("error"))
    }

    @Test
    fun checkAsksTheFixedListAddressOnly() {
        var asked = ""
        val s = AppUpdate.check("1.0.0", null) { u -> asked = u; AppUpdate.HttpResult(200, list(rel("android-v1.0.1"))) }
        assertEquals("https://api.github.com/repos/CaYatur/SoundVisualizer/releases?per_page=40", asked)
        assertEquals("available", s.getString("status"))
    }

    @Test
    fun hugeVersionNumbersDoNotCrash() {
        assertEquals("none", AppUpdate.evaluate(list(rel("android-v99999999999.0.0")), "1.0.0", null).getString("status"))
    }
}
