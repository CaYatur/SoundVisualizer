'use strict';
/* Arkaplanların dördüncü bölümü (#638).

   backgrounds.js ile aynı sözleşme:
     draw(ctx, audio, cfg, t, W, H, dt)  — verilen 2D bağlama çizer
     palette(cfg)                        — Dynamic Lighting için renk listesi

   Her arkaplanın kendi ayarları katalogda (shared/mode-catalog.js,
   `settings`), varsayılanları defaults.js'te. Buradaki mset() yedekleri o
   varsayılanlarla aynı olmak ZORUNDA; tests/mode-catalog.test.js
   karşılaştırıyor.

   Piksel başına hesaplayan zeminler küçük bir tamponda çizip büyütür;
   kare başına tampon, dizi ya da gradyan yığını üretilmez. */
(function () {
  const U = window.SVBgUtil;
  const { rgba, lerpColor, gset, mset, rng, vignette, basePalette } = U;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // Küçük çözünürlüklü çizim tamponu (s: kaç pikselde bir örnek)
  function lowres(self, W, H, s) {
    const w = Math.max(2, Math.ceil(W / s));
    const h = Math.max(2, Math.ceil(H / s));
    if (self.buf && self.buf.width === w && self.buf.height === h) return;
    self.buf = document.createElement('canvas');
    self.buf.width = w;
    self.buf.height = h;
    self.bctx = self.buf.getContext('2d');
    self.img = self.bctx.createImageData(w, h);
  }
  function blit(self, ctx, W, H, bright) {
    self.bctx.putImageData(self.img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = bright;
    ctx.drawImage(self.buf, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  // Paletten N basamaklı tablo (piksel döngüsünde renk aramasını ucuzlatır)
  function ramp(cfg, n, out) {
    for (let i = 0; i < n; i++) out[i] = lerpColor(cfg, i / (n - 1));
    return out;
  }

  // ============================== LAV LAMBASI ==============================
  // Yavaşça yükselip alçalan metaball damlaları; eşik üstü parlak, kenar ışıltılı
  class LavaLamp {
    constructor() {
      const r = rng(0x1a7a);
      this.seed = [];
      for (let i = 0; i < 12; i++) this.seed.push([r() * 6, r() * 6, 0.35 + r() * 0.5, 0.18 + r() * 0.3, 0.7 + r() * 0.6]);
      this.cols = [];
      this.bx = new Float32Array(12);
      this.by = new Float32Array(12);
      this.br = new Float32Array(12);
    }
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'lavalamp', { blobs: 7, size: 1, flow: 1, glowAmt: 1, bassPush: 1.2 });
      lowres(this, W, H, 6);
      const w = this.buf.width;
      const h = this.buf.height;
      const d = this.img.data;
      const n = clamp(Math.round(m.blobs), 3, 12);
      const T = t * g.speed * 0.35 * m.flow;
      const bass = audio.bass * g.react;
      const aspect = w / h;
      const { bx, by, br } = this;
      for (let i = 0; i < n; i++) {
        const [p, q, sx, sy, rr] = this.seed[i];
        bx[i] = (0.5 + 0.34 * Math.sin(T * sx + p)) * aspect;
        // Dikey hareket baskın: lav lambası gibi yükselip çöker
        by[i] = 0.5 + 0.42 * Math.sin(T * sy + q);
        const rad = 0.11 * rr * m.size * (1 + bass * 0.18 * m.bassPush);
        br[i] = rad * rad;
      }
      ramp(cfg, 32, this.cols);
      const cols = this.cols;
      const edge = 0.35 * m.glowAmt;
      for (let y = 0; y < h; y++) {
        const fy = y / h;
        for (let x = 0; x < w; x++) {
          const fx = (x / w) * aspect;
          let f = 0;
          for (let i = 0; i < n; i++) {
            const dx = fx - bx[i];
            const dy = fy - by[i];
            f += br[i] / (dx * dx + dy * dy + 1e-4);
          }
          const o = (y * w + x) * 4;
          // Damla ile sıvı arasında yumuşak geçiş: küçük tamponda sert eşik
          // büyütülünce basamaklı görünüyordu
          const e = clamp((f - 0.82) / 0.36, 0, 1);
          const a = e * e * (3 - 2 * e);
          const k = clamp((f - 1) * 0.35, 0, 1);
          const c1 = cols[Math.min(31, (16 + k * 15) | 0)];
          const li = 0.75 + k * 0.45;
          const c0 = cols[(fy * 12) | 0];
          const glow = 0.12 + Math.pow(Math.min(f, 1), 3) * edge;
          d[o] = clamp(c0[0] * glow * (1 - a) + c1[0] * li * a, 0, 255);
          d[o + 1] = clamp(c0[1] * glow * (1 - a) + c1[1] * li * a, 0, 255);
          d[o + 2] = clamp(c0[2] * glow * (1 - a) + c1[2] * li * a, 0, 255);
          d[o + 3] = 255;
        }
      }
      blit(this, ctx, W, H, g.bright);
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================= ALÇAK POLİGON =============================
  // Titreşen köşeli üçgen ağı; hareket eden bir ışığa göre gölgelenir
  class LowPoly {
    constructor() {
      this.rand = rng(0x70b1);
      this.key = '';
      this.pts = null;
      this.cols = [];
    }
    _build(cols, rows) {
      const r = this.rand;
      const N = (cols + 1) * (rows + 1);
      this.pts = new Float32Array(N * 4); // jx, jy, yükseklik, faz
      for (let i = 0; i < N; i++) {
        this.pts[i * 4] = r() - 0.5;
        this.pts[i * 4 + 1] = r() - 0.5;
        this.pts[i * 4 + 2] = r();
        this.pts[i * 4 + 3] = r() * TAU;
      }
      this.vx = new Float32Array(N);
      this.vy = new Float32Array(N);
      this.vz = new Float32Array(N);
    }
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'lowpoly', { cells: 16, jitter: 0.6, shimmer: 1, relief: 1, bassPush: 1.2 });
      const cols = clamp(Math.round(m.cells), 6, 40);
      const cell = W / cols;
      const rows = Math.max(3, Math.ceil(H / cell));
      const key = cols + 'x' + rows;
      if (this.key !== key) { this._build(cols, rows); this.key = key; }
      const T = t * g.speed;
      const bass = audio.bass * g.react;
      const P = this.pts;
      const stride = cols + 1;
      // Köşeler: sınırdakiler kenarda sabit kalır ki boşluk açılmasın
      for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
          const i = r * stride + c;
          const edgeX = c === 0 || c === cols;
          const edgeY = r === 0 || r === rows;
          const wob = Math.sin(T * 0.8 * m.shimmer + P[i * 4 + 3]);
          this.vx[i] = c * cell + (edgeX ? 0 : (P[i * 4] * m.jitter + wob * 0.08 * m.shimmer) * cell);
          this.vy[i] = r * cell + (edgeY ? 0 : (P[i * 4 + 1] * m.jitter + wob * 0.06 * m.shimmer) * cell);
          this.vz[i] = (P[i * 4 + 2] + wob * 0.2) * cell * 0.9 * m.relief;
        }
      }
      // Işık yavaşça dolaşır
      let lx = Math.cos(T * 0.23) * 0.6;
      let ly = Math.sin(T * 0.31) * 0.6;
      let lz = 0.8;
      const ln = Math.hypot(lx, ly, lz);
      lx /= ln; ly /= ln; lz /= ln;
      const boost = 1 + bass * 0.35 * m.bassPush;
      const pal = ramp(cfg, 64, this.cols);
      const tri = (a, b, c2, pos) => {
        const ax = this.vx[b] - this.vx[a];
        const ay = this.vy[b] - this.vy[a];
        const az = this.vz[b] - this.vz[a];
        const bx2 = this.vx[c2] - this.vx[a];
        const by2 = this.vy[c2] - this.vy[a];
        const bz = this.vz[c2] - this.vz[a];
        let nx = ay * bz - az * by2;
        let ny = az * bx2 - ax * bz;
        let nz = ax * by2 - ay * bx2;
        if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const nl = Math.hypot(nx, ny, nz) || 1;
        const lit = clamp((nx * lx + ny * ly + nz * lz) / nl, 0, 1);
        const col = pal[(clamp(pos, 0, 1) * 63) | 0];
        const k = (0.25 + lit * 0.85) * boost;
        ctx.fillStyle = rgba([clamp(col[0] * k, 0, 255) | 0, clamp(col[1] * k, 0, 255) | 0, clamp(col[2] * k, 0, 255) | 0], 1);
        ctx.beginPath();
        ctx.moveTo(this.vx[a], this.vy[a]);
        ctx.lineTo(this.vx[b], this.vy[b]);
        ctx.lineTo(this.vx[c2], this.vy[c2]);
        ctx.closePath();
        ctx.fill();
        // Kenarların arasında kıl payı çizgi kalmasın
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1;
        ctx.stroke();
      };
      ctx.globalAlpha = g.bright;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const a = r * stride + c;
          const b = a + 1;
          const d2 = a + stride;
          const e = d2 + 1;
          const pos = (c / cols) * 0.7 + (r / rows) * 0.3 + Math.sin(T * 0.07) * 0.1;
          tri(a, b, e, pos);
          tri(a, e, d2, pos + 0.03);
        }
      }
      ctx.globalAlpha = 1;
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ================================ BULUTLAR ================================
  // Kesirli gürültüden katmanlı bulut örtüsü; gökyüzü paletin ilk ucundan
  function valueNoise(seed) {
    const r = rng(seed);
    const S = 256;
    const tab = new Float32Array(S * S);
    for (let i = 0; i < tab.length; i++) tab[i] = r();
    const sm = (x) => x * x * (3 - 2 * x);
    return (x, y) => {
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const fx = sm(x - xi);
      const fy = sm(y - yi);
      const x0 = xi & 255;
      const y0 = yi & 255;
      const x1 = (x0 + 1) & 255;
      const y1 = (y0 + 1) & 255;
      const a = tab[y0 * S + x0];
      const b = tab[y0 * S + x1];
      const c = tab[y1 * S + x0];
      const d = tab[y1 * S + x1];
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    };
  }

  class Clouds {
    constructor() {
      this.noise = valueNoise(0xc10d);
      this.cols = [];
    }
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'clouds', { scale: 1, cover: 0.5, drift: 1, softness: 1, bassPush: 1 });
      lowres(this, W, H, 7);
      const w = this.buf.width;
      const h = this.buf.height;
      const d = this.img.data;
      const nz = this.noise;
      const T = t * g.speed * 0.05 * m.drift;
      const bass = audio.bass * g.react;
      const sc = 3.2 / (m.scale * Math.max(w, h));
      const cover = clamp(m.cover + bass * 0.12 * m.bassPush, 0, 1);
      const lo = 1 - cover * 0.9 - 0.1;
      const soft = 0.08 + 0.3 * m.softness;
      ramp(cfg, 32, this.cols);
      const cols = this.cols;
      const flash = 1 + bass * 0.25 * m.bassPush;
      for (let y = 0; y < h; y++) {
        const fy = y / h;
        const sky = cols[(fy * 10) | 0];
        for (let x = 0; x < w; x++) {
          const px = x * sc + T;
          const py = y * sc * 1.6;
          // Dört katman: iri biçim + ince doku
          let v = nz(px, py) * 0.5 + nz(px * 2.03 + T, py * 2.03) * 0.25 +
            nz(px * 4.1 - T * 0.5, py * 4.1) * 0.125 + nz(px * 8.3, py * 8.3 + T) * 0.0625;
          v /= 0.9375;
          const k = clamp((v - lo) / soft, 0, 1);
          const cc = cols[Math.min(31, (20 + v * 11) | 0)];
          // Bulut tepesi aydınlık, tabanı paletin koyusu
          const li = (0.65 + v * 0.55) * flash;
          const o = (y * w + x) * 4;
          d[o] = clamp(sky[0] * 0.35 * (1 - k) + cc[0] * li * k, 0, 255);
          d[o + 1] = clamp(sky[1] * 0.35 * (1 - k) + cc[1] * li * k, 0, 255);
          d[o + 2] = clamp(sky[2] * 0.35 * (1 - k) + cc[2] * li * k, 0, 255);
          d[o + 3] = 255;
        }
      }
      blit(this, ctx, W, H, g.bright);
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ================================ YARIM TON ================================
  // Döndürülmüş nokta ızgarası; nokta boyu yayılan dalga ve tayftan
  const HALFTONE_BUCKETS = 12;

  class Halftone {
    constructor() { this.cols = []; }
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'halftone', { cells: 38, angle: 0.26, contrast: 1, response: 1, bassPush: 1.3 });
      const minDim = Math.min(W, H);
      const step = minDim / clamp(Math.round(m.cells), 12, 70);
      const T = t * g.speed;
      const bass = audio.bass * g.react;
      const bars = audio.getBars(24, 40, 13000);
      ramp(cfg, HALFTONE_BUCKETS, this.cols);
      const dark = this.cols[0];
      ctx.fillStyle = rgba([dark[0] * 0.12 | 0, dark[1] * 0.12 | 0, dark[2] * 0.12 | 0], 1);
      ctx.fillRect(0, 0, W, H);
      const ca = Math.cos(m.angle);
      const sa = Math.sin(m.angle);
      const cx = W / 2 + Math.cos(T * 0.21) * W * 0.2;
      const cy = H / 2 + Math.sin(T * 0.17) * H * 0.2;
      const span = Math.hypot(W, H) / 2 + step;
      const nI = Math.ceil(span / step);
      const rMax = step * 0.62;
      // Aynı renk kovasındaki noktalar tek yolda doldurulur
      ctx.globalAlpha = g.bright;
      for (let b = 0; b < HALFTONE_BUCKETS; b++) {
        ctx.fillStyle = rgba(this.cols[b], 1);
        ctx.beginPath();
        for (let j = -nI; j <= nI; j++) {
          for (let i = -nI; i <= nI; i++) {
            const x = W / 2 + (i * ca - j * sa) * step;
            const y = H / 2 + (i * sa + j * ca) * step;
            if (x < -step || x > W + step || y < -step || y > H + step) continue;
            const bucket = Math.min(HALFTONE_BUCKETS - 1, ((x / W) * HALFTONE_BUCKETS) | 0);
            if (bucket !== b) continue;
            const dd = Math.hypot(x - cx, y - cy) / minDim;
            const wave = Math.sin(dd * 11 - T * 1.6) * 0.5 + 0.5;
            const band = bars[Math.min(23, Math.max(0, ((x / W) * 24) | 0))] * m.response;
            const val = clamp(wave * 0.65 + band * 0.5 + bass * 0.2 * m.bassPush, 0, 1);
            const r = rMax * Math.pow(val, m.contrast);
            if (r < 0.4) continue;
            ctx.moveTo(x + r, y);
            ctx.arc(x, y, r, 0, TAU);
          }
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================== SAHNE IŞIKLARI ==============================
  // Tavandan süpüren ışık hüzmeleri, sis ve zemindeki ışık havuzları
  class Spotlights {
    constructor() {
      const r = rng(0x5b07);
      this.seed = [];
      for (let i = 0; i < 10; i++) this.seed.push([r() * TAU, 0.3 + r() * 0.5, r()]);
    }
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'spotlights', { beams: 5, spread: 1, sweep: 1, haze: 0.35, bassPush: 1.5 });
      const n = clamp(Math.round(m.beams), 2, 10);
      const T = t * g.speed;
      const bass = audio.bass * g.react;
      const lvl = audio.level * g.react;
      // Koyu sahne
      const bg = lerpColor(cfg, 0);
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, rgba([bg[0] * 0.06 | 0, bg[1] * 0.06 | 0, bg[2] * 0.06 | 0], 1));
      sky.addColorStop(1, rgba([bg[0] * 0.16 | 0, bg[1] * 0.16 | 0, bg[2] * 0.16 | 0], 1));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);
      // Sis: tüm sahneye ince bir ışık tülü, seviyeyle kalınlaşır
      if (m.haze > 0.01) {
        const hc = lerpColor(cfg, 0.5);
        ctx.fillStyle = rgba(hc, (m.haze * 0.08 * (0.6 + lvl * 0.6) * g.bright).toFixed(3));
        ctx.fillRect(0, 0, W, H);
      }
      ctx.globalCompositeOperation = 'lighter';
      const len = H * 1.15;
      const half = 0.07 * m.spread;
      const inten = (0.22 + bass * 0.35 * m.bassPush) * g.bright;
      for (let i = 0; i < n; i++) {
        const [ph, sp, hue] = this.seed[i];
        const sx = W * ((i + 0.5) / n);
        const sy = -H * 0.02;
        const a = Math.PI / 2 + Math.sin(T * sp * 0.6 + ph) * 0.45 * m.sweep;
        const c = lerpColor(cfg, hue);
        const ex = sx + Math.cos(a) * len;
        const ey = sy + Math.sin(a) * len;
        const grad = ctx.createLinearGradient(sx, sy, ex, ey);
        grad.addColorStop(0, rgba(c, Math.min(1, inten * 1.6).toFixed(3)));
        grad.addColorStop(0.55, rgba(c, (inten * 0.45).toFixed(3)));
        grad.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(sx - 3, sy);
        ctx.lineTo(sx + Math.cos(a - half) * len, sy + Math.sin(a - half) * len);
        ctx.lineTo(sx + Math.cos(a + half) * len, sy + Math.sin(a + half) * len);
        ctx.closePath();
        ctx.fill();
        // Zemindeki ışık havuzu (hüzme zemini kestiği yerde)
        const hitT = (H * 0.94 - sy) / Math.max(0.2, Math.sin(a));
        const hx = sx + Math.cos(a) * hitT;
        if (hx > -W * 0.2 && hx < W * 1.2) {
          ctx.fillStyle = rgba(c, (inten * 0.5).toFixed(3));
          ctx.beginPath();
          ctx.ellipse(hx, H * 0.94, hitT * half * 1.1, H * 0.025, 0, 0, TAU);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  Object.assign(window.SVBackgrounds, {
    lavalamp: LavaLamp,
    lowpoly: LowPoly,
    clouds: Clouds,
    halftone: Halftone,
    spotlights: Spotlights,
  });
})();
