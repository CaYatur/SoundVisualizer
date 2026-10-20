'use strict';
/* Çalan parça kartında büyük harf parçanın diline göre (#536'da bulundu).
   Kart her zaman Türkçe kuralla büyütüyordu: İngilizce "Mind" -> "MİND". */
const test = require('node:test');
const assert = require('node:assert');
const N = require('../src/shared/nowplaying');

test('büyük harf: İngilizce genel kural, Türkçe harfli metin Türkçe kural', () => {
  assert.strictEqual(N.upper('Mind the Gap'), 'MIND THE GAP');
  assert.strictEqual(N.upper('İstanbul\'da gece'), 'İSTANBUL\'DA GECE');
  assert.strictEqual(N.upper('şiir'), 'ŞİİR');
  const parts = N.compose({ has: true, title: 'Mind', artist: 'Sezen Aksu', album: '', app: '' }, { uppercase: true, show: { title: true, artist: true } });
  assert.strictEqual(parts.title, 'MIND');
  assert.strictEqual(parts.artist, 'SEZEN AKSU');
});
