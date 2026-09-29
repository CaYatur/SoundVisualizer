'use strict';
/* Klip destesi PERFORMANS YÜZEYİ (#637): model alanları, genel niceleme ve
 * panelin yeni akışları.
 *
 * Model her panel çiziminde yapılandırmadan yeniden kuruluyor; yeni bir alan
 * `makeSlot`/`makeDeck`/`serializeDeck`te taşınmazsa ilk çizimde sessizce
 * silinirdi. Panel sahte bir DOM ile kuruluyor ve olaylar panelin kendi
 * dinleyicilerine veriliyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;
const CD = require('../src/shared/clipdeck.js');
const TL = require('../src/shared/timeline.js');
window.SVClipDeck = CD;
window.SVTimeline = TL;
window.SVTimelineEdit = require('../src/shared/timeline-edit.js');

// ------------------------------------------------------------------ model

test('model: yuva rengi, sütun adları ve genel niceleme yeniden kurulumdan sağ çıkıyor', () => {
  const deck = CD.makeDeck({
    rows: 2, cols: 2, colNames: { 0: 'Arka Plan' }, rowNames: { 1: 'Nakarat' },
    slots: [{ row: 0, col: 1, type: 'scene', ref: 's', color: '#ABCDEF', quantize: 'global' }],
  });
  const again = CD.makeDeck(JSON.parse(JSON.stringify(CD.serializeDeck(deck))));
  assert.deepStrictEqual(again.colNames, { 0: 'Arka Plan' });
  assert.deepStrictEqual(again.rowNames, { 1: 'Nakarat' });
  const s = CD.getSlot(again, 0, 1);
  assert.strictEqual(s.color, '#abcdef');
  assert.strictEqual(s.quantize, 'global');
  assert.strictEqual(CD.makeSlot({ color: 'url(x)' }).color, '', 'yalnız #rrggbb');
  assert.strictEqual(CD.makeSlot({ quantize: 'çöp' }).quantize, 'bar', 'bilinmeyen kip eski varsayılan');
});

/* "Genel" yuva destenin genel kipiyle ateşleniyor; genel kip değişince
   yuvayı düzenlemeden onun ızgarası da değişiyor. */
