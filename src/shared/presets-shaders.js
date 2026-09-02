'use strict';
/* Yerleşik shader kitaplığı.

   presets.js altı örnekle geliyordu; bir shader editörünün altı örnekle
   gelmesi, editörü öğrenmek isteyen birine yetmez. Buradaki otuz dört shader
   hem kullanıma hazır sahneler hem de okunacak örnekler: her biri farklı bir
   tekniği gösteriyor (ışın yürüyüşü, mesafe alanları, fbm gürültü, kutupsal
   dönüşüm, geri besleme benzeri katmanlama, kaleydoskopik katlama).

   Ortak sözleşme presets.js'teki ile aynı:
     void mainImage(out vec4 fragColor, in vec2 fragCoord)
   Ekler: sv_resolution, sv_time, sv_level, sv_bass, sv_mid, sv_treble,
   sv_beat, sv_spec(x), sv_waveAt(x), sv_col(x) (kullanıcının paleti).

   İki GLSL tuzağı burada özellikle önemli, çünkü kırk shader'da bir kez
   yapılan hata kırk kez aranıyor:
     - `mix`, `length`, `distance` gibi yerleşik adları uniform adı olarak
       kullanmak derlemeyi kırar (gölgeleme).
     - `active`, `sample`, `filter` GLSL ES 3.00'de ayrılmış sözcüktür.
   Kontrol adları bu yüzden hep `u` önekiyle yazılıyor. */
