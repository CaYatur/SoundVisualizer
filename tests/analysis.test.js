'use strict';
/* Derin ses çözümlemesi testleri.
 *
 * Her özellik, cevabı önceden bilinen YAPAY bir sinyalle ölçülür: bilinen
 * frekansta bir sinüs, bilinen notalardan bir akor, beyaz gürültü, tıklama
 * dizisi. "Şu sayı makul görünüyor" değil, "bu girdinin doğru cevabı şudur"
 * denebildiği için çözümleme gerçekten doğrulanmış oluyor. */
const test = require('node:test');
const assert = require('node:assert');
const A = require('../src/shared/analysis.js');

const SR = 48000;
const FFT = 2048;
const BINS = FFT / 2;
const BIN_HZ = SR / FFT;

/* Yapay büyüklük tayfı.
 *
 * Enerjiyi en yakın kutuya yuvarlamak yanıltıcı olurdu: gerçek bir FFT'de bir
 * sinüs, KESİRLİ kutu konumunda merkezlenmiş bir ana lob üretir ve düşük
 * frekanslarda bir yarım ton bir kutudan dardır (48 kHz / 2048'de kutu 23.4 Hz,
 * 150 Hz'de yarım ton ~9 Hz). Yuvarlayan bir tayf, kutu merkezini nota sanan
 * bir çözümleyiciyi "doğru" gösterirdi.
 *
 * Bu yüzden ana lob gerçek kesirli konumda, Gauss yaklaşımıyla kurulur —
 * pencere ana lobunun logaritmik ölçekte paraboliğe yakınlığı da böylece
 * korunur, ki tepe interpolasyonunun dayandığı özellik budur. */
function spectrumOf(partials, noise) {
  const s = new Float32Array(BINS);
  if (noise) for (let i = 0; i < BINS; i++) s[i] = noise;
  for (const [hz, amp] of partials) {
    const c = hz / BIN_HZ;                       // kesirli kutu konumu
    const lo = Math.max(1, Math.floor(c) - 3);
    const hi = Math.min(BINS - 1, Math.ceil(c) + 3);
    for (let i = lo; i <= hi; i++) {
      const d = i - c;
      s[i] = Math.min(1, s[i] + amp * Math.exp(-(d * d) * 1.4));
    }
  }
  return s;
}

// Nota adından frekans (A4 = 440)
const NOTES = A.NOTE_NAMES;
function hzOf(note, octave) {
  const pc = NOTES.indexOf(note);
  const midi = (octave + 1) * 12 + pc;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Zaman alanında sinüs toplamı
function waveOf(freqs, n, amp) {
  const w = new Float32Array(n || 2048);
  for (let i = 0; i < w.length; i++) {
    let v = 0;
    for (const f of freqs) v += Math.sin((2 * Math.PI * f * i) / SR);
    w[i] = (v / freqs.length) * (amp == null ? 0.8 : amp);
  }
  return w;
}

/* Sürekli bir sinyali kare kare veren oynatıcı.
 *
 * Aynı 2048 örneklik bloğu tekrar tekrar beslemek yanlış olurdu: blok sınırında
 * dalga süreksiz olur ve geniş bantlı bir tıkırtı üretir. Sabit-Q kroma bankası
 * kareler boyunca biriken sinyali okuduğu için sinyalin gerçekten sürekli
 * olması gerekir. */
function player(freqs, secs, amp) {
  const total = Math.round(SR * (secs || 3));
  const w = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    let v = 0;
    for (const fq of freqs) v += Math.sin((2 * Math.PI * fq * i) / SR);
    w[i] = (v / freqs.length) * (amp == null ? 0.8 : amp);
  }
  let p = 0;
  return () => {
    const s = w.subarray(p, p + 2048);
    p += 2048;
    if (p + 2048 > total) p = 0;
    return s;
  };
}

