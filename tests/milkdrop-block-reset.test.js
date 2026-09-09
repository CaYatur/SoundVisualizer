'use strict';
/* DALGA VE ŞEKİL BLOKLARINDA KARE BAŞINA SIFIRLAMA.
 *
 * `q1..q32` için düzelttiğimiz hatanın bir kat aşağıdaki eşi. MilkDrop her
 * karede, bloğun `per_frame` kodunu koşturmadan hemen önce kendi ara
 * değişkenlerini `per_init`in bıraktığı değere geri yazıyor:
 *
 *     for (int vi = 0; vi < NUM_T_VAR; vi++)
 *         *var_pf_t[vi] = m_wave[i].t_values_after_init_code[vi];
 *
 * (milkdropfs.cpp:2331 dalga, 2288 şekil.) Dalgada `samples` de dosyadaki
 * değere dönüyor (2338) ve nokta sayısı per_frame'den SONRA okunuyor (2424).
 *
 * Motor üçünü de taşıyordu. Fark kendi kendine biriken yazımlarda
 * görünüyor: `t3 = t3 + 0,01` MilkDrop'ta her kare aynı yerden başlarken
 * bizde sınırsız büyüyordu. Korpusta 1.805 preset (%17,4) dalga bloğunda,
 * 1.139'u (%11,0) şekil bloğunda t yazıyor; 149'u (%1,4) birikmeli yazıyor,
 * 196'sı (%1,9) `samples` yazıyor.
 */
const test = require('node:test');
const assert = require('node:assert');
global.window = global.window || {};
const MD = require('../src/shared/milkdrop.js');

const INPUTS = {
  time: 1, frame: 1, fps: 30, progress: 0.1,
  bass: 1, mid: 1, treb: 1, bass_att: 1, mid_att: 1, treb_att: 1,
  meshx: 32, meshy: 24, aspectx: 1, aspecty: 1, pixelsx: 320, pixelsy: 240,
};
const preset = (lines) => new MD.Preset(lines.join('\n') + '\n', { seed: 7 });

// -------------------------------------------------------------- dalga t1..t8

test('dalga: t birikmesi her karede per_init değerinden başlıyor', () => {
  const p = preset([
    'wavecode_0_enabled=1',
    'wave_0_init1=t3 = 10;',
    'wave_0_per_frame1=t3 = t3 + 1;',
    'wave_0_per_point1=x = t3;',
  ]);
  for (let f = 0; f < 5; f++) {
    p.frame(INPUTS);
    p.waveFrame(p.waves[0]);
    assert.strictEqual(p.wavePoint(p.waves[0], 0, 0, 0, {}).x, 11,
      (f + 1) + '. karede t3 taşınmış');
  }
});

test('dalga: sekiz t\'nin hepsi sıfırlanıyor', () => {
  const init = [], frame = [];
  for (let i = 1; i <= 8; i++) {
    init.push('wave_0_init' + i + '=t' + i + ' = ' + i + ';');
    frame.push('wave_0_per_frame' + i + '=t' + i + ' = t' + i + ' + 100;');
  }
  const p = preset(['wavecode_0_enabled=1'].concat(init, frame,
    ['wave_0_per_point1=x = t1 + t2 + t3 + t4 + t5 + t6 + t7 + t8;']));
  const bekle = (1 + 2 + 3 + 4 + 5 + 6 + 7 + 8) + 8 * 100;
  for (let f = 0; f < 3; f++) {
    p.frame(INPUTS);
    p.waveFrame(p.waves[0]);
    assert.strictEqual(p.wavePoint(p.waves[0], 0, 0, 0, {}).x, bekle);
  }
});

test('dalga: per_point içindeki t noktalar boyunca BİRİKİYOR', () => {
  /* Sıfırlama kare başına, nokta başına değil. MilkDrop `var_pp_t`yi
     kare başına bir kez `var_pf_t`den tohumluyor (milkdropfs.cpp:2421),
     sonra noktalar boyunca serbest bırakıyor — presetler bununla nokta
     indeksi sayıyor. Nokta başına sıfırlasaydık o presetler düz çizgiye
     dönerdi. */
  const p = preset([
    'wavecode_0_enabled=1',
    'wave_0_init1=t1 = 0;',
    'wave_0_per_point1=t1 = t1 + 1; x = t1;',
  ]);
  p.frame(INPUTS);
  p.waveFrame(p.waves[0]);
  assert.strictEqual(p.wavePoint(p.waves[0], 0, 0, 0, {}).x, 1);
  assert.strictEqual(p.wavePoint(p.waves[0], 0.5, 0, 0, {}).x, 2);
  assert.strictEqual(p.wavePoint(p.waves[0], 1, 0, 0, {}).x, 3);
  // Yeni kare: per_frame sıfırlıyor, sayaç baştan
  p.frame(INPUTS);
  p.waveFrame(p.waves[0]);
  assert.strictEqual(p.wavePoint(p.waves[0], 0, 0, 0, {}).x, 1,
    'yeni karede nokta sayacı sıfırlanmadı');
});

