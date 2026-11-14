/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.export

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.SystemClock
import android.util.Log
import java.io.File
import java.nio.ByteBuffer

/* VİDEO DIŞA AKTARIMI, kodlama ucu (docs/android/PLAN.md D5, 0E6).

   Dışa aktarım sayfası (src/exporter, değişmeden) her kareyi masaüstündeki gibi
   I420 olarak üretiyor; masaüstünde bu kareler ffmpeg'e gidiyordu, burada
   Android'in kodlayıcısına (MediaCodec, H.264) gidiyor. WebCodecs'e
   dayanılmıyor: emülatörün WebView'inde H.264 kodlayıcısı hiç yok, telefonlarda
   da sürücüye bağlı.

   Ses izi: şarkı AAC ise (m4a/mp4) örnekler yeniden kodlanmadan kopyalanır ve
   video süresinde kesilir. Başka biçimler Faz 5'te (çöz + AAC kodla).

   Tek iş parçacığından çağrılır (Bridge → ExportHub iş parçacığı). */
class ExportSession(
    private val out: File,
    private val width: Int,
    private val height: Int,
    private val fps: Int,
    bitrate: Int,
    private val audio: File?,
) {
    private val tag = "SVExport"
    private val codec: MediaCodec
    private val muxer = MediaMuxer(out.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    private var videoTrack = -1
    private var audioTrack = -1
    private var muxing = false
    private val info = MediaCodec.BufferInfo()
    var frames = 0
        private set
    var encodeMs = 0.0
        private set
    val codecName: String

    init {
        val fmt = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
            setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
            setInteger(MediaFormat.KEY_FRAME_RATE, fps)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
        }
        codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        codecName = codec.name
        codec.configure(fmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        codec.start()
    }

    /** Bir I420 kare (Y, sonra U, sonra V; yarım çözünürlüklü renk). */
    fun encodeI420(src: ByteArray, offset: Int) {
        val t0 = SystemClock.elapsedRealtimeNanos()
        val ySize = width * height
        val cSize = ySize / 4
        require(src.size - offset >= ySize + 2 * cSize) { "kare kısa: ${src.size - offset}" }
        var index: Int
        while (true) {
            index = codec.dequeueInputBuffer(10_000)
            if (index >= 0) break
            drain(false)
        }
        val image = codec.getInputImage(index) ?: error("kodlayıcı görüntü vermedi")
        // Düzlemler sürücüye göre düzlemsel ya da yarı düzlemsel olabilir: adımlarla yaz
        writePlane(image.planes[0].buffer, image.planes[0].rowStride, image.planes[0].pixelStride, src, offset, width, height)
        writePlane(image.planes[1].buffer, image.planes[1].rowStride, image.planes[1].pixelStride, src, offset + ySize, width / 2, height / 2)
        writePlane(image.planes[2].buffer, image.planes[2].rowStride, image.planes[2].pixelStride, src, offset + ySize + cSize, width / 2, height / 2)
        val pts = frames.toLong() * 1_000_000L / fps
        codec.queueInputBuffer(index, 0, ySize + 2 * cSize, pts, 0)
        frames++
        drain(false)
        encodeMs += (SystemClock.elapsedRealtimeNanos() - t0) / 1e6
    }

    private fun writePlane(dst: ByteBuffer, rowStride: Int, pixelStride: Int, src: ByteArray, at: Int, w: Int, h: Int) {
        if (pixelStride == 1 && rowStride == w) {
            dst.put(src, at, w * h)
            return
        }
        for (y in 0 until h) {
            val row = at + y * w
            if (pixelStride == 1) {
                dst.position(y * rowStride)
                dst.put(src, row, w)
            } else {
                var p = y * rowStride
                for (x in 0 until w) {
                    dst.put(p, src[row + x])
                    p += pixelStride
                }
            }
        }
    }

    private fun drain(end: Boolean) {
        while (true) {
            val i = codec.dequeueOutputBuffer(info, if (end) 10_000 else 0)
            when {
                i == MediaCodec.INFO_TRY_AGAIN_LATER -> if (!end) return
                i == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    videoTrack = muxer.addTrack(codec.outputFormat)
                    audioTrack = audio?.let { addAudioTrack(it) } ?: -1
                    muxer.start()
                    muxing = true
                }
                i >= 0 -> {
                    val buf = codec.getOutputBuffer(i)!!
                    val config = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
                    if (!config && info.size > 0 && muxing) {
                        buf.position(info.offset)
                        buf.limit(info.offset + info.size)
                        muxer.writeSampleData(videoTrack, buf, info)
                    }
                    codec.releaseOutputBuffer(i, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
                }
            }
        }
    }

    private var extractor: MediaExtractor? = null

    private fun addAudioTrack(file: File): Int {
        val ex = MediaExtractor()
        ex.setDataSource(file.path)
        for (t in 0 until ex.trackCount) {
            val f = ex.getTrackFormat(t)
            if (f.getString(MediaFormat.KEY_MIME) == MediaFormat.MIMETYPE_AUDIO_AAC) {
                ex.selectTrack(t)
                extractor = ex
                return muxer.addTrack(f)
            }
        }
        Log.w(tag, "AAC ses izi yok (${file.name}); video sessiz")
        ex.release()
        return -1
    }

    /* Ses örneklerini videonun süresi kadar kopyala (yeniden kodlamadan). */
    private fun copyAudio() {
        val ex = extractor ?: return
        val endUs = frames.toLong() * 1_000_000L / fps
        val buf = ByteBuffer.allocate(256 * 1024)
        val ai = MediaCodec.BufferInfo()
        while (true) {
            val n = ex.readSampleData(buf, 0)
            if (n < 0) break
            val t = ex.sampleTime
            if (t > endUs) break
            ai.set(0, n, t, if (ex.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
            muxer.writeSampleData(audioTrack, buf, ai)
            ex.advance()
        }
        ex.release()
        extractor = null
    }

    /** Kodlayıcıyı boşaltır ve MP4'ü kapatır; dosyanın yolunu döndürür. */
    fun finish(): File {
        var index: Int
        while (true) {
            index = codec.dequeueInputBuffer(10_000)
            if (index >= 0) break
            drain(false)
        }
        codec.queueInputBuffer(index, 0, 0, frames.toLong() * 1_000_000L / fps, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
        drain(true)
        if (muxing && audioTrack >= 0) copyAudio()
        codec.stop()
        codec.release()
        if (muxing) muxer.stop()
        muxer.release()
        return out
    }

    /** İptal ya da hata: her şeyi bırak, yarım dosyayı sil. */
    fun abort() {
        try { codec.stop() } catch (_: Exception) {}
        try { codec.release() } catch (_: Exception) {}
        try { if (muxing) muxer.stop() } catch (_: Exception) {}
        try { muxer.release() } catch (_: Exception) {}
        extractor?.release()
        out.delete()
    }
}
