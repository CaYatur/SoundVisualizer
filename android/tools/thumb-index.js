/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* MOD KÜÇÜK RESİMLERİNİN DİZİNİ (Faz 3.3, katman ekleme).

   Uygulamayla gelen resimler `assets/mode-thumbs/<anahtar>.webp`; anahtar içeriğe
   bağlı bir SHA-1 (src/main/mode-thumbs.js). Telefonda bu anahtarı hesaplayacak
   kaynak dosyalar yok, çalışma anında resim çizen kuyruk da yok. Bu yüzden eşleme
   derlemede, masaüstünün KENDİ koduyla (scripts/gen-mode-thumbs.js `wanted`)
   çıkarılıp APK'ya `assets/mode-thumbs/index.json` olarak konuyor:

     { "vis": { "bars": "<anahtar>", … }, "bg": { "ink": "<anahtar>", … } }

   Eksik resim derlemeyi DURDURUR: anahtarı besleyen bir motor dosyası değişip
   resimler yeniden üretilmezse telefonda bütün resimler sessizce simgeye
   dönerdi. Çözüm: `node scripts/gen-mode-thumbs.js`. Yalnız `solid` (düz renk)
   resimsiz; masaüstünde de öyle (tests/mode-thumbs.test.js).

   Kullanım: node android/tools/thumb-index.js <çıktı dosyası> */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const NO_THUMB = new Set(['solid']);

function build(root) {
  const { wanted } = require(path.join(root, 'scripts', 'gen-mode-thumbs.js'));
  const M = require(path.join(root, 'src', 'main', 'mode-thumbs.js'));
  const dir = path.join(root, M.SHIPPED_DIR);
  const index = { vis: {}, bg: {} };
  const missing = [];
  for (const w of wanted()) {
    if (fs.existsSync(path.join(dir, w.key + '.webp'))) index[w.kind][w.type] = w.key;
    else if (!NO_THUMB.has(w.type)) missing.push(w.kind + ':' + w.type);
  }
  return { index, missing };
}

if (require.main === module) {
  const target = process.argv[2];
  if (!target) {
    console.error('kullanım: node android/tools/thumb-index.js <çıktı dosyası>');
    process.exit(2);
  }
  const r = build(ROOT);
  if (r.missing.length) {
    console.error('[thumb-index] küçük resmi olmayan modlar: ' + r.missing.join(' '));
    console.error('[thumb-index] resimler eski: node scripts/gen-mode-thumbs.js');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(r.index));
  console.log('[thumb-index] ' + (Object.keys(r.index.vis).length + Object.keys(r.index.bg).length) + ' resim');
}

module.exports = { build, NO_THUMB };
