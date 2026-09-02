'use strict';
/* Bar tayfı motoru.

   En önemlisi "kilitli barlar" testi: eski algoritmanın gerçekten çakıştığını
   ve yenisinin çakışmadığını yan yana gösteriyor. Böylece test yalnızca yeni
   kodu doğrulamakla kalmıyor, düzeltilen hatayı da kaydediyor. */
const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/shared/spectrum.js');

const SR = 48000;
const FFT = 2048;
const BINS = FFT / 2;
const BIN_HZ = SR / FFT; // 23.4375

// Gerçekçi bir tayf: bas ağırlıklı, tepe noktaları olan düzgün bir eğri
function makeSpec() {
  const s = new Float32Array(BINS);
  for (let i = 0; i < BINS; i++) {
    const f = i * BIN_HZ;
    s[i] = Math.max(0, 0.9 * Math.exp(-f / 900) + 0.35 * Math.exp(-Math.pow((f - 2500) / 700, 2)));
  }
  return s;
}

function makeTone(freq, amp) {
  const t = new Float32Array(FFT);
  for (let i = 0; i < FFT; i++) t[i] = (amp == null ? 1 : amp) * Math.sin((2 * Math.PI * freq * i) / SR);
  return t;
}

// ------------------------------------------------------------- bant kenarı
test('bant kenarları artan ve uç noktalar tam', () => {
  for (const scale of S.SCALES) {
    const e = S.bandEdges(64, 30, 14000, scale);
    assert.strictEqual(e.length, 65, scale);
    assert.ok(Math.abs(e[0] - 30) < 1e-6, scale + ' alt uç: ' + e[0]);
    assert.ok(Math.abs(e[64] - 14000) < 1e-3, scale + ' üst uç: ' + e[64]);
    for (let i = 1; i < e.length; i++) assert.ok(e[i] > e[i - 1], scale + ' artan değil @' + i);
  }
});

test('logaritmik ölçekte kenar oranı sabit', () => {
  const e = S.bandEdges(32, 40, 16000, 'log');
  const r0 = e[1] / e[0];
  for (let i = 1; i < 32; i++) {
    assert.ok(Math.abs(e[i + 1] / e[i] - r0) < 1e-9, 'oran kaydı @' + i);
  }
});

test('doğrusal ölçekte kenar farkı sabit', () => {
  const e = S.bandEdges(20, 100, 1100, 'linear');
  for (let i = 0; i < 20; i++) assert.ok(Math.abs(e[i + 1] - e[i] - 50) < 1e-9);
});

test('mel ve bark ölçekleri bas bölgeye log ile doğrusal arasında yer verir', () => {
  // Ölçeklerin gerçekten FARKLI olması gerekir; aksi halde ayrı bir seçenek
  // olmalarının anlamı yok
  const mid = (sc) => S.bandEdges(64, 30, 14000, sc)[32];
  const lg = mid('log');
  const ln = mid('linear');
  const ml = mid('mel');
  const bk = mid('bark');
  assert.ok(lg < ml && ml < ln, `log ${lg} < mel ${ml} < linear ${ln}`);
  assert.ok(lg < bk && bk < ln, `log ${lg} < bark ${bk} < linear ${ln}`);
});

// --------------------------------------------------------------- Goertzel
test('Goertzel bilinen sinüsü doğru genlikte bulur', () => {
  const win = S.hannWindow(FFT);
  const v = S.goertzel(makeTone(440, 1), SR, 440, win);
  assert.ok(v > 0.8 && v < 1.2, '440 Hz genliği: ' + v);
});

test('Goertzel uzak frekansta neredeyse sıfır okur', () => {
  const win = S.hannWindow(FFT);
  const tone = makeTone(440, 1);
  const uzak = S.goertzel(tone, SR, 5000, win);
  const tam = S.goertzel(tone, SR, 440, win);
  assert.ok(uzak < tam / 100, `uzak ${uzak} vs tam ${tam}`);
});

test('Goertzel genlikle doğru orantılı', () => {
  const win = S.hannWindow(FFT);
  const a = S.goertzel(makeTone(1000, 0.25), SR, 1000, win);
  const b = S.goertzel(makeTone(1000, 0.5), SR, 1000, win);
  assert.ok(Math.abs(b / a - 2) < 0.02, 'oran: ' + b / a);
});

// -------------------------------------------------------- kilitli bar hatası
test('ESKİ eşleme düşük barları aynı kutuya düşürüyordu', () => {
  // Hatanın kendisi: tamsayı kutu aralığı, log ölçekte, 30 Hz'den başlayarak
  const eski = [];
  for (let b = 0; b < 64; b++) {
    const f0 = Math.exp(Math.log(30) + ((Math.log(14000) - Math.log(30)) * b) / 64);
    const f1 = Math.exp(Math.log(30) + ((Math.log(14000) - Math.log(30)) * (b + 1)) / 64);
    let i0 = Math.floor(f0 / BIN_HZ);
    const i1 = Math.max(i0, Math.floor(f1 / BIN_HZ) - 1);
    i0 = Math.max(0, i0);
    eski.push(i0 + '-' + i1);
  }
  const ilkBes = new Set(eski.slice(0, 5));
  assert.strictEqual(ilkBes.size, 1, 'ilk beş bar aynı kutu aralığını okumalıydı: ' + [...ilkBes]);
});

