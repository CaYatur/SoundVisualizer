'use strict';
/* KÖPRÜ PENCERESİ (#822): panel açmadan ayarlar, bu makinenin adresleri,
 * oturum açılınca başlatma, köprü kipine giriş ve çıkışta yeniden açılış.
 * Canlı akış (yalıtılmış profille, Windows): ad ve port alandan çıkınca
 * kaydediliyor, yazarken saniyelik yeniden çizim alanı silmiyor; ayrı açılan
 * köprüden çıkınca olağan uygulama açılıyor; paneldeki "Yalnız Ses
 * Köprüsü" yeniden başlatmayı soruyor ve köprü kipinde açıyor; köprüden
 * olağan kipe dönüş ayarı diske yazıp açıyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const AS = require('../src/main/bridge-autostart');
const B = require('../src/main/audio-bridge');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

test('oturum açılışı: komut köprünün klasörüne göre; geliştirmede ve macOS\'ta sunulmuyor', () => {
  assert.deepStrictEqual(AS.spec({ platform: 'win32', packaged: false }), { supported: false, reason: 'dev' });
  assert.strictEqual(AS.spec({ platform: 'darwin', packaged: true }).reason, 'platform');
  const own = AS.spec({ platform: 'win32', packaged: true, execPath: 'C:\\P\\app.exe', env: {}, ownProfile: true });
  assert.deepStrictEqual(own.args, ['--bridge', '--hidden']);
  assert.strictEqual(own.exe, 'C:\\P\\app.exe');
  // Ayardan açılan köprü olağan klasörü kullanır: aynı parola, aynı ayar
  assert.deepStrictEqual(AS.spec({ platform: 'win32', packaged: true, execPath: 'x', env: {}, ownProfile: false }).args, ['--bridge', '--bridge-shared-profile', '--hidden']);
  // Taşınabilir exe geçici klasörden çalışır; kayıt asıl dosyaya
  assert.strictEqual(AS.spec({ platform: 'win32', packaged: true, execPath: 'C:\\Temp\\x.exe', env: { PORTABLE_EXECUTABLE_FILE: 'D:\\CAYADEV.exe' }, ownProfile: true }).exe, 'D:\\CAYADEV.exe');
  assert.strictEqual(AS.spec({ platform: 'linux', packaged: true, execPath: '/tmp/.mount/app', env: { APPIMAGE: '/home/u/CAYADEV.AppImage' }, ownProfile: true }).exe, '/home/u/CAYADEV.AppImage');
});

test('oturum açılışı Linux: XDG girdisi, boşluklu yol tırnakta; aç, oku, kapat', () => {
  const sp = AS.spec({ platform: 'linux', packaged: true, execPath: '/opt/CAYADEV Visualizer/soundvisualizer', env: {}, ownProfile: true });
  const e = AS.desktopEntry(sp);
  assert.match(e, /^\[Desktop Entry\]\nType=Application\n/);
  assert.match(e, /\nExec="\/opt\/CAYADEV Visualizer\/soundvisualizer" --bridge --hidden\n/);
  assert.strictEqual(AS.quoteExec('a"b'), '"a\\"b"');
  const files = new Map();
  const fakeFs = {
    mkdirSync() {},
    writeFileSync: (f, t) => files.set(f, t),
    readFileSync: (f) => { if (!files.has(f)) throw new Error('ENOENT'); return files.get(f); },
    unlinkSync: (f) => files.delete(f),
  };
  const deps = { fs: fakeFs, home: '/home/u' };
  assert.strictEqual(AS.get(deps, sp), false);
  assert.strictEqual(AS.set(deps, sp, true), true);
  assert.ok(files.has(path.join('/home/u', '.config', 'autostart', AS.DESKTOP_FILE)));
  assert.strictEqual(AS.set(deps, sp, false), false);
  assert.strictEqual(files.size, 0);
});

/* Windows'ta ölçüldü (paketli sürüm, paket kimliğiyle): HKCU Run'a yazılan
   girdi sanal bir kopyaya gidiyor, gerçek anahtarda yok; Başlangıç klasörüne
   yazılan kısayol gerçek klasöre düşüyor. Bu yüzden kısayol. */
