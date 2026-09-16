'use strict';
/* HUE_SHADER'IN MİKTARI: presetin `fShader` ayarı (#560).
 *
 * MilkDrop dört köşe rengini hesapladıktan sonra beyaza doğru `fShader`
 * oranıyla karıştırıyor, ve oran 0,001'in altındaysa rengi hiç
 * hesaplamıyor — dört köşe de (1,1,1) kalıyor (milkdropfs.cpp:3857-3876).
 * Varsayılan 0 (state.cpp:548). Motor rengi HER presete veriyordu.
 *
 * Korpusta comp shader'ında `hue_shader` okuyan 1.239 preset var (%12,0);
 * bunların 914'ü `fShader`ı sıfır bırakıyor, 36'sı ara bir oran yazıyor.
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
    // köşe renkleri ayrı bir yöntemde; o da kaynaktan geliyor
    _hueCorners: new Function('P', 't', 'rand', body(method('_hueCorners(P, t, rand)'))),
    blur: [],
    preset: null,
  };
  const L = { hue_corner: 'HC', _plan: [], _texSize: [], _rot: [] };
  const P = { get: (k) => (k === 'fshader' ? opts.fshader : 0) };
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

test('fShader sıfırken dört köşe de beyaz', () => {
  for (const v of [0, 0.0005, undefined, -1]) {
    const hc = corners({ fshader: v });
    assert.deepStrictEqual(hc, new Array(12).fill(1), 'fShader = ' + v);
  }
});

test('fShader 1 iken tam renk, ara değerde beyaza karışıyor', () => {
  const full = corners({ fshader: 1 });
  const half = corners({ fshader: 0.5 });
  assert.ok(full.some((v) => v < 0.999), 'tam oranda renk yok');
  for (let i = 0; i < 12; i++) {
    // yarı oran: tam rengin beyazla ortası
    assert.ok(Math.abs(half[i] - (full[i] * 0.5 + 0.5)) < 1e-6, 'köşe ' + i);
    assert.ok(half[i] >= full[i] - 1e-9, 'yarı oran daha koyu çıktı');
  }
});

test('köşeler birbirinden farklı ve en parlak bileşen 1 ile ölçekli', () => {
  const hc = corners({ fshader: 1 });
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

/* SABİT birleştirme yolu da aynı renkleri uyguluyor: MilkDrop tam ekran
   dörtgenini bu dört renkle çiziyor (milkdropfs.cpp:3940-3946). Motorda o
   yol rengi hiç uygulamıyordu; comp shader'ı olmayan 2.129 presetin 631'i
   sıfırdan büyük bir fShader yazıyor. */
test('sabit birleştirme yolu köşe renklerini ekran boyunca uyguluyor', () => {
  const frag = /const COMP_FIXED_FRAG = `([\s\S]*?)`;/.exec(SRC)[1];
  assert.match(frag, /uniform vec3 uHue\[4\];/);
  // Alt satır 2-3, üst satır 0-1: dörtgenin köşe sırası
  assert.match(frag, /c \*= mix\(mix\(uHue\[2\], uHue\[3\], vUV\.x\), mix\(uHue\[0\], uHue\[1\], vUV\.x\), vUV\.y\);/);
  // Gama çarpanından ÖNCE: MilkDrop rengi katmana uygulayıp sonra gama için
  // katmanı yeniden çiziyor
  assert.ok(frag.indexOf('uHue[2]') < frag.indexOf('c *= uGamma;'), 'renk gamadan sonra uygulanıyor');

  const pass = method('_drawCompPass(gl, dst, prog, ctx)');
  assert.match(pass, /this\._hueCorners\(Pp, this\.time, this\.randPreset\)/);
  assert.match(pass, /new Float32Array\(12\)\.fill\(1\)/);  // uyum kapalıyken beyaz
});
