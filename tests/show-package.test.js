'use strict';
/* GÖSTERİ PAKETİ (#812): manifest ve özet, güvenli adlar, parça özeti,
 * sürdürme, doğrulama, iki adımlı takas ve videoların ayrıca onayı. Gerçek
 * dosya sisteminde, geçici klasörde; Windows'un rename hatası sahte fs ile.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const Pkg = require('../src/main/show-package.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sv-pkg-')); }
// Kurulu kopyadaki öğe (dosyası içerik adresli depoda)
function installed(root, p) { return Pkg.currentManifest(root).items.find((x) => x.path === p); }
function entry(kind, id, buf, extra) {
  return Object.assign({ kind, id, name: id, ext: kind === 'presets' ? '.json' : '.bin', size: buf.length, sha256: Pkg.sha256(buf), bytes: buf }, extra || {});
}
// Birincilin tarafı: manifestteki ada göre parça
function server(entries) {
  const by = new Map(entries.map((e) => [Pkg.entryName(e.kind, e.id, e.ext), e]));
  return (req) => {
    const e = by.get(req.path);
    const buf = e.bytes.subarray(req.c * Pkg.CHUNK, (req.c + 1) * Pkg.CHUNK);
    return { path: req.path, c: req.c, sha: Pkg.sha256(buf), b64: buf.toString('base64') };
  };
}
const big = crypto.randomBytes(Pkg.CHUNK * 2 + 1234);
const ENTRIES = [
  entry('presets', 'usr_A', Buffer.from('{"id":"usr_A","name":"A"}')),
  entry('presets', 'usr_a', Buffer.from('{"id":"usr_a","name":"a"}')),
  entry('logos', 'logo1', crypto.randomBytes(5000)),
  entry('media', 'C:\\Shows\\Klip.mp4', big, { ref: 'C:\\Shows\\Klip.mp4', ext: '.mp4' }),
  entry('logos', 'empty', Buffer.alloc(0)),
];

test('manifest: sürüm, paket özeti sıradan bağımsız, birincilin yolu girmiyor', () => {
  const a = Pkg.buildManifest(ENTRIES, { version: '3.1.6', createdAt: 1 });
  const b = Pkg.buildManifest(ENTRIES.slice().reverse(), { version: '3.1.6', createdAt: 2 });
  assert.strictEqual(a.format, Pkg.FORMAT);
  assert.strictEqual(a.pkg, b.pkg);
  assert.strictEqual(Pkg.validateManifest(a), '');
  assert.strictEqual(a.totalBytes, ENTRIES.reduce((n, e) => n + e.size, 0));
  for (const it of a.items) {
    assert.ok(!('src' in it) && !('bytes' in it));
    assert.match(it.path, /^(presets|logos|media)\/[a-z0-9][a-z0-9._-]*$/);
    assert.ok(it.path.length < 80, 'kısa ad (Windows MAX_PATH)');
  }
  const media = a.items.find((it) => it.kind === 'media');
  assert.strictEqual(media.chunks, 3);
  assert.strictEqual(media.ref, 'C:\\Shows\\Klip.mp4');
  // Büyük/küçük harf ayrımı olmayan dosya sistemi: "usr_A" ile "usr_a" ayrı ad
  const names = a.items.filter((it) => it.kind === 'presets').map((it) => it.path.toLowerCase());
  assert.strictEqual(new Set(names).size, 2);
  // İçerik değişirse özet değişir
  const c = Pkg.buildManifest([entry('presets', 'usr_A', Buffer.from('x'))].concat(ENTRIES.slice(1)));
  assert.notStrictEqual(c.pkg, a.pkg);
});

test('manifest denetimi: dizin dışı, mutlak, ters bölü, büyük harf, özet ve parça sayısı', () => {
  const m = Pkg.buildManifest(ENTRIES);
  const bad = (fn) => { const x = JSON.parse(JSON.stringify(m)); fn(x); return Pkg.validateManifest(x); };
  assert.strictEqual(bad((x) => { x.items[0].path = 'presets/../../evil'; }), 'path');
  assert.strictEqual(bad((x) => { x.items[0].path = '/etc/passwd'; }), 'path');
  assert.strictEqual(bad((x) => { x.items[0].path = 'presets\\evil.json'; }), 'path');
  assert.strictEqual(bad((x) => { x.items[0].path = 'presets/Evil.json'; }), 'path');
  assert.strictEqual(bad((x) => { x.items[0].path = 'C:/x'; }), 'path');
  assert.strictEqual(bad((x) => { x.items[0].chunks = 9; }), 'chunks');
  assert.strictEqual(bad((x) => { x.items[0].sha256 = 'f'.repeat(64); }), 'pkg');
  assert.strictEqual(bad((x) => { x.format = 99; }), 'format');
  assert.strictEqual(bad((x) => { x.items.push(x.items[0]); }), 'duplicate');
  assert.strictEqual(Pkg.validateManifest(null), 'shape');
});

test('alıcı: bozuk parça yazılmıyor; sürdürme kaldığı yerden; doğrulama ve takas', async () => {
  const root = tmp();
  const m = Pkg.buildManifest(ENTRIES);
  const get = server(ENTRIES);
  let rx = Pkg.createReceiver({ root, manifest: m });
  const all = rx.missing();
  assert.strictEqual(all.length, m.items.reduce((n, it) => n + it.chunks, 0));
  // Bozuk parça: özet tutmuyor
  const first = get(all.find((r) => !r.path.endsWith('.bin') || r.path.indexOf('empty') < 0));
  const wrong = Buffer.from(first.b64, 'base64'); wrong[0] ^= 0xff;
  assert.strictEqual(rx.accept(first.path, first.c, wrong, first.sha), 'checksum');
  assert.strictEqual(rx.accept('presets/nope', 0, Buffer.alloc(0), ''), 'unknown');
  // Yarısı gelir, "bağlantı kopar"
  const half = all.slice(0, Math.ceil(all.length / 2));
  for (const r of half) { const ch = get(r); assert.strictEqual(rx.accept(ch.path, ch.c, Buffer.from(ch.b64, 'base64'), ch.sha), ''); }
  rx.cancel();
  // Yeniden açılış: aynı paket, yalnız eksikler istenir
  rx = Pkg.createReceiver({ root, manifest: m });
  const rest = rx.missing();
  assert.strictEqual(rest.length, all.length - half.length);
  for (const r of rest) { const ch = get(r); assert.strictEqual(rx.accept(ch.path, ch.c, Buffer.from(ch.b64, 'base64'), ch.sha), ''); }
  assert.deepStrictEqual(await rx.verify(), []);
  const cur = await rx.commit();
  for (const e of ENTRIES) {
    const it = m.items.find((x) => x.id === e.id);
    assert.deepStrictEqual(fs.readFileSync(Pkg.currentFile(root, installed(root, it.path))), e.bytes);
  }
  assert.strictEqual(Pkg.currentManifest(root).pkg, m.pkg);
  assert.ok(!fs.existsSync(path.join(root, 'staging', m.pkg.slice(0, 16))), 'hazırlık temizlendi');
  assert.ok(fs.existsSync(cur));
});

test('doğrulama tutmazsa önceki kopya yerinde kalır; aynı dosyalar yeniden inmez', async () => {
  const root = tmp();
  const get = server(ENTRIES);
  const m1 = Pkg.buildManifest(ENTRIES);
  let rx = Pkg.createReceiver({ root, manifest: m1 });
  for (const r of rx.missing()) { const ch = get(r); rx.accept(ch.path, ch.c, Buffer.from(ch.b64, 'base64'), ch.sha); }
  await rx.verify();
  await rx.commit();
  // İkinci paket: bir preset değişti
  const changed = entry('presets', 'usr_A', Buffer.from('{"id":"usr_A","name":"A2"}'));
  const E2 = [changed].concat(ENTRIES.slice(1));
  const m2 = Pkg.buildManifest(E2);
  const get2 = server(E2);
  rx = Pkg.createReceiver({ root, manifest: m2 });
  assert.ok(rx.prefill() >= 4, 'öncekiyle aynı dosyalar kopyadan');
  const need = rx.missing();
  assert.deepStrictEqual(need.map((r) => r.path), [Pkg.entryName('presets', 'usr_A', '.json')]);
  // Diskte bozulma (ya da yarım yazım): doğrulama yakalar, takas olmaz
  const ch = get2(need[0]);
  rx.accept(ch.path, ch.c, Buffer.from(ch.b64, 'base64'), ch.sha);
  const staged = path.join(rx.stage, 'files', ...need[0].path.split('/'));
  fs.writeFileSync(staged, Buffer.alloc(changed.size, 0x41));
  assert.deepStrictEqual(await rx.verify(), [need[0].path]);
  assert.strictEqual(Pkg.currentManifest(root).pkg, m1.pkg, 'eski kopya yerinde');
  assert.strictEqual(rx.missing().length, 1, 'bozuk dosya yeniden inecek');
});

test('takas: Windows rename hatası yeniden deneniyor; düşerse eski kopya yerinde kalıyor', async () => {
  const root = tmp();
  const E = ENTRIES.slice(0, 2);
  const m = Pkg.buildManifest(E);
  const get = server(E);
  // Önce bir kopya kur
  let rx = Pkg.createReceiver({ root, manifest: m });
  for (const r of rx.missing()) { const ch = get(r); rx.accept(ch.path, ch.c, Buffer.from(ch.b64, 'base64'), ch.sha); }
  await rx.verify(); await rx.commit();
  // EPERM bir kez: yeniden deneme geçer
  let fail = 1;
  const flaky = Object.assign({}, fs, { renameSync: (a, b) => { if (fail-- > 0) { const e = new Error('busy'); e.code = 'EPERM'; throw e; } return fs.renameSync(a, b); } });
  const E2 = [entry('presets', 'usr_B', Buffer.from('{"id":"usr_B"}'))];
  const m2 = Pkg.buildManifest(E2);
  rx = Pkg.createReceiver({ root, manifest: m2, fs: flaky });
  for (const r of rx.missing()) { const ch = server(E2)(r); rx.accept(ch.path, ch.c, Buffer.from(ch.b64, 'base64'), ch.sha); }
  await rx.verify();
  await rx.commit();
  assert.strictEqual(Pkg.currentManifest(root).pkg, m2.pkg);
  // Depoya taşıma hep düşerse: manifest değişmez, eski kopya geçerli kalır
  const E3 = [entry('presets', 'usr_C', Buffer.from('{"id":"usr_C"}'))];
  const m3 = Pkg.buildManifest(E3);
  const broken = Object.assign({}, fs, { renameSync: (a, b) => { if (String(b).includes(path.sep + 'store' + path.sep)) { const e = new Error('locked'); e.code = 'EBUSY'; throw e; } return fs.renameSync(a, b); } });
  rx = Pkg.createReceiver({ root, manifest: m3, fs: broken });
  for (const r of rx.missing()) { const ch = server(E3)(r); rx.accept(ch.path, ch.c, Buffer.from(ch.b64, 'base64'), ch.sha); }
  await rx.verify();
  await assert.rejects(rx.commit(), (e) => e.code === 'EBUSY');
  assert.strictEqual(Pkg.currentManifest(root).pkg, m2.pkg, 'yarıda kalan takas eski kopyayı değiştirmedi');
  const it2 = Pkg.currentManifest(root).items[0];
  assert.strictEqual(fs.readFileSync(Pkg.currentFile(root, it2), 'utf8'), '{"id":"usr_B"}');
});

/* OYNAYAN VİDEO (#817 incelemesi, Windows'ta ölçüldü). Açık bir dosyanın
   klasörü yeniden adlandırılamıyor, dosyanın üstüne de yazılamıyor (EPERM).
   Yedek kopyalanmış bir videoyu çizerken gelen her yeni paket eskiden
   "kopyalama durdu"da kalıyordu. Artık takas o dosyaya ve klasörüne hiç
   dokunmuyor; Windows'un kilidi sahte fs ile. */
