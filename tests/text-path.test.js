/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Yol üstünde yazı (#415): yay, çember ve dalga. Varsayılan düz yazı, eski çizim yolu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

global.window = global.window || {};
require('../src/visualizer/modes/text.js');
const Text = global.window.SVModes.text;
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const near = (a, b, e) => assert.ok(Math.abs(a - b) < (e || 1e-9), a + ' ≠ ' + b);

test('bilinmeyen ya da boş yol: null (düz yazı)', () => {
  for (const k of [undefined, '', 'none', 'spiral', 'ARC']) assert.strictEqual(Text.pathLayout(k, [10, 10], {}), null);
  assert.strictEqual(Text.pathLayout('arc', [], {}), null);
  assert.deepStrictEqual(Text.PATHS, ['arc', 'circle', 'wave']);
});

test('yay: ortadaki harf tepede ve düz, uçlar simetrik aşağıda; açıklık bend·π', () => {
  const w = [10, 10, 10, 10, 10];
  const p = Text.pathLayout('arc', w, { size: 20, bend: 0.5 });
  near(p[2].x, 0);
  near(p[2].y, 0);
  near(p[2].a, 0);
  near(p[0].x, -p[4].x);
  near(p[0].y, p[4].y);
  near(p[0].a, -p[4].a);
  assert.ok(p[0].y > 0 && p[1].y > 0, 'uçlar aşağıda');
  // Uçtan uca açı: (L - w) / R = (50 - 10) / (50 / (0.5π)) = 0.8 · 0.5π
  near(p[4].a - p[0].a, 0.8 * 0.5 * Math.PI, 1e-9);
});

test('çember: tepeden başlıyor, harfler eşit aralıklı, yarıçap yazıya yetiyor, dönüş fazı kaydırıyor', () => {
  const w = new Array(12).fill(10);
  const p = Text.pathLayout('circle', w, { size: 10 });
  const R = Math.hypot(p[0].x, p[0].y);
  for (const q of p) near(Math.hypot(q.x, q.y), R, 1e-9);
  assert.ok(2 * Math.PI * R >= 120, 'çevre yazıdan kısa değil');
  // Yazının ortası tepede (y < 0)
  const midY = (p[5].y + p[6].y) / 2;
  assert.ok(midY < -R * 0.9, String(midY));
  const q = Text.pathLayout('circle', w, { size: 10, phase: Math.PI });
  near(q[0].x, -p[0].x, 1e-9);
  near(q[0].y, -p[0].y, 1e-9);
});

test('dalga: x düz sırada, genlik bend ile, eğim türeve uyuyor', () => {
  const w = new Array(20).fill(8);
  const p = Text.pathLayout('wave', w, { size: 20, bend: 1 });
  for (let i = 1; i < p.length; i++) near(p[i].x - p[i - 1].x, 8);
  const amp = Math.max(...p.map((q) => Math.abs(q.y)));
  assert.ok(amp <= 20 * 1.2 + 1e-9 && amp > 10, String(amp));
  const flat = Text.pathLayout('wave', w, { size: 20, bend: 0.05 });
  assert.ok(Math.max(...flat.map((q) => Math.abs(q.y))) < 2);
  for (const q of p) assert.ok(Number.isFinite(q.a) && Math.abs(q.a) < Math.PI / 2);
});

test('çizim: düz yazı (varsayılan) ve kayan yazı eski yolda; panel seçeneği kayan yazı kapalıyken', () => {
  const src = read('src/visualizer/modes/text.js');
  assert.ok(src.includes("const pathKind = !T.marquee && TEXT_PATHS.indexOf(T.textPath) >= 0 ? T.textPath : '';"));
  assert.ok(src.includes('} else if (T.marquee) {'));
  const panel = read('src/admin/scene-panels.js');
  const i = panel.indexOf("miniSelect('Yazı Yolu'");
  assert.ok(i > 0 && panel.slice(i - 200, i).includes('if (!txt.marquee) {'));
  assert.ok(!/textPath/.test(read('src/shared/defaults.js')), 'varsayılan dosyası değişmedi');
});
