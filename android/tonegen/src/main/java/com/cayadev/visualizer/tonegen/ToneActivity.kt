/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.tonegen

import android.app.Activity
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Bundle
import android.util.Log
import kotlin.math.PI
import kotlin.math.sin

/* Bilinen bir ses çalar: 110 Hz (sol) ve 3500 Hz (sağ) sinüs, her saniye bir
   "vuruş". Yakalanan sayfanın tayfında bu iki tepe aranır. */
class ToneActivity : Activity() {
    @Volatile private var playing = false
    private var thread: Thread? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val deny = intent.getStringExtra("mode") == "deny"
        val seconds = intent.getStringExtra("seconds")?.toIntOrNull() ?: 20
        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .setAllowedCapturePolicy(if (deny) AudioAttributes.ALLOW_CAPTURE_BY_NONE else AudioAttributes.ALLOW_CAPTURE_BY_ALL)
            .build()
        val rate = 48000
        val fmt = AudioFormat.Builder().setSampleRate(rate).setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO).build()
        val track = AudioTrack.Builder().setAudioAttributes(attrs).setAudioFormat(fmt)
            .setBufferSizeInBytes(rate).setTransferMode(AudioTrack.MODE_STREAM).build()
        playing = true
        Log.i(TAG, "çalıyor: mode=${if (deny) "deny" else "allow"} süre=${seconds}s")
        thread = Thread {
            track.play()
            val block = ShortArray(1024 * 2)
            var n = 0L
            val total = seconds.toLong() * rate
            while (playing && n < total) {
                for (i in 0 until 1024) {
                    val t = (n + i).toDouble() / rate
                    val beat = if (((n + i) % rate) < rate / 10) 1.0 else 0.35
                    block[i * 2] = (12000 * beat * sin(2 * PI * 110 * t)).toInt().toShort()
                    block[i * 2 + 1] = (9000 * beat * sin(2 * PI * 3500 * t)).toInt().toShort()
                }
                track.write(block, 0, block.size)
                n += 1024
            }
            track.stop()
            track.release()
            Log.i(TAG, "bitti")
            runOnUiThread { finish() }
        }.also { it.start() }
    }

    override fun onDestroy() {
        playing = false
        super.onDestroy()
    }

    companion object {
        private const val TAG = "SVTone"
    }
}
