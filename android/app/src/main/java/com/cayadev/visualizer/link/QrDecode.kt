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

    /** Gri tonlu (satır satır, bayt başına bir piksel) kareden metin; bulunamazsa null. */
    fun gray(pixels: ByteArray, width: Int, height: Int): String? {
        if (width <= 0 || height <= 0 || width * height > pixels.size || width > 2000 || height > 2000) return null
        return try {
            val src = PlanarYUVLuminanceSource(pixels, width, height, 0, 0, width, height, false)
            QRCodeReader().decode(BinaryBitmap(HybridBinarizer(src)), hints).text
        } catch (e: Exception) { null }
    }
}
