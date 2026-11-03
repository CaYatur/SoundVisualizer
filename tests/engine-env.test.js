'use strict';
/* Motorun sayfadan ayrılması (#905): motor kodu yeni bir sayfa bağımlılığı alamaz, köprü
   sayfanın kendi betik sırasını kullanır, Worker ortamı tanımadığı öğeyi sessizce geçirmez. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const scriptsOf = (html, base) => [...read(html).matchAll(/<script[^>]+src="([^"]+)"/g)]
  .map((m) => path.posix.normalize(path.posix.join(base, m[1])));

const Bridge = require('../src/visualizer/engine-bridge.js');
// Sayfaya kalan betikler: motor değil
const PAGE_SIDE = new Set(['src/visualizer/visualizer.js', 'src/exporter/exporter.js', 'src/exporter/yuv-readout.js', 'src/shared/icons.js']);
const engineFiles = () => {
  const all = new Set([...scriptsOf('src/visualizer/index.html', 'src/visualizer'), ...scriptsOf('src/exporter/index.html', 'src/exporter')]);
  return [...all].filter((f) => !PAGE_SIDE.has(f));
};

/* Motorun sayfadan istediği şeylerin tamamı. Yenisi eklenecekse önce Worker ortamına
   (engine-env.js) karşılığı yazılmalı, yoksa motor Worker'da sessizce bozulur. */
const ALLOWED = new Map([
  ['src/shared/i18n.js', /.*/],
  ['src/visualizer/modes/media.js', /createElement\('video'\)/],
  ['src/visualizer/modes/source.js', /querySelector/],
]);

