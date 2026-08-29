'use strict';
/* Ek 2D arkaplan modları.

   backgrounds.js ile aynı sözleşme:
     draw(ctx, audio, cfg, t, W, H, dt)  — verilen 2D bağlama çizer
     palette(cfg)                        — Dynamic Lighting için renk listesi

   Renk/palet yardımcıları backgrounds.js'ten (window.SVBgUtil) alınır; ortak
   renk seçicileri ve şablonlar burada da aynen geçerlidir. */
(function () {
  const U = window.SVBgUtil;
  const { colorsOf, rgba, lerpColor, gset, mset, rng, vignette, basePalette } = U;

  // ============================== BULUTSU ==============================
  class Nebula {
    constructor() {
      this.seedRand = rng(0x4d21);
      this.clouds = null;
    }
    _ensure(n) {
      if (this.clouds && this.clouds.length === n) return;
      const r = rng(0x4d21);
      this.clouds = [];
      for (let i = 0; i < n; i++) {
        this.clouds.push({
          x: r(), y: r(),
          rad: 0.25 + r() * 0.5,
          sp: 0.2 + r() * 0.6,
          ph: r() * Math.PI * 2,
          tone: r(),
        });
      }
    }
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'nebula', { clouds: 7, size: 1, softness: 1, drift: 1, density: 0.75, bassPush: 1.4 });
      const n = Math.max(2, Math.min(24, m.clouds | 0));
      this._ensure(n);

      ctx.fillStyle = '#04040a';
      ctx.fillRect(0, 0, W, H);
      const minDim = Math.min(W, H);
      const push = 1 + audio.bass * m.bassPush * g.react * 0.25;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const c = this.clouds[i];
        const tt = t * g.speed * m.drift * c.sp;
        const x = (c.x + Math.sin(tt * 0.6 + c.ph) * 0.16) * W;
        const y = (c.y + Math.cos(tt * 0.47 + c.ph * 1.7) * 0.14) * H;
        const r = minDim * c.rad * m.size * push * 0.85;
        const col = lerpColor(cfg, c.tone);
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        const core = Math.min(1, m.density * g.bright * (0.5 + audio.level * 0.7));
        grad.addColorStop(0, rgba(col, core * 0.5));
        grad.addColorStop(Math.min(0.85, 0.28 * m.softness + 0.12), rgba(col, core * 0.18));
        grad.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================ PETEK IZGARA ============================
  class HexGrid {
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'hexgrid', { size: 1, gap: 0.14, spectrum: 1, wave: 0.6, speed: 1, bassPush: 1.5 });
      ctx.fillStyle = '#05060d';
      ctx.fillRect(0, 0, W, H);

      const minDim = Math.min(W, H);
      const R = Math.max(8, minDim * 0.055 * m.size);
      const hw = R * Math.sqrt(3) / 2; // yatay yarı genişlik
      const cols = Math.ceil(W / (hw * 2)) + 2;
      const rows = Math.ceil(H / (R * 1.5)) + 2;
      const cx = W / 2;
      const cy = H / 2;
      const maxD = Math.hypot(W, H) / 2;
      const bars = audio.getBars(64, 30, 14000);
      const push = audio.bass * m.bassPush * g.react;

      ctx.save();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * hw * 2 + (r % 2 ? hw : 0) - hw;
          const y = r * R * 1.5 - R;
          const d = Math.hypot(x - cx, y - cy) / maxD;
          // merkezden dışa yayılan dalga + spektrum bandı
          const wave = Math.sin(d * 9 - t * 2.4 * m.speed * g.speed) * 0.5 + 0.5;
          const bi = Math.min(63, Math.floor(d * 63));
          const spec = bars[bi] * m.spectrum;
          const lit = Math.min(1, wave * m.wave + spec + push * 0.25);
          if (lit < 0.04) continue;
          const col = lerpColor(cfg, (d + t * 0.04 * g.speed) % 1);
          ctx.fillStyle = rgba(col, Math.min(0.95, lit * 0.75 * g.bright));
          const rr = R * (1 - Math.min(0.6, m.gap)) * (0.55 + lit * 0.5);
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (Math.PI / 3) * k + Math.PI / 6;
            const px = x + Math.cos(a) * rr;
            const py = y + Math.sin(a) * rr;
            if (k) ctx.lineTo(px, py);
            else ctx.moveTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================== MÜREKKEP ==============================
  /* Sıvı mürekkep: her damla, gövdesi yavaşça burulan bir kapalı eğri.
     Gerçek akışkan simülasyonu yerine çok katmanlı gürültülü poligon —
     görsel olarak aynı hissi verir, CPU maliyeti düşüktür. */
  class Ink {
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'ink', { blobs: 5, viscosity: 1, swirl: 1, spread: 1, opacity: 0.9, bassPush: 1.6 });
      ctx.fillStyle = '#050408';
      ctx.fillRect(0, 0, W, H);

      const n = Math.max(1, Math.min(16, m.blobs | 0));
      const minDim = Math.min(W, H);
      const steps = 96;
      const push = 1 + audio.bass * m.bassPush * g.react * 0.3;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const f = i / n;
        const ph = f * Math.PI * 2;
        const tt = t * g.speed * 0.35;
        const cx = W * (0.5 + Math.cos(tt * 0.7 + ph) * 0.26 * m.spread);
        const cy = H * (0.5 + Math.sin(tt * 0.53 + ph * 1.4) * 0.24 * m.spread);
        const base = minDim * (0.14 + f * 0.1) * push;
        const col = lerpColor(cfg, (f + t * 0.03 * g.speed) % 1);
        ctx.fillStyle = rgba(col, Math.min(0.9, m.opacity * 0.22 * g.bright));
        ctx.beginPath();
        for (let s = 0; s <= steps; s++) {
          const a = (s / steps) * Math.PI * 2;
          // birden çok harmonik: kenarları organik kıvrımlı yapar
          const wob =
            Math.sin(a * 3 + tt * 2.1 + ph) * 0.16 * m.swirl +
            Math.sin(a * 5 - tt * 1.4 + ph * 2) * 0.09 * m.swirl +
            Math.sin(a * 2 + tt * 0.9) * 0.12 / Math.max(0.2, m.viscosity);
          const r = base * (1 + wob + audio.mid * 0.25 * g.react);
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r * 0.92;
          if (s) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ================================ KAR =================================
  class Snow {
    constructor() { this.items = null; }
    _ensure(n) {
      if (this.items && this.items.length === n) return;
      const r = rng(0x8f2c);
      this.items = [];
      for (let i = 0; i < n; i++) {
        this.items.push({ x: r(), y: r(), z: 0.25 + r() * 0.75, ph: r() * Math.PI * 2, tone: r() });
      }
    }
    draw(ctx, audio, cfg, t, W, H, dt) {
      const g = gset(cfg);
      const m = mset(cfg, 'snow', { count: 260, size: 1, fall: 1, sway: 1, depth: 1, bassPush: 1.2 });
      const n = Math.max(20, Math.min(2000, m.count | 0));
      this._ensure(n);
      const step = Math.min(0.05, dt || 0.016);

      ctx.fillStyle = '#04050b';
      ctx.fillRect(0, 0, W, H);
      const minDim = Math.min(W, H);
      const speed = (0.06 + audio.bass * m.bassPush * g.react * 0.06) * m.fall * (0.4 + g.speed);

      ctx.save();
      for (const p of this.items) {
        const z = 1 + (p.z - 1) * m.depth;
        p.y += speed * z * step;
        if (p.y > 1.05) { p.y -= 1.1; p.x = (p.x + 0.37) % 1; }
        const x = (p.x + Math.sin(t * 0.7 * m.sway + p.ph) * 0.02 * m.sway) * W;
        const y = p.y * H;
        const r = minDim * 0.004 * m.size * z * (1 + audio.level * 0.5);
        const col = lerpColor(cfg, p.tone);
        ctx.fillStyle = rgba(col, Math.min(0.95, (0.22 + z * 0.55) * g.bright));
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================== ŞEHİR ================================
  class City {
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'city', { buildings: 34, height: 1, windows: 1, skyGlow: 0.8, parallax: 1, bassPush: 1.4 });

      // gökyüzü
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      const top = lerpColor(cfg, 0.05);
      const mid = lerpColor(cfg, 0.45);
      sky.addColorStop(0, rgba(top, 0.85 * g.bright * m.skyGlow));
      sky.addColorStop(0.62, rgba(mid, 0.35 * g.bright * m.skyGlow));
      sky.addColorStop(1, 'rgba(3,4,10,1)');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      const bars = audio.getBars(48, 30, 12000);
      const n = Math.max(6, Math.min(120, m.buildings | 0));

      // iki katman: arkadaki daha koyu ve yavaş kayar (parallax)
      for (let layer = 1; layer >= 0; layer--) {
        const r = rng(layer ? 0x1177 : 0x4488);
        const off = (t * g.speed * (layer ? 6 : 14) * m.parallax) % (W / n);
        const bw = W / (n - (layer ? 4 : 0));
        const scale = layer ? 0.66 : 1;
        for (let i = -1; i <= n; i++) {
          const hRand = 0.2 + r() * 0.55;
          const bi = Math.abs(i) % 48;
          const react = bars[bi] * g.react * 0.28;
          const bh = H * (hRand + react) * m.height * scale;
          const x = i * bw - off;
          const col = lerpColor(cfg, (i / n + layer * 0.3) % 1);
          ctx.fillStyle = layer ? 'rgba(6,8,18,0.92)' : 'rgba(3,4,10,0.97)';
          ctx.fillRect(x, H - bh, bw * 0.9, bh);

          if (!layer && m.windows > 0.01) {
            const wc = Math.max(1, Math.floor(bw / Math.max(7, W / 240)));
            const wr = Math.max(1, Math.floor(bh / Math.max(9, H / 80)));
            const sx = (bw * 0.9) / wc;
            const sy = bh / wr;
            ctx.fillStyle = rgba(col, 0.5 + react * 1.6);
            for (let a = 0; a < wc; a++) {
              for (let b = 0; b < wr; b++) {
                if (r() > 0.3 * m.windows + react) continue;
                ctx.fillRect(x + a * sx + sx * 0.26, H - bh + b * sy + sy * 0.24, sx * 0.46, sy * 0.46);
              }
            }
          }
        }
      }
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // ============================== KORİDOR ==============================
  class Corridor {
    constructor() { this.z = 0; }
    draw(ctx, audio, cfg, t, W, H, dt) {
      const g = gset(cfg);
      const m = mset(cfg, 'corridor', { rings: 26, speed: 1, sides: 0, twist: 0.5, lineWidth: 1, bassPush: 1.8 });
      ctx.fillStyle = '#03030a';
      ctx.fillRect(0, 0, W, H);

      const step = Math.min(0.05, dt || 0.016);
      this.z += step * (0.5 + g.speed) * m.speed * (1 + audio.bass * m.bassPush * g.react * 0.5);
      const n = Math.max(4, Math.min(90, m.rings | 0));
      const cx = W / 2;
      const cy = H / 2;
      const maxR = Math.hypot(W, H) * 0.62;
      const sides = Math.max(0, Math.min(12, m.sides | 0));

      ctx.save();
      ctx.lineJoin = 'round';
      for (let i = n - 1; i >= 0; i--) {
        // 0..1 arasında dolanan derinlik: halkalar sürekli izleyiciye doğru gelir
        const f = ((i / n) + this.z * 0.25) % 1;
        const persp = 1 / (0.06 + f * 1.6);
        const r = maxR * 0.06 * persp;
        if (r < 2 || r > maxR) continue;
        const fade = Math.min(1, (1 - f) * 1.6);
        const col = lerpColor(cfg, (f + t * 0.05 * g.speed) % 1);
        ctx.strokeStyle = rgba(col, fade * 0.85 * g.bright);
        ctx.lineWidth = Math.max(0.6, m.lineWidth * (Math.min(W, H) / 700) * persp * 0.4);
        const rot = this.z * m.twist + f * m.twist * 6;
        ctx.beginPath();
        if (sides < 3) {
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
        } else {
          for (let k = 0; k <= sides; k++) {
            const a = (k / sides) * Math.PI * 2 + rot;
            const x = cx + Math.cos(a) * r;
            const y = cy + Math.sin(a) * r;
            if (k) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
          }
        }
        ctx.stroke();
      }
      ctx.restore();
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // =============================== SARMAL ==============================
  class Spiral {
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'spiral', { arms: 3, turns: 4.5, thickness: 1, speed: 1, taper: 0.7, bassPush: 1.3 });
      ctx.fillStyle = '#04040b';
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2;
      const R = Math.hypot(W, H) * 0.55;
      const arms = Math.max(1, Math.min(12, m.arms | 0));
      const turns = Math.max(0.5, m.turns);
      const spin = t * (0.2 + g.speed * 0.5) * m.speed * (1 + audio.bass * m.bassPush * g.react * 0.2);
      const steps = 260;
      const baseW = (Math.min(W, H) / 26) * m.thickness;

      ctx.save();
      ctx.lineCap = 'round';
      for (let a = 0; a < arms; a++) {
        const off = (a / arms) * Math.PI * 2;
        for (let s = 0; s < steps; s++) {
          const f = s / steps;
          const ang = f * Math.PI * 2 * turns + off + spin;
          const r = R * f;
          const x = cx + Math.cos(ang) * r;
          const y = cy + Math.sin(ang) * r;
          const col = lerpColor(cfg, (f + a / arms) % 1);
          const taper = Math.pow(1 - f, m.taper) + 0.08;
          ctx.fillStyle = rgba(col, Math.min(0.9, taper * 0.75 * g.bright * (0.6 + audio.level * 0.6)));
          ctx.beginPath();
          ctx.arc(x, y, Math.max(0.5, baseW * taper * (1 + audio.mid * 0.5 * g.react)), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  // =============================== MOZAİK ==============================
  /* Düzensizleştirilmiş ızgara: her hücre bir frekans bandına bağlı.
     Voronoi hesabı yerine jitter'lı dikdörtgenler — görsel olarak yeterince
     organik, maliyeti ise ızgara kadar ucuz. */
  class Mosaic {
    draw(ctx, audio, cfg, t, W, H) {
      const g = gset(cfg);
      const m = mset(cfg, 'mosaic', { cells: 26, jitter: 0.55, borders: 0.35, response: 1, speed: 0.6, bassPush: 1.2 });
      ctx.fillStyle = '#04040a';
      ctx.fillRect(0, 0, W, H);

      const cells = Math.max(6, Math.min(90, m.cells | 0));
      const minDim = Math.min(W, H);
      const cw = W / cells;
      const rows = Math.max(3, Math.round(H / (minDim / cells)));
      const ch = H / rows;
      const bars = audio.getBars(64, 30, 15000);
      const r = rng(0x6b31);
      const push = audio.bass * m.bassPush * g.react;

      ctx.save();
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cells; x++) {
          const j1 = (r() - 0.5) * m.jitter;
          const j2 = (r() - 0.5) * m.jitter;
          const tone = (x / cells + y / rows) * 0.5;
          const bi = Math.min(63, Math.floor(((x + y) % cells) / cells * 63));
          const pulse = Math.sin(t * m.speed * 2 + (x + y) * 0.5) * 0.5 + 0.5;
          const lit = Math.min(1, bars[bi] * m.response + pulse * 0.28 + push * 0.2);
          const col = lerpColor(cfg, (tone + t * 0.03 * g.speed) % 1);
          const px = x * cw + j1 * cw * 0.4;
          const py = y * ch + j2 * ch * 0.4;
          const pad = Math.max(0.5, Math.min(cw, ch) * m.borders * 0.25);
          ctx.fillStyle = rgba(col, Math.min(0.95, (0.08 + lit * 0.8) * g.bright));
          ctx.fillRect(px + pad, py + pad, cw - pad * 2, ch - pad * 2);
        }
      }
      ctx.restore();
      vignette(ctx, W, H, g.vignette);
    }
    palette(cfg) { return basePalette(cfg); }
  }

  Object.assign(window.SVBackgrounds, {
    nebula: Nebula,
    hexgrid: HexGrid,
    ink: Ink,
    snow: Snow,
    city: City,
    corridor: Corridor,
    spiral: Spiral,
    mosaic: Mosaic,
  });
})();
