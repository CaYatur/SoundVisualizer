'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  requestConfig: () => ipcRenderer.invoke('request-config'),
  onConfig: (cb) => ipcRenderer.on('config', (e, config) => cb(config)),
  onNativeAudio: (cb) => ipcRenderer.on('native-audio', (e, frame) => cb(frame)),
  sendAudioMeter: (data) => ipcRenderer.send('audio-meter', data),
  sendMessage: (msg) => ipcRenderer.send('visualizer-message', msg),
  // Studio presetleri ana süreçte tutulur (settings.json şişmesin diye)
  getPresets: () => ipcRenderer.invoke('presets:list'),
  onPresets: (cb) => ipcRenderer.on('presets', (e, list) => cb(list)),
});
