'use strict';
/* Küre: merkezde, frekans bantlarına göre şekil değiştiren yumuşak bir kütle.
   Baslar küreyi şişirir, tizler kenarına titreşim ekler. Logo ile iyi çalışır. */
(function () {
  const POINTS = 132;
  const HARM = 5; // spektrumdan türetilen harmonik sayısı

  class OrbMode {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.r = new Float32Array(POINTS); // yumuşatılmış yarıçaplar
      this.amp = new Float32Array(HARM); // harmonik genlikleri
      this.phase = new Float32Array(HARM);
      this.rot = 0;
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
      const sens = v.sensitivity || 1;
      this.rot += (dt || 0.016) * 0.22;
      const base = minDim * 0.20 * (1 + audio.bass * 0.45 * sens);

      // Frekansı açıya doğrudan eşlemek küreyi bozar: bas her zaman aynı tarafa
      // düşer, o taraf şişer, tiz tarafı çöker. Bunun yerine spektrum bantları
      // birer HARMONİK genliğine çevrilir — yarıçap açının periyodik bir
      // fonksiyonu olur, yani şekil kapalı, pürüzsüz ve yönsüzdür.
      const bands = audio.getBars(HARM, v.minFreq, v.maxFreq);
      for (let k = 0; k < HARM; k++) {
        const target = Math.min(1, bands[k] * sens);
        this.amp[k] += (target - this.amp[k]) * 0.22;
        // her harmonik kendi hızında döner: organik, tekrar etmeyen dalgalanma
        this.phase[k] += (dt || 0.016) * (0.35 + k * 0.19);
      }

      for (let i = 0; i < POINTS; i++) {
        const th = (i / POINTS) * Math.PI * 2;
        let d = 0;
        for (let k = 0; k < HARM; k++) {
          d += this.amp[k] * Math.sin((k + 2) * th + this.phase[k]);
        }
        // Sapma sıkıca sınırlanır: harmonikler üst üste bindiğinde yarıçap
        // aksi halde sıfırın altına inip şekli kendi üzerine katlıyor.
        const def = Math.max(-0.4, Math.min(0.4, (d / HARM) * 1.5 * sens));
        const target = base * (1 + def);
        this.r[i] += (target - this.r[i]) * 0.35;
      }

      // Gövde
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.rot);

      // Dolgu, şeklin ulaşabileceği en büyük yarıçapa (base*1.4) kadar uzanmalı
      // ve kenarda tamamen saydamlaşmamalı; aksi halde uzak loblar kararıp
      // gövdeden kopmuş gibi görünüyor.
      const grad = ctx.createRadialGradient(0, 0, base * 0.2, 0, 0, base * 1.45);
      if (v.rainbow) {
        const hue = (t * 26) % 360;
        grad.addColorStop(0, `hsla(${hue}, 92%, 70%, 0.98)`);
        grad.addColorStop(0.55, `hsla(${(hue + 60) % 360}, 88%, 60%, 0.80)`);
        grad.addColorStop(1, `hsla(${(hue + 140) % 360}, 85%, 54%, 0.45)`);
      } else {
        grad.addColorStop(0, hexA(v.color, 0.98));
        grad.addColorStop(0.55, hexA(v.color2 || v.color, 0.78));
        grad.addColorStop(1, hexA(v.color2 || v.color, 0.42));
      }
      ctx.fillStyle = grad;

      ctx.beginPath();
      for (let i = 0; i <= POINTS; i++) {
        const i0 = i % POINTS;
        const ang = (i0 / POINTS) * Math.PI * 2;
        const rr = this.r[i0];
        const x = Math.cos(ang) * rr;
        const y = Math.sin(ang) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();

      // Kenar çizgisi
      ctx.lineWidth = Math.max(1.5, (v.lineWidth || 3) * 0.8);
      ctx.strokeStyle = v.rainbow
        ? `hsla(${(t * 26 + 30) % 360}, 95%, 74%, 0.9)`
        : hexA(v.color, 0.9);
      ctx.stroke();
      ctx.restore();

      this.glow.apply(this.canvas, v.glow, 1.0);
    }
    dispose() {}
  }

  function hexA(hex, a) {
    const c = window.SV.hexToRgb01(hex);
    return `rgba(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0},${a})`;
  }

  window.SVModes = window.SVModes || {};
  window.SVModes.orb = OrbMode;
})();
