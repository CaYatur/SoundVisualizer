'use strict';
/* Uzatılan heceler (#938) ve zamanlama düzenleyicisi (#414). */
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

test('kelime ilerlemesi 0..1', () => {
  const lyr = L.parseLRC('[00:01.00]<00:01.00>a <00:02.00>b<00:04.00>\n[00:06.00]c');
  const at = L.at(lyr, 3);
  assert.ok(at.wordProgress > 0.45 && at.wordProgress < 0.55, String(at.wordProgress));
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
