/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.audio

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

    @Volatile
    var delivered = 0L
        private set

    @Volatile
    var dropped = 0L
        private set

    fun now(): Double = SystemClock.elapsedRealtimeNanos() / 1e6

    fun pushPcm(sampleRate: Int, channels: Int, source: Int, samples: ShortArray, count: Int) {
        val msg = Messages.pcmS16(pcmSeq.getAndIncrement() and 0xffffffffL, now(), sampleRate, channels, source, samples, count)
        post(msg)
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
