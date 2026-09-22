'use strict';
/* MILKDROP MIDI VE OSC'DE (#570).
 *
 * Denetleyici eylemleri panelin kendi düğmeleriyle AYNI yoldan gidiyor
 * (milkdrop-panel.js `act`): geçmiş, puan ağırlığı ve kilit düğmelerle aynı
 * çalışsın. Testler `act`i panelin TAZE bir örneğinde, sahte bir panel
 * ortamıyla davranışından sınıyor; hedef listesi ve motorun "şimdi kes"
 * okuması kaynak üzerinden sabitleniyor. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
require('../src/shared/defaults.js');
require('../src/shared/milkdrop-cycle.js');
require('../src/admin/control.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const bare = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const SV = global.window.SV;
const CT = global.window.SVControl;

const milk = (r) => 'MILKDROP_PRESET_VERSION=201\n[preset00]\nfRating=' + r + '\nfDecay=0.98\n';
const LIB = [
  { id: 'm1', name: 'Bir', kind: 'milkdrop', source: milk(3) },
  { id: 'm2', name: 'İki', kind: 'milkdrop', source: milk(3) },
  { id: 'm3', name: 'Üç', kind: 'milkdrop', source: milk(3.5) },
];

// Panelin TAZE bir örneği: liste yüklü, panel ortamı sahte
async function freshPanel(list) {
  const key = require.resolve('../src/admin/milkdrop-panel.js');
  delete require.cache[key];
  const cfg = SV.defaultConfig();
  const node = () => ({ appendChild() {}, setAttribute() {}, addEventListener() {} });
  window.api = { listPresets: () => Promise.resolve(list === undefined ? LIB : list) };
  window.SVPanel = { cfg: () => cfg, apply() {}, rerender() {}, el: node, row: node };
  window.SVMdFollow = null;
  const M = require('../src/admin/milkdrop-panel.js');
  M.init();
  await new Promise((r) => setImmediate(r));
  return { M, cfg };
}

test('eylemler: ▶ ve ◀ ekranda gösterilenlerin geçmişinde', async () => {
  const { M, cfg } = await freshPanel();
  const at = () => cfg.milkdrop.presetId;
  M.act('Next'); assert.strictEqual(at(), 'm1', 'boş geçmişte listenin ilki');
  M.act('Next'); assert.strictEqual(at(), 'm2');
  M.act('Prev'); assert.strictEqual(at(), 'm1', '◀ bir önce gösterilene');
  M.act('Next'); assert.strictEqual(at(), 'm2', '▶ önce geçmişte ileri');
  M.act('Next'); assert.strictEqual(at(), 'm3', 'sonra sıraya göre yeni');
});

test('şimdi kes: sıradaki preset, yalnız o seçimde karışmadan', async () => {
  const { M, cfg } = await freshPanel();
  M.act('Next');
  M.act('Cut');
  assert.strictEqual(cfg.milkdrop.presetId, 'm2');
  assert.strictEqual(cfg.milkdropControl.cutTo, 'm2', 'motor bu kimliği karışmadan yükler');
  M.act('Next');
  assert.strictEqual(cfg.milkdrop.presetId, 'm3');
  assert.strictEqual(cfg.milkdropControl.cutTo, '', 'sonraki seçim yine karışarak');
  // Sahneye ait değil: milkdrop bloğunda iz yok
  assert.strictEqual(cfg.milkdrop.cutTo, undefined);
});

test('kilit: aç/kapa, sahne bloğunun dışında', async () => {
  const { M, cfg } = await freshPanel();
  assert.strictEqual(M.act('Lock'), true);
  assert.strictEqual(cfg.milkdropControl.locked, true);
  M.act('Lock');
  assert.strictEqual(cfg.milkdropControl.locked, false);
  assert.strictEqual(cfg.milkdrop.locked, undefined);
});

test('puan: ekrandakinin puanı bir tam adım, 0..5 arasında', async () => {
  const { M, cfg } = await freshPanel();
  M.act('Next'); M.act('Next'); M.act('Next'); // m3, dosyada 3,5
  M.act('RateUp');
  assert.strictEqual(cfg.milkdropLibrary.ratings.m3, 4, '3,5 → 4');
  M.act('RateDown');
  assert.strictEqual(cfg.milkdropLibrary.ratings.m3, 3);
  for (let i = 0; i < 6; i++) M.act('RateDown');
  assert.strictEqual(cfg.milkdropLibrary.ratings.m3, 0, 'alt sınır 0');
  for (let i = 0; i < 9; i++) M.act('RateUp');
  assert.strictEqual(cfg.milkdropLibrary.ratings.m3, 5, 'üst sınır 5');
});

test('rastgele: ekrandaki hariç ve puana göre — 0 puanlı gelmiyor', async () => {
  const { M, cfg } = await freshPanel();
  cfg.milkdropLibrary.ratings = { m2: 0 };
  M.act('Next'); // m1
  for (let i = 0; i < 40; i++) {
    M.act('Random');
    assert.notStrictEqual(cfg.milkdrop.presetId, 'm2');
  }
});

test('liste boşken yalnız kilit çalışıyor; bilinmeyen eylem hiçbir şey yapmıyor', async () => {
  const { M, cfg } = await freshPanel([]);
  assert.strictEqual(M.act('Next'), false);
  assert.strictEqual(M.act('RateUp'), false);
  assert.strictEqual(cfg.milkdrop.presetId, '');
  assert.strictEqual(M.act('Lock'), true);
  const { M: M2 } = await freshPanel();
  assert.strictEqual(M2.act('Yok'), false);
});

test('denetleyici: md* eylemleri panelin act\'ine gidiyor', () => {
  const calls = [];
  const saved = window.SVMilkdropPanel;
  window.SVMilkdropPanel = { act: (n) => { calls.push(n); return true; } };
  try {
    for (const a of ['mdNext', 'mdPrev', 'mdRandom', 'mdCut', 'mdLock', 'mdRateUp', 'mdRateDown']) {
      CT.runAction(a, SV.defaultConfig());
    }
  } finally {
    window.SVMilkdropPanel = saved;
  }
  assert.deepStrictEqual(calls, ['Next', 'Prev', 'Random', 'Cut', 'Lock', 'RateUp', 'RateDown']);
});

// ------------------------------------------------------------ hedefler

const tgt = (p) => CT.TARGETS.find((t) => t.path === p);

test('hedefler: aralıklar panelin kaydırıcılarıyla aynı', () => {
  assert.deepStrictEqual([tgt('milkdrop.blendTime').min, tgt('milkdrop.blendTime').max], [0, 5]);
  const an = tgt('milkdrop.autoNext');
  assert.deepStrictEqual([an.min, an.max, an.int], [0, 120, true]);
  const ar = tgt('milkdrop.autoNextRand');
  assert.deepStrictEqual([ar.min, ar.max, ar.int], [0, 30, true]);
  const th = tgt('milkdrop.hardCutThreshold');
  assert.deepStrictEqual([th.min, th.max], [1, 6]);
  const PANEL = read('src/admin/milkdrop-panel.js');
  assert.match(PANEL, /min: 0, max: 120, step: 1/);
  assert.match(PANEL, /min: 0, max: 30, step: 1/);
  assert.match(PANEL, /min: 1, max: 6, step: 0\.1/);
});

/* Ağ sıklığı ve iç çözünürlük panelde yalnız sabit değerler alıyor; sürekli
   bir düğme her ara değerde ağı ya da tamponları yeniden kurardı. Kovalar
   panelin seçenekleriyle BİREBİR aynı olmalı. */
