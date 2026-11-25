/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.cayadev.visualizer.bridge.Messages
import java.util.concurrent.atomic.AtomicLong

/* SES KAYNAKLARI İLE SAYFA ARASI (docs/android/PLAN.md D4).

   Yakalama iş parçacıkları ham sesi buraya verir; burası ikili iletiyi kurar
   ve ana iş parçacığında sayfaya yollar (yanıt vekili yalnız ana iş
   parçacığından çağrılır). Sayfa yoksa (Activity kapalı) ileti düşer:
   görüntüsü olmayan sesi biriktirmenin anlamı yok. */
object AudioHub {
    private val main = Handler(Looper.getMainLooper())
    private val pcmSeq = AtomicLong(0)
    private val waveSeq = AtomicLong(0)

    /** Sayfaya ikili ileti yollayan işlev (Bridge.postBinary); sayfa yoksa null. */
    @Volatile
    var sink: ((ByteArray) -> Boolean)? = null

    /** Durum değişimi (kaynak, hata) için sayfaya olay. */
    @Volatile
    var events: ((String, String) -> Unit)? = null

    /* PC bağlantısı. `tap`: telefonun kendi sesi (çalar, yakalama, mikrofon) bilgisayara da gider
       (B4, PcLink.pushAudio). `pcAudio`: sayfa yalnız bilgisayarın sesini alır (B5); açıkken
       telefonun kendi sesi sayfaya gitmez, iki akış aynı halka tampona karışmasın. */
    @Volatile
    var tap: ((Int, Int, ShortArray, Int) -> Unit)? = null

    @Volatile
    var pcAudio = false

    /** PC'den gelen PCM'i telefonun hoparlöründen de çal (görselleştiriciye giden akışın aynısı). */
    @Volatile
    var playPc = false

    /** PC sesinin düzeyi. 1 şimdiki ses, 2 iki kat. Görüntü ve hoparlör aynı örnekleri kullanır. */
    @Volatile
    var pcGain = 1f
        set(value) { field = value.coerceIn(0f, 2f) }

    private val speakerLock = Any()
    private var speaker: AudioTrack? = null
    private var speakerRate = 0
    private var speakerCh = 0

    fun enableSpeaker(on: Boolean) {
        playPc = on
        if (!on) synchronized(speakerLock) { releaseSpeakerLocked() }
    }

    @Volatile
    var delivered = 0L
        private set

    @Volatile
    var dropped = 0L
        private set

    fun now(): Double = SystemClock.elapsedRealtimeNanos() / 1e6

    fun pushPcm(sampleRate: Int, channels: Int, source: Int, samples: ShortArray, count: Int) {
        if (source != Messages.SOURCE_PC) tap?.invoke(sampleRate, channels, samples, count)
        if (pcAudio != (source == Messages.SOURCE_PC)) return
        val gain = if (source == Messages.SOURCE_PC) pcGain else 1f
        val data = if (gain == 1f) samples else PcmGain.scale(samples, count, gain)
        val n = if (data === samples) count else data.size
        if (source == Messages.SOURCE_PC && playPc) speak(sampleRate, channels, data, n)
        val msg = Messages.pcmS16(pcmSeq.getAndIncrement() and 0xffffffffL, now(), sampleRate, channels, source, data, n)
        post(msg)
    }

    private fun speak(sampleRate: Int, channels: Int, samples: ShortArray, count: Int) {
        if (count <= 0 || sampleRate < 8000) return
        val n = count.coerceAtMost(samples.size)
        val ch = if (channels >= 2) 2 else 1
        synchronized(speakerLock) {
            if (!playPc) return
            var track = speaker
            if (track == null || speakerRate != sampleRate || speakerCh != ch) {
                releaseSpeakerLocked()
                val mask = if (ch == 2) AudioFormat.CHANNEL_OUT_STEREO else AudioFormat.CHANNEL_OUT_MONO
                val min = AudioTrack.getMinBufferSize(sampleRate, mask, AudioFormat.ENCODING_PCM_16BIT)
                if (min <= 0) return
                track = try {
                    AudioTrack.Builder()
                        .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                        .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(sampleRate).setChannelMask(mask).build())
                        .setBufferSizeInBytes(min.coerceAtLeast(sampleRate * ch))
                        .setTransferMode(AudioTrack.MODE_STREAM)
                        .build()
                } catch (_: Exception) { null }
                if (track == null) return
                try { track.play() } catch (_: Exception) { track.release(); return }
                speaker = track
                speakerRate = sampleRate
                speakerCh = ch
            }
            try { track.write(samples, 0, n) } catch (_: Exception) { releaseSpeakerLocked() }
        }
    }

    private fun releaseSpeakerLocked() {
        val t = speaker
        speaker = null
        speakerRate = 0
        speakerCh = 0
        if (t == null) return
        try { t.pause() } catch (_: Exception) {}
        try { t.flush() } catch (_: Exception) {}
        try { t.release() } catch (_: Exception) {}
    }

    fun pushWave(sampleRate: Int, wave: ByteArray) {
        post(Messages.wave(waveSeq.getAndIncrement() and 0xffffffffL, now(), sampleRate, wave))
    }

    fun status(source: String, state: String) {
        val e = events ?: return
        main.post { e(source, state) }
    }

    private fun post(msg: ByteArray) {
        val s = sink
        if (s == null) {
            dropped++
            return
        }
        main.post {
            if (s(msg)) delivered++ else dropped++
        }
    }
}
