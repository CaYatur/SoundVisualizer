'use strict';
/* Logo değişimi (#535): kurallar, belirlenimlilik (canlı = dışa aktarım),
   geçiş ve bağlantılar. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const S = require('../src/shared/logo-swap');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const ITEMS = ['a', 'b', 'c'];

test('en az iki görsel ve açık olmadan değişim yok', () => {
  assert.strictEqual(S.active({ enabled: true, items: ['a'] }), false);
  assert.strictEqual(S.active({ enabled: false, items: ITEMS }), false);
  assert.strictEqual(S.active({ enabled: true, items: ITEMS }), true);
  assert.strictEqual(S.step({}, { enabled: true, items: ['a'] }, {}, 5, null), null);
});

test('her N saniyede sırayla; geçiş çapraz, kesmede anında', () => {
  const sw = { enabled: true, items: ITEMS, rule: 'seconds', every: 4, fade: 1 };
  const at = (t) => S.step({}, sw, {}, t, null);
  assert.deepStrictEqual(at(0), { cur: 'a', prev: null, k: 1 });
  assert.strictEqual(at(3.9).cur, 'a');
  const mid = at(4.5);
  assert.strictEqual(mid.cur, 'b');
  assert.strictEqual(mid.prev, 'a');
  assert.ok(Math.abs(mid.k - 0.5) < 1e-9, 'yarı yolda');
  assert.deepStrictEqual(at(5.2), { cur: 'b', prev: null, k: 1 });
  assert.strictEqual(at(12.1).cur, 'a', 'başa döner');
  const cut = S.step({}, Object.assign({}, sw, { transition: 'cut' }), {}, 4.01, null);
  assert.deepStrictEqual(cut, { cur: 'b', prev: null, k: 1 });
});

test('her N ölçüde: tempo yapılandırmadan (çizelge > kilit > modülasyon > 120)', () => {
  assert.deepStrictEqual(S.bpmOf({}), { bpm: 120, beatsPerBar: 4 });
  assert.deepStrictEqual(S.bpmOf({ autovj: { bpmLock: 100, beatsPerBar: 3 } }), { bpm: 100, beatsPerBar: 3 });
  assert.deepStrictEqual(S.bpmOf({ timeline: { enabled: true, tempo: [{ bpm: 90, beatsPerBar: 4 }] }, autovj: { bpmLock: 100 } }), { bpm: 90, beatsPerBar: 4 });
  // 120 BPM, 4/4: bir ölçü 2 sn; her 2 ölçüde = 4 sn
  const sw = { enabled: true, items: ITEMS, rule: 'bars', every: 2, transition: 'cut' };
  assert.strictEqual(S.step({}, sw, {}, 3.99, null).cur, 'a');
  assert.strictEqual(S.step({}, sw, {}, 4.01, null).cur, 'b');
});

test('rastgele: aralıklar sınır içinde, ardışık aynı görsel yok, aynı tohum aynı sıra', () => {
  const sw = { enabled: true, items: ITEMS, rule: 'random', min: 2, max: 5, seed: 7, transition: 'cut' };
  const seq = (stepT) => {
    const st = {};
    const out = [];
    let last = null;
    for (let t = 0; t < 120; t += stepT) {
      const p = S.step(st, sw, {}, t, null);
      if (p.cur !== last) { out.push([Math.round(t * 100) / 100, p.cur]); last = p.cur; }
    }
    return out;
  };
  const a = seq(0.05);
  for (let i = 1; i < a.length; i++) {
    assert.notStrictEqual(a[i][1], a[i - 1][1], 'ardışık aynı görsel');
    const gap = a[i][0] - a[i - 1][0];
    assert.ok(gap >= 2 - 0.06 && gap <= 5 + 0.06, 'aralık ' + gap);
  }
  // Kare hızı farklı (canlı 60 fps / dışa aktarım 30 fps) olsa da aynı sıra
  const b = seq(1 / 30);
  assert.deepStrictEqual(a.map((x) => x[1]), b.map((x) => x[1]).slice(0, a.length));
  // Durumsuz çağrı da aynı sonucu verir (önbellek yalnız hız için)
  assert.strictEqual(S.step({}, sw, {}, 77.7, null).cur, S.step({ rnd: null }, sw, {}, 77.7, null).cur);
});

test('bas vuruşu: eşik ve en az ara; zaman geri sarınca baştan', () => {
  const sw = { enabled: true, items: ITEMS, rule: 'bass', threshold: 0.5, hold: 1, transition: 'cut' };
  const st = {};
  const hit = (v) => ({ analysis: { hits: { kick: v } } });
  assert.strictEqual(S.step(st, sw, {}, 0, hit(0)).cur, 'a');
  assert.strictEqual(S.step(st, sw, {}, 0.5, hit(0.9)).cur, 'a', 'en az ara dolmadı');
  assert.strictEqual(S.step(st, sw, {}, 1.2, hit(0.3)).cur, 'a', 'eşik altı');
  assert.strictEqual(S.step(st, sw, {}, 1.3, hit(0.9)).cur, 'b');
  assert.strictEqual(S.step(st, sw, {}, 1.4, hit(0.9)).cur, 'b', 'hemen ardından değil');
  assert.strictEqual(S.step(st, sw, {}, 2.5, hit(0.8)).cur, 'c');
  assert.strictEqual(S.step(st, sw, {}, 0, hit(0)).cur, 'a', 'dışa aktarım baştan başlayınca');
});

test('çizici, dışa aktarıcı ve panel bağlı; Math.random yok', () => {
  // Yorumlar hariç: kodda Math.random yok
  assert.doesNotMatch(read('src/shared/logo-swap.js').replace(/\/\*[\s\S]*?\*\//g, ''), /Math\.random/);
  const layers = read('src/visualizer/layers.js');
  assert.match(layers, /SW\.step\(e\._swap \|\| \(e\._swap = \{\}\), lg\.swap, cfg, t, audio\)/);
  assert.match(layers, /if \(pick\.prev\) paintId\(pick\.prev, 1 - pick\.k\);/);
  const ex = read('src/exporter/exporter.js');
  assert.match(ex, /await preloadLayerLogos\(\);/);
  assert.match(ex, /sw\.items\.forEach\(\(id\) => \{ const u = L\.logoFileSrc/);
  ['src/admin/index.html', 'src/exporter/index.html', 'src/visualizer/index.html'].forEach((f) => {
    const h = read(f);
    assert.ok(h.indexOf('logo-swap.js') > 0 && h.indexOf('logo-swap.js') < h.indexOf('layers.js', h.indexOf('logo-runtime.js')), f + ': layers.js\'ten önce');
  });
  assert.match(read('src/web/overlay.html'), /\/app\/shared\/logo-swap\.js/);
  const panel = read('src/admin/logo-swap-panel.js');
  assert.match(panel, /lg\.swap = Object\.assign\(\{\}, SW\(\)\.DEFAULTS, lg\.swap \|\| \{\}, \{ enabled: box\.checked \}\)/, 'yalnız açılınca yazılır');
  assert.match(read('src/admin/scene-panels.js'), /window\.SVLogoSwapPanel\.controls\(lg, rerender\)/);
});
