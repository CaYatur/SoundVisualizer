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

test('kaydırıcı aralıkları paneldekiyle aynı', () => {
  const admin = read('src/admin/admin.js');
  let seen = 0;
  for (const m of admin.matchAll(/type: 'slider', path: '([^']+)'[^}]*?min: (-?[\d.]+), max: (-?[\d.]+)/g)) {
    const s = Schema.SLIDERS.find((x) => x.path === m[1]);
    if (!s || s.steps) continue;
    seen++;
    assert.deepStrictEqual([s.min, s.max], [Number(m[2]), Number(m[3])], m[1]);
  }
  assert.ok(seen >= 10, 'panelde bulunan: ' + seen);
});

test('panel şemayı OSC ağacından önce yüklüyor', () => {
  const html = read('src/admin/index.html');
  const at = (s) => html.indexOf('<script src="' + s + '"');
  assert.ok(at('../shared/schema.js') > 0);
  for (const s of ['../shared/osc-tree.js', 'control.js', '../shared/mcp.js', 'admin.js']) {
    assert.ok(at('../shared/schema.js') < at(s), s);
  }
});
