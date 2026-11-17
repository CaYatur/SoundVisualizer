/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.content.ContextCompat

/* WEBVIEW ÇOK ESKİ (onaylı taslak 12). Görüntü motoru WebView'de çalışıyor; gereken
   özellikler (WEB_MESSAGE_LISTENER, WEB_MESSAGE_ARRAY_BUFFER, DOCUMENT_START_SCRIPT)
   yoksa sayfa hiç kurulamaz. Bu ekran o yüzden YEREL: WebView'e güvenmiyor. Renkler
   CaYaDev temasından (src/shared/ui-themes.js), res/values/colors.xml'de. */
object WebViewUpdateScreen {
    private const val WEBVIEW_PACKAGE = "com.google.android.webview"

    fun show(activity: Activity, version: String, missing: List<String>) {
        val c = { id: Int -> ContextCompat.getColor(activity, id) }
        val dp = { v: Float -> TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, activity.resources.displayMetrics) }
        fun text(s: CharSequence, sp: Float, color: Int, bold: Boolean = false, mono: Boolean = false) = TextView(activity).apply {
            text = s
            setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
            setTextColor(color)
            typeface = if (mono) Typeface.MONOSPACE else Typeface.create(Typeface.DEFAULT, if (bold) Typeface.BOLD else Typeface.NORMAL)
        }
        fun round(fill: Int, radius: Float, stroke: Int? = null) = GradientDrawable().apply {
            setColor(fill)
            cornerRadius = dp(radius)
            if (stroke != null) setStroke(dp(1f).toInt(), stroke)
        }
        fun row(label: String, value: View): LinearLayout = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(48f).toInt()
            addView(text(label, 14f, c(R.color.sv_text)), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(value)
        }
        fun divider() = View(activity).apply { setBackgroundColor(c(R.color.sv_line)) }

        val col = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            val side = dp(28f).toInt()
            setPadding(side, dp(96f).toInt(), side, dp(40f).toInt())
        }
        val icon = ImageView(activity).apply {
            setImageResource(R.mipmap.ic_launcher)
            contentDescription = activity.getString(R.string.app_name)
        }
        col.addView(icon, LinearLayout.LayoutParams(dp(88f).toInt(), dp(88f).toInt()))
        col.addView(text(activity.getString(R.string.webview_update_title), 24f, c(R.color.sv_text), bold = true).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(18f).toInt(), 0, dp(10f).toInt())
        })
        col.addView(text(activity.getString(R.string.webview_update_body), 15f, c(R.color.sv_muted)).apply {
            gravity = Gravity.CENTER
            setLineSpacing(0f, 1.3f)
        })
        val card = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            background = round(c(R.color.sv_card), 18f, c(R.color.sv_line))
            val p = dp(14f).toInt()
            setPadding(p, dp(4f).toInt(), p, dp(4f).toInt())
            addView(row(activity.getString(R.string.webview_update_installed), text(version, 14f, c(R.color.sv_muted), mono = true)))
            addView(divider(), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1f).toInt()))
            addView(row(activity.getString(R.string.webview_update_missing), text(missing.size.toString(), 13f, c(R.color.sv_warn_text), bold = true)))
            addView(divider(), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1f).toInt()))
            addView(text(missing.joinToString("\n"), 12f, c(R.color.sv_muted), mono = true).apply {
                setPadding(0, dp(10f).toInt(), 0, dp(10f).toInt())
                setLineSpacing(0f, 1.4f)
            })
        }
        col.addView(card, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(18f).toInt() })
        col.addView(View(activity), LinearLayout.LayoutParams(1, 0, 1f))
        val store = Button(activity).apply {
            text = activity.getString(R.string.webview_update_store)
            isAllCaps = false
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setTextColor(c(R.color.sv_on_accent))
            background = round(c(R.color.sv_accent), 12f)
            setOnClickListener { openStore(activity) }
        }
        col.addView(store, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52f).toInt()).apply { topMargin = dp(24f).toInt() })
        val again = Button(activity).apply {
            text = activity.getString(R.string.webview_update_reopen)
            isAllCaps = false
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setTextColor(c(R.color.sv_text))
            background = round(c(R.color.sv_bg), 12f)
            // WebView güncellendiyse Activity baştan kurulunca motor açılır
            setOnClickListener { activity.recreate() }
        }
        col.addView(again, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52f).toInt()).apply { topMargin = dp(8f).toInt() })

        val scroll = ScrollView(activity).apply {
            isFillViewport = true
            setBackgroundColor(c(R.color.sv_bg))
            addView(col, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        activity.setContentView(scroll)
    }

    private fun openStore(activity: Activity) {
        val market = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$WEBVIEW_PACKAGE"))
        try {
            activity.startActivity(market)
        } catch (e: ActivityNotFoundException) {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$WEBVIEW_PACKAGE")))
        }
    }
}
