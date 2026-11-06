'use strict';
/* Palet giriş/çıkışı uzun eylem veya medya klibini yeniden ateşlemez. */
const test = require('node:test');
const assert = require('node:assert');
global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;
const TL = require('../src/shared/timeline.js');
const TE = require('../src/shared/timeline-edit.js');
window.SVTimeline = TL;
window.SVClipDeck = require('../src/shared/clipdeck.js');
window.SVTimelineEdit = TE;

const wait = (ms) => new Promise((r) => setTimeout(r, ms || 0));
function el(tag, props, kids) {
  const n = { tag, props: props || {}, kids: [], on: {}, attrs: {}, style: {}, parent: null, isConnected: true };
  n.className = (props && props.class) || '';
  n.text = (props && props.text) || '';
  n.value = (props && props.value) || '';
  n.appendChild = (c) => { if (c) { c.parent = n; n.kids.push(c); } return c; };
  n.insertBefore = (c, ref) => { c.parent = n; n.kids.splice(Math.max(0, n.kids.indexOf(ref)), 0, c); return c; };
  n.replaceWith = () => {};
  n.addEventListener = (ev, f) => { (n.on[ev] = n.on[ev] || []).push(f); };
  n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
  n.getAttribute = (k) => n.attrs[k];
  n.querySelector = () => null;
  n.querySelectorAll = () => [];
  n.classList = { toggle() {}, add() {}, remove() {}, contains: () => false };
  n.focus = () => {};
  Object.defineProperty(n, 'textContent', { get: () => n.text, set: (v) => { n.text = v; } });
  if (tag === 'canvas') {
    n.clientWidth = 800; n.width = 0; n.height = 0;
    n.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 200 });
    n.getContext = () => new Proxy({ createLinearGradient: () => ({ addColorStop() {} }), measureText: () => ({ width: 40 }) }, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  }
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}
window.addEventListener = () => {};
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
global.document = { documentElement: {}, querySelector: () => null, body: { classList: { toggle() {} } }, addEventListener() {} };
const intervals = [];
const realSetInterval = global.setInterval;
global.setInterval = (f, ms) => { const id = realSetInterval(f, ms); intervals.push(id); return id; };
test.after(() => intervals.forEach((id) => clearInterval(id)));

const fired = [];
function setup(cfg) {
  window.SVPanel = {
    cfg: () => cfg, el,
    row: (label, node) => el('div', { class: 'row' }, [el('label', { text: label }), node]),
    push() {}, apply() {}, rerender() {}, confirm: () => Promise.resolve(true), toast() {},
    actions: () => ({ applyScene() {} }),
  };
  window.SVClipDeckPanel = {
    applyRef: (type, ref) => { fired.push([type, ref]); },
    applyFaded: (type, ref, fade) => { fired.push([type, ref, fade]); },
    targetOptions: () => [], resolveTarget: () => null,
    mediaPicker: () => el('div'), slotLabel: (s) => s.ref, refOptions: () => null,
  };
}

let TP = null;
async function mount(cfg) {
  setup(cfg);
  if (!TP) { require('../src/admin/timeline-panel.js'); TP = window.SVTimelinePanel; }
  TP._select(null);
  fired.length = 0;
  const host = el('div', { class: 'host' });
  host.appendChild(TP.panel());
  await wait(5);
  TP.stop();
  fired.length = 0;
  return TP;
}

test('palet giriş/çıkışı uzun eylem klibini yeniden ateşlemez', async () => {
  const cfg = SV.defaultConfig();
  Object.assign(cfg.timeline, {
    enabled: true, applyEditsImmediately: false, snap: 'off', zoom: 60, scroll: 0, followPlayhead: false,
    tracks: [
      { id: 'trAct', kind: 'clip', name: 'A', clips: [
        { id: 'cAct', type: 'action', ref: 'nextScene', name: '', start: 0, dur: 10 },
      ] },
      { id: 'trPal', kind: 'clip', name: 'P', clips: [
        { id: 'cPal', type: 'palette', ref: 'Gece', name: '', start: 2, dur: 2 },
      ] },
    ],
  });
  await mount(cfg);
  fired.length = 0;
  TP._applyAt(0.5);
  assert.deepStrictEqual(fired, [['action', 'nextScene']], 'eylem bir kez');
  fired.length = 0;
  TP._applyAt(2.5);
  assert.deepStrictEqual(fired, [['palette', 'Gece']], 'yalnız palet; eylem yok');
  fired.length = 0;
  TP._applyAt(5.0);
  assert.deepStrictEqual(fired, [], 'palet çıkışı eylem yeniden yok');
  fired.length = 0;
  TP._applyAt(0.5);
  assert.deepStrictEqual(fired, [], 'aynı eylem klibinde kalınca kenar yok');
});

test('palet çıkınca Orman yeniden; medya aynı parçada değilse yeniden başlamaz', async () => {
  const cfg = SV.defaultConfig();
  Object.assign(cfg.timeline, {
    enabled: true, snap: 'off', zoom: 60, scroll: 0, followPlayhead: false,
    tracks: [
      { id: 'trVid', kind: 'clip', name: 'V', clips: [
        { id: 'cVid', type: 'video', ref: '/x.mp4', name: '', start: 0, dur: 10, target: 'media' },
      ] },
      { id: 'trF', kind: 'clip', name: 'F', clips: [
        { id: 'cF', type: 'palette', ref: 'Orman', name: '', start: 0, dur: 4 },
      ] },
      { id: 'trN', kind: 'clip', name: 'N', clips: [
        { id: 'cN', type: 'palette', ref: 'Gece', name: '', start: 2, dur: 4 },
      ] },
    ],
  });
  await mount(cfg);
  fired.length = 0;
  TP._applyAt(0.5);
  assert.ok(fired.some((f) => f[0] === 'video' && f[1] === '/x.mp4'));
  assert.ok(fired.some((f) => f[0] === 'palette' && f[1] === 'Orman'));
  fired.length = 0;
  TP._applyAt(2.5);
  assert.deepStrictEqual(fired, [['palette', 'Gece']], 'video yeniden yok');
  fired.length = 0;
  TP._applyAt(0.5);
  assert.deepStrictEqual(fired, [['palette', 'Orman']], 'Orman geri; video yok');
});
