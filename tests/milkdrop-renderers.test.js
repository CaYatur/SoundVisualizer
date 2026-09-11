'use strict';
/* MilkDrop çizen HER pencere motorun bütün parçalarını yüklüyor.
 *
 * Motor dört ayrı HTML'de çalışıyor — görselleştirici, panel önizlemesi,
 * video dışa aktarıcı ve OBS kaplaması — ve betikler elle <script> ile
 * ekleniyor. Biri eksik kalınca mod `new window.SVMilkdropAudio.MilkdropAudio()`
 * satırında her karede istisna atıyor. Web kaplamasında bu yaşandı ve
 * düzeltildi; dışa aktarıcıda aynısı DURUYORDU: ses, HLSL ve shader
 * parçaları yoktu. Ölçüldü: MilkDrop'lu sahnenin videosu 0 BAYT çıkıyordu,
 * aynı koşuda öteki iki sahne 1.607 KB ve 125 KB. Öz testin artık bir
 * MilkDrop dışa aktarma durumu var; bu test aynı şeyi GPU'suz ve her
 * koşuda sınıyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');

const NEED = ['milkdrop.js', 'milkdrop-audio.js', 'milkdrop-hlsl.js',
  'milkdrop-shader.js'];
const PAGES = ['src/visualizer/index.html', 'src/admin/index.html',
  'src/exporter/index.html', 'src/web/overlay.html'];

test('MilkDrop çizen her pencere motorun bütün parçalarını yüklüyor', () => {
  for (const p of PAGES) {
    const h = read(p);
    assert.match(h, /modes\/milkdrop\.js"/, p + ' MilkDrop modunu yüklemiyor');
    const got = new Set();
    const re = /shared\/(milkdrop[a-z-]*\.js)"/g;
    let m;
    while ((m = re.exec(h))) got.add(m[1]);
    for (const n of NEED) assert.ok(got.has(n), p + ' → ' + n + ' eksik');
  }
});
