'use strict';
/* Uzatılan heceler (#938) ve zamanlama düzenleyicisi (#414).
   Süre ses analizinden değil; yalnız LRC/SRT zaman damgalarından gelir. */
const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/shared/lyrics.js');

test('A2 kelime bitişi: boş <..> etiketi kelimenin sonu olur', () => {
  const r = L.parseLRC('[00:01.00]<00:01.00>Sev <00:01.50>gi<00:03.00> <00:03.20>dolu\n[00:05.00]son');
  const w = r.lines[0].words;
  assert.strictEqual(w.length, 3);
  assert.strictEqual(w[1].text.trim(), 'gi');
  assert.strictEqual(w[1].end, 3);
  assert.strictEqual(w[0].end, 1.5); // bitiş yoksa sonraki kelime
  assert.strictEqual(w[2].end, 5); // son kelime satır sonuna kadar
});

test('yalnız başlangıç damgası: süre = sonraki.start − this.start', () => {
  const r = L.parseLRC('[00:01.00]<00:01.00>love <00:03.00>you\n[00:05.00]x');
  const w = r.lines[0].words;
  assert.strictEqual(w.length, 2);
  assert.ok(Math.abs(w[0].end - 3) < 1e-9);
  assert.ok(Math.abs((w[0].end - w[0].t) - 2) < 1e-9);
  assert.ok(Math.abs(w[1].end - 5) < 1e-9); // son kelime satır sonu
});

test('açık <start> word <end> A2 bitiş etiketi', () => {
  const r = L.parseLRC('[00:00.00]<00:01.00>hold<00:03.50> <00:04.00>next\n[00:06.00]z');
  const w = r.lines[0].words;
  assert.strictEqual(w[0].text.trim(), 'hold');
  assert.ok(Math.abs(w[0].end - 3.5) < 1e-9);
  assert.ok(Math.abs(w[0].t - 1) < 1e-9);
});

test('kelime ilerlemesi 0 / 0.5 / 1 (2 sn kelime)', () => {
  const lyr = L.parseLRC('[00:01.00]<00:01.00>a <00:03.00>b\n[00:05.00]c');
  const w0 = lyr.lines[0].words[0];
  assert.ok(Math.abs((w0.end - w0.t) - 2) < 1e-9);
  assert.strictEqual(L.at(lyr, 1).wordProgress, 0);
  const mid = L.at(lyr, 2);
  assert.strictEqual(mid.wordIndex, 0);
  assert.ok(mid.wordProgress > 0.45 && mid.wordProgress < 0.55, String(mid.wordProgress));
  // t==3 tam sonraki kelimenin başı; bitişe bir an kala progress ≈ 1
  const nearEnd = L.at(lyr, 2.999);
  assert.strictEqual(nearEnd.wordIndex, 0);
  assert.ok(nearEnd.wordProgress >= 0.99, String(nearEnd.wordProgress));
});

test('son kelime satır bitişini kullanır', () => {
  const lyr = L.parseLRC('[00:01.00]<00:01.00>one <00:02.00>two\n[00:06.00]next');
  const w = lyr.lines[0].words;
  assert.strictEqual(w[1].end, 6);
  const at = L.at(lyr, 4);
  assert.strictEqual(at.wordIndex, 1);
  assert.ok(at.wordProgress > 0.45 && at.wordProgress < 0.55, String(at.wordProgress));
});

test('kısa kelimede vurgu hâlâ çalışır (regresyon)', () => {
  const lyr = L.parseLRC('[00:01.00]<00:01.00>hi <00:01.20>there\n[00:02.00]x');
  const early = L.at(lyr, 1.05);
  assert.strictEqual(early.wordIndex, 0);
  assert.ok(early.wordProgress > 0 && early.wordProgress < 1);
  const next = L.at(lyr, 1.5);
  assert.strictEqual(next.wordIndex, 1);
  assert.ok(L.stretchHeldVowel('hi', 0.2, 1, { minDuration: 0.6 }) === 'hi');
});

test('stretchHeldVowel: love uzun sürede loooove olur', () => {
  const out = L.stretchHeldVowel('love', 2.0, 1, { minDuration: 0.6, amount: 0.25 });
  assert.match(out, /^lo{3,}ve$/);
  assert.ok(out.length > 'love'.length);
  assert.strictEqual(L.stretchHeldVowel('love', 2.0, 0, { minDuration: 0.6 }), 'love');
  assert.strictEqual(L.stretchHeldVowel('love', 0.3, 1, { minDuration: 0.6 }), 'love');
});

test('stretchHeldVowel: Türkçe yar → son sesli uzar', () => {
  const out = L.stretchHeldVowel('yar', 2.5, 1, { minDuration: 0.6, amount: 0.4 });
  assert.match(out, /^ya{2,}r$/);
  const mid = L.stretchHeldVowel('yar', 2.5, 0.4, { minDuration: 0.6, amount: 0.4 });
  assert.ok(mid.length >= 'yar'.length);
  assert.ok(mid.length <= out.length);
});

test('stretchHeldVowel: noktalama ve büyük harf korunur', () => {
  assert.match(L.stretchHeldVowel('LOVE!', 2, 1, { minDuration: 0.6 }), /^LO{3,}VE!$/);
  assert.strictEqual(L.stretchHeldVowel('hmm', 2, 1, { minDuration: 0.6 }), 'hmm');
});

test('eski LRC ayrıştırması değişmedi', () => {
  const r = L.parseLRC('[00:01.00]bir\n[00:02.50]iki');
  assert.deepStrictEqual(r.lines.map((l) => [l.start, l.text]), [[1, 'bir'], [2.5, 'iki']]);
  const k = L.parseLRC('[00:01.00]<00:01.00>a <00:02.00>b');
  assert.deepStrictEqual(k.lines[0].words.map((x) => [x.t, x.text]), [[1, 'a '], [2, 'b']]);
});

test('nudgeText seçili satırları kaydırır', () => {
  const t = '[00:01.00]a <00:01.50>b\n[00:02.00]c';
  assert.strictEqual(L.nudgeText(t, 0, 0, 0.25), '[00:01.25]a <00:01.75>b\n[00:02.00]c');
  assert.strictEqual(L.nudgeText(t, 0, null, -5), '[00:00.00]a <00:00.00>b\n[00:00.00]c');
});

test('stampAt imleçe zaman basar', () => {
  const r = L.stampAt('ab', 1, 62.5);
  assert.strictEqual(r.text, 'a<01:02.50>b');
  assert.strictEqual(r.caret, 1 + '<01:02.50>'.length);
});

test('görselleştirici ve dışa aktarıcı stretchHeldVowel kullanır', () => {
  const fs = require('fs');
  const path = require('path');
  const textJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'text.js'), 'utf8');
  assert.match(textJs, /stretchHeldVowel/);
  assert.match(textJs, /karaokeHold === true/);
  assert.match(textJs, /karaokeFill !== 'word'/);
  const defaults = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'defaults.js'), 'utf8');
  assert.match(defaults, /karaokeFill:\s*'progressive'/);
  assert.match(defaults, /karaokeHold:\s*false/);
});
