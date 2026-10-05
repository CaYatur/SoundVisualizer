'use strict';
/* v3.1.5 öncesi inceleme turunda bulunan küçük hatalar (#695). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

/* Dil değiştirilince panel yeniden yükleniyor ama ekran listesini dili ana
   sürece bildirmeden önce istiyordu: Türkçeye dönünce ekran adları
   "Display 1 (Primary)" kalıyordu. */
test('panel arayüz dilini ekran listesini istemeden önce bildiriyor', () => {
  const A = read('src/admin/admin.js');
  const init = A.indexOf('async function init()');
  const lang = A.indexOf('window.api.setUiLanguage(window.SVI18n.locale)', init);
  const disp = A.indexOf('displays = await window.api.getDisplays();', init);
  assert.ok(init > 0 && lang > init && disp > lang, 'dil, ekran listesinden önce');
  assert.strictEqual(A.split('window.api.setUiLanguage(').length - 1, 1, 'tek bildirim');
});

/* Söz takibi açıkken eşleme her karede, her metin katmanında ve her
   ekranda bütün kitaplığı normalize ediyordu. */
test('söz eşleme aynı kitaplık ve parça için önceki sonucu veriyor', () => {
  const sync = require('../src/shared/lyrics-sync.js');
  const items = [
    { id: 'a', title: 'Hit The Ground', artist: 'Stay High' },
    { id: 'b', title: 'Gone For Good', artist: 'Rival' },
  ];
  const q = { title: 'Gone For Good', artist: 'Rival' };
  const first = sync.matchTrack(q, items, 'exact');
  assert.strictEqual(first.item.id, 'b');
  assert.strictEqual(sync.matchTrack(q, items, 'exact'), first, 'aynı nesne dönmeli');
  // Kitaplık değişince (yeni dizi) yeniden hesaplanır
  const next = items.slice(0, 1);
  assert.strictEqual(sync.matchTrack(q, next, 'exact'), null);
  // Parça değişince yeniden hesaplanır
  assert.strictEqual(sync.matchTrack({ title: 'Hit The Ground', artist: 'Stay High' }, items, 'exact').item.id, 'a');
  // Kip değişince yeniden hesaplanır
  const soft = sync.matchTrack({ title: 'Gone For Good (Official Video)', artist: 'Rival' }, items, 'partial');
  assert.strictEqual(soft.item.id, 'b');
  assert.strictEqual(sync.matchTrack({ title: 'Gone For Good (Official Video)', artist: 'Rival' }, items, 'exact'), null);
});
