'use strict';
/* Custom dalga ve şekil bloklarının testleri.
 *
 * Referans preset paketinde şekillerin %48'i, dalgaların %32'si kullanılıyor.
 * Ayrıştırıcı bu blokları baştan beri çıkarıyordu ama hiçbir şey onları
 * DERLEMİYORDU: preset hatasız yükleniyor, hatasız koşuyor ve ekranda
 * yarısı eksik görünüyordu. Sessiz kayıp tam olarak bu yüzden test ediliyor —
 * bir kez daha unutulursa gene hiçbir hata vermez. */

const EOL = String.fromCharCode(10);
const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/shared/milkdrop.js');

function preset(lines) {
  return new M.Preset(lines.join(EOL), { seed: 7 });
}

const INPUTS = {
  time: 2, frame: 120, fps: 60, progress: 0.25,
  bass: 1.4, mid: 1.0, treb: 0.8,
  bass_att: 1.2, mid_att: 1.0, treb_att: 0.9,
  vol: 1.1, vol_att: 1.05, meshx: 48, meshy: 36, aspectx: 1.77, aspecty: 1,
};

// ------------------------------------------------------------------ dalgalar

test('custom dalga bloğu derlenir ve parametreleri okunur', () => {
  const p = preset([
    'wavecode_0_enabled=1',
    'wavecode_0_samples=64',
    'wavecode_0_bAdditive=1',
    'wavecode_0_r=0.25',
    'wave_0_per_point1=x = sample; y = 0.5;',
  ]);
  assert.strictEqual(p.waves.length, 1);
  const w = p.waves[0];
  assert.strictEqual(w.enabled, true);
  assert.strictEqual(w.samples, 64);
  assert.strictEqual(w.additive, true);
  assert.strictEqual(w.r, 0.25);
});

/* Preset 0 ve 3'ü tanımlayıp aradakileri atlayabiliyor. Dizideki KONUMU
   numara saymak, 3 numaralı dalgaya 1 numaranın renklerini verirdi. */
test('atlanmış blok numaraları parametrelerle doğru eşleşir', () => {
  const p = preset([
    'wavecode_0_enabled=1',
    'wavecode_0_samples=16',
    'wavecode_3_enabled=1',
    'wavecode_3_samples=128',
    'wave_0_per_point1=x = sample;',
    'wave_3_per_point1=x = sample;',
  ]);
  assert.strictEqual(p.waves.length, 2);
  assert.strictEqual(p.waves[0].index, 0);
  assert.strictEqual(p.waves[0].samples, 16);
  assert.strictEqual(p.waves[1].index, 3);
  assert.strictEqual(p.waves[1].samples, 128);
});

test('kapalı dalga koşturulmaz', () => {
  const p = preset([
    'wavecode_0_enabled=0',
    'wave_0_per_point1=x = 1;',
  ]);
  p.frame(INPUTS);
  assert.strictEqual(p.waveFrame(p.waves[0]), false);
});

test('per_point denklemleri noktanın konumunu belirler', () => {
  const p = preset([
    'wavecode_0_enabled=1',
    'wave_0_per_point1=x = sample*0.5 + 0.25; y = 0.5 + value1*0.25;',
  ]);
  p.frame(INPUTS);
  assert.strictEqual(p.waveFrame(p.waves[0]), true);
  const o = p.wavePoint(p.waves[0], 0.5, 0.4, 0, {});
  assert.ok(Math.abs(o.x - 0.5) < 1e-9, 'x=' + o.x);
  assert.ok(Math.abs(o.y - 0.6) < 1e-9, 'y=' + o.y);
});

test('per_point yazmazsa nokta tanımsız değil, tohumlanmış kalır', () => {
  const p = preset(['wavecode_0_enabled=1']);
  p.frame(INPUTS);
  p.waveFrame(p.waves[0]);
  const o = p.wavePoint(p.waves[0], 0.75, 0, 0, {});
  assert.strictEqual(o.x, 0.75);
  assert.strictEqual(o.y, 0.5);
});

/* Presetler dalgayı q değişkenleri ve sesle sürüyor; taşınmayan bir ad alt
   havuzda sessizce sıfır kalır ve dalga hiç kıpırdamaz. */
