'use strict';
/* Klip destesinin testleri.
 *
 * Bu motorun canlı kullanımda yanlış davranması geri alınamaz: sahnedeyken
 * yanlış vuruşta ateşlenen bir klip düzeltilemez. Bu yüzden nicelemenin
 * SINIR durumları (tam vuruş üstünde ateşleme, sütun hizalaması) ve takip
 * eylemi döngüsü ayrıntılı sınanır.
 */
const test = require('node:test');
const assert = require('node:assert');

const TL = require('../src/shared/timeline.js');
const CD = require('../src/shared/clipdeck.js');

const near = (a, b, eps, msg) =>
  assert.ok(Math.abs(a - b) < (eps || 1e-9), (msg || '') + ' beklenen ' + b + ', gelen ' + a);

const map120 = () => TL.makeTempoMap([{ t: 0, bpm: 120, beatsPerBar: 4 }]);

/* Motoru sabit adımlarla ilerlet ve olayları topla. Duvar saati yok: her adım
   açıkça verilir, böylece test de çevrimdışı dışa aktarım gibi davranır. */
function run(engine, map, from, to, step) {
  const events = [];
  engine.on((type, payload) => events.push({ type, payload }));
  for (let t = from; t <= to + 1e-12; t += step || 0.05) engine.update(t, map);
  return events;
}

// ===========================================================================
// Niceleme
// ===========================================================================
test('niceleme bir sonraki müzikal sınıra bekletir', () => {
  const map = map120(); // vuruş 0.5sn, ölçü 2sn
  near(CD.nextGridTime(map, 1.2, 'bar'), 2, 1e-9, 'ölçü:');
  near(CD.nextGridTime(map, 1.2, 'beat'), 1.5, 1e-9, 'vuruş:');
  near(CD.nextGridTime(map, 1.2, 'bar2'), 4, 1e-9, 'iki ölçü:');
  near(CD.nextGridTime(map, 1.2, 'bar4'), 8, 1e-9, 'dört ölçü:');
});

test('tam ızgara üstünde ateşleme YERİNDE DURMAZ', () => {
  /* Operatör vuruşa tam bastığında klip "hemen" başlarsa niceleme rastgele
     davranıyor gibi görünür. Sınırda bir sonraki çizgiye gidilmeli. */
  const map = map120();
  near(CD.nextGridTime(map, 2.0, 'bar'), 4, 1e-9, 'ölçü üstünde:');
  near(CD.nextGridTime(map, 0.5, 'beat'), 1.0, 1e-9, 'vuruş üstünde:');
  near(CD.nextGridTime(map, 0, 'bar'), 2, 1e-9, 'sıfırda:');
});

test('niceleme kapalı ve kare kipleri beklemez', () => {
  const map = map120();
  assert.strictEqual(CD.nextGridTime(map, 1.2, 'off'), 1.2);
  assert.strictEqual(CD.nextGridTime(map, 1.2, 'frame'), 1.2);
});

test('niceleme çizelgeyle AYNI tempo kaynağını kullanır', () => {
  const map = TL.makeTempoMap([
    { t: 0, bpm: 120, beatsPerBar: 4 },
    { t: 4, bpm: 60, beatsPerBar: 4 },
  ]);
  // 4sn'den sonra vuruş 1sn, ölçü 4sn. 4sn'de olan ölçü sınırı 8sn olmalı.
  near(CD.nextGridTime(map, 5, 'bar'), 8, 1e-9, 'tempo değişiminden sonra:');
});

test('ölçü uzunluğu 3/4’te üç vuruş', () => {
  assert.strictEqual(CD.quantizeBeats('bar', 3), 3);
  assert.strictEqual(CD.quantizeBeats('bar2', 3), 6);
  assert.strictEqual(CD.quantizeBeats('beat', 3), 1);
});

