'use strict';
/* Raf vurgusu her rafta seçili katmanın / etkin durumun GERÇEK hâlini gösteriyor.
 *
 * Hata: Şarkı Sözü katmanı listede "Kroma Çemberi"ydi, önizleme doğruydu, ama Görsel
 * rafında "Osiloskop (XY)" kartı seçili kalmıştı. Kartlar yalnız raf kurulurken
 * işaretleniyordu; tür değişince raf imzası aynı kaldığı için raf yeniden kurulmuyordu.
 * MilkDrop, Zemin, Şablon ve Sahne raflarında da aynısı. Artık tek bir eşitleme
 * (scene-shell syncShelf) her çizimden sonra sınıfları yerinde değiştiriyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SHELL = fs.readFileSync(path.join(__dirname, '..', 'src/admin/scene-shell.js'), 'utf8').replace(/\r\n/g, '\n');

// SHELF_CURRENT + modeNow + syncShelf kaynağı, sahte bir ortamda
function load(state) {
  const src = SHELL.match(/  const SHELF_CURRENT = \{[\s\S]*?\n  function syncShelf\(root\) \{[\s\S]*?\n  \}\n/)[0];
  // eslint-disable-next-line no-new-func
  return new Function('state', 'with (state) { ' + src + ' return { syncShelf, SHELF_CURRENT }; }')(state);
}
function item(attr, key, on, cls) {
  const set = new Set(on ? [cls] : []);
  const attrs = { [attr]: key };
  return {
    key,
    getAttribute: (k) => attrs[k],
    classList: {
      contains: (c) => set.has(c),
      toggle: (c, v) => { if (v) set.add(c); else set.delete(c); },
    },
    on: () => set.has(cls),
  };
}
function host(items, line) {
  return {
    querySelectorAll: () => items,
    querySelector: (s) => (s === '.sv-target' ? line || null : null),
  };
}
function env(over) {
  return Object.assign({
    shelfTab: 'vis',
    selected: () => null,
    targetLine: () => '',
    P: () => ({ cfg: () => ({}), activeSceneId: () => null }),
    window: {},
    document: undefined,
  }, over);
}
const onKeys = (items) => items.filter((n) => n.on()).map((n) => n.key);

test('Görsel rafı: katmanın türü değişince vurgu eski karttan yenisine geçiyor (raf kurulmadan)', () => {
  const layer = { id: 'lyr', kind: 'visualizer', type: 'oscilloscope' };
  const items = ['oscilloscope', 'chroma', 'bars'].map((k) => item('data-cur', k, k === 'oscilloscope', 'cur'));
  const line = { textContent: 'Şuna uygulanır: Şarkı Sözü' };
  const S = load(env({ shelfTab: 'vis', selected: () => layer, targetLine: () => 'Şuna uygulanır: Şarkı Sözü' }));
  layer.type = 'chroma'; // listeden / denetçiden / MCP / geri al
  assert.strictEqual(S.syncShelf(host(items, line)), 2);
  assert.deepStrictEqual(onKeys(items), ['chroma']);
  // Değişiklik yoksa dokunulmuyor
  assert.strictEqual(S.syncShelf(host(items, line)), 0);
});

test('Görsel rafı: seçim değişince vurgu ve hedef satırı yerinde güncelleniyor', () => {
  let sel = { id: 'a', name: 'A', kind: 'visualizer', type: 'bars' };
  const items = ['bars', 'circular'].map((k) => item('data-cur', k, k === 'bars', 'cur'));
  const line = { textContent: 'Şuna uygulanır: A' };
  const S = load(env({ shelfTab: 'vis', selected: () => sel, targetLine: () => 'Şuna uygulanır: ' + (sel ? sel.name : '') }));
  sel = { id: 'b', name: 'B', kind: 'visualizer', type: 'circular' };
  S.syncShelf(host(items, line));
  assert.deepStrictEqual(onKeys(items), ['circular']);
  assert.strictEqual(line.textContent, 'Şuna uygulanır: B');
  sel = null; // seçim kalkınca hiçbir kart vurgulu değil
  S.syncShelf(host(items, line));
  assert.deepStrictEqual(onKeys(items), []);
});

test('Zemin rafı: arkaplan katmanının türüne göre; başka türden katman vurgu bırakmıyor', () => {
  let sel = { id: 'bg', kind: 'background', type: 'gradient' };
  const items = ['gradient', 'solid'].map((k) => item('data-cur', k, k === 'gradient', 'cur'));
  const S = load(env({ shelfTab: 'bg', selected: () => sel }));
  sel.type = 'solid';
  S.syncShelf(host(items));
  assert.deepStrictEqual(onKeys(items), ['solid']);
  sel = { id: 'v', kind: 'visualizer', type: 'solid' };
  S.syncShelf(host(items));
  assert.deepStrictEqual(onKeys(items), []);
});

test('MilkDrop rafı: seçimin gittiği presete göre (bağımsız katman ya da ortak)', () => {
  let pick = 'md_a';
  const items = ['md_a', 'md_b'].map((k) => item('data-id', k, k === 'md_a', 'active'));
  const S = load(env({ shelfTab: 'milkdrop', window: { SVMilkdropPanel: { currentPick: () => pick } } }));
  pick = 'md_b';
  S.syncShelf(host(items));
  assert.deepStrictEqual(onKeys(items), ['md_b']);
});

test('Şablon rafı: son uygulanan şablon; ayar değişince (clearLastApplied) vurgu kalkıyor', () => {
  let cur = 'tpl_1';
  const items = ['tpl_1', 'tpl_2'].map((k) => item('data-cur', k, false, 'active'));
  const S = load(env({ shelfTab: 'templates', window: { SVTemplatePanel: { current: () => cur } } }));
  S.syncShelf(host(items));
  assert.deepStrictEqual(onKeys(items), ['tpl_1']);
  cur = '';
  S.syncShelf(host(items));
  assert.deepStrictEqual(onKeys(items), []);
});

test('Sahne rafı: etkin sahne (MCP ya da kısayolla uygulanan da)', () => {
  let active = 's1';
  const items = ['s1', 's2'].map((k) => item('data-scene-id', k, k === 's1', 'active'));
  const S = load(env({ shelfTab: 'scenes', P: () => ({ cfg: () => ({}), activeSceneId: () => active }) }));
  active = 's2';
  S.syncShelf(host(items));
  assert.deepStrictEqual(onKeys(items), ['s2']);
});

test('her çizim sonunda eşitleniyor; Görsel/Zemin imzası seçime ve türe bağlı değil (kaydırma kalıyor)', () => {
  assert.match(SHELL, /shelfPainted = sig;\n      shelfStale = false;\n    \}\n    syncShelf\(c\);/);
  const sig = SHELL.match(/if \(shelfTab === 'vis' \|\| shelfTab === 'bg'\) \{\n      return [^\n]*\n/)[0];
  assert.doesNotMatch(sig, /selected\(\)|\.type/);
  for (const s of ['vis', 'bg', 'milkdrop', 'templates', 'scenes']) assert.ok(new RegExp('\\n    ' + s + ': \\{').test(SHELL), s);
  // Kartlar anahtarını taşıyor
  assert.match(SHELL, /'data-cur': it\.id/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src/admin/template-panel.js'), 'utf8'), /'data-cur': t\.id/);
});
