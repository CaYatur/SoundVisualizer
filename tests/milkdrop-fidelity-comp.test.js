'use strict';
/* MilkDrop 2'nin sabit birleştirmesi, aşama seçimi ve varsayılanları (#580).
 *
 * Birincil kaynak jecassis/foo_vis_milk2 5b44cea (Nullsoft'un kodu); sabit
 * yolun harmanlama geçişleri BeatDrop 53d83ee'deki D3D9 hâliyle de
 * karşılaştırıldı. Buradaki beklentiler o koddan okunan KURALLAR:
 *  - aşama SÜRÜMDEN seçiliyor, metinden değil (state.cpp:1328-1348);
 *  - sürümü olup metni olmayan aşamaya MilkDrop yüklemede, dosyadaki
 *    değerleri gömülü bir shader yazıyor (plugin.cpp GenWarpPShaderText,
 *    GenCompPShaderText);
 *  - sabit yolda parlatma 1-(1-c)^2, solarize 2c(1-c), yön `(int)x % 4`,
 *    gama yankıyla birlikte 1'in altında uygulanmıyor;
 *  - dosyanın yazmadığı yerleşik adlarda MilkDrop'un varsayılanı. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const M = require('../src/shared/milkdrop.js');
const S = require('../src/shared/milkdrop-shader.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

// ---------------------------------------------------------- aşama seçimi

test('sürüm kuralı: MILKDROP_PRESET_VERSION yoksa MilkDrop 1', () => {
  const v = (text) => M.md2Versions(M.parseMilk(text).params);
  assert.deepStrictEqual(v('[preset00]\nPSVERSION_WARP=2\nPSVERSION_COMP=2\n'), { preset: 100, warp: 0, comp: 0 });
  assert.deepStrictEqual(v('MILKDROP_PRESET_VERSION=199\nPSVERSION=2\n'), { preset: 199, warp: 0, comp: 0 });
  assert.deepStrictEqual(v('MILKDROP_PRESET_VERSION=200\n'), { preset: 200, warp: 2, comp: 2 });
  assert.deepStrictEqual(v('MILKDROP_PRESET_VERSION=200\nPSVERSION=3\nPSVERSION_WARP=0\n'), { preset: 200, warp: 3, comp: 3 });
  assert.deepStrictEqual(v('MILKDROP_PRESET_VERSION=201\n'), { preset: 201, warp: 2, comp: 2 });
  assert.deepStrictEqual(v('MILKDROP_PRESET_VERSION=201\nPSVERSION=3\nPSVERSION_WARP=0\n'), { preset: 201, warp: 0, comp: 2 });
  // %d: kesir aşağı kırpılıyor; sayı olmayan değer varsayılana düşüyor
  assert.deepStrictEqual(v('MILKDROP_PRESET_VERSION=201.9\nPSVERSION_WARP=2.7\nPSVERSION_COMP=abc\n'), { preset: 201, warp: 2, comp: 2 });
});

test('aşama: metin + sürüm shader, sürüm tek başına üretilen, sürüm 0 sabit', () => {
  const plan = (text) => { const p = M.stagePlan(M.parseMilk(text)); return p.warp + '/' + p.comp; };
  const W = 'warp_1=`shader_body { ret = 1; }\n';
  const C = 'comp_1=`shader_body { ret = 1; }\n';
  assert.strictEqual(plan('MILKDROP_PRESET_VERSION=201\n[preset00]\n' + W + C), 'shader/shader');
  assert.strictEqual(plan('MILKDROP_PRESET_VERSION=201\n[preset00]\n'), 'generated/generated');
  assert.strictEqual(plan('MILKDROP_PRESET_VERSION=201\nPSVERSION_WARP=0\nPSVERSION_COMP=0\n[preset00]\n' + W + C), 'fixed/fixed');
  // MilkDrop 1 dosyasındaki shader metni okunmuyor
  assert.strictEqual(plan('[preset00]\n' + W + C), 'fixed/fixed');
  assert.strictEqual(plan('MILKDROP_PRESET_VERSION=201\nPSVERSION_COMP=0\n[preset00]\n' + W), 'shader/fixed');
});

// ---------------------------------------------------- üretilen shader'lar

test('üretilen warp: decay gömülü, float olarak yuvarlanmış; sarma bayrağı örnekleyiciyi seçiyor', () => {
  const t = M.genWarpText(M.parseMilk('fDecay=0.975\nbTexWrap=0\n').params);
  /* MilkDrop decay'i 32 bit float okuyor: 0,975 orada 0,97500002 ve
     "%.2f" 0,98 yazıyor (double 0,97 olurdu). */
  assert.match(t, /ret \*= 0\.98;/);
  assert.match(t, /tex2D\(sampler_fc_main, uv\)/);
  assert.match(M.genWarpText({}), /tex2D\(sampler_main, uv\)[\s\S]*ret \*= 0\.98;/, 'varsayılanlar: sarma açık, 0,98');
  for (const text of [t, M.genWarpText({})]) {
    const r = S.translate(text, { stage: 'warp' });
    assert.deepStrictEqual(r.hard, []);
    assert.deepStrictEqual(r.soft, []);
  }
});

