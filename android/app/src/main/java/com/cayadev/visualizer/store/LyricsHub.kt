/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.store

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.File
import java.util.concurrent.Executors
import org.json.JSONObject

/* SÖZLERİN İŞ YERİ: kitaplık (LyricsLibrary) ve otomatik bulma (LyricsLookup) disk ve ağ işi
   yaptığı için tek bir arka iş parçacığında; yanıt ana iş parçacığında. Kitaplık değişince
   sayfaya `lyricsLib` olayıyla metinli liste gider (masaüstündeki publishLyricsLib). */
object LyricsHub {
    private const val TAG = "SVLyrics"
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    lateinit var library: LyricsLibrary
        private set
    private lateinit var cacheDir: File
    private lateinit var app: Context

    /** Kitaplık değişince (sayfaya olay). */
    var events: ((org.json.JSONArray) -> Unit)? = null

    fun init(ctx: Context) {
        if (::library.isInitialized) return
        app = ctx.applicationContext
        library = LyricsLibrary(File(app.filesDir, "lyrics-library"))
        cacheDir = File(app.filesDir, "lyrics-cache")
    }

    fun <T> run(done: (T?, String?) -> Unit, publish: Boolean = false, work: () -> T) {
        worker.execute {
            try {
                val r = work()
                val snap = if (publish) library.snapshot() else null
                main.post {
                    done(r, null)
                    if (snap != null) events?.invoke(snap)
                }
            } catch (e: Exception) {
                Log.w(TAG, "söz işi başarısız", e)
                main.post { done(null, e.javaClass.simpleName + ": " + (e.message ?: "")) }
            }
        }
    }

    fun importUris(uris: List<Uri>, done: (JSONObject?, String?) -> Unit) = run(done, publish = true) {
        library.importAll(uris.map { u ->
            Pair(com.cayadev.visualizer.media.MediaPick.displayName(app, u).ifEmpty { "lyrics.lrc" }) { app.contentResolver.openInputStream(u) }
        })
    }

    fun lookup(config: JSONObject?, meta: JSONObject, done: (JSONObject?, String?) -> Unit) = run(done) {
        LyricsLookup.lookup(
            config,
            LyricsLookup.Meta(meta.optString("title"), meta.optString("artist"), meta.optString("album"), meta.optDouble("duration", 0.0)),
            cacheDir,
        ) ?: JSONObject()
    }

    /** Seçilen şarkının etiketleri (Dışa Aktar sayfası gösterir). */
    fun audioTags(uri: Uri, done: (JSONObject?, String?) -> Unit) = run(done) {
        com.cayadev.visualizer.export.ExportFlow.trackOf(app, uri, com.cayadev.visualizer.media.MediaPick.displayName(app, uri))
    }

    fun clearCache(done: (JSONObject?, String?) -> Unit) = run(done) { JSONObject().put("removed", LyricsLookup.clearCache(cacheDir)) }

    /* Şarkının başındaki ID3 etiketi (gömülü söz; ayrıştırma sayfada, src/shared/id3-lyrics.js).
       Yalnız etiket okunur, en çok 4 MB (kapak resmi büyük olabilir); etiket yoksa boş. */
    fun audioHead(uri: Uri, done: (JSONObject?, String?) -> Unit) = run(done) {
        app.contentResolver.openInputStream(uri).use { input ->
            requireNotNull(input) { "açılamadı" }
            val head = ByteArray(10)
            var n = 0
            while (n < 10) { val r = input.read(head, n, 10 - n); if (r < 0) break; n += r }
            if (n < 10 || head[0] != 'I'.code.toByte() || head[1] != 'D'.code.toByte() || head[2] != '3'.code.toByte()) return@run JSONObject()
            val size = ((head[6].toInt() and 0x7f) shl 21) or ((head[7].toInt() and 0x7f) shl 14) or ((head[8].toInt() and 0x7f) shl 7) or (head[9].toInt() and 0x7f)
            val want = minOf(10 + size, 4 * 1024 * 1024)
            val buf = ByteArray(want)
            System.arraycopy(head, 0, buf, 0, 10)
            var got = 10
            while (got < want) { val r = input.read(buf, got, want - got); if (r < 0) break; got += r }
            JSONObject().put("b64", android.util.Base64.encodeToString(buf, 0, got, android.util.Base64.NO_WRAP)).put("bytes", got)
        }
    }
}
