<div align="center">

<img src="assets/icon.svg" alt="CAYADEV Visualizer" width="128" height="128" />

# CAYADEV Visualizer

### Sahip olduğunuz her ekran için sese tepki veren görseller

**Windows** & **macOS** · Electron + WebGL2 · Yerel WASAPI / CoreAudio loopback

[![Lisans: MIT](https://img.shields.io/badge/Lisans-MIT-e11d2a.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-111827.svg)](#-paketleme--dağıtım)
[![Electron](https://img.shields.io/badge/Electron-33-47848F.svg)](https://www.electronjs.org/)
[![Test](https://img.shields.io/badge/test-623%20geçiyor-2ea043.svg)](#testler)
[![cayadev.com](https://img.shields.io/badge/cayadev.com-e11d2a.svg)](https://cayadev.com)

</div>

<div align="center">

| | |
|:---:|:---:|
| ![Strobe Wall](docs/screenshots/scene-club-strobe.png) | ![Hyper Tunnel](docs/screenshots/scene-tunnel.png) |
| ![Lorenz çekicisi](docs/screenshots/scene-lorenz.png) | ![Galaksi](docs/screenshots/scene-galaxy.png) |
| ![Synthwave](docs/screenshots/scene-synthwave.png) | ![Plazma](docs/screenshots/scene-plasma.png) |

</div>

---

## Hareket halinde

<div align="center">

| Hyper Tunnel | 3B çekici |
|:---:|:---:|
| ![Tünel](docs/screenshots/demo-tunnel.gif) | ![Geometri](docs/screenshots/demo-geometry.gif) |
| **Akış alanı** | **MilkDrop geri beslemesi** |
| ![Akış alanı](docs/screenshots/demo-flowfield.gif) | ![MilkDrop](docs/screenshots/demo-milkdrop.gif) |
| **Katmanlı sahne** | **Frekans barları** |
| ![Görselleştirici](docs/screenshots/demo-visualizer.gif) | ![Barlar](docs/screenshots/demo-bars.gif) |

</div>

> Bu sayfadaki her görsel ve klip `npm start -- --shots` ile, 120 BPM'lik sentetik bir sinyalle
> üretiliyor. Gerçek seste müziği takip ederler.

---

## Müzik videosu düzenleri

Şarkı videoları ve resmî kanallar için sade düzenler — kulüp ve VJ malzemesinden bilinçli olarak
ayrı tutuldu.

<div align="center">

| | |
|:---:|:---:|
| ![Label Card](docs/screenshots/scene-broadcast-label.png) | ![Minimal White](docs/screenshots/scene-broadcast-minimal.png) |
| ![Baseline Bars](docs/screenshots/scene-broadcast-line.png) | ![Amber Room](docs/screenshots/scene-broadcast-amber.png) |

</div>

- **Sekiz hazır düzen** — Label Card, Artwork Card, Baseline Bars, Amber Room, Minimal White,
  Quiet Frame, Corner Meter, Centre Strip.
- **Bar yerleşimi** — genişlik, yatay konum, yükseklik ve taban çizgisi; her biri kadranın oranı
  olarak. Bloğu köşeye, ortaya ya da ince bir şerit olarak koyun.
- **Logo barların arkasında değil yanında**, hemen yanında parça ve sanatçı adı.
- **Parça bilgisi** çalan parça alanlarından gelir; başlık ve sanatçı ayrı katmanlar olarak, kendi
  boyut ve kalınlıklarıyla çizilebilir.
- **Arkada sabit bir görsel ya da sakin bir video**, palet sisteminin tamamı kullanılabilir.

---

## Tayf ölçümü

Barlar tahmin edilmiyor, ölçülüyor. Dört frekans ölçeği, desibel genlik ölçeği ve gerçek balistik.

- **Frekans ölçeği** — logaritmik, doğrusal, mel ya da bark.
- **Genlik ölçeği** — doğrusal ya da desibel, ayarlanabilir tabanla. Müziğin sessiz ayrıntısını
  taban çizgisine yapışmaktan kurtaran şey dB'dir.
- **Balistik** — ayrı atak ve bırakma; barlar hızlı fırlar, yavaş iner. Kare hızından bağımsız.
- **Komşu yayılımı** — tepeleri ezmeden genişletir.
- **Profil yumuşatma** — daha yumuşak bir zarf için simetrik komşu ortalaması.
- **Eğim** — oktav başına dB, böylece tiz uç kalıcı olarak ezik kalmaz.

Bir FFT kutusundan dar olan bantlar, bandın merkez frekansında interpole edilir; böylece komşu
barlar aynı kutuyu paylaşmak yerine kendi değerlerini okur. Motoru 27 test kapsıyor; biri bar
profilinde basamak olmadığını doğruluyor.

---

## Yönetici paneli

<div align="center">

![Sahne paneli](docs/screenshots/panel-scene.png)

![Yönetici paneli](docs/screenshots/admin-panel.png)

</div>

- **Yedi kategori** — Sahne, Ses, Işık, Çıkış, Kontrol, Studio, Kitaplık.
- **Her şey canlı** — her değişiklik çıkış pencerelerine anında gider ve kendini kaydeder.
- **Değişiklik rozetleri** her kartta ve kategoride; bölümü ya da kategorinin tamamını varsayılana
  döndürme düğmesiyle.
- **Arama** her kategorideki her ayarda.
- **Türkçe ve İngilizce**, çalışırken değişir; arayüzde çevrilmemiş tek bir metin kalırsa öz test
  başarısız olur.

---

## Katmanlar ve efektler

<div align="center">

| Katmanlar | Efekt zinciri |
|:---:|:---:|
| ![Katmanlar](docs/screenshots/panel-layers.png) | ![Efektler](docs/screenshots/panel-effects.png) |

</div>

- **Sınırsız katman**; her birinin kendi kaynağı, karışım modu, saydamlığı, dönüşümü ve ses
  tepkisi var. Listede en üstteki katman görüntüde de en üsttedir.
- **17 karışım modu**, tek fader'lı gruplar, solo, sessiz ve kilit.
- **Maskeler** — başka bir katmandan alfa, ayrıca şekil ve gradyan maskeleri.
- **40 GPU efekti**; sıralanabilir, sese bağlanabilir ve bileşiğin yanı sıra katman başına da
  kullanılabilir.
- **A/B çapraz geçişi** katman grupları arasında, eşit güç eğrisiyle.
- **Yığının tamamı kapatılabilir**; sahne katman listesini kaybetmeden yalın Arkaplan +
  Görselleştirici kurulumuna döner.

---

## Modülasyon

<div align="center">

![Modülasyon](docs/screenshots/panel-modulation.png)

</div>

- **Her kaynaktan her ayara** — LFO'lar, zarf takipçileri, örnekle-ve-tut ve rastgele; yapılandırmadaki
  herhangi bir değere yönlendirilir.
- **Sekiz LFO şekli**, hız Hz cinsinden ya da algılanan tempoya kilitli vuruş bölmeleriyle.
- **Eğri şekillendirme** — üs, S eğrisi, kuantalama, ters çevirme — artı yönlendirme başına
  yumuşatma ve eğim sınırlama.
- **Sekiz makro düğmesi**, atanabilir; MIDI ve uzaktan kumandaya açık.
- **Çevrimdışı dışa aktarımda deterministik**: LFO fazı çizim saatinden geliyor, kare atlamak onu
  kaydıramaz.

---

## Derin ses çözümlemesi

<div align="center">

| Canlı ölçümler | Kroma çemberi |
|:---:|:---:|
| ![Çözümleme](docs/screenshots/panel-analysis.png) | ![Kroma](docs/screenshots/scene-chroma.png) |

</div>

- **Tonalite ve akor**, sabit-Q kroma vektöründen — FFT kutuları yerine Goertzel filtre bankasıyla,
  çünkü 2048 örnekte bas bölgesi kutularla ayrılamıyor.
- **Perde takibi** YIN ile.
- **Armonik / vurmalı ayrıştırması** ve bant başına vuruş algılayıcıları (kick, snare, hat).
- **Tınısal betimleyiciler** — merkez, dönüm, düzlük, tepe faktörü.
- **Gürlük, dinamik, gerçek tepe, stereo genişlik ve korelasyon.**
- Ölçümlerin hepsi modülasyon kaynağı olarak kullanılabilir.

---

## 3B geometri ve formüller

<div align="center">

| | |
|:---:|:---:|
| ![Klein şişesi](docs/screenshots/scene-klein.png) | ![Süpershape](docs/screenshots/scene-supershape.png) |
| ![Lorenz](docs/screenshots/scene-lorenz.png) | ![Çekici alanı](docs/screenshots/scene-attractor.png) |

</div>

<div align="center">

![3B geometri paneli](docs/screenshots/panel-geometry.png)

</div>

- **98 formül** — 30 düzlem eğrisi, 12 uzay eğrisi, 29 yüzey, 27 garip çekici.
- **13 katı cisim** — beş platonik katı, alt bölme denetimli jeodezik küreler, dört L-sistemi ve üç
  yinelemeli fonksiyon sistemi.
- **Kendi matris matematiği.** Üçüncü parti 3B kütüphanesi yok.
- **Kadraj bildirilmiyor, ölçülüyor.** Bir çekicinin ilk yinelemeleri sınırlayıcı kutusu için
  taranıyor ve bir test her sistemin görüş hacminin içine düştüğünü doğruluyor.

---

## MilkDrop

<div align="center">

![MilkDrop](docs/screenshots/scene-milkdrop.png)

</div>

- **Preset dili gerçekten çalışıyor** — sözcük çözümleyici, ayrıştırıcı ve JavaScript kapanışlarına
  derleme. `per_frame` ve `per_pixel` denklemleri gerçek bir warp ağını geri beslemeyle sürüyor.
- **`.milk` içe aktarma**, çok dosyalı paketler dahil; derleme hataları dosya dosya bildiriliyor.
- **Preset metninden üretilen koda hiçbir şey kopyalanmıyor.** Tanımlayıcılar havuz indekslerine
  dönüşüyor, yani bir preset JavaScript kaçıramaz. Bir fuzz testi bunu doğruluyor.

---

## Studio — kendi shader'ınızı yazın

<div align="center">

| Studio | Yerleşik shader'lar |
|:---:|:---:|
| ![Studio](docs/screenshots/panel-studio.png) | ![Su yüzeyi](docs/screenshots/scene-caustics.png) |

</div>

- **GLSL düzenleyici**; canlı önizleme, hata satırı bildirimi ve kendi kaydırıcılarınız.
- **42 yerleşik shader**, hepsi öz testte gerçek GPU'da derleniyor.
- **Shadertoy ve ISF içe aktarma**, yerel dönüştürücülerle. Hiçbir servise bağlanılmıyor.

---

## Projeksiyon haritalama

<div align="center">

![Haritalama](docs/screenshots/panel-mapping.png)

</div>

- **Köşe düzeltme** gerçek bir homografi olarak; payda `gl_Position.w` alanına yazılıyor, böylece
  doku perspektif olarak doğru kalıyor.
- **Ağ bükme**, kontrol noktalarından geçen Catmull-Rom ızgarasıyla.
- **Kenar harmanlama** çoklu projeksiyon kurulumları için; eğrilerin örtüşme boyunca tam olarak
  1'e toplandığı test ediliyor.
- **Ekran başına kırpma, renk düzeltme ve çokgen maskeler**, artı hizalama ızgaraları ve test
  desenleri.

---

## Sahne geçişleri

<div align="center">

![Geçişler](docs/screenshots/panel-transition.png)

</div>

- **18 geçiş** — çapraz geçiş, erime, silme, kaydırma, parlaklık silme, glitch, zum, bulanıklık,
  flaş.
- **Kapatılabilir**, sahnelerin kesme ile değişmesini istiyorsanız.
- Herhangi bir ayar değil, **sahne** değiştiğinde tetikleniyor; kaydırıcı sürüklemek geçiş
  başlatmaz.

---

## Hazır şablonlar

<div align="center">

![Şablonlar](docs/screenshots/panel-templates.png)

</div>

- **Dokuz grupta 72 bitmiş sahne**: Kulüp, Ambiyans, Yayın, Müzik Videosu, Müzik, Ekran Koruyucu,
  3B Geometri, Tür ve Etkinlik.
- **Tek tık**, ve ses aygıtınız, ekran seçiminiz, yayın ve aydınlatma ayarlarınız korunur — bir
  şablonu denemek çalışan kurulumu bozmamalı. Bir test bunu doğruluyor.

<div align="center">

| | |
|:---:|:---:|
| ![Aurora](docs/screenshots/scene-aurora.png) | ![Drum and bass](docs/screenshots/scene-dnb.png) |
| ![Gala](docs/screenshots/scene-gala.png) | ![Akış alanı](docs/screenshots/scene-flowfield.png) |

</div>

---

## Metin ve şarkı sözü

<div align="center">

![Metin](docs/screenshots/scene-text.png)

</div>

- **Sese tepki veren tipografi**, karakter başına tepkiyle.
- **LRC ve SRT içe aktarma**; biçim içerikten anlaşılıyor, gelişmiş LRC kelime zamanlamaları
  destekleniyor.
- **Zamanlama düzenleyici**, LRC'ye geri yazan bir senkron kaydırmasıyla.
- **Çalan parça bilgisi**, düzenlenebilir; başlık ve sanatçı ayrı katmanlara bağlanabilir.

---

## Kayıt ve dışa aktarma

<div align="center">

![Kayıt](docs/screenshots/panel-record.png)

</div>

- **Tek tuşla kayıt**: ekranda göründüğü gibi — canlı sesle, modülasyon, geçiş ve efektler dahil.
- **MP4, WebM, GIF ve PNG.** GIF iki geçişli palet üretimi kullanıyor, çünkü tek geçiş gözle
  görülür bantlanma yapıyor.
- **PNG anlık görüntü** 4× çözünürlüğe kadar.
- **En sık kullanılan en-boy oranları** için hazır profiller.
- **Çevrimdışı video dışa aktarımı** bir ses dosyasını kare kare, deterministik olarak render
  ediyor — görsel regresyon testlerinin dayandığı özellik de bu.

---

## Yayın çıkışı — OBS ve tarayıcı

**Çıkış → Yayın Çıkışı**'nı açın; uygulama saydam bir katman sayfası servis eder.

- OBS'ye **Tarayıcı Kaynağı** olarak ekleyin. Eklenti yok, gerçek saydamlık var.
- Katman sayfası masaüstü penceresiyle **aynı motoru** çalıştırır; gördüğünüz şey yayına giden şeydir.
- Ağ üzerinden çalışır, yani görselleştirici bir bilgisayarda, OBS başka birinde olabilir.

### Mobil kumanda

<div align="center">

![Kontrol paneli](docs/screenshots/panel-control.png)

</div>

Aynı sunucu, sahneler, şablonlar ve Studio presetleri için telefon boyutunda bir kumanda sayfası da
barındırıyor; yanında MIDI ve OSC kontrol yüzeyleri.

---

## Klasik görünüşler

Uygulamanın ilk günden beri gelen biçimleri, hâlâ tek tık uzakta.

<div align="center">

| Barlar | Barlar (aynalı) | İnce barlar |
|:---:|:---:|:---:|
| ![Barlar](docs/screenshots/visualizer-bars.png) | ![Aynalı](docs/screenshots/visualizer-bars-mirror.png) | ![İnce](docs/screenshots/visualizer-bars-thin.png) |
| **Merkez** | **Çember** | **Çember (gökkuşağı)** |
| ![Merkez](docs/screenshots/visualizer-center.png) | ![Çember](docs/screenshots/visualizer-circular.png) | ![Gökkuşağı](docs/screenshots/visualizer-circular-rainbow.png) |
| **Dalga** | **Dalga çizgisi** | **Düz renk** |
| ![Dalga](docs/screenshots/visualizer-wave.png) | ![Dalga çizgisi](docs/screenshots/visualizer-wave-line.png) | ![Düz renk](docs/screenshots/visualizer-solid.png) |

</div>

<div align="center">

| Tüm görselleştirici modları | Tüm arkaplanlar |
|:---:|:---:|
| ![Modlar](docs/screenshots/modes-visualizer.png) | ![Arkaplanlar](docs/screenshots/modes-background.png) |

</div>

---

## Nedir

Tek motor, üç çıkış yolu:

- **Yönetici paneli** — her ayarın canlı değiştirildiği kontrol ekranı.
- **Görselleştirme pencereleri** — seçtiğiniz *her* ekranda tam ekran.
- **Yayın sayfası** — OBS için saydam bir katman, artı telefonunuz için kumanda.

Ses; **sistem çıkış aygıtlarından** (hoparlör veya kulaklık loopback), **mikrofon ve giriş
aygıtlarından** ya da aynı anda birden çok kaynaktan gelir ve yerel `audify` modülüyle FFT
çözümlemesinden önce karıştırılır.

---

## Ses yakalama nasıl çalışır

Yakalama tarayıcı penceresinde değil, **ana süreçte** çalışır. Yerel modül seçilen aygıtı
Windows'ta WASAPI loopback, macOS'ta CoreAudio ile okur, FFT'yi hesaplar ve kareleri arayüze
gönderir.

- **Sistem sesi** doğrudan çıkış aygıtından yakalanır — "stereo mix" gerekmez.
- **Mikrofon ve hat girişleri** aynı yolla yakalanır.
- **Birden çok kaynak** çözümlemeden önce karıştırılır.
- **macOS'ta** sistem sesini yakalamak için **BlackHole** gibi sanal bir aygıt gerekir; mikrofon
  doğrudan çalışır.

---

## Geliştirme ortamında çalıştırma

```bash
npm install
```

```bash
npm start
```

Geliştirici kipi (DevTools açık):

```bash
npm run dev
```

> `npm install` kurumsal ağ/proxy yüzünden sertifika hatası verirse PowerShell'de
> `$env:NODE_OPTIONS="--use-system-ca"` ile yeniden deneyin.

> Kaynaktan çalıştırmak için **Node.js** kurulu olmalı. Windows sürüm paketleri, ses yakalama
> yardımcısı için bir Node çalışma zamanıyla birlikte gelir.

---

## Paketleme / dağıtım

```bash
npm run icons
```

```bash
npm run dist:win
```

```bash
npm run dist:mac
```

| Platform | Çıktı | Durum |
|----------|-------|-------|
| Windows  | `CAYADEV Visualizer Setup ….exe` (kurulum), `…-portable.exe` | ✅ Tam çalışır |
| macOS    | `…-darwin-arm64/`, `…-darwin-x64/` (.app), Mac'te DMG | ⚠️ macOS'ta paketleyin |

**macOS yerel ses notu:** `audify` Windows'tan macOS'a **çapraz derlenemez**. Windows'ta üretilen
macOS `.app` paketlerinde arayüz ve görseller çalışır ama ses yakalama çalışmaz. Tam çalışan bir
macOS paketi için `npm install && npm run dist:mac` komutunu bir **Mac**'te çalıştırın.

---

## Kullanım

1. **Ekranlar** menüsünden bir veya **birkaç** ekran, ardından bir veya daha fazla **ses kaynağı**
   seçin.
2. **▶ Görselleştiriciyi Aç**'a basın; seçili her ekranda tam ekran görsel başlar.
3. Sağdaki kartlardan istediğinizi değiştirin — anında uygulanır ve kendini kaydeder.
4. Yayın yapıyorsanız **Çıkış → Yayın Çıkışı**'nı açıp verdiği adresi OBS'de bir **Tarayıcı
   Kaynağı**'na yapıştırın.
5. Kendi efektinizi yazmak için **Studio**'ya, bitmiş bir sahneden başlamak için **Kitaplık →
   Hazır Şablonlar**'a gidin.
6. **Video Dışa Aktarma** ile bir ses dosyasını seçtiğiniz çözünürlük, kare hızı ve kalitede MP4'e
   render edin.
7. Herhangi bir görselleştirme penceresinde **ESC** hepsini kapatır.

---

## Testler

```bash
npm test
```

```bash
npm start -- --smoke
```

**623 birim testi, hepsi geçiyor.** Satır çalıştırmak için değil, cevap denetlemek için yazıldılar:

- **Formüller**, tanımlarından elle türetilmiş değerlerle sınanıyor — Viviani eğrisinin küre
  üzerinde kalması, simidin boru yarıçapı, Chladni'nin m↔n antisimetrisi, her çekicinin sınırlı
  kalması ve görüş hacminin içine düşmesi.
- **Tempo**, bilinen BPM'li sentetik sinyallerle ölçülüyor (90/120/128/140/174 →
  89.8/120.4/127.9/140.0/173.7).
- **Çözümleme**, cevabı bilinen sinyallerle sınanıyor: bilinen bir akor o akor olarak, 220 Hz'lik
  bir ton 220 Hz olarak dönmeli.
- **Art-Net**, ArtDMX başlığına karşı bayt bayt doğrulanıyor.
- **Yapılandırma göçü**, 1.3 ve 2.0 ayar dosyalarını tek bir değer kaybetmeden açıyor.
- **Preset ve paket yükleyicilerinin fuzz'lanması**, hiçbir MilkDrop presetinin JavaScript
  kaçıramayacağını doğruluyor.

**GPU öz testi** kayıtlı her modu, arkaplanı, efekti, shader'ı, formülü ve geçişi gerçek GPU'da
çizip sonucun boş olmadığını ölçüyor. Ardından arayüzü İngilizceye alıp çevrilmemiş metin arıyor ve
otomasyonun kamerayı hiç açmadığını doğruluyor.

---

## Proje yapısı

```
src/
  main/        Electron ana süreci: pencereler, ses yakalama, IPC, yayın sunucusu
  admin/       Yönetici paneli
  visualizer/  Çıkış penceresi: katman yığını, modlar, efektler
  exporter/    Çevrimdışı, deterministik video dışa aktarımı
  shared/      DOM'suz motorlar: tayf, modülasyon, çözümleme, formüller,
               geçişler, bükme, MilkDrop, şablonlar, şarkı sözü, katı cisimler
  web/         OBS katmanı ve mobil kumanda
tests/         Birim testleri, `npm test` ile koşar
docs/          Yol haritası, plan ve ekran görüntüleri
```

Ortak motorlar DOM, GPU ve ses aygıtı bilmeyen saf aritmetiktir; testleri Node'da koşar.

---

## Kısayollar

| Tuş | Eylem |
|-----|-------|
| `ESC` | Tüm görselleştirme pencerelerini kapat |
| `F11` | Tam ekranı aç/kapat |
| `Space` | Karartma |
| `Ctrl` + `S` | PNG anlık görüntü |
| `Ctrl` + `R` | Kaydı başlat / durdur |

---

## Yol haritası

[ROADMAP.md](ROADMAP.md) neyin gerçekten yapıldığını ve planlanan her sürümün neye ayrıldığını
kaydediyor — v3.1.0'da Timeline ve Clip Deck, v3.1.1'de yerel göndericiler, v3.1.2'de uygulama
başına ses yakalama, v3.1.3'te çok daha geniş ve çok daha hızlı video dışa aktarımı, v3.1.4'te
yayın düzeni editörü, v3.2.0'da yedeklilik ve kare senkronu. Ayrıca neyin **yapılmadığını** ve
nedenini de dürüstçe listeliyor.

---

## Lisans

MIT — bkz. [LICENSE](LICENSE).

<div align="center">

**[cayadev.com](https://cayadev.com)**

</div>
