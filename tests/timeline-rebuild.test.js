/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
// #957: zaman çizelgesi yeniden yapımı, geçiş önizlemesi, sağ tık koruması
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const PV = require('../src/admin/transition-preview.js');
const PG = require('../src/admin/pointer-guard.js');
const TL = require('../src/shared/timeline.js');

test('önizleme planı: geçiş, karartma çıkışı ve açılışı sırayla', () => {
  const p = PV.phases({ type: 'crossfade', duration: 2, unit: 'seconds', ease: 'smooth', blackoutType: 'dissolve', blackoutDuration: 0.5 }, 0);
  const tr = p.list.filter((x) => x.kind === 'trans');
  assert.deepStrictEqual(tr.map((x) => x.from + '>' + x.to), ['A>B', 'B>black', 'black>A']);
  assert.ok(Math.abs(tr[0].len - 2) < 1e-6);
  assert.strictEqual(tr[1].type, 'dissolve');
  assert.strictEqual(tr[1].opts.blackoutDirection, 'out');
  assert.strictEqual(tr[2].opts.blackoutDirection, 'in');
  const mid = PV.sampleAt(p, tr[0].t0 + 1);
  assert.strictEqual(mid.from, 'A'); assert.strictEqual(mid.to, 'B');
  assert.ok(mid.p > 0 && mid.p < 1);
});

test('önizleme: vuruş birimi tempoya göre, kesme anlık', () => {
  const p = PV.phases({ type: 'crossfade', duration: 4, unit: 'beats', blackoutType: 'cut' }, 120);
  const tr = p.list.filter((x) => x.kind === 'trans');
  assert.ok(Math.abs(tr[0].len - 2) < 0.05, 'len ' + tr[0].len);
  assert.ok(tr[1].len < 0.01);
  const c = PV.phases({ type: 'cut', duration: 3 }, 0).list.find((x) => x.kind === 'trans');
  assert.ok(c.len < 0.01);
});

test('Geçişi Dene canlı yığına dokunmuyor, yalnız önizlemede', () => {
  const s = read('src/admin/transition-panel.js');
  assert.ok(!/beginTransition/.test(s));
  assert.ok(/SVTransitionPreview/.test(s) && /PV\.create/.test(s));
  assert.ok(/SVTransitionPreview\.create/.test(read('src/admin/timeline-panel.js')));
  const pv = read('src/admin/transition-preview.js');
  assert.ok(!/SVPreview|postMessage|ipcRenderer|beginTransition/.test(pv), 'önizleme çıkışa bağlanmamalı');
  assert.ok(/isConnected/.test(pv), 'kart kapanınca durmalı');
});

test('sağ/orta tık kaydırıcıyı değiştirmiyor', () => {
  const slider = { matches: () => true, closest: () => ({}) };
  assert.strictEqual(PG.shouldBlock({ button: 2, target: slider }), true);
  assert.strictEqual(PG.shouldBlock({ button: 1, target: slider }), true);
  assert.strictEqual(PG.shouldBlock({ button: 0, target: slider }), false);
  assert.ok(/pointer-guard\.js/.test(read('src/admin/index.html')));
  assert.ok(/button !== 0/.test(read('src/admin/scene-shell.js')));
});

test('katman yeniden adlandırma satır içi düzenleyici açıyor', () => {
  const s = read('src/admin/scene-shell.js');
  assert.ok(/function startRename/.test(s));
  assert.ok(/Escape/.test(s) && /Enter/.test(s) && /\.select\(\)/.test(s));
});

test('klip geçişi klibe özgü: tür/eğri korunuyor, sahne geçişi geri yükleniyor', () => {
  const tl = TL.normalize ? TL.normalize({ tracks: [{ kind: 'scene', clips: [{ ref: 'x', start: 0, dur: 1, transType: 'wipe', transEase: 'snap' }] }] }) : null;
  if (tl) {
    const c = tl.tracks[0].clips[0];
    assert.strictEqual(c.transType, 'wipe'); assert.strictEqual(c.transEase, 'snap');
  }
  const a = read('src/admin/admin.js');
  assert.ok(/keepTransition/.test(a) && /restoreTransition\(\)/.test(a));
});
