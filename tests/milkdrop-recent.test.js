/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* MilkDrop kitaplığında son kullanılana göre sıralama (#445). Varsayılan sıra değişmez,
   eski ayarda `used` alanı yokken her şey eskisi gibi çalışır. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../src/shared/milkdrop-recent.js');

const list = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }];
const ids = (l) => l.map((p) => p.id).join('');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('varsayılan sıra ve used alanı olmayan eski ayar: liste olduğu gibi', () => {
  assert.strictEqual(ids(R.sortList(list, 'list', { used: { d: 5 } })), 'abcd');
  assert.strictEqual(ids(R.sortList(list, undefined, {})), 'abcd');
  assert.strictEqual(ids(R.sortList(list, 'recent', {})), 'abcd');
  assert.strictEqual(ids(R.sortList(list, 'recent', null)), 'abcd');
  assert.deepStrictEqual(R.usedOf({}), {});
  assert.deepStrictEqual(R.usedOf({ used: [1, 2] }), {});
});

test('son kullanılan: en yeni önde, hiç kullanılmamışlar kendi sıralarıyla ardından', () => {
  const lib = { used: { c: 300, a: 100, d: 200 } };
  assert.strictEqual(ids(R.sortList(list, 'recent', lib)), 'cdab');
  assert.strictEqual(ids(list), 'abcd'); // liste değiştirilmiyor
});

test('seçim zamanı yazılıyor, aynı preset yeniden seçilince öne geçiyor', () => {
  const lib = {};
  lib.used = R.withUsed(lib, 'b', 1000);
  lib.used = R.withUsed(lib, 'c', 2000);
  assert.strictEqual(ids(R.sortList(list, 'recent', lib)), 'cbad');
  lib.used = R.withUsed(lib, 'b', 3000);
  assert.strictEqual(ids(R.sortList(list, 'recent', lib)), 'bcad');
  assert.deepStrictEqual(R.withUsed(lib, '', 4000), lib.used); // kimliksiz seçim bir şey yazmıyor
});

test('en çok MAX_USED kayıt, en yeniler kalıyor; silinen presetin kaydı gidiyor', () => {
  const lib = {};
  for (let i = 0; i < R.MAX_USED + 25; i++) lib.used = R.withUsed(lib, 'p' + i, 1000 + i);
  assert.strictEqual(Object.keys(lib.used).length, R.MAX_USED);
  assert.ok(!('p0' in lib.used) && ('p' + (R.MAX_USED + 24)) in lib.used);
  assert.deepStrictEqual(R.without({ used: { a: 1, b: 2 } }, 'a'), { b: 2 });
});

test('panel: varsayılan sıra liste, yalnız kitaplıktan elle seçim yazılıyor', () => {
  const src = read('src/admin/milkdrop-panel.js');
  assert.ok(src.includes("let sortSel = 'list';"));
  const pick = src.slice(src.indexOf('const pick = (p) => {'), src.indexOf('const makeItem'));
  assert.ok(pick.includes('RC().withUsed(lib, p.id, Date.now())'));
  assert.strictEqual((src.match(/withUsed\(/g) || []).length, 1); // otomatik geçiş yazmıyor
});

test('yalnız panel yüklüyor: motor sayfaları ve mod resmi anahtarları etkilenmiyor', () => {
  assert.ok(read('src/admin/index.html').includes('../shared/milkdrop-recent.js'));
  for (const p of ['src/thumbs/modes.html', 'src/visualizer/index.html', 'src/exporter/index.html']) {
    assert.ok(!read(p).includes('milkdrop-recent'), p);
  }
});
