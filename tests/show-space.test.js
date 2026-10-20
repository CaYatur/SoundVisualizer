'use strict';
/* YALITILMIŞ GÖSTERİ (#812): yedek birincilin gösterisini kendi
 * gösterisinin üstüne yazmıyor; rol kapanınca yerel gösteri olduğu gibi
 * dönüyor; sahne tek tek, yeni kimlikle aktarılıyor; videolar paketteki
 * kopyaya eşleniyor. Ana süreçteki bağlantı kaynak düzeyinde denetleniyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const S = require('../src/main/show-space.js');
const R = require('../src/main/redundancy.js');
const K = require('../src/shared/show-keys.js');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sv-space-')); }
const LOCAL = {
  scenes: [{ id: 'sc1', name: 'Benim Sahnem', data: { background: { mode: 'x' } } }],
  userPresets: [{ id: 'u1' }], timeline: { cues: [1] }, background: { mode: 'local' },
  audio: { device: 'my-mic' }, displays: ['d1'], artnet: { enabled: true },
};
const PRIMARY = { scenes: [{ id: 'sc1', name: 'Birincilin Sahnesi' }, { id: 'p2', name: 'P2' }], background: { mode: 'primary' }, clipdeck: { cells: [] } };

test('yedek rolüne geçiş: yerel gösteri ayrı dosyada; ikinci geçişte ezilmiyor', () => {
  const sp = S.createShowSpace(tmp());
  const cfg = JSON.parse(JSON.stringify(LOCAL));
  assert.strictEqual(sp.captureLocal(cfg), true);
  const saved = JSON.parse(fs.readFileSync(sp.localFile, 'utf8'));
  assert.deepStrictEqual(saved.show.scenes, LOCAL.scenes);
  assert.ok(!('audio' in saved.show) && !('artnet' in saved.show), 'kurulum anahtarları gösteriye girmiyor');
  // Ayarlarda artık birincilin kopyası olsa da yerel gösteri değişmez
  const sp2 = S.createShowSpace(sp.dir);
  assert.strictEqual(sp2.captureLocal(Object.assign({}, cfg, PRIMARY)), false);
  assert.deepStrictEqual(sp2.loadLocal().show.scenes, LOCAL.scenes);
});

test('diske giden görünüm: aktarılan anahtarlar yerelden, kurulum bellekten', () => {
  const sp = S.createShowSpace(tmp());
  sp.captureLocal(JSON.parse(JSON.stringify(LOCAL)));
  // Bellekte birincilin gösterisi + bu makinede değişen kurulum
  const live = Object.assign({}, LOCAL, PRIMARY, { audio: { device: 'new-mic' } });
  delete live.userPresets;
  const disk = sp.forDisk(live);
  assert.deepStrictEqual(disk.scenes, LOCAL.scenes);
  assert.deepStrictEqual(disk.background, LOCAL.background);
  assert.deepStrictEqual(disk.userPresets, LOCAL.userPresets, 'birincilde olmayan yerel anahtar korunuyor');
  assert.ok(!('clipdeck' in disk), 'yalnız birincilde olan anahtar diske girmiyor');
  assert.deepStrictEqual(disk.audio, { device: 'new-mic' });
  assert.deepStrictEqual(live.scenes, PRIMARY.scenes, 'bellekteki yapılandırma değişmedi');
});

test('rol bırakılınca yerel gösteri olduğu gibi; dosya silinmiyor, arşivleniyor', () => {
  const dir = tmp();
  const sp = S.createShowSpace(dir);
  sp.captureLocal(JSON.parse(JSON.stringify(LOCAL)));
  sp.savePrimary(PRIMARY, { version: '3.1.6' });
  const live = Object.assign({}, LOCAL, PRIMARY);
  const changed = sp.restoreLocal(live);
  assert.ok(changed.indexOf('scenes') >= 0 && changed.indexOf('clipdeck') >= 0);
  for (const k of K.REPLICATED) assert.deepStrictEqual(live[k], LOCAL[k], k);
  const files = fs.readdirSync(dir);
  assert.ok(files.some((f) => /^local-show\.restored-\d+\.json$/.test(f)), 'arşivlendi');
  assert.ok(files.indexOf('primary-show.json') >= 0, 'birincilin kopyası da kaldı');
  assert.strictEqual(sp.loadLocal(), null, 'sonraki yedek oturumu yeniden alır');
});

test('sahne aktarımı: tek tek; aynı kimlik yerelde varsa yeni kimlik, yerel sahne değişmez', () => {
  const sp = S.createShowSpace(tmp());
  sp.captureLocal(JSON.parse(JSON.stringify(LOCAL)));
  const a = sp.importScene(PRIMARY.scenes[0]);
  assert.notStrictEqual(a.id, 'sc1');
  const b = sp.importScene(PRIMARY.scenes[1]);
  assert.strictEqual(b.id, 'p2');
  const c = sp.importScene(PRIMARY.scenes[0]);
  assert.notStrictEqual(c.id, a.id);
  const scenes = sp.loadLocal().show.scenes;
  assert.deepStrictEqual(scenes[0], LOCAL.scenes[0], 'yerel sahne aynı');
  assert.strictEqual(scenes.length, 4);
  assert.strictEqual(sp.summary().local.scenes, 4);
});

test('video eşleme: birincilin yolu paketteki kopyaya; burada aynı yerde varsa dokunulmaz', () => {
  const cfg = {
    media: { source: 'file', file: 'sv-media://local/' + encodeURIComponent('C:\\Shows\\A.mp4') },
    layers: [{ kind: 'media', settings: { media: { source: 'file', file: 'C:\\Shows\\B.mp4' } } }],
    scenes: [{ id: 's', data: { media: { source: 'file', file: 'c:\\shows\\a.mp4' } } }],
    other: { source: 'camera', file: 'C:\\Shows\\A.mp4' },
  };
  const MU = require('../src/shared/media-url.js');
  const map = { 'C:\\Shows\\A.mp4': '/data/redundancy/package/current/media/a.mp4', 'C:\\Shows\\B.mp4': '/data/b.mp4' };
  const n = S.remapMedia(cfg, map, {
    toRaw: MU.fromMediaUrl,
    toRef: (local, orig) => (String(orig).startsWith(MU.PREFIX) ? MU.toMediaUrl(local) : local),
    exists: (p) => p === 'C:\\Shows\\B.mp4',
    caseInsensitive: true,
  });
  assert.strictEqual(n, 2);
  assert.strictEqual(MU.fromMediaUrl(cfg.media.file), map['C:\\Shows\\A.mp4'], 'adres biçimi korunuyor');
  assert.strictEqual(cfg.layers[0].settings.media.file, 'C:\\Shows\\B.mp4', 'yerinde var: dokunulmadı');
  assert.strictEqual(cfg.scenes[0].data.media.file, map['C:\\Shows\\A.mp4'], 'Windows: büyük/küçük harf');
  assert.strictEqual(cfg.other.file, 'C:\\Shows\\A.mp4', 'dosya kaynağı değil');
  // Büyük/küçük harf duyarlı sistemde (Linux, macOS APFS duyarlı) eşleşmez
  const cfg2 = { media: { source: 'file', file: '/shows/a.mp4' } };
  assert.strictEqual(S.remapMedia(cfg2, { '/Shows/A.mp4': '/x' }, { exists: () => false }), 0);
});

test('devralma verisi: izlerken hep birincilin kopyası; yetkide seçilen ya da operatörün', () => {
  assert.strictEqual(R.normalize({}).takeoverData, 'primary');
  assert.strictEqual(R.normalize({ takeoverData: 'local' }).takeoverData, 'local');
  assert.strictEqual(R.normalize({ takeoverData: 'x' }).takeoverData, 'primary');
  assert.strictEqual(R.showSource('following', { takeoverData: 'local' }), 'primary');
  assert.strictEqual(R.showSource('lost', { takeoverData: 'local' }), 'primary');
  assert.strictEqual(R.showSource('active', {}), 'primary');
  assert.strictEqual(R.showSource('active', { takeoverData: 'local' }), 'local');
  assert.strictEqual(R.showSource('active', { takeoverData: 'local' }, 'primary'), 'primary');
  assert.strictEqual(R.showSource('active', {}, 'local'), 'local');
  // Devralma verisini değiştirmek bağlantıyı yeniden kurdurmaz
  const c = { role: 'backup', secret: 'x'.repeat(16), host: 'h' };
  assert.strictEqual(R.linkSig(c), R.linkSig(Object.assign({}, c, { takeoverData: 'local' })));
  assert.notStrictEqual(R.linkSig(c), R.linkSig(Object.assign({}, c, { host: 'h2' })));
});

test('ana süreç: diske yerel gösteri, yetkide son kopya tutuluyor, bırakınca yeniden eşleme', () => {
  const main = read('src/main/main.js');
  const flush = main.slice(main.indexOf('function flushSettings() {'), main.indexOf('function writeSettingsText('));
  assert.match(flush, /JSON\.stringify\(redundancyDiskView\(config\), null, 2\)/);
  const view = main.slice(main.indexOf('function redundancyDiskView(config) {'), main.indexOf('function packageMediaMap() {'));
  assert.match(view, /return sp\.forDisk\(config\);/);
  assert.match(view, /if \(red\.source === 'local'\) \{[\s\S]*sp\.saveLocal\(show\);/);
  // Yerel gösteri güvenceye alınamazsa yalıtım açılmaz
  const enter = main.slice(main.indexOf('function enterBackupSpace() {'), main.indexOf('function leaveBackupSpace() {'));
  assert.match(enter, /captureLocal\(currentConfig\)[\s\S]*catch \(e\) \{[\s\S]*return;\n  \}\n  red\.isolated = true;/);
  const sync = main.slice(main.indexOf('function syncRedundancy() {'), main.indexOf('// Birincil: yeni bağlanan yedeğe'));
  assert.match(sync, /if \(wasIsolated && !runsBackup\) leaveBackupSpace\(\);/);
  assert.match(sync, /const sig = redundancy\.linkSig\(c\);/);
  const onMsg = main.slice(main.indexOf('function onPrimaryMessage(msg) {'), main.indexOf('function sharedEpoch() {'));
  assert.match(onMsg, /red\.isolated\) \{[\s\S]*redundancy\.applyIncoming\(red\.primaryLatest, msg\);[\s\S]*\n  if \(\(msg\.type === 'snapshot' \|\| msg\.type === 'patch'\) && f\.follows\(\)/);
  const changed = main.slice(main.indexOf('function onFollowerChanged() {'), main.indexOf('const pkgHashCache'));
  assert.match(changed, /red\.client\.send\(\{ type: 'peer-resync' \}\)/);
  assert.match(main, /msg\.type === 'peer-resync' && client && red\.role === 'primary'\) \{\n    sendPeerSnapshot\(client\);/);
  assert.ok(read('src/main/stream-server.js').includes("const PEER_MESSAGES = ['peer-state', 'peer-inventory', 'peer-resync', 'pkg-request', 'pkg-get', 'peer-beat', 'peer-info', 'ctl', 'ctl-result', 'mon', 'mon-frame', 'handback'];"));
});

test('eski gönderim yedeğin öğesini ezmiyor; paket çakışması yerel öğeyi koruyor', () => {
  const main = read('src/main/main.js');
  const asset = main.slice(main.indexOf('function onPrimaryAsset(msg) {'), main.indexOf("ipcMain.handle('redundancy:push'"));
  assert.match(asset, /if \(presetsStore\.get\(msg\.preset\.id\)\) return false;/);
  assert.match(asset, /if \(own && own\.file\) return false;/);
  const inst = main.slice(main.indexOf('function loadPackageOverlay() {'), main.indexOf('/* ---', main.indexOf('function installPackage() {')));
  // Paket kütüphaneye hiçbir şey yazmaz: eksikler yalıtılmış katmana (#812)
  assert.doesNotMatch(inst, /presetsStore\.save|logoLibrary\.importBytes/);
  assert.match(inst, /presets\.set\(p\.id, Object\.assign\(\{\}, p, \{ builtin: false, fromPrimary: true \}\)\);/);
  assert.match(inst, /res\.isolated\.push\(\{ kind: 'logo'/);
  assert.match(inst, /else res\.conflicts\.push\(\{ kind: 'preset'/);
  assert.match(inst, /else res\.conflicts\.push\(\{ kind: 'logo'/);
  // Birincil yalnız son manifestteki dosyayı, adıyla verir (yedek yol veremez)
  const serve = main.slice(main.indexOf('async function servePackageChunk('), main.indexOf('function pkgSend('));
  assert.match(serve, /const e = sv\.byPath\.get\(msg\.path\);/);
});

/* İZLERKEN OLAY DÖNGÜSÜ BEKLEMESİN (#812). Birincilin kopyası arka planda
   yazılıyor; çağıranın JSON metni kullanılıyor, bellekteki kopya hemen
   güncel; üst üste gelen yazımlardan yalnız sonuncusu diske gidiyor. */
