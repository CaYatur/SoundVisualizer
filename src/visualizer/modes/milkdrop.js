'use strict';
/* MilkDrop motoru — warp ağı, preset shader'ları, blur zinciri ve birleştirme.

   src/shared/milkdrop.js preset DİLİNİ çalıştırıyor, src/shared/milkdrop-shader.js
   preset SHADER'LARINI GLSL'e çeviriyor; burada ikisi gerçek piksellere
   dönüşüyor.

   MilkDrop'un kare sırası — sıra önemli, başka bir sırada aynı preset
   bambaşka görünür:

     1. `per_frame` bir kez koşar: kare geneli hareket (zoom, rot, warp, dx...).
     2. `per_pixel` warp ağının HER DÜĞÜMÜNDE koşar; düğümün bir önceki
        kareden nereyi örnekleyeceği çıkar.
     3. WARP GEÇİŞİ: önceki kare bu bozuk ağdan geçirilir. Preset bir warp
        shader'ı taşıyorsa renk oradan gelir; taşımıyorsa sabit yol yalnızca
        karartma (decay) uygular.
     4. Dalga formu ve çizimler bu tamponun üstüne gider.
     5. BLUR ZİNCİRİ: tampondan üç kademe bulanık kopya üretilir.
     6. COMP GEÇİŞİ: tam ekran. Preset comp shader'ı varsa son görüntüyü o
        belirler; yoksa sabit yol gama, parlaklık ve video echo uygular.

   Görüntünün "akması" 3. adımdaki geri beslemeden geliyor: her kare bir
   öncekinin hafif bozulmuş hali ve bozulma birikiyor. Bu yüzden iki doku
   arasında gidip geliniyor (ping-pong) — bir dokudan okurken aynı dokuya
   yazmak tanımsız davranıştır.

   NEDEN BLUR ZİNCİRİ AYRI BİR MASRAF: korpusun %71,3'ü `GetBlur1..3`
   çağırıyor. Bunlar fonksiyon değil, ayrı ayrı bulanıklaştırılmış DOKULAR.
   Bağlanmadıklarında shader hatasız derleniyor ama siyah örnekliyor —
   yani preset "çalışıyor" görünüp bambaşka bir görüntü veriyor. */
