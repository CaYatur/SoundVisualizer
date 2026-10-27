'use strict';
/* Ses analizini dışa aktarma: JSON, CSV ve MIDI.
 *
 * Bilinen cevaplı yapay ses, dışa aktarıcının yaptığının aynısıyla
 * çözümleniyor: 2048 örneklik Hann pencereli FFT, -90..-18 dB bayt ölçeği,
 * kare başına bir pencere (t = kare / fps). Sonra kayıtçının bulduğu
 * vuruşlar, tempo, akor ve dosyaların biçimi denetleniyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const AE = require('../src/shared/analysis-export.js');
const M = require('../src/shared/modulation.js');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf-8');

function loadAudioEngine() {
  const win = { performance: { now: () => 1000 } };
  win.window = win;
  const ctx = vm.createContext(win);
  vm.runInContext(read('src/shared/onset.js'), ctx, { filename: 'onset.js' });
  vm.runInContext(read('src/shared/analysis.js'), ctx, { filename: 'analysis.js' });
  vm.runInContext(read('src/shared/spectrum.js'), ctx, { filename: 'spectrum.js' });
  vm.runInContext(read('src/visualizer/audio.js'), ctx, { filename: 'audio.js' });
  return new win.SVAudio();
}

// Dışa aktarıcının çözümlemesi: aynı pencere, aynı ölçek
const N = 2048;
const hann = Float64Array.from({ length: N }, (_, i) => 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1))));
function fft(re, im) {
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    for (let i = 0; i < N; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(a * k), s = Math.sin(a * k);
        const p = i + k + len / 2;
        const xr = re[p] * c - im[p] * s, xi = re[p] * s + im[p] * c;
        re[p] = re[i + k] - xr; im[p] = im[i + k] - xi;
        re[i + k] += xr; im[i + k] += xi;
      }
    }
  }
}
function frameAt(pcm, end) {
  const re = new Float64Array(N), im = new Float64Array(N);
  const time = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const idx = end - N + i;
    const v = idx >= 0 && idx < pcm.length ? pcm[idx] : 0;
    re[i] = v * hann[i];
    time[i] = (128 + Math.max(-1, Math.min(1, v)) * 127) | 0;
  }
  fft(re, im);
  const freq = new Uint8Array(N / 2);
  for (let i = 0; i < N / 2; i++) {
    const mag = Math.hypot(re[i], im[i]) / (N / 4);
    const v = (20 * Math.log10(mag + 1e-9) + 90) / 72;
    freq[i] = (Math.max(0, Math.min(1, v)) * 255) | 0;
  }
  return { freq, time, sampleRate: 48000 };
}

/* 120 BPM kick (55 Hz, hızlı sönen) ve sürekli bir Do majör üçlüsü
   (C4 E4 G4) — bilinen tempo, bilinen akor. */
function song(sec) {
  const sr = 48000;
  const pcm = new Float32Array(sec * sr);
  for (let i = 0; i < pcm.length; i++) {
    const t = i / sr;
    const age = t % 0.5;
    const kick = Math.sin(2 * Math.PI * 55 * age) * Math.exp(-age * 18) * 0.8;
    const chord = (Math.sin(2 * Math.PI * 261.63 * t) + Math.sin(2 * Math.PI * 329.63 * t) + Math.sin(2 * Math.PI * 392.0 * t)) * 0.08;
    pcm[i] = kick + chord;
  }
  return pcm;
}

function analyse(pcm, fps) {
  const audio = loadAudioEngine();
  const mod = new M.Modulator();
  const cfg = { modulation: { enabled: true, routes: [], lfos: [], envelopes: [], macros: [], random: {} } };
  const rec = new AE.Recorder({ fps, fields: AE.fieldIds(M.catalog(cfg)) });
  const frames = Math.ceil((pcm.length / 48000) * fps);
  for (let i = 0; i < frames; i++) {
    const t = i / fps;
    audio.ingestFrame(frameAt(pcm, Math.round(t * 48000)));
    audio.update(1 / fps);
    mod.update(cfg, audio, t, 1 / fps);
    rec.push(mod.values, audio.analysis);
  }
  return rec.finish({ file: 'test.wav', sampleRate: 48000, generator: 'test' });
}

const PCM = song(12);
let cached = null;
const data = () => cached || (cached = analyse(PCM, 60));

