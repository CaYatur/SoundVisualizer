'use strict';
/* Otomatik VJ seçim ve sıra kurallarının testleri (src/shared/autovj.js).
 *
 * Bu mantık daha önce panelin çizim döngüsünün içindeydi ve sınanamıyordu.
 * Sınanamadığı için de sessizce bozuktu; buradaki testlerin çoğu gerçekten
 * yaşanmış bir hatayı sabitliyor:
 *
 *   - Varsayılan kaynak "Sahneler"di ve kayıtlı sahnesi olmayan kullanıcıda
 *     Otomatik VJ hiçbir şey yapmıyor, hiçbir şey de söylemiyordu.
 *   - Metin katmanı da kind:'visualizer' taşıdığı için tür değişimi
 *     kullanıcının METİN katmanını spektrum çizerine çeviriyordu.
 *   - Tek bir imleç hem öğe seçimini hem "Hepsi" tur sırasını yürütüyordu;
 *     ikisi birbirini bozuyordu.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const A = require('../src/shared/autovj.js');

const scenes = [
  { id: 's1', name: 'Açılış', data: {} },
  { id: 's2', name: 'Nakarat', data: {} },
  { id: 's3', name: 'Final', data: {} },
];
const builtinPalettes = [
  { id: 'b1', name: 'Gün Batımı', colors: ['#111', '#222', '#333', '#444', '#555'] },
  { id: 'b2', name: 'Okyanus', colors: ['#011', '#022', '#033', '#044', '#055'] },
];
const userPalettes = [
  { id: 'u1', name: 'Benimki', colors: ['#a11', '#a22', '#a33', '#a44', '#a55'] },
];
const ctx = { scenes, builtinPalettes, userPalettes };

test('varsayılanlar ve normalize', () => {
  const d = A.defaults();
  assert.strictEqual(d.enabled, false);
  assert.deepStrictEqual(d.picks, { scenes: [], visualizers: [], palettes: [] });

  /* Eski ayar dosyalarında picks ve yeni alanlar yok; eksik alan yüzünden
     çökmek yerine varsayılana düşmeli. */
  const n = A.normalize({ enabled: true, source: 'visualizers', interval: 8 });
  assert.deepStrictEqual(n.picks, { scenes: [], visualizers: [], palettes: [] });
  assert.strictEqual(n.paletteSource, 'both');
  assert.strictEqual(n.visualizerTargets, 'all');

  // Geçersiz değerler kırpılır
  assert.strictEqual(A.normalize({ source: 'saçma' }).source, A.defaults().source);
  assert.strictEqual(A.normalize({ interval: 9999 }).interval, 64);
  assert.strictEqual(A.normalize({ interval: 0 }).interval, 1);
  assert.strictEqual(A.normalize({ beatsPerBar: 99 }).beatsPerBar, 16);
  assert.strictEqual(A.normalize(null).enabled, false);
  // Bilinmeyen görselleştirici seçimi atılır
  assert.deepStrictEqual(
    A.normalize({ picks: { visualizers: ['bars', 'uydurma'] } }).picks.visualizers,
    ['bars']
  );
});

// ------------------------------------------------------------- katmanlar

test('metin katmanı asla görselleştirici sayılmıyor', () => {
  /* GERÇEK HATA: metin katmanı kind:'visualizer' ve type:'text' taşıyor.
     Eski kod cfg.layers.find((l) => l.kind === 'visualizer') diyordu ve
     kullanıcının metin katmanını bulup türünü 'bars' yapıyordu. Geri
     alınamayan bir kayıp. */
  const textLayer = { kind: 'visualizer', type: 'text', enabled: true };
  assert.ok(A.isTextLayer(textLayer));
  assert.ok(!A.isTextLayer({ kind: 'visualizer', type: 'bars' }));
  assert.ok(!A.isTextLayer({ kind: 'media' }));
  assert.ok(!A.isTextLayer(null));

  const layers = [
    textLayer,
    { kind: 'visualizer', type: 'bars', enabled: true },
    { kind: 'media' },
    { kind: 'visualizer', type: 'wave', enabled: true },
  ];
  const got = A.visualizerLayers(layers);
  assert.strictEqual(got.length, 2, 'metin katmanı listeye girdi');
  assert.ok(got.every((l) => l.type !== 'text'));

  /* Eski davranışın yanlış olduğunu da göster: naif arama metin katmanını
     BULUYOR. Bu satır, testin gerçek bir hatayı sabitlediğinin kanıtı. */
  const naive = layers.find((l) => l && l.kind === 'visualizer');
  assert.strictEqual(naive.type, 'text', 'naif arama artık metni bulmuyorsa bu test anlamını yitirdi');
});

