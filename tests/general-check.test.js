'use strict';
/* v3.1.5 öncesi genel kontrolde bulunan hatalar (#695). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

/* Pencere çubuğundaki kilit ayarı değiştiriyor ama kaydetmiyordu; panel
   dış ayarı geri göndermediği için kilit sonraki açılışta kayboluyordu. */
test('pencere çubuğundaki konum kilidi kaydediliyor', () => {
  const M = read('src/main/main.js');
  const at = M.indexOf("ipcMain.on('visualizer:geometry-lock'");
  assert.ok(at > 0);
  const h = M.slice(at, M.indexOf('\n});', at));
  assert.match(h, /if \(!currentConfig\) return;/);
  assert.match(h, /geometryLock: !!locked/);
  assert.match(h, /saveSettings\(currentConfig\);/);
  assert.match(h, /notifyAdmin\('external-config', currentConfig\);/);
});

/* Işık kategorisinin açıklaması her platformda yalnız Windows Dynamic
   Lighting'i anıyordu; kategoride OpenRGB ve Art-Net de var, macOS ve
   Linux'ta Dynamic Lighting kartı hiç yok. */
test('ışık kategorisinin açıklaması platforma bağlı değil ve çevrili', () => {
  const A = read('src/admin/admin.js');
  const m = A.match(/id: 'lighting', icon: 'bulb', title: 'Işık',\s*desc: '((?:[^'\\]|\\.)*)'/);
  assert.ok(m, 'ışık kategorisi');
  const desc = m[1].replace(/\\'/g, "'");
  assert.ok(!desc.startsWith('Windows'), desc);
  assert.match(desc, /OpenRGB/);
  assert.match(desc, /Art-Net/);
  const I = read('src/shared/i18n.js');
  assert.ok(I.includes("'" + m[1] + "': 'Drive RGB devices"), 'İngilizcesi yok');
});

/* MCP sunucusu initialize yanıtında elle yazılmış '3.1.5-beta' veriyordu. */
test('MCP sunucu sürümü paketten geliyor', async () => {
  const mcp = require('../src/shared/mcp.js');
  const pkg = JSON.parse(read('package.json'));
  const out = await mcp.handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }, {});
  assert.strictEqual(out.result.serverInfo.version, pkg.version);
  assert.ok(!/version: '\d+\.\d+\.\d+/.test(read('src/shared/mcp.js')), 'sürüm elle yazılmamalı');
});

/* Konum kilidi açıkken F11 ile tam ekrana dönen pencere ekranı kaplamıyordu
   (1280×1024 ekranda 1294×983): Electron boyutlanamaz pencereyi tam ekrana
   doğru alamıyor. F11 ana süreçte ele alınıyor; tam ekrana girmeden kilit
   kalkıyor, pencereye dönünce geri geliyor. Gerçek tuşla doğrulandı. */
test('F11 kilitli pencereyi tam ekrana alırken önce kilidi kaldırır', () => {
  const M = read('src/main/main.js');
  const at = M.indexOf("if (key === 'f11'");
  assert.ok(at > 0, 'F11 işleyicisi');
  const h = M.slice(at, M.indexOf('if (isEsc)', at));
  assert.match(h, /win\.isFullScreenable\(\)/);
  assert.match(h, /event\.preventDefault\(\);/);
  assert.ok(h.indexOf('win.setResizable(true)') < h.indexOf('win.setFullScreen(true)'), 'kilit önce kalkmalı');
  assert.ok(h.indexOf('win.setMovable(true)') < h.indexOf('win.setFullScreen(true)'));
  // Pencereye dönüşte ekranı birebir kaplıyorsa çalışma alanına sığar
  assert.match(M, /fitWindowedToWorkArea\(win\);/);
  assert.match(M, /function fitWindowedToWorkArea\(win\)/);
});

/* Metin katmanı söz belgesini her 17. harften çıkan bir özetle önbelleğe
   alıyordu. Aynı uzunlukta tek rakamlık bir zaman düzeltmesi
   ([00:12.34] → [00:12.35]) 18 denemenin 17'sinde fark edilmiyor, ekran
   eski zamanlamayla çiziyordu. */
test('söz düzenlemesi aynı uzunlukta olsa da yeniden okunur', () => {
  global.window = global.window || {};
  require('../src/shared/defaults.js');
  require('../src/shared/lyrics.js');
  require('../src/visualizer/modes/text.js');
  const TextMode = global.window.SVModes.text;
  const m = new TextMode({ width: 800, height: 600, getContext: () => ({}) });
  const a = '[00:01.00]Birinci satır\n[00:12.34]İkinci satır\n[00:20.00]Üçüncü';
  let missed = 0;
  let total = 0;
  for (let pos = 0; pos < a.length; pos++) {
    if (!/[0-9]/.test(a[pos])) continue;
    const b = a.slice(0, pos) + (a[pos] === '9' ? '8' : String(+a[pos] + 1)) + a.slice(pos + 1);
    m._ensureLyrics({ lyricsSource: a });
    const before = m.doc;
    m._ensureLyrics({ lyricsSource: b });
    total++;
    if (m.doc === before) missed++;
  }
  assert.ok(total > 10);
  assert.strictEqual(missed, 0, total + ' düzeltmenin ' + missed + ' tanesi kaçtı');
  // Değişmeyen metin yeniden ayrıştırılmaz
  m._ensureLyrics({ lyricsSource: a });
  const d = m.doc;
  m._ensureLyrics({ lyricsSource: a });
  assert.strictEqual(m.doc, d);
});

