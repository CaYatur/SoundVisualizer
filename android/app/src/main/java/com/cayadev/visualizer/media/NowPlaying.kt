/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.media

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.util.Base64
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/* Bildirim erişiminin sahibi. İçi boş: bildirimleri okumuyoruz. Android başka
   uygulamaların medya oturumlarını (çalan parça, kapak, konum) yalnız bildirim
   erişimi verilmiş bir uygulamaya açıyor; masaüstündeki Windows medya oturumunun
   (SMTC) karşılığı bu. */
class NowPlayingService : NotificationListenerService()

/* ÇALAN PARÇA (Faz 4, masaüstündeki src/main/media-session.js'in karşılığı).

   Kullanıcı bildirim erişimi verirse başka uygulamalarda (Spotify, YouTube Music, …)
   çalan parça izlenir: ad, sanatçı, albüm, kapak, süre ve konum. Durum masaüstündeki
   "şimdi çalıyor" biçiminde sayfaya gider (`mediaSession` olayı); konum saniye,
   `updated` konumun ölçüldüğü an (motor aradaki süreyi kendisi ekliyor). Uygulamanın
   kendi çaları burada sayılmaz: onun durumu zaten sayfada (PlayerHub).

   Birden çok oturum varsa çalan kazanır; hiçbiri çalmıyorsa en son değişen. Kapak
   256 px'e küçültülüp JPEG olarak gönderilir, aynı kapak yeniden kodlanmaz. */
object NowPlaying {
    private const val TAG = "SVNowPlaying"
    private const val ART_PX = 256

    /** Durum değişince (sayfaya olay). */
    var events: ((JSONObject) -> Unit)? = null

    private val main = Handler(Looper.getMainLooper())
    private var msm: MediaSessionManager? = null
    private var component: ComponentName? = null
    private var current: MediaController? = null
    private var ownPackage = ""
    private var last: JSONObject = idle()
    private var artKey: Any? = null
    private var artData = ""

