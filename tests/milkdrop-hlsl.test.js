'use strict';
/* HLSL ifade tip çıkarımının testleri.
 *
 * Bu modülün tek işi var: HLSL'in sessizce yaptığı tip dönüşümlerini GLSL'in
 * kabul edeceği biçimde AÇIK hale getirmek. Yanlış yaptığında sonuç derleme
 * hatası — yani preset tümden siyah kalıyor, hiçbir uyarı vermeden. Kurallar
 * dar ve sayılabilir olduğu için burada tek tek sınanıyorlar. */

const test = require('node:test');
const assert = require('node:assert');
const H = require('../src/shared/milkdrop-hlsl.js');

// Gerçek shader'lardaki tiplerin küçük bir örneği
function env(extra) {
  const m = new Map([
    ['ret', 'vec3'], ['uv', 'vec2'], ['uv_orig', 'vec2'],
    ['rad', 'float'], ['ang', 'float'], ['time', 'float'],
    ['rand_frame', 'vec4'], ['texsize', 'vec4'], ['q1', 'float'],
  ]);
  if (extra) for (const k in extra) m.set(k, extra[k]);
  return m;
}

const N = (src, extra) => H.narrowExpr(src, env(extra));

// ------------------------------------------------------------ tip çıkarımı

function typeOfExpr(src, extra) {
  return H.typeOf(H.parse(H.tokenize(src)), env(extra));
}

test('değişken ve sayı tipleri', () => {
  assert.strictEqual(typeOfExpr('uv'), 'vec2');
  assert.strictEqual(typeOfExpr('ret'), 'vec3');
  assert.strictEqual(typeOfExpr('1.5'), 'float');
});

test('swizzle tipi daraltır ya da genişletir', () => {
  assert.strictEqual(typeOfExpr('ret.x'), 'float');
  assert.strictEqual(typeOfExpr('ret.xy'), 'vec2');
  assert.strictEqual(typeOfExpr('uv.xxxx'), 'vec4');
});

test('yerleşiklerin dönüş tipi bilinir', () => {
  assert.strictEqual(typeOfExpr('tex2D(s, uv)', { s: 'sampler' }), 'vec3');
  assert.strictEqual(typeOfExpr('lum(ret)'), 'float');
  assert.strictEqual(typeOfExpr('length(uv)'), 'float');
  assert.strictEqual(typeOfExpr('normalize(uv)'), 'vec2');
});

/* HLSL kuralı: iki vektörden DAR olanı kazanır, skaler yayılır. */
test('ikili işlemde dar olan kazanır', () => {
  assert.strictEqual(typeOfExpr('uv + rand_frame'), 'vec2');
  assert.strictEqual(typeOfExpr('ret * rand_frame'), 'vec3');
  assert.strictEqual(typeOfExpr('ret * 2.0'), 'vec3');
  assert.strictEqual(typeOfExpr('2.0 * uv'), 'vec2');
});

test('karşılaştırma bool döndürür', () => {
  assert.strictEqual(typeOfExpr('rad > 0.5'), 'bool');
});

// --------------------------------------------------------------- daraltma

/* Gerçek preset kodundan: solda float2, sağda float4. HLSL float2 okur,
   GLSL "wrong operand types" der ve shader hiç derlenmez. */
test('geniş operand dar olana daraltılır', () => {
  assert.strictEqual(N('uv*0.3 + 0.01*rand_frame'), 'uv*0.3 + (0.01*rand_frame).xy');
});

test('daraltma yalnızca geniş tarafa uygulanır', () => {
  assert.strictEqual(N('rand_frame.xy + uv'), 'rand_frame.xy + uv');
});

test('skaler yayılımına dokunulmaz', () => {
  assert.strictEqual(N('ret * 2.0'), 'ret * 2.0');
  assert.strictEqual(N('uv + rad'), 'uv + rad');
});

test('tipi bilinmeyen ifadeye dokunulmaz', () => {
  assert.strictEqual(N('bilinmeyen + uv'), 'bilinmeyen + uv');
});

/* HLSL fonksiyon argümanlarını da kırpıyor: `lerp(float3, float2, t)`
   orada geçerli, GLSL'de eşleşen aşırı yükleme yok. */
test('fonksiyon argümanları ortak genişliğe indirilir', () => {
  assert.strictEqual(N('lerp(ret, uv, 0.5)'), 'lerp((ret).xy, uv, 0.5)');
  assert.strictEqual(N('min(uv, ret)'), 'min(uv, (ret).xy)');
});

test('skaler argüman daraltılmaz', () => {
  assert.strictEqual(N('mix(ret, ret, rad)'), 'mix(ret, ret, rad)');
});

/* HLSL karşılaştırmayı sayı olarak okuyor; GLSL bool'u aritmetiğe sokmuyor. */
test('aritmetikteki karşılaştırma sayıya çevrilir', () => {
  assert.match(N('ret * (rad > 0.5)'), /float\(\(rad > 0\.5\)\)/);
});

test('eksi işaretli karşılaştırma da sayıya çevrilir', () => {
  assert.match(N('-(rad > 0.5) * ret'), /float\(/);
});

/* GLSL'de karşılaştırma yalnızca skalerlerde tanımlı. */
test('vektör karşılaştırması ilk bileşene indirgenir', () => {
  assert.match(N('ret - 0.7 >= 0.0'), /\)\.x >= 0\.0/);
});

/* HLSL skalerin bileşenini okumaya izin veriyor: lum(ret).x yine lum(ret). */
test('skaler üzerindeki swizzle kaldırılır', () => {
  assert.strictEqual(N('lum(ret).x'), '(lum(ret))');
});

test('skalerin çoklu swizzle-ı vektöre yayılır', () => {
  assert.strictEqual(N('rad.xxx'), 'vec3(rad)');
});

/* `!` HLSL'de sayıda da çalışıyor: sıfırsa doğru. */
test('sayı üzerindeki ünlem karşılaştırmaya çevrilir', () => {
  assert.match(N('!rad'), /\(rad == 0\.0\)/);
});

// ---------------------------------------------------------------- sağlamlık

test('ayrıştırılamayan metin olduğu gibi döner', () => {
  const garip = 'ret = = = ;;;';
  assert.strictEqual(typeof N(garip), 'string');
});

test('boş girdi çökmez', () => {
  assert.strictEqual(N(''), '');
});

test('derin iç içe ifade çökmez', () => {
  const deep = 'sin(cos(sin(cos(sin(cos(uv.x))))))';
  assert.strictEqual(typeof N(deep), 'string');
});

/* Yamalar iç içe olabiliyor; tek geçişte ikisini birden uygulamak
   konumları kaydırırdı. */
test('iç içe dönüşümlerin ikisi de uygulanır', () => {
  const r = N('ret * (!rad)');
  assert.match(r, /rad == 0\.0/);
  assert.match(r, /float\(/);
});
