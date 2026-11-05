'use strict';
/* Dışa aktarım: çizelge klip sınırını geçince sonraki sahne uygulanmalı ve
 * yığın yeni katmanlarla yeniden kurulmalı (ilk sahneden sonra siyah kare
 * hatası). Duraklatılmış çizelge kare zamanını etkilememeli. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const TL = require('../src/shared/timeline.js');

function cfgTwo() {
  return {
    layers: [{ id: 'base', type: 'solid', color: '#111' }],
    scenes: [
      { id: 's1', name: 'Bir', data: { layers: [{ id: 'A', type: 'solid', color: '#0f0' }] } },
      { id: 's2', name: 'Iki', data: { layers: [{ id: 'B', type: 'solid', color: '#00f' }] } },
    ],
  };
}
function tlTwo(playing) {
  return TL.makeTimeline({
    playing: !!playing,
    tracks: [{ id: 't1', kind: 'clip', name: 'S', clips: [
      { id: 'c1', type: 'scene', ref: 's1', start: 0, dur: 2, fade: 0 },
      { id: 'c2', type: 'scene', ref: 's2', start: 2, dur: 2, fade: 0 },
    ] }],
    loop: { enabled: false, start: 0, end: 0 },
  });
}

test('klip sınırını geçen kareler sonraki sahneyi uygular (duraklatılmış çizelgede de)', () => {
  for (const playing of [false, true]) {
    const cfg = cfgTwo(); const tl = tlTwo(playing);
    const fps = 10;
    for (let i = 0; i < 40; i++) {
      const at = TL.applyTimelineAt(cfg, tl, i / fps);
      assert.strictEqual(at.applied, true, 'kare ' + i + ' uygulanmalı');
      const want = i < 20 ? 'A' : 'B';
      assert.ok(at.cfg.layers.some((l) => l.id === want), 'kare ' + i + ' → ' + want);
    }
  }
});

test('exporter sahne değişince yığını yeniden kurar', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/exporter/exporter.js'), 'utf8');
  assert.match(src, /function syncStackLayers\(base\)/);
  assert.match(src, /syncStackLayers\(base\);/);
  assert.match(src, /stack\.setConfig\(base\)/);
  // Opaklık (fade) imzaya girmemeli: her karede yeniden kurulum olmasın
  assert.match(src, /k === 'opacity' \? undefined/);
});
