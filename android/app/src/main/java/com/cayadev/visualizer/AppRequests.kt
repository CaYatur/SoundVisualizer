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
import com.cayadev.visualizer.export.ExportFlow
import com.cayadev.visualizer.export.ExportHub
import com.cayadev.visualizer.player.PlayerHub
import com.cayadev.visualizer.player.PlayerService
import java.io.File
import org.json.JSONArray
import com.cayadev.visualizer.store.LyricsHub
import com.cayadev.visualizer.store.LyricsLibrary
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
            /* Çalan parça (media/NowPlaying.kt): durum ve bildirim erişimi ekranı. */
            "nowPlayingStatus" -> reply.ok(com.cayadev.visualizer.media.NowPlaying.status(app))
            /* PC bağlantısı (link/PcLink.kt, docs/PHONE-LINK.md). Ağ işi bağlantının kendi iş
               parçacığında; yanıt oradan gelir. */
            "linkStatus" -> com.cayadev.visualizer.link.PcLink.status { reply.ok(it) }
            "linkPairQr" -> com.cayadev.visualizer.link.PcLink.pairQr(args.optString("qr"), phoneName(), android.os.Build.MODEL ?: "") { e -> if (e == null) reply.ok() else reply.fail(e) }
            "linkPairCode" -> com.cayadev.visualizer.link.PcLink.pairCode(args.optString("host"), args.optInt("port"), args.optString("code"), phoneName(), android.os.Build.MODEL ?: "") { e -> if (e == null) reply.ok() else reply.fail(e) }
            "linkConnect" -> com.cayadev.visualizer.link.PcLink.connect(args.optString("pc")) { e -> if (e == null) reply.ok() else reply.fail(e) }
            "linkDisconnect" -> { com.cayadev.visualizer.link.PcLink.disconnect(); reply.ok() }
            "linkForget" -> { com.cayadev.visualizer.link.PcLink.forget(args.optString("pc")); reply.ok() }
            "linkAuto" -> { com.cayadev.visualizer.link.PcLink.setAuto(args.optString("pc"), args.optBoolean("on")); reply.ok() }
            "linkRequest" -> com.cayadev.visualizer.link.PcLink.request(args.optString("op"), args.optJSONObject("args") ?: JSONObject()) { r -> reply.ok(r) }
            "linkDiscover" -> {
                if (args.optBoolean("on")) com.cayadev.visualizer.link.LinkDiscovery.start(app) { com.cayadev.visualizer.link.PcLink.status { s -> EngineHost.bridge?.event("linkState", s) } }
                else com.cayadev.visualizer.link.LinkDiscovery.stop()
                reply.ok()
            }
            /* Kamera karesinden QR: sayfa gri tonlu küçük kare yollar (base64). Çözme ayrı iş parçacığında. */
            "linkQrFrame" -> {
                val w = args.optInt("w"); val h = args.optInt("h")
                val bytes = try { android.util.Base64.decode(args.optString("data"), android.util.Base64.DEFAULT) } catch (e: Exception) { null }
                if (bytes == null) { reply.fail("bad-frame"); return }
                Thread { reply.ok(com.cayadev.visualizer.link.QrDecode.gray(bytes, w, h) ?: JSONObject.NULL) }.start()
            }
            "debugNowPlayingSelf" -> {
                if (!BuildConfig.DEBUG) { reply.fail("unknown-op", op); return }
                com.cayadev.visualizer.media.NowPlaying.includeSelf = args.optBoolean("on")
                reply.ok()
            }
            "nowPlayingAccess" -> {
                if (live == null) { reply.fail("no-activity"); return }
                try {
                    live.startActivity(com.cayadev.visualizer.media.NowPlaying.accessIntent(live))
                    reply.ok()
                } catch (e: Exception) {
                    // Ayrıntı ekranı yoksa genel liste
                    try { live.startActivity(android.content.Intent(android.provider.Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)); reply.ok() } catch (e2: Exception) { reply.fail("no-settings", e2.message ?: "") }
                }
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
                val l = args.optJSONArray("libs")
                val only = l?.let { x -> (0 until x.length()).map { x.optString(it) }.toSet() }
                EngineHost.profile.importCommit((0 until a.length()).map { a.optString(it) }, tex, only) { r, err -> if (r != null) reply.ok(r) else reply.fail("import-commit", err ?: "") }
            }
            "backupPlan" -> {
                val a = args.optJSONArray("refs") ?: JSONArray()
                EngineHost.profile.backupPlan((0 until a.length()).map { a.optString(it) }) { r, err -> if (r != null) reply.ok(r) else reply.fail("backup-plan", err ?: "") }
            }
            "backupExport" -> {
                val progress = { d: Long, t: Long -> EngineHost.bridge?.event("backupProgress", JSONObject().put("done", d).put("total", t)); Unit }
                val name = args.optString("name", "soundvisualizer.svbackup")
                // Sınama: belge seçicisiz, uygulamanın medya klasörüne (yalnız geliştirme sürümünde)
                val direct = args.optString("debugMedia")
                if (BuildConfig.DEBUG && direct.isNotEmpty()) {
                    val f = try { mediaFile(direct) } catch (e: IllegalArgumentException) { reply.fail("bad-media"); return }
                    EngineHost.profile.backupWrite(args, { f.outputStream() }, { f.delete() }, progress) { r, err -> if (r != null) reply.ok(r.put("name", f.name)) else reply.fail("backup-export", err ?: "") }
                } else {
                    if (live == null) { reply.fail("no-activity"); return }
                    live.pickBackupTarget(name, reply) { uri ->
                        val cr = app.contentResolver
                        EngineHost.profile.backupWrite(args, { cr.openOutputStream(uri, "wt") }, { android.provider.DocumentsContract.deleteDocument(cr, uri) }, progress) { r, err ->
                            if (r != null) reply.ok(r.put("name", com.cayadev.visualizer.media.MediaPick.displayName(app, uri).ifEmpty { name })) else reply.fail("backup-export", err ?: "")
                        }
                    }
                }
            }
            "texturesList" -> EngineHost.profile.texturesList { r, err -> if (r != null) reply.ok(r) else reply.fail("textures", err ?: "") }
            "textureRead" -> EngineHost.profile.textureRead(args.optString("name")) { r, err -> if (err == null) reply.ok(r) else reply.fail("texture", err) }
            /* Şarkı sözleri (store/LyricsHub.kt): kitaplık masaüstündeki gibi, otomatik bulma
               yalnız kullanıcının eklediği sağlayıcılara (liste boşsa ağa çıkılmaz). */
            "lyricsLibSnapshot" -> LyricsHub.run({ r, e -> if (r != null) reply.ok(r) else reply.fail("lyrics", e ?: "") }) { LyricsHub.library.snapshot() }
            "lyricsLibList" -> LyricsHub.run({ r, e -> if (r != null) reply.ok(r) else reply.fail("lyrics", e ?: "") }) { LyricsHub.library.list() }
            "lyricsLibRead" -> LyricsHub.run({ r, e -> if (e == null) reply.ok(r ?: JSONObject.NULL) else reply.fail("lyrics", e) }) { LyricsHub.library.read(args.optString("id")) }
            "lyricsLibRemove" -> LyricsHub.run({ r, e -> if (r != null) reply.ok(r) else reply.fail("lyrics", e ?: "") }, publish = true) { LyricsHub.library.remove(args.optString("id")) }
            "lyricsLibUpdate" -> LyricsHub.run({ r, e -> if (r != null) reply.ok(r) else reply.fail("lyrics", e ?: "") }, publish = true) {
                LyricsHub.library.update(args.optString("id"), args.optJSONObject("patch") ?: JSONObject())
            }
            "lyricsLibAdd" -> LyricsHub.run({ r, e -> if (r != null) reply.ok(r) else reply.fail("lyrics", e ?: "") }, publish = true) {
                val text = args.optString("text")
                val name = args.optString("name").ifBlank { "lyrics" }
                LyricsHub.library.add(if (LyricsLibrary.isLyricFile(name)) name else "$name.lrc", text.toByteArray(Charsets.UTF_8), args.optString("artist"), args.optString("title"))
            }
            /* Masaüstü yedeğinden gelen logo kitaplığı (store/LibraryRestore.kt): motorun
               logo katmanı görseli kimlikle ister (masaüstündeki logo-lib:read). */
            "logoLibRead" -> LyricsHub.run({ r, e -> if (e == null) reply.ok(r ?: JSONObject.NULL) else reply.fail("logo", e) }) {
                com.cayadev.visualizer.store.LibraryRestore.readLogo(app.filesDir, args.optString("id"))
            }
            "libraryList" -> LyricsHub.run({ r, e -> if (r != null) reply.ok(r) else reply.fail("library", e ?: "") }) {
                com.cayadev.visualizer.store.LibraryRestore.list(app.filesDir, args.optString("key"))
            }
            "lyricsLibImport" -> {
                if (live == null) { reply.fail("no-activity"); return }
                live.pickLyrics(reply)
            }
            "lyricsLookup" -> LyricsHub.lookup(args.optJSONObject("config"), args.optJSONObject("meta") ?: JSONObject()) { r, e -> if (r != null) reply.ok(r) else reply.fail("lyrics-lookup", e ?: "") }
            "lyricsCacheClear" -> LyricsHub.clearCache { r, e -> if (r != null) reply.ok(r) else reply.fail("lyrics", e ?: "") }
            "milkImport" -> {
                if (live == null) { reply.fail("no-activity"); return }
                live.pickMilk(reply)
            }
            "importDiscard" -> EngineHost.profile.importDiscard { r, err -> if (r != null) reply.ok(r) else reply.fail("import", err ?: "") }
            "storeCopy" -> EngineHost.profile.copy(args.optString("from"), args.optString("to"), args.optBoolean("overwrite", false)) { r, err ->
                if (r != null) reply.ok(r) else reply.fail("store-copy", err ?: "")
            }
            /* Uygulama içi çalar (2.3). Şarkı ya kullanıcının seçtiği belge (Android
               dosya seçici, izni kalıcı) ya da uygulamanın medya klasöründeki bir dosya. */
            "mediaPick" -> {
                if (live == null) { reply.fail("no-activity"); return }
                val kind = args.optString("kind")
                if (kind != "video" && kind != "image" && kind != "audio") { reply.fail("bad-kind"); return }
                live.pickMedia(kind, reply)
            }
            /* Dışa aktarma ekranı (export/ExportFlow.kt): iş bırakılır, motor dışa aktarım
               sayfasına geçer; o sayfa işi alır, bitince galeriye kaydeder ve sahneye döner. */
            "exportOpen" -> try {
                reply.ok(ExportFlow.open(app, args))
            } catch (e: Exception) {
                reply.fail("export-open", e.message ?: e.javaClass.simpleName)
            }
            "exportJob" -> reply.ok(ExportFlow.job() ?: JSONObject.NULL)
            "audioTags" -> LyricsHub.audioTags(android.net.Uri.parse(args.optString("uri"))) { r, e -> if (r != null) reply.ok(r) else reply.fail("audio-tags", e ?: "") }
            "exportSave" -> try {
                reply.ok(ExportFlow.save(app, args.optString("path")))
            } catch (e: Exception) {
                reply.fail("export-save", e.message ?: e.javaClass.simpleName)
            }
            "exportShare" -> {
                if (live == null) { reply.fail("no-activity"); return }
                live.startActivity(ExportFlow.shareIntent(args.optString("uri")))
                reply.ok()
            }
            /* Ekranı açık tut (masaüstündeki power.keepAwake; dışa aktarımda her zaman). */
            "keepAwake" -> {
                val on = args.optBoolean("on", true)
                EngineHost.keepAwake = on
                reply.ok(JSONObject().put("on", on))
            }
            "exportClose" -> {
                ExportFlow.close()
                reply.ok()
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
            "playerPosition" -> reply.ok(PlayerHub.service?.position() ?: JSONObject().put("has", false).put("playing", false).put("state", "idle"))
            "playerStats" -> reply.ok(PlayerHub.service?.stats() ?: JSONObject())
            // Uygulama içi çaların şarkısının ID3 etiketi (gömülü söz, src/mobile/android-host.js)
            "playerHead" -> {
                val uri = PlayerHub.service?.currentUri()
                if (uri == null) reply.ok(JSONObject()) else LyricsHub.audioHead(uri) { r, e -> if (r != null) reply.ok(r) else reply.fail("player-head", e ?: "") }
            }
            "audioStats" -> reply.ok(JSONObject().put("delivered", AudioHub.delivered).put("dropped", AudioHub.dropped))
            // Dışa aktarım (0E6): kodlayıcı ve MP4 uygulamada, kareler sayfadan
            "exportBegin" -> EngineHost.exportHub.begin(args) { r, err -> if (r != null) reply.ok(r) else reply.fail("export-begin", err ?: "") }
            "exportCaps" -> reply.ok(EngineHost.exportHub.caps())
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
                // Sahnede kamera katmanı varsa yüzen pencerede de çalışsın (uygulama henüz öndeyken başlatılır)
                if (args.optBoolean("camera", false)) com.cayadev.visualizer.media.CameraService.start(app)
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
                com.cayadev.visualizer.media.CameraService.stop(app)
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


    // Bilgisayarın cihaz listesinde görünen ad: kullanıcının verdiği cihaz adı, yoksa model
    private fun phoneName(): String =
        (try { android.provider.Settings.Global.getString(app.contentResolver, "device_name") } catch (e: Exception) { null })
            ?.takeIf { it.isNotBlank() } ?: (android.os.Build.MODEL ?: "Android")

    private fun hasRecordAudio() =
        ContextCompat.checkSelfPermission(app, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
}