test('üretilen birleştirme: yankı, gama, ton ve bayraklar shader biçimleriyle ve sırasıyla', () => {
  const gen = (hdr) => M.genCompText(M.parseMilk(hdr).params);
  // Yankı yok, gama varsayılanı 2
  assert.match(gen(''), /ret = tex2D\(sampler_main, uv\)\.xyz;\s*ret \*= 2\.00;/);
  // Yankı: yakınlaşmanın tersi %.3f, saydamlık %.2f; yön 5 iki ekseni de çeviriyor (% 4 yok)
  const e = gen('fVideoEchoAlpha=0.35\nfVideoEchoZoom=2\nnVideoEchoOrientation=5\nfGammaAdj=1.5\n');
  assert.match(e, /uv_echo = \(uv - 0\.5\)\*0\.500\*float2\(-1,-1\) \+ 0\.5;/);
  assert.match(e, /tex2D\(sampler_main, uv_echo\)\.xyz, 0\.35\);\s*ret \*= 1\.50;/);
  assert.match(gen('fVideoEchoAlpha=0.5\nnVideoEchoOrientation=-1\n'), /float2\(-1,1\)/);
  assert.match(gen('fVideoEchoAlpha=0.5\nnVideoEchoOrientation=2\n'), /float2\(1,-1\)/);
  // Ton: 1 ve üstü tam çarpan, arası karışım
  assert.match(gen('fShader=1\n'), /ret \*= hue_shader;/);
  assert.match(gen('fShader=0.4\n'), /ret \*= 0\.60 \+ 0\.40\*hue_shader;/);
  assert.ok(!/hue_shader/.test(gen('fShader=0.0005\n')));
  // Bayraklar SHADER biçimleriyle ve bu sırayla
  const f = gen('bBrighten=1\nbDarken=1\nbSolarize=1\nbInvert=1\n');
  const order = ['ret = sqrt(ret);', 'ret *= ret;', 'ret = ret*(1-ret)*4;', 'ret = 1 - ret;'].map((s) => f.indexOf(s));
  assert.ok(order.every((i) => i > 0), f);
  assert.deepStrictEqual(order.slice().sort((a, b) => a - b), order, 'sıra değişmiş');
  for (const text of [gen(''), e, f, gen('fShader=0.4\nfVideoEchoAlpha=0.2\n')]) {
    const r = S.translate(text, { stage: 'comp' });
    assert.deepStrictEqual(r.hard, [], text);
  }
});

// -------------------------------------------------- sabit yolun kuralları

test('sabit yol yankı yönü: (int)x % 4, C işaret kuralıyla', () => {
  const cases = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 0], [5, 1], [6, 2], [7, 3], [1.7, 1], [2.9, 2],
    [-1, 1], [-2, 0], [-3, 1], [-4, 0], [-5, 1], [-0.5, 0], [NaN, 0], [undefined, 0]];
  for (const [v, want] of cases) assert.strictEqual(M.echoFlipBits(v), want, String(v));
});