test('kapalı katmanın türü değiştirilmiyor', () => {
  /* Kapalı katmanı değiştirmek ekranda hiçbir şey yapmaz ama kullanıcının
     ayarını sessizce bozar — sonra açtığında başka bir şey bulur. */
  const layers = [
    { kind: 'visualizer', type: 'bars', enabled: false },
    { kind: 'visualizer', type: 'wave', enabled: true },
  ];
  assert.deepStrictEqual(A.visualizerLayers(layers).map((l) => l.type), ['wave']);
});

test('birden fazla görselleştirici katmanı görülüyor', () => {
  /* Eski kod yalnızca İLK katmanı buluyordu; iki görselleştiricili sahnede
     ikincisi hiç değişmiyordu. */
  const layers = [
    { kind: 'visualizer', type: 'bars', enabled: true },
    { kind: 'visualizer', type: 'wave', enabled: true },
    { kind: 'visualizer', type: 'orb', enabled: true },
  ];
  assert.strictEqual(A.visualizerLayers(layers).length, 3);
});

// --------------------------------------------------------------- adaylar

test('sahne kataloğu', () => {
  const list = A.catalog('scenes', ctx);
  assert.deepStrictEqual(list.map((x) => x.id), ['s1', 's2', 's3']);
  assert.deepStrictEqual(list.map((x) => x.label), ['Açılış', 'Nakarat', 'Final']);
  assert.deepStrictEqual(A.catalog('scenes', {}), []);
});

test('palet kataloğu kaynağa göre süzülüyor', () => {
  const both = A.catalog('palettes', Object.assign({ paletteSource: 'both' }, ctx));
  const builtin = A.catalog('palettes', Object.assign({ paletteSource: 'builtin' }, ctx));
  const user = A.catalog('palettes', Object.assign({ paletteSource: 'user' }, ctx));
  assert.strictEqual(both.length, 3);
  assert.strictEqual(builtin.length, 2);
  assert.strictEqual(user.length, 1);
  assert.strictEqual(user[0].label, 'Benimki');
  assert.ok(builtin.every((p) => p.builtin));
  assert.ok(user.every((p) => !p.builtin));

  // Renksiz giriş listeye alınmaz — uygulanınca hiçbir şey yapmazdı
  const broken = A.catalog('palettes', { builtinPalettes: [{ name: 'boş' }, { name: 'iyi', colors: ['#fff'] }] });
  assert.deepStrictEqual(broken.map((p) => p.label), ['iyi']);
});

test('görselleştirici kataloğunda none ve text yok', () => {
  /* 'none' ekranı boşaltırdı, 'text' zaten bir görselleştirici değil. */
  assert.ok(A.VISUALIZERS.indexOf('none') < 0);
  assert.ok(A.VISUALIZERS.indexOf('text') < 0);
  assert.ok(A.VISUALIZERS.length > 20);
});

// ----------------------------------------------------------------- seçim

test('boş seçim listesi "hepsi" demek', () => {
  assert.strictEqual(A.selected('scenes', { picks: { scenes: [] } }, ctx).length, 3);
});

test('seçim listesi süzüyor', () => {
  const got = A.selected('scenes', { picks: { scenes: ['s1', 's3'] } }, ctx);
  assert.deepStrictEqual(got.map((x) => x.id), ['s1', 's3']);
});