(function () {
  const P = typeof window !== 'undefined' ? window.SVPresets : null;
  if (!P || !P.registerBuiltin) return;

  const s = (name, label, min, max, step, def) =>
    ({ name, label, type: 'slider', min, max, step, default: def });

  // Sık kullanılan GLSL yardımcıları; her shader'ın başına eklenir
  const LIB = `
float sv_hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float sv_noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sv_hash(i), sv_hash(i + vec2(1.0, 0.0)), u.x),
             mix(sv_hash(i + vec2(0.0, 1.0)), sv_hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float sv_fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * sv_noise(p); p *= 2.02; a *= 0.5; }
  return v;
}
mat2 sv_rot(float a){ float c = cos(a), s2 = sin(a); return mat2(c, -s2, s2, c); }
vec2 sv_uv(vec2 fragCoord){
  return (fragCoord - 0.5 * sv_resolution) / min(sv_resolution.x, sv_resolution.y);
}
`;

  const SH = (id, name, kind, description, controls, body) => ({
    id, name, kind, description, controls,
    shader: LIB + body,
  });

  const LIST = [
    // ===================== ARKAPLAN: GÜRÜLTÜ VE AKIŞ =====================
    SH('sh_clouds', 'Bulut Katmanları', 'background',
      'Katmanlı fbm gürültüsü; bas alt katmanları şişirir.',
      [s('uScale', 'Ölçek', 0.5, 8, 0.1, 2.4), s('uSpeed', 'Hız', 0, 2, 0.02, 0.35),
        s('uSharp', 'Keskinlik', 0.2, 4, 0.05, 1.4)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord) * uScale;
  float t = sv_time * uSpeed;
  vec2 q = vec2(sv_fbm(uv + t * 0.2), sv_fbm(uv + vec2(3.1, 1.7) - t * 0.15));
  vec2 r = vec2(sv_fbm(uv + 3.0 * q + vec2(1.7, 9.2) + t * 0.1),
                sv_fbm(uv + 3.0 * q + vec2(8.3, 2.8) - t * 0.12));
  float f = sv_fbm(uv + 3.5 * r * (0.6 + sv_bass * 0.8));
  f = pow(clamp(f, 0.0, 1.0), uSharp);
  vec3 col = sv_col(fract(f * 0.9 + 0.05));
  col *= 0.45 + 0.9 * f + sv_level * 0.5;
  fragColor = vec4(col, 1.0);
}`),

    SH('sh_curlflow', 'Kıvrım Akışı', 'background',
      'Curl gürültüsünde sürüklenen çizgiler.',
      [s('uScale', 'Ölçek', 1, 10, 0.1, 3.5), s('uSpeed', 'Hız', 0, 2, 0.02, 0.5),
        s('uLines', 'Çizgi Sıklığı', 4, 80, 1, 26)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord) * uScale;
  float t = sv_time * uSpeed;
  // Curl: gürültü alanının gradyanının dikini almak akışkan bir alan verir
  float e = 0.05;
  float n1 = sv_fbm(uv + vec2(0.0, e) + t * 0.1);
  float n2 = sv_fbm(uv - vec2(0.0, e) + t * 0.1);
  float n3 = sv_fbm(uv + vec2(e, 0.0) + t * 0.1);
  float n4 = sv_fbm(uv - vec2(e, 0.0) + t * 0.1);
  vec2 curl = vec2(n1 - n2, n4 - n3) / (2.0 * e);
  float band = sin((uv.x + curl.x * (1.0 + sv_bass * 2.0)) * uLines +
                   (uv.y + curl.y * 2.0) * uLines * 0.6 - t * 3.0);
  float f = smoothstep(0.2, 0.9, abs(band));
  vec3 col = sv_col(fract(0.15 + length(curl) * 0.25 + sv_treble * 0.2));
  fragColor = vec4(col * (0.15 + f * (0.7 + sv_level)), 1.0);
}`),

    SH('sh_lava', 'Lav Lambası', 'background',
      'Yavaş yükselen metabol damlalar.',
      [s('uBlobs', 'Damla', 3, 12, 1, 7), s('uSpeed', 'Hız', 0, 1.5, 0.02, 0.3),
        s('uSoft', 'Yumuşaklık', 0.05, 0.6, 0.01, 0.22)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord);
  float t = sv_time * uSpeed;
  float field = 0.0;
  for (int i = 0; i < 12; i++) {
    if (float(i) >= uBlobs) break;
    float fi = float(i);
    vec2 c = vec2(sin(fi * 2.3 + t * 0.7) * 0.45, fract(fi * 0.37 + t * 0.25) * 2.0 - 1.0);
    float r = (0.10 + 0.05 * sin(fi * 1.7)) * (1.0 + sv_bass * 0.7);
    field += r * r / max(1e-4, dot(uv - c, uv - c));
  }
  float f = smoothstep(1.0 - uSoft, 1.0 + uSoft, field);
  vec3 col = mix(sv_col(0.05), sv_col(fract(0.6 + f * 0.35)), f);
  fragColor = vec4(col * (0.4 + f * 0.9 + sv_level * 0.3), 1.0);
}`),

    SH('sh_inkbleed', 'Mürekkep Yayılması', 'background',
      'Suya damlayan mürekkep; vuruşta yeni damla.',
      [s('uScale', 'Ölçek', 1, 8, 0.1, 3), s('uSpeed', 'Hız', 0, 2, 0.02, 0.4),
        s('uContrast', 'Kontrast', 0.5, 5, 0.05, 2)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord) * uScale;
  float t = sv_time * uSpeed;
  float d = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 c = vec2(sin(fi * 4.1 + t * 0.3), cos(fi * 3.3 - t * 0.27)) * 0.8;
    float age = fract(t * 0.15 + fi * 0.25);
    float r = age * (1.4 + sv_bass);
    float edge = abs(length(uv - c) - r);
    d += smoothstep(0.35, 0.0, edge) * (1.0 - age);
  }
  d += sv_fbm(uv * 1.6 + t * 0.1) * 0.6;
  float f = pow(clamp(d, 0.0, 1.0), uContrast);
  vec3 col = sv_col(fract(0.1 + f * 0.7));
  fragColor = vec4(col * (0.2 + f * 1.1), 1.0);
}`),

    SH('sh_smokerings', 'Duman Halkaları', 'background',
      'Kameraya doğru akan halkalar.',
      [s('uRings', 'Halka', 3, 20, 1, 9), s('uSpeed', 'Hız', 0, 2, 0.02, 0.5),
        s('uThick', 'Kalınlık', 0.02, 0.4, 0.01, 0.12)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord);
  float t = sv_time * uSpeed;
  float r = length(uv) * (1.0 + sv_fbm(uv * 3.0 + t * 0.2) * 0.35);
  float acc = 0.0;
  for (int i = 0; i < 20; i++) {
    if (float(i) >= uRings) break;
    float z = fract(float(i) / uRings + t * 0.25);
    float rad = z * 1.4;
    acc += smoothstep(uThick, 0.0, abs(r - rad)) * (1.0 - z) * (0.5 + sv_spec(z) * 1.5);
  }
  vec3 col = sv_col(fract(r * 0.6 + t * 0.05));
  fragColor = vec4(col * (0.1 + acc * 0.9), 1.0);
}`),

    // ======================= ARKAPLAN: GEOMETRİ =======================
    SH('sh_hexflow', 'Petek Akışı', 'background',
      'Altıgen ızgara; her hücre bir frekans bandına bağlı.',
      [s('uScale', 'Hücre Boyutu', 2, 30, 0.5, 10), s('uSpeed', 'Hız', 0, 2, 0.02, 0.4),
        s('uGap', 'Boşluk', 0.02, 0.4, 0.01, 0.12)],
      `vec2 hexCoord(vec2 p){
  vec2 q = vec2(p.x * 1.1547, p.y + p.x * 0.5774);
  vec2 i = floor(q), f = fract(q);
  float s2 = step(f.y, f.x);
  return i + vec2(s2, 1.0 - s2) * step(1.0, f.x + f.y);
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord) * uScale;
  float t = sv_time * uSpeed;
  vec2 cell = hexCoord(uv + vec2(t * 0.3, 0.0));
  float id = fract(sin(dot(cell, vec2(41.3, 17.7))) * 4321.7);
  vec2 centre = cell - vec2(0.5);
  float d = length(fract(uv + vec2(t * 0.3, 0.0)) - 0.5);
  float e = sv_spec(id);
  float f = smoothstep(0.5, 0.5 - uGap, d) * (0.15 + e * 1.6);
  vec3 col = sv_col(fract(id * 0.7 + t * 0.03));
  fragColor = vec4(col * f, 1.0);
}`),

    SH('sh_gridwarp', 'Bükülmüş Izgara', 'background',
      'Perspektif ızgara; bas yüzeyi büker.',
      [s('uLines', 'Çizgi', 5, 60, 1, 20), s('uSpeed', 'Hız', 0, 3, 0.02, 0.8),
        s('uWarp', 'Bükülme', 0, 2, 0.02, 0.6)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord);
  float t = sv_time * uSpeed;
  // Ufka doğru daralan koordinat: perspektif hissi
  float horizon = 0.08;
  float y = uv.y + horizon;
  if (abs(y) < 0.001) y = 0.001;
  vec2 g = vec2(uv.x / abs(y), 1.0 / abs(y) + t);
  g.x += sin(g.y * 0.6 + t) * uWarp * (0.3 + sv_bass);
  vec2 grid = abs(fract(g * uLines * 0.1) - 0.5);
  float line = 1.0 - smoothstep(0.0, 0.06, min(grid.x, grid.y));
  float fade = smoothstep(1.2, 0.0, abs(y) * 4.0);
  vec3 col = sv_col(fract(0.6 + abs(y) * 0.5));
  fragColor = vec4(col * line * fade * (0.6 + sv_level), 1.0);
}`),

    SH('sh_truchet', 'Truchet Örgü', 'background',
      'Vuruşta yön değiştiren çeyrek yaylar.',
      [s('uScale', 'Karo', 2, 24, 0.5, 8), s('uWidth', 'Çizgi', 0.02, 0.3, 0.005, 0.09),
        s('uSpeed', 'Değişim', 0, 2, 0.02, 0.25)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord) * uScale;
  vec2 i = floor(uv), f = fract(uv);
  float t = floor(sv_time * uSpeed + sv_beat * 2.0);
  float flip = step(0.5, fract(sin(dot(i, vec2(31.7, 57.3)) + t) * 4321.7));
  if (flip > 0.5) f.x = 1.0 - f.x;
  float d = min(abs(length(f) - 0.5), abs(length(f - 1.0) - 0.5));
  float line = smoothstep(uWidth, uWidth * 0.35, d);
  vec3 col = sv_col(fract(dot(i, vec2(0.07, 0.11)) + sv_time * 0.02));
  fragColor = vec4(col * line * (0.5 + sv_level * 0.9), 1.0);
}`),

    SH('sh_moire', 'Moiré Girişimi', 'background',
      'Hafifçe farklı açılarda üst üste binen ızgaralar.',
      [s('uLines', 'Sıklık', 20, 300, 1, 90), s('uAngle', 'Açı Farkı', 0, 0.2, 0.001, 0.03),
        s('uSpeed', 'Dönme', 0, 1, 0.01, 0.08)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord);
  float t = sv_time * uSpeed;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 p = sv_rot(t + fi * uAngle * 6.2831 + sv_bass * 0.3) * uv;
    float g = abs(fract(p.x * uLines) - 0.5);
    acc += sv_col(fi / 3.0) * smoothstep(0.5, 0.32, g);
  }
  fragColor = vec4(acc * (0.35 + sv_level * 0.8), 1.0);
}`),

    SH('sh_crystal', 'Kristal Mağara', 'background',
      'Voronoi hücreleri, kristal kenarlarıyla.',
      [s('uScale', 'Ölçek', 1, 16, 0.5, 6), s('uSpeed', 'Hız', 0, 2, 0.02, 0.35),
        s('uEdge', 'Kenar', 0.01, 0.3, 0.005, 0.05)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord) * uScale;
  float t = sv_time * uSpeed;
  vec2 i = floor(uv), f = fract(uv);
  float d1 = 8.0, d2 = 8.0;
  float id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      float h = sv_hash(i + g);
      vec2 p = g + 0.5 + 0.45 * vec2(sin(t + h * 6.28), cos(t * 1.3 + h * 6.28));
      float d = length(p - f);
      if (d < d1) { d2 = d1; d1 = d; id = h; }
      else if (d < d2) { d2 = d; }
    }
  }
  float edge = smoothstep(0.0, uEdge, d2 - d1);
  float e = sv_spec(id);
  vec3 col = sv_col(fract(id + t * 0.05));
  fragColor = vec4(col * (0.1 + e * 1.4) * (0.25 + edge * 0.9), 1.0);
}`),

    // ====================== ARKAPLAN: FRAKTAL ======================
    SH('sh_mandel', 'Mandelbrot Yakınlaşması', 'background',
      'Sonsuz yakınlaşan kaçış-zamanı fraktalı.',
      [s('uZoom', 'Yakınlaşma Hızı', 0, 0.6, 0.005, 0.12), s('uIter', 'Yineleme', 32, 300, 1, 140),
        s('uCx', 'Merkez X', -1, 1, 0.001, -0.743), s('uCy', 'Merkez Y', -1, 1, 0.001, 0.1315)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord);
  float zoom = exp(-sv_time * uZoom) * (1.0 + sv_bass * 0.15);
  vec2 c = vec2(uCx, uCy) + uv * zoom * 2.5;
  vec2 z = vec2(0.0);
  float n = 0.0;
  for (int i = 0; i < 300; i++) {
    if (float(i) >= uIter) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    if (dot(z, z) > 256.0) break;
    n += 1.0;
  }
  // Düzgün yineleme sayısı: bant yerine sürekli geçiş verir
  float sm = n - log2(max(1.0, log2(max(1.0, length(z)))));
  float f = fract(sm * 0.03 + sv_time * 0.02 + sv_treble * 0.1);
  vec3 col = n >= uIter - 0.5 ? vec3(0.0) : sv_col(f);
  fragColor = vec4(col * (0.7 + sv_level * 0.7), 1.0);
}`),

    SH('sh_julia', 'Julia Kümesi', 'background',
      'Tiz sesle şekil değiştiren Julia kümesi.',
      [s('uIter', 'Yineleme', 24, 240, 1, 110), s('uScale', 'Ölçek', 0.5, 3, 0.02, 1.4),
        s('uMorph', 'Ses Etkisi', 0, 1, 0.01, 0.35)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 z = sv_uv(fragCoord) * uScale * 2.0;
  float t = sv_time * 0.15;
  vec2 c = vec2(0.7885 * cos(t), 0.7885 * sin(t));
  c += vec2(sv_bass, sv_treble) * uMorph * 0.25;
  float n = 0.0;
  for (int i = 0; i < 240; i++) {
    if (float(i) >= uIter) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    if (dot(z, z) > 64.0) break;
    n += 1.0;
  }
  float sm = n - log2(max(1.0, log2(max(1.0, length(z)))));
  vec3 col = n >= uIter - 0.5 ? sv_col(0.02) : sv_col(fract(sm * 0.04 + 0.2));
  fragColor = vec4(col * (0.6 + sv_level * 0.8), 1.0);
}`),

    SH('sh_burningship', 'Yanan Gemi', 'background',
      'Mandelbrot ailesinin mutlak değerli akrabası.',
      [s('uIter', 'Yineleme', 32, 240, 1, 120), s('uZoom', 'Yakınlaşma', 0, 0.5, 0.005, 0.08)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord);
  float zoom = exp(-sv_time * uZoom) * (1.0 + sv_bass * 0.12);
  vec2 c = vec2(-1.75, -0.03) + uv * zoom * 2.0;
  vec2 z = vec2(0.0);
  float n = 0.0;
  for (int i = 0; i < 240; i++) {
    if (float(i) >= uIter) break;
    z = vec2(abs(z.x), abs(z.y));
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    if (dot(z, z) > 64.0) break;
    n += 1.0;
  }
  float f = fract(n * 0.035 + sv_time * 0.02);
  fragColor = vec4((n >= uIter - 0.5 ? vec3(0.0) : sv_col(f)) * (0.7 + sv_level * 0.6), 1.0);
}`),

    SH('sh_apollonian', 'Apollonius Çemberleri', 'background',
      'Yinelemeli olarak paketlenmiş çemberler.',
      [s('uIter', 'Katman', 3, 14, 1, 8), s('uScale', 'Ölçek', 0.5, 3, 0.02, 1.2),
        s('uSpeed', 'Hız', 0, 1, 0.01, 0.15)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 p = sv_uv(fragCoord) * uScale;
  float t = sv_time * uSpeed;
  float scale = 1.0;
  float d = 1e9;
  for (int i = 0; i < 14; i++) {
    if (float(i) >= uIter) break;
    p = -1.0 + 2.0 * fract(0.5 * p + 0.5);
    float r2 = dot(p, p) + 0.0001;
    float k = (1.0 + 0.25 * sin(t) + sv_bass * 0.2) / r2;
    p *= k;
    scale *= k;
    d = min(d, abs(length(p) - 0.6) / scale);
  }
  float f = smoothstep(0.02, 0.0, d);
  vec3 col = sv_col(fract(log(scale) * 0.15 + t));
  fragColor = vec4(col * (0.15 + f * 1.2 + sv_level * 0.3), 1.0);
}`),

    SH('sh_kifs', 'Kaleydoskopik IFS', 'background',
      'Katlanan uzay; her katlama simetriyi artırır.',
      [s('uFolds', 'Katlama', 2, 12, 1, 7), s('uScale', 'Ölçek', 1.1, 2.5, 0.01, 1.6),
        s('uSpin', 'Dönme', 0, 1, 0.01, 0.12)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 p = sv_uv(fragCoord) * 1.6;
  float t = sv_time * uSpin;
  float d = 1e9;
  float sc = 1.0;
  for (int i = 0; i < 12; i++) {
    if (float(i) >= uFolds) break;
    p = abs(p);
    p -= 0.35 + 0.1 * sin(t + float(i)) + sv_bass * 0.06;
    p = sv_rot(t * 0.5 + float(i) * 0.3) * p;
    p *= uScale;
    sc *= uScale;
    d = min(d, (length(p) - 0.5) / sc);
  }
  float f = smoothstep(0.015, 0.0, abs(d));
  vec3 col = sv_col(fract(d * 4.0 + t));
  fragColor = vec4(col * (0.1 + f * 1.3), 1.0);
}`),

    SH('sh_menger', 'Menger Süngeri', 'background',
      'Işın yürüyüşüyle çizilen üç boyutlu fraktal.',
      [s('uIter', 'Katman', 1, 6, 1, 4), s('uSpeed', 'Hız', 0, 1, 0.01, 0.15),
        s('uZoom', 'Yakınlık', 1, 6, 0.05, 2.6)],
      `float mengerDE(vec3 p, float iter){
  float d = max(abs(p.x), max(abs(p.y), abs(p.z))) - 1.0;
  float s2 = 1.0;
  for (int i = 0; i < 6; i++) {
    if (float(i) >= iter) break;
    vec3 a = mod(p * s2, 2.0) - 1.0;
    s2 *= 3.0;
    vec3 r = abs(1.0 - 3.0 * abs(a));
    float da = max(r.x, r.y);
    float db = max(r.y, r.z);
    float dc = max(r.z, r.x);
    d = max(d, (min(da, min(db, dc)) - 1.0) / s2);
  }
  return d;
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord);
  float t = sv_time * uSpeed;
  vec3 ro = vec3(0.0, 0.0, -uZoom - sv_bass * 0.4);
  vec3 rd = normalize(vec3(uv, 1.2));
  ro.xz = sv_rot(t) * ro.xz; rd.xz = sv_rot(t) * rd.xz;
  ro.xy = sv_rot(t * 0.6) * ro.xy; rd.xy = sv_rot(t * 0.6) * rd.xy;
  float d = 0.0;
  float hit = 0.0;
  for (int i = 0; i < 64; i++) {
    vec3 p = ro + rd * d;
    float ds = mengerDE(p, uIter);
    if (ds < 0.001) { hit = 1.0 - float(i) / 64.0; break; }
    d += ds * 0.9;
    if (d > 12.0) break;
  }
  vec3 col = sv_col(fract(hit * 1.5 + t * 0.2)) * hit;
  fragColor = vec4(col * (0.7 + sv_level * 0.8), 1.0);
}`),

    SH('sh_mandelbulb', 'Mandelbulb', 'background',
      'Üç boyutlu fraktal; kuvveti sese bağlı.',
      [s('uPower', 'Kuvvet', 3, 12, 0.1, 8), s('uSpeed', 'Dönüş', 0, 1, 0.01, 0.15),
        s('uAudio', 'Ses Etkisi', 0, 3, 0.05, 1)],
      `float bulbDE(vec3 p, float power){
  vec3 z = p;
  float dr = 1.0, r = 0.0;
  for (int i = 0; i < 8; i++) {
    r = length(z);
    if (r > 2.0) break;
    float theta = acos(clamp(z.z / max(1e-6, r), -1.0, 1.0));
    float phi = atan(z.y, z.x);
    dr = pow(r, power - 1.0) * power * dr + 1.0;
    float zr = pow(r, power);
    theta *= power; phi *= power;
    z = zr * vec3(sin(theta) * cos(phi), sin(phi) * sin(theta), cos(theta)) + p;
  }
  return 0.5 * log(max(1e-6, r)) * r / max(1e-6, dr);
}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord);
  float t = sv_time * uSpeed;
  float power = uPower + sv_bass * uAudio;
  vec3 ro = vec3(0.0, 0.0, -2.4);
  vec3 rd = normalize(vec3(uv, 1.4));
  ro.xz = sv_rot(t) * ro.xz; rd.xz = sv_rot(t) * rd.xz;
  float d = 0.0, glow = 0.0;
  for (int i = 0; i < 64; i++) {
    vec3 p = ro + rd * d;
    float ds = bulbDE(p, power);
    glow += 0.012 / (0.02 + ds);
    if (ds < 0.0015) break;
    d += ds;
    if (d > 6.0) break;
  }
  vec3 col = sv_col(fract(glow * 0.08 + t * 0.3)) * clamp(glow * 0.09, 0.0, 1.4);
  fragColor = vec4(col * (0.8 + sv_level * 0.5), 1.0);
}`),

    SH('sh_tunnel3d', 'Işık Tüneli', 'background',
      'Kutupsal tünel; duvar dokusu spektrumdan.',
      [s('uSpeed', 'Hız', 0, 4, 0.02, 1.2), s('uTwist', 'Burgu', 0, 3, 0.02, 0.6),
        s('uRings', 'Halka', 2, 40, 1, 12)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord);
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float t = sv_time * uSpeed;
  float z = 1.0 / max(0.02, r) + t;
  a += z * uTwist * 0.1 + sv_bass * 0.4;
  float bands = sin(z * uRings) * 0.5 + 0.5;
  float spokes = sin(a * 8.0) * 0.5 + 0.5;
  float e = sv_spec(fract(z * 0.1));
  float f = bands * (0.4 + spokes * 0.6) * (0.3 + e * 1.6);
  vec3 col = sv_col(fract(z * 0.06 + a * 0.08));
  fragColor = vec4(col * f * smoothstep(0.0, 0.25, r), 1.0);
}`),

    SH('sh_starwarp', 'Yıldız Sıçraması', 'background',
      'Işık hızına geçen yıldız alanı.',
      [s('uSpeed', 'Hız', 0, 4, 0.02, 1), s('uDensity', 'Yoğunluk', 20, 300, 5, 120),
        s('uStretch', 'Uzama', 0, 3, 0.02, 1)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord);
  float t = sv_time * uSpeed;
  float a = atan(uv.y, uv.x);
  float r = length(uv);
  float acc = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float lane = floor(a / 6.2831 * uDensity + fi * 0.33);
    float h = sv_hash(vec2(lane, fi));
    float z = fract(h + t * (0.3 + h * 0.7));
    float rr = z * 1.6;
    float w = 0.004 + uStretch * 0.02 * z * (1.0 + sv_bass);
    acc += smoothstep(w, 0.0, abs(r - rr)) * (1.0 - z);
  }
  vec3 col = sv_col(fract(r * 0.7 + t * 0.05));
  fragColor = vec4(col * acc * (0.7 + sv_level * 1.2), 1.0);
}`),

    SH('sh_aurora', 'Kutup Perdesi', 'background',
      'Dikey perdeler halinde akan ışık.',
      [s('uScale', 'Ölçek', 0.5, 6, 0.1, 2), s('uSpeed', 'Hız', 0, 1.5, 0.02, 0.3),
        s('uHeight', 'Yükseklik', 0.2, 2, 0.02, 0.9)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord);
  float t = sv_time * uSpeed;
  float acc = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float x = uv.x * uScale + fi * 1.3;
    float wave = sv_fbm(vec2(x, t * 0.5 + fi)) * 0.6 - 0.3;
    float y = uv.y - wave;
    float band = exp(-abs(y) * (4.0 / uHeight)) * (0.4 + sv_spec(fi / 4.0) * 1.6);
    acc += band * 0.4;
  }
  vec3 col = sv_col(fract(uv.y * 0.5 + 0.5 + t * 0.05));
  fragColor = vec4(col * acc * (0.6 + sv_level * 0.8), 1.0);
}`),

    SH('sh_liquidmetal', 'Sıvı Metal', 'background',
      'Eşyükselti bantlarıyla metalik yüzey.',
      [s('uBands', 'Bant', 2, 20, 1, 7), s('uScale', 'Ölçek', 1, 10, 0.1, 3),
        s('uSpeed', 'Hız', 0, 2, 0.02, 0.5)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord) * uScale;
  float t = sv_time * uSpeed;
  float v = sv_fbm(uv + vec2(sin(t * 0.4), cos(t * 0.33)) * 1.5);
  v += 0.4 * sin(length(uv) * 3.0 - t * 2.0) * (0.5 + sv_bass);
  float band = abs(sin(v * 3.1416 * uBands));
  float k = pow(band, 3.0);
  vec3 col = sv_col(fract(v * 0.6));
  fragColor = vec4(col * (0.15 + k * 1.1) * (0.7 + sv_level * 0.6), 1.0);
}`),

    SH('sh_neonrain', 'Neon Yağmur', 'background',
      'Düşen ışık çizgileri.',
      [s('uCols', 'Sütun', 10, 200, 2, 60), s('uSpeed', 'Hız', 0, 4, 0.02, 1.2),
        s('uTail', 'Kuyruk', 0.05, 1, 0.01, 0.35)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = fragCoord / sv_resolution;
  float t = sv_time * uSpeed;
  float col = floor(uv.x * uCols);
  float h = sv_hash(vec2(col, 3.7));
  float speed = 0.4 + h * 1.2;
  float y = fract(uv.y + t * speed + h);
  float e = sv_spec(h);
  float f = pow(1.0 - y, 1.0 / max(0.02, uTail)) * (0.3 + e * 2.0);
  vec3 c = sv_col(fract(h + sv_time * 0.03));
  fragColor = vec4(c * f, 1.0);
}`),

    SH('sh_reactiondiff', 'Reaksiyon Deseni', 'background',
      'Gray-Scott görünümlü organik desen.',
      [s('uScale', 'Ölçek', 2, 20, 0.5, 8), s('uSpeed', 'Hız', 0, 1.5, 0.02, 0.25),
        s('uSharp', 'Keskinlik', 1, 20, 0.5, 8)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord) * uScale;
  float t = sv_time * uSpeed;
  // Gerçek bir çözücü çok geçişli olurdu; burada aynı görsel aileyi üreten
  // katmanlı gürültü kullanılıyor ve adı da bunu söylüyor
  float a = sv_fbm(uv + t);
  float b = sv_fbm(uv * 1.7 - t * 0.7 + a * 2.0);
  float v = sin((a - b) * 6.2831 * (1.0 + sv_bass * 0.5));
  float f = smoothstep(-0.1, 0.1, v);
  f = pow(f, uSharp * 0.15);
  vec3 col = mix(sv_col(0.08), sv_col(fract(0.55 + b * 0.3)), f);
  fragColor = vec4(col * (0.5 + sv_level * 0.7), 1.0);
}`),

    SH('sh_causticsgl', 'Su Kostikleri', 'background',
      'Su yüzeyinden kırılan ışık çizgileri.',
      [s('uScale', 'Ölçek', 2, 20, 0.5, 8), s('uSpeed', 'Hız', 0, 3, 0.02, 0.8),
        s('uSharp', 'Keskinlik', 1, 12, 0.5, 5)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord) * uScale;
  float t = sv_time * uSpeed;
  float v = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i) + 1.0;
    v += sin(uv.x * fi * 1.3 + t * fi * 0.4) + sin(uv.y * fi * 1.1 - t * fi * 0.33);
  }
  float k = pow(1.0 - clamp(abs(v) / 6.0, 0.0, 1.0), uSharp) * (0.6 + sv_level * 0.9);
  vec3 deep = sv_col(0.08) * 0.4;
  fragColor = vec4(deep + sv_col(0.9) * k, 1.0);
}`),

    SH('sh_prismglow', 'Prizma Işıması', 'background',
      'Işınsal prizma dilimleri; her dilim bir bant.',
      [s('uSlices', 'Dilim', 3, 48, 1, 16), s('uSpin', 'Dönme', -2, 2, 0.02, 0.2),
        s('uFalloff', 'Sönüm', 0.5, 4, 0.05, 1.6)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord);
  float r = length(uv);
  float a = atan(uv.y, uv.x) + sv_time * uSpin;
  float slice = floor((a / 6.2831 + 0.5) * uSlices);
  float e = sv_spec(fract(slice / uSlices));
  float f = pow(max(0.0, 1.0 - r / (0.25 + e * 0.9)), uFalloff);
  vec3 col = sv_col(fract(slice / uSlices + sv_time * 0.03));
  fragColor = vec4(col * f * (0.6 + sv_level), 1.0);
}`),

    // ==================== GÖRSELLEŞTİRİCİ SHADER'LARI ====================
    SH('sh_specbars', 'Işıyan Barlar', 'visualizer',
      'Spektrum barları, yumuşak parlamayla.',
      [s('uBars', 'Bar', 8, 160, 1, 64), s('uGap', 'Boşluk', 0, 0.8, 0.01, 0.25),
        s('uGlow', 'Parlama', 0, 2, 0.02, 0.8)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = fragCoord / sv_resolution;
  float idx = floor(uv.x * uBars);
  float fx = fract(uv.x * uBars);
  float e = sv_spec(idx / uBars);
  float inBar = step(uGap * 0.5, fx) * step(fx, 1.0 - uGap * 0.5);
  float h = e * 0.95;
  float body = step(uv.y, h) * inBar;
  float glow = exp(-abs(uv.y - h) * (14.0 / max(0.05, uGlow))) * inBar;
  vec3 col = sv_col(fract(idx / uBars * 0.8 + 0.1));
  fragColor = vec4(col * (body + glow * 0.9), body + glow * 0.6);
}`),

    SH('sh_specring', 'Spektrum Halkası', 'visualizer',
      'Dairesel spektrum; yarıçap frekansa göre.',
      [s('uRadius', 'Yarıçap', 0.1, 0.6, 0.01, 0.28), s('uAmp', 'Genlik', 0.05, 0.6, 0.01, 0.2),
        s('uWidth', 'Kalınlık', 0.002, 0.08, 0.001, 0.012)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord);
  float r = length(uv);
  float a = atan(uv.y, uv.x) / 6.2831 + 0.5;
  float e = sv_spec(a);
  float target = uRadius + e * uAmp;
  float d = abs(r - target);
  float f = smoothstep(uWidth, 0.0, d);
  float glow = exp(-d * 26.0) * 0.5;
  vec3 col = sv_col(fract(a + sv_time * 0.05));
  fragColor = vec4(col * (f + glow) * (0.8 + sv_level * 0.6), f + glow * 0.7);
}`),

    SH('sh_wavefield', 'Dalga Alanı', 'visualizer',
      'Dalga formunun kendisinden üretilen yüzey.',
      [s('uAmp', 'Genlik', 0.05, 0.8, 0.01, 0.3), s('uLines', 'Katman', 1, 24, 1, 8),
        s('uThick', 'Kalınlık', 0.002, 0.06, 0.001, 0.008)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord);
  float acc = 0.0;
  for (int i = 0; i < 24; i++) {
    if (float(i) >= uLines) break;
    float fi = float(i) / max(1.0, uLines - 1.0);
    float w = sv_waveAt(fract(uv.x * 0.5 + 0.5 + fi * 0.05));
    float y = (fi - 0.5) * 0.7 + w * uAmp;
    acc += smoothstep(uThick, 0.0, abs(uv.y - y));
  }
  vec3 col = sv_col(fract(uv.y + 0.5 + sv_time * 0.04));
  fragColor = vec4(col * acc, min(1.0, acc));
}`),

    SH('sh_beatburst', 'Vuruş Patlaması', 'visualizer',
      'Her vuruşta dışa açılan halka.',
      [s('uRings', 'Halka', 1, 8, 1, 3), s('uSpeed', 'Hız', 0.2, 4, 0.05, 1.4),
        s('uWidth', 'Kalınlık', 0.005, 0.15, 0.002, 0.03)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord);
  float r = length(uv);
  float acc = 0.0;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uRings) break;
    float phase = fract(sv_time * uSpeed * 0.35 + float(i) / uRings);
    float rad = phase * 0.8;
    float fade = 1.0 - phase;
    acc += smoothstep(uWidth, 0.0, abs(r - rad)) * fade;
  }
  acc *= 0.4 + sv_beat * 1.6 + sv_bass;
  vec3 col = sv_col(fract(r + sv_time * 0.06));
  fragColor = vec4(col * acc, min(1.0, acc));
}`),

    SH('sh_scopeglow', 'Parlayan Osiloskop', 'visualizer',
      'Dalga formu, fosfor parlamasıyla.',
      [s('uAmp', 'Genlik', 0.05, 0.9, 0.01, 0.35), s('uThick', 'Kalınlık', 0.002, 0.05, 0.001, 0.006),
        s('uGlow', 'Parlama', 0, 3, 0.05, 1.2)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord);
  float x = uv.x * 0.5 + 0.5;
  float w = sv_waveAt(x) * uAmp;
  float d = abs(uv.y - w);
  float core = smoothstep(uThick, 0.0, d);
  float glow = exp(-d * (18.0 / max(0.05, uGlow))) * 0.7;
  vec3 col = sv_col(fract(x * 0.6 + sv_time * 0.05));
  float a = core + glow;
  fragColor = vec4(col * a * (0.8 + sv_level * 0.7), min(1.0, a));
}`),

    SH('sh_freqmesh', 'Frekans Ağı', 'visualizer',
      'Perspektifte kayan spektrum ağı.',
      [s('uRows', 'Satır', 4, 40, 1, 16), s('uAmp', 'Yükseklik', 0.05, 0.8, 0.01, 0.3),
        s('uSpeed', 'Kayma', 0, 2, 0.02, 0.5)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord);
  float t = sv_time * uSpeed;
  float acc = 0.0;
  for (int i = 0; i < 40; i++) {
    if (float(i) >= uRows) break;
    float fi = float(i) / uRows;
    float z = fract(fi + t * 0.2);
    float persp = 1.0 / (0.25 + z * 2.0);
    float e = sv_spec(fract(uv.x * 0.5 + 0.5 + z * 0.2));
    float y = (z - 0.5) * 0.9 - e * uAmp * persp;
    acc += smoothstep(0.006, 0.0, abs(uv.y - y)) * (1.0 - z);
  }
  vec3 col = sv_col(fract(uv.x * 0.4 + 0.5));
  fragColor = vec4(col * acc, min(1.0, acc));
}`),

    SH('sh_chromaring', 'Nota Çemberi', 'visualizer',
      'On iki dilim; her dilim bir nota sınıfı bölgesi.',
      [s('uInner', 'İç Yarıçap', 0.05, 0.45, 0.01, 0.16), s('uOuter', 'Dış Yarıçap', 0.2, 0.7, 0.01, 0.42),
        s('uGap', 'Boşluk', 0, 0.3, 0.005, 0.04)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord);
  float r = length(uv);
  float a = atan(uv.y, uv.x) / 6.2831 + 0.5;
  float slice = floor(a * 12.0);
  float f = fract(a * 12.0);
  float e = sv_spec(fract(slice / 12.0 * 0.8 + 0.05));
  float rOut = uInner + (uOuter - uInner) * (0.15 + e * 0.85);
  float inSlice = step(uGap, f) * step(f, 1.0 - uGap);
  float body = step(uInner, r) * step(r, rOut) * inSlice;
  float glow = exp(-abs(r - rOut) * 30.0) * inSlice * 0.6;
  vec3 col = sv_col(fract(slice / 12.0));
  fragColor = vec4(col * (body + glow), body + glow * 0.7);
}`),

    SH('sh_particleflow', 'Parçacık Akışı', 'visualizer',
      'Gürültü alanında sürüklenen ışık noktaları.',
      [s('uCount', 'Yoğunluk', 20, 300, 5, 120), s('uSpeed', 'Hız', 0, 2, 0.02, 0.6),
        s('uSize', 'Nokta Boyutu', 0.002, 0.03, 0.001, 0.007)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord);
  float t = sv_time * uSpeed;
  float acc = 0.0;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 300; i++) {
    if (float(i) >= uCount) break;
    float fi = float(i);
    float h = sv_hash(vec2(fi, 7.3));
    vec2 seed = vec2(h, sv_hash(vec2(fi, 19.1)));
    vec2 p = (seed - 0.5) * 1.6;
    p += vec2(sin(t * (0.4 + h) + h * 6.28), cos(t * (0.3 + h) + h * 4.11)) * (0.25 + sv_bass * 0.3);
    float e = sv_spec(h);
    float d = length(uv - p);
    float k = smoothstep(uSize * (1.0 + e * 2.0), 0.0, d);
    acc += k;
    col += sv_col(fract(h + sv_time * 0.03)) * k * (0.3 + e * 1.4);
  }
  fragColor = vec4(col, min(1.0, acc));
}`),

    SH('sh_kaleidospec', 'Kaleydoskop Spektrum', 'visualizer',
      'Tek dilime çizilen spektrum, N kez aynalanır.',
      [s('uSlices', 'Dilim', 3, 24, 1, 8), s('uSpin', 'Dönme', -2, 2, 0.02, 0.15),
        s('uAmp', 'Genlik', 0.05, 0.7, 0.01, 0.28)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = sv_uv(fragCoord);
  float r = length(uv);
  float a = atan(uv.y, uv.x) + sv_time * uSpin;
  float seg = 6.2831 / uSlices;
  a = abs(mod(a, seg) - seg * 0.5);
  float e = sv_spec(a / seg * 2.0);
  float target = 0.12 + e * uAmp;
  float d = abs(r - target);
  float f = smoothstep(0.012, 0.0, d) + exp(-d * 24.0) * 0.5;
  vec3 col = sv_col(fract(a / seg + sv_time * 0.04));
  fragColor = vec4(col * f * (0.8 + sv_level * 0.6), min(1.0, f));
}`),

    SH('sh_gridpulse', 'Nabız Izgarası', 'visualizer',
      'Hücre ızgarası; her hücre bir bant.',
      [s('uCols', 'Sütun', 4, 40, 1, 16), s('uRows', 'Satır', 2, 24, 1, 9),
        s('uRound', 'Yuvarlaklık', 0, 0.5, 0.01, 0.15)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = fragCoord / sv_resolution;
  vec2 cell = vec2(uCols, uRows);
  vec2 i = floor(uv * cell);
  vec2 f = fract(uv * cell) - 0.5;
  float id = (i.y * uCols + i.x) / (uCols * uRows);
  float e = sv_spec(id);
  float d = length(max(abs(f) - (0.5 - uRound), 0.0)) - uRound;
  float k = smoothstep(0.02, -0.02, d) * (0.08 + e * 1.5);
  vec3 col = sv_col(fract(id * 0.9 + sv_time * 0.03));
  fragColor = vec4(col * k, min(1.0, k));
}`),

    SH('sh_liquidbars', 'Sıvı Barlar', 'visualizer',
      'Barlar arası yumuşak geçişle akışkan tepe çizgisi.',
      [s('uBars', 'Bant', 8, 128, 1, 48), s('uSmooth', 'Yumuşaklık', 0, 1, 0.01, 0.6),
        s('uThick', 'Kalınlık', 0.002, 0.06, 0.001, 0.01)],
      `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = fragCoord / sv_resolution;
  float x = uv.x * uBars;
  float i = floor(x), f = fract(x);
  // Komşu bantlar arasında yumuşak geçiş: bar kenarları yerine akışkan çizgi
  float e0 = sv_spec(i / uBars);
  float e1 = sv_spec((i + 1.0) / uBars);
  float k = mix(f, f * f * (3.0 - 2.0 * f), uSmooth);
  float h = mix(e0, e1, k) * 0.9;
  float d = abs(uv.y - h);
  float line = smoothstep(uThick, 0.0, d);
  float fill = step(uv.y, h) * 0.35;
  vec3 col = sv_col(fract(uv.x * 0.8 + sv_time * 0.04));
  float a = line + fill;
  fragColor = vec4(col * (line * 1.4 + fill), min(1.0, a));
}`),
  ];

  P.registerBuiltin(LIST.map((p) => Object.assign({ builtin: true, engine: 'shader', author: 'CAYADEV' }, p)));
})();
