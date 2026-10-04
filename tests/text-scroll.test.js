'use strict';
/* Metin katmanı ve çalan parça: sığmayan yazı kutuya kırpılıp kayar.
 *
 * Kaydırma kapalıyken satır olduğu gibi çizilir. Açıkken kutu kırpılır
 * ve hız çarpanı yazıyı daha çabuk yürütür. Kayan yazı açıksa kutu
 * kaydırması devreye girmez. */

const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || {};
require('../src/shared/defaults.js');
const NP = require('../src/shared/nowplaying.js');
global.window.SVNowPlaying = NP;
require('../src/visualizer/modes/text.js');
require('../src/visualizer/modes/nowplaying.js');

const TextMode = global.window.SVModes.text;
const NowMode = global.window.SVModes.nowplaying;

function ctxOf(widthOf) {
  const calls = { clip: 0, texts: [], moves: [] };
  const ctx = {
    save() {}, restore() {}, beginPath() {}, rect() {},
    clip() { calls.clip += 1; },
    clearRect() {}, scale() {},
    fillText(txt, x) { calls.texts.push({ txt, x, fill: ctx.fillStyle }); },
    strokeText() {},
    translate(x, y) { calls.moves.push(y || 0); },
    measureText() { return { width: widthOf }; },
    fillRect() {},
  };
  const canvas = { width: 800, height: 600, getContext: () => ctx };
  return { canvas, calls };
}

function drawText(widthOf, text, frames, dt, audio) {
  const h = ctxOf(widthOf);
  const mode = new TextMode(h.canvas);
  const heard = audio || { level: 0, bass: 0 };
  for (let i = 0; i < frames; i++) mode.draw(heard, { visualizer: { type: 'text' }, text }, i, dt);
  return h.calls;
}

const LONG = 'Bu satır ekrana sığmayacak kadar uzun bir metin katmanı yazısıdır';

test('yazı ve çalan parça katmanın renk kipini sahne kipinin önünde kullanır', () => {
  const h = ctxOf(20);
  const mode = new TextMode(h.canvas);
  mode.draw({ level: 0, bass: 0 }, {
    visualizer: { type: 'text', colorMode: 'rainbow' },
    text: { enabled: true, source: 'static', content: 'A', color: '#ff0000', colorMode: 'custom' },
  }, 0, 0.016);
  assert.ok(h.calls.texts.some((t) => t.fill === 'rgba(255,0,0,1)'), JSON.stringify(h.calls.texts));

  const shared = ctxOf(20);
  new TextMode(shared.canvas).draw({ level: 0, bass: 0 }, {
    visualizer: { type: 'text', colorMode: 'rainbow' },
    text: { enabled: true, source: 'static', content: 'B', color: '#ff0000' },
  }, 0, 0.016);
  assert.ok(shared.calls.texts.length > 0);
  assert.ok(shared.calls.texts.every((t) => t.fill !== 'rgba(255,0,0,1)'));

  const np = ctxOf(40);
  new NowMode(np.canvas).draw({ level: 0, bass: 0 }, {
    visualizer: { type: 'nowplaying', colorMode: 'rainbow' },
    nowplaying: {
      enabled: true, source: 'manual', color: '#00ff00', colorMode: 'custom',
      manual: { title: 'Parça' },
    },
  }, 0, 0.016);
  assert.ok(np.calls.texts.some((t) => String(t.fill).indexOf('0,255,0') >= 0), JSON.stringify(np.calls.texts));
});

test('metin varsayılanı uzun yazıyı kaydırır', () => {
  const t = global.window.SV.defaultConfig().text;
  assert.strictEqual(t.scrollOverflow, true);
  assert.strictEqual(t.scrollSpeed, 1);
  assert.strictEqual(t.maxWidth, 0.9);
  const n = global.window.SV.defaultConfig().nowplaying;
  assert.strictEqual(n.scrollLongTitles, true);
  assert.strictEqual(n.scrollSpeed, 1);
});

test('sığan metin kırpılmaz', () => {
  const calls = drawText(50, {
    enabled: true, source: 'static', content: 'Kısa', scrollOverflow: true, maxWidth: 0.9,
  }, 1, 0.016);
  assert.strictEqual(calls.clip, 0);
  assert.deepStrictEqual(calls.texts.map((t) => t.txt), ['Kısa']);
});

