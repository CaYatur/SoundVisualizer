'use strict';
/* GÖSTERİ KARŞILAŞTIRMASI (#541): iki makine aynı gösteriyi mi çalıştırıyor.
 * Envanter, özet, fark, parçalı gönderim, aynı kimlikle logo yazımı ve
 * silinen anahtarın yedeğe ulaşması. Gerçek iki makineli deneme
 * `npm run failover` (gösteri karşılaştırması + gönderim + eşit özet).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const I = require('../src/main/show-inventory.js');
const R = require('../src/main/redundancy.js');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

test('özet anahtar sırasından bağımsız; preset kayıt zamanı sayılmaz', () => {
  assert.strictEqual(I.canon({ b: 1, a: [1, { d: 2, c: 3 }] }), I.canon({ a: [1, { c: 3, d: 2 }], b: 1 }));
  const p = { id: 'x', kind: 'visualizer', name: 'A', shader: 's', updatedAt: 1, createdAt: 1 };
  assert.strictEqual(I.presetFp(p), I.presetFp(Object.assign({}, p, { updatedAt: 99, createdAt: 50 })));
  assert.notStrictEqual(I.presetFp(p), I.presetFp(Object.assign({}, p, { shader: 't' })));
});

test('envanter: sürüm, aktarılan ayar, kullanıcı presetleri, logolar, videolar; aynı girdi aynı özet', () => {
  const input = {
    version: '3.2.0-beta',
    cfg: { visualizer: { type: 'bars' }, audio: { device: 'x' } },
    presets: [{ id: 'usr_1', kind: 'visualizer', name: 'A' }, { id: 'b1', builtin: true }, { id: 'usr_2', fp: 'cached' }],
    logos: [{ id: 'logo_1', size: 10, fp: 'abc' }],
    media: { 'C:/v.mp4': 'f1', 'C:/gone.mp4': '' },
  };
  const a = I.build(input);
  assert.ok(a.items['app:version'] === '3.2.0-beta');
  assert.ok('cfg:visualizer' in a.items);
  assert.ok(!('cfg:audio' in a.items), 'kurulum envantere girmez');
  assert.ok('preset:usr_1' in a.items && !('preset:b1' in a.items), 'yerleşik preset koddan gelir');
  assert.strictEqual(a.items['preset:usr_2'], 'cached', 'önbellekteki özet');
  assert.strictEqual(a.items['media:C:/gone.mp4'], 'missing');
  assert.strictEqual(a.hash, I.build(JSON.parse(JSON.stringify(input))).hash);
  assert.notStrictEqual(a.hash, I.build(Object.assign({}, input, { version: '3.2.1' })).hash);
});

test('fark birincilin gözünden: eksik, farklı, yedekte fazla; yalnız preset ve logo gönderilebilir', () => {
  const p = { items: { 'app:version': '1', 'cfg:visualizer': 'v', 'preset:a': 'x', 'logo:l': 'y', 'media:/v.mp4': 'f', 'preset:same': 's' } };
  const b = { items: { 'app:version': '2', 'cfg:visualizer': 'v', 'preset:a': 'z', 'media:/v.mp4': 'missing', 'preset:only': 'q', 'preset:same': 's' } };
  const d = I.diff(p, b);
  const by = (k) => d.find((x) => x.key === k);
  assert.strictEqual(by('app:version').status, 'different');
  assert.strictEqual(by('app:version').pushable, false);
  assert.strictEqual(by('preset:a').status, 'different');
  assert.strictEqual(by('preset:a').pushable, true);
  assert.strictEqual(by('logo:l').status, 'missing');
  assert.strictEqual(by('logo:l').pushable, true);
  assert.strictEqual(by('media:/v.mp4').status, 'missing', 'yedekte dosya yok');
  assert.strictEqual(by('media:/v.mp4').pushable, false, 'video gönderilmez');
  assert.strictEqual(by('preset:only').status, 'extra');
  assert.strictEqual(by('cfg:visualizer'), undefined);
  assert.strictEqual(by('preset:same'), undefined);
});

test('envanter parçaları 256 KB sınırının altında; birleşince aynı', () => {
  const items = {};
  for (let i = 0; i < 10500; i++) items['preset:usr_' + i.toString(36) + '_abcdefghij'] = 'f'.repeat(16);
  const parts = I.chunks(items, 2000);
  assert.strictEqual(parts.length, 6);
  for (const pt of parts) assert.ok(Buffer.byteLength(JSON.stringify({ type: 'peer-inventory', id: 1, part: 0, of: 6, items: pt })) < 256 * 1024);
  assert.deepStrictEqual(Object.assign({}, ...parts), items);
  assert.deepStrictEqual(I.chunks({}, 2000), [{}], 'boş envanter de bir parça');
});

test('dosya parmak izi: boyut ve baş/son; olmayan dosya boş', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-inv-'));
  try {
    const f = path.join(dir, 'a.bin');
    fs.writeFileSync(f, Buffer.alloc(3 * 1024 * 1024, 1));
    const a = I.fileFp(f);
    const buf = Buffer.alloc(3 * 1024 * 1024, 1);
    buf[buf.length - 1] = 2;
    fs.writeFileSync(f, buf);
    assert.notStrictEqual(I.fileFp(f), a, 'son değişti');
    assert.strictEqual(I.fileFp(path.join(dir, 'yok')), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('logo aynı kimlikle yazılır, içe aktarmadaki denetimlerden geçer, aynı kimlik yerine geçer', () => {
  const L = require('../src/main/logo-library.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-logo-'));
  try {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    assert.strictEqual(L.importBytes(dir, { id: '../x', ext: '.png', bytes: png }).error, 'BAD_ID');
    assert.strictEqual(L.importBytes(dir, { id: 'logo_a', ext: '.exe', bytes: png }).error, 'TYPE');
    assert.strictEqual(L.importBytes(dir, { id: 'logo_a', ext: '.png', bytes: Buffer.from('MZ not a png') }).error, 'TYPE');
    const r = L.importBytes(dir, { id: 'logo_a', name: 'A', ext: '.png', bytes: png });
    assert.ok(r.ok);
    assert.strictEqual(L.list(dir).find((x) => x.id === 'logo_a').name, 'A');
    const r2 = L.importBytes(dir, { id: 'logo_a', name: 'B', ext: '.png', bytes: png });
    assert.ok(r2.ok);
    assert.strictEqual(L.loadManifest(dir).items.filter((x) => x.id === 'logo_a').length, 1, 'tek kayıt');
    assert.ok(L.fileInfo(dir, 'logo_a'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('birincilde silinen anahtar yedekte de silinir (anlık görüntü ve yama)', () => {
  const target = { visualizer: { type: 'x' }, _activeSceneId: 'old', audio: { device: 'mine' } };
  R.applyIncoming(target, R.snapshotMsg({ visualizer: { type: 'bars' } }, 1));
  assert.strictEqual(target._activeSceneId, undefined, 'anlık görüntüde yok: silindi');
  assert.strictEqual(target.audio.device, 'mine', 'kurulum dokunulmaz');
  target._activeSceneId = 's1';
  const msg = R.patchMsg({ visualizer: { type: 'bars' } }, ['_activeSceneId'], 2);
  assert.deepStrictEqual(msg.removed, ['_activeSceneId']);
  const changed = R.applyIncoming(target, JSON.parse(JSON.stringify(msg)));
  assert.deepStrictEqual(changed, ['_activeSceneId']);
  assert.strictEqual(target._activeSceneId, undefined);
});

test('bağlantılar: yedek envanter gönderebilir, birincil karşılaştırır ve onayla gönderir', () => {
  const ss = read('src/main/stream-server.js');
  assert.match(ss, /msg\.type === 'peer-state' \|\| msg\.type === 'peer-inventory'/);
  const main = read('src/main/main.js');
  assert.match(main, /if \(msg\.type === 'inventory-request'\) \{ sendInventory\(msg\.id\)/);
  assert.match(main, /if \(msg\.type === 'asset'\) \{ onPrimaryAsset\(msg\); return; \}/);
  assert.match(main, /scheduleCompare\(\); \/\/ yedekle gösteri karşılaştırması bayatladı/);
  assert.match(main, /if \(\+\+i % 200 === 0\) await new Promise\(\(r\) => setImmediate\(r\)\);/, 'büyük kütüphanede kalp atışı aksamaz');
  assert.match(main, /logoLibrary\.importBytes\(logoLibDir\(\)/);
  const panel = read('src/admin/redundancy-panel.js');
  assert.match(panel, /const ok = await P\(\)\.confirm\(text, \{ okText: tr\('Yedeğe Gönder'\) \}\);/, 'açık onay');
  assert.match(read('src/main/preload-admin.js'), /redundancyPush: \(\) => ipcRenderer\.invoke\('redundancy:push'\)/);
});
