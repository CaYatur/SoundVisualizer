'use strict';
/* BAR ZEMİN YANSIMASI (#842): taban çizgisinin altına barların aynası, aşağı
 * doğru sönerek. Varsayılan kapalı; canlı ve dışa aktarım aynı çizimden
 * (npm run parity'de 'bars-reflection' durumu). Çizim GL'siz Node'da
 * koşturulamadığı için burada bağlantılar ve sahte bir 2B bağlamla çağrı
 * sırası denetleniyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf-8');

// Kaydeden sahte 2B bağlam: yansıma adımlarının sırasını görmek için
function fakeCanvas(W, H) {
  const calls = [];
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createLinearGradient') return () => ({ addColorStop: (o, c) => calls.push(['stop', o, c]) });
      return (...a) => calls.push([k, ...a]);
    },
    set(t, k, v) { t[k] = v; calls.push(['set', k, v]); return true; },
  });
  return { canvas: { width: W, height: H, getContext: () => ctx }, calls };
}

test('varsayılan kapalı; panelde tabanda duran barlarda', () => {
  const D = read('src/shared/defaults.js');
  assert.match(D, /reflection: 0, \/\/ zemin yansıması/);
  assert.match(D, /reflectionLength: 0\.4,/);
  const admin = read('src/admin/admin.js');
  assert.match(admin, /path: 'visualizer\.reflection', label: 'Zemin Yansıması'/);
  assert.match(admin, /path: 'visualizer\.reflectionLength', label: 'Yansıma Boyu'/);
  const i18n = read('src/shared/i18n.js');
  assert.ok(i18n.includes("'Zemin Yansıması': 'Floor Reflection'") && i18n.includes("'Yansıma Boyu': 'Reflection Length'"));
  assert.match(read('scripts/parity-lib.js'), /name: 'bars-reflection'/);
});

test('çizim: aynalama, sonra yalnız tabanın altında degradeli silme; parlamadan önce', () => {
  const src = read('src/visualizer/modes/bars.js');
  const i = src.indexOf('const refl = clamp01(Number(v.reflection) || 0);');
  assert.ok(i > 0);
  const block = src.slice(i, src.indexOf('this.glow.apply', i));
  // Ortada ve aşağı büyüyen barlarda (#879) yansıma yok
  assert.match(block, /!centred && !down && baseY < H - 1/);
  assert.match(block, /ctx\.translate\(0, 2 \* baseY\);\s+ctx\.scale\(1, -1\);/);
  assert.match(block, /globalCompositeOperation = 'destination-out'/);
  assert.match(block, /ctx\.fillRect\(areaX - 1, baseY, areaW \+ 2, len \+ 1\)/, 'silme yalnız tabanın altında');
});

test('sahte bağlamda: yansıma açıkken kendi üstüne çiziyor, kapalıyken çizmiyor', () => {
  const win = { SVGlow: function () { this.apply = () => {}; }, SV: { sampleThemeColor: () => '#fff' } };
  const sandbox = { window: win, Math, Float32Array };
  vm.createContext(sandbox);
  vm.runInContext(read('src/visualizer/modes/bars.js'), sandbox);
  const Mode = Object.values(win).find((x) => typeof x === 'function' && x.prototype && x.prototype.draw && /bars/i.test(x.name || ''))
    || (win.SVModes && win.SVModes.bars);
  const audio = { getBars: (n) => new Array(n).fill(0.5) };
  const base = { type: 'bars', barCount: 16, minFreq: 20, maxFreq: 20000, sensitivity: 1, gap: 0.2, position: 'bottom',
    baseline: 0.6, barHeight: 0.4, colorMode: 'custom', color: '#3aa6ff', glow: 0, cap: false };
  const run = (vis) => {
    const f = fakeCanvas(400, 200);
    const m = new Mode(f.canvas);
    m.draw(audio, { visualizer: Object.assign({}, base, vis) }, 0);
    return f.calls;
  };
  assert.ok(Mode, 'bar modu bulunamadı');
  const off = run({ reflection: 0 });
  assert.ok(!off.some((c) => c[0] === 'drawImage'), 'kapalıyken yansıma çizilmemeli');
  const on = run({ reflection: 0.6, reflectionLength: 0.5 });
  const di = on.findIndex((c) => c[0] === 'drawImage');
  assert.ok(di > 0, 'açıkken tuval kendi üstüne çizilmeli');
  assert.ok(on.slice(di).some((c) => c[0] === 'set' && c[1] === 'globalCompositeOperation' && c[2] === 'destination-out'));
  const center = run({ reflection: 0.6, position: 'center', baseline: null });
  assert.ok(!center.some((c) => c[0] === 'drawImage'), 'ortada duran barlarda yansıma yok');
});
