'use strict';
/* PR #939 testinde bulunan hataların gerilemesine karşı:
 * 1) Zamanlama düzenleyicisi çalan saatte hep [00:00.00] basıyordu.
 * 2) Ekran koruyucu sessizlikte düşen kare hızı yüzünden ~5 kat geç açılıyordu.
 * 3) İngilizce arayüzde kaydırma düğmeleri ve dosya bilgisi Türkçe kalıyordu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const LC = require('../src/shared/lyrics-clock.js');
const SS = require('../src/shared/screensaver.js');
const L = require('../src/shared/lyrics.js');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8');

test('söz saati çapası çalarken ilerleyen zaman verir ve damga basar', () => {
  const now = 1_000_000;
  const anchor = { run: 'play', time: 10, epoch: now - 2500 };
  const t = LC.resolve(anchor, now);
  assert.ok(Math.abs(t - 12.5) < 1e-9, String(t));
  assert.strictEqual(L.fmtStamp(t), '00:12.50');
  assert.strictEqual(L.stampAt('satır', 0, t).text, '<00:12.50>satır');
});

test('düzenleyici söz saatini SVLyricsClock ile çözer (SVShowClock değil)', () => {
  const src = read('src/admin/lyrics-lib-ui.js');
  const body = src.slice(src.indexOf('const clockNow'), src.indexOf('const lineRange'));
  assert.match(body, /SVLyricsClock/);
  assert.doesNotMatch(body, /SVShowClock\.resolve/);
});

test('ekran koruyucu duvar saatiyle bekler: düşük kare hızında da 10 sn', () => {
  const s = SS.create();
  const cfg = { enabled: true, idleSec: 10, fadeSec: 1 };
  // Sessizlikte ~4 fps; kare dt'si 0,05'te kırpılmış geliyor
  let now = 0;
  for (let i = 0; i < 4 * 11; i++) { now += 250; SS.update(s, { silent: true, dt: 0.05, now, cfg }); }
  assert.ok(s.silentFor >= 10.5 && s.silentFor < 11.5, String(s.silentFor));
  assert.ok(s.amount > 0, 'kararma başlamalıydı');
  SS.update(s, { silent: false, dt: 0.05, now: now + 250, cfg });
  assert.strictEqual(s.silentFor, 0);
});

test('görselleştirici ekran koruyucuya performance.now() verir', () => {
  assert.match(read('src/visualizer/visualizer.js'), /SS\.update\(saver, \{[^}]*now: performance\.now\(\)/);
});

function dictionary() {
  const src = read('src/shared/i18n.js');
  const body = src.slice(src.indexOf('const EN = {'), src.indexOf('const EN_NORMALIZED'));
  const STR = "'((?:[^'\\\\]|\\\\.)*)'";
  const re = new RegExp(STR + '\\s*:\\s*' + STR, 'g');
  const map = new Map();
  let m;
  while ((m = re.exec(body))) map.set(m[1].replace(/\s+/g, ' ').trim(), m[2]);
  return map;
}

test('zamanlama araç çubuğunun her metni İngilizce sözlükte', () => {
  const dict = dictionary();
  const src = read('src/admin/lyrics-lib-ui.js');
  const re = /tool\('([^']+)', '([^']+)'/g;
  let m, n = 0;
  while ((m = re.exec(src))) {
    n++;
    for (const k of [m[1], m[2]]) assert.ok(dict.has(k), 'çevirisi yok: ' + k);
  }
  assert.ok(n >= 6);
});


/* Kod incelemesinde bulunanlar */
const os = require('os');
const SR = require('../src/main/session-recovery.js');
const LL = require('../src/main/lyrics-lookup.js');
const LT = require('../src/main/link-tempo.js');
const MC = require('../src/shared/midi-clock.js');
const stream = require('../src/main/stream-server.js');
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), n));

