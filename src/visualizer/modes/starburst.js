'use strict';
/* Işın: merkezden ekran kenarlarına uzanan, uca doğru incelip solan ışınlar.
   Işın uzunluğu kendi frekans bandına bağlıdır; bas darbesi hepsini birden iter. */
(function () {
  class StarburstMode {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      this.rot = 0;
      this.len = null;
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
      const count = Math.max(12, v.barCount | 0);
      if (!this.len || this.len.length !== count) this.len = new Float32Array(count);
      const bars = audio.getBars(count, v.minFreq, v.maxFreq, v.spectrum);
      const sens = v.sensitivity || 1;
      const maxR = Math.sqrt(cx * cx + cy * cy);
      const inner = Math.min(W, H) * 0.06;

      this.rot += (dt || 0.016) * 0.10;
      const push = 1 + audio.bass * 0.35 * sens;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.rot);
      ctx.lineCap = 'round';

      for (let i = 0; i < count; i++) {
        const target = Math.min(1, bars[i] * sens);
        // düşerken yavaşla: ışınlar sönerken iz bırakır
        this.len[i] = target > this.len[i] ? target : this.len[i] + (target - this.len[i]) * 0.16;
        const L = inner + this.len[i] * (maxR - inner) * 0.92 * push;
        if (L <= inner + 1) continue;

        const ang = (i / count) * Math.PI * 2;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);

        let col;
        if (v.rainbow) {
          col = `hsl(${((i / count) * 360 + t * 18) % 360}, 92%, ${58 + this.len[i] * 10}%)`;
        } else {
          col = v.color;
        }

        // Işınlar düz renkle çizilir. Her ışın için ayrı gradyan üretmek
        // (createLinearGradient x bar sayısı) ölçümde 1080p'de 75 FPS'i
        // 43 FPS'e düşürüyordu; uca doğru sönme aşağıda tek geçişte yapılır.
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(1.5, (Math.min(W, H) * 0.010) * (0.35 + this.len[i]) * (1 - v.gap * 0.5));

        ctx.beginPath();
        ctx.moveTo(ca * inner, sa * inner);
        ctx.lineTo(ca * L, sa * L);
        ctx.stroke();
      }
      ctx.restore();

      // Tek radyal maske: merkezde opak, kenara doğru saydam. Tüm ışınlar
      // aynı anda ve tek bir gradyanla sönümlenir (hüzme hissi korunur).
      ctx.save();
      ctx.globalCompositeOperation = 'destination-in';
      const fade = ctx.createRadialGradient(cx, cy, inner, cx, cy, maxR);
      fade.addColorStop(0, 'rgba(0,0,0,1)');
      fade.addColorStop(0.45, 'rgba(0,0,0,0.72)');
      fade.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();

      this.glow.apply(this.canvas, v.glow, 1.0);
    }
    dispose() {}
  }

  window.SVModes = window.SVModes || {};
  window.SVModes.starburst = StarburstMode;
})();
