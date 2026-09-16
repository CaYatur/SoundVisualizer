'use strict';
/* VARSAYILAN DALGANIN KİPLERİ (#560).
 *
 * Kaynak milkdropfs.cpp:2666-3035 (jecassis/foo_vis_milk2 5b44cea). Kipler
 * hangi kanalı okuduklarında ve kaç çizgi çizdiklerinde birbirinden
 * ayrılıyor; motor bunların bir kısmını tek bir "iki kanalın ortalaması,
 * çift çizgi" davranışına indirmişti:
 *   - kip 0 (çember, korpusun %28,6'sı) SAĞ kanalı okuyor, ortalamayı değil;
 *   - kip 4 (yatay "el yazısı", %4,8) Y'yi SOL kanaldan alıyor, X'i sağdan;
 *   - kip 6 (%7,3) TEK çizgi, kip 7 (%25,6) iki çizgi.
 *
 * Testler motorun kendi `_drawWaveModes` gövdesini sahte bir `this` ile
 * ÇALIŞTIRIYOR ve çıkan tepe noktalarını kaynaktan elle türetilmiş
 * değerlerle karşılaştırıyor; böylece "kod şu satırı içeriyor" değil
 * "şu noktayı çiziyor" sınanıyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(root, 'src/visualizer/modes/milkdrop.js'), 'utf-8');
const MD = require('../src/shared/milkdrop.js');

// Bir sınıf yönteminin gövdesini kaynaktan söker (girintiye göre)
function method(sig) {
  const i = SRC.indexOf('    ' + sig + ' {');
  assert.ok(i > 0, sig + ' bulunamadı');
  const end = SRC.indexOf('\n    }', i);
  assert.ok(end > i, sig + ' sonu bulunamadı');
  return SRC.slice(i, end + 6);
}
const body = (src) => src.slice(src.indexOf('{') + 1, src.lastIndexOf('}'));

const glStub = new Proxy({}, {
  get(_, k) {
    if (typeof k === 'string' && /^[A-Z_0-9]+$/.test(k)) return k;
    return () => {};
  },
});

/* Motorun `_drawWaveModes`ini koşturur ve çizilen tepe noktalarını verir.
   `smoothWave` yerine birebir kopyalayan bir taklit veriliyor: bu test
   noktaların KONUMUNU sınıyor, yumuşatmanın kendisi ayrı test dosyasında. */
function drawWave(opts) {
  const fn = new Function('gl', 'GW', 'GH', 'window', 'smoothWave', body(method('_drawWaveModes(gl, GW, GH)')));
  const vol = new Function('a', body(method('_waveVolAlpha(a)')));
  const vals = Object.assign({
    wave_mode: 0, wave_a: 1, wave_r: 1, wave_g: 1, wave_b: 1, wave_x: 0.5, wave_y: 0.5,
    wave_mystery: 0, wave_brighten: 0, wave_usedots: 0, wave_thick: 0, wave_additive: 0,
    wave_modalpha: 0, wave_modalpha_start: 0, wave_modalpha_end: 1, bass: 1, mid: 1, treb: 1,
  }, opts.vals || {});
  const preset = { get: (k) => vals[k] };
  let got = null;
  const self = {
    _wantAcc: opts.acc !== false,
    preset,
    time: opts.time || 0,
    _fL: opts.L,
    _fR: opts.R,
    lineData: new Float32Array(4096 * 6),
    waveData: new Float32Array(8192 * 6),
    _waveVolAlpha: vol,
    _blend() {},
    _strip(gl, kind, vd, vn, vbreak) { got = { vd, vn, vbreak, kind }; },
  };
  const copy = (src, n, out, from, to) => {
    for (let i = 0; i < n * 6; i++) out[to * 6 + i] = src[from * 6 + i];
    return n;
  };
  fn.call(self, glStub, opts.GW || 1920, opts.GH || 1080, { SVMilkdrop: MD }, copy);
  return got;
}

// i. tepe noktası [x, y]
const pt = (r, i) => [r.vd[i * 6], r.vd[i * 6 + 1]];
// Ayrı iki kanal: sol ve sağ kesinlikle farklı diziler
function chans() {
  const L = new Float32Array(576), R = new Float32Array(576);
  for (let i = 0; i < 576; i++) {
    L[i] = Math.sin(i * 0.11) * 0.5;
    R[i] = Math.cos(i * 0.07) * 0.4;
  }
  return { L, R };
}
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, msg + ': ' + a + ' / ' + b);

// ------------------------------------------------------------------ kip 0

