'use strict';
/* Kütüphaneden karışım, arayüz (#579).
 *
 * Parçalar MilkDrop panelinin listesinde GÖRÜNEN presetlerden: arama
 * gerçek arama kutusundan yazılıyor, yani `visibleList` bağlantısı da
 * sınanıyor. Kaydedilmemiş bir önizleme (üretilen preset ya da karışımın
 * kendisi) hiçbir zaman parça vermiyor. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
require('../src/shared/defaults.js');
window.SVMilkdropCycle = require('../src/shared/milkdrop-cycle.js');
window.SVMilkdropLibrary = require('../src/shared/milkdrop-library.js');
const X = require('../src/shared/milkdrop-mashup.js');
const G = require('../src/shared/milkdrop-generator.js');
const M0 = require('../src/shared/milkdrop.js');
const BUILTINS = require('../src/shared/presets-milkdrop.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Her parçası olan üretilmiş presetler, bir MilkDrop 1 preseti ve yalnız görünüm
function richSources(n) {
  const out = [];
  for (let s = 1; out.length < n && s < 5000; s++) {
    const r = G.generate({ energy: 60, warmth: (s * 37) % 101, density: 90, motion: 50, seed: s });
    if (r.parts.shader === 'ikisi' && r.parts.waves.length && r.parts.shapes.length) out.push(r.source);
  }
  return out;
}
const RICH = richSources(6);
const LOOK_ONLY = '[preset00]\nfDecay=0.900\nzoom=1.010\n';
function library() {
  return [
    { id: 'u_a1', name: 'Alfa 1', source: RICH[0] },
    { id: 'u_a2', name: 'Alfa 2', source: RICH[1] },
    { id: 'u_b1', name: 'Beta 1', source: RICH[2] },
    { id: 'u_b2', name: 'Beta 2', source: RICH[3] },
    { id: 'u_b3', name: 'Beta 3', source: BUILTINS[0].source },
    { id: 'u_a3', name: 'Alfa 3', source: RICH[4] },
    { id: 'u_g', name: 'Gama', source: RICH[5] },
    { id: 'u_d', name: 'Delta', source: LOOK_ONLY },
  ].map((p) => Object.assign({ kind: 'milkdrop' }, p));
}

function mkNode(tag, props, kids) {
  const n = { tag, attrs: {}, kids: [], on: {}, text: '', className: '', props: props || {} };
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.text = v;
    else if (k.indexOf('on') === 0 && typeof v === 'function') n.on[k.slice(2)] = v;
    else if (v !== false && v != null) n.attrs[k] = String(v);
  }
  n.appendChild = (c) => { n.kids.push(c); return c; };
  n.addEventListener = (ev, f) => { n.on[ev] = f; };
  n.getAttribute = (k) => (k in n.attrs ? n.attrs[k] : null);
  n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
  n.removeAttribute = (k) => { delete n.attrs[k]; };
  // Arama kutusu yeniden çizilince odağı geri koyuyor
  n.focus = () => {};
  n.setSelectionRange = () => {};
  n.classList = {
    add: (...c) => { const s = new Set(n.className.split(/\s+/).filter(Boolean)); c.forEach((x) => s.add(x)); n.className = [...s].join(' '); },
    remove: (...c) => { n.className = n.className.split(/\s+/).filter((x) => x && c.indexOf(x) < 0).join(' '); },
    contains: (c) => n.className.split(/\s+/).indexOf(c) >= 0,
    toggle: (c, on) => { if (on) n.classList.add(c); else n.classList.remove(c); },
  };
  const match = (x, sel) => (sel[0] === '.' ? x.className && x.className.split(/\s+/).indexOf(sel.slice(1)) >= 0 : x.tag === sel);
  n.querySelectorAll = (sel) => { const out = []; walk(n, (x) => { if (x !== n && match(x, sel)) out.push(x); }); return out; };
  n.querySelector = (sel) => n.querySelectorAll(sel)[0] || null;
  Object.defineProperty(n, 'textContent', { get: () => n.text, set: (v) => { n.text = v; n.kids = []; } });
  (kids || []).forEach((c) => c && n.kids.push(c));
  return n;
}
function walk(n, f) {
  if (!n || typeof n !== 'object') return;
  f(n);
  (n.kids || []).forEach((k) => walk(k, f));
  if (n.node) walk(n.node, f);
}
const findAll = (root, pred) => { const out = []; walk(root, (x) => { if (pred(x)) out.push(x); }); return out; };

async function fresh() {
  for (const f of ['../src/admin/milkdrop-panel.js', '../src/admin/milkdrop-gen.js']) delete require.cache[require.resolve(f)];
  const cfg = window.SV.defaultConfig();
  const root = mkNode('div', { id: 'sections' });
  const lib = library();
  const saved = [];
  const toasts = [];
  global.localStorage = { getItem: () => null, setItem() {} };
  global.document = {
    querySelector: (sel) => root.querySelector(sel),
    getElementById: (id) => (id === 'sections' ? root : null),
    activeElement: null,
  };
  window.SVMdGen = G;
  window.SVMdMix = X;
  window.SVPresets = undefined;
  window.SVMdFollow = null;
  window.SVI18n = undefined;
  window.SVMilkdropBuiltins = [];
  window.api = {
    listPresets: () => Promise.resolve(lib.map((p) => Object.assign({}, p))),
    savePreset: (p) => { saved.push(p); return Promise.resolve({ ok: true, preset: Object.assign({}, p, { updatedAt: 1 }) }); },
    onMilkdropThumb() {}, onPresetsDelta() {},
  };
  window.SVPanel = {
    cfg: () => cfg, apply() {}, rerender() {}, el: mkNode,
    row: (label, node) => ({ label, node, kids: [] }),
    toast: (m, k) => toasts.push([m, k]), confirm: () => Promise.resolve(true),
  };
  window.SVScenePanels = { miniSlider: (label) => ({ label, kids: [] }) };
  const M = require('../src/admin/milkdrop-panel.js');
  M.init();
  await wait(5);
  const GP = require('../src/admin/milkdrop-gen.js');
  // MilkDrop panelinin arama kutusu: gerçek girdi olayıyla
  const search = (q) => {
    root.kids = [M.panel()];
    const box = root.querySelector('.md-search');
    assert.ok(box, 'arama kutusu yok');
    box.on.input({ target: { value: q, selectionStart: q.length } });
  };
  return { M, GP, cfg, lib, saved, toasts, search, root };
}

const donorsOf = (GP) => GP.state().mix;
const byId = (lib, id) => lib.find((p) => p.id === id);

test('parçalar yalnız listede GÖRÜNEN presetlerden', async () => {
  const { M, GP, lib, search } = await fresh();
  search('beta');
  const visible = M.visibleList().map((p) => p.id).sort();
  assert.deepStrictEqual(visible, ['u_b1', 'u_b2', 'u_b3']);
  for (let i = 0; i < 25; i++) {
    GP.rollAll();
    const mix = donorsOf(GP);
    for (const s of X.SLOTS) {
      if (mix[s] === X.NONE) continue;
      assert.ok(visible.indexOf(mix[s]) >= 0, s + ' görünmeyen presetten: ' + mix[s]);
      assert.ok(byId(lib, mix[s]));
    }
  }
});

test('her parça o parçası olan presetten; shader parçası bazen "yok"', async () => {
  const { GP, lib } = await fresh();
  let none = 0;
  for (let i = 0; i < 80; i++) {
    GP.rollAll();
    const mix = donorsOf(GP);
    for (const s of X.SLOTS) {
      if (mix[s] === X.NONE) { assert.ok(s === 'warp' || s === 'comp', s); none++; continue; }
      assert.ok(X.has(byId(lib, mix[s]).source, s), s + ' parçası olmayan presetten: ' + mix[s]);
    }
  }
  assert.ok(none > 0, 'warp ya da birleştirme hiç "yok" çıkmadı');
});

test('karışımın metni parçalarının presetlerinden, önizleme kaydedilmiyor', async () => {
  const { GP, cfg, lib, saved } = await fresh();
  GP.rollAll();
  const { mix, mixLast } = GP.state();
  assert.strictEqual(cfg.milkdrop.presetId, mixLast.id);
  assert.match(mixLast.id, /^md_mix2_[0-9a-f]{16}$/);
  assert.strictEqual(mixLast.id, X.idOf(mix));
  assert.strictEqual(cfg.milkdrop.source, mixLast.source);
  const f = M0.parseMilk(mixLast.source);
  assert.strictEqual(f.perFrame, M0.parseMilk(byId(lib, mix.motion).source).perFrame);
  assert.deepStrictEqual(f.waves, M0.parseMilk(byId(lib, mix.waves).source).waves);
  assert.strictEqual(f.warpShader, mix.warp === X.NONE ? '' : M0.parseMilk(byId(lib, mix.warp).source).warpShader);
  assert.deepStrictEqual(saved, []);
});

test('tek parça yeniden çekilince ötekiler yerinde kalıyor', async () => {
  const { GP } = await fresh();
  GP.rollAll();
  for (const s of X.SLOTS) {
    const before = donorsOf(GP);
    GP.rollSlot(s);
    const after = donorsOf(GP);
    for (const o of X.SLOTS) if (o !== s) assert.strictEqual(after[o], before[o], s + ' çekilince ' + o + ' değişti');
    assert.notStrictEqual(after[s], before[s], s + ' değişmedi');
  }
});

test('ekrandakinden başla: altı parça ondan; kaydedilmemiş önizleme parça vermiyor', async () => {
  const { M, GP, lib, toasts } = await fresh();
  M.preview(byId(lib, 'u_b3'));
  GP.fromScreen();
  const mix = donorsOf(GP);
  // u_b3 MilkDrop 1 preseti: shader parçaları "yok"
  assert.deepStrictEqual(mix, { look: 'u_b3', motion: 'u_b3', waves: 'u_b3', shapes: 'u_b3', warp: X.NONE, comp: X.NONE });
  // Ekranda şimdi karışım var: listede değil, parça veremez
  const n = toasts.length;
  GP.fromScreen();
  assert.strictEqual(toasts.length, n + 1);
  assert.strictEqual(toasts[n][1], 'err');
  assert.deepStrictEqual(donorsOf(GP), mix, 'karışım değişmemeli');
  // Üretilen önizleme de öyle
  GP.regenerate();
  GP.fromScreen();
  assert.strictEqual(toasts[toasts.length - 1][1], 'err');
  // Karışımın kimliği listede yok: hiçbir zaman aday olamıyor
  GP.rollAll();
  assert.ok(!M.visibleList().some((p) => /^md_(mix|gen)/.test(p.id)));
});

test('geçmiş: ◀ ▶ karışımı parçalarından yeniden kuruyor, silinen parçası olanı atlıyor', async () => {
  const { M, GP, cfg, lib } = await fresh();
  // Rastgelelik yok: her karışım ekrandaki tek bir presetten
  const ids = [];
  for (const p of ['u_a1', 'u_a2', 'u_b1', 'u_b2']) {
    M.preview(byId(lib, p));
    GP.fromScreen();
    ids.push(cfg.milkdrop.presetId);
  }
  assert.strictEqual(new Set(ids).size, 4);
  GP.mixNav(-1);
  assert.strictEqual(cfg.milkdrop.presetId, ids[2]);
  GP.mixNav(-1);
  assert.strictEqual(cfg.milkdrop.presetId, ids[1]);
  GP.mixNav(1);
  assert.strictEqual(cfg.milkdrop.presetId, ids[2]);
  GP.mixNav(1);
  assert.strictEqual(cfg.milkdrop.presetId, ids[3]);
  /* İkinci karışımın presetleri kütüphaneden silindi: ◀ onu atlayıp
     birinciye iniyor. Arada durmak (üçüncüde kalmak) yanlış. */
  lib.splice(lib.findIndex((p) => p.id === 'u_a2'), 1);
  await new Promise((r) => M.refresh(r));
  GP.mixNav(-1);
  assert.strictEqual(cfg.milkdrop.presetId, ids[2]);
  GP.mixNav(-1);
  assert.strictEqual(cfg.milkdrop.presetId, ids[0], 'silinen parçası olan karışım atlanmalı');
});

