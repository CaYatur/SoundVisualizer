/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* GERÇEK SAHNE ÖLÇÜMÜ (#910). `npm run bench` her sahneyi tek başına, boş
   kütüphaneyle ölçüyor; gerçek bir kurulumun yükünü göremez: büyük preset
   kütüphanesi, panel önizlemesi, birkaç pencere. Bu betik uygulamanın
   kendisini (main.js dahil) açıyor ve kullanıcının hissettiği sayıları
   okuyor: açılış, bellek, kare boşlukları, preset değişimi.

   KULLANICI VERİSİNE DOKUNMAZ. Geçici bir --user-data-dir ile koşar; verilen
   ayar ve preset klasörü oraya KOPYALANIR, ışık ve ağ çıkışları kapatılır
   (perf-lib.js). Ses sabit örnek sinyaldir: gerçek yakalama durdurulur, kareler
   aynı IPC hattından gider, yani koşular karşılaştırılabilir.

   Kullanım:
     npm run perf -- --settings=<settings.json> --presets=<klasör>
     npm run perf -- --seconds=60 --json=sonuc.json --baseline=onceki.json
     npm run perf -- --low      (tümleşik GPU + ana iş parçacığı 4 kat yavaş)
     npm run perf -- --spout    (Spout penceresi de açık)
     npm run perf -- --scene=<sahne.json>   (kararlı durumda bu sahne: JSON'daki alanlar ayarın üstüne yazılır)
     npm run perf -- --software (GPU yok: yazılım çizici)
    npm run perf -- --igpu     (tümleşik GPU, kısma yok: sayfa ile Worker kıyası için)
    npm run perf -- --display-w=1280   (görselleştirici bu genişlikteki ekrana)
    npm run perf -- --stall=150        (sayfa iki saniyede bir bu kadar ms tıkanır)
    npm run perf -- --sweep=300 --hold=1.5 --md-offset=17   (preset taraması; preset başına sonuç JSON'da)
    npm run perf -- --md-ids=a,b --profile=<klasör>         (bu presetlerin CPU profili)
    npm run perf -- --trace=<dosya öneki> --trace-cats=gpu.angle,toplevel   (iz kaydı)
    npm run perf -- --profile-panel=<dosya>   (kararlı durumda panelin CPU profili)
    npm run perf -- --profile-main=<dosya>    (preset taramasında ana sürecin CPU profili)

   --low bir benzetimdir, gerçek zayıf makinenin yerini tutmaz; kısma yalnız
   sayfanın ana iş parçacığına uygulanır ve bu kipte süreç CPU'su anlamsızdır.
   Sayılar yalnız aynı makinede önce/sonra karşılaştırması içindir. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const L = require('./perf-lib');

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const flag = (k) => argv.includes('--' + k);
const REPO = path.join(__dirname, '..');
const PORT = +arg('port', 9681);
const INSPECT = PORT + 1;
const SECONDS = +arg('seconds', 60);
const SWEEP = +arg('sweep', 16);
const LOW = flag('low');
const THROTTLE = LOW ? 4 : 1;
const CORES = os.cpus().length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let app = null;

function electronPath() {
  const dir = path.join(REPO, 'node_modules/electron/dist');
  const name = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
  return path.join(dir, name);
}
function cdp(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pend = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
    ws.onerror = reject;
    ws.onopen = () => {
      const call = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
      const ev = async (e) => {
        const r = await call('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
        if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
        return r.result && r.result.result && r.result.result.value;
      };
      resolve({ ws, call, ev });
    };
  });
}
const targets = async () => (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
async function waitTarget(part, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const t = (await targets()).find((x) => x.url.includes(part)); if (t) return t; } catch { /* henüz açılmadı */ }
    await sleep(10);
  }
  throw new Error('hedef açılmadı: ' + part);
}
async function until(fn, ms) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(10); } return false; }

