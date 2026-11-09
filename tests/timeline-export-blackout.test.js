'use strict';
/* Dışa aktarım: canlı karartma açıkken "Zaman çizelgesini dahil et" işi
 * içerik denetimini geçip bütün kareleri siyah çiziyordu (karartma bayrağı
 * işe taşınıyor, composeAt bayrak açıkken hiç klip almıyordu). */
const test = require('node:test');
const assert = require('node:assert');
const TL = require('../src/shared/timeline.js');
const TC = require('../src/shared/timeline-compose.js');

function project(blackout) {
  return {
    isBlackout: blackout,
    layerStack: { enabled: true },
    layers: [{ id: 'manual', kind: 'background', type: 'solid', enabled: false }],
    scenes: [{ id: 's1', name: 'Red', data: { layerStack: { enabled: true }, layers: [{ id: 'red', kind: 'background', type: 'solid' }] } }],
    export: { includeTimeline: true, timelineId: 'bankE' },
    timeline: {
      id: 'bankA', name: 'A', itemEnabled: true, tracks: [], markers: [], loop: { enabled: false, start: 0, end: 0 },
      bank: [{ id: 'bankE', name: 'E', itemEnabled: true, markers: [], loop: { enabled: false, start: 0, end: 0 },
        tracks: [{ id: 't', kind: 'clip', clips: [{ id: 'c1', type: 'scene', ref: 's1', start: 0.25, dur: 1.25, transType: 'cut' }] }] }],
    },
  };
}

function unitsAt(job, t) {
  const tl = TL.makeTimeline(job.timeline);
  return TC.composeAt(job, tl, t).cfg.timelineComposition.units;
}

test('canlı karartma açıkken seçili banka çizelgesi siyah dışa aktarılmaz', () => {
  const job = TC.exportJobConfig(project(true), { includeTimeline: true, timelineId: 'bankE' });
  assert.strictEqual(job.isBlackout, false);
  assert.strictEqual(job.timeline.id, 'bankE');
  const units = unitsAt(job, 1);
  assert.strictEqual(units.length, 1);
  assert.ok(units[0].layers.some((l) => l.id === TC.instId({ id: 'c1' }, 'red')));
  // Boşluk yine siyah: karartmayı kaldırmak boşluğu doldurmaz
  assert.strictEqual(unitsAt(job, 0.1).length, 0);
  assert.strictEqual(unitsAt(job, 1.6).length, 0);
});

test('exporter sayfasının ikinci exportJobConfig geçişi de karartmayı kapatır', () => {
  const once = TC.exportJobConfig(project(true), { includeTimeline: true, timelineId: 'bankE' });
  const twice = TC.exportJobConfig(JSON.parse(JSON.stringify(once)));
  assert.strictEqual(twice.isBlackout, false);
  assert.strictEqual(unitsAt(twice, 1).length, 1);
});

test('çizelge dahil değilse karartma bayrağına dokunulmaz', () => {
  const job = TC.exportJobConfig(project(true), { includeTimeline: false });
  assert.strictEqual(job.isBlackout, true);
  assert.strictEqual(TC.exportEnabled(job), false);
});

test('karartma kapalıyken sonuç değişmez', () => {
  const a = TC.exportJobConfig(project(false), { includeTimeline: true, timelineId: 'bankE' });
  assert.strictEqual(a.isBlackout, false);
  assert.strictEqual(unitsAt(a, 1).length, 1);
});