test('sabit yol gaması: yankıyla birlikte 1\'in altı uygulanmıyor', () => {
  const on = (g) => M.fixedGammaGain(g, true);
  const off = (g) => M.fixedGammaGain(g, false);
  assert.strictEqual(on(0.5), 1);
  assert.strictEqual(on(0), 1);
  assert.strictEqual(on(1), 1);
  assert.strictEqual(on(1.00005), 1, 'kırpma sınırı 1,0001');
  assert.strictEqual(on(1.5), 1.5);
  assert.strictEqual(on(2), 2);
  assert.strictEqual(off(0.5), 0.5);
  assert.strictEqual(off(0), 0, 'yankısız gama 0 siyah');
  assert.strictEqual(off(2), 2);
});

// ------------------------------------------------------- varsayılanlar

test('dosyanın yazmadığı yerleşik adlarda MilkDrop\'un varsayılanı; uyum kapalıyken eski taban', () => {
  const src = 'fWaveScale=1\nper_frame_1=monitor = 1;';
  const acc = new M.Preset(src, { seed: 1 });
  acc.frame({ time: 0, frame: 0 });
  const want = { decay: 0.98, gamma: 2, echo_zoom: 2, wave_a: 0.8, mv_l: 0.9, mv_x: 12, mv_y: 9,
    ib_r: 0.25, ob_size: 0.01, warp: 1, mv_a: 0, wave_brighten: 1 };
  for (const k of Object.keys(want)) assert.strictEqual(acc.get(k), want[k], k);
  const legacy = new M.Preset(src, { seed: 1, accurate: false });
  legacy.frame({ time: 0, frame: 0 });
  assert.strictEqual(legacy.get('decay'), 0, 'eski taban: 0');
  assert.strictEqual(legacy.get('gamma'), 0);
  assert.strictEqual(legacy.get('wave_a'), 1);
});

test('dosyanın yazdığı değer varsayılanın önünde; mv_a bMotionVectorsOn\'dan da geliyor', () => {
  const p = new M.Preset('fDecay=0.5\nfGammaAdj=1\nfWaveAlpha=0.3\nbMotionVectorsOn=1\nwave_a=0.6\n', { seed: 1 });
  p.frame({ time: 0, frame: 0 });
  assert.strictEqual(p.get('decay'), 0.5);
  assert.strictEqual(p.get('gamma'), 1);
  assert.strictEqual(p.get('mv_a'), 1);
  /* MilkDrop başlıkta `fWaveAlpha`yı okuyor; `wave_a` yalnız denklem adı,
     başlıkta okunmuyor (state.cpp). Başlık adı kazanıyor. */
  assert.strictEqual(p.get('wave_a'), 0.3, 'başlık adı fWaveAlpha kazanmalı');
});

test('init de MilkDrop\'un varsayılanlarını görüyor', () => {
  // MilkDrop init'ten önce yerleşik adları yüklüyor (LoadPerFrameEvallibVars)
  const p = new M.Preset('per_frame_init_1=q1 = decay + gamma;', { seed: 1 });
  p.frame({ time: 0, frame: 0 });
  assert.ok(Math.abs(p.get('q1') - 2.98) < 1e-12, String(p.get('q1')));
});

test('merkez 0 geçerli: cx/cy 0 köşede kalıyor; sx/sy ve zoom 0 korumada', () => {
  const p = new M.Preset('cx=0\ncy=0\nsx=0\nzoom=0\n', { seed: 1 });
  p.frame({ time: 0, frame: 0 });
  const b = p.captureBase();
  assert.strictEqual(b.cx, 0);
  assert.strictEqual(b.cy, 0);
  assert.strictEqual(b.sx, 1, 'sıfıra bölme: koruma kalıyor');
  assert.strictEqual(b.zoom, 1);
  const legacy = new M.Preset('cx=0\ncy=0\n', { seed: 1, accurate: false });
  legacy.frame({ time: 0, frame: 0 });
  assert.strictEqual(legacy.captureBase().cx, 0.5, 'uyum kapalıyken eski davranış');
});

