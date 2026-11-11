/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* MOTOR EŞLİĞİ (#905). Aşama 2'nin kapısı: aynı sahne sayfada ve Worker'da çizilir,
   kareler karşılaştırılır. Motor Worker'a taşınınca görüntü bozulursa burada görünür.

   KULLANICI VERİSİNE DOKUNMAZ: geçici profil, ayar ve presetler kopyalanır.

     npm run engine-parity -- --settings=<settings.json> --presets=<klasör>
     npm run engine-parity -- --only=milkdrop --frames=12
     npm run engine-parity -- --gpu            (gerçek GPU; varsayılan yazılım çizici)
     npm run engine-parity -- --control        (iki koşu da sayfada: ölçümün tabanı)
     npm run engine-parity -- --dump=<klasör>  (geçemeyen kareler yan yana)

   Medya katmanları atlanır ve sayılır: video köprüsü sonraki adımda. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const L = require('./perf-lib');

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const flag = (k) => argv.includes('--' + k);
const REPO = path.join(__dirname, '..');
const PORT = +arg('port', 9741);
const INSPECT = PORT + 1;
const FRAMES = +arg('frames', 12);
const W = +arg('width', 640);
const H = +arg('height', 360);
const ONLY = (arg('only', '') || '').toLowerCase();
const CONTROL = flag('control');
/* Geçme ölçütü, her kare için. En çok ±4: parıltı ve kenar yuvarlaması, gözle seçilmiyor.
   Üstü yalnız pikselin binde birinden azında olabilir: piksel efekti gibi eşikli işler ±1'i
   büyütüyor. Bunu aşan fark görüntü kaybıdır, kapıyı düşürür. */
const SMALL = 4;
const RARE = 0.001;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let app = null;
let appExit = null;

function electronPath() {
  const dir = path.join(REPO, 'node_modules/electron/dist');
  const name = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
  return path.join(dir, name);
}
const cdp = (url) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  let id = 0;
  let closed = false;
  const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  ws.onerror = reject;
  ws.onclose = () => {
    const gone = { error: { message: 'uygulama bağlantısı koptu' } };
    for (const r of pend.values()) r(gone);
    pend.clear();
    closed = true;
  };
  ws.onopen = () => {
    const call = (method, params) => new Promise((r) => {
      if (closed) { r({ error: { message: 'uygulama bağlantısı koptu' } }); return; }
      const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });
    const ev = async (e) => {
      const r = await call('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
      if (r.error) throw new Error(r.error.message);
      if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails).slice(0, 900));
      return r.result && r.result.result && r.result.result.value;
    };
    resolve({ ws, call, ev });
  };
});
async function waitTarget(match, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const t = (await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()).find((x) => x.url.includes(match));
      if (t) return t;
    } catch { /* henüz yok */ }
    await sleep(100);
  }
  throw new Error('hedef yok: ' + match);
}

/* Panelde: şablon ya da sahne panelin kendi yoluyla, temiz tabandan (altın ölçüyle aynı) */
const CASE_CFG = (c) => `(() => {
  const P = window.SVPanel;
  const cur = P.cfg();
  const fresh = window.SV.clone(window.__base);
  for (const k of Object.keys(cur)) delete cur[k];
  Object.assign(cur, fresh);
  if (${JSON.stringify(c.kind)} === 'template') {
    const T = window.SVTemplates;
    const t = T.TEMPLATES.find((x) => x.id === ${JSON.stringify(c.id)});
    const next = T.apply(cur, t, { defaultConfig: window.SV.defaultConfig, deepMerge: window.SV.deepMerge, clone: window.SV.clone });
    for (const k of Object.keys(cur)) delete cur[k];
    Object.assign(cur, next);
    if (cur.layerStack && cur.layerStack.enabled && window.SVLayers.syncStackState) window.SVLayers.syncStackState(cur);
  } else {
    P.applyScene(${JSON.stringify(c.id)}, { quiet: true });
  }
  const c2 = P.cfg();
  c2.transition = Object.assign({}, c2.transition, { enabled: false });
  return JSON.stringify(c2);
})()`;

/* Dışa aktarım bütün kütüphaneyi yolluyor (128 MB). Burada yalnız sahnenin andığı kayıtlar:
   her durumda iki kez yollamak ölçümü boğardı, iki taraf da aynı listeyi alıyor. */
