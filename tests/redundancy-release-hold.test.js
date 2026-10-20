'use strict';
/* YEDEKLİLİK: WINDOWS DENEMESİNDE BULUNANLAR (#812, PR #817 @ 8667edc).
 *
 * 1. El ile "Yetkiyi Bırak"tan sonra, birincil hâlâ yokken kendiliğinden
 *    devralma yetkiyi aynı anda geri alıyordu. Artık birincil yeniden canlı
 *    görülene ya da operatör yeniden kurana dek bekliyor.
 * 2. MilkDrop eşlik uyarısı el ile seçilen presette de çıkıyor (sahne
 *    kopyasıyla gelen kimlik ve kaynak yerel kütüphaneyle karşılaştırılıyor).
 * 3. Yerel gösteri arşivleri listeleniyor ve geri yükleniyor; ad denetimi
 *    klasör dışına çıkmaya izin vermiyor.
 * 4. Paket videoları kutu işaretlenmeden listeleniyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const R = require('../src/main/redundancy');
const S = require('../src/main/show-space');
const Pkg = require('../src/main/show-package');
const MAIN = read('src/main/main.js');
const PANEL = read('src/admin/redundancy-panel.js');

const CFG = { role: 'backup', heartbeatMs: 100, timeoutMs: 1500, takeover: 'auto' };

test('bırakış: birincil yokken otomatik devralma bekliyor; el ile devralma çalışıyor', () => {
  const f = R.createFollower(CFG, 0);
  f.connected();
  f.beat({ seq: 1, at: 0 }, 0);
  f.disconnected();
  assert.ok(f.tick(2000), 'birincil düştü');
  assert.strictEqual(f.status.state, 'active');
  assert.strictEqual(f.status.takenBy, 'auto');
  assert.ok(f.release(3000));
  assert.strictEqual(f.status.autoHeld, true);
  // Eskiden bir sonraki tikte (ya da açılış payının sonunda) yeniden devralıyordu
  for (let t = 3100; t < 30000; t += 100) f.tick(t);
  assert.notStrictEqual(f.status.state, 'active', 'otomatik devralma bekletilmeli');
  assert.strictEqual(f.status.state, 'lost');
  assert.strictEqual(f.follows(), true, 'yedek birincilin son görüntüsünü çizmeye devam ediyor');
  // El ile her zaman
  assert.ok(f.takeover(30100));
  assert.strictEqual(f.status.autoHeld, false);
});

test('bırakış: birincil yeniden görülünce bekleme biter, sonraki kayıpta yine devralır', () => {
  const f = R.createFollower(CFG, 0);
  f.beat({ seq: 1, at: 0 }, 0);
  f.tick(2000);
  f.release(2100);
  f.tick(9000);
  assert.strictEqual(f.status.state, 'lost');
  f.beat({ seq: 2, at: 9100 }, 9100);
  assert.strictEqual(f.status.autoHeld, false);
  assert.strictEqual(f.status.state, 'following');
  assert.ok(f.tick(11000));
  assert.strictEqual(f.status.state, 'active');
  assert.strictEqual(f.status.takenBy, 'auto');
});

test('bırakış: operatör yeniden kurunca birincil yoksa hemen devralır; Elle modunda bekleme yok', () => {
  const f = R.createFollower(CFG, 0);
  f.beat({ seq: 1, at: 0 }, 0);
  f.tick(2000);
  f.release(2100);
  f.tick(9000);
  assert.strictEqual(f.rearm(), true);
  assert.strictEqual(f.rearm(), false, 'ikinci kez bir şey değişmez');
  assert.ok(f.tick(9100));
  assert.strictEqual(f.status.state, 'active');
  const m = R.createFollower(Object.assign({}, CFG, { takeover: 'manual' }), 0);
  m.takeover(10);
  m.release(20);
  assert.strictEqual(m.status.autoHeld, false);
});

test('bırakış: ana süreç yeniden kurma IPC\'si, durum paneli ve önyükleme', () => {
  assert.match(MAIN, /ipcMain\.handle\('redundancy:rearm'/);
  assert.match(MAIN, /held && !f\.status\.autoHeld\) notifyRedundancySoon\(\)/);
  assert.match(read('src/main/preload-admin.js'), /redundancyRearm: \(\) => ipcRenderer\.invoke\('redundancy:rearm'\)/);
  assert.match(PANEL, /status\.autoHeld && !active && r\.takeover !== 'manual'/);
  assert.match(PANEL, /Otomatik Devralmayı Yeniden Kur/);
});

// noteMdManual ve yardımcıları main.js'ten çıkarılıp sahte ortamda çalıştırılır
function manualEnv(lib) {
  const start = MAIN.indexOf('let mdBuiltinIds = null;');
  const end = MAIN.indexOf('/* Görselleştirici penceresi ve Spout/Syphon yokken');
  assert.ok(start > 0 && end > start);
  const red = { parity: {} };
  let notes = 0;
  const fn = new Function('require', 'red', 'presetForShow', 'notifyRedundancySoon',
    MAIN.slice(start, end) + '\nreturn { noteMdManual, isMdBuiltin };');
  const api = fn((m) => require(path.join(__dirname, '..', 'src', 'main', m)), red, (id) => lib[id] || null, () => { notes++; });
  return { api, red, notes: () => notes };
}

test('MilkDrop eşliği: el ile seçilen birincile özgü preset uyarı veriyor; kütüphaneye girince kalkıyor', () => {
  const lib = { md_same: { id: 'md_same', source: 'S' }, md_diff: { id: 'md_diff', source: 'LOCAL' } };
  const env = manualEnv(lib);
  assert.strictEqual(env.api.noteMdManual({ milkdrop: { presetId: 'md_only', name: 'Only A', source: 'X' } }), 1);
  assert.deepStrictEqual(Object.values(env.red.parity).map((p) => [p.id, p.status, p.via, p.name]), [['md_only', 'missing', 'manual', 'Only A']]);
  // Aynı içerik: uyarı yok, önceki seçimin uyarısı kalkar
  env.api.noteMdManual({ milkdrop: { presetId: 'md_same', source: 'S' } });
  assert.deepStrictEqual(env.red.parity, {});
  // Aynı kimlik, farklı kaynak
  env.api.noteMdManual({ milkdrop: { presetId: 'md_diff', source: 'PRIMARY' } });
  assert.strictEqual(env.red.parity.md_diff.status, 'different');
  // MilkDrop katmanının presetId'si de (klip destesi, AutoVJ)
  env.api.noteMdManual({ milkdrop: { presetId: '' }, layers: [{ type: 'milkdrop', presetId: 'md_layer', name: 'L' }, { type: 'shader', presetId: 'sh_x' }] });
  assert.deepStrictEqual(Object.keys(env.red.parity), ['md_layer']);
  // Yerleşik preset uygulamayla gelir: denetlenmez
  env.api.noteMdManual({ milkdrop: { presetId: 'md_caya_aurora', source: 'whatever' } });
  assert.deepStrictEqual(env.red.parity, {});
  // Otomatik seçimin uyarısına dokunulmuyor
  env.red.parity.md_auto = { id: 'md_auto', status: 'missing', via: 'auto' };
  env.api.noteMdManual({ milkdrop: { presetId: 'md_same', source: 'S' } });
  assert.ok(env.red.parity.md_auto);
  // Ayrı alandaki (paketle gelen) preset de "var" sayılır
  lib.md_only = { id: 'md_only', source: 'X' };
  env.api.noteMdManual({ milkdrop: { presetId: 'md_only', source: 'X' } });
  assert.ok(!env.red.parity.md_only);
});

test('MilkDrop eşliği: sahne kopyası her geldiğinde ve kütüphane değişince denetleniyor; otomatik uyarı tek', () => {
  assert.match(MAIN, /noteMdManual\(next\);\n    if \(!changed\.length\) return;\n    applyIncomingConfig\(next, \{ patchKeys: changed, fromPrimary: true \}\);/);
  assert.match(MAIN, /red\.follower\.follows\(\)\) noteMdManual\(currentConfig\);/);
  assert.match(MAIN, /if \(v\.via === 'auto' && k !== id\) \{ delete red\.parity\[k\]/);
  assert.match(PANEL, /p\.via === 'manual' \? 'El ile seçildi' : 'Otomatik seçim'/);
});

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sv-arch-')); }

test('arşivler: listeleniyor (en yeni önce), okunuyor, ad denetimi klasör dışına çıkmıyor', () => {
  const dir = tmp();
  const sp = S.createShowSpace(dir);
  sp.captureLocal({ scenes: [{ id: 'a' }], layers: [] });
  assert.ok(sp.restoreLocal({}));
  const first = sp.listArchives();
  assert.strictEqual(first.length, 1);
  assert.match(first[0].name, /^local-show\.restored-\d+\.json$/);
  const name2 = sp.archiveShow({ scenes: [{ id: 'b' }, { id: 'c' }] });
  const list = sp.listArchives();
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].name, name2, 'en yeni önce');
  assert.ok(list[0].at >= list[1].at && list[0].size > 0);
  const a = sp.readArchive(name2);
  assert.strictEqual(a.scenes, 2);
  assert.deepStrictEqual(a.show.scenes.map((s) => s.id), ['b', 'c']);
  for (const bad of ['../settings.json', 'local-show.json', 'local-show.restored-1.json/../../x', 'local-show.restored-abc.json', '', null, 5]) {
    assert.strictEqual(sp.readArchive(bad), null, String(bad));
  }
  fs.writeFileSync(path.join(dir, 'local-show.restored-123.json'), 'bozuk');
  assert.strictEqual(sp.readArchive('local-show.restored-123.json'), null);
  fs.writeFileSync(path.join(dir, 'other.json'), '{}');
  assert.ok(sp.listArchives().every((x) => /^local-show\.restored-\d+\.json$/.test(x.name)));
});

test('arşivler: geri yükleme IPC\'si önce şu anki gösteriyi arşivliyor; panel onay istiyor', () => {
  const at = MAIN.indexOf("ipcMain.handle('redundancy:restore-archive'");
  assert.ok(at > 0);
  const body = MAIN.slice(at, at + 2200);
  assert.ok(body.indexOf('archiveShow(') < body.indexOf('saveLocal(a.show)'), 'yedek rolünde önce arşiv');
  assert.match(body, /backup = sp\.archiveShow\(ShowKeys\.pick\(currentConfig, ShowKeys\.REPLICATED\)\);\n      const next/);
  assert.match(body, /notifyAdminConfigNow\(\)/);
  assert.match(read('src/main/preload-admin.js'), /redundancyRestoreArchive: \(name\) => ipcRenderer\.invoke\('redundancy:restore-archive', name\)/);
  assert.match(PANEL, /if \(!\(await P\(\)\.confirm\(msg, \{ okText: tr\('Geri Yükle'\) \}\)\)\) return;/);
});

test('paket: videolar kutu işaretlenmeden listeleniyor; bu makinede olanlar işaretli', () => {
  const root = tmp();
  const buf = Buffer.from('video-bytes');
  const items = [
    { kind: 'media', id: 'C:\\v\\a.mp4', name: 'a.mp4', ext: '.mp4', size: buf.length, sha256: Pkg.sha256(buf), ref: 'C:\\v\\a.mp4' },
    { kind: 'media', id: 'C:\\v\\b.mp4', name: 'b.mp4', ext: '.mp4', size: 4, sha256: Pkg.sha256(Buffer.from('bbbb')), ref: 'C:\\v\\b.mp4' },
    { kind: 'presets', id: 'p1', name: 'p1', ext: '.json', size: 2, sha256: Pkg.sha256(Buffer.from('{}')) },
  ];
  const m = Pkg.buildManifest(items);
  const a = m.items.find((it) => it.name === 'a.mp4');
  fs.mkdirSync(path.join(root, 'current'), { recursive: true });
  Pkg.writeJsonAtomic(path.join(root, 'current', 'manifest.json'), Object.assign({}, m, { items: [a] }));
  const pull = Pkg.createPull({ root });
  pull.offer(m);
  const st = pull.status;
  assert.strictEqual(st.media, false);
  assert.ok(st.files.every((f) => f.kind !== 'media'), 'aktarım listesi kutu işaretlenmeden videosuz');
  assert.deepStrictEqual(st.mediaFiles, [{ name: 'a.mp4', size: buf.length, have: true }, { name: 'b.mp4', size: 4, have: false }]);
  assert.match(PANEL, /nodes\.push\(mediaList\(pk\.mediaFiles \|\| \[\]\)\);/);
  assert.match(MAIN, /createPull\(\{ window: 2, root: redSpace\(\)\.pkgRoot \}\)/);
});
