/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

/* WEB TARAFI DERLEMEDE KOPYALANIR (docs/android/PLAN.md §2). Motor ve mobil
   arayüz deponun src/ klasöründe kalıyor; dosya taşınmıyor, böylece PC'nin
   yolları ve testleri olduğu gibi kalıyor. Kopya derleme klasöründe üretiliyor
   ve APK'nın assets/web/ altına giriyor; git'e hiçbir şey girmiyor. Yerleşim
   depodakinin aynısı (assets/web/src/visualizer, assets/web/src/shared, …),
   çünkü sayfalar birbirine göreli yollarla (../shared/x.js) bağlı. */
abstract class CopyWebAssets : DefaultTask() {
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val webFiles: ConfigurableFileCollection

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @get:Inject
    abstract val fs: FileSystemOperations

    @TaskAction
    fun copy() {
        fs.sync {
            from(webFiles)
            into(outputDir.dir("web"))
        }
    }
}

val repoRoot: File = rootProject.projectDir.parentFile

val copyWebAssets = tasks.register<CopyWebAssets>("copyWebAssets") {
    webFiles.from(
        fileTree(repoRoot) {
            include(
                "src/visualizer/**",
                "src/shared/**",
                "src/exporter/**",
                "src/mobile/**",
                "assets/**",
            )
            // Paketleme ya da ölçümden kalan üretilmiş tek paketler (bundle-pages.js)
            exclude("**/*.gen.js", "**/*.gen.html", "**/.DS_Store")
        },
    )
    outputDir.set(layout.buildDirectory.dir("generated/webAssets"))
}

android {
    namespace = "com.cayadev.visualizer"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.cayadev.visualizer"
        // Android 10: sistem sesini yakalamanın (AudioPlaybackCapture) alt sınırı
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0-dev"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    lint {
        abortOnError = true
        /* Sürümler bilerek sabit (gradle/libs.versions.toml): AGP 8.13, kurulu
           Android Studio'nun açabildiği son sürüm; androidx.core 1.19 AGP 9
           istiyor. "Daha yenisi var" uyarıları bu yüzden kapalı. */
        disable += setOf("AndroidGradlePluginVersion", "GradleDependency", "NewerVersionAvailable")
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(copyWebAssets, CopyWebAssets::outputDir)
    }
}

dependencies {
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity)
    testImplementation(libs.junit)
}
