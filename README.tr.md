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
tam ekran görsel efektler üreten bir masaüstü uygulamasıdır. Üç çıkış yolu vardır:

- 🎛️ **Yönetici Paneli** — tüm ayarların canlı yapıldığı kontrol ekranı.
- 🖥️ **Görselleştirme Ekranı** — seçtiğiniz **her** monitörde tam ekran açılan, sese tepki veren görsel.
- 📡 **Yayın Sayfası** — OBS'e "Tarayıcı Kaynağı" olarak eklenen, aynı motoru çalıştıran saydam katman
  (artı telefondan kullanılan uzaktan kumanda sayfası).

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

## 📡 Yayın Çıkışı — OBS ve tarayıcı

Uygulama, isteğe bağlı olarak **yerel bir HTTP + WebSocket sunucusu** açar.
OBS'e "Tarayıcı Kaynağı" olarak verdiğiniz sayfa, masaüstü penceresiyle
**birebir aynı motoru** çalıştırır: ikinci bir render yoktur, dolayısıyla
yayındaki görüntü ekrandakinden asla ayrışmaz.

- **Eklenti kurulumu yok.** OBS → Kaynaklar → ＋ → Tarayıcı → adresi yapıştır.
- **Gerçek saydamlık.** Görselleştirici doğrudan üst katman olur; arkaplanı
  istersen adrese `?transparent=0` ekleyerek geri getirirsin.
- **Kaynağa özel ayar.** `?fps=30` veya `?scale=0.75` ile o kaynağın yükünü
  ayrıca düşürebilirsin.
- **Pencere yakalamaya gerek yok.** Görselleştirme penceresini hiç açmasan da
  OBS katmanı çalışır; ses yakalama tarayıcı kaynağı bağlandığında başlar.
- Sunucu **varsayılan olarak yalnızca 127.0.0.1** dinler. Telefondan erişim
  için "Yerel Ağa Aç" açılır; o modda her istek tahmin edilmesi güç bir
  **jeton** ister.

### 📱 Mobil uzaktan kumanda

Aynı sunucu `/remote` adresinde telefona uygun bir kumanda sayfası servis eder.

- Sahneler, renk şablonları ve Studio presetleri **adlarıyla** listelenir;
  etkin olan işaretlidir ve her liste **◀ ▶ ile sırayla gezilebilir**.
- Görselleştiriciyi aç/kapat, mod ve arkaplan değiştir, hassasiyet/parlama
  ayarla, tek düğmeyle **karart**.
- Sayfa uygulamanın dilini kullanır (telefonun dilini değil).

---

## ⬗ Katmanlar ve Efekt Zinciri

Sahne artık sabit bir yığın değil, **sıralı bir katman listesidir**. Her
katmanın kendi kaynağı (arkaplan, görselleştirici, medya, görsel nesne, logo),
**karışım modu**, saydamlığı, dönüşümü, sese tepkisi ve **kendi ayarları**
vardır — aynı sahnede farklı renklerde iki bar katmanı ya da bir shader'ın
üstüne bindirilmiş bir mandala olabilir.

- **17 karışım modu** (toplama, ekran, çarpma, fark, renk soldurma, parlaklık…)
- Katman başına ölçek, dönüş, konum, aynalama
- Sese bağlı saydamlık / ölçek / dönüş modülasyonu, bant seçimiyle
- Katman listesi boşken sahne eski alanlardan **sentezlenir**; v2.0 ayarları,
  sahneleri ve preset paketleri hiç değişmeden çalışır

**Efekt zinciri** birleştirilmiş sahneye sırayla uygulanan 15 GPU efektidir:
bloom, kromatik sapma, glitch, film greni, CRT, pikselleştirme, kaleydoskop,
ayna, renk düzeltme, vinyet, iz/yankı, kenar vurgusu, merkezden bulanıklık,
dalga bozulması, posterize. Sıralama görüntüyü değiştirir; her parametre sese
bağlanabilir ve zincir **dışa aktarımda da aynen çalışır**.

> Maliyet yalnızca kullanana: zincir boşken sahne CSS ile kompozit edilir
> (tarayıcının GPU kompozitörü), ilk efekt eklendiğinde motor tek bir
> birleştirme yüzeyine geçer.

---

## ◈ 3B Geometri ve Matematiksel Formüller

Gerçek perspektifte, sese tepki veren geometri. **35 kanonik formül** dört ailede:

