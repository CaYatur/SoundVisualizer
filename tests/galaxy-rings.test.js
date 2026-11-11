'use strict';
/* Galaksi modu (#905): yıldızlar bir kez 48 halkaya diziliyor, renk halka başına bir kez ayarlanıyor.
   Eskiden kare başına 2600 renk hesabı, 2600 rgba metni ve 2600 fillStyle çözümlemesi vardı. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');

function load() {
  global.window = global.window || {};
  const w = global.window;
  w.SV = w.SV || {};
  w.SV.hexToRgb01 = (h) => { const n = parseInt(String(h || '#ffffff').slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  w.SVGlow = class { apply() {} };
  w.SVOnset = require('../src/shared/onset.js');
  delete require.cache[require.resolve('../src/visualizer/modes/generative.js')];
  require('../src/visualizer/modes/generative.js');
  return w.SVModes.galaxy;
}

function recorder() {
  const log = { fillStyle: 0, fillRect: 0, styles: [] };
  const ctx = new Proxy({}, {
    get(o, k) {
      if (k === 'fillRect') return () => { log.fillRect++; };
      if (k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k in o) return o[k];
      return () => {};
    },
    set(o, k, v) { if (k === 'fillStyle') { log.fillStyle++; log.styles.push(v); } o[k] = v; return true; },
  });
  return { log, canvas: { width: 1920, height: 1080, getContext: () => ctx } };
}

test('her yıldız tam bir halkada, halkalar yarıçapa göre sıralı', () => {
  const G = load();
  const { canvas } = recorder();
  const g = new G(canvas);
  const B = G.RINGS;
  assert.strictEqual(B % 16, 0, 'halka sayısı 16 bandın katı: bir halkadaki yıldızların bandı aynı');
  assert.strictEqual(g.ringStart[0], 0);
  assert.strictEqual(g.ringStart[B], g.N, 'bütün yıldızlar');
  const seen = new Set(g.order);
  assert.strictEqual(seen.size, g.N, 'her yıldız bir kez');
  for (let k = 0; k < B; k++) {
    for (let j = g.ringStart[k]; j < g.ringStart[k + 1]; j++) {
      const rr = g.rad[g.order[j]];
      assert.ok(rr * B >= k - 1e-9 && rr * B < k + 1 + 1e-9, 'yıldız kendi halkasında');
      assert.strictEqual((rr * 16) | 0, (k * 16 / B) | 0, 'halkanın bandı yıldızın bandıyla aynı');
    }
  }
});

test('kare başına renk ayarı halka sayısıyla sınırlı, her yıldız yine ayrı çiziliyor', () => {
  const G = load();
  const { log, canvas } = recorder();
  const g = new G(canvas);
  const v = { color: '#3aa6ff', color2: '#d24bff', colorMode: 'theme', sensitivity: 1, thickness: 0.5, glow: 0, minFreq: 20, maxFreq: 20000 };
  const audio = { bass: 0.6, level: 0.5, getBars: () => new Array(16).fill(0.5) };
  g.draw(audio, { visualizer: v, background: { gradient: { colors: ['#5b4be0', '#3aa6ff', '#37e0c8'] } } }, 1.5);
  assert.strictEqual(log.fillRect, g.N + 1, 'çekirdek + her yıldız');
  assert.ok(log.fillStyle <= G.RINGS + 2, 'renk ayarı: ' + log.fillStyle);
  assert.match(read('src/visualizer/modes/generative.js'), /ctx\.fillStyle = rgba\(tone\(v, cfg, rc, t\), \(0\.15 \+ e \* 0\.6\) \* \(1 - rc \* 0\.4\)\);/);
});

test('Sırada: sahne canlıya hiç çıkmadıysa çizilmiş mod resmi, ikinci motor yok', () => {
  const ls = read('src/admin/live-shell.js');
  assert.match(ls, /function topModeOf\(sc\) \{/);
  assert.match(ls, /window\.api\.modeThumbs\(\[top\]\)\.then/);
  assert.match(ls, /if \(shot \|\| \(md && md\.url\)\) pvwFrame\.appendChild/);
  assert.doesNotMatch(ls, /new window\.SVLayers\.LayerStack/, 'Sırada için ayrı çizim yığını kurulmuyor');
});
