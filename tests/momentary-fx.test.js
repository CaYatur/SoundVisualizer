/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Anlık efektler (#905): basılı tutulurken zincirin sonunda, ayar zincirini bozmadan. Çizimi
   gerçek uygulamada `npm run ui-walk` deniyor; burada zincirin hesabı. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { LayerStack } = require('../src/visualizer/layers.js');

function stack() {
  const chains = [];
  const s = Object.create(LayerStack.prototype);
  s.postfx = { setChain: (list) => chains.push(list.map((f) => f.type)) };
  return { s, chains };
}
const FX = (type, enabled) => ({ type, enabled: enabled !== false, params: {} });

test('basılıyken zincirin sonuna ekleniyor, bırakınca ayar zinciri kalıyor', () => {
  const { s, chains } = stack();
  s.setPostFX([FX('bloom'), FX('crt', false)]);
  assert.deepStrictEqual(chains.pop(), ['bloom']);
  s.setMomentary([FX('glitch')]);
  assert.deepStrictEqual(chains.pop(), ['bloom', 'glitch']);
  s.setMomentary([]);
  assert.deepStrictEqual(chains.pop(), ['bloom']);
});

test('basılıyken gelen ayar gönderimi efekti düşürmüyor', () => {
  const { s, chains } = stack();
  s.setPostFX([]);
  s.setMomentary([FX('flash')]);
  s.setPostFX([FX('bloom')]);
  assert.deepStrictEqual(chains.pop(), ['bloom', 'flash']);
});

test('zincir boşken de çalışıyor, bırakınca zincir yine boş', () => {
  const { s, chains } = stack();
  s.setPostFX([]);
  assert.deepStrictEqual(chains.pop(), []);
  s.setMomentary([FX('strobe')]);
  assert.deepStrictEqual(chains.pop(), ['strobe']);
  s.setMomentary([]);
  assert.deepStrictEqual(chains.pop(), []);
});

test('panel gidince takılı kalmıyor: tazelenmezse çizim düşürüyor', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'layers.js'), 'utf8');
  const draw = src.slice(src.indexOf('    draw(audio, cfg, t, dt) {'), src.indexOf('    draw(audio, cfg, t, dt) {') + 300);
  assert.match(draw, /this\._fxHold\.length && performance\.now\(\) - this\._fxHoldAt > 3000\) this\.setMomentary\(\[\]\)/);
  const live = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'live-shell.js'), 'utf8');
  assert.match(live, /setInterval\(sendHeld, 1000\)/, 'panel basılıyken saniyede bir tazeliyor');
});

test('ayara ve geçmişe yazılmıyor, her çıkışa gidiyor', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  const live = read('admin/live-shell.js');
  const send = live.slice(live.indexOf('function sendHeld()'), live.indexOf('function holdFx('));
  assert.ok(!/\bpush\(|\.apply\(\)|cfg\(\)\.[a-z]+ =/.test(send), 'gönderim ayara dokunmuyor');
  const main = read('main/main.js');
  const h = main.slice(main.indexOf("ipcMain.on('momentary-fx'"), main.indexOf("ipcMain.on('show-clock'"));
  assert.match(h, /sendToVisualizers\('momentary-fx', held\)/);
  assert.match(h, /broadcast\(\{ type: 'momentary-fx', list: held \}, 'overlay'\)/);
  assert.ok(!/saveSettings|currentConfig/.test(h));
  assert.match(read('visualizer/visualizer.js'), /onMomentaryFx\(\(list\) => \{ if \(stack\) stack\.setMomentary\(list\); \}\)/);
  assert.match(read('web/web-shim.js'), /msg\.type === 'momentary-fx'/);
});

test('flaş sınırlaması açıkken strobe saniyede üçü geçmiyor', () => {
  const live = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'live-shell.js'), 'utf8');
  assert.match(live, /\['strobe', 'Strobe', 'strobe', \{ rate: 3, amount: 1 \}\]/);
  assert.match(live, /flashLimit === false/);
  assert.match(live, /m\[0\] === 'strobe' && free \? Object\.assign\(\{\}, m\[3\], \{ rate: 10 \}\)/);
});
