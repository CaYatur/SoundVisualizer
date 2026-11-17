/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.export

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.util.Log
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/* DIŞA AKTARIMIN SESİ: MP4'e yalnız AAC girer.

   ExportSession sesi yeniden kodlamadan kopyalıyor; bu yalnız AAC şarkıda (m4a) çalışıyordu.
   Telefondaki şarkıların çoğu MP3 (ya da OGG, FLAC, WAV): video sessiz çıkıyordu (ölçüldü:
   dışa aktarma sınaması yalnız m4a ile koşuyordu). Burada AAC olmayan şarkı, video başlamadan
   AAC'ye (m4a) çevriliyor: çözücü → 16 bit PCM → AAC kodlayıcı, yalnız videonun süresi kadar.
   Çok kanallı ses ilk iki kanala indiriliyor. Çeviri başarısızsa video sessiz kalır (önceki
   davranış) ve günlüğe yazılır. */
object AudioPrep {
    private const val TAG = "SVAudioPrep"
    private const val BITRATE = 192_000
    private const val TIMEOUT_US = 10_000L

    /**
     * Şarkının AAC hali: zaten AAC ise dosyanın kendisi, değilse yanına yazılan geçici
     * `<ad>.aac.m4a` (en çok [maxUs] mikrosaniye). Ses izi yoksa ya da çevrilemezse null.
     */
    fun aacFor(src: File, maxUs: Long): File? {
        val ex = MediaExtractor()
        try {
            ex.setDataSource(src.path)
            var track = -1
            for (t in 0 until ex.trackCount) {
                if ((ex.getTrackFormat(t).getString(MediaFormat.KEY_MIME) ?: "").startsWith("audio/")) { track = t; break }
            }
            if (track < 0) { Log.w(TAG, "ses izi yok: ${src.name}"); return null }
            val fmt = ex.getTrackFormat(track)
            if (fmt.getString(MediaFormat.KEY_MIME) == MediaFormat.MIMETYPE_AUDIO_AAC) return src
            val out = File(src.parentFile, src.nameWithoutExtension + ".aac.m4a")
            return try {
                val t0 = System.currentTimeMillis()
                transcode(ex, track, fmt, out, maxUs)
                Log.i(TAG, "${fmt.getString(MediaFormat.KEY_MIME)} → AAC: ${out.length()} B, ${System.currentTimeMillis() - t0} ms")
                out
            } catch (e: Exception) {
                Log.e(TAG, "AAC'ye çevrilemedi (${src.name})", e)
                out.delete()
                null
            }
        } catch (e: Exception) {
            Log.e(TAG, "şarkı okunamadı (${src.name})", e)
            return null
        } finally {
            ex.release()
        }
    }

    private fun transcode(ex: MediaExtractor, track: Int, inFmt: MediaFormat, out: File, maxUs: Long) {
        ex.selectTrack(track)
        val dec = MediaCodec.createDecoderByType(inFmt.getString(MediaFormat.KEY_MIME)!!)
        dec.configure(inFmt, null, null, 0)
        dec.start()
        var enc: MediaCodec? = null
        val muxer = MediaMuxer(out.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        var muxTrack = -1
        var rate = 44100
        var inCh = 2
        var outCh = 2
        var float = false
        var written = 0L // kodlayıcıya verilen kare (örnek/kanal) sayısı
        var pending: ByteBuffer? = null // kodlayıcıya sığmayan PCM artığı
        var inDone = false
        var decDone = false
        var eosSent = false
        var encDone = false
        val info = MediaCodec.BufferInfo()
        val eInfo = MediaCodec.BufferInfo()

        fun openEncoder(f: MediaFormat) {
            rate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            inCh = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            float = f.containsKey(MediaFormat.KEY_PCM_ENCODING) && f.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
            outCh = inCh.coerceIn(1, 2)
            val ef = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, rate, outCh)
            ef.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            ef.setInteger(MediaFormat.KEY_BIT_RATE, BITRATE)
            ef.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024)
            enc = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC).also {
                it.configure(ef, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                it.start()
            }
        }

