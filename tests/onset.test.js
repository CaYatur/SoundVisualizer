'use strict';
/* Onset algılayıcının testleri.
 *
 * Bu dosya doğrudan kullanıcının bildirdiği hatayı sınar: "parçacık ve dalgalı
 * ızgara tetiklendiğinde art arda tetiklemeleri görmüyor, bir kere tetikleniyor".
 * Eski mandal (`seviye > eşik && !öncekiKare`) yoğun bir parçada bir daha
 * kurulmadığı için tek tetikte kalıyordu; aşağıdaki "sürekli yüksek zemin"
 * testi tam olarak o durumu üretir. */
const test = require('node:test');
const assert = require('node:assert');
const { Onset } = require('../src/shared/onset.js');

/* Gerçekçi bas zarfı üretir: hızlı atak, yavaş sönüm — audio.js'in
 * asimetrik yumuşatmasının davranışı budur.
 *   beats  : vuruş zamanları (sn)
 *   floor  : vuruşlar arasında inilen taban seviye
 *   dur    : toplam süre (sn)
 *   fps    : kare hızı */
function envelope(beats, { floor = 0, dur = 4, fps = 60, peak = 0.95, decay = 3.2 } = {}) {
  const dt = 1 / fps;
  const out = [];
  for (let i = 0; i * dt < dur; i++) {
    const t = i * dt;
    let v = floor;
    for (const b of beats) {
      if (t < b) continue;
      const age = t - b;
      // atak 25 ms, sonra üstel sönüm
      const env = age < 0.025 ? age / 0.025 : Math.exp(-(age - 0.025) * decay);
      v = Math.max(v, floor + (peak - floor) * env);
    }
    out.push(v);
  }
  return { values: out, dt };
}

function run(sig, opts) {
  const det = new Onset(opts);
  const hits = [];
  for (let i = 0; i < sig.values.length; i++) {
    const s = det.push(sig.values[i], sig.dt);
    if (s > 0) hits.push({ t: i * sig.dt, s });
  }
  return { det, hits };
}

// ---------------------------------------------------------------------------
test('düzenli vuruşların hepsini yakalar (120 BPM, 8 vuruş)', () => {
  const beats = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0];
  const { hits } = run(envelope(beats, { dur: 4.6 }));
  assert.ok(hits.length >= 8, 'yakalanan vuruş: ' + hits.length + ' (beklenen ≥ 8)');
  assert.ok(hits.length <= 10, 'fazla tetik: ' + hits.length);
  // Her vuruşun 60 ms yakınında bir tetik olmalı
  for (const b of beats) {
    assert.ok(hits.some((h) => Math.abs(h.t - b) < 0.06), b + ' sn vuruşu kaçtı');
  }
});

test('SÜREKLİ YÜKSEK ZEMİN: seviye hiç düşmese de her vuruşta tetikler', () => {
  // Kullanıcının bildirdiği hata: yoğun parçada bas eşiğin altına inmiyor.
  // Eski `high && !wasHigh` mandalı burada TEK tetik üretiyordu.
  const beats = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5];
  const { hits } = run(envelope(beats, { floor: 0.72, dur: 4.0, peak: 0.98 }));
  assert.ok(hits.length >= 7, 'sürekli yüksek zeminde tetik sayısı: ' + hits.length);
});

test('uzun sessizlikten sonra art arda tetikleyebilir', () => {
  // 2.5 sn tam sessizlik, sonra hızlı dört vuruş
  const beats = [3.0, 3.3, 3.6, 3.9];
  const { hits } = run(envelope(beats, { dur: 4.4 }));
  const after = hits.filter((h) => h.t > 2.9);
  assert.strictEqual(after.length, 4, 'sessizlik sonrası tetik: ' + after.length);
});

test('hızlı ardışık vuruşlar (16lık, ~480 BPM) ayrı ayrı sayılır', () => {
  const beats = [];
  for (let i = 0; i < 12; i++) beats.push(0.4 + i * 0.125);
  const { hits } = run(envelope(beats, { dur: 2.4, decay: 9 }));
  assert.ok(hits.length >= 11, 'hızlı vuruşlarda tetik: ' + hits.length);
});

test('sessizlikte hiç tetiklemez', () => {
  const values = new Array(300).fill(0);
  const { hits } = run({ values, dt: 1 / 60 });
  assert.strictEqual(hits.length, 0, 'sessizlikte tetik: ' + hits.length);
});

test('sabit seviyede (hiç değişim yok) tetiklemez', () => {
  const values = new Array(300).fill(0.8);
  const { hits } = run({ values, dt: 1 / 60 });
  assert.strictEqual(hits.length, 0, 'sabit seviyede tetik: ' + hits.length);
});

test('kare hızından bağımsız: 30, 60 ve 144 fps aynı vuruşları bulur', () => {
  const beats = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
  const counts = [30, 60, 144].map((fps) => run(envelope(beats, { dur: 3.6, fps })).hits.length);
  const [a, b, c] = counts;
  assert.ok(Math.abs(a - b) <= 1 && Math.abs(b - c) <= 1,
    'kare hızına göre tetik sayıları farklı: ' + counts.join(', '));
  assert.ok(b >= 6, '60 fps tetik sayısı: ' + b);
});

test('refrakter süre tek vuruşu ikiye bölmez', () => {
  const { hits } = run(envelope([1.0], { dur: 2.0 }));
  assert.strictEqual(hits.length, 1, 'tek vuruş için tetik: ' + hits.length);
});

test('şiddet 0..1 aralığında ve güçlü vuruş daha yüksek', () => {
  const soft = run(envelope([0.5, 1.0, 1.5], { dur: 2.0, peak: 0.35 })).hits;
  const loud = run(envelope([0.5, 1.0, 1.5], { dur: 2.0, peak: 1.0 })).hits;
  for (const h of soft.concat(loud)) {
    assert.ok(h.s > 0 && h.s <= 1, 'şiddet aralık dışı: ' + h.s);
  }
  const avg = (a) => a.reduce((s, h) => s + h.s, 0) / Math.max(1, a.length);
  assert.ok(avg(loud) > avg(soft), 'güçlü vuruş daha yüksek şiddet vermeli');
});

test('spektrum akısı da art arda tetikler', () => {
  const det = new Onset();
  const dt = 1 / 60;
  const bars = new Float32Array(32);
  let hits = 0;
  for (let i = 0; i < 300; i++) {
    const t = i * dt;
    const beat = (t % 0.5) < 0.03;
    for (let b = 0; b < bars.length; b++) {
      bars[b] = 0.55 + (beat ? 0.4 : 0) * Math.exp(-b / 12);
    }
    if (det.pushSpectrum(bars, dt) > 0) hits++;
  }
  assert.ok(hits >= 8, 'spektrum akısıyla tetik: ' + hits);
});

test('reset() sayaçları ve durumu temizler', () => {
  const { det } = run(envelope([0.5, 1.0, 1.5], { dur: 2 }));
  assert.ok(det.count > 0);
  det.reset();
  assert.strictEqual(det.count, 0);
  assert.strictEqual(det.prev, 0);
  assert.strictEqual(det.energy, 0);
});

test('aynı girdi aynı tetikleri verir (dışa aktarım belirlenimliliği)', () => {
  const sig = envelope([0.5, 1.0, 1.5, 2.0], { dur: 2.6 });
  const a = run(sig).hits;
  const b = run(sig).hits;
  assert.deepStrictEqual(a, b, 'aynı girdi farklı tetik üretti');
});
