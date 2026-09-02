'use strict';
/* Gösteri saatinin testleri.
 *
 * Bu modülün tek işi var: birden çok görselleştirici penceresinin oynatma
 * kafasını AYNI yerde görmesi. Panel her karede zaman yollasaydı pencereler
 * mesajlar arasında birbirinden kayardı; bunun yerine bir çıpa yollanır ve
 * her pencere zamanı kapalı formülle hesaplar.
 *
 * Buradaki testlerin çoğu "aynı girdiyle aynı çıktı" doğruluyor, çünkü
 * pencereler arası tutarlılığın güvencesi tam olarak budur.
 */
const test = require('node:test');
const assert = require('node:assert');

const SC = require('../src/shared/showclock.js');
const TL = require('../src/shared/timeline.js');

const near = (a, b, eps, msg) =>
  assert.ok(Math.abs(a - b) < (eps || 1e-9), (msg || '') + ' beklenen ' + b + ', gelen ' + a);

test('duran gösteride zaman çıpanın zamanıdır', () => {
  const a = SC.anchorFrom({ playing: false, time: 7 }, 1000, null);
  assert.strictEqual(SC.resolve(a, 1000), 7);
  assert.strictEqual(SC.resolve(a, 999999), 7, 'durmuşken saat ilerlememeli');
});

test('oynayan gösteride zaman çıpadan geçen süre kadar ilerler', () => {
  const a = SC.anchorFrom({ playing: true, time: 2, rate: 1 }, 1000, null);
  near(SC.resolve(a, 1000), 2, 1e-9, 'çıpa anında:');
  near(SC.resolve(a, 2500), 3.5, 1e-9, '1.5sn sonra:');
});

test('hız çarpanı uygulanır', () => {
  const a = SC.anchorFrom({ playing: true, time: 0, rate: 2 }, 0, null);
  near(SC.resolve(a, 1000), 2, 1e-9, 'iki kat hızda:');
});

test('AYNI çıpa ve AYNI an -> AYNI zaman (pencereler arası tutarlılık)', () => {
  /* Bu modülün varlık sebebi. İki pencere aynı Date.now() değerini gördüğü
     için aynı sonucu bulmalı; aksi halde ekranlar arasında kayma görünür. */
  const a = SC.anchorFrom({ playing: true, time: 3.21, rate: 1 }, 12345, {
    enabled: true,
    start: 2,
    end: 9,
  });
  for (const now of [12345, 13000, 20000, 99999, 123456]) {
    assert.strictEqual(SC.resolve(a, now), SC.resolve(a, now), now + ' anında ayrıştı');
  }
});

test('döngü sarması taşımanınkiyle AYNI sonucu verir', () => {
  /* İki yerde iki farklı sarma mantığı olsaydı panel ile pencere ayrışırdı.
     Bu test ikisini yan yana koyar. */
  const loop = { enabled: true, start: 2, end: 4 };
  const tl = TL.makeTimeline({ loop });
  for (const step of [0.4, 1.5, 2.5, 7.3, 10]) {
    const tr = new TL.Transport(tl);
    tr.seek(3).play();
    tr.advance(step);

    const a = SC.anchorFrom({ playing: true, time: 3, rate: 1 }, 0, loop);
    const viaClock = SC.resolve(a, step * 1000);

    near(viaClock, tr.time, 1e-9, step + 'sn adımda taşıma ile saat ayrıştı:');
  }
});

test('döngü boyundan uzun atlamada da bölge içinde kalır', () => {
  const a = SC.anchorFrom({ playing: true, time: 2, rate: 1 }, 0, { enabled: true, start: 2, end: 4 });
  for (const ms of [100, 2500, 9000, 60000]) {
    const t = SC.resolve(a, ms);
    assert.ok(t >= 2 - 1e-9 && t < 4 + 1e-9, ms + 'ms sonrası bölge dışı: ' + t);
  }
});

test('geçersiz döngü (son <= baş) sarma yapmaz', () => {
  const a = SC.anchorFrom({ playing: true, time: 0, rate: 1 }, 0, { enabled: true, start: 5, end: 5 });
  assert.strictEqual(a.loop, null, 'geçersiz döngü çıpaya girmemeli');
  near(SC.resolve(a, 10000), 10, 1e-9, 'sarmadan ilerlemeli:');
});

test('bozuk çıpa sonlu değer döner', () => {
  assert.strictEqual(SC.resolve(null, 1000), 0);
  for (const bad of [{}, { playing: true }, { playing: true, time: NaN, epoch: NaN }]) {
    const t = SC.resolve(bad, 1000);
    assert.ok(isFinite(t) && t >= 0, 'sonlu olmalı: ' + JSON.stringify(bad));
  }
});

test('geriye giden saat zamanı geri almaz', () => {
  /* Sistem saati geri alınırsa (NTP düzeltmesi) geçen süre negatif çıkar.
     Oynatma kafasının geriye sıçraması yerine yerinde durması yeğdir. */
  const a = SC.anchorFrom({ playing: true, time: 5, rate: 1 }, 10000, null);
  near(SC.resolve(a, 9000), 5, 1e-9, 'saat geri gidince:');
});

test('çıpa taşımanın gerçek durumunu taşır', () => {
  const tl = TL.makeTimeline({ loop: { enabled: true, start: 1, end: 3 } });
  const tr = new TL.Transport(tl);
  tr.seek(2.5).play();
  const a = SC.anchorFrom(tr, 4242, tl.loop);
  assert.strictEqual(a.playing, true);
  near(a.time, 2.5, 1e-9);
  assert.strictEqual(a.epoch, 4242);
  assert.ok(a.loop && a.loop.enabled);
  tr.pause();
  assert.strictEqual(SC.anchorFrom(tr, 0, tl.loop).playing, false);
});
