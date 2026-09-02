'use strict';
/* Zaman çizelgesi modelinin ve saatinin testleri.
 *
 * Buradaki iki şey özellikle kırılgan olduğu için ayrıntılı test edilir:
 *
 *   1. ÖLÇÜ/SANİYE DÖNÜŞÜMÜ. Tempo değişiminden sonra sabit bir BPM ile
 *      çarpmak, değişimden sonraki HER ŞEYİ kaydırır ve hata ancak gösteri
 *      sırasında fark edilir. Bu yüzden dönüşüm birden çok tempoda ve tempo
 *      değişiminin iki yakasında sınanır.
 *
 *   2. OTOMASYONUN YOL BAĞIMSIZLIĞI. Bir değerin, oynatma kafasının oraya
 *      nasıl geldiğinden (ileri sarma, geri sarma, kare atlama) bağımsız
 *      olması gerekir; çevrimdışı dışa aktarımın tekrarlanabilirliği buna
 *      dayanıyor.
 */
const test = require('node:test');
const assert = require('node:assert');

const TL = require('../src/shared/timeline.js');

const near = (a, b, eps, msg) =>
  assert.ok(Math.abs(a - b) < (eps || 1e-9), (msg || '') + ' beklenen ' + b + ', gelen ' + a);

// ===========================================================================
// Tempo haritası ve dönüşümler
// ===========================================================================
test('sabit tempoda saniye/vuruş dönüşümü tam', () => {
  for (const bpm of [60, 90, 120, 128, 140, 174]) {
    const map = TL.makeTempoMap([{ t: 0, bpm, beatsPerBar: 4 }]);
    for (const sec of [0, 0.5, 1, 2.75, 10, 123.456]) {
      near(TL.secondsToBeats(map, sec), (sec * bpm) / 60, 1e-9, bpm + ' bpm ' + sec + 'sn:');
      // Gidiş-dönüş kayıpsız olmalı
      near(TL.beatsToSeconds(map, TL.secondsToBeats(map, sec)), sec, 1e-9, 'gidiş-dönüş:');
    }
  }
});

test('tempo değişiminin ötesinde dönüşüm birikimli', () => {
  // 0-4sn 120bpm (8 vuruş), sonrası 60bpm
  const map = TL.makeTempoMap([
    { t: 0, bpm: 120, beatsPerBar: 4 },
    { t: 4, bpm: 60, beatsPerBar: 4 },
  ]);
  near(TL.secondsToBeats(map, 4), 8, 1e-9, 'değişim anı:');
  near(TL.secondsToBeats(map, 8), 12, 1e-9, 'değişimden 4sn sonra:');
  near(TL.beatsToSeconds(map, 12), 8, 1e-9, 'ters yön:');
  // Sabit bir bpm ile çarpmak 16 verirdi; bu testin yakaladığı hata tam da o.
  assert.notStrictEqual(TL.secondsToBeats(map, 8), 16);
});

test('tempo haritası sırasız ve eksik girdilerle onarılır', () => {
  const map = TL.makeTempoMap([
    { t: 8, bpm: 90 },
    { t: 2, bpm: 140 },
  ]);
  assert.strictEqual(map[0].t, 0, 'ilk segment her zaman 0’dan başlamalı');
  for (let i = 1; i < map.length; i++) assert.ok(map[i].t > map[i - 1].t, 'sıralı olmalı');
  for (const s of map) {
    assert.ok(isFinite(s.bpm) && s.bpm > 0, 'bpm sonlu ve pozitif');
    assert.ok(Number.isInteger(s.beatsPerBar) && s.beatsPerBar >= 1);
  }
});

test('aynı ana düşen iki tempo çakışmaz', () => {
  const map = TL.makeTempoMap([
    { t: 4, bpm: 100 },
    { t: 4, bpm: 150 },
  ]);
  const at4 = map.filter((s) => Math.abs(s.t - 4) < 1e-9);
  assert.strictEqual(at4.length, 1, 'aynı anda tek segment kalmalı');
  assert.strictEqual(at4[0].bpm, 150, 'sonuncusu geçerli');
});

