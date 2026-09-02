'use strict';
/* Bar tayfı motoru — bir frekans tayfını çizilebilir bar dizisine çevirir.

   Bu modül somut bir hatadan doğdu: barlar düşük frekanslarda birlikte
   hareket ediyordu. Sebebi, her bara tamsayı bir FFT kutusu aralığı
   verilmesiydi. 2048 FFT ve 48 kHz'de bir kutu 23.4 Hz; 30 Hz'den başlayan
   64 barlı bir dizide ilk beş bar da kutu 1'e düşüyor ve BİREBİR aynı sayıyı
   okuyordu. Benzer değil, aynı.

   Çözüm iki parçalı:

     1. Bandı bir kutudan geniş olan barlar eskisi gibi kutuları toplar.
     2. Bandı bir kutudan DAR olan barlar için tayf, o barın merkez
        frekansında Goertzel ile doğrudan hesaplanır. Bu, DFT'nin kesirli
        kutudaki gerçek değeridir; komşu büyüklükleri harmanlamaktan farklı
        olarak tarak (scalloping) kaybı yoktur ve her bar kendi ölçümünü alır.

   Dürüst sınır: Goertzel çözünürlüğü ARTIRMAZ. 2048 örneklik bir pencereyle
   30 Hz ile 33 Hz fiziksel olarak ayrılamaz; iki bar ilişkili kalır. Ama artık
   aynı sayı değildirler ve hareket sürekli olur. Gerçek bas çözünürlüğü daha
   uzun bir pencere ister ve bu, tepki gecikmesiyle takas edilir — bu yüzden
   FFT boyu bir ayardır, sabit bir tercih değil.

   Modül saf aritmetiktir: DOM, GPU ve ses aygıtı bilmez, testleri Node'da
   koşar. */
