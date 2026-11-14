/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* DIŞA AKTARIM, sayfa tarafı (MESSAGES.md VIDEO-FRAME, HOST.md "Export surface"). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const M = require('../../src/mobile/messages.js');
const root = path.join(__dirname, '..', '..');

test('VIDEO-FRAME iletisi MESSAGES.md yerleşiminde', () => {
  const w = 4, h = 2;
  const i420 = Uint8Array.from({ length: w * h * 1.5 }, (_, i) => i + 1);
  const buf = M.videoFrame(9, 3.5, 7, 41, w, h, i420);
  const v = new DataView(buf);
  assert.deepStrictEqual({ ...M.readHeader(buf) }, { type: M.TYPE_VIDEO_FRAME, seq: 9, time: 3.5 });
  assert.strictEqual(v.getUint32(16, true), 7);
  assert.strictEqual(v.getUint32(20, true), 41);
  assert.strictEqual(v.getUint16(24, true), w);
  assert.strictEqual(v.getUint16(26, true), h);
  assert.strictEqual(v.getUint8(28), M.FRAME_I420);
  assert.deepStrictEqual(Array.from(new Uint8Array(buf, M.VIDEO_FRAME_HEADER_BYTES)), Array.from(i420));
  // Görünüm (subarray) da doğru baytları taşıyor
  const big = new Uint8Array(100);
  big.set(i420, 10);
  const buf2 = M.videoFrame(0, 0, 1, 0, w, h, big.subarray(10, 10 + i420.length));
  assert.deepStrictEqual(Array.from(new Uint8Array(buf2, M.VIDEO_FRAME_HEADER_BYTES)), Array.from(i420));
});

function loadExportHost() {
  const sent = [];
  const native = { postMessage: (m) => sent.push(m), onmessage: null };
  const window = { __SV_ANDROID: { debug: true, page: 'src/exporter/index.html' }, SVNative: native, SVMessages: M };
  const ctx = { window, console, performance: { now: () => 0 }, Promise, JSON, Map, Object, Uint8Array, Array, Error, String, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/mobile/android-host.js'), 'utf8'), ctx);
  return { window, native, sent };
}

test('dışa aktarım sayfasında window.exp masaüstündeki yüzeyle aynı', () => {
  const pre = fs.readFileSync(path.join(root, 'src/main/preload-exporter.js'), 'utf8');
  const start = pre.indexOf("exposeInMainWorld('exp', {");
  const block = pre.slice(start, pre.indexOf('});', start));
  const keys = [...block.matchAll(/^\s{2}([A-Za-z]+):/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 8, 'masaüstü exp yüzeyi okunamadı');
  const { window } = loadExportHost();
  assert.deepStrictEqual(Object.keys(window.exp).sort(), [...keys].sort());
});

test('iş, onJob kurulmadan gelirse bekletilip teslim ediliyor', () => {
  const { window } = loadExportHost();
  const job = { width: 4, height: 2, fps: 30 };
  window.__svHost.runExport(job);
  let got = null;
  window.exp.onJob((j) => { got = j; });
  assert.strictEqual(got, job);
});

test('kare yollanınca onay gelene kadar bekleniyor; onay geri basıncı çözüyor', async () => {
  const { window, native, sent } = loadExportHost();
  window.exp.onJob(() => {});
  window.__svHost.runExport({ width: 4, height: 2, fps: 30, audioName: 'a.m4a' });
  window.exp.ready(2);
  const begin = JSON.parse(sent[sent.length - 1]);
  assert.strictEqual(begin.op, 'exportBegin');
  assert.strictEqual(begin.a.audio, 'a.m4a');
  native.onmessage({ data: JSON.stringify({ t: 'res', id: begin.id, ok: true, v: { job: 3 } }) });
  let done = false;
  const p = window.exp.sendFrame(new Uint8Array(12), 0).then((r) => { done = true; return r; });
  await new Promise((r) => setTimeout(r, 10));
  const frame = sent.find((m) => m instanceof ArrayBuffer);
  assert.ok(frame, 'kare yollanmadı');
  assert.strictEqual(new DataView(frame).getUint32(16, true), 3);
  assert.strictEqual(done, false, 'onaydan önce çözülmemeli');
  native.onmessage({ data: JSON.stringify({ t: 'evt', ev: 'exportAck', v: { job: 3, index: 0 } }) });
  const r = await p;
  assert.strictEqual(r.cancel, false);
});
