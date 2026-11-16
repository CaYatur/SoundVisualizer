/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
package com.cayadev.visualizer.store

/* PROFİL KLASÖRÜNDE YAZILABİLEN ADLAR (docs/android/HOST.md "Profile").

   Sayfa dosyaya adıyla ulaşır, yolla değil. Yalnız bu listedeki adlar kabul
   edilir: ".." ya da bölü çizgisiyle profil klasörünün dışına çıkılamaz.
   Liste masaüstünün ayar düzeniyle aynı (src/main/settings-store.js PARTS):
   settings.json ayarları, scenes.json sahneleri, library.json MilkDrop
   kütüphanesini tutar; settings.v3-backup.json v4 göçünden önceki kopyadır,
   settings.broken.json çözülemeyen bir settings.json'ın üstüne yazılmadan
   önceki kopyası.
   Android çerçevesine bağlı değil, JVM birim testinde denetleniyor. */
object ProfileNames {
    val CONFIG_FILES = listOf("settings.json", "scenes.json", "library.json")
    const val V3_BACKUP = "settings.v3-backup.json"
    const val BROKEN = "settings.broken.json"

    private val ALLOWED = (CONFIG_FILES + V3_BACKUP + BROKEN).toSet()

    fun allowed(name: String): Boolean = name in ALLOWED
}
