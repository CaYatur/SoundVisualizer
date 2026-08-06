'use strict';
/* Tek geçişli parlama (bloom).

   Canvas 2D'nin shadowBlur'ü çizilen HER şekil için ayrı bir bulanıklaştırma
   yapar. 72 barlı bir spektrumda bu kare başına 70-140 bulanıklaştırma demek ve
   ölçümde 1080p'de 75 FPS'i 57 FPS'e düşürüyor (kare süreleri de 13 ms ile 27 ms
   arasında zıplıyor — asıl takılma hissi buradan geliyor).

   Bunun yerine şekiller düz çizilir, sonra tuvalin küçültülmüş bir kopyası bir
   kez bulanıklaştırılıp 'lighter' ile üstüne bindirilir. Kare başına tek
   bulanıklaştırma ve o da 1/3 çözünürlükte. */
(function () {
  class GlowLayer {
    constructor() {
      this.scratch = document.createElement('canvas');
      this.sctx = this.scratch.getContext('2d');
      this.scale = 0.34; // bloom tamponu çözünürlük oranı
    }

    // src: şekillerin düz çizildiği tuval. amount: 0..1 (cfg.visualizer.glow)
    // strength: modun parlamaya ne kadar yatkın olduğu (ince çizgiler daha az ister)
    apply(src, amount, strength) {
      const a = Math.max(0, Math.min(1, amount || 0));
      if (a <= 0.001) return;
      const W = src.width;
      const H = src.height;
      if (!W || !H) return;

      const sw = Math.max(1, Math.round(W * this.scale));
      const sh = Math.max(1, Math.round(H * this.scale));
      if (this.scratch.width !== sw || this.scratch.height !== sh) {
        this.scratch.width = sw;
        this.scratch.height = sh;
      }

      const s = this.sctx;
      s.setTransform(1, 0, 0, 1, 0, 0);
      s.clearRect(0, 0, sw, sh);
      // Bulanıklık yarıçapı kısa kenara göre ölçeklenir ki çözünürlükten
      // bağımsız olarak aynı görünsün. Parlama arttıkça hale genişler ama
      // opaklık düşük tutulur: aksi halde eklemeli geçiş şeklin gövdesini de
      // aydınlatıp rengi beyaza doğru soldurur.
      const radius = Math.max(1, (Math.min(sw, sh) / 90) * (0.5 + a * 1.9));
      s.filter = 'blur(' + radius.toFixed(2) + 'px)';
      s.drawImage(src, 0, 0, sw, sh);
      s.filter = 'none';

      const ctx = src.getContext('2d');
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, a * 0.62 * (strength == null ? 1 : strength));
      ctx.drawImage(this.scratch, 0, 0, W, H);
      ctx.restore();
    }
  }

  window.SVGlow = GlowLayer;
})();