test('takas: oynayan (kilitli) videonun dosyasına ve klasörüne dokunulmuyor', async () => {
  const root = tmp();
  const get = server(ENTRIES);
  const m1 = Pkg.buildManifest(ENTRIES);
  let rx = Pkg.createReceiver({ root, manifest: m1 });
  for (const r of rx.missing()) { const ch = get(r); rx.accept(ch.path, ch.c, Buffer.from(ch.b64, 'base64'), ch.sha); }
  await rx.verify(); await rx.commit();
  const vid = Pkg.currentManifest(root).items.find((it) => it.kind === 'media');
  const vidFile = path.resolve(Pkg.currentFile(root, vid));
  // Kilitli: dosyanın kendisi ve kökle dosya arasındaki her klasör
  const locked = (p) => {
    const r = path.resolve(String(p));
    return r === vidFile || (r.length > path.resolve(root).length && vidFile.startsWith(r + path.sep));
  };
  const deny = (fn) => (...a) => { if (a.slice(0, 2).some(locked)) { const e = new Error('EPERM: open in player'); e.code = 'EPERM'; throw e; } return fn(...a); };
  const win = Object.assign({}, fs, { renameSync: deny(fs.renameSync), unlinkSync: deny(fs.unlinkSync), rmSync: deny(fs.rmSync), linkSync: deny(fs.linkSync), copyFileSync: deny(fs.copyFileSync) });
  // Videosuz ikinci paket (bir preset değişti), "Farkları Yedeğe Gönder" gibi
  const E2 = [entry('presets', 'usr_A', Buffer.from('{"id":"usr_A","name":"A9"}'))].concat(ENTRIES.slice(1));
  const m2 = Pkg.buildManifest(E2);
  const only = m2.items.filter((it) => it.kind !== 'media').map((it) => it.path);
  rx = Pkg.createReceiver({ root, manifest: m2, only, fs: win });
  rx.prefill();
  for (const r of rx.missing()) { const ch = server(E2)(r); rx.accept(ch.path, ch.c, Buffer.from(ch.b64, 'base64'), ch.sha); }
  assert.deepStrictEqual(await rx.verify(), []);
  await rx.commit();
  const man = Pkg.currentManifest(root);
  assert.strictEqual(man.pkg, m2.pkg, 'takas oldu');
  const kept = man.items.find((it) => it.path === vid.path);
  assert.ok(kept && kept.carried, 'video manifestte');
  assert.strictEqual(path.resolve(Pkg.currentFile(root, kept)), vidFile, 'video aynı yerde: oynatıcı kesilmez');
  const pa = man.items.find((it) => it.id === 'usr_A');
  assert.strictEqual(fs.readFileSync(Pkg.currentFile(root, pa), 'utf8'), '{"id":"usr_A","name":"A9"}');
  // Eski preset içeriği kullanılmıyor: depodan silindi
  const oldA = m1.items.find((it) => it.id === 'usr_A');
  assert.ok(!fs.existsSync(path.join(root, ...Pkg.storePath(oldA).split('/'))), 'kullanılmayan dosya temizlendi');
});

