'use strict';
/* MilkDrop piksel shader'larını (HLSL) WebGL2'nin GLSL ES 3.00'ına çevirir.

   NEDEN BU DOSYA VAR:
   `.milk` presetlerinin %82'si bir `warp` ya da `comp` shader'ı taşıyor.
   Bunlar çalıştırılmadığında preset açılıyor, denklemleri koşuyor, ama
   ekrandaki RENK ve DOKU presetin istediği şey olmuyor — kullanıcı için
   "çalışmıyor" demek bu. #559'da düzeltilen şey presetin yüklenmesiydi;
   burada düzeltilen şey neye benzediği.

   NEDEN AYRIŞTIRICI DEĞİL, METİN DÖNÜŞÜMÜ:
   MilkDrop shader gövdeleri HLSL'in dar bir alt kümesi: değişken bildirimi,
   aritmetik, birkaç yerleşik çağrı, nadiren bir döngü. Tam bir HLSL
   ayrıştırıcısı bu iş için hem gereksiz hem de kendi hata yüzeyini getirir.

   NEDEN SAF (GL BAĞLAMI YOK):
   Böylece 10.000 presetin tamamı Node içinde, ekran kartı olmadan
   ölçülebiliyor. Ama çevrilmek DERLENMEK demek değil; onu GL bağlamı olan
   taraf ölçüyor ve asıl kapı orası.

   İKİ AYRI "DESTEKLENMİYOR" LİSTESİ — neden:
     hard  shader hiç koşamaz (#include: elimizde olmayan bir dosya).
     soft  shader koşar ama bir ayrıntı yaklaşık (eksik doku, gürültü deseni).
   Tek listede toplamak ikisinden birini yalan söyletirdi: eksik doku yüzünden
   shader'ı hiç koşturmamak, presetin blur zincirini ve q ile sürülen bütün
   renk matematiğini de çöpe atmak demek — o görüntü, yaklaşık dokulu
   görüntüden DAHA uzak olurdu. */
