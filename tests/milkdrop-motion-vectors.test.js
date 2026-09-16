'use strict';
/* HAREKET VEKTÖRLERİ (#560).
 *
 * MilkDrop (milkdropfs.cpp:1172-1320):
 *   - sayı kesiliyor, kesirli kısım ızgara aralığına giriyor; X'te 64,
 *     Y'de 48 sınır;
 *   - nokta ızgarası (i + 0,25) / (n + kesir + 0,25 - 1), yani ekranın bir
 *     kenarından ötekine;
 *   - vektör noktadan, o noktanın İÇERİĞİNİN GELDİĞİ yere doğru, farkı
 *     `mv_l` ile ölçekli;
 *   - bir tekselden kısa olan iz bir teksele uzatılıyor.
 * Motor hücre ortalarına oturan bir ızgara çiziyor, sayıyı yuvarlıyor,
 * ikisini de 64'te kesiyor, vektörü ters yöne çiziyor ve en kısa izi hiç
 * uygulamıyordu. Korpusta 884 preset (%8,6) hareket vektörü çiziyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(root, 'src/visualizer/modes/milkdrop.js'), 'utf-8');
const MD = require('../src/shared/milkdrop.js');

function method(sig) {
  const i = SRC.indexOf('    ' + sig + ' {');
  assert.ok(i > 0, sig + ' bulunamadı');
  const end = SRC.indexOf('\n    }', i);
  return SRC.slice(i, end + 6);
}
const body = (src) => src.slice(src.indexOf('{') + 1, src.lastIndexOf('}'));
const glStub = new Proxy({}, {
  get(_, k) {
    if (typeof k === 'string' && /^[A-Z_0-9]+$/.test(k)) return k;
    return () => {};
  },
});

/* Motorun kendi `_drawMotionVectors` gövdesini koşturur ve çizilen çizgi
   parçalarını [x0, y0, x1, y1] olarak verir. Ağ, her düğümü kendi yerinden
   örnekleyen (yani warp'sız) bir ağ: vektörlerin uzunluğu sıfır kalıyor ve
   en kısa iz kuralı görünür oluyor. Kaydırma isteyen testler ağı kaydırıyor. */
function vectors(opts) {
  const vstride = 9;
  const fn = new Function('gl', 'GW', 'GH', 'VSTRIDE', 'window',
    body(method('_drawMotionVectors(gl, GW, GH)')));
  const meshX = 8, meshY = 6;
  const verts = new Float32Array((meshX + 1) * (meshY + 1) * vstride);
  for (let j = 0; j <= meshY; j++) {
    for (let i = 0; i <= meshX; i++) {
      const o = (j * (meshX + 1) + i) * vstride;
      verts[o + 2] = i / meshX + (opts.shiftU || 0);      // örneklenen u
      verts[o + 3] = j / meshY + (opts.shiftV || 0);      // örneklenen v
    }
  }
  const vals = Object.assign({
    mv_a: 1, mv_r: 1, mv_g: 1, mv_b: 1, mv_x: 4, mv_y: 3, mv_l: 1, mv_dx: 0, mv_dy: 0,
  }, opts.vals || {});
  const segs = [];
  const self = {
    _wantAcc: opts.acc !== false,
    preset: { get: (k) => vals[k] },
    verts, meshX, meshY,
    lineData: new Float32Array(4096 * 6),
    _toClipY: new Function('y', /_toClipY\(y\) \{([^}]*)\}/.exec(SRC)[1]),
    _blend() {},
    _strip(gl, kind, d, n) {
      for (let i = 0; i + 1 < n; i += 2) {
        segs.push([d[i * 6], d[i * 6 + 1], d[(i + 1) * 6], d[(i + 1) * 6 + 1]]);
      }
    },
    lineProg: 1, lineVao: 1, lineVbo: 1,
  };
  fn.call(self, glStub, opts.GW || 960, opts.GH || 720, vstride, { SVMilkdrop: MD });
  return segs;
}
// clip -> ekran koordinatı
const sx = (v) => (v + 1) / 2;
const sy = (v) => (1 - v) / 2;
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-5, msg + ': ' + a + ' / ' + b);

test('ızgara MilkDrop\'un ızgarası: kenardan kenara', () => {
  const segs = vectors({ vals: { mv_x: 4, mv_y: 3 } });
  /* fx = (i + 0,25) / (4 + 0 + 0,25 - 1) = (i + 0,25) / 3,25. Dördüncü sütun
     tam 1,0'a düşüyor ve MilkDrop onu çizmiyor (0,0001 < f < 0,9999); üçüncü
     satır için de aynısı. */
  assert.strictEqual(segs.length, 3 * 2, 'nokta sayısı');
  const xs = [...new Set(segs.map((s) => +sx(s[0]).toFixed(6)))].sort((a, b) => a - b);
  for (let i = 0; i < 3; i++) close(xs[i], (i + 0.25) / 3.25, 'sütun ' + i);
  // ekran koordinatı yukarıdan aşağı: 1 - fy
  const ys = [...new Set(segs.map((s) => +sy(s[1]).toFixed(6)))].sort((a, b) => a - b);
  for (let j = 0; j < 2; j++) close(ys[j], 1 - (1 - j + 0.25) / 2.25, 'satır ' + j);
});

