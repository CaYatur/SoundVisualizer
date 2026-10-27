/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Ses analizini dosyaya yazmak: JSON, CSV ve MIDI.

   Uygulama her karede zaten bir sürü şey ölçüyor: bantlar, gürlük, tını,
   nota sınıfları, akor, tonalite, davul vuruşları. Görüntü bunlarla
   çiziliyor ama sayıların kendisi dışarı çıkmıyordu. Bu modül onları bir
   ses dosyasının kare kare dökümüne çeviriyor; video kurgusunda anahtar
   kareye, bir DAW'da notaya, bir tabloda grafiğe dönüşebilsinler.

   Üç parça:
     Recorder   — kare başına bir kez çağrılır, değerleri sütunlara yazar,
                  davul olaylarını toplar
     finish()   — bütün dosyaya bakarak tempo, vuruş ızgarası, vuruş
                  başına akor ve tonalite çıkarır, özet hesaplar
     toJson / toCsv / toMidi — aynı veriden üç dosya

   NEDEN SONRADAN
   Canlı tempo ve akor motorları yalnız geçmişi görüyor ve görüntüye hızlı
   tepki vermek için ayarlı: gerçek bir parçada tempo ilk saniyelerde 170
   ile 80 BPM arasında geziyor, kare akoru saniyede birkaç kez değişiyor.
   Dosyaya yazarken bütün parça elde; tempo bütün başlangıç zarfından,
   akor vuruş aralığının ortalama kromasından bulunuyor. Kare sütunları ise
   görüntünün gördüğü canlı değerler olarak kalıyor.

   KARE HİZASI
   Satır N, videonun N. karesi: t = N / fps. Dışa aktarıcı sesi bu saatle
   çözümlüyor, yani aynı iş her seferinde aynı dosyayı verir.

   ALAN ADLARI
   Dosyalardaki anahtarlar modülasyon kaynaklarının kimlikleri (bass,
   band0, anLoudness, chroma0 …) ve İngilizce kalır: arayüz dili
   değiştiğinde dosyayı okuyan betikler bozulmasın. */
