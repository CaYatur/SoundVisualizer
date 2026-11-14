/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.hardware.input.InputManager
import android.os.Build
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/* SERBEST YÜZEN PENCERE (docs/android/PLAN.md D3, 0E7). "Diğer uygulamaların
   üzerinde göster" izniyle, telefonda gezinirken görünen pencere. Masaüstündeki
   yüzen pencerenin ayarlarıyla aynı: saydamlık, dokunuş geçirme, konum kilidi.

   Motor (EngineHost'un tek WebView'i) buraya TAŞINIR; ikinci bir motor yok.
   Pencere yalnız gösterir: dokunuşlar WebView'e değil üstteki ince katmana
   gider (sürükle = taşı, iki parmak = boyutlandır).

   Android 12+: dokunuş geçirme açıkken pencere en çok sistemin izin verdiği
   kadar opak olabilir (InputManager.getMaximumObscuringOpacityForTouch, bugün
   0,8); daha opak bir pencerenin altındaki uygulamaya dokunuş gitmez. */
@SuppressLint("StaticFieldLeak") // pencere uygulama bağlamıyla kuruluyor; tek ve uygulama ömürlü
object FloatingWindow {
    private var root: FrameLayout? = null
    private var params: WindowManager.LayoutParams? = null
    var opacity = 1f
        private set
    var clickThrough = false
        private set
    var locked = false

    val isShowing: Boolean get() = root != null

    fun canShow(context: Context): Boolean = Settings.canDrawOverlays(context)

    /** Android 12+'ta dokunuş geçiren pencerenin en yüksek opaklığı; öncesinde sınır yok. */
    fun maxPassThroughOpacity(context: Context): Float =
        if (Build.VERSION.SDK_INT >= 31) context.getSystemService(InputManager::class.java).maximumObscuringOpacityForTouch else 1f

    fun show(context: Context, widthPx: Int, heightPx: Int, opacity: Float, clickThrough: Boolean): Boolean {
        val app = context.applicationContext
        if (!canShow(app)) return false
        val wm = app.getSystemService(WindowManager::class.java)
        if (root == null) {
            val r = FrameLayout(app)
            r.setBackgroundColor(Color.BLACK)
            val p = WindowManager.LayoutParams(
                widthPx, heightPx,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT,
            ).apply {
                gravity = Gravity.TOP or Gravity.START
                x = 32
                y = 160
            }
            wm.addView(r, p)
            root = r
            params = p
            EngineHost.attach(r)
            r.addView(gestureLayer(app, wm), ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        } else {
            EngineHost.attach(root!!)
        }
        apply(app, opacity, clickThrough)
        return true
    }

    fun apply(context: Context, opacity: Float, clickThrough: Boolean) {
        val r = root ?: return
        val p = params ?: return
        this.opacity = opacity.coerceIn(0.2f, 1f)
        this.clickThrough = clickThrough
        p.alpha = if (clickThrough) min(this.opacity, maxPassThroughOpacity(context)) else this.opacity
        p.flags = if (clickThrough) p.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
        else p.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
        context.getSystemService(WindowManager::class.java).updateViewLayout(r, p)
    }

    fun close(context: Context) {
        val r = root ?: return
        EngineHost.detach()
        context.applicationContext.getSystemService(WindowManager::class.java).removeView(r)
        root = null
        params = null
    }

    fun bounds(): IntArray? = params?.let { intArrayOf(it.x, it.y, it.width, it.height) }

    /* Sürükle = taşı, iki parmak = boyutlandır (oran korunur). Konum kilitliyse ikisi de yok. */
    @SuppressLint("ClickableViewAccessibility")
    private fun gestureLayer(context: Context, wm: WindowManager): View {
        val v = View(context)
        var lastX = 0f
        var lastY = 0f
        val scaler = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(d: ScaleGestureDetector): Boolean {
                val p = params ?: return false
                val f = d.scaleFactor
                val w = max(160, (p.width * f).roundToInt())
                p.height = max(90, (p.height * w / p.width.toFloat()).roundToInt())
                p.width = w
                wm.updateViewLayout(root, p)
                return true
            }
        })
        v.setOnTouchListener { _, e ->
            if (locked) return@setOnTouchListener true
            scaler.onTouchEvent(e)
            val p = params ?: return@setOnTouchListener true
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { lastX = e.rawX; lastY = e.rawY }
                MotionEvent.ACTION_MOVE -> if (!scaler.isInProgress && e.pointerCount == 1) {
                    p.x += (e.rawX - lastX).roundToInt()
                    p.y += (e.rawY - lastY).roundToInt()
                    lastX = e.rawX
                    lastY = e.rawY
                    wm.updateViewLayout(root, p)
                }
            }
            true
        }
        return v
    }
}
