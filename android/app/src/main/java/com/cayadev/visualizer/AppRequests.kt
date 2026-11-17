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
import android.net.Uri
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import com.cayadev.visualizer.audio.AudioHub
import com.cayadev.visualizer.audio.AudioService
import com.cayadev.visualizer.bridge.Bridge
import com.cayadev.visualizer.export.ExportHub
import com.cayadev.visualizer.player.PlayerHub
import com.cayadev.visualizer.player.PlayerService
import java.io.File
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
            /* Ayar dosyaları (2.2): sayfa adla okur ve yazar, biçim sayfada
               (src/mobile/profile-store.js). Disk işi ayrı iş parçacığında. */
            "storeRead" -> {
                val a = args.optJSONArray("names") ?: JSONArray()
                val names = (0 until a.length()).map { a.optString(it) }
                EngineHost.profile.read(names) { r, err -> if (r != null) reply.ok(r) else reply.fail("store-read", err ?: "") }
            }
            "storeWrite" -> {
                val files = args.optJSONObject("files") ?: JSONObject()
                EngineHost.profile.write(files) { r, err -> if (r != null) reply.ok(r) else reply.fail("store-write", err ?: "") }
            }
            /* Kullanıcı presetleri (masaüstündeki presets klasörü) ve içe aktarma. */
            "presetsList" -> EngineHost.profile.presetsList { r, err -> if (r != null) reply.ok(r) else reply.fail("presets-list", err ?: "") }
            "presetsSource" -> EngineHost.profile.presetSource(args.optString("id")) { r, err -> if (r != null) reply.ok(r) else reply.fail("presets-source", err ?: "") }
            "presetsHead" -> reply.ok(JSONObject().put("gen", EngineHost.profile.presetGen))
            "presetsSince" -> {
                val gen = EngineHost.profile.presetGen
                val r = JSONObject().put("gen", gen).put("upsert", JSONArray()).put("remove", JSONArray())
                // Ayrıntılı fark tutulmuyor: değiştiyse sayfa listeyi baştan ister
                if (args.optLong("gen", 0) != gen) r.put("reset", true)
                reply.ok(r)
            }
            "importPick" -> {
                if (live == null) { reply.fail("no-activity"); return }
                live.pickImport(reply)
            }
            "importOpen" -> {
                val f = try { mediaFile(args.optString("media")) } catch (e: IllegalArgumentException) { reply.fail("bad-media"); return }
                EngineHost.profile.importRead(EngineHost.profile.opener(Uri.fromFile(f))) { r, err -> if (r != null) reply.ok(r) else reply.fail("import", err ?: "") }
            }
            "importCommit" -> {
                val a = args.optJSONArray("ids") ?: JSONArray()
                val t = args.optJSONArray("textures") ?: JSONArray()
                val tex = (0 until t.length()).mapNotNull { t.optJSONObject(it) }.map { it.optString("name") to it.optString("path") }
                EngineHost.profile.importCommit((0 until a.length()).map { a.optString(it) }, tex) { r, err -> if (r != null) reply.ok(r) else reply.fail("import-commit", err ?: "") }
            }
            "texturesList" -> EngineHost.profile.texturesList { r, err -> if (r != null) reply.ok(r) else reply.fail("textures", err ?: "") }
            "textureRead" -> EngineHost.profile.textureRead(args.optString("name")) { r, err -> if (err == null) reply.ok(r) else reply.fail("texture", err) }
            "importDiscard" -> EngineHost.profile.importDiscard { r, err -> if (r != null) reply.ok(r) else reply.fail("import", err ?: "") }
            "storeCopy" -> EngineHost.profile.copy(args.optString("from"), args.optString("to"), args.optBoolean("overwrite", false)) { r, err ->
                if (r != null) reply.ok(r) else reply.fail("store-copy", err ?: "")
            }
            /* Uygulama içi çalar (2.3). Şarkı ya kullanıcının seçtiği belge (Android
               dosya seçici, izni kalıcı) ya da uygulamanın medya klasöründeki bir dosya. */
            "mediaPick" -> {
                if (live == null) { reply.fail("no-activity"); return }
                val kind = args.optString("kind")
                if (kind != "video" && kind != "image") { reply.fail("bad-kind"); return }
                live.pickMedia(kind, reply)
            }
            "playerPick" -> {
                if (live == null) { reply.fail("no-activity"); return }
                live.pickAudio(reply)
            }
            "playerOpen" -> {
                val uri = when {
                    args.has("media") -> try {
                        Uri.fromFile(mediaFile(args.optString("media")))
                    } catch (e: IllegalArgumentException) {
                        reply.fail("bad-media"); return
                    }
                    args.has("uri") -> args.optString("uri").toUri().takeIf { it.scheme == "content" && hasGrant(it) }
                        ?: run { reply.fail("bad-uri"); return }
                    else -> { reply.fail("bad-args"); return }
                }
                PlayerHub.with(app, { reply.fail("player-$it") }) { p ->
                    p.open(uri)
                    if (args.optBoolean("play", false)) p.player.play()
                    reply.ok(p.state())
                }
            }
            "playerPlay" -> player(reply) { it.player.play() }
            "playerPause" -> player(reply) { it.player.pause() }
            "playerStop" -> player(reply) { it.player.stop() }
            "playerSeek" -> player(reply) { it.player.seekTo(args.optLong("ms", 0).coerceAtLeast(0)) }
            "playerState" -> {
                val p = PlayerHub.service
                reply.ok(p?.state() ?: JSONObject().put("has", false).put("playing", false).put("state", "idle"))
            }
            "playerStats" -> reply.ok(PlayerHub.service?.stats() ?: JSONObject())
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
                FloatingWindow.keepAspect = args.optBoolean("keepAspect", FloatingWindow.keepAspect)
                if (args.has("width") && args.has("height")) FloatingWindow.resize(app, args.optInt("width"), args.optInt("height"))
                FloatingWindow.apply(app, args.optDouble("opacity", FloatingWindow.opacity.toDouble()).toFloat(), args.optBoolean("clickThrough", FloatingWindow.clickThrough))
                reply.ok(floatingState())
            }
            "floatingClose" -> {
                FloatingWindow.close(app)
                app.startActivity(Intent(app, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
                reply.ok()
            }
            "floatingState" -> reply.ok(floatingState())
            /* Geri tuşu kökte: uygulama arkaya alınır, Activity KAPATILMAZ (onDestroy
               motoru ve sesi kapatırdı). Medya uygulamalarındaki davranış. */
            "appToBack" -> {
                live?.moveTaskToBack(true)
                reply.ok(JSONObject().put("moved", live != null))
            }
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

    /* Çalara komut: servis yoksa (hiç şarkı açılmadıysa) hata. */
    private fun player(reply: Bridge.Reply, action: (PlayerService) -> Unit) {
        val p = PlayerHub.service ?: run { reply.fail("no-player"); return }
        action(p)
        reply.ok(p.state())
    }

    /* Uygulamanın medya klasöründeki dosya; klasör dışına çıkamaz. */
    private fun mediaFile(name: String): File {
        val dir = ExportHub.mediaDir(app)
        val f = File(dir, name).canonicalFile
        require(name.isNotEmpty() && f.path.startsWith(dir.canonicalPath + File.separator)) { "klasör dışı yol" }
        return f
    }

    /* Kalıcı okuma izni olan belge (playerPick'te alınmış). */
    private fun hasGrant(uri: Uri): Boolean =
        app.contentResolver.persistedUriPermissions.any { it.uri == uri && it.isReadPermission }

    private fun floatingState(): JSONObject {
        val b = FloatingWindow.bounds()
        return JSONObject().put("showing", FloatingWindow.isShowing).put("opacity", FloatingWindow.opacity.toDouble())
            .put("clickThrough", FloatingWindow.clickThrough).put("locked", FloatingWindow.locked).put("keepAspect", FloatingWindow.keepAspect)
            .put("maxPassThroughOpacity", FloatingWindow.maxPassThroughOpacity(app).toDouble())
            .put("bounds", if (b != null) JSONArray(b.toList()) else JSONObject.NULL)
            .put("activity", EngineHost.activity != null)
    }


    private fun hasRecordAudio() =
        ContextCompat.checkSelfPermission(app, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
}
