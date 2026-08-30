# CaYaDev Visualizer — Yol Haritası / Roadmap

Bu belge, projenin rakip uygulamalara göre nerede durduğunu ve neyin
gerçekten yapıldığını **dürüstçe** kaydeder. Bir satırın "yapıldı" görünmesi
için özelliğin uygulamada çalışıyor ve test edilmiş olması gerekir.

_This document records, honestly, where the project stands against comparable
applications and what has actually shipped. A row is only marked done when the
feature works in the application and has been tested._

---

## Durum tablosu / Status table

| Özellik / Feature | v1.3.1 | **v2.0.0** | Not / Note |
|---|:--:|:--:|---|
| Çoklu ekran / Multi-monitor | ✅ tek pencere | ✅✅ | Artık seçilen **her** ekranda ayrı pencere, aynı anda |
| Sistem sesi / System audio | ✅ | ✅ | WASAPI loopback |
| Çoklu kaynak / Multi-source | ✅ | ✅ | Kaynaklar FFT öncesi karıştırılır |
| Geniş preset ekosistemi / Large preset ecosystem | ❌ | ✅ | 31 görselleştirici + 19 arkaplan + Studio + `.svpack` paylaşımı |
| MilkDrop | ❌ | ◐ | Geri besleme motoru aynı görsel aileyi üretir; `.milk` **parametreleri** içe aktarılır. Per-frame denklem yorumlayıcısı **yok** |
| Canlı shader editörü / Live shader editor | ❌ | ✅ | Studio: GLSL, canlı önizleme, hata satırı, kendi kaydırıcıların |
| Shadertoy / ISF | ❌ | ✅ | İçe aktarma dönüştürücüleri; hiçbir servise bağlanılmaz |
| MIDI | ❌ | ✅ | Web MIDI, "Öğren", CC/Nota → herhangi bir ayar veya eylem |
| OSC | ❌ | ✅ | UDP dinleyici, elle yazılmış OSC 1.0 ayrıştırıcı |
| Spout / Syphon | ❌ | ❌ | Native SDK gerektirir — bkz. *Yapılmayanlar* |
| NDI | ❌ | ❌ | Native SDK + lisans gerektirir — bkz. *Yapılmayanlar* |
| Video girişi / Video input | ❌ | ✅ | Video dosyası katmanı (`sv-media://`), shader'larda `sv_media` |
| Web kamerası / Webcam | ❌ | ✅ | Kaleydoskop, renk kayması, sese bağlı yakınlaşma |
| OBS entegrasyonu / OBS integration | ❌ | ✅✅ | Tarayıcı kaynağı — eklenti kurulumu yok, gerçek saydamlık |
| 3B kompozisyon / 3D composition | ◐ | ◐ | Perspektif modlar (arazi, tünel, koridor, 3B dalga); gerçek 3B sahne grafiği yok |
| MP4 dışa aktarma / MP4 export | ✅ | ✅ | Yeni modların tamamı dahil |
| Çevrimdışı render / Offline render | ◐ | ✅ | Kare kare deterministik; ekran kaydı değil |
| Windows Dynamic Lighting | ✅✅ | ✅✅ | Bu sınıfta benzersiz |
| Topluluk paylaşımı / Community sharing | ❌ | ◐ | `.svpreset` / `.svpack` dosya paylaşımı. Merkezi mağaza **yok** (bilinçli tercih) |
| Mobil kumanda / Mobile remote | ❌ | ✅ | Sahneler, şablonlar, Studio presetleri; sırayla gezinme |
| AI sahne üretimi / AI scene generation | ❌ | ◐ | Metinden sahne kuran **çevrimdışı** kural motoru; sinir ağı değil |
| Modern GPU mimarisi / Modern GPU architecture | ◐ | ✅ | Studio motoru WebGL2; WebGPU henüz değil |

Gösterim: ✅ var · ✅✅ sınıfının üstünde · ◐ kısmen · ❌ yok
_Legend: ✅ present · ✅✅ best-in-class · ◐ partial · ❌ absent_

---

## Yapılmayanlar ve nedenleri / Not done, and why

Bunlar "unutuldu" değil; **bilerek** yapılmadı. Gerekçeleri açıkça yazıyoruz ki
kullanıcı neyi beklemeyeceğini bilsin.

### NDI ve Spout / Syphon
İkisi de üçüncü parti native kütüphane ister: NDI SDK ayrı bir lisans kabulü ve
platforma özel DLL, Spout ise derlenmiş bir yerel eklenti gerektirir. Bunları
yarım yamalak eklemek, çalışmayan bir menü öğesinden başka bir şey üretmezdi.

**Yerine ne var:** OBS için **tarayıcı kaynağı** aynı işi görür — üstelik
eklenti kurulumu olmadan ve gerçek saydamlıkla. Diğer VJ yazılımlarına
görüntü göndermek gerekiyorsa şimdilik OBS sanal kamerası üzerinden zincirlenebilir.

Mimari bu ekleme için hazır bırakıldı: `src/main/stream-server.js` çıkışı
soyutlanmış durumda, ileride bir native gönderici aynı kare akışına takılabilir.

### MilkDrop motorunun tamamı
MilkDrop presetleri kendi ifade diliyle yazılmış `per_frame` / `per_vertex`
denklemleri, warp ve composite shader'ları içerir. Bunun tam bir yorumlayıcısı
başlı başına bir proje büyüklüğündedir.

**Yerine ne var:** Aynı görsel aileyi üreten bir **geri besleme motoru**
(zoom / rotate / warp / decay / dalga bindirme, ping-pong kare tamponu) ve
`.milk` dosyalarının **sabit parametrelerini** bu motora çeviren bir içe
aktarıcı. Sonuç MilkDrop'un ruhunu verir, birebir aynı sahneyi değil — ve
dosya seçildiğinde kullanıcıya bu söylenir.

### WebGPU
Studio motoru WebGL2 üzerine kurulu. WebGPU (WGSL) daha modern, ama bugün
Shadertoy ve ISF ekosisteminin tamamı GLSL. Önce uyumluluk seçildi.

### Merkezi preset mağazası
Bilinçli tercih: uygulama hiçbir sunucuya bağlanmaz, hesap istemez, telemetri
göndermez. Paylaşım dosya üzerinden yapılır (`.svpreset`, `.svpack`) — kullanıcı
neyi kiminle paylaştığına kendisi karar verir.

### "AI" sahne üretimi
Sahne Üretici bir sinir ağı **değildir** ve öyle sunulmuyor. Yazdığınız metni
ağırlıklı bir anahtar kelime sözlüğüyle dört eksene (enerji, sıcaklık, aydınlık,
doku) indirger, sahneyi bu eksenlerden tohumlanmış deterministik bir üreticiyle
kurar. Tamamen çevrimdışıdır, anahtar istemez ve aynı metin + aynı tohum her
zaman aynı sahneyi verir.

---

## Sonraki adımlar / Next up

1. **WebGPU (WGSL) shader yolu** — WebGL2 yedekte kalarak.
2. **Studio çok geçişli shader** — ISF `PASSES` desteğinin tamamı.
3. **Native gönderici eklentisi** — NDI/Spout için isteğe bağlı, ayrı paket.
4. **Sahne zaman çizelgesi** — sahneler arası zamanlanmış/otomatik geçişler.
5. **macOS'ta gerçek yayın testi** — sunucu platformdan bağımsız ama denenmedi.
