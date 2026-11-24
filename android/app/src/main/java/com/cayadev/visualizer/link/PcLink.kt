/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.link

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/* PC BAĞLANTISI (telefon tarafı, docs/PHONE-LINK.md). Masaüstündeki phone-link.js'in karşılığı:
   QR ya da kodla eşleşme, kayıtlı bilgisayara yeniden bağlanma, şifreli istek/yanıt, olaylar.
   Sayfa durumu `linkState` olayıyla, bilgisayarın olaylarını `linkEvent` ile alır.

   Durumlar: idle → connecting → (approve: bilgisayarda onay bekleniyor | sas: sayı karşılaştırma)
   → connected; hata `error` alanında. Bağlantı beklenmedik koparsa ve bilgisayar "kendiliğinden
   bağlan" ise artan aralıklarla yeniden dener. Ağ işi tek iş parçacığında (exec). */
object PcLink {
    private const val CONNECT_MS = 3000
    private const val REQUEST_MS = 15000L
    private val exec = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "sv-link").apply { isDaemon = true } }

    @Volatile private var emit: (String, Any?) -> Unit = { _, _ -> }
    private lateinit var store: LinkStore
    private var ready = false

    // Oturum
    private var ws: WsClient? = null
    private var sealer: LinkCrypto.Sealer? = null
    private var opener: LinkCrypto.Opener? = null
    private var gen = 0 // her bağlantı denemesi yeni kuşak: eski soketin geri çağrıları yok sayılır
    @Volatile private var state = "idle"
    private var pc: JSONObject? = null
    private var level = ""
    private var error: String? = null
    private var digits: String? = null
    private var wantPc: String? = null // kopunca yeniden bağlanılacak bilgisayar
    private var retry = 0
    private var nextId = 1
    private val waiting = ConcurrentHashMap<String, (JSONObject) -> Unit>()

    /* Telefonun sesi → bilgisayar (B4). Yakalama iş parçacığı örnekleri buraya verir; kopyalanıp
       bağlantının iş parçacığında şifreli yollanır. Ağ yavaşsa kuyruk 24 paketi geçince atılır:
       gecikme birikmesin. */
    @Volatile var sendAudio = false
    private var audioSeq = 0L
    private val audioQueued = java.util.concurrent.atomic.AtomicInteger(0)
    @Volatile var audioSent = 0L
        private set
    @Volatile var audioDropped = 0L
        private set
    fun pushAudio(sampleRate: Int, channels: Int, samples: ShortArray, count: Int) {
        if (!sendAudio || state != "connected" || count <= 0) return
        if (audioQueued.get() > 24) { audioDropped++; return }
        val copy = samples.copyOf(count)
        audioQueued.incrementAndGet()
        exec.execute {
            audioQueued.decrementAndGet()
            val s = sealer
            val w = ws
            if (!sendAudio || state != "connected" || s == null || w == null) return@execute
            val frames = copy.size / channels
            var at = 0
            while (at < frames) {
                val n = minOf(LinkAudio.MAX_FRAMES, frames - at)
                val pkt = LinkAudio.encode(audioSeq++, sampleRate, channels, copy, at * channels, n)
                if (w.sendBinary(s.seal(pkt))) audioSent++ else audioDropped++
                at += n
            }
        }
    }
    /* ANLIK EFEKT KİRASI telefonda da sayfadan bağımsız. Sayfa basışı, bırakışı ve basılıyken
       saniyede bir "hâlâ basılı" bildirir; yenilemeyi (yarım saniyede bir) bu iş parçacığı yapar.
       Emülatörde ölçüldü: sayfa ile uygulama arası gidiş-dönüş 0,2–0,5 sn, yüklüyken birkaç saniye;
       yenileme sayfada kalınca bilgisayardaki 1,5 sn'lik kira doluyor, efekt basılıyken düşüyordu.
       Sayfa 4 sn bildirmezse (çöktü, kapandı) liste bırakılır: efekt takılı kalmaz. */
    private var held = JSONArray()
    private var heldBeat = 0L
    private var heldTask: java.util.concurrent.ScheduledFuture<*>? = null
    fun setHeld(list: JSONArray) = exec.execute {
        val changed = list.toString() != held.toString()
        held = list
        heldBeat = System.currentTimeMillis()
        if (changed || list.length() > 0) sendHeld()
        if (list.length() > 0 && heldTask == null) {
            heldTask = exec.scheduleAtFixedRate({
                if (System.currentTimeMillis() - heldBeat > 4000) { held = JSONArray(); sendHeld() }
                if (held.length() == 0) { heldTask?.cancel(false); heldTask = null } else sendHeld()
            }, 500, 500, TimeUnit.MILLISECONDS)
        }
    }
    private fun sendHeld() {
        val s = sealer
        val w = ws
        if (state != "connected" || s == null || w == null) return
        // Yanıt beklenmez (kimliksiz istek): kira yenilemesi sırayı tıkamasın
        w.sendBinary(s.seal(JSONObject().put("op", "momentary").put("args", JSONObject().put("list", held)).toString().toByteArray()))
    }

    fun audioStats(): JSONObject = JSONObject().put("send", sendAudio).put("sent", audioSent).put("dropped", audioDropped)

    fun init(ctx: Context, events: (String, Any?) -> Unit) {
        emit = events
        if (ready) return
        store = LinkStore(File(ctx.filesDir, "link/pcs.json"), LinkStore.KeystoreProtector())
        exec.execute {
            store.load()
            ready = true
            // Kendiliğinden bağlanılacak en son bilgisayar
            store.pcs.values.filter { it.auto }.maxByOrNull { it.lastSeen }?.let { connectSaved(it.id) }
        }
    }

    // ---- Sayfanın istekleri (AppRequests üzerinden; yanıt geri çağrıyla)
    fun status(cb: (JSONObject) -> Unit) = exec.execute { cb(statusJson()) }

    fun pairQr(qr: String, phoneName: String, model: String, cb: (String?) -> Unit) = exec.execute {
        val q = parseQr(qr)
        if (q == null) { cb("bad-qr"); return@execute }
        cb(null)
        startPair(q.hosts, q.port, phoneName, model, qr = q)
    }

    fun pairCode(host: String, port: Int, code: String, phoneName: String, model: String, cb: (String?) -> Unit) = exec.execute {
        if (!Regex("^\\d{6}$").matches(code) || host.isBlank() || port !in 1..65535) { cb("bad-input"); return@execute }
        cb(null)
        startPair(listOf(host.trim()), port, phoneName, model, code = code)
    }

    fun connect(pcId: String, cb: (String?) -> Unit) = exec.execute {
        if (!store.pcs.containsKey(pcId)) { cb("unknown-pc"); return@execute }
        cb(null)
        connectSaved(pcId)
    }

    fun disconnect() = exec.execute { wantPc = null; drop("user"); setState("idle") }
    fun cancel() = disconnect()

    fun forget(pcId: String) = exec.execute {
        if (pc?.optString("id") == pcId) { wantPc = null; drop("forget"); setState("idle") }
        store.remove(pcId)
        publish()
    }

    fun setAuto(pcId: String, on: Boolean) = exec.execute { store.pcs[pcId]?.let { it.auto = on; store.save() }; publish() }

    /** Şifreli istek. Yanıt { ok, result | error } olarak döner. */
    fun request(op: String, args: JSONObject, cb: (JSONObject) -> Unit) = exec.execute {
        val s = sealer
        val w = ws
        if (state != "connected" || s == null || w == null) { cb(JSONObject().put("ok", false).put("error", "not-connected")); return@execute }
        val id = (nextId++).toString()
        waiting[id] = cb
        if (!w.sendBinary(s.seal(JSONObject().put("id", id).put("op", op).put("args", args).toString().toByteArray()))) {
            waiting.remove(id); cb(JSONObject().put("ok", false).put("error", "send-failed")); return@execute
        }
        exec.schedule({ waiting.remove(id)?.invoke(JSONObject().put("ok", false).put("error", "timeout")) }, REQUEST_MS, TimeUnit.MILLISECONDS)
    }

    // ---- QR
    class Qr(val hosts: List<String>, val port: Int, val id: String, val fp: ByteArray, val secret: ByteArray, val name: String)
    fun parseQr(text: String): Qr? {
        if (!text.startsWith("svlink://1?")) return null
        val hosts = ArrayList<String>()
        var port = 0; var id = ""; var fp: ByteArray? = null; var secret: ByteArray? = null; var name = ""
        for (part in text.substring("svlink://1?".length).split('&')) {
            val i = part.indexOf('=')
            if (i <= 0) continue
            val k = part.substring(0, i)
            val v = try { java.net.URLDecoder.decode(part.substring(i + 1), "UTF-8") } catch (e: Exception) { continue }
            when (k) {
                "h" -> if (hosts.size < 6 && Regex("^[0-9A-Za-z.:\\-]{1,64}$").matches(v)) hosts.add(v)
                "p" -> port = v.toIntOrNull() ?: 0
                "id" -> id = v.take(32)
                "f" -> fp = LinkCrypto.unb64u(v)
                "s" -> secret = LinkCrypto.unb64u(v)
                "n" -> name = v.take(64)
            }
        }
        if (hosts.isEmpty() || port !in 1..65535 || fp?.size != 16 || secret?.size != 32) return null
        return Qr(hosts, port, id, fp!!, secret!!, name)
    }

    // ---- Bağlantı ve el sıkışma
    private fun startPair(hosts: List<String>, port: Int, name: String, model: String, qr: Qr? = null, code: String? = null) {
        wantPc = null
        drop("new")
        val me = store.ensureIdentity()
        val np = LinkCrypto.randomBytes(16)
        var pcPub: ByteArray? = null
        var commit: ByteArray? = null
        var nc: ByteArray? = null
        digits = null
        open(hosts, port, onHello = { hello, w ->
            pcPub = LinkCrypto.unb64u(hello.optJSONObject("pc")?.optString("pub"))
            if (qr != null) {
                w.sendText(JSONObject().put("t", "pair").put("kind", "qr").put("v", 1).put("pub", LinkCrypto.b64u(me.pub)).put("np", LinkCrypto.b64u(np))
                    .put("name", name).put("model", model).put("mac", LinkCrypto.b64u(LinkCrypto.hmac(qr.secret, "sv-link-qr|phone|", me.pub, np))).toString())
            } else {
                w.sendText(JSONObject().put("t", "pair").put("kind", "code").put("v", 1).put("pub", LinkCrypto.b64u(me.pub)).put("name", name).put("model", model)
                    .put("proof", LinkCrypto.b64u(LinkCrypto.hmac(code!!.toByteArray(), "sv-link-code|", me.pub))).toString())
            }
        }, onText = { m, w ->
            when (m.optString("t")) {
                "pending" -> { // QR: bilgisayarı doğrula, onayı bekle
                    val pub = LinkCrypto.unb64u(m.optJSONObject("pc")?.optString("pub")) ?: return@open fail("bad-reply")
                    val n = LinkCrypto.unb64u(m.optString("nc")) ?: return@open fail("bad-reply")
                    val mac = LinkCrypto.unb64u(m.optString("mac")) ?: return@open fail("bad-reply")
                    if (!LinkCrypto.fingerprint(pub).contentEquals(qr!!.fp)) return@open fail("wrong-pc")
                    if (!LinkCrypto.hmac(qr.secret, "sv-link-qr|pc|", pub, n, me.pub).contentEquals(mac)) return@open fail("wrong-pc")
                    pcPub = pub; nc = n
                    digits = LinkCrypto.sasDigits(me.pub, pub, np, n)
                    pc = JSONObject().put("id", m.optJSONObject("pc")?.optString("id")).put("name", m.optJSONObject("pc")?.optString("name"))
                    setState("approve")
                }
                "commit" -> { // Kod: taahhüdü sakla, kendi değerini açıkla
                    pcPub = LinkCrypto.unb64u(m.optString("pub"))
                    commit = LinkCrypto.unb64u(m.optString("commit"))
                    if (pcPub == null || commit == null) return@open fail("bad-reply")
                    w.sendText(JSONObject().put("t", "reveal").put("np", LinkCrypto.b64u(np)).toString())
                }
                "reveal" -> {
                    val n = LinkCrypto.unb64u(m.optString("nc")) ?: return@open fail("bad-reply")
                    if (!LinkCrypto.hmac(n, "sv-link-commit|", pcPub!!, me.pub).contentEquals(commit)) return@open fail("bad-commit")
                    nc = n
                    digits = LinkCrypto.sasDigits(me.pub, pcPub!!, np, n)
                    setState("sas")
                }
                "paired" -> {
                    val pub = pcPub ?: return@open fail("bad-reply")
                    val n = nc ?: return@open fail("bad-reply")
                    val devKey = LinkCrypto.deviceKey(LinkCrypto.sharedSecret(me, pub), me.pub, pub, np, n)
                    val info = m.optJSONObject("pc") ?: JSONObject()
                    val pcId = info.optString("id").ifEmpty { qr?.id ?: "" }
                    val rec = LinkStore.Pc(pcId, info.optString("name").ifEmpty { qr?.name ?: "PC" }, hosts, port,
                        LinkCrypto.b64u(LinkCrypto.fingerprint(pub)), m.optString("device"), devKey, m.optString("level", "full"), System.currentTimeMillis(), true)
                    store.put(rec)
                    startSession(rec, devKey, np, n, m.optString("level", "full"))
                }
                "error" -> fail(m.optString("code", "error"))
            }
        })
    }

    private fun connectSaved(pcId: String) {
        val rec = store.pcs[pcId] ?: return
        drop("new")
        wantPc = pcId
        val np = LinkCrypto.randomBytes(16)
        // Bilgisayarın IP'si değiştiyse ağdaki son duyurusundaki adres önce denenir
        val found = LinkDiscovery.addressOf(rec.id)
        val hosts = (listOfNotNull(found?.first) + rec.hosts).distinct()
        open(hosts, found?.second ?: rec.port, onHello = { hello, w ->
            // Başka bir bilgisayara düştüysek (aynı adreste) devam etme
            val hid = hello.optJSONObject("pc")?.optString("id") ?: ""
            if (hid.isNotEmpty() && hid != rec.id) return@open fail("wrong-pc")
            w.sendText(JSONObject().put("t", "resume").put("v", 1).put("device", rec.device).put("np", LinkCrypto.b64u(np))
                .put("proof", LinkCrypto.b64u(LinkCrypto.hmac(rec.key, "sv-link-resume|phone|", np))).toString())
        }, onText = { m, _ ->
            when (m.optString("t")) {
                "welcome" -> {
                    val nc = LinkCrypto.unb64u(m.optString("nc")) ?: return@open fail("bad-reply")
                    val proof = LinkCrypto.unb64u(m.optString("proof")) ?: return@open fail("bad-reply")
                    if (!LinkCrypto.hmac(rec.key, "sv-link-resume|pc|", np, nc).contentEquals(proof)) return@open fail("wrong-pc")
                    store.touch(rec.id, m.optString("level", rec.level), null, null, m.optJSONObject("pc")?.optString("name"))
                    startSession(rec, rec.key, np, nc, m.optString("level", rec.level))
                }
                "error" -> {
                    val c = m.optString("code", "error")
                    if (c == "unknown-device") { wantPc = null; store.remove(rec.id) } // bilgisayar bu telefonu unuttu
                    fail(c)
                }
            }
        })
    }

    private fun startSession(rec: LinkStore.Pc, devKey: ByteArray, np: ByteArray, nc: ByteArray, lv: String) {
        val k = LinkCrypto.sessionKeys(devKey, np, nc)
        sealer = LinkCrypto.phoneSealer(k)
        opener = LinkCrypto.phoneOpener(k)
        pc = JSONObject().put("id", rec.id).put("name", rec.name)
        level = lv
        wantPc = rec.id
        retry = 0
        digits = null
        setState("connected")
    }

    /* Adresleri sırayla dener; ilk açılan soketle sürer. Geri çağrılar exec'te. */
    private fun open(hosts: List<String>, port: Int, onHello: (JSONObject, WsClient) -> Unit, onText: (JSONObject, WsClient) -> Unit) {
        val my = ++gen
        error = null
        setState("connecting")
        for (h in hosts) {
            if (my != gen) return
            var client: WsClient? = null
            client = WsClient(
                onText = { t -> exec.execute {
                    if (my != gen) return@execute
                    val m = try { JSONObject(t) } catch (e: Exception) { return@execute }
                    if (m.optString("t") == "hello") onHello(m, client!!) else onText(m, client!!)
                } },
                onBinary = { b -> exec.execute { if (my == gen) onFrame(b) } },
                onClose = { why -> exec.execute { if (my == gen) lost(why) } },
            )
            try {
                client.connect(h, port, "/link", CONNECT_MS)
                ws = client
                return
            } catch (e: Exception) {
                // HTTP yanıtı (ör. 404: bağlantı kapalı) ayrı; gerisi ulaşılamıyor
                val msg = e.message ?: ""
                error = if (msg.startsWith("http:")) "link-off" else "unreachable"
            }
        }
        fail(error ?: "unreachable")
    }

    private fun onFrame(b: ByteArray) {
        val plain = opener?.open(b) ?: return
        // İkili ileti: bilgisayarın sesi (B5). Sayfa yalnız istediyse alır (AudioHub.pcAudio)
        if (plain.isNotEmpty() && plain[0] != '{'.code.toByte()) {
            val p = LinkAudio.decode(plain) ?: return
            if (com.cayadev.visualizer.audio.AudioHub.pcAudio) com.cayadev.visualizer.audio.AudioHub.pushPcm(p.sampleRate, p.channels, com.cayadev.visualizer.bridge.Messages.SOURCE_PC, p.samples, p.samples.size)
            return
        }
        val m = try { JSONObject(String(plain, Charsets.UTF_8)) } catch (e: Exception) { return }
        val re = m.optString("re", "")
        if (re.isNotEmpty()) { waiting.remove(re)?.invoke(m); return }
        if (m.has("ev")) emit("linkEvent", m)
    }

    private fun lost(why: String) {
        val was = state
        drop(why)
        if (was == "connected" && wantPc != null && store.pcs[wantPc!!]?.auto == true) {
            // Kendiliğinden yeniden bağlan: 1, 2, 4, 8, 15 sn
            val delay = longArrayOf(1, 2, 4, 8, 15)[minOf(retry, 4)]
            retry++
            error = "lost"
            setState("reconnecting")
            val target = wantPc!!
            exec.schedule({ if (wantPc == target && state == "reconnecting") connectSaved(target) }, delay, TimeUnit.SECONDS)
        } else if (state != "idle" && state != "error") {
            error = if (was == "connected") "lost" else (error ?: why)
            setState(if (was == "connected") "idle" else "error")
        }
    }

    private fun fail(code: String) {
        val target = wantPc
        drop(code)
        error = code
        // Kayıtlı bilgisayara yeniden bağlanırken ağ yoksa ya da bağlantı kapalıysa denemeyi sürdür
        if (target != null && store.pcs[target]?.auto == true && (code == "unreachable" || code == "link-off")) {
            val delay = longArrayOf(2, 4, 8, 15, 30)[minOf(retry, 4)]
            retry++
            setState("reconnecting")
            exec.schedule({ if (wantPc == target && state == "reconnecting") connectSaved(target) }, delay, TimeUnit.SECONDS)
            return
        }
        setState("error")
    }

    private fun drop(why: String) {
        gen++
        heldTask?.cancel(false)
        heldTask = null
        held = JSONArray()
        ws?.close()
        ws = null
        sealer = null
        opener = null
        for ((id, cb) in waiting) { waiting.remove(id); cb(JSONObject().put("ok", false).put("error", "closed")) }
    }

    private fun setState(s: String) {
        state = s
        publish()
    }
    private fun publish() = emit("linkState", statusJson())

    private fun statusJson(): JSONObject = JSONObject()
        .put("state", state)
        .put("pc", pc ?: JSONObject.NULL)
        .put("level", level)
        .put("digits", digits ?: JSONObject.NULL)
        .put("error", error ?: JSONObject.NULL)
        .put("saved", if (ready) store.publicList() else JSONArray())
        .put("discovered", LinkDiscovery.list())
}
