'use strict';
/* MilkDrop LİSTESİ SINIRSIZ (#635).
 *
 * Liste eskiden süzgecin ilk 400 presetini gösteriyor, gerisi için "aramayı
 * daraltın" diyordu. Şimdi her preset kaydırılarak bulunabiliyor; büyük
 * listede yalnız görünen pencere DOM'a giriyor, üstte ve altta iki boşluk
 * kutusu kaydırma çubuğunu gerçek boyunda tutuyor.
 *
 * Kaydırma ve ölçüm gerçek yerleşim istiyor (satır aralığı, ızgaranın sütun
 * sayısı); onlar uygulamada CDP ile doğrulandı. Burada ilk, eşzamanlı çizim
 * sınanıyor: kaç satır kuruluyor, boşluklar ne kadar, sınır notu yok.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;
const L = require('../src/shared/milkdrop-library.js');

// Kardeş sırası tutan küçük bir DOM: pencere düğümleri boşlukların arasına ekliyor
function el(tag, props, kids) {
  const n = { tag, props: props || {}, text: (props && props.text) || '', kids: [], on: {}, attrs: {}, style: {}, parent: null };
  n.className = (props && props.class) || '';
  n.value = (props && props.value) || '';
  n.appendChild = (c) => { if (c) { c.parent = n; n.kids.push(c); } return c; };
  n.insertBefore = (c, ref) => { c.parent = n; n.kids.splice(n.kids.indexOf(ref), 0, c); return c; };
  n.removeChild = (c) => { n.kids.splice(n.kids.indexOf(c), 1); c.parent = null; return c; };
  Object.defineProperty(n, 'nextSibling', {
    get: () => (n.parent ? n.parent.kids[n.parent.kids.indexOf(n) + 1] || null : null),
  });
  n.addEventListener = (ev, f) => { n.on[ev] = f; };
  n.setAttribute = (k, v) => { n.attrs[k] = v; };
  n.getAttribute = (k) => n.attrs[k];
  n.removeAttribute = () => {};
  n.contains = () => false;
  n.querySelectorAll = () => [];
  n.querySelector = () => null;
  n.isConnected = false;
  n.clientHeight = 0;
  n.scrollTop = 0;
  Object.defineProperty(n, 'textContent', { get: () => n.text, set: (v) => { n.text = v; n.kids = []; } });
  for (const k of Object.keys(n.props)) if (k.indexOf('on') === 0 && typeof n.props[k] === 'function') n.on[k.slice(2)] = n.props[k];
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}
const walk = (n, f) => { if (!n || typeof n !== 'object') return; f(n); (n.kids || []).forEach((k) => walk(k, f)); if (n.node) walk(n.node, f); };

async function panelWith(count, activeAt) {
  const key = require.resolve('../src/admin/milkdrop-panel.js');
  delete require.cache[key];
  const cfg = SV.defaultConfig();
  const MY = Array.from({ length: count }, (_, i) => ({
    id: 'u' + i, kind: 'milkdrop', name: 'Yazar - Preset ' + String(i).padStart(5, '0'), source: '[preset00]\n',
  }));
  cfg.milkdrop.presetId = activeAt == null ? null : 'u' + activeAt;
  global.document = { querySelector: () => null, getElementById: () => null, activeElement: null };
  global.localStorage = { getItem: () => null, setItem: () => {} };
  window.SVMilkdropCycle = require('../src/shared/milkdrop-cycle.js');
  window.SVMilkdropLibrary = L;
  window.SVMilkdropBuiltins = [];
  window.api = { listPresets: () => Promise.resolve(MY) };
  window.SVPanel = {
    cfg: () => cfg, apply() {}, rerender() {}, el,
    row: (label, node) => ({ label, node }), confirm: () => Promise.resolve(true), toast() {},
  };
  window.SVScenePanels = { miniSlider: (label) => ({ label, kids: [] }) };
  window.SVMdFollow = null;
  const M = require('../src/admin/milkdrop-panel.js');
  M.init();
  await new Promise((r) => setImmediate(r));
  return M.panel();
}
const listOf = (root) => root.kids.find((n) => n && n.className === 'md-list');
const notes = (root) => { const out = []; walk(root, (n) => { if (/studio-note/.test(n.className || '')) out.push(n.text); }); return out; };

test('liste: küçük kitaplıkta her satır, boşluk kutusu yok', async () => {
  const list = listOf(await panelWith(150));
  assert.strictEqual(list.kids.length, 150);
  assert.ok(!list.kids.some((k) => k.className === 'md-spacer'));
});

test('liste: büyük kitaplıkta yalnız görünen pencere, boşluklar gerçek boyda', async () => {
  const N = 10347;
  const root = await panelWith(N);
  const list = listOf(root);
  const spacers = list.kids.filter((k) => k.className === 'md-spacer');
  assert.strictEqual(spacers.length, 2, 'üst ve alt boşluk');
  assert.strictEqual(list.kids[0], spacers[0]);
  assert.strictEqual(list.kids[list.kids.length - 1], spacers[1]);
  const items = list.kids.filter((k) => k.className !== 'md-spacer');
  // Varsayılan 300 px kutu, 28 px satır: 11 görünür + 6 pay
  assert.ok(items.length > 10 && items.length < 40, 'pencere küçük: ' + items.length);
  assert.strictEqual(items[0].kids.find((k) => k.className === 'md-name').text, 'Yazar - Preset 00000');
  assert.strictEqual(spacers[0].style.height, '0px');
  assert.strictEqual(spacers[1].style.height, ((N - items.length) * 28) + 'px', 'alt boşluk kalan satırlar kadar');
});

test('liste: "ilk 400" notu ve sınırı yok', async () => {
  const root = await panelWith(1000);
  assert.ok(!notes(root).some((t) => /400/.test(t)), notes(root).join(' | '));
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'milkdrop-panel.js'), 'utf8');
  assert.ok(!/slice\(0, 400\)/.test(src));
  assert.ok(!/ilk 400/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'i18n.js'), 'utf8')));
});

/* Boşluk kutuları esnek listede küçülmemeli (içleri boş, `min-height: auto`
   onları sıfıra indirir ve kaydırma çubuğu kısalır), ızgarada da bütün
   sütunları kaplamalı (kaplamazsa pencerenin ilk hücresi satır ortasına düşer). */
test('stil: boşluk kutusu küçülmüyor ve bütün sütunları kaplıyor', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'studio.css'), 'utf8');
  const m = /\.md-spacer \{([^}]*)\}/.exec(css);
  assert.ok(m, '.md-spacer kuralı yok');
  assert.match(m[1], /flex: none/);
  assert.match(m[1], /grid-column: 1 \/ -1/);
});
