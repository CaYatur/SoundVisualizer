/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Köprünün dinlenebilir sesini çalar (#813). Örnekleme hızı dönüşümü Web
   Audio'da (AudioBuffer kendi hızında, bağlam kendi hızında çalar). Çıkış
   aygıtı AudioContext.setSinkId ile; desteklenmiyorsa varsayılan çıkış. */
(function () {
  const B = window.bridgeAudio;
  const core = window.SVBridgePlayerCore;
  if (!B || !core) return;
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  const sched = core.createScheduler({ latency: 0.12 });
  let latencyMs = 120;
  // Duvar saati (ms) → bağlam zamanı: çıkışın şu an çaldığı anın eşlemesi
  function ctxTimeFor(wallMs) {
    const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
    if (ts && Number.isFinite(ts.contextTime) && Number.isFinite(ts.performanceTime) && ts.performanceTime > 0) {
      return ts.contextTime + ((wallMs - performance.timeOrigin) - ts.performanceTime) / 1000;
    }
    return ctx.currentTime + (wallMs - Date.now()) / 1000;
  }
  let inputRate = 0;
  let sinkError = '';
  let device = '';

  async function setDevice(id) {
    const want = id || '';
    if (want === device) return;
    device = want;
    sinkError = '';
    if (typeof ctx.setSinkId !== 'function') { if (want) sinkError = 'unsupported'; return; }
    try { await ctx.setSinkId(want); sched.reset(); } catch (e) { sinkError = (e && e.name) || 'error'; }
  }

  B.onConfig((c) => {
    if (!c) return;
    gain.gain.value = Math.max(0, Math.min(1, Number(c.volume)));
    sched.setLatency((Number(c.latencyMs) || 120) / 1000);
    latencyMs = Number(c.latencyMs) || 120;
    setDevice(c.device);
  });

  B.onPcm((m) => {
    if (!m || !m.data || !m.sampleRate) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const chans = core.deinterleave(m.data, m.channels || 2);
    const n = chans[0].length;
    if (!n) return;
    inputRate = m.sampleRate;
    const dur = n / m.sampleRate;
    /* Ortak saate kilitli (#815): damga (bu makinenin duvar saati, ms) +
       gecikme, çıkışın zaman damgasıyla bağlam zamanına çevrilir; iki alıcı
       aynı anda çalar. Damga yoksa (eski köprü) önceki gibi arka arkaya. */
    const at = Number.isFinite(m.localT) ? sched.placeAt(ctx.currentTime, dur, ctxTimeFor(m.localT + latencyMs)) : sched.place(ctx.currentTime, dur);
    if (at == null) return;
    const buf = ctx.createBuffer(chans.length, n, m.sampleRate);
    chans.forEach((d, i) => buf.copyToChannel(d, i));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    src.start(at);
  });

  async function listOutputs() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      B.outputs(all.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d) => ({ id: d.deviceId, label: d.label })));
    } catch { B.outputs([]); }
  }
  if (navigator.mediaDevices) {
    navigator.mediaDevices.addEventListener('devicechange', listOutputs);
    listOutputs();
  }

  setInterval(() => {
    const s = sched.status();
    B.status({
      state: ctx.state, bufferedMs: sched.buffered(ctx.currentTime) * 1000, underruns: s.underruns, dropped: s.dropped, trimmed: s.trimmed,
      alignMs: s.alignMs == null ? null : s.alignMs, late: s.late || 0, early: s.early || 0,
      chunks: s.chunks, rate: ctx.sampleRate, inputRate, sinkError,
      outputLatencyMs: Number.isFinite(ctx.outputLatency) ? ctx.outputLatency * 1000 : null,
    });
  }, 1000);
  B.ready();
})();
