'use strict';
/* DALGA YUMUŞATMA — MilkDrop'un `SmoothWave`i.
 *
 * MilkDrop dalgayı çizmeden hemen önce bir kez daha örnekliyor
 * (milkdropfs.cpp:2341): ardışık her nokta çiftinin ARASINA bir nokta
 * koyuyor, nokta sayısı ikiye katlanıyor. Ara noktanın yeri dört komşunun
 * ağırlıklı ortalaması, ağırlıklar `-0,15 · 1,15 · 1,15 · -0,15` ve bölen
 * onların toplamı, yani 2.
 *
 * Motorda hiç yoktu; dalgalar presetin verdiği ham noktalarla çiziliyordu
 * ve kırık çizgi gibi görünüyorlardı. Korpusta 11.884 etkin özel dalga
 * bloğunun 7.798'i (%65,6, nokta kipindekiler hariç) ve varsayılan dalga
 * çizen 4.654 preset (%45,0) etkileniyor.
 *
 * Testler gerçek fonksiyonu kaynaktan çıkarıp koşturuyor — formülü burada
 * yeniden yazmak yalnızca testin kendisini doğrulardı.
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

/* Sabitler + fonksiyon, kaynağın kendisinden. Bir gün ağırlıklar değişirse
   testler onu görsün, kopyalanmış bir sabiti değil. */
const CONSTS = /const SMOOTH_C = \[[^\]]*\];/.exec(BARE);
const INV = /const SMOOTH_INV = [^;]*;/.exec(BARE);
const STRIDE = /const VSTRIDE_LINE = [^;]*;/.exec(BARE);
const MAXN = /const SMOOTH_MAX = (\d+);/.exec(BARE);
const FN = /function smoothWave\(src, n, dst, srcOff, dstOff\) \{[\s\S]*?\n  \}/.exec(BARE);

assert.ok(CONSTS && INV && STRIDE && FN && MAXN, 'smoothWave kaynaktan çıkarılamadı');
const smoothWave = new Function('Math',
  CONSTS[0] + INV[0] + STRIDE[0] + FN[0] + '\nreturn smoothWave;')(Math);
const S = 6;

/* Yardımcı: n noktalık bir şerit. x = xs[i], y = ys[i], renk i'ye bağlı. */
const strip = (xs, ys) => {
  const a = new Float32Array(Math.max(8, xs.length) * 2 * S);
  for (let i = 0; i < xs.length; i++) {
    a[i * S] = xs[i]; a[i * S + 1] = ys[i];
    a[i * S + 2] = i / 10; a[i * S + 3] = 0.5; a[i * S + 4] = 1 - i / 10;
    a[i * S + 5] = 0.8;
  }
  return a;
};
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6);

// ------------------------------------------------------------------- sayım

test('nokta sayısı 2*(n-1)+1 oluyor', () => {
  for (const n of [2, 3, 5, 64, 512]) {
    const src = strip(new Array(n).fill(0).map((_, i) => i),
      new Array(n).fill(0));
    const dst = new Float32Array(4096 * S);
    assert.strictEqual(smoothWave(src, n, dst, 0, 0), 2 * (n - 1) + 1,
      n + ' nokta yanlış sayıda çıktı verdi');
  }
});

test('SMOOTH_MAX 512 noktalık en kötü durumu kapsıyor', () => {
  assert.ok(+MAXN[1] >= 2 * (512 - 1) + 1,
    'tampon 1023 noktayı almalı, yoksa bufferSubData sessizce kısa yazar');
});

test('tek nokta ya da boş şerit olduğu gibi geçiyor', () => {
  /* Çağıran taraf zaten `n < 2` durumunda çizmiyor, ama fonksiyon burada
     çökerse hata en kötü yerde, GL çağrısının içinde patlar. */
  const src = strip([3], [4]);
  const dst = new Float32Array(64);
  assert.strictEqual(smoothWave(src, 1, dst, 0, 0), 1);
  assert.strictEqual(dst[0], 3);
  assert.strictEqual(dst[1], 4);
  assert.strictEqual(smoothWave(src, 0, dst, 0, 0), 0);
});

// ------------------------------------------------------------------ konum

test('özgün noktalar KIPIRDAMIYOR, çift indislerde duruyorlar', () => {
  const xs = [0, 1, 2, 3, 4], ys = [0, 1, 0, -1, 0];
  const src = strip(xs, ys);
  const dst = new Float32Array(64 * S);
  const n = smoothWave(src, xs.length, dst, 0, 0);
  for (let i = 0; i < xs.length; i++) {
    assert.ok(near(dst[i * 2 * S], xs[i]), 'nokta ' + i + ' x kaydı');
    assert.ok(near(dst[i * 2 * S + 1], ys[i]), 'nokta ' + i + ' y kaydı');
  }
  assert.strictEqual(n, 9);
});

