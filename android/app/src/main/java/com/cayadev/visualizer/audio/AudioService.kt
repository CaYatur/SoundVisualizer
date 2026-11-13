/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.audio

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.Visualizer
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.ServiceCompat
import com.cayadev.visualizer.R
import com.cayadev.visualizer.bridge.Messages

/* SES YAKALAMA SERVİSİ (docs/android/PLAN.md D4, 0E5).

   Üç kaynak, hepsi ön plan servisinde (Android 14+ türü bildirimde yazılı):
     - capture: başka uygulamaların sesi (AudioPlaybackCapture, Android 10+).
       Kullanıcı her oturumda sistem penceresinden onay veriyor; uygulamalar
       seslerinin yakalanmasını kapatabiliyor.
     - mic: mikrofon.
     - visualizer: çıkış karışımının düşük çözünürlüklü dalgası (Visualizer,
       oturum 0). Yakalamayı kapatan uygulamalarda yedek.

   Ham ses AudioHub üzerinden sayfaya gider; FFT sayfada, masaüstüyle aynı
   kodla (src/shared/audio-spectrum.js) hesaplanır. */
class AudioService : Service() {
    private val tag = "SVAudio"
    @Volatile private var running = false
    private var thread: Thread? = null
    private var record: AudioRecord? = null
    private var projection: MediaProjection? = null
    private var visualizer: Visualizer? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val source = intent?.getStringExtra(EXTRA_SOURCE) ?: return START_NOT_STICKY
        stopCapture()
        when (source) {
            SOURCE_CAPTURE -> {
                val code = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
                val data: Intent? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
                else @Suppress("DEPRECATION") intent.getParcelableExtra(EXTRA_RESULT_DATA)
                // Android 14+: tür bildirilerek ön plana geçmek, izni kullanmadan ÖNCE şart
                foreground(ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
                val mpm = getSystemService(MediaProjectionManager::class.java)
                val p = data?.let { mpm.getMediaProjection(code, it) }
                if (p == null) { fail(source, "no-projection"); return START_NOT_STICKY }
                projection = p
                p.registerCallback(object : MediaProjection.Callback() {
                    override fun onStop() {
                        AudioHub.status(SOURCE_CAPTURE, "stopped")
                        stopSelf()
                    }
                }, null)
                startRecord(source) { b -> b.setAudioPlaybackCaptureConfig(captureConfig(p)) }
            }
            SOURCE_MIC -> {
                foreground(micType())
                startRecord(source) { b -> b.setAudioSource(MediaRecorder.AudioSource.UNPROCESSED) }
            }
            SOURCE_VISUALIZER -> {
                foreground(micType())
                startVisualizer()
            }
            else -> stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun captureConfig(p: MediaProjection) = AudioPlaybackCaptureConfiguration.Builder(p)
        .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
        .addMatchingUsage(AudioAttributes.USAGE_GAME)
        .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
        .build()

    @SuppressLint("MissingPermission") // RECORD_AUDIO sayfa isteği sırasında Activity'de alındı
    private fun startRecord(source: String, configure: (AudioRecord.Builder) -> Unit) {
        val fmt = AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(RATE)
            .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
            .build()
        val min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_STEREO, AudioFormat.ENCODING_PCM_16BIT)
        val r = try {
            val b = AudioRecord.Builder().setAudioFormat(fmt).setBufferSizeInBytes(maxOf(min, BLOCK * 2 * 2 * 8))
            configure(b)
            b.build()
        } catch (e: Exception) {
            // UNPROCESSED desteklenmiyorsa düz mikrofona düş
            if (source == SOURCE_MIC) {
                try {
                    AudioRecord.Builder().setAudioFormat(fmt).setAudioSource(MediaRecorder.AudioSource.MIC)
                        .setBufferSizeInBytes(maxOf(min, BLOCK * 2 * 2 * 8)).build()
                } catch (e2: Exception) { fail(source, "record-${e2.javaClass.simpleName}"); return }
            } else { fail(source, "record-${e.javaClass.simpleName}"); return }
        }
        if (r.state != AudioRecord.STATE_INITIALIZED) { r.release(); fail(source, "record-init"); return }
        record = r
        running = true
        val srcCode = if (source == SOURCE_CAPTURE) Messages.SOURCE_CAPTURE else Messages.SOURCE_MIC
        r.startRecording()
        AudioHub.status(source, "running")
        thread = Thread({
            val buf = ShortArray(BLOCK * 2)
            while (running) {
                val n = r.read(buf, 0, buf.size, AudioRecord.READ_BLOCKING)
                if (n > 0) AudioHub.pushPcm(RATE, 2, srcCode, buf, n)
                else if (n < 0) { Log.w(tag, "okuma hatası $n"); break }
            }
        }, "sv-audio-$source").also { it.start() }
    }

    @SuppressLint("MissingPermission")
    private fun startVisualizer() {
        val v = try { Visualizer(0) } catch (e: Exception) { fail(SOURCE_VISUALIZER, "visualizer-${e.javaClass.simpleName}"); return }
        try {
            v.enabled = false
            v.captureSize = Visualizer.getCaptureSizeRange()[1]
            v.scalingMode = Visualizer.SCALING_MODE_NORMALIZED
            val rate = Visualizer.getMaxCaptureRate()
            val sr = v.samplingRate / 1000 // mHz → Hz
            v.setDataCaptureListener(object : Visualizer.OnDataCaptureListener {
                override fun onWaveFormDataCapture(vis: Visualizer, waveform: ByteArray, samplingRate: Int) {
                    AudioHub.pushWave(sr, waveform)
                }
                override fun onFftDataCapture(vis: Visualizer, fft: ByteArray, samplingRate: Int) {}
            }, rate, true, false)
            v.enabled = true
            visualizer = v
            AudioHub.status(SOURCE_VISUALIZER, "running")
        } catch (e: Exception) {
            v.release()
            fail(SOURCE_VISUALIZER, "visualizer-${e.javaClass.simpleName}")
        }
    }

    private fun fail(source: String, why: String) {
        Log.w(tag, "$source başlatılamadı: $why")
        AudioHub.status(source, "error:$why")
        stopSelf()
    }

    private fun stopCapture() {
        running = false
        thread?.join(500)
        thread = null
        record?.let { try { it.stop() } catch (_: Exception) {}; it.release() }
        record = null
        visualizer?.let { try { it.enabled = false } catch (_: Exception) {}; it.release() }
        visualizer = null
        projection?.stop()
        projection = null
    }

    /* Mikrofon türü Android 11'de geldi; Android 10'da tür verilmez. */
    private fun micType(): Int = if (Build.VERSION.SDK_INT >= 30) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0

    private fun foreground(type: Int) {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.audio_channel), NotificationManager.IMPORTANCE_LOW))
        }
        val n: Notification = Notification.Builder(this, CHANNEL)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.audio_running))
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .build()
        ServiceCompat.startForeground(this, NOTIFICATION_ID, n, type)
    }

    override fun onDestroy() {
        stopCapture()
        AudioHub.status("all", "stopped")
        super.onDestroy()
    }

    companion object {
        const val RATE = 48000
        const val BLOCK = 512 // masaüstündeki yardımcıyla aynı blok (örnek/kanal)
        const val CHANNEL = "audio"
        const val NOTIFICATION_ID = 1
        const val EXTRA_SOURCE = "source"
        const val EXTRA_RESULT_CODE = "code"
        const val EXTRA_RESULT_DATA = "data"
        const val SOURCE_CAPTURE = "capture"
        const val SOURCE_MIC = "mic"
        const val SOURCE_VISUALIZER = "visualizer"
        val SOURCES = setOf(SOURCE_CAPTURE, SOURCE_MIC, SOURCE_VISUALIZER)

        fun start(context: Context, source: String, code: Int = 0, data: Intent? = null) {
            val i = Intent(context, AudioService::class.java).putExtra(EXTRA_SOURCE, source)
            if (data != null) i.putExtra(EXTRA_RESULT_CODE, code).putExtra(EXTRA_RESULT_DATA, data)
            context.startForegroundService(i)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, AudioService::class.java))
        }
    }
}
