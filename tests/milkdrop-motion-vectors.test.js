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
  const take = (d, n) => {
    for (let i = 0; i + 1 < n; i += 2) {
      segs.push([d[i * 6], d[i * 6 + 1], d[(i + 1) * 6], d[(i + 1) * 6 + 1]]);
    }
  };
  const self = {
    _wantAcc: opts.acc !== false,
    preset: { get: (k) => vals[k] },
    verts, meshX, meshY,
    lineData: new Float32Array(4096 * 6),
    _toClipY: new Function('y', /_toClipY\(y\) \{([^}]*)\}/.exec(SRC)[1]),
    _blend() {},
    _strip(gl, kind, d, n, breakAt, gw, gh, thickMul, md) {
      if (opts.viaStrip) opts.viaStrip.push(md);
      take(d, n);
    },
    lineProg: 1, lineVao: 1, lineVbo: 1,
  };
  const gl = new Proxy({}, {
    get(_, k) {
      if (typeof k === 'string' && /^[A-Z_0-9]+$/.test(k)) return k;
      return () => {};
    },
  });
  fn.call(self, gl, opts.GW || 960, opts.GH || 720, vstride, { SVMilkdrop: MD });
  return segs;
}
/* clip -> EKRAN koordinatı, ikisi de sol üstten. İç tampon MilkDrop
   yönünde (satır 0 = görüntünün üstü), yani clip -1 ekranın ÜSTÜ
   (`_toClipY` notu). */
const sx = (v) => (v + 1) / 2;
const sy = (v) => (v + 1) / 2;
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-5, msg + ': ' + a + ' / ' + b);

