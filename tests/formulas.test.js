'use strict';
/* Formül kitaplığının sayısal doğrulaması.
 *
 *   node --test tests/
 *
 * Bu dosya formüllerin BİLİNEN noktalardaki değerini kontrol eder; beklenen
 * değerler tanımdan elle türetilmiştir, uygulamanın kendi çıktısından değil.
 * Çekicilerde ise yön ve sınırlılık doğrulanır — sayısal integrasyonla çalışan
 * bir sistemin "doğru" tek bir noktası yoktur.
 *
 * Kitaplığın tamamını ayrım yapmadan tarayan sağlık testleri için
 * tests/formulas-health.test.js dosyasına bakın.
 */
const test = require('node:test');
const assert = require('node:assert');
const F = require('../src/shared/formulas.js');
require('../src/shared/formulas-extra.js');

const EPS = 1e-12;

function close(actual, expected, msg, eps) {
  assert.ok(
    Math.abs(actual - expected) <= (eps || EPS),
    `${msg}: ${actual} ≠ ${expected} (fark ${Math.abs(actual - expected)})`
  );
}

function vecClose(actual, expected, msg, eps) {
  assert.strictEqual(actual.length, expected.length, msg + ': boyut');
  for (let i = 0; i < expected.length; i++) close(actual[i], expected[i], msg + '[' + i + ']', eps);
}

// Formülü varsayılan parametreleriyle çağır
function curve2d(key, u, over) {
  const d = F.CURVES_2D[key];
  return d.f(u, Object.assign(F.defaults(d), over || {}));
}
function curve3d(key, u, over) {
  const d = F.CURVES_3D[key];
  return d.f(u, Object.assign(F.defaults(d), over || {}));
}
function surface(key, u, v, over) {
  const d = F.SURFACES[key];
  return d.f(u, v, Object.assign(F.defaults(d), over || {}));
}

// ===========================================================================
test('katalog: her formülün etiketi ve doğruluk sınıfı var', () => {
  const cat = F.catalog();
  assert.ok(cat.length >= 30, 'en az 30 formül bekleniyor, bulunan: ' + cat.length);
  for (const e of cat) {
    assert.ok(e.label && e.label.length > 1, e.key + ': etiket yok');
    assert.ok(['exact', 'approx', 'visual'].includes(e.accuracy), e.key + ': doğruluk sınıfı geçersiz');
    for (const p of e.params) {
      assert.ok(p.min <= p.default && p.default <= p.max, e.key + '.' + p.name + ': varsayılan aralık dışında');
    }
  }
});

// ===========================================================================
// DÜZLEM EĞRİLERİ — kapalı form
// ===========================================================================
test('Lissajous: x=sin(a·2πu+δ2π), y=sin(b·2πu)', () => {
  // u=0, a=3, b=2, δ=0.25 → x=sin(π/2)=1, y=sin(0)=0
  vecClose(curve2d('lissajous', 0), [1, 0], 'lissajous(0)');
  // u=0.25 → x=sin(3·π/2 + π/2)=sin(2π)=0, y=sin(π)=0
  vecClose(curve2d('lissajous', 0.25), [0, 0], 'lissajous(0.25)', 1e-15);
});

test('Gül eğrisi: r=cos(n/d·θ)', () => {
  // n=5, d=1, u=0 → θ=0, r=1 → (1, 0)
  vecClose(curve2d('rose', 0), [1, 0], 'rose(0)');
  // u=0.25 → θ=π/2, r=cos(5π/2)=0 → orijin
  const p = curve2d('rose', 0.25);
  close(Math.hypot(p[0], p[1]), 0, 'rose(0.25) yarıçap', 1e-15);
  // n çift olduğunda 2n yaprak, tek olduğunda n yaprak: r(θ)=r(θ+π) simetrisi
  const a = curve2d('rose', 0.1, { n: 4, d: 1 });
  const b = curve2d('rose', 0.6, { n: 4, d: 1 });
  close(Math.hypot(a[0], a[1]), Math.hypot(b[0], b[1]), 'rose n=4 simetri', 1e-14);
});

test('Kardiyoid: r=a(1−cosθ)', () => {
  // u=0 → θ=0 → r=0 → orijin (kardiyoidin sivri ucu)
  vecClose(curve2d('cardioid', 0), [0, 0], 'cardioid(0)', 1e-16);
  // u=0.5 → θ=π → r=2a=1 → (−1, ~0)
  const p = curve2d('cardioid', 0.5);
  close(p[0], -1, 'cardioid(0.5).x');
  close(p[1], 0, 'cardioid(0.5).y', 1e-15);
});

