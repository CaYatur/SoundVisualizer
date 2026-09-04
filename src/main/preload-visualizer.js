'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Bu pencerenin ekran kimliği (ana süreç komut satırında veriyor).
// Projeksiyon haritalaması ekran başına tanımlandığı için gerekli.
const displayArg = process.argv.find((a) => a.startsWith('--sv-display-id='));
contextBridge.exposeInMainWorld('SV_DISPLAY_ID',
  displayArg ? Number(displayArg.split('=')[1]) : null);

contextBridge.exposeInMainWorld('api', {
  requestConfig: () => ipcRenderer.invoke('request-config'),
  onConfig: (cb) => ipcRenderer.on('config', (e, config) => cb(config)),
  /* Gösteri saati çıpası. Yalnızca DURUM DEĞİŞTİĞİNDE gelir; zaman her
     karede yeniden yollanmaz, pencere çıpadan kapalı formülle hesaplar. */
  onShowClock: (cb) => ipcRenderer.on('show-clock', (e, anchor) => cb(anchor)),
  /* Çalan parça çıpası. Konum HER KARE gelmez; kaynak ancak ara sıra
     güncelliyor, aradaki değeri pencere kendisi hesaplıyor.
     (bkz. src/shared/nowplaying.js) */
  onNowPlaying: (cb) => ipcRenderer.on('now-playing', (e, st) => cb(st)),
  onNativeAudio: (cb) => ipcRenderer.on('native-audio', (e, frame) => cb(frame)),
  sendAudioMeter: (data) => ipcRenderer.send('audio-meter', data),
  sendMessage: (msg) => ipcRenderer.send('visualizer-message', msg),
  // Studio presetleri ana süreçte tutulur (settings.json şişmesin diye)
  getPresets: () => ipcRenderer.invoke('presets:list'),
  onPresets: (cb) => ipcRenderer.on('presets', (e, list) => cb(list)),
});
