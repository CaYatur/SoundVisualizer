'use strict';
/* Çıkış geometrisi testleri.
 *
 * Projeksiyon haritalamada "yaklaşık doğru" diye bir şey yok: köşeyi
 * sürüklediğiniz yere görüntünün köşesi tam olarak gitmeli, iki projektörün
 * harmanlanan kenarları toplandığında tam olarak 1 etmeli, ve haritalama
 * kapalıyken dönüşüm tam olarak kimlik olmalı. Hepsi sayısal olarak
 * ölçülebilir. */
const test = require('node:test');
const assert = require('node:assert');
const W = require('../src/shared/warp.js');

const close = (a, b, msg, eps) =>
  assert.ok(Math.abs(a - b) <= (eps || 1e-9), `${msg}: ${a} ≠ ${b}`);

const UNIT = [[0, 0], [1, 0], [1, 1], [0, 1]];

// ===========================================================================
// Homografi
// ===========================================================================
test('birim kareden birim kareye homografi kimliktir', () => {
  const H = W.homography(UNIT, UNIT);
  assert.ok(H, 'çözülemedi');
  for (const [x, y] of [[0, 0], [1, 0], [1, 1], [0, 1], [0.3, 0.7], [0.5, 0.5]]) {
    const [u, v] = W.applyHomography(H, x, y);
    close(u, x, 'x');
    close(v, y, 'y');
  }
});

test('homografi dört köşeyi tam olarak hedefe götürür', () => {
  const dst = [[0.1, 0.05], [0.95, 0.2], [0.8, 0.9], [0.05, 0.75]];
  const H = W.homography(UNIT, dst);
  assert.ok(H, 'çözülemedi');
  for (let i = 0; i < 4; i++) {
    const [u, v] = W.applyHomography(H, UNIT[i][0], UNIT[i][1]);
    close(u, dst[i][0], 'köşe ' + i + ' x', 1e-9);
    close(v, dst[i][1], 'köşe ' + i + ' y', 1e-9);
  }
});

test('homografi doğruları doğru tutar', () => {
  // Perspektif dönüşümün tanımlayıcı özelliği: doğrular doğru kalır.
  // İki doğrusal ara değerlemede bu bozulur — köşe düzeltmenin homografi
  // olmasının sebebi tam olarak bu.
  const dst = [[0.05, 0.15], [0.9, 0.02], [0.98, 0.95], [0.2, 0.88]];
  const H = W.homography(UNIT, dst);
  // Kaynakta bir doğru üzerindeki üç nokta
  const a = W.applyHomography(H, 0.2, 0.3);
  const b = W.applyHomography(H, 0.5, 0.3);
  const c = W.applyHomography(H, 0.9, 0.3);
  // Üç nokta hâlâ doğrusal olmalı: alan sıfır
  const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]));
  assert.ok(area < 1e-9, 'doğru büküldü, alan: ' + area);
});

test('ölçekleme ve öteleme beklendiği gibi', () => {
  const dst = [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]];
  const H = W.homography(UNIT, dst);
  const [u, v] = W.applyHomography(H, 0.5, 0.5);
  close(u, 0.5, 'merkez x');
  close(v, 0.5, 'merkez y');
  const [u2, v2] = W.applyHomography(H, 0, 0.5);
  close(u2, 0.25, 'sol kenar x');
  close(v2, 0.5, 'sol kenar y');
});

test('çökmüş dörtgende null döner, çökmez', () => {
  const degenerate = [[0, 0], [0, 0], [0, 0], [0, 0]];
  assert.strictEqual(W.homography(UNIT, degenerate), null);
  assert.strictEqual(W.homography(null, UNIT), null);
  assert.strictEqual(W.homography(UNIT, [[0, 0]]), null);
  // Null matris uygulanınca nokta değişmeden dönmeli
  assert.deepStrictEqual(W.applyHomography(null, 0.3, 0.4), [0.3, 0.4]);
});

// ===========================================================================
// Ağ bükme
// ===========================================================================
test('kimlik ızgarası noktaları yerinde bırakır', () => {
  for (const [c, r] of [[2, 2], [3, 3], [5, 4], [9, 9]]) {
    const g = W.identityGrid(c, r);
    for (const [u, v] of [[0, 0], [1, 1], [0.5, 0.5], [0.23, 0.81], [1, 0], [0, 1]]) {
      const p = W.meshPoint(g, u, v);
      // Kontrol noktaları Float32Array'de tutuluyor; tolerans buna göre
      close(p[0], u, `${c}x${r} u=${u}`, 1e-6);
      close(p[1], v, `${c}x${r} v=${v}`, 1e-6);
    }
  }
});