test('Lemniskat: x=a·cos t/(1+sin²t), y=a·sin t·cos t/(1+sin²t)', () => {
  vecClose(curve2d('lemniscate', 0), [1, 0], 'lemniscate(0)');
  // t=π/4: sin=cos=√2/2, d=1.5 → x=(√2/2)/1.5, y=0.5/1.5
  const p = curve2d('lemniscate', 0.125);
  close(p[0], Math.SQRT1_2 / 1.5, 'lemniscate(π/4).x');
  close(p[1], 0.5 / 1.5, 'lemniscate(π/4).y');
});

test('Astroid: x=cos³t, y=sin³t', () => {
  vecClose(curve2d('astroid', 0), [1, 0], 'astroid(0)', 1e-15);
  // t=π/4 → (√2/2)³
  const c = Math.pow(Math.SQRT1_2, 3);
  vecClose(curve2d('astroid', 0.125), [c, c], 'astroid(π/4)', 1e-15);
});

test('Süperformül: m=4, n1=n2=n3=1 → θ=0 noktasında r=1', () => {
  // r = (|cos(mθ/4)|^n2 + |sin(mθ/4)|^n3)^(−1/n1); θ=0 → (1+0)^-1 = 1
  close(F.superShape(0, 4, 1, 1, 1), 1, 'superShape(0)');
  // m=0 → t her zaman 0 → r=1 (birim çember)
  close(F.superShape(1.234, 0, 1, 1, 1), 1, 'superShape m=0 birim çember');
  const p = curve2d('superformula', 0, { m: 4, n1: 1, n2: 1, n3: 1 });
  vecClose(p, [1, 0], 'superformula(0)');
});

test('Episikloid: R=3, r=1 → t=0 noktasında x=(R+r−r)/(R+2r)', () => {
  // x = ((R+r)cos0 − r·cos(k·0))·s = (4−1)/5 = 0.6 ; y = 0
  vecClose(curve2d('epicycloid', 0), [0.6, 0], 'epicycloid(0)', 1e-15);
});

test('Hipotrokoid: R=5, r=3, d=5 → t=0 noktasında x=((R−r)+d)/(R−r+d)=1', () => {
  vecClose(curve2d('hypotrochoid', 0), [1, 0], 'hypotrochoid(0)', 1e-15);
});

test('Kelebek eğrisi: t=0 noktasında r=(e−2)/4.2', () => {
  const r = (Math.E - 2) / 4.2;
  vecClose(curve2d('butterfly', 0), [0, -r], 'butterfly(0)', 1e-15);
});

test('Harmonograf: u=0 noktasında sönümsüz başlangıç', () => {
  // d=e^0=1 → x=sin(0)=0, y=sin(1.2)
  vecClose(curve2d('harmonograph', 0), [0, Math.sin(1.2)], 'harmonograph(0)');
});

test('Filotaksi: ilk nokta merkezde, açı altın açıya yakın', () => {
  const d = F.CURVES_2D.phyllotaxis;
  const p = F.defaults(d);
  vecClose(d.f(0, p, 0, 500), [0, 0], 'phyllotaxis(i=0)');
  close(p.angle, 137.5, 'altın açı varsayılanı', 1e-9);
  // i=1 ve i=4 arasındaki yarıçap oranı √1 : √4 = 1 : 2
  const p1 = d.f(0, p, 1, 500);
  const p4 = d.f(0, p, 4, 500);
  close(Math.hypot(p4[0], p4[1]) / Math.hypot(p1[0], p1[1]), 2, 'yarıçap ∝ √i', 1e-12);
});

test('Logaritmik sarmal: uçta yarıçap 1 olacak şekilde ölçekli', () => {
  const d = F.CURVES_2D.spiralLog;
  const prm = F.defaults(d);
  const end = d.f(1, prm);
  close(Math.hypot(end[0], end[1]), 1, 'sarmal ucu birim yarıçapta', 1e-12);
});

// ===========================================================================
// UZAY EĞRİLERİ
// ===========================================================================
test('Simit düğümü: p=2, q=3 → t=0 noktasında (1, 0, 0)', () => {
  vecClose(curve3d('torusKnot', 0), [1, 0, 0], 'torusKnot(0)', 1e-15);
});

test('Helis: u=0 tabanda, u=1 tepede; yarıçap sabit', () => {
  const a = curve3d('helix3', 0);
  const b = curve3d('helix3', 1);
  close(a[1], -1, 'helis tabanı');
  close(b[1], 1, 'helis tepesi');
  close(Math.hypot(a[0], a[2]), 0.6, 'helis yarıçapı (u=0)');
  close(Math.hypot(b[0], b[2]), 0.6, 'helis yarıçapı (u=1)', 1e-14);
});

