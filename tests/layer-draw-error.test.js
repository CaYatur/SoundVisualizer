'use strict';
/* BİR KATMANIN HATASI KAREYİ DÜŞÜRMÜYOR.
 *
 * Uygulamada ölçüldü (yalıtılmış kopya, kullanıcının ayarları, Otomatik VJ
 * açık): parçacık modu tema renginde tanımsız bir adla her karede istisna
 * atıyordu — 4 dakikada 886 kez. İstisna yığının döngüsünden çıktığı için
 * üstteki katmanlar, efekt zinciri ve ışıklar o karelerde hiç çizilmiyordu.
 *
 * Testler iki şeyi ölçüyor: parçacıklar üç renk kipinde de çiziyor, ve
 * gerçek `LayerStack` hata atan bir katmanın üstündekileri çizmeye devam
 * edip hatayı tür başına bir kez yazıyor.
 */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
require('../src/shared/defaults.js');
require('../src/shared/onset.js');
const L = require('../src/visualizer/layers.js');

// ------------------------------------------------------------ parçacıklar

function particles() {
  window.SVGlow = class { apply() {} };
  window.SV = Object.assign({}, window.SV, {
    sampleThemeColorRgb: (cfg, k) => [Math.round(k * 255), 10, 20],
    hexToRgb01: () => [1, 0.5, 0],
  });
  delete require.cache[require.resolve('../src/visualizer/modes/particles.js')];
  require('../src/visualizer/modes/particles.js');
  const fills = [];
  const ctx = {
    clearRect() {}, save() {}, restore() {}, translate() {}, beginPath() {}, arc() {},
    fill() { fills.push(this.fillStyle); },
  };
  const canvas = { width: 320, height: 180, getContext: () => ctx };
  return { mode: new window.SVModes.particles(canvas), fills };
}

for (const colorMode of ['theme', 'custom', 'rainbow']) {
  test('parçacıklar ' + colorMode + ' renginde hata atmadan çiziyor', () => {
    const { mode, fills } = particles();
    const cfg = { visualizer: { colorMode, color: '#ff8800', sensitivity: 1 } };
    for (let k = 0; k < 20; k++) {
      mode.draw({ bass: k % 5 === 0 ? 1 : 0.1, level: 0.5 }, cfg, k / 60, 1 / 60);
    }
    assert.ok(fills.length > 0, 'hiç parçacık çizilmedi');
    const want = colorMode === 'rainbow' ? /^hsla\(/ : /^rgba\(/;
    assert.ok(fills.every((f) => want.test(f)), 'renk biçimi: ' + fills[0]);
  });
}

test('tema renginde parçacıklar havuzdaki sıralarına göre gradyandan renk alıyor', () => {
  const { mode, fills } = particles();
  const cfg = { visualizer: { colorMode: 'theme', sensitivity: 1 } };
  for (let k = 0; k < 30; k++) mode.draw({ bass: 1, level: 1 }, cfg, k / 60, 1 / 60);
  const reds = new Set(fills.map((f) => /^rgba\((\d+),/.exec(f)[1]));
  assert.ok(reds.size > 5, 'bütün parçacıklar aynı renkte: ' + [...reds].join(' '));
});

// ------------------------------------------------------------ yığın

const AUDIO = { ready: true, level: 0.5, bass: 0.5, mid: 0.5, treble: 0.5 };
const CFG = { layerStack: { enabled: true }, background: { type: 'solid' }, visualizer: { type: 'bars' } };

function entry(id, kind, type, mode) {
  return {
    layer: L.normalizeLayer({ id, kind, type, blend: 'screen' }),
    key: id, canvas: { name: id, width: 320, height: 180, style: { visibility: '' } },
    ctx: { clearRect() {}, fillRect() {}, save() {}, restore() {}, setTransform() {}, drawImage() {} },
    mode, gl: false,
  };
}

test('hata atan katmanın üstündeki katman aynı karede yine çiziliyor', () => {
  const stack = new L.LayerStack(null, {});
  stack.width = 320;
  stack.height = 180;
  const bad = { draws: 0, draw() { this.draws++; throw new ReferenceError('COUNT is not defined'); } };
  const top = { draws: 0, draw() { this.draws++; } };
  const under = { draws: 0, draw() { this.draws++; } };
  stack.entries = [
    entry('ly_a', 'visualizer', 'bars', under),
    entry('ly_b', 'visualizer', 'particles', bad),
    entry('ly_c', 'visualizer', 'wave', top),
  ];
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    for (let k = 0; k < 3; k++) stack.draw(AUDIO, CFG, k / 60, 1 / 60);
  } finally {
    console.error = orig;
  }
  assert.strictEqual(bad.draws, 3, 'bozuk katman her karede yeniden denenmeli');
  assert.strictEqual(top.draws, 3, 'üstteki katman çizilmedi');
  assert.strictEqual(under.draws, 3);
  assert.strictEqual(logged.length, 1, 'hata tür başına bir kez yazılmalı: ' + logged.length);
  assert.match(logged[0], /visualizer:particles/);
});
