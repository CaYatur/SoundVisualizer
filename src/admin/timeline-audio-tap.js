/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ZAMAN ÇİZELGESİ SESİNİN İÇ ÇÖZÜMLEMESİ (#1213) — yönetim paneli.

   Ses grafiği (timeline-audio.js): klipler → parça → ana kazanç → çıkış
   aygıtı. Ana kazancın ÇIKIŞINA iki çözümleyici (sol, sağ) bağlanır; sese
   dokunulmaz, çıkış aygıtına giden yol aynı kalır (yayın/kayıt yazılımları
   uygulamanın sesini eskisi gibi yakalar). Örnekler SVInternalAudio ile
   yakalama yardımcısının biçiminde kareye çevrilip ana sürece gider; ana
   süreç seçili kaynağın karesiyle karıştırır. Sistem sesi seçili olmasa da
   görselleştirici zaman çizelgesi sesine tepki verir.

   Kare yalnız ses varken (ve ardından kısa bir kuyrukla) gider: sessizken
   IPC trafiği yok, ana süreç 150 ms sonra kaynağı "çalmıyor" sayar. */
(function () {
  const SEND_MS = 16; // yardımcının ~60-70 Hz kare hızına yakın
  const TAIL_MS = 400; // ses bittikten sonra barların inişi için birkaç kare daha
  const QUIET = 1e-4; // ~-80 dBFS altı sessiz sayılır

  let ctx = null;
  let anL = null;
  let anR = null;
  let bufL = null;
  let bufR = null;
  let build = null;
  let timer = null;
  let lastLoud = 0;
  let sinkOf = () => '';

  function peak(buf) {
    let m = 0;
    for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > m) m = a; }
    return m;
  }

  function pump() {
    if (!ctx || ctx.state !== 'running' || !window.api || !window.api.timelineAudioFrame) return;
    anL.getFloatTimeDomainData(bufL);
    anR.getFloatTimeDomainData(bufR);
    const now = performance.now();
    if (peak(bufL) > QUIET || peak(bufR) > QUIET) lastLoud = now;
    if (!lastLoud || now - lastLoud > TAIL_MS) return;
    if (!build) build = window.SVInternalAudio.createFrameBuilder();
    const f = build(bufL, bufR, ctx.sampleRate);
    let sink = '';
    try { sink = String(sinkOf() || ''); } catch { sink = ''; }
    window.api.timelineAudioFrame({ freq: f.freq, time: f.time, left: f.left, right: f.right, sampleRate: f.sampleRate, sink });
  }

  /* timeline-audio.js ses bağlamını kurunca çağırır. `master` ana kazanç
     düğümü, `getSink` seçili çıkış aygıtının kimliği ('' = varsayılan). */
  function attach(audioCtx, master, getSink) {
    if (!audioCtx || !master || !window.SVInternalAudio) return false;
    if (ctx === audioCtx) return true;
    ctx = audioCtx;
    if (typeof getSink === 'function') sinkOf = getSink;
    const split = ctx.createChannelSplitter(2);
    const mk = () => {
      const a = ctx.createAnalyser();
      a.fftSize = window.SVInternalAudio.FFT_SIZE;
      a.smoothingTimeConstant = 0;
      return a;
    };
    anL = mk();
    anR = mk();
    bufL = new Float32Array(anL.fftSize);
    bufR = new Float32Array(anR.fftSize);
    master.connect(split);
    split.connect(anL, 0);
    split.connect(anR, 1);
    /* Ham ses, telefon PC'yi izlerken (#çizelge). Çıkışa giden yola dokunulmaz:
       işlemci sessiz bir düğümle kapanır, yoksa tarayıcı onu çalıştırmaz. */
    if (typeof ctx.createScriptProcessor === 'function' && window.api && window.api.timelineAudioPcm) {
      const proc = ctx.createScriptProcessor(2048, 2, 2);
      const mute = ctx.createGain();
      mute.gain.value = 0;
      master.connect(proc);
      proc.connect(mute);
      mute.connect(ctx.destination);
      proc.onaudioprocess = (ev) => {
        const ib = ev.inputBuffer;
        if (!ib || !window.api || !window.api.timelineAudioPcm) return;
        const L = ib.getChannelData(0);
        const R = ib.numberOfChannels > 1 ? ib.getChannelData(1) : L;
        const now = performance.now();
        if (peak(L) > QUIET || peak(R) > QUIET) lastLoud = now;
        if (!lastLoud || now - lastLoud > TAIL_MS) return;
        const n = L.length;
        const out = new Int16Array(n * 2);
        for (let i = 0; i < n; i++) {
          const l = L[i] < -1 ? -1 : L[i] > 1 ? 1 : L[i];
          const r = R[i] < -1 ? -1 : R[i] > 1 ? 1 : R[i];
          out[i * 2] = (l < 0 ? l * 0x8000 : l * 0x7fff) | 0;
          out[i * 2 + 1] = (r < 0 ? r * 0x8000 : r * 0x7fff) | 0;
        }
        window.api.timelineAudioPcm(new Uint8Array(out.buffer), ib.sampleRate || ctx.sampleRate || 48000);
      };
    }
    if (!timer) timer = setInterval(pump, SEND_MS);
    return true;
  }

  window.SVTimelineAudioTap = { attach };
})();
