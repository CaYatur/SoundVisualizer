/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Tek paket (#905): sayfadaki betikler aynı sırayla, eksiksiz ve kaynak değişmeden girmeli.
   Yeni bir dosya 'use strict' taşımazsa bu test CI'da düşer, paketlemede değil. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { build, PAGES } = require('../scripts/bundle-pages.js');

const ROOT = path.join(__dirname, '..');
const srcs = (html) => [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);

for (const dir of PAGES) {
  test(`${dir}: paket sayfadaki betikleri sırayla, eksiksiz taşıyor`, () => {
    const html = fs.readFileSync(path.join(ROOT, dir, 'index.html'), 'utf8');
    const { scripts, bundle, page } = build(dir);
    assert.deepStrictEqual(scripts, srcs(html));
    assert.ok(scripts.length > 50);
    let at = -1;
    for (const src of scripts) {
      const code = fs.readFileSync(path.join(ROOT, dir, src), 'utf8');
      const i = bundle.indexOf(code, at + 1);
      assert.ok(i > at, 'eksik ya da sırası bozuk: ' + src);
      at = i;
    }
    assert.deepStrictEqual(srcs(page), ['bundle.gen.js']);
    assert.ok(page.indexOf('bundle.gen.js') < page.indexOf('</body>'));
  });

  test(`${dir}: paket tek betik olarak derleniyor`, () => {
    assert.doesNotThrow(() => new vm.Script(build(dir).bundle, { filename: 'bundle.gen.js' }));
  });
}

test('paket dosyaları depoya girmez, paketleme komutları üretir', () => {
  assert.match(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8'), /src\/visualizer\/\*\.gen\.\*/);
  const { scripts } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const name of ['dist:win', 'dist:linux', 'dist:mac:arm64', 'pack:dir']) {
    assert.match(scripts[name], /^node scripts\/bundle-pages\.js && /, name);
  }
});

test('geliştirmede paket kullanılmaz: bayat dosya yüklenmesin', () => {
  const main = fs.readFileSync(path.join(ROOT, 'src/main/main.js'), 'utf8');
  assert.match(main, /app\.isPackaged \|\| process\.env\.SV_BUNDLED/);
});
