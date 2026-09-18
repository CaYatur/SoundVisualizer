'use strict';
/* PUAN, PUANA GÖRE RASTGELE SIRA VE GEÇMİŞ (#569).
 *
 * MilkDrop 2'nin kuralları (jecassis/foo_vis_milk2 5b44cea):
 *   plugin.cpp:5795-5796, state.cpp:535  puan dosyadaki fRating, yoksa 3, 0..5
 *   plugin.cpp:509                       puana göre seçim varsayılan açık
 *   plugin.cpp:5160-5199                 birikimli dağılımdan seçim; toplam
 *                                        0,1'in altındaysa düzgün seçim
 *   plugin.h:57                          geçmiş 64 adım
 *
 * Testler kuralları davranışıyla sınıyor; panelin ve ayarların bağlandığı
 * yerler kaynak üzerinden sabitleniyor. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../src/shared/milkdrop-cycle.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const bare = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
}

const milk = (rating) => 'MILKDROP_PRESET_VERSION=201\n[preset00]\n' +
  (rating === undefined ? '' : 'fRating=' + rating + '\n') + 'fDecay=0.98\n';

// ------------------------------------------------------------ dosyadaki puan

test('puan presetin kendi dosyasından: fRating, yoksa 3, 0..5 arası', () => {
  assert.strictEqual(C.fileRating(milk('4.500000')), 4.5);
  assert.strictEqual(C.fileRating(milk('0.000')), 0);
  assert.strictEqual(C.fileRating(milk()), 3, 'fRating yoksa 3 (state.cpp:535)');
  assert.strictEqual(C.fileRating(milk('7')), 5, 'üst sınır 5');
  assert.strictEqual(C.fileRating(milk('-2')), 0, 'alt sınır 0');
  assert.strictEqual(C.fileRating(milk('abc')), 3, 'okunamayan değer varsayılan');
  assert.strictEqual(C.fileRating(''), 3);
  assert.strictEqual(C.fileRating(null), 3);
  // .ini okuyucusu gibi büyük/küçük harf ayırmıyor; benzer adlı anahtara kanmıyor
  assert.strictEqual(C.fileRating('[preset00]\nFRATING=2\n'), 2);
  assert.strictEqual(C.fileRating('[preset00]\nfRatingX=1\n'), 3);
});

test('verilen puan dosyadakini eziyor; bozuksa dosyadakine dönüyor', () => {
  const p = { id: 'x', source: milk('2') };
  assert.strictEqual(C.ratingOf(p, null), 2);
  assert.strictEqual(C.ratingOf(p, { x: 5 }), 5);
  assert.strictEqual(C.ratingOf(p, { x: 0 }), 0, '0 geçerli bir puan');
  assert.strictEqual(C.ratingOf(p, { x: 'bozuk' }), 2);
  assert.strictEqual(C.ratingOf(p, { x: 9 }), 5);
  assert.strictEqual(C.ratingOf(p, { baska: 1 }), 2);
});

test('kaynak değişince dosyadaki puan yeniden okunuyor — uzunluk aynı kalsa bile', () => {
  /* fRating=3 → fRating=4 kaynağın uzunluğunu değiştirmiyor; "kimlik +
     uzunluk" anahtarlı bir önbellek bu düzenlemeyi hiç görmezdi. */
  assert.strictEqual(C.ratingOf({ id: 'y', source: milk('3') }, null), 3);
  assert.strictEqual(C.ratingOf({ id: 'y', source: milk('4') }, null), 4);
  assert.strictEqual(C.ratingOf({ id: 'y', source: milk('4.25') }, null), 4.25);
});

// ------------------------------------------------------------ ağırlıklı seçim

const W4 = [
  { id: 'a', source: milk('5') },
  { id: 'b', source: milk('1') },
  { id: 'c', source: milk('0') },
  { id: 'd', source: milk('3') },
];
const byRating = (p) => C.ratingOf(p, null);

test('rastgele sıra puanla orantılı; 0 puanlı hiç gelmiyor', () => {
  const rnd = lcg(11);
  const n = { a: 0, b: 0, c: 0, d: 0 };
  const N = 30000;
  for (let i = 0; i < N; i++) n[C.pick(W4, 'zzz', 'random', rnd, byRating).id]++;
  assert.strictEqual(n.c, 0, '0 puanlı preset seçildi');
  // 5 : 1 : 3 → 5/9, 1/9, 3/9
  const near = (got, want) => Math.abs(got / N - want) < 0.015;
  assert.ok(near(n.a, 5 / 9), 'a ' + n.a / N);
  assert.ok(near(n.b, 1 / 9), 'b ' + n.b / N);
  assert.ok(near(n.d, 3 / 9), 'd ' + n.d / N);
});

