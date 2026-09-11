'use strict';
/* KENAR YUMUŞATMALI ÇİZGİ.
 *
 * `gl.LINE_STRIP` her sürücüde tek tekselllik ve tırtıklı çiziyor;
 * WebGL'de `lineWidth` çoğu sürücüde 1'e sabit. Motor bu yüzden çizgiyi
 * kaydırılmış kopyalarıyla kalınlaştırıyordu — kalınlık oluyor, kenar
 * merdiven kalıyor, ve toplamalı karışımda her kopya bir kat daha ışık
 * bırakıyor.
 *
 * Yeni yol çizgiyi şerit olarak çiziyor: her noktadan iki yana açılmış bir
 * üçgen şeridi, parça gölgelendirici merkez çizgiye uzaklığa göre kapsama
 * hesaplıyor. MilkDrop'ta böyle bir şey YOK — bilinçli bir sapma, ve bu
 * yüzden ayardan seçilebiliyor.
 *
 * Üç kip: `smooth` (varsayılan, eski yolun ışığını korur), `thin` (gerçek
 * kalınlık, ışık koruması yok), `milkdrop` (eski kaydırmalı yol).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8');
const BARE = CODE
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const RIB = /_ribbon\(d, n, closed, extPx, GW, GH, lenCorr\) \{[\s\S]*?\n    \}/.exec(BARE);
const DRAWS = /_lineDraws\(GW, thickMul\) \{[\s\S]*?\n    \}/.exec(BARE);
assert.ok(RIB && DRAWS, '_ribbon / _lineDraws kaynaktan çıkarılamadı');

/* Gerçek fonksiyonlar koşturuluyor: formülü testte yeniden yazmak yalnızca
   testin kendisini doğrulardı. */
const mk = (src, extra) => {
  const body = 'const self = { aaData: new Float32Array(65536) };\n' +
    'self._ribbon = function ' + RIB[0].replace('_ribbon', '') + ';\n' +
    'self._lineDraws = function ' + DRAWS[0].replace('_lineDraws', '') + ';\n' +
    'return self;';
  return new Function('Math', body)(Math);
};
const E = mk();
const ribbon = (d, n, closed, ext, GW, GH, corr) =>
  E._ribbon.call(E, d, n, closed, ext, GW, GH, corr);
const lineDraws = (GW, t) => E._lineDraws.call(E, GW, t);

const strip = (pts) => {
  const a = new Float32Array(Math.max(8, pts.length) * 6);
  for (let i = 0; i < pts.length; i++) {
    a[i * 6] = pts[i][0]; a[i * 6 + 1] = pts[i][1];
    a[i * 6 + 2] = 1; a[i * 6 + 3] = 1; a[i * 6 + 4] = 1; a[i * 6 + 5] = 0.5;
  }
  return a;
};

// ------------------------------------------------------------- eski ağırlık

test('eski yolun çizim sayısı tek yerden geliyor', () => {
  /* Işık koruma çarpanı buna bölünüyor. İkisi ayrışırsa AA açıkken
     presetlerin parlaklığı sessizce kayar, ki tam olarak kaçınılan şey. */
  assert.strictEqual(lineDraws(320, 1), 1, '320\'de telafi devreye girmiyor');
  assert.strictEqual(lineDraws(512, 1), 4);
  assert.strictEqual(lineDraws(640, 1), 4);
  assert.strictEqual(lineDraws(320, 2), 4, 'wave_thick ağırlığı ikiye katlıyor');
  /* Kaydırma listesi dolduğunda (yedi çizim) ÇAKIŞMA DÜZELTMESİ giriyor:
     kopyalar birbirinin üstüne biniyor ve ışık çizim sayısıyla doğrusal
     artmıyor. Ölçüldü — ağırlık 2'den 4'e çıkınca çizim oranı 1,75, ışık
     oranı ortalama 1,58; katsayı 0,90. Ayrıntısı `_lineDraws` yerinde. */
  assert.strictEqual(lineDraws(1024, 1), 6.3);
  assert.strictEqual(lineDraws(1920, 1), 6.3, 'ağırlık 5\'te, kopya 6\'da tavan yapıyor');
  assert.strictEqual(lineDraws(512, 2), 6.3, 'kalın çizgi de tavana çarpıyor');
});

// -------------------------------------------------------------- geometri

test('her nokta İKİ tepe üretiyor, taraf -1 ve +1', () => {
  const d = strip([[-0.5, 0], [0, 0], [0.5, 0]]);
  const n = ribbon(d, 3, false, 2, 640, 480, false);
  assert.strictEqual(n, 6);
  for (let i = 0; i < 3; i++) {
    assert.strictEqual(E.aaData[(i * 2) * 7 + 2], -1);
    assert.strictEqual(E.aaData[(i * 2 + 1) * 7 + 2], 1);
  }
});

