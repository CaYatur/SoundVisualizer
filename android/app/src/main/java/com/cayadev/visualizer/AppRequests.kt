/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import com.cayadev.visualizer.audio.AudioHub
import com.cayadev.visualizer.audio.AudioService
import com.cayadev.visualizer.bridge.Bridge
import org.json.JSONArray
import org.json.JSONObject

/* SAYFANIN İSTEKLERİ, uygulama düzeyinde. Motor (EngineHost) Activity'den uzun
   yaşayabildiği için istekleri karşılayan da Activity olamaz: izin ya da sistem
   onayı gereken işler o an ekrandaki Activity'ye (EngineHost.activity) gider,
   ekranda Activity yoksa reddedilir. */
class AppRequests(private val app: Context) : Bridge.RequestHandler {
    /* Sayfanın istekleri (docs/android/HOST.md). Activity kapalıyken (yalnız yüzen
       pencere) gelen istekler de buraya düşer: o zaman `this` artık ekranda
       değildir, izin ve onay isteyenler reddedilir. */
    override fun handle(op: String, args: JSONObject, reply: Bridge.Reply) {
        val live = EngineHost.activity
        when (op) {
            "audioStart" -> {
                val source = args.optString("source")
                if (source !in AudioService.SOURCES) { reply.fail("bad-source", source); return }
                if (live == null) {
                    if (source != AudioService.SOURCE_CAPTURE && hasRecordAudio()) {
                        AudioService.start(app, source)
                        reply.ok(JSONObject().put("source", source))
                    } else reply.fail("no-activity")
                    return
                }
                live.startAudio(source, reply)
            }
            "audioStop" -> {
                AudioService.stop(app)
                reply.ok()
            }
            "audioStats" -> reply.ok(JSONObject().put("delivered", AudioHub.delivered).put("dropped", AudioHub.dropped))
            // Dışa aktarım (0E6): kodlayıcı ve MP4 uygulamada, kareler sayfadan
            "exportBegin" -> EngineHost.exportHub.begin(args) { r, err -> if (r != null) reply.ok(r) else reply.fail("export-begin", err ?: "") }
            "exportEnd" -> EngineHost.exportHub.end { r, err -> if (r != null) reply.ok(r) else reply.fail("export-end", err ?: "") }
            "exportCancel" -> {
                EngineHost.exportHub.cancel()
                reply.ok()
            }
            // Yüzen pencere ve PiP (0E7)
            "floatingOpen" -> {
                if (!FloatingWindow.canShow(app)) {
                    live?.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, "package:${app.packageName}".toUri()))
                    reply.fail("overlay-permission")
                    return
                }
                val d = app.resources.displayMetrics
                val w = args.optInt("width", (d.widthPixels * 0.6).toInt())
                val h = args.optInt("height", w * 9 / 16)
                FloatingWindow.show(app, w, h, args.optDouble("opacity", 1.0).toFloat(), args.optBoolean("clickThrough", false))
                // Görünen pencere telefonun ana ekranı olsun: uygulama arkaya
                live?.moveTaskToBack(true)
                reply.ok(floatingState())
            }
            "floatingSet" -> {
                FloatingWindow.locked = args.optBoolean("locked", FloatingWindow.locked)
                FloatingWindow.apply(app, args.optDouble("opacity", FloatingWindow.opacity.toDouble()).toFloat(), args.optBoolean("clickThrough", FloatingWindow.clickThrough))
                reply.ok(floatingState())
            }
            "floatingClose" -> {
                FloatingWindow.close(app)
                app.startActivity(Intent(app, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
                reply.ok()
            }
            "floatingState" -> reply.ok(floatingState())
            "pipEnter" -> {
                if (live == null) { reply.fail("no-activity"); return }
                reply.ok(JSONObject().put("entered", live.enterPip(args.optInt("w", 16), args.optInt("h", 9))))
            }
            /* Ölçüm (yalnız geliştirme sürümü): Activity'yi kapatır; sistemin arka plandaki
               Activity'yi kapatmasıyla aynı yoldan geçer (onDestroy, yüzen pencere açık). */
            "debugFinishActivity" -> {
                if (!BuildConfig.DEBUG) { reply.fail("unknown-op", op); return }
                live?.finish()
                reply.ok(JSONObject().put("had", live != null))
            }
            else -> reply.fail("unknown-op", op)
        }
    }

    private fun floatingState(): JSONObject {
        val b = FloatingWindow.bounds()
        return JSONObject().put("showing", FloatingWindow.isShowing).put("opacity", FloatingWindow.opacity.toDouble())
            .put("clickThrough", FloatingWindow.clickThrough).put("locked", FloatingWindow.locked)
            .put("maxPassThroughOpacity", FloatingWindow.maxPassThroughOpacity(app).toDouble())
            .put("bounds", if (b != null) JSONArray(b.toList()) else JSONObject.NULL)
            .put("activity", EngineHost.activity != null)
    }


    private fun hasRecordAudio() =
        ContextCompat.checkSelfPermission(app, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
}
