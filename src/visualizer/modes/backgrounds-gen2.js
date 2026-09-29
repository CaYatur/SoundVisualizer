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

  // Arkaplan için basit vuruş: tohumsuz, belirlenimci (ortak algılayıcı varsa o)
  function makeOnset(refractory) {
    if (window.SVOnset && window.SVOnset.Onset) return new window.SVOnset.Onset({ refractory });
    let last = 0;
    let avg = 0;
    let cool = 0;
    return { push(x, dt) { avg += (x - avg) * 0.05; cool -= dt; const hit = x > avg * 1.5 + 0.08 && x > last && cool <= 0; last = x; if (hit) cool = refractory; return hit ? 1 : 0; } };
  }

  // ============================ İZOMETRİK KÜPLER ============================
  // Döşeli küpler: üç yüz üç tonda, dalga ve bas küpleri yukarı iter
  class Cubes {
    constructor() { this.cols = []; }
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'cubes', { size: 1, wave: 1, pop: 1, bassPush: 1.2 });
      const s = Math.max(10, Math.min(W, H) * 0.06 * m.size); // küp kenarı
      const hw = s * 0.866; // yarım genişlik (cos 30)
      const T = t * g.speed;
      const bass = audio.bass * g.react;
      const pal = ramp(cfg, 32, this.cols);
      const bg = pal[0];
      ctx.fillStyle = rgba([bg[0] * 0.1 | 0, bg[1] * 0.1 | 0, bg[2] * 0.1 | 0], 1);
      ctx.fillRect(0, 0, W, H);
      const colsN = Math.ceil(W / (hw * 2)) + 2;
      const rowsN = Math.ceil(H / (s * 1.5)) + 3;
      const cx = W / 2;
      const cy = H / 2;
      const shade = (c, k) => rgba([clamp(c[0] * k, 0, 255) | 0, clamp(c[1] * k, 0, 255) | 0, clamp(c[2] * k, 0, 255) | 0], 1);
      ctx.globalAlpha = g.bright;
      for (let r = -1; r < rowsN; r++) {
        for (let q = -1; q < colsN; q++) {
          const x = q * hw * 2 + (r % 2 ? hw : 0);
          const y = r * s * 1.5;
          const d = Math.hypot(x - cx, y - cy) / Math.max(W, H);
          const wave = Math.sin(d * 14 - T * 1.6) * 0.5 + 0.5;
          const lift = (wave * 0.25 * m.wave + bass * 0.35 * m.pop * m.bassPush * (1 - d)) * s * 0.6;
          const c = pal[Math.min(31, ((0.15 + wave * 0.7) * 31) | 0)];
          const yy = y - lift;
          // Üst yüz
          ctx.fillStyle = shade(c, 1.15);
          ctx.beginPath();
          ctx.moveTo(x, yy - s);
          ctx.lineTo(x + hw, yy - s / 2);
          ctx.lineTo(x, yy);
          ctx.lineTo(x - hw, yy - s / 2);
          ctx.closePath();
          ctx.fill();
          // Sol yüz
          ctx.fillStyle = shade(c, 0.7);
          ctx.beginPath();
          ctx.moveTo(x - hw, yy - s / 2);
          ctx.lineTo(x, yy);
          ctx.lineTo(x, yy + s + lift);
          ctx.lineTo(x - hw, yy + s / 2 + lift);
          ctx.closePath();
          ctx.fill();
          // Sağ yüz
          ctx.fillStyle = shade(c, 0.45);
          ctx.beginPath();
          ctx.moveTo(x + hw, yy - s / 2);
          ctx.lineTo(x, yy);
          ctx.lineTo(x, yy + s + lift);
          ctx.lineTo(x + hw, yy + s / 2 + lift);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================== ATEŞ BÖCEKLERİ ==============================
  // Gece, ağaç siluetleri ve yanıp sönen böcekler; vuruşta hep birlikte parlarlar
  const FLY_MAX = 200;

  class Fireflies {
    constructor() {
      const r = rng(0xf1f1);
      this.x = new Float32Array(FLY_MAX);
      this.y = new Float32Array(FLY_MAX);
      this.ph = new Float32Array(FLY_MAX);
      this.sp = new Float32Array(FLY_MAX);
      this.hue = new Float32Array(FLY_MAX);
      for (let i = 0; i < FLY_MAX; i++) {
        this.x[i] = r();
        this.y[i] = 0.25 + r() * 0.7;
        this.ph[i] = r() * TAU;
        this.sp[i] = 0.5 + r();
        this.hue[i] = r();
      }
      this.trees = null;
      this.sprite = null;
      this.spriteKey = '';
      this.flash = 0;
      this.onset = makeOnset(0.25);
    }
    _trees(W, H) {
      if (this.trees && this.trees.width === W && this.trees.height === H) return;
      this.trees = document.createElement('canvas');
      this.trees.width = W;
      this.trees.height = H;
      const c = this.trees.getContext('2d');
      const r = rng(0x7ee5);
      c.fillStyle = '#020204';
      // Tepe çizgisi ve çam siluetleri
      c.beginPath();
      c.moveTo(0, H);
      for (let x = 0; x <= W; x += W / 60) c.lineTo(x, H * (0.86 + Math.sin(x / W * 7) * 0.02));
      c.lineTo(W, H);
      c.closePath();
      c.fill();
      for (let i = 0; i < 26; i++) {
        const x = r() * W;
        const h = H * (0.18 + r() * 0.3);
        const w = h * 0.28;
        const base = H * 0.9;
        c.beginPath();
        c.moveTo(x, base - h);
        c.lineTo(x + w / 2, base);
        c.lineTo(x - w / 2, base);
        c.closePath();
        c.fill();
      }
    }
    /* Palet basamağı başına renkli parıltı sprite'ı; palet değişince yeniden.
       Böcek başına radyal gradyan kurmak kare başına yüzlerce nesne demekti;
       beyaz tek sprite ise renksiz görünüyordu. */
    _sprites(pal) {
      const key = pal.map((c) => c.join(',')).join(';');
      if (this.spriteKey === key && this.sprites) return this.sprites;
      this.spriteKey = key;
      this.sprites = pal.map((col) => {
        const s = document.createElement('canvas');
        s.width = s.height = 64;
        const c = s.getContext('2d');
        const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, 'rgba(255,255,255,1)');
        gr.addColorStop(0.12, rgba(col, 0.95));
        gr.addColorStop(0.4, rgba(col, 0.35));
        gr.addColorStop(1, rgba(col, 0));
        c.fillStyle = gr;
        c.fillRect(0, 0, 64, 64);
        return s;
      });
      return this.sprites;
    }
    draw(ctx, audio, cfg, t, W, H, dt) {
      const g = gset(cfg);
      const m = mset(cfg, 'fireflies', { count: 60, size: 1, drift: 1, sync: 0.4, bassPush: 1.2 });
      const step = Math.min(0.05, dt || 0.016);
      const n = clamp(Math.round(m.count), 0, FLY_MAX);
      const T = t * g.speed;
      if (this.onset.push(audio.bass * g.react, step)) this.flash = 1;
      this.flash *= Math.exp(-step * 3);
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      const top = lerpColor(cfg, 0);
      const low = lerpColor(cfg, 0.3);
      sky.addColorStop(0, rgba([top[0] * 0.05 | 0, top[1] * 0.05 | 0, top[2] * 0.08 | 0], 1));
      sky.addColorStop(1, rgba([low[0] * 0.14 | 0, low[1] * 0.14 | 0, low[2] * 0.16 | 0], 1));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);
      const pal = ramp(cfg, 8, this.cols || (this.cols = []));
      const sprites = this._sprites(pal);
      const base = Math.min(W, H) * 0.035 * m.size;
      const sync = clamp(m.sync, 0, 1);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const drift = m.drift * 0.02;
        const x = (this.x[i] + Math.sin(T * 0.3 * this.sp[i] + this.ph[i]) * drift * 3 + T * drift * 0.2 * (i % 2 ? 1 : -1) % 1 + 1) % 1;
        const y = this.y[i] + Math.cos(T * 0.25 * this.sp[i] + this.ph[i]) * drift * 2;
        // Kendi ritmi + vuruşta ortak parlama
        const own = Math.max(0, Math.sin(T * 1.3 * this.sp[i] + this.ph[i]));
        const blink = own * own * (1 - sync) + this.flash * (sync + 0.2) * m.bassPush * 0.6;
        const a = clamp(blink, 0, 1) * g.bright;
        if (a < 0.02) continue;
        const spr = sprites[Math.min(7, ((0.45 + this.hue[i] * 0.55) * 7) | 0)];
        const sz = base * (0.6 + a * 0.8);
        ctx.globalAlpha = a;
        ctx.drawImage(spr, x * W - sz, y * H - sz, sz * 2, sz * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      this._trees(W, H);
      ctx.drawImage(this.trees, 0, 0);
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ================================= FIRTINA =================================
  // Koyu bulutlar, yağmur çizgileri ve vuruşta şimşek (tohumlu dallanma)
  const RAIN_MAX = 260;

  class Storm {
    constructor() {
      this.noise = valueNoise(0x5707);
      this.rand = rng(0x5707);
      this.onset = makeOnset(0.3);
      this.flash = 0;
      this.bolt = null; // [x0,y0,x1,y1,...] ve dallar
      this.boltAge = 9;
      this.rx = new Float32Array(RAIN_MAX);
      this.ry = new Float32Array(RAIN_MAX);
      for (let i = 0; i < RAIN_MAX; i++) { this.rx[i] = this.rand(); this.ry[i] = this.rand(); }
      this.cols = [];
    }
    _bolt(W, H) {
      const r = this.rand;
      const segs = [];
      const grow = (x, y, ang, len, depth) => {
        let cx = x;
        let cy = y;
        const steps = 10 + ((r() * 8) | 0);
        for (let i = 0; i < steps && cy < H * 0.95; i++) {
          const nx = cx + Math.sin(ang + (r() - 0.5) * 1.2) * len;
          const ny = cy + Math.cos(ang) * len * (0.8 + r() * 0.5);
          segs.push(cx, cy, nx, ny, depth);
          if (depth < 2 && r() < 0.18) grow(nx, ny, ang + (r() - 0.5) * 1.4, len * 0.7, depth + 1);
          cx = nx;
          cy = ny;
        }
      };
      grow(W * (0.15 + r() * 0.7), 0, (r() - 0.5) * 0.5, H * 0.06, 0);
      return segs;
    }
    draw(ctx, audio, cfg, t, W, H, dt) {
      const g = gset(cfg);
      const m = mset(cfg, 'storm', { cover: 0.6, rain: 1, flash: 1, bassPush: 1.5 });
      const step = Math.min(0.05, dt || 0.016);
      const T = t * g.speed;
      if (this.onset.push(audio.bass * g.react * m.bassPush * 0.7, step)) {
        this.flash = 1;
        this.bolt = this._bolt(W, H);
        this.boltAge = 0;
      }
      this.flash *= Math.exp(-step * 5);
      this.boltAge += step;
      lowres(this, W, H, 8);
      const w = this.buf.width;
      const h = this.buf.height;
      const d = this.img.data;
      const pal = ramp(cfg, 16, this.cols);
      const nz = this.noise;
      const sc = 3 / Math.max(w, h);
      const lo = 1 - clamp(m.cover, 0, 1);
      const lit = this.flash * m.flash;
      for (let y = 0; y < h; y++) {
        const fy = y / h;
        for (let x = 0; x < w; x++) {
          const px = x * sc + T * 0.04;
          const py = y * sc * 1.8;
          const v = nz(px, py) * 0.55 + nz(px * 2.1 - T * 0.03, py * 2.1) * 0.3 + nz(px * 4.3, py * 4.3) * 0.15;
          const k = clamp((v - lo * 0.8) * 2.2, 0, 1) * (1 - fy * 0.6);
          const c = pal[Math.min(15, (k * 6) | 0)];
          const li = 0.1 + k * 0.35 + lit * (0.5 + k * 0.8);
          const o = (y * w + x) * 4;
          d[o] = clamp(c[0] * li * 0.8 + lit * 120, 0, 255);
          d[o + 1] = clamp(c[1] * li * 0.85 + lit * 130, 0, 255);
          d[o + 2] = clamp(c[2] * li + lit * 160, 0, 255);
          d[o + 3] = 255;
        }
      }
      blit(this, ctx, W, H, g.bright);
      // Şimşek
      if (this.bolt && this.boltAge < 0.35) {
        const a = (1 - this.boltAge / 0.35) * g.bright;
        ctx.globalCompositeOperation = 'lighter';
        for (let pass = 0; pass < 2; pass++) {
          ctx.strokeStyle = pass ? 'rgba(255,255,255,' + a.toFixed(3) + ')' : 'rgba(160,190,255,' + (a * 0.35).toFixed(3) + ')';
          ctx.lineCap = 'round';
          for (let i = 0; i < this.bolt.length; i += 5) {
            ctx.lineWidth = (pass ? 1.6 : 7) * (1 - this.bolt[i + 4] * 0.35) * Math.max(1, W / 1280);
            ctx.beginPath();
            ctx.moveTo(this.bolt[i], this.bolt[i + 1]);
            ctx.lineTo(this.bolt[i + 2], this.bolt[i + 3]);
            ctx.stroke();
          }
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      // Yağmur: eğik çizgiler, tek yol
      const drops = clamp(Math.round(RAIN_MAX * 0.6 * m.rain), 0, RAIN_MAX);
      if (drops) {
        const len = H * 0.035;
        const fall = T * 1.6;
        ctx.strokeStyle = 'rgba(190,210,255,' + (0.18 * g.bright).toFixed(3) + ')';
        ctx.lineWidth = Math.max(1, W / 1600);
        ctx.beginPath();
        for (let i = 0; i < drops; i++) {
          const y = ((this.ry[i] + fall * (0.8 + (i % 5) * 0.08)) % 1) * (H + len) - len;
          const x = this.rx[i] * W - (y / H) * W * 0.08;
          ctx.moveTo(x, y);
          ctx.lineTo(x - len * 0.18, y + len);
        }
        ctx.stroke();
      }
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ================================= SU ALTI =================================
  // Derinlik gradyanı, sallanan ışık hüzmeleri ve yükselen kabarcıklar
  const BUB_MAX = 200;

  class Underwater {
    constructor() {
      const r = rng(0xb0b1);
      this.bx = new Float32Array(BUB_MAX);
      this.by = new Float32Array(BUB_MAX);
      this.bs = new Float32Array(BUB_MAX);
      this.bp = new Float32Array(BUB_MAX);
      for (let i = 0; i < BUB_MAX; i++) { this.bx[i] = r(); this.by[i] = r(); this.bs[i] = 0.3 + r(); this.bp[i] = r() * TAU; }
      this.rayPh = [];
      for (let i = 0; i < 8; i++) this.rayPh.push([r() * TAU, 0.3 + r() * 0.5, r()]);
    }
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'underwater', { rays: 5, bubbles: 70, sway: 1, depth: 0.6, bassPush: 1.2 });
      const T = t * g.speed;
      const bass = audio.bass * g.react;
      const topC = lerpColor(cfg, 0.55);
      const botC = lerpColor(cfg, 0.1);
      const dk = 1 - clamp(m.depth, 0, 1) * 0.8;
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, rgba([topC[0] * 0.55 * dk | 0, topC[1] * 0.6 * dk | 0, topC[2] * 0.7 * dk | 0], 1));
      grad.addColorStop(1, rgba([botC[0] * 0.08 | 0, botC[1] * 0.1 | 0, botC[2] * 0.14 | 0], 1));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      // Işık hüzmeleri
      const nr = clamp(Math.round(m.rays), 0, 8);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < nr; i++) {
        const [ph, sp, pos] = this.rayPh[i];
        const x = W * (0.1 + pos * 0.8) + Math.sin(T * 0.4 * sp + ph) * W * 0.06 * m.sway;
        const tilt = Math.sin(T * 0.3 * sp + ph * 2) * 0.25 * m.sway;
        const wTop = W * 0.02;
        const wBot = W * (0.08 + pos * 0.06);
        const gr = ctx.createLinearGradient(0, 0, 0, H * 0.9);
        const a = (0.07 + bass * 0.05 * m.bassPush) * g.bright * (0.6 + 0.4 * Math.sin(T * 0.7 + ph));
        gr.addColorStop(0, rgba(topC, Math.max(0, a).toFixed(3)));
        gr.addColorStop(1, rgba(topC, 0));
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.moveTo(x - wTop, 0);
        ctx.lineTo(x + wTop, 0);
        ctx.lineTo(x + wBot + tilt * H, H * 0.9);
        ctx.lineTo(x - wBot + tilt * H, H * 0.9);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      // Kabarcıklar: yükselip sallanır; bas yükselişi hızlandırır. Tek yol.
      const nb = clamp(Math.round(m.bubbles), 0, BUB_MAX);
      const rise = T * (0.06 + bass * 0.02 * m.bassPush);
      const base = Math.min(W, H) * 0.006;
      ctx.strokeStyle = 'rgba(220,240,255,' + (0.45 * g.bright).toFixed(3) + ')';
      ctx.fillStyle = 'rgba(220,240,255,' + (0.08 * g.bright).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1, W / 1800);
      ctx.beginPath();
      for (let i = 0; i < nb; i++) {
        const y = 1 - ((this.by[i] + rise * this.bs[i]) % 1);
        const x = this.bx[i] + Math.sin(T * 1.5 * this.bs[i] + this.bp[i]) * 0.01 * m.sway;
        const r = base * (0.5 + this.bs[i]);
        ctx.moveTo(x * W + r, y * H);
        ctx.arc(x * W, y * H, r, 0, TAU);
      }
      ctx.fill();
      ctx.stroke();
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ================================ AYNA DESENİ ================================
  // Kaleydoskop zemin: plazma alanı açısal dilimlere katlanıp aynalanır
  /* Piksel başına: kutupsal koordinat tamponun boyuna bağlı, her karede
     aynı; tabloda tutuluyor. Sinüs 1024 basamaklı tablodan, renk 64
     basamaklı hazır tablodan. İlk sürüm 1080p'de karelerin çoğunu 25 ms'nin
     üstüne çıkarıyordu (modecost). */
  const SIN_N = 1024;
  const SIN_T = new Float32Array(SIN_N);
  for (let i = 0; i < SIN_N; i++) SIN_T[i] = Math.sin((i / SIN_N) * TAU);
  const SIN_K = SIN_N / TAU;
  const fsin = (x) => SIN_T[((x * SIN_K) | 0) & (SIN_N - 1)];
  const fcos = (x) => SIN_T[(((x * SIN_K) | 0) + (SIN_N >> 2)) & (SIN_N - 1)];

  class Mirror {
    constructor() {
      this.cols = [];
      this.lut = new Uint8Array(64 * 3);
      this.polarKey = '';
    }
    _polar(w, h) {
      const key = w + 'x' + h;
      if (this.polarKey === key) return;
      this.polarKey = key;
      this.pr = new Float32Array(w * h);
      this.pa = new Float32Array(w * h);
      const asp = w / h;
      for (let y = 0; y < h; y++) {
        const fy = y / h - 0.5;
        for (let x = 0; x < w; x++) {
          const fx = (x / w - 0.5) * asp;
          this.pr[y * w + x] = Math.hypot(fx, fy);
          this.pa[y * w + x] = Math.atan2(fy, fx);
        }
      }
    }
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'mirror', { segments: 8, scale: 1, swirl: 1, bassPush: 1.2 });
      lowres(this, W, H, 6);
      const w = this.buf.width;
      const h = this.buf.height;
      this._polar(w, h);
      const d = this.img.data;
      const seg = TAU / clamp(Math.round(m.segments), 3, 16);
      const half = seg / 2;
      const T = t * g.speed;
      const bass = audio.bass * g.react;
      const sc = 7 * m.scale * (1 + bass * 0.15 * m.bassPush);
      const rot = T * 0.05 * m.swirl;
      const rs = 6 * m.swirl;
      const pal = ramp(cfg, 32, this.cols);
      const lut = this.lut;
      for (let i = 0; i < 64; i++) {
        const k = i / 63;
        const c = pal[Math.min(31, (k * 32) | 0)];
        const li = 0.35 + k * 0.75;
        lut[i * 3] = clamp(c[0] * li, 0, 255);
        lut[i * 3 + 1] = clamp(c[1] * li, 0, 255);
        lut[i * 3 + 2] = clamp(c[2] * li, 0, 255);
      }
      const pr = this.pr;
      const pa = this.pa;
      const t1 = T;
      const t2 = T * 0.8;
      const t3 = T * 1.3;
      for (let i = 0, o = 0, n = w * h; i < n; i++, o += 4) {
        const r = pr[i];
        // Açıyı dilime katla ve aynala
        let a = (pa[i] + rot) % seg;
        if (a < 0) a += seg;
        if (a > half) a = seg - a;
        const u = fcos(a) * r;
        const v = fsin(a) * r;
        const val = fsin(u * sc + t1) + fsin(v * sc * 1.7 - t2) + fsin((u + v) * sc * 0.6 + r * rs - t3);
        const q = Math.min(63, Math.max(0, ((val / 3 * 0.5 + 0.5) * 63) | 0)) * 3;
        d[o] = lut[q];
        d[o + 1] = lut[q + 1];
        d[o + 2] = lut[q + 2];
        d[o + 3] = 255;
      }
      blit(this, ctx, W, H, g.bright);
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
    cubes: Cubes,
    fireflies: Fireflies,
    storm: Storm,
    underwater: Underwater,
    mirror: Mirror,
  });
})();