test('ızgara MilkDrop\'un ızgarası: kenardan kenara', () => {
  const segs = vectors({ vals: { mv_x: 4, mv_y: 3 } });
  /* fx = (i + 0,25) / (4 + 0 + 0,25 - 1) = (i + 0,25) / 3,25. Dördüncü sütun
     tam 1,0'a düşüyor ve MilkDrop onu çizmiyor (0,0001 < f < 0,9999); üçüncü
     satır için de aynısı. */
  assert.strictEqual(segs.length, 3 * 2, 'nokta sayısı');
  const xs = [...new Set(segs.map((s) => +sx(s[0]).toFixed(6)))].sort((a, b) => a - b);
  for (let i = 0; i < 3; i++) close(xs[i], (i + 0.25) / 3.25, 'sütun ' + i);
  /* MilkDrop'un `fy`si ekranda yukarıdan aşağı (2B izdüşümü y'yi çeviriyor,
     support.cpp:179): satırlar ekranda tam `fy`de. */
  const ys = [...new Set(segs.map((s) => +sy(s[1]).toFixed(6)))].sort((a, b) => a - b);
  for (let j = 0; j < 2; j++) close(ys[j], (j + 0.25) / 2.25, 'satır ' + j);
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

test('hiç hareket yoksa iz sağ-aşağı', () => {
  /* `mv_l = 0` farkı tam sıfır yapıyor: yön kalmıyor ve MilkDrop izi
     `dx = dy = min_len` ile çiziyor (milkdropfs.cpp:1283-1287). Onun `fy`si
     ekranda yukarıdan aşağı, yani iz sağa ve AŞAĞI. Referans çizicide de
     öyle; motor #751'den önce yukarı çiziyordu. */
  const GW = 960;
  const segs = vectors({ GW, vals: { mv_x: 3, mv_y: 3, mv_l: 0 } });
  assert.ok(segs.length > 0, 'iz yok');
  for (const [x0, y0, x1, y1] of segs) {
    close(sx(x1) - sx(x0), 1 / GW, 'sağa');
    close(sy(y1) - sy(y0), 1 / GW, 'aşağı');
  }
});

test('vektör, içeriğin geldiği yere doğru', () => {
  /* Ağ 0,1 sağa kaydırılmış örnekliyor: MilkDrop'ta uç nokta o yöne
     gidiyor, motorun eski yolunda ise tam tersine. */
  const segs = vectors({ shiftU: 0.1, vals: { mv_x: 2, mv_y: 2, mv_l: 1 } });
  // + MilkDrop'un yarım tekseli (aşağıdaki test)
  for (const [x0, , x1] of segs) close(sx(x1) - sx(x0), 0.1 + 0.5 / 960, 'yeni yön');
  const old = vectors({ shiftU: 0.1, acc: false, vals: { mv_x: 2, mv_y: 2, mv_l: 1 } });
  for (const [x0, , x1] of old) close(sx(x1) - sx(x0), -0.1, 'eski yön');
});

test('mv_l uzunluğu ölçekliyor, mv_dx/mv_dy ızgarayı kaydırıyor', () => {
  const half = vectors({ shiftU: 0.2, vals: { mv_x: 2, mv_y: 2, mv_l: 0.5 } });
  for (const [x0, , x1] of half) close(sx(x1) - sx(x0), (0.2 + 0.5 / 960) * 0.5, 'yarım uzunluk');
  const base = vectors({ vals: { mv_x: 3, mv_y: 3 } });
  const moved = vectors({ vals: { mv_x: 3, mv_y: 3, mv_dx: 0.05 } });
  close(sx(moved[0][0]) - sx(base[0][0]), 0.05, 'yatay kaydırma');
});

test('hareketsiz alanda MilkDrop\'un yarım tekseli: sağa ve aşağı, mv_l ile büyüyor', () => {
  /* MilkDrop ağın tu/tv'sine yarım teksel ekliyor (milkdropfs.cpp:1838-
     1839) ve ters yayılım onu yer değiştirme diye okuyor. #750 yamalı
     MilkDrop'ta ölçüldü: sağa ve ekranda aşağı. `mv_l` binlere çıkınca bu
     çizgi ekranı kesiyor ("Sensual Enjoyment"). */
  const GW = 960, GH = 720;
  const segs = vectors({ GW, GH, vals: { mv_x: 3, mv_y: 3, mv_l: 200 } });
  assert.ok(segs.length > 0, 'iz yok');
  for (const [x0, y0, x1, y1] of segs) {
    close(sx(x1) - sx(x0), 0.5 / GW * 200, 'sağa');
    close(sy(y1) - sy(y0), 0.5 / GH * 200, 'aşağı');
  }
});

test('ekran dışına düşen noktalar çizilmiyor', () => {
  const segs = vectors({ vals: { mv_x: 3, mv_y: 3, mv_dx: 0.9 } });
  assert.ok(segs.length < 9, 'kaydırılan sütunlar elenmedi: ' + segs.length);
  for (const [x0] of segs) assert.ok(sx(x0) < 0.9999, 'ekran dışı nokta çizildi');
});

test('vektörler MilkDrop\'un tek geçişiyle, çizgi biçiminin yolundan', () => {
  /* MilkDrop vektörleri tek bir LINELIST ile, bir teksel çiziyor
     (milkdropfs.cpp:1314): tek geçiş, `its = 1`. Genişlik ve ışık çizgi
     biçiminin yolundan geliyor; uyum açıkken `smooth`/`thin` o yolda
     MilkDrop'un izini çiziyor (`_aaSetup` testleri aşağıda). */
  const md = [];
  const segs = vectors({ viaStrip: md, vals: { mv_x: 4, mv_y: 3 } });
  assert.ok(segs.length > 0, 'iz yok');
  assert.ok(md.length > 0 && md.every((m) => m && m.its === 1), JSON.stringify(md));
});

/* `_aaSetup` gövdesini sahte bir GL ile koşturup şeridin yarı genişliğini ve
   kazancını okur. */
function aaSetup(o) {
  const fn = new Function('gl', 'GW', 'thickMul', 'md', 'AA_TRIM', 'MD_LINE_REF',
    body(method('_aaSetup(gl, GW, thickMul, md)')));
  const u = {};
  const gl = new Proxy({}, {
    get(_, k) {
      if (k === 'uniform1f') return (loc, v) => { u[loc] = v; };
      if (typeof k === 'string' && /^[A-Z_0-9]+$/.test(k)) return k;
      return () => {};
    },
  });
  const self = {
    _wantAcc: o.acc !== false,
    _lineStyle: o.style || 'smooth',
    _aaAdditive: false,
    locAA: { uHalf: 'half', uExt: 'ext', uGain: 'gain', uMax: 'max' },
    _mdLight: new Function(/_mdLight\(\) \{([^}]*)\}/.exec(SRC)[1]),
    _lineDraws: new Function('GW', 'thickMul', body(method('_lineDraws(GW, thickMul)'))),
  };
  const trim = +/const AA_TRIM = ([0-9.]+);/.exec(SRC)[1];
  const ref = +/const MD_LINE_REF = ([0-9.e]+);/.exec(SRC)[1];
  fn.call(self, gl, o.GW, o.thick || 1, o.md, trim, ref);
  return { half: u.half, gain: u.gain, trim, ref };
}

test('smooth, uyum açıkken MilkDrop\'un izini ve ışığını çiziyor', () => {
  /* İz 1 teksel, dört geçişli çizimde (kalın, ya da nokta) 2x2 blok =
     2 teksel; piksel başına ışık geçişlerin bıraktığı kadar (#752). Eski
     kalibrasyon 960'ta 3 teksel genişlik ve 1,8 kazançla MilkDrop'un 2-5
     katı ışık bırakıyordu. */
  const thin = aaSetup({ GW: 960, md: { its: 1 } });
  close(thin.half, 0.5, 'ince iz');
  close(thin.gain, thin.trim, 'ince kazanç');
  const thick = aaSetup({ GW: 960, thick: 2, md: { its: 4 } });
  close(thick.half, 1, 'kalın iz');
  close(thick.gain, thick.trim * 2, 'kalın kazanç');
  // Referansın üstünde iz oranla genişliyor, piksel başına ışık aynı
  const big = aaSetup({ GW: 2048, md: { its: 1 } });
  close(big.half, 0.5 * 2048 / big.ref, '2048 iz');
  close(big.gain, big.trim, '2048 kazanç');
  // Uyum kapalıyken eski ışık korumalı kalibrasyon
  const legacy = aaSetup({ GW: 960, acc: false, md: { its: 1 } });
  close(legacy.half, 1.5, 'eski iz');
  assert.ok(legacy.gain > 1.5, 'eski kazanç: ' + legacy.gain);
});

test('thin, uyum açıkken her çözünürlükte MilkDrop\'un gerçek izi', () => {
  /* "Gerçek kalınlık": pencere boyu tampondaki MilkDrop izi, ölçek yok.
     Eski `thin` 512 referanslıydı ve ışık çarpanı 1'di — 960'ta 1,9
     teksel, yani MilkDrop'un iki katı ışık. */
  const r = aaSetup({ GW: 2048, style: 'thin', md: { its: 1 } });
  close(r.half, 0.5, 'thin iz');
  close(r.gain, r.trim, 'thin kazanç');
  const thick = aaSetup({ GW: 2048, style: 'thin', thick: 2, md: { its: 4 } });
  close(thick.half, 1, 'thin kalın iz');
  // Uyum kapalıyken eski `thin`: 512 referansı, kazanç 1
  const legacy = aaSetup({ GW: 2048, style: 'thin', acc: false, md: { its: 1 } });
  close(legacy.half, 2, 'eski thin iz');
  close(legacy.gain, 1, 'eski thin kazanç');
});

test('vektörler warp\'ın kaynağına, ağ yeniden kurulmadan önce', () => {
  /* MilkDrop: DrawMotionVectors VS0'a (milkdropfs.cpp:950-965), ağ ondan
     SONRA hesaplanıyor (1006) ve warp VS0'ı okuyor. Uyum açıkken motorda da
     sıra bu; kapalıyken eski yer (çizimlerden sonra) kalıyor. */
  const src = SRC.replace(/\r\n/g, '\n');
  const i = src.indexOf('      this._buildWarpMesh();\n      this._meshBuilt = true;');
  assert.ok(i > 0, 'ağ kurulumu bulunamadı');
  const before = src.slice(src.lastIndexOf('const src = this.targets[this.cur];', i), i);
  assert.match(before, /gl\.bindFramebuffer\(gl\.FRAMEBUFFER, src\.fb\);[\s\S]*this\._drawMotionVectors\(gl, GW, GH\);/);
  assert.match(src, /if \(this\._wantAcc === false\) this\._drawMotionVectors\(gl, GW, GH\);/);
  // Yeni ağ boşken (ilk kare, ağ sıklığı değişimi) vektör çizilmiyor
  assert.match(before, /if \(this\._meshBuilt\)/);
  assert.match(method('_buildMesh()'), /this\._meshBuilt = false;/);
});
