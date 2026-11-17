/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer

import android.Manifest
import android.app.PictureInPictureParams
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.util.Rational
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.cayadev.visualizer.audio.AudioHub
import com.cayadev.visualizer.audio.AudioService
import com.cayadev.visualizer.bridge.Bridge
import com.cayadev.visualizer.media.MediaPick
import com.cayadev.visualizer.player.PlayerHub
import com.cayadev.visualizer.web.WebShell
import org.json.JSONObject

/* 0E İSKELETİ (docs/android/PLAN.md). Değiştirilmemiş görselleştirici sayfası
   tam ekranda açılır; ses demo sinyalinden ya da sayfanın istediği kaynaktan
   (sistem sesi, mikrofon, Visualizer) gelir. Mobil arayüz Faz 3'te gelir.

   Motor bu Activity'nin değil EngineHost'un: Activity yalnız onu gösterir.
   Yüzen pencere açıkken Activity kapanabilir, motor yaşar (0E7). */
class MainActivity : ComponentActivity() {
    private lateinit var frame: FrameLayout

    /** İzin ya da sistem onayı beklenen ses isteği. */
    private var pending: Pair<String, Bridge.Reply>? = null

    private val askPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        val p = pending ?: return@registerForActivityResult
        if (hasRecordAudio()) continueAudio(p.first, p.second)
        else {
            pending = null
            p.second.fail("permission-denied")
        }
    }

    /* Sistem sesi: her oturumda sistemin kendi onay penceresi (Android 14+'ta
       onay jetonu tek kullanımlık). */
    private val askProjection = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val p = pending ?: return@registerForActivityResult
        pending = null
        val data = r.data
        if (r.resultCode == RESULT_OK && data != null) {
            AudioService.start(this, AudioService.SOURCE_CAPTURE, r.resultCode, data)
            p.second.ok(JSONObject().put("source", AudioService.SOURCE_CAPTURE))
        } else {
            p.second.fail("consent-denied")
        }
    }

    /* Uygulama içi çalar için şarkı seçimi (Android'in dosya seçicisi). İzin kalıcı
       alınır: uygulama yeniden açılınca aynı şarkı yine çalınabilir. */
    private var pendingPick: Bridge.Reply? = null
    private val askAudio = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val reply = pendingPick ?: return@registerForActivityResult
        pendingPick = null
        if (uri == null) { reply.fail("cancelled"); return@registerForActivityResult }
        try {
            contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (e: SecurityException) {
            Log.w(TAG, "kalıcı izin alınamadı: $uri")
        }
        PlayerHub.with(this, { reply.fail("player-$it") }) { p ->
            p.open(uri)
            reply.ok(p.state().put("uri", uri.toString()))
        }
    }

    /* Bilgisayardan içe aktarma: masaüstünün tam yedeği (.svbackup) ya da settings.json.
       .svbackup'ın kayıtlı bir türü yok, Android onu genel ikili dosya sayar. */
    private var pendingImport: Bridge.Reply? = null
    private val askImport = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val reply = pendingImport ?: return@registerForActivityResult
        pendingImport = null
        if (uri == null) { reply.fail("cancelled"); return@registerForActivityResult }
        EngineHost.profile.importRead(EngineHost.profile.opener(uri)) { r, err -> if (r != null) reply.ok(r) else reply.fail("import", err ?: "") }
    }

    fun pickImport(reply: Bridge.Reply) {
        pendingImport?.fail("superseded")
        pendingImport = reply
        askImport.launch(arrayOf("application/zip", "application/octet-stream", "application/json", "text/plain"))
    }

    /* Kamera katmanı (Faz 4): sayfa kamerayı istediğinde (WebShell, onPermissionRequest)
       uygulamanın izni yoksa sistem sorar; yanıt bekleyen WebView isteğine gider. */
    private var pendingCamera: ((Boolean) -> Unit)? = null
    private val askCamera = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        val done = pendingCamera ?: return@registerForActivityResult
        pendingCamera = null
        done(ok)
    }

    fun requestCamera(done: (Boolean) -> Unit) {
        pendingCamera?.invoke(false)
        pendingCamera = done
        askCamera.launch(Manifest.permission.CAMERA)
    }

    /* MilkDrop presetleri (.milk, .milk2): birden çok dosya. Uzantının kayıtlı bir türü yok,
       Android onları genel ikili dosya sayar; süzme adla, depoda (store/MilkImport.kt). */
    private var pendingMilk: Bridge.Reply? = null
    private val askMilk = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        val reply = pendingMilk ?: return@registerForActivityResult
        pendingMilk = null
        if (uris.isNullOrEmpty()) { reply.fail("cancelled"); return@registerForActivityResult }
        EngineHost.profile.importMilk(EngineHost.profile.documents(uris)) { r, err -> if (r != null) reply.ok(r) else reply.fail("milk-import", err ?: "") }
    }

    /* Söz dosyaları (.lrc .srt .txt; türleri kayıtlı değil, süzgeç kitaplıkta). */
    private var pendingLyrics: Bridge.Reply? = null
    private val askLyrics = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        val reply = pendingLyrics ?: return@registerForActivityResult
        pendingLyrics = null
        if (uris.isNullOrEmpty()) { reply.fail("cancelled"); return@registerForActivityResult }
        com.cayadev.visualizer.store.LyricsHub.importUris(uris) { r, err -> if (r != null) reply.ok(r) else reply.fail("lyrics-import", err ?: "") }
    }

    fun pickLyrics(reply: Bridge.Reply) {
        pendingLyrics?.fail("superseded")
        pendingLyrics = reply
        askLyrics.launch(arrayOf("*/*"))
    }

    fun pickMilk(reply: Bridge.Reply) {
        pendingMilk?.fail("superseded")
        pendingMilk = reply
        askMilk.launch(arrayOf("*/*"))
    }

    /* Galeriden video ya da görsel (Faz 4 medya katmanları, media/MediaPick.kt). Video için
       kalıcı okuma izni alınır: sayfa dosyayı her açılışta ContentPathHandler'dan okur. */
    private var pendingMedia: Pair<String, Bridge.Reply>? = null
    private val askMedia = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val (kind, reply) = pendingMedia ?: return@registerForActivityResult
        pendingMedia = null
        if (uri == null) { reply.fail("cancelled"); return@registerForActivityResult }
        if (kind == "video" || kind == "audio") {
            try {
                contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } catch (e: SecurityException) {
                reply.fail("no-grant"); return@registerForActivityResult
            }
            // Şarkı dışa aktarım için: adresi ve adı yeter (iş başlarken kopyalanır)
            reply.ok(if (kind == "audio") JSONObject().put("uri", uri.toString()).put("name", MediaPick.displayName(this, uri)) else MediaPick.video(this, uri))
            return@registerForActivityResult
        }
        // Görselin çözülmesi ve sıkıştırılması ana iş parçacığında yapılmaz
        val main = android.os.Handler(mainLooper)
        Thread {
            val r = try { MediaPick.image(this, uri) } catch (e: Exception) { null }
            main.post { if (r != null) reply.ok(r) else reply.fail("bad-image") }
        }.start()
    }

    fun pickMedia(kind: String, reply: Bridge.Reply) {
        pendingMedia?.second?.fail("superseded")
        pendingMedia = Pair(kind, reply)
        askMedia.launch(arrayOf(when (kind) { "video" -> "video/*"; "audio" -> "audio/*"; else -> "image/*" }))
    }

    fun pickAudio(reply: Bridge.Reply) {
        pendingPick?.fail("superseded")
        pendingPick = reply
        askAudio.launch(arrayOf("audio/*"))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        immersive()

        // Geliştirme sürümünde ekran denenebilsin: --ez forceWebViewUpdate true
        val missing = if (BuildConfig.DEBUG && intent?.getBooleanExtra("forceWebViewUpdate", false) == true) WebShell.REQUIRED_FEATURES
        else WebShell.missingFeatures()
        if (missing.isNotEmpty()) {
            // Motor kurulamaz: tasarım dilindeki yerel ekran (taslak 12)
            Log.e(TAG, "eksik WebView özellikleri: $missing")
            WebViewUpdateScreen.show(this, WebShell.webViewVersion(this), missing)
            return
        }
        frame = FrameLayout(this)
        setContentView(frame, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        EngineHost.register(this)
        // Sayfa seçimi yalnız geliştirme sürümünde (ölçüm sayfaları için)
        val page = (if (BuildConfig.DEBUG) intent?.getStringExtra(EXTRA_PAGE) else null) ?: DEFAULT_PAGE
        EngineHost.ensure(this, page, BuildConfig.DEBUG, AppRequests(applicationContext))
        // Uygulamaya dönülünce yüzen pencere kapanır, aynı motor tam ekrana geçer
        if (FloatingWindow.isShowing) FloatingWindow.close(this)
        EngineHost.attach(frame)
        frame.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> updatePipParams() }
        /* Ekran kenarı boşlukları (çentik, sistem çubukları) sayfaya dp olarak gider:
           uygulama tam ekran, sayfanın kendi viewport'u bunları bilmiyor. Çubuklar
           gizliyken de yer ayrılır (kaydırınca geçici olarak görünüyorlar). */
        ViewCompat.setOnApplyWindowInsetsListener(frame) { _, insets ->
            val i = insets.getInsetsIgnoringVisibility(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val d = resources.displayMetrics.density
            lastInsets = JSONObject().put("top", Math.round(i.top / d)).put("right", Math.round(i.right / d))
                .put("bottom", Math.round(i.bottom / d)).put("left", Math.round(i.left / d))
            EngineHost.bridge?.event("insets", lastInsets)
            insets
        }
        /* Geri tuşu sayfaya gider: önce açık sayfa kapanır; sayfa karşılamazsa uygulama
           arkaya alınır (appToBack). Varsayılan davranış Activity'yi kapatırdı. */
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val b = EngineHost.bridge
                if (b?.reply != null) b.event("back", null) else moveTaskToBack(true)
            }
        })
        Log.i(TAG, "sayfa: $page, WebView ${WebShell.webViewVersion(this)}")
    }

    /** Son ölçülen kenar boşlukları; yeni sayfa `hello` dediğinde yeniden gönderilir. */
    var lastInsets: JSONObject? = null
        private set

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (FloatingWindow.isShowing) FloatingWindow.close(this)
        if (::frame.isInitialized) EngineHost.attach(frame)
    }

    fun startAudio(source: String, reply: Bridge.Reply) {
        pending?.second?.fail("superseded")
        pending = source to reply
        if (hasRecordAudio()) continueAudio(source, reply)
        else askPermissions.launch(permissions())
    }

    private fun continueAudio(source: String, reply: Bridge.Reply) {
        if (source == AudioService.SOURCE_CAPTURE) {
            val mpm = getSystemService(MediaProjectionManager::class.java)
            // Android 14+: bütün ekran (ve dolayısıyla bütün sistem sesi); tek uygulama seçeneği değil
            val intent = if (Build.VERSION.SDK_INT >= 34) mpm.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
            else mpm.createScreenCaptureIntent()
            askProjection.launch(intent)
            return
        }
        pending = null
        AudioService.start(this, source)
        reply.ok(JSONObject().put("source", source))
    }

    /* Sistem PiP'i: oran 1:2,39 ile 2,39:1 arasında; kullanıcı parmakla boyutlandırır.
       Otomatik geçiş (ana ekrana basınca) Faz 3'te bir ayar olacak; şimdilik kapalı. */
    private var pipAspect = Rational(16, 9)
    var autoPip = false

    private fun pipParams(): PictureInPictureParams {
        val b = PictureInPictureParams.Builder().setAspectRatio(pipAspect)
        if (Build.VERSION.SDK_INT >= 31) {
            b.setSeamlessResizeEnabled(true)
            b.setAutoEnterEnabled(autoPip)
        }
        // Küçülme animasyonu görüntünün kendisinden başlasın
        if (::frame.isInitialized && frame.width > 0) {
            val r = android.graphics.Rect()
            frame.getGlobalVisibleRect(r)
            b.setSourceRectHint(r)
        }
        return b.build()
    }

    private fun updatePipParams() = setPictureInPictureParams(pipParams())

    fun enterPip(w: Int, h: Int): Boolean {
        val r = Rational(w.coerceAtLeast(1), h.coerceAtLeast(1))
        pipAspect = when {
            r.toFloat() > 2.39f -> Rational(239, 100)
            r.toFloat() < 1 / 2.39f -> Rational(100, 239)
            else -> r
        }
        return enterPictureInPictureMode(pipParams())
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        EngineHost.bridge?.event("windowChrome", JSONObject().put("pip", isInPictureInPictureMode))
    }

    private fun hasRecordAudio() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private fun permissions(): Array<String> =
        if (Build.VERSION.SDK_INT >= 33) arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.POST_NOTIFICATIONS)
        else arrayOf(Manifest.permission.RECORD_AUDIO)

    private fun immersive() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    override fun onResume() {
        super.onResume()
        EngineHost.web?.onResume()
        // Bildirim erişimi ayarlardan yeni verilmiş olabilir
        com.cayadev.visualizer.media.NowPlaying.start(this)
    }

    override fun onPause() {
        /* Bekleyen ayar kaydı hemen yazılsın: arka plandaki uygulamayı sistem
           haber vermeden kapatabilir (sayfa kaydı 300 ms ile 2 sn bekletiyor). */
        EngineHost.bridge?.event("flush", null)
        // PiP'te ve yüzen pencerede motor çizmeye devam eder
        if (!isInPictureInPictureMode && !FloatingWindow.isShowing) EngineHost.web?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        EngineHost.unregister(this)
        if (FloatingWindow.isShowing) {
            // Motor yüzen pencerede yaşıyor; yalnız bu ekranı bırak
            Log.i(TAG, "Activity kapandı, motor yüzen pencerede sürüyor")
        } else if (isFinishing) {
            // Görüntüsü olmayan sesi yakalamaya devam etmenin anlamı yok
            AudioService.stop(this)
            EngineHost.destroy()
        } else {
            EngineHost.detach()
        }
        super.onDestroy()
    }

    companion object {
        private const val TAG = "SVMain"
        const val EXTRA_PAGE = "page"
        const val DEFAULT_PAGE = "src/visualizer/index.html"
    }
}
