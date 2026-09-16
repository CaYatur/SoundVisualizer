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
  const modeAlpha = new Function('a', 'mode', 'GW', body(method('_waveModeAlpha(a, mode, GW)')));
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
    _waveModeAlpha: modeAlpha,
    _bands: opts.bands || null,
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
  /* myst = 0 → ang = 0, dx = 1, dy = 0; kenarlar ±3 iken ±1,1'e
     kırpılıyor, adım 2,2/half. Ayırma YOK: tek çizgide MilkDrop sep'i hiç
     hesaplamıyor. */
  const stepX = 2.2 / half;
  for (const i of [0, 37, half - 1]) {
    const [x, y] = pt(r, i);
    assert.ok(Math.abs(x - (-1.1 + stepX * i)) < 1e-4, 'x' + i + ': ' + x);
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

// --------------------------------------------------------------- geometri

test('kip 4 nokta sayısı genişliğin üçte biriyle sınırlı, okuma ortadan', () => {
  const { L, R } = chans();
  // 960 piksel → sınır 320; okuma (480-320)/2 = 80'den başlıyor
  const r = drawWave({ L, R, GW: 960, GH: 720, vals: { wave_mode: 4 } });
  const n = 320, off = 80;
  assert.strictEqual(r.vn, n);
  for (const i of [0, 1]) {
    const [x, y] = pt(r, i);
    close(x, -1 + 2 * (i / n) + R[i + 25 + off] * 0.44, 'x' + i);
    close(y, L[i + off] * 0.47, 'y' + i);
  }
  // 1440 ve üstünde sınır ısırmıyor: 480 nokta, kayma 0
  const wide = drawWave({ L, R, GW: 1440, GH: 900, vals: { wave_mode: 4 } });
  assert.strictEqual(wide.vn, 480);
  close(pt(wide, 0)[1], L[0] * 0.47, 'geniş y0');
});

test('kip 6/7 nokta sayısı da sınırlı ve okuma ortadan', () => {
  const { L, R } = chans();
  // 480 piksel → sınır 160; okuma (480-160)/2 = 160
  const r = drawWave({ L, R, GW: 480, GH: 360, vals: { wave_mode: 6 } });
  assert.strictEqual(r.vn, 160);
  close(pt(r, 3)[1], 0.25 * L[3 + 160], 'y3');
  // 720 ve üstünde 240 nokta kalıyor (240*3 = 720)
  const wide = drawWave({ L, R, GW: 720, GH: 540, vals: { wave_mode: 6 } });
  assert.strictEqual(wide.vn, 240);
});

test('kip 6/7 çizgisi ekrana kırpılıyor ve noktalar kalan parçaya yayılıyor', () => {
  const { L, R } = chans();
  const r = drawWave({ L, R, vals: { wave_mode: 6, wave_x: 0.5, wave_mystery: 0 } });
  const half = 240;
  const first = pt(r, 0)[0], last = pt(r, half - 1)[0];
  assert.ok(Math.abs(first + 1.1) < 1e-4, 'ilk nokta sol kenarda: ' + first);
  assert.ok(last < 1.1 && last > 1.05, 'son nokta sağ kenara yakın: ' + last);
  // Adım: kırpılmış 2,2 uzunluk / nokta sayısı
  close((last - first) / (half - 1), 2.2 / half, 'adım');
});

test('kip 6/7 açılı çizgide kırpma ve dik yön bağımsız hesapla tutuyor', () => {
  const { L, R } = chans();
  const myst = 0.5, posX = 0.6 * 2 - 1;
  const r = drawWave({ L, R, vals: { wave_mode: 6, wave_mystery: myst, wave_x: 0.6 } });
  /* Kaynaktaki kırpma burada BAĞIMSIZ olarak yeniden yazıldı
     (milkdropfs.cpp:2937-2986): iki uç, dört kenara karşı, karşı uç
     çapa alınarak. */
  const ang = 1.57 * myst;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const cx = posX * Math.cos(ang + 1.57), cy = posX * Math.sin(ang + 1.57);
  const ex = [cx - dx * 3, cx + dx * 3], ey = [cy - dy * 3, cy + dy * 3];
  for (let i = 0; i < 2; i++) {
    const o = 1 - i;
    const edges = [
      () => (ex[i] > 1.1 ? (1.1 - ex[o]) / (ex[i] - ex[o]) : null),
      () => (ex[i] < -1.1 ? (-1.1 - ex[o]) / (ex[i] - ex[o]) : null),
      () => (ey[i] > 1.1 ? (1.1 - ey[o]) / (ey[i] - ey[o]) : null),
      () => (ey[i] < -1.1 ? (-1.1 - ey[o]) / (ey[i] - ey[o]) : null),
    ];
    for (const f of edges) {
      const t = f();
      if (t === null) continue;
      const ddx = ex[i] - ex[o], ddy = ey[i] - ey[o];
      ex[i] = ex[o] + ddx * t;
      ey[i] = ey[o] + ddy * t;
    }
  }
  const half = 240, off = 120;
  const stepX = (ex[1] - ex[0]) / half, stepY = (ey[1] - ey[0]) / half;
  const ang2 = Math.atan2(stepY, stepX);
  const pdx = Math.cos(ang2 + 1.57), pdy = Math.sin(ang2 + 1.57);
  for (const i of [0, 91, half - 1]) {
    const f = 0.25 * L[i + off];
    const [x, y] = pt(r, i);
    close(x, ex[0] + stepX * i + pdx * f, 'x' + i);
    close(y, ey[0] + stepY * i + pdy * f, 'y' + i);
  }
  // Kırpma gerçekten işledi: çizginin kendisi ekran sınırında başlıyor
  assert.ok(Math.max(Math.abs(ex[0]), Math.abs(ey[0])) <= 1.1001, 'kırpılmış uç');
  assert.ok(Math.abs(ex[0] - (cx - dx * 3)) > 0.5, 'kırpma hiç olmamış');
});

test('kip 4 ve 6/7 uyum kapalıyken sınırsız ve kaymasız', () => {
  const { L, R } = chans();
  const m4 = drawWave({ L, R, acc: false, GW: 240, GH: 180, vals: { wave_mode: 4 } });
  assert.strictEqual(m4.vn, 512, 'eski yolda sınır yok');
  close(pt(m4, 0)[1], 0.5 * (L[0] + R[0]) * 0.47, 'eski y0');
  const m6 = drawWave({ L, R, acc: false, GW: 240, GH: 180, vals: { wave_mode: 6 } });
  assert.strictEqual(m6.vn, 512, 'eski yolda çift çizgi ve sınır yok');
  close(pt(m6, 0)[0], -3, 'eski çizgi ±3 arasında');
});

// ------------------------------------------------------------------- alfa

// Çizilen alfa: tepe verisinin 6. bileşeni
const alphaOf = (r) => r.vd[5];

test('alfa sırası: önce kipin çarpanı, sonra sesle değiştirme ve kenetleme', () => {
  const { L, R } = chans();
  /* MilkDrop: alpha = wave_a * kip çarpanı, sonra kenetleme. wave_a = 2 ve
     kip 2, 512 piksel → 2 * 0,09 = 0,18. Motor önce kenetleyip (1) sonra
     çarptığı için 0,09 çiziyordu. */
  const r = drawWave({ L, R, GW: 512, GH: 384, vals: { wave_mode: 2, wave_a: 2 } });
  close(alphaOf(r), MD.colorNorm(0.18), 'kip 2, wave_a = 2');
  // 1'in altında iki sıra da aynı sonucu veriyor
  const half = drawWave({ L, R, GW: 512, GH: 384, vals: { wave_mode: 2, wave_a: 0.5 } });
  close(alphaOf(half), MD.colorNorm(0.045), 'kip 2, wave_a = 0,5');
  // Eski yol: kenetlemeden sonra çarpım
  const old = drawWave({ L, R, acc: false, GW: 512, GH: 384, vals: { wave_mode: 2, wave_a: 2 } });
  // Eski yolda çarpan 8 bite indirmeden SONRA geliyor, yani sonuç tekrar
  // nicemlenmiyor: min(1, colorNorm(1) * 0,09)
  close(alphaOf(old), Math.min(1, MD.colorNorm(1) * 0.09), 'eski sıra');
});

test('kip 2 ve 5 soluklaştırma çarpanı genişliğe göre', () => {
  const { L, R } = chans();
  const want = [[256, 0.07], [512, 0.09], [1024, 0.11], [2048, 0.13], [3840, 0.15]];
  for (const [w, mul] of want) {
    for (const mode of [2, 5]) {
      const r = drawWave({ L, R, GW: w, GH: Math.round(w * 0.75), vals: { wave_mode: mode, wave_a: 1 } });
      close(alphaOf(r), MD.colorNorm(mul), 'kip ' + mode + ' @' + w);
    }
  }
  // Aradaki boyutlar da bir kovaya düşüyor: 960 → 1024 kovası
  const mid = drawWave({ L, R, GW: 960, GH: 720, vals: { wave_mode: 2, wave_a: 1 } });
  close(alphaOf(mid), MD.colorNorm(0.11), '960');
});

test('kip 3 alfayı ATIYOR ve ham tiz bandının karesiyle çarpıyor', () => {
  const { L, R } = chans();
  const bands = { imm: [0, 0, 0.5] };
  // 0,22 (1024 kovası) * 1,3 * 0,5^2 = 0,0715; wave_a hükümsüz
  const r = drawWave({ L, R, GW: 960, GH: 720, bands, vals: { wave_mode: 3, wave_a: 0.9 } });
  close(alphaOf(r), MD.colorNorm(0.22 * 1.3 * 0.25), 'tiz 0,5');
  const r2 = drawWave({ L, R, GW: 960, GH: 720, bands, vals: { wave_mode: 3, wave_a: 0.1 } });
  close(alphaOf(r2), alphaOf(r), 'wave_a sonucu değiştirmiyor');
  // Tiz yükselince kenetleniyor
  const loud = drawWave({ L, R, GW: 960, GH: 720, bands: { imm: [0, 0, 3] }, vals: { wave_mode: 3 } });
  close(alphaOf(loud), MD.colorNorm(1), 'yüksek tizde opak');
  // Bant zinciri yoksa presetin gördüğü orana düşülüyor
  const noBands = drawWave({ L, R, GW: 960, GH: 720, vals: { wave_mode: 3, treb: 1 } });
  close(alphaOf(noBands), MD.colorNorm(0.22 * 1.3), 'bant yok');
});

test('kip numarası kesiliyor, eksi numarada hiç çizilmiyor', () => {
  const { L, R } = chans();
  // 2,7 → kip 2 (kesme), yuvarlansaydı kip 3 olurdu ve alfa bambaşka çıkardı
  const frac = drawWave({ L, R, GW: 512, GH: 384, vals: { wave_mode: 2.7, wave_a: 1 } });
  close(alphaOf(frac), MD.colorNorm(0.09), 'kesme');
  // 9 → 1, -1 → hiçbir case yok
  const wrap = drawWave({ L, R, GW: 512, GH: 384, vals: { wave_mode: 9, wave_a: 0.4 } });
  close(alphaOf(wrap), MD.colorNorm(0.5), '9 → kip 1 (0,4 * 1,25)');
  assert.strictEqual(drawWave({ L, R, vals: { wave_mode: -1 } }), null, 'eksi kipte çizim yok');
  assert.strictEqual(drawWave({ L, R, vals: { wave_mode: NaN } }), null, 'sayı değilse çizim yok');
  // Eski yol yuvarlıyor ve eksi numarayı sarıyor
  const oldRound = drawWave({ L, R, acc: false, GW: 512, GH: 384, vals: { wave_mode: 2.7, wave_a: 1 } });
  close(alphaOf(oldRound), MD.colorNorm(Math.min(1, MD.colorNorm(1) * 1.3)), 'eski yol 2,7 → kip 3');
  assert.ok(drawWave({ L, R, acc: false, vals: { wave_mode: -1 } }) !== null, 'eski yolda eksi kip çiziliyor');
});

// ------------------------------------------------------------------ kayıt

test('kanal okumaları kaynakta da kipe göre ayrışıyor', () => {
  const dw = method('_drawWaveModes(gl, GW, GH)');
  assert.match(dw, /acc \? R\[i \+ off\] : \(L\[i \+ off\] \+ R\[i \+ off\]\) \* 0\.5/);
  assert.match(dw, /acc \? L\[i \+ off\] : 0\.5 \* \(L\[i\] \+ R\[i\]\)/);
  assert.match(dw, /const two = mode === 7 \|\| !acc;/);
});
