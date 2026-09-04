'use strict';
/* Çalan parça çekirdeğinin testleri.
 *
 * Bu modülün kritik işi konumu ÇIPADAN hesaplamak. Kaynak konumu sürekli
 * saymadığı için (ölçüldü: beş yoklama boyunca sabit, sonra sıçrama) burayı
 * bozarsak ekrandaki süre donar ve zıplar — sessizce, hata vermeden.
 * Bu yüzden aritmetik gerçek ölçüm değerleriyle sabitlendi. */

const test = require('node:test');
const assert = require('node:assert');
const NP = require('../src/shared/nowplaying.js');

const sample = (over) => Object.assign({
  has: true, playing: true, title: 'Nibbana', artist: 'PROFF', album: '',
  app: 'music.youtube.com-5929F88E_vezhnr0wkvrcy!App',
  position: 91.209653, duration: 260.380999,
  updated: 1788556438431, received: 1788556438500,
}, over);

// ----------------------------------------------------------- çıpa aritmetiği

/* Gerçek ölçümden: kaynak 1788556438431'de 91.209653 bildirdi, 9.665 sn
   sonra 100.874537 bildirdi. Formülün ikisini de bağlaması gerekiyor. */
test('konum çıpadan hesaplanır ve kaynağın sonraki örneğiyle örtüşür', () => {
  const st = sample();
  const p = NP.positionAt(st, 1788556448096);
  assert.ok(Math.abs(p - 100.874537) < 0.01, 'beklenen ~100.8745, bulunan ' + p);
});

test('duran parçada konum ilerlemez', () => {
  const st = sample({ playing: false });
  assert.strictEqual(NP.positionAt(st, 1788556448096), 91.209653);
});

test('konum parçanın sonunu aşmaz', () => {
  const st = sample();
  assert.strictEqual(NP.positionAt(st, st.updated + 999999000), 260.380999);
});

/* Süresi bilinmeyen kaynakta (canlı yayın) tavan yok. */
test('süresi bilinmeyen kaynakta konum serbest sayar', () => {
  const st = sample({ duration: 0 });
  assert.ok(NP.positionAt(st, st.updated + 10000) > 101);
});

// --------------------------------------------------------- bozuk zaman damgası

test('sıfır damga yerine örneğin ulaştığı an kullanılır', () => {
  const st = sample({ updated: 0, received: 1788556440000 });
  assert.strictEqual(NP.anchorMs(st, 1788556441000), 1788556440000);
});

test('gelecekten gelen damgaya güvenilmez', () => {
  const now = 1788556441000;
  const st = sample({ updated: now + 60000, received: now - 100 });
  assert.strictEqual(NP.anchorMs(st, now), now - 100);
});

test('bir saatten eski damgaya güvenilmez', () => {
  const now = 1788556441000;
  const st = sample({ updated: now - 7200000, received: now - 100 });
  assert.strictEqual(NP.anchorMs(st, now), now - 100);
});

// ------------------------------------------------------------- biçimlendirme

test('süre biçimi', () => {
  assert.strictEqual(NP.fmtTime(0), '0:00');
  assert.strictEqual(NP.fmtTime(74), '1:14');
  assert.strictEqual(NP.fmtTime(59.9), '0:59');
  assert.strictEqual(NP.fmtTime(3725), '1:02:05');
  assert.strictEqual(NP.fmtTime(-74), '-1:14');
});

test('geçersiz süre çökmez', () => {
  assert.strictEqual(NP.fmtTime(NaN), '0:00');
  assert.strictEqual(NP.fmtTime(undefined), '0:00');
});

test('uygulama kimliğinden okunur ad çıkar', () => {
  assert.strictEqual(NP.prettyApp('music.youtube.com-5929F88E_vezhnr0wkvrcy!App'), 'music.youtube.com');
  assert.strictEqual(NP.prettyApp('Spotify.exe'), 'Spotify');
});

// ------------------------------------------------------------ türetilmiş durum

test('kalan süre ve ilerleme türetilir', () => {
  const r = NP.resolve(sample(), sample().updated);
  assert.ok(Math.abs(r.remaining - (260.380999 - 91.209653)) < 0.01);
  assert.ok(Math.abs(r.progress - 91.209653 / 260.380999) < 0.001);
});

test('oturum yokken her şey sıfır', () => {
  const r = NP.resolve(NP.EMPTY, 1000);
  assert.strictEqual(r.has, false);
  assert.strictEqual(r.progress, 0);
});

test('süresi bilinmeyen kaynak canlı işaretlenir', () => {
  assert.strictEqual(NP.resolve(sample({ duration: 0 }), 0).live, true);
  assert.strictEqual(NP.resolve(sample(), 0).live, false);
});

// -------------------------------------------------------------- parça kimliği

/* Yalnızca başlığa bakmak yanlış: canlı yayında başlık parça değişmeden
   değişiyor, süre de kimliğe giriyor. */
test('kimlik başlık, sanatçı ve süreden oluşur', () => {
  assert.ok(NP.isSameTrack(sample(), sample({ position: 5 })));
  assert.ok(!NP.isSameTrack(sample(), sample({ title: 'Başka' })));
  assert.ok(!NP.isSameTrack(sample(), sample({ artist: 'Başka' })));
  assert.ok(!NP.isSameTrack(sample(), sample({ duration: 99 })));
});

test('boş örneğin kimliği yok', () => {
  assert.strictEqual(NP.trackKey(NP.EMPTY), '');
  assert.strictEqual(NP.trackKey(sample({ title: '', artist: '' })), '');
});

// ------------------------------------------------------------------- izleyici