test('açılma TEKSEL uzayında — dikey ve yatay çizgi aynı kalınlıkta', () => {
  /* Kırpma uzayında sabit bir açılma en-boy oranı yüzünden dikey çizgileri
     ince, yatayları kalın yapardı. Ölçü: açılmanın PİKSEL karşılığı. */
  const GW = 800, GH = 400, ext = 3;
  const yatay = strip([[-0.5, 0], [0.5, 0]]);
  ribbon(yatay, 2, false, ext, GW, GH, false);
  const dyPx = Math.abs(E.aaData[1] - E.aaData[7 + 1]) * GH * 0.5;
  const dikey = strip([[0, -0.5], [0, 0.5]]);
  ribbon(dikey, 2, false, ext, GW, GH, false);
  const dxPx = Math.abs(E.aaData[0] - E.aaData[7]) * GW * 0.5;
  assert.ok(Math.abs(dyPx - 2 * ext) < 1e-4, 'yatay çizginin kalınlığı ' + dyPx);
  assert.ok(Math.abs(dxPx - 2 * ext) < 1e-4, 'dikey çizginin kalınlığı ' + dxPx);
});

test('gönye birleşimi: şerit kesintisiz, segmentler üst üste binmiyor', () => {
  /* Binseydi toplamalı karışımda her birleşim iki kat parlak bir nokta
     olurdu — eski yolun görünür kusurlarından biri. Düz bir çizgide gönye
     ölçeği tam 1 olmalı. */
  const d = strip([[-0.5, 0], [0, 0], [0.5, 0]]);
  ribbon(d, 3, false, 4, 640, 640, false);
  const orta = E.aaData[1 * 7 + 1], ortaOrta = E.aaData[3 * 7 + 1];
  assert.ok(Math.abs(orta - ortaOrta) < 1e-6,
    'düz çizgide orta düğüm farklı açılmış');
});

test('gönye SINIRI keskin dönüşte devreye giriyor', () => {
  /* `1/cos(yarı açı)` keskin dönüşte sonsuza gidiyor; sınır olmadan şerit
     ekranın dışına fırlar. Geri dönen bir çizgi en kötü durum. */
  const d = strip([[-0.5, 0], [0, 0], [-0.5, 0.001]]);
  ribbon(d, 3, false, 4, 640, 640, false);
  for (let i = 0; i < 6; i++) {
    const x = E.aaData[i * 7], y = E.aaData[i * 7 + 1];
    assert.ok(isFinite(x) && isFinite(y), i + '. tepe sonlu değil');
    assert.ok(Math.abs(x) < 4 && Math.abs(y) < 4,
      i + '. tepe ekrandan fırladı: ' + x + ',' + y);
  }
});

test('sıfır uzunluklu segment önceki yönü kullanıyor', () => {
  /* Aynı noktayı iki kez yazan preset var; normali hesaplamak 0/0 verir ve
     bütün şerit NaN\'a döner — ekranda hiçbir şey çizilmez. */
  const d = strip([[-0.5, 0], [0, 0], [0, 0], [0.5, 0]]);
  const n = ribbon(d, 4, false, 3, 640, 640, false);
  assert.strictEqual(n, 8);
  for (let i = 0; i < 8 * 7; i++) {
    assert.ok(isFinite(E.aaData[i]), i + '. bileşen NaN');
  }
});

test('kapalı eğri başlangıç noktasını tekrarlıyor', () => {
  const d = strip([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]);
  const n = ribbon(d, 4, true, 2, 640, 640, false);
  assert.strictEqual(n, 10, 'kapalı şerit n+1 düğüm, yani 2n+2 tepe');
});

// ---------------------------------------------------------- uzunluk telafisi

test('uzunluk telafisi çapraz segmentte alfayı düşürüyor', () => {
  /* `gl.LINE_STRIP` elmas-çıkış kuralıyla baskın eksende piksel basıyor:
     45 derecelik çizgi birim uzunluk başına 1/√2 piksel alıyor. Şerit
     gerçek uzunluğu kaplıyor, o yüzden telafisiz çapraz dalgalar
     parlıyordu — `Benski - Atom Smasher` tek başına 0,884\'ten 1,000\'e
     çıkmıştı. */
  const yatay = strip([[-0.5, 0], [0.5, 0]]);
  ribbon(yatay, 2, false, 2, 640, 640, true);
  const aYatay = E.aaData[6];   // tepe adimi 7: x,y,side,r,g,b,a
  const capraz = strip([[-0.5, -0.5], [0.5, 0.5]]);
  ribbon(capraz, 2, false, 2, 640, 640, true);
  const aCapraz = E.aaData[6];
  assert.ok(Math.abs(aYatay - 0.5) < 1e-6, 'eksene paralel çizgi telafi görmemeli');
  assert.ok(Math.abs(aCapraz - 0.5 / Math.SQRT2) < 1e-4,
    '45 derecede alfa 1/√2 ile çarpılmalı, bulunan ' + (aCapraz / 0.5));
});