test('alanlar: sesten ölçülen kaynaklar, üreteçler dışarıda', () => {
  const ids = AE.fieldIds(M.catalog({ modulation: {} }));
  for (const need of ['bass', 'level', 'onsetTrig', 'band0', 'band7', 'fband1', 'fband4', 'anLoudness', 'anChordRoot', 'chroma0', 'chroma11', 'kickTrig']) {
    assert.ok(ids.includes(need), 'eksik: ' + need);
  }
  for (const no of ['lfo1', 'env1', 'macro1', 'random', 'time', 'beatPhase', 'const']) {
    assert.ok(!ids.includes(no), 'olmamalı: ' + no);
  }
  for (const id of ids) assert.ok(AE.fieldNote(id), id + ' açıklamasız');
});

test('satır N videonun N. karesi', () => {
  const d = data();
  assert.strictEqual(d.frameCount, 12 * 60);
  assert.strictEqual(d.frames.t.length, d.frameCount);
  assert.strictEqual(d.frames.t[60], 1);
  for (const f of d.fields) assert.strictEqual(d.frames[f.id].length, d.frameCount, f.id);
  assert.strictEqual(d.source.durationSec, 12);
});

test('kick vuruşları 0,5 saniye arayla, bir kare içinde', () => {
  const k = data().events.kick.map((e) => e.t);
  assert.ok(k.length >= 20, 'kick sayısı: ' + k.length);
  for (let i = 1; i < k.length; i++) {
    const gap = k[i] - k[i - 1];
    const beats = Math.round(gap / 0.5);
    assert.ok(beats >= 1, 'aynı vuruşta iki kick: ' + k[i - 1] + ', ' + k[i]);
    assert.ok(Math.abs(gap - beats * 0.5) <= 1 / 60 + 1e-9, 'aralık ' + gap.toFixed(4));
  }
});

test('tempo 120 BPM, ızgara kick\'lere oturuyor', () => {
  const d = data();
  assert.ok(Math.abs(d.summary.bpm - 120) <= 0.5, 'bpm ' + d.summary.bpm);
  const b = d.events.beats.map((x) => x.t);
  assert.ok(b.length >= 23 && b.length <= 25, 'vuruş ' + b.length);
  for (let i = 1; i < b.length; i++) assert.ok(Math.abs(b[i] - b[i - 1] - 0.5) <= 1 / 60 + 1e-9, 'vuruş aralığı');
  // Kick'ler 0,5 sn'nin katlarında başlıyor: ızgara da öyle (bir kare içinde)
  for (const t of b) {
    const off = t % 0.5;
    assert.ok(Math.min(off, 0.5 - off) <= 1 / 60 + 1e-9, 'ızgara kayık: ' + t);
  }
  assert.strictEqual(d.events.beats.filter((x) => x.downbeat).length, Math.ceil(b.length / 4) - (b.length % 4 && 0));
  assert.ok(d.summary.beatGridFit > 0.8, 'ızgara uyumu ' + d.summary.beatGridFit);
  assert.strictEqual(d.frames.beat.reduce((s, v) => s + v, 0), b.length);
});

test('Do majör üçlüsü C akoru, tonalite C', () => {
  const d = data();
  const ch = d.segments.chords;
  const total = ch.filter((c) => c.name === 'C').reduce((s, c) => s + c.end - c.start, 0);
  assert.ok(total > 10, 'C süresi ' + total.toFixed(2) + ' / 12 sn; bölümler: ' + ch.map((c) => c.name).join(' '));
  assert.ok(ch.length <= 2, 'bölüm sayısı ' + ch.length);
  assert.strictEqual(d.summary.key, 'C');
  assert.strictEqual(d.frames.chord[6 * 60], 'C');
});

test('vuruş başına akor: tek vuruşluk sapma komşularına katılır', () => {
  const fps = 10;
  const row = (notes) => { const v = new Float64Array(12); for (const k of notes) v[k] = 1; return v; };
  const C = row([0, 4, 7]), G = row([7, 11, 2]);
  const chroma = [].concat(Array(10).fill(C), Array(5).fill(G), Array(10).fill(C), Array(10).fill(G));
  const beats = [0, 5, 10, 15, 20, 25, 30];
  const out = AE.beatChords(chroma, beats, chroma.length, fps);
  assert.deepStrictEqual(out.map((c) => [c.name, c.from, c.to]), [['C', 0, 25], ['G', 25, 35]]);
  // Komşuları farklı olsa da tek vuruşluk akor tek başına bölüm olmuyor
  const F = row([5, 9, 0]);
  const seq2 = [].concat(Array(10).fill(C), Array(5).fill(F), Array(10).fill(G));
  const out2 = AE.beatChords(seq2, [0, 5, 10, 15, 20], seq2.length, fps);
  assert.deepStrictEqual(out2.map((c) => [c.name, c.from, c.to]), [['C', 0, 15], ['G', 15, 25]]);
});

test('aynı ses iki kez aynı dosyaları verir', () => {
  const a = AE.toJson(data());
  const b = AE.toJson(analyse(PCM, 60));
  assert.strictEqual(a, b);
});

