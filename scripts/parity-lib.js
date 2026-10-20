/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Eşlik ölçümünün (#539, scripts/parity.js) saf kısmı: durumlar, yapılandırma
   ve piksel karşılaştırması. Electron'suz; testler kullanıyor. */

// Sayfada üretilen logo: kitaplık ya da dosya gerekmesin
const LOGO_SCRIPT = `(() => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#ffcc33'; x.fillRect(8, 8, 240, 112);
  x.fillStyle = '#1a1a2e'; x.font = 'bold 64px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('LOGO', 128, 66);
  return c.toDataURL('image/png');
})()`;

/* Her durumun tabanı: katman yığını, sayfanın kendi döngüsü durur
   (sessizlikte duraklat; ses yok), geçiş yok. */
function baseConfig() {
  return {
    power: { fpsCap: 0, renderScale: 1, pauseOnSilence: true, hideCursor: true },
    /* Düz siyah zemin + görselleştirici yok "karartma" sayılır ve canlı
       yol tek yüzeye (drawTo) iner: iki yol aynı kodu ölçerdi. */
    isBlackout: false,
    autovj: { enabled: false },
    lighting: { enabled: false },
    transition: { enabled: false },
    postfx: [],
    layerStack: { enabled: true },
    background: { type: 'solid', solidColor: '#000000' },
    visualizer: { type: 'none' },
    layers: [],
  };
}

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function merge(a, b) {
  const out = Object.assign({}, a);
  for (const k of Object.keys(b || {})) out[k] = isObj(a[k]) && isObj(b[k]) ? merge(a[k], b[k]) : b[k];
  return out;
}
function mergeCase(base, c) { return merge(base, c.cfg || {}); }

/* Yayın öğeleri */
const L = {
  bg: (extra) => Object.assign({ id: 'p_bg', kind: 'background', type: 'aurora' }, extra || {}),
  solid: (color) => ({ id: 'p_solid', kind: 'background', type: 'solid', settings: { background: { type: 'solid', solidColor: color } } }),
  bars: (extra) => Object.assign({ id: 'p_bars', kind: 'visualizer', type: 'bars',
    settings: { visualizer: { type: 'bars', barCount: 48, rainbow: true, glow: 0.3, barSpan: 0.8, barHeight: 0.4, baseline: 0.62 } } }, extra || {}),
  text: (extra) => Object.assign({ id: 'p_text', kind: 'visualizer', type: 'text',
    settings: { text: { enabled: true, content: 'PARITY 539', x: 0.5, y: 0.22, size: 0.09, animation: 'none' } } }, extra || {}),
  card: (extra) => Object.assign({ id: 'p_card', kind: 'nowplaying', type: 'nowplaying',
    settings: { nowplaying: { enabled: true, source: 'manual', manual: { title: 'Parity Title', artist: 'Parity Artist' }, x: 0.5, y: 0.86, mode: 'always', animation: 'none' } } }, extra || {}),
  logo: (src, extra) => Object.assign({ id: 'p_logo', kind: 'logo',
    settings: { logo: { enabled: true, source: 'manual', src, x: 0.86, y: 0.16, scale: 0.18 } } }, extra || {}),
};

const BLENDS = ['screen', 'multiply', 'overlay', 'add', 'difference', 'lighten', 'darken', 'color-dodge', 'soft-light', 'hard-light', 'exclusion', 'hue', 'luminosity'];

function cases(logo) {
  const out = [];
  const stack = (layers, extra) => ({ cfg: merge({ layers }, extra || {}) });
  out.push(Object.assign({ name: 'layout-basic', t: 2 }, stack([L.solid('#101828'), L.bars(), L.text(), L.card(), L.logo(logo)])));
  out.push(Object.assign({ name: 'layout-animated-bg', t: 2 }, stack([L.bg(), L.bars(), L.text(), L.card(), L.logo(logo)])));
  out.push(Object.assign({ name: 'opacity-transform', t: 2 }, stack([
    L.bg(), L.bars({ opacity: 0.7, transform: { scale: 0.85, rotate: -8, x: 0.05, y: 0.04, flipX: true } }),
    L.text({ opacity: 0.6, transform: { scale: 1.2, rotate: 12, x: -0.1, y: 0.05 } }), L.logo(logo, { transform: { scale: 0.7, rotate: 30 } }),
  ])));
  BLENDS.forEach((b) => out.push(Object.assign({ name: 'blend-' + b, t: 2 }, stack([L.bg(), L.bars({ blend: b }), L.text({ blend: b })]))));
  out.push(Object.assign({ name: 'mask-rect', t: 2 }, stack([L.bg(), L.bars({ mask: { type: 'rect', x: 0.5, y: 0.5, w: 0.5, h: 0.5, feather: 0.1 } })])));
  out.push(Object.assign({ name: 'group-crossfade', t: 2 }, stack([L.bg({ group: 'A' }), L.bars({ group: 'B' }), L.text({ group: 'B' })], { crossfade: { enabled: true, value: 0.35 } })));
  // Açılış animasyonunun ortası (#537): saat ilk ısınma karesinde kurulur
  const rv = (type) => ({ type, duration: 1, delay: 0, ease: 'linear', distance: 0.12 });
  ['slideUp', 'slideLeft', 'scale', 'wipe', 'fade'].forEach((type) => out.push(Object.assign({ name: 'reveal-' + type, t: 0.5, warm: [0, 0.25] },
    stack([L.bg(), L.bars({ reveal: rv(type) }), L.text({ reveal: rv(type), transform: { rotate: 6, scale: 0.9 } }), L.card({ reveal: rv(type) }), L.logo(logo, { reveal: rv(type) })]))));
  return out;
}

/* Karşılaştırma. Canlı görüntü BGRA (Electron toBitmap), dışa aktarım
   RGBA. Piksel farkı RGB kanallarının en büyük mutlak farkı. Boyutlar
   tutmazsa ortak bölge karşılaştırılır ve not düşülür. */
function compare(live, lw, lh, exp, ew, eh, liveBgra) {
  const w = Math.min(lw, ew);
  const h = Math.min(lh, eh);
  const hist = new Uint32Array(256);
  let sum = 0;
  let max = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * lw + x) * 4;
      const j = (y * ew + x) * 4;
      const lr = liveBgra ? live[i + 2] : live[i];
      const lb = liveBgra ? live[i] : live[i + 2];
      const d = Math.max(Math.abs(lr - exp[j]), Math.abs(live[i + 1] - exp[j + 1]), Math.abs(lb - exp[j + 2]));
      hist[d]++;
      sum += d;
      if (d > max) max = d;
    }
  }
  const n = w * h;
  let acc = 0;
  let p99 = 0;
  for (let k = 0; k < 256; k++) { acc += hist[k]; if (acc >= n * 0.99) { p99 = k; break; } }
  let over = 0;
  for (let k = 9; k < 256; k++) over += hist[k];
  const res = { mean: n ? sum / n : 0, p99, max, over8: n ? over / n : 0 };
  if (lw !== ew || lh !== eh) res.sizeNote = 'live ' + lw + 'x' + lh + ', export ' + ew + 'x' + eh;
  return res;
}

/* Eşik: kenar yumuşatması ve süzme iki yolda birebir değil, tek tük
   pikselde fark olur; ortalama ve büyük farklı piksel oranı küçük kalmalı.
   Durum kendi sınırını verebilir. */
const LIMIT = { mean: 1.0, over8: 0.005 };
function passes(res, limit) {
  const l = Object.assign({}, LIMIT, limit || {});
  return !res.sizeNote && res.mean <= l.mean && res.over8 <= l.over8;
}

module.exports = { LOGO_SCRIPT, baseConfig, mergeCase, cases, compare, passes, LIMIT, BLENDS };