/* Önceki kopya yerinde okunuyor, sabit bağ yok. Bozuk önceki dosya yeniden
   iniyor ve doğrulanmış kopyaya yazılmıyor (eskiden bağlı dosyaya 'r+' ile
   yazılıp current yerinde değişiyordu). */
test('önceki kopya bozuksa yeniden iniyor; doğrulanmış kopya yerinde değişmiyor', async () => {
  const root = tmp();
  const get = server(ENTRIES);
  const m = Pkg.buildManifest(ENTRIES);
  let rx = Pkg.createReceiver({ root, manifest: m });
  for (const r of rx.missing()) { const ch = get(r); rx.accept(ch.path, ch.c, Buffer.from(ch.b64, 'base64'), ch.sha); }
  await rx.verify(); await rx.commit();
  const logo = Pkg.currentManifest(root).items.find((it) => it.id === 'logo1');
  const file = Pkg.currentFile(root, logo);
  const bad = Buffer.alloc(logo.size, 0x55);
  fs.writeFileSync(file, bad);
  rx = Pkg.createReceiver({ root, manifest: m });
  assert.ok(rx.prefill() >= 4);
  assert.deepStrictEqual(await rx.verify(), [logo.path]);
  for (const r of rx.missing()) { const ch = get(r); assert.strictEqual(rx.accept(ch.path, ch.c, Buffer.from(ch.b64, 'base64'), ch.sha), ''); }
  assert.deepStrictEqual(fs.readFileSync(file), bad, 'yeniden inen parçalar doğrulanmış kopyaya yazılmadı');
  assert.deepStrictEqual(await rx.verify(), []);
});