test('ölçü/vuruş okunuşu 1 tabanlı', () => {
  const map = TL.makeTempoMap([{ t: 0, bpm: 120, beatsPerBar: 4 }]);
  const a = TL.secondsToBars(map, 0);
  assert.strictEqual(a.bar, 1, 'ilk ölçü 1');
  assert.strictEqual(a.beat, 1, 'ilk vuruş 1');
  const b = TL.secondsToBars(map, 2); // 4 vuruş = 1 ölçü
  assert.strictEqual(b.bar, 2);
  assert.strictEqual(b.beat, 1);
  const c = TL.secondsToBars(map, 2.5); // +1 vuruş
  assert.strictEqual(c.bar, 2);
  assert.strictEqual(c.beat, 2);
});

test('barsToSeconds ile secondsToBars birbirinin tersi', () => {
  const map = TL.makeTempoMap([{ t: 0, bpm: 128, beatsPerBar: 4 }]);
  for (let bar = 1; bar <= 16; bar++) {
    const sec = TL.barsToSeconds(map, bar, 1);
    const back = TL.secondsToBars(map, sec);
    assert.strictEqual(back.bar, bar, bar + '. ölçü geri dönmedi');
    assert.strictEqual(back.beat, 1);
  }
});

test('3/4 ölçüde ölçü uzunluğu doğru', () => {
  const map = TL.makeTempoMap([{ t: 0, bpm: 120, beatsPerBar: 3 }]);
  // 120bpm'de vuruş 0.5sn, 3 vuruşluk ölçü 1.5sn
  near(TL.barsToSeconds(map, 2, 1), 1.5, 1e-9);
  near(TL.barsToSeconds(map, 3, 1), 3.0, 1e-9);
});

// ===========================================================================
// Yakalama
// ===========================================================================
test('yakalama istenen ızgaraya oturur, yaklaşık değil', () => {
  const map = TL.makeTempoMap([{ t: 0, bpm: 120, beatsPerBar: 4 }]);
  near(TL.snapSeconds(map, 2.3, 'bar'), 2.0, 1e-9, 'ölçüye:');
  near(TL.snapSeconds(map, 2.3, 'beat'), 2.5, 1e-9, 'vuruşa:');
  near(TL.snapSeconds(map, 2.3, 'half'), 2.25, 1e-9, 'yarıma:');
  near(TL.snapSeconds(map, 2.3, 'quarter'), 2.25, 1e-9, 'çeyreğe:');
  assert.strictEqual(TL.snapSeconds(map, 2.3, 'off'), 2.3, 'kapalıyken dokunmamalı');
});

test('kare yakalaması fps’e yuvarlar', () => {
  const map = TL.makeTempoMap([{ t: 0, bpm: 120 }]);
  near(TL.snapSeconds(map, 1.0 / 60 + 0.001, 'frame', 60), 1 / 60, 1e-12);
  near(TL.snapSeconds(map, 0.51, 'frame', 25), 0.52, 1e-12);
});

// ===========================================================================
// Otomasyon
// ===========================================================================
test('anahtar kare değerlendirmesi uçlarda sabitlenir', () => {
  const keys = TL.sortKeys([
    { t: 1, v: 0.2 },
    { t: 3, v: 0.8 },
  ]);
  assert.strictEqual(TL.evalKeys(keys, 0), 0.2, 'ilk anahtardan önce');
  assert.strictEqual(TL.evalKeys(keys, 10), 0.8, 'son anahtardan sonra');
  near(TL.evalKeys(keys, 2), 0.5, 1e-9, 'tam orta:');
});

