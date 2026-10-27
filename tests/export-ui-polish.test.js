'use strict';
/* Dışa aktarma ve arayüz düzeltmeleri: karışım kipi çevirisi, Yerleşim
 * yeniden çizimi, düzen içe aktarımı ve köprü parola rozeti. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf-8');

function loadEnglish() {
  const win = {
    navigator: { languages: ['en-US'], language: 'en-US' },
    localStorage: { getItem: () => 'en', setItem: () => {} },
    alert: () => {}, confirm: () => {},
    document: { documentElement: { lang: '' }, readyState: 'complete', title: '', body: {}, addEventListener: () => {} },
    MutationObserver: function () { this.observe = () => {}; },
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
  };
  win.window = win;
  vm.runInContext(read('src/shared/i18n.js'), vm.createContext(win), { filename: 'i18n.js' });
  return win.SVI18n;
}

test('karışım kipi "Ekran" İngilizcede Screen, ekran/monitör Display kalır', () => {
  const t = loadEnglish().t;
  assert.strictEqual(t('Ekran'), 'Display');
  assert.strictEqual(t('Ekran\u200B'), 'Screen');
  // Dört karışım listesi de ayrı anahtarı kullanıyor; Türkçede ikisi de "Ekran" görünür
  for (const f of ['src/admin/admin.js', 'src/admin/media-panel.js', 'src/admin/scene-panels.js']) {
    assert.match(read(f), /'screen'.{0,20}'Ekran\\u200B'|label: 'Ekran\\u200B'/, f);
    assert.ok(!/'screen'[^\n]{0,20}'Ekran'/.test(read(f)), f + ' eski anahtarı kullanıyor');
  }
  // Ekran bölümünün başlığı ve özeti eski anahtarda kaldı
  assert.match(read('src/admin/admin.js'), /title: 'Ekran',/);
});

test('Yerleşim seçimi paneli yeniden kuruyor; yansıma boyu yansıma 0 iken de görünür', () => {
  const admin = read('src/admin/admin.js');
  assert.match(admin, /path: 'visualizer\.position', label: 'Yerleşim', rebuild: true,/);
  const line = admin.split('\n').find((l) => l.includes("path: 'visualizer.reflectionLength'"));
  assert.ok(line && !/v\.reflection\)/.test(line), 'boy yansıma değerine bağlı değil');
});

test('düzen içe aktarımı: yeni sahnede metin öğesi ikinci bir görselleştirici katmanı olarak gelir, tekrarında çoğalmaz', () => {
  const LY = require('../src/shared/layout.js');
  const SL = require('../src/visualizer/layers.js');
  const fresh = () => ({ background: { type: 'gradient' }, visualizer: { type: 'bars' }, text: { enabled: false } });
  const src = fresh();
  SL.setStackEnabled(src, true);
  src.layers.push(SL.normalizeLayer(SL.makeTextLayer({ source: 'static', text: 'Merhaba' })));
  const file = LY.exportLayout(SL.resolve(src), src, {});
  assert.deepStrictEqual(file.elements.map((e) => e.kind), ['bars', 'text']);

  const cfg = fresh();
  SL.setStackEnabled(cfg, true);
  const make = (s) => SL.normalizeLayer(s);
  const r = LY.importLayout(cfg, JSON.parse(JSON.stringify(file)), make);
  assert.deepStrictEqual(r, { ok: true, updated: 1, added: 1, skipped: 0 });
  // Metin ayrı bir tür değil, görselleştirici katmanının alt türü: [arkaplan, bars, text]
  assert.deepStrictEqual(cfg.layers.map((l) => l.kind + ':' + l.type), ['background:gradient', 'visualizer:bars', 'visualizer:text']);
  const again = LY.importLayout(cfg, JSON.parse(JSON.stringify(file)), make);
  assert.deepStrictEqual(again, { ok: true, updated: 2, added: 0, skipped: 0 });
  assert.strictEqual(cfg.layers.length, 3);
});

test('köprü uygulaması: parola yokken durum "eksik" bildirir (rozet Başlıyor\'da kalmaz)', () => {
  const main = read('src/main/main.js');
  assert.match(main, /problem: audioBridge\.problem\(Object\.assign\(\{\}, c, \{ send: c\.send \|\| BRIDGE_ONLY \}\)\), wire/);
  const B = require('../src/main/audio-bridge.js');
  // Köprü kipinde ayar send:false olsa da gönderen sayılır
  assert.strictEqual(B.problem({ send: false, receive: false, secret: '' }), '');
  assert.strictEqual(B.problem({ send: true, receive: false, secret: '' }), 'secret');
});
