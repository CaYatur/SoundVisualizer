# PC ↔ Android Bağlantısı — Kapsamlı Plan (taslak, onay bekliyor)

Tarih: 24.11.2026 · Ana issue: #1054 · Durum: ONAYLANDI 24.11.2026 (kararlar §9).

**İlerleme:** B0 taslakları onaylandı (tasarım tuvali, ekran 14–22). B1 PC tarafı main'de (#1122), telefon tarafı bu belgeyle birlikte dev/android'de. Protokol: [docs/PHONE-LINK.md](../PHONE-LINK.md).
Kural: Plan sırasında görmediğim bir durum çıkarsa bu belgeye "Ek" olarak yazılır ve aynı işe dahil edilir (izin verildi).

---

## 1. Amaç

Telefon, PC uygulamasını **neredeyse tamamen** yönetebilsin:
- sahneleri, katmanları, efektleri, renkleri, metin ve sözleri, **zaman çizelgesini** düzenleme,
- canlı gösteri denetimi: sahne geçişi, karartma, T-bar, klip destesi, makrolar, tempo,
- çıkışlar (ekranlar, yüzen pencere), ses kaynakları, dışa aktarma başlatma,
- PC'nin görüntüsünü telefonda canlı izleme,
- telefonun sesini PC'ye köprüleme (PC görselleştiricisi telefonun çaldığına tepki verir),
- telefon ile PC arasında sahne ve dosya aktarma.

Telefon uygulaması tek başına da eskisi gibi çalışmaya devam eder. Bağlantı isteğe bağlıdır.

## 2. PC'de hazır olan ve yeniden kullanılacak yapı (ölçüldü, kodda var)

| Parça | Dosya | Bağlantıda kullanımı |
|---|---|---|
| Yayın sunucusu: HTTP + elle yazılmış WebSocket, LAN anahtarı, jeton | `src/main/stream-server.js` | Bağlantının taşıyıcısı (yeni `kind=phone` istemci türü) |
| Web kumanda komutları: izinli yollar, OSC ağacı, adlı eylemler | `src/main/remote-commands.js`, `main.js applyRemoteCommand` | Canlı denetim komutları |
| Canlı özet (seviye, tempo, çizelge, karartma) saniyede 5 kez | `main.js remoteLiveTimer` | Telefondaki canlı göstergeler, çizelge kafası |
| **MCP araç katmanı: ~100 doğrulamalı araç** | `src/shared/mcp.js` | **Yapısal işlemler** için: sahne kaydet/sil/yeniden adlandır, preset kaydet/sil, dışa aktarma, çıkış aç/kapa, kayıt, önizleme JPEG'i. Ayar düzenlemenin kendisi bu araçlardan geçmez (bkz. 3.5) |
| Panelin yama yolu | `main.js applyConfigPatch` (üst düzey anahtar yaması) | **Ayar düzenlemenin yolu** (3.5), önüne doğrulama bekçisi konarak |
| Panelin dış değişikliği alması | `notifyAdmin('external-config')` | Telefon düzenleyince PC paneli kendini tazeler |
| Ağ ses köprüsü girişi (bekle / köprü / yerele dön) | `audio-bridge.js`, `bridge-input.js`, `docs/AUDIO-BRIDGE.md` | Telefon sesi bu girişe yeni kaynak olarak bağlanır |
| OBS sayfası: aynı motor, ses kareleri WebSocket'ten | `stream-server.js` `/overlay` | Telefonda canlı önizlemenin ve "ek ekran" kipinin modeli |
| Canlı tuval JPEG'i | `sv_get_preview` | "Gerçek görüntü" önizlemesi |
| Kitaplık listeleri, mod küçük resimleri, logo/medya dosyası yolları | `/mode-thumb`, `/logo-file`, `media-lib:list`… | Telefonda PC kitaplığından seçim |
| Çoklu kopya ve yedeklilik eşleri | `remote-peers.js`, `redundancy.js` | Telefon birincile bağlanır, yedek rolünde yazım reddedilir |

Telefonda hazır olan: bütün düzenleyici ekranlar (katmanlar, sahne, metin, tema, zaman çizelgesi `shell-timeline.js` + ortak `timeline*.js`), ortak ses analizi (`src/shared/audio-spectrum.js`), dört ses kaynağı, ön plan servisi, yedek biçimi (.svbackup), CDP ile probe altyapısı.

