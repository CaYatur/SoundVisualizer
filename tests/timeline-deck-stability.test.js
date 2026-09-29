'use strict';
/* Zaman çizelgesi ve klip destesi KARARLILIĞI (#636, #637).
 *
 * Uygulamada gerçek fare olaylarıyla bulundu (yalıtılmış profil, CDP):
 *   - panel her çizildiğinde pencereye bir fare dinleyicisi daha ekleniyordu
 *     (on yeniden çizimde 1 → 11);
 *   - klibe tıklamak onu seçiyor ama denetçi "Bir klip seçin" diyordu;
 *   - 1 sn'deki A klibi 5 sn'deki B'nin ötesine sürüklenince İKİSİ DE
 *     8 sn'de kalıyordu (sürükleme sırayla tutuluyordu, liste her harekette
 *     yeniden sıralanıyordu); anahtar karelerde aynısı;
 *   - destede "Satırı Adlandır" `window.prompt` açıyordu (Electron'da yok),
 *     satır adı sözlüğü eksik bir destede de hata atıyordu.
 *
 * Burada panel sahte bir DOM ve sahte bir tuvalle gerçekten sürülüyor:
 * fare olayları panelin kendi dinleyicilerine veriliyor.
 */
const test = require('node:test');
const assert = require('node:assert');
global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;
window.SVTimeline = require('../src/shared/timeline.js');
window.SVClipDeck = require('../src/shared/clipdeck.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms || 0));

// ---------------------------------------------------------------- sahte DOM
function el(tag, props, kids) {
  const n = { tag, props: props || {}, kids: [], on: {}, attrs: {}, style: {}, parent: null, isConnected: true };
  n.className = (props && props.class) || '';
  n.text = (props && props.text) || '';
  n.value = (props && props.value) || '';
  n.appendChild = (c) => { if (c) { c.parent = n; n.kids.push(c); } return c; };
  n.insertBefore = (c, ref) => { c.parent = n; n.kids.splice(Math.max(0, n.kids.indexOf(ref)), 0, c); return c; };
  n.replaceWith = (m) => { const p = n.parent; if (!p) return; m.parent = p; p.kids[p.kids.indexOf(n)] = m; n.isConnected = false; };
  n.addEventListener = (ev, f) => { (n.on[ev] = n.on[ev] || []).push(f); };
  n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
  n.getAttribute = (k) => n.attrs[k];
  n.querySelector = () => null;
  n.querySelectorAll = () => [];
  n.classList = { toggle() {}, add() {}, remove() {}, contains: () => false };
  Object.defineProperty(n, 'textContent', { get: () => n.text, set: (v) => { n.text = v; } });
  if (tag === 'canvas') {
    n.clientWidth = 800;
    n.width = 0;
    n.height = 0;
    n.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 200 });
    // Her çizim çağrısını yutan bağlam
    n.getContext = () => new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  }
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}
const walk = (n, f) => { if (!n || typeof n !== 'object') return; f(n); (n.kids || []).forEach((k) => walk(k, f)); if (n.node) walk(n.node, f); };
const find = (root, pred) => { let r = null; walk(root, (n) => { if (!r && pred(n)) r = n; }); return r; };
const fire = (n, ev, e) => (n.on[ev] || []).forEach((f) => f(e || {}));

// Pencere dinleyicileri sayılıyor
const winOn = {};
window.addEventListener = (ev, f) => { (winOn[ev] = winOn[ev] || []).push(f); };
const winFire = (ev, e) => (winOn[ev] || []).forEach((f) => f(e));
/* Panelin süreğen zamanlayıcıları (saat etiketi, yedek döngü) sayılıyor ve
   sonda kapatılıyor; yoksa test süreci hiç bitmezdi. */
const intervals = [];
const realSetInterval = global.setInterval;
global.setInterval = (f, ms) => { const id = realSetInterval(f, ms); intervals.push(id); return id; };
test.after(() => intervals.forEach((id) => clearInterval(id)));
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
global.document = { documentElement: {}, querySelector: () => null };

function setupPanel(cfg) {
  const calls = { push: 0, rerender: 0, apply: 0 };
  window.SVPanel = {
    cfg: () => cfg, el,
    row: (label, node) => el('div', { class: 'row' }, [el('label', { text: label }), node]),
    push() { calls.push++; }, apply() { calls.apply++; }, rerender() { calls.rerender++; },
    confirm: () => Promise.resolve(true), toast() {}, actions: () => ({ applyScene() {} }),
  };
  return calls;
}

