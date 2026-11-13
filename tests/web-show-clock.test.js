/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Web çıkışı ve zaman çizelgesi çıpası. "Timeline kullan" açıkken çıkış oynatma
   kafasındaki bileşim; çıpa yalnız ekranlara ve Spout'a gidiyordu, web sayfası
   0. saniyede kalıp orada klip yoksa siyah çiziyordu. Gerçek uygulamada
   ölçüldü: düzeltmeden önce sayfa t=0, panel t=6; sonra ikisi aynı. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

/* web-shim.js sahte bir WebSocket ile: sunucu iletilerini elle veriyoruz. */
function loadShim() {
  const sockets = [];
  class FakeSocket {
    constructor(url) { this.url = url; this.readyState = 0; sockets.push(this); }
    send() {}
    close() {}
  }
  const el = { setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, style: {}, classList: { add() {}, remove() {}, toggle() {} } };
  const win = {};
  const ctx = {
    window: win,
    location: { search: '?transparent=0', pathname: '/', host: '127.0.0.1:1', protocol: 'http:', origin: 'http://127.0.0.1:1', href: 'http://127.0.0.1:1/' },
    document: { documentElement: el, getElementById: () => null, querySelector: () => null, addEventListener() {}, createElement: () => el, body: el, head: el },
    WebSocket: FakeSocket,
    URLSearchParams,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    fetch: () => new Promise(() => {}),
    console,
    Date,
  };
  win.addEventListener = () => {};
  ctx.addEventListener = () => {};
  vm.createContext(ctx);
  Object.assign(win, ctx);
  vm.runInContext(read('web/web-shim.js'), ctx);
  const ws = sockets[0];
  const deliver = (msg) => ws.onmessage({ data: JSON.stringify(msg) });
  return { api: win.api, win, deliver };
}

test('web çıkışı dinleyiciden önce gelen çıpayı alıyor ve saat farkını düzeltiyor', () => {
  const { api, deliver } = loadShim();
  const now = Date.now();
  // Uygulamanın saati sayfanınkinden 5 sn ileride
  deliver({ type: 'hello', serverNow: now + 5000 });
  deliver({ type: 'show-clock', anchor: { playing: true, time: 3, epoch: now + 5000, rate: 1, loop: null } });
  const got = [];
  api.onShowClock((a) => got.push(a));
  assert.strictEqual(got.length, 1, 'sonradan kurulan dinleyici son çıpayı alıyor');
  assert.strictEqual(got[0].time, 3);
  assert.ok(Math.abs(got[0].epoch - now) < 50, 'çıpa sayfanın saatine çevrildi: ' + (got[0].epoch - now));
  deliver({ type: 'show-clock', anchor: null });
  assert.strictEqual(got.length, 2);
  assert.strictEqual(got[1], null, 'çıpanın kalkması da iletiliyor');
});

test('çıpa web çıkışına hem değişince hem bağlanınca gidiyor', () => {
  const main = read('main/main.js');
  const ipc = main.slice(main.indexOf("ipcMain.on('show-clock'"), main.indexOf("ipcMain.handle('visualizer-open-displays'"));
  assert.match(ipc, /sendToVisualizers\('show-clock', showClockAnchor\);\r?\n  broadcastShowClock\(\);/);
  assert.match(main, /function broadcastShowClock\(\) \{\r?\n  if \(streamServer\.overlayCount\(\) > 0\) streamServer\.broadcast\(\{ type: 'show-clock', anchor: showClockAnchor \}, 'overlay'\);/);
  // Yedek makine birincilin çıpasını izlerken kendi web çıkışına da yollar
  const peer = main.slice(main.indexOf("if (msg.type === 'show-clock') {"), main.indexOf("if (msg.type === 'inventory-request')"));
  assert.match(peer, /broadcastShowClock\(\);/);
  assert.match(main, /getShowClock: \(\) => showClockAnchor,/);
  const srv = read('main/stream-server.js');
  assert.match(srv, /client\.kind === 'overlay' && typeof hooks\.getShowClock === 'function'/);
  assert.match(srv, /sendJson\(client, \{ type: 'show-clock', anchor: showClock \}\)/);
});
