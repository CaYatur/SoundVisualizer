'use strict';
/* Sahne geçişi testleri.
 *
 * Bir geçişin doğru olmasının ölçütü net: ilerleme 0'ken ekranın HER pikseli
 * eski sahneden, ilerleme 1'ken HER pikseli yeni sahneden gelmeli. Arada ne
 * olduğu geçişin karakteridir ve zevk meselesidir; uçlar ise değildir — orada
 * hata varsa geçiş sonunda eski sahneden bir parça ekranda kalır ya da geçiş
 * başında bir parça erken görünür.
 *
 * Bu dosya maske matematiğini test eder. Tuval birleştirmesi (Compositor)
 * tarayıcı gerektirdiği için `npm start -- --smoke` içinde ölçülür. */
const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/shared/transition.js');

const GRID = 21; // 21x21 = 441 örnek nokta

function sample(def, p, opts) {
  const out = [];
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const u = i / (GRID - 1);
      const v = j / (GRID - 1);
      out.push(def.mask(u, v, p, opts));
    }
  }
  return out;
}

const defaultsOf = (def) => {
  const o = {};
  for (const p of def.params || []) o[p.name] = p.default;
  return o;
};

// ===========================================================================
test('katalog: her geçişin etiketi ve maskesi var', () => {
  assert.ok(T.TRANSITION_IDS.length >= 16, 'geçiş sayısı: ' + T.TRANSITION_IDS.length);
  for (const id of T.TRANSITION_IDS) {
    const def = T.TRANSITIONS[id];
    assert.ok(def.label, id + ': etiket yok');
    assert.strictEqual(typeof def.mask, 'function', id + ': maske yok');
    for (const p of def.params || []) {
      assert.ok(p.name && p.label, id + '.' + p.name + ': ad/etiket eksik');
      assert.ok(p.min <= p.default && p.default <= p.max, id + '.' + p.name + ': varsayılan aralık dışında');
    }
  }
});

test('ilerleme 0: hiçbir piksel yeni sahneden gelmez', () => {
  for (const id of T.TRANSITION_IDS) {
    const def = T.TRANSITIONS[id];
    if (def.draw) continue; // çizim tabanlı geçişler maskeyle anlatılmıyor
    const vals = sample(def, 0, defaultsOf(def));
    const max = Math.max(...vals);
    assert.ok(max <= 1e-6, id + ': p=0 iken en yüksek maske ' + max.toFixed(4));
  }
});

test('ilerleme 1: her piksel yeni sahneden gelir', () => {
  for (const id of T.TRANSITION_IDS) {
    const def = T.TRANSITIONS[id];
    if (def.draw) continue;
    const vals = sample(def, 1, defaultsOf(def));
    const min = Math.min(...vals);
    assert.ok(min >= 1 - 1e-6, id + ': p=1 iken en düşük maske ' + min.toFixed(4));
  }
});

test('maske her zaman 0..1 aralığında', () => {
  for (const id of T.TRANSITION_IDS) {
    const def = T.TRANSITIONS[id];
    const o = defaultsOf(def);
    for (let k = 0; k <= 20; k++) {
      for (const val of sample(def, k / 20, o)) {
        assert.ok(val >= 0 && val <= 1 && isFinite(val), id + ' p=' + (k / 20) + ' maske ' + val);
      }
    }
  }
});

test('ortalama maske ilerlemeyle birlikte artar', () => {
  for (const id of T.TRANSITION_IDS) {
    const def = T.TRANSITIONS[id];
    if (def.draw || id === 'cut') continue;
    const o = defaultsOf(def);
    let prev = -1;
    for (let k = 0; k <= 20; k++) {
      const vals = sample(def, k / 20, o);
      const avg = vals.reduce((s, x) => s + x, 0) / vals.length;
      assert.ok(avg >= prev - 1e-9, id + ': ilerleme artarken ortalama düştü (' + avg + ' < ' + prev + ')');
      prev = avg;
    }
  }
});

