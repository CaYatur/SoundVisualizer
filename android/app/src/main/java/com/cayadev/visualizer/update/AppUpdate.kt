/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.update

import android.content.Context
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

/* YENİ SÜRÜM UYARISI (docs/android/PLAN.md K13): "yeni sürüm var" ve sürüm sayfası.
   Uygulama kendini KURMAZ (Play kuralı); kullanıcı sürüm sayfasından indirir.

   - Tek istek, sabit adres: GitHub'ın sürüm listesi. Android sürümleri `android-v1.2.3`
     etiketiyle ve hiçbir zaman "Latest" işaretlenmeden yayımlanıyor (PLAN 2.6), bu yüzden
     `releases/latest` değil liste okunur ve etikete göre süzülür. Taslak ve ön sürüm sayılmaz.
   - Kişisel bilgi gitmez: genel istemci adı, çerez ya da kimlik yok.
   - Kip: 'notify' (varsayılan, günde en çok bir kez kendiliğinden) ya da 'off' (hiç ağa
     çıkmaz; elle "Şimdi denetle" yine çalışır).
   - Sayfa adres VERMEZ: açılan sayfa son denetimin döndürdüğü github.com adresi. */
object AppUpdate {
    const val REPO = "CaYatur/SoundVisualizer"
    const val API = "https://api.github.com/repos/$REPO/releases?per_page=40"
    const val RELEASES_PAGE = "https://github.com/$REPO/releases"
    private const val PAGE_PREFIX = "https://github.com/$REPO/"
    private const val MAX_BYTES = 4 * 1024 * 1024
    private const val TIMEOUT_MS = 15000
    const val AUTO_EVERY_MS = 24L * 3600 * 1000
    // Denetim olmadıysa (ağ yok, sınır) kendiliğinden yeniden deneme bundan önce yapılmaz
    const val RETRY_AFTER_MS = 6L * 3600 * 1000
    // Elle denetimde art arda basmayı GitHub'ın saatlik sınırına harcamamak için
    const val MANUAL_MIN_MS = 20L * 1000
    private val TAG = Regex("^android-v(\\d+)\\.(\\d+)\\.(\\d+)$")
    private val CORE = Regex("^v?(\\d+)\\.(\\d+)\\.(\\d+)")

    /** "1.2.3", "1.2.3-dev", "v1.2.3" → [1,2,3]; tanınmazsa null. Ek (-dev) karşılaştırmaya girmez. */
    fun parse(v: String?): IntArray? {
        val m = CORE.find((v ?: "").trim()) ?: return null
        return try { IntArray(3) { m.groupValues[it + 1].toInt() } } catch (_: NumberFormatException) { null }
    }

    fun compare(a: IntArray, b: IntArray): Int {
        for (i in 0 until 3) if (a[i] != b[i]) return a[i].compareTo(b[i])
        return 0
    }

    private fun safeUrl(u: String?): String = (u ?: "").takeIf { it.startsWith(PAGE_PREFIX) && it.length <= 300 && !it.contains(Regex("\\s")) } ?: RELEASES_PAGE

    /* Sürüm notu düz metin olarak gösterilir: Markdown işaretleri sadeleştirilir, uzunsa kesilir. */
    fun plainNotes(md: String?): String {
        var s = (md ?: "").replace("\r\n", "\n")
        s = s.replace(Regex("<!--[\\s\\S]*?-->"), "")
        s = s.replace(Regex("(?m)^#{1,6}\\s*"), "")
        s = s.replace(Regex("\\*\\*([^*]+)\\*\\*"), "$1")
        s = s.replace(Regex("`([^`]+)`"), "$1")
        s = s.replace(Regex("!?\\[([^\\]]*)\\]\\([^)]*\\)"), "$1")
        s = s.replace(Regex("(?m)^[ \\t]*[-*][ \\t]+"), "• ")
        s = s.replace(Regex("\n{3,}"), "\n\n").trim()
        return if (s.length > 1500) s.take(1500).trimEnd() + "…" else s
    }

