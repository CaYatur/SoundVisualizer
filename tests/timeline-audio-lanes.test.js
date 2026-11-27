'use strict';
/* Zaman çizelgesi ses şeritleri: kilit, solma eğrisi, saf seçim işlemleri ve
 * kısayolların görsel kliplerle aynı kapıdan (timeline-panel onEditorKey) ses
 * kliplerine gitmesi; düzenlemeler aynı geri al geçmişinde.
 *
 * Saf işlemler (shared/timeline-audio.js) doğrudan; panel ve ses bölümü sahte bir
 * DOM ve sahte bir tuvalle (timeline-tl2.test.js ile aynı düzen).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;
const TL = require('../src/shared/timeline.js');
const TE = require('../src/shared/timeline-edit.js');
const A = require('../src/shared/timeline-audio.js');
window.SVTimeline = TL;
window.SVClipDeck = require('../src/shared/clipdeck.js');
window.SVTimelineEdit = TE;
window.SVTimelineAudioCore = A;

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms || 0));
const starts = (list) => A.normalize(list).map((t) => t.clips.map((c) => c.start));

// ------------------------------------------------------------------ saf işlemler

function lanes() {
  return A.normalize([
    { id: 'l1', name: 'Ses 1', clips: [{ id: 'a', src: '/x/a.mp3', start: 1, dur: 2, srcDur: 60 }, { id: 'b', src: '/x/b.mp3', start: 6, dur: 2, srcDur: 60 }] },
    { id: 'l2', name: 'Ses 2', clips: [{ id: 'c', src: '/x/c.mp3', start: 2, dur: 4, srcDur: 60 }] },
  ]);
}

test('kilit: eski kayıtlarda alan yok → kilitsiz; geçmiş biçimi değişmiyor', () => {
  const t = A.normalize([{ id: 'x', clips: [] }])[0];
  assert.strictEqual(t.locked, false);
  assert.strictEqual(A.normalize([{ id: 'x', locked: true, clips: [] }])[0].locked, true);
  assert.strictEqual(A.normalize([{ id: 'x', locked: 'yes', clips: [] }])[0].locked, false, 'yalnız true kilitler');
});

test('solma eğrisi (geçiş ön izleme hatası): 180 sn klipte 2 sn giriş 2. saniyede tamam', () => {
  const clip = A.makeClip({ id: 'k', src: '/x.mp3', start: 0, dur: 180, srcDur: 180, fadeIn: 2, fadeOut: 3 });
  const inn = A.fadeCurve(clip, 'in', 16);
  assert.strictEqual(inn[0][0], 0);
  assert.strictEqual(inn[0][1], 0, 'başta sessiz');
  const last = inn[inn.length - 1];
  assert.ok(Math.abs(last[0] - 2) < 1e-9, 'eğri tam 2 sn’de bitiyor, daha ileride değil');
  assert.ok(Math.abs(last[1] - 1) < 1e-9);
  assert.ok(inn.every(([t]) => t <= 2 + 1e-9), 'eğri solma aralığının dışına taşmıyor');
  const out = A.fadeCurve(clip, 'out', 16);
  assert.ok(Math.abs(out[0][0] - 177) < 1e-9);
  assert.ok(Math.abs(out[out.length - 1][1]) < 1e-9);
  assert.deepStrictEqual(A.fadeCurve(A.makeClip({ dur: 10 }), 'in', 8), [], 'solma yoksa eğri yok');
});

test('saf işlemler: sil (dalga ile), kaydır (sıfırda durur), çoğalt, böl, şerit değiştir', () => {
  let r = A.removeClips(lanes(), ['a'], false);
  assert.deepStrictEqual(starts(r.tracks), [[6], [2]]);
  r = A.removeClips(lanes(), ['a'], true);
  assert.deepStrictEqual(starts(r.tracks)[0], [4], 'boşluk kapandı');
  r = A.nudgeClips(lanes(), ['a', 'c'], -5);
  assert.deepStrictEqual(starts(r.tracks), [[0, 6], [1]], 'grup biçimi korunarak sıfırda');
  r = A.duplicateClips(lanes(), ['a', 'c']);
  assert.deepStrictEqual(starts(r.tracks), [[1, 6, 6], [2, 7]].map((x) => x.sort((p, q) => p - q)));
  assert.strictEqual(r.ids.length, 2);
  r = A.splitClips(lanes(), ['c'], 3);
  assert.strictEqual(r.split, 1);
  assert.deepStrictEqual(A.normalize(r.tracks)[1].clips.map((c) => [c.start, c.dur]), [[2, 1], [3, 3]]);
  r = A.moveClipsLane(lanes(), ['a'], 1);
  assert.strictEqual(r.moved, 1);
  assert.deepStrictEqual(A.normalize(r.tracks).map((t) => t.clips.map((c) => c.id).sort()), [['b'], ['a', 'c']]);
});

test('saf işlemler kilitli şeride dokunmuyor; yapıştırma kilitliye hiç yapmıyor', () => {
  const list = lanes();
  list[1].locked = true;
  assert.strictEqual(A.removeClips(list, ['c'], false).removed, 0);
  assert.strictEqual(A.nudgeClips(list, ['c'], 1).moved, 0);
  assert.strictEqual(A.splitClips(list, ['c'], 3).split, 0);
  assert.strictEqual(A.moveClipsLane(list, ['a'], 1).moved, 0, 'kilitli şeride taşınmaz');
  assert.ok(A.allClipIds(list).indexOf('c') < 0, 'tümünü seç kilitliyi almıyor');
  const board = A.copyClips(lanes(), ['a', 'c']);
  const p = A.pasteClips(list, board, 10, 0, 'Ses');
  assert.strictEqual(p.locked, true);
  assert.strictEqual(p.pasted || 0, 0);
  const ok = A.pasteClips(lanes(), board, 10, 0, 'Ses');
  assert.deepStrictEqual(starts(ok.tracks), [[1, 6, 10], [2, 11]], 'göreli şerit ve zaman korunuyor');
});

// ------------------------------------------------------------------ panel + ses bölümü

let active = null;
function mkEl(tag) {
  const n = { tagName: String(tag).toUpperCase(), tag, kids: [], on: {}, attrs: {}, style: {}, parentNode: null, dataset: {} };
  const cls = new Set();
  Object.defineProperty(n, 'className', { get: () => Array.from(cls).join(' '), set: (v) => { cls.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => cls.add(c)); } });
  n.classList = { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), contains: (c) => cls.has(c), toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; if (v) cls.add(c); else cls.delete(c); return v; } };
  n.text = '';
  n.value = '';
  Object.defineProperty(n, 'textContent', { get: () => n.text, set: (v) => { n.text = String(v); n.kids = []; } });
  Object.defineProperty(n, 'innerHTML', { get: () => '', set: () => { n.kids = []; } });
  Object.defineProperty(n, 'isConnected', { get: () => true });
  Object.defineProperty(n, 'firstChild', { get: () => n.kids[0] || null });
  Object.defineProperty(n, 'children', { get: () => n.kids });
  n.appendChild = (c) => { if (c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = n; n.kids.push(c); } return c; };
  n.append = (...cs) => cs.forEach((c) => n.appendChild(typeof c === 'string' ? Object.assign(mkEl('#text'), { text: c }) : c));
  n.prepend = (c) => { c.parentNode = n; n.kids.unshift(c); };
  n.insertBefore = (c, ref) => { c.parentNode = n; const i = n.kids.indexOf(ref); n.kids.splice(i < 0 ? n.kids.length : i, 0, c); return c; };
  n.removeChild = (c) => { const i = n.kids.indexOf(c); if (i >= 0) n.kids.splice(i, 1); c.parentNode = null; return c; };
  n.remove = () => { if (n.parentNode) n.parentNode.removeChild(n); };
  n.replaceWith = (m) => { const p = n.parentNode; if (!p) return; m.parentNode = p; p.kids[p.kids.indexOf(n)] = m; };
  n.replaceChild = (nw, old) => { const i = n.kids.indexOf(old); if (nw.parentNode && nw.parentNode !== n) nw.parentNode.removeChild(nw); nw.parentNode = n; if (i >= 0) { n.kids[i] = nw; old.parentNode = null; } else n.kids.push(nw); return old; };
  n.replaceChildren = (...cs) => { n.kids = []; cs.forEach((c) => n.appendChild(c)); };
  n.addEventListener = (ev, f) => { (n.on[ev] = n.on[ev] || []).push(f); };
  n.removeEventListener = () => {};
  n.dispatchEvent = (e) => { fire(n, e.type, e); return true; };
  n.setAttribute = (k, v) => { n.attrs[k] = String(v); if (k === 'class') n.className = v; };
  n.getAttribute = (k) => (k in n.attrs ? n.attrs[k] : null);
  n.removeAttribute = (k) => { delete n.attrs[k]; };
  n.hasAttribute = (k) => k in n.attrs;
  n.contains = (o) => { let p = o; while (p) { if (p === n) return true; p = p.parentNode; } return false; };
  n.closest = () => null;
  n.querySelector = () => null;
  n.querySelectorAll = () => [];
  n.focus = () => { active = n; };
  n.blur = () => {};
  n.scrollIntoView = () => {};
  n.setPointerCapture = () => {};
  n.releasePointerCapture = () => {};
  n.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 200, right: 800, bottom: 200 });
  n.clientWidth = 800;
  n.clientHeight = 200;
  if (tag === 'canvas') {
    n.width = 0;
    n.height = 0;
    n.getContext = () => new Proxy({ createLinearGradient: () => ({ addColorStop() {} }), measureText: () => ({ width: 40 }), getLineDash: () => [] }, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  }
  return n;
}
function el(tag, props, kids) {
  const n = mkEl(tag);
  for (const k in props || {}) {
    if (k === 'class') n.className = props[k];
    else if (k === 'text') n.text = props[k];
    else if (k === 'value') n.value = props[k];
    else if (k.startsWith('on') && typeof props[k] === 'function') n.addEventListener(k.slice(2), props[k]);
    else n.attrs[k] = String(props[k]);
  }
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}
const walk = (n, f) => { if (!n || typeof n !== 'object') return; f(n); (n.kids || []).forEach((k) => walk(k, f)); };
const findAll = (root, pred) => { const r = []; walk(root, (n) => { if (pred(n)) r.push(n); }); return r; };
function fire(n, ev, e) { (n.on[ev] || []).forEach((f) => f(Object.assign({ preventDefault() {}, stopPropagation() {}, target: n }, e || {}))); }

const winOn = {};
window.addEventListener = (ev, f) => { (winOn[ev] = winOn[ev] || []).push(f); };
window.removeEventListener = () => {};
const winFire = (ev, e) => (winOn[ev] || []).forEach((f) => f(Object.assign({ preventDefault() {}, stopPropagation() {} }, e)));
const intervals = [];
const realSetInterval = global.setInterval;
global.setInterval = (f, ms) => { const id = realSetInterval(f, ms); intervals.push(id); return id; };
test.after(() => intervals.forEach((id) => clearInterval(id)));
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const body = mkEl('body');
global.document = {
  documentElement: mkEl('html'), body,
  createElement: (t) => mkEl(t),
  createTextNode: (s) => Object.assign(mkEl('#text'), { text: String(s) }),
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  get activeElement() { return active; },
};
window.document = global.document;

function setup(cfg) {
  window.SVPanel = {
    cfg: () => cfg, el,
    row: (label, node) => el('div', { class: 'row' }, [el('label', { text: label }), node]),
    push() {}, apply() {}, rerender() {}, confirm: () => Promise.resolve(true), toast() {}, actions: () => ({ applyScene() {} }),
  };
  window.SVClipDeckPanel = {
    applyRef() {}, applyFaded() {}, targetOptions: () => [], resolveTarget: (t, target) => target || 'vis',
    mediaPicker: () => el('div'), slotLabel: (s) => s.ref, refOptions: () => null,
  };
}

function cfgOf() {
  const cfg = SV.defaultConfig();
  cfg.scenes = [{ id: 'sA', name: 'A', data: {} }];
  Object.assign(cfg.timeline, {
    enabled: true, snap: 'off', zoom: 60, scroll: 0, followPlayhead: false,
    tracks: [{ id: 'tr1', kind: 'clip', name: 'P1', clips: [{ id: 'v1', type: 'scene', ref: 'sA', start: 1, dur: 2 }] }],
    audioTracks: lanes(),
  });
  return cfg;
}

let TP = null;
let AU = null;
async function mount(cfg) {
  setup(cfg);
  if (!TP) {
    require('../src/admin/timeline-touch.js');
    require('../src/admin/timeline-panel.js');
    require('../src/admin/timeline-audio.js');
    TP = window.SVTimelinePanel;
    AU = window.SVTimelineAudio;
  }
  TP._select(null);
  AU._select('', '');
  const host = el('div', { class: 'host' });
  host.appendChild(TP.panel());
  await wait(5);
  TP.seek(0);
  return host;
}
const key = (k, extra) => TP._key(Object.assign({ key: k, target: {}, preventDefault() {}, stopPropagation() {} }, extra));
const aud = (cfg) => A.normalize(cfg.timeline.audioTracks);
const ids = (cfg) => aud(cfg).map((t) => t.clips.map((c) => c.id).sort());
const clipOf = (cfg, id) => aud(cfg).flatMap((t) => t.clips).find((c) => c.id === id);

test('kısayol: Delete seçili ses klibini siliyor (panelin yakalama kapısından), geri al getiriyor', async () => {
  const cfg = cfgOf();
  await mount(cfg);
  AU._select('l1', 'a');
  assert.strictEqual(AU.active(), true);
  key('Delete');
  assert.deepStrictEqual(ids(cfg), [['b'], ['c']]);
  assert.deepStrictEqual(cfg.timeline.tracks[0].clips.map((c) => c.id), ['v1'], 'görsel klibe dokunulmadı');
  TP.undo();
  assert.deepStrictEqual(ids(cfg), [['a', 'b'], ['c']], 'aynı geri al geçmişi');
  TP.redo();
  assert.deepStrictEqual(ids(cfg), [['b'], ['c']]);
  AU._select('l1', 'b');
  key('Backspace', { shiftKey: true });
  assert.deepStrictEqual(ids(cfg), [[], ['c']]);
});

test('kısayol: Ctrl+C / Ctrl+V kafaya yapıştırıyor; Ctrl+X kesiyor; en son kopyalanan pano kazanıyor', async () => {
  const cfg = cfgOf();
  await mount(cfg);
  AU._select('l1', 'a');
  key('c', { ctrlKey: true });
  TP.seek(10);
  key('v', { ctrlKey: true });
  assert.deepStrictEqual(aud(cfg)[0].clips.map((c) => c.start), [1, 6, 10]);
  // Görsel klip sonra kopyalanırsa Ctrl+V görseli yapıştırır
  TP._select({ kind: 'clip', trackId: 'tr1', clipId: 'v1' });
  assert.strictEqual(AU.active(), false, 'görsel seçim ses seçimini kaldırdı');
  key('c', { ctrlKey: true });
  TP.seek(20);
  key('v', { ctrlKey: true });
  assert.strictEqual(cfg.timeline.tracks[0].clips.length, 2, 'görsel yapıştı');
  assert.strictEqual(aud(cfg)[0].clips.length, 3, 'ses yapışmadı');
  // Kes
  AU._select('l2', 'c');
  key('x', { ctrlKey: true });
  assert.deepStrictEqual(ids(cfg)[1], []);
  TP.seek(30);
  key('v', { ctrlKey: true });
  assert.deepStrictEqual(aud(cfg)[1].clips.map((c) => c.start), [30]);
});

test('kısayol: Ctrl+D çoğaltıyor, S ve Ctrl+K kafada bölüyor', async () => {
  const cfg = cfgOf();
  await mount(cfg);
  AU._select('l2', 'c');
  key('d', { ctrlKey: true });
  assert.deepStrictEqual(aud(cfg)[1].clips.map((c) => c.start), [2, 6]);
  assert.strictEqual(AU._sel().length, 1, 'kopya seçili');
  AU._select('l2', 'c');
  TP.seek(3);
  key('s');
  assert.deepStrictEqual(aud(cfg)[1].clips.map((c) => [c.start, c.dur]), [[2, 1], [3, 3], [6, 4]]);
  // Seçim sağ parçada (3..6); 7 onun dışında → bölünmez, görsel kliplerdeki gibi
  TP.seek(7);
  key('k', { ctrlKey: true });
  assert.strictEqual(aud(cfg)[1].clips.length, 3);
  AU._select('l2', aud(cfg)[1].clips[2].id);
  key('k', { ctrlKey: true });
  assert.deepStrictEqual(aud(cfg)[1].clips.map((c) => [c.start, c.dur]), [[2, 1], [3, 3], [6, 1], [7, 3]]);
});

test('kısayol: ←/→ ızgara adımı, Alt bir kare; ↑/↓ şerit değiştiriyor', async () => {
  const cfg = cfgOf();
  cfg.timeline.fps = 30;
  await mount(cfg);
  AU._select('l1', 'a');
  const step = TP.stepAt(1, 1, false, false);
  assert.ok(step > 0);
  key('ArrowRight');
  assert.ok(Math.abs(clipOf(cfg, 'a').start - (1 + step)) < 1e-6, 'görsel kliplerle aynı adım');
  const at = clipOf(cfg, 'a').start;
  key('ArrowLeft', { altKey: true });
  assert.ok(Math.abs(clipOf(cfg, 'a').start - (at - TP.stepAt(at, -1, true, false))) < 1e-6, 'Alt: bir kare');
  key('ArrowDown');
  assert.ok(aud(cfg)[1].clips.some((c) => c.id === 'a'), 'alt şeride geçti');
  key('ArrowUp');
  assert.ok(aud(cfg)[0].clips.some((c) => c.id === 'a'));
});

test('kısayol: Ctrl+A tüm ses kliplerini seçiyor, grup birlikte siliniyor; Esc seçimi bırakıyor', async () => {
  const cfg = cfgOf();
  await mount(cfg);
  AU._select('l1', 'a');
  key('a', { ctrlKey: true });
  assert.deepStrictEqual(AU._sel().sort(), ['a', 'b', 'c']);
  assert.deepStrictEqual(TP._multi(), [], 'görsel klipler seçime girmedi');
  key('Escape');
  assert.strictEqual(AU.active(), false);
  assert.deepStrictEqual(ids(cfg), [['a', 'b'], ['c']], 'Esc hiçbir şey silmedi');
  AU._select('l1', ['a', 'c']);
  key('Delete');
  assert.deepStrictEqual(ids(cfg), [['b'], []]);
  TP.undo();
  assert.deepStrictEqual(ids(cfg), [['a', 'b'], ['c']]);
});

test('kısayol: ses seçimi yokken tuşlar görsel kliplere gidiyor (eski davranış)', async () => {
  const cfg = cfgOf();
  await mount(cfg);
  TP._select({ kind: 'clip', trackId: 'tr1', clipId: 'v1' });
  key('Delete');
  assert.deepStrictEqual(cfg.timeline.tracks[0].clips, []);
  assert.deepStrictEqual(ids(cfg), [['a', 'b'], ['c']]);
});

test('kilit: kilitli şeritte kısayollar klibi silmiyor/taşımıyor; tümünü seç kilitliyi almıyor', async () => {
  const cfg = cfgOf();
  cfg.timeline.audioTracks[1].locked = true;
  await mount(cfg);
  AU._select('l2', 'c');
  key('Delete');
  key('ArrowRight');
  key('d', { ctrlKey: true });
  assert.deepStrictEqual(aud(cfg)[1].clips.map((c) => [c.id, c.start]), [['c', 2]]);
  key('a', { ctrlKey: true });
  assert.deepStrictEqual(AU._sel().sort(), ['a', 'b']);
  // Fare: kilitli şeritte isabet yok
  assert.strictEqual(AU._hit(150, 40 + 20).locked, true);
  AU.toggleLock('l2');
  assert.strictEqual(aud(cfg)[1].locked, false);
  AU.toggleLock('l2');
  assert.strictEqual(AU.removeTrack('l2'), false, 'kilitli şerit silinmez');
  assert.strictEqual(aud(cfg).length, 2);
});

test('dokunma: kaba işaretçide geniş isabet payı; uzun basma süresi sabit', () => {
  const T = window.SVTimelineTouch;
  assert.ok(T && typeof T.bind === 'function');
  assert.strictEqual(T.tol(6), 6, 'fare: değişmiyor');
  assert.ok(T.LONG_MS >= 400 && T.LONG_MS <= 700);
  const css = read('src/admin/admin.css');
  assert.match(css, /\.tla-canvas[^{]*\{[^}]*touch-action: none/);
  assert.match(css, /@media \(pointer: coarse\)/);
  assert.match(read('src/admin/index.html'), /<script src="timeline-touch\.js"><\/script>\s*\n\s*<script src="timeline-panel\.js"><\/script>/);
});

test('ses bölümü kendi keydown dinleyicisini kurmuyor (tek kapı: panel)', () => {
  const ui = read('src/admin/timeline-audio.js');
  assert.ok(!/addEventListener\('keydown'/.test(ui));
  assert.match(read('src/admin/timeline-panel.js'), /AU\.key\(e\)/);
});
