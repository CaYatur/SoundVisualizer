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

/* per_pixel'in kendi sanal makinesi (state.cpp:214 m_pv_eel). Girdiler
   per_frame'den önce, q'lar sonra, zoom..sy düğüm başına per_frame'in
   bıraktığından; kendi değişkenleri ve megabuf'ı kalıcı. */
const IN2 = Object.assign({}, IN, { meshx: 48, meshy: 36, pixelsx: 640, pixelsy: 480, aspectx: 0.75, aspecty: 1 });
const px = (p) => { p.frame(IN2); p.captureBase(); return p.pixel(0.5, 0.5, 0.2, 0.1, {}); };

test('per_pixel kare denklemlerinin değişkenini görmüyor', () => {
  const body = 'per_frame_1=myv = 0.3;\nper_pixel_1=rot = myv;';
  assert.strictEqual(px(mk(body)).rot, 0, 'MilkDrop: kendi makinesinde myv 0');
  assert.strictEqual(px(mk(body, false)).rot, 0.3, 'uyum kapalı: tek havuz');
});

test('per_pixel\'in yazdığı kare denklemlerine ve çizime sızmıyor', () => {
  const body = 'fDecay=0.98\nper_frame_1=monitor = zz;\nper_pixel_1=decay = 0.1; zz = 5; wave_r = 0.2;';
  const p = mk(body);
  px(p); px(p);
  assert.deepStrictEqual([p.get('decay'), p.get('zz'), p.get('monitor')], [0.98, 0, 0]);
  assert.strictEqual(p.get('wave_r') === 0.2, false, 'dalga rengi per_pixel\'den gelmiyor');
  const old = mk(body, false);
  px(old); px(old);
  assert.deepStrictEqual([old.get('zz'), old.get('monitor')], [5, 5], 'uyum kapalı: sızıyor');
});

test('per_pixel\'in kendi değişkenleri düğümler ve kareler boyunca kalıyor', () => {
  const p = mk('per_pixel_1=cnt = cnt + 1; dx = cnt;');
  p.frame(IN2); p.captureBase();
  p.pixel(0, 0, 0, 0, {}); p.pixel(0, 0, 0, 0, {});
  assert.strictEqual(p.pixel(0, 0, 0, 0, {}).dx, 3);
  p.frame(IN2); p.captureBase();
  assert.strictEqual(p.pixel(0, 0, 0, 0, {}).dx, 4, 'kare başında sıfırlanmıyor');
});

test('per_pixel girdileri per_frame\'den ÖNCE alıyor, q\'ları SONRA', () => {
  const body = 'per_frame_1=bass = 5; meshx = 2; q1 = 0.7;\nper_pixel_1=rot = bass; dx = meshx; dy = q1; sx = aspectx; sy = pixelsy;';
  const o = px(mk(body));
  assert.deepStrictEqual([o.rot, o.dx, o.dy, o.sx, o.sy], [1, 48, 0.7, 0.75, 480]);
  const l = px(mk(body, false));
  assert.deepStrictEqual([l.rot, l.dx, l.dy], [5, 2, 0.7], 'uyum kapalı: per_frame\'in değiştirdiği');
});

test('per_pixel\'in q yazması kare denklemlerinin q\'suna dokunmuyor', () => {
  const p = mk('per_frame_1=q2 = q2 + 1;\nper_pixel_1=q2 = 100;');
  px(p); px(p);
  assert.strictEqual(p.get('q2'), 1, 'her kare init sonrası değerden (0) başlıyor, per_pixel\'in 100\'ü görünmüyor');
});

test('megabuf per_pixel\'in kendisinin; gmegabuf ve reg ortak', () => {
  MD.resetGlobals();
  const body = 'per_frame_1=megabuf(3) = 2; gmegabuf(3) = 4; reg10 = 0.4;\nper_pixel_1=rot = megabuf(3); dx = gmegabuf(3); dy = reg10;';
  const o = px(mk(body));
  assert.deepStrictEqual([o.rot, o.dx, o.dy], [0, 4, 0.4]);
  MD.resetGlobals();
  const l = px(mk(body, false));
  assert.deepStrictEqual([l.rot, l.dx, l.dy], [2, 4, 0.4], 'uyum kapalı: tek megabuf, havuzun reg\'i');
});

test('per_pixel zoom..sy\'yi per_frame\'in bıraktığından alıyor; zoom_base yalnız uyum kapalıyken', () => {
  const body = 'per_frame_1=zoom = 1.2; rot = 0.3; zoom_base = 2;\nper_pixel_1=warp = zoom + rot;';
  const o = px(mk(body));
  assert.deepStrictEqual([o.zoom, o.rot], [1.2, 0.3]);
  assert.ok(Math.abs(o.warp - 1.5) < 1e-12);
  assert.strictEqual(px(mk(body, false)).zoom, 2, 'eski kaçamak');
  // per_pixel'in kendisi yazsa da sonraki düğümün zoom'u per_frame'inki
  const q = mk('per_frame_1=zoom = 1.2;\nper_pixel_1=zoom_base = 3;');
  px(q);
  assert.strictEqual(q.pixel(0.5, 0.5, 0.2, 0.1, {}).zoom, 1.2);
});

test('anahtar koşarken çevrilince per_pixel aynı karede havuz değiştiriyor', () => {
  const p = mk('per_frame_1=myv = 0.3;\nper_pixel_1=rot = myv;');
  assert.strictEqual(px(p).rot, 0);
  p.accurate = false;
  p.captureBase();
  assert.strictEqual(p.pixel(0.5, 0.5, 0.2, 0.1, {}).rot, 0.3);
  p.accurate = true;
  assert.strictEqual(p.pixel(0.5, 0.5, 0.2, 0.1, {}).rot, 0);
});
