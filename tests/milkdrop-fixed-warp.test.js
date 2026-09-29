'use strict';
/* SABİT WARP YOLU ve GEÇİŞİN ATLAMA NOKTASI (#580).
 *
 * MilkDrop 2 kaynağıyla karşılaştırıldı (milkdropfs.cpp WarpedBlit_NoShaders
 * ve RunPerFrameEquations). Aynı olanlar: önceki kare çift doğrusal
 * örnekleniyor ve tepe rengiyle, yani COLOR_NORM'dan geçmiş `decay`le
 * çarpılıyor; gama yok; geçişte karışan ve atlayan değişken listeleri ve
 * atlama noktasının kuralı. Tek fark sarma kipiydi: MilkDrop `wrap`ı sabit
 * 0,5 ile değil geçişin atlama noktasıyla karşılaştırıyor — yalnız eski
 * presetin birleştirme shader'ı varsa −0,01 (hep sarıyor), yalnız yeninin
 * varsa 1,01 (hiç sarmıyor).
 *
 * Bilinçli sapma, değişmedi: sönüm kare hızına göre düzeltiliyor
 * (`decay^(30/fps)`). MilkDrop onu kare başına uyguluyor ve varsayılan kare
 * hızı sınırı 30 (plugin.cpp m_max_fps_fs); düzeltme o varsayılanı her
 * kare hızında yeniden üretiyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8');

function engine() {
  const canvas = () => ({ width: 320, height: 240, getContext: (k) => (k === '2d' ? {} : null), addEventListener() {} });
  const ctx = { window: {}, document: { createElement: canvas }, console, performance };
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  for (const f of ['src/shared/milkdrop.js', 'src/shared/milkdrop-hlsl.js', 'src/shared/milkdrop-shader.js', 'src/visualizer/modes/milkdrop.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  const params = [];
  const gl = new Proxy({}, {
    get(_, k) {
      const name = String(k);
      if (name === 'texParameteri') return (t, p, v) => params.push([p, v]);
      if (/^[A-Z_0-9]+$/.test(name)) return name;
      return () => undefined;
    },
  });
  const m = new ctx.window.SVModes.milkdrop(canvas());
  m.gl = gl;
  return { m, M: ctx.window.SVMilkdrop, params };
}
const SRC = (wrap) => '[preset00]\nbTexWrap=' + wrap + '\n';

test('sarma eşiği: geçiş yokken 0,5; atlama noktası verilince o', () => {
  const { m, M, params } = engine();
  const last = () => params.filter(([p]) => p === 'TEXTURE_WRAP_S').pop()[1];
  m.preset = new M.Preset(SRC(0), {});
  m._bindMain({});
  assert.strictEqual(last(), 'CLAMP_TO_EDGE');
  m._bindMain({}, -0.01);
  assert.strictEqual(last(), 'REPEAT', 'eski presetin birleştirme shader\'ı varken hep sarıyor');
  m.preset = new M.Preset(SRC(1), {});
  m._bindMain({});
  assert.strictEqual(last(), 'REPEAT');
  m._bindMain({}, 1.01);
  assert.strictEqual(last(), 'CLAMP_TO_EDGE', 'yeninin birleştirme shader\'ı varken hiç sarmıyor');
});

test('atlama noktası MilkDrop\'un kuralı: yalnız birleştirme shader\'ına bakıyor', () => {
  const { m } = engine();
  const at = (oldComp, newComp) => { m.oldCompPreset = oldComp ? {} : null; m.compPreset = newComp ? {} : null; return m._snapPoint(); };
  assert.strictEqual(at(true, false), -0.01);
  assert.strictEqual(at(false, true), 1.01);
  assert.strictEqual(at(false, false), 0.5);
  assert.strictEqual(at(true, true), 0.5);
});

test('sabit warp çizimi geçişte atlama noktasını veriyor, uyum kapalıyken 0,5', () => {
  const code = read('src/visualizer/modes/milkdrop.js');
  assert.match(code, /this\._bindMain\(src\.tex, this\.oldPreset && this\._wantAcc !== false \? this\._snapPoint\(\) : 0\.5\);/);
});

test('geçişte karışan ve atlayan listeler MilkDrop\'unkiyle aynı', () => {
  const code = read('src/visualizer/modes/milkdrop.js');
  const list = (name) => {
    const m = new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\];').exec(code);
    return m[1].match(/'([a-z0-9_]+)'/g).map((s) => s.slice(1, -1)).sort();
  };
  // milkdropfs.cpp RunPerFrameEquations, blur min/max ve kenar karartma bizim adlarımızla
  assert.deepStrictEqual(list('BLEND_LERP'), [
    'b1ed', 'b1n', 'b1x', 'b2n', 'b2x', 'b3n', 'b3x', 'decay', 'echo_alpha', 'echo_zoom', 'gamma',
    'ib_a', 'ib_b', 'ib_g', 'ib_r', 'ib_size', 'mv_a', 'mv_b', 'mv_dx', 'mv_dy', 'mv_g', 'mv_l', 'mv_r',
    'mv_x', 'mv_y', 'ob_a', 'ob_b', 'ob_g', 'ob_r', 'ob_size', 'wave_a', 'wave_b', 'wave_g', 'wave_mystery',
    'wave_r', 'wave_x', 'wave_y']);
  assert.deepStrictEqual(list('BLEND_SNAP'), ['brighten', 'darken', 'darken_center', 'echo_orient', 'invert',
    'solarize', 'wave_additive', 'wave_brighten', 'wave_thick', 'wave_usedots', 'wrap']);
});
