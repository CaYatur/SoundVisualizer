'use strict';
/*
 * CaYaDev Visualizer — Ses Görselleştirici
 * Copyright (c) 2026 CaYaDev — https://cayadev.com
 * MIT License (bkz. LICENSE)
 */

const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
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

// ----------------------------------------------------------------------------
// Genel JSON içe/dışa aktarma (renk şablonları + arkaplan ayarları)
// ----------------------------------------------------------------------------
ipcMain.handle('file:export-json', async (e, defaultName, data) => {
  try {
    const r = await dialog.showSaveDialog(adminWin, {
      title: 'Dışa Aktar',
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
      title: title || 'İçe Aktar',
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
    title: 'Ses Dosyası Seç',
    properties: ['openFile'],
    filters: [
      { name: 'Ses Dosyaları', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'] },
      { name: 'Tümü', extensions: ['*'] },
    ],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
});

ipcMain.handle('export:pick-output', async (e, defaultName) => {
  const r = await dialog.showSaveDialog(adminWin, {
    title: 'Videoyu Kaydet',
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
