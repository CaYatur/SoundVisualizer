'use strict';
/* Şerit: dalga formunun geçmişi. Her karede o anki dalga kaydedilir, eski
   dalgalar yukarı kayarak solar — perspektifli bir "kâğıt şerit" hissi verir.

   Dalga sabit sayıda noktaya indirgenir (ekran genişliğinden bağımsız), böylece
   çizim maliyeti çözünürlükten etkilenmez. */
(function () {
  const POINTS = 168; // dalga başına nokta
  const LAYERS = 26; // saklanan geçmiş dalga sayısı

  class RibbonMode {
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

      const data = audio.timeBytes;
      if (!data) return;

      // Yeni dalgayı sabit aralıklarla ekle (kare hızından bağımsız akış)
      this.acc += (dt || 0.016) * 46;
      if (this.acc >= 1) {
        this.acc -= Math.floor(this.acc);
        const row = new Float32Array(POINTS);
        const step = data.length / POINTS;
        for (let i = 0; i < POINTS; i++) {
          row[i] = (data[Math.min(data.length - 1, (i * step) | 0)] - 128) / 128;
        }
        this.hist.unshift(row);
        if (this.hist.length > LAYERS) this.hist.length = LAYERS;
      }
      if (!this.hist.length) return;

      const amp = H * 0.20 * (v.thickness || 0.42) * 2 * (v.sensitivity || 1);
      const topY = H * 0.22;
      const spanY = H * 0.56;

      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      // Eskiden yeniye çiz ki yeni dalga en önde kalsın
      for (let l = this.hist.length - 1; l >= 0; l--) {
        const row = this.hist[l];
        const k = l / LAYERS; // 0 = en yeni
        const y0 = topY + spanY * k;
        // uzaklaştıkça daralt ve solgunlaştır (perspektif hissi)
        const shrink = 1 - k * 0.45;
        const a = (1 - k) * (1 - k) * 0.95;
        if (a < 0.02) continue;

        ctx.globalAlpha = a;
        ctx.lineWidth = Math.max(1, (v.lineWidth || 3) * (1 - k * 0.55));
        if (v.rainbow) {
          const hue = ((1 - k) * 260 + t * 26) % 360;
          ctx.strokeStyle = `hsl(${hue}, 88%, ${58 - k * 14}%)`;
        } else {
          ctx.strokeStyle = k < 0.5 ? v.color : v.color2 || v.color;
        }

        ctx.beginPath();
        for (let i = 0; i < POINTS; i++) {
          const px = (W * 0.5) + ((i / (POINTS - 1)) - 0.5) * W * shrink;
          const py = y0 + row[i] * amp * shrink;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.restore();

      this.glow.apply(this.canvas, v.glow, 1.0);
    }
    dispose() {}
  }

  window.SVModes = window.SVModes || {};
  window.SVModes.ribbon = RibbonMode;
})();
