/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.media

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.cayadev.visualizer.R

/* YÜZEN PENCEREDE KAMERA (Faz 4). Uygulama arkadayken (yalnız yüzen pencere) Android
   kamerayı ancak "kamera" türünde bir ön plan hizmeti çalışıyorsa verir; yoksa kamera
   katmanı yüzen pencereye geçince donuyordu. Hizmet yalnız şu durumda kurulur: sahnede açık
   bir kamera katmanı var, kamera izni verilmiş ve yüzen pencere uygulama öndeyken açılıyor
   (Android ön plan hizmetini kamerayla yalnız o an başlatmaya izin veriyor). Pencere
   kapanınca ya da uygulamaya dönülünce durur. Bildirim kameranın açık olduğunu söyler. */
class CameraService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.camera_channel), NotificationManager.IMPORTANCE_LOW))
        }
        val n: Notification = Notification.Builder(this, CHANNEL)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.camera_running))
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setOngoing(true)
            .build()
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA)
        } catch (e: Exception) {
            // Arka plandan başlatılamaz ya da izin yok: kamera yalnız uygulama öndeyken çalışır
            Log.w(TAG, "kamera ön plan hizmeti başlatılamadı", e)
            stopSelf()
        }
        return START_NOT_STICKY
    }

    companion object {
        private const val TAG = "SVCamera"
        const val CHANNEL = "camera"
        const val NOTIFICATION_ID = 3
        var running = false
            private set

        fun start(context: Context): Boolean {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return false
            return try {
                context.startForegroundService(Intent(context, CameraService::class.java))
                running = true
                true
            } catch (e: Exception) {
                Log.w(TAG, "başlatılamadı", e)
                false
            }
        }

        fun stop(context: Context) {
            if (!running) return
            running = false
            context.stopService(Intent(context, CameraService::class.java))
        }
    }
}
