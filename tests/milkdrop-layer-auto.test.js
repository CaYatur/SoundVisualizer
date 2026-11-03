'use strict';
/* MILKDROP KATMANININ KENDİ OTOMATİK GEÇİŞİ (#905).

   #909 katmana kendi presetini verdi ama o presette durduruyordu. Burada bağımsız
   katman kendi aralığıyla geçiyor; seçimi izleme mesajının kendi payında gidiyor, yani
   ekranlar katman katman aynı kalıyor. Aynı pencerede iki ORTAK katman da artık tek
   seçim gösteriyor: her biri ayrı sayaç koşturuyordu.

   Motor sahte pencereyle koşuyor. Ana süreç Electron'suz yüklenmediği için dağıtımı
   kaynaktan denetleniyor; `localFollow` ise gerçek koduyla sınanıyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8').replace(/\r\n/g, '\n');

const PRESETS = ['p1', 'p2', 'p3', 'p4'].map((id, i) => ({
  id, name: id.toUpperCase(), kind: 'milkdrop', source: '[preset00]\nfDecay=0.9' + i + '\nper_frame_1=zoom = 1.0' + i + ';\n',
}));

function engine() {
  const canvas = () => ({ width: 320, height: 240, getContext: (k) => (k === '2d' ? {} : null), addEventListener() {} });
  const ctx = { window: {}, document: { createElement: canvas }, console, performance };
  ctx.window.document = ctx.document;
  ctx.window.SVPresets = { byKind: (k) => PRESETS.filter((p) => p.kind === k) };
  vm.createContext(ctx);
  for (const f of ['src/shared/milkdrop.js', 'src/shared/milkdrop-cycle.js', 'src/visualizer/modes/milkdrop.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  return { win: ctx.window, make: () => new ctx.window.SVModes.milkdrop(canvas()) };
}

const ownCfg = (extra) => ({
  milkdrop: Object.assign({ independent: true, presetId: 'p1', source: PRESETS[0].source, blendTime: 0, autoNext: 2, autoOrder: 'sequential' }, extra || {}),
  milkdropControl: {},
  milkdropLibrary: {},
});

function run(m, cfg, seconds) {
  for (let i = 0; i < seconds * 20; i++) m._autoCycle(cfg, 0.05, {});
}

test('ownAuto kapalıyken kendi presetinde duruyor: 3.1.7 sahneleri değişmesin', () => {
  const e = engine();
  const m = e.make();
  const cfg = ownCfg();
  m._ensurePreset(cfg);
  run(m, cfg, 6);
  assert.strictEqual(m.autoPick, null);
});

test('ownAuto açıkken kendi aralığıyla geçiyor', () => {
  const e = engine();
  const m = e.make();
  const cfg = ownCfg({ ownAuto: true });
  m._ensurePreset(cfg);
  run(m, cfg, 3);
  assert.ok(m.autoPick, 'aralık doldu');
  assert.notStrictEqual(m.autoPick.id, 'p1');
});

test('iki bağımsız katman ayrı aralıkla ayrı seçer', () => {
  const e = engine();
  const a = e.make();
  const b = e.make();
  const ca = ownCfg({ ownAuto: true, autoNext: 2 });
  const cb = ownCfg({ ownAuto: true, autoNext: 60, presetId: 'p3', source: PRESETS[2].source });
  a._ensurePreset(ca);
  b._ensurePreset(cb);
  run(a, ca, 3);
  run(b, cb, 3);
  assert.ok(a.autoPick);
  assert.strictEqual(b.autoPick, null, 'kendi aralığı dolmadı');
});

test('izleyen katman mesajdaki KENDİ payını alıyor, ortak seçimi almıyor', () => {
  const e = engine();
  const m = e.make();
  m.layerId = 'L2';
  const cfg = ownCfg({ ownAuto: true, autoNext: 60 });
  m._ensurePreset(cfg);
  e.win.SVMdFollow = {
    at: performance.now(), id: 'p4', base: 'ortak', seed: 1,
    layers: {
      L1: { id: 'p2', base: m._manualKey, seed: 2 },
      L2: { id: 'p3', base: m._manualKey, seed: 77, cut: true, blend: null },
    },
  };
  m._autoCycle(cfg, 0.05, {});
  assert.strictEqual(m.autoPick.id, 'p3');
  assert.strictEqual(m.autoPick.seed, 77);
  assert.strictEqual(m.autoPick.cut, true);
});

test('mesajda payı yoksa kendi sayacıyla sürüyor', () => {
  const e = engine();
  const m = e.make();
  m.layerId = 'L9';
  const cfg = ownCfg({ ownAuto: true });
  m._ensurePreset(cfg);
  e.win.SVMdFollow = { at: performance.now(), id: 'p4', base: m._manualKey, layers: { L1: { id: 'p2', base: 'x' } } };
  run(m, cfg, 3);
  assert.ok(m.autoPick);
  assert.notStrictEqual(m.autoPick.id, 'p4', 'ortak seçim bağımsız katmana geçmedi');
});

test('bayat pay izlenmiyor: lider kapanınca kendi sayacına dönüyor', () => {
  const e = engine();
  const m = e.make();
  m.layerId = 'L2';
  const cfg = ownCfg({ ownAuto: true, autoNext: 60 });
  m._ensurePreset(cfg);
  e.win.SVMdFollow = { at: performance.now() - 5000, id: null, base: '', layers: { L2: { id: 'p3', base: m._manualKey, seed: 7 } } };
  m._autoCycle(cfg, 0.05, {});
  assert.strictEqual(m.autoPick, null);
});

test('ortak katman `layers` payını izlemiyor', () => {
  const e = engine();
  const m = e.make();
  m.layerId = 'L2';
  const cfg = { milkdrop: { presetId: 'p1', source: PRESETS[0].source, blendTime: 0, autoNext: 0 }, milkdropControl: {}, milkdropLibrary: {} };
  m._ensurePreset(cfg);
  e.win.SVMdFollow = { at: performance.now(), id: null, base: m._manualKey, layers: { L2: { id: 'p3', base: m._manualKey } } };
  m._autoCycle(cfg, 0.05, {});
  assert.strictEqual(m.autoPick, null);
});

test('aynı penceredeki ortak katmanlar tek seçim gösteriyor', () => {
  const e = engine();
  const lead = e.make();
  const second = e.make();
  second.sharedLeader = lead;
  const cfg = { milkdrop: { presetId: 'p1', source: PRESETS[0].source, blendTime: 0, autoNext: 2, autoOrder: 'random' }, milkdropControl: {}, milkdropLibrary: {} };
  lead._ensurePreset(cfg);
  second._ensurePreset(cfg);
  for (let i = 0; i < 400; i++) {
    lead._autoCycle(cfg, 0.05, {});
    second._autoCycle(cfg, 0.05, {});
    const a = lead.autoPick;
    const b = second.autoPick;
    assert.strictEqual(b ? b.id : null, a ? a.id : null);
    assert.strictEqual(b ? b.seed : null, a ? a.seed : null, 'aynı tohum: aynı rand_preset');
  }
  assert.ok(lead.autoPick, 'seçim oldu');
});

test('ortak izleme lideri bağlantısından önce geliyor: pencereler arası tek seçim korunuyor', () => {
  const e = engine();
  const lead = e.make();
  const second = e.make();
  second.sharedLeader = lead;
  const cfg = { milkdrop: { presetId: 'p1', source: PRESETS[0].source, blendTime: 0, autoNext: 0 }, milkdropControl: {}, milkdropLibrary: {} };
  lead._ensurePreset(cfg);
  second._ensurePreset(cfg);
  e.win.SVMdFollow = { at: performance.now(), id: 'p3', base: second._manualKey, seed: 5 };
  second._autoCycle(cfg, 0.05, {});
  assert.strictEqual(second.autoPick.id, 'p3');
});

// ---------------------------------------------------------------- yığın
test('yığın kimliği motora veriyor, payı katmana göre topluyor, ortakları bağlıyor', () => {
  const L = read('src/visualizer/layers.js');
  assert.match(L, /if \(e\.mode\) e\.mode\.layerId = layer\.id;/);
  assert.match(L, /milkdropLayers\(\) \{[\s\S]*?own\.ownAuto !== true[\s\S]*?\[e\.layer\.id\] = e\.mode\.livePreset\(\)/);
  assert.match(L, /_linkShared\(\) \{[\s\S]*?e\.mode\.sharedLeader = lead;/);
  assert.match(L, /draw\(audio, cfg, t, dt\) \{\s*this\._linkShared\(\);/);
  assert.match(L, /drawTo\(ctx, audio, cfg, t, dt, drawLogo, reuse\) \{\s*this\._linkShared\(\);/);
});

// ---------------------------------------------------------------- dağıtım
test('ana süreç payları tek mesajda dağıtıyor; anahtar payları da içeriyor', () => {
  const M = read('src/main/main.js');
  assert.match(M, /if \(data && \(data\.mdPreset \|\| data\.mdLayers\)\) relayMdFollow\(e\.sender, data\.mdPreset, data\.mdLayers\);/);
  assert.match(M, /ipcMain\.on\('md-live', \(e, mp, layers\) => \{/);
  assert.match(M, /follow\.layers\[id\] = mdFollowOf\(layers\[id\] \|\| \{\}\);/);
  assert.match(M, /key \+= ';' \+ id \+ '=' \+ mdFollowKey\(follow\.layers\[id\]\);/);
});

test('pencere ve panel payı alıyor', () => {
  assert.match(read('src/visualizer/visualizer.js'), /mdLayers: stack\.milkdropLayers\(\),/);
  assert.match(read('src/admin/admin.js'), /layers: d\.mdLayers \|\| null \}, d\.mdPreset\)/);
  assert.match(read('src/admin/preview.js'), /window\.api\.sendMdLive\(mp, layers\);/);
});

test('yedek makinede ve web çıkışında payların geçiş anı da aynı kuralla', () => {
  const R = require('../src/main/redundancy.js');
  const f = { id: 'a', startedAt: 1000, at: 5, hash: 'h', layers: { L1: { id: 'b', startedAt: 2000 }, L2: { id: 'c', startedAt: null } } };
  const loc = R.localFollow(f, (ms) => ms + 10);
  assert.strictEqual(loc.startedAt, 1010);
  assert.strictEqual(loc.layers.L1.startedAt, 2010);
  assert.strictEqual(loc.layers.L2.startedAt, null);
  assert.strictEqual(loc.at, undefined);
  const web = R.withoutStart(f);
  assert.strictEqual(web.startedAt, null);
  assert.strictEqual(web.layers.L1.startedAt, null);
  assert.strictEqual(web.layers.L1.id, 'b');
});

// ---------------------------------------------------------------- panel
test('anahtar aralığı ortak ayardan başlatıyor, ortakta kapalıysa 30 sn', () => {
  global.window = global.window || {};
  const src = read('src/admin/milkdrop-panel.js');
  const m = /function setLayerAuto\(cfg, l, on\) \{[\s\S]*?\n  \}\n/.exec(src);
  assert.ok(m, 'setLayerAuto bulunamadı');
  // eslint-disable-next-line no-eval
  const setLayerAuto = vm.runInNewContext('(' + m[0].trim() + ')');
  const l = { settings: { milkdrop: { independent: true } } };
  setLayerAuto({ milkdrop: { autoNext: 0 } }, l, true);
  assert.strictEqual(l.settings.milkdrop.ownAuto, true);
  assert.strictEqual(l.settings.milkdrop.autoNext, 30);
  assert.strictEqual(l.settings.milkdrop.autoOrder, 'sequential');
  const l2 = { settings: { milkdrop: { independent: true } } };
  setLayerAuto({ milkdrop: { autoNext: 45, autoNextUnit: 'bars', autoOrder: 'random' } }, l2, true);
  assert.strictEqual(l2.settings.milkdrop.autoNext, 45);
  assert.strictEqual(l2.settings.milkdrop.autoNextUnit, 'bars');
  assert.strictEqual(l2.settings.milkdrop.autoOrder, 'random');
  setLayerAuto({}, l2, false);
  assert.strictEqual(l2.settings.milkdrop.ownAuto, undefined);
  assert.strictEqual(l2.settings.milkdrop.autoNext, 45, 'aralık kalıyor');
});

test('metinler çevrilmiş', () => {
  const I = read('src/shared/i18n.js');
  for (const k of ['Kendi Otomatik Geçişi', 'Listeden seçilen preset bu katmana gider.', 'Kapalıyken bu presette durur.',
    'Bu katman kendi aralığıyla geçer; havuz ve sert geçiş ortak ayardan gelir. Bütün ekranlar aynı seçimi gösterir.']) {
    assert.ok(I.includes("'" + k + "':"), k);
  }
});