test('otomasyon YOLDAN bağımsız — çevrimdışı dışa aktarımın dayanağı', () => {
  const tl = TL.makeTimeline({
    tracks: [
      {
        kind: 'automation',
        target: 'postfx.0.params.strength',
        min: 0,
        max: 1,
        keys: [
          { t: 0, v: 0 },
          { t: 5, v: 1, curve: 'scurve' },
          { t: 9, v: 0.25 },
        ],
      },
    ],
  });
  const probe = 3.77;
  const direct = TL.automationAt(tl, probe);

  // İleri doğru küçük adımlarla gel
  let forward = null;
  for (let t = 0; t <= probe + 1e-12; t += 0.01) forward = TL.automationAt(tl, Math.min(t, probe));
  // Geriye doğru gel
  let backward = null;
  for (let t = 9; t >= probe - 1e-12; t -= 0.01) backward = TL.automationAt(tl, Math.max(t, probe));
  // Tek sıçrayışla gel
  const jumped = TL.automationAt(tl, probe);

  const key = 'postfx.0.params.strength';
  near(forward[key], direct[key], 1e-9, 'ileri gelince:');
  near(backward[key], direct[key], 1e-9, 'geri gelince:');
  near(jumped[key], direct[key], 1e-9, 'sıçrayınca:');
});

test('susturulmuş otomasyon parçası hiçbir hedefe yazmaz', () => {
  const tl = TL.makeTimeline({
    tracks: [
      { kind: 'automation', target: 'a.b', keys: [{ t: 0, v: 1 }], muted: true },
      { kind: 'automation', target: 'c.d', keys: [{ t: 0, v: 1 }] },
    ],
  });
  const vals = TL.automationAt(tl, 1);
  assert.ok(!('a.b' in vals), 'susturulmuş hedef yazmamalı');
  assert.ok('c.d' in vals, 'susturulmamış hedef yazmalı');
});

test('otomasyon min/max aralığına ölçeklenir', () => {
  const tl = TL.makeTimeline({
    tracks: [{ kind: 'automation', target: 'x', min: 10, max: 20, keys: [{ t: 0, v: 0 }, { t: 2, v: 1 }] }],
  });
  near(TL.automationAt(tl, 0).x, 10, 1e-9);
  near(TL.automationAt(tl, 2).x, 20, 1e-9);
  near(TL.automationAt(tl, 1).x, 15, 1e-9);
});

// ===========================================================================
// Klipler
// ===========================================================================
test('klip kırpma ve hız istenen değerleri verir', () => {
  const c = TL.makeClip({ start: 2, dur: 5, inPoint: 1.5, outPoint: 6, speed: 2 });
  assert.strictEqual(c.start, 2);
  assert.strictEqual(c.dur, 5);
  assert.strictEqual(TL.clipEnd(c), 7);
  assert.strictEqual(c.inPoint, 1.5);
  assert.strictEqual(c.outPoint, 6);
  assert.strictEqual(c.speed, 2);
});

test('bozuk klip girdileri sonlu değerlere düşer', () => {
  for (const bad of [{}, { start: NaN }, { dur: -5 }, { speed: 0 }, { start: 'çöp' }]) {
    const c = TL.makeClip(bad);
    assert.ok(isFinite(c.start) && c.start >= 0, 'start sonlu değil: ' + JSON.stringify(bad));
    assert.ok(isFinite(c.dur) && c.dur > 0, 'dur pozitif değil: ' + JSON.stringify(bad));
    assert.ok(isFinite(c.speed) && c.speed > 0, 'speed pozitif değil: ' + JSON.stringify(bad));
  }
});

test('clipsAt yalnızca o andaki klipleri döner', () => {
  const tl = TL.makeTimeline({
    tracks: [
      {
        kind: 'clip',
        clips: [
          { id: 'a', start: 0, dur: 2 },
          { id: 'b', start: 2, dur: 2 },
        ],
      },
    ],
  });
  assert.strictEqual(TL.clipsAt(tl, 1)[0].clip.id, 'a');
  assert.strictEqual(TL.clipsAt(tl, 3)[0].clip.id, 'b');
  // Sınır: 2. saniye b'ye ait, a'ya değil — yoksa iki klip birden çizilir
  assert.strictEqual(TL.clipsAt(tl, 2).length, 1);
  assert.strictEqual(TL.clipsAt(tl, 2)[0].clip.id, 'b');
  assert.strictEqual(TL.clipsAt(tl, 99).length, 0);
});

