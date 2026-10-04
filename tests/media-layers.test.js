'use strict';
/* İki medya katmanı iki kamera açar.

   Seçim katmanın ayarında duruyordu ama sahne tek SVMedia kurup
   yalnızca ilk katmanın aygıtını oraya veriyordu. İkinci kamerayı
   seçince ikisi de o son akışa düşüyordu.
 */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
require('../src/shared/defaults.js');
require('../src/shared/onset.js');
const L = require('../src/visualizer/layers.js');

let seq = 0;
class FakeMedia {
  constructor() {
    this.tag = 'p' + (++seq);
    this.video = { tag: this.tag };
    this.deviceId = '';
    this.stopped = false;
    this.draws = [];
  }
  apply(m) { this.deviceId = (m && m.deviceId) || ''; }
  draw(ctx, audio, lcfg) {
    this.draws.push((lcfg.media && lcfg.media.deviceId) || '');
  }
  dispose() { this.stopped = true; }
}

function cfg(layers) {
  return {
    layerStack: { enabled: true },
    background: { type: 'solid', solidColor: '#111111' },
    visualizer: { type: 'bars' },
    media: { source: 'webcam', deviceId: '', enabled: true },
    layers,
  };
}

function layer(id, deviceId) {
  return {
    id, kind: 'media', name: id, enabled: true,
    settings: { media: { source: 'webcam', deviceId, enabled: true } },
  };
}

function entry(id) {
  return {
    layer: L.normalizeLayer({ id, kind: 'media', type: 'back', enabled: true }),
    key: id,
    canvas: { name: id, width: 320, height: 180, style: {} },
    ctx: { clearRect() {}, save() {}, restore() {} },
    mode: null,
    gl: false,
  };
}

test('iki medya katmanı farklı kameraları aynı anda açar', () => {
  seq = 0;
  window.SVMedia = FakeMedia;
  const stack = new L.LayerStack(null, {});
  stack.width = 320;
  stack.height = 180;
  const layers = [layer('a', 'cam-a'), layer('b', 'cam-b')];
  stack.syncMedia(cfg(layers));
  assert.strictEqual(stack._mediaPool.size, 2);
  const players = [...stack._mediaPool.values()];
  assert.deepStrictEqual(players.map((p) => p.deviceId).sort(), ['cam-a', 'cam-b']);
  assert.notStrictEqual(stack.mediaOf(layers[0]), stack.mediaOf(layers[1]));

  stack.entries = [entry('a'), entry('b')];
  stack.draw({ ready: true, level: 0.2, bass: 0.2, mid: 0.2, treble: 0.2 }, cfg(layers), 0, 1 / 60);
  assert.deepStrictEqual(stack.mediaOf(layers[0]).draws, ['cam-a']);
  assert.deepStrictEqual(stack.mediaOf(layers[1]).draws, ['cam-b']);

  const gone = stack.mediaOf(layers[1]);
  stack.syncMedia(cfg([layer('a', 'cam-a')]));
  assert.strictEqual(gone.stopped, true);
  assert.strictEqual(stack._mediaPool.size, 1);
  assert.strictEqual(stack.mediaOf(layers[0]).stopped, false);

  const vis = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'visualizer.js'), 'utf8');
  const preview = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'preview.js'), 'utf8');
  assert.match(vis, /stack\.syncMedia\(cfg\)/);
  assert.match(preview, /stack\.syncMedia\(cfg\)/);
  assert.doesNotMatch(vis, /layers\.find\(\(l\) => l && l\.kind === 'media'/);
  assert.doesNotMatch(preview, /layers\.find\(\(l\) => l && l\.kind === 'media'/);
});

test('aynı kamera iki katmanda tek akış olarak paylaşılır', () => {
  seq = 0;
  window.SVMedia = FakeMedia;
  const stack = new L.LayerStack(null, {});
  const layers = [layer('a', 'cam-a'), layer('b', 'cam-a')];
  stack.syncMedia(cfg(layers));
  assert.strictEqual(stack._mediaPool.size, 1);
  assert.strictEqual(stack.mediaOf(layers[0]), stack.mediaOf(layers[1]));
  stack.syncMedia(cfg([
    layer('a', 'cam-a'),
    { id: 'b', kind: 'media', enabled: true, settings: { media: { source: 'file', file: 'kedi.mp4', deviceId: '' } } },
  ]));
  assert.strictEqual(stack._mediaPool.size, 2);
  assert.notStrictEqual(stack.mediaOf(layers[0]), stack.mediaOf({ id: 'b' }));
});
