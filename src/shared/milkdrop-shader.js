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
  /* GLSL ES 3.00'ın ayrılmış sözcüklerinden korpusta değişken adı olarak
     gerçekten karşımıza çıkanlar. Tamamını listelemek gereksiz. */
  const RESERVED = /\b(output|input|filter|common|active|this|union|template|namespace|public|external|inline|volatile|short|long|unsigned|cast|class|enum|typedef|using|goto|asm|resource|partition|superp|varying|attribute|row_major|sizeof|restrict|sample|buffer|shared|coherent|readonly|writeonly|patch|precise|subroutine|packed|centroid|noperspective|invariant|layout|hvec2|hvec3|hvec4|fvec2|fvec3|fvec4|dvec2|dvec3|dvec4)\b/g;

  /* GLSL'in YERLEŞİK FONKSİYON adları. Ayrılmış sözcük değiller, ama presetin
     aynı adda bir DEĞİŞKEN bildirmesi çağrıyla çakışıyor: `float2 mod = ...`
     sonrası `mod.x` "field selection requires structure, vector..." veriyor,
     çünkü derleyici adı hâlâ fonksiyon sanıyor. Toptan yeniden adlandırmak
     olmaz — `mod(a,b)` çağrılarını da bozar; yalnız BİLDİRİLMİŞ olanlar
     değiştiriliyor. */
  const SHADOWABLE = [
    'mod', 'length', 'distance', 'normalize', 'fract', 'sign',
    'floor', 'ceil', 'round', 'trunc', 'radians', 'degrees', 'texture',
    'transpose', 'determinant', 'inverse', 'equal', 'faceforward', 'refract',
    'smoothstep', 'clamp', 'step', 'mix', 'matrixCompMult', 'outerProduct',
  ];

  const SHADOW_TYPE = '(?:float|int|bool|vec2|vec3|vec4|mat2|mat3|mat4|mat[234]x[234])';

  /* Metinde DEĞİŞKEN olarak bildirilmiş yerleşik adları bulur. Ardından `(`
     gelmemeli — gelirse o bir fonksiyon TANIMI ve dokunulmamalı. */
  function shadowedNames(text) {
    const out = [];
    for (const name of SHADOWABLE) {
      const decl = new RegExp('\\b' + SHADOW_TYPE + '\\s+' + name + '\\b(?!\\s*\\()');
      if (decl.test(text)) out.push(name);
    }
    return out;
  }

  /* Adları yeniden adlandırır. Çağrı biçimi (ad + parantez) korunuyor, geri
     kalan her geçiş değişiyor — böylece `mod(a,b)` çağrısı bozulmadan
     `mod` DEĞİŞKENİ `mod_v` oluyor.

     Ad listesi DIŞARIDAN geliyor, çünkü bildirim globals'ta, kullanım
     gövdede olabiliyor ve rewriteText iki bölümü ayrı ayrı işliyor: bölüm
     başına karar verilince globals'taki bildirim değişip gövdedeki kullanım
     olduğu gibi kalıyor ve ad "undeclared identifier" oluyordu. */
  function renameShadowed(s, names) {
    for (const name of names || []) {
      s = s.replace(new RegExp('\\b' + name + '\\b(?!\\s*\\()', 'g'), name + '_v');
    }
    return s;
  }

  const SAMPLER_PREFIX = /^sampler_(fw|pw|fc|pc)_/;
  const KNOWN_SAMPLERS = [
    'sampler_main', 'sampler_blur1', 'sampler_blur2', 'sampler_blur3',
    'sampler_noise_lq', 'sampler_noise_lq_lite', 'sampler_noise_mq',
    'sampler_noise_hq', 'sampler_noisevol_lq', 'sampler_noisevol_hq',
  ];
  /* Bunlar `sampler3D` bildiriliyor. Ön ekli türevleri de (örn.
     `sampler_pw_noisevol_hq`, korpusta 65 kullanım) aynı türü almalı;
     `sampler2D` bildirilirse `tex3D` çağrısı aşırı yükleme çözümünde
     sessizce 2B sürüme düşer ve z yine yok sayılırdı. */
  const VOLUME_SAMPLERS = ['sampler_noisevol_lq', 'sampler_noisevol_hq'];

  function canonSampler(name) {
    return name.replace(SAMPLER_PREFIX, 'sampler_');
  }

  // --------------------------------------------------------------- önsöz

  /* Tip karşılıkları. Sıra önemli: float3x3 float3'ten ÖNCE eşleşmeli,
     yoksa mat3'ün yerine vec3x3 gibi bir şey çıkar. */
  const TYPES = [
    ['float4x4', 'mat4'], ['float3x3', 'mat3'], ['float2x2', 'mat2'],
    /* Kare OLMAYAN matrisler. HLSL floatRxC "satır x sütun" yazıyor, GLSL
       matCxR "sütun x satır". Yani HLSL float2x3 (2 satır, 3 sütun) şekil
       olarak GLSL mat3x2'ye denk — adı devirmeden eşlemek derlenen ama
       YANLIŞ çizen bir shader verirdi, ki bu düpedüz daha kötü. */
    ['float2x3', 'mat3x2'], ['float3x2', 'mat2x3'],
    ['float2x4', 'mat4x2'], ['float4x2', 'mat2x4'],
    ['float3x4', 'mat4x3'], ['float4x3', 'mat3x4'],
    ['half4x4', 'mat4'], ['half3x3', 'mat3'], ['half2x2', 'mat2'],
    ['float4', 'vec4'], ['float3', 'vec3'], ['float2', 'vec2'], ['float1', 'float'],
    ['half4', 'vec4'], ['half3', 'vec3'], ['half2', 'vec2'], ['half1', 'float'],
    ['half', 'float'],
    /* HLSL'in tam sayı vektörleri. Sayılar zaten float'a çekildiği için
       karşılıkları da float vektör; `int2 k = ...` yazan 18 preset yalnızca
       bu bildirim yüzünden derlenmiyordu. */
    ['double4', 'vec4'], ['double3', 'vec3'], ['double2', 'vec2'], ['double', 'float'],
    /* HLSL'in bool vektörleri. Eşlenmezlerse `bool3 f(...)` bildiren preset
       "syntax error" veriyor — tip adı GLSL'de hiç yok. */
    ['bool4', 'bvec4'], ['bool3', 'bvec3'], ['bool2', 'bvec2'],
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
    /* GLSL ES 3.00'da parça shader'ının `sampler2D` için ÖRTÜK bir kesinliği
       var ama `sampler3D` için YOK: bildirilmezse "No precision specified"
       ile derleme düşüyor. Ölçüldü — bu satır eklenmeden hacim gürültüsünü
       okuyan her aşama başarısız oluyordu. */
    'precision highp sampler3D;',
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
    /* Hacim gürültüsü GERÇEKTEN üç boyutlu. Daha önce `sampler2D` idi ve
       `tex3D` z'yi atıyordu: preset hacmin içinde ilerlediğini sanırken hep
       aynı dilimi okuyordu. Korpusta 4.287 çağrı bunu kullanıyor. */
    'uniform sampler3D sampler_noisevol_lq;',
    'uniform sampler3D sampler_noisevol_hq;',
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
    /* float4, vec3 degil: presetler rand_preset.w okuyor. */
    'uniform vec4 rand_preset;',
    'uniform vec4 roam_cos, roam_sin, slow_roam_cos, slow_roam_sin;',
    // MilkDrop'un shader'a verdiği hazır renk tonu vektörü
    /* `hue_shader` MilkDrop'ta EKRAN BOYUNCA DEĞİŞİYOR: dört köşeye dört
       ayrı renk hesaplanıyor ve arası çift doğrusal karışıyor. Bizde tek
       bir renkti, yani ekranın her yeri aynı tonu alıyordu.

       Köşeler uniform olarak geliyor, karışım parça shader'ında yapılıyor.
       Bu, köşe renklerini üçgen ağa yayıp donanıma bıraktığımızdan DAHA
       doğru: tam ekran tek üçgenle çizildiği için ağ enterpolasyonu zaten
       yok, kapalı biçim ise her pikselde tam sonucu veriyor.

       `hue_shader` uniform DEĞİL, dosya kapsamında bir değişken: presetler
       ona atama yapıyor (`hue_shader = hue_shader*4.0 - 2.8`) ve bazıları
       gövde dışında okuyor. Uniform olsaydı atama derlemeyi düşürürdü. */
    'uniform vec3 hue_corner[4];',
    'vec3 hue_shader;',
    'uniform vec3 blur1_min, blur1_max, blur2_min, blur2_max, blur3_min, blur3_max;',
    // GetBlurN'in geri acma carpani; motor yazan gecisle ayni degeri koyuyor
    'uniform vec3 blur1_scale, blur2_scale, blur3_scale;',
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
    /* Karışım oranı da vektör olabiliyor ve o zaman skaler uç YAYILIYOR.
       Korpustaki en büyük tek hata kovası buydu: `lerp(ret, 1.0, k)` — ret
       float3, 1.0 skaler, k float3. HLSL üçünü de birbirine uyduruyor. */
    'vec2 lerp(vec2 a, float b, vec2 t){ return mix(a, vec2(b), t); }',
    'vec3 lerp(vec3 a, float b, vec3 t){ return mix(a, vec3(b), t); }',
    'vec4 lerp(vec4 a, float b, vec4 t){ return mix(a, vec4(b), t); }',
    'vec2 lerp(float a, vec2 b, vec2 t){ return mix(vec2(a), b, t); }',
    'vec3 lerp(float a, vec3 b, vec3 t){ return mix(vec3(a), b, t); }',
    'vec4 lerp(float a, vec4 b, vec4 t){ return mix(vec4(a), b, t); }',
    'vec2 lerp(float a, float b, vec2 t){ return mix(vec2(a), vec2(b), t); }',
    'vec3 lerp(float a, float b, vec3 t){ return mix(vec3(a), vec3(b), t); }',
    'vec4 lerp(float a, float b, vec4 t){ return mix(vec4(a), vec4(b), t); }',
    /* KARIŞIM ORANI KOŞUL: `lerp(uv.x, 1.0, uv.x > 1.0)` gerçek presetlerde
       var. HLSL bool'u 1.0/0.0'a çeviriyor, GLSL çevirmiyor ve hiçbir aşırı
       yükleme eşleşmiyordu. Koşullu seçim mix'in bool karşılığı. */
    'float lerp(float a, float b, bool t){ return t ? b : a; }',
    'vec2 lerp(vec2 a, vec2 b, bool t){ return t ? b : a; }',
    'vec3 lerp(vec3 a, vec3 b, bool t){ return t ? b : a; }',
    'vec4 lerp(vec4 a, vec4 b, bool t){ return t ? b : a; }',
    'vec2 lerp(vec2 a, float b, bool t){ return t ? vec2(b) : a; }',
    'vec3 lerp(vec3 a, float b, bool t){ return t ? vec3(b) : a; }',
    'vec4 lerp(vec4 a, float b, bool t){ return t ? vec4(b) : a; }',
    'vec2 lerp(float a, vec2 b, bool t){ return t ? b : vec2(a); }',
    'vec3 lerp(float a, vec3 b, bool t){ return t ? b : vec3(a); }',
    'vec4 lerp(float a, vec4 b, bool t){ return t ? b : vec4(a); }',
    'float mdPow(float a, float b){ return pow(abs(a) + 1e-9, b); }',
    'vec2 mdPow(vec2 a, vec2 b){ return pow(abs(a) + 1e-9, b); }',
    'vec3 mdPow(vec3 a, vec3 b){ return pow(abs(a) + 1e-9, b); }',
    'vec4 mdPow(vec4 a, vec4 b){ return pow(abs(a) + 1e-9, b); }',
    'vec2 mdPow(vec2 a, float b){ return pow(abs(a) + 1e-9, vec2(b)); }',
    'vec3 mdPow(vec3 a, float b){ return pow(abs(a) + 1e-9, vec3(b)); }',
    'vec4 mdPow(vec4 a, float b){ return pow(abs(a) + 1e-9, vec4(b)); }',
    /* TABAN skaler, ÜS vektör: `pow(lum(ret), float3(0.3,1.0,1.8))` korpusta
       sık. HLSL tabanı yayıyor; yalnız (vektör, skaler) yönünü tutmak bu
       çağrıları eşleşmez bırakıyordu. */
    'vec2 mdPow(float a, vec2 b){ return pow(vec2(abs(a) + 1e-9), b); }',
    'vec3 mdPow(float a, vec3 b){ return pow(vec3(abs(a) + 1e-9), b); }',
    'vec4 mdPow(float a, vec4 b){ return pow(vec4(abs(a) + 1e-9), b); }',
    /* min/max KENDİ adıyla aşırı yüklenemiyor: GLSL ES yerleşik bir
       fonksiyonun yeniden bildirilmesini yasaklıyor ("Name of a built-in
       function cannot be redeclared as function") ve denediğimde derleme
       oranı %94,3'ten %0'a düştü. Bu yüzden çağrılar mdMin/mdMax'e
       yönlendiriliyor — pow'un mdPow'a yönlendirilmesiyle aynı kalıp.

       Eksik olan asıl şey argüman SIRASI: GLSL min(genType, float) veriyor
       ama min(float, genType) vermiyor; HLSL ikisini de kabul ediyor ve
       presetler `min(.1, _qa.xyz)` yazıyor. */
    'float mdMin(float a, float b){ return min(a, b); }',
    'vec2 mdMin(vec2 a, vec2 b){ return min(a, b); }',
    'vec3 mdMin(vec3 a, vec3 b){ return min(a, b); }',
    'vec4 mdMin(vec4 a, vec4 b){ return min(a, b); }',
    'vec2 mdMin(vec2 a, float b){ return min(a, b); }',
    'vec3 mdMin(vec3 a, float b){ return min(a, b); }',
    'vec4 mdMin(vec4 a, float b){ return min(a, b); }',
    'vec2 mdMin(float a, vec2 b){ return min(b, a); }',
    'vec3 mdMin(float a, vec3 b){ return min(b, a); }',
    'vec4 mdMin(float a, vec4 b){ return min(b, a); }',
    'float mdMax(float a, float b){ return max(a, b); }',
    'vec2 mdMax(vec2 a, vec2 b){ return max(a, b); }',
    'vec3 mdMax(vec3 a, vec3 b){ return max(a, b); }',
    'vec4 mdMax(vec4 a, vec4 b){ return max(a, b); }',
    'vec2 mdMax(vec2 a, float b){ return max(a, b); }',
    'vec3 mdMax(vec3 a, float b){ return max(a, b); }',
    'vec4 mdMax(vec4 a, float b){ return max(a, b); }',
    'vec2 mdMax(float a, vec2 b){ return max(b, a); }',
    'vec3 mdMax(float a, vec3 b){ return max(b, a); }',
    'vec4 mdMax(float a, vec4 b){ return max(b, a); }',
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
    // float4 koordinat da geçiyor; HLSL fazlasını kırpar.
    'vec3 tex2D(sampler2D s, vec4 uv2){ return texture(s, uv2.xy).xyz; }',
    'vec3 tex2Dlod(sampler2D s, vec4 uv2){ return textureLod(s, uv2.xy, uv2.w).xyz; }',
    'vec3 tex2Dbias(sampler2D s, vec4 uv2){ return texture(s, uv2.xy, uv2.w).xyz; }',
    /* Üç boyutlu okuma z'yi KULLANIYOR. Korpustaki 4.322 `tex3D` çağrısının
       tamamı hacim gürültüsünü veriyor; iki boyutlu aşırı yükleme yine de
       duruyor, çünkü korpus dışında bir preset 2B sampler geçirirse eskiden
       derlenen shader birden derlenmez olurdu. */
    /* Dort kose renginin cift dogrusal karisimi. MilkDrop'un tarama sirasi
       ekranin USTUNDEN baslıyor, bizim `uv.y` ise altta sifir: bu yuzden y
       ters cevriliyor. Ters cevrilmezse renk gecisi dikeyde aynalanirdi. */
    'vec3 hueAt(vec2 p){ float x = p.x; float y = 1.0 - p.y;' +
      ' return hue_corner[0] * x * y + hue_corner[1] * (1.0 - x) * y' +
      ' + hue_corner[2] * x * (1.0 - y) + hue_corner[3] * (1.0 - x) * (1.0 - y); }',
    'vec3 tex3D(sampler3D s, vec3 uv2){ return texture(s, uv2).xyz; }',
    'vec3 tex3D(sampler2D s, vec3 uv2){ return texture(s, uv2.xy).xyz; }',
    /* lum: MilkDrop'un parlaklık yardımcısı, presetlerin %40,8'i çağırıyor.
       Ağırlıklar MilkDrop'un kendi değerleri. */
    'float lum(vec3 v){ return dot(v, vec3(0.32, 0.49, 0.29)); }',
    'float lum(vec4 v){ return dot(v.xyz, vec3(0.32, 0.49, 0.29)); }',
    'float lum(float v){ return v; }',
    /* lum(float2) resmi preset paketinde GERÇEKTEN var — "Aqua Lumens"
       lum(uv_orig) ve lum(uv2*aspect.xy), "tiling the tube" lum(ret1.yx)
       yazıyor. HLSL'de dar vektörden genişe geçiş normalde yasak; fxc'nin
       eski D3DX kipinde sıfırla dolduruluyor ve bu presetler o yüzden
       derleniyor. Aynısını yapıyoruz: mavi bileşen 0 kabul ediliyor.
       Alternatif, presetin tamamının hiç çalışmamasıydı. */
    'float lum(vec2 v){ return dot(vec3(v, 0.0), vec3(0.32, 0.49, 0.29)); }',
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
    /* HLSL float2x3(r0, r1) iki float3 SATIR alıyor; GLSL mat3x2 üç vec2
       SÜTUN. Dönüşüm burada yapılıyor. mul(m, float3) -> float2 ikisinde de
       aynı sonucu verdiği için çağrı tarafı hiç değişmiyor. */
    'mat3x2 hmat2x3(vec3 r0, vec3 r1){ return mat3x2(vec2(r0.x, r1.x), vec2(r0.y, r1.y), vec2(r0.z, r1.z)); }',
    'mat2x3 hmat3x2(vec2 r0, vec2 r1, vec2 r2){ return mat2x3(vec3(r0.x, r1.x, r2.x), vec3(r0.y, r1.y, r2.y)); }',
    'vec2 mul(mat3x2 m, vec3 v){ return m * v; }',
    'vec3 mul(mat2x3 m, vec2 v){ return m * v; }',
    /* mul(vektör, skaler) HLSL'de SKALER ÇARPIM. Yalnız eşit genişlikli
       aşırı yüklemeler bulunduğu için `mul(uv-0.5, 1.0)` eşleşmiyordu; iç
       çarpım aşırı yüklemesine düşmesi de yanlış olurdu (vec2 bekleniyor,
       float dönerdi). */
    'vec2 mul(vec2 a, float b){ return a * b; }',
    'vec3 mul(vec3 a, float b){ return a * b; }',
    'vec4 mul(vec4 a, float b){ return a * b; }',
    'vec2 mul(float a, vec2 b){ return a * b; }',
    'vec3 mul(float a, vec3 b){ return a * b; }',
    'vec4 mul(float a, vec4 b){ return a * b; }',

    /* YERLEŞİK ADLAR: dot/all/any/cross/reflect GLSL'de yeniden
       tanımlanamıyor ("Name of a built-in function cannot be redeclared as
       function" — min/max'ı aşırı yüklemeye çalışmak derleme oranını bir
       kerede %0'a düşürmüştü). Çevirici çağrıları md* karşılıklarına
       yönlendiriyor, aşırı yükleme burada yapılıyor. */
    'float mdDot(float a, float b){ return a * b; }',
    'float mdDot(vec2 a, vec2 b){ return dot(a, b); }',
    'float mdDot(vec3 a, vec3 b){ return dot(a, b); }',
    'float mdDot(vec4 a, vec4 b){ return dot(a, b); }',
    'float mdDot(vec2 a, float b){ return dot(a, vec2(b)); }',
    'float mdDot(vec3 a, float b){ return dot(a, vec3(b)); }',
    'float mdDot(vec4 a, float b){ return dot(a, vec4(b)); }',
    'float mdDot(float a, vec2 b){ return dot(vec2(a), b); }',
    'float mdDot(float a, vec3 b){ return dot(vec3(a), b); }',
    'float mdDot(float a, vec4 b){ return dot(vec4(a), b); }',
    /* Farklı genişlik: HLSL geniş olanı DARALTIYOR (sessizce). */
    'float mdDot(vec3 a, vec2 b){ return dot(a.xy, b); }',
    'float mdDot(vec2 a, vec3 b){ return dot(a, b.xy); }',
    'float mdDot(vec4 a, vec3 b){ return dot(a.xyz, b); }',
    'float mdDot(vec3 a, vec4 b){ return dot(a, b.xyz); }',
    'float mdDot(vec4 a, vec2 b){ return dot(a.xy, b); }',
    'float mdDot(vec2 a, vec4 b){ return dot(a, b.xy); }',

    /* HLSL'de all/any HER tipte çalışıyor ve "sıfırdan farklı" anlamına
       geliyor; GLSL'inkiler yalnız bvec alıyor. */
    'bool mdAll(bool a){ return a; }',
    'bool mdAll(float a){ return a != 0.0; }',
    'bool mdAll(vec2 v){ return v.x != 0.0 && v.y != 0.0; }',
    'bool mdAll(vec3 v){ return v.x != 0.0 && v.y != 0.0 && v.z != 0.0; }',
    'bool mdAll(vec4 v){ return v.x != 0.0 && v.y != 0.0 && v.z != 0.0 && v.w != 0.0; }',
    'bool mdAll(bvec2 v){ return v.x && v.y; }',
    'bool mdAll(bvec3 v){ return v.x && v.y && v.z; }',
    'bool mdAll(bvec4 v){ return v.x && v.y && v.z && v.w; }',
    'bool mdAny(bool a){ return a; }',
    'bool mdAny(float a){ return a != 0.0; }',
    'bool mdAny(vec2 v){ return v.x != 0.0 || v.y != 0.0; }',
    'bool mdAny(vec3 v){ return v.x != 0.0 || v.y != 0.0 || v.z != 0.0; }',
    'bool mdAny(vec4 v){ return v.x != 0.0 || v.y != 0.0 || v.z != 0.0 || v.w != 0.0; }',
    'bool mdAny(bvec2 v){ return v.x || v.y; }',
    'bool mdAny(bvec3 v){ return v.x || v.y || v.z; }',
    'bool mdAny(bvec4 v){ return v.x || v.y || v.z || v.w; }',

    'vec3 mdCross(vec3 a, vec3 b){ return cross(a, b); }',
    'vec3 mdCross(vec3 a, float b){ return cross(a, vec3(b)); }',
    'vec3 mdCross(float a, vec3 b){ return cross(vec3(a), b); }',
    'vec3 mdReflect(vec3 a, vec3 b){ return reflect(a, b); }',
    'vec3 mdReflect(vec3 a, float b){ return reflect(a, vec3(b)); }',
    'vec2 mdReflect(vec2 a, vec2 b){ return reflect(a, b); }',
    'vec2 mdReflect(vec2 a, float b){ return reflect(a, vec2(b)); }',
    'float mdReflect(float a, float b){ return reflect(a, b); }',

    /* log10 GLSL'de YOK — yerleşik olmadığı için doğrudan tanımlanabiliyor,
       yönlendirmeye gerek kalmıyor. */
    'float log10(float x){ return log(x) * 0.4342944819; }',
    'vec2 log10(vec2 x){ return log(x) * 0.4342944819; }',
    'vec3 log10(vec3 x){ return log(x) * 0.4342944819; }',
    'vec4 log10(vec4 x){ return log(x) * 0.4342944819; }',
    'mat2 hmat2(float a, float b, float c, float d){ return mat2(a, c, b, d); }',
    'mat2 hmat2(vec2 r0, vec2 r1){ return mat2(r0.x, r1.x, r0.y, r1.y); }',
    'mat2 hmat2(vec4 v){ return mat2(v.x, v.z, v.y, v.w); }',
    'mat3 hmat3(float a, float b, float c, float d, float e, float f, float g, float h, float i){ return mat3(a, d, g, b, e, h, c, f, i); }',
    'mat3 hmat3(vec3 r0, vec3 r1, vec3 r2){ return mat3(r0.x, r1.x, r2.x, r0.y, r1.y, r2.y, r0.z, r1.z, r2.z); }',
    'mat4 hmat4(vec4 r0, vec4 r1, vec4 r2, vec4 r3){ return mat4(r0.x, r1.x, r2.x, r3.x, r0.y, r1.y, r2.y, r3.y, r0.z, r1.z, r2.z, r3.z, r0.w, r1.w, r2.w, r3.w); }',
    /* GetBlur*: MilkDrop'ta fonksiyon gibi yazılır ama aslında ayrı ayrı
       bulanıklaştırılmış kopyalardır — korpusun %71,3'ü (7.379 preset; shader
       taşıyanların %86,8'i) istiyor. Gerçekten
       üç ek doku gerekiyor; onları üretmek çizim tarafının işi, burada
       yalnızca okunuyorlar. Ölçek/kaydırma blurN_min/max ile geri açılıyor. */
    /* Bulanik kopya dokuya presetin b1n/b1x araligina SIKISTIRILARAK
       yaziliyor; burada ayni aralik geri aciliyor. Olcek uniform, cunku
       yazan gecisle okuyan bu satirin ayni sayiyi kullanmasi sart:
       carpani burada hesaplasaydik "MilkDrop uyumu" kapatildiginda ikisi
       birbirini tutmaz, bulanik kopya kayik parlaklikta okunurdu.

       Eskiden `* blurN_max + blurN_min` yaziyordu. b1n=0, b1x=1 iken
       (varsayilan) dogru sonucu veriyordu, ama araligi daraltan preset
       kendi yazdigindan baska bir sayi geri aliyordu. */
    'vec3 GetBlur1(vec2 u){ return texture(sampler_blur1, u).xyz * blur1_scale + blur1_min; }',
    'vec3 GetBlur2(vec2 u){ return texture(sampler_blur2, u).xyz * blur2_scale + blur2_min; }',
    'vec3 GetBlur3(vec2 u){ return texture(sampler_blur3, u).xyz * blur3_scale + blur3_min; }',
    'vec3 GetBlur0(vec2 u){ return texture(sampler_main, u).xyz; }',
    'vec3 GetPixel(vec2 u){ return texture(sampler_main, u).xyz; }',
    /* Bu beşi koordinatı float3 ya da skaler olarak da alıyor: presetler
       GetPixel(GetBlur1(uv)+...) yazıyor — GetBlur1 float3 döndürdüğü için
       argüman float3 oluyor — ve GetPixel(0.5) yazıyor. İkisi de sıradan
       HLSL: geniş vektör KIRPILIR, skaler YAYILIR. Uydurma yok, HLSL'in
       kendi dönüşüm kuralları. */
    'vec3 GetBlur1(vec3 u){ return GetBlur1(u.xy); }',
    'vec3 GetBlur2(vec3 u){ return GetBlur2(u.xy); }',
    'vec3 GetBlur3(vec3 u){ return GetBlur3(u.xy); }',
    'vec3 GetBlur0(vec3 u){ return GetBlur0(u.xy); }',
    'vec3 GetPixel(vec3 u){ return GetPixel(u.xy); }',
    'vec3 GetBlur1(float u){ return GetBlur1(vec2(u, u)); }',
    'vec3 GetBlur2(float u){ return GetBlur2(vec2(u, u)); }',
    'vec3 GetBlur3(float u){ return GetBlur3(vec2(u, u)); }',
    'vec3 GetBlur0(float u){ return GetBlur0(vec2(u, u)); }',
    'vec3 GetPixel(float u){ return GetPixel(vec2(u, u)); }',
    /* HLSL atamada sessizce KIRPAR ve YAYAR: `float3 c = tex2D(...)` float4'ü
       üçe indirir, `float2 v = 0` sıfırı ikiye yayar. GLSL ikisini de
       yapmaz ve shader hiç derlenmez — derleme kapısındaki en büyük iki
       hata kovası buydu.

       Her durumu metinden tip çıkararak onarmak küçük bir HLSL derleyicisi
       yazmak demekti. Gerek yok: bir atamanın SOL tarafının tipi zaten
       bildirimden BİLİNİYOR. Sağ tarafın tipini bilmek gerekmiyor, çünkü
       aşağıdaki aşırı yüklemeler onu derleyiciye çözdürüyor. Yani tip
       çıkarımı bize değil GLSL'e ait. */
    // HLSL karşılaştırmayı 0/1 diye okur, GLSL okumaz: bool da sarmalanmalı
    /* HLSL bool ile sayı arasında serbestçe gidip geliyor; GLSL hiç
       çevirmiyor. Preset fonksiyonlarının parametre/dönüş dönüşümleri de
       bunları kullanıyor. */
    'bool toB(bool b){ return b; }',
    'bool toB(float x){ return x != 0.0; }',
    'bool toB(vec2 v){ return v.x != 0.0; }',
    'bool toB(vec3 v){ return v.x != 0.0; }',
    'bool toB(vec4 v){ return v.x != 0.0; }',
    'int toI(int i){ return i; }',
    'int toI(bool b){ return b ? 1 : 0; }',
    'int toI(float x){ return int(x); }',
    'int toI(vec2 v){ return int(v.x); }',
    'int toI(vec3 v){ return int(v.x); }',
    'int toI(vec4 v){ return int(v.x); }',
    'float toF(bool b){ return b ? 1.0 : 0.0; }',
    'float toF(int i){ return float(i); }',
    'vec2 toV2(bool b){ return vec2(b ? 1.0 : 0.0); }',
    'vec3 toV3(bool b){ return vec3(b ? 1.0 : 0.0); }',
    'vec4 toV4(bool b){ return vec4(b ? 1.0 : 0.0); }',
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
    /* MilkDrop'un verdiği uniform'lar. Tip çıkarımı bunları bilmeden
       çalışamaz: `uv*.3 + .01*rand_frame` ifadesinde rand_frame'in vec4
       olduğunu bilmezsek daraltılması gerektiğini de göremeyiz. */
    for (const n of ['texsize', 'aspect', 'texsize_noise_lq', 'texsize_noise_mq',
      'texsize_noise_hq', 'texsize_noise_lq_lite', 'texsize_noisevol_lq',
      'texsize_noisevol_hq', 'rand_frame', 'roam_cos', 'roam_sin',
      'slow_roam_cos', 'slow_roam_sin', '_qa', '_qb', '_qc', '_qd',
      '_qe', '_qf', '_qg', '_qh', 'rand_preset']) m.set(n, 'vec4');
    for (const n of ['hue_shader', 'blur1_min', 'blur1_max',
      'blur2_min', 'blur2_max', 'blur3_min', 'blur3_max']) m.set(n, 'vec3');
    for (const n of ['time', 'fps', 'frame', 'progress', 'bass', 'mid', 'treb',
      'vol', 'bass_att', 'mid_att', 'treb_att', 'vol_att']) m.set(n, 'float');
    return m;
  })();

  /* İfade ayrıştırıcısı ayrı bir dosyada. Tarayıcıda betik sırasına bağlı
     olmamak için tembel çözülüyor: bu modül yüklenirken diğeri henüz
     tanımlı olmayabilir. */
  let _hl;
  function hl() {
    if (_hl !== undefined) return _hl;
    _hl = null;
    try {
      if (typeof window !== 'undefined' && window.SVMilkdropHLSL) _hl = window.SVMilkdropHLSL;
      else if (typeof require === 'function') _hl = require('./milkdrop-hlsl.js');
    } catch (e) { _hl = null; }
    return _hl;
  }

  const CAST = { float: 'toF', vec2: 'toV2', vec3: 'toV3', vec4: 'toV4' };

  /* Her atamanın sağ tarafını sol tarafın tipine çeviren sarmalayıcıya alır.

     Deyimlere ayırırken parantez derinliği izleniyor: `for (i=0; i<n; i++)`
     içindeki noktalı virgüller deyim sonu DEĞİL, ve oradaki `i=0`
     sarmalanmamalı. Süslü parantezler de sınır sayılıyor. */
  /* `if (x)` / `while (x)` koşulunda HLSL sayı kabul ediyor (sıfır değilse
     doğru), GLSL yalnızca bool alıyor. Gerçek koddan: "funky illusions"
     `mask1 = ...; if (mask1) { ... }` yazıyor ve GLSL "boolean expression
     expected" diyerek shader'ı hiç derlemiyor.

     Tip BİLİNMİYORSA dokunulmuyor: zaten bool olan bir koşulu `!= 0.0` ile
     sarmak yeni bir hata üretirdi. */
  function boolConds(s, types) {
    const re = /\b(if|while)\s*\(/g;
    let out = '';
    let last = 0;
    let m;
    const H = hl();
    if (!H) return s;
    while ((m = re.exec(s)) !== null) {
      let depth = 1;
      let i = re.lastIndex;
      for (; i < s.length && depth > 0; i++) {
        if (s[i] === '(') depth++;
        else if (s[i] === ')') depth--;
      }
      if (depth !== 0) break;
      const cond = s.slice(re.lastIndex, i - 1);
      let t = 'unknown';
      try { t = H.typeOf(H.parse(H.tokenize(cond)), types); } catch (e) { t = 'unknown'; }
      /* KOŞUL DA DARALTILIYOR. Daraltma yalnız atamalara ve return'e
         uygulanıyordu; oysa HLSL'in kuralları koşulun içinde de geçerli:
         `if (!first)` — first bir sayı, HLSL `!` ile sıfıra karşılaştırıyor,
         GLSL "no operation '!' exists that takes an operand of type float"
         diyor. Sarmalama yapılmayan (zaten bool olan) koşullar da bundan
         yararlanıyor, çünkü sorun sarmalamada değil koşulun İÇİNDE. */
      let fixed = cond;
      try { fixed = H.narrowExpr(cond, types); } catch (e) { fixed = cond; }
      if (t === 'bool' || t === 'unknown') {
        if (fixed === cond) { re.lastIndex = i; continue; }
        out += s.slice(last, m.index) + m[1] + ' (' + fixed + ')';
        last = i;
        re.lastIndex = i;
        continue;
      }
      out += s.slice(last, m.index) + m[1] + ' ((' + fixed + ') != 0.0)';
      last = i;
      re.lastIndex = i;
    }
    return last ? out + s.slice(last) : s;
  }

  function coerce(s, types) {
    const out = [];
    let depth = 0;
    let start = 0;
    /* KONUMA BAĞLI GÖLGELEME.

       Çizelge tüm metin önceden taranarak kuruluyor, yani bir adın tipi
       metnin tamamı için tek. Ama preset aynı adı ORTA YERDE yeniden
       bildirebiliyor: "fractal descent" dış kapsamda `float c;` bildirip
       gövdede ona atıyor, DAHA SONRA gövdede `float2 c` bildiriyor. Tek bir
       tip seçmek iki taraftan birini bozuyordu — hangisini seçersem
       seçeyim, ölçüm ikisini de gösterdi.

       Deyimler zaten sırayla geziliyor; bildirim görüldüğü ANDAN itibaren
       geçerli sayılıyor. Öncesindeki deyimler eski tipi görüyor. */
    let live = types;
    for (let i = 0; i <= s.length; i++) {
      const c = s[i];
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      const boundary = i === s.length || (depth === 0 && (c === ';' || c === '{' || c === '}'));
      if (!boundary) continue;
      const st = s.slice(start, i);
      out.push(fixStatement(st, live) + (i < s.length ? c : ''));
      const d = /^\s*(?:const\s+)?(float|vec2|vec3|vec4)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|$)/.exec(st);
      if (d && live.get(d[2]) !== d[1]) {
        if (live === types) live = new Map(types);
        live.set(d[2], d[1]);
      }
      start = i + 1;
    }
    return out.join('');
  }

  /* Üst düzey virgüllerden böler; parantez/köşeli parantez içindekiler
     argüman ayırıcıdır ve bölünmez. */
  function splitTopCommas(text) {
    const out = [];
    let d = 0, last = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '(' || c === '[') d++;
      else if (c === ')' || c === ']') d--;
      else if (c === ',' && d === 0) { out.push(text.slice(last, i)); last = i + 1; }
    }
    out.push(text.slice(last));
    return out;
  }

  const DECL_HEAD = /^(\s*(?:float|int|bool|vec2|vec3|vec4|mat2|mat3|mat4|mat[234]x[234])\s+)([\s\S]*)$/;

  function fixStatement(st, types) {
    if (!st.trim() || /(^|\n)\s*#/.test(st)) return st;
    /* `const float k = 0.0;` sarmalanmamalı: GLSL const'un ilk değerinin
       SABİT ifade olmasını istiyor, `toF(...)` ise bir fonksiyon çağrısı. */
    if (/^\s*const\b/.test(st)) return st;

    /* ÇOKLU BİLDİRİM ve VİRGÜL İŞLEÇLİ ATAMA DİZİSİ.

       `float3 ret = tex2D(sampler_main, uv).x, other = 1.0;` HLSL'de
       geçerli: her bildirici kendi başına örtük dönüşümden geçiyor. Burada
       ise deyimin tamamına bakılıyordu ve üst düzey virgül görülünce hiç
       dokunulmuyordu — tek bir sarmalayıcıya almak `toF(a, b)` gibi
       geçersiz bir çağrı ürettiği için o kaçış doğruydu, ama eksikti:
       ölçümde 221 stage yalnızca bu yüzden derlenmiyordu.

       Doğrusu bölüp HER BİRİNİ ayrı sarmak. Bildirimlerde tip öneki her
       parçaya geçici olarak takılıyor, çünkü hedef tipi o belirliyor. */
    /* `return` da daraltılıyor. Daraltma yalnız ATAMALARA uygulanıyordu;
       oysa HLSL'in örtük kuralları return ifadesinin İÇİNDE de geçerli:
       `return res * (res > 0.02);` bool'u sayı gibi kullanıyor ve GLSL
       "wrong operand types" diyor. Dönüş tipine çevirmek (coerceUserReturns)
       dış katmanı düzeltiyor, ifadenin içi burada düzeliyor. */
    const rt = /^(\s*return\b)([\s\S]+)$/.exec(st);
    if (rt && rt[2].trim()) {
      const H = hl();
      if (!H) return st;
      return rt[1] + ' ' + H.narrowExpr(rt[2].trim(), types);
    }

    const parts = splitTopCommas(st);
    if (parts.length > 1) {
      const decl = DECL_HEAD.exec(st);
      if (decl) {
        const head = decl[1];
        const done = splitTopCommas(decl[2]).map((one) => {
          const fixed = fixStatement(head + one.trim(), types);
          return fixed.slice(head.length);
        });
        return head + done.join(', ');
      }
      /* Tip yoksa virgül İŞLECİ: `trad = q5, srad = sqrt(trad)`. Her atama
         kendi hedef tipini çizelgeden buluyor. */
      return parts.map((p) => fixStatement(p, types)).join(',');
    }
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
      /* Üst düzey virgül varsa dokunma. `trad = q5, srad = sqrt(trad)` bir
         atama DİZİSİ; tek bir sarmalayıcıya almak `toF(a, b)` gibi geçersiz
         bir çağrı üretiyordu ve o shader'lar yalnızca bunun yüzünden
         derlenmiyordu — kendi eklediğim hataydı. */
      if (hasTopComma(rhs)) return st;
      /* Sağ tarafı önce tip çıkarımından geçir: HLSL iki farklı genişlikteki
         vektörü sessizce kırpar, GLSL kırpmaz. Bu, derleme kapısında kalan
         hataların çoğunluğuydu ve metinle çözülemiyordu — hangi tarafın
         geniş olduğunu bilmek ifadenin tipini bilmeyi gerektiriyor. */
      const H = hl();
      const body = H ? H.narrowExpr(rhs.trim(), types) : rhs.trim();
      return st.slice(0, i + 1) + ' ' + CAST[t] + '(' + body + ')';
    }
    return st;
  }

  /* Sol tarafın tipi. Bildirimse tip zaten yazıyor; değilse çizelgeden
     bakılıyor. Swizzle uzunluğu tipi daraltıyor: `ret.yz` vec2, `z.x` float
     — bu ayrım olmadan `z.x += vec3` durumu onarılamazdı.

     Sol taraf SONDAN okunuyor, baştan değil: `if (a==b) ret = 0.0;` gibi
     süslü parantezsiz gövdelerde deyimin başında koşul duruyor ve baştan
     eşleştiren bir kalıp bunları hiç yakalamıyordu. */
  /* İfadede parantez dışında virgül var mı. Fonksiyon çağrılarının içindeki
     virgüller sayılmamalı, o yüzden derinlik izleniyor. */
  function hasTopComma(text) {
    let d = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '(' || c === '[') d++;
      else if (c === ')' || c === ']') d--;
      else if (c === ',' && d === 0) return true;
    }
    return false;
  }

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
  /* HLSL'in dizi ilk değeri:  float4 samples[4] = { a,b,c,d, e,f,g,h, ... };
     GLSL ES 3.00'da bu sözdizimi yok; kurucu gerekiyor:
        vec4 samples[4] = vec4[4]( vec4(a,b,c,d), vec4(e,f,g,h), ... )
     HLSL listeyi DÜZ yazmayı serbest bırakıyor — 4 adet float4 için 16
     skaler — ve ORB presetleri tam olarak böyle yazıyor. Bu yüzden varsa iç
     süslü parantezler atılıp liste bileşen sayısına göre yeniden gruplanıyor.

     Sayı tutmuyorsa metne DOKUNULMUYOR: tanımadığımız bir biçimi yarım
     çevirmek, hiç çevirmemekten daha kötü bir hata verir. */
  function arrayInit(s) {
    const names = [];
    const re = /\b(float|vec2|vec3|vec4)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*(\d+)\s*\]\s*=\s*\{/g;
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
      // Açılan süslü parantezin eşini say: iç içe liste de olabiliyor.
      let depth = 1;
      let i = re.lastIndex;
      for (; i < s.length && depth > 0; i++) {
        if (s[i] === '{') depth++;
        else if (s[i] === '}') depth--;
      }
      if (depth !== 0) break; // kapanmamış: dokunma
      const inner = s.slice(re.lastIndex, i - 1);
      const type = m[1];
      const count = Number(m[3]);
      const width = type === 'float' ? 1 : Number(type.slice(3));
      const items = inner.replace(/[{}]/g, ' ').split(',')
        .map((x) => x.trim()).filter((x) => x.length);
      if (items.length !== width * count) { re.lastIndex = i; continue; }
      const groups = [];
      for (let k = 0; k < count; k++) {
        const g = items.slice(k * width, (k + 1) * width);
        groups.push(width === 1 ? g[0] : type + '(' + g.join(', ') + ')');
      }
      out += s.slice(last, m.index) +
        type + ' ' + m[2] + '[' + count + '] = ' + type + '[' + count + '](' + groups.join(', ') + ')';
      last = i;
      re.lastIndex = i;
      names.push(m[2]);
    }
    s = last ? out + s.slice(last) : s;
    return names.length ? arrayIndex(s, names) : s;
  }

  /* Dizi indeksi GLSL'de TAM SAYI olmak zorunda. HLSL'de değil, ve presetler
     döngü değişkenini float yazıyor: ORB'nin üç preseti
     `for(float i=0;i<4;i++) samples[i]` diyor. Sayılar zaten float'a
     çekildiği için indeks de float oluyor ve derleyici "integer expression
     required" veriyor.

     Düz tam sayı sabitine dokunulmuyor: hem gereksiz, hem de bildirimin
     kendisi (`samples[4] = ...`) o biçimde ve sarılmamalı. */
  /* Metindeki dizi bildirimlerinin adları.

     Ayrı bir geçiş olmak zorunda: bildirim `shader_body`den ÖNCE, kullanım
     gövdede olabiliyor ve rewriteText ikisine AYRI AYRI uygulanıyor. Yalnız
     arrayInit'in kendi metnine bakmak, ORB presetlerinde adı hiç görmüyordu
     — dizi doğru kuruluyor, indeksi float kalıyordu. */
  /* ---------------------------------------------------------------------
     PRESETİN KENDİ FONKSİYONLARI

     HLSL çağrı yerinde de örtük dönüşüm yapıyor: parametre `float2 center`
     iken `f(uv, 0.5, ...)` yazmak geçerli, skaler yayılıyor. GLSL'de aşırı
     yükleme aranıyor ve bulunamıyor. Korpustaki EN BÜYÜK tek hata kovası
     buydu — tek bir şablon fonksiyonu (`uv_polar_logarithmic`) 154 stage'i
     düşürüyordu.

     Yerleşiklerde çözüm aşırı yükleme eklemekti; burada olamaz, fonksiyonu
     preset yazıyor. Bunun yerine ÇAĞRI YERİ düzeltiliyor: her argüman
     bildirilen parametre tipine toF/toV2/toV3/toV4 ile çevriliyor. Aynı
     dönüştürücüler `return` için de kullanılıyor, çünkü HLSL orada da
     dönüştürüyor ("function return is not matching type").
     --------------------------------------------------------------------- */
  /* bool ve int de burada: HLSL `bool f(...) { return (x>1.0)*(x<7.0); }`
     yazmayı kabul ediyor — çarpım sayı, dönüş bool ve dönüşüm örtük. */
  const CONV = { float: 'toF', vec2: 'toV2', vec3: 'toV3', vec4: 'toV4', bool: 'toB', int: 'toI' };
  const FN_DEF = /\b(float|int|bool|vec2|vec3|vec4|mat2|mat3|mat4|mat[234]x[234])\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^()]*)\)\s*\{/g;
  const DECL_ARG = /^\s*(?:in|out|inout)?\s*(?:float|int|bool|vec2|vec3|vec4|mat2|mat3|mat4|mat[234]x[234]|sampler\w*)\s+[A-Za-z_]/;

  /* Metindeki fonksiyon TANIMLARINDAN imza çizelgesi çıkarır. */
  function userFnSigs(text) {
    const sigs = new Map();
    FN_DEF.lastIndex = 0;
    let m;
    while ((m = FN_DEF.exec(text)) !== null) {
      const params = m[3].split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
        const q = p.replace(/^(?:in|out|inout)\s+/, '');
        const t = /^([A-Za-z_][A-Za-z0-9_]*)\s+/.exec(q);
        return t ? t[1] : '';
      });
      /* Tanımadığımız bir parametre tipi varsa o fonksiyona hiç
         dokunulmuyor: yanlış dönüştürücü sarmak sessizce yanlış görüntü
         verir, derlenmemek ise en azından görünür. */
      if (params.some((t) => !CONV[t])) continue;
      sigs.set(m[2], { ret: m[1], params: params });
    }
    return sigs;
  }

  /* Çağrı argümanlarını parametre tipine çevirir. İç içe çağrılar önce
     işleniyor (özyineleme), zaten sarılmış argümana ikinci kez dokunulmuyor. */
  function coerceUserCalls(s, sigs) {
    if (!sigs || !sigs.size) return s;
    const IDCH = /[A-Za-z0-9_]/;
    let out = '';
    let i = 0;
    while (i < s.length) {
      if (!/[A-Za-z_]/.test(s[i])) { out += s[i]; i++; continue; }
      let j = i;
      while (j < s.length && IDCH.test(s[j])) j++;
      const name = s.slice(i, j);
      const sig = sigs.get(name);
      let k = j;
      while (k < s.length && /\s/.test(s[k])) k++;
      if (!sig || s[k] !== '(') { out += name; i = j; continue; }

      let d = 0, p = k, last = k + 1, closed = -1;
      const args = [];
      for (; p < s.length; p++) {
        const c = s[p];
        if (c === '(' || c === '[') d++;
        else if (c === ')' || c === ']') {
          d--;
          if (d === 0) { args.push(s.slice(last, p)); closed = p; break; }
        } else if (c === ',' && d === 1) { args.push(s.slice(last, p)); last = p + 1; }
      }
      if (closed < 0 || args.length !== sig.params.length) { out += name; i = j; continue; }
      // Tanımın kendisi: argümanlar "tip ad" biçiminde. Dokunulmuyor.
      if (args.some((a) => DECL_ARG.test(a))) { out += s.slice(i, closed + 1); i = closed + 1; continue; }

      const wrapped = args.map((a, n) => {
        const inner = coerceUserCalls(a, sigs).trim();
        const conv = CONV[sig.params[n]];
        if (!conv || !inner) return inner;
        if (inner.indexOf(conv + '(') === 0) return inner;
        return conv + '(' + inner + ')';
      });
      out += name + '(' + wrapped.join(', ') + ')';
      i = closed + 1;
    }
    return out;
  }

  /* `return` ifadelerini fonksiyonun bildirilen dönüş tipine çevirir. */
  function coerceUserReturns(s, sigs) {
    if (!sigs || !sigs.size) return s;
    const edits = [];
    FN_DEF.lastIndex = 0;
    let m;
    while ((m = FN_DEF.exec(s)) !== null) {
      const sig = sigs.get(m[2]);
      const conv = sig && CONV[sig.ret];
      if (!conv) continue;
      const open = m.index + m[0].length - 1;   // gövdenin '{' konumu
      let d = 0, end = -1;
      for (let i = open; i < s.length; i++) {
        if (s[i] === '{') d++;
        else if (s[i] === '}') { d--; if (d === 0) { end = i; break; } }
      }
      if (end < 0) continue;
      const body = s.slice(open, end);
      const rr = /\breturn\b([^;]*);/g;
      let r;
      while ((r = rr.exec(body)) !== null) {
        const expr = r[1].trim();
        if (!expr || expr.indexOf(conv + '(') === 0) continue;
        edits.push({
          at: open + r.index,
          len: r[0].length,
          text: 'return ' + conv + '(' + expr + ');',
        });
      }
    }
    // Sondan başa uygulanıyor: önceki düzenlemeler konumları kaydırmasın.
    edits.sort((a, b) => b.at - a.at);
    for (const e of edits) s = s.slice(0, e.at) + e.text + s.slice(e.at + e.len);
    return s;
  }

  function arrayNames(text) {
    const out = [];
    const re = /\b(?:float|vec2|vec3|vec4)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*\d+\s*\]/g;
    let m;
    while ((m = re.exec(text)) !== null) if (out.indexOf(m[1]) < 0) out.push(m[1]);
    return out;
  }

  function arrayIndex(s, names) {
    for (const n of names) {
      const re = new RegExp('\\b' + n + '\\s*\\[', 'g');
      let out = '';
      let last = 0;
      let m;
      while ((m = re.exec(s)) !== null) {
        let depth = 1;
        let i = re.lastIndex;
        for (; i < s.length && depth > 0; i++) {
          if (s[i] === '[') depth++;
          else if (s[i] === ']') depth--;
        }
        if (depth !== 0) break;
        const idx = s.slice(re.lastIndex, i - 1).trim();
        if (/^\d+$/.test(idx) || /^int\s*\(/.test(idx)) { re.lastIndex = i; continue; }
        out += s.slice(last, m.index) + n + '[int(' + idx + ')]';
        last = i;
        re.lastIndex = i;
      }
      if (last) s = out + s.slice(last);
    }
    return s;
  }

  function rewriteText(s) {
    /* Presetlerin %25,9'u kendi doku değişkenini bildiriyor
       (`sampler2D sampler_lichen;`). Bunu biz uniform olarak zaten
       bildiriyoruz ve GLSL'de uniform olmayan sampler yasak — bildirimi
       bırakmak o presetleri tümden derlenmez yapıyordu. */
    /* HLSL'in `sampler_state { ... }` bloğu: süzme/sarma ayarını shader
       metninde tarif ediyor. GLSL'de bunun karşılığı doku nesnesinin
       kendisinde; blok olduğu gibi atılıyor. */
    s = s.replace(/\bsampler\w*\s+sampler_[A-Za-z0-9_]+\s*=\s*sampler_state\s*\{[^}]*\}\s*;?/g, '');
    /* Ad `sampler_` ile başlamak zorunda değil: gerçek koddan `sampler MYSAMP;`.
       Bildirimi bırakmak GLSL'de sözdizimi hatası. */
    s = s.replace(/\bsampler(2D|3D|CUBE)?\s+[A-Za-z_][A-Za-z0-9_]*\s*;/g, '');
    // HLSL'in `static` niteleyicisi GLSL'de ayrılmış sözcük (%3)
    s = s.replace(/\bstatic\b/g, ' ');
    /* GLSL ES'in ayrılmış sözcükleri. HLSL'de serbest oldukları için presetler
       bunları değişken adı yapıyor: gerçek koddan `float3 output = ...`.
       Adı tutarlı biçimde değiştirmek zararsız, bırakmak derlemeyi kırıyor. */
    s = s.replace(RESERVED, function (w) { return w + '_v'; });
    /* `const` niteleyicisi düşürülüyor. GLSL const'un ilk değerinin SABİT
       ifade olmasını istiyor; preset ise oraya rahatça bir uniform ya da
       karşılaştırma yazıyor: `const float sw = rand_preset.x >= .4;`. */
    s = s.replace(/\bconst\s+/g, '');
    // Matris kurucuları tip eşlemesinden ÖNCE, yoksa float3x3( -> mat3( olur
    s = s.replace(/\bfloat2x3\s*\(/g, 'hmat2x3(')
      .replace(/\bfloat3x2\s*\(/g, 'hmat3x2(')
      .replace(/\bfloat2x2\s*\(/g, 'hmat2(')
      .replace(/\bfloat3x3\s*\(/g, 'hmat3(')
      .replace(/\bfloat4x4\s*\(/g, 'hmat4(')
      .replace(/\bhalf2x2\s*\(/g, 'hmat2(')
      .replace(/\bhalf3x3\s*\(/g, 'hmat3(')
      .replace(/\bhalf4x4\s*\(/g, 'hmat4(');
    /* Süzme ön eki BURADA SOYULMUYOR. Eskiden soyuluyordu ve `sampler_pw_main`
       ile `sampler_main` aynı uniform'a düşüyordu; korpusun %22,7'si aynı
       dokuyu iki farklı ön ekle okuyup ikisinde de aynı sonucu alıyordu.
       Artık her yazım kendi uniform'u (bkz. translate içindeki sampler
       planı) ve kendi doku birimi. */
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
    /* Aynı biçim VEKTÖRLERDE de var: `float2 center = { 0.41, 0.5 };`.
       Matris kuralının yanında bunun eksik olması o satırları sözdizimi
       hatası bırakıyordu. Vektörde satır/sütun sorunu yok, kurucu doğrudan
       aynı sırayı alıyor. */
    s = s.replace(/\b(vec[234])\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{([^{}]*)\}/g,
      function (all, t, name, args) {
        return t + ' ' + name + ' = ' + t + '(' + args.trim().replace(/,\s*$/, '') + ')';
      });
    s = arrayInit(s);
    s = floatify(s);
    s = modFix(s);
    s = s.replace(/\bpow\s*\(/g, 'mdPow(');
    // Gerekçe HELPERS içindeki mdMin/mdMax bloğunda.
    s = s.replace(/\bmin\s*\(/g, 'mdMin(').replace(/\bmax\s*\(/g, 'mdMax(');
    /* Aynı gerekçe: bu adlar da yerleşik ve GLSL'de aşırı yüklenemiyor.
       HLSL hepsinde skaleri yayıp geniş vektörü daraltıyor. */
    s = s.replace(/\bdot\s*\(/g, 'mdDot(')
      .replace(/\ball\s*\(/g, 'mdAll(')
      .replace(/\bany\s*\(/g, 'mdAny(')
      .replace(/\bcross\s*\(/g, 'mdCross(')
      .replace(/\breflect\s*\(/g, 'mdReflect(');
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
    /* Ad -> bildirildigi susulu parantez derinligi. Cakismada dis kapsam
       kazansin diye tutuluyor; gerekcesi asagida. */
    const depths = new Map();
    /* Yerleşikler de en dış kapsamda sayılıyor. Sayılmazsa derinlik kuralı
       onlara hiç uygulanmıyor ve fonksiyon içindeki bir yerel ad `uv`,
       `ret`, `rad` gibi motorun kendi değişkenlerinin tipini metnin
       TAMAMI için değiştirebiliyor. */
    for (const k of BUILTIN_TYPES.keys()) depths.set(k, 0);
    /* Matris bildirimleri de çizelgeye giriyor. Girmezlerse `float2x2 rot`
       tipsiz kalıyor, `mul(uv, rot)` de tipsiz oluyor ve ikili daraltma hiç
       çalışmıyor: ORB presetlerinde `mul(...) + GetBlur1(...)` ifadesi
       vec2 + vec3 olarak GLSL'e gidiyordu. */
    const dre = /\b(float|vec2|vec3|vec4|mat[234]x[234]|mat2|mat3|mat4)\s+/g;
    let dm;
    while ((dm = dre.exec(text)) !== null) {
      /* Bildirimin sonuna kadar oku ve virgülle ayrılmış HER adı çizelgeye
         yaz. Yalnızca ilk adı almak `float zv, zw;` yazan presetlerde
         ikinciyi tipsiz bırakıyordu ve o satırlar onarılmadan geçiyordu. */
      /* Bu bildirimin bulundugu derinlik: metnin basindan buraya kadar
         acilan/kapanan susulu parantezleri say. */
      let declDepth = 0;
      let parenDepth = 0;
      for (let k = 0; k < dm.index; k++) {
        const ch = text[k];
        if (ch === '{') declDepth++;
        else if (ch === '}') declDepth--;
        else if (ch === '(') parenDepth++;
        else if (ch === ')') parenDepth--;
      }
      if (declDepth < 0) declDepth = 0;
      /* PARANTEZ İÇİNDEKİ bildirim bir FONKSİYON PARAMETRESİ (ya da for
         başlığı): metinde süslü parantezlerin dışında duruyor, yani derinliği
         0 çıkıyor ve global bir bildirimmiş gibi davranıyor. Gerçekte
         fonksiyonun İÇİNE ait. Düzeltilmezse `float2 f(float uv)` yazan bir
         preset `uv`nin genel tipini float yapıyor ve gövdedeki HER `uv`
         ataması toF ile sarılıp "dimension mismatch" veriyordu. */
      if (parenDepth > 0) declDepth += 1;
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
        if (!nm) continue;
        /* DİZİ ise çizelgeye YAZILMIYOR.

           `vec4 samples[4]` adı vec4 diye kaydedilirse `samples[i]` bir
           BİLEŞEN erişimi sanılıyor, sonuç float çıkıyor ve daraltma
           `samples[i].x` içindeki `.x`i skaler swizzle diye siliyor. ORB'nin
           üç preseti tam olarak böyle bozuluyordu: `vec2(samples[i]*a,
           samples[i]*b)` sekiz bileşen veriyor ve "too many arguments"
           diyordu. Tipi hiç bilmemek burada bilmekten iyi: bilinmeyen ad
           daraltmaya uğramıyor ve ifade olduğu gibi, doğru biçimde kalıyor. */
        if (/^\s*[A-Za-z_][A-Za-z0-9_]*\s*\[/.test(part)) continue;
        /* Çakışmada DIŞ kapsamdaki bildirim kazanıyor.

           Tam kapsam çözümlemesi yok, ama süslü parantez derinliği ucuz bir
           yaklaşım: bir fonksiyonun İÇİNDE bildirilen ad, dışarıda aynı adla
           bildirilmiş olanı gölgelememeli. "fractal descent" dış kapsamda
           `float c;` bildirip kullanıyor, bir yardımcı fonksiyonun içinde de
           `float2 c` bildiriyor; içerideki kazanınca dışarıdaki atama toV2
           ile sarılıp boyut uyuşmazlığı veriyordu.

           Ölçüldü: "sonuncu kazansın" %99,9, "ilki kazansın" %99,4 — yani
           sırayla değil, DERİNLİKLE karar vermek gerekiyor. */
        const prevDepth = depths.get(nm[1]);
        if (prevDepth !== undefined && prevDepth < declDepth) continue;
        depths.set(nm[1], declDepth);
        types.set(nm[1], dm[1]);
      }
    }
    return types;
  }

  /* Küresel bildirimlerdeki ilk değerleri main'in başına taşır.

     GLSL ES küresel bir ilk değerin SABİT ifade olmasını istiyor; preset ise
     `float2 sunpos = float2(sin(time), 0);` yazıyor — time bir uniform.
     Bildirim yerinde kalıyor, hesap main'e taşınıyor. */
  /* PREAMBLE'daki uniform'ların adı -> tipi. Kaynaktan okunuyor ki listeyi
     ikinci bir yerde elle tutmak gerekmesin. */
  const UNIFORM_TYPES = (function () {
    const m = {};
    for (const line of PREAMBLE) {
      const g = /^uniform\s+(\w+)\s+(\w+)\s*;/.exec(line);
      if (g && g[1].indexOf('sampler') !== 0) m[g[2]] = g[1];
    }
    return m;
  })();

  /* Presetler uniform'a YAZIYOR.

     MilkDrop'ta rand_preset, hue_shader gibi değerler shader'a sabit olarak
     geliyor ama HLSL global'e atamayı serbest bırakıyor ve presetler bunu
     kullanıyor: "Flowercraft" hue_shader = (hue_shader*4.0)-2.8 yazıyor,
     "gimme color (Bubble Spinner Mix)" rand_preset'e atıyor. GLSL'de uniform
     salt okunur, atama satırı derlemeyi tümüyle düşürüyordu — preset hiç
     görünmüyordu.

     Uniform'un ADI DEĞİŞTİRİLMİYOR: motor onları ada göre bağlıyor
     (getUniformLocation), ad değişirse değer hiç ulaşmaz ve shader derlenir
     ama yanlış çizer — sessiz hata. Bunun yerine gövdedeki ad yerel bir
     kopyayla değiştiriliyor, kopya da uniform'dan tohumlanıyor. Uniform
     olduğu gibi duruyor, atama artık yerel değişkene gidiyor. */
  function aliasWrittenUniforms(texts) {
    const decls = [];
    const seed = [];
    const joined = texts.join('\n');
    for (const name of Object.keys(UNIFORM_TYPES)) {
      /* Atama mı? `x = `, `x += `, `x.rgb = ` sayılır; `x == `, `x >= `,
         `x != ` sayılmaz — karşılaştırma yazan preset çok daha fazla. */
      const write = new RegExp('\\b' + name + '\\b\\s*(?:\\.[xyzwrgba]+\\s*)?(?:[-+*/]?=)(?!=)');
      if (!write.test(joined)) continue;
      const local = name + '_w';
      decls.push(UNIFORM_TYPES[name] + ' ' + local + ';');
      seed.push('  ' + local + ' = ' + name + ';');
      const every = new RegExp('\\b' + name + '\\b', 'g');
      for (let i = 0; i < texts.length; i++) texts[i] = texts[i].replace(every, local);
    }
    return { decls, seed };
  }

  function hoistGlobals(text) {
    const decls = [];
    const prologue = [];
    let depth = 0;
    let paren = 0;
    let start = 0;
    /* Üst düzey virgüllerden böler. `float a = f(x,y), b = 2.0;` iki AYRI
       bildirim; parantez içindeki virgüller argüman ayırıcı, burada
       bölünürlerse ifade ortadan ikiye ayrılır. */
    const splitDeclarators = (s) => {
      const out = [];
      let d = 0, last = 0;
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '(' || c === '[') d++;
        else if (c === ')' || c === ']') d--;
        else if (c === ',' && d === 0) { out.push(s.slice(last, i)); last = i + 1; }
      }
      out.push(s.slice(last));
      return out;
    };

    const flush = (chunk, end) => {
      const st = chunk.trim();
      if (!st) return;
      /* Tip listesi dar tutulursa dar kalan bildirimler global kapsamda
         sabit olmayan ilk değerle kalıyor ve GLSL bunu reddediyor:
         `mat3x2 tst = hmat2x3(ts,t);` gerçek koddan. */
      const head = /^(float|int|bool|vec2|vec3|vec4|mat2|mat3|mat4|mat2x3|mat3x2|mat2x4|mat4x2|mat3x4|mat4x3)\s+([\s\S]+)$/
        .exec(st);
      if (depth !== 0 || end !== ';' || !head) {
        decls.push(st + (end || ''));
        return;
      }
      const type = head[1];
      const parts = splitDeclarators(head[2]);
      const made = [];
      for (const p of parts) {
        const one = p.trim();
        if (!one) continue;
        /* Dizi bildirimi (`arr[4] = ...`) olduğu gibi bırakılıyor: adı
           bölmek indeksi bozar, hoist da gerekmiyor. */
        const dm = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/.exec(one);
        if (dm) { made.push({ name: dm[1], init: dm[2].trim() }); continue; }
        const nm = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(one);
        if (nm) { made.push({ name: nm[1], init: '' }); continue; }
        made.length = 0;               // tanımadığımız biçim: dokunma
        break;
      }
      if (!made.length) { decls.push(st + (end || '')); return; }
      /* ÇOKLU BİLDİRİM AYRIŞTIRILMAZSA: eskiden yalnız ilk ad bildiriliyor,
         kalanı prologue'a atama olarak düşüyordu — `float a = 1.0, b = q1;`
         b'yi "undeclared identifier" yapıyordu. */
      for (const v of made) {
        decls.push(type + ' ' + v.name + ';');
        if (v.init) prologue.push('  ' + v.name + ' = ' + v.init + ';');
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
    let t = rewriteText(s);
    t = renameShadowed(t, shadowedNames(t));
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
    /* Presetin kullandığı dönme matrisleri. Hepsi değil, yalnız geçenler
       bildiriliyor (gerekçe bildirim yerinde). */
    const rotUniforms = [];
    const rotSeen = new Set();
    const rotRe = /\brot_(?:s|d|f|vf|uf|rand)[1-4]\b/g;
    let rm;
    while ((rm = rotRe.exec(all)) !== null) {
      if (rotSeen.has(rm[0])) continue;
      rotSeen.add(rm[0]);
      rotUniforms.push(rm[0]);
    }
    /* Dönme hızları MilkDrop'un kaynağından ölçülmedi, sınıfa göre
       yaklaşıklandı; bu yüzden `soft`ta duruyor. */
    if (rotUniforms.length) soft.push('dönme matrisi yaklaşık: ' + rotUniforms.join(', '));

    /* SAMPLER PLANI — her YAZIM kendi uniform'unu alıyor, kanonik adı değil.

       MilkDrop aynı dokuyu farklı süzme/sarma ayarlarıyla ayrı adlarla
       sunuyor: `sampler_fw_main` süzülmüş+tekrarlı, `sampler_pc_main`
       noktasal+kenetli. Önceden ön ek soyuluyor ve hepsi TEK uniform'a
       bağlanıyordu.

       Ölçüm bunun ne kadar geniş olduğunu gösterdi: korpusun **%22,7'si**
       aynı dokuyu FARKLI ön eklerle okuyor — yani o presetler iki ayrı
       örnekleme yazıp ikisinde de aynı sonucu alıyordu. Tek başına
       `sampler_pw_main` 6.310 yerde geçiyor ve noktasal örnekleme
       istiyordu; süzülmüş olarak veriliyordu.

       Ölçülen üst sınır: bir preset en fazla ALTI ayrı birim istiyor
       (10.332 preset içinde üç tane). 0–9 yerleşiklerin sabit birimleri,
       10–15 buraya kalıyor; WebGL2'nin asgari garantisi olan 16 birime
       tam oturuyor. Çizim tarafı yine de sınırı çalışma anında sorup
       aşarsa kanonik birime düşüyor. */
    const samplerPlan = [];
    const planSeen = new Set();
    const userSeen = new Set();
    const re = /\bsampler_[A-Za-z0-9_]+/g;
    let m;
    while ((m = re.exec(all)) !== null) {
      const name = m[0];
      if (planSeen.has(name)) continue;
      planSeen.add(name);
      const canon = canonSampler(name);
      const user = KNOWN_SAMPLERS.indexOf(canon) < 0;
      /* Bilinmeyen dokular: preset kendi resim dosyasını istiyor. Kullanıcı
         bir doku paketi göstermediyse yerine gürültü bağlanıyor — shader'ı
         hiç koşturmamak yerine, çünkü presetin blur zinciri, q ile sürülen
         renk matematiği ve geri kalan her satırı çalışmaya devam ediyor.
         Desen yanlış, yapı doğru — ve bu `soft`ta yazılı olduğu için
         görünür. */
      if (user && !userSeen.has(canon)) {
        userSeen.add(canon);
        soft.push('doku yerine gürültü: ' + canon);
        extraSamplers.push(canon);
      }
      const pm = SAMPLER_PREFIX.exec(name);
      // Ön eksiz yerleşik: kendi sabit birimini kullanıyor, plana girmiyor.
      if (!pm && !user) continue;
      samplerPlan.push({
        name,
        canon,
        /* Ön ekin ilk harfi süzme (p=noktasal, f=süzülmüş), ikincisi sarma
           (w=tekrarlı, c=kenetli). Ön ek yoksa MilkDrop'un varsayılanı:
           süzülmüş + tekrarlı. */
        filter: pm ? (pm[1][0] === 'p' ? 'nearest' : 'linear') : 'linear',
        wrap: pm ? (pm[1][1] === 'w' ? 'repeat' : 'clamp') : 'repeat',
        user,
      });
    }

    /* KULLANICI DOKUSUNUN BOYUTU (`texsize_<ad>`).

       MilkDrop presetin kendi satırını bağlıyor; presetler de tam olarak
       böyle yazıyor — gerçek koddan:
         `float4 texsize_lichen;   // auto-binds; .xy = (w,h); .zw = (1/w,1/h)`

       Bizde bu satır sıradan bir global kalıyordu, yani değeri SIFIRDI.
       Ölçüldü: korpusta `texsize_lichen` 74 yerde, toplam ~180 kullanıcı
       dokusu boyutu okuması var. Sıfırla bölen ya da sıfırla ölçekleyen bir
       preset hata vermiyor, sessizce yanlış çiziyor — derleme ölçümü de bunu
       göremiyor, çünkü bildirim geçerli GLSL.

       Presetin kendi bildirimi siliniyor ve yerine uniform konuyor: kalırsa
       uniform'u gölgeleyen bir global olur ve değer yine sıfır kalırdı. */
    const texSizeNames = [];
    for (const p of samplerPlan) {
      if (!p.user) continue;
      const nm = 'texsize_' + p.canon.slice('sampler_'.length);
      if (texSizeNames.indexOf(nm) >= 0) continue;
      if (!new RegExp('\\b' + nm + '\\b').test(all)) continue;
      texSizeNames.push(nm);
    }

    const pair = [parts.globals ? rewriteText(parts.globals) : '', rewriteText(parts.body)];
    if (texSizeNames.length) {
      const dropDecl = new RegExp(
        '\\b(?:vec4|vec3|vec2|float)\\s+(?:' + texSizeNames.join('|') + ')\\s*;', 'g');
      pair[0] = pair[0].replace(dropDecl, '');
      pair[1] = pair[1].replace(dropDecl, '');
    }
    /* Dizi indeksleri iki parça BİRLİKTE bilinerek sarılıyor: bildirim
       globals'ta, kullanım gövdede olabiliyor. Zaten sarılmış olan yeniden
       sarılmaz (arrayIndex `int(` görürse dokunmuyor). */
    /* Gölgelenen yerleşik adlar İKİ BÖLÜM BİRLİKTE taranarak bulunuyor:
       bildirim globals'ta, kullanım gövdede olabiliyor. Bölüm başına karar
       verilince globals'taki bildirim değişip gövdedeki kullanım olduğu gibi
       kalıyor ve ad "undeclared identifier" oluyordu — ölçüm bunu 50 yeni
       hata olarak gösterdi. */
    const shadow = shadowedNames(pair[0] + '\n' + pair[1]);
    if (shadow.length) {
      pair[0] = renameShadowed(pair[0], shadow);
      pair[1] = renameShadowed(pair[1], shadow);
    }
    /* Preset fonksiyonlarının imzaları da İKİ BÖLÜM BİRLİKTE toplanıyor:
       tanım globals'ta, çağrı gövdede. */
    const sigs = userFnSigs(pair[0] + '\n' + pair[1]);
    if (sigs.size) {
      pair[0] = coerceUserReturns(coerceUserCalls(pair[0], sigs), sigs);
      pair[1] = coerceUserReturns(coerceUserCalls(pair[1], sigs), sigs);
    }
    const arrays = arrayNames(pair[0] + '\n' + pair[1]);
    if (arrays.length) {
      pair[0] = arrayIndex(pair[0], arrays);
      pair[1] = arrayIndex(pair[1], arrays);
    }
    const alias = aliasWrittenUniforms(pair);
    const gRaw = pair[0];
    const bRaw = pair[1];
    const types = typesOf(gRaw + '\n' + bRaw);
    /* Çakışmada DIŞ bölümün bildirimi taban alınıyor: gövde aynı adı yeniden
       bildirirse coerce onu gördüğü yerden itibaren zaten geçerli kılıyor.
       Önceden taranan çizelgede gövdenin kazanması, gövdedeki DAHA ÖNCEKİ
       atamaları yanlış tiple sarıyordu. */
    if (gRaw) for (const [k, v] of typesOf(gRaw)) if (!BUILTIN_TYPES.has(k)) types.set(k, v);
    /* Takma adın tipi çizelgeye elle giriyor: bildirimi metinde değil `mid`
       içinde duruyor, dolayısıyla typesOf onu göremez. Görmezse atamanın sağ
       tarafı kırpılmıyor ve `rand_preset_w = vec4(...)` "dimension mismatch"
       veriyor — uniform hatasını çözerken bir sonraki hataya çarpmak. */
    for (const d of alias.decls) {
      const g = /^(\w+)\s+(\w+);$/.exec(d);
      if (g) types.set(g[2], g[1]);
    }
    /* Kullanıcı dokusu boyutları da çizelgeye elle giriyor: bildirimlerini
       az önce sildik, dolayısıyla typesOf onları göremez. Görmezse
       `uv * texsize_lichen.zw` gibi bir ifadede daraltma yapılmaz. */
    for (const n of texSizeNames) types.set(n, 'vec4');
    const hoisted = gRaw ? hoistGlobals(boolConds(coerce(gRaw, types), types)) : { decls: '', prologue: [] };
    const body = boolConds(coerce(bRaw, types), types);

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
    /* `vBlend` PRESET GEÇİŞİNİN düğüm başına alfası (#560, madde 4).
       MilkDrop geçiş sırasında iki preseti aynı ağ üzerinde ÜST ÜSTE
       çiziyor ve hangi pikselde hangisinin görüneceğini bu alfa
       söylüyor. Geçiş yokken 1, yani çıkış tümüyle mat.

       İki aşamada da var: warp ağdan, comp da aynı ağın düğümlerinden
       alıyor. Yalnız warp'a koymak geçişi yarım bırakırdı — birleştirme
       shader'ı taşıyan preset (%85'i) yine sert kesilirdi. */
    const ins = stage === 'warp'
      ? ['in vec2 vUV;', 'in vec2 vUVOrig;', 'in float vRad;', 'in float vAng;',
        'in float vBlend;', '']
      : ['in vec2 vUV;', 'in float vBlend;', ''];
    /* Plandaki her yazım kendi uniform'u olarak bildiriliyor. Yerleşiklerin
       ön eksiz hâlleri PREAMBLE'da zaten var; burada yalnız türevler ve
       kullanıcı dokuları çıkıyor. */
    const decl = samplerPlan
      .map((p) => 'uniform ' + (VOLUME_SAMPLERS.indexOf(p.canon) >= 0 ? 'sampler3D' : 'sampler2D') +
        ' ' + p.name + ';')
      .concat(texSizeNames.map((n) => 'uniform vec4 ' + n + ';'));
    /* DÖNME MATRİSLERİ (rot_s/d/f/vf/uf/rand 1..4).

       MilkDrop bunları `float4x3` olarak veriyor: üç satır bir dönme
       matrisi, dördüncü satır rastgele bir öteleme. Presetler neredeyse
       yalnız SATIR olarak okuyor — `rot_d1[1].x` gibi, yumuşak değişen bir
       rastgele sayı kaynağı olarak.

       Bu yüzden matris değil `vec3[4]` bildiriliyor: GLSL'de `m[i]` bir
       SÜTUN verir, HLSL'de ise satır. mat3x4 bildirmek shader'ı derletirdi
       ama `[1].x` başka bir bileşeni okur ve hata vermez — sessizce yanlış
       görüntü. Dizi biçiminde indeksleme HLSL ile birebir aynı.

       Yalnız KULLANILAN adlar bildiriliyor: yirmi dördünü birden bildirmek
       96 vec3 uniform demek ve WebGL2'nin alt sınırına (224 vektör)
       tehlikeli biçimde yaklaşıyor — düşük seviyeli bir GPU'da HİÇBİR
       preset derlenmezdi. */
    const rotDecl = rotUniforms.map((n) => 'uniform vec3 ' + n + '[4];');
    const head = PREAMBLE
      .concat(ins)
      .concat(decl, decl.length ? [''] : [])
      .concat(rotDecl, rotDecl.length ? [''] : [])
      .concat(globalDecls(), HELPERS, ['']);
    const mid = alias.decls.concat(alias.decls.length ? [''] : [])
      .concat(hoisted.decls ? hoisted.decls.split('\n').concat(['']) : []);
    const main = ['void main() {']
      .concat(qAssigns(), stage === 'warp' ? [
        '  uv = vUV;',
        '  uv_orig = vUVOrig;',
        '  rad = vRad;',
        '  ang = vAng;',
        '  hue_shader = hueAt(uv);',
        '  ret = vec3(0.0);',
        '',
      ] : [
        '  uv = vUV;',
        '  uv_orig = vUV;',
        /* rad/ang MilkDrop'ta merkeze göre kutupsal koordinat. En-boy
           düzeltmesi uygulanıyor, yoksa geniş ekranda çemberler elips olur. */
        '  rad = length((uv - 0.5) * aspect.xy) * 2.0;',
        '  ang = atan(uv.y - 0.5, uv.x - 0.5);',
        '  hue_shader = hueAt(uv);',
        '  ret = vec3(0.0);',
        '',
      ])
      // presetin küresel ilk değerleri: uniform okuyabilsinler diye burada
      /* Uniform kopyaları her şeyden önce tohumlanmalı: hem presetin kendi
         globalleri hem de gövde onları okuyabiliyor. */
      .concat(alias.seed, alias.seed.length ? [''] : [])
      .concat(hoisted.prologue, hoisted.prologue.length ? [''] : [])
      .concat(body.split('\n').map((l) => '  ' + l))
      .concat(['', /* Çıkış KIRPILIYOR. MilkDrop'un tamponları tamsayı ve 0..1 aralığında
         doyuyor; presetler bu doyuma güvenerek `ret *= 5` gibi satırlar
         yazıyor. Bizde tampon yarım kayan noktaya geçince o doyum ortadan
         kalktı ve değerler geri besleme döngüsünde sınırsız büyüyüp ekranı
         tek renge boğdu. Kırpma, kayan noktanın ince adımlarını korurken
         taşmayı geri engelliyor. */
      /* ALFA düğümden geliyor, sabit 1'den değil: preset geçişinde iki
         preset aynı hedefin üstüne çiziliyor ve karışımı bu alfa
         sürüyor. Geçiş yokken düğümlerin hepsi 1 taşıyor, yani sonuç
         eskisiyle birebir aynı. */
      '  outColor = vec4(clamp(ret, 0.0, 1.0), vBlend);', '}']);

    return {
      glsl: head.concat(mid, main).join('\n'),
      hard,
      soft,
      /* `extraSamplers` YALNIZ bildirim amaçlı: hangi kullanıcı dokularının
         istendiğini söylüyor (panel notu, ölçüm sayacı). Bağlama tümüyle
         `samplerPlan` üzerinden — orada aynı dokular `user: true` ile
         zaten var, üstelik yazımları ve süzme ayarlarıyla birlikte. İkisi
         de bağlasaydı hangisinin yetkili olduğu belirsiz kalırdı. */
      extraSamplers,
      samplerPlan,
      texSizeNames,
      rotUniforms,
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
