'use strict';
/* Zaman çizelgesi dışa aktarım + banka: döngü sarma / son durumda kalma,
 * includeTimeline varsayılanı, çoklu çizelge ve pasifleştirme. */
const test = require('node:test');
const assert = require('node:assert');

const TL = require('../src/shared/timeline.js');
global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;

const near = (a, b, eps, msg) =>
  assert.ok(Math.abs(a - b) < (eps || 1e-6), (msg || '') + ' beklenen ' + b + ', gelen ' + a);

function sceneCfg() {
  return {
    layers: [{ id: 'base', type: 'solid', color: '#111' }],
    scenes: [
      { id: 's1', name: 'Bir', data: { layers: [{ id: 'A', type: 'solid', color: '#0f0' }] } },
      { id: 's2', name: 'Iki', data: { layers: [{ id: 'B', type: 'solid', color: '#00f' }] } },
    ],
  };
}

function sceneTl(extra) {
  return TL.makeTimeline(Object.assign({
    tracks: [{
      id: 't1', kind: 'clip', name: 'S',
      clips: [{ id: 'c1', type: 'scene', ref: 's1', start: 0, dur: 4, fade: 0 }],
    }],
    loop: { enabled: false, start: 0, end: 0 },
  }, extra || {}));
}

test('döngü açıkken evalPlayhead loop aralığına sarar', () => {
  const tl = sceneTl({ loop: { enabled: true, start: 1, end: 3 } });
  near(TL.evalPlayhead(tl, 3), 1);
  near(TL.evalPlayhead(tl, 5), 1); // (5-1)%2 = 0 → start
  near(TL.evalPlayhead(tl, 4), 2);
  near(TL.wrapPlayhead(tl, 4), 2, 1e-9, 'wrapPlayhead alias');
});

test('döngü kapalıyken bitişten sonra son durumda kalır', () => {
  const tl = sceneTl();
  const hold = TL.evalPlayhead(tl, 99);
  assert.ok(hold < 4 && hold > 3.9, 'son klibin içinde kalmalı: ' + hold);
  const cfg = sceneCfg();
  const at = TL.applyTimelineAt(cfg, tl, 99);
  assert.strictEqual(at.applied, true);
  assert.ok(at.cfg.layers.some((l) => l.id === 'A'), 'son sahne katmanı tutulmalı');
});

test('döngü açıkken applyTimelineAt sarılmış t ile sahne uygular', () => {
  const tl = sceneTl({
    tracks: [{
      id: 't1', kind: 'clip', name: 'S',
      clips: [
        { id: 'c1', type: 'scene', ref: 's1', start: 0, dur: 2, fade: 0 },
        { id: 'c2', type: 'scene', ref: 's2', start: 2, dur: 2, fade: 0 },
      ],
    }],
    loop: { enabled: true, start: 0, end: 4 },
  });
  const cfg = sceneCfg();
  const a = TL.applyTimelineAt(cfg, tl, 1);
  assert.ok(a.cfg.layers.some((l) => l.id === 'A'));
  const b = TL.applyTimelineAt(cfg, tl, 5); // → 1
  near(b.t, 1);
  assert.ok(b.cfg.layers.some((l) => l.id === 'A'), 'sarınca ilk sahne');
});

test('export.includeTimeline varsayılanı açık', () => {
  assert.strictEqual(SV.DEFAULT_CONFIG.export.includeTimeline, true);
  assert.ok(SV.DEFAULT_CONFIG.timeline.id);
  assert.strictEqual(SV.DEFAULT_CONFIG.timeline.itemEnabled, true);
  assert.ok(Array.isArray(SV.DEFAULT_CONFIG.timeline.bank));
});

test('banka: ekle, değiştir, pasifleştir, sil', () => {
  const cfg = {
    id: 'tl1', name: 'A', itemEnabled: true, bank: [],
    tempo: [{ t: 0, bpm: 120, beatsPerBar: 4 }],
    tracks: [{ id: 't1', kind: 'clip', name: 'S', clips: [{ id: 'c1', type: 'scene', ref: 's1', start: 0, dur: 2 }] }],
    markers: [], loop: { enabled: false, start: 0, end: 0 }, snap: 'bar', fps: 60,
  };
  TL.addTimeline(cfg);
  assert.notStrictEqual(cfg.id, 'tl1');
  assert.strictEqual(cfg.bank.length, 1);
  assert.strictEqual(cfg.bank[0].name, 'A');
  assert.strictEqual(cfg.tracks.length, 0, 'yeni çizelge boş başlar');

  const prev = cfg.bank[0].id;
  TL.switchTimeline(cfg, prev);
  assert.strictEqual(cfg.id, prev);
  assert.strictEqual(cfg.tracks.length, 1);

  TL.setTimelineItemEnabled(cfg, cfg.id, false);
  assert.strictEqual(cfg.itemEnabled, false);

  const list = TL.listTimelineBank(cfg);
  assert.ok(list.length >= 2);
  TL.setTimelineItemEnabled(cfg, list[1].id, false);
  const again = TL.listTimelineBank(cfg);
  assert.strictEqual(again.find((x) => x.id === list[1].id).itemEnabled, false);

  const keep = cfg.id;
  const drop = again.find((x) => x.id !== keep).id;
  TL.removeTimeline(cfg, drop);
  assert.ok(!TL.listTimelineBank(cfg).some((x) => x.id === drop));
  assert.strictEqual(cfg.id, keep);
});

test('pasif çizelge itemEnabled=false dışa aktarım kapısı için okunur', () => {
  /* exporter wantTl && itemEnabled !== false — burada yalnız bayrağı doğrula */
  const cfg = SV.clone(SV.DEFAULT_CONFIG);
  assert.strictEqual(cfg.timeline.itemEnabled, true);
  cfg.timeline.itemEnabled = false;
  assert.strictEqual(cfg.timeline.itemEnabled, false);
  assert.notStrictEqual(cfg.export.includeTimeline, false);
});
