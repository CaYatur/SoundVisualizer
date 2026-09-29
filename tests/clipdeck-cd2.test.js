'use strict';
/* Klip destesi CD-2 (#637): ateşleme kipleri (tetik / aç-kapa / kapı),
 * yuva taşıma ve kopyalama, panelde klavye, birden çok deste.
 *
 * Motor doğrudan; panel sahte bir DOM ile, olaylar panelin kendi
 * dinleyicilerine verilerek (clipdeck-grid.test.js ile aynı düzen).
 */
const test = require('node:test');
const assert = require('node:assert');
global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;
const CD = require('../src/shared/clipdeck.js');
const TL = require('../src/shared/timeline.js');
window.SVClipDeck = CD;
window.SVTimeline = TL;
window.SVTimelineEdit = require('../src/shared/timeline-edit.js');

const MAP = TL.makeTempoMap([{ t: 0, bpm: 120, beatsPerBar: 4 }]);

function engine(slots) {
  const e = new CD.Engine({ decks: [{ id: 'd', rows: 4, cols: 2, slots }] });
  const log = [];
  e.on((type, p) => log.push(type + (p && p.slot ? ':' + p.slot.ref : '')));
  return { e, log, playing: () => e.activeSlots().map((a) => a.slot.ref) };
}

// ------------------------------------------------------------------ motor

test('model: ateşleme kipi varsayılanı tetik; bilinmeyen kip tetiğe düşüyor; kayıttan sağ çıkıyor', () => {
  assert.strictEqual(CD.makeSlot({}).launch, 'trigger');
  assert.strictEqual(CD.makeSlot({ launch: 'çöp' }).launch, 'trigger');
  const deck = CD.makeDeck({ rows: 1, cols: 1, slots: [{ row: 0, col: 0, ref: 'x', launch: 'gate' }] });
  const again = CD.makeDeck(JSON.parse(JSON.stringify(CD.serializeDeck(deck))));
  assert.strictEqual(CD.getSlot(again, 0, 0).launch, 'gate');
});

test('tetik: her basış yeniden ateşler (eski davranış)', () => {
  const { e, log } = engine([{ row: 0, col: 0, ref: 'a', quantize: 'off' }]);
  e.press('d', 0, 0, 0, MAP); e.update(0, MAP);
  e.press('d', 0, 0, 1, MAP); e.update(1, MAP);
  assert.deepStrictEqual(log.filter((l) => l.startsWith('fire')), ['fire:a', 'fire:a']);
});

test('aç/kapa: çalarken ikinci basış durdurur; hazırlanırken basış iptal eder', () => {
  const { e, playing } = engine([{ row: 0, col: 0, ref: 't', quantize: 'off', launch: 'toggle' }, { row: 1, col: 0, ref: 'q', quantize: 'bar', launch: 'toggle' }]);
  e.press('d', 0, 0, 0, MAP); e.update(0, MAP);
  assert.deepStrictEqual(playing(), ['t']);
  e.press('d', 0, 0, 0.5, MAP);
  assert.deepStrictEqual(playing(), [], 'ikinci basış durdurdu');
  e.press('d', 1, 0, 0.5, MAP);
  assert.strictEqual(e.armed.length, 1, 'ölçüye hazırlandı');
  e.press('d', 1, 0, 0.7, MAP);
  assert.strictEqual(e.armed.length, 0, 'hazırlanırken basış iptal etti');
  e.update(2, MAP);
  assert.deepStrictEqual(playing(), [], 'iptal edilen ateşlenmedi');
});

test('kapı: basılı tutulurken çalar, bırakınca sütunda önceki yuvaya döner; önceki yoksa sütun durur', () => {
  const { e, playing, log } = engine([
    { row: 0, col: 0, ref: 'a', quantize: 'off' },
    { row: 1, col: 0, ref: 'flash', quantize: 'off', launch: 'gate' },
    { row: 0, col: 1, ref: 'g2', quantize: 'off', launch: 'gate' },
  ]);
  e.press('d', 0, 0, 0, MAP); e.update(0, MAP);
  e.press('d', 1, 0, 1, MAP); e.update(1, MAP);
  assert.deepStrictEqual(playing(), ['flash']);
  assert.strictEqual(e.release('d', 1, 0, 1.4), 'back');
  assert.deepStrictEqual(playing(), ['a'], 'önceki yuvaya döndü');
  assert.deepStrictEqual(log.filter((l) => l.startsWith('fire')), ['fire:a', 'fire:flash', 'fire:a']);
  // Boş sütunda kapı: bırakınca sütun duruyor
  e.press('d', 0, 1, 2, MAP); e.update(2, MAP);
  assert.strictEqual(e.release('d', 0, 1, 2.2), 'stopped');
  assert.deepStrictEqual(playing(), ['a']);
  // Tetik yuvasında bırakış hiçbir şey yapmıyor
  assert.strictEqual(e.release('d', 0, 0, 3), null);
});

