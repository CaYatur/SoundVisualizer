'use strict';
/* Spout/Syphon çıkışı: gizli pencere ekranın çalışma alanına kırpılsa da
   istenen boyutta kurulur (1920x1080 istenince 1920x1032 olmaz; 4K dahil). */
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const path = require('path');
const EventEmitter = require('events');

const TS_PATH = path.join(__dirname, '..', 'src', 'main', 'texture-share.js');
const WORK = { w: 1920, h: 1032 }; // 1080p ekran, 48 px görev çubuğu

function load() {
  const wins = [];
  class FakeWin extends EventEmitter {
    constructor(opts) {
      super();
      this.opts = opts;
      // gerçek davranış: yapıcı çalışma alanına kırpar
      this.size = [Math.min(opts.width, WORK.w), Math.min(opts.height, WORK.h)];
      this.destroyed = false;
      this.setSizeCalls = [];
      this.webContents = Object.assign(new EventEmitter(), {
        setBackgroundThrottling() {}, setFrameRate() {}, startPainting() {}, stopPainting() {},
        invalidate() {}, isPainting: () => true,
      });
      wins.push(this);
    }
    getSize() { return this.size.slice(); }
    setSize(w, h) { this.setSizeCalls.push([w, h]); this.size = [w, h]; } // setSize kırpılmaz
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    loadFile() { return Promise.resolve(); }
  }
  const senders = [];
  class TextureSender {
    constructor(name, w, h) { this.name = name; this.w = w; this.h = h; senders.push(this); }
    stop() {}
    send() {}
  }
  const bridge = { getPlatform: () => 'spout', TextureSender, listSenders: () => [] };
  const orig = Module._load;
  Module._load = function (req, ...rest) {
    if (req === 'electron') return { BrowserWindow: FakeWin, screen: { getPrimaryDisplay: () => ({ id: 1 }) } };
    if (req === '@napolab/texture-bridge') return bridge;
    return orig.call(this, req, ...rest);
  };
  const desc = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  delete require.cache[TS_PATH];
  const TS = require(TS_PATH);
  return {
    TS, wins, senders,
    restore() {
      Module._load = orig;
      Object.defineProperty(process, 'platform', desc);
      delete require.cache[TS_PATH];
    },
  };
}

for (const [label, W, H] of [['1920x1080', 1920, 1080], ['4K 3840x2160', 3840, 2160]]) {
  test('texture-share: ilk başlatmada ' + label + ' istenince pencere tam o boyutta olur', async () => {
    const x = load();
    try {
      await x.TS.start({ width: W, height: H, fps: 60 });
      const w = x.wins[0];
      assert.strictEqual(w.opts.enableLargerThanScreen, true);
      assert.deepStrictEqual(w.getSize(), [W, H], 'kırpılan boyut kurulumdan sonra geri alındı');
      // sayfa yüklenince de (pencere yöneticisi araya girerse) boyut korunur
      w.size = [WORK.w, WORK.h];
      w.webContents.emit('did-finish-load');
      assert.deepStrictEqual(w.getSize(), [W, H], 'did-finish-load boyutu yeniden zorlar');
      x.TS.stop();
    } finally { x.restore(); }
  });
}

test('texture-share: yeniden etkinleştirmede boyut değişirse zorlanır, aynıysa dokunulmaz', async () => {
  const x = load();
  try {
    await x.TS.start({ width: 1920, height: 1080 });
    const w = x.wins[0];
    const n = w.setSizeCalls.length;
    await x.TS.start({ width: 1920, height: 1080 });
    assert.strictEqual(w.setSizeCalls.length, n, 'boyut doğruysa setSize çağrılmaz');
    await x.TS.start({ width: 3840, height: 2160 });
    assert.deepStrictEqual(w.getSize(), [3840, 2160]);
    // pencere kırpılmış durumda kalmışsa (kullanıcı ekranı değişti) yeniden zorlanır
    w.size = [WORK.w, WORK.h];
    await x.TS.start({ width: 3840, height: 2160 });
    assert.deepStrictEqual(w.getSize(), [3840, 2160]);
    assert.strictEqual(x.wins.length, 1, 'pencere yeniden kullanıldı');
    x.TS.stop();
  } finally { x.restore(); }
});
