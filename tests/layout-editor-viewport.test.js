'use strict';
/* Düzen editörü: kaymayan görünüm, her katman listede, çerçeve dışı öğe tutulabilir.
   Kök neden: önizleme sahnesi `overflow: hidden` (kaydırılabilir) idi; çerçeve
   dışındaki kutu odak alınca tarayıcı sahneyi kaydırıyor, çerçeve kayık kalıyordu.
   Öğeler de çizicinin o anki listesinden geliyordu: gizli / sessiz / solo dışı katman
   ve çizelge çalarken hepsi editörden kayboluyordu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const LY = require('../src/shared/layout.js');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const ED = read('src/admin/layout-editor.js');
const CSS = read('src/admin/admin.css');

test('visibleFraction: içeride 1, yarısı dışarıda 0.5, tamamen dışarıda 0', () => {
  assert.ok(Math.abs(LY.visibleFraction({ x: 0.2, y: 0.2, w: 0.4, h: 0.4 }) - 1) < 1e-9);
  assert.ok(Math.abs(LY.visibleFraction({ x: 0.8, y: 0.1, w: 0.4, h: 0.2 }) - 0.5) < 1e-9);
  assert.strictEqual(LY.visibleFraction({ x: 0.2, y: 1.2, w: 0.4, h: 0.3 }), 0);
  assert.strictEqual(LY.visibleFraction(null), 0);
});

test('reachClamp: kutunun en az bir parçası çerçevede kalır', () => {
  const b = LY.reachClamp({ x: 0.3, y: 1.4, w: 0.4, h: 0.4 }, 0.03, 0.05);
  assert.ok(Math.abs(b.y - 0.95) < 1e-9, 'alt kenarda 0.05 kalır: ' + b.y);
  const c = LY.reachClamp({ x: -0.9, y: -0.9, w: 0.4, h: 0.4 }, 0.03, 0.05);
  assert.ok(Math.abs(c.x - (0.03 - 0.4)) < 1e-9);
  assert.ok(Math.abs(c.y - (0.05 - 0.4)) < 1e-9);
  // Çerçevede kalan kutu yerinde
  assert.deepStrictEqual(LY.reachClamp({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, 0.03, 0.05), { x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
  // Kutu eşikten küçükse kendisi kadar
  const tiny = LY.reachClamp({ x: 2, y: 0, w: 0.01, h: 0.01 }, 0.03, 0.03);
  assert.ok(Math.abs(tiny.x - 0.99) < 1e-9);
});

test('intoFrame: sığan kutu tamamen içeri, sığmayan ortalanır', () => {
  assert.deepStrictEqual(LY.intoFrame({ x: 0.8, y: 1.3, w: 0.4, h: 0.3 }), { x: 0.6, y: 0.7, w: 0.4, h: 0.3 });
  const big = LY.intoFrame({ x: 0.5, y: 0, w: 1.4, h: 0.5 });
  assert.ok(Math.abs(big.x + 0.2) < 1e-9);
});

test('elements(): gizli, sessiz ve çizilmeyen katmanlar da listede, bayraklarıyla', () => {
  const saved = global.window;
  const cfg = {
    layers: [
      { id: 'bg', kind: 'background', type: 'gradient' },
      { id: 'tx', kind: 'visualizer', type: 'text', settings: { text: {} } },
      { id: 'lg', kind: 'logo', type: 'logo', enabled: false },
      { id: 'np', kind: 'nowplaying', type: 'nowplaying', muted: true },
      { id: 'wb', kind: 'web', type: 'web', locked: true },
    ],
  };
  global.window = {
    SVPanel: { cfg: () => cfg },
    SVLayout: LY,
    SVPreview: { stack: () => ({ entries: [{ layer: { id: 'bg' } }, { layer: { id: 'tx' } }] }) },
  };
  global.localStorage = { getItem: () => null, setItem: () => {} };
  try {
    delete require.cache[require.resolve('../src/admin/layout-editor.js')];
    require('../src/admin/layout-editor.js');
    const els = global.window.SVLayoutEditor._elements();
    assert.deepStrictEqual(els.map((e) => e.id), ['tx', 'lg', 'np', 'wb'], 'arkaplan yerleştirilemez; gerisi hepsi');
    const by = Object.fromEntries(els.map((e) => [e.id, e]));
    assert.strictEqual(by.tx.drawn, true);
    assert.strictEqual(by.lg.hidden, true);
    assert.strictEqual(by.np.hidden, true);
    assert.strictEqual(by.wb.drawn, false);
    assert.strictEqual(by.wb.locked, true);
  } finally {
    global.window = saved;
    delete global.localStorage;
  }
});

test('görünüm kaymıyor: sahne ve kap kaydırılamaz, odak preventScroll ile', () => {
  assert.match(CSS, /\.preview-stage \{[^}]*overflow: hidden; overflow: clip;/);
  assert.match(CSS, /\.lay-stage-wrap \{[^}]*overflow: hidden; overflow: clip;/);
  assert.match(CSS, /\.preview-stage\.lay-stage \{ aspect-ratio: auto; overflow: visible; \}/);
  assert.match(ED, /function pinScroll\(s\)/);
  assert.match(ED, /pinScroll\(st\);/);
  // Editörün içindeki her odak çağrısı kaydırmasız (açanın odağı editör dışında)
  const bare = ED.split('\n').filter((l) => /\.focus\(\)/.test(l) && !/s\.opener\.focus\(\)/.test(l));
  assert.deepStrictEqual(bare, []);
  // Görünüm yalnız kullanıcıyla değişir: sürükleme fit() çağırmıyor
  const drag = ED.slice(ED.indexOf('function startDrag'), ED.indexOf('function startResize'));
  assert.doesNotMatch(drag, /fit\(\)/);
  assert.match(ED, /VIEW_SCALE = \{ fit: 1, wide: 0\.62 \}/);
});

test('sürükleme ve ok tuşu çerçeveden tamamen çıkarmıyor; kilitli öğe taşınmıyor', () => {
  assert.match(ED, /box = LY\(\)\.reachClamp\(box, MIN_REACH_PX \/ d\.rect\.width, MIN_REACH_PX \/ d\.rect\.height\);/);
  const nudge = ED.slice(ED.indexOf('function nudge'), ED.indexOf('function effectiveLayers'));
  assert.match(nudge, /LY\(\)\.reachClamp\(/);
  assert.match(nudge, /if \(e\.locked\) return;/);
  assert.match(ED, /select\(id\);\n    if \(e\.locked\) return;/);
  assert.match(ED, /text: 'Çerçeveye Getir'/);
});

test('önizleme araç çubuğu: en-boy seçici düğmelerle aynı hizada', () => {
  const PAGES = read('src/admin/pages.css');
  const rule = (PAGES.match(/\.sv-hud \.sv-hud-select \{[^}]*\}/) || [''])[0];
  // Genel `select { margin-top: 7px }` onu 3,5 px aşağı itiyordu
  assert.match(rule, /margin: 0;/);
  assert.match(rule, /align-self: center;/);
  assert.match(rule, /height: 26px;/);
  assert.match(rule, /appearance: none;/);
  assert.match(CSS, /\.preview-stage\.lay-stage \.sv-hud \{ display: none; \}/, 'editörde önizleme araçları gizli');
});
