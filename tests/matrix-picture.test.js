'use strict';
/* DDP matrisi ekrandaki kareyi basar (#1065). Sekiz dilimlik palet durur.
   MilkDrop okuması çiti beklemez; bir sonraki çağrıda bir önceki kare gelir. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ddp = require('../src/main/ddp');
const artnet = require('../src/main/artnet');
const MP = require('../src/shared/matrix-picture');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('ızgara ve LED sayısı DDP ile aynı', () => {
  for (const cfg of [
    { ledCount: 60 },
    { ledCount: 16384, matrixCols: 128, matrixRows: 128 },
    { ledCount: 10, matrixCols: 4 },
    { ledCount: 0 },
    {},
  ]) {
    assert.strictEqual(MP.ledCount(cfg), ddp.ledCount(cfg));
    const n = MP.ledCount(cfg);
    assert.deepStrictEqual(MP.gridOf(n, cfg), artnet.matrixGrid(n, cfg));
  }
  assert.deepStrictEqual(MP.sampleSize(400, 300), { cols: 256, rows: 256 });
  assert.strictEqual(MP.MAX_SIDE, 256);
});

test('RGBA küçültme üst satırı korur, WebGL satırını ters çevirir', () => {
  const src = new Uint8Array([
    0, 255, 0, 255, 0, 255, 0, 255,
    255, 0, 0, 255, 255, 255, 255, 255,
  ]);
  assert.deepStrictEqual(Array.from(MP.rgbaToRgb(src, 2, 2, 2, 2, false).slice(0, 3)), [0, 255, 0]);
  const flipped = MP.rgbaToRgb(src, 2, 2, 2, 2, true);
  assert.deepStrictEqual(Array.from(flipped), [
    255, 0, 0, 255, 255, 255,
    0, 255, 0, 0, 255, 0,
  ]);
  const big = new Uint8Array(240 * 135 * 4);
  big[0] = 10;
  const t0 = process.hrtime.bigint();
  const out = MP.rgbaToRgb(big, 240, 135, 128, 128, true);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.strictEqual(out.length, 128 * 128 * 3);
  assert.ok(ms < 40, '128×128 küçültme ' + ms.toFixed(1) + ' ms');
});

test('öndeki görsel seçilir, logo ve yazı atlanır', () => {
  const vis = { canvas: { width: 8, height: 8 }, layer: { kind: 'visualizer', type: 'bars', enabled: true } };
  const entries = [
    { canvas: { width: 8, height: 8 }, layer: { kind: 'background', enabled: true } },
    vis,
    { canvas: { width: 8, height: 8 }, layer: { kind: 'logo', enabled: true } },
    { canvas: { width: 8, height: 8 }, layer: { kind: 'visualizer', type: 'text', enabled: true } },
    { canvas: { width: 0, height: 8 }, layer: { kind: 'visualizer', type: 'milkdrop', enabled: true } },
  ];
  assert.strictEqual(MP.pictureEntry(entries), vis);
  assert.strictEqual(MP.pictureEntry([]), null);
});

test('WebGL okuması bir kare gecikir ve çiti beklemez', () => {
  assert.doesNotMatch(read('src/shared/matrix-picture.js'), /clientWaitSync/);
  const src = new Uint8Array([
    0, 255, 0, 255, 0, 255, 0, 255,
    255, 0, 0, 255, 255, 255, 255, 255,
  ]);
  let signaled = false;
  const gl = {
    TEXTURE_2D: 1, TEXTURE_BINDING_2D: 2, READ_FRAMEBUFFER: 3, READ_FRAMEBUFFER_BINDING: 4,
    PIXEL_PACK_BUFFER: 5, SYNC_STATUS: 6, SIGNALED: 7, RGB8: 9, RGBA: 10,
    UNSIGNED_BYTE: 11, COLOR_ATTACHMENT0: 12, STREAM_READ: 13, SYNC_GPU_COMMANDS_COMPLETE: 14,
    isContextLost: () => false,
    getParameter: () => null,
    createTexture: () => ({}),
    createFramebuffer: () => ({}),
    createBuffer: () => ({}),
    deleteTexture: () => {},
    deleteBuffer: () => {},
    deleteSync: () => {},
    bindTexture: () => {},
    bindFramebuffer: () => {},
    bindBuffer: () => {},
    texStorage2D: () => {},
    bufferData: () => {},
    copyTexSubImage2D: () => {},
    generateMipmap: () => {},
    framebufferTexture2D: () => {},
    readPixels: () => {},
    getBufferSubData: (_t, _o, dst) => dst.set(src),
    getSyncParameter: (_s, p) => (p === 6 && signaled ? 7 : 0),
    fenceSync: () => ({}),
    flush: () => {},
  };
  const mode = { gl, gl2: { width: 2, height: 2 } };
  const stack = { entries: [{ canvas: { width: 2, height: 2 }, mode, layer: { kind: 'visualizer', type: 'milkdrop', enabled: true } }] };
  assert.strictEqual(MP.capture(stack, 2, 2), null);
  assert.ok(MP.lastSampleMs < 50, 'ilk okuma ' + MP.lastSampleMs + ' ms');
  signaled = true;
  const rgb = MP.capture(stack, 2, 2);
  assert.deepStrictEqual(Array.from(rgb), [
    255, 0, 0, 255, 255, 255,
    0, 255, 0, 0, 255, 0,
  ]);
  assert.ok(MP.lastSampleMs < 50, 'hazır kare ' + MP.lastSampleMs + ' ms');
});

test('DDP matrisi görüntüyü basar, Art-Net aynı karede sentetik kalır', () => {
  const pix = Uint8Array.of(255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255);
  const frame = { matrixPixels: pix, matrixSampleCols: 2, matrixSampleRows: 2, level: 1 };
  const cfg = { ledCount: 4, mode: 'matrix', matrixCols: 2, matrixRows: 2, brightness: 1 };
  assert.deepStrictEqual(Array.from(ddp.renderPixels(cfg, frame)), Array.from(pix));
  const snake = ddp.renderPixels(Object.assign({ matrixSerpentine: true }, cfg), frame);
  assert.deepStrictEqual([snake[6], snake[7], snake[8]], [255, 255, 255], 'ikinci satır sağdan');
  assert.deepStrictEqual([snake[9], snake[10], snake[11]], [0, 0, 255]);
  const half = ddp.renderPixels(Object.assign({}, cfg, { brightness: 0.5 }), frame);
  assert.strictEqual(half[0], 128);
  const plain = ddp.renderPixels(cfg, { level: 1 });
  assert.notStrictEqual(plain[0], 255);
  const dmx = artnet.buildChannels({
    fixtures: 4, channelsPerFixture: 3, mode: 'matrix', matrixCols: 2, matrixRows: 2,
    brightness: 1, startChannel: 1,
  }, frame);
  assert.notStrictEqual(dmx[0], 255);
});

test('ölçer görüntüyü yalnız matris ve görüntü kaynağında yollar, panel notu bunu söyler', () => {
  const V = read('src/visualizer/visualizer.js');
  assert.match(V, /cfg\.wled\.mode === 'matrix'/);
  assert.match(V, /MP\.capture\(stack, size\.cols, size\.rows\)/);
  const main = read('src/main/main.js');
  assert.match(main, /delete data\.matrixPixels/);
  assert.match(main, /ddp\.send\(currentConfig\.wled, shot \? Object\.assign\(\{\}, data, shot\) : data\)/);
  assert.match(read('src/visualizer/index.html'), /matrix-picture\.js/);
  assert.match(read('src/web/overlay.html'), /matrix-picture\.js/);
  const note = 'WLED (DDP) renk kaynağı Matris ise';
  assert.ok(read('src/admin/milkdrop-panel.js').includes(note));
  assert.ok(read('src/shared/i18n.js').includes(note));
});
