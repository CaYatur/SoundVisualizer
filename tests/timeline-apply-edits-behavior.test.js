'use strict';
/* Anında uygula: OFF dururken ezmez; ON transport modelindeki kaynağı
 * kafadaki zamanda uygular; oynatma/seek çalışır; varsayılan false. */
const test = require('node:test');
const assert = require('node:assert');
global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;
const TL = require('../src/shared/timeline.js');
window.SVTimeline = TL;
window.SVClipDeck = require('../src/shared/clipdeck.js');
window.SVTimelineEdit = require('../src/shared/timeline-edit.js');

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
    applyFaded: (type, ref) => { fired.push([type, ref]); },
    targetOptions: () => [], resolveTarget: () => null,
    mediaPicker: () => el('div'), slotLabel: (s) => s.ref, refOptions: () => null,
  };
}

let TP = null;
async function mount(cfg) {
  setup(cfg);
  if (!TP) { require('../src/admin/timeline-panel.js'); TP = window.SVTimelinePanel; }
  TP._select(null);
  const host = el('div', { class: 'host' });
  host.appendChild(TP.panel());
  await wait(5);
  TP.stop();
  fired.length = 0;
  return TP;
}

function base(on) {
  const cfg = SV.defaultConfig();
  Object.assign(cfg.timeline, {
    enabled: true, applyEditsImmediately: !!on, snap: 'off', zoom: 60, scroll: 0, followPlayhead: false,
    tracks: [{ id: 'tr1', kind: 'clip', name: 'P', clips: [
      { id: 'c1', type: 'palette', ref: 'Orman', name: '', start: 0, dur: 8 },
    ] }],
  });
  return cfg;
}

function liveClip(TP) {
  return TP.transport().tl.tracks[0].clips[0];
}

test('defaults: applyEditsImmediately false', () => {
  assert.strictEqual(SV.defaultConfig().timeline.applyEditsImmediately, false);
});

test('OFF: maybeApplyEditsNow kaynak değişince ateşlemez', async () => {
  const cfg = base(false);
  const TP = await mount(cfg);
  TP.seek(1);
  liveClip(TP).ref = 'Gece';
  fired.length = 0;
  TP._maybeApplyEditsNow();
  assert.deepStrictEqual(fired, [], 'kapalıyken durmuş düzenleme çıkışı ezmez');
});

test('ON: maybeApplyEditsNow transport kaynağını kafada uygular', async () => {
  const cfg = base(true);
  const TP = await mount(cfg);
  TP.seek(1);
  // Seed then change the LIVE model clip (commit mutates this object)
  TP._applyAt(1);
  liveClip(TP).ref = 'Gece';
  fired.length = 0;
  TP._maybeApplyEditsNow();
  assert.ok(fired.some((f) => f[0] === 'palette' && f[1] === 'Gece'), 'ON: Gece yazıldı ' + JSON.stringify(fired));
});

test('OFF iken oynatma/seek çalışır', async () => {
  const cfg = base(false);
  const TP = await mount(cfg);
  fired.length = 0;
  TP._applyAt(0.5);
  assert.ok(fired.some((f) => f[1] === 'Orman'));
  TP.play();
  assert.strictEqual(TP.transport().playing, true);
  TP.pause();
  assert.strictEqual(TP.transport().playing, false);
  TP.seek(2);
  assert.ok(Math.abs(TP.transport().time - 2) < 1e-6);
});

test('toolbar Anında Uygula sözlükte ve düğmede', () => {
  const fs = require('fs');
  const path = require('path');
  assert.match(fs.readFileSync(path.join(__dirname, '../src/shared/i18n.js'), 'utf8'), /'Anında Uygula': 'Apply Immediately'/);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/admin/timeline-panel.js'), 'utf8'), /tl-liveedit/);
});
