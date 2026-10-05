'use strict';
/* Kayıtlı ekran seçimi, ekran kimliği değişince de bulunur (#695).

   Windows ekranı yeniden takınca ya da sürücü değişince başka bir kimlik
   veriyor. Seçim yalnız kimliğe bakınca boşalıyor ve "Görselleştirmeyi Aç"
   hiçbir şey yapmıyordu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const M = require('../src/shared/display-match');

const disp = (id, x, y, w, h, primary) => ({
  id, isPrimary: !!primary, bounds: { x, y, width: w, height: h }, size: { width: w, height: h },
});
// Kullanıcının kurulumu: 1920 birincil, sağda 1280x1024, solda 1707x1068
const now = [
  disp(801520814, 0, 0, 1920, 1080, true),
  disp(2479324827, 1920, 241, 1280, 1024),
  disp(1826797680, -1707, -168, 1707, 1068),
];

test('ilk açılış (kayıt yok ya da varsayılan boş liste) birincil ekranı seçer', () => {
  assert.deepStrictEqual(M.resolve(undefined, now), { ids: [801520814], changed: true });
  assert.deepStrictEqual(M.resolve({ id: null, ids: [] }, now), { ids: [801520814], changed: true });
});

test('kullanıcının bilerek boşalttığı seçim boş kalır', () => {
  assert.deepStrictEqual(M.resolve({ id: null, ids: [], chosen: true }, now), { ids: [], changed: false });
});

test('kimlik duruyorsa seçim aynen kalır', () => {
  const r = M.resolve({ ids: [2479324827, 1826797680], chosen: true }, now);
  assert.deepStrictEqual(r, { ids: [2479324827, 1826797680], changed: false });
});

test('eski tek kimlikli kayıt listeye yükselir', () => {
  assert.deepStrictEqual(M.resolve({ id: 2479324827, ids: [] }, now).ids, [2479324827]);
  assert.deepStrictEqual(M.resolve({ id: 2479324827 }, now).ids, [2479324827]);
});

test('kimlik değişince ekran iziyle bulunur: önce konum ve boyut', () => {
  const saved = { ids: [111], prints: { 111: { x: 1920, y: 241, w: 1280, h: 1024, primary: false } }, chosen: true };
  assert.deepStrictEqual(M.resolve(saved, now), { ids: [2479324827], changed: true });
});

test('ekran yer değiştirdiyse aynı boyuttaki tek ekran seçilir', () => {
  const saved = { ids: [111], prints: { 111: { x: 5000, y: 0, w: 1707, h: 1068, primary: false } } };
  assert.deepStrictEqual(M.resolve(saved, now).ids, [1826797680]);
});

test('aynı boyutta iki ekran varsa birincillik ayırır, ayıramazsa tahmin edilmez', () => {
  const twins = [disp(1, 0, 0, 1920, 1080, true), disp(2, 1920, 0, 1920, 1080)];
  const sec = { ids: [9], prints: { 9: { x: 3840, y: 0, w: 1920, h: 1080, primary: false } } };
  assert.deepStrictEqual(M.resolve(sec, twins).ids, [2]);
  const three = twins.concat([disp(3, 3840, 0, 1920, 1080)]);
  // İki aday birincil değil: hangisi olduğu bilinemez, birincile düşülür
  assert.deepStrictEqual(M.resolve({ ids: [9], prints: { 9: { x: 0, y: 900, w: 1920, h: 1080, primary: false } } }, three).ids, [1]);
});

test('iki ekran birden yeni kimlik aldıysa ikisi de kendi izine oturur', () => {
  const saved = {
    ids: [8, 9],
    prints: {
      8: { x: 1920, y: 241, w: 1280, h: 1024, primary: false },
      9: { x: -1707, y: -168, w: 1707, h: 1068, primary: false },
    },
    chosen: true,
  };
  assert.deepStrictEqual(M.resolve(saved, now), { ids: [2479324827, 1826797680], changed: true });
});

test('bir ekran bir kez seçilir', () => {
  const twins = [disp(1, 0, 0, 1920, 1080, true), disp(2, 1920, 0, 1920, 1080)];
  const saved = { ids: [2, 9], prints: { 9: { x: 1920, y: 0, w: 1920, h: 1080 } }, chosen: true };
  // 9'un izi zaten seçili olan 2'yi gösteriyor; 2 ikinci kez eklenmez
  assert.deepStrictEqual(M.resolve(saved, twins).ids.filter((id) => id === 2).length, 1);
});

test('izi olmayan kayıp seçim birincil ekrana düşer (sessizce boş kalmaz)', () => {
  assert.deepStrictEqual(M.resolve({ id: 3808861027, ids: [3808861027] }, now), { ids: [801520814], changed: true });
});

test('iz seçili ekranlar için kimlik anahtarıyla yazılır', () => {
  assert.deepStrictEqual(M.prints([2479324827, 42], now), {
    2479324827: { x: 1920, y: 241, w: 1280, h: 1024, primary: false },
  });
});

test('panel eşleştiriciyi kullanıyor, kullanıcı seçimini işaretliyor ve boşken Aç uyarıyor', () => {
  const A = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.js'), 'utf8');
  const H = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'index.html'), 'utf8');
  assert.match(H, /<script src="\.\.\/shared\/display-match\.js"><\/script>/);
  assert.strictEqual((A.match(/cfg\.display\.chosen = true;/g) || []).length, 2, 'iki ekran seçicisi de işaretlemeli');
  assert.match(A, /window\.SVDisplayMatch\.prints\(selectedDisplayIds, displays\)/);
  assert.match(A, /svToast\(tr\('Önce görselleştirmenin açılacağı ekranı seçin\.'\), 'warn'\)/);
});