test('"yok" olan shader parçası yeniden çekilince bir preset geliyor', async () => {
  /* "Yok" şansı yalnız dolu bir parçayı boşaltabiliyor; boş parça yeniden
     çekilince mutlaka değişmeli. Math.random sabit: "yok" zarı her seferinde
     tutuyor, yani kural gerçekten sınanıyor. */
  const { M, GP, lib } = await fresh();
  M.preview(byId(lib, 'u_b3'));
  GP.fromScreen();
  assert.strictEqual(donorsOf(GP).warp, X.NONE);
  const orig = Math.random;
  Math.random = () => 0.05;
  try {
    GP.rollSlot('warp');
    GP.rollSlot('comp');
  } finally {
    Math.random = orig;
  }
  const mix = donorsOf(GP);
  assert.ok(mix.warp && X.has(byId(lib, mix.warp).source, 'warp'), 'warp: ' + mix.warp);
  assert.ok(mix.comp && X.has(byId(lib, mix.comp).source, 'comp'), 'comp: ' + mix.comp);
});

test('kaydet son karışımı yazıyor; aynı karışım aynı kimlik', async () => {
  const { GP, saved } = await fresh();
  // Üreticinin de bir sonucu var: karışımın düğmesi onu değil karışımı yazmalı
  GP.regenerate();
  GP.rollAll();
  const { mixLast } = GP.state();
  await GP.saveMix();
  await GP.saveMix();
  assert.strictEqual(saved.length, 2);
  assert.deepStrictEqual(saved[0], { id: mixLast.id, kind: 'milkdrop', name: mixLast.name, source: mixLast.source, author: 'Üretici' });
  assert.strictEqual(saved[1].id, saved[0].id);
  assert.match(mixLast.name, /^Karışım: /);
});

