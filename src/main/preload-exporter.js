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
  finish: () => ipcRenderer.send('export:finish'),
  cancelled: () => ipcRenderer.send('export:cancelled'),
  error: (msg) => ipcRenderer.send('export:error', msg),
});

/* MilkDrop motoru dokuları `window.api` üzerinden istiyor (#586). Dışa
   aktarıcıda o köprü hiç yoktu, yani dokulu presetler videoya gürültüyle
   çiziliyordu. Yalnız iki doku çağrısı açılıyor; gerisi bu sayfada yok. */
contextBridge.exposeInMainWorld('api', {
  milkdropTextures: () => ipcRenderer.invoke('milkdrop:textures'),
  milkdropTexture: (name) => ipcRenderer.invoke('milkdrop:texture', name),
});