test('parça değişimi bir kez bildirilir', () => {
  const tr = new NP.Tracker();
  assert.strictEqual(tr.update(sample(), 1000).changed, true);
  assert.strictEqual(tr.update(sample({ position: 95 }), 2000).changed, false);
  assert.strictEqual(tr.update(sample({ title: 'Sonraki' }), 3000).changed, true);
});

/* Kaynak iki parça arasında alanları bir an boşaltıyor. Buna kanıp
   parçayı düşürseydik her geçişte sahte bir canlandırma tetiklenirdi. */
test('kısa boş kare parçayı düşürmez', () => {
  const tr = new NP.Tracker({ graceMs: 1500 });
  tr.update(sample(), 1000);
  const r = tr.update(NP.EMPTY, 1200);
  assert.strictEqual(r.state.title, 'Nibbana');
  assert.strictEqual(r.changed, false);
});

test('hoşgörü süresi dolunca parça düşer', () => {
  const tr = new NP.Tracker({ graceMs: 1500 });
  tr.update(sample(), 1000);
  tr.update(NP.EMPTY, 1200);
  const r = tr.update(NP.EMPTY, 3000);
  assert.strictEqual(r.state.has, false);
});

test('boşluktan sonra dönen aynı parça değişim sayılmaz', () => {
  const tr = new NP.Tracker({ graceMs: 1500 });
  tr.update(sample(), 1000);
  tr.update(NP.EMPTY, 1200);
  assert.strictEqual(tr.update(sample({ position: 95 }), 1400).changed, false);
});

test('değişimden bu yana geçen süre', () => {
  const tr = new NP.Tracker();
  tr.update(sample(), 1000);
  assert.strictEqual(tr.ageAt(3500), 2.5);
});

// --------------------------------------------------------------------- zarf

test('sürekli kipte hep görünür', () => {
  assert.strictEqual(NP.envelope(0, { mode: 'always' }).alpha, 1);
  assert.strictEqual(NP.envelope(9999, { mode: 'always' }).alpha, 1);
});

/* Kullanıcının istediği: sabit yazı yerine yalnızca parça değişince
   belirip sönen bir bilgi. */
test('değişimde kipte belirir, durur, söner', () => {
  const o = { mode: 'onChange', speed: 'normal' }; // anim 0.5, hold 4
  assert.strictEqual(NP.envelope(0, o).alpha, 0);
  assert.strictEqual(NP.envelope(0.25, o).alpha, 0.5);
  assert.strictEqual(NP.envelope(2, o).phase, 'hold');
  assert.strictEqual(NP.envelope(4.75, o).phase, 'out');
  assert.strictEqual(NP.envelope(99, o).alpha, 0);
});

test('hız kademesi süreleri değiştirir', () => {
  assert.ok(NP.speedOf('fast').hold < NP.speedOf('slow').hold);
  assert.strictEqual(NP.envelope(3, { mode: 'onChange', speed: 'fast' }).phase, 'out');
  assert.strictEqual(NP.envelope(3, { mode: 'onChange', speed: 'slow' }).phase, 'hold');
});

test('elle verilen süre kademeyi ezer', () => {
  const o = { mode: 'onChange', speed: 'normal', animDuration: 1, holdSeconds: 0 };
  assert.strictEqual(NP.envelope(0.5, o).alpha, 0.5);
  assert.strictEqual(NP.envelope(1.5, o).phase, 'out');
});

// ------------------------------------------------------------------ derleme

test('alanlar tek tek kapatılabilir', () => {
  const st = NP.resolve(sample(), sample().updated);
  const only = NP.compose(st, { show: { title: true, artist: false, elapsed: false, total: false, bar: false } });
  assert.strictEqual(only.title, 'Nibbana');
  assert.strictEqual(only.artist, '');
  assert.strictEqual(only.time, '');
  assert.strictEqual(only.showBar, false);
});

test('yalnızca süre gösterilebilir', () => {
  const st = NP.resolve(sample(), sample().updated);
  const c = NP.compose(st, { show: { title: false, artist: false, elapsed: true, total: true } });
  assert.strictEqual(c.hasText, false);
  assert.strictEqual(c.time, '1:31 / 4:20');
});

test('kalan süre eksi işaretle yazılır', () => {
  const st = NP.resolve(sample(), sample().updated);
  const c = NP.compose(st, { show: { elapsed: false, remaining: true, total: false } });
  assert.strictEqual(c.time, '-2:49');
});

/* Süresi bilinmeyen kaynakta toplam süre ve çubuk anlamsız. */
test('canlı yayında toplam süre ve çubuk gizlenir', () => {
  const st = NP.resolve(sample({ duration: 0 }), sample().updated);
  const c = NP.compose(st, { show: { elapsed: true, total: true, bar: true } });
  assert.strictEqual(c.showBar, false);
  assert.ok(!c.time.includes('/'));
});

test('OG kalıbı büyük harfe çevirir', () => {
  const st = NP.resolve(sample({ title: 'çığlık' }), 0);
  assert.strictEqual(NP.compose(st, { uppercase: true }).title, 'ÇIĞLIK');
});

test('kalıplar ayrı kod yolu değil, yalnızca varsayılan değer', () => {
  assert.ok(NP.styleOf('og').outline > 0);
  assert.strictEqual(NP.styleOf('modern').outline, 0);
  assert.strictEqual(NP.styleOf('bilinmeyen'), NP.STYLES.modern);
});

test('yapılandırma verilmeden derleme çökmez', () => {
  assert.doesNotThrow(() => NP.compose(null, null));
});
