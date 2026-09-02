'use strict';
/* Studio preset biçimi, yerleşik shader'lar ve Shadertoy/ISF dönüştürücüleri.

   Bir preset iki motordan biriyle çalışır:
     engine: 'variation' — mevcut bir modun parametre/renk varyasyonu (kod yok)
     engine: 'shader'    — kullanıcının GLSL fragment shader'ı

   Preset İÇERİĞİ ayar dosyasında tutulmaz; ana süreç userData/presets/ altında
   ayrı dosyalarda saklar ve buradaki kayda (setUser) iletir. Ayarlarda yalnızca
   seçili preset kimliği ve kullanıcının verdiği parametre değerleri durur.

   Aynı dosya hem yönetici panelinde, hem görselleştiricide, hem çevrimdışı
   dışa aktarıcıda, hem de OBS tarayıcı kaynağında yüklenir. */
(function () {
  const FORMAT = 'svpreset';
  const PACK_FORMAT = 'svpack';
  const VERSION = 1;

  // --------------------------------------------------------------------------
  // Yerleşik shader presetleri
  //
  // Hepsi mainImage(out vec4, in vec2) yazar — Shadertoy ile aynı giriş noktası.
  // Kullanılabilir ekler: sv_level/sv_bass/sv_mid/sv_treble/sv_beat,
  // sv_spec(x), sv_waveAt(x), sv_col(x) (kullanıcının palet renkleri).
  // --------------------------------------------------------------------------
  const BUILTIN_SHADERS = [
    {
      id: 'sh_plasma',
      name: 'Plazma Deniz',
      kind: 'background',
      description: 'Klasik plazma: katmanlı sinüsler basla dalgalanır.',
      controls: [
        { name: 'uScale', label: 'Ölçek', type: 'slider', min: 0.5, max: 8, step: 0.1, default: 3 },
        { name: 'uSpeed', label: 'Hız', type: 'slider', min: 0, max: 3, step: 0.02, default: 1 },
        { name: 'uWarp', label: 'Bükülme', type: 'slider', min: 0, max: 2, step: 0.02, default: 0.7 },
      ],
      shader: `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*sv_resolution) / min(sv_resolution.x, sv_resolution.y);
  float t = sv_time * uSpeed;
  vec2 p = uv * uScale;
  p += uWarp * vec2(sin(p.y*1.7 + t*1.1), cos(p.x*1.5 - t*0.9)) * (0.4 + sv_bass*0.9);
  float v = sin(p.x + t) + sin(p.y*1.3 - t*0.7) + sin((p.x+p.y)*0.8 + t*0.5);
  v += sin(length(p)*2.0 - t*1.6) * (0.6 + sv_level*1.2);
  float f = v*0.25 + 0.5;
  vec3 col = sv_col(fract(f));
  col *= 0.55 + 0.75*sv_level + 0.4*sv_bass;
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'sh_rings',
      name: 'Frekans Halkaları',
      kind: 'background',
      description: 'Merkezden yayılan halkalar; her halka bir frekans bandı.',
      controls: [
        { name: 'uRings', label: 'Halka Sayısı', type: 'slider', min: 4, max: 64, step: 1, default: 22 },
        { name: 'uWidth', label: 'Halka Kalınlığı', type: 'slider', min: 0.02, max: 0.6, step: 0.01, default: 0.16 },
        { name: 'uSpin', label: 'Dönüş', type: 'slider', min: -2, max: 2, step: 0.02, default: 0.3 },
      ],
      shader: `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*sv_resolution) / min(sv_resolution.x, sv_resolution.y);
  float r = length(uv);
  float a = atan(uv.y, uv.x) + sv_time*uSpin;
  float band = sv_spec(clamp(r*1.4, 0.0, 1.0));
  float idx = r*uRings - sv_time*0.6;
  float ring = smoothstep(uWidth, 0.0, abs(fract(idx) - 0.5));
  float glow = ring * (0.25 + band*2.2 + sv_bass*0.5);
  vec3 col = sv_col(fract(r*0.8 + a*0.08 + sv_time*0.03)) * glow;
  col += sv_col(0.5) * exp(-r*4.0) * sv_bass * 0.8;
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'sh_metal',
      name: 'Sıvı Metal',
      kind: 'background',
      description: 'Alan bükümlü gürültü; ağır, akışkan metalik yüzey.',
      controls: [
        { name: 'uDetail', label: 'Detay', type: 'slider', min: 1, max: 6, step: 1, default: 4 },
        { name: 'uFlow', label: 'Akış', type: 'slider', min: 0, max: 2, step: 0.02, default: 0.6 },
        { name: 'uShine', label: 'Parlaklık', type: 'slider', min: 0, max: 2, step: 0.02, default: 1 },
      ],
      shader: `float h(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p, int oct){ float s=0.0, a=0.5; for(int i=0;i<6;i++){ if(i>=oct) break; s+=a*n(p); p*=2.03; a*=0.5; } return s; }
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*sv_resolution) / min(sv_resolution.x, sv_resolution.y);
  float t = sv_time*uFlow;
  int oct = int(uDetail);
  vec2 q = vec2(fbm(uv*2.0 + t*0.2, oct), fbm(uv*2.0 - t*0.15 + 5.2, oct));
  vec2 r = vec2(fbm(uv*2.0 + q*2.0 + t*0.3, oct), fbm(uv*2.0 + q*2.0 - t*0.2 + 1.7, oct));
  float v = fbm(uv*2.0 + r*(1.5 + sv_bass*1.5), oct);
  vec3 col = sv_col(fract(v*1.4 + sv_time*0.02));
  float spec = pow(clamp(r.x*1.4, 0.0, 1.0), 3.0) * uShine * (0.6 + sv_treble*2.0);
  col = col*(0.35 + v*0.9) + spec*0.5;
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'sh_warpstars',
      name: 'Yıldız Geçidi',
      kind: 'background',
      description: 'Hiper uzay: bas vurdukça hızlanan yıldız akışı.',
      controls: [
        { name: 'uDensity', label: 'Yoğunluk', type: 'slider', min: 0.2, max: 3, step: 0.05, default: 1 },
        { name: 'uSpeed', label: 'Hız', type: 'slider', min: 0, max: 4, step: 0.05, default: 1 },
        { name: 'uStretch', label: 'Uzama', type: 'slider', min: 0, max: 2, step: 0.02, default: 0.8 },
      ],
      shader: `float h21(vec2 p){ p = fract(p*vec2(233.34,851.73)); p += dot(p, p+23.45); return fract(p.x*p.y); }
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*sv_resolution) / min(sv_resolution.x, sv_resolution.y);
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float t = sv_time * uSpeed * (1.0 + sv_bass*2.2);
  vec3 col = vec3(0.0);
  for(int i=0;i<3;i++){
    float fi = float(i);
    float lane = floor((a/6.2831853 + 0.5) * (60.0*uDensity) + fi*13.0);
    float seed = h21(vec2(lane, fi));
    float z = fract(seed + t*(0.25 + seed*0.5));
    float rr = pow(z, 1.0 + uStretch);
    float d = abs(r - rr);
    float laneA = (lane/(60.0*uDensity) - 0.5)*6.2831853;
    float da = abs(mod(a - laneA + 3.14159, 6.2831853) - 3.14159);
    float star = smoothstep(0.03*(1.0+uStretch), 0.0, d) * smoothstep(0.06, 0.0, da*r);
    col += sv_col(fract(seed + fi*0.3)) * star * (0.5 + z) * (0.6 + sv_level*1.4);
  }
  col += sv_col(0.2) * exp(-r*6.0) * (0.15 + sv_bass*0.7);
  fragColor = vec4(col, 1.0);
}`,
    },
    {
      id: 'sh_curtain',
      name: 'Dalga Perdesi',
      kind: 'visualizer',
      description: 'Dalga formundan üretilen ışık perdesi — saydam üst katman.',
      controls: [
        { name: 'uLayers', label: 'Katman', type: 'slider', min: 1, max: 8, step: 1, default: 4 },
        { name: 'uAmp', label: 'Genlik', type: 'slider', min: 0, max: 2, step: 0.02, default: 0.7 },
        { name: 'uThick', label: 'Kalınlık', type: 'slider', min: 0.002, max: 0.08, step: 0.002, default: 0.012 },
      ],
      shader: `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = fragCoord / sv_resolution;
  vec2 p = (uv - 0.5) * vec2(sv_resolution.x/sv_resolution.y, 1.0);
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  int L = int(uLayers);
  for(int i=0;i<8;i++){
    if(i>=L) break;
    float fi = float(i)/float(max(L-1,1));
    float w = sv_waveAt(fract(uv.x + fi*0.13 + sv_time*0.05));
    float y = w * uAmp * (0.35 + fi*0.5) + (fi-0.5)*0.12;
    float d = abs(p.y - y);
    float line = smoothstep(uThick*(1.0+fi), 0.0, d);
    col += sv_col(fract(fi + sv_time*0.04)) * line * (0.6 + sv_level*1.6);
    alpha = max(alpha, line);
  }
  fragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`,
    },
    {
      id: 'sh_orbcore',
      name: 'Bas Küresi',
      kind: 'visualizer',
      description: 'Ortada nabız atan enerji küresi — saydam üst katman.',
      controls: [
        { name: 'uSize', label: 'Boyut', type: 'slider', min: 0.05, max: 0.6, step: 0.01, default: 0.22 },
        { name: 'uSpikes', label: 'Diken', type: 'slider', min: 0, max: 40, step: 1, default: 14 },
        { name: 'uHalo', label: 'Hale', type: 'slider', min: 0, max: 2, step: 0.02, default: 0.8 },
      ],
      shader: `void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*sv_resolution) / min(sv_resolution.x, sv_resolution.y);
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float band = sv_spec(clamp(abs(a)/3.14159, 0.0, 1.0));
  float radius = uSize * (1.0 + sv_bass*0.55) + band*0.09;
  radius += sin(a*uSpikes + sv_time*2.0)*0.012*(0.3 + sv_treble*2.0);
  float core = smoothstep(radius, radius*0.72, r);
  float halo = exp(-max(0.0, r-radius)*11.0/max(0.2,uHalo)) * (0.35 + sv_level*1.1);
  vec3 col = sv_col(fract(0.15 + r*1.2 + sv_time*0.05)) * (core*1.2 + halo);
  fragColor = vec4(col, clamp(core + halo*0.85, 0.0, 1.0));
}`,
    },
  ];

  // --------------------------------------------------------------------------
  // Kayıt: yerleşikler + kullanıcının kendi presetleri
  // --------------------------------------------------------------------------
  let userPresets = [];

  function normalize(p) {
    const out = Object.assign(
      {
        format: FORMAT,
        version: VERSION,
        id: null,
        kind: 'visualizer', // 'visualizer' | 'background'
        engine: 'shader', // 'shader' | 'variation'
        name: 'Preset',
        author: '',
        description: '',
        tags: [],
        base: 'bars', // engine === 'variation' için temel mod
        overrides: {}, // engine === 'variation' için cfg parçaları
        shader: '',
        controls: [],
        builtin: false,
        createdAt: 0,
        updatedAt: 0,
      },
      p || {}
    );
    if (!Array.isArray(out.controls)) out.controls = [];
    out.controls = out.controls.filter((c) => c && typeof c.name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(c.name));
    if (!out.id) out.id = newId();
    return out;
  }

  function newId() {
    return 'usr_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 0xffff).toString(36);
  }

  function builtins() {
    return BUILTIN_SHADERS.map((p) => normalize(Object.assign({ builtin: true, engine: 'shader', author: 'CAYADEV' }, p)));
  }

  const BUILTIN_LIST = builtins();

  function setUser(list) {
    userPresets = (Array.isArray(list) ? list : []).map(normalize);
  }
  function all() {
    return BUILTIN_LIST.concat(userPresets);
  }
  function get(id) {
    if (!id) return null;
    return all().find((p) => p.id === id) || null;
  }
  function byKind(kind) {
    return all().filter((p) => p.kind === kind);
  }

  // Presetin varsayılan parametre değerleri + kullanıcının değiştirdikleri
  function paramValues(preset, cfg) {
    const out = {};
    if (!preset) return out;
    for (const c of preset.controls) out[c.name] = c.default;
    const saved = cfg && cfg.custom && cfg.custom.params && cfg.custom.params[preset.id];
    if (saved) for (const k in saved) if (k in out) out[k] = saved[k];
    return out;
  }

  // --------------------------------------------------------------------------
  // Shadertoy içe aktarma
  //
  // Shadertoy shader'ı zaten mainImage(out vec4, in vec2) yazar; motorumuz da
  // aynı giriş noktasını kullanır. Yapılacak tek şey ES 1.00 kalıntılarını
  // temizlemek ve Shadertoy'a özgü ama bizde bulunmayan uniform'ları uyarmak.
  // --------------------------------------------------------------------------
  function fromShadertoy(src, name) {
    let code = String(src || '');
    const notes = [];
    if (!/void\s+mainImage\s*\(/.test(code)) {
      return { ok: false, error: 'Kodda mainImage(out vec4 fragColor, in vec2 fragCoord) bulunamadı.' };
    }
    if (/iChannel[0-3]/.test(code)) {
      notes.push('iChannel0 = spektrum, iChannel1 = dalga formu, iChannel2 = önceki kare, iChannel3 = medya katmanı olarak bağlandı.');
    }
    if (/iChannelResolution/.test(code)) {
      code = 'const vec3 iChannelResolution[4] = vec3[4](vec3(512.0,1.0,1.0),vec3(512.0,1.0,1.0),vec3(1.0),vec3(1.0));\n' + code;
    }
    if (/\biDate\b/.test(code)) code = 'const vec4 iDate = vec4(2026.0, 1.0, 1.0, 0.0);\n' + code;
    if (/\biSampleRate\b/.test(code)) code = 'const float iSampleRate = 48000.0;\n' + code;
    if (/\biFrameRate\b/.test(code)) code = 'const float iFrameRate = 60.0;\n' + code;
    return {
      ok: true,
      notes,
      preset: normalize({
        name: name || 'Shadertoy Shader',
        kind: 'background',
        engine: 'shader',
        description: 'Shadertoy kodundan içe aktarıldı.',
        shader: code,
        controls: [],
      }),
    };
  }

  // --------------------------------------------------------------------------
  // ISF (Interactive Shader Format) içe aktarma
  //
  // ISF, GLSL dosyasının başına /*{ ... }*/ biçiminde bir JSON blok koyar:
  // INPUTS dizisi kullanıcı kontrollerini tanımlar. Gövde ise main() yazar ve
  // gl_FragColor'a atar. Burada JSON'u kontrollerimize çeviriyor, gövdeyi de
  // mainImage sözleşmemize sarıyoruz.
  // --------------------------------------------------------------------------
  function fromISF(src, name) {
    const text = String(src || '');
    const m = text.match(/\/\*\s*(\{[\s\S]*?\})\s*\*\//);
    let meta = {};
    let body = text;
    if (m) {
      try { meta = JSON.parse(m[1]); } catch (e) {
        return { ok: false, error: 'ISF başlığındaki JSON çözümlenemedi: ' + e.message };
      }
      body = text.slice(m.index + m[0].length);
    }
    if (!/\bvoid\s+main\s*\(/.test(body)) {
      return { ok: false, error: 'ISF gövdesinde void main() bulunamadı.' };
    }

    const controls = [];
    const notes = [];
    // ISF başlığı kullanıcı dosyasından geliyor; alanların türü garanti değil
    const arr = (v) => (Array.isArray(v) ? v : []);
    for (const inp of arr(meta.INPUTS)) {
      if (!inp || !inp.NAME || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(inp.NAME)) continue;
      const label = inp.LABEL || inp.NAME;
      if (inp.TYPE === 'float' || inp.TYPE === 'long') {
        controls.push({
          name: inp.NAME, label, type: 'slider',
          min: inp.MIN == null ? 0 : +inp.MIN,
          max: inp.MAX == null ? 1 : +inp.MAX,
          step: inp.TYPE === 'long' ? 1 : 0.01,
          default: inp.DEFAULT == null ? (inp.MIN == null ? 0 : +inp.MIN) : +inp.DEFAULT,
        });
      } else if (inp.TYPE === 'bool') {
        controls.push({ name: inp.NAME, label, type: 'toggle', default: !!inp.DEFAULT });
      } else if (inp.TYPE === 'color') {
        const d = Array.isArray(inp.DEFAULT) ? inp.DEFAULT : [1, 1, 1];
        controls.push({ name: inp.NAME, label, type: 'color', default: rgbToHex(d) });
      } else if (inp.TYPE === 'image') {
        notes.push(`"${inp.NAME}" görsel girişi medya katmanına bağlandı.`);
      } else if (inp.TYPE === 'point2D') {
        const d = Array.isArray(inp.DEFAULT) ? inp.DEFAULT : [0.5, 0.5];
        controls.push({ name: inp.NAME + '_x', label: label + ' X', type: 'slider', min: 0, max: 1, step: 0.01, default: +d[0] });
        controls.push({ name: inp.NAME + '_y', label: label + ' Y', type: 'slider', min: 0, max: 1, step: 0.01, default: +d[1] });
      }
    }
    if (arr(meta.PASSES).length > 1) {
      notes.push('Çok geçişli (PASSES) ISF shader\'ı tek geçişe indirgendi; sonuç farklı görünebilir.');
    }

    // main() -> isf_main(); gl_FragColor bizim çıkışımıza yönlendirilir
    const renamed = body.replace(/\bvoid\s+main\s*\(\s*(void)?\s*\)/, 'void isf_main()');
    const point2Ds = arr(meta.INPUTS)
      .filter((i) => i && i.TYPE === 'point2D' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(i.NAME))
      .map((i) => `vec2 ${i.NAME} = vec2(${i.NAME}_x, ${i.NAME}_y);`)
      .join('\n');

    const wrapped = `// --- ISF uyumluluk katmanı (CAYADEV Studio) ---