test('sayı kesiliyor, kesirli kısım aralığa giriyor', () => {
  const segs = vectors({ vals: { mv_x: 4.5, mv_y: 3 } });
  /* Kesir paydaya giriyor: son sütun 0,867'ye çekiliyor ve artık dördü de
     çiziliyor — kesirli sayının işi bu. */
  assert.strictEqual(segs.length, 4 * 2, '4,5 -> dört sütun');
  const xs = [...new Set(segs.map((s) => +sx(s[0]).toFixed(6)))].sort((a, b) => a - b);
  // kesir 0,5 paydaya giriyor: (i + 0,25) / (4 + 0,5 + 0,25 - 1)
  for (let i = 0; i < 4; i++) close(xs[i], (i + 0.25) / 3.75, 'sütun ' + i);
});

test('üst sınırlar X\'te 64, Y\'de 48', () => {
  const segs = vectors({ vals: { mv_x: 200, mv_y: 200 } });
  // Son sütun ve son satır tam kenara düştüğü için eleniyor: 63 x 47
  assert.strictEqual(segs.length, 63 * 47);
  const old = vectors({ acc: false, vals: { mv_x: 200, mv_y: 200 } });
  assert.strictEqual(old.length, 64 * 64, 'eski yolda ikisi de 64');
});

test('en kısa iz bir teksel', () => {
  // Ağ her düğümü kendi yerinden örnekliyor: fark sıfır, uzunluk sıfır
  const GW = 960;
  const segs = vectors({ GW, vals: { mv_x: 2, mv_y: 2 } });
  /* MilkDrop kısa izi UZATIYOR: yön korunuyor, uzunluk bir teksele
     çekiliyor (milkdropfs.cpp:1275-1288). Bu ağda fark yuvarlama kadar
     küçük, yani uzunluk tam bir teksel çıkmalı. */
  for (const [x0, y0, x1, y1] of segs) {
    const dx = sx(x1) - sx(x0), dy = sy(y1) - sy(y0);
    close(Math.sqrt(dx * dx + dy * dy), 1 / GW, 'iz uzunluğu');
  }
  // Uyum kapalıyken sıfır uzunluk: iki uç da aynı yerde
  const old = vectors({ GW, acc: false, vals: { mv_x: 2, mv_y: 2 } });
  for (const [x0, y0, x1, y1] of old) {
    close(x1, x0, 'eski x');
    close(y1, y0, 'eski y');
  }
});

test('vektör, içeriğin geldiği yere doğru', () => {
  /* Ağ 0,1 sağa kaydırılmış örnekliyor: MilkDrop'ta uç nokta o yöne
     gidiyor, motorun eski yolunda ise tam tersine. */
  const segs = vectors({ shiftU: 0.1, vals: { mv_x: 2, mv_y: 2, mv_l: 1 } });
  for (const [x0, , x1] of segs) close(sx(x1) - sx(x0), 0.1, 'yeni yön');
  const old = vectors({ shiftU: 0.1, acc: false, vals: { mv_x: 2, mv_y: 2, mv_l: 1 } });
  for (const [x0, , x1] of old) close(sx(x1) - sx(x0), -0.1, 'eski yön');
});

test('mv_l uzunluğu ölçekliyor, mv_dx/mv_dy ızgarayı kaydırıyor', () => {
  const half = vectors({ shiftU: 0.2, vals: { mv_x: 2, mv_y: 2, mv_l: 0.5 } });
  for (const [x0, , x1] of half) close(sx(x1) - sx(x0), 0.1, 'yarım uzunluk');
  const base = vectors({ vals: { mv_x: 3, mv_y: 3 } });
  const moved = vectors({ vals: { mv_x: 3, mv_y: 3, mv_dx: 0.05 } });
  close(sx(moved[0][0]) - sx(base[0][0]), 0.05, 'yatay kaydırma');
});

test('ekran dışına düşen noktalar çizilmiyor', () => {
  const segs = vectors({ vals: { mv_x: 3, mv_y: 3, mv_dx: 0.9 } });
  assert.ok(segs.length < 9, 'kaydırılan sütunlar elenmedi: ' + segs.length);
  for (const [x0] of segs) assert.ok(sx(x0) < 0.9999, 'ekran dışı nokta çizildi');
});
