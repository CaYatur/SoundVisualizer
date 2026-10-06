'use strict';
/* Medya katmanı videoları varsayılan olarak yazılımla çözülür.

   Donanımla çözülen video, DOM dışındaki <video> tuvale çizildiğinde
   yalnız pencere masaüstü birleştiricisinden geçerken kare üretiyordu:
   tam ekran görselleştiricide ve Spout/Syphon penceresinde saniyede 0,3
   kare ve döngü sonunda takılma (gerçek uygulamada ölçüldü; yazılım
   çözücüsüyle üçü de saniyede 60 kare). Ayrıntı: src/main/video-decode.js. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const VD = require('../src/main/video-decode.js');

function fakeApp() {
  const switches = [];
  return { switches, commandLine: { appendSwitch: (s) => switches.push(s) } };
}

test('ayar yoksa, bozuksa ya da kapalıysa donanım çözme kullanılmaz', () => {
  assert.strictEqual(VD.wantsHardwareDecode(null), false);
  assert.strictEqual(VD.wantsHardwareDecode('{bozuk'), false);
  assert.strictEqual(VD.wantsHardwareDecode('{}'), false);
  assert.strictEqual(VD.wantsHardwareDecode(JSON.stringify({ power: { hwVideoDecode: false } })), false);
  assert.strictEqual(VD.wantsHardwareDecode(JSON.stringify({ power: { hwVideoDecode: 'true' } })), false, 'yalnız gerçek true');
  assert.strictEqual(VD.wantsHardwareDecode(JSON.stringify({ power: { hwVideoDecode: true } })), true);
});

test('açılışta yazılım çözme anahtarı verilir; ayar açıksa verilmez', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svdec-'));
  const file = path.join(dir, 'settings.json');
  try {
    let app = fakeApp();
    assert.strictEqual(VD.applyVideoDecodePolicy(app, file), false, 'ilk açılış (dosya yok)');
    assert.deepStrictEqual(app.switches, ['disable-accelerated-video-decode']);

    fs.writeFileSync(file, JSON.stringify({ power: { hwVideoDecode: true } }));
    app = fakeApp();
    assert.strictEqual(VD.applyVideoDecodePolicy(app, file), true);
    assert.deepStrictEqual(app.switches, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ana süreç seçimi pencereler açılmadan, app.whenReady\'den önce yapıyor', () => {
  const M = read('src/main/main.js');
  const at = M.indexOf("require('./video-decode').applyVideoDecodePolicy(app, SETTINGS_PATH)");
  assert.ok(at > 0, 'çağrı yok');
  const ready = M.indexOf('app.whenReady()');
  assert.ok(ready > at, 'anahtar app hazır olduktan sonra verilirse Chromium uygulamaz');
});

test('varsayılan kapalı; panelde anahtar ve İngilizcesi var', () => {
  require('../src/shared/defaults.js');
  assert.strictEqual(global.window.SV.defaultConfig().power.hwVideoDecode, false);
  const A = read('src/admin/admin.js');
  assert.match(A, /type: 'toggle', path: 'power\.hwVideoDecode', label: 'Donanım Video Çözme'/);
  assert.match(A, /roots: \[[^\]]*'power\.hwVideoDecode'/);
  const I = read('src/shared/i18n.js');
  assert.ok(I.includes("'Donanım Video Çözme': 'Hardware Video Decoding',"));
  const hint = /path: 'power\.hwVideoDecode'[\s\S]*?hint: '([^']+)'/.exec(A)[1];
  assert.ok(I.includes("'" + hint + "': '"), 'ipucunun İngilizcesi yok');
});

test('çözülemeyen video (HEVC) nedeni ve çaresini söylüyor; oynatma hatası dinleniyor', () => {
  require('../src/visualizer/modes/media.js');
  const fault = global.window.SVVideoFault;
  const want = "Bu video biçimi oynatılamıyor. HEVC/H.265 ise Ayarlar → Uygulama → Donanım Video Çözme'yi açıp uygulamayı yeniden başlatın.";
  assert.strictEqual(fault({ code: 4, message: 'DEMUXER_ERROR_COULD_NOT_OPEN' }), want);
  assert.strictEqual(fault({ name: 'NotSupportedError', message: 'no supported source' }), want);
  assert.strictEqual(fault({ code: 2, message: 'ağ' }), 'Video açılamadı: ağ');
  assert.ok(read('src/shared/i18n.js').includes('"' + want + '": \''), 'İngilizcesi yok');
  const J = read('src/visualizer/modes/media.js');
  assert.match(J, /this\.video\.onerror = \(\) => \{ this\._fail\(key, this\.video\.error\); \};/);
  assert.match(J, /this\.video\.onerror = null;\s*this\.video\.pause\(\);/, 'durdururken dinleyici kalkmalı');
});

/* Uzun ileti tek satırda tuvalin dışına taşıyordu (önizlemede görüldü). */
test('tuvaldeki hata iletisi genişliğe göre satırlara bölünüyor', () => {
  require('../src/visualizer/modes/media.js');
  const wrap = global.window.SVMediaWrap;
  const ctx = { measureText: (s) => ({ width: s.length * 10 }) };
  const lines = wrap(ctx, 'bir iki üç dört beş altı yedi', 120);
  assert.ok(lines.length > 1, 'bölünmeli');
  for (const ln of lines) assert.ok(ln.length * 10 <= 120 || !ln.includes(' '), 'satır taşıyor: ' + ln);
  assert.strictEqual(lines.join(' '), 'bir iki üç dört beş altı yedi', 'sözcük kaybolmamalı');
  assert.deepStrictEqual(wrap(ctx, 'kısa', 120), ['kısa']);
});