test('susturulmuş klip parçası çizilmez', () => {
  const tl = TL.makeTimeline({
    tracks: [{ kind: 'clip', muted: true, clips: [{ start: 0, dur: 5 }] }],
  });
  assert.strictEqual(TL.clipsAt(tl, 1).length, 0);
});

test('boş çizelgenin uzunluğu 0', () => {
  assert.strictEqual(TL.timelineLength(TL.makeTimeline({})), 0);
});

test('çizelge uzunluğu en geç biteni bulur', () => {
  const tl = TL.makeTimeline({
    tracks: [{ kind: 'clip', clips: [{ start: 0, dur: 3 }] }],
    markers: [{ t: 12, name: 'son' }],
  });
  assert.strictEqual(TL.timelineLength(tl), 12);
});

// ===========================================================================
// Taşıma
// ===========================================================================
test('taşıma duvar saatini değil verilen dt’yi kullanır', () => {
  const tr = new TL.Transport(TL.makeTimeline({}));
  tr.play();
  for (let i = 0; i < 60; i++) tr.advance(1 / 60);
  near(tr.time, 1, 1e-9, '60 kare sonra:');
  tr.pause();
  tr.advance(5);
  near(tr.time, 1, 1e-9, 'duraklatılmışken ilerlememeli:');
});

test('döngü bölgesi kare atlamasında da doğru sarar', () => {
  const tl = TL.makeTimeline({ loop: { enabled: true, start: 2, end: 4 } });
  const tr = new TL.Transport(tl);
  tr.seek(3).play();
  tr.advance(1.5); // 4.5 -> döngü sonunu aşar
  assert.ok(tr.time >= 2 && tr.time < 4, 'döngü içinde kalmalı, gelen: ' + tr.time);
  near(tr.time, 2.5, 1e-9, 'modülo ile sarmalı:');

  // Döngü boyundan UZUN bir adım: başa saplanmamalı
  tr.seek(3);
  tr.advance(10); // 13 -> (13-2) % 2 = 1 -> 3
  assert.ok(tr.time >= 2 && tr.time < 4, 'uzun adımda da içeride: ' + tr.time);
});

test('stop başa döner, seek negatife düşmez', () => {
  const tr = new TL.Transport(TL.makeTimeline({}));
  tr.seek(10).play().stop();
  assert.strictEqual(tr.time, 0);
  assert.strictEqual(tr.playing, false);
  tr.seek(-5);
  assert.strictEqual(tr.time, 0, 'negatif zaman olmamalı');
});

test('seekBar oynatma kafasını ölçüye götürür', () => {
  const tl = TL.makeTimeline({ tempo: [{ t: 0, bpm: 120, beatsPerBar: 4 }] });
  const tr = new TL.Transport(tl);
  tr.seekBar(3, 1); // 2 ölçü = 8 vuruş = 4sn
  near(tr.time, 4, 1e-9);
  assert.strictEqual(tr.bars().bar, 3);
});

