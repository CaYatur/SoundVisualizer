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
  assert.match(r.glsl, /outColor = vec4\(clamp\(ret, 0\.0, 1\.0\), vBlend\);/);
});

/* GEÇİŞ ALFASI. Preset geçişinde iki preset aynı hedefe üst üste
   çiziliyor ve hangi pikselde hangisinin görüneceğini düğümden gelen bu
   alfa söylüyor. Sabit 1 yazmak geçişi tümden görünmez kılardı; geçiş
   yokken düğümlerin hepsi 1 taşıyor, yani çıktı eskisiyle aynı. */
test('translate: geçiş alfası iki aşamada da bildiriliyor', () => {
  for (const stage of ['warp', 'comp']) {
    const r = T.translate('shader_body { ret = float3(1,1,1); }', { stage });
    assert.match(r.glsl, /in float vBlend;/, stage);
    assert.match(r.glsl, /outColor = vec4\(clamp\(ret, 0\.0, 1\.0\), vBlend\);/, stage);
  }
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

/* Süzme türevi KENDİ uniform'unu alıyor, kanonik ada indirgenmiyor.

   Eskiden indirgeniyordu: `sampler_pw_main` (noktasal+tekrarlı) ile
   `sampler_main` aynı uniform'a düşüyor ve aynı örneklemeyi alıyordu.
   Korpusun %22,7'si aynı dokuyu iki farklı ön ekle okuyor — o presetler
   iki ayrı sonuç bekleyip tek sonuç alıyordu. */
test('translate: süzme türevi kendi uniform ve doku birimini alır', () => {
  const r = T.translate('shader_body { ret = tex2D(sampler_pw_main, uv); }');
  assert.match(r.glsl, /tex2D\(sampler_pw_main, uv\)/);
  assert.match(r.glsl, /uniform sampler2D sampler_pw_main;/);
  assert.deepStrictEqual(r.samplerPlan, [{
    name: 'sampler_pw_main', canon: 'sampler_main',
    filter: 'nearest', wrap: 'repeat', user: false,
  }]);
});

test('translate: ön ek harfleri süzme ve sarmayı ayrı ayrı belirler', () => {
  const one = (s) => T.translate('shader_body { ret = tex2D(' + s + ', uv); }').samplerPlan[0];
  assert.deepStrictEqual(
    { f: one('sampler_fc_main').filter, w: one('sampler_fc_main').wrap },
    { f: 'linear', w: 'clamp' });
  assert.deepStrictEqual(
    { f: one('sampler_pw_main').filter, w: one('sampler_pw_main').wrap },
    { f: 'nearest', w: 'repeat' });
  assert.deepStrictEqual(
    { f: one('sampler_pc_main').filter, w: one('sampler_pc_main').wrap },
    { f: 'nearest', w: 'clamp' });
  assert.deepStrictEqual(
    { f: one('sampler_fw_main').filter, w: one('sampler_fw_main').wrap },
    { f: 'linear', w: 'repeat' });
});

/* Ön eksiz yerleşik plana GİRMİYOR: kendi sabit birimini kullanıyor.
   Girseydi her preset gereksiz yere bir doku birimi harcardı. */
test('translate: ön eksiz yerleşik sampler plana girmez', () => {
  const r = T.translate('shader_body { ret = tex2D(sampler_main, uv) + GetBlur1(uv); }');
  assert.deepStrictEqual(r.samplerPlan, []);
});

/* Aynı dokunun iki farklı ön ekle okunması korpusun %22,7'si — ikisi de
   ayrı plan girdisi olmalı, yoksa biri diğerinin ayarını alır. */
test('translate: aynı doku iki ön ekle okunursa iki ayrı girdi olur', () => {
  const r = T.translate(
    'shader_body { ret = tex2D(sampler_pc_main, uv) + tex2D(sampler_fw_main, uv); }');
  assert.strictEqual(r.samplerPlan.length, 2);
  assert.deepStrictEqual(r.samplerPlan.map((p) => p.name).sort(),
    ['sampler_fw_main', 'sampler_pc_main']);
  // İkisi de aynı dokuyu okuyor, farklı ayarla
  assert.deepStrictEqual(r.samplerPlan.map((p) => p.canon), ['sampler_main', 'sampler_main']);
});

/* Kullanıcı dokusu ön eksiz de olsa plana giriyor: yerleşiklerin sabit
   birimlerinden birini kullanamaz, kendi birimi olmak zorunda. */
test('translate: kullanıcı dokusu ön eksiz de plana girer', () => {
  const r = T.translate('shader_body { ret = tex2D(sampler_worms, uv); }');
  assert.deepStrictEqual(r.samplerPlan, [{
    name: 'sampler_worms', canon: 'sampler_worms',
    filter: 'linear', wrap: 'repeat', user: true,
  }]);
});

/* MilkDrop'ta M_PI_2, pi/2 DEĞİL 2*pi. Yarısını yazmak açıyı ikiye böler
   ve derleyici bir şey demez. */
test('translate: MilkDrop matematik sabitlerini doğru değerlerle verir', () => {
  const r = T.translate('shader_body { ret = M_PI_2; }');
  assert.match(r.glsl, /#define M_PI_2 6\.28318530718/);
  assert.match(r.glsl, /#define M_PI 3\.14159265359/);
});

/* Aşağıdakilerin hepsi resmi preset paketinden ölçümle çıktı:
   scripts/milkdrop-compile-rate.js her birini gerçek bir WebGL2 bağlamında
   derlenmezken buldu. Birim testi olarak da duruyorlar ki ileride bir
   yeniden düzenleme birini sessizce geri almasın — korpus depoda değil,
   yani ölçüm her ortamda koşamıyor. */

test('translate: lum float2 ile de çağrılabiliyor', () => {
  /* "Aqua Lumens" lum(uv_orig) yazıyor. HLSL'de dar vektörden genişe geçiş
     normalde yasak ama fxc'nin eski kipi sıfırla dolduruyor; biz de. */
  const r = T.translate('shader_body { ret = lum(uv_orig); }');
  assert.match(r.glsl, /float lum\(vec2 v\)/);
});

test('translate: GetPixel/GetBlur float3 ve skaler koordinat alıyor', () => {
  /* GetPixel(GetBlur1(uv)+...) gerçek kodda var: GetBlur1 float3 döndürüyor.
     GetPixel(0.5) de var. HLSL kırpar ve yayar. */
  const r = T.translate('shader_body { ret = GetPixel(GetBlur1(uv)) + GetBlur3(0.5); }');
  assert.match(r.glsl, /vec3 GetPixel\(vec3 u\)/);
  assert.match(r.glsl, /vec3 GetBlur3\(float u\)/);
});

test('translate: uniforma yazan preset yerel kopya alıyor', () => {
  /* "gimme color (Bubble Spinner Mix)" rand_preset'e atıyor. GLSL'de
     uniform salt okunur, atama shader'ın tamamını düşürüyordu. */
  const r = T.translate('shader_body { rand_preset = rand_preset * 2.0; ret = rand_preset.xyz; }');
  assert.match(r.glsl, /uniform vec4 rand_preset;/, 'uniform yerinde kalmalı');
  assert.match(r.glsl, /vec4 rand_preset_w;/, 'yerel kopya bildirilmeli');
  assert.match(r.glsl, /rand_preset_w = rand_preset;/, 'kopya tohumlanmalı');
  assert.ok(!/rand_preset_w = rand_preset_w/.test(r.glsl), 'tohum kendini okumamalı');
});

/* `hue_shader` ARTIK UNIFORM DEĞIL: ekran boyunca değiştiği için dört
   köşe renginden her pikselde hesaplanıyor ve dosya kapsamında bir
   değişken olarak duruyor. Bu yüzden ona yazan preset takma ada da
   ihtiyaç duymuyor — atama doğrudan değişkene gidiyor.

   "Flowercraft" hue_shader'a atıyor; bu testin koruduğu şey o satırın
   hâlâ derlenmesi. */
test('translate: hue_shader yazılabilir bir değişken, uniform değil', () => {
  const r = T.translate('shader_body { hue_shader = hue_shader * 2.0; ret = hue_shader; }');
  assert.ok(!/uniform vec3 hue_shader;/.test(r.glsl), 'uniform olmamalı');
  assert.match(r.glsl, /vec3 hue_shader;/, 'dosya kapsamında bildirilmeli');
  assert.ok(!/hue_shader_w/.test(r.glsl), 'takma ada gerek yok');
  assert.match(r.glsl, /hue_shader = hueAt/, 'köşelerden hesaplanmalı');
  assert.match(r.glsl, /uniform vec3 hue_corner/);
});

test('translate: yalnız okunan uniform takma ad almıyor', () => {
  /* Aksi halde her preset gereksiz bir kopya taşırdı ve karşılaştırma yazan
     presetler (rand_preset.x >= .4) da yanlışlıkla yakalanırdı. */
  const a = T.translate('shader_body { ret = vec3(rand_frame.x); }');
  assert.ok(!/rand_frame_w/.test(a.glsl));
  const b = T.translate('shader_body { if (rand_preset.x >= 0.4) ret = vec3(1.0); }');
  assert.ok(!/rand_preset_w/.test(b.glsl));
});

test('translate: rand_preset float4', () => {
  /* MilkDrop'ta float4 ve presetler .w okuyor. vec3 bırakmak "vector field
     selection out of range" veriyordu. Tip çizelgesinde de vec4 olmalı,
     yoksa aritmetiği daraltılmaz ve bu sefer operand tipi patlar. */
  const r = T.translate('shader_body { ret = vec3(rand_preset.w); }');
  assert.match(r.glsl, /uniform vec4 rand_preset;/);
  const s = T.translate('shader_body { ret = ret * rand_preset; }');
  assert.ok(!/^\s*ret = ret \* rand_preset;/m.test(s.glsl),
    'vec3 * vec4 daraltılmadan geçmemeli');
});

test('translate: HLSL dizi ilk değerini GLSL kurucusuna çevirir', () => {
  /* ORB presetleri `const float4 samples[4] = { 16 skaler };` yazıyor —
     HLSL listeyi DÜZ yazmayı serbest bırakıyor. GLSL ES'te bu sözdizimi
     yok; kurucu gerekiyor ve liste bileşen sayısına göre gruplanmalı. */
  const r = T.translate(
    'const float4 s[2] = { 1,2,3,4, 5,6,7,8 };\nshader_body { ret = s[0].xyz; }');
  assert.match(r.glsl, /vec4 s\[2\] = vec4\[2\]\(vec4\(1\.0, 2\.0, 3\.0, 4\.0\), vec4\(5\.0, 6\.0, 7\.0, 8\.0\)\)/);
});

test('translate: dizi indeksi tam sayıya çevriliyor', () => {
  /* `for(float i=...) s[i]` GLSL'de "integer expression required" veriyor.
     Bildirim gövdeden AYRI yerde olabildiği için ad iki parçadan birlikte
     toplanıyor; yalnız kendi metnine bakan bir geçiş bunu kaçırıyordu. */
  const r = T.translate(
    'float s[2] = { 1, 2 };\nshader_body { for(float i=0;i<2;i++) ret += s[i]; }');
  assert.match(r.glsl, /s\[int\(i\)\]/);
  assert.ok(!/s\[int\(int\(/.test(r.glsl), 'iki kez sarılmamalı');
  assert.match(r.glsl, /float s\[2\]/, 'bildirimdeki boyut sarılmamalı');
});

test('translate: dizi adı tip çizelgesine yazılmıyor', () => {
  /* Yazılırsa `s[i]` bileşen erişimi sanılıp `s[i].x` içindeki `.x`
     siliniyor; ORB presetlerinde bu `vec2(...)` çağrısına sekiz bileşen
     verip "too many arguments" hatası üretiyordu. */
  const r = T.translate(
    'float4 s[2] = { 1,2,3,4, 5,6,7,8 };\nshader_body { ret.xy = vec2(s[0].x, s[0].y); }');
  assert.match(r.glsl, /s\[0\]\.x/, 'swizzle korunmalı');
  assert.match(r.glsl, /s\[0\]\.y/);
});

test('translate: lerp karışım oranı vektör olabiliyor', () => {
  /* Korpustaki en büyük tek hata kovası: `lerp(ret, 1.0, k)` — float3,
     skaler, float3. HLSL üçünü birbirine uyduruyor, GLSL uydurmuyor. */
  const r = T.translate('shader_body { ret = lerp(ret, 1.0, ret*0.5); }');
  assert.match(r.glsl, /vec3 lerp\(vec3 a, float b, vec3 t\)/);
  assert.match(r.glsl, /vec3 lerp\(float a, float b, vec3 t\)/);
});

test('translate: min ve max mdMin/mdMax üzerinden geçiyor', () => {
  /* GLSL ES yerleşik bir fonksiyonun yeniden bildirilmesini yasaklıyor;
     kendi adıyla aşırı yüklemeyi denediğimde derleme oranı %0'a düştü.
     Asıl eksik olan argüman sırası: min(float, genType) GLSL'de yok. */
  const r = T.translate('shader_body { ret = min(0.1, ret) + max(0.2, ret); }');
  assert.match(r.glsl, /mdMin\(0\.1, ret\)/);
  assert.match(r.glsl, /mdMax\(0\.2, ret\)/);
  assert.match(r.glsl, /vec3 mdMin\(float a, vec3 b\)/);
  assert.ok(!/^float min\(|^vec3 min\(/m.test(r.glsl), 'yerleşik min yeniden bildirilmemeli');
});

test('translate: matris değişkeni tip çizelgesine giriyor', () => {
  /* `float2x2 rot` tipsiz kalırsa `mul(uv, rot)` de tipsiz oluyor ve ikili
     daraltma körleşiyor: ORB presetlerinde `mul(...) + GetBlur1(...)`
     ifadesi vec2 + vec3 olarak GLSL'e gidiyordu. */
  const r = T.translate(
    'shader_body { float2x2 rot = float2x2(1,0,0,1); ret.xy = mul(uv, rot) + GetBlur1(uv); }');
  // Daraltma vec3 tarafını ikiye indirmeli
  assert.match(r.glsl, /GetBlur1\(uv\)\)\.xy|GetBlur1\(uv\)\.xy/,
    'vec3 taraf .xy ile daraltılmalı:\n' + r.glsl.split('\n').filter((l) => /GetBlur1/.test(l)).join('\n'));
});

test('translate: kare olmayan matris devrik olarak eşleniyor', () => {
  /* HLSL floatRxC "satır x sütun", GLSL matCxR "sütun x satır". float2x3
     (2 satır, 3 sütun) şekil olarak mat3x2'ye denk. Adı devirmeden eşlemek
     DERLENEN ama yanlış çizen bir shader verirdi — hiç derlenmemesinden
     kötü, çünkü hata görünmez olurdu. */
  const r = T.translate(
    'shader_body { float3 a=float3(1,0,0); float3 b=float3(0,1,0);' +
    ' float2x3 ts = float2x3(a,b); ret.xy = mul(ts, float3(1,2,3)); }');
  assert.match(r.glsl, /mat3x2 hmat2x3\(vec3 r0, vec3 r1\)/);
  assert.match(r.glsl, /vec2 mul\(mat3x2 m, vec3 v\)/);
  assert.match(r.glsl, /hmat2x3\(a, ?b\)/, 'kurucu yönlendirilmeli');
});

test('translate: sayısal koşul karşılaştırmaya çevriliyor', () => {
  /* HLSL `if (x)` sayı kabul ediyor (sıfır değilse doğru), GLSL yalnız bool.
     Zaten bool olan koşula DOKUNULMAMALI, yoksa yeni hata üretir. */
  const r = T.translate('shader_body { float m = 1.0; if (m) { ret = vec3(1.0); } }');
  assert.match(r.glsl, /if \(\(m\) != 0\.0\)/);
  const b = T.translate('shader_body { float m = 1.0; if (m > 0.5) { ret = vec3(1.0); } }');
  assert.match(b.glsl, /if \(m > 0\.5\)/);
  /* KOŞULUN KENDİSİNE bakılıyor. Önceden tüm shader metninde `!= 0.0`
     aranıyordu; mdAll/mdAny yardımcıları gövdelerinde bu karşılaştırmayı
     kullandığı için testi onlar düşürüyordu — sınanan davranış değil. */
  assert.ok(!/if \([^)]*!= 0\.0/.test(b.glsl), 'bool koşul sarılmamalı');
});

test('translate: aynı ad yeniden bildirilince gölgeleme konuma bağlı', () => {
  /* "fractal descent" dış kapsamda `float c;` bildirip gövdede ona atıyor,
     DAHA SONRA gövdede `float2 c` bildiriyor. Tek bir tip seçmek iki
     taraftan birini bozuyordu; bildirim görüldüğü andan itibaren geçerli. */
  const r = T.translate(
    'float c;\nshader_body { c = 0.5; float2 c = float2(1,2); ret.xy = c; }');
  const line = r.glsl.split('\n').find((l) => /c = toF|c = toV2|\bc = 0\.5/.test(l)) || '';
  assert.match(r.glsl, /c = toF\(0\.5\)/,
    'ilk atama float olarak sarılmalı:\n' + line);
});

/* --- Tam korpus ölçümünden çıkan hata sınıfları -------------------------
   Aşağıdakilerin hepsi 10.332 presetlik korpusta ÖLÇÜLMÜŞ başarısızlıklara
   karşılık geliyor; her testin başındaki sayı o sınıfın kaç stage'i
   düşürdüğü. Ölçüm scripts/milkdrop-compile-rate.js ile tekrarlanabilir. */

test('translate: preset fonksiyonunun çağrısında skaler yayılıyor (154 stage)', () => {
  /* HLSL çağrı yerinde de örtük dönüşüm yapıyor: parametre float2 iken
     0.5 yazmak geçerli. Korpustaki en büyük tek kova buydu. */
  const r = T.translate(
    'float2 f(float2 domain, float2 center) { return domain - center; }\n' +
    'shader_body { ret.xy = f(uv, 0.5); }');
  assert.match(r.glsl, /f\(toV2\(uv\), toV2\(0\.5\)\)/, 'argümanlar parametre tipine çevrilmeli');
});

test('translate: preset fonksiyonunun return değeri dönüş tipine çevriliyor', () => {
  const r = T.translate(
    'float2 g(float2 a) { return a.x; }\nshader_body { ret.xy = g(uv); }');
  assert.match(r.glsl, /return toV2\(a\.x\)/);
});

test('translate: fonksiyon TANIMINA dokunulmuyor', () => {
  /* Tanımın argümanları "tip ad" biçiminde; sarmak sözdizimini bozardı. */
  const r = T.translate(
    'float2 h(float2 a, float b) { return a * b; }\nshader_body { ret.xy = h(uv, 2.0); }');
  assert.match(r.glsl, /vec2 h\(vec2 a, float b\)/, 'tanım olduğu gibi kalmalı');
  assert.match(r.glsl, /h\(toV2\(uv\), toF\(2\.0\)\)/);
});

test('translate: yerleşik adlar md* karşılıklarına yönlendiriliyor', () => {
  /* GLSL yerleşik adları yeniden tanımlanamıyor; min/max'ı aşırı yüklemeye
     çalışmak derleme oranını bir kerede %0'a düşürmüştü. */
  const r = T.translate('shader_body { float d = dot(ret, 0.33); if (all(uv)) ret = vec3(d); }');
  assert.match(r.glsl, /mdDot\(/);
  assert.match(r.glsl, /mdAll\(/);
  assert.ok(!/[^d]\bdot\s*\(/.test(r.glsl.split('void main')[1] || ''), 'gövdede çıplak dot kalmamalı');
});

test('translate: mul(vektör, skaler) skaler çarpım olarak kalıyor (35 stage)', () => {
  /* Yalnız eşit genişlikli aşırı yüklemeler varken iç çarpıma düşüyor,
     sonuç float oluyor ve vec2 bekleyen yer "dimension mismatch" veriyordu. */
  const r = T.translate('shader_body { ret.xy = mul(uv - 0.5, 1.0) + 0.5; }');
  assert.match(r.glsl, /vec2 mul\(vec2 a, float b\)/);
});

test('translate: taban skaler üs vektör olan pow çevriliyor (52 stage)', () => {
  const r = T.translate('shader_body { ret = pow(lum(ret), float3(0.3, 1.0, 1.8)); }');
  assert.match(r.glsl, /vec3 mdPow\(float a, vec3 b\)/);
});

test('translate: lerp koşul karışım oranı kabul ediyor', () => {
  const r = T.translate('shader_body { ret.x = lerp(uv.x, 1.0, uv.x > 1.0); }');
  assert.match(r.glsl, /float lerp\(float a, float b, bool t\)/);
});

test('translate: bildirilmiş yerleşik ad yeniden adlandırılıyor (28 stage)', () => {
  /* `float2 mod = ...` sonrası `mod.x` "field selection requires structure"
     veriyordu; çağrı biçimi ise korunmalı. */
  const r = T.translate('float2 mod;\nshader_body { mod = uv; if (mod.x > 0.0) ret = vec3(1.0); }');
  assert.match(r.glsl, /mod_v/);
  assert.ok(!/\bmod\.x/.test(r.glsl), 'değişken kullanımı yeniden adlandırılmalı');
});

test('translate: ayrılmış sözcük "sample" değişken adı olabiliyor (17 stage)', () => {
  const r = T.translate('shader_body { float3 sample = tex2D(sampler_main, uv); ret = sample; }');
  assert.ok(!/\bsample\b(?!_v)/.test(r.glsl), 'ayrılmış sözcük kalmamalı');
});

test('translate: global çoklu bildirim ayrıştırılıyor (50 stage)', () => {
  /* Eskiden yalnız ilk ad bildiriliyor, kalanı prologue'a atama olarak
     düşüyordu — ikinci ad "undeclared identifier" oluyordu. */
  const r = T.translate('float quality = 3.0, depth = 7.0;\nshader_body { ret = vec3(quality + depth); }');
  assert.match(r.glsl, /float quality;/);
  assert.match(r.glsl, /float depth;/);
  /* İlk değerler main'in başına taşınıyor ve her biri KENDİ hedef tipine
     çevriliyor — virgüllü listede ikinci bildiricinin de sarılması, bu
     testin yazılmasına yol açan hatanın tam karşılığı. */
  assert.match(r.glsl, /quality = toF\(3\.0\);/);
  assert.match(r.glsl, /depth = toF\(7\.0\);/);
});

test('translate: global başlatıcı hoist edilirken geniş tipler de kapsanıyor', () => {
  /* mat3x2 listeye girmediği için global kapsamda sabit olmayan ilk değerle
     kalıyor ve GLSL bunu reddediyordu. */
  const r = T.translate('float2x3 tst = float2x3(1,2,3,4,5,6);\nshader_body { ret.xy = mul(tst, float3(1,2,3)); }');
  assert.match(r.glsl, /mat3x2 tst;/);
  assert.match(r.glsl, /tst = hmat2x3\(/);
});

test('translate: log10 tanımlanıyor', () => {
  const r = T.translate('shader_body { ret = log10(1.25 * ret); }');
  assert.match(r.glsl, /float log10\(float x\)/);
});

test('translate: gövde içi çoklu bildirimin HER bildiricisi sarılıyor (221 stage)', () => {
  /* `float3 ret = tex2D(...).x, other = 1.0;` HLSL'de geçerli: her bildirici
     kendi başına örtük dönüşümden geçiyor. Deyimin tamamına bakıp üst düzey
     virgül görünce dokunmamak, korpustaki en büyük ikinci kovaydı. */
  const r = T.translate('shader_body { float3 a = GetBlur1(uv).x, b = 1.0; ret = a + b; }');
  assert.match(r.glsl, /a = toV3\(/);
  assert.match(r.glsl, /b = toV3\(1\.0\)/);
});

test('translate: virgül işleçli atama dizisi de sarılıyor', () => {
  const r = T.translate('shader_body { float t; float u; t = uv, u = 2.0; ret = vec3(t+u); }');
  assert.match(r.glsl, /t = toF\(uv\)/);
  assert.match(r.glsl, /u = toF\(2\.0\)/);
});

test('translate: fonksiyon parametresi genel tip çizelgesini bozmuyor (45 stage)', () => {
  /* Parametreler süslü parantezlerin DIŞINDA duruyor, yani derinlik
     hesabında global bildirim gibi görünüyorlardı: `float2 f(float uv)`
     yazan bir preset `uv`nin tipini metnin tamamı için float yapıyor ve
     gövdedeki her uv ataması toF ile sarılıyordu. */
  const r = T.translate(
    'float2 f(float uv) { return float2(uv, uv); }\nshader_body { uv = uv * 0.5; ret = vec3(f(0.3), 0.0); }');
  assert.match(r.glsl, /uv = toV2\(/, 'uv yerleşik tipini (vec2) korumalı');
});

test('translate: if koşulunun İÇİ de daraltılıyor', () => {
  /* `!` sayı üzerinde HLSL'de sıfıra karşılaştırma; GLSL reddediyor.
     Daraltma yalnız atamalara uygulanıyordu, koşullara değil. */
  const r = T.translate('float first;\nshader_body { if (!first) { ret = vec3(1.0); } }');
  assert.ok(!/if \(!first\)/.test(r.glsl), 'çıplak ! kalmamalı: ' +
    (r.glsl.split('\n').find((l) => /first/.test(l) && /if/.test(l)) || ''));
});

test('translate: bool vektör tipleri SAYI vektörüne eşleniyor', () => {
  /* Eskiden `bvec3`e eşleniyordu. Tip adını geçerli kılıyordu ama presetin
     o değerle YAPTIĞI şeyi geçersiz bırakıyordu: gerçek koddan
     `tile1 = hex(domain) + hex(domain + .5);` — GLSL'de bool'un toplamı yok.
     HLSL bool'u aritmetikte serbestçe sayıya çeviriyor ve presetler bool'u
     bir tip olarak değil "0 ya da 1 tutan sayı" olarak kullanıyor.

     Ölçüldü: korpusta 46 aşama yalnız bu yüzden derlenmiyordu, yani en
     büyük tek kova. Kurucu bool argümanını kendisi çeviriyor, o yüzden
     `vec3(d.x>0.0, ...)` geçerli GLSL. */
  const r = T.translate('bool3 hexgrid(float2 d) { return bool3(d.x>0.0, d.y>0.0, true); }\n' +
    'shader_body { ret = vec3(1.0); }');
  assert.match(r.glsl, /vec3 hexgrid/);
  assert.doesNotMatch(r.glsl, /bvec3 hexgrid/);
});

test('translate: bool DEĞİŞKENİ aritmetikte kullanılabiliyor', () => {
  /* Gerçek koddan (propre hypno): `bool mask = cone>0;` ardından
     `!mask*domain + mask*refrac_uv`. Üç ayrı şey gerekiyor ve üçü de
     olmalı: bildirimin sayıya dönmesi, `!`in karşılaştırmaya dönmesi,
     çarpımın geçerli kalması. */
  const r = T.translate('shader_body { bool mask = rad>0.5; ret = vec3(!mask*0.5 + mask*uv.x); }');
  assert.match(r.glsl, /float mask/);
  assert.doesNotMatch(r.glsl, /bool mask/);
  assert.match(r.glsl, /mask == 0\.0/, '`!mask` karşılaştırmaya dönmeli');
});

test('translate: süslü parantezli vektör ilk değeri kurucuya çevriliyor', () => {
  const r = T.translate('shader_body { float2 center = { 0.41, 0.5}; ret.xy = center; }');
  // Atama sarmalayıcısı ayrıca toV2 ekliyor; aranan, süslü parantezin gitmesi.
  assert.match(r.glsl, /vec2 center = toV2\(vec2\( ?0\.41, ?0\.5\)\)/);
});

test('translate: kullanılan dönme matrisleri bildiriliyor, kullanılmayanlar değil', () => {
  /* Yirmi dördünü birden bildirmek 96 vec3 uniform demek; WebGL2'nin alt
     sınırı 224 vektör ve düşük seviyeli bir GPU'da hiçbir preset
     derlenmezdi. Bu yüzden yalnız geçenler bildiriliyor. */
  const r = T.translate('shader_body { ret = vec3(rot_d1[1].x, rot_s2[0].y, 0.0); }');
  assert.deepStrictEqual(r.rotUniforms, ['rot_d1', 'rot_s2']);
  assert.match(r.glsl, /uniform vec3 rot_d1\[4\];/);
  assert.ok(!/rot_f1/.test(r.glsl), 'kullanılmayan matris bildirilmemeli');
  assert.ok(r.soft.some((x) => /dönme matrisi yaklaşık/.test(x)),
    'yaklaşıklık soft notunda görünmeli');
});

test('translate: bool döndüren preset fonksiyonu sayı dönüşüne izin veriyor', () => {
  /* `bool` artık `float`a eşlendiği için dönüş de sayı. Sınanan şey
     mekanizma değil DAVRANIŞ: iki karşılaştırmanın ÇARPIMI geçerli kalmalı
     (GLSL'de bool*bool yok) ve sonuç `if` koşulunda kullanılabilmeli
     (GLSL'de sayı koşul olamaz). */
  const r = T.translate('bool inside(float x) { return (x>1.0)*(x<7.0); }\n' +
    'shader_body { if (inside(uv.x)) ret = vec3(1.0); }');
  assert.match(r.glsl, /float inside\(/);
  assert.match(r.glsl, /float\(\(x>1\.0\)\) ?\* ?float\(\(x<7\.0\)\)/,
    'karşılaştırmalar çarpım için sayıya çevrilmeli');
  // Argüman ayrıca `toF` ile sarılıyor; aranan, koşulun karşılaştırmaya dönmesi.
  assert.match(r.glsl, /if \(\(inside\([\s\S]*?\)\) != 0\.0\)/,
    'sayı dönüş koşulda karşılaştırmaya dönmeli');
});
