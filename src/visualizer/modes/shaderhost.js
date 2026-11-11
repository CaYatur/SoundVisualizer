/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Studio shader motoru (WebGL2).

   Kullanıcının yazdığı fragment shader'ı çalıştırır. Giriş noktası Shadertoy
   ile aynıdır — mainImage(out vec4 fragColor, in vec2 fragCoord) — böylece
   internetteki hazır kodlar neredeyse olduğu gibi çalışır.

   Neden ayrı bir tuvale çiziyor: mevcut mod sözleşmesi her moda bir 2D bağlam
   veriyor (görselleştirici penceresi, panel önizlemesi ve çevrimdışı dışa
   aktarıcı üçü de öyle). Bir tuval hem 2D hem WebGL olamaz. Bu yüzden shader
   kendi tuvaline çizer, sonucu drawImage ile 2D bağlama basılır: katman
   sıralaması, saydamlık ve dışa aktarma tek satır değişiklik olmadan çalışır.

   Sağlanan ekler (Shadertoy'da olmayan):
     sv_level / sv_bass / sv_mid / sv_treble / sv_beat
     sv_spec(x)    — 0..1 konumunda logaritmik spektrum değeri
     sv_waveAt(x)  — dalga formu (-1..1)
     sv_col(x)     — kullanıcının 5 renkli paletinden renk
     sv_prev       — bir önceki kare (geri besleme; iChannel2)
     sv_media      — web kamerası / video katmanı (iChannel3) */
(function () {
  const TEX_W = 512;

  const VERT = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

  // Kullanıcı kodundan ÖNCE gelen sabit bölüm. Satır sayısı, derleyici hata
  // satırlarını kullanıcı koduna geri eşlemek için sayılır.
  const PRELUDE = `#version 300 es
precision highp float;
precision highp int;
out vec4 sv_fragOut;

uniform vec3  iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform int   iFrame;
uniform vec4  iMouse;
uniform sampler2D sv_spectrum;
uniform sampler2D sv_wave;
uniform sampler2D sv_prev;
uniform sampler2D sv_media;
uniform float sv_level;
uniform float sv_bass;
uniform float sv_mid;
uniform float sv_treble;
uniform float sv_beat;
uniform vec3  sv_palette[5];

#define sv_time iTime
#define sv_resolution iResolution.xy
#define iChannel0 sv_spectrum
#define iChannel1 sv_wave
#define iChannel2 sv_prev
#define iChannel3 sv_media
#define texture2D texture

float sv_spec(float x){ return texture(sv_spectrum, vec2(clamp(x, 0.0, 1.0), 0.5)).r; }
float sv_waveAt(float x){ return texture(sv_wave, vec2(clamp(x, 0.0, 1.0), 0.5)).r * 2.0 - 1.0; }
vec3 sv_col(float x){
  float f = clamp(x, 0.0, 0.99999) * 4.0;
  int i = int(floor(f));
  return mix(sv_palette[i], sv_palette[min(i + 1, 4)], f - float(i));
}
vec3 sv_hueRotate(vec3 c, float a){
  const vec3 k = vec3(0.57735026);
  float cs = cos(a);
  return c * cs + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cs);
}
`;

  const EPILOGUE = `
void main(){
  vec4 c = vec4(0.0, 0.0, 0.0, 1.0);
  mainImage(c, gl_FragCoord.xy);
  sv_fragOut = c;
}`;

  const COPY_FRAG = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uTex;
uniform vec2 uSize;
void main(){ o = texture(uTex, gl_FragCoord.xy / uSize); }`;

  /* ÇOK GEÇİŞLİ SHADER (#905). Kod bölüm işaretleriyle bölünüyor:
       //@common              — her geçişin başına eklenen ortak işlevler
       //@pass A [channels=…] — A, B, C, D tamponları (en çok dört), bu sırayla çiziliyor
       //@pass image [channels=…] — ekrana giden geçiş (zorunlu)
     İşaret yoksa kod eskisi gibi tek geçiş: eski presetler ve dışa aktarım aynı kalıyor.
     Her tampon kendi ping-pong çiftinde, ondalıklı (destekleniyorsa RGBA16F); önceki karesi
     korunuyor. Bir geçiş, kendinden ÖNCE çizilen tamponun bu karesini, kendisini ve sonrakilerin
     önceki karesini okuyor. Örnekleyiciler: sv_bufA…sv_bufD; `channels=` iChannel0…3'ü bağlıyor
     (spectrum, wave, prev, media, A–D; varsayılan spectrum, wave, prev, media). Tampon
     geçişinde sv_prev / `prev` o tamponun kendi önceki karesi. */
  const PASS_IDS = ['A', 'B', 'C', 'D'];
  const CHANNEL_DEFAULT = ['spectrum', 'wave', 'prev', 'media'];
  const CHANNEL_OK = ['spectrum', 'wave', 'prev', 'media', 'A', 'B', 'C', 'D'];
  const MARK = /^\s*\/\/\s*@(common|pass)\b(.*)$/i;

  function splitPasses(text) {
    const src = String(text || '').replace(/\r\n/g, '\n');
    if (!/^\s*\/\/\s*@(common|pass)\b/im.test(src)) return null;
    const lines = src.split('\n');
    const out = { common: [], passes: [], image: null, error: null };
    const fail = (message, line) => { if (!out.error) out.error = { message, line }; };
    const seen = new Set();
    // İlk işaretten önceki satırlar (açıklama, ortak tanım) ortak bölüm sayılıyor
    let cur = { kind: 'common', start: 1, body: [] };
    const flush = () => {
      if (!cur) return;
      const code = cur.body.join('\n');
      if (cur.kind === 'common') { if (code.trim()) out.common.push({ code, line: cur.start }); }
      else if (cur.id === 'image') out.image = { code, channels: cur.channels, line: cur.start };
      else out.passes.push({ id: cur.id, code, channels: cur.channels, line: cur.start });
    };
    for (let i = 0; i < lines.length; i++) {
      const m = MARK.exec(lines[i]);
      if (!m) { if (cur) cur.body.push(lines[i]); continue; }
      flush();
      const kind = m[1].toLowerCase();
      const rest = m[2].trim();
      if (kind === 'common') { cur = { kind, start: i + 2, body: [] }; continue; }
      const nm = /^(image|[A-Da-d])\b/i.exec(rest);
      if (!nm) { fail('Geçiş adı A, B, C, D ya da image olmalı.', i + 1); cur = null; continue; }
      const id = nm[1].length === 1 ? nm[1].toUpperCase() : 'image';
      if (seen.has(id)) fail('Aynı geçiş iki kez tanımlanmış.', i + 1);
      seen.add(id);
      let channels = null;
      const ch = /channels\s*=\s*([A-Za-z,\s]+)/i.exec(rest);
      if (ch) {
        channels = ch[1].split(',').map((x) => x.trim()).filter(Boolean).slice(0, 4)
          .map((x) => (/^[a-d]$/i.test(x) ? x.toUpperCase() : x.toLowerCase() === 'self' ? 'prev' : x.toLowerCase()));
        const bad = channels.find((x) => CHANNEL_OK.indexOf(x) < 0);
        if (bad) fail('Bilinmeyen kanal; kullanılabilenler: spectrum, wave, prev, media, A, B, C, D.', i + 1);
      }
      cur = { kind: 'pass', id, channels, start: i + 2, body: [] };
    }
    flush();
    if (!out.image) fail('Görüntü geçişi yok: //@pass image bölümü ekleyin.', 0);
    out.passes.sort((a, b) => PASS_IDS.indexOf(a.id) - PASS_IDS.indexOf(b.id));
    return out;
  }

  // Geçişin iChannel0…3 bağları
  function channelsOf(list) {
    const ch = Array.isArray(list) ? list.slice(0, 4) : [];
    for (let i = ch.length; i < 4; i++) ch[i] = CHANNEL_DEFAULT[i];
    return ch;
  }
  const samplerOf = (c) => (c === 'spectrum' ? 'sv_spectrum' : c === 'wave' ? 'sv_wave' : c === 'media' ? 'sv_media' : c === 'prev' ? 'sv_prev' : 'sv_buf' + c);

  const PRELUDE_MP = PRELUDE.replace(/#define iChannel[0-3] \w+\n/g, '') +
    'uniform sampler2D sv_bufA;\nuniform sampler2D sv_bufB;\nuniform sampler2D sv_bufC;\nuniform sampler2D sv_bufD;\n';

  function passSource(mp, pass, decls) {
    let s = PRELUDE_MP + decls;
    channelsOf(pass.channels).forEach((c, i) => { s += '#define iChannel' + i + ' ' + samplerOf(c) + '\n'; });
    for (const c of mp.common) s += '#line ' + c.line + '\n' + c.code + '\n';
    return s + '#line ' + pass.line + '\n' + pass.code + EPILOGUE;
  }

  // Görüntü geçişi önceki kareyi okuyor mu (geri besleme tamponu gerekiyor mu)
  function imageNeedsPrev(img) {
    const code = String(img.code || '');
    if (/\bsv_prev\b/.test(code)) return true;
    return channelsOf(img.channels).some((c, i) => c === 'prev' && new RegExp('\\biChannel' + i + '\\b').test(code));
  }

  function countLines(s) {
    let n = 1;
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
    return n;
  }

  class ShaderHost {
    constructor(opts) {
      const o = opts || {};
      this.canvas = document.createElement('canvas');
      this.canvas.width = 2;
      this.canvas.height = 2;
      this.gl = null;
      this.program = null;
      this.copyProgram = null;
      this.loc = {};
      this.source = null;
      this.error = null;
      this.needsFeedback = false;
      this.frame = 0;
      this.beat = 0;
      this._beatAvg = 0;
      this._lineOffset = 0;
      this.media = null;
      this.transparent = o.transparent !== false;
      this._fbo = [null, null];
      this._fboTex = [null, null];
      this._fboSize = [0, 0];
      this._pingpong = 0;
      this._init();
    }

    _init() {
      const gl = this.canvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: false, // shader düz (straight) alfa üretir
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      });
      if (!gl) {
        this.error = { message: 'WebGL2 kullanılamıyor. Sürücü güncellemesi gerekebilir.' };
        return;
      }
      this.gl = gl;

      const quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      this._quad = quad;

      this.texSpectrum = this._dataTex(TEX_W);
      this.texWave = this._dataTex(TEX_W);
      this.texMedia = this._blankTex();
      this.specBuf = new Uint8Array(TEX_W);
      this.waveBuf = new Uint8Array(TEX_W);

      this.copyProgram = this._link(VERT, COPY_FRAG);
    }

    _dataTex(w) {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(w));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }

    _blankTex() {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }

    _compile(type, src) {
      const gl = this.gl;
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh) || 'bilinmeyen derleme hatası';
        gl.deleteShader(sh);
        return { ok: false, log };
      }
      return { ok: true, shader: sh };
    }

    _link(vs, fs) {
      const gl = this.gl;
      const v = this._compile(gl.VERTEX_SHADER, vs);
      if (!v.ok) return null;
      const f = this._compile(gl.FRAGMENT_SHADER, fs);
      if (!f.ok) { gl.deleteShader(v.shader); return null; }
      const p = gl.createProgram();
      gl.attachShader(p, v.shader);
      gl.attachShader(p, f.shader);
      gl.bindAttribLocation(p, 0, 'aPos');
      gl.linkProgram(p);
      gl.deleteShader(v.shader);
      gl.deleteShader(f.shader);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        gl.deleteProgram(p);
        return null;
      }
      return p;
    }

    // Kullanıcı kontrollerinden uniform bildirimleri üretir
    _paramDecls(controls) {
      let out = '';
      for (const c of controls || []) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.name)) continue;
        if (c.type === 'color') out += `uniform vec3 ${c.name};\n`;
        else if (c.type === 'toggle') out += `uniform bool ${c.name};\n`;
        else out += `uniform float ${c.name};\n`;
      }
      return out;
    }

    /* Kaynağı derler. Dönüş: { ok, error: { message, line } }
       line = kullanıcı kodundaki 1 tabanlı satır (önsöz satırları düşülmüş). */
    setSource(userCode, controls) {
      const gl = this.gl;
      if (!gl) return { ok: false, error: this.error };
      const mp = splitPasses(userCode);
      if (mp) return this._setMulti(mp, controls);
      const decls = this._paramDecls(controls);
      const full = PRELUDE + decls + '#line 1\n' + String(userCode || '') + EPILOGUE;
      const key = full;
      this._dropJob();
      if (this.source === key && this.program) return { ok: true };

      const offset = 0; // #line 1 sayesinde derleyici kullanıcı satırını bildirir
      const f = this._compile(gl.FRAGMENT_SHADER, full);
      if (!f.ok) {
        this.error = parseLog(f.log, offset);
        return { ok: false, error: this.error };
      }
      const v = this._compile(gl.VERTEX_SHADER, VERT);
      if (!v.ok) { gl.deleteShader(f.shader); return { ok: false, error: { message: v.log } }; }

      const p = gl.createProgram();
      gl.attachShader(p, v.shader);
      gl.attachShader(p, f.shader);
      gl.bindAttribLocation(p, 0, 'aPos');
      gl.linkProgram(p);
      gl.deleteShader(v.shader);
      gl.deleteShader(f.shader);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(p) || 'bağlama hatası';
        gl.deleteProgram(p);
        this.error = { message: log, line: 0 };
        return { ok: false, error: this.error };
      }

      this._install(p, key, userCode);
      return { ok: true };
    }

    _install(p, key, userCode) {
      this._dropMulti();
      if (this.program) this.gl.deleteProgram(this.program);
      this.program = p;
      this.source = key;
      this.error = null;
      this._lineOffset = 0;
      this.loc = {};
      this.needsFeedback = /sv_prev|iChannel2/.test(String(userCode || ''));
      this.frame = 0;
    }

    /* ÇİZİMİ BEKLETMEDEN DERLEME (#907, gl-link.js). Eski program bitene kadar
       çizmeye devam ediyor. Dönüş `setSource` gibi; henüz bitmediyse null.
       Çevrimdışı işte ve uzantı yoksa `setSource`un kendisi: bekler. */
    beginSource(userCode, controls) {
      const gl = this.gl;
      if (!gl) return { ok: false, error: this.error };
      const L = window.SVGlLink;
      if (!L || !L.canWait(gl)) return this.setSource(userCode, controls);
      const mp = splitPasses(userCode);
      if (mp) {
        if (mp.error) { this._dropJob(); this.error = mp.error; return { ok: false, error: mp.error }; }
        const list = this._multiSources(mp, controls);
        const key = list.map((x) => x.src).join('\u0000');
        if (this._job && this._job.key === key) return null;
        this._dropJob();
        if (this.source === key && this.program) return { ok: true };
        this._job = { key, mp, multi: list.map((x) => ({ id: x.id, h: L.begin(gl, VERT, x.src, ['aPos']) })) };
        return null;
      }
      const full = PRELUDE + this._paramDecls(controls) + '#line 1\n' + String(userCode || '') + EPILOGUE;
      if (this._job && this._job.key === full) return null;
      this._dropJob();
      if (this.source === full && this.program) return { ok: true };
      this._job = { key: full, userCode, h: L.begin(gl, VERT, full, ['aPos']) };
      return null;
    }

    pollSource() {
      const j = this._job;
      const gl = this.gl;
      if (j && gl && j.multi) return this._pollMulti(j);
      if (!j || !gl || !window.SVGlLink.ready(gl, j.h)) return null;
      this._job = null;
      const r = window.SVGlLink.end(gl, j.h);
      if (!r.ok) {
        this.error = r.stage === 'link' ? { message: r.log, line: 0 } : parseLog(r.log, 0);
        return { ok: false, error: this.error };
      }
      this._install(r.prog, j.key, j.userCode);
      return { ok: true };
    }

    _dropJob() {
      if (this._job && this.gl) {
        if (this._job.multi) this._job.multi.forEach((x) => window.SVGlLink.drop(this.gl, x.h));
        else window.SVGlLink.drop(this.gl, this._job.h);
      }
      this._job = null;
    }

    // --- çok geçişli: derleme ve kurulum ---
    _multiSources(mp, controls) {
      const decls = this._paramDecls(controls);
      const list = mp.passes.map((p) => ({ id: p.id, src: passSource(mp, p, decls) }));
      list.push({ id: 'image', src: passSource(mp, mp.image, decls) });
      return list;
    }

    _linkFull(full) {
      const gl = this.gl;
      const f = this._compile(gl.FRAGMENT_SHADER, full);
      if (!f.ok) return { ok: false, error: parseLog(f.log, 0) };
      const v = this._compile(gl.VERTEX_SHADER, VERT);
      if (!v.ok) { gl.deleteShader(f.shader); return { ok: false, error: { message: v.log, line: 0 } }; }
      const p = gl.createProgram();
      gl.attachShader(p, v.shader);
      gl.attachShader(p, f.shader);
      gl.bindAttribLocation(p, 0, 'aPos');
      gl.linkProgram(p);
      gl.deleteShader(v.shader);
      gl.deleteShader(f.shader);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(p) || 'bağlama hatası';
        gl.deleteProgram(p);
        return { ok: false, error: { message: log, line: 0 } };
      }
      return { ok: true, prog: p };
    }

    _setMulti(mp, controls) {
      const gl = this.gl;
      this._dropJob();
      if (mp.error) { this.error = mp.error; return { ok: false, error: mp.error }; }
      const list = this._multiSources(mp, controls);
      const key = list.map((x) => x.src).join('\u0000');
      if (this.source === key && this.program) return { ok: true };
      const progs = {};
      for (const it of list) {
        const r = this._linkFull(it.src);
        if (!r.ok) {
          for (const k in progs) gl.deleteProgram(progs[k]);
          this.error = Object.assign({ pass: it.id }, r.error);
          return { ok: false, error: this.error };
        }
        progs[it.id] = r.prog;
      }
      this._installMulti(progs, key, mp);
      return { ok: true };
    }

    _pollMulti(j) {
      const gl = this.gl;
      const L = window.SVGlLink;
      if (!j.multi.every((x) => L.ready(gl, x.h))) return null;
      this._job = null;
      const progs = {};
      let err = null;
      for (const x of j.multi) {
        const r = L.end(gl, x.h);
        if (r.ok) { progs[x.id] = r.prog; continue; }
        if (!err) err = Object.assign({ pass: x.id }, r.stage === 'link' ? { message: r.log, line: 0 } : parseLog(r.log, 0));
      }
      if (err) {
        for (const k in progs) gl.deleteProgram(progs[k]);
        this.error = err;
        return { ok: false, error: err };
      }
      this._installMulti(progs, j.key, j.mp);
      return { ok: true };
    }

    _installMulti(progs, key, mp) {
      this._dropMulti();
      if (this.program) this.gl.deleteProgram(this.program);
      this.program = progs.image;
      this.source = key;
      this.error = null;
      this._lineOffset = 0;
      this.loc = {};
      this.needsFeedback = imageNeedsPrev(mp.image);
      this.frame = 0;
      this._mp = mp.passes.map((p) => ({ id: p.id, prog: progs[p.id], loc: {}, fbo: null, tex: null, w: 0, h: 0, cur: 0 }));
    }

    _dropMulti() {
      const gl = this.gl;
      const mp = this._mp;
      this._mp = null;
      if (!mp || !gl) return;
      for (const p of mp) {
        if (p.prog) gl.deleteProgram(p.prog);
        if (p.fbo) for (let i = 0; i < 2; i++) { gl.deleteFramebuffer(p.fbo[i]); gl.deleteTexture(p.tex[i]); }
      }
    }

    // Tampon biçimi: durum saklayan geçişler için ondalıklı, yoksa 8 bit
    _bufFormat() {
      if (this._bufFmt) return this._bufFmt;
      const gl = this.gl;
      this._bufFmt = gl.getExtension('EXT_color_buffer_float')
        ? { internal: gl.RGBA16F, type: gl.HALF_FLOAT }
        : { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE };
      return this._bufFmt;
    }

    /* Tamponlar çizim boyunda; boyut değişince içerik taşınıyor (uyarlanır çözünürlük
       basamağında tamponda saklanan durum sıfırlanmasın, #453). */
    _ensureBufs(W, H) {
      const gl = this.gl;
      const fmt = this._bufFormat();
      for (const p of this._mp) {
        if (p.fbo && p.w === W && p.h === H) continue;
        const old = p.fbo ? { fbo: p.fbo, tex: p.tex, w: p.w, h: p.h } : null;
        p.fbo = [];
        p.tex = [];
        for (let i = 0; i < 2; i++) {
          const tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, W, H, 0, gl.RGBA, fmt.type, null);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          const fb = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          p.fbo[i] = fb;
          p.tex[i] = tex;
        }
        if (old) {
          for (let i = 0; i < 2; i++) {
            try {
              gl.bindFramebuffer(gl.READ_FRAMEBUFFER, old.fbo[i]);
              gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, p.fbo[i]);
              gl.blitFramebuffer(0, 0, old.w, old.h, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.LINEAR);
            } catch (e) { /* olmazsa boş başlar */ }
            gl.deleteFramebuffer(old.fbo[i]);
            gl.deleteTexture(old.tex[i]);
          }
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
        } else {
          p.cur = 0;
        }
        p.w = W;
        p.h = H;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // sv_bufA…D, birim 4…7: o anki son kare (bu karede çizildiyse yenisi, değilse öncekisi)
    _bindBufs(u) {
      const gl = this.gl;
      PASS_IDS.forEach((id, i) => {
        const q = this._mp.find((x) => x.id === id);
        gl.activeTexture(gl.TEXTURE4 + i);
        gl.bindTexture(gl.TEXTURE_2D, q && q.tex ? q.tex[q.cur] : this.texMedia);
        const loc = u('sv_buf' + id);
        if (loc) gl.uniform1i(loc, 4 + i);
      });
    }

    _renderBufs(W, H, frame) {
      const gl = this.gl;
      this._ensureBufs(W, H);
      for (const p of this._mp) {
        const u = (name) => { if (!(name in p.loc)) p.loc[name] = gl.getUniformLocation(p.prog, name); return p.loc[name]; };
        const write = 1 - p.cur;
        gl.useProgram(p.prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._quad);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        // Tampon geçişinde sv_prev: kendi önceki karesi
        frame(u, p.tex[p.cur]);
        this._bindBufs(u);
        gl.bindFramebuffer(gl.FRAMEBUFFER, p.fbo[write]);
        gl.viewport(0, 0, W, H);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        p.cur = write;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    _u(name) {
      if (!(name in this.loc)) this.loc[name] = this.gl.getUniformLocation(this.program, name);
      return this.loc[name];
    }

    setMedia(videoEl) { this.media = videoEl || null; }

    resize(w, h) {
      const W = Math.max(2, w | 0);
      const H = Math.max(2, h | 0);
      /* Kalıcı tamponlar burada bırakılmıyor: _ensureFbos yeni boyutu kurarken eski içeriği
         taşıyor (#453, uyarlanır çözünürlük basamağında geri besleme sıfırlanmasın). */
      if (this.canvas.width !== W || this.canvas.height !== H) {
        this.canvas.width = W;
        this.canvas.height = H;
      }
    }

    _releaseFbos() {
      const gl = this.gl;
      if (!gl) return;
      for (let i = 0; i < 2; i++) {
        if (this._fbo[i]) gl.deleteFramebuffer(this._fbo[i]);
        if (this._fboTex[i]) gl.deleteTexture(this._fboTex[i]);
        this._fbo[i] = null;
        this._fboTex[i] = null;
      }
      this._fboSize = [0, 0];
    }

    _ensureFbos(W, H) {
      const gl = this.gl;
      if (this._fbo[0] && this._fboSize[0] === W && this._fboSize[1] === H) return;
      const old = this._fbo[0] ? { fbo: this._fbo.slice(), tex: this._fboTex.slice(), w: this._fboSize[0], h: this._fboSize[1] } : null;
      if (old) { this._fbo = [null, null]; this._fboTex = [null, null]; }
      this._releaseFbos();
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
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        this._fbo[i] = fb;
        this._fboTex[i] = tex;
      }
      if (old) {
        // Önceki içerik yeni boyuta: Studio geri beslemesi boyut değişiminde baştan başlamasın
        for (let i = 0; i < 2; i++) {
          try {
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, old.fbo[i]);
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._fbo[i]);
            gl.blitFramebuffer(0, 0, old.w, old.h, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.LINEAR);
          } catch (e) { /* olmazsa boş başlar */ }
          gl.deleteFramebuffer(old.fbo[i]);
          gl.deleteTexture(old.tex[i]);
        }
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this._fboSize = [W, H];
    }

    _uploadAudio(audio) {
      const gl = this.gl;
      if (!audio || !audio.getBars) return;
      const bars = audio.getBars(TEX_W, 20, 20000);
      const sb = this.specBuf;
      for (let i = 0; i < TEX_W; i++) sb[i] = Math.min(255, (bars[i] * 255) | 0);
      gl.bindTexture(gl.TEXTURE_2D, this.texSpectrum);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TEX_W, 1, gl.RED, gl.UNSIGNED_BYTE, sb);

      const time = audio.timeBytes;
      const wb = this.waveBuf;
      const stride = time.length / TEX_W;
      for (let i = 0; i < TEX_W; i++) wb[i] = time[(i * stride) | 0];
      gl.bindTexture(gl.TEXTURE_2D, this.texWave);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TEX_W, 1, gl.RED, gl.UNSIGNED_BYTE, wb);
    }

    _uploadMedia() {
      const gl = this.gl;
      const v = this.media;
      if (!v || v.readyState < 2 || !v.videoWidth) return;
      gl.bindTexture(gl.TEXTURE_2D, this.texMedia);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
      } catch { /* kare henüz hazır değil */ }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    }

    _setParams(controls, values, u) {
      const gl = this.gl;
      const at = u || ((name) => this._u(name));
      for (const c of controls || []) {
        const loc = at(c.name);
        if (!loc) continue;
        const val = values && c.name in values ? values[c.name] : c.default;
        if (c.type === 'color') {
          const rgb = window.SV.hexToRgb01(typeof val === 'string' ? val : '#ffffff');
          gl.uniform3f(loc, rgb[0], rgb[1], rgb[2]);
        } else if (c.type === 'toggle') {
          gl.uniform1i(loc, val ? 1 : 0);
        } else {
          gl.uniform1f(loc, +val || 0);
        }
      }
    }

    /* Bir kare çizer. Sonuç this.canvas üzerindedir.
       preset: { shader, controls }  values: kullanıcı parametre değerleri */
    render(audio, cfg, t, dt, controls, values) {
      const gl = this.gl;
      if (!gl || !this.program) return false;
      const W = this.canvas.width;
      const H = this.canvas.height;

      // vuruş enerjisi (shader'lara sv_beat olarak verilir)
      const bass = audio ? audio.bass : 0;
      this._beatAvg = this._beatAvg * 0.94 + bass * 0.06;
      const over = bass - (this._beatAvg * 1.25 + 0.03);
      this.beat = Math.max(0, this.beat - (dt || 0.016) * 3.2);
      if (over > 0) this.beat = Math.min(1, Math.max(this.beat, over * 4 + 0.25));

      this._uploadAudio(audio);
      this._uploadMedia();

      const useFb = this.needsFeedback;
      if (useFb) this._ensureFbos(W, H);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);

      // Her geçişin ortak girdileri; `u` geçişin konum önbelleği, `prevTex` sv_prev'e giden doku
      const frame = (u, prevTex) => {
      gl.uniform3f(u('iResolution'), W, H, 1);
      gl.uniform1f(u('iTime'), t);
      gl.uniform1f(u('iTimeDelta'), dt || 0.016);
      gl.uniform1i(u('iFrame'), this.frame);
      gl.uniform4f(u('iMouse'), 0, 0, 0, 0);
      gl.uniform1f(u('sv_level'), audio ? audio.level : 0);
      gl.uniform1f(u('sv_bass'), bass);
      gl.uniform1f(u('sv_mid'), audio ? audio.mid : 0);
      gl.uniform1f(u('sv_treble'), audio ? audio.treble : 0);
      gl.uniform1f(u('sv_beat'), this.beat);

      // Studio görselleştiricisinin renk modu paleti değiştirebilir (#883)
      const cols = this.paletteOverride
        || (cfg && cfg.background && cfg.background.gradient && cfg.background.gradient.colors) || [];
      const pal = new Float32Array(15);
      for (let i = 0; i < 5; i++) {
        const c = window.SV.hexToRgb01(cols[i] || cols[cols.length - 1] || '#3aa6ff');
        pal[i * 3] = c[0];
        pal[i * 3 + 1] = c[1];
        pal[i * 3 + 2] = c[2];
      }
      const palLoc = u('sv_palette[0]') || u('sv_palette');
      if (palLoc) gl.uniform3fv(palLoc, pal);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texSpectrum);
      gl.uniform1i(u('sv_spectrum'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.texWave);
      gl.uniform1i(u('sv_wave'), 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, prevTex);
      gl.uniform1i(u('sv_prev'), 2);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.texMedia);
      gl.uniform1i(u('sv_media'), 3);

      this._setParams(controls, values, u);
      };

      // Çok geçişli: önce tamponlar, sırayla
      if (this._mp) this._renderBufs(W, H, frame);

      gl.useProgram(this.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._quad);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.viewport(0, 0, W, H);
      frame((name) => this._u(name), useFb ? this._fboTex[this._pingpong] : this.texMedia);
      if (this._mp) this._bindBufs((name) => this._u(name));

      if (useFb) {
        const write = 1 - this._pingpong;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo[write]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        // sonucu ekrana kopyala
        gl.useProgram(this.copyProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._quad);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fboTex[write]);
        gl.uniform1i(gl.getUniformLocation(this.copyProgram, 'uTex'), 0);
        gl.uniform2f(gl.getUniformLocation(this.copyProgram, 'uSize'), W, H);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this._pingpong = write;
      } else {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }

      this.frame++;
      return true;
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
      this._dropJob();
      this._dropMulti();
      this._releaseFbos();
      if (this.program) gl.deleteProgram(this.program);
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
      this.gl = null;
    }
  }

  // "ERROR: 0:12: 'x' : ..." biçimindeki derleyici günlüğünü ayrıştır
  function parseLog(log, offset) {
    const first = String(log || '').split('\n').find((l) => l.trim());
    const m = /(\d+):(\d+)/.exec(first || '');
    return {
      message: (first || 'Derleme hatası').replace(/^ERROR:\s*/i, '').trim(),
      line: m ? Math.max(1, parseInt(m[2], 10) - offset) : 0,
      full: String(log || ''),
    };
  }

  // ==========================================================================
  // Mod sarmalayıcıları — shader tuvalini 2D bağlama basar
  // ==========================================================================

  function activePreset(cfg, kind) {
    if (!window.SVPresets) return null;
    const id = kind === 'background' ? cfg.custom && cfg.custom.backgroundId : cfg.custom && cfg.custom.visualizerId;
    const p = window.SVPresets.get(id);
    if (p && p.engine === 'shader') return p;
    return null;
  }

  /* STUDIO RENK MODU (#883). Yerleşik Studio shader'larının hepsi rengini
     sv_palette / sv_col()'dan alıyor; palet hep arka plan gradyanından
     doluyordu. Görselleştiricide paletin kaynağı seçilebilir:
       theme   — gradyan (eski davranış, varsayılan);
       custom  — birincil renkten ikincil renge beş durak;
       rainbow — tonu çizim saatiyle kayan beş durak (canlı ve dışa
                 aktarım aynı saati okur).
     Ayrı anahtar (`studioColorMode`): genel `colorMode` başka türlerde
     seçilmiş olabilir; onu okusaydık eski sahnelerin Studio renkleri
     kendiliğinden değişirdi. */
  function hex2(n) { const h = Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16); return h.length < 2 ? '0' + h : h; }
  function rgbHex(r, g, b) { return '#' + hex2(r) + hex2(g) + hex2(b); }
  function hslHex(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return rgbHex(f(0), f(8), f(4));
  }
  function studioPalette(v, t) {
    const mode = (v && v.studioColorMode) || 'theme';
    if (mode === 'custom') {
      const a = window.SV.hexToRgb01(v.color || '#3aa6ff');
      const b = window.SV.hexToRgb01(v.color2 || v.color || '#3aa6ff');
      const out = [];
      for (let i = 0; i < 5; i++) {
        const k = i / 4;
        out.push(rgbHex(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k));
      }
      return out;
    }
    if (mode === 'rainbow') {
      // Barların gökkuşağıyla aynı yol: 320° yayılım, saniyede 12°
      const out = [];
      for (let i = 0; i < 5; i++) out.push(hslHex(((i / 4) * 320 + (t || 0) * 12) % 360, 0.85, 0.58));
      return out;
    }
    return null;
  }

  /* Seçilen presetin derlemesini başlatır ya da bitti mi diye bakar. `shown`
     ekrandaki programın preseti: yenisi hazır olana kadar denetimleri onunku,
     adı tutan farklı türde bir denetim eski programa yanlış değer yazmasın. */
  function followPreset(mode, preset) {
    const id = preset.id + ':' + preset.updatedAt;
    let r;
    if (mode.lastId !== id) {
      mode.lastId = id;
      r = mode.host.beginSource(preset.shader, preset.controls);
    } else {
      r = mode.host.pollSource();
    }
    if (!r) return;
    mode.lastError = r.ok ? null : r.error;
    if (r.ok) mode.shown = preset;
  }

  // Özel görselleştirici (ön katman) — saydam çizer
  class CustomVisualizer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.host = new ShaderHost({ transparent: true });
      this.lastId = null;
      this.lastError = null;
    }
    resize() {}
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      ctx.clearRect(0, 0, W, H);
      const preset = activePreset(cfg, 'visualizer');
      if (!preset) return;
      this.host.resize(W, H);
      followPreset(this, preset);
      if (this.lastError) return;
      const live = this.shown || preset;
      const values = window.SVPresets.paramValues(live, cfg);
      this.host.paletteOverride = studioPalette(cfg.visualizer, t);
      if (this.host.render(audio, cfg, t, dt, live.controls, values)) {
        ctx.drawImage(this.host.canvas, 0, 0, W, H);
      }
    }
    contextLost() { return this.host.contextLost(); }
    dispose() { this.host.dispose(); }
  }
  CustomVisualizer.palette = studioPalette; // test kancası

  // Özel arkaplan — verilen 2D bağlama opak çizer
  class CustomBackground {
    constructor() {
      this.host = new ShaderHost({ transparent: false });
      this.lastId = null;
      this.lastError = null;
    }
    draw(ctx, audio, cfg, t, W, H, dt) {
      const preset = activePreset(cfg, 'background');
      if (!preset) {
        ctx.fillStyle = '#07070d';
        ctx.fillRect(0, 0, W, H);
        return;
      }
      // arkaplanda renderScale uygulanır (performans)
      const rs = Math.max(0.4, Math.min(1, (cfg.power && cfg.power.renderScale) || 1));
      this.host.resize(Math.round(W * rs), Math.round(H * rs));
      followPreset(this, preset);
      ctx.clearRect(0, 0, W, H);
      if (this.lastError) {
        ctx.fillStyle = '#0b0810';
        ctx.fillRect(0, 0, W, H);
        return;
      }
      const live = this.shown || preset;
      const values = window.SVPresets.paramValues(live, cfg);
      if (this.host.render(audio, cfg, t, dt, live.controls, values)) {
        ctx.drawImage(this.host.canvas, 0, 0, W, H);
      }
    }
    // Dynamic Lighting arkaplan rengi isterse: paletin kendisi bildirilir.
    // (gl.readPixels burada GPU hattını bekletirdi; palet zaten shader'ın
    //  renk kaynağı olduğu için pratikte aynı sonucu verir.)
    palette(cfg) {
      const c = (cfg.background && cfg.background.gradient && cfg.background.gradient.colors) || [];
      return c.slice();
    }
    /* Bu sınıfta dispose YOKTU: layers.js arka planı atarken `dispose`
       varsa çağırıyor, yoksa geçiyor — shader sunucusunun WebGL bağlamı
       çöp toplanana kadar etkin kalıyordu. Chromium sınırı aşılınca en
       eski bağlamı, yani ekranda çizen bir katmanınkini kaybettiriyor.
       Ölçüldü: canlı bir bağlam açıkken bu arka plan 40 kez kurulup
       atıldı; 16. atımda canlı bağlam kayboldu. */
    contextLost() { return this.host.contextLost(); }
    dispose() { this.host.dispose(); }
  }

  // ==========================================================================
  // GERİ BESLEME MOTORU (MilkDrop ailesi)
  // Her kare bir önceki kareyi yakınlaştırıp döndürerek ve büzerek çizer,
  // üstüne dalga formunu bindirir. Klasik "sonsuz tünel" görünümü buradan gelir.
  // ==========================================================================
  /* Denetim değişkenleri (uZoom, uDecay…) BURADA BİLDİRİLMEZ: ShaderHost
     onları FEEDBACK_CONTROLS'tan kendisi bildiriyor (_paramDecls). İkisi
     birden "redefinition" ile derlemeyi düşürüyordu ve mod eklendiğinden
     beri hiçbir şey çizmiyordu; README'nin mod kolajında boş kare olarak
     bulundu. */
  const FEEDBACK_SHADER = `
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 res = sv_resolution;
  vec2 uv = fragCoord / res;
  float aspect = res.x / res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);

  float ang = uRotate * 0.06 + sv_bass * uBassRot;
  float zoom = uZoom + sv_bass * uBassZoom;
  float r = length(c);
  ang += uSwirl * 0.12 * (0.35 - r) * (1.0 + sv_mid);

  vec2 p = c;
  p += uWarp * 0.012 * vec2(
    sin(p.y * 7.0 + sv_time * 1.3),
    cos(p.x * 6.0 - sv_time * 1.1)
  ) * (0.5 + sv_bass);

  float s = sin(ang), co = cos(ang);
  p = mat2(co, -s, s, co) * p / max(0.5, zoom);
  p += vec2(uDx, uDy);

  vec2 src = p / vec2(aspect, 1.0) + 0.5;
  vec3 prev = texture(sv_prev, src).rgb * uDecay;
  if (uSharpen > 0.001) {
    vec2 px = 1.0 / res;
    vec3 blur = (
      texture(sv_prev, src + vec2(px.x, 0.0)).rgb +
      texture(sv_prev, src - vec2(px.x, 0.0)).rgb +
      texture(sv_prev, src + vec2(0.0, px.y)).rgb +
      texture(sv_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
    prev += (prev - blur) * uSharpen;
  }

  // --- dalga formu bindirmesi ---
  vec3 add = vec3(0.0);
  float thick = 0.004 * uWaveThick * (1.0 + sv_level);
  int mode = int(uWaveMode + 0.5);
  if (mode == 2) {
    float a = atan(c.y, c.x);
    float w = sv_waveAt(fract(a / 6.2831853 + 0.5));
    float target = 0.18 * (1.0 + sv_level * 0.8) + w * 0.07 * uWaveAmp;
    add = sv_col(fract(a / 6.2831853 + sv_time * 0.05)) * smoothstep(thick * 2.0, 0.0, abs(r - target));
  } else if (mode == 3) {
    float sp = sv_spec(uv.x);
    float target = -0.35 + sp * 0.7 * uWaveAmp;
    add = sv_col(uv.x) * smoothstep(thick * 3.0, 0.0, abs(c.y - target));
  } else if (mode == 1) {
    float w1 = sv_waveAt(uv.x);
    float w2 = sv_waveAt(fract(uv.x + 0.5));
    add = sv_col(0.25) * smoothstep(thick, 0.0, abs(c.y - 0.12 - w1 * 0.16 * uWaveAmp));
    add += sv_col(0.75) * smoothstep(thick, 0.0, abs(c.y + 0.12 - w2 * 0.16 * uWaveAmp));
  } else {
    float w = sv_waveAt(uv.x);
    add = sv_col(fract(uv.x + sv_time * 0.04)) * smoothstep(thick, 0.0, abs(c.y - w * 0.22 * uWaveAmp));
  }
  add *= 0.65 + sv_level * 1.5 + sv_beat * 0.8;

  vec3 col = clamp(prev + add, 0.0, 1.4);
  fragColor = vec4(col, 1.0);
}`;

  const FEEDBACK_CONTROLS = [
    { name: 'uZoom', type: 'slider', default: 1.006 },
    { name: 'uRotate', type: 'slider', default: 0 },
    { name: 'uWarp', type: 'slider', default: 0.55 },
    { name: 'uDecay', type: 'slider', default: 0.965 },
    { name: 'uDx', type: 'slider', default: 0 },
    { name: 'uDy', type: 'slider', default: 0 },
    { name: 'uSwirl', type: 'slider', default: 0.35 },
    { name: 'uWaveMode', type: 'slider', default: 0 },
    { name: 'uWaveAmp', type: 'slider', default: 1 },
    { name: 'uWaveThick', type: 'slider', default: 1 },
    { name: 'uBassZoom', type: 'slider', default: 0.05 },
    { name: 'uBassRot', type: 'slider', default: 0.02 },
    { name: 'uSharpen', type: 'slider', default: 0.25 },
  ];

  const WAVE_MODES = { line: 0, dual: 1, circle: 2, spectrum: 3 };

  class FeedbackMode {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.host = new ShaderHost({ transparent: false });
      this.ready = false;
    }
    resize() {}
    draw(audio, cfg, t, dt) {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      // Geri besleme yüksek çözünürlükte pahalı; yarım ölçekte çizip
      // büyütmek görüntüyü bozmaz (zaten yumuşak bir efekt).
      const rs = Math.max(0.4, Math.min(1, (cfg.power && cfg.power.renderScale) || 1)) * 0.75;
      this.host.resize(Math.round(W * rs), Math.round(H * rs));
      if (!this.ready) {
        const r = this.started ? this.host.pollSource() : this.host.beginSource(FEEDBACK_SHADER, FEEDBACK_CONTROLS);
        this.started = true;
        this.ready = !!(r && r.ok);
        if (!this.ready) return;
      }
      const f = cfg.feedback || {};
      const values = {
        uZoom: f.zoom, uRotate: f.rotate, uWarp: f.warp, uDecay: f.decay,
        uDx: f.dx, uDy: f.dy, uSwirl: f.swirl,
        uWaveMode: WAVE_MODES[f.waveMode] == null ? 0 : WAVE_MODES[f.waveMode],
        uWaveAmp: f.waveAmp, uWaveThick: f.waveThickness,
        uBassZoom: f.bassZoom, uBassRot: f.bassRotate, uSharpen: f.sharpen,
      };
      ctx.clearRect(0, 0, W, H);
      if (this.host.render(audio, cfg, t, dt, FEEDBACK_CONTROLS, values)) {
        ctx.drawImage(this.host.canvas, 0, 0, W, H);
      }
    }
    contextLost() { return this.host.contextLost(); }
    dispose() { this.host.dispose(); }
  }

  window.SVShaderHost = ShaderHost;
  window.SVShaderPasses = { splitPasses, passSource, channelsOf, imageNeedsPrev, PRELUDE_MP };
  window.SVModes = window.SVModes || {};
  window.SVModes.custom = CustomVisualizer;
  window.SVModes.feedback = FeedbackMode;
  window.SVBackgrounds = window.SVBackgrounds || {};
  window.SVBackgrounds.custom = CustomBackground;
})();
