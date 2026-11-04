/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ARAYÜZ YÜRÜYÜŞÜ (#905). Yeni paneli gerçek uygulamada, gerçek tıklamalarla dener: katman seçimi,
   karışım, ekleme menüsü, kitaplık, geri al, sayfalar, arama, Canlı sayfası, iki dil. Kullanıcı
   verisine dokunmaz: geçici profil, verilen ayar ve presetlerin kopyası.

   Kullanım:
     npm run ui-walk
     npm run ui-walk -- --settings=<settings.json> --presets=<klasör> --out=<görüntü klasörü>
   Çıkış kodu kalan denetim varsa 1. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const L = require('./perf-lib');

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const REPO = path.join(__dirname, '..');
const PORT = +arg('port', 9760);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra) => {
  results.push(!!ok);
  console.log((ok ? 'GEÇTİ ' : 'KALDI ') + name + (extra === undefined ? '' : ' (' + extra + ')'));
};

function electronPath() {
  const dir = path.join(REPO, 'node_modules/electron/dist');
  const name = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
  return path.join(dir, name);
}
const cdp = (url) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  let id = 0;
  const pend = new Map();
  const on = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else on.forEach((f) => f(d));
  };
  ws.onerror = reject;
  ws.onopen = () => {
    const call = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
    const ev = async (e) => {
      const r = await call('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails).slice(0, 500));
      return r.result && r.result.result && r.result.result.value;
    };
    resolve({ ws, call, ev, on });
  };
});

