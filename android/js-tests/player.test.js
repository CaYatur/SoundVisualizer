/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* UYGULAMA İÇİ ÇALAR, sayfa tarafı (PLAN 2.3).

   Çaların durumu masaüstündeki "şimdi çalıyor" nesnesine çevriliyor
   (src/main/media-session.js): aynı alanlar, konum ve süre saniye. Düzenleyicinin
   istekleri HOST.md'deki adlarla uygulamaya gidiyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function host() {
  const sent = [];
  const native = {
    postMessage(m) {
      sent.push(JSON.parse(m));
      const msg = sent[sent.length - 1];
      if (msg.t === 'req') Promise.resolve().then(() => native.onmessage({ data: JSON.stringify({ t: 'res', id: msg.id, ok: true, v: { has: true } }) }));
    },
  };
  const window = { __SV_ANDROID: { debug: true, page: 'test' }, SVNative: native };
  const ctx = { window, console, performance: { now: () => 0 }, setInterval: () => 0, Promise, JSON, Map, Object, Uint8Array, Array, Error, Date };
  vm.createContext(ctx);
  vm.runInContext(read('src/mobile/android-host.js'), ctx, { filename: 'android-host.js' });
  return { window, sent, event: (ev, v) => native.onmessage({ data: JSON.stringify({ t: 'evt', ev, v }) }) };
}

/* Masaüstündeki "şimdi çalıyor" nesnesinin alanları (EMPTY). */
function desktopKeys() {
  const src = read('src/main/media-session.js');
  const block = /const EMPTY = \{([\s\S]*?)\};/.exec(src)[1];
  return [...block.matchAll(/([a-z]+):/g)].map((m) => m[1]).sort();
}

test('çaların durumu masaüstündeki "şimdi çalıyor" biçiminde motora gidiyor', async () => {
  const h = host();
  const seen = [];
  h.window.api.onNowPlaying((n) => seen.push(n));
  assert.strictEqual(await h.window.api.nowPlayingCurrent(), null, 'şarkı açılmadan bilgi yok');
  h.event('playerState', { has: true, playing: true, state: 'ready', position: 61500, duration: 200250, title: 'Gece', artist: 'CaYaDev', album: 'A', artwork: 'data:image/jpeg;base64,AA==', name: 'gece' });
  assert.strictEqual(seen.length, 1);
  const n = seen[0];
  assert.deepStrictEqual(Object.keys(n).sort(), desktopKeys());
  assert.strictEqual(n.has, true);
  assert.strictEqual(n.playing, true);
  assert.strictEqual(n.title, 'Gece');
  assert.strictEqual(n.position, 61.5);
  assert.strictEqual(n.duration, 200.25);
  assert.strictEqual(n.artwork, 'data:image/jpeg;base64,AA==');
  assert.ok(n.updated > 0, 'konumun ölçüldüğü an');
  assert.strictEqual((await h.window.api.nowPlayingCurrent()).title, 'Gece');
  // Çalar kapandı
  h.event('playerState', { has: false, playing: false, state: 'idle' });
  assert.strictEqual(seen[1].has, false);
  assert.deepStrictEqual(Object.keys(seen[1]).sort(), desktopKeys());
});

test('düzenleyicinin çalar istekleri HOST.md adlarıyla gidiyor', async () => {
  const h = host();
  const P = h.window.SVAndroid.player;
  await P.open('sarki.m4a', true);
  await P.reopen('content://x/1');
  await P.play();
  await P.pause();
  await P.seek(1500);
  await P.stop();
  await P.pick();
  const reqs = h.sent.filter((m) => m.t === 'req').map((m) => [m.op, m.a]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(reqs)), [
    ['playerOpen', { media: 'sarki.m4a', play: true }],
    ['playerOpen', { uri: 'content://x/1', play: false }],
    ['playerPlay', {}], ['playerPause', {}], ['playerSeek', { ms: 1500 }], ['playerStop', {}], ['playerPick', {}],
  ]);
  const md = read('docs/android/HOST.md');
  for (const op of ['playerPick', 'playerOpen', 'playerPlay', 'playerPause', 'playerSeek', 'playerStop', 'playerState']) {
    assert.ok(md.includes('`' + op), 'HOST.md: ' + op);
  }
});

test('durum değişimi düzenleyiciye de gidiyor', () => {
  const h = host();
  const seen = [];
  h.window.SVAndroid.player.onState((s) => seen.push(s.state));
  h.event('playerState', { has: true, playing: false, state: 'buffering' });
  h.event('playerState', { has: true, playing: true, state: 'ready' });
  assert.deepStrictEqual(seen, ['buffering', 'ready']);
  assert.strictEqual(h.window.SVAndroid.player.state().playing, true);
});
