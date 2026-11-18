/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.player

import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.util.Base64
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.audio.TeeAudioProcessor
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.cayadev.visualizer.FloatingWindow
import com.cayadev.visualizer.audio.AudioHub
import com.cayadev.visualizer.audio.AudioService
import com.cayadev.visualizer.bridge.Messages
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder

/* UYGULAMA İÇİ ÇALAR (docs/android/PLAN.md 2.3, D4: dördüncü ses kaynağı).

   Kullanıcının seçtiği şarkıyı çalar ve sesini görüntüye verir. Sistem sesi
   yakalamasının aksine izin, onay penceresi ve başka uygulamanın paylaşma
   kararı yok; ses örnekleri birebir geliyor.

   Ses çözülünce ses çıkışına gitmeden önce bir kopyası alınır
   (TeeAudioProcessor) ve PcmClock'ta, oynatma konumu ona gelene kadar
   bekletilir: görüntü hoparlörden çıkan sesle aynı anda tepki verir.

   Medya oturumu (media3-session) bildirimi, kilit ekranı ve kulaklık
   düğmelerini sağlıyor; oynarken servis ön planda (mediaPlayback). Aynı anda
   tek kaynak: çalar başlayınca sistem sesi / mikrofon yakalaması durur. */
@OptIn(UnstableApi::class)
class PlayerService : MediaSessionService() {
    private val tag = "SVPlayer"
    private val main = Handler(Looper.getMainLooper())
    val clock = PcmClock()
    lateinit var player: ExoPlayer
        private set
    private var session: MediaSession? = null
    private var name = ""
    private var ticking = false
    private var artwork = ""
    var released = 0L
        private set

    /* Çözülen sesin kopyası (oynatma iş parçacığında). 16 bit ya da float;
       ikiden çok kanalda ön sol ve sağ alınır (motor stereo bekliyor). */
    private val tap = object : TeeAudioProcessor.AudioBufferSink {
        private var encoding = C.ENCODING_INVALID
        private var channels = 0
        private var warned = false

        override fun flush(sampleRateHz: Int, channelCount: Int, encoding: Int) {
            this.encoding = encoding
            channels = channelCount
            clock.format(sampleRateHz, minOf(channelCount, 2))
        }

        override fun handleBuffer(buffer: ByteBuffer) {
            if (channels <= 0) return
            val b = buffer.order(ByteOrder.LITTLE_ENDIAN)
            val out = when (encoding) {
                C.ENCODING_PCM_16BIT -> pick(b.asShortBuffer().let { s -> ShortArray(s.remaining()).also { s.get(it) } })
                C.ENCODING_PCM_FLOAT -> pick(b.asFloatBuffer().let { f ->
                    ShortArray(f.remaining()) { (f.get().coerceIn(-1f, 1f) * 32767f).toInt().toShort() }
                })
                else -> {
                    if (!warned) Log.w(tag, "desteklenmeyen PCM biçimi: $encoding")
                    warned = true
                    null
                }
            }
            if (out != null) clock.push(out)
        }

        private fun pick(s: ShortArray): ShortArray {
            if (channels <= 2) return s
            val frames = s.size / channels
            return ShortArray(frames * 2) { i -> s[(i / 2) * channels + (i % 2)] }
        }
    }

    /* Oynarken 10 ms'de bir: duyulmuş blokları sayfaya ver. */
    private val tick = object : Runnable {
        override fun run() {
            clock.release(player.currentPosition) { c ->
                AudioHub.pushPcm(c.sampleRate, c.channels, Messages.SOURCE_PLAYER, c.samples, c.samples.size)
                released++
            }
            if (player.isPlaying) main.postDelayed(this, TICK_MS) else ticking = false
        }
    }

    override fun onCreate() {
        super.onCreate()
        val renderers = object : DefaultRenderersFactory(this) {
            override fun buildAudioSink(context: android.content.Context, enableFloatOutput: Boolean, enableAudioTrackPlaybackParams: Boolean): AudioSink =
                DefaultAudioSink.Builder(context).setAudioProcessors(arrayOf(TeeAudioProcessor(tap))).build()
        }
        player = ExoPlayer.Builder(this, renderers)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
            .setHandleAudioBecomingNoisy(true)
            .build()
        player.addListener(listener)
        /* Oturum servise AÇIKÇA eklenir: media3 onu ancak bir denetleyici bağlanınca
           kendiliğinden ekliyor, oysa çaları sayfa doğrudan yönetiyor. Eklenmezse
           bildirim çıkmıyor ve servis ön plana geçmiyordu (ölçüldü). */
        session = MediaSession.Builder(this, player).setCallback(trustedOnly).build().also { addSession(it) }
        PlayerHub.attached(this)
        Log.i(tag, "çalar hazır")
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    /* Servis medya denetleyicilerine açık olmak zorunda (bildirim, kilit ekranı,
       Bluetooth kulaklık). Yalnız sistemin güvendiği denetleyiciler bağlanır
       (sistem arayüzü, MEDIA_CONTENT_CONTROL izinliler, uygulamanın kendisi);
       başka bir uygulama çaları yönetemez. */
    private val trustedOnly = object : MediaSession.Callback {
        override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult =
            if (controller.isTrusted || session.isMediaNotificationController(controller)) {
                MediaSession.ConnectionResult.AcceptedResultBuilder(session).build()
            } else {
                Log.w(tag, "denetleyici reddedildi: ${controller.packageName}")
                MediaSession.ConnectionResult.reject()
            }
    }

    private val listener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (isPlaying) {
                // Tek kaynak: çalar başlayınca yakalama durur
                AudioService.stop(this@PlayerService)
                AudioHub.status(SOURCE, "running")
                if (!ticking) {
                    ticking = true
                    main.post(tick)
                }
            } else {
                AudioHub.status(SOURCE, if (player.playbackState == Player.STATE_ENDED) "ended" else "paused")
            }
            emit()
        }

