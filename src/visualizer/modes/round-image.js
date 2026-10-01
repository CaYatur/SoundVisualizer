'use strict';
/* Yuvarlatilmiş görsel + parlama.

   clip() + shadowBlur birlikte kullanılınca gölge kırpma bölgesinin dışında
   kalır ve oval/yuvarlak kenarın dış ışığı kaybolur. Çözüm: önce kırpılmış
   silueti ara tuvale çiz, sonra onu shadowBlur ile bas — gölge alfa
   siluetini (yuvarlatılmış kenarı) takip eder. */
(function () {
  function ensureScratch(owner, w, h) {
    const sw = Math.max(1, Math.ceil(w));
    const sh = Math.max(1, Math.ceil(h));
    if (!owner._svRoundScratch) {
      owner._svRoundScratch = {
        canvas: document.createElement('canvas'),
        ctx: null,
      };
      owner._svRoundScratch.ctx = owner._svRoundScratch.canvas.getContext('2d');
    }
    const sc = owner._svRoundScratch;
    if (sc.canvas.width !== sw || sc.canvas.height !== sh) {
      sc.canvas.width = sw;
      sc.canvas.height = sh;
    }
    return sc;
  }

  /* ctx üzerine source'u (x,y,w,h) basar.
     opts.radiusPx: köşe yarıçapı piksel
     opts.glowBlur: shadowBlur yarıçapı (0 = parlama yok)
     opts.shadowColor: gölge rengi
     opts.owner: scratch tuvalini tutan nesne (yeniden kullanım) */
  function drawImage(ctx, source, x, y, w, h, opts) {
    const o = opts || {};
    const rad = Math.max(0, o.radiusPx || 0);
    const glow = Math.max(0, o.glowBlur || 0);
    const color = o.shadowColor || 'rgba(255,255,255,0.7)';

    if (rad <= 0.0001) {
      if (glow > 0) {
        ctx.shadowColor = color;
        ctx.shadowBlur = glow;
      }
      ctx.drawImage(source, x, y, w, h);
      if (glow > 0) {
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      }
      return;
    }

    const owner = o.owner || drawImage;
    const sc = ensureScratch(owner, w, h);
    const s = sc.ctx;
    const sw = sc.canvas.width;
    const sh = sc.canvas.height;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalAlpha = 1;
    s.globalCompositeOperation = 'source-over';
    s.filter = 'none';
    s.shadowBlur = 0;
    s.clearRect(0, 0, sw, sh);
    s.save();
    s.beginPath();
    const rr = Math.min(rad, Math.min(sw, sh) / 2);
    if (s.roundRect) s.roundRect(0, 0, sw, sh, rr);
    else s.rect(0, 0, sw, sh);
    s.clip();
    s.drawImage(source, 0, 0, sw, sh);
    s.restore();

    if (glow > 0) {
      ctx.shadowColor = color;
      ctx.shadowBlur = glow;
    }
    ctx.drawImage(sc.canvas, x, y, w, h);
    if (glow > 0) {
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
  }

  const api = { drawImage, ensureScratch };
  if (typeof window !== 'undefined') window.SVRoundImage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
