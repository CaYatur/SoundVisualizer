'use strict';
/* Görselleştirici modlarının ikinci üretken bölümü (#638).

   Sözleşme diğer modlarla aynı:
     new Mode(canvas) -> draw(audio, cfg, t, dt) -> resize() -> dispose()

   Ortak yardımcılar generative.js'ten gelir (window.SVGenUtil); bu dosya
   ondan SONRA yüklenmeli. Rastgelelik yalnız tohumlu üreteçten: çevrimdışı
   dışa aktarım kare kare tekrarlanabilir kalmalı.

   Bellek sınırlı: geçmiş tutan modlar halka tampon, parçacık tutan modlar
   sabit havuz kullanır; kare başına dizi ya da gradyan üretilmez. Uzun
   oturumlarda yavaşlamanın en sık sebebi büyüyen diziler. */
(function () {
  const G = window.SVGenUtil;
  const { rng, tone, rgba, onset } = G;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // Kare başına tek sefer: renk modunun N basamaklı tablosu
  function toneTable(v, cfg, t, n, out) {
    for (let k = 0; k < n; k++) out[k] = tone(v, cfg, n === 1 ? 0.5 : k / (n - 1), t);
    return out;
  }

  // ==========================================================================
  // SIRT ÇİZGİLERİ — üst üste dizilmiş tayf geçmişi, öndeki arkadakini örter
  // ==========================================================================
  /* Satırlar yukarıdan aşağı çiziliyor; her satır kendi eğrisinin altını
     destination-out ile SİLİP sonra çizgisini çiziyor. Böylece öndeki tepe
     arkadaki çizgiyi gerçekten örtüyor ama tuval saydam kalıyor: arkaplan
     görünür. Opak bir dolgu arkaplanı kapatırdı. */
  const RIDGE_ROWS = 36;
  const RIDGE_RATE = 1 / 24; // saniyede 24 satır

  class Ridges {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.rows = null;
      this.n = 0;
      this.head = 0;
      this.filled = 0;
      this.acc = 0;
    }
    resize() {}
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const n = clamp(v.barCount | 0, 24, 128);
      if (!this.rows || this.n !== n) {
        this.rows = new Float32Array(RIDGE_ROWS * n);
        this.n = n;
        this.head = 0;
        this.filled = 0;
      }
      const sens = v.sensitivity || 1;
      const bars = audio.getBars(n, v.minFreq, v.maxFreq, v.spectrum);
      this.acc += Math.min(0.1, dt || 0.016);
      // Sabit hızda satır: kare hızı değişse de dalgaların aralığı aynı
      while (this.acc >= RIDGE_RATE) {
        this.acc -= RIDGE_RATE;
        this.head = (this.head + 1) % RIDGE_ROWS;
        this.filled = Math.min(RIDGE_ROWS, this.filled + 1);
        const o = this.head * n;
        for (let i = 0; i < n; i++) this.rows[o + i] = clamp(bars[i] * sens, 0, 1.4);
      }
      // En yeni satır her karede canlı: geçmiş sabit, ön çizgi akıcı
      {
        const o = this.head * n;
        for (let i = 0; i < n; i++) this.rows[o + i] = clamp(bars[i] * sens, 0, 1.4);
      }

      ctx.clearRect(0, 0, W, H);
      const minDim = Math.min(W, H);
      const x0 = W * 0.14;
      const x1 = W * 0.86;
      const yTop = H * 0.16;
      const yBot = H * 0.86;
      const gap = (yBot - yTop) / (RIDGE_ROWS - 1);
      const amp = gap * (4 + (v.thickness == null ? 0.5 : v.thickness) * 10);
      const lw = Math.max(1, v.lineWidth * 0.5 * (minDim / 1080));
      const dx = (x1 - x0) / (n - 1);
      ctx.lineJoin = 'round';

      if (!this.ys || this.ys.length !== n) this.ys = new Float32Array(n);
      const ys = this.ys;
      const curve = (base) => {
        ctx.moveTo(x0, base);
        let px = x0;
        let py = base;
        for (let i = 0; i < n; i++) {
          const x = x0 + i * dx;
          ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + ys[i]) / 2);
          px = x;
          py = ys[i];
        }
        ctx.lineTo(x1, base);
      };
      // En eski (üstte) önce; her yeni satır bir öncekinin önünde
      for (let k = this.filled - 1; k >= 0; k--) {
        const r = (this.head - k + RIDGE_ROWS) % RIDGE_ROWS;
        const o = r * n;
        const base = yBot - k * gap;
        for (let i = 0; i < n; i++) {
          // Kenarlar düz, ortası dağlık: klasik sırt görüntüsü
          const s = Math.sin((Math.PI * i) / (n - 1));
          // Üs 0,75: kısık sinyalde de tepeler seçilsin
          ys[i] = base - Math.pow(this.rows[o + i], 0.75) * amp * (0.12 + 0.88 * s * s);
        }
        // Önce altını sil (örtme), sonra yalnız eğriyi çiz
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = '#000';
        ctx.beginPath();
        curve(base);
        ctx.lineTo(x1, base + lw);
        ctx.lineTo(x0, base + lw);
        ctx.closePath();
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.beginPath();
        curve(base);
        const f = 1 - k / RIDGE_ROWS;
        ctx.strokeStyle = rgba(tone(v, cfg, f, t), (0.3 + 0.7 * f).toFixed(3));
        ctx.lineWidth = lw;
        ctx.stroke();
      }
      this.glow.apply(this.canvas, v.glow, 0.7);
    }
    dispose() { this.rows = null; this.ys = null; }
  }

  // ==========================================================================
  // SARKAÇ DALGASI — frekansları kademeli sarkaçlar, yukarıdan görünüm
  // ==========================================================================
  /* Her sarkacın frekansı bir öncekinden biraz yüksek: hep birlikte
     başlayıp yılan, ikili, üçlü desenlerden geçerek yeniden hizalanıyorlar.
     Ses zamanı hızlandırıyor (desen daha çabuk dönüyor), bantlar topların
     boyunu, vuruş salınım genliğini büyütüyor. */
  class Pendulum {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.onset = onset(0.16);
      this.clock = 0;
      this.kick = 0;
      this.cols = [];
    }
    resize() {}
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const step = Math.min(0.05, dt || 0.016);
      const sens = v.sensitivity || 1;
      const n = clamp(Math.round((v.barCount | 0) / 4), 12, 40);
      const bars = audio.getBars(n, v.minFreq, v.maxFreq, v.spectrum);
      const lvl = clamp(audio.level * sens, 0, 1.5);
      if (this.onset.push(audio.bass * sens, step) > 0) this.kick = 1;
      this.kick *= Math.exp(-step * 3.2);
      // 60 birimde bir tam hizalanma; ses zamanı en çok 3 kat hızlandırır
      this.clock += step * (0.6 + lvl * 1.4);
      ctx.clearRect(0, 0, W, H);

      const minDim = Math.min(W, H);
      const cx = W / 2;
      const top = H * 0.1;
      const bottom = H * 0.9;
      const rowH = (bottom - top) / (n - 1);
      const A = W * 0.3 * (0.55 + 0.45 * (v.thickness == null ? 0.5 : v.thickness)) * (1 + this.kick * 0.25);
      const baseR = Math.max(2, Math.min(rowH * 0.42, minDim * 0.02));
      toneTable(v, cfg, t, n, this.cols);

      // Merkez ekseni
      ctx.strokeStyle = rgba(this.cols[n >> 1], 0.12);
      ctx.lineWidth = Math.max(1, minDim / 900);
      ctx.beginPath();
      ctx.moveTo(cx, top - rowH);
      ctx.lineTo(cx, bottom + rowH);
      ctx.stroke();

      // Toplar arası "yılan" eğrisi
      ctx.strokeStyle = rgba(this.cols[0], 0.35);
      ctx.lineWidth = Math.max(1, v.lineWidth * 0.45 * (minDim / 1080));
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const f = (40 + i) / 60;
        const x = cx + A * Math.sin(TAU * f * this.clock);
        const y = top + i * rowH;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();

      for (let i = 0; i < n; i++) {
        const f = (40 + i) / 60;
        const x = cx + A * Math.sin(TAU * f * this.clock);
        const y = top + i * rowH;
        const e = clamp(bars[i] * sens, 0, 1.2);
        const c = this.cols[i];
        // Kol: eksenden topa soluk çizgi
        ctx.strokeStyle = rgba(c, 0.18);
        ctx.beginPath();
        ctx.moveTo(cx, y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillStyle = rgba(c, 0.95);
        ctx.beginPath();
        ctx.arc(x, y, baseR * (0.55 + e * 1.1), 0, TAU);
        ctx.fill();
      }
      this.glow.apply(this.canvas, v.glow, 0.8);
    }
    dispose() {}
  }

  // ==========================================================================
  // VU METRE — iki kanallı analog ibre, VU balistiği ve tepe ışığı
  // ==========================================================================
  /* 0 VU = -18 dBFS (yaygın yayın hizası). Ölçek -20..+3 VU; ibre kritik
     sönümlü ikinci dereceden bir sistem: ~300 ms'de hedefe varır, gerçek VU
     metrenin yükselme süresi. Hassasiyet ayarı kazançtır (dB kaydırır). */
  const VU_MARKS = [[-20, 0], [-10, 0.18], [-7, 0.28], [-5, 0.37], [-3, 0.49], [-2, 0.56], [-1, 0.63], [0, 0.71], [1, 0.79], [2, 0.88], [3, 1]];
  const VU_LABELS = [-20, -10, -7, -5, -3, 0, 3];
  function vuPos(db) {
    if (db <= VU_MARKS[0][0]) return 0;
    for (let i = 1; i < VU_MARKS.length; i++) {
      const [d1, p1] = VU_MARKS[i];
      if (db <= d1) {
        const [d0, p0] = VU_MARKS[i - 1];
        return p0 + ((db - d0) / (d1 - d0)) * (p1 - p0);
      }
    }
    return 1.04; // sonun biraz ötesine dayanır
  }
  function rmsOf(buf) {
    if (!buf || buf.length < 4) return 0;
    let s = 0;
    let n = 0;
    for (let i = 0; i < buf.length; i += 2) {
      const x = (buf[i] - 128) / 128;
      s += x * x;
      n++;
    }
    return Math.sqrt(s / n);
  }

  class VUMeter {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.pos = [0, 0];
      this.vel = [0, 0];
      this.peak = [0, 0];
    }
    resize() {}
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const step = Math.min(0.05, dt || 0.016);
      const gainDb = 20 * Math.log10(Math.max(0.05, v.sensitivity || 1));
      const chans = [audio.timeL || audio.timeBytes, audio.timeR || audio.timeBytes];
      ctx.clearRect(0, 0, W, H);

      const wide = W >= H;
      const mw = wide ? Math.min(W * 0.44, H * 1.5) : Math.min(W * 0.86, H * 0.66);
      const mh = mw * 0.62;
      const gapPx = mw * 0.08;
      const minDim = Math.min(W, H);
      const face = tone(v, cfg, 0.15, t);
      const ink = tone(v, cfg, 0.55, t);
      const needleC = tone(v, cfg, 0.9, t);
      ctx.font = Math.round(mw * 0.045) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let ch = 0; ch < 2; ch++) {
        const rms = rmsOf(chans[ch]);
        const dbfs = 20 * Math.log10(rms + 1e-6) + gainDb;
        const target = vuPos(dbfs + 18);
        // Kritik sönüm: ω=14 rad/s
        const k = 196;
        const c = 28;
        this.vel[ch] += ((target - this.pos[ch]) * k - this.vel[ch] * c) * step;
        this.pos[ch] = clamp(this.pos[ch] + this.vel[ch] * step, -0.02, 1.06);
        if (dbfs > -3) this.peak[ch] = 0.6; else this.peak[ch] = Math.max(0, this.peak[ch] - step);

        const ox = wide ? W / 2 + (ch === 0 ? -1 : 1) * (mw / 2 + gapPx / 2) : W / 2;
        const oy = wide ? H / 2 : H / 2 + (ch === 0 ? -1 : 1) * (mh / 2 + gapPx / 2);
        const x = ox - mw / 2;
        const y = oy - mh / 2;
        // Kadran
        ctx.fillStyle = rgba(face, 0.12);
        ctx.strokeStyle = rgba(ink, 0.35);
        ctx.lineWidth = Math.max(1, minDim / 700);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, mw, mh, mw * 0.04); else ctx.rect(x, y, mw, mh);
        ctx.fill();
        ctx.stroke();

        const px = ox;
        const py = y + mh * 1.02;
        const R = mh * 0.82;
        const a0 = -Math.PI / 2 - 0.82;
        const a1 = -Math.PI / 2 + 0.82;
        const ang = (p) => a0 + (a1 - a0) * p;
        // Ölçek yayı ve kırmızı bölge
        ctx.strokeStyle = rgba(ink, 0.7);
        ctx.lineWidth = Math.max(1, mw * 0.006);
        ctx.beginPath();
        ctx.arc(px, py, R, ang(0), ang(vuPos(0)));
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,82,72,0.9)';
        ctx.lineWidth = Math.max(2, mw * 0.018);
        ctx.beginPath();
        ctx.arc(px, py, R, ang(vuPos(0)), ang(1));
        ctx.stroke();
        // Çentikler ve sayılar
        ctx.lineWidth = Math.max(1, mw * 0.005);
        for (const [db, p] of VU_MARKS) {
          const a = ang(p);
          const major = VU_LABELS.indexOf(db) >= 0;
          ctx.strokeStyle = db > 0 ? 'rgba(255,82,72,0.9)' : rgba(ink, 0.8);
          ctx.beginPath();
          ctx.moveTo(px + Math.cos(a) * R, py + Math.sin(a) * R);
          ctx.lineTo(px + Math.cos(a) * (R * (major ? 0.9 : 0.94)), py + Math.sin(a) * (R * (major ? 0.9 : 0.94)));
          ctx.stroke();
          if (major) {
            ctx.fillStyle = db > 0 ? 'rgba(255,82,72,0.95)' : rgba(ink, 0.9);
            ctx.fillText((db > 0 ? '+' : '') + db, px + Math.cos(a) * R * 0.8, py + Math.sin(a) * R * 0.8);
          }
        }
        ctx.fillStyle = rgba(ink, 0.8);
        ctx.fillText('VU', px, y + mh * 0.62);
        ctx.fillText(ch === 0 ? 'L' : 'R', x + mw * 0.08, y + mh * 0.12);
        // Tepe ışığı
        ctx.fillStyle = this.peak[ch] > 0 ? 'rgba(255,70,60,0.95)' : 'rgba(255,70,60,0.15)';
        ctx.beginPath();
        ctx.arc(x + mw * 0.92, y + mh * 0.12, mw * 0.022, 0, TAU);
        ctx.fill();
        // İbre (kadranın içinde kalacak şekilde kırpılır)
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, mw, mh);
        ctx.clip();
        const a = ang(this.pos[ch]);
        ctx.strokeStyle = rgba(needleC, 0.95);
        ctx.lineWidth = Math.max(1.5, mw * 0.008);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(a) * R * 1.04, py + Math.sin(a) * R * 1.04);
        ctx.stroke();
        ctx.restore();
      }
    }
    dispose() {}
  }

  // ==========================================================================
  // RADAR GRAFİĞİ — örümcek ağı tayfı ve solan izleri
  // ==========================================================================
  const RADAR_TRAILS = 8;
  const RADAR_RATE = 1 / 10;

  class Radar {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.hist = null;
      this.m = 0;
      this.head = 0;
      this.filled = 0;
      this.acc = 0;
    }
    resize() {}
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const sens = v.sensitivity || 1;
      const m = clamp(Math.round((v.barCount | 0) / 8), 6, 16);
      if (!this.hist || this.m !== m) {
        this.hist = new Float32Array(RADAR_TRAILS * m);
        this.m = m;
        this.head = 0;
        this.filled = 0;
      }
      const bars = audio.getBars(m, v.minFreq, v.maxFreq, v.spectrum);
      this.acc += Math.min(0.1, dt || 0.016);
      while (this.acc >= RADAR_RATE) {
        this.acc -= RADAR_RATE;
        this.head = (this.head + 1) % RADAR_TRAILS;
        this.filled = Math.min(RADAR_TRAILS, this.filled + 1);
        const o = this.head * m;
        for (let i = 0; i < m; i++) this.hist[o + i] = clamp(bars[i] * sens, 0, 1.15);
      }
      ctx.clearRect(0, 0, W, H);
      const minDim = Math.min(W, H);
      const cx = W / 2;
      const cy = H / 2;
      const R = minDim * 0.4;
      const rot = t * 0.05 - Math.PI / 2;
      const ax = (i) => rot + (i / m) * TAU;
      const ink = tone(v, cfg, 0.2, t);

      // Izgara: dört halka ve kollar
      ctx.strokeStyle = rgba(ink, 0.16);
      ctx.lineWidth = Math.max(1, minDim / 900);
      ctx.beginPath();
      for (let ring = 1; ring <= 4; ring++) {
        const r = (R * ring) / 4;
        for (let i = 0; i <= m; i++) {
          const a = ax(i % m);
          if (i === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
          else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
      }
      for (let i = 0; i < m; i++) {
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(ax(i)) * R, cy + Math.sin(ax(i)) * R);
      }
      ctx.stroke();

      const poly = (o, live) => {
        ctx.beginPath();
        for (let i = 0; i <= m; i++) {
          const k = i % m;
          const val = live ? clamp(bars[k] * sens, 0, 1.15) : this.hist[o + k];
          // Karekök: kısık bantlar merkeze yığılmasın
          const r = R * (0.06 + 0.94 * Math.sqrt(val));
          const a = ax(k);
          if (i === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
          else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        ctx.closePath();
      };
      // İzler: eskiden yeniye
      ctx.lineWidth = Math.max(1, v.lineWidth * 0.35 * (minDim / 1080));
      for (let k = this.filled - 1; k >= 1; k--) {
        const r = (this.head - k + RADAR_TRAILS) % RADAR_TRAILS;
        poly(r * m, false);
        ctx.strokeStyle = rgba(tone(v, cfg, k / RADAR_TRAILS, t), (0.4 * (1 - k / RADAR_TRAILS)).toFixed(3));
        ctx.stroke();
      }
      // Canlı çokgen
      poly(0, true);
      const live = tone(v, cfg, 0.9, t);
      ctx.fillStyle = rgba(live, (0.1 + (v.thickness == null ? 0.5 : v.thickness) * 0.35).toFixed(3));
      ctx.fill();
      ctx.strokeStyle = rgba(live, 0.95);
      ctx.lineWidth = Math.max(1, v.lineWidth * 0.6 * (minDim / 1080));
      ctx.stroke();
      ctx.fillStyle = rgba(live, 1);
      for (let i = 0; i < m; i++) {
        const r = R * (0.06 + 0.94 * Math.sqrt(clamp(bars[i] * sens, 0, 1.15)));
        ctx.beginPath();
        ctx.arc(cx + Math.cos(ax(i)) * r, cy + Math.sin(ax(i)) * r, Math.max(2, minDim * 0.005), 0, TAU);
        ctx.fill();
      }
      this.glow.apply(this.canvas, v.glow, 0.8);
    }
    dispose() { this.hist = null; }
  }

  // ==========================================================================
  // KONFETİ — vuruşta top atışı, sabit havuzlu parçacıklar
  // ==========================================================================
  const CONFETTI_MAX = 700;
  const CONFETTI_COLORS = 8;

  class Confetti {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.rand = rng(0xc0f7);
      this.onset = onset(0.18);
      const N = CONFETTI_MAX;
      this.x = new Float32Array(N);
      this.y = new Float32Array(N);
      this.vx = new Float32Array(N);
      this.vy = new Float32Array(N);
      this.rot = new Float32Array(N);
      this.vr = new Float32Array(N);
      this.life = new Float32Array(N);
      this.size = new Float32Array(N);
      this.col = new Uint8Array(N);
      this.cursor = 0;
      this.side = 0;
      this.drizzle = 0;
      this.cols = [];
    }
    resize() { this.life.fill(0); }
    // Boş yuvaları halka biçiminde tarar; havuz doluysa en eskinin üstüne yazar
    _spawn(count, ox, oy, dirA, spread, speed) {
      const N = CONFETTI_MAX;
      for (let s = 0; s < count; s++) {
        let i = this.cursor;
        for (let tries = 0; tries < N && this.life[i] > 0; tries++) i = (i + 1) % N;
        this.cursor = (i + 1) % N;
        const a = dirA + (this.rand() - 0.5) * spread;
        const sp = speed * (0.55 + this.rand() * 0.6);
        this.x[i] = ox;
        this.y[i] = oy;
        this.vx[i] = Math.cos(a) * sp;
        this.vy[i] = Math.sin(a) * sp;
        this.rot[i] = this.rand() * TAU;
        this.vr[i] = (this.rand() - 0.5) * 14;
        this.life[i] = 3 + this.rand() * 2.5;
        this.size[i] = 0.6 + this.rand() * 0.8;
        this.col[i] = (this.rand() * CONFETTI_COLORS) | 0;
      }
    }
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const step = Math.min(0.05, dt || 0.016);
      const sens = v.sensitivity || 1;
      const bass = clamp(audio.bass * sens, 0, 1.5);
      const lvl = clamp(audio.level * sens, 0, 1.5);
      const minDim = Math.min(W, H);

      // Vuruşta sırayla sol ve sağ köşeden top atışı
      if (this.onset.push(audio.bass * sens, step) > 0) {
        const left = this.side++ % 2 === 0;
        const count = Math.round(36 + bass * 110);
        this._spawn(count, left ? W * 0.04 : W * 0.96, H * 1.02, left ? -Math.PI * 0.32 : -Math.PI * 0.68, 0.7, H * (1.35 + bass * 0.5));
      }
      // Seviye yüksekken yukarıdan hafif serpinti
      this.drizzle += step * lvl * 26;
      while (this.drizzle >= 1) {
        this.drizzle -= 1;
        this._spawn(1, this.rand() * W, -10, Math.PI / 2, 0.4, H * 0.08);
      }

      const g = H * 0.95;
      const drag = Math.exp(-step * 1.6);
      ctx.clearRect(0, 0, W, H);
      toneTable(v, cfg, t, CONFETTI_COLORS, this.cols);
      const base = minDim * 0.011;
      for (let k = 0; k < CONFETTI_COLORS; k++) {
        ctx.fillStyle = rgba(this.cols[k], 0.95);
        ctx.beginPath();
        for (let i = 0; i < CONFETTI_MAX; i++) {
          if (this.life[i] <= 0 || this.col[i] !== k) continue;
          // Hareket bu rengin geçişinde güncelleniyor: her parçacık tek kez
          this.vx[i] *= drag;
          this.vy[i] = this.vy[i] * drag + g * step;
          this.x[i] += (this.vx[i] + Math.sin(t * 3 + i) * minDim * 0.03) * step;
          this.y[i] += this.vy[i] * step;
          this.rot[i] += this.vr[i] * step;
          this.life[i] -= step;
          if (this.y[i] > H + 40 || this.x[i] < -60 || this.x[i] > W + 60) { this.life[i] = 0; continue; }
          // Takla: genişlik kosinüsle daralıp açılır
          const w = base * this.size[i] * Math.cos(this.rot[i] * 1.7);
          const h = base * this.size[i] * 0.55;
          const ca = Math.cos(this.rot[i]);
          const sa = Math.sin(this.rot[i]);
          const cx = this.x[i];
          const cy = this.y[i];
          ctx.moveTo(cx + ca * w - sa * h, cy + sa * w + ca * h);
          ctx.lineTo(cx - ca * w - sa * h, cy - sa * w + ca * h);
          ctx.lineTo(cx - ca * w + sa * h, cy - sa * w - ca * h);
          ctx.lineTo(cx + ca * w + sa * h, cy + sa * w - ca * h);
          ctx.closePath();
        }
        ctx.fill();
      }
    }
    dispose() {}
  }

  window.SVModes = window.SVModes || {};
  Object.assign(window.SVModes, {
    ridges: Ridges,
    pendulum: Pendulum,
    vumeter: VUMeter,
    radar: Radar,
    confetti: Confetti,
  });
})();
