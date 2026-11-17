/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Şablon ve MilkDrop önizlemelerini üretir (android/tools/previews.js) →
   android/previews/{tpl,md}/<kimlik>.webp ve index.json. Yalnız eksik ya da eskimiş olanlar.

     node android/tools/gen-previews.js            # eksikleri üret
     node android/tools/gen-previews.js --check    # eksik varsa çıkış kodu 1, çizmez
     node android/tools/gen-previews.js --force    # hepsini yeniden çiz

   Electron gerekir (masaüstünün geliştirme bağımlılığı). */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const P = require('./previews');

function main() {
  const args = process.argv.slice(2);
  const all = P.wanted(ROOT);
  const todo = args.includes('--force') ? all : P.stale(ROOT);
  if (args.includes('--check')) {
    console.log(JSON.stringify({ total: all.length, stale: todo.length, ids: todo.slice(0, 10).map((w) => w.kind + ':' + w.id) }));
    process.exit(todo.length ? 1 : 0);
  }
  // Artık olmayan şablon/presetlerin dosyaları
  const live = new Set(all.map((w) => w.kind + '/' + w.id + '.webp'));
  for (const k of P.KINDS) {
    const dir = path.join(ROOT, P.DIR, k);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.webp') && !live.has(k + '/' + f)) fs.rmSync(path.join(dir, f));
  }
  if (!todo.length) { console.log('[previews] güncel (' + all.length + ')'); return; }
  const jobs = path.join(require('os').tmpdir(), 'sv-preview-jobs.json');
  fs.writeFileSync(jobs, JSON.stringify({ jobs: todo, all }));
  let cmd = require('electron');
  let cargs = [path.join(__dirname, 'gen-previews-electron.js'), jobs];
  if (process.platform === 'linux' && !process.env.DISPLAY) { cargs = ['-a', cmd].concat(cargs); cmd = 'xvfb-run'; }
  const r = spawnSync(cmd, cargs, { stdio: 'inherit', env: Object.assign({}, process.env, { ELECTRON_ENABLE_LOGGING: '' }) });
  try { fs.rmSync(jobs); } catch (e) { /* yok */ }
  process.exit(r.status || 0);
}

if (require.main === module) main();
