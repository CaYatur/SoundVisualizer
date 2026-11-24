# Telefon bağlantısı protokolü

SoundVisualizer Android uygulaması, yerel ağdaki masaüstü SoundVisualizer'ı yönetebilir: sahneler,
katmanlar, zaman çizelgesi, canlı denetim, çıkışlar ve telefonun sesi. Bu sayfa iletişim kuralını
ve güvenlik modelini anlatır (issue #1054). İngilizcesi: [PHONE-LINK.md](PHONE-LINK.md).

Kaynak: `src/main/phone-link.js` (çekirdek, saf), `src/main/phone-link-service.js` (oturumlar ve
işlem dağıtımı), `src/main/stream-server.js` (`/link` taşıyıcısı), `src/main/link-discovery.js` (ağda
duyuru), `src/shared/qr.js` (eşleşme QR kodu), `src/admin/phone-link-panel.js` (panel kartı).
İşlemler: `src/main/link-live.js` (canlı denetim), `src/main/link-guard.js` (ayar yazımı),
`src/main/link-audio.js` (ses), `src/main/link-upload.js` (dosya), `src/admin/link-live.js` (paneldeki uç).

## İlkeler

- **Varsayılan kapalı.** Kullanıcı Ayarlar → Kontrol → Telefon Bağlantısı'ndan açar.
- **Yalnız yerel.** Aynı Wi-Fi ya da telefonun kendi erişim noktası. Bulut aracısı, dış hizmet yok.
- **Uygulamada şifreli.** Yerel ağ düz HTTP; el sıkışmadan sonraki her ileti yalnız iki cihazın
  bildiği anahtarlarla AES-256-GCM ile şifrelenir.
- **Başka hiçbir şey açılmaz.** Bağlantıyı açmak yayın sunucusunu ağa açar, ama yayın sunucusunun
  kendi "LAN" anahtarı kapalıyken başka makineden gelen isteğe yalnız `/health`, `/link` ve
  yedeklilik eşi yanıt verir. Yayın sayfaları, web kumanda ve dosya yolları `127.0.0.1`'de kalır.
- **Anahtarlar makinede kalır.** Masaüstünün kimlik anahtarı ve her telefonun cihaz anahtarı uygulama
  veri klasöründeki `phone-link.json`'da, işletim sisteminin korumasıyla (Electron `safeStorage`)
  mühürlü durur. `settings.json`'a, tam yedeğe ve yedeklilik eşitlemesine girmez.

## Taşıma

WebSocket: `ws://<pc>:<yayın portu>/link`. El sıkışma iletileri JSON metin karesidir. Oturum
başladıktan sonra her kare ikilidir:

```
[ 8 bayt sayaç, büyük endian ][ şifreli metin ][ 16 bayt GCM etiketi ]
nonce = yön (4 bayt: "c2p\0" telefon→PC, "p2c\0" PC→telefon) || sayaç
ek veri = nonce
```

Her yönün kendi anahtarı ve sayacı var. Sayacı son kabul edilenden büyük olmayan kare atılır
(yeniden oynatma); doğrulanmayan kare atılır ve sayacı ilerletmez. Aynı anda en çok 8 telefon
bağlanabilir; telefon başına saniyede en çok 120 istek işlenir, fazlası `rate` yanıtı alır.

Kodlama: `b64u` dolgusuz base64url. Açık anahtarlar sıkıştırılmamış P-256 noktası (65 bayt,
`0x04 || X || Y`). `HMAC` HMAC-SHA256, `H` SHA-256, `HKDF` HKDF-SHA256. MAC'lerdeki metinler UTF-8,
gösterilen sırayla ayırıcısız birleştirilir.

## Bulma

Bağlantı açık ve "Ağda Görünür Ol" işaretliyken masaüstü iki saniyede bir UDP 47821'e yayın yapar
(`255.255.255.255` ve her IPv4 arabiriminin yayın adresi):

```json
{ "sv": "sv-link", "v": 1, "id": "<pc kimliği>", "name": "<bilgisayar adı>", "port": 8722 }
```

Duyuru gizli bir şey taşımaz; eşleşme yine QR ya da kod ister. Bilgisayar adı ağdaki herkese
görünür; istenmiyorsa "Ağda Görünür Ol" kapatılır, eşleşme QR ve adresle sürer.

## Eşleşme

Masaüstünün uzun ömürlü bir P-256 kimlik anahtarı var. "Telefon Ekle" iki dakikalık bir eşleşme
penceresi açar: altı rakamlı kod ve 32 baytlık tek kullanımlık sır. **Her yeni cihaz, iki yolda da
masaüstünde onay ister**: fotoğrafı çekilmiş ya da yayındaki ekranda görünen bir QR tek başına
yetmez. Bir adresten beş yanlış kod o adresi pencere boyunca kapatır; pencere ancak toplam 30
yanlıştan sonra yenilenir, ağdaki başka biri kullanıcının kodunu sürekli değiştiremez. Yanlış QR
sırrı pencereye dokunmadan reddedilir (32 rastgele bayt tahmin edilemez).

QR kodu şunu taşır:

```
svlink://1?h=<adres>[&h=<adres>…]&p=<port>&id=<pc kimliği>&f=<parmak izi>&s=<sır>&n=<ad>
parmak izi = b64u( H("sv-link-fp" || pcPub)[0..16] )
```

Bağlanınca masaüstü yollar: `{ "t": "hello", "v": 1, "pc": { "id", "name", "pub" }, "pairing": bool }`.

### QR ile

Telefon QR'ı okuduğunu, masaüstü QR'daki anahtarı tuttuğunu kanıtlar; kullanıcı masaüstünde onaylar.

```
telefon → { t:"pair", kind:"qr", v:1, pub, np, name, model, mac: HMAC(sır, "sv-link-qr|phone|" || devPub || np) }
PC      → { t:"pending", nc, pc:{ id, name, pub }, mac: HMAC(sır, "sv-link-qr|pc|" || pcPub || nc || devPub) }
          masaüstü telefonun adını ve altı rakamı gösterir (aşağıdaki gibi hesaplanır); telefon da gösterebilir
PC      → { t:"paired", device, level, pc:{ id, name } }        onaydan sonra
```

Telefon `pending` gelir gelmez `parmak izi(pc.pub)`u QR'la karşılaştırır ve `mac`i doğrular. Sır,
cihaz kaydedilince yakılır.

### Kodla (QR okunamazsa)

Bluetooth Secure Simple Pairing'deki gibi, önce taahhüt sonra açıklama ile sayı karşılaştırma:

```
telefon → { t:"pair", kind:"code", v:1, pub, name, model, proof: HMAC(kod, "sv-link-code|" || devPub) }
PC      → { t:"commit", pub: pcPub, commit: HMAC(nc, "sv-link-commit|" || pcPub || devPub) }
telefon → { t:"reveal", np }
PC      → { t:"reveal", nc }            telefon taahhüdü denetler
ikisi de gösterir  SAS = uint32_be( H("sv-link-sas" || devPub || pcPub || np || nc)[0..4] ) mod 1 000 000
kullanıcı altı rakamı karşılaştırıp masaüstünde onaylar
PC      → { t:"paired", device, level, pc:{ id, name } }
```

Masaüstü rastgele değerini telefonunkini görmeden taahhüt eder, telefon da kendininkini masaüstününkini
görmeden açıklar. Araya giren biri iki değerini de öbür tarafınkini öğrenmeden seçmek zorunda; iki
ekranın aynı sayıyı göstermesi deneme başına milyonda bir. Reddedilen ya da başarısız eşleşme
başarısız deneme sayılır. Kod yalnız eşleşmeyi kimin başlatabileceğini belirler; ağı dinleyip
öğrenilen kod yetmez, çünkü masaüstündeki kişi aynı sayıyı yine onaylamalıdır.

### Cihaz anahtarı

İki yol da aynı türetmeyle biter:

```
ortak   = ECDH(devPriv, pcPub) = ECDH(pcPriv, devPub)
devKey  = HKDF(ortak, tuz = np || nc, bilgi = "sv-link-device|" || b64u(H(devPub || pcPub)), 32)
cihaz kimliği = b64u( H("sv-link-id" || devPub) )[0..16]
```

Aynı anahtarla yeniden eşleşen telefon eski kaydının yerine geçer. Yeni cihaz **tam** erişimle
başlar (kullanıcı cihaz listesinde düşürebilir).

## Oturum

Her bağlantı, az önce eşleşen dahil, taze rastgele değerler kullanır:

```
telefon → { t:"resume", v:1, device, np, proof: HMAC(devKey, "sv-link-resume|phone|" || np) }
PC      → { t:"welcome", nc, level, pc:{ id, name }, proof: HMAC(devKey, "sv-link-resume|pc|" || np || nc) }
anahtarlar: c2p = HKDF(devKey, np || nc, "sv-link-session|phone-to-pc")
            p2c = HKDF(devKey, np || nc, "sv-link-session|pc-to-phone")
```

Eşleşmenin hemen ardından oturum eşleşmenin `np` ve `nc`'siyle başlar. Unutulan cihaz
`{ t:"error", code:"unknown-device" }` alır. El sıkışma 15 saniyede bitmeli (masaüstü sayı onayı
beklerken 90 saniye daha).

Şifreli iletiler:

```
telefon → { id, op, args }
PC      → { re: id, ok: true, result } | { re: id, ok: false, error, detail? }
PC      → { ev, … }                         her oturuma giden olay
```

Hatalar: `not-allowed` (cihazın düzeyi işlemi kapsamıyor ya da işlem bilinmiyor), `unsupported`
(izinli, bu sürümde yok), `bad-args`, `standby` (bu kopya birincilini izleyen yedek: yalnız `view`
işlemleri çalışır), `busy` (öz test yazımları bekletiyor), `panel-closed`, `rate`, `failed`. Ayar
yaması ayrıca `path`, `type`, `too-big`, `needs-pc`, `locked` ya da `scene` döndürür; `detail`
reddedilen üst anahtarı söyler.

El sıkışma hata kodları: `bad-message`, `protocol`, `timeout`, `pairing-closed`, `bad-secret`,
`bad-code`, `too-many`, `rejected`, `unknown-device`, `expected-encrypted`.

Oturumdan önce sunucu yalnız küçük (4 KB), parçasız metin karelerini kabul eder ve sessiz kalsa da
süresinde bitmeyen el sıkışmayı düşürür. Telefon bağlantıyı kapatınca (FIN) oturum hemen biter.

## İşlemler

Ağ üstündeki işlemler mutlaktır: "karartmayı değiştir" değil "karartma açık"; yeniden denenen istek
ya da aynı anda basan iki telefon bir durumu ters yöne çeviremez. Doğrulama `link-live.js` (canlı
denetim) ve `link-guard.js`te (ayar). Masaüstü paneli her değişikliği kendi koduyla uygular
(`src/admin/link-live.js`): panel tek yazar kalır, telefon ile panel birbirinin yazdığını ezmez,
geri alma ve yedeklilik paneldeki değişiklikteki gibi işler. Hiçbir işlem telefondan dosya yolu
almaz.

| İşlem | Bağımsız değişkenler | Düzey |
|---|---|---|
| `state.get` | → sürüm, ayar biçimi (`docVersion`), etkin sahne, sahneler, `standby` | izle |
| `config.get` | → `{ rev, config }`, bu makineye ait anahtarlar olmadan (`stream`, `mcp`, `phoneLink`, `redundancy`, `bridge`, `mqtt`, `updates`) | izle |
| `live.get` | → `{ meter, show }` | izle |
| `preview.get` | → `{ width, height, jpeg }` çıkışın gösterdiği kare, 480 px, base64 JPEG (250 ms telefonlar arasında paylaşılır) | izle |
| `audio.watch` | `{ on }` masaüstünün sesi bu telefona (aşağıda) | izle |
| `output.list` | → `{ displays, open, floating, selected }` | izle |
| `library.list` | `{ kind, q?, offset?, limit? }` `video`, `logo`, `lyrics` ya da `milkdrop` → `{ total, items:[{ id, name }] }` (yol yok) | izle |
| `thumb.get` | `{ kind, type }` `visualizer` ya da `background` mod resmi → `{ type, data }` base64 | izle |
| `scene.apply` | `{ id }` | kumanda |
| `cue.set` | `{ id }` (boş: sırayı temizler) | kumanda |
| `blackout` | `{ on }` | kumanda |
| `tbar` | `{ v }` çubuğun 0..1 konumu ya da `{ take: true }` | kumanda |
| `master.set` | `{ v }` 0..1 | kumanda |
| `mixer.set` | `{ layer, opacity }` ya da `{ layer, enabled }`, katman 1'den | kumanda |
| `momentary` | `{ list }` telefonun basılı tuttuğu efektler: `flash`, `strobe`, `blur`, `kaleido`, `glitch`, `negative` | kumanda |
| `deck.trigger` | `{ row, col }` | kumanda |
| `deck.stop` | `{}` hepsi ya da `{ col }` | kumanda |
| `macro.set` | `{ i, v }` makro 0..7, değer 0..1 | kumanda |
| `tempo.set` | `{ bpm }` 0 = müzikten bul, yoksa 30..200; vuruşlar telefonda ölçülür | kumanda |
| `tempo.tap` | `{}` masaüstünde ölçülen tek vuruş | kumanda |
| `autovj.toggle` | `{ on }` | kumanda |
| `milkdrop.nav` | `{ dir }` `next`, `prev`, `random` | kumanda |
| `milkdrop.load` | `{ id }` `library.list`'ten preset kimliği | kumanda |
| `timeline.transport` | `{ action }` `play`, `pause`, `stop`, `next`, `prev` (işaretler) ya da `{ action: "seek", t }` | kumanda |
| `run` | `{ id }` `src/main/remote-commands.js`'teki adlı eylem | kumanda |
| `config.patch` | `{ patch, final }` değişen üst anahtarlar; sürüklerken `final: false` | düzenleme (çıkış, ses, ışık ve güç anahtarları: tam) |
| `scene.create` | `{ name, data? }` veri yoksa masaüstünün o anki görünümü | düzenleme |
| `scene.save` | `{ id, data? }` | düzenleme |
| `scene.rename` | `{ id, name }` | düzenleme |
| `scene.delete` | `{ id }` | düzenleme |
| `scene.reorder` | `{ ids }` her sahne kimliği bir kez | düzenleme |
| `palette.save` | `{ name, colors? }` 2–5 `#rrggbb` | düzenleme |
| `palette.delete` | `{ id }` | düzenleme |
| `audio.bridge` | `{ on, fallback? }` bu telefonun sesi masaüstünün ses girişi | tam |
| `nowplaying.set` | `{ has, title, artist, album, position, duration, playing, artwork? }` telefonda çalan parça; saniye; kapak en çok 192 KB JPEG/PNG/WebP veri adresi, yalnız parça değişince | tam |
| `output.open` | `{ ids? }` `output.list`'teki ekran kimlikleri; yoksa kayıtlı seçim | tam |
| `output.close` | `{ id? }` bir ekran ya da hepsi | tam |
| `output.set` | `{ floating }` yüzen pencereyi aç/kapa | tam |
| `audio.sources` | → `{ devices, sources, phone }`; seçimin kendisi `config.patch { audio }` | tam |
| `record.start`, `record.stop` | | tam |
| `export.start` | `{ audio, format?, resolution?, fps?, quality? }` `audio`, `file.end`'in şarkı (`kind: "audio"`) için döndürdüğü kimlik; video bu bilgisayarın Videolar/SoundVisualizer klasörüne | tam |
| `export.cancel`, `export.status` | ilerleme ve bitiş `{ ev:"export", p }` olayıyla da gelir | tam |
| `file.begin`, `file.chunk`, `file.end`, `file.cancel` | Dosyalar bölümüne bakın | tam |

**Anlık efektler bir kiradır:** telefon basılı listesini yarım saniyede bir yeniden yollar; masaüstü
son yenilemeden 1,5 saniye sonra ve o telefonun oturumu kapanınca hemen bırakır. Bırakma iletisi
kaybolsa ya da bağlantı kopsa da efekt çıkışta takılı kalmaz. Kira ana süreçte tutulur: yenileme
yalnız zamanı tazeler, panel yalnız bütün telefonların birleşik listesi değişince çağrılır.
Telefonda yenilemeyi sayfa değil uygulama yapar (`linkHeld`, docs/android/HOST.md): sayfa basışı,
bırakışı ve saniyede bir "hâlâ basılı"yı bildirir, uygulama 4 saniye bildirim almazsa bırakır.
Telefonun basılıları paneldekilerden ayrı tutulur.

**Ayar yaması kuralları (`link-guard.js`):** yalnız listedeki anahtarlar; sahne listesi, kontrol
eşlemeleri ve bu makinenin anahtarları hiçbir düzeyde yazılamaz; değerler türünü korur; sayılar
sonludur ve kaydırıcı aralıklarına sıkıştırılır (katman ayarları dahil); **yol gibi görünen bir metin
bu makinenin ayarında zaten bulunmalıdır**: telefon kitaplıktaki bir dosyayı yeniden kullanabilir ama
masaüstünü yeni bir dosyaya yönlendiremez; web sayfaları ve görüntü girişleri (Spout, NDI, ekran,
kamera) yalnız masaüstünde düzenlenir, eklenir ve silinir (telefon açıp kapatabilir, saydamlığını ve
sırasını değiştirebilir); kilitli katman yama kilidi açmadıkça silinmez, yeri değişmez.

Olaylar:

```
{ ev:"config", rev, patch }   değişen üst anahtarlar; sürüm atlayan telefon config.get çağırır
{ ev:"meter", meter }         seviye, bantlar, BPM, vuruş; değişince, saniyede en çok beş kez
{ ev:"live", show }           etkin sahne, sıradaki, T-bar { rest, p, live }, karartma, basılı efektler,
                              çizelge { playing, time }, destede çalan hücreler ("satır:sütun,…"),
                              MilkDrop preset adı; değişince
{ ev:"export", p }            dışa aktarmanın aşaması ve ilerlemesi, bitişi (done | error | cancelled)
```

Olaylar ve ayar aynası yalnız oturumu açık telefon varken çalışır.

## Ses

Ses, şifreli oturumun içinde ikili ileti olarak gider. JSON iletiler `{` ile başlar; ses paketi tür
baytıyla:

```
[u8 1 = PCM][u8 sürüm 1][u32 BE sıra][u32 BE örnekleme hızı][u8 kanal 1|2][s16 LE örnekler]
```

Paket başına kanal başına en çok 8192 örnek, saniyede 400 paket, paket başına 64 KB. Yanıt yok.
Doğrulama `src/main/link-audio.js`; Kotlin karşılığı `link/LinkAudio.kt` (ortak bayt örneğiyle sınanır).

**Telefon → masaüstü (`audio.bridge`, tam düzey).** Telefon çaldığı, kaydettiği ya da yakaladığı
sesi yollar. Masaüstü analiz karelerini yakalama yardımcısının kullandığı kodla kurar
(`src/shared/audio-spectrum.js`, `src/main/audio-frame.js`), sesin her 1/60 saniyesi için bir kare;
görüntü, ışık, OSC, tempo ve MilkDrop yerel girişteki gibi tepki verir. Analiz karesi yerine ham ses
seçildi: 48 kHz stereo 16 bit PCM yaklaşık 192 KB/s, 7174 baytlık kare saniyede altmış kez yaklaşık
430 KB/s; ham sesle tempoyu masaüstünün kendi çözümlemesi bulur. Giriş geçişi ses köprüsününki
(`src/main/bridge-input.js`): kareler gelince giriş telefona geçer, telefon 0,6 saniye susunca
masaüstü yerel girişine döner (kapatılmadıysa). Telefonun sesi kullanılırken yerel yakalama durur.
Ayar: `phoneLink.audioIn { enabled, device, fallback, delayMs }`; `device` boşsa herhangi bir telefon,
`audio.bridge` isteyen telefona ayarlar. İki telefon yollarsa ilki, susana dek kullanılır.
`delayMs` (0–500 ms) Wi-Fi dalgalanması görüntüyü sesin önüne geçirirse kareleri bekletir.

**Parça bilgisi.** Telefonun sesi masaüstünün girişiyken telefonda çalan parça (ad, sanatçı, albüm,
konum, süre ve kapak, `nowplaying.set`) masaüstünün de "şimdi çalıyor"udur, ses köprüsündeki gibi:
şarkı bilgisi katmanı, söz arama, OBS sayfası ve OSC telefonun parçasını görür. Giriş yerele dönünce
masaüstünün kendi parçası geri gelir.

**Masaüstü → telefon (`audio.watch`, izle düzeyi).** Telefon, masaüstünün ayarını kendi motoruyla
çizmek için (akıcı önizleme ya da telefonu ek ekran olarak kullanma) masaüstünün sesini ister.
Masaüstü yakalama yardımcısının ham sesini aynı paket biçiminde yollar; soket kuyruğu 256 KB'ı aşan
telefona paket atlanır, gecikme birikmez. Telefon dinlerken çıkış penceresi açık olmasa da yakalama
sürer. Yalnız ilk ses kaynağı gider; masaüstünün girişi ağ köprüsü ya da telefonken hiçbir şey gitmez.

## Dosyalar

Telefon dosyayı parça parça yollar: `file.begin { kind, name, size }` → `{ id, chunk }`, sonra sırayla
`file.chunk { id, at, data }` (`at` o ana dek alınan bayt, `data` base64, en çok 96 KB ham), sonra
`file.end { id, sha256 }`. `src/main/link-upload.js` yalnız uygulamanın kendi `link-uploads`
klasörüne yazar; ad yalnız görünen addır (ayırıcılar, denetim karakterleri ve `..` çıkarılır, uzantı
korunur). Tür başına sınırlar:

| Tür | Uzantılar | En çok | Gittiği yer |
|---|---|---|---|
| `video` | mp4, webm, mkv, mov, m4v | 512 MB | medya kitaplığı |
| `logo` | png, jpg, jpeg, webp, gif, svg | 24 MB | logo kitaplığı |
| `lyrics` | lrc, txt, srt, vtt | 1 MB | söz kitaplığı |
| `milk` | milk, milk2 | 1 MB | kullanıcı presetleri (MilkDrop) |
| `audio` | mp3, m4a, aac, wav, flac, ogg, opus | 512 MB | `export.start` için tutulur (son üçü) |

Kitaplıklar içe aktarırken kendi tür ve boyut denetimlerini yapar. Sonda boyut ve SHA-256 tutmalı.
Telefon başına en çok iki aktarım; iki dakika parça gelmeyen aktarım ve oturumu kapanan telefonun
bütün aktarımları silinir. Klasör uygulama açılırken boşaltılır. Telefonda gönderimi uygulama yapar
(`link/LinkUpload.kt`): sayfa arka plandayken de sürer.

## Erişim düzeyleri

| Düzey | Ekler |
|---|---|
| `view` (izle) | durum, önizleme, kitaplık listeleri, küçük resimler, masaüstünün sesi |
| `control` (kumanda) | sahne geçişi, karartma, T-bar, anlık efektler, klip destesi, makrolar, tempo, Otomatik VJ, MilkDrop gezintisi, çizelge taşıması |
| `edit` (düzenleme) | ayar yamaları (katman, efekt, renk, metin, çizelge), sahne ve renk şablonu kaydetme ve silme |
| `full` (tam) | çıkışlar, ses kaynakları, dışa aktarma, kayıt, ışık, güç, dosya gönderme, telefon sesi |

Tabloda ayrılmış ama bu sürümde telefondan sunulmayanlar (`unsupported`): güncelleme, ses onarımı,
MIDI/OSC eşlemesi, yedeklilik devri ve web katmanı adresi; bunlar masaüstünde onay gerektirirdi.

Hiçbir düzeyde olmayanlar: masaüstünde keyfi yol okuma ya da yazma, yayın ve MCP jetonlarını okuma,
telefon bağlantısının kendi güvenlik ayarlarını değiştirme (yeni cihaz onayı, eşleşme açma). Bunlar
yalnız masaüstünde yapılır; çalınan bir telefon kendine yeni kapı açamaz. İşlem tablosu
`src/main/phone-link.js`'teki `OPS`; bilinmeyen işlem reddedilir.

**Sürüm kilidi.** Masaüstünün ayar biçimi (`docVersion`) telefonun bildiğinden yeniyse telefon
düzenlemeyi kapatır; izleme ve canlı denetim açık kalır. Cihazın düzeyi düzenlemenin altındayken de
telefon yazım yollamaz, düzenleyiciyi masaüstünün değerine geri çizer ve bir kez söyler.

Ayarlardaki `phoneLink` bu makineye aittir: MCP yazamaz; ayar içe aktarma ve tam yedeği geri yükleme bu
makinenin değerini korur; telefonun yaması da reddedilir.

Kayıtlı anahtarlar okunamazsa (ör. sistemin anahtar koruması o an kullanılamıyor) bağlantı kapalı
kalır ve dosyaya dokunulmaz; panel anahtarları yeniden kurmayı önerir, ardından her telefon yeniden
eşleşir.

## Panel

Ayarlar → Kontrol → Telefon Bağlantısı: aç/kapa, geri sayımlı QR ve kod, sayı onayı (panel hangi
sayfada olursa olsun çıkar; aynı anda iki istek sırayla), erişim düzeyiyle eşleşmiş cihazlar,
bağlantıyı kes ve unut, ağda görünürlük, "Telefondan Yapılan Değişiklikleri Bildir" (telefonun
düzenlemeleri ve gelen dosyalar için kısa bildirim), Telefonun Sesi (giriş, hangi telefon, yerele
dönüş, görüntü gecikmesi). Telefon bağlıyken üst çubukta "Telefon bağlı: ad" görünür, dokununca bu
kart açılır. Windows bağlantı ağı ilk dinlediğinde güvenlik duvarı izni sorar: "Özel ağlar"ı seçin.