// Notaları sürekli sinyal olarak çalar ve çözümleyiciyi doldurur
function playNotes(an, notes, frames) {
  const next = player(notes.map(([n, o]) => hzOf(n, o)), 4);
  const spec = new Float32Array(BINS);
  for (let i = 0; i < (frames || 80); i++) an.update(spec, next(), 1 / 60);
  return an;
}

function feed(an, spec, time, frames, dt) {
  const step = dt || 1 / 60;
  for (let i = 0; i < (frames || 1); i++) an.update(spec, time, step);
  return an;
}

const mk = () => new A.Analyser({ sampleRate: SR, fftSize: FFT });

// ===========================================================================
// Kroma
// ===========================================================================
test('kroma: A440 sinüsü A sınıfında zirve yapar', () => {
  const an = mk();
  playNotes(an, [['A', 4]], 60);
  let best = 0;
  for (let k = 1; k < 12; k++) if (an.chroma[k] > an.chroma[best]) best = k;
  assert.strictEqual(NOTES[best], 'A', 'zirve: ' + NOTES[best]);
});

test('kroma: oktavlar aynı sınıfa katlanır', () => {
  const an = mk();
  playNotes(an, [['D', 3], ['D', 4], ['D', 5]], 80);
  let best = 0;
  for (let k = 1; k < 12; k++) if (an.chroma[k] > an.chroma[best]) best = k;
  assert.strictEqual(NOTES[best], 'D', 'zirve: ' + NOTES[best]);
  // Tek sınıfta toplanmalı: en yüksek, ikinci en yüksekten belirgin büyük
  const sorted = [...an.chroma].sort((a, b) => b - a);
  assert.ok(sorted[0] > sorted[1] * 3, 'enerji tek sınıfta toplanmadı');
});

test('kroma: do majör üçlüsü C, E ve G sınıflarını aydınlatır', () => {
  const an = mk();
  playNotes(an, [['C', 4], ['E', 4], ['G', 4]], 80);
  const idx = [...an.chroma.keys()].sort((a, b) => an.chroma[b] - an.chroma[a]).slice(0, 3);
  const names = idx.map((i) => NOTES[i]).sort();
  assert.deepStrictEqual(names, ['C', 'E', 'G'], 'bulunan: ' + names.join(','));
});

test('kroma normalize: toplamı 1 (ya da sessizlikte 0)', () => {
  const an = mk();
  playNotes(an, [['A', 3], ['E', 4]], 80);
  const sum = [...an.chroma].reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum - 1) < 1e-6, 'toplam: ' + sum);
  const an2 = mk();
  feed(an2, new Float32Array(BINS), new Float32Array(2048), 20);
  assert.strictEqual([...an2.chroma].reduce((s, v) => s + v, 0), 0);
});

test('kroma: yarım ton komşuları ayırt eder (FFT kutusundan dar aralık)', () => {
  // A3 (220 Hz) ile C4 (261.6 Hz) arası 41.6 Hz — 48 kHz / 2048'lik bir FFT'nin
  // ana lobundan (~94 Hz) dar. Kutu tabanlı bir kroma bu ikisini ayıramaz;
  // sabit-Q süzgeç bankası ayırmalı.
  const an = mk();
  playNotes(an, [['A', 3], ['C', 4]], 80);
  const pcA = NOTES.indexOf('A');
  const pcC = NOTES.indexOf('C');
  const others = [...an.chroma].filter((v, i) => i !== pcA && i !== pcC);
  const maxOther = Math.max(...others);
  assert.ok(an.chroma[pcA] > maxOther * 2, 'A ayrışmadı: ' + an.chroma[pcA].toFixed(3) + ' vs ' + maxOther.toFixed(3));
  assert.ok(an.chroma[pcC] > maxOther * 2, 'C ayrışmadı: ' + an.chroma[pcC].toFixed(3) + ' vs ' + maxOther.toFixed(3));
});