/* MilkDrop'un dosyadan OKUDUĞU anahtarlar (state.cpp CState::Import
   1328-1463, CWave::Import 1203-1221, CShape::Import 1243-1274). Okuma
   büyük/küçük harfe duyarlı; kod satırları önek + 1'den başlayan satır
   numarası ve ilk eksik numarada duruyor (ReadCode, 1073). Listede
   olmayan bir satır MilkDrop'ta hiç okunmuyor: yerleşikler ve üretici
   dalga saydamlığını `wave_a` diye yazıyordu, MilkDrop'ta o presetler
   dalgayı varsayılan 0,8'le çiziyordu. */
const MD2_KEYS = new Set([
  'MILKDROP_PRESET_VERSION', 'PSVERSION', 'PSVERSION_WARP', 'PSVERSION_COMP',
  'fRating', 'fDecay', 'fGammaAdj', 'fVideoEchoZoom', 'fVideoEchoAlpha', 'nVideoEchoOrientation',
  'bRedBlueStereo', 'bBrighten', 'bDarken', 'bSolarize', 'bInvert', 'fShader',
  'b1n', 'b2n', 'b3n', 'b1x', 'b2x', 'b3x', 'b1ed',
  'nWaveMode', 'bAdditiveWaves', 'bWaveDots', 'bWaveThick', 'bModWaveAlphaByVolume',
  'bMaximizeWaveColor', 'fWaveAlpha', 'fWaveScale', 'fWaveSmoothing', 'fWaveParam',
  'fModWaveAlphaStart', 'fModWaveAlphaEnd', 'wave_r', 'wave_g', 'wave_b', 'wave_x', 'wave_y',
  'nMotionVectorsX', 'nMotionVectorsY', 'mv_dx', 'mv_dy', 'mv_l', 'mv_r', 'mv_g', 'mv_b',
  'bMotionVectorsOn', 'mv_a',
  'zoom', 'rot', 'cx', 'cy', 'dx', 'dy', 'warp', 'sx', 'sy', 'bTexWrap', 'bDarkenCenter',
  'fWarpAnimSpeed', 'fWarpScale', 'fZoomExponent',
  'ob_size', 'ob_r', 'ob_g', 'ob_b', 'ob_a', 'ib_size', 'ib_r', 'ib_g', 'ib_b', 'ib_a',
]);
const MD2_WAVE_KEYS = ['enabled', 'samples', 'sep', 'bSpectrum', 'bUseDots', 'bDrawThick',
  'bAdditive', 'scaling', 'smoothing', 'r', 'g', 'b', 'a'];
const MD2_SHAPE_KEYS = ['enabled', 'sides', 'additive', 'thickOutline', 'textured', 'num_inst',
  'x', 'y', 'rad', 'ang', 'tex_ang', 'tex_zoom', 'r', 'g', 'b', 'a', 'r2', 'g2', 'b2', 'a2',
  'border_r', 'border_g', 'border_b', 'border_a'];
const MD2_CODE = /^(per_frame_init_|per_frame_|per_pixel_|warp_|comp_|wave_[0-3]_(?:init|per_frame|per_point)|shape_[0-3]_(?:init|per_frame))([1-9]\d*)$/;
function md2Reads(key) {
  if (MD2_KEYS.has(key) || MD2_CODE.test(key)) return true;
  const w = /^wavecode_[0-3]_(\w+)$/.exec(key);
  if (w) return MD2_WAVE_KEYS.includes(w[1]);
  const s = /^shapecode_[0-3]_(\w+)$/.exec(key);
  return !!s && MD2_SHAPE_KEYS.includes(s[1]);
}