test('ara nokta dört taplı ağırlıklı ortalama', () => {
  const xs = [0, 10, 20, 30, 40], ys = [0, 0, 0, 0, 0];
  const src = strip(xs, ys);
  const dst = new Float32Array(64 * S);
  smoothWave(src, xs.length, dst, 0, 0);
  /* i=1 için komşular: below=0, i=1, above=2, above2=3
     (-0,15·0 + 1,15·10 + 1,15·20 - 0,15·30) / 2 = (0 + 11,5 + 23 - 4,5)/2 */
  const beklenen = (-0.15 * 0 + 1.15 * 10 + 1.15 * 20 - 0.15 * 30) / 2;
  assert.ok(near(dst[3 * S], beklenen),
    'ara nokta ' + dst[3 * S] + ', beklenen ' + beklenen);
});

test('düz çizgide İÇ ara noktalar tam ortada — yumuşatma eğriyi bozmuyor', () => {
  /* Katsayılar toplamı bölene eşit olduğu için çekirdek doğrusal veriyi
     aynen geçiriyor: yumuşatma düz bir çizgiyi bükmüyor. Bu ancak dört
     komşunun dördü de gerçekse geçerli — uçlar aşağıdaki testin konusu. */
  const n = 9;
  const xs = [], ys = [];
  for (let i = 0; i < n; i++) { xs.push(i * 2); ys.push(i * 2 + 5); }
  const src = strip(xs, ys);
  const dst = new Float32Array(64 * S);
  const out = smoothWave(src, n, dst, 0, 0);
  for (let j = 3; j < out - 3; j += 2) {
    assert.ok(near(dst[j * S], (dst[(j - 1) * S] + dst[(j + 1) * S]) / 2, 1e-4),
      'düz çizgide ' + j + '. ara nokta ortada değil');
  }
});

test('uçlardaki ara noktalar İÇE çekiliyor — kilitlenmiş komşu yüzünden', () => {
  /* İlk ara noktada `i_below` kendine, son ara noktada `i_above2` son
     noktaya kilitli. Negatif katsayı o zaman kendi noktasından düşüyor ve
     ara nokta ortadan biraz geriye kayıyor. MilkDrop'un davranışı bu:
     dalganın uçları çizgi ortasına göre hafifçe kısalıyor. */
  const n = 9;
  const xs = [];
  for (let i = 0; i < n; i++) xs.push(i * 2);
  const src = strip(xs, new Array(n).fill(0));
  const dst = new Float32Array(64 * S);
  const out = smoothWave(src, n, dst, 0, 0);
  assert.ok(near(dst[1 * S], 0.85), 'ilk ara nokta ' + dst[1 * S] + ', beklenen 0,85');
  assert.ok(near(dst[(out - 2) * S], 15.15),
    'son ara nokta ' + dst[(out - 2) * S] + ', beklenen 15,15');
});

test('uçlar kopyalanıyor, dışarı uzatılmıyor', () => {
  /* `i_below` ilk noktada 0'da, `i_above2` son noktada n-1'de kilitli.
     Kilitlenmeseydi ilk ve son ara nokta şeridin dışına taşardı. */
  const xs = [0, 1, 2, 3], ys = [0, 0, 0, 0];
  const src = strip(xs, ys);
  const dst = new Float32Array(64 * S);
  const out = smoothWave(src, xs.length, dst, 0, 0);
  const ilk = dst[1 * S], son = dst[(out - 2) * S];
  assert.ok(ilk > 0 && ilk < 1, 'ilk ara nokta [0,1] dışına taştı: ' + ilk);
  assert.ok(son > 2 && son < 3, 'son ara nokta [2,3] dışına taştı: ' + son);
});

test('keskin virajda düz ortalamadan FARKLI — negatif katsayılar iş görüyor', () => {
  /* Katsayılar (0, 0,5, 0,5, 0) olsaydı bu test geçmezdi: MilkDrop'un
     yumuşatması hafif keskinleştiriyor, düzlemiyor.

     Örnek ASİMETRİK olmak zorunda. `[0, 0, 10, 10]` gibi simetrik bir
     tepede iki negatif katsayı birbirini götürüyor ve sonuç düz ortalamaya
     eşit çıkıyor — testin bir şey kanıtlamaması demek. */
  const xs = [0, 1, 2, 3], ys = [0, 0, 10, 0];
  const src = strip(xs, ys);
  const dst = new Float32Array(64 * S);
  smoothWave(src, xs.length, dst, 0, 0);
  const ara = dst[3 * S + 1];            // i=1 ile i=2 arası, y ekseni
  const duzOrtalama = (0 + 10) / 2;
  assert.ok(near(ara, 5.75), 'ara nokta ' + ara + ', beklenen 5,75');
  assert.ok(ara > duzOrtalama,
    'çekirdek tepeyi düz ortalamanın ÜSTÜNE taşımalı — viraj korunuyor');
});

// ------------------------------------------------------------------- renk

