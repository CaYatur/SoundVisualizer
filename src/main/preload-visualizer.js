/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/* Son çalan parça burada durur. Sayfa dinleyiciyi geç kurar; Electron
   aradaki mesajı tutmaz. Bu dosya kum havuzundadır: electron dışında
   require çalışmaz, o yüzden yardımcı buraya gömülüdür. */
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
const nowPlayingEvents = createLateEvent();
ipcRenderer.on('now-playing', (_e, st) => nowPlayingEvents.push(st));
const lyricsClockEvents = createLateEvent();
ipcRenderer.on('lyrics-clock', (_e, anchor) => lyricsClockEvents.push(anchor));

contextBridge.exposeInMainWorld('SV_PLATFORM', {
  os: process.platform,
  isWindows: process.platform === 'win32',
  isMac: process.platform === 'darwin',
  isLinux: process.platform === 'linux',
});

// Bu pencerenin ekran kimliği (ana süreç komut satırında veriyor).
// Projeksiyon haritalaması ekran başına tanımlandığı için gerekli.
const displayArg = process.argv.find((a) => a.startsWith('--sv-display-id='));
contextBridge.exposeInMainWorld('SV_DISPLAY_ID',
  displayArg ? Number(displayArg.split('=')[1]) : null);
// Ortak oturum saati (#543): ilk kareden itibaren; sonraki değişimler iletiyle
const epochArg = process.argv.find((a) => a.startsWith('--sv-shared-epoch='));
const epochVal = epochArg ? Number(epochArg.split('=')[1]) : NaN;
contextBridge.exposeInMainWorld('SV_SHARED_EPOCH', Number.isFinite(epochVal) ? epochVal : null);
contextBridge.exposeInMainWorld('SV_FLOATING',
  process.argv.some((a) => a === '--sv-floating=1' || a.startsWith('--sv-floating=')));

contextBridge.exposeInMainWorld('api', {
  requestConfig: () => ipcRenderer.invoke('request-config'),
  onConfig: (cb) => ipcRenderer.on('config', (e, config) => cb(config)),
  onConfigPatch: (cb) => ipcRenderer.on('config-patch', (e, patch) => cb(patch)),
  /* Gösteri saati çıpası. Yalnızca DURUM DEĞİŞTİĞİNDE gelir; zaman her
     karede yeniden yollanmaz, pencere çıpadan kapalı formülle hesaplar. */
  onShowClock: (cb) => ipcRenderer.on('show-clock', (e, anchor) => cb(anchor)),
  // Yedeklilik (#544): iki makinede ortak oturum saati (modülasyon evresi)
  onSharedClock: (cb) => ipcRenderer.on('shared-clock', (e, c) => cb(c)),
  // Dinleyici kurulmadan gelen ileti kaybolur: pencere açılışta ister (#543)
  getSharedClock: () => ipcRenderer.invoke('shared-clock:get'),
  /* Söz saati çıpası sayfa dinleyiciyi geç kurabilir. Son çıpa burada durur. */
  onLyricsClock: (cb) => lyricsClockEvents.subscribe(cb),
  /* Çalan parça çıpası. Konum HER KARE gelmez; kaynak ancak ara sıra
     güncelliyor, aradaki değeri pencere kendisi hesaplıyor.
     (bkz. src/shared/nowplaying.js) */
  onNowPlaying: (cb) => nowPlayingEvents.subscribe(cb),
  nowPlayingCurrent: () => ipcRenderer.invoke('nowplaying:current'),
  onNativeAudio: (cb) => ipcRenderer.on('native-audio', (e, frame) => cb(frame)),
  sendAudioMeter: (data) => ipcRenderer.send('audio-meter', data),
  sendOscHit: (hits) => ipcRenderer.send('osc-hit', hits),
  sendMessage: (msg) => ipcRenderer.send('visualizer-message', msg),
  claimCamRelay: (key) => ipcRenderer.invoke('cam-relay-claim', key),
  releaseCamRelay: (key) => ipcRenderer.send('cam-relay-release', key),
  sendCamFrame: (msg) => ipcRenderer.send('cam-frame', msg),
  sendCamStatus: (msg) => ipcRenderer.send('cam-status', msg),
  // Studio presetleri ana süreçte tutulur (settings.json şişmesin diye)
  getPresets: () => ipcRenderer.invoke('presets:list'),
  onPresets: (cb) => ipcRenderer.on('presets', (e, list) => cb(list)),
  // Değişiklik yayını (#574): bütün liste yerine yalnız değişenler
  onPresetsDelta: (cb) => ipcRenderer.on('presets-delta', (e, d) => cb(d)),
  presetsHead: () => ipcRenderer.invoke('presets:head'),
  presetsSince: (gen) => ipcRenderer.invoke('presets:since', gen),
  /* MilkDrop doku paketi: preset kendi görselini ada göre istiyor
     (`sampler_worms` -> `worms.jpg`). Yalnızca yapılandırmada seçili
     klasörün içi okunuyor; kapsam denetimi ana süreçte. */
  milkdropTextures: () => ipcRenderer.invoke('milkdrop:textures'),
  milkdropTexture: (name) => ipcRenderer.invoke('milkdrop:texture', name),
  logoLibRead: (id) => ipcRenderer.invoke('logo-lib:read', id),
  lyricsLibSnapshot: () => ipcRenderer.invoke('lyrics-lib:snapshot'),
  lyricsLibRead: (id) => ipcRenderer.invoke('lyrics-lib:read', id),
  onLyricsLib: (cb) => ipcRenderer.on('lyrics-lib', (e, items) => cb(items)),
  floatingClose: () => ipcRenderer.send('floating:close'),
  floatingSnap: (where) => ipcRenderer.send('floating:snap', where),
  floatingSize: (kind) => ipcRenderer.send('floating:size', kind),
  onWindowChrome: (cb) => ipcRenderer.on('window-chrome', (e, st) => cb(st)),
  setGeometryLock: (locked) => ipcRenderer.send('visualizer:geometry-lock', !!locked),
  getGeometryLock: () => ipcRenderer.invoke('visualizer:geometry-lock-get'),
  // Liderin MilkDrop seçimi (#585): bu pencere izleyiciyse gelir
  onMdFollow: (cb) => ipcRenderer.on('md-follow', (e, p) => cb(p)),
  /* MilkDrop sprite'ları (#577): başlatma/silme komutları her motora gelir;
     resim kimlikle istenir, yol ana süreçte kalır. Pencerenin tuşları
     (K + iki hane...) komutu ana sürece yollar. */
  onMdSprite: (cb) => ipcRenderer.on('md-sprite', (e, c) => cb(c)),
  milkdropSpriteImage: (key) => ipcRenderer.invoke('milkdrop:sprite-image', key),
  milkdropSprite: (req) => ipcRenderer.invoke('milkdrop:sprite', req),
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
