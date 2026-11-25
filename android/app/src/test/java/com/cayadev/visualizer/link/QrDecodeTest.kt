/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.link

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/* Masaüstünün QR kodlayıcısının (src/shared/qr.js) ürettiği kare gömülü ZXing'le çözülüyor mu.
   Kare: gri tonlu, modül başına 5 piksel (android/app/src/test/resources/qr-frame.json). */
class QrDecodeTest {
    @Test fun masaustuKodlayicisininKaresiCozulur() {
        val o = JSONObject(javaClass.classLoader!!.getResourceAsStream("qr-frame.json")!!.readBytes().toString(Charsets.UTF_8))
        val bytes = java.util.Base64.getDecoder().decode(o.getString("data"))
        assertEquals(o.getString("text"), QrDecode.gray(bytes, o.getInt("w"), o.getInt("h")))
        assertNull(QrDecode.gray(ByteArray(100) { 128.toByte() }, 10, 10))
    }

    @Test fun yarimOlcekDortPikselinOrtalamasi() {
        val px = byteArrayOf(0, 100, 10, 20, 200.toByte(), 44, 30, 40, 255.toByte(), 255.toByte(), 0, 0, 255.toByte(), 255.toByte(), 0, 0)
        val h = QrDecode.half(px, 4, 4)
        org.junit.Assert.assertArrayEquals(byteArrayOf(86, 25, 255.toByte(), 0), h)
    }
}
