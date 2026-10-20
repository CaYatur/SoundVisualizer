/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Köprü sesinin zamanlaması (#813), saf: Web Audio olmadan sınanabilsin.
   Her PCM parçası bir öncekinin bittiği ana konur. Tampon boşaldıysa
   (ağ takıldı) yeniden `latency` kadar ileriye; tampon çok büyüdüyse
   (köprünün saati bizimkinden hızlı, ya da bir patlama geldi) parça atılır,
   gecikme birikmesin. */
(function (root) {
  function createScheduler(opts) {
    const o = Object.assign({ latency: 0.12 }, opts || {});
    let next = 0;
    let winStart = -1;
    let winMin = Infinity;
    let debt = 0;
    const st = { chunks: 0, underruns: 0, dropped: 0, trimmed: 0 };
    return {
      setLatency(sec) { o.latency = Math.max(0.04, Math.min(1, Number(sec) || 0.12)); },
      // now: bağlamın şimdiki zamanı (sn); dur: parçanın süresi (sn). null: at
      place(now, dur) {
        if (next < now + 0.005) {
          if (st.chunks) st.underruns++;
          next = now + o.latency;
        } else if (next - now > o.latency * 3 + dur) {
          st.dropped++; // patlama: hemen at
          return null;
        } else {
          /* Kayma denetimi: tampon hedefin (latency) üstünde KALICI olarak
             duruyorsa (köprünün saati hızlı, ya da çıkış değişiminden sonra
             birikti) fazlası tek tek parça atlanarak geri alınır. Kalıcı mı:
             yarım saniyelik pencerede en AZ doluluk bile hedefin üstündeyse.
             Böylece toplu gelen parçalar (ağ ya da yardımcı patlaması) atılmaz.
             Önceden tampon hiç geri inmiyordu: 120 ms ayarında ~245 ms, çıkış
             değişince ~360 ms. */
          const lead = next - now;
          if (winStart < 0 || now < winStart) { winStart = now; winMin = lead; }
          winMin = Math.min(winMin, lead);
          if (now - winStart >= 0.5) {
            const excess = winMin - o.latency;
            if (excess > Math.max(0.01, dur)) debt = excess;
            winStart = now; winMin = lead;
          }
          if (debt > 0) {
            debt -= dur;
            st.dropped++;
            st.trimmed++;
            return null;
          }
        }
        const at = next;
        next += dur;
        st.chunks++;
        return at;
      },
      buffered(now) { return Math.max(0, next - now); },
      reset() { next = 0; debt = 0; winStart = -1; },
      status() { return Object.assign({}, st); },
    };
  }
  // s16 LE araya serpiştirilmiş -> kanal başına Float32Array
  function deinterleave(bytes, channels) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ch = Math.max(1, channels | 0);
    const n = Math.floor(bytes.byteLength / (2 * ch));
    const out = [];
    for (let c = 0; c < ch; c++) out.push(new Float32Array(n));
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < ch; c++) out[c][i] = view.getInt16((i * ch + c) * 2, true) / 32768;
    }
    return out;
  }
  const api = { createScheduler, deinterleave };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SVBridgePlayerCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