// ===========================================================================
// Tempo değişiminde yeniden zamanlama
// ===========================================================================
test('retimeToTempo müzikal konumu korur, çağrılmadan hiçbir şey kıpırdamaz', () => {
  const tl = TL.makeTimeline({
    tempo: [{ t: 0, bpm: 120, beatsPerBar: 4 }],
    tracks: [{ kind: 'clip', clips: [{ start: 2, dur: 2 }] }], // 4. vuruşta başlar
    markers: [{ t: 4, name: 'm' }],
  });

  // Tempo haritasını doğrudan değiştirmek klibi KIPIRDATMAMALI
  const before = tl.tracks[0].clips[0].start;
  assert.strictEqual(before, 2);

  // Açık dönüşüm: 120 -> 60 bpm, aynı vuruş iki katı saniyeye düşer
  TL.retimeToTempo(tl, [{ t: 0, bpm: 60, beatsPerBar: 4 }]);
  near(tl.tracks[0].clips[0].start, 4, 1e-9, 'klip başlangıcı:');
  near(tl.tracks[0].clips[0].dur, 4, 1e-9, 'klip süresi:');
  near(tl.markers[0].t, 8, 1e-9, 'işaret:');

  // Vuruş cinsinden konum değişmemiş olmalı — asıl güvence bu
  near(TL.secondsToBeats(tl.tempo, tl.tracks[0].clips[0].start), 4, 1e-9, 'vuruş konumu:');
});

// ===========================================================================
// İşaretler
// ===========================================================================
test('işaretler arasında gezinme', () => {
  const tl = TL.makeTimeline({ markers: [{ t: 1, name: 'a' }, { t: 5, name: 'b' }, { t: 9, name: 'c' }] });
  assert.strictEqual(TL.markerAfter(tl, 0).name, 'a');
  assert.strictEqual(TL.markerAfter(tl, 5).name, 'c', 'tam üstündeyken sonrakine gitmeli');
  assert.strictEqual(TL.markerBefore(tl, 6).name, 'b');
  assert.strictEqual(TL.markerAfter(tl, 99), null);
  assert.strictEqual(TL.markerBefore(tl, 0), null);
});

test('cue listesinden işaret üretimi', () => {
  const marks = TL.markersFromCues([
    { t: 5, text: 'nakarat' },
    { time: 1, name: 'giriş' },
  ]);
  assert.strictEqual(marks.length, 2);
  assert.strictEqual(marks[0].t, 1, 'sıralanmalı');
  assert.strictEqual(marks[0].name, 'giriş');
  assert.strictEqual(marks[1].name, 'nakarat');
});

// ===========================================================================
// Serileştirme
// ===========================================================================
test('çizelge JSON turundan sağ çıkar', () => {
  const tl = TL.makeTimeline({
    tempo: [{ t: 0, bpm: 128, beatsPerBar: 4 }],
    tracks: [
      { kind: 'clip', name: 'A', clips: [{ start: 1, dur: 2, type: 'video', ref: 'x.mp4' }] },
      { kind: 'automation', target: 'a.b', keys: [{ t: 0, v: 0 }, { t: 4, v: 1, curve: 'exp' }] },
    ],
    markers: [{ t: 3, name: 'm' }],
    loop: { enabled: true, start: 0, end: 8 },
  });
  const back = TL.makeTimeline(JSON.parse(JSON.stringify(tl)));
  assert.strictEqual(back.tracks.length, 2);
  assert.strictEqual(back.tracks[0].clips[0].ref, 'x.mp4');
  assert.strictEqual(back.tracks[1].keys[1].curve, 'exp');
  assert.strictEqual(back.markers[0].name, 'm');
  assert.strictEqual(back.loop.enabled, true);
  near(TL.timelineLength(back), TL.timelineLength(tl), 1e-9);
});

test('sonu başından önce olan döngü kendini kapatır', () => {
  const tl = TL.makeTimeline({ loop: { enabled: true, start: 8, end: 2 } });
  assert.strictEqual(tl.loop.enabled, false, 'geçersiz döngü açık kalmamalı');
});

