# CaYaDev Visualizer — Yol Haritası / Roadmap

Bu belge, projenin rakip uygulamalara göre nerede durduğunu ve neyin
gerçekten yapıldığını **dürüstçe** kaydeder. Bir satırın "yapıldı" görünmesi
için özelliğin uygulamada çalışıyor ve test edilmiş olması gerekir.

_This document records, honestly, where the project stands against comparable
applications and what has actually shipped. A row is only marked done when the
feature works in the application and has been tested._

---

## Durum tablosu / Status table

| Özellik / Feature | v1.3.1 | v2.0.0 | **v2.1.0** | Not / Note |
|---|:--:|:--:|:--:|---|
| Çoklu ekran / Multi-monitor | ✅ | ✅✅ | ✅✅ | Seçilen **her** ekranda ayrı pencere |
| Sistem sesi / System audio | ✅ | ✅ | ✅ | WASAPI loopback |
| Çoklu kaynak / Multi-source | ✅ | ✅ | ✅ | FFT öncesi karıştırılır |
| Katman kompoziti / Layer compositing | ❌ | ❌ | ✅✅ | Sınırsız katman, **17 karışım modu**, katman başına ayar |
| Son-işlem efektleri / Post-FX | ❌ | ❌ | ✅ | **15 GPU efekti**, sıralanabilir, sese bağlanabilir |
| Görselleştirici modu / Visualizer modes | 14 | 31 | **32** | + 3B geometri motoru |
| Arkaplan / Backgrounds | 10 | 19 | 19 | Hepsi ortak palet ve şablonları kullanır |
| Renk şablonu / Color presets | 10 | 10 | **58** | Yedi grupta; Studio ve 3B motorda da geçerli |
| Matematiksel formüller / Formulas | ❌ | ❌ | **35** | 30'u sayısal olarak **test edilmiş** (`npm test`) |
| Gerçek 3B / True 3D | ❌ | ◐ | ✅ | Kendi matris matematiği; üçüncü parti 3B kütüphanesi yok |
| MilkDrop | ❌ | ◐ | ◐ | Geri besleme motoru + `.milk` parametre içe aktarımı |
| Canlı shader editörü / Live shader editor | ❌ | ✅ | ✅ | GLSL, canlı önizleme, hata satırı, kendi kaydırıcıların |
| Shadertoy / ISF | ❌ | ✅ | ✅ | İçe aktarma dönüştürücüleri; hiçbir servise bağlanılmaz |
| MIDI | ❌ | ✅ | ✅ | "Öğren", CC/Nota → herhangi bir ayar veya eylem |
| OSC | ❌ | ✅ | ✅ | UDP dinleyici, elle yazılmış OSC 1.0 ayrıştırıcı |
| Art-Net / DMX | ❌ | ❌ | ✅ | ArtDMX çıkışı; paket düzeni bayt bayt test edilir |
| BPM / tempo | ❌ | ❌ | ✅ | Periyot histogramı; ±0.5 BPM doğrulukla test edilmiş |
| Otomatik VJ / Auto VJ | ❌ | ❌ | ✅ | Ölçüye hizalı sahne, mod ve palet geçişleri |
| Spout / Syphon | ❌ | ❌ | ❌ | Native SDK gerektirir — bkz. *Yapılmayanlar* |
| NDI | ❌ | ❌ | ❌ | Native SDK + lisans gerektirir — bkz. *Yapılmayanlar* |
| Video / web kamerası girişi | ❌ | ✅ | ✅ | Shader'larda `sv_media` olarak da okunur |
| OBS entegrasyonu | ❌ | ✅✅ | ✅✅ | Tarayıcı kaynağı — eklenti yok, gerçek saydamlık |
| MP4 dışa aktarma | ✅ | ✅ | ✅ | Katmanlar ve efekt zinciri dahil |
| Çevrimdışı render | ◐ | ✅ | ✅✅ | Kare kare **deterministik** — regresyon testi buna dayanıyor |
| Windows Dynamic Lighting | ✅✅ | ✅✅ | ✅✅ | Bu sınıfta benzersiz |
| Topluluk paylaşımı | ❌ | ◐ | ◐ | `.svpreset` / `.svpack` dosyaları. Merkezi mağaza **yok** (bilinçli) |
| Mobil kumanda | ❌ | ✅ | ✅ | Sahneler, şablonlar, Studio presetleri; sırayla gezinme |
| AI sahne üretimi | ❌ | ◐ | ◐ | **Çevrimdışı** kural motoru; sinir ağı değil |
| Otomatik test / Automated tests | ❌ | ◐ | ✅ | 41 birim testi + her modu/efekti GPU'da çizen öz test |
| Modern GPU mimarisi | ◐ | ✅ | ✅ | WebGL2; WebGPU henüz değil (aşağıda gerekçesi) |

