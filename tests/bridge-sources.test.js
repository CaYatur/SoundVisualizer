'use strict';
/* SES KÖPRÜSÜ, BİRDEN ÇOK KAYNAK (#813). Köprü kendi seçicisini değil,
   uygulamanın Ses Kaynakları sistemini kullanıyor: aynı parça (aktif
   kaynaklar + uygulama sesi + canlı ölçerler + Aygıtları Yenile), aynı
   yakalama yardımcısı ve aynı karışım. Liste köprünün ayar klasöründe. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const B = require('../src/main/audio-bridge.js');
const NA = require('../src/main/native-audio.js');

// Düz DOM taklidi: ortak seçiciyi Node'da çizmek için
function fakeDom() {
  const node = (tag) => ({
    tag, attrs: {}, style: {}, children: [], listeners: {}, checked: false,
    set textContent(v) { this.attrs.text = String(v); }, get textContent() { return this.attrs.text || ''; },
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.listeners[t] = f; },
    appendChild(c) { this.children.push(c); return c; },
  });
  const el = (tag, props, kids) => {
    const n = node(tag);
    for (const [k, v] of Object.entries(props || {})) { if (k === 'text') n.attrs.text = v; else n.attrs[k] = v; }
    for (const c of kids || []) if (c) n.children.push(c);
    return n;
  };
  return { el };
}
function load() {
  global.window = { SVAppAudio: require('../src/shared/app-audio.js') };
  delete require.cache[require.resolve('../src/admin/audio-sources.js')];
  require('../src/admin/audio-sources.js');
  return global.window.SVAudioSources;
}
const walk = (n, f) => { if (!n) return; f(n); (n.children || []).forEach((c) => walk(c, f)); };

test('ortak seçici: aygıtlar ve uygulamalar birlikte seçilir; en az bir kaynak kalır', () => {
  const S = load();
  const { el } = fakeDom();
  let list = ['default'];
  const def = {
    label: 'Aktif Kaynaklar',
    devices: () => [{ name: 'G733 Headset', kind: 'output' }, { name: 'USB Mic', kind: 'input' }],
    apps: () => [{ match: 'spotify.exe', label: 'Spotify', audible: true, count: 1 }],
    appStatus: () => ({ available: true }),
  };
  const draw = () => S.control(def, { el, tr: (t) => t, get: () => list, set: (a) => { list = a; } });
  const boxes = () => { const out = []; walk(draw(), (n) => { if (n.tag === 'input' && n.attrs.type === 'checkbox') out.push(n); }); return out; };
  let b = boxes();
  assert.strictEqual(b.length, 4, 'varsayılan + 2 aygıt + 1 uygulama');
  b[1].listeners.change(); // G733 eklendi
  b = boxes(); b[2].listeners.change(); // mikrofon
  b = boxes(); b[3].listeners.change(); // Spotify
  assert.strictEqual(list.length, 4);
  assert.deepStrictEqual(list.slice(0, 3), ['default', 'G733 Headset', 'USB Mic']);
  assert.strictEqual(list[3].kind, 'app');
  assert.strictEqual(list[3].mode, 'include');
  // Hepsi kaldırılırsa varsayılan çıkış kalır (tek kaynak, eskisi gibi)
  list = ['USB Mic'];
  b = boxes(); b[2].listeners.change();
  assert.deepStrictEqual(list, ['default']);
  delete global.window;
});

test('ortak seçici: uygulama yakalama yoksa nedeni yazılıyor; macOS izni istenebiliyor', () => {
  const S = load();
  const { el } = fakeDom();
  const texts = [];
  let asked = 0;
  const n = S.control({ label: 'x', devices: () => [], apps: () => [], appStatus: () => ({ available: false, message: 'İzin yok', canRequest: true }) },
    { el, tr: (t) => t, get: () => ['default'], set() {}, requestPermission: () => { asked++; } });
  let btn = null;
  walk(n, (x) => { if (x.attrs.text) texts.push(x.attrs.text); if (x.tag === 'button') btn = x; });
  assert.ok(texts.includes('İzin yok'));
  btn.listeners.click();
  assert.strictEqual(asked, 1);
  delete global.window;
});

test('panel ve köprü penceresi aynı parçayı kullanıyor', () => {
  const admin = read('src/admin/admin.js');
  assert.match(admin, /function multisourceCtrl\(def\) \{\n    return window\.SVAudioSources\.control\(def, \{/);
  assert.match(admin, /audioSources: \(\) => el\('div', \{ class: 'br-sources' \}, \[buildControl\(audioSourcesDef\(\)\), buildControl\(AUDIO_REFRESH_DEF\)\]\),/);
  // Ses Kaynakları kartı da aynı tanımı kullanıyor
  assert.match(admin, /audioSourcesDef\(\),\n\s+AUDIO_REFRESH_DEF,/);
  const idx = read('src/admin/index.html');
  assert.ok(idx.indexOf('audio-sources.js') > 0 && idx.indexOf('audio-sources.js') < idx.indexOf('src="admin.js"'));
  const bs = read('src/bridge-status/index.html');
  for (const f of ['../shared/icons.js', '../shared/app-audio.js', '../admin/audio-sources.js']) assert.ok(bs.includes(f), f);
  const st = read('src/bridge-status/status.js');
  assert.match(st, /S\.control\(\{\n\s+label: 'Aktif Kaynaklar',/);
  assert.match(st, /text: 'Aygıtları Yenile', onclick: \(\) => refresh\(\)/);
  assert.match(st, /await W\.setSources\(list\)/);
  // Eski tek seçimli köprü kaynağı kalmadı
  assert.ok(!/captureSourceRow/.test(read('src/admin/bridge-panel.js')));
  assert.ok(!/bridge-win:set-source'/.test(read('src/main/main.js')));
  assert.match(read('src/admin/bridge-panel.js'), /if \(sending && P\(\)\.audioSources\) \{/);
});

test('kaynak listesi: aygıt ve uygulama karışık, yinelenen yok, boşsa varsayılan', () => {
  assert.deepStrictEqual(B.sanitizeSources([]), ['default']);
  assert.deepStrictEqual(B.sanitizeSources(null), ['default']);
  const r = B.sanitizeSources(['Mic', 'Mic', '', 7, {}, { kind: 'app', match: 'C:\\Apps\\Spotify.exe', label: 'Spotify' }, { kind: 'app', match: 'spotify.exe' }]);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0], 'Mic');
  assert.strictEqual(r[1].kind, 'app');
  assert.strictEqual(B.sanitizeSources(Array.from({ length: 40 }, (_, i) => 'D' + i)).length, 16);
  // Ana süreç aynı süzgeçten geçiriyor; yalnız köprüde liste köprünün klasöründe
  const M = read('src/main/main.js');
  assert.match(M, /ipcMain\.handle\('bridge-win:set-sources', \(e, list\) => \{\n[^\n]*\n  const next = audioBridge\.sanitizeSources\(list\);\n  applyConfigPatch\(\{ audio: Object\.assign\(\{\}, currentConfig\.audio \|\| \{\}, \{ sources: next \}\) \}\);/);
});

test('kaynak başına durum: biri düşünce ötekiler sürer, hangisi düştüğü bildirilir', () => {
  const r = NA.splitSourceLines('CAPTURE-START A + B\nSRC {"key":"USB Mic","state":"missing"}\r\nSRC {"key":"app:spotify.exe","state":"waiting"}\nSRC {bozuk\nAPP-NOT-RUNNING spotify.exe');
  assert.deepStrictEqual(r.sources.map((x) => [x.key, x.state]), [['USB Mic', 'missing'], ['app:spotify.exe', 'waiting']]);
  assert.match(r.rest, /^CAPTURE-START A \+ B\nSRC \{bozuk\nAPP-NOT-RUNNING spotify\.exe$/);
  const H = read('src/main/loopback-helper.js');
  assert.match(H, /'SRC ' \+ JSON\.stringify\(\{ key: name, state: 'missing' \}\)/);
  assert.match(H, /state: 'failed', message:/);
  assert.match(H, /key: 'app:' \+ appAudio\.baseName\(app\.match\), state: 'ok'/);
  const M = read('src/main/main.js');
  assert.match(M, /if \(status && status\.type === 'source'\) \{\n\s+bridge\.sourceStates\[status\.key\] = \{ state: status\.state, message: status\.message \};/);
  assert.match(M, /bridge\.sourceStates = \{\};\n  nativeAudio\.startCapture\(/);
});

test('uygulama ölçerleri durum penceresine de gidiyor; izin aynı yoldan', () => {
  const M = read('src/main/main.js');
  assert.match(M, /bridgeWin\.webContents\.send\('bridge-win:app-levels', payload\)/);
  assert.match(M, /appMeters\.setWanted\(!quitting && \(\(adminWantsAppMeters && visible\) \|\| bw\)\);/);
  assert.match(M, /ipcMain\.handle\('app-audio:request-permission', \(\) => requestAppAudioPermission\(\)\);/);
  const P = read('src/main/preload-bridge-status.js');
  for (const k of ['setSources', 'appStatus', 'appList', 'requestPermission', 'appMeters', 'onAppLevels']) assert.ok(P.includes(k + ':'), k);
});

test('TR/EN: yeni metinlerin İngilizcesi var', () => {
  const I = read('src/shared/i18n.js');
  for (const k of ['Kaynaklar', 'Köprünün Kaynakları', 'bulunamadı; öteki kaynaklar sürüyor', 'açılamadı; öteki kaynaklar sürüyor', 'çalışmıyor; açılınca kendiliğinden bağlanır',
    'Köprü, burada seçilen kaynakların karışımını gönderir; Ses Kaynakları kartıyla aynı liste.',
    'Seçilen kaynakların hepsi tek akışta karıştırılır ve köprü o karışımı gönderir. Değişiklik köprüyü kesmez.']) {
    assert.ok(I.includes("'" + k + "':"), k);
  }
  assert.match(read('package.json'), /"bridge-sources-rig": "node scripts\/bridge-sources-rig\.js"/);
});

test('desteklenmeyen sistem: uygulama satırı yerine neden; aygıtlar seçilebilir kalıyor', () => {
  const A = require('../src/shared/app-audio.js');
  const cases = [
    ['win32', '10.0.19041', {}, 'WIN_TOO_OLD'],
    ['darwin', '21.6.0', { helper: true, permission: true }, 'MAC_TOO_OLD'],
    ['darwin', '22.1.0', { helper: true, permission: false }, 'MAC_NO_PERMISSION'],
    ['linux', '6.1', {}, 'NO_SOUND_SERVER'],
    ['freebsd', '13', {}, 'UNSUPPORTED_PLATFORM'],
  ];
  for (const [plat, rel, opts, code] of cases) {
    const sup = A.support(plat, rel, opts);
    assert.strictEqual(sup.supported, false, plat);
    assert.strictEqual(sup.code, code, plat);
    const S = load();
    const { el } = fakeDom();
    const n = S.control({ label: 'x', devices: () => [{ name: 'Mic', kind: 'input' }], apps: () => [{ match: 'a.exe', label: 'A' }], appStatus: () => ({ available: false, code: sup.code, message: sup.message, canRequest: sup.canRequest }) },
      { el, tr: (t) => t, get: () => ['default'], set() {} });
    const texts = []; let boxes = 0;
    walk(n, (x) => { if (x.attrs.text) texts.push(x.attrs.text); if (x.tag === 'input') boxes++; });
    assert.ok(texts.includes(sup.message), code);
    assert.strictEqual(boxes, 2, code + ': varsayılan + aygıt; uygulama satırı yok');
    delete global.window;
  }
  // Ana süreç: uygulama seçili ama yakalama yoksa aygıtlarla sürer (çökmez)
  assert.match(read('src/main/main.js'), /const devs = list\.filter\(\(x\) => typeof x === 'string'\);\n\s+return devs\.length \? devs : \['default'\];/);
});

test('Ses Köprüsü kartı Ses kategorisinde, Ses Kaynakları’nın altında; aranabilir; Ayarlar’dan bağlantı', () => {
  const A = read('src/admin/admin.js');
  const iSrc = A.indexOf("id: 'sources',\n        category: 'audio',");
  const iBr = A.indexOf("id: 'audiobridge',\n        category: 'audio',");
  const iAn = A.indexOf("id: 'analysis',\n        category: 'audio',");
  assert.ok(iSrc > 0 && iBr > iSrc && iBr < iAn, 'Ses Kaynakları ile Ses Analizi arasında');
  assert.ok(!/id: 'audiobridge',\n\s+category: 'show'/.test(A));
  assert.match(A, /keywords: \['köprü', [^\]]*'bridge'/);
  assert.match(A, /\.concat\(e\.keywords \|\| \[\]\)/);
  assert.match(A, /type: 'sectionlink', group: 'Ses Köprüsü', category: 'audio', section: 'Ses Köprüsü'/);
  // Kart "Gelişmiş"e bağlı değil
  const blk = A.slice(iBr, A.indexOf('},', iBr));
  assert.ok(!/advanced/.test(blk));
  assert.ok(!/advanced/.test(read('src/admin/bridge-panel.js')));
  // Köprü penceresi/tepsi "Köprü Ayarlarını Aç" kartın kendisine götürür
  assert.match(read('src/main/main.js'), /const BRIDGE_CARD = \{ category: 'audio', section: 'Ses Köprüsü' \};/);
  assert.ok(read('src/main/preload-admin.js').includes("onGoto: (cb) => ipcRenderer.on('admin-goto'"));
  const I = read('src/shared/i18n.js');
  for (const k of ['Ses Köprüsü Ayarlarını Aç', 'Ses köprüsü Ses kategorisinde, Ses Kaynakları kartının altında.']) assert.ok(I.includes("'" + k + "':"), k);
});
