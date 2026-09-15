'use strict';
/* `vol` VE `vol_att` MILKDROP'TA NASILSA (#560).
 *
 * İki ayrı yerde:
 *
 * SHADER. include.fx:62/66 `vol`ü `_c3.w`, `vol_att`ı `_c4.w` diye
 * tanımlıyor; milkdropfs.cpp:3732-3733 o bileşeni
 *     0.3333f * (mdsound.imm_rel[0], mdsound.imm_rel[1], mdsound.imm_rel[2])
 * diye dolduruyor. Virgül işleci yalnız son terimi veriyor: shader `vol`ü
 * 0,3333 × treb. Motor üç bandın ortalamasını veriyordu. Korpusta 96 preset
 * (%0,93) shader'da okuyor.
 *
 * ALT BLOKLAR. MilkDrop 2'nin dalga ve şekil sanal makinelerinde `vol`,
 * `vol_att`, `meshx/meshy`, `aspectx/aspecty`, `pixelsx/pixelsy` kayıtlı
 * değil (state.cpp:405-500). Motor bunları ana kare havuzundan her kare
 * kopyalıyordu. Korpusun tamamı motorun denklem makinesiyle anahtar açık
 * ve kapalı koşturulduğunda dalga ya da şekil çıktısı değişen 19 preset
 * (%0,18) var; hepsinde kare denklemleri `vol`ü kendi değişkeni olarak
 * atıyor ve bir şekil onu atamadan okuyor. Kendi önceki değerinden biriken
 * bir `vol` korpusta görünmüyor; aşağıdaki birikim testi kaynağın kuralını
 * doğruluyor, korpustaki bir örneği değil.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
global.window = global.window || {};
const MD = require('../src/shared/milkdrop.js');

const INPUTS = {
  time: 2, frame: 60, fps: 60, progress: 0.2,
  bass: 1.5, mid: 1.2, treb: 0.9, bass_att: 1.1, mid_att: 1, treb_att: 0.8,
  meshx: 64, meshy: 48, aspectx: 1, aspecty: 1.7778, pixelsx: 1920, pixelsy: 1080,
  mouse_x: 0.25, mouse_y: 0.75, mouse_down: 1,
};
const preset = (lines, accurate) => {
  const p = new MD.Preset(lines.join('\n') + '\n', { seed: 3 });
  if (accurate === false) p.accurate = false;
  return p;
};
const pointX = (p) => p.wavePoint(p.waves[0], 0, 0, 0, {}).x;

test('uyum varsayılan açık', () => {
  assert.strictEqual(new MD.Preset('per_frame_1=a=1;\n').accurate, true);
  assert.strictEqual(new MD.Preset('per_frame_1=a=1;\n', { accurate: false }).accurate, false);
});

test('dalga: ana havuzdaki vol görünmüyor — MilkDrop\'ta dalga makinesinde kayıtlı değil', () => {
  const lines = [
    'per_frame_1=vol = 5;',
    'wavecode_0_enabled=1',
    'wave_0_per_frame1=t1 = vol;',
    'wave_0_per_point1=x = t1;',
  ];
  const acc = preset(lines);
  acc.frame(INPUTS);
  acc.waveFrame(acc.waves[0]);
  assert.strictEqual(pointX(acc), 0, 'uyum açıkken dalga kendi (atanmamış) vol\'ünü görmeli');

  const legacy = preset(lines, false);
  legacy.frame(INPUTS);
  legacy.waveFrame(legacy.waves[0]);
  assert.strictEqual(pointX(legacy), 5, 'uyum kapalıyken eski davranış: ana havuzun vol\'ü');
});

test('dalga: kendi önceki değerinden yazılan vol kareler arası birikiyor', () => {
  const lines = [
    'per_frame_1=vol = (bass + mid + treb) / 3;',
    'wavecode_0_enabled=1',
    'wave_0_per_frame1=vol = vol + 1; t1 = vol;',
    'wave_0_per_point1=x = t1;',
  ];
  const acc = preset(lines);
  for (let f = 1; f <= 4; f++) {
    acc.frame(INPUTS);
    acc.waveFrame(acc.waves[0]);
    assert.strictEqual(pointX(acc), f, f + '. kare');
  }
  const legacy = preset(lines, false);
  for (let f = 1; f <= 3; f++) {
    legacy.frame(INPUTS);
    legacy.waveFrame(legacy.waves[0]);
    assert.ok(Math.abs(pointX(legacy) - (1.2 + 1)) < 1e-9, 'eski yol her kare ana havuza geri çekiyordu');
  }
});

test('şekil: vol, vol_att, mesh, aspect ve pixels taşınmıyor; uyum kapalıyken taşınıyor', () => {
  const lines = [
    'per_frame_1=vol = 7; vol_att = 8;',
    'shapecode_0_enabled=1',
    'shape_0_per_frame1=x = vol + vol_att + meshx + meshy + aspectx + aspecty + pixelsx + pixelsy;',
  ];
  const acc = preset(lines);
  acc.frame(INPUTS);
  assert.strictEqual(acc.shapeFrame(acc.shapes[0], 0, {}).x, 0);
  const legacy = preset(lines, false);
  legacy.frame(INPUTS);
  const expected = 7 + 8 + 64 + 48 + 1 + 1.7778 + 1920 + 1080;
  assert.ok(Math.abs(legacy.shapeFrame(legacy.shapes[0], 0, {}).x - expected) < 1e-9);
});

test('MilkDrop\'un kaydettiği girdiler ve q\'lar alt bloklara taşınmaya devam ediyor', () => {
  const p = preset([
    'per_frame_1=q5 = 42;',
    'wavecode_0_enabled=1',
    'wave_0_per_point1=x = time + frame + fps + progress + bass + mid + treb + bass_att + mid_att + treb_att + q5;',
  ]);
  p.frame(INPUTS);
  p.waveFrame(p.waves[0]);
  const expected = 2 + 60 + 60 + 0.2 + 1.5 + 1.2 + 0.9 + 1.1 + 1 + 0.8 + 42;
  assert.ok(Math.abs(pointX(p) - expected) < 1e-9);
});

test('fare bizim eklentimiz ve alt bloklarda da okunuyor', () => {
  const p = preset([
    'shapecode_0_enabled=1',
    'shape_0_per_frame1=x = mouse_x; y = mouse_y + mouse_down;',
  ]);
  p.frame(INPUTS);
  const o = p.shapeFrame(p.shapes[0], 0, {});
  assert.strictEqual(o.x, 0.25);
  assert.strictEqual(o.y, 1.75);
});

test('görselleştirici: shader vol 0,3333 × treb, uyum kapalıyken ortalama; anahtar presete her kare yazılıyor', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8');
  assert.match(src, /vol: this\._wantAcc !== false \? 0\.3333 \* treb : \(bass \+ mid \+ treb\) \/ 3,/);
  assert.match(src, /vol_att: this\._wantAcc !== false \? 0\.3333 \* trebA : \(bassA \+ midA \+ trebA\) \/ 3,/);
  assert.match(src, /this\.preset\.accurate = this\._wantAcc !== false;/);
  assert.match(src, /if \(this\.oldPreset\) this\.oldPreset\.accurate = this\.preset\.accurate;/);
  // shader başlığı adları hâlâ ayrı uniform olarak bildiriyor
  const shader = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'milkdrop-shader.js'), 'utf-8');
  assert.match(shader, /'uniform float bass, mid, treb, vol;'/);
  assert.match(shader, /'uniform float bass_att, mid_att, treb_att, vol_att;'/);
});
