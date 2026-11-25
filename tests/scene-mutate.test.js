/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Sahneyi değiştirme (#447): ölçüye göre, aralıkta, yalnız görünüm ayarları; tohumlu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

global.window = global.window || {};
const Schema = require('../src/shared/schema.js');
require('../src/shared/defaults.js');
const M = require('../src/shared/scene-mutate.js');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const base = () => {
  const c = global.window.SV.defaultConfig();
  c.background.gradient.colors = ['#ff0000', '#00ff00', '#0000ff'];
  c.visualizer.color = '#3aa6ff';
  return c;
};
const rows = Schema.SLIDERS.concat(Schema.RANGES);
const rowOf = (p) => rows.find((r) => r.path === p);

test('ölçü 0 ya da eksik girdi: değişiklik yok', () => {
  assert.deepStrictEqual(M.mutate(base(), 0, 1, Schema).changes, []);
  assert.deepStrictEqual(M.mutate(null, 0.5, 1, Schema).changes, []);
  assert.deepStrictEqual(M.mutate(base(), 0.5, 1, null).changes, []);
});

test('yalnız görünüm kökleri; ses çözümlemesi, ağır 3B ayarları, mod türü ve diğer bloklar yok', () => {
  for (let s = 1; s < 40; s++) {
    for (const c of M.mutate(base(), 1, s, Schema).changes) {
      assert.ok(M.ROOTS.some((r) => c.path.startsWith(r)), c.path);
      assert.ok(!/^visualizer\.spectrum\.|^visualizer\.(min|max)Freq$|^geometry\.(resolution|attractorPoints)$/.test(c.path), c.path);
      assert.ok(!/\.type$/.test(c.path), c.path);
    }
  }
});

test('sayılar aralıkta, tamsayılar tam, sıçrama ölçünün yarısını geçmiyor', () => {
  for (const amt of [0.1, 0.5, 1]) {
    for (let s = 1; s < 30; s++) {
      for (const c of M.mutate(base(), amt, s, Schema).changes) {
        if (typeof c.to !== 'number') continue;
        const r = rowOf(c.path);
        assert.ok(c.to >= r.min && c.to <= r.max, c.path + ' ' + c.to);
        if (r.int) assert.strictEqual(c.to, Math.round(c.to), c.path);
        assert.ok(Math.abs(c.to - c.from) <= amt * 0.5 * (r.max - r.min) + 1e-3, c.path);
      }
    }
  }
});

test('okuyucu verilince değer oradan (katman yığını): genel alan eskimiş olsa da', () => {
  const c = base();
  c.visualizer.glow = 0; // genel alan eskimiş
  const layerGlow = 0.8; // ekrandaki katmanın değeri
  const read = (p) => (p === 'visualizer.glow' ? layerGlow : p.startsWith('feedback.') ? undefined : undefined);
  for (let s = 1; s < 20; s++) {
    for (const x of M.mutate(c, 0.2, s, Schema, read).changes) {
      if (x.path === 'visualizer.glow') {
        assert.strictEqual(x.from, layerGlow);
        assert.ok(Math.abs(x.to - layerGlow) <= 0.2 * 0.5 + 1e-9, String(x.to));
      } else assert.fail('okuyucunun undefined döndürdüğü yol değişmemeli: ' + x.path);
    }
  }
});

test('panel okuma ve geri almayı katmana göre yapıyor, kilitli katmana dokunmuyor', () => {
  const gen = read('src/admin/scenegen.js');
  assert.ok(gen.includes('return lockedAt(cfg, e) ? undefined : getPath(cfg, e);'));
  assert.ok(gen.includes('undo.push({ path: p, value: copy(getPath(cfg, p)) });'));
  assert.ok(gen.includes('for (const u of lastMutation) P().set(u.path, copy(u.value));'));
});

test('genişletilmiş aralıktaki kullanıcı değeri olduğu gibi kalıyor', () => {
  const c = base();
  c.visualizer.sensitivity = 9; // aralık 0.3–3, kullanıcı genişletmiş
  for (let s = 1; s < 20; s++) assert.ok(!M.mutate(c, 1, s, Schema).changes.some((x) => x.path === 'visualizer.sensitivity'));
});

test('tohumlu: aynı sahne, ölçü ve tohum aynı sonucu verir; girdi değişmez', () => {
  const c = base();
  const before = JSON.stringify(c);
  const a = M.mutate(c, 0.4, 1234, Schema).changes;
  const b = M.mutate(c, 0.4, 1234, Schema).changes;
  assert.deepStrictEqual(a, b);
  assert.notDeepStrictEqual(a, M.mutate(c, 0.4, 999, Schema).changes);
  assert.strictEqual(JSON.stringify(c), before);
  assert.ok(a.length > 10, String(a.length));
});

test('renkler birlikte aynı tonla döner, parlaklık ve doygunluk kalır', () => {
  let seenColors = false;
  for (let s = 1; s < 20; s++) {
    const ch = M.mutate(base(), 1, s, Schema).changes;
    const pal = ch.find((c) => c.path === 'background.gradient.colors');
    if (!pal) continue;
    seenColors = true;
    const vis = ch.find((c) => c.path === 'visualizer.color');
    const d0 = (M.hexToHsl(pal.to[0])[0] - M.hexToHsl(pal.from[0])[0] + 540) % 360 - 180;
    const dv = (M.hexToHsl(vis.to)[0] - M.hexToHsl(vis.from)[0] + 540) % 360 - 180;
    assert.ok(Math.abs(d0) <= M.HUE_MAX + 1, String(d0));
    assert.ok(Math.abs(d0 - dv) < 3, d0 + ' / ' + dv);
    for (let i = 0; i < 3; i++) {
      const [, s0, l0] = M.hexToHsl(pal.from[i]);
      const [, s1, l1] = M.hexToHsl(pal.to[i]);
      assert.ok(Math.abs(s0 - s1) < 0.02 && Math.abs(l0 - l1) < 0.02);
    }
  }
  assert.ok(seenColors);
  assert.strictEqual(M.shiftHue('kırmızı', 30), 'kırmızı');
});

test('panel: yalnız panelde yüklü, son değişiklik geri alınabiliyor', () => {
  assert.ok(read('src/admin/index.html').includes('../shared/scene-mutate.js'));
  for (const p of ['src/thumbs/modes.html', 'src/visualizer/index.html', 'src/exporter/index.html']) assert.ok(!read(p).includes('scene-mutate'), p);
  const gen = read('src/admin/scenegen.js');
  assert.ok(gen.includes('function undoMutation()') && gen.includes("text: 'Sahneyi Değiştir'"));
});
