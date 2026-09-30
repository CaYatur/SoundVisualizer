'use strict';
/* AppImageUpdate desteği (#640, 3. adım): AppImage'e gömülen güncelleme
 * bilgisi, sürüme yüklenen .zsync dosyası ve uygulama içi güncelleyicinin
 * aradığı dosya adı AYNI adlandırmaya bağlı. Biri değişip ötekisi kalırsa
 * AppImageUpdate sessizce "güncelleme yok" der; burada birlikte korunuyor.
 * Betiğin kendisi Linux CI'da gerçek AppImage üzerinde koşuyor (build.yml). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const U = require('../src/main/updater.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SCRIPT = read('scripts/appimage-update-info.sh');
const INFO = /INFO='([^']+)'/.exec(SCRIPT)[1];

test('güncelleme bilgisi gh-releases-zsync biçiminde ve bu depoya işaret ediyor', () => {
  const parts = INFO.split('|');
  assert.deepStrictEqual(parts.slice(0, 4), ['gh-releases-zsync', ...U.REPO.split('/'), 'latest']);
  assert.match(parts[4], /\.AppImage\.zsync$/);
});

test('bilgideki desen, yüklenen .zsync adı ve uygulamanın aradığı AppImage adı aynı', () => {
  const version = require(path.join(ROOT, 'package.json')).version;
  const appImage = 'CAYADEV-Visualizer-' + version + '-linux-x86_64.AppImage';
  // Bilgideki joker desen gerçek adla eşleşmeli
  const glob = new RegExp('^' + INFO.split('|')[4].replace(/[.]/g, '\\.').replace(/\*/g, '.*') + '$');
  assert.match(appImage + '.zsync', glob);
  // Sürüm betiği hem AppImage'i hem .zsync'i bekliyor
  const assets = read('scripts/release-assets.js');
  assert.ok(assets.includes("'-linux-x86_64.AppImage'"), 'AppImage');
  assert.ok(assets.includes("'-linux-x86_64.AppImage.zsync'"), '.zsync');
  // Uygulama içi güncelleyici aynı dosyayı seçiyor
  assert.match(appImage, U.ASSET_PATTERNS.appimage);
  assert.doesNotMatch(appImage + '.zsync', U.ASSET_PATTERNS.appimage, '.zsync AppImage sanılmamalı');
});

test('Linux CI adımı betiği koşuyor ve .zsync dosyasını topluyor; betik sessizce geçmiyor', () => {
  const wf = read('.github/workflows/build.yml');
  assert.match(wf, /run: bash scripts\/appimage-update-info\.sh/);
  assert.match(wf, /-name '\*\.AppImage\.zsync'/);
  assert.match(wf, /apt-get install -y zsync/);
  assert.match(SCRIPT, /set -euo pipefail/);
  assert.match(SCRIPT, /\.upd_info/);
  assert.match(SCRIPT, /zsyncmake -u/);
  assert.ok(!/\r/.test(SCRIPT.split('\n')[0]) || process.platform === 'win32', 'betik LF olmalı');
});
