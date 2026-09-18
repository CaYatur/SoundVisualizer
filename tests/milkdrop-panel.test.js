'use strict';
/* MilkDrop panelinden preset seçmek sahneyi GERÇEKTEN değiştiriyor mu?
 *
 * Hata (#560, madde 8): panel `cfg.visualizer.type = 'milkdrop'` yazıyordu,
 * ama katman yığını açıkken layers.js'teki resolve() liste doluysa yalnızca
 * cfg.layers'a bakıyor ve cfg.visualizer.type'ı yok sayıyor. Sonuç:
 * kullanıcı panelden preset seçiyor, sahne hiç değişmiyor ve hiçbir hata
 * görünmüyordu.
 *
 * Buradaki testler seçimin yığına ULAŞTIĞINI sabitliyor. Sessiz bir
 * kırılma olduğu için özellikle önemli: geri alınırsa yine hata vermez,
 * yalnızca panel işe yaramaz hale gelir. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
require('../src/shared/defaults.js');            // window.SV
require('../src/visualizer/layers.js');          // window.SVLayers
const MDP = require('../src/admin/milkdrop-panel.js');

const withStack = (layers) => ({
  layerStack: { enabled: true },
  layers: layers,
  visualizer: { type: 'bars' },
  milkdrop: { presetId: '', name: '', source: '' },
});

const preset = { id: 'md_1', name: 'Test', source: 'shader_body { ret = 1; }' };

test('panel: preset seçimi milkdrop yapılandırmasını yazıyor', () => {
  const cfg = withStack([]);
  MDP.load(cfg, preset);
  assert.strictEqual(cfg.milkdrop.presetId, 'md_1');
  assert.strictEqual(cfg.milkdrop.source, preset.source);
  assert.strictEqual(cfg.visualizer.type, 'milkdrop');
});

test('panel: yığın açıkken görselleştirici katmanı MilkDrop\'a çevriliyor', () => {
  const cfg = withStack([
    { id: 'ly_bg', kind: 'background', type: 'gradient', enabled: true, settings: {} },
    { id: 'ly_vis', kind: 'visualizer', type: 'bars', enabled: true,
      settings: { visualizer: { type: 'bars' } } },
  ]);
  MDP.load(cfg, preset);
  const vis = cfg.layers.find((l) => l.id === 'ly_vis');
  assert.strictEqual(vis.type, 'milkdrop');
  assert.strictEqual(vis.settings.visualizer.type, 'milkdrop',
    'katmanın kendi anlık görüntüsü de güncellenmeli');
  assert.strictEqual(cfg.layers[0].type, 'gradient', 'arkaplana dokunulmamalı');
});

test('panel: metin katmanı görselleştirici sanılıp ezilmiyor', () => {
  /* Metin ve "şimdi çalan" katmanları da kind=\'visualizer\' taşıyor.
     Çevrilirlerse kullanıcının yazısı ekrandan silinirdi. */
  const cfg = withStack([
    { id: 'ly_text', kind: 'visualizer', type: 'text', enabled: true, settings: {} },
    { id: 'ly_np', kind: 'visualizer', type: 'nowplaying', enabled: true, settings: {} },
  ]);
  MDP.load(cfg, preset);
  assert.strictEqual(cfg.layers[0].type, 'text');
  assert.strictEqual(cfg.layers[1].type, 'nowplaying');
  const added = cfg.layers.find((l) => l.type === 'milkdrop');
  assert.ok(added, 'çevrilecek katman yoksa yeni bir tane eklenmeli');
});

test('panel: birden çok görselleştirici katmanından yalnız ilki çevriliyor', () => {
  /* Hepsini çevirmek kullanıcının kurduğu kompozisyonu tek tıkla yok eder. */
  const cfg = withStack([
    { id: 'a', kind: 'visualizer', type: 'bars', enabled: true, settings: {} },
    { id: 'b', kind: 'visualizer', type: 'tunnel', enabled: true, settings: {} },
  ]);
  MDP.load(cfg, preset);
  assert.strictEqual(cfg.layers[0].type, 'milkdrop');
  assert.strictEqual(cfg.layers[1].type, 'tunnel');
});

test('panel: yığın kapalıyken katman listesine dokunulmuyor', () => {
  /* Yığın kapalıyken sahneyi zaten cfg.visualizer.type belirliyor; listeyi
     değiştirmek kullanıcının sakladığı düzeni sessizce bozardı. */
  const cfg = {
    layerStack: { enabled: false },
    layers: [{ id: 'ly_vis', kind: 'visualizer', type: 'bars', enabled: true, settings: {} }],
    visualizer: { type: 'bars' },
    milkdrop: {},
  };
  MDP.load(cfg, preset);
  assert.strictEqual(cfg.layers[0].type, 'bars');
  assert.strictEqual(cfg.visualizer.type, 'milkdrop');
});

test('resolve: çevrilen katman gerçekten çizilecek listeye giriyor', () => {
  /* Asıl sözleşme bu: panelin yazdığı şey resolve()'un döndürdüğü listede
     görünmezse kullanıcı yine hiçbir değişiklik görmez. */
  const L = global.window.SVLayers;
  const cfg = withStack([
    { id: 'ly_vis', kind: 'visualizer', type: 'bars', enabled: true, settings: {} },
  ]);
  MDP.load(cfg, preset);
  const drawn = L.resolve(cfg);
  assert.ok(drawn.some((l) => l.type === 'milkdrop'),
    'çizilecek katmanlar arasında milkdrop olmalı');
});

/* AÇILIŞ YARIŞI. Açılışta `init` listeyi callback'siz istiyor. Panel o
   istek sürerken çizilirse `loading` doğru olduğu için ikinci bir istek
   yapmıyordu ve liste gelince kimse paneli yeniden çizmiyordu: liste, ◀/▶
   ve kilit bir sonraki ayar değişikliğine kadar görünmüyordu. Yalıtılmış
   bir kopyada, uygulama açılır açılmaz Sahne sekmesine geçilerek yeniden
   üretildi. Test modülün TAZE bir örneğiyle koşuyor. */
test('panel: liste gelmeden çizilen panel, liste gelince yeniden çiziliyor', async () => {
  const key = require.resolve('../src/admin/milkdrop-panel.js');
  const saved = { api: window.api, SVPanel: window.SVPanel, SVMilkdropPanel: window.SVMilkdropPanel };
  delete require.cache[key];
  let resolveList;
  let rerenders = 0;
  const node = () => ({ appendChild() {}, setAttribute() {}, addEventListener() {} });
  window.api = { listPresets: () => new Promise((r) => { resolveList = r; }) };
  window.SVPanel = {
    el: node, row: node, cfg: () => ({ milkdrop: {}, visualizer: {} }),
    rerender: () => { rerenders++; }, apply() {},
  };
  try {
    const M = require('../src/admin/milkdrop-panel.js');
    M.init();
    // DOM yok; panelin geri kalanı düşebilir ama bayrak ilk satırlarda kuruluyor
    try { M.panel(); } catch (e) { /* beklenen */ }
    assert.strictEqual(rerenders, 0, 'liste gelmeden yeniden çizim olmamalı');
    resolveList([]);
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(rerenders, 1, 'liste gelince panel bir kez yeniden çizilmeli');
  } finally {
    delete require.cache[key];
    window.api = saved.api;
    window.SVPanel = saved.SVPanel;
    window.SVMilkdropPanel = saved.SVMilkdropPanel;
  }
});