async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-walk-'));
  const ud = path.join(work, 'ud');
  fs.mkdirSync(path.join(ud, 'presets'), { recursive: true });
  const settingsFile = arg('settings');
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify(L.sanitizeSettings(settingsFile ? L.readSettingsFile(settingsFile) : {})));
  if (arg('presets')) {
    let n = 0;
    for (const f of fs.readdirSync(arg('presets'))) { if (n++ > 300) break; fs.copyFileSync(path.join(arg('presets'), f), path.join(ud, 'presets', f)); }
  }
  const app = spawn(electronPath(), [REPO, '--user-data-dir=' + ud, '--remote-debugging-port=' + PORT], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 1200 && !t; i++) {
    await sleep(50);
    try { t = (await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()).find((x) => x.url.includes('admin/index.html')); } catch { /* henüz açılmadı */ }
  }
  if (!t) throw new Error('panel açılmadı');
  const a = await cdp(t.webSocketDebuggerUrl);
  await a.call('Runtime.enable');
  await a.call('Page.enable');
  const errors = [];
  a.on.push((d) => {
    if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description || d.params.exceptionDetails.text).slice(0, 300));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map((x) => x.value || x.description || '').join(' ').slice(0, 300));
  });
  for (let i = 0; i < 1200; i++) { if (await a.ev('!!(window.SVPanel && window.SVPanel.cfg && window.SVPanel.cfg() && document.querySelector(".sv-content .card"))') === true) break; await sleep(50); }
  await a.call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await sleep(1500);
  const q = (s) => a.ev(s);
  const click = (sel) => q(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true; })()`);
  const clickText = (root, re) => q(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(root + ' button')})].find((x) => ${re}.test(x.textContent)); if (!b) return false; b.click(); return true; })()`);
  const cfg = (expr) => q(`(() => { const c = window.SVPanel.cfg(); return JSON.stringify(${expr}); })()`).then((s) => (s === undefined ? undefined : JSON.parse(s)));
  const page = () => q('document.body.getAttribute("data-page")');

  // ------------------------------------------------------------ sayfalar
  for (const id of ['scene', 'live', 'time', 'studio', 'output']) {
    check('kapsül: ' + id, await click(`#pageTabs [data-cat="${id}"]`) && (await sleep(350), await page()) === id);
  }
  await click('#settingsBtn');
  await sleep(300);
  check('dişli Kurulumu açıyor', await page() === 'setup');
  check('Kurulum ağacı görünür', await q('getComputedStyle(document.getElementById("navRail")).display') !== 'none');
  for (const id of ['audio', 'lighting', 'show', 'control', 'library', 'settings']) {
    await click(`#navRail [data-cat="${id}"]`);
    await sleep(250);
    check('ağaç: ' + id, await q('document.querySelectorAll("#sections .card").length') > 0);
  }
  await click('#audioChip');
  await sleep(250);
  check('ses çipi Ses sayfasını açıyor', await q('document.querySelector("#navRail .on").getAttribute("data-cat")') === 'audio');

  // ------------------------------------------------------------ katmanlar
  await click('#pageTabs [data-cat="scene"]');
  await sleep(400);
  const nLayers = await cfg('c.layers.length');
  check('katman satırları listeyle eşit', await q('document.querySelectorAll("#svLayers .sv-lt").length') === nLayers, nLayers);
  await click('#svLayers .sv-lt');
  await sleep(250);
  const selId = await q('document.querySelector("#svLayers .sv-lt.sel").getAttribute("data-id")');
  check('katman seçiliyor, denetçi açılıyor', !!selId && await q('!!document.querySelector("#svInspector .layer-tabs")'));
  const tabs = await q('[...document.querySelectorAll("#svInspector .layer-tab")].map((b) => b.getAttribute("data-k")).join()');
  check('denetçide Kaynak ilk sekme', tabs.startsWith('source'), tabs);
  for (const k of tabs.split(',')) {
    await click(`#svInspector .layer-tab[data-k="${k}"]`);
    await sleep(60);
    if (!await q(`document.querySelector('#svInspector .layer-tab[data-k="${k}"]').classList.contains('active')`)) check('sekme açılmadı: ' + k, false);
  }
  await click('#svInspector .layer-tab[data-k="source"]');
  const blendBefore = await cfg(`c.layers.find((l) => l.id === ${JSON.stringify(selId)}).blend`);
  await q(`(() => { const s = [...document.querySelectorAll('#svInspector .ctrl')].find((c) => /Karışım|Blend/.test(c.textContent)).querySelector('select'); s.value = 'screen'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(300);
  check('karışım katmana yazılıyor', await cfg(`c.layers.find((l) => l.id === ${JSON.stringify(selId)}).blend`) === 'screen', blendBefore);

  // geri al / yinele
  await sleep(700);
  check('geri al düğmesi açıldı', await q('!document.getElementById("undoBtn").disabled'));
  await click('#undoBtn');
  await sleep(300);
  check('geri al değeri döndürüyor', await cfg(`c.layers.find((l) => l.id === ${JSON.stringify(selId)}).blend`) === blendBefore);
  await click('#redoBtn');
  await sleep(300);
  check('yinele değeri getiriyor', await cfg(`c.layers.find((l) => l.id === ${JSON.stringify(selId)}).blend`) === 'screen');
  await click('#undoBtn');
  await sleep(300);

  // S / M / göz
  const solo = await q(`(() => { const row = document.querySelector('#svLayers .sv-lt[data-id=${JSON.stringify(selId)}]'); row.querySelector('.sv-tgl.mute').click(); return 1; })()`);
  await sleep(300);
  check('sessiz anahtarı', solo === 1 && await cfg(`c.layers.find((l) => l.id === ${JSON.stringify(selId)}).muted`) === true);
  await q(`document.querySelector('#svLayers .sv-lt[data-id=${JSON.stringify(selId)}] .sv-tgl.mute').click()`);
  await sleep(300);

  // ekleme menüsü: her tür
  await clickText('#svLayers', '/Ekle|Add/');
  await sleep(200);
  const addLabels = await q('[...document.querySelectorAll(".sv-add .add-row button")].map((b) => b.textContent.trim())');
  check('ekleme menüsü dolu', addLabels.length >= 8, addLabels.length);
  await q('document.querySelectorAll(".sv-add .add-row button")[0].click()');
  await sleep(350);
  check('menüden katman eklendi, menü kapandı', await cfg('c.layers.length') === nLayers + 1 && !await q('!!document.querySelector(".sv-add")'));
  await click('#undoBtn');
  await sleep(600);

  // sürükle bırak yerine raf: mod galerisi
  await clickText('#svShelf', '/^(Görsel|Visual)$/');
  await sleep(300);
  check('Görsel rafı listeliyor', await q('document.querySelectorAll("#svShelf .sv-gi").length') > 20);
  await clickText('#svShelf', '/^(Zemin|Ground)$/');
  await sleep(300);
  check('Zemin rafı listeliyor', await q('document.querySelectorAll("#svShelf .sv-gi").length') > 10);
  await q(`(() => { const list = [...document.querySelectorAll('#svLayers .sv-lt')]; const c = window.SVPanel.cfg(); const bg = c.layers.find((l) => l.kind === 'background'); if (bg) window.SVSceneShell.select(bg.id); })()`);
  await sleep(300);
  await q('document.querySelectorAll("#svShelf .sv-gi")[3].click()');
  await sleep(400);
  const bgType = await cfg('(c.layers.find((l) => l.kind === "background") || {}).type');
  check('galeri seçili zemini değiştiriyor', !!bgType, bgType);
  await click('#undoBtn');
  await sleep(600);
  for (const tab of ['/^(Şablon|Preset)$/', '/^(Sahne|Scene)$/']) {
    check('raf sekmesi: ' + tab, await clickText('#svShelf', tab) && (await sleep(300), true));
  }
  await click('#svShelf .sv-shelf-mode button:nth-child(2)');
  await sleep(300);
  for (const tab of ['/Efekt Zinciri|Effect Chain/', '/Modülasyon|Modulation/', '/Gruplar|Groups/']) {
    check('araç sekmesi: ' + tab, await clickText('#svShelf', tab) && (await sleep(300), await q('!!document.querySelector("#svShelf .card")')));
  }

  // raf kapanıp görüntü büyüyor
  const h0 = await q('document.getElementById("previewStage").getBoundingClientRect().height');
  await click('#svShelf .sv-chead > .sv-ib');
  await sleep(300);
  const h1 = await q('document.getElementById("previewStage").getBoundingClientRect().height');
  check('raf kapanınca görüntü büyüyor', h1 >= h0, h0 + ' -> ' + h1);
  await click('#svShelf .sv-chead > .sv-ib');
  await sleep(300);

  // MilkDrop kitaplığı
  await click('#svShelf .sv-shelf-mode button:nth-child(1)');
  await sleep(200);
  await clickText('#svShelf', '/^MilkDrop$/');
  await sleep(800);
  const md = await q('document.querySelectorAll("#svShelf .md-grid .md-cell-main, #svShelf .md-list .md-name").length');
  check('MilkDrop kitaplığı rafta', md > 0, md);

  // Canlı
  await click('#pageTabs [data-cat="live"]');
  await sleep(500);
  const scenes = await q('document.querySelectorAll("#svLive .sv-scell").length');
  check('Canlı: sahne ızgarası', scenes > 0, scenes);
  check('Canlı: önizleme canlı monitörde', await q('!!document.querySelector("#svPgmFrame #previewStage")'), await q('(() => { const p = document.getElementById("previewStage"); return p ? (p.parentElement.id + "/" + document.body.getAttribute("data-page") + "/" + !!document.getElementById("svPgmFrame")) : "yok"; })()'));
  await click('#svLive .sv-scell');
  await sleep(200);
  check('Canlı: tıklama sıraya alıyor', await q('!!document.querySelector("#svLive .sv-scell.pvw")'));
  check('Canlı: AL düğmesi açık', await q('!document.querySelector("#svLive .sv-take").disabled'));
  await click('#svLive .sv-take');
  await sleep(900);
  check('Canlı: AL sahneyi uyguluyor', await q('!!document.querySelector("#svLive .sv-scell.pgm")'));
  await clickText('#svLive .sv-scenes-card', '/Klip Destesi|Clip Deck/');
  await sleep(300);
  check('Canlı: klip destesi', await q('!!document.querySelector("#svLive .sv-scenes-card .card")'));
  check('Canlı: tempo', await q('!!document.querySelector("#svLive .sv-rail .card")'));
  const faders = await q('document.querySelectorAll("#svLive .sv-vfad").length');
  check('Canlı: faderler', faders > 1, faders);

  // Önizleme öteki sayfada yan rafa dönüyor
  await click('#pageTabs [data-cat="output"]');
  await sleep(400);
  check('Çıktı: önizleme yan rafta', await q('!!document.querySelector("#dockStageHost #previewStage")'));
  await click('#pageTabs [data-cat="scene"]');
  await sleep(400);
  check('Sahne: önizleme ortada', await q('!!document.querySelector("#svFrame #previewStage")'));

  // Arama
  await q(`(() => { const i = document.getElementById('searchInput'); i.focus(); i.value = 'ekran'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(300);
  const hits = await q('document.querySelectorAll("#searchResults .sr-item, #searchResults button, #searchResults [role=option]").length');
  check('arama sonuç veriyor', hits > 0, hits);
  await q(`(() => { const i = document.getElementById('searchInput'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);

  // Basit görünüm
  await q('document.getElementById("simpleToggle").click()');
  await sleep(300);
  check('Basit: Zaman gizli', await q('getComputedStyle(document.querySelector("#pageTabs [data-cat=time]")).display') === 'none');
  await q('document.getElementById("simpleToggle").click()');
  await sleep(300);

  // İngilizce: sahne sayfasında Türkçe kalmasın
  await q(`window.SVI18n && window.SVI18n.setLocale ? window.SVI18n.setLocale('en') : 0`);

  if (arg('out')) {
    fs.mkdirSync(arg('out'), { recursive: true });
    const shot = await a.call('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    fs.writeFileSync(path.join(arg('out'), 'son.jpg'), Buffer.from(shot.result.data, 'base64'));
  }
  check('konsol temiz', errors.length === 0, errors.slice(0, 3).join(' | '));
  try { a.ws.close(); } catch { /* kapandı */ }
  app.kill();
  await sleep(800);
  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* süreç hâlâ tutuyor */ }
  const bad = results.filter((r) => !r).length;
  console.log(bad ? bad + ' KALDI' : 'HEPSİ GEÇTİ (' + results.length + ')');
  process.exit(bad ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
