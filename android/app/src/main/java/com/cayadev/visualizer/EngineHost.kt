/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer

import android.annotation.SuppressLint
import android.content.Context
import android.util.Log
import android.view.ViewGroup
import android.webkit.WebView
import com.cayadev.visualizer.bridge.Bridge
import com.cayadev.visualizer.bridge.Messages
import com.cayadev.visualizer.export.ExportHub
import com.cayadev.visualizer.web.WebShell
import java.lang.ref.WeakReference

/* TEK MOTORUN SAHİBİ (docs/android/PLAN.md D2, 0E7).

   WebView (yani motorun kendisi) Activity'ye değil uygulamaya ait: uygulama
   bağlamıyla kurulur ve bir ekrandan ötekine TAŞINIR — tam ekran Activity,
   yüzen pencere. Böylece sistem Activity'yi kapatsa bile (bazı üreticiler
   arka plandaki uygulamada bunu sık yapıyor) yüzen pencere çizmeye devam eder;
   uygulamaya dönülünce aynı motor kaldığı yerden sürer, sahne yeniden kurulmaz. */
@SuppressLint("StaticFieldLeak") // bilerek uygulama ömürlü; WebView uygulama bağlamıyla kuruluyor, Activity tutulmuyor
object EngineHost {
    private const val TAG = "SVEngine"

    var web: WebView? = null
        private set
    var bridge: Bridge? = null
        private set
    private var page: String = ""

    /** İzin ve sistem onayı isteyen işler için şu anki Activity (yoksa null). */
    private var activityRef: WeakReference<MainActivity>? = null
    val activity: MainActivity? get() = activityRef?.get()

    lateinit var exportHub: ExportHub
        private set

    fun register(a: MainActivity) { activityRef = WeakReference(a) }

    fun unregister(a: MainActivity) { if (activityRef?.get() === a) activityRef = null }

    /** Motoru kurar (yoksa) ve döndürür. İstekler [handler]'a gider. */
    fun ensure(context: Context, page: String, debug: Boolean, handler: Bridge.RequestHandler): WebView {
        web?.let { if (this.page == page) return it }
        destroy()
        val app = context.applicationContext
        if (!::exportHub.isInitialized) exportHub = ExportHub(app) { name, v -> bridge?.event(name, v) }
        val w = WebShell.create(app, debug, page) { dead -> rebuild(app, dead, debug, handler) }
        val b = Bridge(app, handler) { head, bytes ->
            if (head.type == Messages.TYPE_VIDEO_FRAME) exportHub.frame(bytes)
        }
        b.install(w)
        w.loadUrl(WebShell.pageUrl(page))
        web = w
        bridge = b
        this.page = page
        Log.i(TAG, "motor kuruldu: $page")
        return w
    }

    /** Motoru [parent]'a taşır (öncekinden çıkararak). WebGL bağlamı korunur (0E7'de ölçüldü). */
    fun attach(parent: ViewGroup) {
        val w = web ?: return
        val old = w.parent as? ViewGroup
        if (old === parent) return
        old?.removeView(w)
        // En alta: yüzen pencerede üstte dokunuş katmanı var
        parent.addView(w, 0, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    fun detach() {
        val w = web ?: return
        (w.parent as? ViewGroup)?.removeView(w)
    }

    private fun rebuild(context: Context, dead: WebView, debug: Boolean, handler: Bridge.RequestHandler) {
        val parent = dead.parent as? ViewGroup
        bridge?.detach()
        parent?.removeView(dead)
        dead.destroy()
        web = null
        bridge = null
        val p = page
        page = ""
        ensure(context, p, debug, handler)
        parent?.let { attach(it) }
    }

    fun destroy() {
        bridge?.detach()
        web?.let {
            (it.parent as? ViewGroup)?.removeView(it)
            it.destroy()
        }
        web = null
        bridge = null
        page = ""
    }
}
