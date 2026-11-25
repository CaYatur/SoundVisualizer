/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* PC presetleri telefonda yalnız oturumluk durur. Söz önce PC kitaplığından gelir. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const L = require('../../src/shared/link-phone.js');
const root = path.join(__dirname, '..', '..');

test('telefonda açılan parçanın sözü önce PC kitaplığından gelir', () => {
  const track = { has: true, title: 'Deniz', artist: 'Ada' };
  const pc = [{ id: 'pc1', title: 'Deniz', artist: 'Ada', text: '[00:01.00]PC' }];
  const phone = [{ id: 'ph1', title: 'Deniz', text: 'telefon' }];
  const hit = L.lyricChoice({ connected: true, audioSend: true, track, pcTitle: 'Deniz', pcArtist: 'Ada', pcItems: pc, phoneItems: phone, phoneAuto: { text: 'otomatik' } });
  assert.strictEqual(hit.source, 'pc-library');
  assert.strictEqual(hit.items[0].text, '[00:01.00]PC');
  const miss = L.lyricChoice({ connected: true, audioSend: true, track, pcTitle: 'Deniz', pcArtist: 'Ada', pcItems: [], phoneItems: phone, phoneAuto: { text: 'otomatik' } });
  assert.strictEqual(miss.source, 'phone');
  assert.strictEqual(miss.items[1].text, 'otomatik');
  const followed = L.lyricChoice({ followPc: true, pcItems: [{ text: 'pc söz' }], phoneItems: phone, phoneAuto: { text: 'otomatik' } });
  assert.strictEqual(followed.source, 'pc');
  assert.deepStrictEqual(followed.items.map((i) => i.text), ['pc söz']);
});

test('PC presetleri telefonun kendi listesine yazılmaz ve kopunca gider', () => {
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/shared/defaults.js'), 'utf8'), sandbox, { filename: 'defaults.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/shared/presets.js'), 'utf8'), sandbox, { filename: 'presets.js' });
  const P = sandbox.SVPresets;
  assert.strictEqual(typeof P.setSession, 'function');
  P.setUser([{ id: 'mine', kind: 'visualizer', name: 'Benim', shader: 'a' }]);
  P.setSession([
    { id: 'pc1', kind: 'visualizer', name: 'PC sahne', shader: 'void mainImage(){}', fromPc: true },
    { id: 'md', kind: 'milkdrop', name: 'Benim milk', source: 'warp 1', fromPc: true },
  ]);
  assert.strictEqual(P.get('pc1').shader, 'void mainImage(){}');
  assert.strictEqual(P.get('pc1').engine, 'shader');
  assert.strictEqual(P.get('md').kind, 'milkdrop');
  assert.strictEqual(P.get('md').source, 'warp 1');
  P.setUser([{ id: 'mine', kind: 'visualizer', name: 'Benim', shader: 'a' }]);
  assert.ok(P.get('pc1'), 'telefon listesi yenilenince PC preseti kalır');
  P.applyDelta({ upsert: [{ id: 'pc1', kind: 'visualizer', name: 'PC sahne', shader: 'yeni', fromPc: true }], remove: [] });
  assert.ok(!P.user().some((p) => p.id === 'pc1'), 'PC preseti telefona kaydedilmez');
  assert.strictEqual(P.get('pc1').shader, 'void mainImage(){}');
  P.setSession([]);
  assert.strictEqual(P.get('pc1'), null);
  assert.strictEqual(P.get('md'), null);
  assert.ok(P.get('mine'));
});

test('köprü kazancı uçları keser', () => {
  const hot = Int16Array.from([20000, -20000]);
  L.scalePcm16(hot, 2);
  assert.deepStrictEqual(Array.from(hot), [32767, -32768]);
  assert.strictEqual(L.clampGain(4), 2);
});
