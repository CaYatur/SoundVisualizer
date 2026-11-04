/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* MilkDrop'un kendi giriş ayarları (#957): varsayılan nötr, kapı kapanınca
   tam sessizlik, kazanç ve yumuşatma yalnız MilkDrop'a gider. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const A = require('../src/shared/milkdrop-audio.js');

function frame(amp) {
  const t = new Uint8Array(1024);
  for (let i = 0; i < t.length; i++) t[i] = Math.round(128 + amp * 127 * Math.sin(i / 8));
  return { timeBytes: t, timeL: t, timeR: t, bass: amp, mid: amp, treble: amp, level: amp };
}

test('varsayılan ayarlar nötr: ses nesnesi aynen geçer', () => {
  const inp = new A.MilkdropInput();
  const a = frame(0.01);
  assert.strictEqual(inp.update(a, undefined, 1 / 60), a);
  const d = fs.readFileSync(path.join(__dirname, '../src/shared/defaults.js'), 'utf8');
  assert.ok(d.includes('milkdrop: { gate: false, gateThreshold: 0.02, gateHold: 0.5, gain: 1, smoothing: 0 }'));
  assert.strictEqual(inp.update(a, A.INPUT_DEFAULTS, 1 / 60), a);
});

test('kapı kapalıyken MilkDrop tam sessizlik alır, ses gelince hemen açılır', () => {
  const inp = new A.MilkdropInput();
  const cfg = { gate: true, gateThreshold: 0.02, gateHold: 0.2 };
  const noise = frame(0.008);
  let v;
  for (let i = 0; i < 6; i++) v = inp.update(noise, cfg, 1 / 60);
  assert.strictEqual(v.mdGated, false, 'bekleme bitmeden kapanmamalı');
  for (let i = 0; i < 20; i++) v = inp.update(noise, cfg, 1 / 60);
  assert.strictEqual(v.mdGated, true);
  assert.ok(v.timeBytes.every((x) => x === 128) && v.timeL.every((x) => x === 128));
  assert.strictEqual(v.bass + v.mid + v.treble, 0);
  v = inp.update(frame(0.5), cfg, 1 / 60);
  assert.strictEqual(v.mdGated, false);
  assert.ok(v.timeBytes.some((x) => x !== 128));
});

test('kazanç genliği ölçekler, yumuşatma kareler arası değişimi azaltır', () => {
  const inp = new A.MilkdropInput();
  const v = inp.update(frame(0.2), { gain: 2 }, 1 / 60);
  const raw = frame(0.2).timeBytes;
  const peak = (t) => Math.max(...Array.from(t, (x) => Math.abs(x - 128)));
  assert.ok(Math.abs(peak(v.timeBytes) - 2 * peak(raw)) <= 2);
  assert.ok(Math.abs(v.bass - 0.4) < 1e-9);
  const s = new A.MilkdropInput();
  s.update(frame(0), { smoothing: 0.8 }, 1 / 60);
  const w = s.update(frame(0.5), { smoothing: 0.8 }, 1 / 60);
  assert.ok(peak(w.timeBytes) < peak(frame(0.5).timeBytes) * 0.3);
});

test('MilkDrop kipi girişi kendi ayarından geçirir; panelde alt bölüm var', () => {
  const md = fs.readFileSync(path.join(__dirname, '../src/visualizer/modes/milkdrop.js'), 'utf8');
  assert.match(md, /MilkdropInput\(\)[\s\S]{0,120}cfg\.audio\.milkdrop/);
  const admin = fs.readFileSync(path.join(__dirname, '../src/admin/admin.js'), 'utf8');
  for (const k of ['gate', 'gateThreshold', 'gateHold', 'gain', 'smoothing']) assert.ok(admin.includes(`path: 'audio.milkdrop.${k}'`), k);
});
