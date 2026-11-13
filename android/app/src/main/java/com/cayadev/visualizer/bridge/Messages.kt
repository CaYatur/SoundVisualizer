/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.bridge

import java.nio.ByteBuffer
import java.nio.ByteOrder

/* İKİLİ İLETİ BİÇİMİ — docs/android/MESSAGES.md. Sayfa tarafındaki karşılığı
   src/mobile/messages.js; iki taraf aynı sabitleri kullanır ve çapraz testle
   (tests/fixtures/android-messages) birbirine bağlıdır. Hepsi küçük uçlu. */
object Messages {
    const val VERSION = 1
    const val HEADER_BYTES = 16
    const val MAGIC0: Byte = 0x53 // 'S'
    const val MAGIC1: Byte = 0x56 // 'V'

    const val TYPE_PCM = 0x01
    const val TYPE_WAVE = 0x02
    const val TYPE_VIDEO_CHUNK = 0x10
    const val TYPE_VIDEO_CONFIG = 0x11

    const val PCM_HEADER_BYTES = 8
    const val FORMAT_S16 = 1
    const val FORMAT_F32 = 2
    const val SOURCE_PLAYER = 1
    const val SOURCE_CAPTURE = 2
    const val SOURCE_MIC = 3

    data class Header(val type: Int, val seq: Long, val timeMs: Double) {
        fun write(buf: ByteBuffer) {
            buf.order(ByteOrder.LITTLE_ENDIAN)
            buf.put(MAGIC0).put(MAGIC1).put(VERSION.toByte()).put(type.toByte())
            buf.putInt(seq.toInt())
            buf.putDouble(timeMs)
        }

        companion object {
            /** Başlığı okur; sihirli bayt, sürüm ya da uzunluk tutmazsa null. */
            fun read(bytes: ByteArray): Header? {
                if (bytes.size < HEADER_BYTES) return null
                if (bytes[0] != MAGIC0 || bytes[1] != MAGIC1) return null
                if (bytes[2].toInt() != VERSION) return null
                val b = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
                val type = bytes[3].toInt() and 0xff
                val seq = b.getInt(4).toLong() and 0xffffffffL
                val time = b.getDouble(8)
                return Header(type, seq, time)
            }
        }
    }

    /** PCM iletisi (uygulama → sayfa). [samples] iç içe kanallı 16 bit örnekler. */
    fun pcmS16(seq: Long, timeMs: Double, sampleRate: Int, channels: Int, source: Int, samples: ShortArray, count: Int): ByteArray {
        val out = ByteArray(HEADER_BYTES + PCM_HEADER_BYTES + count * 2)
        val buf = ByteBuffer.wrap(out).order(ByteOrder.LITTLE_ENDIAN)
        Header(TYPE_PCM, seq, timeMs).write(buf)
        buf.putInt(sampleRate)
        buf.put(channels.toByte()).put(FORMAT_S16.toByte()).put(source.toByte()).put(0)
        for (i in 0 until count) buf.putShort(samples[i])
        return out
    }
}
