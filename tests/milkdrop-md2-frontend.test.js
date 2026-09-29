'use strict';
/* MILKDROP 2'NİN İFADE ÖN UCU VE SAYI KURALLARI (#580).
 *
 * Uyum açıkken denklemler MilkDrop 2'nin derleyicisinin (Nullsoft ns-eel2)
 * okuduğu gibi okunuyor ve hesaplanıyor. Buradaki HER beklenen değer, aynı
 * ifadenin ns-eel2'nin derlenmiş hâlinde (milkdrop-tools/eelref; BeatDrop
 * 53d83ee kaynağı, 32 bit MSVC) verdiği sonuç. Depoya girmeyen o araçla
 * korpusun 10.757 tekil bloğu iki motorda derlendi (derlenip derlenmeme
 * hepsinde aynı) ve dört kare koşturuldu (rand kullanmayan 9.486 bloğun
 * 17'si dışında bütün değişkenler aynı; o 17'si x87'nin transandantal
 * işlevlerinin son bitinden).
 */
const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/shared/milkdrop.js');

function run(src, pre, md2 = true) {
  M.resetGlobals();
  const pool = new M.Pool();
  const c = M.compile(src, pool, { mode: { md2 }, md2Funcs: md2 });
  for (const k in pre || {}) { const i = pool.id(k); pool.values[i] = pre[k]; }
  c.run(pool.values);
  return { error: c.error, dropped: !!c.dropped, get: (k) => pool.get(k) };
}
const pick = (r, names) => names.map((n) => r.get(n));

// ------------------------------------------------------------ önişlemci

test('tekli eksi `%`/`^` zincirini kapsıyor, `%`/`^` sağında dar', () => {
  const r = run('a = t^-o%h; b = -s%f; c = t%-o^h; d = t^-o^h; e = -t^o%h; g = s%-f%t; i = t*-s%f; j = -s%f*t; k = t^!o%h; l = !o%h;',
    { t: 3, o: 2, h: 3, s: 7, f: 4 });
  assert.deepStrictEqual(pick(r, ['a', 'b', 'c', 'e', 'g', 'i', 'j', 'k', 'l']), [0, -3, 1, 0, 0, -9, -9, 1, 0]);
  assert.ok(Math.abs(r.get('d') - 0.0013717421124828529) < 1e-15, '(3^−2)^3');
});

test('`^` ve `%` `*`/`/`dan sıkı, kendi aralarında soldan', () => {
  const r = run('p = a*b^a; q = a^b*a; r = d/a^a; s = a^b%5; t = c%b^a; u = a+b^a; v = a^b+a; w = d/a/a; x = a^b/a; y = -a*b^a;', { a: 2, b: 3, c: 7, d: 8 });
  assert.deepStrictEqual(pick(r, ['p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y']), [18, 16, 2, 3, 1, 11, 10, 2, 4, -18]);
});

test('karşılaştırmalar sağdan; `&&` `||` aynı düzeyde; bit işleçleri arada', () => {
  const r = run('p = a<b<c; q = c>b>a; r = a<c<=b; s = a!=b<a; w = c>=b<a; m = b<=a<c;', { a: 1, b: 2, c: 3 });
  assert.deepStrictEqual(pick(r, ['p', 'q', 'r', 's', 'w', 'm']), [0, 1, 0, 1, 1, 0]);
  const l = run('p = z||a&&z; q = a||z&&z; r = z&&a||a; s = 6|1&4; t = 6&3|8; u = a|b<c; v = a<b|c;', { a: 1, b: 2, c: 3, z: 0 });
  assert.deepStrictEqual(pick(l, ['p', 'q', 'r', 's', 't', 'u', 'v']), [0, 0, 1, 6, 10, 0, 1]);
  const b = run('a = t|f*w; b = s&t+o; c = t+o|f; d = s|w^w; e = s&w%t; h = s-o&f;', { t: 3, f: 4, w: 2, s: 6, o: 1 });
  assert.deepStrictEqual(pick(b, ['a', 'b', 'c', 'd', 'e', 'h']), [11, 4, 4, 6, 2, 4]);
});

test('atama her yerde: sol taraf hemen önceki terim, değişken işlem anında okunuyor', () => {
  /* Satır yapışmasından doğan `gamma = 1 + bass*bass_attchng = sin(…)` gibi
     yazımlar korpusta var. */
  const r = run('g = 1 + b*b = 7; h = (0 = 5); k = 3; m = k + 1 = 9; n = (k = 4) + 1;', { b: 2 });
  assert.deepStrictEqual(pick(r, ['g', 'h', 'm', 'n', 'k', 'b']), [50, 5, 12, 5, 4, 7]);
});

