'use strict';
/* MEDYA KATMANI: KEN BURNS VE VURUŞTA NABIZ (#841). İkisi de çizim saatine
 * (t) bağlı: aynı an canlıda da dışa aktarımda da aynı kare. Varsayılan
 * kapalı; kapalıyken çizim eskisiyle birebir aynı. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf-8');

function load() {
  const win = {};
  const sandbox = { window: win, document: { createElement: () => ({ getContext: () => null }) }, Math, setTimeout, clearTimeout };
  vm.createContext(sandbox);
  vm.runInContext(read('src/visualizer/modes/media.js'), sandbox);
  return win;
}
const W = load();
const KB = W.SVMediaKenBurns;
const close = (a, b) => Math.abs(a - b) < 1e-9;

test('Ken Burns kapalıyken hareket yok; açıkken döngü süresiyle tekrar ediyor', () => {
  assert.deepStrictEqual(Object.assign({}, KB({}, 5)), { zoom: 1, x: 0, y: 0 });
  const m = { kenBurns: 1, kenBurnsPeriod: 20 };
  assert.ok(close(KB(m, 0).zoom, 1), 'döngünün başında yakınlaşma yok');
  assert.ok(close(KB(m, 10).zoom, 1.12), 'yarıda en fazla %12');
  // Kayma yarım hızda: iki döngüde başa dönüyor
  for (const k of ['zoom', 'x', 'y']) assert.ok(close(KB(m, 3).zoom, KB(m, 43).zoom), k);
  assert.ok(close(KB(m, 7).x, KB(m, 47).x) && close(KB(m, 7).y, KB(m, 47).y));
  // Aynı t aynı sonuç (duvar saati yok)
  assert.deepStrictEqual(KB(m, 12.345), KB(m, 12.345));
  // Yarı güçte yarı hareket
  assert.ok(close(KB({ kenBurns: 0.5, kenBurnsPeriod: 20 }, 10).zoom, 1.06));
});

test('vuruşta nabız: basın ortalamayı aşan yükselişi tepe başlatıyor, ~0,3 sn\'de sönüyor', () => {
  const L = new W.SVMedia();
  const m = { beatPulse: 1 };
  let t = 0;
  const step = (bass) => { t += 1 / 60; return L._beatPulse(m, { bass }, t); };
  for (let i = 0; i < 120; i++) step(0.3); // sakin taban
  const peak = step(0.9);
  assert.ok(close(peak, 0.08), 'tepe %8, bulunan ' + peak);
  let v = peak;
  for (let i = 0; i < 18; i++) v = step(0.3); // 0,3 sn
  assert.ok(v < 0.08 * 0.06, 'sönmüş olmalı: ' + v);
  assert.strictEqual(L._beatPulse({ beatPulse: 0 }, { bass: 1 }, t + 1), 0, 'kapalıyken nabız yok');
});

test('kayma büyütmenin bıraktığı payla sınırlı; panel, varsayılan ve çeviri', () => {
  const src = read('src/visualizer/modes/media.js');
  assert.match(src, /const px = Math\.max\(-Math\.abs\(dw - W\) \/ 2, Math\.min\(Math\.abs\(dw - W\) \/ 2, panX \|\| 0\)\);/);
  assert.match(src, /\* kb\.zoom \* \(1 \+ this\._beatPulse\(m, audio, t\)\)/);
  const D = read('src/shared/defaults.js');
  assert.match(D, /kenBurns: 0, /);
  assert.match(D, /kenBurnsPeriod: 20, /);
  assert.match(D, /beatPulse: 0, /);
  const panel = read('src/admin/media-panel.js');
  for (const p of ['media.kenBurns', 'media.kenBurnsPeriod', 'media.beatPulse']) assert.ok(panel.includes("'" + p + "'"), p);
  const i18n = read('src/shared/i18n.js');
  for (const k of ['Ken Burns (Yavaş Yakınlaşma ve Kayma)', 'Ken Burns Döngüsü', 'Vuruşta Nabız']) assert.ok(i18n.includes("'" + k + "':"), k);
});
