/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.web

import android.content.Context
import android.net.Uri
import android.util.Base64
import android.util.Log
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader

/* KULLANICININ SEÇTİĞİ MEDYA DOSYALARI (Faz 4, video katmanı).

   Belge seçiciden gelen `content://` adresi KOPYALANMADAN sayfaya akıtılır (telefonun
   yeri dar olabiliyor): sayfa `https://appassets.androidplatform.net/content/<kod>`
   ister, `<kod>` adresin base64url hâli. Yalnız kullanıcının seçtiği ve uygulamanın
   kalıcı okuma izni aldığı adresler açılır; başka bir `content://` adresi (başka bir
   uygulamanın sağlayıcısı) bu yoldan okunamaz. */
class ContentPathHandler(private val context: Context) : WebViewAssetLoader.PathHandler {
    override fun handle(path: String): WebResourceResponse? {
        val uri = decode(path) ?: return null
        if (!granted(uri)) {
            Log.w(TAG, "izinsiz içerik istendi")
            return null
        }
        return try {
            val r = context.contentResolver
            val mime = r.getType(uri) ?: "application/octet-stream"
            val stream = r.openInputStream(uri) ?: return null
            WebResourceResponse(mime, null, stream)
        } catch (e: Exception) {
            Log.w(TAG, "içerik açılamadı: ${e.message}")
            null
        }
    }

    private fun granted(uri: Uri): Boolean =
        context.contentResolver.persistedUriPermissions.any { it.isReadPermission && it.uri == uri }

    companion object {
        private const val TAG = "SV-content"
        const val PREFIX = "/content/"

        /** Sayfanın isteyeceği adres. */
        fun urlOf(uri: Uri): String =
            "https://${WebShell.HOST}$PREFIX" + Base64.encodeToString(uri.toString().toByteArray(), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

        fun decode(path: String): Uri? = try {
            val code = path.substringBefore('?').substringBefore('/')
            Uri.parse(String(Base64.decode(code, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)))
        } catch (e: IllegalArgumentException) {
            null
        }
    }
}
