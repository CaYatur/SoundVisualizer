'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Sorgular
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  getOutputDevices: () => ipcRenderer.invoke('get-output-devices'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  visualizerIsOpen: () => ipcRenderer.invoke('visualizer-is-open'),

  // Eylemler
  openVisualizer: (displayId) => ipcRenderer.invoke('open-visualizer', displayId),
  closeVisualizer: () => ipcRenderer.invoke('close-visualizer'),
  updateConfig: (config) => ipcRenderer.send('update-config', config),

  // Olaylar (ana süreç -> admin)
  onVisualizerStatus: (cb) =>
    ipcRenderer.on('visualizer-status', (e, data) => cb(data)),
  onDisplaysChanged: (cb) =>
    ipcRenderer.on('displays-changed', (e, data) => cb(data)),
  onAudioMeter: (cb) => ipcRenderer.on('audio-meter', (e, data) => cb(data)),
  onAudioSourceStatus: (cb) => ipcRenderer.on('audio-source-status', (e, data) => cb(data)),
  onVisualizerMessage: (cb) =>
    ipcRenderer.on('visualizer-message', (e, msg) => cb(msg)),
});
