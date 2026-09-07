'use strict';
/* Uyarlanır renk teması motorunun testleri.
 *
 * Bu modül saf ve deterministik: içeri piksel ya da metin girer, dışarı beş
 * onaltılık renk çıkar. Hata verdiğinde çökmüyor — yalnızca YANLIŞ renk
 * üretiyor, ki bunu gözle yakalamak zor. Ekranda "biraz tuhaf" duran bir
 * palet ile bozuk bir palet birbirine benziyor.
 *
 * O yüzden burada iki şey sınanıyor: dönüşümlerin bilinen değerleri, ve her
 * yolun DEĞİŞMEZLERİ — her zaman beş renk, her zaman geçerli onaltılık, geri
 * çağırım her zaman tam bir kez. Bunlar bozulursa arkaplan gradyanı sessizce
 * boş kalırdı.
 */

const test = require('node:test');
const assert = require('node:assert');
const A = require('../src/shared/adaptive-theme.js');

const HEX = /^#[0-9a-f]{6}$/;

// Beş geçerli renk + ana/ikincil: tüm üreticilerin ortak sözleşmesi
function assertPalette(res, label) {
  assert.ok(res, label + ': sonuç yok');
  assert.strictEqual(res.colors.length, 5, label + ': beş renk olmalı');
  for (const c of res.colors) {
    assert.match(c, HEX, label + ': geçersiz renk ' + c);
  }
  assert.match(res.color, HEX, label + ': ana renk geçersiz');
  assert.match(res.color2, HEX, label + ': ikincil renk geçersiz');
}

// Düz renkli bir görüntünün piksel dizisi
function solid(r, g, b, n) {
  const d = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
  }
  return d;
}

// --------------------------------------------------------- renk dönüşümleri

test('rgbToHsl saf renkleri bilinen tonlara çevirir', () => {
  assert.deepStrictEqual(A.rgbToHsl(255, 0, 0), [0, 1, 0.5]);
  assert.deepStrictEqual(A.rgbToHsl(0, 255, 0), [120, 1, 0.5]);
  assert.deepStrictEqual(A.rgbToHsl(0, 0, 255), [240, 1, 0.5]);
});

test('griler doygunluksuz, uçlar sıfır ve bir aydınlıkta', () => {
  const [, sGray] = A.rgbToHsl(128, 128, 128);
  assert.strictEqual(sGray, 0);
  assert.deepStrictEqual(A.rgbToHsl(0, 0, 0), [0, 0, 0]);
  assert.deepStrictEqual(A.rgbToHsl(255, 255, 255), [0, 0, 1]);
});

test('hslToHex saf tonları bilinen kodlara çevirir', () => {
  assert.strictEqual(A.hslToHex(0, 1, 0.5), '#ff0000');
  assert.strictEqual(A.hslToHex(120, 1, 0.5), '#00ff00');
  assert.strictEqual(A.hslToHex(240, 1, 0.5), '#0000ff');
});

/* Ton bir çember: armonik paletler taşan açılar üretiyor (baseHue + 240),
   sarmalanmazsa renk siyaha düşerdi. */
test('ton çemberde sarmalanır', () => {
  assert.strictEqual(A.hslToHex(-60, 1, 0.5), A.hslToHex(300, 1, 0.5));
  assert.strictEqual(A.hslToHex(420, 1, 0.5), A.hslToHex(60, 1, 0.5));
});

test('doygunluk ve aydınlık sınırlanır', () => {
  assert.strictEqual(A.hslToHex(0, 5, 0.5), A.hslToHex(0, 1, 0.5));
  assert.strictEqual(A.hslToHex(0, 1, 9), '#ffffff');
  assert.strictEqual(A.hslToHex(0, 1, -9), '#000000');
});

test('hexToRgb üç ve altı haneyi, diyezli ve diyezsiz okur', () => {
  assert.deepStrictEqual(A.hexToRgb('#f00'), [255, 0, 0]);
  assert.deepStrictEqual(A.hexToRgb('#ff0000'), [255, 0, 0]);
  assert.deepStrictEqual(A.hexToRgb('ff0000'), [255, 0, 0]);
  assert.deepStrictEqual(A.hexToRgb('  #00ff00  '), [0, 255, 0]);
});

test('bozuk renk kodu çökmez, siyaha düşer', () => {
  assert.deepStrictEqual(A.hexToRgb(null), [0, 0, 0]);
  assert.deepStrictEqual(A.hexToRgb(''), [0, 0, 0]);
  assert.deepStrictEqual(A.hexToRgb('zzzzzz'), [0, 0, 0]);
  assert.deepStrictEqual(A.hexToRgb(42), [0, 0, 0]);
});