// ===========================================================================
// Seyrek ızgara
// ===========================================================================
test('boş yuvalar saklanmaz — gösteri dosyası şişmez', () => {
  const deck = CD.makeDeck({ rows: 8, cols: 8 });
  CD.setSlot(deck, 0, 0, { type: 'scene', ref: 's1' });
  CD.setSlot(deck, 7, 7, { type: 'video', ref: 'v.mp4' });
  const out = CD.serializeDeck(deck);
  assert.strictEqual(out.slots.length, 2, '64 hücreli ızgarada 2 kayıt olmalı');
  assert.strictEqual(Object.keys(deck.slots).length, 2);
});

test('ızgara dışına yuva yazılmaz', () => {
  const deck = CD.makeDeck({ rows: 2, cols: 2 });
  assert.strictEqual(CD.setSlot(deck, 5, 0, { ref: 'x' }), null);
  assert.strictEqual(CD.setSlot(deck, 0, -1, { ref: 'x' }), null);
  assert.strictEqual(CD.slotList(deck).length, 0);
});

test('yuva silinebilir', () => {
  const deck = CD.makeDeck({ rows: 4, cols: 4 });
  CD.setSlot(deck, 1, 1, { ref: 'x' });
  assert.ok(CD.getSlot(deck, 1, 1));
  CD.setSlot(deck, 1, 1, null);
  assert.strictEqual(CD.getSlot(deck, 1, 1), null);
});

test('deste JSON turundan sağ çıkar', () => {
  const deck = CD.makeDeck({ rows: 4, cols: 4, rowNames: { 0: 'Giriş' } });
  CD.setSlot(deck, 0, 0, { type: 'video', ref: 'a.mp4', quantize: 'beat', trigger: 'cut', dur: 3, follow: 'next' });
  const back = CD.makeDeck(JSON.parse(JSON.stringify(CD.serializeDeck(deck))));
  const s = CD.getSlot(back, 0, 0);
  assert.strictEqual(s.ref, 'a.mp4');
  assert.strictEqual(s.quantize, 'beat');
  assert.strictEqual(s.trigger, 'cut');
  assert.strictEqual(s.dur, 3);
  assert.strictEqual(s.follow, 'next');
  assert.strictEqual(back.rowNames[0], 'Giriş');
});

// ===========================================================================
// Ateşleme
// ===========================================================================
test('hazırlanan yuva ızgara çizgisinde ateşlenir, önce değil', () => {
  const map = map120();
  const deck = CD.makeDeck({ rows: 4, cols: 4 });
  CD.setSlot(deck, 0, 0, { ref: 's1', quantize: 'bar' });
  const e = new CD.Engine({ decks: [deck] });
  e.launch('deck', 0, 0, 1.2, map); // 2.0'da ateşlenmeli

  const fires = [];
  e.on((t, p) => t === 'fire' && fires.push(p.at));
  for (let t = 1.2; t < 1.99; t += 0.01) e.update(t, map);
  assert.strictEqual(fires.length, 0, 'sınırdan önce ateşlenmemeli');
  e.update(2.0, map);
  assert.strictEqual(fires.length, 1, 'sınırda ateşlenmeli');
});

test('geri sayım okunabilir', () => {
  const map = map120();
  const deck = CD.makeDeck({ rows: 4, cols: 4 });
  CD.setSlot(deck, 0, 0, { ref: 's1', quantize: 'bar' });
  const e = new CD.Engine({ decks: [deck] });
  e.launch('deck', 0, 0, 1.2, map);
  near(e.countdown('deck', 0, 0, 1.2), 0.8, 1e-9, 'kalan süre:');
  assert.strictEqual(e.countdown('deck', 1, 1, 1.2), null, 'hazırlanmamış yuva null');
});