test('silinmiş seçimler hepsine düşüyor', () => {
  /* Kullanıcı seçtiği sahneleri sildiyse Otomatik VJ durmamalı: sebebi
     görünmeyen bir durma, çalışmayan bir özellikle aynı şeydir. */
  const got = A.selected('scenes', { picks: { scenes: ['silinmis1', 'silinmis2'] } }, ctx);
  assert.strictEqual(got.length, 3, 'geçersiz seçim listesi Otomatik VJ\'yi durdurdu');
});

// ------------------------------------------------------------------ sıra

test('sırayla dolaşım listeyi tur atıyor', () => {
  let c = -1;
  const seen = [];
  for (let k = 0; k < 7; k++) {
    c = A.nextIndex(3, 'sequential', c, null);
    seen.push(c);
  }
  assert.deepStrictEqual(seen, [0, 1, 2, 0, 1, 2, 0]);
});

test('rastgele aynı öğeyi üst üste vermiyor', () => {
  /* Aynı görselleştiriciye ikinci kez geçmek kullanıcıya "durdu" diye
     görünüyor — şikâyetin bir parçası buydu. */
  let prev = 2;
  for (let k = 0; k < 300; k++) {
    const i = A.nextIndex(5, 'random', -1, prev);
    assert.ok(i >= 0 && i < 5);
    assert.notStrictEqual(i, prev, 'rastgele aynı öğeyi tekrarladı');
    prev = i;
  }
  // Tek öğede kural uygulanamaz
  assert.strictEqual(A.nextIndex(1, 'random', -1, 0), 0);
  assert.strictEqual(A.nextIndex(0, 'random', -1, null), -1);
});

test('Hepsi kipinde boş türler atlanıyor', () => {
  /* Sahnesi olmayan kullanıcıda "Hepsi" her üç turdan birini boşa
     harcamamalı. */
  const noScenes = { builtinPalettes, userPalettes };
  const seen = [];
  let c = -1;
  for (let k = 0; k < 6; k++) {
    const kind = A.nextKind({ source: 'all' }, noScenes, c);
    seen.push(kind);
    c++;
  }
  assert.ok(seen.indexOf('scenes') < 0, 'boş sahne türü tura girdi: ' + seen.join(','));
  assert.ok(seen.indexOf('visualizers') >= 0);
  assert.ok(seen.indexOf('palettes') >= 0);

  /* Sahnesi ve paleti olmayan kullanıcıda bile "Hepsi" çalışır: görselleştirici
     listesi statiktir, boşalamaz. Eski kod burada hiçbir şey yapmıyordu. */
  assert.strictEqual(A.nextKind({ source: 'all' }, {}, -1), 'visualizers');
});

// ------------------------------------------------------------------ plan

test('plan çalışan durumda ne değişeceğini söylüyor', () => {
  const r = A.plan({ source: 'scenes' }, ctx, null);
  assert.ok(r.ok);
  assert.strictEqual(r.kind, 'scenes');
  assert.strictEqual(r.item.id, 's1');
  assert.ok(r.state && r.state.cursors);
});

test('plan SESSİZ KALMIYOR: sahne yokken sebebini söylüyor', () => {
  /* Kullanıcının asıl şikâyeti buydu. Varsayılan kaynak "Sahneler",
     kayıtlı sahne yok, ve eskiden applySwitch() yalnızca false dönüyordu —
     ne ekranda ne panelde tek kelime. */
  const r = A.plan({ source: 'scenes' }, { scenes: [] }, null);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'EMPTY');
  assert.strictEqual(r.kind, 'scenes');

  const d = A.diagnose({ source: 'scenes' }, { scenes: [] });
  assert.strictEqual(d.ok, false);
  assert.strictEqual(d.code, 'EMPTY');
});

