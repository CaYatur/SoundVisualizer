'use strict';
/* Yakalama: ölçü (2 sn @120BPM) yanında sabit 1 sn / 0,5 sn adımları;
 * Kapalı serbest; cetvel biriminden bağımsız; BPM değişince ölçü adımı
 * değişir, saniye adımları değişmez. */
const test = require('node:test');
const assert = require('node:assert');
global.window = global.window || {};
const TL = require('../src/shared/timeline.js');
window.SVTimeline = TL;
const TE = require('../src/shared/timeline-edit.js');

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, (msg || '') + ' ' + a + ' vs ' + b);

test('SNAP_MODES 1s ve 0.5s içerir; varsayılan bar kalır', () => {
  assert.ok(TL.SNAP_MODES.indexOf('1s') >= 0);
  assert.ok(TL.SNAP_MODES.indexOf('0.5s') >= 0);
  assert.ok(TL.SNAP_MODES.indexOf('bar') >= 0);
  assert.ok(TL.SNAP_MODES.indexOf('off') >= 0);
  const tl = TL.makeTimeline({});
  assert.strictEqual(tl.snap, 'bar');
});

test('snapSeconds: 1s / 0.5s tempodan bağımsız; bar 2 sn @120', () => {
  const map = TL.makeTempoMap([{ t: 0, bpm: 120, beatsPerBar: 4 }]);
  near(TL.snapSeconds(map, 1.4, '1s'), 1, 1e-12);
  near(TL.snapSeconds(map, 1.6, '1s'), 2, 1e-12);
  near(TL.snapSeconds(map, 0.74, '0.5s'), 0.5, 1e-12);
  near(TL.snapSeconds(map, 0.76, '0.5s'), 1, 1e-12);
  near(TL.snapSeconds(map, 1.4, 'bar'), 2, 1e-9, 'ölçü 2sn');
  assert.strictEqual(TL.snapSeconds(map, 1.37, 'off'), 1.37);
});

test('snapSeconds: BPM değişince bar değişir, 1s aynı kalır', () => {
  const map60 = TL.makeTempoMap([{ t: 0, bpm: 60, beatsPerBar: 4 }]);
  near(TL.snapSeconds(map60, 3.1, 'bar'), 4, 1e-9, '60BPM ölçü=4sn');
  near(TL.snapSeconds(map60, 3.1, '1s'), 3, 1e-12);
  near(TL.snapSeconds(map60, 3.1, '0.5s'), 3, 1e-12);
});

test('gridStep: 1s / 0.5s / bar / off', () => {
  const map = TL.makeTempoMap([{ t: 0, bpm: 120, beatsPerBar: 4 }]);
  assert.strictEqual(TE.gridStep(map, '1s', 60, 0), 1);
  assert.strictEqual(TE.gridStep(map, '0.5s', 60, 0), 0.5);
  assert.strictEqual(TE.gridStep(map, 'bar', 60, 0), 2);
  assert.strictEqual(TE.gridStep(map, 'off', 60, 0), 0.1);
});

test('makeTimeline: kayıtlı 0.5s snap geri yüklenir', () => {
  const tl = TL.makeTimeline({ snap: '0.5s' });
  assert.strictEqual(tl.snap, '0.5s');
  const tl2 = TL.makeTimeline({ snap: '1s' });
  assert.strictEqual(tl2.snap, '1s');
  const bad = TL.makeTimeline({ snap: 'nope' });
  assert.strictEqual(bad.snap, 'bar');
});

test('panel: yakalama menüsünde 1 sn / 0,5 sn / Kapalı var', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../src/admin/timeline-panel.js'), 'utf8');
  assert.match(src, /\['1s', '1 saniye'\]/);
  assert.match(src, /\['0\.5s', '0,5 saniye'\]/);
  assert.match(src, /\['off', 'Kapalı'\]/);
  assert.match(src, /Cetvel biriminden bağımsızdır/);
});