test('q değişkenleri ve ses girdileri dalga havuzuna taşınır', () => {
  const p = preset([
    'per_frame_1=q1 = 0.75;',
    'wavecode_0_enabled=1',
    'wave_0_per_point1=x = q1; y = bass_att;',
  ]);
  p.frame(INPUTS);
  p.waveFrame(p.waves[0]);
  const o = p.wavePoint(p.waves[0], 0, 0, 0, {});
  assert.ok(Math.abs(o.x - 0.75) < 1e-9, 'q1 taşınmalı, x=' + o.x);
  assert.ok(Math.abs(o.y - 1.2) < 1e-9, 'bass_att taşınmalı, y=' + o.y);
});

/* Her dalganın kendi t1..t8'i var. Tek havuz kullanmak iki dalganın
   birbirinin ara değişkenini ezmesine yol açardı. */
test('iki dalga birbirinin ara değişkenini ezmez', () => {
  const p = preset([
    'wavecode_0_enabled=1',
    'wavecode_1_enabled=1',
    'wave_0_per_frame1=t1 = 11;',
    'wave_0_per_point1=x = t1;',
    'wave_1_per_frame1=t1 = 22;',
    'wave_1_per_point1=x = t1;',
  ]);
  p.frame(INPUTS);
  p.waveFrame(p.waves[0]);
  p.waveFrame(p.waves[1]);
  // 1 numaralı dalganın karesi koştuktan SONRA 0'ınkini okuyoruz
  const a = p.wavePoint(p.waves[0], 0, 0, 0, {});
  const b = p.wavePoint(p.waves[1], 0, 0, 0, {});
  assert.strictEqual(a.x, 11);
  assert.strictEqual(b.x, 22);
});

test('dalga init bloğu yalnızca bir kez koşar', () => {
  const p = preset([
    'wavecode_0_enabled=1',
    'wave_0_init1=t2 = 5;',
    'wave_0_per_frame1=t2 = t2 + 1;',
    'wave_0_per_point1=x = t2;',
  ]);
  p.frame(INPUTS);
  p.waveFrame(p.waves[0]);
  assert.strictEqual(p.wavePoint(p.waves[0], 0, 0, 0, {}).x, 6);
  p.frame(INPUTS);
  p.waveFrame(p.waves[0]);
  assert.strictEqual(p.wavePoint(p.waves[0], 0, 0, 0, {}).x, 7);
});

// ------------------------------------------------------------------ şekiller

test('custom şekil bloğu derlenir ve parametreleri okunur', () => {
  const p = preset([
    'shapecode_0_enabled=1',
    'shapecode_0_sides=6',
    'shapecode_0_num_inst=4',
    'shapecode_0_rad=0.3',
    'shapecode_0_additive=1',
  ]);
  assert.strictEqual(p.shapes.length, 1);
  const s = p.shapes[0];
  assert.strictEqual(s.sides, 6);
  assert.strictEqual(s.instances, 4);
  assert.strictEqual(s.additive, true);
  assert.strictEqual(s.base.rad, 0.3);
});

test('kenar sayısı MilkDrop sınırlarına kırpılır', () => {
  const p = preset([
    'shapecode_0_enabled=1', 'shapecode_0_sides=2',
    'shapecode_1_enabled=1', 'shapecode_1_sides=5000',
  ]);
  assert.strictEqual(p.shapes[0].sides, 3);
  assert.strictEqual(p.shapes[1].sides, 100);
});

/* MilkDrop şekli num_inst kez koşturuyor ve her koşuda `instance` değişiyor;
   presetler tek blokla bir halka kurmayı böyle yapıyor. */
test('instance değişkeni her örnekte değişir', () => {
  const p = preset([
    'shapecode_0_enabled=1',
    'shapecode_0_num_inst=4',
    'shape_0_per_frame1=x = instance/num_inst;',
  ]);
  p.frame(INPUTS);
  const s = p.shapes[0];
  assert.strictEqual(p.shapeFrame(s, 0, {}).x, 0);
  assert.strictEqual(p.shapeFrame(s, 2, {}).x, 0.5);
  assert.strictEqual(p.shapeFrame(s, 3, {}).x, 0.75);
});

/* Her örnek dosyadaki temel değerlerden BAŞLAMALI: bir önceki örneğin
   bıraktığı x üstüne yazmak şekilleri üst üste kaydırırdı. */