test('diagnose çalışabilir durumu da bildiriyor', () => {
  const d = A.diagnose({ source: 'scenes' }, ctx);
  assert.ok(d.ok);
  assert.strictEqual(d.count, 3);

  const all = A.diagnose({ source: 'all' }, ctx);
  assert.ok(all.ok);
  assert.deepStrictEqual(all.kinds.sort(), ['palettes', 'scenes', 'visualizers']);

  /* Hepsi kipi her zaman çalışır; verdiği bilgi HANGİ türlerin sıraya
     girdiği ve hangilerinin atlandığı. */
  const bare = A.diagnose({ source: 'all' }, {});
  assert.ok(bare.ok);
  assert.deepStrictEqual(bare.kinds, ['visualizers']);
  assert.deepStrictEqual(bare.skipped.sort(), ['palettes', 'scenes']);
});

test('imleçler kaynak başına AYRI ilerliyor', () => {
  /* GERÇEK HATA: tek bir imleç hem "sırada hangi öğe" hem "Hepsi kipinde
     sırada hangi tür" sorusunu cevaplıyordu. Öğe seçimi imleci ilerlettiği
     için tür dönüşümü düzensiz atlıyordu.

     Burada sahne turları görselleştirici turunu bozmamalı. */
  let st = null;
  const sceneOrder = [];
  for (let k = 0; k < 3; k++) {
    const r = A.plan({ source: 'scenes' }, ctx, st);
    st = r.state;
    sceneOrder.push(r.item.id);
  }
  assert.deepStrictEqual(sceneOrder, ['s1', 's2', 's3']);

  // Araya görselleştirici turları girsin
  for (let k = 0; k < 5; k++) {
    st = A.plan({ source: 'visualizers' }, ctx, st).state;
  }
  // Sahne turu kaldığı yerden devam etmeli
  const next = A.plan({ source: 'scenes' }, ctx, st);
  assert.strictEqual(next.item.id, 's1', 'sahne imleci başka bir kaynak yüzünden kaydı');
});

test('Hepsi kipi türler arasında gerçekten dönüyor', () => {
  let st = null;
  const kinds = [];
  for (let k = 0; k < 6; k++) {
    const r = A.plan({ source: 'all' }, ctx, st);
    assert.ok(r.ok);
    st = r.state;
    kinds.push(r.kind);
  }
  assert.strictEqual(new Set(kinds).size, 3, 'Hepsi kipi tüm türleri dolaşmadı: ' + kinds.join(','));
});

// ------------------------------------------------- kaynakla eşleşme koruması

test('görselleştirici listesi panelin tür seçicisiyle aynı', () => {
  /* Liste iki yerde: burada (dolaşım için) ve admin.js'te (kullanıcının tür
     seçicisi). Biri diğerinden koparsa Otomatik VJ ya var olmayan bir türe
     geçer ya da yeni eklenen türü hiç göstermez. İkisi de sessiz olurdu. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.js'), 'utf-8');
  const i = src.indexOf("path: 'visualizer.type'");
  assert.ok(i > 0, 'tür seçicisi admin.js içinde bulunamadı');
  const block = src.slice(i, src.indexOf('],', src.indexOf('options: [', i)));

  const found = [];
  const re = /\{\s*value:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(block))) found.push(m[1]);
  assert.ok(found.length > 20, 'seçiciden tür okunamadı: ' + found.length);

  /* Üç tür bilerek dışlanıyor: 'none' ekranı boşaltır, 'text' bir
     görselleştirici değil, 'custom' preset seçilmemişse hiçbir şey çizmez. */
  const EXCLUDED = ['none', 'text', 'custom'];
  for (const v of EXCLUDED) {
    assert.ok(found.indexOf(v) >= 0, 'dışlama listesi eskimiş, panelde yok: ' + v);
    assert.ok(A.VISUALIZERS.indexOf(v) < 0, 'dışlanması gereken tür dolaşımda: ' + v);
  }
  const usable = found.filter((v) => EXCLUDED.indexOf(v) < 0);
  const missing = usable.filter((v) => A.VISUALIZERS.indexOf(v) < 0);
  const extra = A.VISUALIZERS.filter((v) => usable.indexOf(v) < 0);
  assert.deepStrictEqual(missing, [], 'panelde var, Otomatik VJ listesinde yok: ' + missing.join(', '));
  assert.deepStrictEqual(extra, [], 'Otomatik VJ listesinde var, panelde yok: ' + extra.join(', '));
});
