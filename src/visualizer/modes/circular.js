'use strict';
/* Dairesel (radyal) spektrum. Merkez logo ile çok iyi uyumludur.
   Barlar bir çember etrafında dışa doğru uzar; bas merkez halkasını nabızlandırır. */
(function () {
  class CircularMode {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.rot = 0;
      this.glow = new window.SVGlow();
    }
    resize() {}

    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      ctx.clearRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2;
      const minDim = Math.min(W, H);
      const baseR = minDim * 0.18 * (1 + audio.bass * 0.25);
      const maxLen = minDim * 0.28 * (v.sensitivity || 1);
      const count = Math.max(16, v.barCount | 0);
      const bars = audio.getBars(count, v.minFreq, v.maxFreq);

      this.rot += (dt || 0.016) * 0.15;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.rot);
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, (Math.PI * 2 * baseR) / count * (1 - v.gap));
      // Parlama tek geçişte (bloom) uygulanır; şekiller burada düz çizilir.

      for (let i = 0; i < count; i++) {
        const val = Math.min(1, bars[i] * (v.sensitivity || 1));
        const len = val * maxLen;
        const ang = (i / count) * Math.PI * 2;
        const x0 = Math.cos(ang) * baseR;
        const y0 = Math.sin(ang) * baseR;
        const x1 = Math.cos(ang) * (baseR + len);
        const y1 = Math.sin(ang) * (baseR + len);

        let col;
        if (v.rainbow) {
          col = `hsl(${((i / count) * 360 + t * 20) % 360}, 85%, ${55 + val * 12}%)`;
        } else {
          col = v.color;
        }
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }

      // merkez halka (bas nabzı)
      ctx.lineWidth = 2;
      ctx.strokeStyle = v.rainbow
        ? `hsla(${(t * 30) % 360},80%,65%,0.5)`
        : hexA(v.color, 0.45);
      ctx.beginPath();
      ctx.arc(0, 0, baseR - 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      this.glow.apply(this.canvas, v.glow, 0.95);
    }
    dispose() {}
  }

  function hexA(hex, a) {
    const c = window.SV.hexToRgb01(hex);
    return `rgba(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0},${a})`;
  }

  window.SVModes = window.SVModes || {};
  window.SVModes.circular = CircularMode;
})();