test('kip 0 çemberi sağ kanaldan çiziyor', () => {
  const { L, R } = chans();
  const r = drawWave({ L, R, vals: { wave_mode: 0 } });
  /* MilkDrop: nVerts = 480/2 = 240, sample_offset = (480-240)/2 = 120,
     rad = 0.5 + 0.4 * fR[i + off], ang = i/(n-1) * 6.28 + t*0.2.
     Harmanlanan ilk %10 dışında kalan bir nokta seçiliyor. */
  const n = 240, off = 120, i = 100;
  const rad = 0.5 + 0.4 * R[i + off];
  const ang = i * (1 / (n - 1)) * 6.28;
  const [x, y] = pt(r, i);
  close(x, rad * Math.cos(ang) * (1080 / 1920), 'x');
  close(y, rad * Math.sin(ang), 'y');
  // Çember kapanıyor: son nokta ilkinin kopyası
  assert.strictEqual(r.vn, n + 1);
  assert.deepStrictEqual(pt(r, n), pt(r, 0));
});

test('kip 0 uyum kapalıyken iki kanalın ortalamasını okuyor', () => {
  const { L, R } = chans();
  const r = drawWave({ L, R, acc: false, vals: { wave_mode: 0 } });
  const n = 256, off = 128, i = 100;
  const rad = 0.5 + 0.4 * (L[i + off] + R[i + off]) * 0.5;
  const ang = i * (1 / (n - 1)) * 6.28;
  close(pt(r, i)[0], rad * Math.cos(ang) * (1080 / 1920), 'x');
});

// ------------------------------------------------------------------ kip 4

test('kip 4 Y\'yi sol, X\'i sağ kanaldan alıyor', () => {
  const { L, R } = chans();
  const r = drawWave({ L, R, vals: { wave_mode: 4, wave_mystery: 0 } });
  /* MilkDrop: w1 = 0.45 + 0.5*(myst*0.5+0.5), momentum i > 1'den sonra
     başlıyor; ilk iki nokta ham. x = -1 + 2*i/n + posX + fR[i+25]*0.44,
     y = fL[i]*0.47 + posY. */
  const n = 480;
  for (const i of [0, 1]) {
    const [x, y] = pt(r, i);
    close(x, -1 + 2 * (i / n) + R[i + 25] * 0.44, 'x' + i);
    close(y, L[i] * 0.47, 'y' + i);
  }
});

test('kip 4 uyum kapalıyken Y\'de ortalamayı okuyor', () => {
  const { L, R } = chans();
  const r = drawWave({ L, R, acc: false, vals: { wave_mode: 4 } });
  close(pt(r, 0)[1], 0.5 * (L[0] + R[0]) * 0.47, 'y');
});

// ---------------------------------------------------------------- kip 6/7

test('kip 6 tek çizgi ve yalnız sol kanal', () => {
  const { L, R } = chans();
  const r = drawWave({ L, R, vals: { wave_mode: 6, wave_y: 0.9 } });
  const half = 240, off = 120;
  assert.strictEqual(r.vn, half, 'tek çizgi olmalı');
  assert.strictEqual(r.vbreak, -1, 'kırılma noktası olmamalı');
  /* myst = 0 → ang = 0, dx = 1, dy = 0, kenarlar ±3, adım 6/half.
     Ayırma YOK: tek çizgide MilkDrop sep'i hiç hesaplamıyor. */
  const posX = 0, stepX = 6 / half;
  for (const i of [0, 37, half - 1]) {
    const [x, y] = pt(r, i);
    close(x, posX - 3 + stepX * i, 'x' + i);
    close(y, 0.25 * L[i + off], 'y' + i); // pdx = -dy = 0, pdy = dx = 1 → y = f
  }
});

test('kip 7 iki çizgi, ikincisi sağ kanal ve ters ayırma', () => {
  const { L, R } = chans();
  const r = drawWave({ L, R, vals: { wave_mode: 7, wave_y: 0.9 } });
  const half = 240, off = 120;
  assert.strictEqual(r.vn, half * 2);
  assert.strictEqual(r.vbreak, half);
  const posY = 0.9 * 2 - 1;
  const s = Math.pow(posY * 0.5 + 0.5, 2); // MilkDrop: (wave_y*0.5+0.5)^2
  assert.ok(s > 0.1, 'ayırma sıfır çıkmamalı');
  close(pt(r, 10)[1], 0.25 * L[10 + off] + s, 'ilk çizgi');
  close(pt(r, half + 10)[1], 0.25 * R[10 + off] - s, 'ikinci çizgi');
});

test('kip 6 uyum kapalıyken eski çift çizgiyi çiziyor', () => {
  const { L, R } = chans();
  const r = drawWave({ L, R, acc: false, vals: { wave_mode: 6, wave_y: 0.9 } });
  const half = 256;
  assert.strictEqual(r.vn, half * 2, 'eski yolda iki çizgi');
  assert.strictEqual(r.vbreak, half);
});

// ------------------------------------------------------------------ kayıt

test('kanal okumaları kaynakta da kipe göre ayrışıyor', () => {
  const dw = method('_drawWaveModes(gl, GW, GH)');
  assert.match(dw, /acc \? R\[i \+ off\] : \(L\[i \+ off\] \+ R\[i \+ off\]\) \* 0\.5/);
  assert.match(dw, /acc \? L\[i\] : 0\.5 \* \(L\[i\] \+ R\[i\]\)/);
  assert.match(dw, /const two = mode === 7 \|\| !acc;/);
});