test('birincilin kopyası arka planda yazılıyor; son yazım kazanıyor; bellekte hemen', async () => {
  const dir = tmp();
  const sp = S.createShowSpace(dir);
  let writes = 0;
  const realWrite = fs.promises.writeFile;
  fs.promises.writeFile = async (...a) => { writes++; return realWrite.apply(fs.promises, a); };
  try {
    const p1 = sp.savePrimaryJson(JSON.stringify({ scenes: [{ id: 'a' }] }), { version: '3.1.6' });
    sp.savePrimaryJson(JSON.stringify({ scenes: [{ id: 'b' }] }), { version: '3.1.6' });
    sp.savePrimaryJson(JSON.stringify({ scenes: [{ id: 'c' }] }), { version: '3.1.6' });
    // Henüz diskte olmasa da bellekteki kopya son hâl
    assert.deepStrictEqual(sp.loadPrimary().show.scenes.map((x) => x.id), ['c']);
    assert.strictEqual(sp.loadPrimary().version, '3.1.6');
    await p1;
    await sp.flushPrimary();
    assert.ok(writes <= 2, 'ara hâller atlanır (' + writes + ')');
    const disk = JSON.parse(fs.readFileSync(sp.primaryFile, 'utf8'));
    assert.deepStrictEqual(disk.show.scenes.map((x) => x.id), ['c']);
    assert.ok(Number.isFinite(disk.receivedAt) && disk.format >= 1);
    assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
    // Yeni bir alan diskten okur
    assert.deepStrictEqual(S.createShowSpace(dir).loadPrimary().show.scenes.map((x) => x.id), ['c']);
  } finally {
    fs.promises.writeFile = realWrite;
  }
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(main, /sp\.savePrimaryJson\(sig, \{ version: red\.primaryVersion \|\| '' \}\);/);
  assert.match(main, /if \(text === lastSettingsText && fs\.existsSync\(SETTINGS_PATH\) && \(!settingsGuardOn \|\| settingsGuard\.changed\(\) === false\)\) return true;/);
});
