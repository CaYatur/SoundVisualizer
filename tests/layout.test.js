'use strict';
/* Yayın düzeni (#534): güvenli alanlar, yakalama, öğe parametreleri ve
   çizicinin bildirdiği yerleşim kutuları. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const L = require('../src/shared/layout');
const root = path.join(__dirname, '..');
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('güvenli alanlar SMPTE ST 2046-1 / EBU R 95: %93 ve %90, eş merkezli', () => {
  assert.strictEqual(L.SAFE.action, 0.035);
  assert.strictEqual(L.SAFE.title, 0.05);
  assert.ok(close(1 - 2 * L.SAFE.action, 0.93));
  assert.ok(close(1 - 2 * L.SAFE.title, 0.90));
  const g = L.frameGuides();
  const xs = g.x.map((l) => l.at);
  [0, 0.5, 1, 0.035, 0.965, 0.05, 0.95].forEach((p) => assert.ok(xs.some((x) => close(x, p)), String(p)));
  assert.deepStrictEqual(g.x.map((l) => l.kind).sort(), ['action', 'action', 'center', 'edge', 'edge', 'title', 'title']);
  // Kaynak kod yorumunda maddeler yazılı
  const src = fs.readFileSync(path.join(root, 'src/shared/layout.js'), 'utf8');
  assert.match(src, /SMPTE ST 2046-1:2009 §5\.1/);
  assert.match(src, /EBU R 95 v1\.1 madde 5/);
});

test('yakalama: en yakın kenar/merkez eşik içinde kazanır, dışında dokunulmaz', () => {
  const g = L.frameGuides();
  // Sol kenar 0,052 → başlık güvenli alanına (0,05)
  let r = L.snapBox({ x: 0.052, y: 0.3, w: 0.2, h: 0.1 }, g, 0.01, 0.01);
  assert.ok(close(r.box.x, 0.05));
  assert.strictEqual(r.x.kind, 'title');
  assert.strictEqual(r.y, null, 'dikeyde eşik içinde çizgi yok');
  // Merkez 0,503 → 0,5
  r = L.snapBox({ x: 0.403, y: 0.3, w: 0.2, h: 0.1 }, g, 0.01, 0.01);
  assert.ok(close(r.box.x + r.box.w / 2, 0.5));
  assert.strictEqual(r.x.kind, 'center');
  // Eşik dışı: hiç kaymıyor
  r = L.snapBox({ x: 0.2, y: 0.2, w: 0.1, h: 0.1 }, g, 0.005, 0.005);
  assert.deepStrictEqual(r.box, { x: 0.2, y: 0.2, w: 0.1, h: 0.1 });
  // Diğer öğenin kenarına: alt kenar komşunun üstüne oturur
  const other = { x: 0.1, y: 0.7, w: 0.3, h: 0.1 };
  r = L.snapBox({ x: 0.6, y: 0.495, w: 0.2, h: 0.2 }, L.elementGuides([other]), 0.01, 0.01);
  assert.ok(close(r.box.y + r.box.h, 0.7));
  assert.strictEqual(r.y.kind, 'element');
});

test('katman yığınında konum katmanın kendi ayarına yazılıyor; okunan birleşik değer', () => {
  const cfg = { layerStack: { enabled: true }, visualizer: { barCenterX: 0.5, baseline: 0.62, barSpan: 0.86, barHeight: 0.3 } };
  const bars = { id: 'b', kind: 'visualizer', type: 'bars', settings: {} };
  assert.strictEqual(L.kindOf(bars), 'bars');
  L.moveBy(bars, cfg, 0.1, -0.02);
  assert.ok(close(bars.settings.visualizer.barCenterX, 0.6));
  assert.ok(close(bars.settings.visualizer.baseline, 0.6));
  assert.strictEqual(cfg.visualizer.barCenterX, 0.5, 'genel ayar değişmemeli');
  assert.strictEqual(bars.settings.visualizer.barSpan, undefined, 'yalnız değişen alan yazılır');
  // Sınır: karenin dışına taşmaz
  L.moveBy(bars, cfg, 5, 5);
  assert.strictEqual(bars.settings.visualizer.barCenterX, 1);
  // Sayısal alan: sınırlar ve geçersiz girdi
  assert.strictEqual(L.setField(bars, cfg, 'barSpan', 2), true);
  assert.strictEqual(bars.settings.visualizer.barSpan, 1);
  assert.strictEqual(L.setField(bars, cfg, 'barSpan', 'abc'), false);
  assert.strictEqual(L.getField(bars, cfg, 'barHeight'), 0.3);
  // Kart ve metin
  const card = { id: 'c', kind: 'nowplaying', type: 'nowplaying', settings: { nowplaying: { x: 0.07, y: 0.82 } } };
  L.moveBy(card, cfg, 0.01, 0.01);
  assert.ok(close(card.settings.nowplaying.x, 0.08) && close(card.settings.nowplaying.y, 0.83));
  const text = { id: 't', kind: 'visualizer', type: 'text', settings: { text: { align: 'left' } } };
  L.moveBy(text, cfg, 0.01, 0);
  assert.ok(close(text.settings.text.x, 0.07), 'sol hizalı metnin varsayılan x\'i 0,06');
  // Düzenlenemeyen katman
  assert.strictEqual(L.kindOf({ kind: 'background', type: 'gradient' }), null);
  assert.strictEqual(L.moveBy({ kind: 'background' }, cfg, 0.1, 0.1), null);
});

test('katmansız kipte genel ayar; logo birleştirilmeden çizicinin okuduğu nesneye', () => {
  const cfg = { visualizer: { barCenterX: 0.5 }, logo: { src: 'x.png', x: 0.5, y: 0.5, scale: 0.2 } };
  const bars = { kind: 'visualizer', type: 'bars' };
  L.moveBy(bars, cfg, -0.1, 0);
  assert.ok(close(cfg.visualizer.barCenterX, 0.4));
  // Logo katmanının kendi logosu yoksa genel logo; kaynağı korunur
  const logo = { kind: 'logo', settings: {} };
  L.moveBy(logo, Object.assign(cfg, { layerStack: { enabled: true } }), 0.1, 0);
  assert.ok(close(cfg.logo.x, 0.6));
  assert.strictEqual(cfg.logo.src, 'x.png');
  assert.strictEqual(logo.settings.logo, undefined, 'katmana kısmi logo yazılmadı');
  // Kendi logosu varsa o
  const own = { kind: 'logo', settings: { logo: { src: 'y.png', x: 0.2, y: 0.2 } } };
  L.moveBy(own, cfg, 0, 0.1);
  assert.ok(close(own.settings.logo.y, 0.3));
  assert.strictEqual(own.settings.logo.src, 'y.png');
});

test('yedek kutu: barlar alttan ve ortadan, kartın hizası', () => {
  let b = L.KINDS.bars.fallbackBox({ barCenterX: 0.5, barSpan: 0.8, baseline: 0.62, barHeight: 0.3 });
  assert.ok(close(b.x, 0.1) && close(b.w, 0.8) && close(b.y, 0.32) && close(b.h, 0.3));
  b = L.KINDS.bars.fallbackBox({ position: 'center', barSpan: 1, barHeight: 0.2 });
  assert.ok(close(b.y, 0.3) && close(b.h, 0.4), 'orta konumda taban çizgisinin iki yanı');
  const c = L.KINDS.nowplaying.fallbackBox({ x: 0.07, y: 0.82, align: 'left', maxWidth: 0.6, size: 0.05 });
  assert.ok(close(c.x, 0.07) && close(c.w, 0.6));
});

// ---- Çizicinin bildirdiği kutu (bars modu, sahte tuval)
function fakeCanvas(W, H) {
  const ctx = new Proxy({}, { get: (_, k) => (k === 'measureText' ? (s) => ({ width: String(s).length * 10 }) : () => {}), set: () => true });
  return { width: W, height: H, getContext: () => ctx };
}
function loadMode(file, name, extra) {
  const ctx = { window: { SVGlow: function () { this.apply = () => {}; }, SV: { hexToRgb01: () => [1, 1, 1], sampleThemeColor: () => '#fff' } }, console };
  Object.assign(ctx.window, extra || {});
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx);
  return ctx.window.SVModes[name];
}

test('bars modu yerleşim alanını bildiriyor (sesten bağımsız)', () => {
  const Bars = loadMode('src/visualizer/modes/bars.js', 'bars');
  const m = new Bars(fakeCanvas(1920, 1080));
  const audio = { getBars: (n) => new Float32Array(n).fill(0.9) };
  const v = { barCount: 32, gap: 0.3, sensitivity: 1, position: 'bottom', barSpan: 0.86, barCenterX: 0.5, baseline: 0.62, barHeight: 0.3, color: '#fff' };
  m.draw(audio, { visualizer: v }, 0);
  const b = m.layoutBounds;
  assert.ok(close(b.x, 0.07, 1e-6) && close(b.w, 0.86, 1e-6) && close(b.y, 0.32, 1e-6) && close(b.h, 0.3, 1e-6), JSON.stringify(b));
  const quiet = { getBars: (n) => new Float32Array(n).fill(0) };
  m.draw(quiet, { visualizer: v }, 0);
  assert.deepStrictEqual(m.layoutBounds, b, 'sessizlikte de aynı kutu');
});

test('metin, kart ve logo kutularını dinlenme hâlinde bildiriyor (kaynak sözleşmesi)', () => {
  const text = fs.readFileSync(path.join(root, 'src/visualizer/modes/text.js'), 'utf8');
  assert.match(text, /this\.layoutBounds = null;/);
  assert.match(text, /giriş canlandırması ve nabız OLMADAN/);
  const np = fs.readFileSync(path.join(root, 'src/visualizer/modes/nowplaying.js'), 'utf8');
  assert.match(np, /this\.layoutBounds = null;/);
  assert.match(np, /if \(coverReady\) \{\s*\n\s*let ccx = 0;/, 'kapak kutuya giriyor');
  const layers = fs.readFileSync(path.join(root, 'src/visualizer/layers.js'), 'utf8');
  assert.match(layers, /e\.layoutBounds = this\._paintLogo\(/);
  assert.match(layers, /const restW = minDim \* scale;/, 'logo kutusu nabızsız');
  assert.match(layers, /layoutBounds\(\) \{/);
});
