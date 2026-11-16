/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* YAŞAM DÖNGÜSÜ VE SUNUCU OLAYLARI (PLAN 2.1, 2.4; PHASE0 R1/R3).

   Sessizlik algılama tek başına ve sunucunun içinden (gerçek PCM iletileri,
   gerçek ses girişi); pil durumu, bellek baskısı ve WebGL bütçesi. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const S = require('../../src/mobile/silence.js');
const M = require('../../src/mobile/messages.js');

const flat = () => ({ time: new Uint8Array(2048).fill(128) });
function wavy(amp) {
  const t = new Uint8Array(2048);
  for (let i = 0; i < t.length; i++) t[i] = 128 + Math.round(amp * Math.sin(i / 7));
  return { time: t };
}

test('sessizlik: eşikten önce sessiz sayılmıyor, sonra bir kez bildiriliyor', () => {
  const s = S.create({ thresholdMs: 3000 });
  assert.strictEqual(s.push(flat(), 0), null);
  assert.strictEqual(s.push(flat(), 2999), null);
  assert.strictEqual(s.push(flat(), 3000), 'silent');
  assert.strictEqual(s.push(flat(), 5000), null, 'yalnız durum değişince');
  assert.strictEqual(s.push(wavy(20), 5100), 'sound');
  assert.strictEqual(s.push(wavy(20), 5200), null);
});

test('sessizlik: taban gürültüsü (±1) sessiz, kısa bir ses sayacı sıfırlıyor', () => {
  assert.strictEqual(S.quiet(wavy(1).time, S.FLOOR), true);
  assert.strictEqual(S.quiet(wavy(3).time, S.FLOOR), false);
  const s = S.create({ thresholdMs: 1000 });
  s.push(flat(), 0);
  s.push(wavy(10), 900);
  assert.strictEqual(s.push(flat(), 1500), null, 'sayaç sesten sonra baştan');
  assert.strictEqual(s.push(flat(), 2500), 'silent');
  s.reset();
  assert.strictEqual(s.state.silent, false);
  assert.strictEqual(s.push(flat(), 2600), null);
});

/* Sunucu: ortak tayf, ileti biçimi, ses girişi, sessizlik ve window.api (uygulamadaki sıra). */
function host(opts) {
  const o = opts || {};
  const sent = [];
  let clock = 0;
  const native = { postMessage: (m) => sent.push(m) };
  const window = { __SV_ANDROID: { debug: true, page: 'test' }, SVNative: native };
  const canvases = [];
  class FakeCanvas {
    constructor() { this.isConnected = true; this._lost = false; this._l = []; canvases.push(this); }
    getContext(type) { return { isContextLost: () => this._lost, type }; }
    addEventListener(n, f) { if (n === 'webglcontextlost') this._l.push(f); }
    lose() { this._lost = true; this._l.forEach((f) => f()); }
  }
  const ctx = {
    window, console, performance: { now: () => clock }, setInterval: () => 0, setTimeout, clearTimeout,
    Promise, JSON, Map, Object, Uint8Array, Int16Array, Float32Array, ArrayBuffer, DataView, Array, Error, Math, WeakRef, WeakSet,
    HTMLCanvasElement: o.canvas ? FakeCanvas : undefined,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['src/shared/audio-spectrum.js', 'src/mobile/messages.js', 'src/mobile/audio-input.js', 'src/mobile/silence.js', 'src/mobile/android-host.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  return {
    window, sent, canvases, FakeCanvas,
    tick(ms) { clock += ms; },
    event(ev, v) { native.onmessage({ data: JSON.stringify({ t: 'evt', ev, v }) }); },
    pcm(samples) {
      // vm bağlamının ArrayBuffer'ı: sunucu `instanceof ArrayBuffer` ile denetliyor
      const buf = M.pcmS16(0, clock, 48000, 1, 2, samples);
      const own = new ctx.ArrayBuffer(buf.byteLength);
      new Uint8Array(own).set(new Uint8Array(buf));
      native.onmessage({ data: own });
    },
  };
}

test('sunucu: yakalama sessiz kalınca düzenleyiciye bir kez haber veriliyor', () => {
  const h = host();
  const seen = [];
  h.window.SVAndroid.audio.onSilence((v) => seen.push(v.silent));
  h.event('audioStatus', { source: 'capture', state: 'running' });
  const zero = new Int16Array(2048);
  // 4 sn boyunca dijital sessizlik (her 512 örnek bir kare)
  for (let i = 0; i < 400; i++) { h.tick(10.7); h.pcm(zero); }
  assert.deepStrictEqual(seen, [true]);
  assert.strictEqual(h.window.SVAndroid.audio.silent(), true);
  // Ses geri gelince
  const tone = new Int16Array(2048);
  for (let i = 0; i < tone.length; i++) tone[i] = Math.round(8000 * Math.sin(i / 5));
  for (let i = 0; i < 10; i++) { h.tick(10.7); h.pcm(tone); }
  assert.deepStrictEqual(seen, [true, false]);
  // Kaynak değişince sayaç baştan, durum temiz
  for (let i = 0; i < 400; i++) { h.tick(10.7); h.pcm(zero); }
  assert.deepStrictEqual(seen, [true, false, true]);
  h.event('audioStatus', { source: 'visualizer', state: 'running' });
  assert.deepStrictEqual(seen, [true, false, true, false]);
  assert.strictEqual(h.window.__svHost.state.silenceEvents, 2);
});

test('sunucu: pil durumu motorun düşük güç kipine gidiyor', async () => {
  const h = host();
  const seen = [];
  h.window.api.onPowerSource((v) => seen.push(v.onBattery));
  h.event('powerSource', { onBattery: true });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(await h.window.api.getPowerSource())), { onBattery: true });
  h.event('powerSource', { onBattery: false });
  assert.deepStrictEqual(seen, [true, false]);
});

test('sunucu: bellek baskısında bekleyen kayıt yazılıyor ve düzenleyiciye bildiriliyor', () => {
  const h = host();
  const seen = [];
  h.window.SVAndroid.onMemoryPressure((v) => seen.push(v.level));
  h.event('memoryPressure', { level: 15 });
  assert.deepStrictEqual(seen, [15]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(h.window.__svHost.state.memoryPressure)), { level: 15 });
});

test('sunucu: WebGL bütçesi yayın sürümünde de sayılıyor; belgeden çıkan tuval sınıra sayılıyor', () => {
  const h = host({ canvas: true });
  const C = h.FakeCanvas;
  const a = new C(); a.getContext('webgl2');
  const b = new C(); b.getContext('webgl');
  const c = new C(); c.getContext('2d');
  b.isConnected = false; // ekran dışında çizilen katman
  let g = h.window.SVAndroid.gl();
  assert.strictEqual(g.limit, 8);
  assert.strictEqual(g.live, 2);
  assert.strictEqual(g.attached, 1);
  a.lose();
  g = h.window.SVAndroid.gl();
  assert.strictEqual(g.live, 1);
  assert.strictEqual(g.lost, 1);
  assert.strictEqual(g.created, 2);
});