test('Viviani: küre ile silindirin arakesiti — |P| sabit', () => {
  const d = F.CURVES_3D.viviani;
  const p = F.defaults(d);
  const a = p.a;
  // Viviani eğrisi 2a yarıçaplı küre üzerindedir: x²+y²+z² = 4a²
  for (const u of [0, 0.13, 0.37, 0.5, 0.76, 0.99]) {
    const q = d.f(u, p);
    close(q[0] * q[0] + q[1] * q[1] + q[2] * q[2], 4 * a * a, 'viviani küre üzerinde (u=' + u + ')', 1e-12);
  }
});

test('Yonca düğümü: t=0 noktasında (0, −s, 0)', () => {
  const s = F.defaults(F.CURVES_3D.trefoil).scale;
  vecClose(curve3d('trefoil', 0), [0, -s, 0], 'trefoil(0)', 1e-15);
});

// ===========================================================================
// YÜZEYLER
// ===========================================================================
test('Düzlem: köşeler (−1,−1) ve (1,1)', () => {
  vecClose(surface('plane', 0, 0), [-1, -1, 0], 'plane(0,0)');
  vecClose(surface('plane', 1, 1), [1, 1, 0], 'plane(1,1)');
});

test('Küre: her nokta birim küre üzerinde', () => {
  for (const [u, v] of [[0, 0.5], [0.25, 0.5], [0.5, 0.25], [0.7, 0.9], [0.33, 0.11]]) {
    const p = surface('sphere', u, v);
    close(Math.hypot(p[0], p[1], p[2]), 1, `sphere(${u},${v}) yarıçap`, 1e-15);
  }
  vecClose(surface('sphere', 0, 0.5), [1, 0, 0], 'sphere(0,0.5)', 1e-15);
});

test('Simit: eksenden uzaklık R±tube aralığında', () => {
  const tube = F.defaults(F.SURFACES.torus).tube;
  const R = 1 - tube;
  for (const [u, v] of [[0, 0], [0.3, 0.5], [0.8, 0.2]]) {
    const p = surface('torus', u, v);
    const d = Math.hypot(p[0], p[2]);
    assert.ok(d >= R - tube - 1e-12 && d <= R + tube + 1e-12, `torus(${u},${v}) eksen uzaklığı ${d}`);
    // Boru kesitinin merkezi R'de: (d−R)² + y² = tube²
    close((d - R) * (d - R) + p[1] * p[1], tube * tube, `torus(${u},${v}) boru yarıçapı`, 1e-12);
  }
  vecClose(surface('torus', 0, 0), [1, 0, 0], 'torus(0,0)', 1e-15);
});

test('Möbius: v=0.5 orta çizgi, yarıçap sabit', () => {
  const width = F.defaults(F.SURFACES.mobius).width;
  const r = 1 - width;
  for (const u of [0, 0.2, 0.5, 0.9]) {
    const p = surface('mobius', u, 0.5);
    close(Math.hypot(p[0], p[2]), r, 'mobius orta çizgi yarıçapı (u=' + u + ')', 1e-15);
    close(p[1], 0, 'mobius orta çizgi yüksekliği', 1e-15);
  }
});

test('Klein şişesi: sonlu ve sınırlı', () => {
  for (const [u, v] of [[0, 0], [0.25, 0.5], [0.5, 0.75], [0.9, 0.1]]) {
    const p = surface('klein', u, v);
    p.forEach((c, i) => assert.ok(isFinite(c) && Math.abs(c) < 5, `klein(${u},${v})[${i}] = ${c}`));
  }
  vecClose(surface('klein', 0, 0), [0.84, 0, 0], 'klein(0,0)', 1e-15);
});

test('Chladni: köşegen simetri m↔n ters işaretli', () => {
  const d = F.SURFACES.chladni;
  const p = Object.assign(F.defaults(d), { m: 3, n: 5 });
  const q = Object.assign(F.defaults(d), { m: 5, n: 3 });
  // z(m,n; u,v) = −z(n,m; u,v) — tanımdaki iki terim yer değiştirir
  for (const [u, v] of [[0.2, 0.7], [0.4, 0.1], [0.9, 0.55]]) {
    close(d.f(u, v, p)[1], -d.f(u, v, q)[1], `chladni m↔n antisimetri (${u},${v})`, 1e-14);
  }
  // Köşede iki terim eşit → sıfır
  close(d.f(0, 0, p)[1], 0, 'chladni(0,0) düğüm', 1e-15);
});