Gösterim: ✅ var · ✅✅ sınıfının üstünde · ◐ kısmen · ❌ yok
_Legend: ✅ present · ✅✅ best-in-class · ◐ partial · ❌ absent_

---

## Test edilebilirlik / Verifiability

Sayı saymak kolaydır; doğruluğu göstermek zordur. Bu yüzden iddiaların
arkasında çalıştırılabilir testler var:

```bash
npm test               # 41 birim testi (formüller, tempo, Art-Net)
npm start -- --smoke   # motorların tamamı gerçek GPU'da
```

- **Formüller:** 35 formülün 30'u `accuracy: 'exact'` işaretli ve
  `tests/formulas.test.js` her birini tanımından elle türetilmiş değerlerle
  sınıyor (Viviani eğrisinin küre üzerinde kalması, simidin boru yarıçapı,
  Chladni'nin m↔n antisimetrisi, Clifford/de Jong haritalarının sınırları…).
  Katalog testi, `exact` işaretli bir formülün test edilmeden eklenmesini
  engelliyor. Kalan 5'i sayısal integrasyonla çalışan çekiciler
  (`accuracy: 'approx'`) — onlarda yön ve sınırlılık doğrulanıyor.
- **Tempo:** bilinen tempolu sentetik sinyallerle ölçülüyor
  (90/120/128/140/174 → 89.8/120.4/127.9/140.0/173.7).
- **Art-Net:** ArtDMX başlığı bayt bayt, kanal hesabı değer değer.
- **Öz test:** kayıtlı **her** görselleştirici modunu, **her** arkaplanı,
  **her** son-işlem efektini ve **her** formülü gerçek GPU'da çizip boş
  olmadığını ölçüyor; ardından arayüzü İngilizceye alıp çevrilmemiş metin
  arıyor.

---

## Yapılmayanlar ve nedenleri / Not done, and why

Bunlar "unutuldu" değil; **bilerek** yapılmadı.

### NDI ve Spout / Syphon
İkisi de üçüncü parti native kütüphane ister: NDI SDK ayrı bir lisans kabulü
ve platforma özel DLL, Spout ise derlenmiş bir yerel eklenti gerektirir.
Bunları yarım eklemek, çalışmayan bir menü öğesinden başka bir şey üretmezdi.

**Yerine ne var:** OBS için **tarayıcı kaynağı** aynı işi görür — eklenti
kurulumu olmadan ve gerçek saydamlıkla. Mimari bu ekleme için hazır:
`src/main/stream-server.js` çıkışı soyutlanmış durumda.

### MilkDrop motorunun tamamı
MilkDrop presetleri kendi ifade diliyle yazılmış `per_frame` / `per_vertex`
denklemleri, warp ve composite shader'ları içerir. Tam bir yorumlayıcısı
başlı başına bir proje büyüklüğündedir.

**Yerine ne var:** Aynı görsel aileyi üreten bir **geri besleme motoru** ve
`.milk` dosyalarının **sabit parametrelerini** çeviren bir içe aktarıcı.
Dosya seçildiğinde kullanıcıya bunun birebir aynı sahne olmadığı söylenir.

### WebGPU
Studio motoru WebGL2 üzerine kurulu. WebGPU (WGSL) daha modern, ama bugün
Shadertoy ve ISF ekosisteminin tamamı GLSL ve bu alanda WebGPU'yu ayırt edici
olarak sunan bir uygulama yok. Uyumluluk bilinçli olarak seçildi.

### Ableton Link
Ağ üzerinden tempo paylaşımı ayrı bir protokol yığını ve keşif servisi ister.
**Yerine ne var:** kendi BPM kestirimi (test edilmiş), elle tempoya vurma ve
BPM kilidi.

### Merkezi preset mağazası
Bilinçli tercih: uygulama hiçbir sunucuya bağlanmaz, hesap istemez, telemetri
göndermez. Paylaşım dosya üzerinden yapılır (`.svpreset`, `.svpack`).

### "AI" sahne üretimi
Sahne Üretici bir sinir ağı **değildir** ve öyle sunulmuyor. Metni ağırlıklı
bir anahtar kelime sözlüğüyle dört eksene indirger ve sahneyi bu eksenlerden
tohumlanmış deterministik bir üreticiyle kurar. Tamamen çevrimdışıdır.

---

## Sonraki adımlar / Next up

1. **Studio'da çok geçişli shader ve vertex shader düzenleme** — ISF `PASSES`
   desteğinin tamamı.
2. **Kayıt düğmesi** — canlı görüntüden hızlı GIF / kısa MP4.
3. **Katman grupları** — birden çok katmanı tek fader'la yönetme.
4. **Native gönderici eklentisi** — NDI/Spout için isteğe bağlı, ayrı paket.
5. **macOS'ta gerçek yayın ve Art-Net testi** — kod platformdan bağımsız ama
   denenmedi.
