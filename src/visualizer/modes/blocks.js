'use strict';
/* Segment Barlar: klasik LED ekolayzır. Her sütun ayrık bloklara bölünür,
   seviye yükseldikçe bloklar sırayla yanar. Tepe bloğu bir süre asılı kalır. */
(function () {
  class BlocksMode {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.peaks = null;
      this.peakVel = null;
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
      const bars = audio.getBars(count, v.minFreq, v.maxFreq);
      ctx.clearRect(0, 0, W, H);

      // Blok sayısı ekran yüksekliğine göre; çok küçük bloklar oluşmasın
      const segs = Math.max(6, Math.min(40, Math.round(H / 26)));
      const slot = W / count;
      const gap = slot * Math.min(0.8, Math.max(0, v.gap));
      const bw = Math.max(1, slot - gap);
      const areaH = H * 0.92;
      const segH = areaH / segs;
      const segGap = Math.max(1, segH * 0.22);
      const blockH = Math.max(1, segH - segGap);
      const baseY = H;

      ctx.save();
      for (let i = 0; i < count; i++) {
        const val = Math.min(1, bars[i] * (v.sensitivity || 1));
        const lit = Math.round(val * segs);
        const x = i * slot + (slot - bw) / 2;

        for (let s = 0; s < segs; s++) {
          const ratio = s / (segs - 1);
          const on = s < lit;
          if (v.rainbow) {
            // Yükseklikle yeşil -> sarı -> kırmızı (klasik VU renklendirmesi)
            const hue = 130 - ratio * 130;
            ctx.fillStyle = on
              ? `hsl(${hue}, 90%, ${52 + ratio * 10}%)`
              : `hsla(${hue}, 45%, 26%, 0.20)`;
          } else {
            ctx.fillStyle = on ? v.color : 'rgba(255,255,255,0.06)';
          }
          const y = baseY - (s + 1) * segH + segGap * 0.5;
          ctx.fillRect(x, y, bw, blockH);
        }

        // tepe bloğu: hızlı yükselir, yavaş düşer
        const target = val * segs;
        if (target >= this.peaks[i]) {
          this.peaks[i] = target;
          this.peakVel[i] = 0;
        } else {
          this.peakVel[i] += 0.010;
          this.peaks[i] = Math.max(0, this.peaks[i] - this.peakVel[i]);
        }
        const ps = Math.min(segs - 1, Math.max(0, Math.floor(this.peaks[i])));
        if (this.peaks[i] > 0.4) {
          ctx.fillStyle = v.rainbow ? '#ffffff' : lighten(v.color);
          const py = baseY - (ps + 1) * segH + segGap * 0.5;
          ctx.fillRect(x, py, bw, Math.max(1.5, blockH * 0.28));
        }
      }
      ctx.restore();

      this.glow.apply(this.canvas, v.glow, 0.85);
    }
    dispose() {}
  }

  function lighten(hex) {
    const c = window.SV.hexToRgb01(hex);
    return `rgb(${Math.min(255, c[0] * 255 + 70) | 0},${Math.min(255, c[1] * 255 + 70) | 0},${Math.min(255, c[2] * 255 + 70) | 0})`;
  }

  window.SVModes = window.SVModes || {};
  window.SVModes.blocks = BlocksMode;
})();