    /* Sürüm listesinden (GitHub JSON dizisi) durum. current: uygulamanın sürümü (BuildConfig).
       status: 'available' | 'latest' | 'none' (yayımlanmış Android sürümü yok) | 'error'. */
    fun evaluate(body: String, current: String, skip: String?): JSONObject {
        val out = JSONObject().put("current", current)
        val cur = parse(current) ?: return out.put("status", "error").put("error", "bad-version")
        val arr = try { JSONTokener(body).nextValue() as? JSONArray } catch (_: Exception) { null }
            ?: return out.put("status", "error").put("error", "bad-response")
        var best: JSONObject? = null
        var bestV: IntArray? = null
        for (i in 0 until arr.length()) {
            val r = arr.optJSONObject(i) ?: continue
            if (r.optBoolean("draft") || r.optBoolean("prerelease")) continue
            val m = TAG.matchEntire(r.optString("tag_name")) ?: continue
            val v = m.groupValues.drop(1).map { it.toIntOrNull() ?: -1 }.toIntArray()
            if (v.any { it < 0 }) continue
            if (bestV == null || compare(v, bestV) > 0) { best = r; bestV = v }
        }
        if (best == null || bestV == null) return out.put("status", "none")
        val latest = bestV.joinToString(".")
        val newer = compare(bestV, cur) > 0
        out.put("status", if (newer) "available" else "latest").put("latest", latest)
            .put("name", best.optString("name").take(120))
            .put("publishedAt", best.optString("published_at").take(40))
            .put("url", safeUrl(best.optString("html_url")))
        if (newer) {
            out.put("notes", plainNotes(best.optString("body")))
            out.put("skipped", skip != null && skip == latest)
            // APK dosyası var mı (sürüm sayfasında indirilecek olan); yalnız bilgi
            val assets = best.optJSONArray("assets") ?: JSONArray()
            for (k in 0 until assets.length()) {
                val a = assets.optJSONObject(k) ?: continue
                if (a.optString("name").endsWith(".apk", ignoreCase = true)) { out.put("apkBytes", a.optLong("size")); break }
            }
        }
        return out
    }

    /** HTTP yanıt kodu → hata adı (sayfa kendi diliyle anlatır). */
    fun httpError(code: Int): String = when (code) {
        403, 429 -> "rate"
        404 -> "not-found"
        in 500..599 -> "server"
        else -> "http-$code"
    }

    class HttpResult(val code: Int, val body: String?)

