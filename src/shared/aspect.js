'use strict';
/* Piksel en boy oranı düzeltmesi — "basıklık" giderme.
 *
 * SORUN
 * Bir ekranın bildirdiği çözünürlük ile fiziksel şekli her zaman uyuşmaz.
 * 1920x1080 bildiren bir panel gerçekte 16:9 değilse (bar tipi paneller,
 * LED duvarlar, anamorfik lensli projektörler, sıkıştırılmış moda zorlanmış
 * televizyonlar), o panelde bir DAİRE ELİPS olarak çıkar. Kare dikdörtgen,
 * logo ezik, yazı basık görünür. İşletim sistemi bunu bilmez, uygulama da
 * kendiliğinden göremez: pencere 1920x1080'dir, gerisi camın arkasındadır.
 *
 * FİZİKSEL BÜYÜKLÜK: PAR (piksel en boy oranı)
 * Tek bir pikselin fiziksel genişliğinin yüksekliğine oranı.
 *
 *     PAR = (panel_genişliği / sütun_sayısı) / (panel_yüksekliği / satır_sayısı)
 *
 * PAR = 1  kare piksel, düzeltme gerekmez
 * PAR > 1  pikseller enine geniş; görüntü YASSI (dikeyden ezik) görünür
 * PAR < 1  pikseller boyuna uzun; görüntü UZAMIŞ görünür
 *
 * Bütün giriş yolları (elle ölçüm, bilinen en boy oranı, ekranda daireyi
 * yuvarlatana kadar kaydırıcı) tek bir PAR sayısına iner. Ayarın kendisi
 * bir tane; girmenin yolu birkaç tane.
 *
 * ÇÖZÜM: MANTIKSAL TUVALİ DEĞİŞTİR, GÖRÜNTÜYÜ GERME
 * Hazır bir kareyi büyütüp ekrana sığdırmak kırpar; küçültmek siyah bant
 * bırakır. İkisi de kayıptır. Bunun yerine sahne, PANELİN FİZİKSEL ŞEKLİNE
 * eşit oranlı, kare pikselli bir tuvale çizilir; o tuval çerçeve arabelleğine
 * doğrusal olarak sıkıştırılır. Panelin kendi çarpıklığı sıkıştırmayı geri
 * alır ve daire yuvarlak çıkar.
 *
 *     mantıksal_oran = (çerçeve_genişliği * PAR) / çerçeve_yüksekliği
 *
 * Kırpma yok, bant yok, taşma yok. Arkaplan, görselleştirici, logo, yazı ve
 * görsel nesnelerin hepsi AYNI mantıksal uzayda çizildiği için tek bir
 * ayarla hepsi birden düzelir — her görseli ayrı ayrı önceden germek gerekmez.
 *
 * PROJEKSİYON HARİTALAMASIYLA İLİŞKİSİ (src/shared/warp.js)
 * İkisi ayrı şeyler ve birlikte çalışırlar. Haritalama düz olmayan bir
 * YÜZEYE oturtmaktır; buradaki düzeltme panelin PİKSEL geometrisini
 * onarır. Haritalama koordinatları normalleştirilmiş (0..1) olduğu ve
 * buradaki sıkıştırma doğrusal olduğu için ikisi temiz beste yapar:
 * kurulmuş bir köşe kalibrasyonu, düzeltme açılınca yerinden oynamaz.
 *
 * NEREYE UYGULANIR
 * Düzeltme SAHNENİN değil, FİZİKSEL ÇIKIŞIN özelliğidir. Bu yüzden yalnızca
 * o ekrandaki görselleştirici penceresine uygulanır; dışa aktarılan videoya,
 * yayına, web kaplamasına ve paylaşılan dokuya uygulanmaz — onlar başka
 * ekranlarda izlenir ve orada düzeltme bozukluk olurdu.
 *
 * Bu dosyada yalnızca MATEMATİK var: tuval, DOM, WebGL yok. Sebebi
 * warp.js'teki ile aynı — sayısal olarak doğrulanabilsin (tests/aspect.test.js)
 * ve aynı kural hem canlı pencerede hem panelin önizlemesinde kullanılsın.
 */
