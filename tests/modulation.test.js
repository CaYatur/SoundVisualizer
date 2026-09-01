'use strict';
/* Modülasyon matrisi testleri.
 *
 * Motor tamamen aritmetik olduğu için GPU gerekmez; kaynak değerleri, eğriler,
 * yönlendirme uygulaması, değişmezlik ve belirlenimlilik burada bire bir
 * ölçülebilir. Belirlenimlilik özellikle önemli: çevrimdışı dışa aktarımın
 * kare kare tekrarlanabilirliği tüm görsel regresyon ağının dayanağı. */
const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/shared/modulation.js');

const EPS = 1e-9;
const close = (a, b, msg, eps) =>
  assert.ok(Math.abs(a - b) <= (eps || 1e-9), `${msg}: ${a} ≠ ${b}`);

// Basit ses vekili: sabit bantlar, istenirse kare kare değişen
function stubAudio(over) {
  return Object.assign({
    bass: 0.5, mid: 0.4, treble: 0.3, level: 0.45,
    getBars: (n) => {
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = 0.2 + i * 0.05;
      return out;
    },
  }, over || {});
}

function baseCfg(over) {
  return Object.assign({
    visualizer: { sensitivity: 1, barCount: 64, glow: 0.3 },
    geometry: { spin: 0.2, zoom: 1 },
    postfx: [{ type: 'bloom', enabled: true, params: { strength: 0.4 } }],
    modulation: {
      enabled: true,
      routes: [],
      lfos: [{}, {}, {}, {}],
      envelopes: [{}, {}],
      macros: [],
      random: {},
    },
  }, over || {});
}

// ===========================================================================
// Eğriler
// ===========================================================================
test('eğriler 0 ve 1 uçlarını korur ve artan', () => {
  for (const id of M.CURVE_IDS) {
    if (id === 'abs') continue; // abs simetrik, uç koşulu farklı
    const f = M.CURVES[id];
    close(f(0), 0, id + ' f(0)');
    close(f(1), 1, id + ' f(1)', 1e-12);
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const y = f(i / 20);
      assert.ok(y >= prev - 1e-12, id + ' azalıyor: ' + y + ' < ' + prev);
      assert.ok(y >= -1e-12 && y <= 1 + 1e-12, id + ' aralık dışı: ' + y);
      prev = y;
    }
  }
});

// ===========================================================================
// LFO dalga biçimleri
// ===========================================================================
test('LFO dalga biçimleri tanımlarından birebir', () => {
  close(M.SHAPES.sine(0), 0, 'sine(0)');
  close(M.SHAPES.sine(0.25), 1, 'sine(0.25)', 1e-12);
  close(M.SHAPES.sine(0.75), -1, 'sine(0.75)', 1e-12);
  close(M.SHAPES.triangle(0), -1, 'triangle(0)');
  close(M.SHAPES.triangle(0.5), 1, 'triangle(0.5)');
  close(M.SHAPES.sawUp(0), -1, 'sawUp(0)');
  close(M.SHAPES.sawUp(0.999999), 1, 'sawUp(~1)', 1e-5);
  close(M.SHAPES.sawDown(0), 1, 'sawDown(0)');
  close(M.SHAPES.square(0.25), 1, 'square(0.25)');
  close(M.SHAPES.square(0.75), -1, 'square(0.75)');
  close(M.SHAPES.pulse(0.1, 0.25), 1, 'pulse dar bölge');
  close(M.SHAPES.pulse(0.5, 0.25), -1, 'pulse geniş bölge');
});

test('LFO dalga biçimleri -1..1 aralığında kalır', () => {
  for (const id of M.SHAPE_IDS) {
    for (let i = 0; i < 500; i++) {
      const y = M.SHAPES[id](i * 0.0137, 0.3, 11);
      assert.ok(y >= -1 - 1e-12 && y <= 1 + 1e-12, id + ' aralık dışı: ' + y);
    }
  }
});

test('rastgele dalga biçimleri tohumlu ve tekrarlanabilir', () => {
  for (let i = 0; i < 50; i++) {
    close(M.SHAPES.stepRandom(i * 0.37, 0, 5), M.SHAPES.stepRandom(i * 0.37, 0, 5), 'stepRandom kararlı');
    close(M.SHAPES.smoothRandom(i * 0.37, 0, 5), M.SHAPES.smoothRandom(i * 0.37, 0, 5), 'smoothRandom kararlı');
  }
  // Farklı tohum farklı dizi vermeli
  const a = M.SHAPES.stepRandom(3.2, 0, 1);
  const b = M.SHAPES.stepRandom(3.2, 0, 2);
  assert.notStrictEqual(a, b, 'tohum diziyi değiştirmiyor');
});

