/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.web

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.cayadev.visualizer.EngineHost
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

    /* Görselleştirici sayfasında uyarlanır çözünürlük açık: kare kaçınca motor çizim ölçeğini
       kendisi düşürür (src/shared/adaptive-scale.js; masaüstünde çıkış penceresi de böyle açılıyor). */
    fun pageUrl(path: String): String =
        "$ORIGIN/assets/web/$path" + if (path == "src/visualizer/index.html") "?svAdaptive=1" else ""

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
        val appContext = context.applicationContext
        val loader = WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
            // Uygulamanın kendi medya klasörü, salt okunur (MESSAGES.md "Reading files")
            .addPathHandler("/files/", WebViewAssetLoader.InternalStoragePathHandler(context, ExportHub.mediaDir(context)))
            // Galeriden seçilen videolar, kopyalanmadan; yalnız kalıcı izni olanlar
            .addPathHandler(ContentPathHandler.PREFIX, ContentPathHandler(context))
            .build()

        /* Ekranı açık tutmaya yalnız kullanıcının ayarı karar verir (EngineHost.keepAwake,
           motorun kapsayıcısında). Chromium WebView'in kendi keepScreenOn'unu açıyor ve
           uygulama her öne geldiğinde yeniden açıyordu: ayar kapalıyken ekran yine de
           kararmıyordu (ölçüldü: boş ölçüm sayfasında bile WebView'in bayrağı açık,
           kapsayıcınınki kapalı; WebView'inki indirilince mHoldScreenWindow boşaldı, uygulama
           arkaya alınıp açılınca geri geldi). Ayar açıkken kapsayıcı zaten tutuyor. */
        val web = object : WebView(context) {
            override fun setKeepScreenOn(keepScreenOn: Boolean) = super.setKeepScreenOn(false)
        }
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
                MediaRange.serve(appContext, request)?.let { return it }
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

        /* Kamera katmanı (Faz 4): yalnız kendi adresimizin yalnız kamera isteği onaylanır.
           Uygulamanın kamera izni yoksa Android sorar (Activity açıksa; yüzen pencerede
           sorulamaz, istek reddedilir ve katman "izin verilmedi" der). Mikrofon WebView'den
           istenmez: ses uygulamanın kendi yakalamasından gelir. */
        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val video = PermissionRequest.RESOURCE_VIDEO_CAPTURE
                val ours = request.origin?.host == HOST && request.origin?.scheme == "https"
                if (!ours || request.resources.isEmpty() || request.resources.any { it != video }) { request.deny(); return }
                val app = context.applicationContext
                if (ContextCompat.checkSelfPermission(app, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(arrayOf(video))
                    return
                }
                val a = EngineHost.activity
                if (a == null) { request.deny(); return }
                a.requestCamera { ok -> if (ok) request.grant(arrayOf(video)) else request.deny() }
            }
        }

        installHostScripts(context, web, debug, page)
        return web
    }

    /* Sayfanın betiklerinden önce çalışan betikler, YALNIZ kendi adresimizde.
       Sıra önemli: önce ortam, sonra ses karesini kuran ortak kod (masaüstüyle
       aynı tayf ve halka), demo ses, ayar dosyalarının biçimi ve v4 göçü,
       ileti biçimi, ses girişi ve sessizlik algılama, window.api; en son arayüz
       temaları ve mobil arayüz kabuğu (sayfanın betikleri bitince kurulur). */
    private val HOST_SCRIPTS = listOf(
        "web/src/shared/audio-spectrum.js",
        "web/src/shared/demo-audio.js",
        "web/src/shared/migrate-v4.js",
        "web/src/mobile/profile-store.js",
        "web/src/mobile/messages.js",
        "web/src/mobile/audio-input.js",
        "web/src/mobile/silence.js",
        "web/src/shared/backup-sections.js",
        // PC bağlantısının uzak ayar deposu (android-host.js hedef PC iken kullanır)
        "web/src/shared/json-delta.js",
        "web/src/mobile/pc-remote.js",
        "web/src/shared/link-phone.js",
        "web/src/mobile/android-host.js",
        "web/src/shared/ui-themes.js",
        "web/src/shared/mode-catalog.js",
        "web/src/shared/autovj.js",
        "web/src/shared/layer-factory.js",
        "web/src/shared/text-fold.js",
        // Zaman çizelgesi düzenleme işlemleri (böl, çoğalt, geri al): src/mobile/shell-timeline.js
        "web/src/shared/timeline-edit.js",
        // Otomasyon hedef kataloğu masaüstünün modülasyon panelinden (yükte panel gerektirmiyor)
        "web/src/admin/modulation-panel.js",
        // YouTube bölüm listesi (zaman çizelgesi işaretlerinden)
        "web/src/shared/export-formats.js",
        // LRCLIB hazır şablonu (Kitaplık → Sözler → Otomatik Bul)
        "web/src/shared/lyrics-providers.js",
        // Şarkıya gömülü söz (ID3 USLT/SYLT): masaüstündeki ayrıştırıcının ortam bağımsız hâli
        "web/src/shared/id3-lyrics.js",
        // Yedekteki sahne video yolları (sv-media://) eşlenirken
        "web/src/shared/media-url.js",
        // Motorun ses nesnesini kurulduğu an yakalar (sayfanın betiklerinden önce olmalı)
        "web/src/mobile/autovj.js",
        // Kullanıcı presetlerinin önizlemesi telefonda (Kitaplık kullanır)
        "web/src/mobile/preview-live.js",
        "web/src/mobile/shell.js",
        "web/src/mobile/shell-controls.js",
        "web/src/mobile/shell-nowplaying.js",
        "web/src/mobile/shell-text.js",
        "web/src/mobile/shell-layers.js",
        "web/src/mobile/dynamic-theme.js",
        "web/src/mobile/shell-scene.js",
        "web/src/mobile/shell-audio.js",
        "web/src/mobile/shell-lyrics.js",
        "web/src/mobile/shell-library.js",
        "web/src/mobile/shell-display.js",
        "web/src/mobile/shell-settings.js",
        "web/src/mobile/shell-updates.js",
        "web/src/mobile/shell-export.js",
        "web/src/mobile/shell-backup.js",
        "web/src/mobile/shell-pclink.js",
        // Canlı sekmesi: yalnız hedef PC iken (PC bağlantısı B2)
        "web/src/mobile/shell-live.js",
        // PC Ayarları sayfası (çıkışlar, ses girişi, kayıt, dışa aktarma, dosyalar; PC bağlantısı B6)
        "web/src/mobile/shell-pcmanage.js",
        "web/src/mobile/shell-timeline-lane.js",
        "web/src/mobile/shell-timeline.js",
        "web/src/mobile/shell-timeline-forms.js",
        "web/src/mobile/export-ui.js",
    )

    private fun installHostScripts(context: Context, web: WebView, debug: Boolean, page: String) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return
        val origins = setOf(ORIGIN)
        /* Sayfa adı adresten: aynı motor sayfa değiştirebiliyor (dışa aktarım, ExportFlow).
           [page] yalnız ilk yükleme için; belge başı betiği her sayfada yeniden çalışır. */
        val env = "window.__SV_ANDROID = Object.freeze({ debug: $debug, " +
            "page: (location.pathname.indexOf('/assets/web/') === 0 ? location.pathname.slice(12) : ${jsString(page)}), " +
            "version: ${jsString(com.cayadev.visualizer.BuildConfig.VERSION_NAME)}, webview: ${jsString(webViewVersion(context))} });"
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
