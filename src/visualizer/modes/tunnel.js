'use strict';
/* Tünel: üzerine doğru gelen halkalar. Her halka doğduğu andaki spektrumu
   saklar, yani müziğin son saniyeleri derinlikte katman katman görünür.
   Bas darbeleri akışı hızlandırır. */
(function () {
  const RINGS = 22;
  const SEG = 64; // halka başına köşe sayısı
  const HARM = 5; // spektrumdan türetilen harmonik sayısı

  class TunnelMode {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.rings = [];
      this.spawn = 0;
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
      const step = (dt || 0.016);
      const speed = 0.42 * (1 + audio.bass * 1.5 * sens);

      // Halkaları öne doğru taşı, yeterince yaklaşanları at.
      // Eşik 0.14: daha yakınında 1/z perspektifi patlayıp halkayı ekranın
      // katı boyutlarına çıkarıyor ve tünel yerine dev bir karalama oluyor.
      for (let i = this.rings.length - 1; i >= 0; i--) {
        this.rings[i].z -= step * speed;
        if (this.rings[i].z <= 0.14) this.rings.splice(i, 1);
      }

      // Düzenli aralıkla yeni halka doğur (o anki spektrumu saklar)
      this.spawn -= step * speed;
      if (this.spawn <= 0 && this.rings.length < RINGS) {
        this.spawn = 1 / RINGS;
        // Frekansı açıya doğrudan eşlemek halkaları tek yöne şişirir (bas hep
        // aynı tarafa düşer). Bantlar harmonik genliğine çevrilirse halka
        // kapalı, pürüzsüz ve yönsüz kalır; yalnızca spektrumun karakterine
        // göre loblanır.
        const bands = audio.getBars(HARM, v.minFreq, v.maxFreq);
        const shape = new Float32Array(SEG);
        const ph = t * 0.6;
        for (let s = 0; s < SEG; s++) {
          const th = (s / SEG) * Math.PI * 2;
          let d = 0;
          for (let k = 0; k < HARM; k++) {
            d += Math.min(1, bands[k] * sens) * Math.sin((k + 2) * th + ph * (1 + k * 0.4));
          }
          shape[s] = d / HARM;
        }
        this.rings.push({ z: 1, shape, hue: (t * 40) % 360, spin: (t * 0.5) % (Math.PI * 2) });
      }

      // Uzaktan yakına çiz
      this.rings.sort((a, b) => b.z - a.z);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.lineJoin = 'round';

      for (const ring of this.rings) {
        const persp = 1 / Math.max(0.14, ring.z); // yaklaştıkça büyür
        const baseR = minDim * 0.055 * persp;
        if (baseR > minDim * 1.2) continue;
        // Deformasyon halkanın kendi yarıçapına oranlı ve sınırlı: yakındaki
        // halkalar da yuvarlak kalır, sadece daha büyük görünür
        const wob = baseR * 0.34;
        const a = Math.min(1, (1 - ring.z) * 1.4) * Math.min(1, (ring.z - 0.14) * 5);
        if (a < 0.02) continue;

        ctx.globalAlpha = a;
        ctx.lineWidth = Math.max(1, minDim * 0.004 * persp);
        ctx.strokeStyle = v.rainbow
          ? `hsl(${(ring.hue + ring.z * 120) % 360}, 90%, ${60 - ring.z * 12}%)`
          : ring.z > 0.5
          ? v.color
          : v.color2 || v.color;

        ctx.beginPath();
        for (let s = 0; s <= SEG; s++) {
          const i0 = s % SEG;
          const ang = (i0 / SEG) * Math.PI * 2 + ring.spin;
          const rr = baseR + Math.max(-1, Math.min(1, ring.shape[i0])) * wob;
          const x = Math.cos(ang) * rr;
          const y = Math.sin(ang) * rr;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();

      this.glow.apply(this.canvas, v.glow, 1.0);
    }
    dispose() {}
  }

  window.SVModes = window.SVModes || {};
  window.SVModes.tunnel = TunnelMode;
})();