/* Sayfaya kurulan ölçer: rAF aralıkları, uzun görevler, ilk görünür kare */
const PROBE = `(() => { if (window.__perf) return 1;
  const pb = window.__perf = { d: [], long: [], last: 0 };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) pb.long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true }); } catch {}
  const f = (t) => { if (pb.last) pb.d.push(t - pb.last); pb.last = t; requestAnimationFrame(f); }; requestAnimationFrame(f);
  const c = document.createElement('canvas'); c.width = c.height = 16; const x = c.getContext('2d', { willReadFrequently: true });
  pb.lit = () => { try { const st = window.SVStage.stack(); for (const e of st.entries) { if (!e.canvas || e.canvas.width < 2 || !e.layer || e.layer.kind !== 'visualizer') continue; x.clearRect(0, 0, 16, 16); x.drawImage(e.canvas, 0, 0, 16, 16); const d = x.getImageData(0, 0, 16, 16).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) * d[i + 3] / 255; if (s > 60) return true; } } catch {} return false; };
  pb.first = () => new Promise((res) => { const t0 = performance.now(); const go = () => { const dt = performance.now() - t0; if (pb.lit()) return res(Math.round(dt)); if (dt > 8000) return res(-1); requestAnimationFrame(go); }; requestAnimationFrame(go); });
  pb.w = [];
  const st = window.SVStage.stack(); const draw = st.draw;
  st.draw = function (...a) { const t0 = performance.now(); const r = draw.apply(this, a); pb.w.push(performance.now() - t0); return r; };
  pb.reset = () => { pb.d.length = 0; pb.long.length = 0; pb.w.length = 0; };
  pb.read = () => JSON.stringify({ d: pb.d, long: pb.long, w: pb.w });
  return 1; })()`;
const readFrames = async (vis) => { const r = JSON.parse(await vis.ev('window.__perf.read()')); return { summary: L.frameSummary(r.d), long: r.long, draw: drawSummary(r.w) }; };
/* Sahnenin ana iş parçacığındaki payı. Kare hızı ekrana takılıyken kare boşlukları
   birleştirme yolları arasındaki farkı göstermez. */
function drawSummary(w) {
  const s = [...w].sort((a, b) => a - b);
  const q = (p) => (s.length ? +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2) : 0);
  return { n: s.length, avg: s.length ? +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2) : 0, p50: q(0.5), p99: q(0.99) };
}

const METRICS_JS = `(() => { const { app, webContents } = process.mainModule.require('electron');
  const wc = webContents.getAllWebContents().map((w) => ({ pid: w.getOSProcessId(), url: (w.getURL() || '').split('/').slice(-2).join('/').split('?')[0].replace('/index.html', '') }));
  return JSON.stringify(app.getAppMetrics().map((p) => ({ type: p.type, page: (wc.find((w) => w.pid === p.pid) || {}).url || '', cpu: p.cpu.percentCPUUsage, wsMB: Math.round(p.memory.workingSetSize / 1024), privMB: Math.round((p.memory.privateBytes || 0) / 1024), peakMB: Math.round((p.memory.peakWorkingSetSize || 0) / 1024) }))); })()`;

function prepareProfile(ud) {
  fs.mkdirSync(ud, { recursive: true });
  const settingsFile = arg('settings');
  if (settingsFile) {
    const s = L.sanitizeSettings(L.readSettingsFile(settingsFile), { spout: flag('spout') });
    fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify(s));
  }
  const presets = arg('presets');
  const dst = path.join(ud, 'presets');
  if (presets && !fs.existsSync(dst)) fs.cpSync(presets, dst, { recursive: true });
}

/* Ana süreçte: gerçek yakalamayı durdur, aynı kanaldan örnek ses yolla */
const pumpJs = () => `(() => { const req = process.mainModule.require.bind(process.mainModule);
  const cache = process.mainModule.constructor._cache; const m = Object.keys(cache).find((k) => k.endsWith('native-audio.js'));
  const na = cache[m].exports; try { na.stopCapture(); } catch {} na.startCapture = () => {};
  const B = req(${JSON.stringify(path.join(REPO, 'scripts/bench-lib.js'))}); const DEMO = req(${JSON.stringify(path.join(REPO, 'src/shared/demo-audio.js'))});
  const { BrowserWindow } = req('electron'); const t0 = Date.now();
  global.__pump = setInterval(() => { const f = B.demoFrame((Date.now() - t0) / 1000, DEMO); for (const w of BrowserWindow.getAllWindows()) { if (!w.isDestroyed()) w.webContents.send('native-audio', f); } }, 14); return 1; })()`;

const sample = (a, n) => { const out = []; const step = Math.max(1, Math.floor(a.length / n)); for (let i = 0; i < a.length && out.length < n; i += step) out.push(a[i]); return out; };

