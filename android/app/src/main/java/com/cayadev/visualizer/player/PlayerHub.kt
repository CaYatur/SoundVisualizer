/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.player

import android.content.Context
import android.content.Intent
import org.json.JSONObject

/* ÇALARA ULAŞMA NOKTASI. Sayfanın istekleri servisin kendisine gider; servis
   henüz kurulmadıysa istek bekletilir ve servis başlatılır (kurulunca sırayla
   yapılır). Durum değişimleri `events` ile sayfaya `playerState` olarak gider. */
object PlayerHub {
    var service: PlayerService? = null
        private set

    /** Sayfaya `playerState` olayı (ana iş parçacığında). */
    var events: ((JSONObject) -> Unit)? = null

    private val pending = ArrayDeque<(PlayerService) -> Unit>()

    /** Servis hazırsa hemen, değilse kurulunca. Servis başlatılamazsa [fail] çağrılır. */
    fun with(context: Context, fail: (String) -> Unit, action: (PlayerService) -> Unit) {
        service?.let { action(it); return }
        pending.addLast(action)
        try {
            context.startService(Intent(context, PlayerService::class.java))
        } catch (e: IllegalStateException) {
            // Arka planda servis başlatma yasağı (Android 8+)
            pending.remove(action)
            fail("background")
        }
    }

    /** Çalan bir şey varsa duraklatır (başka bir ses kaynağı başlıyor). */
    fun pause() {
        service?.let { if (it.player.isPlaying) it.player.pause() }
    }

    internal fun attached(s: PlayerService) {
        service = s
        while (pending.isNotEmpty()) pending.removeFirst()(s)
    }

    internal fun detached(s: PlayerService) {
        if (service === s) service = null
        events?.invoke(JSONObject().put("has", false).put("playing", false).put("state", "idle"))
    }

    internal fun emit(state: JSONObject) {
        events?.invoke(state)
    }
}
