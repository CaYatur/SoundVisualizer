'use strict';
/* TAZE KÖPRÜ PROFİLİ: ayar dosyası yokken `--bridge` açılınca currentConfig
 * null kalıyor, köprü penceresinin yazan işleyicileri ({ok:false}) hiçbir
 * şeyi kaydetmiyordu: "Yeni Parola" ve port/ad değişikliği sessizce
 * kayboluyor, rozet "Parola eksik"te kalıyordu. Elektron'suz kontrol: ana
 * süreç kaynağı okunur (Xvfb'de gerçek köprüyle ayrıca doğrulandı).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const B = require('../src/main/audio-bridge');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8').replace(/\r\n/g, '\n');

function handlerBody(name) {
  const i = src.indexOf("ipcMain.handle('" + name + "'");
  assert.ok(i > 0, name + ' işleyicisi bulunamadı');
  const j = src.indexOf('\nipcMain.handle(', i + 10);
  return src.slice(i, j > 0 ? j : i + 1500);
}

test('köprü penceresi yazan işleyicileri currentConfig null iken reddetmiyor', () => {
  for (const h of ['bridge-win:set-config', 'bridge-win:set-sources']) {
    const b = handlerBody(h);
    assert.doesNotMatch(b.split('\n').slice(0, 2).join('\n'), /!currentConfig/, h + ': null yapılandırma yüzünden erken dönmemeli');
    assert.match(b, /ensureBridgeConfig\(\)/, h + ': ilk yazımda boş yapılandırma açılmalı');
  }
  assert.match(src, /function persistBridgeOnly\(on\) \{\n\s*ensureBridgeConfig\(\);/);
  assert.match(src, /function ensureBridgeConfig\(\) \{\n\s*if \(!currentConfig\) currentConfig = \{\};/);
});

test('boş yapılandırmadan gelen ilk yama normalize ile tam bir köprü ayarı üretiyor', () => {
  const n = B.normalize(Object.assign({}, undefined, { secret: B.newSecret(), port: 8800 }));
  assert.strictEqual(n.port, 8800);
  assert.ok(n.secret.length >= 16);
  assert.ok(!B.problem(Object.assign({}, n, { send: true })));
  // Parolasız taze profil hâlâ "parola eksik" diyor
  assert.strictEqual(B.problem(Object.assign({}, B.normalize(undefined), { send: true })), 'secret');
});

/* 1024 px'te Kayıt kartının düğmeleri: .row yalnız .ctrl içinde flex'ti, burada
   satır içi akıp "YouTube Küçük Resmi" düğmesinin metni kırılıyor, düğme
   öbürüne yapışıyordu (ekran görüntüsüyle doğrulandı). */
test('kayıt satırı kendi başına flex: sarar, düğmeler kırılmaz', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'studio.css'), 'utf8');
  const m = css.match(/\.rec-row \{([^}]*)\}/);
  assert.ok(m, '.rec-row kuralı yok');
  assert.match(m[1], /display:\s*flex/);
  assert.match(m[1], /flex-wrap:\s*wrap/);
  assert.match(css, /\.rec-row \.btn \{[^}]*white-space:\s*nowrap/);
});
