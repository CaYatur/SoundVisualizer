'use strict';
/* Ağ ışık çıkışlarında matris yerleşimi.
   Aynı aygıtlar satır öncelikli ızgara olur: ton sütundan, parlaklık
   alttan üste solar. Şerit kipleri eski renk yolundan ayrılmaz. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const artnet = require('../src/main/artnet');
const ddp = require('../src/main/ddp');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('ızgara: aygıt sayısından yakına kare', () => {
  assert.deepStrictEqual(artnet.matrixGrid(1, {}), { cols: 1, rows: 1 });
  assert.deepStrictEqual(artnet.matrixGrid(2, {}), { cols: 2, rows: 1 });
  assert.deepStrictEqual(artnet.matrixGrid(3, {}), { cols: 2, rows: 2 });
  assert.deepStrictEqual(artnet.matrixGrid(9, {}), { cols: 3, rows: 3 });
  assert.deepStrictEqual(artnet.matrixGrid(10, null), { cols: 4, rows: 3 });
  assert.deepStrictEqual(artnet.matrixGrid(60, {}), { cols: 8, rows: 8 });
});

test('ızgara: verilen sütun ve satır, geçersiz değerde kareye düşer', () => {
  assert.deepStrictEqual(artnet.matrixGrid(10, { matrixCols: 5, matrixRows: 2 }), { cols: 5, rows: 2 });
  assert.deepStrictEqual(artnet.matrixGrid(10, { matrixCols: 5 }), { cols: 5, rows: 2 });
  assert.deepStrictEqual(artnet.matrixGrid(10, { matrixRows: 2 }), { cols: 4, rows: 2 });
  assert.deepStrictEqual(artnet.matrixGrid(10, { matrixCols: 0, matrixRows: 1.5 }), { cols: 4, rows: 3 });
  assert.deepStrictEqual(artnet.matrixGrid(10, { matrixCols: -3, matrixRows: '8' }), { cols: 4, rows: 3 });
  assert.deepStrictEqual(artnet.matrixGrid(8, { matrixCols: 4.2, matrixRows: true }), { cols: 3, rows: 3 });
});

test('ızgara: satır öncelikli indeks, aygıt sayısının ötesi okunmaz', () => {
  assert.deepStrictEqual(artnet.matrixCell(0, 4), { c: 0, r: 0 });
  assert.deepStrictEqual(artnet.matrixCell(3, 4), { c: 3, r: 0 });
  assert.deepStrictEqual(artnet.matrixCell(4, 4), { c: 0, r: 1 });
  assert.deepStrictEqual(artnet.matrixCell(5, 4), { c: 1, r: 1 });
  const cfg = {
    fixtures: 5, channelsPerFixture: 3, mode: 'matrix',
    matrixCols: 4, matrixRows: 10, brightness: 1, startChannel: 1,
  };
  const frame = { level: 1 };
  const data = artnet.buildChannels(cfg, frame);
  assert.strictEqual(data.length, 16, 'beş aygıt: 15 kanal, çift uzunluğa yuvarlanır');
  assert.strictEqual(data[15], 0);
  assert.deepStrictEqual(artnet.colorAt(cfg, frame, 5, 5), [0, 0, 0]);
  assert.deepStrictEqual(artnet.colorAt(cfg, frame, 99, 5), [0, 0, 0]);
  const cell = artnet.matrixCell(4, 4);
  assert.deepStrictEqual(cell, { c: 0, r: 1 });
  assert.ok(data[12] > 0, 'son aygıt hâlâ ızgaranın içinde');
});

test('matris: aynı sütunda alt satır üst satırdan parlaktır', () => {
  const cfg = {
    fixtures: 6, channelsPerFixture: 3, mode: 'matrix',
    matrixCols: 3, matrixRows: 2, brightness: 1, startChannel: 1,
  };
  const data = artnet.buildChannels(cfg, { level: 0.8 });
  const pix = (i) => [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];
  const top = pix(0);
  const bottom = pix(3);
  assert.deepStrictEqual(artnet.matrixCell(0, 3), { c: 0, r: 0 });
  assert.deepStrictEqual(artnet.matrixCell(3, 3), { c: 0, r: 1 });
  assert.deepStrictEqual(top, [102, 0, 0]);
  assert.deepStrictEqual(bottom, [204, 0, 0]);
  assert.ok(bottom[0] > top[0]);
  assert.ok(pix(4)[1] > pix(1)[1], 'aynı sütunun altı daha parlak');
});

test('matris: parlaklık kaydırıcısı ve RGBW şerit kipleriyle aynı yerde uygulanır', () => {
  const cfg = {
    fixtures: 4, channelsPerFixture: 4, mode: 'matrix',
    matrixCols: 2, matrixRows: 2, brightness: 0.5, startChannel: 1,
  };
  const data = artnet.buildChannels(cfg, { level: 1 });
  assert.strictEqual(data.length, 16);
  assert.deepStrictEqual([data[0], data[1], data[2], data[3]], [64, 0, 0, 0]);
  assert.deepStrictEqual([data[8], data[9], data[10], data[11]], [128, 0, 0, 0]);
  assert.ok(data[8] > data[0]);
});

test('şerit kipi eski fixtureColor yoluyla bayt bayt aynı', () => {
  const frames = [
    { level: 0.4, bass: 0.2, mid: 0.7, treble: 0.9, time: 3.5, backgroundColors: ['#112233', '#abcdef', '#ff00aa'] },
    { level: 1, bass: 1, mid: 0, treble: 0, time: 0, backgroundColors: ['#ffffff'] },
    { level: 0, time: 0, backgroundColors: [] },
  ];
  const modes = ['palette', 'bands', 'spectrum', 'single', undefined];
  for (const mode of modes) {
    for (const frame of frames) {
      for (const per of [3, 4]) {
        const cfg = {
          fixtures: 7, channelsPerFixture: per, mode, color: '#80ff40',
          brightness: 0.65, startChannel: 4,
        };
        const got = artnet.buildChannels(cfg, frame);
        assert.ok(got.equals(legacyChannels(cfg, frame)), 'kip ' + mode + ' / ' + per);
        const pxCfg = { ledCount: 7, mode, color: '#80ff40', brightness: 0.65 };
        const px = ddp.renderPixels(pxCfg, frame);
        assert.ok(px.equals(legacyPixels(pxCfg, frame)), 'ddp kip ' + mode);
      }
    }
  }
});

test('DDP: piksel uzunluğu ve köşe pikseli ortak ızgaradan', () => {
  const cfg = { ledCount: 12, mode: 'matrix', matrixCols: 4, matrixRows: 3, brightness: 1 };
  const frame = { level: 1 };
  const px = ddp.renderPixels(cfg, frame);
  assert.strictEqual(px.length, 36);
  assert.deepStrictEqual([px[0], px[1], px[2]], [85, 0, 0], 'sol üst');
  assert.deepStrictEqual([px[33], px[34], px[35]], [128, 0, 255], 'sağ alt');
  const dmx = artnet.buildChannels({
    fixtures: 12, channelsPerFixture: 3, mode: 'matrix',
    matrixCols: 4, matrixRows: 3, brightness: 1, startChannel: 1,
  }, frame);
  assert.ok(px.equals(dmx.subarray(0, 36)), 'DDP ile kanal üreticisi aynı ızgarayı kullanır');
  assert.ok(px[0] < px[24], 'aynı sütunda alt satır daha parlak');
});

test('panel: matris kipi ve ölçü kaydırıcıları, çevirileriyle', () => {
  const scene = read('src/admin/scene-panels.js');
  const led = read('src/admin/led-net-panel.js');
  const i18n = read('src/shared/i18n.js');
  const ddpSrc = read('src/main/ddp.js');
  const artSrc = read('src/main/artnet.js');
  assert.match(scene, /\['matrix', 'Matris'\]/);
  assert.match(scene, /miniSlider\('Matris Sütunu'/);
  assert.match(scene, /miniSlider\('Matris Satırı'/);
  assert.match(led, /value: 'matrix', label: 'Matris'/);
  assert.match(led, /matrixDimSliders\(obj, n\)/);
  assert.match(i18n, /'Matris': 'Matrix'/);
  assert.match(i18n, /'Matris Sütunu': 'Matrix Columns'/);
  assert.match(i18n, /'Matris Satırı': 'Matrix Rows'/);
  assert.match(artSrc, /function matrixGrid/);
  assert.match(artSrc, /function colorAt/);
  assert.match(ddpSrc, /artnet\.colorAt\(/);
  assert.doesNotMatch(ddpSrc, /matrixCols/);
  assert.match(read('src/main/sacn.js'), /artnet\.buildChannels\(/);
});

/* Değişmeden önceki şerit yolu: f = i/(n-1), sonra fixtureColor. */
function legacyChannels(cfg, frame) {
  const a = cfg || {};
  const fixtures = Math.max(1, Math.min(170, a.fixtures | 0 || 8));
  const perFixture = a.channelsPerFixture === 4 ? 4 : 3;
  const brightness = Math.max(0, Math.min(1, a.brightness == null ? 1 : a.brightness));
  const start = Math.max(1, Math.min(512, a.startChannel | 0 || 1));
  const total = Math.min(512, start - 1 + fixtures * perFixture);
  const data = Buffer.alloc(total < 2 ? 2 : total % 2 ? total + 1 : total);
  for (let i = 0; i < fixtures; i++) {
    const f = fixtures > 1 ? i / (fixtures - 1) : 0;
    const rgb = artnet.fixtureColor(a, frame, f);
    const base = start - 1 + i * perFixture;
    if (base + perFixture > data.length) break;
    data[base] = artnet.clamp255(rgb[0] * 255 * brightness);
    data[base + 1] = artnet.clamp255(rgb[1] * 255 * brightness);
    data[base + 2] = artnet.clamp255(rgb[2] * 255 * brightness);
    if (perFixture === 4) data[base + 3] = artnet.clamp255(Math.min(rgb[0], rgb[1], rgb[2]) * 255 * brightness);
  }
  return data;
}

