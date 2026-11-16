/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* SESSİZLİK ALGILAMA (docs/android/PHASE0.md, R3).

   Sesini paylaşmayan bir uygulama (ALLOW_CAPTURE_BY_NONE) sistem sesi
   yakalamasında hata vermiyor: kareler gelmeye devam ediyor ama hepsi dijital
   sessizlik. Uygulama "engellendi" ile "hiçbir şey çalmıyor"u kendi başına
   ayıramıyor (0E'de ölçüldü); bu yüzden yakalama sürerken belli bir süre ses
   gelmezse kullanıcıya çıkış karışımı (Visualizer) ya da mikrofon önerilir.

   Kare sessiz sayılır: zaman dizisindeki her örnek orta noktadan (128) en çok
   `floor` uzakta. Durum değişince bir kez bildirir:
     push() → 'silent' (eşik aşıldı), 'sound' (ses geri geldi) ya da null. */
(function () {
  const THRESHOLD_MS = 3000;
  const FLOOR = 1;

  function quiet(time, floor) {
    if (!time || !time.length) return true;
    for (let i = 0; i < time.length; i++) {
      const d = time[i] - 128;
      if (d > floor || d < -floor) return false;
    }
    return true;
  }

  function create(opts) {
    const o = opts || {};
    const threshold = o.thresholdMs != null ? o.thresholdMs : THRESHOLD_MS;
    const floor = o.floor != null ? o.floor : FLOOR;
    const state = { silent: false, since: null };

    function push(frame, now) {
      if (!quiet(frame && frame.time, floor)) {
        state.since = null;
        if (state.silent) { state.silent = false; return 'sound'; }
        return null;
      }
      if (state.since === null) state.since = now;
      if (!state.silent && now - state.since >= threshold) {
        state.silent = true;
        return 'silent';
      }
      return null;
    }

    // Kaynak değişince ya da durunca baştan say
    function reset() {
      state.silent = false;
      state.since = null;
    }

    return { push, reset, state };
  }

  const api = { THRESHOLD_MS, FLOOR, quiet, create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVSilence = api;
})();