test('parantez içinde `;`: sonrası terimse dizi, değilse boşluk', () => {
  const r = run('v1 = (1 + 2; 3); v2 = (2 * 3; 4); v4 = (1; 2) + 10; v5 = (k; 2) * 3; v6 = (1 | 2; 8); v7 = (6 & 3; 8); w1 = (k;; * 3);', { k: 5 });
  assert.deepStrictEqual(pick(r, ['v1', 'v2', 'v4', 'v5', 'v6', 'v7', 'w1']), [4, 4, 12, 6, 9, 0, 15]);
});

test('köşeli ayraç, `?:` ve `$` sabitleri', () => {
  const r = run('x = 2; x[3] = 7; b = megabuf(5); gmem[4] = 3; c = gmegabuf(4); d = 1 ? 5 : 6; e = 0 ? 5 : 6; f = x > 1 ? 10 : 20; p = $pi; q = $x1F; s = $\'A\'; ph = $phi;');
  assert.deepStrictEqual(pick(r, ['b', 'c', 'd', 'e', 'f', 'p', 'q', 's', 'ph']), [7, 3, 5, 6, 10, 3.141592653589793, 31, 65, 1.61803399]);
});

// ------------------------------------------------------------ sayılar ve hatalar

test('sayı yazımı: noktasız 32 bite kırpılıyor, üs işaretsiz, tek nokta 0', () => {
  const r = run('a = 3000000000; b = 1.5e2; c = 1.5e-2; d = 1.5e+2; e = .5; f = 5.; g = 007; h = .-.4;');
  assert.deepStrictEqual(pick(r, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']), [2147483647, 150, -0.5, 3.5, 0.5, 5, 7, -0.4]);
});

test('bir deyim derlenmezse BLOK bütünüyle düşüyor (MilkDrop da çalıştırmıyor)', () => {
  for (const src of ['a = 1; b = 1e3; c = 2;', 'a = 1; b = 0x1F;', 't = 2; rot = rot*sin*cos(t);', 'a = 1; b = 12abc;']) {
    const r = run(src);
    assert.ok(r.dropped && r.error, src);
    assert.strictEqual(r.get('a') + r.get('t'), 0, 'hiçbir deyim çalışmadı: ' + src);
  }
  // Kapalıyken eski davranış: bozuk deyim atlanıyor, kalanı çalışıyor
  const off = run('a = 1; b = 1 +; c = 2;', null, false);
  assert.deepStrictEqual(pick(off, ['a', 'c']), [1, 2]);
});

// ------------------------------------------------------------ sayısal kurallar

test('sıfıra doğru yuvarlama: + − · / ve sqrt', () => {
  const r = run('p = 0.3*50; q = int(0.3*50+10); c = (100*0.3)%7; f = -1/-2.5*10; g = 2/3*3; o = sqrt(2);');
  assert.deepStrictEqual(pick(r, ['p', 'q', 'c', 'f', 'g', 'o']), [14.999999999999998, 24, 1, 3.9999999999999996, 1.9999999999999998, 1.4142135623730949]);
});

test('taşma DBL_MAX, sıfıra bölme sonsuz, atama temizliyor, bileşik atama ham', () => {
  const r = run('k = 1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000*1000000; a = 1/z; b = min(1/z, 5); c = above(1/z, 3); q = 2; q /= z; m = sin(k); n = tan(k);', { z: 0 });
  assert.strictEqual(r.get('k'), Number.MAX_VALUE);
  assert.deepStrictEqual(pick(r, ['a', 'b', 'c', 'n']), [0, 5, 1, 0]);
  assert.strictEqual(r.get('q'), Infinity, '`/=` sonsuzu tutuyor');
  assert.strictEqual(r.get('m'), Number.MAX_VALUE, 'fsin |x| ≥ 2^63 argümanı bırakıyor');
});

test('NaN: `<` `>` doğru, `<=` `>=` yanlış; min/max/sign x87 gibi', () => {
  const r = run('lt = (0/0) < 1; gt = (0/0) > 1; le = (0/0) <= 1; ge = (0/0) >= 1; mn = min(1, 0/0); mx = max(0/0, 1); sg = sign(0/0) + 5;');
  assert.deepStrictEqual(pick(r, ['lt', 'gt', 'le', 'ge', 'mn', 'mx', 'sg']), [1, 1, 0, 0, 1, 1, 4]);
});

test('invsqrt: MilkDrop\'un hızlı ters karekökü, yalnız uyum açıkken', () => {
  const r = run('g = invsqrt(1); h = invsqrt(4); i = invsqrt(0); j = invsqrt(-1);');
  assert.deepStrictEqual(pick(r, ['g', 'h', 'i', 'j']), [0.99830714958478195, 0.49915357479239097, 1.9817754259441582e+19, 1.7770914009037052e+115]);
  assert.match(run('g = invsqrt(1);', null, false).error, /bilinmeyen fonksiyon 'invsqrt'/);
});