test('canlı söz normal parça değişiminde de aranıyor; ayar değişince yeniden', () => {
  const m = read('src/main/main.js');
  const sub = m.slice(m.indexOf('mediaSession.subscribe('), m.indexOf('function wantsNowPlaying'));
  assert.match(sub, /lookupLiveLyrics\(st\)/);
  assert.match(m.slice(m.indexOf('function applyIncomingConfig'), m.indexOf('function applyIncomingConfig') + 4000), /syncLyricsLookup\(\)/);
  const sync = m.slice(m.indexOf('function syncLyricsLookup'), m.indexOf('function publishLyricsLib'));
  assert.match(sync, /lyricsAutoItem = null/, 'kapatılınca bulunan söz kalkmalı');
  assert.match(sync, /lyricsAutoSig = ''/, 'açılınca aynı parçaya yeniden bakılmalı');
});

test('kurtarma zamanlayıcısı ayar gönderimiyle sıfırlanmıyor, aralık değişince kuruluyor', () => {
  const r = SR.create({ dir: tmp('svrec-') });
  const real = global.setInterval;
  let n = 0;
  global.setInterval = (...a) => { n++; return real(...a); };
  try {
    r.start(() => ({}), 120);
    r.start(() => ({}), 120);
    r.start(() => ({}), 120);
    assert.strictEqual(n, 1);
    r.start(() => ({}), 60);
    assert.strictEqual(n, 2);
  } finally {
    global.setInterval = real;
    r.stop();
  }
});

test('kurtarma kopyası çalışırken eşzamansız yazılıyor', async () => {
  const dir = tmp('svrec-');
  const r = SR.create({ dir });
  const real = fs.writeFileSync;
  fs.writeFileSync = () => { throw new Error('eşzamanlı yazım'); };
  try {
    assert.strictEqual(await r.snapshotAsync({ a: 1 }), true);
  } finally {
    fs.writeFileSync = real;
  }
  assert.strictEqual(await r.snapshotAsync({ a: 1 }), false, 'değişmediyse yazılmaz');
  assert.strictEqual(r.files().length, 1);
  assert.deepStrictEqual(r.latest().config, { a: 1 });
});

test('geri yükleme yalnız bozuk dosyada; silinmiş dosya ve kapalı kurtarma hariç', () => {
  const bytes = Buffer.from('{bozuk');
  assert.strictEqual(SR.shouldRestore({ enabled: true }, bytes, false), true);
  assert.strictEqual(SR.shouldRestore({ enabled: true }, null, false), false, 'silinmiş dosya');
  assert.strictEqual(SR.shouldRestore({ enabled: false }, bytes, false), false, 'kurtarma kapalıydı');
  assert.strictEqual(SR.shouldRestore({ enabled: true }, bytes, true), false, 'dosya sağlam');
  assert.strictEqual(SR.shouldRestore(null, bytes, false), false, 'çöküş yok');
  const dir = tmp('svrec-');
  const a = SR.create({ dir });
  a.begin();
  a.setEnabled(false);
  assert.strictEqual(SR.create({ dir }).begin().enabled, false, 'kapalı olduğu işaretten okunur');
});

test('kurtarma kapalıyken kapanış kopya yazmıyor', () => {
  const dir = tmp('svrec-');
  const r = SR.create({ dir });
  r.begin();
  r.end(null);
  assert.strictEqual(r.files().length, 0);
  assert.match(read('src/main/main.js'), /recovery\.end\(off \? null : currentConfig\)/);
});

function sylt(items) {
  const parts = [Buffer.from([0]), Buffer.from('eng'), Buffer.from([2, 1, 0])];
  for (const [text, ms] of items) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(ms);
    parts.push(Buffer.from(text, 'latin1'), Buffer.from([0]), b);
  }
  return Buffer.concat(parts);
}

test('SYLT: satır başına bir girdi, sondaki ve baştaki satır sonu', () => {
  assert.strictEqual(L.parse(LL.syltToLrc(sylt([['Bir', 1000], ['Iki', 5000], ['Uc', 9000]]))).lines.length, 3);
  assert.strictEqual(L.parse(LL.syltToLrc(sylt([['Bir\n', 1000], ['Iki\n', 5000]]))).lines.length, 2);
  const syl = L.parse(LL.syltToLrc(sylt([['Str', 1000], ['ang', 1500], ['\nNext', 5000]])));
  assert.strictEqual(syl.lines.length, 2, 'hece hece yazılmış etiket');
  assert.strictEqual(syl.lines[0].text, 'Strang');
});

