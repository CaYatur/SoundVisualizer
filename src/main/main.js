'use strict';
/*
 * CaYaDev Visualizer — Ses Görselleştirici
 * Copyright (c) 2026 CaYaDev — https://cayadev.com
 * MIT License (bkz. LICENSE)
 */

const { app, BrowserWindow, ipcMain, screen, dialog, protocol, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');
const { spawn } = require('child_process');
const nativeAudio = require('./native-audio');
const dynamicLighting = require('./dynamic-lighting');
const lightingIdentity = require('./lighting-identity');
const streamServer = require('./stream-server');
const oscServer = require('./osc-server');
const presetsStore = require('./presets-store');

// Medya katmanının video dosyalarını okuduğu özel protokol.
// Sayfa file:// (masaüstü) veya http:// (OBS) olsun, CSP tek bir kaynağa
// izin vermekle yetinir ve rastgele yerel dosya okuma yolu açılmaz.
protocol.registerSchemesAsPrivileged([
  { scheme: 'sv-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: false } },
]);

/* Arayüz dili.

   Kullanıcı dili yönetici panelinden seçiyor ve seçim tarayıcı tarafında
   (localStorage) tutuluyor. Ana sürecin de bunu bilmesi gerekir: sistem
   diyalogları ve yayın sunucusunun servis ettiği sayfalar buna göre
   dillenir. Panel açılışta ve dil değişince seçimi buraya bildirir;
   bildirim gelmediyse işletim sistemi diline düşülür. */
let uiLocaleOverride = null;

function appLocale() {
  if (uiLocaleOverride === 'tr' || uiLocaleOverride === 'en') return uiLocaleOverride;
  try { return /^tr(?:-|$)/i.test(app.getLocale()) ? 'tr' : 'en'; }
  catch { return 'en'; }
}

ipcMain.on('ui-language', (e, locale) => {
  if (locale !== 'tr' && locale !== 'en') return;
  if (uiLocaleOverride === locale) return;
  uiLocaleOverride = locale;
});
function trUi(tr, en) { return appLocale() === 'tr' ? tr : en; }

// ----------------------------------------------------------------------------
// Durum
// ----------------------------------------------------------------------------
let adminWin = null;
const visualizerWins = new Map(); // ekran kimliği -> görselleştirme penceresi
let currentConfig = null; // son bilinen yapılandırma (admin -> görselleştirici köprüsü)
let lastCaptureSource = null; // o an yakalanan çıkış aygıtı
let previewSubscribed = false; // yönetici panelindeki canlı önizleme kare istiyor mu?

const SMOKE = process.argv.includes('--smoke');
const SHOTS = process.argv.includes('--shots'); // README ekran görüntüsü üretici (geliştirme)
function attachSmoke(win, name) {
  if (!SMOKE) return;
  const wc = win.webContents;
  wc.on('console-message', (e, level, message, line, src) => {
    console.log(`[${name}] ${message}`);
  });
  wc.on('render-process-gone', (e, d) => console.log(`[${name}] CRASH ${d.reason}`));
  wc.on('did-fail-load', (e, code, desc) => console.log(`[${name}] FAIL-LOAD ${code} ${desc}`));
  wc.on('preload-error', (e, p, err) => console.log(`[${name}] PRELOAD-ERR ${err}`));
}

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

// ----------------------------------------------------------------------------
// Ayar kalıcılığı
// ----------------------------------------------------------------------------
function loadSettings() {
  try {
    // BOM'u ayıkla: dosya bir metin düzenleyicide açılıp kaydedildiğinde
    // (Notepad varsayılan olarak ekler) JSON.parse patlar ve kullanıcı tüm
    // ayarlarını sessizce kaybederdi.
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8').replace(/^﻿/, '');
    const s = JSON.parse(raw);
    // Eski formatı çöz (source: string -> sources: [string])
    if (s && s.audio && s.audio.source && !s.audio.sources) {
      s.audio.sources = [s.audio.source];
    }
    return s;
  } catch {
    return null;
  }
}

function saveSettings(config) {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error('Ayarlar kaydedilemedi:', e);
  }
}

// ----------------------------------------------------------------------------
// Ekran listesi
// ----------------------------------------------------------------------------
function getDisplayList() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  return displays.map((d, i) => ({
    id: d.id,
    index: i,
    label: `${trUi('Ekran', 'Display')} ${i + 1}` + (d.id === primary.id ? trUi(' (Birincil)', ' (Primary)') : ''),
    bounds: d.bounds,
    size: d.size,
    scaleFactor: d.scaleFactor,
    isPrimary: d.id === primary.id,
    isInternal: d.internal,
  }));
}

// ----------------------------------------------------------------------------
// Pencereler
// ----------------------------------------------------------------------------
let portableLightingFocusTimer = null;
function syncPortableLightingFocus() {
  if (!lightingIdentity.isPortable()) return;
  clearTimeout(portableLightingFocusTimer);
  portableLightingFocusTimer = setTimeout(() => {
    const lighting = currentConfig?.lighting;
    if (!lighting?.enabled) return;
    const focused = BrowserWindow.getAllWindows().some((win) => !win.isDestroyed() && win.isFocused());
    if (focused) dynamicLighting.setConfig(lighting).catch(() => {});
    else dynamicLighting.setConfig({ ...lighting, enabled: false }).catch(() => {});
  }, 120);
}
app.on('browser-window-focus', syncPortableLightingFocus);
app.on('browser-window-blur', syncPortableLightingFocus);

function createAdminWindow() {
  adminWin = new BrowserWindow({
    // Üç sütunlu düzen (kategori rayı + çalışma alanı + önizleme dock'u) için
    // daha geniş varsayılan pencere
    width: 1500,
    height: 940,
    minWidth: 1000,
    minHeight: 680,
    title: trUi('Ses Görselleştirici — Yönetici Paneli', 'Sound Visualizer — Admin Panel'),
    backgroundColor: '#0b0910',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-admin.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  adminWin.loadFile(path.join(__dirname, '..', 'admin', 'index.html'));
  attachSmoke(adminWin, 'ADMIN');

  if (process.argv.includes('--dev')) {
    adminWin.webContents.openDevTools({ mode: 'detach' });
  }

  adminWin.on('closed', () => {
    adminWin = null;
    previewSubscribed = false; // panel gitti, önizleme kare akışı da biter
    for (const win of openWindows()) win.close();
  });
}

/* Görselleştirme pencereleri — ekran başına bir tane.

   Tek pencere yerine bir harita (ekran kimliği -> pencere) tutulur: kullanıcı
   birden çok ekran seçtiğinde hepsinde AYNI ANDA görselleştirme açılır. Ses
   kareleri ve yapılandırma tüm pencerelere birden gider; hepsi aynı motoru
   çalıştırdığı için görüntüler senkron kalır.

   Ses seviyesi bildirimini (Dynamic Lighting'i süren kare) yalnızca İLK pencere
   gönderir; hepsi gönderseydi ışıklar ekran sayısı kadar hızlı güncellenirdi. */
function openWindows() {
  const out = [];
  for (const [id, win] of visualizerWins) {
    if (win && !win.isDestroyed()) out.push(win);
    else visualizerWins.delete(id);
  }
  return out;
}

function anyVisualizerOpen() {
  return openWindows().length > 0;
}

// Işık/seviye bildirimini gönderecek pencere (ilk açılan)
function meterWindow() {
  const wins = openWindows();
  return wins.length ? wins[0] : null;
}

// Tüm görselleştirme pencerelerine mesaj yolla
function sendToVisualizers(channel, payload) {
  for (const win of openWindows()) win.webContents.send(channel, payload);
}

// İstenen ekran kimliklerini çöz (tek sayı, dizi veya boş kabul edilir)
function resolveDisplayIds(input) {
  const all = screen.getAllDisplays();
  const raw = Array.isArray(input) ? input : input == null ? [] : [input];
  const wanted = raw.map(Number).filter((id) => all.some((d) => d.id === id));
  if (wanted.length) return Array.from(new Set(wanted));
  return [screen.getPrimaryDisplay().id];
}

function createVisualizerWindow(display) {
  const b = display.bounds;
  const win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    frame: false,
    backgroundColor: '#000000',
    show: false,
    fullscreenable: true,
    skipTaskbar: false,
    title: trUi('Görselleştirme', 'Visualization'),
    webPreferences: {
      preload: path.join(__dirname, 'preload-visualizer.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // arka planda da akıcı kalsın
    },
  });
  visualizerWins.set(display.id, win);

  win.loadFile(path.join(__dirname, '..', 'visualizer', 'index.html'));
  attachSmoke(win, 'VIS');

  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.setBounds(b);
    win.show();
    setTimeout(() => {
      if (!win.isDestroyed()) win.setFullScreen(true);
      applyAlwaysOnTop();
    }, 120);
  });

  // Odak kaybında (başka uygulama öne çıktığında) üstte kalmayı yeniden dayat
  win.on('blur', () => {
    if (wantsAlwaysOnTop()) raiseVisualizer();
  });

  // Pencere yüklenince ses yakalamayı istenen duruma getir. Panel önizlemesi
  // nedeniyle yakalama zaten sürüyorsa yeniden başlatılmaz.
  win.webContents.on('did-finish-load', () => {
    syncCapture();
    // Yeni açılan pencereye güncel yapılandırmayı ver (diğerleriyle eşleşsin)
    if (currentConfig) win.webContents.send('config', currentConfig);
  });

  // ESC tüm ekranlardaki görselleştirmeyi kapatır: kullanıcı diğer ekrandaki
  // pencereye kolayca ulaşamayabilir.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') closeVisualizer();
  });

  win.on('closed', () => {
    visualizerWins.delete(display.id);
    if (!anyVisualizerOpen() && onTopTimer) {
      clearInterval(onTopTimer);
      onTopTimer = null;
    }
    // Panel önizlemesi ya da OBS hâlâ kare istiyorsa yakalama kesintisiz sürer
    syncCapture();
    notifyVisualizerStatus();
  });

  return win;
}

function notifyVisualizerStatus() {
  const ids = Array.from(visualizerWins.keys());
  notifyAdmin('visualizer-status', {
    open: ids.length > 0,
    displayIds: ids,
    displayId: ids.length ? ids[0] : null, // eski alan (geriye dönük uyum)
  });
}

