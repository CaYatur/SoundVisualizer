/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Arkaplanların beşinci bölümü (#905): yazının ve logonun arkasında durabilecek sade zeminler
   (renk bulutu, ipek, kağıt, nokta deseni, şeritler) ile manzaralar (gün batımı, kum tepeleri,
   gece göğü).

   backgrounds.js ile aynı sözleşme:
     draw(ctx, audio, cfg, t, W, H, dt)  — verilen 2D bağlama çizer
     palette(cfg)                        — Dynamic Lighting için renk listesi

   Her arkaplanın kendi ayarları katalogda (shared/mode-catalog.js, `settings`), varsayılanları
   defaults.js'te. Buradaki mset() yedekleri o varsayılanlarla aynı olmak ZORUNDA;
   tests/mode-catalog.test.js karşılaştırıyor.

   Piksel başına hesaplayan zemin küçük bir tamponda çizip büyütür; kare başına tampon ya da
   dizi üretilmez. Rastgelelik tohumlu: dışa aktarım kare kare tekrarlanabilir. */
(function () {
  const U = window.SVBgUtil;
  const { rgba, lerpColor, gset, mset, rng, vignette, basePalette } = U;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const dark = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  const css = (c, a) => rgba([c[0] | 0, c[1] | 0, c[2] | 0], a == null ? 1 : a);

  // ============================== RENK BULUTU ==============================
  // Yavaşça gezen büyük renk lekeleri: yumuşak, sade bir "mesh gradient" zemini
  class ColorCloud {
    constructor() {
      const r = rng(0xc10d);
      this.seed = [];
      for (let i = 0; i < 8; i++) this.seed.push([r() * TAU, r() * TAU, 0.4 + r() * 0.7, 0.4 + r() * 0.7]);
      this.buf = null;
      this.cols = [];
      this.px = new Float32Array(8);
      this.py = new Float32Array(8);
    }
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'colorcloud', { blobs: 5, size: 1, drift: 1, contrast: 1, bassPush: 1 });
      const w = 64;
      const h = Math.max(8, Math.round(64 * H / W));
      if (!this.buf || this.buf.height !== h) {
        this.buf = document.createElement('canvas');
        this.buf.width = w;
        this.buf.height = h;
        this.bctx = this.buf.getContext('2d');
        this.img = this.bctx.createImageData(w, h);
      }
      const n = clamp(Math.round(m.blobs), 2, 8);
      const T = t * g.speed * 0.22 * m.drift;
      const bass = audio.bass * g.react * m.bassPush;
      for (let i = 0; i < n; i++) {
        const s = this.seed[i];
        this.px[i] = 0.5 + 0.42 * Math.sin(T * s[2] + s[0]);
        this.py[i] = 0.5 + 0.42 * Math.cos(T * s[3] + s[1]);
        this.cols[i] = lerpColor(cfg, n === 1 ? 0.5 : i / (n - 1));
      }
      const d = this.img.data;
      const fall = 13 / (m.size * m.size * (1 + bass * 0.25));
      const lo = 0.5 - 0.5 * m.contrast;
      for (let y = 0; y < h; y++) {
        const fy = y / (h - 1);
        for (let x = 0; x < w; x++) {
          const fx = x / (w - 1);
          let r = 0; let gg = 0; let b = 0; let sum = 0;
          for (let i = 0; i < n; i++) {
            const dx = fx - this.px[i];
            const dy = fy - this.py[i];
            const wgt = Math.exp(-(dx * dx + dy * dy) * fall);
            const c = this.cols[i];
            r += c[0] * wgt; gg += c[1] * wgt; b += c[2] * wgt; sum += wgt;
          }
          // Ağırlıklı ortalama renk; parlaklık lekelerin yoğunluğundan
          const lum = clamp(lo + (1 - lo) * Math.min(1, sum * 0.9), 0.08, 1) / (sum || 1);
          const o = (y * w + x) * 4;
          d[o] = r * lum; d[o + 1] = gg * lum; d[o + 2] = b * lum; d[o + 3] = 255;
        }
      }
      this.bctx.putImageData(this.img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // Parlaklık siyah zeminin üstünde saydamlıkla: 1'in üstü tam parlak
      ctx.fillStyle = 'rgb(0,0,0)';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = clamp(g.bright, 0, 1);
      ctx.drawImage(this.buf, 0, 0, W, H);
      ctx.globalAlpha = 1;
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ================================= İPEK =================================
  // Üst üste binen, yavaşça dalgalanan kumaş kıvrımları; her kıvrım kendi gölgesiyle
  class Silk {
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'silk', { folds: 7, amplitude: 1, flow: 1, sheen: 0.6, bassPush: 1 });
      const n = clamp(Math.round(m.folds), 3, 14);
      const T = t * g.speed * 0.5 * m.flow;
      const bass = audio.bass * g.react * m.bassPush;
      ctx.fillStyle = css(dark(lerpColor(cfg, 0), 0.22 * g.bright));
      ctx.fillRect(0, 0, W, H);
      const amp = H * 0.09 * m.amplitude * (1 + bass * 0.35);
      const steps = 48;
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        const y0 = H * (-0.05 + 1.15 * f);
        const col = lerpColor(cfg, f);
        const top = dark(col, (0.55 + 0.45 * Math.sin(f * 5 + T * 0.4) * 0.5 + 0.25) * g.bright);
        const grad = ctx.createLinearGradient(0, y0 - amp, 0, y0 + H * 0.3);
        grad.addColorStop(0, css(mix(top, [255, 255, 255], 0.22 * m.sheen)));
        grad.addColorStop(0.18, css(top));
        grad.addColorStop(1, css(dark(top, 0.35)));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let s = 0; s <= steps; s++) {
          const x = s / steps;
          const y = y0
            + Math.sin(x * 3.1 + T + i * 1.3) * amp
            + Math.sin(x * 7.3 - T * 0.7 + i * 2.1) * amp * 0.35;
          ctx.lineTo(x * W, y);
        }
        ctx.lineTo(W, H);
        ctx.closePath();
        ctx.fill();
      }
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================= NEON GÜN BATIMI =============================
  // Çizgili güneş, ufuk parıltısı, dağ silueti ve suya düşen yansıma
  class Sunset {
    constructor() {
      const r = rng(0x5e75);
      this.ridge = new Float32Array(65);
      let y = 0.5;
      for (let i = 0; i < 65; i++) {
        y = clamp(y + (r() - 0.5) * 0.28, 0.1, 1);
        this.ridge[i] = y;
      }
    }
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'sunset', { sun: 1, stripes: 6, mountains: 1, haze: 0.6, bassPush: 1 });
      const bass = audio.bass * g.react * m.bassPush;
      const hz = H * 0.62;
      const c0 = lerpColor(cfg, 0);
      const c1 = lerpColor(cfg, 0.5);
      const c2 = lerpColor(cfg, 1);
      const b = g.bright;
      // Gök: üstte koyu, ufukta parlak
      const sky = ctx.createLinearGradient(0, 0, 0, hz);
      sky.addColorStop(0, css(dark(c0, 0.12 * b)));
      sky.addColorStop(0.6, css(dark(c0, 0.45 * b)));
      sky.addColorStop(1, css(dark(mix(c1, c2, 0.5), (0.7 + m.haze * 0.3) * b)));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, hz);
      // Güneş: aşağıya doğru kalınlaşan boşluklarla dilimlenmiş disk
      const R = Math.min(W, H) * 0.24 * m.sun * (1 + bass * 0.06);
      const cx = W / 2;
      const cy = hz - R * 0.28;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, hz);
      ctx.clip();
      const halo = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 2.3);
      halo.addColorStop(0, css(c2, 0.5 * m.haze * b));
      halo.addColorStop(1, css(c2, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, W, hz);
      const sun = ctx.createLinearGradient(0, cy - R, 0, cy + R);
      sun.addColorStop(0, css(mix(c2, [255, 255, 255], 0.35), b > 1 ? 1 : b));
      sun.addColorStop(1, css(c1, b > 1 ? 1 : b));
      ctx.fillStyle = sun;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.fill();
      const ns = clamp(Math.round(m.stripes), 0, 12);
      if (ns) {
        ctx.globalCompositeOperation = 'destination-out';
        const drift = (t * g.speed * 0.12) % 1;
        for (let i = 0; i < ns; i++) {
          const f = ((i + drift) / ns);
          const y = cy - R * 0.1 + f * R * 1.1;
          ctx.fillRect(cx - R, y, R * 2, Math.max(1, R * 0.02 + f * R * 0.07));
        }
        ctx.globalCompositeOperation = 'source-over';
        // Dilimlerin arkasında gök rengi kalsın
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = css(dark(mix(c1, c2, 0.5), 0.55 * b));
        ctx.fillRect(0, 0, W, hz);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
      // Dağlar
      if (m.mountains > 0.01) {
        ctx.fillStyle = css(dark(c0, 0.1 * b));
        ctx.beginPath();
        ctx.moveTo(0, hz);
        for (let i = 0; i <= 64; i++) ctx.lineTo((i / 64) * W, hz - this.ridge[i] * H * 0.13 * m.mountains * (0.4 + Math.abs(i / 64 - 0.5) * 1.6));
        ctx.lineTo(W, hz);
        ctx.closePath();
        ctx.fill();
      }
      // Su: koyu zemin, güneşin kırık yansıması
      const sea = ctx.createLinearGradient(0, hz, 0, H);
      sea.addColorStop(0, css(dark(mix(c1, c0, 0.5), 0.5 * b)));
      sea.addColorStop(1, css(dark(c0, 0.08 * b)));
      ctx.fillStyle = sea;
      ctx.fillRect(0, hz, W, H - hz);
      const rows = 22;
      for (let i = 0; i < rows; i++) {
        const f = (i + 0.5) / rows;
        const y = hz + f * f * (H - hz);
        const wob = Math.sin(t * g.speed * 1.6 + i * 1.7) * R * 0.12 * (0.4 + f);
        const half = R * (0.85 - f * 0.45) * (1 + bass * 0.12);
        ctx.fillStyle = css(mix(c2, c1, f), (0.5 - f * 0.4) * (b > 1 ? 1 : b));
        ctx.fillRect(cx - half + wob, y, half * 2, Math.max(1, (H - hz) * 0.012 * (0.5 + f * 1.5)));
      }
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================== KUM TEPELERİ ==============================
  // Katman katman uzaklaşan tepeler; uzaktakiler puslu, yakındakiler koyu
  class Dunes {
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'dunes', { layers: 6, height: 1, drift: 1, haze: 0.6, bassPush: 1 });
      const n = clamp(Math.round(m.layers), 3, 10);
      const b = g.bright;
      const far = lerpColor(cfg, 1);
      const near = lerpColor(cfg, 0);
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, css(dark(mix(far, [255, 255, 255], 0.15), 0.85 * b)));
      sky.addColorStop(1, css(dark(mix(far, near, 0.35), 0.75 * b)));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);
      // Alçak bir güneş
      const sx = W * 0.72;
      const sy = H * 0.3;
      const sr = Math.min(W, H) * 0.07;
      const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 4);
      sg.addColorStop(0, css(mix(far, [255, 255, 255], 0.7), 0.9 * (b > 1 ? 1 : b)));
      sg.addColorStop(0.25, css(mix(far, [255, 255, 255], 0.5), 0.45 * m.haze));
      sg.addColorStop(1, css(far, 0));
      ctx.fillStyle = sg;
      ctx.fillRect(0, 0, W, H);
      const bass = audio.bass * g.react * m.bassPush;
      const T = t * g.speed * 0.06 * m.drift;
      const steps = 56;
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1); // 0 uzak, 1 yakın
        const y0 = H * (0.42 + 0.5 * f);
        const amp = H * (0.035 + 0.075 * f) * m.height * (1 + bass * 0.12 * f);
        // Uzak tepeler göğe karışır (pus), yakınlar koyulaşır
        const col = dark(mix(mix(far, near, f), far, (1 - f) * m.haze * 0.5), (0.8 - 0.62 * f) * b);
        ctx.fillStyle = css(col);
        ctx.beginPath();
        ctx.moveTo(0, H);
        const shift = T * (0.4 + f * 2.2) + i * 9.7;
        for (let s = 0; s <= steps; s++) {
          const x = s / steps;
          const u = x * (1.6 + f * 1.4) + shift;
          const y = y0 - (Math.sin(u * 2.1) * 0.55 + Math.sin(u * 4.7 + 1.3) * 0.25 + Math.sin(u * 0.9 + 4) * 0.4) * amp;
          ctx.lineTo(x * W, y);
        }
        ctx.lineTo(W, H);
        ctx.closePath();
        ctx.fill();
      }
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // =============================== GECE GÖĞÜ ===============================
  // Göz kırpan yıldızlar, soluk bir samanyolu şeridi ve vuruşta kayan yıldız
  const SKY_STARS = 420;
  class NightSky {
    constructor() {
      const r = rng(0x51a7);
      this.x = new Float32Array(SKY_STARS);
      this.y = new Float32Array(SKY_STARS);
      this.s = new Float32Array(SKY_STARS);
      this.p = new Float32Array(SKY_STARS);
      for (let i = 0; i < SKY_STARS; i++) {
        this.x[i] = r();
        // Yarısı şeridin çevresinde toplanır
        this.y[i] = i & 1 ? r() : clamp(0.5 + (r() + r() + r() - 1.5) * 0.3, 0, 1);
        this.s[i] = 0.3 + r() * r() * 1.7;
        this.p[i] = r() * TAU;
      }
      this.rand = rng(0x0a17);
      this.shoot = -1;
      this.sx = 0; this.sy = 0; this.sa = 0;
      this.prevBass = 0;
    }
    draw(ctx, audio, cfg, t, W, H, dt) {
      const g = gset(cfg);
      const m = mset(cfg, 'nightsky', { stars: 260, twinkle: 1, milky: 0.6, shooting: 1, bassPush: 1 });
      const b = g.bright;
      const c0 = lerpColor(cfg, 0);
      const c1 = lerpColor(cfg, 0.6);
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, css(dark(c0, 0.05 * b)));
      sky.addColorStop(1, css(dark(c1, 0.3 * b)));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);
      // Samanyolu: eğik, yumuşak bir ışık şeridi
      if (m.milky > 0.01) {
        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.rotate(-0.42);
        const band = ctx.createLinearGradient(0, -H * 0.28, 0, H * 0.28);
        band.addColorStop(0, css(c1, 0));
        band.addColorStop(0.5, css(mix(c1, [255, 255, 255], 0.3), 0.2 * m.milky * b));
        band.addColorStop(1, css(c1, 0));
        ctx.fillStyle = band;
        ctx.fillRect(-W, -H * 0.28, W * 2, H * 0.56);
        ctx.restore();
      }
      const n = clamp(Math.round(m.stars), 40, SKY_STARS);
      const level = audio.level * g.react;
      const unit = Math.min(W, H) * 0.0016;
      const T = t * (0.6 + g.speed) * m.twinkle;
      const ca = Math.cos(-0.42);
      const sa = Math.sin(-0.42);
      for (let i = 0; i < n; i++) {
        let x = this.x[i];
        let y = this.y[i];
        if (!(i & 1)) {
          // Şerit yıldızları şeritle aynı açıda
          const dx = (x - 0.5) * 1.5;
          const dy = y - 0.5;
          x = 0.5 + dx * ca - dy * sa * (H / W);
          y = 0.5 + dx * sa * (W / H) + dy * ca;
        }
        const tw = 0.55 + 0.45 * Math.sin(T * (0.7 + this.s[i]) + this.p[i]);
        const a = clamp((0.25 + tw * 0.75) * (0.7 + level * 0.6), 0, 1);
        const r = unit * this.s[i] * (0.8 + tw * 0.4);
        ctx.fillStyle = css(mix([255, 255, 255], lerpColor(cfg, (i % 7) / 6), 0.3), a * (b > 1 ? 1 : b));
        ctx.fillRect(x * W - r, y * H - r, r * 2, r * 2);
      }
      // Kayan yıldız: güçlü bas vuruşunda, aynı anda yalnız bir tane
      const bass = audio.bass * g.react * m.bassPush;
      if (this.shoot < 0 && m.shooting > 0.01 && bass > 0.55 && bass - this.prevBass > 0.12 / m.shooting) {
        this.shoot = 0;
        this.sx = 0.15 + this.rand() * 0.7;
        this.sy = 0.05 + this.rand() * 0.35;
        this.sa = 0.35 + this.rand() * 0.5;
      }
      this.prevBass = bass;
      if (this.shoot >= 0) {
        this.shoot += (dt || 0.016) * 1.6;
        const k = this.shoot;
        if (k >= 1) this.shoot = -1;
        else {
          const len = Math.min(W, H) * 0.26;
          const hx = this.sx * W + Math.cos(this.sa) * len * k * 2;
          const hy = this.sy * H + Math.sin(this.sa) * len * k * 2;
          const tr = ctx.createLinearGradient(hx, hy, hx - Math.cos(this.sa) * len, hy - Math.sin(this.sa) * len);
          tr.addColorStop(0, 'rgba(255,255,255,' + (1 - k).toFixed(3) + ')');
          tr.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.strokeStyle = tr;
          ctx.lineWidth = Math.max(1, unit * 1.6);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(hx, hy);
          ctx.lineTo(hx - Math.cos(this.sa) * len, hy - Math.sin(this.sa) * len);
          ctx.stroke();
        }
      }
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================= ÇAPRAZ ŞERİTLER =============================
  // Kayan eğik renk şeritleri: kısa video ve duyuru için sert, grafik bir zemin
  class Stripes {
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'stripes', { count: 9, angle: 0.62, speed: 1, softness: 0.15, bassPush: 1 });
      const n = clamp(Math.round(m.count), 2, 24);
      const b = g.bright;
      const ang = (m.angle - 0.5) * Math.PI * 0.9;
      const diag = Math.hypot(W, H);
      const bw = diag / n;
      const bass = audio.bass * g.react * m.bassPush;
      const shift = ((t * g.speed * 0.12 * m.speed) % 1 + 1) % 1;
      ctx.fillStyle = css(dark(lerpColor(cfg, 0), 0.25 * b));
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(ang);
      for (let i = -1; i <= n; i++) {
        const idx = ((i % n) + n) % n;
        const f = n === 1 ? 0.5 : idx / (n - 1);
        // Sıra dışı şeritler basla genişler
        const grow = (idx & 1) ? 1 + bass * 0.25 : 1 - bass * 0.12;
        const x = -diag / 2 + (i + shift) * bw;
        const col = dark(lerpColor(cfg, f), (0.55 + 0.45 * ((idx & 1) ? 1 : 0.6)) * b);
        if (m.softness > 0.01) {
          const gr = ctx.createLinearGradient(x, 0, x + bw * grow, 0);
          gr.addColorStop(0, css(dark(col, 1 - m.softness * 0.7)));
          gr.addColorStop(0.5, css(col));
          gr.addColorStop(1, css(dark(col, 1 - m.softness * 0.7)));
          ctx.fillStyle = gr;
        } else ctx.fillStyle = css(col);
        ctx.fillRect(x, -diag / 2, bw * grow + 1, diag);
      }
      ctx.restore();
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================== NOKTA DESENİ ==============================
  // Düzenli nokta ızgarası; merkezden yayılan dalga noktaları büyütür
  class DotGrid {
    constructor() { this.cols = []; }
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'dotgrid', { cells: 26, size: 0.55, wave: 1, speed: 1, bassPush: 1.2 });
      const b = g.bright;
      ctx.fillStyle = css(dark(lerpColor(cfg, 0), 0.14 * b));
      ctx.fillRect(0, 0, W, H);
      const nx = clamp(Math.round(m.cells), 8, 60);
      const cell = W / nx;
      const ny = Math.ceil(H / cell) + 1;
      const y0 = (H - (ny - 1) * cell) / 2;
      const bass = audio.bass * g.react * m.bassPush;
      const T = t * (0.5 + g.speed) * 1.6 * m.speed;
      for (let k = 0; k < 12; k++) this.cols[k] = lerpColor(cfg, k / 11);
      const maxR = cell * 0.5 * m.size;
      const cx = W / 2;
      const cy = H / 2;
      const norm = 1 / Math.hypot(cx, cy);
      for (let j = 0; j < ny; j++) {
        const y = y0 + j * cell;
        for (let i = 0; i < nx; i++) {
          const x = (i + 0.5) * cell;
          const d = Math.hypot(x - cx, y - cy) * norm;
          const wv = 0.5 + 0.5 * Math.sin(d * 9 * m.wave - T);
          const r = maxR * (0.18 + 0.82 * wv * (0.55 + bass * 0.55));
          if (r < 0.4) continue;
          ctx.fillStyle = css(dark(this.cols[Math.min(11, (d * 12) | 0)], (0.35 + wv * 0.65) * b));
          ctx.beginPath();
          ctx.arc(x, y, Math.min(r, cell * 0.5), 0, TAU);
          ctx.fill();
        }
      }
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================= KAĞIT KATMANLARI =============================
  // Üst üste kesilmiş kağıtlar: her katmanın altında yumuşak bir gölge
  class PaperCut {
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'papercut', { layers: 6, relief: 1, sway: 1, shadow: 0.6, bassPush: 1 });
      const n = clamp(Math.round(m.layers), 3, 10);
      const b = g.bright;
      ctx.fillStyle = css(dark(lerpColor(cfg, 1), 0.9 * b));
      ctx.fillRect(0, 0, W, H);
      const bass = audio.bass * g.react * m.bassPush;
      const T = t * g.speed * 0.35 * m.sway;
      const steps = 40;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,' + clamp(0.55 * m.shadow, 0, 0.9).toFixed(3) + ')';
      ctx.shadowBlur = Math.min(W, H) * 0.03 * m.shadow;
      ctx.shadowOffsetY = -Math.min(W, H) * 0.008 * m.shadow;
      for (let i = 0; i < n; i++) {
        const f = (i + 1) / n; // 1 en öndeki
        const y0 = H * (0.2 + 0.72 * f);
        const amp = H * 0.07 * m.relief * (1 + bass * 0.2);
        ctx.fillStyle = css(dark(lerpColor(cfg, 1 - f), (0.95 - 0.5 * f) * b));
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let s = 0; s <= steps; s++) {
          const x = s / steps;
          const y = y0
            + Math.sin(x * (2.2 + i * 0.6) + T * (0.6 + i * 0.15) + i * 2.4) * amp
            + Math.sin(x * (5.1 + i) - T * 0.4 + i) * amp * 0.3;
          ctx.lineTo(x * W, y);
        }
        ctx.lineTo(W, H);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  Object.assign(window.SVBackgrounds, {
    colorcloud: ColorCloud,
    silk: Silk,
    sunset: Sunset,
    dunes: Dunes,
    nightsky: NightSky,
    stripes: Stripes,
    dotgrid: DotGrid,
    papercut: PaperCut,
  });
})();
