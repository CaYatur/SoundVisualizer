'use strict';
/* 3B parametrik geometri motoru (WebGL2).

   formulas.js'teki matematiksel formülleri gerçek perspektifte çizer:
   yüzeyler (küre, simit, Klein şişesi, süperşekil…), uzay eğrileri, düzlem
   eğrileri ve çekici sistemler.

   Tasarım kararları:

   • Üçüncü parti 3B kütüphanesi YOK. Perspektif, bakış ve döndürme matrisleri
     burada, ~60 satırda. Bağımsızlık bilinçli bir tercih; ayrıca tüm boru
     hattı bizim olduğu için ses deformasyonunu doğrudan vertex shader'a
     koyabiliyoruz.

   • Ağ (mesh) BİR KEZ kurulur ve GPU'da kalır. Sese göre bozulma her karede
     CPU'da değil, vertex shader'da spektrum dokusu örneklenerek yapılır —
     96×96'lık bir yüzeyde bile kare başına maliyet sıfıra yakındır.

   • Çekiciler sayısal integrasyonla nokta bulutu üretir; parametre değişince
     yeniden hesaplanır (kapalı formları yoktur). */
(function () {
  const VERT = `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in vec2 aUV;

uniform mat4 uMVP;
uniform mat3 uNormalMat;
uniform sampler2D uSpectrum;
uniform float uDeform;
uniform float uPointSize;
uniform float uBass;
uniform float uTime;
uniform int uDeformMode;   // 0 normal · 1 ışınsal · 2 dikey · 3 çökme

out vec3 vNormal;
out vec2 vUV;
out float vSpec;
out float vDepth;

void main(){
  float s = texture(uSpectrum, vec2(clamp(aUV.x, 0.0, 1.0), 0.5)).r;
  vec3 p = aPos;
  if (uDeformMode == 0)      p += aNormal * s * uDeform;
  else if (uDeformMode == 1) p += normalize(p + vec3(1e-5)) * s * uDeform;
  else if (uDeformMode == 2) p.y += (s - 0.5) * uDeform * 2.0;
  else                       p *= 1.0 - uDeform * 0.5 + s * uDeform;

  vec4 clip = uMVP * vec4(p, 1.0);
  gl_Position = clip;
  gl_PointSize = max(1.0, uPointSize * (1.0 + s * 2.0));
  vNormal = uNormalMat * aNormal;
  vUV = aUV;
  vSpec = s;
  vDepth = clamp(clip.z / max(0.0001, clip.w) * 0.5 + 0.5, 0.0, 1.0);
}`;

  const FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec2 vUV;
in float vSpec;
in float vDepth;
out vec4 outColor;

uniform vec3 uPalette[5];
uniform int uColorMode;   // 0 palet · 1 derinlik · 2 normal · 3 spektrum
uniform float uAlpha;
uniform float uShade;

vec3 pal(float x){
  float f = clamp(x, 0.0, 0.99999) * 4.0;
  int i = int(floor(f));
  return mix(uPalette[i], uPalette[min(i + 1, 4)], f - float(i));
}

void main(){
  vec3 n = normalize(vNormal);
  vec3 col;
  if (uColorMode == 1)      col = pal(vDepth);
  else if (uColorMode == 2) col = n * 0.5 + 0.5;
  else if (uColorMode == 3) col = pal(vSpec);
  else                      col = pal(fract(vUV.x + vUV.y * 0.35));

  // Yumuşak yönlü aydınlatma: yüzey modunda hacim hissi verir, tel kafeste
  // ve noktalarda etkisi uShade ile kısılır.
  float lambert = clamp(dot(n, normalize(vec3(0.4, 0.7, 0.6))), 0.0, 1.0);
  col *= mix(1.0, 0.35 + 0.9 * lambert, uShade);
  col += vSpec * 0.35;

  outColor = vec4(col, uAlpha);
}`;

  // ==========================================================================
  // Küçük matris kitaplığı (sütun-öncelikli, WebGL düzeni)
  // ==========================================================================
  function mat4Identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }

  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ]);
  }

  function multiply(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] =
          a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }

  function rotationYX(yaw, pitch) {
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cx = Math.cos(pitch);
    const sx = Math.sin(pitch);
    // R = Rx * Ry
    return new Float32Array([
      cy, sy * sx, -sy * cx, 0,
      0, cx, sx, 0,
      sy, -cy * sx, cy * cx, 0,
      0, 0, 0, 1,
    ]);
  }

  function translation(x, y, z) {
    const m = mat4Identity();
    m[12] = x;
    m[13] = y;
    m[14] = z;
    return m;
  }

  // Döndürme kısmının normal matrisi (üniform ölçek olduğu için 3x3 yeter)
  function normalMat3(m) {
    return new Float32Array([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]);
  }

  // ==========================================================================
  // Ağ üretimi
  // ==========================================================================
  const DEFAULTS = {
    family: 'surface',
    formula: 'torus',
    params: {},
    render: 'wireframe',
    resolution: 72,
    deform: 0.28,
    deformMode: 'normal',
    spin: 0.18,
    tilt: 0.32,
    zoom: 1,
    cameraAudio: 0.12,
    pointSize: 2.5,
    colorMode: 'palette',
    alpha: 1,
    attractorPoints: 20000,
    attractorStep: 0.006,
  };

  const DEFORM_MODES = { normal: 0, radial: 1, vertical: 2, collapse: 3 };
  const COLOR_MODES = { palette: 0, depth: 1, normal: 2, spectrum: 3 };

  function geomCfg(cfg) {
    const g = (cfg && cfg.geometry) || {};
    const out = Object.assign({}, DEFAULTS, g);
    out.params = g.params || {};
    return out;
  }

  /* Yüzey ağı: (u,v) ızgarası → konum + normal + uv.
     Normaller sonlu farkla hesaplanır; her formül için analitik türev yazmak
     yerine bu, tüm aile için tek seferde doğru sonucu verir. */
  function buildSurface(def, params, n) {
    const N = Math.max(4, Math.min(256, n | 0));
    const verts = (N + 1) * (N + 1);
    const pos = new Float32Array(verts * 3);
    const nor = new Float32Array(verts * 3);
    const uvs = new Float32Array(verts * 2);
    const h = 1 / (N * 4);

    let k = 0;
    for (let j = 0; j <= N; j++) {
      const v = j / N;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const p = def.f(u, v, params);
        pos[k * 3] = p[0];
        pos[k * 3 + 1] = p[1];
        pos[k * 3 + 2] = p[2];
        uvs[k * 2] = u;
        uvs[k * 2 + 1] = v;

        // sonlu fark ile teğetler
        const pu = def.f(Math.min(1, u + h), v, params);
        const pv = def.f(u, Math.min(1, v + h), params);
        const tu = [pu[0] - p[0], pu[1] - p[1], pu[2] - p[2]];
        const tv = [pv[0] - p[0], pv[1] - p[1], pv[2] - p[2]];
        let nx = tu[1] * tv[2] - tu[2] * tv[1];
        let ny = tu[2] * tv[0] - tu[0] * tv[2];
        let nz = tu[0] * tv[1] - tu[1] * tv[0];
        const len = Math.hypot(nx, ny, nz) || 1;
        nor[k * 3] = nx / len;
        nor[k * 3 + 1] = ny / len;
        nor[k * 3 + 2] = nz / len;
        k++;
      }
    }

    const triIdx = [];
    const lineIdx = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i;
        const b = a + 1;
        const c = a + (N + 1);
        const d = c + 1;
        triIdx.push(a, b, d, a, d, c);
        lineIdx.push(a, b, a, c);
      }
    }
    return {
      pos, nor, uvs,
      tri: new Uint32Array(triIdx),
      line: new Uint32Array(lineIdx),
      count: verts,
    };
  }

  // Eğri ağı: tek bir çizgi şeridi (2B eğriler z=0 düzleminde)
  function buildCurve(def, params, n, is2d) {
    const N = Math.max(8, Math.min(20000, n | 0));
    const pos = new Float32Array(N * 3);
    const nor = new Float32Array(N * 3);
    const uvs = new Float32Array(N * 2);
    const pointwise = !!def.pointwise;

    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      const p = is2d ? def.f(u, params, pointwise ? i : null, N) : def.f(u, params);
      pos[i * 3] = p[0];
      pos[i * 3 + 1] = is2d ? p[1] : p[1];
      pos[i * 3 + 2] = is2d ? 0 : p[2];
      // Eğrilerde "normal" yok; merkeze göre ışınsal yön kullanılır
      const len = Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) || 1;
      nor[i * 3] = pos[i * 3] / len;
      nor[i * 3 + 1] = pos[i * 3 + 1] / len;
      nor[i * 3 + 2] = pos[i * 3 + 2] / len;
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = 0.5;
    }

    const lineIdx = new Uint32Array(Math.max(0, (N - 1) * 2));
    for (let i = 0; i < N - 1; i++) {
      lineIdx[i * 2] = i;
      lineIdx[i * 2 + 1] = i + 1;
    }
    return { pos, nor, uvs, tri: null, line: pointwise ? new Uint32Array(0) : lineIdx, count: N, pointsOnly: pointwise };
  }

  // Çekici nokta bulutu: durum sistemini adım adım ilerletir
  function buildAttractor(def, params, count, dt) {
    const N = Math.max(500, Math.min(200000, count | 0));
    const pos = new Float32Array(N * 3);
    const nor = new Float32Array(N * 3);
    const uvs = new Float32Array(N * 2);
    const scale = def.scale || 0.05;
    const c = def.center || [0, 0, 0];

    // Kaçan yörünge ortak yineleyicide yakalanır (bkz. formulas.js: iterate)
    window.SVFormulas.iterate(def, params, {
      steps: N, dt, skip: 500,
      onPoint: (q, i) => {
        const x = (q[0] - c[0]) * scale;
        const y = (q[1] - c[1]) * scale;
        const z = (q[2] - c[2]) * scale;
        pos[i * 3] = x;
        pos[i * 3 + 1] = y;
        pos[i * 3 + 2] = z;
        const len = Math.hypot(x, y, z) || 1;
        nor[i * 3] = x / len;
        nor[i * 3 + 1] = y / len;
        nor[i * 3 + 2] = z / len;
        uvs[i * 2] = i / N;
        uvs[i * 2 + 1] = 0.5;
      },
    });

    const lineIdx = new Uint32Array((N - 1) * 2);
    for (let i = 0; i < N - 1; i++) {
      lineIdx[i * 2] = i;
      lineIdx[i * 2 + 1] = i + 1;
    }
    return { pos, nor, uvs, tri: null, line: lineIdx, count: N };
  }

  /* Katı geometri ailesi.

     Parametrik yüzeyler f(u,v) ile tanımlanıyor; çokyüzlüler, L-sistemler ve
     yinelemeli fonksiyon sistemleri öyle yazılamaz — kapalı bir parametrik
     formları yok. Bu yüzden ayrı bir aile ve doğrudan ağ üreten bir yol.

     Çokyüzlülerde tel kafes AYRI bir ağ olarak geliyor: yüzey çiziminde her
     üçgen kendi köşelerini alıyor (keskin kenarlar için), oysa tel kafes
     paylaşılan köşeler ister. */
  function buildSolid(g) {
    const S = window.SVSolids;
    if (!S) return null;
    const def = S.SOLIDS[g.formula];
    if (!def) return null;
    const params = Object.assign(S.defaults(def), g.params);
    let mesh;
    try { mesh = def.build(params); } catch (e) { return null; }
    if (!mesh) return null;
    if (g.render === 'wireframe' && mesh.wire) {
      return { pos: mesh.wire.pos, nor: mesh.wire.nor, uvs: mesh.wire.uvs, tri: null, line: mesh.wire.line, count: mesh.wire.count };
    }
    return mesh;
  }

  function buildMesh(g) {
    if (g.family === 'solid') return buildSolid(g);
    const def = window.SVFormulas.get(g.family, g.formula);
    if (!def) return null;
    const params = Object.assign(window.SVFormulas.defaults(def), g.params);
    if (g.family === 'surface') return buildSurface(def, params, g.resolution);
    if (g.family === 'attractor') return buildAttractor(def, params, g.attractorPoints, g.attractorStep);
    if (g.family === 'curve2d') return buildCurve(def, params, Math.max(64, g.resolution * 24), true);
    return buildCurve(def, params, Math.max(64, g.resolution * 24), false);
  }

  // Ağın yeniden kurulmasını gerektiren alanların imzası
  function meshSignature(g) {
    return [g.family, g.formula, g.resolution, g.attractorPoints, g.attractorStep, JSON.stringify(g.params)].join('|');
  }

  // ==========================================================================
  class Geometry3D {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.gl3 = document.createElement('canvas');
      this.gl = null;
      this.prog = null;
      this.loc = {};
      this.mesh = null;
      this.sig = '';
      this.buffers = null;
      this.specTex = null;
      this.specBuf = new Uint8Array(512);
      this.spin = 0;
      this._init();
    }

    _init() {
      const gl = this.gl3.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: false,
        antialias: true,
        depth: true,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      });
      if (!gl) return;
      this.gl = gl;

      const mk = (kind, src) => {
        const s = gl.createShader(kind);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.warn('[geometry3d] ' + gl.getShaderInfoLog(s));
          gl.deleteShader(s);
          return null;
        }
        return s;
      };
      const v = mk(gl.VERTEX_SHADER, VERT);
      const f = v ? mk(gl.FRAGMENT_SHADER, FRAG) : null;
      if (!v || !f) return;
      const p = gl.createProgram();
      gl.attachShader(p, v);
      gl.attachShader(p, f);
      gl.bindAttribLocation(p, 0, 'aPos');
      gl.bindAttribLocation(p, 1, 'aNormal');
      gl.bindAttribLocation(p, 2, 'aUV');
      gl.linkProgram(p);
      gl.deleteShader(v);
      gl.deleteShader(f);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return;
      this.prog = p;

      this.specTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.specTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 512, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(512));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    _u(name) {
      if (!(name in this.loc)) this.loc[name] = this.gl.getUniformLocation(this.prog, name);
      return this.loc[name];
    }

    _upload(mesh) {
      const gl = this.gl;
      if (this.buffers) {
        for (const b of Object.values(this.buffers)) if (b) gl.deleteBuffer(b);
      }
      const mk = (data, target) => {
        const b = gl.createBuffer();
        gl.bindBuffer(target, b);
        gl.bufferData(target, data, gl.STATIC_DRAW);
        return b;
      };
      this.buffers = {
        pos: mk(mesh.pos, gl.ARRAY_BUFFER),
        nor: mk(mesh.nor, gl.ARRAY_BUFFER),
        uv: mk(mesh.uvs, gl.ARRAY_BUFFER),
        tri: mesh.tri && mesh.tri.length ? mk(mesh.tri, gl.ELEMENT_ARRAY_BUFFER) : null,
        line: mesh.line && mesh.line.length ? mk(mesh.line, gl.ELEMENT_ARRAY_BUFFER) : null,
      };
    }

    resize() {}

    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      ctx.clearRect(0, 0, W, H);
      const gl = this.gl;
      if (!gl || !this.prog) return;

      const g = geomCfg(cfg);
      if (this.gl3.width !== W || this.gl3.height !== H) {
        this.gl3.width = W;
        this.gl3.height = H;
      }

      const sig = meshSignature(g);
      if (sig !== this.sig) {
        this.sig = sig;
        this.mesh = buildMesh(g);
        if (this.mesh) this._upload(this.mesh);
      }
      if (!this.mesh || !this.buffers) return;

      // spektrumu GPU'ya ver (deformasyon vertex shader'da yapılır)
      if (audio && audio.getBars) {
        const v = cfg.visualizer || {};
        const bars = audio.getBars(512, v.minFreq || 20, v.maxFreq || 20000);
        for (let i = 0; i < 512; i++) this.specBuf[i] = Math.min(255, (bars[i] * 255) | 0);
        gl.bindTexture(gl.TEXTURE_2D, this.specTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 512, 1, gl.RED, gl.UNSIGNED_BYTE, this.specBuf);
      }

      const level = audio ? audio.level : 0;
      const bass = audio ? audio.bass : 0;
      this.spin += (dt || 0.016) * g.spin * (1 + level * 1.5);

      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (g.alpha < 1) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      } else {
        gl.disable(gl.BLEND);
      }

      const aspect = W / Math.max(1, H);
      const dist = 3.2 / Math.max(0.15, g.zoom) - bass * g.cameraAudio * 2;
      const proj = perspective((50 * Math.PI) / 180, aspect, 0.05, 60);
      const rot = rotationYX(this.spin, g.tilt + Math.sin(t * 0.23) * 0.12);
      const view = translation(0, 0, -Math.max(0.6, dist));
      const mvp = multiply(proj, multiply(view, rot));

      gl.useProgram(this.prog);
      gl.uniformMatrix4fv(this._u('uMVP'), false, mvp);
      gl.uniformMatrix3fv(this._u('uNormalMat'), false, normalMat3(rot));
      gl.uniform1f(this._u('uDeform'), g.deform);
      gl.uniform1f(this._u('uPointSize'), g.pointSize * (W / 1280));
      gl.uniform1f(this._u('uBass'), bass);
      gl.uniform1f(this._u('uTime'), t);
      gl.uniform1i(this._u('uDeformMode'), DEFORM_MODES[g.deformMode] || 0);
      gl.uniform1i(this._u('uColorMode'), COLOR_MODES[g.colorMode] || 0);
      gl.uniform1f(this._u('uAlpha'), Math.max(0.05, Math.min(1, g.alpha)));
      gl.uniform1f(this._u('uShade'), g.render === 'surface' ? 1 : 0.25);

      const cols = (cfg.background && cfg.background.gradient && cfg.background.gradient.colors) || [];
      const pal = new Float32Array(15);
      for (let i = 0; i < 5; i++) {
        const c = window.SV.hexToRgb01(cols[i] || cols[cols.length - 1] || '#3aa6ff');
        pal[i * 3] = c[0];
        pal[i * 3 + 1] = c[1];
        pal[i * 3 + 2] = c[2];
      }
      gl.uniform3fv(this._u('uPalette[0]') || this._u('uPalette'), pal);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.specTex);
      gl.uniform1i(this._u('uSpectrum'), 0);

      const bind = (buf, loc, size) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      };
      bind(this.buffers.pos, 0, 3);
      bind(this.buffers.nor, 1, 3);
      bind(this.buffers.uv, 2, 2);

      const mode = this.mesh.pointsOnly ? 'points' : g.render;
      if (mode === 'surface' && this.buffers.tri) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.tri);
        gl.drawElements(gl.TRIANGLES, this.mesh.tri.length, gl.UNSIGNED_INT, 0);
      } else if (mode === 'points' || !this.buffers.line) {
        gl.drawArrays(gl.POINTS, 0, this.mesh.count);
      } else {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.line);
        gl.drawElements(gl.LINES, this.mesh.line.length, gl.UNSIGNED_INT, 0);
      }

      ctx.drawImage(this.gl3, 0, 0, W, H);
    }

    dispose() {
      const gl = this.gl;
      if (!gl) return;
      if (this.buffers) for (const b of Object.values(this.buffers)) if (b) gl.deleteBuffer(b);
      if (this.prog) gl.deleteProgram(this.prog);
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
      this.gl = null;
    }
  }

  window.SVModes = window.SVModes || {};
  window.SVModes.geometry = Geometry3D;
  window.SVGeometry = { DEFAULTS, DEFORM_MODES, COLOR_MODES, buildMesh, geomCfg };
})();
