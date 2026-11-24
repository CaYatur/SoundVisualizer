/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* SES KARESİNİN TAYFI VE ZAMAN BAYTLARI — TEK KOPYA (#1054).

   Bu hesap üç yerde aynı olmak ZORUNDA: canlı yakalama yardımcısı
   (src/main/loopback-helper.js), dışa aktarım sayfası (src/exporter/exporter.js)
   ve Android sayfası (ham sesi uygulamadan alıp kareyi kendisi kuruyor). Bir
   sahnenin canlıda, videoda ve telefonda aynı tepkiyi vermesi bu üç yerin aynı
   baytları üretmesine bağlı. Eskiden ilk ikisinde ayrı ayrı yazılmış birebir
   kopyalar vardı ("loopback-helper.js'teki radix-2 FFT (birebir)"); üçüncüsünü
   eklemek yerine hepsi buradan alıyor.

   Hesap DEĞİŞMEDİ: Hann penceresi, Float32 tamponlarda yerinde radix-2 FFT,
   genlik / (N/4), 20·log10, [-90, -18] dB aralığından 0..255'e. Eski kodla bayt
   bayt aynı olduğunu tests/audio-spectrum.test.js'teki dondurulmuş eski sürüm
   denetliyor; görselleştiricideki dB geri dönüşümü (src/visualizer/audio.js
   BYTE_DB0 / BYTE_DB_RANGE) bu sabitlere bağlı. */
(function () {
  const FFT_SIZE = 2048;
  const BINS = FFT_SIZE / 2; // 1024
  const MIN_DB = -90;
  const MAX_DB = -18;

  /* Her çağıranın kendi çalışma tamponları olsun diye fabrika: yardımcı ve
     sayfa aynı anda tek bir hesaplayıcı kullanıyor ama paylaşılan durum yok. */
  function create() {
    const hann = new Float32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
    const re = new Float32Array(FFT_SIZE);
    const im = new Float32Array(FFT_SIZE);

    function fft() {
      const n = FFT_SIZE;
      for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
          const tr = re[i]; re[i] = re[j]; re[j] = tr;
          const ti = im[i]; im[i] = im[j]; im[j] = ti;
        }
      }
      for (let len = 2; len <= n; len <<= 1) {
        const ang = (-2 * Math.PI) / len;
        const wr = Math.cos(ang), wi = Math.sin(ang);
        const half = len >> 1;
        for (let i = 0; i < n; i += len) {
          let cr = 1, ci = 0;
          for (let k = 0; k < half; k++) {
            const a = i + k, b = a + half;
            const vr = re[b] * cr - im[b] * ci;
            const vi = re[b] * ci + im[b] * cr;
            re[b] = re[a] - vr; im[b] = im[a] - vi;
            re[a] += vr; im[a] += vi;
            const ncr = cr * wr - ci * wi;
            ci = cr * wi + ci * wr;
            cr = ncr;
          }
        }
      }
    }

    /* `ring`: kronolojik 2048 örnek (-1..1, en yeni sonda). Tayf baytları
       `out[offset .. offset+1024)` aralığına yazılır; `out` Uint8Array ya da
       Node Buffer olabilir. */
    function spectrum(ring, out, offset) {
      const at = offset | 0;
      for (let i = 0; i < FFT_SIZE; i++) {
        re[i] = ring[i] * hann[i];
        im[i] = 0;
      }
      fft();
      const range = MAX_DB - MIN_DB;
      for (let i = 0; i < BINS; i++) {
        const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / (FFT_SIZE / 4);
        const db = 20 * Math.log10(mag + 1e-9);
        let v = (db - MIN_DB) / range;
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        out[at + i] = (v * 255) | 0;
      }
    }

    return { spectrum };
  }

  /* -1..1 örnekleri 128 merkezli baytlara yazar (kare yerleşimindeki zaman,
     sol ve sağ dizileri). Kırpma ve yuvarlama eski yolunki: NaN olduğu gibi
     geçer ve 0 baytına düşer. */
  function timeBytes(ring, out, offset) {
    const at = offset | 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      let s = ring[i];
      s = s < -1 ? -1 : s > 1 ? 1 : s;
      out[at + i] = (128 + s * 127) | 0;
    }
  }

  /* Bir kaynağın (aygıt ya da uygulama) halka tamponları. Kronolojik: en yeni
     örnek sonda. Mono tampon eski yolun tamponunun kendisi — aynı ortalama,
     aynı sıra — ki mono okuyan hiçbir şeyin sayısı değişmesin.

     src/main/audio-frame.js'ten taşındı (#1054): masaüstü yakalama yardımcısı
     ve Android sayfası aynı halkayı kullanıyor. pushStereoLE yalnız Node
     Buffer ile çağrılıyor (uygulama yakalamasının ham akışı). */
  class SourceRings {
    constructor() {
      this.mono = new Float32Array(FFT_SIZE);
      this.left = new Float32Array(FFT_SIZE);
      this.right = new Float32Array(FFT_SIZE);
    }

    /* Yeni örnek yeri açar ve yazmaya başlanacak indisi döndürür.

       Parça tampondan UZUNSA yalnız EN YENİ 2048 örnek alınıyor. Eski yol
       burada kaydırmayı atlıyor ve parçanın EN ESKİ 2048 örneğini yazıyordu;
       aygıt geri çağrısı 512 örnek verdiği için yalnız uygulama yakalamasında,
       boru bir an tıkanıp büyük bir parça geldiğinde görülebilirdi. */
    _shift(n) {
      if (n < FFT_SIZE) {
        this.mono.copyWithin(0, n);
        this.left.copyWithin(0, n);
        this.right.copyWithin(0, n);
      }
      return FFT_SIZE - n;
    }

    /* Araya serpiştirilmiş float32 örnekler (aygıt geri çağrısı). Tek kanallı
       bir aygıtta sol ve sağ aynı örnek: mikrofon gerçekten tek kanal. */
    pushFloat32(f, nCh) {
      const ch = Math.max(1, nCh | 0);
      const samples = (f.length / ch) | 0;
      const n = Math.min(samples, FFT_SIZE);
      const w = this._shift(n);
      const skip = samples - n;
      const M = this.mono, L = this.left, R = this.right;
      for (let i = 0; i < n; i++) {
        const idx = (skip + i) * ch;
        const l = f[idx];
        if (ch > 1) {
          const r = f[idx + 1];
          M[w + i] = (l + r) * 0.5;
          L[w + i] = l;
          R[w + i] = r;
        } else {
          M[w + i] = l;
          L[w + i] = l;
          R[w + i] = l;
        }
      }
    }

    /* Uygulama yakalamasının ham akışı: float32 stereo, küçük endian. Okuma
       readFloatLE ile — Node'un havuzdan verdiği tamponun byteOffset'i 4'ün
       katı olmak zorunda değil ve hizalanmamış bir görünüm RangeError atardı. */
    pushStereoLE(buf, frames) {
      const n = Math.min(frames, FFT_SIZE);
      const w = this._shift(n);
      const skip = frames - n;
      const M = this.mono, L = this.left, R = this.right;
      for (let i = 0; i < n; i++) {
        const off = (skip + i) * 8;
        const l = buf.readFloatLE(off);
        const r = buf.readFloatLE(off + 4);
        M[w + i] = (l + r) * 0.5;
        L[w + i] = l;
        R[w + i] = r;
      }
    }

    reset() {
      this.mono.fill(0);
      this.left.fill(0);
      this.right.fill(0);
    }
  }

  const api = { FFT_SIZE, BINS, MIN_DB, MAX_DB, create, timeBytes, SourceRings };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVAudioSpectrum = api;
})();
