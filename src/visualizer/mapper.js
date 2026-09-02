'use strict';
/* Projeksiyon haritalama — çıkış aşaması.

   Birleştirilmiş sahneyi alır ve ekrana/projektöre GİDERKEN büker: köşe
   düzeltme, ağ bükme, kırpma, kenar harmanlama, renk düzeltme, maske ve
   hizalama desenleri. Matematiği src/shared/warp.js'te, testleri
   tests/warp.test.js'te.

   Neden vertex shader'da:
   Bükmeyi 2B tuvalde üçgen üçgen yapmak mümkün ama hem yavaş hem dikişli
   olur. Burada kaynak, alt bölünmüş bir ızgaraya doku olarak geriliyor;
   ızgara düğümlerinin hedef konumu CPU'da bir kez hesaplanıp GPU'ya
   yükleniyor ve yalnızca haritalama değiştiğinde yeniden kuruluyor.

   Perspektif doğruluğu:
   Köşe düzeltme bir homografidir ve homografinin paydası (w) doğrudan
   gl_Position.w'ye yazılıyor. WebGL varying'leri w'ye bölerek enterpole
   ettiği için doku koordinatları perspektif olarak DOĞRU çıkıyor. Bu
   yapılmasaydı, eğimli bir yüzeyde doku klasik "PS1 bükülmesi" gibi
   kayardı — düz çizgiler düz kalır ama doku kaymaya başlardı. */