test('ağ kontrol noktalarından GEÇER', () => {
  // Catmull-Rom seçilmesinin sebebi bu: kullanıcı bir noktayı sürüklediğinde
  // görüntü tam oraya gitmeli, yaklaşmakla kalmamalı.
  const g = W.identityGrid(3, 3);
  g.pts[(1 * 3 + 1) * 2] = 0.72;      // orta nokta x
  g.pts[(1 * 3 + 1) * 2 + 1] = 0.19;  // orta nokta y
  const p = W.meshPoint(g, 0.5, 0.5);
  close(p[0], 0.72, 'orta x', 1e-6);
  close(p[1], 0.19, 'orta y', 1e-6);
});

test('ağ tüm kontrol noktalarında birebir', () => {
  const g = W.identityGrid(4, 4);
  // Rastgele ama sabit bir bozulma
  for (let i = 0; i < g.pts.length; i++) {
    g.pts[i] += Math.sin(i * 12.9898) * 0.04;
  }
  for (let j = 0; j < g.rows; j++) {
    for (let i = 0; i < g.cols; i++) {
      const p = W.meshPoint(g, i / (g.cols - 1), j / (g.rows - 1));
      close(p[0], g.pts[(j * g.cols + i) * 2], `düğüm ${i},${j} x`, 1e-6);
      close(p[1], g.pts[(j * g.cols + i) * 2 + 1], `düğüm ${i},${j} y`, 1e-6);
    }
  }
});

test('ağ çıktısı sonlu ve makul aralıkta', () => {
  const g = W.identityGrid(5, 5);
  for (let i = 0; i < g.pts.length; i++) g.pts[i] += (i % 7) * 0.03 - 0.09;
  for (let k = 0; k <= 40; k++) {
    for (let l = 0; l <= 40; l++) {
      const p = W.meshPoint(g, k / 40, l / 40);
      assert.ok(isFinite(p[0]) && isFinite(p[1]), 'sonlu değil');
      assert.ok(Math.abs(p[0]) < 4 && Math.abs(p[1]) < 4, 'aşırı: ' + p.join(','));
    }
  }
});

test('yeniden örnekleme şekli korur', () => {
  const g = W.identityGrid(3, 3);
  g.pts[(1 * 3 + 1) * 2] = 0.65;
  const big = W.resampleGrid(g, 7, 7);
  assert.strictEqual(big.cols, 7);
  assert.strictEqual(big.rows, 7);
  // Ortadaki bozulma yeni ızgarada da görünmeli
  const p = W.meshPoint(big, 0.5, 0.5);
  assert.ok(Math.abs(p[0] - 0.65) < 0.02, 'şekil kayboldu: ' + p[0]);
  // Köşeler yerinde kalmalı
  const c = W.meshPoint(big, 0, 0);
  close(c[0], 0, 'köşe x', 1e-6);
  close(c[1], 0, 'köşe y', 1e-6);
});

// ===========================================================================
// Kenar harmanlama
// ===========================================================================
test('harmanlama bandı dışında tam ışık', () => {
  for (const g of [0.5, 1, 1.8, 2.2]) {
    close(W.edgeBlend(0.5, 0.2, g), 1, 'bant dışı (gamma ' + g + ')');
    close(W.edgeBlend(1, 0.2, g), 1, 'uzak (gamma ' + g + ')');
  }
  // Genişlik 0 = harmanlama kapalı
  close(W.edgeBlend(0, 0, 1), 1, 'kapalı');
});

test('harmanlama kenarda sıfır, bant sonunda bir', () => {
  close(W.edgeBlend(0, 0.25, 1), 0, 'kenar');
  close(W.edgeBlend(0.25, 0.25, 1), 1, 'bant sonu');
});

test('ÖRTÜŞEN İKİ PROJEKTÖRÜN TOPLAMI 1', () => {
  /* Kenar harmanlamanın tek gerçek ölçütü bu: örtüşme bandında iki
     projektörün eğrileri toplandığında 1 etmeli. Etmezse dikişte açık ya da
     koyu bir bant kalır ve harmanlama işe yaramaz. */
  const width = 0.3;
  for (let k = 0; k <= 40; k++) {
    const x = (k / 40) * width;
    const a = W.edgeBlend(x, width, 1);
    const b = W.edgeBlend(width - x, width, 1);
    close(a + b, 1, 'toplam x=' + x.toFixed(3), 1e-9);
  }
});

test('harmanlama monoton artar ve 0..1 aralığında', () => {
  for (const g of [0.4, 1, 2, 3]) {
    let prev = -1;
    for (let k = 0; k <= 60; k++) {
      const v = W.edgeBlend((k / 60) * 0.4, 0.4, g);
      assert.ok(v >= prev - 1e-12, 'gamma ' + g + ' azaldı');
      assert.ok(v >= 0 && v <= 1, 'gamma ' + g + ' aralık dışı: ' + v);
      prev = v;
    }
  }
});

