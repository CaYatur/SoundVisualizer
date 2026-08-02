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

CaYaDev Visualizer; çalan **sistem sesine** (hoparlör/kulaklık çıkışı) gerçek zamanlı tepki veren,
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

Tüm ayarlar tek ekrandan, **canlı** olarak yapılır ve otomatik kaydedilir — ekran seçimi, ses kaynağı,
arkaplan gradyanı, görselleştirici türü, renkler, logo ve performans.

<div align="center">
  <img src="docs/screenshots/admin-panel.png" alt="Yönetici Paneli" width="820" />
</div>

---

## ✨ Görselleştirme Modları & Stilleri

Dört ana mod, sayısız renk şablonu, gökkuşağı/tek renk, ayna, alt/orta/tam yerleşim ve
yumuşak/plazma arkaplan gradyanlarıyla birbirinden farklı görünümler:

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
      <img src="docs/screenshots/visualizer-bars-thin.png" width="400" /><br/>
      <b>Barlar</b> · orta simetrik · Buz
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/visualizer-wave.png" width="400" /><br/>
      <b>Dalga</b> · kalın · ayna · Gün Batımı
    </td>
    <td align="center">
      <img src="docs/screenshots/visualizer-wave-line.png" width="400" /><br/>
      <b>Dalga</b> · ince çizgi · gökkuşağı · Gece
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/visualizer-circular.png" width="400" /><br/>
      <b>Çember</b> · logo · Lav plazma
    </td>
    <td align="center">
      <img src="docs/screenshots/visualizer-circular-rainbow.png" width="400" /><br/>
      <b>Çember</b> · gökkuşağı · logo · Orman
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <img src="docs/screenshots/visualizer-solid.png" width="500" /><br/>
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
| macOS    | `…-darwin-arm64/`, `…-darwin-x64/` (.app), DMG (Mac'te) | ⚠️ Bkz. not |

**macOS native ses notu:** native ses modülü (`audify`) Windows'tan macOS'a **çapraz
derlenemez**. Windows'ta üretilen macOS `.app` paketlerinde arayüz/görseller çalışır ama
ses yakalama çalışmaz. Tam çalışan macOS sürümü için bir **Mac'te** `npm install && npm run
dist:mac` çalıştırın. macOS'ta **sistem sesi** yakalamak için **BlackHole** gibi bir sanal
ses aygıtı gerekir (mikrofon doğrudan çalışır).

---

## 🖥️ Kullanım

1. Yönetici paneli açılır. Üstten **Ekran** seçin (varsayılan olarak ikinci monitör seçilir).
2. **▶ Görselleştirmeyi Aç** ile seçilen ekranda tam ekran görsel başlar.
3. Sağdaki kartlardan görselleştirme türünü, renkleri, logoyu ve performansı **canlı** olarak
   değiştirin — değişiklikler anında yansır ve otomatik kaydedilir.
4. Görselleştirme ekranında **ESC** tuşu ile çıkılır.

---

## 🎨 Özellikler

### Arkaplan — Akışkan Gradyan (Sis efekti)
- Her noktadan akan, sese tepki veren mesh-gradyan fon (WebGL shader).
- **İki stil:** *Yumuşak (Parlamasız)* — pürüzsüz, pastel mesh gradyan; *Plazma (Parlamalı)* —
  sese göre patlayan, daha canlı/parlak.
- 5 renk noktası ayrı ayrı seçilebilir; **10 hazır şablon** (Aurora, Gün Batımı, Neon, Lav, Okyanus,
  Orman, Pastel, Gece, Buz, Tek Renk).
- Akış hızı, ölçek, bozulma (akışkanlık), **ses tepkisi**, temel parlaklık, gren, vinyet.
- **Ses Patlaması (Parlaklık)** ve **Ses ile Renk Kayması** ayrı ayrı ayarlanabilir.
- Alternatif olarak **düz renk** arkaplan.

### Görselleştirici (ön efekt)
- **Barlar** — her bar bir logaritmik frekans bandı. Bar sayısı, min/max frekans, boşluk,
  yerleşim (alt/orta/tam), ayna, tepe noktaları.
- **Merkez** — ekranın ortasından yukarı/aşağı simetrik açılan barlar. Logo ile çok uyumlu.
- **Dalga** — osiloskop/dalga formu; çizgi kalınlığı, genlik, ayna.
- **Çember** — merkez logo ile uyumlu radyal spektrum; bas merkez halkasını nabızlandırır.
- **Gökkuşağı** açılıp kapatılabilir; kapalıyken tek renk seçilir. Hassasiyet ve parlama (glow).

### Logo / Resim
- Merkeze resim/logo yerleştirilir; **otomatik boyutlandırılır ve konumlandırılır**.
- Boyut, saydamlık, parlama, konum (X/Y) ve **sese göre nabız** ayarı.

### Ses
- **Sistem çıkış sesi**, **mikrofonlar/giriş aygıtları** veya birden fazla seçili kaynak aynı anda yakalanabilir.
- Çıkış aygıtları WASAPI loopback ile, giriş aygıtları ise native `audify` modülü üzerinden doğrudan yakalanır.
- Hassasiyet, yumuşatma, bas vurgusu + canlı seviye göstergeleri (genel / bas / orta / tiz).

### Güç / Performans
- Kare hızı (30/60/120/sınırsız), arkaplan çözünürlük ölçeği, sessizlikte duraklatma, imleç gizleme.

---

## 🔊 Ses yakalama nasıl çalışır (önemli)

Sistem sesi **çıkış aygıtının WASAPI loopback'i** ile, mikrofonlar ve diğer giriş aygıtları ise doğrudan yakalanır.
Birden fazla seçili kaynak FFT analizinden önce karıştırılabilir.

Bu, `audify` adlı native bir modülle yapılır. Native modül Electron'un ABI'sine hazır gelmediği
için, yakalama **ayrı bir Node alt-süreci** (`src/main/loopback-helper.js`) ile çalıştırılır; bu
süreç sesi yakalar, FFT analizini hesaplar ve sonucu ana sürece aktarır.

> Windows yayın paketleri gömülü Node çalışma zamanı içerir; son kullanıcıların ayrıca Node.js kurması gerekmez.

**Aygıt seçimi:** Yönetici panelinde **Çıkış Aygıtı** listesinden hoparlör/kulaklık seçebilirsiniz.
"Varsayılan Çıkış" o an Windows'ta aktif olan çıkışı kullanır. Liste güncel değilse
**🔄 Aygıtları Yenile**'ye basın. Bir aygıt başka bir uygulama tarafından **özel (exclusive) modda**
tutuluyorsa yakalama başarısız olabilir; farklı bir aygıt seçin veya o uygulamayı kapatın.

---

## 📁 Proje yapısı

```
src/
  main/                # Electron ana süreç
    main.js            # pencereler, ekran seçimi, IPC, yakalama yaşam döngüsü
    native-audio.js    # loopback-helper alt-sürecini yönetir, kareleri iletir
    loopback-helper.js # SİSTEM node'unda çalışır: audify WASAPI loopback + FFT
    preload-admin.js / preload-visualizer.js
  shared/
    defaults.js        # varsayılan yapılandırma + renk şablonları
  admin/               # Yönetici paneli (kontrol arayüzü)
    index.html / admin.css / admin.js
  visualizer/          # Görselleştirme ekranı
    index.html / visualizer.css / audio.js / visualizer.js
    modes/             # gradient.js, bars.js, centerbars.js, wave.js, circular.js
scripts/
  start.js             # GUI başlatıcı (ELECTRON_RUN_AS_NODE'u temizler)
  gen-icons.js         # SVG -> ikonlar
docs/screenshots/      # README görselleri
```

Ayarlar otomatik olarak `%APPDATA%/soundvisualizer/settings.json` (Windows) dosyasına kaydedilir.

---

## ⌨️ Kısayollar

| Tuş | İşlev |
|-----|-------|
| `ESC` | Görselleştirme ekranını kapat |
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
