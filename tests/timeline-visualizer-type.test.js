'use strict';
/* Zaman çizelgesi Görselleştirici klip türü: CLIP_TYPES, denetçi, applyRef. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const TL = require('../src/shared/timeline.js');
const CD = require('../src/shared/clipdeck.js');

test('CLIP_TYPES visualizer içerir', () => {
  assert.ok(TL.CLIP_TYPES.indexOf('visualizer') >= 0);
  assert.ok(CD.CLIP_TYPES.indexOf('visualizer') >= 0);
});

test('makeClip visualizer kabul eder', () => {
  const c = TL.makeClip({ type: 'visualizer', ref: 'bars', start: 1, dur: 2 });
  assert.strictEqual(c.type, 'visualizer');
  assert.strictEqual(c.ref, 'bars');
});

test('panel ve deste visualizer uyguluyor', () => {
  const panel = fs.readFileSync(path.join(__dirname, '../src/admin/timeline-panel.js'), 'utf8');
  const deck = fs.readFileSync(path.join(__dirname, '../src/admin/clipdeck-panel.js'), 'utf8');
  assert.match(panel, /\['visualizer', 'Görselleştirici'\]/);
  assert.match(panel, /type === 'visualizer'/);
  assert.match(deck, /type === 'visualizer'/);
  assert.match(deck, /visualizer\.type = ref|layers\[0\]\.type = ref/);
});
