'use strict';
/* Arkaplanların üçüncü bölümü.

   backgrounds.js ile aynı sözleşme:
     draw(ctx, audio, cfg, t, W, H, dt)  — verilen 2D bağlama çizer
     palette(cfg)                        — Dynamic Lighting için renk listesi

   Renk yardımcıları window.SVBgUtil'den gelir; ortak renk seçicileri ve
   şablonlar burada da aynen geçerlidir. Arkaplanların görselleştiricilerden
   farkı, sahnenin ZEMİNİ olmaları: bütün kareyi doldururlar, sese daha
   yumuşak tepki verirler ve öndeki katmanın okunmasını engellemezler. */
(function () {
  const U = window.SVBgUtil;
  const { colorsOf, rgba, lerpColor, gset, mset, rng, vignette, basePalette } = U;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ============================ SIVI METAL ============================
  // Perlin benzeri alan üzerinde eşyükselti bantları: akışkan metal görünümü
  class LiquidMetal {
    constructor() { this.buf = null; }
    _ensure(W, H) {
      const s = 6;
      const w = Math.max(2, Math.ceil(W / s));
      const h = Math.max(2, Math.ceil(H / s));
      if (this.buf && this.buf.width === w && this.buf.height === h) return;
      this.buf = document.createElement('canvas');
      this.buf.width = w;
      this.buf.height = h;
      this.bctx = this.buf.getContext('2d');
      this.img = this.bctx.createImageData(w, h);
    }
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'liquid', { bands: 7, warp: 1, sharp: 0.6 });
      this._ensure(W, H);
      const w = this.buf.width;
      const h = this.buf.height;
      const d = this.img.data;
      const T = t * g.speed * 0.6;
      const lvl = audio.level * g.react;
      const warp = m.warp * (1 + lvl * 0.9);

      const cols = [];
      for (let i = 0; i < 16; i++) cols.push(lerpColor(cfg, i / 15));

      for (let y = 0; y < h; y++) {
        const fy = y / h;
        for (let x = 0; x < w; x++) {
          const fx = x / w;
          // Üç sinüs katmanının toplamı: ucuz ama akışkan görünen alan
          let v = Math.sin((fx * 6.1 + T) * warp) +
            Math.sin((fy * 5.3 - T * 0.8) * warp) +
            Math.sin(((fx + fy) * 4.2 + T * 1.3) * warp) +
            Math.sin(Math.hypot(fx - 0.5, fy - 0.5) * 14 - T * 2) * (0.6 + lvl);
          v = v / 4 * 0.5 + 0.5;
          // Eşyükselti bantları: metalik parlama hissi buradan geliyor
          const band = Math.abs(Math.sin(v * Math.PI * m.bands));
          const k = Math.pow(band, 1 + m.sharp * 3);
          const c = cols[Math.min(15, (v * 16) | 0)];
          const o = (y * w + x) * 4;
          d[o] = clamp(c[0] * (0.35 + k * 0.9), 0, 255);
          d[o + 1] = clamp(c[1] * (0.35 + k * 0.9), 0, 255);
          d[o + 2] = clamp(c[2] * (0.35 + k * 0.9), 0, 255);
          d[o + 3] = 255;
        }
      }
      this.bctx.putImageData(this.img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = g.bright;
      ctx.drawImage(this.buf, 0, 0, W, H);
      ctx.globalAlpha = 1;
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================== PLAZMA ==============================
  class Plasma {
    constructor() { this.buf = null; }
    _ensure(W, H) {
      const s = 5;
      const w = Math.max(2, Math.ceil(W / s));
      const h = Math.max(2, Math.ceil(H / s));
      if (this.buf && this.buf.width === w && this.buf.height === h) return;
      this.buf = document.createElement('canvas');
      this.buf.width = w;
      this.buf.height = h;
      this.bctx = this.buf.getContext('2d');
      this.img = this.bctx.createImageData(w, h);
    }
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'plasma', { scale: 1, swirl: 1 });
      this._ensure(W, H);
      const w = this.buf.width;
      const h = this.buf.height;
      const d = this.img.data;
      const T = t * g.speed;
      const bass = audio.bass * g.react;
      const sc = 8 * m.scale * (1 + bass * 0.25);

      const cols = [];
      for (let i = 0; i < 32; i++) cols.push(lerpColor(cfg, i / 31));

      for (let y = 0; y < h; y++) {
        const fy = y / h - 0.5;
        for (let x = 0; x < w; x++) {
          const fx = x / w - 0.5;
          const r = Math.hypot(fx, fy);
          const a = Math.atan2(fy, fx);
          // Klasik demoscene plazması: sinüslerin toplamı, kutupsal terimle
          const v =
            Math.sin(fx * sc + T) +
            Math.sin(fy * sc * 0.8 - T * 1.2) +
            Math.sin(r * sc * 1.4 - T * 1.7) +
            Math.sin((a * 3 + r * sc) * m.swirl + T * 0.9);
          const k = (v / 4) * 0.5 + 0.5;
          const c = cols[Math.min(31, (k * 32) | 0)];
          const o = (y * w + x) * 4;
          d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
        }
      }
      this.bctx.putImageData(this.img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = g.bright;
      ctx.drawImage(this.buf, 0, 0, W, H);
      ctx.globalAlpha = 1;
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // =========================== KUTUP IŞIĞI 2 ===========================
  // Dikey perde yerine yatay akan bantlar
  class Ribbons {
    constructor() { this.rand = rng(0x2ba1); }
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'ribbons', { count: 7, width: 1, wave: 1 });
      ctx.fillStyle = '#05040c';
      ctx.fillRect(0, 0, W, H);
      const n = Math.max(2, Math.round(m.count));
      const lvl = audio.level * g.react;
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1 || 1);
        const c = lerpColor(cfg, f);
        const baseY = H * (0.15 + 0.7 * f);
        const amp = H * 0.07 * m.wave * (0.5 + lvl);
        const thick = H * 0.045 * m.width * (0.6 + lvl * 0.8);
        const ph = t * g.speed * (0.4 + i * 0.12) + i * 1.7;
        ctx.beginPath();
        ctx.moveTo(0, baseY);
        const steps = 48;
        for (let s = 0; s <= steps; s++) {
          const x = (W * s) / steps;
          const u = s / steps;
          const y = baseY +
            Math.sin(u * 5.1 + ph) * amp +
            Math.sin(u * 11.3 - ph * 1.4) * amp * 0.4;
          ctx.lineTo(x, y);
        }
        for (let s = steps; s >= 0; s--) {
          const x = (W * s) / steps;
          const u = s / steps;
          const y = baseY +
            Math.sin(u * 5.1 + ph) * amp +
            Math.sin(u * 11.3 - ph * 1.4) * amp * 0.4 +
            thick * (0.6 + Math.sin(u * 7 + ph * 0.6) * 0.4);
          ctx.lineTo(x, y);
        }
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, baseY - thick, 0, baseY + thick * 2);
        grad.addColorStop(0, rgba(c, 0));
        grad.addColorStop(0.5, rgba(c, 0.5 * g.bright));
        grad.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = grad;
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================== TOPOĞRAFYA ==============================
  // Eşyükselti eğrileri — harita görünümlü, çok sakin bir zemin
  class Contours {
    constructor() {}
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'contours', { lines: 26, scale: 1, drift: 1 });
      const bg = lerpColor(cfg, 0.05);
      ctx.fillStyle = rgba([bg[0] * 0.25 | 0, bg[1] * 0.25 | 0, bg[2] * 0.25 | 0], 1);
      ctx.fillRect(0, 0, W, H);

      const lines = Math.max(4, Math.round(m.lines));
      const T = t * g.speed * 0.35 * m.drift;
      const lvl = audio.level * g.react;
      const step = Math.max(6, Math.round(Math.min(W, H) / 160));
      ctx.lineWidth = Math.max(1, Math.min(W, H) / 900);

      for (let l = 0; l < lines; l++) {
        const f = l / (lines - 1);
        const c = lerpColor(cfg, f);
        ctx.strokeStyle = rgba(c, (0.18 + f * 0.5) * g.bright);
        ctx.beginPath();
        let started = false;
        for (let x = 0; x <= W; x += step) {
          const u = x / W;
          // Alanı yükseklikte kesiyoruz: her çizgi bir eşyükselti
          const height =
            Math.sin(u * 6.2 * m.scale + T) * 0.4 +
            Math.sin(u * 13.7 * m.scale - T * 1.3) * 0.22 +
            Math.sin(u * 2.9 * m.scale + T * 0.6) * 0.3;
          const y = H * (0.12 + 0.76 * f) + height * H * 0.11 * (1 + lvl * 0.8);
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================== KIVILCIM ==============================
  class Embers {
    constructor() {
      this.rand = rng(0x77e2);
      this.N = 260;
      this.x = new Float32Array(this.N);
      this.y = new Float32Array(this.N);
      this.v = new Float32Array(this.N);
      this.s = new Float32Array(this.N);
      this.h = new Float32Array(this.N);
      this.init = false;
    }
    _seed() {
      for (let i = 0; i < this.N; i++) {
        this.x[i] = this.rand();
        this.y[i] = this.rand();
        this.v[i] = 0.3 + this.rand() * 0.8;
        this.s[i] = 0.3 + this.rand() * 0.9;
        this.h[i] = this.rand();
      }
      this.init = true;
    }
    draw(ctx, audio, cfg, t, W, H, dt) {
      const g = gset(cfg);
      const m = mset(cfg, 'embers', { drift: 1, size: 1, glowAmt: 1 });
      if (!this.init) this._seed();
      const step = Math.min(0.05, dt || 0.016);
      const bg = lerpColor(cfg, 0.02);
      ctx.fillStyle = rgba([bg[0] * 0.2 | 0, bg[1] * 0.2 | 0, bg[2] * 0.2 | 0], 1);
      ctx.fillRect(0, 0, W, H);

      const lvl = audio.level * g.react;
      const minDim = Math.min(W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < this.N; i++) {
        // Yukarı süzülme + yanal salınım
        this.y[i] -= step * this.v[i] * (0.04 + lvl * 0.1) * g.speed * m.drift;
        this.x[i] += Math.sin(t * 0.6 + i) * step * 0.006 * m.drift;
        if (this.y[i] < -0.05) {
          this.y[i] = 1.05;
          this.x[i] = this.rand();
          this.h[i] = this.rand();
        }
        const c = lerpColor(cfg, this.h[i]);
        const r = minDim * 0.004 * this.s[i] * m.size * (0.7 + lvl * 0.8);
        const x = this.x[i] * W;
        const y = this.y[i] * H;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 4 * m.glowAmt);
        grad.addColorStop(0, rgba(c, 0.85 * g.bright));
        grad.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r * 4 * m.glowAmt, 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================== VİTRAY ==============================
  // Rastgele bölünmüş çokgenler, kurşun çerçeveli
  class Stained {
    constructor() {
      this.cells = null;
      this.rand = rng(0x5df3);
    }
    _build(n) {
      this.cells = [];
      for (let i = 0; i < n; i++) {
        this.cells.push({
          x: this.rand(), y: this.rand(),
          sides: 3 + ((this.rand() * 5) | 0),
          rot: this.rand() * TAU,
          r: 0.06 + this.rand() * 0.11,
          hue: this.rand(),
          ph: this.rand() * TAU,
        });
      }
    }
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'stained', { count: 46, lead: 1, glowAmt: 1 });
      const n = Math.max(8, Math.round(m.count));
      if (!this.cells || this.cells.length !== n) this._build(n);

      ctx.fillStyle = '#06050b';
      ctx.fillRect(0, 0, W, H);
      const bars = audio.getBars(n, 30, 14000);
      const minDim = Math.min(W, H);
      ctx.lineJoin = 'round';
      for (let i = 0; i < n; i++) {
        const cell = this.cells[i];
        const e = clamp(bars[i] * g.react, 0, 1);
        const c = lerpColor(cfg, cell.hue);
        const R = cell.r * minDim * (1 + e * 0.35) * (1 + Math.sin(t * 0.5 + cell.ph) * 0.05);
        const cx = cell.x * W;
        const cy = cell.y * H;
        ctx.beginPath();
        for (let s = 0; s < cell.sides; s++) {
          const a = cell.rot + (s / cell.sides) * TAU + t * g.speed * 0.05;
          const px = cx + Math.cos(a) * R;
          const py = cy + Math.sin(a) * R;
          if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = rgba(c, (0.15 + e * 0.65) * g.bright);
        ctx.fill();
        // Kurşun çerçeve
        ctx.strokeStyle = rgba([12, 10, 18], 0.85 * m.lead);
        ctx.lineWidth = Math.max(1, minDim * 0.004 * m.lead);
        ctx.stroke();
      }
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================ DEVRE KARTI ============================
  class Circuit {
    constructor() {
      this.paths = null;
      this.rand = rng(0x1c7b);
    }
    _build(n) {
      this.paths = [];
      for (let i = 0; i < n; i++) {
        const pts = [];
        let x = this.rand();
        let y = this.rand();
        pts.push([x, y]);
        // Manhattan yürüyüşü: yalnızca yatay ve dikey adımlar
        const steps = 4 + ((this.rand() * 7) | 0);
        for (let s = 0; s < steps; s++) {
          if (s % 2 === 0) x = clamp(x + (this.rand() - 0.5) * 0.34, 0.02, 0.98);
          else y = clamp(y + (this.rand() - 0.5) * 0.34, 0.02, 0.98);
          pts.push([x, y]);
        }
        this.paths.push({ pts, hue: this.rand(), speed: 0.3 + this.rand() * 1.2, ph: this.rand() });
      }
    }
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'circuit', { count: 34, pulse: 1, thickness: 1 });
      const n = Math.max(6, Math.round(m.count));
      if (!this.paths || this.paths.length !== n) this._build(n);

      ctx.fillStyle = '#04060a';
      ctx.fillRect(0, 0, W, H);
      const lvl = audio.level * g.react;
      const minDim = Math.min(W, H);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (let i = 0; i < n; i++) {
        const p = this.paths[i];
        const c = lerpColor(cfg, p.hue);
        ctx.strokeStyle = rgba(c, 0.16 * g.bright);
        ctx.lineWidth = Math.max(1, minDim * 0.0035 * m.thickness);
        ctx.beginPath();
        for (let k = 0; k < p.pts.length; k++) {
          const [px, py] = p.pts[k];
          if (k === 0) ctx.moveTo(px * W, py * H); else ctx.lineTo(px * W, py * H);
        }
        ctx.stroke();

        // Hat üzerinde ilerleyen sinyal darbesi
        const prog = ((t * p.speed * g.speed * 0.35 + p.ph) % 1);
        const seg = prog * (p.pts.length - 1);
        const si = Math.min(p.pts.length - 2, Math.floor(seg));
        const sf = seg - si;
        const a = p.pts[si];
        const b = p.pts[si + 1];
        const x = (a[0] + (b[0] - a[0]) * sf) * W;
        const y = (a[1] + (b[1] - a[1]) * sf) * H;
        const r = minDim * 0.012 * m.pulse * (0.6 + lvl);
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, rgba(c, 0.95 * g.bright));
        grad.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();

        // Düğüm noktaları
        for (const [px, py] of p.pts) {
          ctx.fillStyle = rgba(c, 0.32 * g.bright);
          ctx.beginPath();
          ctx.arc(px * W, py * H, minDim * 0.0022 * m.thickness, 0, TAU);
          ctx.fill();
        }
      }
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================ SU YÜZEYİ ============================
  class Caustics {
    constructor() { this.buf = null; }
    _ensure(W, H) {
      const s = 5;
      const w = Math.max(2, Math.ceil(W / s));
      const h = Math.max(2, Math.ceil(H / s));
      if (this.buf && this.buf.width === w && this.buf.height === h) return;
      this.buf = document.createElement('canvas');
      this.buf.width = w;
      this.buf.height = h;
      this.bctx = this.buf.getContext('2d');
      this.img = this.bctx.createImageData(w, h);
    }
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'caustics', { scale: 1, sharp: 1 });
      this._ensure(W, H);
      const w = this.buf.width;
      const h = this.buf.height;
      const d = this.img.data;
      const T = t * g.speed * 0.8;
      const lvl = audio.level * g.react;
      const sc = 9 * m.scale;
      const deep = lerpColor(cfg, 0.08);
      const light = lerpColor(cfg, 0.9);

      for (let y = 0; y < h; y++) {
        const fy = y / h;
        for (let x = 0; x < w; x++) {
          const fx = x / w;
          /* Kostik deseni: birkaç dalganın toplamının MUTLAK değeri alınıp
             kuvvetlendirilir. Sıfır geçişleri ince parlak çizgilere dönüşür
             ve su yüzeyinden kırılan ışığın izine benzer. */
          const a = Math.sin((fx * sc + T) * 1.0) + Math.sin((fy * sc - T * 0.7) * 1.1);
          const b = Math.sin(((fx + fy) * sc * 0.7 + T * 1.3));
          const c2 = Math.sin(((fx - fy) * sc * 0.9 - T * 0.9));
          const v = Math.abs(a + b + c2) / 3;
          const k = Math.pow(1 - clamp(v, 0, 1), 3 + m.sharp * 5) * (0.7 + lvl * 0.8);
          const o = (y * w + x) * 4;
          d[o] = clamp(deep[0] * 0.35 + light[0] * k, 0, 255);
          d[o + 1] = clamp(deep[1] * 0.35 + light[1] * k, 0, 255);
          d[o + 2] = clamp(deep[2] * 0.35 + light[2] * k, 0, 255);
          d[o + 3] = 255;
        }
      }
      this.bctx.putImageData(this.img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = g.bright;
      ctx.drawImage(this.buf, 0, 0, W, H);
      ctx.globalAlpha = 1;
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================== KRİSTAL ==============================
  // Işınsal prizma dilimleri
  class Prism {
    constructor() { this.rand = rng(0x3a91); }
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'prism', { slices: 14, depth: 1, spin: 1 });
      ctx.fillStyle = '#05040a';
      ctx.fillRect(0, 0, W, H);
      const n = Math.max(3, Math.round(m.slices));
      const bars = audio.getBars(n, 40, 12000);
      const cx = W / 2;
      const cy = H / 2;
      const R = Math.hypot(W, H) * 0.6;
      const spin = t * g.speed * 0.12 * m.spin;

      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const e = clamp(bars[i] * g.react, 0, 1);
        const a0 = (i / n) * TAU + spin;
        const a1 = a0 + TAU / n;
        const c = lerpColor(cfg, i / n);
        const r = R * (0.35 + e * 0.65 * m.depth);
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba(c, 0.5 * g.bright));
        grad.addColorStop(0.7, rgba(c, 0.16 * g.bright));
        grad.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, a0, a1);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================ PARÇACIK AĞI 2 ============================
  // Küresel yüzeyde dolaşan noktalar (dünya hissi)
  class Globe {
    constructor() {
      this.rand = rng(0x6f4a);
      this.N = 420;
      this.th = new Float32Array(this.N);
      this.ph = new Float32Array(this.N);
      for (let i = 0; i < this.N; i++) {
        // Kürede düzgün dağılım: cos(θ) düzgün seçilmeli
        this.th[i] = Math.acos(1 - 2 * this.rand());
        this.ph[i] = this.rand() * TAU;
      }
    }
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'globe', { tilt: 0.4, links: 1, size: 1 });
      ctx.fillStyle = '#04030a';
      ctx.fillRect(0, 0, W, H);
      const cx = W / 2;
      const cy = H / 2;
      const R = Math.min(W, H) * 0.36;
      const spin = t * g.speed * 0.25;
      const tilt = m.tilt;
      const lvl = audio.level * g.react;

      const px = new Float32Array(this.N);
      const py = new Float32Array(this.N);
      const pz = new Float32Array(this.N);
      for (let i = 0; i < this.N; i++) {
        const th = this.th[i];
        const ph = this.ph[i] + spin;
        let x = Math.sin(th) * Math.cos(ph);
        let y = Math.cos(th);
        let z = Math.sin(th) * Math.sin(ph);
        // Eksen eğimi
        const ny = y * Math.cos(tilt) - z * Math.sin(tilt);
        const nz = y * Math.sin(tilt) + z * Math.cos(tilt);
        const rr = R * (1 + lvl * 0.06);
        px[i] = cx + x * rr;
        py[i] = cy + ny * rr;
        pz[i] = nz;
      }

      // Bağlantılar
      if (m.links > 0.01) {
        const maxD = R * 0.34 * m.links;
        for (let i = 0; i < this.N; i++) {
          if (pz[i] < -0.1) continue;
          for (let j = i + 1; j < this.N; j++) {
            if (pz[j] < -0.1) continue;
            const dx = px[i] - px[j];
            const dy = py[i] - py[j];
            const d = Math.hypot(dx, dy);
            if (d > maxD) continue;
            const c = lerpColor(cfg, (i / this.N + 0.3) % 1);
            ctx.strokeStyle = rgba(c, (1 - d / maxD) * 0.16 * g.bright);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(px[i], py[i]);
            ctx.lineTo(px[j], py[j]);
            ctx.stroke();
          }
        }
      }
      // Noktalar
      for (let i = 0; i < this.N; i++) {
        const depth = (pz[i] + 1) * 0.5;
        const c = lerpColor(cfg, this.th[i] / Math.PI);
        const r = Math.min(W, H) * 0.0035 * m.size * (0.35 + depth);
        ctx.fillStyle = rgba(c, (0.2 + depth * 0.8) * g.bright);
        ctx.beginPath();
        ctx.arc(px[i], py[i], r, 0, TAU);
        ctx.fill();
      }
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================ ÇİZGİ TÜNELİ ============================
  class Wireframe {
    constructor() {}
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'wireframe', { rings: 16, sides: 10, speed: 1 });
      ctx.fillStyle = '#03030a';
      ctx.fillRect(0, 0, W, H);
      const rings = Math.max(4, Math.round(m.rings));
      const sides = Math.max(3, Math.round(m.sides));
      const cx = W / 2;
      const cy = H / 2;
      const minDim = Math.min(W, H);
      const lvl = audio.level * g.react;
      const T = t * g.speed * m.speed * 0.5;
      const bars = audio.getBars(rings, 30, 14000);

      ctx.lineWidth = Math.max(1, minDim / 1000);
      for (let r = 0; r < rings; r++) {
        // Halkalar kameraya doğru akar; z 0'a yaklaşınca yeniden başa döner
        const z = ((r / rings) + T) % 1;
        const persp = 1 / (0.08 + z * 1.6);
        const e = clamp(bars[r] * g.react, 0, 1);
        const R = minDim * 0.06 * persp * (1 + e * 0.4 + lvl * 0.2);
        if (R > Math.hypot(W, H)) continue;
        const c = lerpColor(cfg, r / rings);
        const alpha = (1 - z) * (0.15 + e * 0.7) * g.bright;
        if (alpha < 0.01) continue;
        ctx.strokeStyle = rgba(c, alpha);
        ctx.beginPath();
        for (let s = 0; s <= sides; s++) {
          const a = (s / sides) * TAU + z * 1.2;
          const x = cx + Math.cos(a) * R;
          const y = cy + Math.sin(a) * R;
          if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================== KUM ==============================
  // Yatay bantlarda süzülen tanecikler
  class Sand {
    constructor() {
      this.rand = rng(0x9c22);
      this.N = 900;
      this.x = new Float32Array(this.N);
      this.y = new Float32Array(this.N);
      this.v = new Float32Array(this.N);
      this.h = new Float32Array(this.N);
      for (let i = 0; i < this.N; i++) {
        this.x[i] = this.rand();
        this.y[i] = this.rand();
        this.v[i] = 0.2 + this.rand();
        this.h[i] = this.rand();
      }
    }
    draw(ctx, audio, cfg, t, W, H, dt) {
      const g = gset(cfg);
      const m = mset(cfg, 'sand', { flow: 1, layers: 5, grain: 1 });
      const step = Math.min(0.05, dt || 0.016);
      const bg = lerpColor(cfg, 0.03);
      ctx.fillStyle = rgba([bg[0] * 0.2 | 0, bg[1] * 0.2 | 0, bg[2] * 0.2 | 0], 1);
      ctx.fillRect(0, 0, W, H);
      const lvl = audio.level * g.react;
      const layers = Math.max(2, Math.round(m.layers));

      for (let i = 0; i < this.N; i++) {
        const band = ((this.h[i] * layers) | 0) / layers;
        const dir = (Math.floor(this.h[i] * layers) % 2 === 0) ? 1 : -1;
        this.x[i] += step * this.v[i] * dir * (0.05 + lvl * 0.14) * g.speed * m.flow;
        if (this.x[i] > 1.02) this.x[i] = -0.02;
        if (this.x[i] < -0.02) this.x[i] = 1.02;
        const c = lerpColor(cfg, band + 0.06);
        const y = (band + 0.5 / layers) * H + Math.sin(this.x[i] * 12 + t + i) * H * 0.02;
        ctx.fillStyle = rgba(c, (0.12 + this.v[i] * 0.35) * g.bright);
        const s = Math.max(1, Math.min(W, H) * 0.0018 * m.grain);
        ctx.fillRect(this.x[i] * W, y, s, s);
      }
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================ SES DALGALARI ============================
  // Dalga formunun kendisinden üretilen sakin bir zemin
  class WaveField {
    constructor() { this.hist = []; }
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'wavefield', { depth: 26, amp: 1, spacing: 1 });
      ctx.fillStyle = '#04040b';
      ctx.fillRect(0, 0, W, H);

      const depth = Math.max(4, Math.round(m.depth));
      const n = 96;
      const bars = audio.getBars(n, 30, 14000);
      // Yeni satırı geçmişe ekle, eskisini at
      const row = new Float32Array(n);
      for (let i = 0; i < n; i++) row[i] = bars[i];
      this.hist.unshift(row);
      if (this.hist.length > depth) this.hist.length = depth;

      const amp = H * 0.13 * m.amp;
      for (let d = this.hist.length - 1; d >= 0; d--) {
        const f = d / depth;
        const y0 = H * (0.28 + 0.62 * f) * m.spacing;
        const c = lerpColor(cfg, 1 - f);
        const r = this.hist[d];
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = (W * i) / (n - 1);
          const y = y0 - r[i] * amp * (1 - f * 0.6) * g.react;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.lineTo(W, H);
        ctx.lineTo(0, H);
        ctx.closePath();
        ctx.fillStyle = rgba([c[0] * 0.28 | 0, c[1] * 0.28 | 0, c[2] * 0.28 | 0], 0.9 * g.bright);
        ctx.fill();
        ctx.strokeStyle = rgba(c, (0.25 + (1 - f) * 0.55) * g.bright);
        ctx.lineWidth = Math.max(1, Math.min(W, H) / 900);
        ctx.stroke();
      }
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================ ALTIGEN PETEK 2 ============================
  // Derinlik hissi olan, tek tek yanıp sönen petek
  class HexPulse {
    constructor() { this.rand = rng(0x22c8); }
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'hexpulse', { size: 1, gap: 1, wave: 1 });
      ctx.fillStyle = '#05050c';
      ctx.fillRect(0, 0, W, H);
      const minDim = Math.min(W, H);
      const R = minDim * 0.05 * m.size;
      const dx = R * 1.5 * m.gap;
      const dy = R * Math.sqrt(3) * m.gap;
      const cols = Math.ceil(W / dx) + 2;
      const rows = Math.ceil(H / dy) + 2;
      const cx = W / 2;
      const cy = H / 2;
      const lvl = audio.level * g.react;
      const bars = audio.getBars(24, 40, 13000);

      for (let r = -1; r < rows; r++) {
        for (let c = -1; c < cols; c++) {
          const x = c * dx;
          const y = r * dy + (c % 2 ? dy * 0.5 : 0);
          const d = Math.hypot(x - cx, y - cy) / minDim;
          // Merkezden dışa yayılan dalga, banda göre parlaklık
          const wave = Math.sin(d * 9 * m.wave - t * g.speed * 2.2) * 0.5 + 0.5;
          const e = clamp(bars[Math.min(23, (d * 24) | 0)] * g.react, 0, 1);
          const k = wave * (0.25 + e * 0.9 + lvl * 0.2);
          if (k < 0.03) continue;
          const col = lerpColor(cfg, clamp(d * 1.4, 0, 1));
          ctx.fillStyle = rgba(col, k * 0.5 * g.bright);
          ctx.beginPath();
          for (let s = 0; s < 6; s++) {
            const a = (s / 6) * TAU;
            const px = x + Math.cos(a) * R * 0.92;
            const py = y + Math.sin(a) * R * 0.92;
            if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
        }
      }
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  Object.assign(window.SVBackgrounds, {
    liquid: LiquidMetal,
    plasma: Plasma,
    ribbons: Ribbons,
    contours: Contours,
    embers: Embers,
    stained: Stained,
    circuit: Circuit,
    caustics: Caustics,
    prism: Prism,
    globe: Globe,
    wireframe: Wireframe,
    sand: Sand,
    wavefield: WaveField,
    hexpulse: HexPulse,
  });
})();
