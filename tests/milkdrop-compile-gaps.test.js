'use strict';
/* DERLEME BOŞLUKLARI — korpusta derlenmeyen son aşamaların nedenleri.
 *
 * Ölçüm: `node scripts/milkdrop-compile-rate.js <korpus> --json=...`
 * 10.332 preset, 16.346 aşama. Başlangıç %99,2 (134 aşama düşüyordu).
 *
 * Bu dosyadaki her testin arkasında GERÇEK bir preset var ve her biri
 * derleyicinin gösterdiği SATIR NUMARASINDAN geriye izlenerek bulundu —
 * hata metnine göre değil. Aynı derleyici iletisi ("wrong operand types")
 * beş ayrı nedeni birden saklıyordu; satır numarası olmadan gruplama
 * yanıltıcıydı.
 *
 * Testler DAVRANIŞ sınıyor, mekanizma değil: üretilen GLSL'de hangi
 * dönüşümün göründüğü değil, presetin yazdığı şeyin geçerli GLSL'e
 * dönüşüp dönüşmediği. Mekanizma değişirse test değil kod değişmeli.
 */
const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/shared/milkdrop-shader.js');

const tr = (src) => T.translate(src).glsl;
const gövde = (src) => {
  const g = tr(src);
  const i = g.indexOf('void main()');
  return i < 0 ? g : g.slice(i);
};

// ------------------------------------------------------- int() dönüşümü

