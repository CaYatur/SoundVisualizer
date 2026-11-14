/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

/* SINAMA YARDIMCISI: başka bir uygulama gibi ses çalar (0E5). Uygulamanın
   sistem sesini yakalama yolunu emülatörde ölçmek için; yayımlanmaz.
   `allow` kipinde yakalamaya izin verir, `deny` kipinde ALLOW_CAPTURE_BY_NONE
   ile engeller (sesini paylaşmayan uygulama). */
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.cayadev.visualizer.tonegen"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.cayadev.visualizer.tonegen"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "1"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        // Sınama yardımcısı: yedekleme kuralları anlamsız
        disable += setOf("AndroidGradlePluginVersion", "GradleDependency", "NewerVersionAvailable", "DataExtractionRules")
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}
