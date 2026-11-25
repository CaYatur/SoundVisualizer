/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.link

import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader

/* QR ÇÖZME (eşleşme kodu). Kamera sayfada (getUserMedia, kamera katmanının izniyle); sayfa gri
   tonlu küçük kareleri yollar, çözme burada gömülü ZXing çekirdeğiyle (Apache-2.0). Google Play
   Hizmetleri ya da ağ yok. Yalnız QR biçimi denenir. */
object QrDecode {
    private val hints = mapOf(
        DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
        DecodeHintType.TRY_HARDER to true,
        DecodeHintType.CHARACTER_SET to "UTF-8",
    )

    /** Gri tonlu (satır satır, bayt başına bir piksel) kareden metin; bulunamazsa null.
        Bulunamazsa yarım ölçekte bir kez daha denenir. Ölçüldü (5400 kusursuz yapay kare): tek
        denemede %1,35 kare okunmuyordu (çözücünün bulucu algılaması), yarım ölçekle %0,06. */
    fun gray(pixels: ByteArray, width: Int, height: Int): String? {
        if (width <= 0 || height <= 0 || width * height > pixels.size || width > 2000 || height > 2000) return null
        return once(pixels, width, height) ?: if (width >= 80 && height >= 80) once(half(pixels, width, height), width / 2, height / 2) else null
    }

    private fun once(pixels: ByteArray, width: Int, height: Int): String? = try {
        val src = PlanarYUVLuminanceSource(pixels, width, height, 0, 0, width, height, false)
        QRCodeReader().decode(BinaryBitmap(HybridBinarizer(src)), hints).text
    } catch (e: Exception) { null }

    /** İki kat küçültme: dört pikselin ortalaması. */
    internal fun half(px: ByteArray, w: Int, h: Int): ByteArray {
        val w2 = w / 2
        val h2 = h / 2
        val out = ByteArray(w2 * h2)
        for (y in 0 until h2) for (x in 0 until w2) {
            val i = 2 * y * w + 2 * x
            val s = (px[i].toInt() and 255) + (px[i + 1].toInt() and 255) + (px[i + w].toInt() and 255) + (px[i + w + 1].toInt() and 255)
            out[y * w2 + x] = (s / 4).toByte()
        }
        return out
    }
}