/* Kitaplık imzası metnin yalnız uzunluğuna bakıyordu. Söz düzenleyicide
   aynı uzunlukta yapılan bir zaman düzeltmesi kaydediliyor ama ekranlar
   eski metinle kalıyordu. */
test('kitaplıkta aynı uzunlukta söz düzeltmesi ekranlara ulaşır', () => {
  global.window = global.window || {};
  const S = require('../src/shared/lyrics-sync.js');
  const item = (text) => [{ id: 'a1', artist: 'Sanatçı', title: 'Parça', text }];
  const a = '[00:01.00]Bir\n[00:12.34]İki';
  const b = '[00:01.00]Bir\n[00:12.35]İki';
  assert.strictEqual(a.length, b.length);
  assert.notStrictEqual(S.librarySig(item(a)), S.librarySig(item(b)));
  assert.strictEqual(S.librarySig(item(a)), S.librarySig(item(a)));

  let push = null;
  const seen = [];
  delete global.window.SVLyricsLib;
  S.installLibrary({ onLyricsLib: (cb) => { push = cb; } }, (items) => seen.push(items[0].text));
  push(item(a));
  push(item(a));
  push(item(b));
  assert.deepStrictEqual(seen, [a, b]);
  delete global.window.SVLyricsLib;
});

/* Kumandanın yazdığı sayılar aralık denetiminden geçmiyordu:
   power.fpsCap = 0.01 görüntüyü ~100 sn'de bir kareye düşürüyordu. */
test('kumandadan gelen sayılar güvenli aralığa çekilir', () => {
  const M = read('src/main/main.js');
  const a = M.indexOf('const REMOTE_RANGES = {');
  const b = M.indexOf('function remotePathAllowed(p)');
  assert.ok(a > 0 && b > a);
  const vm = require('vm');
  const ctx = { Number, Math };
  vm.createContext(ctx);
  vm.runInContext(M.slice(a, b) + '\nthis.f = remoteNumber;', ctx);
  const f = ctx.f;
  assert.strictEqual(f('power.fpsCap', 0), 0, '0 = ekranla eşitle');
  assert.strictEqual(f('power.fpsCap', 0.01), 10);
  assert.strictEqual(f('power.fpsCap', 60), 60);
  assert.strictEqual(f('power.fpsCap', -5), 0);
  assert.strictEqual(f('audio.smoothing', 1.5), 0.99);
  assert.strictEqual(f('logo.opacity', 7), 1);
  assert.strictEqual(f('audio.sensitivity', Infinity), undefined);
  assert.strictEqual(f('visualizer.speed', 123), 123, 'tablo dışı yola dokunulmaz');
  assert.strictEqual(f('power.fpsCap', true), true, 'sayı olmayan değer olduğu gibi');
  const set = M.slice(M.indexOf("if (!remotePathAllowed(msg.path)) return;"), M.indexOf("} else {", M.indexOf("if (!remotePathAllowed(msg.path)) return;")));
  // setRemotePath: yığın açıkken katmana da yazar (tests/stack-global-controls.test.js)
  assert.match(set, /const safe = remoteNumber\(msg\.path, v\);\s*if \(safe === undefined\) return;\s*setRemotePath\(currentConfig, msg\.path, safe\);/);
});

/* Söz kitaplığında "Kaldır" onaysız siliyordu. Düzenleyicideki zaman
   düzeltmeleri yalnız kitaplık kopyasında durduğu için geri gelmiyordu. */
test('söz kitaplığından kaldırma onay ister ve bekleyen güncellemeyi iptal eder', () => {
  const U = read('src/admin/lyrics-lib-ui.js');
  const at = U.indexOf("text: 'Kaldır'");
  assert.ok(at > 0);
  const h = U.slice(at, U.indexOf('rerender();', at));
  assert.match(h, /P\(\)\.confirm\(/);
  assert.match(h, /if \(!ok\) return;/);
  assert.ok(h.indexOf('clearTimeout(prev.timer)') < h.indexOf('lyricsLibRemove(it.id)'), 'bekleyen ad güncellemesi önce iptal');
  const I = read('src/shared/i18n.js');
  assert.ok(I.includes("'Söz kaldırılsın mı?': 'Remove these lyrics?'"));
});