test('blendAt dört kenarı birlikte uygular', () => {
  const e = { left: 0.2, right: 0.2, top: 0.2, bottom: 0.2, gamma: 1 };
  close(W.blendAt(0.5, 0.5, e), 1, 'merkez tam ışık');
  close(W.blendAt(0, 0.5, e), 0, 'sol kenar sıfır');
  close(W.blendAt(1, 0.5, e), 0, 'sağ kenar sıfır');
  close(W.blendAt(0.5, 0, e), 0, 'üst kenar sıfır');
  close(W.blendAt(0.5, 1, e), 0, 'alt kenar sıfır');
  close(W.blendAt(0.5, 0.5, null), 1, 'kenar tanımı yok');
});

// ===========================================================================
// Maskeler
// ===========================================================================
test('çokgen içi/dışı doğru', () => {
  const square = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]];
  assert.ok(W.pointInPolygon(0.5, 0.5, square), 'merkez içeride olmalı');
  assert.ok(!W.pointInPolygon(0.1, 0.5, square), 'sol dışarıda olmalı');
  assert.ok(!W.pointInPolygon(0.5, 0.95, square), 'alt dışarıda olmalı');
  /* Dışbükey olmayan çokgen: L şekli. Köşe noktalarının tam hizasından
     geçen bir ışın ışın-atma yönteminde belirsizdir; test noktaları bu
     yüzden kenarlardan uzak seçildi. */
  const ell = [[0, 0], [1, 0], [1, 0.4], [0.4, 0.4], [0.4, 1], [0, 1]];
  assert.ok(W.pointInPolygon(0.2, 0.2, ell), 'L alt-sol içi');
  assert.ok(W.pointInPolygon(0.7, 0.2, ell), 'L alt-sağ içi');
  assert.ok(W.pointInPolygon(0.2, 0.8, ell), 'L üst-sol içi');
  assert.ok(!W.pointInPolygon(0.7, 0.75, ell), 'L çentiği dışarıda olmalı');
  assert.ok(!W.pointInPolygon(1.4, 0.2, ell), 'çokgen dışı');
  // Geçersiz çokgen maske uygulamamalı
  assert.ok(W.pointInPolygon(0.5, 0.5, []), 'boş çokgen maske olmamalı');
  assert.ok(W.pointInPolygon(0.5, 0.5, [[0, 0], [1, 1]]), 'iki noktalı çokgen maske olmamalı');
});

// ===========================================================================
// Kimlik tespiti — kapalı haritalamanın maliyeti sıfır olmalı
// ===========================================================================
test('varsayılan çıkış kimliktir', () => {
  assert.ok(W.isIdentity(W.defaultOutput()), 'varsayılan kimlik değil');
  assert.ok(W.isIdentity(null), 'null kimlik sayılmalı');
  const off = W.defaultOutput();
  off.enabled = false;
  off.corners = [[0.1, 0], [1, 0], [1, 1], [0, 1]];
  assert.ok(W.isIdentity(off), 'kapalı çıkış kimlik sayılmalı');
});

test('herhangi bir ayar kimliği bozar', () => {
  const cases = [
    (o) => { o.corners[0][0] = 0.05; },
    (o) => { o.edges.left = 0.1; },
    (o) => { o.color.brightness = 1.2; },
    (o) => { o.color.gamma = 0.8; },
    (o) => { o.crop.w = 0.5; },
    (o) => { o.masks.push([[0, 0], [1, 0], [1, 1]]); },
    (o) => { o.testPattern = 'grid'; },
    (o) => { o.mesh = W.identityGrid(3, 3); o.mesh.pts[8] = 0.6; },
  ];
  for (let i = 0; i < cases.length; i++) {
    const o = W.defaultOutput();
    o.enabled = true;
    cases[i](o);
    assert.ok(!W.isIdentity(o), 'durum ' + i + ' kimlik sayıldı');
  }
  // Hiçbir şey değişmediyse hâlâ kimlik
  const untouched = W.defaultOutput();
  untouched.enabled = true;
  assert.ok(W.isIdentity(untouched), 'dokunulmamış açık çıkış kimlik olmalı');
});

// ===========================================================================
// Doğrusal çözücü
// ===========================================================================
test('çözücü bilinen sistemi çözer', () => {
  // 2x + y = 5 ; x - y = 1  ->  x = 2, y = 1
  const x = W.solve([[2, 1], [1, -1]], [5, 1]);
  close(x[0], 2, 'x');
  close(x[1], 1, 'y');
});

test('çözücü tekil sistemde null döner', () => {
  assert.strictEqual(W.solve([[1, 2], [2, 4]], [3, 6]), null);
});

test('çözücü pivotlama gerektiren sistemi çözer', () => {
  // İlk pivot sıfır: kısmi pivotlama olmadan çökerdi
  const x = W.solve([[0, 1], [1, 0]], [3, 4]);
  close(x[0], 4, 'x');
  close(x[1], 3, 'y');
});