test('aynı sütunda ikinci hazırlık birincinin yerine geçer', () => {
  /* Operatör fikrini değiştirdiğinde iki klip birden ateşlenmemeli. */
  const map = map120();
  const deck = CD.makeDeck({ rows: 4, cols: 4 });
  CD.setSlot(deck, 0, 0, { ref: 'a', quantize: 'bar' });
  CD.setSlot(deck, 1, 0, { ref: 'b', quantize: 'bar' });
  const e = new CD.Engine({ decks: [deck] });
  e.launch('deck', 0, 0, 1.0, map);
  e.launch('deck', 1, 0, 1.2, map);
  assert.strictEqual(e.armed.length, 1, 'tek hazırlık kalmalı');
  assert.strictEqual(e.armed[0].slot.ref, 'b', 'sonuncusu geçerli');
});

test('kesme gerçek kesmedir — tek karelik harman bile yok', () => {
  const map = map120();
  const deck = CD.makeDeck({ rows: 4, cols: 4 });
  CD.setSlot(deck, 0, 0, { ref: 'a', quantize: 'off', trigger: 'cut', fade: 2 });
  const e = new CD.Engine({ decks: [deck] });
  let got = null;
  e.on((t, p) => t === 'fire' && (got = p));
  e.launch('deck', 0, 0, 0, map);
  e.update(0, map);
  assert.strictEqual(got.fade, 0, 'kesmede geçiş süresi 0 olmalı');
  assert.strictEqual(got.transition, 'cut');
});

test('geçiş kipinde süre ve geçiş adı korunur', () => {
  const map = map120();
  const deck = CD.makeDeck({ rows: 4, cols: 4 });
  CD.setSlot(deck, 0, 0, { ref: 'a', quantize: 'off', trigger: 'fade', fade: 1.5, transition: 'dissolve' });
  const e = new CD.Engine({ decks: [deck] });
  let got = null;
  e.on((t, p) => t === 'fire' && (got = p));
  e.launch('deck', 0, 0, 0, map);
  e.update(0, map);
  assert.strictEqual(got.fade, 1.5);
  assert.strictEqual(got.transition, 'dissolve');
});

// ===========================================================================
// Sütun başlatma
// ===========================================================================
test('satır başlatmada tüm yuvalar AYNI zamanda hizalanır', () => {
  /* Her yuva kendi nicelemesini kullansaydı satır görünür şekilde dağılırdı. */
  const map = map120();
  const deck = CD.makeDeck({ rows: 4, cols: 4 });
  CD.setSlot(deck, 0, 0, { ref: 'a', quantize: 'beat' });
  CD.setSlot(deck, 0, 1, { ref: 'b', quantize: 'bar' });
  CD.setSlot(deck, 0, 2, { ref: 'c', quantize: 'bar4' });
  const e = new CD.Engine({ decks: [deck] });
  const armed = e.launchRow('deck', 0, 1.2, map);
  assert.strictEqual(armed.length, 3);
  const times = new Set(armed.map((a) => a.at));
  assert.strictEqual(times.size, 1, 'hepsi tek zamanda olmalı, gelen: ' + Array.from(times).join(','));
  near(armed[0].at, 8, 1e-9, 'en uzun niceleme (bar4) geçerli:');
});

test('satır başlatma boş satırda hiçbir şey yapmaz', () => {
  const map = map120();
  const deck = CD.makeDeck({ rows: 4, cols: 4 });
  const e = new CD.Engine({ decks: [deck] });
  assert.strictEqual(e.launchRow('deck', 2, 0, map).length, 0);
  assert.strictEqual(e.armed.length, 0);
});

test('satır ateşlendiğinde hepsi tek karede gelir', () => {
  const map = map120();
  const deck = CD.makeDeck({ rows: 2, cols: 3 });
  for (let c = 0; c < 3; c++) CD.setSlot(deck, 0, c, { ref: 'r' + c, quantize: 'bar' });
  const e = new CD.Engine({ decks: [deck] });
  const fires = [];
  e.on((t, p) => t === 'fire' && fires.push(p.at));
  e.launchRow('deck', 0, 1.2, map);
  for (let t = 1.2; t <= 2.5; t += 0.05) e.update(t, map);
  assert.strictEqual(fires.length, 3, 'üçü de ateşlenmeli');
  assert.strictEqual(new Set(fires).size, 1, 'aynı karede gelmeli, kayma olmamalı');
});

