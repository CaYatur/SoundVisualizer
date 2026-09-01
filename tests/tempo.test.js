'use strict';
/* Tempo motorunun ve Art-Net paketleyicisinin testleri.
 *
 * BPM kestirimi iddialı bir özelliktir: "tempoyu buluyor" demek kolay,
 * kanıtlamak zordur. Burada BİLİNEN tempolu sentetik sinyaller üretilip
 * motorun onları bulup bulmadığı ölçülür.
 *
 * Art-Net tarafında paket düzeni bayt bayt doğrulanır — yanlış bir başlık
 * alanı sahada sessizce "hiçbir ışık yanmıyor" olarak görünürdü.
 */
const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/shared/tempo.js');
const artnet = require('../src/main/artnet.js');

// ---------------------------------------------------------------------------
// Sahte ses motoru: verilen BPM'de vuruş üreten bir spektrum döndürür.
// SVAudio'nun tempo motorunca kullanılan yüzeyi yalnızca getBars + ready.
// ---------------------------------------------------------------------------
function makeAudio(bpm, opts) {
  const o = opts || {};
  const period = 60 / bpm;
  const n = 96;
  const bars = new Float32Array(n);
  return {
    ready: true,
    t: 0,
    getBars() {
      const phase = (this.t % period) / period;
      // Vuruşta keskin, aralarda düşük enerji — gerçek bir kick zarfına benzer
      const kick = Math.pow(Math.max(0, 1 - phase * (o.sharp || 14)), 2);
      for (let i = 0; i < n; i++) {
        const f = i / n;
        const base = 0.05 + 0.05 * Math.sin(this.t * 2 + i);
        bars[i] = base + kick * Math.exp(-f * 5) * 0.9;
      }
      return bars;
    },
  };
}

// Motoru sabit kare hızıyla belirtilen süre kadar sürer
function run(tempo, audio, seconds, fps) {
  const dt = 1 / (fps || 60);
  const steps = Math.round(seconds / dt);
  let beats = 0;
  for (let i = 0; i < steps; i++) {
    audio.t = i * dt;
    if (tempo.update(audio, audio.t, dt)) beats++;
  }
  return beats;
}

// ---------------------------------------------------------------------------
test('oktav katlama: her tempo 60–180 aralığına iner', () => {
  assert.strictEqual(T.octaveFold(120), 120);
  assert.strictEqual(T.octaveFold(240), 120);
  assert.strictEqual(T.octaveFold(60), 60);
  assert.strictEqual(T.octaveFold(30), 60); // 60 zaten aralıkta, orada durur
  assert.strictEqual(T.octaveFold(480), 120);
  const v = T.octaveFold(200);
  assert.ok(v >= T.MIN_BPM && v <= T.MAX_BPM, '200 → ' + v);
  assert.strictEqual(T.octaveFold(0), 0);
  assert.strictEqual(T.octaveFold(NaN), 0);
});

test('BPM kestirimi: bilinen tempoyu ±4 BPM içinde buluyor', () => {
  for (const bpm of [90, 120, 128, 140, 174]) {
    const tempo = new T.Tempo();
    const audio = makeAudio(bpm);
    const beats = run(tempo, audio, 14);
    assert.ok(beats > 10, bpm + ' BPM: yeterli vuruş bulunamadı (' + beats + ')');
    const found = T.octaveFold(tempo.bpm);
    const expect = T.octaveFold(bpm);
    assert.ok(
      Math.abs(found - expect) <= 4,
      bpm + ' BPM bekleniyordu, bulunan ' + found.toFixed(1)
    );
  }
});

test('vuruş sayısı gerçek tempoyla tutarlı', () => {
  // 120 BPM × 12 saniye = 24 vuruş. Onset algılama başlangıçta ısınır,
  // bu yüzden ±3 tolerans veriliyor.
  const tempo = new T.Tempo();
  const beats = run(tempo, makeAudio(120), 12);
  assert.ok(Math.abs(beats - 24) <= 3, '24 vuruş bekleniyordu, bulunan ' + beats);
});

test('ölçü sayacı beatsPerBar kadar vuruşta bir başa dönüyor', () => {
  const tempo = new T.Tempo();
  tempo.beatsPerBar = 4;
  const audio = makeAudio(120);
  const dt = 1 / 60;
  const positions = [];
  for (let i = 0; i < Math.round(10 / dt); i++) {
    audio.t = i * dt;
    if (tempo.update(audio, audio.t, dt)) positions.push(tempo.barPosition);
  }
  assert.ok(positions.length > 8, 'yeterli vuruş yok');
  for (const p of positions) assert.ok(p >= 0 && p < 4, 'ölçü konumu aralık dışı: ' + p);
  // Ardışık konumlar 1 artmalı (mod 4)
  for (let i = 1; i < positions.length; i++) {
    assert.strictEqual(positions[i], (positions[i - 1] + 1) % 4, 'ölçü konumu sırası bozuk');
  }
});

