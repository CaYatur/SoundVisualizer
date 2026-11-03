/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* MIDI SAATİ TEMPOSU.

   MIDI saati çeyrek nota başına 24 darbe (0xF8) yollar; 0xFA başlat, 0xFB
   sürdür, 0xFC durdur. Tempo, son darbelerin ortalama aralığından:
     bpm = 60000 / (aralık_ms * 24)
   Tek darbe aralığı USB ve işletim sistemi yüzünden birkaç milisaniye
   oynar; kayan pencere (en çok 48 darbe = iki vuruş) bunu yumuşatır.
   Darbe 500 ms gelmezse saat durmuş sayılır.

   Saf mantık: zaman damgası dışarıdan verilir, testler gerçek aygıt
   olmadan koşar. */
(function () {
  const PPQN = 24;
  const WINDOW = 48;
  const STALE_MS = 500;

  function create() {
    let ticks = [];
    let running = false;
    let lastAt = 0;
    let beatTicks = 0;
    return {
      // Ham MIDI baytı (durum). Dönüş: değişti mi
      message(status, at) {
        if (status === 0xf8) {
          if (lastAt && at - lastAt > STALE_MS) ticks = [];
          ticks.push(at);
          if (ticks.length > WINDOW + 1) ticks.shift();
          lastAt = at;
          beatTicks = (beatTicks + 1) % PPQN;
          return true;
        }
        if (status === 0xfa) { running = true; ticks = []; beatTicks = 0; return true; }
        if (status === 0xfb) { running = true; return true; }
        if (status === 0xfc) { running = false; return true; }
        return false;
      },
      bpm(now) {
        if (ticks.length < PPQN / 2 + 1) return 0;
        if (now != null && now - lastAt > STALE_MS) return 0;
        const span = ticks[ticks.length - 1] - ticks[0];
        const n = ticks.length - 1;
        if (!(span > 0)) return 0;
        const bpm = 60000 / ((span / n) * PPQN);
        return bpm >= 20 && bpm <= 999 ? Math.round(bpm * 10) / 10 : 0;
      },
      // 0..1 vuruş evresi (saat başlatıldıysa anlamlı)
      phase() { return beatTicks / PPQN; },
      running() { return running; },
      reset() { ticks = []; running = false; lastAt = 0; beatTicks = 0; },
    };
  }

  /* Dış tempo, cfg.modulation.bpm'e ancak anlamlı değişince yazılır:
     her darbede yapılandırma göndermek paneli boğardı. */
  function shouldApply(current, next, minDelta) {
    if (!(next > 0)) return false;
    return !(current > 0) || Math.abs(current - next) >= (minDelta == null ? 0.1 : minDelta);
  }

  /* Kaynak değişimi: dış tempo açılırken eldeki BPM saklanır, kapanınca geri
     gelir (0 = tempo motorundan al). Dış değer ayarda takılı kalmasın. */
  function switchSource(ts, modulation, next) {
    const was = ts.source || 'off';
    ts.source = next;
    if (!modulation) return;
    if (was === 'off' && next !== 'off') ts.savedBpm = modulation.bpm > 0 ? modulation.bpm : 0;
    else if (was !== 'off' && next === 'off') {
      modulation.bpm = ts.savedBpm > 0 ? ts.savedBpm : 0;
      delete ts.savedBpm;
    }
  }

  const api = { create, shouldApply, switchSource, PPQN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVMidiClock = api;
})();
