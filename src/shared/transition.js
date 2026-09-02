'use strict';
/* Sahne geçişleri.

   Sahne değiştirmek şimdiye kadar sert kesmeydi: bir kare eski sahne, sonraki
   kare yenisi. Bu modül aradaki geçişi tanımlar — çapraz geçiş, silme, zum,
   glitch, parlama ve daha fazlası.

   Modül İKİ parçadan oluşur ve ayrım bilinçli:

     1. Saf matematik (burada): ilerleme, yumuşatma eğrileri ve her geçiş
        türünün "bir piksel ne kadar yeni sahneden gelir" kuralı. Tuval,
        WebGL, DOM yok — bu yüzden tests/transition.test.js her geçişi doğrudan
        ölçebiliyor.
     2. Birleştirici (compose): iki hazır kareyi bu kurala göre tek kareye
        indirir. Canlı pencerede ve çevrimdışı dışa aktarıcıda aynı kod.

   Geçiş ilerlemesi ÇİZİM DÖNGÜSÜNÜN saatinden beslenir (dışa aktarıcıda
   t = kare/fps), bu yüzden dışa aktarılan videoda geçişler de kare kare
   tekrarlanabilir. */
(function () {
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  // ==========================================================================
  // Yumuşatma eğrileri
  // ==========================================================================
  const EASINGS = {
    linear: (t) => t,
    smooth: (t) => t * t * (3 - 2 * t),
    easeIn: (t) => t * t,
    easeOut: (t) => 1 - (1 - t) * (1 - t),
    easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
    // Sert: ortada hızlı geçer, uçlarda bekler — kesme hissi ama yumuşak
    snap: (t) => clamp01((t - 0.35) / 0.3),
  };
  const EASING_IDS = Object.keys(EASINGS);

  /* Geçiş tanımları.

     mask(u, v, p, o): 0..1 arası bir sayı döndürür — o pikselde YENİ sahnenin
     payı. u,v ∈ [0,1] ekran koordinatı, p ∈ [0,1] ilerleme, o parametreler.

     Bir maskeyi doğru saymanın ölçütü: p=0'da her yerde 0, p=1'de her yerde 1.
     Testler tam olarak bunu kontrol ediyor; aradaki davranış geçişin karakteri.

     draw alanı, maskeyle anlatılamayan geçişler için (zum, kaydırma, parlama)
     birleştiriciye ek talimat verir. */
  const TRANSITIONS = {
    cut: {
      label: 'Kesme',
      mask: (u, v, p) => (p >= 1 ? 1 : 0),
    },
    crossfade: {
      label: 'Çapraz Geçiş',
      mask: (u, v, p) => p,
    },
    dissolve: {
      label: 'Erime',
      params: [{ name: 'grain', label: 'Tanecik', min: 1, max: 80, step: 1, default: 24 }],
      // Tohumlu gürültü eşiği: aynı kare her koşuda aynı desenle erir
      mask: (u, v, p, o) => {
        const g = (o && o.grain) || 24;
        const n = hash2(Math.floor(u * g), Math.floor(v * g));
        return clamp01((p * 1.35 - n * 0.35 - 0.0) * 2 - 0.5 + 0.5);
      },
    },
    wipe: {
      label: 'Silme',
      params: [
        { name: 'angle', label: 'Açı', min: 0, max: 1, step: 0.01, default: 0 },
        { name: 'softness', label: 'Yumuşaklık', min: 0, max: 0.5, step: 0.01, default: 0.08 },
      ],
      mask: (u, v, p, o) => {
        const a = ((o && o.angle) || 0) * Math.PI * 2;
        const s = (o && o.softness != null) ? o.softness : 0.08;
        // Açıya göre izdüşüm, 0..1 aralığına normalize
        const proj = (u - 0.5) * Math.cos(a) + (v - 0.5) * Math.sin(a) + 0.5;
        return softEdge(proj, p, s);
      },
    },
    radial: {
      label: 'Dairesel Silme',
      params: [{ name: 'softness', label: 'Yumuşaklık', min: 0, max: 0.5, step: 0.01, default: 0.08 }],
      mask: (u, v, p, o) => {
        const s = (o && o.softness != null) ? o.softness : 0.08;
        const d = Math.hypot(u - 0.5, v - 0.5) / 0.7072; // köşeye kadar 1
        return softEdge(d, p, s);
      },
    },
    clock: {
      label: 'Saat Silme',
      params: [{ name: 'softness', label: 'Yumuşaklık', min: 0, max: 0.3, step: 0.01, default: 0.03 }],
      mask: (u, v, p, o) => {
        const s = (o && o.softness != null) ? o.softness : 0.03;
        let a = Math.atan2(v - 0.5, u - 0.5) + Math.PI / 2;
        if (a < 0) a += Math.PI * 2;
        return softEdge(a / (Math.PI * 2), p, s);
      },
    },
    barn: {
      label: 'Ahır Kapısı',
      params: [
        { name: 'softness', label: 'Yumuşaklık', min: 0, max: 0.3, step: 0.01, default: 0.06 },
        { name: 'vertical', label: 'Dikey', min: 0, max: 1, step: 1, default: 0 },
      ],
      mask: (u, v, p, o) => {
        const s = (o && o.softness != null) ? o.softness : 0.06;
        const k = (o && o.vertical) ? v : u;
        return softEdge(Math.abs(k - 0.5) * 2, p, s);
      },
    },
    blinds: {
      label: 'Jaluzi',
      params: [
        { name: 'count', label: 'Şerit', min: 2, max: 40, step: 1, default: 10 },
        { name: 'vertical', label: 'Dikey', min: 0, max: 1, step: 1, default: 0 },
      ],
      mask: (u, v, p, o) => {
        const n = (o && o.count) || 10;
        const k = (o && o.vertical) ? u : v;
        return softEdge((k * n) % 1, p, 0.02);
      },
    },
    stripes: {
      label: 'Kayan Şeritler',
      params: [{ name: 'count', label: 'Şerit', min: 2, max: 30, step: 1, default: 8 }],
      mask: (u, v, p, o) => {
        const n = (o && o.count) || 8;
        const i = Math.floor(u * n);
        // Tek şeritler yukarıdan, çiftler aşağıdan gelir
        const dir = i % 2 === 0 ? v : 1 - v;
        return softEdge(dir, p, 0.05);
      },
    },
    checker: {
      label: 'Dama',
      params: [{ name: 'count', label: 'Kare', min: 2, max: 24, step: 1, default: 8 }],
      mask: (u, v, p, o) => {
        const n = (o && o.count) || 8;
        const i = Math.floor(u * n);
        const j = Math.floor(v * n);
        /* Dama sırasına göre gecikme. Gecikme 0..1 aralığının TAMAMINI
           kapsamalı: daha dar bir aralık kullanıldığında geçiş ilerlemenin
           yarısında tamamlanıp geri kalan yarısında hiçbir şey yapmıyordu. */
        const delay = (((i + j) % 2) * 0.5) + (i / Math.max(1, n)) * 0.5;
        return softEdge(delay, p, 0.09);
      },
    },
    iris: {
      label: 'İris',
      params: [
        { name: 'sides', label: 'Kenar', min: 3, max: 12, step: 1, default: 6 },
        { name: 'softness', label: 'Yumuşaklık', min: 0, max: 0.3, step: 0.01, default: 0.05 },
      ],
      mask: (u, v, p, o) => {
        const n = (o && o.sides) || 6;
        const s = (o && o.softness != null) ? o.softness : 0.05;
        const dx = u - 0.5;
        const dy = v - 0.5;
        const a = Math.atan2(dy, dx);
        const r = Math.hypot(dx, dy);
        // Düzgün çokgenin yarıçapı: köşe yönünde daha uzun
        const seg = Math.PI * 2 / n;
        const poly = Math.cos(seg / 2) / Math.max(0.05, Math.cos(((a % seg) + seg) % seg - seg / 2));
        return softEdge((r * poly) / 0.72, p, s);
      },
    },
    luma: {
      label: 'Parlaklık Silme',
      params: [{ name: 'softness', label: 'Yumuşaklık', min: 0.01, max: 0.5, step: 0.01, default: 0.12 }],
      // Maske dokusundan değil, giden karenin parlaklığından beslenir; bunu
      // birleştirici sağlar, saf maske burada yalnızca ilerlemeyi taşır.
      usesLuma: true,
      mask: (u, v, p) => p,
    },
    zoom: {
      label: 'Zum Darbesi',
      params: [{ name: 'amount', label: 'Miktar', min: 0, max: 2, step: 0.05, default: 0.7 }],
      draw: 'zoom',
      mask: (u, v, p) => p,
    },
    push: {
      label: 'İtme',
      params: [{ name: 'angle', label: 'Açı', min: 0, max: 1, step: 0.25, default: 0 }],
      draw: 'push',
      mask: (u, v, p) => p,
    },
    slide: {
      label: 'Kaydırma',
      params: [{ name: 'angle', label: 'Açı', min: 0, max: 1, step: 0.25, default: 0 }],
      draw: 'slide',
      mask: (u, v, p) => p,
    },
    flash: {
      label: 'Parlama',
      params: [{ name: 'color', label: 'Beyazlık', min: 0, max: 1, step: 0.01, default: 0.9 }],
      draw: 'flash',
      // Ortada anlık geçiş: parlamanın tepesinde kesilir, göz fark etmez
      mask: (u, v, p) => (p >= 0.5 ? 1 : 0),
    },
    glitch: {
      label: 'Glitch',
      params: [{ name: 'blocks', label: 'Blok', min: 4, max: 60, step: 1, default: 18 }],
      mask: (u, v, p, o) => {
        const n = (o && o.blocks) || 18;
        const row = Math.floor(v * n);
        // Satır başına tohumlu gecikme, 0..1 aralığının tamamında
        const jitter = hash2(row, 7);
        return softEdge(jitter, p, 0.03);
      },
    },
    blur: {
      label: 'Bulanık Geçiş',
      draw: 'blur',
      mask: (u, v, p) => p,
    },
  };
  const TRANSITION_IDS = Object.keys(TRANSITIONS);

  /* Tohumlu 2B karma — erime ve glitch desenleri için. Durumsuz olduğu için
     aynı kare her koşuda aynı deseni verir (dışa aktarım belirlenimliliği). */
  function hash2(x, y) {
    let h = (x | 0) * 374761393 + (y | 0) * 668265263;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /* Yumuşak kenar: k konumundaki piksel, ilerleme p iken ne kadar yeni?
     p=0'da 0, p=1'de 1 olmasını garanti eder — kenar yumuşaklığı için
     ilerleme aralığı taşırılır. */
  function softEdge(k, p, soft) {
    // Uçlar kesin olmalı: p=1'de kayan nokta yüzünden 0.9999... dönerse
    // geçişin sonunda eski sahneden görünmez ama gerçek bir kalıntı kalır.
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    const s = Math.max(1e-4, soft);
    const edge = p * (1 + 2 * s) - s;
    return clamp01((edge - k + s) / (2 * s));
  }

  // ==========================================================================
  // İlerleme
  // ==========================================================================
  /* Geçişin süresi saniye ya da vuruş cinsinden verilebilir. Vuruş cinsinden
     verildiğinde tempo motorundan gelen BPM kullanılır; böylece geçiş müziğe
     oturur. */
  function durationSeconds(cfg, bpm) {
    const tr = (cfg && cfg.transition) || {};
    const d = tr.duration == null ? 0.6 : tr.duration;
    if (tr.unit === 'beats') {
      const b = bpm > 0 ? bpm : 120;
      return Math.max(0.02, (d * 60) / b);
    }
    return Math.max(0.02, d);
  }

  function easeOf(id) {
    return EASINGS[id] || EASINGS.smooth;
  }

  // ==========================================================================
  // Birleştirici
  // ==========================================================================
  class Compositor {
    constructor() {
      this.maskCanvas = null;
      this.maskCtx = null;
      this.maskData = null;
      this._sig = '';
    }

    /* İki kareyi tek kareye indirir.

       ctx      — hedef 2B bağlam
       from,to  — kaynak tuvaller (giden ve gelen sahne)
       W,H      — hedef boyutu
       type     — geçiş kimliği
       progress — 0..1 (yumuşatma UYGULANMIŞ olarak gelir)
       opts     — geçişin kendi parametreleri */
    compose(ctx, from, to, W, H, type, progress, opts) {
      const def = TRANSITIONS[type] || TRANSITIONS.crossfade;
      const p = clamp01(progress);
      const o = opts || {};

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, W, H);

      if (def.draw === 'zoom') return this._zoom(ctx, from, to, W, H, p, o);
      if (def.draw === 'push') return this._slide(ctx, from, to, W, H, p, o, true);
      if (def.draw === 'slide') return this._slide(ctx, from, to, W, H, p, o, false);
      if (def.draw === 'flash') return this._flash(ctx, from, to, W, H, p, o);
      if (def.draw === 'blur') return this._blur(ctx, from, to, W, H, p, o);
      if (type === 'crossfade' || type === 'cut') {
        if (from) ctx.drawImage(from, 0, 0, W, H);
        ctx.globalAlpha = type === 'cut' ? (p >= 1 ? 1 : 0) : p;
        if (to) ctx.drawImage(to, 0, 0, W, H);
        ctx.restore();
        return;
      }

      // Maskeli geçişler: maske düşük çözünürlükte üretilip büyütülür.
      // Kenarlar zaten yumuşak olduğu için ölçek büyütmesi görünmez.
      this._buildMask(def, W, H, p, o, from);
      if (from) ctx.drawImage(from, 0, 0, W, H);
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      // Gelen sahneyi maskeyle kes
      const tmp = this._tmp(W, H);
      const tc = tmp.getContext('2d');
      tc.setTransform(1, 0, 0, 1, 0, 0);
      tc.globalCompositeOperation = 'source-over';
      tc.clearRect(0, 0, W, H);
      if (to) tc.drawImage(to, 0, 0, W, H);
      tc.globalCompositeOperation = 'destination-in';
      tc.imageSmoothingEnabled = true;
      tc.drawImage(this.maskCanvas, 0, 0, W, H);
      tc.globalCompositeOperation = 'source-over';
      ctx.drawImage(tmp, 0, 0);
      ctx.restore();
      ctx.restore();
    }

    _tmp(W, H) {
      if (!this._tmpCanvas || this._tmpCanvas.width !== W || this._tmpCanvas.height !== H) {
        this._tmpCanvas = document.createElement('canvas');
        this._tmpCanvas.width = W;
        this._tmpCanvas.height = H;
      }
      return this._tmpCanvas;
    }

    _buildMask(def, W, H, p, o, from) {
      const MW = 160;
      const MH = Math.max(2, Math.round((MW * H) / Math.max(1, W)));
      if (!this.maskCanvas || this.maskCanvas.width !== MW || this.maskCanvas.height !== MH) {
        this.maskCanvas = document.createElement('canvas');
        this.maskCanvas.width = MW;
        this.maskCanvas.height = MH;
        this.maskCtx = this.maskCanvas.getContext('2d');
        this.maskData = this.maskCtx.createImageData(MW, MH);
      }
      /* Parlaklık silme için giden kareyi küçült ve oku.

         Ham parlaklığı doğrudan silme anahtarı olarak kullanmak çalışmaz:
         çoğu sahnenin parlaklığı dar bir aralıkta toplanır (ör. koyu bir
         sahnede 0.04-0.35), o zaman silme ilerlemenin büyük bölümünde
         hiçbir şey yapmaz. Bu yüzden parlaklık KARENİN KENDİ aralığına göre
         normalize edilir — silme her sahnede baştan sona yayılır. */
      let luma = null;
      let lumaLo = 0;
      let lumaHi = 1;
      if (def.usesLuma && from) {
        const lc = this._lumaCanvas(MW, MH);
        const lctx = lc.getContext('2d', { willReadFrequently: true });
        lctx.clearRect(0, 0, MW, MH);
        lctx.drawImage(from, 0, 0, MW, MH);
        luma = lctx.getImageData(0, 0, MW, MH).data;
        lumaLo = 1;
        lumaHi = 0;
        for (let i = 0; i < luma.length; i += 4) {
          const l = (luma[i] * 0.299 + luma[i + 1] * 0.587 + luma[i + 2] * 0.114) / 255;
          if (l < lumaLo) lumaLo = l;
          if (l > lumaHi) lumaHi = l;
        }
        if (lumaHi - lumaLo < 1e-3) { lumaLo = 0; lumaHi = 1; }
      }
      const d = this.maskData.data;
      const soft = o.softness == null ? 0.12 : o.softness;
      for (let y = 0; y < MH; y++) {
        const v = (y + 0.5) / MH;
        for (let x = 0; x < MW; x++) {
          const u = (x + 0.5) / MW;
          let m;
          if (luma) {
            const i = (y * MW + x) * 4;
            const l = (luma[i] * 0.299 + luma[i + 1] * 0.587 + luma[i + 2] * 0.114) / 255;
            // Koyu bölgeler önce geçer (standart parlaklık silmesi)
            m = softEdge((l - lumaLo) / (lumaHi - lumaLo), p, soft);
          } else {
            m = def.mask(u, v, p, o);
          }
          const off = (y * MW + x) * 4;
          d[off] = 255; d[off + 1] = 255; d[off + 2] = 255;
          d[off + 3] = clamp01(m) * 255;
        }
      }
      this.maskCtx.putImageData(this.maskData, 0, 0);
    }

    _lumaCanvas(W, H) {
      if (!this._luma || this._luma.width !== W || this._luma.height !== H) {
        this._luma = document.createElement('canvas');
        this._luma.width = W;
        this._luma.height = H;
      }
      return this._luma;
    }

    _zoom(ctx, from, to, W, H, p, o) {
      const amt = o.amount == null ? 0.7 : o.amount;
      // Giden sahne izleyiciye doğru büyüyerek kaybolur, gelen uzaktan gelir
      if (from) {
        const k = 1 + p * amt;
        ctx.globalAlpha = 1 - p;
        ctx.drawImage(from, W / 2 - (W * k) / 2, H / 2 - (H * k) / 2, W * k, H * k);
      }
      if (to) {
        const k = 1 - (1 - p) * amt * 0.5;
        ctx.globalAlpha = p;
        ctx.drawImage(to, W / 2 - (W * k) / 2, H / 2 - (H * k) / 2, W * k, H * k);
      }
      ctx.restore();
    }

    _slide(ctx, from, to, W, H, p, o, push) {
      const a = ((o.angle == null ? 0 : o.angle) % 1) * Math.PI * 2;
      const dx = Math.cos(a) * W;
      const dy = Math.sin(a) * H;
      ctx.globalAlpha = 1;
      if (from) {
        if (push) ctx.drawImage(from, -dx * p, -dy * p, W, H);
        else ctx.drawImage(from, 0, 0, W, H);
      }
      if (to) ctx.drawImage(to, dx * (1 - p), dy * (1 - p), W, H);
      ctx.restore();
    }

    _flash(ctx, from, to, W, H, p, o) {
      const src = p < 0.5 ? from : to;
      if (src) ctx.drawImage(src, 0, 0, W, H);
      // Üçgen zarf: ortada tepe
      const k = (1 - Math.abs(p * 2 - 1)) * (o.color == null ? 0.9 : o.color);
      if (k > 0.001) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(255,255,255,' + k.toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();
    }

    _blur(ctx, from, to, W, H, p) {
      // Ortada en bulanık: iki sahne odaktan çıkıp geri giriyormuş gibi
      const k = (1 - Math.abs(p * 2 - 1)) * 18;
      ctx.filter = k > 0.2 ? 'blur(' + k.toFixed(1) + 'px)' : 'none';
      if (from) { ctx.globalAlpha = 1 - p; ctx.drawImage(from, 0, 0, W, H); }
      if (to) { ctx.globalAlpha = p; ctx.drawImage(to, 0, 0, W, H); }
      ctx.filter = 'none';
      ctx.restore();
    }

    dispose() {
      this.maskCanvas = null;
      this.maskCtx = null;
      this.maskData = null;
      this._tmpCanvas = null;
      this._luma = null;
    }
  }

  const api = {
    TRANSITIONS, TRANSITION_IDS, EASINGS, EASING_IDS,
    Compositor, durationSeconds, easeOf, softEdge, hash2,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVTransition = api;
})();
