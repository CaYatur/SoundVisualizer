/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ALTIN ÖLÇÜ (#905). v4 yapı değiştirirken görüntü değişmesin diye: her yerleşik
   şablon ve verilen ayarlardaki her sahne gerçekten dışa aktarılıyor, kare özetleri
   yazılıyor. Sonraki koşular bununla karşılaştırılır; her fark ya hata ya da yazılı
   bir karardır.

   Her durum TEMİZ başlangıçtan iki kez: doğal kipinde (`asis`) ve katman anahtarı
   çevrilince (`toggled`). Aksi halde önceki durumun yığın bayrağı ve klasik yedeği
   sızıyor, ölçülen şey şablon olmuyor. Rapor iki yönü ayırıyor: klasikten katmana
   (v4 göçünün aynısı, aynı kalmalı), katmandan klasiğe (klasik yol katmanları bilmez).

   KULLANICI VERİSİNE DOKUNMAZ: geçici profil, ayar ve presetler kopyalanır.

   Kullanım:
     npm run golden -- --out=<klasör>
     npm run golden -- --out=<klasör> --settings=<settings.json> --presets=<klasör>
     npm run golden -- --out=<klasör> --baseline=<önceki golden.json>
     npm run golden -- --out=<klasör> --only=<ad parçası> --keep */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync, spawnSync } = require('child_process');
const L = require('./perf-lib');
const G = require('./golden-lib');

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const REPO = path.join(__dirname, '..');
const OUT = arg('out');
if (!OUT) { console.error('--out=<klasör> gerekli'); process.exit(2); }
const ONLY = (arg('only', '') || '').toLocaleLowerCase();
const PORT = +arg('port', 9721);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FF = require('ffmpeg-static');
let app = null;

function electronPath() {
  const dir = path.join(REPO, 'node_modules/electron/dist');
  const name = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
  return path.join(dir, name);
}
const cdp = (url) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  let id = 0;
  const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  ws.onerror = reject;
  ws.onopen = () => {
    const call = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
    const ev = async (e) => {
      const r = await call('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails).slice(0, 500));
      return r.result && r.result.result && r.result.result.value;
    };
    resolve({ ws, call, ev });
  };
});

