'use strict';
/* YEDEKLİLİK: YALITILMIŞ PAKET KATMANI VE MILKDROP GEÇİŞ HİZASI (#812).
 *
 * 1. Birincilin paketindeki, yedekte olmayan presetler ve logolar yedeğin
 *    kütüphanesine yazılmıyor. Paket klasöründe kalıyor ve yalnız birincilin
 *    kopyası çizilirken pencerelere görünüyor; operatör her birini ayrı
 *    onayla kütüphaneye alıyor. Eski "farkı gönder" de yalıtılmış yedekte
 *    kütüphaneye yazmıyor, videosuz paketi çektiriyor.
 * 2. Liderin geçişi başlattığı an (`startedAt`) izleyene gidiyor; yedekte
 *    birincilin saatinden yerel saate çevriliyor. İzleyen geç başladıysa
 *    geçişini yalnız İLERİ alıyor. Pencerenin kendi `at` damgası (1,5 sn
 *    izleme zamanlayıcısı) dışarıdan gelen bir alanla ezilmiyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Windows'ta git CRLF ile çıkarabilir: düzenli ifadeler \n bekliyor
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const R = require('../src/main/redundancy');
const MAIN = read('src/main/main.js');

test('localFollow: geçiş anı yerel saate, `at` ve özet pencereye gitmiyor', () => {
  const out = R.localFollow({ id: 'p', at: 123, hash: 'abc', startedAt: 1000, seed: 5 }, (ms) => ms + 250);
  assert.strictEqual(out.startedAt, 1250);
  assert.ok(!('at' in out), 'pencerenin performance.now() damgası ezilmemeli');
  assert.ok(!('hash' in out));
  assert.strictEqual(out.seed, 5);
  assert.strictEqual(R.localFollow({ id: 'p' }, (ms) => ms).startedAt, null);
  assert.strictEqual(R.localFollow({ id: 'p', startedAt: 'x' }, (ms) => ms).startedAt, null);
  assert.strictEqual(R.localFollow(null, () => 0), null);
});

test('birincil yedeğe `at` yollamıyor; yedek pencerelere çevrilmiş seçimi veriyor', () => {
  const relay = MAIN.slice(MAIN.indexOf('function relayMdFollow('), MAIN.indexOf('function mdPresetHash('));
  assert.match(relay, /startedAt: Number\.isFinite\(mp\.startedAt\) \? mp\.startedAt : null \};/);
  assert.doesNotMatch(relay, /at: now \}\) \}\)/);
  const on = MAIN.slice(MAIN.indexOf("if (msg.type === 'md-follow') {"), MAIN.indexOf("if (msg.type === 'hello' && typeof msg.version"));
  assert.match(on, /const follow = redundancy\.localFollow\(msg\.follow, \(ms\) => f\.toLocal\(ms\)\);/);
  assert.match(on, /win\.webContents\.send\('md-follow', follow\)/);
  // Web sayfası başka makinede: geçiş anı ona gitmiyor
  assert.match(on, /follow: Object\.assign\(\{\}, follow, \{ startedAt: null \}\)/);
});

/* Motorun hizalama yöntemi pencere olmadan, düz alanlarla sınanıyor. */
global.window = global.window || {};
if (!global.document) global.document = { createElement: () => ({ getContext: () => null, width: 0, height: 0 }) };
require('../src/visualizer/modes/milkdrop.js');
const Mode = global.window.SVModes.milkdrop;

function fake(over) {
  return Object.assign({ blendProg: 0.05, blendDur: 2, _blendStart: { id: 'p', at: 0, aligned: false } }, over);
}

test('geçiş hizası: geç başlayan izleyen ilerlemesini öne alıyor, bir kez', () => {
  const now = 100000;
  global.window.SVMdFollow = { id: 'p', startedAt: now - 1000 };
  const m = fake();
  assert.strictEqual(Mode.prototype._alignBlend.call(m, now), true);
  assert.ok(Math.abs(m.blendProg - 0.5) < 1e-9, 'bir saniye geç, iki saniyelik geçiş: yarıda');
  m.blendProg = 0.6;
  assert.strictEqual(Mode.prototype._alignBlend.call(m, now + 5000), false, 'bir geçişte bir kez');
  assert.strictEqual(m.blendProg, 0.6);
});

