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

   Yapılandırma uygulamanın profil klasöründen okunur ve oraya yazılır
   (src/mobile/profile-store.js, masaüstüyle aynı dosya düzeni). Uygulama
   kaynağı yokken ses demo sinyalinden (src/shared/demo-audio.js) kare
   biçiminde üretiliyor. Ölçüm araçları `window.__svHost` üzerinden yapılandırma
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
  const state = { hello: null, textIn: 0, binaryIn: 0, badBinary: 0, audioFrames: 0, nativeFrames: 0, source: 'demo', audioStatus: null, flushEvents: 0 };

  /* Uygulamadan gelen ses (src/mobile/audio-input.js): kare masaüstündekiyle
     aynı halka ve tayfla kurulur. Son gerçek kareden bu kadar süre sonra demo
     sinyale dönülür (masaüstü önizlemesinin REAL_FRAME_TIMEOUT değeri). */
  const REAL_FRAME_TIMEOUT = 700;
  let lastNativeAt = 0;
  let lastFrame = null;
  const M = window.SVMessages || null;
  const input = window.SVAudioInput ? window.SVAudioInput.create((frame) => {
    lastNativeAt = now();
    lastFrame = frame;
    state.nativeFrames++;
    state.audioFrames++;
    ev.audio.emit(frame);
  }) : null;
  function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

  function onBinary(buf) {
    const h = M && M.readHeader(buf);
    if (!h || !input) { state.badBinary++; return; }
    if (h.type === M.TYPE_PCM) {
      const m = M.readPcm(buf);
      if (m) input.pushPcm(m); else state.badBinary++;
    } else if (h.type === M.TYPE_WAVE) {
      const m = M.readWave(buf);
      if (m) input.pushWave(m); else state.badBinary++;
    }
  }
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
        onBinary(d);
      }
    };
    send({ t: 'hello', v: 1, page: env.page || '' });
  }

  function onEvent(name, v) {
    if (name === 'flush') {
      state.flushEvents++;
      profile.flush();
    } else if (name === 'powerSource') {
      onBattery = !!(v && v.onBattery);
      ev.powerSource.emit({ onBattery });
    } else if (name === 'audioStatus') {
      state.audioStatus = v;
    } else if (name === 'exportAck' || name === 'exportError') {
      onExportEvent(name, v);
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
    // Uygulamadan gerçek ses geliyorsa demo susar
    if (lastNativeAt && now() - lastNativeAt < REAL_FRAME_TIMEOUT) return;
    const t = (now() - t0) / 1000;
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

  /* ---- Ayar dosyaları (docs/android/HOST.md "Profile") ----
     Okuma bir kez, ilk requestConfig'te: v4 göçü sayfanın katman kodunu
     (window.SVLayers) istiyor ve bu betik ondan önce çalışıyor. Okuma hata
     verirse (disk, izin) kaydedici KAPALI kalır: varsayılan ayarlar
     kullanıcınınkilerin üstüne yazılmaz. */
  const P = window.SVProfileStore || null;
  const profile = {
    loaded: null,
    saver: null,
    state: { loaded: false, readError: null, broken: false, migrated: false, cleaned: [] },
    load() {
      if (this.loaded) return this.loaded;
      if (!native || !P) return (this.loaded = resolved(config));
      this.loaded = domReady().then(() => request('storeRead', { names: P.FILES })).then(async (texts) => {
        const r = P.load(texts, migrateConfig);
        if (r.broken) {
          // Çözülemeyen dosya ilk kayıttan önce kenara: kullanıcı elle kurtarabilsin
          await request('storeCopy', { from: P.MAIN, to: P.BROKEN, overwrite: true });
          this.state.broken = true;
        }
        if (r.migrated) {
          await request('storeCopy', { from: P.MAIN, to: P.V3_BACKUP, overwrite: false });
          this.state.migrated = true;
        }
        this.state.cleaned = r.cleaned || [];
        this.saver = P.createSaver({ write: (files) => request('storeWrite', { files }), seed: r.broken ? null : texts });
        this.state.loaded = true;
        if (r.cfg && !config) config = r.cfg;
        return config;
      }, (e) => {
        this.state.readError = String((e && e.message) || e);
        return config;
      });
      return this.loaded;
    },
    save(cfg) { if (this.saver) this.saver.save(cfg); },
    flush() { return this.saver ? this.saver.flush() : resolved(); },
  };

  /* Sayfanın betikleri bitene kadar beklenir: v4 göçü katman kodunu istiyor ve
     sayfanın kendisinden önce gelen bir istek (ölçüm aracı) göçü atlatmasın. */
  function domReady() {
    if (typeof document === 'undefined' || document.readyState !== 'loading' || !document.addEventListener) return resolved();
    return new Promise((r) => document.addEventListener('DOMContentLoaded', () => r(), { once: true }));
  }

  /* MASAÜSTÜNE ÖZGÜ ÇIKIŞLAR motora kapalı gider. Telefonda ışık (Dynamic
     Lighting, OpenRGB, Art-Net, sACN, WLED) ve OSC çıkışı yok, ama bilgisayardan
     gelen ayarda açık olabilirler. Ölçüldü: ışık paleti MilkDrop'tan alınıyorsa
     motor saniyede ~30 kez GPU'dan piksel okuyor (gl.readPixels işlem hattını
     bekletiyor); emülatörde kare hızı 60'tan ~4'e düşüyor ve görüntü siyah
     kalıyordu, telefonda da boşa iş. Dosyadaki değer DEĞİŞMEZ: ayar bilgisayara
     geri götürülünce ışıklar yine açık. */
  const DESKTOP_OUTPUTS = ['lighting', 'openrgb', 'artnet', 'sacn', 'wled', 'oscOut'];
  function engineView(c) {
    if (!c || typeof c !== 'object') return c;
    let out = c;
    for (const k of DESKTOP_OUTPUTS) {
      const v = c[k];
      if (!v || typeof v !== 'object' || v.enabled !== true) continue;
      if (out === c) out = Object.assign({}, c);
      out[k] = Object.assign({}, v, { enabled: false });
    }
    return out;
  }

  /* v4 göçü (src/shared/migrate-v4.js): masaüstünde ana süreç yapıyor. Katman
     kodu olmayan sayfada (dışa aktarım) yapılmaz; çevrilmemiş ayar yazılsa da
     docVersion eski kalır, sonraki açılışta çevrilir. */
  function migrateConfig(cfg) {
    const Mg = window.SVMigrateV4;
    if (!Mg || !window.SVLayers || !Mg.needsMigration(cfg)) return false;
    return Mg.migrate(cfg).changed;
  }

  /* Düzenleyicinin (Faz 3) kullanacağı yol: motor hemen uygular, dosya
     birleştirilmiş kayıtla yazılır. patch: kaydırıcı sürüklenirken yalnız
     değişen üst düzey anahtarlar (masaüstündeki config-patch). */
  function setConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return;
    config = cfg;
    ev.config.emit(engineView(cfg));
    profile.save(cfg);
  }
  function patchConfig(p) {
    if (!config || !p || typeof p !== 'object') return;
    config = Object.assign({}, config, p);
    ev.configPatch.emit(engineView(p));
    profile.save(config);
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    // Arka plana geçerken ve sayfa kapanırken bekleyen kayıt hemen yazılır
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') profile.flush(); });
  }
  if (typeof window.addEventListener === 'function') window.addEventListener('pagehide', () => { profile.flush(); });

  window.SVAndroid = Object.freeze({
    config: Object.freeze({
      get: () => config,
      set: setConfig,
      patch: patchConfig,
      flush: () => profile.flush(),
      ready: () => profile.load(),
    }),
  });

  window.SV_PLATFORM = Object.freeze({ os: 'android', isWindows: false, isMac: false, isLinux: false, isAndroid: true });
  window.SV_DISPLAY_ID = null;
  window.SV_SHARED_EPOCH = null;
  window.SV_FLOATING = false;

  /* HOST.md'deki tablo, aynı sırayla. */
  window.api = {
    requestConfig: () => profile.load().then(() => engineView(config)),
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

  /* ---- Dışa aktarım (docs/android/HOST.md "Export surface") ----
     Dışa aktarım sayfası (src/exporter, değişmeden) window.exp'i masaüstünde
     önyükleme betiğinden alıyor. Burada kareler (I420) ikili kanaldan uygulamaya
     gidiyor; kodlayıcı ve MP4 uygulamada. Kare kodlayıcıya verilince gelen
     exportAck, masaüstündeki "ffmpeg.stdin yazıldı" bekleyişinin karşılığı. */
  const exportState = { job: null, id: 0, began: null, sent: 0, acked: 0, bytes: 0, progress: [0, 0], cancel: false, result: null, error: null, analysis: null, t0: 0 };
  const acks = new Map();
  const jobListeners = listeners();
  /* İş, dışa aktarım sayfasının son betiği (exporter.js) onJob'u kurmadan önce
     gelebilir: bekletilir ve dinleyici kurulunca teslim edilir (ölçüldü: aksi
     halde iş sessizce kayboluyordu). */
  let pendingJob = null;
  let frameSeq = 0;

  function onExportEvent(name, v) {
    const index = v && v.index;
    const w = acks.get(index);
    if (name === 'exportAck') exportState.acked++;
    else exportState.error = (v && v.msg) || 'encode';
    if (w) { acks.delete(index); w(name === 'exportAck'); }
  }

  if (String(env.page || '').indexOf('src/exporter/') === 0 && !window.exp) {
    window.exp = {
      onJob: (cb) => {
        jobListeners.add(cb);
        if (pendingJob) { const j = pendingJob; pendingJob = null; cb(j); }
      },
      ready: (totalFrames) => {
        const j = exportState.job || {};
        exportState.began = request('exportBegin', {
          width: j.width, height: j.height, fps: j.fps, total: totalFrames,
          audio: j.audioName || '', name: j.outputName || '',
        }).then((r) => { exportState.id = r.job; return r; }, (e) => { exportState.error = e.message; throw e; });
      },
      sendFrame: async (data, index) => {
        const began = await exportState.began;
        const j = exportState.job;
        const buf = M.videoFrame(frameSeq++, now(), began.job, index, j.width, j.height, data);
        exportState.sent++;
        exportState.bytes += buf.byteLength;
        const ok = new Promise((resolve) => acks.set(index, resolve));
        native.postMessage(buf);
        const fine = await ok;
        return { cancel: exportState.cancel || !fine };
      },
      progress: (done, total) => { exportState.progress = [done, total]; },
      finish: () => {
        request('exportEnd').then((r) => {
          exportState.result = Object.assign({ pageMs: Math.round(now() - exportState.t0), sentMB: Math.round(exportState.bytes / 1e5) / 10 }, r);
        }, (e) => { exportState.error = e.message; });
      },
      cancelled: () => { request('exportCancel').catch(() => {}); exportState.error = 'cancelled'; },
      error: (msg) => { request('exportCancel').catch(() => {}); exportState.error = String(msg); },
      analysis: (data) => { exportState.analysis = data ? Object.keys(data).length : 0; },
      cancelRequested: () => resolved(exportState.cancel),
    };
  }

  /* WebGL BAĞLAM SAYACI (yalnız geliştirme sürümü). Android WebView'de sayfa
     başına en çok 8 etkin bağlam var (ölçüldü, masaüstünde 16); dokuzuncu açılınca
     en eskisi kaybolur. Her GL katmanı kendi bağlamını açtığı için hangi sahnenin
     sınıra ne kadar yaklaştığı burada sayılır. */
  const gl = { created: 0, lost: 0, max: 0 };
  const glRefs = [];
  function glActive() {
    let n = 0;
    for (let i = glRefs.length - 1; i >= 0; i--) {
      const c = glRefs[i].canvas.deref();
      const x = glRefs[i].ctx.deref();
      if (!c || !x) { glRefs.splice(i, 1); continue; }
      if (c.isConnected && !x.isContextLost()) n++;
    }
    return n;
  }
  if (env.debug && typeof HTMLCanvasElement !== 'undefined') {
    const orig = HTMLCanvasElement.prototype.getContext;
    const seen = new WeakSet();
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      const c = orig.call(this, type, opts);
      if (c && (type === 'webgl' || type === 'webgl2') && !seen.has(c)) {
        seen.add(c);
        gl.created++;
        if (typeof WeakRef === 'function') glRefs.push({ canvas: new WeakRef(this), ctx: new WeakRef(c) });
        this.addEventListener('webglcontextlost', () => { gl.lost++; });
      }
      return c;
    };
  }

  /* Ölçüm araçlarının kancası (yalnız geliştirme sürümü). */
  if (env.debug) {
    window.__svHost = {
      state,
      request,
      /* Yalnız motora: ölçümün uyguladığı şablonlar kullanıcının ayarlarına yazılmaz. */
      pushConfig(c) { config = c; ev.config.emit(engineView(c)); },
      saveConfig: setConfig,
      flushConfig: () => profile.flush(),
      profileState() {
        const st = profile.saver ? Object.assign({}, profile.saver.stats) : null;
        return Object.assign({}, profile.state, { saver: st, pending: !!(profile.saver && profile.saver.pending()) });
      },
      /* Dışa aktarım işi (Faz 5'te düzenleyiciden gelecek; 0E'de ölçüm aracından). */
      runExport(job) {
        Object.assign(exportState, { job, began: null, sent: 0, acked: 0, bytes: 0, cancel: false, result: null, error: null, t0: now() });
        if (jobListeners.size) jobListeners.emit(job);
        else pendingJob = job;
      },
      exportState() { return Object.assign({}, exportState, { job: null, began: !!exportState.began }); },
      cancelExport() { exportState.cancel = true; },
      /* WebGL bağlamları: açılan, kaybolan, şu an etkin (kayıp olmayan) ve en çok. */
      glContexts() {
        const active = glActive();
        if (active > gl.max) gl.max = active;
        return Object.assign({ active }, gl);
      },
      patchConfig(p) { ev.configPatch.emit(engineView(p)); },
      savePatch: patchConfig,
      setAudioSource(name) { state.source = name; },
      audioStart(source) { return request('audioStart', { source }); },
      audioStop() { return request('audioStop'); },
      audioStats() { return input ? Object.assign({}, input.stats) : null; },
      /* Son gerçek karenin kopyası (ölçüm: tayftaki tepeler doğru yerde mi). */
      peekFrame() {
        if (!lastFrame) return null;
        return { freq: Array.from(lastFrame.freq), time: Array.from(lastFrame.time), sampleRate: lastFrame.sampleRate };
      },
    };
  }
})();