test('sağlayıcının hata sayfası söz sayılmıyor, önbellek temizlenebiliyor', async () => {
  const dir = tmp('svlyr-');
  const config = { enabled: true, sidecar: false, embedded: false, cache: true, providers: [{ url: 'https://x.test/?t={title}', format: 'lrc' }] };
  const meta = { title: 'T', artist: 'A' };
  const answer = (text) => async () => ({ ok: true, text: async () => text });
  assert.strictEqual(await LL.lookup({ meta, config, cacheDir: dir, fetch: answer('<!DOCTYPE html><html>Rate limit</html>') }), null);
  assert.strictEqual(await LL.lookup({ meta, config, cacheDir: dir, fetch: answer('{"error":"limit"}') }), null);
  assert.strictEqual(fs.readdirSync(dir).length, 0, 'önbelleğe girmedi');
  assert.strictEqual((await LL.lookup({ meta, config, cacheDir: dir, fetch: answer('[00:01.00]Söz') })).source, 'provider');
  fs.writeFileSync(path.join(dir, 'kullanici.txt'), 'x');
  assert.strictEqual(LL.clearCache(dir), 1);
  assert.deepStrictEqual(fs.readdirSync(dir), ['kullanici.txt'], 'yalnız önbellek dosyası silinir');
  assert.match(read('src/admin/extras-panel.js'), /lyricsCacheClear/);
  assert.match(read('src/admin/extras-panel.js'), /LRCLIB Ekle/);
  assert.match(read('src/admin/extras-panel.js'), /SVLyricsProviders/);
  assert.match(read('src/admin/index.html'), /lyrics-providers\.js/);

});

test('kaydırma seçimi koruyor: ikinci tıklama yalnız aynı satırları kaydırır', () => {
  const v = '[00:01.00]a\n[00:02.00]b\n[00:03.00]c';
  const once = L.nudgeText(v, 0, 1, 0.1);
  const [s, e] = L.lineSpan(once, 0, 1);
  assert.strictEqual(once.slice(s, e), '[00:01.10]a\n[00:02.10]b');
  const twice = L.nudgeText(once, 0, 1, 0.1);
  assert.strictEqual(twice, '[00:01.20]a\n[00:02.20]b\n[00:03.00]c');
  assert.deepStrictEqual(L.lineSpan(twice, 1, 2), [12, 35]);
  const ui = read('src/admin/lyrics-lib-ui.js');
  assert.match(ui, /edit\(next, s, e\)/);
  assert.match(ui, /execCommand\('insertText'/, 'geri alma geçmişi korunmalı');
});

test('eş listesi kutusu kayıtlı değeri gösteriyor', () => {
  const src = read('src/admin/extras-panel.js');
  const body = src.slice(src.indexOf('function textArea'), src.indexOf('function screensaver'));
  assert.match(body, /t\.value = value \|\| ''/);
  assert.doesNotMatch(body, /value: value/, 'textarea öznitelikten okumaz');
});

test('ekran koruyucu giden görüntüye binmiyor', () => {
  const vis = read('src/visualizer/visualizer.js');
  assert.match(vis, /const outgoingPage = location\.protocol !== 'file:' \|\| .*svCapture=1/);
  assert.match(vis, /if \(!SS \|\| outgoingPage\) return;/);
});

test('Link temposu eş varken yineleniyor: sahne geri çağrılınca geri yazılır', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const on = {};
  const sock = { on: (k, f) => { on[k] = f; }, bind() {}, close() {}, addMembership() {} };
  const seen = [];
  const l = LT.createListener((st) => seen.push(st.bpm), { createSocket: () => sock });
  l.start();
  t.mock.timers.tick(2000);
  assert.strictEqual(seen.length, 0, 'eş yokken yinelenmez');
  const body = Buffer.alloc(8 + 8 + 24);
  body.write('tmln', 0, 'latin1');
  body.writeUInt32BE(24, 4);
  body.writeBigInt64BE(BigInt(Math.round(60e6 / 128)), 8);
  on.message(Buffer.concat([LT.MAGIC, Buffer.from([1, 5, 0, 0]), Buffer.alloc(8, 7), body]));
  assert.deepStrictEqual(seen, [128]);
  t.mock.timers.tick(2000);
  assert.deepStrictEqual(seen, [128, 128], 'değişmese de yinelendi');
  l.stop();
});