test('telafi kapalıyken alfa dokunulmadan geçiyor', () => {
  /* `thin` kipinde amaç eski yolu taklit etmek değil, fiziksel olarak
     doğru çizgi. */
  const capraz = strip([[-0.5, -0.5], [0.5, 0.5]]);
  ribbon(capraz, 2, false, 2, 640, 640, false);
  assert.ok(Math.abs(E.aaData[6] - 0.5) < 1e-9);
});

// ------------------------------------------------------------- bağlanışı

test('nokta kipi eski yoldan çiziliyor', () => {
  /* Nokta kipinde şerit diye bir şey yok; `gl.POINTS` AA yoluna girmemeli. */
  const fn = BARE.slice(BARE.indexOf('_strip(gl, kind, d, n, breakAt, GW, GH, thickMul)'));
  /* Yönlendirme ÜÇ çizgi biçimini sayıyor ve POINTS hiçbirinde yok; yani
     nokta kipi eski yola düşüyor. */
  assert.match(fn, /if \(aa && kind === gl\.LINES\)/);
  assert.match(fn, /if \(aa && \(kind === gl\.LINE_STRIP \|\| kind === gl\.LINE_LOOP\)\)/);
  assert.doesNotMatch(fn.slice(0, fn.indexOf('const draw =')), /gl\.POINTS/,
    'POINTS AA yoluna girmemeli');
});

test('AA yolundan sonra program ve VAO geri bağlanıyor', () => {
  /* Çağıran döngü `lineProg`/`lineVao`yu döngü DIŞINDA bağlıyor; AA yolu
     ikisini de değiştirdiği için geri koymazsak sıradaki dalga yanlış
     gölgelendiriciyle çizilir. */
  const fn = BARE.slice(BARE.indexOf('_strip(gl, kind, d, n, breakAt, GW, GH, thickMul)'));
  const aa = fn.slice(0, fn.indexOf('const draw ='));
  assert.match(aa, /gl\.useProgram\(this\.lineProg\)/);
  assert.match(aa, /gl\.bindVertexArray\(this\.lineVao\)/);
  assert.match(aa, /gl\.bindBuffer\(gl\.ARRAY_BUFFER, this\.lineVbo\)/);
});

test('tanınmayan ayar değeri varsayılana düşüyor', () => {
  /* Ayardaki bir yazım hatası çizgileri yok etmemeli. */
  assert.match(BARE,
    /this\._lineStyle = \(ls === 'thin' \|\| ls === 'milkdrop'\) \? ls : 'smooth'/);
});

test('şerit yarı genişlikten bir teksel geniş', () => {
  /* Tam yarı genişlikte bitseydi kapsama kenarda 0,5\'te sert kesilirdi:
     ne yumuşama olurdu ne de ışık integrali `2*half` çıkardı. */
  assert.match(BARE, /const ext = half \+ 1;/);
  assert.match(CODE, /float d = abs\(vSide\) \* uExt;/);
  assert.match(CODE, /float cov = clamp\(uHalf - d \+ 0\.5, 0\.0, 1\.0\);/);
});

test('alfa tavanı karışım kipine bağlı', () => {
  /* Toplamalı karışımda alfa 1\'i aşabilir ve aşmalı; saydam karışımda
     aşarsa `ONE_MINUS_SRC_ALPHA` negatife düşüp altındakini çıkarır. */
  assert.match(BARE, /this\._aaAdditive = !!additive;/);
  assert.match(BARE, /gl\.uniform1f\(L\.uMax, this\._aaAdditive \? 64 : 1\)/);
});

test('ince kipte ışık koruma yok, yumuşatılmışta var', () => {
  /* Genişlik ve kazanç `_aaSetup` içinde: şerit yolu iki yerden çağrılıyor
     (bağlı çizgi ve bağımsız parçalar) ve ikisi de aynı kalibrasyonu
     kullanmak zorunda. */
  const fn = BARE.slice(BARE.indexOf('_aaSetup(gl, GW, thickMul)'));
  assert.match(fn, /const ref = this\._lineStyle === 'thin' \? 512 : 320;/);
  assert.match(fn, /this\._lineStyle === 'thin' \? 1 : AA_TRIM \* draws \/ \(2 \* half\)/);
});
