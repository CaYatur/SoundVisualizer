/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* PERFORMANS ÖLÇÜMÜ — her görselleştiricinin, arkaplanın ve efektin kare
   süresi; isteğe bağlı uzun koşu.

   NEDEN GERÇEK GÖRSELLEŞTİRİCİ SAYFASI: ölçülen şey kullanıcının gördüğü
   yol olmalı — katman yığını, birleştirme, efekt zinciri, kare hızı
   mantığı. Betik uygulamanın kendi sayfasını (src/visualizer/index.html)
   kendi köprüsüyle (preload-visualizer.js) açıyor; ana uygulama yerine
   bu betik o köprünün istediği kanallara cevap veriyor. Ana süreç
   (main.js) hiç yüklenmiyor: kullanıcı ayarlarına, ışıklara, MCP'ye,
   Spout'a dokunulmuyor. Kullanıcı verisi geçici bir klasörde.

   NEDEN SENTETİK SES: sessizlikte modların çoğu neredeyse hiç iş yapmıyor
   ve ölçüm maliyeti olduğundan düşük gösterir. Ses, ekran görüntüsü
   üreticisinin ve panel önizlemesinin verdiği deterministik 120 BPM
   örnek (bench-lib demoFrame), ~70 Hz'de — gerçek yakalamanın hızında.

   NEDEN DİKEY SENKRON AÇIK: kullanıcının gördüğü bu. Ölçüm en yüksek
   yenileme hızlı ekranda yapılıyor; yenileme hızına yetişen sahne o hızı
   okur, yetişemeyen kare kaçırır ve düşük okur. `--uncapped` kilidi
   kaldırır (Electron `--disable-frame-rate-limit --disable-gpu-vsync`) ve
   pay ölçer, ama ölçüldü ki GPU'yu boğan bir sahne (wavefield) kuyrukta iş
   bırakıyor ve bu iş SONRAKİ sahnenin ilk saniyelerine yazılıyor; dikey
   senkronla bu olmuyor. Pencere görünür: gizli pencerede rAF güvenilir
   koşmuyor. Kare başına piksel geri okunmuyor; okuma ölçümü GPU'nun değil
   okumanın süresi yapıyordu.

   Kullanım:
     npm run bench
     npm run bench -- --only=milkdrop          (anahtarı içeren sahneler)
     npm run bench -- --scenes=background:wavefield,background:solid  (bu sırayla)
     npm run bench -- --seconds=5 --warm=2
     npm run bench -- --sizes=1920x1080,1280x720  (tuval boyutları)
     npm run bench -- --native                 (ek olarak ekranın tam boyutu)
     npm run bench -- --soak=20                (20 dk Auto VJ uzun koşusu)
     npm run bench -- --json=sonuc.json --md=sonuc.md
     npm run bench -- --uncapped               (kilitsiz: pay ölçümü, bkz. yukarı)
     npm run bench -- --shots=<klasör>         (her sahnenin son karesi, doğrulama için)

   Sayılar YALNIZ ölçülen makineye aittir; makineler arası kıyas için
   değil, aynı makinede değişiklik öncesi/sonrası için. Makineyi boşta
   ölçün: GPU'yu kullanan bir oyun ya da video sonucu bozar. */

const path = require('path');
const fs = require('fs');
const os = require('os');

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const a = argv.find((x) => x.startsWith('--' + k + '='));
  return a ? a.slice(k.length + 3) : d;
};
const flag = (k) => argv.indexOf('--' + k) >= 0;

// --- Node tarafı: kendini Electron ile yeniden başlat ------------------------

if (!process.versions.electron) {
  const { spawn } = require('child_process');
  const electronPath = require('electron');
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronPath, [__filename].concat(argv), {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    env,
  });
  child.on('close', (code) => process.exit(code));
  return;
}

// --- Electron tarafı --------------------------------------------------------

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const vm = require('vm');
const { execSync } = require('child_process');
const B = require('./bench-lib.js');
const DEMO = require('../src/shared/demo-audio.js');
const CATALOG = require('../src/shared/mode-catalog.js');