// ===========================================================================
// Çevrimdışı işleme determinizmi (#493)
//
// Çevrimdışı dışa aktarım bu projenin görsel regresyon ağı. Ancak zamana
// bağlı her kaynak ÇİZİM SAATİNDEN türediği sürece işe yarar. Zaman
// çizelgesi aynı kurala uymak zorunda: aynı gösteri iki kez işlendiğinde
// kare kare aynı çıkmalı, kare atlanması otomasyonu kaydırmamalı.
// ===========================================================================
test('aynı gösteri kare indeksinden iki kez işlenince aynı çıkar', () => {
  const build = () =>
    TL.makeTimeline({
      tracks: [
        {
          kind: 'automation',
          target: 'a.b',
          keys: [
            { t: 0, v: 0 },
            { t: 2, v: 1, curve: 'scurve' },
            { t: 5, v: 0.3, curve: 'exp' },
          ],
        },
      ],
    });

  const render = (tl, fps, frames) => {
    const out = [];
    for (let i = 0; i < frames; i++) out.push(TL.automationAt(tl, i / fps)['a.b']);
    return out;
  };

  const a = render(build(), 60, 400);
  const b = render(build(), 60, 400);
  assert.deepStrictEqual(a, b, 'iki koşu bit bazında aynı olmalı');
});

test('kare atlaması otomasyonu KAYDIRMAZ', () => {
  /* Duvar saatine dayalı bir çözümde atlanan kare, sonraki tüm değerleri
     kaydırırdı. Zaman kare indeksinden geldiği için 30. karenin değeri,
     ona kaç karede ulaşıldığından bağımsızdır. */
  const tl = TL.makeTimeline({
    tracks: [{ kind: 'automation', target: 'x', keys: [{ t: 0, v: 0 }, { t: 4, v: 1 }] }],
  });
  const fps = 60;
  const dense = TL.automationAt(tl, 30 / fps).x;
  // Her ikinci kareyi atlayarak aynı indekse gel
  let sparse = null;
  for (let i = 0; i <= 30; i += 2) sparse = TL.automationAt(tl, Math.min(i, 30) / fps).x;
  near(sparse, dense, 1e-12, 'atlanan karelerle:');
});

test('otomasyon kopyala-yaz — kullanıcının ayarı bozulmaz', () => {
  const cfg = { postfx: [{ params: { strength: 0.1 } }] };
  const tl = TL.makeTimeline({
    tracks: [{ kind: 'automation', target: 'postfx.0.params.strength', min: 0, max: 1, keys: [{ t: 0, v: 0 }, { t: 2, v: 1 }] }],
  });
  const r = TL.applyAutomation(cfg, tl, 1);
  near(r.cfg.postfx[0].params.strength, 0.5, 1e-9, 'yeni değer:');
  assert.strictEqual(cfg.postfx[0].params.strength, 0.1, 'ORİJİNAL yapılandırma değişmemeli');
  assert.notStrictEqual(r.cfg, cfg, 'yeni kök dönmeli');
});

test('karşılığı olmayan otomasyon hedefi SESSİZCE yutulmaz', () => {
  /* setIn var olmayan bir yola yazmaz. Bu sessizlik bildirilmezse kullanıcı
     "otomasyon çalışmıyor" der ve sebebi hiçbir yerde görünmez. */
  const cfg = { a: { b: 1 } };
  const tl = TL.makeTimeline({
    tracks: [
      { kind: 'automation', target: 'a.b', keys: [{ t: 0, v: 1 }] },
      { kind: 'automation', target: 'yok.olan.yol', keys: [{ t: 0, v: 1 }] },
    ],
  });
  const r = TL.applyAutomation(cfg, tl, 0);
  assert.strictEqual(r.applied, 1, 'var olan hedef uygulanmalı');
  assert.ok(Array.isArray(r.missing), 'eksik hedefler bildirilmeli');
  assert.deepStrictEqual(r.missing, ['yok.olan.yol']);
});

test('otomasyonsuz çizelge yapılandırmayı hiç kopyalamaz', () => {
  const cfg = { a: 1 };
  const r = TL.applyAutomation(cfg, TL.makeTimeline({}), 0);
  assert.strictEqual(r.cfg, cfg, 'gereksiz kopya çıkarılmamalı');
  assert.strictEqual(r.applied, 0);
});
