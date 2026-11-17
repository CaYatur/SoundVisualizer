/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.export

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import com.cayadev.visualizer.EngineHost
import com.cayadev.visualizer.media.MediaPick
import org.json.JSONObject
import java.io.File

/* DIŞA AKTARMA AKIŞI (docs/android/PLAN.md Faz 5, dışa aktarma ekranı).

   Telefonda tek motor (tek WebView) var; iki WebGL sayfasını aynı anda çalıştırmak orta
   sınıf bir telefonda ağır olur. Bu yüzden dışa aktarım AYNI WebView'de: sahne sayfası
   işi buraya bırakır, WebView dışa aktarım sayfasına (src/exporter, masaüstündekinin
   aynısı) geçer, iş bitince sahneye döner. Çizilen kareler bu arada ekranda görünür.

   - Şarkı belge seçiciden gelir (`content://`); kodlayıcı sesi uygulamanın medya
     klasöründen okuduğu için iş boyunca oraya kopyalanır, iş bitince silinir.
   - Sonuç galeriye (Movies/SoundVisualizer, MediaStore) kopyalanır; uygulamanın kendi
     klasöründeki ara dosya silinir. Paylaşım Android'in paylaşma ekranıyla. */
object ExportFlow {
    private const val TAG = "SVExportFlow"
    const val EXPORT_PAGE = "src/exporter/index.html"
    const val SCENE_PAGE = "src/visualizer/index.html"

    /** Bekleyen iş (dışa aktarım sayfası `exportJob` ile alır). */
    private var job: JSONObject? = null
    private var tempAudio: File? = null

    val active: Boolean get() = job != null

    /**
     * Sahne sayfasından iş: { cfg, width, height, fps, durationSec, audioUri, audioName, outputName }.
     * Şarkı medya klasörüne kopyalanır, WebView dışa aktarım sayfasına geçer.
     */
    fun open(context: Context, args: JSONObject): JSONObject {
        val app = context.applicationContext
        val uri = Uri.parse(args.optString("audioUri"))
        val name = MediaPick.displayName(app, uri).ifEmpty { "song.m4a" }
        val ext = name.substringAfterLast('.', "m4a").lowercase().take(5).filter { it.isLetterOrDigit() }.ifEmpty { "m4a" }
        val dir = ExportHub.mediaDir(app)
        val copy = File(dir, "export-audio-" + System.currentTimeMillis() + "." + ext)
        app.contentResolver.openInputStream(uri).use { input ->
            requireNotNull(input) { "şarkı açılamadı" }
            copy.outputStream().use { input.copyTo(it) }
        }
        cleanup()
        tempAudio = copy
        val j = JSONObject(args.toString())
            .put("audioName", copy.name)
            .put("audioUrl", "/files/" + copy.name)
            .put("songName", name)
        j.remove("audioUri")
        job = j
        EngineHost.loadPage(EXPORT_PAGE)
        return JSONObject().put("bytes", copy.length())
    }

    fun job(): JSONObject? = job

    /** Bitmiş dosyayı galeriye kopyalar; ara dosyayı siler. Döner: { uri, name }. */
    fun save(context: Context, path: String): JSONObject {
        val app = context.applicationContext
        val src = File(path).canonicalFile
        val allowed = (app.getExternalFilesDir(Environment.DIRECTORY_MOVIES) ?: app.filesDir).canonicalPath
        require(src.path.startsWith(allowed + File.separator)) { "klasör dışı yol" }
        val values = ContentValues().apply {
            put(MediaStore.Video.Media.DISPLAY_NAME, src.name)
            put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
            put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/SoundVisualizer")
            put(MediaStore.Video.Media.IS_PENDING, 1)
        }
        val r = app.contentResolver
        val uri = requireNotNull(r.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)) { "galeriye yazılamadı" }
        try {
            r.openOutputStream(uri).use { out -> src.inputStream().use { it.copyTo(requireNotNull(out)) } }
            r.update(uri, ContentValues().apply { put(MediaStore.Video.Media.IS_PENDING, 0) }, null, null)
        } catch (e: Exception) {
            r.delete(uri, null, null)
            throw e
        }
        if (!src.delete()) Log.w(TAG, "ara dosya silinemedi")
        return JSONObject().put("uri", uri.toString()).put("name", src.name)
    }

    fun shareIntent(uri: String): Intent =
        Intent.createChooser(
            Intent(Intent.ACTION_SEND).setType("video/mp4").putExtra(Intent.EXTRA_STREAM, Uri.parse(uri))
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
            null,
        )

    /** İş bitti ya da vazgeçildi: sahneye dönülür, kopyalanan şarkı silinir. */
    fun close() {
        job = null
        cleanup()
        EngineHost.loadPage(SCENE_PAGE)
    }

    private fun cleanup() {
        tempAudio?.let { if (it.exists() && !it.delete()) Log.w(TAG, "geçici şarkı silinemedi") }
        tempAudio = null
    }
}
