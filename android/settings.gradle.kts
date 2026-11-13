/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */

/* Android uygulaması (#1054). Web tarafı (motor ve mobil arayüz) deponun
   kendi src/ klasöründen derlemede kopyalanır; burada yalnız Kotlin kabuğu
   var. Plan ve kararlar: docs/android/PLAN.md. */
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "SoundVisualizer"
include(":app")
