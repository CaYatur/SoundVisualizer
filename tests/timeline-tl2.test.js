'use strict';
/* Zaman çizelgesi TL-2 (#636): çoklu seçim, kutu seçimi, grup işlemleri,
 * cetvelde döngü ayracı ve işaret sürükleme, klip geçiş tutamacı, geçişin
 * gerçekten uygulanması ve tam pencere düzenleyici.
 *
 * Saf işlemler (shared/timeline-edit.js) doğrudan; panel sahte bir DOM ve
 * sahte bir tuvalle, fare olayları panelin kendi dinleyicilerine verilerek
 * sınanıyor (timeline-deck-stability.test.js ile aynı düzen).
 */
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

// ------------------------------------------------------------------ saf işlemler

function model() {
  return TL.makeTimeline({
    tracks: [
      { id: 't1', kind: 'clip', clips: [{ id: 'a', start: 1, dur: 2 }, { id: 'b', start: 5, dur: 2 }] },
      { id: 't2', kind: 'automation', keys: [] },
      { id: 't3', kind: 'clip', clips: [{ id: 'c', start: 2, dur: 4 }] },
    ],
  });
}

test('kutu seçimi: aralığa değen ve şerit aralığındaki klipler; otomasyon şeridi atlanıyor', () => {
  const tl = model();
  assert.deepStrictEqual(TE.clipsInRect(tl, 0, 2.5, 0, 2).map((r) => r.clipId), ['a', 'c']);
  assert.deepStrictEqual(TE.clipsInRect(tl, 4.5, 0, 0, 0).map((r) => r.clipId), ['a'], 'ters sıralı sınırlar');
  assert.deepStrictEqual(TE.clipsInRect(tl, 3, 5, 0, 0).map((r) => r.clipId), [], 'yalnız değen: 3..5 arası boş');
});

test('grup kayması: hiçbir klip sıfırın soluna geçmiyor, grubun biçimi korunuyor', () => {
  assert.strictEqual(TE.groupDelta([1, 5], -3), -1);
  assert.strictEqual(TE.groupDelta([1, 5], 2), 2);
  assert.strictEqual(TE.groupDelta([], 3), 0);
});

test('kopyala/yapıştır: göreli şerit ve başlangıç korunuyor; uygun olmayan şerit tabana düşüyor', () => {
  const tl = model();
  const board = TE.copyGroup([
    { trackIndex: 0, clip: tl.tracks[0].clips[1] }, // b @5
    { trackIndex: 2, clip: tl.tracks[2].clips[0] }, // c @2
  ]);
  assert.strictEqual(board.span, 5, '2..7');
  const placed = TE.pasteGroup(tl, board, 10, 0);
  assert.deepStrictEqual(placed.map((p) => [p.trackIndex, p.clip.start]), [[0, 13], [2, 10]]);
  assert.ok(placed.every((p) => p.clip.id !== 'b' && p.clip.id !== 'c'), 'yeni kimlik');
  // Taban 1 (otomasyon) → göreli 1+2=3 yok: ikisi de tabana düşüyor (panel onları yok sayar)
  const odd = TE.pasteGroup(tl, board, 0, 2);
  assert.deepStrictEqual(odd.map((p) => p.trackIndex), [2, 2], '2+2=4 yok → taban');
  // Kilitli şerit de uygun değil
  tl.tracks[2].locked = true;
  assert.deepStrictEqual(TE.pasteGroup(tl, board, 0, 0).map((p) => p.trackIndex), [0, 0]);
});

test('grubu çoğalt: kopyalar grubun hemen ardına, aynı şeritlere', () => {
  const tl = model();
  const out = TE.duplicateGroup(tl, [{ trackIndex: 0, clip: tl.tracks[0].clips[0] }, { trackIndex: 2, clip: tl.tracks[2].clips[0] }]);
  // Grup 1..6, uzunluk 5: kopyalar 6'dan başlıyor
  assert.deepStrictEqual(out.map((p) => [p.trackIndex, p.clip.start]), [[0, 6], [2, 7]]);
});

