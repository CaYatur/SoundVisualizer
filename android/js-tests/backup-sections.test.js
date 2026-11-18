/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Yedek bölümleri: parça parça dışa aktarma ve seçilen bölümlerin geri yüklenmesi. */
const test = require('node:test');
const assert = require('node:assert');
const B = require('../../src/mobile/backup-sections.js');

const cfg = () => ({
  docVersion: 4, ui: { theme: 'dark' }, power: { fpsCap: 30 }, audio: { sensitivity: 1 },
  layers: [{ id: 'a' }], background: { type: 'x' }, scenes: [{ id: 's1' }], _activeSceneId: 's1',
  userPresets: [{ id: 'u' }], timeline: { id: 't' }, milkdropLibrary: { ratings: {} },
});

test('her ayar anahtarının bir bölümü var', () => {
  assert.strictEqual(B.sectionOf('layers'), 'scenes');
  assert.strictEqual(B.sectionOf('scenes'), 'scenes');
  assert.strictEqual(B.sectionOf('userPresets'), 'colors');
  assert.strictEqual(B.sectionOf('timeline'), 'timeline');
  assert.strictEqual(B.sectionOf('ui'), 'settings');
  assert.strictEqual(B.sectionOf('docVersion'), null);
});

test('dışa aktarmada yalnız seçilen bölümler ve biçim anahtarı gider', () => {
  const p = B.pickSettings(cfg(), ['colors']);
  assert.deepStrictEqual(Object.keys(p).sort(), ['docVersion', 'userPresets']);
  const q = B.pickSettings(cfg(), ['scenes', 'settings']);
  assert.ok(q.layers && q.scenes && q.ui && q.power);
  assert.strictEqual(q.timeline, undefined);
});

test('seçilmeyen bölümler telefondaki gibi kalır', () => {
  const cur = cfg();
  const inc = Object.assign(cfg(), { ui: { theme: 'light' }, scenes: [{ id: 'yeni' }], timeline: { id: 'yeni' } });
  const m = B.mergeSettings(cur, inc, ['scenes'], false);
  assert.strictEqual(m.scenes[0].id, 'yeni');
  assert.strictEqual(m.ui.theme, 'dark');
  assert.strictEqual(m.timeline.id, 't');
});

test('tam yedeğin hepsi seçilince ayar yedektekiyle değişir, parça yedek birleşir', () => {
  const all = ['settings', 'scenes', 'colors', 'timeline', 'presets'];
  const inc = { ui: { theme: 'light' } };
  assert.strictEqual(B.mergeSettings(cfg(), inc, all, false), inc);
  const m = B.mergeSettings(cfg(), inc, all, true);
  assert.strictEqual(m.ui.theme, 'light');
  assert.ok(m.scenes, 'parça yedekte olmayan bölüm silinmez');
});

test('yedekte olanlar listelenir, olmayan bölüm sunulmaz', () => {
  const a = B.available(B.pickSettings(cfg(), ['colors']), { presets: 3, videos: 0 });
  assert.deepStrictEqual(a, { colors: 1, presets: 3 });
  const b = B.available(cfg(), { logos: 2 });
  assert.deepStrictEqual(Object.keys(b).sort(), ['colors', 'logos', 'scenes', 'settings', 'timeline']);
});

test('yerel tercihler bölümüne göre, geçiş bayrakları taşınmaz', () => {
  const rows = [['sv-export', '{}'], ['sv-scene-thumb:a', 'x'], ['sv-theme-default-v2', '1'], ['sv-perf-default-v1', '1'], ['baska', '1']];
  assert.deepStrictEqual(Object.keys(B.pickLocal(rows, ['settings'])), ['sv-export']);
  assert.deepStrictEqual(Object.keys(B.pickLocal(rows, ['scenes'])), ['sv-scene-thumb:a']);
  assert.deepStrictEqual(B.pickLocal(rows, ['colors']), {});
});