test('`int(x)` bir TİP DEĞİL dönüşüm — float(x) yapılamaz', () => {
  /* `int` tip adı olarak float'a çevriliyor (motorda her sayı float). Aynı
     eşleme çağrı biçimine de vuruyordu ve `retish[int(bass*roam_sin.x)]`
     `retish[float(...)]` oluyordu — GLSL "integer expression required".
     Gerçek preset: EoS - glowsticks v2 04. Korpusta 10 aşama.

     Karşılığı `trunc`: HLSL'in tamsayı dönüşümüyle aynı işi yapıyor
     (sıfıra doğru kırpma) ama sonuç float kalıyor. */
  const g = gövde('shader_body { float3 retish = ret; ret = vec3(retish[int(bass*2.0)]); }');
  assert.doesNotMatch(g, /retish\[float\(/, 'indeks float olamaz');
  assert.match(g, /retish\[int\(/, 'indeks int ile sarılmalı');
  assert.match(g, /trunc\(/, 'HLSL dönüşümü trunc olarak kalmalı');
});

test('vektör bileşeni de tamsayı indeks istiyor', () => {
  /* `retish` bir DİZİ değil, vec3. HLSL float indeksi kabul ediyor,
     GLSL etmiyor — dizi adlarının yanına vektör adları da giriyor. */
  const g = gövde('shader_body { float3 v = ret; float k = bass; ret = vec3(v[k]); }');
  assert.match(g, /v\[int\(/);
});

// --------------------------------------------------- önişlemci satırları

test('`#define` kendinden sonraki bildirimi hoist edilemez yapmıyor', () => {
  /* Küresel ilk değer GLSL'de SABİT olmak zorunda; motor bu yüzden ilk
     değeri main'in başına taşıyor. Ama tarayıcı deyimleri noktalı virgülden
     ayırıyordu ve `#define` noktalı virgülle bitmiyor: iki satır tek parça
     olup "tiple başlıyor" kalıbına uymaz oluyor, taşıma hiç yapılmıyordu.
     Gerçek preset: martin - castle in the air. Korpusta 19 aşama. */
  const g = tr('#define sat saturate\nstatic const float2 pix = texsize.zw;\n' +
    'shader_body { ret = vec3(pix, 0.0); }');
  assert.match(g, /^vec2 pix;$/m, 'bildirim değersiz kalmalı');
  assert.match(g, /pix = texsize\.zw;/, 'ilk değer main içine taşınmalı');
  assert.ok(g.indexOf('pix = texsize.zw;') > g.indexOf('void main()'),
    'atama main\'in İÇİNDE olmalı');
});

test('`#define` gövdesinin sonundaki noktalı virgül atılıyor', () => {
  /* `#define texx tex2D(sampler_main,uv);` — HLSL'de açılım fazladan bir
     boş deyim veriyor, zararsız. Bizde atamanın sağı sarmalayıcıya
     giriyor ve noktalı virgül parantezin içinde kalıyor. */
  const g = gövde('#define texx tex2D(sampler_main,uv);\n' +
    'shader_body { float3 add = texx; ret = add; }');
  assert.doesNotMatch(tr('#define texx tex2D(sampler_main,uv);\nshader_body { ret = vec3(0.0); }'),
    /#define texx[^\n]*;/, 'makro gövdesi noktalı virgülle bitmemeli');
  assert.match(g, /toV3\(texx\)/);
});

test('doku bildirimi MAKRONUN İÇİNDE olsa da temizleniyor', () => {
  /* Gerçek koddan (Fed + Geiss - Color Pox Remix):
       `#define smp sampler sampler_manyfish;`
       `smp`
     Noktalı virgül makrodan önce alınırsa doku temizliği bildirimi artık
     tanımıyor ve `sampler` sözcüğü koda sızıyor — sıra bu yüzden önemli. */
  const g = tr('#define smp sampler sampler_manyfish;\nsmp\n' +
    'shader_body { ret = vec3(0.0); }');
  assert.doesNotMatch(g, /#define smp[^\n]*sampler /,
    'makronun içindeki doku bildirimi de silinmeli');
});

// ------------------------------------------------------- ad çakışmaları

test('preset `main` adını makro yaparsa bizim main\'imiz korunuyor', () => {
  /* Gerçek koddan: `#define main sampler_pw_main`. Makro bizim ürettiğimiz
     `void main()` satırını da açıyor ve sonuç "redefinition of a function".
     Korpusta 9 aşama. Presetin adı değişiyor, bizimki değil: motor kendi
     ürettiği koddan main'i çağırıyor. */
  const g = tr('#define main sampler_pw_main\nshader_body { ret = tex2D(main, uv); }');
  assert.match(g, /^void main\(\) \{$/m, 'giriş noktası main kalmalı');
  assert.match(g, /#define main_p sampler_pw_main/);
  assert.match(g, /tex2D\(main_p, uv\)/, 'presetin kullanımı yeni ada gitmeli');
});

test('preset yardımcımızı yeniden tanımlarsa kendi sürümünü alıyor', () => {
  /* Gerçek koddan (martin - city lights): preset kendi `GetBlur0`ını
     yazıyor, "function already has a body". `renameShadowed` bunu
     yapamıyor — onun kalıbı ÇAĞRI biçimini bilerek atlıyor, oysa
     değiştirilmesi gereken tam olarak o. */
  const g = tr('float3 GetBlur0 (float2 uvi) { return GetPixel(uvi); }\n' +
    'shader_body { ret = GetBlur0(uv); }');
  assert.match(g, /vec3 GetBlur0_p ?\(/, 'presetin tanımı yeniden adlandırılmalı');
  assert.match(g, /GetBlur0_p\(/, 'çağrısı da');
  assert.match(g, /vec3 GetBlur0 ?\(/, 'bizim yardımcımız yerinde kalmalı');
});

test('yerleşik adı ÇOKLU BİLDİRİMİN ortasındaysa da yeniden adlandırılıyor', () => {
  /* Gerçek koddan: `float3 neon, neons, col, noise, mod, mod2, stars, lg;`
     `mod` beşinci sırada. Tipin hemen ardını arayan kalıp yalnız İLK adı
     görüyordu ve `mod.z` "function name expected" veriyordu. */
  const g = gövde('shader_body { float3 a, b, mod, c; mod = ret; ret = vec3(mod.z); }');
  assert.match(g, /mod_v\.z/);
  assert.doesNotMatch(g, /[^_a-zA-Z]mod\.z/);
});

// -------------------------------------------------------- eksik dönüş

test('gövdesi boş bırakılmış fonksiyona dönüş ekleniyor', () => {
  /* Gerçek koddan (martin - on silent paths): `float2 rsp (float2 uv_in) {}`.
     Preset yazmaya başlamış, içini boş bırakmış; HLSL uyarıyla geçiyor,
     GLSL "Function does not return a value" deyip shader'ı düşürüyor.

     Denetim BİLEREK dar — "hiç return yok". "Her yoldan dönüyor mu" sorusu
     akış çözümlemesi ister ve yanlış cevap çalışan bir shader'a satır
     ekler. */
  const g = tr('float2 rsp (float2 uv_in) {}\nshader_body { ret.xy = rsp(uv); }');
  // Dönüş ayrıca imza dönüştürücüsüyle sarılıyor; aranan, dönüşün VAR olması.
  assert.match(g, /vec2 rsp \(vec2 uv_in\) \{ return \S*vec2\(0\.0\)\)?;\}?/);
});

test('dönüşü OLAN fonksiyona dokunulmuyor', () => {
  const g = tr('float2 rsp (float2 uv_in) { return uv_in*2.0; }\n' +
    'shader_body { ret.xy = rsp(uv); }');
  const fn = /vec2 rsp \(vec2 uv_in\) \{[\s\S]*?\}/.exec(g);
  assert.ok(fn, 'fonksiyon üretilmeli');
  assert.strictEqual((fn[0].match(/\breturn\b/g) || []).length, 1,
    'zaten dönüşü olan gövdeye ikincisi eklenmemeli');
  assert.match(fn[0], /uv_in\*2\.0/, 'presetin kendi dönüşü korunmalı');
});

// ------------------------------------------- mantıksal işleçler ve bool

test('`||` sayı operandlarla çalışıyor', () => {
  /* Gerçek koddan: `gmask = gmask || mask1;` — ikisi de sayı. HLSL sıfır
     değilse doğru sayıyor, GLSL `||`ı yalnız bool'da tanıyor.

     `bool`u float'a taşımak bu kovayı BÜYÜTECEKTİ (bool olan her değişken
     artık sayı), o yüzden ikisi aynı değişiklikte çözüldü. */
  const g = gövde('shader_body { float g, m; g = 0.0; m = 1.0; g = g || m; ret = vec3(g); }');
  assert.match(g, /\(\(g\) != 0\.0\) \|\| \(\(m\) != 0\.0\)/);
});

test('`?:` koşulu sayıysa karşılaştırmaya dönüyor', () => {
  const g = gövde('shader_body { float m = rad>0.5; ret = vec3(m ? 1.0 : 0.0); }');
  assert.match(g, /\(\(m\) != 0\.0\) \?/);
});

test('bool argüman sayıya çevriliyor, dönüştürücülerde ÇEVRİLMİYOR', () => {
  /* `saturate(mask == 1)` HLSL'de geçerli; GLSL'de o aşırı yükleme yok.
     Ama `float(x<y)` kendi argümanını yeniden sarsaydı her geçişte bir
     katman eklerdi — "fed's colorworms" tam olarak böyle bozuldu, dört
     geçişlik daraltma bütçesi tükenip GERÇEKTEN gereken daraltma aç
     kaldı. Ölçüm bunu tek bir bozulan aşama olarak gösterdi. */
  const g = gövde('shader_body { float m = 1.0; ret = vec3(saturate(m == 1.0)); }');
  assert.match(g, /saturate\(float\(\(?m == 1\.0\)?\)\)/);
  assert.doesNotMatch(g, /float\(float\(/, 'sarmalayıcı kendini sarmamalı');
});

// ------------------------------------------------- tip çıkarımının kapsamı

test('preset fonksiyonunun DÖNÜŞ TİPİ tip çıkarımına giriyor', () => {
  /* `bool inside(...)` artık float döndürüyor. Tip çıkarımı bunu bilmezse
     `if (inside(x))` daraltılmadan geçiyor ve GLSL sayıyı koşul kabul
     etmiyor — bool'u float'a taşımanın sessiz yan etkisiydi. */
  const g = gövde('float inside(float x) { return x>1.0; }\n' +
    'shader_body { if (inside(rad)) ret = vec3(1.0); }');
  assert.match(g, /if \(\(inside\([\s\S]*?\) != 0\.0\)/);
});

test('SARAN bildirim listesinin kuyruğu da tipleniyor', () => {
  /* Gerçek koddan (glassball dance):
       `float2 rs0, rs, rs1, dz, rsk, dz1, uv4,`
       `       Kugel1, Kugel2, Kugel3;`
     Satır sonunda koşulsuz durmak `Kugel1..3`ü tipsiz bırakıyordu; tipsiz
     operand daraltılmıyor ve `(Kugel1+Kugel2+Kugel3)*.25 + ret2/4` GLSL'e
     vec2 + vec3 olarak gidiyordu. Korpusta 20 aşama. */
  const g = gövde('shader_body { float2 a, b,\n       Kugel1, Kugel2;\n' +
    'float3 r3 = ret; float2 uv1 = uv; uv1 += (Kugel1 + Kugel2)*0.25 + r3/4.0; ret.xy = uv1; }');
  assert.match(g, /\(r3\/4\.0\)\.xy|\(\(Kugel1 \+ Kugel2\)\*0\.25 \+ r3\/4\.0\)/,
    'geniş operand daraltılmalı');
  assert.doesNotMatch(g, /Kugel1 \+ Kugel2\)\*0\.25 \+ r3\/4\.0\)\;/,
    'daraltılmamış vec2+vec3 kalmamalı');
});

test('AYNI AD ayrı fonksiyonlarda ayrı tiple bildirilebiliyor', () => {
  /* Gerçek koddan (EVET - Scanazoic): tek preset `tmp`yi üç fonksiyonda
     üç ayrı tiple bildiriyor. Önceden taranan çizelge tek tip tutuyor ve
     süslü parantez derinliği üçünü de aynı derinlikte gördüğü için
     sonuncusu kazanıyordu. Bildirim kullanımdan ÖNCE geldiği için konuma
     bağlı çizelge doğru cevabı veriyor. Korpusta 16 aşama. */
  const g = tr('float3 f1(float3 z) { float3 tmp, li; tmp = z*2.0; return tmp; }\n' +
    'float f2(float3 z) { float tmp, li; tmp = dot(z,z); return tmp; }\n' +
    'shader_body { ret = f1(ret) * f2(ret); }');
  assert.match(g, /float tmp, li; tmp = toF\(/, 'ikinci fonksiyonda tmp float olmalı');
  assert.match(g, /vec3 tmp, li; tmp = toV3\(/, 'birincide vec3');
});

// ------------------------------------------------------ skaler swizzle

test('skalerin SOL TARAFTAKİ swizzle\'ı atılıyor', () => {
  /* HLSL'de skalerin de bileşeni var: `float i; i.x *= k;` = `i *= k`.
     GLSL "field selection requires structure, vector, or interface block"
     diyor. Sağ tarafta daraltma bunu zaten çözüyordu; sol taraf atamanın
     HEDEFİ ve daraltmaya girmiyor. Gerçek preset: undulant. */
  const g = gövde('shader_body { int i; i = bass; i.x *= 2.0; ret = vec3(i); }');
  assert.match(g, /i \*= toF\(2\.0\)/);
  assert.doesNotMatch(g, /i\.x \*=/);
});

test('skalere ÇOK bileşenli yazma düzeltilmiyor', () => {
  /* `i.xy = ...` HLSL'de de geçersiz. Sessizce düzeltmek yanlış görüntü
     üretirdi; derlenmemek en azından görünür. */
  const g = gövde('shader_body { float i; i.xy = uv; ret = vec3(i); }');
  assert.match(g, /i\.xy =/);
});

// ------------------------------------------------- diziler ve indeksler

test('dizi ELEMANINA atama eleman tipine göre sarılıyor', () => {
  /* `float vals[8]; vals[0] = Intrinisic(...)` — sol taraf köşeli
     parantezle bitiyor ve adı sonda arayan kalıp hiç eşleşmiyordu: atama
     sarmalanmadan geçip float bir elemana vec3 yazıyordu.
     Gerçek preset: EVET - Spiracology 2. */
  const g = gövde('shader_body { float vals[8]; vals[0] = tex2D(sampler_main,uv); ret = vec3(vals[0]); }');
  assert.match(g, /vals\[0\] = toF\(/);
});

test('dizi BİLDİRİMİ eleman kuralından muaf', () => {
  /* `vec4 s[2] = vec4[2](...)` sol tarafı da köşeli parantezle bitiyor ama
     orada sarmalanacak eleman yok — dizinin tamamı atanıyor ve
     `toV4(vec4[2](...))` geçersiz GLSL. */
  const g = tr('const float4 s[2] = { 1,2,3,4, 5,6,7,8 };\nshader_body { ret = s[0].xyz; }');
  assert.match(g, /vec4 s\[2\] = vec4\[2\]\(/);
  assert.doesNotMatch(g, /toV4\(vec4\[2\]/);
});

test('indeks ifadesindeki tam sayı sabiti ondalıklaşıyor', () => {
  /* `floatify` köşeli parantezin içini `h[0]` bozulmasın diye atlıyor. Ama
     indeks artık `int(...)` içine giriyor ve orada `i+1` float ile tamsayı
     sabitini karıştırıyor: "no operation '+' exists ... 'const int'". */
  const g = gövde('shader_body { float2 d[8]; float i = 0.0; ret.xy = d[i+1]; }');
  assert.match(g, /d\[int\(i\+1\.0\)\]/);
});

// ------------------------------------------ dönme matrisi ve alfa kanalı

test('dönme matrisi sayı yerinde kullanılabiliyor', () => {
  /* Gerçek koddan (fed's stroboscopix): `ret.x -= rot_f3;`. HLSL matrisi
     skalere kırparken [0][0]'ı alıyor. */
  const g = tr('shader_body { ret.x -= rot_f3; }');
  assert.match(g, /float toF\(vec3 m\[4\]\)\{ return m\[0\]\.x; \}/);
  assert.match(g, /ret\.x -= toF\(rot_f3\)/);
});

test('dönme matrisiyle çarpım ve matrisin EKSİSİ', () => {
  /* `mul(adjuv, rot_d2)` — HLSL boyut tutmadığında matrisi kırpıyor, yani
     vec2 de geçerli bir çağrı. `mul(sp, -rot_d2)` ise GLSL'de bir dizinin
     eksisi; işleç aşırı yüklemesi olmadığı için işaret çarpımın dışına
     alınıyor — çarpım matriste doğrusal, sonuç birebir aynı. */
  const g = gövde('shader_body { float2 sp = uv; sp = mul(sp,-rot_d2); ret.xy = mul(sp,rot_d2).xy; }');
  assert.match(g, /\(-mul\(sp, rot_d2\)\)/);
  assert.match(tr('shader_body { ret.xy = mul(uv,rot_d2).xy; }'),
    /vec3 mul\(vec2 v, vec3 m\[4\]\)/);
});

test('vec3\'ten istenen DÖRDÜNCÜ bileşen 1,0 ile karşılanıyor', () => {
  /* `tex2D` bilerek vec3 döndürüyor (ölçümle seçildi: presetlerin ezici
     çoğunluğu üç bileşen bekliyor). Kalan azınlık `.ag` yazıyor ve GLSL
     "vector field selection out of range" diyor.

     1,0 uydurma değil: motorun bütün dokuları RGB — bağlam `alpha: false`
     ile kuruluyor ve gürültü dokularının alfası yok. */
  const g = gövde('shader_body { float2 n = tex2D(sampler_noise_lq, uv).ag*2-1; ret = vec3(n,0); }');
  assert.match(g, /vec2\(1\.0, \(tex2D\(sampler_noise_lq, uv\)\)\.g\)/);
});

// ------------------------------------------------ fonksiyon parametreleri

test('AYNI ADLI iki imza parametrelerini karıştırmıyor', () => {
  /* Gerçek koddan (martin - massif central): preset `noise3`ü hem
     `float3 uvi` hem `float2 uvi` ile tanımlıyor. Önceden taranan çizelge
     `uvi` için tek tip tutuyor ve sonuncusu kazanıyordu; öteki gövdedeki
     her `uvi` ataması yanlış tiple sarılıyordu. */
  const g = tr('float2 n3 (float3 uvi) { uvi *= 0.16; return uvi.xy; }\n' +
    'float2 n2 (float2 uvi) { uvi /= 6.0; return uvi; }\n' +
    'shader_body { ret.xy = n3(ret) + n2(uv); }');
  assert.match(g, /vec2 n3 \(vec3 uvi\) \{ uvi \*= toV3\(0\.16\)/, 'vec3 imzada toV3');
  assert.match(g, /vec2 n2 \(vec2 uvi\) \{ uvi \/= toV2\(6\.0\)/, 'vec2 imzada toV2');
});

test('fonksiyon YERELİ dışarı sızmıyor', () => {
  /* Konuma bağlı çizelge fonksiyondan çıkarken geri alınmazsa bir
     yardımcının yereli metnin geri kalanını zehirliyor. Ölçüldü: geri alma
     olmadan 31 aşama bozuldu, üstelik hepsi ÖNCEDEN derleniyordu. */
  const g = tr('float2 c;\nfloat helper(float3 z) { float c; c = z.x; return c; }\n' +
    'shader_body { c = uv; ret = vec3(c, helper(ret)); }');
  assert.match(g, /c = toV2\(uv\)/, 'gövdedeki c hâlâ vec2 olmalı');
});

test('KARE OLMAYAN matrisle çarpımın genişliği sütun sayısı', () => {
  /* `mul(adjuv, rot_d2)` — adjuv vec2, dönme matrisi HLSL'de float4x3
     (üç sütun, dört satır), sonuç vec3. Tip çıkarımı "vektörün genişliği
     korunur" diyordu; kare matriste doğru, burada değil. Sonuç vec2
     sanılınca `mul(...)*aspect.xy` daraltılmadan GLSL'e gidiyor ve
     vec3 * vec2 kalıyordu — korpusun SON derlenmeyen aşamasıydı. */
  const g = gövde('shader_body { float2 adjuv = float2(q3,q4); adjuv = mul(adjuv,rot_d2)*aspect.xy; ret.xy = adjuv; }');
  assert.match(g, /\(mul\(adjuv,rot_d2\)\)\.xy\*aspect\.xy/);
});