    fun httpGet(url: String): HttpResult {
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = TIMEOUT_MS
            c.readTimeout = TIMEOUT_MS
            c.instanceFollowRedirects = true
            c.useCaches = false
            c.setRequestProperty("Accept", "application/vnd.github+json")
            c.setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
            // Genel istemci adı: kullanıcıya ait bilgi gönderilmez
            c.setRequestProperty("User-Agent", "SoundVisualizer-Android")
            val code = c.responseCode
            if (code !in 200..299) return HttpResult(code, null)
            if (c.contentLengthLong > MAX_BYTES) return HttpResult(-2, null)
            val bytes = c.inputStream.use { s ->
                val out = java.io.ByteArrayOutputStream()
                val buf = ByteArray(16 * 1024)
                while (true) {
                    val n = s.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    if (out.size() > MAX_BYTES) return HttpResult(-2, null)
                }
                out.toByteArray()
            }
            return HttpResult(code, String(bytes, Charsets.UTF_8))
        } finally {
            c.disconnect()
        }
    }

    /** Ağ isteği + değerlendirme; hata atmaz. get sınamalarda değiştirilir. */
    fun check(current: String, skip: String?, get: (String) -> HttpResult = ::httpGet): JSONObject {
        val r = try { get(API) } catch (e: Exception) {
            val off = e is java.net.UnknownHostException || e is java.net.ConnectException || e is java.net.NoRouteToHostException
            return JSONObject().put("current", current).put("status", "error").put("error", if (off) "offline" else if (e is java.net.SocketTimeoutException) "timeout" else "network")
        }
        if (r.code == -2) return JSONObject().put("current", current).put("status", "error").put("error", "too-large")
        if (r.body == null) return JSONObject().put("current", current).put("status", "error").put("error", httpError(r.code))
        return evaluate(r.body, current, skip)
    }

    /* ---- Kalıcı durum ve tek seferde bir denetim ---- */
    private const val PREFS = "app-update"
    private val lock = Any()
    @Volatile private var running = false
    /* Yalnız geliştirme sürümünde (AppRequests debugUpdateFeed): ağ yerine bu yanıt; sınama
       betiği "yeni sürüm var" akışını gerçek bir Android sürümü olmadan dener. */
    @Volatile var debugResponse: HttpResult? = null
    @Volatile var debugGets = 0

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun mode(ctx: Context): String = if (prefs(ctx).getString("mode", "notify") == "off") "off" else "notify"

    fun setMode(ctx: Context, m: String) { prefs(ctx).edit().putString("mode", if (m == "off") "off" else "notify").apply() }

    /** Son bilinen durum (ağa çıkmaz) + kip, son denetim zamanı, sürüyor mu. */
    fun state(ctx: Context, current: String): JSONObject {
        val p = prefs(ctx)
        val last = p.getString("last", null)?.let { try { JSONObject(it) } catch (_: Exception) { null } }
        val o = last ?: JSONObject().put("status", "idle")
        // Uygulama güncellendiyse eski "yeni sürüm var" kalmasın: sürüm bugünküyle yeniden kıyaslanır
        o.put("current", current)
        val lv = parse(o.optString("latest"))
        val cv = parse(current)
        if (lv != null && cv != null && (o.optString("status") == "available" || o.optString("status") == "latest")) {
            o.put("status", if (compare(lv, cv) > 0) "available" else "latest")
        }
        if (o.optString("status") == "available") o.put("skipped", p.getString("skip", null) == o.optString("latest"))
        else o.remove("skipped")
        return o.put("mode", mode(ctx)).put("checkedAt", p.getLong("checkedAt", 0L)).put("checking", running)
    }

    /** Kendiliğinden denetim zamanı geldi mi (kip açık, son başarılı denetimden 24 sa, hatadan 6 sa). */
    fun due(ctx: Context, now: Long = System.currentTimeMillis()): Boolean {
        if (mode(ctx) == "off") return false
        val p = prefs(ctx)
        val okAt = p.getLong("checkedAt", 0L)
        val triedAt = p.getLong("triedAt", 0L)
        return now - okAt >= AUTO_EVERY_MS && now - triedAt >= RETRY_AFTER_MS
    }

    /* Denetim ayrı iş parçacığında; bittiğinde done(durum). Biri sürerken gelen istek
       aynı denetimin sonucunu beklemez, o anki durumu alır (checking: true). */
    fun run(ctx: Context, current: String, manual: Boolean, done: (JSONObject) -> Unit) {
        val app = ctx.applicationContext
        synchronized(lock) {
            val now = System.currentTimeMillis()
            if (running) { done(state(app, current)); return }
            if (!manual && !due(app, now)) { done(state(app, current)); return }
            if (manual && now - prefs(app).getLong("triedAt", 0L) < MANUAL_MIN_MS) { done(state(app, current)); return }
            running = true
            prefs(app).edit().putLong("triedAt", now).apply()
        }
        Thread {
            val fake = debugResponse
            val res = try {
                if (fake != null) check(current, prefs(app).getString("skip", null)) { debugGets++; fake } else check(current, prefs(app).getString("skip", null))
            } catch (e: Exception) {
                JSONObject().put("current", current).put("status", "error").put("error", "network")
            }
            val p = prefs(app)
            val e = p.edit()
            if (res.optString("status") == "error") {
                // Önceki başarılı sonucu silme: "yeni sürüm var" haberi ağ gidince kaybolmasın
                val prev = p.getString("last", null)?.let { try { JSONObject(it) } catch (_: Exception) { null } }
                val keep = prev?.takeIf { it.optString("status") in setOf("available", "latest", "none") }
                e.putString("last", (keep ?: res).put("error", res.optString("error")).toString())
            } else {
                res.remove("skipped")
                e.putString("last", res.toString()).putLong("checkedAt", System.currentTimeMillis())
            }
            e.apply()
            synchronized(lock) { running = false }
            done(state(app, current))
        }.apply { name = "app-update"; isDaemon = true }.start()
    }

    /** Sınama: kalıcı durumu sil (kip, atlama, son denetim). */
    fun reset(ctx: Context) { prefs(ctx).edit().clear().apply(); debugGets = 0 }

    fun skip(ctx: Context, current: String): JSONObject {
        val s = state(ctx, current)
        if (s.optString("status") == "available") prefs(ctx).edit().putString("skip", s.optString("latest")).apply()
        return state(ctx, current)
    }

    /** Açılacak sayfa: son denetimin github.com adresi, yoksa sürümler sayfası. */
    fun pageUrl(ctx: Context, current: String): String = safeUrl(state(ctx, current).optString("url"))
}