test('parametre uçlarında da 0/1 güvencesi bozulmaz', () => {
  for (const id of T.TRANSITION_IDS) {
    const def = T.TRANSITIONS[id];
    if (def.draw) continue;
    for (const spec of def.params || []) {
      for (const val of [spec.min, spec.max, (spec.min + spec.max) / 2]) {
        const o = Object.assign(defaultsOf(def), { [spec.name]: val });
        assert.ok(Math.max(...sample(def, 0, o)) <= 1e-6, id + ' ' + spec.name + '=' + val + ': p=0 sızıntısı');
        assert.ok(Math.min(...sample(def, 1, o)) >= 1 - 1e-6, id + ' ' + spec.name + '=' + val + ': p=1 eksiği');
      }
    }
  }
});

// ===========================================================================
// Tek tek geçişlerin karakteri
// ===========================================================================
test('çapraz geçiş her yerde eşit', () => {
  const vals = sample(T.TRANSITIONS.crossfade, 0.37, {});
  for (const v of vals) assert.ok(Math.abs(v - 0.37) < 1e-9);
});

test('kesme ancak sonda geçer', () => {
  assert.strictEqual(T.TRANSITIONS.cut.mask(0.5, 0.5, 0.99), 0);
  assert.strictEqual(T.TRANSITIONS.cut.mask(0.5, 0.5, 1), 1);
});

test('silme açıya göre yön değiştirir', () => {
  const def = T.TRANSITIONS.wipe;
  // Açı 0: soldan sağa. Ortada, sol taraf sağdan daha ilerde olmalı.
  const left = def.mask(0.1, 0.5, 0.5, { angle: 0, softness: 0.05 });
  const right = def.mask(0.9, 0.5, 0.5, { angle: 0, softness: 0.05 });
  assert.ok(left > right, 'yatay silme yönü ters: ' + left + ' vs ' + right);
  // Açı 0.25 (90°): yukarıdan aşağı
  const top = def.mask(0.5, 0.1, 0.5, { angle: 0.25, softness: 0.05 });
  const bot = def.mask(0.5, 0.9, 0.5, { angle: 0.25, softness: 0.05 });
  assert.ok(top > bot, 'dikey silme yönü ters: ' + top + ' vs ' + bot);
});

test('dairesel silme merkezden dışa açılır', () => {
  const def = T.TRANSITIONS.radial;
  const center = def.mask(0.5, 0.5, 0.4, { softness: 0.05 });
  const corner = def.mask(0.02, 0.02, 0.4, { softness: 0.05 });
  assert.ok(center > corner, 'merkez önce açılmalı: ' + center + ' vs ' + corner);
});

test('ahır kapısı ortadan kenarlara açılır', () => {
  const def = T.TRANSITIONS.barn;
  const edge = def.mask(0.02, 0.5, 0.5, { softness: 0.05, vertical: 0 });
  const mid = def.mask(0.5, 0.5, 0.5, { softness: 0.05, vertical: 0 });
  // Kapılar ortada durur ve dışa doğru açılır: merkez önce görünür
  assert.ok(mid > edge, 'ortadan açılmalı: ' + mid + ' vs ' + edge);
  // Dikey seçeneği ekseni çevirir
  const vTop = def.mask(0.5, 0.5, 0.5, { softness: 0.05, vertical: 1 });
  const vEdge = def.mask(0.5, 0.02, 0.5, { softness: 0.05, vertical: 1 });
  assert.ok(vTop > vEdge, 'dikey ahır kapısı ters');
});

test('jaluzi şerit sayısı kadar tekrar eder', () => {
  const def = T.TRANSITIONS.blinds;
  const o = { count: 8, vertical: 0 };
  // Aynı şerit içindeki iki nokta aynı, komşu şeritteki farklı fazda olmalı
  const a = def.mask(0.5, 0.01, 0.5, o);
  const b = def.mask(0.9, 0.01, 0.5, o);
  assert.ok(Math.abs(a - b) < 1e-9, 'aynı şeritte fark var');
  const c = def.mask(0.5, 0.01 + 1 / 8, 0.5, o);
  assert.ok(Math.abs(a - c) < 1e-9, 'şerit deseni tekrar etmiyor');
});

