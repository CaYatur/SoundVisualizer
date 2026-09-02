'use strict';
/* Katı geometri testleri.
 *
 * Ölçüt parametrik formüllerdekiyle aynı: her şekil, her parametre ucunda
 * sonlu, sınırlı ve tek noktaya çökmemiş bir AĞ üretmeli. Fark, burada
 * çıktının bir nokta değil bir ağ olması — o yüzden ayrıca indekslerin
 * geçerli olduğu ve normallerin birim uzunlukta kaldığı da kontrol ediliyor.
 * Geçersiz bir indeks GPU'da tanımsız davranış demek ve genellikle sessizce
 * boş ekran verir. */
const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/shared/solids.js');

const cat = S.catalog();

function paramSets(def) {
  const base = S.defaults(def);
  const sets = [{ name: 'varsayılan', p: base }];
  for (const spec of def.params || []) {
    for (const [tag, val] of [['min', spec.min], ['max', spec.max]]) {
      sets.push({ name: spec.name + '=' + tag, p: Object.assign({}, base, { [spec.name]: val }) });
    }
  }
  return sets;
}

function spread(pos) {
  let best = 0;
  for (let k = 0; k < 3; k++) {
    let lo = Infinity, hi = -Infinity;
    for (let i = k; i < pos.length; i += 3) { if (pos[i] < lo) lo = pos[i]; if (pos[i] > hi) hi = pos[i]; }
    best = Math.max(best, hi - lo);
  }
  return best;
}

test('katalog eksiksiz ve benzersiz', () => {
  assert.ok(cat.length >= 12, 'katı sayısı: ' + cat.length);
  const seen = new Set();
  for (const e of cat) {
    assert.ok(!seen.has(e.key), 'yinelenen anahtar: ' + e.key);
    seen.add(e.key);
    assert.ok(e.label, e.key + ': etiket yok');
    assert.strictEqual(e.family, 'solid');
    for (const p of e.params) {
      assert.ok(p.min <= p.default && p.default <= p.max, e.key + '.' + p.name + ': varsayılan aralık dışında');
      assert.ok(p.step > 0, e.key + '.' + p.name + ': adım pozitif olmalı');
    }
  }
});

for (const entry of cat) {
  const def = S.SOLIDS[entry.key];

  test(entry.key + ': her parametre ucunda geçerli ağ üretir', () => {
    for (const { name, p } of paramSets(def)) {
      const m = def.build(p);
      const where = entry.key + ' (' + name + ')';
      assert.ok(m && m.pos && m.pos.length, where + ': ağ boş');
      assert.strictEqual(m.pos.length % 3, 0, where + ': konum dizisi üçün katı değil');
      assert.strictEqual(m.nor.length, m.pos.length, where + ': normal sayısı uyuşmuyor');
      assert.strictEqual(m.uvs.length / 2, m.pos.length / 3, where + ': uv sayısı uyuşmuyor');
      for (let i = 0; i < m.pos.length; i++) {
        assert.ok(isFinite(m.pos[i]), where + ': konum sonlu değil');
        assert.ok(Math.abs(m.pos[i]) < 100, where + ': konum sınır dışı (' + m.pos[i] + ')');
      }
      // İndeksler dizinin içinde olmalı; taşan bir indeks GPU'da tanımsız
      const n = m.pos.length / 3;
      for (const arr of [m.tri, m.line]) {
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          assert.ok(arr[i] >= 0 && arr[i] < n, where + ': indeks aralık dışı (' + arr[i] + ' / ' + n + ')');
        }
      }
    }
  });

  test(entry.key + ': varsayılanda tek noktaya çökmez', () => {
    const m = def.build(S.defaults(def));
    assert.ok(spread(m.pos) > 0.01, entry.key + ': yayılım ' + spread(m.pos));
  });

  test(entry.key + ': aynı parametre aynı ağı verir', () => {
    const a = def.build(S.defaults(def));
    const b = def.build(S.defaults(def));
    assert.strictEqual(a.pos.length, b.pos.length, entry.key + ': köşe sayısı değişti');
    for (let i = 0; i < a.pos.length; i += Math.max(1, Math.floor(a.pos.length / 500))) {
      assert.strictEqual(a.pos[i], b.pos[i], entry.key + ': belirlenimli değil (indeks ' + i + ')');
    }
  });
}

