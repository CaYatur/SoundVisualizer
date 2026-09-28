'use strict';
/* #580: ifade değişkenlerinin KAPSAMI — MilkDrop 2'nin sanal makineleri.

   ns-eel2'de reg00..reg99 süreç genelinde tek dizi (nseel-eval.c
   nseel_globalregs); per_frame, per_pixel, dalgalar, şekiller ve iki preset
   aynı gözleri görüyor. Uyum kapalıyken her havuzun kendi reg'leri. */
const test = require('node:test');
const assert = require('node:assert');
const MD = require('../src/shared/milkdrop.js');

const IN = { time: 1, frame: 1, fps: 60, bass: 1, mid: 1, treb: 1, bass_att: 1, mid_att: 1, treb_att: 1 };
const mk = (body, acc) => new MD.Preset(body, { seed: 1, accurate: acc !== false });

test('reg: per_frame yazıyor, şekil ve dalga okuyor — yalnız uyum açıkken', () => {
  const body = [
    'per_frame_1=reg07 = 0.25;',
    'shapecode_0_enabled=1',
    'shape_0_per_frame1=x = reg07;',
    'wavecode_0_enabled=1',
    'wave_0_per_frame1=r = reg07;',
  ].join('\n');
  MD.resetGlobals();
  const p = mk(body);
  p.frame(IN);
  assert.strictEqual(p.shapeFrame(p.shapes[0], 0).x, 0.25, 'şekil ortak reg\'i görüyor');
  p.waveFrame(p.waves[0]);
  assert.strictEqual(p.waves[0].pool.get('r'), 0.25, 'dalga ortak reg\'i görüyor');
  MD.resetGlobals();
  const old = mk(body, false);
  old.frame(IN);
  assert.strictEqual(old.shapeFrame(old.shapes[0], 0).x, 0, 'uyum kapalı: şeklin kendi reg07\'si 0');
  assert.strictEqual(old.get('reg07'), 0.25, 'uyum kapalı: ana havuzda duruyor');
});

test('reg: iki preset aynı gözleri paylaşıyor; ad büyük/küçük harfe bakmıyor', () => {
  MD.resetGlobals();
  const a = mk('per_frame_1=REG42 = 3;');
  const b = mk('per_frame_1=monitor = reg42;');
  a.frame(IN);
  b.frame(IN);
  assert.strictEqual(b.get('monitor'), 3, 'b, a\'nın yazdığını okudu');
  assert.strictEqual(b.get('reg42'), 3, 'Preset.get ortak diziden okuyor');
  b.set('reg42', 5);
  assert.strictEqual(a.get('reg42'), 5, 'Preset.set ortak diziye yazıyor');
  MD.resetGlobals();
  assert.strictEqual(a.get('reg42'), 0, 'resetGlobals reg\'leri siliyor');
});

test('reg: yalnız "reg" + iki rakam; üç rakam ya da tek rakam sıradan değişken', () => {
  MD.resetGlobals();
  const a = mk('per_frame_1=reg1 = 1; reg100 = 2; regab = 3; reg99 = 4;');
  const b = mk('per_frame_1=monitor = reg1 + reg100 + regab + reg99;');
  a.frame(IN);
  b.frame(IN);
  assert.strictEqual(b.get('monitor'), 4, 'yalnız reg99 ortak');
  assert.strictEqual(a.get('reg100'), 2, 'reg100 presetin kendi değişkeni');
});

test('reg: anahtar koşarken çevrilince aynı karede kaynak değişiyor', () => {
  MD.resetGlobals();
  const p = mk('per_frame_1=reg03 = reg03 + 1;');
  p.frame(IN); p.frame(IN);
  assert.strictEqual(p.get('reg03'), 2);
  p.accurate = false;
  p.frame(IN);
  assert.strictEqual(p.get('reg03'), 1, 'kapalıyken havuzun kendi reg03\'ü (0) üzerinden');
  p.accurate = true;
  assert.strictEqual(p.get('reg03'), 2, 'açılınca ortak dizi yerinde duruyor');
});

test('resetGlobals gmegabuf\'u da siliyor', () => {
  MD.resetGlobals();
  const a = mk('per_frame_1=gmegabuf(12) = 7;');
  const b = mk('per_frame_1=monitor = gmegabuf(12);');
  a.frame(IN);
  b.frame(IN);
  assert.strictEqual(b.get('monitor'), 7);
  MD.resetGlobals();
  b.frame(IN);
  assert.strictEqual(b.get('monitor'), 0);
});