// ------------------------------------------------------------------ panel

let lastFocused = null;
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
  n.focus = () => { lastFocused = n; };
  Object.defineProperty(n, 'textContent', { get: () => n.text, set: (v) => { n.text = v; } });
  if (tag === 'canvas') {
    n.clientWidth = 800;
    n.width = 0;
    n.height = 0;
    n.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 200 });
    n.getContext = () => new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  }
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}
const walk = (n, f) => { if (!n || typeof n !== 'object') return; f(n); (n.kids || []).forEach((k) => walk(k, f)); };
const find = (root, pred) => { let r = null; walk(root, (n) => { if (!r && pred(n)) r = n; }); return r; };
const fire = (n, ev, e) => (n.on[ev] || []).forEach((f) => f(e || {}));

const winOn = {};
window.addEventListener = (ev, f) => { (winOn[ev] = winOn[ev] || []).push(f); };
const winFire = (ev, e) => (winOn[ev] || []).forEach((f) => f(e));
const intervals = [];
const realSetInterval = global.setInterval;
global.setInterval = (f, ms) => { const id = realSetInterval(f, ms); intervals.push(id); return id; };
test.after(() => intervals.forEach((id) => clearInterval(id)));
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
global.document = { documentElement: {}, querySelector: () => null, body: { classList: { toggle() {} } } };

// 60 px/sn, kaydırma yok, yakalama kapalı; cetvel 38, şerit 40 piksel
const RULER = 38;
const TRACK = 40;
const X = (t) => t * 60;
const laneY = (i) => RULER + i * TRACK + TRACK / 2;

const fired = [];
function setup(cfg) {
  window.SVPanel = {
    cfg: () => cfg, el,
    row: (label, node) => el('div', { class: 'row' }, [el('label', { text: label }), node]),
    push() {}, apply() {}, rerender() {}, confirm: () => Promise.resolve(true), toast() {}, actions: () => ({ applyScene() {} }),
  };
  window.SVClipDeckPanel = {
    applyRef: (type, ref, target) => fired.push(target ? ['ref', type, ref, target] : ['ref', type, ref]),
    applyFaded: (type, ref, fade, target) => fired.push(target ? ['faded', type, ref, fade, target] : ['faded', type, ref, fade]),
    // Medya klipleri destenin seçicisini ve hedef listesini kullanıyor
    targetOptions: (t) => (t === 'shader' ? [['vis', 'Görselleştirici (ana)'], ['layer:lb', 'Katman: Zemin']] : []),
    resolveTarget: (t, target) => target || 'vis',
    mediaPicker: () => el('div', { class: 'picker', text: 'seçici' }),
    slotLabel: (s) => (s.type === 'image' ? 'Görsel' : s.ref),
    refOptions: (t) => (t === 'action' ? [['nextScene', 'Sonraki Sahne']] : null),
  };
}

function cfgOf() {
  const cfg = SV.defaultConfig();
  cfg.scenes = [{ id: 'sA', name: 'A', data: {} }, { id: 'sB', name: 'B', data: {} }];
  Object.assign(cfg.timeline, {
    enabled: true, snap: 'off', zoom: 60, scroll: 0, followPlayhead: false,
    loop: { enabled: false, start: 2, end: 4 },
    markers: [{ id: 'm1', t: 3, name: 'Nakarat' }],
    tracks: [
      { id: 'tr1', kind: 'clip', name: 'P1', clips: [
        { id: 'cA', type: 'scene', ref: 'sA', start: 1, dur: 2 },
        { id: 'cB', type: 'scene', ref: 'sB', start: 5, dur: 2 },
      ] },
      { id: 'tr2', kind: 'clip', name: 'P2', clips: [{ id: 'cC', type: 'scene', ref: 'sA', start: 2, dur: 2 }] },
    ],
  });
  return cfg;
}

