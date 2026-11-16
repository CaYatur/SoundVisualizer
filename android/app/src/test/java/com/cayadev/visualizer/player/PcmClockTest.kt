/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/* Çaların sesi, çözüldüğünde değil, oynatma konumu ona gelince bırakılır. */
class PcmClockTest {
    private fun stereo(frames: Int, v: Short = 1000) = ShortArray(frames * 2) { v }

    @Test
    fun splitsIntoBlocksAndWaitsForThePlayhead() {
        val c = PcmClock()
        c.format(48000, 2)
        c.push(stereo(4096)) // 85 ms, 8 blok
        assertEquals(8, c.pending())
        val got = mutableListOf<PcmClock.Chunk>()
        // İlk görüş: parçanın başı 1000 ms; henüz yalnız ilk blok duyuldu
        assertEquals(1, c.release(1000) { got.add(it) })
        assertEquals(0L, got[0].startFrame)
        assertEquals(512, got[0].frames)
        // 20 ms sonra: 960 örnek duyuldu → ikinci blok da (512 ≤ 960 < 1024)
        assertEquals(1, c.release(1020) { got.add(it) })
        // 100 ms sonra hepsi
        assertEquals(6, c.release(1100) { got.add(it) })
        assertEquals(0, c.pending())
        assertEquals(3584L, got.last().startFrame)
    }

    @Test
    fun aSeekStartsANewSegmentAndDropsTheOldOne() {
        val c = PcmClock()
        c.format(44100, 2)
        c.push(stereo(2048))
        c.release(0) {}
        // Atlama: oynatıcı boşalttı, eski bekleyen ses atılır
        c.format(44100, 2)
        c.push(stereo(1024))
        val got = mutableListOf<PcmClock.Chunk>()
        assertEquals(1, c.release(30000) { got.add(it) }) // yeni parçanın başı 30 sn
        assertEquals(c.gen, got[0].gen)
        assertEquals(0L, got[0].startFrame)
        assertEquals(1, c.release(30012) { got.add(it) })
    }

    @Test
    fun pausedPlayheadHoldsTheAudioAndTheQueueIsBounded() {
        val c = PcmClock(maxSeconds = 1)
        c.format(48000, 1)
        c.push(ShortArray(48000 * 3)) // 3 sn, konum hiç ilerlemiyor
        assertTrue(c.dropped > 0)
        assertTrue(c.pending() * 512 <= 48000 + 512)
        // En eski 2 sn atıldı: kalan ses konum 2 sn ilerleyince duyulacak, duran konumda hiçbiri
        assertEquals(0, c.release(500) {})
        assertEquals(0, c.release(500) {})
        assertEquals(94, c.pending())
    }

    @Test
    fun oddCountsKeepWholeFrames() {
        val c = PcmClock()
        c.format(48000, 2)
        c.push(ShortArray(7), 7) // 3 tam kare + yarım
        val got = mutableListOf<PcmClock.Chunk>()
        c.release(0) { got.add(it) }
        assertEquals(1, got.size)
        assertEquals(6, got[0].samples.size)
    }
}
