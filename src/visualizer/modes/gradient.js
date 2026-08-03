'use strict';
/* Akışkan mesh-gradyan / sis arkaplan (WebGL fragment shader).
   Sese tepki verir: bas akış genliğini ve parlaklığı artırır. */
(function () {
  const VERT = `
    attribute vec2 aPos;
    void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
  `;

  const FRAG = `
    precision highp float;
    uniform vec2  uResolution;
    uniform float uTime;
    uniform vec3  uColors[5];
    uniform float uFlow;
    uniform float uDrift;
    uniform float uWander;
    uniform float uOrbit;
    uniform float uSwirl;
    uniform float uScale;
    uniform float uWarp;
    uniform float uAudio;
    uniform float uLevel;
    uniform float uReact;
    uniform float uBrightness;
    uniform float uAudioBright;
    uniform float uHueAngle;
    uniform float uSoft;       // 1 = yumuşak (parlamasız), 0 = plazma
    uniform float uHideLines;  // 1 = damar/şimşek çizgilerini yumuşat
    uniform float uGrain;
    uniform float uVignette;

    vec3 hueRotate(vec3 c, float a){
      const vec3 k = vec3(0.57735026);
      float cs = cos(a);
      return c*cs + cross(k, c)*sin(a) + k*dot(k, c)*(1.0 - cs);
    }

    float hash(vec2 p){
      p = fract(p*vec2(123.34,456.21));
      p += dot(p, p+45.32);
      return fract(p.x*p.y);
    }
    float vnoise(vec2 p){
      vec2 i = floor(p); vec2 f = fract(p);
      float a = hash(i);
      float b = hash(i+vec2(1.0,0.0));
      float c = hash(i+vec2(0.0,1.0));
      float d = hash(i+vec2(1.0,1.0));
      vec2 u = f*f*(3.0-2.0*f);
      return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
    }
    float fbm(vec2 p){
      float v = 0.0, a = 0.5;
      mat2 m = mat2(1.6,1.2,-1.2,1.6);
      for(int i=0;i<5;i++){ v += a*vnoise(p); p = m*p; a *= 0.5; }
      return v;
    }
    mat2 rot(float a){
      float s = sin(a), c = cos(a);
      return mat2(c, -s, s, c);
    }
    vec3 ramp(float t){
      t = clamp(t,0.0,1.0);
      float x = t*4.0;
      vec3 c = uColors[0];
      float h = clamp(uHideLines, 0.0, 1.0);
      float a0 = mix(clamp(x-0.0, 0.0, 1.0), smoothstep(0.0, 1.0, x-0.0), h);
      float a1 = mix(clamp(x-1.0, 0.0, 1.0), smoothstep(0.0, 1.0, x-1.0), h);
      float a2 = mix(clamp(x-2.0, 0.0, 1.0), smoothstep(0.0, 1.0, x-2.0), h);
      float a3 = mix(clamp(x-3.0, 0.0, 1.0), smoothstep(0.0, 1.0, x-3.0), h);
      c = mix(c, uColors[1], a0);
      c = mix(c, uColors[2], a1);
      c = mix(c, uColors[3], a2);
      c = mix(c, uColors[4], a3);
      return c;
    }
    void main(){
      vec2 frag = gl_FragCoord.xy;
      vec2 p = (frag - 0.5*uResolution) / uResolution.y;
      float t = uFlow;                 // sese göre hızlanan akış zamanı
      float audio = uAudio*uReact;
      float hideLines = clamp(uHideLines, 0.0, 1.0);
      float drift = clamp(uDrift, 0.0, 1.0);
      float wander = clamp(uWander, 0.0, 2.0);
      float orbit = clamp(uOrbit, 0.0, 2.0);
      float swirl = clamp(uSwirl, 0.0, 2.0);
      // yumuşak modda: daha büyük bloblar (düşük frekans) ve çok az kıvrım -> damar/parlama yok
      float sc = uScale * mix(mix(1.0, 0.55, uSoft), 0.48, hideLines);
      float warp = uWarp*(1.0 + audio*1.8) * mix(1.0, 0.20, uSoft) * mix(1.0, 0.34, hideLines);
      float radius = length(p);
      float spin = (sin(t*0.42 + radius*3.8) + cos(t*0.27 - radius*2.9)*0.55) * swirl;
      vec2 mp = rot(spin*0.45) * p;
      vec2 wanderPath = vec2(
        sin(t*0.23) + cos(t*0.13 + 1.7)*0.55,
        cos(t*0.19 - 0.4) - sin(t*0.29)*0.45
      ) * (0.26*wander);
      vec2 driftPath = vec2(-0.16, 0.12) * t * drift;
      vec2 travel = wanderPath + driftPath;
      vec2 orbitA = vec2(cos(t*0.53), sin(t*0.47)) * orbit;
      vec2 orbitB = vec2(cos(t*0.31 + 2.2), sin(t*0.43 - 0.8)) * orbit * 1.25;

      vec2 q = vec2(
        fbm(mp*sc + travel + orbitA),
        fbm(mp*sc + travel*0.72 + vec2(5.2, 1.3) + orbitB)
      );
      vec2 r = vec2(
        fbm(mp*sc + q*warp + vec2(1.7, 9.2) + orbitB*0.58 - orbitA*0.20),
        fbm(mp*sc + q*warp + vec2(8.3, 2.8) - orbitA*0.72 + orbitB*0.25)
      );
      float n = fbm(mp*sc + travel*0.24 + r*warp + orbitA*0.18);
      n = n*0.82 + 0.18*(q.x + r.y)*0.5;
      float smoothN = fbm(mp*sc*0.55 + q*warp*0.10 + travel*0.10 + orbitA*0.15);
      smoothN = smoothN*0.70 + 0.30*fbm(mp*sc*0.24 + vec2(3.7, 6.1) + orbitB*0.12 - travel*0.06);
      smoothN = 0.50 + (smoothN - 0.50)*0.82;
      n = mix(n, smoothN, hideLines);
      n += audio*0.16 + uLevel*uReact*0.10*sin(uTime*0.7);

      vec3 col = ramp(n);
      // ses patlaması: bas + seviye parlaklığı yükseltir (yumuşak modda neredeyse kapalı)
      float burst = (uLevel*0.6 + uAudio*0.9) * uAudioBright * (1.0 - uSoft*0.92);
      col *= uBrightness*(1.0 + burst);
      // ses ile renk kayması
      col = hueRotate(col, uHueAngle);

      float vig = smoothstep(1.3, 0.15, length(p)*(1.0+uVignette));
      col *= mix(1.0, vig, uVignette);

      float g = (hash(frag + fract(uTime))*2.0-1.0)*uGrain;
      col += g;

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('Shader hatası: ' + gl.getShaderInfoLog(s));
    }
    return s;
  }

  class GradientMode {
    constructor(canvas) {
      this.canvas = canvas;
      const gl =
        canvas.getContext('webgl', { antialias: false, alpha: false }) ||
        canvas.getContext('experimental-webgl');
      if (!gl) throw new Error('WebGL desteklenmiyor');
      this.gl = gl;

      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error('Program hatası: ' + gl.getProgramInfoLog(prog));
      }
      this.prog = prog;
      gl.useProgram(prog);
      this.lastT = 0;
      this.flow = 0; // sese göre biriken akış zamanı

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]),
        gl.STATIC_DRAW
      );
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      this.u = {
        res: gl.getUniformLocation(prog, 'uResolution'),
        time: gl.getUniformLocation(prog, 'uTime'),
        colors: gl.getUniformLocation(prog, 'uColors[0]'),
        flow: gl.getUniformLocation(prog, 'uFlow'),
        drift: gl.getUniformLocation(prog, 'uDrift'),
        wander: gl.getUniformLocation(prog, 'uWander'),
        orbit: gl.getUniformLocation(prog, 'uOrbit'),
        swirl: gl.getUniformLocation(prog, 'uSwirl'),
        scale: gl.getUniformLocation(prog, 'uScale'),
        warp: gl.getUniformLocation(prog, 'uWarp'),
        audio: gl.getUniformLocation(prog, 'uAudio'),
        level: gl.getUniformLocation(prog, 'uLevel'),
        react: gl.getUniformLocation(prog, 'uReact'),
        brightness: gl.getUniformLocation(prog, 'uBrightness'),
        audioBright: gl.getUniformLocation(prog, 'uAudioBright'),
        hueAngle: gl.getUniformLocation(prog, 'uHueAngle'),
        soft: gl.getUniformLocation(prog, 'uSoft'),
        hideLines: gl.getUniformLocation(prog, 'uHideLines'),
        grain: gl.getUniformLocation(prog, 'uGrain'),
        vignette: gl.getUniformLocation(prog, 'uVignette'),
      };
      this._colorBuf = new Float32Array(15);
      this._sampleRows = [0.28, 0.5, 0.72];
      this._pixelRow = null;
    }

    resize(w, h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
    }

    draw(audio, cfg, t) {
      const gl = this.gl;
      const g = cfg.background.gradient;
      gl.useProgram(this.prog);

      const cols = g.colors;
      for (let i = 0; i < 5; i++) {
        const c = window.SV.hexToRgb01(cols[i] || cols[cols.length - 1] || '#000000');
        this._colorBuf[i * 3] = c[0];
        this._colorBuf[i * 3 + 1] = c[1];
        this._colorBuf[i * 3 + 2] = c[2];
      }
      // Sese göre akış: bas ve genel seviye dalgalanmaları hızlandırır
      let dt = this.lastT ? t - this.lastT : 0.016;
      if (dt < 0 || dt > 0.1) dt = 0.016;
      this.lastT = t;
      const react = g.audioReactivity;
      const flowSpeed = g.speed * (1.0 + audio.bass * react * 2.4 + audio.level * react * 0.9);
      this.flow += dt * flowSpeed;

      gl.uniform3fv(this.u.colors, this._colorBuf);
      gl.uniform2f(this.u.res, this.canvas.width, this.canvas.height);
      gl.uniform1f(this.u.time, t);
      gl.uniform1f(this.u.flow, this.flow);
      gl.uniform1f(this.u.drift, g.drift);
      gl.uniform1f(this.u.wander, g.wander);
      gl.uniform1f(this.u.orbit, g.orbit);
      gl.uniform1f(this.u.swirl, g.swirl);
      gl.uniform1f(this.u.scale, g.scale);
      gl.uniform1f(this.u.warp, g.warp);
      gl.uniform1f(this.u.audio, audio.bass);
      gl.uniform1f(this.u.level, audio.level);
      gl.uniform1f(this.u.react, g.audioReactivity);
      gl.uniform1f(this.u.brightness, g.brightness);
      gl.uniform1f(this.u.audioBright, g.audioBrightness);
      const hueAngle = (g.audioHue || 0) * (audio.bass * 0.6 + audio.level * 0.4) * Math.PI;
      gl.uniform1f(this.u.hueAngle, hueAngle);
      gl.uniform1f(this.u.soft, g.style === 'plasma' ? 0.0 : 1.0);
      gl.uniform1f(this.u.hideLines, g.hideLines === false ? 0.0 : 1.0);
      gl.uniform1f(this.u.grain, g.grain);
      gl.uniform1f(this.u.vignette, g.vignette);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    sampleColors(count = 36) {
      const gl = this.gl;
      const width = this.canvas.width | 0;
      const height = this.canvas.height | 0;
      if (!width || !height || gl.isContextLost()) return [];

      const sampleCount = Math.max(2, Math.min(96, count | 0));
      const required = width * 4;
      if (!this._pixelRow || this._pixelRow.length !== required) {
        this._pixelRow = new Uint8Array(required);
      }

      const accum = Array.from({ length: sampleCount }, () => [0, 0, 0]);
      try {
        for (const rowRatio of this._sampleRows) {
          const y = Math.max(0, Math.min(height - 1, Math.round((height - 1) * rowRatio)));
          gl.readPixels(0, y, width, 1, gl.RGBA, gl.UNSIGNED_BYTE, this._pixelRow);
          for (let index = 0; index < sampleCount; index++) {
            const x = Math.max(0, Math.min(width - 1, Math.round((width - 1) * index / (sampleCount - 1))));
            const offset = x * 4;
            accum[index][0] += this._pixelRow[offset];
            accum[index][1] += this._pixelRow[offset + 1];
            accum[index][2] += this._pixelRow[offset + 2];
          }
        }
      } catch {
        return [];
      }

      const rows = this._sampleRows.length;
      return accum.map((rgb) => '#' + rgb.map((value) => Math.round(value / rows).toString(16).padStart(2, '0')).join(''));
    }

    dispose() {
      const gl = this.gl;
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
  }

  window.SVModes = window.SVModes || {};
  window.SVModes.gradient = GradientMode;
})();