test('sığmayan metin kutuya kırpılır ve soldan başlar', () => {
  const calls = drawText(4000, {
    enabled: true, source: 'static', content: LONG, scrollOverflow: true, maxWidth: 0.9, align: 'center',
  }, 1, 0.016);
  assert.ok(calls.clip >= 1);
  assert.strictEqual(calls.texts[0].txt, LONG);
  assert.strictEqual(calls.texts[0].x, -360);
});

test('kaydırma kapalıyken uzun metin ekrana kırpılır ama kaymaz', () => {
  const once = drawText(4000, {
    enabled: true, source: 'static', content: LONG, scrollOverflow: false, maxWidth: 0.9, align: 'center',
  }, 1, 0.016);
  const later = drawText(4000, {
    enabled: true, source: 'static', content: LONG, scrollOverflow: false, maxWidth: 0.9, align: 'center',
  }, 40, 0.05);
  assert.ok(once.clip >= 1);
  assert.strictEqual(once.texts[0].txt, LONG);
  const last = (calls) => calls.texts[calls.texts.length - 1].x;
  assert.strictEqual(last(later), last(once));
});

test('sola yaslı yazı en fazla genişliğe sığsa da ekrandan taşıyorsa kayar', () => {
  const calls = drawText(700, {
    enabled: true, source: 'static', content: LONG, scrollOverflow: true,
    maxWidth: 0.9, align: 'left', x: 0.2,
  }, 1, 0.016);
  assert.ok(calls.clip >= 1, 'ekrandan taşan yazı kırpılmalı');
  assert.strictEqual(calls.texts[0].txt, LONG);
  assert.strictEqual(calls.texts[0].x, 0);
});

test('nabızla büyüyen yazı ölçü sığsa da ekranda taşıyorsa kayar', () => {
  const calls = drawText(400, {
    enabled: true, source: 'static', content: LONG, scrollOverflow: true,
    maxWidth: 0.9, align: 'center', audioScale: 1, animation: 'none',
  }, 1, 0.016, { level: 0, bass: 1 });
  assert.ok(calls.clip >= 1);
});

test('sınırdaki kısa taşma bir anda sona gitmez', () => {
  const spec = {
    enabled: true, source: 'static', content: LONG, scrollOverflow: true,
    maxWidth: 0.9, align: 'center', animation: 'none',
  };
  const early = drawText(760, spec, 3, 0.05);
  const mid = drawText(760, spec, 12, 0.05);
  const x0 = early.texts[0].x;
  assert.strictEqual(early.texts[early.texts.length - 1].x, x0, 'bekleme sırasında yerinde kalır');
  const moved = x0 - mid.texts[mid.texts.length - 1].x;
  assert.ok(moved > 0 && moved < 25, 'kısa taşma yavaş ilerler: ' + moved);
});

test('üst hiza yazıyı çapanın altına indirir', () => {
  const spec = { enabled: true, source: 'static', content: 'A', y: 0, animation: 'none' };
  const mid = drawText(40, Object.assign({ vAlign: 'middle' }, spec), 1, 0.016);
  const top = drawText(40, Object.assign({ vAlign: 'top' }, spec), 1, 0.016);
  const sum = (c) => c.moves.reduce((s, y) => s + y, 0);
  assert.ok(sum(top) > sum(mid) + 10, 'üst hiza ' + sum(top) + ' orta ' + sum(mid));
});

test('kaydırma hızı yazıyı daha çabuk yürütür', () => {
  const base = {
    enabled: true, source: 'static', content: LONG, scrollOverflow: true, maxWidth: 0.9, align: 'center',
  };
  const slow = drawText(4000, Object.assign({}, base, { scrollSpeed: 1 }), 40, 0.05);
  const fast = drawText(4000, Object.assign({}, base, { scrollSpeed: 4 }), 40, 0.05);
  const travel = (calls) => calls.texts[0].x - calls.texts[calls.texts.length - 1].x;
  assert.strictEqual(slow.texts[0].x, -360, 'yavaş tempoda ilk kare hâlâ başta');
  assert.ok(travel(slow) > 50, 'uzun yazı 1× tempoda da yol alır');
  assert.ok(travel(fast) > travel(slow) * 3, '4× uzun yazıda en az üç kat yol alır');
});

test('birden fazla satırın her biri ayrı kayar', () => {
  const calls = drawText(4000, {
    enabled: true, source: 'static', content: 'BIRINCI SATIR\nIKINCI SATIR',
    scrollOverflow: true, maxWidth: 0.9,
  }, 1, 0.016);
  assert.ok(calls.clip >= 2);
  assert.deepStrictEqual(calls.texts.map((t) => t.txt), ['BIRINCI SATIR', 'IKINCI SATIR']);
});