(function () {
  const REF_HZ = 1000; // eğim (tilt) bu frekansta 0 dB

  // ---------------------------------------------------------------- ölçekler
  function mel(f) { return 2595 * Math.log10(1 + f / 700); }
  function melInv(m) { return 700 * (Math.pow(10, m / 2595) - 1); }

  function bark(f) {
    return 13 * Math.atan(0.00076 * f) + 3.5 * Math.atan(Math.pow(f / 7500, 2));
  }
  /* Bark'ın kapalı biçimde tersi yok. Fonksiyon kesin artan olduğu için
     ikiye bölme yeterli ve bant kenarları yalnızca önbellek kurulurken
     hesaplandığı için maliyeti önemsiz. */
  function barkInv(z) {
    let lo = 0;
    let hi = 24000;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (bark(mid) < z) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  const SCALES = {
    log: { to: Math.log, from: Math.exp },
    linear: { to: (f) => f, from: (u) => u },
    mel: { to: mel, from: melInv },
    bark: { to: bark, from: barkInv },
  };
  const SCALE_LIST = Object.keys(SCALES);

  /* Bant kenarları: count+1 frekans. Barlar bu kenarların arasını kaplar. */
  function bandEdges(count, minFreq, maxFreq, scale) {
    const s = SCALES[scale] || SCALES.log;
    const n = Math.max(1, count | 0);
    const lo = Math.max(1, Math.min(minFreq, maxFreq));
    const hi = Math.max(lo + 1, Math.max(minFreq, maxFreq));
    const u0 = s.to(lo);
    const u1 = s.to(hi);
    const out = new Float64Array(n + 1);
    for (let i = 0; i <= n; i++) out[i] = s.from(u0 + ((u1 - u0) * i) / n);
    return out;
  }

  // ------------------------------------------------------------- örnekleme
  /* Kutular arası doğrusal örnek. Tamsayı kutuya yuvarlamaya göre iyidir ama
     yine de büyüklük harmanlamasıdır; dar bantlarda Goertzel tercih edilir. */
  function sampleBins(spec, binHz, f) {
    const n = spec.length;
    if (!n) return 0;
    const b = f / binHz;
    if (b <= 0) return spec[0];
    const i = Math.floor(b);
    if (i >= n - 1) return spec[n - 1];
    const t = b - i;
    return spec[i] * (1 - t) + spec[i + 1] * t;
  }

  /* Tek frekansta DFT büyüklüğü (Goertzel).

     Pencere, ana süreçteki FFT ile aynı olsun diye Hann; ölçek de aynı
     normalizasyonu (N/4) kullanıyor ki iki yol arasında geçen barlarda
     görünür bir basamak oluşmasın. */
  function goertzel(time, sampleRate, f, win) {
    const N = time.length;
    if (!N || f <= 0 || f >= sampleRate / 2) return 0;
    const coeff = 2 * Math.cos((2 * Math.PI * f) / sampleRate);
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < N; i++) {
      const s0 = time[i] * win[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
    return Math.sqrt(Math.max(0, power)) / (N / 4);
  }

  function hannWindow(n) {
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    return w;
  }

  // ------------------------------------------------------------ dönüşümler
  /* Doğrusal genlik yerine dB. Gerçek analizörlerin bunu kullanmasının sebebi
     görsel: doğrusal ölçekte müziğin sessiz ayrıntısı taban çizgisine yapışır,
     dB'de görünür hale gelir. */
  function toDbUnit(v, floorDb) {
    if (!(v > 0)) return 0;
    const db = 20 * Math.log10(v);
    const f = floorDb < 0 ? floorDb : -60;
    return Math.max(0, Math.min(1, 1 - db / f));
  }

  // Oktav başına dB eğimi: tiz uç kalıcı olarak ezik kalmasın
  function tiltGain(f, dbPerOctave) {
    if (!dbPerOctave) return 1;
    return Math.pow(10, (dbPerOctave * Math.log2(Math.max(1, f) / REF_HZ)) / 20);
  }

  /* Komşu yayılımı. Her bardan dışa doğru sönerek yayılan tek yönlü bir
     maksimum; tanıdık yumuşak zarfı veren şey bu. Gauss bulanıklığından
     farkı tepe yüksekliğini korumasıdır — bulanıklık tepeleri de ezerdi. */
  function spread(values, amount) {
    const k = Math.max(0, Math.min(0.95, amount));
    if (!k) return values;
    const n = values.length;
    for (let i = 1; i < n; i++) {
      const v = values[i - 1] * k;
      if (v > values[i]) values[i] = v;
    }
    for (let i = n - 2; i >= 0; i--) {
      const v = values[i + 1] * k;
      if (v > values[i]) values[i] = v;
    }
    return values;
  }

  /* Balistik: ayrı atak ve bırakma zaman sabitleri.

     Tek bir yumuşatma katsayısı yükselişi de düşüşü de aynı hızda yapar ve
     vuruşları körelttir. Ayrı sabitlerle barlar hızlı fırlayıp yavaş iner —
     hem daha doğru hem de bakması daha hoş. Katsayılar dt'den türetiliyor,
     böylece kare hızı değişince davranış değişmez. */
  function ballistic(prev, target, dt, attackSec, releaseSec) {
    const tau = target > prev ? attackSec : releaseSec;
    if (!(tau > 0)) return target;
    const a = 1 - Math.exp(-Math.max(0, dt) / tau);
    return prev + (target - prev) * a;
  }

  // ------------------------------------------------------------------ motor
  class BarEngine {
    constructor() {
      this._key = '';
      this._edges = null;
      this._centres = null;
      this._ranges = null;
      this._narrow = null; // banttan dar olan barlar Goertzel ile ölçülür
      this._out = null;
      this._state = null;
      this._win = null;
      this._winN = 0;
    }

    _ensure(o) {
      const key = [o.count, o.minFreq, o.maxFreq, o.scale, o.binHz, o.specLen].join(':');
      if (key === this._key) return;
      this._key = key;

      const n = o.count;
      const edges = bandEdges(n, o.minFreq, o.maxFreq, o.scale);
      const centres = new Float64Array(n);
      const ranges = new Int32Array(n * 2);
      const narrow = new Uint8Array(n);
      const linear = o.scale === 'linear';

      for (let b = 0; b < n; b++) {
        const f0 = edges[b];
        const f1 = edges[b + 1];
        centres[b] = linear ? (f0 + f1) / 2 : Math.sqrt(f0 * f1);
        let i0 = Math.floor(f0 / o.binHz);
        let i1 = Math.ceil(f1 / o.binHz) - 1;
        i0 = Math.max(0, Math.min(i0, o.specLen - 1));
        i1 = Math.max(i0, Math.min(i1, o.specLen - 1));
        ranges[b * 2] = i0;
        ranges[b * 2 + 1] = i1;
        // Bant bir kutudan darsa kutu toplamak bilgi üretmez, tekrar üretir
        narrow[b] = (f1 - f0) / o.binHz < 1 ? 1 : 0;
      }

      this._edges = edges;
      this._centres = centres;
      this._ranges = ranges;
      this._narrow = narrow;
      if (!this._out || this._out.length !== n) {
        this._out = new Float32Array(n);
        this._state = new Float32Array(n);
      }
    }

    /* src: { spec, binHz, time, sampleRate }
       opt: { count, minFreq, maxFreq, scale, amplitude, floorDb, tilt,
              attack, release, spread, gain, dt } */
    compute(src, opt) {
      const o = normalise(opt);
      const spec = src.spec;
      const binHz = src.binHz || 1;
      this._ensure({
        count: o.count, minFreq: o.minFreq, maxFreq: o.maxFreq,
        scale: o.scale, binHz, specLen: spec.length,
      });

      const time = o.exact ? src.time : null;
      if (time && this._winN !== time.length) {
        this._win = hannWindow(time.length);
        this._winN = time.length;
      }

      const out = this._out;
      const n = o.count;
      for (let b = 0; b < n; b++) {
        const fc = this._centres[b];
        let v;
        if (this._narrow[b] && time) {
          // Dar bant: kesirli kutuda gerçek DFT değeri
          v = goertzel(time, src.sampleRate || 48000, fc, this._win);
        } else if (this._narrow[b]) {
          v = sampleBins(spec, binHz, fc);
        } else {
          // Geniş bant: tepe ve ortalama karışımı — tepe atakları korur,
          // ortalama gürültüyü bastırır
          const i0 = this._ranges[b * 2];
          const i1 = this._ranges[b * 2 + 1];
          let max = 0;
          let sum = 0;
          for (let i = i0; i <= i1; i++) {
            const x = spec[i];
            if (x > max) max = x;
            sum += x;
          }
          v = max * 0.6 + (sum / (i1 - i0 + 1)) * 0.4;
        }

        v *= o.gain * tiltGain(fc, o.tilt);
        v = o.amplitude === 'db' ? toDbUnit(v, o.floorDb) : Math.min(1, v);
        out[b] = v > 0 ? v : 0;
      }

      if (o.spread) spread(out, o.spread);

      const dt = o.dt > 0 ? o.dt : 1 / 60;
      const st = this._state;
      for (let b = 0; b < n; b++) {
        st[b] = ballistic(st[b], out[b], dt, o.attack, o.release);
        out[b] = Math.min(1, st[b]);
      }
      return out;
    }
  }

  const DEFAULTS = {
    count: 64,
    minFreq: 30,
    maxFreq: 14000,
    scale: 'log',
    amplitude: 'linear',
    floorDb: -60,
    tilt: 0,
    attack: 0.02,
    release: 0.16,
    spread: 0,
    gain: 1,
    exact: true,
    dt: 1 / 60,
  };

  function normalise(opt) {
    const o = Object.assign({}, DEFAULTS, opt || {});
    o.count = Math.max(1, o.count | 0);
    if (!SCALES[o.scale]) o.scale = 'log';
    if (o.amplitude !== 'db') o.amplitude = 'linear';
    o.attack = Math.max(0, Number(o.attack) || 0);
    o.release = Math.max(0, Number(o.release) || 0);
    o.spread = Math.max(0, Math.min(0.95, Number(o.spread) || 0));
    o.gain = Number(o.gain) > 0 ? Number(o.gain) : 1;
    o.tilt = Number(o.tilt) || 0;
    o.floorDb = Number(o.floorDb) < 0 ? Number(o.floorDb) : -60;
    return o;
  }

  const api = {
    SCALES: SCALE_LIST, DEFAULTS,
    bandEdges, sampleBins, goertzel, hannWindow,
    toDbUnit, tiltGain, spread, ballistic, normalise,
    BarEngine,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVSpectrum = api;
})();