// ===========================================================================
// Akor
// ===========================================================================
test('akor: majör ve minör üçlüler doğru adlandırılır', () => {
  const cases = [
    [[['C', 4], ['E', 4], ['G', 4]], 'C'],
    [[['A', 3], ['C', 4], ['E', 4]], 'Am'],
    [[['F', 3], ['A', 3], ['C', 4]], 'F'],
    [[['D', 4], ['F', 4], ['A', 4]], 'Dm'],
    [[['G', 3], ['B', 3], ['D', 4]], 'G'],
  ];
  for (const [notes, expected] of cases) {
    const an = mk();
    playNotes(an, notes, 90);
    assert.strictEqual(an.chord.name, expected,
      notes.map((x) => x.join('')).join('-') + ' -> ' + an.chord.name + ' (beklenen ' + expected + ')');
  }
});

test('akor: dörtlü uzantılar tanınır', () => {
  const an = mk();
  // G7 = G B D F
  playNotes(an, [['G', 3], ['B', 3], ['D', 4], ['F', 4]], 90);
  assert.strictEqual(an.chord.name, 'G7', 'bulunan: ' + an.chord.name);
});

test('akor: sessizlikte güven sıfır', () => {
  const an = mk();
  feed(an, new Float32Array(BINS), new Float32Array(2048), 20);
  assert.strictEqual(an.chord.confidence, 0);
  assert.strictEqual(an.chord.name, '—');
});

// ===========================================================================
// Tonalite
// ===========================================================================
/* Tonalite testleri bir akor DİZİSİ çalar. Tek bir akor tonaliteyi belirlemez
 * (C majör üçlüsü hem C majör hem F majör hem Am içinde geçer); tonalite
 * ancak akorların birlikte kullanımından çıkar. */
function playProgression(an, chords, barFrames) {
  const spec = new Float32Array(BINS);
  for (let round = 0; round < 6; round++) {
    for (const notes of chords) {
      const next = player(notes.map(([n, o]) => hzOf(n, o)), 2);
      for (let i = 0; i < (barFrames || 30); i++) an.update(spec, next(), 1 / 60);
    }
  }
  return an;
}

test('tonalite: I-IV-V-I dizisi C majör olarak kestirilir', () => {
  const an = mk();
  playProgression(an, [
    [['C', 4], ['E', 4], ['G', 4]],   // C
    [['F', 3], ['A', 3], ['C', 4]],   // F
    [['G', 3], ['B', 3], ['D', 4]],   // G
    [['C', 4], ['E', 4], ['G', 4]],   // C
  ]);
  assert.strictEqual(an.key.name, 'C', 'bulunan: ' + an.key.name + ' (güven ' + an.key.confidence.toFixed(2) + ')');
});

test('tonalite: i-iv-V-i dizisi A minör olarak kestirilir', () => {
  const an = mk();
  playProgression(an, [
    [['A', 3], ['C', 4], ['E', 4]],   // Am
    [['D', 4], ['F', 4], ['A', 4]],   // Dm
    [['E', 4], ['G#', 4], ['B', 4]],  // E (armonik minörün beşlisi)
    [['A', 3], ['C', 4], ['E', 4]],   // Am
  ]);
  assert.strictEqual(an.key.name, 'Am', 'bulunan: ' + an.key.name + ' (güven ' + an.key.confidence.toFixed(2) + ')');
});

// ===========================================================================
// Tayfsal betimleyiciler
// ===========================================================================
test('tayfsal düzlük: gürültü 1e yakın, saf ton 0a yakın', () => {
  const noise = mk();
  const s = new Float32Array(BINS);
  for (let i = 0; i < BINS; i++) s[i] = 0.5;
  feed(noise, s, null, 3);
  assert.ok(noise.flatness > 0.9, 'gürültü düzlüğü: ' + noise.flatness);

  const tone = mk();
  // -100 dB taban: gerçek bir kayıtta ölçülen taban bu mertebede
  feed(tone, spectrumOf([[1000, 1]], 1e-5), null, 3);
  assert.ok(tone.flatness < 0.05, 'saf ton düzlüğü: ' + tone.flatness);
  assert.ok(tone.flatness < noise.flatness / 10, 'ton ve gürültü ayrışmıyor');
});