test('renk kodu gidip geri döner', () => {
  for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#123456', '#abcdef']) {
    const [r, g, b] = A.hexToRgb(hex);
    assert.strictEqual(A.hslToHex(...A.rgbToHsl(r, g, b)), hex);
  }
});

// ------------------------------------------------------------- renk mesafesi

test('aynı renkler arası mesafe sıfır, siyah-beyaz arası en büyük', () => {
  assert.strictEqual(A.colorDistance([10, 20, 30], [10, 20, 30]), 0);
  assert.strictEqual(A.colorDistance([0, 0, 0], [255, 255, 255]), 255);
});

/* Mesafe parlaklığa göre ağırlıklı: göz yeşildeki farkı mavidekinden çok
   daha iyi görüyor. Ağırlıklar düşerse palet, gözle ayırt edilemeyen
   renkleri "farklı" sayıp tekdüze bir gradyan üretirdi. */
test('yeşildeki fark mavidekinden ağır basar', () => {
  const yesil = A.colorDistance([0, 0, 0], [0, 255, 0]);
  const mavi = A.colorDistance([0, 0, 0], [0, 0, 255]);
  assert.ok(yesil > mavi, 'yeşil ' + yesil + ' mavi ' + mavi);
});

// ------------------------------------------------------ pikselden renk ayıklama

test('boş piksel verisi yedek palete düşer', () => {
  assert.deepStrictEqual(A.extractPaletteFromPixels(new Uint8ClampedArray(0), 0, 0), A.fallbackPalette());
  assert.deepStrictEqual(A.extractPaletteFromPixels(null, 0, 0), A.fallbackPalette());
});

/* Saydam pikseller atlanıyor. Atlanmasaydı, saydam köşeleri olan bir kapak
   paleti siyaha çekerdi — kapağın çoğu "yok" sayılan piksel olduğu için. */
test('tamamen saydam görüntü yedek palete düşer', () => {
  const clear = new Uint8ClampedArray(400 * 4);
  for (let i = 0; i < 400; i++) { clear[i * 4] = 255; clear[i * 4 + 3] = 0; }
  assert.deepStrictEqual(A.extractPaletteFromPixels(clear, 20, 20), A.fallbackPalette());
});

test('tek renkli görüntüden bile beş geçerli renk çıkar', () => {
  assertPalette(A.extractPaletteFromPixels(solid(255, 0, 0, 400), 20, 20), 'düz kırmızı');
});

test('baskın renk paletin içinde yer alır', () => {
  const res = A.extractPaletteFromPixels(solid(255, 0, 0, 400), 20, 20);
  assert.ok(res.colors.includes('#ff0000'), 'kırmızı yok: ' + res.colors.join(','));
});

/* Gradyan karanlıktan aydınlığa akmalı: arkaplan bu diziyi sırayla
   kullanıyor, karışık sıra sahneyi titretirdi. */
test('renkler aydınlığa göre artan sırada döner', () => {
  const res = A.extractPaletteFromPixels(solid(40, 90, 200, 600), 30, 20);
  let prev = -1;
  for (const c of res.colors) {
    const [r, g, b] = A.hexToRgb(c);
    const l = A.rgbToHsl(r, g, b)[2];
    assert.ok(l >= prev - 1e-9, 'sıra bozuk: ' + res.colors.join(','));
    prev = l;
  }
});

test('iki renkli görüntüden birbirinden farklı renkler çıkar', () => {
  const two = new Uint8ClampedArray(800 * 4);
  for (let i = 0; i < 800; i++) {
    const on = i < 400;
    two[i * 4] = on ? 220 : 20;
    two[i * 4 + 1] = 30;
    two[i * 4 + 2] = on ? 40 : 210;
    two[i * 4 + 3] = 255;
  }
  const res = A.extractPaletteFromPixels(two, 40, 20);
  assertPalette(res, 'iki renkli');
  assert.strictEqual(new Set(res.colors).size, 5, 'renkler yinelenmiş');
});

/* Hiçbir kova üç piksele ulaşamazsa aday listesi boş kalıyor ve motor
   piksel ORTALAMASINDAN tek bir renk kurup kalanları türetiyor. Bu dal en
   kırılgan yol: çıktının tamamı tek bir tohumdan üretiliyor. En azından
   görüntünün kendi ortalaması palette bulunmalı. */