        /* Çözücünün çıkışı → 16 bit, en çok iki kanal. */
        fun toPcm16(src: ByteBuffer, size: Int): ByteBuffer {
            src.order(ByteOrder.nativeOrder())
            val bytesPer = if (float) 4 else 2
            val frames = size / (bytesPer * inCh)
            val dst = ByteBuffer.allocate(frames * outCh * 2).order(ByteOrder.nativeOrder())
            val base = src.position()
            for (i in 0 until frames) {
                for (c in 0 until outCh) {
                    val at = base + (i * inCh + c) * bytesPer
                    val s: Short = if (float) {
                        (src.getFloat(at).coerceIn(-1f, 1f) * 32767f).toInt().toShort()
                    } else {
                        src.getShort(at)
                    }
                    dst.putShort(s)
                }
            }
            dst.flip()
            return dst
        }

        try {
            while (!encDone) {
                // 1) Şarkıdan çözücüye
                if (!inDone) {
                    val i = dec.dequeueInputBuffer(TIMEOUT_US)
                    if (i >= 0) {
                        val b = dec.getInputBuffer(i)!!
                        val n = ex.readSampleData(b, 0)
                        if (n < 0 || ex.sampleTime > maxUs) {
                            dec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inDone = true
                        } else {
                            dec.queueInputBuffer(i, 0, n, ex.sampleTime, 0)
                            ex.advance()
                        }
                    }
                }
                // 2) Çözücüden PCM (kodlayıcıya sığmayan artık bekletilir)
                if (!decDone && pending == null) {
                    val o = dec.dequeueOutputBuffer(info, TIMEOUT_US)
                    if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        if (enc == null) openEncoder(dec.outputFormat)
                    } else if (o >= 0) {
                        if (enc == null) openEncoder(dec.outputFormat)
                        if (info.size > 0) {
                            val b = dec.getOutputBuffer(o)!!
                            b.position(info.offset)
                            b.limit(info.offset + info.size)
                            pending = toPcm16(b, info.size)
                        }
                        dec.releaseOutputBuffer(o, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) decDone = true
                    }
                }
                val e = enc ?: continue
                // 3) PCM → kodlayıcı; zaman damgası yazılan örnek sayısından
                val p = pending
                if (p != null) {
                    val i = e.dequeueInputBuffer(TIMEOUT_US)
                    if (i >= 0) {
                        val b = e.getInputBuffer(i)!!
                        b.clear()
                        val n = minOf(b.remaining() - (b.remaining() % (outCh * 2)), p.remaining())
                        val slice = p.duplicate()
                        slice.limit(slice.position() + n)
                        b.put(slice)
                        p.position(p.position() + n)
                        e.queueInputBuffer(i, 0, n, written * 1_000_000L / rate, 0)
                        written += n / (outCh * 2)
                        if (!p.hasRemaining()) pending = null
                    }
                } else if (decDone && !eosSent) {
                    val i = e.dequeueInputBuffer(TIMEOUT_US)
                    if (i >= 0) {
                        e.queueInputBuffer(i, 0, 0, written * 1_000_000L / rate, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                        eosSent = true
                    }
                }
                // 4) Kodlayıcıdan m4a'ya
                while (true) {
                    val o = e.dequeueOutputBuffer(eInfo, if (eosSent) TIMEOUT_US else 0)
                    if (o == MediaCodec.INFO_TRY_AGAIN_LATER) break
                    if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        muxTrack = muxer.addTrack(e.outputFormat)
                        muxer.start()
                        continue
                    }
                    if (o < 0) continue
                    val b = e.getOutputBuffer(o)!!
                    if (eInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0 && eInfo.size > 0 && muxTrack >= 0) {
                        b.position(eInfo.offset)
                        b.limit(eInfo.offset + eInfo.size)
                        muxer.writeSampleData(muxTrack, b, eInfo)
                    }
                    e.releaseOutputBuffer(o, false)
                    if (eInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) { encDone = true; break }
                }
            }
            check(muxTrack >= 0 && written > 0) { "ses çıkmadı" }
            muxer.stop()
        } finally {
            try { dec.stop() } catch (_: Exception) {}
            dec.release()
            enc?.let { try { it.stop() } catch (_: Exception) {}; it.release() }
            try { muxer.release() } catch (_: Exception) {}
        }
    }
}
