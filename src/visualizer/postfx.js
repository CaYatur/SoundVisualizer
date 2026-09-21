'use strict';
/* Son-işlem (post-processing) efekt zinciri — WebGL2.

   Katman yığınının BİRLEŞTİRİLMİŞ çıktısına sırayla uygulanan efektler.
   Her efekt kendi geçişidir; sıralama kullanıcıya aittir (bloom'dan önce mi
   sonra mı renk düzeltmesi yapılacağı görüntüyü değiştirir).

   Neden ayrı geçişler: tek dev shader'da hepsini toggle'lamak GPU'da her
   zaman en pahalı yolu ödetir. Kapalı efekt hiç derlenmez, hiç çalışmaz.

   Not — parlama (glow) iki yerde var ve bu kasıtlı:
     • Modların kendi içindeki glow, ŞEKLİN kendi görünümünün parçasıdır
       (bar kenarındaki hale). Yerinde kalır.
     • Buradaki Bloom, KOMPOZİSYONUN tamamına uygulanan ayrı bir efekttir ve
       varsayılan olarak kapalıdır. İkisi toplanır; ikisini birden açmak
       görüntüyü bilerek daha da parlatır. */
(function () {
  const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main(){ vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const HEAD = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uTex;
uniform sampler2D uPrev;
uniform vec2 uRes;
uniform float uTime;
uniform float uLevel, uBass, uMid, uTreble, uBeat;
`;

  /* Efekt tanımları.
     params: kullanıcıya gösterilen ayarlar (panelde otomatik kaydırıcı olur)
     audio : hangi parametrelerin sese bağlanabileceği
     frag  : HEAD'den sonra gelen gövde (main() yazar) */
  const EFFECTS = {
    bloom: {
      label: 'Bloom (Kompozisyon Parlaması)',
      spreads: true,
      params: [
        { name: 'threshold', label: 'Eşik', min: 0, max: 1, step: 0.01, default: 0.55 },
        { name: 'intensity', label: 'Şiddet', min: 0, max: 3, step: 0.02, default: 0.9 },
        { name: 'radius', label: 'Yarıçap', min: 0.5, max: 6, step: 0.1, default: 2.2 },
      ],
      frag: `uniform float threshold, intensity, radius;
void main(){
  vec3 base = texture(uTex, vUV).rgb;
  vec2 px = radius / uRes;
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  // 13 örnekli ayrık çekirdek: tek geçişte kabul edilebilir bir hale verir
  for (int i = -6; i <= 6; i++) {
    float fi = float(i);
    float w = exp(-fi * fi / 18.0);
    vec3 a = texture(uTex, vUV + vec2(px.x * fi, 0.0)).rgb;
    vec3 b = texture(uTex, vUV + vec2(0.0, px.y * fi)).rgb;
    vec3 m = max(a, b);
    sum += max(m - threshold, 0.0) * w;
    wsum += w;
  }
  outColor = vec4(base + sum / wsum * intensity, 1.0);
}`,
    },

    chroma: {
      label: 'Renk Sapması (Kromatik)',
      displaces: true,
      params: [
        { name: 'amount', label: 'Miktar', min: 0, max: 0.05, step: 0.0005, default: 0.004 },
        { name: 'falloff', label: 'Merkezden Uzaklık', min: 0, max: 4, step: 0.05, default: 1.6 },
      ],
      audio: ['amount'],
      frag: `uniform float amount, falloff;
void main(){
  vec2 c = vUV - 0.5;
  float d = pow(length(c) * 2.0, falloff);
  vec2 off = c * amount * d;
  outColor = vec4(
    texture(uTex, vUV + off).r,
    texture(uTex, vUV).g,
    texture(uTex, vUV - off).b,
    1.0);
}`,
    },

    glitch: {
      label: 'Glitch (Dilim Kayması)',
      displaces: true,
      params: [
        { name: 'amount', label: 'Miktar', min: 0, max: 1, step: 0.01, default: 0.35 },
        { name: 'slices', label: 'Dilim Sayısı', min: 2, max: 60, step: 1, default: 18 },
        { name: 'speed', label: 'Hız', min: 0, max: 20, step: 0.1, default: 6 },
      ],
      audio: ['amount'],
      frag: `uniform float amount, slices, speed;
float h11(float x){ return fract(sin(x * 127.1) * 43758.5453); }
void main(){
  float row = floor(vUV.y * slices);
  float seed = h11(row + floor(uTime * speed));
  // Dilimlerin yalnızca bir kısmı kayar; hepsi kaysa görüntü okunmaz olur.
  // ('active' GLSL ES 3.00'de ayrılmış kelime — kullanılamaz.)
  float onSlice = step(0.72, seed);
  float shift = (h11(seed * 31.7) - 0.5) * amount * onSlice;
  vec2 uv = vec2(fract(vUV.x + shift), vUV.y);
  vec3 col = texture(uTex, uv).rgb;
  // kayan dilimlerde hafif renk ayrışması
  col.r = texture(uTex, uv + vec2(shift * 0.25, 0.0)).r;
  outColor = vec4(col, 1.0);
}`,
    },

    grain: {
      label: 'Film Greni',
      params: [
        { name: 'amount', label: 'Miktar', min: 0, max: 0.5, step: 0.005, default: 0.06 },
        { name: 'size', label: 'Tanecik Boyutu', min: 0.5, max: 6, step: 0.1, default: 1 },
      ],
      frag: `uniform float amount, size;
float h21(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p + 19.19); return fract(p.x * p.y); }
void main(){
  vec3 col = texture(uTex, vUV).rgb;
  float n = h21(floor(vUV * uRes / max(0.5, size)) + fract(uTime) * 71.3);
  outColor = vec4(col + (n - 0.5) * amount, 1.0);
}`,
    },

    crt: {
      label: 'CRT / Tarama Çizgileri',
      displaces: true,
      params: [
        { name: 'scan', label: 'Çizgi Şiddeti', min: 0, max: 1, step: 0.02, default: 0.35 },
        { name: 'curve', label: 'Ekran Eğriliği', min: 0, max: 0.6, step: 0.01, default: 0.12 },
        { name: 'lines', label: 'Çizgi Sıklığı', min: 100, max: 2000, step: 10, default: 700 },
      ],
      frag: `uniform float scan, curve, lines;
void main(){
  vec2 uv = vUV * 2.0 - 1.0;
  uv *= 1.0 + curve * dot(uv, uv) * 0.35;
  uv = uv * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec3 col = texture(uTex, uv).rgb;
  float s = 0.5 + 0.5 * sin(uv.y * lines);
  col *= 1.0 - scan * s;
  // köşe karartması ekran camı hissini tamamlar
  float v = 1.0 - curve * 1.6 * dot(uv - 0.5, uv - 0.5) * 4.0;
  outColor = vec4(col * clamp(v, 0.0, 1.0), 1.0);
}`,
    },

    pixelate: {
      label: 'Pikselleştir',
      displaces: true,
      params: [
        { name: 'size', label: 'Piksel Boyutu', min: 1, max: 80, step: 1, default: 8 },
      ],
      audio: ['size'],
      frag: `uniform float size;
void main(){
  vec2 s = max(vec2(1.0), vec2(size)) / uRes;
  vec2 uv = (floor(vUV / s) + 0.5) * s;
  outColor = vec4(texture(uTex, uv).rgb, 1.0);
}`,
    },

    kaleido: {
      label: 'Kaleydoskop',
      displaces: true,
      params: [
        { name: 'slices', label: 'Dilim', min: 2, max: 24, step: 1, default: 6 },
        { name: 'spin', label: 'Dönüş', min: -2, max: 2, step: 0.01, default: 0.1 },
        { name: 'zoom', label: 'Yakınlaşma', min: 0.2, max: 3, step: 0.02, default: 1 },
      ],
      audio: ['spin', 'zoom'],
      frag: `uniform float slices, spin, zoom;
void main(){
  vec2 c = (vUV - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float a = atan(c.y, c.x) + uTime * spin;
  float r = length(c) / max(0.05, zoom);
  float wedge = 6.28318530718 / max(2.0, slices);
  a = mod(a, wedge);
  a = min(a, wedge - a); // dilimi aynala
  vec2 uv = vec2(cos(a), sin(a)) * r;
  uv = uv / vec2(uRes.x / uRes.y, 1.0) + 0.5;
  outColor = vec4(texture(uTex, clamp(uv, 0.0, 1.0)).rgb, 1.0);
}`,
    },

    mirror: {
      label: 'Ayna',
      displaces: true,
      params: [
        { name: 'mode', label: 'Biçim (0 yatay · 1 dikey · 2 dörtlü)', min: 0, max: 2, step: 1, default: 0 },
      ],
      frag: `uniform float mode;
void main(){
  vec2 uv = vUV;
  int m = int(mode + 0.5);
  if (m == 0) uv.x = uv.x < 0.5 ? uv.x : 1.0 - uv.x;
  else if (m == 1) uv.y = uv.y < 0.5 ? uv.y : 1.0 - uv.y;
  else { uv.x = uv.x < 0.5 ? uv.x : 1.0 - uv.x; uv.y = uv.y < 0.5 ? uv.y : 1.0 - uv.y; }
  outColor = vec4(texture(uTex, uv).rgb, 1.0);
}`,
    },

    grade: {
      label: 'Renk Düzeltme',
      params: [
        { name: 'exposure', label: 'Pozlama', min: -1, max: 2, step: 0.02, default: 0 },
        { name: 'contrast', label: 'Kontrast', min: 0, max: 3, step: 0.02, default: 1 },
        { name: 'saturation', label: 'Doygunluk', min: 0, max: 3, step: 0.02, default: 1 },
        { name: 'hue', label: 'Renk Kayması', min: -1, max: 1, step: 0.01, default: 0 },
        { name: 'temperature', label: 'Sıcaklık', min: -1, max: 1, step: 0.02, default: 0 },
      ],
      audio: ['hue', 'exposure', 'saturation'],
      frag: `uniform float exposure, contrast, saturation, hue, temperature;
vec3 hueRot(vec3 c, float a){
  const vec3 k = vec3(0.57735026);
  float cs = cos(a);
  return c * cs + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cs);
}
void main(){
  vec3 col = texture(uTex, vUV).rgb;
  col *= pow(2.0, exposure);
  col = (col - 0.5) * contrast + 0.5;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, saturation);
  col = hueRot(col, hue * 3.14159265);
  col += vec3(temperature, temperature * 0.06, -temperature) * 0.12;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`,
    },

    vignette: {
      label: 'Vinyet',
      params: [
        { name: 'amount', label: 'Miktar', min: 0, max: 1, step: 0.02, default: 0.4 },
        { name: 'softness', label: 'Yumuşaklık', min: 0.1, max: 2, step: 0.02, default: 0.8 },
      ],
      audio: ['amount'],
      frag: `uniform float amount, softness;
void main(){
  vec3 col = texture(uTex, vUV).rgb;
  float d = length(vUV - 0.5) * 1.4142;
  float v = 1.0 - amount * pow(clamp(d / max(0.05, softness), 0.0, 1.0), 2.0);
  outColor = vec4(col * v, 1.0);
}`,
    },

    trails: {
      label: 'İz / Yankı',
      needsPrev: true,
      params: [
        { name: 'decay', label: 'Sönme', min: 0.5, max: 0.99, step: 0.005, default: 0.86 },
        { name: 'zoom', label: 'Yakınlaşma', min: 0.95, max: 1.05, step: 0.001, default: 1.004 },
        { name: 'rotate', label: 'Dönüş', min: -0.05, max: 0.05, step: 0.001, default: 0 },
      ],
      audio: ['zoom'],
      frag: `uniform float decay, zoom, rotate;
void main(){
  vec2 c = vUV - 0.5;
  float s = sin(rotate), co = cos(rotate);
  vec2 p = mat2(co, -s, s, co) * c / max(0.5, zoom) + 0.5;
  vec3 prev = texture(uPrev, p).rgb * decay;
  vec3 cur = texture(uTex, vUV).rgb;
  outColor = vec4(max(cur, prev), 1.0);
}`,
    },

    edge: {
      label: 'Kenar Vurgusu',
      params: [
        { name: 'amount', label: 'Miktar', min: 0, max: 2, step: 0.02, default: 1 },
        { name: 'mix', label: 'Karışım', min: 0, max: 1, step: 0.02, default: 0.6 },
      ],
      frag: `uniform float amount, mix_;
void main(){
  vec2 px = 1.0 / uRes;
  float gx = 0.0, gy = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec3 s = texture(uTex, vUV + vec2(float(x), float(y)) * px).rgb;
      float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
      float kx = float(x) * (y == 0 ? 2.0 : 1.0);
      float ky = float(y) * (x == 0 ? 2.0 : 1.0);
      gx += l * kx;
      gy += l * ky;
    }
  }
  float e = clamp(sqrt(gx * gx + gy * gy) * amount, 0.0, 1.0);
  vec3 col = texture(uTex, vUV).rgb;
  outColor = vec4(mix(col, vec3(e) * col + vec3(e) * 0.4, mix_), 1.0);
}`,
      uniformAlias: { mix: 'mix_' }, // 'mix' GLSL'de yerleşik ad
    },

    zoomblur: {
      label: 'Merkezden Bulanıklık',
      spreads: true,
      params: [
        { name: 'amount', label: 'Miktar', min: 0, max: 0.3, step: 0.002, default: 0.06 },
        { name: 'samples', label: 'Örnek', min: 4, max: 24, step: 1, default: 12 },
      ],
      audio: ['amount'],
      frag: `uniform float amount, samples;
