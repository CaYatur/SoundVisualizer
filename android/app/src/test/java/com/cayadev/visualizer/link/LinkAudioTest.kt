/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.link

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/* Ses paketi masaüstündeki src/main/link-audio.js ile bayt bayt aynı (docs/PHONE-LINK.md "Audio").
   Beklenen baytlar elle: tür 1, sürüm 1, sıra 7 (BE), 48000 (BE), 2 kanal, örnekler s16 LE. */
class LinkAudioTest {
    private fun hex(s: String) = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

    @Test fun masaustuyleAyniBaytlar() {
        val pkt = LinkAudio.encode(7, 48000, 2, shortArrayOf(1, -2, 32767, -32768), 0, 2)
        assertArrayEquals(hex("0101000000070000bb80020100feffff7f0080"), pkt)
        val p = LinkAudio.decode(pkt)!!
        assertEquals(7L, p.seq)
        assertEquals(48000, p.sampleRate)
        assertEquals(2, p.channels)
        assertArrayEquals(shortArrayOf(1, -2, 32767, -32768), p.samples)
    }

    @Test fun parcaDiziBaslangiciylaYazilir() {
        val p = LinkAudio.decode(LinkAudio.encode(1, 44100, 1, shortArrayOf(9, 8, 7, 6), 2, 2))!!
        assertArrayEquals(shortArrayOf(7, 6), p.samples)
    }

    @Test fun bozukPaketReddedilir() {
        val good = LinkAudio.encode(1, 48000, 2, ShortArray(4), 0, 2)
        assertNull(LinkAudio.decode(good.copyOf(good.size - 1)))
        assertNull(LinkAudio.decode(good.copyOf().also { it[0] = '{'.code.toByte() }))
        assertNull(LinkAudio.decode(good.copyOf().also { it[10] = 3 }))
        assertNull(LinkAudio.decode(good.copyOf().also { it[6] = 0; it[7] = 0; it[8] = 0x30; it[9] = 0x39 }))
        assertNull(LinkAudio.decode(LinkAudio.encode(1, 48000, 1, ShortArray(LinkAudio.MAX_FRAMES + 1), 0, LinkAudio.MAX_FRAMES + 1)))
        assertNull(LinkAudio.decode(ByteArray(5)))
    }
}