// ===========================================================================
// Takip eylemleri
// ===========================================================================
test('takip eylemi: next bir sonraki dolu yuvaya geçer', () => {
  const map = map120();
  const deck = CD.makeDeck({ rows: 4, cols: 1 });
  CD.setSlot(deck, 0, 0, { ref: 'a', quantize: 'off', dur: 1, follow: 'next' });
  // 1. satır BOŞ — atlanmalı
  CD.setSlot(deck, 2, 0, { ref: 'c', quantize: 'off', dur: 1, follow: 'stop' });
  const e = new CD.Engine({ decks: [deck] });
  e.launch('deck', 0, 0, 0, map);
  const events = run(e, map, 0, 4, 0.05);
  const fired = events.filter((x) => x.type === 'fire').map((x) => x.payload.slot.ref);
  assert.deepStrictEqual(fired, ['a', 'c'], 'boş satır atlanmalı, gelen: ' + fired.join(','));
});

test('takip eylemi: loop aynı yuvayı yeniden ateşler', () => {
  const map = map120();
  const deck = CD.makeDeck({ rows: 2, cols: 1 });
  CD.setSlot(deck, 0, 0, { ref: 'a', quantize: 'off', dur: 1, follow: 'loop' });
  const e = new CD.Engine({ decks: [deck] });
  e.launch('deck', 0, 0, 0, map);
  const events = run(e, map, 0, 3.2, 0.05);
  const fired = events.filter((x) => x.type === 'fire');
  assert.ok(fired.length >= 3, 'en az üç kez ateşlenmeli, gelen: ' + fired.length);
  assert.ok(fired.every((f) => f.payload.slot.ref === 'a'));
});

test('takip eylemi: stop çalmayı bitirir', () => {
  const map = map120();
  const deck = CD.makeDeck({ rows: 2, cols: 1 });
  CD.setSlot(deck, 0, 0, { ref: 'a', quantize: 'off', dur: 1, follow: 'stop' });
  const e = new CD.Engine({ decks: [deck] });
  e.launch('deck', 0, 0, 0, map);
  run(e, map, 0, 3, 0.05);
  assert.strictEqual(e.activeSlots().length, 0, 'hiçbir şey çalmıyor olmalı');
});

test('takip eylemi: goto adreslenen yuvaya gider', () => {
  const map = map120();
  const deck = CD.makeDeck({ rows: 4, cols: 2 });
  CD.setSlot(deck, 0, 0, { ref: 'a', quantize: 'off', dur: 1, follow: 'goto', followTarget: '3:0' });
  CD.setSlot(deck, 3, 0, { ref: 'd', quantize: 'off', dur: 1, follow: 'stop' });
  const e = new CD.Engine({ decks: [deck] });
  e.launch('deck', 0, 0, 0, map);
  const fired = run(e, map, 0, 4, 0.05)
    .filter((x) => x.type === 'fire')
    .map((x) => x.payload.slot.ref);
  assert.deepStrictEqual(fired, ['a', 'd']);
});

test('takip eylemi: random çevrimdışı dışa aktarımda tekrarlanabilir', () => {
  /* Math.random kullanılsaydı aynı gösteri iki kez işlendiğinde farklı
     kareler çıkardı ve çevrimdışı dışa aktarım regresyon ağı olmaktan
     çıkardı. Seçim zamandan türetilir. */
  const map = map120();
  const build = () => {
    const deck = CD.makeDeck({ rows: 4, cols: 1 });
    CD.setSlot(deck, 0, 0, { ref: 'a', quantize: 'off', dur: 1, follow: 'random' });
    CD.setSlot(deck, 1, 0, { ref: 'b', quantize: 'off', dur: 1, follow: 'stop' });
    CD.setSlot(deck, 2, 0, { ref: 'c', quantize: 'off', dur: 1, follow: 'stop' });
    const e = new CD.Engine({ decks: [deck] });
    e.launch('deck', 0, 0, 0, map);
    return run(e, map, 0, 4, 0.05)
      .filter((x) => x.type === 'fire')
      .map((x) => x.payload.slot.ref)
      .join(',');
  };
  assert.strictEqual(build(), build(), 'iki koşu aynı sonucu vermeli');
});

