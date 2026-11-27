/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Sabit süre alanı: elle yazılan süre (ss, dd:ss, sa:dd:ss) kaydırıcıyla iki
   yönlü eş; kaydırıcı küp ölçekli, 1 sn'den 4 saate ulaşır. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../src/shared/export-formats.js');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');

test('parseClock: saniye, dd:ss ve sa:dd:ss; geçersiz yazım null', () => {
  assert.strictEqual(F.parseClock('90'), 90);
  assert.strictEqual(F.parseClock(' 1:30 '), 90);
  assert.strictEqual(F.parseClock('0:05'), 5);
  assert.strictEqual(F.parseClock('01:02:05'), 3725);
  assert.strictEqual(F.parseClock('4:00:00'), F.MAX_SECONDS);
  assert.strictEqual(F.parseClock('12.6'), 13);
  assert.strictEqual(F.parseClock('1:02,4'), 62);
  for (const bad of ['', '  ', 'abc', '1:75', '1:2:3:4', '-5', '1::2', ':30', '1:60:00', '1.5:00']) {
    assert.strictEqual(F.parseClock(bad), null, JSON.stringify(bad));
  }
});

test('kaydırıcı: küp ölçek uçları, tekdüze ve yaklaşık ters', () => {
  assert.strictEqual(F.sliderToSeconds(0), 1);
  assert.strictEqual(F.sliderToSeconds(F.SLIDER_STEPS), F.MAX_SECONDS);
  let prev = 0;
  for (let p = 0; p <= F.SLIDER_STEPS; p += 10) {
    const s = F.sliderToSeconds(p);
    assert.ok(s >= prev, 'tekdüze ' + p);
    prev = s;
  }
  // Kısa süreler ince: ilk onda birlik kısım 15 saniyenin altında
  assert.ok(F.sliderToSeconds(F.SLIDER_STEPS / 10) <= 15);
  for (const s of [1, 30, 90, 600, 3600, F.MAX_SECONDS]) {
    const back = F.sliderToSeconds(F.secondsToSlider(s));
    assert.ok(Math.abs(back - s) <= Math.max(1, s * 0.02), s + ' -> ' + back);
  }
  assert.strictEqual(F.secondsToSlider(99999), F.SLIDER_STEPS);
  assert.strictEqual(F.secondsToSlider(0), 0);
});

test('panel: sabit süre kaydırıcı + elle alan, iki yönlü eş ve doğrulamalı', () => {
  const A = read('src/admin/admin.js');
  assert.match(A, /type: 'durationinput', path: 'export\.duration\.seconds', label: 'Süre',/);
  assert.match(A, /case 'durationinput':\n        return durationInputCtrl\(def\);/);
  assert.match(A, /set\(FX\.sliderToSeconds\(Number\(slider\.value\)\), 'slider'\);/);
  assert.match(A, /if \(from !== 'field'\) field\.value = fmtClock\(sec\);/);
  assert.match(A, /if \(from !== 'slider' && FX\) slider\.value = FX\.secondsToSlider\(sec\);/);
  assert.match(A, /if \(sec == null \|\| !\(sec >= 1\) \|\| sec > MAX\) \{/);
  const I = read('src/shared/i18n.js');
  for (const k of ['Süre (dd:ss ya da sa:dd:ss)', 'Saniye, dd:ss ya da sa:dd:ss yazın (1 sn – 4 sa).', 'Geçerli bir süre yazın: 1 sn ile 4:00:00 arası (ör. 90, 1:30, 1:02:05).']) {
    assert.ok(I.includes("'" + k + "': '"), k);
  }
  assert.match(read('src/admin/admin.css'), /\.export-duration-input\.bad \{/);
});
