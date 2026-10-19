/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* EKRANDAKİ YAZILARIN KARŞITLIĞI (#770).

   Öz test her temada panelin bütün kategorilerini açar ve bu tarayıcıyı
   çalıştırır. Statik testler tablodaki değişken ikililerini ölçer; bu ise
   tarayıcının GERÇEKTEN çizdiği rengi ölçer: bir panel satır içi bir renk
   yazarsa ya da bir yazıyı yanlış zemine koyarsa burada görünür.

   Yöntem: doğrudan yazı taşıyan her görünür öğe için hesaplanan `color` ve
   atalarından toplanan zemin katmanları (background-color ve geçişlerin
   renk durakları) temanın --bg rengi üstüne bindirilir. Geçişte durakların
   ortalaması alınır (yazı genelde ortada durur). Medya önizlemesi gibi
   görüntü üstündeki alanlar ve devre dışı denetimler sayılmaz (WCAG 1.4.3
   devre dışı denetimleri muaf tutar).

   Eşik: 4.5:1; büyük yazı (24 px ya da 18.66 px kalın) 3:1. AAA temada 7 ve
   4.5. */
(function () {
  /* color-mix() sonucu `color(srgb 0.1 0.2 0.3 / 0.5)` olarak hesaplanır
     (0–1 arası). Çözülemeyen zemin sessizce atlanıyor ve yazı alttaki
     karta göre ölçülüyordu: kullanıcı renkli klip hücreleri böyle geçti. */
  const parse = (s) => {
    const str = String(s || '');
    const alpha = (v) => {
      let a = v === undefined ? 1 : v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v);
      return Number.isFinite(a) ? a : 1;
    };
    const c = /color\(srgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/.exec(str);
    if (c) return [+c[1] * 255, +c[2] * 255, +c[3] * 255, alpha(c[4])];
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/.exec(str);
    if (!m) return null;
    return [+m[1], +m[2], +m[3], alpha(m[4])];
  };

  // Geçişin renk durakları (hesaplanan değer rgb()/rgba()/color() biçiminde gelir)
  function gradientStops(img) {
    if (!img || img === 'none' || img.indexOf('gradient') < 0 || img.indexOf('url(') >= 0) return null;
    const re = /(?:rgba?|color)\([^)]*\)/g;
    const stops = [];
    let m;
    while ((m = re.exec(img))) {
      const c = parse(m[0]);
      if (c) stops.push(c);
    }
    return stops.length ? stops : null;
  }

  function over(top, base) {
    const a = top[3];
    return [0, 1, 2].map((i) => top[i] * a + base[i] * (1 - a)).concat(1);
  }

  /* Durakların ortalaması saydamlıkla ağırlıklı: `transparent` durağı
     (rgba(0,0,0,0)) rengi karartmamalı, yalnız örtüyü inceltmeli. */
  function mean(list) {
    const n = list.length;
    const a = list.reduce((s, c) => s + c[3], 0);
    if (a <= 0) return [0, 0, 0, 0];
    return [0, 1, 2].map((i) => list.reduce((s, c) => s + c[i] * c[3], 0) / a).concat(a / n);
  }

  function luminance(c) {
    const ch = c.slice(0, 3).map((v) => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  function contrast(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /* Katmanlar yukarıdan aşağıya: [0] yazının hemen arkası. İlk opak katman
     taban olur, üstündekiler sırayla bindirilir; opak katman yoksa taban
     sayfanın zemini. */
  function backdrop(layers, pageBg) {
    const i = layers.findIndex((l) => l[3] >= 0.999);
    let base = i >= 0 ? layers[i] : pageBg;
    for (let j = (i >= 0 ? i : layers.length) - 1; j >= 0; j--) base = over(layers[j], base);
    return base;
  }

  function threshold(px, weight, aaa) {
    const large = px >= 24 || (px >= 18.66 && weight >= 700);
    if (aaa) return large ? 4.5 : 7;
    return large ? 3 : 4.5;
  }

  // Görüntü/medya üstündeki alanlar (yazı orada görüntünün üstünde durur)
  const SKIP = [
    '.preview-stage', '.studio-preview', '.md-thumb-box', '.logo-lib-thumb', '.img-thumb',
    '.scene-thumb', '.layer-preview', '.md-cell .md-fav', '.preset', '.up-swatch',
    /* Klip hücreleri ölçülür (zemin kullanıcının rengiyle boyalı ama oran
       her renkte yetecek kadar düşük); yalnız sahne önizlemesi taşıyanlar
       görüntü üstünde sayılır. */
    '.tpl-swatch', '.tl-swatch', '.cd-cell:has(> .cd-thumb)', '.perf-cell:has(> .perf-thumb)', '[aria-hidden="true"]',
    '.ui-theme-preview',
  ].join(',');

  function audit(doc, win, opts) {
    const o = opts || {};
    const pageBg = parse(o.pageBg) || [0, 0, 0, 1];
    /* Tema değişince renkler CSS geçişiyle (0.15 sn) değişiyor; arka plandaki
       bir pencerede geçiş ilerlemiyor ve eski temanın rengi ölçülüyordu.
       Ölçmeden önce bekleyen geçişler sonuna alınır. */
    if (typeof doc.getAnimations === 'function') {
      doc.getAnimations().forEach((an) => {
        if (an.constructor && an.constructor.name === 'CSSTransition') { try { an.finish(); } catch { /* sonsuz değil */ } }
      });
    }
    const fails = [];
    let checked = 0;
    let min = Infinity;
    const all = doc.body.querySelectorAll('*');
    for (let k = 0; k < all.length; k++) {
      const el = all[k];
      let hasText = false;
      for (let n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3 && n.nodeValue.trim()) { hasText = true; break; }
      }
      if (!hasText) continue;
      if (/^(SCRIPT|STYLE|OPTION|TEXTAREA|CANVAS|svg)$/i.test(el.tagName)) continue;
      if (el.closest(SKIP)) continue;
      if (el.closest(':disabled, [aria-disabled="true"], .disabled')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (rect.bottom < 0 || rect.top > win.innerHeight || rect.right < 0 || rect.left > win.innerWidth) continue;
      const cs = win.getComputedStyle(el);
      if (cs.visibility !== 'visible' || cs.display === 'none') continue;
      let fg = parse(cs.color);
      if (!fg) continue;
      // Opaklık: öğe ve ataları (devre dışı görünüm, soluk yazılar)
      let alpha = 1;
      const layers = [];
      let hidden = false;
      for (let p = el; p && p.nodeType === 1; p = p.parentElement) {
        const ps = p === el ? cs : win.getComputedStyle(p);
        if (ps.display === 'none' || ps.visibility === 'hidden') { hidden = true; break; }
        alpha *= parseFloat(ps.opacity);
        // Aynı öğede geçiş, zemin renginin üstünde çizilir
        const stops = gradientStops(ps.backgroundImage);
        if (stops) layers.push(mean(stops));
        const bc = parse(ps.backgroundColor);
        if (bc && bc[3] > 0) layers.push(bc);
      }
      if (hidden || alpha < 0.05) continue;
      // Kendi saydamlığıyla neredeyse görünmeyen süs yazıları (yer tutucu çizgiler)
      if (fg[3] * alpha < 0.05) continue;
      const bg = backdrop(layers, pageBg);
      fg = over([fg[0], fg[1], fg[2], fg[3] * alpha], bg);
      const ratio = contrast(fg, bg);
      checked++;
      const need = threshold(parseFloat(cs.fontSize), parseInt(cs.fontWeight, 10) || 400, !!o.aaa);
      if (ratio < min) min = ratio;
      if (ratio < need) {
        const text = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.nodeValue.trim()).join(' ').slice(0, 60);
        fails.push({ path: describe(el), text, ratio: Math.round(ratio * 100) / 100, need });
      }
    }
    return { checked, min: Math.round(min * 100) / 100, fails };
  }

  function describe(el) {
    const parts = [];
    for (let p = el; p && p.nodeType === 1 && parts.length < 4; p = p.parentElement) {
      let s = p.tagName.toLowerCase();
      if (p.id) s += '#' + p.id;
      else if (p.classList && p.classList.length) s += '.' + Array.from(p.classList).slice(0, 2).join('.');
      parts.unshift(s);
    }
    return parts.join(' > ');
  }

  const api = { audit, parse, gradientStops, mean, backdrop, over, contrast, threshold };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVUiContrastAudit = api;
})();
