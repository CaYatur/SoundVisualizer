'use strict';
/* Oyun kumandası analog eşleme (#957): ölü bölge, eğri, ters, eksen yarısı, yumuşatma,
   göreli kip ve arayüzün bağlantısı. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const G = require('../src/shared/gamepad-map.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8').replace(/\r\n/g, '\n');
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, a + ' != ' + b);

test('varsayılanlar ve bozuk alanlar', () => {
  const o = G.opts({ mode: 'x', curve: 'y', deadzone: 'z', smooth: 5, rate: -1 });
  assert.strictEqual(o.mode, 'abs');
  assert.strictEqual(o.curve, 'linear');
  assert.strictEqual(o.deadzone, G.OPTS.deadzone);
  assert.strictEqual(o.smooth, 0.95);
  assert.strictEqual(o.rate, 0.01);
});

test('ölü bölge kalanı yeniden ölçekler, sıçrama yok', () => {
  const m = { deadzone: 0.2 };
  assert.strictEqual(G.shape(m, 0.15), 0);
  near(G.shape(m, 0.6), 0.5);
  near(G.shape(m, 1), 1);
  near(G.shape(m, -1), -1);
});

test('ters çevirme ve üstel eğri', () => {
  near(G.shape({ deadzone: 0, invert: true }, 0.5), -0.5);
  near(G.shape({ deadzone: 0, curve: 'expo', expo: 2 }, -0.5), -0.25);
});

test('mutlak kip: tam eksen ve tek yön', () => {
  near(G.abs01({ deadzone: 0 }, -1), 0);
  near(G.abs01({ deadzone: 0 }, 0), 0.5);
  near(G.abs01({ deadzone: 0, range: 'pos' }, 0.4), 0.4);
  near(G.abs01({ deadzone: 0, range: 'pos' }, -0.4), 0);
  near(G.abs01({ deadzone: 0, range: 'neg' }, -0.4), 0.4);
});

test('göreli kip: tutuldukça ilerler, bırakınca kalır, sınırda durur', () => {
  const m = { mode: 'rel', deadzone: 0, rate: 0.5 };
  near(G.relStep(m, 0.5, 1, 1000), 1);
  near(G.relStep(m, 0.5, -1, 500), 0.25);
  near(G.relStep(m, 0.3, 0, 1000), 0.3);
  near(G.relStep(m, 0.9, 1, 5000), 1);
  near(G.relStep({ mode: 'rel', deadzone: 0, rate: 1, range: 'pos' }, 0.5, -1, 1000), 0.5);
});

test('yumuşatma kare hızından bağımsız', () => {
  const m = { smooth: 0.5 };
  near(G.smoothTo(m, 0, 1, 16), 0.5);
  near(G.smoothTo(m, 0, 1, 32), 0.75);
  // İki 16 ms adım bir 32 ms adımla aynı
  near(G.smoothTo(m, G.smoothTo(m, 0, 1, 16), 1, 16), 0.75);
  assert.strictEqual(G.smoothTo({ smooth: 0 }, 0, 1, 16), 1);
  assert.strictEqual(G.smoothTo(m, null, 0.7, 16), 0.7);
});

test('ham değer: pad -1 en çok sapanı, sabit pad kendini seçer', () => {
  const st = { '0:a:1': 0.2, '1:a:1': -0.8, '0:b:7': 0.6 };
  assert.strictEqual(G.rawOf({ kind: 'axis', index: 1, pad: -1 }, st), -0.8);
  assert.strictEqual(G.rawOf({ kind: 'axis', index: 1, pad: 0 }, st), 0.2);
  assert.strictEqual(G.rawOf({ kind: 'button', index: 7, pad: -1 }, st), 0.6);
  assert.strictEqual(G.rawOf({ kind: 'axis', index: 3, pad: -1 }, st), null);
});

test('öğrenme ekseni ve analog tetiği yakalar', () => {
  const r = G.diff({}, [{ index: 0, axes: [0, 0.9], buttons: [] }], 0.02);
  assert.deepStrictEqual(G.learnFrom(r.events), { kind: 'axis', index: 1, pad: -1 });
});

test('panel bağlantısı: analog seçenekleri, canlı gösterge, kayıt, çeviriler', () => {
  const ctl = read('src/admin/control.js');
  const i18n = read('src/shared/i18n.js');
  assert.match(ctl, /function gamepadOpts\(m\)/);
  for (const k of ["'mode'", "'range'", "'deadzone'", "'curve'", "'invert'", "'smooth'", "'rate'"]) assert.ok(ctl.includes(k), k);
  assert.match(ctl, /id: 'gamepadAxes'/);
  assert.match(ctl, /G\.relStep\(m, base/);
  assert.match(ctl, /G\.smoothTo\(m, prev, target, dt\)/);
  // Yalnız pencere öndeyken okunur notu korunuyor
  assert.match(ctl, /Kumanda yalnızca uygulama pencerelerinden biri öndeyken okunur/);
  // Çalışma değeri ayara yazılmaz
  assert.doesNotMatch(ctl, /m\._v\b/);
  for (const k of ['Göreli (artımlı)', 'Tam eksen', 'Yalnız + yön', 'Yalnız − yön', 'Eksen aralığı', 'Ölü bölge', 'Tepki eğrisi', 'Ters çevir', 'Hız (aralık/sn)', 'Canlı eksen değerleri', 'Mutlak', 'Yumuşatma']) {
    assert.ok(new RegExp(`^\\s*'${k.replace(/[()+]/g, '\\$&')}':`, 'm').test(i18n), 'EN çevirisi yok: ' + k);
  }
});
