'use strict';
/* Yuvarlatilmiş görsel + parlama.

   clip() + shadowBlur birlikte kullanılınca gölge kırpma bölgesinin dışında
   kalır ve oval/yuvarlak kenarın dış ışığı kaybolur. Çözüm: önce kırpılmış
   silueti ara tuvale çiz, sonra onu shadowBlur ile bas — gölge alfa
   siluetini (yuvarlatılmış kenarı) takip eder.

   Logo parlaması (edgeBloom) bu beyaz shadowBlur yolunu KULLANMAZ.
   shadowColor beyaz + source-over, şeklin kenarına ışık eklemek yerine
   tüm kareyi beyaz/gri bir perdeyle kaldırır (slider ~%32'de belirgin).
   Siluet bulanıklaştırılır, opak gövde delinir, hale 'lighter' ile eklenir. */
(function () {
  function ensureScratch(owner, w, h, slot) {
    const sw = Math.max(1, Math.ceil(w));
    const sh = Math.max(1, Math.ceil(h));
    const key = slot || '_svRoundScratch';
    const host = owner || ensureScratch;
    if (!host[key]) {
      const canvas = document.createElement('canvas');
      host[key] = {
        canvas: canvas,
        ctx: canvas.getContext('2d'),
      };
    }
    const sc = host[key];
    if (sc.canvas.width !== sw || sc.canvas.height !== sh) {
      sc.canvas.width = sw;
      sc.canvas.height = sh;
    }
    return sc;
  }

  /* Blur çekirdeği sprite dikdörtgeninin dışına taşar. Pad, halenin
     tuval kenarında kırpılıp düz bir perde gibi görünmesini engeller.
     knockout: opak gövde haleden silinir.
     composite: hale zemine ışık ekler, beyaz source-over perde değil. */
  function edgeBloomLayout(glowBlur) {
    const input = Math.max(0, Number(glowBlur) || 0);
    /* Eski shadowBlur ölçeği: 1080p'de %100 = 40px. Opak gövde delinince
       yalnızca soluk kuyruk kalır; %100 ince bir çizgi gibi durur.
       Üst ucu yaklaşık 3 kat genişler ve hale lighter ile yinelenir.
       Renk siluetindir; beyaz source-over perde yok. */
    const u = Math.min(1, input / 40);
    const glow = input * (1 + 2 * u);
    /* Şiddet 0 iken kapalı, %100 iken 3. Basamak yok;
       slider ile sürekli artar. */
    const strength = u * (1 + 2 * u);
    const pad = Math.max(2, Math.ceil(glow * 3));
    return {
      glow: glow,
      strength: strength,
      pad: pad,
      knockout: 'destination-out',
      composite: 'lighter',
    };
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

  function drawEdgeBloom(ctx, source, x, y, w, h, rad, glow, fit, owner) {
    const layout = edgeBloomLayout(glow);
    const pad = layout.pad;
    const sw = w + pad * 2;
    const sh = h + pad * 2;
    const host = owner || drawImage;
    const sc = ensureScratch(host, sw, sh, '_svBloomSharp');
    const s = sc.ctx;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalAlpha = 1;
    s.globalCompositeOperation = 'source-over';
    s.filter = 'none';
    s.shadowBlur = 0;
    s.clearRect(0, 0, sc.canvas.width, sc.canvas.height);
    s.save();
    if (rad > 0.0001) {
      s.beginPath();
      const rr = Math.min(rad, Math.min(w, h) / 2);
      if (s.roundRect) s.roundRect(pad, pad, w, h, rr);
      else s.rect(pad, pad, w, h);
      s.clip();
    }
    drawFitted(s, source, pad, pad, w, h, fit);
    s.restore();

    const bc = ensureScratch(host, sw, sh, '_svBloomBlur');
    const b = bc.ctx;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalAlpha = 1;
    b.globalCompositeOperation = 'source-over';
    b.filter = 'none';
    b.shadowBlur = 0;
    b.clearRect(0, 0, bc.canvas.width, bc.canvas.height);
    b.filter = 'blur(' + layout.glow.toFixed(2) + 'px)';
    b.drawImage(sc.canvas, 0, 0);
    b.filter = 'none';
    /* Opak gövdeyi del: hale yalnızca kenarın dışında kalsın, gövde yıkanmasın. */
    b.globalCompositeOperation = layout.knockout;
    b.drawImage(sc.canvas, 0, 0);
    b.globalCompositeOperation = 'source-over';

    const prevOp = ctx.globalCompositeOperation;
    const prevAlpha = ctx.globalAlpha;
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.globalCompositeOperation = layout.composite;
    const strength = layout.strength;
    const whole = Math.floor(strength);
    const frac = strength - whole;
    for (let n = 0; n < whole; n++) ctx.drawImage(bc.canvas, x - pad, y - pad);
    if (frac > 0.0001) {
      ctx.globalAlpha = prevAlpha * frac;
      ctx.drawImage(bc.canvas, x - pad, y - pad);
      ctx.globalAlpha = prevAlpha;
    }
    ctx.globalCompositeOperation = prevOp;
    ctx.drawImage(sc.canvas, pad, pad, w, h, x, y, w, h);
  }

  /* ctx üzerine source'u (x,y,w,h) basar.
     opts.radiusPx: köşe yarıçapı piksel
     opts.glowBlur: shadowBlur yarıçapı (0 = parlama yok)
     opts.shadowColor: gölge rengi (edgeBloom dışı; drop shadow)
     opts.edgeBloom: beyaz perde yerine renkli kenar halesi
     opts.owner: scratch tuvalini tutan nesne (yeniden kullanım) */
  function drawImage(ctx, source, x, y, w, h, opts) {
    const o = opts || {};
    const rad = Math.max(0, o.radiusPx || 0);
    const glow = Math.max(0, o.glowBlur || 0);
    const color = o.shadowColor || 'rgba(255,255,255,0.7)';
    const fit = o.fit || 'stretch';

    if (glow > 0 && o.edgeBloom) {
      drawEdgeBloom(ctx, source, x, y, w, h, rad, glow, fit, o.owner || drawImage);
      return;
    }

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

  const api = { drawImage, drawFitted, ensureScratch, edgeBloomLayout, drawEdgeBloom };
  if (typeof window !== 'undefined') window.SVRoundImage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
