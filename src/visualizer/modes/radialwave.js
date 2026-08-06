'use strict';
/* Dairesel Dalga: dalga formu bir çemberin çevresine sarılır (dairesel
   osiloskop). Çember spektruma değil, zaman alanına tepki verir; bu yüzden
   Çember modundan (ayrık frekans çubukları) belirgin biçimde farklıdır. */
(function () {
  const POINTS = 256;

  class RadialWaveMode {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.rot = 0;
    }
    resize() {}

    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      ctx.clearRect(0, 0, W, H);

      const data = audio.timeBytes;
      if (!data) return;
      const cx = W / 2;
      const cy = H / 2;
      const minDim = Math.min(W, H);
      const sens = v.sensitivity || 1;
      const baseR = minDim * 0.22 * (1 + audio.bass * 0.28 * sens);
      const amp = minDim * 0.13 * (v.thickness || 0.42) * 2 * sens;

      this.rot += (dt || 0.016) * 0.12;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.rot);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.5, v.lineWidth || 3);

      if (v.rainbow) {
        const grad = ctx.createLinearGradient(-baseR, -baseR, baseR, baseR);
        for (let s = 0; s <= 5; s++) {
          grad.addColorStop(s / 5, `hsl(${((s / 5) * 320 + t * 22) % 360}, 90%, 62%)`);
        }
        ctx.strokeStyle = grad;
      } else {
        const grad = ctx.createLinearGradient(-baseR, 0, baseR, 0);
        grad.addColorStop(0, v.color);
        grad.addColorStop(1, v.color2 || v.color);
        ctx.strokeStyle = grad;
      }

      const step = data.length / POINTS;
      ctx.beginPath();
      for (let i = 0; i <= POINTS; i++) {
        const idx = (i % POINTS) * step;
        const s = (data[Math.min(data.length - 1, idx | 0)] - 128) / 128;
        const ang = ((i % POINTS) / POINTS) * Math.PI * 2;
        const rr = baseR + s * amp;
        const x = Math.cos(ang) * rr;
        const y = Math.sin(ang) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();

      // ayna: içe doğru soluk ikinci halka
      if (v.mirror) {
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        for (let i = 0; i <= POINTS; i++) {
          const idx = (i % POINTS) * step;
          const s = (data[Math.min(data.length - 1, idx | 0)] - 128) / 128;
          const ang = ((i % POINTS) / POINTS) * Math.PI * 2;
          const rr = baseR - s * amp * 0.6;
          const x = Math.cos(ang) * rr;
          const y = Math.sin(ang) * rr;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      this.glow.apply(this.canvas, v.glow, 1.05);
    }
    dispose() {}
  }

  window.SVModes = window.SVModes || {};
  window.SVModes.radialWave = RadialWaveMode;
})();
