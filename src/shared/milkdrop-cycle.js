'use strict';
/* MilkDrop otomatik preset geçişi — ne zaman, hangisine.
 *
 * NEDEN VARDI AMA ÇALIŞMIYORDU
 * `milkdrop.autoNext` ayarı ilk MilkDrop commit'inden beri duruyor: panel
 * yazıyor, ayar dosyasına kaydediliyor, varsayılanlarda tanımlı — ve HİÇBİR
 * YER OKUMUYORDU. Kullanıcı "2 saniye" diyor, hiçbir şey olmuyor, ortada
 * hata da yok. Ölçüldü: `autoNext=2` ile dokuz saniye sonra motorun preset
 * anahtarı değişmemiş.
 *
 * NEDEN MOTOR TARAFINDA
 * İlk akla gelen yer panel: preset listesi orada, `load()` orada. İki sebeple
 * olmaz.
 *
 *   1. Her yapılandırma gönderimi settings.json'ı SENKRON yeniden yazıyor
 *      (main.js `saveSettings`, debounce yok) ve `.milk` kaynağı onlarca
 *      kilobayt. İki saniyede bir geçiş, dakikada otuz kez tam dosya yazımı
 *      demek olurdu.
 *   2. Panelin döngüsü requestAnimationFrame; görselleştirici tam ekranda
 *      paneli ÖRTÜYOR ve örtülü pencerede rAF çalışmıyor. Yani tam da
 *      kullanıcının izlediği anda sayaç duruyordu.
 *
 * Motorun elinde ikisi de var: preset listesi görselleştiriciye zaten
 * gönderiliyor (`SVPresets.setUser`) ve çizim döngüsü zaten koşuyor.
 *
 * SAAT ÇİZİM SAATİ, DUVAR SAATİ DEĞİL
 * Sayaç `dt` ile ilerliyor. Sonucu: çevrimdışı dışa aktarımda geçişler
 * VİDEO zamanında oluyor — kullanıcının "8 saniyede bir" dediği video da
 * sekiz saniyede bir değişiyor, render'ın ne kadar sürdüğünden bağımsız.
 *
 * MILKDROP 2'NİN ZAMANLAMASI (#568)
 * İlk sürüm yalnız "N saniyede bir" biliyordu. MilkDrop 2 üç şey daha
 * yapıyor ve üçü de burada, kendi kaynağından (jecassis/foo_vis_milk2
 * 5b44cea):
 *   - Sonraki geçiş = geçiş süresi + aralık + 0..pay arası rastgele bir süre
 *     (milkdropfs.cpp:765-769). Pay preset başına BİR KEZ çekiliyor.
 *   - Kilit: sonraki geçiş zamanı her kare kare süresi kadar öteleniyor,
 *     presetin başlangıcı da (771-778); sert geçiş de kapalı (886).
 *   - Sert geçiş: sesin ani yükselişinde geçişsiz yeni preset (882-906).
 * `progress` da buradan geliyor, çünkü MilkDrop'ta anlamı bu planın
 * kendisi: presetin planlanan ömrünün ne kadarı geçti.
 *
 * Saf ve durumlu: GL ya da DOM istemiyor, Node içinde sınanıyor. */