test('erime tohumlu: aynı nokta her koşuda aynı', () => {
  const def = T.TRANSITIONS.dissolve;
  const o = { grain: 24 };
  for (let i = 0; i < 40; i++) {
    const u = i / 40;
    assert.strictEqual(def.mask(u, 0.3, 0.5, o), def.mask(u, 0.3, 0.5, o));
  }
});

test('erime deseni gerçekten dağınık (düz bir silme değil)', () => {
  const def = T.TRANSITIONS.dissolve;
  const vals = sample(def, 0.5, { grain: 24 });
  const uniq = new Set(vals.map((v) => v.toFixed(3)));
  assert.ok(uniq.size > 3, 'erime tek değere çökmüş: ' + uniq.size + ' farklı değer');
});

test('iris kenar sayısına göre şekil değiştirir', () => {
  const tri = T.TRANSITIONS.iris.mask(0.5, 0.12, 0.5, { sides: 3, softness: 0.02 });
  const many = T.TRANSITIONS.iris.mask(0.5, 0.12, 0.5, { sides: 12, softness: 0.02 });
  assert.ok(isFinite(tri) && isFinite(many));
  // Çokgenin kenar sayısı arttıkça çembere yakınsar; aynı noktada farklı olmalı
  assert.notStrictEqual(tri.toFixed(4), many.toFixed(4));
});

// ===========================================================================
// Yumuşatma ve süre
// ===========================================================================
test('yumuşatma eğrileri uçları korur ve azalmaz', () => {
  for (const id of T.EASING_IDS) {
    const f = T.EASINGS[id];
    assert.ok(Math.abs(f(0)) < 1e-9, id + ' f(0)=' + f(0));
    assert.ok(Math.abs(f(1) - 1) < 1e-9, id + ' f(1)=' + f(1));
    let prev = -1;
    for (let k = 0; k <= 20; k++) {
      const y = f(k / 20);
      assert.ok(y >= prev - 1e-9, id + ' azalıyor');
      assert.ok(y >= -1e-9 && y <= 1 + 1e-9, id + ' aralık dışı: ' + y);
      prev = y;
    }
  }
});

test('vuruş cinsinden süre tempoya göre hesaplanır', () => {
  // 120 BPM: bir vuruş 0.5 sn
  assert.ok(Math.abs(T.durationSeconds({ transition: { unit: 'beats', duration: 4 } }, 120) - 2) < 1e-9);
  assert.ok(Math.abs(T.durationSeconds({ transition: { unit: 'beats', duration: 1 } }, 174) - 60 / 174) < 1e-9);
  // Saniye cinsinden tempodan etkilenmez
  assert.strictEqual(T.durationSeconds({ transition: { unit: 'seconds', duration: 1.5 } }, 174), 1.5);
  // BPM yoksa 120 varsayılır
  assert.ok(Math.abs(T.durationSeconds({ transition: { unit: 'beats', duration: 2 } }, 0) - 1) < 1e-9);
});

test('süre hiçbir zaman sıfır ya da negatif değil', () => {
  assert.ok(T.durationSeconds({ transition: { duration: 0 } }, 120) > 0);
  assert.ok(T.durationSeconds({ transition: { duration: -5 } }, 120) > 0);
  assert.ok(T.durationSeconds({}, 120) > 0);
});

test('softEdge uçlarda kesin', () => {
  for (const soft of [0.001, 0.05, 0.2, 0.5]) {
    for (let k = 0; k <= 10; k++) {
      const pos = k / 10;
      assert.strictEqual(T.softEdge(pos, 0, soft), 0, 'p=0 sızıntısı (soft=' + soft + ')');
      assert.strictEqual(T.softEdge(pos, 1, soft), 1, 'p=1 eksiği (soft=' + soft + ')');
    }
  }
});

test('hash2 kararlı ve 0..1 aralığında', () => {
  for (let i = 0; i < 200; i++) {
    const v = T.hash2(i, i * 3 + 1);
    assert.ok(v >= 0 && v < 1, 'aralık dışı: ' + v);
    assert.strictEqual(v, T.hash2(i, i * 3 + 1), 'kararsız');
  }
});