vec4 sv_isfOut = vec4(0.0);
#define gl_FragColor sv_isfOut
#define RENDERSIZE sv_resolution
#define TIME sv_time
#define TIMEDELTA iTimeDelta
#define FRAMEINDEX iFrame
#define PASSINDEX 0
#define isf_FragNormCoord (gl_FragCoord.xy / sv_resolution)
#define IMG_NORM_PIXEL(img, uv) texture(img, uv)
#define IMG_PIXEL(img, p) texture(img, (p) / sv_resolution)
#define IMG_THIS_PIXEL(img) texture(img, gl_FragCoord.xy / sv_resolution)
#define IMG_THIS_NORM_PIXEL(img) texture(img, gl_FragCoord.xy / sv_resolution)
#define IMG_SIZE(img) sv_resolution
${point2Ds}
${renamed}
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  isf_main();
  fragColor = sv_isfOut;
}`;

    return {
      ok: true,
      notes,
      preset: normalize({
        name: name || meta.DESCRIPTION || 'ISF Shader',
        kind: 'background',
        engine: 'shader',
        author: meta.CREDIT || '',
        description: meta.DESCRIPTION || 'ISF dosyasından içe aktarıldı.',
        tags: Array.isArray(meta.CATEGORIES) ? meta.CATEGORIES : [],
        shader: wrapped,
        controls,
      }),
    };
  }

  function rgbToHex(a) {
    const c = (x) => Math.max(0, Math.min(255, Math.round((+x || 0) * 255))).toString(16).padStart(2, '0');
    return '#' + c(a[0]) + c(a[1]) + c(a[2]);
  }

  // --------------------------------------------------------------------------
  // MilkDrop (.milk) parametre içe aktarma
  //
  // MilkDrop'un tam motoru (per-frame/per-vertex denklem yorumlayıcısı, warp ve
  // comp shader'ları) ayrı bir proje büyüklüğünde. Burada yapılan, .milk
  // dosyasının SABİT parametrelerini okuyup kendi geri besleme motorumuzun
  // ayarlarına çevirmek: aynı görsel aileyi (zoom/rot/warp/decay/dalga) üretir,
  // birebir aynı sahneyi değil. Dosya seçildiğinde kullanıcıya bu söylenir.
  // --------------------------------------------------------------------------
  function fromMilk(src, name) {
    const text = String(src || '');
    const num = (key, fallback) => {
      const m = text.match(new RegExp('^\\s*' + key + '\\s*=\\s*([-0-9.eE]+)', 'im'));
      return m ? parseFloat(m[1]) : fallback;
    };
    const waveModeNum = num('nWaveMode', 0);
    const waveMode = ['line', 'dual', 'circle', 'spectrum'][Math.abs(waveModeNum | 0) % 4];
    const fb = {
      zoom: clampN(num('fZoom', 1.0), 0.9, 1.12),
      rotate: clampN(num('fRot', 0), -0.5, 0.5),
      warp: clampN(num('fWarpAmount', 1) * 0.55, 0, 2),
      decay: clampN(num('fDecay', 0.96), 0.7, 0.999),
      dx: clampN(num('fXPush', 0) * 0.01, -0.05, 0.05),
      dy: clampN(num('fYPush', 0) * 0.01, -0.05, 0.05),
      swirl: clampN(num('fWarpScale', 1) * 0.3, 0, 2),
      waveMode,
      waveAmp: clampN(num('fWaveScale', 1), 0, 3),
      waveThickness: clampN(num('fWaveAlpha', 1), 0, 3),
      sharpen: clampN(num('fVideoEchoAlpha', 0.25), 0, 1),
    };
    const title = (text.match(/^\s*\[preset\d+\]/im) ? null : null) || name || 'MilkDrop Preset';
    return {
      ok: true,
      notes: ['MilkDrop dosyasının sabit parametreleri geri besleme motoruna çevrildi; per-frame denklemleri desteklenmiyor.'],
      preset: normalize({
        name: title,
        kind: 'visualizer',
        engine: 'variation',
        base: 'feedback',
        description: '.milk dosyasından içe aktarılan geri besleme ayarları.',
        overrides: { feedback: fb },
        controls: [],
      }),
    };
  }

  function clampN(v, a, b) {
    if (!isFinite(v)) return a;
    return Math.max(a, Math.min(b, v));
  }

  // --------------------------------------------------------------------------
  // Paket (birden çok preset tek dosyada)
  // --------------------------------------------------------------------------
  function makePack(list, meta) {
    return {
      format: PACK_FORMAT,
      version: VERSION,
      name: (meta && meta.name) || 'CAYADEV Preset Paketi',
      author: (meta && meta.author) || '',
      createdAt: Date.now(),
      app: 'CAYADEV Visualizer',
      presets: (list || []).map((p) => {
        const c = normalize(p);
        delete c.builtin;
        return c;
      }),
    };
  }

  // Dosyadan gelen veriyi preset listesine çevirir (tek preset veya paket)
  function readImported(data) {
    if (!data || typeof data !== 'object') return { ok: false, error: 'Dosya okunamadı.' };
    if (data.format === PACK_FORMAT && Array.isArray(data.presets)) {
      return { ok: true, presets: data.presets.map((p) => normalize(Object.assign({}, p, { id: newId(), builtin: false }))) };
    }
    if (data.format === FORMAT) {
      return { ok: true, presets: [normalize(Object.assign({}, data, { id: newId(), builtin: false }))] };
    }
    return { ok: false, error: 'Tanınmayan dosya biçimi (svpreset veya svpack bekleniyordu).' };
  }

  window.SVPresets = {
    FORMAT,
    PACK_FORMAT,
    VERSION,
    BUILTIN: BUILTIN_LIST,
    normalize,
    newId,
    setUser,
    all,
    get,
    byKind,
    paramValues,
    fromShadertoy,
    fromISF,
    fromMilk,
    makePack,
    readImported,
    user: () => userPresets.slice(),
  };
})();