test('nota bölümleri tempo ile doğru Hz veriyor', () => {
  // 120 BPM = saniyede 2 vuruş. 1/4 nota = 1 vuruş -> 2 Hz
  const bpm = 120;
  const hz = (div) => bpm / 60 / M.divisionBeats(div);
  close(hz('1/4'), 2, '1/4 @120bpm');
  close(hz('1/8'), 4, '1/8 @120bpm');
  close(hz('1/1'), 0.5, '1/1 @120bpm (bir ölçü)');
  close(hz('1/2'), 1, '1/2 @120bpm');
});

// ===========================================================================
// Yol yardımcıları — değişmezlik
// ===========================================================================
test('setIn kaynağı değiştirmez, yalnızca yolu kopyalar', () => {
  const src = { a: { b: { c: 1 }, keep: { x: 2 } }, other: [1, 2] };
  const out = M.setIn(src, 'a.b.c', 9);
  assert.strictEqual(src.a.b.c, 1, 'kaynak değişti');
  assert.strictEqual(out.a.b.c, 9, 'hedef yazılmadı');
  assert.notStrictEqual(out.a, src.a, 'yol üzerindeki nesne kopyalanmadı');
  assert.notStrictEqual(out.a.b, src.a.b, 'yol üzerindeki nesne kopyalanmadı');
  assert.strictEqual(out.a.keep, src.a.keep, 'dokunulmayan dal gereksiz kopyalandı');
  assert.strictEqual(out.other, src.other, 'dokunulmayan dal gereksiz kopyalandı');
});

test('setIn dizilerde de çalışır', () => {
  const src = { postfx: [{ params: { strength: 0.2 } }] };
  const out = M.setIn(src, 'postfx.0.params.strength', 0.8);
  assert.strictEqual(src.postfx[0].params.strength, 0.2);
  assert.strictEqual(out.postfx[0].params.strength, 0.8);
  assert.ok(Array.isArray(out.postfx), 'dizi nesneye dönüştü');
});

test('setIn olmayan yola yazmaz', () => {
  const src = { a: 1 };
  assert.strictEqual(M.setIn(src, 'yok.bir.yol', 5), src, 'olmayan yol için yeni nesne üretildi');
});

// ===========================================================================
// Yönlendirme uygulaması
// ===========================================================================
test('yönlendirme hedefi min..max aralığına oturtur', () => {
  const mod = new M.Modulator();
  const cfg = baseCfg();
  cfg.modulation.routes = [
    { id: 'r1', source: 'bass', target: 'geometry.spin', min: -2, max: 2 },
  ];
  mod.update(cfg, stubAudio({ bass: 1 }), 0, 1 / 60);
  const out = mod.apply(cfg, 1 / 60);
  close(out.geometry.spin, 2, 'bass=1 -> max');

  mod.update(cfg, stubAudio({ bass: 0 }), 0.016, 1 / 60);
  const out2 = mod.apply(cfg, 1 / 60);
  close(out2.geometry.spin, -2, 'bass=0 -> min');

  assert.strictEqual(cfg.geometry.spin, 0.2, 'saklanan yapılandırma değişti');
});

test('add ve mul kipleri taban değeri üzerinden çalışır', () => {
  const mod = new M.Modulator();
  const cfg = baseCfg();
  cfg.modulation.routes = [
    { id: 'a', source: 'const', target: 'geometry.zoom', mode: 'add', min: 0, max: 1, amount: 0.5, clamp: false },
  ];
  mod.update(cfg, stubAudio(), 0, 1 / 60);
  close(mod.apply(cfg, 1 / 60).geometry.zoom, 1.5, 'add: 1 + 1*0.5');

  cfg.modulation.routes = [
    { id: 'm', source: 'const', target: 'geometry.zoom', mode: 'mul', amount: 0.5, clamp: false },
  ];
  mod.update(cfg, stubAudio(), 0, 1 / 60);
  // const = 1 -> shaped 1 -> (1*2-1)=1 -> zoom * (1 + 1*0.5)
  close(mod.apply(cfg, 1 / 60).geometry.zoom, 1.5, 'mul: 1 * 1.5');
});

test('amount 0 hedefi değiştirmez', () => {
  const mod = new M.Modulator();
  const cfg = baseCfg();
  cfg.modulation.routes = [{ id: 'r', source: 'const', target: 'geometry.spin', min: 0, max: 5, amount: 0 }];
  mod.update(cfg, stubAudio(), 0, 1 / 60);
  close(mod.apply(cfg, 1 / 60).geometry.spin, 0.2, 'amount=0');
});

