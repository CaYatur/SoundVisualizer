'use strict';
/* ÖZ TEST KULLANICININ AYARLARINI DEĞİŞTİRMEMELİ.
 *
 * Öz test gerçek kullanıcı klasörüyle koşuyor ve panelin kendi yolundan
 * (`SVPanel.apply()` → update-config → saveSettings) onlarca deneme
 * yapılandırması gönderiyor. Ölçüldü: `--smoke-export` eklenmiş iki
 * koşudan sonra settings.json fabrika ayarları artı deneme değerlerinden
 * ibaretti — `sc_test` diye bir sahne, bir saniyelik Otomatik VJ, dinamik
 * tema — ve kullanıcının altı katmanı, sekiz sahnesi ve efekt zinciri
 * gitmişti. Kural tek yerde: dosya açılışta okunur, kapanışta aynen geri
 * yazılır ve o andan sonra hiçbir yazım kabul edilmez. main.js Node içinde
 * koşamadığı için bağlantılar kaynak üzerinden sabitleniyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf-8');

test('ayar dosyası öz test AÇILIRKEN okunuyor', () => {
  /* Modül yüklenirken: henüz hiçbir pencere yok, hiçbir şey yazmadı. */
  assert.match(MAIN,
    /const SMOKE_SETTINGS = SMOKE && fs\.existsSync\(SETTINGS_PATH\) \? fs\.readFileSync\(SETTINGS_PATH\) : null;/);
});

test('geri yazıldıktan sonra hiçbir yazım kabul edilmiyor', () => {
  /* Kapanırken panel ya da bir sunucu yapılandırma gönderebilir; geri
     yazılmış dosyanın üstüne tekrar deneme değerleri binmemeli. */
  const fn = /function saveSettings\(config\) \{[\s\S]*?\n\}/.exec(MAIN)[0];
  assert.match(fn, /^function saveSettings\(config\) \{\s*if \(settingsFrozen\) return;/);
});

test('her çıkış yolu geri yazıyor: başarılı, başarısız, istisna', () => {
  const fq = /function failAndQuit\(code\) \{[\s\S]*?\n\}/.exec(MAIN)[0];
  assert.match(fq, /restoreSmokeSettings\(\);\s*app\.quit\(\);/, 'başarısız yol');
  assert.match(MAIN,
    /console\.log\('\[SMOKE\] RESULT: PASS'\);\s*restoreSmokeSettings\(\);\s*app\.quit\(\);/, 'başarılı yol');
  assert.match(MAIN, /runSmoke\(\)\.catch\(\(e\) => \{[\s\S]*?failAndQuit\(1\);/, 'istisna yolu');
});

test('geri yazma yalnız öz testte ve yalnız bir kez', () => {
  const fn = /function restoreSmokeSettings\(\) \{[\s\S]*?\n\}/.exec(MAIN)[0];
  assert.match(fn, /if \(!SMOKE \|\| settingsFrozen\) return;/);
  assert.match(fn, /settingsFrozen = true;/);
});
