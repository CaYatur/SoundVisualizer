/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ANDROID SUNUCUSU: motorun beklediği window.api yüzeyi (#1054).

   Masaüstünde bu yüzeyi önyükleme betiği (preload-visualizer.js), tarayıcıda
   web-shim.js sağlıyor. Android'de Kotlin kabuğu bu dosyayı sayfanın kendi
   betiklerinden ÖNCE çalıştırıyor; böylece masaüstündeki görselleştirici
   sayfası değişmeden açılıyor.

   Sözleşme docs/android/HOST.md'de: preload-visualizer.js'teki her yöntem
   burada TANIMLI. Android'de anlamı olmayanlar boş değer döndürür ya da hiç
   tetiklenmez; motor Android yüzünden `typeof` denetimi yapmak zorunda kalmaz.

   0E durumu: yapılandırma ve ses henüz gerçek kaynaktan gelmiyor. Ses, demo
   sinyalinden (src/shared/demo-audio.js, kabuk ondan önce yüklüyor) kare
   biçiminde üretiliyor; ölçüm araçları `window.__svHost` üzerinden yapılandırma
   gönderebiliyor (yalnız geliştirme sürümünde). */
(function () {
  if (typeof window === 'undefined' || window.api) return;
  const env = window.__SV_ANDROID || { debug: false, page: '' };

  // ---- Masaüstü kare biçimi (src/main/audio-frame.js) ----
  const FFT_SIZE = 2048;
  const BINS = FFT_SIZE / 2;

  function listeners() {
    const list = [];
    return {
      add(cb) { if (typeof cb === 'function') list.push(cb); },
      emit(v) {
        for (let i = 0; i < list.length; i++) {
          try { list[i](v); } catch (e) { console.error('[android-host]', e); }
        }
      },
      get size() { return list.length; },
    };
  }

  const ev = {
    config: listeners(), configPatch: listeners(), audio: listeners(), presets: listeners(),
    presetsDelta: listeners(), powerSource: listeners(), nowPlaying: listeners(), windowChrome: listeners(),
    showClock: listeners(), lyricsClock: listeners(), lyricsLib: listeners(), mdSprite: listeners(),
    texturesChanged: listeners(), mediaScrub: listeners(), exitHint: listeners(),
  };

  let config = null;
  const presets = [];
  let presetsGen = 0;
  let geometryLock = false;
  let onBattery = false;

  // ---- Kanal (docs/android/MESSAGES.md) ----
  const native = typeof window.SVNative === 'object' && window.SVNative ? window.SVNative : null;
  const state = { hello: null, textIn: 0, binaryIn: 0, audioFrames: 0, source: 'demo' };
  let nextId = 1;
  const pending = new Map();

  function send(obj) {
    if (!native) return false;
    try { native.postMessage(JSON.stringify(obj)); return true; } catch { return false; }
  }

  function request(op, args) {
    if (!native) return Promise.reject(new Error('native-missing'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ t: 'req', id, op, a: args || {} });
    });
  }

  if (native) {
    native.onmessage = (e) => {
      const d = e && e.data;
      if (typeof d === 'string') {
        state.textIn++;
        let m;
        try { m = JSON.parse(d); } catch { return; }
        if (m.t === 'hello') state.hello = m;
        else if (m.t === 'res' && pending.has(m.id)) {
          const p = pending.get(m.id);
          pending.delete(m.id);
          if (m.ok) p.resolve(m.v); else p.reject(new Error(m.err || 'error'));
        } else if (m.t === 'evt') onEvent(m.ev, m.v);
      } else if (d instanceof ArrayBuffer) {
        state.binaryIn++;
      }
    };
    send({ t: 'hello', v: 1, page: env.page || '' });
  }

  function onEvent(name, v) {
    if (name === 'powerSource') {
      onBattery = !!(v && v.onBattery);
      ev.powerSource.emit({ onBattery });
    }
  }

  // ---- Demo ses (0E) ----
  const demo = {
    freq: new Uint8Array(BINS),
    time: new Uint8Array(FFT_SIZE),
    left: new Uint8Array(FFT_SIZE),
    right: new Uint8Array(FFT_SIZE),
    sampleRate: 48000,
  };
  let demoTimer = 0;
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();

  function demoTick() {
    const D = window.SVDemoAudio;
    if (!D || !ev.audio.size || state.source !== 'demo') return;
    const t = ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) / 1000;
    D.spectrum(t, demo.freq);
    D.fill(Math.floor(t * D.SR), demo.time, demo.left, demo.right);
    demo.sampleRate = D.SR || 48000;
    state.audioFrames++;
    ev.audio.emit(demo);
  }

  function startDemo() {
    if (demoTimer || typeof setInterval !== 'function') return;
    demoTimer = setInterval(demoTick, 1000 / 60);
  }

  const resolved = (v) => Promise.resolve(v);
  const noop = () => {};

  window.SV_PLATFORM = Object.freeze({ os: 'android', isWindows: false, isMac: false, isLinux: false, isAndroid: true });
  window.SV_DISPLAY_ID = null;
  window.SV_SHARED_EPOCH = null;
  window.SV_FLOATING = false;

  /* HOST.md'deki tablo, aynı sırayla. */
  window.api = {
    requestConfig: () => resolved(config),
    onConfig: (cb) => ev.config.add(cb),
    onConfigPatch: (cb) => ev.configPatch.add(cb),
    onShowClock: (cb) => ev.showClock.add(cb),
    onMomentaryFx: noop, // Android'de anlık efekt yok (D6)
    onMediaScrub: (cb) => ev.mediaScrub.add(cb),
    onTbar: noop, // T-bar yok (D6)
    onSharedClock: noop, // yedeklilik oturum saati yalnız masaüstünde
    getSharedClock: () => resolved(null),
    onLyricsClock: (cb) => ev.lyricsClock.add(cb),
    onNowPlaying: (cb) => ev.nowPlaying.add(cb),
    nowPlayingCurrent: () => resolved(null),
    onNativeAudio: (cb) => { ev.audio.add(cb); startDemo(); },
    sendAudioMeter: noop,
    sendOscHit: noop, // OSC yok
    sendMessage: noop,
    claimCamRelay: () => resolved(false), // kamera aktarımı yayın istemcileri içindir
    releaseCamRelay: noop,
    sendCamFrame: noop,
    sendCamStatus: noop,
    screenSources: () => resolved([]),
    getPresets: () => resolved(presets.slice()),
    milkdropPresetSource: () => resolved(null),
    getPowerSource: () => resolved({ onBattery }),
    onPowerSource: (cb) => ev.powerSource.add(cb),
    onPresets: (cb) => ev.presets.add(cb),
    onPresetsDelta: (cb) => ev.presetsDelta.add(cb),
    presetsHead: () => resolved(presetsGen),
    presetsSince: () => resolved(null),
    milkdropTextures: () => resolved([]),
    milkdropTexture: () => resolved(null),
    onMilkdropTexturesChanged: (cb) => ev.texturesChanged.add(cb),
    logoLibRead: () => resolved(null),
    lyricsLibSnapshot: () => resolved([]),
    lyricsLibRead: () => resolved(null),
    onLyricsLib: (cb) => ev.lyricsLib.add(cb),
    floatingClose: noop,
    floatingSnap: noop,
    floatingSize: noop,
    onWindowChrome: (cb) => ev.windowChrome.add(cb),
    onExitHint: (cb) => ev.exitHint.add(cb),
    setGeometryLock: (locked) => { geometryLock = !!locked; },
    getGeometryLock: () => resolved(geometryLock),
    onMdFollow: noop, // yedeklilik (#585)
    onMdSprite: (cb) => ev.mdSprite.add(cb),
    milkdropSpriteImage: () => resolved(null),
    milkdropSprite: () => resolved(null),
  };

  /* Ölçüm araçlarının kancası (yalnız geliştirme sürümü). */
  if (env.debug) {
    window.__svHost = {
      state,
      request,
      pushConfig(c) { config = c; ev.config.emit(c); },
      patchConfig(p) { ev.configPatch.emit(p); },
      setAudioSource(name) { state.source = name; },
    };
  }
})();