function legacyPixels(cfg, frame) {
  const c = cfg || {};
  const n = Math.max(1, Math.min(4096, c.ledCount | 0 || 60));
  const brightness = Math.max(0, Math.min(1, c.brightness == null ? 1 : c.brightness));
  const out = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    const f = n > 1 ? i / (n - 1) : 0;
    const rgb = artnet.fixtureColor(c, frame, f);
    out[i * 3] = artnet.clamp255(rgb[0] * 255 * brightness);
    out[i * 3 + 1] = artnet.clamp255(rgb[1] * 255 * brightness);
    out[i * 3 + 2] = artnet.clamp255(rgb[2] * 255 * brightness);
  }
  return out;
}

test('yılan dizilim: tek numaralı satırlar sağdan sola sayılır', () => {
  // 4 sütun: 0 1 2 3 / 7 6 5 4 / 8 9 10 11
  assert.deepStrictEqual(artnet.matrixCell(0, 4, true), { c: 0, r: 0 });
  assert.deepStrictEqual(artnet.matrixCell(3, 4, true), { c: 3, r: 0 });
  assert.deepStrictEqual(artnet.matrixCell(4, 4, true), { c: 3, r: 1 }, 'ikinci satır sağdan başlar');
  assert.deepStrictEqual(artnet.matrixCell(7, 4, true), { c: 0, r: 1 });
  assert.deepStrictEqual(artnet.matrixCell(8, 4, true), { c: 0, r: 2 }, 'üçüncü satır yine soldan');
  // Kapalıyken ve tek sütunda eski davranış
  assert.deepStrictEqual(artnet.matrixCell(4, 4, false), { c: 0, r: 1 });
  assert.deepStrictEqual(artnet.matrixCell(4, 4), { c: 0, r: 1 });
  assert.deepStrictEqual(artnet.matrixCell(3, 1, true), { c: 0, r: 3 });
});

