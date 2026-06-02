'use strict';
/* Ses analiz motoru (görselleştirici penceresinde çalışır).
   Artık ses yakalama ANA SÜREÇTE yapılır (WASAPI loopback, yalnızca çıkış aygıtı —
   mikrofon yok). Bu sınıf ana süreçten gelen FFT karelerini alır ve
   bar/bant/seviye verisi üretir. */
(function () {
  const FFT_SIZE = 2048;
  const BINS = FFT_SIZE / 2; // 1024

  class AudioEngine {
    constructor() {
      this.fftSize = FFT_SIZE;
      this.bins = BINS;
      this.freqRaw = new Uint8Array(BINS); // ana süreçten ham frekans (0..255)
      this.timeBytes = new Uint8Array(FFT_SIZE); // zaman alanı (128 merkez)
      this.freq = new Float32Array(BINS); // işlenmiş + yumuşatılmış (0..1)
      this.sampleRate = 48000;
      this.binHz = this.sampleRate / FFT_SIZE;

      this.bass = 0;
      this.mid = 0;
      this.treble = 0;
      this.level = 0;

      this.cfg = { sensitivity: 1.4, smoothing: 0.65, bassBoost: 1.0 };
      this._barsCache = {};
      this.ready = false;
      this.lastFrameTs = 0;
    }

    applyConfig(audioCfg) {
      this.cfg = Object.assign({}, this.cfg, audioCfg || {});
    }

    // Ana süreçten gelen kare
    ingestFrame(frame) {
      if (!frame || !frame.freq) return;
      this.freqRaw.set(frame.freq);
      this.timeBytes.set(frame.time);
      if (frame.sampleRate && frame.sampleRate !== this.sampleRate) {
        this.sampleRate = frame.sampleRate;
        this.binHz = this.sampleRate / FFT_SIZE;
        this._barsCache = {};
      }
      this.ready = true;
      this.lastFrameTs = performance.now();
    }

    // Her karede çağrılır
    update() {
      if (!this.ready) return;
      const sens = this.cfg.sensitivity || 1;
      const boost = this.cfg.bassBoost || 1;
      const sm = Math.max(0, Math.min(0.95, this.cfg.smoothing));
      const n = this.bins;
      const f = this.freq;

      for (let i = 0; i < n; i++) {
        let v = this.freqRaw[i] / 255;
        const lowW = 1 + (boost - 1) * Math.max(0, 1 - i / (n * 0.18));
        v = Math.min(1, v * sens * lowW);
        f[i] = sm * f[i] + (1 - sm) * v; // zaman yumuşatması
      }

      // Zaman alanından RMS seviye
      let sum = 0;
      const t = this.timeBytes;
      for (let i = 0; i < t.length; i++) {
        const s = (t[i] - 128) / 128;
        sum += s * s;
      }
      const rms = Math.sqrt(sum / t.length);
      const lvl = Math.min(1, rms * 1.8 * sens);

      const bass = this._bandAvg(20, 160);
      const mid = this._bandAvg(160, 2000);
      const treble = this._bandAvg(2000, 9000);

      this.bass = smooth(this.bass, bass, 0.5, 0.12);
      this.mid = smooth(this.mid, mid, 0.5, 0.14);
      this.treble = smooth(this.treble, treble, 0.6, 0.2);
      this.level = smooth(this.level, lvl, 0.55, 0.12);
    }

    _bandAvg(f0, f1) {
      const i0 = Math.max(0, Math.floor(f0 / this.binHz));
      const i1 = Math.min(this.freq.length - 1, Math.ceil(f1 / this.binHz));
      let s = 0;
      let c = 0;
      for (let i = i0; i <= i1; i++) {
        s += this.freq[i];
        c++;
      }
      return c ? Math.min(1, (s / c) * 1.15) : 0;
    }

    // Logaritmik bar dizisi (0..1). Her bar = bir frekans bandı.
    getBars(count, minFreq, maxFreq) {
      const key = count + ':' + minFreq + ':' + maxFreq;
      let cache = this._barsCache[key];
      if (!cache || cache.out.length !== count) {
        cache = this._buildBarMap(count, minFreq, maxFreq);
        this._barsCache[key] = cache;
      }
      const { ranges, out, smoothArr } = cache;
      for (let b = 0; b < count; b++) {
        const [i0, i1] = ranges[b];
        let max = 0;
        let s = 0;
        for (let i = i0; i <= i1; i++) {
          const v = this.freq[i];
          if (v > max) max = v;
          s += v;
        }
        const cnt = i1 - i0 + 1;
        const val = Math.min(1, max * 0.6 + (s / cnt) * 0.4);
        smoothArr[b] = smooth(smoothArr[b], val, 0.7, 0.22);
        out[b] = smoothArr[b];
      }
      return out;
    }

    _buildBarMap(count, minFreq, maxFreq) {
      const ranges = [];
      const nyq = this.sampleRate / 2;
      const lminF = Math.log(Math.max(20, minFreq));
      const lmaxF = Math.log(Math.min(maxFreq, nyq));
      for (let b = 0; b < count; b++) {
        const f0 = Math.exp(lminF + ((lmaxF - lminF) * b) / count);
        const f1 = Math.exp(lminF + ((lmaxF - lminF) * (b + 1)) / count);
        let i0 = Math.floor(f0 / this.binHz);
        let i1 = Math.max(i0, Math.floor(f1 / this.binHz) - 1);
        i0 = Math.max(0, Math.min(i0, this.freq.length - 1));
        i1 = Math.max(i0, Math.min(i1, this.freq.length - 1));
        ranges.push([i0, i1]);
      }
      return {
        ranges,
        out: new Float32Array(count),
        smoothArr: new Float32Array(count),
      };
    }
  }

  // attack/release yumuşatma: yükselişte hızlı, düşüşte yavaş
  function smooth(cur, target, attack, release) {
    const k = target > cur ? attack : release;
    return cur + (target - cur) * k;
  }

  window.SVAudio = AudioEngine;
})();