| Aile | Örnekler |
|---|---|
| **Yüzeyler** (12) | Küre · Simit · **Klein şişesi** · Möbius şeridi · Süperşekil (Gielis) · Boy yüzeyi · Dini yüzeyi · Deniz kabuğu · Küresel harmonik · **Chladni deseni** · Dalga yüzeyi · Düzlem |
| **Düzlem eğrileri** (12) | Lissajous · Gül eğrisi · Episikloid · Hipotrokoid (spirograf) · Süperformül · Kelebek · Lemniskat · Astroid · Kardiyoid · **Filotaksi** · Logaritmik sarmal · Harmonograf |
| **Uzay eğrileri** (4) | Simit düğümü · Helis · Viviani eğrisi · Yonca düğümü |
| **Çekiciler** (7) | **Lorenz** · Rössler · Thomas · Aizawa · Halvorsen · Clifford · de Jong |

- Yüzey / tel kafes / nokta çizimi · dört bozulma kipi · dört renklendirme kipi
- Her formülün **kendi parametreleri** panelde otomatik kaydırıcıya dönüşür
- Kamera dönüşü, eğimi, yakınlaşması ve bas ile itilmesi

**Doğruluk beyanı.** 35 formülün 30'u kapalı formludur ve
`tests/formulas.test.js` her birini **tanımından elle türetilmiş** değerlerle
sınar: Viviani eğrisinin küre üzerinde kalması, simidin boru yarıçapı,
Chladni'nin m↔n antisimetrisi, Clifford ve de Jong haritalarının sınırları…
Katalog testi, "kapalı form" işaretli bir formülün test edilmeden eklenmesini
engeller. Kalan 5'i sayısal integrasyonla çalışan çekicilerdir ve öyle
işaretlidir — panelde de bu rozet görünür.

Motor **kendi matris matematiğiyle** çalışır; üçüncü parti 3B kütüphanesi yok.
Ağ bir kez kurulup GPU'da kalır, sese bağlı bozulma vertex shader'da yapılır —
96×96'lık bir yüzeyde bile kare başına CPU maliyeti yoktur.

---

## 🥁 Tempo, Otomatik VJ ve Art-Net

**Tempo:** spektral akıdan bulunan vuruşların **periyot histogramıyla** BPM
kestirimi. Ardışık aralıkları doğrudan BPM'e çevirmek yerine son 8 saniyenin
tüm vuruş çiftleri oy verir; tek bir kaçan vuruş tempoyu yarıya düşürmez.
Elle tempoya vurma ve BPM kilidi de vardır.

_Ölçüm: 90 / 120 / 128 / 140 / 174 BPM → 89.8 / 120.4 / 127.9 / 140.0 / 173.7_

**Otomatik VJ:** ölçü ya da saniye başına sahne, görselleştirici veya renk
şablonu değiştirir; ölçü birimindeyken geçiş **tam vuruşa hizalanır**.

**Art-Net / DMX:** sahne renklerini standart protokolle (ArtDMX, UDP 6454)
ışık konsollarına, DMX arayüzlerine ve QLC+ gibi yazılımlara yollar. Dört renk
kaynağı, RGB/RGBW aygıt, evren ve kanal ayarları. Windows Dynamic Lighting'in
yerine geçmez: o tüketici aygıtlarını, bu sahne ışıklarını sürer.

---

## 🧪 Studio — kendi görselleştiricini yap

İki katmanlı bir editör: kod yazmadan da, sıfırdan da tasarlayabilirsin.

**Varyasyon (kod yok).** Ekranda beğendiğin görünümü isimlendirip saklar.
Temel mod ve o anki tüm ayarları presete girer; tek tıkla geri gelir.

**Shader (GLSL).** Giriş noktası Shadertoy ile aynıdır — `mainImage(out vec4
fragColor, in vec2 fragCoord)` — üstüne ses verisi ve kendi kaydırıcıların
eklenir:

| Değişken | Anlamı |
|---|---|
| `sv_time`, `sv_resolution` | süre ve çözünürlük |
| `sv_level`, `sv_bass`, `sv_mid`, `sv_treble` | ses bantları (0..1) |
| `sv_beat` | vuruş enerjisi (0..1), her darbede sıçrar |
| `sv_spec(x)` | 0..1 konumunda logaritmik spektrum değeri |
| `sv_waveAt(x)` | dalga formu (-1..1) |
| `sv_col(x)` | senin 5 renkli paletinden renk |
| `sv_prev` | bir önceki kare (geri besleme efektleri) |
| `sv_media` | web kamerası / video katmanı |

