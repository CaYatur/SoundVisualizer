'use strict';
/* Formül sağlık taraması — kitaplıktaki HER formül için, ayrım yapmadan.
 *
 *   node --test tests/
 *
 * tests/formulas.test.js belirli formüllerin bilinen noktalardaki değerini
 * elle türetilmiş sayılarla karşılaştırır. Bu dosya tamamlayıcıdır ve farklı
 * bir soruyu yanıtlar: "kitaplıktaki her formül gerçekten çalışıyor mu?"
 *
 * Her formül için üç şey aranır:
 *   1. Sonluluk  — hiçbir örnek NaN/Infinity olmamalı (parametre uçlarında da)
 *   2. Sınırlılık — çıktı makul bir kutunun içinde kalmalı
 *   3. Anlamlılık — varsayılan parametrelerle sonuç tek bir noktaya çökmemeli
 *
 * Bu tarama yeni formül eklendiğinde otomatik olarak onu da kapsar; kitaplık
 * büyüdükçe listeye el ile bir şey eklemek gerekmez. */
const test = require('node:test');
const assert = require('node:assert');
const F = require('../src/shared/formulas.js');
require('../src/shared/formulas-extra.js'); // ikinci bölüm de taranmalı

// Çizim uzayı normalize edilmiş kabul edilir; buradaki sınır cömerttir ve
// yalnızca "patlamış" formülü yakalamayı amaçlar.
const MAX_ABS = 1e4;
const SAMPLES = 97;        // asal: periyodik formüllerde örnekleme çakışmasını önler
const SURF_SAMPLES = 23;

// Parametrelerin süpürüleceği noktalar (min / varsayılan / orta / max)
function paramSets(def) {
  const base = F.defaults(def);
  const sets = [{ name: 'varsayılan', p: base }];
  for (const spec of def.params || []) {
    for (const [tag, val] of [['min', spec.min], ['max', spec.max], ['orta', (spec.min + spec.max) / 2]]) {
      sets.push({ name: `${spec.name}=${tag}`, p: Object.assign({}, base, { [spec.name]: val }) });
    }
  }
  return sets;
}

function checkPoint(pt, where) {
  assert.ok(Array.isArray(pt), where + ': dizi döndürmeli');
  for (let i = 0; i < pt.length; i++) {
    const c = pt[i];
    assert.ok(typeof c === 'number' && isFinite(c), `${where}: bileşen[${i}] sonlu değil (${c})`);
    assert.ok(Math.abs(c) <= MAX_ABS, `${where}: bileşen[${i}] sınır dışı (${c})`);
  }
}

// Nokta bulutunun en geniş ekseni — çökmüş formülü yakalar
function spread(points) {
  if (!points.length) return 0;
  const dim = points[0].length;
  let best = 0;
  for (let d = 0; d < dim; d++) {
    let lo = Infinity, hi = -Infinity;
    for (const pt of points) { if (pt[d] < lo) lo = pt[d]; if (pt[d] > hi) hi = pt[d]; }
    best = Math.max(best, hi - lo);
  }
  return best;
}

function sampleCurve(def, p) {
  const out = [];
  for (let i = 0; i < SAMPLES; i++) out.push(def.f(i / (SAMPLES - 1), p));
  return out;
}

function sampleSurface(def, p) {
  const out = [];
  for (let i = 0; i < SURF_SAMPLES; i++) {
    for (let j = 0; j < SURF_SAMPLES; j++) {
      out.push(def.f(i / (SURF_SAMPLES - 1), j / (SURF_SAMPLES - 1), p));
    }
  }
  return out;
}

// Çekiciler motorun kullandığı korumalı yineleyiciden geçirilir; test edilen
// şey bu yüzden gerçekten çalıştırılan koddur. dt, panelin kaydırıcı
// aralığının uçlarını da kapsar (0.0005 .. 0.02).
function sampleAttractor(def, p, steps, dt) {
  const out = [];
  F.iterate(def, p, { steps, dt: dt == null ? 0.006 : dt, skip: 200, onPoint: (q) => out.push(q.slice()) });
  return out;
}

const ATTRACTOR_STEPS = [0.0005, 0.006, 0.02];

const catalog = F.catalog();

