/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.export

import android.content.Context
import android.net.Uri
import android.util.Base64
import com.cayadev.visualizer.media.MediaPick
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/* ÇİZELGE SES DOSYALARI (#1172, src/mobile/shell-timeline-audio.js).

   - İçe aktarma: belge seçiciden gelen ses uygulamanın medya klasörüne kopyalanır; sayfa onu
     `/files/<ad>` adresinden okur (çözme, dalga biçimi, çalma) ve klibin kaynağı bu adres olur.
     Kopya kalıcı: proje kaydedilip yeniden açılınca da çalar.
   - Karışım: sayfanın çizdiği WAV aynı klasöre base64 parçalarla yazılır (köprü iletisi sınırlı).
     Ad sabit kalıpta (`tla-mix-….wav`); klasör dışına yol verilemez. Dışa aktarma bitince
     ExportFlow geçici dosya olarak siler. */
object TimelineAudioFiles {
    private val UNSAFE = Regex("[^A-Za-z0-9._-]")
    private val MIX = Regex("tla-mix-[A-Za-z0-9_-]{1,40}\\.wav")

    fun isMixName(name: String): Boolean = MIX.matches(name)

    fun copyIn(context: Context, uri: Uri): JSONObject {
        val app = context.applicationContext
        val name = MediaPick.displayName(app, uri).ifEmpty { "audio" }
        val safe = name.replace(UNSAFE, "_").takeLast(80)
        val f = File(ExportHub.mediaDir(app), "tla-" + System.currentTimeMillis() + "-" + safe)
        app.contentResolver.openInputStream(uri).use { input ->
            requireNotNull(input) { "ses açılamadı" }
            f.outputStream().use { input.copyTo(it) }
        }
        return JSONObject().put("url", "/files/" + f.name).put("name", name).put("bytes", f.length())
    }

    fun append(context: Context, name: String, data: String, first: Boolean): JSONObject {
        require(isMixName(name)) { "geçersiz ad" }
        val f = File(ExportHub.mediaDir(context.applicationContext), name)
        val bytes = Base64.decode(data, Base64.DEFAULT)
        FileOutputStream(f, !first).use { it.write(bytes) }
        return JSONObject().put("bytes", f.length())
    }

    fun mixFile(context: Context, name: String): File {
        require(isMixName(name)) { "geçersiz ad" }
        val f = File(ExportHub.mediaDir(context.applicationContext), name)
        require(f.isFile && f.length() > 44) { "karışım yok" }
        return f
    }
}
