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

  /* Source'u (dx,dy,dw,dh) hedefine fit'e göre basar.
     fit: 'stretch' (varsayılan) | 'cover' | 'contain' */
  function drawFitted(ctx, source, dx, dy, dw, dh, fit) {
    const mode = fit || 'stretch';
    if (mode === 'stretch') {
      ctx.drawImage(source, dx, dy, dw, dh);
      return;
    }
    const iw = Math.max(1, source.naturalWidth || source.videoWidth || source.width || 1);
    const ih = Math.max(1, source.naturalHeight || source.videoHeight || source.height || 1);
    const scale = mode === 'contain'
      ? Math.min(dw / iw, dh / ih)
      : Math.max(dw / iw, dh / ih);
    const rw = iw * scale;
    const rh = ih * scale;
    const ox = dx + (dw - rw) / 2;
    const oy = dy + (dh - rh) / 2;
    ctx.drawImage(source, ox, oy, rw, rh);
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
    const fit = o.fit || 'stretch';

    if (rad <= 0.0001) {
      if (glow > 0) {
        ctx.shadowColor = color;
        ctx.shadowBlur = glow;
      }
      drawFitted(ctx, source, x, y, w, h, fit);
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
    drawFitted(s, source, 0, 0, sw, sh, fit);
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

  const api = { drawImage, drawFitted, ensureScratch };
  if (typeof window !== 'undefined') window.SVRoundImage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
