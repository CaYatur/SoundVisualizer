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
class Bridge(private val context: Context) {
    private val tag = "SVBridge"

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
                val out = JSONObject()
                    .put("t", "hello")
                    .put("v", Messages.VERSION)
                    .put("app", BuildConfig.VERSION_NAME)
                    .put("sdk", Build.VERSION.SDK_INT)
                    .put("webview", WebShell.webViewVersion(context))
                proxy.postMessage(out.toString())
            }
            "req" -> {
                // Henüz işlem yok (0E): bilinmeyen işlem yanıtı
                val out = JSONObject()
                    .put("t", "res")
                    .put("id", msg.optInt("id"))
                    .put("ok", false)
                    .put("err", "unknown-op")
                    .put("msg", msg.optString("op"))
                proxy.postMessage(out.toString())
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

    /** Sayfaya ikili ileti (ses kareleri vb.). Sayfa henüz `hello` demediyse düşer. */
    fun postBinary(bytes: ByteArray): Boolean {
        val p = reply ?: return false
        p.postMessage(bytes)
        return true
    }

    companion object {
        const val NAME = "SVNative"
    }
}
