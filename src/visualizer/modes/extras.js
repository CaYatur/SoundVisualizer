'use strict';
/* Ek görselleştirici modları (2D canvas).

   Sözleşme mevcut modlarla aynı:
     new Mode(canvas) -> draw(audio, cfg, t, dt) -> dispose()
   Hepsi window.SVModes altına kaydolur; görselleştirici penceresi, panel
   önizlemesi ve çevrimdışı video dışa aktarıcı aynı sınıfları kullanır.

   backgrounds.js gibi tek dosyada birden çok sınıf tutulur: her mod ~60 satır
   ve üçü de aynı yardımcıları (renk, tepe takibi, vuruş algılama) paylaşıyor. */
(function () {
  // ==========================================================================
  // Ortak yardımcılar
  // ==========================================================================

  // Bar indeksine göre renk: gökkuşağı açıksa spektrum boyunca kayar,
  // kapalıysa kullanıcının seçtiği renk kullanılır.
  function barColor(v, i, count, t, val) {
    if (v.rainbow) {
      const hue = ((i / Math.max(1, count)) * 320 + t * 12) % 360;
      return `hsl(${hue}, 85%, ${55 + (val || 0) * 12}%)`;
    }
    return v.color;
  }

  // İki renk arasında geçiş (gökkuşağı kapalıyken çift renkli modlar için)
  function duoColor(v, f, t) {
    if (v.rainbow) return `hsl(${((f * 300 + t * 20) % 360 + 360) % 360}, 88%, 62%)`;
    const a = window.SV.hexToRgb01(v.color);
    const b = window.SV.hexToRgb01(v.color2 || v.color);
    const k = Math.max(0, Math.min(1, f));
    return `rgb(${((a[0] + (b[0] - a[0]) * k) * 255) | 0},${((a[1] + (b[1] - a[1]) * k) * 255) | 0},${((a[2] + (b[2] - a[2]) * k) * 255) | 0})`;
  }

  function rgbaOf(hex, alpha) {
    const c = window.SV.hexToRgb01(hex || '#ffffff');
    return `rgba(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0},${alpha})`;
  }

  // Deterministik sözde-rastgele: aynı seed -> aynı sahne. Video dışa
  // aktarımının kare kare tekrarlanabilir olması buna bağlı.
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  /* Vuruş (beat) algılayıcı — ince bir sarmalayıcı.

     Kararı src/shared/onset.js veriyor: mutlak seviye yerine ARTIŞ HIZINA
     bakan, kare hızından bağımsız, art arda tetiklenebilen algılayıcı. Eski
     yerel uygulama basın kayan ortalamasını taban alıyordu; yoğun bir parçada
     taban vuruşların üstüne çıkıp sonraki vuruşları yutuyor, sahne tek tetikte
     kalıyordu (bkz. tests/onset.test.js "SÜREKLİ YÜKSEK ZEMİN").

     Sarmalayıcı yalnızca çağrı biçimini koruyor: modlar mutlak zaman (t)
     veriyor, algılayıcı dt istiyor. */
  class Beat {
    constructor(cooldown) {
      this.det = new window.SVOnset.Onset({ refractory: cooldown == null ? 0.16 : cooldown });
      this.prevT = null;
      this.energy = 0;
    }
    hit(bass, t) {
      const dt = this.prevT == null ? 1 / 60 : Math.min(0.25, Math.max(1 / 240, t - this.prevT));
      this.prevT = t;
      const s = this.det.push(bass, dt);
      this.energy = this.det.energy;
      return s;
    }
  }

  // ==========================================================================
  // KALEYDOSKOP — spektrum tek dilime çizilir, dilim N kez aynalanır
  // ==========================================================================
  class Kaleido {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
    }
    resize() {}
    draw(audio, cfg, t) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const count = Math.max(12, Math.min(96, v.barCount | 0));
      const bars = audio.getBars(count, v.minFreq, v.maxFreq, v.spectrum);
      ctx.clearRect(0, 0, W, H);

      // Dilim sayısı bar boşluğundan türetilir: boşluk arttıkça dilim azalır,
      // böylece kullanıcı tek kaydırıcıyla sadelik/karmaşıklık ayarlar.
      const slices = Math.max(4, Math.round(16 - v.gap * 12));
      const R = Math.min(W, H) * 0.47;
      const cx = W / 2;
      const cy = H / 2;
      const spin = t * 0.18 + audio.level * 0.6;

      ctx.save();
      ctx.translate(cx, cy);
      for (let s = 0; s < slices; s++) {
        ctx.save();
        ctx.rotate(spin + (s / slices) * Math.PI * 2);
        if (s % 2 === 1) ctx.scale(1, -1); // ayna: komşu dilimler ters
        const wedge = (Math.PI * 2) / slices;
        for (let i = 0; i < count; i++) {
          const val = Math.min(1, bars[i] * v.sensitivity);
          if (val < 0.012) continue;
          const r0 = R * (0.12 + (i / count) * 0.86);
          const a0 = -wedge * 0.5 + (i / count) * wedge * 0.2;
          const len = R * 0.2 * val + R * 0.02;
          ctx.fillStyle = barColor(v, i, count, t, val);
          ctx.beginPath();
          ctx.moveTo(Math.cos(a0) * r0, Math.sin(a0) * r0);
          ctx.arc(0, 0, r0 + len, a0, a0 + wedge * (0.28 + val * 0.4));
          ctx.arc(0, 0, r0, a0 + wedge * (0.28 + val * 0.4), a0, true);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
      ctx.restore();
      this.glow.apply(this.canvas, v.glow, 0.85);
    }
    dispose() {}
  }

  // ==========================================================================
  // SARMAL (DNA) — iki iplikçik ve aralarındaki basamaklar
  // ==========================================================================
  class Helix {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
    }
    resize() {}
    draw(audio, cfg, t) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const count = Math.max(24, Math.min(160, v.barCount | 0));
      const bars = audio.getBars(count, v.minFreq, v.maxFreq, v.spectrum);
      ctx.clearRect(0, 0, W, H);

      const cy = H / 2;
      const amp = H * 0.3 * (0.5 + v.thickness);
      const turns = 2.4;
      const phase = t * 1.1;
      const lw = Math.max(1, v.lineWidth * (W / 1600) * 2.2);

      const pts = [[], []];
      for (let i = 0; i < count; i++) {
        const f = i / (count - 1);
        const val = Math.min(1, bars[i] * v.sensitivity);
        const x = f * W;
        const ang = f * Math.PI * 2 * turns + phase;
        const a = amp * (0.35 + val * 0.9);
        pts[0].push([x, cy + Math.sin(ang) * a, val]);
        pts[1].push([x, cy + Math.sin(ang + Math.PI) * a, val]);
      }

      // basamaklar (iki iplikçiği bağlayan çubuklar)
      ctx.lineWidth = Math.max(1, lw * 0.55);
      for (let i = 0; i < count; i += 2) {
        const p = pts[0][i];
        const q = pts[1][i];
        ctx.strokeStyle = barColor(v, i, count, t, p[2]);
        ctx.globalAlpha = 0.25 + p[2] * 0.6;
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(q[0], q[1]);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // iplikçikler
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      for (let s = 0; s < 2; s++) {
        ctx.strokeStyle = v.rainbow ? barColor(v, s * count * 0.5, count, t, 0.6) : (s ? (v.color2 || v.color) : v.color);
        ctx.beginPath();
        pts[s].forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.stroke();
        // düğüm noktaları
        for (let i = 0; i < count; i += 3) {
          const p = pts[s][i];
          ctx.fillStyle = barColor(v, i, count, t, p[2]);
          ctx.beginPath();
          ctx.arc(p[0], p[1], lw * (0.7 + p[2] * 1.6), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      this.glow.apply(this.canvas, v.glow, 0.9);
    }
    dispose() {}
  }

  // ==========================================================================
  // SIVI DAMLALAR — yörüngedeki metaball'lar; 'lighter' ile birleşme hissi
  // ==========================================================================
  class Metaball {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
    }
    resize() {}
    draw(audio, cfg, t) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const n = Math.max(4, Math.min(28, Math.round(6 + (1 - v.gap) * 14)));
      const bars = audio.getBars(n, v.minFreq, v.maxFreq, v.spectrum);
      ctx.clearRect(0, 0, W, H);

      const minDim = Math.min(W, H);
      const cx = W / 2;
      const cy = H / 2;
      const base = minDim * 0.1 * (0.5 + v.thickness);

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const val = Math.min(1, bars[i] * v.sensitivity);
        const f = i / n;
        const ang = f * Math.PI * 2 + t * (0.18 + f * 0.22) + audio.bass * 0.6;
        const orbit = minDim * (0.1 + f * 0.28) * (1 + audio.level * 0.35);
        const x = cx + Math.cos(ang) * orbit;
        const y = cy + Math.sin(ang * 1.13) * orbit * 0.72;
        const r = base * (0.35 + val * 1.5);
        const col = barColor(v, i, n, t, val);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, col);
        g.addColorStop(0.55, col.startsWith('hsl') ? col.replace(')', ')') : col);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.55 + val * 0.4;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      this.glow.apply(this.canvas, v.glow, 0.75);
    }
    dispose() {}
  }

  // ==========================================================================
  // HAVAİ FİŞEK — bas vuruşunda patlama; yerçekimi ve iz bırakan parçacıklar
  // ==========================================================================
  class Fireworks {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.parts = [];
      this.beat = new Beat(0.14);
      this.rand = rng(0x51f7);
    }
    resize() {}
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const step = Math.min(0.05, dt || 0.016);
      ctx.clearRect(0, 0, W, H);

      const strength = this.beat.hit(audio.bass, t);
      if (strength > 0 && this.parts.length < 2600) {
        const cx = W * (0.18 + this.rand() * 0.64);
        const cy = H * (0.2 + this.rand() * 0.4);
        const n = Math.round(50 + strength * 130 * v.sensitivity);
        const speed = Math.min(W, H) * (0.22 + strength * 0.5);
        const hue = this.rand() * 360;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + this.rand() * 0.2;
          const sp = speed * (0.35 + this.rand() * 0.75);
          this.parts.push({
            x: cx, y: cy,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: 1, decay: 0.5 + this.rand() * 0.55,
            hue: hue + this.rand() * 40,
          });
        }
      }

      const grav = H * 0.28;
      const drag = Math.pow(0.86, step * 60);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      const lw = Math.max(1, v.lineWidth * (Math.min(W, H) / 900) * 1.6);
      for (let i = this.parts.length - 1; i >= 0; i--) {
        const p = this.parts[i];
        const px = p.x;
        const py = p.y;
        p.vy += grav * step;
        p.vx *= drag;
        p.vy *= drag;
        p.x += p.vx * step;
        p.y += p.vy * step;
        p.life -= p.decay * step;
        if (p.life <= 0 || p.y > H * 1.1) {
          this.parts.splice(i, 1);
          continue;
        }
        ctx.strokeStyle = v.rainbow
          ? `hsl(${p.hue % 360}, 92%, ${50 + p.life * 28}%)`
          : rgbaOf(v.color, Math.min(1, p.life));
        ctx.globalAlpha = Math.min(1, p.life);
        ctx.lineWidth = lw * (0.4 + p.life * 0.9);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      ctx.restore();
      this.glow.apply(this.canvas, v.glow, 0.8);
    }
    dispose() { this.parts.length = 0; }
  }

  // ==========================================================================
  // GİRDAP — logaritmik sarmal üzerinde spektrum segmentleri
  // ==========================================================================
  class Vortex {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
    }
    resize() {}
    draw(audio, cfg, t) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const count = Math.max(32, Math.min(240, v.barCount | 0));
      const bars = audio.getBars(count, v.minFreq, v.maxFreq, v.spectrum);
      ctx.clearRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2;
      const R = Math.min(W, H) * 0.48;
      const turns = 3.5;
      const spin = t * (0.4 + audio.level * 0.8);
      const lw = Math.max(1, v.lineWidth * (Math.min(W, H) / 900) * 2);

      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 0; i < count; i++) {
        const f = i / (count - 1);
        const val = Math.min(1, bars[i] * v.sensitivity);
        const ang = f * Math.PI * 2 * turns + spin;
        const r = R * (0.06 + f * 0.94);
        const len = R * 0.16 * val;
        const x = cx + Math.cos(ang) * r;
        const y = cy + Math.sin(ang) * r;
        const nx = Math.cos(ang + Math.PI / 2);
        const ny = Math.sin(ang + Math.PI / 2);
        ctx.strokeStyle = barColor(v, i, count, t, val);
        ctx.lineWidth = lw * (0.5 + val);
        ctx.beginPath();
        ctx.moveTo(x - nx * len, y - ny * len);
        ctx.lineTo(x + nx * len, y + ny * len);
        ctx.stroke();
      }
      ctx.restore();
      this.glow.apply(this.canvas, v.glow, 0.85);
    }
    dispose() {}
  }

  // ==========================================================================
  // MANDALA — polar gül eğrisi; katmanlar farklı bantlara bağlı
  // ==========================================================================
  class Mandala {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
    }
    resize() {}
    draw(audio, cfg, t) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const count = Math.max(64, Math.min(256, v.barCount | 0));
      const bars = audio.getBars(count, v.minFreq, v.maxFreq, v.spectrum);
      ctx.clearRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2;
      const R = Math.min(W, H) * 0.44;
      const layers = 4;
      const lw = Math.max(1, v.lineWidth * (Math.min(W, H) / 900) * 1.8);
      const steps = 240;

      ctx.save();
      ctx.lineJoin = 'round';
      for (let L = 0; L < layers; L++) {
        const band = L === 0 ? audio.bass : L === 1 ? audio.mid : L === 2 ? audio.treble : audio.level;
        const petals = 3 + L * 2;
        const scale = (0.35 + L * 0.21) * (1 + band * 0.4 * v.sensitivity);
        const rot = t * (0.12 + L * 0.07) * (L % 2 ? -1 : 1);
        ctx.strokeStyle = duoColor(v, L / (layers - 1), t + L);
        ctx.lineWidth = lw * (1 - L * 0.12);
        ctx.globalAlpha = 0.85 - L * 0.12;
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          const bi = Math.min(count - 1, Math.floor((i / steps) * count));
          const val = Math.min(1, bars[bi] * v.sensitivity);
          const r = R * scale * (Math.abs(Math.cos(petals * a)) * 0.55 + 0.45 + val * 0.35 * v.thickness);
          const x = cx + Math.cos(a + rot) * r;
          const y = cy + Math.sin(a + rot) * r;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();
      this.glow.apply(this.canvas, v.glow, 0.9);
    }
    dispose() {}
  }

  // ==========================================================================
  // ŞEHİR SİLÜETİ — barlar bina; pencereler spektruma göre yanar
  // ==========================================================================
  class Skyline {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.peaks = null;
    }
    resize() {}
    draw(audio, cfg, t) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const count = Math.max(10, Math.min(90, Math.round((v.barCount | 0) * 0.45)));
      const bars = audio.getBars(count, v.minFreq, v.maxFreq, v.spectrum);
      if (!this.peaks || this.peaks.length !== count) this.peaks = new Float32Array(count);
      ctx.clearRect(0, 0, W, H);

      const slot = W / count;
      const gap = slot * Math.min(0.6, Math.max(0.02, v.gap * 0.5));
      const bw = Math.max(2, slot - gap);
      const baseY = H * 0.98;
      const maxH = H * 0.86;
      const rand = rng(0x9ab3);

      ctx.save();
      for (let i = 0; i < count; i++) {
        const val = Math.min(1, bars[i] * v.sensitivity);
        this.peaks[i] = Math.max(val, this.peaks[i] - 0.012);
        const bh = Math.max(H * 0.05, this.peaks[i] * maxH);
        const x = i * slot + gap / 2;
        const col = barColor(v, i, count, t, val);

        // gövde: üstte renkli, altta koyu (silüet hissi)
        const g = ctx.createLinearGradient(0, baseY - bh, 0, baseY);
        g.addColorStop(0, col);
        g.addColorStop(1, 'rgba(6,8,18,0.92)');
        ctx.fillStyle = g;
        ctx.fillRect(x, baseY - bh, bw, bh);

        // pencereler
        const cols = Math.max(1, Math.floor(bw / Math.max(6, W / 260)));
        const rows = Math.max(1, Math.floor(bh / Math.max(8, H / 90)));
        const wS = bw / cols;
        const hS = bh / rows;
        ctx.fillStyle = col;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const seedV = rand();
            if (seedV > 0.42 + val * 0.34) continue;
            ctx.globalAlpha = 0.25 + val * 0.7;
            ctx.fillRect(x + c * wS + wS * 0.24, baseY - bh + r * hS + hS * 0.22, wS * 0.5, hS * 0.5);
          }
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      this.glow.apply(this.canvas, v.glow, 0.7);
    }
    dispose() {}
  }

  // ==========================================================================
  // ŞİMŞEK — bas vuruşunda dallanan yıldırım
  // ==========================================================================
  class Lightning {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.bolts = [];
      this.beat = new Beat(0.12);
      this.rand = rng(0x3c19);
    }
    resize() {}
    _makeBolt(W, H, strength) {
      const rand = this.rand;
      const segs = 14 + Math.round(strength * 12);
      const x0 = W * (0.15 + rand() * 0.7);
      const pts = [[x0, 0]];
      let x = x0;
      for (let i = 1; i <= segs; i++) {
        x += (rand() - 0.5) * W * 0.09;
        pts.push([x, (i / segs) * H]);
      }
      const branches = [];
      for (let b = 0; b < 2 + Math.round(strength * 3); b++) {
        const at = 2 + Math.floor(rand() * (segs - 4));
        const bp = [pts[at].slice()];
        let bx = pts[at][0];
        let by = pts[at][1];
        const len = 3 + Math.floor(rand() * 5);
        const dir = rand() < 0.5 ? -1 : 1;
        for (let i = 0; i < len; i++) {
          bx += dir * W * (0.02 + rand() * 0.05);
          by += H * (0.03 + rand() * 0.05);
          bp.push([bx, by]);
        }
        branches.push(bp);
      }
      return { pts, branches, life: 1, strength };
    }
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const step = Math.min(0.05, dt || 0.016);
      ctx.clearRect(0, 0, W, H);

      const s = this.beat.hit(audio.bass, t);
      if (s > 0 && this.bolts.length < 7) this.bolts.push(this._makeBolt(W, H, s));

      const lw = Math.max(1, v.lineWidth * (Math.min(W, H) / 900) * 2.4);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = this.bolts.length - 1; i >= 0; i--) {
        const b = this.bolts[i];
        b.life -= step * 3.4;
        if (b.life <= 0) { this.bolts.splice(i, 1); continue; }
        const alpha = Math.max(0, b.life) * (0.4 + b.strength * 0.6);
        ctx.strokeStyle = v.rainbow ? `hsl(${(t * 60 + i * 40) % 360}, 90%, 70%)` : v.color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = lw * (0.6 + b.strength);
        ctx.beginPath();
        b.pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.stroke();
        ctx.lineWidth = lw * 0.5;
        ctx.globalAlpha = alpha * 0.7;
        for (const br of b.branches) {
          ctx.beginPath();
          br.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
          ctx.stroke();
        }
      }
      ctx.restore();
      this.glow.apply(this.canvas, v.glow, 1.0);
    }
    dispose() { this.bolts.length = 0; }
  }

  // ==========================================================================
  // DALGALI IZGARA — vuruşlarda merkezden yayılan halkalar ızgarayı büker
  // ==========================================================================
  class RippleGrid {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.waves = [];
      this.beat = new Beat(0.18);
      this.rand = rng(0x77c1);
    }
    resize() {}
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const step = Math.min(0.05, dt || 0.016);
      ctx.clearRect(0, 0, W, H);

      const s = this.beat.hit(audio.bass, t);
      if (s > 0 && this.waves.length < 12) {
        this.waves.push({ x: W * (0.25 + this.rand() * 0.5), y: H * (0.25 + this.rand() * 0.5), r: 0, s });
      }
      const speed = Math.max(W, H) * 0.55;
      for (let i = this.waves.length - 1; i >= 0; i--) {
        this.waves[i].r += speed * step;
        if (this.waves[i].r > Math.max(W, H) * 1.2) this.waves.splice(i, 1);
      }

      const cols = Math.max(10, Math.min(70, Math.round((v.barCount | 0) * 0.35)));
      const rows = Math.max(6, Math.round(cols * (H / W)));
      const dx = W / cols;
      const dy = H / rows;
      const amp = Math.min(W, H) * 0.05 * (0.4 + v.thickness);
      const dotR = Math.max(1, Math.min(dx, dy) * 0.16 * (1 - Math.min(0.7, v.gap)));

      ctx.save();
      for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
          const x = c * dx;
          const y = r * dy;
          let off = 0;
          for (const w of this.waves) {
            const d = Math.hypot(x - w.x, y - w.y);
            const band = Math.max(0, 1 - Math.abs(d - w.r) / (Math.max(W, H) * 0.09));
            off += Math.sin((d - w.r) * 0.02) * band * w.s;
          }
          const level = Math.min(1, Math.abs(off));
          const yy = y + off * amp;
          ctx.fillStyle = barColor(v, c, cols, t, level);
          ctx.globalAlpha = 0.22 + level * 0.78;
          ctx.beginPath();
          ctx.arc(x, yy, dotR * (1 + level * 1.8), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
      this.glow.apply(this.canvas, v.glow, 0.8);
    }
    dispose() { this.waves.length = 0; }
  }

  // ==========================================================================
  // LISSAJOUS (XY) — dalga formunun kendisiyle faz kaymalı çizimi
  // ==========================================================================
  class Lissajous {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
    }
    resize() {}
    draw(audio, cfg, t) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      ctx.clearRect(0, 0, W, H);

      const wave = audio.timeBytes;
      const n = wave.length;
      const shift = Math.max(4, Math.round(n * 0.06));
      const cx = W / 2;
      const cy = H / 2;
      const R = Math.min(W, H) * 0.42 * (0.5 + v.thickness) * (1 + audio.level * 0.3);
      const lw = Math.max(1, v.lineWidth * (Math.min(W, H) / 900) * 1.8);
      const rot = t * 0.15;
      const cs = Math.cos(rot);
      const sn = Math.sin(rot);
      const stepN = n > 1024 ? 2 : 1;

      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (let i = 0, k = 0; i < n; i += stepN, k++) {
        const a = ((wave[i] - 128) / 128) * v.sensitivity;
        const b = ((wave[(i + shift) % n] - 128) / 128) * v.sensitivity;
        const x = cx + (a * cs - b * sn) * R;
        const y = cy + (a * sn + b * cs) * R;
        if (k) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.strokeStyle = v.rainbow
        ? `hsl(${(t * 26) % 360}, 92%, ${58 + audio.level * 16}%)`
        : v.color;
      ctx.stroke();
      ctx.restore();
      this.glow.apply(this.canvas, v.glow, 1.0);
    }
    dispose() {}
  }

  // ==========================================================================
  // TELLER — her tel bir frekans bandı; bandı yükselince tel titrer
  // ==========================================================================
  class Strings {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.energy = null;
    }
    resize() {}
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const count = Math.max(4, Math.min(32, Math.round(6 + (1 - v.gap) * 18)));
      const bars = audio.getBars(count, v.minFreq, v.maxFreq, v.spectrum);
      if (!this.energy || this.energy.length !== count) this.energy = new Float32Array(count);
      ctx.clearRect(0, 0, W, H);

      const step = Math.min(0.05, dt || 0.016);
      const slot = H / (count + 1);
      const lw = Math.max(1, v.lineWidth * (Math.min(W, H) / 900) * 1.6);
      const maxAmp = slot * 0.46 * (0.5 + v.thickness);
      const segs = 90;

      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 0; i < count; i++) {
        const val = Math.min(1, bars[i] * v.sensitivity);
        // tel enerjisi: bant yükselince sıçrar, sonra sönümlenir (gerçek tel gibi)
        this.energy[i] = Math.max(this.energy[i] * Math.pow(0.22, step), val);
        const e = this.energy[i];
        const y0 = slot * (i + 1);
        const harm = 1 + (i % 3);
        const freq = Math.PI * harm;
        const phase = t * (7 + i * 1.7);
        ctx.strokeStyle = barColor(v, i, count, t, e);
        ctx.lineWidth = lw * (0.6 + e * 1.1);
        ctx.globalAlpha = 0.35 + e * 0.65;
        ctx.beginPath();
        for (let s = 0; s <= segs; s++) {
          const f = s / segs;
          const env = Math.sin(f * Math.PI); // uçları sabit
          const y = y0 + Math.sin(f * freq * 2 + phase) * env * maxAmp * e;
          if (s) ctx.lineTo(f * W, y);
          else ctx.moveTo(f * W, y);
        }
        ctx.stroke();
      }
      ctx.restore();
      this.glow.apply(this.canvas, v.glow, 0.9);
    }
    dispose() {}
  }

  // ==========================================================================
  // BALONCUKLAR — seviyeyle doğan, basla büyüyen, yükselen kabarcıklar
  // ==========================================================================
  class Bubbles {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.items = [];
      this.rand = rng(0x2fd5);
      this.spawnAcc = 0;
    }
    resize() {}
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const step = Math.min(0.05, dt || 0.016);
      ctx.clearRect(0, 0, W, H);

      // doğum hızı sesin seviyesine bağlı
      this.spawnAcc += step * (4 + audio.level * 55 * v.sensitivity);
      while (this.spawnAcc >= 1 && this.items.length < 420) {
        this.spawnAcc -= 1;
        this.items.push({
          x: this.rand() * W,
          y: H + Math.min(W, H) * 0.04,
          r: Math.min(W, H) * (0.008 + this.rand() * 0.045) * (0.5 + v.thickness),
          sp: 0.06 + this.rand() * 0.16,
          w: this.rand() * Math.PI * 2,
          hue: this.rand() * 360,
        });
      }

      const lw = Math.max(1, v.lineWidth * (Math.min(W, H) / 900));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = this.items.length - 1; i >= 0; i--) {
        const b = this.items[i];
        b.y -= H * b.sp * step * (1 + audio.bass * 1.4);
        b.w += step * 2.2;
        const x = b.x + Math.sin(b.w) * b.r * 1.4;
        const r = b.r * (1 + audio.bass * 0.5);
        if (b.y + r < 0) { this.items.splice(i, 1); continue; }
        const col = v.rainbow ? `hsl(${b.hue % 360}, 88%, 64%)` : v.color;
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.18 + audio.level * 0.5;
        ctx.lineWidth = lw * 1.6;
        ctx.beginPath();
        ctx.arc(x, b.y, r, 0, Math.PI * 2);
        ctx.stroke();
        // parlama noktası
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.10 + audio.level * 0.35;
        ctx.beginPath();
        ctx.arc(x - r * 0.32, b.y - r * 0.32, r * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      this.glow.apply(this.canvas, v.glow, 0.7);
    }
    dispose() { this.items.length = 0; }
  }

  // ==========================================================================
  // 3B DALGA YIĞINI — dalga formu geçmişi perspektifte geriye doğru yığılır
  // ==========================================================================
  class Wave3D {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.rows = [];
      this.points = 128;
      this.maxRows = 42;
      this.acc = 0;
    }
    resize() {}
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      ctx.clearRect(0, 0, W, H);

      // Yeni satırı sabit aralıkla ekle: kare hızı değişse de akış hızı sabit
      this.acc += Math.min(0.05, dt || 0.016);
      if (this.acc >= 1 / 45) {
        this.acc = 0;
        const n = this.points;
        const row = new Float32Array(n);
        const wave = audio.timeBytes;
        const stride = wave.length / n;
        for (let i = 0; i < n; i++) row[i] = (wave[(i * stride) | 0] - 128) / 128;
        this.rows.unshift(row);
        if (this.rows.length > this.maxRows) this.rows.pop();
      }

      const horizon = H * 0.34;
      const depth = H * 0.6;
      const lw = Math.max(1, v.lineWidth * (Math.min(W, H) / 900) * 1.4);
      const amp = H * 0.15 * (0.4 + v.thickness) * v.sensitivity;

      ctx.save();
      ctx.lineJoin = 'round';
      for (let r = this.rows.length - 1; r >= 0; r--) {
        const row = this.rows[r];
        const f = r / this.maxRows; // 0 = en yeni (önde)
        const persp = 1 / (1 + f * 2.6);
        const y0 = horizon + depth * (1 - persp);
        const halfW = W * 0.5 * (0.25 + persp * 0.75);
        ctx.strokeStyle = duoColor(v, f, t);
        ctx.globalAlpha = (1 - f * 0.82) * 0.95;
        ctx.lineWidth = lw * persp * 1.6;
        ctx.beginPath();
        for (let i = 0; i < row.length; i++) {
          const x = W / 2 + (i / (row.length - 1) - 0.5) * 2 * halfW;
          const y = y0 - row[i] * amp * persp;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
      this.glow.apply(this.canvas, v.glow, 0.85);
    }
    dispose() { this.rows.length = 0; }
  }

  // ==========================================================================
  // YAYLAR — her bant merkezden dışa doğru bir yay; süpürme açısı seviyeyle
  // ==========================================================================
  class Arcs {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
    }
    resize() {}
    draw(audio, cfg, t) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const count = Math.max(6, Math.min(48, Math.round(8 + (1 - v.gap) * 28)));
      const bars = audio.getBars(count, v.minFreq, v.maxFreq, v.spectrum);
      ctx.clearRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2;
      const R = Math.min(W, H) * 0.46;
      const inner = R * 0.12;
      const stepR = (R - inner) / count;
      const lw = Math.max(1, Math.min(stepR * 0.7, stepR * (1 - Math.min(0.7, v.gap)) + 1));

      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 0; i < count; i++) {
        const val = Math.min(1, bars[i] * v.sensitivity);
        const r = inner + stepR * (i + 0.5);
        const sweep = Math.PI * 2 * (0.06 + val * 0.9);
        const start = t * (0.3 + i * 0.045) * (i % 2 ? -1 : 1) - sweep / 2;
        ctx.strokeStyle = barColor(v, i, count, t, val);
        ctx.lineWidth = lw;
        ctx.globalAlpha = 0.28 + val * 0.72;
        ctx.beginPath();
        ctx.arc(cx, cy, r, start, start + sweep);
        ctx.stroke();
      }
      ctx.restore();
      this.glow.apply(this.canvas, v.glow, 0.9);
    }
    dispose() {}
  }

  // ==========================================================================
  // FIRILDAK — dönen kanatlar; kanat uzunluğu bandın seviyesi
  // ==========================================================================
  class Pinwheel {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
    }
    resize() {}
    draw(audio, cfg, t) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const count = Math.max(8, Math.min(128, v.barCount | 0));
      const bars = audio.getBars(count, v.minFreq, v.maxFreq, v.spectrum);
      ctx.clearRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2;
      const R = Math.min(W, H) * 0.46;
      const inner = R * 0.1;
      const spin = t * (0.5 + audio.bass * 1.4);
      const wedge = (Math.PI * 2) / count;
      const curve = 0.55 + audio.level * 0.9; // kanadın kıvrımı

      ctx.save();
      ctx.translate(cx, cy);
      for (let i = 0; i < count; i++) {
        const val = Math.min(1, bars[i] * v.sensitivity);
        const a = i * wedge + spin;
        const len = inner + (R - inner) * (0.12 + val * 0.88);
        ctx.fillStyle = barColor(v, i, count, t, val);
        ctx.globalAlpha = 0.3 + val * 0.7;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
        ctx.quadraticCurveTo(
          Math.cos(a + wedge * curve * 2) * len * 0.7,
          Math.sin(a + wedge * curve * 2) * len * 0.7,
          Math.cos(a + wedge * curve) * len,
          Math.sin(a + wedge * curve) * len
        );
        ctx.quadraticCurveTo(
          Math.cos(a + wedge * 0.2) * len * 0.6,
          Math.sin(a + wedge * 0.2) * len * 0.6,
          Math.cos(a) * inner,
          Math.sin(a) * inner
        );
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      this.glow.apply(this.canvas, v.glow, 0.85);
    }
    dispose() {}
  }

  window.SVModes = window.SVModes || {};
  Object.assign(window.SVModes, {
    kaleido: Kaleido,
    helix: Helix,
    metaball: Metaball,
    fireworks: Fireworks,
    vortex: Vortex,
    mandala: Mandala,
    skyline: Skyline,
    lightning: Lightning,
    ripplegrid: RippleGrid,
    lissajous: Lissajous,
    strings: Strings,
    bubbles: Bubbles,
    wave3d: Wave3D,
    arcs: Arcs,
    pinwheel: Pinwheel,
  });

  // Diğer modüllerin (Studio önizlemesi, geri besleme motoru) kullanabilmesi için
  window.SVHelpers = Object.assign(window.SVHelpers || {}, { barColor, duoColor, rgbaOf, rng, Beat });
})();
