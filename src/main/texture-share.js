'use strict';
/* Spout (Windows) ve Syphon (macOS) çıkışı.
 *
 * Görüntüyü aynı makinedeki başka bir uygulamaya GPU üzerinden verir:
 * Resolume, OBS, TouchDesigner ya da herhangi bir Spout/Syphon alıcısı.
 * Pencere yakalama yok, eklenti kurulumu yok, CPU kopyası yok.
 *
 * Nasıl: gizli bir offscreen pencere görselleştirici sayfasını yükler ve
 * Electron'un `paint` olayı her karede paylaşılan GPU dokusunu verir.
 * Ölçüldü — Electron 43.5.1'de 60 fps, karelerin tamamında doku.
 *
 * Neden ayrı bir pencere: gerçek görselleştirici pencereleri kullanıcının
 * ekranlarına ait ve kapatılabilir. Spout çıkışının, hiçbir ekranda pencere
 * açık olmasa bile çalışması gerekiyor.
 *
 * Linux'ta YOKTUR. Spout bir Windows, Syphon bir macOS teknolojisi;
 * texture-bridge'in Linux ikilisi yok ve Linux'ta yerleşik bir eşdeğeri de
 * yok. Orada modül hiç yüklenmez ve arayüz seçeneği hiç göstermez —
 * çalışmayan bir anahtar sunmaktansa hiç sunmamak.
 */

const path = require('path');
const { BrowserWindow, screen } = require('electron');
const ST = require('../shared/shared-texture.js');

/* Native modül yalnız Windows ve macOS'ta var. require'ı KORUMALI ve TEMBEL
   yapmak şart: Linux derlemesinde üst düzey bir require uygulamayı açılışta
   çökertirdi. */
let bridge = null;
let bridgeError = null;
let bridgeTried = false;

function loadBridge() {
  if (bridgeTried) return bridge;
  bridgeTried = true;
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    bridgeError = 'UNSUPPORTED_PLATFORM';
    return null;
  }
  try {
    bridge = require('@napolab/texture-bridge');
  } catch (e) {
    /* İkili eksikse (prebuild inmemişse) bu bir arıza değil, o kurulumda
       özellik yok demektir. Sebebi saklanır ki arayüz söyleyebilsin. */
    bridgeError = 'NATIVE_MISSING';
    bridge = null;
  }
  return bridge;
}

const DEFAULTS = { name: 'CAYADEV Visualizer', width: 1920, height: 1080, fps: 60 };

let win = null;
let sender = null;
let senderSize = { width: 0, height: 0 };
let wanted = false;

let state = {
  running: false,
  supported: null,     // loadBridge sonucuna göre doldurulur
  protocol: '',        // 'spout' | 'syphon'
  name: '',
  width: 0,
  height: 0,
  frames: 0,
  dropped: 0,
  error: null,
  reason: null,        // desteklenmiyorsa NEDEN
};

function snapshot() {
  return Object.assign({}, state);
}

/* Bu platformda Spout/Syphon mümkün mü? */
function available() {
  const b = loadBridge();
  if (!b) {
    return {
      ok: false,
      reason: bridgeError,
      protocol: '',
    };
  }
  let protocol = '';
  try {
    protocol = b.getPlatform();
  } catch {}
  return { ok: true, reason: null, protocol };
}

function ensureSender(width, height, name) {
  if (sender && senderSize.width === width && senderSize.height === height && state.name === name) {
    return sender;
  }
  /* Gönderici adı ve boyutu kuruluşta sabitleniyor; değişince yenisi
     gerekiyor. Eskisini bırakmamak, alıcıda hayalet bir kaynak bırakır. */
  destroySender();
  const b = loadBridge();
  if (!b) return null;
  sender = new b.TextureSender(name, width, height);
  senderSize = { width, height };
  state = Object.assign({}, state, { name, width, height });
  return sender;
}

function destroySender() {
  if (!sender) return;
  try { sender.stop(); } catch {}
  sender = null;
  senderSize = { width: 0, height: 0 };
}

/* Bir paint olayını göndericiye aktarır.
   Doku HER YOLDA serbest bırakılmalı: bırakılmayan her kare bir GPU
   kaynağı sızdırır ve birkaç dakikada belleği tüketir. */