const ROOT = path.join(__dirname, '..');
const SECONDS = Math.max(1, Number(arg('seconds', 3)) || 3);
const WARM = Math.max(0.5, Number(arg('warm', 1)) || 1);
const ONLY = arg('only', '');
// Sahneler bu sırayla (aynısı tekrar edebilir): grup:kimlik,grup:kimlik
const SCENES = String(arg('scenes', '')).split(',').map((x) => x.trim()).filter(Boolean);
const SOAK = Math.max(0, Number(arg('soak', 0)) || 0);
const SIZES = String(arg('sizes', '1920x1080')).split(',').map((x) => x.trim().split('x').map(Number)).filter((x) => x[0] > 0 && x[1] > 0);
const NATIVE = flag('native');
const JSON_OUT = arg('json', '');
const MD_OUT = arg('md', '');
const SHOTS = arg('shots', '');

const UNCAPPED = flag('uncapped');
if (UNCAPPED) {
  app.commandLine.appendSwitch('disable-frame-rate-limit');
  app.commandLine.appendSwitch('disable-gpu-vsync');
}
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'sv-bench-')));

// İlerleme satırı yazılamazsa (boru kapandı) ölçüm durmasın
const say = (s) => { try { process.stdout.write(s + '\n'); } catch (e) { /* boru kapalı */ } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* Etiketler panelin İngilizce sözlüğünden: rapor İngilizce. */
function englishLabels() {
  try {
    const doc = { documentElement: { lang: '' }, readyState: 'complete', title: '', body: {}, addEventListener: () => {} };
    const win = {
      navigator: { languages: ['en-US'], language: 'en-US' },
      localStorage: { getItem: () => 'en', setItem: () => {} },
      alert: () => {}, confirm: () => {}, document: doc,
      MutationObserver: function () { this.observe = () => {}; },
      Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    };
    win.window = win;
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/shared/i18n.js'), 'utf8'), vm.createContext(win));
    return (s) => win.SVI18n.t(s);
  } catch (e) {
    return (s) => s;
  }
}

/* Görselleştirici köprüsünün (preload-visualizer.js) istediği kanallar.
   Ölçümde kitaplık, doku, söz, kamera yok: boş ve güvenli cevaplar. */
let currentCfg = null;
function wireIpc(errors) {
  const empty = {
    'presets:list': [],
    'presets:head': { gen: 0 },
    'presets:since': { gen: 0, upsert: [], remove: [] },
    'nowplaying:current': null,
    'milkdrop:textures': [],
    'milkdrop:texture': null,
    'logo-lib:read': null,
    'lyrics-lib:snapshot': [],
    'lyrics-lib:read': null,
    'visualizer:geometry-lock-get': false,
    'cam-relay-claim': false,
    'milkdrop:sprite-image': null,
    'milkdrop:sprite': null,
  };
  ipcMain.handle('request-config', () => currentCfg);
  for (const ch of Object.keys(empty)) ipcMain.handle(ch, () => empty[ch]);
  ipcMain.on('visualizer-message', (e, msg) => {
    if (msg && (msg.type === 'error' || msg.error)) errors.push(String(msg.error || msg.message || JSON.stringify(msg)).slice(0, 200));
  });
}

/* Her sahnenin tabanı. Gerisi görselleştiricide varsayılanlarla dolar. */
function baseConfig() {
  return {
    power: { fpsCap: 0, renderScale: 1, pauseOnSilence: false, hideCursor: true },
    // Ses hassasiyeti ekran görüntüsü üreticisindeki gibi: örnek ses bununla dolu görünür
    audio: { sensitivity: 0.6 },
    autovj: { enabled: false },
    lighting: { enabled: false },
    /* Geçiş kapalı: açıkken önceki sahne geçiş boyunca yenisiyle birlikte
       çiziliyor ve maliyeti sonraki sahnenin ölçümüne yazılıyor. */
    transition: { enabled: false },
  };
}

function machineInfo(gpu, display) {
  const cpus = os.cpus() || [];
  const dev = (gpu && gpu.gpuDevice && gpu.gpuDevice.find((d) => d.active)) || (gpu && gpu.gpuDevice && gpu.gpuDevice[0]) || {};
  const aux = (gpu && gpu.auxAttributes) || {};
  return {
    os: os.type() + ' ' + os.release() + ' ' + os.arch(),
    cpu: cpus[0] ? cpus[0].model.trim() : '?',
    cores: cpus.length,
    ramGb: Math.round(os.totalmem() / 1073741824),
    gpu: aux.glRenderer || dev.deviceString || ('vendor 0x' + (dev.vendorId || 0).toString(16) + ' device 0x' + (dev.deviceId || 0).toString(16)),
    driver: dev.driverVersion || aux.driverVersion || '',
    electron: process.versions.electron,
    display: display.size.width * display.scaleFactor + '×' + display.size.height * display.scaleFactor +
      ' @ ' + (display.displayFrequency || '?') + ' Hz, scale ' + display.scaleFactor,
  };
}

function commitSha() {
  try {
    const sha = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain --untracked-files=no', { cwd: ROOT, encoding: 'utf8' }).trim();
    return sha + (dirty ? ' (uncommitted changes)' : '');
  } catch (e) {
    return '?';
  }
}

const PROBE = `(() => {
  if (window.__bench) return 'var';
  const st = { f: [], last: 0 };
  const tick = (now) => { if (st.last) st.f.push(now - st.last); st.last = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.__bench = {
    // Sıfırlamada son kare zamanı da silinir: önceki bir duraklama yeni ölçümün ilk karesine yazılmasın
    reset() { st.f = []; st.last = 0; return 1; },
    take() { const f = st.f; st.f = []; return f; },
    canvas() { const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]; return c ? c.width + '×' + c.height : '?'; },
  };
  return 'ok';
})()`;

async function measureScene(win, sc, errors) {
  const cfg = B.mergePatch(baseConfig(), sc.patch);
  delete cfg.postfxType;
  if (sc.patch.postfxType) {
    const entry = await win.webContents.executeJavaScript(
      'JSON.stringify(window.SVPostFX && window.SVPostFX.defaultChainEntry(' + JSON.stringify(sc.patch.postfxType) + '))');
    cfg.postfx = entry && entry !== 'null' ? [JSON.parse(entry)] : [];
  }
  currentCfg = cfg;
  const before = errors.length;
  win.webContents.send('config', cfg);
  await wait(WARM * 1000);
  await win.webContents.executeJavaScript('window.__bench.reset()');
  await wait(SECONDS * 1000);
  const f = await win.webContents.executeJavaScript('window.__bench.take()');
  const res = { group: sc.group, id: sc.id, label: sc.label, stats: B.frameStats(f) };
  if (SHOTS) {
    // Ölçülen sahnenin gerçekten çizildiğinin kanıtı: ölçümden SONRA alınıyor
    const img = await win.webContents.capturePage();
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(path.join(SHOTS, sc.group + '-' + sc.id + '.jpg'), img.resize({ width: 640 }).toJPEG(80));
  }
  if (errors.length > before) res.error = errors[errors.length - 1];
  if (sc.patch.postfxType && !cfg.postfx.length) res.error = 'effect not found';
  return res;
}

/* Tuval pencerenin FİZİKSEL piksel boyutunda kuruluyor (CSS × dpr).
   İstenen tuval için pencere boyutu ekran ölçeğine bölünüyor; kurulan
   tuval her çözünürlükte okunup rapora yazılıyor. */
async function openWindow(display, w, h) {
  const sf = display.scaleFactor || 1;
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: Math.round(w / sf),
    height: Math.round(h / sf),
    useContentSize: true,
    frame: false,
    show: true,
    backgroundColor: '#000000',
    enableLargerThanScreen: true,
    webPreferences: {
      preload: path.join(ROOT, 'src/main/preload-visualizer.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      additionalArguments: ['--sv-display-id=' + display.id],
    },
  });
  await win.loadFile(path.join(ROOT, 'src/visualizer/index.html'));
  // Örnek ses ~70 Hz: gerçek yakalama yardımcısının kare hızı
  const t0 = Date.now();
  const pump = setInterval(() => {
    if (win.isDestroyed()) { clearInterval(pump); return; }
    win.webContents.send('native-audio', B.demoFrame((Date.now() - t0) / 1000, DEMO));
  }, 14);
  win.on('closed', () => clearInterval(pump));
  await wait(1500);
  await win.webContents.executeJavaScript(PROBE);
  return win;
}

