/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* GÖMÜLÜ SÖZ EŞLİĞİ: src/shared/id3-lyrics.js (Uint8Array, Android'in motor sayfası) ile
   masaüstünün src/main/lyrics-lookup.js'i (Node Buffer) aynı ID3 etiketlerinden aynı sözü
   çıkarmalı. Etiketler burada üretiliyor: v2.3/v2.4, genişletilmiş başlık, USLT'de latin1,
   iki BOM'lu UTF-16, BOM'suz UTF-16BE ve UTF-8, SYLT'de milisaniye (satırlı ve satırsız). */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const desktop = require(path.join(root, 'src', 'main', 'lyrics-lookup.js'));
const shared = require(path.join(root, 'src', 'shared', 'id3-lyrics.js'));

const syncsafe = (n) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
const be32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
function text(s, enc) {
  if (enc === 0) return Buffer.from(s, 'latin1');
  if (enc === 3) return Buffer.from(s, 'utf8');
  if (enc === 1) return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
  // 2: UTF-16BE (BOM'suz); 'be-bom': BOM'lu büyük sonlu
  const le = Buffer.from(s, 'utf16le');
  const out = Buffer.alloc(le.length);
  for (let i = 0; i + 1 < le.length; i += 2) { out[i] = le[i + 1]; out[i + 1] = le[i]; }
  return enc === 'be-bom' ? Buffer.concat([Buffer.from([0xfe, 0xff]), out]) : out;
}
const term = (enc) => (enc === 0 || enc === 3 ? Buffer.from([0]) : Buffer.from([0, 0]));
function frame(id, body, ver) {
  return Buffer.concat([Buffer.from(id, 'latin1'), ver === 4 ? syncsafe(body.length) : be32(body.length), Buffer.from([0, 0]), body]);
}
function uslt(lyrics, enc) {
  const e = enc === 'be-bom' ? 1 : enc;
  return Buffer.concat([Buffer.from([e]), Buffer.from('eng', 'latin1'), text('', enc), term(e), text(lyrics, enc)]);
}
function sylt(items, enc) {
  const parts = [Buffer.from([enc]), Buffer.from('eng', 'latin1'), Buffer.from([2, 1]), text('', enc), term(enc)];
  for (const [t, s] of items) parts.push(text(s, enc), term(enc), be32(t));
  return Buffer.concat(parts);
}
function tag(frames, ver, ext) {
  const body = Buffer.concat(frames);
  const extHead = ext ? (ver === 4 ? Buffer.concat([syncsafe(6), Buffer.from([1, 0])]) : Buffer.concat([be32(6), Buffer.alloc(6)])) : Buffer.alloc(0);
  const all = Buffer.concat([extHead, body]);
  return Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([ver, 0, ext ? 0x40 : 0]), syncsafe(all.length), all, Buffer.from('audio-data')]);
}

const SONG = 'Gece yarısı\nŞarkı söyle — çığlık\nDüş';
const cases = [];
for (const ver of [3, 4]) {
  for (const enc of [0, 1, 2, 3, 'be-bom']) {
    const lyr = enc === 0 ? 'Gece yarisi\nSarki' : SONG;
    cases.push(['USLT v2.' + ver + ' enc ' + enc, tag([frame('TIT2', Buffer.concat([Buffer.from([3]), Buffer.from('Başlık')]), ver), frame('USLT', uslt(lyr, enc), ver)], ver, false)]);
  }
  for (const enc of [0, 1, 3]) {
    cases.push(['SYLT satırlı v2.' + ver + ' enc ' + enc, tag([frame('SYLT', sylt([[1000, 'Bir'], [1500, ' iki\n'], [3250, 'Üç'], [4000, ' dört']].map(([t, s]) => [t, enc === 0 ? s.replace(/Ü/g, 'U') : s]), enc), ver)], ver, ver === 4)]);
    cases.push(['SYLT satırsız v2.' + ver + ' enc ' + enc, tag([frame('SYLT', sylt([[500, 'Bir'], [61500, 'İki'], [125000, 'Üç']].map(([t, s]) => [t, enc === 0 ? s.replace(/[İÜ]/g, 'I') : s]), enc), ver)], ver, ver === 3)]);
  }
  cases.push(['USLT ve SYLT birlikte v2.' + ver, tag([frame('USLT', uslt(SONG, 3), ver), frame('SYLT', sylt([[0, 'A'], [2000, 'B']], 3), ver)], ver, false)]);
}
cases.push(['ID3 değil', Buffer.from('fLaC....')]);
cases.push(['v2.2 (desteklenmez)', Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([2, 0, 0]), syncsafe(4), Buffer.alloc(4)])]);

for (const [name, buf] of cases) {
  test('gömülü söz masaüstüyle aynı: ' + name, () => {
    const a = desktop.parseId3Lyrics(buf);
    const b = shared.parseId3Lyrics(new Uint8Array(buf));
    assert.deepStrictEqual(b, a);
  });
}

test('seçim masaüstündeki findEmbedded kuralıyla: zamanlı söz düzün önünde', () => {
  const buf = tag([frame('USLT', uslt(SONG, 3), 4), frame('SYLT', sylt([[0, 'A'], [2000, 'B']], 3), 4)], 4, false);
  const r = shared.embedded(new Uint8Array(buf), '');
  assert.ok(r && /^\[00:00\.00\]A/.test(r.text));
  assert.strictEqual(shared.embedded(new Uint8Array(tag([frame('USLT', uslt(SONG, 3), 4)], 4, false)), '').text, SONG);
  assert.strictEqual(shared.embedded(new Uint8Array(Buffer.from('nope')), ''), null);
});

test('etiket boyu: uygulama yalnız etiketi okur', () => {
  const buf = tag([frame('USLT', uslt('x', 0), 3)], 3, false);
  assert.strictEqual(shared.tagSize(new Uint8Array(buf.subarray(0, 10))), buf.length - 'audio-data'.length);
  assert.strictEqual(shared.tagSize(new Uint8Array([1, 2, 3])), 0);
});