test('kitaplık boş değil ve her girdi eksiksiz', () => {
  assert.ok(catalog.length >= 95, 'formül sayısı: ' + catalog.length);
  const seen = new Set();
  for (const e of catalog) {
    const id = e.family + ':' + e.key;
    assert.ok(!seen.has(id), 'yinelenen formül anahtarı: ' + id);
    seen.add(id);
    assert.ok(e.label && typeof e.label === 'string', id + ': etiket yok');
    assert.ok(Array.isArray(e.params), id + ': parametre listesi yok');
    for (const p of e.params) {
      assert.ok(p.name && p.label, id + '.' + p.name + ': ad/etiket eksik');
      assert.ok(typeof p.default === 'number' && isFinite(p.default), id + '.' + p.name + ': varsayılan sayı değil');
      assert.ok(p.min <= p.default && p.default <= p.max, id + '.' + p.name + ': varsayılan aralık dışında');
      assert.ok(p.step > 0, id + '.' + p.name + ': adım pozitif olmalı');
    }
    // Arayüz ailelere göre dallanıyor; get() her zaman tanımı bulabilmeli
    assert.ok(F.get(e.family, e.key), id + ': get() bulamadı');
  }
});

for (const entry of catalog) {
  const def = F.get(entry.family, entry.key);
  const id = `${entry.family}/${entry.key}`;

  test(`${id}: parametre uçlarında sonlu ve sınırlı`, () => {
    for (const { name, p } of paramSets(def)) {
      const where = `${id} (${name})`;
      let points;
      if (entry.family === 'surface') {
        points = sampleSurface(def, p);
        for (const pt of points) checkPoint(pt, where);
      } else if (entry.family === 'attractor') {
        // Her integrasyon adımında sınırlı kalmalı — kullanıcı kaydırıcıyı
        // uca çektiğinde de geometri bozulmamalı
        for (const dt of ATTRACTOR_STEPS) {
          for (const pt of sampleAttractor(def, p, 4000, dt)) checkPoint(pt, where + ' dt=' + dt);
        }
      } else {
        points = sampleCurve(def, p);
        for (const pt of points) checkPoint(pt, where);
      }
    }
  });

  test(`${id}: varsayılan parametrelerle tek noktaya çökmüyor`, () => {
    const p = F.defaults(def);
    let points;
    if (entry.family === 'surface') points = sampleSurface(def, p);
    else if (entry.family === 'attractor') points = sampleAttractor(def, p, 20000).slice(1000);

    else points = sampleCurve(def, p);
    assert.ok(spread(points) > 1e-3, `${id}: nokta bulutu çökmüş (yayılım ${spread(points)})`);
  });

  if (entry.family !== 'attractor') {
    test(`${id}: aynı girdi aynı çıktıyı veriyor (deterministik)`, () => {
      const p = F.defaults(def);
      const a = entry.family === 'surface' ? def.f(0.37, 0.61, p) : def.f(0.37, p);
      const b = entry.family === 'surface' ? def.f(0.37, 0.61, p) : def.f(0.37, p);
      assert.deepStrictEqual(a, b, id + ': çıktı deterministik değil');
    });
  }
}

// ===========================================================================
// Çerçeveleme
// ===========================================================================
test('her çekicinin yörüngesi birim kutuya oturtulabiliyor', () => {
  /* 3B motoru çekiciyi ekrana yerleştirirken çerçeveyi ÖLÇEREK buluyor
     (bkz. geometry3d.js: buildAttractor). Bu testin ölçtüğü şey aynı
     hesabın kendisi: yörüngenin sonlu bir sınır kutusu olmalı ve o kutu
     yozlaşmamalı, yoksa ölçek sıfıra ya da sonsuza giderdi.

     Elle yazılmış çerçeve alanları tam olarak burada yanlıştı: Lorenz'in
     merkezi ters işaretle, Chen'in ölçeği kırk kat küçük yazılmıştı. */
  for (const entry of catalog.filter((e) => e.family === 'attractor')) {
    const def = F.get('attractor', entry.key);
    const p = F.defaults(def);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    F.iterate(def, p, {
      steps: 8000, dt: 0.006, skip: 500,
      onPoint: (q) => {
        for (let k = 0; k < 3; k++) {
          if (q[k] < lo[k]) lo[k] = q[k];
          if (q[k] > hi[k]) hi[k] = q[k];
        }
      },
    });
    let span = 0;
    for (let k = 0; k < 3; k++) {
      assert.ok(isFinite(lo[k]) && isFinite(hi[k]), entry.key + ': sınır kutusu sonlu değil');
      span = Math.max(span, hi[k] - lo[k]);
    }
    assert.ok(span > 1e-3, entry.key + ': yörünge yozlaşmış (yayılım ' + span + ')');
    assert.ok(span < 1e5, entry.key + ': yörünge aşırı büyük (yayılım ' + span + ')');

    // Ölçeklenip merkezlendiğinde birim kutuya sığmalı
    const c = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
    const scale = 1.7 / span;
    for (let k = 0; k < 3; k++) {
      const half = Math.max(Math.abs(lo[k] - c[k]), Math.abs(hi[k] - c[k])) * scale;
      assert.ok(half <= 0.86, entry.key + ': eksen ' + k + ' kutuya sığmıyor (' + half.toFixed(3) + ')');
    }
  }
});
