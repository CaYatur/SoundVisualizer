'use strict';
/* STUDIO RENK MODU (#883). Studio shader'ları rengini sv_palette'ten alıyor;
 * görselleştiricide paletin kaynağı seçilebiliyor. Renk Teması eski
 * davranış (gradyan), Sabit Renk birincilden ikincile, Gökkuşağı çizim
 * saatiyle kayıyor. Ayrı anahtar: genel colorMode Studio'yu etkilemiyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf-8');

function loadPalette() {
  const win = {
    SV: {
      hexToRgb01: (h) => {
        const n = parseInt(String(h).slice(1), 16);
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
      },
    },
  };
  win.window = win;
  vm.runInContext(read('src/visualizer/modes/shaderhost.js'), vm.createContext(win), { filename: 'shaderhost.js' });
  return win.SVModes.custom.palette;
}

test('#883: Renk Teması paleti değiştirmiyor; genel colorMode Studio\'yu etkilemiyor', () => {
  const pal = loadPalette();
  assert.strictEqual(pal({ studioColorMode: 'theme' }, 3), null);
  assert.strictEqual(pal({}, 3), null, 'eski kayıt: anahtar yok');
  assert.strictEqual(pal({ colorMode: 'rainbow', color: '#ff0000' }, 3), null, 'genel renk modu okunmuyor');
});

test('#883: Sabit Renk birincilden ikincile beş durak', () => {
  const pal = loadPalette();
  const p = pal({ studioColorMode: 'custom', color: '#ff0000', color2: '#0000ff' }, 0);
  assert.deepStrictEqual(Array.from(p), ['#ff0000', '#bf0040', '#800080', '#4000bf', '#0000ff']);
  const one = pal({ studioColorMode: 'custom', color: '#00ff00' }, 0);
  assert.ok(one.every((c) => c === '#00ff00'), 'ikincil yoksa tek renk: ' + one.join(','));
});

test('#883: Gökkuşağı çizim saatine bağlı ve belirlenimci', () => {
  const pal = loadPalette();
  const a = pal({ studioColorMode: 'rainbow' }, 2);
  const b = pal({ studioColorMode: 'rainbow' }, 2);
  const c = pal({ studioColorMode: 'rainbow' }, 7);
  assert.deepStrictEqual(Array.from(a), Array.from(b));
  assert.notDeepStrictEqual(Array.from(a), Array.from(c));
  assert.ok(new Set(a).size === 5, 'beş farklı ton');
});

test('#883: ana kartta Studio kendi Renk Modu\'nu gösteriyor, katman kartında da var', () => {
  const admin = read('src/admin/admin.js');
  assert.match(admin, /path: 'visualizer\.studioColorMode'[\s\S]{0,400}show: \(\) => v\.type === 'custom'/);
  assert.match(admin, /path: 'visualizer\.colorMode',[\s\S]{0,400}show: \(\) => v\.type !== 'none' && v\.type !== 'custom'/);
  const layer = read('src/admin/scene-panels.js');
  assert.match(layer, /l\.kind === 'visualizer' && l\.type === 'custom'\) \{[\s\S]{0,700}studioColorMode/);
  global.window = global.window || {};
  require('../src/shared/defaults.js');
  assert.strictEqual(global.window.SV.defaultConfig().visualizer.studioColorMode, 'theme');
});
