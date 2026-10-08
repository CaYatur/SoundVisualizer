'use strict';
/* Ana süreçten panele gelen hata metinleri İngilizce arayüzde Türkçe
   kalıyordu: dışa aktarma, kayıt kaydetme, ses yardımcısı ve medya
   oturumu iletileri. Yerel diyaloglardaki iki metin (kaydetme süzgeci,
   ölümcül hata kutusu başlığı) panelin sözlüğünden geçmediği için
   trUi ile seçiliyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

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

const TR = /[çğıöşüÇĞİÖŞÜ]/;

test('ana süreç hata metinlerinin İngilizcesi var', () => {
  const i18n = loadEnglish();
  // [kaynakta geçen metin, dosya, panelde görünen örnek]
  const cases = [
    ["'geçici dosya yazılamadı: '", 'src/main/main.js', 'geçici dosya yazılamadı: EACCES'],
    ["'ffmpeg başlatılamadı: '", 'src/main/main.js', 'ffmpeg başlatılamadı: spawn ENOENT'],
    ["'PNG verisi geçersiz'", 'src/main/main.js', 'PNG verisi geçersiz'],
    ["'Zaten bir dışa aktarma sürüyor.'", 'src/main/main.js', 'Zaten bir dışa aktarma sürüyor.'],
    ["'Ses dosyası bulunamadı.'", 'src/main/main.js', 'Ses dosyası bulunamadı.'],
    ["'Çıktı yolu seçilmedi.'", 'src/main/main.js', 'Çıktı yolu seçilmedi.'],
    ["'Ses dosyası okunamadı: '", 'src/main/main.js', 'Ses dosyası okunamadı: ENOENT'],
    ["'ffmpeg hatası: '", 'src/main/main.js', 'ffmpeg hatası: write EPIPE'],
    ["'Render penceresi yüklenemedi: '", 'src/main/main.js', 'Render penceresi yüklenemedi: ERR_FAILED'],
    ["'Render penceresi yüklenemedi.'", 'src/main/main.js', 'Render penceresi yüklenemedi.'],
    ["'ses yardımcısı başlatılamadı: '", 'src/main/native-audio.js', 'ses yardımcısı başlatılamadı: spawn EPERM'],
    ["'ses yardımcısı çalıştırılamadı ('", 'src/main/native-audio.js', 'ses yardımcısı çalıştırılamadı (spawn EPERM)'],
    ["'medya oturumu yanıt vermedi'", 'src/main/media-session.js', 'Sistemden okunamıyor — medya oturumu yanıt vermedi'],
    ["'medya oturumu açılamadı'", 'src/main/media-session.js', 'Sistemden okunamıyor — medya oturumu açılamadı'],
  ];
  for (const [lit, file, shown] of cases) {
    assert.ok(read(file).includes(lit), file + ' metni değişti: ' + lit);
    const en = i18n.t(shown);
    assert.notStrictEqual(en, shown, 'çevrilmedi: ' + shown);
    assert.ok(!TR.test(en), 'çeviride Türkçe harf: ' + en);
  }
  // Önekin arkasındaki sistem iletisi olduğu gibi kalır
  assert.strictEqual(i18n.t('ffmpeg başlatılamadı: spawn ENOENT'), 'Could not start ffmpeg: spawn ENOENT');
});

test('yerel diyalog metinleri dile göre seçiliyor', () => {
  const M = read('src/main/main.js');
  assert.ok(M.includes("{ name: trUi('Tüm Dosyalar', 'All Files'), extensions: ['*'] }"));
  assert.ok(M.includes("dialog.showErrorBox(trUi('Ses Görselleştirici', 'Sound Visualizer'), stack)"));
  assert.ok(!/name: 'Tüm Dosyalar'/.test(M));
});