Editörde satır numaraları, sözdizimi renklendirmesi, **canlı önizleme** ve
derleyici hatasının **hangi satırda** olduğunu gösteren işaret vardır. Kendi
parametrelerini (kaydırıcı / anahtar / renk) tanımlarsan panelde otomatik
olarak kontrol üretilir.

**İçe aktarma:** Shadertoy kodu, ISF dosyası (`INPUTS` kontrollere çevrilir),
MilkDrop `.milk` parametreleri ve kendi `.svpreset` / `.svpack`
dosyalarımız. Dönüştürücülerin tamamı bu uygulamanın kodudur — **hiçbir
servise bağlanılmaz**, hesap ya da API anahtarı istenmez.

**Paylaşım:** Tek preset `.svpreset`, tüm presetlerin `.svpack` olarak dışa
aktarılır. Presetler ayar dosyasında değil, `%APPDATA%/soundvisualizer/presets/`
altında ayrı dosyalarda tutulur (ayar dosyası her kaydırıcı hareketinde diske
yazılıyor; shader kaynağını oraya koymak gereksiz disk trafiği olurdu).

> ♾ **Geri besleme motoru** ayrı bir mod olarak gelir: her kare bir öncekini
> yakınlaştırıp döndürerek ve söndürerek çizer, üstüne dalga formunu bindirir.
> MilkDrop'un o klasik "sonsuz tünel" ailesi buradan çıkar.

---

## 🎛️ Kontrol yüzeyleri — MIDI ve OSC

- **MIDI:** Denetleyicinin CC ve nota mesajları herhangi bir ayara ya da eyleme
  bağlanır. **Öğren**'e basıp düğmeyi oynatman yeterli; kanal ve numara
  otomatik yazılır.
- **OSC:** TouchOSC, Resolume, Ableton, QLab… UDP portu dinlenir, adresler
  ayarlara eşlenir. 0..1 aralığı doğrudan, 0..127 aralığı otomatik ölçeklenir.
- Eylemler: sonraki/önceki görselleştirici, sonraki arkaplan, sonraki sahne,
  sonraki renk şablonu, **karart**.

---

## 🎥 Medya katmanı

Web kameranı veya bir video dosyasını sahneye katman olarak koyar.

- Önde ya da arkada, doldur/sığdır/ger, karışım modu, saydamlık
- Kaleydoskop (3–12 dilim), renk kayması, doygunluk, aynalama
- Bas → yakınlaşma ve bas → saydamlık nabzı
- Studio shader'ları aynı görüntüyü `sv_media` (iChannel3) olarak okuyabilir

---

## ✨ Sahne Üretici

Ruh halini yaz, uygulama sana bir sahne kursun: *"karanlık sinematik uzay"*,
*"enerjik neon techno"*, *"sakin orman sabahı"*…

**Tamamen çevrimdışıdır ve bir sinir ağı değildir.** Metin, ağırlıklı bir
anahtar kelime sözlüğüyle dört eksene (enerji, sıcaklık, aydınlık, doku)
indirgenir; arkaplan, görselleştirici ve 5 renkli palet bu eksenlerden
tohumlanmış deterministik bir üreticiyle seçilir. Aynı metin + aynı tohum her
zaman aynı sahneyi verir; 🎲 ile aynı ruh halinin farklı bir yorumunu alırsın.
Türkçe ve İngilizce anahtar kelimeler birlikte tanınır.

---

## ✨ Görselleştirme Modları & Stilleri

**32 görselleştirici modu**, **19 arkaplan türü** ve **58 renk şablonu** — hepsi aynı paleti
paylaşır, dolayısıyla mod değiştirmek renklerinizi bozmaz. Buna 3B geometri motoru, geri besleme
motoru ve Studio'da kendi yazdığınız shader'lar da dahildir.

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

1. Üst çubuktaki **Ekranlar** menüsünden bir veya **birden fazla** ekran, ardından bir veya daha
   fazla **ses kaynağı** (sistem çıkışı, mikrofon veya diğer giriş aygıtları) seçin.
2. **▶ Görselleştirmeyi Aç** ile seçilen **her** ekranda tam ekran görsel başlar.
3. Sağdaki kartlardan görselleştirme türünü, renkleri, logoyu ve performansı **canlı** olarak
   değiştirin — değişiklikler anında yansır ve otomatik kaydedilir.
4. Yayın yapıyorsanız **Çıkış → Yayın Çıkışı**'nı açın ve verilen adresi OBS'te bir
   **Tarayıcı Kaynağı**'na yapıştırın.
