/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
/* ARKA PLANDA GÖLGELENDİRİCİ DERLEME (#907).

   Derlemeyi başlatmak beklemek değildir: GL çağrıları GPU sürecine sıraya
   giriyor. Bekleten şey sonucu SORMAK (COMPILE_STATUS, LINK_STATUS,
   getUniformLocation). `KHR_parallel_shader_compile` varken COMPLETION_STATUS
   beklemeden cevap veriyor, yani çizim sürerken bitti mi diye bakılabiliyor.

   Ölçüldü: tek Studio gölgelendiricisi 680 ms, gradyan arka planı 213 ms. Bu
   süre boyunca bütün kareler duruyordu.

   Dışa aktarım beklemeye devam ediyor (`SVMilkdropSync`, adı MilkDrop'tan
   geliyor ama bayrak çevrimdışı işin kendisi): bir efektin hangi karede
   göründüğü derleme hızına kalamaz, aynı iş aynı videoyu vermeli. Uzantının
   olmadığı sürücülerde de eski bekleyen yol çalışıyor. */
(function () {
  const EXT = 'KHR_parallel_shader_compile';

  function canWait(gl) {
    if (typeof window !== 'undefined' && window.SVMilkdropSync === true) return false;
    return !!gl.getExtension(EXT);
  }

  function begin(gl, vsSrc, fsSrc, attribs) {
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSrc);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSrc);
    gl.compileShader(fs);
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    if (attribs) attribs.forEach((name, i) => gl.bindAttribLocation(p, i, name));
    gl.linkProgram(p);
    return { p, vs, fs };
  }

  // Bağlam giderse uzantı "bitti" der; sonucu `end` kaybolmuş olarak bildirir
  function ready(gl, h) {
    const ext = gl.getExtension(EXT);
    return !ext || gl.getProgramParameter(h.p, ext.COMPLETION_STATUS_KHR) === true;
  }

  /* Sonucu alır; hazır değilse bekletir. Dönüş { ok, prog } ya da
     { ok: false, log, stage }. `stage` 'link' ise günlükte satır numarası yok. */
  function end(gl, h) {
    const ok = gl.getProgramParameter(h.p, gl.LINK_STATUS);
    let log = '';
    let stage = 'compile';
    if (!ok) {
      if (!gl.getShaderParameter(h.fs, gl.COMPILE_STATUS)) log = gl.getShaderInfoLog(h.fs);
      else if (!gl.getShaderParameter(h.vs, gl.COMPILE_STATUS)) log = gl.getShaderInfoLog(h.vs);
      else { log = gl.getProgramInfoLog(h.p); stage = 'link'; }
    }
    gl.deleteShader(h.vs);
    gl.deleteShader(h.fs);
    if (!ok) {
      gl.deleteProgram(h.p);
      return { ok: false, log: log || 'bilinmeyen derleme hatası', stage };
    }
    return { ok: true, prog: h.p };
  }

  function drop(gl, h) {
    if (!h) return;
    gl.deleteShader(h.vs);
    gl.deleteShader(h.fs);
    gl.deleteProgram(h.p);
  }

  const api = { canWait, begin, ready, end, drop };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVGlLink = api;
})();