let TP = null;
async function mount(cfg) {
  setup(cfg);
  if (!TP) {
    require('../src/admin/timeline-panel.js');
    TP = window.SVTimelinePanel;
  }
  TP._select(null);
  const host = el('div', { class: 'host' });
  host.appendChild(TP.panel());
  await wait(5);
  const cv = find(host, (n) => n.tag === 'canvas');
  return { host, cv };
}
const clip = (cfg, id) => cfg.timeline.tracks.flatMap((t) => t.clips || []).find((c) => c.id === id);

test('panel: Ctrl+tık klibi seçime ekliyor; grup birlikte sürükleniyor ve sıfırda duruyor', async () => {
  const cfg = cfgOf();
  const { cv } = await mount(cfg);
  fire(cv, 'mousedown', { clientX: X(2), clientY: laneY(0), detail: 1 });
  winFire('mouseup', {});
  fire(cv, 'mousedown', { clientX: X(3), clientY: laneY(1), detail: 1, ctrlKey: true });
  winFire('mouseup', {});
  assert.deepStrictEqual(TP._multi().map((m) => m.clipId).sort(), ['cA', 'cC']);
  // Gruba tıklayıp sola sürükle: A 1'den, C 2'den; en fazla 1 sn sola gidebilirler
  fire(cv, 'mousedown', { clientX: X(3), clientY: laneY(1), detail: 1 });
  winFire('mousemove', { clientX: X(0.5), clientY: laneY(1) });
  winFire('mouseup', {});
  assert.deepStrictEqual([clip(cfg, 'cA').start, clip(cfg, 'cC').start], [0, 1], 'biçim korunarak sıfıra dayandı');
  assert.strictEqual(clip(cfg, 'cB').start, 5, 'seçili olmayan yerinde');
});

test('panel: boş şeritte sürüklemek kutu seçimi yapıyor; Del hepsini siliyor, geri al getiriyor', async () => {
  const cfg = cfgOf();
  const { cv } = await mount(cfg);
  // 0,2 sn'den 4,5 sn'ye, iki şerit boyunca (0,2'de klip yok: boş şerit)
  fire(cv, 'mousedown', { clientX: X(0.2), clientY: laneY(0), detail: 1 });
  winFire('mousemove', { clientX: X(4.5), clientY: laneY(1) });
  winFire('mouseup', {});
  assert.deepStrictEqual(TP._multi().map((m) => m.clipId).sort(), ['cA', 'cC']);
  TP._key({ key: 'Delete', target: {}, preventDefault() {}, stopPropagation() {} });
  assert.deepStrictEqual(cfg.timeline.tracks.map((t) => t.clips.map((c) => c.id)), [['cB'], []]);
  TP.undo();
  assert.deepStrictEqual(cfg.timeline.tracks.map((t) => t.clips.map((c) => c.id)), [['cA', 'cB'], ['cC']]);
});

test('panel: Ctrl+A hepsini seçiyor; Ctrl+D grubu ardına çoğaltıyor', async () => {
  const cfg = cfgOf();
  await mount(cfg);
  const key = (k, extra) => TP._key(Object.assign({ key: k, target: {}, preventDefault() {}, stopPropagation() {} }, extra));
  key('a', { ctrlKey: true });
  assert.strictEqual(TP._multi().length, 3);
  key('d', { ctrlKey: true });
  // Grup 1..7 (uzunluk 6): kopyalar 7'den
  assert.deepStrictEqual(cfg.timeline.tracks[0].clips.map((c) => c.start), [1, 5, 7, 11]);
  assert.deepStrictEqual(cfg.timeline.tracks[1].clips.map((c) => c.start), [2, 8]);
  assert.strictEqual(TP._multi().length, 3, 'yeni grup seçili');
});

