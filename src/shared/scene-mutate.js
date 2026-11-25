/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* SAHNE DEĞİŞTİRME (#447): o anki sahneyi seçilen ölçüde (0..1) rastgele değiştirir.
 *
 * - Yalnız görünüm ayarları: arkaplan, görselleştirici, geri besleme, 3B. Aralıklar şemadan
 *   (shared/schema.js); her değer aralığının en çok ölçü/2'si kadar oynar ve aralıkta kalır.
 * - Dokunulmayanlar: ses çözümlemesi (spektrum, frekans sınırları), ağır yük getirenler
 *   (3B çözünürlük ve nokta sayısı), yazı, logo, medya, tempo, çıkış ve güç. Mod türü de
 *   değişmez: sahne tanınır kalır.
 * - Renkler: arkaplan paletinin ve görselleştirici renklerinin tonu hep birlikte aynı
 *   miktarda döner (en çok ölçü × 60°), palet uyumu korunur.
 * - Tohumlu: aynı sahne, ölçü ve tohum aynı sonucu verir.
 *
 * Dönen: { changes: [{ path, from, to }] }. Yazmak çağıranın işi (panel her yolu genel ve
 * katmandaki kopyasına yazar, değişikliği bir adımda geri alabilir).
 * `read(path)` verilirse değer oradan okunur: katman yığını açıkken ekrandaki değer
 * katmanın kopyasıdır (layers.js effectivePath), genel alan eskimiş olabilir. `undefined`
 * dönen yol atlanır (ör. kilitli katman).
 * Yalnız panel yüklüyor: motor sayfaları ve mod resimlerinin anahtarı bu dosyayı görmüyor.
 */
(function () {
  const ROOTS = ['background.', 'visualizer.', 'feedback.', 'geometry.'];
  const SKIP = [
    /^visualizer\.spectrum\./, /^visualizer\.(minFreq|maxFreq|capFall|capHold)$/,
    /^geometry\.(resolution|attractorPoints|attractorStep)$/,
  ];
  const HUE_MAX = 60;

  function rng(seed) {
    let a = (Number(seed) >>> 0) || 1;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

  function eligible(row) {
    if (!row || !row.path || row.steps) return false;
    if (!ROOTS.some((r) => row.path.startsWith(r))) return false;
    return !SKIP.some((re) => re.test(row.path));
  }

  // #rrggbb ↔ HSL (ton döndürme)
  function hexToHsl(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hslToHex(h, s, l) {
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const a = s * Math.min(l, 1 - l);
      const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(c * 255).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }
  function shiftHue(hex, deg) {
    const hsl = hexToHsl(hex);
    if (!hsl) return hex;
    return hslToHex(((hsl[0] + deg) % 360 + 360) % 360, hsl[1], hsl[2]);
  }

  function mutate(cfg, amount, seed, schema, read) {
    const val = typeof read === 'function' ? read : (p) => get(cfg, p);
    const amt = Math.max(0, Math.min(1, Number(amount) || 0));
    const changes = [];
    if (!cfg || !(amt > 0) || !schema) return { changes };
    const rand = rng(seed);
    const rows = (schema.SLIDERS || []).concat(schema.RANGES || []).filter(eligible);
    const seen = new Set();
    for (const row of rows) {
      if (seen.has(row.path)) continue;
      seen.add(row.path);
      const v = val(row.path);
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      // Kullanıcının genişletilmiş aralıkta bıraktığı değer (kaydırıcının sonundan öte) olduğu gibi kalır
      if (v < row.min || v > row.max) continue;
      const span = row.max - row.min;
      let to = v + (rand() * 2 - 1) * amt * 0.5 * span;
      to = Math.max(row.min, Math.min(row.max, to));
      to = row.int ? Math.round(to) : Math.round(to * 1e4) / 1e4;
      if (to !== v) changes.push({ path: row.path, from: v, to });
    }
    // Renkler: tek bir ton dönüşü, palet ve görselleştirici renkleri birlikte
    const deg = Math.round((rand() * 2 - 1) * amt * HUE_MAX);
    if (deg) {
      const cols = val('background.gradient.colors');
      if (Array.isArray(cols) && cols.length && cols.every((c) => hexToHsl(c))) {
        changes.push({ path: 'background.gradient.colors', from: cols.slice(), to: cols.map((c) => shiftHue(c, deg)) });
      }
      for (const p of ['visualizer.color', 'visualizer.color2']) {
        const c = val(p);
        if (hexToHsl(c)) changes.push({ path: p, from: c, to: shiftHue(c, deg) });
      }
    }
    return { changes };
  }

  const api = { mutate, eligible, shiftHue, hexToHsl, HUE_MAX, ROOTS };
  if (typeof window !== 'undefined') window.SVSceneMutate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