test('dış tempo kapanınca eski BPM geri geliyor', () => {
  const ts = { source: 'off' };
  const m = { bpm: 0 };
  MC.switchSource(ts, m, 'midi');
  m.bpm = 140;
  MC.switchSource(ts, m, 'link');
  MC.switchSource(ts, m, 'off');
  assert.strictEqual(m.bpm, 0, '0 = tempo motoru');
  assert.strictEqual(ts.savedBpm, undefined);
  const elle = { bpm: 90 };
  MC.switchSource(ts, elle, 'midi');
  elle.bpm = 140;
  MC.switchSource(ts, elle, 'off');
  assert.strictEqual(elle.bpm, 90, 'elle verilen değer korunur');
  assert.match(read('src/admin/control.js'), /MCK\(\)\.switchSource\(ts, cfg\.modulation, e\.target\.value\)/);
});

test('ağ ayarları gizli: eş listesi izne bağlı, sağlayıcı adresi dışarı çıkmıyor', () => {
  const src = read('src/shared/mcp.js');
  assert.match(src, /'stream\.remotePeers': 'streamToken'/);
  assert.match(src, /\['lyricsLookup', 'providers'\]/);
  const out = stream.publicConfig({ lyricsLookup: { enabled: true, providers: [{ url: 'https://x.test/?key=gizli' }] } });
  assert.deepStrictEqual(out.lyricsLookup.providers, []);
});

test('kumanda sinyali İngilizcede de çevrili, öğrenme bitince okuma durumu yenileniyor', () => {
  const src = read('src/admin/control.js');
  assert.match(src, /lastSignal\.gamepad = GPM\(\)\.label\(e0, !!\(window\.SVI18n/);
  assert.match(src, /learning = null; syncGamepad\(\); P\(\)\.push\(true\)/);
  const dict = dictionary();
  for (const k of ['Söz Önbelleğini Temizle', 'Söz önbelleği temizlendi.']) assert.ok(dict.has(k), k);
});

test('çökme bildirimi "sağlam" derken dosya gerçekten okunmuş olmalı', () => {
  const main = read('src/main/main.js');
  assert.match(main, /intact: !!startupSettings && !!usable/);
  const panel = read('src/admin/extras-panel.js');
  assert.match(panel, /n\.restored\s*\? 'Önceki oturum[^']*'\s*: n\.intact\s*\? 'Önceki oturum[^']*sağlam[^']*'\s*: 'Önceki oturum[^']*okunamadı[^']*'/);
  // Üç metin de İngilizce arayüzde karşılığını buluyor
  const i18n = read('src/shared/i18n.js');
  assert.ok(i18n.includes("'Önceki oturum beklenmedik biçimde kapandı. Ayar dosyası okunamadı, varsayılan ayarlarla açıldı.':"));
});

test('ek panellerin kaydırıcıları şemayla aynı sınırda (#905)', () => {
  const Schema = require('../src/shared/schema.js');
  const src = read('src/admin/extras-panel.js');
  const rows = [...src.matchAll(/p\.slider\(T\('[^']*'\), '([a-zA-Z.]+)', \{ min: ([\d.]+), max: ([\d.]+)/g)];
  assert.ok(rows.length >= 4);
  for (const [, path, min, max] of rows) {
    const row = Schema.rangeFor(path);
    assert.ok(row, path + ' şemada yok');
    assert.strictEqual(row.min, Number(min), path);
    assert.strictEqual(row.max, Number(max), path);
  }
});