// Araya giren paket yarım büyük paketi silmiyor (#817 incelemesi)
test('hazırlık: başka bir paket yarım kalan büyük paketi silmiyor', () => {
  const root = tmp();
  const big1 = Pkg.buildManifest([ENTRIES[3]]);
  const rx1 = Pkg.createReceiver({ root, manifest: big1 });
  const ch = server([ENTRIES[3]])(rx1.missing()[0]);
  rx1.accept(ch.path, ch.c, Buffer.from(ch.b64, 'base64'), ch.sha);
  rx1.cancel();
  Pkg.createReceiver({ root, manifest: Pkg.buildManifest(ENTRIES.slice(0, 1)) });
  const again = Pkg.createReceiver({ root, manifest: big1 });
  assert.strictEqual(again.missing().length, 2, 'ilk parça hâlâ alınmış');
});

test('aktarım: videolar yalnız ayrıca onaylanırsa; pencere en çok iki istek; hız ve bitiş', async () => {
  const root = tmp();
  const m = Pkg.buildManifest(ENTRIES);
  const get = server(ENTRIES);
  const mk = (man, only) => Pkg.createReceiver({ root, manifest: man, only });
  const pull = Pkg.createPull({ window: 2 });
  assert.strictEqual(pull.offer({ format: 1 }), false);
  assert.strictEqual(pull.status.state, 'error');
  assert.strictEqual(pull.offer(m), true);
  assert.strictEqual(pull.status.state, 'offered');
  assert.strictEqual(pull.status.summary.media.n, 1);
  // Onaysız: video istenmez
  let reqs = pull.confirm({ media: false }, mk);
  assert.ok(reqs.length <= 2);
  const asked = new Set();
  let t = 0;
  let r;
  while (reqs.length) {
    const next = [];
    for (const q of reqs) {
      asked.add(q.path);
      r = pull.chunk(get(q), (t += 10));
      next.push(...r.requests);
    }
    reqs = next;
  }
  assert.ok(r.done);
  assert.ok(![...asked].some((p) => p.startsWith('media/')), 'video istenmedi');
  assert.strictEqual(pull.status.state, 'verifying');
  assert.ok(pull.status.speed > 0);
  assert.strictEqual(await pull.finish(), true);
  assert.strictEqual(pull.status.state, 'done');
  assert.ok(!Pkg.currentManifest(root).items.some((it) => it.kind === 'media'));
  // Onaylı: video da gelir
  pull.offer(m);
  reqs = pull.confirm({ media: true }, mk);
  const asked2 = new Set();
  while (reqs.length) { const next = []; for (const q of reqs) { asked2.add(q.path); next.push(...pull.chunk(get(q), (t += 10)).requests); } reqs = next; }
  assert.ok([...asked2].every((p) => p.startsWith('media/')), 'öncekiler kopyadan, yalnız video indi');
  assert.strictEqual(await pull.finish(), true);
  const media = Pkg.currentManifest(root).items.find((it) => it.kind === 'media');
  assert.deepStrictEqual(fs.readFileSync(Pkg.currentFile(root, installed(root, media.path))), big);
});

