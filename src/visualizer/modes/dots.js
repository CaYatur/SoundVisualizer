'use strict';
/* Nokta Matris: sütun başına bir frekans bandı, satırlar seviye kademesi.
   Yanan noktalar dolu ve parlak, sönükler soluk bir ızgara bırakır. */
(function () {
  class DotsMode {
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
      const cols = Math.max(8, v.barCount | 0);
      const bars = audio.getBars(cols, v.minFreq, v.maxFreq);
      if (!this.peaks || this.peaks.length !== cols) this.peaks = new Float32Array(cols);
      ctx.clearRect(0, 0, W, H);

      const rows = Math.max(5, Math.min(48, Math.round(H / 30)));
      const slotX = W / cols;
      const slotY = (H * 0.94) / rows;
      const r = Math.max(1, Math.min(slotX, slotY) * 0.5 * (1 - Math.min(0.8, v.gap)));
      const baseY = H * 0.97;

      ctx.save();
      for (let i = 0; i < cols; i++) {
        const val = Math.min(1, bars[i] * (v.sensitivity || 1));
        const lit = val * rows;
        const cx = i * slotX + slotX / 2;

        for (let s = 0; s < rows; s++) {
          const on = s < lit;
          const ratio = s / (rows - 1);
          const cy = baseY - (s + 0.5) * slotY;
          if (v.rainbow) {
            const hue = ((i / cols) * 300 + t * 14) % 360;
            ctx.fillStyle = on
              ? `hsl(${hue}, 90%, ${52 + ratio * 14}%)`
              : `hsla(${hue}, 40%, 30%, 0.16)`;
          } else {
            ctx.fillStyle = on ? v.color : 'rgba(255,255,255,0.06)';
          }
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }

        // tepe noktası
        if (lit >= this.peaks[i]) this.peaks[i] = lit;
        else this.peaks[i] = Math.max(0, this.peaks[i] - 0.14);
        const ps = Math.min(rows - 1, Math.max(0, Math.floor(this.peaks[i])));
        if (this.peaks[i] > 0.5) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(cx, baseY - (ps + 0.5) * slotY, r * 0.45, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();

      this.glow.apply(this.canvas, v.glow, 0.9);
    }
    dispose() {}
  }

  window.SVModes = window.SVModes || {};
  window.SVModes.dots = DotsMode;
})();
