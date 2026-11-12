'use strict';
/* Gösterinin dosyaları yedek makineye eksiksiz gidiyor mu (#812):
 * kapalı ve susturulmuş video katmanları, MilkDrop dokuları, tür
 * anlaşması (eski yedek yeni türü tanımıyor) ve yedekte birincilin
 * doku klasörü yerine kendi klasörü. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Refs = require('../src/shared/preshow-refs');
const Pkg = require('../src/main/show-package');
const mdTex = require('../src/main/milkdrop-textures');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function sceneWith(layers) {
  return { media: {}, layers, scenes: [] };
}
const mediaLayer = (file, extra) => Object.assign({ kind: 'media', settings: { media: { source: 'file', file } } }, extra || {});

test('video listesi: denetim yalnız çizilen katmanı, paket kapalı katmanları da sayıyor', () => {
  const cfg = sceneWith([
    mediaLayer('D:/v/acik.mp4'),
    mediaLayer('D:/v/kapali.mp4', { enabled: false }),
    mediaLayer('D:/v/sessiz.mp4', { muted: true }),
  ]);
  cfg.scenes.push({ name: 'B', data: sceneWith([mediaLayer('D:/v/kayitli-kapali.mp4', { enabled: false })]) });
  const ids = (opts) => Refs.collect(cfg, opts).filter((r) => r.kind === 'media').map((r) => r.id).sort();
  assert.deepStrictEqual(ids(), ['D:/v/acik.mp4']);
  assert.deepStrictEqual(ids({ all: true }), ['D:/v/acik.mp4', 'D:/v/kapali.mp4', 'D:/v/kayitli-kapali.mp4', 'D:/v/sessiz.mp4']);
});

test('ana süreç: paketin ve envanterin video listesi kapalı katmanları da alıyor', () => {
  const main = read('src/main/main.js');
  assert.match(main, /function showMediaPaths\(cfg\) \{[\s\S]{0,200}PreshowRefs\.collect\(cfg, \{ all: true \}\)/);
  // Video dışa aktarımı yine yalnız çizilen katmanları açıyor
  assert.match(read('src/main/export-media.js'), /l\.enabled === false \|\| l\.muted/);
});

test('tür anlaşması: listesiz istek eski yedek, bilinmeyen tür süzülüyor', () => {
  assert.deepStrictEqual(Pkg.kindsFrom(undefined), ['presets', 'logos', 'media']);
  assert.deepStrictEqual(Pkg.kindsFrom(['media', 'textures', 'fonts']), ['media', 'textures']);
  assert.ok(Pkg.KINDS.includes('textures'));
  const main = read('src/main/main.js');
  assert.ok(!/send\(\{ type: 'pkg-request' \}\)/.test(main), 'tür listesiz istek kaldı');
  assert.match(main, /servePackageManifest\(client, showPackage\.kindsFrom\(msg\.kinds\)\)/);
  assert.match(main, /type: 'pkg-request', kinds: showPackage\.KINDS/);
});

test('manifest: doku girdisi geçerli, adı küçük harfli ve özetli', () => {
  const bytes = Buffer.from('png');
  const m = Pkg.buildManifest([
    { kind: 'textures', id: 'worms.jpg', name: 'Worms.JPG', ext: '.JPG', size: bytes.length, sha256: Pkg.sha256(bytes) },
  ], { version: 't' });
  assert.strictEqual(Pkg.validateManifest(m), '');
  assert.match(m.items[0].path, /^textures\/worms-jpg-[0-9a-f]{10}\.jpg$/);
  assert.strictEqual(m.items[0].name, 'Worms.JPG');
});

test('yedekte doku: önce yerel klasörler, sonra paketteki özgün adıyla', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-tex-'));
  try {
    const local = path.join(tmp, 'local');
    const store = path.join(tmp, 'store', 'abc');
    fs.mkdirSync(local, { recursive: true });
    fs.mkdirSync(store, { recursive: true });
    fs.writeFileSync(path.join(local, 'worms.jpg'), 'yerel');
    fs.writeFileSync(path.join(store, 'clouds-png-0123456789.png'), 'paket');
    fs.writeFileSync(path.join(store, 'worms-jpg-0123456789.jpg'), 'paket-worms');
    const extra = new Map([
      ['clouds.png', { name: 'Clouds.png', file: path.join(store, 'clouds-png-0123456789.png') }],
      ['worms.jpg', { name: 'worms.jpg', file: path.join(store, 'worms-jpg-0123456789.jpg') }],
      ['x.png', { name: '../x.png', file: path.join(store, 'clouds-png-0123456789.png') }],
    ]);
    assert.deepStrictEqual(mdTex.listTexturesWith([local, ''], extra).names, ['Clouds.png', 'worms.jpg']);
    assert.deepStrictEqual(mdTex.listTexturesWith([local], null).names, ['worms.jpg']);
    const own = mdTex.textureFileInfoWith([local], 'worms.jpg', 1e6, extra);
    assert.strictEqual(fs.readFileSync(own.file, 'utf8'), 'yerel');
    const fromPkg = mdTex.textureFileInfoWith([local], 'Clouds.png', 1e6, extra);
    assert.strictEqual(fs.readFileSync(fromPkg.file, 'utf8'), 'paket');
    assert.strictEqual(fromPkg.mime, 'image/png');
    assert.strictEqual(mdTex.textureFileInfoWith([local], 'x.png', 1e6, extra), null);
    assert.strictEqual(mdTex.textureFileInfoWith([local], 'Clouds.png', 1e6, null), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('yedek birincilin doku klasörünü değil kendininkini kullanıyor; pencereler listeyi yeniliyor', () => {
  const main = read('src/main/main.js');
  assert.match(main, /function textureDir\(\) \{[\s\S]{0,500}red\.isolated && red\.source === 'primary'[\s\S]{0,300}loadLocal\(\)/);
  assert.match(main, /sendToVisualizers\('milkdrop-textures-changed', null\)/);
  assert.match(read('src/main/preload-visualizer.js'), /onMilkdropTexturesChanged: \(cb\) => ipcRenderer\.on\('milkdrop-textures-changed'/);
  assert.match(read('src/visualizer/modes/milkdrop.js'), /const key = dir \+ '#' \+ rev \+ '#' \+ texEpoch;/);
});
