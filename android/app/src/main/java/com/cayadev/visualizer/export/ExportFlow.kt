/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.export

import android.content.ContentResolver
import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.util.Base64
import java.io.ByteArrayOutputStream
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import com.cayadev.visualizer.EngineHost
import com.cayadev.visualizer.media.MediaPick
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

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
        /* Sessiz çizelge işi (#1172, audioFrom "none"): şarkı yok, kopyalanacak dosya yok.
           Sayfa sessizliği kendisi üretir; videoya ses izi girmez. */
        if (args.optString("audioFrom") == "none" && args.optString("audioUri").isEmpty()) {
            cleanup()
            val j = JSONObject(args.toString()).put("audioName", "").put("songName", "")
            j.remove("audioUri")
            job = j
            EngineHost.loadPage(EXPORT_PAGE)
            return JSONObject().put("bytes", 0)
        }
        /* Çizelge sesi (#1172, audioFrom "timeline"): sayfa ses şeritlerini karıştırıp medya
           klasörüne yazdı (TimelineAudioFiles); o dosya videonun sesi, iş bitince silinir. */
        if (args.optString("audioFrom") == "timeline") {
            val mix = TimelineAudioFiles.mixFile(app, args.optString("audioFile"))
            cleanup()
            tempAudio = mix
            val title = args.optString("outputName").ifEmpty { "timeline" }
            val j = JSONObject(args.toString())
                .put("audioName", mix.name)
                .put("audioUrl", "/files/" + mix.name)
                .put("songName", title)
                .put("track", JSONObject().put("title", title).put("artist", "").put("album", "").put("artwork", "").put("duration", 0.0))
            j.remove("audioUri")
            j.remove("audioFile")
            job = j
            EngineHost.loadPage(EXPORT_PAGE)
            return JSONObject().put("bytes", mix.length())
        }
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
            .put("track", trackOf(app, uri, name))
        j.remove("audioUri")
        job = j
        EngineHost.loadPage(EXPORT_PAGE)
        return JSONObject().put("bytes", copy.length())
    }

    fun job(): JSONObject? = job

    /* Şarkının etiketleri (masaüstündeki src/shared/audio-tags.js): ad, sanatçı, albüm, süre ve
       kapak. Çalan Parça, söz ve logo katmanları videoda bunları çizer. Etiket yoksa dosya adı. */
    fun trackOf(context: Context, uri: Uri, fileName: String): JSONObject {
        val out = JSONObject().put("title", fileName.substringBeforeLast('.')).put("artist", "").put("album", "").put("artwork", "").put("duration", 0.0)
        val r = MediaMetadataRetriever()
        try {
            r.setDataSource(context.applicationContext, uri)
            r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE)?.takeIf { it.isNotBlank() }?.let { out.put("title", it) }
            val artist = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST)
                ?: r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST)
            out.put("artist", artist ?: "")
            out.put("album", r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM) ?: "")
            out.put("duration", (r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L) / 1000.0)
            r.embeddedPicture?.let { out.put("artwork", coverData(it)) }
        } catch (e: Exception) {
            Log.w(TAG, "şarkı etiketleri okunamadı", e)
        } finally {
            try { r.release() } catch (_: Exception) {}
        }
        return out
    }

    /** Kapak en çok 800 px JPEG (iş sayfaya tek iletiyle gider). */
    private fun coverData(bytes: ByteArray): String {
        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return ""
        val k = minOf(1f, 800f / maxOf(bmp.width, bmp.height))
        val small = if (k < 1f) Bitmap.createScaledBitmap(bmp, maxOf(1, (bmp.width * k).toInt()), maxOf(1, (bmp.height * k).toInt()), true) else bmp
        val out = ByteArrayOutputStream()
        small.compress(Bitmap.CompressFormat.JPEG, 90, out)
        return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

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
            publish(r, uri, src.name)
        } catch (e: Exception) {
            r.delete(uri, null, null)
            throw e
        }
        if (!src.delete()) Log.w(TAG, "ara dosya silinemedi")
        // Galerideki asıl ad ("ad (3).mp4" ya da saatli ad)
        val shown = r.query(uri, arrayOf(MediaStore.Video.Media.DISPLAY_NAME), null, null, null)
            ?.use { c -> if (c.moveToFirst()) c.getString(0) else null } ?: src.name
        return JSONObject().put("uri", uri.toString()).put("name", shown)
    }

    /* Bekleyen dosya yayımlanırken (IS_PENDING=0) MediaStore ona son adını verir. Aynı ad için
       en çok 32 numara dener ("ad (1)" … "ad (31)"), sonra reddeder: aynı şarkıyı 32 kez dışa
       aktaran kullanıcı "Kaydedilemedi" görüyordu (emülatörde ölçüldü, "Failed to build unique
       file"). O durumda ada tarih ve saat eklenir. */
    private fun publish(r: ContentResolver, uri: Uri, name: String) {
        try {
            r.update(uri, ContentValues().apply { put(MediaStore.Video.Media.IS_PENDING, 0) }, null, null)
        } catch (e: IllegalStateException) {
            Log.w(TAG, "galeride bu adla yer yok: $name")
            r.update(uri, ContentValues().apply {
                put(MediaStore.Video.Media.DISPLAY_NAME, stampedName(name))
                put(MediaStore.Video.Media.IS_PENDING, 0)
            }, null, null)
        }
    }

    private fun stampedName(name: String): String {
        val dot = name.lastIndexOf('.')
        val base = if (dot > 0) name.substring(0, dot) else name
        val ext = if (dot > 0) name.substring(dot) else ".mp4"
        return base + " " + SimpleDateFormat("yyyy-MM-dd HH-mm-ss", Locale.ROOT).format(Date()) + ext
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