void main(){
  vec2 dir = (vUV - 0.5) * amount;
  vec3 sum = vec3(0.0);
  int n = int(samples);
  for (int i = 0; i < 24; i++) {
    if (i >= n) break;
    float f = float(i) / float(n);
    sum += texture(uTex, vUV - dir * f).rgb;
  }
  outColor = vec4(sum / float(n), 1.0);
}`,
    },

    ripple: {
      label: 'Dalga Bozulması',
      displaces: true,
      params: [
        { name: 'amount', label: 'Miktar', min: 0, max: 0.1, step: 0.001, default: 0.012 },
        { name: 'frequency', label: 'Sıklık', min: 1, max: 60, step: 0.5, default: 14 },
        { name: 'speed', label: 'Hız', min: 0, max: 6, step: 0.05, default: 1.5 },
      ],
      audio: ['amount'],
      frag: `uniform float amount, frequency, speed;
void main(){
  vec2 c = vUV - 0.5;
  float r = length(c);
  float w = sin(r * frequency - uTime * speed) * amount;
  vec2 uv = vUV + normalize(c + 1e-6) * w;
  outColor = vec4(texture(uTex, clamp(uv, 0.0, 1.0)).rgb, 1.0);
}`,
    },

    posterize: {
      label: 'Posterize / Ters Çevir',
      params: [
        { name: 'levels', label: 'Kademe', min: 2, max: 32, step: 1, default: 6 },
        { name: 'invert', label: 'Ters Çevir', min: 0, max: 1, step: 1, default: 0 },
      ],
      frag: `uniform float levels, invert;
