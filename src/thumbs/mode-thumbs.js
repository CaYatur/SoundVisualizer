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
    DEMO.spectrum(t, freq);
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
    /* Kendi başına boş kalan iki mod. Studio seçili shader yokken bir şey çizmiyor: türünün ilk
       yerleşik shader'ı gösteriliyor. Çalan Parça sistemden parça bilgisi bekliyor: elle yazılmış
       örnek bir parça. Adlar iki dilde de aynı okunuyor; resim dilden bağımsız kalıyor. */
    if (type === 'custom' && window.SVPresets) {
      const first = (window.SVPresets.BUILTIN || []).find((p) => p && p.engine === 'shader' && p.kind === want);
      if (first) {
        layer.presetId = first.id;
        cfg.custom = Object.assign({}, cfg.custom, want === 'background' ? { backgroundId: first.id } : { visualizerId: first.id });
      }
    }
    if (type === 'nowplaying') {
      cfg.nowplaying = SV.deepMerge(cfg.nowplaying || {}, {
        source: 'manual',
        manual: { title: 'Midnight Signal', artist: 'CaYaDev', album: 'Live Set', duration: 214 },
      });
    }
    return cfg;
  }

  /* KARE SEÇİMİ. Tek bir an her modu anlatmıyor: havai fişek ve şimşek vuruşta patlıyor, tayf
     şeridi ve DJ dalgası soldan sağa doluyor, parçacıklar zamanla birikiyor. 1,5 saniyedeki tek
     kare bunların çoğunda boş ya da yarım çıkıyordu. Isınmadan sonra aralıklı adaylar ölçülüyor,
     en dolu olan saklanıyor. Ölçü: küçültülmüş karede yanan piksel oranı; patlamış (beyaza
     doymuş) piksel iki kat düşülüyor, flaş karesi seçilmesin. Kare indisine bağlı: aynı mod
     her seferinde aynı kareyi seçiyor. */
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
      // Seçim yoksa eski davranış: son kare
      const from = Math.max(1, Math.min(R.frames, R.pickFrom || R.frames));
      const every = Math.max(1, R.pickEvery || 1);
      let best = -Infinity;
      for (let i = 0; i < R.frames; i++) {
        const t = i * dt;
        audio.ingestFrame(frameAt(t));
        audio.update(dt);
        stack.composeTo(ctx, audio, cfg, t, dt, false);
        const n = i + 1;
        if (n >= from && ((n - from) % every === 0 || n === R.frames)) {
          const s = fullness(comp);
          if (s > best) { best = s; keep(R); }
        }
        // Ana iş parçacığı nefes alsın: pencere gizli de olsa tek seferde uzun görev olmasın
        if (i % 10 === 9) await new Promise((r) => setTimeout(r, 0));
      }
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
