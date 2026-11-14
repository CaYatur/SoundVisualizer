/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.export

import android.content.Context
import android.os.Environment
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.cayadev.visualizer.bridge.Messages
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/* Dışa aktarım işinin sayfa tarafıyla buluşma noktası (0E6). Kodlama ayrı bir
   iş parçacığında: ana iş parçacığı (WebView) kareleri almaya devam eder. Her
   kare kodlayıcıya verilince sayfaya `exportAck` olayı gider; sayfa bununla geri
   basınç uygular (masaüstünde ffmpeg.stdin'in yazımı bekleniyordu). */
class ExportHub(private val context: Context, private val event: (String, JSONObject) -> Unit) {
    private val tag = "SVExport"
    private val thread = HandlerThread("sv-export").also { it.start() }
    private val worker = Handler(thread.looper)
    private val main = Handler(Looper.getMainLooper())
    private var session: ExportSession? = null
    private var job = 0
    private var started = 0L
    private var receivedBytes = 0L

    fun begin(args: JSONObject, done: (JSONObject?, String?) -> Unit) {
        worker.post {
            try {
                session?.abort()
                val w = args.getInt("width")
                val h = args.getInt("height")
                val fps = args.optInt("fps", 30)
                val bitrate = args.optInt("bitrate", (w * h * fps * 0.15).toInt())
                val audio = args.optString("audio").takeIf { it.isNotEmpty() }?.let { mediaFile(it) }
                val dir = context.getExternalFilesDir(Environment.DIRECTORY_MOVIES) ?: context.filesDir
                val out = File(dir, args.optString("name", "export-${System.currentTimeMillis()}.mp4"))
                val s = ExportSession(out, w, h, fps, bitrate, audio?.takeIf { it.exists() })
                session = s
                job++
                started = SystemClock.elapsedRealtime()
                receivedBytes = 0
                val r = JSONObject().put("job", job).put("codec", s.codecName).put("path", out.path)
                main.post { done(r, null) }
            } catch (e: Exception) {
                Log.e(tag, "başlatılamadı", e)
                main.post { done(null, e.javaClass.simpleName + ": " + e.message) }
            }
        }
    }

    /** VIDEO-FRAME iletisi (MESSAGES.md 0x12). Ana iş parçacığında çağrılır. */
    fun frame(bytes: ByteArray) {
        val b = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        val jobId = b.getInt(16)
        val index = b.getInt(20)
        receivedBytes += bytes.size
        worker.post {
            val s = session
            if (s == null || jobId != job) return@post
            try {
                s.encodeI420(bytes, Messages.VIDEO_FRAME_HEADER_BYTES)
                main.post { event("exportAck", JSONObject().put("job", jobId).put("index", index)) }
            } catch (e: Exception) {
                Log.e(tag, "kare $index kodlanamadı", e)
                main.post { event("exportError", JSONObject().put("job", jobId).put("index", index).put("msg", e.message ?: e.javaClass.simpleName)) }
            }
        }
    }

    fun end(done: (JSONObject?, String?) -> Unit) {
        worker.post {
            val s = session
            session = null
            if (s == null) { main.post { done(null, "no-session") }; return@post }
            try {
                val file = s.finish()
                val ms = SystemClock.elapsedRealtime() - started
                val r = JSONObject().put("path", file.path).put("bytes", file.length()).put("frames", s.frames)
                    .put("encodeMs", Math.round(s.encodeMs)).put("totalMs", ms).put("receivedMB", receivedBytes / 1e6)
                main.post { done(r, null) }
            } catch (e: Exception) {
                Log.e(tag, "bitirilemedi", e)
                s.abort()
                main.post { done(null, e.javaClass.simpleName + ": " + e.message) }
            }
        }
    }

    fun cancel() {
        worker.post {
            session?.abort()
            session = null
        }
    }

    /* Uygulamanın medya klasöründeki dosya (sayfa da aynı dosyayı /files/ altından okuyor). */
    private fun mediaFile(name: String): File {
        val dir = File(context.filesDir, "media")
        val f = File(dir, name).canonicalFile
        require(f.path.startsWith(dir.canonicalPath + File.separator)) { "klasör dışı yol" }
        return f
    }

    companion object {
        fun mediaDir(context: Context): File = File(context.filesDir, "media").also { it.mkdirs() }
    }
}
