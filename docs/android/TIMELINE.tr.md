# Android zaman çizelgesi — masaüstüyle eşlik listesi

Kaynak: masaüstü Zaman sayfası (`src/admin/timeline-panel.js`: araç çubuğu, parça başlıkları,
denetçi, bağlam menüsü, "Döngü, işaretler ve cetvel" bölümü). Veri ve hesap ortak koddan:
`src/shared/timeline.js` (model, tempo haritası, banka, işaretler, `Transport`),
`src/shared/timeline-edit.js` (böl, çoğalt, grup kopyala/yapıştır, tempo işlemleri, geri al),
`src/shared/timeline-compose.js` (bileşim, "Timeline kullan", dışa aktarma işi),
`src/shared/showclock.js` (gösteri saati çıpası), `src/admin/modulation-panel.js`
`targetCatalog` (otomasyon hedefleri; panel olmadan yüklenebiliyor), `src/shared/export-formats.js`
(YouTube bölümleri). Telefona özel olan yalnız dokunmatik yüzey: `src/mobile/shell-timeline.js`
(çekirdek ve düzen), `shell-timeline-lane.js` (tuval şerit ve dokunma), `shell-timeline-forms.js`
(denetçi ve ayarlar).

Canlı çıkış masaüstündeki gibi: "Timeline kullan" açıkken motor oynatma kafasındaki bileşimi
her karede kendisi çizer (geçişler, opaklık, solma, otomasyon, video klipleri dahil); kapalıyken
çizelge elle ayara dokunmaz. Kafa motora masaüstünün panelindeki gibi bir çıpayla gider
(`SVAndroid.showClock`). Telefona özel tek ek: uygulama içi çalarda şarkı varsa taşıma ona bağlıdır
(oynat/duraklat/konum birlikte; döngü sarınca şarkı da sarar, cue'da şarkı da durur).

Durum: ✅ var · ◐ farklı biçimde var (açıklamalı) · ✗ yok (gerekçeli)

## Düzen

| Ekran | Düzen |
|---|---|
| Dikey telefon | Sahne üstte görünür kalır, çizelge altta yerleşik panel (ekranın ~%60'ı, ⌃ ile büyür); dar parça başlıkları (renk, tür simgesi, M/S/kilit/kayıt durumu); seçime göre değişen alt araç çubuğu; denetçi ayrı sayfa |
| Yatay telefon | Yan yana: sahne solda görünür, çizelge sağda tam boy (altta tam genişlikte yalnız 2 şerit kalıyordu); ⌃ ile tam genişlik |
| Tablet (≥ 900 px panel) | Altta tam genişlik; geniş başlıklarda ad + M/S/kilit düğmeleri; denetçi sağda, çizelgeyle yan yana |

Dokunma: dokun = seç; çift dokun = denetçi (otomasyon şeridinde boş yere: nokta; klip parçasında
boş yere: klip); seçili klibi sürükle = taşı (dikeyde başka parçaya, en alta bırakınca yeni parça);
uzun bas = seç ve taşı; kenar tutamaçları (klibin dışına taşan geniş dokunma alanı) = kırp; üst
köşeler = giriş/çıkış solması; başka yerde tek parmak = kaydır (bırakınca süzülür); iki parmak =
yakınlaştır; boş yerde uzun bas = bağlam menüsü; cetvelde dokun/sürükle = oynatma kafası (masaüstü
gibi ızgaraya oturur); işaret bayrağı, ♩ etiketi ve döngü kenarı seçiliyken sürüklenir. Çoklu seçim
"Çoklu seç" kipiyle (dokunarak ya da boşta sürükleyerek dikdörtgenle).

## Özellikler

| Masaüstü | Telefon | Durum |
|---|---|---|
| Birden çok zaman çizelgesi (sekmeler): yeni, yeniden adlandır, pasifleştir/etkinleştir, sil, sıra | Başlıktaki çizelge adı → menü (sola/sağa taşı) | ✅ |
| Oynat/duraklat, durdur ve başa, önceki/sonraki işaret | Taşıma satırı (dar ekranda önceki/sonraki araç çubuğunda) | ✅ |
| GO ve sıradaki cue | Bekleme işareti varsa taşıma satırında | ✅ |
| Süre · ölçü.vuruş saati | Taşıma satırı (+ kafadaki BPM) | ✅ |
| Timeline kullan (çıkışa bağla) | Taşıma satırında anahtar; açıkken ana ekranda "Zaman çizelgesi" çipi: çizelgeyi aç ya da elle ayara dön | ✅ |
| Timeline kullan açıkken Sahne/katman panellerinin klibin yerel kopyasını düzenlemesi (`timeline-target.js`) | Klip sayfasında "Sahneyi aç": elle ayara döner, sahneyi uygular, Katmanlar'ı açar; sahne güncellenince klip de değişir. Masaüstünden gelen klip kopyaları korunur ve çizilir | ◐ |
| BPM / ölçüdeki vuruş (oynatma kafasındaki tempo) | Ayarlar; ♩ etiketinin sayfası | ✅ |
| Kafaya tempo değişimi, taşı, sil | Araç çubuğu "♩ Tempo", cetvelde ♩ etiketi | ✅ |
| Yakalama: kapalı, ölçü, vuruş, yarım, çeyrek, 1 sn, 0,5 sn, kare | Araç çubuğu (mıknatıs) + ayarlar | ✅ |
| Döngü aç/kapat, başı/sonu kafaya, sayıyla | Araç çubuğu, cetvelde kenarlar, ayarlar | ✅ |
| Kafayı takip et | Ayarlar | ✅ |
| Yakınlaştır / uzaklaştır / hepsini sığdır | İki parmak + araç çubuğu | ✅ |
| Şerit yüksekliği | Ayarlar | ✅ |
| Geri al / yinele | Başlık | ✅ |
| Klip parçası / otomasyon parçası ekle | "Ekle" menüsü, başlık sütunundaki ＋ | ✅ |
| Parça adı, rengi, sustur, solo, kilit, opaklık, yukarı/aşağı, sil | Parça sayfası (tablette başlıkta M/S/kilit) | ✅ |
| Klip türleri: sahne, şablon, renk şablonu, görselleştirici, video, görsel, shader | Klip ekleme (tür → kaynak) ve klip sayfası; video kitaplıktan ya da galeriden, görsel galeriden | ✅ |
| Eylem klibi (MIDI/OSC eylemleri) | Telefonda karşılığı olanlar: karartma, sonraki sahne, sonraki/önceki görselleştirici, sonraki renk şablonu, sonraki arkaplan, çizelge duraklat/durdur/sonraki/önceki işaret. Klip destesi, MilkDrop gezintisi ve yedeklilik eylemleri masaüstünün denetim panelinde (telefonda yok); bu eylemli klipler korunur, çalışmaz | ◐ |
| Klip: ad, tür, kaynak, hedef, başlangıç, süre, geçiş süresi/türü/eğrisi, opaklık, giriş/çıkış solması, kırpma başı, hız, renk | Klip sayfası | ✅ |
| Böl, çoğalt, kopyala, kes, yapıştır (kafaya), sil | Araç çubuğu + bağlam menüsü | ✅ |
| Çoklu seçim: renk, geçiş, çoğalt, kopyala, sil, taşı | Çoklu seç kipi | ✅ |
| Üst/alt parçaya taşı | Araç çubuğu + dikey sürükleme | ✅ |
| Ok tuşlarıyla ızgara adımı kaydırma | Araç çubuğu "Geri/İleri" | ✅ |
| Kırpma ve taşımada mıknatıs (klip kenarları, işaretler, kafa) | Sürüklerken | ✅ |
| İşaret: ekle, ad, zaman, cue (bekle), git, sil | Araç çubuğu, işaret sayfası, ayarlardaki liste | ✅ |
| Sözlerden işaret üret | Ayarlar (söz katmanının ipuçları; yoksa çalan parçanın kitaplıktaki sözleri) | ✅ |
| YouTube bölümlerini kopyala | Ayarlar (pano; kullanılamazsa liste kopyalanacak biçimde gösterilir) | ✅ |
| Cetvel: süre ve ölçü / yalnız süre / yalnız ölçü | Ayarlar | ✅ |
| Otomasyon: hedef seç (ara), en az/en çok, yol | Parça sayfası | ✅ |
| Otomasyon noktası: ekle, taşı, değer, segment eğrisi, sil, noktaları temizle | Şeritte çift dokun / sürükle, nokta sayfası, bağlam menüsü | ✅ |
| Otomasyon öğren / kaydet | Parça sayfası: Öğren (çizelge kapanır, değişen ilk ayar hedef olur, çizelge geri açılır), Kayda başla (oynarken elle değişim noktalara yazılır) | ✅ |
| Dışa aktarmada "Zaman çizelgesiyle" | Dışa aktarma sayfası | ✅ |
| Klavye kısayolları | Dokunmatikte karşılığı düğmeler ve hareketler | ◐ |

## Sınama

`node android/tools/probe.js timeline` (gerçek dokunuş): seç, ölçüye hizalı sürükle, dikeyde
parça değiştir, sağ kenardan kırp, geri al, iki parmakla yakınlaştır, uzun basınca menü, Timeline
kullan açılınca motorun bileşimi (SVShowDebug.time/composed), oynatma, çift dokunuşla denetçi,
işaret/cue/tempo/döngü/sözlerden işaret, otomasyon öğren ve kaydet, çizelgeyle dışa aktarma (iki
anın karesi belirgin farklı). Düzenler emülatörde dikey (1080×2400), gerçek yatay döndürme ve
`wm size 2560x1600` tablet boyutunda görüntülendi.
