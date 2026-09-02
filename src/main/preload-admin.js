'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Sorgular
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  importMilk: () => ipcRenderer.invoke('presets:import-milk'),
  // Canlı kayıt ve anlık görüntü
  saveRecording: (data, opts) => ipcRenderer.invoke('record:save', { data, opts }),
  saveSnapshot: (dataUrl) => ipcRenderer.invoke('record:snapshot', { dataUrl }),
  getOutputDevices: () => ipcRenderer.invoke('get-output-devices'),
  diagnoseAudio: () => ipcRenderer.invoke('diagnose-audio'),
  repairAudio: () => ipcRenderer.invoke('repair-audio'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  visualizerIsOpen: () => ipcRenderer.invoke('visualizer-is-open'),
  scanLighting: () => ipcRenderer.invoke('lighting:scan'),
  getLightingAvailability: () => ipcRenderer.invoke('lighting:availability'),
  applyLighting: (lighting) => ipcRenderer.invoke('lighting:apply', lighting),
  getLightingIdentityStatus: () => ipcRenderer.invoke('lighting:identity-status'),
  openDynamicLightingSettings: () => ipcRenderer.invoke('lighting:open-settings'),

  // Canlı önizleme (panel içi): ses karesi akışını aç/kapat
  subscribePreview: (on) => ipcRenderer.send('preview:subscribe', on),
  onNativeAudio: (cb) => ipcRenderer.on('native-audio', (e, frame) => cb(frame)),

  // Eylemler
  openVisualizer: (displayId) => ipcRenderer.invoke('open-visualizer', displayId),
  closeVisualizer: () => ipcRenderer.invoke('close-visualizer'),
  updateConfig: (config) => ipcRenderer.send('update-config', config),
  // Arayüz dili: sistem diyalogları ve yayın sayfaları da buna uysun
  setUiLanguage: (locale) => ipcRenderer.send('ui-language', locale),

  // JSON içe/dışa aktarma (şablonlar, arkaplan ve tüm uygulama ayarları)
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

  // Studio presetleri (kullanıcının kendi shader/varyasyon tasarımları)
  listPresets: () => ipcRenderer.invoke('presets:list'),
  savePreset: (preset) => ipcRenderer.invoke('presets:save', preset),
  deletePreset: (id) => ipcRenderer.invoke('presets:delete', id),
  savePresets: (list) => ipcRenderer.invoke('presets:save-many', list),
  openPresetsFolder: () => ipcRenderer.invoke('presets:open-folder'),
  importShaderText: () => ipcRenderer.invoke('presets:import-text'),
  onPresets: (cb) => ipcRenderer.on('presets', (e, list) => cb(list)),

  // Yayın çıkışı (OBS tarayıcı kaynağı + mobil kumanda)
  streamStatus: () => ipcRenderer.invoke('stream:status'),
  streamSync: () => ipcRenderer.invoke('stream:sync'),
  streamNewToken: () => ipcRenderer.invoke('stream:new-token'),
  streamLanAddress: () => ipcRenderer.invoke('stream:lan-address'),
  streamOpen: (which) => ipcRenderer.invoke('stream:open', which),
  onStreamStatus: (cb) => ipcRenderer.on('stream-status', (e, d) => cb(d)),
  onStreamClients: (cb) => ipcRenderer.on('stream-clients', (e, d) => cb(d)),

  // OSC alıcısı
  artnetStatus: () => ipcRenderer.invoke('artnet:status'),
  artnetSync: () => ipcRenderer.invoke('artnet:sync'),
  onArtnetStatus: (cb) => ipcRenderer.on('artnet-status', (e, d) => cb(d)),
  oscStatus: () => ipcRenderer.invoke('osc:status'),
  oscSync: () => ipcRenderer.invoke('osc:sync'),
  onOscMessage: (cb) => ipcRenderer.on('osc-message', (e, m) => cb(m)),
  onOscStatus: (cb) => ipcRenderer.on('osc-status', (e, d) => cb(d)),

  // Medya katmanı
  pickVideo: () => ipcRenderer.invoke('media:pick-video'),
  reportVideoDevices: (devices) => ipcRenderer.send('report-video-devices', devices),

  // Uzaktan kumandadan gelen ayar değişikliği (panel kopyasını tazeler)
  onExternalConfig: (cb) => ipcRenderer.on('external-config', (e, c) => cb(c)),

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