// 60 px/sn, kaydırma yok, yakalama kapalı: x = 60 * t
const RULER = 26;
const TRACK = 34;
const X = (t) => t * 60;

function timelineCfg() {
  const cfg = SV.defaultConfig();
  cfg.scenes = [{ id: 'sA', name: 'Sahne A', data: {} }, { id: 'sB', name: 'Sahne B', data: {} }];
  Object.assign(cfg.timeline, {
    enabled: true, snap: 'off', zoom: 60, scroll: 0, followPlayhead: false,
    tracks: [
      { id: 'tr1', kind: 'clip', name: 'P1', clips: [
        { id: 'cA', type: 'scene', ref: 'sA', name: 'A', start: 1, dur: 2 },
        { id: 'cB', type: 'scene', ref: 'sB', name: 'B', start: 5, dur: 2 },
      ] },
      { id: 'tr2', kind: 'automation', name: 'O', target: 'x', keys: [{ t: 1, v: 0.2 }, { t: 4, v: 0.8 }] },
    ],
  });
  return cfg;
}

let TP = null;
async function timelinePanel(cfg) {
  const calls = setupPanel(cfg);
  if (!TP) {
    require('../src/admin/timeline-panel.js');
    TP = window.SVTimelinePanel;
  }
  const host = el('div', { class: 'host' });
  host.appendChild(TP.panel());
  await wait(5); // tuval bağlanıyor
  const cv = find(host, (n) => n.tag === 'canvas');
  return { host, cv, calls };
}

// ----------------------------------------------------------- zaman çizelgesi

test('zaman çizelgesi: yeniden çizimler pencereye dinleyici eklemiyor', async () => {
  const cfg = timelineCfg();
  await timelinePanel(cfg);
  const n0 = (winOn.mousemove || []).length;
  for (let i = 0; i < 10; i++) await timelinePanel(cfg);
  assert.strictEqual(n0, 1, 'ilk çizimde bir dinleyici');
  assert.strictEqual((winOn.mousemove || []).length, 1, 'on yeniden çizimden sonra da bir');
  assert.strictEqual((winOn.mouseup || []).length, 1);
});

test('zaman çizelgesi: klip komşusunun ötesine sürüklenince yalnız o klip gidiyor', async () => {
  const cfg = timelineCfg();
  const { cv } = await timelinePanel(cfg);
  const y = RULER + TRACK / 2;
  fire(cv, 'mousedown', { clientX: X(2), clientY: y, detail: 1 });
  for (let t = 2.5; t <= 9; t += 0.5) winFire('mousemove', { clientX: X(t), clientY: y });
  winFire('mouseup', {});
  const clips = cfg.timeline.tracks[0].clips.map((c) => c.name + '@' + c.start);
  assert.deepStrictEqual(clips, ['B@5', 'A@8'], 'B yerinde, A 7 sn ileride');
});

test('zaman çizelgesi: sağ kenardan uzatma komşuyu geçince de aynı klipte kalıyor', async () => {
  const cfg = timelineCfg();
  const { cv } = await timelinePanel(cfg);
  const y = RULER + TRACK / 2;
  // A'nın sağ kenarı 3 sn: 9 sn'ye çek
  fire(cv, 'mousedown', { clientX: X(3), clientY: y, detail: 1 });
  for (let t = 3.5; t <= 9; t += 0.5) winFire('mousemove', { clientX: X(t), clientY: y });
  winFire('mouseup', {});
  const byName = Object.fromEntries(cfg.timeline.tracks[0].clips.map((c) => [c.name, [c.start, +c.dur.toFixed(3)]]));
  assert.deepStrictEqual(byName, { A: [1, 8], B: [5, 2] });
});

test('zaman çizelgesi: anahtar kare komşusunun ötesine sürüklenince kimliği korunuyor', async () => {
  const cfg = timelineCfg();
  const { cv } = await timelinePanel(cfg);
  const top = RULER + TRACK + 5;
  const bot = RULER + 2 * TRACK - 6;
  const yOf = (v) => bot - (bot - top) * v;
  fire(cv, 'mousedown', { clientX: X(1), clientY: yOf(0.2), detail: 1 });
  for (let t = 1.5; t <= 6; t += 0.5) winFire('mousemove', { clientX: X(t), clientY: yOf(0.2) });
  winFire('mouseup', {});
  const keys = cfg.timeline.tracks[1].keys.map((k) => k.t + ':' + k.v.toFixed(2));
  assert.deepStrictEqual(keys, ['4:0.80', '6:0.20']);
});

