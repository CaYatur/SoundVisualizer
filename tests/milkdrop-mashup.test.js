'use strict';
/* MilkDrop karışımı (#579): parçalar bütünüyle ve olduğu gibi.
 *
 * Tek presetten kurulan karışımın kendisini vermesi hiçbir şeyin
 * düşmediğini gösteriyor ama bir anahtarın YANLIŞ parçaya konduğunu
 * göstermiyor: altı parça aynı presetten geldiği için yanlış yere konan
 * anahtar yine çıktıda. Onu farklı presetlerden kurulan karışım gösteriyor:
 * her parça kendi presetininkine eşit olmalı. İkisi de burada; korpusun
 * 10.332 presetiyle ölçümü ROADMAP'te. */
const test = require('node:test');
const assert = require('node:assert');

const X = require('../src/shared/milkdrop-mashup.js');
const M = require('../src/shared/milkdrop.js');
const G = require('../src/shared/milkdrop-generator.js');
const BUILTINS = require('../src/shared/presets-milkdrop.js');

// Test presetleri: yerleşikler ve her parçası olan üretilmişler
function seeds(n, start) {
  let x = (start || 0x2468ACE) >>> 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    out.push(x);
  }
  return out;
}
const GENERATED = seeds(40).map((s) => G.generate({
  energy: s % 101, warmth: (s >>> 7) % 101, density: 40 + ((s >>> 13) % 61), motion: (s >>> 19) % 101, seed: s % G.SEED_LIMIT,
}).source);
const TEXTS = BUILTINS.map((p) => p.source).concat(GENERATED);

const VKEYS = ['milkdrop_preset_version', 'psversion', 'psversion_warp', 'psversion_comp'];
const MOTION = ['zoom', 'rot', 'cx', 'cy', 'dx', 'dy', 'warp', 'sx', 'sy', 'fwarpanimspeed', 'fwarpscale', 'fzoomexponent'];
const BLUR = ['b1n', 'b2n', 'b3n', 'b1x', 'b2x', 'b3x', 'b1ed'];

// Bir parametrenin parçası — testin kendi, kaynağınkinden bağımsız yazımı
function classOf(k) {
  if (VKEYS.indexOf(k) >= 0) return 'version';
  if (MOTION.indexOf(k) >= 0) return 'motion';
  if (k.indexOf('wavecode_') === 0) return 'waves';
  if (k.indexOf('shapecode_') === 0) return 'shapes';
  if (BLUR.indexOf(k) >= 0) return 'comp';
  return 'look';
}
const paramsOf = (f, cls) => {
  const o = {};
  for (const k of Object.keys(f.params)) if (classOf(k) === cls) o[k] = f.params[k];
  return o;
};

// -------------------------------------------------------------- sınıflama

test('her anahtar tek bir parçaya ait', () => {
  const cases = {
    look: ['fRating', 'fDecay', 'fGammaAdj', 'fVideoEchoZoom', 'nWaveMode', 'bAdditiveWaves', 'wave_r', 'wave_x',
      'ob_size', 'ib_a', 'mv_l', 'nMotionVectorsX', 'bInvert', 'bRedBlueStereo', 'fShader', 'nWrapMode_X', 'wave_thick', 'bilinmeyen'],
    motion: ['zoom', 'ROT', ' cx ', 'dx', 'warp', 'sx', 'fWarpAnimSpeed', 'fWarpScale', 'fZoomExponent',
      'per_frame_1', 'per_frame_init_3', 'PER_PIXEL_12', 'per_vertex_2'],
    waves: ['wavecode_0_enabled', 'wavecode_3_r', 'wave_1_per_point7', 'wave_0_per_frame1', 'wave_2_init1'],
    shapes: ['shapecode_0_sides', 'shapecode_3_border_a', 'shape_2_per_frame4', 'shape_0_init1'],
    warp: ['warp_1', 'WARP_27'],
    comp: ['comp_1', 'comp_40', 'b1n', 'b3x', 'b1ed'],
    version: ['MILKDROP_PRESET_VERSION', 'PSVERSION', 'psversion_warp', 'PSVERSION_COMP'],
  };
  for (const slot of Object.keys(cases)) {
    for (const k of cases[slot]) assert.strictEqual(X.slotOf(k), slot, k);
  }
});