        override fun onMediaMetadataChanged(mediaMetadata: MediaMetadata) {
            artwork = artworkOf(mediaMetadata)
            emit()
        }

        override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) = emit()

        override fun onPlaybackStateChanged(playbackState: Int) = emit()

        override fun onPlayerError(error: PlaybackException) {
            Log.e(tag, "çalınamadı", error)
            AudioHub.status(SOURCE, "error:${error.errorCodeName}")
            emit()
        }
    }

    /** Şarkıyı açar (çalmaya başlamaz). */
    fun open(uri: Uri) {
        name = displayName(uri)
        artwork = ""
        player.setMediaItem(MediaItem.fromUri(uri))
        player.prepare()
        emit()
    }

    /** Yalnız çalma durumu ve konum (sık sorulur: kapak resmi gibi büyük alanlar yok). */
    fun position(): JSONObject = JSONObject()
        .put("has", player.currentMediaItem != null)
        .put("playing", player.isPlaying)
        .put("state", when (player.playbackState) {
            Player.STATE_BUFFERING -> "buffering"
            Player.STATE_READY -> "ready"
            Player.STATE_ENDED -> "ended"
            else -> "idle"
        })
        .put("position", player.currentPosition)
        .put("at", System.currentTimeMillis()) // konumun okunduğu an (olay sayfaya geç ulaşırsa aradaki süre eklenir)

    fun state(): JSONObject {
        val m = player.mediaMetadata
        val title = m.title?.toString().orEmpty().ifEmpty { m.displayTitle?.toString().orEmpty() }.ifEmpty { name }
        val duration = player.duration.takeIf { it != C.TIME_UNSET } ?: 0L
        return position()
            .put("duration", duration)
            .put("title", title)
            .put("artist", m.artist?.toString().orEmpty())
            .put("album", m.albumTitle?.toString().orEmpty())
            .put("artwork", artwork)
            .put("name", name)
            .put("error", player.playerError?.errorCodeName ?: JSONObject.NULL)
    }

    /** Ölçüm: bekleyen ses, atılan ve bırakılan bloklar, son bloğun konuma göre gecikmesi. */
    fun stats(): JSONObject = JSONObject().put("pending", clock.pending()).put("dropped", clock.dropped)
        .put("released", released).put("lagMs", Math.round(clock.lastLagMs * 10) / 10.0)

    private fun emit() = PlayerHub.emit(state())

    private fun displayName(uri: Uri): String {
        if (uri.scheme == "file") return uri.lastPathSegment.orEmpty().substringBeforeLast('.')
        return try {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0).orEmpty().substringBeforeLast('.') else ""
            }.orEmpty()
        } catch (e: Exception) {
            ""
        }
    }

    /* Gömülü kapak, masaüstündeki gibi data: adresi; çok büyükse gönderilmez. */
    private fun artworkOf(m: MediaMetadata): String {
        val data = m.artworkData ?: return ""
        if (data.size > MAX_ARTWORK) return ""
        val mime = if (data.size > 3 && data[0] == 0x89.toByte() && data[1] == 'P'.code.toByte()) "image/png" else "image/jpeg"
        return "data:$mime;base64," + Base64.encodeToString(data, Base64.NO_WRAP)
    }

    /* Uygulama kaydırılıp kapatılınca: yüzen pencere yoksa görüntü de yok, çalma durur. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        if (!FloatingWindow.isShowing) {
            player.pause()
            stopSelf()
        }
    }

    override fun onDestroy() {
        main.removeCallbacks(tick)
        PlayerHub.detached(this)
        session?.release()
        session = null
        player.removeListener(listener)
        player.release()
        AudioHub.status(SOURCE, "stopped")
        super.onDestroy()
    }

    companion object {
        const val SOURCE = "player"
        private const val TICK_MS = 10L
        private const val MAX_ARTWORK = 384 * 1024
    }
}
