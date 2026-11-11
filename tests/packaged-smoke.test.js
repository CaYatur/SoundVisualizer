'use strict';
/* Paketli öz test betiği (#466): paketin yolu her platformda doğru bulunuyor,
   sonuç satırı ve hata maddeleri öz testin çıktısından doğru okunuyor. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { packagedExe, readResult } = require('../scripts/packaged-smoke.js');

test('paketsiz derlemenin çalıştırılabilir dosyası platforma göre', () => {
  const root = path.join('X', 'repo');
  assert.strictEqual(packagedExe(root, 'win32', 'CAYADEV Visualizer', 'soundvisualizer'), path.join(root, 'dist', 'win-unpacked', 'CAYADEV Visualizer.exe'));
  assert.strictEqual(packagedExe(root, 'linux', 'CAYADEV Visualizer', 'soundvisualizer'), path.join(root, 'dist', 'linux-unpacked', 'soundvisualizer'));
  assert.strictEqual(packagedExe(root, 'darwin', 'CAYADEV Visualizer', 'soundvisualizer'),
    path.join(root, 'dist', 'mac-arm64', 'CAYADEV Visualizer.app', 'Contents', 'MacOS', 'CAYADEV Visualizer'));
});

test('öz testin sonucu ve hata maddeleri okunuyor', () => {
  const pass = readResult('[SMOKE] tema light: 12603 yazı\n[SMOKE] RESULT: PASS\n');
  assert.strictEqual(pass.pass, true);
  assert.deepStrictEqual(pass.errors, []);
  const fail = readResult([
    '[SMOKE] RESULT: FAIL (2 error)',
    '[SMOKE]   ! ui theme light: 1 text element(s) below the contrast threshold',
    '[SMOKE]   ! autovj: no warning shown',
  ].join('\r\n'));
  assert.strictEqual(fail.pass, false);
  assert.strictEqual(fail.result, 'RESULT: FAIL (2 error)');
  assert.deepStrictEqual(fail.errors, ['ui theme light: 1 text element(s) below the contrast threshold', 'autovj: no warning shown']);
  assert.strictEqual(readResult('').pass, false, 'sonuç satırı yoksa başarısız');
  assert.strictEqual(readResult('[SMOKE] RESULT: PASSED-ish').pass, false);
});

test('paket arşivi denetimi: app.asar var, açık app klasörü yok', () => {
  const fs = require('fs');
  const os = require('os');
  const { archiveCheck } = require('../scripts/packaged-smoke.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-arc-'));
  const exe = path.join(dir, 'App.exe');
  fs.mkdirSync(path.join(dir, 'resources'));
  assert.strictEqual(archiveCheck(exe, 'win32').ok, false, 'arşiv yok');
  fs.writeFileSync(path.join(dir, 'resources', 'app.asar'), 'x');
  assert.strictEqual(archiveCheck(exe, 'win32').ok, true);
  fs.mkdirSync(path.join(dir, 'resources', 'app'));
  const r = archiveCheck(exe, 'win32');
  assert.strictEqual(r.ok, false, 'açık klasör sayfaları arşivden çıkarır');
  assert.match(r.problems[0], /açık resources\/app/);
});