5. Kendi efektinizi yapmak için **Studio**'ya, hazır bir sahne kurdurmak için
   **Studio → Sahne Üretici**'ye gidin.
6. **Video Dışa Aktarma** ile seçilen ses dosyasını çözünürlük, kare hızı, kalite ve kodlayıcı seçenekleriyle MP4 olarak oluşturun.
7. Görselleştirme ekranında **ESC** tuşu tüm ekranlardaki görselleştirmeyi kapatır.

---

## 🎨 Özellikler

### Arkaplan (19 tür)
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
- **Mürekkep** — burularak akan sıvı mürekkep damlaları (damla sayısı, akışkanlık, burulma, yayılma).
- **Bulutsu** — üst üste binen yumuşak gaz bulutları (katman sayısı, boyut, yumuşaklık, yoğunluk).
- **Petek Izgara** — merkezden yayılan dalga ve spektrumla yanan altıgen hücreler.
- **Mozaik** — düzensizleştirilmiş hücre ızgarası; her hücre bir frekans bandına bağlı.
- **Koridor** — izleyiciye doğru gelen halka/çokgen koridoru (halka sayısı, hız, kenar sayısı, burulma).
- **Sarmal** — dönen çok kollu sarmal (kol sayısı, tur sayısı, incelme).
- **Kar / Kor** — derinlikli, salınarak düşen parçacıklar.
- **Şehir** — pencereleri müzikle yanan, iki katmanlı paralaks şehir silüeti.
- **🧪 Studio** — kendi yazdığın GLSL shader'ı arkaplan olarak kullanır.
- **Düz Renk** — tek renk fon.

5 renk noktası, **58 hazır şablon** (yedi grupta: Klasikler, Sıcak, Soğuk, Neon ve Siber,
Karanlık, Aydınlık, Tek Renk Aileleri) (Aurora, Gün Batımı, Neon, Lav, Okyanus, Orman, Pastel, Gece,
Buz, Tek Renk) ve kendi kaydettiğiniz şablonlar tüm arkaplan türlerinde geçerlidir.

### Görselleştirici (31 mod)

**Temel** — **Barlar** · **Merkez** · **Segment** (LED ekolayzır) · **Nokta Matris** ·
**Şehir Silüeti** (pencereleri yanan binalar)

**Dalga formu** — **Dalga** (osiloskop) · **Şerit** (dalga geçmişi) ·
**3B Dalga** (perspektifte yığılan dalga geçmişi) · **Lissajous** (XY osiloskop) ·
**Teller** (her tel bir bantla titrer) · **Arazi** (perspektifli tel kafes manzara)

**Dairesel** — **Çember** · **Dairesel Dalga** · **Işın** · **Yaylar** (bant başına yay) ·
**Fırıldak** · **Mandala** (polar gül eğrisi) · **Kaleydoskop** · **Girdap** ·
**Sarmal** (DNA) · **Tünel** · **Küre**

**Parçacık ve olay** — **Parçacık** · **Havai Fişek** (vuruşta patlama) ·
**Şimşek** (basta dallanan yıldırım) · **Baloncuk** · **Sıvı Damla** (metaball) ·
**Dalgalı Izgara** (vuruşta yayılan halkalar) · **Spektrogram**

