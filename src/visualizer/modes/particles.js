'use strict';
/* Parçacık: bas darbelerinde merkezden dışa parçacık fışkırır, yerçekimiyle
   yavaşlayıp söner. Havuz sabit boyuttadır — kare başına ayırma yapılmaz. */
(function () {
  const MAX = 420;

  class ParticlesMode {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.glow = new window.SVGlow();
      // Sabit havuz: x, y, vx, vy, ömür, ton
      this.px = new Float32Array(MAX);
      this.py = new Float32Array(MAX);
      this.vx = new Float32Array(MAX);
      this.vy = new Float32Array(MAX);
      this.life = new Float32Array(MAX);
      this.hue = new Float32Array(MAX);
      this.head = 0;
      // Eski uygulama "bas eşiği aştı ve önceki karede aşmamıştı" mandalıydı;
      // yoğun parçalarda bas eşiğin altına hiç inmediği için mandal bir daha
      // kurulmuyor ve patlama tek seferde kalıyordu. Artık artış hızına bakan
      // ortak algılayıcı kullanılıyor (bkz. src/shared/onset.js).
      this.onset = new window.SVOnset.Onset({ refractory: 0.1 });
      this.seed = 1;
    }
    resize() {}

    _rnd() {
      // tohumlu üreteç: çevrimdışı dışa aktarım deterministik kalsın
      this.seed ^= this.seed << 13; this.seed >>>= 0;
      this.seed ^= this.seed >> 17;
      this.seed ^= this.seed << 5; this.seed >>>= 0;
      return this.seed / 4294967296;
    }

    _emit(count, power, t) {
      for (let k = 0; k < count; k++) {
        const i = this.head;
        this.head = (this.head + 1) % MAX;
        const ang = this._rnd() * Math.PI * 2;
        const sp = (0.25 + this._rnd() * 0.85) * power;
        this.px[i] = 0;
        this.py[i] = 0;
        this.vx[i] = Math.cos(ang) * sp;
        this.vy[i] = Math.sin(ang) * sp;
        this.life[i] = 1;
        this.hue[i] = (t * 40 + this._rnd() * 90) % 360;
      }
    }

    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const v = cfg.visualizer;
      ctx.clearRect(0, 0, W, H);

      const step = Math.min(0.05, dt || 0.016);
      const minDim = Math.min(W, H);
      const sens = v.sensitivity || 1;

      // Her bas darbesinde patlama — art arda gelen vuruşlar da sayılır
      const hit = this.onset.push(audio.bass * sens, step);
      if (hit > 0) this._emit(Math.round(18 + hit * 34), (0.7 + hit * 0.8) * (1 + audio.bass * sens), t);
      // sürekli akış: sahne sessiz anlarda da tamamen boşalmasın
      if (audio.level * sens > 0.04) this._emit(2, 0.4 + audio.level * sens * 0.9, t);

      const cx = W / 2;
      const cy = H / 2;
      ctx.save();
      ctx.translate(cx, cy);
      for (let i = 0; i < MAX; i++) {
        if (this.life[i] <= 0) continue;
        this.life[i] -= step * 0.55;
        if (this.life[i] <= 0) continue;
        this.vy[i] += step * 0.28; // yerçekimi
        this.vx[i] *= 1 - step * 0.5; // sürtünme
        this.vy[i] *= 1 - step * 0.5;
        this.px[i] += this.vx[i] * step;
        this.py[i] += this.vy[i] * step;

        const a = Math.min(1, this.life[i]);
        const r = Math.max(1, minDim * 0.006 * a * (1 + audio.bass * 0.5));
        ctx.fillStyle = v.rainbow
          ? `hsla(${this.hue[i]}, 92%, 64%, ${a})`
          : hexA(v.color, a);
        ctx.beginPath();
        ctx.arc(this.px[i] * minDim * 0.5, this.py[i] * minDim * 0.5, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      this.glow.apply(this.canvas, v.glow, 1.15);
    }
    dispose() {}
  }

  function hexA(hex, a) {
    const c = window.SV.hexToRgb01(hex);
    return `rgba(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0},${a})`;
  }

  window.SVModes = window.SVModes || {};
  window.SVModes.particles = ParticlesMode;
})();
