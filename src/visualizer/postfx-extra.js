'use strict';
/* Son-işlem efektlerinin ikinci bölümü.

   postfx.js ile aynı biçim: her efekt bir `params` listesi, sese bağlanabilir
   parametreleri gösteren bir `audio` listesi ve HEAD'den sonra gelen bir
   fragment gövdesi (`frag`) tanımlar. Zincir, panel ve öz test iki dosya
   arasında ayrım yapmaz.

   HEAD şu uniformları sağlar:
     uTex   — birleştirilmiş sahne
     uPrev  — bir önceki karenin sonucu (needsPrev: true diyen efektler için)
     uRes   — piksel cinsinden çözünürlük
     uTime  — saniye
     uLevel, uBass, uMid, uTreble, uBeat

   Varsayılan değerler bilinçli olarak GÖRÜNÜR seçildi: bir efekti zincire
   ekleyip hiçbir şeyin değişmediğini görmek, ayarları keşfetmeyi zorlaştırır.
   Öz test de her efektin kaynaktan ölçülebilir biçimde farklı bir kare
   ürettiğini kontrol eder. */
(function () {
  const P = window.SVPostFX;
  const p = (name, label, min, max, step, def) => ({ name, label, min, max, step, default: def });

  P.register({
    // ------------------------------------------------------------------ blur
    blur: {
      label: 'Bulanıklık (Gauss)',
      params: [p('radius', 'Yarıçap', 0, 12, 0.1, 3)],
      audio: ['radius'],
      frag: `uniform float radius;
void main(){
  vec2 px = radius / uRes;
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  // Ayrık iki eksenli örnekleme: tek geçişte gerçek 2B Gauss'a yakın sonuç
  for (int i = -5; i <= 5; i++) {
    for (int j = -5; j <= 5; j++) {
      float d = float(i * i + j * j);
      float w = exp(-d / 12.0);
      sum += texture(uTex, vUV + vec2(px.x * float(i), px.y * float(j))).rgb * w;
      wsum += w;
    }
  }
  outColor = vec4(sum / wsum, 1.0);
}`,
    },

    radialblur: {
      label: 'Işınsal Bulanıklık',
      params: [
        p('strength', 'Şiddet', 0, 0.2, 0.002, 0.05),
        p('cx', 'Merkez X', 0, 1, 0.01, 0.5),
        p('cy', 'Merkez Y', 0, 1, 0.01, 0.5),
      ],
      audio: ['strength'],
      frag: `uniform float strength, cx, cy;
void main(){
  vec2 c = vec2(cx, cy);
  vec2 dir = vUV - c;
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float k = float(i) / 11.0;
    sum += texture(uTex, vUV - dir * k * strength * 12.0).rgb;
  }
  outColor = vec4(sum / 12.0, 1.0);
}`,
    },

    motionblur: {
      label: 'Yönlü Bulanıklık',
      params: [
        p('len', 'Uzunluk', 0, 0.1, 0.001, 0.02),
        p('angle', 'Açı', 0, 1, 0.005, 0),
      ],
      audio: ['len', 'angle'],
      frag: `uniform float len, angle;
void main(){
  float a = angle * 6.28318530718;
  vec2 dir = vec2(cos(a), sin(a)) * len;
  vec3 sum = vec3(0.0);
  for (int i = -8; i <= 8; i++) {
    sum += texture(uTex, vUV + dir * (float(i) / 8.0)).rgb;
  }
  outColor = vec4(sum / 17.0, 1.0);
}`,
    },

    tiltshift: {
      label: 'Tilt-Shift',
      params: [
        p('center', 'Odak Konumu', 0, 1, 0.01, 0.5),
        p('width', 'Odak Genişliği', 0.02, 0.8, 0.01, 0.2),
        p('strength', 'Bulanıklık', 0, 10, 0.1, 4),
        p('angle', 'Açı', 0, 1, 0.005, 0),
      ],
      audio: ['center', 'strength'],
      frag: `uniform float center, width, strength, angle;
void main(){
  float a = angle * 3.14159265;
  // Odak bandına dik uzaklık
  vec2 n = vec2(-sin(a), cos(a));
  float d = abs(dot(vUV - vec2(0.5), n) + (0.5 - center));
  float blur = smoothstep(width * 0.5, width * 0.5 + 0.22, d) * strength;
  vec2 px = blur / uRes;
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int i = -4; i <= 4; i++) {
    for (int j = -4; j <= 4; j++) {
      float w = exp(-float(i * i + j * j) / 8.0);
      sum += texture(uTex, vUV + vec2(px.x * float(i), px.y * float(j))).rgb * w;
      wsum += w;
    }
  }
  outColor = vec4(sum / wsum, 1.0);
}`,
    },

    dof: {
      label: 'Alan Derinliği (Bokeh)',
      params: [
        p('focus', 'Odak Parlaklığı', 0, 1, 0.01, 0.5),
        p('range', 'Odak Aralığı', 0.02, 1, 0.01, 0.3),
        p('strength', 'Bulanıklık', 0, 10, 0.1, 5),
      ],
      audio: ['focus', 'strength'],
      frag: `uniform float focus, range, strength;
void main(){
  vec3 base = texture(uTex, vUV).rgb;
  // Derinlik tamponu yok; parlaklık vekil olarak kullanılır — parlak alanlar
  // "odakta", karanlık alanlar bulanık. Görsel olarak inandırıcı ve ucuz.
  float lum = dot(base, vec3(0.299, 0.587, 0.114));
  float coc = clamp(abs(lum - focus) / max(0.02, range), 0.0, 1.0) * strength;
  vec2 px = coc / uRes;
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  // Altıgen bokeh: 6 yönde halkalar
  for (int r = 1; r <= 3; r++) {
    float rf = float(r);
    for (int k = 0; k < 6; k++) {
      float a = float(k) / 6.0 * 6.28318530718;
      vec2 o = vec2(cos(a), sin(a)) * rf;
      vec3 s = texture(uTex, vUV + px * o).rgb;
      // Parlak noktalar bokeh diskinde baskın olsun
      float w = 1.0 + dot(s, vec3(0.333)) * 2.0;
      sum += s * w;
      wsum += w;
    }
  }
  sum += base * 2.0;
  wsum += 2.0;
  outColor = vec4(sum / wsum, 1.0);
}`,
    },

    // ---------------------------------------------------------------- keskin
    sharpen: {
      label: 'Keskinleştirme',
      params: [p('amount', 'Miktar', 0, 3, 0.02, 1), p('radius', 'Yarıçap', 0.5, 4, 0.1, 1)],
      audio: ['amount'],
      frag: `uniform float amount, radius;
void main(){
  vec2 px = radius / uRes;
  vec3 c = texture(uTex, vUV).rgb;
  vec3 blur = (
    texture(uTex, vUV + vec2(px.x, 0.0)).rgb +
    texture(uTex, vUV - vec2(px.x, 0.0)).rgb +
    texture(uTex, vUV + vec2(0.0, px.y)).rgb +
    texture(uTex, vUV - vec2(0.0, px.y)).rgb) * 0.25;
  outColor = vec4(clamp(c + (c - blur) * amount * 2.0, 0.0, 1.0), 1.0);
}`,
    },

    emboss: {
      label: 'Kabartma',
      params: [p('depth', 'Derinlik', 0, 4, 0.05, 1.4), p('angle', 'Işık Açısı', 0, 1, 0.005, 0.12), p('mixAmt', 'Karışım', 0, 1, 0.01, 1)],
      audio: ['depth', 'angle'],
      frag: `uniform float depth, angle, mixAmt;
void main(){
  float a = angle * 6.28318530718;
  vec2 o = vec2(cos(a), sin(a)) * depth / uRes;
  vec3 c1 = texture(uTex, vUV + o).rgb;
  vec3 c2 = texture(uTex, vUV - o).rgb;
  float e = dot(c1 - c2, vec3(0.333)) * 3.0 + 0.5;
  vec3 emb = vec3(e);
  outColor = vec4(mix(texture(uTex, vUV).rgb, emb, mixAmt), 1.0);
}`,
    },

    // -------------------------------------------------------------- tarama
    dither: {
      label: 'Dither (Bayer)',
      params: [p('levels', 'Basamak', 2, 16, 1, 4), p('scale', 'Nokta Boyutu', 1, 8, 1, 2)],
      audio: ['levels'],
      frag: `uniform float levels, scale;
// 4x4 Bayer eşiği — sıralı dither için standart matris
float bayer(vec2 p){
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int i = y * 4 + x;
  float m[16] = float[16](0.0,8.0,2.0,10.0, 12.0,4.0,14.0,6.0, 3.0,11.0,1.0,9.0, 15.0,7.0,13.0,5.0);
  return m[i] / 16.0;
}
void main(){
  vec3 c = texture(uTex, vUV).rgb;
  vec2 p = floor(vUV * uRes / max(1.0, scale));
  float t = bayer(p) - 0.5;
  float n = max(2.0, floor(levels));
  vec3 q = floor(c * n + t) / (n - 1.0);
  outColor = vec4(clamp(q, 0.0, 1.0), 1.0);
}`,
    },

    halftone: {
      label: 'Yarım Ton',
      params: [p('size', 'Nokta Aralığı', 2, 24, 0.5, 6), p('angle', 'Tarama Açısı', 0, 1, 0.005, 0.12), p('mixAmt', 'Karışım', 0, 1, 0.01, 1)],
      audio: ['size'],
      frag: `uniform float size, angle, mixAmt;
void main(){
  float a = angle * 3.14159265;
  mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
  vec2 p = R * (vUV * uRes) / size;
  vec2 cell = fract(p) - 0.5;
  vec3 c = texture(uTex, vUV).rgb;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  float r = sqrt(lum) * 0.62;
  float d = smoothstep(r, r - 0.08, length(cell));
  vec3 dots = c * d;
  outColor = vec4(mix(c, dots, mixAmt), 1.0);
}`,
    },

    ascii: {
      label: 'ASCII Mozaik',
      params: [p('size', 'Hücre', 4, 32, 1, 10), p('mixAmt', 'Karışım', 0, 1, 0.01, 1)],
      audio: ['size'],
      frag: `uniform float size, mixAmt;
/* Karakter atlası yerine, parlaklığa göre artan yoğunlukta çizgi deseni
   üretiliyor: '.', '-', '+', '#' basamaklarının verdiği izlenimin aynısını
   doku okumadan verir. */
float glyph(vec2 q, float lum){
  float g = 0.0;
  if (lum > 0.15) g = max(g, step(abs(q.y), 0.08));
  if (lum > 0.35) g = max(g, step(abs(q.x), 0.08));
  if (lum > 0.55) g = max(g, step(abs(abs(q.x) - abs(q.y)), 0.10));
  if (lum > 0.75) g = max(g, step(abs(abs(q.x) - 0.3), 0.07));
  if (lum > 0.9)  g = max(g, step(abs(abs(q.y) - 0.3), 0.07));
  return g;
}
void main(){
  vec2 cellPx = vec2(size);
  vec2 cell = floor(vUV * uRes / cellPx);
  vec2 uv = (cell + 0.5) * cellPx / uRes;
  vec3 c = texture(uTex, uv).rgb;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  vec2 q = fract(vUV * uRes / cellPx) - 0.5;
  float g = glyph(q, lum);
  vec3 outc = c * g * 1.35;
  outColor = vec4(mix(texture(uTex, vUV).rgb, outc, mixAmt), 1.0);
}`,
    },

    hatch: {
      label: 'Tarama Çizgisi (Kalem)',
      params: [p('density', 'Sıklık', 20, 260, 1, 90), p('mixAmt', 'Karışım', 0, 1, 0.01, 1)],
      audio: ['density'],
      frag: `uniform float density, mixAmt;
float line(vec2 uv, float a, float d){
  float s = uv.x * cos(a) + uv.y * sin(a);
  return smoothstep(0.42, 0.5, abs(fract(s * d) - 0.5));
}
void main(){
  vec3 c = texture(uTex, vUV).rgb;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  vec2 uv = vUV * vec2(uRes.x / uRes.y, 1.0);
  float ink = 0.0;
  if (lum < 0.85) ink = max(ink, 1.0 - line(uv, 0.785, density));
  if (lum < 0.65) ink = max(ink, 1.0 - line(uv, -0.785, density));
  if (lum < 0.45) ink = max(ink, 1.0 - line(uv, 0.0, density));
  if (lum < 0.25) ink = max(ink, 1.0 - line(uv, 1.5708, density));
  vec3 drawn = c * (1.0 - ink * 0.9);
  outColor = vec4(mix(c, drawn, mixAmt), 1.0);
}`,
    },

    paint: {
      label: 'Yağlı Boya (Kuwahara)',
      params: [p('radius', 'Yarıçap', 1, 6, 0.5, 3)],
      audio: ['radius'],
      frag: `uniform float radius;
void main(){
  vec2 px = radius / uRes;
  vec3 mean[4];
  float var_[4];
  // Dört çeyrek pencerenin ortalaması ve varyansı; en düzgün olan seçilir.
  // Kuwahara filtresinin kenarları koruyup içleri düzleştirmesi buradan gelir.
  for (int q = 0; q < 4; q++) {
    vec2 dir = vec2(q == 0 || q == 3 ? 1.0 : -1.0, q < 2 ? 1.0 : -1.0);
    vec3 sum = vec3(0.0);
    vec3 sum2 = vec3(0.0);
    float n = 0.0;
    for (int i = 0; i <= 3; i++) {
      for (int j = 0; j <= 3; j++) {
        vec2 o = vec2(float(i), float(j)) * dir * px;
        vec3 s = texture(uTex, vUV + o).rgb;
        sum += s;
        sum2 += s * s;
        n += 1.0;
      }
    }
    mean[q] = sum / n;
    vec3 v = sum2 / n - mean[q] * mean[q];
    var_[q] = v.r + v.g + v.b;
  }
  int best = 0;
  float bv = var_[0];
  for (int q = 1; q < 4; q++) { if (var_[q] < bv) { bv = var_[q]; best = q; } }
  outColor = vec4(mean[best], 1.0);
}`,
    },

    // ------------------------------------------------------------- analog
    vhs: {
      label: 'VHS / Analog Bant',
      params: [
        p('bleed', 'Renk Taşması', 0, 0.03, 0.0005, 0.008),
        p('noise', 'Gürültü', 0, 1, 0.01, 0.25),
        p('wobble', 'Salınım', 0, 0.02, 0.0002, 0.004),
        p('headswitch', 'Kafa Anahtarı', 0, 0.3, 0.005, 0.06),
      ],
      audio: ['noise', 'wobble', 'bleed'],
      frag: `uniform float bleed, noise, wobble, headswitch;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec2 uv = vUV;
  // Satır bazlı izleme salınımı
  float row = floor(uv.y * uRes.y);
  uv.x += (hash(vec2(row, floor(uTime * 12.0))) - 0.5) * wobble;
  uv.x += sin(uv.y * 40.0 + uTime * 3.0) * wobble * 0.4;
  // Alt kenarda kafa anahtarlama gürültüsü
  float hs = smoothstep(headswitch, 0.0, uv.y);
  uv.x += hs * (hash(vec2(row, uTime)) - 0.5) * 0.08;
  // Renk taşması: kroma yatayda gecikir
  float r = texture(uTex, uv + vec2(bleed, 0.0)).r;
  float g = texture(uTex, uv).g;
  float b = texture(uTex, uv - vec2(bleed, 0.0)).b;
  vec3 c = vec3(r, g, b);
  c += (hash(uv * uRes + uTime) - 0.5) * noise * 0.5;
  c *= 1.0 - hs * 0.5;
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`,
    },

    datamosh: {
      label: 'Datamosh (Blok Kayması)',
      params: [
        p('blocks', 'Blok Boyutu', 4, 80, 1, 24),
        p('amount', 'Kayma', 0, 0.4, 0.005, 0.08),
        p('rate', 'Yenilenme', 0.5, 20, 0.5, 6),
      ],
      audio: ['amount', 'blocks'],
      frag: `uniform float blocks, amount, rate;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec2 grid = floor(vUV * blocks);
  float seed = floor(uTime * rate);
  float h = hash(grid + seed);
  // Blokların yalnızca bir kısmı kayar: hepsi kayarsa görüntü okunmaz olur
  // Değişken adı "moved": GLSL ES 3.00'de "active" ayrılmış sözcüktür
  float moved = step(0.72, h);
  vec2 off = vec2(hash(grid + seed + 7.0) - 0.5, hash(grid + seed + 13.0) - 0.5) * amount * moved;
  vec3 c = texture(uTex, vUV + off).rgb;
  // Kayan bloklarda renk kanalları da ayrışır
  if (moved > 0.5) {
    c.r = texture(uTex, vUV + off * 1.15).r;
    c.b = texture(uTex, vUV + off * 0.85).b;
  }
  outColor = vec4(c, 1.0);
}`,
    },

    slitscan: {
      label: 'Yarık Tarama',
      params: [p('depth', 'Zaman Derinliği', 0, 1, 0.01, 0.7), p('axis', 'Eksen', 0, 1, 1, 0)],
      audio: ['depth'],
      needsPrev: true,
      frag: `uniform float depth, axis;
void main(){
  // Her satır (ya da sütun) bir öncekinden biraz gecikmeli okunur; geri
  // besleme tamponu sayesinde zaman uzayda bir eksene yayılır.
  float k = axis < 0.5 ? vUV.y : vUV.x;
  vec3 cur = texture(uTex, vUV).rgb;
  vec3 prev = texture(uPrev, vUV).rgb;
  float w = depth * k;
  outColor = vec4(mix(cur, prev, w), 1.0);
}`,
    },

    // ------------------------------------------------------------ bozunum
    lens: {
      label: 'Lens Bozunumu',
      params: [p('k1', 'Fıçı / Yastık', -0.6, 0.6, 0.005, 0.22), p('zoom', 'Yakınlaşma', 0.6, 1.6, 0.01, 1)],
      audio: ['k1', 'zoom'],
      frag: `uniform float k1, zoom;
void main(){
  vec2 c = vUV - 0.5;
  float r2 = dot(c, c);
  vec2 uv = c * (1.0 + k1 * r2) / zoom + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  outColor = vec4(texture(uTex, uv).rgb, 1.0);
}`,
    },

    twirl: {
      label: 'Burgu',
      params: [p('angle', 'Açı', -4, 4, 0.02, 1.6), p('radius', 'Yarıçap', 0.05, 1, 0.01, 0.55)],
      audio: ['angle', 'radius'],
      frag: `uniform float angle, radius;
void main(){
  vec2 c = vUV - 0.5;
  c.x *= uRes.x / uRes.y;
  float d = length(c);
  float k = smoothstep(radius, 0.0, d) * angle;
  float s = sin(k), co = cos(k);
  vec2 r = vec2(c.x * co - c.y * s, c.x * s + c.y * co);
  r.x /= uRes.x / uRes.y;
  outColor = vec4(texture(uTex, r + 0.5).rgb, 1.0);
}`,
    },

    polar: {
      label: 'Kutupsal Dönüşüm',
      params: [p('mode', 'Yön', 0, 1, 1, 0), p('spin', 'Dönme', -2, 2, 0.01, 0.1), p('zoom', 'Ölçek', 0.3, 3, 0.01, 1)],
      audio: ['spin', 'zoom'],
      frag: `uniform float mode, spin, zoom;
void main(){
  vec2 uv;
  if (mode < 0.5) {
    // Dikdörtgen -> kutupsal: yatay eksen açı, dikey eksen yarıçap olur
    vec2 c = (vUV - 0.5) * 2.0;
    float a = atan(c.y, c.x) / 6.28318530718 + 0.5 + spin * uTime * 0.1;
    float r = length(c) / zoom;
    uv = vec2(fract(a), clamp(r, 0.0, 1.0));
  } else {
    float a = (vUV.x - 0.5) * 6.28318530718 + spin * uTime;
    float r = vUV.y * zoom;
    uv = vec2(cos(a), sin(a)) * r * 0.5 + 0.5;
  }
  outColor = vec4(texture(uTex, uv).rgb, 1.0);
}`,
    },

    // ---------------------------------------------------------------- renk
    gradientmap: {
      label: 'Gradyan Eşleme',
      params: [
        p('mixAmt', 'Karışım', 0, 1, 0.01, 1),
        p('lo', 'Alt Uç', 0, 1, 0.01, 0),
        p('hi', 'Üst Uç', 0, 1, 0.01, 1),
        p('shift', 'Kaydırma', 0, 1, 0.01, 0),
      ],
      audio: ['shift', 'mixAmt'],
      frag: `uniform float mixAmt, lo, hi, shift;
// Parlaklığı üç durak üzerinden yeniden renklendirir; sahnenin paleti yerine
// efektin kendi rampası kullanılır, bu yüzden bağımsız bir "look" verir.
vec3 ramp(float t){
  t = fract(t + shift);
  vec3 a = vec3(0.06, 0.02, 0.16);
  vec3 b = vec3(0.85, 0.16, 0.42);
  vec3 c = vec3(1.0, 0.86, 0.45);
  return t < 0.5 ? mix(a, b, t * 2.0) : mix(b, c, (t - 0.5) * 2.0);
}
void main(){
  vec3 src = texture(uTex, vUV).rgb;
  float lum = dot(src, vec3(0.299, 0.587, 0.114));
  float t = clamp((lum - lo) / max(0.001, hi - lo), 0.0, 1.0);
  outColor = vec4(mix(src, ramp(t), mixAmt), 1.0);
}`,
    },

    levels: {
      label: 'Seviyeler ve Eğri',
      params: [
        p('black', 'Siyah Noktası', 0, 0.6, 0.005, 0.05),
        p('white', 'Beyaz Noktası', 0.4, 1, 0.005, 0.95),
        p('gamma', 'Gama', 0.2, 3, 0.01, 0.85),
        p('contrast', 'Kontrast', 0, 3, 0.01, 1.15),
      ],
      audio: ['gamma', 'contrast'],
      frag: `uniform float black, white, gamma, contrast;
void main(){
  vec3 c = texture(uTex, vUV).rgb;
  c = clamp((c - black) / max(0.001, white - black), 0.0, 1.0);
  c = pow(c, vec3(1.0 / max(0.05, gamma)));
  c = clamp((c - 0.5) * contrast + 0.5, 0.0, 1.0);
  outColor = vec4(c, 1.0);
}`,
    },

    threshold: {
      label: 'Eşikleme',
      params: [p('level', 'Eşik', 0, 1, 0.01, 0.45), p('soft', 'Yumuşaklık', 0, 0.5, 0.005, 0.08), p('mixAmt', 'Karışım', 0, 1, 0.01, 1)],
      audio: ['level'],
      frag: `uniform float level, soft, mixAmt;
void main(){
  vec3 c = texture(uTex, vUV).rgb;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  float m = smoothstep(level - soft, level + soft, lum);
  outColor = vec4(mix(c, c * m, mixAmt), 1.0);
}`,
    },

    solarize: {
      label: 'Solarizasyon',
      params: [p('point', 'Dönüm Noktası', 0.1, 0.9, 0.01, 0.5), p('mixAmt', 'Karışım', 0, 1, 0.01, 1)],
      audio: ['point'],
      frag: `uniform float point, mixAmt;
void main(){
  vec3 c = texture(uTex, vUV).rgb;
  // Eşiğin üstündeki değerler ters çevrilir — Sabattier etkisi
  vec3 s = mix(c, 1.0 - c, step(vec3(point), c));
  outColor = vec4(mix(c, s, mixAmt), 1.0);
}`,
    },

    godrays: {
      label: 'Işık Huzmeleri',
      params: [
        p('cx', 'Kaynak X', 0, 1, 0.01, 0.5),
        p('cy', 'Kaynak Y', 0, 1, 0.01, 0.35),
        p('density', 'Yoğunluk', 0, 1.5, 0.01, 0.6),
        p('decay', 'Sönüm', 0.8, 1, 0.002, 0.95),
        p('weight', 'Ağırlık', 0, 1, 0.01, 0.35),
      ],
      audio: ['density', 'weight'],
      frag: `uniform float cx, cy, density, decay, weight;
void main(){
  vec2 src = vec2(cx, cy);
  vec2 uv = vUV;
  vec2 delta = (uv - src) * density / 24.0;
  vec3 c = texture(uTex, uv).rgb;
  vec3 sum = vec3(0.0);
  float illum = weight;
  for (int i = 0; i < 24; i++) {
    uv -= delta;
    vec3 s = texture(uTex, uv).rgb;
    // Yalnızca parlak alanlar huzme üretir
    s *= smoothstep(0.45, 1.0, dot(s, vec3(0.333)));
    sum += s * illum;
    illum *= decay;
  }
  outColor = vec4(clamp(c + sum / 24.0 * 3.0, 0.0, 1.0), 1.0);
}`,
    },

    badtv: {
      label: 'Bozuk Sinyal',
      params: [
        p('roll', 'Kayma Hızı', 0, 2, 0.01, 0.25),
        p('tear', 'Yırtılma', 0, 0.3, 0.005, 0.06),
        p('sync', 'Senk Kaybı', 0, 1, 0.01, 0.35),
      ],
      audio: ['tear', 'sync'],
      frag: `uniform float roll, tear, sync;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec2 uv = vUV;
  uv.y = fract(uv.y + uTime * roll * 0.1);
  float band = step(1.0 - sync * 0.35, hash(vec2(floor(uv.y * 30.0), floor(uTime * 8.0))));
  uv.x += band * (hash(vec2(floor(uv.y * 90.0), uTime)) - 0.5) * tear;
  vec3 c = texture(uTex, uv).rgb;
  // Yatay senk çizgisi
  float line = smoothstep(0.004, 0.0, abs(fract(uv.y - uTime * roll * 0.05) - 0.5));
  outColor = vec4(clamp(c + line * 0.25, 0.0, 1.0), 1.0);
}`,
    },

    starfilter: {
      label: 'Yıldız Süzgeci',
      params: [p('threshold', 'Eşik', 0, 1, 0.01, 0.6), p('len', 'Uzunluk', 0, 0.2, 0.002, 0.05), p('points', 'Kol', 2, 8, 1, 4)],
      audio: ['len', 'threshold'],
      frag: `uniform float threshold, len, points;
void main(){
  vec3 base = texture(uTex, vUV).rgb;
  vec3 sum = vec3(0.0);
  int n = int(points);
  for (int k = 0; k < 8; k++) {
    if (k >= n) break;
    float a = float(k) / float(n) * 3.14159265;
    vec2 dir = vec2(cos(a), sin(a));
    for (int i = 1; i <= 10; i++) {
      float f = float(i) / 10.0;
      vec2 o = dir * len * f;
      vec3 s1 = texture(uTex, vUV + o).rgb;
      vec3 s2 = texture(uTex, vUV - o).rgb;
      vec3 m = max(s1, s2);
      sum += max(m - threshold, 0.0) * (1.0 - f);
    }
  }
  outColor = vec4(clamp(base + sum * 0.16, 0.0, 1.0), 1.0);
}`,
    },
  });
})();