test('tayfsal merkez: yüksek ton daha büyük merkez verir', () => {
  const low = mk();
  feed(low, spectrumOf([[200, 1]]), null, 3);
  const high = mk();
  feed(high, spectrumOf([[8000, 1]]), null, 3);
  assert.ok(high.centroid > low.centroid * 4,
    'merkez sıralaması yanlış: ' + low.centroid.toFixed(4) + ' vs ' + high.centroid.toFixed(4));
});

test('yuvarlanma noktası enerjinin %85ini kapsar', () => {
  const an = mk();
  feed(an, spectrumOf([[500, 1], [1000, 1], [12000, 0.02]]), null, 3);
  // Enerjinin çoğu 1 kHz altında: yuvarlanma Nyquist'in küçük bir kısmında
  assert.ok(an.rolloff < 0.15, 'yuvarlanma: ' + an.rolloff);
  const wide = mk();
  const s = new Float32Array(BINS);
  for (let i = 0; i < BINS; i++) s[i] = 0.5;
  feed(wide, s, null, 3);
  assert.ok(wide.rolloff > 0.7, 'düz tayfta yuvarlanma: ' + wide.rolloff);
});

test('tayf akısı yalnızca artışa tepki verir', () => {
  const an = mk();
  const quiet = spectrumOf([[440, 0.1]]);
  const loud = spectrumOf([[440, 1]]);
  feed(an, quiet, null, 5);
  an.update(loud, null, 1 / 60);
  const rising = an.flux;
  an.update(quiet, null, 1 / 60);
  const falling = an.flux;
  assert.ok(rising > falling, 'artışta akı düşüşten büyük olmalı: ' + rising + ' vs ' + falling);
  assert.ok(falling < 1e-6, 'düşüşte akı sıfır olmalı: ' + falling);
});

test('tüm tayfsal betimleyiciler 0..1 aralığında', () => {
  const an = mk();
  const cases = [
    new Float32Array(BINS),
    spectrumOf([[100, 1]]),
    spectrumOf([[15000, 1]]),
    (() => { const s = new Float32Array(BINS); for (let i = 0; i < BINS; i++) s[i] = Math.random(); return s; })(),
  ];
  for (const s of cases) {
    an.update(s, null, 1 / 60);
    for (const k of ['centroid', 'rolloff', 'flatness', 'crest', 'flux', 'spread', 'harmonic', 'percussive']) {
      const v = an[k];
      assert.ok(typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1, k + ' aralık dışı: ' + v);
    }
  }
});

// ===========================================================================
// Gürlük
// ===========================================================================
test('gürlük sessizlikte sıfır, sinyalde artar ve sessizlik bayrağı doğru', () => {
  const quiet = mk();
  feed(quiet, new Float32Array(BINS), new Float32Array(2048), 30);
  assert.ok(quiet.silent, 'sessizlik algılanmadı');
  assert.ok(quiet.loudness < 0.01, 'sessizlikte gürlük: ' + quiet.loudness);

  const loud = mk();
  feed(loud, spectrumOf([[440, 1]]), waveOf([440], 2048, 0.9), 60);
  assert.ok(!loud.silent, 'sinyal sessiz sayıldı');
  assert.ok(loud.loudness > 0.3, 'gürlük: ' + loud.loudness);
  assert.ok(loud.peak > 0.8, 'tepe: ' + loud.peak);
});

test('gürlük zaman sabiti kare hızından bağımsız', () => {
  const run = (fps) => {
    const an = mk();
    const spec = spectrumOf([[440, 1]]);
    const w = waveOf([440], 2048, 0.9);
    for (let t = 0; t < 1.2; t += 1 / fps) an.update(spec, w, 1 / fps);
    return an.loudness;
  };
  const a = run(30);
  const b = run(60);
  const c = run(144);
  assert.ok(Math.abs(a - b) < 0.02 && Math.abs(b - c) < 0.02, 'kare hızına duyarlı: ' + [a, b, c].join(', '));
});

