'use strict';
/* Aynı ayar klasörünü kullanan kopyalar (#564) — bağlantılar.
 *
 * Kayıt defteri ve dosya bekçisi kendi testlerinde sınanıyor. Burada
 * sabitlenen şey onların DOĞRU YERDE çağrıldığı: main.js Electron'a bağlı ve
 * Node'da require edilemiyor, o yüzden kaynak üzerinden. Yorumlar ayıklanıyor —
 * yorum satırına alınmış bir çağrı metinde görünmeye devam eder ve denetim
 * sessizce geçerdi. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

const MAIN = strip(read('src/main/main.js'));

function body(src, header) {
  const start = src.indexOf(header);
  assert.ok(start >= 0, header + ' bulunamadı');
  const open = src.indexOf('{', start + header.length - 1);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  assert.fail(header + ' kapanmıyor');
}

test('otomasyon koşuları soru sormuyor ve bekçiyi açmıyor', () => {
  assert.match(MAIN, /const AUTOMATION_RUN = SMOKE \|\| SHOTS \|\| process\.argv\.includes\('--diag'\) \|\| !!process\.env\.SV_IDENTITY_PROBE_FILE;/);
  const ready = body(MAIN, 'app.whenReady().then(async () => {');
  const ask = ready.indexOf('if (!AUTOMATION_RUN && !(await checkOtherCopies())) return;');
  const guardOn = ready.indexOf('settingsGuardOn = true;');
  const registry = ready.indexOf('startInstanceRegistry();');
  const config = ready.indexOf('currentConfig = startupSettings ? SettingsGuard.parse(startupSettings) : null;');
  const admin = ready.indexOf('createAdminWindow();');
  assert.ok(ask > 0, 'açılış sorusu yok ya da otomasyonu dışarıda bırakmıyor');
  assert.ok(guardOn > ask && registry > ask && config > ask && admin > config,
    'sıra: önce soru, sonra bekçi/kayıt defteri/yapılandırma, en son panel');
  const guardBlock = ready.slice(ready.lastIndexOf('if (!AUTOMATION_RUN) {', guardOn), guardOn);
  assert.ok(guardBlock.indexOf('if (!AUTOMATION_RUN) {') === 0, 'bekçi otomasyonda da açılıyor');
  assert.ok(ready.indexOf('settingsGuard.remember(startupSettings);') > 0, 'bekçi açılış içeriğini öğrenmiyor');
});

test('bekçi açılıştaki içeriği yapılandırmayla AYNI okumadan öğreniyor', () => {
  const ready = body(MAIN, 'app.whenReady().then(async () => {');
  const reads = ready.match(/fs\.readFileSync\(SETTINGS_PATH\)/g) || [];
  assert.strictEqual(reads.length, 1, 'ayar dosyası açılışta birden çok kez okunuyor');
});

test('kaydetme çakışmada dosyaya yazmıyor, bekletiyor', () => {
  const fn = body(MAIN, 'function saveSettings(config) {');
  assert.match(fn, /^\{\s*if \(settingsFrozen\) return;/, 'öz testin dondurması ilk satır olmalı');
  assert.match(fn, /settingsGuard\.changed\(\) === true\) raiseSettingsConflict\(\);/);
  assert.match(fn, /if \(settingsConflict\) \{\s*pendingSettings = text;\s*return;\s*\}/);
  const write = body(MAIN, 'function writeSettingsText(text) {');
  assert.match(write, /fs\.writeFileSync\(SETTINGS_PATH, text, 'utf-8'\);\s*if \(settingsGuardOn\) settingsGuard\.remember\(text\);/,
    'yazılan içerik bekçiye bildirilmiyor — kopya kendi yazımını çakışma sanar');
});

test('çakışma kendiliğinden biterse bekleyen değişiklik yazılıyor', () => {
  const fn = body(MAIN, 'function pollSettingsGuard() {');
  assert.match(fn, /if \(changed === null\) return;/);
  assert.match(fn, /settingsConflict = null;[\s\S]*writeSettingsText\(text\);/);
});

test('"diskteki ayarları yükle" yeniden kaydetmiyor, "bunu kaydet" diskin üstüne yazıyor', () => {
  const handler = MAIN.slice(MAIN.indexOf("ipcMain.handle('settings-conflict:resolve'"));
  assert.ok(handler.length > 0);
  const end = handler.indexOf('\n});');
  const h = handler.slice(0, end);
  assert.match(h, /choice === 'keep'[\s\S]*writeSettingsText\(text\)/);
  assert.match(h, /choice === 'load'[\s\S]*SettingsGuard\.parse\(buf\)[\s\S]*settingsGuard\.remember\(buf\)[\s\S]*applyIncomingConfig\(loaded, \{ save: false \}\)[\s\S]*notifyAdmin\('external-config', loaded\)/);
  assert.match(h, /return \{ ok: false, error: 'read' \}/, 'okunamayan dosyada çakışma sürmeli');
  assert.match(MAIN, /ipcMain\.on\('update-config', \(e, config\) => applyIncomingConfig\(config\)\);/);
  assert.match(body(MAIN, 'function applyIncomingConfig(config, opts) {'), /if \(save\) saveSettings\(config\);/);
});

test('açılış sorusu yalnız uygulama kopyalarını sayıyor ve en eskisini öne istiyor', () => {
  const fn = body(MAIN, 'async function checkOtherCopies() {');
  assert.match(fn, /\.filter\(\(o\) => o\.role === 'app'\)/);
  assert.match(fn, /if \(!running\.length\) return true;/);
  assert.match(fn, /running\[0\]\.pid \+ '\.focus'/);
  assert.match(fn, /cancelId: 0/, 'Esc güvenli seçenekte olmalı: çalışan kopyaya geç');
});

test('odak isteğini yalnız uygulama kopyası karşılıyor; kapanışta kayıt siliniyor', () => {
  const tick = body(MAIN, 'function instanceTick() {');
  assert.match(tick, /if \(selfInstance\.role === 'app'\) takeFocusRequest\(\);/);
  const quit = MAIN.slice(MAIN.indexOf("app.on('will-quit'"), MAIN.indexOf("app.on('will-quit'") + 200);
  assert.ok(quit.indexOf('stopInstanceRegistry();') >= 0, 'will-quit kaydı silmiyor');
  assert.ok(quit.indexOf('stopInstanceRegistry();') < quit.indexOf('app.exit('), 'app.exit kayıt silinmeden çıkıyor');
  assert.match(MAIN, /role: SMOKE \? 'selftest' : SHOTS \? 'screenshots' : 'app',/);
});

test('öz test kendi kaydını ve bekçinin kapalı olduğunu denetliyor', () => {
  assert.match(MAIN, /errors\.push\('instance registry: the self-test did not register itself'\)/);
  assert.match(MAIN, /errors\.push\('settings guard: must stay off in the self-test'\)/);
  assert.match(MAIN, /document\.querySelectorAll\('\.banner'\)/, 'çeviri taraması üst bantlara bakmıyor');
});

test('panel köprüsü ve bantlar yerinde', () => {
  const preload = read('src/main/preload-admin.js');
  assert.match(preload, /instanceStatus: \(\) => ipcRenderer\.invoke\('instances:status'\)/);
  assert.match(preload, /onInstanceStatus: \(cb\) => ipcRenderer\.on\('instance-status'/);
  assert.match(preload, /resolveSettingsConflict: \(choice\) => ipcRenderer\.invoke\('settings-conflict:resolve', choice\)/);
  const html = read('src/admin/index.html');
  for (const id of ['copiesBanner', 'copiesList', 'copiesClose', 'conflictBanner', 'conflictError', 'conflictLoadBtn', 'conflictKeepBtn']) {
    assert.ok(html.indexOf('id="' + id + '"') > 0, id + ' yok');
  }
  const admin = strip(read('src/admin/admin.js'));
  assert.match(admin, /initInstanceBanners\(\);/);
  assert.match(admin, /resolve\('load'\)/);
  assert.match(admin, /resolve\('keep'\)/);
});

/* Bant metinleri ve satır sözcükleri İngilizce arayüzde çevriliyor mu. */
test('bantların ve kopya satırının bütün Türkçe metni sözlükte', () => {
  const src = read('src/shared/i18n.js');
  const doc = { documentElement: { lang: '' }, readyState: 'complete', title: '', body: {}, addEventListener: () => {} };
  const win = {
    navigator: { languages: ['en-US'], language: 'en-US' },
    localStorage: { getItem: () => 'en', setItem: () => {} },
    alert: () => {}, confirm: () => {}, document: doc,
    MutationObserver: function () { this.observe = () => {}; },
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
  };
  win.window = win;
  vm.runInContext(src, vm.createContext(win), { filename: 'i18n.js' });
  const t = win.SVI18n.t;

  const html = read('src/admin/index.html');
  const texts = [];
  for (const id of ['copiesBanner', 'conflictBanner']) {
    const start = html.indexOf('id="' + id + '"');
    const end = html.indexOf('<!-- ============', start);
    const chunk = html.slice(start, end > start ? end : html.indexOf('<!-- ================= ÇALIŞMA', start))
      .replace(/<!--[\s\S]*?-->/g, '');
    for (const m of chunk.matchAll(/>([^<>]*[A-Za-zçğıöşüÇĞİÖŞÜ][^<>]*)</g)) {
      const s = m[1].trim();
      if (s && /[a-zçğıöşü]/i.test(s) && s !== '⚠️') texts.push(s);
    }
  }
  const admin = read('src/admin/admin.js');
  const kinds = /const COPY_KIND = \{([^}]*)\}/.exec(admin);
  const roles = /const COPY_ROLE = \{([^}]*)\}/.exec(admin);
  assert.ok(kinds && roles, 'kopya etiketleri bulunamadı');
  for (const m of (kinds[1] + roles[1]).matchAll(/'([^']+)'/g)) texts.push(m[1]);
  texts.push('açılış');

  assert.ok(texts.length >= 12, 'beklenenden az metin toplandı: ' + texts.length);
  const missing = texts.filter((s) => t(s) === s);
  assert.deepStrictEqual(missing, [], 'çevrilmemiş: ' + JSON.stringify(missing));
});
