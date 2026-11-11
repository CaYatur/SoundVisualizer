/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ZAMAN ÇİZELGESİ AKICILIĞI.
 *
 * Uygulamada (CDP, gerçek fare olayları) ölçüldü: seçili klip geri al ya da
 * sil ile kaybolunca çizelge denetçisi follow → begin → bütün sayfa çizimi →
 * denetçi → follow döngüsüne giriyordu; yarım saniyede 46–50 tam yeniden
 * kurulum. Klibe tıklamak da sürüklemenin ortasında tuvali yeniden kuruyordu.
 * Burada iki şey sınanıyor: hedef olamayan seçim yeniden çizim istemiyor ve
 * yapı aynıyken panel aynı düğümleri (tuval dahil) geri veriyor. */
const test = require('node:test');
const assert = require('node:assert');
global.window = global.window || {};
require('../src/shared/defaults.js');
require('../src/shared/schema.js');
require('../src/visualizer/layers.js');
window.SVShowClock = require('../src/shared/showclock.js');
const SV = global.window.SV;
window.SVTimeline = require('../src/shared/timeline.js');
window.SVClipDeck = require('../src/shared/clipdeck.js');
window.SVTimelineEdit = require('../src/shared/timeline-edit.js');
window.SVTimelineCompose = require('../src/shared/timeline-compose.js');
window.SVUndo = require('../src/admin/undo.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms || 0));

// ----------------------------------------------- belgeye bağlılığı olan sahte DOM
const ROOT = { connected: true };
function el(tag, props, kids) {
  const n = { tag, props: props || {}, children: [], on: {}, attrs: {}, style: {}, parentNode: null, scrollTop: 0 };
  n.className = (props && props.class) || '';
  n.text = (props && props.text) || '';
  n.value = (props && props.value) || '';
  Object.defineProperty(n, 'isConnected', { get: () => { let p = n; while (p.parentNode) p = p.parentNode; return p === ROOT.node; } });
  const detach = (c) => { if (c.parentNode) { const k = c.parentNode.children; const i = k.indexOf(c); if (i >= 0) k.splice(i, 1); } };
  n.appendChild = (c) => { if (c) { detach(c); c.parentNode = n; n.children.push(c); } return c; };
  n.append = (...cs) => cs.forEach((c) => c && typeof c === 'object' && n.appendChild(c));
  n.insertBefore = (c, ref) => { detach(c); c.parentNode = n; const i = n.children.indexOf(ref); n.children.splice(i < 0 ? n.children.length : i, 0, c); return c; };
  n.replaceChild = (next, old) => { const i = n.children.indexOf(old); if (i < 0) return old; detach(next); n.children[i] = next; next.parentNode = n; old.parentNode = null; return old; };
  n.replaceWith = (m) => { if (n.parentNode) n.parentNode.replaceChild(m, n); };
  n.replaceChildren = (...cs) => { n.children.forEach((c) => { c.parentNode = null; }); n.children = []; cs.forEach((c) => c && n.appendChild(c)); };
  n.remove = () => detach(n);
  n.contains = (x) => { for (let p = x; p; p = p.parentNode) if (p === n) return true; return false; };
  n.addEventListener = (ev, f) => { (n.on[ev] = n.on[ev] || []).push(f); };
  n.removeEventListener = () => {};
  n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
  n.getAttribute = (k) => n.attrs[k];
  n.removeAttribute = (k) => { delete n.attrs[k]; };
  n.querySelector = () => null;
  n.querySelectorAll = () => [];
  const cls = new Set(n.className.split(/\s+/).filter(Boolean));
  n.classList = { toggle: (c, on) => { if (on === undefined ? !cls.has(c) : on) cls.add(c); else cls.delete(c); }, add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) };
  n.focus = () => { global.document.activeElement = n; };
  n.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 200, width: 800, height: 200 });
  Object.defineProperty(n, 'textContent', { get: () => n.text, set: (v) => { n.text = v; } });
  if (tag === 'canvas') {
    n.clientWidth = 800; n.width = 0; n.height = 0;
    n.getContext = () => new Proxy({ createLinearGradient: () => ({ addColorStop() {} }), measureText: () => ({ width: 40 }) }, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  }
  (kids || []).forEach((c) => c && typeof c === 'object' && n.appendChild(c));
  return n;
}
ROOT.node = el('div', { class: 'root' });
window.addEventListener = () => {};
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
global.document = {
  documentElement: {}, activeElement: null, querySelector: () => null, addEventListener() {},
  getElementById: () => null,
  body: { classList: { toggle() {}, add() {}, remove() {} }, getAttribute: () => 'time' },
};
const intervals = [];
const realSetInterval = global.setInterval;
global.setInterval = (f, ms) => { const id = realSetInterval(f, ms); intervals.push(id); return id; };
test.after(() => intervals.forEach((id) => clearInterval(id)));

