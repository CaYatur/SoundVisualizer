'use strict';
/* MILKDROP 2'NİN DOSYA OKUYUŞU (#580).
 *
 * Uyum açıkken preset dosyası MilkDrop'un okuduğu gibi okunuyor
 * (shared/milkdrop.js `parseMilkMd2`, `readMilk`); kapalıyken eski
 * ayrıştırıcı. Kurallar Nullsoft'un kodundan (jecassis/foo_vis_milk2
 * 5b44cea, state.cpp _GetLineByName, GetFastInt/Float/String, ReadCode,
 * CState::Import; BeatDrop'un D3D9 hâli aynı):
 *  - satırın adı ilk `=`ye, boşluğa ya da satır sonuna kadar;
 *  - anahtar büyük/küçük harfe duyarlı, MilkDrop'un sırasıyla aranıyor:
 *    önce bir önceki okumanın ardındaki satır, o değilse ilk geçiş;
 *  - tam sayılar `%d`, kayan noktalılar `%f`;
 *  - numaralı kod ilk eksik numarada bitiyor, denklem satırları yorumları
 *    (`//`, `\\`) atılarak ARAYA HİÇBİR ŞEY KONMADAN yapışıyor.
 * Korpusun 10.332 presetinden 32'sinde iki okuyuş motorun kullandığı bir
 * şeyde ayrışıyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const M = require('../src/shared/milkdrop.js');
const ROOT = path.join(__dirname, '..');

test('anahtar büyük/küçük harfe duyarlı; girintili satır ve "anahtar = değer" okunmuyor, "anahtar değer" okunuyor', () => {
  const t = 'MILKDROP_PRESET_VERSION=201\nPSVERSION_comp=3\nfdecay=0.5\n  fGammaAdj=3\nzoom 1.02\nrot = 0.1\n';
  const p = M.parseMilkMd2(t).params;
  assert.strictEqual(p.milkdrop_preset_version, 201);
  assert.strictEqual(p.psversion_comp, undefined, 'PSVERSION_comp okunmuyor');
  assert.strictEqual(p.fdecay, undefined, 'fdecay okunmuyor');
  assert.strictEqual(p.fgammaadj, undefined, 'girintili satırın adı boş');
  assert.strictEqual(p.zoom, 1.02, 'boşluk da ayırıcı');
  assert.strictEqual(p.rot, undefined, 'değer "= 0.1": sayı yok');
  // Eski ayrıştırıcı hepsini okuyordu
  const old = M.parseMilk(t).params;
  assert.strictEqual(old.psversion_comp, 3);
  assert.strictEqual(old.fdecay, 0.5);
  assert.strictEqual(old.fgammaadj, 3);
});

test('iki kez yazılmış anahtar: önce bir önceki okumanın ardındaki satır, değilse ilk geçiş', () => {
  // fRating okunduktan sonraki satır fDecay: o okunuyor, ilk geçiş değil
  assert.strictEqual(M.parseMilkMd2('fDecay=0.5\nfRating=3\nfDecay=0.7\n').params.fdecay, 0.7);
  // Ardındaki satır başka bir anahtar: baştan tarama, ilk geçiş
  assert.strictEqual(M.parseMilkMd2('fDecay=0.5\nfGammaAdj=2\nfDecay=0.7\n').params.fdecay, 0.5);
  assert.strictEqual(M.parseMilkMd2('fGammaAdj=2\nfDecay=0.5\nfDecay=0.7\n').params.fdecay, 0.5, 'tarama ilkini buluyor');
  assert.strictEqual(M.parseMilk('fDecay=0.5\nfGammaAdj=2\nfDecay=0.7\n').params.fdecay, 0.7, 'eski: sonuncusu');
  // Korpustaki biçim: şekil açık yazılmış, sonra kapalı
  assert.strictEqual(M.parseMilkMd2('shapecode_2_enabled=1\nshapecode_2_enabled=0\n').params.shapecode_2_enabled, 1);
});

test('tam sayılar %d, kayan noktalılar %f; sayı yoksa anahtar okunmamış', () => {
  const p = M.parseMilkMd2('bBrighten=0.5\nnWaveMode=3.9\nshapecode_0_textured=0.05\nfDecay=.975;\n' +
    'fGammaAdj=abc\nzoom=1e-1x\nwarp=-.5\nnVideoEchoOrientation=-1.7\n').params;
  assert.strictEqual(p.bbrighten, 0, 'bBrighten=0.5 kapalı');
  assert.strictEqual(p.nwavemode, 3);
  assert.strictEqual(p.shapecode_0_textured, 0);
  assert.strictEqual(p.fdecay, 0.975, 'baştaki sayı');
  assert.strictEqual(p.fgammaadj, undefined);
  assert.strictEqual(p.zoom, 0.1);
  assert.strictEqual(p.warp, -0.5);
  assert.strictEqual(p.nvideoechoorientation, -1);
});

test('numaralı kod ilk eksik numarada bitiyor; ters tırnak atılıyor; // ve \\\\ yorum; satırlar yapışıyor', () => {
  const t = 'per_frame_1=a = 1; // yorum\nper_frame_2=b = 2; \\\\ ters yorum\nper_frame_3=`c = 3; \n' +
    'per_frame_5=d = 4;\nwarp_1=`shader_body\nwarp_2=`{ ret = 0; }\ncomp_2=ret = 1;\n';
  const f = M.parseMilkMd2(t);
  assert.strictEqual(f.perFrame, 'a = 1; b = 2; c = 3; ', 'satır sonu boşluğu korunuyor, 5 okunmuyor');
  assert.strictEqual(f.warpShader, 'shader_body\n{ ret = 0; }');
  assert.strictEqual(f.compShader, '', 'comp_1 yok: hiç okunmuyor');
  const old = M.parseMilk(t);
  assert.ok(/d = 4/.test(old.perFrame), 'eski: boşluktan sonrası da');
  // Ayraçsız yapışma: MilkDrop satır sonu koymuyor
  assert.strictEqual(M.parseMilkMd2('per_frame_1=a = 1\nper_frame_2=b = 2;\n').perFrame, 'a = 1b = 2;');
  // Dalga ve şekil blokları numaralarıyla, 0..3
  const w = M.parseMilkMd2('wave_2_per_point1=x = sample;\nshape_1_per_frame1=rad = 0.2;\nshape_4_per_frame1=rad = 0.3;\n');
  assert.deepStrictEqual(w.waves, [{ index: 2, per_point: 'x = sample;' }]);
  assert.deepStrictEqual(w.shapes, [{ index: 1, per_frame: 'rad = 0.2;' }], 'MilkDrop 2 dört şekil okuyor');
});

test('sürüm satırları MilkDrop\'un sırasıyla: 200 PSVERSION, üstü WARP/COMP', () => {
  assert.deepStrictEqual(M.readVersions('MILKDROP_PRESET_VERSION=200\nPSVERSION=3\nPSVERSION_WARP=0\n'),
    { milkdrop_preset_version: 200, psversion: 3 });
  assert.deepStrictEqual(M.readVersions('MILKDROP_PRESET_VERSION=201\nPSVERSION=3\nPSVERSION_WARP=0\nPSVERSION_COMP=2\n'),
    { milkdrop_preset_version: 201, psversion_warp: 0, psversion_comp: 2 });
  assert.deepStrictEqual(M.readVersions('milkdrop_preset_version=201\nPSVERSION_WARP=2\n'), {}, 'küçük harf: MilkDrop 1');
  assert.deepStrictEqual(M.readVersions('MILKDROP_PRESET_VERSION=201\nPSVERSION_WARP=2\nPSVERSION_WARP=0\n'),
    { milkdrop_preset_version: 201, psversion_warp: 2 }, 'ardındaki satır: ilk yazılan');
  // Motor aşamayı bu değerlerden seçiyor
  assert.strictEqual(M.stagePlan(M.parseMilkMd2('MILKDROP_PRESET_VERSION=201\nPSVERSION_comp=0\ncomp_1=`ret = 1;\n')).comp, 'shader',
    'PSVERSION_comp okunmuyor: 2');
});

test('readMilk ve Preset: uyum kapalıyken eski ayrıştırıcı; okuyuş kurulumda, readAcc\'ta', () => {
  const t = 'fdecay=0.5\n';
  assert.strictEqual(M.readMilk(t, false).params.fdecay, 0.5);
  assert.strictEqual(M.readMilk(t, true).params.fdecay, undefined);
  const a = new M.Preset(t, { seed: 1 });
  assert.strictEqual(a.readAcc, true);
  a.frame({ time: 0, frame: 0 });
  assert.strictEqual(a.get('decay'), 0.98, 'MilkDrop okumuyor: varsayılan');
  const b = new M.Preset(t, { seed: 1, accurate: false });
  assert.strictEqual(b.readAcc, false);
  b.frame({ time: 0, frame: 0 });
  assert.strictEqual(b.get('decay'), 0.5);
  // `psetname` MilkDrop'un anahtarı değil ama ad yine metinden
  assert.strictEqual(new M.Preset('psetname=Deneme Adı\n').name, 'Deneme Adı');
});

test('readingsDiffer: motorun kullandığı bir şeyde ayrışan dosyada true, yalnız biçimde ayrışanda false', () => {
  const md2 = 'MILKDROP_PRESET_VERSION=201\nPSVERSION=2\nPSVERSION_WARP=2\nPSVERSION_COMP=2\nfDecay=0.9\n';
  assert.strictEqual(M.readingsDiffer(md2), false, 'MilkDrop\'un okumadığı PSVERSION satırı fark sayılmıyor');
  assert.strictEqual(M.readingsDiffer('per_frame_1=a = 1; \nper_frame_2=b = 2;\n'), false, 'yalnız boşluk');
  assert.strictEqual(M.readingsDiffer('fdecay=0.9\n'), true);
  assert.strictEqual(M.readingsDiffer('shapecode_0_textured=0.5\n'), true);
  assert.strictEqual(M.readingsDiffer('gamma=1\n'), true, 'başlıkta kare değişkeni adı');
  assert.strictEqual(M.readingsDiffer('per_frame_1=a = 1;\nper_frame_3=b = 2;\n'), true, 'numarada boşluk');
});

/* Preset kuran her yer okuma kuralını AÇIKÇA veriyor: Preset'in varsayılanı
   açık, görselleştirici ise kullanıcının ayarını izliyor. Verilmeyen bir
   yer uyum kapalıyken MilkDrop'un okuyuşunu sessizce kullanırdı. */
test('kaynakta her Preset kurulumu okuma kuralını veriyor', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
  let found = 0;
  for (const file of walk(path.join(ROOT, 'src'))) {
    const src = fs.readFileSync(file, 'utf-8');
    const re = /new [A-Za-z_.]*Preset\(([^;]*?)\)[;\n ]/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      found++;
      assert.match(m[1], /accurate:/, path.relative(ROOT, file) + ': ' + m[0].slice(0, 80));
    }
  }
  assert.ok(found >= 4, 'Preset kurulumları bulunamadı: ' + found);
});