async function presetsOf(mainP, cfg) {
  const ids = new Set();
  const walk = (v) => {
    if (typeof v === 'string') { if (v.length && v.length < 80) ids.add(v); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const k of ['milkdrop', 'custom', 'visualizer', 'background', 'layers']) walk(cfg[k]);
  return JSON.parse(await mainP.ev(`(() => {
    const cache = process.mainModule.constructor._cache;
    const store = cache[Object.keys(cache).find((k) => k.endsWith('presets-store.js'))].exports;
    return JSON.stringify(${JSON.stringify([...ids])}.map((id) => store.get(id)).filter(Boolean));
  })()`));
}

const hasMedia = (cfg) => (Array.isArray(cfg.layers) && cfg.layers.some((l) => l && l.enabled !== false && l.kind === 'media')) || (cfg.media && cfg.media.enabled);

// Sayfada, her kare: farklı piksel oranı, en büyük fark, ±4'ü aşan piksel oranı
const WORST_JS = `(() => {
  const P = window.__pageFrames, Q = window.__otherFrames;
  let max = 0, share = 0, at = 0, big = 0;
  for (let f = 0; f < P.length; f++) {
    const a = P[f], b = Q[f];
    let px = 0, m = 0, over = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]), Math.abs(a[i + 3] - b[i + 3]));
      if (d) { px++; if (d > m) m = d; if (d > ${SMALL}) over++; }
    }
    const n = a.length / 4;
    if (m > max) { max = m; at = f; }
    if (px / n > share) share = px / n;
    if (over / n > big) big = over / n;
  }
  return JSON.stringify({ max, at, share: +share.toFixed(4), big: +big.toFixed(5) });
})()`;
const DUMP_JS = (at) => `(() => {
  const out = document.createElement('canvas');
  out.width = ${W} * 2; out.height = ${H};
  const c = out.getContext('2d');
  c.putImageData(new ImageData(new Uint8ClampedArray(window.__pageFrames[${at}]), ${W}, ${H}), 0, 0);
  c.putImageData(new ImageData(new Uint8ClampedArray(window.__otherFrames[${at}]), ${W}, ${H}), ${W}, 0);
  return out.toDataURL('image/png');
})()`;
const onPage = (jobText, slot) => `window.SVParity.run(${jobText}).then((r) => { window.${slot} = r.frames; delete r.frames; return JSON.stringify(r); }, (err) => JSON.stringify({ error: String(err && err.stack || err) }))`;
const onWorker = (jobText) => `new Promise((resolve) => {
  const w = window.__w;
  const on = (ev) => { const m = ev.data; if (!m || m.__sv !== 'parity-done') return; w.removeEventListener('message', on); if (m.r) { window.__otherFrames = m.r.frames; delete m.r.frames; } resolve(JSON.stringify(m.error ? { error: m.error } : m.r)); };
  w.addEventListener('message', on);
  w.postMessage({ __sv: 'parity', job: ${jobText} });
})`;

async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-engine-'));
  const ud = path.join(work, 'ud');
  fs.mkdirSync(ud);
  const settingsFile = arg('settings');
  const base = settingsFile ? L.readSettingsFile(settingsFile) : {};
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify(L.sanitizeSettings(base)));
  if (arg('presets')) fs.cpSync(arg('presets'), path.join(ud, 'presets'), { recursive: true });
  const flags = flag('gpu') ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  app = spawn(electronPath(), [REPO, '--user-data-dir=' + ud, '--remote-debugging-port=' + PORT, '--inspect=' + INSPECT].concat(flags), { stdio: 'ignore' });
  app.on('exit', (code) => { appExit = 'çıkış ' + code; });
  const a = await cdp((await waitTarget('admin/index.html', 120000)).webSocketDebuggerUrl);
  await a.call('Runtime.enable');
  for (let i = 0; i < 2400; i++) {
    if (await a.ev('!!(window.SVPanel && window.SVPanel.cfg && window.SVPanel.cfg() && document.querySelector(".sv-content .card"))') === true) break;
    await sleep(50);
  }
  await a.ev(`(() => { const base = window.SV.clone(window.SVPanel.cfg()); const def = window.SV.defaultConfig(); base.layerStack = def.layerStack; base.layers = def.layers; window.__base = base; return 1; })()`);

  // Dışa aktarım sayfası: motorun bütün betikleri yüklü, kendi işi gelene kadar boşta
  let mainT = null;
  for (let i = 0; i < 300 && !mainT; i++) {
    try { mainT = (await (await fetch('http://127.0.0.1:' + INSPECT + '/json/list')).json())[0]; } catch { /* henüz yok */ }
    if (!mainT) await sleep(100);
  }
  const mainP = await cdp(mainT.webSocketDebuggerUrl);
  await mainP.call('Runtime.enable');
  await mainP.ev(`(() => { const { BrowserWindow } = process.mainModule.require('electron');
    global.__eng = new BrowserWindow({ width: 320, height: 200, show: false, webPreferences: { preload: ${JSON.stringify(path.join(REPO, 'src/main/preload-exporter.js'))}, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    global.__eng.loadFile(${JSON.stringify(path.join(REPO, 'src/exporter/index.html'))}); return 1; })()`);
  const e = await cdp((await waitTarget('exporter/index.html', 30000)).webSocketDebuggerUrl);
  await e.call('Runtime.enable');
  // Betik listesi sayfanın kendi sırası: sayfa tam yüklenmeden okunursa eksik kalır
  for (let i = 0; i < 600; i++) {
    if (await e.ev('document.readyState === "complete" && !!window.SVLayers') === true) break;
    await sleep(50);
  }
  await e.ev(fs.readFileSync(path.join(REPO, 'src/visualizer/engine-bridge.js'), 'utf8'));
  await e.ev(fs.readFileSync(path.join(__dirname, 'engine-parity-driver.js'), 'utf8'));
  const driverUrl = 'file:///' + path.join(__dirname, 'engine-parity-driver.js').split(path.sep).join('/');
  const booted = await e.ev(`(async () => {
    const scripts = window.SVEngineBridge.engineScripts(document).concat([${JSON.stringify(driverUrl)}]);
    const { worker, bootMs } = await window.SVEngineBridge.boot({ scripts });
    window.__w = worker;
    return JSON.stringify({ bootMs, scripts: scripts.length });
  })()`);
  console.log('Worker açılışı:', booted);

  const res = { when: new Date().toISOString(), software: !flag('gpu'), control: CONTROL, frames: FRAMES, size: [W, H], boot: JSON.parse(booted), cases: {} };
  const all = JSON.parse(await a.ev(`JSON.stringify(window.SVTemplates.TEMPLATES.map((t) => ({ kind: 'template', id: t.id, name: t.name }))
    .concat((window.SVPanel.cfg().scenes || []).map((s) => ({ kind: 'scene', id: s.id, name: s.name }))))`));
  const cases = all.filter((c) => !ONLY || (c.kind + ':' + c.name).toLowerCase().includes(ONLY));
  console.log(cases.length + ' durum');
  let same = 0;
  let skipped = 0;
  let n = 0;
  const failed = [];
  const small = [];
  for (const c of cases) {
    n++;
    const key = c.kind + ':' + c.name;
    const label = String(n).padStart(3) + ' ' + key.slice(0, 44);
    const cfg = JSON.parse(await a.ev(CASE_CFG(c)));
    if (hasMedia(cfg)) { skipped++; res.cases[key] = { skipped: 'medya' }; console.log(label, 'atlandı: medya'); continue; }
    const jobText = JSON.stringify({ cfg, presets: await presetsOf(mainP, cfg), width: W, height: H, fps: 30, frames: FRAMES, platform: process.platform });
    const page = JSON.parse(await e.ev(onPage(jobText, '__pageFrames')));
    const other = JSON.parse(await e.ev(CONTROL ? onPage(jobText, '__otherFrames') : onWorker(jobText)));
    const row = { pageMs: page.ms, workerMs: other.ms };
    const time = Math.round(page.ms) + '/' + Math.round(other.ms) + ' ms';
    if (other.logs && other.logs.length) { row.logs = other.logs; console.log('     worker günlüğü:', other.logs.slice(0, 4).join(' | ').slice(0, 500)); }
    if (page.error || other.error) {
      row.error = (page.error ? 'sayfa: ' + page.error : '') + (other.error ? ' worker: ' + other.error : '');
      failed.push(key);
      console.log(label, 'HATA', row.error.slice(0, 300));
    } else {
      const bad = page.hashes.filter((h, i) => h !== other.hashes[i]).length;
      row.different = bad;
      row.frames = page.hashes.length;
      if (JSON.stringify(page.built) !== JSON.stringify(other.built)) {
        row.built = { page: page.built, worker: other.built };
        console.log('     motorlar farklı: sayfa', page.built.join(', '), '| worker', other.built.join(', '));
      }
      if (!bad) {
        same++;
        console.log(label, 'aynı', time);
      } else {
        row.worst = JSON.parse(await e.ev(WORST_JS));
        row.pass = row.worst.big < RARE && !row.built;
        if (row.pass) small.push(key); else failed.push(key);
        console.log(label, row.pass ? 'küçük fark' : 'GÖRÜNTÜ FARKI', bad + '/' + page.hashes.length, JSON.stringify(row.worst), time);
        if (arg('dump') && !row.pass) {
          const png = await e.ev(DUMP_JS(row.worst.at));
          fs.mkdirSync(arg('dump'), { recursive: true });
          fs.writeFileSync(path.join(arg('dump'), key.replace(/[^A-Za-z0-9]+/g, '-') + '.png'), Buffer.from(png.split(',')[1], 'base64'));
        }
      }
    }
    res.cases[key] = row;
  }
  console.log('aynı ' + same + ', küçük fark ' + small.length + ', görüntü farkı ' + failed.length + ', atlanan ' + skipped);
  failed.forEach((k) => console.log('  ' + k));
  if (arg('json')) fs.writeFileSync(arg('json'), JSON.stringify(res, null, 1));
  process.exitCode = failed.length ? 1 : 0;
  try { a.ws.onclose = null; a.ws.close(); e.ws.onclose = null; e.ws.close(); mainP.ws.onclose = null; mainP.ws.close(); } catch { /* kapanıyor */ }
  app.kill();
  await sleep(1000);
  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* süreç hâlâ tutuyor olabilir */ }
}

main().catch(async (err) => {
  console.error(err);
  await sleep(500);
  if (appExit) console.error('uygulama: ' + appExit);
  try { if (app) app.kill(); } catch { /* yok */ }
  process.exit(1);
});
