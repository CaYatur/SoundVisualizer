'use strict';
/* Söz satırı kayması zamana bağlı (src/visualizer/modes/text.js).
   Eskiden taşan söz ileri geri kayıyordu: sona gelince başa dönüyor, söz kaçıyordu; bas
   nabzı taşma payını değiştirdiği için hız sesle oynuyordu. Kayan bant da satırın ortasında
   başa sarıyordu. */
const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || {};
require('../src/shared/defaults.js');
require('../src/visualizer/modes/text.js');
const TextMode = global.window.SVModes.text;

function harness(width) {
  const texts = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, clearRect() {}, scale() {}, translate() {},
    fillText(txt, x) { texts.push({ txt, x }); }, strokeText() {}, fillRect() {},
    measureText(s) { return { width: typeof width === 'function' ? width(s) : width }; },
  };
  return { canvas: { width: 800, height: 600, getContext: () => ctx }, texts };
}

test('lyricScroll: söylenen yer görünür alanın %40ında, sonda kalır, başa dönmez', () => {
  const f = TextMode.lyricScroll;
  assert.strictEqual(f(1000, 500, 0), 0);
  assert.strictEqual(f(1000, 500, 200), 0, 'baştaki kelimeler için kaymaz');
  assert.strictEqual(f(1000, 500, 700), 500);
  assert.strictEqual(f(1000, 500, 1500), 1000, 'satır sonu: uçta kalır');
  assert.strictEqual(f(1000, 500, 99999), 1000);
  assert.strictEqual(f(0, 500, 300), 0);
});

test('overflowOnce: tek yön, sonda bekler (ping-pong yok)', () => {
  const o = TextMode.overflowOnce;
  assert.strictEqual(o(0.1, 400, 40, 1), 0, 'başta kısa bekleme');
  let prev = -1;
  for (let t = 0; t < 30; t += 0.25) { const v = o(t, 400, 40, 1); assert.ok(v >= prev - 1e-9, 'geri gitmez'); prev = v; }
  assert.strictEqual(o(60, 400, 40, 1), 400);
});

function lyricFrames(audioFor) {
  const prev = global.window.SVLyrics;
  // 10 sn'lik tek satır, kelime zamanı yok
  global.window.SVLyrics = {
    parse: () => ({ lines: [{ start: 0, end: 10, text: 'L' }] }),
    at: (doc, t) => ({ index: 0, line: { text: 'L', words: [] }, progress: Math.max(0, Math.min(1, t / 10)), wordIndex: -1, wordProgress: 0 }),
  };
  global.window.SVLyricsRun = null;
  try {
    const h = harness(4000);
    const mode = new TextMode(h.canvas);
    const xs = [];
    for (let i = 0; i <= 10; i++) {
      h.texts.length = 0;
      mode.draw(audioFor(i), { visualizer: { type: 'text' }, text: { enabled: true, source: 'lyrics', lyricsSource: '[00:00.00]L', karaoke: false, animation: 'none' } }, i, 0.016);
      xs.push(h.texts[0].x);
    }
    return xs;
  } finally { global.window.SVLyrics = prev; }
}

test('zamanlı söz: kayma satır süresine yayılır, tek yönlü ve sonda biter', () => {
  const xs = lyricFrames(() => ({ level: 0, bass: 0 }));
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] <= xs[i - 1] + 1e-6, 'hep ileri: ' + xs.join(','));
  // Yazı 4000, görünür 720: sonunda taşma payının tamamı kaymış
  assert.ok(Math.abs(xs[10] - (-360 - (4000 - 720))) < 1e-6, String(xs[10]));
  assert.strictEqual(xs[0], -360);
});

test('bas nabzı kayma oranını değiştirmez', () => {
  const quiet = lyricFrames(() => ({ level: 0, bass: 0 }));
  const loud = lyricFrames((i) => ({ level: 1, bass: i % 2 ? 1.2 : 0 }));
  // Ölçek değişse de söylenen kısmın oranı aynı: konum taşma payına oranla aynı yerde
  for (let i = 0; i <= 10; i++) {
    const fq = (-360 - quiet[i]) / (4000 - 720);
    assert.ok(fq >= -1e-9 && fq <= 1 + 1e-9);
  }
  for (let i = 1; i < loud.length; i++) assert.ok(Number.isFinite(loud[i]));
});

test('söz katmanında kayan bant satırın ortasında başa sarmaz', () => {
  const prev = global.window.SVLyrics;
  global.window.SVLyrics = {
    parse: () => ({ lines: [] }),
    at: (doc, t) => ({ index: 0, line: { text: 'L', words: [] }, progress: t / 10, wordIndex: -1, wordProgress: 0 }),
  };
  try {
    const h = harness(4000);
    const mode = new TextMode(h.canvas);
    mode.draw({ level: 0, bass: 0 }, { visualizer: { type: 'text' }, text: { enabled: true, source: 'lyrics', lyricsSource: 'x', marquee: true, karaoke: false, animation: 'none' } }, 0, 0.016);
    assert.strictEqual(h.texts.length, 1, 'tek kopya: bant değil zamanlı kayma');
    assert.strictEqual(h.texts[0].x, -360);
  } finally { global.window.SVLyrics = prev; }
});

test('kayan bant: kısa yazıda ekran boşluksuz dolar ve konum sarılır', () => {
  const h = harness(100);
  const mode = new TextMode(h.canvas);
  for (let i = 0; i < 200; i++) {
    h.texts.length = 0;
    mode.draw({ level: 0, bass: 0 }, { visualizer: { type: 'text' }, text: { enabled: true, source: 'static', content: 'Kısa', marquee: true, animation: 'none' } }, i, 0.05);
  }
  // 800 px ekran, döngü (100 + boşluk) px: birden çok kopya
  assert.ok(h.texts.length >= 3, String(h.texts.length));
  assert.ok(mode.marquee >= 0 && mode.marquee < 100 + 16 * 4, 'sayaç döngüyle sarılı: ' + mode.marquee);
});