test('panel: döngü ayracının sağ kenarı, ortası ve Shift+sürükleme', async () => {
  const cfg = cfgOf();
  const { cv } = await mount(cfg);
  // Sağ kenar 4 sn → 6 sn
  fire(cv, 'mousedown', { clientX: X(4), clientY: 2, detail: 1 });
  winFire('mousemove', { clientX: X(6), clientY: 2 });
  winFire('mouseup', {});
  assert.deepStrictEqual([cfg.timeline.loop.start, cfg.timeline.loop.end], [2, 6]);
  // Ortadan taşı: uzunluk korunuyor
  fire(cv, 'mousedown', { clientX: X(3), clientY: 2, detail: 1 });
  winFire('mousemove', { clientX: X(4), clientY: 2 });
  winFire('mouseup', {});
  assert.deepStrictEqual([cfg.timeline.loop.start, cfg.timeline.loop.end], [3, 7]);
  // Shift+sürükle yeni bölge çiziyor ve açıyor
  fire(cv, 'mousedown', { clientX: X(9), clientY: 20, detail: 1, shiftKey: true });
  winFire('mousemove', { clientX: X(8), clientY: 20 });
  winFire('mouseup', {});
  assert.deepStrictEqual(cfg.timeline.loop, { enabled: true, start: 8, end: 9 });
});

test('panel: işaret sürüklenince taşınıyor, tıklanınca kafa ona gidiyor', async () => {
  const cfg = cfgOf();
  const { cv } = await mount(cfg);
  const flagY = RULER - 6;
  fire(cv, 'mousedown', { clientX: X(3) + 2, clientY: flagY, detail: 1 });
  winFire('mousemove', { clientX: X(4.5) + 2, clientY: flagY });
  winFire('mouseup', {});
  assert.strictEqual(cfg.timeline.markers[0].t, 4.5);
  TP.seek(0);
  fire(cv, 'mousedown', { clientX: X(4.5) + 2, clientY: flagY, detail: 1 });
  winFire('mouseup', {});
  assert.strictEqual(TP.transport().time, 4.5, 'tıklama işarete götürdü');
  assert.strictEqual(cfg.timeline.markers[0].t, 4.5, 'tıklama işareti oynatmadı');
});

test('panel: sol üst tutamaç geçişi ayarlıyor; ateşleme geçişi kullanıyor', async () => {
  const cfg = cfgOf();
  const { cv } = await mount(cfg);
  const top = RULER + 4;
  fire(cv, 'mousedown', { clientX: X(5) + 1, clientY: top + 2, detail: 1 });
  winFire('mousemove', { clientX: X(5.75), clientY: top + 2 });
  winFire('mouseup', {});
  assert.strictEqual(clip(cfg, 'cB').fade, 0.75);
  assert.strictEqual(clip(cfg, 'cB').start, 5, 'tutamaç klibi taşımadı');
  // Geçişi olan klip applyFaded ile, olmayan applyRef ile ateşleniyor
  // Cetvele tıklamak (sürükleme) o andaki klipleri uygular
  fired.length = 0;
  TP.stop();
  fire(cv, 'mousedown', { clientX: X(5.5), clientY: 16, detail: 1 });
  winFire('mouseup', {});
  fire(cv, 'mousedown', { clientX: X(1.5), clientY: 16, detail: 1 });
  winFire('mouseup', {});
  assert.deepStrictEqual(fired, [['faded', 'scene', 'sB', 0.75], ['ref', 'scene', 'sA']]);
});

test('panel: F tam pencereyi açıyor, Esc kapatıyor; Esc tam pencere dışında yutulmuyor', async () => {
  const cfg = cfgOf();
  await mount(cfg);
  let prevented = 0;
  const key = (k) => TP._key({ key: k, target: {}, preventDefault() { prevented++; }, stopPropagation() {} });
  key('f');
  assert.strictEqual(TP._full(), true);
  key('Escape');
  assert.strictEqual(TP._full(), false);
  prevented = 0;
  key('Escape');
  assert.strictEqual(prevented, 0, 'genel Esc kısayoluna bırakıldı');
});

/* Oynarken klip sahne uyguluyor ve panel yeniden çiziliyor; düzenleyici
   odaktaydıysa YENİ düzenleyici odağı almalı. Önce odak BODY'ye düşüyor ve
   Boşluk artık duraklatmıyordu (uygulamada ölçüldü). */