test('geçiş hizası: geri sarmıyor, yabancı seçimde ve saçma saatte dokunmuyor', () => {
  const now = 100000;
  // İzleyen zaten önde: geri alınmıyor
  global.window.SVMdFollow = { id: 'p', startedAt: now - 200 };
  let m = fake({ blendProg: 0.4 });
  assert.strictEqual(Mode.prototype._alignBlend.call(m, now), false);
  assert.strictEqual(m.blendProg, 0.4);
  // Başka presetin anı
  global.window.SVMdFollow = { id: 'q', startedAt: now - 1000 };
  m = fake();
  assert.strictEqual(Mode.prototype._alignBlend.call(m, now), false);
  assert.strictEqual(m.blendProg, 0.05);
  // Gelecekte bir an (saat farkı ölçülmedi) ya da çok eski
  for (const t of [now + 3000, now - 60000]) {
    global.window.SVMdFollow = { id: 'p', startedAt: t };
    m = fake();
    Mode.prototype._alignBlend.call(m, now);
    assert.strictEqual(m.blendProg, 0.05, String(t));
  }
  // Geçişin sonu aşılsa da bitmiş sayılmıyor: eski preset bir sonraki karede düşer
  global.window.SVMdFollow = { id: 'p', startedAt: now - 2500 };
  m = fake();
  Mode.prototype._alignBlend.call(m, now);
  assert.ok(m.blendProg < 1 && m.blendProg > 0.99);
  // Geçişi olmayan (sert geçiş) izleyen
  m = fake({ _blendStart: null });
  assert.strictEqual(Mode.prototype._alignBlend.call(m, now), false);
  delete global.window.SVMdFollow;
});

test('lider geçişin başladığı anı yalnız o seçimin geçişi için duyuruyor', () => {
  const M = read('src/visualizer/modes/milkdrop.js');
  assert.match(M, /this\._blendStart = \{ id: a \? a\.id : '', at: Date\.now\(\), aligned: false \};\n      \} else \{\n        this\._blendStart = null;/);
  assert.match(M, /startedAt: a && this\._blendStart && this\._blendStart\.id === a\.id \? this\._blendStart\.at : null,/);
  const lp = { autoPick: { id: 'p' }, _blendStart: { id: 'p', at: 42 }, _manualKey: '', cycle: null, _tempo: null, _pending: null };
  assert.strictEqual(Mode.prototype.livePreset.call(lp).startedAt, 42);
  lp._blendStart = { id: 'eski', at: 1 };
  assert.strictEqual(Mode.prototype.livePreset.call(lp).startedAt, null, 'yeni seçim henüz derleniyor');
});

test('paket: eksik preset/logo kütüphaneye yazılmıyor, katmanda kalıyor', () => {
  const load = MAIN.slice(MAIN.indexOf('function loadPackageOverlay() {'), MAIN.indexOf('function installPackage() {'));
  assert.doesNotMatch(load, /presetsStore\.save|logoLibrary\.importBytes|broadcastPresetDelta/);
  assert.match(load, /red\.overlay = \{ presets, logos \};/);
  assert.match(load, /logos\.set\(String\(it\.id\), \{ file, name: it\.name \|\| it\.id \}\);/);
  // Katman yalnız yedek birincilin kopyasını çizerken açık
  assert.match(MAIN, /function overlayOn\(\) \{\n  return red\.role === 'backup' && red\.isolated && red\.source === 'primary';\n\}/);
  // Yapılandırmadan önce katman: pencere sahnenin presetini listede bulsun
  assert.match(MAIN, /red\.source = source;\n  \/\/[^\n]*\n  syncOverlay\(\);\n  if \(!currentConfig\) return;/);
  // Rol kapanınca katman pencerelerden çekiliyor
  const leave = MAIN.slice(MAIN.indexOf('function leaveBackupSpace() {'), MAIN.indexOf('function stopRedundancy() {'));
  assert.match(leave, /red\.isolated = false;[\s\S]*syncOverlay\(\);/);
  // Önceki oturumun paketi yedek rolü açılınca okunuyor
  const enter = MAIN.slice(MAIN.indexOf('function enterBackupSpace() {'), MAIN.indexOf('function leaveBackupSpace() {'));
  assert.match(enter, /loadPackageOverlay\(\)/);
});