test('aktarım: kopan bağlantıda bekleyen istekler yeniden gidiyor; birincil hatası durduruyor', () => {
  const root = tmp();
  const m = Pkg.buildManifest(ENTRIES.slice(0, 3));
  const pull = Pkg.createPull({ window: 2 });
  pull.offer(m);
  const first = pull.confirm({}, (man, only) => Pkg.createReceiver({ root, manifest: man, only }));
  assert.strictEqual(first.length, 2);
  // Yanıtlar hiç gelmedi, bağlantı yeniden açıldı
  const again = pull.resume();
  assert.deepStrictEqual(again, first);
  pull.fail('changed');
  assert.strictEqual(pull.status.state, 'error');
  assert.strictEqual(pull.status.error, 'changed');
});

test('JSON: tek adımda yazılıyor, satır sonu \\n; BOM ve \\r\\n okunuyor', () => {
  const d = tmp();
  const f = path.join(d, 'a.json');
  Pkg.writeJsonAtomic(f, { a: 1 });
  assert.ok(!fs.readFileSync(f, 'utf8').includes('\r'));
  assert.deepStrictEqual(fs.readdirSync(d), ['a.json'], 'geçici dosya kalmadı');
  fs.writeFileSync(f, '\ufeff{\r\n "b": 2\r\n}\r\n');
  assert.deepStrictEqual(Pkg.readJson(f), { b: 2 });
  assert.strictEqual(Pkg.readJson(path.join(d, 'yok.json')), null);
});