// ------------------------------------------------------------- gidiş-dönüş

function sameParts(a, b, msg) {
  assert.strictEqual(a.init, b.init, msg + ' init');
  assert.strictEqual(a.perFrame, b.perFrame, msg + ' per_frame');
  assert.strictEqual(a.perPixel, b.perPixel, msg + ' per_pixel');
  assert.deepStrictEqual(a.waves, b.waves, msg + ' dalgalar');
  assert.deepStrictEqual(a.shapes, b.shapes, msg + ' şekiller');
  assert.strictEqual(a.warpShader, b.warpShader, msg + ' warp');
  assert.strictEqual(a.compShader, b.compShader, msg + ' comp');
}

test('tek presetten kurulan karışım presetin kendisi: hiçbir şey düşmüyor', () => {
  for (const t of TEXTS) {
    const all = {};
    for (const s of X.SLOTS) all[s] = t;
    const out = M.parseMilk(X.compose(all));
    const src = M.parseMilk(t);
    sameParts(out, src, 'tek preset');
    for (const cls of ['look', 'motion', 'waves', 'shapes', 'comp']) {
      assert.deepStrictEqual(paramsOf(out, cls), paramsOf(src, cls), cls);
    }
  }
});

test('farklı presetlerden: her parça kendi presetininkine eşit', () => {
  /* Yanlış parçaya konan bir anahtar burada görünüyor: tek presetten
     kurulan karışımda görünmüyordu. */
  const pickT = seeds(300, 0x51A);
  for (let i = 0; i < 60; i++) {
    const d = {};
    X.SLOTS.forEach((s, j) => { d[s] = TEXTS[pickT[i * 6 + j] % TEXTS.length]; });
    const out = M.parseMilk(X.compose(d));
    const p = {};
    for (const s of X.SLOTS) p[s] = M.parseMilk(d[s]);
    assert.strictEqual(out.init, p.motion.init);
    assert.strictEqual(out.perFrame, p.motion.perFrame);
    assert.strictEqual(out.perPixel, p.motion.perPixel);
    assert.deepStrictEqual(out.waves, p.waves.waves);
    assert.deepStrictEqual(out.shapes, p.shapes.shapes);
    assert.strictEqual(out.warpShader, p.warp.warpShader);
    assert.strictEqual(out.compShader, p.comp.compShader);
    assert.deepStrictEqual(paramsOf(out, 'look'), paramsOf(p.look, 'look'));
    assert.deepStrictEqual(paramsOf(out, 'motion'), paramsOf(p.motion, 'motion'));
    assert.deepStrictEqual(paramsOf(out, 'waves'), paramsOf(p.waves, 'waves'));
    assert.deepStrictEqual(paramsOf(out, 'shapes'), paramsOf(p.shapes, 'shapes'));
    assert.deepStrictEqual(paramsOf(out, 'comp'), paramsOf(p.comp, 'comp'));
  }
});

test('satırlar olduğu gibi: numaralar değişmiyor, yeni satır yazılmıyor', () => {
  const [a, b] = [GENERATED[0], GENERATED[1]];
  const out = X.compose({ look: a, motion: b, waves: a, shapes: b, warp: a, comp: b });
  const lines = out.split('\n').filter((l) => l && l[0] !== '[' && !/^(MILKDROP_PRESET_VERSION|PSVERSION)/.test(l));
  const pool = new Set(a.split('\n').concat(b.split('\n')).map((l) => l.trim()));
  for (const l of lines) assert.ok(pool.has(l), 'kaynakta olmayan satır: ' + l);
});

