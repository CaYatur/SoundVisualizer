/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Canlı kaynakta kare gecikmesi (#420). Kapalıyken (varsayılan) hiçbir şey kurulmuyor ve
   katman eskisi gibi çiziyor; açıkken halka sabit bellekle doğru kareyi veriyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let made = 0;
const fakeCanvas = () => {
  made++;
  const c = { width: 0, height: 0, drawn: [], getContext: () => ({ drawImage: (pic) => c.drawn.push(pic.id) }) };
  return c;
};
global.window = global.window || {};
global.document = { createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : {}) };
require('../src/visualizer/modes/media.js');
const T = global.window.SVMediaTransport;
const Media = global.window.SVMedia;

const layer = (source) => {
  const l = Object.create(Media.prototype);
  l._source = source;
  l.offline = false;
  return l;
};

test('pickDelayed: istenen andaki ya da ondan önceki en yeni kare; dolmadıysa en eski', () => {
  const f = [{ t: 1 }, { t: 1.5 }, { t: 2 }];
  assert.strictEqual(T.pickDelayed(f, 1.7).t, 1.5);
  assert.strictEqual(T.pickDelayed(f, 2).t, 2);
  assert.strictEqual(T.pickDelayed(f, 0.2).t, 1);
  assert.strictEqual(T.pickDelayed([], 1), null);
  assert.strictEqual(T.delayOf({}), 0);
  assert.strictEqual(T.delayOf({ delay: 9 }), T.DELAY_MAX);
  assert.strictEqual(T.delayOf({ delay: -1 }), 0);
});

test('varsayılan ve video dosyası: halka kurulmaz, kaynak olduğu gibi çizilir', () => {
  made = 0;
  for (const [src, m] of [['webcam', {}], ['webcam', { delay: 0 }], ['file', { delay: 1 }]]) {
    const l = layer(src);
    for (let i = 0; i < 10; i++) assert.strictEqual(l._delayed({ id: i }, 1280, 720, m, i / 30), null);
    assert.ok(!l._ring);
  }
  const off = layer('webcam');
  off.offline = true;
  assert.strictEqual(off._delayed({ id: 1 }, 1280, 720, { delay: 1 }, 0), null);
  assert.strictEqual(made, 0);
});

test('gecikme açık: 0,5 sn önceki kare gösterilir, tuvaller yeniden kullanılır', () => {
  made = 0;
  const l = layer('webcam');
  const m = { delay: 0.5 };
  let out = null;
  for (let i = 0; i <= 300; i++) out = l._delayed({ id: i }, 1280, 720, m, i / 30); // 10 sn, 30 fps
  // t = 10 sn: 9,5 sn'deki kare (kare 285)
  assert.deepStrictEqual(out.canvas.drawn.slice(-1), [285]);
  assert.strictEqual(out.w, 480);
  assert.strictEqual(out.h, 270);
  // 0,5 sn × 30 fps ≈ 16 kare tutuluyor; 301 kare için 301 tuval açılmıyor
  assert.ok(l._ring.frames.length <= 18, String(l._ring.frames.length));
  assert.ok(made <= 20, 'açılan tuval: ' + made);
});

test('kapatınca halka bırakılır; boyut değişince baştan kurulur', () => {
  const l = layer('screen');
  for (let i = 0; i < 40; i++) l._delayed({ id: i }, 1920, 1080, { delay: 1 }, i / 30);
  assert.ok(l._ring && l._ring.frames.length > 0);
  l._delayed({ id: 99 }, 640, 480, { delay: 1 }, 41 / 30); // 4:3 → 480×360
  assert.strictEqual(l._ring.h, 360);
  assert.strictEqual(l._ring.frames.length, 1);
  assert.strictEqual(l._delayed({ id: 100 }, 640, 480, { delay: 0 }, 42 / 30), null);
  assert.strictEqual(l._ring, null);
});

test('panel kaydırıcısı yalnız canlı kaynakta, üst sınır motorla aynı; varsayılan dosyası değişmedi', () => {
  const panel = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'scene-panels.js'), 'utf8');
  const i = panel.indexOf("miniSlider('Kare Gecikmesi'");
  assert.ok(i > 0);
  assert.ok(panel.slice(i - 300, i).includes("if ((m.source || 'webcam') !== 'file') {"));
  assert.ok(panel.slice(i, i + 300).includes('{ min: 0, max: ' + T.DELAY_MAX + ', def: 0,'));
  assert.ok(!/delay:/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'defaults.js'), 'utf8').split('media: {')[1].split('}')[0]));
});