test('panel: odaktaki düzenleyici yeniden çizimden sonra da odakta', async () => {
  const cfg = cfgOf();
  const first = await mount(cfg);
  const ed1 = find(first.host, (n) => n.className === 'tl-editor');
  fire(ed1, 'focus');
  lastFocused = null;
  ed1.isConnected = false; // yeniden çizim eskisini söküyor
  fire(ed1, 'blur');
  const second = await mount(cfg);
  const ed2 = find(second.host, (n) => n.className === 'tl-editor');
  assert.strictEqual(lastFocused, ed2, 'yeni düzenleyici odaklandı');
  // Kullanıcı başka yere tıklarsa (düzenleyici yerinde) odak geri çalınmıyor
  fire(ed2, 'blur');
  await wait(5);
  lastFocused = null;
  const third = await mount(cfg);
  assert.strictEqual(lastFocused, null, 'bilinçli odak kaybına saygı');
  void third;
});

/* Medya ve eylem klipleri (#636): klibin hedefi var ve ateşlemeye gidiyor;
   denetçi destenin seçicisini ve hedef listesini kullanıyor. Önceki not
   ("henüz uygulanmaz") CD-3'ten beri yanlıştı: klipler ilk uygun hedefe
   uygulanıyordu, yalnız hedef seçilemiyordu. */
test('model: klibin hedefi kayıttan sağ çıkıyor, 120 karakterle sınırlı', () => {
  const c = TL.makeClip({ type: 'shader', ref: 'pb', target: 'layer:lb' });
  assert.strictEqual(c.target, 'layer:lb');
  assert.strictEqual(TL.makeClip({}).target, '');
  assert.strictEqual(TL.makeClip({ target: 5 }).target, '');
  assert.strictEqual(TL.makeClip({ target: 'x'.repeat(300) }).target.length, 120);
});

test('panel: medya klibi kendi hedefiyle ateşleniyor; denetçide Hedef satırı', async () => {
  const cfg = cfgOf();
  cfg.timeline.tracks[0].clips[0] = { id: 'cA', type: 'shader', ref: 'pb', target: 'layer:lb', start: 1, dur: 2 };
  cfg.timeline.tracks[0].clips[1] = { id: 'cB', type: 'image', ref: 'data:image/png;base64,QUFB', start: 5, dur: 2, fade: 0.5 };
  const { host, cv } = await mount(cfg);
  fired.length = 0;
  TP.stop();
  fire(cv, 'mousedown', { clientX: X(1.5), clientY: 16, detail: 1 });
  winFire('mouseup', {});
  fire(cv, 'mousedown', { clientX: X(5.5), clientY: 16, detail: 1 });
  winFire('mouseup', {});
  assert.deepStrictEqual(fired, [['ref', 'shader', 'pb', 'layer:lb'], ['faded', 'image', 'data:image/png;base64,QUFB', 0.5]]);
  // Denetçi: seçici ve hedef; eski "uygulanmaz" notu yok
  fire(cv, 'mousedown', { clientX: X(1.5), clientY: laneY(0), detail: 1 });
  winFire('mouseup', {});
  const all = [];
  walk(host, (n) => all.push(n));
  assert.ok(all.some((n) => n.tag === 'label' && n.text === 'Hedef'), 'Hedef satırı');
  assert.ok(all.some((n) => n.className === 'picker'), 'destenin seçicisi');
  assert.ok(!all.some((n) => /henüz oynatıldığında uygulanmaz/.test(n.text)), 'eski not gitti');
});

test('panel: görsel klibinin etiketi veri adresi değil; eylem listesi desteden', () => {
  assert.strictEqual(TP._clipLabel({ type: 'image', ref: 'data:image/png;base64,QUFB' }), 'Görsel');
  assert.deepStrictEqual(TP._refOptions('action'), [['nextScene', 'Sonraki Sahne']]);
});

