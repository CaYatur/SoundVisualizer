'use strict';
/* Merkez Barlar: ekranın ortasından yukarı ve aşağı simetrik açılan barlar.
   Baslar merkezde, tizler kenarlara doğru (aynalı). Logo ile çok uyumludur. */
(function () {
  class CenterBarsMode {
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
      const count = Math.max(8, v.barCount | 0);
      const bars = audio.getBars(count, v.minFreq, v.maxFreq, v.spectrum);

      ctx.clearRect(0, 0, W, H);
      const midY = H / 2;
      const maxH = H * 0.44 * (v.sensitivity || 1);
      const slot = W / count;
      const gap = slot * Math.min(0.8, Math.max(0, v.gap));
      const bw = Math.max(1, slot - gap);
      const center = (count - 1) / 2;
      const half = Math.max(1, count / 2);

      // Parlama tek geçişte (bloom) uygulanır; şekiller burada düz çizilir.
      ctx.save();

      for (let i = 0; i < count; i++) {
        // baslar ortada: merkeze uzaklık -> frekans bandı
        const dist = Math.abs(i - center);
        const bandIdx = Math.min(count - 1, Math.round((dist / half) * (count - 1)));
        let val = Math.min(1, bars[bandIdx] * (v.sensitivity || 1));
        const bh = Math.max(1, val * maxH);
        const x = i * slot + (slot - bw) / 2;

        let col;
        if (v.rainbow) {
          const hue = ((bandIdx / count) * 300 + t * 14) % 360;
          col = `hsl(${hue}, 85%, ${56 + val * 12}%)`;
        } else {
          col = v.color;
        }
        ctx.fillStyle = col;

        roundRect(ctx, x, midY - bh, bw, bh, bw * 0.4);
        ctx.fill();
        roundRect(ctx, x, midY, bw, bh, bw * 0.4);
        ctx.fill();
      }
      ctx.restore();

      this.glow.apply(this.canvas, v.glow, 0.9);
    }
    dispose() {}
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  window.SVModes = window.SVModes || {};
  window.SVModes.centerBars = CenterBarsMode;
})();
