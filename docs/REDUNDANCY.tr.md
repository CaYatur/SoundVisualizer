# Yedeklilik: kurulum rehberi ve başvuru

*English: [REDUNDANCY.md](REDUNDANCY.md)*

İki makine aynı gösteriyi çalıştırır. **Birincil** gösteriyi yönetir; **yedek** aynı görüntüyü
sürekli çizer ve birincil düşerse yetkiyi alır. Ekran kararmaz: seyirciye hangi makinenin gideceğini
görüntü anahtarlayıcısı seçer. Bu sayfa kurulum rehberi (#815) ve yetki, çıkışlar ve kontrolün
başvurusudur (#814). Gösteri paketi ve yalıtılmış gösteri alanı birinci aşama (#812), ses köprüsü
ikinci aşama (#813, [AUDIO-BRIDGE.md](AUDIO-BRIDGE.md)).

## 1. Bağlantılar

```
                 ┌──────────── ses: mikser ayırıcı ──────────────┐
                 │               ya da ses köprüsü (yerel ağ)    │
           ┌─────▼─────┐   Ağ: bağlantı, atış, gösteri kopyası  ┌──────▼────┐
           │ BİRİNCİL  │◄───────────────────────────────►│   YEDEK   │
           └─────┬─────┘                                 └─────┬─────┘
       HDMI/SDI  │   Art-Net / OSC / OpenRGB: yalnız yetkideki │ HDMI/SDI
                 │   makine gönderir                           │
           ┌─────▼─────────────────────────────────────────────▼─────┐
           │        görüntü anahtarlayıcısı → projektör / LED       │
           └──────────────────────────────────────────────────────────┘
```

- **Ses.** İki makine aynı sinyali duymalı; yoksa yedek farklı bir görüntü çizer. Mikserin
  çıkışını iki makineye ayırın ya da **ses köprüsünü** kullanın (Ses → Ses Köprüsü): bir makine
  (ya da üçüncü bir aygıt) yakalar ve gönderir, iki makine de "Ses Girişi: Ağ Köprüsü"nü seçer.
  Köprü susarsa her makine 0,6 sn içinde kendi girişine döner.
- **Görüntü.** Her makine anahtarlayıcının ayrı bir girişine bağlanır. Spout/Syphon ve OBS sayfası
  iki makinede de çalışır.
- **Işık ve OSC.** Yalnız yetkideki makine gönderir (bkz. §5). İki makineyi de aynı Art-Net
  düğümüne ve OSC hedefine yöneltin.

## 2. Roller ve eşleşme

1. İki makinede: **Gösteri → Yedeklilik**.
2. Birincil: rol **Birincil**. **Yeni Parola**ya basıp kopyalayın.
3. Yedek: rol **Yedek**, aynı parolayı yapıştırın, birincilin adresini ve yayın portunu
   (varsayılan 8722) yazın.
4. Yedek başka bir bilgisayardaysa birincilde: Çıkış → Yayın Çıkışı → ağa açmayı etkinleştirin.

Durum hapı yeşile döner ("Birincili izliyor" / "Yedek bağlı"). Parola en az 16 karakterdir ve ağa
hiç çıkmaz: iki taraf da bildiğini HMAC sınamasıyla kanıtlar. Önceki sürümdeki bir yedek bir sürüm
daha bağlanabilir; gösteri öncesi denetim "Eski eşleşme" uyarısı verir.

## 3. Güvenlik duvarı ve portlar

| Port | Ne | Gereken makine |
|---|---|---|
| TCP 8722 (yayın portunuz) | yedeklilik bağlantısı, OBS sayfası | birincil (OBS yedeğe düşecekse yedek de) |
| TCP 8741 | ses köprüsü | köprü |
| UDP 8742 | köprü keşfi | köprü ve alıcılar |
| UDP 6454 | Art-Net tanığı (isteğe bağlı) | ikisi de |

- **Windows:** Defender Güvenlik Duvarı ilk dinlemede sorar; *Özel* ağlarda izin verin. Elle:
  `netsh advfirewall firewall add rule name="SoundVisualizer" dir=in action=allow protocol=TCP localport=8722`
  (8741 TCP ve 8742/6454 UDP için de). Sanal kartlar (Hyper-V, WSL, VPN) köprü işaretini taşıyabilir;
  alıcı kendi alt ağındaki adresi seçer.
- **macOS:** macOS sorduğunda gelen bağlantılara izin verin. Tek bir uygulamanın sesi için Ekran
  Kaydı izni gerekir (macOS 13+); sistem sesi için BlackHole ya da Loopback. Rol açıkken uygulama
  App Nap dışında tutulur; arka plandaki yedeğin zamanlayıcıları gecikmez.
- **Linux:** `sudo ufw allow 8722/tcp` (ve 8741/tcp, 8742/udp, 6454/udp) ya da firewalld karşılığı.
  PipeWire ve PulseAudio izleme kaynakları ikisi de çalışır. GNOME'da tepsi simgesi için AppIndicator
  gerekir. AppImage FUSE ister ya da `--appimage-extract-and-run`.

## 4. Ne kopyalanır, ne kopyalanmaz

| Kopyalanır (gösteri anahtarları) | Kopyalanmaz (kurulum, makineye özgü) |
|---|---|
| canlı sahne, katmanlar, kayıtlı sahneler, zaman çizelgesi, Clip Deck, Otomatik VJ ayarları | ses aygıtı, ekranlar, ağ, ışık hedefleri, dışa aktarım ayarları, eşleşme parolası |

- Yedek, birincilin kopyasını ayrı bir alanda tutar (`<userData>/redundancy`); kendi gösterisi hiç
  ezilmez ve rol kapatılınca olduğu gibi geri gelir.
- **Gösteri paketi** (Gösteri Verisi → Birincilden Paket İste): presetler, logolar ve yalnız
  işaretlerseniz video dosyaları. Parça parça, özetle denetlenerek, kopunca kaldığı yerden; hiçbir
  şey doğrulanmadan yerine geçmez. Dosyalar içerikleriyle adlandırılır: yeni paket oynayan bir
  videoya dokunmaz.
- **Kopyalanmış Videoları Kaldır** yeri geri açar; presetler ve logolar kalır.

## 5. Yetki ve çıkışlar

Yetki her an yalnız bir makinededir: yedek izlerken birincilde, yedek devralınca yedekte. Yetki
gösteri kararlarını (Otomatik VJ, zaman çizelgesi, Clip Deck) ve fiziksel ışıklara kimin
göndereceğini belirler.

| Çıkış | Varsayılan | "Her zaman" |
|---|---|---|
| Art-Net, OSC çıkışı (vuruş, saat, çarpma dahil), OpenRGB, Dynamic Lighting | yalnız yetkiyle | iki makine de gönderir |
| Görüntü, Spout/Syphon, OBS sayfası | her zaman | — |

Art-Net yetkiyi kaybedince son kareyi tutar (varsayılan) ya da bir kez siyah kare yollar.

**Dönem.** Her devralma yeni bir dönem açar (`<userData>/redundancy/term.json`; hiç küçülmez, yeni
parola sıfırlar). Yedeği daha yeni dönemle yetkide gören birincil geri çekilir. Rolü açık başlayan
birincil, yedeğin durumunu görene dek **çitli** kalır: çöküp yeniden açılan birincil, yetkideki
yedeğin yanında ışık sürmez.

**İki yönetici.** İki makine de yetkideyse (eşit dönem ya da isteğe bağlı Art-Net tanığı, biz
gönderirken evrenimizi başka bir adresten görürse) iki makinede de kırmızı alarm çıkar ve gösteri
öncesi denetim düşer. Birinde yetkiyi bırakın ya da geri verin. Tanık yalnız yayını ya da bu
makineye ulaşan trafiği görür; DMX'te kesin çit tek bir fiziksel çıkış yolu ya da sACN önceliği ister.

## 6. Devralma, bırakma ve geri verme

- **Kendiliğinden** (varsayılan): birincilin atışları kayıp eşiği kadar durunca yedek devralır
  (1,5 sn; birincilin süreci ölür ve işletim sistemi soketi kapatırsa 0,3–0,45 sn).
- **Elle**: "Elle Devral" (önce sorar; birincil hâlâ çalışıyorsa ayrıca uyarır).
- **Yetkiyi Bırak** yetkiyi hemen geri verir ve birincilden taze bir kopya ister. Elle bırakıştan
  sonra otomatik devralma, birincil yeniden görülene ya da siz yeniden kurana dek duraklar.
- **Birincile Geri Ver** korumalı yoldur: her koşulu listeler (birincil 5 sn kesintisiz atıyor,
  gösteriler aynı, saat eşlendi, aynı sürüm) ve seçtiğiniz anda geçer: hemen, sonraki sahne
  değişiminde ya da karartmada.
- **Devralma verisi**: birincilin kopyasıyla (varsayılan) ya da bu makinenin kendi gösterisiyle.
- **Kurtarma**: rol her kapanışta yerel gösteri `local-show.restored-<zaman>.json` olarak arşivlenir
  (en yeni 20'si kalır); Gösteri Verisi → Yerel Gösteri Arşivleri birini geri yükler, önce şu anki
  gösteri arşivlenir.

## 7. Durumu okumak

- **Durum bandı** rol açıkken her kategorinin üstünde: rol ve durum, yetki ve dönem, son atış, saat
  farkı, titreme, ses girişi. Yeşil: izliyor / yedek bağlı. Sarı: kayıp, bekliyor, çitli, geri
  çekildi. Kırmızı: yedek yetkide ya da iki yönetici.
- **Alarm**: devralmada, iki yöneticide ve birincil geri çekilince bant "Tamam"a basılana dek yanıp
  söner, işletim sistemi bildirim gösterir. Ses varsayılan kapalı (dinleti karışımına sızabilir);
  Durum grubunda "Alarmda Ses Çal"ı açın.
- Yedeklilik kartının kutucukları: kayıp eşiğine göre son atış, en uzun boşluk, atış aralığı p95,
  titreme, kayıp atış, örnek sayısıyla saat farkı, birincilin temposu ve faz farkı.
- **Öteki makine**: yetki, durum, kare hızı, ses seviyesi, açık çıkışlar, küçük canlı önizleme ve
  sonraki sahne, karartma, sonraki görselleştirici, çizelge oynat/duraklat düğmeleri. Komutlar
  yetkideki makinede uygulanır.

## 8. Vuruş eşlemesi ve OBS sayfası

- **Vuruş ve faz.** Birincil tempo ızgarasını (BPM, duvar saatiyle son vuruş, ölçüdeki yer) iki
  atışta bir yollar. İzleyen yedek onu kullanır ("İzlerken Birincilin Vuruşunu Kullan", varsayılan
  açık): iki makine ölçüleri birlikte sayar, yedek devralmada soğuk başlamaz. Panel, yedeğin kendi
  algısının bu ızgaradan ne kadar uzak olduğunu gösterir.
- **Köprünün dinlenebilir sesi** ortak saate göre çalınır: aynı gecikmedeki iki alıcı aynı örneği
  aynı anda çalar.
- **OBS / tarayıcı kaynağı yedeği.** Öbür makinenin yayın sayfası adresini (jetonuyla) Yedeklilik →
  Bağlantı → "Yayın Sayfasının Yedek Adresleri"ne iki makinede de yazın. Sayfa kendi makinesine üç
  denemede ulaşamazsa sıradaki adrese geçer, ilk adres yanıt verince ona döner. Sayfa son karesini
  ve ayarını korur; yedek adreslerdeki jetonlar web istemcisine gitmez. Sayfadaki video dosyası
  katmanları sayfanın yüklendiği makineden gelir.

## 9. Gösteri günü listesi

1. İki makinede aynı uygulama sürümü (Ayarlar → Uygulama).
2. Eşleşme: yedekte "Birincili izliyor", iki makinede bant yeşil.
3. Gösteri → Gösteri Öncesi Denetim: iki makinede de kırmızı satır yok.
4. Birincilde gösterileri karşılaştırın ("İki makine aynı gösteriyi çalıştırıyor"); değilse yedekte
   paketi isteyin.
5. Ses: iki makine seviye gösteriyor; köprüyle gösteri öncesi denetimde "Ses köprüden".
6. Işık: Çıkış Yetkisi'nde Art-Net/OSC yalnız bir makinede "açık".
7. Bir kez prova: yedekte Elle Devral, anahtarlayıcıyı ve ışıkları denetleyin, sonra Birincile Geri Ver.
8. OBS kullanılıyorsa yedek adres iki makinede de yazılı.

## 10. Ölçülenler

`npm run failover` aynı makinede iki gerçek uygulama kopyası çalıştırır (yerel döngü, 100 ms atış,
1,5 sn eşik) ve bir denetim tutmazsa düşer. `npm run failover -- --report=out.json` sayıları yazar.
Sayıların tamamı ve iki bilgisayarlı yöntem İngilizce sayfada: [REDUNDANCY.md §10](REDUNDANCY.md#10-measured).
Öne çıkanlar (Windows 11, iki tam koşunun aralığı): birincil ölünce devralma 371–501 ms; izlerken
tek Art-Net göndericisi; elle devralmada yetki 299–314 ms'de geçer, çakışma yok; bırakınca yedek
164–167 ms'de birincile eşit; geri verme 251–266 ms; yetkideki yedeğin yanında yeniden açılan
birincil 0 paket; soket açıkken ağ kesintisinde devralma 1434–1471 ms, bağlantı gelince birincil
~316 ms'de geri çekilir, alarm yok; önizleme en uzun atış aralığını değiştirmiyor.

## Yapılmayanlar

- **Gerçek iki bilgisayarlı ağ koşusu, macOS ölçümleri, macOS ve Linux paketlerinde atlama listesi,
  dock menüsü ve tepsi denetimi.** Bu proje o donanımda sınanmadı; yöntem İngilizce sayfada. Bütün
  otomatik denetimler Windows'ta ve CI'da Ubuntu ile Windows'ta koşuyor.
- **Köprü sesi için Opus.** Üç platformda yerel ya da wasm kodlayıcı ister; kablolu ağda PCM
  (dinleyici başına ~1,5 Mbit/s) yeter.
- **İnce bağımsız köprü** (Chromium'suz Node). Her platform için ayrı imzalı bir ürün olurdu;
  uygulamanın yalnız köprü kipi bir çekirdeğin ~%5'ini kullanıyor.
- **Birden çok köprü ve kendiliğinden seçim.** Tek köprü çözümleme için tek arıza noktasıdır; yedek
  giriş (mikser ayırıcı) bunu karşılar.
- **Köprünün üçüncü tanık olması.** İsteğe bağlı köprüyü yedekliliğe bağlardı.