let rerenders = 0;
let TP = null;
let sections = null;
function render() {
  // admin.js render(): kart kabı boşaltılıp panel yeniden isteniyor
  sections.replaceChildren(el('section', { class: 'card' }, [TP.panel()]));
}
function cfgWith(tracks) {
  const cfg = SV.defaultConfig();
  cfg.scenes = [{ id: 'sA', name: 'A', data: {} }, { id: 'sB', name: 'B', data: {} }];
  Object.assign(cfg.timeline, { snap: 'off', zoom: 60, scroll: 0, followPlayhead: false, useTimeline: true, tracks });
  return cfg;
}
async function mount(cfg) {
  window.SVPanel = {
    cfg: () => cfg, el,
    row: (label, node) => el('div', { class: 'row' }, [el('label', { text: label }), node]),
    push() {}, apply() {}, rerender() { rerenders++; render(); }, confirm: () => Promise.resolve(true), toast() {},
    actions: () => ({ applyScene() {} }),
  };
  window.SVClipDeckPanel = {
    applyRef() {}, applyFaded() {}, targetOptions: () => [], resolveTarget: () => null,
    mediaPicker: () => el('div'), slotLabel: (s) => s.ref, refOptions: () => null,
  };
  if (!TP) { require('../src/admin/timeline-panel.js'); require('../src/admin/timeline-target.js'); TP = window.SVTimelinePanel; }
  window.SVUndoHistory = window.SVUndo.create({
    keys: window.SVSchema.SCENE_KEYS, get: (k) => cfg[k],
    set: (k, v) => { if (v === undefined) delete cfg[k]; else cfg[k] = v; }, apply() {}, changed() {},
  });
  TP._select(null);
  sections = el('div', { class: 'sections' });
  ROOT.node.replaceChildren(sections);
  render();
  await wait(5);
  TP.stop();
  rerenders = 0;
}
const canvasOf = () => { let found = null; const walk = (n) => { if (found || !n) return; if (n.tag === 'canvas') found = n; (n.children || []).forEach(walk); }; walk(sections); return found; };

test('yapı aynıyken sayfa çizimi çizelgeyi baştan kurmuyor: aynı panel ve aynı tuval', async () => {
  await mount(cfgWith([{ id: 't1', kind: 'clip', name: 'P', clips: [{ id: 'c1', type: 'scene', ref: 'sA', start: 0, dur: 2 }] }]));
  const cv = canvasOf();
  const before = TP._perf();
  for (let i = 0; i < 5; i++) render();
  await wait(1);
  const after = TP._perf();
  assert.strictEqual(canvasOf(), cv, 'tuval aynı düğüm');
  assert.ok(cv.isConnected, 'tuval belgede');
  assert.strictEqual(after.builds, before.builds, 'yeniden kurulum yok');
  assert.strictEqual(after.reuses - before.reuses, 5, 'beş çizim yerinde yenilendi');
});

test('dışarıdan gelen değişiklik (MCP, sahne) yerinde yenilemede de modele giriyor', async () => {
  const cfg = cfgWith([{ id: 't1', kind: 'clip', name: 'P', clips: [{ id: 'c1', type: 'scene', ref: 'sA', start: 0, dur: 2 }] }]);
  await mount(cfg);
  cfg.timeline.tracks = cfg.timeline.tracks.concat([{ id: 't2', kind: 'clip', name: 'Q', clips: [{ id: 'c2', type: 'scene', ref: 'sB', start: 3, dur: 1 }] }]);
  render();
  assert.deepStrictEqual(TP.transport().tl.tracks.map((t) => t.id), ['t1', 't2']);
});

test('yapı değişince (boş çizelgeye ilk parça, boş parça notu) panel yeniden kuruluyor', async () => {
  const cfg = cfgWith([]);
  await mount(cfg);
  const before = TP._perf().builds;
  cfg.timeline.tracks = [{ id: 't1', kind: 'clip', name: 'P', clips: [{ id: 'c1', type: 'scene', ref: 'sA', start: 0, dur: 2 }] }];
  render();
  assert.strictEqual(TP._perf().builds, before + 1, 'not değişti, panel yeni');
});

