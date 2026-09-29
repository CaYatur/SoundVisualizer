'use strict';
/* MİLKDROP 3 BİÇİMİ (#567): Otomatik / MilkDrop 2 / MilkDrop 3.
 *
 * Tarif MilkDrop 3'ün kendi açıklamasından (README): 16 özel dalga ve şekil,
 * q1–q64, shader'da FFT ve fare, sert geçiş kipleri 1–7. Kodu herkese açık
 * değil (depodaki kaynak hâlâ MilkDrop 2.2 düzeyinde: NUM_Q_VAR 32, dörder
 * yuva) ve örnek presetleri yalnız bir yükleyicinin içinde; bu yüzden
 * burada yalnız açıklamanın sabitlediği davranış var.
 *
 * Korpusta ölçüldü (10.347 preset, depoya girmiyor): Otomatik kip hiçbirini
 * MilkDrop 3 saymıyor; eski ve yeni motor, uyum açık ve kapalı, bütün
 * çıktılarda bit bit aynı — yalnız uyum kapalıyken 4 numaralı yuvayı açan 7
 * preset değişiyor: eski okuyucu MilkDrop 2'nin hiç okumadığı o yuvayı
 * çiziyordu.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const M = require('../src/shared/milkdrop.js');
const C = require('../src/shared/milkdrop-cycle.js');
const E = require('../src/shared/milkdrop-edit.js');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8');
const milk = (lines) => ['MILKDROP_PRESET_VERSION=201', '[preset00]'].concat(lines).join('\r\n') + '\r\n';

// ------------------------------------------------------------ algılama

test('uzantılar adlarıyla; Otomatik yalnız MilkDrop 2 dosyasında görülmeyenleri sayıyor', () => {
  const f = (lines) => M.md3Features(milk(lines)).sort();
  assert.deepStrictEqual(f(['shapecode_4_enabled=1']), ['slot4']);
  assert.deepStrictEqual(f(['shapecode_4_enabled=0', 'shape_4_per_frame1=']), [], 'kapalı ve boş yuva sayılmıyor');
  assert.deepStrictEqual(f(['wavecode_7_enabled=1']), ['slots']);
  assert.deepStrictEqual(f(['shape_12_per_frame1=x = 0.5;']), ['slots']);
  assert.deepStrictEqual(f(['per_frame_1=q40 = bass;']), ['q64']);
  assert.deepStrictEqual(f(['per_frame_1=q32 = bass; myq40 = 1; // q50']), [], 'q32, başka ad ve yorum sayılmıyor');
  assert.deepStrictEqual(f(['nWaveMode=9']), ['wavemode']);
  assert.deepStrictEqual(f(['warp_1=`  ret = get_fft(uv.x);']), ['fft']);
  assert.deepStrictEqual(f(['comp_1=`  ret = get_fft_hz(440) * mouse.x;']), ['fft', 'mouse']);
  assert.deepStrictEqual(f(['comp_1=`  // get_fft(0)']), []);
  for (const [lines, want] of [
    [['shapecode_4_enabled=1'], false], [['nWaveMode=9'], false], [['wavecode_7_enabled=1'], true],
    [['per_frame_1=q64 = 1;'], true], [['warp_1=`ret = get_fft(0.5);'], true], [['comp_1=`ret = mouse.y;'], true],
  ]) assert.strictEqual(M.md3Auto(milk(lines)), want, lines[0]);
  assert.strictEqual(M.isMd3('md3', milk([])), true);
  assert.strictEqual(M.isMd3('md2', milk(['wavecode_7_enabled=1'])), false);
  assert.strictEqual(M.isMd3('auto', milk(['wavecode_7_enabled=1'])), true);
});

// ------------------------------------------------------------ yuvalar ve q

const SLOT7 = milk([
  'shapecode_4_enabled=1', 'shapecode_4_sides=3', 'shape_4_per_frame1=x = 0.25;',
  'shapecode_7_enabled=1', 'shapecode_7_sides=5', 'shape_7_per_frame1=x = 0.75;',
  'wavecode_9_enabled=1', 'wave_9_per_point1=y = 0.1;',
]);

test('MilkDrop 3 kurallarında 16 yuva, MilkDrop 2\'de 4 — iki okuyucuda da', () => {
  const idx = (p) => p.shapes.filter((s) => s.enabled).map((s) => s.index);
  for (const accurate of [true, false]) {
    const md3 = new M.Preset(SLOT7, { accurate, format: 'md3' });
    assert.strictEqual(md3.md3, true);
    assert.deepStrictEqual(idx(md3), [4, 7], 'uyum ' + accurate);
    assert.deepStrictEqual(md3.waves.filter((w) => w.enabled).map((w) => w.index), [9]);
    const md2 = new M.Preset(SLOT7, { accurate, format: 'md2' });
    assert.strictEqual(md2.md3, false);
    assert.deepStrictEqual(idx(md2), [], 'MilkDrop 2 dördüncüden ötesini okumuyor (uyum ' + accurate + ')');
    assert.deepStrictEqual(md2.waves, []);
  }
  // Otomatik: 7 ve 9 numara MilkDrop 3 uzantısı
  assert.strictEqual(new M.Preset(SLOT7, { format: 'auto' }).md3, true);
  const shape7 = new M.Preset(SLOT7, { format: 'md3' });
  const s = shape7.shapes.find((x) => x.index === 7);
  assert.strictEqual(shape7.shapeFrame(s, 0, {}).x, 0.75);
});

const Q40 = milk([
  'per_frame_1=q40 = 3; q32 = 2;',
  'per_pixel_1=dx = q40 * 0.01 + q32 * 0.001;',
  'wavecode_0_enabled=1', 'wave_0_per_frame1=r = q40 * 0.1;',
]);

test('q33–q64 MilkDrop 3\'te kare denkleminden piksele ve dalgaya geçiyor, MilkDrop 2\'de geçmiyor', () => {
  const run = (format) => {
    const p = new M.Preset(Q40, { format });
    p.frame({ time: 1, frame: 60, fps: 60, bass: 1, mid: 1, treb: 1 });
    p.captureBase();
    const o = p.pixel(0.5, 0.5, 0, 0, {});
    p.waveFrame(p.waves[0]);
    return { dx: o.dx, r: p.waves[0].pool.get('r') };
  };
  const a = run('md3');
  assert.ok(Math.abs(a.dx - 0.032) < 1e-12, 'q40 ve q32 piksele: ' + a.dx);
  assert.ok(Math.abs(a.r - 0.3) < 1e-12);
  const b = run('md2');
  assert.ok(Math.abs(b.dx - 0.002) < 1e-12, 'yalnız q32: ' + b.dx);
  assert.strictEqual(b.r, 0, 'q40 dalgaya geçmiyor');
  // Otomatik q40 görünce MilkDrop 3
  assert.strictEqual(new M.Preset(Q40, {}).md3, true);
});

test('MilkDrop 2 dosyası iki biçimde de aynı: q ve yuva sayısı dışında bir şey değişmiyor', () => {
  const src = milk(['zoom=1.01', 'per_frame_1=q1 = bass; zoom = zoom + 0.01*q1;', 'per_pixel_1=rot = 0.01*rad*q1;',
    'wavecode_0_enabled=1', 'wave_0_per_point1=x = sample; y = 0.5 + value1;']);
  const trace = (format) => {
    const p = new M.Preset(src, { seed: 3, format });
    const out = [];
    for (let i = 0; i < 3; i++) {
      p.frame({ time: i / 60, frame: i, fps: 60, bass: 1 + i, mid: 1, treb: 1 });
      p.captureBase();
      out.push(p.get('zoom'), p.pixel(0.3, 0.6, 0.4, 1, {}).rot);
      p.waveFrame(p.waves[0]);
      out.push(p.wavePoint(p.waves[0], 0.5, 0.1, -0.1, {}).y);
    }
    return out;
  };
  assert.deepStrictEqual(trace('md3'), trace('md2'));
});

// ------------------------------------------------------------ motor

function engine() {
  const canvas = () => ({ width: 320, height: 240, getContext: (k) => (k === '2d' ? {} : null), addEventListener() {} });
  const ctx = { window: {}, document: { createElement: canvas }, console, performance };
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  for (const f of ['src/shared/milkdrop.js', 'src/shared/milkdrop-hlsl.js', 'src/shared/milkdrop-shader.js', 'src/visualizer/modes/milkdrop.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  const m = new ctx.window.SVModes.milkdrop(canvas());
  return { m, MM: ctx.window.SVMilkdrop };
}

test('motor: biçim değişip presetin kuralı değişince preset yeniden kuruluyor, değişmezse yerinde', () => {
  const { m, MM } = engine();
  m._wantAcc = true;
  m._wantFmt = 'auto';
  m._presetSrc = SLOT7;
  m.preset = new MM.Preset(SLOT7, { seed: 1234, accurate: true, format: 'auto' });
  assert.strictEqual(m.preset.md3, true);
  assert.strictEqual(m._syncReading(), false, 'aynı ayarda dokunulmuyor');
  m._wantFmt = 'md2';
  assert.strictEqual(m._syncReading(), true);
  assert.strictEqual(m.preset.md3, false);
  assert.strictEqual(m.preset.shapes.length, 0);
  assert.strictEqual(m._syncReading(), false);
  // MilkDrop 2 dosyası: Otomatik ile MilkDrop 2 aynı kural, preset yerinde
  const plain = milk(['per_frame_1=q1 = 1;']);
  m._presetSrc = plain;
  m.preset = new MM.Preset(plain, { seed: 1234, accurate: true, format: 'auto' });
  const kept = m.preset;
  m._wantFmt = 'md2';
  assert.strictEqual(m._syncReading(), false);
  assert.strictEqual(m.preset, kept);
  assert.strictEqual(kept.format, 'md2');
  m._wantFmt = 'md3';
  assert.strictEqual(m._syncReading(), true, 'MilkDrop 3\'e zorlanınca yeniden kuruluyor');
  assert.strictEqual(m.preset.md3, true);
});

test('görselleştirici biçimi ayardan alıyor', () => {
  const code = read('src/visualizer/modes/milkdrop.js');
  assert.match(code, /this\._wantFmt = \(cfg\.milkdrop && cfg\.milkdrop\.format\) \|\| 'auto';/);
  const SV = (() => { global.window = global.window || {}; require('../src/shared/defaults.js'); return global.window.SV; })();
  assert.strictEqual(SV.defaultConfig().milkdrop.format, 'auto');
});

// ------------------------------------------------------------ sert geçiş

const LIST = [{ id: 'a', source: '' }, { id: 'b', source: '' }, { id: 'c', source: '' }];
const rel = (bass, treb) => ({ bass, mid: 1, treb });

test('MilkDrop 3 kipleri: eşik ve son değişimden bu yana en kısa süre', () => {
  const c = new C.Cycle(() => 0.5);
  const md = { hardCut: 'md3-2', format: 'auto' };
  const dt = 0.1;
  // Tiz 2,9'u aşıyor ama başta sayaç sonsuz: ilk vuruş geçiyor
  assert.ok(c.step(dt, md, LIST, 'a', rel(1, 3)));
  assert.strictEqual(c.cut, true);
  // 0,5 sn dolmadan tekrar geçmiyor
  for (let i = 0; i < 4; i++) assert.strictEqual(c.step(dt, md, LIST, 'b', rel(1, 3)), null);
  assert.ok(c.step(dt, md, LIST, 'b', rel(1, 3)), '0,5 sn sonra');
  // Eşiğin altı geçmiyor; bas bu kipte bakılmıyor
  for (let i = 0; i < 20; i++) assert.strictEqual(c.step(dt, md, LIST, 'c', rel(9, 2.8)), null);
  // Elle seçim de bir değişim
  c.reset();
  assert.strictEqual(c.step(dt, md, LIST, 'c', rel(1, 3)), null);
});

test('4. kip: tiz 8\'i aşarsa 3 sn beklenmiyor; 1. kip basa bakıyor', () => {
  const c = new C.Cycle(() => 0.5);
  const md = { hardCut: 'md3-4' };
  assert.ok(c.step(0.1, md, LIST, 'a', rel(1, 3)));
  assert.strictEqual(c.step(0.1, md, LIST, 'b', rel(1, 3)), null, '3 sn dolmadı');
  assert.ok(c.step(0.1, md, LIST, 'b', rel(1, 9)), 'tiz 8\'in üstünde');
  assert.strictEqual(c.step(0.05, md, LIST, 'c', rel(1, 9)), null, 'yine de 0,2 sn arayla');
  const b = new C.Cycle(() => 0.5);
  assert.ok(b.step(0.1, { hardCut: 'md3-1' }, LIST, 'a', rel(1.6, 1)));
  assert.strictEqual(b.step(0.3, { hardCut: 'md3-1' }, LIST, 'b', rel(1.4, 5)), null);
});

test('MilkDrop 2 biçiminde MilkDrop 3 kipi MilkDrop 2\'ninkine dönüyor', () => {
  assert.strictEqual(C.normalize({ hardCut: 'md3-3', format: 'md2' }).hardCut, 'md2');
  assert.strictEqual(C.normalize({ hardCut: 'md3-3', format: 'md3' }).hardCut, 'md3-3');
  assert.strictEqual(C.normalize({ hardCut: 'md3-3' }).hardCut, 'md3-3');
  assert.strictEqual(C.normalize({ hardCut: 'md3-7' }).hardCut, 'off', 'tarif edilmeyen kip yok');
});

// ------------------------------------------------------------ düzenleyici

test('düzenleyici: MilkDrop 3 kuralında 16 yuva okunuyor, MilkDrop 2\'de öteki satırlar dokunulmadan kalıyor', () => {
  const r16 = E.read(SLOT7, 16);
  assert.deepStrictEqual(r16.blocks.shape_7_per_frame, ['x = 0.75;']);
  const r4 = E.read(SLOT7, 4);
  assert.deepStrictEqual(r4.blocks.shape_7_per_frame, []);
  // MilkDrop 2 kuralında bir blok düzenleniyor: 4'ün ötesindeki satırlar yerinde
  const out = E.write(SLOT7, Object.assign({}, r4.blocks, { per_frame: ['q1 = 1;'] }), r4.values, 4);
  for (const l of ['shape_4_per_frame1=x = 0.25;', 'shape_7_per_frame1=x = 0.75;', 'wave_9_per_point1=y = 0.1;', 'shapecode_7_sides=5']) {
    assert.ok(out.includes(l + '\r\n'), 'kayboldu: ' + l);
  }
  assert.ok(out.includes('per_frame_1=q1 = 1;\r\n'));
  // MilkDrop 3 kuralında 7 numaralı şekil düzenlenebiliyor
  const out3 = E.write(SLOT7, Object.assign({}, r16.blocks, { shape_7_per_frame: ['x = 0.5;'] }), r16.values, 16);
  const p3 = new M.Preset(out3, { format: 'md3' });
  assert.strictEqual(p3.shapeFrame(p3.shapes.find((s) => s.index === 7), 0, {}).x, 0.5);
});
