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

/* MOD KÜÇÜK RESİMLERİNİN DİZİNİ (android/tools/thumb-index.js): resimlerin adı
   içeriğe bağlı bir anahtar; eşleme masaüstünün kendi koduyla derlemede çıkarılıyor
   (Node gerekir). Resimler eskiyse derleme durur. */
abstract class ThumbIndex : DefaultTask() {
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val sources: ConfigurableFileCollection

    @get:InputFile
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val script: RegularFileProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @get:Inject
    abstract val exec: ExecOperations

    @TaskAction
    fun run() {
        val out = outputDir.file("assets/mode-thumbs/index.json").get().asFile
        exec.exec { commandLine("node", script.get().asFile.absolutePath, out.absolutePath) }
    }
}

val repoRoot: File = rootProject.projectDir.parentFile

/* UYGULAMANIN SÜRÜMÜ (android/version.properties, PLAN K9): masaüstünden ayrı çizgi.
   versionCode sürümden: büyük*10000 + küçük*100 + yama (1.2.3 → 10203), her yayında artar. */
val appVersion: String = Regex("(?m)^version=(\\d+\\.\\d+\\.\\d+)\\s*$")
    .find(File(rootProject.projectDir, "version.properties").readText())?.groupValues?.get(1)
    ?: error("android/version.properties: version=X.Y.Z yok")
val appVersionCode: Int = appVersion.split('.').map { it.toInt() }.let { (a, b, c) -> a * 10000 + b * 100 + c }

val thumbIndex = tasks.register<ThumbIndex>("thumbIndex") {
    sources.from(
        fileTree(repoRoot) {
            include("src/**", "scripts/gen-mode-thumbs.js", "assets/mode-thumbs/**")
            exclude("**/*.gen.js", "**/*.gen.html", "**/.DS_Store")
        },
    )
    script.set(File(repoRoot, "android/tools/thumb-index.js"))
    outputDir.set(layout.buildDirectory.dir("generated/thumbIndex"))
}

val copyWebAssets = tasks.register<CopyWebAssets>("copyWebAssets") {
    webFiles.from(
        fileTree(repoRoot) {
            include(
                "src/visualizer/**",
                "src/shared/**",
                "src/exporter/**",
                "src/mobile/**",
                // Arayüzün yazı tipi (Geist), masaüstü paneliyle aynı dosyalar
                "src/admin/fonts/**",
                // Otomasyon hedef kataloğu (zaman çizelgesi): masaüstüyle aynı dosya
                "src/admin/modulation-panel.js",
                "assets/**",
            )
            // Paketleme ya da ölçümden kalan üretilmiş tek paketler (bundle-pages.js)
            exclude("**/*.gen.js", "**/*.gen.html", "**/.DS_Store")
        },
        // Şablon ve MilkDrop önizlemeleri (android/tools/previews.js): APK'da web/previews/
        fileTree(File(repoRoot, "android")) { include("previews/**") },
        // assets/mode-thumbs/index.json
        thumbIndex.flatMap { it.outputDir },
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
        versionCode = appVersionCode
        versionName = appVersion
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
        // Geliştirme sürümü ayırt edilsin (Hakkında: "1.0.0-dev")
        debug {
            versionNameSuffix = "-dev"
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
    // Uygulama içi çalar (PLAN 2.3, K11): şarkı çözme, oynatma ve medya bildirimi
    implementation(libs.androidx.media3.exoplayer)
    implementation(libs.androidx.media3.session)
    // PC bağlantısı: eşleşme QR'ını çözme (link/QrDecode.kt)
    implementation(libs.zxing.core)
    testImplementation(libs.junit)
    // Birim testlerinde gerçek org.json (Android'in kendisi testte boş taslak)
    testImplementation("org.json:json:20240303")
}
