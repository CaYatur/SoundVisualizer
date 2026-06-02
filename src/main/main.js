'use strict';
/*
 * CaYaDev Visualizer — Ses Görselleştirici
 * Copyright (c) 2026 CaYaDev — https://cayadev.com
 * MIT License (bkz. LICENSE)
 */

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const nativeAudio = require('./native-audio');

// ----------------------------------------------------------------------------
// Durum
// ----------------------------------------------------------------------------
let adminWin = null;
let visualizerWin = null;
let currentConfig = null; // son bilinen yapılandırma (admin -> görselleştirici köprüsü)
let lastCaptureSource = null; // o an yakalanan çıkış aygıtı

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
    label: `Ekran ${i + 1}` + (d.id === primary.id ? ' (Birincil)' : ''),
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
function createAdminWindow() {
  adminWin = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 940,
    minHeight: 640,
    title: 'Ses Görselleştirici — Yönetici Paneli',
    backgroundColor: '#0e0f1a',
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
    title: 'Görselleştirme',
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
    }, 120);
  });

  // Pencere yüklenince ses yakalamayı başlat
  visualizerWin.webContents.on('did-finish-load', () => {
    startVisualizerCapture();
  });

  // ESC ile kapat
  visualizerWin.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      closeVisualizer();
    }
  });

  visualizerWin.on('closed', () => {
    visualizerWin = null;
    nativeAudio.stopCapture();
    lastCaptureSource = null;
    notifyAdmin('visualizer-status', { open: false, displayId: null });
  });

  notifyAdmin('visualizer-status', { open: true, displayId });
}

// Seçili ses kaynak(lar)ının yakalamasını başlat; kareleri görselıeştiricide ilet
function startVisualizerCapture() {
  const audio = currentConfig && currentConfig.audio;
  // Yeni format (sources: dizi) veya eski format (source: string) desteklenir
  const sources =
    audio && Array.isArray(audio.sources) && audio.sources.length > 0
      ? audio.sources
      : audio && audio.source
      ? [audio.source]
      : ['default'];
  lastCaptureSource = sources;
  nativeAudio.startCapture(
    sources,
    (frame) => {
      if (SMOKE) global.__smokeFrames = (global.__smokeFrames || 0) + 1;
      if (visualizerWin && !visualizerWin.isDestroyed()) {
        visualizerWin.webContents.send('native-audio', frame);
      }
    },
    (status) => {
      if (SMOKE) console.log('[AUDIO-STATUS] ' + JSON.stringify(status));
      notifyAdmin('audio-source-status', status);
    }
  );
}

function closeVisualizer() {
  if (visualizerWin && !visualizerWin.isDestroyed()) {
    visualizerWin.close();
  }
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

// Tüm ses aygıtları (çıkış + giriş/mikrofon)
ipcMain.handle('get-output-devices', () => nativeAudio.listDevices());

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
  if (visualizerWin && !visualizerWin.isDestroyed()) {
    visualizerWin.webContents.send('config', config);
    // ses kaynağı değiştiyse yakalamayı yeniden başlat
    const newAudio = config.audio;
    const newSources = newAudio
      ? Array.isArray(newAudio.sources) && newAudio.sources.length > 0
        ? newAudio.sources
        : [newAudio.source || 'default']
      : ['default'];
    const lastSources = Array.isArray(lastCaptureSource)
      ? lastCaptureSource
      : [lastCaptureSource || 'default'];
    if (JSON.stringify(newSources) !== JSON.stringify(lastSources)) {
      startVisualizerCapture();
    }
  }
});

// Görselleştirici açıldığında mevcut yapılandırmayı ister
ipcMain.handle('request-config', () => currentConfig);

// Görselleştirici -> admin (ses seviyesi göstergesi vb.)
ipcMain.on('audio-meter', (e, data) => {
  notifyAdmin('audio-meter', data);
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
// Uygulama yaşam döngüsü
// ----------------------------------------------------------------------------
app.whenReady().then(() => {
  currentConfig = loadSettings();
  createAdminWindow();

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
    const sendCfg = (label, c) => {
      console.log('[SMOKE] -> ' + label);
      if (visualizerWin && !visualizerWin.isDestroyed())
        visualizerWin.webContents.send('config', c);
    };
    setTimeout(() => {
      console.log('[SMOKE] opening visualizer on primary display');
      openVisualizer(screen.getPrimaryDisplay().id);
    }, 1500);
    setTimeout(() => sendCfg('centerBars', { visualizer: { type: 'centerBars' } }), 3000);
    setTimeout(() => sendCfg('wave', { visualizer: { type: 'wave' } }), 4000);
    setTimeout(() => sendCfg('circular', { visualizer: { type: 'circular', rainbow: false } }), 4800);
    setTimeout(() => sendCfg('gradient SOFT', { background: { type: 'gradient', gradient: { style: 'soft' } }, visualizer: { type: 'centerBars' } }), 5400);
    setTimeout(() => sendCfg('gradient PLASMA audioHue+bright', { background: { type: 'gradient', gradient: { style: 'plasma', audioHue: 0.6, audioBrightness: 1.2 } } }), 6100);
    setTimeout(() => {
      console.log('[SMOKE] frames received from helper = ' + (global.__smokeFrames || 0));
      console.log('[SMOKE] done, quitting');
      app.quit();
    }, 7500);
  }
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

  // 1) Yönetici paneli ekran görüntüsü
  await wait(1400);
  if (adminWin && !adminWin.isDestroyed()) await save(adminWin, 'admin-panel.png');

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