test('vurgu rengi söylenen kelimeyi boyar ve taşan satırda da kalır', () => {
  const prev = global.window.SVLyrics;
  global.window.SVLyrics = {
    parse() { return { lines: [{ text: 'AAAA BBBB' }] }; },
    at() {
      return {
        index: 0,
        progress: 1,
        wordIndex: 0,
        line: { text: 'AAAA BBBB', words: [{ text: 'AAAA ' }, { text: 'BBBB' }] },
      };
    },
  };
  try {
    const text = {
      enabled: true, source: 'lyrics', lyricsSource: '[00:00.00]AAAA BBBB', content: '', karaoke: true,
      color: '#ffffff', colorHighlight: '#00ff00', useCustomColor: true,
      scrollOverflow: true, maxWidth: 0.9, align: 'center', animation: 'none',
    };
    const cfg = { visualizer: { type: 'text', colorMode: 'custom' }, text };
    const shortH = ctxOf(20);
    new TextMode(shortH.canvas).draw({ level: 0, bass: 0 }, cfg, 1, 0.016);
    assert.strictEqual(shortH.calls.clip, 0, 'sığan karaoke kırpılmaz');
    assert.deepStrictEqual(shortH.calls.texts.map((t) => t.fill), [
      'rgba(0,255,0,1)',
      'rgba(255,255,255,0.45)',
    ]);
    const longH = ctxOf(4000);
    new TextMode(longH.canvas).draw({ level: 0, bass: 0 }, cfg, 1, 0.016);
    assert.ok(longH.calls.clip >= 1, 'taşan karaoke kırpılır');
    assert.deepStrictEqual(longH.calls.texts.map((t) => t.txt), ['AAAA ', 'BBBB']);
    assert.ok(longH.calls.texts.some((t) => t.fill === 'rgba(0,255,0,1)'), 'vurgu kaydırırken de boyanır');
  } finally {
    global.window.SVLyrics = prev;
  }
});

test('kayan yazı açıkken kutu kaydırması kullanılmaz', () => {
  const calls = drawText(4000, {
    enabled: true, source: 'static', content: LONG, marquee: true, scrollOverflow: true, maxWidth: 0.9,
  }, 1, 0.016);
  assert.strictEqual(calls.clip, 0);
  assert.strictEqual(calls.texts.length, 2);
});

function drawNow(widthOf, nowplaying, frames) {
  const h = ctxOf(widthOf);
  const mode = new NowMode(h.canvas);
  global.window.SVNowLive = {
    state: {
      has: true, playing: true, title: LONG, artist: 'Sanatci', album: '',
      duration: 10, position: 1, updated: Date.now(), received: Date.now(),
    },
  };
  const audio = { level: 0, bass: 0 };
  const cfg = {
    visualizer: { type: 'nowplaying' },
    nowplaying: Object.assign({
      enabled: true, source: 'system', mode: 'always', show: {
        title: true, artist: false, album: false, appName: false,
        elapsed: false, remaining: false, total: false, bar: false,
      },
    }, nowplaying),
  };
  for (let i = 0; i < frames; i++) mode.draw(audio, cfg, i, 0.05);
  return h.calls;
}

test('çalan parça uzun adı kırpar, kaydırma kapalıyken kırpmaz', () => {
  const on = drawNow(5000, { scrollLongTitles: true, scrollSpeed: 1, maxWidth: 0.8 }, 1);
  assert.ok(on.clip >= 1);
  assert.ok(on.texts.some((t) => t.txt === LONG));
  const off = drawNow(5000, { scrollLongTitles: false, maxWidth: 0.8 }, 1);
  assert.strictEqual(off.clip, 0);
  assert.ok(off.texts.some((t) => t.txt === LONG));
});

test('çalan parça kaydırma hızı yazıyı daha çabuk yürütür', () => {
  const slow = drawNow(5000, { scrollLongTitles: true, scrollSpeed: 1, maxWidth: 0.8 }, 80);
  const fast = drawNow(5000, { scrollLongTitles: true, scrollSpeed: 4, maxWidth: 0.8 }, 80);
  const last = (calls) => calls.texts.filter((t) => t.txt === LONG).pop().x;
  assert.ok(last(fast) < last(slow));
});
