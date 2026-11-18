/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.tonegen

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.SystemClock

/* Sınama için medya oturumları: başka uygulamaların (YouTube, köprü uygulamaları) davranışı.
   adb shell am broadcast -n com.cayadev.visualizer.tonegen/.SessionReceiver
     -e id a -e state play|pause|stop|release -e title "Parça" -e color "#ff2040" */
class SessionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra("id") ?: "a"
        val state = intent.getStringExtra("state") ?: "pause"
        if (state == "release") { sessions.remove(id)?.release(); return }
        val s = sessions.getOrPut(id) { MediaSession(context.applicationContext, "probe-$id").apply { isActive = true } }
        intent.getStringExtra("title")?.let { title ->
            val md = MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, "Probe $id")
                .putLong(MediaMetadata.METADATA_KEY_DURATION, 180000L)
            intent.getStringExtra("color")?.let { c ->
                md.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.parseColor(c)) })
            }
            s.setMetadata(md.build())
        }
        val code = when (state) {
            "play" -> PlaybackState.STATE_PLAYING
            "stop" -> PlaybackState.STATE_STOPPED
            else -> PlaybackState.STATE_PAUSED
        }
        s.setPlaybackState(PlaybackState.Builder().setState(code, 1000L, if (state == "play") 1f else 0f, SystemClock.elapsedRealtime()).build())
    }

    companion object {
        private val sessions = HashMap<String, MediaSession>()
    }
}
