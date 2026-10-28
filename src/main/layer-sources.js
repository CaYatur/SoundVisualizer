/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* DIŞ KAYNAK KATMANLARININ ANA SÜREÇ TARAFI.

   Spout/Syphon girişi ve web sayfası katmanı. Her kaynak ana süreçte BİR
   kez açılır; kareler, kaynağı isteyen her pencereye (ekranlar, panel
   önizlemesi, Spout çıkışı, dışa aktarıcı) dağıtılır. Pencere başına ayrı
   alıcı ya da ayrı sayfa açmak hem GPU'yu hem göndericiyi boşa yorardı ve
   iki ekran aynı sayfanın iki ayrı hâlini gösterirdi.

   KARE YOLU (GPU). Spout alıcısı her karede paylaşılan bir doku tutamacı
   verir; web sayfası görünmez pencerede çizilir ve `paint` olayı dokuyu
   verir. İkisi de `sharedTexture.importSharedTexture` ile alınır ve
   `sendSharedTexture` ile pencerelere gider; pencerenin önyükleme betiği
   dokudan bir VideoFrame alıp kendi tuvaline çizer. CPU'ya kopya yok.
   Ölçüldü (Electron 44.9.0, Windows): 1280x720'de 60 fps, karelerin
   tamamı, GPU belleği 20 sn boyunca sabit.

   YEDEK YOL (CPU). Doku alınamazsa (sürücü, platform; Linux'ta web katmanı
   her zaman) kare bit eşlem olarak gider, en çok 30 fps.

   SAHİPLİK. Her doku ve tutamaç HER YOLDA bırakılır: içe alınmayan Spout
   tutamacı `closeNativeHandle` ile, içe alınan doku `release` ile, web
   sayfasının dokusu son başvuru bırakılınca. Bırakılmayan her kare bir GPU
   kaynağı ya da bir sistem tutamacı sızdırır; uzun gösteride bellek biter.

   GERİ BASKI. Bir pencere önceki kareyi henüz almadıysa o pencereye bu kare
   gitmez. Yavaş bir pencere (küçültülmüş panel) diğerlerini bekletmez.

   Ömür: katman sahneden çıkınca kaynak 3 sn sonra kapanır. Sahne geçişi
   sırasında giden sahne hâlâ çiziliyor; kaynak hemen kapansa geçişin
   yarısında kaybolurdu. Katman kapalı ya da sessizse kaynak açık kalır ama
   kare üretmez: geri açılınca sayfa baştan yüklenmez. */

const SL = require('../shared/source-layers.js');
const WG = require('./web-layer-guard.js');

const GRACE_MS = 3000;
/* Alıcı 120 Hz yoklanır. 60 Hz yoklama Windows'un zamanlayıcı
   çözünürlüğüne (15,6 ms) takılıp 60 fps bir göndericiden ~41 fps alıyordu;
   yoklama ucuz (yeni kare yoksa bir bayrak okuması). */
const POLL_MS = 1000 / 120;
const CPU_MAX_FPS = 30;
const STALE_MS = 1500;
const RECONNECT_MS = 3000;
const CRASH_BACKOFF = [1000, 2000, 4000, 8000, 16000, 30000];
const GPU_FAILS_TO_CPU = 3;

