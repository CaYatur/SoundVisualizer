/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Derin ses çözümlemesi.

   Dört bant ve bir seviye ölçeri sinyalden çıkarılabilecek şeyin çok küçük bir
   parçası. Bu modül aynı FFT'den nota sınıflarını, tonaliteyi, akoru, tınısal
   betimleyicileri, gürlüğü, temel frekansı ve armonik/vurmalı ayrışmasını
   çıkarır. Hepsi modülasyon matrisine kaynak olarak açılır.

   Tasarım kararları:

   - Motor SAF: girdisi bir büyüklük tayfı ve bir zaman tamponu, çıktısı
     sayılar. DOM'a, Web Audio'ya ya da GPU'ya bağlı değil; bu yüzden
     tests/analysis.test.js her özelliği bilinen cevaplı yapay sinyallerle
     ölçebiliyor (tempo.js'te işe yarayan desenin aynısı).
   - Zaman sabitleri dt üzerinden uygulanır, yani kare hızı sonucu değiştirmez
     ve çevrimdışı dışa aktarımda belirlenimli kalır.
   - Ayırt edici hiçbir sabit "sihirli sayı" değil: tonalite profilleri
     Krumhansl-Schmuckler, akor kalıpları kanonik aralık yapıları, armonik /
     vurmalı ayrışması ise medyan süzgeçli standart yöntem. */
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const alphaFor = (dt, tau) => (tau > 0 ? 1 - Math.exp(-Math.max(0, dt) / tau) : 1);

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  /* Krumhansl-Schmuckler tonalite profilleri. Dinleyici deneylerinden gelen
     ağırlıklar: bir tonalitede hangi derecenin ne kadar "yerinde" durduğunu
     anlatır. Kromayı 12 kaydırmanın her biriyle ilişkilendirip en yükseği
     seçmek standart tonalite kestirimidir. */
  const KEY_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KEY_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  /* Akor kalıpları — kök notaya göre yarım ton aralıkları. */
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

  // Pearson korelasyonu — tonalite eşlemesinde kullanılır
  function correlate(a, b) {
    const n = a.length;
    let ma = 0;
    let mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i] - ma;
      const y = b[i] - mb;
      num += x * y; da += x * x; db += y * y;
    }
    const den = Math.sqrt(da * db);
    return den > 1e-12 ? num / den : 0;
  }

  // Kosinüs benzerliği — akor kalıplarında (ikili vektörler) daha uygun
  function cosine(a, b) {
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < a.length; i++) {
      num += a[i] * b[i]; da += a[i] * a[i]; db += b[i] * b[i];
    }
    const den = Math.sqrt(da * db);
    return den > 1e-12 ? num / den : 0;
  }

  // Yerinde medyan (küçük pencereler için sıralama yeterince hızlı)
  function median(arr, out, radius) {
    const n = arr.length;
    const buf = new Float32Array(radius * 2 + 1);
    for (let i = 0; i < n; i++) {
      let c = 0;
      for (let k = -radius; k <= radius; k++) {
        const j = i + k;
        if (j < 0 || j >= n) continue;
        buf[c++] = arr[j];
      }
      const slice = buf.subarray(0, c);
      // küçük dizide ekleme sıralaması hızlıdır
      for (let x = 1; x < c; x++) {
        const v = slice[x];
        let y = x - 1;
        while (y >= 0 && slice[y] > v) { slice[y + 1] = slice[y]; y--; }
        slice[y + 1] = v;
      }
      out[i] = slice[(c - 1) >> 1];
    }
    return out;
  }

  // ==========================================================================

  /* ITU-R BS.1770-4 / EBU R128 gürlük ölçeri (LUFS).

     Mevcut "Gürlük" göstergesi 0..1 görsel bir sayı; mastering ve yayında
     konuşulan birim ise LUFS. Bu sınıf standardın kendisini uygular:
       - K ağırlıklama: yüksek raf ön süzgeci + RLB yüksek geçiren, iki
         ikinci derece süzgeç. Katsayılar her örnekleme hızı için
         formülden üretilir (libebur128 ile aynı yöntem), yani 44.1 ve
         48 kHz ikisi de doğru ölçer.
       - Anlık (M) 400 ms, kısa süreli (S) 3 s pencere; 100 ms adımla.
       - Entegre (I): 400 ms bloklar, -70 LUFS mutlak ve -10 LU göreli kapı.
         Bloklar 0.1 LU'luk bir histogramda tutulur; saatlerce açık kalsa da
         bellek sabit kalır.
     Saf aritmetik: tests/lufs.test.js bilinen cevaplı sinüslerle ölçer. */
  const LUFS_FLOOR = -70;
  const HIST_MIN = -70;
  const HIST_MAX = 10;
  const HIST_STEP = 0.1;
  const HIST_BINS = Math.round((HIST_MAX - HIST_MIN) / HIST_STEP);

  function kWeighting(fs) {
    // Ön süzgeç (yüksek raf, ~+4 dB @ >1.5 kHz)
    let f0 = 1681.974450955533;
    const G = 3.999843853973347;
    let Q = 0.7071752369554196;
    let K = Math.tan((Math.PI * f0) / fs);
    const Vh = Math.pow(10, G / 20);
    const Vb = Math.pow(Vh, 0.4996667741545416);
    let a0 = 1 + K / Q + K * K;
    const pre = {
      b0: (Vh + (Vb * K) / Q + K * K) / a0,
      b1: (2 * (K * K - Vh)) / a0,
      b2: (Vh - (Vb * K) / Q + K * K) / a0,
      a1: (2 * (K * K - 1)) / a0,
      a2: (1 - K / Q + K * K) / a0,
    };
    // RLB yüksek geçiren (~38 Hz)
    f0 = 38.13547087602444;
    Q = 0.5003270373238773;
    K = Math.tan((Math.PI * f0) / fs);
    a0 = 1 + K / Q + K * K;
    const rlb = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
    return [pre, rlb];
  }

  const energyToLufs = (e) => (e > 0 ? -0.691 + 10 * Math.log10(e) : -Infinity);

  class LoudnessMeter {
    constructor(opts) {
      const o = opts || {};
      this.sampleRate = o.sampleRate || 48000;
      this.filters = kWeighting(this.sampleRate);
      this.hop = Math.max(1, Math.round(this.sampleRate * 0.1));
      this.reset();
    }

    reset() {
      // Kanal başına iki süzgecin durumu (DF-I: x1,x2,y1,y2)
      this._state = [new Float64Array(8), new Float64Array(8)];
      this._acc = [0, 0];
      this._n = 0;
      this._subs = new Float64Array(30); // son 30 × 100 ms alt blok enerjisi
      this._subCount = 0;
      this._subPos = 0;
      this._histCount = new Float64Array(HIST_BINS);
      this._histEnergy = new Float64Array(HIST_BINS);
      this.momentary = -Infinity;
      this.shortTerm = -Infinity;
      this.integrated = -Infinity;
      this.maxMomentary = -Infinity;
    }

    _filter(ch, x) {
      const s = this._state[ch];
      const f0 = this.filters[0];
      const f1 = this.filters[1];
      const y0 = f0.b0 * x + f0.b1 * s[0] + f0.b2 * s[1] - f0.a1 * s[2] - f0.a2 * s[3];
      s[1] = s[0]; s[0] = x; s[3] = s[2]; s[2] = y0;
      const y1 = f1.b0 * y0 + f1.b1 * s[4] + f1.b2 * s[5] - f1.a1 * s[6] - f1.a2 * s[7];
      s[5] = s[4]; s[4] = y0; s[7] = s[6]; s[6] = y1;
      return y1;
    }

    /* Ardışık örnekleri işle. right verilmezse tek kanal ölçülür.
       start/end: dizinin hangi aralığının yeni örnek olduğu. */
    push(left, right, start, end) {
      if (!left) return this;
      const a = start == null ? 0 : Math.max(0, start | 0);
      const b = end == null ? left.length : Math.min(left.length, end | 0);
      const stereo = !!(right && right.length >= b);
      for (let i = a; i < b; i++) {
        const l = this._filter(0, left[i]);
        this._acc[0] += l * l;
        if (stereo) {
          const r = this._filter(1, right[i]);
          this._acc[1] += r * r;
        }
        if (++this._n >= this.hop) this._closeSub();
      }
      return this;
    }

    _closeSub() {
      // Kanal ortalama karelerinin toplamı (L/R ağırlığı 1.0)
      const e = (this._acc[0] + this._acc[1]) / this._n;
      this._acc[0] = 0; this._acc[1] = 0; this._n = 0;
      this._subs[this._subPos] = e;
      this._subPos = (this._subPos + 1) % this._subs.length;
      if (this._subCount < this._subs.length) this._subCount++;
      const mean = (k) => {
        let sum = 0;
        for (let j = 1; j <= k; j++) sum += this._subs[(this._subPos - j + this._subs.length) % this._subs.length];
        return sum / k;
      };
      if (this._subCount >= 4) {
        const block = mean(4);
        this.momentary = energyToLufs(block);
        if (this.momentary > this.maxMomentary) this.maxMomentary = this.momentary;
        this._gate(block);
      }
      if (this._subCount >= 30) this.shortTerm = energyToLufs(mean(30));
    }

    // 400 ms bloğu entegre ölçüme ekle (mutlak kapı burada)
    _gate(energy) {
      const L = energyToLufs(energy);
      if (!(L > LUFS_FLOOR)) return;
      const bin = Math.min(HIST_BINS - 1, Math.max(0, Math.floor((L - HIST_MIN) / HIST_STEP)));
      this._histCount[bin] += 1;
      this._histEnergy[bin] += energy;
      let n = 0;
      let sum = 0;
      for (let i = 0; i < HIST_BINS; i++) { n += this._histCount[i]; sum += this._histEnergy[i]; }
      if (!n) return;
      const rel = energyToLufs(sum / n) - 10;
      let n2 = 0;
      let sum2 = 0;
      for (let i = 0; i < HIST_BINS; i++) {
        if (!this._histCount[i]) continue;
        // Kutunun ortalama gürlüğü göreli kapıyla karşılaştırılır
        if (energyToLufs(this._histEnergy[i] / this._histCount[i]) >= rel) {
          n2 += this._histCount[i];
          sum2 += this._histEnergy[i];
        }
      }
      this.integrated = n2 ? energyToLufs(sum2 / n2) : -Infinity;
    }
  }

  // LUFS'u 0..1'e taşı (modülasyon kaynağı): -60 LUFS = 0, 0 LUFS = 1
  const lufsUnit = (v) => (isFinite(v) ? clamp01((v + 60) / 60) : 0);

  class Analyser {
    /* opts:
         sampleRate — örnekleme hızı (varsayılan 48000)
         fftSize    — FFT boyu; bin frekansı = i * sampleRate / fftSize
         histSize   — armonik/vurmalı ayrışması için tayf geçmişi kare sayısı */
    constructor(opts) {
      const o = opts || {};
      this.sampleRate = o.sampleRate || 48000;
      this.fftSize = o.fftSize || 2048;
      this.binHz = this.sampleRate / this.fftSize;
      this.histSize = o.histSize || 17;

      this.chroma = new Float32Array(12);
      this.chromaSmooth = new Float32Array(12);
      this.key = { tonic: -1, mode: 'major', name: '—', confidence: 0 };
      this.chord = { root: -1, quality: 'maj', name: '—', confidence: 0 };

      this.centroid = 0;   // 0..1 (Nyquist'e göre)
      this.rolloff = 0;    // 0..1
      this.flatness = 0;   // 0..1 (1 = gürültü, 0 = saf ton)
      this.crest = 0;      // tepe / ortalama, 0..1'e sıkıştırılmış
      this.flux = 0;       // pozitif tayf değişimi
      this.spread = 0;     // tayfsal yayılım

      this.loudness = 0;   // 0..1
      // LUFS yalnız panel ya da etkin yönlendirme isteyince ayrılır ve işlenir.
      this.loudnessMeter = null;
      this._loudnessDemand = 0;
      this.peak = 0;
      this.dynamics = 0;   // tepe / RMS
      this.silent = true;

      this.pitch = { hz: 0, note: '—', midi: 0, cents: 0, confidence: 0 };

      this.harmonic = 0;   // 0..1 armonik enerji oranı
      this.percussive = 0; // 0..1 vurmalı enerji oranı

      this.width = 0;      // stereo genişliği (kanal verilirse)
      this.correlation = 1;

      this.humGuard = o.humGuard !== undefined ? !!o.humGuard : true;
      this.humDetected = false; // 50/60 Hz şebeke uğultusu veya dip gürültüsü algılandı mı

      this.bands = { kick: 0, snare: 0, hat: 0 };
      this.hits = { kick: 0, snare: 0, hat: 0 };

      this._prevSpec = null;
      this._hist = [];
      this._histPos = 0;
      this._onsets = null;
      this._loudFast = 0;
      this._loudSlow = 0;
      this._keyAcc = new Float32Array(12);
      this._frames = 0;

      // Sabit-Q süzgeç bankası (kroma). İlk kullanımda kurulur.
      this._cq = null;
      this._ring = null;
      this._ringPos = 0;
      this._ringFill = 0;
      this._cqNever = true;
      // Banka kaç karede bir koşsun (kroma yavaş değişir, her kare gereksiz)
      this.chromaEvery = o.chromaEvery || 3;
      /* Perde takibi de her karede gerekmez. YIN karenin en pahalı işi
         (2048 örnek x ~870 gecikme); nota hızında değişen bir büyüklük için
         60 Hz aşırıdır. Dört karede bir koşmak maliyeti dörde böler ve
         algılanabilir bir gecikme yaratmaz. */
      this.pitchEvery = o.pitchEvery || 4;
      this._buildCQ();
    }

    reset() {
      this._prevSpec = null;
      this._hist.length = 0;
      this._histPos = 0;
      this._keyAcc.fill(0);
      this._frames = 0;
      this.chromaSmooth.fill(0);
      this.chroma.fill(0);
      if (this._ring) this._ring.fill(0);
      this._ringPos = 0;
      this._ringFill = 0;
      this._cqNever = true;
      if (this.loudnessMeter) this.loudnessMeter.reset();
      if (this._onsets) for (const k in this._onsets) this._onsets[k].reset();
    }

    _ensureOnsets() {
      if (this._onsets) return;
      let Onset = null;
      if (typeof window !== 'undefined' && window.SVOnset) Onset = window.SVOnset.Onset;
      else if (typeof require === 'function') {
        try { Onset = require('./onset.js').Onset; } catch (e) { Onset = null; }
      }
      if (!Onset) return;
      this._onsets = {
        // Refrakter süreler enstrümanın fiziğine göre: davul tekmesi ardışık
        // 16'lıklarda bile ~90 ms, hi-hat çok daha sık gelebilir
        kick: new Onset({ refractory: 0.09, floor: 0.3, gate: 0.008 }),
        snare: new Onset({ refractory: 0.09, floor: 0.3, gate: 0.008 }),
        hat: new Onset({ refractory: 0.045, floor: 0.3, gate: 0.008 }),
      };
    }

    /* Frekans aralığındaki enerji (RMS).

       Düz ortalama yerine RMS kullanılıyor: geniş bir bantta dar bir kaynak
       (ör. 6-14 kHz aralığında birkaç kutuya oturan hi-hat) ortalamada yüzlerce
       boş kutuya bölünüp yok oluyordu. RMS bu seyrelmeyi yapmaz ve dar bantlı
       vuruşlar da algılanabilir kalır. */
    bandEnergy(spec, f0, f1) {
      const i0 = Math.max(1, Math.floor(f0 / this.binHz));
      const i1 = Math.min(spec.length - 1, Math.ceil(f1 / this.binHz));
      if (i1 < i0) return 0;
      let s = 0;
      for (let i = i0; i <= i1; i++) s += spec[i] * spec[i];
      return Math.sqrt(s / (i1 - i0 + 1));
    }

    /* Kare başına bir kez.
         spec — büyüklük tayfı (0..1), uzunluk fftSize/2
         time — zaman alanı örnekleri (-1..1) ya da null
         dt   — saniye
         stereo — { left, right } verilirse genişlik hesaplanır */
    update(spec, time, dt, stereo) {
      if (!spec || !spec.length) return this;
      const step = clamp(dt || 0.016, 1 / 1000, 0.25);
      this._frames++;

      this._spectral(spec);
      this._chroma(spec, step, time);
      this._chord();
      this._key(step);
      this._hpss(spec);
      this._levels(time, step, spec);
      this._lufs(time, step, stereo);
      this._pitchTrack(time);
      this._drums(spec, step);
      if (stereo) this._stereo(stereo);
      if (this.silent) {
        this.pitch = { hz: 0, note: '—', midi: 0, cents: 0, confidence: 0 };
        this.chord = { root: -1, quality: 'maj', name: '—', confidence: 0 };
        this.key = { tonic: -1, mode: 'major', name: '—', confidence: 0 };
        this._keyAcc.fill(0);
        this.chroma.fill(0);
        this.chromaSmooth.fill(0);
        this.bands.kick = 0;
        this.bands.snare = 0;
        this.bands.hat = 0;
        this.hits = { kick: 0, snare: 0, hat: 0 };
        this.centroid = 0;
        this.flatness = 0;
        this.rolloff = 0;
        this.flux = 0;
        this.harmonic = 0;
        this.percussive = 0;
        this.loudness = 0;
        this.peak = 0;
        this.dynamics = 0;
        this.correlation = 0;
        this.width = 0;
        this.crest = 0;
        this.spread = 0;
        this._loudFast = 0;
        this._loudSlow = 0;
      }
      return this;
    }

    // ---------------------------------------------------------------- tayf
    _spectral(spec) {
      const n = spec.length;
      let sum = 0;
      let wsum = 0;
      let logSum = 0;
      let max = 0;
      let count = 0;
      for (let i = 1; i < n; i++) {
        const m = spec[i];
        if (m > max) max = m;
        sum += m;
        wsum += m * i;
        logSum += Math.log(m + 1e-9);
        count++;
      }
      const mean = count ? sum / count : 0;
      this.centroid = sum > 1e-9 ? clamp01((wsum / sum) / n) : 0;
      // Tayfsal düzlük: geometrik ortalama / aritmetik ortalama.
      // Beyaz gürültüde 1'e, saf tonda 0'a gider.
      const geo = count ? Math.exp(logSum / count) : 0;
      this.flatness = mean > 1e-9 ? clamp01(geo / mean) : 0;
      this.crest = mean > 1e-9 ? clamp01(max / (mean * 20)) : 0;

      // %85 yuvarlanma noktası
      const target = sum * 0.85;
      let acc = 0;
      let idx = n - 1;
      for (let i = 1; i < n; i++) {
        acc += spec[i];
        if (acc >= target) { idx = i; break; }
      }
      this.rolloff = clamp01(idx / n);

      // Tayfsal yayılım (merkez etrafındaki standart sapma)
      if (sum > 1e-9) {
        const c = (wsum / sum);
        let v = 0;
        for (let i = 1; i < n; i++) { const d = i - c; v += spec[i] * d * d; }
        this.spread = clamp01(Math.sqrt(v / sum) / (n * 0.5));
      } else {
        this.spread = 0;
      }

      // Pozitif tayf akısı
      if (!this._prevSpec || this._prevSpec.length !== n) {
        this._prevSpec = new Float32Array(n);
        this.flux = 0;
      } else {
        let f = 0;
        for (let i = 1; i < n; i++) {
          const d = spec[i] - this._prevSpec[i];
          if (d > 0) f += d;
        }
        this.flux = clamp01(f / Math.max(1, n * 0.02));
      }
      this._prevSpec.set(spec);
    }

    // -------------------------------------------------------------- kroma
    /* Nota sınıfı vektörü — sabit-Q süzgeç bankası (Goertzel).

       FFT kutularını nota sınıfına yuvarlamak alt oktavlarda ÇALIŞMAZ ve bu
       bir ayar meselesi değil, çözünürlük meselesidir: 48 kHz / 2048'de kutu
       aralığı 23.4 Hz, A3 (220 Hz) ile C4 (261.6 Hz) arasındaki mesafe ise
       41.6 Hz — yani iki nota FFT'nin ana lobundan (~4 kutu ≈ 94 Hz) dar. Bu
       ölçekte hiçbir tepe bulma yöntemi ikisini ayıramaz; ölçüm penceresinin
       kendisi kısa.

       Bu yüzden kroma tayftan değil, biriktirilen ZAMAN sinyalinden
       hesaplanır. Her yarım ton için ayrı bir Goertzel süzgeci koşar ve
       pencere uzunluğu notanın periyoduna göre seçilir (düşük nota = uzun
       pencere). Bu, sabit-Q dönüşümünün ta kendisidir: her notada aynı göreli
       çözünürlük elde edilir.

       Maliyet düşük tutuluyor: katsayılar ve pencereler bir kez hesaplanıp
       saklanır, banka her karede değil CHROMA_EVERY karede bir koşar — kroma
       zaten yavaş değişen bir büyüklük. */
    _buildCQ() {
      // C3 (MIDI 48) — A6 (MIDI 93). Altında pencere gereksiz uzardı, üstünde
      // müzikal içerik yerine armonikler baskın olur.
      const LO_MIDI = 48;
      const HI_MIDI = 93;
      const CYCLES = 18;          // pencere başına periyot sayısı
      const MAX_N = 12288;
      const notes = [];
      let maxN = 0;
      for (let midi = LO_MIDI; midi <= HI_MIDI; midi++) {
        const hz = 440 * Math.pow(2, (midi - 69) / 12);
        let N = Math.round((CYCLES * this.sampleRate) / hz);
        N = Math.max(256, Math.min(MAX_N, N));
        const w = (2 * Math.PI * hz) / this.sampleRate;
        const win = new Float32Array(N);
        for (let i = 0; i < N; i++) win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
        notes.push({ midi, pc: midi % 12, N, coeff: 2 * Math.cos(w), win });
        if (N > maxN) maxN = N;
      }
      this._cq = notes;
      this._ringLen = maxN;
      this._ring = new Float32Array(maxN);
      this._ringPos = 0;
      this._ringFill = 0;
    }

    // Zaman örneklerini halka tampona ekle
    _pushTime(time) {
      if (!time || !time.length) return;
      if (!this._ring) this._buildCQ();
      const ring = this._ring;
      const len = ring.length;
      for (let i = 0; i < time.length; i++) {
        ring[this._ringPos] = time[i];
        this._ringPos = (this._ringPos + 1) % len;
      }
      this._ringFill = Math.min(len, this._ringFill + time.length);
    }

    /* Bir notanın Goertzel büyüklüğü. Halka tamponun SON N örneği okunur. */
    _goertzel(note) {
      const ring = this._ring;
      const len = ring.length;
      const N = note.N;
      if (this._ringFill < N) return 0;
      const coeff = note.coeff;
      const win = note.win;
      let s1 = 0;
      let s2 = 0;
      let idx = (this._ringPos - N + len) % len;
      for (let i = 0; i < N; i++) {
        const s0 = ring[idx] * win[i] + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
        idx++;
        if (idx === len) idx = 0;
      }
      const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
      return power > 0 ? Math.sqrt(power) / (N * 0.25) : 0;
    }

    _chroma(spec, dt, time) {
      this._pushTime(time);
      const c = this.chroma;

      // Süzgeç bankası her karede koşmaz; kroma yavaş değişir ve banka
      // karenin en pahalı işi olurdu.
      const every = this.chromaEvery;
      const due = ((this._frames - 1) % every) === 0 || this._cqNever;
      if (time && time.length && due) {
        c.fill(0);
        let total = 0;
        for (const note of this._cq) {
          const m = this._goertzel(note);
          const w = m * m;
          c[note.pc] += w;
          total += w;
        }
        const minChromaEnergy = (this.humGuard !== false) ? 1e-4 : 1e-12;
        if (total > minChromaEnergy) {
          for (let k = 0; k < 12; k++) c[k] /= total;
          this._cqNever = false;
        } else {
          c.fill(0);
        }
      } else if (!time || !time.length) {
        // Zaman sinyali yoksa tayftan tepe interpolasyonuyla yaklaş. Alt
        // oktavlarda güvenilmez olduğu bilinir; yalnızca yedek yoldur.
        this._chromaFromSpectrum(spec);
      }

      const a = alphaFor(dt, 0.25);
      for (let k = 0; k < 12; k++) {
        this.chromaSmooth[k] += (c[k] - this.chromaSmooth[k]) * a;
      }
    }

    // Yedek yol: tayf tepelerinden kroma (zaman sinyali olmadığında)
    _chromaFromSpectrum(spec) {
      const c = this.chroma;
      c.fill(0);
      if (!spec || !spec.length) return;
      const n = spec.length;
      const i0 = Math.max(2, Math.floor(130 / this.binHz));
      const i1 = Math.min(n - 2, Math.ceil(5000 / this.binHz));
      let total = 0;
      for (let i = i0; i <= i1; i++) {
        const m = spec[i];
        if (m < 1e-5) continue;
        if (!(m >= spec[i - 1] && m >= spec[i + 1])) continue;
        const a = Math.log(spec[i - 1] + 1e-12);
        const b = Math.log(m + 1e-12);
        const cc = Math.log(spec[i + 1] + 1e-12);
        const den = a - 2 * b + cc;
        const delta = Math.abs(den) > 1e-12 ? (0.5 * (a - cc)) / den : 0;
        const hz = (i + Math.max(-0.5, Math.min(0.5, delta))) * this.binHz;
        if (hz < 27.5) continue;
        const midi = 69 + 12 * Math.log2(hz / 440);
        let pc = Math.round(midi) % 12;
        if (pc < 0) pc += 12;
        const w = m * m + spec[i - 1] * spec[i - 1] + spec[i + 1] * spec[i + 1];
        c[pc] += w;
        total += w;
      }
      const minChromaEnergy = (this.humGuard !== false) ? 1e-4 : 1e-12;
      if (total > minChromaEnergy) for (let k = 0; k < 12; k++) c[k] /= total;
    }

    // --------------------------------------------------------------- akor
    _chord() {
      const c = this.chromaSmooth;
      let sum = 0;
      for (let k = 0; k < 12; k++) sum += c[k];
      if (sum < 1e-6) {
        this.chord = { root: -1, quality: 'maj', name: '—', confidence: 0 };
        return;
      }
      const tpl = new Float32Array(12);
      let best = -1;
      let bestRoot = 0;
      let bestDef = CHORDS[0];
      for (let root = 0; root < 12; root++) {
        for (const def of CHORDS) {
          tpl.fill(0);
          for (const iv of def.notes) tpl[(root + iv) % 12] = 1;
          const s = cosine(c, tpl);
          if (s > best) { best = s; bestRoot = root; bestDef = def; }
        }
      }
      this.chord = {
        root: bestRoot,
        quality: bestDef.id,
        name: NOTE_NAMES[bestRoot] + bestDef.label,
        confidence: clamp01(best),
      };
    }

    // ----------------------------------------------------------- tonalite
    _key(dt) {
      // Tonalite yavaş değişir; uzun pencerede biriktirilmiş kroma kullanılır
      const a = alphaFor(dt, 4);
      for (let k = 0; k < 12; k++) {
        this._keyAcc[k] += (this.chroma[k] - this._keyAcc[k]) * a;
      }
      let sum = 0;
      for (let k = 0; k < 12; k++) sum += this._keyAcc[k];
      if (sum < 1e-6) return;

      const rot = new Float32Array(12);
      let best = -2;
      let bestTonic = 0;
      let bestMode = 'major';
      for (let t = 0; t < 12; t++) {
        for (let k = 0; k < 12; k++) rot[k] = this._keyAcc[(t + k) % 12];
        const cMaj = correlate(rot, KEY_MAJOR);
        if (cMaj > best) { best = cMaj; bestTonic = t; bestMode = 'major'; }
        const cMin = correlate(rot, KEY_MINOR);
        if (cMin > best) { best = cMin; bestTonic = t; bestMode = 'minor'; }
      }
      this.key = {
        tonic: bestTonic,
        mode: bestMode,
        name: NOTE_NAMES[bestTonic] + (bestMode === 'minor' ? 'm' : ''),
        confidence: clamp01((best + 1) / 2),
      };
    }

    // ------------------------------------------- armonik / vurmalı ayrışma
    /* Standart yöntem: armonik bileşenler tayfta ZAMAN ekseninde sürekli,
       vurmalı bileşenler FREKANS ekseninde geniş. Zaman boyunca medyan
       armoniği, frekans boyunca medyan vurmalıyı öne çıkarır; ikisinin oranı
       yumuşak maske olarak kullanılır. */
    _hpss(spec) {
      const n = spec.length;
      if (!this._hist.length || this._hist[0].length !== n) {
        this._hist = [];
        for (let i = 0; i < this.histSize; i++) this._hist.push(new Float32Array(n));
        this._histPos = 0;
        this._percBuf = new Float32Array(n);
        this._timeCol = new Float32Array(this.histSize);
        this._timeOut = new Float32Array(this.histSize);
      }
      this._hist[this._histPos].set(spec);
      this._histPos = (this._histPos + 1) % this.histSize;

      // Frekans ekseninde medyan -> vurmalı vurgusu
      median(spec, this._percBuf, 8);

      // Zaman ekseninde medyan -> armonik vurgusu
      let hSum = 0;
      let pSum = 0;
      const mid = (this.histSize - 1) >> 1;
      for (let i = 1; i < n; i++) {
        for (let k = 0; k < this.histSize; k++) this._timeCol[k] = this._hist[k][i];
        // küçük dizi: ekleme sıralaması
        for (let x = 1; x < this.histSize; x++) {
          const v = this._timeCol[x];
          let y = x - 1;
          while (y >= 0 && this._timeCol[y] > v) { this._timeCol[y + 1] = this._timeCol[y]; y--; }
          this._timeCol[y + 1] = v;
        }
        const h = this._timeCol[mid];
        const p = this._percBuf[i];
        hSum += h * h;
        pSum += p * p;
      }
      const tot = hSum + pSum;
      this.harmonic = tot > 1e-12 ? clamp01(hSum / tot) : 0;
      this.percussive = tot > 1e-12 ? clamp01(pSum / tot) : 0;
    }

    // ------------------------------------------------------------- gürlük
    _levels(time, dt, spec) {
      let rms = 0;
      let peak = 0;

      if (this.humGuard !== false) {
        // Akıllı filtre modu (Varsayılan): DC sıfırlama + şebeke uğultusu ve dip gürültüsünü filtreleme
        if (time && time.length) {
          let sum = 0;
          for (let i = 0; i < time.length; i++) sum += time[i];
          const mean = sum / time.length;
          let varSum = 0;
          for (let i = 0; i < time.length; i++) {
            const s = time[i] - mean;
            varSum += s * s;
            const a = Math.abs(s);
            if (a > peak) peak = a;
          }
          rms = Math.sqrt(varSum / time.length);
        }
        this.peak = clamp01(peak);
        // Anlık (400 ms) ve kısa vadeli (3 s) gürlük
        this._loudFast += (rms - this._loudFast) * alphaFor(dt, 0.4);
        this._loudSlow += (rms - this._loudSlow) * alphaFor(dt, 3);
        this.loudness = clamp01(this._loudFast * 2.5);
        this.dynamics = this._loudFast > 1e-5 ? clamp01(peak / (this._loudFast * 6)) : 0;

        let specMax = 0;
        let specMaxMid = 0;
        // 115 Hz üstü (müzikal frekanslar — 50/60 Hz şebeke uğultusunun ve DC sızıntısının ötesi)
        const binCutoff = Math.max(1, Math.ceil(115 / this.binHz));
        if (spec && spec.length) {
          for (let i = 0; i < spec.length; i++) {
            const v = spec[i];
            if (v > specMax) specMax = v;
            if (i >= binCutoff && v > specMaxMid) specMaxMid = v;
          }
        }

        const isMainsHumOrIdleNoise = (rms < 0.02 && peak < 0.045 && specMaxMid < 0.04);
        const isPureSilence = (rms < 0.004 && peak < 0.012);
        const isSpecSilence = (specMax < 0.015 && rms < 0.015);
        this.silent = (!time || !time.length) ? (specMax < 0.015) : (isPureSilence || isMainsHumOrIdleNoise || isSpecSilence);
        this.humDetected = isMainsHumOrIdleNoise;
      } else {
        // Ham / Filtresiz mod (Temiz stüdyo donanımı için - Orijinal mantık):
        // DC çıkarma yok, ham RMS ve tepe hesaplanır. Uğultu varsa görünür ve tespit edilir.
        if (time && time.length) {
          for (let i = 0; i < time.length; i++) {
            const s = time[i];
            rms += s * s;
            const a = Math.abs(s);
            if (a > peak) peak = a;
          }
          rms = Math.sqrt(rms / time.length);
        }
        this.peak = clamp01(peak);
        // Anlık (400 ms) ve kısa vadeli (3 s) gürlük
        this._loudFast += (rms - this._loudFast) * alphaFor(dt, 0.4);
        this._loudSlow += (rms - this._loudSlow) * alphaFor(dt, 3);
        this.loudness = clamp01(this._loudFast * 2.5);
        this.dynamics = this._loudFast > 1e-5 ? clamp01(peak / (this._loudFast * 6)) : 0;

        // Orijinal eşik: -60 dBFS altı
        this.silent = rms < 0.001 && peak < 0.004;
        // Donanım dip gürültüsü/şebeke uğultusu algılama (uyarı bandını tetikler)
        this.humDetected = !this.silent && (rms < 0.025 && peak < 0.05);
      }
    }

    // ------------------------------------------------------ temel frekans
    /* Otokorelasyon + parabolik tepe düzeltmesi. Tek sesli kaynakta
       güvenilir; çok sesli malzemede düşük güven değeri döndürür. */
    _pitchTrack(time) {
      if (!time || time.length < 512) return;
      // İlk karede de koşsun: _frames 1'den başlıyor
      if (((this._frames - 1) % this.pitchEvery) !== 0) return;
      const n = Math.min(1536, time.length);
      const minHz = 55;
      const maxHz = 1200;
      const maxTau = Math.min(n >> 1, Math.floor(this.sampleRate / minHz));
      const minTau = Math.max(2, Math.floor(this.sampleRate / maxHz));

      let energy = 0;
      for (let i = 0; i < n; i++) energy += time[i] * time[i];
      const minEnergy = (this.humGuard !== false) ? 0.1 : 1e-6;
      if (this.silent || energy < minEnergy || maxTau <= minTau) {
        this.pitch = { hz: 0, note: '—', midi: 0, cents: 0, confidence: 0 };
        return;
      }

      /* YIN (de Cheveigné & Kawahara).

         Fark fonksiyonu d(τ) = Σ (x[i] - x[i+τ])² periyotta sıfıra iner, ama
         τ arttıkça da küçülür; bu yüzden ham en küçük değeri almak katlarına
         (oktav altına) kayar. Kümülatif ortalamayla normalleştirmek bunu
         düzeltir: d'(τ) = d(τ) / ((1/τ)Σd(j)). Eşiğin altına DÜŞEN İLK
         vadinin seçilmesi, temel frekansın katları yerine kendisini verir. */
      if (!this._yin || this._yin.length !== maxTau + 1) {
        this._yin = new Float32Array(maxTau + 1);
      }
      const d = this._yin;
      d[0] = 1;
      let running = 0;
      for (let tau = 1; tau <= maxTau; tau++) {
        let sum = 0;
        const lim = n - tau;
        for (let i = 0; i < lim; i++) {
          const diff = time[i] - time[i + tau];
          sum += diff * diff;
        }
        running += sum;
        d[tau] = running > 1e-12 ? (sum * tau) / running : 1;
      }

      const THRESHOLD = 0.15;
      let best = -1;
      for (let tau = minTau; tau <= maxTau; tau++) {
        if (d[tau] < THRESHOLD) {
          // Vadinin dibine kadar in (yerel en küçük)
          while (tau + 1 <= maxTau && d[tau + 1] < d[tau]) tau++;
          best = tau;
          break;
        }
      }
      if (best < 0) {
        // Eşiğin altına inen yoksa genel en küçüğü al
        let lo = Infinity;
        for (let tau = minTau; tau <= maxTau; tau++) {
          if (d[tau] < lo) { lo = d[tau]; best = tau; }
        }
      }
      if (best < 0) {
        this.pitch = { hz: 0, note: '—', midi: 0, cents: 0, confidence: 0 };
        return;
      }

      // Parabolik düzeltme: kesirli gecikme, yarım tonun altında hata verir
      const y0 = d[Math.max(minTau, best - 1)];
      const y1 = d[best];
      const y2 = d[Math.min(maxTau, best + 1)];
      const den = y0 - 2 * y1 + y2;
      const shift = Math.abs(den) > 1e-12 ? (0.5 * (y0 - y2)) / den : 0;
      const tau = best + Math.max(-1, Math.min(1, shift));
      const hz = this.sampleRate / tau;
      if (!(hz > 0) || !isFinite(hz)) {
        this.pitch = { hz: 0, note: '—', midi: 0, cents: 0, confidence: 0 };
        return;
      }

      const conf = clamp01(1 - d[best]);
      const midi = 69 + 12 * Math.log2(hz / 440);
      const nearest = Math.round(midi);
      let pc = nearest % 12;
      if (pc < 0) pc += 12;
      this.pitch = {
        hz,
        midi: nearest,
        note: NOTE_NAMES[pc] + (Math.floor(nearest / 12) - 1),
        cents: Math.round((midi - nearest) * 100),
        confidence: conf,
      };
    }
    // ---------------------------------------------------- davul algılayıcı
    _drums(spec, dt) {
      this._ensureOnsets();
      // Bant sınırları enstrümanların tipik enerji bölgeleri
      this.bands.kick = this.bandEnergy(spec, 30, 130);
      this.bands.snare = this.bandEnergy(spec, 180, 900);
      this.bands.hat = this.bandEnergy(spec, 6000, 14000);
      if (!this._onsets) { this.hits = { kick: 0, snare: 0, hat: 0 }; return; }
      this.hits = {
        kick: this._onsets.kick.push(this.bands.kick, dt),
        snare: this._onsets.snare.push(this.bands.snare, dt),
        hat: this._onsets.hat.push(this.bands.hat, dt),
      };
    }

    // -------------------------------------------------------------- stereo
    _stereo(st) {
      const l = st.left;
      const r = st.right;
      if (!l || !r || !l.length || l.length !== r.length) return;
      let sl = 0;
      let sr = 0;
      let slr = 0;
      let side = 0;
      let mid = 0;
      for (let i = 0; i < l.length; i++) {
        sl += l[i] * l[i];
        sr += r[i] * r[i];
        slr += l[i] * r[i];
        const m = (l[i] + r[i]) * 0.5;
        const s = (l[i] - r[i]) * 0.5;
        mid += m * m;
        side += s * s;
      }
      const den = Math.sqrt(sl * sr);
      this.correlation = den > 1e-12 ? clamp(slr / den, -1, 1) : 1;
      const tot = mid + side;
      this.width = tot > 1e-12 ? clamp01(side / tot * 2) : 0;
    }

    /* LUFS ölçerini besle. Analiz tamponu her karede son fftSize örneği
       taşır ve ardışık kareler örtüşür; aynı örneği iki kez saymamak için
       yalnız son dt × örnekleme hızı kadarı (yeni gelen kısım) işlenir. */
    _lufs(time, dt, stereo) {
      if (!(this._loudnessDemand > 0)) return;
      this._loudnessDemand = Math.max(0, this._loudnessDemand - dt);
      const L = stereo && stereo.left && stereo.left.length ? stereo.left : time;
      if (!L || !L.length) return;
      const R = stereo && stereo.right && stereo.right.length === L.length ? stereo.right : null;
      const n = Math.min(L.length, Math.max(0, Math.round(dt * this.loudnessMeter.sampleRate)));
      if (!n) return;
      this.loudnessMeter.push(L, R, L.length - n, L.length);
    }

    /* Okuyucu talebini kısa süre canlı tut: panel 100 ms'de, modülasyon her
       karede yeniler. Ayrılan panel ya da silinen yönlendirme zamanlayıcı
       gerektirmeden en geç 250 ms sonra ölçümü durdurur. Çocuk çizelge
       modülatörlerinden biri talep ettiğinde diğerleri bunu iptal etmez. */
    requestLoudness(sampleRate) {
      this._loudnessDemand = 0.25;
      const rate = Number.isFinite(sampleRate) && sampleRate >= 8000 ? sampleRate : this.sampleRate;
      if (!this.loudnessMeter || this.loudnessMeter.sampleRate !== rate) {
        this.loudnessMeter = new LoudnessMeter({ sampleRate: rate });
      }
      return this.loudnessMeter;
    }

    // Entegre ölçümü sıfırla (panelin Sıfırla düğmesi)
    resetLoudness() {
      if (this.loudnessMeter) this.loudnessMeter.reset();
    }

    /* Modülasyon matrisine açılan kaynaklar. Hepsi 0..1 (korelasyon -1..1
       olduğu için taşınır). */
    sources() {
      return {
        anCentroid: this.centroid,
        anRolloff: this.rolloff,
        anFlatness: this.flatness,
        anCrest: this.crest,
        anFlux: this.flux,
        anSpread: this.spread,
        anLoudness: this.loudness,
        anLufs: this.loudnessMeter ? lufsUnit(this.loudnessMeter.momentary) : 0,
        anPeak: this.peak,
        anDynamics: this.dynamics,
        anHarmonic: this.harmonic,
        anPercussive: this.percussive,
        anWidth: this.width,
        anCorrelation: this.correlation * 0.5 + 0.5,
        anPitch: this.pitch.hz > 0 ? clamp01(Math.log2(this.pitch.hz / 55) / 5) : 0,
        anKeyConf: this.key.confidence,
        anChordConf: this.chord.confidence,
        anKick: this.bands.kick,
        anSnare: this.bands.snare,
        anHat: this.bands.hat,
      };
    }
  }

  /* ÇIKIŞ PENCERESİNDE ÇÖZÜMLEMEYİ KİM OKUYOR (#908). Pencerenin JS yükünün
     yarısı (ölçüldü: boş sahnede 66 ms/sn'nin 30'u, çekirdeğin %4'ü) çoğu kurulumda
     kimsenin okumadığı kroma ve armonik ayrışma. Yalnız şu üçü okuyor: OSC
     çıkışı, çözümleme kaynağına bağlı modülasyon yönlendirmesi, iki görselleştirici
     modu. Panelin motoru ayrı ve hep açık (çözümleme paneli, MCP). */
  const READING_MODES = new Set(['goniometer', 'chromawheel']);
  const READING_SOURCE = /"(an[A-Z]\w*|chroma\d+|kickTrig|snareTrig|hatTrig)"/;
  function neededBy(cfg) {
    const c = cfg || {};
    if (c.timelineComposition && c.timelineComposition.units.some((u) => neededBy(u.cfg))) return true;
    if (c.oscOut && c.oscOut.enabled === true && c.oscOut.analysis !== false) return true;
    if (c.visualizer && READING_MODES.has(c.visualizer.type)) return true;
    if (Array.isArray(c.layers) && c.layers.some((l) => l && READING_MODES.has(l.type))) return true;
    return !!c.modulation && READING_SOURCE.test(JSON.stringify(c.modulation));
  }

  const api = {
    Analyser, NOTE_NAMES, CHORDS, KEY_MAJOR, KEY_MINOR,
    correlate, cosine, median, alphaFor, neededBy,
    LoudnessMeter, kWeighting, energyToLufs, lufsUnit,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVAnalysis = api;
})();