test('ara noktanın rengi SOLDAKİ komşudan, interpole edilmiyor', () => {
  /* MilkDrop `COPY_COLOR(vo[j+1], vi[i])` diyor. İnterpole etmek daha
     "doğru" görünürdü ama renk kademesi presetin görüntüsünün parçası. */
  const xs = [0, 1, 2], ys = [0, 0, 0];
  const src = strip(xs, ys);
  const dst = new Float32Array(64 * S);
  smoothWave(src, xs.length, dst, 0, 0);
  for (const [ara, kaynak] of [[1, 0], [3, 1]]) {
    for (let k = 2; k < S; k++) {
      assert.strictEqual(dst[ara * S + k], src[kaynak * S + k],
        ara + '. ara noktanın ' + k + '. bileşeni soldaki komşudan gelmiyor');
    }
  }
});

// ------------------------------------------------------------- kaydırmalar

test('srcOff ve dstOff ikinci parçayı yerine koyuyor', () => {
  /* Bölünmüş dalgada (mod 6-7) ikinci şerit kaynağın ortasından okunup
     hedefin ortasına yazılıyor. Kaydırmalar çalışmazsa iki şerit üst üste
     biner. */
  const xs = [0, 1, 2, 100, 101, 102], ys = [0, 0, 0, 0, 0, 0];
  const src = strip(xs, ys);
  const dst = new Float32Array(64 * S);
  const n1 = smoothWave(src, 3, dst, 0, 0);
  const n2 = smoothWave(src, 3, dst, 3, n1);
  assert.strictEqual(n1, 5);
  assert.strictEqual(n2, 5);
  assert.ok(near(dst[0], 0), 'birinci şerit 0\'dan başlamalı');
  assert.ok(near(dst[n1 * S], 100), 'ikinci şerit 100\'den başlamalı');
  assert.ok(near(dst[(n1 + n2 - 1) * S], 102), 'ikinci şerit 102\'de bitmeli');
});

// -------------------------------------------------------------- bağlanışı

test('varsayılan dalga KOŞULSUZ yumuşatılıyor — nokta kipinde bile', () => {
  /* MilkDrop kaynağında `if (1)` yazıyor (milkdropfs.cpp:3117). Nokta
     kipinde bu iki katı nokta demek ve MilkDrop'un istediği bu. */
  const fn = BARE.slice(BARE.indexOf('_drawWaveModes(gl, GW, GH)'));
  const govde = fn.slice(0, fn.indexOf('\n    _strip('));
  assert.match(govde, /vn = smoothWave\(d, n, vd, 0, 0\)/);
  assert.doesNotMatch(govde, /usedots[^\n]*smoothWave/,
    'varsayılan dalgada yumuşatma nokta kipine bağlanmamalı');
});

test('bölünmüş dalgada iki parça AYRI yumuşatılıyor', () => {
  /* Tek parça sayılsaydı iki şeridin arasına ekranı boydan boya kesen bir
     çizgi girerdi. Yeni kırılma noktası 2*(eski-1)+1. */
  const fn = BARE.slice(BARE.indexOf('_drawWaveModes(gl, GW, GH)'));
  assert.match(fn, /vbreak = smoothWave\(d, breakAt, vd, 0, 0\)/);
  assert.match(fn, /vn = vbreak \+ smoothWave\(d, n - breakAt, vd, breakAt, vbreak\)/);
  // Kırılma noktası gerçekten 2*(eski-1)+1 çıkıyor mu
  const src = strip([0, 1, 2, 3], [0, 0, 0, 0]);
  const dst = new Float32Array(64 * S);
  assert.strictEqual(smoothWave(src, 2, dst, 0, 0), 2 * (2 - 1) + 1);
});

test('özel dalga nokta kipinde yumuşatılmıyor', () => {
  /* milkdropfs.cpp:2508 — `if (!bUseDots)`. Nokta kipinde ara noktalar
     çizgiyi yumuşatmaz, sadece iki katı nokta basar. */
  const fn = BARE.slice(BARE.indexOf('_drawCustomWaves(gl, audio, preset, am)'));
  assert.match(fn, /this\._wantAcc !== false && !w\.useDots/);
});

test('yumuşatma MilkDrop uyumu anahtarına bağlı', () => {
  /* `--legacy` koşuları önceki legacy koşularıyla karşılaştırılabilir
     kalmalı; yumuşatma nokta sayısını ikiye katlıyor. */
  const wave = BARE.slice(BARE.indexOf('_drawWaveModes(gl, GW, GH)'));
  assert.match(wave, /if \(this\._wantAcc !== false\) \{\s*vd = this\.waveData;/);
});

test('yumuşatılmış çıktı AYRI dizide ve VBO ona göre ayrılmış', () => {
  /* Yerinde yazmak henüz okunmamış noktaları ezerdi; VBO'yu küçük
     bırakmak da bufferSubData'yı sessizce kısa keserdi. */
  assert.match(BARE, /this\.waveData = new Float32Array\(SMOOTH_MAX \* 6\)/);
  assert.match(BARE, /gl\.bufferData\(gl\.ARRAY_BUFFER, this\.waveData, gl\.DYNAMIC_DRAW\)/);
});
