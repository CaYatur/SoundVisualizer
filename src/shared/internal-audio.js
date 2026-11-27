/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* UYGULAMANIN KENDİ SESİ (#1213) — saf kurallar.

   Zaman çizelgesi sesi yönetim panelinde çalar. Görselleştirici onu artık
   sistem yakalamasından (loopback) GERİ DİNLEMİYOR: panel ses grafiğinden
   örnekleri alıp yakalama yardımcısıyla AYNI biçimde kare üretir, ana süreç
   bu kareyi seçili kaynağın karesiyle karıştırır.

   Burada üç şey var, üçü de testte GPU'suz/aygıtsız koşsun diye saf:
     buildFrame        örneklerden kare (loopback-helper.js ile aynı pencere,
                       FFT ve dB ölçeği: barlar iki yoldan aynı görünsün)
     mixFrames         iki kareyi karıştırır (zaman toplamı, güç toplamı)
     createInternalFeed / captureCarriesSelf / planSelfExclusion
                       hangi karenin ne zaman karışacağı, kendi sesimizin
                       yakalamaya girip girmediği
     decaySilence      kare gelmeyince donmak yerine sessizliğe süzülme */
(function () {
  const FFT_SIZE = 2048;
  const BINS = FFT_SIZE / 2;
  // loopback-helper.js MIN_DB/MAX_DB ile aynı
  const MIN_DB = -90;
  const MAX_DB = -18;
  // Panel karesi bu süreden eskiyse "çalmıyor" sayılır
  const FRESH_MS = 150;
  // Yakalama karesi bu süre içinde geldiyse panel karesi ayrıca yollanmaz
  const EXTERNAL_MS = 120;
  // Görselleştirici: bu süre kare gelmezse sessizliğe süzülmeye başlar
  const STALE_MS = 250;
  // Sessizliğe süzülmenin zaman sabiti (sn): ~0,5 sn'de tamamen iner
  const DECAY_TAU = 0.12;

  const hann = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));

  function fft(re, im) {
    const n = re.length;
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

  const toByte = (s) => {
    const v = s < -1 ? -1 : s > 1 ? 1 : (s || 0);
    return (128 + v * 127) | 0;
  };

  /* Sol/sağ -1..1 örneklerden (en yeni örnek sonda) kare. Tek kanal
     verilirse ikisi aynı dizi. Çıktı yardımcının karesiyle aynı biçimde. */
  function createFrameBuilder() {
    const re = new Float64Array(FFT_SIZE);
    const im = new Float64Array(FFT_SIZE);
    return function buildFrame(left, right, sampleRate) {
      const L = left;
      const R = right || left;
      const n = FFT_SIZE;
      const off = Math.max(0, (L ? L.length : 0) - n);
      const freq = new Uint8Array(BINS);
      const time = new Uint8Array(n).fill(128);
      const lb = new Uint8Array(n).fill(128);
      const rb = new Uint8Array(n).fill(128);
      for (let i = 0; i < n; i++) {
        const l = L && i + off < L.length ? L[i + off] : 0;
        const r = R && i + off < R.length ? R[i + off] : 0;
        const m = (l + r) * 0.5;
        re[i] = m * hann[i];
        im[i] = 0;
        time[i] = toByte(m);
        lb[i] = toByte(l);
        rb[i] = toByte(r);
      }
      fft(re, im);
      const range = MAX_DB - MIN_DB;
      for (let i = 0; i < BINS; i++) {
        const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / (n / 4);
        let v = (20 * Math.log10(mag + 1e-9) - MIN_DB) / range;
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        freq[i] = (v * 255) | 0;
      }
      return { freq, time, left: lb, right: rb, sampleRate: sampleRate > 0 ? sampleRate : 48000, internal: true };
    };
  }

  /* İki kareyi karıştırır. Zaman alanı toplanır (128 merkez, kırpılır).
     Tayf güçte toplanır: iki bağımsız kaynağın gücü toplanır, dB'de
     toplamak (ya da baytların en büyüğünü almak) yanlış seviye verirdi.
     Örnekleme hızı ilk karenin; ikinci farklıysa kutular hafif kayar ama
     ikisi de 44,1/48 kHz civarında, görüntüde fark edilmez. */
  function mixFrames(a, b) {
    if (!a || !a.freq) return b || null;
    if (!b || !b.freq) return a;
    const range = MAX_DB - MIN_DB;
    const freq = new Uint8Array(BINS);
    for (let i = 0; i < BINS; i++) {
      // 0 baytı "taban altı": güç yok sayılır, yoksa sessiz taraf -90 dB
      // ekleyip öbürünü kaldırırdı
      const xa = a.freq[i] || 0, xb = b.freq[i] || 0;
      const p = (xa ? Math.pow(10, (MIN_DB + (xa / 255) * range) / 10) : 0)
        + (xb ? Math.pow(10, (MIN_DB + (xb / 255) * range) / 10) : 0);
      if (!p) { freq[i] = 0; continue; }
      let v = (10 * Math.log10(p) - MIN_DB) / range;
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      freq[i] = Math.round(v * 255);
    }
    const sum = (x, y) => {
      const out = new Uint8Array(FFT_SIZE);
      for (let i = 0; i < FFT_SIZE; i++) {
        const s = ((x ? x[i] : 128) - 128) + ((y ? y[i] : 128) - 128) + 128;
        out[i] = s < 0 ? 0 : s > 255 ? 255 : s;
      }
      return out;
    };
    return {
      freq,
      time: sum(a.time, b.time),
      left: sum(a.left || a.time, b.left || b.time),
      right: sum(a.right || a.time, b.right || b.time),
      sampleRate: a.sampleRate || b.sampleRate,
    };
  }

  /* Seçili yakalama kendi çıkışımızı zaten taşıyor mu? Varsayılan sistem
     çıkışının loopback'i ('default') ve zaman çizelgesi de varsayılan
     aygıtta çalıyorsa evet: o durumda panel karesi KARIŞTIRILMAZ, yoksa aynı
     ses iki kez sayılırdı. Kendi sürecimizi hariç tutan yakalama
     (planSelfExclusion) uygulandıysa hayır. Adıyla seçilmiş bir aygıt
     (mikrofon da olabilir) kendi sesimizi taşımaz sayılır. */
  function captureCarriesSelf(o) {
    const opt = o || {};
    if (opt.selfExcluded) return false;
    if (opt.sinkDefault === false) return false;
    const list = Array.isArray(opt.sources) ? opt.sources : [];
    return list.indexOf('default') >= 0;
  }

  /* Varsayılan sistem çıkışını KENDİ SÜRECİMİZ HARİÇ yakalama planı.
     Windows'ta süreç loopback'inin hariç tutma kipi (yapı 20348+) aynı
     karışımı verir ama bizim sesimiz olmadan. Yalnız gösteride zaman
     çizelgesi sesi varken uygulanır: kaynak listesi gösteri sırasında
     değişmesin (çalmaya başlarken yakalamayı yeniden kurmak boşluk
     yapardı). macOS'ta 'default' sanal bir giriş aygıtı, Linux'ta
     monitör kaynağı; orada aynı anlamı veren bir hariç tutma yok, kural
     captureCarriesSelf ile çift sayımı önler. */
  function planSelfExclusion(sources, o) {
    const opt = o || {};
    const list = Array.isArray(sources) ? sources.slice() : [];
    const no = { sources: list, applied: false };
    if (opt.enabled === false || !opt.hasTimelineAudio) return no;
    if (opt.platform !== 'win32' || !opt.available || !opt.helper) return no;
    if (!(opt.selfPid > 0) || !opt.selfMatch) return no;
    const at = list.indexOf('default');
    if (at < 0) return no;
    // İşletim sistemi tek hariç tutma akışı veriyor (app-audio.limitExclude)
    if (list.some((s) => s && typeof s === 'object' && s.kind === 'app' && s.mode === 'exclude')) return no;
    list[at] = {
      kind: 'app', mode: 'exclude', self: true,
      match: String(opt.selfMatch), pid: opt.selfPid,
      label: String(opt.label || 'System audio (without this app)'),
    };
    return { sources: list, applied: true };
  }

  // Ayar audio.excludeSelf (varsayılan açık)
  function selfExclusionEnabled(cfg) {
    const a = cfg && cfg.audio;
    return !(a && a.excludeSelf === false);
  }

  function hasTimelineAudio(cfg) {
    const t = cfg && cfg.timeline;
    const list = t && Array.isArray(t.audioTracks) ? t.audioTracks : [];
    return list.some((tr) => tr && Array.isArray(tr.clips) && tr.clips.length > 0);
  }

  /* Ana süreçteki karar: panel karesi ne zaman karışır, ne zaman tek başına
     gider. Saat dışarıdan verilir (test). */
  function createInternalFeed(opts) {
    const freshMs = (opts && opts.freshMs) || FRESH_MS;
    const externalMs = (opts && opts.externalMs) || EXTERNAL_MS;
    let frame = null;
    let at = 0;
    let sinkDefault = true;
    let extAt = 0;
    return {
      push(f, now, sink) {
        frame = f && f.freq ? f : null;
        at = frame ? now : 0;
        sinkDefault = !sink;
      },
      clear() { frame = null; at = 0; },
      active(now) { return !!frame && now - at <= freshMs; },
      sinkDefault() { return sinkDefault; },
      noteExternal(now) { extAt = now; },
      externalFlowing(now) { return extAt > 0 && now - extAt <= externalMs; },
      /* Dış kaynaktan (yakalama, köprü, demo) gelen kare. carriesSelf:
         seçili yakalama kendi sesimizi zaten taşıyor (bkz. captureCarriesSelf). */
      combine(ext, now, carriesSelf) {
        if (!this.active(now) || carriesSelf) return ext;
        return mixFrames(ext, frame);
      },
      /* Panel karesi geldi: dış kaynak akıyorsa onun karesine karışacak,
         akmıyorsa (kaynak yok, durmuş) tek başına gönderilmeli. */
      deliverAlone(now) { return !!frame && !this.externalFlowing(now); },
      current() { return frame; },
    };
  }

  /* Görselleştiricinin elindeki son kareyi sessizliğe doğru süzer (donma
     yerine). Tayf baytı dB ölçekli: 0'a doğru üstel iniş dB'de yumuşak bir
     sönüm. Zaman baytları 128'e (sıfır sinyal) iner. Hepsi indiyse true. */
  function decaySilence(arrays, dt) {
    const k = Math.exp(-Math.max(0, dt || 0) / DECAY_TAU);
    let done = true;
    const f = arrays && arrays.freq;
    if (f) {
      for (let i = 0; i < f.length; i++) {
        const v = Math.floor(f[i] * k);
        f[i] = v;
        if (v) done = false;
      }
    }
    for (const key of ['time', 'left', 'right']) {
      const t = arrays && arrays[key];
      if (!t) continue;
      for (let i = 0; i < t.length; i++) {
        const d = t[i] - 128;
        if (!d) continue;
        const nd = Math.trunc(d * k);
        t[i] = 128 + nd;
        if (nd) done = false;
      }
    }
    return done;
  }

  const api = {
    FFT_SIZE, BINS, MIN_DB, MAX_DB, FRESH_MS, EXTERNAL_MS, STALE_MS, DECAY_TAU,
    createFrameBuilder, mixFrames, captureCarriesSelf, planSelfExclusion,
    hasTimelineAudio, selfExclusionEnabled, createInternalFeed, decaySilence,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVInternalAudio = api;
})();
