/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.link

import java.nio.ByteBuffer
import java.nio.ByteOrder

/* SES PAKETİ (docs/PHONE-LINK.md "Audio"; masaüstündeki src/main/link-audio.js ile aynı yerleşim).
   Şifreli oturumun ikili iletisi; JSON iletiler '{' ile başlar, ses paketi tür baytıyla:
     [u8 1 = PCM][u8 sürüm 1][u32 BE sıra][u32 BE örnekleme hızı][u8 kanal 1|2][s16 LE örnekler]
   Telefon → PC: telefonun sesi bilgisayarın girişi (B4). PC → telefon: bilgisayarın sesi,
   telefon PC'nin ayarını kendi motoruyla çizerken (B5). */
object LinkAudio {
    const val KIND_PCM = 1
    const val VERSION = 1
    const val HEAD = 11
    const val MAX_FRAMES = 8192
    private val RATES = setOf(8000, 11025, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000)

    class Pcm(val seq: Long, val sampleRate: Int, val channels: Int, val samples: ShortArray)

    /** `frames` kanal başına örnek; `off` örnek dizisindeki başlangıç (araya serpiştirilmiş). */
    fun encode(seq: Long, sampleRate: Int, channels: Int, samples: ShortArray, off: Int, frames: Int): ByteArray {
        val n = frames * channels
        val b = ByteBuffer.allocate(HEAD + n * 2)
        b.put(KIND_PCM.toByte()).put(VERSION.toByte())
        b.order(ByteOrder.BIG_ENDIAN).putInt((seq and 0xffffffffL).toInt()).putInt(sampleRate).put(channels.toByte())
        b.order(ByteOrder.LITTLE_ENDIAN)
        for (i in 0 until n) b.putShort(samples[off + i])
        return b.array()
    }

    fun decode(raw: ByteArray): Pcm? {
        if (raw.size < HEAD || raw[0].toInt() != KIND_PCM || raw[1].toInt() != VERSION) return null
        val b = ByteBuffer.wrap(raw).order(ByteOrder.BIG_ENDIAN)
        val seq = b.getInt(2).toLong() and 0xffffffffL
        val rate = b.getInt(6)
        val ch = raw[10].toInt()
        if (rate !in RATES || (ch != 1 && ch != 2)) return null
        val bytes = raw.size - HEAD
        if (bytes % (2 * ch) != 0) return null
        val frames = bytes / (2 * ch)
        if (frames == 0 || frames > MAX_FRAMES) return null
        val out = ShortArray(frames * ch)
        b.order(ByteOrder.LITTLE_ENDIAN)
        for (i in out.indices) out[i] = b.getShort(HEAD + i * 2)
        return Pcm(seq, rate, ch, out)
    }
}
