'use strict';
/* PR #939 testinde bulunan hataların gerilemesine karşı:
 * 1) Zamanlama düzenleyicisi çalan saatte hep [00:00.00] basıyordu.
 * 2) Ekran koruyucu sessizlikte düşen kare hızı yüzünden ~5 kat geç açılıyordu.
 * 3) İngilizce arayüzde kaydırma düğmeleri ve dosya bilgisi Türkçe kalıyordu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const LC = require('../src/shared/lyrics-clock.js');
const SS = require('../src/shared/screensaver.js');
const L = require('../src/shared/lyrics.js');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8');

test('söz saati çapası çalarken ilerleyen zaman verir ve damga basar', () => {
  const now = 1_000_000;
  const anchor = { run: 'play', time: 10, epoch: now - 2500 };
  const t = LC.resolve(anchor, now);
  assert.ok(Math.abs(t - 12.5) < 1e-9, String(t));
  assert.strictEqual(L.fmtStamp(t), '00:12.50');
  assert.strictEqual(L.stampAt('satır', 0, t).text, '<00:12.50>satır');
});

test('düzenleyici söz saatini SVLyricsClock ile çözer (SVShowClock değil)', () => {
  const src = read('src/admin/lyrics-lib-ui.js');
  const body = src.slice(src.indexOf('const clockNow'), src.indexOf('const lineRange'));
  assert.match(body, /SVLyricsClock/);
  assert.doesNotMatch(body, /SVShowClock\.resolve/);
});

test('ekran koruyucu duvar saatiyle bekler: düşük kare hızında da 10 sn', () => {
  const s = SS.create();
  const cfg = { enabled: true, idleSec: 10, fadeSec: 1 };
  // Sessizlikte ~4 fps; kare dt'si 0,05'te kırpılmış geliyor
  let now = 0;
  for (let i = 0; i < 4 * 11; i++) { now += 250; SS.update(s, { silent: true, dt: 0.05, now, cfg }); }
  assert.ok(s.silentFor >= 10.5 && s.silentFor < 11.5, String(s.silentFor));
  assert.ok(s.amount > 0, 'kararma başlamalıydı');
  SS.update(s, { silent: false, dt: 0.05, now: now + 250, cfg });
  assert.strictEqual(s.silentFor, 0);
});

test('görselleştirici ekran koruyucuya performance.now() verir', () => {
  assert.match(read('src/visualizer/visualizer.js'), /SS\.update\(saver, \{[^}]*now: performance\.now\(\)/);
});

function dictionary() {
  const src = read('src/shared/i18n.js');
  const body = src.slice(src.indexOf('const EN = {'), src.indexOf('const EN_NORMALIZED'));
  const STR = "'((?:[^'\\\\]|\\\\.)*)'";
  const re = new RegExp(STR + '\\s*:\\s*' + STR, 'g');
  const map = new Map();
  let m;
  while ((m = re.exec(body))) map.set(m[1].replace(/\s+/g, ' ').trim(), m[2]);
  return map;
}

test('zamanlama araç çubuğunun her metni İngilizce sözlükte', () => {
  const dict = dictionary();
  const src = read('src/admin/lyrics-lib-ui.js');
  const re = /tool\('([^']+)', '([^']+)'/g;
  let m, n = 0;
  while ((m = re.exec(src))) {
    n++;
    for (const k of [m[1], m[2]]) assert.ok(dict.has(k), 'çevirisi yok: ' + k);
  }
  assert.ok(n >= 6);
});

test('dosya bilgisi adı ayrı düğümde; parçaların hepsi çevrilebilir', () => {
  const src = read('src/admin/text-panel.js');
  assert.doesNotMatch(src, /\(T\.lyricsName \|\| ''\) \+ ' ' \+ info/);
  const dict = dictionary();
  for (const k of ['karaoke zamanlı', 'yüklü dosya yok']) assert.ok(dict.has(k), k);
  assert.match(read('src/shared/i18n.js'), /\.replace\(\/\^\(\\d\+\) satır · \(\.\+\)\$\/g/);
});
