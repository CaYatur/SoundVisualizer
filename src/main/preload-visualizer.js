'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Bu pencerenin ekran kimliği (ana süreç komut satırında veriyor).
// Projeksiyon haritalaması ekran başına tanımlandığı için gerekli.
const displayArg = process.argv.find((a) => a.startsWith('--sv-display-id='));
contextBridge.exposeInMainWorld('SV_DISPLAY_ID',
  displayArg ? Number(displayArg.split('=')[1]) : null);
contextBridge.exposeInMainWorld('SV_FLOATING',
  process.argv.some((a) => a === '--sv-floating=1' || a.startsWith('--sv-floating=')));

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
  // Değişiklik yayını (#574): bütün liste yerine yalnız değişenler
  onPresetsDelta: (cb) => ipcRenderer.on('presets-delta', (e, d) => cb(d)),
  /* MilkDrop doku paketi: preset kendi görselini ada göre istiyor
     (`sampler_worms` -> `worms.jpg`). Yalnızca yapılandırmada seçili
     klasörün içi okunuyor; kapsam denetimi ana süreçte. */
  milkdropTextures: () => ipcRenderer.invoke('milkdrop:textures'),
  milkdropTexture: (name) => ipcRenderer.invoke('milkdrop:texture', name),
  logoLibRead: (id) => ipcRenderer.invoke('logo-lib:read', id),
  floatingClose: () => ipcRenderer.send('floating:close'),
  floatingSnap: (where) => ipcRenderer.send('floating:snap', where),
  floatingSize: (kind) => ipcRenderer.send('floating:size', kind),
  // Liderin MilkDrop seçimi (#585): bu pencere izleyiciyse gelir
  onMdFollow: (cb) => ipcRenderer.on('md-follow', (e, p) => cb(p)),
  /* MilkDrop sprite'ları (#577): başlatma/silme komutları her motora gelir;
     resim kimlikle istenir, yol ana süreçte kalır. Pencerenin tuşları
     (K + iki hane...) komutu ana sürece yollar. */
  onMdSprite: (cb) => ipcRenderer.on('md-sprite', (e, c) => cb(c)),
  milkdropSpriteImage: (key) => ipcRenderer.invoke('milkdrop:sprite-image', key),
  milkdropSprite: (req) => ipcRenderer.invoke('milkdrop:sprite', req),
});