function frameHashes(file) {
  const out = execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v', '-f', 'framemd5', '-'], { maxBuffer: 1 << 28 }).toString();
  return out.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').pop().trim());
}
function psnr(a, b) {
  const r = spawnSync(FF, ['-hide_banner', '-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const m = /average:(\S+)/.exec(r.stderr || '');
  return m ? (m[1] === 'inf' ? Infinity : Number(m[1])) : null;
}

/* Sayfada: şablon panelin kendi yoluyla, sahne panelin kendi eylemiyle. Kip,
   "Katmanlara Geç" düğmesinin çağırdığı işlevle değişiyor. Her durum aynı temiz
   ayardan: yığın durumu fabrika değerinde, önceki durumdan yedek kalmadan. */
const SET_CASE = (c, mode) => `(() => {
  const P = window.SVPanel;
  const cur = P.cfg();
  const fresh = window.SV.clone(window.__goldenBase);
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
  const native = window.SVLayers.stackOn(c2);
  if (${mode === 'toggled'}) window.SVLayers.setStackEnabled(c2, !native);
  P.push(true);
  return native;
})()`;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-golden-'));
  const ud = path.join(work, 'ud');
  fs.mkdirSync(ud);
  const settingsFile = arg('settings');
  const base = settingsFile ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {};
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify(L.sanitizeSettings(base)));
  if (arg('presets')) fs.cpSync(arg('presets'), path.join(ud, 'presets'), { recursive: true });
  const wav = path.join(work, 'tone.wav');
  execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc='0.9*sin(2*PI*(55+200*exp(-mod(t,0.5)*18))*t)*exp(-mod(t,0.5)*6)+0.25*sin(2*PI*2400*t)*exp(-mod(t+0.25,0.5)*30):s=48000:d=2'", wav]);
  app = spawn(electronPath(), [REPO, '--user-data-dir=' + ud, '--remote-debugging-port=' + PORT], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 2400 && !t; i++) {
    await sleep(50);
    try { t = (await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()).find((x) => x.url.includes('admin/index.html')); } catch { /* henüz açılmadı */ }
  }
  if (!t) throw new Error('panel açılmadı');
  const a = await cdp(t.webSocketDebuggerUrl);
  await a.call('Runtime.enable');
  for (let i = 0; i < 2400; i++) {
    if (await a.ev('!!(window.SVPanel && window.SVPanel.cfg && window.SVPanel.cfg() && document.querySelector("#sections .card") && window.SVTemplates)') === true) break;
    await sleep(50);
  }
  await a.ev('(() => { window.__done = null; window.api.onExportDone((d) => { window.__done = d; }); return 1; })()');
  await a.ev(`(() => {
    const base = window.SV.clone(window.SVPanel.cfg());
    const def = window.SV.defaultConfig();
    base.layerStack = def.layerStack;
    base.layers = def.layers;
    window.__goldenBase = base;
    return 1;
  })()`);
  const all = JSON.parse(await a.ev(`JSON.stringify(window.SVTemplates.TEMPLATES.map((t) => ({ kind: 'template', id: t.id, name: t.name }))
    .concat((window.SVPanel.cfg().scenes || []).map((s) => ({ kind: 'scene', id: s.id, name: s.name }))))`));
  const cases = all.filter((c) => !ONLY || (c.kind + ':' + c.name).toLocaleLowerCase().includes(ONLY));
  const run = { when: new Date().toISOString(), version: require('../package.json').version, cases: {} };
  console.log(cases.length + ' durum, doğal kip ve anahtar çevrilmiş');
  let n = 0;
  for (const c of cases) {
    n++;
    const key = c.kind + ':' + c.name;
    const entry = (run.cases[key] = {});
    const files = {};
    for (const mode of ['asis', 'toggled']) {
      const native = await a.ev(SET_CASE(c, mode));
      entry.nativeStack = native;
      await sleep(900);
      const file = path.join(work, 'c' + n + '-' + mode + '.mp4');
      const st = JSON.parse(await a.ev(`(async () => { window.__done = null; const s = await window.api.startExport({ audioPath: ${JSON.stringify(wav)}, outputPath: ${JSON.stringify(file)}, format: 'mp4-h264', resolution: '720p', fps: 30, encoder: 'cpu', quality: 'high', speed: 'fast' }); if (!s || !s.ok) return JSON.stringify({ start: s }); for (let i = 0; i < 900 && !window.__done; i++) await new Promise((r) => setTimeout(r, 200)); return JSON.stringify(window.__done || { timeout: true }); })()`));
      if (st.status !== 'done') { entry[mode] = { error: JSON.stringify(st).slice(0, 200), frames: [] }; console.log(key, mode, 'HATA', entry[mode].error); continue; }
      entry[mode] = { frames: frameHashes(file) };
      files[mode] = file;
    }
    if (files.asis && files.toggled) {
      const d = G.diffFrames(entry.asis.frames, entry.toggled.frames);
      if (d.diff) entry.toggled.psnr = psnr(files.asis, files.toggled);
      console.log(String(n).padStart(3), (entry.nativeStack ? 'katman→klasik ' : 'klasik→katman ') + key.slice(0, 40).padEnd(41), d.diff ? 'FARKLI ' + d.diff + '/' + d.frames + ' PSNR ' + entry.toggled.psnr : 'aynı');
    }
    /* --keep: kipler kare kare incelensin diye dosyalar çıktı klasörüne */
    for (const [mode, f] of Object.entries(files)) {
      try {
        if (argv.includes('--keep')) fs.copyFileSync(f, path.join(OUT, key.replace(/[^A-Za-z0-9]+/g, '-') + '-' + mode + '.mp4'));
        fs.unlinkSync(f);
      } catch { /* yoksa geç */ }
    }
  }
  const pairs = G.modePairs(run);
  fs.writeFileSync(path.join(OUT, 'golden.json'), JSON.stringify(run));
  console.log('\nklasikten katmana: aynı ' + pairs.classicToStack.same.length + ', farklı ' + pairs.classicToStack.different.length);
  console.log('katmandan klasiğe: aynı ' + pairs.stackToClassic.same.length + ', farklı ' + pairs.stackToClassic.different.length);
  if (arg('baseline')) {
    const cmp = G.compareRuns(JSON.parse(fs.readFileSync(arg('baseline'), 'utf8')), run);
    console.log('öncekiyle: aynı ' + cmp.same + ', değişen ' + cmp.changed.length + ', eşsiz ' + cmp.missing.length);
    cmp.changed.forEach((c) => console.log('  ' + c.name + ' / ' + c.mode + ': ' + c.diff + '/' + c.frames + ' kare'));
    cmp.missing.forEach((c) => console.log('  ' + c.name + (c.mode ? ' / ' + c.mode : '') + ': ' + c.in));
    process.exitCode = cmp.changed.length || cmp.missing.length ? 1 : 0;
  }
  try { a.ws.close(); } catch { /* kapanıyor */ }
  app.kill();
  await sleep(1000);
  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* süreç hâlâ tutuyor olabilir */ }
}

main().catch((e) => { console.error(e); try { if (app) app.kill(); } catch { /* yok */ } process.exit(1); });