test('birincil: parça okunuyor; dosya değiştiyse "changed"', async () => {
  const d = tmp();
  const f = path.join(d, 'v.bin');
  fs.writeFileSync(f, big);
  const p = await Pkg.readChunk(f, big.length, 2);
  assert.strictEqual(p.buf.length, 1234);
  assert.strictEqual(p.sha, Pkg.sha256(big.subarray(Pkg.CHUNK * 2)));
  assert.strictEqual(await Pkg.hashFile(f), Pkg.sha256(big));
  fs.appendFileSync(f, 'x');
  assert.strictEqual((await Pkg.readChunk(f, big.length, 0)).error, 'changed');
});

/* VİDEOLAR SİLİNMEZ (#812, Windows'ta bulundu: 2,8 GB gitti). Videosuz inen
   ikinci paket current'ı değiştiriyor ve önceki paketin videolarını
   siliyordu. Artık eski kopyadaki, yeni pakette olmayan videolar yeni
   kopyaya taşınıyor ve manifestte kalıyor; birincil videoyu listeden
   çıkarmış olsa da. */
test('takas: videosuz paket önceki videoları silmiyor; manifestte kalıyorlar', async () => {
  const root = tmp();
  const get = server(ENTRIES);
  const m1 = Pkg.buildManifest(ENTRIES);
  let rx = Pkg.createReceiver({ root, manifest: m1 });
  for (const r of rx.missing()) { const ch = get(r); rx.accept(ch.path, ch.c, Buffer.from(ch.b64, 'base64'), ch.sha); }
  assert.deepStrictEqual(await rx.verify(), []);
  await rx.commit();
  const media = m1.items.find((it) => it.kind === 'media');
  const mediaFile = Pkg.currentFile(root, installed(root, media.path));
  assert.ok(fs.existsSync(mediaFile));

  // 1) Aynı paket, videolar işaretlenmeden (yalnız preset ve logolar)
  const E2 = [entry('presets', 'usr_A', Buffer.from('{"id":"usr_A","name":"A3"}'))].concat(ENTRIES.slice(1));
  const m2 = Pkg.buildManifest(E2);
  const only = m2.items.filter((it) => it.kind !== 'media').map((it) => it.path);
  rx = Pkg.createReceiver({ root, manifest: m2, only });
  rx.prefill();
  const get2 = server(E2);
  for (const r of rx.missing()) { const ch = get2(r); rx.accept(ch.path, ch.c, Buffer.from(ch.b64, 'base64'), ch.sha); }
  assert.deepStrictEqual(await rx.verify(), []);
  await rx.commit();
  assert.deepStrictEqual(fs.readFileSync(Pkg.currentFile(root, installed(root, media.path))), big, 'video yerinde ve aynı');
  const man2 = Pkg.currentManifest(root);
  const kept = man2.items.find((it) => it.path === media.path);
  assert.ok(kept && kept.carried === true && kept.sha256 === media.sha256, 'manifestte, taşındığı işaretli');
  assert.strictEqual(man2.pkg, m2.pkg);

  // 2) Birincil videoyu artık hiç listelemiyor: yine silinmiyor
  const E3 = E2.filter((e) => e.kind !== 'media');
  const m3 = Pkg.buildManifest(E3);
  rx = Pkg.createReceiver({ root, manifest: m3 });
  rx.prefill();
  assert.deepStrictEqual(rx.missing(), [], 'aynı dosyalar öncekinden (yerinde)');
  assert.deepStrictEqual(await rx.verify(), []);
  await rx.commit();
  assert.ok(fs.existsSync(Pkg.currentFile(root, installed(root, media.path))));
  assert.ok(Pkg.currentManifest(root).items.some((it) => it.path === media.path && it.kind === 'media'));
  // Eski kopyalar temizlendi, video tek yerde
  assert.deepStrictEqual(fs.readdirSync(root).filter((d) => /^(old|next)-/.test(d)), []);
});

