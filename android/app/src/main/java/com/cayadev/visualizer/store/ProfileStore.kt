/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.store

import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.AtomicFile
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException

/* AYAR DOSYALARI (docs/android/PLAN.md 2.2, §3 "Kayıt düzeni").

   Uygulama yalnız DEPO: hangi dosyaya ne yazılacağına sayfa karar verir
   (src/mobile/profile-store.js). Biçim masaüstünün aynısı, böylece bir
   bilgisayardan alınan dosyalar olduğu gibi açılır.

   Yazım atomik (AtomicFile): önce yeni dosya yazılıp diske zorlanıyor, sonra
   adı değiştiriliyor. Yazım sırasında uygulama ölürse eski dosya yerinde
   kalır, yarım dosya okunmaz. Disk işi ayrı bir iş parçacığında; yanıt ana
   iş parçacığına döner (yanıt vekili yalnız oradan çağrılır). */
class ProfileStore(context: Context) {
    private val tag = "SVStore"
    val dir: File = File(context.filesDir, "profile")
    private val thread = HandlerThread("sv-store").also { it.start() }
    private val worker = Handler(thread.looper)
    private val main = Handler(Looper.getMainLooper())

    private fun file(name: String): AtomicFile {
        require(ProfileNames.allowed(name)) { "bad-name" }
        return AtomicFile(File(dir, name))
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
            val f = file(n)
            val out = f.startWrite()
            try {
                out.write(data)
                f.finishWrite(out)
            } catch (e: Exception) {
                f.failWrite(out)
                throw e
            }
            bytes += data.size
        }
        JSONObject().put("written", names.size).put("bytes", bytes)
    }

    /**
     * [from]'u [to]'ya kopyalar. [overwrite] false ise [to] varken dokunmaz:
     * v4 göçü yedeği bir kez alınır (masaüstündeki gibi), sonraki göçler ilk
     * yedeği ezmez.
     */
    fun copy(from: String, to: String, overwrite: Boolean, done: (JSONObject?, String?) -> Unit) = run(done) {
        val src = file(from)
        val dst = file(to)
        val copied = if ((overwrite || !dst.baseFile.exists()) && src.baseFile.exists()) {
            val data = src.readFully()
            val out = dst.startWrite()
            try {
                out.write(data)
                dst.finishWrite(out)
            } catch (e: Exception) {
                dst.failWrite(out)
                throw e
            }
            true
        } else false
        JSONObject().put("copied", copied)
    }

    private fun run(done: (JSONObject?, String?) -> Unit, work: () -> JSONObject) {
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
}
