'use strict';
/* MilkDrop ses ölçeği dönüşümünün testleri.
 *
 * Bu dönüşüm ekranda görülür ama ekrana bakarak DOĞRULANAMAZ: "presetler
 * biraz daha canlı" bir ölçüm değil. Sayıyla söylenebilecek şeyler ise net:
 * sabit sesle oran 1'e gider, sessizlikte NaN üretmez, `_att` anlık değerin
 * gerisinde kalır, ve sonuç kare hızından bağımsızdır. */

const test = require('node:test');
const assert = require('node:assert');
const A = require('../src/shared/milkdrop-audio.js');

// Belirli bir süre boyunca sabit bant değeriyle besler
function feed(norm, seconds, dt, bands) {
  let out = null;
  for (let t = 0; t < seconds; t += dt) out = norm.update(dt, bands);
  return out;
}

test('sabit ses düzeyinde oran 1,0 civarına oturur', () => {
  const n = new A.MilkdropAudio();
  const r = feed(n, 30, 1 / 60, { bass: 0.35, mid: 0.25, treb: 0.15 });
  assert.ok(Math.abs(r.bass - 1) < 0.02, 'bass=' + r.bass);
  assert.ok(Math.abs(r.mid - 1) < 0.02, 'mid=' + r.mid);
  assert.ok(Math.abs(r.treb - 1) < 0.02, 'treb=' + r.treb);
});

/* Asıl mesele bu: mutlak genlik 0,3 ise preset bunu "sessiz" okuyordu.
   Ölçek dönüşümünden sonra aynı ses "normal" oluyor. */
test('düşük mutlak genlik de normal düzey sayılır', () => {
  const n = new A.MilkdropAudio();
  const r = feed(n, 30, 1 / 60, { bass: 0.04, mid: 0.04, treb: 0.04 });
  assert.ok(r.bass > 0.9, 'kısık ses normal sayılmalı, bass=' + r.bass);
});

test('ortalamanın üstündeki vuruş 1,0 üstüne çıkar', () => {
  const n = new A.MilkdropAudio();
  feed(n, 30, 1 / 60, { bass: 0.2, mid: 0.2, treb: 0.2 });
  const hit = n.update(1 / 60, { bass: 0.8, mid: 0.2, treb: 0.2 });
  assert.ok(hit.bass > 3, 'vuruş oranı=' + hit.bass);
  assert.ok(Math.abs(hit.mid - 1) < 0.1, 'diğer bantlar etkilenmemeli');
});

/* Presetler ani vuruşu `bass`, yavaş sürüklenmeyi `bass_att` ile okuyor.
   İkisi eşitken bu karşıtlık tümden kayboluyordu. */
test('_att anlık değerin gerisinde kalır', () => {
  const n = new A.MilkdropAudio();
  feed(n, 30, 1 / 60, { bass: 0.2, mid: 0.2, treb: 0.2 });
  const hit = n.update(1 / 60, { bass: 0.8, mid: 0.2, treb: 0.2 });
  assert.ok(hit.bass > hit.bass_att * 2,
    'anlık ' + hit.bass + ' yumuşatılmıştan çok daha yüksek olmalı: ' + hit.bass_att);
});

test('_att zamanla anlık değeri yakalar', () => {
  const n = new A.MilkdropAudio();
  feed(n, 5, 1 / 60, { bass: 0.2, mid: 0.2, treb: 0.2 });
  const r = feed(n, 3, 1 / 60, { bass: 0.4, mid: 0.2, treb: 0.2 });
  assert.ok(Math.abs(r.bass - r.bass_att) < 0.15,
    'anlık=' + r.bass + ' att=' + r.bass_att);
});

/* Sessizlikte hem anlık hem ortalama sıfıra gider: tabansız 0/0 NaN üretir
   ve havuza giren tek bir NaN bütün kareyi siyah bırakır. */
test('tam sessizlik NaN üretmez', () => {
  const n = new A.MilkdropAudio();
  const r = feed(n, 10, 1 / 60, { bass: 0, mid: 0, treb: 0 });
  for (const k of ['bass', 'mid', 'treb', 'bass_att', 'mid_att', 'treb_att']) {
    assert.ok(isFinite(r[k]), k + ' sonlu olmalı, değeri: ' + r[k]);
  }
});

test('geçersiz girdi sonlu değer üretir', () => {
  const n = new A.MilkdropAudio();
  const r = n.update(1 / 60, { bass: NaN, mid: undefined, treb: Infinity });
  for (const k in r) assert.ok(isFinite(r[k]), k + ' sonlu olmalı');
});

/* İlk kare ortalaması sıfırdan başlasaydı oran tavan yapar, preset açılışta
   bir kare patlamış görünürdü. */
test('ilk kare normal kabul edilir', () => {
  const n = new A.MilkdropAudio();
  const r = n.update(1 / 60, { bass: 0.5, mid: 0.5, treb: 0.5 });
  assert.ok(Math.abs(r.bass - 1) < 0.001, 'ilk kare oranı=' + r.bass);
});

test('sessizlik sonrası ani ses üst sınırı aşmaz', () => {
  const n = new A.MilkdropAudio();
  feed(n, 20, 1 / 60, { bass: 0, mid: 0, treb: 0 });
  const r = n.update(1 / 60, { bass: 1, mid: 1, treb: 1 });
  assert.ok(r.bass <= A.MAX, 'üst sınır aşıldı: ' + r.bass);
});

/* Sabit katsayılı yumuşatma 30 fps ile 144 fps arasında bambaşka davranır;
   zaman sabiti kullanmanın sebebi bu. */
test('sonuç kare hızından bağımsız', () => {
  const slow = new A.MilkdropAudio();
  const fast = new A.MilkdropAudio();
  feed(slow, 10, 1 / 30, { bass: 0.3, mid: 0.3, treb: 0.3 });
  feed(fast, 10, 1 / 144, { bass: 0.3, mid: 0.3, treb: 0.3 });
  const s = slow.update(1 / 30, { bass: 0.6, mid: 0.3, treb: 0.3 });
  const f = fast.update(1 / 144, { bass: 0.6, mid: 0.3, treb: 0.3 });
  assert.ok(Math.abs(s.bass - f.bass) < 0.05,
    '30fps=' + s.bass + ' 144fps=' + f.bass);
});

test('approach: tau büyüdükçe daha yavaş yaklaşır', () => {
  const hizli = A.approach(0, 1, 0.1, 0.1);
  const yavas = A.approach(0, 1, 0.1, 10);
  assert.ok(hizli > yavas);
  assert.ok(hizli < 1 && yavas > 0);
});

test('approach: tau sıfırsa doğrudan hedefe gider', () => {
  assert.strictEqual(A.approach(0, 5, 0.016, 0), 5);
});