test('zaman çizelgesi: klibe tıklamak denetçide o klibi gösteriyor, boşa tıklamak boşaltıyor', async () => {
  const cfg = timelineCfg();
  const { host, cv, calls } = await timelinePanel(cfg);
  const inspector = () => find(host, (n) => n.className === 'tl-inspector');
  // Önceki testin seçimi modülde duruyor: önce boşa tıklanıyor
  fire(cv, 'mousedown', { clientX: X(11), clientY: RULER + TRACK / 2, detail: 1 });
  winFire('mouseup', {});
  assert.ok(find(inspector(), (n) => /Bir klip ya da anahtar kare seçin/.test(n.text)));
  const y = RULER + TRACK / 2;
  fire(cv, 'mousedown', { clientX: X(5.5), clientY: y, detail: 1 });
  winFire('mouseup', {});
  const name = find(inspector(), (n) => n.tag === 'input' && n.value === 'B');
  assert.ok(name, 'denetçi B klibinin adını gösteriyor');
  assert.strictEqual(calls.rerender, 0, 'bütün panel yeniden çizilmedi (çift tıklama bozulmasın)');
  // Boş bir yere tıklamak seçimi ve denetçiyi boşaltıyor
  fire(cv, 'mousedown', { clientX: X(11), clientY: y, detail: 1 });
  winFire('mouseup', {});
  assert.ok(find(inspector(), (n) => /Bir klip ya da anahtar kare seçin/.test(n.text)));
});

// --------------------------------------------------------------- klip destesi

let CDP = null;
function deckPanel(cfg) {
  setupPanel(cfg);
  window.SVTimelinePanel = null;
  if (!CDP) {
    require('../src/admin/clipdeck-panel.js');
    CDP = window.SVClipDeckPanel;
  }
  return CDP.panel();
}

test('deste: satır adı düzenleyicide bir metin kutusu; eksik sözlükte hata yok', () => {
  const cfg = SV.defaultConfig();
  cfg.clipdeck.enabled = true;
  // Eski ya da elle düzenlenmiş bir dosya: satır adı sözlüğü yok
  cfg.clipdeck.decks = [{ id: 'deck', name: 'A', rows: 2, cols: 2, slots: [{ row: 1, col: 0, type: 'scene', ref: 'sA', name: 'A' }] }];
  let root = deckPanel(cfg);
  const cell = find(root, (n) => n.props && n.props.id === 'cdc-1-0');
  fire(cell, 'click', { shiftKey: true }); // ateşlemeden seç
  root = deckPanel(cfg);
  assert.ok(!find(root, (n) => n.tag === 'button' && /Satırı Adlandır/.test(n.text)), 'prompt düğmesi kalktı');
  const row = find(root, (n) => n.className === 'row' && n.kids[0] && n.kids[0].text === 'Satır Adı');
  assert.ok(row, 'Satır Adı satırı var');
  const input = row.kids[1];
  input.value = 'Giriş';
  fire(input, 'change');
  assert.deepStrictEqual(cfg.clipdeck.decks[0].rowNames, { 1: 'Giriş' });
  input.value = '';
  fire(input, 'change');
  assert.deepStrictEqual(cfg.clipdeck.decks[0].rowNames, {}, 'boş ad varsayılana döndürüyor');
});

test('deste: deste listesi boşsa yazılanlar yapılandırmada kalıyor', () => {
  const cfg = SV.defaultConfig();
  cfg.clipdeck.enabled = true;
  cfg.clipdeck.decks = [];
  deckPanel(cfg);
  assert.strictEqual(cfg.clipdeck.decks.length, 1, 'varsayılan deste yapılandırmaya yazıldı');
  assert.deepStrictEqual([cfg.clipdeck.decks[0].rows, cfg.clipdeck.decks[0].cols], [6, 6]);
});

test('deste: satır adının İngilizcesi var, eski düğmenin kaydı yok', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'shared', 'i18n.js'), 'utf8');
  assert.match(src, /'Satır Adı': 'Row Name'/);
  assert.ok(!/'Satırı Adlandır'/.test(src));
});
