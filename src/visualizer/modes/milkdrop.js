'use strict';
/* MilkDrop motoru — warp ağı ve geri besleme.

   src/shared/milkdrop.js preset dilini çalıştırıyor; burada onun ürettiği
   hareket değişkenleri gerçek piksellere dönüşüyor.

   Çalışma biçimi, orijinaliyle aynı fikirde:

     1. `per_frame` kare başına bir kez koşar ve kare geneli hareketi belirler
        (zoom, rot, warp, dx/dy, cx/cy, sx/sy).
     2. `per_pixel` warp ağının HER DÜĞÜMÜNDE koşar; her düğüm için o
        noktanın bir önceki kareden nereyi örnekleyeceği hesaplanır.
     3. Önceki kare bu bozulmuş ağdan geçirilerek yeniden çizilir, biraz
        karartılır (decay) ve üstüne dalga formu çizilir.
     4. Sonuç bir sonraki karenin girdisi olur.

   Görüntünün "akması" bu geri beslemeden gelir: her kare bir öncekinin hafif
   bozulmuş halidir ve bozulma birikir.

   İki doku arasında gidip gelinir (ping-pong): bir dokudan okurken aynı
   dokuya yazmak tanımsız davranıştır. */
(function () {
  const MESH_X = 40;
  const MESH_Y = 30;

  const VERT = `#version 300 es
precision highp float;
in vec2 aPos;   // ekran konumu, kırpma uzayında
in vec2 aUV;    // önceki kareden örneklenecek nokta
out vec2 vUV;
void main(){
  vUV = aUV;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

  const FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uPrev;
uniform float uDecay;
uniform vec3 uSolarize;   // gamma, echo, brighten
void main(){
  vec3 c = texture(uPrev, vUV).rgb;
  c *= uDecay;
  // Gama: preseti n fGammaAdj alanı görüntüyü parlatır
  c = pow(max(c, vec3(0.0)), vec3(1.0 / max(0.05, uSolarize.x)));
  outColor = vec4(c, 1.0);
}`;

  const LINE_VERT = `#version 300 es
precision highp float;
in vec2 aPos;
in vec4 aCol;
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

  class MilkdropMode {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.gl2 = document.createElement('canvas');
      this.gl = null;
      this.preset = null;
      this.presetKey = '';
      this.error = '';
      this.time = 0;
      this.frameNo = 0;
      this._pix = {};
      this._built = false;
    }

    resize() {}

    // ----------------------------------------------------------------- GL
    _initGL(W, H) {
      if (this.gl && this.gl2.width === W && this.gl2.height === H) return !!this.prog;
      if (!this.gl) {
        this.gl2.width = W;
        this.gl2.height = H;
        const gl = this.gl2.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true });
        if (!gl) { this.error = 'WebGL2 yok'; return false; }
        this.gl = gl;
        const mk = (vs, fs) => {
          const c = (t, s) => {
            const o = gl.createShader(t);
            gl.shaderSource(o, s);
            gl.compileShader(o);
            if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) {
              this.error = gl.getShaderInfoLog(o) || 'shader';
              return null;
            }
            return o;
          };
          const a = c(gl.VERTEX_SHADER, vs);
          const b = c(gl.FRAGMENT_SHADER, fs);
          if (!a || !b) return null;
          const p = gl.createProgram();
          gl.attachShader(p, a);
          gl.attachShader(p, b);
          gl.linkProgram(p);
          if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { this.error = gl.getProgramInfoLog(p) || 'link'; return null; }
          return p;
        };
        this.prog = mk(VERT, FRAG);
        this.lineProg = mk(LINE_VERT, LINE_FRAG);
        if (!this.prog || !this.lineProg) return false;

        this.loc = {
          aPos: gl.getAttribLocation(this.prog, 'aPos'),
          aUV: gl.getAttribLocation(this.prog, 'aUV'),
          uPrev: gl.getUniformLocation(this.prog, 'uPrev'),
          uDecay: gl.getUniformLocation(this.prog, 'uDecay'),
          uSolarize: gl.getUniformLocation(this.prog, 'uSolarize'),
        };
        this.lineLoc = {
          aPos: gl.getAttribLocation(this.lineProg, 'aPos'),
          aCol: gl.getAttribLocation(this.lineProg, 'aCol'),
        };

        // Warp ağı
        this.vao = gl.createVertexArray();
        this.vbo = gl.createBuffer();
        this.ibo = gl.createBuffer();
        this.verts = new Float32Array((MESH_X + 1) * (MESH_Y + 1) * 4);
        const idx = new Uint32Array(MESH_X * MESH_Y * 6);
        let k = 0;
        const n = MESH_X + 1;
        for (let j = 0; j < MESH_Y; j++) {
          for (let i = 0; i < MESH_X; i++) {
            const a = j * n + i;
            idx[k++] = a; idx[k++] = a + 1; idx[k++] = a + n;
            idx[k++] = a + 1; idx[k++] = a + n + 1; idx[k++] = a + n;
          }
        }
        this.indexCount = idx.length;
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, this.verts, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.loc.aPos);
        gl.vertexAttribPointer(this.loc.aPos, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(this.loc.aUV);
        gl.vertexAttribPointer(this.loc.aUV, 2, gl.FLOAT, false, 16, 8);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
        gl.bindVertexArray(null);

        // Dalga formu
        this.lineVao = gl.createVertexArray();
        this.lineVbo = gl.createBuffer();
        this.lineData = new Float32Array(512 * 6);
        gl.bindVertexArray(this.lineVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
        gl.bufferData(gl.ARRAY_BUFFER, this.lineData, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.lineLoc.aPos);
        gl.vertexAttribPointer(this.lineLoc.aPos, 2, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(this.lineLoc.aCol);
        gl.vertexAttribPointer(this.lineLoc.aCol, 4, gl.FLOAT, false, 24, 8);
        gl.bindVertexArray(null);
      }

      const gl = this.gl;
      if (this.gl2.width !== W || this.gl2.height !== H) {
        this.gl2.width = W;
        this.gl2.height = H;
        this._disposeTargets();
      }
      if (!this.targets) {
        this.targets = [];
        for (let i = 0; i < 2; i++) {
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
          gl.clearColor(0, 0, 0, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
          this.targets.push({ tex, fb });
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.cur = 0;
      }
      return true;
    }

    _disposeTargets() {
      const gl = this.gl;
      if (!gl || !this.targets) return;
      for (const t of this.targets) {
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fb);
      }
      this.targets = null;
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
    }

    // ----------------------------------------------------------------- çiz
    draw(audio, cfg, t, dt) {
      const W = this.canvas.width;
      const H = this.canvas.height;
      // Geri besleme yüzeyi tam çözünürlükte gerekmiyor; yarı çözünürlük
      // hem daha hızlı hem de MilkDrop'un yumuşak görüntüsüne daha yakın
      const GW = Math.max(64, Math.min(1280, Math.round(W * 0.5)));
      const GH = Math.max(64, Math.min(720, Math.round(H * 0.5)));
      if (!this._initGL(GW, GH)) { this._fallback(W, H); return; }
      this._ensurePreset(cfg);
      if (!this.preset) { this._fallback(W, H); return; }

      const gl = this.gl;
      const step = Math.min(0.05, dt || 0.016);
      this.time += step;
      this.frameNo++;

      const sens = (cfg.visualizer && cfg.visualizer.sensitivity) || 1;
      const bass = Math.min(4, audio.bass * sens * 2);
      const mid = Math.min(4, audio.mid * sens * 2);
      const treb = Math.min(4, audio.treble * sens * 2);

      // Kare geneli hareket
      this.preset.frame({
        time: this.time,
        frame: this.frameNo,
        fps: 1 / Math.max(1e-3, step),
        bass, mid, treb,
        bass_att: bass, mid_att: mid, treb_att: treb,
        progress: (this.time * 0.1) % 1,
        meshx: MESH_X, meshy: MESH_Y,
        aspectx: 1, aspecty: GH / GW,
      });
      const base = this.preset.captureBase();

      // Warp ağı: her düğümde per_pixel
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
          // Dönme
          const ca = Math.cos(p.rot);
          const sa = Math.sin(p.rot);
          const du = su - cx;
          const dv = sv - cy;
          su = du * ca - dv * sa + cx;
          sv = du * sa + dv * ca + cy;
          // Gerdirme
          const sx = p.sx === 0 ? 1 : p.sx;
          const sy = p.sy === 0 ? 1 : p.sy;
          su = (su - cx) / sx + cx;
          sv = (sv - cy) / sy + cy;
          // Öteleme
          su -= p.dx;
          sv -= p.dy;
          // Warp titreşimi: MilkDrop'un dört sinüsten oluşan deseni
          const wr = p.warp * 0.0035;
          if (wr !== 0) {
            su += wr * Math.sin(warpTime * 0.333 + (u * 2 - 1) * 5 + (w * 2 - 1) * 3);
            sv += wr * Math.cos(warpTime * 0.375 - (u * 2 - 1) * 3 + (w * 2 - 1) * 5);
            su += wr * Math.cos(warpTime * 0.753 - (u * 2 - 1) * 4 - (w * 2 - 1) * 2);
            sv += wr * Math.sin(warpTime * 0.825 + (u * 2 - 1) * 2 - (w * 2 - 1) * 4);
          }

          const o = (j * n + i) * 4;
          v[o] = u * 2 - 1;
          v[o + 1] = w * 2 - 1;
          v[o + 2] = isFinite(su) ? su : u;
          v[o + 3] = isFinite(sv) ? sv : w;
        }
      }

      const src = this.targets[this.cur];
      const dst = this.targets[1 - this.cur];
      this.cur = 1 - this.cur;

      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      gl.viewport(0, 0, GW, GH);
      gl.disable(gl.BLEND);
      gl.useProgram(this.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(this.loc.uPrev, 0);
      const decay = this.preset.get('decay');
      gl.uniform1f(this.loc.uDecay, decay > 0 ? Math.min(1, decay) : 0.98);
      const gamma = this.preset.get('fgammaadj') || this.preset.get('gamma') || 1;
      gl.uniform3f(this.loc.uSolarize, gamma, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, v);
      gl.bindVertexArray(this.vao);
      gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);

      // Dalga formu
      this._drawWave(gl, audio, cfg, base);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // Sonucu ekrana: dst dokusunu 2B tuvale taşımak için tam ekran çizim
      gl.viewport(0, 0, GW, GH);
      gl.useProgram(this.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, dst.tex);
      gl.uniform1f(this.loc.uDecay, 1);
      gl.uniform3f(this.loc.uSolarize, 1, 0, 0);
      this._blitIdentity(gl);

      const c = this.ctx;
      c.clearRect(0, 0, W, H);
      c.imageSmoothingEnabled = true;
      c.drawImage(this.gl2, 0, 0, W, H);
    }

    // Kimlik ağıyla tam ekran çizim (ekrana aktarım için)
    _blitIdentity(gl) {
      if (!this._idVerts) {
        const n = MESH_X + 1;
        this._idVerts = new Float32Array(n * (MESH_Y + 1) * 4);
        for (let j = 0; j <= MESH_Y; j++) {
          for (let i = 0; i <= MESH_X; i++) {
            const o = (j * n + i) * 4;
            const u = i / MESH_X;
            const w = j / MESH_Y;
            this._idVerts[o] = u * 2 - 1;
            this._idVerts[o + 1] = w * 2 - 1;
            this._idVerts[o + 2] = u;
            this._idVerts[o + 3] = w;
          }
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._idVerts);
      gl.bindVertexArray(this.vao);
      gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
    }

    _drawWave(gl, audio, cfg, base) {
      const wave = audio.timeBytes;
      if (!wave || wave.length < 8) return;
      const P = this.preset;
      const N = Math.min(512, wave.length);
      const d = this.lineData;
      const r = P.get('wave_r');
      const g = P.get('wave_g');
      const b = P.get('wave_b');
      const a = P.get('wave_a');
      const cr = r || 1;
      const cg = g || 1;
      const cb = b || 1;
      const ca = a > 0 ? Math.min(1, a) : 0.65;
      const amp = 0.4;
      for (let i = 0; i < N; i++) {
        const f = i / (N - 1);
        const s = (wave[Math.floor((i * wave.length) / N)] - 128) / 128;
        const o = i * 6;
        d[o] = f * 2 - 1;
        d[o + 1] = s * amp;
        d[o + 2] = cr;
        d[o + 3] = cg;
        d[o + 4] = cb;
        d[o + 5] = ca;
      }
      gl.useProgram(this.lineProg);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, d);
      gl.bindVertexArray(this.lineVao);
      gl.drawArrays(gl.LINE_STRIP, 0, N);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
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
        if (this.vbo) gl.deleteBuffer(this.vbo);
        if (this.ibo) gl.deleteBuffer(this.ibo);
        if (this.vao) gl.deleteVertexArray(this.vao);
        if (this.lineVbo) gl.deleteBuffer(this.lineVbo);
        if (this.lineVao) gl.deleteVertexArray(this.lineVao);
        if (this.prog) gl.deleteProgram(this.prog);
        if (this.lineProg) gl.deleteProgram(this.lineProg);
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
    'decay=0.960',
    'fGammaAdj=1.400',
    'wave_r=0.85',
    'wave_g=0.60',
    'wave_b=1.00',
    'wave_a=0.70',
    'per_frame_1=q1 = bass_att;',
    'per_frame_2=q2 = treb_att;',
    'per_frame_3=zoom = 1.008 + 0.010*sin(time*0.61) + q1*0.010;',
    'per_frame_4=rot = 0.012*sin(time*0.31) + q2*0.004;',
    'per_frame_5=warp = 0.30 + q1*0.55;',
    'per_frame_6=cx = 0.5 + 0.04*sin(time*0.23);',
    'per_frame_7=cy = 0.5 + 0.04*cos(time*0.19);',
    'per_pixel_1=zoom = zoom + 0.020*sin(rad*7.0 - time*1.7);',
    'per_pixel_2=rot = rot + 0.020*sin(ang*3.0 + time*0.5)*rad;',
    'per_pixel_3=dx = 0.0016*cos(ang*5.0 + time*0.9);',
    'per_pixel_4=dy = 0.0016*sin(ang*4.0 - time*0.7);',
  ].join('\n');

  window.SVModes = window.SVModes || {};
  window.SVModes.milkdrop = MilkdropMode;
  window.SVMilkdropDefault = DEFAULT_PRESET;
})();
