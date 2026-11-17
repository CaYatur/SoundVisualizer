/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ÖNİZLEME ÇİZİCİSİ (android/tools/gen-previews.js). Masaüstünün mod resmi sayfasına
   (src/thumbs/modes.html) Electron'dan sonradan yükleniyor; o sayfanın motor dosyalarını
   kullanıyor, kendi dosyalarına dokunmuyor (mod resimlerinin anahtarı onlara bağlı).
   Yol src/thumbs/mode-thumbs.js'in aynısı: sahne LayerStack'e verilir, kareler birleştirme
   yüzeyine basılır, en dolu kare küçültülür. Aynı iş her seferinde aynı görüntü: Math.random
   anahtardan tohumlanıyor, saat ve sentetik ses kare indisinden.

   window.__svPreview({ kind: 'tpl' | 'md', id, key, recipe }) → Promise<{ ok, data | error }>
   (data: base64 WebP). */
(function () {
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
  function frameAt(t) {
    const freq = new Uint8Array(BINS);
    const time = new Uint8Array(LEN);
    const left = new Uint8Array(LEN);
    const right = new Uint8Array(LEN);
    DEMO.spectrum(t, freq);
    DEMO.fill(Math.floor(t * DEMO.SR), time, left, right);
    return { freq, time, left, right, sampleRate: 48000 };
  }

  /* Sahne: şablon masaüstündeki gibi uygulanır (SVTemplates.apply, varsayılan ayar üstüne);
     MilkDrop presetinde tek bir MilkDrop katmanı ve ortak preset o preset. Dosya isteyen
     öğeler (logo, görsel, zaman çizelgesi) kapalı: önizlemede kullanıcının dosyası yok. */
  function sceneFor(job) {
    const SV = window.SV;
    const L = window.SVLayers;
    let cfg;
    if (job.kind === 'tpl') {
      const t = window.SVTemplates.TEMPLATES.find((x) => x.id === job.id);
      if (!t) throw new Error('NO_TEMPLATE');
      cfg = window.SVTemplates.apply(SV.defaultConfig(), t, { defaultConfig: SV.defaultConfig, deepMerge: SV.deepMerge, clone: SV.clone });
    } else {
      const p = (window.SVMilkdropBuiltins || []).find((x) => x.id === job.id);
      if (!p) throw new Error('NO_PRESET');
      cfg = SV.deepMerge(SV.defaultConfig(), {});
      const layer = L.normalizeLayer({ id: 'md', kind: 'visualizer', type: 'milkdrop', name: p.name });
      layer.settings = { visualizer: { type: 'milkdrop' } };
      cfg.layers = [layer];
      cfg.postfx = [];
      cfg.visualizer.type = 'milkdrop';
      // Motor kaynağı ayardan okuyor (Kitaplık da seçince kaynağı yazıyor)
      cfg.milkdrop = Object.assign({}, cfg.milkdrop, { presetId: p.id, source: p.source, name: p.name });
    }
    if (cfg.images) cfg.images.enabled = false;
    if (cfg.timeline) cfg.timeline.enabled = false;
    if (cfg.layerStack && cfg.layerStack.enabled && L.syncStackState) L.syncStackState(cfg);
    return cfg;
  }

  const probe = document.createElement('canvas');
  probe.width = 64;
  probe.height = 36;
  function fullness(src) {
    const p = probe.getContext('2d', { willReadFrequently: true });
    p.fillStyle = '#000';
    p.fillRect(0, 0, probe.width, probe.height);
    p.drawImage(src, 0, 0, probe.width, probe.height);
    const d = p.getImageData(0, 0, probe.width, probe.height).data;
    let lit = 0;
    let blown = 0;
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      if (y > 18) lit++;
      if (y > 245) blown++;
    }
    return (lit - 2 * blown) / (d.length / 4);
  }
  function keep(R) {
    out.width = R.thumbW;
    out.height = R.thumbH;
    const c = out.getContext('2d');
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.fillStyle = '#000';
    c.fillRect(0, 0, R.thumbW, R.thumbH);
    c.drawImage(comp, 0, 0, R.thumbW, R.thumbH);
  }

  window.__svPreview = async function (job) {
    const R = job.recipe;
    seedRandom(job.key);
    let stack = null;
    try {
      const cfg = sceneFor(job);
      comp.width = R.renderW;
      comp.height = R.renderH;
      const ctx = comp.getContext('2d');
      const audio = new window.SVAudio();
      stack = new window.SVLayers.LayerStack(stageEl, {});
      stack.resize(R.renderW, R.renderH);
      stack.setConfig(cfg);
      if (!stack.entries.length) return { ok: false, error: 'NO_LAYERS' };
      const dt = 1 / R.fps;
      let best = -Infinity;
      let bestScore = 0;
      for (let i = 0; i < R.frames; i++) {
        const t = i * dt;
        audio.ingestFrame(frameAt(t));
        audio.update(dt);
        stack.composeTo(ctx, audio, cfg, t, dt, false);
        const n = i + 1;
        if (n >= R.pickFrom && ((n - R.pickFrom) % R.pickEvery === 0 || n === R.frames)) {
          const s = fullness(comp);
          if (s > best) { best = s; bestScore = s; keep(R); }
        }
        if (i % 10 === 9) await new Promise((r) => setTimeout(r, 0));
      }
      const url = out.toDataURL('image/webp', R.quality);
      return { ok: true, data: url.slice(url.indexOf(',') + 1), fullness: Math.round(bestScore * 100) / 100 };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    } finally {
      try { if (stack) stack.dispose(); } catch (e) { /* zaten kapalı */ }
      stageEl.replaceChildren();
    }
  };
})();