async function heapAfterGc(win) {
  const d = win.webContents.debugger;
  if (!d.isAttached()) d.attach('1.3');
  await d.sendCommand('HeapProfiler.collectGarbage');
  const h = await d.sendCommand('Runtime.getHeapUsage');
  return h.usedSize / 1048576;
}

async function soak(win, minutes, errors) {
  /* Auto VJ panelde çalışıyor ve görselleştiriciye yeni yapılandırma
     yolluyor; panel burada yok, geçişi aynı yoldan betik yapıyor: her 2 sn
     sıradaki görselleştirici, tüm liste dönünce baştan. */
  const ids = CATALOG.VISUALIZERS.filter((m) => m.cycle !== false && m.id !== 'none').map((m) => m.id);
  let k = 0;
  const next = () => {
    const cfg = B.mergePatch(baseConfig(), { layers: [], postfx: [], visualizer: { type: ids[k++ % ids.length] } });
    currentCfg = cfg;
    if (!win.isDestroyed()) win.webContents.send('config', cfg);
  };
  next();
  const timer = setInterval(next, 2000);
  const samples = [];
  await win.webContents.executeJavaScript('window.__bench.reset()');
  for (let m = 1; m <= minutes; m++) {
    await wait(60000);
    const f = await win.webContents.executeJavaScript('window.__bench.take()');
    const heapMb = await heapAfterGc(win).catch(() => NaN);
    const s = { minute: m, stats: B.frameStats(f), heapMb };
    samples.push(s);
    say('  soak ' + m + '/' + minutes + ' min: ' + s.stats.fps + ' fps, p95 ' + s.stats.p95 + ' ms, heap ' + Math.round(heapMb) + ' MB');
  }
  clearInterval(timer);
  return { minutes, what: 'a new visualizer every 2 s, cycling through all ' + ids.length + ' (the way Auto VJ switches)', samples, switches: k };
}