test('geri al seçili klibi kaldırınca hedef döngüsü yok: bir iki çizim, sonra sessiz', async () => {
  const cfg = cfgWith([{ id: 't1', kind: 'clip', name: 'P', clips: [
    { id: 'c1', type: 'scene', ref: 'sA', start: 0, dur: 2 },
    { id: 'c2', type: 'scene', ref: 'sB', start: 3, dur: 2 },
  ] }]);
  await mount(cfg);
  // Çoğaltınca seçim kopyaya geçiyor; geri al kopyayı kaldırıyor ama seçim ona bakıyor
  TP._select({ kind: 'clip', trackId: 't1', clipId: 'c2' });
  TP.duplicate();
  const copy = TP._selection();
  assert.ok(copy && copy.clipId !== 'c2', 'kopya seçili');
  await wait(10);
  rerenders = 0;
  TP.undo();
  await wait(30);
  const settled = rerenders;
  await wait(60);
  assert.ok(settled <= 4, 'geri al sonrası çizim sayısı küçük: ' + settled);
  assert.strictEqual(rerenders, settled, 'çizimler durdu (döngü yok)');
  assert.ok(!cfg.timeline.tracks[0].clips.some((c) => c.id === copy.clipId), 'kopya geri alındı');
});

test('hedef olamayan seçim (kaynak yok, düzenlenemez tür) yeniden çizim istemiyor', async () => {
  const cfg = cfgWith([{ id: 't1', kind: 'clip', name: 'P', clips: [
    { id: 'cAct', type: 'action', ref: 'nextScene', start: 0, dur: 1 },
    { id: 'cGone', type: 'scene', ref: 'missing', start: 2, dur: 1 },
  ] }]);
  await mount(cfg);
  const T = window.SVTimelineTarget;
  let toasts = 0;
  window.SVPanel.toast = () => { toasts++; };
  rerenders = 0;
  for (let i = 0; i < 4; i++) T.follow({ kind: 'clip', trackId: 't1', clipId: 'cAct' }, 0);
  assert.strictEqual(rerenders, 0, 'eylem klibi: çizim yok');
  for (let i = 0; i < 4; i++) T.follow({ kind: 'clip', trackId: 't1', clipId: 'cGone' }, 0);
  assert.strictEqual(rerenders, 0, 'kaynağı olmayan klip: çizim yok');
  assert.ok(toasts <= 1, 'uyarı aynı klip için bir kez: ' + toasts);
  for (let i = 0; i < 3; i++) T.follow({ kind: 'clip', trackId: 't1', clipId: 'nope' }, 0);
  assert.strictEqual(rerenders, 0, 'silinmiş klip: çizim yok');
});

test('yerinde yenilenen panelde "Yeni Şerit" menüsü güncel modele yazıyor (dışarıdan değişen parça listesi)', async () => {
  /* Öz testte yakalandı: panel aynı yapıyla yerinde yenilenince menü yeniden kurulmuyor. Menü
     çizim anındaki model nesnesini tutuyordu; parça listesi dışarıdan değişince (geri al, sahne,
     MCP) eklenen parça eski nesnede kalıyor, kayıt yeni nesneden yapılıyor ve parça kayboluyordu. */
  const clipTrack = (id) => ({ id, kind: 'clip', name: 'P', clips: [{ id: 'c' + id, type: 'scene', ref: 'sA', start: 0, dur: 2 }] });
  const cfg = cfgWith([clipTrack('t1')]);
  await mount(cfg);
  let menu = null;
  window.SVSceneShell = { placeMenu: (m) => { menu = m; } };
  const find = (n, cls) => { let hit = null; const walk = (x) => { if (hit || !x) return; if (String(x.className).split(/\s+/).includes(cls)) hit = x; (x.children || []).forEach(walk); }; walk(n); return hit; };
  const builds = TP._perf().builds;
  // Aynı yapı, yeni dizi: imza değişmiyor, panel yerinde yenileniyor
  cfg.timeline.tracks = [clipTrack('t9')];
  render();
  assert.strictEqual(TP._perf().builds, builds, 'panel yeniden kurulmadı');
  const add = find(sections, 'tl-add');
  assert.ok(add, 'Yeni Şerit düğmesi');
  add.props.onclick({ currentTarget: add });
  const item = menu.children.find((b) => b.props.text === 'Otomasyon Parçası');
  item.props.onclick();
  assert.deepStrictEqual(cfg.timeline.tracks.map((t) => t.kind), ['clip', 'automation'], 'parça yapılandırmaya yazıldı');
  assert.strictEqual(cfg.timeline.tracks[0].id, 't9', 'dışarıdan gelen liste korundu');
});
