'use strict';
/* Yeni görselleştirici katmanı fabrika değerleriyle gelmeli; panelin
 * sıfırlama hedefi de aynı kaynaktan (defaults.js) okunmalı. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'scene-panels.js'), 'utf8');
global.window = global.window || {};
window.SV = window.SV || {};
require('../src/shared/defaults.js');
const factory = window.SV.defaultConfig().visualizer;
const body = src.slice(src.indexOf('function seedFactoryVisualizer'), src.indexOf('function miniSegment'));
// eslint-disable-next-line no-new-func
const seed = new Function('P', 'window', body + '\nreturn seedFactoryVisualizer;')(() => ({}), {});

test('yeni katman sahnenin farklı değerlerini değil fabrika değerlerini alır', () => {
  const cfg = { visualizer: Object.assign({}, factory, { glow: 0.8, sensitivity: 1.4, gap: 0.1, barCount: 64 }) };
  const l = seed({ kind: 'visualizer', type: 'bars', settings: {} }, cfg, { visualizer: factory });
  const vs = l.settings.visualizer;
  assert.strictEqual(vs.glow, factory.glow);
  assert.strictEqual(vs.sensitivity, factory.sensitivity);
  assert.strictEqual(vs.gap, factory.gap);
  assert.strictEqual(vs.barCount, factory.barCount);
  assert.ok(!('type' in vs));
  assert.ok(!('mirror' in vs), 'sahnede aynı olan alan yazılmaz');
});

test('katmanın kendi değeri ezilmez', () => {
  const cfg = { visualizer: Object.assign({}, factory, { glow: 0.8 }) };
  const l = seed({ settings: { visualizer: { glow: 0.3 } } }, cfg, { visualizer: factory });
  assert.strictEqual(l.settings.visualizer.glow, 0.3);
});

test('panel varsayılanları defaults.js ile aynı kaynaktan', () => {
  for (const k of ['sensitivity', 'glow', 'barCount', 'gap', 'lineWidth', 'thickness']) {
    assert.match(src, new RegExp("getV\\('" + k + "', fd\\('" + k + "'[^\\n]*def: fd\\('" + k + "'"), k);
  }
  assert.match(src, /if \(kind === 'visualizer'\) seedFactoryVisualizer\(made\)/);
});
