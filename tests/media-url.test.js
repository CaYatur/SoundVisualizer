'use strict';
/* Medya adresi biçimi.

   Bu testlerin varlık sebebi somut bir hata: yol URL'in host kısmına
   yazılıyordu ve Windows yollarındaki iki nokta ile ters bölü yüzünden adres
   ayrıştırılamıyordu. İstek özel protokol işleyicisine hiç ulaşmıyor, video
   sessizce hiç oynamıyordu. Aşağıdaki testler biçimin bir daha host'a
   kaymamasını güvence altına alıyor. */
const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/shared/media-url.js');

const WIN = 'D:\\Videolar\\Klip 01.mp4';
const NIX = '/home/cagan/Videolar/Klip 01.mp4';

test('adres sabit bir host kullanır, yol host kısmına yazılmaz', () => {
  const u = M.toMediaUrl(WIN);
  assert.ok(u.startsWith('sv-media://local/'), u);
  // Host ile yol arasındaki tek bölü işaretinden sonrası tamamen kodlanmış
  const rest = u.slice('sv-media://local/'.length);
  assert.ok(!rest.includes('/'), 'yol kısmı tek parça olmalı: ' + rest);
  assert.ok(!rest.includes(':'), 'kodlanmamış iki nokta kalmamalı');
});

test('gidiş-dönüş: kodlanan yol aynen geri gelir', () => {
  for (const p of [WIN, NIX, 'C:\\a b\\ç ğ ü #1 %20.mp4', '/tmp/ünlü şarkı.webm']) {
    assert.strictEqual(M.fromMediaUrl(M.toMediaUrl(p)), p);
  }
});

test('boş girdi boş adres üretir', () => {
  assert.strictEqual(M.toMediaUrl(''), '');
  assert.strictEqual(M.toMediaUrl(null), '');
  assert.strictEqual(M.fromMediaUrl(''), '');
  assert.strictEqual(M.fromMediaUrl(null), '');
});

test('düz yol verilirse olduğu gibi döner', () => {
  assert.strictEqual(M.fromMediaUrl(WIN), WIN);
  assert.strictEqual(M.fromMediaUrl(NIX), NIX);
});

test('v3.0.0 öncesi biçim (yol host kısmında) yine de okunabilir', () => {
  // Bu adres tarayıcıda hiç çalışmıyordu, ama kayıtlı ayarlarda durabilir
  const eski = 'sv-media://' + encodeURIComponent(WIN);
  assert.strictEqual(M.fromMediaUrl(eski), WIN);
});

test('sorgu ve parça eki yolu bozmaz', () => {
  const u = M.toMediaUrl(WIN) + '?t=12#x';
  assert.strictEqual(M.fromMediaUrl(u), WIN);
});

test('bozuk yüzde kodlaması istisna fırlatmaz', () => {
  assert.strictEqual(M.fromMediaUrl('sv-media://local/%E0%A4%A'), '');
});

test('samePath Windows disk harfinde büyük/küçük harf ayırmaz', () => {
  const ayni = process.platform === 'win32';
  assert.strictEqual(M.samePath('D:\\a\\b.mp4', 'd:\\a\\b.mp4'), ayni);
  assert.strictEqual(M.samePath('D:\\a\\b.mp4', 'D:\\a\\b.mp4'), true);
  assert.strictEqual(M.samePath('D:\\a\\b.mp4', 'D:\\a\\c.mp4'), false);
  assert.strictEqual(M.samePath('', 'D:\\a\\b.mp4'), false);
});
