'use strict';
/* Telefonun sesi → bilgisayarın ses girişi (src/main/link-audio.js, PC bağlantısı B4): paket
 * biçimi ve sınırları, karenin ses zamanına göre (saniyede 60) çıkması, tayfın doğru frekansı
 * göstermesi, iki kanalın ayrı taşınması, kayıp paketlerin sayılması. Kare, canlı yakalama
 * yardımcısıyla aynı ortak hesaptan (src/shared/audio-spectrum.js) gelir. */
const test = require('node:test');
const assert = require('node:assert');
const LA = require('../src/main/link-audio.js');
const F = require('../src/main/audio-frame.js');

function sine(rate, ch, n, hz, start, ampL, ampR) {
  const out = new Int16Array(n * ch);
  for (let i = 0; i < n; i++) {
    const v = Math.sin((2 * Math.PI * hz * (start + i)) / rate);
    out[i * ch] = Math.round(v * (ampL == null ? 0.5 : ampL) * 32767);
    if (ch === 2) out[i * ch + 1] = Math.round(v * (ampR == null ? 0.5 : ampR) * 32767);
  }
  return out;
}

test('paket: gidiş-dönüş aynı; bilinmeyen tür, hız, kanal, tek bayt ve büyük paket reddedilir', () => {
  const s = sine(48000, 2, 480, 440, 0);
  const p = LA.decode(LA.encode(7, 48000, 2, s));
  assert.strictEqual(p.seq, 7);
  assert.strictEqual(p.sampleRate, 48000);
  assert.strictEqual(p.channels, 2);
  assert.deepStrictEqual(Array.from(p.samples), Array.from(s));
  const good = LA.encode(1, 48000, 2, s);
  assert.strictEqual(LA.decode(Buffer.concat([good, Buffer.from([1])])), null, 'tek bayt fazla');
  const bad = (i, v) => { const b = Buffer.from(good); b[i] = v; return LA.decode(b); };
  assert.strictEqual(bad(0, 0x7b), null, 'JSON değil, ses değil');
  assert.strictEqual(bad(1, 2), null, 'sürüm');
  assert.strictEqual(bad(10, 3), null, 'kanal');
  const r = Buffer.from(good); r.writeUInt32BE(12345, 6);
  assert.strictEqual(LA.decode(r), null, 'örnekleme hızı');
  assert.strictEqual(LA.decode(LA.encode(1, 48000, 1, new Int16Array(LA.MAX_SAMPLES + 1))), null, 'çok büyük');
  assert.strictEqual(LA.decode(Buffer.alloc(3)), null);
});

test('kare: ses zamanıyla saniyede 60; tayfın tepesi sinüsün frekansında; kanallar ayrı', () => {
  const frames = [];
  const fr = LA.createFramer({ onFrame: (f) => frames.push(f) });
  const rate = 48000;
  // Bir saniye, 10 ms'lik paketler; sol yüksek, sağ alçak
  for (let k = 0; k < 100; k++) fr.push(LA.decode(LA.encode(k, rate, 2, sine(rate, 2, 480, 1000, k * 480, 0.8, 0.1))));
  assert.strictEqual(frames.length, 60);
  const f = frames[frames.length - 1];
  assert.strictEqual(f.sampleRate, rate);
  assert.strictEqual(f.freq.length, F.BINS);
  assert.strictEqual(f.left.length, F.FFT_SIZE);
  let peak = 0;
  for (let i = 1; i < f.freq.length; i++) if (f.freq[i] > f.freq[peak]) peak = i;
  assert.ok(Math.abs(peak - 1000 / (rate / F.FFT_SIZE)) <= 1, 'tepe ' + peak);
  const swing = (a) => Math.max(...a) - Math.min(...a);
  assert.ok(swing(f.left) > 180 && swing(f.right) < 40, 'sol ' + swing(f.left) + ' sağ ' + swing(f.right));
  assert.deepStrictEqual(fr.stats().lost, 0);
  // Öbek hâlinde gelen ses de aynı sayıda kare verir (ağ paketleri birikmiş)
  const burst = [];
  const fb = LA.createFramer({ onFrame: (x) => burst.push(x) });
  fb.push(LA.decode(LA.encode(0, rate, 2, sine(rate, 2, 8000, 440, 0))));
  assert.strictEqual(burst.length, Math.floor(8000 / 800));
});

test('kare: tek kanal iki kanala yazılır; kayıp paket sayılır; hız değişince baştan', () => {
  const frames = [];
  const fr = LA.createFramer({ onFrame: (f) => frames.push(f) });
  fr.push(LA.decode(LA.encode(0, 48000, 1, sine(48000, 1, 4800, 440, 0))));
  const f = frames[frames.length - 1];
  assert.deepStrictEqual(Array.from(f.left), Array.from(f.right));
  fr.push(LA.decode(LA.encode(4, 48000, 1, sine(48000, 1, 480, 440, 4800))));
  assert.strictEqual(fr.stats().lost, 3);
  fr.push(LA.decode(LA.encode(5, 44100, 1, sine(44100, 1, 4410, 440, 0))));
  assert.strictEqual(frames[frames.length - 1].sampleRate, 44100);
});

test('çalan parça: alanlar sınırlı, kapak yalnız resim veri adresi; aynı parçada kapak yeniden gelmez', () => {
  const art = 'data:image/jpeg;base64,' + Buffer.from('kapak').toString('base64');
  const a = LA.cleanMeta({ has: true, title: '  Gece\u0007 ', artist: 'Sanatçı', album: 'Albüm', position: 12.5, duration: 1e9, playing: true, artwork: art }, null, 5);
  assert.deepStrictEqual([a.title, a.artist, a.album, a.position, a.duration, a.playing, a.artwork, a.app], ['Gece', 'Sanatçı', 'Albüm', 12.5, 86400, true, art, 'Telefon']);
  const b = LA.cleanMeta({ has: true, title: 'Gece', artist: 'Sanatçı', position: 14 }, a, 6);
  assert.strictEqual(b.artwork, art, 'aynı parça: kapak kaldı');
  const c = LA.cleanMeta({ has: true, title: 'Başka', artist: 'Sanatçı' }, a, 7);
  assert.strictEqual(c.artwork, '', 'başka parça: eski kapak taşınmaz');
  assert.strictEqual(LA.cleanMeta({ has: true, artwork: 'https://kotu.example/a.jpg' }, null, 1), null);
  assert.strictEqual(LA.cleanMeta({ has: true, artwork: 'data:image/svg+xml;base64,PHN2Zz4=' }, null, 1), null, 'SVG betik taşıyabilir');
  assert.strictEqual(LA.cleanMeta({ has: true, artwork: 'data:image/png;base64,' + 'A'.repeat(LA.ART_MAX) }, null, 1), null, 'çok büyük');
  assert.strictEqual(LA.cleanMeta({ has: false, title: 'x' }, a, 9).has, false);
});

test('paket telefonun Kotlin kodlayıcısıyla bayt bayt aynı (android LinkAudioTest ile aynı örnek)', () => {
  assert.strictEqual(LA.encode(7, 48000, 2, Int16Array.from([1, -2, 32767, -32768])).toString('hex'), '0101000000070000bb80020100feffff7f0080');
});
