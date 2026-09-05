'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { MediaSession, EMPTY, differs, getNativeHelperPath } = require('../src/main/media-session.js');

test('EMPTY oturum varsayılanları doğru tanımlıdır', () => {
  assert.strictEqual(EMPTY.has, false);
  assert.strictEqual(EMPTY.playing, false);
  assert.strictEqual(EMPTY.title, '');
  assert.strictEqual(EMPTY.artist, '');
  assert.strictEqual(EMPTY.album, '');
  assert.strictEqual(EMPTY.app, '');
  assert.strictEqual(EMPTY.position, 0);
  assert.strictEqual(EMPTY.duration, 0);
});

test('differs: has değiştiğinde true döner', () => {
  const a = Object.assign({}, EMPTY, { has: false });
  const b = Object.assign({}, EMPTY, { has: true });
  assert.strictEqual(differs(a, b), true);
});

test('differs: oynatma durumu değiştiğinde true döner', () => {
  const a = Object.assign({}, EMPTY, { has: true, playing: false });
  const b = Object.assign({}, EMPTY, { has: true, playing: true });
  assert.strictEqual(differs(a, b), true);
});

test('differs: başlık veya sanatçı değiştiğinde true döner', () => {
  const a = Object.assign({}, EMPTY, { has: true, title: 'Şarkı A' });
  const b = Object.assign({}, EMPTY, { has: true, title: 'Şarkı B' });
  assert.strictEqual(differs(a, b), true);
});

test('differs: zaman damgası güncellendiğinde true döner', () => {
  const a = Object.assign({}, EMPTY, { has: true, updated: 1000 });
  const b = Object.assign({}, EMPTY, { has: true, updated: 2000 });
  assert.strictEqual(differs(a, b), true);
});

test('differs: özdeş durumlarda false döner', () => {
  const a = Object.assign({}, EMPTY, { has: true, title: 'A', artist: 'B', updated: 500 });
  const b = Object.assign({}, EMPTY, { has: true, title: 'A', artist: 'B', updated: 500 });
  assert.strictEqual(differs(a, b), false);
});

test('getNativeHelperPath: platforma göre uygun değer döner', () => {
  const p = getNativeHelperPath();
  if (process.platform === 'win32') {
    assert.ok(typeof p === 'string' || p === null);
  } else {
    assert.strictEqual(p, null);
  }
});

test('MediaSession: başlangıç durumu ve status beklendiği gibidir', () => {
  const s = new MediaSession();
  assert.strictEqual(s.current().has, false);
  const st = s.status();
  assert.strictEqual(st.platform, process.platform);
  assert.strictEqual(st.supported, process.platform === 'win32');
  assert.strictEqual(st.running, false);
  assert.strictEqual(st.backend, 'none');
});

test('MediaSession._onLine: geçerli oturum JSON verisini doğru ayrıştırır', () => {
  const s = new MediaSession();
  let emitted = null;
  s.subscribe((state) => { emitted = state; });

  const raw = JSON.stringify({
    ok: true,
    has: true,
    app: 'spotify.exe',
    title: 'Test Song',
    artist: 'Test Artist',
    album: 'Test Album',
    position: 45.2,
    duration: 180.0,
    updated: 1700000000000,
    status: 'Playing',
  });

  s._onLine(raw);
  assert.ok(emitted !== null);
  assert.strictEqual(emitted.has, true);
  assert.strictEqual(emitted.playing, true);
  assert.strictEqual(emitted.title, 'Test Song');
  assert.strictEqual(emitted.artist, 'Test Artist');
  assert.strictEqual(emitted.app, 'spotify.exe');
  assert.strictEqual(emitted.position, 45.2);
});

test('MediaSession._onLine: has=false durumunda boş duruma geçer', () => {
  const s = new MediaSession();
  let emitted = null;
  s.subscribe((state) => { emitted = state; });

  s._onLine(JSON.stringify({ ok: true, has: false }));
  assert.strictEqual(s.current().has, false);
});

test('MediaSession._onLine: bozuk JSON satırlarında çökmez', () => {
  const s = new MediaSession();
  assert.doesNotThrow(() => {
    s._onLine('{ bozuk json :');
    s._onLine('');
    s._onLine(JSON.stringify({ ok: false, err: 'hata' }));
  });
});
