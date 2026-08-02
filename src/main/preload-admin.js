'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Sorgular
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  getOutputDevices: () => ipcRenderer.invoke('get-output-devices'),
  diagnoseAudio: () => ipcRenderer.invoke('diagnose-audio'),
  repairAudio: () => ipcRenderer.invoke('repair-audio'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  visualizerIsOpen: () => ipcRenderer.invoke('visualizer-is-open'),

  // Eylemler
  openVisualizer: (displayId) => ipcRenderer.invoke('open-visualizer', displayId),
  closeVisualizer: () => ipcRenderer.invoke('close-visualizer'),
  updateConfig: (config) => ipcRenderer.send('update-config', config),

  // JSON içe/dışa aktarma (renk şablonları + arkaplan ayarları)
  exportJson: (name, data) => ipcRenderer.invoke('file:export-json', name, data),
  importJson: (title) => ipcRenderer.invoke('file:import-json', title),

  // Video dışa aktarma
  gpuAvailable: () => ipcRenderer.invoke('export:gpu-available'),
  pickExportAudio: () => ipcRenderer.invoke('export:pick-audio'),
  pickExportOutput: (name) => ipcRenderer.invoke('export:pick-output', name),
  startExport: (opts) => ipcRenderer.invoke('export:start', opts),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  onExportProgress: (cb) => ipcRenderer.on('export-progress', (e, d) => cb(d)),
  onExportDone: (cb) => ipcRenderer.on('export-done', (e, d) => cb(d)),

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