test('üç pikselden az kovada ortalama renk paletin içinde kalır', () => {
  const d = new Uint8ClampedArray(2 * 4);
  for (let i = 0; i < 2; i++) {
    d[i * 4] = 200; d[i * 4 + 1] = 40; d[i * 4 + 2] = 60; d[i * 4 + 3] = 255;
  }
  const res = A.extractPaletteFromPixels(d, 2, 1);
  assertPalette(res, 'iki piksel');
  assert.notDeepStrictEqual(res, A.fallbackPalette(), 'yedek palete düşmemeli');
  const ort = A.hslToHex(...A.rgbToHsl(200, 40, 59));
  assert.ok(res.colors.includes(ort), 'ortalama renk yok: ' + res.colors.join(','));
});

test('istenen renk sayısı değiştirilebilir', () => {
  const res = A.extractPaletteFromPixels(solid(100, 160, 40, 400), 20, 20, { count: 3 });
  assert.strictEqual(res.colors.length, 3);
});

test('yedek palet beş geçerli renk verir', () => {
  assertPalette(A.fallbackPalette(), 'yedek');
});

// ------------------------------------------------------------- data URL yolu

/* Node'da `document` yok; tarayıcı yolu buraya hiç girmemeli ve geri
   çağırım yine de çalışmalı. Çağrılmazsa panel sonsuza kadar beklerdi. */
test('tarayıcı dışında data URL yedek palete düşer', (t, done) => {
  A.extractPaletteFromDataUrl('data:image/png;base64,AAAA', (res) => {
    assert.deepStrictEqual(res, A.fallbackPalette());
    done();
  });
});

test('boş data URL yedek palete düşer', (t, done) => {
  A.extractPaletteFromDataUrl('', (res) => {
    assert.deepStrictEqual(res, A.fallbackPalette());
    done();
  });
});

// ---------------------------------------------------------- armonik paletler

test('armoni kalıbı verilen rastgeleden seçilir', () => {
  const stiller = [];
  for (let i = 0; i < 8; i++) {
    stiller.push(A.generateHarmonicPalette(() => (i + 0.5) / 8).style);
  }
  assert.strictEqual(new Set(stiller).size, 8, 'sekiz ayrı kalıp bekleniyordu: ' + stiller.join(','));
});

test('her armoni kalıbı beş geçerli renk verir', () => {
  for (let i = 0; i < 8; i++) {
    const res = A.generateHarmonicPalette(() => (i + 0.5) / 8);
    assertPalette(res, res.style);
  }
});

test('rastgele verilmezse de geçerli palet üretir', () => {
  for (let i = 0; i < 20; i++) assertPalette(A.generateHarmonicPalette(), 'varsayılan');
});

test('aynı rastgele aynı paleti verir', () => {
  const a = A.generateHarmonicPalette(() => 0.3);
  const b = A.generateHarmonicPalette(() => 0.3);
  assert.deepStrictEqual(a, b);
});

// ------------------------------------------------------------ ruh hali paleti

test('ruh hali sözlüğü parça adından ton seçer', () => {
  const enerjik = A.generateMoodPalette('Techno Fire', '');
  const soguk = A.generateMoodPalette('Ocean Rain', '');
  assertPalette(enerjik, 'enerjik');
  assertPalette(soguk, 'soğuk');
  assert.notDeepStrictEqual(enerjik.colors, soguk.colors);
});

test('sanatçı adı da sözlüğe girer', () => {
  const a = A.generateMoodPalette('', 'Neon Cyber');
  const b = A.generateMoodPalette('', 'zzzz');
  assert.notDeepStrictEqual(a.colors, b.colors);
});

/* Sözlük SIRAYLA taranıyor ve ilk eşleşme kazanıyor. "Dark Night" hem
   'dark' hem 'night' içeriyor; 'night' listede önce geldiği için sakin
   palet kazanıyor. Sıra değişirse bu test uyarır. */
test('sözlükte ilk eşleşme kazanır', () => {
  assert.deepStrictEqual(
    A.generateMoodPalette('Dark Night', '').colors,
    A.generateMoodPalette('Chill Night', '').colors,
  );
});

test('sözlükte olmayan ad deterministik bir palet verir', () => {
  const a = A.generateMoodPalette('qqq zzz', 'www');
  assertPalette(a, 'eşleşmeyen');
  assert.deepStrictEqual(a, A.generateMoodPalette('qqq zzz', 'www'));
});

test('farklı adlar farklı palet verir', () => {
  const a = A.generateMoodPalette('aaa', '');
  const b = A.generateMoodPalette('bbb', '');
  assert.notDeepStrictEqual(a.colors, b.colors);
});

test('boş ad çökmez', () => {
  assertPalette(A.generateMoodPalette('', ''), 'boş');
  assertPalette(A.generateMoodPalette(null, null), 'null');
});

// -------------------------------------------------------- ana karar fonksiyonu

