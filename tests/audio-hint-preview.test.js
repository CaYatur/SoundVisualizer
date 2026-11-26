'use strict';
/* "Ses alınamıyor" uyarısı çıkışta değil önizlemede.
   Çıkış pencereleri (ana ekranlar, yüzen pencere, OBS sayfası) seyirciye gider: ses kaynağı
   seçilmemişken uyarı projeksiyonda görünüyordu, panelin önizlemesinde ise hiç yoktu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n'); // Windows'ta satır sonu CRLF

test('çıkış sayfası uyarıyı göstermez', () => {
  const v = read('src/visualizer/visualizer.js');
  assert.ok(!/hint\.style\.display = 'block'/.test(v), 'çıkışta ipucu açılmıyor');
  assert.ok(!/hint\.textContent = 'Ses alınamıyor/.test(v));
});

test('önizleme uyarıyı gösterir: kaynak seçilmedi / ses gelmiyor', () => {
  const p = read('src/admin/preview.js');
  assert.match(p, /function audioHintText\(live, now\)/);
  assert.match(p, /showAudioHint\(audioHintText\(live, now\)\);/);
  assert.match(p, /sourcesOff\(\)\n\s+\? 'Ses kaynağı seçilmedi/);
  assert.match(read('src/admin/index.html'), /id="pvAudioHint"[^>]*hidden/);
  const i18n = read('src/shared/i18n.js');
  assert.ok(i18n.includes("'Ses kaynağı seçilmedi — Ses Kaynakları\\'ndan bir kaynak seçin': 'No audio source selected — choose one in Audio Sources'"));
  assert.ok(i18n.includes("'Ses alınamıyor — Ses Kaynakları\\'ndan bir aygıt seçin': 'No audio — choose a device in Audio Sources'"));
});