**Gelişmiş motorlar** — **◈ 3B Geometri** (35 matematiksel formül) · **♾ Geri Besleme**
(MilkDrop ailesi) · **🧪 Studio** (kendi shader'ın)
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
    main.js            # pencereler (ekran başına bir tane), IPC, yakalama yaşam döngüsü
    native-audio.js    # loopback-helper alt-sürecini yönetir, kareleri iletir
    loopback-helper.js # gömülü/sistem Node çalışma zamanı: audify yakalama + FFT
    stream-server.js   # OBS tarayıcı kaynağı + mobil kumanda (HTTP + WebSocket)
    osc-server.js      # OSC (UDP) alıcısı — elle yazılmış OSC 1.0 ayrıştırıcı
    presets-store.js   # Studio presetleri (userData/presets/*.json)
    preload-admin.js / preload-visualizer.js / preload-exporter.js
  shared/
    defaults.js        # varsayılan yapılandırma + renk şablonları
    presets.js         # preset biçimi, yerleşik shader'lar, Shadertoy/ISF/MilkDrop içe aktarma
    i18n.js            # İngilizce/Türkçe çeviriler ve dil algılama
  admin/               # Yönetici paneli (kontrol arayüzü)
    index.html / admin.css / admin.js / settings.js
    studio.js / studio.css  # Studio editörü (kod editörü, canlı önizleme, parametreler)
    stream.js          # yayın çıkışı paneli (adresler, jeton, istemciler)
    control.js         # MIDI + OSC eşleme motoru ve paneli
    media-panel.js     # web kamerası / video katmanı paneli
    scenegen.js        # çevrimdışı sahne üretici
    preview.js         # panel içindeki canlı önizleme (görselleştiriciyle aynı motor)
  web/                 # Yayın sunucusunun servis ettiği sayfalar
    overlay.html       # OBS tarayıcı kaynağı — masaüstüyle aynı motor
    remote.html / remote.js  # mobil uzaktan kumanda
    web-shim.js        # window.api köprüsü (IPC yerine WebSocket)
  exporter/            # Çevrimdışı ses dosyasından MP4 oluşturma penceresi
  visualizer/          # Görselleştirme ekranı
    index.html / visualizer.css / audio.js / visualizer.js
    modes/
      gradient.js      # WebGL akışkan gradyan arkaplan
      backgrounds.js   # 2D arkaplan modları (dalga, kutup, yıldız, ızgara, bokeh,
                       #   yağmur, ağ, halkalar)
      backgrounds-extra.js # bulutsu, petek, mürekkep, kar, şehir, koridor, sarmal, mozaik
      shaderhost.js    # WebGL2 Studio motoru + geri besleme (MilkDrop ailesi)
      media.js         # web kamerası / video katmanı
      glow.js          # tek geçişli parlama (bloom) yardımcısı
      extras.js        # kaleydoskop, sarmal, damla, havai fişek, girdap, mandala,
                       #   silüet, şimşek, dalgalı ızgara, lissajous, teller,
                       #   baloncuk, 3B dalga, yaylar, fırıldak
      bars.js centerbars.js blocks.js dots.js wave.js ribbon.js terrain.js
      circular.js radialwave.js starburst.js tunnel.js orb.js particles.js
      spectrogram.js sprites.js
scripts/
  start.js             # GUI başlatıcı (ELECTRON_RUN_AS_NODE'u temizler)
  gen-icons.js         # SVG -> ikonlar
  prepare-runtime.js   # Node çalışma zamanını Windows paket kaynaklarına kopyalar
docs/screenshots/      # README görselleri
```

Ayarlar otomatik olarak `%APPDATA%/soundvisualizer/settings.json` (Windows) dosyasına,
Studio presetleri ise `%APPDATA%/soundvisualizer/presets/` altında ayrı dosyalara kaydedilir.

### Testler

```bash
npm test               # 41 birim testi (formüller, tempo, Art-Net)
npm start -- --smoke   # motorların tamamı gerçek GPU'da
```

`npm test` matematiksel formülleri tanımlarından türetilmiş değerlerle, tempo kestirimini bilinen
tempolu sentetik sinyallerle ve ArtDMX paket düzenini bayt bayt doğrular.

Öz test (`--smoke`):

Kayıtlı **her** görselleştirici modunu ve **her** arkaplanı sırayla açar, yerleşik shader'ların
tamamını gerçek GPU'da derler, panelin her kategorisini çizer, çoklu ekranı ve karartmayı dener,
son olarak arayüzü İngilizceye alıp **çevrilmemiş metin** arar. Modlar elle `<script>` etiketiyle
yüklendiği için (paketleyici yok), yeni bir modu HTML'lerden birine eklemeyi unutmak sessiz bir
hata olurdu; bu test onu gürültülü hale getirir.

---

## ⌨️ Kısayollar

| Tuş | İşlev |
|-----|-------|
| `Ctrl` + `K` | Panelde ayar ara |
| `ESC` | Görselleştirmeyi **tüm ekranlarda** kapat / aramayı temizle |
| `Tab` | Studio kod editöründe girinti ekle |
| Ekrana tıklama | Ses başlatılamadıysa yeniden dene |

> Panelin üst çubuğundaki 🌑 **Karart** düğmesi sahneyi kapatmadan karartır; tekrar basınca
> önceki görünüm (arkaplan, görselleştirici, logo, medya) aynen geri gelir. Aynı düğme mobil
> kumandada ve MIDI/OSC eylemlerinde de vardır.


---

## 🗺️ Yol haritası

Projenin rakip uygulamalara göre nerede durduğu, neyin **yapıldığı** ve neyin
**bilerek yapılmadığı** (NDI/Spout, MilkDrop motorunun tamamı, WebGPU…)
[ROADMAP.md](ROADMAP.md) dosyasında açıkça yazılıdır.

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
