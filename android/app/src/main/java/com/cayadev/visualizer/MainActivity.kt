/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer

import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.cayadev.visualizer.bridge.Bridge
import com.cayadev.visualizer.web.WebShell

/* 0E İSKELETİ (docs/android/PLAN.md). Değiştirilmemiş görselleştirici sayfası
   tam ekranda, demo sesle açılır. Mobil arayüz Faz 3'te gelir. */
class MainActivity : ComponentActivity() {
    private var web: WebView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        immersive()

        val missing = WebShell.missingFeatures()
        if (missing.isNotEmpty()) {
            // Faz 3'te tasarım diliyle bir ekran olacak; şimdilik düz metin
            Log.e(TAG, "eksik WebView özellikleri: $missing")
            setContentView(TextView(this).apply {
                text = getString(R.string.webview_too_old, WebShell.webViewVersion(this@MainActivity), missing.joinToString())
                setPadding(48, 48, 48, 48)
            })
            return
        }
        start()
    }

    private fun start() {
        // Sayfa seçimi yalnız geliştirme sürümünde (ölçüm sayfaları için)
        val page = (if (BuildConfig.DEBUG) intent?.getStringExtra(EXTRA_PAGE) else null) ?: DEFAULT_PAGE
        val w = WebShell.create(applicationContext, BuildConfig.DEBUG, page) { dead -> rebuild(dead) }
        Bridge(applicationContext).install(w)
        setContentView(w, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        w.loadUrl(WebShell.pageUrl(page))
        web = w
        Log.i(TAG, "sayfa: $page, WebView ${WebShell.webViewVersion(this)}")
    }

    /* Çizim süreci öldüyse eski WebView'i bırakıp yenisini kur. */
    private fun rebuild(dead: WebView) {
        (dead.parent as? ViewGroup)?.removeView(dead)
        dead.destroy()
        web = null
        start()
    }

    private fun immersive() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    override fun onResume() {
        super.onResume()
        web?.onResume()
    }

    override fun onPause() {
        web?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        web?.let {
            (it.parent as? ViewGroup)?.removeView(it)
            it.destroy()
        }
        web = null
        super.onDestroy()
    }

    companion object {
        private const val TAG = "SVMain"
        const val EXTRA_PAGE = "page"
        const val DEFAULT_PAGE = "src/visualizer/index.html"
    }
}