// Geri çağırımı senkron çağıran yolları kısaltan yardımcı
function call(st, cfg, presets) {
  let out;
  let n = 0;
  A.resolveDynamicTheme(st, cfg, presets, (r) => { out = r; n++; });
  return { out, n };
}

test('yalnızca kapak kipinde kapak yoksa tema değişmez', () => {
  const { out } = call({ title: 'a' }, { mode: 'artwork' });
  assert.strictEqual(out, null);
});

test('kapak varsa kapak kipi kullanılır', () => {
  const st = { title: 'a', artist: 'b', artwork: 'data:image/jpeg;base64,' + 'A'.repeat(40) };
  const { out } = call(st, { mode: 'artwork' });
  assert.strictEqual(out.modeUsed, 'artwork');
  assertPalette(out, 'kapak');
});

/* Çok kısa bir dize kapak sayılmamalı; bozuk bir veri URL'si için
   çözümleyiciyi çalıştırmak boşuna. */
test('çok kısa kapak verisi kapak sayılmaz', () => {
  const { out } = call({ title: 'a', artwork: 'data:' }, { mode: 'artwork' });
  assert.strictEqual(out, null);
});

test('kapak yoksa varsayılan kip rastgeleye düşer', () => {
  const { out } = call({ title: 'a' }, { mode: 'artworkOrRandom' });
  assert.strictEqual(out.modeUsed, 'random');
  assertPalette(out, 'rastgele düşüş');
});

test('yapılandırma verilmezse varsayılan kip çalışır', () => {
  const { out } = call({ title: 'a' }, null);
  assert.strictEqual(out.modeUsed, 'random');
});

test('rastgele kip kalıp adını bildirir', () => {
  const { out } = call({ title: 'a' }, { mode: 'random' });
  assert.strictEqual(out.modeUsed, 'random');
  assert.ok(out.style, 'kalıp adı yok');
});

test('ruh hali kipi parça adını kullanır', () => {
  const { out } = call({ title: 'Neon Cyber', artist: 'X' }, { mode: 'energyMood' });
  assert.strictEqual(out.modeUsed, 'energyMood');
  assert.deepStrictEqual(out.colors, A.generateMoodPalette('Neon Cyber', 'X').colors);
});

test('şablon döngüsü sıradakine geçer ve başa sarar', () => {
  const presets = [
    { name: 'P1', colors: ['#111111', '#222222', '#333333', '#444444', '#555555'] },
    { name: 'P2', colors: ['#666666', '#777777', '#888888', '#999999', '#aaaaaa'] },
  ];
  const ilk = call({}, { mode: 'presetCycle', _cycleIdx: 0 }, presets).out;
  assert.strictEqual(ilk.presetName, 'P1');
  assert.strictEqual(ilk.nextCycleIdx, 1);

  const son = call({}, { mode: 'presetCycle', _cycleIdx: 1 }, presets).out;
  assert.strictEqual(son.presetName, 'P2');
  assert.strictEqual(son.nextCycleIdx, 0, 'başa sarmalı');
});

test('şablon listesi boşsa yedek palet kullanılır', () => {
  const { out } = call({}, { mode: 'presetCycle' }, []);
  assert.deepStrictEqual(out.colors, A.fallbackPalette().colors);
});

test('rastgele şablon kipi listeden seçer', () => {
  const presets = [{ name: 'P1', colors: ['#111111', '#222222', '#333333', '#444444', '#555555'] }];
  const { out } = call({}, { mode: 'presetRandom' }, presets);
  assert.strictEqual(out.modeUsed, 'presetRandom');
  assert.strictEqual(out.presetName, 'P1');
});

test('bilinmeyen kip tema değiştirmez', () => {
  assert.strictEqual(call({}, { mode: 'böyle-bir-kip-yok' }).out, null);
});

/* Geri çağırım TAM BİR KEZ çağrılmalı. Hiç çağrılmazsa panel bekler,
   iki kez çağrılırsa tema iki kez uygulanıp titrer. */
test('geri çağırım her kipte tam bir kez çalışır', () => {
  const kipler = ['artwork', 'artworkOrRandom', 'random', 'energyMood', 'presetRandom', 'presetCycle', 'yok'];
  for (const mode of kipler) {
    const { n } = call({ title: 'a' }, { mode }, [{ colors: ['#111111', '#222222', '#333333', '#444444', '#555555'] }]);
    assert.strictEqual(n, 1, mode + ' kipinde geri çağırım ' + n + ' kez çalıştı');
  }
});

test('durum verilmeden çökmez', () => {
  for (const mode of ['random', 'energyMood', 'artworkOrRandom']) {
    assert.doesNotThrow(() => call(null, { mode }), mode);
  }
});
