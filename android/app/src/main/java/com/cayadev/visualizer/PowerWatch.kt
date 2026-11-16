/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import androidx.core.content.ContextCompat

/* PİL DURUMU (docs/android/HOST.md `getPowerSource`/`onPowerSource`).

   Motorun düşük güç kipi (src/shared/low-power.js, #458) masaüstünde "pilde mi"
   sorusuna göre çizim ölçeğini ve kare hızını düşürüyor. Android'de cevap şarj
   kablosunun takılı olup olmaması: ACTION_BATTERY_CHANGED kayıtta son durumu
   hemen veriyor (yapışkan yayın), sonra her değişimde yeniden geliyor; yalnız
   takılı/çıkarıldı değişince sayfaya bildirilir. */
object PowerWatch {
    @Volatile
    var onBattery = false
        private set

    /** Durum değişince (ana iş parçacığında). */
    var listener: ((Boolean) -> Unit)? = null

    private var registered = false

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) = update(intent)
    }

    fun start(context: Context) {
        if (registered) return
        registered = true
        val sticky = ContextCompat.registerReceiver(
            context.applicationContext,
            receiver,
            IntentFilter(Intent.ACTION_BATTERY_CHANGED),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        if (sticky != null) update(sticky)
    }

    private fun update(intent: Intent) {
        val plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1)
        if (plugged < 0) return
        val now = plugged == 0
        if (now == onBattery) return
        onBattery = now
        listener?.invoke(now)
    }
}
