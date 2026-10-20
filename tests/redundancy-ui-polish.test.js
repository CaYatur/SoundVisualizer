'use strict';
/* #817 birleştirme öncesi üç küçük arayüz düzeltmesi (Windows sınaması):
   paket dosya listesi video kutusunun üstüne biniyordu; gönderme onayı
   farklı öğeleri "yedekte olmayan" başlığı altında sayıyordu; otomatik
   kipte bekleme durumu kendisiyle çelişen iki cümle okuyordu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const PANEL = read('src/admin/redundancy-panel.js');
const I18N = read('src/shared/i18n.js');
const CSS = read('src/admin/admin.css');
const has = (k) => I18N.includes("'" + k.replace(/'/g, "\\'") + "':");

test('paket: video satırı kendi satırında, liste ve kutu üst üste binmiyor', () => {
  assert.match(PANEL, /class: 'chk red-pkg-media', for: 'redPkgMedia'/);
  assert.match(PANEL, /el\('ul', \{ class: 'red-diff red-pkg-files' \}\)/);
  assert.match(CSS, /\.red-pkg \{ display: flex; flex-direction: column; gap: 6px;/);
  assert.match(CSS, /\.red-pkg > \* \{ flex-shrink: 0;/);
  assert.match(CSS, /\.red-pkg-media \{ display: flex;[^}]*border-top:/);
  // Dosya türü tekil gelir ("preset"); çevrilmemiş ham ad görünmesin
  assert.match(PANEL, /PKG_KIND_TEXT = \{[^}]*preset: 'Preset', logo: 'Logo' \}/);
});

test('gönderme onayı: yedekte olmayanlar ile farklı olanlar ayrı listeleniyor', () => {
  const body = PANEL.slice(PANEL.indexOf('async function pushDiff'), PANEL.indexOf('/* YALITILMIŞ GÖSTERİ'));
  assert.match(body, /const missing = items\.filter\(\(d\) => d\.status !== 'different'\);/);
  assert.match(body, /const differing = items\.filter\(\(d\) => d\.status === 'different'\);/);
  assert.ok(body.indexOf("block('Yedekte olmayanlar:', missing)") > 0);
  assert.ok(body.indexOf("block('Yedekte farklı olanlar (yedeğin kendi sürümü kalır):', differing)") > 0);
  assert.ok(!/Yedekte olmayan şu öğeler gönderilecek/.test(PANEL + I18N), 'eski karışık başlık kalmış');
  for (const k of ['Şu öğeler gönderilecek; yedek onları ayrı alanda tutar, aynı kimlikli öğeleri değişmez.', 'Yedekte olmayanlar:', 'Yedekte farklı olanlar (yedeğin kendi sürümü kalır):']) {
    assert.ok(has(k), 'İngilizcesi yok: ' + k);
  }
});

test('otomatik kip bekletmesi: çelişkili iki cümle yerine tek, açık durum', () => {
  assert.match(PANEL, /const heldLost = status\.autoHeld && status\.state === 'lost';/);
  assert.ok(!/'Otomatik devralma bekletiliyor'/.test(PANEL + I18N), 'eski metin kalmış');
  for (const k of ['Birincil yanıt vermiyor', 'Otomatik devralma elle bırakıştan beri duraklatıldı: elle devralın ya da yeniden kurun', 'Otomatik devralma duraklatıldı (elle bırakıldı)']) {
    assert.ok(PANEL.includes("'" + k + "'"), 'panelde yok: ' + k);
    assert.ok(has(k), 'İngilizcesi yok: ' + k);
  }
  // İngilizce de "waiting for a manual takeover · on hold" demiyor
  assert.ok(!/waiting for a manual takeover · /.test(I18N));
});

test('belge sayısı: toplam (# tests), atlananlar makineden makineye değişse de tutuyor', () => {
  const T = read('scripts/test.js');
  assert.match(T, /match\(\/\^# tests \(\\d\+\)\$\/m\)/);
  assert.ok(!/# pass \(\\d\+\)/.test(T), 'geçen sayısı ortama göre değişir');
  assert.match(read('README.md'), /`pass \+ skipped` always equals this number/);
  assert.match(read('README.tr.md'), /`geçen \+ atlanan` hep bu sayıya eşittir/);
});