test('takip eylemi döngüsü kare başına sınırlanır', () => {
  /* Süresi sıfıra yakın bir "next" zinciri, koruma olmasa kare başına sonsuz
     ateşleme üretir ve makineyi kilitler. */
  const map = map120();
  const deck = CD.makeDeck({ rows: 4, cols: 1 });
  for (let r = 0; r < 4; r++) {
    CD.setSlot(deck, r, 0, { ref: 'r' + r, quantize: 'off', dur: 0.05, follow: r === 3 ? 'goto' : 'next', followTarget: '0:0' });
  }
  const e = new CD.Engine({ decks: [deck] });
  e.launch('deck', 0, 0, 0, map);
  let overrun = 0;
  e.on((t) => t === 'overrun' && overrun++);
  let total = 0;
  for (let t = 0; t <= 2; t += 0.05) total += e.update(t, map);
  assert.ok(total < 10000, 'ateşleme sayısı patlamamalı, gelen: ' + total);
  for (let t = 0; t <= 2; t += 0.05) {
    assert.ok(e.update(t, map) <= e.maxFiresPerUpdate, 'kare başına sınır aşılmamalı');
  }
});

test('takip eylemi yokken klip her karede yeniden tetiklenmez', () => {
  const map = map120();
  const deck = CD.makeDeck({ rows: 2, cols: 1 });
  CD.setSlot(deck, 0, 0, { ref: 'a', quantize: 'off', dur: 0.1, follow: 'none' });
  const e = new CD.Engine({ decks: [deck] });
  e.launch('deck', 0, 0, 0, map);
  const fired = run(e, map, 0, 3, 0.05).filter((x) => x.type === 'fire');
  assert.strictEqual(fired.length, 1, 'yalnızca bir kez ateşlenmeli, gelen: ' + fired.length);
});

// ===========================================================================
// Durdurma
// ===========================================================================
test('sütun durdurma hem çalanı hem hazırlananı temizler', () => {
  const map = map120();
  const deck = CD.makeDeck({ rows: 4, cols: 2 });
  CD.setSlot(deck, 0, 0, { ref: 'a', quantize: 'off' });
  CD.setSlot(deck, 1, 0, { ref: 'b', quantize: 'bar' });
  CD.setSlot(deck, 0, 1, { ref: 'c', quantize: 'off' });
  const e = new CD.Engine({ decks: [deck] });
  e.launch('deck', 0, 0, 0, map);
  e.launch('deck', 0, 1, 0, map);
  e.update(0, map);
  e.launch('deck', 1, 0, 0.1, map);
  e.stopColumn('deck', 0);
  assert.strictEqual(e.armed.length, 0, '0. sütunun hazırlığı gitmeli');
  assert.strictEqual(e.activeSlots().length, 1, 'yalnızca 1. sütun çalıyor olmalı');
  assert.strictEqual(e.activeSlots()[0].slot.ref, 'c');
});

test('stopAll her şeyi durdurur', () => {
  const map = map120();
  const deck = CD.makeDeck({ rows: 4, cols: 3 });
  for (let c = 0; c < 3; c++) CD.setSlot(deck, 0, c, { ref: 'x' + c, quantize: 'off' });
  const e = new CD.Engine({ decks: [deck] });
  e.launchRow('deck', 0, 0, map);
  e.update(0, map);
  assert.strictEqual(e.activeSlots().length, 3);
  e.stopAll();
  assert.strictEqual(e.activeSlots().length, 0);
  assert.strictEqual(e.armed.length, 0);
});

