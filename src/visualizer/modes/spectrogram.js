'use strict';
/* Spektrogram (şelale): zaman-frekans haritası. Her karede sağa yeni bir sütun
   eklenir, geçmiş sola kayar. Düşük frekanslar altta.

   Geçmiş, ekran çözünürlüğünden bağımsız küçük bir tampon tuvalde tutulur ve
   ekrana gerdirilerek çizilir; böylece 4K'da bile kaydırma maliyeti sabittir. */
(function () {
  const HIST_W = 420; // geçmiş sütun sayısı

  class SpectrogramMode {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.hist = document.createElement('canvas');
      this.hctx = this.hist.getContext('2d');
      this.rows = 0;
      this.acc = 0;
    }
    resize() {}

    _ensure(rows) {
      if (this.rows === rows) return;
      this.rows = rows;
      this.hist.width = HIST_W;
      this.hist.height = rows;
      this.hctx.clearRect(0, 0, HIST_W, rows);
    }

    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      const rows = Math.max(24, Math.min(256, v.barCount | 0 || 96));
      this._ensure(rows);
      const bars = audio.getBars(rows, v.minFreq, v.maxFreq, v.spectrum);

      // Kaydırma hızı kare hızından bağımsız olsun diye zamana göre birikir
      this.acc += (dt || 0.016) * 62;
      let steps = Math.floor(this.acc);
      this.acc -= steps;
      steps = Math.min(4, steps); // uzun donmalardan sonra sıçramayı sınırla

      const h = this.hctx;
      for (let s = 0; s < steps; s++) {
        // geçmişi bir sütun sola kaydır
        h.globalCompositeOperation = 'copy';
        h.drawImage(this.hist, -1, 0);
        h.globalCompositeOperation = 'source-over';
        // en sağa yeni sütun
        for (let r = 0; r < rows; r++) {
          const val = Math.min(1, bars[r] * (v.sensitivity || 1));
          h.fillStyle = colorFor(val, v, t);
          // düşük frekans altta olsun diye ters çevrilir
          h.fillRect(HIST_W - 1, rows - 1 - r, 1, 1);
        }
      }

      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      ctx.drawImage(this.hist, 0, 0, HIST_W, rows, 0, 0, W, H);
      ctx.restore();
    }
    dispose() {}
  }

  // Yoğunluk -> renk. Rainbow'da klasik ısı haritası, tek renkte parlaklık rampası.
  function colorFor(val, v, t) {
    if (val < 0.012) return 'rgba(0,0,0,0)';
    if (v.rainbow) {
      // 250 (mor/mavi) -> 0 (kırmızı): düşük enerji koyu mavi, yüksek enerji kırmızı
      const hue = 250 - Math.pow(val, 0.75) * 250;
      const light = 12 + Math.pow(val, 0.6) * 52;
      return `hsl(${hue}, 92%, ${light}%)`;
    }
    const c = window.SV.hexToRgb01(v.color);
    const k = Math.pow(val, 0.7);
    return `rgba(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0},${k.toFixed(3)})`;
  }

  window.SVModes = window.SVModes || {};
  window.SVModes.spectrogram = SpectrogramMode;
})();
