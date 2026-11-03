'use strict';
/* TEK ŞEMA (#905): kaydırıcılar ve sahne alanları tek yerde, kopya kalmıyor. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Schema = require('../src/shared/schema.js');
const Tree = require('../src/shared/osc-tree.js');
require('../src/admin/control.js');
const CT = global.window.SVControl;

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('sahne alanları: 17 alan, hiçbir yerde ayrı kopya yok', () => {
  assert.deepStrictEqual(Schema.SCENE_KEYS, [
    'background', 'visualizer', 'layers', 'layerStack', 'layerGroups', 'crossfade',
    'geometry', 'postfx', 'logo', 'images', 'media', 'text', 'modulation',
    'transition', 'custom', 'milkdrop', 'feedback',
  ]);
  assert.strictEqual(require('../src/shared/show-keys.js').SCENE, Schema.SCENE_KEYS);
  assert.strictEqual(require('../src/shared/mcp.js').SCENE_KEYS, Schema.SCENE_KEYS);
  assert.strictEqual(require('../src/shared/templates.js').SCENE_KEYS, Schema.SCENE_KEYS);
  for (const f of ['src/admin/admin.js', 'src/admin/control.js', 'src/main/main.js', 'src/shared/mcp.js', 'src/shared/show-keys.js']) {
    assert.doesNotMatch(read(f), /(SCENE_KEYS|SCENE) = \[/, f);
  }
});

test('kaydırıcılar: kontrol hedefleri ve OSC ağacı şemadan üretiliyor', () => {
  assert.strictEqual(Schema.SLIDERS.length, 29);
  const rows = CT.TARGETS.filter((t) => t.path);
  assert.deepStrictEqual(rows, Schema.SLIDERS, 'kontrol hedefleri');
  assert.deepStrictEqual(CT.TARGETS.slice(0, rows.length), rows, 'kaydırıcılar eylemlerden önce');
  assert.deepStrictEqual(Tree.SLIDERS.map((s) => s.path), Schema.SLIDERS.map((s) => s.path), 'OSC ağacı');
  for (const s of Schema.SLIDERS) assert.ok(s.label, s.path);
  for (const s of Tree.SLIDERS) assert.strictEqual(s.label, undefined, 'OSC satırında etiket yok');
});

test('panel kaydırıcıları aralığı şemadan alıyor, kopya kalmadı', () => {
  const admin = read('src/admin/admin.js');
  let seen = 0;
  for (const m of admin.matchAll(/path: '([^']+)'[^\n]*/g)) {
    if (!/type: 'slider'/.test(m[0]) && !/^path: '[^']+', label: '[^']*', step:/.test(m[0])) continue;
    const s = Schema.rangeFor(m[1]);
    if (!s || s.steps) continue;
    seen++;
    assert.doesNotMatch(m[0], /\b(min|max|noExtend):/, m[1]);
  }
  assert.strictEqual(seen, 71);
  assert.match(admin, /const known = window\.SVSchema\.rangeFor\(def\.path\);/);
  assert.match(admin, /def\.min = known\.min;/);
  assert.doesNotMatch(admin, /RANGE_FACTOR/);
});

test('şema satırları: aralık düzgün, varsayılan aralıkta, yol yinelenmiyor', () => {
  require('../src/shared/defaults.js');
  const defs = global.window.SV.defaultConfig();
  const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const rows = Schema.SLIDERS.concat(Schema.RANGES);
  assert.strictEqual(new Set(rows.map((x) => x.path)).size, rows.length);
  assert.strictEqual(rows.length, 81);
  for (const r of rows) {
    if (r.steps) continue;
    assert.ok(r.min < r.max, r.path);
    const v = get(defs, r.path);
    assert.notStrictEqual(v, undefined, r.path + ' varsayılanda yok');
    if (v !== null) assert.ok(v >= r.min && v <= r.max, r.path + ' varsayılanı ' + v);
  }
});

test('genişletilmiş aralık: sert sınır ve eksi üst sınır büyümüyor', () => {
  assert.strictEqual(Schema.extendedMax(Schema.rangeFor('visualizer.glow')), 5);
  for (const p of ['audio.smoothing', 'feedback.zoom', 'feedback.decay', 'feedback.dx', 'feedback.dy', 'power.renderScale', 'media.opacity']) {
    const r = Schema.rangeFor(p);
    assert.strictEqual(Schema.extendedMax(r), r.max, p);
  }
  // -24 dB'nin 5 katı -120 dB alt sınırın altında kalıyor, kaydırıcı kilitleniyordu
  assert.strictEqual(Schema.extendedMax(Schema.rangeFor('visualizer.spectrum.floorDb')), -24);
  assert.strictEqual(Schema.rangeFor('yok.boyle.bir.yol'), null);
});

test('panel şemayı OSC ağacından önce yüklüyor', () => {
  const html = read('src/admin/index.html');
  const at = (s) => html.indexOf('<script src="' + s + '"');
  assert.ok(at('../shared/schema.js') > 0);
  for (const s of ['../shared/templates.js', '../shared/osc-tree.js', 'control.js', '../shared/mcp.js', 'admin.js']) {
    assert.ok(at('../shared/schema.js') < at(s), s);
  }
});

test('şablon yükleyen her sayfa şemayı önce yüklüyor', () => {
  for (const [f, pre] of [['src/exporter/index.html', '../shared/'], ['src/visualizer/index.html', '../shared/'], ['src/web/overlay.html', '/app/shared/']]) {
    const html = read(f);
    const schema = html.indexOf('<script src="' + pre + 'schema.js"');
    assert.ok(schema > 0, f);
    assert.ok(schema < html.indexOf('<script src="' + pre + 'templates.js"'), f);
  }
});

test('şablon sahneden kalan medya, metin, grup ve çapraz geçişi sıfırlıyor (#905)', () => {
  require('../src/shared/defaults.js');
  const T = require('../src/shared/templates.js');
  const SV = global.window.SV;
  const env = { defaultConfig: SV.defaultConfig, deepMerge: SV.deepMerge, clone: SV.clone };
  const cfg = SV.defaultConfig();
  cfg.media = Object.assign({}, cfg.media, { enabled: true, file: 'C:/video.mp4' });
  cfg.text = Object.assign({}, cfg.text, { enabled: true });
  cfg.layerGroups = { g1: { name: 'Grup' } };
  cfg.crossfade = Object.assign({}, cfg.crossfade, { enabled: !SV.defaultConfig().crossfade.enabled });
  const def = SV.defaultConfig();
  const out = T.apply(cfg, T.TEMPLATES[0], env);
  for (const k of ['media', 'text', 'layerGroups', 'crossfade']) {
    if (T.TEMPLATES[0].patch[k] === undefined) assert.deepStrictEqual(out[k], def[k], k);
  }
});
