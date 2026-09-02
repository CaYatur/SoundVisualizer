'use strict';
/* Üretken (generative) görselleştirici modları.

   Sözleşme mevcut modlarla aynı:
     new Mode(canvas) -> draw(audio, cfg, t, dt) -> dispose()

   Bu dosyadaki modların ortak yanı, spektrumu doğrudan çizmek yerine bir
   SİSTEM sürmeleri: bir akış alanı, bir sürü, bir hücre bölünmesi, bir fizik
   ipi. Ses sistemin parametrelerini değiştirir, görüntü sistemin kendi
   davranışından çıkar. Bar grafiğinden farklı olarak aynı parça iki kez
   çalındığında aynı görüntü çıkar ama tek bir karesi bile sesin doğrudan
   fotoğrafı değildir.

   Belirlenimlilik: rastgelelik yalnızca tohumlu üreteçten gelir, hiçbir yerde
   Math.random() yok. Çevrimdışı dışa aktarımın kare kare tekrarlanabilir
   olması buna bağlı. */
(function () {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ==========================================================================
  // Ortak yardımcılar
  // ==========================================================================
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  // Sahne paleti: arkaplan gradyanının renkleri tüm modlarda ortak
  function colorsOf(cfg) {
    const c = (cfg.background && cfg.background.gradient && cfg.background.gradient.colors) || [];
    return c.length ? c : ['#5b4be0', '#3aa6ff', '#37e0c8', '#7be07b', '#d24bff'];
  }
  function paletteAt(cfg, pos) {
    const cols = colorsOf(cfg);
    const x = clamp(pos, 0, 0.9999) * (cols.length - 1);
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
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  /* Renk seçimi: gökkuşağı açıksa spektrum boyunca kayar, kapalıysa
     kullanıcının iki rengi arasında geçilir. Tüm modlar aynı kuralı izler ki
     palet değiştirince sahnenin tamamı birlikte değişsin. */
  function tone(v, cfg, f, t) {
    if (v.rainbow) return paletteAt(cfg, (f + t * 0.03) % 1);
    const a = window.SV.hexToRgb01(v.color);
    const b = window.SV.hexToRgb01(v.color2 || v.color);
    const k = clamp(f, 0, 1);
    return [
      ((a[0] + (b[0] - a[0]) * k) * 255) | 0,
      ((a[1] + (b[1] - a[1]) * k) * 255) | 0,
      ((a[2] + (b[2] - a[2]) * k) * 255) | 0,
    ];
  }

  // Değer gürültüsü (2B) — akış alanı ve doku için. Tohumlu, bu yüzden
  // dışa aktarımda tekrarlanabilir.
  function makeNoise(seed) {
    const r = rng(seed);
    const P = new Uint8Array(512);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (r() * (i + 1)) | 0;
      const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
    }
    for (let i = 0; i < 512; i++) P[i] = perm[i & 255];
    const fade = (x) => x * x * (3 - 2 * x);
    const grad = (h, x, y) => {
      const u = (h & 1) ? x : -x;
      const v = (h & 2) ? y : -y;
      return u + v;
    };
    return function (x, y) {
      const X = Math.floor(x) & 255;
      const Y = Math.floor(y) & 255;
      const xf = x - Math.floor(x);
      const yf = y - Math.floor(y);
      const u = fade(xf);
      const vv = fade(yf);
      const aa = P[P[X] + Y];
      const ab = P[P[X] + Y + 1];
      const ba = P[P[X + 1] + Y];
      const bb = P[P[X + 1] + Y + 1];
      const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf));
      const x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1));
      return (x1 + vv * (x2 - x1)) * 0.5;
    };
  }

  // Ortak vuruş algılayıcı sarmalayıcısı (bkz. src/shared/onset.js)
  function onset(refractory) {
    return new window.SVOnset.Onset({ refractory: refractory == null ? 0.11 : refractory });
  }

  // ==========================================================================
  // AKIŞ ALANI — parçacıklar gürültü alanında sürüklenir
  // ==========================================================================
  class FlowField {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.noise = makeNoise(0x1f35);
      this.rand = rng(0x9e21);
      this.N = 1400;
      this.px = new Float32Array(this.N);
      this.py = new Float32Array(this.N);
      this.age = new Float32Array(this.N);
      this.hue = new Float32Array(this.N);
      this.init = false;
      this.trail = null;
      this.tctx = null;
    }
    resize() { this.init = false; this.trail = null; }
    _seed(W, H) {
      for (let i = 0; i < this.N; i++) {
        this.px[i] = this.rand() * W;
        this.py[i] = this.rand() * H;
        this.age[i] = this.rand();
        this.hue[i] = this.rand();
      }
      this.init = true;
    }
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const step = Math.min(0.05, dt || 0.016);
      if (!this.init) this._seed(W, H);

      // İz tamponu: parçacıkların geçtiği yol solarak kalır
      if (!this.trail || this.trail.width !== W || this.trail.height !== H) {
        this.trail = document.createElement('canvas');
        this.trail.width = W;
        this.trail.height = H;
        this.tctx = this.trail.getContext('2d');
      }
      const tc = this.tctx;
      tc.globalCompositeOperation = 'source-over';
      tc.fillStyle = 'rgba(0,0,0,' + (0.035 + (1 - v.thickness) * 0.06).toFixed(3) + ')';
      tc.fillRect(0, 0, W, H);
      tc.globalCompositeOperation = 'lighter';

      const sens = v.sensitivity || 1;
      const bass = clamp(audio.bass * sens, 0, 1.4);
      const treb = clamp(audio.treble * sens, 0, 1.4);
      // Bas alanı genişletir (büyük kıvrımlar), tiz türbülans ekler
      const scale = 0.0012 + 0.0022 * (1 - bass * 0.6);
      const turb = 0.4 + treb * 2.4;
      const speed = (40 + bass * 220) * Math.min(W, H) / 1080;
      const minDim = Math.min(W, H);

      for (let i = 0; i < this.N; i++) {
        const n = this.noise(this.px[i] * scale, this.py[i] * scale + t * 0.06);
        const n2 = this.noise(this.py[i] * scale * turb - t * 0.03, this.px[i] * scale * turb);
        const ang = (n + n2 * 0.5) * TAU * 2;
        const dx = Math.cos(ang) * speed * step;
        const dy = Math.sin(ang) * speed * step;
        const x0 = this.px[i];
        const y0 = this.py[i];
        this.px[i] += dx;
        this.py[i] += dy;
        this.age[i] -= step * 0.28;

        if (this.age[i] <= 0 || this.px[i] < -20 || this.px[i] > W + 20 || this.py[i] < -20 || this.py[i] > H + 20) {
          this.px[i] = this.rand() * W;
          this.py[i] = this.rand() * H;
          this.age[i] = 0.6 + this.rand() * 0.6;
          this.hue[i] = this.rand();
          continue;
        }
        const c = tone(v, cfg, this.hue[i], t);
        tc.strokeStyle = rgba(c, clamp(this.age[i], 0, 1) * (0.25 + bass * 0.5));
        tc.lineWidth = Math.max(0.6, v.lineWidth * 0.35 * (minDim / 1080));
        tc.beginPath();
        tc.moveTo(x0, y0);
        tc.lineTo(this.px[i], this.py[i]);
        tc.stroke();
      }

      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(this.trail, 0, 0);
    }
    dispose() { this.trail = null; this.tctx = null; }
  }

  // ==========================================================================
  // SÜRÜ (BOIDS) — ayrılma / hizalanma / birlik
  // ==========================================================================
  class Flock {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.rand = rng(0x5c17);
      this.onset = onset(0.14);
      this.N = 220;
      this.x = new Float32Array(this.N);
      this.y = new Float32Array(this.N);
      this.vx = new Float32Array(this.N);
      this.vy = new Float32Array(this.N);
      this.init = false;
    }
    resize() { this.init = false; }
    _seed(W, H) {
      for (let i = 0; i < this.N; i++) {
        this.x[i] = this.rand() * W;
        this.y[i] = this.rand() * H;
        const a = this.rand() * TAU;
        this.vx[i] = Math.cos(a) * 60;
        this.vy[i] = Math.sin(a) * 60;
      }
      this.init = true;
    }
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const step = Math.min(0.05, dt || 0.016);
      if (!this.init) this._seed(W, H);
      ctx.clearRect(0, 0, W, H);

      const sens = v.sensitivity || 1;
      const bass = clamp(audio.bass * sens, 0, 1.2);
      const treb = clamp(audio.treble * sens, 0, 1.2);
      const minDim = Math.min(W, H);
      // Bas birliği artırır (sürü toplanır), tiz ayrılmayı (dağılır)
      const cohesion = 0.25 + bass * 1.5;
      const separation = 22 + treb * 55;
      const align = 0.6 + bass * 0.8;
      const maxV = (90 + bass * 260) * minDim / 1080;
      const R = 90 * minDim / 1080;

      // Vuruşta sürü saçılır
      const hit = this.onset.push(audio.bass * sens, step);
      if (hit > 0) {
        for (let i = 0; i < this.N; i++) {
          const a = this.rand() * TAU;
          this.vx[i] += Math.cos(a) * 260 * hit;
          this.vy[i] += Math.sin(a) * 260 * hit;
        }
      }

      // O(N²) ama N=220: kare başına ~48k karşılaştırma, 60 fps'te sorunsuz
      for (let i = 0; i < this.N; i++) {
        let cx = 0, cy = 0, ax = 0, ay = 0, sx = 0, sy = 0, n = 0;
        for (let j = 0; j < this.N; j++) {
          if (i === j) continue;
          const dx = this.x[j] - this.x[i];
          const dy = this.y[j] - this.y[i];
          const d2 = dx * dx + dy * dy;
          if (d2 > R * R) continue;
          n++;
          cx += this.x[j]; cy += this.y[j];
          ax += this.vx[j]; ay += this.vy[j];
          if (d2 < separation * separation && d2 > 1e-3) {
            const d = Math.sqrt(d2);
            sx -= dx / d; sy -= dy / d;
          }
        }
        if (n) {
          cx = cx / n - this.x[i];
          cy = cy / n - this.y[i];
          ax = ax / n - this.vx[i];
          ay = ay / n - this.vy[i];
          this.vx[i] += (cx * cohesion * 0.01 + ax * align * 0.05 + sx * 40) * step;
          this.vy[i] += (cy * cohesion * 0.01 + ay * align * 0.05 + sy * 40) * step;
        }
        const sp = Math.hypot(this.vx[i], this.vy[i]) || 1;
        if (sp > maxV) { this.vx[i] *= maxV / sp; this.vy[i] *= maxV / sp; }
        this.x[i] += this.vx[i] * step;
        this.y[i] += this.vy[i] * step;
        // Kenardan sar
        if (this.x[i] < 0) this.x[i] += W; else if (this.x[i] > W) this.x[i] -= W;
        if (this.y[i] < 0) this.y[i] += H; else if (this.y[i] > H) this.y[i] -= H;
      }

      const size = Math.max(2, minDim * 0.006 * (0.5 + v.thickness));
      for (let i = 0; i < this.N; i++) {
        const sp = Math.hypot(this.vx[i], this.vy[i]);
        const c = tone(v, cfg, clamp(sp / maxV, 0, 1), t);
        const a = Math.atan2(this.vy[i], this.vx[i]);
        ctx.save();
        ctx.translate(this.x[i], this.y[i]);
        ctx.rotate(a);
        ctx.fillStyle = rgba(c, 0.55 + clamp(sp / maxV, 0, 1) * 0.45);
        ctx.beginPath();
        ctx.moveTo(size * 2, 0);
        ctx.lineTo(-size, size * 0.8);
        ctx.lineTo(-size, -size * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      this.glow.apply(this.canvas, v.glow, 0.7);
    }
    dispose() {}
  }

  // ==========================================================================
  // VORONOİ HÜCRELERİ
  // ==========================================================================
  class Voronoi {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.rand = rng(0x33a9);
      this.N = 26;
      this.bx = new Float32Array(this.N);
      this.by = new Float32Array(this.N);
      this.ph = new Float32Array(this.N);
      for (let i = 0; i < this.N; i++) {
        this.bx[i] = this.rand();
        this.by[i] = this.rand();
        this.ph[i] = this.rand() * TAU;
      }
    }
    resize() {}
    draw(audio, cfg, t) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const sens = v.sensitivity || 1;
      const bars = audio.getBars(this.N, v.minFreq, v.maxFreq, v.spectrum);
      ctx.clearRect(0, 0, W, H);

      // Tohum noktaları yavaşça gezer; bant enerjisi onları merkezden iter
      const sx = new Float32Array(this.N);
      const sy = new Float32Array(this.N);
      for (let i = 0; i < this.N; i++) {
        const e = clamp(bars[i] * sens, 0, 1);
        const drift = 0.06 * Math.sin(t * 0.25 + this.ph[i]);
        const push = 0.12 * e;
        const dx = this.bx[i] - 0.5;
        const dy = this.by[i] - 0.5;
        const dl = Math.hypot(dx, dy) || 1;
        sx[i] = (this.bx[i] + drift + (dx / dl) * push) * W;
        sy[i] = (this.by[i] + drift * 0.7 + (dy / dl) * push) * H;
      }

      /* Hücreler piksel piksel değil, kaba bir ızgarada hesaplanır: her
         hücre için en yakın tohum bulunur ve blok o renge boyanır. Tam bir
         Voronoi kenarına göre biraz kaba ama 60 fps'te CPU'da çalışır ve
         blok boyutu kalınlık ayarına bağlıdır. */
      const cell = Math.max(4, Math.round(14 - v.thickness * 8) * (Math.min(W, H) / 900));
      const cols = Math.ceil(W / cell);
      const rows = Math.ceil(H / cell);
      for (let r = 0; r < rows; r++) {
        const y = r * cell + cell * 0.5;
        for (let c = 0; c < cols; c++) {
          const x = c * cell + cell * 0.5;
          let best = -1;
          let bd = Infinity;
          let bd2 = Infinity;
          for (let i = 0; i < this.N; i++) {
            const dx = x - sx[i];
            const dy = y - sy[i];
            const d = dx * dx + dy * dy;
            if (d < bd) { bd2 = bd; bd = d; best = i; }
            else if (d < bd2) bd2 = d;
          }
          const e = clamp(bars[best] * sens, 0, 1);
          // Kenara yakınlık: en yakın iki tohum arasındaki fark
          const edge = clamp((Math.sqrt(bd2) - Math.sqrt(bd)) / (cell * 3), 0, 1);
          const col = tone(v, cfg, (best / this.N + e * 0.25) % 1, t);
          ctx.fillStyle = rgba(col, (0.12 + e * 0.75) * (0.25 + edge * 0.75));
          ctx.fillRect(c * cell, r * cell, cell + 1, cell + 1);
        }
      }
    }
    dispose() {}
  }

  // ==========================================================================
  // TRUCHET DÖŞEMELERİ — vuruşta yön değiştiren çeyrek yaylar
  // ==========================================================================
  class Truchet {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.rand = rng(0x7b3d);
      this.flip = null;
      this.onset = onset(0.12);
      this.cols = 0;
      this.rows = 0;
    }
    resize() { this.flip = null; }
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const step = Math.min(0.05, dt || 0.016);
      ctx.clearRect(0, 0, W, H);

      const cols = clamp(Math.round((v.barCount | 0) * 0.12), 6, 40);
      const size = W / cols;
      const rows = Math.ceil(H / size);
      if (!this.flip || this.cols !== cols || this.rows !== rows) {
        this.cols = cols;
        this.rows = rows;
        this.flip = new Uint8Array(cols * rows);
        for (let i = 0; i < this.flip.length; i++) this.flip[i] = this.rand() < 0.5 ? 1 : 0;
      }

      const sens = v.sensitivity || 1;
      const hit = this.onset.push(audio.bass * sens, step);
      if (hit > 0) {
        // Vuruşta karolarin bir kısmı döner — desen sürekli yeniden örülür
        const n = Math.round(this.flip.length * (0.05 + hit * 0.3));
        for (let k = 0; k < n; k++) {
          const i = (this.rand() * this.flip.length) | 0;
          this.flip[i] ^= 1;
        }
      }

      const bars = audio.getBars(cols, v.minFreq, v.maxFreq, v.spectrum);
      const lw = Math.max(1.5, size * 0.16 * (0.4 + v.thickness));
      ctx.lineCap = 'round';
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const e = clamp(bars[c] * sens, 0, 1);
          const col = tone(v, cfg, (c / cols + r * 0.03) % 1, t);
          ctx.strokeStyle = rgba(col, 0.25 + e * 0.75);
          ctx.lineWidth = lw * (0.6 + e * 0.8);
          const x = c * size;
          const y = r * size;
          ctx.beginPath();
          if (this.flip[r * cols + c]) {
            ctx.arc(x, y, size / 2, 0, Math.PI / 2);
            ctx.moveTo(x + size, y + size);
            ctx.arc(x + size, y + size, size / 2, Math.PI, Math.PI * 1.5);
          } else {
            ctx.arc(x + size, y, size / 2, Math.PI / 2, Math.PI);
            ctx.moveTo(x, y + size);
            ctx.arc(x, y + size, size / 2, Math.PI * 1.5, TAU);
          }
          ctx.stroke();
        }
      }
      this.glow.apply(this.canvas, v.glow, 0.6);
    }
    dispose() { this.flip = null; }
  }

  // ==========================================================================
  // MOİRE — hafifçe farklı açılarda üst üste binen ızgaralar
  // ==========================================================================
  class Moire {
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
      const sens = v.sensitivity || 1;
      ctx.clearRect(0, 0, W, H);

      const layers = 3;
      const bass = clamp(audio.bass * sens, 0, 1.2);
      const mid = clamp(audio.mid * sens, 0, 1.2);
      const lines = clamp(Math.round((v.barCount | 0) * 0.5), 40, 260);
      const diag = Math.hypot(W, H);
      const lw = Math.max(0.8, v.lineWidth * 0.4 * (Math.min(W, H) / 900));

      ctx.globalCompositeOperation = 'lighter';
      for (let l = 0; l < layers; l++) {
        // Aralarındaki küçük açı farkı girişim desenini üretir
        const ang = t * (0.04 + l * 0.017) + l * 0.03 + bass * 0.25;
        const scale = 1 + l * 0.012 + mid * 0.06;
        const c = tone(v, cfg, l / layers, t);
        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.rotate(ang);
        ctx.scale(scale, scale);
        ctx.strokeStyle = rgba(c, 0.32);
        ctx.lineWidth = lw;
        ctx.beginPath();
        const gap = diag / lines;
        for (let i = -lines; i <= lines; i++) {
          const x = i * gap;
          ctx.moveTo(x, -diag / 2);
          ctx.lineTo(x, diag / 2);
        }
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalCompositeOperation = 'source-over';
      this.glow.apply(this.canvas, v.glow, 0.8);
    }
    dispose() {}
  }

  // ==========================================================================
  // DALGA GİRİŞİMİ — nokta kaynaklardan yayılan dairesel dalgaların toplamı
  // ==========================================================================
  class Interference {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.rand = rng(0x2d51);
      this.N = 5;
      this.sx = new Float32Array(this.N);
      this.sy = new Float32Array(this.N);
      for (let i = 0; i < this.N; i++) {
        this.sx[i] = 0.2 + this.rand() * 0.6;
        this.sy[i] = 0.2 + this.rand() * 0.6;
      }
      this.img = null;
    }
    resize() { this.img = null; }
    draw(audio, cfg, t) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const sens = v.sensitivity || 1;

      /* Alanı düşük çözünürlükte hesaplayıp büyütüyoruz: girişim deseni
         yumuşak olduğu için ölçek büyütmesi görünmüyor, buna karşılık
         hesap 25 kat ucuzluyor. */
      const scale = 5;
      const w = Math.max(2, Math.ceil(W / scale));
      const h = Math.max(2, Math.ceil(H / scale));
      if (!this.img || this.img.width !== w || this.img.height !== h) {
        this.img = document.createElement('canvas');
        this.img.width = w;
        this.img.height = h;
        this.ictx = this.img.getContext('2d');
        this.data = this.ictx.createImageData(w, h);
      }
      const bars = audio.getBars(this.N, v.minFreq, v.maxFreq, v.spectrum);
      const px = new Float32Array(this.N);
      const py = new Float32Array(this.N);
      const k = new Float32Array(this.N);
      const amp = new Float32Array(this.N);
      for (let i = 0; i < this.N; i++) {
        px[i] = this.sx[i] * w;
        py[i] = this.sy[i] * h;
        // Bant frekansı dalga sayısını, enerjisi genliği belirler
        k[i] = 0.25 + (i / this.N) * 1.1 * (0.5 + v.thickness);
        amp[i] = clamp(bars[i] * sens, 0, 1);
      }
      const d = this.data.data;
      const cols = [];
      for (let i = 0; i < 8; i++) cols.push(tone(v, cfg, i / 8, t));
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let s = 0;
          for (let i = 0; i < this.N; i++) {
            const dx = x - px[i];
            const dy = y - py[i];
            const r = Math.sqrt(dx * dx + dy * dy);
            s += Math.sin(r * k[i] - t * (2 + i * 0.7)) * amp[i];
          }
          const norm = clamp(s / this.N * 0.5 + 0.5, 0, 1);
          const c = cols[Math.min(7, (norm * 8) | 0)];
          const o = (y * w + x) * 4;
          const a = Math.abs(norm - 0.5) * 2;
          d[o] = c[0];
          d[o + 1] = c[1];
          d[o + 2] = c[2];
          d[o + 3] = (a * 255) | 0;
        }
      }
      this.ictx.putImageData(this.data, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.img, 0, 0, W, H);
    }
    dispose() { this.img = null; this.data = null; }
  }

  // ==========================================================================
  // İP FİZİĞİ — Verlet ile sallanan teller, vuruşta tekmelenir
  // ==========================================================================
  class Ropes {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.rand = rng(0x61c4);
      this.onset = onset(0.1);
      this.ropes = null;
    }
    resize() { this.ropes = null; }
    _build(W, H, count, seg) {
      this.ropes = [];
      for (let r = 0; r < count; r++) {
        const y = H * (0.18 + 0.64 * (count === 1 ? 0.5 : r / (count - 1)));
        const pts = [];
        for (let i = 0; i < seg; i++) {
          const x = (W * i) / (seg - 1);
          pts.push({ x, y, px: x, py: y });
        }
        this.ropes.push(pts);
      }
    }
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const step = Math.min(0.033, dt || 0.016);
      ctx.clearRect(0, 0, W, H);

      const count = clamp(Math.round((v.barCount | 0) * 0.05), 3, 14);
      const seg = clamp(Math.round((v.barCount | 0) * 0.3), 24, 90);
      if (!this.ropes || this.ropes.length !== count || this.ropes[0].length !== seg) {
        this._build(W, H, count, seg);
      }

      const sens = v.sensitivity || 1;
      const bars = audio.getBars(count, v.minFreq, v.maxFreq, v.spectrum);
      const hit = this.onset.push(audio.bass * sens, step);
      const minDim = Math.min(W, H);

      for (let r = 0; r < count; r++) {
        const pts = this.ropes[r];
        const e = clamp(bars[r] * sens, 0, 1);
        // Vuruşta rastgele bir noktadan tekme
        if (hit > 0) {
          const i = 1 + ((this.rand() * (seg - 2)) | 0);
          pts[i].py += (this.rand() - 0.5) * minDim * 0.25 * hit;
        }
        // Bant enerjisi ipi sürekli titretir
        for (let i = 1; i < seg - 1; i++) {
          pts[i].py -= Math.sin(t * 6 + i * 0.4 + r) * e * minDim * 0.0016;
        }
        // Verlet entegrasyonu + yerçekimi + sönüm
        for (let i = 1; i < seg - 1; i++) {
          const p = pts[i];
          const vx = (p.x - p.px) * 0.985;
          const vy = (p.y - p.py) * 0.985;
          p.px = p.x;
          p.py = p.y;
          p.x += vx;
          p.y += vy + minDim * 0.5 * step * step * 60;
        }
        // Mesafe kısıtları (birkaç yineleme yeterli)
        const rest = W / (seg - 1);
        for (let it = 0; it < 3; it++) {
          for (let i = 0; i < seg - 1; i++) {
            const a = pts[i];
            const b = pts[i + 1];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d = Math.hypot(dx, dy) || 1;
            const diff = (d - rest) / d * 0.5;
            const ox = dx * diff;
            const oy = dy * diff;
            if (i > 0) { a.x += ox; a.y += oy; }
            if (i + 1 < seg - 1) { b.x -= ox; b.y -= oy; }
          }
          // Uçlar sabit
          pts[0].x = 0; pts[0].y = H * (0.18 + 0.64 * (count === 1 ? 0.5 : r / (count - 1)));
          pts[seg - 1].x = W; pts[seg - 1].y = pts[0].y;
        }

        const c = tone(v, cfg, r / count, t);
        ctx.strokeStyle = rgba(c, 0.5 + e * 0.5);
        ctx.lineWidth = Math.max(1, v.lineWidth * (minDim / 900) * (0.6 + e));
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < seg; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
      this.glow.apply(this.canvas, v.glow, 0.75);
    }
    dispose() { this.ropes = null; }
  }

  // ==========================================================================
  // GALAKSİ — diferansiyel dönen parçacık diski
  // ==========================================================================
  class Galaxy {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      const r = rng(0x4411);
      this.N = 2600;
      this.rad = new Float32Array(this.N);
      this.ang = new Float32Array(this.N);
      this.arm = new Float32Array(this.N);
      this.jit = new Float32Array(this.N);
      for (let i = 0; i < this.N; i++) {
        // Merkeze doğru yoğunlaşan yarıçap dağılımı
        this.rad[i] = Math.pow(r(), 0.6);
        this.arm[i] = (r() * 2) | 0;
        this.ang[i] = r() * 0.9;
        this.jit[i] = (r() - 0.5) * 0.28;
      }
    }
    resize() {}
    draw(audio, cfg, t) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const sens = v.sensitivity || 1;
      ctx.clearRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2;
      const minDim = Math.min(W, H);
      const bass = clamp(audio.bass * sens, 0, 1.3);
      const R = minDim * 0.44 * (1 + bass * 0.1);
      const bars = audio.getBars(16, v.minFreq, v.maxFreq, v.spectrum);

      // Çekirdek
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, minDim * (0.05 + bass * 0.08));
      const cc = tone(v, cfg, 0.1, t);
      core.addColorStop(0, rgba(cc, 0.85));
      core.addColorStop(1, rgba(cc, 0));
      ctx.fillStyle = core;
      ctx.fillRect(0, 0, W, H);

      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < this.N; i++) {
        const rr = this.rad[i];
        // Diferansiyel dönme: içeri hızlı, dışarı yavaş
        const spin = t * (0.5 / (0.25 + rr)) * 0.5;
        const armOff = this.arm[i] * Math.PI;
        const a = this.ang[i] + armOff + rr * 5.2 + spin;
        const band = bars[Math.min(15, (rr * 16) | 0)];
        const e = clamp(band * sens, 0, 1);
        const rad = rr * R * (1 + this.jit[i] * 0.35 + e * 0.05);
        const x = cx + Math.cos(a) * rad;
        const y = cy + Math.sin(a) * rad * 0.42;
        const c = tone(v, cfg, rr, t);
        const s = Math.max(0.7, minDim * 0.0016 * (0.5 + v.thickness) * (0.6 + e));
        ctx.fillStyle = rgba(c, (0.15 + e * 0.6) * (1 - rr * 0.4));
        ctx.fillRect(x, y, s, s);
      }
      ctx.globalCompositeOperation = 'source-over';
      this.glow.apply(this.canvas, v.glow, 0.9);
    }
    dispose() {}
  }

  // ==========================================================================
  // DNA SARMALI
  // ==========================================================================
  class DNA {
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
      const sens = v.sensitivity || 1;
      ctx.clearRect(0, 0, W, H);

      const n = clamp(Math.round((v.barCount | 0) * 0.4), 40, 220);
      const bars = audio.getBars(n, v.minFreq, v.maxFreq, v.spectrum);
      const minDim = Math.min(W, H);
      const amp = minDim * 0.17 * (0.5 + v.thickness);
      const twist = 5.5;
      const lw = Math.max(1, v.lineWidth * (minDim / 900));

      const ptsA = [];
      const ptsB = [];
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        const y = f * H;
        const ph = f * twist * Math.PI + t * 1.1;
        const e = clamp(bars[i] * sens, 0, 1);
        const a = amp * (0.6 + e * 0.9);
        ptsA.push([W / 2 + Math.cos(ph) * a, y, Math.sin(ph), e]);
        ptsB.push([W / 2 + Math.cos(ph + Math.PI) * a, y, Math.sin(ph + Math.PI), e]);
      }

      // Basamaklar (önce, iplerin altında kalsın)
      for (let i = 0; i < n; i += 2) {
        const A = ptsA[i];
        const B = ptsB[i];
        const depth = (A[2] + 1) * 0.5;
        const c = tone(v, cfg, (i / n + 0.35) % 1, t);
        ctx.strokeStyle = rgba(c, (0.12 + A[3] * 0.6) * (0.35 + depth * 0.65));
        ctx.lineWidth = lw * (0.5 + A[3] * 0.9);
        ctx.beginPath();
        ctx.moveTo(A[0], A[1]);
        ctx.lineTo(B[0], B[1]);
        ctx.stroke();
      }

      for (const [pts, off] of [[ptsA, 0], [ptsB, 0.5]]) {
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const P = pts[i];
          if (i === 0) ctx.moveTo(P[0], P[1]); else ctx.lineTo(P[0], P[1]);
        }
        const c = tone(v, cfg, off, t);
        ctx.strokeStyle = rgba(c, 0.9);
        ctx.lineWidth = lw * 1.6;
        ctx.stroke();
        // Nükleotit noktaları
        for (let i = 0; i < n; i += 3) {
          const P = pts[i];
          const depth = (P[2] + 1) * 0.5;
          const c2 = tone(v, cfg, (i / n + off) % 1, t);
          ctx.fillStyle = rgba(c2, 0.35 + depth * 0.65);
          ctx.beginPath();
          ctx.arc(P[0], P[1], lw * (0.9 + P[3] * 1.6) * (0.5 + depth), 0, TAU);
          ctx.fill();
        }
      }
      this.glow.apply(this.canvas, v.glow, 0.8);
    }
    dispose() {}
  }

  // ==========================================================================
  // İZOMETRİK ŞEHİR — çubuk grafiği yerine mimari
  // ==========================================================================
  class IsoCity {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.h = null;
    }
    resize() {}
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const step = Math.min(0.05, dt || 0.016);
      const sens = v.sensitivity || 1;
      ctx.clearRect(0, 0, W, H);

      const grid = clamp(Math.round((v.barCount | 0) * 0.08), 5, 18);
      const total = grid * grid;
      if (!this.h || this.h.length !== total) this.h = new Float32Array(total);
      const bars = audio.getBars(total, v.minFreq, v.maxFreq, v.spectrum);

      const minDim = Math.min(W, H);
      const tile = minDim / (grid * 1.25);
      const tw = tile;
      const th = tile * 0.5;
      const maxH = minDim * 0.34 * (0.5 + v.thickness);
      const cx = W / 2;
      const cy = H / 2 + grid * th * 0.25;

      // Yükseklikler hızlı yükselir, yavaş iner — spektrum sıçraması yumuşasın
      for (let i = 0; i < total; i++) {
        const target = clamp(bars[i] * sens, 0, 1);
        const k = target > this.h[i] ? 1 - Math.exp(-step / 0.03) : 1 - Math.exp(-step / 0.35);
        this.h[i] += (target - this.h[i]) * k;
      }

      // Arkadan öne çiz: derinlik sırası doğru olsun
      for (let s = 0; s <= (grid - 1) * 2; s++) {
        for (let r = 0; r < grid; r++) {
          const c = s - r;
          if (c < 0 || c >= grid) continue;
          const i = r * grid + c;
          const e = this.h[i];
          const bh = e * maxH;
          const x = cx + (c - r) * tw * 0.5;
          const y = cy + (c + r) * th * 0.5 - grid * th * 0.5;
          const col = tone(v, cfg, (i / total + e * 0.2) % 1, t);
          const top = rgba(col, 0.95);
          const left = rgba([col[0] * 0.6 | 0, col[1] * 0.6 | 0, col[2] * 0.6 | 0], 0.95);
          const right = rgba([col[0] * 0.38 | 0, col[1] * 0.38 | 0, col[2] * 0.38 | 0], 0.95);

          // Sol yüz
          ctx.fillStyle = left;
          ctx.beginPath();
          ctx.moveTo(x - tw * 0.5, y);
          ctx.lineTo(x, y + th * 0.5);
          ctx.lineTo(x, y + th * 0.5 - bh);
          ctx.lineTo(x - tw * 0.5, y - bh);
          ctx.closePath();
          ctx.fill();
          // Sağ yüz
          ctx.fillStyle = right;
          ctx.beginPath();
          ctx.moveTo(x + tw * 0.5, y);
          ctx.lineTo(x, y + th * 0.5);
          ctx.lineTo(x, y + th * 0.5 - bh);
          ctx.lineTo(x + tw * 0.5, y - bh);
          ctx.closePath();
          ctx.fill();
          // Üst yüz
          ctx.fillStyle = top;
          ctx.beginPath();
          ctx.moveTo(x, y - th * 0.5 - bh);
          ctx.lineTo(x + tw * 0.5, y - bh);
          ctx.lineTo(x, y + th * 0.5 - bh);
          ctx.lineTo(x - tw * 0.5, y - bh);
          ctx.closePath();
          ctx.fill();
        }
      }
      this.glow.apply(this.canvas, v.glow, 0.5);
    }
    dispose() { this.h = null; }
  }

  // ==========================================================================
  // OSİLOSKOP (XY) — fosfor kalıcılığıyla gerçek vektör ekran görünümü
  // ==========================================================================
  class Scope {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.trail = null;
    }
    resize() { this.trail = null; }
    draw(audio, cfg, t) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      if (!this.trail || this.trail.width !== W || this.trail.height !== H) {
        this.trail = document.createElement('canvas');
        this.trail.width = W;
        this.trail.height = H;
        this.tctx = this.trail.getContext('2d');
      }
      const tc = this.tctx;
      // Fosfor sönümü: kalınlık ayarı kalıcılığı belirler
      tc.globalCompositeOperation = 'source-over';
      tc.fillStyle = 'rgba(0,0,0,' + (0.06 + (1 - v.thickness) * 0.22).toFixed(3) + ')';
      tc.fillRect(0, 0, W, H);
      tc.globalCompositeOperation = 'lighter';

      const wave = audio.timeBytes;
      const n = wave ? wave.length : 0;
      if (n > 4) {
        const minDim = Math.min(W, H);
        const R = minDim * 0.4 * (0.6 + (v.sensitivity || 1) * 0.6);
        const c = tone(v, cfg, 0.5, t);
        tc.strokeStyle = rgba(c, 0.85);
        tc.lineWidth = Math.max(1, v.lineWidth * 0.6 * (minDim / 900));
        tc.lineJoin = 'round';
        tc.beginPath();
        // X ekseni dalga, Y ekseni çeyrek periyot gecikmeli dalga:
        // gerçek bir XY ekranın Lissajous görüntüsü
        const lag = Math.max(1, (n / 12) | 0);
        for (let i = 0; i < n - lag; i += 2) {
          const x = W / 2 + ((wave[i] - 128) / 128) * R;
          const y = H / 2 - ((wave[i + lag] - 128) / 128) * R;
          if (i === 0) tc.moveTo(x, y); else tc.lineTo(x, y);
        }
        tc.stroke();
      }
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(this.trail, 0, 0);
    }
    dispose() { this.trail = null; this.tctx = null; }
  }

  // ==========================================================================
  // GONYOMETRE — stereo görüntü ve korelasyon ölçeri
  // ==========================================================================
  class Goniometer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.trail = null;
    }
    resize() { this.trail = null; }
    draw(audio, cfg, t) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      if (!this.trail || this.trail.width !== W || this.trail.height !== H) {
        this.trail = document.createElement('canvas');
        this.trail.width = W;
        this.trail.height = H;
        this.tctx = this.trail.getContext('2d');
      }
      const tc = this.tctx;
      tc.globalCompositeOperation = 'source-over';
      tc.fillStyle = 'rgba(0,0,0,0.12)';
      tc.fillRect(0, 0, W, H);
      tc.globalCompositeOperation = 'lighter';

      const minDim = Math.min(W, H);
      const cx = W / 2;
      const cy = H / 2;
      const R = minDim * 0.36;
      const wave = audio.timeBytes;
      const an = audio.analysis;

      /* Gerçek gonyometre L/R'yi 45° döndürülmüş eksende çizer: dikey eksen
         mono (orta), yatay eksen yan bilgi. Tek kanallı yakalamada L=R olur
         ve dikey bir çizgi görünür — bu da kendi başına doğru bilgidir. */
      if (wave && wave.length > 4) {
        const c = tone(v, cfg, 0.4, t);
        tc.fillStyle = rgba(c, 0.5);
        const side = an ? an.width : 0;
        for (let i = 0; i < wave.length; i += 2) {
          const s = (wave[i] - 128) / 128;
          const s2 = (wave[(i + 7) % wave.length] - 128) / 128;
          const l = s;
          const r = s * (1 - side) + s2 * side;
          const x = cx + ((l - r) / Math.SQRT2) * R;
          const y = cy - ((l + r) / Math.SQRT2) * R;
          tc.fillRect(x, y, 2, 2);
        }
      }

      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(this.trail, 0, 0);

      // Referans çemberi ve eksenler
      const g = tone(v, cfg, 0.85, t);
      ctx.strokeStyle = rgba(g, 0.22);
      ctx.lineWidth = Math.max(1, minDim / 700);
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
      ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
      ctx.stroke();

      // Korelasyon ölçeri
      if (an) {
        const bw = R * 1.4;
        const bx = cx - bw / 2;
        const by = cy + R * 1.16;
        const bh = Math.max(4, minDim * 0.012);
        ctx.fillStyle = rgba(g, 0.15);
        ctx.fillRect(bx, by, bw, bh);
        const p = (an.correlation * 0.5 + 0.5);
        const c = tone(v, cfg, p, t);
        ctx.fillStyle = rgba(c, 0.9);
        ctx.fillRect(bx + bw * 0.5, by, (p - 0.5) * bw, bh);
        ctx.fillStyle = rgba(g, 0.5);
        ctx.fillRect(bx + bw * 0.5 - 1, by - 2, 2, bh + 4);
      }
    }
    dispose() { this.trail = null; this.tctx = null; }
  }

  // ==========================================================================
  // KROMA ÇEMBERİ — 12 nota sınıfı, algılanan akor vurgulu
  // ==========================================================================
  class ChromaWheel {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.smooth = new Float32Array(12);
    }
    resize() {}
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const step = Math.min(0.05, dt || 0.016);
      ctx.clearRect(0, 0, W, H);

      const an = audio.analysis;
      const minDim = Math.min(W, H);
      const cx = W / 2;
      const cy = H / 2;
      const R = minDim * 0.4;
      const inner = R * 0.32;

      /* Beşliler çemberi sırası: yan yana duran dilimler müzikal olarak da
         komşu olur, böylece akor değişimi çemberde dönen bir hareket gibi
         görünür — kromatik sırada dağınık görünürdü. */
      const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
      const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

      const src = an ? an.chromaSmooth : null;
      let max = 0;
      for (let i = 0; i < 12; i++) {
        const val = src ? src[i] : 0;
        this.smooth[i] += (val - this.smooth[i]) * (1 - Math.exp(-step / 0.12));
        if (this.smooth[i] > max) max = this.smooth[i];
      }
      const norm = max > 1e-6 ? 1 / max : 0;
      const chordRoot = an && an.chord.root >= 0 && an.chord.confidence > 0.55 ? an.chord.root : -1;

      ctx.lineCap = 'butt';
      for (let s = 0; s < 12; s++) {
        const pc = FIFTHS[s];
        const e = clamp(this.smooth[pc] * norm, 0, 1);
        const a0 = (s / 12) * TAU - Math.PI / 2 - Math.PI / 12;
        const a1 = a0 + TAU / 12;
        const rOut = inner + (R - inner) * (0.15 + e * 0.85);
        const c = tone(v, cfg, s / 12, t);
        const isRoot = pc === chordRoot;
        ctx.fillStyle = rgba(c, (0.2 + e * 0.7) * (isRoot ? 1 : 0.75));
        ctx.beginPath();
        ctx.arc(cx, cy, rOut, a0 + 0.012, a1 - 0.012);
        ctx.arc(cx, cy, inner, a1 - 0.012, a0 + 0.012, true);
        ctx.closePath();
        ctx.fill();
        if (isRoot) {
          ctx.strokeStyle = rgba([255, 255, 255], 0.55);
          ctx.lineWidth = Math.max(1, minDim / 500);
          ctx.stroke();
        }
        // Nota adı — iç çemberin hemen içinde, akor adına yer bırakacak kadar dışta
        const mid = (a0 + a1) / 2;
        const tr = inner * 0.86;
        ctx.fillStyle = rgba(c, 0.55 + e * 0.45);
        ctx.font = Math.round(minDim * 0.028) + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(NAMES[pc], cx + Math.cos(mid) * tr, cy + Math.sin(mid) * tr);
      }

      // Ortada algılanan akor
      if (an && an.chord.confidence > 0.55) {
        const c = tone(v, cfg, 0.5, t);
        ctx.fillStyle = rgba(c, 0.9);
        // Akor adı iç çemberin içine sığmalı; nota halkasıyla çakışmasın
        ctx.font = '600 ' + Math.round(minDim * 0.05) + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(an.chord.name, cx, cy);
      }
      this.glow.apply(this.canvas, v.glow, 0.6);
    }
    dispose() {}
  }

  // ==========================================================================
  // ÇEKİCİ ALANI — formül kitaplığındaki çekiciler, sesle sürülen parametreler
  // ==========================================================================
  class AttractorField {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.trail = null;
      this.keys = null;
      this.idx = 0;
      this.onset = onset(0.6);
    }
    resize() { this.trail = null; }
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const step = Math.min(0.05, dt || 0.016);

      if (!this.keys) {
        // Yalnızca ayrık haritalar: kare başına on binlerce nokta üretip
        // 2B'de tortu bırakmaya en uygun olanlar
        const A = window.SVFormulas.ATTRACTORS;
        this.keys = Object.keys(A).filter((k) => A[k].discrete);
        if (!this.keys.length) this.keys = Object.keys(A);
      }
      if (!this.trail || this.trail.width !== W || this.trail.height !== H) {
        this.trail = document.createElement('canvas');
        this.trail.width = W;
        this.trail.height = H;
        this.tctx = this.trail.getContext('2d');
      }
      const tc = this.tctx;
      tc.globalCompositeOperation = 'source-over';
      tc.fillStyle = 'rgba(0,0,0,' + (0.04 + (1 - v.thickness) * 0.1).toFixed(3) + ')';
      tc.fillRect(0, 0, W, H);
      tc.globalCompositeOperation = 'lighter';

      const sens = v.sensitivity || 1;
      // Uzun aralıklı vuruşta çekici değişir — sahne kendi kendini yeniler
      if (this.onset.push(audio.bass * sens, step) > 0) {
        this.idx = (this.idx + 1) % this.keys.length;
      }
      const def = window.SVFormulas.ATTRACTORS[this.keys[this.idx]];
      const params = window.SVFormulas.defaults(def);
      // İlk iki parametre sese bağlanır: aynı çekici sürekli başka bir şekil
      const names = (def.params || []).map((p) => p.name);
      if (names[0]) {
        const p0 = def.params[0];
        params[names[0]] = p0.min + (p0.max - p0.min) * (0.35 + clamp(audio.bass * sens, 0, 1) * 0.3);
      }
      if (names[1]) {
        const p1 = def.params[1];
        params[names[1]] = p1.min + (p1.max - p1.min) * (0.4 + clamp(audio.treble * sens, 0, 1) * 0.25);
      }

      const minDim = Math.min(W, H);
      const scale = (def.scale || 0.3) * minDim * 1.6;
      const cx = W / 2 - (def.center ? def.center[0] * scale : 0);
      const cy = H / 2 - (def.center ? def.center[1] * scale : 0);
      const c = tone(v, cfg, clamp(audio.level * sens, 0, 1), t);
      tc.fillStyle = rgba(c, 0.55);
      const count = 9000;
      window.SVFormulas.iterate(def, params, {
        steps: count, dt: 0.01, skip: 200,
        onPoint: (q) => {
          const x = cx + q[0] * scale;
          const y = cy + q[1] * scale;
          if (x < 0 || x >= W || y < 0 || y >= H) return;
          tc.fillRect(x, y, 1.2, 1.2);
        },
      });

      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(this.trail, 0, 0);
      this.glow.apply(this.canvas, v.glow, 0.8);
    }
    dispose() { this.trail = null; this.tctx = null; this.keys = null; }
  }

  // ==========================================================================
  window.SVModes = window.SVModes || {};
  Object.assign(window.SVModes, {
    flowfield: FlowField,
    flock: Flock,
    voronoi: Voronoi,
    truchet: Truchet,
    moire: Moire,
    interference: Interference,
    ropes: Ropes,
    galaxy: Galaxy,
    dna: DNA,
    isocity: IsoCity,
    scope: Scope,
    goniometer: Goniometer,
    chromawheel: ChromaWheel,
    attractorfield: AttractorField,
  });
})();
