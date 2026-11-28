/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import com.cayadev.visualizer.web.ContentPathHandler
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

/* GALERİDEN SEÇİLEN DOSYA (Faz 4: video, görsel nesne ve logo katmanları).

   - Video kopyalanmaz: kalıcı okuma izniyle adresi tutulur, sayfa onu
     ContentPathHandler'dan akıtarak okur (telefonun yeri dar olabiliyor).
   - Görsel masaüstündeki gibi ayarın içine dataURL olarak girer (görsel nesneler ve
     logo böyle saklanıyor); uzun kenarı en çok [MAX_SIDE] piksele küçültülür ki ayar
     dosyası şişmesin. Saydamlığı olan görsel PNG, olmayan JPEG kalır.
   - GIF yeniden kodlanmaz: kodlanınca yalnız ilk karesi kalıyordu, logo hareket etmiyordu. */
object MediaPick {
    const val MAX_SIDE = 1024
    const val MAX_GIF_BYTES = 12 * 1024 * 1024

    fun displayName(context: Context, uri: Uri): String {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) return c.getString(0) ?: ""
        }
        return uri.lastPathSegment ?: ""
    }

    fun video(context: Context, uri: Uri): JSONObject =
        JSONObject().put("url", ContentPathHandler.urlOf(uri)).put("uri", uri.toString()).put("name", displayName(context, uri))
            .put("mime", context.contentResolver.getType(uri) ?: "")

    private fun gif(context: Context, uri: Uri): JSONObject? {
        val r = context.contentResolver
        if (!(r.getType(uri) ?: "").equals("image/gif", true) && !displayName(context, uri).endsWith(".gif", true)) return null
        val bytes = r.openInputStream(uri)?.use { it.readBytes() } ?: return null
        if (bytes.size > MAX_GIF_BYTES) return null
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
        return JSONObject().put("dataUrl", "data:image/gif;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP))
            .put("uri", uri.toString()).put("name", displayName(context, uri)).put("width", o.outWidth).put("height", o.outHeight)
    }

    fun image(context: Context, uri: Uri, maxSide: Int = MAX_SIDE): JSONObject {
        gif(context, uri)?.let { return it }
        val src = ImageDecoder.createSource(context.contentResolver, uri)
        val bmp = ImageDecoder.decodeBitmap(src) { d, info, _ ->
            val (w, h) = scaledSize(info.size.width, info.size.height, maxSide)
            if (w != info.size.width) d.setTargetSize(w, h)
            // Yazılım bitmap'i: sıkıştırma için okunabilir olmalı
            d.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
        val alpha = bmp.hasAlpha()
        val out = ByteArrayOutputStream()
        bmp.compress(if (alpha) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG, 88, out)
        val mime = if (alpha) "image/png" else "image/jpeg"
        val url = "data:$mime;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        return JSONObject().put("dataUrl", url).put("uri", uri.toString()).put("name", displayName(context, uri))
            .put("width", bmp.width).put("height", bmp.height)
    }

    /** Uzun kenarı [maxSide]'a indirilmiş boyut; küçükse olduğu gibi. */
    fun scaledSize(w: Int, h: Int, maxSide: Int = MAX_SIDE): Pair<Int, Int> {
        val k = maxSide.toFloat() / max(w, h)
        return if (k < 1f) Pair(max(1, (w * k).roundToInt()), max(1, (h * k).roundToInt())) else Pair(w, h)
    }
}
