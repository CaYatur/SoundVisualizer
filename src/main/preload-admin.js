/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';

const { contextBridge, ipcRenderer, clipboard } = require('electron');

/* Söz saati çıpası panel dinleyiciyi geç kurabilir. Son çıpa burada durur. */
function createLateEvent() {
  let listener = null;
  let seen = false;
  let value;
  return {
    push(next) {
      seen = true;
      value = next;
      if (listener) listener(next);
    },
    subscribe(cb) {
      listener = typeof cb === 'function' ? cb : null;
      if (seen && listener) listener(value);
    },
  };
}
const lyricsClockEvents = createLateEvent();
ipcRenderer.on('lyrics-clock', (_e, anchor) => lyricsClockEvents.push(anchor));

/* Arayüzün platformu bilmesi gerekiyor: Windows Dynamic Lighting yalnız
   Windows'ta anlamlı, Spout yalnız Windows'ta, Syphon yalnız macOS'ta.
   IPC'ye gerek yok; preload zaten ana süreç tarafında çalışıyor. */
contextBridge.exposeInMainWorld('SV_PLATFORM', {
  os: process.platform,
  isWindows: process.platform === 'win32',
  isMac: process.platform === 'darwin',
  isLinux: process.platform === 'linux',
});

contextBridge.exposeInMainWorld('api', {
  // Pano (yerel Electron API güvencesi)
  copyToClipboard: (text) => {
    try {
      clipboard.writeText(String(text || ''));
      return true;
    } catch {
      return false;
    }
  },

  // Sorgular
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  importMilk: () => ipcRenderer.invoke('presets:import-milk'),
  /* MilkDrop doku paketi klasörü. Seçim panelde, okuma görselleştiricide;
     ikisi de yalnızca seçili klasörü görüyor. */
  pickMilkdropTextures: () => ipcRenderer.invoke('milkdrop:pick-textures'),
  milkdropTextures: () => ipcRenderer.invoke('milkdrop:textures'),
  /* Panelin canlı önizlemesi de aynı motoru çalıştırıyor ve dokuyu bu
     çağrıyla istiyor (#586). Burada yalnız liste çağrısı vardı; önizleme
     dosyayı alamadığı için doku yerine gürültü çiziyordu. */
  milkdropTexture: (name) => ipcRenderer.invoke('milkdrop:texture', name),
  /* MilkDrop sprite'ları (#577): milk_img.ini seçimi ve listesi, komutlar,
     önizlemenin aldığı komutlar ve resimler. */
  pickMilkdropSprites: () => ipcRenderer.invoke('milkdrop:pick-sprites'),
  milkdropSprites: () => ipcRenderer.invoke('milkdrop:sprites'),
  milkdropSprite: (req) => ipcRenderer.invoke('milkdrop:sprite', req),
  milkdropSpriteImage: (key) => ipcRenderer.invoke('milkdrop:sprite-image', key),
  onMdSprite: (cb) => ipcRenderer.on('md-sprite', (e, c) => cb(c)),
  logoLibList: () => ipcRenderer.invoke('logo-lib:list'),
  logoLibRead: (id) => ipcRenderer.invoke('logo-lib:read', id),
  logoLibRemove: (id) => ipcRenderer.invoke('logo-lib:remove', id),
  logoLibImport: () => ipcRenderer.invoke('logo-lib:import'),
  mediaLibList: () => ipcRenderer.invoke('media-lib:list'),
  mediaLibRemove: (id) => ipcRenderer.invoke('media-lib:remove', id),
  mediaLibImport: () => ipcRenderer.invoke('media-lib:import'),
  lyricsLibList: () => ipcRenderer.invoke('lyrics-lib:list'),
  lyricsLibSnapshot: () => ipcRenderer.invoke('lyrics-lib:snapshot'),
  lyricsLibRead: (id) => ipcRenderer.invoke('lyrics-lib:read', id),
  lyricsLibRemove: (id) => ipcRenderer.invoke('lyrics-lib:remove', id),
  lyricsLibUpdate: (id, patch) => ipcRenderer.invoke('lyrics-lib:update', id, patch),
  lyricsLibImport: () => ipcRenderer.invoke('lyrics-lib:import'),
  onLyricsLib: (cb) => ipcRenderer.on('lyrics-lib', (e, items) => cb(items)),
  toggleFloating: () => ipcRenderer.invoke('floating:toggle'),
  floatingIsOpen: () => ipcRenderer.invoke('floating:is-open'),
  floatingSnap: (where) => ipcRenderer.invoke('floating:snap', where),
  floatingSize: (kind) => ipcRenderer.invoke('floating:size', kind),
  // Canlı kayıt ve anlık görüntü
  saveRecording: (data, opts) => ipcRenderer.invoke('record:save', { data, opts }),
  saveSnapshot: (dataUrl) => ipcRenderer.invoke('record:snapshot', { dataUrl }),
  getOutputDevices: () => ipcRenderer.invoke('get-output-devices'),
  diagnoseAudio: () => ipcRenderer.invoke('diagnose-audio'),
  repairAudio: () => ipcRenderer.invoke('repair-audio'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  visualizerIsOpen: () => ipcRenderer.invoke('visualizer-is-open'),
  getVisualizerStatus: () => ipcRenderer.invoke('get-visualizer-status'),
  scanLighting: () => ipcRenderer.invoke('lighting:scan'),
  getLightingAvailability: () => ipcRenderer.invoke('lighting:availability'),
  openrgbStatus: () => ipcRenderer.invoke('openrgb:status'),
  openrgbSync: () => ipcRenderer.invoke('openrgb:sync'),
  openrgbRescan: () => ipcRenderer.invoke('openrgb:rescan'),
  textureStatus: () => ipcRenderer.invoke('texture:status'),
  textureSync: () => ipcRenderer.invoke('texture:sync'),
  textureSenders: () => ipcRenderer.invoke('texture:senders'),
  onTextureStatus: (cb) => ipcRenderer.on('texture-share-status', (e, d) => cb(d)),
  onOpenRgbStatus: (cb) => ipcRenderer.on('openrgb-status', (e, d) => cb(d)),
  applyLighting: (lighting) => ipcRenderer.invoke('lighting:apply', lighting),
  getLightingIdentityStatus: () => ipcRenderer.invoke('lighting:identity-status'),
  openDynamicLightingSettings: () => ipcRenderer.invoke('lighting:open-settings'),

  // Canlı önizleme (panel içi): ses karesi akışını aç/kapat
  subscribePreview: (on) => ipcRenderer.send('preview:subscribe', on),
  /* Önizleme lider olduğunda (görselleştirici penceresi ve Spout/Syphon
     yokken) MilkDrop seçimi: web çıkışı onu izliyor (#585). */
  sendMdLive: (p) => ipcRenderer.send('md-live', p),
  onNativeAudio: (cb) => ipcRenderer.on('native-audio', (e, frame) => cb(frame)),

  // Eylemler
  openVisualizer: (displayId) => ipcRenderer.invoke('open-visualizer', displayId),
  closeVisualizer: () => ipcRenderer.invoke('close-visualizer'),
  updateConfig: (config) => ipcRenderer.send('update-config', config),
  // Yalnız değişen üst düzey anahtarlar (kaydırıcı sürüklerken, #695)
  patchConfig: (patch) => ipcRenderer.send('patch-config', patch),
  // Arayüz dili: sistem diyalogları ve yayın sayfaları da buna uysun
  setUiLanguage: (locale) => ipcRenderer.send('ui-language', locale),

  // JSON içe/dışa aktarma (şablonlar, arkaplan ve tüm uygulama ayarları)
  exportJson: (name, data) => ipcRenderer.invoke('file:export-json', name, data),
  importJson: (title) => ipcRenderer.invoke('file:import-json', title),

  // Video dışa aktarma
  gpuAvailable: () => ipcRenderer.invoke('export:gpu-available'),
  pickExportAudio: () => ipcRenderer.invoke('export:pick-audio'),
  pickExportOutput: (name, format) => ipcRenderer.invoke('export:pick-output', name, format),
  exportCapabilities: () => ipcRenderer.invoke('export:capabilities'),
  // Dışa aktarma kuyruğu (#526)
  exportQueueState: () => ipcRenderer.invoke('export:queue-state'),
  exportQueueAdd: (items) => ipcRenderer.invoke('export:queue-add', items),
  exportQueueStart: () => ipcRenderer.invoke('export:queue-start'),
  exportQueueStop: () => ipcRenderer.invoke('export:queue-stop'),
  exportQueueRemove: (id) => ipcRenderer.invoke('export:queue-remove', id),
  exportQueueRetry: (id) => ipcRenderer.invoke('export:queue-retry', id),
  exportQueueClear: () => ipcRenderer.invoke('export:queue-clear'),
  onExportQueue: (cb) => ipcRenderer.on('export-queue', (e, d) => cb(d)),
  pickExportAudioMulti: () => ipcRenderer.invoke('export:pick-audio-multi'),
  pickExportFolder: (p) => ipcRenderer.invoke('export:pick-folder', p),
  startExport: (opts) => ipcRenderer.invoke('export:start', opts),
  pickAnalysisOutput: (name) => ipcRenderer.invoke('export:pick-analysis-output', name),
  startAnalysisExport: (opts) => ipcRenderer.invoke('export:analysis-start', opts),
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
  // Değişiklik yayını ve toplu kaydın ilerlemesi (#574)
  onPresetsDelta: (cb) => ipcRenderer.on('presets-delta', (e, d) => cb(d)),
  presetsHead: () => ipcRenderer.invoke('presets:head'),
  presetsSince: (gen) => ipcRenderer.invoke('presets:since', gen),
  onPresetsProgress: (cb) => ipcRenderer.on('presets-progress', (e, p) => cb(p)),
  /* MilkDrop kütüphanesi (#574): tarama bir özet ve kimlik döndürüyor,
     içe aktarım aynı kimlikle; dosya listeleri ana süreçte kalıyor. */
  pickMilkdropLibrary: (kind) => ipcRenderer.invoke('milkdrop:library-pick', kind),
  discoverMilkdropLibraries: () => ipcRenderer.invoke('milkdrop:library-discover'),
  rescanMilkdropLibrary: (token) => ipcRenderer.invoke('milkdrop:library-rescan', token),
  importMilkdropLibrary: (token) => ipcRenderer.invoke('milkdrop:library-import', token),
  onMilkdropLibraryProgress: (cb) => ipcRenderer.on('milkdrop:library-progress', (e, p) => cb(p)),
  /* Küçük resimler (#575): görünen kimlikler isteniyor; hazır olanların
     anahtarı hemen, gerisi çizildikçe `milkdrop:thumb` ile. Görsel
     `sv-thumb://t/<anahtar>.webp` adresinden. */
  milkdropThumbs: (ids) => ipcRenderer.invoke('milkdrop:thumbs', ids),
  onMilkdropThumb: (cb) => ipcRenderer.on('milkdrop:thumb', (e, t) => cb(t)),

  // Yayın çıkışı (OBS tarayıcı kaynağı + mobil kumanda)
  streamStatus: () => ipcRenderer.invoke('stream:status'),
  streamSync: () => ipcRenderer.invoke('stream:sync'),
  streamNewToken: () => ipcRenderer.invoke('stream:new-token'),
  streamLanAddress: () => ipcRenderer.invoke('stream:lan-address'),
  streamOpen: (which) => ipcRenderer.invoke('stream:open', which),
  onStreamStatus: (cb) => ipcRenderer.on('stream-status', (e, d) => cb(d)),
  onStreamClients: (cb) => ipcRenderer.on('stream-clients', (e, d) => cb(d)),

  // Yedeklilik (#540)
  redundancyStatus: () => ipcRenderer.invoke('redundancy:status'),
  redundancyTakeover: () => ipcRenderer.invoke('redundancy:takeover'),
  redundancyRelease: () => ipcRenderer.invoke('redundancy:release'),
  redundancyRearm: () => ipcRenderer.invoke('redundancy:rearm'),
  // Yetki (#814): korumalı geri verme, iki yönlü komut, öteki makinenin önizlemesi
  redundancyHandback: (at) => ipcRenderer.invoke('redundancy:handback', at),
  redundancyCtl: (req) => ipcRenderer.invoke('redundancy:ctl', req),
  redundancyMonitor: (on) => ipcRenderer.invoke('redundancy:monitor', on),
  // Vuruş eşlemesi ve kopyalanmış videolar (#815)
  reportRedTempo: (t) => ipcRenderer.send('redundancy:tempo', t),
  onRedundancyTempo: (cb) => ipcRenderer.on('redundancy-tempo', (e, d) => cb(d)),
  redundancyRemoveVideos: () => ipcRenderer.invoke('redundancy:remove-videos'),
  onRedundancyCtl: (cb) => ipcRenderer.on('redundancy-ctl', (e, d) => cb(d)),
  onRedundancyMonitor: (cb) => ipcRenderer.on('redundancy-monitor', (e, d) => cb(d)),
  redundancyRestoreArchive: (name) => ipcRenderer.invoke('redundancy:restore-archive', name),
  redundancyNewSecret: () => ipcRenderer.invoke('redundancy:new-secret'),
  redundancyCompare: () => ipcRenderer.invoke('redundancy:compare'),
  redundancyPush: () => ipcRenderer.invoke('redundancy:push'),
  // Yalıtılmış gösteri ve gösteri paketi (#812)
  redundancyUseShow: (which) => ipcRenderer.invoke('redundancy:use-show', which),
  redundancyImportScene: (id) => ipcRenderer.invoke('redundancy:import-scene', id),
  redundancyUsePrimaryAsset: (spec) => ipcRenderer.invoke('redundancy:use-primary-asset', spec),
  redundancyPkgRequest: () => ipcRenderer.invoke('redundancy:pkg-request'),
  redundancyPkgConfirm: (choice) => ipcRenderer.invoke('redundancy:pkg-confirm', choice),
  redundancyPkgCancel: () => ipcRenderer.invoke('redundancy:pkg-cancel'),
  // Gösteri öncesi denetim (#545)
  preshowCheck: () => ipcRenderer.invoke('preshow:check'),
  preshowReveal: (p) => ipcRenderer.invoke('preshow:reveal', p),
  onRedundancyStatus: (cb) => ipcRenderer.on('redundancy-status', (e, d) => cb(d)),
  // Ses köprüsü (#813)
  bridgeStatus: () => ipcRenderer.invoke('bridge:status'),
  bridgeNewSecret: () => ipcRenderer.invoke('bridge:new-secret'),
  bridgeRelaunch: () => ipcRenderer.invoke('bridge:relaunch'),
  bridgeOpenSeparate: () => ipcRenderer.invoke('bridge:open-separate'),
  onBridgeStatus: (cb) => ipcRenderer.on('bridge-status', (e, d) => cb(d)),
  onBridgeLive: (cb) => ipcRenderer.on('bridge-live', (e, d) => cb(d)),
  onGoto: (cb) => ipcRenderer.on('admin-goto', (e, d) => cb(d)),
  // Yedek birincili izlerken taşıma onun çıpasından (#544)
  onShowClockFollow: (cb) => ipcRenderer.on('show-clock-follow', (e, a) => cb(a)),

  // OSC alıcısı
  artnetStatus: () => ipcRenderer.invoke('artnet:status'),
  artnetSync: () => ipcRenderer.invoke('artnet:sync'),
  onArtnetStatus: (cb) => ipcRenderer.on('artnet-status', (e, d) => cb(d)),
  oscStatus: () => ipcRenderer.invoke('osc:status'),
  oscSync: () => ipcRenderer.invoke('osc:sync'),
  onOscMessage: (cb) => ipcRenderer.on('osc-message', (e, m) => cb(m)),
  onOscStatus: (cb) => ipcRenderer.on('osc-status', (e, d) => cb(d)),
  // OSC çıkışı (#437)
  oscOutStatus: () => ipcRenderer.invoke('oscout:status'),
  oscOutSync: () => ipcRenderer.invoke('oscout:sync'),
  onOscOutStatus: (cb) => ipcRenderer.on('oscout-status', (e, d) => cb(d)),
  reportTempoBeat: (info) => ipcRenderer.send('tempo:beat', info),
  reportTempoClock: (info) => ipcRenderer.send('tempo:clock', info),

  // Güncelleme denetimi (#640)
  updatesState: () => ipcRenderer.invoke('updates:state'),
  updatesCheck: () => ipcRenderer.invoke('updates:check'),
  updatesSkip: () => ipcRenderer.invoke('updates:skip'),
  updatesDownload: () => ipcRenderer.invoke('updates:download'),
  updatesInstall: () => ipcRenderer.invoke('updates:install'),
  updatesOpen: (which) => ipcRenderer.invoke('updates:open', which === 'asset' ? 'asset' : 'release'),
  onUpdatesStatus: (cb) => ipcRenderer.on('updates:status', (e, s) => cb(s)),

  // Medya katmanı
  pickVideo: () => ipcRenderer.invoke('media:pick-video'),
  /* Dış kaynak katmanları (layer-sources.js): Spout/Syphon girişi ve web
     sayfası. Durum, gönderici listesi ve web sayfasının düğmeleri. */
  sourcesStatus: () => ipcRenderer.invoke('sources:status'),
  sourcesAvailable: () => ipcRenderer.invoke('sources:available'),
  sourcesSenders: () => ipcRenderer.invoke('sources:senders'),
  onSourcesStatus: (cb) => ipcRenderer.on('sources-status', (e, st) => cb(st)),
  webLayerReload: (layerId) => ipcRenderer.invoke('sources:web-reload', layerId),
  webLayerInteract: (layerId) => ipcRenderer.invoke('sources:web-interact', layerId),
  webLayerClear: () => ipcRenderer.invoke('sources:web-clear'),
  claimCamRelay: (key) => ipcRenderer.invoke('cam-relay-claim', key),
  releaseCamRelay: (key) => ipcRenderer.send('cam-relay-release', key),
  sendCamFrame: (msg) => ipcRenderer.send('cam-frame', msg),
  sendCamStatus: (msg) => ipcRenderer.send('cam-status', msg),
  reportVideoDevices: (devices) => ipcRenderer.send('report-video-devices', devices),

  // Uzaktan kumandadan gelen ayar değişikliği (panel kopyasını tazeler)
  /* Kaza koruması olayları: ESC engellendi / pencere geri açıldı /
     sürekli çöktüğü için vazgeçildi. */
  onProtectionBlocked: (cb) => ipcRenderer.on('protection-blocked', () => cb()),
  onProtectionRecovered: (cb) => ipcRenderer.on('protection-recovered', (e, id) => cb(id)),
  onProtectionGaveUp: (cb) => ipcRenderer.on('protection-gave-up', (e, id) => cb(id)),
  /* Gösteri saati çıpasını tüm görselleştirici pencerelerine yolla.
     Yalnızca taşıma durumu değiştiğinde çağrılır. */
  sendShowClock: (anchor) => ipcRenderer.send('show-clock', anchor),
  /* Söz saati. Yalnızca oynat, duraklat ve durdur çıpa yollar. */
  sendLyricsClock: (anchor) => ipcRenderer.send('lyrics-clock', anchor),
  onLyricsClock: (cb) => lyricsClockEvents.subscribe(cb),
  // Çalan parça: panel önizlemesi açıkken okumayı ayakta tutar
  // Uygulama başına ses yakalama: o an ses oturumu olan uygulamalar
  listAudioApps: () => ipcRenderer.invoke('app-audio:list'),
  appAudioStatus: () => ipcRenderer.invoke('app-audio:status'),
  /* Seçicideki canlı ölçerler (#516): seçici görünürken abone ol, gizlenince
     bırak. Seviyeler { available, levels: { 'ad.exe': 0..1 } } olarak gelir. */
  appAudioMeters: (on) => ipcRenderer.send('app-audio:meters', !!on),
  onAppAudioLevels: (cb) => ipcRenderer.on('app-audio-levels', (e, data) => cb(data)),
  // macOS: Ekran Kaydı iznini iste (ScreenCaptureKit ses için de istiyor)
  requestAppAudioPermission: () => ipcRenderer.invoke('app-audio:request-permission'),
  nowPlayingSubscribe: (on) => ipcRenderer.send('nowplaying:subscribe', !!on),
  nowPlayingStatus: () => ipcRenderer.invoke('nowplaying:status'),
  nowPlayingCurrent: () => ipcRenderer.invoke('nowplaying:current'),
  mcpStatus: () => ipcRenderer.invoke('mcp:status'),
  mcpReportLive: (data) => ipcRenderer.send('mcp:live', data),
  onNowPlaying: (cb) => ipcRenderer.on('now-playing', (e, st) => cb(st)),
  onExternalConfig: (cb) => ipcRenderer.on('external-config', (e, c) => cb(c)),

  // Canlı kayıt ve anlık görüntü
  saveRecording: (bytes, opts) => ipcRenderer.invoke('record:save', bytes, opts),
  saveSnapshot: (dataUrl) => ipcRenderer.invoke('snapshot:save', dataUrl),
  // YouTube küçük resmi (#839): açık bir çıkış penceresinin kendi karesinden
  thumbnailFromOutput: () => ipcRenderer.invoke('thumbnail:from-output'),

  // Olaylar (ana süreç -> admin)
  onVisualizerStatus: (cb) =>
    ipcRenderer.on('visualizer-status', (e, data) => cb(data)),
  onDisplaysChanged: (cb) =>
    ipcRenderer.on('displays-changed', (e, data) => cb(data)),
  onRemoteAction: (cb) => ipcRenderer.on('remote-action', (e, action) => cb(action)),
  onMainFault: (cb) => ipcRenderer.on('main-fault', (e, info) => cb(info)),
  onAudioMeter: (cb) => ipcRenderer.on('audio-meter', (e, data) => cb(data)),
  onAudioSourceStatus: (cb) => ipcRenderer.on('audio-source-status', (e, data) => cb(data)),
  onVisualizerMessage: (cb) =>
    ipcRenderer.on('visualizer-message', (e, msg) => cb(msg)),
  onRequestConfirmClose: (cb) => ipcRenderer.on('request-confirm-close', () => cb()),
  confirmCloseApproved: () => ipcRenderer.send('confirm-close-approved'),

  /* Aynı ayar klasörünü kullanan başka kopyalar ve ayar dosyası çakışması
     (#564). choice: 'keep' (bu kopyadakileri kaydet) | 'load' (diskteki
     ayarları yükle). */
  instanceStatus: () => ipcRenderer.invoke('instances:status'),
  onInstanceStatus: (cb) => ipcRenderer.on('instance-status', (e, st) => cb(st)),
  resolveSettingsConflict: (choice) => ipcRenderer.invoke('settings-conflict:resolve', choice),
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