void main(){
  vec3 col = texture(uTex, vUV).rgb;
  float n = max(2.0, levels);
  col = floor(col * n) / n;
  if (invert > 0.5) col = 1.0 - col;
  outColor = vec4(col, 1.0);
}`,
    },
  };

  /* Zincire dışarıdan efekt ekleme.

     Efekt sayısı iki haneyi geçince hepsini tek dosyada tutmak okunmaz hale
     geldi. postfx-extra.js aynı biçimle yeni efektler kaydeder; zincir,
     panel ve öz test ikisi arasında ayrım yapmaz. */
  function register(defs) {
    for (const k in defs) {
      if (EFFECTS[k]) throw new Error('efekt kimliği zaten var: ' + k);
      EFFECTS[k] = defs[k];
      EFFECT_IDS.push(k);
    }
  }

  const EFFECT_IDS = Object.keys(EFFECTS);

  function defaultChainEntry(type) {
    const def = EFFECTS[type];
    if (!def) return null;
    const params = {};
    for (const p of def.params) params[p.name] = p.default;
    return {
      id: 'fx_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 0xffff).toString(36),
      type,
      enabled: true,
      params,
      audio: {}, // { paramAdı: miktar }
      audioBand: 'bass',
    };
  }

  function bandValue(audio, band) {
    if (!audio) return 0;
    if (band === 'mid') return audio.mid;
    if (band === 'treble') return audio.treble;
    if (band === 'level') return audio.level;
    return audio.bass;
  }

  /* Saydam modda parlama örtüsü yalnız YAYILAN efektlerde (bloom, blur…).
     Kaydıran efekt (glitch, kroma) boş piksele renk yazınca onu örtü
     saymak hayalet kopya üretiyordu. */
  function chainSpreads(chain) {
    let spread = false;
    let displace = false;
    for (let i = 0; i < chain.length; i++) {
      const def = EFFECTS[chain[i].type];
      if (!def) continue;
      if (def.spreads) spread = true;
      if (def.displaces) displace = true;
    }
    return spread && !displace;
  }

  // ==========================================================================
  class PostFX {
    constructor() {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 2;
      this.canvas.height = 2;
      this.gl = null;
      this.programs = {}; // type -> { prog, loc }
      this.width = 2;
      this.height = 2;
      this.fbo = [null, null];
      this.tex = [null, null];
      this.prevFbo = null;
      this.prevTex = null;
      this.srcTex = null;
      this.chain = [];
      this.error = null;
      this._beat = 0;
      this._beatAvg = 0;
      this._init();
    }

    _init() {
      const gl = this.canvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      });
      if (!gl) { this.error = 'WebGL2 kullanılamıyor'; return; }
      this.gl = gl;
      const quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      this._quad = quad;

      this.srcTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    _compile(type) {
      if (this.programs[type]) return this.programs[type];
      const gl = this.gl;
      const def = EFFECTS[type];
      if (!gl || !def) return null;
      const fs = HEAD + def.frag;

      const mk = (kind, src) => {
        const s = gl.createShader(kind);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.warn('[postfx] ' + type + ': ' + gl.getShaderInfoLog(s));
          gl.deleteShader(s);
          return null;
        }
        return s;
      };
      const v = mk(gl.VERTEX_SHADER, VERT);
      const f = v ? mk(gl.FRAGMENT_SHADER, fs) : null;
      if (!v || !f) { if (v) gl.deleteShader(v); return null; }
      const p = gl.createProgram();
      gl.attachShader(p, v);
      gl.attachShader(p, f);
      gl.bindAttribLocation(p, 0, 'aPos');
      gl.linkProgram(p);
      gl.deleteShader(v);
      gl.deleteShader(f);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { gl.deleteProgram(p); return null; }
      const entry = { prog: p, loc: {} };
      this.programs[type] = entry;
      return entry;
    }

    _u(entry, name) {
      if (!(name in entry.loc)) entry.loc[name] = this.gl.getUniformLocation(entry.prog, name);
      return entry.loc[name];
    }

    resize(w, h) {
      const W = Math.max(2, w | 0);
      const H = Math.max(2, h | 0);
      if (W === this.width && H === this.height && this.fbo[0]) return;
      this.width = W;
      this.height = H;
      this.canvas.width = W;
      this.canvas.height = H;
      this._allocate();
    }

    _makeTarget(W, H) {
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return { fb, tex };
    }

    _allocate() {
      const gl = this.gl;
      if (!gl) return;
      this._release();
      for (let i = 0; i < 2; i++) {
        const t = this._makeTarget(this.width, this.height);
        this.fbo[i] = t.fb;
        this.tex[i] = t.tex;
      }
      const p = this._makeTarget(this.width, this.height);
      this.prevFbo = p.fb;
      this.prevTex = p.tex;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    _release() {
      const gl = this.gl;
      if (!gl) return;
      for (let i = 0; i < 2; i++) {
        if (this.fbo[i]) gl.deleteFramebuffer(this.fbo[i]);
        if (this.tex[i]) gl.deleteTexture(this.tex[i]);
        this.fbo[i] = null;
        this.tex[i] = null;
      }
      if (this.prevFbo) gl.deleteFramebuffer(this.prevFbo);
      if (this.prevTex) gl.deleteTexture(this.prevTex);
      this.prevFbo = null;
      this.prevTex = null;
    }

    setChain(list) {
      this.chain = (Array.isArray(list) ? list : []).filter((e) => e && EFFECTS[e.type] && e.enabled !== false);
    }

    hasWork() {
      return !!this.gl && this.chain.length > 0;
    }

    /* Kaynağı işleyip this.canvas'a yazar.
       source: birleştirilmiş sahnenin bulunduğu tuval
       seeThrough: saydam mod (şeffaf arkaplan ya da yayın katmanı).

       SAYDAM MODDA SAYDAMLIK ZİNCİRDEN SAĞ ÇIKMALI. Efektlerin hepsi alfayı
       1 yazıyor; zincirde tek bir efekt açıkken bile yüzey tümüyle opak
       oluyor, şeffaf pencere de OBS katmanı da siyah bir dikdörtgene
       dönüyordu. Her efekte ayrı alfa mantığı yazmak yerine:
         1. kaynak ÖN-ÇARPIMLI yükleniyor — saydam yerler siyah, efektler
            sahneyi siyah üstüne çizilmiş gibi işliyor (parlama siyaha
            doğru yayılıyor, doğrusu da bu);
         2. son efekt ekrana değil ara hedefe çiziliyor;
         3. örtü kaynak alfadan gelir; bloom gibi yayılan efektlerde boş
            alana eklenen parlama da örtüye katılır. Kaydıran efektlerin
            boş piksele yazdığı renk örtü SAYILMAZ — aksi halde asıl şekil
            ile kaymış kopya üst üste biner.
       Saydam olmayan modda hiçbir şey değişmiyor. */
    render(source, audio, t, dt, seeThrough) {
      const gl = this.gl;
      if (!gl || !this.chain.length) return false;
      if (!this.fbo[0]) this._allocate();
      const toScreen = !seeThrough;

      // vuruş enerjisi (efektlerin sese bağlanmasında kullanılır)
      const bass = audio ? audio.bass : 0;
      this._beatAvg = this._beatAvg * 0.94 + bass * 0.06;
      this._beat = Math.max(0, this._beat - (dt || 0.016) * 3.2);
      const over = bass - (this._beatAvg * 1.25 + 0.03);
      if (over > 0) this._beat = Math.min(1, Math.max(this._beat, over * 4 + 0.25));

      // kaynağı dokuya yükle (saydam modda ön-çarpımlı; yukarıya bkz.)
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !toScreen);
      const unpack = () => {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      };
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      } catch { unpack(); return false; }
      unpack();

      gl.bindBuffer(gl.ARRAY_BUFFER, this._quad);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.viewport(0, 0, this.width, this.height);
      gl.disable(gl.BLEND);

      let inputTex = this.srcTex;
      let write = 0;
      const n = this.chain.length;

      for (let i = 0; i < n; i++) {
        const fx = this.chain[i];
        const def = EFFECTS[fx.type];
        const entry = this._compile(fx.type);
        if (!entry) continue;
        const last = i === n - 1;

        gl.useProgram(entry.prog);
        gl.bindFramebuffer(gl.FRAMEBUFFER, last && toScreen ? null : this.fbo[write]);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inputTex);
        gl.uniform1i(this._u(entry, 'uTex'), 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.prevTex);
        gl.uniform1i(this._u(entry, 'uPrev'), 1);

        gl.uniform2f(this._u(entry, 'uRes'), this.width, this.height);
        gl.uniform1f(this._u(entry, 'uTime'), t);
        gl.uniform1f(this._u(entry, 'uLevel'), audio ? audio.level : 0);
        gl.uniform1f(this._u(entry, 'uBass'), bass);
        gl.uniform1f(this._u(entry, 'uMid'), audio ? audio.mid : 0);
        gl.uniform1f(this._u(entry, 'uTreble'), audio ? audio.treble : 0);
        gl.uniform1f(this._u(entry, 'uBeat'), this._beat);

        const band = bandValue(audio, fx.audioBand);
        for (const p of def.params) {
          const alias = (def.uniformAlias && def.uniformAlias[p.name]) || p.name;
          let v = fx.params && fx.params[p.name] != null ? fx.params[p.name] : p.default;
          const mod = fx.audio && fx.audio[p.name];
          if (mod) v = v + (p.max - p.min) * mod * band;
          gl.uniform1f(this._u(entry, alias), Math.max(p.min, Math.min(p.max, v)));
        }

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        if (!last || !toScreen) {
          inputTex = this.tex[write];
          write = 1 - write;
        }
      }

      if (!toScreen) this._resolveAlpha(inputTex, chainSpreads(this.chain));

      /* İz efekti bir sonraki karede önceki sonucu okur. Ekran tamponundan
         kopyalamak yerine son ara hedefi saklamak yeterli; zincirin sonunda
         doğrudan ekrana çizildiği için son kareyi ayrıca kopyalıyoruz. */
      if (this.chain.some((f) => EFFECTS[f.type] && EFFECTS[f.type].needsPrev)) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.prevFbo);
        gl.viewport(0, 0, this.width, this.height);
        const copy = this._compile('__copy') || this._makeCopy();
        if (copy) {
          gl.useProgram(copy.prog);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
          gl.uniform1i(this._u(copy, 'uTex'), 0);
          gl.uniform2f(this._u(copy, 'uRes'), this.width, this.height);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return true;
    }

    _makeCopy() {
      return this._makeProgram('__copy', 'void main(){ outColor = texture(uTex, vUV); }');
    }

    /* SAYDAM MOD, zincirin sonu. Örtü her zaman kaynak alfadan gelir.
       Bloom/bulanıklık gibi YAYILAN efektlerde boş alana eklenen parlama
       da örtüye katılır. Kaydıran efektlerde (glitch, kroma, ayna…)
       parlaklıktan örtü üretmek hayalet/çift kopya yapıyordu — onlar
       yalnız siluetin içinde renk değiştirir, boş pikseli doldurmaz.
       Tuval premultipliedAlpha: false; bileşimci rengi a ile çarpar. */
    _resolveAlpha(tex, spread) {
      const gl = this.gl;
      const e = this.programs.__resolve || this._makeProgram('__resolve',
        'uniform float uSpread;\n' +
        'void main(){\n' +
        '  vec4 src = texture(uPrev, vUV);\n' +
        '  vec3 c = texture(uTex, vUV).rgb;\n' +
        '  vec3 added = max(c - src.rgb, 0.0);\n' +
        '  float glow = uSpread * max(max(added.r, added.g), added.b);\n' +
        '  float a = max(src.a, glow);\n' +
        '  outColor = a > 0.0 ? vec4(clamp(c / a, 0.0, 1.0), a) : vec4(0.0);\n' +
        '}');
      if (!e) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(e.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this._u(e, 'uTex'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.uniform1i(this._u(e, 'uPrev'), 1);
      gl.uniform1f(this._u(e, 'uSpread'), spread ? 1 : 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    _makeProgram(name, body) {
      const gl = this.gl;
      const fs = HEAD + body;
      const mk = (kind, src) => {
        const s = gl.createShader(kind);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
        return s;
      };
      const v = mk(gl.VERTEX_SHADER, VERT);
      const f = v ? mk(gl.FRAGMENT_SHADER, fs) : null;
      if (!v || !f) return null;
      const p = gl.createProgram();
      gl.attachShader(p, v);
      gl.attachShader(p, f);
      gl.bindAttribLocation(p, 0, 'aPos');
      gl.linkProgram(p);
      gl.deleteShader(v);
      gl.deleteShader(f);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { gl.deleteProgram(p); return null; }
      const entry = { prog: p, loc: {} };
      this.programs[name] = entry;
      return entry;
    }

    /* Bağlam kayboldu mu (#594). Sürücü sıfırlanınca ya da GPU süreci
       çökünce bağlam gidiyor ve bu yüzey siyah kalıyordu; sahibi bunu sorup
       yüzeyi yeni bir tuval ve yeni bir bağlamla baştan kuruyor. */
    contextLost() {
      return !!(this.gl && this.gl.isContextLost && this.gl.isContextLost());
    }

    dispose() {
      const gl = this.gl;
      if (!gl) return;
      this._release();
      for (const k in this.programs) gl.deleteProgram(this.programs[k].prog);
      this.programs = {};
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
      this.gl = null;
    }
  }

  window.SVPostFX = { PostFX, EFFECTS, EFFECT_IDS, defaultChainEntry, register };
})();