test('çokyüzlülerin normalleri birim uzunlukta', () => {
  for (const key of ['tetrahedron', 'cube', 'octahedron', 'dodecahedron', 'icosahedron', 'geodesic']) {
    const def = S.SOLIDS[key];
    const m = def.build(S.defaults(def));
    for (let i = 0; i < m.nor.length; i += 3) {
      const l = Math.hypot(m.nor[i], m.nor[i + 1], m.nor[i + 2]);
      assert.ok(Math.abs(l - 1) < 1e-4, key + ': normal uzunluğu ' + l);
    }
  }
});

test('çokyüzlüler tel kafes ağı da verir', () => {
  for (const key of ['tetrahedron', 'cube', 'icosahedron', 'geodesic']) {
    const m = S.SOLIDS[key].build(S.defaults(S.SOLIDS[key]));
    assert.ok(m.wire && m.wire.line && m.wire.line.length, key + ': tel kafes yok');
    const n = m.wire.pos.length / 3;
    for (let i = 0; i < m.wire.line.length; i++) {
      assert.ok(m.wire.line[i] < n, key + ': tel kafes indeksi aralık dışı');
    }
  }
});

test('düzgün çokyüzlülerin köşeleri merkeze eşit uzaklıkta', () => {
  // Düzgün bir çokyüzlünün tanımı bu; ölçüm birebir yapılabilir
  for (const key of ['tetrahedron', 'cube', 'octahedron', 'dodecahedron', 'icosahedron']) {
    const def = S.PLATONIC[key];
    const r0 = Math.hypot(def.verts[0][0], def.verts[0][1], def.verts[0][2]);
    for (const v of def.verts) {
      const r = Math.hypot(v[0], v[1], v[2]);
      assert.ok(Math.abs(r - r0) < 1e-9, key + ': köşe yarıçapı farklı (' + r + ' vs ' + r0 + ')');
    }
  }
});

test('jeodezik alt bölünme dörde katlar', () => {
  // Her alt bölünme her üçgeni dörde böler
  let prev = 0;
  for (let n = 0; n <= 3; n++) {
    const m = S.geodesic(n, 1);
    const tris = m.tri.length / 3;
    assert.strictEqual(tris, 20 * Math.pow(4, n), 'alt bölünme ' + n + ': ' + tris + ' üçgen');
    assert.ok(tris > prev);
    prev = tris;
  }
});

test('jeodezik köşeleri küre üzerinde', () => {
  const m = S.geodesic(2, 1);
  for (let i = 0; i < m.pos.length; i += 3) {
    const r = Math.hypot(m.pos[i], m.pos[i + 1], m.pos[i + 2]);
    assert.ok(Math.abs(r - 1) < 1e-5, 'küre üzerinde değil: ' + r);
  }
});

test('IFS bulutları tohumlu ve tekrarlanabilir', () => {
  const a = S.ifsCloud('barnsley', 5000, 0.16, 999);
  const b = S.ifsCloud('barnsley', 5000, 0.16, 999);
  for (let i = 0; i < a.pos.length; i += 97) assert.strictEqual(a.pos[i], b.pos[i], 'indeks ' + i);
  const c = S.ifsCloud('barnsley', 5000, 0.16, 1000);
  let differs = false;
  for (let i = 0; i < a.pos.length; i += 97) if (a.pos[i] !== c.pos[i]) { differs = true; break; }
  assert.ok(differs, 'farklı tohum aynı bulutu verdi');
});

test('L-sistem dizesi patlamaz', () => {
  // Yineleme üst sınırı olmadan bir L-sistem üstel büyür ve ağ kurulumu kilitlenir
  const m = S.lsystem('tree', 99, 22.5, 1);
  assert.ok(m.count > 0 && m.count <= 120001, 'köşe sayısı: ' + m.count);
  for (let i = 0; i < m.pos.length; i++) assert.ok(isFinite(m.pos[i]));
});

test('bozuk girdilerde çökmez', () => {
  assert.doesNotThrow(() => {
    S.lsystem('bilinmeyen', 3, 20, 1);
    S.ifsCloud('bilinmeyen', 100, 1, 1);
    S.platonic('bilinmeyen', 1);
    S.geodesic(-5, 1);
    S.geodesic(99, 1);
  });
});
