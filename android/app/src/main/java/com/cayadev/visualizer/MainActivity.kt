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
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.cayadev.visualizer.audio.AudioHub
import com.cayadev.visualizer.audio.AudioService
import com.cayadev.visualizer.bridge.Bridge
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
        Log.i(TAG, "sayfa: $page, WebView ${WebShell.webViewVersion(this)}")
    }

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
    }

    override fun onPause() {
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
