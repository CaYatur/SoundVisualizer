'use strict';
/* Aynı ayar klasörünü kullanan kopyaların kayıt defteri (#564).
 *
 * Kayıt defteri gerçek bir geçici klasörde sınanıyor: yeniden adlandırma,
 * silme ve bozuk dosya davranışı dosya sisteminin kendisine bağlı. Süreç
 * yaşıyor mu sorusu enjekte ediliyor — testte başka bir kopya çalışmıyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const I = require('../src/main/instances.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sv-instances-'));
}

function put(dir, e) {
  assert.ok(I.write(dir, e), 'kayıt yazılamadı');
}

const NOW = 1_800_000_000_000;

test('derleme türü: portable başlatıcının ortam değişkeni, paketlenmiş, geliştirme', () => {
  assert.strictEqual(I.kindOf({ PORTABLE_EXECUTABLE_FILE: 'C:\\x.exe' }, true), 'portable');
  assert.strictEqual(I.kindOf({ PORTABLE_EXECUTABLE_DIR: 'C:\\' }, true), 'portable');
  assert.strictEqual(I.kindOf({}, true), 'installed');
  assert.strictEqual(I.kindOf({}, false), 'dev');
  assert.strictEqual(I.kindOf(null, false), 'dev');
});

test('gösterilen yol: portable indirilen dosya, geliştirme depo, kurulu uygulama', () => {
  const env = { PORTABLE_EXECUTABLE_FILE: 'D:\\İndirilenler\\CAYADEV-portable.exe' };
  assert.strictEqual(I.exeFor('portable', { env, execPath: 'C:\\Temp\\app.exe' }), env.PORTABLE_EXECUTABLE_FILE);
  assert.strictEqual(I.exeFor('dev', { appPath: 'D:\\repo', execPath: 'D:\\repo\\electron.exe' }), 'D:\\repo');
  assert.strictEqual(I.exeFor('installed', { execPath: 'C:\\Program Files\\CAYADEV Visualizer\\CAYADEV Visualizer.exe' }),
    'C:\\Program Files\\CAYADEV Visualizer\\CAYADEV Visualizer.exe');
});

test('kayıt yalnız bilinen alanları taşıyor ve bilinmeyen tür/rolü düzeltiyor', () => {
  const e = I.entry({ pid: 7, version: '3.1.5', kind: 'garip', role: 'başka', exe: 'x', secret: 'yok', startedAt: '5', locale: 'de' });
  assert.deepStrictEqual(Object.keys(e).sort(), ['exe', 'kind', 'locale', 'pid', 'role', 'startedAt', 'updatedAt', 'version']);
  assert.strictEqual(e.kind, 'dev');
  assert.strictEqual(e.role, 'app');
  assert.strictEqual(e.startedAt, 5);
  assert.strictEqual(e.locale, '');
});

test('taze ve yaşayan kopya görünür, kendisi görünmez', () => {
  const dir = tmpDir();
  put(dir, { pid: 100, version: '3.1.5', kind: 'installed', role: 'app', startedAt: NOW - 60000, updatedAt: NOW - 1000 });
  put(dir, { pid: 200, version: '3.1.5', kind: 'dev', role: 'app', startedAt: NOW - 30000, updatedAt: NOW - 500 });
  const seen = I.live(dir, { now: NOW, selfPid: 200, isAlive: () => true });
  assert.deepStrictEqual(seen.map((e) => e.pid), [100]);
  assert.strictEqual(seen[0].kind, 'installed');
});

test('ölü sürecin kaydı hemen düşüyor ve siliniyor — tazelik süresi beklenmiyor', () => {
  const dir = tmpDir();
  put(dir, { pid: 300, version: '3.1.5', role: 'app', startedAt: NOW - 5000, updatedAt: NOW - 100 });
  const seen = I.live(dir, { now: NOW, selfPid: 1, isAlive: (pid) => pid !== 300 });
  assert.strictEqual(seen.length, 0);
  assert.ok(!fs.existsSync(I.fileFor(dir, 300)), 'ölü kopyanın kaydı silinmedi');
});

test('bayat kayıt görünmüyor ama süreç yaşıyorsa silinmiyor (uyku dönüşü)', () => {
  const dir = tmpDir();
  put(dir, { pid: 400, version: '3.1.5', role: 'app', startedAt: NOW - 90000, updatedAt: NOW - I.STALE_MS - 1 });
  assert.strictEqual(I.live(dir, { now: NOW, selfPid: 1, isAlive: () => true }).length, 0);
  assert.ok(fs.existsSync(I.fileFor(dir, 400)), 'yaşayan kopyanın kaydı silindi');
});

test('çok eski kayıt, kimliği yaşıyor görünse de siliniyor (kimlik yeniden dağıtıldı)', () => {
  const dir = tmpDir();
  put(dir, { pid: 500, version: '3.1.5', role: 'app', startedAt: 1, updatedAt: NOW - I.PRUNE_MS - 1 });
  assert.strictEqual(I.live(dir, { now: NOW, selfPid: 1, isAlive: () => true }).length, 0);
  assert.ok(!fs.existsSync(I.fileFor(dir, 500)));
});

test('bozuk dosya atlanıyor; yeni ise başkası yazıyor olabilir diye silinmiyor', () => {
  const dir = tmpDir();
  const now = Date.now(); // bozuk dosyanın yaşı gerçek değiştirilme zamanından
  const bad = path.join(dir, '600.json');
  fs.writeFileSync(bad, '{"pid": 6');
  put(dir, { pid: 700, version: '3.1.5', role: 'app', startedAt: now, updatedAt: now });
  const seen = I.live(dir, { now, selfPid: 1, isAlive: () => true });
  assert.deepStrictEqual(seen.map((e) => e.pid), [700], 'bozuk dosya sağlam kaydı gizlememeli');
  assert.ok(fs.existsSync(bad), 'yeni bozuk dosya silinmemeliydi');
  const old = new Date(now - I.PRUNE_MS - 5000);
  fs.utimesSync(bad, old, old);
  I.live(dir, { now, selfPid: 1, isAlive: () => true });
  assert.ok(!fs.existsSync(bad), 'eski bozuk dosya silinmeliydi');
});

test('kayıt olmayan dosyalar (odak isteği, geçici dosya) karışmıyor', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, '800.focus'), '1');
  fs.writeFileSync(path.join(dir, '800.json.tmp'), '{}');
  fs.writeFileSync(path.join(dir, 'notlar.txt'), 'x');
  put(dir, { pid: 800, version: '3.1.5', role: 'selftest', startedAt: NOW, updatedAt: NOW });
  const seen = I.live(dir, { now: NOW, selfPid: 1, isAlive: () => true });
  assert.deepStrictEqual(seen.map((e) => [e.pid, e.role]), [[800, 'selftest']]);
  assert.ok(fs.existsSync(path.join(dir, '800.focus')));
});

test('en eski önce sıralanıyor: "çalışan kopya" ilk açılandır', () => {
  const dir = tmpDir();
  put(dir, { pid: 901, role: 'app', startedAt: NOW - 1000, updatedAt: NOW });
  put(dir, { pid: 902, role: 'app', startedAt: NOW - 9000, updatedAt: NOW });
  put(dir, { pid: 903, role: 'app', startedAt: NOW - 5000, updatedAt: NOW });
  assert.deepStrictEqual(I.live(dir, { now: NOW, selfPid: 1, isAlive: () => true }).map((e) => e.pid), [902, 903, 901]);
});

test('klasör yoksa boş liste; kaldırma yoksa false', () => {
  const dir = path.join(tmpDir(), 'yok');
  assert.deepStrictEqual(I.live(dir, { now: NOW, selfPid: 1, isAlive: () => true }), []);
  assert.strictEqual(I.remove(dir, 42), false);
});

test('yazma geçici dosya bırakmıyor ve kaldırma kaydı siliyor', () => {
  const dir = tmpDir();
  put(dir, { pid: 1000, role: 'app', startedAt: NOW, updatedAt: NOW });
  put(dir, { pid: 1000, role: 'app', startedAt: NOW, updatedAt: NOW + 4000 });
  assert.deepStrictEqual(fs.readdirSync(dir), ['1000.json']);
  assert.strictEqual(JSON.parse(fs.readFileSync(I.fileFor(dir, 1000), 'utf8')).updatedAt, NOW + 4000);
  assert.strictEqual(I.remove(dir, 1000), true);
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('imza tazelemeyle değişmiyor, kopya ya da sürüm değişince değişiyor', () => {
  const a = [{ pid: 1, role: 'app', kind: 'dev', version: '3.1.5', exe: 'x', startedAt: 10, updatedAt: 20 }];
  const b = [{ pid: 1, role: 'app', kind: 'dev', version: '3.1.5', exe: 'x', startedAt: 10, updatedAt: 99 }];
  const c = [{ pid: 2, role: 'app', kind: 'dev', version: '3.1.5', exe: 'x', startedAt: 10, updatedAt: 20 }];
  assert.strictEqual(I.signature(a), I.signature(b));
  assert.notStrictEqual(I.signature(a), I.signature(c));
  assert.strictEqual(I.signature([]), '');
});

test('süreç yaşıyor mu: ESRCH ölü, EPERM başka kullanıcının — yaşıyor', () => {
  const thrower = (code) => () => { const e = new Error(code); e.code = code; throw e; };
  assert.strictEqual(I.isAlive(123, () => true), true);
  assert.strictEqual(I.isAlive(123, thrower('ESRCH')), false);
  assert.strictEqual(I.isAlive(123, thrower('EPERM')), true);
  assert.strictEqual(I.isAlive(0, () => true), false);
  assert.strictEqual(I.isAlive(-5, () => true), false);
  assert.strictEqual(I.isAlive(process.pid), true);
});