test('CSV: başlık ve her satır aynı sayıda sütun, ondalık nokta', () => {
  const csv = AE.toCsv(data()).trimEnd().split('\n');
  assert.strictEqual(csv.length, data().frameCount + 1);
  const cols = csv[0].split(',');
  assert.deepStrictEqual(cols.slice(0, 3), ['frame', 't', 'bass']);
  assert.ok(cols.includes('chord') && cols.includes('beat') && cols.includes('downbeat') && cols.includes('fband1'));
  for (const line of [csv[1], csv[300], csv[csv.length - 1]]) assert.strictEqual(line.split(',').length, cols.length);
  assert.ok(!/\d,\d{1,4}[;]/.test(csv[300]));
  assert.strictEqual(csv[61].split(',')[1], '1');
});

// En küçük bir SMF okuyucu: yalnız testin ihtiyacı kadar
function parseMidi(buf) {
  const u = Buffer.from(buf);
  assert.strictEqual(u.toString('latin1', 0, 4), 'MThd');
  assert.strictEqual(u.readUInt32BE(4), 6);
  const format = u.readUInt16BE(8), ntrk = u.readUInt16BE(10), ppq = u.readUInt16BE(12);
  let o = 14;
  const tracks = [];
  for (let k = 0; k < ntrk; k++) {
    assert.strictEqual(u.toString('latin1', o, o + 4), 'MTrk');
    const len = u.readUInt32BE(o + 4);
    let p = o + 8;
    const end = p + len;
    let t = 0;
    let status = 0;
    const ev = [];
    const vlq = () => { let v = 0; let b; do { b = u[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
    while (p < end) {
      t += vlq();
      let s = u[p];
      if (s & 0x80) p++; else s = status;
      if (s === 0xff) {
        const type = u[p++];
        const l = vlq();
        ev.push({ t, meta: type, data: u.slice(p, p + l) });
        p += l;
      } else {
        status = s;
        const hi = s & 0xf0;
        const a = u[p++];
        const b = hi === 0xc0 || hi === 0xd0 ? 0 : u[p++];
        ev.push({ t, kind: hi, ch: s & 15, a, b });
      }
    }
    assert.strictEqual(p, end, 'iz ' + k + ' uzunluğu tutmuyor');
    tracks.push(ev);
    o = end;
  }
  assert.strictEqual(o, u.length, 'dosya sonunda artık bayt');
  return { format, ppq, tracks };
}

test('MIDI: geçerli dosya, sıralı zaman, her nota kapanıyor', () => {
  const d = data();
  const m = parseMidi(AE.toMidi(d));
  assert.strictEqual(m.format, 1);
  assert.strictEqual(m.ppq, AE.PPQ);
  assert.strictEqual(m.tracks.length, 4);
  const tempoEv = m.tracks[0].find((e) => e.meta === 0x51);
  const uspq = (tempoEv.data[0] << 16) | (tempoEv.data[1] << 8) | tempoEv.data[2];
  assert.strictEqual(uspq, Math.round(60e6 / d.summary.bpm));
  const sec = (tk) => (tk / AE.PPQ) * uspq / 1e6;
  for (const tr of m.tracks) {
    let prev = 0;
    const open = new Map();
    for (const e of tr) {
      assert.ok(e.t >= prev, 'zaman geri gitti');
      prev = e.t;
      const key = e.ch + ':' + e.a;
      if (e.kind === 0x90 && e.b > 0) { assert.ok(!open.has(key), 'açık notaya yeni açılış ' + key); open.set(key, e.t); }
      if (e.kind === 0x80 || (e.kind === 0x90 && e.b === 0)) { assert.ok(open.has(key), 'açılmamış nota kapandı ' + key); open.delete(key); }
    }
    assert.strictEqual(open.size, 0, 'kapanmayan nota');
    const last = tr[tr.length - 1];
    assert.strictEqual(last.meta, 0x2f, 'iz sonu yok');
    assert.ok(Math.abs(sec(last.t) - d.source.durationSec) < 0.06, 'iz sonu ' + sec(last.t));
  }
  // Kick'ler kanal 10'da nota 36, saniyeleri JSON'daki olaylarla aynı
  const kicks = m.tracks[2].filter((e) => e.kind === 0x90 && e.a === 36 && e.ch === 9).map((e) => sec(e.t));
  assert.strictEqual(kicks.length, d.events.kick.length);
  kicks.forEach((s, i) => assert.ok(Math.abs(s - d.events.kick[i].t) < 0.001, 'kick zamanı'));
  // Akorlar kanal 1'de: C bölümü C3 E3 G3
  const notes = new Set(m.tracks[3].filter((e) => e.kind === 0x90).map((e) => e.a));
  for (const n of [48, 52, 55]) assert.ok(notes.has(n), 'akor notası yok: ' + n);
});

test('bölümleme: kısa titremeler önceki bölüme katılır', () => {
  const fps = 10;
  const C = { name: 'C', confidence: 0.9 }, G = { name: 'G', confidence: 0.9 }, low = { name: 'D', confidence: 0.2 };
  const seq = [].concat(Array(10).fill(C), [G], Array(5).fill(C), [low, low], Array(10).fill(G));
  const s = AE.segments(seq, fps, { minConf: 0.75, minDur: 0.25, keyOf: (x) => x.name });
  assert.deepStrictEqual(s.map((x) => [x.item.name, x.start, x.end]), [['C', 0, 1.8], ['G', 1.8, 2.8]]);
});

test('tempo: sekizlik darbe 120 çevresini seçer, sessizlik 0', () => {
  /* Yalnız sekizlik darbe 64, 128 ve 85 BPM'e neredeyse eşit oy verir;
     ön bilgi yaygın olanı seçmeli. 128,57 BPM'in sekizlikleri 0,2333 sn. */
  const fps = 60;
  const env = new Float64Array(fps * 30);
  for (let t = 0; t < 30; t += 60 / 128.57 / 2) env[Math.round(t * fps)] = 1;
  const r = AE.estimateTempo(env, fps);
  assert.ok(Math.abs(r.bpm - 128.57) < 0.5, 'bpm ' + r.bpm);
  assert.strictEqual(AE.estimateTempo(new Float64Array(fps * 30), fps).bpm, 0);
  assert.strictEqual(AE.estimateTempo(new Float64Array(fps * 2), fps).bpm, 0, 'çok kısa');
});

test('dışa aktarıcı analizi ayrı bir ses motoruyla yapıyor', () => {
  /* Çizimin ses motoru getBars çağrılarında durum ilerletiyor; kayıt aynı
     nesneyi kullansaydı açık olması videoyu değiştirirdi. */
  const src = read('src/exporter/exporter.js');
  const start = src.slice(src.indexOf('function startAnalysis'), src.indexOf('function renderFrame'));
  assert.match(start, /new window\.SVAudio\(\)/);
  assert.match(start, /new window\.SVModulation\.Modulator\(\)/);
  assert.doesNotMatch(start, /[^n]audio\.(ingestFrame|update|getBars)/);
  assert.match(read('src/exporter/index.html'), /analysis-export\.js/);
});

test('MCP: sv_export_analysis yalnız .json kabul eder, kare hızını denetler', async () => {
  const mcp = require('../src/shared/mcp.js');
  let started = null;
  const cfg = { mcp: { enabled: true, mode: 'write' } };
  const ctx = { locale: () => 'en', getConfig: () => cfg, startAnalysis: (a) => { started = a; return { ok: true }; } };
  const call = (a) => mcp.callTool('sv_export_analysis', a, ctx);
  assert.strictEqual((await call({ audioPath: 'C:/a.wav', outputPath: 'C:/v/x.csv' })).ok, false);
  assert.strictEqual((await call({ audioPath: 'C:/a.wav', outputPath: 'C:/v/x.json', fps: 144 })).ok, false);
  assert.strictEqual(started, null);
  const good = await call({ audioPath: 'C:/a.wav', outputPath: 'C:/v/x.json', fps: 30 });
  assert.strictEqual(good.ok, true, JSON.stringify(good));
  assert.strictEqual(started.fps, 30);
  const p = mcp.tools('en').find((t) => t.name === 'sv_start_export').inputSchema.properties;
  assert.strictEqual(p.analysis.type, 'boolean');
});

test('panel: seçenek varsayılan kapalı, iki istek yolunda da gidiyor, metinler çevrili', () => {
  global.window = global.window || {};
  require('../src/shared/defaults.js');
  assert.strictEqual(global.window.SV.defaultConfig().export.analysis, false);
  const admin = read('src/admin/admin.js');
  // Doğrudan dışa aktarma ve kuyruk: ikisinde de yoksa seçenek sessizce düşer
  assert.match(admin, /analysis: !!e\.analysis,/);
  assert.match(admin, /analysis: !!\(cfg\.export && cfg\.export\.analysis\),/);
  const dict = read('src/shared/i18n.js');
  for (const s of ['Ses analizini yanına yaz (JSON, CSV, MIDI)', 'Yalnız Ses Analizi', 'Ses çözümleniyor…',
    'Video çizmeden yalnız ses analizini yazar: JSON, CSV ve MIDI']) {
    assert.ok(dict.includes("'" + s + "':"), 'çeviri yok: ' + s);
  }
});
