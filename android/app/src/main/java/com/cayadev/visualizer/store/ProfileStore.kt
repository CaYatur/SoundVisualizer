/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.store

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.AtomicFile
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileNotFoundException
import java.io.InputStream

/* AYAR DOSYALARI VE PRESETLER (docs/android/PLAN.md 2.2, §3 "Kayıt düzeni").

   Uygulama yalnız DEPO: hangi dosyaya ne yazılacağına sayfa karar verir
   (src/mobile/profile-store.js). Biçim masaüstünün aynısı, böylece bir
   bilgisayardan alınan dosyalar olduğu gibi açılır.

   Yazım atomik (AtomicFile): önce yeni dosya yazılıp diske zorlanıyor, sonra
   adı değiştiriliyor. Yazım sırasında uygulama ölürse eski dosya yerinde
   kalır, yarım dosya okunmaz. Disk işi ayrı bir iş parçacığında; yanıt ana
   iş parçacığına döner (yanıt vekili yalnız oradan çağrılır). İşler sırayla
   yürür: içe aktarma bitmeden bir okuma araya girmez. */
class ProfileStore(context: Context) {
    private val tag = "SVStore"
    private val app = context.applicationContext
    val dir: File = File(app.filesDir, "profile")

    /* Kullanıcı presetleri masaüstündeki gibi tek tek dosyada (presets/<kimlik>.json). */
    private val presetsDir = File(dir, "presets")
    private val staging = File(app.cacheDir, "import-presets")
    private val thread = HandlerThread("sv-store").also { it.start() }
    private val worker = Handler(thread.looper)
    private val main = Handler(Looper.getMainLooper())

    /** Preset listesinin kuşağı: her değişimde artar (presetsHead/presetsSince). */
    @Volatile
    var presetGen = 1L
        private set
    private var presetCache: JSONArray? = null

    private fun file(name: String): AtomicFile {
        require(ProfileNames.allowed(name)) { "bad-name" }
        return AtomicFile(File(dir, name))
    }

    private fun writeAtomic(f: AtomicFile, data: ByteArray) {
        val out = f.startWrite()
        try {
            out.write(data)
            f.finishWrite(out)
        } catch (e: Exception) {
            f.failWrite(out)
            throw e
        }
    }

    /** Adlar → metin (dosya yoksa null). Bilinmeyen ad hata. */
    fun read(names: List<String>, done: (JSONObject?, String?) -> Unit) = run(done) {
        val out = JSONObject()
        for (n in names) {
            val text = try {
                String(file(n).readFully(), Charsets.UTF_8)
            } catch (e: FileNotFoundException) {
                null
            }
            out.put(n, text ?: JSONObject.NULL)
        }
        out
    }

    /**
     * Dosyaları yazar; settings.json EN SONA kalır (masaüstüyle aynı sıra:
     * arada kapanırsa ayarlar eski parçaları göstermeye devam eder).
     */
    fun write(files: JSONObject, done: (JSONObject?, String?) -> Unit) = run(done) {
        val names = files.keys().asSequence().toList()
        names.forEach { require(ProfileNames.allowed(it)) { "bad-name" } }
        dir.mkdirs()
        var bytes = 0L
        for (n in names.sortedBy { if (it == "settings.json") 1 else 0 }) {
            val data = files.getString(n).toByteArray(Charsets.UTF_8)
            writeAtomic(file(n), data)
            bytes += data.size
        }
        JSONObject().put("written", names.size).put("bytes", bytes)
    }

    /**
     * [from]'u [to]'ya kopyalar. [overwrite] false ise [to] varken dokunmaz:
     * v4 göçü yedeği bir kez alınır (masaüstündeki gibi), sonraki göçler ilk
     * yedeği ezmez. [overwrite] true iken kaynak yoksa eski kopya silinir: bir
     * önceki içe aktarmanın kopyası şimdikinin sanılmasın.
     */
    fun copy(from: String, to: String, overwrite: Boolean, done: (JSONObject?, String?) -> Unit) = run(done) {
        val src = file(from)
        val dst = file(to)
        val copied = if ((overwrite || !dst.baseFile.exists()) && src.baseFile.exists()) {
            dir.mkdirs()
            writeAtomic(dst, src.readFully())
            true
        } else {
            if (overwrite && !src.baseFile.exists()) dst.delete()
            false
        }
        JSONObject().put("copied", copied)
    }

    // ---- Presetler (HOST.md getPresets, milkdropPresetSource, presetsHead/Since) ----

    /* Sayfaya giden liste MilkDrop kaynağını taşımaz (masaüstündeki preset-lean.js):
       `lazy: true` ve kaynaktan okunan puan (`fRating`) eklenir. Sıra masaüstündeki
       gibi: son değişen önce, eşitlikte kimlik. */
    fun presetsList(done: (JSONArray?, String?) -> Unit) = run(done) {
        presetCache ?: buildPresetList().also { presetCache = it }
    }