test('sayısal olmayan ve olmayan hedefler atlanır', () => {
  const mod = new M.Modulator();
  const cfg = baseCfg();
  cfg.modulation.routes = [
    { id: 'a', source: 'const', target: 'modulation.routes' },   // dizi
    { id: 'b', source: 'const', target: 'yok.bir.sey' },          // yok
    { id: 'c', source: 'const', target: 'geometry.spin', min: 0, max: 1 }, // geçerli
  ];
  mod.update(cfg, stubAudio(), 0, 1 / 60);
  const out = mod.apply(cfg, 1 / 60);
  close(out.geometry.spin, 1, 'geçerli yönlendirme uygulanmadı');
  assert.ok(Array.isArray(out.modulation.routes), 'dizi hedefi bozuldu');
});

test('devre dışı yönlendirme ve kapalı matris uygulanmaz', () => {
  const mod = new M.Modulator();
  const cfg = baseCfg();
  cfg.modulation.routes = [{ id: 'r', source: 'const', target: 'geometry.spin', min: 0, max: 9, enabled: false }];
  mod.update(cfg, stubAudio(), 0, 1 / 60);
  close(mod.apply(cfg, 1 / 60).geometry.spin, 0.2, 'devre dışı yönlendirme uygulandı');

  cfg.modulation.routes[0].enabled = true;
  cfg.modulation.enabled = false;
  mod.update(cfg, stubAudio(), 0, 1 / 60);
  close(mod.apply(cfg, 1 / 60).geometry.spin, 0.2, 'kapalı matris uygulandı');
});

test('touches() dokunulan üst düzey alanı bildirir', () => {
  const mod = new M.Modulator();
  const cfg = baseCfg();
  cfg.modulation.routes = [{ id: 'r', source: 'bass', target: 'postfx.0.params.strength', min: 0, max: 1 }];
  mod.update(cfg, stubAudio(), 0, 1 / 60);
  mod.apply(cfg, 1 / 60);
  assert.ok(mod.touches('postfx'), 'postfx dokunuşu bildirilmedi');
  assert.ok(!mod.touches('geometry'), 'dokunulmayan alan bildirildi');
});

test('basamaklama (steps) değeri ayrıklaştırır', () => {
  const mod = new M.Modulator();
  const cfg = baseCfg();
  cfg.modulation.routes = [{ id: 'r', source: 'bass', target: 'geometry.spin', min: 0, max: 1, steps: 3 }];
  const seen = new Set();
  for (let i = 0; i <= 20; i++) {
    mod.update(cfg, stubAudio({ bass: i / 20 }), i / 60, 1 / 60);
    seen.add(+mod.apply(cfg, 1 / 60).geometry.spin.toFixed(6));
  }
  assert.deepStrictEqual([...seen].sort((a, b) => a - b), [0, 0.5, 1], 'basamaklar: ' + [...seen].join(','));
});

// ===========================================================================
// Zarf takipçisi
// ===========================================================================
test('zarf takipçisi atak ve bırakma sürelerine uyar', () => {
  const mod = new M.Modulator();
  const cfg = baseCfg();
  cfg.modulation.envelopes = [{ band: 'bass', attack: 0.05, release: 0.5 }, {}];
  const dt = 1 / 200;
  // 0'dan 1'e sıçra, bir atak sabiti kadar bekle -> ~%63
  let t = 0;
  for (let i = 0; i < 10; i++) { mod.update(cfg, stubAudio({ bass: 0 }), t, dt); t += dt; }
  for (let i = 0; i < Math.round(0.05 / dt); i++) { mod.update(cfg, stubAudio({ bass: 1 }), t, dt); t += dt; }
  const afterAttack = mod.value('env1');
  assert.ok(afterAttack > 0.55 && afterAttack < 0.72, 'atak sonrası: ' + afterAttack);

  // Sonra sıfıra düş, bir bırakma sabiti kadar bekle -> ~%37 kalmalı
  const peak = afterAttack;
  for (let i = 0; i < Math.round(0.5 / dt); i++) { mod.update(cfg, stubAudio({ bass: 0 }), t, dt); t += dt; }
  const afterRelease = mod.value('env1');
  assert.ok(afterRelease < peak * 0.45 && afterRelease > peak * 0.3, 'bırakma sonrası: ' + afterRelease);
});

