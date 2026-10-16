/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Dışa aktarımda kareyi GPU'da YUV 4:2:0'a çevirip geri okur (#531).

   Neden: 1080p'de bir RGBA kare 8,3 MB. Geri okuma, oluşturucudan ana
   sürece IPC ve ffmpeg'in renk dönüşümü kare başına bu kadar veriyle
   uğraşıyordu. I420 aynı kare için 3,1 MB; üç iş de aynı oranda küçülüyor
   ve ffmpeg'in dönüşümü tamamen kalkıyor.

   Ne değişmiyor: sahne yine aynı CPU tuvaline, aynı yoldan çiziliyor. Burada
   yalnız o tuvalin RGBA'sı, ffmpeg'in yaptığı dönüşümün aynısıyla çevriliyor:
   BT.709 matrisi, sınırlı aralık (Y 16–235, renk 16–240), 8 bit.

   Renk örnekleri 2x2 bloğun ortalaması. ffmpeg'in kendi dönüşümüne en
   yakın süzgeç bu; aynı karelerde ölçüldü (MilkDrop, 720p, U düzlemi):
       merkez 2x2 ortalama        ortalama 0,13   en çok 4
       sola hizalı [1/4 1/2 1/4]  ortalama 0,38   en çok 14
       tek nokta                  ortalama 0,63   en çok 25
   Yani eski yol da (ffmpeg) rengi merkeze hizalı küçültüyordu; amaç
   videonun öncekiyle aynı kalması.

   Çıktı düzeni ffmpeg'in `-pixel_format yuv420p` beklediği I420: önce
   W x H parlaklık, sonra W/2 x H/2 U, sonra V. Doku RGBA8 ve W/4 genişlikte;
   her doku pikseli bu bayt dizisinin ardışık dört baytını üretiyor, satır
   sayısı H * 3/2. readPixels alttaki satırı ilk verdiği için dizinin satır
   r'si çerçeve tamponunun r'inci satırına yazılıyor; ters çevirmeye gerek
   kalmıyor.

   Koşul: genişlik 4'ün, yükseklik 2'nin katı. Uymayan boyutta RGBA yolu
   kullanılır (bkz. `fits`). */
(function () {
  const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSrc;
uniform int uW;
uniform int uH;
out vec4 outColor;

vec3 px(int x, int y) {
  x = clamp(x, 0, uW - 1);
  y = clamp(y, 0, uH - 1);
  return texelFetch(uSrc, ivec2(x, y), 0).rgb;
}

// BT.709, sınırlı aralık, 0..255 ölçeğinde (yuvarlama aşağıda)
float lumaOf(vec3 c) { return 16.0 + 219.0 * dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec2 chromaOf(vec3 c) {
  float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return vec2(128.0 + 224.0 * (c.b - y) / 1.8556, 128.0 + 224.0 * (c.r - y) / 1.5748);
}

// 2x2 bloğun ortalaması (ffmpeg'in dönüşümüyle aynı hizalama)
vec3 chromaSample(int cx, int cy) {
  int x = cx * 2;
  int y = cy * 2;
  return (px(x, y) + px(x + 1, y) + px(x, y + 1) + px(x + 1, y + 1)) * 0.25;
}

float byteAt(int lin) {
  int ySize = uW * uH;
  if (lin < ySize) return lumaOf(px(lin % uW, lin / uW));
  int cw = uW / 2;
  int cSize = cw * (uH / 2);
  int idx = lin - ySize;
  bool isV = idx >= cSize;
  if (isV) idx -= cSize;
  vec2 uv = chromaOf(chromaSample(idx % cw, idx / cw));
  return isV ? uv.y : uv.x;
}

void main() {
  int col = int(gl_FragCoord.x);
  int row = int(gl_FragCoord.y);
  int base = row * uW + col * 4;
  vec4 v = vec4(byteAt(base), byteAt(base + 1), byteAt(base + 2), byteAt(base + 3));
  outColor = floor(clamp(v, 0.0, 255.0) + 0.5) / 255.0;
}`;

  function fits(w, h) {
    return w > 0 && h > 0 && w % 4 === 0 && h % 2 === 0;
  }

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error('YUV shader: ' + log);
    }
    return s;
  }

  /* w x h kaynak için dönüştürücü. Dönen nesnenin `read(canvas)` metodu
     I420 baytlarını yeni bir Uint8Array olarak verir (IPC'ye gidecek; her
     karede yeni bellek, çünkü önceki kare hâlâ yolda olabilir). */
  function create(w, h) {
    if (!fits(w, h)) return null;
    const cv = document.createElement('canvas');
    const ow = w / 4;
    const oh = (h * 3) / 2;
    cv.width = ow;
    cv.height = oh;
    const gl = cv.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false,
    });
    if (!gl) return null;

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('YUV link: ' + gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.uniform1i(gl.getUniformLocation(prog, 'uSrc'), 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'uW'), w);
    gl.uniform1i(gl.getUniformLocation(prog, 'uH'), h);

    const src = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Satır 0 = görüntünün üstü; renkler olduğu gibi (çarpılmamış, dönüştürülmemiş)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    /* Çıktı kendi RGBA8 hedefine çiziliyor: varsayılan çerçeve tamponu
       `alpha: false` ile alfasız ve her dördüncü bayt 255 dönerdi. */
    const dst = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, dst);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, ow, oh);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('YUV hedefi kurulamadı');
    gl.viewport(0, 0, ow, oh);

    return {
      width: w,
      height: h,
      bytes: w * h * 1.5,
      read(canvas) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, src);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const out = new Uint8Array(ow * oh * 4);
        gl.readPixels(0, 0, ow, oh, gl.RGBA, gl.UNSIGNED_BYTE, out);
        return out;
      },
      lost() { return gl.isContextLost(); },
    };
  }

  window.SVYuvReadout = { create, fits };
})();
