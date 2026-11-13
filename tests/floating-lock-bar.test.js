/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Yüzen pencerenin konumu kilitliyken çubuk görünmez ve pencerenin kendi
   çubuğundan gelen köşe / boyut komutu yok sayılır. Önce kilit yalnız fareyle
   taşımayı kapatıyordu: fare üste gelince çubuk açılıyor, köşe ve S/M/L
   düğmeleri pencereyi kilitliyken de taşıyordu. Yalıtılmış uygulamada ölçüldü:
   kilitliyken çubuk display:none, çubuk komutu konumu değiştirmiyor, panelin
   düğmesi değiştiriyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

test('kilitliyken çubuk gizli, kilit ayardan canlı izleniyor', () => {
  const css = read('visualizer/visualizer.css');
  assert.match(css, /html\.sv-floating\.sv-float-locked #sv-float-bar \{ display: none; \}/);
  const vis = read('visualizer/visualizer.js');
  const apply = vis.slice(vis.indexOf('function applyConfig(newCfg)'), vis.indexOf('/* Ana opaklık sahnenin'));
  assert.match(apply, /classList\.toggle\('sv-float-locked', !!\(cfg\.floating && cfg\.floating\.locked\)\)/);
  // Yama yolu da applyConfig'ten geçiyor: panelde kilidi değiştirmek pencereye anında yansır
  assert.match(vis, /rawCfg = Object\.assign\(\{\}, rawCfg, p\);\s*applyConfig\(rawCfg\);/);
});

test('pencere çubuğunun komutu kilitliyken yok sayılır, panelinki çalışır', () => {
  const main = read('main/main.js');
  assert.match(main, /ipcMain\.on\('floating:snap', \(e, where\) => \{ if \(!floatingPrefs\(\)\.locked\) snapFloating\(where\); \}\);/);
  assert.match(main, /ipcMain\.on\('floating:size', \(e, kind\) => \{ if \(!floatingPrefs\(\)\.locked\) sizeFloating\(kind\); \}\);/);
  assert.match(main, /ipcMain\.handle\('floating:snap', \(e, where\) => \{ snapFloating\(where\); return true; \}\);/);
  // Kanallar gerçekten ayrı: pencere send, panel invoke kullanıyor
  assert.match(read('main/preload-visualizer.js'), /floatingSnap: \(where\) => ipcRenderer\.send\('floating:snap', where\)/);
  assert.match(read('main/preload-admin.js'), /floatingSnap: \(where\) => ipcRenderer\.invoke\('floating:snap', where\)/);
});