// ===========================================================================
// Temel frekans
// ===========================================================================
test('perde takibi bilinen frekansı bulur', () => {
  for (const hz of [110, 220, 440, 880]) {
    const an = mk();
    an.update(spectrumOf([[hz, 1]]), waveOf([hz, hz * 2, hz * 3], 2048), 1 / 60);
    const err = Math.abs(an.pitch.hz - hz) / hz;
    assert.ok(err < 0.02, hz + ' Hz -> ' + an.pitch.hz.toFixed(1) + ' Hz (hata %' + (err * 100).toFixed(1) + ')');
  }
});

test('perde takibi nota adını ve sent sapmasını verir', () => {
  const an = mk();
  an.update(spectrumOf([[440, 1]]), waveOf([440], 2048), 1 / 60);
  assert.strictEqual(an.pitch.note, 'A4', 'nota: ' + an.pitch.note);
  assert.ok(Math.abs(an.pitch.cents) < 20, 'sent sapması: ' + an.pitch.cents);
});

test('perde takibi sessizlikte sıfır döner', () => {
  const an = mk();
  an.update(new Float32Array(BINS), new Float32Array(2048), 1 / 60);
  assert.strictEqual(an.pitch.hz, 0);
  assert.strictEqual(an.pitch.confidence, 0);
});

// ===========================================================================
// Armonik / vurmalı ayrışma
// ===========================================================================
test('sürekli ton armonik, geniş bantlı darbe vurmalı sayılır', () => {
  const tone = mk();
  const spec = spectrumOf([[440, 1], [880, 0.6], [1320, 0.4]]);
  for (let i = 0; i < 60; i++) tone.update(spec, null, 1 / 60);
  assert.ok(tone.harmonic > tone.percussive,
    'sürekli tonda armonik baskın olmalı: h=' + tone.harmonic.toFixed(3) + ' p=' + tone.percussive.toFixed(3));

  const perc = mk();
  const flat = new Float32Array(BINS);
  const empty = new Float32Array(BINS);
  for (let i = 0; i < BINS; i++) flat[i] = 0.6;
  let maxPerc = 0;
  for (let i = 0; i < 60; i++) {
    perc.update(i % 8 === 0 ? flat : empty, null, 1 / 60);
    maxPerc = Math.max(maxPerc, perc.percussive);
  }
  assert.ok(maxPerc > 0.5, 'darbeli sinyalde en yüksek vurmalı oranı: ' + maxPerc.toFixed(3));
});

test('armonik + vurmalı toplamı 1 (ya da sessizlikte 0)', () => {
  const an = mk();
  feed(an, spectrumOf([[440, 1]]), null, 30);
  assert.ok(Math.abs(an.harmonic + an.percussive - 1) < 1e-6,
    'toplam: ' + (an.harmonic + an.percussive));
});

// ===========================================================================
// Davul algılayıcıları
// ===========================================================================
test('bas davul, trampet ve hi-hat kendi bantlarında algılanır', () => {
  const dt = 1 / 60;
  const kickSpec = spectrumOf([[60, 1]]);
  const hatSpec = spectrumOf([[10000, 1]]);
  const quiet = new Float32Array(BINS);

  const an = mk();
  let kicks = 0;
  let hats = 0;
  for (let i = 0; i < 300; i++) {
    const t = i * dt;
    // Bas davul her 0.5 sn, hi-hat her 0.25 sn
    const kick = (t % 0.5) < 0.04;
    const hat = (t % 0.25) < 0.02;
    const s = new Float32Array(BINS);
    if (kick) for (let b = 0; b < BINS; b++) s[b] += kickSpec[b];
    if (hat) for (let b = 0; b < BINS; b++) s[b] += hatSpec[b];
    if (!kick && !hat) s.set(quiet);
    an.update(s, null, dt);
    if (an.hits.kick > 0) kicks++;
    if (an.hits.hat > 0) hats++;
  }
  assert.ok(kicks >= 8, 'bas davul tetiği: ' + kicks);
  assert.ok(hats >= 15, 'hi-hat tetiği: ' + hats);
});

