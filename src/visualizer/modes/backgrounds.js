'use strict';
/* 2D arkaplan modları.

   Sözleşme (WebGL gradyandan farklı, kasten daha basit):
     draw(ctx, audio, cfg, t, W, H, dt)  — verilen 2D bağlama çizer
     palette(cfg)                        — Dynamic Lighting için renk listesi

   Bağlamı dışarıdan almaları önemli: görselleştirici ve panel önizlemesi kendi
   arkaplan tuvaline çizerken, çevrimdışı video dışa aktarıcı doğrudan birleştirme
   tuvaline çiziyor. Aynı sınıf üçünde de çalışıyor.

   Renkler ve ortak alanlar background.gradient'ten okunur (renk seçiciler ve
   şablonlar tüm modlarda geçerli kalsın diye); moda özel ayarlar ise
   background.<mod> altındadır. */
(function () {
  // ---- ortak yardımcılar ----
  function colorsOf(cfg) {
    const c = (cfg.background && cfg.background.gradient && cfg.background.gradient.colors) || [];
    return c.length ? c : ['#5b4be0', '#3aa6ff', '#37e0c8', '#7be07b', '#d24bff'];
  }
  function rgbOf(cfg, i) {
    const cols = colorsOf(cfg);
    const c = window.SV.hexToRgb01(cols[((i % cols.length) + cols.length) % cols.length]);
    return [(c[0] * 255) | 0, (c[1] * 255) | 0, (c[2] * 255) | 0];
  }
  function rgba(c, a) {
    return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  }
  // Palet üzerinde 0..1 konumundan renk (yumuşak geçiş)
  function lerpColor(cfg, pos) {
    const cols = colorsOf(cfg);
    const x = Math.max(0, Math.min(0.9999, pos)) * (cols.length - 1);
    const i = Math.floor(x);
    const f = x - i;
    const a = window.SV.hexToRgb01(cols[i]);
    const b = window.SV.hexToRgb01(cols[Math.min(cols.length - 1, i + 1)]);
    return [
      ((a[0] + (b[0] - a[0]) * f) * 255) | 0,
      ((a[1] + (b[1] - a[1]) * f) * 255) | 0,
      ((a[2] + (b[2] - a[2]) * f) * 255) | 0,
    ];
  }
  function gset(cfg) {
    const g = (cfg.background && cfg.background.gradient) || {};
    return {
      speed: g.speed == null ? 0.45 : g.speed,
      react: g.audioReactivity == null ? 0.85 : g.audioReactivity,
      bright: g.brightness == null ? 1 : g.brightness,
      vignette: g.vignette == null ? 0.25 : g.vignette,
    };
  }
  // Moda özel ayar bloğu (eksik alanlar varsayılanla tamamlanır)
  function mset(cfg, mode, fallback) {
    const m = (cfg.background && cfg.background[mode]) || {};
    const out = {};
    for (const k in fallback) out[k] = m[k] == null ? fallback[k] : m[k];
    return out;
  }
  // Deterministik sözde-rastgele (aynı seed -> aynı sahne; dışa aktarım için şart)
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }
  function vignette(ctx, W, H, amount) {
    if (amount <= 0.001) return;
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${Math.min(0.92, amount)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  const basePalette = (cfg) => colorsOf(cfg).slice();

  // ============================ YILDIZ ALANI ============================
  class Starfield {
    constructor() {
      this.n = 0;
      this.x = null; this.y = null; this.z = null; this.c = null; this.tw = null;
      // Yeniden doğuşlar da tohumlu üreteçten gelir; Math.random kullanılsaydı
      // çevrimdışı video dışa aktarımı deterministik olmazdı.
      this.rnd = rng(0xa17e);
    }
    _ensure(count) {
      if (this.n === count) return;
      this.n = count;
      this.x = new Float32Array(count);
      this.y = new Float32Array(count);
      this.z = new Float32Array(count);
      this.c = new Uint8Array(count);
      this.tw = new Float32Array(count);
      const r = rng(0x5eed);
      for (let i = 0; i < count; i++) {
        this.x[i] = r() * 2 - 1;
        this.y[i] = r() * 2 - 1;
        this.z[i] = r();
        this.c[i] = (r() * 5) | 0;
        this.tw[i] = r() * Math.PI * 2;
      }
    }
    draw(ctx, audio, cfg, t, W, H, dt) {
      const g = gset(cfg);
      const m = mset(cfg, 'starfield', { count: 340, depth: 1, size: 1, trail: 1, twinkle: 0.35, bassPush: 2.2 });
      this._ensure(Math.max(20, Math.min(1200, m.count | 0)));
      const step = Math.min(0.05, dt || 0.016);
      const speed = (0.16 + g.speed * 0.5) * (1 + audio.bass * g.react * m.bassPush);
      const cx = W / 2;
      const cy = H / 2;
      const scale = Math.min(W, H) * 0.9 * m.depth;

      ctx.fillStyle = '#04030a';
      ctx.fillRect(0, 0, W, H);

      for (let i = 0; i < this.n; i++) {
        this.z[i] -= step * speed;
        if (this.z[i] <= 0.02) {
          this.z[i] = 1;
          this.x[i] = this.rnd() * 2 - 1;
          this.y[i] = this.rnd() * 2 - 1;
        }
        const p = 1 / this.z[i];
        const px = cx + this.x[i] * p * scale * 0.5;
        const py = cy + this.y[i] * p * scale * 0.5;
        if (px < -50 || px > W + 50 || py < -50 || py > H + 50) continue;

        const near = 1 - this.z[i];
        const twinkle = 1 - m.twinkle * (0.5 + 0.5 * Math.sin(t * 3.1 + this.tw[i]));
        const size = Math.max(1.1, (0.25 + near * near) * Math.min(W, H) * 0.0085 * m.size);
        const col = rgbOf(cfg, this.c[i]);
        const a = Math.min(1, 0.35 + near * 1.3) * g.bright * twinkle;

        const trail = speed * 42 * near * near * m.trail;
        const dx = (px - cx) / (p * scale * 0.5 || 1);
        const dy = (py - cy) / (p * scale * 0.5 || 1);
        ctx.strokeStyle = rgba(col, a * 0.8);
        ctx.lineWidth = size;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - dx * trail, py - dy * trail);
        ctx.stroke();

        ctx.fillStyle = rgba([
          Math.min(255, col[0] + 90), Math.min(255, col[1] + 90), Math.min(255, col[2] + 90),
        ], a);
        ctx.beginPath();
        ctx.arc(px, py, size * 0.62, 0, Math.PI * 2);
        ctx.fill();
      }
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================ RETRO IZGARA ============================
  class RetroGrid {
    constructor() { this.scroll = 0; }
    draw(ctx, audio, cfg, t, W, H, dt) {
      const g = gset(cfg);
      const m = mset(cfg, 'grid', {
        horizon: 0.52, rows: 18, cols: 26, lineWidth: 1,
        horizonGlow: 0.55, skyIntensity: 0.95, spectrumBars: 1, bassPush: 1.6,
      });
      const horizon = H * Math.max(0.15, Math.min(0.85, m.horizon));
      const step = Math.min(0.05, dt || 0.016);
      this.scroll += step * (0.25 + g.speed * 0.85) * (1 + audio.bass * g.react * m.bassPush);
      this.scroll %= 1;

      const sky = ctx.createLinearGradient(0, 0, 0, horizon);
      sky.addColorStop(0, rgba(lerpColor(cfg, 0.95), m.skyIntensity * g.bright));
      sky.addColorStop(1, rgba(lerpColor(cfg, 0.35), m.skyIntensity * g.bright));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, horizon);

      ctx.fillStyle = '#07040f';
      ctx.fillRect(0, horizon, W, H - horizon);

      const glowR = Math.max(1, Math.min(W, H) * (0.14 + audio.bass * g.react * 0.16));
      const hg = ctx.createRadialGradient(W / 2, horizon, 0, W / 2, horizon, glowR * 3);
      const hc = lerpColor(cfg, 0.7);
      hg.addColorStop(0, rgba(hc, m.horizonGlow * g.bright));
      hg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = hg;
      ctx.fillRect(0, horizon - glowR * 3, W, glowR * 6);

      const lineCol = lerpColor(cfg, 0.55);
      const lw = Math.max(0.5, Math.min(W, H) * 0.0016 * m.lineWidth);
      ctx.strokeStyle = rgba(lineCol, 0.75 * g.bright);
      ctx.lineWidth = lw;

      const ROWS = Math.max(4, Math.min(60, m.rows | 0));
      ctx.beginPath();
      for (let i = 0; i < ROWS; i++) {
        const k = (i + this.scroll) / ROWS;
        const y = horizon + (H - horizon) * k * k;
        if (y > H + 2) continue;
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
      }
      ctx.stroke();

      const COLS = Math.max(4, Math.min(80, m.cols | 0));
      const bars = audio.getBars(COLS, 30, 16000);
      for (let i = 0; i <= COLS; i++) {
        const u = i / COLS - 0.5;
        const bx = W / 2 + u * W * 3.4;
        const amp = (bars && bars[Math.min(COLS - 1, i)] ? bars[Math.min(COLS - 1, i)] : 0) * m.spectrumBars;
        ctx.strokeStyle = rgba(lineCol, Math.min(1, (0.35 + amp * 0.6) * g.bright));
        ctx.beginPath();
        ctx.moveTo(W / 2, horizon);
        ctx.lineTo(bx, H);
        ctx.stroke();
      }
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================ DALGA KATMANLARI ============================
  class WaveLayers {
    constructor() { this.phase = 0; }
    draw(ctx, audio, cfg, t, W, H, dt) {
      const g = gset(cfg);
      const m = mset(cfg, 'waves', { layers: 6, amplitude: 1, frequency: 1, spread: 1, opacity: 1, bassPush: 1.1 });
      this.phase += Math.min(0.05, dt || 0.016) * (0.25 + g.speed * 0.9) * (1 + audio.level * g.react);

      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, rgba(lerpColor(cfg, 0.05), g.bright));
      bg.addColorStop(1, rgba(lerpColor(cfg, 0.45), g.bright * 0.85));
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const LAYERS = Math.max(1, Math.min(14, m.layers | 0));
      const pts = 90;
      for (let l = 0; l < LAYERS; l++) {
        const k = LAYERS === 1 ? 0 : l / (LAYERS - 1);
        const baseY = H * (0.42 + k * 0.62 * m.spread);
        const amp = H * (0.05 + k * 0.05) * m.amplitude * (1 + audio.bass * g.react * m.bassPush);
        const col = lerpColor(cfg, 0.35 + k * 0.6);
        ctx.fillStyle = rgba(col, Math.min(1, (0.30 + k * 0.55) * g.bright * m.opacity));

        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let i = 0; i <= pts; i++) {
          const x = (i / pts) * W;
          const u = i / pts;
          const y =
            baseY +
            Math.sin(u * 6.0 * m.frequency + this.phase * (1 + k * 0.5)) * amp +
            Math.sin(u * 13.0 * m.frequency - this.phase * (0.7 + k)) * amp * 0.45;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(W, H);
        ctx.closePath();
        ctx.fill();
      }
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================ IŞIK PARÇACIKLARI ============================
  class Bokeh {
    constructor() { this.n = 0; this.p = null; this.sprites = null; this.spriteKey = ''; }

    // Her parçacık için createRadialGradient çağırmak kare başına onlarca gradyan
    // demekti ve ölçümde saniyelik takılmalara yol açıyordu. Bunun yerine her
    // palet rengi için bir kez yumuşak "ışık topu" damgası üretilip drawImage
    // ile ölçeklenerek basılır.
    _ensureSprites(cfg, softness) {
      const key = colorsOf(cfg).join('|') + ':' + softness.toFixed(2);
      if (this.spriteKey === key && this.sprites) return;
      this.spriteKey = key;
      const R = 128;
      this.sprites = colorsOf(cfg).map((_, i) => {
        const cv = document.createElement('canvas');
        cv.width = cv.height = R * 2;
        const c2 = cv.getContext('2d');
        const col = rgbOf(cfg, i);
        const gr = c2.createRadialGradient(R, R, 0, R, R, R);
        gr.addColorStop(0, rgba(col, 1));
        gr.addColorStop(0.55, rgba(col, 0.35));
        gr.addColorStop(1, rgba(col, 0));
        c2.fillStyle = gr;
        c2.fillRect(0, 0, R * 2, R * 2);
        return cv;
      });
    }
    _ensure(count, sizeVar) {
      if (this.n === count) return;
      this.n = count;
      const r = rng(0xb0ce);
      this.p = [];
      for (let i = 0; i < count; i++) {
        this.p.push({
          x: r(), y: r(), r: 0.04 + r() * 0.13,
          sp: 0.02 + r() * 0.07, ph: r() * Math.PI * 2,
          c: (r() * 5) | 0, a: 0.12 + r() * 0.3, v: r(),
        });
      }
    }
    draw(ctx, audio, cfg, t, W, H, dt) {
      const g = gset(cfg);
      const m = mset(cfg, 'bokeh', { count: 26, size: 1, sizeVar: 1, drift: 1, pulse: 0.5, opacity: 1 });
      this._ensure(Math.max(2, Math.min(160, m.count | 0)));
      const minDim = Math.min(W, H);
      const pulse = 1 + audio.bass * g.react * m.pulse;

      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, rgba(lerpColor(cfg, 0.02), g.bright));
      bg.addColorStop(1, rgba(lerpColor(cfg, 0.55), g.bright * 0.9));
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      this._ensureSprites(cfg, 1);
      ctx.globalCompositeOperation = 'lighter';
      for (const b of this.p) {
        const drift = t * (0.12 + g.speed * 0.3);
        const x = (b.x + Math.sin(drift * b.sp * 6 + b.ph) * 0.10 * m.drift) * W;
        const y = (b.y + Math.cos(drift * b.sp * 5 + b.ph * 1.3) * 0.10 * m.drift) * H;
        const varied = 1 + (b.v - 0.5) * m.sizeVar;
        const rr = b.r * minDim * pulse * m.size * Math.max(0.1, varied);
        const sprite = this.sprites[b.c % this.sprites.length];
        ctx.globalAlpha = Math.min(1, b.a * g.bright * m.opacity);
        ctx.drawImage(sprite, x - rr, y - rr, rr * 2, rr * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================ DİJİTAL YAĞMUR ============================
  // Yukarıdan aşağı düşen ışıklı izler; bas darbesi akışı hızlandırır.
  class DigitalRain {
    constructor() { this.n = 0; this.y = null; this.sp = null; this.c = null; this.on = null; this.rnd = rng(0x4a11); }
    _ensure(count, density) {
      if (this.n === count) {
        return;
      }
      this.n = count;
      this.y = new Float32Array(count);
      this.sp = new Float32Array(count);
      this.c = new Uint8Array(count);
      this.on = new Uint8Array(count);
      const r = rng(0x9a11);
      for (let i = 0; i < count; i++) {
        this.y[i] = r();
        this.sp[i] = 0.35 + r() * 0.95;
        this.c[i] = (r() * 5) | 0;
        this.on[i] = r() < density ? 1 : 0;
      }
    }
    draw(ctx, audio, cfg, t, W, H, dt) {
      const g = gset(cfg);
      const m = mset(cfg, 'rain', { columns: 68, speed: 1, trail: 1, density: 0.7, thickness: 1, bassPush: 1.4 });
      const cols = Math.max(8, Math.min(240, m.columns | 0));
      this._ensure(cols, m.density);
      const step = Math.min(0.05, dt || 0.016);
      const speed = (0.25 + g.speed * 0.8) * m.speed * (1 + audio.bass * g.react * m.bassPush);
      const slot = W / cols;

      ctx.fillStyle = '#04040a';
      ctx.fillRect(0, 0, W, H);

      const trailLen = H * 0.22 * m.trail;
      const lw = Math.max(1, slot * 0.42 * m.thickness);

      for (let i = 0; i < cols; i++) {
        if (!this.on[i]) continue;
        this.y[i] += step * speed * this.sp[i];
        if (this.y[i] > 1.25) {
          this.y[i] = -0.25 - this.rnd() * 0.4;
          this.c[i] = (this.rnd() * 5) | 0;
        }
        const x = i * slot + slot / 2;
        const yy = this.y[i] * H;
        const col = rgbOf(cfg, this.c[i]);

        const grad = ctx.createLinearGradient(x, yy - trailLen, x, yy);
        grad.addColorStop(0, rgba(col, 0));
        grad.addColorStop(1, rgba(col, Math.min(1, 0.85 * g.bright)));
        ctx.strokeStyle = grad;
        ctx.lineWidth = lw;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, yy - trailLen);
        ctx.lineTo(x, yy);
        ctx.stroke();

        // parlak baş
        ctx.fillStyle = rgba([
          Math.min(255, col[0] + 110), Math.min(255, col[1] + 110), Math.min(255, col[2] + 110),
        ], Math.min(1, g.bright));
        ctx.beginPath();
        ctx.arc(x, yy, lw * 0.62, 0, Math.PI * 2);
        ctx.fill();
      }
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================ KUTUP IŞIKLARI ============================
  // Yatay olarak dalgalanan, yumuşak kenarlı ışık perdeleri.
  class Aurora {
    constructor() { this.phase = 0; }
    draw(ctx, audio, cfg, t, W, H, dt) {
      const g = gset(cfg);
      const m = mset(cfg, 'aurora', { bands: 5, amplitude: 1, thickness: 1, softness: 1, height: 0.55, bassPush: 1.2 });
      this.phase += Math.min(0.05, dt || 0.016) * (0.2 + g.speed * 0.7) * (1 + audio.level * g.react * 0.8);

      // gece göğü
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#050418');
      sky.addColorStop(1, '#0a0620');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      const BANDS = Math.max(1, Math.min(12, m.bands | 0));
      const pts = 72;
      const centerY = H * Math.max(0.1, Math.min(0.9, m.height));
      const push = 1 + audio.bass * g.react * m.bassPush;

      ctx.globalCompositeOperation = 'lighter';
      for (let b = 0; b < BANDS; b++) {
        const k = BANDS === 1 ? 0.5 : b / (BANDS - 1);
        const col = lerpColor(cfg, k);
        const amp = H * 0.10 * m.amplitude * push * (0.6 + k * 0.8);
        const thick = H * 0.075 * m.thickness * (0.7 + k * 0.6);
        const off = (k - 0.5) * H * 0.28;

        // Perde: üst kenarı dalgalı bir şerit; dikey gradyanla yumuşatılır
        const grad = ctx.createLinearGradient(0, centerY + off - thick, 0, centerY + off + thick);
        grad.addColorStop(0, rgba(col, 0));
        grad.addColorStop(0.5, rgba(col, Math.min(1, 0.42 * g.bright / Math.max(0.4, m.softness))));
        grad.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = grad;

        ctx.beginPath();
        for (let i = 0; i <= pts; i++) {
          const u = i / pts;
          const x = u * W;
          const y = centerY + off - thick +
            Math.sin(u * 4.2 + this.phase * (1 + k * 0.6)) * amp +
            Math.sin(u * 9.1 - this.phase * (0.8 + k)) * amp * 0.4;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        for (let i = pts; i >= 0; i--) {
          const u = i / pts;
          const x = u * W;
          const y = centerY + off + thick +
            Math.sin(u * 4.2 + this.phase * (1 + k * 0.6)) * amp +
            Math.sin(u * 9.1 - this.phase * (0.8 + k)) * amp * 0.4;
          ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================ AĞ ============================
  // Süzülen düğümler ve yakın olanlar arasında kurulan bağlantılar.
  class Network {
    constructor() { this.n = 0; this.x = null; this.y = null; this.vx = null; this.vy = null; this.c = null; }
    _ensure(count) {
      if (this.n === count) return;
      this.n = count;
      this.x = new Float32Array(count);
      this.y = new Float32Array(count);
      this.vx = new Float32Array(count);
      this.vy = new Float32Array(count);
      this.c = new Uint8Array(count);
      const r = rng(0x0e70);
      for (let i = 0; i < count; i++) {
        this.x[i] = r();
        this.y[i] = r();
        this.vx[i] = (r() - 0.5) * 0.06;
        this.vy[i] = (r() - 0.5) * 0.06;
        this.c[i] = (r() * 5) | 0;
      }
    }
    draw(ctx, audio, cfg, t, W, H, dt) {
      const g = gset(cfg);
      const m = mset(cfg, 'network', { nodes: 54, linkDist: 0.18, nodeSize: 1, lineWidth: 1, speed: 1, bassPush: 1.5 });
      const n = Math.max(6, Math.min(220, m.nodes | 0));
      this._ensure(n);
      const step = Math.min(0.05, dt || 0.016);
      const minDim = Math.min(W, H);
      const sp = (0.25 + g.speed * 0.7) * m.speed * (1 + audio.level * g.react * 0.8);
      const pulse = 1 + audio.bass * g.react * m.bassPush * 0.35;

      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, rgba(lerpColor(cfg, 0.05), 0.5 * g.bright));
      bg.addColorStop(1, rgba(lerpColor(cfg, 0.4), 0.35 * g.bright));
      ctx.fillStyle = '#05040c';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      for (let i = 0; i < n; i++) {
        this.x[i] += this.vx[i] * step * sp;
        this.y[i] += this.vy[i] * step * sp;
        if (this.x[i] < 0 || this.x[i] > 1) this.vx[i] *= -1;
        if (this.y[i] < 0 || this.y[i] > 1) this.vy[i] *= -1;
        this.x[i] = Math.max(0, Math.min(1, this.x[i]));
        this.y[i] = Math.max(0, Math.min(1, this.y[i]));
      }

      // bağlantılar
      const maxD = m.linkDist * pulse;
      const maxD2 = maxD * maxD;
      const lineCol = lerpColor(cfg, 0.6);
      ctx.lineWidth = Math.max(0.5, minDim * 0.0012 * m.lineWidth);
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = this.x[i] - this.x[j];
          const dy = this.y[i] - this.y[j];
          const d2 = dx * dx + dy * dy;
          if (d2 > maxD2) continue;
          const a = (1 - Math.sqrt(d2) / maxD) * 0.55 * g.bright;
          ctx.strokeStyle = rgba(lineCol, a);
          ctx.beginPath();
          ctx.moveTo(this.x[i] * W, this.y[i] * H);
          ctx.lineTo(this.x[j] * W, this.y[j] * H);
          ctx.stroke();
        }
      }

      // düğümler
      const nr = minDim * 0.004 * m.nodeSize * pulse;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = rgba(rgbOf(cfg, this.c[i]), Math.min(1, 0.9 * g.bright));
        ctx.beginPath();
        ctx.arc(this.x[i] * W, this.y[i] * H, nr, 0, Math.PI * 2);
        ctx.fill();
      }
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================ NABIZ HALKALARI ============================
  // Merkezden dışa açılan halkalar; bas darbelerinde fazladan halka doğar.
  class PulseRings {
    constructor() { this.rings = []; this.acc = 0; this.wasHigh = false; }
    draw(ctx, audio, cfg, t, W, H, dt) {
      const g = gset(cfg);
      const m = mset(cfg, 'rings', { rate: 2.4, speed: 1, thickness: 1, beatSpawn: 1, fade: 1 });
      const step = Math.min(0.05, dt || 0.016);
      const minDim = Math.min(W, H);

      const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
      bg.addColorStop(0, rgba(lerpColor(cfg, 0.15), 0.45 * g.bright));
      bg.addColorStop(1, '#05040c');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // düzenli doğum
      this.acc += step * Math.max(0.1, m.rate);
      while (this.acc >= 1) {
        this.acc -= 1;
        this.rings.push({ r: 0, c: this.rings.length % 5 });
      }
      // bas eşiği aşıldığında ek halka (her darbede bir kez)
      const high = audio.bass > 0.45;
      if (high && !this.wasHigh && m.beatSpawn > 0) {
        this.rings.push({ r: 0, c: (this.rings.length + 2) % 5, boost: m.beatSpawn });
      }
      this.wasHigh = high;
      if (this.rings.length > 60) this.rings.splice(0, this.rings.length - 60);

      const grow = (0.18 + g.speed * 0.35) * m.speed * (1 + audio.level * g.react * 0.7);
      ctx.lineCap = 'round';
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const ring = this.rings[i];
        ring.r += step * grow;
        if (ring.r > 1.5) { this.rings.splice(i, 1); continue; }
        const a = Math.max(0, 1 - ring.r / 1.5) * g.bright / Math.max(0.2, m.fade);
        if (a < 0.02) continue;
        ctx.strokeStyle = rgba(rgbOf(cfg, ring.c), Math.min(1, a * 0.8));
        ctx.lineWidth = Math.max(1, minDim * 0.006 * m.thickness * (ring.boost || 1));
        ctx.beginPath();
        ctx.arc(W / 2, H / 2, ring.r * minDim * 0.75, 0, Math.PI * 2);
        ctx.stroke();
      }
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  window.SVBackgrounds = {
    starfield: Starfield,
    grid: RetroGrid,
    waves: WaveLayers,
    bokeh: Bokeh,
    rain: DigitalRain,
    aurora: Aurora,
    network: Network,
    rings: PulseRings,
  };
})();
