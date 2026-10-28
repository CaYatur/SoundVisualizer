'use strict';
/* İngilizce arayüzde Türkçe kalan metinler (v3.1.6): web katmanı ayarları,
   formül parametre etiketleri, MilkDrop açıklamaları ve tanıları, kayıt ve
   dışa aktarma hata metinleri. Duman testi bu alanları taramıyordu
   (OPTION/INPUT atlanıyor, web katmanı satırı ve Pre-Show kurulmuyor); bu
   test kaynak metinleri doğrudan çeviri tablosundan geçirip sonucun hâlâ
   Türkçe kalmadığını doğrular. Yeni bir etiket eklenip sözlüğe girmezse
   buradaki tarama kırılır. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const TR_CHARS = /[çğıöşüÇĞİÖŞÜ]/;

function loadT(locale) {
  const doc = {
    documentElement: { lang: '' }, readyState: 'complete', title: '', body: {},
    addEventListener: () => {},
  };
  const win = {
    navigator: { languages: [locale], language: locale },
    localStorage: { getItem: () => locale, setItem: () => {} },
    alert: () => {}, confirm: () => {}, document: doc,
    MutationObserver: function () { this.observe = () => {}; },
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
  };
  win.window = win;
  vm.runInContext(read('src/shared/i18n.js'), vm.createContext(win), { filename: 'i18n.js' });
  return win.SVI18n.t;
}

const en = loadT('en');
const tr = loadT('tr');

test('İngilizce: bildirilen web katmanı metinleri çevrilir', () => {
  assert.strictEqual(en('Yeniden Yükle'), 'Reload');
  assert.strictEqual(en('Yakınlaştırma'), 'Zoom');
  for (const pct of ['%50', '%75', '%90', '%100', '%110', '%125', '%150', '%200', '%300']) {
    assert.strictEqual(en(pct), pct.slice(1) + '%', pct);
  }
});

test('İngilizce: formül parametre etiketleri çevrilir', () => {
  const expected = {
    'X Frekansı': 'X Frequency', 'Y Frekansı': 'Y Frequency', 'Ana Yarıçap': 'Major Radius',
    'Büküm': 'Twist', 'Ana Dönüş': 'Major Turns', 'İnce Dönüş': 'Minor Turns',
    'İnce Yarıçap': 'Minor Radius', 'Faz x': 'Phase x', 'Faz y': 'Phase y',
  };
  for (const [k, v] of Object.entries(expected)) assert.strictEqual(en(k), v, k);
  // Dosyadaki her p('id', 'Etiket', …) etiketi çevirideki Türkçe harflerden arınmış olmalı
  const src = read('src/shared/formulas-extra.js');
  const labels = [...src.matchAll(/\bp\('[A-Za-z0-9_]+',\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(labels.length > 20, 'etiketler bulunamadı');
  for (const label of labels) assert.ok(!TR_CHARS.test(en(label)), `"${label}" → "${en(label)}"`);
});

test('İngilizce: yerleşik MilkDrop preset açıklamaları çevrilir', () => {
  const src = read('src/shared/presets-milkdrop.js');
  const descs = [...src.matchAll(/\bMD\('[^']+',\s*'[^']*',\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(descs.length >= 5, 'açıklamalar bulunamadı');
  for (const d of descs) {
    assert.ok(!TR_CHARS.test(en(d)), `"${d}" → "${en(d)}"`);
    assert.notStrictEqual(en(d), d, d);
  }
});

test('İngilizce: kayıt/dışa aktarma/WebGL hata metinleri çevrilir', () => {
  const same = ['1:1 (Kare)', '21:9 (Sinemaskop)', '4:3 (Klasik)', 'zaten kaydediyor',
    'tuval akışı desteklenmiyor', 'MediaRecorder yok', 'GPU renk dönüştürücüsü kurulamadı (WebGL2).',
    'YUV hedefi kurulamadı', 'WebGL2 yok', 'WebGL desteklenmiyor', 'motor yok'];
  for (const s of same) {
    assert.ok(!TR_CHARS.test(en(s)) && en(s) !== s, `"${s}" → "${en(s)}"`);
  }
  assert.strictEqual(
    en('Kayıt çok kısa: kare yazılamadı (120 bayt). En az bir saniye kaydedin.'),
    'Recording too short: no frames were written (120 bytes). Record at least one second.');
});

test('İngilizce: dinamik metin kalıpları çevrilir', () => {
  assert.strictEqual(en('Miktar ← ses'), 'Amount ← audio');
  assert.strictEqual(en('Köşe / Oval (Logo)'), 'Corner / Oval (Logo)');
  assert.strictEqual(en('kanal 3'), 'channel 3');
  assert.strictEqual(en('Nota 60 · kanal 1 → 100'), 'Note 60 · channel 1 → 100');
  assert.strictEqual(en('1 preset eklendi'), '1 preset added');
  assert.strictEqual(en('12 preset eklendi (2 tanesinde derleme uyarısı var) — 3 dosya atlandı'),
    '12 presets added (2 with compile warnings) — 3 files skipped');
  assert.strictEqual(en('derleme: beklenmeyen \'}\''), 'compile: unexpected \'}\'');
  assert.strictEqual(en('beklenmeyen \'son\' (satır 4)'), 'unexpected \'end\' (line 4)');
  assert.strictEqual(en('\'sin\' 1 argüman ister, 2 verildi'), '\'sin\' takes 1 argument, 2 given');
  assert.strictEqual(en('bilinmeyen fonksiyon \'foo\' (satır 2)'), 'unknown function \'foo\' (line 2)');
  assert.strictEqual(en('2 deyim atlandı: a=1 | b=2'), '2 statements skipped: a=1 | b=2');
  assert.strictEqual(en('beklenmeyen \')\' — x = (1+2))'), 'unexpected \')\' — x = (1+2))');
});

test('Türkçe: kalıplar olduğu gibi kalır', () => {
  for (const s of ['Yeniden Yükle', 'Yakınlaştırma', '%125', 'Miktar ← ses', 'kanal 3',
    'derleme: beklenmeyen \'}\'', '1 preset eklendi']) {
    assert.strictEqual(tr(s), s);
  }
});

test('Ana süreç: web katmanı penceresi başlığı ve 401 metni dile göre seçilir', () => {
  const layer = read('src/main/layer-sources.js');
  assert.ok(/title:\s*getLocale\(\)\s*===\s*'tr'/.test(layer), 'pencere başlığı dile bağlı olmalı');
  assert.ok(!/title:\s*'Web katmanı'/.test(layer), 'sabit Türkçe başlık kalmamalı');
  const server = read('src/main/stream-server.js');
  assert.ok(!/res\.end\('Gecersiz/.test(server), '401 metni doğrudan Türkçe yazılmamalı');
  assert.ok(/Invalid or missing token/.test(server));
});
