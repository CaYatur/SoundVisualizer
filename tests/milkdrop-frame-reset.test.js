'use strict';
/* KARE BAŞINA SIFIRLAMA (LoadPerFrameEvallibVars).
 *
 * MilkDrop per_frame'i koşturmadan ÖNCE bütün yerleşik kare
 * değişkenlerini preset dosyasından yeniden yüklüyor ve q1..q32'yi
 * per_frame_init'in bıraktığı değere geri alıyor. Yani per_frame'in
 * `zoom`a ya da `q1`e yazdığı şey o karenin sonunda atılıyor.
 *
 * Motorda havuz kalıcıydı: `q1 = q1 + 1` yazan bir preset MilkDrop'ta her
 * karede aynı sonucu verirken bizde sınırsız büyüyordu. Korpusta 2.015
 * preset (%19,5) tam olarak bu biçimde bir birikme yazıyor; kalıcı depo
 * olarak tasarlanmış `reg00..reg99` ise yalnızca 193'ünde (%1,9) geçiyor
 * — yani birikmeyi q ile yazan preset, MilkDrop'un onu sıfırladığını
 * varsayarak yazmış.
 *
 * Preset YAZARININ kendi değişkenleri listede yok ve sıfırlanmıyor;
 * MilkDrop'ta da kareler arası kalıcılar.
 */
const test = require('node:test');
const assert = require('node:assert');
global.window = global.window || {};
const MD = require('../src/shared/milkdrop.js');

const mk = (body) => new MD.Preset(body, { seed: 1 });
const run = (p, n) => { for (let i = 0; i < n; i++) p.frame({ time: i, frame: i }); return p; };

test('yerleşik ad: per_frame yazsa da her kare dosyadaki değerden başlıyor', () => {
  const p = mk('zoom=2\nper_frame_1=zoom = zoom * 2;');
  run(p, 1);
  assert.strictEqual(p.get('zoom'), 4, 'ilk kare: 2 * 2');
  run(p, 1);
  assert.strictEqual(p.get('zoom'), 4, 'ikinci kare de 4 — birikmiyor');
  run(p, 8);
  assert.strictEqual(p.get('zoom'), 4, 'on kare sonra hâlâ 4');
});

test('q1 her karede per_frame_init değerine dönüyor', () => {
  const p = mk('per_frame_init_1=q1 = 5;\nper_frame_1=q1 = q1 + 1;');
  run(p, 1);
  assert.strictEqual(p.get('q1'), 6);
  run(p, 1);
  assert.strictEqual(p.get('q1'), 6, 'q birikmiyor');
  run(p, 20);
  assert.strictEqual(p.get('q1'), 6);
});

test('per_frame_init q yazmadıysa q sıfırdan başlıyor', () => {
  const p = mk('per_frame_1=q3 = q3 + 2;');
  run(p, 5);
  assert.strictEqual(p.get('q3'), 2);
});

test('q32 de sıfırlanıyor — sınır dahil', () => {
  const p = mk('per_frame_init_1=q32 = 1;\nper_frame_1=q32 = q32 * 3;');
  run(p, 4);
  assert.strictEqual(p.get('q32'), 3);
});

test('preset yazarının kendi değişkeni KALICI', () => {
  const p = mk('per_frame_1=atime = atime + 1;');
  run(p, 7);
  assert.strictEqual(p.get('atime'), 7, 'yazarın değişkeni sıfırlanmıyor');
});

test('reg00 kalıcı — MilkDrop\'ta kareler arası depo bu', () => {
  const p = mk('per_frame_1=reg00 = reg00 + 0.5;');
  run(p, 6);
  assert.strictEqual(p.get('reg00'), 3);
});

test('per_frame_init yerleşik ada yazarsa değer atılıyor', () => {
  /* MilkDrop init kodunu koşturduktan sonra pf değişkenlerini yeniden
     yüklüyor: init'in `decay`e yazdığı 0,1 hiçbir zaman görünmüyor. */
  const p = mk('fDecay=0.9\nper_frame_init_1=decay = 0.1;');
  run(p, 3);
  assert.ok(Math.abs(p.get('decay') - 0.9) < 1e-9, 'dosyadaki decay geçerli, init\'inki değil');
});

test('dosya değeri yazılmayan yerleşik adlarda da geri geliyor', () => {
  const p = mk('fWaveScale=1.5\nper_frame_1=wave_a = wave_a * 0.5;');
  run(p, 4);
  assert.strictEqual(p.get('wave_a'), 0.5, 'varsayılan 1 üzerinden, birikmeden');
});

test('sıfırlama listesi MilkDrop\'un kendi listesi kadar', () => {
  /* Liste LoadPerFrameEvallibVars gövdesinden alındı. Sayı sabitleniyor ki
     birinin listeye "işe yarar" diye fazladan ad eklemesi teste takılsın:
     yazar değişkenlerini sıfırlamak presetlerin durumunu bozar. */
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'shared', 'milkdrop.js'), 'utf-8');
  const m = /const PF_RESET = \[([\s\S]*?)\n  \];/.exec(src);
  assert.ok(m, 'PF_RESET bulunmalı');
  const names = [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
  assert.strictEqual(names.length, 59);
  for (const n of ['zoom', 'decay', 'q1'.replace('q1', 'gamma'), 'mv_a', 'b1ed']) {
    assert.ok(names.includes(n), n + ' listede olmalı');
  }
  for (const n of ['monitor', 'time', 'bass', 'atime', 'wave_scale', 'warpscale']) {
    assert.ok(!names.includes(n), n + ' listede OLMAMALI');
  }
});
