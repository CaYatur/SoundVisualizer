'use strict';
/* Cue listesi (GO) testleri.
 *
 * Bekleme işareti canlı oynatmayı durdurur; bütün pencereler aynı noktada
 * durmalı (çıpadan kapalı formül). Eski işaretler ve çevrimdışı dışa
 * aktarımın doğrusal taşıması etkilenmemeli. */
const test = require('node:test');
const assert = require('node:assert');
const TL = require('../src/shared/timeline.js');
const SC = require('../src/shared/showclock.js');

test('cues: hold is kept only when on, so old markers serialize unchanged', () => {
  const plain = TL.makeMarker({ t: 3, name: 'A' });
  assert.deepStrictEqual(Object.keys(plain).sort(), ['id', 'name', 't']);
  const held = TL.makeMarker({ t: 3, name: 'A', hold: true });
  assert.strictEqual(held.hold, true);
  assert.strictEqual('hold' in TL.makeMarker({ t: 1, hold: 'yes' }), false);
  const tl = TL.makeTimeline({ markers: [{ t: 2, name: 'x', hold: true }, { t: 5, name: 'y' }] });
  assert.strictEqual(tl.markers[0].hold, true);
  assert.strictEqual('hold' in tl.markers[1], false);
});

test('cues: holdAfter finds the next hold strictly after t', () => {
  const ms = [TL.makeMarker({ t: 8, hold: true }), TL.makeMarker({ t: 2 }), TL.makeMarker({ t: 4, hold: true })];
  assert.strictEqual(TL.holdAfter(ms, 0).t, 4);
  assert.strictEqual(TL.holdAfter(ms, 4).t, 8, 'resuming from a cue does not catch the same cue');
  assert.strictEqual(TL.holdAfter(ms, 8), null);
  assert.strictEqual(TL.holdAfter(null, 0), null);
});

test('cues: every window resolves to the same hold point from the anchor', () => {
  const tr = { playing: true, time: 1, rate: 1 };
  const a = SC.anchorFrom(tr, 10000, null, 4);
  assert.strictEqual(a.hold, 4);
  assert.strictEqual(SC.resolve(a, 10000 + 2000), 3, 'before the hold it runs');
  assert.strictEqual(SC.resolve(a, 10000 + 3000), 4, 'reaches the hold');
  assert.strictEqual(SC.resolve(a, 10000 + 60000), 4, 'and stays there');
});

test('cues: no hold when paused, reversed, behind the head, or past the loop end', () => {
  assert.strictEqual('hold' in SC.anchorFrom({ playing: false, time: 1 }, 0, null, 4), false);
  assert.strictEqual('hold' in SC.anchorFrom({ playing: true, time: 5 }, 0, null, 4), false);
  assert.strictEqual('hold' in SC.anchorFrom({ playing: true, time: 1, rate: -1 }, 0, null, 4), false);
  const loop = { enabled: true, start: 0, end: 3 };
  const a = SC.anchorFrom({ playing: true, time: 1 }, 0, loop, 4);
  assert.strictEqual('hold' in a, false, 'the loop wraps before reaching the hold');
  assert.ok(Math.abs(SC.resolve(a, 3500) - 1.5) < 1e-9, 'loop wraps as before');
  // Döngü içindeki bekleme sarmadan önce tutar
  const b = SC.anchorFrom({ playing: true, time: 0.5 }, 0, loop, 2);
  assert.strictEqual(SC.resolve(b, 5000), 2);
});

test('cues: anchors without holds behave exactly as before', () => {
  const tr = { playing: true, time: 2, rate: 1 };
  const a = SC.anchorFrom(tr, 0, null);
  assert.strictEqual('hold' in a, false);
  assert.strictEqual(SC.resolve(a, 1500), 3.5);
});

test('cues: offline transport ignores holds (export stays linear)', () => {
  const tl = TL.makeTimeline({ markers: [{ t: 1, hold: true }] });
  const tr = new TL.Transport(tl);
  tr.play();
  for (let i = 0; i < 60; i++) tr.advance(1 / 30);
  assert.ok(Math.abs(tr.time - 2) < 1e-9);
});