test('sürüm satırları shader\'ı veren presetten', () => {
  const md2 = GENERATED.find((t) => /warp_1=/.test(t) && /comp_1=/.test(t));
  const md1 = BUILTINS[0].source;
  assert.ok(md2 && !/PSVERSION/.test(md1));
  const ver = (t) => {
    const f = M.parseMilk(t);
    return [f.params.milkdrop_preset_version, f.params.psversion, f.params.psversion_warp, f.params.psversion_comp];
  };
  // Görünüm MilkDrop 1, shader'lar MilkDrop 2 presetinden: satırlar yazılıyor
  assert.deepStrictEqual(ver(X.compose({ look: md1, motion: md1, waves: md1, shapes: md1, warp: md2, comp: md2 })), [201, 2, 2, 2]);
  // Shader yok: MilkDrop 1 dosyası
  const none = X.compose({ look: md1, motion: md2, waves: md2, shapes: md2, warp: X.NONE, comp: X.NONE });
  assert.ok(!/PSVERSION|MILKDROP_PRESET_VERSION/.test(none), none.slice(0, 80));
  assert.ok(!/^(warp|comp)_\d+=/m.test(none));
  /* Bulanıklık aralıkları birleştirme parçasında ama shader değil: shader'ı
     olmayan MilkDrop 1 presetine sürüm satırı yazılmıyor (korpusta 308
     preset böyleydi) */
  const blurOnly = '[preset00]\nfDecay=0.9\nb1n=0.000\nb1x=1.000\nper_frame_1=zoom = 1.01;\n';
  assert.ok(!/PSVERSION|MILKDROP_PRESET_VERSION/.test(X.compose({ look: blurOnly })));
  assert.deepStrictEqual(ver(X.compose({ look: md2, comp: blurOnly })).slice(2), [2, 0]);
  /* Shader'ı olmayan bir MilkDrop 2 dosyası kendi sürüm satırlarını
     koruyor: tek presetten kurulan karışım kendisini birebir vermeli */
  const md2Plain = 'MILKDROP_PRESET_VERSION=201\nPSVERSION=2\nPSVERSION_WARP=0\nPSVERSION_COMP=0\n[preset00]\nfDecay=0.95\nper_frame_1=zoom = 1.01;\n';
  assert.deepStrictEqual(ver(X.compose({ look: md2Plain, motion: md2Plain, waves: md2Plain, shapes: md2Plain, warp: md2Plain, comp: md2Plain })), [201, 2, 0, 0]);
  /* MilkDrop'un okumadığı bir shader karışımda da okunmayan kalıyor
     (#580): warp metni olan ama PSVERSION_WARP=0 yazan presetten gelen
     warp parçasının sürümü 0 yazılıyor, 2 değil. */
  const inert = 'MILKDROP_PRESET_VERSION=201\nPSVERSION=2\nPSVERSION_WARP=0\nPSVERSION_COMP=0\n[preset00]\nwarp_1=`shader_body { ret = 0.5; }\n';
  const inertOut = M.parseMilk(X.compose({ look: md1, motion: md1, waves: md1, shapes: md1, warp: inert, comp: md2 }));
  assert.strictEqual(inertOut.params.psversion_warp, 0);
  assert.strictEqual(M.stagePlan(inertOut).warp, 'fixed');
  // Yalnız birleştirme: warp sürümü 0
  assert.deepStrictEqual(ver(X.compose({ look: md1, motion: md1, waves: md1, shapes: md1, warp: X.NONE, comp: md2 })), [201, 2, 0, 2]);
  // Presetin kendi sürümü korunuyor (ps_3_0 shader'ı 2 ile okunmaz)
  const v3 = md2.replace('PSVERSION=2', 'PSVERSION=3').replace('PSVERSION_WARP=2', 'PSVERSION_WARP=3').replace('PSVERSION_COMP=2', 'PSVERSION_COMP=3');
  assert.deepStrictEqual(ver(X.compose({ look: md1, motion: md1, waves: md1, shapes: md1, warp: v3, comp: md2 })), [201, 3, 3, 2]);
});