test('kapı: hazırlanırken bırakmak iptal eder; arada sütunda başka yuva ateşlendiyse ona dokunmaz', () => {
  const { e, playing } = engine([
    { row: 0, col: 0, ref: 'a', quantize: 'off' },
    { row: 1, col: 0, ref: 'g', quantize: 'bar', launch: 'gate' },
    { row: 2, col: 0, ref: 'c', quantize: 'off' },
  ]);
  e.press('d', 1, 0, 0.3, MAP);
  assert.strictEqual(e.release('d', 1, 0, 0.5), 'cancelled');
  e.update(3, MAP);
  assert.deepStrictEqual(playing(), [], 'iptal edilen kapı ateşlenmedi');
  e.press('d', 1, 0, 3.5, MAP); e.update(4, MAP); // ölçü başında (4 sn) çalar
  e.press('d', 2, 0, 4.1, MAP); e.update(4.1, MAP); // bu arada C
  assert.strictEqual(e.release('d', 1, 0, 4.3), null);
  assert.deepStrictEqual(playing(), ['c'], 'C yerinde kaldı');
});

test('yuva taşıma: boşa taşı, doluyla yer değiştir, kopyala; aynı hücre ve ızgara dışı reddediliyor', () => {
  const deck = CD.makeDeck({ rows: 2, cols: 2, slots: [{ row: 0, col: 0, ref: 'a' }, { row: 1, col: 1, ref: 'b' }] });
  const at = (r, c) => (CD.getSlot(deck, r, c) || {}).ref || null;
  assert.ok(CD.moveSlot(deck, { row: 0, col: 0 }, { row: 0, col: 1 }, false));
  assert.deepStrictEqual([at(0, 0), at(0, 1)], [null, 'a']);
  assert.ok(CD.moveSlot(deck, { row: 0, col: 1 }, { row: 1, col: 1 }, false));
  assert.deepStrictEqual([at(0, 1), at(1, 1)], ['b', 'a'], 'yer değiştirdi, kayıp yok');
  assert.ok(CD.moveSlot(deck, { row: 1, col: 1 }, { row: 0, col: 0 }, true));
  assert.deepStrictEqual([at(1, 1), at(0, 0)], ['a', 'a'], 'kopya');
  assert.strictEqual(CD.getSlot(deck, 0, 0).row, 0, 'kopyanın konumu yeni hücre');
  assert.strictEqual(CD.moveSlot(deck, { row: 0, col: 0 }, { row: 0, col: 0 }, false), false);
  assert.strictEqual(CD.moveSlot(deck, { row: 0, col: 0 }, { row: 5, col: 0 }, false), false);
  assert.strictEqual(CD.moveSlot(deck, { row: 1, col: 0 }, { row: 0, col: 0 }, false), false, 'boş kaynak');
});

// ------------------------------------------------------------------ panel

function el(tag, props, kids) {
  const n = { tag, props: props || {}, kids: [], on: {}, attrs: {}, style: {}, parent: null, isConnected: true, childNodes: [] };
  n.className = (props && props.class) || '';
  n.text = (props && props.text) || '';
  n.value = (props && props.value) || '';
  n.appendChild = (c) => { if (c) { c.parent = n; n.kids.push(c); } return c; };
  n.addEventListener = (ev, f) => { (n.on[ev] = n.on[ev] || []).push(f); };
  n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
  n.getAttribute = (k) => n.attrs[k];
  n.querySelector = () => null;
  n.querySelectorAll = () => [];
  n.classList = { toggle() {}, add() {}, remove() {}, contains: () => false };
  Object.defineProperty(n, 'textContent', { get: () => n.text, set: (v) => { n.text = v; } });
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}
const walk = (n, f) => { if (!n || typeof n !== 'object') return; f(n); (n.kids || []).forEach((k) => walk(k, f)); };
const find = (root, pred) => { let r = null; walk(root, (n) => { if (!r && pred(n)) r = n; }); return r; };
const fire = (n, ev, e) => (n.on[ev] || []).forEach((f) => f(e || {}));
const winOn = {};
window.addEventListener = (ev, f) => { (winOn[ev] = winOn[ev] || []).push(f); };
window.removeEventListener = (ev, f) => { winOn[ev] = (winOn[ev] || []).filter((x) => x !== f); };

let DP = null;
function mount(cfg) {
  window.SVPanel = {
    cfg: () => cfg, el,
    row: (label, node) => el('div', { class: 'row' }, [el('label', { text: label }), node]),
    push() {}, apply() {}, rerender() {}, confirm: () => Promise.resolve(true), toast() {}, actions: () => ({ applyScene() {} }),
  };
  window.SVTimelinePanel = null;
  window.SVTransition = { TRANSITION_IDS: [], TRANSITIONS: {} };
  if (!DP) {
    require('../src/admin/clipdeck-panel.js');
    DP = window.SVClipDeckPanel;
  }
  return DP.panel();
}
function deckCfg(slots) {
  const cfg = SV.defaultConfig();
  cfg.scenes = [{ id: 'sA', name: 'A', data: {} }, { id: 'sB', name: 'B', data: {} }];
  cfg.clipdeck.enabled = true;
  cfg.clipdeck.defaultQuantize = 'off';
  cfg.clipdeck.decks = [{ id: 'deck', name: 'A', rows: 3, cols: 3, rowNames: {}, colNames: {}, slots: slots || [] }];
  cfg.clipdeck.activeDeck = 'deck';
  return cfg;
}
const key = (k, down, extra) => DP._key(Object.assign({ key: k, target: {}, preventDefault() {} }, extra), down);