test('kendi presetlerimiz yalnız MilkDrop\'un okuduğu anahtarları, birer kez ve boşluksuz yazıyor', () => {
  const B = require('../src/shared/presets-milkdrop.js');
  const G = require('../src/shared/milkdrop-generator.js');
  const X = require('../src/shared/milkdrop-mashup.js');
  const texts = B.map((p) => [p.id, p.source]);
  for (let i = 0; i < 64; i++) {
    const r = G.generate({ energy: (i * 37) % 101, warmth: (i * 53) % 101,
      density: (i * 71) % 101, motion: (i * 89) % 101, seed: i * 7919 });
    texts.push([r.code, r.source]);
  }
  // Karışımlar: satırlar vericilerden olduğu gibi, sürüm satırları yeniden
  const own = texts.length;
  for (let i = 0; i < 30; i++) {
    const d = {};
    X.SLOTS.forEach((slot, k) => { d[slot] = texts[(i + k * 7) % own][1]; });
    texts.push(['karışım ' + i, X.compose(d)]);
  }
  let checked = 0;
  for (const [id, text] of texts) {
    const seen = new Set();
    const code = new Map();
    for (const line of text.split(/\r?\n/)) {
      if (line === '' || line.startsWith('[')) continue;
      assert.ok(!/^\s/.test(line), id + ': girintili satır MilkDrop\'ta okunmuyor: ' + line);
      const eq = line.indexOf('=');
      assert.ok(eq > 0, id + ': anahtarsız satır: ' + line);
      const key = line.slice(0, eq);
      assert.ok(md2Reads(key), id + ': MilkDrop bu anahtarı okumuyor: ' + key);
      assert.ok(!seen.has(key), id + ': anahtar iki kez (MilkDrop ilkini okuyor): ' + key);
      seen.add(key);
      const c = MD2_CODE.exec(key);
      if (c) code.set(c[1], (code.get(c[1]) || []).concat(+c[2]));
      checked++;
    }
    for (const [prefix, nums] of code) {
      const sorted = nums.slice().sort((a, b) => a - b);
      sorted.forEach((n, k) => assert.strictEqual(n, k + 1, id + ': ' + prefix + ' numarasında boşluk'));
    }
  }
  assert.ok(texts.length === 5 + 64 + 30 && checked > 10000, 'yeterince satır denetlendi: ' + checked);
});

// ----------------------------------------------------------------- motor

function engine() {
  const canvas = () => ({ width: 320, height: 240, getContext: (k) => (k === '2d' ? {} : null), addEventListener() {} });
  const ctx = { window: {}, document: { createElement: canvas }, console, performance };
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  for (const f of ['src/shared/milkdrop.js', 'src/shared/milkdrop-hlsl.js', 'src/shared/milkdrop-shader.js', 'src/visualizer/modes/milkdrop.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  const gl = new Proxy({}, {
    get(_, k) {
      const name = String(k);
      if (name === 'getExtension') return () => null;
      if (/^[A-Z_0-9]+$/.test(name)) return name;
      if (/^create/.test(name)) return () => ({ id: name });
      if (name === 'getProgramParameter' || name === 'getShaderParameter') return () => true;
      if (name === 'getUniformLocation') return (_p, u) => u;
      return () => undefined;
    },
  });
  const m = new ctx.window.SVModes.milkdrop(canvas());
  m.gl = gl;
  return { m, M: ctx.window.SVMilkdrop };
}

test('motor: uyum açıkken aşamayı sürüm seçiyor, kapalıyken metin', () => {
  const { m } = engine();
  const md1 = '[preset00]\nwarp_1=`shader_body { ret = tex2D(sampler_main, uv).xyz; }\n';
  m._wantAcc = true;
  const a = m._beginStages(md1);
  assert.strictEqual(a.acc, true);
  assert.strictEqual(a.warp, null, 'MilkDrop 1 dosyasının shader metni okunmamalı');
  m._wantAcc = false;
  const b = m._beginStages(md1);
  assert.strictEqual(b.acc, false);
  assert.ok(b.warp && b.warp.text, 'uyum kapalıyken eski kural: metin varsa shader');
  // Sürümü var, metni yok: üretilen shader derleniyor
  m._wantAcc = true;
  const g = m._beginStages('MILKDROP_PRESET_VERSION=201\n[preset00]\nfDecay=0.9\n');
  assert.ok(g.warp && /ret \*= 0\.90;/.test(g.warp.text), 'üretilen warp');
  assert.ok(g.comp && /ret \*= 2\.00;/.test(g.comp.text), 'üretilen birleştirme');
});

