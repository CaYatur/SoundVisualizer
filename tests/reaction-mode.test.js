/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Reaksiyon deseni: iki alan, komşu yayılması, besleme ve tüketim.
   Adım tuvalsiz çalışır (window.SVReaction.step). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

function load() {
  global.window = global.window || {};
  delete require.cache[require.resolve('../src/visualizer/modes/generative.js')];
  require('../src/visualizer/modes/generative.js');
  return global.window.SVReaction;
}

function spot(w, h) {
  const a = new Float32Array(w * h);
  const b = new Float32Array(w * h);
  a.fill(1);
  const cx = (w / 2) | 0;
  const cy = (h / 2) | 0;
  for (let y = cy - 2; y <= cy + 2; y++) {
    for (let x = cx - 2; x <= cx + 2; x++) {
      const i = y * w + x;
      a[i] = 0.5;
      b[i] = 0.25;
    }
  }
  return { a, b, cx, cy };
}

function survey(a, b) {
  let finite = true;
  let uniform = true;
  const a0 = a[0];
  const b0 = b[0];
  let min = Infinity;
  let max = -Infinity;
  let hi = 0;
  for (let i = 0; i < b.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) finite = false;
    if (a[i] !== a0 || b[i] !== b0) uniform = false;
    if (b[i] < min) min = b[i];
    if (b[i] > max) max = b[i];
    if (b[i] > 0.15) hi++;
  }
  return { finite, uniform, min, max, hi };
}

test('adım tohumlanmış ızgarayı değiştirir ve sonlu kalır', () => {
  const R = load();
  const w = 32;
  const h = 24;
  const g = spot(w, h);
  const center = g.cy * w + g.cx;
  const before = g.b[center];
  const far = g.b[0];
  R.step(g.a, g.b, w, h, R.FEED);
  assert.notStrictEqual(g.b[center], before, 'tohumlu hücre değişmedi');
  assert.strictEqual(g.b[0], far, 'uzak hücre bir adımda değişmemeli');
  const st = survey(g.a, g.b);
  assert.strictEqual(st.finite, true);
  assert.strictEqual(st.uniform, false, 'bütün hücreler aynı olmamalı');

  // Modun kendi tohumu, varsayılan oranda yapı büyütür: boşalmaz, düz dolmaz
  const gw = 96;
  const gh = 54;
  const a = new Float32Array(gw * gh);
  const b = new Float32Array(gw * gh);
  R.seed(a, b, gw, gh);
  const beforeHi = survey(a, b).hi;
  for (let n = 0; n < 400; n++) R.step(a, b, gw, gh, R.FEED);
  const later = survey(a, b);
  assert.strictEqual(later.finite, true);
  assert.ok(later.hi > beforeHi, 'yapı büyümeli: ' + later.hi + ' / ' + beforeHi);
  assert.ok(later.hi < b.length * 0.85, 'düz dolmamalı: ' + later.hi);
  assert.ok(later.max - later.min > 0.2, 'tekdüze olmamalı');
  assert.ok(later.max > 0.15, 'alan boşalmamalı');
});

test('bas besleme hızını kaydırır, ızgara bir adımda tekdüze olmaz', () => {
  const R = load();
  const f0 = R.feedFor(0);
  const f1 = R.feedFor(1);
  assert.notStrictEqual(f0, f1, 'bas beslemeyi kaydırmalı');
  assert.ok(Math.abs(f0 - R.FEED) < 0.02 && Math.abs(f1 - R.FEED) < 0.02, 'kayma yapı bölgesinin içinde');
  const w = 40;
  const h = 30;
  const left = spot(w, h);
  const right = spot(w, h);
  R.step(left.a, left.b, w, h, f0);
  R.step(right.a, right.b, w, h, f1);
  const c = left.cy * w + left.cx;
  assert.notStrictEqual(left.b[c], right.b[c], 'farklı besleme aynı hücreyi aynı bırakmamalı');
  for (const g of [left, right]) {
    const st = survey(g.a, g.b);
    assert.strictEqual(st.finite, true);
    assert.strictEqual(st.uniform, false);
  }
});

test('generative.js reaction atar, katalog Üretken Sistemler grubunda listeler', () => {
  const root = path.join(__dirname, '..');
  const gen = fs.readFileSync(path.join(root, 'src/visualizer/modes/generative.js'), 'utf8');
  assert.match(gen, /reaction:\s*Reaction/);
  const MC = require('../src/shared/mode-catalog.js');
  const m = MC.VISUALIZERS.find((x) => x.id === 'reaction');
  assert.ok(m, 'katalogda yok');
  assert.strictEqual(m.label, 'Reaksiyon Deseni');
  assert.strictEqual(m.group, 'Üretken Sistemler');
  const groups = MC.options('visualizer').filter((o) => o.group).map((o) => o.group);
  assert.strictEqual(new Set(groups).size, groups.length, 'grup bölünmüş');
});

test('sözlükte Reaksiyon Deseni var', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/shared/i18n.js'), 'utf8');
  assert.ok(src.includes("'Reaksiyon Deseni':"));
});
