/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ŞABLON VE MİLKDROP ÖNİZLEMELERİ (Faz 4, Kitaplık).

   Telefonun Kitaplığında şablon kutusu şablonun en üstteki görselleştiricisinin MOD resmini
   gösteriyordu (varsayılan renkler, öbür katmanlar yok: şablona benzemiyordu); MilkDrop
   presetlerinin resmi hiç yoktu (masaüstü onları çalışma anında gizli bir pencerede çiziyor,
   telefonda o kuyruk yok). Burada ikisi de DERLEMEDEN ÖNCE, masaüstünün mod resimlerini çizen
   gizli sayfayla (src/thumbs/modes.html, aynı katman motoru) çiziliyor ve depoya giriyor:

     android/previews/tpl/<şablon kimliği>.webp
     android/previews/md/<preset kimliği>.webp
     android/previews/sh/<shader preset kimliği>.webp
     android/previews/index.json   { tpl: { kimlik: anahtar }, md: { … } }

   Yalnız Android'in dosyaları: PC paketine girmez (electron-builder android/'ı almıyor),
   APK'da web/previews/ altında.

   ANAHTAR içerikten: reçete + şablonun yaması / presetin kaynağı. Motor dosyaları anahtara
   GİRMİYOR: motor her değiştiğinde 148 resmin hepsi eskiyip yeniden üretilmesin (mod
   resimlerindeki KEY_SKIP ile aynı gerekçe). Bedeli: motorun çizimi belirgin değişirse
   `node android/tools/gen-previews.js --force`. Şablon ya da preset değişince yalnız onun
   resmi eskir; android/js-tests/previews.test.js bunu yakalar. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RECIPE = Object.freeze({
  // Çizicinin (preview-runner.js) sahne kuruluşu değişince artırılır: bütün resimler yenilenir
  rev: 2,
  renderW: 480,
  renderH: 270,
  // 6 saniye; 2. saniyeden sonra her 0,2 saniyede bir aday, en dolu kare (mod resimleriyle aynı)
  frames: 180,
  pickFrom: 60,
  pickEvery: 6,
  fps: 30,
  thumbW: 240,
  thumbH: 135,
  quality: 0.75,
});
const DIR = 'android/previews';
const KINDS = Object.freeze(['tpl', 'md', 'sh']);
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

/* Satır sonu normalize: Windows'ta CRLF ile alınan depo aynı anahtarları versin (preset
   kaynakları dosyada çok satırlı; mod resimlerinin anahtarı da böyle). */
function keyOf(kind, body) {
  return sha1(JSON.stringify(RECIPE) + '\n' + kind + '\n' + String(body).replace(/\r\n/g, '\n'));
}

/* Çizilmesi gerekenler: [{ kind, id, key }]. Şablonlar ve yerleşik MilkDrop presetleri. */
function wanted(root) {
  const keepWindow = global.window;
  global.window = {};
  try {
    const req = (f) => {
      const p = path.join(root, f);
      delete require.cache[require.resolve(p)];
      return require(p);
    };
    req('src/shared/defaults.js');
    req('src/shared/templates.js');
    for (const f of ['presets.js', 'presets-shaders.js', 'presets-milkdrop-pack.js', 'presets-milkdrop.js']) req('src/shared/' + f);
    const out = [];
    for (const t of window.SVTemplates.TEMPLATES) {
      out.push({ kind: 'tpl', id: t.id, key: keyOf('tpl', JSON.stringify(t.patch || {})) });
    }
    for (const p of window.SVMilkdropBuiltins || []) {
      if (p && p.id && p.source) out.push({ kind: 'md', id: p.id, key: keyOf('md', p.source) });
    }
    // Studio shader presetleri (yerleşik): görüntüyü belirleyen alanlar
    for (const p of (window.SVPresets && window.SVPresets.all ? window.SVPresets.all() : [])) {
      if (!p || !p.builtin || p.engine !== 'shader' || !p.id) continue;
      out.push({ kind: 'sh', id: p.id, key: keyOf('sh', JSON.stringify({ kind: p.kind, base: p.base, overrides: p.overrides, shader: p.shader, controls: p.controls })) });
    }
    return out;
  } finally {
    global.window = keepWindow;
  }
}

function readIndex(root) {
  let j = null;
  try { j = JSON.parse(fs.readFileSync(path.join(root, DIR, 'index.json'), 'utf8')); } catch (e) { j = {}; }
  for (const k of KINDS) j[k] = j[k] || {};
  return j;
}

/* Eksik ya da eskimiş resimler: index'teki anahtar istenenle aynı değilse ya da dosya yoksa. */
function stale(root) {
  const idx = readIndex(root);
  return wanted(root).filter((w) => !(idx[w.kind] && idx[w.kind][w.id] === w.key && fs.existsSync(path.join(root, DIR, w.kind, w.id + '.webp'))));
}

module.exports = { RECIPE, DIR, KINDS, keyOf, wanted, readIndex, stale };
