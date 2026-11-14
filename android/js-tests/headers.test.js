/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TELİF BAŞLIKLARI, Android tarafı. Masaüstündeki tests/copyright-headers.test.js
   yalnız src, scripts ve native klasörlerini tarıyor; android/ burada denetleniyor:
   Kotlin, Gradle betikleri, bildirim dosyaları ve araçlar. Kaynak değerleri
   (res/values/*.xml) ve Gradle sarmalayıcısının üretilmiş dosyaları dışarıda. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..', '..');

function tracked() {
  try {
    return execFileSync('git', ['ls-files', 'android'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch { return null; }
}

const WANT = /\.(kt|kts|js)$|AndroidManifest\.xml$/;
const SKIP = /^android\/(gradlew|gradle\/wrapper\/)/;

test('Android kaynaklarının hepsinde telif başlığı var', (t) => {
  const files = tracked();
  if (!files) { t.skip('git yok'); return; }
  const checked = files.filter((f) => WANT.test(f) && !SKIP.test(f));
  assert.ok(checked.length >= 15, 'beklenenden az dosya: ' + checked.length);
  const missing = [];
  for (const f of checked) {
    const head = fs.readFileSync(path.join(root, f), 'utf8').slice(0, 600);
    if (!head.includes('SPDX-License-Identifier: MIT') || !head.includes('Çağan Turgut (CaYatur)')) missing.push(f);
  }
  assert.deepStrictEqual(missing, [], 'başlığı eksik: ' + missing.join(', '));
});