function openVisualizer(displayIds) {
  const wanted = resolveDisplayIds(displayIds);
  const all = screen.getAllDisplays();

  // Artık seçili olmayan ekranlardaki pencereleri kapat
  for (const [id, win] of Array.from(visualizerWins)) {
    if (wanted.indexOf(id) === -1 && win && !win.isDestroyed()) win.close();
  }

  for (const id of wanted) {
    const display = all.find((d) => d.id === id) || screen.getPrimaryDisplay();
    const existing = visualizerWins.get(id);
    if (existing && !existing.isDestroyed()) {
      // Var olan pencereyi ekranına yeniden otur (çözünürlük değişmiş olabilir)
      existing.setBounds(display.bounds);
      existing.setFullScreen(false);
      existing.show();
      setTimeout(() => {
        if (!existing.isDestroyed()) existing.setFullScreen(true);
      }, 120);
    } else {
      createVisualizerWindow(display);
    }
  }

  notifyVisualizerStatus();
}

// Yapılandırmadan seçili ses kaynaklarını çöz (yeni "sources" dizisi veya eski
// tek "source" alanı desteklenir)
function configuredSources() {
  const audio = currentConfig && currentConfig.audio;
  if (audio && Array.isArray(audio.sources) && audio.sources.length > 0) return audio.sources;
  if (audio && audio.source) return [audio.source];
  return ['default'];
}

// Yakalamayı isteyen var mı? Görselleştirici penceresi, paneldeki canlı
// önizleme ya da yayın sunucusuna bağlı bir tarayıcı kaynağı (OBS). Hiçbiri
// yoksa yakalama durdurulur.
//
// OBS katmanı burada mutlaka sayılmalı: kullanıcı görselleştirici penceresini
// hiç açmadan yalnızca tarayıcı kaynağını kullanabilir — o durumda yakalama
// başlamazsa OBS'te hareketsiz bir sahne görünürdü.
function captureWanted() {
  return (
    anyVisualizerOpen() ||
    previewSubscribed ||
    // Yalnızca yayın KATMANI ses karesi tüketir; tek başına bağlı bir mobil
    // kumanda yakalamayı ayakta tutmamalı (ses aygıtını boşuna meşgul eder).
    streamServer.overlayCount() > 0
  );
}

// Seçili ses kaynak(lar)ının yakalamasını başlat; kareleri hem görselleştiriciye
// hem de (istendiyse) yönetici panelinin önizlemesine ilet
function startVisualizerCapture() {
  const sources = configuredSources();
  lastCaptureSource = sources;
  nativeAudio.startCapture(
    sources,
    (frame) => {
      if (SMOKE) global.__smokeFrames = (global.__smokeFrames || 0) + 1;
      sendToVisualizers('native-audio', frame);
      if (previewSubscribed) notifyAdmin('native-audio', frame);
      // OBS tarayıcı kaynağı ve diğer web istemcileri
      streamServer.broadcastAudio(frame);
    },
    (status) => {
      if (SMOKE) console.log('[AUDIO-STATUS] ' + JSON.stringify(status));
      notifyAdmin('audio-source-status', status);
    }
  );
}

// Yakalamayı istenen duruma getir (talep eden yoksa durdur, kaynak değiştiyse
// yeniden başlat).
function syncCapture() {
  const current = Array.isArray(lastCaptureSource) ? lastCaptureSource : null;
  if (!captureWanted()) {
    // Zaten durmuşsa dokunma (yapılandırma her değiştiğinde çağrıldığı için)
    if (current) {
      nativeAudio.stopCapture();
      lastCaptureSource = null;
    }
    return;
  }
  const wanted = configuredSources();
  if (current && JSON.stringify(current) === JSON.stringify(wanted)) return;
  startVisualizerCapture();
}

// displayId verilirse yalnızca o ekrandakini, verilmezse hepsini kapatır
function closeVisualizer(displayId) {
  if (displayId != null) {
    const win = visualizerWins.get(Number(displayId));
    if (win && !win.isDestroyed()) win.close();
    return;
  }
  for (const win of openWindows()) win.close();
}

// ----------------------------------------------------------------------------
// "Her zaman üstte" — görselleştirme penceresi
//
// setAlwaysOnTop tek başına yetmiyor: tam ekran başka bir uygulama öne
// çıktığında Windows pencereyi arkaya alabiliyor. Bu yüzden pencere odağı
// kaybettiğinde ve düzenli aralıklarla en üst seviye yeniden uygulanır.
// ----------------------------------------------------------------------------
let onTopTimer = null;

function wantsAlwaysOnTop() {
  return !!(currentConfig && currentConfig.power && currentConfig.power.alwaysOnTop);
}

function raiseVisualizer() {
  for (const win of openWindows()) {
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true);
    win.moveTop();
  }
}

function applyAlwaysOnTop() {
  if (onTopTimer) {
    clearInterval(onTopTimer);
    onTopTimer = null;
  }
  if (!anyVisualizerOpen()) return;

  if (!wantsAlwaysOnTop()) {
    for (const win of openWindows()) {
      win.setAlwaysOnTop(false);
      win.setVisibleOnAllWorkspaces(false);
    }
    return;
  }
  raiseVisualizer();
  // Başka bir uygulama araya girerse geri al
  onTopTimer = setInterval(() => {
    if (!anyVisualizerOpen()) {
      clearInterval(onTopTimer);
      onTopTimer = null;
      return;
    }
    if (!wantsAlwaysOnTop()) return;
    const needsRaise = openWindows().some((w) => !w.isAlwaysOnTop());
    if (needsRaise) raiseVisualizer();
    else for (const win of openWindows()) win.moveTop();
  }, 1200);
}

function notifyAdmin(channel, payload) {
  if (adminWin && !adminWin.isDestroyed()) {
    adminWin.webContents.send(channel, payload);
  }
}

// ----------------------------------------------------------------------------
// IPC
// ----------------------------------------------------------------------------
ipcMain.handle('get-displays', () => getDisplayList());

// Tüm ses aygıtları (çıkış + giriş/mikrofon) ve ayrıntılı tanılama
ipcMain.handle('get-output-devices', () => nativeAudio.listDevices());
ipcMain.handle('diagnose-audio', () => nativeAudio.diagnoseAudio());

function runProcess(executable, args, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let child;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    try {
      child = spawn(executable, args, { windowsHide: false });
    } catch (error) {
      return resolve({ ok: false, code: null, stdout, stderr, error: error.message });
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ ok: false, code: null, stdout, stderr, error: 'INSTALL_TIMEOUT' });
    }, timeoutMs);
    child.stdout?.on('data', (data) => { stdout += data.toString(); });
    child.stderr?.on('data', (data) => { stderr += data.toString(); });
    child.on('error', (error) => finish({ ok: false, code: null, stdout, stderr, error: error.message }));
    child.on('close', (code) => finish({ ok: code === 0, code, stdout, stderr, error: code === 0 ? null : `EXIT_${code}` }));
  });
}