test('pencereler katmanı görüyor: liste, MilkDrop kaynağı, logo okuma, eşlik', () => {
  assert.match(MAIN, /return withOverlayPresets\(list\);/);
  assert.match(MAIN, /logoFile: \(id\) => logoInfoForShow\(id\),/);
  assert.match(MAIN, /ipcMain\.handle\('logo-lib:read', async \(e, id\) => \{\n[^\n]*\n  const entry = await logoBytesForShow\(id\);/);
  assert.match(MAIN, /protocol\.handle\('sv-logo'[\s\S]{0,300}const entry = await logoBytesForShow\(id\);/);
  assert.match(MAIN, /const own = follow && follow\.id \? presetForShow\(follow\.id\) : null;/);
  // Kütüphane her zaman önce: aynı kimlikte yerel öğe katmandakini gölgeler
  assert.match(MAIN, /function presetForShow\(id\) \{\n  return presetsStore\.get\(id\) \|\| isolatedPreset\(id\);/);
  assert.match(MAIN, /const own = logoLibrary\.fileInfo\(logoLibDir\(\), id\);\n  if \(own \|\| !overlayOn\(\)\) return own;/);
});

test('tek tek kütüphaneye alma ve yalıtılmış yedekte eski gönderim', () => {
  const use = MAIN.slice(MAIN.indexOf("ipcMain.handle('redundancy:use-primary-asset'"), MAIN.indexOf("ipcMain.handle('redundancy:pkg-request'"));
  assert.match(use, /delete clean\.fromPrimary;/);
  assert.match(use, /red\.overlay\.presets\.delete\(spec\.id\);/);
  assert.match(use, /red\.overlay\.logos\.delete\(String\(spec\.id\)\);/);
  assert.match(use, /red\.pkgResult\.isolated = red\.pkgResult\.isolated\.filter\(keep\);/);
  const asset = MAIN.slice(MAIN.indexOf('function onPrimaryAsset(msg) {'), MAIN.indexOf("ipcMain.handle('redundancy:push'"));
  assert.match(asset, /if \(red\.isolated\) \{ pullPackageForPush\(\); return false; \}/);
  assert.match(asset, /red\.pullAuto = \{ any: true, media: false \};/);
  assert.match(MAIN, /if \(auto && \(auto\.any \|\| red\.pull\.status\.pkg === auto\.pkg\)\) \{/);
  // Panel: her öğe için ayrı onay
  const panel = read('src/admin/redundancy-panel.js');
  assert.match(panel, /async function addIsolated\(c\) \{\n    const ok = await P\(\)\.confirm\(tr\('Bu öğe bu makinenin kütüphanesine eklenecek:'\)/);
});

/* PANEL KOPYASI (#812, Linux'ta bulundu). Rol kapatılınca settings.json yerel
   gösteriye dönüyordu ama panel birincilin gösterisini göstermeye devam
   ediyordu; paneldeki ilk düzenleme yapılandırmanın tamamını geri yollayıp
   diske birincilin sahnelerini yazıyordu. Gösteriyi değiştiren her geçiş
   panele HEMEN bildirmeli. */
test('gösteri geçişleri panelin kopyasını hemen güncelliyor', () => {
  assert.match(MAIN, /function notifyAdminConfigNow\(\) \{\n  if \(red\.adminTimer\) \{ clearTimeout\(red\.adminTimer\); red\.adminTimer = null; \}\n  if \(currentConfig\) notifyAdmin\('external-config', currentConfig\);\n\}/);
  const leave = MAIN.slice(MAIN.indexOf('function leaveBackupSpace() {'), MAIN.indexOf('function stopRedundancy() {'));
  assert.match(leave, /const changed = redSpace\(\)\.restoreLocal\(next\);\n[^\n]*applyIncomingConfig[^\n]*\n[^\n]*saveSettings[^\n]*\n    notifyAdminConfigNow\(\);/);
  // Devralma, bırakma ve gösteri seçimi applyRedShow'dan geçiyor
  const apply = MAIN.slice(MAIN.indexOf('function applyRedShow(show, source) {'), MAIN.indexOf('function enterBackupSpace() {'));
  assert.match(apply, /const switched = red\.source !== source;/);
  assert.match(apply, /if \(switched\) notifyAdminConfigNow\(\);/);
  // Yerel gösteri çizilirken sahne aktarımı
  const imp = MAIN.slice(MAIN.indexOf("ipcMain.handle('redundancy:import-scene'"), MAIN.indexOf("ipcMain.handle('redundancy:use-primary-asset'"));
  assert.match(imp, /applyIncomingConfig\(next, \{ patchKeys: \['scenes'\], fromPrimary: true \}\);\n    notifyAdminConfigNow\(\);/);
});

/* "Farkı gönder" kalp atışını bekletmiyor (#812): yalıtılmış yedek yeteneğini
   envanterle bildirir, birincil yalnız küçük bir haber yollar; yedek öğeleri
   256 KB'lık parçalarla paketten çeker. Eski yedeğe öğeler tek tek ve her
   birinden sonra olay döngüsüne dönülerek gider. */
test('farkı gönder: yeni yedeğe yalnız haber, eski yedeğe öğe öğe', () => {
  const inv = MAIN.slice(MAIN.indexOf('async function sendInventory('), MAIN.indexOf('function onPrimaryAsset(msg) {'));
  assert.match(inv, /const caps = red\.isolated \? \['pkg'\] : \[\];/);
  assert.match(MAIN, /if \(msg\.part === 0\) red\.backupCaps = Array\.isArray\(msg\.caps\)/);
  const push = MAIN.slice(MAIN.indexOf("ipcMain.handle('redundancy:push'"), MAIN.indexOf("ipcMain.handle('redundancy:compare'"));
  assert.match(push, /red\.backupCaps\.indexOf\('pkg'\) >= 0\) \{\n    streamServer\.sendPeers\(\{ type: 'push-notice', n: list\.length \}\);\n    return/);
  assert.match(push, /await new Promise\(\(r\) => setImmediate\(r\)\);\n  \}/);
  assert.match(MAIN, /if \(msg\.type === 'push-notice'\) \{ if \(red\.isolated\) pullPackageForPush\(\); return; \}/);
});
