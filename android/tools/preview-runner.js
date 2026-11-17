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
    } else if (job.kind === 'sh') {
      // Studio shader (src/thumbs/mode-thumbs.js'teki Studio resmi gibi): tek katman, kendi türünde
      const p = window.SVPresets.get(job.id);
      if (!p) throw new Error('NO_SHADER');
      const want = p.kind === 'background' ? 'background' : 'visualizer';
      cfg = SV.deepMerge(SV.defaultConfig(), {});
      const layer = L.normalizeLayer({ id: 'sh', kind: want, type: 'custom', name: p.name });
      layer.settings = {};
      layer.settings[want] = { type: 'custom' };
      layer.presetId = p.id;
      cfg.layers = [layer];
      cfg.postfx = [];
      if (cfg[want]) cfg[want].type = 'custom';
      cfg.custom = Object.assign({}, cfg.custom, want === 'background' ? { backgroundId: p.id } : { visualizerId: p.id });
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
    if (job.kind === 'tpl') sampleTrack(cfg);
    if (cfg.images) cfg.images.enabled = false;
    if (cfg.timeline) cfg.timeline.enabled = false;
    if (cfg.layerStack && cfg.layerStack.enabled && L.syncStackState) L.syncStackState(cfg);
    return cfg;
  }

  /* ÇALAN PARÇA ÖRNEĞİ. Şablonların bir kısmı çalan parçanın adını ve kapağını gösteriyor;
     önizlemede gerçek parça yok, o öğe boş kalıyordu. Elle yazılmış bir parça ve çizilmiş
     soyut bir kapak (dosya değil): adlar iki dilde aynı okunuyor (mod resmindeki örnekle aynı). */
  let cover = '';
  function sampleCover() {
    if (cover) return cover;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 256, 256);
    bg.addColorStop(0, '#2b0a3d');
    bg.addColorStop(0.55, '#c2185b');
    bg.addColorStop(1, '#ff9e40');
    g.fillStyle = bg;
    g.fillRect(0, 0, 256, 256);
    g.globalAlpha = 0.85;
    g.fillStyle = '#ffe0b2';
    g.beginPath();
    g.arc(170, 92, 46, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 0.6;
    g.fillStyle = '#12051c';
    for (let i = 0; i < 9; i++) g.fillRect(18 + i * 25, 256 - (40 + ((i * 37) % 90)), 16, 256);
    cover = c.toDataURL('image/png');
    return cover;
  }
  function sampleTrack(cfg) {
    const SV = window.SV;
    const manual = { title: 'Midnight Signal', artist: 'CaYaDev', album: 'Live Set', duration: 214, artwork: sampleCover() };
    cfg.nowplaying = SV.deepMerge(cfg.nowplaying || {}, { source: 'manual', manual });
    for (const l of cfg.layers || []) {
      if (!l || l.kind !== 'nowplaying') continue;
      l.settings = l.settings || {};
      l.settings.nowplaying = SV.deepMerge(l.settings.nowplaying || {}, { source: 'manual', manual });
    }
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