// ===========================================================================
// Köprü — deste etkinliği çizelgeye
// ===========================================================================
test('deste etkinliği düzenlenebilir çizelge parçalarına dönüşür', () => {
  const rec = new CD.Recorder();
  const a = CD.makeSlot({ row: 0, col: 0, ref: 'a', type: 'scene' });
  const b = CD.makeSlot({ row: 1, col: 0, ref: 'b', type: 'video' });
  const c = CD.makeSlot({ row: 0, col: 1, ref: 'c', type: 'image' });
  rec.note('deck', a, 0);
  rec.note('deck', c, 1);
  rec.note('deck', b, 4); // aynı sütun: a'yı 4'te kapatır
  const tracks = rec.toTracks(8);

  assert.strictEqual(tracks.length, 2, 'sütun başına bir parça');
  const col0 = tracks.find((t) => t.name.indexOf(':0') >= 0);
  assert.strictEqual(col0.clips.length, 2);
  assert.strictEqual(col0.clips[0].ref, 'a');
  assert.strictEqual(col0.clips[0].start, 0);
  assert.strictEqual(col0.clips[0].dur, 4, 'a, b başlayınca bitmeli');
  assert.strictEqual(col0.clips[1].ref, 'b');
  assert.strictEqual(col0.clips[1].dur, 4, 'b kayıt sonuna kadar sürmeli');
});

test('kaydedilen kesme klipte de kesme kalır', () => {
  const rec = new CD.Recorder();
  rec.note('deck', CD.makeSlot({ row: 0, col: 0, ref: 'a', trigger: 'cut', fade: 3 }), 0);
  const tracks = rec.toTracks(2);
  assert.strictEqual(tracks[0].clips[0].fade, 0);
});

// ===========================================================================
// Bozuk girdiler
// ===========================================================================
test('bozuk yuva girdileri geçerli değerlere düşer', () => {
  for (const bad of [{}, { quantize: 'çöp' }, { follow: 'çöp' }, { fade: NaN }, { type: 'çöp' }, { dur: -1 }]) {
    const s = CD.makeSlot(bad);
    assert.ok(CD.QUANTIZE_IDS.indexOf(s.quantize) >= 0, 'niceleme geçersiz: ' + JSON.stringify(bad));
    assert.ok(CD.FOLLOW_ACTIONS.indexOf(s.follow) >= 0, 'takip geçersiz: ' + JSON.stringify(bad));
    assert.ok(CD.CLIP_TYPES.indexOf(s.type) >= 0, 'tür geçersiz: ' + JSON.stringify(bad));
    assert.ok(isFinite(s.fade) && s.fade >= 0, 'fade sonlu değil');
    assert.ok(s.dur === null || s.dur > 0, 'süre pozitif değil');
  }
});

test('her klip türünün makul bir varsayılan geçişi var', () => {
  for (const type of CD.CLIP_TYPES) {
    const s = CD.makeSlot({ type });
    assert.ok(isFinite(s.fade) && s.fade >= 0, type + ' için geçiş süresi yok');
  }
  assert.strictEqual(CD.makeSlot({ type: 'scene' }).fade, 0, 'sahne kendi geçiş motorunu kullanır');
  assert.ok(CD.makeSlot({ type: 'video' }).fade > 0, 'video sert kesilmemeli');
});

test('dinleyici hatası ateşlemeyi durdurmaz', () => {
  const map = map120();
  const deck = CD.makeDeck({ rows: 2, cols: 1 });
  CD.setSlot(deck, 0, 0, { ref: 'a', quantize: 'off' });
  const e = new CD.Engine({ decks: [deck] });
  let reached = false;
  e.on(() => {
    throw new Error('bozuk dinleyici');
  });
  e.on(() => {
    reached = true;
  });
  e.launch('deck', 0, 0, 0, map);
  e.update(0, map);
  assert.ok(reached, 'ikinci dinleyiciye ulaşılmalı');
});