test('yılan dizilim çıkışta ikinci satırı aynalar, ötekilere dokunmaz', () => {
  const base = { ledCount: 12, mode: 'matrix', matrixCols: 4, matrixRows: 3, brightness: 1 };
  const frame = { level: 1 };
  const flat = ddp.renderPixels(base, frame);
  const snake = ddp.renderPixels(Object.assign({ matrixSerpentine: true }, base), frame);
  const px = (buf, i) => [buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2]];
  for (const i of [0, 1, 2, 3, 8, 9, 10, 11]) assert.deepStrictEqual(px(snake, i), px(flat, i), 'satır 0 ve 2 aynı: ' + i);
  for (let c = 0; c < 4; c++) assert.deepStrictEqual(px(snake, 4 + c), px(flat, 7 - c), 'satır 1 ters: ' + c);
  assert.notDeepStrictEqual(px(snake, 4), px(flat, 4));
  // Art-Net ve sACN aynı ızgarayı kullanır
  const dmx = artnet.buildChannels({ fixtures: 12, channelsPerFixture: 3, mode: 'matrix', matrixCols: 4, matrixRows: 3, matrixSerpentine: true, brightness: 1, startChannel: 1 }, frame);
  assert.ok(snake.equals(dmx.subarray(0, 36)));
  const i18n = read('src/shared/i18n.js');
  assert.ok(read('src/admin/scene-panels.js').includes("'Yılan Dizilim (Zigzag Kablolama)'"));
  assert.ok(i18n.includes("'Yılan Dizilim (Zigzag Kablolama)':"));
  assert.ok(!/matrixSerpentine/.test(read('src/shared/defaults.js')));
});