(function () {
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  /* Akor kalıpları analysis.js'teki CHORDS ile aynı; burada ayrıca
     tutuluyor çünkü modül dışa aktarıcıdan ve ana süreçten ayrı yükleniyor. */
  const CHORDS = [
    { id: 'maj', label: '', notes: [0, 4, 7] },
    { id: 'min', label: 'm', notes: [0, 3, 7] },
    { id: 'dim', label: 'dim', notes: [0, 3, 6] },
    { id: 'aug', label: 'aug', notes: [0, 4, 8] },
    { id: 'sus2', label: 'sus2', notes: [0, 2, 7] },
    { id: 'sus4', label: 'sus4', notes: [0, 5, 7] },
    { id: '7', label: '7', notes: [0, 4, 7, 10] },
    { id: 'maj7', label: 'maj7', notes: [0, 4, 7, 11] },
    { id: 'min7', label: 'm7', notes: [0, 3, 7, 10] },
    { id: 'dim7', label: 'dim7', notes: [0, 3, 6, 9] },
  ];
  const CHORD_NOTES = {};
  for (const c of CHORDS) CHORD_NOTES[c.id] = c.notes;
  // Krumhansl-Schmuckler profilleri (analysis.js ile aynı)
  const KEY_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KEY_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  /* Dosyaya giren modülasyon kaynakları: sesten ölçülenler. LFO, zarf,
     makro, rastgele ve zaman kaynakları sesle ilgili bir şey söylemiyor;
     dışarıda kalıyorlar. */
  const SOURCE_GROUPS = ['Ses', 'Spektrum', 'Serbest Bant', 'Çözümleme', 'Nota Sınıfı'];

  const FIELD_NOTES = {
    bass: 'Bass level as the visuals use it (20-160 Hz, smoothed), 0..1',
    mid: 'Mid level (160-2000 Hz, smoothed), 0..1',
    treble: 'Treble level (2-9 kHz, smoothed), 0..1',
    level: 'Overall RMS level, 0..1',
    onset: 'Onset envelope of the bass, 0..1',
    onsetTrig: '1 on frames where a bass onset fired',
    kickTrig: '1 on frames where the live detector heard a kick',
    snareTrig: '1 on frames where the live detector heard a snare',
    hatTrig: '1 on frames where the live detector heard a hi-hat',
    anChordRoot: 'Live chord root as pitch class / 11 (C = 0, B = 1)',
    anKeyTonic: 'Live key tonic as pitch class / 11 (C = 0, B = 1)',
    anCorrelation: 'Stereo correlation mapped from -1..1 to 0..1',
    anPitch: 'Fundamental frequency, log2(Hz / 55) / 5, 0 when none',
  };
  function fieldNote(id) {
    if (FIELD_NOTES[id]) return FIELD_NOTES[id];
    let m = /^band(\d)$/.exec(id);
    if (m) return 'Spectrum band ' + (+m[1] + 1) + ' of 8 (30 Hz-14 kHz, log spaced), 0..1';
    m = /^fband(\d)$/.exec(id);
    if (m) return 'Custom band ' + m[1] + ' (range and dB window from modulation.freeBands), 0..1';
    m = /^chroma(\d+)$/.exec(id);
    if (m) return 'Pitch class ' + NOTE_NAMES[+m[1]] + ' energy, smoothed, 0..1';
    if (/^an/.test(id)) return 'Analysis value ' + id.slice(2) + ', 0..1';
    return '';
  }
  // Dosyanın kendi sütunları (kaynak olmayanlar)
  const EXTRA_NOTES = {
    beat: '1 on the frame nearest each beat of the beat grid',
    downbeat: '1 on the frame nearest each first beat of a bar',
    pitchHz: 'Fundamental frequency in Hz, 0 when none',
    chord: 'Chord of the beat this frame is in (empty when none)',
    key: 'Live key estimate',
  };

  // Dosyaya yazılacak kaynak kimlikleri, katalog sırasıyla
  function fieldIds(catalog) {
    return catalog.filter((c) => SOURCE_GROUPS.indexOf(c.group) >= 0).map((c) => c.id);
  }

  const round = (v, d) => {
    if (!isFinite(v)) return 0;
    const k = Math.pow(10, d);
    return Math.round(v * k) / k;
  };

  // ==========================================================================
  // Kayıtçı
  // ==========================================================================
  class Recorder {
    /* opts: { fps, fields } — fields: dosyaya yazılacak kaynak kimlikleri */
    constructor(opts) {
      const o = opts || {};
      this.fps = o.fps > 0 ? o.fps : 60;
      this.fields = Array.isArray(o.fields) ? o.fields.slice() : [];
      this.cols = {};
      for (const f of this.fields) this.cols[f] = [];
      this.key = [];        // kare başına { name, tonic, mode, confidence }
      this.pitchHz = [];
      this.hits = { kick: [], snare: [], hat: [] };
      this.onsets = [];
      this.frames = 0;
    }

    /* Bir kare. values: modülatörün kaynak değerleri; analysis: ses
       motorunun Analyser'ı (yoksa null). */
    push(values, analysis) {
      const i = this.frames++;
      const t = i / this.fps;
      for (const f of this.fields) this.cols[f].push(values && values[f] != null ? +values[f] : 0);
      if (values && values.onsetTrig > 0) this.onsets.push(t);
      const h = analysis && analysis.hits;
      if (h) {
        for (const k of ['kick', 'snare', 'hat']) {
          if (h[k] > 0) this.hits[k].push({ t, strength: Math.min(1, h[k]) });
        }
      }
      const k = analysis && analysis.key;
      this.key.push(k && k.tonic >= 0
        ? { name: k.name, tonic: k.tonic, mode: k.mode, confidence: k.confidence }
        : null);
      this.pitchHz.push(analysis && analysis.pitch && analysis.pitch.hz > 0 ? analysis.pitch.hz : 0);
    }

    /* Tempo, ızgara, akorlar, tonalite ve özet.
       meta: { file, durationSec, sampleRate, generator } */
    finish(meta) {
      const m = meta || {};
      const fps = this.fps;
      const n = this.frames;
      const durationSec = m.durationSec || n / fps;
      /* Karenin çözümlemesi, karede biten 2048 örneklik pencerenin ortasını
         duyuyor: olay zamanları o kadar geri alınıyor ki DAW'da ya da
         kurguda sesle aynı anda dursun. Kare sütunları ise "N. karenin
         gördüğü" olarak kalıyor. */
      const lag = 1024 / (m.sampleRate || 48000);
      const at = (t) => round(Math.max(0, t - lag), 4);

      const env = onsetEnvelope(this.cols, n);
      const tempo = estimateTempo(env, fps);
      const grid = tempo.bpm > 0 ? beatGrid(env, fps, tempo.period, n, this.cols.anKick || this.cols.bass) : [];
      const beatFrames = grid.map((b) => b.frame);

      const chroma = chromaRows(this.cols, n);
      const chords = beatChords(chroma, beatFrames, n, fps);
      const key = globalKey(chroma);
      const keys = segments(this.key, fps, { minConf: KEY_MIN_CONF, minDur: KEY_MIN_DUR, keyOf: (k) => k.name })
        .map((s) => ({
          start: round(s.start, 3), end: round(s.end, 3), name: s.item.name,
          tonic: NOTE_NAMES[s.item.tonic], mode: s.item.mode, confidence: round(s.conf, 3),
        }));

      // Kare sütunları: ızgara vuruşları ve o karenin vuruşunun akoru
      const beatCol = new Array(n).fill(0);
      const downCol = new Array(n).fill(0);
      for (const b of grid) {
        if (b.frame < n) { beatCol[b.frame] = 1; if (b.downbeat) downCol[b.frame] = 1; }
      }
      const chordCol = new Array(n).fill('');
      for (const c of chords) {
        for (let i = c.from; i < c.to && i < n; i++) chordCol[i] = c.name;
      }

      return {
        format: 'cayadev-audio-analysis',
        version: 1,
        generator: m.generator || '',
        source: {
          file: m.file || '',
          durationSec: round(durationSec, 3),
          sampleRate: m.sampleRate || 48000,
        },
        fps,
        frameCount: n,
        eventLagSec: round(lag, 5),
        summary: {
          bpm: round(tempo.bpm, 2),
          beats: grid.length,
          // Izgaranın tuttuğu güçlü başlangıçların oranı: tempo değişen
          // parçada düşer, ızgaraya o zaman güvenilmemeli
          beatGridFit: round(gridFit(env, fps, grid), 3),
          key: key.name,
          keyMode: key.mode,
          keyConfidence: round(key.confidence, 3),
          loudnessMean: round(mean(this.cols.anLoudness), 4),
          loudnessPeak: round(max(this.cols.anLoudness), 4),
        },
        fields: this.fields.map((id) => ({ id, description: fieldNote(id) }))
          .concat(Object.keys(EXTRA_NOTES).map((id) => ({ id, description: EXTRA_NOTES[id] }))),
        frames: Object.assign({ t: range(n).map((i) => round(i / fps, 4)) },
          mapCols(this.cols, (a) => a.map((v) => round(v, 4))),
          {
            beat: beatCol,
            downbeat: downCol,
            pitchHz: this.pitchHz.map((v) => round(v, 2)),
            chord: chordCol,
            key: this.key.map((k) => (k ? k.name : '')),
          }),
        events: {
          beats: grid.map((b) => ({ t: at(b.t), downbeat: b.downbeat })),
          onsets: this.onsets.map(at),
          kick: this.hits.kick.map((h) => ({ t: at(h.t), strength: round(h.strength, 3) })),
          snare: this.hits.snare.map((h) => ({ t: at(h.t), strength: round(h.strength, 3) })),
          hat: this.hits.hat.map((h) => ({ t: at(h.t), strength: round(h.strength, 3) })),
        },
        segments: {
          chords: chords.map((c) => ({
            start: round(c.from / fps, 3), end: round(Math.min(c.to, n) / fps, 3), name: c.name,
            root: NOTE_NAMES[c.root], quality: c.quality, confidence: round(c.confidence, 3),
          })),
          keys,
        },
      };
    }
  }

  // ==========================================================================
  // Tempo ve vuruş ızgarası
  // ==========================================================================
  /* Başlangıç zarfı: gürlüğün kareden kareye ARTIŞI (yarım dalga
     doğrultma); tempo ve faz aranırken bir saniyelik kayan ortalaması
     çıkarılıyor, yavaş ses değişimi vuruş sayılmasın.
     Neden gürlük: sekiz tayf bandı görüntü için yumuşatılmış ve yüksek
     sesli masterlarda doyuyor, artışları neredeyse sıfır. Dört gerçek
     parçada (yükseltilmiş masterlar dahil) bant artışları bir parçada
     96 BPM verdi, gürlük artışı dördünde de kick aralıklarıyla tutan
     tempoyu. Gürlük ham tayftan, kullanıcının duyarlılık ya da bant
     ayarından etkilenmiyor. Sütun yoksa bant artışlarına düşülüyor. */
  function onsetEnvelope(cols, n) {
    const env = new Float64Array(n);
    const rise = (c) => {
      for (let i = 1; i < n; i++) {
        const d = c[i] - c[i - 1];
        if (d > 0) env[i] += d;
      }
    };
    if (cols.anLoudness) rise(cols.anLoudness);
    else for (let b = 0; b < 8; b++) if (cols['band' + b]) rise(cols['band' + b]);
    return env;
  }
  function detrend(env, w) {
    const n = env.length;
    const out = new Float64Array(n);
    let s = 0;
    const q = [];
    for (let i = 0; i < n; i++) {
      q.push(env[i]); s += env[i];
      if (q.length > w) s -= q.shift();
      const v = env[i] - s / q.length;
      out[i] = v > 0 ? v : 0;
    }
    return out;
  }

  /* Tempo: zarfın öz ilintisi; aday periyodun 1-4 katındaki ilintiler
     toplanıyor, yarı periyodunki de ekleniyor (ikiye bölünen vuruşu üçe
     bölünenden ayırmak için) ve 120 BPM çevresinde geniş bir ön bilgiyle
     tartılıyor: yalnız sekizlik kick çalan bir parça 64, 128 ve 85 BPM'e
     neredeyse eşit oy veriyor, ön bilgi yaygın olanı seçiyor.
     Periyot kesirli karede aranıyor; 0,05 BPM adım. */
  const MIN_BPM = 60;
  const MAX_BPM = 200;
  function estimateTempo(rawEnv, fps) {
    const env = detrend(rawEnv, Math.max(3, Math.round(fps)));
    const n = env.length;
    const maxLag = Math.min(n - 1, Math.ceil(4 * 60 * fps / MIN_BPM) + 2);
    if (n < fps * 4 || maxLag < 4) return { bpm: 0, period: 0 };
    let mu = 0;
    for (let i = 0; i < n; i++) mu += env[i];
    mu /= n;
    const x = new Float64Array(n);
    let e0 = 0;
    for (let i = 0; i < n; i++) { x[i] = env[i] - mu; e0 += x[i] * x[i]; }
    if (e0 < 1e-9) return { bpm: 0, period: 0 };
    const r = new Float64Array(maxLag + 1);
    for (let L = 0; L <= maxLag; L++) {
      let s = 0;
      for (let i = L; i < n; i++) s += x[i] * x[i - L];
      r[L] = s / e0;
    }
    const at = (L) => {
      if (L < 0 || L > maxLag) return 0;
      const a = Math.floor(L);
      const f = L - a;
      return a + 1 <= maxLag ? r[a] * (1 - f) + r[a + 1] * f : r[a];
    };
    let best = 0;
    let bestScore = -Infinity;
    for (let bpm = MIN_BPM; bpm <= MAX_BPM + 1e-9; bpm += 0.05) {
      const P = (60 * fps) / bpm;
      let s = 0;
      for (let k = 1; k <= 4; k++) s += at(k * P);
      s += 0.5 * at(P / 2);
      const z = Math.log2(bpm / 120) / 0.9;
      s *= Math.exp(-0.5 * z * z);
      if (s > bestScore) { bestScore = s; best = bpm; }
    }
    if (!(bestScore > 0)) return { bpm: 0, period: 0 };
    const bpm = Math.round(best * 100) / 100;
    return { bpm, period: (60 * fps) / bpm };
  }

  /* Izgara: periyot sabit, faz zarfı en çok tutan kaydırma (çeyrek kare
     adımla). Ölçü başı: dört konumdan kick (yoksa bas) enerjisinin en
     yüksek olduğu. Sabit tempo varsayılıyor; özetteki beatGridFit bunun
     ne kadar tuttuğunu söylüyor. */
  function beatGrid(rawEnv, fps, period, n, accent) {
    const env = detrend(rawEnv, Math.max(3, Math.round(fps)));
    const at = (a, f) => {
      const i = Math.floor(f);
      const w = f - i;
      if (i < 0 || i >= a.length) return 0;
      return i + 1 < a.length ? a[i] * (1 - w) + a[i + 1] * w : a[i];
    };
    let bestPhase = 0;
    let bestScore = -Infinity;
    for (let ph = 0; ph < period; ph += 0.25) {
      let s = 0;
      for (let f = ph; f < n; f += period) s += at(env, f);
      if (s > bestScore) { bestScore = s; bestPhase = ph; }
    }
    const beats = [];
    for (let f = bestPhase; f < n - 0.5; f += period) beats.push(f);
    let down = 0;
    let downScore = -Infinity;
    for (let d = 0; d < 4; d++) {
      let s = 0;
      for (let k = d; k < beats.length; k += 4) s += accent ? at(accent, beats[k]) : 0;
      if (s > downScore) { downScore = s; down = d; }
    }
    return beats.map((f, k) => ({ t: f / fps, frame: Math.round(f), downbeat: (k - down) % 4 === 0 }));
  }

  // Güçlü başlangıçların (zarfın üst %10'u, yerel tepe) ızgaraya ya da
  // vuruş arasına 70 ms içinde düşenlerinin oranı
  function gridFit(rawEnv, fps, grid) {
    if (grid.length < 2) return 0;
    const env = detrend(rawEnv, Math.max(3, Math.round(fps)));
    const peaks = [];
    for (let i = 1; i + 1 < env.length; i++) if (env[i] > env[i - 1] && env[i] >= env[i + 1]) peaks.push(env[i]);
    if (!peaks.length) return 0;
    const thr = peaks.slice().sort((a, b) => a - b)[Math.floor(peaks.length * 0.9)];
    const period = (grid[grid.length - 1].t - grid[0].t) / (grid.length - 1);
    const t0 = grid[0].t;
    let hit = 0;
    let all = 0;
    for (let i = 1; i + 1 < env.length; i++) {
      if (!(env[i] > env[i - 1] && env[i] >= env[i + 1] && env[i] >= thr)) continue;
      all++;
      const ph = ((i / fps - t0) / (period / 2)) % 1;
      const d = Math.min(ph, 1 - ph) * (period / 2);
      if (d <= 0.07) hit++;
    }
    return all ? hit / all : 0;
  }

  // ==========================================================================
  // Akor ve tonalite
  // ==========================================================================
  function chromaRows(cols, n) {
    const rows = [];
    for (let i = 0; i < n; i++) {
      const v = new Float64Array(12);
      for (let k = 0; k < 12; k++) v[k] = cols['chroma' + k] ? cols['chroma' + k][i] : 0;
      rows.push(v);
    }
    return rows;
  }
  function cosine(a, b) {
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < 12; i++) { num += a[i] * b[i]; da += a[i] * a[i]; db += b[i] * b[i]; }
    const den = Math.sqrt(da * db);
    return den > 1e-12 ? num / den : 0;
  }
  function correlate(a, b) {
    let ma = 0, mb = 0;
    for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; }
    ma /= 12; mb /= 12;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < 12; i++) {
      const x = a[i] - ma, y = b[i] - mb;
      num += x * y; da += x * x; db += y * y;
    }
    const den = Math.sqrt(da * db);
    return den > 1e-12 ? num / den : 0;
  }
  function classify(v) {
    let sum = 0;
    for (let k = 0; k < 12; k++) sum += v[k];
    if (sum < 1e-6) return null;
    const tpl = new Float64Array(12);
    let best = -1, root = 0, def = CHORDS[0];
    for (let r = 0; r < 12; r++) {
      for (const c of CHORDS) {
        tpl.fill(0);
        for (const iv of c.notes) tpl[(r + iv) % 12] = 1;
        const s = cosine(v, tpl);
        if (s > best + 1e-12) { best = s; root = r; def = c; }
      }
    }
    return { root, quality: def.id, name: NOTE_NAMES[root] + def.label, confidence: best };
  }

  /* Vuruş başına akor: vuruş aralığının ortalama kroması kalıplarla
     eşleşiyor; tek vuruşluk bir sapma iki komşusu aynıysa onlara
     katılıyor; aynı akorlu vuruşlar tek bölüm. Güveni CHORD_MIN_CONF
     altındaki vuruş akorsuz sayılıyor. Izgara yoksa yarım saniyelik
     pencereler kullanılıyor. */
  const CHORD_MIN_CONF = 0.6;
  const CHORD_MIN_BEATS = 2;
  function beatChords(chroma, beatFrames, n, fps) {
    let cuts = beatFrames.filter((f) => f < n);
    if (cuts.length < 2) {
      cuts = [];
      for (let f = 0; f < n; f += Math.max(1, Math.round(fps / 2))) cuts.push(f);
    }
    if (cuts[0] > 0) cuts.unshift(0);
    const spans = [];
    for (let k = 0; k < cuts.length; k++) {
      const a = cuts[k];
      const b = k + 1 < cuts.length ? cuts[k + 1] : n;
      if (b <= a) continue;
      const v = new Float64Array(12);
      for (let i = a; i < b; i++) for (let j = 0; j < 12; j++) v[j] += chroma[i][j];
      const c = classify(v);
      spans.push({ from: a, to: b, c: c && c.confidence >= CHORD_MIN_CONF ? c : null });
    }
    const name = (s) => (s && s.c ? s.c.name : '');
    for (let k = 1; k + 1 < spans.length; k++) {
      if (name(spans[k - 1]) && name(spans[k - 1]) === name(spans[k + 1]) && name(spans[k]) !== name(spans[k - 1])) {
        spans[k].c = spans[k - 1].c;
      }
    }
    const merged = [];
    for (const s of spans) {
      if (!s.c) continue;
      const last = merged[merged.length - 1];
      if (last && last.name === s.c.name && last.to === s.from) {
        last.to = s.to; last.confSum += s.c.confidence; last.k++;
      } else {
        merged.push({ from: s.from, to: s.to, name: s.c.name, root: s.c.root, quality: s.c.quality, confSum: s.c.confidence, k: 1 });
      }
    }
    /* Gerçek parçalarda kroma vuruştan vuruşa kayıyor (geçiş notaları,
       davul): tek vuruşluk bölüm önceki bölüme katılıyor, akor değişimi en
       az CHORD_MIN_BEATS vuruş sürmeli. Dört kayıtta ortanca bölüm bir
       vuruştan (~0,5 sn) bir ölçü dolayına çıktı. */
    const out = [];
    for (const s of merged) {
      const last = out[out.length - 1];
      if (last && last.to === s.from && (s.k < CHORD_MIN_BEATS || last.name === s.name)) {
        last.to = s.to;
        if (last.name === s.name) { last.confSum += s.confSum; last.k += s.k; }
      } else {
        out.push(Object.assign({}, s));
      }
    }
    return out.map((s) => ({ from: s.from, to: s.to, name: s.name, root: s.root, quality: s.quality, confidence: s.confSum / s.k }));
  }

  // Parçanın tonalitesi: bütün kroma toplamı, 24 profille ilinti
  function globalKey(chroma) {
    const v = new Float64Array(12);
    for (const r of chroma) for (let j = 0; j < 12; j++) v[j] += r[j];
    let sum = 0;
    for (let j = 0; j < 12; j++) sum += v[j];
    if (sum < 1e-6) return { name: '', mode: '', confidence: 0 };
    const rot = new Float64Array(12);
    let best = -2, tonic = 0, mode = 'major';
    for (let t = 0; t < 12; t++) {
      for (let k = 0; k < 12; k++) rot[k] = v[(t + k) % 12];
      const a = correlate(rot, KEY_MAJOR);
      if (a > best) { best = a; tonic = t; mode = 'major'; }
      const b = correlate(rot, KEY_MINOR);
      if (b > best) { best = b; tonic = t; mode = 'minor'; }
    }
    return { name: NOTE_NAMES[tonic] + (mode === 'minor' ? 'm' : ''), mode, confidence: Math.max(0, Math.min(1, (best + 1) / 2)) };
  }

  /* Canlı tonalite kare kare titreyebiliyor: bölüm, aynı adın en az minDur
     boyunca sürdüğü yer. Daha kısa koşular bir öncekinin devamı sayılıyor
     (öncesi yoksa atılıyor). */
  const KEY_MIN_CONF = 0.6;
  const KEY_MIN_DUR = 4;
  function segments(items, fps, o) {
    const runs = [];
    let cur = null;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const id = it && it.confidence >= o.minConf ? o.keyOf(it) : null;
      if (cur && cur.id === id) { cur.end = i + 1; cur.confSum += it ? it.confidence : 0; continue; }
      cur = { id, item: it, start: i, end: i + 1, confSum: it ? it.confidence : 0 };
      runs.push(cur);
    }
    const minFrames = Math.max(1, Math.round(o.minDur * fps));
    const out = [];
    for (const r of runs) {
      const long = r.end - r.start >= minFrames;
      const last = out[out.length - 1];
      if (r.id && long) {
        if (last && last.id === r.id && last.end === r.start) {
          last.end = r.end; last.confSum += r.confSum; last.frames += r.end - r.start;
        } else {
          out.push({ id: r.id, item: r.item, start: r.start, end: r.end, confSum: r.confSum, frames: r.end - r.start });
        }
      } else if (last && last.end === r.start && !(r.id === null && long)) {
        // kısa sapma: önceki bölüm sürüyor (güveni hesaba katılmıyor)
        last.end = r.end;
      }
    }
    return out.map((s) => ({ start: s.start / fps, end: s.end / fps, item: s.item, conf: s.confSum / Math.max(1, s.frames) }));
  }

  const mean = (a) => (a && a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const max = (a) => (a && a.length ? a.reduce((s, v) => (v > s ? v : s), -Infinity) : 0);
  const range = (n) => Array.from({ length: n }, (_, i) => i);
  function mapCols(cols, fn) {
    const out = {};
    for (const k of Object.keys(cols)) out[k] = fn(cols[k]);
    return out;
  }

  // ==========================================================================
  // JSON ve CSV
  // ==========================================================================
  function toJson(data) {
    return JSON.stringify(data) + '\n';
  }

  /* CSV: virgülle ayrılmış, ondalık ayırıcı nokta. Satır başına bir kare;
     akor ve tonalite adları metin. Türkçe Excel noktalı virgül bekler:
     "Veri > Metinden" ile virgül seçilerek açılır (README'de yazılı). */
  function toCsv(data) {
    const f = data.frames;
    const cols = ['t'].concat(data.fields.map((x) => x.id));
    const lines = [['frame'].concat(cols).join(',')];
    const n = data.frameCount;
    for (let i = 0; i < n; i++) {
      const row = [i];
      for (const c of cols) {
        const v = f[c][i];
        row.push(typeof v === 'string' ? csvText(v) : v);
      }
      lines.push(row.join(','));
    }
    return lines.join('\n') + '\n';
  }
  function csvText(s) {
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // ==========================================================================
  // MIDI (SMF biçim 1)
  // ==========================================================================
  /* Dört iz:
       0 Tempo   — tempo (bulunan BPM), 4/4, tonalite ve tempo işaretçileri
       1 Beats   — kanal 10: ölçü başı 76 (tahta blok, yüksek), diğer vuruşlar 77
       2 Drums   — kanal 10: kick 36, snare 38, kapalı hi-hat 42; hız şiddetten
       3 Chords  — kanal 1: akor notaları (kök 3. oktavda), adları metin olayı
     Zaman tikleri, dosyanın tempo olayıyla tam aynı formülle saniyeden
     çevriliyor: DAW'da olaylar sesle aynı anda çalar; ızgara da bulunan
     tempoya oturur. Tempo yoksa 120 BPM. */
  const PPQ = 960;
  function toMidi(data) {
    const bpm = data.summary.bpm > 0 ? data.summary.bpm : 120;
    const uspq = Math.max(1, Math.min(0xffffff, Math.round(60e6 / bpm)));
    const tick = (s) => Math.max(0, Math.round((s * 1e6 / uspq) * PPQ));
    const endTick = tick(data.source.durationSec || data.frameCount / data.fps);

    const conductor = [];
    conductor.push({ t: 0, d: meta(0x03, text('Tempo')) });
    conductor.push({ t: 0, d: meta(0x51, [(uspq >> 16) & 255, (uspq >> 8) & 255, uspq & 255]) });
    conductor.push({ t: 0, d: meta(0x58, [4, 2, 24, 8]) });
    conductor.push({ t: 0, d: meta(0x06, text('BPM ' + (data.summary.bpm > 0 ? data.summary.bpm.toFixed(2) : '?'))) });
    if (data.summary.key) conductor.push({ t: 0, d: meta(0x06, text('Key ' + data.summary.key)) });

    const beats = [{ t: 0, d: meta(0x03, text('Beats')) }];
    for (const b of data.events.beats) note(beats, 9, b.downbeat ? 76 : 77, 100, tick(b.t), tick(b.t + 0.05));

    const drums = [{ t: 0, d: meta(0x03, text('Drums')) }];
    const GM = { kick: 36, snare: 38, hat: 42 };
    for (const k of ['kick', 'snare', 'hat']) {
      for (const h of data.events[k]) {
        note(drums, 9, GM[k], Math.max(1, Math.min(127, Math.round(40 + 87 * h.strength))), tick(h.t), tick(h.t + 0.06));
      }
    }

    const chords = [{ t: 0, d: meta(0x03, text('Chords')) }];
    for (const c of data.segments.chords) {
      const root = NOTE_NAMES.indexOf(c.root);
      const ivs = CHORD_NOTES[c.quality] || CHORD_NOTES.maj;
      const a = tick(c.start);
      const b = Math.max(a + 1, tick(c.end));
      chords.push({ t: a, d: meta(0x01, text(c.name)) });
      for (const iv of ivs) note(chords, 0, 48 + root + iv, 80, a, b);
    }

    const tracks = [conductor, beats, drums, chords].map((ev) => trackChunk(ev, endTick));
    const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, (PPQ >> 8) & 255, PPQ & 255];
    let len = head.length;
    for (const t of tracks) len += t.length;
    const out = new Uint8Array(len);
    out.set(head, 0);
    let o = head.length;
    for (const t of tracks) { out.set(t, o); o += t.length; }
    return out;
  }

  function note(list, ch, key, vel, a, b) {
    // Aynı tikte kapanış açılıştan önce sıralansın diye sıra anahtarı
    list.push({ t: a, ord: 1, d: [0x90 | ch, key & 127, vel & 127] });
    list.push({ t: Math.max(a + 1, b), ord: 0, d: [0x80 | ch, key & 127, 0] });
  }
  function meta(type, bytes) {
    return [0xff, type].concat(vlq(bytes.length), bytes);
  }
  function text(s) {
    // Meta metinleri ASCII; akor adlarında yalnız # ve harf var
    return Array.from(String(s)).map((ch) => (ch.charCodeAt(0) < 128 ? ch.charCodeAt(0) : 63));
  }
  function vlq(n) {
    let v = Math.max(0, Math.floor(n));
    const bytes = [v & 0x7f];
    while ((v >>= 7) > 0) bytes.unshift((v & 0x7f) | 0x80);
    return bytes;
  }
  function trackChunk(events, endTick) {
    const ev = events.map((e, i) => ({ t: e.t, ord: e.ord == null ? -1 : e.ord, i, d: e.d }));
    ev.sort((a, b) => a.t - b.t || a.ord - b.ord || a.i - b.i);
    const last = ev.length ? ev[ev.length - 1].t : 0;
    const bytes = [];
    let now = 0;
    for (const e of ev) {
      bytes.push(...vlq(e.t - now), ...e.d);
      now = e.t;
    }
    bytes.push(...vlq(Math.max(0, Math.max(endTick, last) - now)), 0xff, 0x2f, 0x00);
    const n = bytes.length;
    return Uint8Array.from([0x4d, 0x54, 0x72, 0x6b, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].concat(bytes));
  }

  const api = {
    Recorder, SOURCE_GROUPS, fieldIds, fieldNote, segments, onsetEnvelope, estimateTempo, beatGrid, gridFit,
    beatChords, globalKey, classify, toJson, toCsv, toMidi, PPQ, CHORD_MIN_CONF, KEY_MIN_CONF, KEY_MIN_DUR,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVAnalysisExport = api;
})();