test('çalıştırıcı: "genel" yuva destenin kipine göre, kendi kipi olan kendine göre', () => {
  const map = TL.makeTempoMap([{ t: 0, bpm: 120, beatsPerBar: 4 }]); // vuruş 0,5 sn, ölçü 2 sn
  const e = new CD.Engine({ decks: [{ id: 'd', rows: 1, cols: 2, slots: [
    { row: 0, col: 0, ref: 'a', quantize: 'global' },
    { row: 0, col: 1, ref: 'b', quantize: 'beat' },
  ] }] });
  e.globalQuantize = 'bar';
  assert.strictEqual(e.launch('d', 0, 0, 0.3, map).at, 2, 'genel = ölçü');
  assert.strictEqual(e.launch('d', 0, 1, 0.3, map).at, 0.5, 'kendi kipi vuruş');
  e.globalQuantize = 'beat';
  assert.strictEqual(e.launch('d', 0, 0, 0.3, map).at, 0.5, 'genel kip değişti');
  e.globalQuantize = 'off';
  assert.strictEqual(e.launch('d', 0, 0, 0.3, map).at, 0.3, 'anında');
  e.globalQuantize = 'çöp';
  assert.strictEqual(e.quantizeOf({ quantize: 'global' }), 'bar', 'bozuk genel kip ölçüye düşüyor');
  // Satır başlatma da genel kipi çözüyor: satırın en uzun kipi
  e.globalQuantize = 'bar';
  const row = e.launchRow('d', 0, 0.3, map);
  assert.deepStrictEqual(row.map((x) => x.at), [2, 2]);
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
const walk = (n, f) => { if (!n || typeof n !== 'object') return; f(n); (n.kids || []).forEach((k) => walk(k, f)); if (n.node) walk(n.node, f); };
const find = (root, pred) => { let r = null; walk(root, (n) => { if (!r && pred(n)) r = n; }); return r; };
const fire = (n, ev, e) => (n.on[ev] || []).forEach((f) => f(e || {}));
const rowOf = (root, label) => find(root, (n) => n.className === 'row' && n.kids[0] && n.kids[0].text === label);

let DP = null;
function mount(cfg) {
  window.SVPanel = {
    cfg: () => cfg, el,
    row: (label, node) => el('div', { class: 'row' }, [el('label', { text: label }), node]),
    push() {}, apply() {}, rerender() {}, confirm: () => Promise.resolve(true), toast() {}, actions: () => ({ applyScene() {} }),
  };
  window.SVTimelinePanel = null;
  window.SVTransition = { TRANSITION_IDS: ['crossfade', 'wipe'], TRANSITIONS: { crossfade: { label: 'Çapraz Geçiş' }, wipe: { label: 'Silme' } } };
  if (!DP) {
    require('../src/admin/clipdeck-panel.js');
    DP = window.SVClipDeckPanel;
  }
  return DP.panel();
}

function deckCfg(slots) {
  const cfg = SV.defaultConfig();
  cfg.scenes = [{ id: 'sA', name: 'Giriş', data: {} }];
  cfg.clipdeck.enabled = true;
  cfg.clipdeck.decks = [{ id: 'deck', name: 'A', rows: 3, cols: 3, rowNames: {}, colNames: {}, slots: slots || [] }];
  return cfg;
}

test('panel: boş hücre "+" gösteriyor; tıklayınca tür düğmeleri, seçilen tür yuvayı "genel" kipte oluşturuyor', () => {
  const cfg = deckCfg();
  let root = mount(cfg);
  const cell = find(root, (n) => n.props && n.props.id === 'cdc-1-2');
  assert.ok(find(cell, (n) => n.className === 'cd-plus'), 'boş hücrede +');
  fire(cell, 'click', {});
  root = mount(cfg);
  const scene = find(root, (n) => n.tag === 'button' && /🎬 Sahne/.test(n.text));
  assert.ok(scene, 'tür düğmesi');
  fire(scene, 'click');
  const s = cfg.clipdeck.decks[0].slots;
  assert.strictEqual(s.length, 1);
  assert.deepStrictEqual([s[0].row, s[0].col, s[0].type, s[0].quantize], [1, 2, 'scene', 'global']);
});

test('panel: dolu hücre adı kaynağın adı, rengi ve kısa niceleme/takip bilgisi', () => {
  const cfg = deckCfg([{ row: 0, col: 0, type: 'scene', ref: 'sA', quantize: 'bar2', follow: 'next', dur: 8, color: '#112233' }]);
  const root = mount(cfg);
  const cell = find(root, (n) => n.props && n.props.id === 'cdc-0-0');
  assert.strictEqual(find(cell, (n) => n.className === 'cd-name').text, '🎬 Giriş', 'sahne kimliği değil adı');
  assert.strictEqual(find(cell, (n) => n.className === 'cd-meta').text, '2▮ · ↓ · 8s');
  assert.strictEqual(find(cell, (n) => n.className === 'cd-color').props.style, 'background:#112233');
  assert.ok(find(cell, (n) => n.className === 'cd-prog'), 'ilerleme çubuğu');
});

test('panel: sütun adı yapılandırmaya yazılıyor; boş ad harfe dönüyor', () => {
  const cfg = deckCfg();
  const root = mount(cfg);
  const heads = [];
  walk(root, (n) => { if (n.className === 'cd-colname') heads.push(n); });
  assert.strictEqual(heads.length, 3);
  assert.deepStrictEqual(heads.map((h) => h.props.placeholder), ['A', 'B', 'C']);
  heads[1].value = 'Işık';
  fire(heads[1], 'change');
  assert.deepStrictEqual(cfg.clipdeck.decks[0].colNames, { 1: 'Işık' });
  heads[1].value = '  ';
  fire(heads[1], 'change');
  assert.deepStrictEqual(cfg.clipdeck.decks[0].colNames, {});
});

test('panel: geçiş türü serbest metin değil seçim; hedef yuva satır ve sütun seçimi', () => {
  const cfg = deckCfg([{ row: 0, col: 0, type: 'scene', ref: 'sA', follow: 'goto', followTarget: '2:1', dur: 4 }]);
  DP._select({ row: 0, col: 0 });
  const root = mount(cfg);
  const tr = rowOf(root, 'Geçiş Türü').kids[1];
  assert.strictEqual(tr.tag, 'select');
  assert.deepStrictEqual(tr.kids.map((o) => o.props.value), ['', 'crossfade', 'wipe']);
  tr.value = 'wipe';
  fire(tr, 'change');
  assert.strictEqual(cfg.clipdeck.decks[0].slots[0].transition, 'wipe');
  const target = rowOf(mount(cfg), 'Hedef Yuva').kids[1];
  const [rSel, cSel] = target.kids;
  const picked = (sel) => sel.kids.find((o) => o.selected).props.value;
  assert.deepStrictEqual([picked(rSel), picked(cSel)], ['2', '1'], 'kayıtlı hedef seçili');
  // Sahte DOM'da seçim kutusunun değeri seçili seçenekten dolmuyor; gerçekte dolar
  cSel.value = picked(cSel);
  rSel.value = '1';
  fire(rSel, 'change');
  assert.strictEqual(cfg.clipdeck.decks[0].slots[0].followTarget, '1:1');
});

test('panel: süresiz yuvada takip eylemi uyarısı', () => {
  const cfg = deckCfg([{ row: 0, col: 0, type: 'scene', ref: 'sA', follow: 'next' }]);
  DP._select({ row: 0, col: 0 });
  const root = mount(cfg);
  assert.ok(find(root, (n) => /Takip eylemi süre dolunca çalışır/.test(n.text)));
});

test('panel: başlık çubuğu genel nicelemeyi yazıyor ve çalıştırıcıya geçiriyor', () => {
  const cfg = deckCfg();
  const root = mount(cfg);
  const q = find(find(root, (n) => n.className === 'cd-q'), (n) => n.tag === 'select');
  assert.ok(!q.kids.some((o) => o.props.value === 'global'), 'genelin içinde "genel" yok');
  q.value = 'beat';
  fire(q, 'change');
  assert.strictEqual(cfg.clipdeck.defaultQuantize, 'beat');
  assert.strictEqual(DP.engine().globalQuantize, 'beat');
});

test('metinlerin İngilizcesi var; eski girdiler kaldırıldı', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'i18n.js'), 'utf8');
  for (const s of ['Genel (destenin)', 'Boş yuva — eklemek için tıklayın', '▶ Ateşle', '🗑 Yuvayı Boşalt', 'Hedef Yuva', 'Deste, ızgara ve kayıt', 'Genel ayar (Geçiş kartı)']) {
    assert.ok(src.includes("'" + s + "':"), 'sözlükte yok: ' + s);
  }
  for (const s of ['Hedef (satır:sütun)', 'boş = mevcut ayar', 'Boş yuva — düzenlemek için tıklayın', 'Izgara ve kayıt']) {
    assert.ok(!src.includes("'" + s + "':"), 'eski girdi duruyor: ' + s);
  }
});