function onPaint(e) {
  const tex = e && e.texture;
  if (!tex) return;
  try {
    if (!sender && !wanted) return;
    const ti = tex.textureInfo || {};
    if (!ST.formatSupported(ti.pixelFormat)) {
      state = Object.assign({}, state, { dropped: state.dropped + 1, error: 'UNSUPPORTED_FORMAT:' + ti.pixelFormat });
      return;
    }
    const h = ST.extractHandle(ti);
    if (h.error) {
      state = Object.assign({}, state, { dropped: state.dropped + 1, error: h.error });
      return;
    }
    const s = ensureSender(h.width, h.height, state.name || DEFAULTS.name);
    if (!s) return;
    if (h.kind === 'iosurface') s.sendSurface(h.surface, h.width, h.height);
    else s.send(h.ntHandle, h.width, h.height);
    state = Object.assign({}, state, { frames: state.frames + 1, error: null });
  } catch (err) {
    state = Object.assign({}, state, { dropped: state.dropped + 1, error: err.message });
  } finally {
    try { tex.release(); } catch {}
  }
}

function start(cfg) {
  const c = Object.assign({}, DEFAULTS, cfg || {});
  const av = available();
  if (!av.ok) {
    state = Object.assign({}, state, {
      running: false, supported: false, reason: av.reason, protocol: '',
    });
    return Promise.resolve(snapshot());
  }

  wanted = true;
  state = Object.assign({}, state, {
    supported: true, protocol: av.protocol, reason: null,
    name: c.name || DEFAULTS.name, frames: 0, dropped: 0, error: null,
  });

  if (win && !win.isDestroyed()) {
    win.webContents.setFrameRate(Math.max(1, Math.min(60, Number(c.fps) || 60)));
    state = Object.assign({}, state, { running: true });
    return Promise.resolve(snapshot());
  }

  /* Görselleştirici sayfası ekran kimliğine göre projeksiyon haritalaması
     okuyor. Ana ekranınki veriliyor: en tahmin edilebilir davranış,
     "ana ekranda gördüğünüz" demek. */
  let displayId = 0;
  try { displayId = screen.getPrimaryDisplay().id; } catch {}

  win = new BrowserWindow({
    show: false,
    width: Math.max(64, Number(c.width) || DEFAULTS.width),
    height: Math.max(64, Number(c.height) || DEFAULTS.height),
    webPreferences: {
      preload: path.join(__dirname, 'preload-visualizer.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      offscreen: { useSharedTexture: true },
      additionalArguments: ['--sv-display-id=' + displayId],
    },
  });

  win.webContents.on('paint', onPaint);
  win.on('closed', () => {
    win = null;
    destroySender();
    state = Object.assign({}, state, { running: false });
  });
  win.webContents.setFrameRate(Math.max(1, Math.min(60, Number(c.fps) || 60)));

  const p = win.loadFile(path.join(__dirname, '..', 'visualizer', 'index.html'));
  state = Object.assign({}, state, { running: true });
  return p.then(() => snapshot()).catch((e) => {
    state = Object.assign({}, state, { error: e.message });
    return snapshot();
  });
}

function stop() {
  wanted = false;
  destroySender();
  if (win && !win.isDestroyed()) {
    win.webContents.removeListener('paint', onPaint);
    win.destroy();
  }
  win = null;
  state = Object.assign({}, state, { running: false, frames: 0, dropped: 0, error: null });
  return Promise.resolve(snapshot());
}

/* Ana süreç yapılandırma ve ses karelerini buraya da yollasın diye. */
function window_() {
  return win && !win.isDestroyed() ? win : null;
}

function status() {
  if (state.supported === null) {
    const av = available();
    state = Object.assign({}, state, { supported: av.ok, protocol: av.protocol, reason: av.reason });
  }
  return snapshot();
}

/* Aynı makinedeki diğer gönderenler — ileride giriş katmanı için. */
function listSenders() {
  const b = loadBridge();
  if (!b) return [];
  try { return b.listSenders(); } catch { return []; }
}

module.exports = { start, stop, status, available, listSenders, window: window_, DEFAULTS };