test('sabit bağ olmazsa kopya; hedef varsa üstüne', () => {
  const root = tmp();
  const a = path.join(root, 'a.bin');
  const b = path.join(root, 'b.bin');
  fs.writeFileSync(a, 'abc');
  fs.writeFileSync(b, 'eski');
  const how = Pkg.linkOrCopy(a, b);
  assert.ok(how === 'link' || how === 'copy');
  assert.strictEqual(fs.readFileSync(b, 'utf8'), 'abc');
  const fake = Object.assign({}, fs, { linkSync() { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; } });
  const c = path.join(root, 'c.bin');
  assert.strictEqual(Pkg.linkOrCopy(a, c, fake), 'copy');
  assert.strictEqual(fs.readFileSync(c, 'utf8'), 'abc');
});

/* EKSİK YOKSA TAKILMIYOR (#812, Linux'ta bulundu). Yeniden çekilen paketin
   her dosyası öncekinden geldiğinde parça istenmiyor; doğrulama yalnız
   parça gelince başladığı için aktarım %100'de "transferring"de kalıyordu. */
test('aktarım: hiçbir şey eksik değilse onay ve sürdürme doğrudan doğrulamaya geçiyor', async () => {
  const root = tmp();
  const m = Pkg.buildManifest(ENTRIES);
  const get = server(ENTRIES);
  const mk = (man, only) => Pkg.createReceiver({ root, manifest: man, only });
  // İlk kopya
  const first = Pkg.createPull({ window: 2 });
  first.offer(m);
  let reqs = first.confirm({ media: true }, mk);
  let r = { requests: reqs };
  while (r.requests.length) {
    const out = [];
    for (const q of r.requests) { r = first.chunk(get(q)); out.push(...r.requests); }
    r = { requests: out };
  }
  assert.strictEqual(first.status.state, 'verifying');
  assert.strictEqual(await first.finish(), true);
  // Aynı paket yeniden: her dosya öncekinden, istek yok
  const again = Pkg.createPull({ window: 2 });
  again.offer(m);
  assert.deepStrictEqual(again.confirm({ media: true }, mk), []);
  assert.strictEqual(again.status.state, 'verifying', 'transferring\'de takılmamalı');
  assert.strictEqual(again.status.progress.bytes, again.status.progress.total);
  assert.strictEqual(await again.finish(), true);
  assert.strictEqual(again.status.state, 'done');
  // Sürdürme de: bağlantı kopup geri geldiğinde eksik yoksa bitiyor
  const third = Pkg.createPull({ window: 2 });
  third.offer(m);
  third.confirm({ media: false }, mk);
  third.fail('net');
  assert.deepStrictEqual(third.resume(), []);
  assert.strictEqual(third.status.state, 'verifying');
  assert.strictEqual(await third.finish(), true);
  // Ana süreç onay ve sürdürmeden sonra bitişi çalıştırıyor
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.strictEqual((main.match(/pkgSend\(red\.pull\.confirm\([^\n]*\);\n\s*finishPull\(\);/g) || []).length, 2);
  assert.match(main, /red\.pull\.resume\(\)\) red\.client\.send\([^\n]*\); finishPull\(\); \}/);
});
