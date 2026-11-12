# Kullanım kılavuzu: kurulumdan ilk gösteriye

[English](GUIDE.md)

Bu kılavuz uygulamayı karşılaştığınız sırayla anlatır: müziği duyurun, bir görünüm kurun, kaydedin,
ekrana verin, yönetin ve bir yere gönderin. Her bölüm birkaç dakika sürer. Her özelliğin ayrıntısı
[README](../README.tr.md) dosyasındadır; bu sayfa onların arasındaki yoldur.

**Kalın** yazılan adlar Türkçe arayüzde gördüğünüz etiketlerdir.

## 1. Kurun ve açın

Sisteminize uygun dosyayı [son sürümden](https://github.com/CaYatur/SoundVisualizer/releases/latest)
indirip çalıştırın. Başka bir şey kurmanız gerekmez. Hangi dosyanın hangi sistem için olduğu
README'deki [Hızlı başlangıç](../README.tr.md#hızlı-başlangıç) tablosunda yazar.

Panel **Sahne** sayfasında, hazır bir sahneyle açılır: gradyan üstünde bir bar görselleştirici.
Ortadaki önizleme, ekranlarınızın göstereceği görüntüdür. Önizlemedeki **Demo** rozeti, önizlemeyi
yerleşik bir örnek sinyalin sürdüğünü söyler; ses ayarı yapmadan her şeyi deneyebilirsiniz. Rozete
tıklayınca **Canlı** olur: önizleme gerçek sesinizi izler. Bir görselleştirme penceresi açıkken de
kendiliğinden geçer.

Üstteki kapsülde beş sayfa var:

| Sayfa | Ne için |
|---|---|
| **Sahne** | Ekranda görünen her şey: arkaplan, görselleştirici, logo, metin, efektler |
| **Canlı** | Gösteriyi sürmek: sahne ızgarası, AL, T-bar, tempo, Otomatik VJ |
| **Zaman** | Sahneleri ve ayar değişimlerini parça boyunca oynatan zaman çizelgesi |
| **Stüdyo** | Kendi shader'ınızı yazmak, sahne ve MilkDrop preseti üretmek |
| **Çıktı** | Görüntünün gideceği yer: ekranlar, OBS, Spout / Syphon, kayıt, video dosyası |

**Basit** anahtarı iki gelişmiş sayfayı (Zaman ve Stüdyo) ve gelişmiş ayarları gizler. Dişli simgesi
**Kurulum**'u açar: ses, ışık, denetleyiciler ve uygulamanın kendi ayarları oradadır.

Baştan bilmeye değer iki şey:

- **Arama.** `Ctrl` + `K` bütün ayarlarda, modlarda ve efektlerde arar. Aklınızdaki sözcüğü yazın
  ("mikrofon", "yeşil perde", "telefon", "dışa aktar"); sonuç sizi oraya götürür.
- **Kısayollar.** `?` klavye kısayolları listesini açar.

Değiştirdiğiniz her şey anında uygulanır ve kendiliğinden kaydedilir. Ayarlar için Kaydet düğmesi
yoktur.

## 2. Müziği duyurun

Sol üstteki hoparlör düğmesine tıklayın ya da **Kurulum → Ses → Ses Kaynakları**'nı açın.

- **Varsayılan Çıkış (Aktif Hoparlör)** bilgisayarın çaldığı her şeyi dinler. Yeni kurulumda
  seçilidir; çoğu durumda herhangi bir oynatıcıdaki müzik görselleri zaten hareket ettirir.
- Ortamın sesine tepki vermek için bir **mikrofon** ya da hat girişi işaretleyin. Birden çok kaynak
  birlikte işaretlenebilir; karıştırılırlar.
- **Uygulama Sesi** o anda ses çalan programları listeler. Yalnız bir programı izlemek için onu
  işaretleyin (örneğin oyunu değil müzik çaları). Program listede yoksa bir şey çaldırıp
  **Aygıtları Yenile**'ye basın.

Müziğinizi önizlemede görmek için **Demo** rozetine tıklayıp **Canlı** yapın; temponun yanındaki
küçük gösterge sesle birlikte oynamaya başlar. Görseller fazla sakin ya da fazla hareketliyse
**Kurulum → Ses → Ses Analizi**'nde hassasiyet ve yumuşatma var.

macOS'ta sistem sesi için sanal bir aygıt, Linux'ta PulseAudio ya da PipeWire gerekir. Ayrıntısı
README'nin [ses bölümünde](../README.tr.md#ses-yakalama-ve-çözümleme).

## 3. Bir görünüm kurun

**Sahne** sayfası üç sütundur.

**Sol: Katmanlar.** Sahne bir katman yığınıdır; listenin en üstündeki en önde çizilir. **Ekle**
katman türlerini sunar: Arkaplan, Görselleştirici, MilkDrop, Medya (web kamerası, video dosyası ya
da bir ekran veya pencere), Görsel Nesneler, Logo, Çalan Parça, Metin, Şarkı Sözü ve başkaları.
Sıralamak için katmanı sürükleyin, seçmek için tıklayın.

**Sağ: denetçi.** Seçili olan şeyin ayarlarını gösterir. Listenin başındaki **Sahne** seçiliyken
sahnenin kendi ayarları görünür: **Renk Teması**, sahne değişirken kullanılan geçiş, ana efekt
zinciri ve **Şeffaf Arkaplan**. Bir katman seçiliyken o katmanın modu, boyutu, konumu, renkleri ve
karışımı görünür.

**Alt: raf.** Seçim yaptığınız kitaplık:

- **MilkDrop**: yerleşik presetler; arama, favoriler ve kendi `.milk` dosyalarınız için içe aktarma.
- **Görsel** ve **Zemin**: bütün görselleştirici ve arkaplan modları, küçük resimleriyle.
  Birine tıklamak seçili katmanı değiştirir; uygun katman seçili değilse yeni katman ekler.
- **Şablon**: kullanıma göre gruplanmış hazır sahneler (kulüp, ambiyans, yayın, müzik videosu ve
  başkaları). Uygulamak şimdiki görünümün yerine geçer.
- **Sahne**: kaydettiğiniz sahneler.

Raftaki ikinci simge onu araçlara çevirir: **Efekt Zinciri**, **Modülasyon** ve **Gruplar**.

İlk deneme için:

1. **Şablon**'dan istediğinize yakın bir sahne seçin.
2. Görselleştirici katmanını seçip **Görsel** rafından birkaç başka mod deneyin.
3. **Sahne**'yi seçip **Hazır Tema**'yı değiştirin.
4. Bir **Logo** ya da **Metin** katmanı ekleyip önizlemede yerine sürükleyin.

`Ctrl` + `Z` her adımı geri alır.

## 4. Sahneleri kaydedin

**Sahne**, bütün görünümün adlandırılmış bir anlık görüntüsüdür. Denetçinin başlığındaki kaydet
simgesine (ya da Canlı sayfasındaki **Kaydet**'e) basıp bir ad yazın. Kayıtlı sahneler **Sahne**
rafında, Canlı sayfasının ızgarasında ve telefon kumandasında görünür.

Yeni kurulumda Canlı sayfası **Örnek sahneleri ekle** düğmesini sunar. Hazır şablonlardan sekiz
sahne ekler; ekrandaki görüntüye dokunmaz. Kendi sahnelerinizi yapmadan Canlı sayfasını denemenin
hızlı yoludur.

## 5. Ekrana verin

1. Sağ üstteki ekran menüsünden ekranı seçin. **Çıktı → Ekran** sayfasında birden çok ekran
   işaretlenebilir; her biri kendi tam ekran penceresini alır.
2. **Görselleştirmeyi Aç**'a basın.
3. Bir görselleştirme penceresinde `Esc` hepsini kapatır.

Odak çıkış penceresindeyken şu tuşlar orada da çalışır:

| Tuş | Eylem |
|---|---|
| `Space` | Karartma; tekrar basınca sahne geri gelir |
| `F11` | Tam ekran ile pencere arasında geçiş |
| `Ctrl` + `S` | PNG anlık görüntü kaydet |
| `Ctrl` + `R` | Kaydı başlat ya da durdur |

**Çıktı → Ekran**'da **Yüzen pencere (PiP)** de var: saydamlığı ayarlanabilen, tıklamayı alttaki
pencereye geçirebilen küçük bir pencere; çalışırken görselleri masaüstünün üstünde tutmak için.

## 6. Gösteriyi Canlı sayfasından sürün

**Canlı** sayfası müzik çalarken görünüm değiştirmek için kurulmuştur.

- **Sahne ızgarası** kayıtlı sahnelerinizi tutar. Birine tıklamak ya da `F1`–`F12`'ye basmak onu
  **sıraya alır**: seyirci hâlâ **Canlı** görüntüyü görürken sahne **Sırada** monitöründe belirir.
- **AL** (ya da `Enter`) sıradaki sahneyi sahne geçişiyle canlıya alır.
- Monitörlerin arasındaki **T-bar** sıradaki sahneyi elle karıştırır. Yarıda bırakırsanız iki sahne
  karışık kalır; geri çekerseniz hiçbir şey değişmemiş olur.
- **Anlık Efektler** (Flaş, Strobe, Bulanık, Kaleydoskop, Glitch, Negatif) yalnız basılıyken etki eder.
- **Tempoya Vur** algılama emin değilken tempoyu elle verir; BPM göstergesi uygulamanın izlediği
  tempoyu yazar.
- **Otomatik VJ** sahneleri vuruşta sizin yerinize değiştirir. Başlatın, sahnelerinizi sırayla gezer.
- Alttaki kaydırıcılar her katmanın saydamlığıdır (solo ve sessiz düğmeleriyle); yanında ana çıkış
  kaydırıcısı durur.

Sahne ızgarasının yanındaki **Klip Destesi** sekmesi sahneleri, şablonları, paletleri ve medyayı
vuruşta ateşleyen bir ızgaradır. **Zaman** sayfası bir parçayı baştan sona izleyen gösteri içindir.
İkisi de README'nin
[gösteri kontrolü bölümünde](../README.tr.md#gösteri-kontrolü-zaman-çizelgesi-klip-destesi-otomatik-vj-midi-ve-osc)
anlatılır.

## 7. İstediğiniz gibi tepki versin

**Efektler.** Rafın araçlarında **Efekt Zinciri → Efekt Ekle** bütün görüntüye bir efekt koyar:
bloom, izler, glitch, renk düzeltme ve kırktan fazlası. Her katmanın denetçide kendi zinciri de
vardır; efekt yalnız o katmana dokunur.

**Modülasyon.** Her kaydırıcıyı müzik sürebilir. **Modülasyon**'da **Yönlendirme Ekle** bir kaynağı
(bas, serbest bant, LFO, zarf izleyici, makro düğmesi) bir miktarla bir ayara bağlar. Tek bir
yönlendirmeyle başlayın, örneğin *bas → görselleştiricinin ölçeği*; daha fazlasını eklemeden önce
ne yaptığına bakın.

## 8. Başka bir yerden yönetin

Bunların hepsi siz açana kadar kapalıdır.

- **Telefon kumandası.** **Çıktı → Yayın Çıkışı (OBS / Web)**'i açın, yerel ağdan erişime izin verin
  ve kumandanın adresini aynı Wi-Fi'daki bir telefonda açın. Canlı kontrol, sahneler, katmanlar,
  görünüm ve ses sayfaları vardır.
- **MIDI.** **Kurulum → Kontrol → MIDI Denetleyici**'de bir satırda **Öğren**'e basıp bir düğmeyi
  çevirin ya da bir pede basın. Notalar eylem tetikler (sonraki sahne, karartma); düğmeler ve
  faderlar ayarları sürer.
- **OSC, oyun kumandası, MQTT / Home Assistant, Art-Net** aynı Kontrol sayfasında, her biri kendi
  kartındadır.

## 9. Görüntüyü bir yere gönderin

**Çıktı** sayfasında:

- **Yayın Çıkışı (OBS / Web)** görselleri bir web sayfası olarak sunar. Adresini OBS'ye **Tarayıcı
  Kaynağı** olarak ekleyin; **Şeffaf Arkaplan** açıkken yayınınızın üstüne yalnız görseller biner.
- **Spout / Syphon Çıkışı** görüntüyü aynı bilgisayardaki başka bir programa GPU üzerinden verir.
- **Kayıt ve Anlık Görüntü** ekrandakini olduğu anda kaydeder.
- **Dosyaya** başlığındaki profiller (YouTube, Reels / Shorts / TikTok, Instagram, GIF döngü ve
  başkaları) **Video Dışa Aktar**'ı açar: bir ses dosyası seçersiniz, sahne parçanın tamamı için
  kare kare çizilir. Ekran kaydı değildir; sonuç bilgisayarınızın hızına bağlı olmaz ve aynı iş her
  seferinde aynı videoyu verir.

## 10. Gerçek bir gösteriden önce

- **Kurulum → Gösteri → Gösteri Öncesi Denetim** ekranlara, sese, kare hızlarına, sahnenin
  dosyalarına ve disk alanına tek yerden bakar.
- **Kaza Koruması** (Kurulum → Ayarlar) `Esc`'nin çıkışı yanlışlıkla kapatmasını önler;
  `Ctrl` + `Shift` + `Q` yine kapatır.
- **Kurulum → Kitaplık → Ayarları Yedekle / Geri Yükle** her şeyi tek dosyaya yazar. Gösteriden
  önce yedek alın; kurulumunuzu başka bir bilgisayara taşımak için de bunu kullanın.
- Zayıf bir makinede görüntü takılıyorsa **Çıktı → Güç / Performans**'ta **Uyarlanır Çözünürlük**
  ve kare hızı sınırı var.

## Sonraki adımlar

- [Modülasyon tarifleri](MODULATION-COOKBOOK.md) (İngilizce): kopyalayabileceğiniz tarifler.
- [Shader yazım kılavuzu](SHADER-GUIDE.md) (İngilizce): Stüdyo'da kendi görselleştiricinizi ya da
  arkaplanınızı yazın.
- [MIDI denetleyicileri](midi-controllers.md) ve [kumanda protokolü](REMOTE-PROTOCOL.md) (İngilizce).
- README'deki [SSS](../README.tr.md#sss).
