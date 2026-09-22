'use strict';
/* MilkDrop küçük resim penceresinin köprüsü (#575). Motorun doku istekleri
   görselleştiriciyle aynı kanallardan (aynı iki klasör, aynı denetim); iş
   alıp sonucu döndürmek için ayrı bir köprü. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  milkdropTextures: () => ipcRenderer.invoke('milkdrop:textures'),
  milkdropTexture: (name) => ipcRenderer.invoke('milkdrop:texture', name),
});

contextBridge.exposeInMainWorld('thumbs', {
  onJob: (cb) => ipcRenderer.on('thumbs:job', (e, job) => cb(job)),
  done: (key, result) => ipcRenderer.send('thumbs:done', key, result),
  ready: () => ipcRenderer.send('thumbs:ready'),
});
