'use strict';
/* BARLAR KATMANI (#878).
 *  - Görselleştirici kartının sunduğu her `visualizer.*` ayarı katman
 *    kartında da var. İki kart elle tutulan iki liste olduğu için ayrışmıştı:
 *    zemin yansıması, frekans aralığı ve tayf ölçümü katmanda yoktu.
 *  - Aynı bar düzenini isteyen iki çizici tek motoru paylaşıyordu ve her
 *    çağrı balistiği bir adım daha ilerletiyordu. Artık anahtar bütün
 *    ayarları içeriyor ve aynı karede ikinci çağrı ilk sonucu alıyor.
 *  - Tepe noktalarının düşüşü kare sayısına değil süreye bağlı. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf-8');

/* Katman kartında bilerek olmayanlar, nedenleriyle:
   type — katmanın türü kart başlığındaki seçicide;
   rainbow — eski kayıtların alanı, Renk Modu yazıyor. */
const LAYER_EXEMPT = new Set(['type', 'rainbow']);
// Katman kartında başka adla okunanlar
const LAYER_READ = { colorMode: 'getColorMode(' };

test('#878: Görselleştirici kartındaki her ayar katman kartında da var', () => {
  const admin = read('src/admin/admin.js');
  const i = admin.indexOf("id: 'visualizer',");
  const j = admin.indexOf("id: 'layers'", i);
  assert.ok(i > 0 && j > i, 'Görselleştirici bölümü bulunamadı');
  const paths = [...new Set([...admin.slice(i, j).matchAll(/path: 'visualizer\.([A-Za-z.]+)'/g)].map((m) => m[1]))];
  assert.ok(paths.length >= 20, 'beklenenden az ayar: ' + paths.length);
  const layer = read('src/admin/scene-panels.js');
  const missing = paths.filter((p) => {
    if (LAYER_EXEMPT.has(p)) return false;
    if (LAYER_READ[p]) return !layer.includes(LAYER_READ[p]);
    const key = p.replace(/^spectrum\./, '');
    const getter = p.startsWith('spectrum.') ? 'getS' : 'getV';
    return !layer.includes(getter + "('" + key + "'");
  });
  assert.deepStrictEqual(missing, [], 'katman kartında eksik: ' + missing.join(', '));
});

function loadAudio() {
  const win = { performance: { now: () => 1000 } };
  win.window = win;
  const ctx = vm.createContext(win);
  vm.runInContext(read('src/shared/spectrum.js'), ctx, { filename: 'spectrum.js' });
  vm.runInContext(read('src/visualizer/audio.js'), ctx, { filename: 'audio.js' });
  return new win.SVAudio();
}

function frame(level) {
  const freq = new Uint8Array(1024).fill(level);
  return { freq, time: new Uint8Array(2048).fill(128), sampleRate: 48000 };
}

// Ses bir kez yükselir; barlar bırakma süresince düşer
function run(callsPerFrame, opts) {
  const a = loadAudio();
  const out = [];
  for (let f = 0; f < 30; f++) {
    a.ingestFrame(frame(f < 5 ? 220 : 0));
    a.update(1 / 60);
    let bars;
    for (let c = 0; c < callsPerFrame; c++) bars = a.getBars(32, 30, 14000, opts);
    out.push(Array.from(bars));
  }
  return out;
}

test('#878: aynı karede iki çizici aynı barları alıyor, balistik bir adım', () => {
  const one = run(1);
  const two = run(2);
  assert.deepStrictEqual(two, one);
});

test('#878: atak/bırakması farklı iki çizici birbirinin durumunu bozmuyor', () => {
  const a = loadAudio();
  const b = loadAudio();
  for (let f = 0; f < 30; f++) {
    const fr = frame(f < 5 ? 220 : 0);
    a.ingestFrame(fr); b.ingestFrame(fr);
    a.update(1 / 60); b.update(1 / 60);
    a.getBars(32, 30, 14000, { release: 1 }); // başka bir katman
    const mine = Array.from(a.getBars(32, 30, 14000, { release: 0.05 }));
    const alone = Array.from(b.getBars(32, 30, 14000, { release: 0.05 }));
    assert.deepStrictEqual(mine, alone, 'kare ' + f);
  }
});

// bars.js'i sahte bir 2B bağlamla çalıştırıp tepe noktalarının yerini oku
function loadBars() {
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const win = {
    SVGlow: function () { this.apply = () => {}; },
    SV: { sampleThemeColor: () => '#fff', hexToRgb01: () => [1, 1, 1] },
  };
  win.window = win;
  vm.runInContext(read('src/visualizer/modes/bars.js'), vm.createContext(win), { filename: 'bars.js' });
  const canvas = { width: 400, height: 300, getContext: () => ctx };
  return new win.SVModes.bars(canvas);
}

function capDrop(hz) {
  const m = loadBars();
  const cfg = { visualizer: { barCount: 8, minFreq: 30, maxFreq: 14000, sensitivity: 1, gap: 0.2, cap: true, position: 'bottom', colorMode: 'custom', color: '#ffffff', glow: 0 } };
  let level = 1;
  const audio = { getBars: (n) => new Float32Array(n).fill(level) };
  m.draw(audio, cfg, 0); // tepe en üstte
  level = 0;
  const steps = Math.round(0.5 * hz);
  for (let k = 1; k <= steps; k++) m.draw(audio, cfg, k / hz);
  return m.peaks[0];
}

test('#878: tepe noktası aynı sürede aynı yere düşüyor (60 / 144 Hz)', () => {
  const p60 = capDrop(60);
  const p144 = capDrop(144);
  assert.ok(p60 > 0, 'tepe yarım saniyede tamamen düşmemeli: ' + p60);
  // Ayrık adımın farkı küçük kalmalı; eski davranışta 144 Hz'de tepe sıfıra iniyordu
  assert.ok(Math.abs(p60 - p144) < 0.03 * 300, '60 Hz ' + p60 + ' / 144 Hz ' + p144);
});
