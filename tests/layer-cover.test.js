'use strict';
/* ÖRTÜLEN KATMANLAR ÇİZİLMİYOR (#560, madde 8).
 *
 * Katmansız kipte MilkDrop seçilince arkaplan yine kuruluyor ve her karede
 * çiziliyordu; MilkDrop tuvalin tamamını opak kapladığı için hiç
 * görünmüyordu. Ölçüldü (1920x1080, kare hızı sınırsız, yalıtılmış kopya):
 * 2D aurora arkaplanı kare başına ~0,43 ms.
 *
 * Testler gerçek `LayerStack`i sahte tuvallerle çiziyor: hangi motorun
 * `draw`ının çağrıldığını ve hangi tuvalin birleştirildiğini sayıyor.
 */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
require('../src/shared/defaults.js');
const L = require('../src/visualizer/layers.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const CFG = { layerStack: { enabled: false }, background: { type: 'gradient' }, visualizer: { type: 'milkdrop' } };
const AUDIO = { ready: true, level: 0.5, bass: 0.5, mid: 0.5, treble: 0.5 };

function ctx2d() {
  const c = { drawn: [], clearRect() {}, fillRect() {}, save() {}, restore() {}, setTransform() {},
    translate() {}, rotate() {}, scale() {}, drawImage(src) { c.drawn.push(src.name); } };
  return c;
}
function canvas(name) { return { name, width: 320, height: 180, style: { visibility: '' } }; }

/* İki katman: altta WebGL gradyan, üstte MilkDrop. `covers` MilkDrop'un
   son karesinin tuvali opak kaplayıp kaplamadığı. */
function scene(opts = {}) {
  const stack = new L.LayerStack(null, {});
  stack.width = 320;
  stack.height = 180;
  const bgMode = { draws: 0, draw() { this.draws++; } };
  const mdMode = { draws: 0, cover: opts.cover !== false, draw() { this.draws++; }, covers() { return this.cover; } };
  const bg = { layer: L.normalizeLayer({ id: 'ly_bg', kind: 'background', type: 'gradient' }),
    key: 'bg', canvas: canvas('arkaplan'), ctx: ctx2d(), mode: bgMode, gl: true };
  const md = { layer: L.normalizeLayer(Object.assign({ id: 'ly_vis', kind: 'visualizer', type: 'milkdrop' }, opts.layer || {})),
    key: 'md', canvas: canvas('milkdrop'), ctx: ctx2d(), mode: mdMode, gl: false };
  stack.entries = [bg, md];
  return { stack, bg, md, bgMode, mdMode };
}

test('opak kaplayan MilkDrop altındaki arkaplanı örtüyor: çizilmiyor, tuvali gizli', () => {
  const s = scene();
  assert.strictEqual(s.stack._coverFloor(AUDIO, CFG), 1);
  s.stack.draw(AUDIO, CFG, 0, 1 / 60);
  assert.strictEqual(s.bgMode.draws, 0, 'örtülen arkaplan çizildi');
  assert.strictEqual(s.mdMode.draws, 1, 'MilkDrop çizilmeli');
  assert.strictEqual(s.bg.canvas.style.visibility, 'hidden', 'birleştirici de atlamalı');
  assert.strictEqual(s.md.canvas.style.visibility, '', 'örten katman gizlenmemeli');
});

test('örtmüyorsa arkaplan çiziliyor; örtme kalkınca aynı karede geri geliyor', () => {
  const s = scene({ cover: false });
  s.stack.draw(AUDIO, CFG, 0, 1 / 60);
  assert.strictEqual(s.bgMode.draws, 1);
  assert.strictEqual(s.bg.canvas.style.visibility, '');
  s.mdMode.cover = true;
  s.stack.draw(AUDIO, CFG, 0, 1 / 60);
  assert.strictEqual(s.bgMode.draws, 1, 'örtülünce durmalı');
  assert.strictEqual(s.bg.canvas.style.visibility, 'hidden');
  s.mdMode.cover = false;
  s.stack.draw(AUDIO, CFG, 0, 1 / 60);
  assert.strictEqual(s.bgMode.draws, 2, 'açılınca aynı karede yeniden çizilmeli');
  assert.strictEqual(s.bg.canvas.style.visibility, '', 'açılınca görünmeli');
});

test('alttakini gösteren her şey örtmeyi bozuyor', () => {
  const cases = {
    'karışım ekran': { layer: { blend: 'screen' } },
    'opaklık %99': { layer: { opacity: 0.99 } },
    'ölçek': { layer: { transform: { scale: 1.1 } } },
    'kaydırma': { layer: { transform: { x: 0.1 } } },
    'maske': { layer: { mask: { type: 'rect' } } },
    'katman efekti': { layer: { postfx: [{ type: 'bloom' }] } },
    'motor örtmüyor': { cover: false },
  };
  for (const [name, opts] of Object.entries(cases)) {
    const s = scene(opts);
    assert.strictEqual(s.stack._coverFloor(AUDIO, CFG), -1, name + ' örtmemeli');
  }
  // Kapalı efekt örtmeyi bozmuyor
  assert.strictEqual(scene({ layer: { postfx: [{ type: 'bloom', enabled: false }] } }).stack._coverFloor(AUDIO, CFG), 1);
  // Ses hazır değilse görselleştiricinin tuvali o karede TEMİZLENİYOR
  assert.strictEqual(scene().stack._coverFloor({ ready: false }, CFG), -1, 'ses yokken örtmemeli');
  assert.strictEqual(scene().stack._coverFloor(null, CFG), -1);
  // Geçişteki vekilin tuvalini varış yığını çiziyor
  const p = scene();
  p.md.proxyOf = {};
  assert.strictEqual(p.stack._coverFloor(AUDIO, CFG), -1, 'vekil örtmemeli');
});

test('ışıklar arkaplandan renk örnekliyorsa arkaplan çizilmeye devam ediyor', () => {
  /* `palette()` gradyanın tuvalini okuyor; çizilmezse ışıklar donmuş bir
     kareden renk alırdı. */
  const s = scene();
  s.bgMode.sampleColors = () => ['#123456'];
  assert.deepStrictEqual(s.stack.palette(CFG), ['#123456']);
  s.stack.draw(AUDIO, CFG, 0, 1 / 60);
  assert.strictEqual(s.bgMode.draws, 1, 'örneklenen arkaplan çizilmeli');
  assert.strictEqual(s.bg.canvas.style.visibility, '');
  // Işıklar bırakınca (1,5 sn) yine örtülüyor
  s.stack._paletteAt -= 1600;
  s.stack.draw(AUDIO, CFG, 0, 1 / 60);
  assert.strictEqual(s.bgMode.draws, 1);
  assert.strictEqual(s.bg.canvas.style.visibility, 'hidden');
});

test('tek yüzey yolu (efekt zinciri, geçiş, dışa aktarma) örtülen katmanı ne çiziyor ne birleştiriyor', () => {
  const s = scene();
  const out = ctx2d();
  s.stack.drawTo(out, AUDIO, CFG, 0, 1 / 60);
  assert.strictEqual(s.bgMode.draws, 0);
  assert.deepStrictEqual(out.drawn, ['milkdrop']);
  s.mdMode.cover = false;
  const out2 = ctx2d();
  s.stack.drawTo(out2, AUDIO, CFG, 0, 1 / 60);
  assert.strictEqual(s.bgMode.draws, 1);
  assert.deepStrictEqual(out2.drawn, ['arkaplan', 'milkdrop']);
});

test('MilkDrop ancak son karesi tuvali opak kapladıysa örtüyor', () => {
  const src = read('src/visualizer/modes/milkdrop.js');
  const m = /\n    covers\(\) \{([\s\S]*?)\n    \}/.exec(src);
  assert.ok(m, 'covers() yok');
  const covers = new Function(m[1]);
  const at = (o) => covers.call(Object.assign({ canvas: { width: 1920, height: 1080 }, _coverW: 1920, _coverH: 1080 }, o));
  assert.strictEqual(at({}), true);
  assert.strictEqual(at({ canvas: { width: 1280, height: 720 } }), false, 'yeniden boyutlanan tuval boş');
  assert.strictEqual(at({ _coverW: 0 }), false, 'hiç kopyalanmadı ya da yedek yazı çizildi');
  assert.strictEqual(at({ _disposed: true }), false);
  assert.strictEqual(at({ canvas: { width: 0, height: 0 }, _coverW: 0, _coverH: 0 }), false);
  const B = bare(src);
  // Boyut ancak opak kopyadan HEMEN sonra yazılıyor, yedek yol sıfırlıyor
  assert.match(B, /c\.drawImage\(this\.gl2, 0, 0, W, H\);\s*this\._coverW = W;\s*this\._coverH = H;/);
  assert.match(B, /_fallback\(W, H\) \{\s*this\._coverW = 0;/);
  // Kopyalanan bağlam opak; öyle olmasaydı bütün bu kural yanlış olurdu
  assert.match(B, /getContext\('webgl2', \{\s*alpha: false,/);
});