function create(deps) {
  const electron = deps.electron;
  const { BrowserWindow, session } = electron;
  const sharedTexture = deps.sharedTexture !== undefined ? deps.sharedTexture : electron.sharedTexture;
  const loadBridge = deps.loadBridge || (() => null);
  const ownSenderNames = deps.ownSenderNames || (() => []);
  const appPorts = deps.appPorts || (() => []);
  const platform = deps.platform || process.platform;
  const log = deps.log || (() => {});
  const onStatus = deps.onStatus || (() => {});
  const now = deps.now || (() => Date.now());

  const consumers = new Map(); // webContents.id -> tüketici
  const sources = new Map(); // anahtar -> kaynak
  const removals = new Map(); // anahtar -> zamanlayıcı
  let allowedLocal = new Set();
  let webSession = null;
  let blockedLog = [];

  function ctx() {
    return { allowedLocal, appPorts: new Set((appPorts() || []).filter((p) => Number.isInteger(p) && p > 0)) };
  }

  function noteBlocked(info) {
    blockedLog.push(Object.assign({ at: now() }, info));
    if (blockedLog.length > 50) blockedLog = blockedLog.slice(-50);
    for (const s of sources.values()) {
      if (s.kind === 'web' && s.ownsContents(info.webContentsId)) s.noteBlocked(info);
    }
  }

  function getWebSession() {
    if (webSession) return webSession;
    webSession = session.fromPartition(WG.PARTITION);
    WG.hardenSession(webSession, ctx, noteBlocked);
    return webSession;
  }

  // ---- Tüketiciler (kareyi çizen pencereler) ----------------------------

  function addConsumer(wc, info) {
    if (!wc || wc.isDestroyed()) return;
    let c = consumers.get(wc.id);
    if (!c) {
      c = { wc, gpu: true, ready: true, busy: new Map(), fails: 0, lastCpu: new Map() };
      consumers.set(wc.id, c);
      wc.once('destroyed', () => consumers.delete(c.wc.id));
      wc.on('render-process-gone', () => { c.ready = false; c.busy.clear(); });
      wc.on('did-start-navigation', (d) => {
        // Sayfa yeniden yükleniyor: alıcı yeniden kurulana dek kare yollama
        const main = d && typeof d.isMainFrame === 'boolean' ? d.isMainFrame : true;
        const same = d && d.isSameDocument;
        if (main && !same) { c.ready = false; c.busy.clear(); }
      });
    }
    c.gpu = !(info && info.gpu === false) && !!sharedTexture;
    c.ready = true;
    c.fails = 0;
  }

  function readyConsumers(key) {
    const out = [];
    for (const c of consumers.values()) {
      if (!c.ready || c.wc.isDestroyed()) continue;
      if (c.busy.get(key)) continue;
      out.push(c);
    }
    return out;
  }

  function anyConsumer() {
    for (const c of consumers.values()) if (c.ready && !c.wc.isDestroyed()) return true;
    return false;
  }

  /* İçe alınmış bir dokuyu hazır pencerelere dağıtır; hepsi bitince bırakır.
     false: hiçbir pencere almadı (doku yine de bırakıldı). */
  function deliverTexture(key, imported, opaque) {
    const targets = readyConsumers(key).filter((c) => c.gpu);
    if (!targets.length) {
      try { imported.release(); } catch { /* bırakıldı */ }
      return false;
    }
    let pending = targets.length;
    const done = () => {
      if (--pending === 0) { try { imported.release(); } catch { /* bırakıldı */ } }
    };
    for (const c of targets) {
      c.busy.set(key, 1);
      let p;
      try {
        p = sharedTexture.sendSharedTexture({ frame: c.wc.mainFrame, importedSharedTexture: imported }, { key, opaque: !!opaque });
      } catch (err) {
        p = Promise.reject(err);
      }
      Promise.resolve(p).then(() => { c.fails = 0; }, (err) => {
        /* Alıcı yok ya da sayfa kapanıyor. Üst üste düşerse pencere
           bit eşlem yoluna geçer: onun önyükleme betiği dokuyu alamıyor. */
        if (++c.fails >= GPU_FAILS_TO_CPU * 3) c.gpu = false;
        log('layer-sources: send ' + key + ' ' + (err && err.message));
      }).finally(() => { c.busy.delete(key); done(); });
    }
    return true;
  }

  /* Bit eşlem yolu: BGRA ya da RGBA bayt dizisi. Pencere başına en çok
     CPU_MAX_FPS; dokuyu alabilen pencereye bu yol gitmez (`gpuToo` değilse). */
  function deliverBitmap(key, w, h, format, data, gpuToo, opaque) {
    const t = now();
    let sent = 0;
    for (const c of consumers.values()) {
      if (!c.ready || c.wc.isDestroyed()) continue;
      if (c.gpu && !gpuToo) continue;
      const last = c.lastCpu.get(key) || 0;
      if (t - last < 1000 / CPU_MAX_FPS) continue;
      c.lastCpu.set(key, t);
      try {
        c.wc.send('sources:bitmap', { key, w, h, format, data, opaque: !!opaque });
        sent++;
      } catch { /* pencere kapanıyor */ }
    }
    return sent;
  }

  function dropEverywhere(key) {
    for (const c of consumers.values()) {
      if (c.wc.isDestroyed()) continue;
      try { c.wc.send('sources:drop', key); } catch { /* pencere kapanıyor */ }
    }
  }

  // ---- Ortak kaynak durumu --------------------------------------------

  function baseState(kind) {
    return { kind, state: 'starting', width: 0, height: 0, fps: 0, path: '', error: '', frames: 0, dropped: 0 };
  }

  function fpsMeter() {
    let count = 0;
    let since = now();
    let fps = 0;
    return {
      tick() { count++; },
      read() {
        const t = now();
        const dt = t - since;
        if (dt >= 1000) { fps = Math.round((count * 1000 / dt) * 10) / 10; count = 0; since = t; }
        return fps;
      },
    };
  }

  // ---- Spout / Syphon girişi -------------------------------------------

  function createInput(key, spec) {
    const st = baseState('input');
    const meter = fpsMeter();
    let receiver = null;
    let timer = null;
    let active = false;
    let lastFrameAt = 0;
    let lastTryAt = 0;
    let gpuFails = 0;
    let cpu = !sharedTexture;
    let cfg = spec;

    function open() {
      const b = loadBridge();
      if (!b || typeof b.TextureReceiver !== 'function') {
        st.state = 'error';
        st.error = platform === 'linux' ? 'UNSUPPORTED_PLATFORM' : 'NATIVE_MISSING';
        return false;
      }
      try {
        receiver = new b.TextureReceiver(cfg.sender, cfg.app || null, null);
        st.error = '';
        st.state = 'waiting';
        return true;
      } catch (err) {
        receiver = null;
        st.state = 'error';
        st.error = String((err && err.message) || err).slice(0, 200);
        return false;
      }
    }

    function close() {
      if (receiver) { try { receiver.stop(); } catch { /* durdu */ } }
      receiver = null;
    }

    function pollOnce() {
      const t = now();
      if (!receiver) {
        if (t - lastTryAt >= RECONNECT_MS) { lastTryAt = t; open(); }
        return;
      }
      let fresh = false;
      try { fresh = receiver.hasNewFrame(); } catch { fresh = false; }
      if (!fresh) {
        if (lastFrameAt && t - lastFrameAt > STALE_MS && st.state === 'live') st.state = 'waiting';
        /* Gönderici kapanıp yeniden açılınca bazı göndericiler yeni bir
           paylaşım nesnesi kuruyor; alıcıyı ara ara yenilemek bağlantıyı
           geri getiriyor. */
        let connected = true;
        try { connected = receiver.isConnected(); } catch { connected = false; }
        if (!connected && t - lastTryAt >= RECONNECT_MS) { lastTryAt = t; close(); open(); }
        return;
      }
      if (!active || !anyConsumer()) return; // kare beklesin, boşa alma
      if (!cpu && readyConsumers(key).some((c) => c.gpu)) {
        let f = null;
        try { f = receiver.receiveSharedTexture(); } catch (err) { f = null; st.error = String(err && err.message).slice(0, 200); }
        if (!f) return;
        let imported = null;
        try {
          const handle = platform === 'darwin' ? { ioSurface: f.handle } : { ntHandle: f.handle };
          imported = sharedTexture.importSharedTexture({
            textureInfo: { pixelFormat: f.pixelFormat, codedSize: { width: f.width, height: f.height }, handle },
          });
        } catch (err) {
          try { loadBridge().closeNativeHandle(f.handle); } catch { /* kapatıldı */ }
          st.dropped++;
          st.error = String((err && err.message) || err).slice(0, 200);
          if (++gpuFails >= GPU_FAILS_TO_CPU) { cpu = true; log('layer-sources: ' + key + ' bit eşlem yoluna geçti: ' + st.error); }
          return;
        }
        gpuFails = 0;
        st.width = f.width;
        st.height = f.height;
        st.path = 'gpu';
        frame(t);
        deliverTexture(key, imported, !cfg.alpha);
        if (consumersWithoutGpu()) cpuCopy(t, true);
        return;
      }
      cpuCopy(t, false);
    }

    function consumersWithoutGpu() {
      for (const c of consumers.values()) if (c.ready && !c.gpu && !c.wc.isDestroyed()) return true;
      return false;
    }

    function cpuCopy(t, gpuToo) {
      let f = null;
      try { f = receiver.receiveFrame(); } catch { f = null; }
      if (!f || !f.data) return;
      st.width = f.width;
      st.height = f.height;
      if (!gpuToo) { st.path = 'cpu'; frame(t); }
      deliverBitmap(key, f.width, f.height, 'rgba', f.data, !gpuToo, !cfg.alpha);
    }

    function frame(t) {
      lastFrameAt = t;
      st.frames++;
      st.state = 'live';
      st.error = '';
      meter.tick();
    }

    return {
      kind: 'input',
      key,
      start() {
        lastTryAt = now();
        open();
        timer = setInterval(pollOnce, POLL_MS);
        if (timer.unref) timer.unref();
      },
      update(next, isActive) {
        if (next.sender !== cfg.sender || next.app !== cfg.app) { cfg = next; close(); lastTryAt = now(); open(); }
        cfg = next;
        active = !!isActive;
      },
      status() {
        return Object.assign({}, st, { fps: meter.read(), sender: cfg.sender, app: cfg.app, active });
      },
      pause() { active = false; },
      stop() {
        if (timer) clearInterval(timer);
        timer = null;
        close();
        st.state = 'stopped';
      },
      ownsContents() { return false; },
      noteBlocked() {},
      _poll: pollOnce,
    };
  }

  // ---- Web sayfası -------------------------------------------------------

  function createWeb(key, layerId, spec) {
    const st = Object.assign(baseState('web'), { title: '', origin: '', blocked: 0, lastBlocked: '' });
    const meter = fpsMeter();
    let cfg = spec;
    let win = null;
    let interactWin = null;
    let active = false;
    let gpu = !!sharedTexture && platform !== 'linux';
    let gpuFails = 0;
    let cssKey = null;
    let reloadTimer = null;
    let crashTimer = null;
    let crashes = 0;
    let loadedUrl = '';
    let stopped = false;

    function checked() {
      const r = SL.checkUrl(cfg.url);
      if (!r.ok) return r;
      const d = WG.decide(r.url, ctx());
      return d.ok ? r : { ok: false, reason: d.reason };
    }

    function build() {
      destroyWindow();
      const r = checked();
      if (!r.ok) {
        st.state = 'error';
        st.error = r.reason;
        return;
      }
      const ses = getWebSession();
      win = new BrowserWindow({
        show: false,
        width: cfg.width,
        height: cfg.height,
        useContentSize: true,
        frame: false,
        transparent: !!cfg.transparent,
        backgroundColor: cfg.transparent ? '#00000000' : '#ffffff',
        paintWhenInitiallyHidden: true,
        webPreferences: WG.webPreferences({
          session: ses,
          offscreen: gpu ? { useSharedTexture: true } : true,
          zoomFactor: cfg.zoom,
        }),
      });
      const wc = win.webContents;
      WG.guardContents(wc, ctx, { onBlocked: (info) => noteBlocked(Object.assign({ webContentsId: wc.id }, info)) });
      wc.setAudioMuted(!cfg.audio);
      try { wc.setBackgroundThrottling(false); } catch { /* eski sürüm */ }
      wc.setFrameRate(cfg.fps);
      wc.on('paint', onPaint);
      wc.on('dom-ready', applyCss);
      wc.on('page-title-updated', (_e, title) => { st.title = String(title || '').slice(0, 200); });
      wc.on('did-start-loading', () => { if (st.state !== 'live') st.state = 'loading'; });
      wc.on('did-finish-load', () => {
        crashes = 0;
        st.error = '';
        try { st.origin = WG.safeUrl(wc.getURL()); } catch { /* yok */ }
        if (active) { try { wc.startPainting(); wc.invalidate(); } catch { /* kapanıyor */ } }
      });
      wc.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
        if (!isMainFrame || code === -3) return; // -3: iptal (yeni gezinme)
        st.state = 'error';
        st.error = 'LOAD_FAILED:' + code + ' ' + String(desc || '').slice(0, 80);
      });
      wc.on('render-process-gone', (_e, details) => {
        st.state = 'crashed';
        st.error = 'CRASHED:' + String((details && details.reason) || '');
        scheduleCrashReload();
      });
      wc.on('unresponsive', () => { st.state = 'unresponsive'; });
      wc.on('responsive', () => { if (st.state === 'unresponsive') st.state = 'live'; });
      win.on('closed', () => { win = null; });
      loadedUrl = r.url;
      st.state = 'loading';
      wc.loadURL(r.url).catch(() => { /* did-fail-load bildirir */ });
      setActive(active);
      armReload();
    }

    function applyCss() {
      if (!win || win.isDestroyed()) return;
      const wc = win.webContents;
      const css = (cfg.transparent ? 'html,body{background:transparent !important;}' : '') + (cfg.css || '');
      const prev = cssKey;
      cssKey = null;
      if (prev) wc.removeInsertedCSS(prev).catch(() => {});
      if (!css.trim()) return;
      wc.insertCSS(css, { cssOrigin: 'user' }).then((k) => { cssKey = k; }).catch(() => {});
    }

    function armReload() {
      if (reloadTimer) clearInterval(reloadTimer);
      reloadTimer = null;
      if (cfg.reloadMin > 0) {
        reloadTimer = setInterval(() => { if (win && !win.isDestroyed()) win.webContents.reload(); }, cfg.reloadMin * 60000);
        if (reloadTimer.unref) reloadTimer.unref();
      }
    }

    function scheduleCrashReload() {
      if (crashTimer || stopped) return;
      if (crashes >= CRASH_BACKOFF.length) { st.state = 'failed'; return; }
      const wait = CRASH_BACKOFF[crashes++];
      crashTimer = setTimeout(() => {
        crashTimer = null;
        if (stopped) return;
        build();
      }, wait);
      if (crashTimer.unref) crashTimer.unref();
    }

    function onPaint(e, _dirty, image) {
      const tex = e && e.texture;
      if (tex) {
        if (!active || !readyConsumers(key).length) { try { tex.release(); } catch { /* bırakıldı */ } return; }
        let imported = null;
        try {
          imported = sharedTexture.importSharedTexture({
            textureInfo: tex.textureInfo,
            allReferencesReleased: () => { try { tex.release(); } catch { /* bırakıldı */ } },
          });
        } catch (err) {
          try { tex.release(); } catch { /* bırakıldı */ }
          st.dropped++;
          st.error = String((err && err.message) || err).slice(0, 200);
          if (++gpuFails >= GPU_FAILS_TO_CPU) {
            gpu = false;
            log('layer-sources: ' + key + ' bit eşlem yoluna geçti: ' + st.error);
            setImmediate(build);
          }
          return;
        }
        gpuFails = 0;
        const cs = tex.textureInfo && tex.textureInfo.codedSize;
        if (cs) { st.width = cs.width; st.height = cs.height; }
        st.path = 'gpu';
        tick();
        deliverTexture(key, imported, !cfg.transparent);
        return;
      }
      if (!image || !active || !anyConsumer()) return;
      const size = image.getSize();
      st.width = size.width;
      st.height = size.height;
      st.path = 'cpu';
      tick();
      deliverBitmap(key, size.width, size.height, 'bgra', image.toBitmap(), true, !cfg.transparent);
    }

    function tick() {
      st.frames++;
      if (st.state === 'loading' || st.state === 'starting') st.state = 'live';
      else if (st.state !== 'error' && st.state !== 'unresponsive') st.state = 'live';
      meter.tick();
    }

    function setActive(on) {
      active = !!on;
      if (!win || win.isDestroyed()) return;
      try {
        if (active) { win.webContents.startPainting(); win.webContents.invalidate(); } else win.webContents.stopPainting();
      } catch { /* kapanıyor */ }
    }

    function destroyWindow() {
      if (win && !win.isDestroyed()) {
        const dying = win;
        win = null;
        try { dying.webContents.stopPainting(); } catch { /* kapanıyor */ }
        /* `paint` dinleyicisi pencere yok olana dek kalır: son karenin dokusu
           bırakılmazsa kare havuzu tıkanır (bkz. texture-share.js). */
        dying.destroy();
      }
      win = null;
      cssKey = null;
    }

    function interact() {
      if (!win || win.isDestroyed()) build();
      if (interactWin && !interactWin.isDestroyed()) { interactWin.focus(); return true; }
      const r = checked();
      if (!r.ok) return false;
      const ses = getWebSession();
      interactWin = new BrowserWindow({
        width: Math.min(1600, Math.max(800, cfg.width)),
        height: Math.min(1000, Math.max(600, cfg.height)),
        title: 'Web katmanı',
        autoHideMenuBar: true,
        backgroundColor: '#ffffff',
        webPreferences: WG.webPreferences({ session: ses }),
      });
      const iw = interactWin.webContents;
      WG.guardContents(iw, ctx, { allowPopups: true, onBlocked: (info) => noteBlocked(Object.assign({ webContentsId: iw.id }, info)) });
      iw.setAudioMuted(!cfg.audio);
      let current = r.url;
      try { if (win && !win.isDestroyed()) current = win.webContents.getURL() || r.url; } catch { /* ilk adres */ }
      if (!WG.decide(current, ctx()).ok || !/^https?:/.test(current)) current = r.url;
      iw.loadURL(current).catch(() => {});
      /* Oturum açma, çerez onayı ve benzeri kalıcı değişiklik bu oturumda
         saklanır; pencere kapanınca katmanın sayfası yenilenir. */
      interactWin.on('closed', () => {
        interactWin = null;
        if (win && !win.isDestroyed()) win.webContents.reload();
      });
      return true;
    }

    return {
      kind: 'web',
      key,
      layerId,
      start() { build(); },
      update(next, isActive) {
        const prev = cfg;
        cfg = next;
        if (!win || win.isDestroyed()) {
          if (st.state === 'error' || st.state === 'failed' || st.state === 'starting' || prev.url !== next.url) { crashes = 0; build(); }
          setActive(isActive);
          return;
        }
        if (prev.transparent !== next.transparent) { build(); setActive(isActive); return; }
        const r = SL.checkUrl(next.url);
        if (prev.url !== next.url || (r.ok && r.url !== loadedUrl)) { build(); setActive(isActive); return; }
        const wc = win.webContents;
        if (prev.width !== next.width || prev.height !== next.height) {
          try { win.setContentSize(next.width, next.height); } catch { /* boyut */ }
        }
        if (prev.fps !== next.fps) wc.setFrameRate(next.fps);
        if (prev.zoom !== next.zoom) wc.setZoomFactor(next.zoom);
        if (prev.audio !== next.audio) {
          wc.setAudioMuted(!next.audio);
          if (interactWin && !interactWin.isDestroyed()) interactWin.webContents.setAudioMuted(!next.audio);
        }
        if (prev.css !== next.css) applyCss();
        if (prev.reloadMin !== next.reloadMin) armReload();
        setActive(isActive);
      },
      status() {
        return Object.assign({}, st, {
          fps: meter.read(), active, layerId,
          interacting: !!(interactWin && !interactWin.isDestroyed()),
          gpu,
        });
      },
      pause() { setActive(false); },
      reload() {
        crashes = 0;
        if (!win || win.isDestroyed()) { build(); return; }
        win.webContents.reloadIgnoringCache();
      },
      interact,
      stop() {
        stopped = true;
        if (reloadTimer) clearInterval(reloadTimer);
        if (crashTimer) clearTimeout(crashTimer);
        reloadTimer = null;
        crashTimer = null;
        if (interactWin && !interactWin.isDestroyed()) interactWin.destroy();
        interactWin = null;
        destroyWindow();
        st.state = 'stopped';
      },
      ownsContents(id) {
        if (id == null) return false;
        return !!((win && !win.isDestroyed() && win.webContents.id === id)
          || (interactWin && !interactWin.isDestroyed() && interactWin.webContents.id === id));
      },
      noteBlocked(info) {
        st.blocked++;
        st.lastBlocked = (info.reason || '') + (info.url ? ' ' + info.url : '');
      },
      _window: () => win,
    };
  }

  // ---- Senkron: yapılandırmadan kaynak kümesi ---------------------------

  function sync(cfg) {
    const list = SL.wanted(cfg);
    const local = new Set();
    for (const w of list) {
      if (w.kind !== 'web') continue;
      const r = SL.checkUrl(w.spec.url);
      if (r.ok && r.local) local.add(r.origin);
    }
    allowedLocal = local;
    const keep = new Set();
    for (const w of list) {
      keep.add(w.key);
      const pend = removals.get(w.key);
      if (pend) { clearTimeout(pend); removals.delete(w.key); }
      let s = sources.get(w.key);
      if (!s) {
        s = w.kind === 'input' ? createInput(w.key, w.spec) : createWeb(w.key, w.layerId, w.spec);
        sources.set(w.key, s);
        s.start();
      }
      s.update(w.spec, w.active);
    }
    for (const [key, s] of sources) {
      if (keep.has(key) || removals.has(key)) continue;
      /* Sahneden çıktı: geçiş süresince son kare kalsın, sonra kapat. */
      s.pause();
      const tm = setTimeout(() => {
        removals.delete(key);
        const cur = sources.get(key);
        if (!cur) return;
        cur.stop();
        sources.delete(key);
        dropEverywhere(key);
        onStatus();
      }, GRACE_MS);
      if (tm.unref) tm.unref();
      removals.set(key, tm);
    }
    onStatus();
  }

  function status() {
    const out = {};
    for (const [key, s] of sources) {
      if (removals.has(key)) continue;
      out[key] = s.status();
    }
    return out;
  }

  function available() {
    const b = loadBridge();
    return {
      input: !!(b && typeof b.TextureReceiver === 'function') && (platform === 'win32' || platform === 'darwin'),
      protocol: platform === 'darwin' ? 'syphon' : platform === 'win32' ? 'spout' : '',
      web: true,
      gpu: !!sharedTexture,
    };
  }

  function listSenders() {
    const b = loadBridge();
    if (!b || typeof b.listSenders !== 'function') return { others: [], mine: [] };
    let raw = [];
    try { raw = b.listSenders() || []; } catch { raw = []; }
    return SL.splitSenders(raw, ownSenderNames());
  }

  function webByLayer(layerId) {
    for (const s of sources.values()) if (s.kind === 'web' && s.layerId === layerId) return s;
    return null;
  }

  function reloadWeb(layerId) {
    const s = webByLayer(layerId);
    if (!s) return false;
    s.reload();
    return true;
  }

  function interactWeb(layerId) {
    const s = webByLayer(layerId);
    return s ? s.interact() : false;
  }

  /* Web katmanlarının çerezleri, girişleri ve önbelleği. Diğer oturumlara
     (panel, görselleştirici) dokunmaz. */
  function clearWebData() {
    const ses = getWebSession();
    return Promise.all([
      ses.clearStorageData().catch(() => {}),
      ses.clearCache().catch(() => {}),
      typeof ses.clearAuthCache === 'function' ? ses.clearAuthCache().catch(() => {}) : null,
    ]).then(() => {
      for (const s of sources.values()) if (s.kind === 'web') s.reload();
      return true;
    });
  }

  function shutdown() {
    for (const tm of removals.values()) clearTimeout(tm);
    removals.clear();
    for (const s of sources.values()) { try { s.stop(); } catch { /* kapanıyor */ } }
    sources.clear();
  }

  function isWebContents(wc) {
    return !!(wc && webSession && wc.session === webSession);
  }

  return {
    sync, status, available, listSenders, reloadWeb, interactWeb, clearWebData,
    addConsumer, shutdown, isWebContents, blocked: () => blockedLog.slice(),
    _sources: sources, _consumers: consumers,
  };
}

module.exports = { create, GRACE_MS };
