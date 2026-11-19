/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.web

import android.content.Context
import android.content.res.AssetFileDescriptor
import android.util.Log
import android.webkit.MimeTypeMap
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import com.cayadev.visualizer.export.ExportHub
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FilterInputStream
import java.io.InputStream

/* VİDEO DOSYALARINDA KONUMLU OKUMA (HTTP Range).

   WebViewAssetLoader dosyayı baştan sona tek akış olarak veriyor: oynatıcıya göre dosya
   sarılamaz (video.seekable boş). Tamponuna sığan kısa video yine dönüyordu, büyük video
   döngünün sonunda başa dönemeyip son karede kalıyordu (ölçüldü: 108 MB, 30 sn). Burada
   medya dosyası 206 yanıtıyla verilir.

   AKIŞ DOSYANIN BAŞINDAN VERİLİR: WebView Range başlığını kendisi de uyguluyor (akışı
   istenen konuma atlatıp o kadar okuyor). Akış konuma önceden sarılınca iki kez atlanıyor
   ve oynatıcı PIPELINE_ERROR_READ veriyordu (ölçüldü). */
object MediaRange {
    private const val TAG = "SV-range"
    private val MEDIA_EXT = setOf("mp4", "m4v", "webm", "mkv", "mov", "3gp", "avi", "ts", "mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac")

    /** Bayt aralığı (iki uç dahil). */
    data class Span(val start: Long, val end: Long) {
        val length: Long get() = end - start + 1
    }

    /** Dosyanın dışında kalan aralık (416). */
    val UNSATISFIABLE = Span(-1, -1)

    /**
     * Range başlığını çözer. null: başlık yok ya da desteklenmiyor, dosyanın tamamı verilir
     * (birden çok aralık istemek buna girer).
     */
    fun parse(header: String?, size: Long): Span? {
        val m = Regex("""^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$""", RegexOption.IGNORE_CASE).find(header ?: return null) ?: return null
        val (a, b) = m.destructured
        if (a.isEmpty() && b.isEmpty()) return null
        val first = a.toLongOrNull()
        val last = b.toLongOrNull()
        if ((a.isNotEmpty() && first == null) || (b.isNotEmpty() && last == null)) return null
        if (size <= 0) return UNSATISFIABLE
        if (first == null) {
            // Sondan n bayt
            val n = last ?: return null
            if (n <= 0) return UNSATISFIABLE
            return Span(maxOf(0, size - n), size - 1)
        }
        if (first >= size) return UNSATISFIABLE
        if (last != null && last < first) return null
        return Span(first, minOf(last ?: (size - 1), size - 1))
    }

    /** Uygulamanın medya klasörü ve seçilen içerik; başka her istek null (eski yol). */
    fun serve(context: Context, request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        if (url.host != WebShell.HOST || request.method != "GET") return null
        val path = url.path ?: return null
        val range = request.requestHeaders.entries.firstOrNull { it.key.equals("Range", true) }?.value
        return try {
            when {
                path.startsWith("/files/") -> file(context, path.removePrefix("/files/"), range)
                path.startsWith(ContentPathHandler.PREFIX) -> content(context, path.removePrefix(ContentPathHandler.PREFIX), range)
                else -> null
            }
        } catch (e: Exception) {
            // Sağlayıcı konumlu okumayı desteklemiyorsa eski akış yoluna düşülür
            Log.w(TAG, "konumlu okuma yapılamadı: ${e.message}")
            null
        }
    }

    private fun file(context: Context, rel: String, range: String?): WebResourceResponse? {
        val ext = rel.substringAfterLast('.', "").lowercase()
        if (ext !in MEDIA_EXT) return null
        val dir = ExportHub.mediaDir(context).canonicalFile
        val f = File(dir, rel).canonicalFile
        if (!f.path.startsWith(dir.path + File.separator) || !f.isFile) return null
        val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
        return respond(mime, f.length(), range) { Seekable(FileInputStream(f), 0, f.length()) }
    }

    private fun content(context: Context, code: String, range: String?): WebResourceResponse? {
        val uri = ContentPathHandler.decode(code) ?: return null
        if (!ContentPathHandler.granted(context, uri)) return null
        val r = context.contentResolver
        val size = r.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: return null
        if (size == AssetFileDescriptor.UNKNOWN_LENGTH || size <= 0) return null
        val mime = r.getType(uri) ?: "application/octet-stream"
        return respond(mime, size, range) {
            val afd = r.openAssetFileDescriptor(uri, "r") ?: throw IllegalStateException("içerik açılamadı")
            Seekable(afd.createInputStream(), afd.startOffset, size)
        }
    }

    private fun respond(mime: String, size: Long, range: String?, open: () -> InputStream): WebResourceResponse {
        val head = mutableMapOf("Accept-Ranges" to "bytes", "Cache-Control" to "no-store")
        val span = parse(range, size)
        if (span == UNSATISFIABLE) {
            head["Content-Range"] = "bytes */$size"
            return WebResourceResponse(mime, null, 416, "Range Not Satisfiable", head, ByteArrayInputStream(ByteArray(0)))
        }
        if (span == null) {
            head["Content-Length"] = size.toString()
            return WebResourceResponse(mime, null, 200, "OK", head, open())
        }
        head["Content-Length"] = span.length.toString()
        head["Content-Range"] = "bytes ${span.start}-${span.end}/$size"
        return WebResourceResponse(mime, null, 206, "Partial Content", head, open())
    }

    /** Atlaması dosyayı okumadan yapılan akış: büyük videoda sarma anında biter. */
    private class Seekable(private val source: FileInputStream, private val base: Long, private val size: Long) : InputStream() {
        private var pos = 0L

        init {
            source.channel.position(base)
        }

        override fun read(): Int {
            if (pos >= size) return -1
            val v = source.read()
            if (v >= 0) pos++
            return v
        }

        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (pos >= size) return -1
            val n = source.read(b, off, minOf(len.toLong(), size - pos).toInt())
            if (n > 0) pos += n
            return n
        }

        override fun skip(n: Long): Long {
            val step = n.coerceIn(0, size - pos)
            pos += step
            source.channel.position(base + pos)
            return step
        }

        override fun available(): Int = minOf(size - pos, Int.MAX_VALUE.toLong()).toInt()

        override fun close() = source.close()
    }
}
