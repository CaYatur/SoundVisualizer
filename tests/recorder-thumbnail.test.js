'use strict';
/* YOUTUBE KÜÇÜK RESMİ (#839): görünen kareden 1280×720 JPEG, 2 MB altında.
 * Kaynak 16:9 değilse ortadan kırpılıyor; kalite sığana dek iniyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const R = require('../src/shared/recorder.js');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf-8');
// n baytlık sahte JPEG data URL'si
const fake = (n) => 'data:image/jpeg;base64,' + Buffer.alloc(n).toString('base64');

test('boyut ve sınır YouTube\'unki: 1280×720, 2 MB', () => {
  assert.strictEqual(R.THUMB.w, 1280);
  assert.strictEqual(R.THUMB.h, 720);
  assert.strictEqual(R.THUMB.maxBytes, 2 * 1024 * 1024);
});

test('data URL bayt sayısı base64 dolgusuyla doğru', () => {
  for (const n of [0, 1, 2, 3, 1000, 2 * 1024 * 1024]) assert.strictEqual(R.dataUrlBytes(fake(n)), n);
});

test('kalite: sığan ilk değer seçiliyor, hiçbiri sığmazsa en düşüğü dönüyor', () => {
  const sizes = { 0.92: 3e6, 0.85: 2.5e6, 0.75: 1.9e6, 0.6: 1e6, 0.45: 8e5 };
  const tried = [];
  const r = R.pickJpeg((q) => { tried.push(q); return fake(sizes[q]); });
  assert.strictEqual(r.quality, 0.75);
  assert.deepStrictEqual(tried, [0.92, 0.85, 0.75], 'sığınca duruyor');
  const big = R.pickJpeg(() => fake(3e6));
  assert.strictEqual(big.quality, 0.45);
  assert.ok(big.bytes > R.THUMB.maxBytes);
});

test('16:9 olmayan kaynak ortadan kırpılıyor, bant yok', () => {
  assert.deepStrictEqual(R.coverRect(1920, 1080, 1280, 720), { x: 0, y: 0, w: 1920, h: 1080 });
  const sq = R.coverRect(1080, 1080, 1280, 720); // kare: üst ve alt kesiliyor
  assert.strictEqual(sq.w, 1080);
  assert.ok(Math.abs(sq.h - 607.5) < 1e-9 && Math.abs(sq.y - 236.25) < 1e-9);
  const tall = R.coverRect(1080, 1920, 1280, 720); // dikey: ortadan bir şerit
  assert.ok(Math.abs(tall.h - 607.5) < 1e-9 && Math.abs(tall.y - 656.25) < 1e-9);
});

test('panel düğmesi, kayıt penceresi JPEG ve çeviri', () => {
  const panel = read('src/admin/record-panel.js');
  assert.match(panel, /text: 'YouTube Küçük Resmi'/);
  assert.match(panel, /onclick: \(\) => snap\(cfg, true\)/);
  assert.match(panel, /thumb \? window\.SVRecorder\.thumbnail\(cv\) : window\.SVRecorder\.snapshot\(cv,/);
  const main = read('src/main/main.js');
  assert.match(main, /const jpeg = \/\^data:image\\\/jpeg;\/\.test\(raw\);/);
  // Çıkış penceresi varsa tam çözünürlükte ondan; önizleme yalnız yedek
  assert.match(main, /ipcMain\.handle\('thumbnail:from-output'/);
  assert.match(main, /image\.crop\(crop\)\.resize\(\{ width: R\.THUMB\.w, height: R\.THUMB\.h, quality: 'best' \}\)/);
  assert.match(read('src/main/preload-admin.js'), /thumbnailFromOutput: \(\) => ipcRenderer\.invoke\('thumbnail:from-output'\)/);
  const take = panel.indexOf('async function takeSnapshot');
  const fromOut = panel.indexOf('window.api.thumbnailFromOutput()', take);
  assert.ok(take > 0 && fromOut > take && fromOut < panel.indexOf('const src = await awaitSurface()', take), 'önce çıkış penceresi denenmeli');
  assert.match(main, /extensions: \['jpg', 'jpeg'\]/);
  const i18n = read('src/shared/i18n.js');
  for (const k of ['YouTube Küçük Resmi', 'Küçük resim kaydedildi.', 'Görünen kareden 1280×720 JPEG, 2 MB altında']) {
    assert.ok(i18n.includes("'" + k + "':"), 'çevirisi yok: ' + k);
  }
});
