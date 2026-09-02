'use strict';
/* Arazi: spektrumun zaman içindeki geçmişi perspektifli bir tel kafes manzara
   olarak çizilir. Her satır bir anın spektrumu; satırlar ufka doğru kayar.

   Satır sayısı ve satır başına nokta sabittir, dolayısıyla maliyet ekran
   çözünürlüğünden bağımsızdır. */
(function () {
  const ROWS = 26;
  const COLS = 56;

  class TerrainMode {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.hist = [];
      this.acc = 0;
    }
    resize() {}

    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      ctx.clearRect(0, 0, W, H);

      const sens = v.sensitivity || 1;
      // Sabit aralıkla yeni satır ekle (kare hızından bağımsız akış)
      this.acc += (dt || 0.016) * 26;
      if (this.acc >= 1) {
        this.acc -= Math.floor(this.acc);
        const bars = audio.getBars(COLS, v.minFreq, v.maxFreq, v.spectrum);
        const row = new Float32Array(COLS);
        for (let i = 0; i < COLS; i++) {
          // simetrik: bas ortada, tizler kenarlara
          const m = i < COLS / 2 ? COLS / 2 - 1 - i : i - COLS / 2;
          row[i] = Math.min(1, bars[Math.min(COLS - 1, (m * 2) | 0)] * sens);
        }
        this.hist.unshift(row);
        if (this.hist.length > ROWS) this.hist.length = ROWS;
      }
      if (!this.hist.length) return;

      const horizon = H * 0.42;
      const depth = H - horizon;
      const peak = H * 0.26;

      ctx.save();
      ctx.lineJoin = 'round';

      // Yakından uzağa çiz ki yakın satırlar uzaktakileri örtsün
      for (let r = this.hist.length - 1; r >= 0; r--) {
        const row = this.hist[r];
        const k = r / ROWS; // 0 = en yeni (en yakın)
        // karesel perspektif: uzaktaki satırlar sıklaşır
        const y0 = horizon + depth * (1 - k) * (1 - k);
        const spread = 0.25 + (1 - k) * 0.95; // uzakta daralır
        const a = (1 - k) * (1 - k) * 0.9 + 0.08;

        ctx.globalAlpha = a;
        ctx.lineWidth = Math.max(1, Math.min(W, H) * 0.0022 * (1 - k * 0.5));
        if (v.rainbow) {
          ctx.strokeStyle = `hsl(${((1 - k) * 210 + t * 20) % 360}, 88%, ${56 - k * 12}%)`;
        } else {
          ctx.strokeStyle = k < 0.5 ? v.color : v.color2 || v.color;
        }

        ctx.beginPath();
        for (let i = 0; i < COLS; i++) {
          const u = i / (COLS - 1) - 0.5;
          const x = W / 2 + u * W * spread;
          const y = y0 - row[i] * peak * (0.35 + (1 - k) * 0.8);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      this.glow.apply(this.canvas, v.glow, 1.0);
    }
    dispose() {}
  }

  window.SVModes = window.SVModes || {};
  window.SVModes.terrain = TerrainMode;
})();
