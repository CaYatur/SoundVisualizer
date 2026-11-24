/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.link

import java.io.BufferedInputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/* EN KÜÇÜK WEBSOCKET İSTEMCİSİ (RFC 6455): yerel ağda masaüstünün `/link` yoluna. Kütüphane yok:
   bağlantı, el sıkışma, maskeli gönderim, parçalı ileti birleştirme, ping/pong, kapatma. TLS
   yok; güvenlik uygulama katmanında (LinkCrypto). Çiğ soket Android'in şifresiz trafik
   kuralına takılmaz (o kural HTTP istemcileri içindir). Okuma kendi iş parçacığında; geri
   çağrılar o iş parçacığından gelir. */
class WsClient(
    private val onText: (String) -> Unit,
    private val onBinary: (ByteArray) -> Unit,
    private val onClose: (String) -> Unit,
) {
    private var socket: Socket? = null
    private var out: OutputStream? = null
    @Volatile private var closed = false
    private val rnd = SecureRandom()

    companion object {
        private const val GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        const val MAX_MESSAGE = 16 * 1024 * 1024
    }

    /** Bağlanır ve el sıkışır; hata olursa istisna atar (çağıran ayrı iş parçacığında). */
    fun connect(host: String, port: Int, path: String, timeoutMs: Int) {
        val s = Socket()
        s.tcpNoDelay = true
        s.connect(InetSocketAddress(host, port), timeoutMs)
        s.soTimeout = timeoutMs
        val key = Base64.getEncoder().encodeToString(ByteArray(16).also { rnd.nextBytes(it) })
        val o = s.getOutputStream()
        val hostHeader = if (host.contains(':')) "[$host]:$port" else "$host:$port"
        o.write(("GET $path HTTP/1.1\r\nHost: $hostHeader\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
            "Sec-WebSocket-Key: $key\r\nSec-WebSocket-Version: 13\r\n\r\n").toByteArray(Charsets.US_ASCII))
        o.flush()
        val inp = BufferedInputStream(s.getInputStream())
        val status = readLine(inp)
        val headers = HashMap<String, String>()
        while (true) {
            val l = readLine(inp)
            if (l.isEmpty()) break
            val i = l.indexOf(':')
            if (i > 0) headers[l.substring(0, i).trim().lowercase()] = l.substring(i + 1).trim()
        }
        if (!status.startsWith("HTTP/1.1 101")) { s.close(); throw java.io.IOException("http:" + status.substringAfter(' ').substringBefore(' ')) }
        val want = Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1").digest((key + GUID).toByteArray()))
        if (headers["sec-websocket-accept"] != want) { s.close(); throw java.io.IOException("bad-accept") }
        s.soTimeout = 0
        socket = s
        out = o
        Thread({ readLoop(inp) }, "sv-link-ws").apply { isDaemon = true }.start()
    }

    private fun readLine(inp: InputStream): String {
        val sb = StringBuilder()
        while (true) {
            val c = inp.read()
            if (c < 0) throw java.io.EOFException()
            if (c == '\n'.code) break
            if (c != '\r'.code) sb.append(c.toChar())
            if (sb.length > 8192) throw java.io.IOException("header-too-long")
        }
        return sb.toString()
    }

    private fun readFully(inp: InputStream, n: Int): ByteArray {
        val b = ByteArray(n)
        var off = 0
        while (off < n) {
            val r = inp.read(b, off, n - off)
            if (r < 0) throw java.io.EOFException()
            off += r
        }
        return b
    }

    private fun readLoop(inp: InputStream) {
        var why = "closed"
        try {
            var frag: java.io.ByteArrayOutputStream? = null
            var fragOp = 0
            while (!closed) {
                val h = readFully(inp, 2)
                val fin = (h[0].toInt() and 0x80) != 0
                val op = h[0].toInt() and 0x0f
                val masked = (h[1].toInt() and 0x80) != 0
                var len = (h[1].toInt() and 0x7f).toLong()
                if (len == 126L) { val e = readFully(inp, 2); len = ((e[0].toInt() and 0xff) shl 8 or (e[1].toInt() and 0xff)).toLong() }
                else if (len == 127L) { val e = readFully(inp, 8); len = java.nio.ByteBuffer.wrap(e).long }
                if (len < 0 || len > MAX_MESSAGE) { why = "too-big"; break }
                val mask = if (masked) readFully(inp, 4) else null
                val p = readFully(inp, len.toInt())
                if (mask != null) for (i in p.indices) p[i] = (p[i].toInt() xor mask[i and 3].toInt()).toByte()
                when (op) {
                    0x8 -> { why = "server-close"; break }
                    0x9 -> send(0xA, p)
                    0xA -> {}
                    0x0 -> {
                        val f = frag ?: continue
                        f.write(p)
                        if (f.size() > MAX_MESSAGE) { why = "too-big"; break }
                        if (fin) { deliver(fragOp, f.toByteArray()); frag = null }
                    }
                    0x1, 0x2 -> {
                        if (fin) deliver(op, p) else { frag = java.io.ByteArrayOutputStream().also { it.write(p) }; fragOp = op }
                    }
                }
            }
        } catch (e: Exception) {
            why = if (closed) "closed" else (e.message ?: e.javaClass.simpleName)
        }
        shut()
        onClose(why)
    }

    private fun deliver(op: Int, p: ByteArray) {
        if (op == 0x1) onText(String(p, Charsets.UTF_8)) else onBinary(p)
    }

    @Synchronized private fun send(op: Int, payload: ByteArray): Boolean {
        val o = out ?: return false
        if (closed) return false
        return try {
            val len = payload.size
            val head = java.io.ByteArrayOutputStream()
            head.write(0x80 or op)
            when {
                len < 126 -> head.write(0x80 or len)
                len < 65536 -> { head.write(0x80 or 126); head.write(len ushr 8); head.write(len and 0xff) }
                else -> { head.write(0x80 or 127); head.write(java.nio.ByteBuffer.allocate(8).putLong(len.toLong()).array()) }
            }
            val mask = ByteArray(4).also { rnd.nextBytes(it) }
            head.write(mask)
            val body = ByteArray(len) { (payload[it].toInt() xor mask[it and 3].toInt()).toByte() }
            o.write(head.toByteArray())
            o.write(body)
            o.flush()
            true
        } catch (e: Exception) { shut(); false }
    }

    fun sendText(s: String) = send(0x1, s.toByteArray(Charsets.UTF_8))
    fun sendBinary(b: ByteArray) = send(0x2, b)

    private fun shut() {
        try { socket?.close() } catch (e: Exception) {}
        socket = null
        out = null
    }

    fun close() {
        if (closed) return
        try { send(0x8, ByteArray(0)) } catch (e: Exception) {}
        closed = true
        shut()
    }
}