async function main() {
  const work = arg('work') || fs.mkdtempSync(path.join(os.tmpdir(), 'sv-perf-'));
  const ud = path.join(work, 'ud');
  prepareProfile(ud);
  const res = { when: new Date().toISOString(), seconds: SECONDS, low: LOW };
  const args = [REPO, '--user-data-dir=' + ud, '--remote-debugging-port=' + PORT, '--inspect=' + INSPECT];
  if (LOW || flag('igpu')) args.push('--force_low_power_gpu');
  if (flag('software')) args.push('--disable-gpu');
  const t0 = Date.now();
  app = spawn(electronPath(), args, { stdio: 'ignore' });
  const admin = await cdp((await waitTarget('admin/index.html', 60000)).webSocketDebuggerUrl);
  await admin.call('Runtime.enable');
  await until(() => admin.ev('!!(window.SVPanel && window.SVPanel.cfg && window.SVPanel.cfg() && document.querySelector("#sections .card"))'), 60000);
  res.startup = { panelMs: Date.now() - t0 };
  let mainT = null;
  await until(async () => { try { mainT = (await (await fetch('http://127.0.0.1:' + INSPECT + '/json/list')).json())[0]; return !!mainT; } catch { return false; } }, 15000);
  const mainP = await cdp(mainT.webSocketDebuggerUrl);
  await mainP.call('Runtime.enable');
  await mainP.ev(pumpJs());
  res.gpu = await admin.ev(`(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; })()`);
  res.library = JSON.parse(await admin.ev(`window.api.listPresets().then((l) => JSON.stringify({ n: l.length, mb: Math.round(JSON.stringify(l).length / 1048576) }))`));
  res.settingsKB = Math.round((await admin.ev('JSON.stringify(window.SVPanel.cfg()).length')) / 1024);
  if (THROTTLE > 1) { await admin.call('Emulation.setCPUThrottlingRate', { rate: THROTTLE }); }
  // Görselleştirici: birincil olmayan en büyük ekran, yoksa birincil
  const displays = JSON.parse(await admin.ev(`window.api.getDisplays().then((d) => JSON.stringify(d.map((x) => ({ id: x.id, w: x.bounds.width, sf: x.scaleFactor, primary: x.isPrimary }))))`));
  const others = displays.filter((d) => !d.primary);
  const wantW = +arg('display-w', 0);
  const display = displays.find((d) => wantW && d.w === wantW) || (others.length ? others : displays).reduce((m, x) => ((x.w * x.sf) > (m.w * m.sf) ? x : m));
  // Pencere açılmadan: saydamlık değişince pencere yeniden kuruluyor, bağlantı kopardı
  if (arg('scene')) {
    const scene = fs.readFileSync(arg('scene'), 'utf8');
    await admin.ev(`(() => { const c = window.SVPanel.cfg(); const s = ${scene}; for (const k of Object.keys(s)) c[k] = s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]) ? Object.assign({}, c[k], s[k]) : s[k]; window.SVPanel.apply(); return 1; })()`);
  }
  const tOpen = Date.now();
  await admin.ev(`window.api.openVisualizer(${JSON.stringify(display.id)}).then(() => 1)`);
  const vis = await cdp((await waitTarget('visualizer/index.html', 20000)).webSocketDebuggerUrl);
  await vis.call('Runtime.enable');
  if (THROTTLE > 1) await vis.call('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await until(() => vis.ev('!!(window.SVStage && window.SVStage.stack && window.SVStage.stack() && window.SVStage.stack().entries.length)'), 30000);
  await vis.ev(PROBE);
  await vis.ev('window.__perf.first()');
  res.open = { visibleMs: Date.now() - tOpen };
  await sleep(1500);
  { const f = await readFrames(vis); res.open.longSum = f.long.reduce((a, b) => a + b, 0); res.open.longMax = f.long.reduce((a, b) => Math.max(a, b), 0); }
  // Kararlı durum: gerçek sahne, panel açık
  await sleep(2500);
  // Sayfayı iki saniyede bir tıkar: ekranda ne kadar donma kaldığını görmek için
  if (arg('stall')) await vis.ev(`(() => { const ms = ${+arg('stall')}; setInterval(() => { const t = performance.now(); while (performance.now() - t < ms); }, 2000); return 1; })()`);
  await vis.ev('window.__perf.reset()');
  await mainP.ev(METRICS_JS);
  process.stdout.write(`Kararlı durum ${SECONDS} sn ...\n`);
  if (arg('profile-panel')) { await admin.call('Profiler.enable'); await admin.call('Profiler.setSamplingInterval', { interval: 500 }); await admin.call('Profiler.start'); }
  await sleep(SECONDS * 1000);
  if (arg('profile-panel')) { const r = await admin.call('Profiler.stop'); fs.writeFileSync(arg('profile-panel'), JSON.stringify(r.result.profile)); }
  const fr = await readFrames(vis);
  const procs = JSON.parse(await mainP.ev(METRICS_JS));
  const byPage = (p) => (procs.find((x) => x.page === p) || {}).wsMB;
  /* Ölçülen şey istenen sahne mi: katman sayısı ve görünen yüzey */
  res.scene = JSON.parse(await vis.ev(`(() => { const st = window.SVStage.stack(); return JSON.stringify({ layers: st.entries.length, surface: !!st.surface(), fx: !!(st.postfx && st.postfx.hasWork()), size: st.width + 'x' + st.height }); })()`));
  res.steady = { frames: fr.summary, draw: fr.draw, procs: procs.map((p) => Object.assign({}, p, { cpu: Math.round(p.cpu * CORES) })), totals: L.processTotals(procs, CORES), visWsMB: byPage('visualizer'), adminWsMB: byPage('admin') };
  // Süpürmeler için sade sahne: geçiş ve efekt yok, tek görselleştirici
  const setScene = (js) => admin.ev(`(() => { const c = window.SVPanel.cfg(); ${js}; window.SVPanel.apply(); return 1; })()`);
  /* Tek katman, her sürümde aynı sahne. Eskiden yığın anahtarı kapatılıyordu; v4'te anahtar yok,
     panel yığını geri açıyor ve ölçüm gerçek sahnenin katmanlarının üstünde yapılıyordu. */
  const oneLayer = (type) => `c.layerStack = Object.assign({}, c.layerStack, { enabled: true }); c.layers = [{ id: 'perf_tek', name: 'Ölçüm', enabled: true, kind: 'visualizer', type: '${type}', opacity: 1, blend: 'normal', settings: {} }]; c.visualizer.type = '${type}';`;
  await setScene(`${oneLayer('none')} c.background = Object.assign({}, c.background, { type: 'solid', solidColor: '#000000' }); c.transition = Object.assign({}, c.transition, { enabled: false, type: 'cut', duration: 0 }); c.milkdropControl = Object.assign({}, c.milkdropControl, { locked: false }); c.milkdrop = Object.assign({}, c.milkdrop, { autoNext: 0, hardCut: 'off', blendTime: 0 }); c.postfx = []`);
  await sleep(1500);
  /* MILKDROP: gerçek preset METNİYLE. Metin boş giderse motor varsayılan
     presete düşer ve kimlik değişse de ölçülen şey hep aynı presettir. */
  const mdIds = JSON.parse(await admin.ev(`JSON.stringify(window.SVPresets.byKind('milkdrop').map((p) => p.id))`));
  const sourceOf = (id) => `(async () => { const p = window.SVPresets.get(${JSON.stringify(id)}); if (p && p.source) return p.source; return window.api.milkdropPresetSource ? await window.api.milkdropPresetSource(${JSON.stringify(id)}) : ''; })()`;
  await setScene(oneLayer('milkdrop'));
  await sleep(1500);
  const mdGap = [], mdReady = [], mdEach = [];
  const HOLD = +arg('hold', 0.9) * 1000;
  let loaded = 0;
  // İz kaydı: takılmanın hangi süreçte, hangi çağrıda olduğu kare boşluğundan okunmuyor
  const TRACE = arg('trace');
  const traceOn = () => mainP.ev(`process.mainModule.require('electron').contentTracing.startRecording({ included_categories: ${JSON.stringify((arg('trace-cats') || 'gpu,gpu.angle,gpu.capture,viz,toplevel,blink.user_timing,disabled-by-default-gpu.decoder,disabled-by-default-gpu.service').split(','))}, excluded_categories: ['*'], recording_mode: 'record-as-much-as-possible' }).then(() => 1)`);
  const traceOff = (file) => mainP.ev(`process.mainModule.require('electron').contentTracing.stopRecording(${JSON.stringify(file)}).then(() => 1)`);
  const mdList = arg('md-ids') ? arg('md-ids').split(',') : sample(mdIds.slice(+arg('md-offset', 0)), SWEEP);
  if (TRACE) await traceOn();
  if (arg('profile-main')) { await mainP.call('Profiler.enable'); await mainP.call('Profiler.setSamplingInterval', { interval: 200 }); await mainP.call('Profiler.start'); }
  for (const id of mdList) {
    await vis.ev(`performance.mark(${JSON.stringify('MD ' + id)})`);
    const src = await admin.ev(sourceOf(id));
    if (!src) continue;
    await vis.ev('window.__perf.reset()');
    const t = Date.now();
    await admin.ev(`(async () => { const c = window.SVPanel.cfg(); const p = window.SVPresets.get(${JSON.stringify(id)}); c.milkdrop = Object.assign({}, c.milkdrop, { presetId: ${JSON.stringify(id)}, name: p ? p.name : '', source: ${JSON.stringify(src)} }); window.SVPanel.apply(); return 1; })()`);
    const want = id + '|' + src.length;
    const ok = await until(() => vis.ev(`(() => { const e = window.SVStage.stack().entries.find((x) => x.mode && x.mode.livePreset); return !!(e && e.mode.presetKey && String(e.mode.presetKey).startsWith(${JSON.stringify(want)})); })()`), 8000);
    const ready = ok ? Date.now() - t : -1;
    if (ok) { loaded++; mdReady.push(ready); }
    // Yükleme ve yüklenmiş preset ayrı: biri değişim takılması, öteki presetin kendi kare maliyeti
    const atLoad = await readFrames(vis);
    await vis.ev('window.__perf.reset()');
    if (arg('profile')) { await vis.call('Profiler.enable'); await vis.call('Profiler.setSamplingInterval', { interval: 200 }); await vis.call('Profiler.start'); }
    await sleep(HOLD);
    if (arg('profile')) { const r = await vis.call('Profiler.stop'); fs.writeFileSync(path.join(arg('profile'), id + '.cpuprofile'), JSON.stringify(r.result.profile)); }
    const held = await readFrames(vis);
    mdGap.push(Math.max(atLoad.summary.max, held.summary.max));
    mdEach.push({ id, ready, load: atLoad.summary.max, hold: held.summary.max, fps: held.summary.fps, over33: held.summary.over33, draw: held.draw.avg, drawP99: held.draw.p99 });
  }
  if (arg('profile-main')) { const r = await mainP.call('Profiler.stop'); fs.writeFileSync(arg('profile-main'), JSON.stringify(r.result.profile)); }
  if (TRACE) { await traceOff(TRACE + '-md.json'); }
  res.milkdrop = { tried: mdList.length, loaded, gap: L.medMax(mdGap), ready: L.medMax(mdReady), each: mdEach };
  // STUDIO
  const shIds = JSON.parse(await admin.ev(`JSON.stringify(window.SVPresets.byKind('visualizer').filter((p) => p.engine === 'shader').map((p) => p.id))`));
  await setScene(oneLayer('custom'));
  await sleep(800);
  const shGap = [], shEach = [];
  if (TRACE) await traceOn();
  for (const id of sample(shIds, +arg('sweep-studio', SWEEP))) {
    await vis.ev('window.__perf.reset()');
    await vis.ev(`performance.mark(${JSON.stringify('ST ' + id)})`);
    await setScene(`c.custom = Object.assign({}, c.custom, { visualizerId: ${JSON.stringify(id)} })`);
    await sleep(1100);
    const f = await readFrames(vis);
    shGap.push(f.summary.max);
    shEach.push({ id, max: f.summary.max, long: f.long, draw: f.draw.avg });
  }
  if (TRACE) await traceOff(TRACE + '-st.json');
  res.studio = { gap: L.medMax(shGap), each: shEach };
  // Rapor
  const base = arg('baseline') ? JSON.parse(fs.readFileSync(arg('baseline'), 'utf8')) : null;
  process.stdout.write(`\nGPU: ${res.gpu}\nKütüphane: ${res.library.n} preset, ${res.library.mb} MB liste; ayar ${res.settingsKB} KB\n\n` + L.formatReport(L.compareRuns(res, base)) + '\n\n');
  process.stdout.write(res.steady.procs.map((p) => `${p.type}${p.page ? ' ' + p.page : ''}: CPU ${p.cpu}%, ${p.wsMB} MB`).join('\n') + '\n');
  if (arg('json')) fs.writeFileSync(arg('json'), JSON.stringify(res, null, 1));
  for (const c of [admin, vis, mainP]) { try { c.ws.close(); } catch { /* kapandı */ } }
  app.kill();
  await sleep(1500);
  if (!arg('work') && !flag('keep')) { try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* süreç hâlâ tutuyor olabilir */ } }
}
main().catch((e) => { console.error(e); try { app && app.kill(); } catch { /* yok */ } process.exit(1); });