    private fun buildPresetList(): JSONArray {
        val items = mutableListOf<JSONObject>()
        for (f in presetsDir.listFiles { x -> x.isFile && x.name.endsWith(".json") }.orEmpty()) {
            val p = try {
                JSONObject(String(AtomicFile(f).readFully(), Charsets.UTF_8))
            } catch (e: Exception) {
                Log.w(tag, "preset okunamadı: ${f.name}")
                continue
            }
            items.add(lean(p))
        }
        items.sortWith(compareByDescending<JSONObject> { it.optDouble("updatedAt", 0.0).let { v -> if (v.isNaN()) 0.0 else v } }.thenBy { it.optString("id") })
        return JSONArray(items)
    }

    private fun lean(p: JSONObject): JSONObject {
        val src = p.opt("source")
        if (p.optString("kind") != "milkdrop" || src !is String) return p
        p.remove("source")
        return p.put("lazy", true).put("fRating", PresetRating.of(src))
    }

    /** Bir presetin MilkDrop kaynağı ("" yoksa). */
    fun presetSource(id: String, done: (JSONObject?, String?) -> Unit) = run(done) {
        require(ID.matches(id)) { "bad-id" }
        val f = File(presetsDir, "$id.json")
        val src = if (f.isFile) JSONObject(String(AtomicFile(f).readFully(), Charsets.UTF_8)).optString("source", "") else ""
        JSONObject().put("source", src)
    }

    // ---- İçe aktarma (masaüstü tam yedeği ya da settings.json) ----

    /**
     * Dosyayı okur: tam yedekse presetler geçici klasöre alınır ve backup.json
     * sayfaya gider (doğrulama ve işleme sayfada); düz JSON ise ayar metni gider.
     */
    fun importRead(open: () -> InputStream?, done: (JSONObject?, String?) -> Unit) = run(done) {
        val input = BufferedInputStream(open() ?: throw FileNotFoundException("open"))
        input.use { s ->
            s.mark(8)
            val head = ByteArray(4)
            val n = s.read(head)
            s.reset()
            if (n == 4 && BackupReader.isZip(head)) {
                val r = BackupReader.read(s, staging)
                val meta = r.meta ?: throw IllegalArgumentException("not-backup")
                JSONObject().put("kind", "svbackup").put("meta", String(meta, Charsets.UTF_8))
                    .put("staged", JSONArray(r.presets.keys.toList())).put("skipped", r.skipped).put("later", JSONObject(r.later as Map<*, *>))
            } else {
                val bytes = BackupReader.readLimited(s, BackupReader.MAX_META) ?: throw IllegalArgumentException("too-large")
                JSONObject().put("kind", "settings").put("settings", String(bytes, Charsets.UTF_8))
            }
        }
    }

    /**
     * Geçici klasördeki presetlerden [ids]'tekiler işlenir (backup.json'ın listesi,
     * sayfa doğruladı). Masaüstündeki kural: içerik JSON nesnesi ve `id` alanı dosya
     * adıyla aynı olmalı; `builtin` atılır. Aynı kimlik varsa yedekteki geçerli olur,
     * yedekte olmayan presetler silinmez.
     */
    fun importCommit(ids: List<String>, done: (JSONObject?, String?) -> Unit) = run(done) {
        presetsDir.mkdirs()
        var saved = 0
        var skipped = 0
        for (id in ids) {
            val f = File(staging, "$id.json")
            if (!ID.matches(id) || !f.isFile) { skipped++; continue }
            val p = try { JSONObject(f.readText(Charsets.UTF_8)) } catch (e: Exception) { null }
            if (p == null || p.optString("id") != id) { skipped++; continue }
            p.remove("builtin")
            writeAtomic(AtomicFile(File(presetsDir, "$id.json")), p.toString().toByteArray(Charsets.UTF_8))
            saved++
        }
        staging.deleteRecursively()
        if (saved > 0) {
            presetGen++
            presetCache = null
        }
        JSONObject().put("presets", saved).put("skipped", skipped).put("gen", presetGen)
    }

    /** İçe aktarma vazgeçildi: geçici klasör silinir. */
    fun importDiscard(done: (JSONObject?, String?) -> Unit) = run(done) {
        staging.deleteRecursively()
        JSONObject()
    }

    /** Uygulamanın medya klasöründeki ya da seçilmiş belgedeki dosyayı açar. */
    fun opener(uri: Uri): () -> InputStream? = { app.contentResolver.openInputStream(uri) }

    private fun <T> run(done: (T?, String?) -> Unit, work: () -> T) {
        worker.post {
            try {
                val r = work()
                main.post { done(r, null) }
            } catch (e: IllegalArgumentException) {
                main.post { done(null, e.message ?: "bad-args") }
            } catch (e: Exception) {
                Log.e(tag, "dosya işi başarısız", e)
                main.post { done(null, e.javaClass.simpleName) }
            }
        }
    }

    companion object {
        val ID = Regex("^[A-Za-z0-9_-]{1,80}$")
    }
}
