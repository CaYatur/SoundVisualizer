'use strict';
/* MilkDrop sprite dosyaları (#577): milk_img.ini ve resim yolları.
 *
 * Yolu kullanıcının seçtiği ini yazıyor, ama o yolun sayfaya gitmemesi ve
 * uygulamaya ağdan ya da "geçerli sürücüden" dosya çektirmemesi gerekiyor.
 * Kurallar MilkDrop'un belgesindekiler: göreli yol ini'nin klasörüne göre,
 * tam yol sürücüsüyle; `c:logo.jpg` ve `\logo.jpg` kabul edilmiyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const F = require('../src/main/milkdrop-sprite-files.js');

const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-spr-'));
  made.push(dir);
  fs.mkdirSync(path.join(dir, 'plugins', 'resimler'), { recursive: true });
  const ini = path.join(dir, 'plugins', 'milk_img.ini');
  fs.writeFileSync(ini, '[img00]\nimg=logo.png\n');
  for (const f of ['plugins/logo.png', 'plugins/resimler/iki.jpg', 'ust.png', 'plugins/eski.tga']) {
    fs.writeFileSync(path.join(dir, f), 'x');
  }
  return { dir, ini };
}

test('göreli yol ini\'nin klasörüne göre; ters eğik çizgi ve .. geçiyor', () => {
  const { dir, ini } = tmp();
  assert.strictEqual(F.resolveImage(ini, 'logo.png').file, path.join(dir, 'plugins', 'logo.png'));
  assert.strictEqual(F.resolveImage(ini, 'resimler\\iki.jpg').file, path.join(dir, 'plugins', 'resimler', 'iki.jpg'));
  assert.strictEqual(F.resolveImage(ini, 'resimler/iki.jpg').file, path.join(dir, 'plugins', 'resimler', 'iki.jpg'));
  assert.strictEqual(F.resolveImage(ini, '..\\ust.png').file, path.join(dir, 'ust.png'));
  const r = F.resolveImage(ini, 'logo.png');
  assert.strictEqual(r.mime, 'image/png');
  assert.strictEqual(r.size, 1);
});

test('tam yol sürücüsüyle geçiyor; sürücüye göreli, sürücüsüz kök ve ağ yolu geçmiyor', () => {
  const { dir, ini } = tmp();
  const abs = path.join(dir, 'ust.png');
  assert.strictEqual(F.resolveImage(ini, abs).file, abs);
  assert.strictEqual(F.resolveImage(ini, 'c:logo.png', 'win32').error, 'BAD_PATH');
  assert.strictEqual(F.resolveImage(ini, '\\logo.png', 'win32').error, 'BAD_PATH');
  assert.strictEqual(F.resolveImage(ini, '/logo.png', 'win32').error, 'BAD_PATH', 'Windows\'ta / da sürücüsüz kök');
  assert.strictEqual(F.resolveImage(ini, '\\\\sunucu\\pay\\logo.png').error, 'BAD_PATH');
  assert.strictEqual(F.resolveImage(ini, '//sunucu/pay/logo.png').error, 'BAD_PATH');
  assert.strictEqual(F.resolveImage(ini, '').error, 'NO_IMG');
  assert.strictEqual(F.resolveImage(ini, '   ').error, 'NO_IMG');
});

test('yalnız tarayıcının çözdüğü resimler; eski biçim, eksik ve büyük dosya reddediliyor', () => {
  const { dir, ini } = tmp();
  assert.strictEqual(F.resolveImage(ini, 'eski.tga').error, 'UNSUPPORTED', 'MilkDrop TGA okuyordu, tarayıcı okumuyor');
  assert.strictEqual(F.resolveImage(ini, 'milk_img.ini').error, 'UNSUPPORTED');
  assert.strictEqual(F.resolveImage(ini, 'yok.png').error, 'NOT_FOUND');
  const big = path.join(dir, 'plugins', 'buyuk.png');
  fs.writeFileSync(big, '');
  fs.truncateSync(big, F.IMAGE_MAX_BYTES + 1);
  assert.strictEqual(F.resolveImage(ini, 'buyuk.png').error, 'TOO_LARGE');
});

test('sayfaya giden kimlik yolu taşımıyor ve aynı resim için aynı', () => {
  const { dir } = tmp();
  const a = F.imageKey(path.join(dir, 'ust.png'));
  assert.match(a, /^spr_[0-9a-f]{16}$/);
  assert.strictEqual(F.imageKey(path.join(dir, 'ust.png')), a);
  assert.notStrictEqual(F.imageKey(path.join(dir, 'plugins', 'logo.png')), a);
});

test('ini okuma: boyut sınırı ve hatalar', () => {
  const { dir, ini } = tmp();
  const r = F.readIni(ini);
  assert.strictEqual(r.ok, true);
  assert.match(r.text, /\[img00\]/);
  assert.strictEqual(F.readIni('').error, 'NO_FILE');
  assert.strictEqual(F.readIni(path.join(dir, 'yok.ini')).error, 'READ_FAILED');
  assert.strictEqual(F.readIni(dir).error, 'NOT_FILE');
  const big = path.join(dir, 'buyuk.ini');
  fs.writeFileSync(big, '');
  fs.truncateSync(big, F.INI_MAX_BYTES + 1);
  assert.strictEqual(F.readIni(big).error, 'TOO_LARGE');
});