test('kart: parça satırları, "yok" ve geçmiş düğmeleri', async () => {
  const { M, GP, lib } = await fresh();
  const tree = () => GP.panel();
  const btn = (t, re) => findAll(t, (n) => n.tag === 'button' && re.test(String(n.text))).pop();
  let t = tree();
  assert.strictEqual(findAll(t, (n) => n.className === 'mdmix-row').length, 0, 'karışım yokken satır yok');
  assert.ok(btn(t, /^◀$/).attrs.disabled !== undefined || btn(t, /^◀$/).props.disabled === true);
  M.preview(byId(lib, 'u_b3'));
  GP.fromScreen();
  t = tree();
  const rows = findAll(t, (n) => n.className === 'mdmix-row');
  assert.strictEqual(rows.length, 6);
  const names = rows.map((r) => r.kids[1].text);
  assert.deepStrictEqual(names, ['Beta 3', 'Beta 3', 'Beta 3', 'Beta 3', 'Yok', 'Yok']);
  GP.rollAll();
  t = tree();
  assert.strictEqual(btn(t, /^◀$/).props.disabled, false, 'iki karışımdan sonra geri açık');
  assert.strictEqual(btn(t, /^▶$/).props.disabled, true);
  assert.strictEqual(findAll(t, (n) => /Kütüphaneye Kaydet/.test(String(n.text))).length, 2, 'iki bölümün kendi kaydet düğmesi');
});