test('YENİ motorda düşük barlar birbirinden farklı değer üretir', () => {
  const eng = new S.BarEngine();
  const out = eng.compute(
    { spec: makeSpec(), binHz: BIN_HZ, time: makeTone(55, 0.8), sampleRate: SR },
    { count: 64, minFreq: 30, maxFreq: 14000, attack: 0, release: 0, dt: 1 }
  );
  const bas = Array.from(out.slice(0, 8));
  const benzersiz = new Set(bas.map((v) => v.toFixed(9)));
  assert.strictEqual(benzersiz.size, bas.length, 'ilk sekiz bar ayrışmalı: ' + bas.join(', '));
});

test('zaman verisi yoksa da düşük barlar ayrışır (kutu interpolasyonu)', () => {
  const eng = new S.BarEngine();
  const out = eng.compute(
    { spec: makeSpec(), binHz: BIN_HZ, sampleRate: SR },
    { count: 64, minFreq: 30, maxFreq: 14000, exact: false, attack: 0, release: 0, dt: 1 }
  );
  const bas = Array.from(out.slice(0, 8));
  assert.strictEqual(new Set(bas.map((v) => v.toFixed(9))).size, bas.length, bas.join(', '));
});

// --------------------------------------------------------------- dönüşümler
test('dB dönüşümü tabanda 0, tam ölçekte 1 ve arada artan', () => {
  assert.strictEqual(S.toDbUnit(0, -60), 0);
  assert.ok(Math.abs(S.toDbUnit(1, -60) - 1) < 1e-9);
  assert.ok(Math.abs(S.toDbUnit(0.001, -60) - 0) < 1e-9); // tam -60 dB
  let onceki = -1;
  for (const v of [0.001, 0.01, 0.05, 0.2, 0.5, 1]) {
    const u = S.toDbUnit(v, -60);
    assert.ok(u > onceki, 'artan değil @' + v);
    onceki = u;
  }
});

test('dB ölçeği sessiz ayrıntıyı doğrusaldan çok daha görünür yapar', () => {
  const v = 0.02;
  assert.ok(S.toDbUnit(v, -60) > v * 4, 'dB kazancı beklenenden az');
});

test('eğim 1 kHz noktasında nötr, oktav başına belirtilen dB kadar', () => {
  assert.ok(Math.abs(S.tiltGain(1000, 6) - 1) < 1e-9);
  // 6 dB tam olarak iki kat DEĞİL: 10^(6/20) = 1.9953. Tam iki kat 6.0206 dB.
  const oktav = Math.pow(10, 6 / 20);
  assert.ok(Math.abs(S.tiltGain(2000, 6) - oktav) < 1e-9, String(S.tiltGain(2000, 6)));
  assert.ok(Math.abs(S.tiltGain(500, 6) - 1 / oktav) < 1e-9);
  assert.ok(Math.abs(S.tiltGain(2000, 6.0206) - 2) < 1e-4, 'tam iki kat 6.0206 dB olmalı');
  assert.strictEqual(S.tiltGain(4000, 0), 1);
});

test('yayılım tepe yüksekliğini korur ve komşulara sönerek taşar', () => {
  const v = new Float32Array([0, 0, 1, 0, 0]);
  S.spread(v, 0.5);
  assert.strictEqual(v[2], 1, 'tepe ezilmemeli');
  assert.ok(Math.abs(v[1] - 0.5) < 1e-6);
  assert.ok(Math.abs(v[3] - 0.5) < 1e-6);
  assert.ok(Math.abs(v[0] - 0.25) < 1e-6);
});

test('yayılım sıfırken dizi değişmez', () => {
  const v = new Float32Array([0, 0.3, 1, 0.2, 0]);
  const kopya = Float32Array.from(v);
  S.spread(v, 0);
  assert.deepStrictEqual(Array.from(v), Array.from(kopya));
});

// --------------------------------------------------------------- balistik
test('atak bırakmadan hızlıysa yükseliş daha çabuk olur', () => {
  const yukselis = S.ballistic(0, 1, 1 / 60, 0.02, 0.4);
  const dusus = 1 - S.ballistic(1, 0, 1 / 60, 0.02, 0.4);
  assert.ok(yukselis > dusus, `yükseliş ${yukselis} düşüş ${dusus}`);
});

test('balistik kare hızından bağımsız', () => {
  // 120 fps'de iki adım, 60 fps'de bir adımla aynı yere varmalı
  let a = 0;
  a = S.ballistic(a, 1, 1 / 120, 0.05, 0.3);
  a = S.ballistic(a, 1, 1 / 120, 0.05, 0.3);
  const b = S.ballistic(0, 1, 1 / 60, 0.05, 0.3);
  assert.ok(Math.abs(a - b) < 1e-6, `120fps ${a} vs 60fps ${b}`);
});