(function () {
  // ---------------------------------------------------------------- yardımcı

  /* Yorumları söker. Neden çıktıdan da siliyoruz: aşağıdaki dönüşümler satır
     içi metin değiştiriyor; yorumda kalan bir float3 ya da yarım bir ifade
     GLSL derleyicisine giden metni bozabiliyor. Shader'ın kaynağı zaten
     preset dosyasında duruyor, kaybolan bilgi yok. */
  function stripComments(src) {
    let out = '';
    for (let i = 0; i < src.length; i++) {
      if (src[i] === '/' && src[i + 1] === '/') {
        while (i < src.length && src[i] !== '\n') i++;
        out += '\n';
      } else if (src[i] === '/' && src[i + 1] === '*') {
        i += 2;
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
        i++;
        out += ' ';
      } else out += src[i];
    }
    return out;
  }

  /* Metni ikiye ayırır: `shader_body`den ÖNCEKİ küresel kod ve gövde.

     Küresel kısım boş bir ayrıntı değil: presetlerin %5,4'ü orada kendi
     yardımcı fonksiyonunu tanımlıyor (`float3 cloud(float2 uv_in) { ... }`).
     Yalnızca gövdeyi alsaydık o fonksiyonlar düşer, gövdedeki çağrıları
     derlenmez ve 457 preset sessizce siyah kalırdı. */
  function split(src) {
    const m = /shader_body\s*\{/.exec(src);
    if (!m) return { globals: '', body: src.trim() };
    const globals = src.slice(0, m.index).trim();
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
    }
    return { globals, body: src.slice(start, depth === 0 ? i - 1 : src.length).trim() };
  }

  // Eski ad; yalnızca gövdeyi isteyen çağıranlar için duruyor.
  function bodyOf(src) { return split(src).body; }

  /* HLSL sayı yazımını GLSL'e uydurur: 5 -> 5.0

     NEDEN ŞART: HLSL sayıyı bağlama göre okur, GLSL ES okumaz. Gerçek bir
     presetten: `ret *= 5;` — GLSL'de vec3 ile int çarpılamaz, shader hiç
     derlenmez. Tek bir eksik nokta o preseti tümden siyah bırakır.

     ÜÇ İSTİSNA, üçü de gerçek koddan:
       tanımlayıcı içi   float3, q1, sampler_blur1, .xyz  — dokunulmaz
       üs                1e-9 -> 1e-9.0 geçersiz olurdu   — dokunulmaz
       köşeli parantez   h[0] -> h[0.0] geçersiz olurdu   — dokunulmaz
     Son ikisi ilk yazımda gözden kaçtı; ikisi de derleme hatası verir, yani
     o presetler tümden siyah kalırdı. */
  function floatify(src) {
    /* Önişlemci satırlarına dokunulmaz. `#if 1` -> `#if 1.0` yapmak GLSL
       önişlemcisini kırıyor: orada yalnızca TAM SAYI kabul ediliyor. Bu,
       derleme kapısının yakaladığı kendi hatamdı — sekiz preset yalnızca
       bu yüzden derlenmiyordu. */
    if (src.indexOf('#') >= 0) {
      return src.split('\n').map(function (l) {
        return /^\s*#/.test(l) ? l : floatifyLine(l);
      }).join('\n');
    }
    return floatifyLine(src);
  }

  function floatifyLine(src) {
    const ID = /[A-Za-z0-9_.]/;
    let out = '';
    let bracket = 0;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '[') bracket++;
      else if (c === ']') bracket = Math.max(0, bracket - 1);
      if (c < '0' || c > '9') { out += c; continue; }
      let j = i;
      while (j < src.length && src[j] >= '0' && src[j] <= '9') j++;
      const digits = src.slice(i, j);
      const before = i > 0 ? src[i - 1] : '';
      const after = j < src.length ? src[j] : '';
      // üs kuyruğu mu: 1e9 / 1e-9 / 2.5E+3
      let isExp = false;
      if (before === 'e' || before === 'E') {
        const p = i > 1 ? src[i - 2] : '';
        isExp = /[0-9.]/.test(p);
      } else if (before === '-' || before === '+') {
        const p = i > 1 ? src[i - 2] : '';
        const q = i > 2 ? src[i - 3] : '';
        isExp = (p === 'e' || p === 'E') && /[0-9.]/.test(q);
      }
      if (bracket > 0 || isExp || (before && ID.test(before)) || (after && ID.test(after))) {
        out += digits;
      } else {
        out += digits + '.0';
      }
      i = j - 1;
    }
    return out;
  }

  // ------------------------------------------------------------ sampler'lar

  /* MilkDrop aynı dokuyu farklı süzme/sarma ayarlarıyla ayrı adlarla sunuyor:
     sampler_fw_main (filtered+wrap), sampler_pc_main (point+clamp) gibi.
     Doku aynı doku; bu yüzden ön ek soyulup tek kaynağa bağlanıyor.
     Presetlerin %30'u bu türevleri kullanıyor. */
  const SAMPLER_PREFIX = /^sampler_(fw|pw|fc|pc)_/;
  const KNOWN_SAMPLERS = [
    'sampler_main', 'sampler_blur1', 'sampler_blur2', 'sampler_blur3',
    'sampler_noise_lq', 'sampler_noise_lq_lite', 'sampler_noise_mq',
    'sampler_noise_hq', 'sampler_noisevol_lq', 'sampler_noisevol_hq',
  ];

  function canonSampler(name) {
    return name.replace(SAMPLER_PREFIX, 'sampler_');
  }

  // --------------------------------------------------------------- önsöz

  /* Tip karşılıkları. Sıra önemli: float3x3 float3'ten ÖNCE eşleşmeli,
     yoksa mat3'ün yerine vec3x3 gibi bir şey çıkar. */
  const TYPES = [
    ['float4x4', 'mat4'], ['float3x3', 'mat3'], ['float2x2', 'mat2'],
    ['half4x4', 'mat4'], ['half3x3', 'mat3'], ['half2x2', 'mat2'],
    ['float4', 'vec4'], ['float3', 'vec3'], ['float2', 'vec2'], ['float1', 'float'],
    ['half4', 'vec4'], ['half3', 'vec3'], ['half2', 'vec2'], ['half1', 'float'],
    ['half', 'float'],
    /* HLSL'in tam sayı vektörleri. Sayılar zaten float'a çekildiği için
       karşılıkları da float vektör; `int2 k = ...` yazan 18 preset yalnızca
       bu bildirim yüzünden derlenmiyordu. */
    ['double4', 'vec4'], ['double3', 'vec3'], ['double2', 'vec2'], ['double', 'float'],
    ['int4', 'vec4'], ['int3', 'vec3'], ['int2', 'vec2'],
    ['uint4', 'vec4'], ['uint3', 'vec3'], ['uint2', 'vec2'], ['uint', 'float'],
    /* int -> float: HLSL sayıları serbestçe karıştırır, GLSL ES karıştırmaz.
       floatify her sayıyı ondalıklı yaptığı için `int i = 0.0` derlenmezdi.
       Her şeyi float'a çekmek ikisini tutarlı kılıyor; `for (float i = 0.0;
       i < 4.0; i++)` geçerli GLSL. Köşeli parantez içi floatify'da zaten
       muaf, yani `h[0]` bozulmuyor. */
    ['int', 'float'],
  ];

  const Q_COUNT = 32;
  const Q_PACKS = ['_qa', '_qb', '_qc', '_qd', '_qe', '_qf', '_qg', '_qh'];
  const Q_COMP = ['x', 'y', 'z', 'w'];

  /* MilkDrop'un shader'a verdiği değişkenler. Kullanılmayan uniform'u GLSL
     derleyicisi zaten atıyor, bu yüzden hangisinin kullanıldığını aramak
     yerine hepsi bildiriliyor — arama, kaçırma riski demek olurdu. */
  const PREAMBLE = [
    '#version 300 es',
    'precision highp float;',
    '',
    'out vec4 outColor;',
    '',
    'uniform sampler2D sampler_main;',
    'uniform sampler2D sampler_blur1;',
    'uniform sampler2D sampler_blur2;',
    'uniform sampler2D sampler_blur3;',
    'uniform sampler2D sampler_noise_lq;',
    'uniform sampler2D sampler_noise_lq_lite;',
    'uniform sampler2D sampler_noise_mq;',
    'uniform sampler2D sampler_noise_hq;',
    'uniform sampler2D sampler_noisevol_lq;',
    'uniform sampler2D sampler_noisevol_hq;',
    '',
    'uniform vec4 texsize;',
    'uniform vec4 aspect;',
    'uniform vec4 texsize_noise_lq;',
    'uniform vec4 texsize_noise_mq;',
    'uniform vec4 texsize_noise_hq;',
    'uniform vec4 texsize_noise_lq_lite;',
    // %23,8'i hacim gürültüsünün boyutunu okuyor; bildirilmezse derlenmiyor
    'uniform vec4 texsize_noisevol_lq;',
    'uniform vec4 texsize_noisevol_hq;',
    'uniform float time;',
    'uniform float fps;',
    'uniform float frame;',
    'uniform float progress;',
    'uniform float bass, mid, treb, vol;',
    'uniform float bass_att, mid_att, treb_att, vol_att;',
    'uniform vec4 rand_frame;',
    'uniform vec3 rand_preset;',
    'uniform vec4 roam_cos, roam_sin, slow_roam_cos, slow_roam_sin;',
    // MilkDrop'un shader'a verdiği hazır renk tonu vektörü
    'uniform vec3 hue_shader;',
    'uniform vec3 blur1_min, blur1_max, blur2_min, blur2_max, blur3_min, blur3_max;',
    // q1..q32 MilkDrop'ta sekiz vec4 içinde taşınıyor; aynı paketleme korunuyor.
    'uniform vec4 _qa, _qb, _qc, _qd, _qe, _qf, _qg, _qh;',
    '',
    /* MilkDrop'un matematik sabitleri; presetlerin %5,6'sı kullanıyor.
       TUZAK: MilkDrop'ta M_PI_2, pi/2 DEĞİL 2*pi. C'nin M_PI_2'siyle
       karıştırıp yarısını yazmak açıyı ikiye böler — derleyici bir şey
       demez, yalnızca desen yanlış döner. */
    '#define M_PI 3.14159265359',
    '#define M_PI_2 6.28318530718',
    '#define M_INV_PI_2 0.159154943092',
    '#define M_INV_PI 0.318309886184',
    '',
  ];

  /* q1..q32 ve uv/rad/ang/ret KÜRESEL değişken olarak bildiriliyor, #define
     olarak değil. İki ayrı nedenle:

     1) Presetlerin %4,8'i shader içinde `q25 = ...` diye YAZIYOR. #define
        olsaydı bu `_qe.x = ...` olurdu — uniform'a atama, derleme hatası.
     2) Presetlerin %5,4'ü kendi fonksiyonunu tanımlıyor ve o fonksiyonlar
        q'ları, bazen uv'yi görebilmeli. main içindeki yerel değişkeni
        göremezlerdi.

     Küresel bir değişkene uniform ile ilk değer verilemez (GLSL ES küresel
     ilk değerin sabit ifade olmasını ister), bu yüzden bildirim burada,
     atama main'in başında. */
  function globalDecls() {
    const q = [];
    for (let i = 0; i < Q_COUNT; i++) q.push('q' + (i + 1));
    return [
      'float ' + q.join(', ') + ';',
      'vec2 uv, uv_orig;',
      'float rad, ang;',
      'vec3 ret;',
      '',
    ];
  }

  function qAssigns() {
    const out = [];
    for (let i = 0; i < Q_COUNT; i++) {
      out.push('  q' + (i + 1) + ' = ' + Q_PACKS[i >> 2] + '.' + Q_COMP[i & 3] + ';');
    }
    return out;
  }

  /* HLSL yerleşiklerinin GLSL karşılıkları.

     NEDEN YENİDEN ADLANDIRMA DEĞİL DE AŞIRI YÜKLEME: `lerp(a,b,t)`yi metinde
     `mix(a,b,t)`e çevirmek iç içe çağrılarda parantez saymayı gerektirir ve
     orada hata yapmak kolay. Aynı adı taşıyan bir GLSL fonksiyonu tanımlamak
     bu işi derleyiciye bırakıyor: çağrı yeri hiç değişmiyor.

     `pow` bunun istisnası. GLSL'de zaten var ve yerleşik bir adı yeniden
     bildirmek bazı sürücülerde yerleşiğin TÜM biçimlerini gizliyor; o zaman
     `pow(vec3,vec3)` de kaybolurdu. Bu yüzden `pow` çağrıları `mdPow`a
     yeniden adlandırılıyor. Negatif tabanda pow tanımsız olduğu için mutlak
     değer alınıyor: burada üretilen şey renk, NaN bir kareyi siyah bırakır. */
  const HELPERS = [
    'float saturate(float x){ return clamp(x, 0.0, 1.0); }',
    'vec2 saturate(vec2 x){ return clamp(x, 0.0, 1.0); }',
    'vec3 saturate(vec3 x){ return clamp(x, 0.0, 1.0); }',
    'vec4 saturate(vec4 x){ return clamp(x, 0.0, 1.0); }',
    'float frac(float x){ return fract(x); }',
    'vec2 frac(vec2 x){ return fract(x); }',
    'vec3 frac(vec3 x){ return fract(x); }',
    'vec4 frac(vec4 x){ return fract(x); }',
    'float lerp(float a, float b, float t){ return mix(a, b, t); }',
    'vec2 lerp(vec2 a, vec2 b, float t){ return mix(a, b, t); }',
    'vec3 lerp(vec3 a, vec3 b, float t){ return mix(a, b, t); }',
    'vec4 lerp(vec4 a, vec4 b, float t){ return mix(a, b, t); }',
    'vec2 lerp(vec2 a, vec2 b, vec2 t){ return mix(a, b, t); }',
    'vec3 lerp(vec3 a, vec3 b, vec3 t){ return mix(a, b, t); }',
    'vec4 lerp(vec4 a, vec4 b, vec4 t){ return mix(a, b, t); }',
    // HLSL skaleri yayar: lerp(saturate(ret), 0.0, k) gerçek kodda var
    'vec2 lerp(vec2 a, float b, float t){ return mix(a, vec2(b), t); }',
    'vec3 lerp(vec3 a, float b, float t){ return mix(a, vec3(b), t); }',
    'vec4 lerp(vec4 a, float b, float t){ return mix(a, vec4(b), t); }',
    'vec2 lerp(float a, vec2 b, float t){ return mix(vec2(a), b, t); }',
    'vec3 lerp(float a, vec3 b, float t){ return mix(vec3(a), b, t); }',
    'vec4 lerp(float a, vec4 b, float t){ return mix(vec4(a), b, t); }',
    'float mdPow(float a, float b){ return pow(abs(a) + 1e-9, b); }',
    'vec2 mdPow(vec2 a, vec2 b){ return pow(abs(a) + 1e-9, b); }',
    'vec3 mdPow(vec3 a, vec3 b){ return pow(abs(a) + 1e-9, b); }',
    'vec4 mdPow(vec4 a, vec4 b){ return pow(abs(a) + 1e-9, b); }',
    'vec2 mdPow(vec2 a, float b){ return pow(abs(a) + 1e-9, vec2(b)); }',
    'vec3 mdPow(vec3 a, float b){ return pow(abs(a) + 1e-9, vec3(b)); }',
    'vec4 mdPow(vec4 a, float b){ return pow(abs(a) + 1e-9, vec4(b)); }',
    'float atan2(float y, float x){ return atan(y, x); }',
    'float rsqrt(float x){ return inversesqrt(max(x, 1e-9)); }',
    'float fmod(float a, float b){ return mod(a, b); }',
    'vec2 fmod(vec2 a, vec2 b){ return mod(a, b); }',
    'vec3 fmod(vec3 a, vec3 b){ return mod(a, b); }',
    'float ddx(float x){ return dFdx(x); }',
    'float ddy(float x){ return dFdy(x); }',
    /* tex2D vec4 DEĞİL vec3 döndürüyor. HLSL float4 döndürür ve float3'e
       atarken sessizce kırpar; GLSL kırpmaz, "dimension mismatch" der ve
       shader hiç derlenmez. İlk yazımda vec4'tü ve derleme kapısında en
       büyük hata kovası buydu.

       Seçim tahminle değil sayımla yapıldı: `ret = tex2D(...)` yazan 3339,
       `float3 x = tex2D(...)` yazan 3423 preset var; `float4 x = tex2D(...)`
       yazan yalnızca 488, ve sonucun `.w`/`.a` bileşenini okuyan HİÇ preset
       yok. Yani alfa hiç kullanılmıyor, kaybedilen bir bilgi de yok.
       Kalan 488 durum aşağıda vec4 sarmalayıcısıyla onarılıyor. */
    'vec3 tex2D(sampler2D s, vec2 uv2){ return texture(s, uv2).xyz; }',
    // HLSL skaleri vektöre yayar: tex2D(s, uv.x*1.5) gerçek kodda var
    'vec3 tex2D(sampler2D s, float u){ return texture(s, vec2(u, u)).xyz; }',
    'vec3 tex2D(sampler2D s, vec3 uv2){ return texture(s, uv2.xy).xyz; }',
    'vec3 tex2Dlod(sampler2D s, vec4 uv2){ return textureLod(s, uv2.xy, uv2.w).xyz; }',
    'vec3 tex2Dbias(sampler2D s, vec4 uv2){ return texture(s, uv2.xy, uv2.w).xyz; }',
    'vec3 tex3D(sampler2D s, vec3 uv2){ return texture(s, uv2.xy).xyz; }',
    /* lum: MilkDrop'un parlaklık yardımcısı, presetlerin %40,8'i çağırıyor.
       Ağırlıklar MilkDrop'un kendi değerleri. */
    'float lum(vec3 v){ return dot(v, vec3(0.32, 0.49, 0.29)); }',
    'float lum(vec4 v){ return dot(v.xyz, vec3(0.32, 0.49, 0.29)); }',
    'float lum(float v){ return v; }',
    'vec3 mul(mat3 m, vec3 v){ return m * v; }',
    'vec3 mul(vec3 v, mat3 m){ return v * m; }',
    'vec2 mul(mat2 m, vec2 v){ return m * v; }',
    'vec2 mul(vec2 v, mat2 m){ return v * m; }',
    'vec4 mul(mat4 m, vec4 v){ return m * v; }',
    'vec4 mul(vec4 v, mat4 m){ return v * m; }',
    'float mul(float a, float b){ return a * b; }',
    'float mul(vec2 a, vec2 b){ return dot(a, b); }',
    'float mul(vec3 a, vec3 b){ return dot(a, b); }',
    'float mul(vec4 a, vec4 b){ return dot(a, b); }',
    /* HLSL matris kurucusu SATIR sırasıyla doldurur, GLSL SÜTUN sırasıyla.
       Aynı sayıları aynı sırayla vermek matrisi devrik yapardı: bir dönme
       matrisi ters yöne döner ve bunu yalnız ekrana bakınca görürsünüz —
       derleyici tek kelime etmez. Presetlerin %8,4'ü matris kuruyor, bu
       yüzden kurucular ayrı bir işlevden geçiyor. */
    'mat2 hmat2(float a, float b, float c, float d){ return mat2(a, c, b, d); }',
    'mat2 hmat2(vec2 r0, vec2 r1){ return mat2(r0.x, r1.x, r0.y, r1.y); }',
    'mat2 hmat2(vec4 v){ return mat2(v.x, v.z, v.y, v.w); }',
    'mat3 hmat3(float a, float b, float c, float d, float e, float f, float g, float h, float i){ return mat3(a, d, g, b, e, h, c, f, i); }',
    'mat3 hmat3(vec3 r0, vec3 r1, vec3 r2){ return mat3(r0.x, r1.x, r2.x, r0.y, r1.y, r2.y, r0.z, r1.z, r2.z); }',
    'mat4 hmat4(vec4 r0, vec4 r1, vec4 r2, vec4 r3){ return mat4(r0.x, r1.x, r2.x, r3.x, r0.y, r1.y, r2.y, r3.y, r0.z, r1.z, r2.z, r3.z, r0.w, r1.w, r2.w, r3.w); }',
    /* GetBlur*: MilkDrop'ta fonksiyon gibi yazılır ama aslında ayrı ayrı
       bulanıklaştırılmış kopyalardır — presetlerin %85,5'i istiyor. Gerçekten
       üç ek doku gerekiyor; onları üretmek çizim tarafının işi, burada
       yalnızca okunuyorlar. Ölçek/kaydırma blurN_min/max ile geri açılıyor. */
    'vec3 GetBlur1(vec2 u){ return texture(sampler_blur1, u).xyz * blur1_max + blur1_min; }',
    'vec3 GetBlur2(vec2 u){ return texture(sampler_blur2, u).xyz * blur2_max + blur2_min; }',
    'vec3 GetBlur3(vec2 u){ return texture(sampler_blur3, u).xyz * blur3_max + blur3_min; }',
    'vec3 GetBlur0(vec2 u){ return texture(sampler_main, u).xyz; }',
    'vec3 GetPixel(vec2 u){ return texture(sampler_main, u).xyz; }',
    /* HLSL atamada sessizce KIRPAR ve YAYAR: `float3 c = tex2D(...)` float4'ü
       üçe indirir, `float2 v = 0` sıfırı ikiye yayar. GLSL ikisini de
       yapmaz ve shader hiç derlenmez — derleme kapısındaki en büyük iki
       hata kovası buydu.

       Her durumu metinden tip çıkararak onarmak küçük bir HLSL derleyicisi
       yazmak demekti. Gerek yok: bir atamanın SOL tarafının tipi zaten
       bildirimden BİLİNİYOR. Sağ tarafın tipini bilmek gerekmiyor, çünkü
       aşağıdaki aşırı yüklemeler onu derleyiciye çözdürüyor. Yani tip
       çıkarımı bize değil GLSL'e ait. */
    'float toF(float x){ return x; }',
    'float toF(vec2 v){ return v.x; }',
    'float toF(vec3 v){ return v.x; }',
    'float toF(vec4 v){ return v.x; }',
    'vec2 toV2(float x){ return vec2(x); }',
    'vec2 toV2(vec2 v){ return v; }',
    'vec2 toV2(vec3 v){ return v.xy; }',
    'vec2 toV2(vec4 v){ return v.xy; }',
    'vec3 toV3(float x){ return vec3(x); }',
    'vec3 toV3(vec2 v){ return vec3(v, 0.0); }',
    'vec3 toV3(vec3 v){ return v; }',
    'vec3 toV3(vec4 v){ return v.xyz; }',
    'vec4 toV4(float x){ return vec4(x); }',
    'vec4 toV4(vec2 v){ return vec4(v, 0.0, 0.0); }',
    'vec4 toV4(vec3 v){ return vec4(v, 1.0); }',
    'vec4 toV4(vec4 v){ return v; }',
  ];

  // MilkDrop'un shader'a verdiği ve presetin yazabildiği değişkenlerin tipleri
  const BUILTIN_TYPES = (function () {
    const m = new Map([
      ['ret', 'vec3'], ['uv', 'vec2'], ['uv_orig', 'vec2'],
      ['rad', 'float'], ['ang', 'float'],
    ]);
    for (let i = 1; i <= Q_COUNT; i++) m.set('q' + i, 'float');
    return m;
  })();

  const CAST = { float: 'toF', vec2: 'toV2', vec3: 'toV3', vec4: 'toV4' };

  /* Her atamanın sağ tarafını sol tarafın tipine çeviren sarmalayıcıya alır.

     Deyimlere ayırırken parantez derinliği izleniyor: `for (i=0; i<n; i++)`
     içindeki noktalı virgüller deyim sonu DEĞİL, ve oradaki `i=0`
     sarmalanmamalı. Süslü parantezler de sınır sayılıyor. */
  function coerce(s, types) {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i <= s.length; i++) {
      const c = s[i];
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      const boundary = i === s.length || (depth === 0 && (c === ';' || c === '{' || c === '}'));
      if (!boundary) continue;
      out.push(fixStatement(s.slice(start, i), types) + (i < s.length ? c : ''));
      start = i + 1;
    }
    return out.join('');
  }

  function fixStatement(st, types) {
    if (!st.trim() || /(^|\n)\s*#/.test(st)) return st;
    /* `const float k = 0.0;` sarmalanmamalı: GLSL const'un ilk değerinin
       SABİT ifade olmasını istiyor, `toF(...)` ise bir fonksiyon çağrısı. */
    if (/^\s*const\b/.test(st)) return st;
    // üst düzey atama işlecini bul
    let d = 0;
    for (let i = 0; i < st.length; i++) {
      const c = st[i];
      if (c === '(' || c === '[') { d++; continue; }
      if (c === ')' || c === ']') { d--; continue; }
      if (c !== '=' || d !== 0) continue;
      if (st[i + 1] === '=') return st;                       // ==
      const p = st[i - 1];
      if (p === '=' || p === '!' || p === '<' || p === '>') return st;
      const compound = (p === '+' || p === '-' || p === '*' || p === '/');
      const lhsEnd = compound ? i - 1 : i;
      const lhs = st.slice(0, lhsEnd).trim();
      const rhs = st.slice(i + 1);
      if (!rhs.trim()) return st;
      const t = targetType(lhs, types);
      if (!t || !CAST[t]) return st;
      return st.slice(0, i + 1) + ' ' + CAST[t] + '(' + rhs.trim() + ')';
    }
    return st;
  }

  /* Sol tarafın tipi. Bildirimse tip zaten yazıyor; değilse çizelgeden
     bakılıyor. Swizzle uzunluğu tipi daraltıyor: `ret.yz` vec2, `z.x` float
     — bu ayrım olmadan `z.x += vec3` durumu onarılamazdı.

     Sol taraf SONDAN okunuyor, baştan değil: `if (a==b) ret = 0.0;` gibi
     süslü parantezsiz gövdelerde deyimin başında koşul duruyor ve baştan
     eşleştiren bir kalıp bunları hiç yakalamıyordu. */
  function targetType(lhs, types) {
    const m = /((?:float|vec2|vec3|vec4)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\.\s*([xyzwrgba]{1,4}))?\s*$/
      .exec(lhs);
    if (!m) return null;
    const base = m[1] ? m[1].trim() : types.get(m[2]);
    if (!base) return null;
    if (!m[3]) return base;
    return ['float', 'vec2', 'vec3', 'vec4'][m[3].length - 1];
  }

  // --------------------------------------------------------------- çeviri

  /* `a % b` -> `mod(a, b)`.

     GLSL ES'te % yalnızca tam sayılarda var, burada her şey float. HLSL'de
     ise float artığı olağan; presetlerin %6,6'sı kullanıyor (`if(frame%2==0)`
     gibi). Düz bir regex işleci bulur ama OPERANDLARI bulamaz: soldaki
     `tex2D(a,b).x` de olabilir `(x+y)` de. Bu yüzden küçük bir tarayıcı
     parantez dengeleyerek iki yana yürüyor. */
  function modFix(s) {
    const ID = /[A-Za-z0-9_.]/;
    for (let guard = 0; guard < 500; guard++) {
      const i = s.indexOf('%');
      if (i < 0) break;
      /* Sol operandın başı. Tek geçiş yetmiyor: `tex2D(s,uv).x` üç parçadan
         oluşuyor (ad, parantez, bileşen) ve ilk yazımda tarama parantezde
         durup ortadan bölmüştü — `tex2D(s,uv)mod(.x, ...)` gibi bir şey
         çıkıyordu. Bu yüzden parantez/ad adımları TÜKENENE KADAR dönüyor.
         Ayrıca % ile * ve / aynı öncelikte ve soldan birleşir; `b*c%d`
         (b*c)%d demek, b*mod(c,d) değil — bu yüzden çarpma zinciri de
         sola doğru toplanıyor. */
      let a = i - 1;
      for (;;) {
        while (a >= 0 && /\s/.test(s[a])) a--;
        if (a >= 0 && (s[a] === ')' || s[a] === ']')) {
          const close = s[a], open = close === ')' ? '(' : '[';
          let d = 0;
          while (a >= 0) {
            if (s[a] === close) d++;
            else if (s[a] === open) { d--; if (d === 0) break; }
            a--;
          }
          a--;
          continue;
        }
        if (a >= 0 && ID.test(s[a])) { while (a >= 0 && ID.test(s[a])) a--; continue; }
        // çarpma/bölme zinciri: bir operand daha soldan alınır
        let k = a;
        while (k >= 0 && /\s/.test(s[k])) k--;
        if (k >= 0 && (s[k] === '*' || s[k] === '/')) { a = k - 1; continue; }
        break;
      }
      const left = s.slice(a + 1, i).trim();
      // sağ operandın sonu
      let b = i + 1;
      while (b < s.length && /\s/.test(s[b])) b++;
      if (s[b] === '-' || s[b] === '+') b++;
      if (s[b] === '(') {
        let d = 0;
        while (b < s.length) {
          if (s[b] === '(') d++;
          else if (s[b] === ')') { d--; if (d === 0) { b++; break; } }
          b++;
        }
      } else {
        while (b < s.length && ID.test(s[b])) b++;
        if (s[b] === '(') {
          let d = 0;
          while (b < s.length) {
            if (s[b] === '(') d++;
            else if (s[b] === ')') { d--; if (d === 0) { b++; break; } }
            b++;
          }
        }
      }
      const right = s.slice(i + 1, b).trim();
      // Operandlardan biri okunamadıysa işleci sil: bozuk bir mod() üretmektense
      if (!left || !right) { s = s.slice(0, i) + ' ' + s.slice(i + 1); continue; }
      s = s.slice(0, a + 1) + 'mod(' + left + ', ' + right + ')' + s.slice(b);
    }
    return s;
  }

  /* Ortak metin dönüşümleri: hem küresel koda hem gövdeye aynı şekilde
     uygulanmalı, yoksa fonksiyon tanımı ile çağrısı farklı dillerde olur.
     Atama sarmalayıcısı burada DEĞİL: o, iki bölümden birlikte çıkarılan
     tip çizelgesini gerektiriyor. */
  function rewriteText(s) {
    /* Presetlerin %25,9'u kendi doku değişkenini bildiriyor
       (`sampler2D sampler_lichen;`). Bunu biz uniform olarak zaten
       bildiriyoruz ve GLSL'de uniform olmayan sampler yasak — bildirimi
       bırakmak o presetleri tümden derlenmez yapıyordu. */
    /* HLSL'in `sampler_state { ... }` bloğu: süzme/sarma ayarını shader
       metninde tarif ediyor. GLSL'de bunun karşılığı doku nesnesinin
       kendisinde; blok olduğu gibi atılıyor. */
    s = s.replace(/\bsampler\w*\s+sampler_[A-Za-z0-9_]+\s*=\s*sampler_state\s*\{[^}]*\}\s*;?/g, '');
    s = s.replace(/\bsampler(2D|3D|CUBE)?\s+sampler_[A-Za-z0-9_]+\s*;/g, '');
    // HLSL'in `static` niteleyicisi GLSL'de ayrılmış sözcük (%3)
    s = s.replace(/\bstatic\b/g, ' ');
    // Matris kurucuları tip eşlemesinden ÖNCE, yoksa float3x3( -> mat3( olur
    s = s.replace(/\bfloat2x2\s*\(/g, 'hmat2(')
      .replace(/\bfloat3x3\s*\(/g, 'hmat3(')
      .replace(/\bfloat4x4\s*\(/g, 'hmat4(')
      .replace(/\bhalf2x2\s*\(/g, 'hmat2(')
      .replace(/\bhalf3x3\s*\(/g, 'hmat3(')
      .replace(/\bhalf4x4\s*\(/g, 'hmat4(');
    s = s.replace(/\bsampler_(fw|pw|fc|pc)_/g, 'sampler_');
    for (const t of TYPES) s = s.replace(new RegExp('\\b' + t[0] + '\\b', 'g'), t[1]);
    /* Presetler yerleşiklerin adını bazen küçük harfle yazıyor (`tex2d`).
       HLSL derleyicisi bunu kabul ediyordu; 42 preset yalnızca bu yüzden
       derlenmiyordu. */
    s = s.replace(/\btex2d\b/g, 'tex2D')
      .replace(/\btex3d\b/g, 'tex3D')
      .replace(/\btex2dlod\b/g, 'tex2Dlod')
      .replace(/\btex2dbias\b/g, 'tex2Dbias')
      .replace(/\bgetblur([0-3])\b/gi, 'GetBlur$1')
      .replace(/\bgetpixel\b/gi, 'GetPixel');
    /* HLSL'in süslü parantezli matris ilk değeri: `float2x2 r = {a,b,c,d};`
       GLSL'de böyle bir sözdizimi yok. Satır sırasıyla yazıldığı için
       yukarıdaki hmat* kurucusuna gidiyor. */
    s = s.replace(/\b(mat[234])\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{([^{}]*)\}/g,
      function (all, t, name, args) {
        return t + ' ' + name + ' = hmat' + t.slice(3) + '(' + args.trim().replace(/,\s*$/, '') + ')';
      });
    s = floatify(s);
    s = modFix(s);
    s = s.replace(/\bpow\s*\(/g, 'mdPow(');
    /* `float4 c = tex2D(...)` için önce iki özel kural denedim: sağ tarafı
       vec4 ile sarmak, sonra değişkenin tipini vec3'e çekmek. İkisi de
       derleme kapısında yeni hata üretti — ikincisi `c.zw` okuyan presetleri
       kırdı. Aşağıdaki genel atama sarmalayıcısı geldikten sonra ikisine de
       gerek kalmadı: `vec4 c = toV4(tex2D(...))` zaten doğru iş görüyor.
       Özel durum eklemek yerine kaldırmak, buradaki doğru hamleydi. */

    return s;
  }

  /* Bildirimlerden tip çizelgesi. Kapsam ayrımı yok — presetin kendi
     fonksiyonundaki yerel bir ad gövdedeki aynı adı gölgeleyebilir. Tam bir
     çözümleyici bunu ayırırdı; burada en kötü ihtimalle yanlış bir
     sarmalayıcı seçilir ve o deyim zaten derlenmiyordu.

     ÇİZELGE İKİ BÖLÜMDEN BİRLİKTE çıkarılmalı: preset değişkenini
     `shader_body`den önce bildirip gövdede atayabiliyor. Ayrı ayrı
     baktığımda gövdedeki `ret1 = 0.0;` tipsiz kalıyor ve onarılmıyordu. */
  function typesOf(text) {
    const types = new Map(BUILTIN_TYPES);
    const dre = /\b(float|vec2|vec3|vec4)\s+/g;
    let dm;
    while ((dm = dre.exec(text)) !== null) {
      /* Bildirimin sonuna kadar oku ve virgülle ayrılmış HER adı çizelgeye
         yaz. Yalnızca ilk adı almak `float zv, zw;` yazan presetlerde
         ikinciyi tipsiz bırakıyordu ve o satırlar onarılmadan geçiyordu. */
      let i = dre.lastIndex;
      let d = 0;
      const names = [];
      let cur = '';
      for (; i < text.length; i++) {
        const c = text[i];
        if (c === '(' || c === '[') d++;
        else if (c === ')' || c === ']') d--;
        if (d === 0 && (c === ',' || c === ';')) { names.push(cur); cur = ''; if (c === ';') break; continue; }
        if (d === 0 && (c === '{' || c === '}' || c === '\n')) { names.push(cur); break; }
        cur += c;
      }
      for (const part of names) {
        const nm = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:$|=|\[)/.exec(part);
        if (nm) types.set(nm[1], dm[1]);
      }
    }
    return types;
  }

  /* Küresel bildirimlerdeki ilk değerleri main'in başına taşır.

     GLSL ES küresel bir ilk değerin SABİT ifade olmasını istiyor; preset ise
     `float2 sunpos = float2(sin(time), 0);` yazıyor — time bir uniform.
     Bildirim yerinde kalıyor, hesap main'e taşınıyor. */
  function hoistGlobals(text) {
    const decls = [];
    const prologue = [];
    let depth = 0;
    let paren = 0;
    let start = 0;
    const flush = (chunk, end) => {
      const st = chunk.trim();
      if (!st) return;
      const m = /^(float|vec2|vec3|vec4|mat[234])\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/.exec(st);
      if (depth === 0 && end === ';' && m && !/[,()]/.test(m[2])) {
        decls.push(m[1] + ' ' + m[2] + ';');
        prologue.push('  ' + m[2] + ' = ' + m[3].trim() + ';');
      } else {
        decls.push(st + (end || ''));
      }
    };
    for (let i = 0; i <= text.length; i++) {
      const c = text[i];
      if (c === '(' || c === '[') paren++;
      else if (c === ')' || c === ']') paren--;
      else if (c === '{') { depth++; continue; }
      else if (c === '}') { depth--; }
      const boundary = i === text.length ||
        (paren === 0 && depth === 0 && c === ';') ||
        (paren === 0 && depth === 0 && c === '}');
      if (!boundary) continue;
      flush(text.slice(start, i), c);
      start = i + 1;
    }
    return { decls: decls.join('\n'), prologue };
  }

  // Testler ve tek parçalık kullanım için: dönüştür, sonra atamaları sarmala
  function rewrite(s) {
    const t = rewriteText(s);
    return coerce(t, typesOf(t));
  }

  /* Bir MilkDrop shader'ını tam bir GLSL ES 3.00 parça shader'ına çevirir.

     Dönen `hard` boş değilse shader KOŞTURULMAMALI. `soft` boş değilse
     koşar ama içinde yaklaşık bir şey var; çağıran bunu kullanıcıya
     söyleyebilmek için biliyor. `extraSamplers` çizim tarafına "şu adlara da
     bir doku bağla" diyor. */
  function translate(src, opts) {
    const o = opts || {};
    const hard = [];
    const soft = [];
    const extraSamplers = [];
    const raw = String(src || '');
    if (!raw.trim()) return { glsl: '', hard, soft, extraSamplers, empty: true };

    const clean = stripComments(raw);
    const parts = split(clean);
    if (!parts.body.trim() && !parts.globals.trim()) {
      return { glsl: '', hard, soft, extraSamplers, empty: true };
    }

    const all = parts.globals + '\n' + parts.body;

    /* GLSL ES 3.00'ın önişlemcisi #if / #ifdef / #else / #endif / #define'ı
       zaten destekliyor ve korpusta kullanılanlar bunlar. Geriye #include
       kalıyor: başka bir dosya istiyor, o dosya bizde yok. */
    if (/^\s*#\s*include/m.test(all)) hard.push('#include');

    /* Bilinmeyen dokular: preset kendi resim dosyasını istiyor ve o dosyalar
       preset paketlerinde GELMİYOR (korpusta tek bir resim yok). Shader'ı
       hiç koşturmamak yerine yerine gürültü dokusu bağlanıyor: presetin
       blur zinciri, q ile sürülen renk matematiği ve geri kalan her satırı
       çalışmaya devam ediyor. Desen yanlış, yapı doğru — ve bu `soft`ta
       yazılı olduğu için görünür. */
    const seen = new Set();
    const re = /\bsampler_[A-Za-z0-9_]+/g;
    let m;
    while ((m = re.exec(all)) !== null) seen.add(canonSampler(m[0]));
    for (const n of seen) {
      if (KNOWN_SAMPLERS.indexOf(n) < 0) {
        soft.push('doku yerine gürültü: ' + n);
        extraSamplers.push(n);
      }
    }

    const gRaw = parts.globals ? rewriteText(parts.globals) : '';
    const bRaw = rewriteText(parts.body);
    const types = typesOf(gRaw + '\n' + bRaw);
    const hoisted = gRaw ? hoistGlobals(coerce(gRaw, types)) : { decls: '', prologue: [] };
    const body = coerce(bRaw, types);

    /* İki aşamanın girdileri AYNI DEĞİL ve karıştırmak sessizce yanlış
       görüntü verir:

       warp  ağ üzerinde çiziliyor. `uv` düğümün BOZULMUŞ koordinatı,
             `uv_orig` bozulmamış hali, rad/ang de düğümden interpolasyonla
             geliyor. Bunları parça shader'ında uv'den yeniden hesaplamak
             bozulmayı görmezden gelmek olurdu.
       comp  tam ekran dörtgeni. Orada rad/ang iki üçgen üzerinden
             interpolasyona uygun değil (yarıçap doğrusal değil), bu yüzden
             piksel başına hesaplanıyor. */
    const stage = o.stage === 'warp' ? 'warp' : 'comp';
    const ins = stage === 'warp'
      ? ['in vec2 vUV;', 'in vec2 vUVOrig;', 'in float vRad;', 'in float vAng;', '']
      : ['in vec2 vUV;', ''];
    const decl = extraSamplers.map((n) => 'uniform sampler2D ' + n + ';');
    const head = PREAMBLE
      .concat(ins)
      .concat(decl, decl.length ? [''] : [])
      .concat(globalDecls(), HELPERS, ['']);
    const mid = hoisted.decls ? hoisted.decls.split('\n').concat(['']) : [];
    const main = ['void main() {']
      .concat(qAssigns(), stage === 'warp' ? [
        '  uv = vUV;',
        '  uv_orig = vUVOrig;',
        '  rad = vRad;',
        '  ang = vAng;',
        '  ret = vec3(0.0);',
        '',
      ] : [
        '  uv = vUV;',
        '  uv_orig = vUV;',
        /* rad/ang MilkDrop'ta merkeze göre kutupsal koordinat. En-boy
           düzeltmesi uygulanıyor, yoksa geniş ekranda çemberler elips olur. */
        '  rad = length((uv - 0.5) * aspect.xy) * 2.0;',
        '  ang = atan(uv.y - 0.5, uv.x - 0.5);',
        '  ret = vec3(0.0);',
        '',
      ])
      // presetin küresel ilk değerleri: uniform okuyabilsinler diye burada
      .concat(hoisted.prologue, hoisted.prologue.length ? [''] : [])
      .concat(body.split('\n').map((l) => '  ' + l))
      .concat(['', '  outColor = vec4(ret, 1.0);', '}']);

    return {
      glsl: head.concat(mid, main).join('\n'),
      hard,
      soft,
      extraSamplers,
      empty: false,
      stage: stage,
    };
  }

  const api = {
    translate, stripComments, split, bodyOf, floatify, canonSampler,
    rewrite, KNOWN_SAMPLERS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVMilkdropShader = api;
})();
