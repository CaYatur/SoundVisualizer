'use strict';
/* v3.1.4 → main denetiminin (#695) kesin bulguları.

   - Görselleştirici MCP preset yoklaması 400 ms'de bir preset klasörünü
     ana süreçte baştan okutuyordu; panel 3 sn'ye inmişti, bu kalmıştı.
   - İngilizce arayüzde Türkçe kalan beş metin.
   - Logo kütüphanesi küçük resim zamanlayıcısı kütüphane boşken hiç
     durmuyordu.
   - Donanım video çözme tercihi BOM'lu settings.json'da yok sayılıyordu.
   - main.js'te okunmayan HW_VIDEO_DECODE sabiti. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('görselleştirici preset yoklaması panelle aynı: 3 sn ve gizliyken yok', () => {
  const V = read('src/visualizer/visualizer.js');
  assert.match(V, /const MCP_PRESET_POLL_MS = 3000;/);
  assert.match(V, /cfg\.mcp\.enabled && !document\.hidden\) catchPresets\(\);\s*\}, MCP_PRESET_POLL_MS\);/);
  assert.ok(!/catchPresets\(\);\s*\}, 400\);/.test(V), '400 ms yoklama kalmamalı');
});

function loadEnglish() {
  const doc = {
    documentElement: { lang: '' }, readyState: 'complete', title: '', body: {},
    addEventListener: () => {},
  };
  const win = {
    navigator: { languages: ['en-US'], language: 'en-US' },
    localStorage: { getItem: () => 'en', setItem: () => {} },
    alert: () => {}, confirm: () => {}, document: doc,
    MutationObserver: function () { this.observe = () => {}; },
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
  };
  win.window = win;
  vm.runInContext(read('src/shared/i18n.js'), vm.createContext(win), { filename: 'i18n.js' });
  return win.SVI18n;
}

test('İngilizce arayüzde Türkçe kalan metinlerin karşılığı var', () => {
  const i18n = loadEnglish();
  const cases = [
    ['Her LED, görselleştiricide aynı konuma denk gelen barın renk ve yüksekliğini izler.', 'src/admin/lighting-general.js'],
    ['Görüntü süreci kapandı. Dışa aktarma durduruldu.', 'src/main/main.js'],
    ['Dinamik renk teması yalnızca Windows’ta kullanılabilir.', 'src/admin/admin.js'],
    ['Üstte', 'src/admin/nowplaying-panel.js'],
  ];
  for (const [tr, file] of cases) {
    assert.ok(read(file).includes(tr), file + ' metni değişti: ' + tr);
    const en = i18n.t(tr);
    assert.notStrictEqual(en, tr, 'çevrilmedi: ' + tr);
    assert.ok(!/[çğıöşüÇĞİÖŞÜ]/.test(en), 'çeviride Türkçe harf: ' + en);
  }
  // Görselleştirici hata kutusu: önek kalıpla, gerekçe sözlükle
  assert.ok(read('src/visualizer/visualizer.js').includes("showError('Başlatılamadı: pencere köprüsü yok')"));
  assert.strictEqual(i18n.t('Başlatılamadı: pencere köprüsü yok'), 'Could not start: window bridge missing');
});

test('logo kütüphanesi zamanlayıcısı boş kütüphanede de durur ve sınırlıdır', () => {
  const S = read('src/admin/logo-lib-ui.js');
  const at = S.indexOf('paint._blobTimer = setInterval(');
  assert.ok(at > 0);
  const body = S.slice(at, S.indexOf('}, 120);', at));
  assert.match(body, /if \(\+\+ticks > 250\) \{\s*clearInterval\(paint\._blobTimer\);/);
  assert.match(body, /if \(pending === 0\) \{\s*clearInterval\(paint\._blobTimer\);/);
  assert.ok(!body.includes('items.length'), 'boş kütüphanede durmayı engelleyen koşul geri gelmiş');
});

test('donanım video çözme tercihi BOM ile kaydedilmiş ayarda da okunur', () => {
  const VD = require('../src/main/video-decode.js');
  const json = JSON.stringify({ power: { hwVideoDecode: true } });
  assert.strictEqual(VD.wantsHardwareDecode(String.fromCharCode(0xFEFF) + json), true);
  assert.strictEqual(VD.wantsHardwareDecode(json), true);
  // Kaynakta kaçışlı yazım: görünmez ham karakter düzenlemede kaybolabilir
  const src = read('src/main/video-decode.js');
  assert.ok(src.includes('.replace(/^\\uFEFF/'), 'kaçışlı BOM ifadesi yok');
  assert.ok(!src.includes(String.fromCharCode(0xFEFF)), 'kaynakta ham BOM karakteri var');
});

test('main.js okunmayan HW_VIDEO_DECODE sabitini tutmuyor', () => {
  const M = read('src/main/main.js');
  assert.ok(!/\bHW_VIDEO_DECODE\b/.test(M));
  assert.ok(M.includes("require('./video-decode').applyVideoDecodePolicy(app, SETTINGS_PATH);"));
});

test('README MCP stdio komutunun Node.js istediğini söylüyor', () => {
  assert.match(read('README.md'), /\*\*Needs Node\.js\.\*\* The stdio command runs `node`/);
  assert.match(read('README.tr.md'), /\*\*Node\.js gerekir\.\*\* stdio komutu `node` çalıştırır/);
});