test('hedefler: ağ sıklığı ve iç çözünürlük panelin seçenekleriyle aynı kovalar', () => {
  const PANEL = read('src/admin/milkdrop-panel.js');
  const opts = (label) => {
    const m = new RegExp("P\\(\\)\\.row\\('" + label + "', selOf\\(\\[([\\s\\S]*?)\\], md\\.").exec(PANEL);
    assert.ok(m, label + ' seçenekleri bulunamadı');
    return (m[1].match(/\[\s*([0-9.]+),/g) || []).map((x) => Number(x.replace(/[^0-9.]/g, '')));
  };
  assert.deepStrictEqual(tgt('milkdrop.mesh').steps, opts('Ağ Sıklığı'));
  assert.deepStrictEqual(tgt('milkdrop.renderScale').steps, opts('İç Çözünürlük'));
});

test('eşleme değeri: kovalar eşit, doğrusal hedefler aralıkta', () => {
  const mesh = tgt('milkdrop.mesh');
  assert.strictEqual(CT.mappedValue(mesh, {}, 0), 24);
  assert.strictEqual(CT.mappedValue(mesh, {}, 0.5), 64);
  assert.strictEqual(CT.mappedValue(mesh, {}, 0.999), 128);
  assert.strictEqual(CT.mappedValue(mesh, {}, 1), 128);
  assert.strictEqual(CT.mappedValue(mesh, { min: 50, max: 60 }, 0), 24, 'kovalı hedefte min/max yok');
  assert.strictEqual(CT.mappedValue(tgt('milkdrop.blendTime'), {}, 0.5), 2.5);
  assert.strictEqual(CT.mappedValue(tgt('milkdrop.autoNext'), {}, 0.333), 40, 'tam sayı');
  assert.strictEqual(CT.mappedValue(tgt('milkdrop.autoNext'), { min: 10, max: 20 }, 0.5), 15);
  assert.strictEqual(CT.mappedValue(tgt('milkdrop.blendTime'), {}, 7), 5, 'sınırın dışı kıstırılıyor');
});

test('motor: "şimdi kes" yalnız o elle seçimde karışmıyor', () => {
  const MODE = bare(read('src/visualizer/modes/milkdrop.js'));
  const fn = /_ensurePreset\(cfg\) \{[\s\S]*?\n    \}/.exec(MODE)[0];
  assert.match(fn, /const cutTo = cfg\.milkdropControl && cfg\.milkdropControl\.cutTo;/);
  assert.match(fn, /const cutNow = a \? a\.cut : \(!!cutTo && cutTo === c\.presetId\);/);
  assert.strictEqual(SV.defaultConfig().milkdropControl.cutTo, '');
});

test('eylem ve hedef etiketlerinin İngilizcesi var', () => {
  const I = read('src/shared/i18n.js');
  const mine = CT.TARGETS.filter((t) => /^milkdrop\./.test(t.path || '') || /^md/.test(t.action || ''));
  // 13 + sprite silme eylemleri (#577: en yeni, en eski, hepsi)
  assert.strictEqual(mine.length, 16);
  for (const t of mine) assert.ok(I.includes("'" + t.label + "':"), 'çevirisi yok: ' + t.label);
});
