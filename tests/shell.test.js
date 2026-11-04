'use strict';
/* V4 KABUĞU (#905). Sayfa yapısı, her kartın bir yeri olması, çeviriler ve renk kuralı. Gerçek
   tıklamalar `npm run ui-walk`ta; burada ucuz ve her koşuda dönen denetimler var. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8').replace(/\r\n/g, '\n');

const admin = read('src/admin/admin.js');
const shell = read('src/admin/scene-shell.js');
const live = read('src/admin/live-shell.js');
const i18n = read('src/shared/i18n.js');

function categories() {
  const block = admin.slice(admin.indexOf('const CATEGORIES = ['), admin.indexOf('];', admin.indexOf('const CATEGORIES = [')));
  return [...block.matchAll(/id: '(\w+)'(, setup: true)?/g)].map((m) => ({ id: m[1], setup: !!m[2] }));
}
function sections() {
  const out = [];
  for (const m of admin.matchAll(/id: '([\w-]+)',\n\s*(?:roots: [^\n]*\n\s*)?category: '(\w+)'/g)) out.push({ id: m[1], category: m[2] });
  return out;
}

test('üst kapsül beş sayfa, Kurulum altı bölüm', () => {
  const c = categories();
  assert.deepStrictEqual(c.filter((x) => !x.setup).map((x) => x.id), ['scene', 'live', 'time', 'studio', 'output']);
  assert.deepStrictEqual(c.filter((x) => x.setup).map((x) => x.id), ['audio', 'lighting', 'show', 'control', 'library', 'settings']);
});

test('her kart var olan bir sayfada', () => {
  const ids = new Set(categories().map((c) => c.id));
  const all = sections();
  assert.ok(all.length > 40, 'bölümler okunamadı: ' + all.length);
  for (const s of all) assert.ok(ids.has(s.category), s.id + ' -> ' + s.category);
});

test('Sahne kartlarının hepsi denetçide ya da rafta', () => {
  // Katmanlar kartının yerini sol liste ve denetçi aldı
  const elsewhere = new Set(['layers']);
  for (const s of sections().filter((x) => x.category === 'scene')) {
    if (elsewhere.has(s.id)) continue;
    assert.ok(shell.includes("'" + s.id + "'"), 'yeri yok: ' + s.id);
  }
});

test('Canlı kartları sayfada', () => {
  for (const id of ['tempo', 'clipdeck', 'transition']) assert.ok(live.includes("'" + id + "'"), id);
});

test('kabuktaki metinler çevrilmiş', () => {
  const strings = new Set();
  for (const src of [shell, live]) {
    for (const m of src.matchAll(/\btr\('((?:[^'\\]|\\.)+)'\)/g)) strings.add(m[1]);
    for (const m of src.matchAll(/label: '([^']+)'/g)) strings.add(m[1]);
  }
  const html = read('src/admin/index.html');
  const top = html.slice(html.indexOf('<header class="topbar">'), html.indexOf('</header>'));
  for (const m of top.matchAll(/(?:title|aria-label|placeholder)="([^"]+)"/g)) strings.add(m[1]);
  assert.ok(strings.size > 30, 'metinler okunamadı: ' + strings.size);
  for (const s of strings) {
    if (s === 'MilkDrop' || s === 'CAYADEV') continue;
    assert.ok(i18n.includes("'" + s + "':"), 'çevirisi yok: ' + s);
  }
  for (const s of ['Çıktı', 'Stüdyo', 'Zaman', 'Basit', 'Canlı']) assert.ok(i18n.includes("'" + s + "':"), s);
});

test('kabuk biçiminde renk yazılmıyor: yalnız tema değişkenleri', () => {
  const css = read('src/admin/shell.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b(?![\w-])/, 'onaltılık renk');
  assert.doesNotMatch(css, /rgba?\(\s*\d/, 'sayısal renk');
  for (const v of ['--knob', '--accent', '--media-bg', '--fg-rgb']) assert.ok(css.includes('var(' + v), v);
});

test('yazı tipi uygulamayla geliyor, lisansıyla', () => {
  for (const f of ['Geist-Variable.woff2', 'GeistMono-Variable.woff2', 'OFL-Geist.txt']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'src/admin/fonts', f)), f);
  }
  assert.doesNotMatch(read('src/admin/shell.css').replace(/\/\*[\s\S]*?\*\//g, ''), /https?:\/\//, 'yazı tipi ağdan alınmaz');
});

test('önizleme çizim boyu sınırlı: büyük sahne sayfası yükü büyütmüyor', () => {
  const P = read('src/admin/preview.js');
  assert.match(P, /const PREVIEW_MAX_H = 540;/);
  assert.match(P, /const PREVIEW_MAX_H_OUTPUT = 180;/);
  assert.match(P, /const scale = Math\.min\(dpr, \(outputOpen && !full \? PREVIEW_MAX_H_OUTPUT : PREVIEW_MAX_H\) \/ h\);/);
});

test('çıkış açıkken küçük resim seyrek çiziliyor ama kuyruk durmuyor (#957)', () => {
  const M = read('src/main/main.js');
  // Gerileme: #905 çıkış açıkken kuyruğu sonsuza dek bekletiyordu, bütün hücreler çizgili kalıyordu
  assert.doesNotMatch(M, /while \(thumbOutputBusy\(\)\)/);
  const src = /function thumbGapMs\(busy, now, lastEnd\) \{[\s\S]*?\n\}/.exec(M)[0];
  const gap = new Function('THUMB_BUSY_GAP_MS', src + '; return thumbGapMs;')(1500);
  assert.strictEqual(gap(false, 1000, 999), 0);
  assert.strictEqual(gap(true, 1000, 500), 1000);
  assert.strictEqual(gap(true, 5000, 0), 0);
  assert.match(M, /thumbLastEnd = Date\.now\(\);\n  closeThumbWinSoon\(\);/);
  assert.match(M, /async function renderThumb\(job\) \{\s*await thumbTurn\(\);/);
  assert.match(M, /thumbTurn\(\)\.then\(pruneThumbs\)/);
  assert.match(M, /openWindows\(\)\.length > 0 \|\| !!textureShare\.window\(\) \|\| !!\(exportWin/);
  assert.match(read('src/admin/shell.css'), /\.md-thumb-box\.pending \{ animation: none; \}/);
});

// ---------------------------------------------------------------- geri al
const U = require('../src/admin/undo.js');
const history = () => {
  const state = { a: 1, b: { x: 1 } };
  let changes = 0;
  let applied = 0;
  const h = U.create({
    keys: ['a', 'b', 'c'],
    get: (k) => state[k],
    set: (k, v) => { if (v === undefined) delete state[k]; else state[k] = v; },
    apply: () => { applied++; },
    changed: () => { changes++; },
  });
  h.settleNow();
  return { h, state, count: () => ({ changes, applied }) };
};

test('geri al ve yinele değerleri döndürüyor', () => {
  const { h, state } = history();
  state.a = 2;
  h.settleNow();
  state.b = { x: 9 };
  h.settleNow();
  assert.strictEqual(h.canUndo(), true);
  h.undo();
  assert.deepStrictEqual(state.b, { x: 1 });
  assert.strictEqual(state.a, 2);
  h.undo();
  assert.strictEqual(state.a, 1);
  assert.strictEqual(h.canUndo(), false);
  h.redo();
  h.redo();
  assert.strictEqual(state.a, 2);
  assert.deepStrictEqual(state.b, { x: 9 });
  assert.strictEqual(h.canRedo(), false);
});

test('yeni değişiklik yineleme geçmişini siliyor', () => {
  const { h, state } = history();
  state.a = 2;
  h.settleNow();
  h.undo();
  assert.strictEqual(h.canRedo(), true);
  state.a = 3;
  h.settleNow();
  assert.strictEqual(h.canRedo(), false);
});

test('sonradan eklenen alan geri alınınca siliniyor', () => {
  const { h, state } = history();
  state.c = 5;
  h.settleNow();
  h.undo();
  assert.strictEqual('c' in state, false);
});

test('not edilmemiş değişiklik de geri alınıyor, yinelenebiliyor', () => {
  const { h, state } = history();
  state.a = 2;
  h.settleNow();
  state.a = 3; // henüz not edilmedi
  h.undo();
  assert.strictEqual(state.a, 1);
  h.redo();
  assert.strictEqual(state.a, 3);
});

test('değişmeyen durum adım eklemiyor, geçmiş sınırlı', () => {
  const { h, state } = history();
  h.settleNow();
  assert.strictEqual(h.canUndo(), false);
  for (let i = 0; i < U.MAX + 20; i++) { state.a = i + 100; h.settleNow(); }
  let n = 0;
  while (h.canUndo()) { h.undo(); n++; }
  assert.strictEqual(n, U.MAX);
});

test('Sahne rafı: Liste / Izgara seçimi, varsayılan liste, numara rozeti (#957)', () => {
  const defaults = read('src/shared/defaults.js');
  const css = read('src/admin/shell.css');
  assert.match(defaults, /sceneView: 'list'/);
  assert.match(admin, /cfg\.ui\.sceneView/);
  assert.match(admin, /classList\.toggle\('is-grid'/);
  assert.match(admin, /scene-num/);
  assert.match(css, /#dockScenes \.scene-list\.is-list/);
  assert.match(css, /\.scene-num/);
  assert.match(i18n, /'Sahne düzeni': 'Scene layout'/);
  for (const k of ['Liste', 'Izgara']) assert.ok(i18n.includes("'" + k + "':"), k);
});
