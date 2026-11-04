/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* GÖRSEL / ZEMİN KÜÇÜK RESİM ÇİZİCİSİ (#957). Gizli pencere; iş: { key, kind, type, recipe }.
   Dışa aktarıcıyla aynı yol: tek katmanlı bir sahne LayerStack'e veriliyor, kareler birleştirme
   yüzeyine basılıyor (composeTo). Elle çizilmiş resim yok; görüntüyü modun kendi kodu üretiyor.

   AYNI İŞ HER SEFERİNDE AYNI GÖRÜNTÜ:
     - Her iş yeni bir yığında, iş bitince `dispose`.
     - `Math.random` anahtardan tohumlanıyor; saat kare indisinden (t = i / fps).
     - Ses sentetik ve kare indisine bağlı: tayf panel önizlemesinin demo eğrisi, zaman verisi
       src/shared/demo-audio.js (MilkDrop küçük resimleriyle aynı örnek ses). */
(function () {
  const bridge = window.thumbs;
  const DEMO = window.SVDemoAudio;
  const comp = document.getElementById('comp');
  const stageEl = document.getElementById('stage');
  const out = document.createElement('canvas');
  const BINS = 1024;
  const LEN = 2048;

  function seedRandom(key) {
    let x = (parseInt(String(key || '').slice(0, 8), 16) >>> 0) || 1;
    Math.random = function () {
      x = (x * 1103515245 + 12345) % 2147483648;
      return x / 2147483648;
    };
  }

  // Panel önizlemesinin demo sinyali (preview.js buildSyntheticFrame) — kare indisinden
  function frameAt(t) {
    const freq = new Uint8Array(BINS);
    const time = new Uint8Array(LEN);
    const left = new Uint8Array(LEN);
    const right = new Uint8Array(LEN);
    const kick = Math.pow(1 - ((t * 2) % 1), 3.2);
    const hat = Math.pow(1 - ((t * 4) % 1), 9) * 0.55;
    const swell = 0.5 + 0.5 * Math.sin(t * 0.55);
    for (let i = 0; i < BINS; i++) {
      const n = i / BINS;
      let v = Math.pow(1 - n, 2.6) * 0.85;
      v += kick * Math.pow(1 - n * 7, 6) * 0.9;
      v += hat * Math.pow(n, 1.4) * 0.5;
      v += 0.30 * swell * Math.exp(-Math.pow((n - (0.13 + 0.05 * Math.sin(t * 0.9))) * 26, 2));
      v += 0.22 * Math.exp(-Math.pow((n - (0.26 + 0.07 * Math.sin(t * 0.63 + 2))) * 30, 2));
      v += 0.14 * Math.exp(-Math.pow((n - (0.44 + 0.06 * Math.sin(t * 1.27 + 1))) * 34, 2));
      v *= 0.86 + 0.14 * Math.sin(i * 12.9898 + t * 3.1);
      freq[i] = Math.max(0, Math.min(255, v * 255)) | 0;
    }
    DEMO.fill(Math.floor(t * DEMO.SR), time, left, right);
    return { freq, time, left, right, sampleRate: 48000 };
  }

  function sceneFor(kind, type) {
    const SV = window.SV;
    const L = window.SVLayers;
    const want = kind === 'bg' ? 'background' : 'visualizer';
    const layer = L.normalizeLayer({ id: 'thumb', kind: want, type, name: type });
    layer.settings = {};
    layer.settings[want] = { type };
    const cfg = SV.deepMerge(SV.defaultConfig(), {});
    cfg.layers = [layer];
    cfg.postfx = [];
    if (cfg.images) cfg.images.enabled = false;
    if (cfg.logo) cfg.logo.enabled = false;
    if (cfg.timeline) cfg.timeline.enabled = false;
    if (cfg[want]) cfg[want].type = type;
    return cfg;
  }

  async function run(job) {
    const R = job.recipe;
    seedRandom(job.key);
    const cfg = sceneFor(job.kind, job.type);
    comp.width = R.renderW;
    comp.height = R.renderH;
    const ctx = comp.getContext('2d');
    const audio = new window.SVAudio();
    const stack = new window.SVLayers.LayerStack(stageEl, {});
    try {
      stack.resize(R.renderW, R.renderH);
      stack.setConfig(cfg);
      if (!stack.entries.length || !stack.entries[0].mode) return { ok: false, error: 'NO_MODE' };
      const dt = 1 / R.fps;
      for (let i = 0; i < R.frames; i++) {
        const t = i * dt;
        audio.ingestFrame(frameAt(t));
        audio.update(dt);
        stack.composeTo(ctx, audio, cfg, t, dt, false);
        // Ana iş parçacığı nefes alsın: pencere gizli de olsa tek seferde uzun görev olmasın
        if (i % 10 === 9) await new Promise((r) => setTimeout(r, 0));
      }
      out.width = R.thumbW;
      out.height = R.thumbH;
      const c = out.getContext('2d');
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      c.fillStyle = '#000';
      c.fillRect(0, 0, R.thumbW, R.thumbH);
      c.drawImage(comp, 0, 0, R.thumbW, R.thumbH);
      const blob = await new Promise((res) => out.toBlob(res, 'image/webp', R.quality));
      if (!blob) return { ok: false, error: 'ENCODE' };
      return { ok: true, bytes: new Uint8Array(await blob.arrayBuffer()) };
    } finally {
      try { stack.dispose(); } catch (e) { /* zaten kapalı */ }
      stageEl.replaceChildren();
    }
  }

  bridge.onJob((job) => {
    run(job).then((r) => bridge.done(job.key, r), (e) => bridge.done(job.key, { ok: false, error: String((e && e.message) || e) }));
  });
  bridge.ready();
})();
