/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.link

import android.content.Context
import com.cayadev.visualizer.store.LibraryRestore
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.URLEncoder
import java.security.MessageDigest

/* BİLGİSAYARDAN TELEFONA VİDEO (docs/PHONE-LINK.md "Videos"). Hedef PC'yken PC'nin ayarındaki
   video telefonda açılmaz (adres PC'nin diski). Sayfa eksik videoyu ister; dosya `media.fetch`
   ile parça parça (sırayla, parça onaylanınca sonraki) indirilir:
     - PC kitaplık kimliğiyle gelen → `media/lib-media/` ve kitaplık listesi (manifest.json);
       aynı kimlik telefonun kitaplığında da görünür.
     - Kimliksiz başvuru → `media/link-cache/` (adın özetiyle).
   İkisi de sayfaya `/files/` adresinden açık. Dosya adı PC'den alınmaz: kimlik ya da özet ve
   bilinen video uzantısı. Aynı boyutta dosya zaten varsa yeniden indirilmez. */
object LinkDownload {
    private val SAFE_ID = Regex("^[A-Za-z0-9_-]{1,80}$")
    private const val ORIGIN = "https://appassets.androidplatform.net/files/"
    private val running = HashSet<String>()

    private fun enc(s: String): String = URLEncoder.encode(s, "UTF-8").replace("+", "%20")
    private fun ext(name: String): String {
        val e = "." + name.substringAfterLast('.', "").lowercase()
        return if (LibraryRestore.isFile("media", "x$e")) e else ".mp4"
    }
    private fun hash(s: String): String =
        MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }.take(20)

    /** [id]: PC kitaplık kimliği (boş olabilir), [file]: PC'nin ayarındaki adres. Bitince { id, url }. */
    fun start(ctx: Context, id: String, file: String, done: (JSONObject?, String?) -> Unit) {
        if (id.isNotEmpty() && !SAFE_ID.matches(id)) { done(null, "bad-id"); return }
        if (id.isEmpty() && (file.isEmpty() || file.length > 4096)) { done(null, "bad-args"); return }
        val key = if (id.isNotEmpty()) "id:$id" else "ref:$file"
        synchronized(running) { if (!running.add(key)) { done(null, "busy"); return } }
        val base = File(ctx.filesDir, "media")
        val args = JSONObject().put("at", 0)
        if (id.isNotEmpty()) args.put("id", id) else args.put("file", file)
        val finish: (JSONObject?, String?) -> Unit = { r, e -> synchronized(running) { running.remove(key) }; done(r, e) }
        PcLink.request("media.fetch", args) { r ->
            if (!r.optBoolean("ok")) { finish(null, r.optString("error", "failed")); return@request }
            val res = r.optJSONObject("result") ?: JSONObject()
            val name = res.optString("name").take(120)
            val size = res.optLong("size")
            val dir = File(base, if (id.isNotEmpty()) "lib-media" else "link-cache")
            val fname = (if (id.isNotEmpty()) "pc-$id" else "pc-" + hash(file)) + ext(name)
            val dst = File(dir, fname)
            val url = ORIGIN + dir.name + "/" + enc(fname)
            val ok = {
                if (id.isNotEmpty()) {
                    try {
                        LibraryRestore.upsertManifest(dir, listOf(JSONObject().put("id", id).put("name", name.ifEmpty { fname }).put("file", fname).put("size", size)))
                    } catch (_: Exception) {}
                }
                finish(JSONObject().put("id", id).put("url", url), null)
            }
            if (dst.isFile && dst.length() == size) { ok(); return@request }
            dir.mkdirs()
            val part = File(dir, "$fname.part")
            val out = try { FileOutputStream(part) } catch (e: Exception) { finish(null, "write"); return@request }
            val fail = { e: String -> try { out.close() } catch (_: Exception) {}; part.delete(); finish(null, e) }
            fun take(res: JSONObject): Boolean {
                val bytes = try { android.util.Base64.decode(res.optString("data"), android.util.Base64.DEFAULT) } catch (_: Exception) { return false }
                return try { out.write(bytes); true } catch (_: Exception) { false }
            }
            fun step(at: Long, tries: Int) {
                PcLink.request("media.fetch", JSONObject(args.toString()).put("at", at)) { rr ->
                    if (!rr.optBoolean("ok")) {
                        // Hız sınırı: aynı parça biraz sonra
                        if (rr.optString("error") == "rate" && tries < 20) { Thread { Thread.sleep(250); step(at, tries + 1) }.start(); return@request }
                        fail(rr.optString("error", "failed")); return@request
                    }
                    val x = rr.optJSONObject("result") ?: JSONObject()
                    if (x.optLong("size") != size || x.optLong("at") != at || !take(x)) { fail("changed"); return@request }
                    if (x.optBoolean("done")) {
                        try { out.close() } catch (_: Exception) {}
                        if (part.length() != size) { part.delete(); finish(null, "short-file"); return@request }
                        if (dst.exists()) dst.delete()
                        if (!part.renameTo(dst)) { part.delete(); finish(null, "write"); return@request }
                        ok()
                    } else step(part.length(), 0)
                }
            }
            if (!take(res)) { fail("changed"); return@request }
            if (res.optBoolean("done")) {
                try { out.close() } catch (_: Exception) {}
                if (dst.exists()) dst.delete()
                if (part.length() != size || !part.renameTo(dst)) { part.delete(); finish(null, "write"); return@request }
                ok()
            } else step(part.length(), 0)
        }
    }
}