test('elle tempo (tap): dört vuruşluk seri BPM veriyor', () => {
  const tempo = new T.Tempo();
  // 0.5 sn aralık = 120 BPM
  [0, 0.5, 1.0, 1.5, 2.0].forEach((t) => tempo.tap(t));
  assert.ok(Math.abs(tempo.bpm - 120) < 1, 'tap 120 BPM vermeli, veren: ' + tempo.bpm);
  assert.strictEqual(tempo.locked, tempo.bpm, 'tap tempoyu kilitlemeli');
  // 2 saniyeden uzun boşluk yeni seri başlatır
  tempo.tap(10);
  assert.strictEqual(tempo.taps.length, 1, 'uzun boşluk seriyi sıfırlamalı');
});

test('sessizlikte vuruş üretmiyor', () => {
  const tempo = new T.Tempo();
  const silent = {
    ready: true,
    getBars() { return new Float32Array(96); },
  };
  let beats = 0;
  for (let i = 0; i < 600; i++) if (tempo.update(silent, i / 60, 1 / 60)) beats++;
  assert.strictEqual(beats, 0, 'sessizlikte ' + beats + ' vuruş bulundu');
});

// ---------------------------------------------------------------------------
// ART-NET
// ---------------------------------------------------------------------------
test('ArtDMX paketi: başlık düzeni protokole uygun', () => {
  const cfg = { universe: 5, fixtures: 4, channelsPerFixture: 3, startChannel: 1, brightness: 1, mode: 'single', color: '#ffffff' };
  const data = artnet.buildChannels(cfg, { level: 1 });
  const pkt = artnet.buildPacket(cfg, data);

  assert.strictEqual(pkt.slice(0, 8).toString('ascii'), 'Art-Net\0', 'kimlik dizesi');
  assert.strictEqual(pkt.readUInt16LE(8), 0x5000, 'OpCode ArtDMX (little-endian)');
  assert.strictEqual(pkt.readUInt16BE(10), 14, 'protokol sürümü (big-endian)');
  assert.strictEqual(pkt.readUInt8(13), 0, 'physical');
  assert.strictEqual(pkt.readUInt8(14), 5, 'SubUni');
  assert.strictEqual(pkt.readUInt8(15), 0, 'Net');
  assert.strictEqual(pkt.readUInt16BE(16), data.length, 'uzunluk alanı (big-endian)');
  assert.strictEqual(pkt.length, 18 + data.length, 'toplam paket boyu');
  assert.strictEqual(data.length % 2, 0, 'DMX veri uzunluğu çift olmalı');
});

test('DMX kanalları: tek renk kipi doğru baytları yazıyor', () => {
  const cfg = {
    universe: 0, fixtures: 2, channelsPerFixture: 3, startChannel: 1,
    brightness: 1, mode: 'single', color: '#ff8000',
  };
  const d = artnet.buildChannels(cfg, { level: 1 });
  // level=1 → k = min(1, 1.6) = 1 → renk aynen
  assert.strictEqual(d[0], 255, 'R');
  assert.strictEqual(d[1], 128, 'G');
  assert.strictEqual(d[2], 0, 'B');
  assert.strictEqual(d[3], 255, 'ikinci aygıt R');
});

test('DMX kanalları: parlaklık ve başlangıç kanalı uygulanıyor', () => {
  const cfg = {
    universe: 0, fixtures: 1, channelsPerFixture: 3, startChannel: 10,
    brightness: 0.5, mode: 'single', color: '#ffffff',
  };
  const d = artnet.buildChannels(cfg, { level: 1 });
  for (let i = 0; i < 9; i++) assert.strictEqual(d[i], 0, 'kanal ' + (i + 1) + ' boş kalmalı');
  assert.strictEqual(d[9], 128, '10. kanal (%50 parlaklık)');
});

test('DMX kanalları: RGBW beyaz kanalı en küçük bileşenden türetiliyor', () => {
  const cfg = {
    universe: 0, fixtures: 1, channelsPerFixture: 4, startChannel: 1,
    brightness: 1, mode: 'single', color: '#ff8040',
  };
  const d = artnet.buildChannels(cfg, { level: 1 });
  assert.strictEqual(d[0], 255);
  assert.strictEqual(d[1], 128);
  assert.strictEqual(d[2], 64);
  assert.strictEqual(d[3], 64, 'W = min(R,G,B)');
});

test('DMX kanalları: 512 sınırı aşılmıyor', () => {
  const cfg = {
    universe: 0, fixtures: 200, channelsPerFixture: 4, startChannel: 400,
    brightness: 1, mode: 'palette',
  };
  const d = artnet.buildChannels(cfg, { level: 0.5, backgroundColors: ['#ffffff'] });
  assert.ok(d.length <= 512, 'DMX evreni 512 kanaldan uzun olamaz, bulunan ' + d.length);
});
