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
   her zaman) kare bit eşlem olarak gider. Web katmanında hız sınırı
   kullanıcının seçtiği kare hızıdır (60 seçilirse 60); Spout/Syphon girişinde
   göndericinin kare hızı (yapay sınır yok). Bit eşlemi alacak pencere yoksa
   GPU'dan okuma hiç yapılmaz.

   SAHİPLİK. Her doku ve tutamaç HER YOLDA bırakılır: Spout/Syphon
   tutamacı içe alımdan sonra da `closeNativeHandle` ile (Electron kendi
   kopyasını alıyor), içe alınan doku `release` ile, web sayfasının dokusu
   son başvuru bırakılınca. Bırakılmayan her kare bir GPU
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
/* Bit eşlem yolunda kare hızına yapay üst sınır YOK. Web katmanında sınırı
   kullanıcının seçtiği kare hızı, Spout/Syphon girişinde göndericinin kendi
   kare hızı belirler (alıcı yalnız yeni kare olunca okur, yoklama 120 Hz).
   Alt aralık, seçilen hızın aralığının bu katı. Electron kareleri zaten seçilen hızda üretiyor; gecikmeli ya da
   erken gelen bir kare (60 fps'te 16,67 ms'lik aralığa ±1 ms oynama) tam
   eşikte elenir ve 60 seçilince ~46 fps çıkardı. */