(function () {
  /* PAR sınırları. 0.25..4 aralığı, gerçekte karşılaşılan her paneli fazlasıyla
     kapsıyor (en uç anamorfik lensler 2x civarı). Daha geniş bir aralık
     düzeltme değil, kullanıcının kazara ayarı bozması olurdu. */
  const MIN_PAR = 0.25;
  const MAX_PAR = 4;

  /* Çözünürlük bütçesi.
     Mantıksal tuval çerçeveden farklı şekilde olduğu için piksel sayısı da
     değişir; bu doğrudan kare hızına yansır. Üç davranış var:

     quality      Hiçbir eksen çerçevenin altına DÜŞMEZ; düzeltme yönünde üst
                  örnekleme yapılır. Piksel sayısı max(PAR, 1/PAR) kat.
     balanced     İki ekseni geometrik ortayla böler; piksel sayısı çerçeveyle
                  birebir aynı kalır.
     performance  Piksel sayısını en aza indirir.

     VARSAYILAN NEDEN 'quality':
     İlk tasarımda 'balanced' varsayılandı, "düzeltme bedava olsun" diye. Bu
     yanlıştı ve rakamla görülüyor. PAR 1.68 olan gerçek bir sahne ekranında
     1920x1080 çerçeve için balanced 2489x833 üretir: DİKEYDE 833 satır çizip
     panelin 1080 satırına gerer. Panelin gösterebileceği gerçek çözünürlük
     çöpe gider ve büyük bir sahne ekranında bu yumuşama görülür. quality ise
     3226x1080 üretir — yatayda üst örnekleme, dikeyde birebir; hiçbir eksende
     gösterilebilir çözünürlük kaybı yok. Bedeli 1.68 kat pikseldir ve
     görülebilir: arayüz maliyeti yazar, power.renderScale de zaten kaçış
     kapısıdır. Sessizce yumuşatmaktansa açıkça pahalı olmak doğru olan. */
  const QUALITIES = ['quality', 'balanced', 'performance'];
  const DEFAULT_QUALITY = 'quality';

  /* Piksel tavanı. PAR uçtayken (4) ve panel zaten 4K'ykenki çarpım gerçek
     bir donma sebebi olurdu; kalite kipi seçildi diye kullanıcı bunu istemiş
     sayılmaz. Tavana çarpıldığında oran korunarak iki eksen birden küçültülür:
     görüntü DOĞRU kalır, yalnızca yumuşar. */
  const MAX_LOGICAL_PIXELS = 3840 * 2160 * 2;

  // Kalibrasyon deseni — ölçemeyen kullanıcının gözüyle ayarlaması için
  const PATTERNS = ['none', 'circle', 'square', 'grid'];

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);

  /* Varsayılan bir düzeltme tanımı. Kapalı ve kimlik: hiçbir alan verilmezse
     ölçülebilir bir maliyeti yoktur. */
  function defaultOutput() {
    return {
      enabled: false,
      par: 1,
      quality: DEFAULT_QUALITY,
      pattern: 'none',
    };
  }

  /* Gelen tanımı güvenli hale getirir. Yapılandırma dosyası elle
     düzenlenebiliyor ve buradan çıkan sayı doğrudan tuval boyutuna gidiyor;
     NaN ya da 0 bir kareyi değil, pencereyi bozardı. */
  function normalize(def) {
    const d = def && typeof def === 'object' ? def : {};
    return {
      enabled: d.enabled === true,
      par: clamp(num(d.par, 1), MIN_PAR, MAX_PAR),
      quality: QUALITIES.indexOf(d.quality) >= 0 ? d.quality : DEFAULT_QUALITY,
      pattern: PATTERNS.indexOf(d.pattern) >= 0 ? d.pattern : 'none',
    };
  }

  /* Düzeltme gerçekten bir şey yapıyor mu? Değilse çağıran tüm aşamayı
     atlar. Eşik 1e-4: bundan küçük bir PAR farkı 4K'da bile yarım pikselin
     altında kalır, yani görülemez ama yeniden örneklemeye para ödetir. */
  function isIdentity(def) {
    const d = normalize(def);
    if (!d.enabled) return true;
    if (d.pattern !== 'none') return false;
    return Math.abs(d.par - 1) < 1e-4;
  }

  // ------------------------------------------------------------ PAR bulma

  /* Ölçülen panel boyutundan. Birim önemli değil (mm, cm, inç) — oran
     alındığı için birim sadeleşir; yeter ki ikisi aynı olsun. */
  function parFromPhysical(frameW, frameH, physW, physH) {
    const fw = num(frameW, 0);
    const fh = num(frameH, 0);
    const pw = num(physW, 0);
    const ph = num(physH, 0);
    if (fw <= 0 || fh <= 0 || pw <= 0 || ph <= 0) return 1;
    return clamp((pw / fw) / (ph / fh), MIN_PAR, MAX_PAR);
  }

  /* Bilinen gerçek en boy oranından (ör. "21:9 panel ama 1920x1080 sürülüyor").
     Panelin şekli hedef oran, çerçevenin şekli kaynak oran; PAR ikisinin
     bölümüdür. */
  function parFromAspect(frameW, frameH, targetW, targetH) {
    const fw = num(frameW, 0);
    const fh = num(frameH, 0);
    const tw = num(targetW, 0);
    const th = num(targetH, 0);
    if (fw <= 0 || fh <= 0 || tw <= 0 || th <= 0) return 1;
    return clamp((tw / th) / (fw / fh), MIN_PAR, MAX_PAR);
  }

  /* Kalibrasyon deseninden. Kullanıcı ekranda bir daire görüp cetvelle ya da
     gözüyle "genişliği X, yüksekliği Y" der; daire yuvarlak DEĞİLSE oranı
     doğrudan PAR verir. Ölçemeyen kullanıcı için asıl yol budur. */
  function parFromCircle(measuredW, measuredH) {
    const w = num(measuredW, 0);
    const h = num(measuredH, 0);
    if (w <= 0 || h <= 0) return 1;
    return clamp(w / h, MIN_PAR, MAX_PAR);
  }

  /* Kullanıcının ELDE YAPTIĞI telafiden. Basıklığı olan biri genelde çareyi
     bir görseli başka bir programda gerip öyle yüklemekte bulur; o gerilmiş
     dosya aslında PAR'ı zaten ölçmüştür. Yuvarlak olması gereken bir şekli
     0.6 en/boy oranında bir elipse çevirdiyse, panel dikeyde 1/0.6 kadar
     eziyor demektir.

     parFromCircle EKRANDA görülen şekli alır, bu ise KAYNAKTAKİ telafiyi;
     ikisi birbirinin tersidir. Ayrı işlev olmalarının sebebi, kullanıcının
     hangisini ölçtüğünü karıştırmasının çok kolay olması. */
  function parFromStretchedSource(sourceW, sourceH) {
    const w = num(sourceW, 0);
    const h = num(sourceH, 0);
    if (w <= 0 || h <= 0) return 1;
    return clamp(h / w, MIN_PAR, MAX_PAR);
  }

  /* PAR'ı insanın okuyabileceği bir orana çevirir ("1.33" yerine "4:3").
     Yalnızca gösterim içindir; hesapta ham sayı kullanılır. */
  function ratioText(par, maxDen) {
    const p = clamp(num(par, 1), MIN_PAR, MAX_PAR);
    const limit = Math.max(2, (maxDen | 0) || 64);
    let bestN = 1;
    let bestD = 1;
    let bestErr = Infinity;
    for (let d = 1; d <= limit; d++) {
      const n = Math.round(p * d);
      if (n < 1) continue;
      const err = Math.abs(p - n / d);
      if (err < bestErr - 1e-12) {
        bestErr = err;
        bestN = n;
        bestD = d;
      }
      if (bestErr < 1e-9) break;
    }
    return bestN + ':' + bestD;
  }

  // -------------------------------------------------- mantıksal tuval boyutu

  /* Düzeltmenin çekirdeği: çerçeve arabelleği bu boyutta, sahne HANGİ boyutta
     çizilmeli?

     Tek şart, mantıksal tuvalin oranının panelin fiziksel oranına eşit
     olmasıdır:  mantıksal_oran = (fw * PAR) / fh
     Bu oranı sağlayan sonsuz boyut var; aralarından seçimi kalite kipi yapar.

     Dönüş, sıkıştırma çarpanlarını da taşır: scaleX/scaleY, mantıksal tuvalin
     çerçeveye oturmak için çarpılacağı katsayılar. Biri daima 1'den küçük ya
     da eşittir; ikisi birden büyük olamaz, yoksa görüntü taşardı. */
  function renderSize(frameW, frameH, def) {
    const fw = Math.max(2, Math.round(num(frameW, 2)));
    const fh = Math.max(2, Math.round(num(frameH, 2)));
    const d = normalize(def);

    if (isIdentity(d)) {
      return { w: fw, h: fh, scaleX: 1, scaleY: 1, par: d.par, pixelRatio: 1, capped: false };
    }

    const par = d.par;
    let w;
    let h;

    if (d.quality === 'quality') {
      /* Hiçbir eksen küçülmesin: düzeltilmesi gereken ekseni büyüt. */
      if (par >= 1) { w = Math.round(fw * par); h = fh; }
      else { w = fw; h = Math.round(fh / par); }
    } else if (d.quality === 'performance') {
      /* Hiçbir eksen büyümesin: öteki ekseni küçült. Aynı oran, en az piksel. */
      if (par >= 1) { w = fw; h = Math.round(fh / par); }
      else { w = Math.round(fw * par); h = fh; }
    } else {
      /* Dengeli: geometrik orta. Piksel sayısı çerçeveyle aynı kalır, çünkü
         (fw*k) * (fh/k) = fw*fh — büyüme ve küçülme birbirini götürür. */
      const k = Math.sqrt(par);
      w = Math.round(fw * k);
      h = Math.round(fh / k);
    }

    w = Math.max(2, w);
    h = Math.max(2, h);

    /* Tavan denetimi. Oranı bozmamak için İKİ eksen birden aynı katsayıyla
       küçültülür — tek eksen küçültmek düzeltmenin kendisini bozardı. */
    let capped = false;
    const total = w * h;
    if (total > MAX_LOGICAL_PIXELS) {
      const k = Math.sqrt(MAX_LOGICAL_PIXELS / total);
      w = Math.max(2, Math.round(w * k));
      h = Math.max(2, Math.round(h * k));
      capped = true;
    }

    return {
      w,
      h,
      scaleX: fw / w,
      scaleY: fh / h,
      par,
      pixelRatio: (w * h) / (fw * fh),
      capped,
    };
  }

  /* Düzeltmenin kare başına maliyeti — çerçevenin kaç katı piksel çizilecek.
     Arayüz bunu göstersin diye ayrı: kullanıcı "kalite" kipini seçmeden önce
     bedelini görmeli. */
  function pixelCost(frameW, frameH, def) {
    return renderSize(frameW, frameH, def).pixelRatio;
  }

  /* Düzeltme AÇIKKEN bir dairenin ekranda gerçekten yuvarlak çıkıp
     çıkmadığı. Sağlama işlevi: mantıksal tuvalde 1:1 çizilen bir şeklin
     fiziksel en boy oranını verir, doğruysa 1 döner. Testin asıl dayanağı bu —
     boyut formülünü değil, GÖZÜN GÖRECEĞİ sonucu ölçer. */
  function shapeOnScreen(frameW, frameH, def) {
    const r = renderSize(frameW, frameH, def);
    const d = normalize(def);
    /* Mantıksal 1x1 kare -> çerçevede scaleX x scaleY -> panelde PAR ile enine
       gerilir.

       PAR burada KOŞULSUZ çarpılır. Panelin çarpıklığı fiziksel bir gerçek;
       ayarı kapatmak camın arkasındaki geometriyi değiştirmez, yalnızca
       telafiyi bırakır. (İlk yazımda kapalıyken par=1 alınmıştı ve işlev
       "düzeltme kapalı -> her şey yuvarlak" diyordu; sağlama işlevinin
       kendisi yanlış olunca test de hiçbir şey kanıtlamıyordu.) */
    return (r.scaleX * d.par) / r.scaleY;
  }

  // ------------------------------------------------------- ekran başına çözüm

  /* Ekran başına ya da tümü için. Haritalamadaki (mapping.outputs) örüntünün
     aynısı: kimliğe özel tanım varsa o, yoksa 'default'. Böylece kullanıcı
     tek ekranı ayrı ayarlayabilir ya da hepsine birden aynı düzeltmeyi
     verebilir. */
  function resolve(root, displayId) {
    const r = root && typeof root === 'object' ? root : {};
    if (r.enabled === false) return defaultOutput();
    const outs = r.outputs && typeof r.outputs === 'object' ? r.outputs : {};
    const own = (displayId != null && outs[displayId]) || outs.default || null;
    if (!own) return defaultOutput();
    return normalize(own);
  }

  const api = {
    MIN_PAR, MAX_PAR, QUALITIES, DEFAULT_QUALITY, PATTERNS, MAX_LOGICAL_PIXELS,
    defaultOutput, normalize, isIdentity,
    parFromPhysical, parFromAspect, parFromCircle, parFromStretchedSource, ratioText,
    renderSize, pixelCost, shapeOnScreen, resolve,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVAspect = api;
})();
