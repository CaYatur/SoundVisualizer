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

// English is the fallback. Turkish is selected only for a Turkish system locale.
function appLocale() {
  try { return /^tr(?:-|$)/i.test(app.getLocale()) ? 'tr' : 'en'; }
  catch { return 'en'; }
}
function trUi(tr, en) { return appLocale() === 'tr' ? tr : en; }

// ----------------------------------------------------------------------------
// Durum
// ----------------------------------------------------------------------------
let adminWin = null;
let visualizerWin = null;
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
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
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
    if (visualizerWin && !visualizerWin.isDestroyed()) visualizerWin.close();
  });
}

function openVisualizer(displayId) {
  const displays = screen.getAllDisplays();
  const target = displays.find((d) => d.id === displayId) || screen.getPrimaryDisplay();
  const b = target.bounds;

  // Var olan pencereyi yeniden konumlandır
  if (visualizerWin && !visualizerWin.isDestroyed()) {
    visualizerWin.setBounds(b);
    visualizerWin.setFullScreen(false);
    visualizerWin.show();
    visualizerWin.focus();
    setTimeout(() => {
      if (visualizerWin && !visualizerWin.isDestroyed()) visualizerWin.setFullScreen(true);
    }, 120);
    notifyAdmin('visualizer-status', { open: true, displayId });
    return;
  }

  visualizerWin = new BrowserWindow({
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

  visualizerWin.loadFile(path.join(__dirname, '..', 'visualizer', 'index.html'));
  attachSmoke(visualizerWin, 'VIS');

  visualizerWin.once('ready-to-show', () => {
    visualizerWin.setBounds(b);
    visualizerWin.show();
    setTimeout(() => {
      if (visualizerWin && !visualizerWin.isDestroyed()) visualizerWin.setFullScreen(true);
      applyAlwaysOnTop();
    }, 120);
  });

  // Odak kaybında (başka uygulama öne çıktığında) üstte kalmayı yeniden dayat
  visualizerWin.on('blur', () => {
    if (wantsAlwaysOnTop()) raiseVisualizer();
  });

  // Pencere yüklenince ses yakalamayı istenen duruma getir. Panel önizlemesi
  // nedeniyle yakalama zaten sürüyorsa yeniden başlatılmaz; kare geri çağrısı
  // hedef pencereyi her seferinde yeniden okuduğu için yeni pencereye de akar.
  visualizerWin.webContents.on('did-finish-load', () => {
    syncCapture();
  });

  // ESC ile kapat
  visualizerWin.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      closeVisualizer();
    }
  });

  visualizerWin.on('closed', () => {
    visualizerWin = null;
    if (onTopTimer) {
      clearInterval(onTopTimer);
      onTopTimer = null;
    }
    // Panel önizlemesi hâlâ kare istiyorsa yakalama kesintisiz sürer, istemiyorsa durur
    syncCapture();
    notifyAdmin('visualizer-status', { open: false, displayId: null });
  });

  notifyAdmin('visualizer-status', { open: true, displayId });
}

// Yapılandırmadan seçili ses kaynaklarını çöz (yeni "sources" dizisi veya eski
// tek "source" alanı desteklenir)
function configuredSources() {
  const audio = currentConfig && currentConfig.audio;
  if (audio && Array.isArray(audio.sources) && audio.sources.length > 0) return audio.sources;
  if (audio && audio.source) return [audio.source];
  return ['default'];
}

// Yakalamayı isteyen var mı? Görselleştirici penceresi ya da paneldeki canlı
// önizleme. İkisi de kapalıysa yakalama durdurulur.
function captureWanted() {
  return !!(visualizerWin && !visualizerWin.isDestroyed()) || previewSubscribed;
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
      if (visualizerWin && !visualizerWin.isDestroyed()) {
        visualizerWin.webContents.send('native-audio', frame);
      }
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

function closeVisualizer() {
  if (visualizerWin && !visualizerWin.isDestroyed()) {
    visualizerWin.close();
  }
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
  if (!visualizerWin || visualizerWin.isDestroyed()) return;
  visualizerWin.setAlwaysOnTop(true, 'screen-saver');
  visualizerWin.setVisibleOnAllWorkspaces(true);
  visualizerWin.moveTop();
}

function applyAlwaysOnTop() {
  if (onTopTimer) {
    clearInterval(onTopTimer);
    onTopTimer = null;
  }
  if (!visualizerWin || visualizerWin.isDestroyed()) return;

  if (!wantsAlwaysOnTop()) {
    visualizerWin.setAlwaysOnTop(false);
    visualizerWin.setVisibleOnAllWorkspaces(false);
    return;
  }
  raiseVisualizer();
  // Başka bir uygulama araya girerse geri al
  onTopTimer = setInterval(() => {
    if (!visualizerWin || visualizerWin.isDestroyed()) {
      clearInterval(onTopTimer);
      onTopTimer = null;
      return;
    }
    if (wantsAlwaysOnTop() && !visualizerWin.isAlwaysOnTop()) raiseVisualizer();
    else if (wantsAlwaysOnTop()) visualizerWin.moveTop();
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

ipcMain.handle('open-visualizer', (e, displayId) => {
  openVisualizer(displayId);
  return true;
});

ipcMain.handle('close-visualizer', () => {
  closeVisualizer();
  return true;
});

ipcMain.handle('visualizer-is-open', () => {
  return !!(visualizerWin && !visualizerWin.isDestroyed());
});

// Admin -> ana süreç -> görselleştirici (yapılandırma güncellemesi)
ipcMain.on('update-config', (e, config) => {
  currentConfig = config;
  saveSettings(config);
  dynamicLighting.setConfig(config?.lighting).catch(() => {});
  if (visualizerWin && !visualizerWin.isDestroyed()) {
    visualizerWin.webContents.send('config', config);
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
ipcMain.on('audio-meter', (e, data) => {
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
  for (const win of [adminWin, visualizerWin]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
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
    openVisualizer(currentConfig.display && currentConfig.display.id);
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
  if (visualizerWin && !visualizerWin.isDestroyed()) visualizerWin.webContents.send('config', currentConfig);
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
      onCommand: (msg) => applyRemoteCommand(msg),
      onClientsChanged: (list) => notifyAdmin('stream-clients', list),
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

ipcMain.handle('export:start', async (e, opts) => {
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
    audioBuffer: ab,
    width: w,
    height: h,
    fps,
    cfg: currentConfig || {},
  });

  return { ok: true };
});

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
    callback(own && (permission === 'media' || permission === 'fullscreen'));
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
  if (!visualizerWin || visualizerWin.isDestroyed()) throw new Error('visualizer window did not open');

  const wc = visualizerWin.webContents;
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