test('zarf kare hızından bağımsız', () => {
  const run = (fps) => {
    const mod = new M.Modulator();
    const cfg = baseCfg();
    cfg.modulation.envelopes = [{ band: 'bass', attack: 0.08, release: 0.4 }, {}];
    const dt = 1 / fps;
    for (let t = 0; t < 0.24; t += dt) mod.update(cfg, stubAudio({ bass: 1 }), t, dt);
    return mod.value('env1');
  };
  const a = run(30), b = run(60), c = run(240);
  assert.ok(Math.abs(a - b) < 0.03 && Math.abs(b - c) < 0.03, 'kare hızına duyarlı: ' + [a, b, c].join(', '));
});

// ===========================================================================
// Makrolar
// ===========================================================================
test('bir makro birden çok hedefi aynı anda sürer', () => {
  const mod = new M.Modulator();
  const cfg = baseCfg();
  cfg.modulation.macros = [{ name: 'Yoğunluk', value: 1 }];
  cfg.modulation.routes = [
    { id: 'a', source: 'macro1', target: 'visualizer.glow', min: 0, max: 1 },
    { id: 'b', source: 'macro1', target: 'geometry.zoom', min: 1, max: 3 },
    { id: 'c', source: 'macro1', target: 'postfx.0.params.strength', min: 0, max: 2 },
  ];
  mod.update(cfg, stubAudio(), 0, 1 / 60);
  const out = mod.apply(cfg, 1 / 60);
  close(out.visualizer.glow, 1, 'makro -> glow');
  close(out.geometry.zoom, 3, 'makro -> zoom');
  close(out.postfx[0].params.strength, 2, 'makro -> efekt');
});

// ===========================================================================
// Belirlenimlilik — dışa aktarım buna dayanıyor
// ===========================================================================
test('aynı (t, dt) dizisi aynı değerleri üretir', () => {
  const cfg = baseCfg();
  cfg.modulation.lfos = [
    { shape: 'sine', rate: 0.7 }, { shape: 'stepRandom', rate: 2 },
    { shape: 'smoothRandom', rate: 1.3 }, { shape: 'square', sync: true, division: '1/8' },
  ];
  cfg.modulation.random = { rate: 3 };
  cfg.modulation.routes = [
    { id: 'a', source: 'lfo1', target: 'geometry.spin', min: -1, max: 1 },
    { id: 'b', source: 'lfo2', target: 'geometry.zoom', min: 0.5, max: 2, smooth: 0.1 },
    { id: 'c', source: 'random', target: 'visualizer.glow', min: 0, max: 1 },
  ];
  const run = () => {
    const mod = new M.Modulator();
    const out = [];
    for (let i = 0; i < 240; i++) {
      const t = i / 60;
      mod.update(cfg, stubAudio({ bass: 0.3 + 0.2 * Math.sin(i) }), t, 1 / 60);
      const c = mod.apply(cfg, 1 / 60);
      out.push([c.geometry.spin, c.geometry.zoom, c.visualizer.glow]);
    }
    return out;
  };
  assert.deepStrictEqual(run(), run(), 'aynı girdi farklı çıktı verdi');
});

test('LFO doğrudan t üzerinden hesaplanır (kare atlanınca kaymaz)', () => {
  const cfg = baseCfg();
  cfg.modulation.lfos = [{ shape: 'sine', rate: 1, bipolar: true }, {}, {}, {}];
  const a = new M.Modulator();
  const b = new M.Modulator();
  // a her kareyi görür, b yalnızca her ikinci kareyi
  for (let i = 0; i <= 120; i++) a.update(cfg, stubAudio(), i / 60, 1 / 60);
  for (let i = 0; i <= 120; i += 2) b.update(cfg, stubAudio(), i / 60, 2 / 60);
  close(a.value('lfo1'), b.value('lfo1'), 'LFO kare atlanınca kaydı', 1e-9);
});

test('yumuşatma kare hızından bağımsız', () => {
  const cfg = baseCfg();
  cfg.modulation.routes = [{ id: 'r', source: 'const', target: 'geometry.spin', min: 0, max: 1, smooth: 0.2 }];
  const run = (fps) => {
    const mod = new M.Modulator();
    const dt = 1 / fps;
    let last = 0;
    for (let t = 0; t < 0.2; t += dt) {
      mod.update(cfg, stubAudio(), t, dt);
      last = mod.apply(cfg, dt).geometry.spin;
    }
    return last;
  };
  const a = run(30), b = run(60), c = run(144);
  assert.ok(Math.abs(a - b) < 0.05 && Math.abs(b - c) < 0.05, 'kare hızına duyarlı: ' + [a, b, c].join(', '));
});

