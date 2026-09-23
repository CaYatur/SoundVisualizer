'use strict';
/* DÖRT KÖŞE RENGİ VE `fShader` (#560, düzeltme #580).
 *
 * MilkDrop her kare dört köşe için ayrı fazlarla bir renk hesaplıyor ve iki
 * yolda iki ayrı şekilde kullanıyor:
 *  - SHADER'LI YOL: `hue_shader`a HER ZAMAN tam renk gidiyor, `fShader` ne
 *    olursa olsun ("shader kullanıyor mu bilmiyoruz", milkdropfs.cpp:4122;
 *    BeatDrop'un D3D9 hâli 4318 aynı). `fShader` yalnız MilkDrop'un kendi
 *    yazdığı birleştirme metninde çarpan.
 *  - SABİT YOL: renk beyaza doğru presetin `fShader` oranıyla karışıyor ve
 *    oran 0,001'in altındaysa hiç hesaplanmıyor — köşeler beyaz
 *    (milkdropfs.cpp:3857-3884). Oran dosyadaki değer, geçişte doğrusal
 *    karışıyor (CBlendableFloat); kenetlenmiyor.
 *
 * 52c7391 (#560) sabit yolun kuralını shader'lı yola da uyguluyordu:
 * korpusta `hue_shader` okuyan 1.239 presetin 914'ü `fShader`ı sıfır
 * bırakıyor ve rengini kaybediyordu, 36'sı rengin yalnız bir kısmını
 * alıyordu.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(root, 'src/visualizer/modes/milkdrop.js'), 'utf-8');

function method(sig) {
  const i = SRC.indexOf('    ' + sig + ' {');
  assert.ok(i > 0, sig + ' bulunamadı');
  const end = SRC.indexOf('\n    }', i);
  return SRC.slice(i, end + 6);
}
const body = (src) => src.slice(src.indexOf('{') + 1, src.lastIndexOf('}'));

// Köşe rengi yöntemi kaynaktan
const hueCorners = new Function('amt', 't', 'rand', body(method('_hueCorners(amt, t, rand)')));
const fileVal = new Function('key', 'dflt', body(method('_fileVal(key, dflt)')));

/* Motorun kendi uniform yükleyicisini koşturur ve `hue_corner`a yazılan
   on iki sayıyı döndürür. Yalnız o uniform'un konumu verildiği için
   ötekilerin hepsi `if (L[n])` denetiminden geçemiyor ve atlanıyor. */
function corners(opts) {
  /* Modül kapsamındaki sabit de kaynaktan geliyor: yükleyicinin ilk
     döngüsü onu geziyor. */
  const units = /const SAMPLER_UNITS = \[[\s\S]*?\];/.exec(SRC)[0];
  const fn = new Function('L', 'ctx', units + String.fromCharCode(10) + body(method('_setPresetUniforms(L, ctx)')));
  let got = null;
  const gl = new Proxy({}, {
    get(_, k) {
      if (k === 'uniform3fv') return (loc, v) => { if (loc === 'HC') got = Array.from(v); };
      if (typeof k === 'string' && /^[A-Z_0-9]+$/.test(k)) return 1;
      return () => {};
    },
  });
  const size = { size: 256 };
  const self = {
    gl,
    _wantAcc: opts.acc !== false,
    noise: { lq: size, mq: size, hq: size, lqLite: size, volLq: size, volHq: size },
    _texSizeFor: () => [1, 1, 1, 1],
    _rotRows: () => new Float32Array(12),
    _blurScaleBias: () => [1, 0],
    _hueCorners: hueCorners,
    blur: [],
    preset: null,
  };
  const L = { hue_corner: 'HC', _plan: [], _texSize: [], _rot: [] };
  // Presetin hem dosyası hem havuzu fShader'ı taşıyor; shader yolu ikisine de bakmamalı
  const P = { get: (k) => (k === 'fshader' ? opts.fshader : 0), file: { params: { fshader: opts.fshader } } };
  const ctx = {
    w: 960, h: 720, aspectx: 1, aspecty: 0.75, aspX: 1, aspY: 0.75,
    time: opts.time === undefined ? 12.5 : opts.time,
    fps: 30, frame: 100, progress: 0.25, presetTime: 12.5,
    P, rand: [0.1, 0.2, 0.3, 0.4],
    bass: 1, mid: 1, treb: 1, bass_att: 1, mid_att: 1, treb_att: 1, vol: 1, vol_att: 1,
  };
  fn.call(self, L, ctx);
  assert.ok(got, 'hue_corner yazılmadı');
  return got;
}

// ------------------------------------------------------------ shader yolu

test('shader yolu: fShader ne olursa olsun tam renk', () => {
  const full = corners({ fshader: 1 });
  assert.ok(full.some((v) => v < 0.999), 'renk yok');
  for (const v of [0, 0.0005, undefined, -1, 0.5, 10]) {
    assert.deepStrictEqual(corners({ fshader: v }), full, 'fShader = ' + v);
  }
});