test('"yok" shader parçası bulanıklık aralıklarını da götürüyor', () => {
  const withBlur = '[preset00]\nfDecay=0.9\nb1n=0.1\nb1x=0.8\ncomp_1=`shader_body { ret = GetBlur1(uv); }\n';
  const out = M.parseMilk(X.compose({ look: withBlur, comp: X.NONE }));
  assert.strictEqual(out.params.b1n, undefined);
  assert.strictEqual(out.params.fdecay, 0.9);
  const kept = M.parseMilk(X.compose({ look: '[preset00]\nfDecay=0.5\n', comp: withBlur }));
  assert.strictEqual(kept.params.b1n, 0.1);
  assert.strictEqual(kept.params.fdecay, 0.5);
});

// ------------------------------------------------------------- parça var mı

test('"parçası var mı" ayrıştırıcıyla aynı cevabı veriyor', () => {
  const parsedHas = (t, slot) => {
    const f = M.parseMilk(t);
    const enabled = (pre) => Object.keys(f.params).some((k) => new RegExp('^' + pre + '_\\d+_enabled$').test(k) &&
      typeof f.params[k] === 'number' && f.params[k] !== 0);
    if (slot === 'look') return true;
    if (slot === 'motion') return !!(f.init.trim() || f.perFrame.trim() || f.perPixel.trim());
    if (slot === 'waves') return enabled('wavecode');
    if (slot === 'shapes') return enabled('shapecode');
    // Shader parçası: motorun kuralıyla bu presetin shader'ı çalışıyor mu (#580)
    return M.stagePlan(f)[slot] === 'shader';
  };
  const edge = [
    '[preset00]\nper_frame_1=// yalnız yorum\n',
    '[preset00]\n  PER_FRAME_1=zoom = 1.01;\n',
    '[preset00]\nper_vertex_1=rot = rot + 0.01;\n',
    '[preset00]\nwavecode_0_enabled=0\nwave_0_per_point1=x = sample;\n',
    '[preset00]\nwavecode_2_enabled=1.000\n',
    '[preset00]\nWAVECODE_1_ENABLED=1\n',
    '[preset00]\nwavecode_0_enabled=evet\n',
    '[preset00]\nshapecode_3_enabled=0.000\nshapecode_1_enabled=2\n',
    // Korpusta: aynı anahtar iki kez, ayrıştırıcı sonuncuyu tutuyor
    '[preset00]\nshapecode_2_enabled=1\nshapecode_2_enabled=0\n',
    '[preset00]\nwavecode_0_enabled=0\r\nwavecode_0_enabled=1\r\n',
    '[preset00]\nwarp_1=`\nwarp_2=`   \n',
    '[preset00]\nwarp_1=`shader_body\ncomp_1=\n',
    '[preset00]\ncomp_1=`ret = 1;\n',
    // Sürüm kuralı (#580): MilkDrop sürümü 0 olan aşamanın metnini okumuyor
    'MILKDROP_PRESET_VERSION=201\n[preset00]\nwarp_1=`shader_body\ncomp_1=`ret = 1;\n',
    'MILKDROP_PRESET_VERSION=201\nPSVERSION_WARP=0\nPSVERSION_COMP=3\n[preset00]\nwarp_1=`shader_body\ncomp_1=`ret = 1;\n',
    'MILKDROP_PRESET_VERSION=200\nPSVERSION=0\n[preset00]\nwarp_1=`shader_body\n',
    'MILKDROP_PRESET_VERSION=200\n[preset00]\nwarp_1=`shader_body\n',
    'MILKDROP_PRESET_VERSION=199\nPSVERSION_WARP=2\n[preset00]\nwarp_1=`shader_body\n',
    'MILKDROP_PRESET_VERSION=201\nPSVERSION_WARP=abc\n[preset00]\nwarp_1=`shader_body\n',
    'MILKDROP_PRESET_VERSION=201\nPSVERSION_WARP=2\nPSVERSION_WARP=0\n[preset00]\nwarp_1=`shader_body\n',
    'milkdrop_preset_version=201.7\npsversion_comp=2.9\n[preset00]\ncomp_1=`ret = 1;\n',
    '',
  ];
  for (const t of edge.concat(TEXTS)) {
    for (const s of X.SLOTS) {
      assert.strictEqual(X.has(t, s), parsedHas(t, s), s + ': ' + JSON.stringify(t.slice(0, 60)));
    }
  }
});

