'use strict';
/* Dalga formu / osiloskop (2D canvas). Zaman alanı verisinden çizgi.
   Rainbow gradyan ya da tek renk, ayna, dolgu, parlama. */
(function () {
  class WaveMode {
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

      const data = audio.timeBytes;
      if (!data) return;
      const n = data.length;
      const midY = H / 2;
      const amp = H * 0.42 * (v.thickness || 0.42) * 2 * (v.sensitivity || 1);
      // Dalga, tampon boyunca ORANSAL örneklenir. Önceden piksel başına bir
      // örnek ilerleniyordu; tuval zaman tamponundan (2048) genişse (geniş veya
      // yüksek DPI ekranlar) indis taşıp son örneğe kilitleniyor ve ekranın
      // kalanında düz bir çizgi bırakıyordu.
      const PTS = Math.max(2, Math.min(W, 2048));

      // gradyan
      let stroke;
      if (v.rainbow) {
        const grad = ctx.createLinearGradient(0, 0, W, 0);
        for (let s = 0; s <= 6; s++) {
          const hue = ((s / 6) * 320 + t * 20) % 360;
          grad.addColorStop(s / 6, `hsl(${hue},90%,60%)`);
        }
        stroke = grad;
      } else {
        const grad = ctx.createLinearGradient(0, 0, W, 0);
        grad.addColorStop(0, v.color);
        grad.addColorStop(1, v.color2 || v.color);
        stroke = grad;
      }

      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = v.lineWidth || 3;
      ctx.strokeStyle = stroke;
      // Parlama tek geçişte (bloom) uygulanır; çizgi burada düz çizilir.

      const path = new Path2D();
      for (let p = 0; p < PTS; p++) {
        const u = p / (PTS - 1);
        const x = u * W;
        const s = (data[Math.min(n - 1, Math.round(u * (n - 1)))] - 128) / 128;
        const y = midY + s * amp;
        if (p === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      ctx.stroke(path);

      // ayna (dikey yansıma)
      if (v.mirror) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.transform(1, 0, 0, -1, 0, H);
        ctx.stroke(path);
        ctx.restore();
      }

      // dolgu
      if (v.thickness > 0.5) {
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = stroke;
        const fill = new Path2D(path);
        fill.lineTo(W, midY);
        fill.lineTo(0, midY);
        fill.closePath();
        ctx.fill(fill);
      }
      ctx.restore();

      // İnce çizgi geniş bloom'da kaybolmasın diye biraz daha güçlü
      this.glow.apply(this.canvas, v.glow, 1.1);
    }
    dispose() {}
  }

  window.SVModes = window.SVModes || {};
  window.SVModes.wave = WaveMode;
})();
