/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer

import android.Manifest
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.webkit.WebView
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
import com.cayadev.visualizer.bridge.Messages
import com.cayadev.visualizer.export.ExportHub
import com.cayadev.visualizer.web.WebShell
import org.json.JSONObject

/* 0E İSKELETİ (docs/android/PLAN.md). Değiştirilmemiş görselleştirici sayfası
   tam ekranda açılır; ses demo sinyalinden ya da sayfanın istediği kaynaktan
   (sistem sesi, mikrofon, Visualizer) gelir. Mobil arayüz Faz 3'te gelir. */
class MainActivity : ComponentActivity() {
    private var web: WebView? = null
    private var bridge: Bridge? = null
    private val exportHub by lazy { ExportHub(applicationContext) { name, v -> bridge?.event(name, v) } }

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
        start()
    }

    private fun start() {
        // Sayfa seçimi yalnız geliştirme sürümünde (ölçüm sayfaları için)
        val page = (if (BuildConfig.DEBUG) intent?.getStringExtra(EXTRA_PAGE) else null) ?: DEFAULT_PAGE
        val w = WebShell.create(applicationContext, BuildConfig.DEBUG, page) { dead -> rebuild(dead) }
        val b = Bridge(applicationContext, { op, args, reply -> onRequest(op, args, reply) }) { head, bytes ->
            if (head.type == Messages.TYPE_VIDEO_FRAME) exportHub.frame(bytes)
        }
        b.install(w)
        bridge = b
        setContentView(w, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        w.loadUrl(WebShell.pageUrl(page))
        web = w
        Log.i(TAG, "sayfa: $page, WebView ${WebShell.webViewVersion(this)}")
    }

    /* Sayfanın istekleri (docs/android/HOST.md). */
    private fun onRequest(op: String, args: JSONObject, reply: Bridge.Reply) {
        when (op) {
            "audioStart" -> {
                val source = args.optString("source")
                if (source !in AudioService.SOURCES) { reply.fail("bad-source", source); return }
                pending?.second?.fail("superseded")
                pending = source to reply
                if (hasRecordAudio()) continueAudio(source, reply)
                else askPermissions.launch(permissions())
            }
            "audioStop" -> {
                AudioService.stop(this)
                reply.ok()
            }
            "audioStats" -> reply.ok(JSONObject().put("delivered", AudioHub.delivered).put("dropped", AudioHub.dropped))
            // Dışa aktarım (0E6): kodlayıcı ve MP4 uygulamada, kareler sayfadan
            "exportBegin" -> exportHub.begin(args) { r, err -> if (r != null) reply.ok(r) else reply.fail("export-begin", err ?: "") }
            "exportEnd" -> exportHub.end { r, err -> if (r != null) reply.ok(r) else reply.fail("export-end", err ?: "") }
            "exportCancel" -> {
                exportHub.cancel()
                reply.ok()
            }
            else -> reply.fail("unknown-op", op)
        }
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

    private fun hasRecordAudio() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private fun permissions(): Array<String> =
        if (Build.VERSION.SDK_INT >= 33) arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.POST_NOTIFICATIONS)
        else arrayOf(Manifest.permission.RECORD_AUDIO)

    /* Çizim süreci öldüyse eski WebView'i bırakıp yenisini kur. */
    private fun rebuild(dead: WebView) {
        bridge?.detach()
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
        bridge?.detach()
        bridge = null
        // Görüntüsü olmayan sesi yakalamaya devam etmenin anlamı yok (yüzen pencere 0E7'de)
        if (isFinishing) AudioService.stop(this)
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