test('dalga: rezerve OLMAYAN değişken taşınmaya devam ediyor', () => {
  /* Yalnızca t1..t8 ve dosya değerleri sıfırlanıyor. MilkDrop\'un eel
     değişken tablosunda gerisi duruyor ve presetler buna güveniyor. */
  const p = preset([
    'wavecode_0_enabled=1',
    'wave_0_init1=birikim = 0;',
    'wave_0_per_frame1=birikim = birikim + 1;',
    'wave_0_per_point1=x = birikim;',
  ]);
  for (let f = 1; f <= 4; f++) {
    p.frame(INPUTS);
    p.waveFrame(p.waves[0]);
    assert.strictEqual(p.wavePoint(p.waves[0], 0, 0, 0, {}).x, f);
  }
});

// -------------------------------------------------------------- dalga samples

test('samples her karede dosya değerinden başlıyor', () => {
  const p = preset([
    'wavecode_0_enabled=1',
    'wavecode_0_samples=64',
    'wave_0_per_frame1=samples = samples - 10;',
  ]);
  for (let f = 0; f < 4; f++) {
    p.frame(INPUTS);
    p.waveFrame(p.waves[0]);
    assert.strictEqual(p.waves[0].frameSamples, 54,
      (f + 1) + '. karede samples taşınmış');
  }
});

test('nokta sayısı per_frame\'den SONRA okunuyor', () => {
  /* Öncesinde okumak presetin yazdığı değeri görmezden gelirdi. */
  const p = preset([
    'wavecode_0_enabled=1',
    'wavecode_0_samples=100',
    'wave_0_per_frame1=samples = 7;',
  ]);
  p.frame(INPUTS);
  p.waveFrame(p.waves[0]);
  assert.strictEqual(p.waves[0].frameSamples, 7);
});

test('samples 512\'de kırpılıyor, alt uçta kırpılmıyor', () => {
  /* MilkDrop `std::min(512, nSamples)` diyor ve alt sınırı çizim aşamasına
     bırakıyor (`nSamples >= 2`, nokta kipinde `>= 1`). Burada 2\'ye
     yuvarlamak "bu kare çizme" diyen bir preseti çizdirirdi. */
  const ust = preset(['wavecode_0_enabled=1', 'wavecode_0_samples=400',
    'wave_0_per_frame1=samples = 9000;']);
  ust.frame(INPUTS); ust.waveFrame(ust.waves[0]);
  assert.strictEqual(ust.waves[0].frameSamples, 512);

  const alt = preset(['wavecode_0_enabled=1', 'wavecode_0_samples=400',
    'wave_0_per_frame1=samples = 1;']);
  alt.frame(INPUTS); alt.waveFrame(alt.waves[0]);
  assert.strictEqual(alt.waves[0].frameSamples, 1);

  const eksi = preset(['wavecode_0_enabled=1', 'wavecode_0_samples=400',
    'wave_0_per_frame1=samples = -5;']);
  eksi.frame(INPUTS); eksi.waveFrame(eksi.waves[0]);
  assert.strictEqual(eksi.waves[0].frameSamples, 0, 'negatif sayı sıfıra inmeli');
});

test('samples yazmayan preset dosya değerini görüyor', () => {
  const p = preset(['wavecode_0_enabled=1', 'wavecode_0_samples=128']);
  p.frame(INPUTS);
  p.waveFrame(p.waves[0]);
  assert.strictEqual(p.waves[0].frameSamples, 128);
});

// -------------------------------------------------------------- şekil t1..t8

test('şekil: t birikmesi her karede per_init değerinden başlıyor', () => {
  const p = preset([
    'shapecode_0_enabled=1',
    'shape_0_init1=t5 = 3;',
    'shape_0_per_frame1=t5 = t5 + 1; rad = t5;',
  ]);
  for (let f = 0; f < 5; f++) {
    p.frame(INPUTS);
    assert.strictEqual(+p.shapeFrame(p.shapes[0], 0, {}).rad, 4,
      (f + 1) + '. karede t5 taşınmış');
  }
});

test('şekil: t ÖRNEK başına sıfırlanıyor, kare başına değil', () => {
  /* MilkDrop yükleyiciyi `instance` parametresiyle her örnek için ayrı
     çağırıyor (milkdropfs.cpp:2150), yani bir örnek bir öncekinin ara
     değerini devralmıyor. Devralsaydı `num_inst` büyüdükçe halkanın son
     örnekleri ekrandan kaçardı. */
  const p = preset([
    'shapecode_0_enabled=1',
    'shapecode_0_num_inst=4',
    'shape_0_init1=t1 = 0;',
    'shape_0_per_frame1=t1 = t1 + 1; rad = t1;',
  ]);
  p.frame(INPUTS);
  for (let inst = 0; inst < 4; inst++) {
    assert.strictEqual(+p.shapeFrame(p.shapes[0], inst, {}).rad, 1,
      inst + '. örnek bir öncekinin t1\'ini devralmış');
  }
});

test('şekil: dosya değerleri de her örnekte geri geliyor', () => {
  /* t ile aynı yükleyicide: MilkDrop x, y, rad, ang, renkler ve kenarlık
     değerlerini de dosyadan geri yazıyor (milkdropfs.cpp:2291-2315). */
  const p = preset([
    'shapecode_0_enabled=1',
    'shapecode_0_rad=0.25',
    'shape_0_per_frame1=rad = rad * 2;',
  ]);
  for (let f = 0; f < 3; f++) {
    p.frame(INPUTS);
    assert.ok(Math.abs(+p.shapeFrame(p.shapes[0], 0, {}).rad - 0.5) < 1e-9,
      (f + 1) + '. karede rad taşınmış');
  }
});