test('sıfır zaman sabiti anında hedefe oturur', () => {
  assert.strictEqual(S.ballistic(0.3, 0.9, 1 / 60, 0, 0), 0.9);
});

// ------------------------------------------------------------------- motor
test('motor 0..1 aralığında ve istenen sayıda bar döner', () => {
  const eng = new S.BarEngine();
  for (const scale of S.SCALES) {
    for (const amplitude of ['linear', 'db']) {
      const out = eng.compute(
        { spec: makeSpec(), binHz: BIN_HZ, time: makeTone(220, 0.7), sampleRate: SR },
        { count: 48, scale, amplitude, spread: 0.4, tilt: 3, dt: 1 / 60 }
      );
      assert.strictEqual(out.length, 48, scale);
      for (let i = 0; i < out.length; i++) {
        assert.ok(out[i] >= 0 && out[i] <= 1, `${scale}/${amplitude} bar ${i} = ${out[i]}`);
        assert.ok(Number.isFinite(out[i]), `${scale}/${amplitude} bar ${i} sonlu değil`);
      }
    }
  }
});

test('motor aynı girdiye aynı çıktıyı verir', () => {
  const src = { spec: makeSpec(), binHz: BIN_HZ, time: makeTone(330, 0.6), sampleRate: SR };
  const opt = { count: 32, spread: 0.3, attack: 0, release: 0, dt: 1 };
  const a = Array.from(new S.BarEngine().compute(src, opt));
  const b = Array.from(new S.BarEngine().compute(src, opt));
  assert.deepStrictEqual(a, b);
});

test('bar sayısı değişince motor çöker değil, yeniden kurulur', () => {
  const eng = new S.BarEngine();
  const src = { spec: makeSpec(), binHz: BIN_HZ, time: makeTone(440, 0.5), sampleRate: SR };
  for (const count of [8, 64, 32, 128, 16]) {
    const out = eng.compute(src, { count, dt: 1 / 60 });
    assert.strictEqual(out.length, count);
  }
});

test('bozuk ayarlar varsayılana düşer', () => {
  const o = S.normalise({ scale: 'yok', amplitude: 'x', count: 0, spread: 9, gain: -2, floorDb: 5 });
  assert.strictEqual(o.scale, 'log');
  assert.strictEqual(o.amplitude, 'linear');
  assert.strictEqual(o.count, 1);
  assert.strictEqual(o.spread, 0.95);
  assert.strictEqual(o.gain, 1);
  assert.strictEqual(o.floorDb, -60);
});

test('boş tayf sıfır bar üretir, istisna atmaz', () => {
  const eng = new S.BarEngine();
  const out = eng.compute({ spec: new Float32Array(BINS), binHz: BIN_HZ, sampleRate: SR }, { count: 16, dt: 1 / 60 });
  for (let i = 0; i < out.length; i++) assert.strictEqual(out[i], 0);
});

test('tayftaki tepe, o frekansa denk gelen barda çıkar', () => {
  // Tek tepeli tayf: 2500 Hz dışında her yer sessiz
  const spec = new Float32Array(BINS);
  for (let i = 0; i < BINS; i++) {
    const f = i * BIN_HZ;
    spec[i] = 0.9 * Math.exp(-Math.pow((f - 2500) / 250, 2));
  }
  const eng = new S.BarEngine();
  const out = eng.compute(
    { spec, binHz: BIN_HZ, sampleRate: SR },
    { count: 64, minFreq: 30, maxFreq: 14000, exact: false, attack: 0, release: 0, dt: 1 }
  );
  const edges = S.bandEdges(64, 30, 14000, 'log');
  let hedef = 0;
  for (let b = 0; b < 64; b++) if (edges[b] <= 2500 && edges[b + 1] > 2500) hedef = b;
  let enYuksek = 0;
  for (let b = 0; b < 64; b++) if (out[b] > out[enYuksek]) enYuksek = b;
  assert.ok(Math.abs(enYuksek - hedef) <= 1, `tepe bar ${enYuksek}, beklenen ${hedef}`);
});

test('Goertzel yolu ile kutu yolu aynı sinyalde uyumlu okur', () => {
  // İki yol arasında geçiş yapan barlarda görünür bir basamak olmamalı
  const win = S.hannWindow(FFT);
  const tone = makeTone(300, 0.6);
  const g = S.goertzel(tone, SR, 300, win);
  // Aynı sinyalin kutu tayfı: 300 Hz kutusunun büyüklüğü
  const spec = new Float32Array(BINS);
  const merkez = Math.round(300 / BIN_HZ);
  spec[merkez] = g;
  const kutu = S.sampleBins(spec, BIN_HZ, merkez * BIN_HZ);
  assert.ok(Math.abs(kutu - g) < 1e-6, `kutu ${kutu} vs goertzel ${g}`);
});
