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

    fun clearCache(done: (JSONObject?, String?) -> Unit) = run(done) { JSONObject().put("removed", LyricsLookup.clearCache(cacheDir)) }
}
