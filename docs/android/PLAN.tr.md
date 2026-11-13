# Android sürümü — iş planı

English: [PLAN.md](PLAN.md)

Durum: 14.11.2026'da onaylandı. İş `dev/android` dalında yürüyor. Sözleşmeler: [HOST.md](HOST.md) (`window.api`'nin
Android karşılığı) ve [MESSAGES.md](MESSAGES.md) (Kotlin ile sayfa arasındaki ikili kanal). İki dil arasında fark
olursa İngilizce sürüm esastır.

---

## 0. Karar defteri

| # | Karar | Gerekçe |
|---|---|---|
| K1 | **Kotlin kabuğu + Android System WebView + androidx.webkit.** Capacitor kullanılmaz. | Motor PC'deki gibi Chromium'da çalışır. Gereken yerel özelliklerin resmi Capacitor eklentisi yok. Ham ses ve video parçaları ikili kanaldan (ArrayBuffer) geçer. Üçüncü taraf çatıya bağlı kalınmaz. |
| K2 | **Tek WebView**: düzenleyici, önizleme, tam ekran ve PiP aynı motoru kullanır. **Dışa aktarım ayrı WebView'de** çalışır. | Tek motor yarı GPU ve yarı bellek demek. Dışa aktarım rastgele sayıyı ve saati sabitliyor (#905), canlı sayfayla bir arada olamaz. |
| K3 | **PiP ve serbest yüzen pencere ilk sürümde birlikte.** Serbest pencere PC'deki yüzen pencere ayarlarını kullanır (`floating.opacity/clickThrough/aspectLock/locked`). | Kullanıcı kararı (14.11). |
| K4 | **Ses dört kaynaktan gelir, çözümleme tek**: Android yalnız ham ses (PCM) yollar, FFT JavaScript'te PC ile bayt bayt aynı kodla hesaplanır. | Telefondaki ve PC'deki bantlar aynı sayıları verir; ikinci bir FFT kopyası olmaz. |
| K5 | **Dışa aktarım**: `exporter.js` değişmeden çalışır. Android'in `sendFrame` karşılığı I420 kareyi WebCodecs `VideoFrame`'e çevirip kodlar, parçalar Android'in MediaMuxer'ına gider. Ses izi AAC ise yeniden kodlanmadan geçirilir, değilse Android'in AAC kodlayıcısı kullanılır. | İlk yol PC koduna hiç dokunmaz. Kareyi doğrudan canvas'tan almak ölçümle sonradan eklenir. |
| K6 | **VJ araçlarından yalnız Otomatik VJ ve BPM.** Canlı sayfası/T-bar, Clip Deck, modülasyon düzenleyicisi ve WLED yok. | Kullanıcı kararı (14.11). PC'de modülasyonla yapılmış sahneler telefonda da aynı görünür; motor modülasyonu uyguluyor. |
| K7 | **Dil**: `i18n.js` zaten "cihaz Türkçe ise Türkçe, değilse İngilizce" çalışıyor. Mobil metinler aynı dosyaya, aynı eşlik testleriyle eklenir. | Ayrı bir çeviri sistemi açılmaz. |
| K8 | **Tasarım**: `ui-themes.js` temaları, `icons.js` ve `src/admin/fonts`. **Önce taslak, onay, sonra kod.** | Bellekteki tasarım kuralı. |
| K9 | **Sürüm (öneri)**: Android kendi sürüm çizgisiyle `1.0.0`'dan başlar, etiketi `android-v1.0.0`. APK GitHub Release dosyası olarak yüklenir (SHA-256 ile); git'e ikili eklenmez. | PC sürümleri Android'i beklemez, Android de PC'yi. |
| K10 | **Android sürümleri**: en az Android 10 (API 29, ses yakalamanın alt sınırı); hedef ve derleme API 36. Android 17 (API 37) emülatörde denenir. | Play 31.08.2026'dan beri API 36 istiyor. |
| K11 | **Bağımlılıklar**: yalnız Kotlin ve Google'ın androidx kütüphaneleri (webkit, core, activity, media3-exoplayer, media3-session). Gradle wrapper ve sürümler sabitlenir. CI'da GitHub'ın kendi eylemleri ve `./gradlew` kullanılır. | Bağımsızlık şartı. |
| K12 | **İmza**: geliştirme boyunca test imzası. İlk APK'dan önce kalıcı anahtarı kullanıcı oluşturur (parola kullanıcıda, depo dışında, yedekli). Play'e geçişte aynı anahtar Play'e yüklenir. | GitHub ve Play kurulumları aynı imzayı taşır, kullanıcı kanallar arasında sorunsuz güncellenir. |
| K13 | **Güncelleme**: "yeni sürüm var" bildirimi ve sürüm sayfası. Uygulama kendini kurmaz. | Play kuralı. |
| K14 | **Dal ve PR**: `dev/android` (main'den) **yalnız ekleme** yapar (`android/`, `src/mobile/`, `docs/android/`). Her iş ayrı PR. Commit ve PR İngilizce, "For #N", atıf satırı yok. Android CI zorunlu 5 denetime eklenmez. Yayın ayrı onayla. | Mevcut kurallar. |
| K14b | **PC'ye dokunan işler önce main'e**: §2'deki maddeler (FFT ortak modülü, paket hariç tutma, `.gitignore`, güncelleyici bekçisi) ayrı ayrı, PC kapılarından geçerek doğrudan main'e birleşir. Sonra main `dev/android`'e alınır. | PC değişiklikleri PC'nin kendi test ve yayın akışında sınanır. Test sayısı çakışmaları büyük ölçüde kalkar. Android'in sonunda main'e birleşmesi PC için hiçbir şey değiştirmez. |
| K15 | **Fiziksel cihaz yok**: iş emülatörle başlar. Performansla ilgili kesin kararlar ve **1.0 yayını fiziksel telefon ölçümüne bağlıdır.** | Emülatörün GPU'su telefonu temsil etmez. |

---

## 1. Telefon olmadan neyi ölçebiliriz

Makine: Android Studio, SDK 36, build-tools 36.1, NDK 29, emülatör ve WHPX hazır. GPU: RTX 5070 Laptop. C: diskinde 534 GB boş.

| Konu | Emülatör | Fiziksel telefon |
|---|---|---|
| WebGL2 çalışıyor mu, shader'lar derleniyor mu | ✔ işlev | sınırlar ve sürücü hataları |
| WebGL bağlam sınırı | ✔ büyük olasılıkla WebView'in kendi kuralı; ölçülür | doğrulama |
| fps, ısınma, pil | ✘ | **şart** |
| Ses yakalama API'si, onay penceresi, ön plan servisi | ✔ | doğrulama |
| Gerçek uygulamalar sesini paylaşıyor mu (Spotify, YouTube Music…) | ◐ Google Play'li kalıpta siz Google hesabıyla oturum açarsanız | ✔ |
| Visualizer (çıkış karışımı) | ◐ emülatörün yazılım ses katmanında belirsiz | **şart** |
| Mikrofon | ✔ bilgisayarın mikrofonu | ✔ |
| WebCodecs ile H.264 ve MP4 | ✔ işlev (yazılım kodlayıcı) | hız ve donanım kodlayıcı |
| PiP, serbest pencere, WebView'i pencereler arası taşıma | ✔ işlev | MIUI izinleri |
| MIUI'ye özgü izinler ve pil tasarrufu | ✘ | **şart** |
| Android 13–17 davranışları | ✔ (telefon Android 12) | — |

**Emülatör kalıpları (onaylandı):** x86_64 "Google APIs" kalıpları. "Google Play" kalıpları ayrı bir Google lisans sözleşmesinin kabulünü istiyor. O sözleşmeyi siz kabul ederseniz bu kalıplar da kurulur: WebView Play'den güncellenir ve gerçek uygulamalar denenebilir.

| API | Neden |
|---|---|
| 29 (Android 10) | Alt sınır |
| 31 (Android 12) | Telefonunuzun sürümü |
| 34 (Android 14) | Ses yakalama onayının her oturumda sorulması |
| 36 (Android 16) | Hedef sürüm |
| 37 (Android 17) | Arka plan ses kuralları; kalıp varsa |

Kalıp başına yaklaşık 1.5 GB, toplam yaklaşık 7.5 GB.

---

## 2. PC tarafının korunması

**Testlerde ölçülen durum:**
- `copyright-headers`: `git ls-files src scripts native` tarıyor. `src/mobile` kendiliğinden girer. `android/` girmez, `.kt/.kts/.xml` için ayrı test yazılır.
- `source-parses`: `src` altındaki her `.js` dosyasını ayrıştırıyor. Mobil JS de kapsanır.
- `ui-themes`: CSS dosyalarını **elle listeliyor** (`admin.css`, `studio.css`). Mobil CSS listeye eklenmezse renk kuralı uygulanmaz. **Mutlaka eklenecek.**
- `external-review`: `src` altında ikili dosya istemiyor. İkon ve yazı tipleri derlemede kopyalanır, `src/mobile`'a konmaz.
- `scripts/test.js` README, README.tr ve ROADMAP'teki test sayısını denetliyor. `dev/android`'de test ekleyen her PR sayıları da günceller. main içeri alınınca sayı yeniden hesaplanır (bilinen sürtünme).

**PC dosyalarına dokunan değişiklikler (bilinen tam liste):** Her biri ayrı PR ve PC kapılarından geçer: `npm test`, öz test, gerekiyorsa golden A/B (107 sahne aynı).
1. FFT ve ses karesi üretimini ortak modüle çıkarma (bugün `loopback-helper.js` ile `exporter.js`'te iki kopya). Ek kapı: kareler önce/sonra bayt bayt aynı (test).
2. `package.json`: electron-builder'a `!src/mobile/**` ve `android:*` betikleri. `platform-packaging` testine "mobil pakete girmez" denetimi.
3. `.gitignore`: `android/**/build`, `.gradle`, `local.properties`, kopyalanan web varlıkları.
4. Yeni `.github/workflows/android.yml`: yalnız `android/**` ve `src/mobile/**` değişince koşar, zorunlu değil. Mevcut iş akışlarına dokunulmaz.
5. (Ölçüme bağlı, isteğe bağlı) `exporter.js`'te kareyi canvas'tan doğrudan `VideoFrame` olarak alma.
6. **Sürümler sayfası çakışması.**
   - **Sorun:** PC güncelleyicisi (`src/main/updater.js`) yalnız `releases/latest`'i okuyor. README'deki indirme düğmeleri ve rozet de `releases/latest`'e gidiyor. Bir Android sürümü "Latest" olursa PC kullanıcıları indirme düğmesinde APK sayfasına düşer ve PC güncelleyicisi gerçek PC güncellemelerini göremez.
   - Kural: Android sürümleri **her zaman `--latest=false`** ile yayımlanır; "Latest" hep PC'de kalır.
   - PC güncelleyicisine küçük bir bekçi: `v` ile başlamayan etiketler yok sayılır. Testle kanıtlanır; PC PR'ı.
   - Android güncelleyicisi `releases/latest`'i hiç kullanmaz; sürüm listesini okuyup `android-v*` etiketlerini süzer.
   - `release-assets.js` Android sürümünü PC sürümü sanmaz (etiket deseni denetimi).

---

## 3. Kod öncesi yazılacak sözleşmeler

1. **`docs/android/HOST.md`: `window.api`'nin Android karşılığı.**
   - Görselleştirici: `preload-visualizer.js`'teki yaklaşık 50 yöntem; her biri için "gerçek / boş / yok" tablosu (ör. `sendOscHit`, `claimCamRelay` telefonda boş).
   - Dışa aktarım: `onJob`, `ready`, `sendFrame`, `progress`, `finish`, `cancelled`, `error`, `analysis`, `cancelRequested`, `milkdropTextures/Texture`.
   - Mobil kabuk: `preload-admin.js`'in alt kümesi.
   - **Sözleşme testi:** motorun çağırdığı her `window.api` yöntemi `android-host.js`'te tanımlı mı (statik tarama).
2. **`docs/android/MESSAGES.md`: Android ↔ JS ikili ileti biçimi.**
   - Başlık: tür, sürüm, uzunluk.
   - Türler: PCM (biçim, kanal, örnekleme hızı, zaman damgası), kaynak durumu, dışa aktarım parçası (anahtar kare, zaman), dosya işleri.
   - Sabitler iki tarafta aynı. Çapraz test: JS'in ürettiği örnek baytları Kotlin birim testi çözer.
3. **Kayıt düzeni:** `filesDir/settings.json` PC biçiminde, ortak `migrate-v4`/`schema` ile denetlenir; presetler, kütüphaneler ve dokular PC düzeninde. Yazım atomik (geçici dosya, sonra yeniden adlandırma). İçe/dışa aktarım Android dosya seçiciyle.

---

## 4. İş listesi

Her faz "bitti ölçütü" ile biter. Fazlar arasında onayınız alınır.

### A — Hazırlık (onaydan hemen sonra)
- A1 `dev/android` dalı.
- A2 GitHub: ana issue ve "Android 1.0" kilometre taşı (bilinen hesap düzeniyle).
- A3 Emülatör kalıpları ve sanal cihazlar (API 29/31/34/36/37).
- A4 HOST.md ve MESSAGES.md taslakları.
- **Bitti:** emülatör açılıyor, sözleşmeler yazılı.

### 0E — Emülatörde uygulanabilirlik (arayüz yok)
- 0E1 `android/` Gradle projesi: tek Activity ve WebView. Sayfalar güvenli yerel adresten (`https://appassets.androidplatform.net`, WebViewAssetLoader). Test sürümünde WebView hata ayıklama açık.
- 0E2 `scripts/android-assets.js`: `src/visualizer`, `src/shared` ve `assets`'i APK'ya kopyalar; `bundle-pages` ile tek paket.
- 0E3 `android-host.js` ilk hâli: değiştirilmemiş görselleştirici sayfası demo sesle açılır.
- 0E4 Otomatik yoklama: `adb forward` ve WebView'in DevTools ucu, mevcut CDP araçlarıyla. GL yetenekleri ve bağlam sınırı ölçülür.
  - **Golden sahneler:** PC'deki 107 sahne önce üç gruba ayrılır:
    - **çizmesi gereken;**
    - **eksik varlık isteyen:** yerel medya yolu, MilkDrop korpusu/dokuları depoda değil;
    - **yalnız masaüstü kaynak:** ekran yakalama, Spout, web katmanı vb.
  - "Hatasız ve siyah değil" denetimi yalnız ilk gruba uygulanır. Yoksa Android'le ilgisi olmayan sebeplerle siyah kalan sahneler sahte hata verir.
- 0E5 Ses: sistem sesi yakalama (MediaProjection ve ön plan servisi) → PCM → JS FFT → motor; Visualizer; mikrofon; uygulama içi çalar (media3).
- 0E6 WebCodecs desteği tablosu (H.264/HEVC/AV1, AAC). 10 saniyelik deneme dışa aktarım, MP4'ün oynatıldığı doğrulanır.
- 0E7 PiP ve serbest pencere. WebView'i yüzen pencereye WebGL bağlamını kaybetmeden taşıma denemesi.
  - **Asıl sınav:** yüzen pencere açıkken sistemin Activity'yi kapatması; MIUI bunu sık yapıyor. WebView Activity'den bağımsız bir bağlamla kurulur (uygulama bağlamı ya da `MutableContextWrapper`), böylece Activity giderken yaşamaya devam eder.
  - **Geçme ölçütü:** Geliştirici seçeneklerinde "Etkinlikleri tutma" açıkken yüzen pencere çizmeye devam ediyor; uygulamaya dönülünce aynı motor kaldığı yerden sürüyor.
- **Bitti:** `docs/android/PHASE0.md` (ölçüm raporu ve kararlara etkisi) ile telefonda tekrarlanacaklar listesi (0P).

### 1 — Altyapı
- 1.1 FFT'yi ortak modüle çıkarma (PC PR'ı, kapılar).
- 1.2 electron-builder hariç tutma, `.gitignore`, npm betikleri, koruma testlerinin genişletilmesi (mobil CSS, Kotlin başlıkları).
- 1.3 `android.yml`: `assembleDebug`, Kotlin birim testleri, lint; yol süzgeçli.
- 1.4 `versionName`/`versionCode`; `release-assets.js`'in APK'yı tanıması (yayın fazında).
- **Bitti:** PC kapıları yeşil, Android CI yeşil, PC paketinde mobil dosya yok.

### 2 — Android tarafı
- 2.1 `android-host.js`'in tamamı ve sözleşme testi.
- 2.2 Kayıt (ayarlar, presetler, kütüphaneler), atomik yazım, PC dosyalarını içe alma.
- 2.3 Ses kaynakları ve izin akışları. Sessizlik algılanınca Visualizer ya da mikrofon önerilir. Ön plan servis türleri: `mediaProjection`, `mediaPlayback`, `microphone`. Bildirim.
- 2.4 Yaşam döngüsü:
  - Ekran döndürmede WebView yeniden kurulmaz.
  - Bellek baskısı (`onTrimMemory`) karşılanır.
  - **WebView çökmesinde (`onRenderProcessGone`) sayfa yeniden kurulur, son ayar korunur.**
  - WebGL bağlamı kaybolursa sahne yeniden kurulur.
- 2.5 Güvenlik:
  - Köprü yalnız kendi adresimize açık; web katmanının açtığı dış sayfalar köprüye erişemez.
  - Dosya erişimi ve karışık içerik kapalı.
  - Gezinme bekçisi (PC'deki `nav-guard` karşılığı).
- **Bitti:** emülatörde dört ses kaynağı motoru sürüyor, uygulama çökmeye ve döndürmeye dayanıklı.

### 3 — Mobil arayüz
- 3.1 Bilgi mimarisi ve **taslaklar**: temalar, açık/koyu, TR/EN, 360 dp telefon ve tablet. **Onayınız.**
- 3.2 Kabuk: alt gezinme, önizleme alanı, alttan açılan ayar sayfaları.
- 3.3 Sahne düzenleme:
  - Katman listesi: sırala, gizle, opaklık, karışım.
  - Katman ekleme: küçük resimli mod seçici.
  - Parametreler: `schema.js`'ten üretilen kontroller.
  - Efekt zinciri.
- 3.4 Tam ekran, PiP, serbest pencere:
  - Saydamlık, dokunuş geçirme (**Android 12+: geçirme açıkken görünürlük en fazla %80, değer sistemden okunur**), oran kilidi, konum kilidi.
  - MIUI izin rehberi.
- 3.5 Ses kaynağı ekranı; Otomatik VJ ve BPM.
- 3.6 Ayarlar: tema, dil, performans (çizim ölçeği, kare sınırı, düşük güç), hakkında ve lisanslar.
- 3.7 Erişilebilirlik: dokunma hedefi en az 48 dp, ekran okuyucu etiketleri.
- **Bitti:** taslakla birebir; TR/EN eşliği ve tema testleri yeşil.

### 4 — İçerik
- MilkDrop: tarayıcı, arama, favoriler, `.milk` içe aktarma, dokular.
- Studio shader presetleri.
- Galeri (fotoğraf, video) ve kamera katmanları.
- Metin ve şarkı sözü, logo, şablonlar.

### 5 — Timeline ve dışa aktarım
- Ortak timeline modelinin (`timeline*.js`) üstüne dokunmatik düzenleyici.
- Şarkı içe alma.
- Dışa aktarım ekranı: çözünürlük, fps, kodek, kalite, ilerleme, iptal.
- Galeriye kaydetme ve paylaşma.

### 6 — Telefonda doğrulama ve cilalama (**fiziksel cihaz şart**)
- 0P ölçümleri: fps, ısınma, pil, Visualizer, gerçek uygulamalar, MIUI.
- Varsayılan performans ayarları ölçüme göre belirlenir.
- Kalıcı imza anahtarı (sizde), sürüm notları. **Yayın ayrı onayla.**

### 7 — PC ↔ Android bağlantısı
Yalnız siz isteyince.

---

## 5. Riskler

| # | Risk | Önlem |
|---|---|---|
| R1 | WebGL bağlam sınırı dar çıkar | Önce ölçüm. Sonra katman bütçesi; gerekirse GL katmanlarına ortak bağlam (PC motoru, golden kapısı). |
| R2 | Emülatör performansı telefonu göstermez | 1.0 öncesi telefon ölçümü şart; uyarlanır çizim ölçeği varsayılan açık. |
| R3 | Uygulamalar seslerinin yakalanmasını kapatır | Sessizlik algılama, Visualizer/mikrofon önerisi, uygulama içi çalar. |
| R4 | Eski WebView sürümleri | Asgari sürüm denetimi ve uyarı; özellik denetimi (`isConfigSupported`, `WEB_MESSAGE_ARRAY_BUFFER`). |
| R5 | WebView çökmesi | `onRenderProcessGone` ile yeniden kurma. |
| R6 | Dışa aktarım arka planda yavaşlar | İlk sürümde ekran açık; arka plan ölçülürse eklenir. |
| R7 | MIUI pil ve izin kısıtları | Rehber ekran, telefonda doğrulama. |
| R8 | `dev/android` ile main'in ayrışması | main'i düzenli içeri almak; test sayısı satırlarını yeniden hesaplamak. |
| R9 | Play kuralları (yüzen pencere, servis beyanları) | Baştan uygun bildirim dosyası ve yazılı gerekçeler. |
| R10 | 2400×1080 ekranda tam çözünürlük pahalı | Çizim ölçeği; ölçüme göre varsayılan. |
| R11 | Android sürümü GitHub'da "Latest" olur, PC güncelleyicisi ve indirme düğmeleri bozulur | `--latest=false` kuralı, PC güncelleyicisinde etiket bekçisi ve testi (§2.6). |
| R12 | Sistem, yüzen pencere açıkken Activity'yi kapatır | WebView Activity'den bağımsız; "Etkinlikleri tutma" testi (0E7). |

---

## 6. Sizden istenecekler (zamanı gelince)
- Emülatör kalıplarının indirilmesi: **onaylandı** (14.11).
- Gerçek uygulamalarla ses denemesi isterseniz: Google Play'li kalıbın lisansını siz kabul edersiniz, emülatörde Google hesabıyla oturumu da siz açarsınız.
- Faz 6'dan önce fiziksel telefon: USB hata ayıklama ve "USB üzerinden yükle".
- İlk APK'dan önce kalıcı imza anahtarı (parolası sizde).
