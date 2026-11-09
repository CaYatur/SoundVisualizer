'use strict';
/* LUFS ölçeri testleri (ITU-R BS.1770-4 / EBU R128).
 *
 * Bilinen cevaplar EBU Tech 3341'deki temel durumlardan: iki kanalda
 * -23 dBFS 1 kHz sinüs -23 LUFS okunur; tek kanal 3 dB daha düşük çıkar;
 * -70 LUFS altı bloklar ve göreli kapının (-10 LU) altında kalan bloklar
 * entegre ölçüme girmez. */
const test = require('node:test');
const assert = require('node:assert');
const A = require('../src/shared/analysis.js');

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b} (±${eps})`);

function sine(fs, seconds, dbfs, hz, phase0) {
  const n = Math.round(fs * seconds);
  const out = new Float32Array(n);
  const amp = Math.pow(10, dbfs / 20);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin(2 * Math.PI * (hz || 997) * (i / fs) + (phase0 || 0));
  return out;
}

test('lufs: stereo -23 dBFS 997 Hz sine reads -23 LUFS (M, S, I)', () => {
  const m = new A.LoudnessMeter({ sampleRate: 48000 });
  const s = sine(48000, 20, -23);
  m.push(s, s);
  near(m.momentary, -23, 0.1, 'momentary');
  near(m.shortTerm, -23, 0.1, 'short-term');
  near(m.integrated, -23, 0.1, 'integrated');
});

test('lufs: K-weighting is correct at 44.1 kHz too, and mono is 3 dB lower', () => {
  const m = new A.LoudnessMeter({ sampleRate: 44100 });
  const s = sine(44100, 5, -20);
  m.push(s, s);
  near(m.integrated, -20, 0.1, '44.1 kHz stereo');
  const mono = new A.LoudnessMeter({ sampleRate: 44100 });
  mono.push(s);
  near(mono.integrated, -23.01, 0.1, 'mono');
});

test('lufs: K-weighting cuts lows and lifts highs', () => {
  const read = (hz) => {
    const m = new A.LoudnessMeter({ sampleRate: 48000 });
    const s = sine(48000, 3, -20, hz);
    m.push(s, s);
    return m.integrated;
  };
  assert.ok(read(30) < -21.5, '30 Hz is attenuated by the RLB high-pass');
  // +4 dB raf, eksi 1 kHz'deki 0.691 dB normalleştirme
  near(read(8000), -16.65, 0.2, '8 kHz gets the ~+4 dB shelf');
});

test('lufs: absolute gate ignores near-silence, relative gate ignores quiet passages', () => {
  const fs = 48000;
  const m = new A.LoudnessMeter({ sampleRate: fs });
  const loud = sine(fs, 10, -23);
  const silent = sine(fs, 10, -90);
  m.push(loud, loud);
  m.push(silent, silent);
  near(m.integrated, -23, 0.1, 'silence below -70 LUFS is gated out');

  const r = new A.LoudnessMeter({ sampleRate: fs });
  const quiet = sine(fs, 10, -36);
  r.push(loud, loud);
  r.push(quiet, quiet);
  near(r.integrated, -23, 0.15, 'passage more than 10 LU below is gated out');
  // Ama kapı içindeki daha sessiz bölüm ortalamaya girer
  const k = new A.LoudnessMeter({ sampleRate: fs });
  const mid = sine(fs, 10, -26);
  k.push(loud, loud);
  k.push(mid, mid);
  assert.ok(k.integrated < -23.5 && k.integrated > -26, 'in-gate passage is averaged: ' + k.integrated);
});

test('lufs: nothing reads before a full window; reset clears integrated', () => {
  const m = new A.LoudnessMeter({ sampleRate: 48000 });
  const s = sine(48000, 0.3, -23);
  m.push(s, s);
  assert.strictEqual(m.momentary, -Infinity, 'needs 400 ms');
  m.push(sine(48000, 1, -23), sine(48000, 1, -23));
  assert.ok(isFinite(m.momentary));
  assert.strictEqual(m.shortTerm, -Infinity, 'needs 3 s');
  m.reset();
  assert.strictEqual(m.integrated, -Infinity);
  assert.strictEqual(m.momentary, -Infinity);
});

test('lufs: Analyser feeds only new samples from overlapping frames', () => {
  const fs = 48000;
  const fft = 2048;
  const an = new A.Analyser({ sampleRate: fs, fftSize: fft });
  const all = sine(fs, 6, -23);
  const spec = new Float32Array(fft / 2).fill(0.3);
  const step = 800; // 60 fps'de bir kare = 800 örnek
  for (let end = fft; end <= all.length; end += step) {
    const buf = all.subarray(end - fft, end);
    an.requestLoudness();
    an.update(spec, buf, step / fs, { left: buf, right: buf });
  }
  const lm = an.loudnessMeter;
  near(lm.momentary, -23, 0.2, 'momentary through Analyser');
  near(lm.integrated, -23, 0.2, 'integrated through Analyser');
  near(an.sources().anLufs, (lm.momentary + 60) / 60, 1e-9, 'anLufs source');
  an.resetLoudness();
  assert.strictEqual(an.loudnessMeter.integrated, -Infinity);
});


test('lufs: unused analysis allocates no meter and stops processing after demand ends', () => {
  const an = new A.Analyser({ sampleRate: 48000, fftSize: 2048 });
  const buf = sine(48000, 2048 / 48000, -23);
  for (let i = 0; i < 30; i++) an._lufs(buf, 1 / 60);
  assert.strictEqual(an.loudnessMeter, null);
  assert.strictEqual(an.sources().anLufs, 0);
  an.resetLoudness();
  const meter = an.requestLoudness();
  let pushed = 0;
  const push = meter.push.bind(meter);
  meter.push = (...args) => { pushed++; return push(...args); };
  for (let i = 0; i < 60; i++) an._lufs(buf, 1 / 60);
  assert.ok(pushed > 0 && pushed <= 16, String(pushed));
  const stopped = pushed;
  for (let i = 0; i < 60; i++) an._lufs(buf, 1 / 60);
  assert.strictEqual(pushed, stopped);
  an.requestLoudness();
  an._lufs(buf, 1 / 60);
  assert.strictEqual(pushed, stopped + 1);
  an.reset();
  assert.strictEqual(meter.momentary, -Infinity, 'demo/source reset cannot contaminate live LUFS');
});

test('lufs: only active anLufs routes request the meter, not other analysis sources', () => {
  const M = require('../src/shared/modulation.js');
  const an = new A.Analyser();
  const audio = { analysis: an };
  const mod = new M.Modulator();
  const cfg = { modulation: { enabled: true, routes: [{ source: 'anPeak' }] } };
  mod.update(cfg, audio, 0, 1 / 60);
  assert.strictEqual(an.loudnessMeter, null);
  cfg.modulation.routes = [{ source: 'anLufs', enabled: false }];
  mod.update(cfg, audio, 0, 1 / 60);
  assert.strictEqual(an.loudnessMeter, null);
  cfg.modulation.routes[0].enabled = true;
  cfg.modulation.enabled = false;
  mod.update(cfg, audio, 0, 1 / 60);
  assert.strictEqual(an.loudnessMeter, null);
  cfg.modulation.enabled = true;
  mod.update(cfg, audio, 0, 1 / 60);
  assert.ok(an.loudnessMeter);
});


test('lufs: demand follows the real input sample rate without altering existing analysis', () => {
  const an = new A.Analyser({ sampleRate: 48000 });
  const meter = an.requestLoudness(44100);
  assert.strictEqual(meter.sampleRate, 44100);
  assert.strictEqual(an.sampleRate, 48000);
  const frame = sine(44100, 2048 / 44100, -23);
  an._lufs(frame, 0.01, { left: frame, right: frame });
  assert.strictEqual(meter._n, 441);
  assert.notStrictEqual(an.requestLoudness(48000), meter);
});
