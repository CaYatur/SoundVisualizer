/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* MIDI Time Code (MTC) girişi: çeyrek kare (0xF1) iletilerinden saat çözümü
   ve Zaman Çizelgesi'ni kovalama kararı.

   Çeyrek kare: 8 parça (0..7) iki kareye yayılır; parça 7 gelince tam
   zaman (saat:dakika:saniye:kare + hız kodu) bilinir. Son parçanın geldiği
   anda gerçek konum gönderilen zamandan 2 kare ileridedir (8 çeyrek = 2
   kare). Aradaki her çeyrek 1/4 kare ilerletir, böylece konum kare başına
   dört kez tazelenir. Tam kare SysEx (F0 7F 7F 01 01 hh mm ss ff F7) de
   çözülür (Web MIDI sysex izni olmadan gelmez; varsa kullanılır).

   Hız kodu: 0 = 24, 1 = 25, 2 = 29.97 drop-frame, 3 = 30 fps. 29.97 DF
   için kare sayısı düşen kareler hesaba katılarak saniyeye çevrilir. */
(function () {
  const RATES = [24, 25, 29.97, 30];

  // hh:mm:ss:ff → saniye. Drop-frame (29.97) zaman kodunda her dakika
  // başında 2 kare numarası atlanır (onun katları hariç).
  function toSeconds(h, m, s, f, rateCode) {
    const code = rateCode | 0;
    if (code === 2) {
      const totalMin = h * 60 + m;
      const frameNo = (h * 3600 + m * 60 + s) * 30 + f - 2 * (totalMin - Math.floor(totalMin / 10));
      return frameNo / 29.97;
    }
    const fps = RATES[code] || 30;
    return h * 3600 + m * 60 + s + f / fps;
  }

  function createDecoder() {
    const parts = new Array(8).fill(0);
    let seen = 0; // görülen parçaların bit maskesi
    let lastPiece = -1;
    let base = null; // { t: saniye, rate, at: ms }
    let quarters = 0; // son tam zamandan bu yana çeyrek sayısı
    let lastAt = 0;
    let dir = 1;

    function quarterFrame(data, now) {
      const piece = (data >> 4) & 0x07;
      const nib = data & 0x0f;
      // Geri sarma: parçalar azalan sırada geliyor
      if (lastPiece >= 0) dir = piece === ((lastPiece + 7) & 7) ? -1 : piece === ((lastPiece + 1) & 7) ? 1 : dir;
      lastPiece = piece;
      parts[piece] = nib;
      seen |= 1 << piece;
      lastAt = now;
      quarters++;
      const complete = dir > 0 ? piece === 7 : piece === 0;
      if (complete && seen === 0xff) {
        const f = parts[0] | (parts[1] << 4);
        const s = parts[2] | (parts[3] << 4);
        const m = parts[4] | (parts[5] << 4);
        const h = parts[6] | ((parts[7] & 0x01) << 4);
        const rate = (parts[7] >> 1) & 0x03;
        const fps = RATES[rate];
        const t = toSeconds(h, m, s, f, rate) + (dir > 0 ? 2 / fps : 0);
        base = { t, rate, h, m, s, f };
        quarters = 0;
        return true;
      }
      return false;
    }

    function fullFrame(bytes, now) {
      const b = Array.from(bytes || []);
      if (b.length < 10 || b[0] !== 0xf0 || b[1] !== 0x7f || b[3] !== 0x01 || b[4] !== 0x01) return false;
      const rate = (b[5] >> 5) & 0x03;
      const h = b[5] & 0x1f;
      base = { t: toSeconds(h, b[6], b[7], b[8], rate), rate, h, m: b[6], s: b[7], f: b[8] };
      quarters = 0;
      lastAt = now;
      seen = 0;
      return true;
    }

    return {
      /* Ham MIDI iletisi. Dönüş: tam zaman güncellendi mi. */
      feed(data, now) {
        const t = now == null ? Date.now() : now;
        if (!data || !data.length) return false;
        if (data[0] === 0xf1 && data.length >= 2) return quarterFrame(data[1], t);
        if (data[0] === 0xf0) return fullFrame(data, t);
        return false;
      },
      // Güncel konum (saniye) ya da null
      time() {
        if (!base) return null;
        const fps = RATES[base.rate];
        return base.t + dir * quarters / (4 * fps);
      },
      rate() { return base ? RATES[base.rate] : 0; },
      // Son çeyrek `ms` içinde geldiyse kod akıyor
      running(now, ms) { return !!base && ((now == null ? Date.now() : now) - lastAt) <= (ms || 250); },
      label() {
        if (!base) return '--:--:--:--';
        const p = (n) => String(n).padStart(2, '0');
        return p(base.h) + ':' + p(base.m) + ':' + p(base.s) + ':' + p(base.f);
      },
      reset() { seen = 0; lastPiece = -1; base = null; quarters = 0; lastAt = 0; dir = 1; },
    };
  }

  /* Kovalama kararı. mtc: { time, running }, tl: { time, playing },
     opt: { offset (sn, çizelge = MTC − offset), threshold (sn) }.
     Dönüş: { play, pause, seek } (seek: saniye ya da null). */
  function chaseStep(mtc, tl, opt) {
    const o = Object.assign({ offset: 0, threshold: 0.15 }, opt || {});
    const out = { play: false, pause: false, seek: null };
    if (!mtc || mtc.time == null) return out;
    const target = Math.max(0, mtc.time - (Number(o.offset) || 0));
    if (!mtc.running) {
      // Kod durdu: çizelge de durur, son konuma oturur
      if (tl.playing) { out.pause = true; out.seek = target; }
      return out;
    }
    if (Math.abs(target - (tl.time || 0)) > o.threshold) out.seek = target;
    if (!tl.playing) out.play = true;
    return out;
  }

  /* Test ve öykünme: t saniyesinden başlayan çeyrek kare dizisi (8 ileti). */
  function encodeQuarterFrames(h, m, s, f, rateCode) {
    const vals = [f & 0x0f, (f >> 4) & 0x01, s & 0x0f, (s >> 4) & 0x03, m & 0x0f, (m >> 4) & 0x03, h & 0x0f, ((h >> 4) & 0x01) | ((rateCode & 0x03) << 1)];
    return vals.map((v, i) => [0xf1, (i << 4) | v]);
  }

  const api = { createDecoder, chaseStep, toSeconds, encodeQuarterFrames, RATES };
  if (typeof window !== 'undefined') window.SVMtc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
