<div align="center">

<img src="assets/icon.svg" alt="CaYaDev Visualizer" width="128" height="128" />

# CaYaDev Visualizer

### 🎵 Çoklu monitör + çoklu ses kaynağı destekli, sese duyarlı görselleştirme uygulaması

**Windows** & **macOS** · Electron + WebGL · Native WASAPI/CoreAudio loopback

[![License: MIT](https://img.shields.io/badge/License-MIT-e11d2a.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-111827.svg)](#-derleme--dağıtım)
[![Electron](https://img.shields.io/badge/Electron-33-47848F.svg)](https://www.electronjs.org/)
[![cayadev.com](https://img.shields.io/badge/cayadev.com-e11d2a.svg)](https://cayadev.com)

</div>

---

CaYaDev Visualizer; **sistem sesine, mikrofonlara ve seçilen diğer ses girişlerine** gerçek zamanlı tepki veren,
tam ekran görsel efektler üreten bir masaüstü uygulamasıdır. İki panelden oluşur:

- 🎛️ **Yönetici Paneli** — tüm ayarların canlı yapıldığı kontrol ekranı.
- 🖥️ **Görselleştirme Ekranı** — seçtiğiniz monitörde tam ekran açılan, sese tepki veren görsel.

Ses; **sistem çıkış aygıtlarından** (hoparlör/kulaklık loopback), **mikrofonlardan/giriş aygıtlarından** veya aynı anda seçilen birden fazla kaynaktan yakalanabilir.
Seçilen kaynaklar native `audify` modülüyle FFT analizinden önce karıştırılır.

---

## 🎬 Demo

| Ses görselleştirici (canlı) | Frekans barları (canlı) |
|:---:|:---:|
| ![Görselleştirici demo](docs/screenshots/demo-visualizer.gif) | ![Bar demo](docs/screenshots/demo-bars.gif) |

> Yukarıdaki GIF'ler sentetik bir ses sinyaliyle üretilmiştir; gerçek kullanımda çalan müziğe birebir tepki verir.

---

## 🎛️ Arayüz (Yönetici Paneli)

Panel üç sütundan oluşur: solda **kategori rayı**, ortada seçili kategorinin ayar kartları,
sağda **canlı önizleme**, ses seviyeleri ve sahneler.

- **5 kategori** — Sahne, Ses, Işık, Çıkış, Kitaplık. Her ayar bir kategoriye ait; kart başlıklarında
  ve kategori rayında varsayılandan farklı ayar sayısı rozetle gösterilir.
- **Temel / Gelişmiş ayrımı** — her kart varsayılan olarak yalnızca birkaç temel ayar gösterir,
  gerisi *Gelişmiş ayarlar* altında gruplanır. Böylece uygulama büyüdükçe panel kalabalıklaşmaz.
- **Canlı önizleme** — görselleştiricinin gerçek çizim motoru panelin içinde çalışır. Ses yokken
  müzik benzeri örnek bir sinyalle sürülür; **Demo** rozetine tıklayarak gerçek sistem sesini
  görselleştiriciyi hiç açmadan yakalatabilirsiniz.
- **Arama (Ctrl+K)** — tüm kategorilerdeki her ayarı tek kutudan bulun; sonuca tıklayınca ilgili
  kategori açılır ve kontrol vurgulanır.
- **Sahneler** — arkaplan + görselleştirici + logo + görsel nesnelerin tamamını isimle kaydedin,
  tek tıkla geri yükleyin, dışa/içe aktarın.
- **Bölüm ve kategori sıfırlama**, tüm ayarların JSON yedeği ve otomatik kayıt.

<div align="center">
  <img src="docs/screenshots/admin-panel.png" alt="Yönetici Paneli" width="900" />
</div>

---

## ✨ Görselleştirme Modları & Stilleri

**14 görselleştirici modu** ve **10 arkaplan türü** — hepsi aynı renk paletini, hazır şablonları ve
kendi şablonlarınızı kullanır, dolayısıyla mod değiştirmek renklerinizi bozmaz.

### Görselleştirici (ön efekt)

<div align="center">
  <img src="docs/screenshots/modes-visualizer.png" alt="Görselleştirici modları" width="900" />
</div>

### Arkaplan

Her arkaplan türünün **kendi ayrıntılı ayarları** vardır (yıldız sayısı, ufuk yüksekliği, perde
kalınlığı, bağlantı mesafesi, halka sıklığı …) — panelde *Mod Ayarları* başlığı altında toplanır.

<div align="center">
  <img src="docs/screenshots/modes-background.png" alt="Arkaplan modları" width="900" />
</div>

### Klasik görünümlerden örnekler

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/screenshots/visualizer-bars.png" width="400" /><br/>
      <b>Barlar</b> · alt yerleşim · gökkuşağı · Aurora
    </td>
    <td align="center" width="50%">
      <img src="docs/screenshots/visualizer-center.png" width="400" /><br/>
      <b>Merkez Barlar</b> · logo · Neon plazma
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/visualizer-bars-mirror.png" width="400" /><br/>
      <b>Barlar</b> · ayna (bas ortada) · Okyanus
    </td>
    <td align="center">
      <img src="docs/screenshots/visualizer-wave.png" width="400" /><br/>
      <b>Dalga</b> · kalın · ayna · Gün Batımı
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/visualizer-circular.png" width="400" /><br/>
      <b>Çember</b> · logo · Lav plazma
    </td>
    <td align="center">
      <img src="docs/screenshots/visualizer-solid.png" width="400" /><br/>
      <b>Düz renk arkaplan</b> · marka kırmızısı barlar
    </td>
  </tr>
</table>

---

## 🚀 Çalıştırma (geliştirme)

```bash
npm install      # bağımlılıkları kurar
npm start        # uygulamayı başlatır
```

> Kurumsal ağ/proxy nedeniyle `npm install` sertifika hatası verirse:
> PowerShell'de `$env:NODE_OPTIONS="--use-system-ca"` ile tekrar deneyin.

Geliştirici modu (DevTools açık): `npm run dev`

> **Geliştirme gereksinimi:** Projeyi kaynak koddan çalıştırmak için sistemde **Node.js** kurulu olmalıdır.
> Windows yayın paketleri ses yakalama yardımcısı için gömülü Node çalışma zamanı içerir.

---

## 📦 Derleme / Dağıtım

```bash
npm run icons      # SVG'den ikonları üretir (build/icon.ico, .icns, .png)
npm run dist:win   # Windows: NSIS kurulum + portable (dist/ klasörüne)
npm run dist:mac   # macOS: DMG + zip  (YALNIZCA bir Mac'te çalışır)
```

| Platform | Çıktı | Durum |
|----------|-------|-------|
| Windows  | `CaYaDev Visualizer Setup …exe` (kurulum), `…-portable.exe` | ✅ Tam çalışır |
| macOS    | `…-darwin-arm64/`, `…-darwin-x64/` (.app), DMG (Mac'te) | ⚠️ macOS üzerinde derlenir |

> Güncel GitHub sürümü Windows kurulum ve portable paketlerini içerir. macOS paketleri bir Mac üzerinde derlenmelidir.

**macOS native ses notu:** native ses modülü (`audify`) Windows'tan macOS'a **çapraz
derlenemez**. Windows'ta üretilen macOS `.app` paketlerinde arayüz/görseller çalışır ama
ses yakalama çalışmaz. Tam çalışan macOS sürümü için bir **Mac'te** `npm install && npm run
dist:mac` çalıştırın. macOS'ta **sistem sesi** yakalamak için **BlackHole** gibi bir sanal
ses aygıtı gerekir (mikrofon doğrudan çalışır).

---

## 🖥️ Kullanım

1. Bir **Ekran** ve bir veya daha fazla **ses kaynağı** (sistem çıkışı, mikrofon veya diğer giriş aygıtları) seçin.
2. **▶ Görselleştirmeyi Aç** ile seçilen ekranda tam ekran görsel başlar.
3. Sağdaki kartlardan görselleştirme türünü, renkleri, logoyu ve performansı **canlı** olarak
   değiştirin — değişiklikler anında yansır ve otomatik kaydedilir.
4. **Video Dışa Aktarma** ile seçilen ses dosyasını çözünürlük, kare hızı, kalite ve kodlayıcı seçenekleriyle MP4 olarak oluşturun.
5. Görselleştirme ekranında **ESC** tuşu ile çıkılır.

---

## 🎨 Özellikler

### Arkaplan (10 tür)
- **Akışkan Gradyan** — sese tepki veren mesh-gradyan fon (WebGL shader). İki stil: *Yumuşak
  (Parlamasız)* ve *Plazma (Parlamalı)*. Akış hızı, gezinme, dolanma, iç dönüş, bozulma, ölçek,
  gren, vinyet, **Ses Patlaması (Parlaklık)** ve **Ses ile Renk Kayması**.
- **Dalga Katmanları** — sese göre kabaran tepe katmanları (katman sayısı, tepe yüksekliği,
  dalga sıklığı, katman aralığı, saydamlık, bas itkisi).
- **Kutup Işıkları** — dalgalanan ışık perdeleri (perde sayısı/kalınlığı, dalgalanma, kenar
  yumuşaklığı, dikey konum).
- **Yıldız Alanı** — merkezden akan yıldızlar (yıldız sayısı/boyutu, hız izi, derinlik, parıldama).
- **Retro Izgara** — ufka kaçan perspektif ızgara (ufuk yüksekliği, satır/sütun sayısı, çizgi
  kalınlığı, ufuk parlaması, gökyüzü yoğunluğu, spektrum tepkisi).
- **Işık Parçacıkları** — yumuşak bokeh topları (sayı, boyut, boyut çeşitliliği, süzülme, bas nabzı).
- **Dijital Yağmur** — düşen ışıklı izler (sütun sayısı, düşme hızı, iz uzunluğu, yoğunluk, kalınlık).
- **Ağ** — süzülen düğümler ve aralarındaki bağlantılar (düğüm sayısı/boyutu, bağlantı mesafesi,
  çizgi kalınlığı, hareket hızı).
- **Nabız Halkaları** — merkezden açılan halkalar; bas darbelerinde fazladan halka doğar
  (halka sıklığı, genişleme hızı, kalınlık, sönme).
- **Düz Renk** — tek renk fon.

5 renk noktası, **10 hazır şablon** (Aurora, Gün Batımı, Neon, Lav, Okyanus, Orman, Pastel, Gece,
Buz, Tek Renk) ve kendi kaydettiğiniz şablonlar tüm arkaplan türlerinde geçerlidir.

### Görselleştirici (14 mod)
- **Barlar** · **Merkez** · **Segment** (LED ekolayzır) · **Nokta Matris**
- **Dalga** (osiloskop) · **Şerit** (dalga geçmişi) · **Arazi** (perspektifli tel kafes manzara)
- **Çember** · **Dairesel Dalga** · **Işın** · **Tünel** · **Küre**
- **Parçacık** (bas darbelerinde fışkıran parçacıklar) · **Spektrogram** (kayan ısı haritası)
- Bar sayısı, min/max frekans, boşluk, yerleşim, ayna, çizgi kalınlığı, genlik, hassasiyet ve
  parlama (glow) modda anlamlı oldukça gösterilir.
- **Gökkuşağı** açılıp kapatılabilir; kapalıyken tek/ikili renk seçilir.

### Sahneler
- Arkaplan + görselleştirici + logo + görsel nesnelerin tamamını isimle kaydeder.
- Tek tıkla geri yükleme, mevcut görünümle güncelleme, JSON olarak dışa/içe aktarma.
- Sahneler ve renk şablonları genel ayar yedeğine **dahil edilmez** ve yedek içe aktarılırken korunur.

### Logo / Resim
- Merkeze resim/logo yerleştirilir; **otomatik boyutlandırılır ve konumlandırılır**.
- Boyut, saydamlık, parlama, konum (X/Y) ve **sese göre nabız** ayarı.

### Ses
- **Sistem çıkış sesi**, **mikrofonlar/giriş aygıtları** veya birden fazla seçili kaynak aynı anda yakalanabilir.
- Çıkış aygıtları WASAPI loopback ile, giriş aygıtları ise native `audify` modülü üzerinden doğrudan yakalanır.
- Hassasiyet, yumuşatma, bas vurgusu + canlı seviye göstergeleri (genel / bas / orta / tiz).

### Video Dışa Aktarma
- Seçilen bir ses dosyasını mevcut görselleştirici ayarlarıyla **MP4 video** olarak oluşturur.
- Çözünürlük, kare hızı, kalite, kodlayıcı ve işleme hızı ayarlanabilir.
- İlerleme takibi, iptal ve gerektiğinde GPU'dan CPU'ya geçiş desteklenir.

### Windows Dynamic Lighting
- Varsayılan olarak kapalıdır ve yalnızca uyumlu Windows Dynamic Lighting aygıtları algılandığında etkinleştirilebilir.
- Dinamik modlar: görselleştirici renk akışı, bar spektrum eşleme, gelişmiş bas/mid/tiz bölgeleri, arka plan ışık senkronu, eşzamanlı ritim patlaması, frekans ripple dalgası, bar + arka plan füzyonu, aygıtlar arası renk akışı, Rainbow ışık akışı ve eşik tetiklemeli arka plan patlaması.
- Eşik tetiklemeli patlama modu yalnızca seçilen tek kaynağı (bas, mid, tiz, genel seviye veya en güçlü bant) izler ve ayarlanan eşik aşılınca çalışır. Patlama parlaklığı eşik üstüne çıkma miktarına göre artar; renk arka planın gerçek anlık piksellerinden alınır.
- Bas/mid/tiz tepkisi anlık/katı, vuruşlu/sert veya yumuşak/akıcı profillerle; eşik, sertlik, saldırı/bırakma ve bant ayrıştırma ayarlarıyla özelleştirilebilir. Rainbow modu LED'lerde sıralı veya tüm LED'lerde tek ton çalışabilir ve seçilen ses bandına göre parlaklık tepkisi verebilir.
- Manuel modlar: tüm aygıtlarda tek renk, aygıt başına renk ve donanımın sunduğu durumlarda LED/bölge başına renk.
- Parlaklık, ses tepkisi, yumuşatma, güncelleme hızı, LED yerleşimi, renk kaynağı, frekans renkleri/hassasiyetleri, patlama eşiği/gücü/sönümlemesi, ripple hızı/yönü/genişliği ve renk yayılımı ayrı ayrı ayarlanabilir.
- Installer, Windows arka plan aydınlatma kimliğini otomatik kaydeder. Portable sürüm kimlik kurmaz ve UAC istemez; yalnızca CAYADEV Visualizer odaktayken aydınlatmayı kontrol eder. Arka planda da kontrol gerekiyorsa installer sürümünü kullanın.
- Başka bir uygulama odaktayken arka plan kontrolünün sürmesi için Windows **Dynamic Lighting > Arka plan ışık denetimi** bölümünde CAYADEV Visualizer uygulamasını üst sıralara taşıyın.

### Ayarları Yedekleme / Geri Yükleme
- Ses, görünüm, Dynamic Lighting, performans, logo, görsel nesneler, ekran seçimi ve video dışa aktarma dahil tüm uygulama ayarları tek JSON dosyasına aktarılabilir.
- Kullanıcının oluşturduğu **renk şablonları ve sahneler** yedeğe özellikle dahil edilmez ve ayar dosyası içe aktarılırken korunur; ikisinin de kendi dışa/içe aktarma düğmeleri vardır.
- İçe aktarılan ayarlar güncel varsayılanlarla birleştirilir; böylece yeni sürümlerde eklenen alanlar geçerli kalır.

### Güç / Performans
- **Kare hızı:** *Ekranla Eşitle* (her ekran yenilemesinde bir kare — en akıcısı) veya en fazla
  120 / 60 / 30 FPS. Sınır, ekranın yenileme hızının tam böleni değilse (75 Hz ekranda 60 gibi)
  uzun vadeli ortalama doğru kalır ama kare aralıkları eşitsizleşir; en pürüzsüz sonuç için
  *Ekranla Eşitle* önerilir.
- Arkaplan çözünürlük ölçeği, sessizlikte duraklatma, imleç gizleme.

### Uygulama Ayarları (⚙ menüsü)
- **Dil** — Otomatik (sistem dili), Türkçe veya İngilizce.
- **Görselleştirmeyi Her Zaman Üstte Tut** *(varsayılan kapalı)* — açıldığında görselleştirme
  ekranı başka bir uygulama öne çıksa bile üstte kalır; pencere odağı kaybettiğinde kendini
  yeniden en üste taşır.
- **Genişletilmiş Ayar Aralıkları** *(varsayılan kapalı)* — kaydırıcıların üst sınırını 5 katına
  çıkarır, normalin çok üstünde değerler girebilirsiniz. Algoritma gereği sınırlı olan birkaç
  ayar (yumuşatma, arkaplan çözünürlüğü) kapsam dışıdır. Kapatınca girdiğiniz yüksek değerler
  korunur.

## 🔊 Ses yakalama nasıl çalışır (önemli)

Sistem sesi **çıkış aygıtının WASAPI loopback'i** ile, mikrofonlar ve diğer giriş aygıtları ise doğrudan yakalanır.
Birden fazla seçili kaynak FFT analizinden önce karıştırılabilir.

Bu, `audify` adlı native bir modülle yapılır. Native modül Electron'un ABI'sine hazır gelmediği
için, yakalama **ayrı bir Node alt-süreci** (`src/main/loopback-helper.js`) ile çalıştırılır; bu
süreç sesi yakalar, FFT analizini hesaplar ve sonucu ana sürece aktarır.

> Windows yayın paketleri gömülü Node çalışma zamanı içerir; son kullanıcıların ayrıca Node.js kurması gerekmez.

**Aygıt seçimi:** Yönetici panelinde bir veya daha fazla çıkış ve giriş aygıtı seçebilirsiniz.
"Varsayılan Çıkış" o an Windows'ta aktif olan çıkışı kullanır. Liste güncel değilse
**🔄 Aygıtları Yenile**'ye basın. Bir aygıt başka bir uygulama tarafından **özel (exclusive) modda**
tutuluyorsa yakalama başarısız olabilir; farklı bir aygıt seçin veya o uygulamayı kapatın.

**Sorun giderme:** Ses tanılaması otomatik çalışır, gerektiğinde aygıt taraması yeniden denenir ve anlaşılır hata kodları gösterilir. Gerekli bir çalışma zamanı bileşeni eksikse **Otomatik Onar**, kullanıcı onayından sonra kurulum yapabilir.

---

## 📁 Proje yapısı

```
src/
  main/                # Electron ana süreç
    main.js            # pencereler, ekran seçimi, IPC, yakalama yaşam döngüsü
    native-audio.js    # loopback-helper alt-sürecini yönetir, kareleri iletir
    loopback-helper.js # gömülü/sistem Node çalışma zamanı: audify yakalama + FFT
    preload-admin.js / preload-visualizer.js / preload-exporter.js
  shared/
    defaults.js        # varsayılan yapılandırma + renk şablonları
    i18n.js            # İngilizce/Türkçe çeviriler ve dil algılama
  admin/               # Yönetici paneli (kontrol arayüzü)
    index.html / admin.css / admin.js / settings.js
    preview.js         # panel içindeki canlı önizleme (görselleştiriciyle aynı motor)
  exporter/            # Çevrimdışı ses dosyasından MP4 oluşturma penceresi
  visualizer/          # Görselleştirme ekranı
    index.html / visualizer.css / audio.js / visualizer.js
    modes/
      gradient.js      # WebGL akışkan gradyan arkaplan
      backgrounds.js   # 2D arkaplan modları (dalga, kutup ışıkları, yıldız, ızgara,
                       #   bokeh, dijital yağmur, ağ, nabız halkaları)
      glow.js          # tek geçişli parlama (bloom) yardımcısı
      bars.js centerbars.js blocks.js dots.js wave.js ribbon.js terrain.js
      circular.js radialwave.js starburst.js tunnel.js orb.js particles.js
      spectrogram.js sprites.js
scripts/
  start.js             # GUI başlatıcı (ELECTRON_RUN_AS_NODE'u temizler)
  gen-icons.js         # SVG -> ikonlar
  prepare-runtime.js   # Node çalışma zamanını Windows paket kaynaklarına kopyalar
docs/screenshots/      # README görselleri
```

Ayarlar otomatik olarak `%APPDATA%/soundvisualizer/settings.json` (Windows) dosyasına kaydedilir.

---

## ⌨️ Kısayollar

| Tuş | İşlev |
|-----|-------|
| `Ctrl` + `K` | Panelde ayar ara |
| `ESC` | Görselleştirme ekranını kapat / aramayı temizle |
| Ekrana tıklama | Ses başlatılamadıysa yeniden dene |


---

## 📄 Lisans

Bu proje **MIT Lisansı** ile lisanslanmıştır — ayrıntılar için [LICENSE](LICENSE) dosyasına bakın.

```
Copyright (c) 2026 CaYaDev — https://cayadev.com
```

<div align="center">

---

**[cayadev.com](https://cayadev.com)** tarafından ❤️ ile geliştirildi.

</div>
