/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
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
  /* grow: tuval yalnız büyür, kullanılan alan sc.w × sc.h. Ses nabzı
     görselin boyunu her karede değiştiriyor; tuvali her karede yeniden
     boyutlamak belleği yeniden ayırıp çizimi ~6 kat pahalı yapıyordu
     (1080p'de kare başına ~0,4 ms yerine ~2,5 ms, #695). Büyürken payla
     büyür ki küçük salınım yeniden ayırmasın. */
  function ensureScratch(owner, w, h, slot, grow) {
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
    if (grow) {
      if (sc.canvas.width < sw || sc.canvas.height < sh) {
        sc.canvas.width = Math.max(sc.canvas.width, Math.ceil((sw * 1.15) / 32) * 32);
        sc.canvas.height = Math.max(sc.canvas.height, Math.ceil((sh * 1.15) / 32) * 32);
      }
    } else if (sc.canvas.width !== sw || sc.canvas.height !== sh) {
      sc.canvas.width = sw;
      sc.canvas.height = sh;
    }
    sc.w = sw;
    sc.h = sh;
    return sc;
  }

  /* Blur çekirdeği sprite dikdörtgeninin dışına taşar. Pad, halenin
     tuval kenarında kırpılıp düz bir perde gibi görünmesini engeller.
     knockout: opak gövde haleden silinir.
     composite: hale zemine ışık ekler, beyaz source-over perde değil. */
  function edgeBloomLayout(glowBlur, amount) {
    const input = Math.max(0, Number(glowBlur) || 0);
    /* Girdi 1080p'de slider*40. %40'a kadar hale dar kalinca yigilip
       topak oluyor; %80'den sonra saçilan görünüm doğru.
       Ease-out: %10'da okunur, %40'ta saçık, %100'de 120px * çözünürlük.
       Şiddet 0'da kapalı, %100'de 3. İkisi de sürekli; beyaz perde yok.
       amount slider 0..1; verilmezse girdi 1080p sayılır. */
    let u = Number(amount);
    if (!Number.isFinite(u)) u = input > 0 ? input / 40 : 0;
    if (u < 0) u = 0;
    else if (u > 1) u = 1;
    const res = u > 0.0001 ? input / (40 * u) : 1;
    const spread = u * (2 - u);
    const glow = 120 * res * spread;
    const strength = 3 * spread;
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

  function drawEdgeBloom(ctx, source, x, y, w, h, rad, glow, fit, owner, amount) {
    const layout = edgeBloomLayout(glow, amount);
    const pad = layout.pad;
    const sw = w + pad * 2;
    const sh = h + pad * 2;
    const host = owner || drawImage;
    const sc = ensureScratch(host, sw, sh, '_svBloomSharp', true);
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

    const bc = ensureScratch(host, sw, sh, '_svBloomBlur', true);
    const b = bc.ctx;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalAlpha = 1;
    b.globalCompositeOperation = 'source-over';
    b.filter = 'none';
    b.shadowBlur = 0;
    b.clearRect(0, 0, bc.canvas.width, bc.canvas.height);
    /* Tuval büyük kalabilir; yalnız kullanılan alan (sw × sh) işlenir. */
    b.filter = 'blur(' + layout.glow.toFixed(2) + 'px)';
    b.drawImage(sc.canvas, 0, 0, sw, sh, 0, 0, sw, sh);
    b.filter = 'none';
    /* Opak gövdeyi del: hale yalnızca kenarın dışında kalsın, gövde yıkanmasın. */
    b.globalCompositeOperation = layout.knockout;
    b.drawImage(sc.canvas, 0, 0, sw, sh, 0, 0, sw, sh);
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
    for (let n = 0; n < whole; n++) ctx.drawImage(bc.canvas, 0, 0, sw, sh, x - pad, y - pad, sw, sh);
    if (frac > 0.0001) {
      ctx.globalAlpha = prevAlpha * frac;
      ctx.drawImage(bc.canvas, 0, 0, sw, sh, x - pad, y - pad, sw, sh);
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
      drawEdgeBloom(ctx, source, x, y, w, h, rad, glow, fit, o.owner || drawImage, o.glowAmount);
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
    const sc = ensureScratch(owner, w, h, null, true);
    const s = sc.ctx;
    const sw = sc.w;
    const sh = sc.h;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalAlpha = 1;
    s.globalCompositeOperation = 'source-over';
    s.filter = 'none';
    s.shadowBlur = 0;
    s.clearRect(0, 0, sc.canvas.width, sc.canvas.height);
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
    ctx.drawImage(sc.canvas, 0, 0, sw, sh, x, y, w, h);
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
