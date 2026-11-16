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

    /* Kullanıcı presetleri masaüstündeki gibi tek tek dosyada (presets/<kimlik>.json).
       Sayfaya giden hafif liste ayrıca bir dizin dosyasında tutulur: gerçek bir
       masaüstü kitaplığı 10.392 preset, 147 MB (ölçüldü); her açılışta hepsini
       çözmek saniyeler sürerdi. Dizin klasörün DIŞINDA, çünkü "index" de geçerli
       bir preset kimliği. */
    private val presetsDir = File(dir, "presets")
    private val presetsIndex = AtomicFile(File(dir, "presets-index.json"))
    /* Geçici klasör presetlerle aynı ağaçta (profil klasöründe): presetler oradan ad
       değiştirilerek taşınıyor, sistem önbelleği temizlese de yarım iş kalmıyor. */
    private val staging = File(dir, ".import-staging")

    /* MilkDrop dokuları (masaüstünde uygulamanın doku klasörü): düz klasör, özgün adlarıyla. */
    private val texturesDir = File(app.filesDir, "textures")
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
        presetCache ?: loadPresetList().also { presetCache = it }
    }

    /* Dizin dosyası varsa o; yoksa ya da bozuksa klasör bir kez taranır ve dizin yazılır. */
    private fun loadPresetList(): JSONArray {
        if (presetsIndex.baseFile.exists()) {
            try {
                return JSONArray(String(presetsIndex.readFully(), Charsets.UTF_8))
            } catch (e: Exception) {
                Log.w(tag, "preset dizini okunamadı, klasör taranıyor")
            }
        }
        return buildPresetList().also { if (it.length() > 0) writeAtomic(presetsIndex, it.toString().toByteArray(Charsets.UTF_8)) }
    }

    private fun sortPresets(items: MutableList<JSONObject>): JSONArray {
        items.sortWith(compareByDescending<JSONObject> { it.optDouble("updatedAt", 0.0).let { v -> if (v.isNaN()) 0.0 else v } }.thenBy { it.optString("id") })
        return JSONArray(items)
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
        return sortPresets(items)
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

    // ---- MilkDrop dokuları (HOST.md milkdropTextures, milkdropTexture) ----

    /** Masaüstündeki yanıt: `{ dir, names }`, adlar sıralı. */
    fun texturesList(done: (JSONObject?, String?) -> Unit) = run(done) {
        val names = TextureNames.list(texturesDir.list()?.toList().orEmpty())
        JSONObject().put("dir", "").put("names", JSONArray(names))
    }

    /** `{ name, dataUrl }` ya da yoksa / kabul edilmiyorsa null (masaüstündeki gibi 8 MB sınırı). */
    fun textureRead(name: String, done: (Any?, String?) -> Unit) = run(done) {
        if (!TextureNames.readable(name)) return@run JSONObject.NULL
        val f = File(texturesDir, name)
        if (!f.isFile || f.length() > TextureNames.MAX_BYTES) return@run JSONObject.NULL
        val b64 = android.util.Base64.encodeToString(f.readBytes(), android.util.Base64.NO_WRAP)
        JSONObject().put("name", name).put("dataUrl", "data:" + TextureNames.mime(name) + ";base64," + b64)
    }

    // ---- İçe aktarma (masaüstü tam yedeği ya da settings.json) ----

    /**
     * Dosyayı okur: tam yedekse presetler geçici klasöre alınır ve backup.json
     * sayfaya gider (doğrulama ve işleme sayfada); düz JSON ise ayar metni gider.
     */
    fun importRead(open: () -> InputStream?, done: (JSONObject?, String?) -> Unit) = run(done) {
        val t0 = android.os.SystemClock.elapsedRealtime()
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
                    .put("staged", JSONArray(r.presets.keys.toList())).put("stagedTextures", JSONArray(r.textures.keys.toList()))
                    .put("skipped", r.skipped).put("later", JSONObject(r.later as Map<*, *>))
                    .put("ms", android.os.SystemClock.elapsedRealtime() - t0)
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
    fun importCommit(ids: List<String>, textures: List<Pair<String, String>>, done: (JSONObject?, String?) -> Unit) = run(done) {
        presetsDir.mkdirs()
        val t0 = android.os.SystemClock.elapsedRealtime()
        val byId = LinkedHashMap<String, JSONObject>()
        val existing = presetCache ?: loadPresetList()
        for (i in 0 until existing.length()) existing.optJSONObject(i)?.let { byId[it.optString("id")] = it }
        var saved = 0
        var skipped = 0
        for (id in ids) {
            val f = File(staging, "$id.json")
            if (!ID.matches(id) || !f.isFile) { skipped++; continue }
            val p = try { JSONObject(f.readText(Charsets.UTF_8)) } catch (e: Exception) { null }
            if (p == null || p.optString("id") != id) { skipped++; continue }
            val dst = File(presetsDir, "$id.json")
            /* Dosya olduğu gibi TAŞINIR (aynı ağaç, ad değiştirme atomik). Masaüstü
               `builtin`'i siliyor ki içe alınan preset yerleşik sayılmasın; yalnız o
               alan DOĞRUYSA yeniden yazılır. Ölçüldü: gerçek bir 10.392 presetlik
               kitaplıkta 10.390'ı `builtin: false` taşıyordu ve her birini diske
               zorlamalı yeniden yazmak 58 sn sürüyordu (dosya başına 5,6 ms). */
            if (truthy(p.opt("builtin"))) {
                p.remove("builtin")
                writeAtomic(AtomicFile(dst), p.toString().toByteArray(Charsets.UTF_8))
            } else if (!f.renameTo(dst)) {
                writeAtomic(AtomicFile(dst), f.readBytes())
            }
            p.remove("builtin")
            byId[id] = lean(p)
            saved++
        }
        /* Dokular: backup.json'daki özgün ad (masaüstünün portableName kuralı ve görsel
           uzantı) ve arşiv içi yol. Aynı ad varsa yedekteki geçerli. */
        var tex = 0
        for ((name, path) in textures) {
            val key = BackupReader.TEXTURE.matchEntire(path)?.groupValues?.get(1)
            val f = key?.let { File(File(staging, "textures"), it) }
            if (f == null || !f.isFile || !TextureNames.portable(name)) { skipped++; continue }
            texturesDir.mkdirs()
            val dst = File(texturesDir, name)
            if (dst.exists()) dst.delete()
            if (!f.renameTo(dst)) dst.writeBytes(f.readBytes())
            tex++
        }
        staging.deleteRecursively()
        if (saved > 0) {
            val list = sortPresets(byId.values.toMutableList())
            writeAtomic(presetsIndex, list.toString().toByteArray(Charsets.UTF_8))
            presetGen++
            presetCache = list
        }
        JSONObject().put("presets", saved).put("textures", tex).put("skipped", skipped).put("gen", presetGen)
            .put("ms", android.os.SystemClock.elapsedRealtime() - t0)
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

        /** JavaScript'teki doğruluk (masaüstündeki `preset.builtin` denetimi). */
        fun truthy(v: Any?): Boolean = when (v) {
            null, JSONObject.NULL, false -> false
            is Number -> v.toDouble().let { it != 0.0 && !it.isNaN() }
            is String -> v.isNotEmpty()
            else -> true
        }
    }
}