const CPU_FPS_SLACK = 0.8;
const STALE_MS = 1500;
const RECONNECT_MS = 1000;
const CONNECT_TRY_MS = 250;
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
  const getLocale = deps.getLocale || (() => 'en');
  const onStatus = deps.onStatus || (() => {});
  const now = deps.now || (() => Date.now());

  const consumers = new Map(); // webContents.id -> tüketici
  const sources = new Map(); // anahtar -> kaynak
  const removals = new Map(); // anahtar -> zamanlayıcı
  let webSession = null;
  let appQuitting = false;
  if (electron.app && typeof electron.app.on === 'function') {
    electron.app.on('before-quit', () => {
      appQuitting = true;
      /* Çıkış soruyla iptal edilebiliyor (görselleştirici açıkken onay) ve
         bunun bir olayı yok: 5 sn içinde çıkılmadıysa iptal edilmiştir. */
      const tm = setTimeout(() => { appQuitting = false; }, 5000);
      if (tm.unref) tm.unref();
    });
  }
  let blockedLog = [];

  function ports() {
    return new Set((appPorts() || []).filter((p) => Number.isInteger(p) && p > 0));
  }

  /* Yerel adres izni KATMANA ait: A katmanına yazılan 127.0.0.1:3000'e
     B katmanındaki bir sayfa ulaşamaz. İstek hangi sayfadan geldiyse onun
     katmanının kuralı; sahibi bilinmeyen istek (servis çalışanı, başka
     pencere) yerel hiçbir yere gidemez. */
  function ctxFor(webContentsId) {
    for (const s of sources.values()) {
      if (s.kind === 'web' && s.ownsContents(webContentsId)) return s.ctx();
    }
    return { allowedLocal: new Set(), appPorts: ports() };
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
    WG.hardenSession(webSession, (details) => ctxFor(details && details.webContentsId), noteBlocked);
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

  /* Bit eşlem yolu: BGRA ya da RGBA bayt dizisi. `minGapMs` verilirse pencere
     başına en az o aralık (web: seçilen hıza göre); verilmezse kare atlanmaz.
     Dokuyu alabilen pencereye bu yol gitmez (`gpuToo` değilse). */
  function deliverBitmap(key, w, h, format, data, gpuToo, opaque, minGapMs) {
    const t = now();
    const gap = minGapMs > 0 ? minGapMs : 0;
    let sent = 0;
    let bytes = null;
    for (const c of consumers.values()) {
      if (!c.ready || c.wc.isDestroyed()) continue;
      if (c.gpu && !gpuToo) continue;
      const last = c.lastCpu.get(key) || 0;
      if (t - last < gap) continue;
      c.lastCpu.set(key, t);
      try {
        /* `data` işlevse bayt dizisi ilk alıcıya gelince, bir kez üretilir:
           elenen kare için 8 MB'lık kopya (1080p) yapılmaz. */
        if (bytes === null) bytes = typeof data === 'function' ? data() : data;
        c.wc.send('sources:bitmap', { key, w, h, format, data: bytes, opaque: !!opaque });
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

  /* Panele giden durum: duraklatılmış (katman kapalı, sessiz, başka katman
     solo) kaynak "live" kalmaz ve kare hızı sıfırdır. Hata durumları
     (çöktü, başarısız, hata) duraklatılmış olsa da görünür kalır. */
  function shownState(st, active, fps) {
    const idle = !active && (st.state === 'live' || st.state === 'waiting' || st.state === 'loading' || st.state === 'starting');
    return { state: idle ? 'paused' : st.state, fps: active ? fps : 0 };
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
    let opened = ''; // alıcının kurulduğu gerçek ad
    let timer = null;
    let active = false;
    let lastFrameAt = 0;
    let lastTryAt = -Infinity; // ilk deneme beklemeden
    let lostSince = 0;
    let gpuFails = 0;
    let cpu = !sharedTexture;
    let cfg = spec;

    function open(name) {
      const b = loadBridge();
      if (!b || typeof b.TextureReceiver !== 'function') {
        st.state = 'error';
        st.error = platform === 'linux' ? 'UNSUPPORTED_PLATFORM' : 'NATIVE_MISSING';
        return false;
      }
      try {
        receiver = new b.TextureReceiver(name, cfg.app || null, null);
        opened = name;
        st.error = '';
        if (st.state !== 'live') st.state = 'waiting';
        return true;
      } catch (err) {
        receiver = null;
        opened = '';
        const msg = String((err && err.message) || err).slice(0, 200);
        /* macOS'ta (CI, gerçek Mac) olmayan bir sunucu için alıcı kurmak
           fırlatıyor: "Failed to create Syphon receiver (no matching
           server?)". Windows'ta kuruluyor ve "bağlı değil" diyor. Sunucu
           listeyle kurma arasında kaybolduysa bu bir hata değil, bekleme. */
        if (/no matching server/i.test(msg)) {
          if (st.state !== 'live') st.state = 'waiting';
          st.error = '';
        } else {
          st.state = 'error';
          st.error = msg;
        }
        return false;
      }
    }

    function close() {
      if (receiver) { try { receiver.stop(); } catch { /* durdu */ } }
      receiver = null;
      opened = '';
    }

    /* Göndericinin şu anki adı ya da null (listede yok). Spout aynı adı
       ikinci kez verince sonuna `_1` ekliyor; gönderen uygulama çökmüş ve
       kaydı asılı kalmışsa yeniden açıldığında adı böyle gelir. Kayıtlı ad
       yoksa ve TEK bir ekli hâli varsa o seçilir. Liste okunamıyorsa kayıtlı
       ad denenir. */
    function resolveSender() {
      const b = loadBridge();
      if (!b || typeof b.listSenders !== 'function') return cfg.sender;
      let list;
      try { list = b.listSenders() || []; } catch { return cfg.sender; }
      const appOk = (x) => !cfg.app || !x.appName || x.appName === cfg.app;
      if (list.some((x) => x && x.name === cfg.sender && appOk(x))) return cfg.sender;
      const pre = cfg.sender + '_';
      const alt = list.filter((x) => x && typeof x.name === 'string' && x.name.indexOf(pre) === 0 && /^[0-9]+$/.test(x.name.slice(pre.length)) && appOk(x));
      return alt.length === 1 ? alt[0].name : null;
    }

    /* BAĞLANTI. Ölçüldü (texture-bridge 0.15.0, Windows):
         - yeni bir alıcı, gönderici açık olsa bile İLK alma çağrısına kadar
           `isConnected()` false diyor; bağlantıyı o çağrı kuruyor;
         - bağlı değilken `hasNewFrame()` true diyor, kareyi istemek hata
           fırlatıyor;
         - gönderici alıcıdan sonra açılırsa ya da kapanıp yeniden açılırsa
           eski alıcı bağlanamıyor (14 sn beklendi); yenisi gerekiyor.
       Bu yüzden: bağlı değilken gönderici listedeyse en çok 250 ms'de bir
       tek bir alma denemesi; 2 sn'de bağlanmazsa alıcı yeniden kurulur. */
    function connect(t) {
      if (st.state === 'live') st.state = 'waiting';
      if (t - lastTryAt < CONNECT_TRY_MS) return;
      lastTryAt = t;
      const name = resolveSender();
      if (!name) { lostSince = 0; return; }
      if (!lostSince) lostSince = t;
      if (!receiver || name !== opened || t - lostSince > RECONNECT_MS * 2) {
        close();
        if (!open(name)) return;
        lostSince = t;
      }
      st.actual = name;
      try {
        const f = receiver.receiveSharedTexture();
        if (f) { try { loadBridge().closeNativeHandle(f.handle); } catch { /* kapatıldı */ } }
      } catch { /* henüz bağlı değil */ }
    }

    function pollOnce() {
      const t = now();
      let connected = false;
      if (receiver) { try { connected = receiver.isConnected(); } catch { connected = false; } }
      if (!connected) { connect(t); return; }
      lostSince = 0;
      let fresh = false;
      try { fresh = receiver.hasNewFrame(); } catch { fresh = false; }
      if (!fresh) {
        if (lastFrameAt && t - lastFrameAt > STALE_MS && st.state === 'live') st.state = 'waiting';
        return;
      }
      if (!active || !anyConsumer()) return; // kare beklesin, boşa alma
      if (!cpu && readyConsumers(key).some((c) => c.gpu)) {
        let f = null;
        try { f = receiver.receiveSharedTexture(); } catch (err) { f = null; st.error = String(err && err.message).slice(0, 200); }
        if (!f) return;
        /* TUTAMAÇ HER YOLDA KAPANIR, içe alım başarılı olsa da. Electron
           içe alırken kendi kopyasını alıyor ve bizimkine dokunmuyor
           (electron_api_shared_texture.cc: Windows'ta DuplicateHandle,
           macOS'ta IOSurface için scoped_policy::RETAIN). texture-bridge'in
           belgesi "Electron sahiplenir" diyor; ölçülen öyle değil: 20 dakikalık
           koşuda ana süreç kare başına bir tutamaç sızdırdı (3412 -> 85 893).
           İçe alımdan hemen sonra kapatınca sızıntı sıfır, görüntü aynı. */
        const closeHandle = () => { try { loadBridge().closeNativeHandle(f.handle); } catch { /* kapatıldı */ } };
        let imported = null;
        try {
          const handle = platform === 'darwin' ? { ioSurface: f.handle } : { ntHandle: f.handle };
          imported = sharedTexture.importSharedTexture({
            textureInfo: { pixelFormat: f.pixelFormat, codedSize: { width: f.width, height: f.height }, handle },
          });
        } catch (err) {
          closeHandle();
          st.dropped++;
          st.error = String((err && err.message) || err).slice(0, 200);
          if (++gpuFails >= GPU_FAILS_TO_CPU) { cpu = true; log('layer-sources: ' + key + ' bit eşlem yoluna geçti: ' + st.error); }
          return;
        }
        closeHandle();
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

    /* Bit eşlem alacak pencere var mı? Yoksa GPU'dan okuma (kare başına
       büyük bir kopya) hiç yapılmaz. */
    function needsBitmap(toGpuWindowsToo) {
      for (const c of consumers.values()) {
        if (c.ready && !c.wc.isDestroyed() && (!c.gpu || toGpuWindowsToo)) return true;
      }
      return false;
    }

    function cpuCopy(t, gpuToo) {
      if (!needsBitmap(!gpuToo)) return;
      let f = null;
      try { f = receiver.receiveFrame(); } catch { f = null; }
      if (!f || !f.data) return;
      st.width = f.width;
      st.height = f.height;
      if (!gpuToo) { st.path = 'cpu'; frame(t); }
      /* Bayt sırası: kütüphanenin belgesi RGBA diyor, Windows'ta ölçülen BGRA
         (lacivert bir gönderici kahverengi çıkıyordu). macOS ölçülemedi;
         orada belgeye uyuluyor. */
      deliverBitmap(key, f.width, f.height, platform === 'win32' ? 'bgra' : 'rgba', f.data, !gpuToo, !cfg.alpha);
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
        const name = resolveSender();
        if (name) open(name);
        else if (!loadBridge()) open(cfg.sender); // hata durumunu yazar
        if (st.state === 'starting') st.state = 'waiting';
        timer = setInterval(pollOnce, POLL_MS);
        if (timer.unref) timer.unref();
      },
      update(next, isActive) {
        if (next.sender !== cfg.sender || next.app !== cfg.app) {
          cfg = next;
          close();
          st.state = 'waiting';
          st.actual = '';
          lastTryAt = -Infinity;
          lostSince = 0;
        }
        cfg = next;
        active = !!isActive;
      },
      status() {
        return Object.assign({}, st, shownState(st, active, meter.read()), { sender: cfg.sender, app: cfg.app, actual: st.actual || '', active });
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

    // Bu katmanın kuralı: yalnız kullanıcının bu katmana yazdığı yerel köken
    function myCtx() {
      const r = SL.checkUrl(cfg.url);
      return { allowedLocal: r.ok && r.local ? new Set([r.origin]) : new Set(), appPorts: ports() };
    }

    function checked() {
      const r = SL.checkUrl(cfg.url);
      if (!r.ok) return r;
      const d = WG.decide(r.url, myCtx());
      return d.ok ? r : { ok: false, reason: d.reason };
    }

    /* Pencere ekrandan büyük olamaz: küçük ekranda (1366x768, 1280x1024…)
       yapıcıya verilen 1920x1080 ekrana kırpılıyordu (örn. 1279x1023); sayfa
       da o boyutta yerleşiyor, oran bozuluyordu. `enableLargerThanScreen`
       yalnız macOS'ta işe yarıyor; yapıcıdan SONRA verilen setContentSize
       her platformda ekrandan büyük boyuta izin veriyor. Boyut zaten
       doğruysa dokunulmaz. */
    function fitSize() {
      try {
        if (!win || win.isDestroyed()) return;
        const cur = win.getContentSize();
        if (cur[0] !== cfg.width || cur[1] !== cfg.height) win.setContentSize(cfg.width, cfg.height);
      } catch { /* boyut */ }
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
        enableLargerThanScreen: true,
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
      fitSize();
      const wc = win.webContents;
      WG.guardContents(wc, myCtx, { onBlocked: (info) => noteBlocked(Object.assign({ webContentsId: wc.id }, info)) });
      wc.setAudioMuted(!cfg.audio);
      try { wc.setBackgroundThrottling(false); } catch { /* eski sürüm */ }
      wc.setFrameRate(cfg.fps);
      wc.on('paint', onPaint);
      wc.on('dom-ready', applyCss);
      wc.on('page-title-updated', (_e, title) => { st.title = String(title || '').slice(0, 200); });
      wc.on('did-start-loading', () => { if (st.state !== 'live') st.state = 'loading'; });
      wc.on('did-finish-load', () => {
        fitSize();
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
      /* Sayfa `window.close()` ile kendi görünmez penceresini kapatabiliyordu
         (denendi): kareler donuyor, durum "yüklendi" kalıyordu. Kapatma
         isteği reddedilir; bizim kapatmamız `destroy()` ile, o olay
         çıkmaz. Pencere yine de beklenmedik giderse çökmüş sayılır. */
      /* Uygulama kapanırken ya da oturum/sistem kapanırken ret YOK: ret
         bütün çıkışı iptal eder (tepsi, güncelleme, MCP, oturum kapatma). */
      win.on('close', (e) => { if (!appQuitting) e.preventDefault(); });
      win.on('query-session-end', () => { appQuitting = true; });
      win.on('session-end', () => { appQuitting = true; });
      const self = win;
      win.on('closed', () => {
        if (win !== self) return;
        win = null;
        if (stopped || appQuitting) return;
        st.state = 'crashed';
        st.error = 'CLOSED';
        scheduleCrashReload();
      });
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
      deliverBitmap(key, size.width, size.height, 'bgra', () => image.toBitmap(), true, !cfg.transparent, CPU_FPS_SLACK * 1000 / cfg.fps);
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
        // Pencere başlığı arayüz diline göre (EN: Web layer)
        title: getLocale() === 'tr' ? 'Web katmanı' : 'Web layer',
        autoHideMenuBar: true,
        backgroundColor: '#ffffff',
        webPreferences: WG.webPreferences({ session: ses }),
      });
      const iw = interactWin.webContents;
      WG.guardContents(iw, myCtx, { allowPopups: true, onBlocked: (info) => noteBlocked(Object.assign({ webContentsId: iw.id }, info)) });
      iw.setAudioMuted(!cfg.audio);
      let current = r.url;
      try { if (win && !win.isDestroyed()) current = win.webContents.getURL() || r.url; } catch { /* ilk adres */ }
      if (!WG.decide(current, myCtx()).ok || !/^https?:/.test(current)) current = r.url;
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
      ctx: myCtx,
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
        return Object.assign({}, st, shownState(st, active, meter.read()), {
          active, layerId,
          interacting: !!(interactWin && !interactWin.isDestroyed()),
          gpu,
        });
      },
      pause() { setActive(false); },
      reload() {
        crashes = 0;
        if (crashTimer) { clearTimeout(crashTimer); crashTimer = null; }
        // Çökmüş ya da vazgeçilmiş sayfa baştan kurulur; canlı olan yenilenir
        if (!win || win.isDestroyed() || st.state === 'crashed' || st.state === 'failed' || st.state === 'error') { build(); return; }
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

  /* `cfg` tek yapılandırma ya da dizi: dışa aktarılan kuyruk işinin sahnesi
     canlı sahne olmayabilir, o işin katmanlarının kaynakları da açık kalır.
     Aynı anahtar iki yapılandırmada varsa ilkinin ayarı geçerli, etkinlik
     ikisinden biri açıksa açık. */
  function wantedOf(cfg) {
    const all = Array.isArray(cfg) ? cfg : [cfg];
    const out = [];
    const byKey = new Map();
    for (const c of all) {
      for (const w of SL.wanted(c)) {
        const had = byKey.get(w.key);
        if (had) { if (w.active) had.active = true; continue; }
        byKey.set(w.key, w);
        out.push(w);
      }
    }
    return out;
  }

  function sync(cfg) {
    const list = wantedOf(cfg);
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
