/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.media

import org.junit.Assert.assertEquals
import org.junit.Test

/* Galeriden gelen görsel ayara girmeden önce küçültülüyor (uzun kenar en çok 1024 px). */
class MediaPickTest {
    @Test
    fun longSideIsCappedAndRatioKept() {
        assertEquals(Pair(1024, 576), MediaPick.scaledSize(4000, 2250))
        assertEquals(Pair(576, 1024), MediaPick.scaledSize(2250, 4000))
        assertEquals(Pair(1024, 1024), MediaPick.scaledSize(3000, 3000))
    }

    @Test
    fun smallImagesStayAsTheyAre() {
        assertEquals(Pair(512, 512), MediaPick.scaledSize(512, 512))
        assertEquals(Pair(1024, 10), MediaPick.scaledSize(1024, 10))
        // Çok ince görselde kısa kenar sıfıra inmez
        assertEquals(1, MediaPick.scaledSize(100000, 10).second)
    }
}