async function run() {
  const errors = [];
  wireIpc(errors);
  /* En çok fiziksel pikseli olan ekran: Windows pencereyi ekranın çalışma
     alanına sığdırıyor, 1080 satırlık ekranda görev çubuğu tuvali kısaltır.
     Kurulan tuval her geçişte okunup rapora yazılıyor. */
  const phys = (d) => d.size.width * d.size.height * d.scaleFactor * d.scaleFactor;
  const display = screen.getAllDisplays().sort((a, b) => phys(b) - phys(a))[0] || screen.getPrimaryDisplay();
  const gpu = await app.getGPUInfo('complete').catch(() => null);
  const t = englishLabels();

  const report = {
    title: 'npm run bench',
    date: new Date().toISOString().slice(0, 10),
    commit: commitSha(),
    machine: machineInfo(gpu, display),
    seconds: SECONDS,
    warm: WARM,
    resolutions: [],
  };

  /* Pencere ekrandan büyük olamıyor (Windows sığdırıyor): 4K tuval ancak
     4K bir ekranda kurulur. Geçişin adı istenen boyut; kurulan tuval ayrıca
     yazılıyor, tutmazsa rapor bunu söylüyor. */
  const passes = SIZES.map(([w, h]) => ({ name: w + '×' + h, w, h }));
  if (NATIVE) {
    const w = Math.round(display.size.width * display.scaleFactor);
    const h = Math.round(display.size.height * display.scaleFactor);
    passes.push({ name: 'full screen ' + w + '×' + h, w, h });
  }

  for (const pass of passes) {
    currentCfg = B.mergePatch(baseConfig(), { layers: [], postfx: [] });
    const win = await openWindow(display, pass.w, pass.h);
    win.webContents.on('console-message', (e) => {
      const level = e.level != null ? e.level : e.params && e.params.level;
      const msg = e.message != null ? e.message : e.params && e.params.message;
      if (level === 'error' || level === 3) errors.push(String(msg).slice(0, 200));
    });
    win.webContents.on('render-process-gone', (e, d) => errors.push('renderer gone: ' + (d && d.reason)));
    const effects = await win.webContents.executeJavaScript('window.SVPostFX ? window.SVPostFX.EFFECT_IDS : []');
    let list = B.scenarios(CATALOG, effects, { only: ONLY })
      .filter((s) => !(s.group === 'visualizer' && s.id === 'none'))
      .map((s) => Object.assign(s, { label: t(s.label) }));
    if (SCENES.length) {
      const all = list;
      list = SCENES.map((k) => all.find((s) => s.group + ':' + s.id === k)).filter(Boolean).map((s) => Object.assign({}, s));
    }
    // İlk sahne aynı zamanda kilit denetimi: basit bir sahne yenileme hızını aşmalı
    const res = { name: pass.name, canvas: '?', results: [] };
    say(pass.name + ': ' + list.length + ' scenes');
    for (let i = 0; i < list.length; i++) {
      const r = await measureScene(win, list[i], errors);
      res.results.push(r);
      if (i === 0) {
        res.canvas = await win.webContents.executeJavaScript('window.__bench.canvas()');
        const got = String(res.canvas).split('×').map(Number);
        if (!(Math.abs(got[0] - pass.w) <= pass.w * 0.02 && Math.abs(got[1] - pass.h) <= pass.h * 0.02)) {
          res.note = 'requested ' + pass.w + '×' + pass.h + '; the window could not be that large on this screen';
          say('  ! canvas ' + res.canvas + ': ' + res.note);
        }
      }
      say('  ' + (i + 1) + '/' + list.length + ' ' + new Date().toTimeString().slice(0, 8) + ' ' + r.group + ':' + r.id + ' ' + r.stats.fps + ' fps, p95 ' + r.stats.p95 + ' ms' + (r.error ? '  ! ' + r.error : ''));
    }
    const hz = display.displayFrequency || 60;
    const fastest = Math.max.apply(null, res.results.map((r) => r.stats.fps).concat([0]));
    /* Etkin yenileme hızı ÖLÇÜLÜYOR: Windows'ta Chromium bütün pencereleri
       birincil ekranın dikey senkronuna bağlıyor; 165 Hz ekrandaki pencere
       75 Hz birincil ekranla 75 fps'e kilitli kaldı. */
    if (!UNCAPPED) report.hz = Math.round(fastest);
    else report.hz = hz;
    // Kilit gerçekten kalktı mı: en hızlı sahne yenileme hızını aşmalı
    if (report.uncapped == null) report.uncapped = UNCAPPED ? fastest > hz * 1.15 : false;
    if (UNCAPPED && !report.uncapped) report.uncappedFailed = true;
    report.resolutions.push(res);
    if (pass === passes[passes.length - 1] && SOAK > 0) report.soak = await soak(win, SOAK, errors);
    win.destroy();
  }

  report.errors = errors.slice(0, 50);
  const md = B.markdown(report);
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 1));
  if (MD_OUT) fs.writeFileSync(MD_OUT, md + '\n');
  say('');
  say(md);
  if (report.uncappedFailed) say('\nWARNING: --uncapped did not turn the frame-rate limit off; every figure is capped at the refresh rate.');
}

app.whenReady().then(run).then(() => app.exit(0), (e) => {
  say('bench failed: ' + (e && e.stack || e));
  app.exit(1);
});
app.on('window-all-closed', () => { /* run() bitince çıkılıyor */ });