(function () {
  const W = () => window.SVWarp;
  const SUB = 40; // ızgara alt bölünmesi (SUB x SUB dörtgen)

  const VERT = `#version 300 es
precision highp float;
// x*w, y*w, w  — homografinin paydası doğrudan gl_Position.w'ye gider
in vec3 aPos;
in vec2 aUV;
out vec2 vUV;
void main(){
  vUV = aUV;
  gl_Position = vec4(aPos.xy, 0.0, aPos.z);
}`;

  const FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uTex;
uniform sampler2D uMask;
uniform vec4 uCrop;        // x, y, w, h
uniform vec4 uEdges;       // sol, sağ, üst, alt
uniform float uEdgeGamma;
uniform vec3 uGain;
uniform float uBright, uContrast, uGamma;
uniform int uPattern;      // 0 yok, 1 ızgara, 2 artı, 3 bar, 4 çember
uniform float uHasMask;
uniform vec2 uRes;

// warp.js'teki edgeBlend ile aynı eğri: f(x) + f(1-x) = 1
float blend(float pos, float w, float g){
  if (w <= 0.0) return 1.0;
  float x = clamp(pos / w, 0.0, 1.0);
  if (x >= 1.0) return 1.0;
  return x < 0.5 ? 0.5 * pow(2.0 * x, g) : 1.0 - 0.5 * pow(2.0 * (1.0 - x), g);
}

vec3 pattern(vec2 uv, vec3 c){
  if (uPattern == 1) {
    // Hizalama ızgarası: 10x10 hücre + kenar çerçevesi
    vec2 g = abs(fract(uv * 10.0) - 0.5);
    float line = 1.0 - smoothstep(0.0, 0.03, min(g.x, g.y));
    float border = 1.0 - smoothstep(0.0, 0.006, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
    return mix(c * 0.25, vec3(1.0), max(line, border));
  }
  if (uPattern == 2) {
    // Merkez artısı ve çemberi
    float cross_ = 1.0 - smoothstep(0.0, 0.004, min(abs(uv.x - 0.5), abs(uv.y - 0.5)));
    float ring = 1.0 - smoothstep(0.0, 0.006, abs(length(uv - 0.5) - 0.25));
    return mix(c * 0.25, vec3(1.0), max(cross_, ring));
  }
  if (uPattern == 3) {
    // Renk barları
    int i = int(floor(uv.x * 7.0));
    vec3 bars[7] = vec3[7](
      vec3(1.0), vec3(1.0,1.0,0.0), vec3(0.0,1.0,1.0), vec3(0.0,1.0,0.0),
      vec3(1.0,0.0,1.0), vec3(1.0,0.0,0.0), vec3(0.0,0.0,1.0));
    return bars[i] * (uv.y < 0.8 ? 1.0 : uv.y * 0.5);
  }
  if (uPattern == 4) {
    // Odak çemberleri
    float r = length(uv - 0.5) * 2.0;
    float rings = 1.0 - smoothstep(0.0, 0.02, abs(fract(r * 8.0) - 0.5) - 0.42);
    return mix(c * 0.25, vec3(1.0), rings);
  }
  return c;
}

void main(){
  vec2 uv = uCrop.xy + vUV * uCrop.zw;
  vec3 c = texture(uTex, uv).rgb;
  c = pattern(vUV, c);

  // Renk düzeltme: gama, kontrast, parlaklık, kanal kazancı
  c = pow(max(c, vec3(0.0)), vec3(1.0 / max(0.05, uGamma)));
  c = (c - 0.5) * uContrast + 0.5;
  c *= uBright * uGain;

  // Kenar harmanlama
  float b =
    blend(vUV.x, uEdges.x, uEdgeGamma) *
    blend(1.0 - vUV.x, uEdges.y, uEdgeGamma) *
    blend(vUV.y, uEdges.z, uEdgeGamma) *
    blend(1.0 - vUV.y, uEdges.w, uEdgeGamma);
  c *= b;

  if (uHasMask > 0.5) c *= texture(uMask, vUV).r;

  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

  class Mapper {
    constructor() {
      this.canvas = document.createElement('canvas');
      this.gl = null;
      this.prog = null;
      this.width = 2;
      this.height = 2;
      this._meshSig = '';
      this._maskSig = '';
      this.ok = false;
      this.error = '';
    }

    _init() {
      if (this.gl) return !!this.prog;
      const gl = this.canvas.getContext('webgl2', {
        alpha: true, premultipliedAlpha: false, antialias: true, preserveDrawingBuffer: false,
      });
      if (!gl) { this.error = 'WebGL2 yok'; return false; }
      this.gl = gl;

      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          this.error = gl.getShaderInfoLog(s) || 'shader hatası';
          return null;
        }
        return s;
      };
      const vs = sh(gl.VERTEX_SHADER, VERT);
      const fs = sh(gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return false;
      const p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        this.error = gl.getProgramInfoLog(p) || 'link hatası';
        return false;
      }
      this.prog = p;
      this.loc = {
        aPos: gl.getAttribLocation(p, 'aPos'),
        aUV: gl.getAttribLocation(p, 'aUV'),
        uTex: gl.getUniformLocation(p, 'uTex'),
        uMask: gl.getUniformLocation(p, 'uMask'),
        uCrop: gl.getUniformLocation(p, 'uCrop'),
        uEdges: gl.getUniformLocation(p, 'uEdges'),
        uEdgeGamma: gl.getUniformLocation(p, 'uEdgeGamma'),
        uGain: gl.getUniformLocation(p, 'uGain'),
        uBright: gl.getUniformLocation(p, 'uBright'),
        uContrast: gl.getUniformLocation(p, 'uContrast'),
        uGamma: gl.getUniformLocation(p, 'uGamma'),
        uPattern: gl.getUniformLocation(p, 'uPattern'),
        uHasMask: gl.getUniformLocation(p, 'uHasMask'),
        uRes: gl.getUniformLocation(p, 'uRes'),
      };
      this.vao = gl.createVertexArray();
      this.vbo = gl.createBuffer();
      this.ibo = gl.createBuffer();
      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.maskTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.ok = true;
      return true;
    }

    resize(w, h) {
      this.width = Math.max(2, w | 0);
      this.height = Math.max(2, h | 0);
      if (this.canvas.width !== this.width) this.canvas.width = this.width;
      if (this.canvas.height !== this.height) this.canvas.height = this.height;
    }

    /* Izgarayı kur. CPU'da yapılır ve yalnızca haritalama DEĞİŞTİĞİNDE
       yeniden kurulur — her karede 1600 dörtgen hesaplamak gereksiz olurdu. */
    _buildMesh(out) {
      const w = W();
      const sig = JSON.stringify([out.corners, out.mesh && out.mesh.pts ? Array.from(out.mesh.pts) : null,
        out.mesh && out.mesh.cols, out.mesh && out.mesh.rows]);
      if (sig === this._meshSig) return;
      this._meshSig = sig;

      const gl = this.gl;
      const H = w.homography(
        [[0, 0], [1, 0], [1, 1], [0, 1]],
        out.corners || [[0, 0], [1, 0], [1, 1], [0, 1]]
      );
      const grid = out.mesh && out.mesh.pts
        ? { cols: out.mesh.cols, rows: out.mesh.rows, pts: out.mesh.pts }
        : null;

      const n = SUB + 1;
      const verts = new Float32Array(n * n * 5);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const u = i / SUB;
          const v = j / SUB;
          let mx = u;
          let my = v;
          if (grid) {
            const p = w.meshPoint(grid, u, v);
            mx = p[0];
            my = p[1];
          }
          // Homografiyi payda ile birlikte uygula
          let x = mx;
          let y = my;
          let wq = 1;
          if (H) {
            wq = H[6] * mx + H[7] * my + H[8];
            if (Math.abs(wq) < 1e-9) wq = 1e-9;
            x = (H[0] * mx + H[1] * my + H[2]) / wq;
            y = (H[3] * mx + H[4] * my + H[5]) / wq;
          }
          const cx = x * 2 - 1;
          const cy = 1 - y * 2;
          const o = (j * n + i) * 5;
          // Perspektif doğru enterpolasyon için w ile çarpılmış konum
          verts[o] = cx * wq;
          verts[o + 1] = cy * wq;
          verts[o + 2] = wq;
          verts[o + 3] = u;
          verts[o + 4] = v;
        }
      }
      const idx = new Uint32Array(SUB * SUB * 6);
      let k = 0;
      for (let j = 0; j < SUB; j++) {
        for (let i = 0; i < SUB; i++) {
          const a = j * n + i;
          const b = a + 1;
          const c = a + n;
          const d = c + 1;
          idx[k++] = a; idx[k++] = b; idx[k++] = c;
          idx[k++] = b; idx[k++] = d; idx[k++] = c;
        }
      }
      this.indexCount = idx.length;

      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(this.loc.aPos);
      gl.vertexAttribPointer(this.loc.aPos, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(this.loc.aUV);
      gl.vertexAttribPointer(this.loc.aUV, 2, gl.FLOAT, false, 20, 12);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
    }

    /* Maske dokusu. Çokgen maskeleri piksel piksel shader'da çözmek yerine
       bir kez 2B tuvale çizip doku olarak veriyoruz; maske değişmediği
       sürece yeniden üretilmez. */
    _buildMask(out) {
      const masks = out.masks || [];
      const sig = JSON.stringify(masks);
      if (sig === this._maskSig) return masks.length > 0;
      this._maskSig = sig;
      if (!masks.length) return false;

      const S = 512;
      if (!this._maskCanvas) {
        this._maskCanvas = document.createElement('canvas');
        this._maskCanvas.width = S;
        this._maskCanvas.height = S;
      }
      const c = this._maskCanvas.getContext('2d');
      c.fillStyle = '#fff';
      c.fillRect(0, 0, S, S);
      c.fillStyle = '#000';
      for (const poly of masks) {
        if (!poly || poly.length < 3) continue;
        c.beginPath();
        poly.forEach(([x, y], i) => {
          if (i === 0) c.moveTo(x * S, y * S); else c.lineTo(x * S, y * S);
        });
        c.closePath();
        c.fill();
      }
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this._maskCanvas);
      return true;
    }

    /* Kaynağı haritalayarak kendi tuvaline çizer. Dönüş: başarılıysa true.
       Haritalama kimlikse hiçbir şey yapılmaz — çağıran kaynağı doğrudan
       kullanmalıdır. */
    render(source, out) {
      if (!source || !out) return false;
      if (W().isIdentity(out)) return false;
      if (!this._init()) return false;
      const gl = this.gl;

      this._buildMesh(out);
      const hasMask = this._buildMask(out);

      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

      gl.viewport(0, 0, this.width, this.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.prog);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.uniform1i(this.loc.uTex, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
      gl.uniform1i(this.loc.uMask, 1);

      const cr = out.crop || {};
      gl.uniform4f(this.loc.uCrop, cr.x || 0, cr.y || 0,
        cr.w == null ? 1 : cr.w, cr.h == null ? 1 : cr.h);
      const e = out.edges || {};
      gl.uniform4f(this.loc.uEdges, e.left || 0, e.right || 0, e.top || 0, e.bottom || 0);
      gl.uniform1f(this.loc.uEdgeGamma, e.gamma == null ? 1 : e.gamma);
      const col = out.color || {};
      gl.uniform3f(this.loc.uGain, col.r == null ? 1 : col.r, col.g == null ? 1 : col.g, col.b == null ? 1 : col.b);
      gl.uniform1f(this.loc.uBright, col.brightness == null ? 1 : col.brightness);
      gl.uniform1f(this.loc.uContrast, col.contrast == null ? 1 : col.contrast);
      gl.uniform1f(this.loc.uGamma, col.gamma == null ? 1 : col.gamma);
      const PAT = { none: 0, grid: 1, cross: 2, bars: 3, circle: 4 };
      gl.uniform1i(this.loc.uPattern, PAT[out.testPattern] || 0);
      gl.uniform1f(this.loc.uHasMask, hasMask ? 1 : 0);
      gl.uniform2f(this.loc.uRes, this.width, this.height);

      gl.bindVertexArray(this.vao);
      gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
      return true;
    }

    dispose() {
      const gl = this.gl;
      if (!gl) return;
      if (this.vbo) gl.deleteBuffer(this.vbo);
      if (this.ibo) gl.deleteBuffer(this.ibo);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.tex) gl.deleteTexture(this.tex);
      if (this.maskTex) gl.deleteTexture(this.maskTex);
      if (this.prog) gl.deleteProgram(this.prog);
      this.gl = null;
      this.prog = null;
      this.ok = false;
      this._meshSig = '';
      this._maskSig = '';
    }
  }

  window.SVMapper = { Mapper, SUB };
})();