test('panel klavyesi: 1-9 satır seçiyor, harf o satırın yuvasına basıyor, kapı tuş bırakılınca dönüyor', () => {
  const cfg = deckCfg([
    { row: 1, col: 0, type: 'scene', ref: 'sA', quantize: 'off' },
    { row: 1, col: 1, type: 'scene', ref: 'sB', quantize: 'off', launch: 'gate' },
  ]);
  mount(cfg);
  const e = DP.engine();
  e.stopAll();
  key('2', true);
  assert.strictEqual(DP._cursor(), 1);
  key('a', true);
  e.update(0, MAP);
  assert.deepStrictEqual(e.activeSlots().map((a) => a.slot.ref), ['sA']);
  key('b', true);
  key('b', true, { repeat: true }); // tekrar ikinci basış sayılmıyor
  e.update(0.1, MAP);
  assert.deepStrictEqual(e.activeSlots().map((a) => a.slot.ref).sort(), ['sA', 'sB']);
  // Bırakış pencereden dinleniyor: basış paneli yeniden çiziyor, ızgara sökülüyor
  (winOn.keyup || []).slice().forEach((f) => f({ key: 'b' }));
  assert.deepStrictEqual(e.activeSlots().map((a) => a.slot.ref), ['sA'], 'kapı: B sütunu önceki yuvası olmadığı için durdu');
  // Metin kutusunda yazarken karışmıyor
  key('3', true, { target: { tagName: 'INPUT' } });
  assert.strictEqual(DP._cursor(), 1);
});

test('panel sürükle-bırak: yuva taşınıyor; Ctrl ile kopyalanıyor', () => {
  const cfg = deckCfg([{ row: 0, col: 0, type: 'scene', ref: 'sA' }]);
  let root = mount(cfg);
  const cell = (r, c) => find(root, (n) => n.props && n.props.id === 'cdc-' + r + '-' + c);
  const dt = { setData() {}, effectAllowed: '', dropEffect: '' };
  fire(cell(0, 0), 'dragstart', { dataTransfer: dt });
  fire(cell(2, 1), 'dragover', { dataTransfer: dt, preventDefault() {} });
  fire(cell(2, 1), 'drop', { dataTransfer: dt, preventDefault() {} });
  const refs = () => cfg.clipdeck.decks[0].slots.map((s) => s.row + ':' + s.col + '=' + s.ref).sort();
  assert.deepStrictEqual(refs(), ['2:1=sA']);
  root = mount(cfg);
  fire(cell(2, 1), 'dragstart', { dataTransfer: dt });
  fire(cell(0, 2), 'drop', { dataTransfer: dt, preventDefault() {}, ctrlKey: true });
  assert.deepStrictEqual(refs(), ['0:2=sA', '2:1=sA']);
  assert.strictEqual(cell(1, 1).attrs.draggable, undefined, 'boş hücre sürüklenmiyor');
});

test('panel desteler: ＋ yeni deste açıyor, sekme geçiyor, çoğaltma ve silme', async () => {
  const cfg = deckCfg([{ row: 0, col: 0, type: 'scene', ref: 'sA' }]);
  let root = mount(cfg);
  fire(find(root, (n) => n.className === 'cd-tab add'), 'click');
  assert.strictEqual(cfg.clipdeck.decks.length, 2);
  const b = cfg.clipdeck.decks[1];
  assert.strictEqual(cfg.clipdeck.activeDeck, b.id);
  assert.notStrictEqual(b.id, 'deck');
  assert.strictEqual(b.name, 'B');
  root = mount(cfg);
  fire(find(root, (n) => /^cd-tab( |$)/.test(n.className) && n.text === 'A'), 'click');
  assert.strictEqual(cfg.clipdeck.activeDeck, 'deck');
  root = mount(cfg);
  fire(find(root, (n) => n.tag === 'button' && /Desteyi Çoğalt/.test(n.text)), 'click');
  assert.strictEqual(cfg.clipdeck.decks.length, 3);
  assert.deepStrictEqual(cfg.clipdeck.decks[2].slots.map((s) => s.ref), ['sA'], 'kopya yuvaları taşıyor');
  assert.notStrictEqual(cfg.clipdeck.decks[2].slots, cfg.clipdeck.decks[0].slots, 'derin kopya');
  root = mount(cfg);
  fire(find(root, (n) => n.tag === 'button' && /Desteyi Sil/.test(n.text)), 'click');
  await new Promise((r) => setTimeout(r, 5));
  assert.strictEqual(cfg.clipdeck.decks.length, 2);
  assert.ok(cfg.clipdeck.decks.some((d) => d.id === cfg.clipdeck.activeDeck));
});
