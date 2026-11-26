'use strict';
/* Alt raf: kapatınca gerçekten küçülüyor, MilkDrop ve Studio presetleri tek sekmede,
 * dar pencerede sekmeler gizlenmiyor (arama simgeye iniyor). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const SHELL = read('src/admin/scene-shell.js');
const CSS = read('src/admin/shell.css');

test('kapalı raf yalnız sekme çubuğu kadar, önizleme boşalan yeri alıyor', () => {
  assert.match(CSS, /\.sv-center\.tall > \.sv-shelf \{ flex: none; \}/);
  assert.match(CSS, /\.sv-center\.tall > \.sv-stagebox \{ flex: 1 1 auto; height: auto;/);
  // Kapatma düğmesi durumu saklıyor ve sınıfı çiziyor
  assert.match(SHELL, /shelfOpen = !shelfOpen; write\(STORE\.open, shelfOpen \? '1' : '0'\)/);
  assert.match(SHELL, /c\.classList\.toggle\('tall', !shelfOpen\)/);
});

test('Preset sekmesi: MilkDrop ve Studio aynı sekmede, sekme sayısı artmıyor', () => {
  const lib = SHELL.match(/const LIB_TABS = \[([\s\S]*?)\n  \];/)[1];
  const ids = [...lib.matchAll(/\{ id: '(\w+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(ids, ['milkdrop', 'vis', 'bg', 'templates', 'scenes']);
  assert.match(lib, /id: 'milkdrop', label: 'Preset', en: 'Presets', subs: PRESET_SUBS/);
  assert.match(SHELL, /const PRESET_SUBS = \['milkdrop', 'studio'\];/);
  // Sekme son alt rafı açıyor; alt raf düğmeleri kilit kabının dışında
  assert.match(SHELL, /onclick: \(\) => setShelf\(t\.subs \? presetSub : t\.id\)/);
  assert.match(SHELL, /body\.querySelector\(':scope > \.sv-target, :scope > \.sv-psrc'\)/);
  assert.match(SHELL, /tab\.id === 'studio'\) \{\s*kids\.push\(studioGallery\(\)\);/);
});

test('dar raf: sekmeler sarılmıyor ya da gizlenmiyor, arama simgeye iniyor', () => {
  const q = CSS.match(/@container svshelf \(max-width: 820px\) \{([\s\S]*?)\n\}/);
  assert.ok(q, 'kap sorgusu yok');
  assert.match(q[1], /\.sv-shelf-search:not\(:focus-within\) \{ flex: none; width: 34px;/);
  assert.match(q[1], /\.sv-shelf-search:focus-within \{ position: absolute;/);
  assert.match(q[1], /\.sv-card-size input\[type='range'\] \{ width: 40px; \}/);
  assert.ok(!/\.sv-tabs( button)? \{[^}]*(display: none|flex-wrap: wrap)/.test(CSS), 'sekmeler gizlenmemeli');
  assert.match(CSS, /\.sv-shelf \{ flex: 1 1 auto; container: svshelf \/ inline-size; \}/);
});

function groupsFn() {
  const src = SHELL.match(/function studioGroups\(list, cat, favs, q, fold\) \{[\s\S]*?\n  \}/)[0];
  const tr = (s) => s;
  const studioName = (p) => p.name;
  // eslint-disable-next-line no-new-func
  return new Function('tr', 'studioName', 'return (' + src + ');')(tr, studioName);
}

test('Studio rafı: kategori, favori ve arama süzgeci; her preset bir kez', () => {
  const fn = groupsFn();
  const list = [
    { id: 'a', name: 'Plazma', kind: 'background', builtin: true },
    { id: 'b', name: 'Halka', kind: 'visualizer', builtin: true },
    { id: 'c', name: 'Benim Halkam', kind: 'visualizer', builtin: false },
    { id: 'd', name: 'Bulut', kind: 'background', builtin: true },
    { id: 'm', name: 'Halka MilkDrop', kind: 'milkdrop', engine: 'milkdrop', builtin: true },
  ];
  const all = fn(list, 'all', ['d'], '');
  assert.deepStrictEqual(all.map((g) => [g[0], g[1].map((p) => p.id)]), [
    ['Favoriler', ['d']], ['Kendi Presetlerim', ['c']], ['Görselleştirici', ['b']], ['Arkaplan', ['a']],
  ]);
  assert.deepStrictEqual(fn(list, 'background', [], '')[0][1].map((p) => p.id), ['a', 'd']);
  assert.deepStrictEqual(fn(list, 'mine', [], '')[0][1].map((p) => p.id), ['c']);
  assert.deepStrictEqual(fn(list, 'fav', [], ''), []);
  assert.deepStrictEqual(fn(list, 'all', [], 'halka').map((g) => g[1].map((p) => p.id)), [['c'], ['b']]);
});

test('Studio rafı: kart katmana uygular, Ctrl+F raf aramasını açar, küçük resim paylaşılır', () => {
  assert.match(SHELL, /window\.SVLayers\.setLayerMode\(cfg, l, \{ type: 'custom', presetId: p\.id, reveal: true \}\)/);
  assert.match(SHELL, /function studioApplyTarget\(cur\)/);
  assert.match(SHELL, /studio: \{\s*sel: '\.sv-gi\[data-cur\]'/);
  assert.match(SHELL, /String\(e\.key \|\| ''\)\.toLowerCase\(\) !== 'f'/);
  const studio = read('src/admin/studio.js');
  assert.match(studio, /window\.SVStudio = \{[^}]*thumbAsync, importAny \}/);
  assert.match(studio, /v\.w === THUMB_W/);
});

function studioTargetFn() {
  const isSrc = SHELL.match(/function isStudioLayer\(l\) \{[\s\S]*?\n  \}/)[0];
  const tSrc = SHELL.match(/function studioApplyTarget\(cur\) \{[\s\S]*?\n  \}/)[0];
  // eslint-disable-next-line no-new-func
  return new Function('return (function(){ ' + isSrc + '\n' + tSrc + '\n return { isStudioLayer, studioApplyTarget }; })();')();
}

test('Studio uygulama: seçili kilitsiz Studio katmanı (zemin veya görsel) yerinde, seçimsiz yeni katman', () => {
  const { isStudioLayer, studioApplyTarget } = studioTargetFn();
  const bg = { id: 's1', kind: 'background', type: 'custom', name: 'Su Kostikleri — Studio' };
  const vis = { id: 's2', kind: 'visualizer', type: 'custom', name: 'Frekans Halkaları — Studio' };
  const bars = { id: 'v1', kind: 'visualizer', type: 'bars', name: 'Barlar' };
  const locked = { id: 's3', kind: 'background', type: 'custom', locked: true };
  assert.strictEqual(isStudioLayer(bg), true);
  assert.strictEqual(isStudioLayer(vis), true);
  assert.strictEqual(isStudioLayer(bars), false);
  assert.deepStrictEqual(studioApplyTarget(bg), { apply: true });
  assert.deepStrictEqual(studioApplyTarget(vis), { apply: true });
  assert.deepStrictEqual(studioApplyTarget(null), { create: true });
  assert.deepStrictEqual(studioApplyTarget(undefined), { create: true });
  assert.strictEqual(studioApplyTarget(bars).error, 'WRONG_KIND');
  assert.strictEqual(studioApplyTarget(locked).error, 'LOCKED');
});

test('Studio rafı: uymayan seçimde MilkDrop ile aynı kilit bandı ve çevirme', () => {
  assert.match(SHELL, /shelfTab !== 'vis' && shelfTab !== 'bg' && shelfTab !== 'milkdrop' && shelfTab !== 'studio'/);
  assert.match(SHELL, /if \(want === 'studio'\) return 'Studio presetleri yalnız Studio katmanına uygulanır.'/);
  assert.match(SHELL, /const toType = lock\.want === 'studio' \? 'custom' : 'milkdrop'/);
  assert.match(SHELL, /lock\.want === 'studio' \? "Katmanı Studio'ya çevir" : "Katmanı MilkDrop'a çevir"/);
  const i18n = read('src/shared/i18n.js');
  for (const k of ["Katmanı Studio'ya çevir", 'Studio presetleri yalnız Studio katmanına uygulanır.']) {
    assert.ok(i18n.includes("'" + k.replace(/'/g, "\\'") + "':") || i18n.includes('"' + k + '":') || new RegExp("'" + k.replace(/'/g, "\\'") + "':").test(i18n), 'EN çevirisi: ' + k);
  }
  assert.match(i18n, /'Katmanı Studio\\'ya çevir': 'Convert layer to Studio'/);
  assert.match(i18n, /'Studio presetleri yalnız Studio katmanına uygulanır.': 'Studio presets only apply to a Studio layer.'/);
});