// ===========================================================================
// Katalog
// ===========================================================================
test('katalog tüm kaynakları ve grupları listeler', () => {
  const cfg = baseCfg();
  const cat = M.catalog(cfg);
  const ids = new Set(cat.map((c) => c.id));
  for (const need of ['bass', 'mid', 'treble', 'level', 'onset', 'band0', 'band7',
    'lfo1', 'lfo4', 'env1', 'env2', 'macro1', 'macro8', 'random', 'time', 'beatPhase', 'const']) {
    assert.ok(ids.has(need), 'katalogda yok: ' + need);
  }
  for (const c of cat) {
    assert.ok(c.label && c.group, c.id + ': etiket/grup eksik');
  }
});

test('katalogdaki her kaynak update sonrası sayısal değer üretir', () => {
  const mod = new M.Modulator();
  const cfg = baseCfg();
  cfg.modulation.macros = [{ value: 0.5 }];
  mod.update(cfg, stubAudio(), 1.234, 1 / 60);
  for (const c of M.catalog(cfg)) {
    const v = mod.value(c.id);
    assert.ok(typeof v === 'number' && isFinite(v), c.id + ' sayısal değil: ' + v);
    const lo = c.bipolar ? -1 : 0;
    assert.ok(v >= lo - 1e-9 && v <= 1 + 1e-9, c.id + ' aralık dışı: ' + v);
  }
});

test('makro adı katalogda görünür', () => {
  const cfg = baseCfg();
  cfg.modulation.macros = [{ name: 'Enerji', value: 0.3 }];
  const cat = M.catalog(cfg);
  assert.strictEqual(cat.find((c) => c.id === 'macro1').label, 'Enerji');
});

// ===========================================================================
// Vuruş fazı
// ===========================================================================
test('vuruş fazı tempoya göre ilerler ve 0..1 aralığında döner', () => {
  const mod = new M.Modulator();
  const cfg = baseCfg();
  cfg.modulation.bpm = 120; // saniyede 2 vuruş
  const dt = 1 / 240;
  let wraps = 0;
  let prev = 0;
  // 1.25 saniye = 2.5 vuruş. Tam vuruş sınırında bitirmek kayan nokta yüzünden
  // sarmayı bir eksik saydırabiliyor; bu yüzden sınırdan uzak bir süre seçildi.
  for (let i = 1; i <= 300; i++) {
    mod.update(cfg, stubAudio(), i * dt, dt);
    const p = mod.value('beatPhase');
    assert.ok(p >= 0 && p < 1, 'faz aralık dışı: ' + p);
    if (p < prev) wraps++;
    prev = p;
  }
  assert.strictEqual(wraps, 2, '120 BPM 1.25 saniyede 2 kez sarmalı, bulundu: ' + wraps);
  // Ölçü fazı dört vuruşta bir sarar: 2.5 vuruşta henüz sarmamış olmalı
  close(mod.value('barPhase'), 2.5 / 4, 'ölçü fazı', 1e-6);
});

test('dışarıdan verilen saat vuruş fazını belirler', () => {
  const mod = new M.Modulator();
  const cfg = baseCfg();
  mod.update(cfg, stubAudio(), 0, 1 / 60, { bpm: 174, beatPhase: 0.42, barPhase: 0.11 });
  close(mod.value('beatPhase'), 0.42, 'dış saat vuruş fazı');
  close(mod.value('barPhase'), 0.11, 'dış saat ölçü fazı');
});

// ===========================================================================
// Vuruş tetiği
// ===========================================================================
test('vuruş tetiği bas darbelerinde ateşler', () => {
  const mod = new M.Modulator();
  const cfg = baseCfg();
  const dt = 1 / 60;
  let fired = 0;
  for (let i = 0; i < 300; i++) {
    const t = i * dt;
    // 0.5 sn'de bir hızlı atak
    const age = t % 0.5;
    const bass = age < 0.03 ? age / 0.03 : Math.exp(-(age - 0.03) * 4);
    mod.update(cfg, stubAudio({ bass }), t, dt);
    if (mod.trigger('onsetTrig') > 0) fired++;
  }
  assert.ok(fired >= 8, 'vuruş tetiği sayısı: ' + fired);
});

test('reset() durumu temizler', () => {
  const mod = new M.Modulator();
  const cfg = baseCfg();
  mod.update(cfg, stubAudio(), 1, 1 / 60);
  assert.ok(mod.frame > 0);
  mod.reset();
  assert.strictEqual(mod.frame, 0);
  assert.deepStrictEqual(mod.values, {});
});