test('bant enerjisi doğru frekans aralığından okunur', () => {
  const an = mk();
  an.update(spectrumOf([[60, 1]]), null, 1 / 60);
  assert.ok(an.bands.kick > an.bands.hat * 10, 'bas enerjisi tiz banda sızdı');
  an.update(spectrumOf([[10000, 1]]), null, 1 / 60);
  assert.ok(an.bands.hat > an.bands.kick * 10, 'tiz enerji bas banda sızdı');
});

// ===========================================================================
// Stereo
// ===========================================================================
test('stereo genişliği ve korelasyonu doğru', () => {
  const n = 1024;
  const l = new Float32Array(n);
  const r = new Float32Array(n);

  // Tam mono: korelasyon 1, genişlik 0
  for (let i = 0; i < n; i++) { l[i] = Math.sin(i * 0.1); r[i] = l[i]; }
  const mono = mk();
  mono.update(spectrumOf([[440, 1]]), null, 1 / 60, { left: l, right: r });
  assert.ok(Math.abs(mono.correlation - 1) < 1e-6, 'mono korelasyon: ' + mono.correlation);
  assert.ok(mono.width < 1e-6, 'mono genişlik: ' + mono.width);

  // Ters faz: korelasyon -1, genişlik en yüksek
  for (let i = 0; i < n; i++) r[i] = -l[i];
  const wide = mk();
  wide.update(spectrumOf([[440, 1]]), null, 1 / 60, { left: l, right: r });
  assert.ok(Math.abs(wide.correlation + 1) < 1e-6, 'ters faz korelasyonu: ' + wide.correlation);
  assert.ok(wide.width > 0.99, 'ters faz genişliği: ' + wide.width);
});

// ===========================================================================
// Modülasyon kaynakları
// ===========================================================================
test('sources() tüm değerleri 0..1 aralığında verir', () => {
  const an = mk();
  feed(an, spectrumOf([[440, 1], [880, 0.5]]), waveOf([440], 2048), 30);
  const src = an.sources();
  const keys = Object.keys(src);
  assert.ok(keys.length >= 18, 'kaynak sayısı: ' + keys.length);
  for (const k of keys) {
    const v = src[k];
    assert.ok(typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1, k + ': ' + v);
  }
});

// ===========================================================================
// Belirlenimlilik ve dayanıklılık
// ===========================================================================
test('aynı girdi aynı çıktıyı verir', () => {
  const run = () => {
    const an = mk();
    const next = player([440, 660], 3);
    const out = [];
    for (let i = 0; i < 60; i++) {
      const spec = spectrumOf([[440 + i * 5, 1], [880, 0.4]]);
      an.update(spec, next(), 1 / 60);
      out.push([an.centroid, an.flatness, an.harmonic, an.chord.name, an.pitch.hz, [...an.chroma]]);
    }
    return out;
  };
  assert.deepStrictEqual(run(), run(), 'aynı girdi farklı çıktı verdi');
});

test('bozuk ve uç girdilerde çökmez', () => {
  const an = mk();
  assert.doesNotThrow(() => {
    an.update(null, null, 1 / 60);
    an.update(new Float32Array(0), null, 1 / 60);
    an.update(new Float32Array(BINS), new Float32Array(0), 0);
    const big = new Float32Array(BINS);
    big.fill(1e6);
    an.update(big, null, 10);
    const neg = new Float32Array(BINS);
    neg.fill(-1);
    an.update(neg, null, 1 / 60);
  });
  for (const k of ['centroid', 'rolloff', 'flatness', 'loudness', 'harmonic']) {
    assert.ok(isFinite(an[k]), k + ' sonlu değil: ' + an[k]);
  }
});

test('reset() birikmiş durumu temizler', () => {
  const an = mk();
  playNotes(an, [['A', 4]], 60);
  assert.ok(an.chromaSmooth.some((v) => v > 0));
  an.reset();
  assert.ok(an.chromaSmooth.every((v) => v === 0), 'kroma temizlenmedi');
  assert.strictEqual(an._frames, 0);
});
