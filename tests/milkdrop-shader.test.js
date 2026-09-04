'use strict';
/* MilkDrop piksel shader'ı (HLSL) -> GLSL ES 3.00 çeviricisinin testleri.
 *
 * Buradaki her durum GERÇEK preset kodundan alındı ve çoğu, derleme
 * kapısının 10.000 presetlik korpusta yakaladığı bir hatanın yeniden
 * yaşanmaması için yazıldı. Sessizce bozulmaları bu testlerin varlık
 * sebebi: yanlış çevrilmiş bir shader hata vermez, yalnızca ekranda
 * yanlış görünür ya da tümden siyah kalır. */

/* Satır sonu: kaçış dizisi yazmadan. */
const EOL = String.fromCharCode(10);
const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/shared/milkdrop-shader.js');

// ---------------------------------------------------------------- floatify

test('floatify: çıplak tam sayıya ondalık ekler', () => {
  assert.strictEqual(T.floatify('ret *= 5;'), 'ret *= 5.0;');
});

test('floatify: zaten ondalıklı sayıya dokunmaz', () => {
  assert.strictEqual(T.floatify('a = 0.19;'), 'a = 0.19;');
  assert.strictEqual(T.floatify('a = 1.5;'), 'a = 1.5;');
});

test('floatify: tanımlayıcı içindeki rakama dokunmaz', () => {
  assert.strictEqual(T.floatify('q1 + sampler_blur1 + GetBlur1(uv)'),
    'q1 + sampler_blur1 + GetBlur1(uv)');
});

test('floatify: swizzle ve tip adlarını bozmaz', () => {
  assert.strictEqual(T.floatify('x.xyz * float3(1,2,3)'), 'x.xyz * float3(1.0,2.0,3.0)');
});

/* Üs biçimi: 1e-9 -> 1e-9.0 GEÇERSİZ GLSL olurdu ve shader hiç derlenmezdi. */
test('floatify: üslü sayıyı bozmaz', () => {
  assert.strictEqual(T.floatify('x = 1e-9;'), 'x = 1e-9;');
  assert.strictEqual(T.floatify('x = 2.5e3;'), 'x = 2.5e3;');
  assert.strictEqual(T.floatify('x = 1E+5;'), 'x = 1E+5;');
});

/* Dizi indisi tam sayı kalmalı: h[0.0] geçersiz. */
test('floatify: köşeli parantez içine dokunmaz', () => {
  assert.strictEqual(T.floatify('h[0] + h[12]'), 'h[0] + h[12]');
});

/* Önişlemci yalnızca tam sayı kabul ediyor: #if 1.0 kırılır. */
test('floatify: önişlemci satırlarına dokunmaz', () => {
  assert.strictEqual(T.floatify('#if 1' + EOL + 'a = 2;' + EOL + '#endif'),
    '#if 1' + EOL + 'a = 2.0;' + EOL + '#endif');
});

// ------------------------------------------------------------ yorum ve gövde

test('stripComments: satır yorumunu siler, satırı korur', () => {
  assert.strictEqual(T.stripComments('a=1; // yorum' + EOL + 'b=2;'),
    'a=1; ' + EOL + 'b=2;');
});

test('stripComments: blok yorumunu siler', () => {
  assert.strictEqual(T.stripComments('a=/* ara */1;'), 'a= 1;');
});

test('split: shader_body öncesini küresel, içini gövde sayar', () => {
  const r = T.split('float3 helper(){ return 0; }' + EOL + 'shader_body { ret = 1; }');
  assert.strictEqual(r.globals, 'float3 helper(){ return 0; }');
  assert.strictEqual(r.body, 'ret = 1;');
});

test('split: shader_body yoksa metnin tamamı gövdedir', () => {
  const r = T.split('ret = 1;');
  assert.strictEqual(r.globals, '');
  assert.strictEqual(r.body, 'ret = 1;');
});

// ------------------------------------------------------------- sampler adları

test('canonSampler: süzme ön eklerini soyar', () => {
  assert.strictEqual(T.canonSampler('sampler_fw_main'), 'sampler_main');
  assert.strictEqual(T.canonSampler('sampler_pc_noise_lq'), 'sampler_noise_lq');
});

test('canonSampler: ön eki olmayanı değiştirmez', () => {
  assert.strictEqual(T.canonSampler('sampler_main'), 'sampler_main');
  assert.strictEqual(T.canonSampler('sampler_worms'), 'sampler_worms');
});

