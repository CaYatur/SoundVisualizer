/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Görselleştirici modlarının üçüncü bölümü (#905): müzik videosu, yayın ve podcast için
   sade ve tanıdık biçimler ile sahne için gösterişli olanlar.

   Sözleşme diğer modlarla aynı:
     new Mode(canvas) -> draw(audio, cfg, t, dt) -> resize() -> dispose()

   Ortak yardımcılar generative.js'ten (window.SVGenUtil); bu dosya ondan SONRA yüklenmeli.
   Rastgelelik yalnız tohumlu üreteçten: çevrimdışı dışa aktarım kare kare tekrarlanabilir.

   Bellek sınırlı: her mod kendi sabit boyutlu tamponlarını kurucuda ya da bar sayısı
   değişince ayırır; kare başına dizi üretilmez. Tuval saydam kalır (arkaplan görünür). */
(function () {
  const G = window.SVGenUtil;
  const { rng, tone, rgba } = G;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sensOf = (v) => v.sensitivity || 1;
  const thickOf = (v) => (v.thickness == null ? 0.42 : v.thickness);

  /* Barların yumuşatılmış kopyası: çıkış hızlı, iniş yavaş. Ham barlar kareden kareye
     titrer; eğri çizen modlarda bu titreme çizginin tamamını oynatır. */
  function follow(self, bars, n, sens, dt, fall) {
    if (!self.lv || self.lv.length !== n) self.lv = new Float32Array(n);
    const lv = self.lv;
    const k = Math.min(1, (dt || 0.016) * (fall || 9));
    for (let i = 0; i < n; i++) {
      const x = clamp(bars[i] * sens, 0, 1.3);
      lv[i] = x > lv[i] ? x : lv[i] + (x - lv[i]) * k;
    }
    return lv;
  }

  function roundBar(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ==========================================================================
  // SIVI TAYF — dolgulu, yumuşak tayf eğrisi ve zemindeki yansıması
  // ==========================================================================
  class LiquidSpectrum {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
    }
    resize() {}
    _path(ctx, lv, n, x0, x1, base, amp, dir) {
      const step = (x1 - x0) / (n - 1);
      ctx.beginPath();
      ctx.moveTo(x0, base);
      ctx.lineTo(x0, base - lv[0] * amp * dir);
      for (let i = 1; i < n; i++) {
        const px = x0 + (i - 1) * step;
        const py = base - lv[i - 1] * amp * dir;
        const cx = x0 + i * step;
        const cy = base - lv[i] * amp * dir;
        ctx.quadraticCurveTo(px, py, (px + cx) / 2, (py + cy) / 2);
      }
      ctx.lineTo(x1, base - lv[n - 1] * amp * dir);
      ctx.lineTo(x1, base);
      ctx.closePath();
    }
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const n = clamp(v.barCount | 0, 16, 96);
      const lv = follow(this, audio.getBars(n, v.minFreq, v.maxFreq, v.spectrum), n, sensOf(v), dt, 10);
      ctx.clearRect(0, 0, W, H);
      const x0 = W * 0.06;
      const x1 = W * 0.94;
      const base = H * 0.68;
      const amp = H * 0.5;
      const a = tone(v, cfg, 0.1, t);
      const b = tone(v, cfg, 0.9, t);
      // Gövde: yatayda iki renk arası, dikeyde tabana doğru sönen dolgu
      const gh = ctx.createLinearGradient(x0, 0, x1, 0);
      gh.addColorStop(0, rgba(a, 0.95));
      gh.addColorStop(1, rgba(b, 0.95));
      this._path(ctx, lv, n, x0, x1, base, amp, 1);
      ctx.fillStyle = gh;
      ctx.fill();
      const gv = ctx.createLinearGradient(0, base - amp, 0, base);
      gv.addColorStop(0, 'rgba(0,0,0,0)');
      gv.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = gv;
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      // Üst çizgi
      ctx.lineWidth = Math.max(1.5, H * 0.004 * (0.6 + thickOf(v) * 1.6));
      ctx.lineJoin = 'round';
      ctx.strokeStyle = gh;
      ctx.stroke();
      // Yansıma: aynı eğri aşağı doğru, kısa ve soluk
      ctx.save();
      this._path(ctx, lv, n, x0, x1, base + H * 0.012, amp * 0.42, -1);
      const gr = ctx.createLinearGradient(0, base, 0, base + amp * 0.42);
      gr.addColorStop(0, rgba(a, 0.32));
      gr.addColorStop(1, rgba(b, 0));
      ctx.fillStyle = gr;
      ctx.fill();
      ctx.restore();
      this.glow.apply(this.canvas, v.glow, 0.8);
    }
    dispose() { this.lv = null; }
  }

  // ==========================================================================
  // KAPSÜL DALGA — ortadan iki yana açılan yuvarlak uçlu çubuklar (konuşma, podcast)
  // ==========================================================================
  class Capsules {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
    }
    resize() {}
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const half = clamp((v.barCount | 0) >> 2, 8, 32);
      const lv = follow(this, audio.getBars(half, v.minFreq, v.maxFreq, v.spectrum), half, sensOf(v), dt, 12);
      ctx.clearRect(0, 0, W, H);
      const total = half * 2;
      const span = W * 0.8;
      const slot = span / total;
      const bw = Math.max(2, slot * (1 - clamp(v.gap == null ? 0.36 : v.gap, 0, 0.8)));
      const mid = H / 2;
      const maxH = H * 0.62;
      const x0 = (W - span) / 2;
      for (let i = 0; i < total; i++) {
        // Bas ortada, tiz kenarlarda
        const k = i < half ? half - 1 - i : i - half;
        const val = lv[k];
        // Sessizken de bir nokta kalır: çizgi kaybolmaz
        const h = Math.max(bw, Math.min(1, val * val) * maxH);
        const x = x0 + i * slot + (slot - bw) / 2;
        ctx.fillStyle = rgba(tone(v, cfg, k / (half - 1), t), 0.55 + Math.min(0.45, val * 0.6));
        ctx.beginPath();
        roundBar(ctx, x, mid - h / 2, bw, h, bw / 2);
        ctx.fill();
      }
      this.glow.apply(this.canvas, v.glow, 0.8);
    }
    dispose() { this.lv = null; }
  }

  // ==========================================================================
  // SAHNE EKOLAYZERİ — perspektifli zeminde duran barlar ve zemindeki izleri
  // ==========================================================================
  class StageBars {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
    }
    resize() {}
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const n = clamp(v.barCount | 0, 12, 64);
      const lv = follow(this, audio.getBars(n, v.minFreq, v.maxFreq, v.spectrum), n, sensOf(v), dt, 11);
      ctx.clearRect(0, 0, W, H);
      const horizon = H * 0.56;
      const floor = H * 0.94;
      const cx = W / 2;
      // Zemin çizgileri: ufka doğru sıklaşan yataylar ve kaçış noktasına giden dikeyler
      const lineCol = tone(v, cfg, 0.5, t);
      ctx.lineWidth = Math.max(1, H * 0.0016);
      ctx.strokeStyle = rgba(lineCol, 0.22);
      ctx.beginPath();
      for (let i = 0; i <= 8; i++) {
        const f = i / 8;
        const y = horizon + (floor - horizon) * f * f;
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
      }
      for (let i = -8; i <= 8; i++) {
        ctx.moveTo(cx + i * W * 0.03, horizon);
        ctx.lineTo(cx + i * W * 0.11, floor);
      }
      ctx.stroke();
      // Barlar ufuk çizgisinin önünde, zeminin ortasında durur
      const baseY = horizon + (floor - horizon) * 0.42;
      const span = W * 0.78;
      const slot = span / n;
      const bw = Math.max(2, slot * (1 - clamp(v.gap == null ? 0.36 : v.gap, 0, 0.8)));
      const maxH = H * 0.46;
      const x0 = cx - span / 2;
      for (let i = 0; i < n; i++) {
        const val = lv[i];
        const h = Math.max(2, val * maxH);
        const x = x0 + i * slot + (slot - bw) / 2;
        const col = tone(v, cfg, i / (n - 1), t);
        const g = ctx.createLinearGradient(0, baseY - h, 0, baseY);
        g.addColorStop(0, rgba(col, 1));
        g.addColorStop(1, rgba(col, 0.55));
        ctx.fillStyle = g;
        ctx.fillRect(x, baseY - h, bw, h);
        // Zemindeki iz: aşağı doğru sönen yansıma
        const r = ctx.createLinearGradient(0, baseY, 0, baseY + h * 0.5);
        r.addColorStop(0, rgba(col, 0.3));
        r.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = r;
        ctx.fillRect(x, baseY + 1, bw, h * 0.5);
      }
      this.glow.apply(this.canvas, v.glow, 0.8);
    }
    dispose() { this.lv = null; }
  }

  // ==========================================================================
  // ALTIGEN TAYF — petek hücreleri; sütun bandı, yükseklik seviyeyi gösterir
  // ==========================================================================
  class HexSpectrum {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
    }
    resize() {}
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const cols = clamp(v.barCount | 0, 12, 48);
      const lv = follow(this, audio.getBars(cols, v.minFreq, v.maxFreq, v.spectrum), cols, sensOf(v), dt, 9);
      ctx.clearRect(0, 0, W, H);
      const span = W * 0.9;
      const dx = span / cols; // sütun aralığı
      const R = dx / 1.5; // köşe yarıçapı: düz tepeli altıgenlerde sütun aralığı 1,5 R
      const hh = R * Math.sqrt(3); // hücre yüksekliği
      const rows = Math.max(4, Math.floor((H * 0.84) / hh));
      const x0 = (W - span) / 2 + dx / 2;
      const y1 = H * 0.92;
      const inset = 1 - clamp(v.gap == null ? 0.36 : v.gap, 0, 0.8) * 0.45;
      for (let c = 0; c < cols; c++) {
        const lit = lv[c] * rows;
        const col = tone(v, cfg, c / (cols - 1), t);
        const off = (c & 1) ? hh / 2 : 0;
        const cx = x0 + c * dx;
        for (let r = 0; r < rows; r++) {
          const cy = y1 - r * hh - hh / 2 - off;
          if (cy < H * 0.04) break;
          const on = clamp(lit - r, 0, 1);
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * TAU;
            const px = cx + Math.cos(a) * R * inset;
            const py = cy + Math.sin(a) * R * inset;
            if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fillStyle = rgba(col, 0.07 + on * 0.88);
          ctx.fill();
        }
      }
      this.glow.apply(this.canvas, v.glow, 0.7);
    }
    dispose() { this.lv = null; }
  }

  // ==========================================================================
  // NEON HALKALAR — iç içe halkalar; her halka bir bant, yay uzunluğu seviye
  // ==========================================================================
  class NeonRings {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.rot = 0;
    }
    resize() {}
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const n = clamp((v.barCount | 0) >> 2, 6, 18);
      const lv = follow(this, audio.getBars(n, v.minFreq, v.maxFreq, v.spectrum), n, sensOf(v), dt, 7);
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2;
      const cy = H / 2;
      const rMax = Math.min(W, H) * 0.44;
      const rMin = rMax * 0.16;
      const step = (rMax - rMin) / n;
      const bass = clamp(audio.bass * sensOf(v), 0, 1.3);
      this.rot += (dt || 0.016) * (0.25 + bass * 0.9);
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, step * (0.25 + thickOf(v) * 0.5));
      for (let i = 0; i < n; i++) {
        const r = rMin + step * (i + 0.5) + bass * step * 0.25;
        const col = tone(v, cfg, i / (n - 1), t);
        // Soluk tam halka: sessizken de biçim görünür
        ctx.strokeStyle = rgba(col, 0.12);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, TAU);
        ctx.stroke();
        // Parlak yay: uzunluğu seviye, komşu halkalar ters yöne döner
        const len = clamp(lv[i] * lv[i], 0.02, 1) * Math.PI * 0.62;
        const a0 = this.rot * ((i & 1) ? -1 : 1) * (1 + i * 0.07) + i * 0.7;
        ctx.strokeStyle = rgba(col, 0.95);
        ctx.beginPath();
        ctx.arc(cx, cy, r, a0 - len, a0 + len);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, r, a0 + Math.PI - len * 0.5, a0 + Math.PI + len * 0.5);
        ctx.stroke();
      }
      this.glow.apply(this.canvas, v.glow, 0.9);
    }
    dispose() { this.lv = null; }
  }

  // ==========================================================================
  // GÜNEŞ TACI — merkezden açılan dolgulu taç yaprakları, aynalı
  // ==========================================================================
  class Corona {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
    }
    resize() {}
    _ring(ctx, lv, n, cx, cy, r0, amp, rot) {
      // Tayf yarım daireye yayılır ve aynalanır: biçim kapalı ve simetrik kalır
      const total = n * 2;
      ctx.beginPath();
      for (let i = 0; i <= total; i++) {
        const k = i % total;
        const b = k < n ? k : total - 1 - k;
        const a = rot + (k / total) * TAU;
        // Kare: yüksek seviyeler ayrışır, taç düz bir daireye dönmez
        const r = r0 + lv[b] * lv[b] * amp;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const n = clamp(v.barCount | 0, 24, 96);
      const lv = follow(this, audio.getBars(n, v.minFreq, v.maxFreq, v.spectrum), n, sensOf(v), dt, 8);
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2;
      const cy = H / 2;
      const m = Math.min(W, H);
      const bass = clamp(audio.bass * sensOf(v), 0, 1.3);
      const r0 = m * (0.13 + bass * 0.025);
      const rot = -Math.PI / 2 + t * 0.05;
      ctx.lineJoin = 'round';
      // Üç katman: dıştaki geniş ve soluk, içteki dar ve parlak
      for (let L = 0; L < 3; L++) {
        const col = tone(v, cfg, L / 2, t);
        this._ring(ctx, lv, n, cx, cy, r0, m * (0.34 - L * 0.1), rot + L * 0.04);
        ctx.fillStyle = rgba(col, 0.2 + L * 0.2);
        ctx.fill();
        ctx.lineWidth = Math.max(1, m * 0.003 * (0.6 + thickOf(v) * 1.4));
        ctx.strokeStyle = rgba(col, 0.9);
        ctx.stroke();
      }
      // Ortadaki çekirdek: saydam, arkaplan görünür
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(cx, cy, r0 * 0.86, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = Math.max(1.5, m * 0.004);
      ctx.strokeStyle = rgba(tone(v, cfg, 1, t), 0.95);
      ctx.beginPath();
      ctx.arc(cx, cy, r0 * 0.86, 0, TAU);
      ctx.stroke();
      this.glow.apply(this.canvas, v.glow, 0.9);
    }
    dispose() { this.lv = null; }
  }

  // ==========================================================================
  // SARMAL TAYF — tayf, merkezden dışa açılan bir sarmalın üstündeki noktalar
  // ==========================================================================
  class SpiralSpectrum {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
    }
    resize() {}
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const n = clamp(v.barCount | 0, 48, 160);
      const lv = follow(this, audio.getBars(n, v.minFreq, v.maxFreq, v.spectrum), n, sensOf(v), dt, 9);
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2;
      const cy = H / 2;
      const rMax = Math.min(W, H) * 0.45;
      const turns = 3.25;
      const spin = t * 0.18;
      const base = Math.min(W, H) * (0.004 + thickOf(v) * 0.006);
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        // Karekök: noktalar sarmal boyunca eşit aralıklı durur (merkezde yığılmaz)
        const r = rMax * (0.1 + 0.9 * Math.sqrt(f));
        const a = spin + Math.sqrt(f) * turns * TAU;
        const val = lv[i];
        const rad = base * (0.7 + val * 4.2);
        ctx.fillStyle = rgba(tone(v, cfg, f, t), 0.35 + Math.min(0.65, val * 0.8));
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rad, 0, TAU);
        ctx.fill();
      }
      this.glow.apply(this.canvas, v.glow, 0.9);
    }
    dispose() { this.lv = null; }
  }

  // ==========================================================================
  // NOKTA DALGASI — perspektifli nokta örtüsü; tayf geçmişi derinliğe akar
  // ==========================================================================
  const DW_ROWS = 28;
  const DW_RATE = 1 / 30;
  class DotWave {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.rows = null;
      this.n = 0;
      this.head = 0;
      this.acc = 0;
      this.cols = [];
    }
    resize() {}
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const n = clamp(v.barCount | 0, 24, 72);
      if (!this.rows || this.n !== n) {
        this.rows = new Float32Array(DW_ROWS * n);
        this.n = n;
        this.head = 0;
      }
      const sens = sensOf(v);
      const bars = audio.getBars(n, v.minFreq, v.maxFreq, v.spectrum);
      this.acc += Math.min(0.1, dt || 0.016);
      // Sabit hızda satır: kare hızı değişse de dalganın akışı aynı
      while (this.acc >= DW_RATE) {
        this.acc -= DW_RATE;
        this.head = (this.head + 1) % DW_ROWS;
      }
      const o = this.head * n;
      for (let i = 0; i < n; i++) this.rows[o + i] = clamp(bars[i] * sens, 0, 1.3);
      for (let k = 0; k < 8; k++) this.cols[k] = tone(v, cfg, k / 7, t);

      ctx.clearRect(0, 0, W, H);
      const horizon = H * 0.3;
      const near = H * 0.95;
      const dot = Math.min(W, H) * (0.0022 + thickOf(v) * 0.003);
      // Uzaktan yakına: öndeki nokta arkadakinin üstüne çizilir
      for (let r = DW_ROWS - 1; r >= 0; r--) {
        const z = r / (DW_ROWS - 1); // 0 yakın, 1 uzak
        const p = 1 / (1 + z * 2.4); // perspektif ölçeği
        const y0 = horizon + (near - horizon) * p * p * 1.02;
        const half = W * 0.62 * p;
        const row = ((this.head - r) % DW_ROWS + DW_ROWS) % DW_ROWS;
        const base = row * n;
        const lift = H * 0.3 * p;
        const alpha = 0.25 + 0.75 * p;
        for (let i = 0; i < n; i++) {
          const f = i / (n - 1);
          const val = this.rows[base + i];
          ctx.fillStyle = rgba(this.cols[Math.min(7, (f * 8) | 0)], alpha * (0.4 + Math.min(0.6, val)));
          const s = dot * p * (1 + val * 2.2);
          ctx.fillRect(W / 2 + (f - 0.5) * 2 * half - s, y0 - val * lift - s, s * 2, s * 2);
        }
      }
      this.glow.apply(this.canvas, v.glow, 0.7);
    }
    dispose() { this.rows = null; this.n = 0; }
  }

  // ==========================================================================
  // YILDIZ SIÇRAMASI — merkezden dışa akan yıldız çizgileri; bas hızı artırır
  // ==========================================================================
  const WARP_N = 320;
  class WarpStars {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.rand = rng(0x57a2);
      this.ang = new Float32Array(WARP_N);
      this.z = new Float32Array(WARP_N);
      this.hue = new Float32Array(WARP_N);
      for (let i = 0; i < WARP_N; i++) this._spawn(i, true);
      this.speed = 0.2;
    }
    _spawn(i, anywhere) {
      this.ang[i] = this.rand() * TAU;
      // z: 1 uzak (merkezde), 0 yakın (kenarda)
      this.z[i] = anywhere ? 0.05 + this.rand() * 0.95 : 0.85 + this.rand() * 0.15;
      this.hue[i] = this.rand();
    }
    resize() {}
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const d = Math.min(0.05, dt || 0.016);
      const sens = sensOf(v);
      const bass = clamp(audio.bass * sens, 0, 1.4);
      const level = clamp(audio.level * sens, 0, 1.4);
      // Hız basla sıçrar, yavaşça iner
      const want = 0.12 + level * 0.35 + bass * bass * 1.1;
      this.speed += (want - this.speed) * Math.min(1, d * (want > this.speed ? 14 : 2.5));
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2;
      const cy = H / 2;
      const reach = Math.hypot(W, H) * 0.56;
      ctx.lineCap = 'round';
      const lw = Math.min(W, H) * (0.0012 + thickOf(v) * 0.0028);
      for (let i = 0; i < WARP_N; i++) {
        const z0 = this.z[i];
        const z1 = z0 - this.speed * d * (0.35 + (1 - z0) * 1.4);
        if (z1 <= 0.02) { this._spawn(i, false); continue; }
        this.z[i] = z1;
        const r0 = reach * (1 / z0 - 1) * 0.09;
        const r1 = reach * (1 / z1 - 1) * 0.09;
        if (r0 > reach) { this._spawn(i, false); continue; }
        const ca = Math.cos(this.ang[i]);
        const sa = Math.sin(this.ang[i]);
        const near = 1 - z1;
        ctx.strokeStyle = rgba(tone(v, cfg, this.hue[i], t), 0.25 + near * 0.75);
        ctx.lineWidth = lw * (0.5 + near * 2.4);
        ctx.beginPath();
        // Çizginin boyu hızla uzar: yavaşken nokta, hızlıyken iz
        const tail = r0 - (r1 - r0) * (1 + this.speed * 4);
        ctx.moveTo(cx + ca * Math.max(0, tail), cy + sa * Math.max(0, tail));
        ctx.lineTo(cx + ca * r1, cy + sa * r1);
        ctx.stroke();
      }
      this.glow.apply(this.canvas, v.glow, 0.9);
    }
    dispose() {}
  }

  // ==========================================================================
  // YÖRÜNGELER — her bant bir yörünge; gezegenin boyu ve kuyruğu seviyeyle büyür
  // ==========================================================================
  class Orbitals {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.phase = new Float32Array(16);
      const r = rng(0x0b17);
      for (let i = 0; i < 16; i++) this.phase[i] = r() * TAU;
    }
    resize() {}
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const n = clamp((v.barCount | 0) >> 3, 5, 12);
      const lv = follow(this, audio.getBars(n, v.minFreq, v.maxFreq, v.spectrum), n, sensOf(v), dt, 6);
      const d = Math.min(0.05, dt || 0.016);
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2;
      const cy = H / 2;
      const m = Math.min(W, H);
      const rMax = m * 0.62;
      const tilt = 0.46; // yörüngeler eğik bakılan elipsler
      ctx.lineCap = 'round';
      // Merkezdeki yıldız
      const bass = clamp(audio.bass * sensOf(v), 0, 1.3);
      const core = tone(v, cfg, 0, t);
      const cr = m * (0.03 + bass * 0.02);
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr * 2.6);
      cg.addColorStop(0, rgba(core, 0.95));
      cg.addColorStop(0.4, rgba(core, 0.45));
      cg.addColorStop(1, rgba(core, 0));
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(cx, cy, cr * 2.6, 0, TAU);
      ctx.fill();
      for (let i = 0; i < n; i++) {
        const f = (i + 1) / n;
        const rx = rMax * (0.2 + 0.8 * f);
        const ry = rx * tilt;
        const col = tone(v, cfg, f, t);
        const val = lv[i];
        // İçteki yörünge hızlı döner (Kepler); seviye hızı artırır
        this.phase[i] += d * (0.25 + val * 1.8) / Math.pow(f, 0.9);
        const a = this.phase[i];
        ctx.lineWidth = Math.max(1, m * 0.0014);
        ctx.strokeStyle = rgba(col, 0.16);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
        ctx.stroke();
        // Kuyruk: gezegenin ardındaki yay
        const tail = 0.25 + val * 1.5;
        ctx.lineWidth = Math.max(1.5, m * (0.003 + thickOf(v) * 0.004));
        ctx.strokeStyle = rgba(col, 0.6);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, a - tail, a);
        ctx.stroke();
        ctx.fillStyle = rgba(col, 1);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, m * (0.009 + val * 0.016), 0, TAU);
        ctx.fill();
      }
      this.glow.apply(this.canvas, v.glow, 0.9);
    }
    dispose() { this.lv = null; }
  }

  window.SVModes = window.SVModes || {};
  Object.assign(window.SVModes, {
    liquidspectrum: LiquidSpectrum,
    capsules: Capsules,
    stagebars: StageBars,
    hexspectrum: HexSpectrum,
    neonrings: NeonRings,
    corona: Corona,
    spiralspectrum: SpiralSpectrum,
    dotwave: DotWave,
    warpstars: WarpStars,
    orbitals: Orbitals,
  });
})();
