/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.bridge

import android.annotation.SuppressLint
import android.content.Context
import android.os.Build
import android.util.Log
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.cayadev.visualizer.BuildConfig
import com.cayadev.visualizer.audio.AudioHub
import com.cayadev.visualizer.web.WebShell
import org.json.JSONObject

/* SAYFA ↔ UYGULAMA KANALI (docs/android/MESSAGES.md).

   Tek dinleyici, adı `SVNative`, yalnız uygulamanın kendi adresine açık: web
   katmanının açtığı yabancı bir sayfa bu nesneyi hiç görmez. Denetim JSON
   metniyle, yığın veri (ses, kodlanmış video) ikili iletiyle akar.

   Uygulamadan sayfaya giden her şey sayfanın İLK iletisinin yanıt
   vekilinden geçer; bu yüzden her sayfa `hello` ile başlar.

   Gereken WebView özellikleri (WEB_MESSAGE_LISTENER, WEB_MESSAGE_ARRAY_BUFFER)
   açılışta denetleniyor: biri yoksa MainActivity sayfayı hiç açmıyor. Bu
   yüzden yanıt vekilinin çağrılarında ayrıca denetim yok. */
@SuppressLint("RequiresFeature")
class Bridge(private val context: Context, private val handler: RequestHandler) {
    private val tag = "SVBridge"

    /** Sayfanın isteği: [op] HOST.md/MESSAGES.md adıyla; yanıt [reply] ile (ana iş parçacığında). */
    fun interface RequestHandler {
        fun handle(op: String, args: JSONObject, reply: Reply)
    }

    /** Bir isteğin yanıtı; bir kez kullanılır. */
    class Reply internal constructor(private val id: Int, private val proxy: JavaScriptReplyProxy) {
        private var sent = false

        fun ok(value: Any? = null) = send(JSONObject().put("t", "res").put("id", id).put("ok", true).put("v", value ?: JSONObject.NULL))

        fun fail(code: String, msg: String = "") =
            send(JSONObject().put("t", "res").put("id", id).put("ok", false).put("err", code).put("msg", msg))

        private fun send(o: JSONObject) {
            if (sent) return
            sent = true
            proxy.postMessage(o.toString())
        }
    }

    /** Son `hello` gönderen sayfanın yanıt vekili; sayfa yeniden yüklenince yenilenir. */
    @Volatile
    var reply: JavaScriptReplyProxy? = null
        private set

    fun install(web: WebView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        WebViewCompat.addWebMessageListener(web, NAME, setOf(WebShell.ORIGIN)) { _, message, _, isMainFrame, replyProxy ->
            if (!isMainFrame) return@addWebMessageListener
            when (message.type) {
                WebMessageCompat.TYPE_STRING -> onText(message.data ?: "", replyProxy)
                WebMessageCompat.TYPE_ARRAY_BUFFER -> onBinary(message.arrayBuffer)
            }
        }
    }

    private fun onText(text: String, proxy: JavaScriptReplyProxy) {
        val msg = try {
            JSONObject(text)
        } catch (e: Exception) {
            Log.w(tag, "çözülemeyen ileti: ${text.take(80)}")
            return
        }
        when (msg.optString("t")) {
            "hello" -> {
                reply = proxy
                // Ses kaynakları artık bu sayfaya yazar
                AudioHub.sink = { bytes -> postBinary(bytes) }
                AudioHub.events = { source, state -> event("audioStatus", JSONObject().put("source", source).put("state", state)) }
                val out = JSONObject()
                    .put("t", "hello")
                    .put("v", Messages.VERSION)
                    .put("app", BuildConfig.VERSION_NAME)
                    .put("sdk", Build.VERSION.SDK_INT)
                    .put("webview", WebShell.webViewVersion(context))
                proxy.postMessage(out.toString())
            }
            "req" -> {
                val r = Reply(msg.optInt("id"), proxy)
                try {
                    handler.handle(msg.optString("op"), msg.optJSONObject("a") ?: JSONObject(), r)
                } catch (e: Exception) {
                    Log.e(tag, "istek hatası: ${msg.optString("op")}", e)
                    r.fail("error", e.javaClass.simpleName)
                }
            }
        }
    }

    private fun onBinary(bytes: ByteArray) {
        val head = Messages.Header.read(bytes)
        if (head == null) {
            Log.w(tag, "geçersiz ikili ileti (${bytes.size} bayt)")
            return
        }
        Log.d(tag, "ikili ileti tür=${head.type} sıra=${head.seq} (${bytes.size} bayt)")
    }

    /** Sayfaya olay (ana iş parçacığında çağrılır). */
    fun event(name: String, value: Any?) {
        val p = reply ?: return
        p.postMessage(JSONObject().put("t", "evt").put("ev", name).put("v", value ?: JSONObject.NULL).toString())
    }

    /** Sayfaya ikili ileti (ses kareleri vb.). Sayfa henüz `hello` demediyse düşer. */
    fun postBinary(bytes: ByteArray): Boolean {
        val p = reply ?: return false
        p.postMessage(bytes)
        return true
    }

    /** Sayfa kapanırken: ses kaynakları artık bu sayfaya yazmaz. */
    fun detach() {
        reply = null
        AudioHub.sink = null
        AudioHub.events = null
    }

    companion object {
        const val NAME = "SVNative"
    }
}