// ------------------------------------------------------------------ rewrite

test('rewrite: HLSL tiplerini GLSL karşılıklarına çevirir', () => {
  const r = T.rewrite('float3 a; float2 b; float4 c; float3x3 m;');
  assert.match(r, /vec3 a;/);
  assert.match(r, /vec2 b;/);
  assert.match(r, /vec4 c;/);
  assert.match(r, /mat3 m;/);
});

test('rewrite: int ve double vektörlerini de çevirir', () => {
  assert.match(T.rewrite('int2 k;'), /vec2 k;/);
  assert.match(T.rewrite('double3 d;'), /vec3 d;/);
});

/* pow yerleşiğini yeniden bildirmek bazı sürücülerde TÜM biçimlerini
   gizliyor; bu yüzden çağrılar ayrı bir ada taşınıyor. */
test('rewrite: pow çağrılarını mdPow yapar', () => {
  assert.match(T.rewrite('x = pow(a, b);'), /mdPow\(a, b\)/);
});

test('rewrite: küçük harfli yerleşik adlarını düzeltir', () => {
  assert.match(T.rewrite('x = tex2d(s, uv);'), /tex2D\(/);
});

/* HLSL matris kurucusu SATIR sırasıyla dolar, GLSL SÜTUN sırasıyla. Aynı
   sırayla vermek matrisi devrik yapar: dönme ters yöne döner ve derleyici
   hiçbir şey söylemez. */
test('rewrite: matris kurucusunu satır sıralı yardımcıya taşır', () => {
  assert.match(T.rewrite('float2x2 r = float2x2(1,2,3,4);'), /hmat2\(1\.0,2\.0,3\.0,4\.0\)/);
});

test('rewrite: süslü parantezli matris ilk değerini de taşır', () => {
  assert.match(T.rewrite('float2x2 r = {1,2,3,4};'), /hmat2\(1\.0,2\.0,3\.0,4\.0\)/);
});

test('rewrite: presetin kendi sampler bildirimini siler', () => {
  const r = T.rewrite('sampler2D sampler_lichen; ret = 0.0;');
  assert.doesNotMatch(r, /sampler2D sampler_lichen/);
});

test('rewrite: sampler_state bloğunu siler', () => {
  const r = T.rewrite('sampler sampler_grad = sampler_state { MipFilter = LINEAR; }; ret = 0.0;');
  assert.doesNotMatch(r, /sampler_state/);
});

test('rewrite: static niteleyicisini kaldırır', () => {
  assert.doesNotMatch(T.rewrite('static float k = 3;'), /static/);
});

// --------------------------------------------------------------- % işleci

test('rewrite: yüzde işlecini mod çağrısına çevirir', () => {
  assert.match(T.rewrite('if(frame%2==0.0) x=1;'), /mod\(frame, 2\.0\)/);
});

/* İlk yazımda tarama parantezde durup ifadeyi ortadan bölüyordu:
   `tex2D(s,uv)mod(.x, b)` gibi bir şey çıkıyordu. */
test('rewrite: yüzde işlecinin sol yanındaki çağrıyı bütün alır', () => {
  assert.match(T.rewrite('a = tex2D(s,uv).x % b;'), /mod\(tex2D\(s,uv\)\.x, b\)/);
});

/* % ile * aynı öncelikte ve soldan birleşir: b*c%d, (b*c)%d demek. */
test('rewrite: çarpma zincirini yüzde işlecinin soluna toplar', () => {
  assert.match(T.rewrite('y = b*c % d;'), /mod\(b\*c, d\)/);
});

// ------------------------------------------------------- atama sarmalayıcısı

/* HLSL atamada sessizce kırpar ve yayar; GLSL ikisini de yapmaz. */
test('atama: vec3 hedefe skaler yayılır', () => {
  assert.match(T.rewrite('ret = 0.0;'), /ret = toV3\(0\.0\)/);
});

test('atama: float hedefe vektör kırpılır', () => {
  assert.match(T.rewrite('float corr; corr = texsize.xy;'), /corr = toF\(texsize\.xy\)/);
});

test('atama: swizzle uzunluğu hedef tipi belirler', () => {
  assert.match(T.rewrite('ret.yz = ret.x * float2(1,1);'), /ret\.yz = toV2\(/);
  assert.match(T.rewrite('ret.x = GetBlur1(uv);'), /ret\.x = toF\(/);
});

test('atama: bileşik işleçler de sarmalanır', () => {
  assert.match(T.rewrite('ret += GetBlur1(uv);'), /ret \+= toV3\(/);
});

/* Süslü parantezsiz if gövdeleri: sol taraf deyimin SONUNDA duruyor. */
test('atama: süslü parantezsiz if gövdesini de sarmalar', () => {
  assert.match(T.rewrite('if(a==b) ret = 0.0;'), /ret = toV3\(0\.0\)/);
});

test('atama: karşılaştırma işleçlerini atama sanmaz', () => {
  const r = T.rewrite('x = (a == b);');
  assert.doesNotMatch(r, /a == toF\(b\)/);
});

/* for başlığındaki noktalı virgüller deyim sonu değil; oradaki i=0
   sarmalanırsa döngü bozulur. */
test('atama: for başlığına dokunmaz', () => {
  const r = T.rewrite('for(int i=0;i<4;i++) ret += 0.1;');
  assert.match(r, /for\(float i=0\.0;i<4\.0;i\+\+\)/);
});

/* GLSL const'un ilk değerinin SABİT ifade olmasını istiyor, HLSL istemiyor:
   presetler `const float sw = rand_preset.x >= .4;` gibi satırlar yazıyor ve
   o shader'lar yalnızca bu yüzden derlenmiyordu. Niteleyiciyi düşürmek
   satırı sıradan bir yerel değişkene çeviriyor; const'un burada koruduğu
   hiçbir şey yok, çünkü bu gövdeler tek geçişte koşuyor. */
test('const niteleyicisi düşürülür, ilk değer sabit olmak zorunda kalmaz', () => {
  assert.strictEqual(T.rewrite('const float k = 0.0;'), 'float k = toF(0.0);');
  assert.doesNotMatch(T.rewrite('const float sw = rand_preset.x >= .4;'), /const/);
});

/* HLSL karşılaştırmayı 0/1 diye okur; GLSL okumaz ve bool'u float'a atamaz. */
test('atama: karşılaştırma sonucu sayıya çevrilir', () => {
  assert.match(T.rewrite('float m = (z1 < 1.3);'), /toF\(\(z1 < 1\.3\)\)/);
});

/* HLSL'de serbest olan bu adlar GLSL ES'te ayrılmış; presetler bunları
   değişken adı yapıyor ve shader yalnızca bu yüzden derlenmiyordu. */
test('GLSL ayrılmış sözcükleri değişken adı olarak kullanılabilir', () => {
  const r = T.rewrite('float3 output = tex2D(sampler_main, uv).xyz;');
  assert.doesNotMatch(r, /\boutput\b/);
  assert.match(r, /vec3 output_v/);
});

/* Yalnızca ilk adı çizelgeye yazmak `float zv, zw;` durumunda ikinciyi
   tipsiz bırakıyordu ve o satır onarılmadan geçiyordu. */
test('atama: virgülle ayrılmış bildirimlerin hepsini tanır', () => {
  assert.match(T.rewrite('float zv, zw; zw = GetBlur1(uv);'), /zw = toF\(/);
});

// --------------------------------------------------------------- translate

test('translate: tam bir GLSL ES 3.00 shader üretir', () => {
  const r = T.translate('shader_body { ret = tex2D(sampler_main, uv).xyz; }');
  assert.strictEqual(r.hard.length, 0);
  assert.strictEqual(r.empty, false);
  assert.match(r.glsl, /^#version 300 es/);
  assert.match(r.glsl, /void main\(\) \{/);
  /* Çıkış kırpılıyor: MilkDrop'un tamponu 0..1'de doyuyor ve presetler o
     doyuma güveniyor. Yarım kayan noktalı tamponda kırpma olmayınca
     değerler geri beslemede sınırsız büyüyüp ekranı tek renge boğuyordu. */
  assert.match(r.glsl, /outColor = vec4\(clamp\(ret, 0\.0, 1\.0\), 1\.0\);/);
});

test('translate: boş kaynağı boş olarak işaretler', () => {
  assert.strictEqual(T.translate('').empty, true);
  assert.strictEqual(T.translate('   ').empty, true);
});

test('translate: q1..q32 değişkenlerini uniform paketlerinden doldurur', () => {
  const r = T.translate('shader_body { ret = q7; }');
  assert.match(r.glsl, /q7 = _qb\.z;/);
  assert.match(r.glsl, /q32 = _qh\.w;/);
});

/* q'lar #define olsaydı `q25 = ...` bir uniform'a atama olur ve presetlerin
   %4,8'i derlenmezdi. */
test('translate: presetin q değişkenine yazmasına izin verir', () => {
  const r = T.translate('shader_body { q25 = 1.0; ret = q25; }');
  assert.match(r.glsl, /float q1, q2/);
  assert.strictEqual(r.hard.length, 0);
});

test('translate: presetin kendi fonksiyonlarını küresel kapsamda tutar', () => {
  const r = T.translate('float3 cloud(float2 p){ return float3(p, 0); }' + EOL +
    'shader_body { ret = cloud(uv); }');
  assert.match(r.glsl, /vec3 cloud\(vec2 p\)/);
  // fonksiyon main'DEN ÖNCE gelmeli, yoksa çağrısı çözülmez
  assert.ok(r.glsl.indexOf('vec3 cloud') < r.glsl.indexOf('void main()'));
});

/* GLSL ES küresel ilk değerin sabit olmasını istiyor; uniform sabit değil. */
test('translate: küresel ilk değerleri main içine taşır', () => {
  const r = T.translate('float2 sunpos = float2(sin(time), 0);' + EOL +
    'shader_body { ret.xy = sunpos; }');
  assert.match(r.glsl, /vec2 sunpos;/);
  assert.match(r.glsl, /sunpos = toV2\(vec2\(sin\(time\), 0\.0\)\);/);
  assert.ok(r.glsl.indexOf('sunpos = toV2') > r.glsl.indexOf('void main()'));
});

test('translate: #include dosyası isteyeni sert engelle işaretler', () => {
  const r = T.translate('#include "yok.hlsl"' + EOL + 'shader_body { ret = 0; }');
  assert.deepStrictEqual(r.hard, ['#include']);
});

/* Önişlemcinin geri kalanı GLSL ES'te zaten var; hepsini reddetmek
   122 preseti gereksiz yere eliyordu. */
test('translate: diğer önişlemci yönergelerini engel saymaz', () => {
  const r = T.translate('#define K 2.0' + EOL + 'shader_body { #if 1' + EOL +
    'ret = K;' + EOL + '#endif' + EOL + '}');
  assert.deepStrictEqual(r.hard, []);
});

/* Eksik doku shader'ı ENGELLEMEZ: yerine gürültü bağlanır ve presetin blur
   zinciri, q ile sürülen renk matematiği çalışmaya devam eder. Ama bu
   yaklaşıklık görünür olmalı. */
test('translate: bilinmeyen dokuyu yumuşak uyarı sayar, engel değil', () => {
  const r = T.translate('shader_body { ret = tex2D(sampler_worms, uv); }');
  assert.deepStrictEqual(r.hard, []);
  assert.strictEqual(r.soft.length, 1);
  assert.match(r.soft[0], /sampler_worms/);
  assert.deepStrictEqual(r.extraSamplers, ['sampler_worms']);
  assert.match(r.glsl, /uniform sampler2D sampler_worms;/);
});

test('translate: bilinen dokular yumuşak uyarı üretmez', () => {
  const r = T.translate('shader_body { ret = tex2D(sampler_fw_main, uv) + GetBlur1(uv); }');
  assert.deepStrictEqual(r.soft, []);
  assert.deepStrictEqual(r.extraSamplers, []);
});

test('translate: sampler süzme türevlerini tek kaynağa indirir', () => {
  const r = T.translate('shader_body { ret = tex2D(sampler_pw_main, uv); }');
  assert.match(r.glsl, /tex2D\(sampler_main, uv\)/);
});

/* MilkDrop'ta M_PI_2, pi/2 DEĞİL 2*pi. Yarısını yazmak açıyı ikiye böler
   ve derleyici bir şey demez. */
test('translate: MilkDrop matematik sabitlerini doğru değerlerle verir', () => {
  const r = T.translate('shader_body { ret = M_PI_2; }');
  assert.match(r.glsl, /#define M_PI_2 6\.28318530718/);
  assert.match(r.glsl, /#define M_PI 3\.14159265359/);
});
