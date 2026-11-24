/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.link

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import org.json.JSONObject
import java.io.InputStream
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/* TELEFONDAN BİLGİSAYARA DOSYA (B6, docs/PHONE-LINK.md "Files"). Seçilen belge (video, logo, söz,
   MilkDrop preseti ya da dışa aktarılacak şarkı) parça parça gönderilir: file.begin → file.chunk
   (sırayla; bir parça onaylanınca sonraki) → file.end (SHA-256). Uygulamada çalışır: sayfa arka
   plandayken de sürer. İlerleme `linkUpload` olayıyla (en çok saniyede dört kez, durum değişince
   hemen). İptal edilen ya da kopan aktarımı bilgisayar kendisi siler. */
object LinkUpload {
    private val jobs = ConcurrentHashMap<String, Job>()
    private var seq = 0

    class Job(val key: String, val kind: String, val name: String, val size: Long, val input: InputStream) {
        var id = ""
        var chunk = 96 * 1024
        var sent = 0L
        @Volatile var cancel = false
        val sha: MessageDigest = MessageDigest.getInstance("SHA-256")
        var lastEmit = 0L
    }

    @Volatile var events: (String, Any?) -> Unit = { _, _ -> }

    fun sizeOf(ctx: Context, uri: Uri): Long = try {
        ctx.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else -1L
        } ?: -1L
    } catch (e: Exception) { -1L }

    /** Başlatır; anahtar döner. Hata ve ilerleme olayla gelir. */
    fun start(ctx: Context, uri: Uri, kind: String, name: String): String {
        val size = sizeOf(ctx, uri)
        val key = "up" + (++seq)
        if (size <= 0) { emit(key, kind, name, 0, 0, "error", "no-size"); return key }
        val input = try { ctx.contentResolver.openInputStream(uri) } catch (e: Exception) { null }
        if (input == null) { emit(key, kind, name, size, 0, "error", "read"); return key }
        val j = Job(key, kind, name, size, input)
        jobs[key] = j
        emit(j, "begin", null, true)
        PcLink.request("file.begin", JSONObject().put("kind", kind).put("name", name).put("size", size)) { r ->
            if (!r.optBoolean("ok")) { finish(j, "error", r.optString("error", "failed")); return@request }
            val res = r.optJSONObject("result") ?: JSONObject()
            j.id = res.optString("id")
            j.chunk = res.optInt("chunk", j.chunk).coerceIn(4096, 96 * 1024)
            next(j)
        }
        return key
    }

    fun cancel(key: String) {
        val j = jobs[key] ?: return
        j.cancel = true
    }

    private fun next(j: Job) {
        if (j.cancel) {
            if (j.id.isNotEmpty()) PcLink.request("file.cancel", JSONObject().put("id", j.id)) { }
            finish(j, "cancelled", null)
            return
        }
        if (j.sent >= j.size) {
            val hex = j.sha.digest().joinToString("") { "%02x".format(it) }
            PcLink.request("file.end", JSONObject().put("id", j.id).put("sha256", hex)) { r ->
                if (r.optBoolean("ok")) finish(j, "done", null, r.optJSONObject("result"))
                else finish(j, "error", r.optString("error", "failed"))
            }
            return
        }
        val buf = ByteArray(minOf(j.chunk.toLong(), j.size - j.sent).toInt())
        var n = 0
        try {
            while (n < buf.size) { val k = j.input.read(buf, n, buf.size - n); if (k < 0) break; n += k }
        } catch (e: Exception) { finish(j, "error", "read"); return }
        if (n <= 0) { finish(j, "error", "short-file"); return }
        val part = if (n == buf.size) buf else buf.copyOf(n)
        j.sha.update(part)
        sendChunk(j, j.sent, n, android.util.Base64.encodeToString(part, android.util.Base64.NO_WRAP), 0)
    }

    private fun sendChunk(j: Job, at: Long, n: Int, data: String, tries: Int) {
        PcLink.request("file.chunk", JSONObject().put("id", j.id).put("at", at).put("data", data)) { r ->
            if (!r.optBoolean("ok")) {
                // Hız sınırı (Canlı sekmesi de istek yolluyor): aynı parça biraz sonra, özet zaten güncel
                if (r.optString("error") == "rate" && tries < 20 && !j.cancel) {
                    Thread { Thread.sleep(250); sendChunk(j, at, n, data, tries + 1) }.start()
                    return@request
                }
                finish(j, "error", r.optString("error", "failed")); return@request
            }
            j.sent = at + n
            emit(j, "sending", null, false)
            next(j)
        }
    }

    private fun finish(j: Job, state: String, error: String?, result: JSONObject? = null) {
        jobs.remove(j.key)
        try { j.input.close() } catch (e: Exception) {}
        emit(j, state, error, true, result)
    }

    private fun emit(j: Job, state: String, error: String?, force: Boolean, result: JSONObject? = null) {
        val t = System.currentTimeMillis()
        if (!force && t - j.lastEmit < 250) return
        j.lastEmit = t
        emit(j.key, j.kind, j.name, j.size, j.sent, state, error, result)
    }

    private fun emit(key: String, kind: String, name: String, size: Long, sent: Long, state: String, error: String?, result: JSONObject? = null) {
        val o = JSONObject().put("key", key).put("kind", kind).put("name", name).put("size", size).put("sent", sent).put("state", state)
        if (error != null) o.put("error", error)
        if (result != null) o.put("result", result)
        events("linkUpload", o)
    }
}
