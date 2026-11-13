/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.bridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

/* docs/android/MESSAGES.md'deki yerleşim. */
class MessagesTest {
    @Test
    fun headerRoundTrip() {
        val buf = ByteBuffer.allocate(Messages.HEADER_BYTES)
        Messages.Header(Messages.TYPE_PCM, 0xfffffffeL, 1234.5).write(buf)
        val h = Messages.Header.read(buf.array())
        assertNotNull(h)
        assertEquals(Messages.TYPE_PCM, h!!.type)
        assertEquals(0xfffffffeL, h.seq)
        assertEquals(1234.5, h.timeMs, 0.0)
    }

    @Test
    fun headerRejectsBadInput() {
        assertNull(Messages.Header.read(ByteArray(15)))
        val bad = ByteArray(16).also { it[0] = 0x53; it[1] = 0x57; it[2] = 1 }
        assertNull(Messages.Header.read(bad))
        val wrongVersion = ByteArray(16).also { it[0] = 0x53; it[1] = 0x56; it[2] = 2 }
        assertNull(Messages.Header.read(wrongVersion))
    }

    @Test
    fun pcmLayout() {
        val samples = shortArrayOf(1, -1, 32767, -32768)
        val out = Messages.pcmS16(7, 10.0, 48000, 2, Messages.SOURCE_CAPTURE, samples, samples.size)
        assertEquals(Messages.HEADER_BYTES + Messages.PCM_HEADER_BYTES + 8, out.size)
        val b = ByteBuffer.wrap(out).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals(0x53.toByte(), out[0])
        assertEquals(0x56.toByte(), out[1])
        assertEquals(1.toByte(), out[2])
        assertEquals(Messages.TYPE_PCM.toByte(), out[3])
        assertEquals(7, b.getInt(4))
        assertEquals(48000, b.getInt(16))
        assertEquals(2.toByte(), out[20])
        assertEquals(Messages.FORMAT_S16.toByte(), out[21])
        assertEquals(Messages.SOURCE_CAPTURE.toByte(), out[22])
        assertEquals(0.toByte(), out[23])
        assertEquals(1.toShort(), b.getShort(24))
        assertEquals((-1).toShort(), b.getShort(26))
        assertEquals(32767.toShort(), b.getShort(28))
        assertEquals((-32768).toShort(), b.getShort(30))
    }
}