test('o an çizilen yine eleniyor; ağırlık diğerleri arasında', () => {
  const rnd = lcg(5);
  for (let i = 0; i < 2000; i++) {
    const p = C.pick(W4, 'a', 'random', rnd, byRating);
    assert.notStrictEqual(p.id, 'a');
    assert.notStrictEqual(p.id, 'c');
  }
});

test('hepsi 0 ise MilkDrop gibi düzgün seçim', () => {
  const Z = [{ id: 'a', source: milk('0') }, { id: 'b', source: milk('0') }, { id: 'c', source: milk('0') }];
  const seen = new Set();
  const rnd = lcg(2);
  for (let i = 0; i < 300; i++) seen.add(C.pick(Z, 'a', 'random', rnd, byRating).id);
  assert.deepStrictEqual([...seen].sort(), ['b', 'c']);
});

test('üretecin sınır değerleri 0 puanlı kuyruğa düşmüyor', () => {
  const T = [{ id: 'a', source: milk('5') }, { id: 'b', source: milk('2') }, { id: 'c', source: milk('0') }];
  for (const r of [0, 0.5, 0.999999, 1, NaN, -0.1]) {
    const p = C.pick(T, 'zzz', 'random', () => r, byRating);
    assert.ok(p && p.id !== 'c', 'rnd=' + r + ' → ' + (p && p.id));
  }
});

test('sırayla geçişte puan sırayı değiştirmiyor', () => {
  assert.strictEqual(C.pick(W4, 'b', 'sequential', Math.random, byRating).id, 'c',
    'sırayla: 0 puanlı da sırası gelince gösteriliyor, MilkDrop da öyle');
});

test('döngü ayardaki puanları kullanıyor; kapalıyken eşit olasılık', () => {
  const L = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const count = (md) => {
    const cy = new C.Cycle(lcg(9));
    const n = { a: 0, b: 0, c: 0 };
    let cur = 'a';
    for (let i = 0; i < 3000; i++) {
      const p = cy.step(1, Object.assign({ autoNext: 0.5, autoOrder: 'random' }, md), L, cur,
        undefined, md.ratings);
      if (p) { n[p.id]++; cur = p.id; }
    }
    return n;
  };
  const acik = count({ ratings: { b: 0 } });
  assert.strictEqual(acik.b, 0, 'b puanı 0: rastgele hiç gelmemeli');
  const kapali = count({ ratings: { b: 0 }, useRatings: false });
  assert.ok(kapali.b > 500, 'puana göre seçim kapalıyken b de gelmeli: ' + kapali.b);
});

test('varsayılan: puana göre seçim açık, verilmiş puan yok', () => {
  assert.strictEqual(C.normalize({}).useRatings, true);
  assert.strictEqual(C.normalize({ useRatings: false }).useRatings, false);
  require('../src/shared/defaults.js');
  const def = global.window.SV.defaultConfig();
  assert.strictEqual(def.milkdrop.useRatings, true);
  // Puanlar sahnenin değil kitaplığın: milkdrop bloğunda değil
  assert.strictEqual(def.milkdrop.ratings, undefined);
  assert.deepStrictEqual(def.milkdropLibrary.ratings, {});
});

// ------------------------------------------------------------ geçmiş

test('geçmiş: gösterileni kaydediyor, geri ve ileri gidiyor', () => {
  const h = new C.History(64);
  for (const id of ['a', 'b', 'c']) h.note(id);
  assert.strictEqual(h.back(), 'b');
  assert.strictEqual(h.back(), 'a');
  assert.strictEqual(h.back(), null, 'en baştan geriye gidilmiyor');
  assert.strictEqual(h.forward(), 'b');
  assert.strictEqual(h.forward(), 'c');
  assert.strictEqual(h.forward(), null);
});

test('geçmiş: aynı preset art arda iki kayıt olmuyor; geri gidilen yeniden kaydedilmiyor', () => {
  const h = new C.History(64);
  assert.strictEqual(h.note('a'), true);
  assert.strictEqual(h.note('a'), false);
  h.note('b');
  h.back();
  // görselleştirici geri gidilen preseti çizmeye başlayınca aynı kimliği bildiriyor
  assert.strictEqual(h.note('a'), false);
  assert.strictEqual(h.canForward(), true, 'ileri kısım korunmalı');
});