test('shader yolu: köşeler birbirinden farklı ve en parlak bileşen 1 ile ölçekli', () => {
  const hc = corners({ fshader: 0 });
  const c = [0, 1, 2, 3].map((i) => hc.slice(i * 3, i * 3 + 3));
  assert.ok(c.some((v, i) => i > 0 && v.some((x, k) => Math.abs(x - c[0][k]) > 1e-6)),
    'dört köşe aynı renk');
  for (const v of c) {
    // 0,5 + 0,5·(x/max): en büyük bileşen 1, hiçbiri 0,5'in altında değil
    assert.ok(Math.abs(Math.max(...v) - 1) < 1e-6, 'en parlak bileşen 1 değil: ' + v);
    assert.ok(Math.min(...v) >= 0.5 - 1e-6, 'bileşen 0,5 altında: ' + v);
  }
});

test('uyum kapalıyken eski tek renk duruyor', () => {
  const hc = corners({ acc: false, fshader: 0 });
  const t = 12.5;
  const want = [0.5 + 0.5 * Math.sin(t * 0.31), 0.5 + 0.5 * Math.sin(t * 0.31 + 2.09),
    0.5 + 0.5 * Math.sin(t * 0.31 + 4.19)];
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(hc[i * 3 + k] - want[k]) < 1e-6, 'eski köşe ' + i + ' bileşen ' + k);
    }
  }
});

// -------------------------------------------------------------- sabit yol

const hue = (amt) => Array.from(hueCorners.call({ _wantAcc: true, randPreset: [0.1, 0.2, 0.3, 0.4] },
  amt, 12.5, [0.1, 0.2, 0.3, 0.4]));

test('sabit yolun oranı: 0,001 ve altı beyaz, ara değer beyaza karışıyor, 1\'in üstü kenetlenmiyor', () => {
  for (const v of [0, 0.0005, 0.001, -1, NaN, undefined]) {
    assert.deepStrictEqual(hue(v), new Array(12).fill(1), 'oran ' + v);
  }
  const full = hue(1);
  const half = hue(0.5);
  const ten = hue(10);
  for (let i = 0; i < 12; i++) {
    assert.ok(Math.abs(half[i] - (full[i] * 0.5 + 0.5)) < 1e-6, 'yarı oran, bileşen ' + i);
    assert.ok(Math.abs(ten[i] - (full[i] * 10 - 9)) < 1e-4, 'oran 10, bileşen ' + i);
  }
  // Oran 10'da renk 0,5'in altına, eksiye iniyor — COLOR_NORM onu sarıyor
  assert.ok(ten.some((v) => v < 0), 'oran 10 kenetlenmiş');
});

test('sabit yolun oranı dosyadan: denklemin yazdığı fshader MilkDrop\'a ulaşmıyor', () => {
  // Havuz 1 diyor (denklem yazmış), dosya 0,4
  const P = { get: () => 1, file: { params: { fshader: 0.4 } } };
  assert.strictEqual(fileVal.call({ preset: P, oldPreset: null, blendProg: 1 }, 'fshader', 0), 0.4);
  const bos = { get: () => 1, file: { params: {} } };
  assert.strictEqual(fileVal.call({ preset: bos, oldPreset: null, blendProg: 1 }, 'fshader', 0), 0,
    'yazılmamışsa MilkDrop\'un varsayılanı');
});

test('sabit yolun oranı geçişte eski ve yeni dosya değeri arasında doğrusal', () => {
  const mk = (v) => ({ file: { params: { fshader: v } } });
  const self = { preset: mk(0), oldPreset: mk(1), blendProg: 0.25 };
  assert.ok(Math.abs(fileVal.call(self, 'fshader', 0) - 0.75) < 1e-12, 'kosinüs değil, ham ilerleme');
  self.blendProg = 1;
  assert.strictEqual(fileVal.call(self, 'fshader', 0), 0, 'geçiş bitti');
  self.blendProg = 0.5;
  self.oldPreset = { file: { params: {} } };
  assert.ok(Math.abs(fileVal.call(Object.assign({}, self, { preset: mk(1) }), 'fshader', 0) - 0.5) < 1e-12,
    'eski tarafta yazılmamış: varsayılandan');
});

/* Sabit birleştirme yolu: ton rengi dosyadaki orandan, köşe ağırlıklarına
   çevrilerek (çizim başına COLOR_NORM). Uyum kapalıyken renk hiç
   hesaplanmıyor — eski sabit yol rengi uygulamıyordu. */
test('sabit birleştirme yolu köşe rengini ağırlıklarla dörtgene uyguluyor', () => {
  const frag = /const COMP_FIXED_FRAG = `([\s\S]*?)`;/.exec(SRC)[1];
  assert.match(frag, /uniform vec3 uWMain\[4\];/);
  assert.match(frag, /uniform vec3 uWEcho\[4\];/);
  assert.doesNotMatch(frag, /uHue/, 'eski tek çarpanlı renk kalmamalı');

  const pass = method('_drawCompPass(gl, dst, prog, ctx)');
  const acc = /if \(acc\) \{([\s\S]*?)\} else \{([\s\S]*?)\}\s*gl\.uniform4f/.exec(pass);
  assert.ok(acc, 'uyum dalları bulunamadı');
  assert.match(acc[1], /this\._hueCorners\(this\._fileVal\('fshader', 0\), this\.time, this\.randPreset\)/);
  assert.doesNotMatch(acc[2], /_hueCorners/, 'uyum kapalıyken renk yok');
});
