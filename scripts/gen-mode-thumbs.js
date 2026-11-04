/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Görsel/Zemin küçük resimlerini üretir (#957) → assets/mode-thumbs/<anahtar>.webp.
   Yalnız eksik ya da eskimiş anahtarlar çiziliyor; artık dosyalar siliniyor.

     node scripts/gen-mode-thumbs.js            # eksikleri üret
     node scripts/gen-mode-thumbs.js --check    # eksik varsa çıkış kodu 1, çizmez
     node scripts/gen-mode-thumbs.js --force    # hepsini yeniden çiz

   Başsız çalışır: Linux'ta DISPLAY yoksa xvfb-run ile, WebGL için yazılım
   GL (SwiftShader). CI'da (CI=true) --force verilmedikçe atlanıyor: çizim
   dakikalar sürüyor ve uygulama eksikleri çalışma anında zaten çiziyor. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const M = require('../src/main/mode-thumbs');

function wanted() {
  global.window = global.window || {};
  require('../src/shared/mode-catalog.js');
  const C = global.window.SVModeCatalog;
  const ctx = M.context(ROOT);
  const out = [];
  for (const [kind, list] of [['vis', C.VISUALIZERS], ['bg', C.BACKGROUNDS]]) {
    for (const e of list) {
      if (e.id === 'none') continue;
      out.push({ kind, type: e.id, key: M.keyOf(ctx, kind, e.id) });
    }
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const dir = path.join(ROOT, M.SHIPPED_DIR);
  const all = wanted();
  const has = (k) => fs.existsSync(path.join(dir, k + '.webp'));
  const missing = force ? all : all.filter((w) => !has(w.key));
  if (args.includes('--check')) {
    console.log(JSON.stringify({ total: all.length, missing: missing.length }));
    process.exit(missing.length ? 1 : 0);
  }
  if (process.env.CI && !force) { console.log('[mode-thumbs] CI: atlandı'); return; }
  if (missing.length) {
    fs.mkdirSync(dir, { recursive: true });
    const jobs = path.join(require('os').tmpdir(), 'sv-mode-thumb-jobs.json');
    fs.writeFileSync(jobs, JSON.stringify({ dir, jobs: missing }));
    const electron = require('electron');
    let cmd = electron;
    let cargs = [path.join(__dirname, 'gen-mode-thumbs-electron.js'), jobs];
    if (process.platform === 'linux' && !process.env.DISPLAY) { cargs = ['-a', cmd].concat(cargs); cmd = 'xvfb-run'; }
    const r = spawnSync(cmd, cargs, { stdio: 'inherit', env: Object.assign({}, process.env, { ELECTRON_ENABLE_LOGGING: '' }) });
    // Paketlemeyi durdurmuyor: eksikler çalışma anında çiziliyor
    if (r.status !== 0) console.warn('[mode-thumbs] çizici başarısız (' + r.status + '), eksikler çalışma anında çizilecek');
  }
  // Artık: bugünkü hiçbir anahtara ait olmayan dosyalar
  const live = new Set(all.map((w) => w.key + '.webp'));
  let removed = 0;
  let bytes = 0;
  let count = 0;
  for (const n of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const f = path.join(dir, n);
    if (!live.has(n)) { fs.unlinkSync(f); removed++; continue; }
    bytes += fs.statSync(f).size;
    count++;
  }
  console.log(JSON.stringify({ total: all.length, drawn: missing.length, removed, files: count, bytes }));
}

if (require.main === module) main();
module.exports = { wanted };