// --------------------------------------------------------- kimlik ve ad

test('kimlik tariften: aynı tarif aynı kimlik, depo adıyla uyumlu', () => {
  const r = { look: 'a', motion: 'b', waves: 'c', shapes: 'a', warp: '', comp: 'd' };
  const id = X.idOf(r);
  assert.match(id, /^md_mix1_[0-9a-f]{16}$/);
  assert.strictEqual(X.idOf(Object.assign({}, r)), id);
  assert.notStrictEqual(X.idOf(Object.assign({}, r, { warp: 'b' })), id);
  assert.notStrictEqual(X.idOf(Object.assign({}, r, { look: 'b', motion: 'a' })), id, 'parçanın yeri de kimlikte');
  assert.strictEqual(X.recipeKey(r), 'look:a|motion:b|waves:c|shapes:a|warp:|comp:d');
});

test('ad: kelime ve ilk üç ayrı preset, uzunlar kısaltılmış', () => {
  const names = { a: 'Alfa', b: 'Beta', c: 'Gamma Delta Epsilon Zeta Eta Theta', d: 'Delta' };
  const r = { look: 'a', motion: 'b', waves: 'a', shapes: 'c', warp: '', comp: 'd' };
  assert.strictEqual(X.nameFor(r, (id) => names[id], 'tr'), 'Karışım: Alfa × Beta × Gamma Delta Epsilon Z…');
  assert.strictEqual(X.nameFor(r, (id) => names[id], 'en'), 'Mash-up: Alfa × Beta × Gamma Delta Epsilon Z…');
});

// ------------------------------------------------------------------- aday

test('aday yalnız o parçası olan presetlerden, tohumla aynı sonuç', () => {
  const list = TEXTS.map((t, i) => ({ id: 'p' + i, source: t }));
  const withWarp = new Set(list.filter((p) => X.has(p.source, 'warp')).map((p) => p.id));
  assert.ok(withWarp.size > 5 && withWarp.size < list.length);
  const rand = (s) => { let x = s; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; };
  for (let s = 1; s < 40; s++) {
    const p = X.pick(list, 'warp', rand(s));
    assert.ok(p && withWarp.has(p.id), String(p && p.id));
    assert.strictEqual(X.pick(list, 'warp', rand(s)).id, p.id, 'aynı tohum aynı aday');
    const q = X.pick(list, 'warp', rand(s), p.id);
    assert.notStrictEqual(q.id, p.id, 'yeniden çekince değişmeli');
  }
  assert.strictEqual(X.pick([], 'look', Math.random), null);
  // Seyrek aday rastgele dokunuşta bulunmasa da taranıp bulunuyor
  const rare = list.map((p, i) => (i === 7 ? p : { id: p.id, source: '[preset00]\nfDecay=0.9\n' }));
  const found = X.pick(rare, 'motion', () => 0, null, 3);
  assert.strictEqual(found && found.id, 'p7');
  assert.strictEqual(X.pick(rare.filter((p) => p.id !== 'p7'), 'motion', Math.random), null);
});