test('motor betikleri sayfadan yalnız tuval istiyor', () => {
  const files = engineFiles();
  assert.ok(files.length > 60, 'betik sayısı ' + files.length);
  const bad = [];
  for (const f of files) {
    const text = read(f);
    for (const m of text.matchAll(/\bdocument\.([a-zA-Z]+)(\([^)]*\))?/g)) {
      if (m[1] === 'createElement' && /^\(\s*['"]canvas['"]\s*\)/.test(m[2] || '')) continue;
      const allow = ALLOWED.get(f);
      if (allow && allow.test(m[0])) continue;
      bad.push(f + ': ' + m[0]);
    }
  }
  assert.deepStrictEqual(bad, []);
});

test('Worker\'a giden liste sayfanın kendi sırası, sayfa betikleri çıkıyor', () => {
  const doc = { scripts: [
    { src: 'file:///app/src/shared/defaults.js' },
    { src: 'file:///app/src/shared/icons.js' },
    { src: '' },
    { src: 'file:///app/src/visualizer/modes/glow.js' },
    { src: 'file:///app/src/visualizer/engine-bridge.js' },
    { src: 'file:///app/src/visualizer/visualizer.js' },
    { src: 'file:///app/src/exporter/exporter.js' },
    { src: 'file:///app/src/exporter/yuv-readout.js' },
  ] };
  assert.deepStrictEqual(Bridge.engineScripts(doc), ['file:///app/src/shared/defaults.js', 'file:///app/src/visualizer/modes/glow.js']);
});

function workerSandbox() {
  class FakeOffscreen {
    constructor(w, h) { this.width = w; this.height = h; }
    getContext() { return { transferFromImageBitmap: (b) => { this.shown = b; } }; }
  }
  const posted = [];
  const handlers = [];
  const box = {
    OffscreenCanvas: FakeOffscreen,
    postMessage: (m) => posted.push(m),
    addEventListener: (t, f) => { if (t === 'message') handlers.push(f); },
    console,
    Promise,
    Map,
    Object,
    String,
    Error,
  };
  box.self = box;
  vm.createContext(box);
  vm.runInContext(read('src/visualizer/engine-env.js'), box);
  return { box, posted, deliver: (data) => handlers.forEach((f) => f({ data })), FakeOffscreen };
}

test('Worker ortamı: tuval verir, tanımadığı öğede hata verir', () => {
  const { box, FakeOffscreen } = workerSandbox();
  assert.ok(box.window, 'window var');
  const c = box.document.createElement('canvas');
  assert.ok(c instanceof FakeOffscreen);
  assert.throws(() => box.document.createElement('video'), /bu öğe yok: video/);
  assert.strictEqual(box.document.querySelector('x'), null);
});

test('Worker ortamı: görsel sayfada çözülür, tuval olarak gelir', async () => {
  const { box, posted, deliver } = workerSandbox();
  const img = new box.Image();
  let loaded = 0;
  img.onload = () => { loaded++; };
  assert.strictEqual(img.complete, false);
  img.src = 'sv-logo://lib/a';
  assert.strictEqual(img.src, 'sv-logo://lib/a');
  assert.strictEqual(posted.length, 1);
  assert.strictEqual(posted[0].__sv, 'image');
  assert.strictEqual(posted[0].src, 'sv-logo://lib/a');
  const bmp = { width: 40, height: 20 };
  deliver({ __sv: 'ret', id: posted[0].id, ok: true, value: bmp });
  await img.decode();
  assert.strictEqual(loaded, 1);
  assert.strictEqual(img.complete, true);
  assert.strictEqual(img.naturalWidth, 40);
  assert.strictEqual(img.naturalHeight, 20);
  assert.strictEqual(img.width, 40);
  assert.strictEqual(img.shown, bmp);
});

test('Worker ortamı: görsel çözülemezse onerror, decode reddedilir', async () => {
  const { box, posted, deliver } = workerSandbox();
  const img = new box.Image();
  let failed = 0;
  img.onerror = () => { failed++; };
  img.src = 'yok';
  deliver({ __sv: 'ret', id: posted[0].id, ok: false, error: 'çözülemedi' });
  await assert.rejects(img.decode(), /çözülemedi/);
  assert.strictEqual(failed, 1);
  assert.strictEqual(img.complete, true);
  assert.strictEqual(img.naturalWidth, 0);
});

test('Worker ortamı: api sayfadaki adlarla kurulur, abonelik ve çağrı ayrı', async () => {
  const { box, posted, deliver } = workerSandbox();
  assert.strictEqual(box.api, undefined, 'sayfada api yoksa Worker\'da da yok');
  deliver({ __sv: 'api', names: ['milkdropTexture', 'onConfig'] });
  assert.deepStrictEqual(Object.keys(box.api).sort(), ['milkdropTexture', 'onConfig']);
  assert.strictEqual(box.api.olmayan, undefined, 'olmayan ad tanımsız kalır, `if (api.x)` denetimleri doğru çalışır');
  const p = box.api.milkdropTexture('a.png');
  const call = posted[posted.length - 1];
  assert.strictEqual(call.__sv, 'call');
  assert.strictEqual(call.name, 'milkdropTexture');
  assert.strictEqual(JSON.stringify(call.args), '["a.png"]');
  deliver({ __sv: 'ret', id: call.id, ok: true, value: 7 });
  assert.strictEqual(await p, 7);
  const got = [];
  box.api.onConfig((c) => got.push(c));
  box.api.onConfig((c) => got.push('ikinci ' + c));
  assert.strictEqual(posted.filter((m) => m.__sv === 'sub').length, 1, 'aynı olaya tek abonelik');
  deliver({ __sv: 'ev', name: 'onConfig', args: ['x'] });
  assert.deepStrictEqual(got, ['x', 'ikinci x']);
});

test('katman yığını sayfasız çalışıyor: stil yalnız tuvalde varsa yazılıyor', () => {
  const s = read('src/visualizer/layers.js');
  assert.match(s, /if \(c\.style\) \{\s+c\.style\.position = 'absolute';/);
  assert.match(s, /layer\.kind === 'background' && e\.canvas\.classList/);
});

test('çeviri Worker\'da da var, sayfada davranış değişmiyor', () => {
  const s = read('src/shared/i18n.js');
  assert.match(s, /typeof document === 'undefined' \|\| !document\.documentElement/);
  assert.match(s, /typeof WorkerGlobalScope !== 'undefined'\) self\.SVI18n = \{ locale, t: translate \}/);
});