test('oturum açılışı Windows: Başlangıç klasöründe kısayol; Görev Yöneticisi\'nde kapalıysa kapalı', () => {
  const sp = AS.spec({ platform: 'win32', packaged: true, execPath: 'C:\\P\\app.exe', env: {}, ownProfile: true });
  const files = new Map();
  const approved = new Map();
  const fakeFs = { mkdirSync() {}, existsSync: (f) => files.has(f), unlinkSync: (f) => files.delete(f) };
  const shell = {
    writeShortcutLink: (f, op, o) => { files.set(f, Object.assign({ op }, o)); return true; },
    readShortcutLink: (f) => { if (!files.has(f)) throw new Error('no link'); return files.get(f); },
  };
  const reg = (a) => {
    if (a[0] !== 'query' || a[1] !== AS.APPROVED_KEY || a[2] !== '/v' || !approved.has(a[3])) throw new Error('not found');
    return '\r\n' + a[1] + '\r\n    ' + a[3] + '    REG_BINARY    ' + approved.get(a[3]) + '\r\n';
  };
  const deps = { fs: fakeFs, shell, reg, appData: 'C:\\Users\\u\\AppData\\Roaming' };
  const lnk = AS.startupLink(deps.appData);
  assert.strictEqual(lnk, path.join('C:\\Users\\u\\AppData\\Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'CAYADEV Visualizer Audio Bridge.lnk'));
  assert.strictEqual(AS.get(deps, sp), false);
  assert.strictEqual(AS.set(deps, sp, true), true);
  assert.deepStrictEqual(files.get(lnk), { op: 'create', target: 'C:\\P\\app.exe', args: '--bridge --hidden', description: AS.NAME, icon: 'C:\\P\\app.exe', iconIndex: 0 });
  approved.set(AS.LNK, '030000000000000000000000');
  assert.strictEqual(AS.get(deps, sp), false, 'Görev Yöneticisi\'nden kapatıldı');
  approved.set(AS.LNK, '020000000000000000000000');
  assert.strictEqual(AS.get(deps, sp), true);
  assert.strictEqual(AS.set(deps, sp, false), false);
  assert.ok(!files.has(lnk));
  // Kayıt defterine yazılmaz (paket kimliğinde sanallaşıyor)
  assert.ok(!/setLoginItemSettings/.test(read('src/main/bridge-autostart.js').replace(/\/\*[\s\S]*?\*\//g, '')));
});

test('adresler: IPv4, iç ve 169.254 yok; sanal bağdaştırıcı sona', () => {
  const list = B.lanAddresses({
    'vEthernet (WSL)': [{ family: 'IPv4', address: '172.20.0.1', internal: false }],
    'Wi-Fi': [{ family: 'IPv4', address: '192.168.1.20', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
    'Loopback Pseudo-Interface 1': [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    Ethernet: [{ family: 4, address: '10.0.0.5', internal: false }, { family: 'IPv4', address: '169.254.3.4', internal: false }],
  });
  assert.deepStrictEqual(list.map((a) => [a.name, a.address, a.virtual]), [['Ethernet', '10.0.0.5', false], ['Wi-Fi', '192.168.1.20', false], ['vEthernet (WSL)', '172.20.0.1', true]]);
});

test('yeniden açılış: köprü bayrakları atılır, ayar diske yazılıp doğrulanır, otomasyonda açılmaz', () => {
  const M = read('src/main/main.js');
  assert.match(M, /const BRIDGE_ARGS = \['--bridge', '--hidden', '--panel', '--bridge-shared-profile'\];/);
  assert.match(M, /function relaunchApp\(dropBridgeArgs\) \{\n  if \(AUTOMATION_RUN\) return false;/);
  assert.match(M, /const execPath = process\.env\.PORTABLE_EXECUTABLE_FILE \|\| process\.env\.APPIMAGE \|\| process\.execPath;\n  app\.relaunch\(\{ execPath, args \}\);\n  forceQuitApp = true;/);
  // Kayıt gecikmeli ve dosya bekçisi yazmayabilir: yazıldığı okunarak doğrulanır
  assert.match(M, /flushSettings\(\);\n  try \{ return !!\(JSON\.parse\(fs\.readFileSync\(SETTINGS_PATH, 'utf8'\)\)\.bridge \|\| \{\}\)\.only === !!on; \}/);
  assert.match(M, /if \(!persistBridgeOnly\(false\)\) \{ await settingsNotSavedBox\(parent\); return \{ ok: false, error: 'save' \}; \}/);
  // Ayrı açılan köprü: olağan uygulama açıksa yenisi açılmaz, o öne gelir
  assert.match(M, /running = instances\.live\(path\.join\(appDir, 'instances'\), \{ selfPid: process\.pid \}\)\.filter\(\(x\) => x\.role === 'app'\);/);
  assert.match(M, /fs\.writeFileSync\(path\.join\(appDir, 'instances', running\[0\]\.pid \+ '\.focus'\), String\(process\.pid\), 'utf8'\);/);
  // Kipten çıkınca oturum açılışı da kapanır
  assert.match(M, /if \(auto\.on\) setBridgeAutostart\(false\);/);
  // Pencere yalnız izinli anahtarları yazar, panelinkiyle aynı süzgeçten
  assert.match(M, /const BRIDGE_WIN_KEYS = \['name', 'port', 'secret', 'startHidden'\];/);
  assert.match(M, /for \(const k of BRIDGE_WIN_KEYS\) if \(Object\.prototype\.hasOwnProperty\.call\(patch, k\)\) cur\[k\] = patch\[k\];\n  const n = audioBridge\.normalize\(cur\);/);
  for (const ch of ['set-config', 'new-secret', 'addresses', 'autostart', 'exit-mode', 'copy']) {
    assert.match(M, new RegExp("ipcMain\\.handle\\('bridge-win:" + ch + "', (async )?\\(e"), ch);
    assert.ok(read('src/main/preload-bridge-status.js').includes("'bridge-win:" + ch + "'"), 'preload ' + ch);
  }
  // Tepsi: ayarlar köprünün penceresinde; kipten çıkış ve panel ayrı
  assert.match(M, /click: \(\) => openBridgeWindow\('settings'\) \},/);
  assert.match(M, /click: \(\) => \{ exitBridgeMode\(\)\.catch\(\(\) => \{\}\); \} \},/);
});

test('panel: "Yalnız Ses Köprüsü" değişince yeniden başlatmayı soruyor; ayrı köprüde anahtar yok', () => {
  const P = read('src/admin/bridge-panel.js');
  assert.match(P, /status && status\.ownProfile \? null : switchRow\(tr\('Yalnız Ses Köprüsü'\), b\.only, async \(v\) => \{/);
  assert.match(P, /\{ title: tr\('Şimdi yeniden başlatılsın mı\?'\), okText: tr\('Şimdi Yeniden Başlat'\), cancelText: tr\('Sonraki Açılışta'\) \}\);\n\s+if \(ok && window\.api\.bridgeRelaunch\) await window\.api\.bridgeRelaunch\(\);/);
  assert.ok(read('src/main/preload-admin.js').includes("bridgeRelaunch: () => ipcRenderer.invoke('bridge:relaunch'),"));
});

test('pencere: üç sekme (.bs-seg, öz testin İngilizce taraması gezer), yazarken yeniden çizim yok', () => {
  const S = read('src/bridge-status/status.js');
  assert.match(S, /const TABS = \[\['status', 'Durum'\], \['sources', 'Kaynaklar'\], \['settings', 'Ayarlar'\]\];/);
  assert.match(S, /el\('div', \{ class: 'bs-seg bs-tabs', role: 'tablist' \}/);
  assert.match(S, /a\.tagName === 'SELECT' \|\| a\.tagName === 'INPUT' && a\.type !== 'checkbox' \|\| a\.tagName === 'TEXTAREA'\)\) return;/);
  // Alanlar yazarken değil alandan çıkınca kaydedilir (köprü yeniden kurulur)
  assert.match(S, /name\.addEventListener\('change', \(\) => save\(\{ name: name\.value\.trim\(\) \}\)\);/);
  assert.match(S, /secret\.addEventListener\('change', \(\) => save\(\{ secret: secret\.value\.trim\(\) \}\)\);/);
  assert.match(S, /if \(!\(v >= 1024 && v <= 65535\)\) \{ port\.value = String\(c\.port \|\| 8741\); return; \}/);
  const I = read('src/shared/i18n.js');
  for (const k of ['Oturum Açılınca Köprüyü Başlat', 'Bu Makinenin Adresleri', 'Olağan Kipe Dön', 'Köprüyü Kapat, Uygulamayı Aç', 'Kopyalandı', 'Gizle', 'Göster', 'Şimdi Yeniden Başlat']) assert.ok(I.includes("'" + k + "':"), k);
});

test('saat: bağlanınca ilk yoklamalar 100 ms arayla', () => {
  assert.strictEqual(B.QUICK_PINGS, 5);
  assert.match(read('src/main/audio-bridge.js'), /const fast = \(\) => \{ ping\(\); pingTimer = \+\+quick < QUICK_PINGS \? setTimeout\(fast, 100\) : setInterval\(ping, 1000\); \};\n\s+ping\(\);\n\s+pingTimer = setTimeout\(fast, 100\);/);
});

test('panel: "Ses Köprüsünü Ayrı Aç" ayrı --bridge kopyası başlatır; hata ayıklama portu taşınmaz', () => {
  const M = read('src/main/main.js');
  assert.match(M, /ipcMain\.handle\('bridge:open-separate', \(\) => \{\n  if \(BRIDGE_ONLY \|\| AUTOMATION_RUN\) return \{ ok: false \};\n[^\n]*\n  if \(PORTABLE_BUILD\) return \{ ok: false, error: 'portable' \};\n  const args = process\.argv\.slice\(1\)\.filter\(\(a\) => !BRIDGE_ARGS\.includes\(a\) && !\/\^--\(inspect\|remote-debugging-port\)\/\.test\(a\)\)\.concat\('--bridge'\);/);
  assert.match(M, /const c = require\('child_process'\)\.spawn\(exe, args, \{ detached: true, stdio: 'ignore' \}\);\n    c\.unref\(\);/);
  assert.ok(read('src/main/preload-admin.js').includes("bridgeOpenSeparate: () => ipcRenderer.invoke('bridge:open-separate'),"));
  assert.match(read('src/admin/bridge-panel.js'), /!only && !\(status && status\.portable\) && window\.api\.bridgeOpenSeparate \? ctlRow\(tr\('Ayrı Köprü'\)/);
  assert.ok(read('src/shared/i18n.js').includes("'Ses Köprüsünü Ayrı Aç': 'Open Audio Bridge Separately',"));
});

/* Taşınabilir sürümde ölçüldü: uygulama ve yanında açılan köprü aynı sabit
   geçici klasörden çalışıyor; uygulama kapanınca taşınabilir kabuk klasörü
   sildi (resources'ta yalnız kilitli app.asar kaldı), köprü yardımcılarını
   kaybetti. Kabuk açılışta da siliyor. Taşınabilirde ayrı kopya açılmaz. */
test('taşınabilir: ayrı köprü düğmesi ve atlama listesi görevi yok, nedeni panelde', () => {
  const M = read('src/main/main.js');
  assert.match(M, /const PORTABLE_BUILD = !!process\.env\.PORTABLE_EXECUTABLE_FILE;/);
  assert.match(M, /if \(PORTABLE_BUILD\) return \{ ok: false, error: 'portable' \};/);
  assert.match(M, /if \(process\.platform === 'win32' && app\.isPackaged && !AUTOMATION_RUN && !PORTABLE_BUILD\) \{/);
  assert.match(M, /ownProfile: BRIDGE_OWN_PROFILE, portable: PORTABLE_BUILD,/);
  const P = read('src/admin/bridge-panel.js');
  assert.match(P, /!only && status && status\.portable \? el\('div', \{ class: 'br-sub', text: tr\('Taşınabilir sürümde köprü uygulamanın yanında ayrı açılmaz:/);
  assert.match(P, /!only && !\(status && status\.portable\) && window\.api\.bridgeOpenSeparate \? ctlRow\(/);
  assert.ok(read('src/shared/i18n.js').includes("'Taşınabilir sürümde köprü uygulamanın yanında ayrı açılmaz:"));
});
