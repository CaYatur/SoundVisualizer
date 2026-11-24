/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.link

import android.content.Context
import android.net.wifi.WifiManager
import org.json.JSONArray
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress

/* AĞDAKİ BİLGİSAYARLAR (docs/PHONE-LINK.md, Discovery). Masaüstü iki saniyede bir UDP 47821'e
   duyuru yollar; burada yalnız "PC'ye Bağlan" sayfası açıkken dinlenir. Android yayın paketlerini
   ancak MulticastLock tutulurken uygulamaya verir (pil için kilit yalnız o sırada). Duyuruda gizli
   bir şey yok; eşleşme yine QR ya da kod ister. */
object LinkDiscovery {
    const val PORT = 47821
    private const val STALE_MS = 8000L
    class Seen(val id: String, val name: String, val address: String, val port: Int, var at: Long)
    private val seen = LinkedHashMap<String, Seen>()
    private var socket: DatagramSocket? = null
    private var lock: WifiManager.MulticastLock? = null
    @Volatile private var onChange: () -> Unit = {}

    /** Duyuruyu çözer (masaüstünün link-discovery.js parse'ı ile aynı kurallar). */
    fun parse(bytes: ByteArray, len: Int): Triple<String, String, Int>? {
        if (len <= 0 || len > 512) return null
        val o = try { JSONObject(String(bytes, 0, len, Charsets.UTF_8)) } catch (e: Exception) { return null }
        if (o.optString("sv") != "sv-link" || o.optInt("v") != 1) return null
        val id = o.optString("id").take(32)
        val port = o.optInt("port")
        if (id.isEmpty() || port !in 1..65535) return null
        return Triple(id, o.optString("name").take(64), port)
    }

    @Synchronized fun start(ctx: Context, changed: () -> Unit) {
        onChange = changed
        if (socket != null) return
        val wm = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        lock = wm?.createMulticastLock("sv-link-discovery")?.apply { setReferenceCounted(false); acquire() }
        val s = try { DatagramSocket(null).apply { reuseAddress = true; broadcast = true; bind(InetSocketAddress(PORT)) } } catch (e: Exception) { stop(); return }
        socket = s
        Thread({
            val buf = ByteArray(1024)
            while (socket === s) {
                try {
                    val pkt = DatagramPacket(buf, buf.size)
                    s.receive(pkt)
                    val r = parse(pkt.data, pkt.length) ?: continue
                    val addr = pkt.address?.hostAddress ?: continue
                    var fresh: Boolean
                    synchronized(this) {
                        val old = seen[r.first]
                        fresh = old == null || old.address != addr || old.port != r.third
                        seen[r.first] = Seen(r.first, r.second, addr, r.third, System.currentTimeMillis())
                    }
                    if (fresh) onChange()
                } catch (e: Exception) { if (socket !== s) break }
            }
        }, "sv-link-discovery").apply { isDaemon = true }.start()
    }

    @Synchronized fun stop() {
        try { socket?.close() } catch (e: Exception) {}
        socket = null
        try { lock?.release() } catch (e: Exception) {}
        lock = null
    }

    @Synchronized fun list(): JSONArray {
        val now = System.currentTimeMillis()
        val a = JSONArray()
        for (s in seen.values) if (now - s.at < STALE_MS) a.put(JSONObject().put("id", s.id).put("name", s.name).put("address", s.address).put("port", s.port))
        return a
    }

    /** Kayıtlı bilgisayarın ağdaki son adresi (IP değiştiyse). */
    @Synchronized fun addressOf(id: String): Pair<String, Int>? {
        val s = seen[id] ?: return null
        return if (System.currentTimeMillis() - s.at < STALE_MS * 4) Pair(s.address, s.port) else null
    }
}