ipcMain.handle('repair-audio', async () => {
  const before = await nativeAudio.diagnoseAudio();
  if (before.ok) return { ok: true, repaired: false, diagnostic: before };

  const code = before?.error?.code || 'UNKNOWN';
  if (code !== 'NODE_NOT_FOUND') {
    return { ok: false, repaired: false, requiresManualAction: true, diagnostic: before };
  }

  const choice = await dialog.showMessageBox(adminWin, {
    type: 'question',
    title: trUi('Ses Bileşenini Onar', 'Repair Audio Component'),
    message: trUi('Node.js LTS eksik. Şimdi otomatik kurulsun mu?', 'Node.js LTS is missing. Install it automatically now?'),
    detail: trUi(
      'Uygulama Windows Paket Yöneticisi üzerinden resmi Node.js LTS paketini kuracaktır. Yönetici onayı istenebilir.',
      'The application will install the official Node.js LTS package through Windows Package Manager. Administrator approval may be requested.'
    ),
    buttons: [trUi('Kur ve Tekrar Dene', 'Install and Retry'), trUi('İptal', 'Cancel')],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (choice.response !== 0) return { ok: false, cancelled: true, repaired: false, diagnostic: before };

  const install = await runProcess('winget.exe', [
    'install', '--id', 'OpenJS.NodeJS.LTS', '-e', '--silent',
    '--accept-source-agreements', '--accept-package-agreements',
  ]);
  if (!install.ok) {
    const wingetMissing = /ENOENT|not found/i.test(install.error || '');
    return {
      ok: false,
      repaired: false,
      diagnostic: before,
      repairError: {
        code: wingetMissing ? 'WINGET_NOT_FOUND' : 'NODE_INSTALL_FAILED',
        message: wingetMissing
          ? 'Windows Package Manager is unavailable. Install Node.js LTS manually and restart the application.'
          : `Node.js installation failed (${install.error || install.code || 'unknown'}).`,
      },
    };
  }

  nativeAudio.resetNodeCache?.();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const after = await nativeAudio.diagnoseAudio();
  return { ok: after.ok, repaired: after.ok, diagnostic: after, install };
});

ipcMain.handle('get-settings', () => loadSettings());

ipcMain.handle('open-visualizer', (e, displayIds) => {
  openVisualizer(displayIds);
  return true;
});

ipcMain.handle('close-visualizer', (e, displayId) => {
  closeVisualizer(displayId);
  return true;
});

ipcMain.handle('visualizer-open-displays', () => Array.from(visualizerWins.keys()));

ipcMain.handle('visualizer-is-open', () => {
  return anyVisualizerOpen();
});

// Admin -> ana süreç -> görselleştirici (yapılandırma güncellemesi)
ipcMain.on('update-config', (e, config) => {
  currentConfig = config;
  saveSettings(config);
  dynamicLighting.setConfig(config?.lighting).catch(() => {});
  if (anyVisualizerOpen()) {
    sendToVisualizers('config', config);
    applyAlwaysOnTop();
  }
  streamServer.broadcast({ type: 'config', config });
  syncStreamServer();
  syncOscServer();
  // Ses kaynağı değiştiyse yakalamayı yeniden başlat. Bu, görselleştirici kapalıyken
  // yalnızca panel önizlemesi dinliyor olsa da geçerlidir.
  syncCapture();
});

// Yönetici panelindeki canlı önizleme kare akışını açıp kapatır. Görselleştirici
// kapalıyken de yakalamayı ayakta tutabilir; kimse dinlemiyorsa yakalama durur.
ipcMain.on('preview:subscribe', (e, on) => {
  const next = !!on;
  if (next === previewSubscribed) return;
  previewSubscribed = next;
  syncCapture();
});

// Görselleştirici açıldığında mevcut yapılandırmayı ister
ipcMain.handle('request-config', () => currentConfig);
ipcMain.handle('lighting:scan', () => dynamicLighting.scan());
ipcMain.handle('lighting:availability', () => dynamicLighting.availability());
ipcMain.handle('lighting:apply', (e, lighting) => dynamicLighting.setConfig(lighting));
ipcMain.handle('lighting:identity-status', () => lightingIdentity.status(dynamicLighting));
ipcMain.handle('lighting:open-settings', () => lightingIdentity.openDynamicLightingSettings());

// ----------------------------------------------------------------------------
// Genel JSON içe/dışa aktarma (renk şablonları + arkaplan ayarları)
// ----------------------------------------------------------------------------
ipcMain.handle('file:export-json', async (e, defaultName, data) => {
  try {
    const r = await dialog.showSaveDialog(adminWin, {
      title: trUi('Dışa Aktar', 'Export'),
      defaultPath: defaultName || 'disa-aktarim.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2), 'utf-8');
    return { ok: true, path: r.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('file:import-json', async (e, title) => {
  try {
    const r = await dialog.showOpenDialog(adminWin, {
      title: appLocale() === 'tr'
        ? (title || 'İçe Aktar')
        : ({ 'Renk Şablonlarını İçe Aktar': 'Import Color Presets', 'Arkaplan Ayarlarını İçe Aktar': 'Import Background Settings' }[title] || 'Import'),
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    const raw = fs.readFileSync(r.filePaths[0], 'utf-8');
    return { ok: true, data: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Görselleştirici -> admin (ses seviyesi göstergesi vb.)
// Yalnızca ilk pencerenin karesi dinlenir: her ekran ayrı kare gönderirse
// Dynamic Lighting ekran sayısı kadar hızlı güncellenir ve efektler bozulur.
ipcMain.on('audio-meter', (e, data) => {
  const primary = meterWindow();
  if (primary && e.sender !== primary.webContents) return;
  notifyAdmin('audio-meter', data);
  dynamicLighting.onAudioFrame(data, currentConfig);
});

// Görselleştirici -> admin (durum/hata bilgisi)
ipcMain.on('visualizer-message', (e, msg) => {
  if (SMOKE) console.log('[VIS-MSG] ' + JSON.stringify(msg));
  notifyAdmin('visualizer-message', msg);
});

// Ses giriş cihazlarını listele (renderer enumerateDevices sonucu admin'e iletilir)
ipcMain.on('report-audio-devices', (e, devices) => {
  notifyAdmin('audio-devices', devices);
});


// ----------------------------------------------------------------------------
// Studio presetleri (kullanıcının kendi görselleştirici/arkaplan tasarımları)
//
// Presetler settings.json'da DEĞİL, userData/presets/ altında ayrı dosyalarda
// tutulur; ayar dosyası her kaydırıcı hareketinde baştan yazıldığı için shader
// kaynağını oraya koymak gereksiz disk trafiği demekti.
// ----------------------------------------------------------------------------
function notifyAll(channel, payload) {
  if (adminWin && !adminWin.isDestroyed()) adminWin.webContents.send(channel, payload);
  sendToVisualizers(channel, payload);
}

function broadcastPresets() {
  const list = presetsStore.list();
  notifyAll('presets', list);
  streamServer.broadcast({ type: 'presets', presets: list });
  return list;
}

ipcMain.handle('presets:list', () => presetsStore.list());
ipcMain.handle('presets:save', (e, preset) => {
  const r = presetsStore.save(preset);
  if (r.ok) broadcastPresets();
  return r;
});
ipcMain.handle('presets:delete', (e, id) => {
  const r = presetsStore.remove(id);
  if (r.ok) broadcastPresets();
  return r;
});
ipcMain.handle('presets:save-many', (e, list) => {
  const saved = presetsStore.saveMany(list);
  if (saved.length) broadcastPresets();
  return { ok: true, saved };
});
ipcMain.handle('presets:open-folder', () => {
  shell.openPath(presetsStore.dir());
  return true;
});

// Metin tabanlı içe aktarma (Shadertoy .glsl / ISF .fs / MilkDrop .milk)
ipcMain.handle('presets:import-text', async () => {
  const r = await dialog.showOpenDialog(adminWin, {
    title: trUi('Shader / Preset İçe Aktar', 'Import Shader / Preset'),
    properties: ['openFile'],
    filters: [
      { name: trUi('Shader ve preset dosyaları', 'Shader and preset files'), extensions: ['glsl', 'fs', 'frag', 'txt', 'milk', 'json', 'svpreset', 'svpack'] },
      { name: trUi('Tümü', 'All Files'), extensions: ['*'] },
    ],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  const file = r.filePaths[0];
  try {
    const stat = fs.statSync(file);
    if (stat.size > 2 * 1024 * 1024) return { ok: false, error: 'FILE_TOO_LARGE' };
    return {
      ok: true,
      name: path.basename(file, path.extname(file)),
      ext: path.extname(file).toLowerCase(),
      text: fs.readFileSync(file, 'utf-8'),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ----------------------------------------------------------------------------
// Yayın sunucusu (OBS tarayıcı kaynağı + mobil kumanda)
// ----------------------------------------------------------------------------

// Uzaktan kumandanın değiştirmesine izin verilen ayar yolları.
// Liste kasıtlı olarak dar: yayın sunucusu ayarları, kontrol yüzeyleri ve dosya
// yolları telefondan değiştirilemez. Gelen mesajlar VERİDİR, komut değil.
const REMOTE_ALLOWED = [
  'audio.sensitivity', 'audio.smoothing', 'audio.bassBoost',
  'visualizer.', 'background.', 'logo.opacity', 'logo.scale', 'logo.pulse',
  'power.fpsCap', 'power.renderScale', 'power.pauseOnSilence',
  'custom.visualizerId', 'custom.backgroundId', 'feedback.',
  'media.opacity', 'media.enabled', 'media.kaleido', 'media.hue',
];

function remotePathAllowed(p) {
  if (typeof p !== 'string' || p.length > 120) return false;
  if (p.includes('__proto__') || p.includes('prototype') || p.includes('constructor')) return false;
  return REMOTE_ALLOWED.some((pref) => (pref.endsWith('.') ? p.startsWith(pref) : p === pref));
}

function setConfigPath(obj, p, value) {
  const keys = p.split('.');
  let node = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof node[keys[i]] !== 'object' || node[keys[i]] === null) node[keys[i]] = {};
    node = node[keys[i]];
  }
  node[keys[keys.length - 1]] = value;
}

// Web istemcisinden gelen komut: doğrula, uygula, herkese yay.
function applyRemoteCommand(msg) {
  if (!currentConfig) return;
  if (msg.action === 'openVisualizer') {
    // Kullanıcının seçtiği tüm ekranlar; eski kayıtlarda tek kimlik olabilir
    const d = currentConfig.display || {};
    openVisualizer(Array.isArray(d.ids) && d.ids.length ? d.ids : d.id);
    return;
  }
  if (msg.action === 'closeVisualizer') {
    closeVisualizer();
    return;
  }

  if (msg.action === 'scene') {
    const scene = (currentConfig.scenes || []).find((s) => s.id === msg.id);
    if (!scene || !scene.data) return;
    for (const key of ['background', 'visualizer', 'logo', 'images', 'custom', 'feedback']) {
      if (scene.data[key]) currentConfig[key] = JSON.parse(JSON.stringify(scene.data[key]));
    }
  } else if (msg.action === 'set') {
    if (!remotePathAllowed(msg.path)) return;
    const v = msg.value;
    const okType =
      typeof v === 'number' ||
      typeof v === 'boolean' ||
      (typeof v === 'string' && v.length <= 64) ||
      (Array.isArray(v) && v.length <= 8 && v.every((x) => typeof x === 'string' && x.length <= 16));
    if (!okType) return;
    setConfigPath(currentConfig, msg.path, v);
  } else {
    return;
  }

  saveSettings(currentConfig);
  sendToVisualizers('config', currentConfig);
  notifyAdmin('external-config', currentConfig); // panel kendi kopyasını tazelesin
  streamServer.broadcast({ type: 'config', config: currentConfig });
  dynamicLighting.setConfig(currentConfig.lighting).catch(() => {});
}

let streamSyncing = false;
function syncStreamServer() {
  const s = (currentConfig && currentConfig.stream) || {};
  if (streamSyncing) return Promise.resolve(streamServer.status());
  streamSyncing = true;
  const done = (r) => {
    streamSyncing = false;
    return r;
  };
  if (!s.enabled) return streamServer.stop().then(() => done(streamServer.status()));
  return streamServer
    .start(s, {
      getConfig: () => currentConfig,
      getPresets: () => presetsStore.list(),
      getLocale: () => appLocale(),
      onCommand: (msg) => applyRemoteCommand(msg),
      onClientsChanged: (list) => {
        notifyAdmin('stream-clients', list);
        syncCapture(); // ilk istemci bağlanınca yakalamayı başlat, son ayrılınca durdur
      },
    })
    .then((st) => {
      notifyAdmin('stream-status', st);
      return done(st);
    });
}

function syncOscServer() {
  const o = (currentConfig && currentConfig.control && currentConfig.control.osc) || {};
  if (!o.enabled) return oscServer.stop().then(() => oscServer.status());
  return oscServer.start(o, (m) => notifyAdmin('osc-message', m)).then((st) => {
    notifyAdmin('osc-status', st);
    return st;
  });
}

ipcMain.handle('stream:status', () => streamServer.status());
ipcMain.handle('stream:sync', () => syncStreamServer());
ipcMain.handle('stream:new-token', () => streamServer.newToken());
ipcMain.handle('stream:lan-address', () => streamServer.lanAddress());
ipcMain.handle('stream:open', (e, which) => {
  const u = streamServer.status().urls;
  const target = which === 'remote' ? u.remote : u.overlay;
  if (target) shell.openExternal(target);
  return target || '';
});
ipcMain.handle('osc:status', () => oscServer.status());
ipcMain.handle('osc:sync', () => syncOscServer());

// ----------------------------------------------------------------------------
// Medya katmanı: video dosyası seçimi
// ----------------------------------------------------------------------------
ipcMain.handle('media:pick-video', async () => {
  const r = await dialog.showOpenDialog(adminWin, {
    title: trUi('Video Dosyası Seç', 'Choose Video File'),
    properties: ['openFile'],
    filters: [
      { name: trUi('Video Dosyaları', 'Video Files'), extensions: ['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v'] },
      { name: trUi('Tümü', 'All Files'), extensions: ['*'] },
    ],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return {
    path: r.filePaths[0],
    url: 'sv-media://' + encodeURIComponent(r.filePaths[0]),
    name: path.basename(r.filePaths[0]),
  };
});

// Kamera listesi renderer'dan gelir (enumerateDevices)
ipcMain.on('report-video-devices', (e, devices) => notifyAdmin('video-devices', devices));

// ----------------------------------------------------------------------------
// Video Dışa Aktarma (MP3/ses -> kayıpsız video)
// Ekran/ses KAYDI yok: gizli bir render penceresi her kareyi offline ve birebir
// çizer, ham RGBA kareleri buraya akıtır; ffmpeg görsel-kayıpsız H.264 MP4'e kodlar
// ve kaynak sesi olduğu gibi (yeniden kodlamadan) videoya gömer.
// ----------------------------------------------------------------------------
let exportWin = null;
let ffmpegProc = null;
let exportState = null; // { outputPath, ffErr } — aktifken dolu, biter bitmez null

// Paketlenmiş ffmpeg (ffmpeg-static); yoksa sistem PATH'indeki "ffmpeg".
function resolveFfmpeg() {
  try {
    let p = require('ffmpeg-static');
    if (p) {
      p = p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
      if (fs.existsSync(p)) return p;
    }
  } catch {}
  return 'ffmpeg';
}

const RES_MAP = {
  '720p': [1280, 720],
  '1080p': [1920, 1080],
  '1440p': [2560, 1440],
  '2160p': [3840, 2160],
};
const CRF_MAP = { 'visually-lossless': 14, high: 18, balanced: 22 }; // libx264 (CPU)
const CQ_MAP = { 'visually-lossless': 16, high: 20, balanced: 25 }; // h264_nvenc (GPU)

// NVIDIA NVENC donanım kodlayıcısının bu makinede gerçekten çalışıp çalışmadığını
// fonksiyonel olarak doğrula (kodlayıcının listede olması yetmez — sürücü/GPU şart).
// Sonuç önbelleğe alınır.
let _gpuCache = null;
function detectGpuEncoder() {
  if (_gpuCache !== null) return Promise.resolve(_gpuCache);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; _gpuCache = v; resolve(v); };
    let p;
    try {
      p = spawn(resolveFfmpeg(), [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc=size=256x256:rate=30:duration=1',
        '-c:v', 'h264_nvenc', '-preset', 'p7', '-cq', '19', '-f', 'null', '-',
      ], { windowsHide: true });
    } catch {
      return finish(false);
    }
    p.on('error', () => finish(false));
    p.on('exit', (code) => finish(code === 0));
    setTimeout(() => { try { p.kill(); } catch {} finish(false); }, 10000);
  });
}

// NVENC preset/ince ayar tablosu (hız/kalite dengesi). p1=en hızlı … p7=en yavaş.
// 'fast' düşük gecikme (ll) + lookahead/B-kare yok -> maksimum hız.
const NVENC_SPEED = {
  fast: { preset: 'p2', extra: ['-tune', 'ull', '-rc-lookahead', '0', '-bf', '0'] },
  balanced: { preset: 'p4', extra: ['-tune', 'hq', '-rc-lookahead', '8', '-bf', '2'] },
  quality: { preset: 'p6', extra: ['-tune', 'hq', '-rc-lookahead', '20', '-bf', '3', '-multipass', 'qres'] },
};
// libx264 preset'leri (hız/kalite dengesi).
const X264_SPEED = { fast: 'veryfast', balanced: 'medium', quality: 'slow' };

// Kodlayıcıya göre video argümanları (GPU = NVENC, CPU = libx264). Her ikisi de
// yuv420p H.264 üretir; görsel-kayıpsız kalite kademeleri eşlenmiştir.
// quality = sıkıştırma kalitesi (CQ/CRF), speed = hız/kalite preset'i.
function buildVideoArgs(encoder, quality, speed) {
  if (encoder === 'gpu') {
    const cq = CQ_MAP[quality] != null ? CQ_MAP[quality] : 16;
    const s = NVENC_SPEED[speed] || NVENC_SPEED.balanced;
    return [
      '-c:v', 'h264_nvenc', '-preset', s.preset, ...s.extra,
      '-rc', 'vbr', '-cq', String(cq), '-b:v', '0',
      '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    ];
  }
  const crf = CRF_MAP[quality] != null ? CRF_MAP[quality] : 14;
  const preset = X264_SPEED[speed] || 'medium';
  return ['-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', '-threads', '0'];
}

ipcMain.handle('export:gpu-available', () => detectGpuEncoder());

ipcMain.handle('export:pick-audio', async () => {
  const r = await dialog.showOpenDialog(adminWin, {
    title: trUi('Ses Dosyası Seç', 'Choose Audio File'),
    properties: ['openFile'],
    filters: [
      { name: trUi('Ses Dosyaları', 'Audio Files'), extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'] },
      { name: trUi('Tümü', 'All Files'), extensions: ['*'] },
    ],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
});

ipcMain.handle('export:pick-output', async (e, defaultName) => {
  const r = await dialog.showSaveDialog(adminWin, {
    title: trUi('Videoyu Kaydet', 'Save Video'),
    defaultPath: defaultName || 'gorsellestirme.mp4',
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
  });
  if (r.canceled || !r.filePath) return null;
  return r.filePath;
});

/* Dışa aktarma işini başlatır. IPC işleyicisinden ayrı bir fonksiyon olmasının
   sebebi, öz testin (--smoke-export) aynı yolu bir pencere olmadan
   çağırabilmesi: dışa aktarıcı ayrı bir pencere ve ayrı bir preload kullandığı
   için orada bozulan bir şey başka hiçbir testte görünmez. */
async function startExportJob(opts) {
  if (exportState) return { ok: false, error: 'Zaten bir dışa aktarma sürüyor.' };
  opts = opts || {};
  const audioPath = opts.audioPath;
  const outputPath = opts.outputPath;
  if (!audioPath || !fs.existsSync(audioPath)) return { ok: false, error: 'Ses dosyası bulunamadı.' };
  if (!outputPath) return { ok: false, error: 'Çıktı yolu seçilmedi.' };

  const [w, h] = RES_MAP[opts.resolution] || RES_MAP['1080p'];
  const fps = opts.fps === 30 ? 30 : 60;

  // Kodlayıcı seçimi: GPU (NVENC) istendi ama yoksa sessizce CPU'ya düş.
  let encoder = opts.encoder === 'gpu' ? 'gpu' : 'cpu';
  if (encoder === 'gpu' && !(await detectGpuEncoder())) encoder = 'cpu';
  const speed = ['fast', 'balanced', 'quality'].includes(opts.speed) ? opts.speed : 'balanced';
  const videoArgs = buildVideoArgs(encoder, opts.quality, speed);

  // Ses akışını kayıpsız kopyala (mp4 uyumlu kodek). Değilse şeffaf AAC'e dön.
  const ext = path.extname(audioPath).toLowerCase();
  const audioCopy = ['.mp3', '.m4a', '.aac'].includes(ext);
  const audioArgs = audioCopy ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '320k'];

  const args = [
    '-y',
    '-f', 'rawvideo',
    '-pixel_format', 'rgba',
    '-video_size', `${w}x${h}`,
    '-framerate', String(fps),
    '-thread_queue_size', '1024', // ham kare girişi için geniş kuyruk (boru hattı stall'ını önler)
    '-i', 'pipe:0',
    '-i', audioPath,
    '-map', '0:v:0',
    '-map', '1:a:0',
    ...videoArgs,
    ...audioArgs,
    '-movflags', '+faststart',
    '-shortest',
    outputPath,
  ];

  const ff = resolveFfmpeg();
  let audioBuf;
  try {
    audioBuf = fs.readFileSync(audioPath);
  } catch (err) {
    return { ok: false, error: 'Ses dosyası okunamadı: ' + err.message };
  }

  try {
    ffmpegProc = spawn(ff, args, { windowsHide: true });
  } catch (err) {
    return { ok: false, error: 'ffmpeg başlatılamadı: ' + err.message };
  }

  exportState = { outputPath, ffErr: '', encoder };
  notifyAdmin('export-progress', { phase: 'start', encoder });
  ffmpegProc.stderr.on('data', (d) => {
    if (!exportState) return;
    exportState.ffErr += d.toString();
    if (exportState.ffErr.length > 8000) exportState.ffErr = exportState.ffErr.slice(-8000);
  });
  ffmpegProc.stdin.on('error', () => {}); // iptal/kapanışta EPIPE'i yut
  ffmpegProc.on('error', (err) => finalizeExport('error', 'ffmpeg hatası: ' + err.message));
  ffmpegProc.on('exit', (code) => {
    // İş bitti (stdin kapandı) ve ffmpeg başarıyla çıktıysa -> tamam.
    if (!exportState) return; // zaten finalize edilmiş (iptal/hata)
    if (code === 0) finalizeExport('done');
    else finalizeExport('error', 'ffmpeg çıkış kodu ' + code + '\n' + (exportState.ffErr || '').slice(-1200));
  });

  // Gizli render penceresi (offscreen kanvas; ekrana çizilmez)
  exportWin = new BrowserWindow({
    width: 320,
    height: 200,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-exporter.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  attachSmoke(exportWin, 'EXPORT');
  exportWin.on('closed', () => { exportWin = null; });

  try {
    await exportWin.loadFile(path.join(__dirname, '..', 'exporter', 'index.html'));
  } catch (err) {
    finalizeExport('error', 'Render penceresi yüklenemedi: ' + err.message);
    return { ok: false, error: 'Render penceresi yüklenemedi.' };
  }

  const ab = audioBuf.buffer.slice(audioBuf.byteOffset, audioBuf.byteOffset + audioBuf.byteLength);
  exportWin.webContents.send('export:job', {
    // Studio presetleri: dışa aktarıcı bunlar olmadan 'custom' modu boş çizerdi
    presets: presetsStore.list(),
    audioBuffer: ab,
    width: w,
    height: h,
    fps,
    cfg: currentConfig || {},
  });

  return { ok: true };
}

ipcMain.handle('export:start', (e, opts) => startExportJob(opts));

// Dışa aktarma bitene kadar bekler (yalnızca öz test kullanır)
function awaitExportDone(timeoutMs) {
  const limit = Date.now() + (timeoutMs || 120000);
  return new Promise((resolve) => {
    const tick = () => {
      if (!exportState) return resolve(true);
      if (Date.now() > limit) return resolve(false);
      setTimeout(tick, 200);
    };
    tick();
  });
}

ipcMain.handle('export:cancel', () => {
  if (exportState) exportState.cancel = true;
  return true;
});

// Bir RGBA kareyi ffmpeg.stdin'e yaz; geri basınç için "drain"i bekle.
ipcMain.handle('export:frame', async (e, data) => {
  if (!exportState || exportState.cancel || !ffmpegProc || !ffmpegProc.stdin.writable) {
    return { cancel: true };
  }
  const buf = Buffer.from(data); // RGBA baytları (kopyalanır)
  const ok = ffmpegProc.stdin.write(buf);
  if (!ok) {
    await new Promise((res) => {
      const s = ffmpegProc && ffmpegProc.stdin;
      if (!s) return res();
      s.once('drain', res);
    });
  }
  return { cancel: !!(exportState && exportState.cancel) };
});

ipcMain.on('export:ready', (e, total) => {
  notifyAdmin('export-progress', { phase: 'render', done: 0, total });
});
ipcMain.on('export:progress', (e, p) => {
  notifyAdmin('export-progress', { phase: 'render', done: p.done, total: p.total });
});
ipcMain.on('export:finish', () => {
  // Tüm kareler yazıldı: stdin'i kapat -> ffmpeg kalan kodlamayı bitirip 'exit' verir.
  notifyAdmin('export-progress', { phase: 'encode' });
  if (ffmpegProc && ffmpegProc.stdin.writable) {
    try { ffmpegProc.stdin.end(); } catch {}
  }
});
ipcMain.on('export:cancelled', () => finalizeExport('cancelled'));
ipcMain.on('export:error', (e, msg) => finalizeExport('error', msg));

function finalizeExport(status, message) {
  if (!exportState) return; // tek sefer
  const out = exportState.outputPath;
  const encoder = exportState.encoder;
  exportState = null;

  if (status !== 'done' && ffmpegProc) {
    try { ffmpegProc.stdin.destroy(); } catch {}
    try { ffmpegProc.kill(); } catch {}
  }
  ffmpegProc = null;

  if (exportWin && !exportWin.isDestroyed()) {
    try { exportWin.destroy(); } catch {}
  }
  exportWin = null;

  // Yarım kalan dosyayı temizle (iptal/hata)
  if (status !== 'done' && out) {
    setTimeout(() => { try { fs.existsSync(out) && fs.unlinkSync(out); } catch {} }, 200);
  }

  notifyAdmin('export-done', { status, output: out, message: message || '', encoder });
}

// ----------------------------------------------------------------------------
// Uygulama yaşam döngüsü
// ----------------------------------------------------------------------------
app.whenReady().then(async () => {
  if (process.env.SV_IDENTITY_PROBE_FILE) {
    const probePath = process.env.SV_IDENTITY_PROBE_FILE;
    const payload = lightingIdentity.status(dynamicLighting);
    try {
      fs.mkdirSync(path.dirname(probePath), { recursive: true });
      fs.writeFileSync(probePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch {}
    app.quit();
    return;
  }
  // Tanılama modu: paketlenmiş aygıt listeleme yolunu GUI'siz çalıştırır.
  // Çıktıyı hem konsola hem de %APPDATA%/soundvisualizer/diag.log dosyasına yazar
  // (portable exe konsol çıktısını geri vermediği için dosya şart).
  if (process.argv.includes('--diag')) {
    const logPath = path.join(app.getPath('userData'), 'diag.log');
    try { fs.mkdirSync(path.dirname(logPath), { recursive: true }); } catch {}
    if (!process.env.SV_DEBUG_FILE) process.env.SV_DEBUG_FILE = logPath;
    const lines = [];
    const L = (...a) => {
      const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
      lines.push(s);
      console.log(s);
    };
    L('[DIAG] ' + new Date().toISOString());
    L('[DIAG] platform=', process.platform, 'execPath=', process.execPath);
    L('[DIAG] resourcesPath=', process.resourcesPath || '(yok)');
    L('[DIAG] __dirname=', __dirname);
    L('[DIAG] PATH has node dir?', (process.env.PATH || '').toLowerCase().includes('nodejs'));
    try {
      const devs = await nativeAudio.listDevices();
      L('[DIAG] listDevices count =', Array.isArray(devs) ? devs.length : 'NOT-ARRAY');
      L('[DIAG] devices =', JSON.stringify(devs));
    } catch (e) {
      L('[DIAG] listDevices threw:', (e && e.message) || String(e));
    }
    try { fs.writeFileSync(logPath, lines.join('\n') + '\n', { flag: 'a' }); } catch {}
    app.quit();
    return;
  }

  currentConfig = loadSettings();
  if (currentConfig?.lighting?.enabled) {
    dynamicLighting.setConfig(currentConfig.lighting).catch(() => {});
  }

  // Medya katmanının video dosyalarını okuduğu protokol. Yalnızca
  // yapılandırmada SEÇİLİ olan dosyayı açar; sayfaya genel dosya sistemi
  // erişimi vermez.
  protocol.handle('sv-media', (request) => {
    try {
      const raw = decodeURIComponent(request.url.replace(/^sv-media:\/\//, ''));
      const wanted = (currentConfig && currentConfig.media && currentConfig.media.file) || '';
      const allowed = decodeURIComponent(String(wanted).replace(/^sv-media:\/\//, ''));
      if (!raw || !allowed || path.resolve(raw) !== path.resolve(allowed)) {
        return new Response('forbidden', { status: 403 });
      }
      return net.fetch(url.pathToFileURL(raw).toString());
    } catch {
      return new Response('error', { status: 500 });
    }
  });

  // Kamera izni yalnızca kendi pencerelerimize verilir.
  const sess = require('electron').session.defaultSession;
  sess.setPermissionRequestHandler((wc, permission, callback) => {
    const own = BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.webContents === wc);
    callback(own && (permission === 'media' || permission === 'midi' || permission === 'midiSysex' || permission === 'fullscreen'));
  });
  createAdminWindow();

  // Yayın sunucusu ve OSC alıcısı kayıtlı ayarlara göre açılır
  syncStreamServer().catch(() => {});
  syncOscServer().catch(() => {});

  // Ekran değişikliklerini admin'e bildir
  screen.on('display-added', () => notifyAdmin('displays-changed', getDisplayList()));
  screen.on('display-removed', () => notifyAdmin('displays-changed', getDisplayList()));
  screen.on('display-metrics-changed', () => notifyAdmin('displays-changed', getDisplayList()));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createAdminWindow();
  });

  if (SHOTS) {
    runShots().catch((e) => {
      console.error('[SHOTS] error', e);
      app.quit();
    });
  }

  if (SMOKE) {
    runSmoke().catch((e) => {
      console.log('[SMOKE] FAIL ' + (e && e.message));
      process.exitCode = 1;
      app.quit();
    });
  }
});


// ----------------------------------------------------------------------------
// Öz test (--smoke)
//
// Kayıtlı HER görselleştirici modunu ve HER arkaplanı sırayla açar, konsol
// hatalarını toplar. Modlar elle <script> etiketiyle yüklendiği için (paketleyici
// yok), yeni bir modu üç HTML'den birine eklemeyi unutmak sessiz bir hataya yol
// açardı; bu test onu gürültülü hale getirir.
// ----------------------------------------------------------------------------
async function runSmoke() {
  const errors = [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  console.log('[SMOKE] opening visualizer on primary display');
  openVisualizer(screen.getPrimaryDisplay().id);
  await wait(2200);
  if (!anyVisualizerOpen()) throw new Error('visualizer window did not open');

  const wc = meterWindow().webContents;
  wc.on('console-message', (e, level, message) => {
    if (level >= 2 || /error|hata|failed|undefined is not/i.test(message)) errors.push(message);
  });

  const modes = await wc.executeJavaScript('Object.keys(window.SVModes || {})');
  const backgrounds = await wc.executeJavaScript('Object.keys(window.SVBackgrounds || {})');
  console.log('[SMOKE] registered visualizer modes (' + modes.length + '): ' + modes.join(', '));
  console.log('[SMOKE] registered backgrounds (' + backgrounds.length + '): ' + backgrounds.join(', '));

  const base = JSON.parse(JSON.stringify(currentConfig || {}));
  const send = (over) => wc.send('config', Object.assign({}, base, over));

  // Her ön mod (gradient bir arkaplan motorudur, ön mod olarak atlanır)
  for (const m of modes) {
    if (m === 'gradient') continue;
    send({ visualizer: Object.assign({}, base.visualizer, { type: m }), background: { type: 'solid', solidColor: '#101018' } });
    await wait(260);
    const st = await wc.executeJavaScript('({ fg: !!document.getElementById("c2d"), w: document.getElementById("c2d").width })');
    if (!st.w) errors.push('mode ' + m + ': canvas has zero width');
  }
  console.log('[SMOKE] visualizer modes drawn: ' + (modes.length - 1));

  // Her arkaplan
  for (const b of backgrounds) {
    send({ background: Object.assign({}, base.background, { type: b }), visualizer: Object.assign({}, base.visualizer, { type: 'bars' }) });
    await wait(240);
  }
  send({ background: Object.assign({}, base.background, { type: 'gradient' }) });
  await wait(300);
  console.log('[SMOKE] backgrounds drawn: ' + backgrounds.length);

  // Studio shader motoru: yerleşik presetlerin hepsi derleniyor mu?
  const shaderReport = await wc.executeJavaScript(`(function(){
    try {
      var host = new window.SVShaderHost({});
      host.resize(160, 90);
      var out = [];
      for (var i = 0; i < window.SVPresets.BUILTIN.length; i++) {
        var p = window.SVPresets.BUILTIN[i];
        var r = host.setSource(p.shader, p.controls);
        out.push({ id: p.id, ok: !!r.ok, error: r.ok ? null : (r.error && r.error.message) });
      }
      host.dispose();
      return out;
    } catch (e) { return [{ id: 'HOST', ok: false, error: e.message }]; }
  })()`);
  for (const r of shaderReport) {
    console.log('[SMOKE] shader ' + r.id + ': ' + (r.ok ? 'OK' : 'FAIL — ' + r.error));
    if (!r.ok) errors.push('shader ' + r.id + ': ' + r.error);
  }

  // --- Yönetici paneli: her kategori hatasız çiziliyor mu? ---
  if (adminWin && !adminWin.isDestroyed()) {
    const awc = adminWin.webContents;
    const adminErrors = [];
    awc.on('console-message', (e, level, message) => {
      if (level >= 2) adminErrors.push(message);
    });
    const cats = await awc.executeJavaScript(
      "Array.from(document.querySelectorAll('.nav-item .nav-label')).map(function(n){return n.textContent;})"
    );
    console.log('[SMOKE] admin categories (' + cats.length + '): ' + cats.join(', '));
    for (let i = 0; i < cats.length; i++) {
      await awc.executeJavaScript(
        "(function(){var b=document.querySelectorAll('.nav-item')[" + i + "]; if(b) b.click(); " +
        "return document.querySelectorAll('#sections .card').length;})()"
      );
      await wait(320);
      const cards = await awc.executeJavaScript("document.querySelectorAll('#sections .card').length");
      console.log('[SMOKE]   ' + cats[i] + ' -> ' + cards + ' kart');
      if (!cards) errors.push('admin category "' + cats[i] + '" rendered 0 cards');
    }
    // Studio: yeni shader oluştur, derlensin
    await awc.executeJavaScript(
      "(function(){var i=Array.from(document.querySelectorAll('.nav-item .nav-label')).findIndex(function(n){return n.textContent.indexOf('Studio')>=0;});" +
      "if(i>=0) document.querySelectorAll('.nav-item')[i].click();})()"
    );
    await wait(320);
    const studioProbe = await awc.executeJavaScript(
      "(function(){var b=Array.from(document.querySelectorAll('.studio-toolbar button')).find(function(x){return x.textContent.indexOf('Shader')>=0;});" +
      "if(!b) return {ok:false,why:'shader button missing'}; b.click(); return {ok:true};})()"
    );
    await wait(600);
    const studioState = await awc.executeJavaScript(
      "(function(){var s=document.getElementById('studioStatus');var c=document.getElementById('studioCode');" +
      "return {status: s?s.textContent:'(yok)', hasEditor: !!c, ok: s? s.className.indexOf('err')<0 : false};})()"
    );
    console.log('[SMOKE] studio: ' + JSON.stringify(studioProbe) + ' ' + JSON.stringify(studioState));
    if (!studioState.hasEditor) errors.push('studio editor did not render');
    if (!studioState.ok) errors.push('studio starter shader failed to compile: ' + studioState.status);

    // Sahne üretici
    const genProbe = await awc.executeJavaScript(
      "(function(){ if(!window.SVSceneGen) return {ok:false}; var r = window.SVSceneGen.generate(); " +
      "return {ok:true, bg:r.bg, vis:r.vis, colors:r.scene.background.gradient.colors.length};})()"
    );
    console.log('[SMOKE] scene generator: ' + JSON.stringify(genProbe));
    if (!genProbe.ok || genProbe.colors !== 5) errors.push('scene generator failed');

    adminErrors.forEach((m) => errors.push('admin: ' + m));
  }

  // --- Çoklu ekran: her seçili ekranda ayrı pencere açılıyor mu? ---
  {
    const all = screen.getAllDisplays().map((d) => d.id);
    openVisualizer(all);
    await wait(1800);
    const opened = Array.from(visualizerWins.keys());
    console.log('[SMOKE] displays=' + all.length + ' opened windows=' + opened.length);
    if (opened.length !== all.length) errors.push('multi-display: ' + opened.length + '/' + all.length + ' windows opened');

    // Tek ekrana dönünce fazlalıklar kapanmalı
    openVisualizer([all[0]]);
    await wait(900);
    const after = Array.from(visualizerWins.keys());
    console.log('[SMOKE] after narrowing to 1 -> ' + after.length + ' window(s)');
    if (after.length !== 1) errors.push('multi-display: narrowing left ' + after.length + ' windows');
  }

  // --- Karartma düğmesi ---
  if (adminWin && !adminWin.isDestroyed()) {
    const awc2 = adminWin.webContents;
    const before = await awc2.executeJavaScript(
      "(function(){var b=document.getElementById('blackoutBtn'); if(!b) return null; b.click(); return true;})()"
    );
    await wait(400);
    const dark = currentConfig && currentConfig.background.type === 'solid' && currentConfig.visualizer.type === 'none';
    await awc2.executeJavaScript("document.getElementById('blackoutBtn').click()");
    await wait(400);
    const restored = currentConfig && currentConfig.background.type !== 'solid' && currentConfig.visualizer.type !== 'none';
    console.log('[SMOKE] blackout: karart=' + dark + ' geriyükle=' + restored);
    if (!before) errors.push('blackout button missing');
    else if (!dark) errors.push('blackout did not darken the scene');
    else if (!restored) errors.push('blackout did not restore the scene');
  }

  /* --- İngilizce arayüz denetimi ---
     Panel İngilizceye alınır ve tüm kategorilerde ÇEVRİLMEMİŞ Türkçe metin
     aranır. Modlar ve paneller elle sözlüğe yazıldığı için bir dizeyi
     unutmak çok kolay; bu tarama onu gürültülü hale getirir.
     Kullanıcı içeriği (aygıt adları, sahne adları) taramanın dışında. */
  if (adminWin && !adminWin.isDestroyed()) {
    const awc3 = adminWin.webContents;
    await awc3.executeJavaScript("localStorage.setItem('sv-language','en')");
    awc3.reload();
    await new Promise((r) => awc3.once('did-finish-load', r));
    await wait(1800);

    const cats = await awc3.executeJavaScript(
      "Array.from(document.querySelectorAll('.nav-item .nav-label')).map(function(n){return n.textContent;})"
    );
    console.log('[SMOKE] EN categories: ' + cats.join(', '));

    const scan = [];
    for (let i = 0; i < cats.length; i++) {
      await awc3.executeJavaScript("(function(){var b=document.querySelectorAll('.nav-item')[" + i + "]; if(b) b.click();})()");
      await wait(340);
      const found = await awc3.executeJavaScript(`(function(){
        var skip = 'source-name,audio-state,scene-name,up-name,map-signal,url-field,client-addr,gen-pair'.split(',');
        var out = [];
        // Yer tutucu ve başlık metinleri de taranır: gözle görünür oldukları
        // halde metin düğümü olmadıkları için kolayca gözden kaçarlar.
        var attrs = document.querySelectorAll('#sections [placeholder], #sections [title]');
        for (var ai = 0; ai < attrs.length; ai++) {
          var av = (attrs[ai].getAttribute('placeholder') || '') + ' ' + (attrs[ai].getAttribute('title') || '');
          if (/[çğıöşüÇĞİÖŞÜ]/.test(av)) out.push(av.trim().slice(0, 90));
        }
        var walker = document.createTreeWalker(document.getElementById('sections'), NodeFilter.SHOW_TEXT);
        var n;
        while ((n = walker.nextNode())) {
          var text = (n.nodeValue || '').trim();
          if (!text || text.length < 2) continue;
          if (!/[çğıöşüÇĞİÖŞÜ]/.test(text)) continue;
          var el = n.parentElement, skipIt = false;
          while (el && el.id !== 'sections') {
            for (var k = 0; k < skip.length; k++) if (el.classList && el.classList.contains(skip[k])) skipIt = true;
            if (el.tagName === 'OPTION' || el.tagName === 'INPUT') skipIt = true;
            el = el.parentElement;
          }
          if (!skipIt) out.push(text.slice(0, 90));
        }
        return out;
      })()`);
      found.forEach((f) => scan.push(cats[i] + ': ' + f));
    }

    if (scan.length) {
      console.log('[SMOKE] ÇEVRİLMEMİŞ (' + scan.length + '):');
      Array.from(new Set(scan)).slice(0, 40).forEach((s) => console.log('[SMOKE]   ~ ' + s));
      errors.push(scan.length + ' untranslated string(s) in English UI');
    } else {
      console.log('[SMOKE] i18n: İngilizce arayüzde çevrilmemiş metin yok');
    }

    await awc3.executeJavaScript("localStorage.removeItem('sv-language')");
  }

  /* --- Panel ekran görüntüleri (--smoke-shots) ---
     Görsel bir gözle bakılmadan "çizildi" demek yetmiyor: kartların taşması,
     boş kalan bir sütun ya da okunmaz bir kod editörü ancak resimde görünür. */
  if (process.argv.includes('--smoke-shots') && adminWin && !adminWin.isDestroyed()) {
    const shotDir = process.env.SV_SHOT_DIR || path.join(app.getPath('userData'), 'smoke-shots');
    try { fs.mkdirSync(shotDir, { recursive: true }); } catch { /* var */ }
    // Tam ekran görselleştirme pencereleri paneli örter; örtülü pencerede
    // requestAnimationFrame çalışmaz ve kare zorlaması sonsuza kadar bekler.
    closeVisualizer();
    await wait(600);
    adminWin.show();
    adminWin.focus();
    await wait(400);
    const awc4 = adminWin.webContents;
    const catNames = await awc4.executeJavaScript(
      "Array.from(document.querySelectorAll('.nav-item .nav-label')).map(function(n){return n.textContent;})"
    );
    for (let i = 0; i < catNames.length; i++) {
      await awc4.executeJavaScript("(function(){var b=document.querySelectorAll('.nav-item')[" + i + "]; if(b) b.click();})()");
      await wait(1200);
      /* capturePage son SUNULAN kareyi verir; iki rAF bekleyip yeni kareyi zorla.
         Pencere yine de örtülüyse rAF hiç çalışmaz — bu yüzden zamanlayıcıyla
         yarıştırılır ve test asla asılı kalmaz. */
      await awc4.executeJavaScript(
        'new Promise(function(r){var d=setTimeout(r,800);' +
          'requestAnimationFrame(function(){requestAnimationFrame(function(){clearTimeout(d);r();});});})'
      );
      await wait(250);
      const img = await awc4.capturePage();
      const file = path.join(shotDir, String(i + 1).padStart(2, '0') + '-' + catNames[i].replace(/[^A-Za-z0-9]+/g, '') + '.png');
      fs.writeFileSync(file, img.toPNG());
      console.log('[SMOKE] shot: ' + file);
    }
  }

  /* --- Video dışa aktarma öz testi (--smoke-export) ---
     Dışa aktarıcı AYRI bir pencere ve AYRI bir preload kullanır; modlar orada
     da elle <script> ile yüklenir. Bu yüzden panelde ve görselleştiricide
     sorunsuz çalışan bir mod, dışa aktarımda sessizce boş render edilebilir.
     Test kısa bir ses üretir, iki sahneyi gerçekten kodlar ve videonun
     SİYAH OLMADIĞINI doğrular. */
  if (process.argv.includes('--smoke-export')) {
    const outDir = process.env.SV_EXPORT_DIR || path.join(app.getPath('userData'), 'smoke-export');
    try { fs.mkdirSync(outDir, { recursive: true }); } catch { /* var */ }
    const wav = path.join(outDir, 'tone.wav');
    const ffmpegBin = resolveFfmpeg();

    const runFf = (ffArgs) =>
      new Promise((resolve) => {
        let err = '';
        let proc;
        try { proc = spawn(ffmpegBin, ffArgs, { windowsHide: true }); }
        catch { return resolve({ ok: false, err: 'spawn failed' }); }
        proc.stderr.on('data', (d) => { err += d.toString(); });
        proc.on('error', () => resolve({ ok: false, err: 'spawn failed' }));
        proc.on('close', (code) => resolve({ ok: code === 0, err }));
      });

    // 4 saniyelik vuruşlu ton: bas darbeleri olay tabanlı modları da tetikler
    const gen = await runFf([
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=60:duration=4',
      '-f', 'lavfi', '-i', 'sine=frequency=880:duration=4',
      '-filter_complex', '[0:a]tremolo=f=2:d=0.9[b];[b][1:a]amix=inputs=2:weights=3 1[a]',
      '-map', '[a]', wav,
    ]);

    if (!gen.ok) {
      console.log('[SMOKE] export: test sesi üretilemedi, adım atlandı');
    } else {
      // 'custom' yolunu sınamak için geçici bir Studio preseti yaz
      const tmpPreset = presetsStore.save({
        id: 'smoke_export_shader',
        kind: 'visualizer',
        engine: 'shader',
        name: 'Smoke Export Test',
        controls: [],
        shader:
          'void mainImage(out vec4 o, in vec2 fc){\n' +
          '  vec2 uv = fc / sv_resolution;\n' +
          '  float bar = step(uv.y, 0.25 + sv_spec(uv.x) * 0.7);\n' +
          '  vec3 col = sv_col(uv.x) * bar + vec3(0.15, 0.05, 0.25);\n' +
          '  o = vec4(col, 1.0);\n' +
          '}',
      });

      const cases = [
        { name: 'fireworks', over: { visualizer: { type: 'fireworks' }, background: { type: 'corridor' } } },
        tmpPreset.ok
          // Arkaplan bilerek DÜZ SİYAH: böylece kareye renk koyabilecek tek şey
          // Studio shader'ıdır. Shader çizmezse video baştan sona siyah çıkar ve
          // aşağıdaki blackdetect denetimi bunu yakalar.
          ? { name: 'studio-shader', over: { visualizer: { type: 'custom' }, background: { type: 'solid', solidColor: '#000000' }, custom: { visualizerId: tmpPreset.preset.id } } }
          : null,
      ].filter(Boolean);

      /* Yapılandırma TAMAMEN sabit: kullanıcının o anki ayarları miras
         alınsaydı aynı sahne her koşuda farklı render edilir ve sürümler
         arası kare karşılaştırması (regresyon ağı) imkânsız olurdu.
         Dışa aktarıcı bunu zaten varsayılanlarla derin birleştiriyor. */
      const PINNED = {
        audio: { sensitivity: 0.25, smoothing: 0.5, bassBoost: 2.05 },
        power: { fpsCap: 60, renderScale: 1, pauseOnSilence: false, hideCursor: true },
        logo: { enabled: false },
        images: { enabled: false, items: [] },
        media: { enabled: false },
        lighting: { enabled: false },
      };
      const baseCfg = JSON.parse(JSON.stringify(currentConfig || {}));
      for (const c of cases) {
        const out = path.join(outDir, c.name + '.mp4');
        try { fs.unlinkSync(out); } catch { /* yok */ }
        currentConfig = Object.assign({}, JSON.parse(JSON.stringify(PINNED)), {
          visualizer: Object.assign({ rainbow: true, sensitivity: 0.7, glow: 0.46, barCount: 160, gap: 0.36, position: 'center', thickness: 0.42, lineWidth: 3, cap: true, mirror: false, color: '#3aa6ff', color2: '#d24bff', minFreq: 20, maxFreq: 20000 }, c.over.visualizer),
          background: Object.assign({ gradient: { colors: ['#5b4be0', '#3aa6ff', '#37e0c8', '#7be07b', '#d24bff'] } }, c.over.background),
          custom: Object.assign({ visualizerId: null, backgroundId: null, params: {} }, c.over.custom || {}),
        });

        const res = await startExportJob({
          audioPath: wav, outputPath: out,
          resolution: '720p', fps: 30, quality: 'balanced', encoder: 'cpu', speed: 'fast',
        });
        const finished = res && res.ok ? await awaitExportDone(150000) : false;
        const size = fs.existsSync(out) ? fs.statSync(out).size : 0;

        // Siyah kare taraması: sahne hiç çizilmediyse video baştan sona karanlıktır
        let blackSpans = 0;
        if (size > 0) {
          const probe = await runFf(['-i', out, '-vf', 'blackdetect=d=0.4:pix_th=0.06', '-an', '-f', 'null', '-']);
          blackSpans = (probe.err.match(/black_duration:[0-9.]+/g) || [])
            .map((m) => parseFloat(m.split(':')[1]))
            .reduce((a, b) => a + b, 0);
        }

        console.log(
          '[SMOKE] export ' + c.name + ': ' + (finished ? 'bitti' : 'BİTMEDİ') +
          ' · ' + Math.round(size / 1024) + ' KB · siyah ' + blackSpans.toFixed(1) + ' sn'
        );
        if (!res || !res.ok) errors.push('export ' + c.name + ' başlatılamadı: ' + (res && res.error));
        else if (!finished) errors.push('export ' + c.name + ' zaman aşımına uğradı');
        else if (size < 20000) errors.push('export ' + c.name + ' çok küçük dosya üretti (' + size + ' B)');
        else if (blackSpans > 2.5) errors.push('export ' + c.name + ' neredeyse tamamen siyah (' + blackSpans.toFixed(1) + ' sn)');
      }

      currentConfig = baseCfg;
      if (tmpPreset.ok) presetsStore.remove(tmpPreset.preset.id);
    }
  }

  console.log('[SMOKE] frames received from helper = ' + (global.__smokeFrames || 0));
  if (errors.length) {
    console.log('[SMOKE] RESULT: FAIL (' + errors.length + ' error)');
    errors.slice(0, 20).forEach((m) => console.log('[SMOKE]   ! ' + m));
    process.exitCode = 1;
  } else {
    console.log('[SMOKE] RESULT: PASS');
  }
  app.quit();
}

app.on('before-quit', () => {
  streamServer.stop().catch(() => {});
  oscServer.stop().catch(() => {});
  dynamicLighting.stop().catch(() => {});
  nativeAudio.stopCapture();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ----------------------------------------------------------------------------
// SHOTS — README için ekran görüntüsü üretici (geliştirme aracı, `--shots`)
// Sentetik (sahte) ses karesi enjekte ederek arayüz ve görselleştiriciyi
// "canlı" gösterip docs/screenshots/ altına PNG kaydeder. Gerçek ses yakalanmaz.
// ----------------------------------------------------------------------------
async function runShots() {
  const shotsDir = path.join(__dirname, '..', '..', 'docs', 'screenshots');
  fs.mkdirSync(shotsDir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const save = async (win, name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(shotsDir, name), img.toPNG());
    console.log('[SHOTS] saved ' + name);
  };

  // Hareketli demo (animasyonlu GIF) — kareleri yakalayıp sharp ile birleştirir
  const saveGif = async (win, name, frames, delayMs, width) => {
    let sharp;
    try {
      sharp = require('sharp');
    } catch {
      console.log('[SHOTS] sharp yok, GIF atlandı');
      return;
    }
    const bufs = [];
    for (let i = 0; i < frames; i++) {
      const img = await win.webContents.capturePage();
      bufs.push(await sharp(img.toPNG()).resize(width).png().toBuffer());
      await wait(delayMs);
    }
    await sharp(bufs, { join: { animated: true } })
      .gif({ loop: 0, delay: delayMs })
      .toFile(path.join(shotsDir, name));
    console.log('[SHOTS] saved ' + name);
  };

  // Logoyu dataURL olarak yükle (görselleştirici merkez logosu için)
  let logoSrc = null;
  try {
    const logoPath = path.join(__dirname, '..', '..', 'assets', 'logo-256.png');
    logoSrc = 'data:image/png;base64,' + fs.readFileSync(logoPath).toString('base64');
  } catch {}

  // Sentetik FFT karesi: bas vurgulu, hareketli tepeli spektrum + dalga formu
  const makeFrame = (t) => {
    const freq = new Uint8Array(1024);
    const beat = 0.4 + 0.6 * Math.pow(Math.max(0, Math.sin(t * 3.4)), 1.6);
    for (let i = 0; i < 1024; i++) {
      // bas ağırlıklı, hızlı düşen taban (sağdaki yüksek frekanslar kısa kalsın)
      const decay = Math.pow(1 - i / 1024, 2.8);
      // hareketli tepe noktaları (spektrumda gezinen tek tük yüksek barlar)
      const p1 = Math.exp(-Math.pow((i - 24 - 14 * Math.sin(t * 1.5)) / 10, 2));
      const p2 = 0.7 * Math.exp(-Math.pow((i - 90 - 50 * Math.sin(t * 0.8)) / 22, 2));
      const p3 = 0.55 * Math.exp(-Math.pow((i - 240 - 120 * Math.sin(t * 1.1)) / 30, 2));
      const p4 = 0.4 * Math.exp(-Math.pow((i - 520 - 200 * Math.sin(t * 0.6 + 1)) / 26, 2));
      // mikro dalgalanma (her bar biraz farklı yüksek/alçak olsun)
      const ripple = 0.12 * (0.5 + 0.5 * Math.sin(i * 0.6 + t * 5));
      let v = decay * (0.3 + 0.5 * beat) + (p1 * beat + p2 + p3 + p4) * 0.7 + ripple * decay;
      v += Math.random() * 0.03;
      freq[i] = Math.max(0, Math.min(255, v * 150));
    }
    const time = new Uint8Array(2048);
    for (let i = 0; i < 2048; i++) {
      const s =
        Math.sin((i / 2048) * Math.PI * 2 * 5 + t * 6) * 0.42 * beat +
        Math.sin((i / 2048) * Math.PI * 2 * 2 + t * 2) * 0.3;
      time[i] = Math.max(0, Math.min(255, 128 + s * 120));
    }
    return { freq, time, sampleRate: 48000 };
  };

  // 1) Yönetici paneli ekran görüntüsü — panel ayar kartlarını çizene kadar bekle
  // (aygıt tanılama/aydınlatma taraması gecikebildiği için sabit süre yetmiyor)
  const adminReady = async () => {
    for (let i = 0; i < 40; i++) {
      if (!adminWin || adminWin.isDestroyed()) return false;
      try {
        const n = await adminWin.webContents.executeJavaScript(
          "document.getElementById('sections') ? document.getElementById('sections').children.length : 0"
        );
        if (n > 0) return true;
      } catch {}
      await wait(250);
    }
    return false;
  };
  if (!(await adminReady())) console.log('[SHOTS] admin panel hazır olmadı, yine de kaydediliyor');

  // Ekran görüntüsü yerel arayüz durumundan bağımsız olsun: "Sahne" kategorisi,
  // gelişmiş kapalı. Kullanıcının tercihi sonradan geri yüklenir.
  let uiState = null;
  if (adminWin && !adminWin.isDestroyed()) {
    try {
      uiState = await adminWin.webContents.executeJavaScript(
        "(function(){var s={c:localStorage.getItem('sv-category'),a:localStorage.getItem('sv-advanced')};" +
          "localStorage.setItem('sv-category','scene');localStorage.setItem('sv-advanced','0');" +
          "var t=document.getElementById('advToggle');if(t&&t.checked){t.checked=false;t.dispatchEvent(new Event('change'));}" +
          "var b=document.querySelectorAll('.nav-item');if(b[0])b[0].click();" +
          "return JSON.stringify(s)})()"
      );
    } catch {}
  }
  await wait(900); // yeniden çizim + önizleme/gradyan ilk karesi otursun
  if (adminWin && !adminWin.isDestroyed()) await save(adminWin, 'admin-panel.png');
  if (uiState && adminWin && !adminWin.isDestroyed()) {
    try {
      await adminWin.webContents.executeJavaScript(
        '(function(){var s=' + uiState + ';' +
          "if(s.c)localStorage.setItem('sv-category',s.c);else localStorage.removeItem('sv-category');" +
          "if(s.a)localStorage.setItem('sv-advanced',s.a);else localStorage.removeItem('sv-advanced');" +
          'return true})()'
      );
    } catch {}
  }

  // 2) Görselleştirici penceresi (sabit boyut, tam ekran değil — net görüntü için)
  const vw = new BrowserWindow({
    width: 1600,
    height: 900,
    frame: false,
    backgroundColor: '#000000',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-visualizer.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  await vw.loadFile(path.join(__dirname, '..', 'visualizer', 'index.html'));

  const base = loadSettings() || {};
  const cfgFor = (over) =>
    Object.assign(
      {},
      base,
      {
        background: { type: 'gradient', gradient: { style: 'soft', audioBrightness: 0.6, audioHue: 0.25 } },
        logo: logoSrc ? { enabled: true, src: logoSrc, scale: 0.2, glow: 0.35, opacity: 1, pulse: 0.3, x: 0.5, y: 0.5 } : { enabled: false },
        power: { fpsCap: 60, renderScale: 1.0, pauseOnSilence: false, hideCursor: true },
      },
      over
    );
  const sendCfg = (over) => vw.webContents.send('config', cfgFor(over));

  // Sahte ses karelerini pompala
  let t0 = Date.now();
  const pump = setInterval(() => {
    if (vw.isDestroyed()) return;
    vw.webContents.send('native-audio', makeFrame((Date.now() - t0) / 1000));
  }, 30);

  const presets = {
    aurora: ['#5b4be0', '#3aa6ff', '#37e0c8', '#7be07b', '#d24bff'],
    neon: ['#ff00cc', '#3333ff', '#00ffe0', '#9d00ff', '#ff0066'],
    sunset: ['#ff5e62', '#ff9966', '#ffcf6b', '#c94b8e', '#5b2c83'],
    lava: ['#1a0000', '#7a0000', '#ff2e00', '#ff8a00', '#ffd000'],
    ocean: ['#0f2027', '#1c92d2', '#2af5d4', '#136a8a', '#0b486b'],
    ice: ['#cfefff', '#74c0ff', '#3a7bd5', '#7ee8fa', '#eaf6ff'],
    night: ['#020111', '#191654', '#43377c', '#7b2ff7', '#22264b'],
    forest: ['#0b3d2e', '#1e6f5c', '#56c596', '#a3eb9d', '#0f5132'],
  };
  const grad = (style, colors, b, h) => ({ type: 'gradient', gradient: { style, colors, audioBrightness: b, audioHue: h } });
  const noLogo = { enabled: false };

  // 1) Barlar (alt) + gökkuşağı — Aurora yumuşak
  sendCfg({ visualizer: { type: 'bars', rainbow: true, position: 'bottom', barCount: 76, gap: 0.28, cap: true, glow: 0.5 },
            background: grad('soft', presets.aurora, 0.55, 0.08) });
  await wait(1500); await save(vw, 'visualizer-bars.png');

  // 2) Barlar (alt) + ayna (bas ortada) — Okyanus plazma
  sendCfg({ visualizer: { type: 'bars', rainbow: true, position: 'bottom', mirror: true, barCount: 72, gap: 0.32, cap: true, glow: 0.6 },
            background: grad('plasma', presets.ocean, 0.85, 0.05), logo: noLogo });
  await wait(1400); await save(vw, 'visualizer-bars-mirror.png');

  // 3) Barlar (orta, simetrik) + gökkuşağı — Buz yumuşak
  sendCfg({ visualizer: { type: 'bars', rainbow: true, position: 'center', barCount: 84, gap: 0.34, cap: true, glow: 0.45 },
            background: grad('soft', presets.ice, 0.5, 0.0), logo: noLogo });
  await wait(1400); await save(vw, 'visualizer-bars-thin.png');

  // 4) Merkez barlar + logo — Neon plazma
  sendCfg({ visualizer: { type: 'centerBars', rainbow: true, barCount: 84, gap: 0.2, glow: 0.55 },
            background: grad('plasma', presets.neon, 0.9, 0.12) });
  await wait(1400); await save(vw, 'visualizer-center.png');

  // 5) Dalga (kalın, ayna) + logo — Gün batımı yumuşak
  sendCfg({ visualizer: { type: 'wave', rainbow: false, color: '#ffd3b6', thickness: 0.55, lineWidth: 4, glow: 0.5, mirror: true },
            background: grad('soft', presets.sunset, 0.6, 0.06) });
  await wait(1400); await save(vw, 'visualizer-wave.png');

  // 6) Dalga (ince çizgi) + gökkuşağı — Gece plazma
  sendCfg({ visualizer: { type: 'wave', rainbow: true, thickness: 0.32, lineWidth: 3, glow: 0.7, mirror: false },
            background: grad('plasma', presets.night, 1.0, 0.15), logo: noLogo });
  await wait(1400); await save(vw, 'visualizer-wave-line.png');

  // 7) Çember + logo — Lav plazma
  sendCfg({ visualizer: { type: 'circular', rainbow: false, color: '#ff8a00', barCount: 96, glow: 0.6 },
            background: grad('plasma', presets.lava, 0.85, 0.05) });
  await wait(1400); await save(vw, 'visualizer-circular.png');

  // 8) Çember + gökkuşağı + logo — Orman yumuşak
  sendCfg({ visualizer: { type: 'circular', rainbow: true, barCount: 120, gap: 0.1, glow: 0.55 },
            background: grad('soft', presets.forest, 0.6, 0.1) });
  await wait(1400); await save(vw, 'visualizer-circular-rainbow.png');

  // 9) Düz renk arkaplan + marka kırmızısı barlar
  sendCfg({ visualizer: { type: 'bars', rainbow: false, color: '#dc2727', position: 'bottom', barCount: 88, gap: 0.3, cap: true, glow: 0.4 },
            background: { type: 'solid', solidColor: '#0b0c14' }, logo: noLogo });
  await wait(1400); await save(vw, 'visualizer-solid.png');

  // --- Hareketli demolar (animasyonlu GIF) ---
  // Merkez barlar (gökkuşağı) — ses demosu
  sendCfg({ visualizer: { type: 'centerBars', rainbow: true, barCount: 84, gap: 0.2, glow: 0.55 },
            background: grad('plasma', presets.neon, 0.9, 0.12) });
  await wait(600);
  await saveGif(vw, 'demo-visualizer.gif', 30, 55, 700);

  // Barlar (alt, gökkuşağı) — ses demosu
  sendCfg({ visualizer: { type: 'bars', rainbow: true, position: 'bottom', barCount: 72, gap: 0.28, cap: true, glow: 0.5 },
            background: grad('soft', presets.aurora, 0.6, 0.1), logo: noLogo });
  await wait(600);
  await saveGif(vw, 'demo-bars.gif', 28, 55, 700);

  clearInterval(pump);
  console.log('[SHOTS] done');
  if (!vw.isDestroyed()) vw.close();
  app.quit();
}