test('Dalga yüzeyi: merkezde yükseklik sıfır, radyal simetrik', () => {
  const d = F.SURFACES.ripple;
  const p = F.defaults(d);
  close(d.f(0.5, 0.5, p)[1], 0, 'ripple merkez', 1e-15);
  // Merkeze eşit uzaklıktaki noktalar aynı yüksekliktedir
  close(d.f(0.5, 0.9, p)[1], d.f(0.9, 0.5, p)[1], 'ripple radyal simetri', 1e-14);
});

test('Süperşekil, küresel harmonik, deniz kabuğu, Boy, Dini: sonlu ve sınırlı', () => {
  const keys = ['supershape', 'sphericalHarmonic', 'seashell', 'boy', 'dini'];
  for (const k of keys) {
    for (const [u, v] of [[0.1, 0.2], [0.5, 0.5], [0.83, 0.37], [0.99, 0.66]]) {
      const p = surface(k, u, v);
      assert.strictEqual(p.length, 3, k + ': 3 bileşen');
      p.forEach((c, i) => assert.ok(isFinite(c) && Math.abs(c) < 20, `${k}(${u},${v})[${i}] = ${c}`));
    }
  }
});

// ===========================================================================
// ÇEKİCİLER
// ===========================================================================
test('Lorenz: tanımdaki türev yönü ve sınırlılık', () => {
  const d = F.ATTRACTORS.lorenz;
  const p = F.defaults(d);
  // dx/dt = σ(y − x); (0.1, 0, 0) noktasında σ=10 → dx = −1 → x azalır
  const dt = 1e-6;
  const s1 = d.step([0.1, 0, 0], p, dt);
  close((s1[0] - 0.1) / dt, p.sigma * (0 - 0.1), 'lorenz dx/dt', 1e-9);
  close((s1[1] - 0) / dt, 0.1 * (p.rho - 0) - 0, 'lorenz dy/dt', 1e-9);
  close((s1[2] - 0) / dt, 0.1 * 0 - p.beta * 0, 'lorenz dz/dt', 1e-9);
  // Uzun koşuda yörünge sınırlı kalmalı (çekici bölge)
  let s = d.start.slice();
  for (let i = 0; i < 20000; i++) s = d.step(s, p, 0.003);
  s.forEach((c, i) => assert.ok(isFinite(c) && Math.abs(c) < 200, 'lorenz sınırlı [' + i + ']=' + c));
});

test('Rössler ve Halvorsen: uzun koşuda sonlu ve sınırlı', () => {
  for (const k of ['rossler', 'halvorsen', 'thomas', 'aizawa']) {
    const d = F.ATTRACTORS[k];
    const p = F.defaults(d);
    let s = d.start.slice();
    for (let i = 0; i < 20000; i++) s = d.step(s, p, 0.002);
    s.forEach((c, i) => assert.ok(isFinite(c) && Math.abs(c) < 500, `${k} sınırlı [${i}] = ${c}`));
  }
});

test('Clifford: ilk adım tanımdan birebir', () => {
  const d = F.ATTRACTORS.clifford;
  const p = F.defaults(d);
  const s = d.step([0.1, 0.1, 0], p);
  const ex = Math.sin(p.a * 0.1) + p.c * Math.cos(p.a * 0.1);
  const ey = Math.sin(p.b * 0.1) + p.d * Math.cos(p.b * 0.1);
  close(s[0], ex, 'clifford x');
  close(s[1], ey, 'clifford y');
  // Clifford haritası |x| ≤ 1+|c|, |y| ≤ 1+|d| aralığında kalır
  let q = [0.1, 0.1, 0];
  for (let i = 0; i < 50000; i++) {
    q = d.step(q, p);
    assert.ok(Math.abs(q[0]) <= 1 + Math.abs(p.c) + 1e-12, 'clifford x sınırı');
    assert.ok(Math.abs(q[1]) <= 1 + Math.abs(p.d) + 1e-12, 'clifford y sınırı');
  }
});

test('de Jong: ilk adım tanımdan birebir ve |x|,|y| ≤ 2', () => {
  const d = F.ATTRACTORS.dejong;
  const p = F.defaults(d);
  const s = d.step([0.1, 0.1, 0], p);
  close(s[0], Math.sin(p.a * 0.1) - Math.cos(p.b * 0.1), 'dejong x');
  close(s[1], Math.sin(p.c * 0.1) - Math.cos(p.d * 0.1), 'dejong y');
  let q = [0.1, 0.1, 0];
  for (let i = 0; i < 50000; i++) {
    q = d.step(q, p);
    assert.ok(Math.abs(q[0]) <= 2 + 1e-12 && Math.abs(q[1]) <= 2 + 1e-12, 'dejong sınırı');
  }
});
