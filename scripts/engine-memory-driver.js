/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* engine-memory.js'nin Worker tarafı: gerçek bir MilkDrop örneği kurar, kare çizer ve
   canlı kalır ki bellek ölçümü preset verisini de görsün. */
self.addEventListener('message', async (e) => {
  const m = e.data;
  if (!m || m.__sv !== 'mem-run') return;
  try {
    window.SVMilkdropSync = true;
    const cfg = window.SV.defaultConfig();
    cfg.visualizer.type = 'milkdrop';
    cfg.milkdrop = Object.assign({}, cfg.milkdrop, { presetId: 'mem_' + m.index, name: 'bellek', source: m.source, autoNext: 0, hardCut: 'off' });
    const canvas = new OffscreenCanvas(1280, 720);
    const audio = new window.SVAudio();
    audio.applyConfig(cfg.audio);
    const mode = new window.SVModes.milkdrop(canvas);
    const freq = new Uint8Array(1024).fill(90);
    const time = new Uint8Array(2048).fill(128);
    for (let i = 0; i < m.frames; i++) {
      const t = i / 60;
      audio.ingestFrame({ freq, time, left: time, right: time, sampleRate: 44100 });
      audio.update(1 / 60);
      mode.draw(audio, cfg, t, 1 / 60);
      await new Promise((r) => setTimeout(r, 0));
    }
    self.__keep = { mode, canvas, audio }; // bellekte kalsın
    self.postMessage({ __sv: 'mem-done', ok: true, preset: mode.presetKey ? String(mode.presetKey).slice(0, 24) : null, lost: !!(mode.gl && mode.gl.isContextLost && mode.gl.isContextLost()) });
  } catch (err) {
    self.postMessage({ __sv: 'mem-done', ok: false, error: String(err && err.stack ? err.stack : err).slice(0, 400) });
  }
});