/* Tempo değişimleri cetvelde (#636). Başlıktaki BPM önce hep ilk girişi
   düzenliyor ve bütün listeyi TEK girişle değiştiriyordu: bir gösteri
   dosyasındaki tempo değişimleri sessizce siliniyordu. */
test('panel: başlıktaki BPM kafadaki tempoyu düzenliyor, diğerlerini silmiyor', async () => {
  const cfg = cfgOf();
  cfg.timeline.tempo = [{ t: 0, bpm: 120, beatsPerBar: 4 }, { t: 6, bpm: 90, beatsPerBar: 3 }];
  const { host } = await mount(cfg);
  TP.seek(7);
  const bpm = find(host, (n) => n.tag === 'input' && /tl-num-sm/.test(n.className));
  bpm.value = '100';
  fire(bpm, 'change');
  assert.deepStrictEqual(cfg.timeline.tempo.map((e) => [e.t, e.bpm, e.beatsPerBar]), [[0, 120, 4], [6, 100, 3]]);
  TP.undo();
  assert.deepStrictEqual(cfg.timeline.tempo.map((e) => e.bpm), [120, 90], 'geri alınıyor');
});

test('panel: ♩＋ kafaya tempo değişimi ekliyor; etiket sürüklenince taşınıyor, Del siliyor', async () => {
  const cfg = cfgOf();
  const { host, cv } = await mount(cfg);
  TP.seek(6);
  const add = find(host, (n) => n.tag === 'button' && n.text === '♩＋');
  fire(add, 'click');
  assert.deepStrictEqual(cfg.timeline.tempo.map((e) => [e.t, e.bpm]), [[0, 120], [6, 120]]);
  assert.deepStrictEqual(TP._selection(), { kind: 'tempo', index: 1 });
  // Etiket cetvelin alt bandında; sürükleyince taşınıyor (yakalama kapalı)
  const tagY = RULER - 6;
  fire(cv, 'mousedown', { clientX: X(6) + 10, clientY: tagY, detail: 1 });
  winFire('mousemove', { clientX: X(8) + 10, clientY: tagY });
  winFire('mouseup', {});
  assert.ok(Math.abs(cfg.timeline.tempo[1].t - 8) < 1e-9, 'taşındı: ' + cfg.timeline.tempo[1].t);
  // Denetçiden BPM
  const all = [];
  walk(host, (n) => all.push(n));
  const row = all.find((n) => n.tag === 'label' && n.text === 'BPM' && n.parent && n.parent.className === 'row');
  const inp = row.parent.kids.find((k) => k.tag === 'input');
  inp.value = '140';
  fire(inp, 'change');
  assert.strictEqual(cfg.timeline.tempo[1].bpm, 140);
  // 8. saniyeden sonra ölçüler 140 ile: 8 sn = 4 ölçü (120'de), +4 vuruş 140'ta = 1 ölçü
  assert.strictEqual(TL.secondsToBars(TL.makeTempoMap(cfg.timeline.tempo), 8 + 4 * 60 / 140).bar, 6);
  TP._key({ key: 'Delete', target: {}, preventDefault() {}, stopPropagation() {} });
  assert.strictEqual(cfg.timeline.tempo.length, 1, 'silindi');
  TP.undo();
  assert.strictEqual(cfg.timeline.tempo.length, 2, 'geri geldi');
});

test('panel: şerit yüksekliği ayarlanıyor ve sınırlı', async () => {
  const cfg = cfgOf();
  const { host } = await mount(cfg);
  const up = find(host, (n) => n.tag === 'button' && n.text === '▭+');
  const down = find(host, (n) => n.tag === 'button' && n.text === '▭−');
  fire(up, 'click');
  assert.strictEqual(cfg.timeline.laneHeight, 48);
  for (let i = 0; i < 20; i++) fire(down, 'click');
  assert.strictEqual(cfg.timeline.laneHeight, 28, 'alt sınır');
  cfg.timeline.laneHeight = 40;
});