test('her örnek dosyadaki temel değerlerden başlar', () => {
  const p = preset([
    'shapecode_0_enabled=1',
    'shapecode_0_num_inst=3',
    'shapecode_0_x=0.25',
    'shape_0_per_frame1=x = x + 0.1;',
  ]);
  p.frame(INPUTS);
  const s = p.shapes[0];
  assert.ok(Math.abs(p.shapeFrame(s, 0, {}).x - 0.35) < 1e-9);
  assert.ok(Math.abs(p.shapeFrame(s, 1, {}).x - 0.35) < 1e-9);
});

test('şekil per_frame renk ve yarıçapı değiştirebilir', () => {
  const p = preset([
    'shapecode_0_enabled=1',
    'shapecode_0_rad=0.1',
    'shape_0_per_frame1=rad = 0.4; r = 0.2; a2 = 0.6;',
  ]);
  p.frame(INPUTS);
  const o = p.shapeFrame(p.shapes[0], 0, {});
  assert.strictEqual(o.rad, 0.4);
  assert.strictEqual(o.r, 0.2);
  assert.strictEqual(o.a2, 0.6);
});

test('kapalı şekil null döner', () => {
  const p = preset(['shapecode_0_enabled=0']);
  p.frame(INPUTS);
  assert.strictEqual(p.shapeFrame(p.shapes[0], 0, {}), null);
});

test('şekil havuzu q değişkenlerini görür', () => {
  const p = preset([
    'per_frame_1=q3 = 0.6;',
    'shapecode_0_enabled=1',
    'shape_0_per_frame1=x = q3;',
  ]);
  p.frame(INPUTS);
  assert.ok(Math.abs(p.shapeFrame(p.shapes[0], 0, {}).x - 0.6) < 1e-9);
});

// ------------------------------------------------- başlık adı / denklem adı

/* Preset başlığında `fDecay`, denklemlerde `decay` yazıyor; MilkDrop ikisini
   eşliyor. Bu eşleme iki kez unutuldu ve iki kez sessiz ama büyük hataya yol
   açtı: decay bulunamayınca motor kendi varsayılanına düşüp görüntüyü
   biriktiriyordu, bTexWrap bulunamayınca kenardan çıkan içerik geri girmiyor
   ve preset birkaç saniyede bitmiş gibi görünüyordu. */
test('başlıktaki fDecay denklemlerdeki decay olur', () => {
  const p = preset(['fDecay=0.5']);
  assert.strictEqual(p.get('decay'), 0.5);
});

test('başlıktaki bTexWrap denklemlerdeki wrap olur', () => {
  assert.strictEqual(preset(['bTexWrap=0']).get('wrap'), 0);
  assert.strictEqual(preset(['bTexWrap=1']).get('wrap'), 1);
});

// MilkDrop'un varsayılanı sarma AÇIK; belirtilmemiş preset de öyle davranmalı
test('wrap belirtilmemişse açık kabul edilir', () => {
  assert.strictEqual(preset(['per_frame_1=zoom=1;']).get('wrap'), 1);
});

test('dalga ayarları da başlıktan denklemlere taşınır', () => {
  const p = preset([
    'nWaveMode=6', 'bWaveThick=1', 'bAdditiveWaves=1',
    'fWaveAlpha=0.75', 'bMaximizeWaveColor=0',
  ]);
  assert.strictEqual(p.get('wave_mode'), 6);
  assert.strictEqual(p.get('wave_thick'), 1);
  assert.strictEqual(p.get('wave_additive'), 1);
  assert.strictEqual(p.get('wave_a'), 0.75);
  assert.strictEqual(p.get('wave_brighten'), 0);
});

/* Dalganın yeri havuzun doğal başlangıcı olan 0'da kalırsa sol/alt kenara
   yapışıyor; MilkDrop'un varsayılanı ekranın ortası. */
test('dalganın yeri varsayılan olarak ekranın ortası', () => {
  const p = preset(['per_frame_1=zoom=1;']);
  assert.strictEqual(p.get('wave_x'), 0.5);
  assert.strictEqual(p.get('wave_y'), 0.5);
});

test('per_frame başlıktaki değeri ezebilir', () => {
  const p = preset(['fDecay=0.5', 'per_frame_1=decay = 0.9;']);
  p.frame(INPUTS);
  assert.strictEqual(p.get('decay'), 0.9);
});

test('blok taşımayan preset boş diziler verir', () => {
  const p = preset(['per_frame_1=zoom = 1.01;']);
  assert.deepStrictEqual(p.waves, []);
  assert.deepStrictEqual(p.shapes, []);
});