**Sonuç: iş kolay değil ama temel büyük ölçüde hazır.** Yeni olanlar: güvenli eşleşme, telefon istemci türü, "uzak ayar deposu" (telefon ekranlarının PC'yi düzenlemesi), ses köprüsü kaynağı, önizleme kanalı, dosya aktarma, PC'de "Telefon Bağlantısı" paneli.

## 3. Mimari

### 3.1 Taşıma
- Aynı Wi-Fi / yerel ağ (telefonun kendi hotspot'u da olur). İnternet üzerinden bağlantı **yok** (bulut aracı yok, "tamamen kendi içimizde" ilkesi).
- Kanal: yayın sunucusunun WebSocket'i, yeni yol `/link`, istemci türü `phone`. Aynı port, aynı LAN anahtarı.
- Telefonda bağlantıyı **Kotlin tarafı** tutar (`link/PcLinkService`): uygulama arka plandayken de ses köprüsü sürsün diye mevcut ön plan servisinin içinde. Arayüz (JS) iletileri ana makine köprüsünden alır/verir.
- USB ile bağlantı (adb reverse) yalnız geliştirme/sınama içindir, kullanıcı özelliği değil. (Ek ihtiyaç doğarsa ayrıca değerlendirilir.)

### 3.2 Güvenlik (en kritik bölüm)
Yerel ağdaki trafik şifresiz HTTP. Bu yüzden şifreleme uygulama katmanında yapılır:
1. **Eşleşme, ECDH P-256 anahtar değişimi** (Node `crypto` ve Android `KeyAgreement`, ek bağımlılık yok).
   - **QR ile:** QR, PC'nin adresini, portunu, PC kimliğini, PC açık anahtarının parmak izini ve tek kullanımlık eşleşme sırrını taşır. Telefon bağlanınca parmak izini doğrular. Araya giren biri taklit edemez.
   - **Elle (QR okunamazsa):** Adres ve 6 haneli eşleşme kodu girilir. Ardından **iki ekranda aynı 6 haneli doğrulama sayısı** çıkar (Bluetooth'taki gibi). Kullanıcı PC'de "Aynı, onayla"ya basar.
   - **Araya girme koruması (önce taahhüt, sonra açıklama):** Doğrulama sayısı tek başına yetmez. Araya giren biri sayı tutana kadar anahtar deneyebilirdi. Bu yüzden her iki taraf önce kendi açık anahtarının ve rastgele bir değerin **özetini** yollar, ancak karşı tarafın özetini aldıktan sonra anahtarı açıklar. Saldırganın bir oturumda tek denemesi kalır, tutturma olasılığı milyonda birdir. Başarısız eşleşme kodu bozar.
   - Eşleşme kodu 2 dakika geçerli, tek kullanımlık. Yanlış denemeler sınırlı (5 deneme, sonra kod yenilenir).
2. **Her ileti AES-256-GCM** ile şifreli. **Her yönün ayrı anahtarı ve ayrı sayacı var** (aynı nonce iki kez kullanılmaz). Eski iletiyi yeniden oynatma reddedilir. Oturum anahtarları her bağlantıda cihaz anahtarından yeniden türetilir.
3. **Cihaz başına kalıcı anahtar.** PC'de yalnız özeti saklanır. Telefonda Android Keystore ile korunan depoda durur.
4. **PC'de cihaz listesi:** ad, model, izin düzeyi, son görülme. Tek tıkla bağlantı kesilir ve cihaz silinir. Bütün cihazlar tek düğmeyle unutulur.
5. **İzin düzeyleri** (cihaz başına, PC'de ya da telefonda seçilir; **varsayılan "Tam"**, kullanıcı kararı: iki taraftan da tam yönetim):
   - *İzle:* önizleme ve durum.
   - *Kumanda:* sahne geçişi, karartma, T-bar, deste, makro, tempo, çizelge oynat/durdur.
   - *Düzenleme:* ayar, katman, sahne, zaman çizelgesi, preset düzenleme ve kaydetme.
   - *Tam:* çıkış açma/kapama, ses kaynakları, dışa aktarma, ışık, telefondan PC'ye dosya gönderme.
   - *Tam* düzeyde ek olarak, PC'de onay penceresiyle: güncelleme indirme/kurma, ses onarımı, MIDI/OSC eşleme, yedeklilik devri ve geri verme.
   - **Hiçbir düzeyde olmayanlar (güvenlik sınırı):** PC'de keyfi dosya yolu okuma/yazma, yayın/MCP jetonlarını okuma, telefon bağlantısının kendi güvenlik ayarlarını telefondan gevşetme (yeni cihaz onayı, eşleşme açma). Bunlar yalnız PC'de yapılır; böylece çalınan bir telefon kendine yeni kapı açamaz.
6. **Dosya yolu kuralı:** Telefon PC'ye **dosya yolu yazamaz.** Medya/logo/söz yalnız PC kitaplığındaki **kimlikle** seçilir ya da telefondan yüklenir. Bilinmeyen yol taşıyan yazım reddedilir (aksi hâlde telefon PC'deki herhangi bir dosyayı yayın sunucusundan okuyabilirdi).
7. **Web katmanı adresi** (PC'de keyfi site açar) yalnız *Tam* düzeyde ve PC'de bir kez onayla.
8. Boyut ve hız sınırları: ileti başına üst sınır, saniyede yazım sınırı, büyük dosya yalnız parça parça.
9. Bağlantı açıkken PC'de görünür gösterge: üst çubukta "Telefon bağlı (ad)". Telefon bir şey değiştirince panelde kısa bildirim (kapatılabilir).
10. Bağlantı özelliği **varsayılan kapalı.** Açmak PC'de kullanıcı işi. Windows güvenlik duvarı ilk açılışta izin sorar. Bu izni kullanıcı verir, uygulama vermez.
11. **Ağa açılan yüzey:** Telefon bağlantısını açmak yayın sunucusunu ağa açmayı gerektirir. Ama `/overlay`, `/remote`, `/media-file`, `/logo-file` gibi mevcut yollar **bağlantı yüzünden açılmaz.** Onlar eskisi gibi kendi "LAN" anahtarına ve jetonuna bağlı kalır. Bağlantı açık, LAN kapalıyken ağdan yalnız `/link` (şifreli) yanıt verir. Telefonun ihtiyaç duyduğu küçük resim ve dosyalar da `/link` içinden, şifreli gider.
12. **Bağlantı MCP'ye bağlı değil:** MCP kapalıyken (varsayılan) ve MCP kipinden bağımsız çalışır. Telefonun izni yalnız kendi izin düzeyidir (tablo 3.6).
13. **Eski web kumanda (#443):** Tarayıcıdan açılan `/remote` sayfası kalır (telefon uygulaması olmayanlar, iPhone vb. için). #443'teki "tam kumanda ve düzen" isteği telefon uygulamasında karşılanır. Web kumanda ayrıca büyütülmez. #443 bu iş bitince bu gerekçeyle kapatılmayı önerir.

### 3.5 Yazım yolu (düzenleme nasıl PC'ye ulaşır)
- Telefonun düzenleyicileri (ve ortak `timeline*.js`) ayarı doğrudan değiştirir: `set((x) => …)`. Bunları ~100 MCP aracına çevirmek yeniden yazım olur. Bu yüzden:
- **Ayar düzenleme = doğrulamalı üst düzey anahtar yaması.** Telefon değiştirdiği üst anahtarları (`layers`, `timeline`, `background`, `text`…) sürüm numarasıyla yollar. PC'de yeni bekçi `link-guard.js`:
  - anahtar izin listesi ve izin düzeyi (3.6),
  - SVSchema aralıkları (sayılar sıkıştırılır),
  - katman türü ve yapı denetimi, kilitli katmanın değişmemesi,
  - dosya yolu bekçisi (3.2 madde 6), web katmanı adresi kuralı (madde 7),
  - boyut sınırı.
  Geçerse `applyConfigPatch` ile uygulanır (panelin kullandığı yol). Panel `external-config` ile tazelenir, diğer telefonlara yayılır.
- **Yapısal işlemler = MCP araçları** (bağlantı kendi izin tablosuyla çağırır): sahne kaydet/sil/yeniden adlandır, preset kaydet/sil, dışa aktarma, çıkışlar, kayıt, önizleme.
- **Canlı denetim = mevcut kumanda komutları** (`run`, `osc`, `scene`, `blackout`) + T-bar/anlık efekt.
- Zaman çizelgesi: düzenleme `timeline` anahtarının yamasıyla (bekçi timeline.js'in kendi normalleştiricisinden geçirir), taşıma `tlPlay/tlPause/tlStop/işaret` komutlarıyla.

### 3.6 İzin düzeyi ↔ işlem tablosu
| İşlem | İzle | Kumanda | Düzenleme | Tam |
|---|---|---|---|---|
| Durum, önizleme, canlı özet | ✔ | ✔ | ✔ | ✔ |
| Sahne geçişi, karartma, T-bar, anlık efekt, deste, makro, tempo, MilkDrop gezinti, çizelge taşıma, Otomatik VJ aç/kapa | | ✔ | ✔ | ✔ |
| Ayar yaması (katman, efekt, renk, metin, çizelge düzenleme), sahne/preset kaydet-sil | | | ✔ | ✔ |
| Çıkışlar, ses kaynakları, dışa aktarma, kayıt, ışık, güç, dosya gönderme, web katmanı adresi | | | | ✔ |
| Güncelleme, ses onarımı, MIDI/OSC eşleme, yedeklilik devri (PC'de onaylı) | | | | ✔ |
| Keyfi dosya yolu, jeton okuma, bağlantı güvenlik ayarları | ✗ | ✗ | ✗ | ✗ |

Not: MCP'de karartma ve zaman çizelgesi "full" grubunda. Bağlantı MCP kiplerini değil bu tabloyu uygular. Gerekçe: telefon eşleşmiş ve onaylanmış bir cihazdır, gösteride en çok bunlar gerekir.

### 3.7 Android platform gereklilikleri
- **Şifresiz trafik:** Android 9'dan beri `http/ws` yerel IP'ye varsayılan engelli. Ağ güvenlik yapılandırmasıyla yalnız yerel ağ adreslerine izin (şifreleme uygulama katmanında, 3.2). Play incelemesinde gerekçesi belgelenir.
- **Yerel ağ izni:** Hedef API 36'nın SDK'sında ayrı bir yerel ağ izni yok (SDK'dan denetlendi; yalnız `NEARBY_WIFI_DEVICES`). Sonraki API'de (37) "yerel ağ koruması" gelirse izin ve gerekçe ekranı eklenir. Hedef API yükseltilirken yeniden denetlenecek.
- **UDP bulma:** `WifiManager.MulticastLock` gerekli, yalnız bulma ekranı açıkken tutulur.
- **Ön plan servis türleri:** ses köprüsü için `microphone`, oynatma yakalama için `mediaProjection`. Oynatma yakalama izni Android 14+'te **her oturumda** yeniden sorulur (sistem kuralı). Uygulama içi çalar ve mikrofon için sorulmaz.
- **Kamera izni** yalnız QR okurken.

### 3.3 Bulma ve yeniden bağlanma
- QR ve elle adres girişi esas. Ek olarak **otomatik bulma:** PC yerel ağa UDP yayınıyla kendini duyurur (elle yazılmış, bağımlılık yok, yalnız bağlantı açıkken). Telefon "Ağdaki PC'ler" listesini gösterir; eşleşmemiş PC için yine QR/kod ister.
- PC'nin IP adresi değişirse telefon PC kimliğiyle yeniden bulur, yeniden eşleşme gerekmez.
- Kopunca artan aralıklarla yeniden dener. Telefon ekranında durum: bağlanıyor / bağlı (gecikme ms) / koptu / izin yok / sürüm uyumsuz.
- Ağ türüne göre ipuçları: misafir ağı cihaz yalıtımı, VPN, mobil veri, güvenlik duvarı. Her biri için anlaşılır hata ve çözüm metni.

### 3.4 Sürüm uyumu
- El sıkışmada protokol sürümü, uygulama sürümleri ve ayar biçim sürümü (`docVersion`) değiştirilir.
- PC'nin ayar biçimi telefonun bildiğinden yeniyse: telefon **yalnız kumanda ve izle** düzeyinde çalışır ve "Düzenlemek için telefon uygulamasını güncelleyin" der. Böylece eski telefon yeni PC ayarını bozamaz.
- Telefon yazarken **yalnız değiştirdiği alanları** yollar. Tanımadığı alanlar PC'de olduğu gibi kalır.

## 4. Telefonda özellikler (ayrıntılı)

### 4.1 Hedef seçici
- Üst çubukta hedef: **"Bu telefon"** ya da **"PC: <ad>"**. PC seçilince Sahne / Katmanlar / Kitaplık / Ses / Ayarlar sekmelerinin hepsi PC'yi gösterir ve düzenler. Aynı ekranlar, yeni ekran öğrenmek gerekmez.
- Telefonun kendi görselleştiricisi PC hedefindeyken **PC'nin canlı önizlemesini** çizer (4.6).
- Renk ve tema telefonda kalır (PC temasını değiştirmek ayrı ayar).

### 4.2 Eşleşme ekranı (Ayarlar → PC'ye Bağlan)
- QR okut (kamera), ağdaki PC'ler listesi, elle adres + kod.
- Kayıtlı PC'ler: ad, son bağlantı, kendiliğinden bağlan anahtarı, unut.
- QR okuma: uygulamaya gömülü açık kaynak çözücü (ZXing çekirdeği, Apache-2.0). Çalışırken hiçbir dış hizmete, Google Play Hizmetleri'ne ya da ağa bağlanmaz. Lisansı ve boyutu PR'da yazılır. Bağımsızlık ilkesi: yalnız gömülü, kendi içinde çalışan kod; dış servis yok, gerekirse kendimiz yazarız.

### 4.3 Canlı sayfası (yeni sekme, yalnız PC hedefinde)
- Sahne ızgarası, resimleriyle. Dokun ve geç. Geçiş süresi ve türü.
- Karartma (geçişli), T-bar (önizleme ve program sahnesi), anlık efekt düğmeleri (basılı tut).
- Klip destesi ızgarası: tetikle, hepsini durdur.
- Makrolar (döner düğmeler), ana opaklık ve parlaklık.
- Tempo: dokunarak BPM, PC'nin BPM'i ve vuruş göstergesi.
- Otomatik VJ aç/kapa ve ayarları. MilkDrop sonraki/önceki/rastgele, kilitle.
- Ses seviyesi göstergesi (PC'nin girişinin).
- Ekranı kilitleme kipi: yanlış dokunmayı önlemek için gösteri kilidi (kaydırarak aç).

### 4.4 Düzenleme
- **Uzak ayar deposu:** telefonun düzenleyicileri şimdi telefonun ayarını yazıyor. PC hedefinde aynı ekranlar PC'nin ayar kopyasını okur, değişikliği PC'ye yollar. PC doğrular ve uygular, sonucu bütün bağlı cihazlara ve panele yayar.
- Kapsam: katman ekle/sil/sırala/kopyala/kilit, katman ayarları ve ses tepkisi, efekt zincirleri (katman ve ana), arkaplan, renk modu ve şablonları, metin ve sözler, logo, görsel nesneler, medya (PC kitaplığından), MilkDrop seçimi ve döngü, Studio katmanları (parametreler. Shader kodunu telefonda yazmak kapsam dışı, okunabilir), modülasyon yolları (aç/kapa, miktar), sahne kaydet / yeni sahne / yeniden adlandır / sil / sırala.
- Kaydırıcı sürüklerken saniyede en çok ~20 yama (PC paneliyle aynı yaklaşım). Bırakınca son değer kesin yazılır.
- **Aynı anda düzenleme:** Her yazımın bir sürüm numarası var. Telefon ile PC (ya da iki telefon) aynı ayarı değiştirirse son yazan geçerli olur. Telefonda açık sayfa PC'den gelen değişiklikle yenilenir. Sürükleme sırasında gelen başka değişiklik sürüklenen kaydırıcıyı zıplatmaz, bırakınca birleşir. Panelde de "telefon düzenliyor" göstergesi.
- **Geri al:** telefonda son 20 değişikliği geri alma (PC'ye ters yama).
- Kilitli katmanlar telefonda da kilitli görünür.
- **PC ayarına dokunmama kuralı:** Telefon PC'nin ayarı üzerinde kendi göçünü (`migrate`), `ensureStack`'i ya da varsayılan doldurmayı **çalıştırmaz.** Yalnız kullanıcının değiştirdiği alanı yollar. Yoksa telefon farkında olmadan PC verisini yeniden yazardı. Bunun için ayrı test olur.
- **Masaüstüne özgü katmanlar** (web sayfası, Spout/Syphon/NDI girişi, ekran yakalama, PC kamerası): telefonda düzenleyicisi yok. Salt okunur satır olarak görünür (aç/kapa, saydamlık, sıra değişebilir). İç ayarları olduğu gibi korunur.

### 4.5 Zaman çizelgesi (soruya cevap: EVET, tam çalışacak)
- Telefonun zaman çizelgesi ekranı (masaüstüyle ortak kod) PC hedefinde **PC'nin çizelgesini** gösterir ve düzenler: klip ekle/taşı/kırp/sil, izler, işaretler, döngü, tempo haritası, anahtar kareler, banka. Yazımlar `timeline` anahtarının doğrulamalı yamasıyla gider (3.5).
- Taşıma: oynat / duraklat / durdur / işarete atla / konuma atla. Kafa konumu PC'nin canlı özetinden gelir ve telefonda akıcı ilerletilir (aradaki boşluk tahmin edilir, her özetle düzeltilir).
- Şarkı PC'de çalar. Telefon şarkının dalga biçimini PC'den alır (dosyanın kendisi gönderilmez).
- Eylem klipleri: PC hedefinde **bütün eylemler** çalışır (deste, MilkDrop gezintisi dahil), çünkü PC'de çalışıyorlar.
- Dışa aktarmada zaman çizelgesi: PC'de dışa aktarma başlatılabilir (4.8).

### 4.6 Canlı önizleme
İki kip, telefonda seçilir:
1. **Akıcı (varsayılan):** Telefon PC'nin ayarını ve PC'nin ses analizini alıp **kendi motoruyla** çizer. Çok az veri (ses analizi ~ saniyede birkaç yüz KB, ayar yalnız değişince), gecikme düşük. Sınır: piksel piksel aynı değil. MilkDrop rastgeleliği, PC'deki kamera, ekran yakalama, Spout/NDI girişleri ve web katmanı telefonda farklı ya da boş görünür. Bunlar için katmanda "PC'de" etiketi gösterilir.
2. **Gerçek görüntü:** PC'nin tuvalinden küçük JPEG'ler (`sv_get_preview`), saniyede 2–10 kare, ağ durumuna göre. Birebir doğru ama akıcı değil.
- **Telefonu ek ekran olarak kullanma:** Akıcı kip tam ekranda, arayüzsüz. Telefon PC'nin bir çıkışı gibi davranır (OBS sayfasının telefon karşılığı).
- Önizleme sayfa kapalıyken ya da ekran kilitliyken durur (pil).

### 4.7 Ses köprüsü (telefon → PC)
- Telefonda kaynak: mikrofon, telefonda çalan müzik (oynatma yakalama), uygulama içi çalar. PC'de ses girişi olarak **"Telefon (ad)"** seçilir.
- İki yol ölçülüp seçilecek (B4'te ölçümle karar):
  - (a) Telefon analiz karesini yollar (PC'nin köprü biçimi). PC'de ek iş yok ama veri büyük olabilir.
  - (b) Telefon ham PCM yollar (48 kHz, 16 bit; ~96–192 KB/sn). PC kendi analizini yapar, BPM ve MilkDrop girdileri PC'nin kendi kodundan gelir, bant genişliği küçük.
- Gecikme hedefi: ölçülecek ve belgeye yazılacak. Wi-Fi'da tipik 20–80 ms beklenir. PC'de gecikme dengeleme ayarı (görüntüyü sese göre kaydırma).
- Kopma: PC'nin köprü giriş makinesi kendi yerel girişine döner (yedek giriş açıksa). Telefon yeniden bağlanınca köprüye döner.
- İsteğe bağlı **dinlenebilir ses:** telefonun sesi PC hoparlöründen de çalınabilir (ham PCM yolunda). Varsayılan kapalı.
- Arka planda sürer (ön plan servisi + bildirim). Ekran kapalıyken de çalışır.
- **Ters yön, PC → telefon:** Önizleme zaten PC sesini alıyor. Ayrıca istenirse telefonun **kendi** sahnesi PC'nin sesiyle sürülebilir ("ses kaynağı: PC").

### 4.8 PC ayarları ve çıkışlar (Tam düzey)
- Ekranlar: liste, çıkış aç/kapa, yüzen pencere aç/kapa ve boyutu, en-boy, pencere kipi.
- Ses kaynakları: PC'nin aygıt ve uygulama listesinden seçim, kazanç, ses ölçer.
- Dışa aktarma: PC'de başlat (şarkı PC kitaplığından ya da telefondan gönderilmiş), ilerleme, iptal, sıra.
- Kayıt ve anlık görüntü başlat/durdur.
- Işık (Dynamic Lighting / OpenRGB / Art-Net / WLED): aç/kapa ve parlaklık. Tarama ve kurulum PC'de kalır.
- Güç ve performans ayarları.
- **Kapsam dışı (PC'de kalır):** güncelleme, ses onarımı, MIDI/OSC eşleme düzenleyicisi, MCP ayarları, yedeklilik devri (yalnız durum gösterilir), shader kodu düzenleme, PC dosya seçicileri.

### 4.9 Kitaplık ve dosya aktarma
- PC kitaplığı telefonda: MilkDrop presetleri (sayfalı arama, 10.000+ preset için), şablonlar, logolar, medya, sözler, dokular. Küçük resimler PC'den.
- **Telefondan PC'ye gönder:** video, logo, söz dosyası, .milk preset. PC kitaplığına eklenir. Parça parça, ilerlemeli, iptal edilebilir, boyut sınırlı ve onaylı (Tam düzey).
- **Sahne aktarma:** telefondaki sahneyi PC'ye gönder ve tersi. Kullandığı dosyalarla birlikte, mevcut .svbackup bölüm biçimiyle.
- PC'den telefona dosya indirme: yalnız sahne aktarmanın parçası olarak (telefonda depolama dar).

### 4.10 Çoklu cihaz ve özel durumlar
- Aynı PC'ye birden çok telefon bağlanabilir (her biri kendi izniyle). Hepsi değişiklikleri canlı görür.
- Bir telefon birden çok PC kaydeder, aynı anda birine bağlıdır.
- PC'de aynı makinede birden çok uygulama kopyası: her kopya kendi kimliği ve portuyla ayrı PC olarak görünür.
- PC **yedek rolündeyse** (yedeklilik): telefon yalnız izler, yazımlar reddedilir. Telefon birincili önerir.
- PC panelinde öz test sürüyorsa yazımlar bekletilir (mevcut `smokeHold`).
- PC uykuya geçerse ya da uygulama kapanırsa: telefon "PC'ye ulaşılamıyor" der, telefonun kendi kipine döner, ses köprüsü durur.
- Telefona arama gelirse ya da ses odağı kaybedilirse: köprü kaynağı susar, PC yedek girişe döner.
- Pil: arka planda yalnız ses köprüsü ve hafif canlı özet. Önizleme ve küçük resim akışı durur.

## 5. PC tarafındaki değişiklikler
- **Ayarlar → Telefon Bağlantısı paneli:** aç/kapa, QR ve kod, doğrulama sayısı onayı, cihaz listesi (izin, son görülme, kes, unut), güvenlik duvarı ipucu, ağ adresleri.
- Üst çubukta bağlı telefon göstergesi. Telefon kaynaklı değişikliklerde kısa bildirim (kapatılabilir).
- Ses girişi listesinde "Telefon (ad)".
- `src/main/phone-link.js` (eşleşme, oturum, şifreleme, izin, hız sınırı; saf ve test edilebilir), `src/main/link-guard.js` (yazım bekçisi, 3.5), `stream-server.js`'e `/link` yolu, yapısal işlemler için MCP araçlarının bağlantının izin tablosuyla çağrılması, UDP duyurusu.
- Belgeler: `docs/PHONE-LINK.md` (+ .tr) protokol ve güvenlik, README'ye kısa bölüm, test sayıları.
- **Dal kararı (onay gerekiyor):** PC tarafı **main'e** gider (PC kurulumu main'den çıkıyor, bağlantı PC'de de olmalı). Telefon tarafı dev/android'e gider. main → dev/android eşitlemesi her PC adımından sonra yapılır. Bu, "Android işi main'e gitmez" kuralına bilinçli bir istisnadır. PC'deki kod Android'e özgü değildir, yalnız telefon istemcisine kapı açar.

## 6. Aşamalar (her aşama ayrı PR'lar; aşama sonunda APK ve kısa rapor)

| Aşama | İçerik | Bitti sayılma ölçütü |
|---|---|---|
| **B0** Taslak ve protokol | Telefon ekran taslakları (eşleşme, hedef seçici, Canlı, önizleme, dosya gönder) ve PC panel taslağı. Protokol ve güvenlik belgesi | **Senin taslak onayın** (Faz 3'teki gibi) |
| **B1** Temel bağlantı | Eşleşme (QR + kod + doğrulama sayısı), şifreleme, cihaz listesi, izin düzeyleri, bulma, yeniden bağlanma, sürüm el sıkışması, durum göstergeleri | Emülatör ↔ PC: eşleş, kopar, yeniden bağlan, iptal et. Saldırı testleri: yanlış kod, eski ileti, izinsiz araç, keyfi yol |
| **B2** Canlı denetim | Canlı sayfası (4.3), çizelge taşıması, canlı özet | Her denetimin PC'de etkisi ölçülür (probe) |
| **B3** Düzenleme | Uzak ayar deposu, bütün sekmeler PC'yi düzenler, zaman çizelgesi düzenleme, geri al, aynı anda düzenleme, sürüm kilidi | PC paneli ve telefon aynı anda düzenler, ayar bozulmaz. Masaüstü testleri ve altın kareler değişmez |
| **B4** Ses köprüsü | Telefon → PC ses (a/b ölçümüyle seçim), PC → telefon, gecikme dengeleme, arka plan | Gecikme ve bant genişliği ölçülüp belgelenir. Kopmada yedek girişe dönüş |
| **B5** Önizleme ve ek ekran | Akıcı ve gerçek görüntü kipleri, telefonu ek ekran olarak kullanma | Önizleme açık/kapalı fps ve veri ölçümü |
| **B6** Ayarlar, çıkışlar, dosyalar | 4.8 ve 4.9 | Dosya gönderme sınırları ve iptal sınaması |
| **B7** Sağlamlaştırma ve belge | Çoklu cihaz, yedeklilik rolü, ağ hata metinleri, belgeler, uçtan uca betik | Bütün probe'lar ve PC kapıları yeşil |
| **Sonra: Faz 6** | Gerçek telefon, gerçek Wi-Fi, gerçek PC ile kapsamlı test (senin kararın) | — |

## 7. Sınama
- PC: `phone-link.js` için birim testleri (eşleşme, şifreleme, sayaç, izin tablosu, yol bekçisi, hız sınırı). Mevcut testler bozulmaz. Altın kare A/B ve öz test her PC PR'ında.
- Telefon: `android/js-tests` (uzak depo, birleştirme, sürüm kilidi), Kotlin birim testleri (şifreleme, yeniden bağlanma).
- Uçtan uca: emülatör ↔ yalıtılmış profilli PC uygulaması (`--user-data-dir`; gerçek ayarların okunmaz/yazılmaz). Emülatör PC'ye `10.0.2.2` ile erişir. Otomatik bulma emülatörde çalışmaz, gerçek ağda (Faz 6) denenir.
- Güvenlik denetimi: her aşama sonunda kendi güvenlik incelemem (yeni açılan yüzey).

## 8. Riskler ve bilinen sınırlar
| Risk | Önlem |
|---|---|
| Ağ cihazları birbirinden yalıtıyor (misafir ağı, kurumsal Wi-Fi) | Açık hata metni, telefonun hotspot'u önerisi |
| Güvenlik duvarı izni | İlk açılışta yönlendirme. İzni kullanıcı verir |
| Panel eski ayarla telefonun değişikliğini ezer | `external-config` + sürüm numarası. B3'te yarış testi |
| Büyük ayar (sahneler, 10k preset dizini) her değişimde gidip gelir | Yalnız değişen üst anahtarlar. Presetler sayfalı ve isteğe bağlı |
| Önizleme pil ve ısı | Sayfa kapalıyken dur, kare sınırı, düşük güç kipi |
| Wi-Fi'da ses gecikmesi dalgalanır | Tampon ve gecikme dengeleme, ölçümlü varsayılan |
| MIUI arka planda servisi öldürür | Mevcut ön plan servisi ve pil ayarı ipucu (Faz 6'da doğrulanır) |
| PC ve telefon sürüm farkı | El sıkışma, ayar biçimi kilidi |
| Emülatör gerçek ağı göstermez | Son doğrulama Faz 6'da gerçek cihazla |

## 9. Onay için kararlar
1. **Dal:** PC tarafı main'e, telefon tarafı dev/android'e (öneri: evet).
2. **Kapsam:** 4.1–4.10'un hepsi (öneri: evet, aşama sırasıyla).
3. **QR kütüphanesi:** ZXing çekirdeği (Apache-2.0) eklenmesi (öneri: evet).
4. **Varsayılan izin düzeyi:** yeni eşleşen cihaz için "Düzenleme" (öneri). Tam düzey PC'de elle verilir.
5. **B0 taslakları:** önce taslak onayı, sonra kod (öneri: evet, Faz 3'teki gibi).

### Kararlar (24.11.2026, kullanıcı onayı)
1. Dal: evet. 2. Kapsam: tamamı. 3. ZXing çekirdeği gömülü olarak evet; genel ilke: dış servis yok, mümkün olan her şey kendi içimizde. 4. Yeni cihaz varsayılan **Tam**; iki taraftan da tam yönetim (güvenlik sınırı satırı hariç). 5. Önce B0 taslak onayı.