    fun enabled(ctx: Context): Boolean =
        NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.packageName)

    /** Bildirim erişimi ekranı (mümkünse doğrudan bu uygulamanın satırı). */
    fun accessIntent(ctx: Context): Intent {
        val comp = ComponentName(ctx, NowPlayingService::class.java)
        return if (Build.VERSION.SDK_INT >= 30) {
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, comp.flattenToString())
        } else {
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        }
    }

    fun status(ctx: Context): JSONObject = JSONObject().put("enabled", enabled(ctx)).put("state", last)

    /** İzlemeyi başlatır (erişim yoksa hiçbir şey yapmaz). Tekrar çağrılabilir. */
    fun start(ctx: Context) {
        val app = ctx.applicationContext
        ownPackage = app.packageName
        if (!enabled(app)) { stop(); return }
        if (msm != null) return
        try {
            val m = app.getSystemService(MediaSessionManager::class.java) ?: return
            val c = ComponentName(app, NowPlayingService::class.java)
            m.addOnActiveSessionsChangedListener(sessionsChanged, c, main)
            msm = m
            component = c
            pick(m.getActiveSessions(c))
        } catch (e: SecurityException) {
            Log.w(TAG, "medya oturumları okunamadı (erişim yok)", e)
            stop()
        }
    }

    fun stop() {
        msm?.let { try { it.removeOnActiveSessionsChangedListener(sessionsChanged) } catch (_: Exception) {} }
        msm = null
        bind(null)
    }

    private val sessionsChanged = MediaSessionManager.OnActiveSessionsChangedListener { list -> pick(list ?: emptyList()) }

    private val callback = object : MediaController.Callback() {
        override fun onMetadataChanged(metadata: MediaMetadata?) = publish()
        override fun onPlaybackStateChanged(state: PlaybackState?) {
            // Başka oturum çalmaya başlamış olabilir: listeyi yeniden değerlendir
            val m = msm
            val c = component
            if (m != null && c != null && state?.state != PlaybackState.STATE_PLAYING) {
                try { pick(m.getActiveSessions(c)); return } catch (_: SecurityException) {}
            }
            publish()
        }
        override fun onSessionDestroyed() {
            val m = msm
            val c = component
            if (m != null && c != null) try { pick(m.getActiveSessions(c)); return } catch (_: SecurityException) {}
            bind(null)
        }
    }

    /** Yalnız geliştirme sürümünde, sınama için: uygulamanın kendi çaları da sayılır
        (emülatörde oturum açmadan medya oturumu okuma zincirini denemek için). */
    var includeSelf = false
        set(v) { field = v; val m = msm; val c = component; if (m != null && c != null) try { pick(m.getActiveSessions(c)) } catch (_: SecurityException) {} }

    private fun pick(list: List<MediaController>) {
        val others = list.filter { includeSelf || it.packageName != ownPackage }
        val playing = others.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING }
        val next = playing ?: others.firstOrNull { it.packageName == current?.packageName } ?: others.firstOrNull()
        if (next?.sessionToken != current?.sessionToken) bind(next) else publish()
    }

    private fun bind(c: MediaController?) {
        current?.let { try { it.unregisterCallback(callback) } catch (_: Exception) {} }
        current = c
        c?.registerCallback(callback, main)
        publish()
    }

    private fun idle(): JSONObject = JSONObject()
        .put("has", false).put("playing", false).put("title", "").put("artist", "").put("album", "")
        .put("artwork", "").put("subtitle", "").put("app", "").put("position", 0).put("duration", 0)
        .put("updated", 0).put("received", System.currentTimeMillis())

    private fun publish() {
        val c = current
        val md = c?.metadata
        val title = md?.getString(MediaMetadata.METADATA_KEY_TITLE) ?: md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE) ?: ""
        val st = c?.playbackState
        val j = if (c == null || title.isEmpty()) idle() else {
            val artist = md?.getString(MediaMetadata.METADATA_KEY_ARTIST)
                ?: md?.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST)
                ?: md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE) ?: ""
            val playing = st?.state == PlaybackState.STATE_PLAYING
            // Konum: oturumun son ölçümü + o andan beri geçen süre (hızla)
            var posMs = st?.position ?: 0L
            if (st != null && playing && st.lastPositionUpdateTime > 0) {
                posMs += ((SystemClock.elapsedRealtime() - st.lastPositionUpdateTime) * st.playbackSpeed).toLong()
            }
            val now = System.currentTimeMillis()
            JSONObject()
                .put("has", true)
                .put("playing", playing)
                .put("title", title)
                .put("artist", artist)
                .put("album", md?.getString(MediaMetadata.METADATA_KEY_ALBUM) ?: "")
                .put("artwork", artwork(md))
                .put("subtitle", "")
                .put("app", appLabel(c.packageName))
                .put("position", maxOf(0L, posMs) / 1000.0)
                .put("duration", maxOf(0L, md?.getLong(MediaMetadata.METADATA_KEY_DURATION) ?: 0L) / 1000.0)
                .put("updated", now)
                .put("received", now)
        }
        last = j
        events?.invoke(j)
    }

    private fun artwork(md: MediaMetadata?): String {
        val bmp = md?.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
            ?: md?.getBitmap(MediaMetadata.METADATA_KEY_ART)
            ?: md?.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
        val uri = md?.getString(MediaMetadata.METADATA_KEY_ALBUM_ART_URI) ?: md?.getString(MediaMetadata.METADATA_KEY_ART_URI)
        if (bmp == null) return if (uri != null && uri.startsWith("http")) uri else ""
        if (bmp === artKey) return artData
        artKey = bmp
        artData = try {
            val k = minOf(1f, ART_PX.toFloat() / maxOf(bmp.width, bmp.height))
            val small = if (k < 1f) Bitmap.createScaledBitmap(bmp, maxOf(1, (bmp.width * k).toInt()), maxOf(1, (bmp.height * k).toInt()), true) else bmp
            val out = ByteArrayOutputStream()
            small.compress(Bitmap.CompressFormat.JPEG, 85, out)
            "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        } catch (e: Exception) {
            Log.w(TAG, "kapak okunamadı", e)
            ""
        }
        return artData
    }

    private var labels = HashMap<String, String>()
    private var appCtx: Context? = null
    fun init(ctx: Context) { appCtx = ctx.applicationContext }
    private fun appLabel(pkg: String): String = labels.getOrPut(pkg) {
        val pm = appCtx?.packageManager ?: return@getOrPut pkg
        try { pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString() } catch (_: Exception) { pkg }
    }
}
