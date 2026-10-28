/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('exp', {
  // Ana süreç -> render: iş tanımı (ses + boyut + fps + yapılandırma)
  onJob: (cb) => ipcRenderer.on('export:job', (e, job) => cb(job)),

  // render -> ana süreç
  ready: (totalFrames) => ipcRenderer.send('export:ready', totalFrames),
  // Bir RGBA kare gönder; ana süreç ffmpeg.stdin'e yazana kadar bekler (geri basınç).
  // Dönen { cancel: true } ise render durdurulur.
  sendFrame: (data, index) => ipcRenderer.invoke('export:frame', data, index),
  progress: (done, total) => ipcRenderer.send('export:progress', { done, total }),
  finish: (stats) => ipcRenderer.send('export:finish', stats || null),
  cancelled: () => ipcRenderer.send('export:cancelled'),
  error: (msg) => ipcRenderer.send('export:error', msg),
  // Ses analizi kaydı (bitince bir kez) ve yalnız analiz işinde iptal sorusu
  analysis: (data) => ipcRenderer.send('export:analysis', data),
  cancelRequested: () => ipcRenderer.invoke('export:cancel-requested'),
});

/* MilkDrop motoru dokuları `window.api` üzerinden istiyor (#586). Dışa
   aktarıcıda o köprü hiç yoktu, yani dokulu presetler videoya gürültüyle
   çiziliyordu. Yalnız iki doku çağrısı açılıyor; gerisi bu sayfada yok. */
contextBridge.exposeInMainWorld('api', {
  milkdropTextures: () => ipcRenderer.invoke('milkdrop:textures'),
  milkdropTexture: (name) => ipcRenderer.invoke('milkdrop:texture', name),
});

/* ==== DIŞ KAYNAK KARELERİ (layer-sources.js) ====
   Spout/Syphon girişi ve web katmanının kareleri. Ana süreç dokuyu bu
   pencereye yollar; burada bir VideoFrame alınıp sayfanın göremediği gizli
   bir tuvale (`canvas[data-sv-source]`) çizilir ve hemen bırakılır. Katman
   o tuvalden çizer: DOM iki dünyada ortak, nesne köprüden geçmez.
   Kum havuzunda require yok; bu blok preload-visualizer, preload-admin ve
   preload-exporter'da AYNI (tests/source-layers.test.js denetler). */
(function sourceFrames() {
  const st = require('electron').sharedTexture;
  const cans = new Map();
  function canvasFor(key, w, h) {
    if (typeof key !== 'string' || !key || key.length > 200) return null;
    let c = cans.get(key);
    if (!c || !c.isConnected) {
      const root = document.documentElement;
      if (!root) return null;
      c = document.createElement('canvas');
      c.setAttribute('data-sv-source', key);
      c.style.display = 'none';
      root.appendChild(c);
      cans.set(key, c);
    }
    if (w > 0 && h > 0 && (c.width !== w || c.height !== h)) {
      c.width = w;
      c.height = h;
    }
    return c;
  }
  function stamp(c) {
    c.dataset.at = String(Date.now());
    c.dataset.seq = String((Number(c.dataset.seq) || 0) + 1);
  }
  if (st && typeof st.setSharedTextureReceiver === 'function') {
    st.setSharedTextureReceiver(async (data, meta) => {
      const imp = data && data.importedSharedTexture;
      let vf = null;
      let flat = null;
      try {
        if (!imp) return;
        vf = imp.getVideoFrame();
        const c = canvasFor(meta && meta.key, vf.displayWidth, vf.displayHeight);
        if (!c) return;
        // Opak istenirse saydamlık kanalı atılır (bkz. source-layers.js `alpha`)
        if (meta && meta.opaque) flat = new VideoFrame(vf, { alpha: 'discard' });
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(flat || vf, 0, 0, c.width, c.height);
        stamp(c);
      } catch { /* kare atlandı */ } finally {
        if (flat) { try { flat.close(); } catch { /* kapandı */ } }
        if (vf) { try { vf.close(); } catch { /* kapandı */ } }
        if (imp) { try { imp.release(); } catch { /* bırakıldı */ } }
      }
    });
  }
  ipcRenderer.on('sources:bitmap', (_e, m) => {
    try {
      if (!m || !(m.w > 0) || !(m.h > 0) || !m.data) return;
      const c = canvasFor(m.key, m.w, m.h);
      if (!c) return;
      const raw = m.data;
      const src = new Uint8Array(raw.buffer || raw, raw.byteOffset || 0, raw.byteLength || raw.length);
      const n = m.w * m.h * 4;
      if (src.length < n) return;
      const img = new ImageData(m.w, m.h);
      const d = img.data;
      if (m.format === 'bgra') {
        for (let i = 0; i < n; i += 4) { d[i] = src[i + 2]; d[i + 1] = src[i + 1]; d[i + 2] = src[i]; d[i + 3] = src[i + 3]; }
      } else {
        d.set(src.subarray(0, n));
      }
      if (m.opaque) for (let i = 3; i < n; i += 4) d[i] = 255;
      c.getContext('2d').putImageData(img, 0, 0);
      stamp(c);
    } catch { /* kare atlandı */ }
  });
  ipcRenderer.on('sources:drop', (_e, key) => {
    const c = cans.get(key);
    if (c && c.parentNode) c.parentNode.removeChild(c);
    cans.delete(key);
  });
  ipcRenderer.send('sources:hello', { gpu: !!(st && typeof st.setSharedTextureReceiver === 'function') });
})();
/* ==== DIŞ KAYNAK KARELERİ SONU ==== */
