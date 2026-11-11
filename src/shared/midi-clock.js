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

  /* MIDI saati ÇIKIŞI. Zaman damgası dışarıdan gelir; donanım yoktur.
     Açılınca 0xFA, her vuruşta 24 adet 0xF8, kapanınca bir kez 0xFC.
     Uzun bir duraklama birikmiş darbeleri yığmaz: çağrı başına en çok
     dört darbe, gerisi atlanır. */
  const BURST = 4;
  function createOut() {
    let running = false;
    let nextAt = 0;
    return {
      pull(now, bpm, enabled) {
        const out = [];
        const t = Number(now) || 0;
        const ok = !!enabled && bpm >= 20 && bpm <= 999;
        if (!ok) {
          if (running) { out.push(0xfc); running = false; }
          return out;
        }
        const interval = 60000 / (bpm * PPQN);
        if (!running) {
          out.push(0xfa);
          running = true;
          nextAt = t;
        }
        let n = 0;
        while (t + 1e-9 >= nextAt && n < BURST) {
          out.push(0xf8);
          nextAt += interval;
          n++;
        }
        if (t - nextAt > interval) nextAt = t + interval;
        return out;
      },
      running() { return running; },
      reset() { running = false; nextAt = 0; },
    };
  }

  /* Çıkış seçimi. 'auto' veya boş: kopmamış bütün çıkışlar, exclude
     adları hariç (dinlenen aygıtın yankısı). Belirli kimlik yalnız onu. */
  function pickOut(outputs, deviceId, excludeNames) {
    const skip = new Set((excludeNames || []).map((n) => String(n || '').trim().toLowerCase()).filter(Boolean));
    const list = outputs && typeof outputs.values === 'function' ? outputs.values() : (outputs || []);
    const specific = !!(deviceId && deviceId !== 'auto');
    const out = [];
    for (const x of list) {
      if (!x || x.state === 'disconnected') continue;
      if (specific) {
        if (x.id === deviceId) out.push(x);
        continue;
      }
      const name = String(x.name || '').trim().toLowerCase();
      if (name && skip.has(name)) continue;
      out.push(x);
    }
    return out;
  }

  /* Web MIDI tek mesaj kabul eder. 0xF8, 0xFA ve 0xFC kendi başına bir
     mesajdır; aynı dizide yollanırsa tarayıcı paketi reddeder ve başlat
     baytı da düşer. Her bayt ayrı bir tek elemanlı mesaj olur. */
  function realtimeMessages(bytes) {
    const out = [];
    if (!bytes || !bytes.length) return out;
    for (let i = 0; i < bytes.length; i++) out.push([bytes[i] & 0xff]);
    return out;
  }

  function sendRealtime(output, bytes) {
    if (!output || typeof output.send !== 'function') return 0;
    const msgs = realtimeMessages(bytes);
    let n = 0;
    for (let i = 0; i < msgs.length; i++) {
      try { output.send(msgs[i]); n++; } catch { /* bu bayt gitmedi */ }
    }
    return n;
  }

  const api = { create, createOut, pickOut, shouldApply, switchSource, realtimeMessages, sendRealtime, PPQN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVMidiClock = api;
})();
