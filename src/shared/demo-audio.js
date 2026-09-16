'use strict';
/* ÖRNEK SES — gerçek ses yokken görsellere verilen sentetik müzik.
 *
 * İki yer kullanıyor ve ikisinin AYNI sinyali görmesi gerekiyor:
 *   • Panel önizlemesi (src/admin/preview.js): yakalama kapalıyken ya da
 *     panele ses gelmiyorken önizleme bununla canlı kalıyor.
 *   • MilkDrop render ölçümü (scripts/milkdrop-render-rate.js): 900 presetlik
 *     ölçüm her kareye bu sesi veriyor.
 * Önizlemede görülen MilkDrop tepkisi böylece ölçülenle aynı dalga biçiminden
 * geliyor; tarif değişirse ikisi birlikte değişiyor.
 *
 * NEDEN GENİŞ BANTLI: MilkDrop'un bantları ve tayf dalgaları hazır tayfı
 * değil zaman verisini okuyor ve kendi FFT'sini hesaplıyor — en yeni 576
 * örnek; 48 kHz'de bass 0-4, mid 4-8, treb 8-12 kHz. Panelin eski demosu
 * 2048 örnekte 3, 7 ve 17 devirlik üç sinüstü (~70, ~164 ve ~398 Hz): orta
 * ve tiz bantlara yalnız 8 bitlik nicemleme gürültüsü düşüyordu.
 *
 * TARİF: 120 BPM; kick (110 Hz'den 45 Hz'e düşen sinüs), tek numaralı
 * vuruşlarda trampet (farkı bir kez alınmış gürültü), sekizlik hi-hat (farkı
 * üç kez alınmış gürültü), dört notalık bas hattı ve üç sesli ped. Örnek
 * indisine bağlı ve deterministik: aynı indis her koşuda aynı değeri veriyor.
 *
 * STEREO (#566): sol = orta + yan, sağ = orta - yan. Orta mono sinyalin
 * kendisi, yani mono okuyan her yol aynı sayıları görüyor. Yan: trampet biraz
 * sola, hi-hat sağa, pedin bir sesinde kanallar arası faz farkı; kick ve bas
 * ortada — bir miksajın olağan yerleşimi.
 *
 * EKSİ İNDİSLER DE TANIMLI: panel ilk kareyi t = 0'da istiyor ve pencerenin
 * örnekleri eksi zamana düşüyor. Evreler Math.floor ve bit maskesiyle
 * hesaplanıyor; `%` eksi sayıda eksi kalan veriyor, nota dizisinin dışını
 * okuyup NaN üretiyordu. Sıfır ve üstündeki indislerde değerler ölçümün
 * kullandığı eski gömülü tarifle bayt bayt aynı.
 */
(function () {
  const SR = 48000;
  const BEAT = 0.5; // saniye, 120 BPM
  const NOTES = [55, 55, 73.4, 82.4];

  /* Örnek indisine bağlı gürültü, -1..1. Komşu örneklerin farkı yüksek
     geçiren gürültü veriyor. */
  function noise(j) {
    let h = Math.imul(j ^ 0x5bd1e995, 0x27d4eb2d);
    h = Math.imul(h ^ (h >>> 15), 0x165667b1);
    h ^= h >>> 13;
    return (h >>> 0) / 2147483648 - 1;
  }

  // Kesir kısmı, eksi sayıda da 0..1
  function frac(x) {
    return x - Math.floor(x);
  }

  // Orta (mono) kanalın j. örneği, yaklaşık -0,75..0,75
  function sampleAt(j) {
    const tt = j / SR;
    const b = Math.floor(tt / BEAT), tb = tt - b * BEAT;
    let s = 0;
    if (tb < 0.4) {
      // kick: 110 Hz'den 45 Hz'e düşen sinüs
      s += 0.9 * Math.exp(-tb / 0.16) *
        Math.sin(2 * Math.PI * (45 * tb + 2.275 * (1 - Math.exp(-tb / 0.035))));
    }
    if ((b & 1) === 1 && tb < 0.25) {
      // trampet: farkı bir kez alınmış gürültü
      s += 0.175 * (noise(j) - noise(j - 1)) * Math.exp(-tb / 0.06);
    }
    const th = tt - Math.floor(tt / (BEAT / 2)) * (BEAT / 2);
    if (th < 0.08) {
      // hi-hat: farkı üç kez alınmış gürültü
      s += 0.0225 * (noise(j) - 3 * noise(j - 1) + 3 * noise(j - 2) - noise(j - 3)) *
        Math.exp(-th / 0.02);
    }
    const note = NOTES[Math.floor(tt / (BEAT * 2)) & 3];
    if (frac(tt / (BEAT / 2)) < 0.7) s += 0.25 * Math.sin(2 * Math.PI * note * tt);
    s += 0.05 * (Math.sin(2 * Math.PI * 220 * tt) + Math.sin(2 * Math.PI * 277.2 * tt) +
      Math.sin(2 * Math.PI * 329.6 * tt));
    return s * 0.5;
  }

  // Yan kanalın j. örneği: sol = orta + yan, sağ = orta - yan
  function sideAt(j) {
    const tt = j / SR;
    const b = Math.floor(tt / BEAT), tb = tt - b * BEAT;
    let s = 0;
    if ((b & 1) === 1 && tb < 0.25) {
      s += 0.3 * 0.175 * (noise(j) - noise(j - 1)) * Math.exp(-tb / 0.06);
    }
    const th = tt - Math.floor(tt / (BEAT / 2)) * (BEAT / 2);
    if (th < 0.08) {
      s -= 0.6 * 0.0225 * (noise(j) - 3 * noise(j - 1) + 3 * noise(j - 2) - noise(j - 3)) *
        Math.exp(-th / 0.02);
    }
    s += 0.03 * Math.sin(2 * Math.PI * 277.2 * tt + 1.1);
    return s * 0.5;
  }

  // -1..1 örnekten 128 merkezli bayt
  function toByte(s) {
    s = s < -1 ? -1 : s > 1 ? 1 : s;
    return (128 + s * 127) | 0;
  }

  /* `time` dizisini — verildiyse sol ve sağ kanalı da — `end` indisli
     örnekle BİTEN pencereyle doldurur. Kronolojik, en yeni örnek sonda:
     yakalama yardımcısının verdiği biçim. Diziler aynı uzunlukta olmalı. */
  function fill(end, time, left, right) {
    const n = time.length;
    for (let k = 0; k < n; k++) {
      const j = end - (n - 1) + k;
      const s = sampleAt(j);
      time[k] = toByte(s);
      if (left || right) {
        const d = sideAt(j);
        if (left) left[k] = toByte(s + d);
        if (right) right[k] = toByte(s - d);
      }
    }
  }

  const api = { SR, BEAT, NOTES, noise, sampleAt, sideAt, toByte, fill };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVDemoAudio = api;
})();
