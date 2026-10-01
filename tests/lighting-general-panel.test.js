'use strict';
/* Genel Işık Ayarları paneli: her zaman görünür ortak görünüm + backend etiketleri. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');

test('genel ışık kartı kategorinin en altında ve betik yükleniyor', () => {
  const admin = read('src/admin/admin.js');
  const i = admin.indexOf("id: 'lightingGeneral'");
  assert.ok(i > 0, 'lightingGeneral kartı yok');
  const artnet = admin.indexOf("id: 'artnet'");
  assert.ok(artnet > 0 && artnet < i, 'Genel Işık Ayarları artnet\'ten sonra olmalı');
  assert.match(admin, /case 'lightinggeneralpanel':/);
  assert.match(admin, /Genel Işık Ayarları/);

  const html = read('src/admin/index.html');
  assert.ok(html.indexOf('lighting-general.js') > html.indexOf('openrgb-panel.js'),
    'lighting-general openrgb\'den sonra yüklenmeli');
});

test('genel ışık paneli backend etiketlerini kod yollarına göre koyuyor', () => {
  const src = read('src/admin/lighting-general.js');
  assert.match(src, /lighting-backend-tag/);
  assert.match(src, /Windows Dynamic Lighting/);
  assert.match(src, /OpenRGB/);
  // brightness / updateRate yalnız WDL
  assert.match(src, /rangeRow\('brightness'[\s\S]*?\[WDL\]/);
  assert.match(src, /rangeRow\('updateRate'[\s\S]*?\[WDL\]/);
  // ortak dinamik ayarlar WDL+OpenRGB
  assert.match(src, /rangeRow\('intensity'[\s\S]*?\[WDL,\s*ORGB\]/);
  assert.match(src, /rangeRow\('smoothing'[\s\S]*?\[WDL,\s*ORGB\]/);
  // Art-Net açıklamada geçebilir ama backend etiketi olarak yok
  assert.doesNotMatch(src, /lighting-backend-tag'[\s\S]{0,40}Art-Net/);
  assert.match(src, /Art-Net kendi kart/);
  // statik moda WDL-only uyarısı
  assert.match(src, /Statik modlar/);
});

test('WDL kartı ortak görünümü genel karta bırakıyor', () => {
  const admin = read('src/admin/admin.js');
  const start = admin.indexOf('function lightingPanelCtrl');
  const end = admin.indexOf('Dinamik / Olay Temelli', start);
  const block = admin.slice(start, end);
  assert.match(block, /Genel Işık Ayarları kartında/);
  // Eski eşit-sütun görünüm bloğu (intensity vs.) WDL panelinde tekrarlanmamalı
  assert.doesNotMatch(block, /rangeRow\('intensity'/);
  assert.doesNotMatch(block, /rangeRow\('smoothing'/);
});

test('genel ışık i18n ve stiller', () => {
  const i18n = read('src/shared/i18n.js');
  assert.match(i18n, /'Genel Işık Ayarları':\s*'General Light Settings'/);
  const css = read('src/admin/admin.css');
  assert.match(css, /\.lighting-backends/);
  assert.match(css, /\.lighting-backend-tag/);
  assert.match(css, /\.lighting-general-banner/);
});

test('genel ışık kartı lighting kökünü sıfırlama için bildiriyor', () => {
  const admin = read('src/admin/admin.js');
  const start = admin.search(/id: 'lightingGeneral'/);
  assert.ok(start > 0);
  const slice = admin.slice(start, start + 500);
  assert.match(slice, /roots:\s*\['lighting'\]/);
  assert.doesNotMatch(admin, /if \(sec\.id === 'lighting'\) out\.push\('lighting'\)/);
});

test('WDL kartı yalnız WDL-özel alanları sıfırlar', () => {
  const admin = read('src/admin/admin.js');
  const start = admin.search(/id: 'lighting',\s*category: 'lighting'/);
  assert.ok(start > 0, 'WDL section yok');
  const slice = admin.slice(start, start + 700);
  assert.match(slice, /roots:\s*\['lighting\.enabled',\s*'lighting\.deviceColors',\s*'lighting\.deviceLedColors'\]/);
});
