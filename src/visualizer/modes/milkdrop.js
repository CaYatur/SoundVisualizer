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

   NEDEN BLUR ZİNCİRİ AYRI BİR MASRAF: presetlerin %85,5'i `GetBlur1..3`
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
  const MESH_X = 64;
  const MESH_Y = 48;
  // düğüm başına: aPos(2) aUV(2) aUVOrig(2) aRad(1) aAng(1)
  const VSTRIDE = 8;

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
out vec2 vUV;
out vec2 vUVOrig;
out float vRad;
out float vAng;
void main(){
  vUV = aUV;
  vUVOrig = aUVOrig;
  vRad = aRad;
  vAng = aAng;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

  // Sabit warp yolu: preset shader taşımıyorsa (MD1 presetleri) yalnızca karartma
  const WARP_FIXED_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
in vec2 vUVOrig;
in float vRad;
in float vAng;
out vec4 outColor;
uniform sampler2D uPrev;
uniform float uDecay;
void main(){
  outColor = vec4(texture(uPrev, vUV).rgb * uDecay, 1.0);
}`;

  const QUAD_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vUV;
void main(){
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

  /* Sabit birleştirme yolu. MilkDrop'ta fGammaAdj bir ÜS değil ÇARPAN:
     preset yazarları 1.6 gibi değerleri görüntüyü parlatmak için koyuyor.
     Eskiden burada pow(c, 1/gamma) vardı; parlatıyordu ama eğrisi başkaydı
     ve koyu tonları presetin istemediği kadar açıyordu. */
  const COMP_FIXED_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
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
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

  // Ayrılabilir Gauss: yatay ve dikey iki geçiş, doğrusal örneklemeli 5 vuruş
  const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uSrc;
uniform vec2 uStep;
void main(){
  vec3 c = texture(uSrc, vUV).rgb * 0.2270270270;
  c += (texture(uSrc, vUV + uStep * 1.3846153846).rgb
      + texture(uSrc, vUV - uStep * 1.3846153846).rgb) * 0.3162162162;
  c += (texture(uSrc, vUV + uStep * 3.2307692308).rgb
      + texture(uSrc, vUV - uStep * 3.2307692308).rgb) * 0.0702702703;
  outColor = vec4(c, 1.0);
}`;

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

  /* Presetin shader'ına verilen değişkenler. Tek yerde duruyor çünkü hem
     konum önbelleği hem yükleme bu listeden türüyor; ikiye bölmek birinde
     unutulan bir adın sessizce sıfır kalmasına yol açardı. */
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
      if (!this.gl) {
        this.gl2.width = W;
        this.gl2.height = H;
        const gl = this.gl2.getContext('webgl2', {
          alpha: false, antialias: false, preserveDrawingBuffer: true,
        });
        if (!gl) { this.error = 'WebGL2 yok'; return false; }
        this.gl = gl;

        const warp = this._link(MESH_VERT, WARP_FIXED_FRAG);
        const comp = this._link(QUAD_VERT, COMP_FIXED_FRAG);
        const blur = this._link(QUAD_VERT, BLUR_FRAG);
        const line = this._link(LINE_VERT, LINE_FRAG);
        if (!warp.ok || !comp.ok || !blur.ok || !line.ok) {
          this.error = (warp.log || comp.log || blur.log || line.log || 'shader');
          return false;
        }
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
        };

        this._buildMesh();
        this._buildQuad();
        this._buildLine();
        this._buildNoise();
      }

      const gl = this.gl;
      if (this.gl2.width !== W || this.gl2.height !== H) {
        this.gl2.width = W;
        this.gl2.height = H;
        this._disposeTargets();
      }
      if (!this.targets) {
        this.targets = [this._makeTarget(W, H), this._makeTarget(W, H)];
        this.cur = 0;
        /* Blur kademeleri giderek küçülüyor: MilkDrop'ta da öyle. Küçültmek
           hem ucuz hem de tek geçişle daha geniş bir bulanıklık veriyor. */
        this.blur = [];
        let bw = W, bh = H;
        for (let i = 0; i < 3; i++) {
          bw = Math.max(4, bw >> 1);
          bh = Math.max(4, bh >> 1);
          this.blur.push({
            w: bw, h: bh,
            out: this._makeTarget(bw, bh),
            tmp: this._makeTarget(bw, bh),
          });
        }
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
    _colorFormat() {
      if (this._fmt) return this._fmt;
      const gl = this.gl;
      const ok = gl.getExtension('EXT_color_buffer_float')
        || gl.getExtension('EXT_color_buffer_half_float');
      this._fmt = ok
        ? { internal: gl.RGBA16F, type: gl.HALF_FLOAT }
        : { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE };
      return this._fmt;
    }

    _makeTarget(w, h) {
      const gl = this.gl;
      const f = this._colorFormat();
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, w, h, 0, gl.RGBA, f.type, null);
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
      const n = MESH_X + 1;
      this.vao = gl.createVertexArray();
      this.vbo = gl.createBuffer();
      this.ibo = gl.createBuffer();
      this.verts = new Float32Array(n * (MESH_Y + 1) * VSTRIDE);
      const idx = new Uint32Array(MESH_X * MESH_Y * 6);
      let k = 0;
      for (let j = 0; j < MESH_Y; j++) {
        for (let i = 0; i < MESH_X; i++) {
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
      gl.bindVertexArray(this.lineVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
      gl.bufferData(gl.ARRAY_BUFFER, this.lineData, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);
      gl.bindVertexArray(null);
    }

    /* Gürültü dokuları. Presetlerin %61'i istiyor.

       BİLEREK YAKLAŞIK: MilkDrop kendi kurulumuyla belirli gürültü resimleri
       dağıtıyor; onlar bizde yok ve dağıtamayız. Burada tohumlu bir üreteçle
       aynı ÖLÇEKTE ve aynı yapıda dokular üretiliyor. Deseni birebir aynı
       değil, ama bağlanmamış (siyah) bir dokudan çok daha yakın — ve tohum
       sabit olduğu için her açılışta aynı sonucu veriyor. */
    _buildNoise() {
      const gl = this.gl;
      let seed = 0x9e3779b9;
      const rnd = () => {
        seed ^= seed << 13; seed >>>= 0;
        seed ^= seed >> 17;
        seed ^= seed << 5; seed >>>= 0;
        return (seed >>> 8) / 16777216;
      };
      const make = (size, smooth) => {
        const px = new Uint8Array(size * size * 4);
        for (let i = 0; i < size * size; i++) {
          for (let c = 0; c < 4; c++) px[i * 4 + c] = Math.floor(rnd() * 256);
        }
        if (smooth) {
          // Komşu ortalaması: yüksek frekansı düşürüp MilkDrop'un mq/hq
          // dokularının yumuşak karakterine yaklaştırır
          const src = px.slice();
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              for (let c = 0; c < 4; c++) {
                let s = 0;
                for (let dy = -1; dy <= 1; dy++) {
                  for (let dx = -1; dx <= 1; dx++) {
                    const xx = (x + dx + size) % size;
                    const yy = (y + dy + size) % size;
                    s += src[(yy * size + xx) * 4 + c];
                  }
                }
                px[(y * size + x) * 4 + c] = s / 9;
              }
            }
          }
        }
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        // Gürültü dokuları TEKRARLI örnekleniyor; kenara kenetlemek presetin
        // deseninde görünür bir sınır bırakırdı
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        return { tex, size };
      };
      this.noise = {
        lq: make(256, false),
        lqLite: make(32, false),
        mq: make(256, true),
        hq: make(256, true),
        volLq: make(64, false),
        volHq: make(64, true),
      };
    }

    _disposeTargets() {
      const gl = this.gl;
      if (!gl) return;
      const kill = (t) => { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); } };
      if (this.targets) { this.targets.forEach(kill); this.targets = null; }
      if (this.blur) { this.blur.forEach((b) => { kill(b.out); kill(b.tmp); }); this.blur = null; }
    }

    // ------------------------------------------------------------- preset
    _ensurePreset(cfg) {
      const c = cfg.milkdrop || {};
      const key = (c.presetId || '') + '|' + (c.source || '').length;
      if (key === this.presetKey && this.preset) return;
      this.presetKey = key;
      const M = window.SVMilkdrop;
      if (!M) { this.error = 'motor yok'; this.preset = null; return; }
      const src = c.source || DEFAULT_PRESET;
      this.preset = new M.Preset(src, { seed: 1234 });
      this.error = this.preset.errors.join(' | ');
      this.frameNo = 0;
      this.presetTime = 0;
      this.randPreset = [Math.random(), Math.random(), Math.random()];
      this._buildPresetShaders(src);
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
        const lk = this._link(stage === 'warp' ? MESH_VERT : QUAD_VERT, r.glsl);
        if (!lk.ok) {
          notes.push(stage + ': derlenmedi');
          return null;
        }
        if (r.soft.length) notes.push(stage + ': ' + r.soft.length + ' doku yaklaşık');
        return { prog: lk.prog, locs: this._presetLocs(lk.prog, r.extraSamplers), extra: r.extraSamplers };
      };
      this.warpPreset = build(fl.warpShader, 'warp');
      this.compPreset = build(fl.compShader, 'comp');
      this.shaderNote = notes.join(' | ');
    }

    _presetLocs(prog, extra) {
      const gl = this.gl;
      const L = {};
      const u = (n) => gl.getUniformLocation(prog, n);
      for (const s of SAMPLER_UNITS) L[s[0]] = u(s[0]);
      L._extra = (extra || []).map((n) => u(n));
      for (const n of [
        'texsize', 'aspect', 'texsize_noise_lq', 'texsize_noise_mq', 'texsize_noise_hq',
        'texsize_noise_lq_lite', 'texsize_noisevol_lq', 'texsize_noisevol_hq',
        'time', 'fps', 'frame', 'progress',
        'bass', 'mid', 'treb', 'vol', 'bass_att', 'mid_att', 'treb_att', 'vol_att',
        'rand_frame', 'rand_preset', 'roam_cos', 'roam_sin', 'slow_roam_cos', 'slow_roam_sin',
        'hue_shader', 'blur1_min', 'blur1_max', 'blur2_min', 'blur2_max', 'blur3_min', 'blur3_max',
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
      for (const s of SAMPLER_UNITS) if (L[s[0]]) gl.uniform1i(L[s[0]], s[1]);
      /* Bilinmeyen dokular gürültüye bağlanıyor — presetin dosyası bizde yok.
         Hepsi AYNI birime gidiyor: ayrı birim ayırmak doku birimi sınırını
         gereksiz yere zorlardı. */
      for (const loc of L._extra) if (loc) gl.uniform1i(loc, 4);

      const set4 = (n, a, b, c, d) => { if (L[n]) gl.uniform4f(L[n], a, b, c, d); };
      const set3 = (n, a, b, c) => { if (L[n]) gl.uniform3f(L[n], a, b, c); };
      const set1 = (n, a) => { if (L[n]) gl.uniform1f(L[n], a); };

      set4('texsize', ctx.w, ctx.h, 1 / ctx.w, 1 / ctx.h);
      set4('aspect', ctx.aspectx, ctx.aspecty, 1 / ctx.aspectx, 1 / ctx.aspecty);
      const nz = (o, n) => set4(n, o.size, o.size, 1 / o.size, 1 / o.size);
      nz(this.noise.lq, 'texsize_noise_lq');
      nz(this.noise.mq, 'texsize_noise_mq');
      nz(this.noise.hq, 'texsize_noise_hq');
      nz(this.noise.lqLite, 'texsize_noise_lq_lite');
      nz(this.noise.volLq, 'texsize_noisevol_lq');
      nz(this.noise.volHq, 'texsize_noisevol_hq');

      set1('time', ctx.time);
      set1('fps', ctx.fps);
      set1('frame', ctx.frame);
      set1('progress', ctx.progress);
      set1('bass', ctx.bass); set1('mid', ctx.mid); set1('treb', ctx.treb);
      set1('bass_att', ctx.bass_att); set1('mid_att', ctx.mid_att); set1('treb_att', ctx.treb_att);
      set1('vol', ctx.vol); set1('vol_att', ctx.vol_att);
      set4('rand_frame', Math.random(), Math.random(), Math.random(), Math.random());
      set3('rand_preset', this.randPreset[0], this.randPreset[1], this.randPreset[2]);

      /* roam/hue: MilkDrop bunları kendi iç gezinme salınımlarından üretiyor.
         Buradaki karşılıkları aynı KARAKTERDE (yavaş, ilişkisiz dört faz)
         ama birebir aynı değil. */
      const t = ctx.time;
      set4('roam_cos', Math.cos(t * 0.3), Math.cos(t * 0.7), Math.cos(t * 1.1), Math.cos(t * 1.5));
      set4('roam_sin', Math.sin(t * 0.3), Math.sin(t * 0.7), Math.sin(t * 1.1), Math.sin(t * 1.5));
      set4('slow_roam_cos', Math.cos(t * 0.05), Math.cos(t * 0.09), Math.cos(t * 0.13), Math.cos(t * 0.17));
      set4('slow_roam_sin', Math.sin(t * 0.05), Math.sin(t * 0.09), Math.sin(t * 0.13), Math.sin(t * 0.17));
      set3('hue_shader',
        0.5 + 0.5 * Math.sin(t * 0.31),
        0.5 + 0.5 * Math.sin(t * 0.31 + 2.09),
        0.5 + 0.5 * Math.sin(t * 0.31 + 4.19));

      /* Bulanık kopyalar RGBA8'de zaten 0..1 aralığında saklanıyor, yani
         MilkDrop'un sıkıştırma ölçeğine gerek yok: çözme çarpanı 1, kaydırma 0. */
      for (let i = 1; i <= 3; i++) {
        set3('blur' + i + '_min', 0, 0, 0);
        set3('blur' + i + '_max', 1, 1, 1);
      }

      const P = this.preset;
      const q = (i) => P.get('q' + i) || 0;
      const packs = ['_qa', '_qb', '_qc', '_qd', '_qe', '_qf', '_qg', '_qh'];
      for (let p = 0; p < 8; p++) {
        set4(packs[p], q(p * 4 + 1), q(p * 4 + 2), q(p * 4 + 3), q(p * 4 + 4));
      }
    }

    _bindTextures(mainTex) {
      const gl = this.gl;
      const bind = (unit, tex) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
      };
      bind(0, mainTex);
      bind(1, this.blur[0].out.tex);
      bind(2, this.blur[1].out.tex);
      bind(3, this.blur[2].out.tex);
      bind(4, this.noise.lq.tex);
      bind(5, this.noise.lqLite.tex);
      bind(6, this.noise.mq.tex);
      bind(7, this.noise.hq.tex);
      bind(8, this.noise.volLq.tex);
      bind(9, this.noise.volHq.tex);
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
      const sc = Math.min(1, cap / Math.max(1, Math.max(W, H)));
      const GW = Math.max(64, Math.round(W * sc));
      const GH = Math.max(64, Math.round(H * sc));
      if (!this._initGL(GW, GH)) { this._fallback(W, H); return; }
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

      const aspectx = GW >= GH ? GW / GH : 1;
      const aspecty = GW >= GH ? 1 : GH / GW;

      this.preset.frame({
        time: this.time,
        frame: this.frameNo,
        fps: 1 / Math.max(1e-3, step),
        bass, mid, treb,
        bass_att: bassA, mid_att: midA, treb_att: trebA,
        progress: (this.presetTime * 0.1) % 1,
        meshx: MESH_X, meshy: MESH_Y,
        aspectx, aspecty,
      });
      const base = this.preset.captureBase();

      this._buildWarpMesh();

      const src = this.targets[this.cur];
      const dst = this.targets[1 - this.cur];
      this.cur = 1 - this.cur;

      const ctx = {
        w: GW, h: GH, aspectx, aspecty,
        time: this.time, fps: 1 / Math.max(1e-3, step), frame: this.frameNo,
        progress: (this.presetTime * 0.1) % 1,
        bass, mid, treb, bass_att: bassA, mid_att: midA, treb_att: trebA,
        vol: (bass + mid + treb) / 3, vol_att: (bassA + midA + trebA) / 3,
      };

      // --- 3. WARP GEÇİŞİ
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      gl.viewport(0, 0, GW, GH);
      gl.disable(gl.BLEND);
      if (this.warpPreset) {
        gl.useProgram(this.warpPreset.prog);
        this._bindTextures(src.tex);
        this._setPresetUniforms(this.warpPreset.locs, ctx);
      } else {
        gl.useProgram(this.warpFixed);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform1i(this.locWarpFixed.uPrev, 0);
        /* `decay` artik dosyadaki fDecay ile eslesiyor. Eskiden bulunamayip
           0,98'e dusuyordu; 0,5 yazan bir preset sonmek yerine birikiyordu.

           KARE HIZI DUZELTMESI: MilkDrop decay'i kare BASINA uyguluyor ve
           kare hizina gore duzeltmiyor. Presetler de o donemin ~30 fps'inde
           yazilmis. 60 fps'te ayni sayiyi kullanmak saniyede iki kat sondurup
           goruntuyu presetin istediginden cok daha karanlik birakiyor —
           olcerek gorduk. Ussu kare suresiyle olceklemek, saniyedeki sonme
           miktarini kare hizindan bagimsiz kiliyor. */
        const decay = this.preset.get('decay');
        const raw = decay > 0 ? Math.min(1, decay) : 0.98;
        const fps = 1 / Math.max(1e-3, step);
        gl.uniform1f(this.locWarpFixed.uDecay, Math.pow(raw, REF_FPS / Math.max(1, fps)));
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.verts);
      gl.bindVertexArray(this.vao);
      gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);

      /* --- 4. BLUR ZİNCİRİ, çizimlerden ÖNCE.

         MilkDrop bulanık kopyaları warp'ın hemen ardından, şekiller ve
         dalgalar çizilmeden alıyor: GetBlur akan görüntünün bulanık hali
         demek, üstüne çizilmiş parlak şekillerin değil. Sonraya bırakmak
         şekilleri de bulanığa karıştırıyor ve GetBlur okuyan presetlerde
         (yüzde 85,5'i) görünür bir fark yaratıyor. */
      this._buildBlur(dst.tex);

      /* --- 5. Çizimler, warp'ın üstüne. MilkDrop'un sırası: önce şekiller,
         sonra custom dalgalar, en son varsayılan dalga formu. Sıra görünür:
         toplamalı bir şekil kendinden sonra çizilen dalgayı yıkamaz. */
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      gl.viewport(0, 0, GW, GH);
      this._waveSamples(audio, this.preset.get('wave_scale'));
      this._drawShapes(gl, GW, GH);
      this._drawCustomWaves(gl, audio);
      this._drawWaveModes(gl, GW, GH);

      // --- 6. COMP GEÇİŞİ, doğrudan ekrana
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, GW, GH);
      gl.disable(gl.BLEND);
      if (this.compPreset) {
        gl.useProgram(this.compPreset.prog);
        this._bindTextures(dst.tex);
        this._setPresetUniforms(this.compPreset.locs, ctx);
      } else {
        gl.useProgram(this.compFixed);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, dst.tex);
        gl.uniform1i(this.locComp.uSrc, 0);
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
      gl.bindVertexArray(this.quadVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);

      const c = this.ctx;
      c.clearRect(0, 0, W, H);
      c.imageSmoothingEnabled = true;
      c.drawImage(this.gl2, 0, 0, W, H);
    }

    /* Warp ağı: her düğümde per_pixel koşuyor ve düğümün önceki kareden
       nereyi örnekleyeceği çıkıyor. */
    _buildWarpMesh() {
      const n = MESH_X + 1;
      const v = this.verts;
      const warpTime = this.time;
      for (let j = 0; j <= MESH_Y; j++) {
        for (let i = 0; i <= MESH_X; i++) {
          const u = i / MESH_X;
          const w = j / MESH_Y;
          const cx0 = u * 2 - 1;
          const cy0 = w * 2 - 1;
          const rad = Math.min(1, Math.hypot(cx0, cy0) * 0.7071);
          let ang = Math.atan2(cy0, cx0);
          if (ang < 0) ang += Math.PI * 2;

          const p = this.preset.pixel(u, w, rad, ang, this._pix);

          /* MilkDrop'un düğüm dönüşümü. Sıra önemli: önce zum (yarıçapa
             bağlı üstel), sonra dönme, sonra gerdirme, sonra öteleme, en
             sonra warp titreşimi. Başka bir sırada aynı preset bambaşka
             görünür. */
          const zoomExp = p.zoomexp === 0 ? 1 : p.zoomexp;
          const zoom = p.zoom === 0 ? 1 : p.zoom;
          const z = Math.pow(zoom, Math.pow(zoomExp, rad * 2 - 1)) || 1;
          const cx = p.cx;
          const cy = p.cy;
          let su = (u - cx) / z + cx;
          let sv = (w - cy) / z + cy;
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
            su += wr * Math.sin(warpTime * 0.333 + (u * 2 - 1) * 5 + (w * 2 - 1) * 3);
            sv += wr * Math.cos(warpTime * 0.375 - (u * 2 - 1) * 3 + (w * 2 - 1) * 5);
            su += wr * Math.cos(warpTime * 0.753 - (u * 2 - 1) * 4 - (w * 2 - 1) * 2);
            sv += wr * Math.sin(warpTime * 0.825 + (u * 2 - 1) * 2 - (w * 2 - 1) * 4);
          }

          const o = (j * n + i) * VSTRIDE;
          v[o] = u * 2 - 1;
          v[o + 1] = w * 2 - 1;
          v[o + 2] = isFinite(su) ? su : u;
          v[o + 3] = isFinite(sv) ? sv : w;
          v[o + 4] = u;
          v[o + 5] = w;
          v[o + 6] = rad;
          v[o + 7] = ang;
        }
      }
    }

    /* Üç kademe bulanık kopya. Her kademe bir öncekinin yarısı boyutunda ve
       yatay+dikey iki geçişten geçiyor: ayrılabilir Gauss iki geçişte
       tek geçişli bir çekirdeğin karesi kadar iş yapıyor. */
    _buildBlur(srcTex) {
      const gl = this.gl;
      gl.useProgram(this.blurProg);
      gl.uniform1i(this.locBlur.uSrc, 0);
      gl.bindVertexArray(this.quadVao);
      gl.activeTexture(gl.TEXTURE0);
      let input = srcTex;
      for (const b of this.blur) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, b.tmp.fb);
        gl.viewport(0, 0, b.w, b.h);
        gl.bindTexture(gl.TEXTURE_2D, input);
        gl.uniform2f(this.locBlur.uStep, 1 / b.w, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        gl.bindFramebuffer(gl.FRAMEBUFFER, b.out.fb);
        gl.bindTexture(gl.TEXTURE_2D, b.tmp.tex);
        gl.uniform2f(this.locBlur.uStep, 0, 1 / b.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        input = b.out.tex;
      }
      gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /* MilkDrop'un ekran koordinatı: x,y 0..1 ve y AŞAĞI doğru artıyor.
       GL'de y yukarı; çevirmezsek her şekil yatay eksende aynalanır ve
       simetrik olmayan presetler ters görünür. */
    _toClipY(y) { return 1 - 2 * y; }

    _blend(gl, additive) {
      gl.enable(gl.BLEND);
      if (additive) gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    /* Custom şekiller. Referans preset paketinde %48'i bunları kullanıyor.

       Her şekil bir üçgen yelpazesi: merkez rengi (r,g,b,a), kenar rengi
       (r2,g2,b2,a2). Bu iki renk MilkDrop'ta bilerek ayrı — çoğu preset
       merkezi opak, kenarı saydam bırakıp yumuşak bir leke elde ediyor.
       İkisini eşitlemek şekilleri düz disklere çevirirdi. */
    _drawShapes(gl, GW, GH) {
      const P = this.preset;
      if (!P || !P.shapes || !P.shapes.length) return;
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
          const cl = window.SVMilkdrop.clampColor;
          const c1 = [cl(o.r), cl(o.g), cl(o.b), Math.max(0, Math.min(1, +o.a || 0))];
          const c2 = [cl(o.r2), cl(o.g2), cl(o.b2), Math.max(0, Math.min(1, +o.a2 || 0))];

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

          // Kenar çizgisi: MilkDrop border_* renkleriyle ayrı bir geçiş
          const ba = Math.max(0, Math.min(1, +o.border_a || 0));
          if (ba > 0.002) {
            for (let i = 0; i < n; i++) {
              const th = ang0 + ANG0 + (i / n) * Math.PI * 2;
              const k = i * 6;
              d[k] = cxp + Math.cos(th) * rad * aspY;
              d[k + 1] = cyp + Math.sin(th) * rad;
              d[k + 2] = cl(o.border_r); d[k + 3] = cl(o.border_g);
              d[k + 4] = cl(o.border_b); d[k + 5] = ba;
            }
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, n * 6);
            gl.drawArrays(gl.LINE_LOOP, 0, n);
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
    _drawCustomWaves(gl, audio) {
      const P = this.preset;
      if (!P || !P.waves || !P.waves.length) return;
      const tb = audio.timeBytes;
      if (!tb || tb.length < 8) return;
      const d = this.lineData;
      const out = this._waveOut || (this._waveOut = {});
      const cl = window.SVMilkdrop.clampColor;
      gl.useProgram(this.lineProg);
      gl.bindVertexArray(this.lineVao);
      for (const w of P.waves) {
        if (!P.waveFrame(w)) continue;
        const N = Math.min(512, w.samples);
        let count = 0;
        for (let i = 0; i < N; i++) {
          const sample = N > 1 ? i / (N - 1) : 0;
          const i0 = Math.min(tb.length - 1, Math.floor(sample * (tb.length - 1)));
          /* value1/value2 MilkDrop'ta sol ve sağ kanal. Elimizdeki zaman
             verisi tek kanal, bu yüzden ikincisi `sep` kadar kaydırılmış
             aynı veriden alınıyor — presetin iki kanalı ayırdığı yerlerde
             faz farkı korunuyor, ama gerçek stereo değil. */
          const i1 = Math.min(tb.length - 1, i0 + w.sep);
          const v1 = ((tb[i0] - 128) / 128) * w.scaling;
          const v2 = ((tb[i1] - 128) / 128) * w.scaling;
          const o = P.wavePoint(w, sample, v1, v2, out);
          const x = +o.x, y = +o.y;
          if (!isFinite(x) || !isFinite(y)) continue;
          const k = count * 6;
          d[k] = x * 2 - 1;
          d[k + 1] = this._toClipY(y);
          d[k + 2] = cl(o.r); d[k + 3] = cl(o.g); d[k + 4] = cl(o.b);
          d[k + 5] = Math.max(0, Math.min(1, +o.a || 0));
          count++;
        }
        if (count < 2) continue;
        this._blend(gl, w.additive);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, count * 6);
        const gw = this.gl2.width, gh = this.gl2.height;
        this._strip(gl, w.useDots ? gl.POINTS : gl.LINE_STRIP, d, count, -1,
          gw, gh, w.thick ? 2 : 1);
      }
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }

    /* MilkDrop'un dalga örnekleri: iki kanal, kabaca -1..1, wave_scale ile
       ölçekli. NUM_WAVEFORM_SAMPLES 512, diziler 576 çünkü bazı modlar
       ileriye 64 örnek bakıyor (`fL[i+32]` gibi).

       BİLEREK YAKLAŞIK: elimizdeki zaman verisi TEK KANAL. MilkDrop'un 2, 3
       ve 5 numaralı modları gerçek stereodan Lissajous şekli çiziyor; aynı
       diziyi iki kanal saymak onları düz bir köşegene indirirdi. Bu yüzden
       sağ kanal 128 örnek kaydırılmış halinden türetiliyor: faz farkı gerçek
       bir iki boyutlu şekil veriyor, ama gerçek stereo değil. */
    _waveSamples(audio, scale) {
      const tb = audio.timeBytes;
      if (!tb || tb.length < 8) return false;
      if (!this._fL) { this._fL = new Float32Array(576); this._fR = new Float32Array(576); }
      const L = this._fL, R = this._fR;
      const n = tb.length;
      const s = isFinite(scale) && scale !== 0 ? scale : 1;
      for (let i = 0; i < 576; i++) {
        L[i] = ((tb[i % n] - 128) / 128) * s;
        R[i] = ((tb[(i + 128) % n] - 128) / 128) * s;
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
      alpha = Math.max(0, Math.min(1, isFinite(alpha) ? alpha : 1));
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

      let cr = cl(P.get('wave_r')), cg = cl(P.get('wave_g')), cb = cl(P.get('wave_b'));
      // wave_brighten: en parlak kanalı 1'e çekip rengi doyurur
      if (P.get('wave_brighten')) {
        const mx = Math.max(cr, cg, cb);
        if (mx > 0.01) { cr /= mx; cg /= mx; cb /= mx; }
      }

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

      this._blend(gl, !!P.get('wave_additive'));
      gl.useProgram(this.lineProg);
      gl.bindVertexArray(this.lineVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, n * 6);
      const kind = P.get('wave_usedots') ? gl.POINTS : gl.LINE_STRIP;
      this._strip(gl, kind, d, n, breakAt, GW, GH, P.get('wave_thick') ? 2 : 1);
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
    _strip(gl, kind, d, n, breakAt, GW, GH, thickMul) {
      const draw = () => {
        if (breakAt > 0) {
          gl.drawArrays(kind, 0, breakAt);
          gl.drawArrays(kind, breakAt, n - breakAt);
        } else {
          gl.drawArrays(kind, 0, n);
        }
      };
      draw();
      if (kind !== gl.LINE_STRIP) return;
      const weight = Math.max(1, Math.min(4, Math.round(GW / 512) * (thickMul || 1)));
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

    dispose() {
      this._disposeTargets();
      const gl = this.gl;
      if (gl) {
        this._releasePresetProgs();
        if (this.vbo) gl.deleteBuffer(this.vbo);
        if (this.ibo) gl.deleteBuffer(this.ibo);
        if (this.vao) gl.deleteVertexArray(this.vao);
        if (this.quadVbo) gl.deleteBuffer(this.quadVbo);
        if (this.quadVao) gl.deleteVertexArray(this.quadVao);
        if (this.lineVbo) gl.deleteBuffer(this.lineVbo);
        if (this.lineVao) gl.deleteVertexArray(this.lineVao);
        if (this.warpFixed) gl.deleteProgram(this.warpFixed);
        if (this.compFixed) gl.deleteProgram(this.compFixed);
        if (this.blurProg) gl.deleteProgram(this.blurProg);
        if (this.lineProg) gl.deleteProgram(this.lineProg);
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
