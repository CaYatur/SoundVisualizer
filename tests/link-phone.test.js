/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Telefon bağlantısı: kullanıcı presetleri, köprü kazancı, söz seçimi. */
const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/shared/link-phone.js');

test('köprü kazancı 1de düzeyi bozmaz, 2de ikiye katlar, uçları keser', () => {
  assert.strictEqual(L.clampGain(undefined), 1);
  assert.strictEqual(L.clampGain(3), 2);
  assert.strictEqual(L.clampGain(-1), 0);
  const quiet = Int16Array.from([1000, -1000, 20000]);
  L.scalePcm16(quiet, 1);
  assert.deepStrictEqual(Array.from(quiet), [1000, -1000, 20000]);
  const hot = Int16Array.from([1000, -1000, 20000]);
  L.scalePcm16(hot, 2);
  assert.deepStrictEqual(Array.from(hot), [2000, -2000, 32767]);
  const mute = Int16Array.from([1000]);
  L.scalePcm16(mute, 0);
  assert.strictEqual(mute[0], 0);
});

test('yerleşik paket gitmez, kullanıcının milkdrop ve studio gövdesi gider', () => {
  const store = {
    milk: { id: 'milk', kind: 'milkdrop', name: 'Benim', source: 'warp' },
    studio: { id: 'studio', kind: 'visualizer', name: 'Sahne', shader: 'void main(){}' },
    builtin: { id: 'pack', kind: 'milkdrop', builtin: true, source: 'nope' },
    empty: { id: 'empty', kind: 'visualizer', name: 'Boş' },
  };
  const items = L.packUserPresets(Object.values(store).map((p) => (p.kind === 'milkdrop' ? Object.assign({}, p, { source: undefined, lazy: true }) : p)), (id) => store[id], ['studio']);
  const ids = items.map((p) => p.id);
  assert.ok(ids.indexOf('studio') === 0, 'açık studio preset önde');
  assert.ok(ids.includes('milk'));
  assert.ok(!ids.includes('pack'));
  assert.ok(!ids.includes('empty'));
  assert.strictEqual(items.find((p) => p.id === 'milk').source, 'warp');
  assert.strictEqual(items.find((p) => p.id === 'studio').shader, 'void main(){}');
  assert.ok(items.every((p) => p.fromPc === true));
});

test('çok büyük gövde kotayı aşınca düşer, açık preset kalır', () => {
  const big = 'x'.repeat(L.MAX_ONE + 1);
  const items = L.packUserPresets([
    { id: 'huge', kind: 'visualizer', shader: big },
    { id: 'open', kind: 'background', shader: 'ok' },
  ], null, ['open']);
  assert.deepStrictEqual(items.map((p) => p.id), ['open']);
});

test('telefonda açılan parçanın sözü önce PC kitaplığından gelir', () => {
  const track = { has: true, title: 'Deniz', artist: 'Ada' };
  const pc = [{ id: 'pc1', title: 'Deniz', artist: 'Ada', text: '[00:01.00]PC' }];
  const phone = [{ id: 'ph1', title: 'Deniz', text: 'telefon' }];
  const hit = L.lyricChoice({ connected: true, audioSend: true, track, pcTitle: 'Deniz', pcArtist: 'Ada', pcItems: pc, phoneItems: phone, phoneAuto: { text: 'otomatik' } });
  assert.strictEqual(hit.source, 'pc-library');
  assert.strictEqual(hit.items.length, 1);
  assert.strictEqual(hit.items[0].text, '[00:01.00]PC');
  const miss = L.lyricChoice({ connected: true, audioSend: true, track, pcTitle: 'Deniz', pcArtist: 'Ada', pcItems: [], phoneItems: phone, phoneAuto: { text: 'otomatik' } });
  assert.strictEqual(miss.source, 'phone');
  assert.strictEqual(miss.items[0].id, 'ph1');
  assert.strictEqual(miss.items[1].text, 'otomatik');
  const other = L.lyricChoice({ connected: true, audioSend: true, track, pcTitle: 'Başka', pcArtist: 'Ada', pcItems: pc, phoneItems: phone });
  assert.strictEqual(other.source, 'phone');
  const off = L.lyricChoice({ connected: false, audioSend: true, track, pcTitle: 'Deniz', pcArtist: 'Ada', pcItems: pc, phoneItems: phone });
  assert.strictEqual(off.source, 'phone');
});

test('PC parçası izlenirken telefonun sözü karışmaz', () => {
  const r = L.lyricChoice({ followPc: true, track: { has: true, title: 'Yerel' }, pcItems: [{ text: 'pc söz' }], phoneItems: [{ text: 'yerel' }], phoneAuto: { text: 'oto' } });
  assert.strictEqual(r.source, 'pc');
  assert.deepStrictEqual(r.items.map((i) => i.text), ['pc söz']);
});
