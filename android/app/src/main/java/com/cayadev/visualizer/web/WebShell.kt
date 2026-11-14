/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.web

import android.annotation.SuppressLint
import android.content.Context
import android.util.Log
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.cayadev.visualizer.export.ExportHub

/* WEBVIEW KURULUMU (docs/android/PLAN.md, D1/D2).

   Sayfalar file:// ile değil, güvenli bir yerel adresten açılır:
   https://appassets.androidplatform.net/assets/web/… WebViewAssetLoader bu
   adresi APK'nın assets/ klasöründen yanıtlar, yani ağa çıkılmaz. Güvenli
   bağlam (https) şart: WebCodecs ve mikrofon başka türlü açılmıyor.

   Motorun beklediği window.api, sayfanın kendi betiklerinden ÖNCE çalışan
   bir betikle (src/mobile/android-host.js) kurulur. Sayfaların HTML'ine
   dokunulmaz: masaüstündeki görselleştirici sayfası olduğu gibi açılır. */
object WebShell {
    const val HOST = "appassets.androidplatform.net"
    const val ORIGIN = "https://$HOST"
    private const val TAG = "SVWeb"

    fun pageUrl(path: String): String = "$ORIGIN/assets/web/$path"

    /** Gereken WebView özellikleri; biri yoksa uygulama "WebView'i güncelleyin" der. */
    val REQUIRED_FEATURES = listOf(
        WebViewFeature.WEB_MESSAGE_LISTENER,
        WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER,
        WebViewFeature.DOCUMENT_START_SCRIPT,
    )

    fun missingFeatures(): List<String> = REQUIRED_FEATURES.filter { !WebViewFeature.isFeatureSupported(it) }

    fun webViewVersion(context: Context): String =
        WebViewCompat.getCurrentWebViewPackage(context)?.versionName ?: "?"

    /**
     * WebView'i kurar. [context] Activity'den bağımsız olabilir (yüzen pencere,
     * PLAN 0E7); bu yüzden burada Activity'ye özgü hiçbir şey kullanılmaz.
     */
    @SuppressLint("SetJavaScriptEnabled")
    fun create(context: Context, debug: Boolean, page: String, onRendererGone: (WebView) -> Unit): WebView {
        if (debug) WebView.setWebContentsDebuggingEnabled(true)
        val loader = WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
            // Uygulamanın kendi medya klasörü, salt okunur (MESSAGES.md "Reading files")
            .addPathHandler("/files/", WebViewAssetLoader.InternalStoragePathHandler(context, ExportHub.mediaDir(context)))
            .build()

        val web = WebView(context)
        web.setBackgroundColor(android.graphics.Color.BLACK)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // Sayfalar yalnız kendi adresimizden gelir; yerel dosya erişimi kapalı
            allowFileAccess = false
            allowContentAccess = false
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
        }

        web.webViewClient = object : WebViewClientCompat() {
            /* Kendi adresimize gelen ve yanıtlanamayan istek (ör. tarayıcının kendiliğinden
               istediği /favicon.ico) AĞA ÇIKMAZ: 404 alır. Ölçüldü: aksi halde WebView bu
               adı DNS'te arıyor ve sayfaya "ERR_NAME_NOT_RESOLVED" hatası düşüyordu. */
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                loader.shouldInterceptRequest(request.url)?.let { return it }
                if (request.url.host == HOST) {
                    // Simge yok, bu bir hata değil: 204 tarayıcı günlüğüne hata düşürmüyor
                    val none = request.url.path == "/favicon.ico"
                    return WebResourceResponse("text/plain", "utf-8", if (none) 204 else 404, if (none) "No Content" else "Not Found", emptyMap(), java.io.ByteArrayInputStream(ByteArray(0)))
                }
                return null
            }

            /* Gezinme bekçisi: uygulamanın sayfası başka bir adrese gidemez. */
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val ours = request.url.host == HOST && request.url.scheme == "https"
                if (!ours) Log.w(TAG, "gezinme engellendi: ${request.url}")
                return !ours
            }

            /* WebView'in çizim süreci ölürse uygulama da ölmesin (PLAN 2.4). */
            override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                Log.e(TAG, "çizim süreci bitti (çökme: ${detail.didCrash()})")
                onRendererGone(view)
                return true
            }
        }

        installHostScripts(context, web, debug, page)
        return web
    }

    /* Sayfanın betiklerinden önce çalışan betikler, YALNIZ kendi adresimizde.
       Sıra önemli: önce ortam, sonra ses karesini kuran ortak kod (masaüstüyle
       aynı tayf ve halka), demo ses, ileti biçimi ve ses girişi, en son
       window.api. */
    private val HOST_SCRIPTS = listOf(
        "web/src/shared/audio-spectrum.js",
        "web/src/shared/demo-audio.js",
        "web/src/mobile/messages.js",
        "web/src/mobile/audio-input.js",
        "web/src/mobile/android-host.js",
    )

    private fun installHostScripts(context: Context, web: WebView, debug: Boolean, page: String) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return
        val origins = setOf(ORIGIN)
        val env = "window.__SV_ANDROID = Object.freeze({ debug: $debug, page: ${jsString(page)} });"
        WebViewCompat.addDocumentStartJavaScript(web, env, origins)
        for (path in HOST_SCRIPTS) WebViewCompat.addDocumentStartJavaScript(web, readAsset(context, path), origins)
    }

    private fun readAsset(context: Context, path: String): String =
        context.assets.open(path).bufferedReader(Charsets.UTF_8).use { it.readText() }

    fun jsString(s: String): String = buildString {
        append('"')
        for (c in s) {
            when (c) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '<' -> append("\\u003c")
                else -> if (c.code < 0x20) append(String.format("\\u%04x", c.code)) else append(c)
            }
        }
        append('"')
    }
}
