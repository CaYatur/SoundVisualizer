'use strict';
/* BAR BİÇİMİ (#879): LED blokları, köşe yarıçapı, dikey degrade, aşağı
 * büyüme, tepe bekleme / düşüş hızı / ayrı renk. Varsayılanlar eski çizimi
 * birebir vermeli: aynı çağrı dizisi. Canlı ve dışa aktarım eşliği
 * `npm run parity`'deki 'bars-led' ve 'bars-down' durumlarında. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf-8');

function loadBars() {
  const calls = [];
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createLinearGradient') return (...a) => { calls.push(['grad', ...a]); return { addColorStop: (o, c) => calls.push(['stop', o, c]) }; };
      return (...a) => calls.push([k, ...a]);
    },
    set(t, k, v) { t[k] = v; calls.push(['set', k, typeof v === 'object' ? 'grad' : v]); return true; },
  });
  const win = {
    SVGlow: function () { this.apply = () => {}; },
    SV: { sampleThemeColor: (c, x) => 'theme' + x.toFixed(2), hexToRgb01: () => [0.5, 0.5, 0.5] },
  };
  win.window = win;
  vm.runInContext(read('src/visualizer/modes/bars.js'), vm.createContext(win), { filename: 'bars.js' });
  const mode = new win.SVModes.bars({ width: 400, height: 300, getContext: () => ctx });
  return { mode, calls };
}

const BASE = { barCount: 8, minFreq: 30, maxFreq: 14000, sensitivity: 1, gap: 0.2, cap: true, position: 'bottom', colorMode: 'custom', color: '#ff0000', color2: '#0000ff', glow: 0 };
const audioAt = (level) => ({ getBars: (n) => new Float32Array(n).fill(level) });

function frames(extra, levels) {
  const { mode, calls } = loadBars();
  const cfg = { visualizer: Object.assign({}, BASE, extra) };
  (levels || [0.8, 0.2, 0.2]).forEach((lv, k) => mode.draw(audioAt(lv), cfg, k / 60));
  return { mode, calls };
}

test('#879: varsayılan değerler eski çizimin çağrı dizisini aynen veriyor', () => {
  const old = frames({});
  const explicit = frames({ barStyle: 'solid', segmentSize: 0.035, segmentGap: 0.3, barRadius: 0.4, barFill: 'flat', barDirection: 'up', capHold: 0, capFall: 1, capColorMode: 'auto', capColor: '#ffffff' });
  assert.deepStrictEqual(explicit.calls, old.calls);
  assert.ok(!old.calls.some((c) => c[0] === 'grad'), 'düz dolguda degrade yok');
});

test('#879: LED stili tam bloklar çiziyor', () => {
  const { calls } = frames({ barStyle: 'segments', segmentSize: 0.1, segmentGap: 0.25, cap: false }, [0.5]);
  // maxH = 300 × 0,92 = 276; blok 27,6 px; 0,5 × 276 = 138 → 5 blok × 8 bar
  const fills = calls.filter((c) => c[0] === 'fill').length;
  assert.strictEqual(fills, 5 * 8);
});

test('#879: dikey degrade tabandan en yüksek bar boyuna, uç ikincil renk', () => {
  const { calls } = frames({ barFill: 'gradient', cap: false }, [0.5]);
  const g = calls.find((c) => c[0] === 'grad');
  assert.deepStrictEqual(g.slice(1), [0, 300, 0, 300 - 276]);
  const stops = calls.filter((c) => c[0] === 'stop').slice(0, 2).map((c) => c[2]);
  assert.deepStrictEqual(stops, ['#ff0000', '#0000ff']);
});

test('#879: aşağı büyüyen barlar tabanın altında; yerleşim kutusu da', () => {
  const { mode, calls } = frames({ barDirection: 'down', baseline: 0.2, cap: false }, [0.5]);
  const rects = calls.filter((c) => c[0] === 'moveTo').map((c) => c[2]);
  assert.ok(rects.length && rects.every((y) => y >= 60), 'bar tabandan (60 px) aşağıda başlamalı: ' + rects.slice(0, 3));
  assert.ok(Math.abs(mode.layoutBounds.y - 0.2) < 1e-9, 'kutu tabanda başlıyor');
});

test('#879: tepe bekleme süresi dolmadan tepe düşmüyor; düşüş hızı çarpanı', () => {
  const hold = frames({ capHold: 0.5 }, [1, 0, 0, 0, 0, 0, 0, 0, 0, 0]).mode.peaks[0];
  assert.ok(Math.abs(hold - 276) < 1e-6, 'bekleme sırasında tepe yerinde: ' + hold);
  const slow = frames({ capFall: 0.5 }, [1, 0, 0, 0, 0, 0, 0, 0, 0, 0]).mode.peaks[0];
  const fast = frames({ capFall: 2 }, [1, 0, 0, 0, 0, 0, 0, 0, 0, 0]).mode.peaks[0];
  assert.ok(slow > fast, 'yavaş ' + slow + ' / hızlı ' + fast);
});

test('#879: ayrı tepe rengi', () => {
  const { calls } = frames({ capColorMode: 'custom', capColor: '#00ff00' }, [0.5]);
  const sets = calls.filter((c) => c[0] === 'set' && c[1] === 'fillStyle').map((c) => c[2]);
  assert.ok(sets.includes('#00ff00'));
});

test('#879: eşlik düzeneğinde LED ve aşağı büyüme durumları var', () => {
  const lib = read('scripts/parity-lib.js');
  assert.match(lib, /name: 'bars-led'/);
  assert.match(lib, /name: 'bars-down'/);
});
