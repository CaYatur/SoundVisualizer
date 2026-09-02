'use strict';
/* Frekans spektrumu barları (2D canvas).
   Her bar = logaritmik bir frekans bandı. Rainbow / tek renk, ayna, tepe noktaları. */
(function () {
  class BarsMode {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.peaks = null;
      this.peakVel = null;
      this.glow = new window.SVGlow();
    }

    resize() {}

    _ensure(n) {
      if (!this.peaks || this.peaks.length !== n) {
        this.peaks = new Float32Array(n);
        this.peakVel = new Float32Array(n);
      }
    }

    draw(audio, cfg, t) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const count = Math.max(8, v.barCount | 0);
      this._ensure(count);

      const bars = audio.getBars(count, v.minFreq, v.maxFreq, v.spectrum);
      ctx.clearRect(0, 0, W, H);

      const mirror = v.mirror;
      const slot = W / count;
      const gap = slot * Math.min(0.8, Math.max(0, v.gap));
      const bw = Math.max(1, slot - gap);

      const baseY =
        v.position === 'bottom' ? H : v.position === 'center' ? H / 2 : H;
      const maxH =
        v.position === 'center' ? H * 0.46 : v.position === 'full' ? H * 0.95 : H * 0.92;

      // Parlama tek geçişte (bloom) uygulanır; şekiller burada düz çizilir.
      ctx.save();

      for (let i = 0; i < count; i++) {
        // ayna: ortadan dışa
        let idx = i;
        if (mirror) {
          const half = count / 2;
          idx = i < half ? Math.floor(half - 1 - i) : Math.floor(i - half);
        }
        let val = bars[idx] * v.sensitivity;
        val = Math.min(1, val);
        const bh = Math.max(1, val * maxH);

        const x = i * slot + (slot - bw) / 2;

        // renk
        let col;
        if (v.rainbow) {
          const hue = (i / count) * 320 + t * 12;
          col = `hsl(${hue % 360}, 85%, ${55 + val * 12}%)`;
        } else {
          col = v.color;
        }

        ctx.fillStyle = col;

        if (v.position === 'center') {
          roundRect(ctx, x, baseY - bh, bw, bh, bw * 0.4);
          ctx.fill();
          roundRect(ctx, x, baseY, bw, bh, bw * 0.4);
          ctx.fill();
        } else {
          roundRect(ctx, x, baseY - bh, bw, bh, bw * 0.4);
          ctx.fill();
        }

        // tepe noktaları
        if (v.cap) {
          if (val * maxH >= this.peaks[i]) {
            this.peaks[i] = val * maxH;
            this.peakVel[i] = 0;
          } else {
            this.peakVel[i] += H * 0.0009;
            this.peaks[i] = Math.max(0, this.peaks[i] - this.peakVel[i]);
          }
          const py = baseY - this.peaks[i] - 3;
          ctx.fillStyle = v.rainbow ? col : lighten(v.color);
          ctx.fillRect(x, py, bw, 2.5);
          if (v.position === 'center') ctx.fillRect(x, baseY + this.peaks[i] + 1, bw, 2.5);
        }
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

  function lighten(hex) {
    const c = window.SV.hexToRgb01(hex);
    return `rgb(${Math.min(255, c[0] * 255 + 60) | 0},${Math.min(255, c[1] * 255 + 60) | 0},${Math.min(255, c[2] * 255 + 60) | 0})`;
  }

  window.SVModes = window.SVModes || {};
  window.SVModes.bars = BarsMode;
})();