(function () {
  /* MilkDrop presetlerinin yazildigi referans kare hizi. decay gibi kare
     basina uygulanan sayilar buna gore olcekleniyor. */
  const REF_FPS = 30;

  /* Warp ağının sıklığı. MilkDrop'un varsayılanı 32x24, "yüksek kalite"
     ayarı 48x36. Ağ seyrek olduğunda bozulma düğümler arasında doğrusal
     interpolasyonla dolduruluyor ve kıvrımlı warp'larda köşeli görünüyor.
     64x48 bunu gözle görülür biçimde düzeltiyor; maliyeti per_pixel'in
     düğüm sayısı kadar artması. */
  const MESH_X_DEFAULT = 64;
  const MESH_Y_DEFAULT = 48;
  /* Ayardan gelebilecek ag sıklıkları. MilkDrop'un kendi listesi de
     boyle: en-boy 4:3 sabit, yalnız yogunluk degisiyor. */
  const MESH_STEPS = [24, 32, 48, 64, 96, 128];
  /* düğüm başına: aPos(2) aUV(2) aUVOrig(2) aRad(1) aAng(1) aBlend(1)
     `aBlend` preset geçişinin düğüm başına alfası; geçiş yokken 1. */
  const VSTRIDE = 9;

  /* PRESET GEÇİŞİNİN ÜST SINIRI. MilkDrop'un kendi varsayılanları 1,7 sn
     (kullanıcı değiştirdiğinde) ve 2,7 sn (kendi kendine geçtiğinde); ini
     dosyasından daha uzunu da verilebiliyor. 5 sn hem o aralığı kapsıyor
     hem de geçiş boyunca İKİ presetin denklemleri koştuğu için ödenen
     bedeli sınırlıyor. */
  const BLEND_MAX = 5;

  /* GEÇİŞTE SAYISAL OLARAK KARIŞTIRILAN kare değişkenleri.

     MilkDrop geçişte iki presetin per_frame'ini de koşturuyor, sonra
     PİKSEL HAREKETİNİ ETKİLEMEYEN her değişkeni kosinüs eğrisiyle
     karıştırıp yeni presetin havuzuna yazıyor. Hareketi etkileyenler
     (zoom, rot, cx, dx, sx, warp...) burada YOK: onlar iki ayrı UV ağı
     üretiyor ve karışım ağ düzeyinde oluyor — sayıları karıştırmak
     bambaşka bir hareket verirdi.

     Liste MilkDrop'un kendi gövdesinden alındı (`RunPerFrameEquations`).
     Havuzdaki adları bizimkiler: blur aralıkları b1n/b1x, kenar karartma
     b1ed. */
  const BLEND_LERP = [
    'decay', 'wave_a', 'wave_r', 'wave_g', 'wave_b', 'wave_x', 'wave_y',
    'wave_mystery',
    'ob_size', 'ob_r', 'ob_g', 'ob_b', 'ob_a',
    'ib_size', 'ib_r', 'ib_g', 'ib_b', 'ib_a',
    'mv_x', 'mv_y', 'mv_dx', 'mv_dy', 'mv_l', 'mv_r', 'mv_g', 'mv_b', 'mv_a',
    'echo_zoom', 'echo_alpha', 'gamma',
    'b1n', 'b2n', 'b3n', 'b1x', 'b2x', 'b3x', 'b1ed',
  ];

  /* GEÇİŞTE ATLAYAN değişkenler: mantıksal ya da tam sayı oldukları için
     ara değerleri anlamsız. Yarı yolda (`snap`) eskiden yeniye geçiyorlar.
     `wave_mode` MilkDrop'ta listede hiç yok — ne karışıyor ne atlıyor,
     doğrudan yeni presetinki geçerli. */
  const BLEND_SNAP = [
    'echo_orient', 'wave_usedots', 'wave_thick', 'wave_additive',
    'wave_brighten', 'darken_center', 'wrap', 'invert', 'brighten',
    'darken', 'solarize',
  ];

  /* Ağ vertex shader'ı. Konumlar layout(location=) ile sabitlendi: aynı VAO
     hem sabit yolun hem de presetin derlenmiş warp programının altında
     kullanılıyor ve öznitelik konumları programdan programa kaymamalı. */
  const MESH_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in vec2 aUVOrig;
layout(location=3) in float aRad;
layout(location=4) in float aAng;
layout(location=5) in float aBlend;
out vec2 vUV;
out vec2 vUVOrig;
out float vRad;
out float vAng;
out float vBlend;
void main(){
  vUV = aUV;
  vUVOrig = aUVOrig;
  vRad = aRad;
  vAng = aAng;
  vBlend = aBlend;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

  /* BIRLESTIRME AGI (#560, madde 4).

     Birlestirme gecisi eskiden tek bir tam ekran ucgeniydi. Preset gecisi
     icin ekranin FARKLI YERLERINDE farkli bir karisim orani gerekiyor ve
     tek ucgende dugum basina degisen bir deger tasinamiyor.

     Ag WARP AGININ TA KENDISI: ayni VAO, ayni tampon, ayni dizin — yeni
     bir tampon yok. Fark yalnizca hangi ozniteligin ne anlama geldigi:
     burada konum icin bozulmamis koordinat (`aUVOrig`) kullaniliyor, yani
     ekran uzayinda duz bir izgara. MilkDrop da birlestirmeyi 32x24'luk bir
     izgara uzerinde ciziyor ve gecis alfasini warp agindan iki dogrusal
     ara degerle okuyor; ayni agi kullanmak o ara degerlemeyi tumden
     gereksiz kiliyor — alfa zaten dugumun kendisinde. */
  const COMP_MESH_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
layout(location=2) in vec2 aUVOrig;
layout(location=5) in float aBlend;
out vec2 vUV;
out float vBlend;
void main(){
  vUV = aUVOrig;
  vBlend = aBlend;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

  // Sabit warp yolu: preset shader taşımıyorsa (MD1 presetleri) yalnızca karartma
  const WARP_FIXED_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
in vec2 vUVOrig;
in float vRad;
in float vAng;
in float vBlend;
out vec4 outColor;
uniform sampler2D uPrev;
uniform float uDecay;
void main(){
  outColor = vec4(texture(uPrev, vUV).rgb * uDecay, vBlend);
}`;

  const QUAD_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vUV;
void main(){
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

  /* FLAŞ SINIRLAMA — nöbet riski taşıyan yanıp sönmeyi kesmek.

     MilkDrop'ta yok; bilinçli bir ekleme. projectM'in #947 ve #742'si aynı
     şeyi yıllardır açık tutuyor ve hiçbir motor çözmüş değil. Korpusta
     "Definitly Not For The Epileptic" ve "Seizure-Inducing ... RMX" gibi
     adlar var; yazarları ne yaptıklarını biliyor, izleyen herkes bilmiyor.

     ÖLÇÜT WCAG 2.3.1'in "genel flaş" tanımı: BAĞIL PARLAKLIKTA (BT.709)
     saniyede üçten fazla ve 0,10'dan büyük değişim. Eşiği tahminle değil
     ölçerek seçtik — 70 presetlik tohumlu kesitte kare arası en büyük
     ortalama parlaklık sıçraması:

         %71,4'ü 0,02 altında      %90,0'ı 0,10 ALTINDA
         %4,3'ü 0,10-0,20          %5,8'i 0,20 üstünde
         %7,1'i saniyede 3+ kez 0,10'u aşıyor  <- hedef bunlar

     Yani 0,10 eşiği presetlerin onda dokuzuna hiç dokunmuyor; devreye
     yalnızca bir standardın "riskli" dediği yerde giriyor. Varsayılanın
     açık olma sebebi bu: bedeli neredeyse yok, kazancı erişilebilirlik.

     NASIL: gösterilecek karenin ORTALAMA parlaklığının bir öncekine göre
     değişimi eşiği aşarsa, kare bir öncekine doğru harmanlanıyor —
     `k = eşik / değişim`. Değişim eşiğin altındaysa `k = 1`, yani görüntü
     bit birebir aynı geçiyor. Kırpma değil ORANLAMA: eşiği ikiye katlayan
     bir flaş yarı yarıya, on kat aşan bir flaş onda bir geçiyor.

     Ortalama dokunun MIPMAP zincirinin en küçük kademesinden okunuyor:
     donanımın kendi kutu süzgeci, yani gerçek ortalama. Küçük bir kopyaya
     tek geçişte indirmek daha ucuz görünüyor ama doğrusal süzme yalnız
     2x2 ortalıyor, yani 1024 dağınık örnek — ortalamayı yüzde birkaç
     gürültüyle veriyor ve eşiğin etrafında sınırlayıcıyı yanlış
     tetikleyebiliyor. Tam boy mipmap tam ekran dolgunun üçte biri kadar;
     zaten yalnızca özellik açıkken üretiliyor. */
  const FLASH_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uCur;
uniform sampler2D uPrev;
uniform float uThresh;
in vec2 vUV;
out vec4 outColor;
float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main(){
  vec3 cur = texture(uCur, vUV).rgb;
  vec3 prv = texture(uPrev, vUV).rgb;
  /* En küçük mipmap kademesi = bütün karenin ortalaması. Kademe numarası
     bilerek fazla büyük: GLSL onu var olan en küçüğe kenetliyor, yani
     küçük kopyanın boyutu değişse de bu satır doğru kalıyor. */
  float mCur = lum(textureLod(uCur, vec2(0.5), 24.0).rgb);
  float mPrv = lum(textureLod(uPrev, vec2(0.5), 24.0).rgb);
  float d = abs(mCur - mPrv);
  float k = d > uThresh ? uThresh / d : 1.0;
  outColor = vec4(mix(prv, cur, k), 1.0);
}`;

  /* Sabit birleştirme yolu. MilkDrop'ta fGammaAdj bir ÜS değil ÇARPAN:
     preset yazarları 1.6 gibi değerleri görüntüyü parlatmak için koyuyor.
     Eskiden burada pow(c, 1/gamma) vardı; parlatıyordu ama eğrisi başkaydı
     ve koyu tonları presetin istemediği kadar açıyordu. */
  const COMP_FIXED_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
in float vBlend;
out vec4 outColor;
uniform sampler2D uSrc;
uniform float uGamma;
uniform float uEchoAlpha;
uniform float uEchoZoom;
uniform int uEchoOrient;
uniform vec4 uFx;          // brighten, darken, solarize, invert
void main(){
  vec3 c = texture(uSrc, vUV).rgb;
  if (uEchoAlpha > 0.001) {
    vec2 e = (vUV - 0.5) / max(0.001, uEchoZoom) + 0.5;
    if (uEchoOrient == 1 || uEchoOrient == 3) e.x = 1.0 - e.x;
    if (uEchoOrient == 2 || uEchoOrient == 3) e.y = 1.0 - e.y;
    c = mix(c, texture(uSrc, e).rgb, uEchoAlpha);
  }
  c *= uGamma;
  c = clamp(c, 0.0, 1.0);
  /* MilkDrop'un MD1 donemi sabit efektleri. Bunlar shader'dan onceki
     surumlerden kalma ama eski presetlerin cogu hala kullaniyor; yoklugunda
     o presetler yazarinin istedigi kontrasti hic gostermiyordu. */
  if (uFx.x > 0.5) c = sqrt(c);
  if (uFx.y > 0.5) c = c * c;
  if (uFx.z > 0.5) c = c * (1.0 - c) * 4.0;
  if (uFx.w > 0.5) c = 1.0 - c;
  outColor = vec4(clamp(c, 0.0, 1.0), vBlend);
}`;

  // Ayrılabilir Gauss: yatay ve dikey iki geçiş, doğrusal örneklemeli 5 vuruş
  /* BULANIKLIK CEKIRDEGI ARTIK UNIFORM.

     Once burada sabit bes tapli dar bir Gauss vardi. MilkDrop'un cekirdegi
     hem daha genis hem de yatay/dikey gecislerde FARKLI: yatay dort cift
     tap, dikey iki cift. Cekirdegi uniform'a tasimak iki seyi birden
     cozuyor — gecise gore farkli tap kullanabiliyoruz ve "MilkDrop uyumu"
     anahtari shader'i degil yalnizca DEGERLERI degistiriyor.

     `uScale`/`uBias` presetin b1n/b1x araligini dokuya sigdiriyor; okurken
     `GetBlurN` ayni araligi geri aciyor. Tek gecise (dikey) uygulaniyor:
     olcekleme dogrusal oldugu icin bulaniklikla yer degistirebiliyor ve
     ara sonucu kirpmadan gecmek daha az bilgi kaybediyor. */
  const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uSrc;
uniform vec2 uStep;
uniform vec4 uW;         // dort cift tapin agirligi
uniform vec4 uD;         // dort cift tapin uzakligi (kaynak teksel)
uniform float uCenter;   // merkez tapin agirligi (MilkDrop'ta 0)
uniform float uNorm;     // toplami 1'e getiren bolen
uniform float uScale;
uniform float uBias;
uniform vec3 uEdge;      // kenar karartma: (1-b1ed, b1ed, 5.0); kapaliyken (1,0,5)
void main(){
  vec3 c = texture(uSrc, vUV).rgb * uCenter;
  for (int i = 0; i < 4; i++) {
    vec2 o = uStep * uD[i];
    c += (texture(uSrc, vUV + o).rgb + texture(uSrc, vUV - o).rgb) * uW[i];
  }
  /* KENAR KARARTMA. Bulaniklik kenarda kendi disindan ornek almak
     zorunda ve orada kenetlenmis teksel duruyor: kenar cizgisi
     oldugundan parlak cikiyor ve bir kare parlar. MilkDrop kenara olan
     uzakligin KAREKOKUYLE soneen bir carpan uyguluyor — karekok
     karartmayi kenara sikistiriyor, dogrusal bir egri butun kareyi
     karartirdi. uEdge.z (5,0) karartmanin ne kadar ice girdigini
     belirliyor: t*5 birden buyukse carpan 1 kaliyor. */
  float e = min(min(vUV.x, vUV.y), 1.0 - max(vUV.x, vUV.y));
  e = sqrt(max(e, 0.0));
  e = uEdge.x + uEdge.y * clamp(e * uEdge.z, 0.0, 1.0);
  outColor = vec4((c * uNorm * uScale + uBias) * e, 1.0);
}`;

  /* MilkDrop'un sekiz agirlikli simetrik cekirdegi, cift cift toplanmis.

     Neden cift: iki komsu teksel tek bir dogrusal-suzulmus okumayla
     alinabiliyor; uzaklik agirlik oraniyla kayiyor. Sekiz agirlik dort
     okumaya iniyor, sonuc ayni.

     Yatay gecis dort cifti de kullaniyor, dikey iki cifti — MilkDrop'ta da
     oyle. Ikisinin boleni ayni sayiya cikiyor (0,5/18,3 = 1/36,6); bu bir
     rastlanti degil, ayni agirlik toplaminin iki farkli gruplanmasi. */
  const BLUR_KERNEL = (() => {
    const w = [4.0, 3.8, 3.5, 2.9, 1.9, 1.2, 0.7, 0.3];
    const pair = (a, b) => w[a] + w[b];
    const hW = [pair(0, 1), pair(2, 3), pair(4, 5), pair(6, 7)];
    const hD = [
      0 + (2 * w[1]) / hW[0],
      2 + (2 * w[3]) / hW[1],
      4 + (2 * w[5]) / hW[2],
      6 + (2 * w[7]) / hW[3],
    ];
    const v1 = w[0] + w[1] + w[2] + w[3];
    const v2 = w[4] + w[5] + w[6] + w[7];
    return {
      h: {
        w: hW, d: hD, center: 0,
        norm: 0.5 / (hW[0] + hW[1] + hW[2] + hW[3]),
      },
      v: {
        w: [v1, v2, 0, 0],
        d: [0 + (2 * (w[2] + w[3])) / v1, 2 + (2 * (w[6] + w[7])) / v2, 0, 0],
        center: 0,
        norm: 1 / ((v1 + v2) * 2),
      },
      /* Motorun onceki dar Gauss'u, ayni bicimde yazilmis. Anahtar
         kapaliyken iki gecis de bunu kullaniyor — eskiden de oyleydi. */
      legacy: {
        w: [0.3162162162, 0.0702702703, 0, 0],
        d: [1.3846153846, 3.2307692308, 0, 0],
        center: 0.2270270270,
        norm: 1,
      },
    };
  })();

  /* Bulanik kademelerin boyut oranlari. Her kademede yatay ve dikey gecis
     AYRI boyuta yaziyor: ilk kademede yatay yariya, dikey ceyrege iniyor.
     Bizde ikisi de yariydi, yani ilk kademe MilkDrop'un iki kati coz-
     unurlukte kaliyordu ve "bulanik" kopya yeterince bulanik degildi. */
  const BLUR_RATIOS = [[0.5, 0.25], [0.125, 0.125], [0.0625, 0.0625]];
  const BLUR_RATIOS_LEGACY = [[0.5, 0.5], [0.25, 0.25], [0.125, 0.125]];

  /* DALGA YUMUŞATMA — MilkDrop'un `SmoothWave`i (milkdropfs.cpp:2341).

     Çizmeden hemen önce dalgayı bir kez daha örnekliyor: ardışık her nokta
     çiftinin ARASINA bir nokta koyuyor, yani nokta sayısı ikiye katlanıyor.
     Ara noktanın yeri dört komşunun ağırlıklı ortalaması:

         (-0,15 · p[i-1] + 1,15 · p[i] + 1,15 · p[i+1] - 0,15 · p[i+2]) / 2

     Ağırlıklar toplamı 2, bölen de o. UÇLARDAKİ NEGATİF KATSAYILAR ÖNEMLİ:
     bu bir ortalama değil, hafif keskinleştiren bir interpolasyon —
     Catmull-Rom'un yaptığı gibi eğrinin virajını koruyor. Düz ortalama
     (0, 0,5, 0,5, 0) alsaydık dalga yumuşarken sönerdi.

     Motorda hiç yoktu: dalgaları presetin verdiği ham noktalarla
     çiziyorduk, bu yüzden kırık çizgi gibi görünüyorlardı. Korpusta 11.884
     etkin özel dalga bloğunun 7.798'i (%65,6) ve varsayılan dalga çizen
     4.654 preset (%45,0) etkileniyor.

     Uçlar KOPYALANIYOR, uzatılmıyor: `i_below` ilk noktada 0'da,
     `i_above2` son noktada n-1'de kilitleniyor. Kapalı bir çemberde bile
     MilkDrop sarmıyor — dalga modu 0'ın kendi harmanlaması o işi zaten
     yapıyor.

     Renk interpole EDİLMİYOR: ara nokta soldaki komşunun rengini aynen
     alıyor (`COPY_COLOR(vo[j+1], vi[i])`). Renk zaten nokta başına
     değişiyorsa bu bir kademe yaratıyor, ama MilkDrop'un yaptığı bu.

     `src` ve `dst` AYRI diziler olmalı — okuma ileriye bakıyor. */
  const SMOOTH_C = [-0.15, 1.15, 1.15, -0.15];
  /* 512 ham nokta -> 2*(512-1)+1 = 1023. Bölünmüş dalgada (mod 6-7) iki
     parça ayrı ayrı yumuşatılıyor ve toplam daha KÜÇÜK oluyor, yani bu
     sınır her durumu kapsıyor. */
  const SMOOTH_MAX = 1023;
  const SMOOTH_INV = 1 / (SMOOTH_C[0] + SMOOTH_C[1] + SMOOTH_C[2] + SMOOTH_C[3]);
  const VSTRIDE_LINE = 6;   // x, y, r, g, b, a
  function smoothWave(src, n, dst, srcOff, dstOff) {
    const S = VSTRIDE_LINE;
    const so = (srcOff || 0) * S, dof = (dstOff || 0) * S;
    if (n < 2) {
      for (let k = 0; k < n * S; k++) dst[dof + k] = src[so + k];
      return n;
    }
    const c1 = SMOOTH_C[0], c2 = SMOOTH_C[1], c3 = SMOOTH_C[2], c4 = SMOOTH_C[3];
    let j = 0, iBelow = 0;
    for (let i = 0; i < n - 1; i++) {
      const iAbove = i + 1;
      const iAbove2 = Math.min(n - 1, i + 2);
      const a = so + iBelow * S, b = so + i * S;
      const c = so + iAbove * S, e = so + iAbove2 * S;
      const o = dof + j * S;
      // Nokta i olduğu gibi
      for (let k = 0; k < S; k++) dst[o + k] = src[b + k];
      // Araya konan nokta: yer ağırlıklı, renk soldaki komşudan
      dst[o + S] = (c1 * src[a] + c2 * src[b] + c3 * src[c] + c4 * src[e]) * SMOOTH_INV;
      dst[o + S + 1] = (c1 * src[a + 1] + c2 * src[b + 1] +
        c3 * src[c + 1] + c4 * src[e + 1]) * SMOOTH_INV;
      for (let k = 2; k < S; k++) dst[o + S + k] = src[b + k];
      iBelow = i;
      j += 2;
    }
    const last = so + (n - 1) * S, o = dof + j * S;
    for (let k = 0; k < S; k++) dst[o + k] = src[last + k];
    return j + 1;
  }

  const LINE_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 aCol;
out vec4 vCol;
void main(){
  vCol = aCol;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

  const LINE_FRAG = `#version 300 es
precision highp float;
in vec4 vCol;
out vec4 outColor;
void main(){ outColor = vCol; }`;

  /* KENAR YUMUŞATMALI ÇİZGİ.

     `gl.LINE_STRIP` her sürücüde tek teksellik ve tırtıklı çiziyor;
     `lineWidth` WebGL'de çoğu sürücüde 1'e sabit. Motor bu yüzden çizgiyi
     kaydırılmış kopyalarıyla kalınlaştırıyordu — kalınlık oluyor ama kenar
     hâlâ merdiven, ve toplamalı karışımda her kopya bir kat daha ışık
     bırakıyor.

     Buradaki yol çizgiyi ŞERİT olarak çiziyor: her noktadan iki yana
     yarı-genişlik kadar açılmış bir üçgen şeridi, ve parça gölgelendirici
     merkez çizgiye olan uzaklığa göre kapsama hesaplıyor. Kenar bir teksel
     içinde sönüyor, yani gerçek kenar yumuşatma — çoklu örnekleme
     gerektirmeden, hedef tampon çok örneklemeli olmadığı için.

     `vSide` şeridin karşısında -1..+1. Uzaklık `|vSide| * uExt` teksel;
     kapsama `uHalf - uzaklık + 0,5` ile 0..1'e kenetleniyor.

     ŞERİT YARI GENİŞLİKTEN BİR TEKSEL DAHA GENİŞ (`uExt = uHalf + 1`) ve
     bu zorunlu: tam yarı genişlikte bitseydi kapsama kenarda 0,5'te sert
     kesilirdi — hem yumuşama olmazdı hem de bırakılan ışık eksik kalırdı.
     Bir teksellik pay yumuşamaya yer açıyor ve kapsamanın integralini tam
     `2 * uHalf` yapıyor, ki ışık koruma hesabı buna dayanıyor.

     Yarı genişlik 0,5'in altına inemiyor: inseydi çizgi tamamen
     kaybolurdu, oysa MilkDrop'un tek tekselllik çizgisi de en az bir
     teksel bırakıyor.

     `uGain` IŞIK KORUMA çarpanı. Eski yol N kez çizip N kat ışık
     bırakıyordu; şerit ise genişliği kadar bırakıyor. İkisini eşitlemek
     için gölgelendirici alfayı `N / genişlik` ile çarpıyor. Bu olmadan
     dalga taşıyan her preset gözle görülür biçimde sönerdi.

     Toplamalı karışımda alfa 1'i AŞABİLİYOR ve aşmalı: hedef yarı kayan
     nokta, `SRC_ALPHA, ONE` de kenetlemiyor. Saydam karışımda ise 1'i
     aşan alfa `ONE_MINUS_SRC_ALPHA`yı negatife düşürüp altındaki
     görüntüyü çıkarırdı, o yüzden orada kenetleniyor — `uMax` bu iki
     durumu ayırıyor. */
  /* Işık koruma katsayısının ölçülmüş düzeltmesi. Gerekçesi ve ölçüm
     sayıları `_aaStrip` içinde, kullanıldığı yerde. */
  const AA_TRIM = 0.86;

  /* Flaş eşiği: WCAG 2.3.1'in "genel flaş" ölçütü, bağıl parlaklıkta 0,10.
     Ölçüm ve gerekçe FLASH_FRAG'in yanında. */
  const FLASH_THRESH = 0.10;

  const AALINE_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
layout(location=1) in float aSide;
layout(location=2) in vec4 aCol;
out float vSide;
out vec4 vCol;
void main(){
  vSide = aSide;
  vCol = aCol;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

  const AALINE_FRAG = `#version 300 es
precision highp float;
uniform float uHalf;
uniform float uExt;
uniform float uGain;
uniform float uMax;
in float vSide;
in vec4 vCol;
out vec4 outColor;
void main(){
  float d = abs(vSide) * uExt;
  float cov = clamp(uHalf - d + 0.5, 0.0, 1.0);
  float a = vCol.a * cov * uGain;
  outColor = vec4(vCol.rgb, clamp(a, 0.0, uMax));
}`;

  /* DOKULU ŞEKİLLER (shapecode_N_textured=1).

     Presetlerin %40,3'ü kullanıyor ve %12,1'inde şekil ekranı kaplayacak
     kadar büyük. Dokusuz çizmek bu şekilleri DÜZ RENK bir dörtgene
     çeviriyordu: rengi çoğunlukla beyaz olduğu için ekran bembeyaz
     kalıyordu ve ölçümde "patlamış" sınıfının tamamı buydu.

     MilkDrop şekli önceki karenin üstünde bir PENCERE gibi kullanıyor:
     merkez dokunun ortasına, yarıçap da tex_zoom'a göre ölçeklenmiş bir
     yarıçapa denk geliyor; tex_ang örneklemeyi döndürüyor. Sonuç şeklin
     kendi rengiyle çarpılıyor. */
  /* PRESET GECISI (#560, madde 4) — MilkDrop'un CIFT BORU HATTI.

     Preset degistiginde eski preset olmuyor: nesnesi, derlenmis warp ve
     birlestirme shader'lari ve kendi saati gecis boyunca yasiyor. Her
     karede IKI presetin de per_frame'i ve per_vertex'i kosuyor, iki UV
     agi cikiyor ve o agi dugum basina bir rampayla karistiriliyor. Ayni
     rampa dugumun ALFASI oluyor; iki presetin shader'lari ayni hedefe
     ust uste, o alfayla ciziliyor.

     ONEMLI OLAN NE DEGIL: ikinci bir geri besleme tamponu ve ikinci bir
     bulaniklik zinciri. Buradaki eski not "cift boru hatti iki hedef
     cifti ve iki blur zinciri demek" diyordu — kaynak bunun tersini
     soyluyor, MilkDrop'ta tampon TEK. Gecisde iki olan sey denklemler ve
     shader'lar.

     Eskiden burada donmus bir kare vardi: onceki presetin son goruntusu
     bir dokuya alinip ustune soluyordu. Kisa gecislerde ayirt edilmiyordu
     ama uzun gecislerde eski goruntu duruyordu, cunku gercekten duruyordu.

     Uc ayri egri var: sayisal degiskenler kosinus, ag ve alfa HAM
     ilerleme, sekil/dalga alfa carpani da ham ilerleme. */
  const SHAPE_TEX_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 aCol;
layout(location=2) in vec2 aUV;
out vec4 vCol;
out vec2 vUV;
void main(){
  vCol = aCol;
  vUV = aUV;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

  const SHAPE_TEX_FRAG = `#version 300 es
precision highp float;
in vec4 vCol;
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uSrc;
void main(){ outColor = texture(uSrc, vUV) * vCol; }`;

  /* Presetin shader'ına verilen değişkenler. Tek yerde duruyor çünkü hem
     konum önbelleği hem yükleme bu listeden türüyor; ikiye bölmek birinde
     unutulan bir adın sessizce sıfır kalmasına yol açardı. */
  /* PRESETİN GERÇEKTEN OKUDUĞU EN YÜKSEK BLUR KADEMESİ.

     MilkDrop bulanık kopyaların hepsini üretmiyor; yalnızca o karede bir
     shader'ın bağladığı en yüksek kademeye kadar gidiyor:

         int passes = std::min(NUM_BLUR_TEX, m_nHighestBlurTexUsedThisFrame * 2);

     (milkdropfs.cpp:1410. Kademe başına iki geçiş var — yatay ve dikey —
     `*2` oradan geliyor. Sayaç bir shader blur dokusu bağladığında
     yükseliyor (3695) ve `BlurPasses()` sonunda sıfırlanıyor (1568).)

     Biz üç kademenin altı geçişini her karede koşuyorduk. Korpusun
     %28,7'si hiç `GetBlur` okumuyor, yani onlarda altı geçişin altısı da
     boşa gidiyor; toplamda 62.082 geçişin 29.168'i (%47,0) gereksiz.

     ARAMA PRESETİN KENDİ METNİNDE, çevrilmiş GLSL'de değil: `GetBlur1..3`
     yardımcıları her zaman ön hazırlıkta duruyor, yani çıktıda
     `sampler_blur1` her preset için görünürdü ve eleme hiç devreye
     girmezdi. Doku adının kendisi de aranıyor çünkü preset `GetBlurN`
     yerine dokuyu doğrudan örnekleyebiliyor.

     KADEME KASKAT: 3'ü okuyan bir preset 1 ve 2'yi de üretmek zorunda,
     çünkü her kademe bir öncekinden türüyor. Bu yüzden dönen sayı EN
     YÜKSEK kademe ve o kademeye kadar hepsi üretiliyor — MilkDrop'un
     `highest * 2`si de tam olarak bunu söylüyor.

     ÖN EKLİ AD DA SAYILIYOR (`sampler_pw_blur3`): çeviri onu kanonik
     `sampler_blur3`e indirgiyor, yani doku gerçekten okunuyor. Korpusta
     hiç örneği yok ama kaçırmanın bedeli üretilmemiş bir kademeyi
     örneklemek, yani siyah — sessiz ve bulunması zor bir hata. */
  const BLUR_REF = /(?:getblur|sampler_(?:(?:fw|pw|fc|pc)_)?blur)([123])/gi;
  function blurLevelOf(text) {
    if (!text) return 0;
    let hi = 0, m;
    BLUR_REF.lastIndex = 0;
    while ((m = BLUR_REF.exec(text)) !== null) {
      const lv = +m[1];
      if (lv > hi) hi = lv;
    }
    return hi;
  }

  const SAMPLER_UNITS = [
    ['sampler_main', 0],
    ['sampler_blur1', 1],
    ['sampler_blur2', 2],
    ['sampler_blur3', 3],
    ['sampler_noise_lq', 4],
    ['sampler_noise_lq_lite', 5],
    ['sampler_noise_mq', 6],
    ['sampler_noise_hq', 7],
    ['sampler_noisevol_lq', 8],
    ['sampler_noisevol_hq', 9],
  ];

  class MilkdropMode {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.gl2 = document.createElement('canvas');
      this.gl = null;
      this.preset = null;
      this.presetKey = '';
      this.error = '';
      this.shaderNote = '';
      this.time = 0;
      this.frameNo = 0;
      this.presetTime = 0;
      this._pix = {};
      this._progCache = new Map();
      this.meshX = MESH_X_DEFAULT;
      this.meshY = MESH_Y_DEFAULT;
      /* Fare durumu (#560, madde 5). MilkDrop denklemlere mouse_x/mouse_y
         (0..1) ve mouse_down veriyor; preset yazarları etkilesimli sahneler
         icin kullanıyor. Korpustaki hazır presetlerin HICBIRI okumuyor,
         yani buradan gorunur bir kazanc gelmiyor; deger, kullanıcının KENDI
         yazdıgı presetlerde. */
      this.mouse = { x: 0.5, y: 0.5, down: 0 };
      this._mouseBound = false;
      /* PRESET GECISI. Eski preset kendi nesnesi, kendi shader'ları ve
         kendi saatiyle geçiş boyunca YAŞAMAYA devam ediyor; geri besleme
         tamponu ise TEK — MilkDrop'ta da öyle. */
      this.oldPreset = null;
      this.oldWarpPreset = null;
      this.oldCompPreset = null;
      this.oldRandPreset = null;
      this.oldTime = 0;
      this.oldPresetTime = 0;
      this.blendProg = 0;
      this.blendDur = 0;
      this.blendA = null;
      this.blendC = null;
      this.blendDirty = false;
    }

    /* Dinleyiciler TUVALE baglanıyor, pencereye degil: gorsellestirici
       tuvali tam ekran da olsa bir katman icinde de olabiliyor ve pencere
       koordinatı ikinci durumda yanlıs olurdu. */
    _bindMouse() {
      if (this._mouseBound || !this.canvas || !this.canvas.addEventListener) return;
      this._mouseBound = true;
      const c = this.canvas;
      const at = (e) => {
        const r = c.getBoundingClientRect ? c.getBoundingClientRect() : null;
        if (!r || !r.width || !r.height) return;
        this.mouse.x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        /* MilkDrop'un ekran koordinatında y ASAGI artıyor; tarayıcının da
           oyle, bu yuzden cevirme yok. */
        this.mouse.y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      };
      c.addEventListener('mousemove', at);
      c.addEventListener('mousedown', (e) => { at(e); this.mouse.down = 1; });
      c.addEventListener('mouseup', () => { this.mouse.down = 0; });
      c.addEventListener('mouseleave', () => { this.mouse.down = 0; });
    }

    /* Ag sıklıgı ayardan geliyor. Degistiginde koseler, indis tamponu ve
       vertex dizisi YENIDEN kurulmalı: hepsinin boyutu ag sayısından
       tureniyor ve eskisini kullanmaya devam etmek diziyi tasırırdı. */
    _applyMesh(cfg) {
      const want = (cfg && cfg.milkdrop && cfg.milkdrop.mesh) || MESH_X_DEFAULT;
      let mx = MESH_STEPS.indexOf(Math.round(want)) >= 0 ? Math.round(want) : MESH_X_DEFAULT;
      const my = Math.max(4, Math.round(mx * 0.75));
      if (mx === this.meshX && my === this.meshY) return false;
      this.meshX = mx;
      this.meshY = my;
      if (this.gl && this.vao) {
        const gl = this.gl;
        gl.deleteVertexArray(this.vao);
        gl.deleteBuffer(this.vbo);
        gl.deleteBuffer(this.ibo);
        this.vao = null;
        this._buildMesh();
      }
      return true;
    }

    resize() {}

    // ----------------------------------------------------------------- GL
    _compile(type, src) {
      const gl = this.gl;
      const o = gl.createShader(type);
      gl.shaderSource(o, src);
      gl.compileShader(o);
      if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(o) || 'shader';
        gl.deleteShader(o);
        return { ok: false, log };
      }
      return { ok: true, sh: o };
    }

    _link(vs, fs) {
      const gl = this.gl;
      const a = this._compile(gl.VERTEX_SHADER, vs);
      if (!a.ok) return { ok: false, log: a.log };
      const b = this._compile(gl.FRAGMENT_SHADER, fs);
      if (!b.ok) { gl.deleteShader(a.sh); return { ok: false, log: b.log }; }
      const p = gl.createProgram();
      gl.attachShader(p, a.sh);
      gl.attachShader(p, b.sh);
      gl.linkProgram(p);
      gl.deleteShader(a.sh);
      gl.deleteShader(b.sh);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(p) || 'link';
        gl.deleteProgram(p);
        return { ok: false, log };
      }
      return { ok: true, prog: p };
    }

    _initGL(W, H) {
      /* "MilkDrop uyumlu" anahtari. Varsayilan ACIK; bilinmiyorsa (olcum
         harness'i gibi cagiranlarda) yine acik sayiliyor, cunku dogru olan
         o. Kapali hal motorun onceki yaklasik degerlerini geri veriyor. */
      const acc = this._wantAcc !== false;
      if (!this.gl) {
        this.gl2.width = W;
        this.gl2.height = H;
        const gl = this.gl2.getContext('webgl2', {
          alpha: false, antialias: false, preserveDrawingBuffer: true,
        });
        if (!gl) { this.error = 'WebGL2 yok'; return false; }
        this.gl = gl;

        const warp = this._link(MESH_VERT, WARP_FIXED_FRAG);
        const comp = this._link(COMP_MESH_VERT, COMP_FIXED_FRAG);
        const blur = this._link(QUAD_VERT, BLUR_FRAG);
        const line = this._link(LINE_VERT, LINE_FRAG);
        const aal = this._link(AALINE_VERT, AALINE_FRAG);
        const fls = this._link(QUAD_VERT, FLASH_FRAG);
        if (fls.ok) {
          this.flashProg = fls.prog;
          this.locFlash = {
            uCur: gl.getUniformLocation(fls.prog, 'uCur'),
            uPrev: gl.getUniformLocation(fls.prog, 'uPrev'),
            uThresh: gl.getUniformLocation(fls.prog, 'uThresh'),
          };
        }
        const shtex = this._link(SHAPE_TEX_VERT, SHAPE_TEX_FRAG);
        if (!warp.ok || !comp.ok || !blur.ok || !line.ok || !aal.ok || !shtex.ok) {
          this.error = (warp.log || comp.log || blur.log || line.log ||
                        aal.log || shtex.log || 'shader');
          return false;
        }
        this.aaProg = aal.prog;
        this.locAA = {
          uHalf: gl.getUniformLocation(aal.prog, 'uHalf'),
          uExt: gl.getUniformLocation(aal.prog, 'uExt'),
          uGain: gl.getUniformLocation(aal.prog, 'uGain'),
          uMax: gl.getUniformLocation(aal.prog, 'uMax'),
        };
        this.shapeTexProg = shtex.prog;
        this.locShapeTexSrc = gl.getUniformLocation(shtex.prog, 'uSrc');
        this.warpFixed = warp.prog;
        this.compFixed = comp.prog;
        this.blurProg = blur.prog;
        this.lineProg = line.prog;

        this.locWarpFixed = {
          uPrev: gl.getUniformLocation(this.warpFixed, 'uPrev'),
          uDecay: gl.getUniformLocation(this.warpFixed, 'uDecay'),
        };
        this.locComp = {
          uSrc: gl.getUniformLocation(this.compFixed, 'uSrc'),
          uGamma: gl.getUniformLocation(this.compFixed, 'uGamma'),
          uEchoAlpha: gl.getUniformLocation(this.compFixed, 'uEchoAlpha'),
          uEchoZoom: gl.getUniformLocation(this.compFixed, 'uEchoZoom'),
          uEchoOrient: gl.getUniformLocation(this.compFixed, 'uEchoOrient'),
          uFx: gl.getUniformLocation(this.compFixed, 'uFx'),
        };
        this.locBlur = {
          uSrc: gl.getUniformLocation(this.blurProg, 'uSrc'),
          uStep: gl.getUniformLocation(this.blurProg, 'uStep'),
          uW: gl.getUniformLocation(this.blurProg, 'uW'),
          uD: gl.getUniformLocation(this.blurProg, 'uD'),
          uCenter: gl.getUniformLocation(this.blurProg, 'uCenter'),
          uNorm: gl.getUniformLocation(this.blurProg, 'uNorm'),
          uScale: gl.getUniformLocation(this.blurProg, 'uScale'),
          uBias: gl.getUniformLocation(this.blurProg, 'uBias'),
          uEdge: gl.getUniformLocation(this.blurProg, 'uEdge'),
        };

        this._buildMesh();
        this._buildQuad();
        this._buildLine();
        this._buildNoise(acc);
        this._buildSamplers();
      }

      const gl = this.gl;
      if (this.gl2.width !== W || this.gl2.height !== H) {
        this.gl2.width = W;
        this.gl2.height = H;
        this._disposeTargets();
      }
      /* Anahtar degistiyse bulanik kademelerin BOYUTU degisiyor; boyut
         degisimi hedefleri yeniden kurmayi gerektiriyor. */
      if (this.blur && this._blurAcc !== acc) this._disposeTargets();
      if (!this.targets) {
        this.targets = [this._makeTarget(W, H), this._makeTarget(W, H)];
        this.cur = 0;
        /* Blur kademeleri giderek küçülüyor: MilkDrop'ta da öyle. Küçültmek
           hem ucuz hem de tek geçişle daha geniş bir bulanıklık veriyor.

           Yatay ve dikey geçiş AYRI boyuta yazıyor (`tmp` yatayın, `out`
           dikeyin hedefi). İlk kademede yatay yarıya, dikey çeyreğe
           iniyor; eşit tutmak o kademeyi MilkDrop'un iki katı çözünürlükte
           bırakıyordu.

           Boyutlar 16'nın (x) ve 4'ün (y) katına yuvarlanıyor: MilkDrop'un
           kendi hizalaması. Anahtar kapalıyken oranlar eski üç yarılamaya
           dönüyor — hizalama ikisinde de var, birkaç pikselden ibaret. */
        this.blur = [];
        const ratios = acc ? BLUR_RATIOS : BLUR_RATIOS_LEGACY;
        const bsize = (r) => {
          const x = Math.floor((Math.max(W * r, 16) + 3) / 16) * 16;
          const y = Math.floor((Math.max(H * r, 16) + 3) / 4) * 4;
          return [x, y];
        };
        for (let i = 0; i < 3; i++) {
          const hs = bsize(ratios[i][0]);
          const vs = bsize(ratios[i][1]);
          this.blur.push({
            w: vs[0], h: vs[1],           // presetin gördüğü kademe boyutu
            hw: hs[0], hh: hs[1],
            tmp: this._makeTarget(hs[0], hs[1]),
            out: this._makeTarget(vs[0], vs[1]),
          });
        }
        this._blurAcc = acc;
        /* MIPMAP + ANIZOTROPIK SUZME bulanik kademelerde. Preset bu
           dokulari kendi warp agina yayarak okuyor; tek kademeli bir doku
           uzaklasan yuzeylerde cizirdiyor. Mipmap her karede yeniden
           uretiliyor (`_buildBlur` sonunda), yoksa doku EKSIK kalir ve
           siyah okunur — bu yuzden bayrak ile birlikte gidiyor. */
        const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
        this._blurMip = true;
        for (const b of this.blur) {
          gl.bindTexture(gl.TEXTURE_2D, b.out.tex);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          if (aniso) {
            gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT,
              gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT));
          }
          gl.generateMipmap(gl.TEXTURE_2D);
        }
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
      return true;
    }

    /* Geri besleme tamponunun biçimi.

       8 bit tamsayı bu döngüde yetmiyor: her kare bir öncekini okuyup
       yeniden yazıyor, yani niceleme hatası KARE BAŞINA birikiyor. decay
       0,97 gibi bir değerde 8 bitlik bir adım birkaç karede yutuluyor ve
       koyu tonlarda gözle görülür şeritler kalıyor. Yarım kayan nokta bunu
       tümden ortadan kaldırıyor. Eklenti yoksa 8 bite düşülüyor —
       görüntü eskisi kadar iyi olur, daha kötü değil. */
    /* GERİ BESLEME TAMPONUNUN FORMATI — ve neden KAYAN NOKTA DEĞİL.

       MilkDrop'un tamponu 8 bit tamsayı, yani her yazım [0,1] aralığına
       KENETLENİYOR. Bütün motoru bunun üstüne kurulu: blur zinciri
       aralığı ölçek/bias ile [0,1]'e sığdırıp `GetBlurN` ile geri açıyor,
       `decay` her karede o kenetlenmiş değeri çarpıyor.

       Biz RGBA16F kullanıyorduk — daha az bantlanma için. Ama yarı kayan
       nokta KENETLEMİYOR ve toplamalı karışımla çizilen şekiller sınırsız
       birikiyor. Ölçtük: geri besleme tamponunun ham değerleri 40 karede
       65504'e, yani yarı kayan noktanın tavanına çıkıyordu
       (`Stahlregen & Geiss - Witchcraft`, `EVET - Daydreamer`). Ondan
       sonra `sampler_main` okuyan her shader astronomik sayılarla
       çalışıyor ve preset patlıyor. Aşamaları teker teker kapatarak
       bulundu: kaynak ŞEKİL çizimi, şekilleri kapatınca en büyük değer
       1,0'a iniyor.

       RGB10_A2 normalize edilmiş: MilkDrop gibi kenetliyor, ama kanal
       başına 8 değil 10 bit veriyor — yani MilkDrop'un dört katı
       hassasiyet. Bantlanma gerekçesi karşılanıyor, kenetleme semantiği
       geri geliyor. projectM'in #895'i tam olarak bunu istiyor.

       ALFA 2 BİT ve bu sorun değil: karışım işlevlerimiz kaynak alfasını
       kullanıyor (`SRC_ALPHA`), hedefinkini değil. Tamponun alfa kanalını
       okuyan bir yer yok.

       Sürücü RGB10_A2'yi çerçeve tamponu olarak kabul etmezse RGBA8'e
       düşülüyor — MilkDrop'un kendi derinliği, yani en kötü durum onunla
       eşitlenmek. */
    _colorFormat() {
      if (this._fmt) return this._fmt;
      const gl = this.gl;
      this._fmt = this._fmtWorks(gl.RGB10_A2, gl.UNSIGNED_INT_2_10_10_10_REV)
        ? { internal: gl.RGB10_A2, type: gl.UNSIGNED_INT_2_10_10_10_REV }
        : { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE };
      return this._fmt;
    }

    /* Format gerçekten çizilebilir mi. Yalnızca `texImage2D` başarılı diye
       varsaymak yetmiyor: doku oluşuyor ama çerçeve tamponu eksik kalıyor
       ve ekran sessizce siyah çıkıyor. */
    _fmtWorks(internal, type) {
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, 4, 4, 0, gl.RGBA, type, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
        && gl.getError() === gl.NO_ERROR;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(tex);
      return ok;
    }

    _makeTarget(w, h, fmt) {
      const gl = this.gl;
      const f = fmt || this._colorFormat();
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, w, h, 0, f.format || gl.RGBA, f.type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex, fb, w, h };
    }

    _buildMesh() {
      const gl = this.gl;
      const n = this.meshX + 1;
      this.vao = gl.createVertexArray();
      this.vbo = gl.createBuffer();
      this.ibo = gl.createBuffer();
      this.verts = new Float32Array(n * (this.meshY + 1) * VSTRIDE);
      const idx = new Uint32Array(this.meshX * this.meshY * 6);
      let k = 0;
      for (let j = 0; j < this.meshY; j++) {
        for (let i = 0; i < this.meshX; i++) {
          const a = j * n + i;
          idx[k++] = a; idx[k++] = a + 1; idx[k++] = a + n;
          idx[k++] = a + 1; idx[k++] = a + n + 1; idx[k++] = a + n;
        }
      }
      this.indexCount = idx.length;
      const S = VSTRIDE * 4;
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, this.verts, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, S, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, S, 8);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, S, 16);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, S, 24);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, S, 28);
      gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 1, gl.FLOAT, false, S, 32);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
    }

    _buildQuad() {
      const gl = this.gl;
      this.quadVao = gl.createVertexArray();
      this.quadVbo = gl.createBuffer();
      const d = new Float32Array([-1, -1, 3, -1, -1, 3]);   // tek büyük üçgen
      gl.bindVertexArray(this.quadVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
      gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
      gl.bindVertexArray(null);
    }

    _buildLine() {
      const gl = this.gl;
      this.lineVao = gl.createVertexArray();
      this.lineVbo = gl.createBuffer();
      this.lineData = new Float32Array(512 * 6);
      /* YUMUŞATILMIŞ ÇIKTI AYRI DİZİDE ve İKİ KAT BÜYÜK: `smoothWave` her
         çiftin arasına bir nokta koyduğu için 512 nokta 1023'e çıkıyor.
         Kaynak ve hedefin ayrı olması zorunlu — okuma iki nokta ileriye
         bakıyor, yerinde yazsaydık henüz okunmamış noktaları ezerdi. */
      this.waveData = new Float32Array(SMOOTH_MAX * 6);
      gl.bindVertexArray(this.lineVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
      /* VBO en BÜYÜK olasılığa göre ayrılıyor. `lineData`ya göre ayırmak
         sessiz bir hata olurdu: kapasitesini aşan bir `bufferSubData`
         sürücüye göre ya hiç yazmıyor ya INVALID_VALUE veriyor, ikisinde de
         ekranda yalnızca KISA bir dalga görünüyor — hata gibi görünmüyor. */
      gl.bufferData(gl.ARRAY_BUFFER, this.waveData, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);
      gl.bindVertexArray(null);

      /* KENAR YUMUŞATMALI ŞERİT için AYRI tampon: nokta başına İKİ tepe
         (iki yana açılmış), tepe başına pos(2) side(1) col(4) = 7 kayan
         nokta. En kötü durum yumuşatılmış kapalı bir eğri: SMOOTH_MAX
         nokta artı şeridi kapatmak için bir nokta daha. */
      this.aaVao = gl.createVertexArray();
      this.aaVbo = gl.createBuffer();
      this.aaData = new Float32Array((SMOOTH_MAX + 1) * 2 * 7);
      gl.bindVertexArray(this.aaVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.aaVbo);
      gl.bufferData(gl.ARRAY_BUFFER, this.aaData, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 28, 8);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 28, 12);
      gl.bindVertexArray(null);

      /* Dokulu sekiller icin AYRI tampon: dugum basina pos(2) col(4) uv(2).
         Ayni tamponu paylasmak adim genisligini degistirmeyi gerektirirdi ve
         her sekil turunde yeniden bildirim yapmak gerekirdi. */
      this.shapeTexVao = gl.createVertexArray();
      this.shapeTexVbo = gl.createBuffer();
      this.shapeTexData = new Float32Array(512 * 8);
      gl.bindVertexArray(this.shapeTexVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.shapeTexVbo);
      gl.bufferData(gl.ARRAY_BUFFER, this.shapeTexData, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 8);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
      gl.bindVertexArray(null);
    }

    /* Gürültü dokuları. Presetlerin %61'i istiyor.

       BİLEREK YAKLAŞIK: MilkDrop kendi kurulumuyla belirli gürültü resimleri
       dağıtıyor; onlar bizde yok ve dağıtamayız. Burada tohumlu bir üreteçle
       aynı ÖLÇEKTE ve aynı yapıda dokular üretiliyor. Deseni birebir aynı
       değil, ama bağlanmamış (siyah) bir dokudan çok daha yakın — ve tohum
       sabit olduğu için her açılışta aynı sonucu veriyor. */
    _buildNoise(accurate) {
      const gl = this.gl;
      this._dropNoise();
      let seed = 0x9e3779b9;
      const rnd = () => {
        seed ^= seed << 13; seed >>>= 0;
        seed ^= seed >> 17;
        seed ^= seed << 5; seed >>>= 0;
        return (seed >>> 8) / 16777216;
      };

      /* Tek eksende kafes noktalarının ARASINI dolduruyor.

         `step` doldurulacak eksende bir tekselin indeks adımı, `n` o
         eksendeki teksel sayısı, `lines` ise eksene dik kalan her hattın
         başlangıç indeksi. Üç eksen aynı gövdeyi çağırıyor: eksen başına
         kopyalamak, aynı hatayı üç yerde düzeltmek demek olurdu.

         Doğrusal değil KÜBİK ara değer: doğrusal olan kafes noktalarında
         türevi kırar ve büyütülmüş gürültüde o kırıklar ızgara deseni
         olarak görünür. */
      const interpAxis = (px, step, n, zoom, lines) => {
        const row = new Float32Array(n * 4);
        for (const start of lines) {
          /* Hat önce kopyalanıyor: yerinde yazarken kaynak kafes noktaları
             bozulmasaydı bile, doldurulan teksel bir sonraki ara değerin
             girdisi olurdu. */
          for (let i = 0; i < n; i++) {
            for (let c = 0; c < 4; c++) row[i * 4 + c] = px[(start + i * step) * 4 + c] / 255;
          }
          for (let i = 0; i < n; i++) {
            const f = i % zoom;
            if (f === 0) continue;
            const g = i - f;                       // alttaki kafes noktası
            const t = f / zoom;
            for (let c = 0; c < 4; c++) {
              const y0 = row[((g - zoom + n) % n) * 4 + c];
              const y1 = row[(g % n) * 4 + c];
              const y2 = row[((g + zoom) % n) * 4 + c];
              const y3 = row[((g + zoom * 2) % n) * 4 + c];
              const a0 = y3 - y2 - y0 + y1;
              const a1 = y0 - y1 - a0;
              const a2 = y2 - y0;
              const v = ((a0 * t + a1) * t + a2) * t + y1;
              px[(start + i * step) * 4 + c] = (v < 0 ? 0 : (v > 1 ? 1 : v)) * 255;
            }
          }
        }
      };

      /* Kafes gürültüsü: `zoom` teksellik aralıklarla rastgele noktalar,
         araları kübik ara değerle. `zoom=1` saf rastgele demek.

         Değer aralığı MilkDrop'un kendi aralığı: yakınlaştırılmış
         dokularda 216, diğerinde 256, ve üstüne aralığın yarısı ekleniyor.
         Toplam 255'i aşabiliyor ve bayta yazılırken sarıyor — bu bir
         gözden kaçma değil, MilkDrop'un davranışı; presetler o dağılıma
         göre yazılmış. */
      const lattice = (nx, ny, nz, zoom) => {
        const px = new Uint8Array(nx * ny * nz * 4);
        const range = zoom > 1 ? 216 : 256;
        const half = range >> 1;
        for (let i = 0; i < px.length; i++) px[i] = Math.floor(rnd() * range) + half;
        if (zoom > 1) {
          const lines = [];
          // X: kafes y ve z hatları boyunca
          for (let z = 0; z < nz; z += zoom) {
            for (let y = 0; y < ny; y += zoom) lines.push((z * ny + y) * nx);
          }
          interpAxis(px, 1, nx, zoom, lines);
          // Y: kafes z dilimlerinde, artık dolu olan her x sütunu boyunca
          lines.length = 0;
          for (let z = 0; z < nz; z += zoom) {
            for (let x = 0; x < nx; x++) lines.push(z * ny * nx + x);
          }
          interpAxis(px, nx, ny, zoom, lines);
          if (nz > 1) {
            lines.length = 0;
            for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) lines.push(y * nx + x);
            interpAxis(px, nx * ny, nz, zoom, lines);
          }
        }
        return px;
      };

      /* ESKİ üretici — "MilkDrop uyumlu" kapalıyken. Düzgün dağılmış
         rastgelelik, `smooth` ise 3x3 komşu ortalaması. Kafes yapısı yok,
         bu yüzden mq ve hq birbirinin AYNISI oluyordu; anahtarın kapalı
         hâli o günkü görüntüyü geri veriyor. */
      const boxed = (nx, ny, nz, smooth) => {
        const px = new Uint8Array(nx * ny * nz * 4);
        for (let i = 0; i < px.length; i++) px[i] = Math.floor(rnd() * 256);
        if (!smooth) return px;
        const src = px.slice();
        const at = (x, y, z) => (((z + nz) % nz * ny + (y + ny) % ny) * nx + (x + nx) % nx) * 4;
        for (let z = 0; z < nz; z++) {
          for (let y = 0; y < ny; y++) {
            for (let x = 0; x < nx; x++) {
              for (let c = 0; c < 4; c++) {
                let s = 0, n = 0;
                for (let dz = (nz > 1 ? -1 : 0); dz <= (nz > 1 ? 1 : 0); dz++) {
                  for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                      s += src[at(x + dx, y + dy, z + dz) + c];
                      n++;
                    }
                  }
                }
                px[((z * ny + y) * nx + x) * 4 + c] = s / n;
              }
            }
          }
        }
        return px;
      };

      const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
      const upload = (size, depth, px) => {
        const tex = gl.createTexture();
        const tgt = depth > 1 ? gl.TEXTURE_3D : gl.TEXTURE_2D;
        gl.bindTexture(tgt, tex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        if (depth > 1) {
          gl.texImage3D(tgt, 0, gl.RGBA8, size, size, depth, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
        } else {
          gl.texImage2D(tgt, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
        }
        /* MIPMAP + ANİZOTROPİK SÜZME (#560, madde 1). Gürültü dokuları
           uzaklaşan bir ağın üstüne düşürüldüğünde teksel başına birden çok
           örnek gerekiyor; mipmap olmadan uzak bölgeler cızırdıyor. Maliyet
           yalnızca kuruluşta: dokular bir kez üretiliyor. */
        gl.generateMipmap(tgt);
        gl.texParameteri(tgt, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(tgt, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        // Gürültü dokuları TEKRARLI örnekleniyor; kenara kenetlemek presetin
        // deseninde görünür bir sınır bırakırdı
        gl.texParameteri(tgt, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(tgt, gl.TEXTURE_WRAP_T, gl.REPEAT);
        if (depth > 1) gl.texParameteri(tgt, gl.TEXTURE_WRAP_R, gl.REPEAT);
        if (aniso) {
          gl.texParameterf(tgt, aniso.TEXTURE_MAX_ANISOTROPY_EXT,
            gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT));
        }
        gl.bindTexture(tgt, null);
        return { tex, size, target: tgt };
      };

      /* Ölçekler MilkDrop'un kendi ölçekleri. Önceden mq ile hq AYNI
         parametrelerle üretiliyordu; iki ayrı doku isteyen preset ikisinden
         de aynı deseni alıyordu. */
      const two = (size, zoom, smooth) =>
        upload(size, 1, accurate ? lattice(size, size, 1, zoom) : boxed(size, size, 1, smooth));
      /* Hacim gürültüsü her iki kipte de GERÇEK 3B: anahtar değerleri
         değiştiriyor, yapıyı değil. Eskiden 64x64 iki boyutluydu ve
         `tex3D` z'yi atıyordu. */
      const three = (size, zoom, smooth) =>
        upload(size, size, accurate ? lattice(size, size, size, zoom) : boxed(size, size, size, smooth));

      this.noise = {
        lq: two(256, 1, false),
        lqLite: two(32, 1, false),
        mq: two(256, 4, true),
        hq: two(256, 8, true),
        volLq: three(32, 1, false),
        volHq: three(32, 4, true),
      };
      this._noiseAcc = !!accurate;
    }

    _dropNoise() {
      const gl = this.gl;
      if (!this.noise || !gl) { this.noise = null; return; }
      for (const k in this.noise) {
        const n = this.noise[k];
        if (n && n.tex) gl.deleteTexture(n.tex);
      }
      this.noise = null;
    }

    /* Süzme/sarma türevleri için sampler NESNELERİ.

       Neden doku parametresi değil: aynı doku (çoğunlukla `sampler_main`)
       aynı karede hem noktasal hem süzülmüş okunmak isteniyor. Doku
       nesnesinin kendi `texParameteri` durumu tek; iki farklı okuma için
       iki farklı doku kopyası gerekirdi. Sampler nesnesi BİRİME bağlanıyor,
       yani tek doku iki birimden iki ayrı ayarla okunabiliyor.

       DİKKAT: birime bağlı bir sampler nesnesi o birimde dokunun kendi
       parametrelerini EZER. Bu yüzden 0. birime hiç bağlanmıyor —
       `_bindMain` orada sarmayı presetin `wrap` ayarından kuruyor ve
       sessizce ölürdü. */
    _buildSamplers() {
      const gl = this.gl;
      const make = (filter, wrap) => {
        const s = gl.createSampler();
        const f = filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
        const w = wrap === 'clamp' ? gl.CLAMP_TO_EDGE : gl.REPEAT;
        gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, f);
        gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, f);
        gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, w);
        gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, w);
        return s;
      };
      this.samplers = {
        'linear|repeat': make('linear', 'repeat'),
        'linear|clamp': make('linear', 'clamp'),
        'nearest|repeat': make('nearest', 'repeat'),
        'nearest|clamp': make('nearest', 'clamp'),
      };
      /* Ayrılabilir birim aralığı. 0–9 yerleşiklerin sabit birimleri.
         Ölçüm: bir preset en fazla altı türev istiyor, yani 10–15 yetiyor
         ve WebGL2'nin asgari garantisi olan 16'ya tam oturuyor. Sınır yine
         de sürücüden soruluyor — asgariden düşük bir sürücü olamaz ama
         yüksek olan varsa fazlası kullanılır. */
      this.unitMax = Math.min(32, gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) || 16);
    }

    /* Flaş sınırlama geçişi. Sırası:

       1. Ham kareyi 32x32'ye indir ve mipmap üret — en küçük kademe bütün
          karenin ortalaması.
       2. Sınırlayıcıyı EKRANA çiz: ham kare, bir önceki gösterilen kare,
          ve iki ortalama.
       3. Ekranı `prev`e kopyala — bir sonraki karenin karşılaştıracağı şey
          HAM kare değil GÖSTERİLEN kare olmalı, yoksa yanıp sönen bir
          preset her karede yeniden yarı yolda kalır ve sınırlama hiç
          yakınsamaz.
       4. Ortalama kopyalarını takasla.

       `copyTexSubImage2D` tam boy bir kopya ama GPU içinde kalıyor;
       alternatifi ekrana çizmeden önce bir ara dokuya çizip sonra ekrana
       bir daha çizmek olurdu, yani bir tam ekran çizim daha. */
    _flashPass(gl, fl, GW, GH) {
      const L = this.locFlash;
      // 1. bu karenin ortalaması için mipmap zinciri
      gl.bindTexture(gl.TEXTURE_2D, fl.raw.tex);
      gl.generateMipmap(gl.TEXTURE_2D);

      // 2. sınırlayıcı, doğrudan ekrana
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, GW, GH);
      gl.disable(gl.BLEND);
      gl.useProgram(this.flashProg);
      gl.bindVertexArray(this.quadVao);
      gl.uniform1i(L.uCur, 0);
      gl.uniform1i(L.uPrev, 1);
      gl.uniform1f(L.uThresh, FLASH_THRESH);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fl.raw.tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fl.prev.tex);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);

      /* 3. GÖSTERİLEN kareyi sakla — ham kareyi değil. Karşılaştırma
         ekrandaki değişimi ölçmeli; ham kareyle karşılaştırsaydık yanıp
         sönen bir preset her karede aynı sıçramayı yeniden üretir,
         sınırlama hiç yakınsamaz ve ekran yarı genlikte sönmeye devam
         ederdi. Bununla ise dizi bir öncekinin üstüne biniyor ve genlik
         gerçekten eşiğe iniyor. */
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fl.prev.tex);
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, GW, GH);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }

    /* Flaş sınırlama hedefleri, İSTENDİĞİNDE kuruluyor.

       Kapalıyken tek bir doku bile ayrılmıyor: 1920x1080'de üç tam boy
       hedef 25 MB eder ve özelliği kullanmayan biri onu ödememeli.

       `lum` kopyaları 32x32: aranan sayı tek bir ortalama, tam boy mipmap
       üretmek kare başına gerçek bir dolgu maliyeti olurdu. İkisi
       değişmeli kullanılıyor — biri bu karenin ortalaması, diğeri bir
       öncekinin. */
    _ensureFlash(W, H) {
      const gl = this.gl;
      if (this.flash && this.flash.w === W && this.flash.h === H) return this.flash;
      if (this.flash) {
        const kill = (t) => { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); } };
        kill(this.flash.raw); kill(this.flash.prev);
      }
      /* İkisi de RGB8, geri besleme formatı DEĞİL — ve ALFASIZ.

         `prev` ekrandan `copyTexSubImage2D` ile dolduruluyor. Bağlam
         `alpha: false` ile kuruluyor, yani varsayılan çerçeve tamponunun
         alfa kanalı YOK; kaynakta olmayan bir bileşeni hedefe kopyalamak
         INVALID_OPERATION. Ölçtük: RGBA8 hedefte her karede GL hatası 1282,
         RGB8'de temiz. `raw` da aynı formatta ki ikisi aynı hassasiyette
         karşılaştırılsın. Burada 8 bit yeterli: bunlar geri beslemeye
         girmiyor, doğrudan ekrana gidiyor. */
      const disp = { internal: gl.RGB8, format: gl.RGB, type: gl.UNSIGNED_BYTE };
      this.flash = {
        w: W, h: H,
        raw: this._makeTarget(W, H, disp),
        prev: this._makeTarget(W, H, disp),
      };
      /* MIPMAP SÜZME ŞART: ortalama en küçük kademeden okunuyor ve
         `_makeTarget` dokuları düz LINEAR bırakıyor. Öyle kalsalardı
         `textureLod` 0. kademeyi verirdi ve "ortalama" tek bir teksel
         olurdu — sınırlayıcı tamamen yanlış bir sayıya bakardı.

         Zincir burada bir kez üretiliyor ki ilk karede `prev`in mipmapı
         eksik kalmasın; eksik zincirli bir doku her örneklemede tanımsız
         okunuyor. */
      for (const t of [this.flash.raw, this.flash.prev]) {
        gl.bindTexture(gl.TEXTURE_2D, t.tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.generateMipmap(gl.TEXTURE_2D);
      }
      gl.bindTexture(gl.TEXTURE_2D, null);
      return this.flash;
    }

    _disposeTargets() {
      const gl = this.gl;
      if (!gl) return;
      const kill = (t) => { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); } };
      if (this.targets) { this.targets.forEach(kill); this.targets = null; }
      if (this.blur) { this.blur.forEach((b) => { kill(b.out); kill(b.tmp); }); this.blur = null; }
      if (this.flash) {
        kill(this.flash.raw); kill(this.flash.prev);
        this.flash = null;
      }
    }

    // ------------------------------------------------------------- preset
    _ensurePreset(cfg) {
      const c = cfg.milkdrop || {};
      const key = (c.presetId || '') + '|' + (c.source || '').length;
      if (key === this.presetKey && this.preset) return;
      /* GECIS yalnız GERCEK bir degisimde baslıyor: ilk yuklemede onceki
         preset diye bir sey yok.

         Onceki preset ve onun DERLENMIS shader'ları eski yuvaya taşınıyor;
         eski programlar geçiş boyunca yaşıyor ve ancak `_dropOld` onları
         siliyor. Taşıma yeni preset kurulmadan ONCE olmalı — sonra
         olsaydı eski preset kaybolurdu.

         YENI YUVA HEMEN BOSALTILIYOR ve bu şart: iki alan AYNI nesneyi
         gösteriyor, `_buildPresetShaders` ise ilk iş olarak
         `_releasePresetProgs()` çağırıp `this.warpPreset.prog`u siliyor.
         Boşaltmasaydık geçişin ta başında eski presetin programları
         silinirdi; `useProgram` silinmiş bir programda INVALID_OPERATION
         verip HİÇBİR ŞEY bağlamıyor, yani eski presetin çizimi o an
         bağlı olan başka bir programla yapılırdı. Ekranda eski presetin
         rengi yine görünürdü — ama shader'ından değil, geri besleme
         tamponunda kalan izden. */
      const bt = Math.max(0, Math.min(BLEND_MAX, +c.blendTime || 0));
      this._dropOld();
      if (this.presetKey && this.preset && bt > 0) {
        this.oldPreset = this.preset;
        this.oldWarpPreset = this.warpPreset;
        this.oldCompPreset = this.compPreset;
        this.warpPreset = null;
        this.compPreset = null;
        this.oldRandPreset = this.randPreset;
        this.oldTime = this.time;
        this.oldPresetTime = this.presetTime;
        this.blendProg = 0;
        this.blendDur = bt;
        this.blendDirty = true;
      }
      this.presetKey = key;
      const M = window.SVMilkdrop;
      if (!M) { this.error = 'motor yok'; this.preset = null; return; }
      const src = c.source || DEFAULT_PRESET;
      this.preset = new M.Preset(src, { seed: 1234 });
      this.error = this.preset.errors.join(' | ');
      this.frameNo = 0;
      this.presetTime = 0;
      /* MilkDrop'ta rand_preset float4: preset basina sabit DORT rastgele
         sayi. Uc tutmak `rand_preset.w` okuyan presetlerde derlemeyi
         dusuruyordu ("vector field selection out of range"). */
      this.randPreset = [Math.random(), Math.random(), Math.random(), Math.random()];
      this._buildPresetShaders(src);
    }

    /* Geçişi bitirir ve eski presetin programlarını serbest bırakır.
       Programlar burada siliniyor, `_buildPresetShaders`ta değil: orası
       yalnız YENİ yuvaya bakıyor ve eski yuva geçiş boyunca çiziliyor. */
    _dropOld() {
      const gl = this.gl;
      if (gl) {
        if (this.oldWarpPreset && this.oldWarpPreset.prog) gl.deleteProgram(this.oldWarpPreset.prog);
        if (this.oldCompPreset && this.oldCompPreset.prog) gl.deleteProgram(this.oldCompPreset.prog);
      }
      this.oldPreset = null;
      this.oldWarpPreset = null;
      this.oldCompPreset = null;
      this.oldRandPreset = null;
      this.blendProg = 0;
    }

    /* Presetin warp/comp shader'larını çevirip derler.

       Derlenmeyen bir aşama SABİT YOLA düşüyor, preset tümden reddedilmiyor:
       comp'u derlenmeyen bir preset warp'ıyla hâlâ doğru akıyor. Sebep
       `shaderNote`ta duruyor, çünkü sessizce sabit yola düşmek "çalışıyor"
       görünüp bambaşka bir görüntü vermek demek. */
    _buildPresetShaders(src) {
      const gl = this.gl;
      const T = window.SVMilkdropShader;
      this._releasePresetProgs();
      this.warpPreset = null;
      this.compPreset = null;
      this.shaderNote = '';
      if (!gl || !T || !this.preset) return;

      const notes = [];
      const M = window.SVMilkdrop;
      const fl = M.parseMilk(src);
      const build = (text, stage) => {
        if (!text || !text.trim()) return null;
        let r;
        try { r = T.translate(text, { stage }); } catch (e) { notes.push(stage + ': çeviri hatası'); return null; }
        if (r.empty) return null;
        if (r.hard.length) { notes.push(stage + ': ' + r.hard.join(', ')); return null; }
        const lk = this._link(stage === 'warp' ? MESH_VERT : COMP_MESH_VERT, r.glsl);
        if (!lk.ok) {
          notes.push(stage + ': derlenmedi');
          return null;
        }
        if (r.soft.length) notes.push(stage + ': ' + r.soft.length + ' doku yaklaşık');
        const plan = this._assignUnits(r.samplerPlan);
        return {
          prog: lk.prog,
          locs: this._presetLocs(lk.prog, plan, r.rotUniforms, r.texSizeNames),
          plan,
          rot: r.rotUniforms || [],
          blurLevel: blurLevelOf(text),
        };
      };
      this.warpPreset = build(fl.warpShader, 'warp');
      this.compPreset = build(fl.compShader, 'comp');
      this.shaderNote = notes.join(' | ');
    }

    /* GEÇİŞİN KOSİNÜS EĞRİSİ (MilkDrop: CosineInterp).

       Doğrusal bir ilerleme geçişin başında ve sonunda bir sıçrama
       bırakıyor; kosinüs eğrisi iki uçta da türevi sıfırlıyor, yani geçiş
       başlarken ve biterken yumuşuyor.

       ÜÇ AYRI EĞRİ var ve karıştırılmamaları gerekiyor: sayısal
       değişkenler bu eğriyi, ağın UV/alfa karışımı HAM ilerlemeyi, şekil
       ve dalgaların alfa çarpanı da yine ham ilerlemeyi kullanıyor.
       MilkDrop'ta da böyle. */
    _cosMix() {
      return 0.5 - 0.5 * Math.cos(Math.PI * this.blendProg);
    }

    /* Piksel hareketini ETKİLEMEYEN kare değişkenlerini karıştırır ve
       yeni presetin havuzuna yazar. MilkDrop birebir bunu yapıyor; havuza
       yazmak güvenli, çünkü her kare başında yerleşik adlar dosyadaki
       değerlerine geri dönüyor.

       Mantıksal olanlar karışmıyor, ATLIYOR. Atlama noktası normalde
       0,5 ama yalnız BİR TARAFIN birleştirme shader'ı varsa kayıyor:
       shader'ı olan taraf o mantıksal etkileri zaten kendi içinde
       uyguluyor, o yüzden sabit yolun anahtarları geçişin tamamı boyunca
       diğer tarafta kalmalı. */
    _blendScalars() {
      const P = this.preset, O = this.oldPreset;
      if (!P || !O) return;
      const mix = this._cosMix();
      const inv = 1 - mix;
      for (const k of BLEND_LERP) P.set(k, mix * P.get(k) + inv * O.get(k));
      const newComp = !!this.compPreset;
      const oldComp = !!this.oldCompPreset;
      let snap = 0.5;
      if (oldComp && !newComp) snap = -0.01;
      else if (!oldComp && newComp) snap = 1.01;
      if (mix < snap) for (const k of BLEND_SNAP) P.set(k, O.get(k));
    }

    /* MilkDrop'un dönme matrisleri: rot_s/d/f/vf/uf/rand 1..4.

       MilkDrop bunları `float4x3` veriyor — üç satır bir dönme matrisi,
       dördüncü satır rastgele bir öteleme. Presetler neredeyse yalnız
       satır olarak okuyor (`rot_d1[1].x`), yani yumuşak değişen bir
       rastgele sayı kaynağı olarak kullanıyorlar.

       Sınıf adı DÖNME HIZINI söylüyor: s sabit, d yavaş sürükleniyor,
       f/vf/uf gittikçe hızlanıyor, rand her karede yeniden rastgele.
       Hızlar MilkDrop kaynağından ölçülmedi, sınıf adının anlattığı
       büyüklük sırasına göre seçildi — bu yüzden çeviri bunu `soft` notu
       olarak bildiriyor.

       Tohum PRESET BAŞINA sabit: aynı preset her açılışta aynı matrisleri
       görsün diye. Kare başına yeniden rastgeleleyen tek sınıf `rand`. */
    _rotRows(name) {
      if (!this._rotBuf) this._rotBuf = new Map();
      let buf = this._rotBuf.get(name);
      if (!buf) { buf = new Float32Array(12); this._rotBuf.set(name, buf); }

      const cls = /^rot_([a-z]+)[1-4]$/.exec(name);
      const kind = cls ? cls[1] : 'd';
      const SPEED = { s: 0, d: 0.07, f: 0.4, vf: 1.1, uf: 2.7, rand: 0 };
      const speed = SPEED[kind] !== undefined ? SPEED[kind] : 0.07;

      /* Ad + preset tohumundan türeyen sabit bir başlangıç açısı üçlüsü.
         Rastgeleliğin ADA bağlı olması gerekiyor: rot_d1 ile rot_d2 aynı
         değerleri verirse presetin iki ayrı rastgele kaynağı tek kaynağa
         düşer ve desen tekrar eder. */
      let h = (this.randPreset && this.randPreset[0] ? this.randPreset[0] * 4096 : 1) | 0;
      for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
      const frac = (x) => x - Math.floor(x);
      const seed = (k) => frac(Math.abs(Math.sin(h * 0.0001 + k * 12.9898)) * 43758.5453);

      const t = kind === 'rand' ? Math.random() * 1000 : this.time * speed;
      const ax = seed(1) * 6.2831853 + t;
      const ay = seed(2) * 6.2831853 + t * 0.83;
      const az = seed(3) * 6.2831853 + t * 1.17;

      const cx = Math.cos(ax), sx = Math.sin(ax);
      const cy = Math.cos(ay), sy = Math.sin(ay);
      const cz = Math.cos(az), sz = Math.sin(az);
      // Z * Y * X sırasıyla birleşik dönme; satır satır yazılıyor.
      buf[0] = cy * cz;
      buf[1] = cz * sx * sy - cx * sz;
      buf[2] = cx * cz * sy + sx * sz;
      buf[3] = cy * sz;
      buf[4] = cx * cz + sx * sy * sz;
      buf[5] = -cz * sx + cx * sy * sz;
      buf[6] = -sy;
      buf[7] = cy * sx;
      buf[8] = cx * cy;
      // Dördüncü satır: MilkDrop'ta öteleme, presetler rastgele sayı diye okuyor.
      buf[9] = seed(4);
      buf[10] = seed(5);
      buf[11] = seed(6);
      return buf;
    }

    /* Plandaki her yazıma bir doku birimi verir.

       Türevler 10'dan başlıyor. Birim biterse KANONİK birime düşülüyor —
       yani eski davranış: doku doğru, süzme yaklaşık. Bağlanmamış bırakmak
       olmaz: bağlanmamış bir sampler 0. birimi (`sampler_main`) okur,
       derlenir, makul bir şey çizer ve hata vermez. */
    _assignUnits(plan) {
      const canonUnit = {};
      for (const s of SAMPLER_UNITS) canonUnit[s[0]] = s[1];
      let next = SAMPLER_UNITS.length;
      const max = this.unitMax || 16;
      return (plan || []).map((p) => {
        let unit;
        if (next < max) unit = next++;
        // Kullanıcı dokusunun kanonik karşılığı yok: gürültü birimine düşüyor.
        else unit = canonUnit[p.canon] !== undefined ? canonUnit[p.canon] : 4;
        return { name: p.name, canon: p.canon, filter: p.filter, wrap: p.wrap, user: p.user, unit };
      });
    }

    _presetLocs(prog, plan, rot, texSizes) {
      const gl = this.gl;
      const L = {};
      const u = (n) => gl.getUniformLocation(prog, n);
      for (const s of SAMPLER_UNITS) L[s[0]] = u(s[0]);
      /* Konum listesi ile bağlama listesi AYNI liste. Ayrı tutulsaydı
         birinde unutulan bir yazım 0. birimi okuyup sessizce yanlış
         çizerdi. */
      L._plan = (plan || []).map((p) => ({ p, loc: u(p.name) }));
      // Kullanıcı dokusu boyutları (`texsize_worms` gibi)
      L._texSize = (texSizes || []).map((n) => ({ name: n, loc: u(n) }));
      /* Dizi uniformunun konumu ILK ELEMANIN adiyla alinir. */
      L._rot = (rot || []).map((n) => ({ name: n, loc: u(n + '[0]') }));
      // Dort kose rengi; `hue_shader` artik uniform degil, bunlardan hesaplaniyor.
      L.hue_corner = u('hue_corner[0]');
      for (const n of [
        'texsize', 'aspect', 'texsize_noise_lq', 'texsize_noise_mq', 'texsize_noise_hq',
        'texsize_noise_lq_lite', 'texsize_noisevol_lq', 'texsize_noisevol_hq',
        'time', 'fps', 'frame', 'progress',
        'bass', 'mid', 'treb', 'vol', 'bass_att', 'mid_att', 'treb_att', 'vol_att',
        'rand_frame', 'rand_preset', 'roam_cos', 'roam_sin', 'slow_roam_cos', 'slow_roam_sin',
        'blur1_min', 'blur1_max', 'blur2_min', 'blur2_max', 'blur3_min', 'blur3_max',
        'blur1_scale', 'blur2_scale', 'blur3_scale',
        '_qa', '_qb', '_qc', '_qd', '_qe', '_qf', '_qg', '_qh',
      ]) L[n] = u(n);
      return L;
    }

    _releasePresetProgs() {
      const gl = this.gl;
      if (!gl) return;
      if (this.warpPreset && this.warpPreset.prog) gl.deleteProgram(this.warpPreset.prog);
      if (this.compPreset && this.compPreset.prog) gl.deleteProgram(this.compPreset.prog);
    }

    /* Presetin shader'ına bütün MilkDrop değişkenlerini yükler.

       Kullanılmayan uniform'un konumu null geliyor ve gl.uniform* null'da
       sessizce hiçbir şey yapmıyor; bu yüzden hangi presetin neyi kullandığını
       aramaya gerek yok. */
    _setPresetUniforms(L, ctx) {
      const gl = this.gl;
      // "MilkDrop uyumu" anahtari; asagida yalnizca DEGERLERI seciyor.
      const accurate = this._wantAcc !== false;
      for (const s of SAMPLER_UNITS) if (L[s[0]]) gl.uniform1i(L[s[0]], s[1]);
      /* Süzme türevleri ve kullanıcı dokuları kendi birimlerini alıyor.
         Bu döngü `_bindTextures`taki döngüyle AYNI listeyi geziyor: bir
         yazımın konumu ayarlanıp dokusu bağlanmasaydı (ya da tersi) o
         sampler 0. birimi okur, derlenir ve sessizce yanlış çizerdi. */
      for (const e of L._plan) if (e.loc) gl.uniform1i(e.loc, e.p.unit);
      /* Kullanıcı dokusunun boyutu. Presetin kendi `float4 texsize_x;`
         satırı çeviride siliniyor; kalsaydı burada yazdığımız değeri
         gölgeleyen, sıfır kalan bir global olurdu. */
      for (const e of (L._texSize || [])) {
        if (!e.loc) continue;
        const s = this._texSizeFor(e.name);
        gl.uniform4f(e.loc, s[0], s[1], s[2], s[3]);
      }
      /* Dönme matrisleri: her biri dört vec3 satır. */
      for (const r of (L._rot || [])) {
        if (r.loc) gl.uniform3fv(r.loc, this._rotRows(r.name));
      }

      const set4 = (n, a, b, c, d) => { if (L[n]) gl.uniform4f(L[n], a, b, c, d); };
      const set3 = (n, a, b, c) => { if (L[n]) gl.uniform3f(L[n], a, b, c); };
      const set1 = (n, a) => { if (L[n]) gl.uniform1f(L[n], a); };

      set4('texsize', ctx.w, ctx.h, 1 / ctx.w, 1 / ctx.h);
      /* `aspect.xy` MilkDrop'un İÇ çifti (≤ 1), `.zw` tersleri. Denklem
         dilindeki `aspectx` bunun tersi olduğu için ikisini aynı sanmak
         shader'da hem takas hem ters çevirme yapıyordu. */
      set4('aspect', ctx.aspX, ctx.aspY, 1 / ctx.aspX, 1 / ctx.aspY);
      const nz = (o, n) => set4(n, o.size, o.size, 1 / o.size, 1 / o.size);
      nz(this.noise.lq, 'texsize_noise_lq');
      nz(this.noise.mq, 'texsize_noise_mq');
      nz(this.noise.hq, 'texsize_noise_hq');
      nz(this.noise.lqLite, 'texsize_noise_lq_lite');
      nz(this.noise.volLq, 'texsize_noisevol_lq');
      nz(this.noise.volHq, 'texsize_noisevol_hq');

      /* SHADER ZAMANI denklem zamanindan FARKLI.

         Denklem dilinde `time` uygulamanin acilisindan beri geciyor ve
         oyle kaliyor. Shader'da ise MilkDrop presetin basindan beri geceni
         veriyor ve 10.000'de sariyor. Motor ikisine de uygulama zamanini
         veriyordu.

         Iki sonucu var. Birincisi faz: `sin(time)` yazan bir preset
         MilkDrop'ta her acilista ayni yerden basliyor, bizde uygulamanin
         kac saattir acik oldugune bagli bir yerden. Ikincisi kesinlik:
         shader'daki `float` buyuk sayilarda cozunurluk kaybediyor, bir gun
         acik kalmis bir kurulumda animasyon basamakli hale geliyordu.
         Sarma tam da bunun icin var. */
      /* Saat CTX'ten geliyor, `this`ten degil: gecis sirasinda eski
         presetin shader'i da ciziliyor ve onun saati kendi baslangicindan
         sayiyor. `this.presetTime` kullanmak eski presetin fazini yeni
         presetin yasina baglardi. */
      const pTime = ctx.presetTime;
      const P = ctx.P || this.preset;
      const rand = ctx.rand || this.randPreset || [0, 0, 0, 0];
      const shTime = accurate
        ? pTime - Math.floor(pTime / 10000) * 10000
        : ctx.time;
      set1('time', shTime);
      set1('fps', ctx.fps);
      set1('frame', ctx.frame);
      set1('progress', ctx.progress);
      set1('bass', ctx.bass); set1('mid', ctx.mid); set1('treb', ctx.treb);
      set1('bass_att', ctx.bass_att); set1('mid_att', ctx.mid_att); set1('treb_att', ctx.treb_att);
      set1('vol', ctx.vol); set1('vol_att', ctx.vol_att);
      set4('rand_frame', Math.random(), Math.random(), Math.random(), Math.random());
      set4('rand_preset', rand[0], rand[1], rand[2], rand[3]);

      /* roam/hue: MilkDrop bunları kendi iç gezinme salınımlarından üretiyor.
         Buradaki karşılıkları aynı KARAKTERDE (yavaş, ilişkisiz dört faz)
         ama birebir aynı değil. */
      const t = ctx.time;
      /* ROAM. Dort bilesen dort AYRI hizda dolasiyor ve presetler bu hiz
         farkina gore yaziyor: `roam_cos.x` yavas bir salinim, `.w` hizli
         bir titresim. Bizde frekanslar 0,3/0,7/1,1/1,5 idi — birbirine
         cok yakin, yani dordu de neredeyse ayni sayiyi veriyordu ve
         "yavas ile hizliyi karistir" diye yazilmis presetler duz cikiyordu.

         Aralik da yanlisti: MilkDrop 0..1 veriyor, biz -1..1. Isareti
         degisen bir carpan presetin yonunu tersine cevirebiliyordu. */
      /* Frekanslar ve FAZLAR MilkDrop'un kendi sayıları. Önceki turda
         bunlar shader başlığındaki YORUM satırından alınmıştı ("~0.3,
         ~1.3, ~5, ~20") — yaklaşık değerler, üstelik faz hiç yoktu.
         Fazsız dört bileşen t=0'da dördü birden 1 veriyor; MilkDrop'ta
         dördü ayrı yerden başlıyor ve presetler bu farkla yazılmış. */
      const RO = accurate ? [0.329, 1.293, 5.070, 20.051] : [0.3, 0.7, 1.1, 1.5];
      const ROP = accurate ? [1.2, 3.9, 2.5, 5.4] : [0, 0, 0, 0];
      const SRO = accurate ? [0.0050, 0.0085, 0.0133, 0.0217] : [0.05, 0.09, 0.13, 0.17];
      const SROP = accurate ? [2.7, 5.3, 4.5, 3.8] : [0, 0, 0, 0];
      const half = (f) => (accurate ? 0.5 + 0.5 * f : f);
      const rc = (i) => half(Math.cos(t * RO[i] + ROP[i]));
      const rs = (i) => half(Math.sin(t * RO[i] + ROP[i]));
      const sc = (i) => half(Math.cos(t * SRO[i] + SROP[i]));
      const ss = (i) => half(Math.sin(t * SRO[i] + SROP[i]));
      set4('roam_cos', rc(0), rc(1), rc(2), rc(3));
      set4('roam_sin', rs(0), rs(1), rs(2), rs(3));
      set4('slow_roam_cos', sc(0), sc(1), sc(2), sc(3));
      set4('slow_roam_sin', ss(0), ss(1), ss(2), ss(3));

      /* HUE_SHADER dort kose rengi. Ekran boyunca degisiyor; eskiden tek
         renkti ve `ret *= hue_shader` yazan preset butun ekrani ayni tonda
         boyuyordu. Kose basina ayri faz (i*21, i*13, i*9) koseleri
         birbirinden ayiriyor, en buyuk bilesene bolme ise rengi doyuruyor
         — bolmezsek dordu de gri-beyaza yaklasirdi.

         Anahtar KAPALIYKEN dort koseye de AYNI renk gidiyor: yapi ayni
         kaliyor (yine dort kose, yine ayni shader), yalnizca degerler
         motorun eski tek-renk davranisini veriyor. */
      if (L.hue_corner) {
        const hc = this._hueBuf || (this._hueBuf = new Float32Array(12));
        const rs = rand;
        for (let i = 0; i < 4; i++) {
          let r, g, b;
          if (accurate) {
            const k = i;
            r = 0.6 + 0.3 * Math.sin(t * 30 * 0.0143 + 3 + k * 21 + rs[3]);
            g = 0.6 + 0.3 * Math.sin(t * 30 * 0.0107 + 1 + k * 13 + rs[1]);
            b = 0.6 + 0.3 * Math.sin(t * 30 * 0.0129 + 6 + k * 9 + rs[2]);
          } else {
            r = 0.5 + 0.5 * Math.sin(t * 0.31);
            g = 0.5 + 0.5 * Math.sin(t * 0.31 + 2.09);
            b = 0.5 + 0.5 * Math.sin(t * 0.31 + 4.19);
          }
          if (accurate) {
            const mx = Math.max(r, g, b) || 1;
            r = 0.5 + 0.5 * (r / mx);
            g = 0.5 + 0.5 * (g / mx);
            b = 0.5 + 0.5 * (b / mx);
          }
          hc[i * 3] = r; hc[i * 3 + 1] = g; hc[i * 3 + 2] = b;
        }
        gl.uniform3fv(L.hue_corner, hc);
      }

      /* Presetin kendisi bu uniform'ları okuyabiliyor (`b1n`/`b1x` olarak
         yazıp shader'da `blur1_min` diye geri okuyor; korpusta altı preset
         böyle yapıyor). Preset yazmadıysa MilkDrop'un varsayılanları
         zaten 0 ve 1.

         `blurN_scale` GetBlurN'in geri açma çarpanı. Uyum AÇIKKEN yazan
         geçiş değeri aralığa sıkıştırıyor, burada aynı aralık geri
         açılıyor — gidiş dönüş birim, kazanç RGBA8'in tam çözünürlüğünün
         dar bir aralıkta kullanılması. KAPALIYKEN yazan geçiş ham değer
         bırakıyor ve motorun eski `* max + min` okuması korunuyor. */
      const bkey = ['', 'b1', 'b2', 'b3'];
      for (let i = 1; i <= 3; i++) {
        const mn = P.get(bkey[i] + 'n');
        const mx = P.get(bkey[i] + 'x');
        const lo = isFinite(mn) ? mn : 0;
        const hi = isFinite(mx) ? mx : 1;
        set3('blur' + i + '_min', lo, lo, lo);
        set3('blur' + i + '_max', hi, hi, hi);
        const sc = accurate ? hi - lo : hi;
        set3('blur' + i + '_scale', sc, sc, sc);
      }

      const q = (i) => P.get('q' + i) || 0;
      const packs = ['_qa', '_qb', '_qc', '_qd', '_qe', '_qf', '_qg', '_qh'];
      for (let p = 0; p < 8; p++) {
        set4(packs[p], q(p * 4 + 1), q(p * 4 + 2), q(p * 4 + 3), q(p * 4 + 4));
      }
    }

    /* Warp geçişinin kaynak dokusunu presetin `wrap` ayarına göre bağlar.

       MilkDrop'ta bu varsayılan olarak AÇIK ve presetlerin çoğu açık
       kullanıyor: kenardan çıkan görüntü karşı kenardan geri giriyor.
       Kapalı bıraktığımızda içerik ekrandan akıp gidiyor, geriye tek sıra
       piksel bulaşması kalıyor ve preset birkaç saniyede "bitmiş" gibi
       görünüyordu — kullanıcının bildirdiği hata buydu. */
    _bindMain(tex) {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const w = this.preset && this.preset.get('wrap') > 0.5 ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
    }

    /* KULLANICI DOKULARI (#560 madde 2).

       Preset kendi görselini ADA göre istiyor: `sampler_worms` doku
       klasöründe `worms.jpg` arıyor. Preset paketleri o görselleri
       getirmiyor (korpusta tek bir resim dosyası yok), kullanıcının kendi
       MilkDrop kurulumundaki `textures` klasörünü göstermesi gerekiyor.

       Yükleme ASENKRON ve çizim döngüsü bekleyemez: doku gelene kadar
       gürültü bağlı kalıyor, geldiğinde sessizce yerine geçiyor. Dosya yoksa
       gürültüde kalıyor — eski davranış. Bu önemli: sert başarısızlık,
       bugün yanlış-ama-çalışan 1.748 preseti siyaha çevirirdi. */
    _ensureTextureLib(cfg) {
      const dir = (cfg.milkdrop && cfg.milkdrop.textureDir) || '';
      if (dir === this._texDir) return;
      this._texDir = dir;
      this._texNames = [];
      /* Jeton her klasör değişiminde artıyor: uçuşta olan istekler geri
         döndüğünde artık geçersiz oldukları buradan anlaşılıyor. Klasörü
         değiştirip eskisinden gelen bir görselin yerleşmesi sessiz bir
         karışıklık olurdu. */
      const token = (this._texToken = (this._texToken || 0) + 1);
      this._dropUserTextures();
      const api = typeof window !== 'undefined' ? window.api : null;
      if (!dir || !api || !api.milkdropTextures) return;
      Promise.resolve(api.milkdropTextures()).then((r) => {
        // Klasör bu arada değiştiyse gelen liste eskimiştir.
        if (token !== this._texToken) return;
        this._texNames = (r && Array.isArray(r.names)) ? r.names : [];
        /* Liste gelmeden çizilen kareler "dosya yok" diye önbelleğe null
           yazmış olabilir; o kayıtlar artık yanlış. Temizlenmezse doku
           klasörü seçilmiş olmasına rağmen preset gürültüde kalırdı. */
        this._dropUserTextures();
      }).catch(() => {});
    }

    _dropUserTextures() {
      const gl = this.gl;
      if (this.userTex && gl) {
        for (const k in this.userTex) {
          const t = this.userTex[k];
          if (t && t.tex) gl.deleteTexture(t.tex);
        }
      }
      this.userTex = {};
    }

    /* Preset adını klasördeki dosyaya eşler. MilkDrop uzantı yazmıyor ve
       büyük/küçük harf ayırmıyor. */
    _texFileFor(base) {
      const want = String(base || '').toLowerCase();
      for (const f of (this._texNames || [])) {
        const dot = f.lastIndexOf('.');
        if ((dot < 0 ? f : f.slice(0, dot)).toLowerCase() === want) return f;
      }
      return '';
    }

    /* `sampler_rand00` … `rand15`: MilkDrop bunları klasörden RASTGELE
       seçilmiş bir dokuya bağlıyor. Ölçüldü: korpusta 242 preset kullanıyor.

       Seçim preset ve yuva başına belirleniyor, kare başına değil — kare
       başına seçmek her karede başka bir görsel demek olurdu. Adın son
       ekleri MilkDrop'ta uygunluk süzgeci (`rand00_smalltiled` yalnız
       `smalltiled` ile başlayanlardan seçer); o da uygulanıyor. */
    _randomTextureFor(slot) {
      const names = this._texNames || [];
      if (!names.length) return '';
      const m = /^rand(\d\d)(?:_(.+))?$/.exec(slot);
      if (!m) return '';
      const pref = (m[2] || '').toLowerCase();
      const pool = pref
        ? names.filter((f) => f.toLowerCase().startsWith(pref))
        : names.slice();
      if (!pool.length) return '';
      /* Tohum preset kimliği + yuva numarası: aynı preset her açılışta aynı
         dokuyu alıyor, farklı yuvalar farklı doku. */
      let h = 2166136261;
      const key = (this.presetKey || '') + '|' + slot;
      for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      return pool[h % pool.length];
    }

    /* Kullanıcı dokusunu ister ve önbelleğe koyar. Dönen değer O ANKİ
       durum: doku hazırsa kendisi, değilse null (çağıran gürültüye düşer). */
    _userTexture(canon) {
      const base = canon.slice('sampler_'.length);
      if (!this.userTex) this.userTex = {};
      const hit = this.userTex[base];
      if (hit !== undefined) return hit;
      this.userTex[base] = null;              // istek gönderildi, bekliyor
      const api = typeof window !== 'undefined' ? window.api : null;
      if (!api || !api.milkdropTexture) return null;
      /* Önce ADI birebir eşleşen dosya, sonra rastgele yuva. Sıra bilinçli:
         klasörde gerçekten `rand00.png` diye bir dosya varsa o kazanıyor,
         yuva rastgele seçim yapmıyor. Açık dosya, örtük seçimi yenmeli. */
      const file = this._texFileFor(base) || this._randomTextureFor(base);
      if (!file) return null;
      const token = this._texToken;
      Promise.resolve(api.milkdropTexture(file)).then((r) => {
        if (!r || !r.dataUrl || token !== this._texToken || !this.gl) return;
        const img = new Image();
        img.onload = () => {
          const gl = this.gl;
          if (!gl || token !== this._texToken) return;
          const tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
          /* Doku nesnesinin kendi parametreleri: süzme/sarma zaten birime
             bağlı sampler nesnesinden geliyor, bunlar yalnız makul bir
             başlangıç. */
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
          gl.bindTexture(gl.TEXTURE_2D, null);
          /* Aynı doku için ikinci bir istek uçuşta olabilir: önbellek
             liste geldiğinde temizleniyor ve bekleyen bir istek "gelmedi"
             kaydını silinmiş buluyor. İkincisi kazanırsa birincinin
             dokusu haritadan düşer ama GPU'da kalırdı. */
          if (this.userTex[base] && this.userTex[base].tex) { gl.deleteTexture(tex); return; }
          this.userTex[base] = { tex, w: img.naturalWidth, h: img.naturalHeight };
        };
        img.onerror = () => {};
        img.src = r.dataUrl;
      }).catch(() => {});
      return null;
    }

    /* Kanonik sampler adından o adın okuduğu dokuya. Kullanıcı dokusunun
       dosyası henüz yoksa gürültüye düşüyor — çeviri bunu `soft` notu
       olarak zaten bildiriyor. */
    _texFor(canon, mainTex) {
      switch (canon) {
        case 'sampler_main': return mainTex;
        case 'sampler_blur1': return this.blur[0].out.tex;
        case 'sampler_blur2': return this.blur[1].out.tex;
        case 'sampler_blur3': return this.blur[2].out.tex;
        case 'sampler_noise_lq': return this.noise.lq.tex;
        case 'sampler_noise_lq_lite': return this.noise.lqLite.tex;
        case 'sampler_noise_mq': return this.noise.mq.tex;
        case 'sampler_noise_hq': return this.noise.hq.tex;
        case 'sampler_noisevol_lq': return this.noise.volLq.tex;
        case 'sampler_noisevol_hq': return this.noise.volHq.tex;
        default: {
          const u = this._userTexture(canon);
          return u ? u.tex : this.noise.lq.tex;
        }
      }
    }

    /* Kanonik adın doku HEDEFİ. Hacim gürültüsü 3B, gerisi 2B. Yanlış
       hedefe bağlamak sessizce çalışıyor gibi görünüp o birimde boş doku
       okuturdu — hata değil, siyah. */
    _targetFor(canon) {
      const gl = this.gl;
      return (canon === 'sampler_noisevol_lq' || canon === 'sampler_noisevol_hq')
        ? gl.TEXTURE_3D : gl.TEXTURE_2D;
    }

    /* `texsize_<ad>` için (genişlik, yükseklik, 1/g, 1/y). Preset bunu
       okuyup dokuyu teksel hassasiyetinde adresliyor; GERÇEKTEN bağlı olan
       dokunun boyutu verilmeli. Gürültüye düşülmüşse gürültünün boyutu
       doğru cevaptır — görselin boyutunu vermek presetin var olmayan
       tekselleri adreslemesine yol açardı. */
    _texSizeFor(name) {
      const base = name.slice('texsize_'.length);
      const u = this.userTex ? this.userTex[base] : null;
      const w = (u && u.w) ? u.w : this.noise.lq.size;
      const h = (u && u.h) ? u.h : this.noise.lq.size;
      return [w, h, 1 / w, 1 / h];
    }

    _bindTextures(mainTex, L) {
      const gl = this.gl;
      const bind = (unit, tex, target) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(target || gl.TEXTURE_2D, tex);
      };
      this._bindMain(mainTex);
      bind(1, this.blur[0].out.tex);
      bind(2, this.blur[1].out.tex);
      bind(3, this.blur[2].out.tex);
      bind(4, this.noise.lq.tex);
      bind(5, this.noise.lqLite.tex);
      bind(6, this.noise.mq.tex);
      bind(7, this.noise.hq.tex);
      bind(8, this.noise.volLq.tex, gl.TEXTURE_3D);
      bind(9, this.noise.volHq.tex, gl.TEXTURE_3D);

      /* Süzme türevleri ve kullanıcı dokuları. Sampler nesnesi BİRİME
         bağlı ve bağlı kaldığı sürece o birimdeki her dokuyu etkiliyor;
         bu yüzden ayrılabilir aralık her karede önce TEMİZLENİYOR. Bir
         önceki presetten kalan bağ, yeni presetin aynı birimi başka bir
         ayarla kullanmasında sessizce yanlış örnekleme verirdi. */
      const plan = (L && L._plan) || [];
      for (let unit = SAMPLER_UNITS.length; unit < (this.unitMax || 16); unit++) {
        gl.bindSampler(unit, null);
        /* Iki hedef de birakiliyor. Bir onceki preset bu birime hacim
           gurultusu bagladiysa ve simdi ayni birim iki boyutlu okunuyorsa,
           eski 3B bag birimde asili kalirdi. */
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindTexture(gl.TEXTURE_3D, null);
      }
      for (const e of plan) {
        // Kanonik birime düşmüş türevde sampler nesnesi bağlanmıyor: o birim
        // yerleşiğin kendi birimi ve orada ezmek diğer okumayı bozardı.
        if (e.p.unit < SAMPLER_UNITS.length) continue;
        bind(e.p.unit, this._texFor(e.p.canon, mainTex), this._targetFor(e.p.canon));
        gl.bindSampler(e.p.unit, this.samplers[e.p.filter + '|' + e.p.wrap] || null);
      }
      gl.activeTexture(gl.TEXTURE0);
    }

    // ----------------------------------------------------------------- çiz
    draw(audio, cfg, t, dt) {
      const W = this.canvas.width;
      const H = this.canvas.height;
      /* Geri besleme yüzeyi TUVAL BOYUTUNDA.

         Kaynağa bakarak doğrulandı: MilkDrop'un iç doku boyutu ayarı
         varsayılan olarak -1, yani "otomatik = pencereyle aynı". Önce yarı
         çözünürlük kullanıyorduk (her kenarı bulanıklaştırıyor ve bulanıklık
         geri besleme döngüsünde birikiyordu), sonra sabit 1024 denedim —
         ikisi de MilkDrop'un yaptığı şey değil.

         Üst sınır yalnızca başarım için: per_pixel ağı ve altı ek render
         hedefi çözünürlükle pahalılaşıyor. */
      const cap = (cfg.milkdrop && cfg.milkdrop.maxSize) || 1920;
      /* IC COZUNURLUK CARPANI (#560, madde 1). 1'in ustunde once buyuk
         render edilip tuvale kuculterek yazılıyor; kenarlar ve ince sekiller
         1440p/4K ekranlarda belirginlesiyor. Maliyet carpanın KARESI kadar,
         bu yuzden ust sınır maxSize'da kalıyor: carpan buyuk bir ekranda
         sınırı asarsa asagıdaki sc zaten geri kısıyor. */
      const rs = Math.max(0.5, Math.min(2, +(cfg.milkdrop && cfg.milkdrop.renderScale) || 1));
      const RW = W * rs;
      const RH = H * rs;
      const sc = Math.min(1, cap / Math.max(1, Math.max(RW, RH)));
      const GW = Math.max(64, Math.round(RW * sc));
      const GH = Math.max(64, Math.round(RH * sc));
      this._applyMesh(cfg);
      this._bindMouse();
      this._wantAcc = !(cfg.milkdrop && cfg.milkdrop.accurate === false);
      /* ÇİZGİ ÇİZİMİ. `smooth` kenar yumuşatmalı ve eski yolun bıraktığı
         ışığı koruyor; `thin` gerçek kalınlık, ışık koruması yok;
         `milkdrop` MilkDrop'un kendi kaydırmalı kalınlaştırması.
         Tanınmayan değer varsayılana düşüyor — ayardaki bir yazım hatası
         çizgileri yok etmemeli. */
      const ls = cfg.milkdrop && cfg.milkdrop.lineStyle;
      this._lineStyle = (ls === 'thin' || ls === 'milkdrop') ? ls : 'smooth';
      /* Flaş sınırlama VARSAYILAN AÇIK. Ölçtük: presetlerin %90'ı eşiğin
         altında kalıyor ve hiç etkilenmiyor; devreye yalnızca WCAG'in
         riskli dediği %7,1'de giriyor. Kapatmak isteyen ayardan kapatıyor. */
      this._flashLimit = !(cfg.milkdrop && cfg.milkdrop.flashLimit === false);
      if (!this._initGL(GW, GH)) { this._fallback(W, H); return; }
      /* Anahtar cizim sirasinda degistiyse gurultu dokulari yeniden
         uretiliyor: uretecin PARAMETRELERI degisti, dokular degismedi. */
      if (this.noise && this._noiseAcc !== this._wantAcc) this._buildNoise(this._wantAcc);
      this._ensureTextureLib(cfg);
      this._ensurePreset(cfg);
      if (!this.preset) { this._fallback(W, H); return; }

      const gl = this.gl;
      const step = Math.min(0.05, dt || 0.016);
      this.time += step;
      this.presetTime += step;
      this.frameNo++;

      /* MilkDrop bantları MUTLAK genlik olarak değil, uzun dönem ortalamaya
         ORAN olarak bekliyor: 1,0 "her zamanki düzey" demek. */
      if (!this._audioNorm) this._audioNorm = new window.SVMilkdropAudio.MilkdropAudio();
      const a = this._audioNorm.update(step, {
        bass: audio.bass, mid: audio.mid, treb: audio.treble,
      });

      /* Duyarlılık oranı doğrudan ÇARPAMAZ: girdiyi ölçeklemek ortalamayı da
         ölçekler ve oran değişmeden kalır. Bunun yerine normalden SAPMA
         büyütülüyor, böylece 1,0 = normal sözleşmesi bozulmuyor. */
      const sens = (cfg.visualizer && cfg.visualizer.sensitivity) || 1;
      const gain = (r) => Math.max(0, 1 + (r - 1) * sens);
      const bass = gain(a.bass), mid = gain(a.mid), treb = gain(a.treb);
      const bassA = gain(a.bass_att), midA = gain(a.mid_att), trebA = gain(a.treb_att);

      /* EN-BOY. MilkDrop bunu İKİ AYRI biçimde tutuyor ve ikisi de lazım.

         İçeride kullandığı çift her zaman 1 ya da altında: geniş ekranda
         `aspX = 1`, `aspY = H/W`. Ağın koordinatları, `rad` ve `ang` bu
         çiftle hesaplanıyor. Shader'a giden `aspect` de bu çift artı
         tersleri (`.zw`).

         Denklem dilindeki `aspectx`/`aspecty` ise bunların TERSİ — MilkDrop
         kaynağında `var_pf_aspectx = m_fInvAspectX` diye yazıyor. Yani
         geniş ekranda preset `aspectx = 1`, `aspecty = W/H` görüyor.

         Bizde ikisi YER DEĞİŞTİRMİŞTİ: büyük olan sayı `aspectx`e
         veriliyordu. Ters değil, takas — `aspectx * x` yazan bir preset
         düzeltmeyi yanlış eksene uyguluyordu. Korpusta %11,2'si denklemde,
         %25,7'si shader'da en-boy okuyor. */
      const aspX = GH > GW ? GW / GH : 1;
      const aspY = GW > GH ? GH / GW : 1;
      this._aspX = aspX; this._aspY = aspY;
      const accAsp = this._wantAcc !== false;
      const aspectx = accAsp ? 1 / aspX : (GW >= GH ? GW / GH : 1);
      const aspecty = accAsp ? 1 / aspY : (GW >= GH ? 1 : GH / GW);

      const fpsNow = 1 / Math.max(1e-3, step);
      const inputs = {
        time: this.time,
        frame: this.frameNo,
        fps: fpsNow,
        bass, mid, treb,
        bass_att: bassA, mid_att: midA, treb_att: trebA,
        progress: (this.presetTime * 0.1) % 1,
        meshx: this.meshX, meshy: this.meshY,
        mouse_x: this.mouse.x, mouse_y: this.mouse.y, mouse_down: this.mouse.down,
        aspectx, aspecty,
        /* pixelsx/pixelsy: çıkışın piksel ölçüsü. Havuzda yoktu, yani
           okuyan preset sıfır görüyordu — bir piksele bölmek isteyen
           satır sonsuza gidiyordu. Korpusta 178 preset (%1,7) okuyor. */
        pixelsx: GW, pixelsy: GH,
      };
      this.preset.frame(inputs);
      const base = this.preset.captureBase();

      /* GEÇİŞ: eski presetin kare denklemleri de koşuyor. Kendi zamanı ve
         kendi ilerlemesiyle — MilkDrop da iki durumu ayrı saatlerle
         besliyor. Sonra hareket ETMEYEN değişkenler karıştırılıp yeni
         presetin havuzuna yazılıyor; hareket edenler ağ düzeyinde
         karışıyor. */
      if (this.oldPreset) {
        this.oldTime += step;
        this.oldPresetTime += step;
        this.blendProg += step / Math.max(1e-3, this.blendDur);
        if (this.blendProg >= 1) {
          this._dropOld();
        } else {
          const oi = Object.assign({}, inputs, {
            time: this.oldTime,
            progress: (this.oldPresetTime * 0.1) % 1,
          });
          this.oldPreset.frame(oi);
          this.oldPreset.captureBase();
          this._blendScalars();
        }
      }

      this._buildWarpMesh();

      const src = this.targets[this.cur];
      const dst = this.targets[1 - this.cur];
      this.cur = 1 - this.cur;

      const ctx = {
        w: GW, h: GH, aspectx, aspecty, aspX, aspY,
        time: this.time, fps: fpsNow, frame: this.frameNo,
        progress: (this.presetTime * 0.1) % 1,
        presetTime: this.presetTime, P: this.preset, rand: this.randPreset,
        bass, mid, treb, bass_att: bassA, mid_att: midA, treb_att: trebA,
        vol: (bass + mid + treb) / 3, vol_att: (bassA + midA + trebA) / 3,
      };
      const oldCtx = this.oldPreset ? Object.assign({}, ctx, {
        time: this.oldTime,
        progress: (this.oldPresetTime * 0.1) % 1,
        presetTime: this.oldPresetTime,
        P: this.oldPreset,
        rand: this.oldRandPreset || this.randPreset,
      }) : null;

      // --- 3. WARP GEÇİŞİ
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.verts);
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      gl.viewport(0, 0, GW, GH);
      gl.disable(gl.BLEND);
      /* GECISTE IKI CIZIM: once eski preset MAT, sonra yeni preset dugum
         alfasiyla ustune. Sonuc `eski*(1-a) + yeni*a`.

         MilkDrop'un dort durumlu dali burada da aynen var ve iki durumda
         IKINCI CIZIM HIC YOK: ikisinin de warp shader'i yoksa karisim
         zaten agin UV'lerinde olup bitiyor, ustune ikinci bir mat cizim
         yapmak sadece israf olurdu. */
      const bothFixed = !this.warpPreset && (!oldCtx || !this.oldWarpPreset);
      if (oldCtx && !bothFixed) {
        this._drawWarpPass(gl, src, this.oldWarpPreset, oldCtx, step);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        this._drawWarpPass(gl, src, this.warpPreset, ctx, step);
        gl.disable(gl.BLEND);
      } else {
        this._drawWarpPass(gl, src, this.warpPreset, ctx, step);
      }

      /* --- 4. BLUR ZİNCİRİ: kaynağı `src`, yani ÖNCEKİ karenin tamamlanmış
         görüntüsü — warp'ın üstüne o karede çizilmiş şekiller, dalgalar ve
         kenarlıklar dâhil.

         MilkDrop `BlurPasses()`i warp'tan sonra çağırıyor ama kaynak olarak
         warp'ın ÇIKTISINI değil GİRDİSİNİ veriyor; kendi yorumu da bunu
         söylüyor (milkdropfs.cpp:1479-1481):
             // Note: Warped blit just rendered from VS0 to VS1.
             SetTexture(0, (i == 0) ? m_lpVS[0] : m_lpBlur[i - 1]);
         Tamponlar kare SONUNDA takas ediliyor (1149-1151), dolayısıyla
         `m_lpVS[0]` bir önceki karenin son hâli. Bizde `this.cur` her
         karede dönüyor, yani `src` tam olarak o tampon — dokulu şekillerin
         beslendiği kaynağın (`_shapeSrcTex`) aynısı.

         Daha önce `dst.tex` veriyorduk: içerik aynı şekilleri taşıyor ama
         bir kez FAZLA warp'lanmış oluyordu. Sonucu, güçlü zoom ya da dönüş
         taşıyan presetlerde bloom'un yerinde durmayıp akış boyunca
         sürüklenmesi ve decay kadar sönmesiydi. Korpusun %71,3'ü GetBlur
         okuduğu için etki geniş.

         Konum değişmiyor ve değişmemeli: warp geçişi bu satırdan ÖNCE
         olduğu için warp shader'ı bir önceki karede üretilmiş bulanık
         dokuları örnekliyor, comp shader'ı ise bu karede üretilenleri.
         MilkDrop'ta da gecikme aynen böyle (1021 warp, 1058 blur, 1099
         comp).

         KAÇ KADEME: yalnızca yaşayan shader'ların okuduğu kadar. MilkDrop
         sayacı warp'ın BU kareki, comp'un BİR ÖNCEKİ kareki kullanımının
         birleşimini taşıyor; tek preset koşarken ikisi aynı preset olduğu
         için bu `max(warp, comp)` demek. Geçişte dört aşama da yaşıyor,
         hepsi hesaba katılıyor. */
      this._buildBlur(src.tex, this._blurNeed());

      /* --- 5. Çizimler, warp'ın üstüne. MilkDrop'un sırası: önce şekiller,
         sonra custom dalgalar, en son varsayılan dalga formu. Sıra görünür:
         toplamalı bir şekil kendinden sonra çizilen dalgayı yıkamaz. */
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      gl.viewport(0, 0, GW, GH);
      this._waveSamples(audio, this.preset.get('wave_scale'),
        this.preset.get('wave_smoothing'));
      /* Dokulu şekiller ÖNCEKİ kareyi örnekliyor. Şu an yazdığımız hedefi
         okumak tanımsız davranış: aynı dokudan okurken aynı dokuya yazmak
         sürücüye göre değişen çöp verir. MilkDrop da şekli sampler_main
         üzerinden, yani warp'a girdi olan kareden besliyor. */
      this._shapeSrcTex = src.tex;
      /* ŞEKİLLER ve DALGALAR geçişte İKİ presetten de çiziliyor, alfaları
         ilerlemeyle ölçeklenerek: yeni preset `ilerleme`, eski preset
         `1 - ilerleme`. MilkDrop'ta da `alpha_mult` tam olarak bu ve HAM
         ilerlemeyi kullanıyor, kosinüs eğrisini değil.

         Sıra eski-önce: geçişin sonunda yeni presetin şekilleri üstte
         kalıyor. */
      if (oldCtx) {
        this._drawShapes(gl, GW, GH, this.oldPreset, 1 - this.blendProg);
        this._drawCustomWaves(gl, audio, this.oldPreset, 1 - this.blendProg);
      }
      this._drawShapes(gl, GW, GH, this.preset, oldCtx ? this.blendProg : 1);
      this._drawCustomWaves(gl, audio, this.preset, oldCtx ? this.blendProg : 1);
      /* VARSAYILAN DALGA geçişte de TEK kez çiziliyor ve bu MilkDrop'un
         kendi davranışı: rengi, alfası, konumu ve gizemi zaten
         karıştırılmış değerler, `wave_mode` ise karışmıyor.

         BİLEREK EKSİK: MilkDrop iki presetin dalga MODU farklıysa iki
         şekli düğüm düğüm birbirine dönüştürüyor (`its = 2`, v2'yi v1'in
         nokta sayısına yeniden örnekleyip konumları karıştırıyor). Onu
         yapmıyoruz — modlar farklıysa geçiş boyunca yeni presetin modu
         görünüyor. Ölçüsü: yalnız iki presetin dalga modu farklıysa ve
         yalnız geçiş süresince. */
      this._drawWaveModes(gl, GW, GH);
      // Hareket vektörleri: çizimlerden sonra, birleştirmeden önce.
      this._drawMotionVectors(gl, GW, GH);
      /* Merkez karartma ve kenarlıklar EN SON: MilkDrop'ta da sıra bu.
         Daha önce çizilseler dalga ve şekiller üstlerini kapatırdı. */
      this._drawDarkenCenter(gl, GW, GH);
      this._drawBorders(gl);

      /* --- 6. COMP GEÇİŞİ.

         Flaş sınırlama KAPALIYKEN doğrudan ekrana; açıkken bir ara dokuya,
         çünkü sınırlayıcı kareyi bir önceki kareyle karşılaştırmak zorunda
         ve ekranı okuyamaz. Kapalı hâlde tek bir ek geçiş, tek bir ek
         doku yok — özelliği kullanmayan onu ödemiyor. */
      const fl = (this._flashLimit && this.flashProg) ? this._ensureFlash(GW, GH) : null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fl ? fl.raw.fb : null);
      gl.viewport(0, 0, GW, GH);
      gl.disable(gl.BLEND);
      /* Warp'takinin aynısı: ikisinin de birleştirme shader'ı yoksa tek
         çizim yetiyor, çünkü sabit yolun bütün girdileri (gamma, eko,
         parlatma anahtarları) zaten karıştırılmış değerler. */
      const compBothFixed = !this.compPreset && (!oldCtx || !this.oldCompPreset);
      if (oldCtx && !compBothFixed) {
        this._drawCompPass(gl, dst, this.oldCompPreset, oldCtx);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        this._drawCompPass(gl, dst, this.compPreset, ctx);
        gl.disable(gl.BLEND);
      } else {
        this._drawCompPass(gl, dst, this.compPreset, ctx);
      }

      if (fl) this._flashPass(gl, fl, GW, GH);

      const c = this.ctx;
      c.clearRect(0, 0, W, H);
      c.imageSmoothingEnabled = true;
      c.drawImage(this.gl2, 0, 0, W, H);
    }

    /* Tek bir warp çizimi. Presetin shader'ı varsa onunla, yoksa sabit
       yolla — geçişte bu ikisi karışık da olabiliyor (eski presetin
       shader'ı var, yeninin yok gibi) ve MilkDrop'ta da öyle.

       Ağ tamponu ÇAĞIRAN tarafından yüklendi: iki çizim de aynı düğümleri
       kullanıyor, çünkü UV'ler zaten karıştırılmış hâlde duruyor. */
    _drawWarpPass(gl, src, prog, ctx, step) {
      if (prog) {
        gl.useProgram(prog.prog);
        this._bindTextures(src.tex, prog.locs);
        this._setPresetUniforms(prog.locs, ctx);
      } else {
        gl.useProgram(this.warpFixed);
        this._bindMain(src.tex);
        gl.uniform1i(this.locWarpFixed.uPrev, 0);
        /* `decay` artik dosyadaki fDecay ile eslesiyor. Eskiden bulunamayip
           0,98'e dusuyordu; 0,5 yazan bir preset sonmek yerine birikiyordu.

           KARE HIZI DUZELTMESI: MilkDrop decay'i kare BASINA uyguluyor ve
           kare hizina gore duzeltmiyor. Presetler de o donemin ~30 fps'inde
           yazilmis. 60 fps'te ayni sayiyi kullanmak saniyede iki kat sondurup
           goruntuyu presetin istediginden cok daha karanlik birakiyor —
           olcerek gorduk. Ussu kare suresiyle olceklemek, saniyedeki sonme
           miktarini kare hizindan bagimsiz kiliyor.

           GECISTE decay HER ZAMAN yeni presetin havuzundan okunuyor: orada
           duran deger zaten iki presetin karisimi (MilkDrop da tek bir
           karistirilmis decay kullaniyor). */
        /* `decay` de COLOR_NORM'dan geçiyor (milkdropfs.cpp:1795) — bir
           tepe rengi olarak taşındığı için. Kenetlemiyor, SARIYOR:
           `decay = 50,95` yazan `Syst3mFailur - satanic ring V2`
           MilkDrop'ta 0,753 alıyor, 1,0 değil. Biz 1'e kenetliyorduk, yani
           o preset hiç sönmüyordu. Korpusta 36 preset (%0,3) böyle. */
        const decay = window.SVMilkdrop.colorNorm(this.preset.get('decay'));
        /* SIFIR GEÇERLİ BİR DEĞER: "iz bırakma" demek. Burada
           `decay > 0 ? decay : 0.98` vardı ve sıfırı "bulunamadı" sayıp
           ağır bir ize çeviriyordu. Havuzun `has`i ikisini ayırıyor:
           korpusta decay'i HİÇ yazmayan 1 preset var (varsayılan 0,98 onun
           hakkı), sonunda sıfıra inen 225 preset (%2,17) var ve onlar
           istemedikleri izi alıyordu. */
        const yazdi = this.preset.pool.has('decay');
        const raw = yazdi ? Math.max(0, Math.min(1, decay)) : 0.98;
        const fps = 1 / Math.max(1e-3, step);
        gl.uniform1f(this.locWarpFixed.uDecay, Math.pow(raw, REF_FPS / Math.max(1, fps)));
      }
      gl.bindVertexArray(this.vao);
      gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
    }

    /* Tek bir birleştirme çizimi. Tam ekran üçgeni yerine WARP AĞI
       kullanılıyor: geçişin karışım oranı düğüm başına değişiyor ve tek
       üçgende taşınamaz. Geçiş yokken bütün düğümlerin alfası 1, yani
       sonuç eskisiyle birebir aynı — sadece üç köşe yerine ağ kadar
       üçgen çiziliyor. */
    _drawCompPass(gl, dst, prog, ctx) {
      if (prog) {
        gl.useProgram(prog.prog);
        this._bindTextures(dst.tex, prog.locs);
        this._setPresetUniforms(prog.locs, ctx);
      } else {
        gl.useProgram(this.compFixed);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, dst.tex);
        gl.uniform1i(this.locComp.uSrc, 0);
        /* Sabit yolun girdileri geçişte de YENİ presetin havuzundan
           geliyor; oradaki değerler `_blendScalars` tarafından zaten
           karıştırılmış ya da atlatılmış durumda. */
        const Pp = this.preset;
        const gamma = Pp.get('gamma') || 1;
        gl.uniform1f(this.locComp.uGamma, gamma > 0 ? gamma : 1);
        gl.uniform1f(this.locComp.uEchoAlpha, Pp.get('echo_alpha') || 0);
        gl.uniform1f(this.locComp.uEchoZoom, Pp.get('echo_zoom') || 1);
        gl.uniform1i(this.locComp.uEchoOrient, Math.round(Pp.get('echo_orient') || 0));
        gl.uniform4f(this.locComp.uFx,
          Pp.get('brighten') ? 1 : 0, Pp.get('darken') ? 1 : 0,
          Pp.get('solarize') ? 1 : 0, Pp.get('invert') ? 1 : 0);
      }
      gl.bindVertexArray(this.vao);
      gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
    }

    /* HAREKET VEKTÖRLERİ (nMotionVectorsX/Y + mv_*).

       MilkDrop warp alanını gösteren küçük çizgilerden bir ızgara çiziyor:
       her ızgara noktasından, o noktanın önceki kareden ÖRNEKLEDİĞİ yere
       doğru bir çizgi. Akışı görünür kılan bu çizgiler bazı presetlerin
       görsel imzası.

       Korpusta presetlerin %92'sinde ızgara açık, ama görünürlüğü `mv_a`
       belirliyor: %8,6'sı dosyada sıfırdan büyük alfa yazıyor, %5,7'si de
       per_frame içinde açıp kapıyor. Motorda hiç çizilmiyorlardı.

       Sıra: çizimlerden SONRA, birleştirmeden ÖNCE — MilkDrop'ta da öyle,
       yani vektörler geri besleme tamponuna giriyor ve sonraki karelerde
       akıp sönüyorlar. Birleştirmeden sonra çizmek onları geri beslemenin
       dışında bırakır ve iz bırakmadan yanıp sönerlerdi. */
    /* bDarkenCenter — ekranın TAM ORTASINI hafifçe karartır.

       Korpusta 711 preset (%6,9) açık bırakıyor ve motor bunu hiç
       okumuyordu. İşi küçük ama belirli: merkeze doğru yakınlaşan
       presetlerde görüntü ortada birikip beyaza doyuyor, bu karartma o
       birikmeyi geri alıyor. Açık olan presetlerde eksikliği "orta nokta
       fazla parlak" diye görünür.

       Biçim MilkDrop'un kendi biçimi: yarım boyu 0,05 olan bir baklava,
       merkezde alfa 3/32 siyah, dört köşesinde alfa 0. Yani sert bir
       leke değil, merkezden dışa sönen bir gölge. En-boy düzeltmesi X'e
       uygulanıyor ki geniş ekranda yamulmasın. */
    _drawDarkenCenter(gl, GW, GH) {
      const P = this.preset;
      if (!P || this._wantAcc === false) return;
      if (!(P.get('darken_center') > 0)) return;
      const aspY = GW > GH ? GH / GW : 1;
      const h = 0.05;
      const d = this.lineData;
      // merkez + dört köşe + ilk köşeye dönüş = altı düğümlü yelpaze
      const pts = [[0, 0], [-h * aspY, 0], [0, -h], [h * aspY, 0], [0, h], [-h * aspY, 0]];
      for (let i = 0; i < pts.length; i++) {
        const k = i * 6;
        d[k] = pts[i][0]; d[k + 1] = pts[i][1];
        d[k + 2] = 0; d[k + 3] = 0; d[k + 4] = 0;
        d[k + 5] = i === 0 ? 3 / 32 : 0;
      }
      gl.useProgram(this.lineProg);
      gl.bindVertexArray(this.lineVao);
      this._blend(gl, false);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, pts.length * 6);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, pts.length);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }

    /* DIŞ ve İÇ KENARLIK — `ob_*` ve `ib_*`.

       Presetlerin %99,7'si bu değerleri dosyasında taşıyor; 3.100'ü
       (%30,0) görünür bir dış, 1.575'i (%15,2) görünür bir iç kenarlık
       istiyor, per_frame'den sürenlerle birlikte 3.906 preset (%37,8).
       Motor hiç çizmiyordu.

       Halka DÖRT ŞERİT olarak çiziliyor, tek bir büyük dikdörtgenin
       üstüne küçüğü değil: saydam bir kenarlıkta üst üste binen köşeler
       iki kez harmanlanır ve dört köşe gövdeden koyu çıkardı. Sol ve sağ
       şeritler bu yüzden dikeyde kenarlık kalınlığı kadar içeri
       çekiliyor.

       İç kenarlık dıştakinin BİTTİĞİ yerden başlıyor (`prev`): ikisi de
       kenardan ölçseydi iç kenarlık dışın altına gizlenirdi.

       Kalınlık her eksende ekranın kendi oranı — MilkDrop da böyle. Geniş
       ekranda yan şeritler üst/alttakinden fiziksel olarak daha kalın
       görünür; en-boy düzeltmesi eklemek burada MilkDrop'tan ayrılmak
       olurdu. */
    _drawBorders(gl) {
      const P = this.preset;
      if (!P || this._wantAcc === false) return;
      /* Kenarlık rengi de COLOR_NORM'dan geçiyor (milkdropfs.cpp:3245-3248):
         kenetleme değil, 256'ya göre sarma. */
      const cn = window.SVMilkdrop.colorNorm;
      const rings = [
        { size: P.get('ob_size'), prev: 0,
          c: [cn(P.get('ob_r')), cn(P.get('ob_g')), cn(P.get('ob_b')), cn(P.get('ob_a'))] },
        { size: P.get('ib_size'), prev: P.get('ob_size'),
          c: [cn(P.get('ib_r')), cn(P.get('ib_g')), cn(P.get('ib_b')), cn(P.get('ib_a'))] },
      ];
      let used = false;
      const d = this.lineData;
      for (const r of rings) {
        const size = isFinite(r.size) ? r.size : 0;
        const prev = isFinite(r.prev) && r.prev > 0 ? r.prev : 0;
        if (!(size > 0) || !(r.c[3] > 0.002)) continue;
        const p0 = prev;
        const p1 = Math.min(1, size + prev);
        const quads = [
          [-1 + p0, -1 + p1, -1 + p1, 1 - p1],   // sol
          [1 - p1, 1 - p0, -1 + p1, 1 - p1],     // sağ
          [-1 + p0, 1 - p0, -1 + p0, -1 + p1],   // alt
          [-1 + p0, 1 - p0, 1 - p1, 1 - p0],     // üst
        ];
        let n = 0;
        for (const [x0, x1, y0, y1] of quads) {
          const v = [[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]];
          for (const [x, y] of v) {
            const k = n * 6;
            d[k] = x; d[k + 1] = y;
            d[k + 2] = r.c[0]; d[k + 3] = r.c[1]; d[k + 4] = r.c[2]; d[k + 5] = r.c[3];
            n++;
          }
        }
        if (!used) {
          gl.useProgram(this.lineProg);
          gl.bindVertexArray(this.lineVao);
          this._blend(gl, false);
          used = true;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, n * 6);
        gl.drawArrays(gl.TRIANGLES, 0, n);
      }
      if (used) {
        gl.bindVertexArray(null);
        gl.disable(gl.BLEND);
      }
    }

    _drawMotionVectors(gl, GW, GH) {
      const P = this.preset;
      if (!P) return;
      const a = +P.get('mv_a');
      if (!isFinite(a) || a <= 0.002) return;
      const nx = Math.round(+P.get('mv_x'));
      const ny = Math.round(+P.get('mv_y'));
      if (!(nx >= 1) || !(ny >= 1)) return;
      /* Üst sınır: preset per_frame içinde saçma bir sayı yazabiliyor ve
         çizgi tamponu 512 düğümlük. */
      const NX = Math.min(64, nx);
      const NY = Math.min(64, ny);
      const len = +P.get('mv_l');
      const dx0 = +P.get('mv_dx') || 0;
      const dy0 = +P.get('mv_dy') || 0;
      /* milkdropfs.cpp:1235-1238 — hareket vektörünün dört kanalı da
         COLOR_NORM'dan geçiyor. */
      const cn = window.SVMilkdrop.colorNorm;
      const r = cn(P.get('mv_r')), g = cn(P.get('mv_g')), b = cn(P.get('mv_b'));
      const al = cn(a);
      const L = isFinite(len) ? len : 1;

      const v = this.verts;
      const n = this.meshX + 1;
      /* Izgara noktasındaki warp'ı ağdan iki doğrusal ara değerle okuyor.
         En yakın düğümü almak, ağdan seyrek ızgaralarda vektörleri
         basamaklı gösteriyor. */
      const sampleUV = (x, y, out) => {
        const fx = Math.max(0, Math.min(this.meshX, x * this.meshX));
        const fy = Math.max(0, Math.min(this.meshY, y * this.meshY));
        const i0 = Math.min(this.meshX - 1, Math.floor(fx));
        const j0 = Math.min(this.meshY - 1, Math.floor(fy));
        const tx = fx - i0, ty = fy - j0;
        const o00 = (j0 * n + i0) * VSTRIDE;
        const o10 = (j0 * n + i0 + 1) * VSTRIDE;
        const o01 = ((j0 + 1) * n + i0) * VSTRIDE;
        const o11 = ((j0 + 1) * n + i0 + 1) * VSTRIDE;
        const mix = (p, q, t) => p + (q - p) * t;
        out[0] = mix(mix(v[o00 + 2], v[o10 + 2], tx), mix(v[o01 + 2], v[o11 + 2], tx), ty);
        out[1] = mix(mix(v[o00 + 3], v[o10 + 3], tx), mix(v[o01 + 3], v[o11 + 3], tx), ty);
      };

      const d = this.lineData;
      const uv = this._mvUV || (this._mvUV = [0, 0]);
      let count = 0;
      const push = (x, y) => {
        const k = count * 6;
        d[k] = x * 2 - 1;
        d[k + 1] = this._toClipY(y);
        d[k + 2] = r; d[k + 3] = g; d[k + 4] = b; d[k + 5] = al;
        count++;
      };

      gl.useProgram(this.lineProg);
      gl.bindVertexArray(this.lineVao);
      this._blend(gl, false);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
      /* Tampon dolunca BOŞALTILIYOR, kesilmiyor: 64x48'lik bir ızgara 3072
         vektör demek ve çizgi tamponu 512 düğümlük. Kesmek ızgaranın
         yalnızca üst şeridini çizerdi. */
      const flush = () => {
        if (count < 2) { count = 0; return; }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, count * 6);
        /* Vektörler de şişiriliyor. MilkDrop onları KALINLAŞTIRMIYOR
           (milkdropfs.cpp:1314, tek bir LINELIST çizimi), ama kendi
           tamponunda bir teksel olan çizgi bizim tamponumuzda yine bir
           PİKSEL kalıyordu — 1920 genişlikte MilkDrop'un gördüğünün dörtte
           biri. Telafi çözünürlük içindir, `thick` için değil; çarpan 1.
           Korpusta 884 preset (%8,6) hareket vektörü çiziyor. */
        this._strip(gl, gl.LINES, d, count, -1, GW, GH, 1);
        count = 0;
      };
      for (let j = 0; j < NY; j++) {
        for (let i = 0; i < NX; i++) {
          const x = (i + 0.5) / NX + dx0;
          const y = (j + 0.5) / NY + dy0;
          if (x < 0 || x > 1 || y < 0 || y > 1) continue;
          sampleUV(x, y, uv);
          if (!isFinite(uv[0]) || !isFinite(uv[1])) continue;
          /* Vektör, noktanın örneklediği yerden noktanın KENDİSİNE doğru:
             görüntünün aktığı yönü gösteriyor. Ters çizmek akışı geriye
             akıyormuş gibi gösterirdi. */
          const ex = x + (x - uv[0]) * L;
          const ey = y + (y - uv[1]) * L;
          if (!isFinite(ex) || !isFinite(ey)) continue;
          if (count + 2 > 512) flush();
          push(x, y);
          push(ex, ey);
        }
      }
      flush();
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }

    /* Warp ağı: her düğümde per_pixel koşuyor ve düğümün önceki kareden
       nereyi örnekleyeceği çıkıyor. */
    /* MilkDrop'un DİKEY EKSENİ ile bizimki ters.

       MilkDrop düğüm dönüşümünü v ekseni YUKARIDAN AŞAĞI akan bir uzayda
       yapıyor: `y = 0` ekranın üstü. Bizim doku eksenimiz OpenGL'in kendi
       eksenidir, `v = 0` altta. İki uzay da kendi içinde tutarlı olduğu
       için hiçbir hata çıkmıyordu — yalnız `dy`, `cy` ve dönme yönü
       aynadan bakıyordu.

       ÖLÇÜLDÜ: merkezde sabit bir şekil, `dy = +0,02`, başka hiçbir
       hareket yok. Motorumuzda izin ağırlık merkezi 0,294'e (yukarı),
       `dy = -0,02` ile 0,602'ye (aşağı) gidiyordu. MilkDrop'un cebri
       tersini söylüyor: örnek noktası `v -= dy` ile kayıyor ve v yukarıdan
       aşağı olduğu için pozitif `dy` görüntüyü AŞAĞI taşır.

       Korpusta presetlerin %48,8'i `dy` ya da `cy` kullanıyor, %49,5'i de
       sıfırdan farklı bir `rot` yazıyor — ayna dönmenin yönünü de çeviriyor.

       Düzeltme iki SINIRDA duruyor: denklemlere giren `y` ve dokuya çıkan
       `v`. Aradaki dönüşüm olduğu gibi kalıyor, çünkü MilkDrop uzayına
       geçtikten sonra zaten doğru uzayda çalışıyor. Şekiller, dalgalar ve
       hareket vektörleri bu eksende ZATEN doğruydu (`_toClipY`); ters olan
       yalnız ağdı. */
    /* Ağı KURAR — geçiş varsa iki kez.

       MilkDrop geçiş sırasında per_vertex denklemlerini İKİ PRESET için de
       koşturuyor, iki UV ağı üretiyor ve o ağları düğüm başına karıştırıyor
       (`ComputeGridAlphaValues`). Karışım oranı düğümün kendi rampasından
       geliyor: `mix2 = a * ilerleme + c`, 0..1'e kenetli. Aynı oran düğümün
       ALFASI olarak da yazılıyor ve iki presetin shader'ları o alfayla üst
       üste çiziliyor.

       Bu yüzden ikinci bir geri besleme tamponu ya da ikinci bir bulanıklık
       zinciri YOK: MilkDrop'ta da tek tampon var. Geçişte iki olan şey
       denklemler ve shader'lar, hedefler değil. */
    _buildWarpMesh() {
      this._warpMeshPass(this.preset, this.time, 0);
      if (this.oldPreset) {
        this._ensureBlendPattern();
        this._warpMeshPass(this.oldPreset, this.oldTime, 1);
      }
    }

    _warpMeshPass(P, clock, rep) {
      const n = this.meshX + 1;
      const v = this.verts;
      const acc = this._wantAcc !== false;
      const bA = this.blendA, bC = this.blendC;
      const prog = this.blendProg;

      /* WARP TITRESIMI — MilkDrop'un kendi katsayilari.

         Burada dort sabit vardi (5, 3, 4, 2) ve preset dosyasindaki iki
         ayar hic okunmuyordu. MilkDrop'ta desenin frekanslari SABIT
         DEGIL: dordu de kendi hizlarinda salinan kosinuslerle suruluyor,
         yani desen zamanla kendini yeniden dokuyor. Sabit katsayilarla
         cikan sey duran tek bir dalga desenidir.

         `fWarpScale` desenin BOYUTUNU verir (tersiyle carpiliyor: buyuk
         olcek = seyrek dalga), `fWarpAnimSpeed` de zamanini. Korpusta
         8.265 preset (%79,9) varsayilandan farkli bir olcek, 4.556'si
         (%44,0) farkli bir hiz yaziyor — yani ikisi de istisna degil,
         kural.

         Sifira bolme korunuyor: `fWarpScale = 0` yazan bir preset var
         olabilir ve sonsuz bir frekans butun agi katlardi. */
      const wSpeed = acc ? (P.get('warpanimspeed') || 1) : 1;
      const wScaleRaw = acc ? (P.get('warpscale') || 1) : 1;
      const wScale = Math.abs(wScaleRaw) < 1e-4 ? 1e-4 : wScaleRaw;
      const warpTime = clock * wSpeed;
      const wsi = 1 / wScale;
      const wf0 = 11.68 + 4.0 * Math.cos(warpTime * 1.413 + 10);
      const wf1 = 8.77 + 3.0 * Math.cos(warpTime * 1.113 + 7);
      const wf2 = 10.54 + 3.0 * Math.cos(warpTime * 1.233 + 3);
      const wf3 = 11.49 + 4.0 * Math.cos(warpTime * 0.933 + 5);
      for (let j = 0; j <= this.meshY; j++) {
        for (let i = 0; i <= this.meshX; i++) {
          const u = i / this.meshX;
          const w = j / this.meshY;
          const cx0 = u * 2 - 1;
          const cy0 = w * 2 - 1;
          let rad, ang, su, sv, fv;

          if (acc) {
            /* MilkDrop'un düğüm dönüşümü, kendi sırasıyla.

               `rad` ÖLÇEKLENMİYOR: MilkDrop'ta köşede 1'i aşıyor (kare
               ekranda √2'ye kadar). Bizde 0,7071 ile çarpılıp 1'e
               kenetleniyordu, yani `pow(zoom, pow(zoomexp, rad*2-1))`
               üssünün üst yarısı hiç kullanılmıyordu — zumun kenara doğru
               açılması olduğundan zayıf kalıyordu. `ang` de (-π, π]
               aralığında kalıyor; 0..2π'ye kaydırmak `ang`i tamsayı
               olmayan bir çarpanla kullanan presetleri kaydırıyordu.
               Tam merkezdeki düğüm 0 sabitleniyor, yoksa atan2 orada
               ızgara sıklığına göre rastgele bir yön veriyor.

               EN-BOY dönüşümün İÇİNDE: başta uygulanıp sonunda geri
               alınıyor. Aradaki adımlar (gerdirme, warp, dönme, öteleme)
               bu yüzden kare bir uzayda çalışıyor ve geniş ekranda daire
               daire kalıyor. Motorda en-boy ağa hiç girmiyordu.

               SIRA da farklıydı: zum merkez etrafında değil EKRAN
               ORTASINDA, ardından gerdirme, warp, dönme, öteleme.
               Motorda zum ile dönme yer değiştirmiş, warp da en sona
               atılmıştı — `rot` ve `cx/cy` birlikte kullanan presetlerde
               sonuç bambaşka çıkıyordu.

               Dikey çevirme artık formülün kendisinde (`-y`), ayrı bir
               `1 - w` adımı YOK; ikisi birden olsaydı çevirme iki kez
               uygulanır ve görüntü baş aşağı dönerdi. */
            const ax = this._aspX || 1;
            const ay = this._aspY || 1;
            rad = Math.sqrt(cx0 * cx0 * ax * ax + cy0 * cy0 * ay * ay);
            ang = (i === (this.meshX >> 1) && j === (this.meshY >> 1))
              ? 0 : Math.atan2(cy0 * ay, cx0 * ax);

            const p = P.pixel(cx0 * 0.5 * ax + 0.5, cy0 * -0.5 * ay + 0.5,
              rad, ang, this._pix);

            const zoomExp = p.zoomexp === 0 ? 1 : p.zoomexp;
            const zoom = p.zoom === 0 ? 1 : p.zoom;
            const z = Math.pow(zoom, Math.pow(zoomExp, rad * 2 - 1)) || 1;
            const zi = 1 / z;
            const cx = p.cx;
            const cy = p.cy;
            su = cx0 * ax * 0.5 * zi + 0.5;
            sv = cy0 * -ay * 0.5 * zi + 0.5;

            const sx = p.sx === 0 ? 1 : p.sx;
            const sy = p.sy === 0 ? 1 : p.sy;
            su = (su - cx) / sx + cx;
            sv = (sv - cy) / sy + cy;

            const wr = p.warp * 0.0035;
            if (wr !== 0) {
              su += wr * Math.sin(warpTime * 0.333 + wsi * (cx0 * wf0 - cy0 * wf3));
              sv += wr * Math.cos(warpTime * 0.375 - wsi * (cx0 * wf2 + cy0 * wf1));
              su += wr * Math.cos(warpTime * 0.753 - wsi * (cx0 * wf1 - cy0 * wf2));
              sv += wr * Math.sin(warpTime * 0.825 + wsi * (cx0 * wf0 + cy0 * wf3));
            }

            const du = su - cx;
            const dv = sv - cy;
            const ca = Math.cos(p.rot);
            const sa = Math.sin(p.rot);
            su = du * ca - dv * sa + cx;
            sv = du * sa + dv * ca + cy;

            su -= p.dx;
            sv -= p.dy;

            // en-boyu geri al
            su = (su - 0.5) / ax + 0.5;
            sv = (sv - 0.5) / ay + 0.5;

            // MilkDrop'un v ekseni yukarıdan aşağı, bizimki aşağıdan yukarı
            fv = 1 - sv;
          } else {
            /* Motorun eski yaklaşımı — anahtar kapalıyken satır satır
               eskisi. Yeni yola bakarak "sadeleştirmek" iki yolu
               birbirine yaklaştırır ve anahtarın anlamını götürür. */
            rad = Math.min(1, Math.hypot(cx0, cy0) * 0.7071);
            ang = Math.atan2(cy0, cx0);
            if (ang < 0) ang += Math.PI * 2;
            const p = P.pixel(u, w, rad, ang, this._pix);
            const zoomExp = p.zoomexp === 0 ? 1 : p.zoomexp;
            const zoom = p.zoom === 0 ? 1 : p.zoom;
            const z = Math.pow(zoom, Math.pow(zoomExp, rad * 2 - 1)) || 1;
            const cx = p.cx;
            const cy = p.cy;
            su = (u - cx) / z + cx;
            sv = (w - cy) / z + cy;
            const ca = Math.cos(p.rot);
            const sa = Math.sin(p.rot);
            const du = su - cx;
            const dv = sv - cy;
            su = du * ca - dv * sa + cx;
            sv = du * sa + dv * ca + cy;
            const sx = p.sx === 0 ? 1 : p.sx;
            const sy = p.sy === 0 ? 1 : p.sy;
            su = (su - cx) / sx + cx;
            sv = (sv - cy) / sy + cy;
            su -= p.dx;
            sv -= p.dy;
            const wr = p.warp * 0.0035;
            if (wr !== 0) {
              su += wr * Math.sin(warpTime * 0.333 + cx0 * 5 + cy0 * 3);
              sv += wr * Math.cos(warpTime * 0.375 - cx0 * 3 + cy0 * 5);
              su += wr * Math.cos(warpTime * 0.753 - cx0 * 4 - cy0 * 2);
              sv += wr * Math.sin(warpTime * 0.825 + cx0 * 2 - cy0 * 4);
            }
            fv = sv;
          }

          const nv = j * n + i;
          const o = nv * VSTRIDE;
          const su2 = isFinite(su) ? su : u;
          const fv2 = isFinite(fv) ? fv : w;
          if (rep === 0) {
            v[o] = cx0;
            v[o + 1] = cy0;
            v[o + 2] = su2;
            v[o + 3] = fv2;
            v[o + 4] = u;
            v[o + 5] = w;
            v[o + 6] = rad;
            v[o + 7] = ang;
            v[o + 8] = 1;
          } else {
            /* İkinci geçiş ESKİ preseti hesaplıyor ve YENİNİN üstüne
               karıştırıyor. `mix2` 0 iken düğüm tümüyle eski presetin
               ağında, 1 iken yeninin; rampanın eğimini ve kaymasını
               `blendA`/`blendC` veriyor, yani geçişin deseni.

               rad/ang karıştırılmıyor: ikisi de düğümün GEOMETRİSİ,
               presetten bağımsız. MilkDrop da onları bir kez hesaplayıp
               iki geçişte de aynısını kullanıyor. */
            let m2 = bA[nv] * prog + bC[nv];
            m2 = m2 < 0 ? 0 : m2 > 1 ? 1 : m2;
            v[o + 2] = v[o + 2] * m2 + su2 * (1 - m2);
            v[o + 3] = v[o + 3] * m2 + fv2 * (1 - m2);
            v[o + 8] = m2;
          }
        }
      }
    }

    /* GEÇİŞ DESENİ (MilkDrop: RandomizeBlendPattern).

       Geçiş her yerde aynı anda olmuyor: ekranın bir bölgesi diğerinden
       önce yeni presete dönüyor ve MilkDrop'un geçişini tanınır kılan şey
       bu. Düğüm başına iki sayı tutuluyor — eğim `a` ve kayma `c` — ve
       karışım `a * ilerleme + c` olarak çıkıyor.

       Üç desen var ve DÖRDÜNCÜSÜ (her yerde aynı anda) MilkDrop'ta
       BİLEREK seçilemez: kaynaktaki not, tekdüze bir karışımın iki
       shader'ı da her pikselde koşturduğu için yarı hızda olduğunu
       söylüyor. `1 + rastgele%3` yazması bu yüzden.

       `band` desenin GEÇİŞ BÖLGESİNİN genişliği: küçük olursa keskin bir
       sınır, büyük olursa yumuşak bir geçiş. */
    _ensureBlendPattern() {
      const n = (this.meshX + 1) * (this.meshY + 1);
      if (!this.blendDirty && this.blendA && this.blendA.length === n) return;
      this.blendDirty = false;
      if (!this.blendA || this.blendA.length !== n) {
        this.blendA = new Float32Array(n);
        this.blendC = new Float32Array(n);
      }
      const A = this.blendA, C = this.blendC;
      const gx = this.meshX, gy = this.meshY;
      const ax = this._aspX || 1, ay = this._aspY || 1;
      const R = Math.random;
      const type = 1 + Math.floor(R() * 3);
      if (type === 1) {
        // Yönlü silme: rastgele bir açıda ilerleyen bir bant
        const ang = R() * 6.28;
        const vx = Math.cos(ang), vy = Math.sin(ang);
        const band = 0.1 + 0.2 * R();
        const inv = 1 / band;
        let k = 0;
        for (let y = 0; y <= gy; y++) {
          const fy = (y / gy) * ay;
          for (let x = 0; x <= gx; x++) {
            const fx = (x / gx) * ax;
            let t = (fx - 0.5) * vx + (fy - 0.5) * vy + 0.5;
            t = (t - 0.5) / Math.SQRT2 + 0.5;
            A[k] = inv * (1 + band);
            C[k] = -inv + inv * t;
            k++;
          }
        }
      } else if (type === 2) {
        // Plazma: orta nokta yer değiştirmesiyle üretilen düzensiz bir alan
        const band = 0.12 + 0.13 * R();
        const inv = 1 / band;
        C.fill(0);
        C[0] = R();
        C[gx] = R();
        C[gy * (gx + 1)] = R();
        C[gy * (gx + 1) + gx] = R();
        this._genPlasma(0, gx, 0, gy, 0.25);
        let mn = C[0], mx = C[0];
        for (let i = 0; i < n; i++) { if (C[i] < mn) mn = C[i]; if (C[i] > mx) mx = C[i]; }
        const mul = mx > mn ? 1 / (mx - mn) : 1;
        for (let i = 0; i < n; i++) {
          const t = (C[i] - mn) * mul;
          A[i] = inv * (1 + band);
          C[i] = -inv + inv * t;
        }
      } else {
        // Dairesel: içten dışa ya da dıştan içe
        const band = 0.02 + 0.14 * R() + 0.34 * R();
        const inv = 1 / band;
        const dir = Math.random() < 0.5 ? -1 : 1;
        let k = 0;
        for (let y = 0; y <= gy; y++) {
          const dy = (y / gy - 0.5) * ay;
          for (let x = 0; x <= gx; x++) {
            const dx = (x / gx - 0.5) * ax;
            let t = Math.sqrt(dx * dx + dy * dy) * 1.41421;
            if (dir === -1) t = 1 - t;
            A[k] = inv * (1 + band);
            C[k] = -inv + inv * t;
            k++;
          }
        }
      }
    }

    /* Elmas-kare (orta nokta yer değiştirmesi). Köşelerden başlayıp her
       adımda ikiye bölüyor ve orta noktalara azalan genlikte gürültü
       ekliyor; MilkDrop'un plazma geçişinin kaynağı bu. */
    _genPlasma(x0, x1, y0, y1, dt) {
      const C = this.blendC;
      const n = this.meshX + 1;
      const ax = this._aspX || 1, ay = this._aspY || 1;
      const midx = (x0 + x1) >> 1, midy = (y0 + y1) >> 1;
      let t00 = C[y0 * n + x0], t01 = C[y0 * n + x1];
      let t10 = C[y1 * n + x0], t11 = C[y1 * n + x1];
      const jit = (m) => (Math.random() * 2 - 1) * dt * m;
      if (y1 - y0 >= 2) {
        if (x0 === 0) C[midy * n + x0] = 0.5 * (t00 + t10) + jit(ay);
        C[midy * n + x1] = 0.5 * (t01 + t11) + jit(ay);
      }
      if (x1 - x0 >= 2) {
        if (y0 === 0) C[y0 * n + midx] = 0.5 * (t00 + t01) + jit(ax);
        C[y1 * n + midx] = 0.5 * (t10 + t11) + jit(ax);
      }
      if (y1 - y0 >= 2 && x1 - x0 >= 2) {
        t00 = C[midy * n + x0];
        t01 = C[midy * n + x1];
        t10 = C[y0 * n + midx];
        t11 = C[y1 * n + midx];
        C[midy * n + midx] = 0.25 * (t00 + t01 + t10 + t11) + jit(1);
        const d = dt * 0.5;
        this._genPlasma(x0, midx, y0, midy, d);
        this._genPlasma(midx, x1, y0, midy, d);
        this._genPlasma(x0, midx, midy, y1, d);
        this._genPlasma(midx, x1, midy, y1, d);
      }
    }

    /* Üç kademe bulanık kopya. Her kademe bir öncekinin yarısı boyutunda ve
       yatay+dikey iki geçişten geçiyor: ayrılabilir Gauss iki geçişte
       tek geçişli bir çekirdeğin karesi kadar iş yapıyor. */
    /* Kademe basina yaz-oku olcegi.

       MilkDrop bulanik kopyayi presetin b1n/b1x araligina sikistirarak
       sakliyor: 8 bitlik dokunun tamami dar bir aralikta kullaniliyor.
       Ikinci ve ucuncu kademenin araligi BIR ONCEKI kademenin araligina
       gore veriliyor, cunku girdisi zaten sikistirilmis olan o doku.

       Sifira bolme korunuyor: b1n ile b1x'i esit yazan bir preset var
       olabilir ve sonsuz bir olcek butun kareyi beyaza cevirirdi. */
    _blurScaleBias(acc) {
      const out = [[1, 0], [1, 0], [1, 0]];
      if (!acc || !this.preset) return out;
      const key = ['b1', 'b2', 'b3'];
      const mn = [], mx = [];
      for (let i = 0; i < 3; i++) {
        const a = this.preset.get(key[i] + 'n');
        const b = this.preset.get(key[i] + 'x');
        mn.push(isFinite(a) ? a : 0);
        mx.push(isFinite(b) ? b : 1);
      }
      const safe = (d) => (Math.abs(d) < 1e-6 ? 1e-6 : d);
      let sc = 1 / safe(mx[0] - mn[0]);
      out[0] = [sc, -mn[0] * sc];
      for (let i = 1; i < 3; i++) {
        const span = safe(mx[i - 1] - mn[i - 1]);
        const lo = (mn[i] - mn[i - 1]) / span;
        const hi = (mx[i] - mn[i - 1]) / span;
        sc = 1 / safe(hi - lo);
        out[i] = [sc, -lo * sc];
      }
      return out;
    }

    /* Bu karede üretilmesi gereken kademe sayısı. Geçiş sırasında eski
       presetin aşamaları da çiziyor, onlar da sayılıyor. */
    _blurNeed() {
      const lv = (p) => (p && p.blurLevel) || 0;
      return Math.max(lv(this.warpPreset), lv(this.compPreset),
        lv(this.oldWarpPreset), lv(this.oldCompPreset));
    }

    _buildBlur(srcTex, need) {
      const gl = this.gl;
      const acc = this._wantAcc !== false;
      /* `need` verilmediyse hepsi — çağıranı unutmak sessizce YANLIŞ
         görüntü değil, yalnızca eski maliyet demek. */
      const levels = typeof need === 'number'
        ? Math.max(0, Math.min(this.blur.length, need)) : this.blur.length;
      if (levels === 0) return;
      gl.useProgram(this.blurProg);
      gl.uniform1i(this.locBlur.uSrc, 0);
      gl.bindVertexArray(this.quadVao);
      gl.activeTexture(gl.TEXTURE0);
      const L = this.locBlur;
      const setK = (k) => {
        gl.uniform4f(L.uW, k.w[0], k.w[1], k.w[2], k.w[3]);
        gl.uniform4f(L.uD, k.d[0], k.d[1], k.d[2], k.d[3]);
        gl.uniform1f(L.uCenter, k.center);
        gl.uniform1f(L.uNorm, k.norm);
      };
      const setSB = (sc, bi) => {
        gl.uniform1f(L.uScale, sc);
        gl.uniform1f(L.uBias, bi);
      };
      /* Karartma YALNIZ ILK dikey gecise uygulaniyor — MilkDrop kaynagi
         bunu ayrica not ediyor: her kademede tekrarlanirsa cok bulanik
         kademelerin ust ve sol kenarinda kalin siyah cizgiler cikiyor.
         Korpusta 7.094 preset (%68,6) sifirdan buyuk bir deger yaziyor,
         1.544'u de (%14,9) hic yazmayip varsayilan 0,25'i aliyor. */
      const ed = acc ? Math.max(0, Math.min(1,
        this.preset ? (this.preset.get('b1ed') || 0) : 0)) : 0;
      const setEdge = (on) => {
        if (!L.uEdge) return;
        if (on) gl.uniform3f(L.uEdge, 1 - ed, ed, 5.0);
        else gl.uniform3f(L.uEdge, 1, 0, 5.0);
      };
      const sb = this._blurScaleBias(acc);
      const kH = acc ? BLUR_KERNEL.h : BLUR_KERNEL.legacy;
      const kV = acc ? BLUR_KERNEL.v : BLUR_KERNEL.legacy;
      /* Tap uzakliklari KAYNAK dokunun tekseli cinsinden. Yatay ve dikey
         hedefler artik farkli boyutta oldugu icin adim hedefe gore
         hesaplanamaz: hedefin tekseliyle carpmak cekirdegi kademe basina
         sessizce genisletir ya da daraltirdi. */
      const t0 = this.targets ? this.targets[0] : null;
      let input = srcTex;
      let iw = (t0 && t0.w) || 1;
      for (let i = 0; i < levels; i++) {
        const b = this.blur[i];
        gl.bindFramebuffer(gl.FRAMEBUFFER, b.tmp.fb);
        gl.viewport(0, 0, b.hw, b.hh);
        gl.bindTexture(gl.TEXTURE_2D, input);
        gl.uniform2f(L.uStep, 1 / iw, 0);
        setK(kH);
        setSB(1, 0);
        setEdge(false);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        gl.bindFramebuffer(gl.FRAMEBUFFER, b.out.fb);
        gl.viewport(0, 0, b.w, b.h);
        gl.bindTexture(gl.TEXTURE_2D, b.tmp.tex);
        gl.uniform2f(L.uStep, 0, 1 / b.hh);
        setK(kV);
        /* Olcek yalnizca IKINCI gecise uygulaniyor. Olcekleme dogrusal
           oldugu icin bulaniklikla yer degistirebiliyor; ara sonucu
           kirpmadan gecirmek daha az bilgi kaybediyor. */
        setSB(sb[i][0], sb[i][1]);
        setEdge(i === 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        input = b.out.tex;
        iw = b.w;
      }
      gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      /* MIPMAP (#560, madde 1). Cerceve tamponu birakildiktan SONRA
         uretiliyor: doku hala bagli bir hedefe iliskiliyken mipmap
         uretmek surucu basina degisen bir gri alan. Yalnizca `out`
         kademeleri — presetin okudugu dokular onlar; `tmp` ara sonuc ve
         yalnizca tam cozunurlukte bir kez okunuyor. */
      if (this._blurMip) {
        // Üretilmeyen kademenin mipmapı da gereksiz: kimse okumuyor.
        for (let i = 0; i < levels; i++) {
          gl.bindTexture(gl.TEXTURE_2D, this.blur[i].out.tex);
          gl.generateMipmap(gl.TEXTURE_2D);
        }
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
    }

    /* MilkDrop'un ekran koordinatı: x,y 0..1 ve y AŞAĞI doğru artıyor.
       GL'de y yukarı; çevirmezsek her şekil yatay eksende aynalanır ve
       simetrik olmayan presetler ters görünür. */
    _toClipY(y) { return 1 - 2 * y; }

    _blend(gl, additive) {
      /* Kenar yumuşatmalı yol alfa tavanını buna göre seçiyor: toplamalı
         karışımda 1 aşılabilir, saydam karışımda aşılamaz. */
      this._aaAdditive = !!additive;
      gl.enable(gl.BLEND);
      if (additive) gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    /* Custom şekiller. Referans preset paketinde %48'i bunları kullanıyor.

       Her şekil bir üçgen yelpazesi: merkez rengi (r,g,b,a), kenar rengi
       (r2,g2,b2,a2). Bu iki renk MilkDrop'ta bilerek ayrı — çoğu preset
       merkezi opak, kenarı saydam bırakıp yumuşak bir leke elde ediyor.
       İkisini eşitlemek şekilleri düz disklere çevirirdi. */
    /* `P` hangi presetin şekilleri, `am` de alfa çarpanı: geçiş sırasında
       iki presetin şekilleri de çiziliyor ve hangisinin ne kadar
       görüneceğini bu çarpan söylüyor (MilkDrop: `alpha_mult`). Geçiş
       yokken 1, yani çarpan görünmez. */
    _drawShapes(gl, GW, GH, preset, am) {
      const P = preset || this.preset;
      if (!P || !P.shapes || !P.shapes.length) return;
      const aMul = typeof am === 'number' ? Math.max(0, Math.min(1, am)) : 1;
      if (aMul <= 0.002) return;
      const d = this.lineData;
      /* En-boy düzeltmesi X'E uygulanıyor, Y'ye değil — MilkDrop da öyle.
         Y'yi büyütmek de çemberi çember yapar ama yarıçapın anlamını
         değiştirir: MilkDrop'ta `rad` ekran YÜKSEKLİĞİNİN oranı, ve
         presetler değerlerini ona göre seçmiş. Y'den ölçeklersek geniş
         ekranda bütün şekiller olduğundan büyük çıkıyor. */
      const aspY = GW > GH ? GH / GW : 1;
      /* MilkDrop çokgeni çeyrek tur döndürerek başlatıyor. Dört kenarlı bir
         şekil bu yüzden kare değil BAKLAVA görünür; kaldırırsak düşük
         kenarlı bütün şekiller 45 derece dönmüş olur. */
      const ANG0 = Math.PI * 0.25;
      const out = this._shapeOut || (this._shapeOut = {});
      gl.useProgram(this.lineProg);
      gl.bindVertexArray(this.lineVao);
      for (const s of P.shapes) {
        if (!s.enabled) continue;
        for (let inst = 0; inst < s.instances; inst++) {
          const o = P.shapeFrame(s, inst, out);
          if (!o) continue;
          const rad = +o.rad;
          if (!isFinite(rad) || rad <= 0) continue;
          const cxp = +o.x * 2 - 1;
          const cyp = this._toClipY(+o.y);
          if (!isFinite(cxp) || !isFinite(cyp)) continue;
          const ang0 = +o.ang || 0;
          const n = s.sides;
          /* milkdropfs.cpp:2185-2192. `alpha_mult` COLOR_NORM'un İÇİNDE:
             önce çarpılıyor, sonra 8 bite iniyor. Dışında yapmak geçiş
             sırasında başka bir alfa verirdi. */
          const cn = window.SVMilkdrop.colorNorm;
          const c1 = [cn(o.r), cn(o.g), cn(o.b), cn((+o.a || 0) * aMul)];
          const c2 = [cn(o.r2), cn(o.g2), cn(o.b2), cn((+o.a2 || 0) * aMul)];

          if (s.textured) {
            /* DOKULU: şekil, önceki karenin üstünde bir pencere. Merkez
               dokunun ortasına oturuyor, kenar noktaları tex_zoom'a göre
               ölçekli bir yarıçapa; tex_ang örneklemeyi döndürüyor. Renk
               dokuyla ÇARPILIYOR, onun yerine geçmiyor. */
            const td = this.shapeTexData;
            const tz = Math.abs(+o.tex_zoom) > 1e-4 ? +o.tex_zoom : 1;
            const ta = +o.tex_ang || 0;
            td[0] = cxp; td[1] = cyp;
            td[2] = c1[0]; td[3] = c1[1]; td[4] = c1[2]; td[5] = c1[3];
            td[6] = 0.5; td[7] = 0.5;
            for (let i = 0; i <= n; i++) {
              const th = ang0 + ANG0 + (i / n) * Math.PI * 2;
              const k = (i + 1) * 8;
              td[k] = cxp + Math.cos(th) * rad * aspY;
              td[k + 1] = cyp + Math.sin(th) * rad;
              td[k + 2] = c2[0]; td[k + 3] = c2[1]; td[k + 4] = c2[2]; td[k + 5] = c2[3];
              /* Doku y ekseni AŞAĞI artıyor (MilkDrop ekran koordinatı),
                 konumun y'si ise yukarı — işaret bu yüzden ters. */
              td[k + 6] = 0.5 + 0.5 * Math.cos(th + ta) / tz;
              td[k + 7] = 0.5 - 0.5 * Math.sin(th + ta) / tz;
            }
            this._blend(gl, s.additive);
            gl.useProgram(this.shapeTexProg);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this._shapeSrcTex);
            gl.uniform1i(this.locShapeTexSrc, 0);
            gl.bindVertexArray(this.shapeTexVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.shapeTexVbo);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, td, 0, (n + 2) * 8);
            gl.drawArrays(gl.TRIANGLE_FAN, 0, n + 2);
            // Kenar çizgisi düz renk: programa geri dönülüyor.
            gl.useProgram(this.lineProg);
            gl.bindVertexArray(this.lineVao);
          } else {
            // merkez + n kenar noktası + kapanış = yelpaze
            d[0] = cxp; d[1] = cyp;
            d[2] = c1[0]; d[3] = c1[1]; d[4] = c1[2]; d[5] = c1[3];
            for (let i = 0; i <= n; i++) {
              const th = ang0 + ANG0 + (i / n) * Math.PI * 2;
              const k = (i + 1) * 6;
              d[k] = cxp + Math.cos(th) * rad * aspY;
              d[k + 1] = cyp + Math.sin(th) * rad;
              d[k + 2] = c2[0]; d[k + 3] = c2[1]; d[k + 4] = c2[2]; d[k + 5] = c2[3];
            }
            this._blend(gl, s.additive);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, (n + 2) * 6);
            gl.drawArrays(gl.TRIANGLE_FAN, 0, n + 2);
          }

          // Kenar çizgisi: MilkDrop border_* renkleriyle ayrı bir geçiş
          const ba = cn((+o.border_a || 0) * aMul);   // milkdropfs.cpp:2235-2238
          if (ba > 0.002) {
            for (let i = 0; i < n; i++) {
              const th = ang0 + ANG0 + (i / n) * Math.PI * 2;
              const k = i * 6;
              d[k] = cxp + Math.cos(th) * rad * aspY;
              d[k + 1] = cyp + Math.sin(th) * rad;
              d[k + 2] = cn(o.border_r); d[k + 3] = cn(o.border_g);
              d[k + 4] = cn(o.border_b); d[k + 5] = ba;
            }
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, n * 6);
            /* KENARLIK ARTIK ŞİŞİRİLİYOR. MilkDrop kenarlığı da dalga gibi
               kalınlaştırıyor (milkdropfs.cpp:2247-2259): `its = thick ? 4 : 1`
               ve dört çizim bir teksellik 2x2 karenin köşelerine kayıyor,
               yani doğrusal kalınlık iki katı — çarpan 4 değil 2.

               Bizde `thick` motora hiç ulaşmıyordu: kenarlık her zaman tek
               çizim, üstelik çözünürlük telafisi de yoktu. 1920 genişlikte
               MilkDrop'un 512'lik tamponunda bir teksel olan çizgi bizde
               dörtte bir kalınlıkta çiziliyordu. Korpusta 2.961 şekil bloğu
               (1.821 preset, %17,6) kenarlık çiziyor; bunların 425'i
               (309 preset, %3,0) `thickOutline` da istiyor. */
            this._strip(gl, gl.LINE_LOOP, d, n, -1, GW, GH, o.thick ? 2 : 1);
          }
        }
      }
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }

    /* Custom dalgalar. Referans pakette %32'si kullanıyor.

       Her nokta için per_point koşuyor ve x/y/renk oradan geliyor; yani
       bunlar "dalga formu" değil, presetin ses verisiyle çizdiği serbest
       eğriler. Sabit bir çizgi çizmek bu presetlerin tamamını kaybettiriyordu. */
    /* `P` ve `am`: şekillerdeki gibi — geçişte iki presetin dalgaları da
       çiziliyor ve alfa çarpanı hangisinin ne kadar göründüğünü veriyor. */
    _drawCustomWaves(gl, audio, preset, am) {
      const P = preset || this.preset;
      if (!P || !P.waves || !P.waves.length) return;
      const tb = audio.timeBytes;
      if (!tb || tb.length < 8) return;
      const aMul = typeof am === 'number' ? Math.max(0, Math.min(1, am)) : 1;
      if (aMul <= 0.002) return;
      const d = this.lineData;
      const out = this._waveOut || (this._waveOut = {});
      const cn = window.SVMilkdrop.colorNorm;
      /* Tayf KARE BASINA BIR KEZ. Bir presette birden fazla tayf dalgasi
         olabiliyor; her biri icin 1024 noktali FFT kosturmak bedava degil.
         Hic tayf dalgasi yoksa hic hesaplanmiyor. */
      let spec = null;
      if (this._wantAcc !== false && P.waves.some((w) => w.enabled && w.spectrum)) {
        const S = window.SVMilkdropAudio;
        if (S && S.MilkdropSpectrum) {
          if (!this._spec) this._spec = new S.MilkdropSpectrum();
          spec = this._spec.update(tb);
        }
      }
      this._specData = spec;
      gl.useProgram(this.lineProg);
      gl.bindVertexArray(this.lineVao);
      for (const w of P.waves) {
        if (!P.waveFrame(w)) continue;
        /* Nokta sayısı per_frame'den SONRA okunuyor: preset onu sesle
           oynatabiliyor. `waveFrame` değeri kırpıp `frameSamples`a koyuyor.
           Eşik MilkDrop'unki: normalde 2, nokta kipinde 1 — tek nokta bir
           çizgi kuramaz ama bir nokta kurar. */
        const N = w.frameSamples;
        if (N < (w.useDots ? 1 : 2)) continue;
        this._customWaveSamples(tb, N, w, audio, P);
        const cw1 = this._cw1, cw2 = this._cw2;
        let count = 0;
        for (let i = 0; i < N; i++) {
          const sample = N > 1 ? i / (N - 1) : 0;
          const o = P.wavePoint(w, sample, cw1[i], cw2[i], out);
          const x = +o.x, y = +o.y;
          if (!isFinite(x) || !isFinite(y)) continue;
          const k = count * 6;
          d[k] = x * 2 - 1;
          d[k + 1] = this._toClipY(y);
          /* milkdropfs.cpp:2487-2490 — nokta başına COLOR_NORM, ve
             `alpha_mult` yine içeride. */
          d[k + 2] = cn(o.r); d[k + 3] = cn(o.g); d[k + 4] = cn(o.b);
          d[k + 5] = cn((+o.a || 0) * aMul);
          count++;
        }
        /* Sonlu olmayan noktalar elendikten SONRA da eşik aynı kalmalı:
           çizgi iki nokta ister, nokta kipi bir. */
        if (count < (w.useDots ? 1 : 2)) continue;
        /* YUMUŞATMA, nokta kipi HARİÇ. Varsayılan dalganın aksine burada
           MilkDrop koşula bağlıyor (milkdropfs.cpp:2508):
               if (!pState->m_wave[i].bUseDots)
                   nSamples = SmoothWave(v, nSamples, v3);
           Mantıklı: nokta kipinde ara noktalar çizgiyi yumuşatmaz, sadece
           iki katı nokta basar. Korpusta 11.884 etkin dalga bloğunun
           4.086'sı nokta kipinde. */
        let vd = d, vn = count;
        if (this._wantAcc !== false && !w.useDots) {
          vd = this.waveData;
          vn = smoothWave(d, count, vd, 0, 0);
        }
        this._blend(gl, w.additive);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, vd, 0, vn * 6);
        const gw = this.gl2.width, gh = this.gl2.height;
        this._strip(gl, w.useDots ? gl.POINTS : gl.LINE_STRIP, vd, vn, -1,
          gw, gh, w.thick ? 2 : 1);
      }
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }

    /* Özel dalganın kendi örnekleri — KENDİ yumuşatmasıyla.

       Her özel dalga bloğunun `smoothing` değişkeni var ve varsayılanı 0,5,
       yani preset hiç yazmasa bile yumuşatma İSTENİYOR. Motor bu değeri
       ayrıştırıyor ama hiç kullanmıyordu: özel dalgaların hepsi ham örnekle
       çiziliyordu. Korpusta presetlerin %32'si özel dalga kullanıyor.

       Filtre kare dalganın filtresinden FARKLI ve bu bilinçli: karışım
       oranı `sqrt(smoothing * 0,98)` ve iki geçiş var — önce ileri, sonra
       geri. Çift geçiş faz kaymasını götürüyor, yani eğri kaymadan
       yumuşuyor. Tek geçiş kullanmak eğriyi bir uçtan öbürüne kaydırırdı.

       Ölçek yumuşatmadan SONRA uygulanıyor; önce uygulansaydı sonuç aynı
       olurdu ama MilkDrop'un sırası bu ve sayılar burada kayan noktada
       tutuluyor.

       value1/value2 MilkDrop'ta sol ve sağ kanal. Elimizdeki zaman verisi
       tek kanal, bu yüzden ikincisi `sep` kadar kaydırılmış aynı veriden
       alınıyor — presetin iki kanalı ayırdığı yerlerde faz farkı korunuyor,
       ama gerçek stereo değil. */
    _customWaveSamples(tb, N, w, audio, preset) {
      const WP = preset || this.preset;
      if (!this._cw1 || this._cw1.length < N) {
        this._cw1 = new Float32Array(Math.max(512, N));
        this._cw2 = new Float32Array(Math.max(512, N));
      }
      const a = this._cw1, b = this._cw2;
      const acc = this._wantAcc !== false;
      /* `spectrum = 1` yazan dalga TAYFI istiyor, dalga bicimini degil.
         Korpusta 2.398 preset (%23,2) en az bir tayf dalgasi tasiyor.

         Tayf artik MilkDrop'un KENDI boru hattindan geliyor
         (`SVMilkdropAudio.MilkdropSpectrum`): ayni ±128 birimi, ayni Hann
         penceresi, ayni normallestirilmemis 1024 noktali FFT, ayni esitleyici.
         Eskiden gorsellestiricinin 0..1'e normallestirilmis `freq` dizisi
         veriliyordu: KAYNAK dogruydu ama OLCEK degildi, yani dalga dogru
         bicimde yanlis buyuklukte ciziliyordu — `0,15 * scaling * wave_scale`
         carpani MilkDrop'takinden bambaska bir sey uretiyordu.

         Tayf yoksa (olcum ortami, ses acilmamis) zaman verisine dusuluyor. */
      const fq = acc && w.spectrum && this._specData ? this._specData : null;
      const n = tb.length;

      /* INDISLEME MilkDrop'un indislemesi, ve iki yolda FARKLI.

         Tayfta: iki kanal da SIFIRDAN basliyor (`j0 = j1 = 0`) ve adim
         `t = (512 - sep) / N` — yani `sep` kanallari kaydirmiyor,
         gozler arasi ADIMI degistiriyor.

         Dalga biciminde: N ornek ARKA ARKAYA okunuyor, 480 orneklik
         tamponun ortasindan, iki kanal `sep/2` kadar ters yone kaydirilmis.
         Motor bunun yerine butun tamponu (2048 ornek) N'e sikistiriyordu:
         64 ornekli bir dalgada bu 32:1 seyreltme demek, yani ekranda
         gorunen sey dalganin kendisi degil ortusme gurultusu. */
      const SPEC_BINS = 512;
      const WAVE_MAX = 480; // NUM_WAVEFORM_SAMPLES
      const step = fq ? (SPEC_BINS - w.sep) / Math.max(1, N) : 1;
      const mid = fq ? 0 : Math.max(0, Math.floor((WAVE_MAX - N) / 2));
      const j0 = fq ? 0 : mid - (w.sep >> 1);
      const j1 = fq ? 0 : mid + (w.sep >> 1);
      for (let i = 0; i < N; i++) {
        const k = Math.floor(i * step);
        if (fq) {
          a[i] = fq[Math.min(SPEC_BINS - 1, Math.max(0, k + j0))];
          b[i] = fq[Math.min(SPEC_BINS - 1, Math.max(0, k + j1))];
        } else {
          a[i] = tb[(((k + j0) % n) + n) % n] - 128;
          b[i] = tb[(((k + j1) % n) + n) % n] - 128;
        }
      }
      let sm = acc && isFinite(w.smoothing) ? w.smoothing : 0;
      if (sm < 0) sm = 0; else if (sm > 1) sm = 1;
      if (sm > 0) {
        const m1 = Math.sqrt(sm * 0.98);
        const m2 = 1 - m1;
        for (let i = 1; i < N; i++) {
          a[i] = a[i] * m2 + a[i - 1] * m1;
          b[i] = b[i] * m2 + b[i - 1] * m1;
        }
        for (let i = N - 2; i >= 0; i--) {
          a[i] = a[i] * m2 + a[i + 1] * m1;
          b[i] = b[i] * m2 + b[i + 1] * m1;
        }
      }
      /* GENLIK. MilkDrop: `(tayf ? 0,15 : 0,004) * scaling * wave_scale`,
         ornekler ±128 biriminde. Motor bir ara 1 kullaniyordu — ozel
         dalgalarin hepsi olmasi gerekenin iki kati buyuklukteydi ve
         `wave_scale` onlara hic ulasmiyordu. Artik iki yol da MilkDrop'un
         carpanini KENDI biriminde kullaniyor. */
      const ws = acc ? (WP.get('wave_scale') || 1) : 1;
      const sc = acc ? (fq ? 0.15 : 0.004) * w.scaling * ws : w.scaling / 128;
      for (let i = 0; i < N; i++) { a[i] *= sc; b[i] *= sc; }
    }


    /* MilkDrop'un dalga örnekleri: iki kanal, kabaca -1..1, wave_scale ile
       ölçekli. NUM_WAVEFORM_SAMPLES 512, diziler 576 çünkü bazı modlar
       ileriye 64 örnek bakıyor (`fL[i+32]` gibi).

       BİLEREK YAKLAŞIK: elimizdeki zaman verisi TEK KANAL. MilkDrop'un 2, 3
       ve 5 numaralı modları gerçek stereodan Lissajous şekli çiziyor; aynı
       diziyi iki kanal saymak onları düz bir köşegene indirirdi. Bu yüzden
       sağ kanal 128 örnek kaydırılmış halinden türetiliyor: faz farkı gerçek
       bir iki boyutlu şekil veriyor, ama gerçek stereo değil. */
    /* `bModWaveAlphaByVolume`: dalganın saydamlığını SESİN ŞİDDETİ sürüyor.

       Korpusta 4.027 preset (%38,9) açık bırakıyor ve motor bunu hiç
       okumuyordu — o presetlerde dalga sessizken de aynı parlaklıkta
       duruyor, yani müzikle bağı kopuyordu.

       Ses ölçüsü havuzdaki `bass/mid/treb` ortalaması, `vol` DEĞİL:
       presetlerin %37,9'u `vol`ü kendi denklemlerinde başka bir şey için
       yeniden yazıyor ve o değer buraya girseydi alfa preset yazarının
       hesabına göre değil, rastgele oynardı.

       Aralık ters yazılmış olabiliyor (başlangıç > bitiş); bölme sıfıra
       düşerse alfa sonsuz olur, o yüzden aralık korunuyor. */
    _waveVolAlpha(a) {
      let alpha = isFinite(a) ? a : 1;
      const P = this.preset;
      if (this._wantAcc !== false && P && P.get('wave_modalpha') > 0) {
        const vol = ((P.get('bass') || 0) + (P.get('mid') || 0) + (P.get('treb') || 0)) / 3;
        const a0 = P.get('wave_modalpha_start') || 0;
        const a1 = P.get('wave_modalpha_end') || 0;
        const d = a1 - a0;
        if (Math.abs(d) > 1e-6) alpha *= (vol - a0) / d;
      }
      return Math.max(0, Math.min(1, isFinite(alpha) ? alpha : 1));
    }

    /* Ses örneklerini dalga biçimine hazırlar.

       `fWaveSmoothing` burada uygulanıyor ve UYGULANMIYORDU: örnek dizisi
       olduğu gibi çiziliyordu. Korpusta 8.171 preset (%79,0) sıfırdan
       büyük bir yumuşatma yazıyor, 4.007'si (%38,7) 0,75 ve üstü — yani
       yumuşatma istisna değil, presetlerin çoğunun beklediği normal hâl.
       Uygulanmayınca dalga olması gerekenden çok daha dişli çıkıyor ve
       yüksek yumuşatma isteyen presetlerde ince bir kıvrım yerine gürültü
       görünüyordu.

       Filtre TEK KUTUPLU ve TEK YÖNLÜ: her örnek bir öncekinin
       yumuşatılmış hâliyle karışıyor. Simetrik (ileri+geri) bir filtre
       daha "doğru" görünürdü ama MilkDrop'unki bu değil ve fark gözle
       görülüyor: tek yönlü filtre dalgayı hafifçe SAĞA kaydırıyor.

       Ölçek de karışıma giriyor (`s * (1 - sm)`), yoksa yumuşatma arttıkça
       genlik büyürdü. */
    _waveSamples(audio, scale, smoothing) {
      const tb = audio.timeBytes;
      if (!tb || tb.length < 8) return false;
      if (!this._fL) { this._fL = new Float32Array(576); this._fR = new Float32Array(576); }
      const L = this._fL, R = this._fR;
      const n = tb.length;
      const s = isFinite(scale) && scale !== 0 ? scale : 1;
      const raw = (k) => (tb[k % n] - 128) / 128;
      let sm = this._wantAcc !== false && isFinite(smoothing) ? smoothing : 0;
      if (sm < 0) sm = 0; else if (sm > 1) sm = 1;
      const s2 = s * (1 - sm);
      L[0] = raw(0) * s;
      R[0] = raw(128) * s;
      for (let i = 1; i < 576; i++) {
        L[i] = raw(i) * s2 + L[i - 1] * sm;
        R[i] = raw(i + 128) * s2 + R[i - 1] * sm;
      }
      return true;
    }

    /* MilkDrop'un varsayılan dalga formu — SEKİZ ayrı biçim.

       Eskiden burada tek bir düz yatay çizgi vardı ve her preset onu
       çiziyordu. Oysa `nWaveMode` presetin en görünür ayarlarından biri:
       0 bir çember, 1 dönen bir yumak, 2/3 Lissajous, 4 yumuşatılmış yatay
       çizgi, 5 döndürülmüş sekiz, 6/7 açılı çift çizgi. Tek biçim çizmek,
       presetlerin çoğunu yazarının çizdiğinden bambaşka gösteriyordu.

       Formüller BeatDrop/MilkDrop2'nin DrawWave'inden alındı; sabitler
       (0.4, 0.53, 1.57, 2.3 ...) oradaki değerlerin aynısı — yuvarlarsak
       biçim gözle görülür şekilde kayıyor. */
    _drawWaveModes(gl, GW, GH) {
      const P = this.preset;
      const cl = window.SVMilkdrop.clampColor;
      let alpha = P.get('wave_a');
      alpha = this._waveVolAlpha(alpha);
      if (alpha <= 0.002) return;

      const L = this._fL, R = this._fR;
      const d = this.lineData;
      const mode = ((Math.round(P.get('wave_mode')) % 8) + 8) % 8;
      const posX = (P.get('wave_x') || 0) * 2 - 1;
      /* wave_y'de ÇEVİRME YOK. Şekillerde var (`y*-2+1`), dalgada yok —
         MilkDrop kaynağı bunu "orijinalinde tersti, öyle bırakıyoruz" diye
         işaretliyor. İkisini aynı sanmak dalgayı ekranın yanlış yarısına
         koyuyor. */
      const posY = (P.get('wave_y') || 0) * 2 - 1;
      let myst = P.get('wave_mystery') || 0;
      if ((mode === 0 || mode === 1 || mode === 4) && (myst < -1 || myst > 1)) {
        myst = myst * 0.5 + 0.5;
        myst -= Math.floor(myst);
        myst = Math.abs(myst) * 2 - 1;
      }
      // MilkDrop: kısa kenar 1, uzun kenar oranla küçültülür
      const aspX = GH > GW ? GW / GH : 1;
      const aspY = GW > GH ? GH / GW : 1;

      /* VARSAYILAN DALGA renk yolunda bir istisna var: MilkDrop burada
         COLOR_NORM'dan ÖNCE ayrıca KENETLİYOR (milkdropfs.cpp:2623-2628),
         yani rengi sarmıyor — şekil ve özel dalgada sarıyor. Sıra:
         kenetle, parlat, sonra 8 bite indir. Alfa kenetlenmiyor, o sarıyor. */
      let cr = cl(P.get('wave_r')), cg = cl(P.get('wave_g')), cb = cl(P.get('wave_b'));
      // wave_brighten: en parlak kanalı 1'e çekip rengi doyurur
      if (P.get('wave_brighten')) {
        const mx = Math.max(cr, cg, cb);
        if (mx > 0.01) { cr /= mx; cg /= mx; cb /= mx; }
      }
      /* 8 bitlik tepe rengi, parlatmadan SONRA. Alfa kenetlenmediği için
         burada gerçekten sarabiliyor: `wave_a = 1,5` yazan bir preset
         MilkDrop'ta yarı saydam çiziliyor, bizde opak çiziliyordu. */
      const cn = window.SVMilkdrop.colorNorm;
      cr = cn(cr); cg = cn(cg); cb = cn(cb);
      alpha = cn(alpha);

      const SAMPLES = 512;
      let n = SAMPLES;
      let off = 0;
      let breakAt = -1;
      const put = (i, x, y) => {
        const k = i * 6;
        d[k] = x; d[k + 1] = y;
        d[k + 2] = cr; d[k + 3] = cg; d[k + 4] = cb; d[k + 5] = alpha;
      };

      if (mode === 0) {
        n = SAMPLES / 2;
        off = (SAMPLES - n) / 2;
        const inv = 1 / (n - 1);
        for (let i = 0; i < n; i++) {
          let rad = 0.5 + 0.4 * (L[i + off] + R[i + off]) * 0.5 + myst;
          const ang = i * inv * 6.28 + this.time * 0.2;
          // İlk %10 ikinci okumaya harmanlanıyor: çember kapanırken sıçramasın
          if (i < n / 10) {
            let mix = i / (n * 0.1);
            mix = 0.5 - 0.5 * Math.cos(mix * 3.1416);
            const rad2 = 0.5 + 0.4 * (L[i + n + off] + R[i + n + off]) * 0.5 + myst;
            rad = rad2 * (1 - mix) + rad * mix;
          }
          put(i, rad * Math.cos(ang) * aspY + posX, rad * Math.sin(ang) * aspX + posY);
        }
        put(n, d[0], d[1]);
        n++;
      } else if (mode === 1) {
        alpha = Math.min(1, alpha * 1.25);
        n = SAMPLES / 2;
        for (let i = 0; i < n; i++) {
          const rad = 0.53 + 0.43 * R[i] + myst;
          const ang = L[i + 32] * 1.57 + this.time * 2.3;
          put(i, rad * Math.cos(ang) * aspY + posX, rad * Math.sin(ang) * aspX + posY);
        }
      } else if (mode === 2 || mode === 3) {
        // MilkDrop 512'lik tamponda 2 numaralı modu belirgin şekilde soluklaştırıyor
        alpha = Math.min(1, mode === 2 ? alpha * 0.09 : alpha * 1.3);
        for (let i = 0; i < n; i++) {
          put(i, R[i] * aspY + posX, L[i + 32] * aspX + posY);
        }
      } else if (mode === 4) {
        off = 0;
        const w1 = 0.45 + 0.5 * (myst * 0.5 + 0.5);
        const w2 = 1 - w1;
        const inv = 1 / n;
        let px1 = 0, py1 = 0, px2 = 0, py2 = 0;
        for (let i = 0; i < n; i++) {
          let x = -1 + 2 * (i * inv) + posX + R[i + 25] * 0.44;
          let y = 0.5 * (L[i] + R[i]) * 0.47 + posY;
          // Kendi geçmişine bakan yumuşatma: çizgiyi akıcı bir şeride çeviriyor
          if (i > 1) {
            x = x * w2 + w1 * (px1 * 2 - px2);
            y = y * w2 + w1 * (py1 * 2 - py2);
          }
          put(i, x, y);
          px2 = px1; py2 = py1; px1 = x; py1 = y;
        }
      } else if (mode === 5) {
        const c = Math.cos(this.time * 0.3);
        const s = Math.sin(this.time * 0.3);
        for (let i = 0; i < n; i++) {
          const x0 = R[i] * L[i + 32] + L[i] * R[i + 32];
          const y0 = R[i] * R[i] - L[i + 32] * L[i + 32];
          put(i, (x0 * c - y0 * s) * aspY + posX, (x0 * s + y0 * c) * aspX + posY);
        }
      } else {
        // 6 ve 7: açılı çift çizgi, aralarındaki mesafe wave_y'den
        const half = SAMPLES / 2;
        off = (SAMPLES - half) / 2;
        const ang = 1.57 * myst;
        const dx = Math.cos(ang), dy = Math.sin(ang);
        const ex = posX * Math.cos(ang + 1.57) - dx * 3;
        const ey = posX * Math.sin(ang + 1.57) - dy * 3;
        const stepX = (dx * 6) / half;
        const stepY = (dy * 6) / half;
        const pdx = -dy, pdy = dx;
        const sep = Math.pow(posY * 0.5 + 0.5, 2);
        for (let i = 0; i < half; i++) {
          const f = 0.25 * L[i + off] + sep;
          put(i, ex + stepX * i + pdx * f, ey + stepY * i + pdy * f);
        }
        for (let i = 0; i < half; i++) {
          const f = 0.25 * R[i + off] - sep;
          put(half + i, ex + stepX * i + pdx * f, ey + stepY * i + pdy * f);
        }
        breakAt = half;
        n = half * 2;
      }

      if (n < 2) return;
      // Renk/alfa yukarıda değişmiş olabilir; tepe verisine yeniden yaz
      for (let i = 0; i < n; i++) {
        const k = i * 6;
        d[k + 2] = cr; d[k + 3] = cg; d[k + 4] = cb; d[k + 5] = alpha;
      }

      /* YUMUŞATMA. Varsayılan dalgada MilkDrop bunu KOŞULSUZ yapıyor —
         kaynakta `if (1)` yazıyor (milkdropfs.cpp:3117) — yani nokta
         kipinde bile, ki o zaman iki kat nokta çiziliyor.

         Bölünmüş dalga (mod 6 ve 7) iki parçayı AYRI AYRI yumuşatıyor;
         tek parça sayılsaydı iki şeridin arasına ekranı boydan boya kesen
         bir çizgi girerdi. Yeni kırılma noktası 2*(eski-1)+1, 2*eski
         değil. */
      let vd = d, vn = n, vbreak = breakAt;
      if (this._wantAcc !== false) {
        vd = this.waveData;
        if (breakAt > 0) {
          vbreak = smoothWave(d, breakAt, vd, 0, 0);
          vn = vbreak + smoothWave(d, n - breakAt, vd, breakAt, vbreak);
        } else {
          vn = smoothWave(d, n, vd, 0, 0);
        }
      }

      this._blend(gl, !!P.get('wave_additive'));
      gl.useProgram(this.lineProg);
      gl.bindVertexArray(this.lineVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vd, 0, vn * 6);
      const kind = P.get('wave_usedots') ? gl.POINTS : gl.LINE_STRIP;
      this._strip(gl, kind, vd, vn, vbreak, GW, GH, P.get('wave_thick') ? 2 : 1);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }

    /* Bir şeridi çizer; gerekirse kaydırılmış kopyalarıyla kalınlaştırır.

       İKİ AYRI SEBEPLE KALINLAŞTIRMA VAR:

       1) `wave_thick` — presetin kendi isteği. MilkDrop da çizgiyi bir texel
          kaydırıp tekrar çiziyor, çünkü gerçek kalın çizgi yok (WebGL'de de
          `lineWidth` çoğu sürücüde 1'e sabit).

       2) ÇÖZÜNÜRLÜK TELAFİSİ. Çizgiler bir texel kalınlığında, yani iç tampon
          büyüdükçe aynı çizgi oransal olarak daha az alan kaplıyor ve geri
          beslemeye daha az ışık bırakıyor. Ölçtük: tampon 320'den 1024'e
          çıkınca aynı presetin parlaklığı yirmide bire indi. Preset yazarı
          ağırlığı o dönemin ~512'lik tamponuna göre seçmiş; ağırlığı tampon
          boyutuyla orantılı tutmak, presetin amacını her çözünürlükte
          koruyor. Bilinçli bir sapma: MilkDrop bunu yapmıyor, ama MilkDrop
          da tamponu sabit tutuyordu. */
    /* ÇİZGİ AĞIRLIĞI — eski yolun kaç kez çizdiği.

       Tek bir yerde duruyor çünkü hem eski yol bunu kullanıyor hem de
       kenar yumuşatmalı yolun ışık koruma çarpanı buna göre hesaplanıyor.
       İkisi ayrışırsa AA açıkken presetlerin parlaklığı sessizce kayar. */
    _lineDraws(GW, thickMul) {
      /* Referans 320: presetlerin yazıldığı dönemin tipik iç tamponu bu
         genişlikteydi ve çizgi ağırlığı ona göre seçilmiş. */
      const weight = Math.max(1, Math.min(5, Math.round(GW / 320) * (thickMul || 1)));
      // Eski yol: bir asıl çizim + en fazla altı kaydırılmış kopya.
      const n = 1 + Math.min(6, Math.max(0, (weight - 1) * 3));
      /* ÇAKIŞMA DÜZELTMESİ. Çizim SAYISI bırakılan ışığın iyi bir vekili
         değil: kaydırılmış kopyalar birbirinin üstüne biniyor ve ışık
         doğrusal artmıyor. Kaydırma listesi dolduğunda (yedi çizim) sapma
         ölçülebilir hâle geliyor.

         ÖLÇÜLDÜ (512x384, decay=0, shader yok): ağırlık 2'den 4'e çıkınca
         ÇİZİM oranı 7/4 = 1,75, IŞIK oranı ise dalga modu 0/1/2/4/7'de
         1,58 / 1,58 / 1,76 / 1,53 / 1,59 ve şekil kenarlığında 1,41 —
         ortalama 1,58. Vekili düzeltmeden şerit o kadar fazla ışık
         bırakıyordu: aynı ölçümde dalga +16,0 / +33,7 / -9,6 / +19,0 /
         +17,1 yüzde sapıyordu.

         Katsayı 1,58/1,75 = 0,90. YALNIZCA liste dolduğunda uygulanıyor,
         yani `AA_TRIM`in kalibre edildiği ağırlık 2 durumu bit birebir
         aynı kalıyor. Sapma sıfırlanmıyor ve sıfırlanamaz — gerekçesi
         `_aaSetup` içinde: kayma segment SAYISINA bağlı, tek bir çarpanla
         kapatılamaz. Mod 1 ve 2 bu yüzden hâlâ uçta. */
      return n >= 7 ? n * 0.90 : n;
    }

    /* ŞERİT GEOMETRİSİ. Poli-çizgiyi iki yana açıp üçgen şeridine çevirir.

       Açılma TEKSEL uzayında yapılıyor, kırpma uzayında değil: kırpma
       uzayında sabit bir açılma en-boy oranı yüzünden yatay ve dikeyde
       farklı kalınlık verirdi — dikey çizgiler ince, yataylar kalın.

       BİRLEŞİM NOKTALARI GÖNYE (miter): her düğümde iki komşu segmentin
       normalleri toplanıp normalleniyor ve `1/cos(yarı açı)` ile
       uzatılıyor. Böylece şerit kesintisiz kalıyor ve segmentler ÜST ÜSTE
       BİNMİYOR — binseydi toplamalı karışımda birleşim noktaları iki kat
       parlak birer nokta olurdu, ki eski yolun görünür kusurlarından
       biriydi.

       GÖNYE SINIRI 4: keskin dönüşlerde `1/cos` sonsuza gidiyor ve şerit
       ekranın dışına fırlıyor. Sınırı aşınca düğümün kendi segment
       normaline düşülüyor; birleşimde küçük bir çentik kalıyor ama
       geometri sınırlı kalıyor. */
    _ribbon(d, n, closed, extPx, GW, GH, lenCorr) {
      const out = this.aaData;
      const sx = GW * 0.5, sy = GH * 0.5;
      const N = closed ? n + 1 : n;
      let w = 0;
      let pdx = 0, pdy = 0, hasPrev = false;
      for (let k = 0; k < N; k++) {
        const i = k % n;
        const px = d[i * 6] * sx, py = d[i * 6 + 1] * sy;
        // Bu düğümden SONRAKİ segmentin yönü
        let dx = 0, dy = 0;
        const j = closed ? (i + 1) % n : i + 1;
        if (closed || i + 1 < n) {
          dx = d[j * 6] * sx - px; dy = d[j * 6 + 1] * sy - py;
          const L = Math.sqrt(dx * dx + dy * dy);
          if (L > 1e-9) { dx /= L; dy /= L; } else { dx = pdx; dy = pdy; }
        } else { dx = pdx; dy = pdy; }
        if (!hasPrev) { pdx = dx; pdy = dy; hasPrev = true; }
        /* Gönye: iki normalin ortalaması. Normal = yönün dik çevrimi. */
        let mx = -(pdy + dy), my = (pdx + dx);
        const ml = Math.sqrt(mx * mx + my * my);
        let scale = 1;
        if (ml > 1e-9) {
          mx /= ml; my /= ml;
          const c = mx * -dy + my * dx;      // gönyenin segment normaline izdüşümü
          scale = Math.abs(c) > 0.25 ? 1 / c : 0;
        }
        if (!scale) { mx = -dy; my = dx; scale = 1; }   // gönye sınırı: düz normal
        const ox = mx * extPx * scale, oy = my * extPx * scale;
        /* UZUNLUK TELAFİSİ — eski yolla aynı ışığı bırakmak için.

           `gl.LINE_STRIP` elmas-çıkış kuralıyla tarıyor: bir segment için
           BASKIN eksende bir piksel basıyor, yani 45 derecelik bir çizgi
           birim uzunluk başına 1/√2 piksel alıyor. Şerit ise gerçek
           uzunluğu kaplıyor. Telafi olmadan çapraz ağırlıklı bir dalga
           %41'e kadar parlıyordu; ölçüldü, `Benski - Atom Smasher` tek
           başına 0,884'ten 1,000'e çıkmıştı.

           `max(|dx|, |dy|)` yön birimken tam olarak o oranı veriyor.
           Düğüm iki segmentin ortak noktası olduğu için ikisinin ortalaması
           alınıyor. `ince` kipte telafi YOK: orada amaç eski yolu taklit
           etmek değil, fiziksel olarak doğru çizgi. */
        let corr = 1;
        if (lenCorr) {
          corr = 0.5 * (Math.max(Math.abs(pdx), Math.abs(pdy)) +
                        Math.max(Math.abs(dx), Math.abs(dy)));
        }
        for (const side of [-1, 1]) {
          const o = w * 7;
          out[o] = (px + ox * side) / sx;
          out[o + 1] = (py + oy * side) / sy;
          out[o + 2] = side;
          out[o + 3] = d[i * 6 + 2]; out[o + 4] = d[i * 6 + 3];
          out[o + 5] = d[i * 6 + 4]; out[o + 6] = d[i * 6 + 5] * corr;
          w++;
        }
        pdx = dx; pdy = dy;
      }
      return w;
    }

    /* Şeridin GENİŞLİĞİ, KAZANCI ve tek seferlik GL kurulumu.

       Şerit yolu iki yerden çağrılıyor — bağlı çizgi (dalga, şekil
       kenarlığı) ve bağımsız parçalar (hareket vektörleri) — ve ikisinin de
       AYNI kalibrasyonu kullanması gerekiyor. İki yere kopyalanmış bir
       genişlik hesabı, biri güncellenip öteki unutulduğunda sessizce iki
       farklı kalınlık çizerdi. */
    _aaSetup(gl, GW, thickMul) {
      const draws = this._lineDraws(GW, thickMul);
      /* GENİŞLİK: 320'lik referansta bir teksel, yukarısında oranla. Eski
         yolun kademeli ağırlığından farklı olarak sürekli — 640'ta 2, 1024'te
         3,2, 1920'de 6 teksel. Görünen kalınlık çözünürlükten bağımsız
         kalıyor, ki presetin amacı buydu.

         `ince` kipinde referans 512: MilkDrop'un kendi çizgisi o boyuttaki
         tamponda bir tekseldi, yani bu GERÇEK kalınlık. Işık koruma yok,
         dolayısıyla dalga taşıyan presetler sönükleşiyor — kullanıcı bunu
         bilerek seçiyor. */
      const ref = this._lineStyle === 'thin' ? 512 : 320;
      const wPx = Math.max(1, (GW / ref) * (thickMul || 1));
      const half = Math.max(0.5, wPx * 0.5);
      /* IŞIK KORUMA: şerit `2*half` teksel boyunca ışık bırakıyor, eski yol
         `draws` kez bir teksel. Oran ikisini eşitliyor. İnce kipte 1.

         AA_TRIM ÖLÇÜLMÜŞ BİR KALİBRASYON, türetilmiş değil. Kâğıt üstünde
         oran yeterli olmalıydı; ölçünce şerit tutarlı biçimde daha fazla
         ışık bıraktı. Sebebi `gl.LINE_STRIP`in tarama kuralı: her segmentin
         yalnızca baskın eksende piksel basıyor ve segment sonlarını
         düşürüyor, yani GL'nin çizdiği "uzunluk" gerçek uzunluktan kısa.
         Segment başına bir etki olduğu için tek bir sayıyla tam
         kapatılamıyor.

         Ölçüm (512x384, `decay=0`, shader yok — yani yalnızca o karenin
         bıraktığı ışık, döngünün kazancı karışmadan; dalga modu 0/1/2/4/7):
         katsayısız +19,3 / +22,0 / +3,0 / +18,8 / +20,6 yüzde;
         0,86 ile   +3,9 / +12,2 / -9,3 / +3,4 / +4,8.
         Tam sıfır olmuyor ve olamaz: sapma segment SAYISINA bağlı, tek bir
         çarpanla kapatılamaz. Mod 2 en kısa çizgiyi çiziyor, GL'nin segment
         başına fazladan pikseli orada oransal olarak ağır basıyor. */
      const gain = this._lineStyle === 'thin' ? 1 : AA_TRIM * draws / (2 * half);
      const L = this.locAA;
      gl.useProgram(this.aaProg);
      /* Şerit yarı genişlikten BİR TEKSEL daha geniş: yumuşama oraya
         sığınıyor ve kapsamanın integrali tam `2 * half` oluyor, ki ışık
         koruma hesabı buna dayanıyor. */
      const ext = half + 1;
      gl.uniform1f(L.uHalf, half);
      gl.uniform1f(L.uExt, ext);
      gl.uniform1f(L.uGain, gain);
      /* Toplamalı karışımda alfa 1'i aşabiliyor; saydam karışımda aşarsa
         `ONE_MINUS_SRC_ALPHA` negatife düşüp altındaki görüntüyü çıkarır. */
      gl.uniform1f(L.uMax, this._aaAdditive ? 64 : 1);
      gl.bindVertexArray(this.aaVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.aaVbo);
      return ext;
    }

    /* Kenar yumuşatmalı çizim. `d` şerit verisi, `n` nokta sayısı. */
    _aaStrip(gl, d, n, breakAt, GW, GH, thickMul, closed) {
      if (n < 2) return;
      const ext = this._aaSetup(gl, GW, thickMul);
      const seg = (off, cnt) => {
        if (cnt < 2) return;
        const v = this._ribbon(d.subarray(off * 6, (off + cnt) * 6), cnt,
          closed, ext, GW, GH, this._lineStyle !== 'thin');
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.aaData, 0, v * 7);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, v);
      };
      if (breakAt > 0) { seg(0, breakAt); seg(breakAt, n - breakAt); }
      else seg(0, n);
      gl.bindVertexArray(null);
    }

    /* BAĞIMSIZ PARÇALAR (hareket vektörleri). `gl.LINES` gibi: her iki nokta
       kendi çizgisi, aralarında süreklilik yok.

       Hepsi TEK bir üçgen şeridinde çiziliyor, parça başına bir çizim
       çağrısıyla değil: 64x48'lik bir ızgara 3072 vektör demek ve o kadar
       çizim çağrısı kareyi tek başına yerdi. Parçalar arasına DEJENERE
       bağlantı konuyor — sıfır alanlı üçgen hiç parça üretmiyor, dolayısıyla
       aradaki `side` değeri hiç örneklenmiyor. */
    _aaSegments(gl, d, n, GW, GH, thickMul) {
      if (n < 2) return;
      const ext = this._aaSetup(gl, GW, thickMul);
      const out = this.aaData;
      const sx = GW * 0.5, sy = GH * 0.5;
      const lenCorr = this._lineStyle !== 'thin';
      let w = 0;
      /* Tampon sınırı: parça başına en çok altı tepe (dört köşe + iki
         dejenere). Sığmayan parça çizilmiyor değil, o noktada boşaltılıyor. */
      const kapasite = Math.floor(out.length / 7);
      const bosalt = () => {
        if (w >= 4) {
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, out, 0, w * 7);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, w);
        }
        w = 0;
      };
      const yaz = (px, py, side, o, corr) => {
        const k = w * 7;
        out[k] = px / sx; out[k + 1] = py / sy; out[k + 2] = side;
        out[k + 3] = d[o + 2]; out[k + 4] = d[o + 3];
        out[k + 5] = d[o + 4]; out[k + 6] = d[o + 5] * corr;
        w++;
      };
      for (let i = 0; i + 1 < n; i += 2) {
        if (w + 6 > kapasite) bosalt();
        const a = i * 6, b = (i + 1) * 6;
        const x0 = d[a] * sx, y0 = d[a + 1] * sy;
        const x1 = d[b] * sx, y1 = d[b + 1] * sy;
        let dx = x1 - x0, dy = y1 - y0;
        const L = Math.sqrt(dx * dx + dy * dy);
        if (L < 1e-9) continue;                    // sıfır uzunluk: çizilecek bir şey yok
        dx /= L; dy /= L;
        const ox = -dy * ext, oy = dx * ext;
        /* Uzunluk telafisi şeritteki ile aynı gerekçeyle: `gl.LINES` de
           elmas-çıkış kuralıyla tarıyor, yani çapraz bir parça birim uzunluk
           başına 1/√2 piksel alıyor. */
        const corr = lenCorr ? Math.max(Math.abs(dx), Math.abs(dy)) : 1;
        /* DEJENERE BAĞLANTI: bir öncekinin son tepesi ile yeninin ilk tepesi
           birer kez daha yazılıyor. İkisi ekleniyor, biri değil — tek tepe
           sarım yönünü ters çevirir ve sonraki parça arkaya bakan üçgenlere
           dönerdi. Önceki tepe olduğu gibi kopyalanıyor: üçgen sıfır alanlı
           olduğu için rengi zaten örneklenmiyor, ama kopyalamak "hangi renk
           doğru" sorusunu tümden ortadan kaldırıyor. */
        if (w > 0) {
          const k = (w - 1) * 7;
          for (let c = 0; c < 7; c++) out[w * 7 + c] = out[k + c];
          w++;
          yaz(x0 - ox, y0 - oy, -1, a, corr);
        }
        yaz(x0 - ox, y0 - oy, -1, a, corr);
        yaz(x0 + ox, y0 + oy, 1, a, corr);
        yaz(x1 - ox, y1 - oy, -1, b, corr);
        yaz(x1 + ox, y1 + oy, 1, b, corr);
      }
      bosalt();
      gl.bindVertexArray(null);
    }

    _strip(gl, kind, d, n, breakAt, GW, GH, thickMul) {
      /* KENAR YUMUŞATMALI YOL yalnızca ÇİZGİ için. Nokta kipinde şerit
         diye bir şey yok; noktalar eski yoldan çiziliyor. */
      /* KENAR YUMUŞATMALI YOL artık üç çizgi biçiminde de: dalga şeridi,
         şekil kenarlığı (kapalı şerit) ve hareket vektörleri (bağımsız
         parçalar). Aynı `lineStyle` ayarı üçünü birden sürüyor — biri
         yumuşak öteki tırtıklı çizilseydi ayar yarım kalırdı. */
      const aa = this._lineStyle !== 'milkdrop' && this.aaProg;
      if (aa && kind === gl.LINES) {
        this._aaSegments(gl, d, n, GW, GH, thickMul);
        gl.useProgram(this.lineProg);
        gl.bindVertexArray(this.lineVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
        return;
      }
      if (aa && (kind === gl.LINE_STRIP || kind === gl.LINE_LOOP)) {
        this._aaStrip(gl, d, n, breakAt, GW, GH, thickMul, kind === gl.LINE_LOOP);
        /* Çağıran `lineProg`/`lineVao`yu bağlı bırakmıştı; AA yolu ikisini
           de değiştirdi. Sıradaki çizim kendi programını bağlamazsa yanlış
           gölgelendiriciyle çizerdi. */
        gl.useProgram(this.lineProg);
        gl.bindVertexArray(this.lineVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
        return;
      }
      const draw = () => {
        if (breakAt > 0) {
          gl.drawArrays(kind, 0, breakAt);
          gl.drawArrays(kind, breakAt, n - breakAt);
        } else {
          gl.drawArrays(kind, 0, n);
        }
      };
      draw();
      /* ŞİŞİRME çizgi biçimlerinin hepsinde: dalga şeridi (LINE_STRIP),
         şekil kenarlığı (LINE_LOOP) ve hareket vektörleri (LINES). MilkDrop
         üçünü de kendi tamponunda bir teksel çiziyor ve bizim tamponumuz
         çok daha büyük — telafi edilmezse üçü de oranla incelip sönükleşir.
         Nokta kipi (POINTS) dışarıda: orada çizgi yok. */
      if (kind !== gl.LINE_STRIP && kind !== gl.LINE_LOOP && kind !== gl.LINES) return;
      /* Referans 320: presetlerin yazıldığı dönemin tipik iç tamponu bu
         genişlikteydi ve çizgi ağırlığı ona göre seçilmiş. 512'yi referans
         alınca 640'lık bir tamponda telafi hiç devreye girmiyor ve preset
         gözle görülür biçimde sönük kalıyordu — parlaklık izinde ölçtük. */
      const weight = Math.max(1, Math.min(5, Math.round(GW / 320) * (thickMul || 1)));
      if (weight < 2) return;
      const ox = 2 / GW, oy = 2 / GH;
      const offsets = [[ox, 0], [0, oy], [ox, oy], [-ox, 0], [0, -oy], [-ox, -oy]];
      for (let k = 0; k < Math.min(offsets.length, (weight - 1) * 3); k++) {
        const sx = offsets[k][0], sy = offsets[k][1];
        for (let i = 0; i < n; i++) { d[i * 6] += sx; d[i * 6 + 1] += sy; }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, n * 6);
        draw();
        for (let i = 0; i < n; i++) { d[i * 6] -= sx; d[i * 6 + 1] -= sy; }
      }
    }


    // Motor kurulamazsa sahne boş kalmasın
    _fallback(W, H) {
      const c = this.ctx;
      c.clearRect(0, 0, W, H);
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.font = Math.round(Math.min(W, H) * 0.03) + 'px system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText(this.error || 'MilkDrop motoru başlatılamadı', W / 2, H / 2);
    }

    /* `monitor` — presetin kendi hata ayıklama probu.

       Preset dili kare başına yazılabilen bir `monitor` değişkeni
       tanımlıyor; render girdisi DEĞİL, yalnızca yazarın bakması için.
       Motor değeri havuzda tutuyordu ama hiçbir yere çıkarmıyordu, yani
       korpustaki 4.489 presetin (%43,4) o satırları ölüydü. projectM'in
       #664'ü aynı isteği yıllardır açık tutuyor.

       Preset yoksa ya da `monitor` hiç yazılmamışsa `null` dönüyor —
       0 dönmek "preset sıfır yazdı" ile "kimse yazmadı"yı aynı gösterirdi
       ve panelde ikisi çok farklı şeyler. */
    monitorValue() {
      const P = this.preset;
      if (!P || !P.pool.has('monitor')) return null;
      const v = P.get('monitor');
      return typeof v === 'number' && isFinite(v) ? v : null;
    }

    dispose() {
      this._disposeTargets();
      const gl = this.gl;
      if (gl) {
        this._releasePresetProgs();
        this._dropOld();
        if (this.vbo) gl.deleteBuffer(this.vbo);
        if (this.ibo) gl.deleteBuffer(this.ibo);
        if (this.vao) gl.deleteVertexArray(this.vao);
        if (this.quadVbo) gl.deleteBuffer(this.quadVbo);
        if (this.quadVao) gl.deleteVertexArray(this.quadVao);
        if (this.lineVbo) gl.deleteBuffer(this.lineVbo);
        if (this.lineVao) gl.deleteVertexArray(this.lineVao);
        if (this.aaVao) gl.deleteVertexArray(this.aaVao);
        if (this.aaVbo) gl.deleteBuffer(this.aaVbo);
        if (this.warpFixed) gl.deleteProgram(this.warpFixed);
        if (this.compFixed) gl.deleteProgram(this.compFixed);
        if (this.blurProg) gl.deleteProgram(this.blurProg);
        if (this.lineProg) gl.deleteProgram(this.lineProg);
        if (this.aaProg) gl.deleteProgram(this.aaProg);
        if (this.shapeTexProg) gl.deleteProgram(this.shapeTexProg);
        this._dropUserTextures();
        if (this.samplers) for (const k in this.samplers) gl.deleteSampler(this.samplers[k]);
        if (this.noise) for (const k in this.noise) gl.deleteTexture(this.noise[k].tex);
      }
      this.gl = null;
      this.preset = null;
    }
  }

  /* Varsayılan preset.

     Kendi yazdığımız bir preset: dil özelliklerinin çoğunu kullanıyor
     (per_frame, per_pixel, q değişkenleri, ses girdileri) ve motor doğru
     çalıştığında akan bir tünel üretiyor. Bir `.milk` dosyası yüklenmediğinde
     sahne boş kalmasın diye var. */
  const DEFAULT_PRESET = [
    'decay=0.972',
    'fGammaAdj=1.020',
    'wave_r=0.95',
    'wave_g=0.45',
    'wave_b=0.85',
    'wave_a=0.16',
    'per_frame_1=q1 = bass_att;',
    'per_frame_2=q2 = treb_att;',
    'per_frame_3=zoom = 1.018 + 0.012*sin(time*0.61) + q1*0.014;',
    'per_frame_4=rot = 0.040 + 0.014*sin(time*0.31) + q2*0.014;',
    'per_frame_5=warp = 0.55 + q1*0.80;',
    'per_frame_6=cx = 0.5 + 0.04*sin(time*0.23);',
    'per_frame_7=cy = 0.5 + 0.04*cos(time*0.19);',
    'per_frame_8=wave_r = 0.55 + 0.45*sin(time*0.70);',
    'per_frame_9=wave_g = 0.55 + 0.45*sin(time*0.70 + 2.09);',
    'per_frame_10=wave_b = 0.55 + 0.45*sin(time*0.70 + 4.19);',
    'per_pixel_1=zoom = zoom + 0.030*sin(rad*7.0 - time*1.7);',
    'per_pixel_2=rot = rot + 0.045*sin(ang*3.0 + time*0.5)*rad;',
    'per_pixel_3=dx = 0.0016*cos(ang*5.0 + time*0.9);',
    'per_pixel_4=dy = 0.0016*sin(ang*4.0 - time*0.7);',
  ].join('\n');

  window.SVModes = window.SVModes || {};
  window.SVModes.milkdrop = MilkdropMode;
  window.SVMilkdropDefault = DEFAULT_PRESET;
})();