test('geçmiş: geri gidildikten sonra YENİ bir preset gelirse ileri kısım atılıyor', () => {
  const h = new C.History(64);
  for (const id of ['a', 'b', 'c']) h.note(id);
  h.back();
  h.back();
  h.note('x');
  assert.deepStrictEqual(h.items, ['a', 'x']);
  assert.strictEqual(h.canForward(), false);
  assert.strictEqual(h.back(), 'a');
});

test('geçmiş MilkDrop gibi 64 adım; boş kimlik kaydedilmiyor', () => {
  const h = new C.History(64);
  for (let i = 0; i < 100; i++) h.note('p' + i);
  assert.strictEqual(h.items.length, 64);
  assert.strictEqual(h.items[0], 'p36');
  let n = 0;
  while (h.back()) n++;
  assert.strictEqual(n, 63);
  assert.strictEqual(new C.History().note(''), false);
});

// ------------------------------------------------------------ panel

const PANEL = bare(read('src/admin/milkdrop-panel.js'));

test('panel: ◀ ve ▶ geçmişte geziyor, geçmiş boşsa listede', () => {
  assert.match(PANEL, /text: '◀ Önceki', onclick: back \}/);
  assert.match(PANEL, /text: 'Sonraki ▶', onclick: forward \}/);
  assert.match(PANEL, /const back = \(\) => \{[\s\S]*?h\.back\(\)[\s\S]*?step\(-1\);/);
  assert.match(PANEL, /const forward = \(\) => \{[\s\S]*?h\.forward\(\)[\s\S]*?randomPick\(cfg, md\)[\s\S]*?step\(1\);/);
  // Liste adımı ekrandakine göre, ayardaki elle seçime göre değil
  assert.match(PANEL, /presets\.findIndex\(\(p\) => p\.id === liveId\(md\)\)/);
});

test('panel: 🎲 ve ▶ motorla AYNI kuralla seçiyor', () => {
  assert.match(PANEL, /onclick: \(\) => go\(cfg, randomPick\(cfg, md\)\)/);
  assert.match(PANEL, /function randomPick\(cfg, md\) \{[\s\S]*?C\.pick\(presets, liveId\(md\), 'random', Math\.random, w\)/);
  assert.match(PANEL, /md\.useRatings === false \? null : \(p\) => C\.ratingOf\(p, ratings\)/);
});

test('panel: puan ayara yazılıyor, preset kaydına değil', () => {
  const fn = /function setRating\(id, k\) \{[\s\S]*?\n  \}/.exec(PANEL);
  assert.ok(fn, 'setRating yok');
  assert.match(fn[0], /lib\.ratings = next;/);
  assert.doesNotMatch(fn[0], /savePreset/, 'her kayıt bütün listeyi yeniden yayınlıyor');
  assert.match(PANEL, /P\(\)\.row\('Puan', stars\)/);
  assert.match(PANEL, /P\(\)\.row\('Puana Göre', selOf\(/);
});

test('panel: bayat ölçer mesajı geçmişe girmiyor; admin mesajı iletiyor', () => {
  const fn = /function noteLive\(mp\) \{[\s\S]*?\n  \}/.exec(PANEL)[0];
  assert.match(fn, /mp\.base !== manualKey\(md\)\) return;/);
  assert.match(PANEL, /const manualKey = \(md\) => \(md\.presetId \|\| ''\) \+ '\|' \+ \(md\.source \|\| ''\)\.length;/);
  // Motorun anahtarıyla aynı biçim olmalı, yoksa her mesaj bayat sayılırdı
  assert.match(bare(read('src/visualizer/modes/milkdrop.js')),
    /const man = \(c\.presetId \|\| ''\) \+ '\|' \+ \(c\.source \|\| ''\)\.length;/);
  assert.match(bare(read('src/admin/admin.js')), /window\.SVMilkdropPanel\.noteLive\(d\.mdPreset\);/);
});

test('yeni arayüz metinlerinin İngilizcesi var', () => {
  const I = read('src/shared/i18n.js');
  for (const k of ['Puan', 'Puana Göre', 'Açık (MilkDrop gibi)', 'Kapalı (eşit olasılık)']) {
    assert.ok(I.includes("'" + k + "':"), 'çevirisi yok: ' + k);
  }
  const lits = read('src/admin/milkdrop-panel.js').match(/text: '(?:[^'\\]|\\.)*'/g) || [];
  const note = lits.map((n) => n.slice('text: '.length)).find((k) => k.startsWith("'Puan presetin"));
  assert.ok(note, 'puan notu bulunamadı');
  assert.ok(I.includes(note + ':'), 'puan notunun çevirisi yok');
});
