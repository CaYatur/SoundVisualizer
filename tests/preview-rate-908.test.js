'use strict';
/* ÇIKIŞ AÇIKKEN ÖNİZLEME VE KULLANILMAYAN ÇÖZÜMLEME (#908).
   Önizleme preview.js'in kendisiyle, sahte panelde koşuyor; sahne çizimleri ve
   ses güncellemeleri ayrı sayılıyor, çünkü asıl kural ikisinin ayrılması:
   Otomatik VJ'nin tempo motoru önizlemenin ses motorunu okuyor. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf-8');

function panel(power) {
  const win = { performance: { now: () => 0 }, devicePixelRatio: 1, addEventListener() {} };
  win.window = win;
  const node = () => ({
    style: {}, classList: { toggle() {} },
    getBoundingClientRect: () => ({ width: 320, height: 180 }),
  });
  const nodes = { previewStage: node(), pvStage: node(), pvLogo: node() };
  win.document = { getElementById: (id) => nodes[id] || null, hidden: false };
  let onFrame = null;
  win.requestAnimationFrame = (fn) => { onFrame = fn; return 1; };
  win.SV = { defaultConfig: () => ({ audio: {}, power: power || {} }), deepMerge: (a, b) => Object.assign({}, a, b) };
  const seen = { scene: 0, audio: 0, sceneDt: 0, modDt: 0 };
  win.SVModulation = {
    Modulator: class {
      update(c, a, t, dt) { seen.modDt += dt; }
      apply(c) { return c; }
      touches() { return false; }
    },
  };
  win.SVSprites = class { constructor() { this.items = []; } setItems() {} };
  win.SVMedia = class { constructor() { this.video = null; } apply() {} };
  win.SVLayers = {
    stackOn: () => false,
    LayerStack: class {
      resize() {} setConfig() {} setPostFX() {} bindMedia() {}
      setSprites() {} setMedia() {}
      draw(a, c, t, dt) { seen.scene++; seen.sceneDt += dt; }
    },
  };
  win.SVAudio = class {
    constructor() { this.analysis = null; }
    applyConfig() {}
    ingestFrame() {}
    update() { seen.audio++; }
  };
  win.SVDemoAudio = { SR: 48000, fill() {} };
  const ctx = vm.createContext(win);
  vm.runInContext(read('src/admin/preview.js'), ctx, { filename: 'preview.js' });
  assert.strictEqual(win.SVPreview.init(), true);
  let now = 700;
  const run = (seconds, hz) => {
    seen.scene = 0; seen.audio = 0; seen.sceneDt = 0; seen.modDt = 0;
    for (let i = 0; i < seconds * hz; i++) { onFrame(now); now += 1000 / hz; }
    return Object.assign({}, seen);
  };
  return { win, run };
}

test('çıkış kapalıyken önizleme 45 kare, ses de 45', () => {
  const { run } = panel();
  run(1, 75);
  const r = run(4, 75);
  assert.ok(Math.abs(r.scene / 4 - 45) < 1, 'kare ' + r.scene / 4);
  assert.strictEqual(r.scene, r.audio);
});

test('çıkış açılınca yalnız çizim seyrekleşiyor, ses 45 Hz\'de kalıyor', () => {
  const { win, run } = panel();
  run(1, 75);
  win.SVPreview.setOutputOpen(true);
  const r = run(4, 75);
  assert.ok(Math.abs(r.scene / 4 - 20) < 1, 'çizim ' + r.scene / 4);
  assert.ok(Math.abs(r.audio / 4 - 45) < 1, 'ses ' + r.audio / 4);
  win.SVPreview.setOutputOpen(false);
  run(1, 75);
  const back = run(4, 75);
  assert.ok(Math.abs(back.scene / 4 - 45) < 1, 'kapanınca dönmedi: ' + back.scene / 4);
});

test('çizilmeyen karelerin süresi kaybolmuyor: zarflar yavaşlamıyor', () => {
  const { win, run } = panel();
  win.SVPreview.setOutputOpen(true);
  run(1, 75);
  const r = run(6, 75);
  assert.ok(Math.abs(r.sceneDt - 6) < 0.15, 'sahne süresi ' + r.sceneDt);
  assert.ok(Math.abs(r.modDt - 6) < 0.15, 'modülasyon süresi ' + r.modDt);
});

test('ayar: full çıkış açıkken de akıcı, low çıkış kapalıyken de seyrek', () => {
  const full = panel({ previewRate: 'full' });
  full.win.SVPreview.setOutputOpen(true);
  full.run(1, 75);
  assert.ok(Math.abs(full.run(4, 75).scene / 4 - 45) < 1);
  const low = panel({ previewRate: 'low' });
  low.run(1, 75);
  const r = low.run(4, 75);
  assert.ok(Math.abs(r.scene / 4 - 20) < 1);
  assert.ok(Math.abs(r.audio / 4 - 45) < 1);
});

test('ekranın tam böleni olmayan hızda da hedef tutuyor (60, 144 Hz)', () => {
  for (const hz of [60, 144]) {
    const { win, run } = panel();
    win.SVPreview.setOutputOpen(true);
    run(1, hz);
    const r = run(4, hz);
    assert.ok(Math.abs(r.scene / 4 - 20) < 1.5, hz + ' Hz: ' + r.scene / 4);
  }
});

// ------------------------------------------------------- çözümleme

const A = require('../src/shared/analysis.js');
const M = require('../src/shared/modulation.js');
require('../src/shared/defaults.js');

test('varsayılan ayarda çıkış penceresinde çözümleme gerekmiyor', () => {
  assert.strictEqual(A.neededBy(window.SV.defaultConfig()), false);
  assert.strictEqual(A.neededBy(null), false);
});

test('çözümleme okuyan her modülasyon kaynağı tanınıyor', () => {
  const list = M.catalog(window.SV.defaultConfig()).filter((s) => s.group === 'Çözümleme' || s.group === 'Nota Sınıfı');
  assert.ok(list.length > 20, 'katalog değişti: ' + list.length);
  for (const s of list) {
    assert.strictEqual(A.neededBy({ modulation: { routes: [{ source: s.id, target: 'x' }] } }), true, s.id);
  }
  // Motorun gerçekten ürettiği kaynaklar da
  const an = new A.Analyser({ sampleRate: 48000, fftSize: 2048 });
  for (const k of Object.keys(an.sources())) {
    assert.strictEqual(A.neededBy({ modulation: { routes: [{ source: k }] } }), true, k);
  }
  // Çözümleme okumayanlar açmıyor
  for (const id of ['bass', 'level', 'onset', 'lfo1', 'env1', 'fband1', 'macro1', 'band0', 'random', 'beatPhase', 'const']) {
    assert.strictEqual(A.neededBy({ modulation: { routes: [{ source: id }] } }), false, id);
  }
});

test('zarfın kaynağı da sayılıyor; OSC çıkışı ve iki mod da', () => {
  assert.strictEqual(A.neededBy({ modulation: { envelopes: [{ source: 'anKick' }] } }), true);
  assert.strictEqual(A.neededBy({ oscOut: { enabled: true } }), true);
  assert.strictEqual(A.neededBy({ oscOut: { enabled: true, analysis: false } }), false);
  assert.strictEqual(A.neededBy({ oscOut: { enabled: false } }), false);
  for (const type of ['goniometer', 'chromawheel']) {
    assert.strictEqual(A.neededBy({ visualizer: { type } }), true, type);
    assert.strictEqual(A.neededBy({ visualizer: { type: 'bars' }, layers: [{ kind: 'visualizer', type }] }), true, type);
  }
});

test('modlar içinde çözümleme okuyan başka mod yok', () => {
  // Yeni bir mod okumaya başlarsa `READING_MODES`e girmeli, yoksa donuk çizer
  const dir = path.join(root, 'src/visualizer/modes');
  const readers = [];
  for (const f of fs.readdirSync(dir)) {
    const s = fs.readFileSync(path.join(dir, f), 'utf-8');
    if (/audio\.analysis\b/.test(s)) readers.push(f);
  }
  assert.deepStrictEqual(readers, ['generative.js']);
  const gen = read('src/visualizer/modes/generative.js');
  assert.strictEqual(gen.split('audio.analysis').length - 1, 2, 'generative.js yeni okuyucu');
});

test('pencere: her karede ses güncellemeden önce, geçişte açık kalıyor', () => {
  const V = read('src/visualizer/visualizer.js');
  const a = V.indexOf('audio.setAnalysis(analysisWanted || !!stack.trans);');
  assert.ok(a > 0);
  assert.ok(a < V.indexOf('audio.update(dt);', a));
  assert.match(V, /analysisWanted = !window\.SVAnalysis \|\| window\.SVAnalysis\.neededBy\(cfg\);/);
});

test('ayarın çevirisi ve varsayılanı', () => {
  assert.strictEqual(window.SV.defaultConfig().power.previewRate, 'auto');
  const i18n = read('src/shared/i18n.js');
  for (const s of ['Panel Önizlemesi', 'Çıkış açıkken seyrek (önerilen)', 'Her zaman akıcı', 'Her zaman seyrek (düşük güç)']) {
    assert.ok(i18n.includes("'" + s + "':"), s);
  }
  assert.match(read('src/admin/admin.js'), /path: 'power\.previewRate'/);
});
