/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* DDP matrisine ekrandaki görüntüyü basmak (#1065).

   Şerit ışıkları görüntüyü soldan sağa sekiz renge indirir. Matris bunu
   istemiyor: sütun ve satır, karenin kendisi. Okuma ışık ölçeriyle aynı
   anda, yaklaşık 30 Hz. Örnek en çok 256×256; daha büyük bir pano bu
   örnekten en yakın hücreye gerilir.

   MilkDrop'un tuvali WebGL. Tam kareyi işlemciye çekmek görselleştiriciyi
   bekletiyordu (#621). Burada aynı çit kullanılır: okuma başlar, sonuç bir
   sonraki çağrıda alınır, çağrı çiti beklemez. Diğer görseller kendi 2B
   tuvalinden matris boyutunda okunur. */
(function () {
  const MAX_SIDE = 256;
  const MAX_LEDS = Math.floor(0xFFFFFFFF / 3);

  function ledCount(cfg) {
    const raw = cfg && cfg.ledCount;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw === 0) return 60;
    const n = Math.round(raw);
    if (n < 1) return 1;
    if (n > MAX_LEDS) return MAX_LEDS;
    return n;
  }

  function whole(v) {
    return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : 0;
  }

  function gridOf(count, cfg) {
    const n = Math.max(1, count | 0);
    const a = cfg || {};
    const cols = whole(a.matrixCols) || Math.ceil(Math.sqrt(n));
    const rows = whole(a.matrixRows) || Math.ceil(n / cols);
    return { cols, rows };
  }

  function sampleSize(cols, rows) {
    return {
      cols: Math.max(1, Math.min(MAX_SIDE, cols | 0)),
      rows: Math.max(1, Math.min(MAX_SIDE, rows | 0)),
    };
  }

  /* RGBA karesini `cols × rows` RGB'ye indirir. `flipY`: WebGL okuması
     alttan üste, ekranın üstü tamponun son satırı. */
  function rgbaToRgb(src, sw, sh, cols, rows, flipY) {
    const out = new Uint8Array(cols * rows * 3);
    const W = sw | 0;
    const H = sh | 0;
    if (W < 1 || H < 1 || !src) return out;
    for (let ty = 0; ty < rows; ty++) {
      const y0 = Math.floor((ty * H) / rows);
      const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * H) / rows));
      for (let tx = 0; tx < cols; tx++) {
        const x0 = Math.floor((tx * W) / cols);
        const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * W) / cols));
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let y = y0; y < y1; y++) {
          const srcY = flipY ? (H - 1 - y) : y;
          for (let x = x0; x < x1; x++) {
            const o = (srcY * W + x) * 4;
            r += src[o];
            g += src[o + 1];
            b += src[o + 2];
            n++;
          }
        }
        const o = (ty * cols + tx) * 3;
        out[o] = Math.round(r / n);
        out[o + 1] = Math.round(g / n);
        out[o + 2] = Math.round(b / n);
      }
    }
    return out;
  }

  const SKIP_KIND = { logo: 1, text: 1, nowplaying: 1 };
  const SKIP_TYPE = { text: 1, nowplaying: 1 };

  /* Öndeki görsel. Logo, yazı ve çalan parça atlanır. Liste arkadan öne. */
  function pictureEntry(entries) {
    const list = entries || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (!e || !e.canvas || !(e.canvas.width > 0) || !(e.canvas.height > 0)) continue;
      if (e._coverHidden) continue;
      const layer = e.layer;
      if (layer && layer.enabled === false) continue;
      const kind = layer && layer.kind;
      if (SKIP_KIND[kind]) continue;
      if (kind === 'visualizer' && layer && SKIP_TYPE[layer.type]) continue;
      if (kind && kind !== 'visualizer' && kind !== 'background' && kind !== 'media') continue;
      return e;
    }
    return null;
  }

  function mipLevel(W, H, cols, rows) {
    let L = 0;
    const cap = Math.floor(Math.log2(Math.max(W, H)));
    while (L < cap && (W >> (L + 1)) >= cols && (H >> (L + 1)) >= rows) L++;
    return L;
  }

  /* Çiti beklemez. Hazır kare varsa onu verir ve sonrakini başlatır.
     Hazır değilse eldeki son kareyi, o da yoksa null. */
  function readGpu(mode, cv, cols, rows) {
    const gl = mode.gl;
    const rb = mode._matrixRb || (mode._matrixRb = {});
    const cache = () => (rb.rgb && rb.cols === cols && rb.rows === rows ? rb.rgb : null);
    if (rb.sync && (rb.wantCols !== cols || rb.wantRows !== rows)) {
      gl.deleteSync(rb.sync);
      rb.sync = null;
      if (rb.pbo) { gl.deleteBuffer(rb.pbo); rb.pbo = null; }
    }
    if (rb.sync) {
      if (gl.getSyncParameter(rb.sync, gl.SYNC_STATUS) !== gl.SIGNALED) return cache();
      const raw = new Uint8Array(rb.w * rb.h * 4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, rb.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, raw);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteSync(rb.sync);
      rb.sync = null;
      gl.deleteBuffer(rb.pbo);
      rb.pbo = null;
      rb.rgb = rgbaToRgb(raw, rb.w, rb.h, cols, rows, true);
      rb.cols = cols;
      rb.rows = rows;
      begin(gl, cv, rb, cols, rows);
      return rb.rgb;
    }
    begin(gl, cv, rb, cols, rows);
    return cache();
  }

  function begin(gl, cv, rb, cols, rows) {
    const W = cv.width;
    const H = cv.height;
    if (!(W > 0) || !(H > 0)) return;
    const L = mipLevel(W, H, cols, rows);
    if (!rb.tex || rb.W !== W || rb.H !== H || rb.L !== L) {
      if (rb.tex) gl.deleteTexture(rb.tex);
      rb.W = W;
      rb.H = H;
      rb.L = L;
      rb.w = Math.max(1, W >> L);
      rb.h = Math.max(1, H >> L);
      rb.tex = gl.createTexture();
      const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
      gl.bindTexture(gl.TEXTURE_2D, rb.tex);
      gl.texStorage2D(gl.TEXTURE_2D, L + 1, gl.RGB8, W, H);
      gl.bindTexture(gl.TEXTURE_2D, prevTex);
      if (!rb.fbo) rb.fbo = gl.createFramebuffer();
    }
    rb.pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, rb.pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, rb.w * rb.h * 4, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const prevRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, rb.tex);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, W, H);
    if (L > 0) gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, rb.fbo);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rb.tex, L);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, rb.pbo);
    gl.readPixels(0, 0, rb.w, rb.h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevRead);
    rb.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    rb.wantCols = cols;
    rb.wantRows = rows;
    gl.flush();
  }

  function readCanvas(entry, cols, rows) {
    const doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return null;
    const hold = entry._matrixCpu || (entry._matrixCpu = {});
    const c = hold.canvas || (hold.canvas = doc.createElement('canvas'));
    if (c.width !== cols) c.width = cols;
    if (c.height !== rows) c.height = rows;
    const ctx = hold.ctx || (hold.ctx = c.getContext('2d', { willReadFrequently: true }));
    if (!ctx || typeof ctx.drawImage !== 'function' || typeof ctx.getImageData !== 'function') return null;
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, cols, rows);
    ctx.drawImage(entry.canvas, 0, 0, cols, rows);
    const img = ctx.getImageData(0, 0, cols, rows);
    if (!img || !img.data) return null;
    return rgbaToRgb(img.data, cols, rows, cols, rows, false);
  }

  function capture(stack, cols, rows) {
    const size = sampleSize(cols, rows);
    const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    let out = null;
    try {
      const e = pictureEntry(stack && stack.entries);
      if (e) {
        const mode = e.mode;
        const gl = mode && mode.gl;
        const cv = mode && mode.gl2;
        if (gl && cv && cv.width > 0 && cv.height > 0 && typeof gl.fenceSync === 'function'
            && !(gl.isContextLost && gl.isContextLost())) {
          out = readGpu(mode, cv, size.cols, size.rows);
        } else {
          out = readCanvas(e, size.cols, size.rows);
        }
      }
    } catch (err) {
      out = null;
    }
    api.lastSampleMs = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - t0;
    return out;
  }

  const api = {
    MAX_SIDE, MAX_LEDS, ledCount, gridOf, sampleSize, rgbaToRgb, pictureEntry, capture,
    lastSampleMs: 0,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVMatrixPicture = api;
})();