test('motor: geçişte yönü farklı iki yankı sönüp yeniden beliriyor', () => {
  const { m, M: MM } = engine();
  m._wantAcc = true;
  const mk = (orient, alpha) => {
    const p = new MM.Preset('fVideoEchoAlpha=' + alpha + '\nnVideoEchoOrientation=' + orient + '\nfVideoEchoZoom=1\nfGammaAdj=1\n', { seed: 1 });
    p.frame({ time: 0, frame: 0 });
    return p;
  };
  m.preset = mk(2, 0.5);
  m.oldPreset = mk(1, 0.5);
  m.compPreset = null;
  m.oldCompPreset = null;
  const ci = (p) => 0.5 - 0.5 * Math.cos(Math.PI * p);
  m.blendProg = 0.25;
  let f = m._fixedCompInputs(m.preset);
  assert.strictEqual(f.orient, 1, 'atlama noktasından önce eski yön');
  assert.ok(Math.abs(f.alpha - 0.5 * (1 - 2 * ci(0.25))) < 1e-12, String(f.alpha));
  m.blendProg = 0.75;
  f = m._fixedCompInputs(m.preset);
  assert.strictEqual(f.orient, 2, 'sonra yeni yön');
  assert.ok(Math.abs(f.alpha - 0.5 * (2 * ci(0.75) - 1)) < 1e-12, String(f.alpha));
  // Yarı yolda yankı tamamen sönmüş: yön bir anda dönmüyor
  m.blendProg = 0.5;
  assert.ok(Math.abs(m._fixedCompInputs(m.preset).alpha) < 1e-12);
  // Bir tarafın dosyasında yankı yoksa sönüm yok
  m.oldPreset = mk(1, 0);
  m.blendProg = 0.25;
  f = m._fixedCompInputs(m.preset);
  assert.strictEqual(f.alpha, 0.5);
  assert.strictEqual(f.orient, 2);
  // Geçiş yokken yön (int) % 4
  m.oldPreset = null;
  m.preset = mk(5, 0.5);
  assert.strictEqual(m._fixedCompInputs(m.preset).orient, 1);
});

test('sabit birleştirme shader\'ı: MilkDrop 2 biçimleri anahtarın arkasında', () => {
  const code = bare(read('src/visualizer/modes/milkdrop.js'));
  assert.match(code, /if \(uFx\.x > 0\.5\) c = uFxMd2 > 0\.5 \? 1\.0 - \(1\.0 - c\) \* \(1\.0 - c\) : sqrt\(c\);/);
  assert.match(code, /if \(uFx\.z > 0\.5\) c = uFxMd2 > 0\.5 \? 2\.0 \* c \* \(1\.0 - c\) : c \* \(1\.0 - c\) \* 4\.0;/);
  assert.match(code, /if \(uFx\.y > 0\.5\) c = c \* c;/);
  assert.match(code, /if \(uFx\.w > 0\.5\) c = 1\.0 - c;/);
  assert.match(code, /gl\.uniform1f\(this\.locComp\.uFxMd2, acc \? 1 : 0\);/);
  // Sabit geçiş uyum açıkken girdilerini MilkDrop'un kuralından alıyor
  assert.match(code, /const acc = this\._wantAcc !== false;\s*if \(acc\) \{\s*const f = this\._fixedCompInputs\(Pp\);/);
  assert.match(code, /gl\.uniform1i\(this\.locComp\.uEchoOrient, f\.orient\);/);
  assert.match(code, /gl\.uniform1f\(this\.locComp\.uGamma, f\.gain\);/);
});