(function () {
  const ORDERS = ['sequential', 'random'];
  /* Üst sınır yalnızca ayar dosyası elle düzenlenirse diye: negatif ya da
     devasa bir sayı sayaç aritmetiğini bozmamalı. */
  const MAX_SECONDS = 600;
  const MAX_SPREAD = 600;
  /* Geçiş süresi planlanan ömre giriyor; motor onu 5 saniyede kesiyor
     (modes/milkdrop.js BLEND_MAX), burada da aynı sınır. */
  const MAX_BLEND = 5;
  const HARD_CUTS = ['off', 'md2'];
  /* MilkDrop 2'nin varsayılanları (plugin.cpp:491-493): sert geçiş KAPALI,
     eşik 2,5, "yarı ömür" 60 sn. */
  const HARD_THRESHOLD = 2.5;
  const HARD_HALFLIFE = 60;

  function range(v, dflt, lo, hi) {
    const x = Number(v);
    return isFinite(x) ? Math.max(lo, Math.min(hi, x)) : dflt;
  }

  /* PUAN (#569). MilkDrop her presetin puanını KENDİ dosyasından okuyor:
     [preset00] altındaki `fRating`, yoksa 3, 0..5'e kıstırılmış
     (plugin.cpp:5795-5796, state.cpp:535). Anahtar adı Windows'un .ini
     okuyucusu gibi büyük/küçük harf ayırmadan aranıyor.

     Kullanıcının verdiği puan dosyaya değil ayarlara yazılıyor
     (`milkdrop.ratings`, kimlik → puan). Her preset kaydı bütün listeyi —
     kaynaklarıyla — bütün pencerelere yeniden yayınlıyor (main.js
     `broadcastPresets`); yıldıza her tıklama yüzlerce presetlik bir listeyi
     taşımamalı. */
  const RATING_DEFAULT = 3;
  const RATING_RE = /^[ \t]*fRating[ \t]*=[ \t]*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/mi;

  function fileRating(source) {
    if (typeof source !== 'string' || !source) return RATING_DEFAULT;
    const m = RATING_RE.exec(source);
    const v = m ? Number(m[1]) : NaN;
    return isFinite(v) ? Math.max(0, Math.min(5, v)) : RATING_DEFAULT;
  }

  /* ÖNBELLEK YOK, bilerek. Rastgele seçim her geçişte bütün presetlerin
     puanına bakıyor ama `fRating` dosyanın başında: ölçüldü, 695 presetlik
     bir kitaplıkta en geç 1.143. karakterde bulunuyor ve tam tarama 0,16 ms.
     "Kimlik + kaynak uzunluğu" anahtarlı bir önbellek ise `fRating=3`ü
     `fRating=4` yapan bir düzenlemeyi — uzunluk aynı — hiç görmezdi. */
  function ratingOf(p, ratings) {
    if (!p) return RATING_DEFAULT;
    if (ratings && typeof ratings === 'object' &&
        Object.prototype.hasOwnProperty.call(ratings, p.id)) {
      const r = Number(ratings[p.id]);
      if (isFinite(r)) return Math.max(0, Math.min(5, r));
    }
    return fileRating(p.source);
  }

  function normalize(md) {
    const m = md || {};
    const s = Number(m.autoNext);
    const r = Number(m.autoNextRand);
    const b = Number(m.blendTime);
    return {
      seconds: isFinite(s) && s > 0 ? Math.min(MAX_SECONDS, s) : 0,
      order: ORDERS.indexOf(m.autoOrder) >= 0 ? m.autoOrder : 'sequential',
      spread: isFinite(r) && r > 0 ? Math.min(MAX_SPREAD, r) : 0,
      blend: isFinite(b) && b > 0 ? Math.min(MAX_BLEND, b) : 0,
      locked: m.locked === true,
      hardCut: HARD_CUTS.indexOf(m.hardCut) >= 0 ? m.hardCut : 'off',
      threshold: range(m.hardCutThreshold, HARD_THRESHOLD, 0.5, 20),
      halfLife: range(m.hardCutHalfLife, HARD_HALFLIFE, 1, 600),
      /* Puana göre seçim MilkDrop'ta varsayılan AÇIK (`m_bEnableRating`,
         plugin.cpp:509). */
      useRatings: m.useRatings !== false,
      ratings: m.ratings && typeof m.ratings === 'object' ? m.ratings : null,
    };
  }

  /* Sıradaki preset. `currentId` listede yoksa (yerleşik varsayılan
     çiziliyorsa) sıradaki ilk presettir. `weight` verilirse rastgele sıra
     puana göre ağırlıklı. */
  function pick(list, currentId, order, rnd, weight) {
    const n = Array.isArray(list) ? list.length : 0;
    if (!n) return null;
    const i = list.findIndex((p) => p && p.id === currentId);
    if (order === 'random') {
      /* O an çizilen preset ELENİYOR. n taneden düzgün seçim 1/n olasılıkla
         aynı preseti veriyor ve o geçişte ekranda hiçbir şey değişmiyor:
         kullanıcı "atladı" diye değil "çalışmıyor" diye okur. Üç presetlik
         bir seçimde her üç geçişten biri böyle olurdu. */
      const others = i < 0 ? list : list.slice(0, i).concat(list.slice(i + 1));
      if (!others.length) return null;
      /* PUANA GÖRE: puanların birikimli dağılımından (plugin.cpp:5160-5199).
         0 puanlı preset rastgele hiç gelmiyor. Toplam 0,1'in altındaysa
         — hepsi 0 — MilkDrop düzgün seçime dönüyor, burada da. MilkDrop o
         an çizileni elemiyor; burada eleniyor, yukarıdaki sebeple. */
      if (typeof weight === 'function') {
        let total = 0;
        const cum = new Array(others.length);
        for (let k = 0; k < others.length; k++) {
          const w = Number(weight(others[k]));
          if (w > 0) total += w;
          cum[k] = total;
        }
        if (total >= 0.1) {
          let x = Number(rnd()) * total;
          if (!(x >= 0)) x = 0;
          // rnd() 1 dönerse x toplama eşit olur ve arama 0 puanlı bir kuyruğa düşebilirdi
          if (x >= total) x = total * (1 - 1e-12);
          let lo = 0, hi = others.length - 1;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (cum[mid] > x) hi = mid; else lo = mid + 1;
          }
          return others[lo];
        }
      }
      let k = Math.floor(rnd() * others.length);
      if (!(k >= 0)) k = 0;
      // rnd() tam olarak 1 dönerse indis taşardı; üreteç sözleşmesine güvenilmiyor
      if (k >= others.length) k = others.length - 1;
      return others[k];
    }
    return list[((i < 0 ? -1 : i) + 1 + n) % n];
  }

  class Cycle {
    constructor(rnd) {
      this.elapsed = 0;
      this.rnd = typeof rnd === 'function' ? rnd : Math.random;
      /* Son sonucun sebebi. Sayı değil kod: panelin ve testin "neden
         değişmedi" sorusunu cevaplayabilmesi için. Otomatik VJ'de aynı
         desen var ve sebebi aynı — sessiz başarısızlık en pahalı hata. */
      this.reason = 'OFF';
      /* Bu presetin rastgele payı, 0..1. null = daha çekilmedi. MilkDrop onu
         sonraki geçiş zamanını kurarken BİR KEZ çekiyor; her kare çekilseydi
         bitiş zamanı titrer, `progress` da geri gidebilirdi. */
      this.jitter = null;
      /* Sert geçiş eşiği. null = daha kurulmadı. */
      this.thresh = null;
      /* Son dönen seçim sert geçiş miydi. Motor geçiş süresini buna göre
         seçiyor: sert geçiş karışmadan olur. */
      this.cut = false;
    }

    reset() {
      this.elapsed = 0;
      this.jitter = null;
    }

    /* Presetin planlanan ömrü. Pay yoksa rastgele sayı hiç çekilmiyor:
       üretecin sırası payı kullanmayan kurulumda eskisiyle aynı kalıyor. */
    _due(o) {
      if (!o.spread) return o.blend + o.seconds;
      if (this.jitter === null) {
        const j = Number(this.rnd());
        this.jitter = j > 0 ? Math.min(1, j) : 0;
      }
      return o.blend + o.seconds + this.jitter * o.spread;
    }

    /* Zamanlayıcı da sert geçiş de aynı kuralla seçiyor: sıra, rastgelede
       puan ağırlığı. */
    _pick(list, currentId, o) {
      const w = o.useRatings ? (p) => ratingOf(p, o.ratings) : null;
      return pick(list, currentId, o.order, this.rnd, w);
    }

    /* SERT GEÇİŞ — MilkDrop 2, milkdropfs.cpp:882-906.

       Koşul: bas + orta + tiz, HER BİRİ KENDİ UZUN ORTALAMASINA BÖLÜNMÜŞ
       olarak (motorun `bass/mid/treb`i tam olarak bu, milkdrop-audio.js),
       eşiğin üç katını aşarsa geçişsiz yeni bir preset ve eşik iki katına.
       Aşmazsa eşik kendi tabanına doğru sönüyor. İlk kurulduğunda eşik
       tabanın iki katı (885): açılır açılmaz ilk vuruşta kesmesin.

       Adıyla davranışı farklı: katsayı −1,3863 = −2·ln2 (901). Fazlalık
       `halfLife` saniyede yarıya değil DÖRTTE BİRE iniyor; yarıya inmesi
       bunun yarısı kadar sürüyor. Formül birebir korunuyor — presetleri
       MilkDrop'ta izleyen biri aynı sıklıkta kesim görmeli.

       Eşik her uygun karede güncelleniyor: zamanlayıcı o kare bir preset
       seçse bile MilkDrop eşiği yine ikiye katlıyor ya da söndürüyor
       (yükleme sürerken yalnız yeni yüklemeyi atlıyor, 889-892). */
    _hard(d, o, rel) {
      if (this.thresh === null) this.thresh = o.threshold * 2;
      // MilkDrop saniyede birden az kare varken hiç bakmıyor (886, GetFps() > 1)
      if (!(d > 0) || d >= 1) return false;
      const sum = rel ? Number(rel.bass) + Number(rel.mid) + Number(rel.treb) : NaN;
      if (!isFinite(sum)) return false;
      if (sum > this.thresh * 3) {
        this.thresh *= 2;
        return true;
      }
      const k = Math.exp(-2 * Math.LN2 * d / o.halfLife);
      this.thresh = (this.thresh - o.threshold) * k + o.threshold;
      return false;
    }

    /* Bir kare ilerlet. Dönüş: geçilecek preset ya da null.
       `list` MilkDrop presetleri, `currentId` o an çizilenin kimliği,
       `rel` sert geçişin baktığı { bass, mid, treb } (uzun ortalamaya göre;
       yoksa sert geçiş bu kare bakmıyor). Dönüşten sonra `this.cut` o
       seçimin sert geçiş olup olmadığını söylüyor. */
    step(dt, md, list, currentId, rel) {
      const o = normalize(md);
      const n = Array.isArray(list) ? list.length : 0;
      const d = Math.max(0, Number(dt) || 0);
      const hard = o.hardCut !== 'off';
      this.cut = false;
      /* Sert geçiş kapatılınca eşik unutuluyor: yeniden açıldığında bir
         önceki patlamanın yüksek eşiğiyle değil, baştan (iki kat) başlıyor.
         MilkDrop'ta açıp kapamak bir .ini ayarı; bizde canlı bir düğme. */
      if (!hard) this.thresh = null;
      /* Kapalıyken, liste boşken ve tek presetliyken sayaç SIFIRLANIYOR:
         aksi hâlde ayar açılır açılmaz birikmiş süre yüzünden anında bir
         geçiş olurdu ve kullanıcı aralığı hiç görmezdi. */
      if (!o.seconds && !hard) { this.elapsed = 0; this.reason = 'OFF'; return null; }
      if (!n) { this.elapsed = 0; this.reason = 'EMPTY'; return null; }
      /* Tek preset: kendine geçmek preseti baştan başlatır, yani ekranda
         geçiş değil takılma görünür. */
      if (n === 1) { this.elapsed = 0; this.reason = 'ALONE'; return null; }
      /* KİLİT. MilkDrop başlangıcı da bitişi de kare süresi kadar ötelediği
         için kalan süre ve `progress` donuyor — sayacın durması aynı şey.
         Kilit açılınca kalan süre kaldığı yerden sayıyor. Sert geçiş
         kilitteyken hiç değerlendirilmiyor, eşik de dokunulmadan kalıyor. */
      if (o.locked) { this.reason = 'LOCKED'; return null; }
      const loud = hard && this._hard(d, o, rel);
      if (o.seconds) {
        this.elapsed += d;
        if (this.elapsed >= this._due(o)) {
          this.elapsed = 0;
          this.jitter = null;
          const p = this._pick(list, currentId, o);
          this.reason = p ? 'OK' : 'EMPTY';
          return p;
        }
      } else {
        this.elapsed = 0;
      }
      if (loud) {
        const p = this._pick(list, currentId, o);
        if (p) {
          this.elapsed = 0;
          this.jitter = null;
          this.cut = true;
          this.reason = 'CUT';
          return p;
        }
      }
      this.reason = o.seconds ? 'WAIT' : 'ARMED';
      return null;
    }

    // Sıradaki geçişe kalan saniye (panelin durum satırı için)
    remaining(md) {
      const o = normalize(md);
      if (!o.seconds) return 0;
      return Math.max(0, this._due(o) - this.elapsed);
    }

    /* `progress` — MilkDrop 2'deki anlamıyla (milkdropfs.cpp:476, 3710):
         (şimdi − başlangıç) / (sonraki geçiş − başlangıç)
       yani presetin PLANLANAN ömrünün ne kadarı geçti. Kilitte donuyor,
       geçişte sıfırlanıyor, geçişten hemen önce 1'e varıyor — presetler
       onu tam da bunun için okuyor ("son %1'de söndür" gibi).

       Otomatik geçiş kapalıyken planlanmış bir geçiş yok ve değer 0.
       MilkDrop'ta buna en yakın iki durum da 0 veriyor: kilitli yüklenen
       preset (başlangıç ve bitiş birlikte kayıyor) ve devasa bir aralık
       (t / devasa ≈ 0). Eski yer tutucu `(t · 0,1) mod 1` her on saniyede
       bir sıfıra düşüyordu: "son %1'de söndür" yazan preset on saniyede bir
       sönüyordu. */
    progress(md) {
      const o = normalize(md);
      if (!o.seconds) return 0;
      const due = this._due(o);
      return due > 0 ? this.elapsed / due : 0;
    }
  }

  /* GEÇMİŞ (#569) — ekranda gösterilenler, sırasıyla. "Geri" listede bir
     önceki presete değil, gerçekten bir önce GÖSTERİLENE dönüyor; otomatik
     geçiş ya da sert geçiş ne seçtiyse o da giriyor.

     MilkDrop 64 adım tutuyor (plugin.h:57: 64 + 2, "geri gidebilmek için
     iki fazla"), yalnız rastgele sırada (plugin.cpp:5395). Burada iki sırada
     da: sırayla geçişte elle bir yere atlandıysa "geri" yine oraya değil,
     az önce görülene dönmeli.

     Bilinçli bir fark: geri gidildikten sonra yeni bir preset gösterilirse
     ileri kısım atılıyor — tarayıcıdaki gibi. MilkDrop'ta bu durumda
     otomatik geçiş önce ileri geçmişi yeniden oynatıyor (5117-5129). Burada
     geçmiş panelde, otomatik seçim görselleştiricide yapılıyor; seçici
     paneldeki geçmişi bilmiyor. */
  class History {
    constructor(max) {
      this.max = Number(max) > 1 ? Math.floor(max) : 64;
      this.items = [];
      this.pos = -1;
    }

    // Ekranda şu an `id` var. Dönüş: geçmiş değişti mi.
    note(id) {
      if (!id) return false;
      if (this.pos >= 0 && this.items[this.pos] === id) return false;
      this.items = this.items.slice(0, this.pos + 1);
      this.items.push(id);
      if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
      this.pos = this.items.length - 1;
      return true;
    }

    canBack() { return this.pos > 0; }
    canForward() { return this.pos >= 0 && this.pos < this.items.length - 1; }

    back() {
      if (!this.canBack()) return null;
      this.pos--;
      return this.items[this.pos];
    }

    forward() {
      if (!this.canForward()) return null;
      this.pos++;
      return this.items[this.pos];
    }

    current() { return this.pos >= 0 ? this.items[this.pos] : null; }
  }

  const api = {
    normalize, pick, Cycle, History, ORDERS, MAX_SECONDS, MAX_SPREAD, HARD_CUTS,
    HARD_THRESHOLD, HARD_HALFLIFE, RATING_DEFAULT, fileRating, ratingOf,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVMilkdropCycle = api;
})();
