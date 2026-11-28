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
  assert.ok(TL.CLIP_TYPES.indexOf('background') >= 0);
  assert.ok(TL.CLIP_TYPES.indexOf('logo') >= 0);
});

test('makeClip visualizer kabul eder', () => {
  const c = TL.makeClip({ type: 'visualizer', ref: 'bars', start: 1, dur: 2 });
  assert.strictEqual(c.type, 'visualizer');
  assert.strictEqual(c.ref, 'bars');
  const bg = TL.makeClip({ type: 'background', ref: 'aurora', start: 0, dur: 4 });
  assert.strictEqual(bg.type, 'background');
  assert.strictEqual(bg.ref, 'aurora');
  const logo = TL.makeClip({ type: 'logo', ref: 'img_logo', start: 0, dur: 4 });
  assert.strictEqual(logo.type, 'logo');
  assert.strictEqual(logo.ref, 'img_logo');
});

test('panel ve deste visualizer uyguluyor', () => {
  const panel = fs.readFileSync(path.join(__dirname, '../src/admin/timeline-panel.js'), 'utf8');
  const deck = fs.readFileSync(path.join(__dirname, '../src/admin/clipdeck-panel.js'), 'utf8');
  const compose = fs.readFileSync(path.join(__dirname, '../src/shared/timeline-compose.js'), 'utf8');
  assert.match(panel, /\['visualizer', 'Görselleştirici'\]/);
  assert.match(panel, /type === 'visualizer'/);
  assert.match(panel, /\['background', 'Arkaplan'\]/);
  assert.match(panel, /MC\.BACKGROUNDS/);
  assert.match(compose, /kind: 'background', type: clip\.ref/);
  assert.match(panel, /\['logo', 'Logo'\]/);
  assert.match(compose, /kind: 'logo'/);
  assert.match(compose, /libraryId: direct \? '' : \(clip\.ref \|\| ''\)/);
  assert.match(deck, /type === 'visualizer'/);
  assert.match(deck, /visualizer\.type = ref|layers\[0\]\.type = ref/);
});
