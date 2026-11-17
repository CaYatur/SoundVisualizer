/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TELEFONDA ÇİZİLEN ÖNİZLEMELER (Faz 4, Kitaplık).

   Yerleşik şablon, MilkDrop ve Shader presetlerinin resmi derlemede çiziliyor
   (android/tools/gen-previews.js). Kullanıcının eklediği .milk dosyaları ve masaüstü
   yedeğinden gelen presetler APK'da yok: onlar burada, telefonda çiziliyor. Yol derlemedeki
   çizicinin (android/tools/preview-runner.js) aynısı, daha küçük ve kısa: motorun katman
   yığını kapsayıcısız kuruluyor (dışa aktarıcı gibi, sayfaya tuval eklenmiyor), sentetik
   sesle 48 kare çiziliyor, en dolu kare 240x135 WebP oluyor.

   - Bir seferde tek iş; kare aralarında ana iş parçacığı bırakılıyor (canlı görüntü ve
     dokunuş beklemesin). Yığın her işten sonra kapatılıyor: geçici bir WebGL bağlamı.
   - Yalnız ekranda bekleyen kutular çiziliyor: kutu sayfadan kalktıysa iş atlanıyor.
   - Resim IndexedDB'de, anahtar presetin içeriğinden: preset değişince yeniden çizilir.
     Çizilemeyen (hata) anahtar bu oturumda bir daha denenmiyor.

   SVPreviewLive.art(kind, preset, fallback) → kutunun resim öğesi (hazırsa resim, değilse
   fallback ve sıraya girer; çizilince yerini resim alır). */
(function () {
  if (typeof window === 'undefined') return;
  const env = window.__SV_ANDROID || {};
  if (String(env.page || '').indexOf('src/visualizer/') !== 0) return;

  const R = { renderW: 320, renderH: 180, frames: 48, pickFrom: 24, pickEvery: 6, fps: 30, thumbW: 240, thumbH: 135, quality: 0.72 };
  const DB = 'sv-previews';
  const STORE = 'thumbs';
  const cache = new Map(); // anahtar → dataURL
  const failed = new Set();
  const queue = []; // { key, kind, preset }
  let loaded = null;
  let busy = false;

  function hash(s) {
    let a = 2166136261;
    let b = 5381;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 16777619);
      b = (Math.imul(b, 33) + c) | 0;
    }
    return (a >>> 0).toString(16) + (b >>> 0).toString(16) + s.length.toString(16);
  }
  function keyOf(kind, p) {
    const body = kind === 'md' ? String(p.source || '').replace(/\r\n/g, '\n')
      : JSON.stringify({ kind: p.kind, base: p.base, overrides: p.overrides, shader: p.shader, controls: p.controls });
    return kind + ':' + hash(body);
  }

  // ---- Depo (IndexedDB; yoksa yalnız bu oturum) ----
  function openDb() {
    return new Promise((resolve) => {
      try {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }
  function load() {
    if (loaded) return loaded;
    loaded = openDb().then((db) => new Promise((resolve) => {
      if (!db) { resolve(null); return; }
      try {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).openCursor();
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur) { resolve(db); return; }
          cache.set(cur.key, cur.value);
          cur.continue();
        };
        req.onerror = () => resolve(db);
      } catch (e) { resolve(db); }
    }));
    return loaded;
  }
  function save(key, url) {
    cache.set(key, url);
    load().then((db) => {
      if (!db) return;
      try { db.transaction(STORE, 'readwrite').objectStore(STORE).put(url, key); } catch (e) { /* depo dolu: bu oturumluk */ }
    });
  }

  // ---- Çizim ----
  function frameAt(t) {
    const D = window.SVDemoAudio;
    const freq = new Uint8Array(1024);
    const time = new Uint8Array(2048);
    const left = new Uint8Array(2048);
    const right = new Uint8Array(2048);
    D.spectrum(t, freq);
    D.fill(Math.floor(t * D.SR), time, left, right);
    return { freq, time, left, right, sampleRate: 48000 };
  }
  function sceneFor(kind, p) {
    const SV = window.SV;
    const L = window.SVLayers;
    const cfg = SV.deepMerge(SV.defaultConfig(), {});
    cfg.postfx = [];
    if (cfg.images) cfg.images.enabled = false;
    if (cfg.logo) cfg.logo.enabled = false;
    if (cfg.timeline) cfg.timeline.enabled = false;
    if (kind === 'md') {
      const layer = L.normalizeLayer({ id: 'pv', kind: 'visualizer', type: 'milkdrop', name: p.name || '' });
      layer.settings = { visualizer: { type: 'milkdrop' } };
      cfg.layers = [layer];
      cfg.visualizer.type = 'milkdrop';
      // Motor kaynağı ayardan okuyor (kimlik yetmiyor)
      cfg.milkdrop = Object.assign({}, cfg.milkdrop, { presetId: p.id, source: p.source || '', name: p.name || '' });
    } else {
      const want = p.kind === 'background' ? 'background' : 'visualizer';
      const layer = L.normalizeLayer({ id: 'pv', kind: want, type: 'custom', name: p.name || '' });
      layer.settings = {};
      layer.settings[want] = { type: 'custom' };
      layer.presetId = p.id;
      cfg.layers = [layer];
      if (cfg[want]) cfg[want].type = 'custom';
      cfg.custom = Object.assign({}, cfg.custom, want === 'background' ? { backgroundId: p.id } : { visualizerId: p.id });
    }
    return cfg;
  }
  const probe = document.createElement('canvas');
  probe.width = 48;
  probe.height = 27;
  function fullness(src) {
    const g = probe.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#000';
    g.fillRect(0, 0, probe.width, probe.height);
    g.drawImage(src, 0, 0, probe.width, probe.height);
    const d = g.getImageData(0, 0, probe.width, probe.height).data;
    let lit = 0;
    let blown = 0;
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      if (y > 18) lit++;
      if (y > 245) blown++;
    }
    return (lit - 2 * blown) / (d.length / 4);
  }
  const breathe = () => new Promise((r) => setTimeout(r, 0));
  async function render(kind, p) {
    const comp = document.createElement('canvas');
    comp.width = R.renderW;
    comp.height = R.renderH;
    const ctx = comp.getContext('2d');
    const out = document.createElement('canvas');
    out.width = R.thumbW;
    out.height = R.thumbH;
    const og = out.getContext('2d');
    const cfg = sceneFor(kind, p);
    const audio = new window.SVAudio();
    const stack = new window.SVLayers.LayerStack(null, {});
    try {
      stack.resize(R.renderW, R.renderH);
      stack.setConfig(cfg);
      if (!stack.entries.length) return '';
      const dt = 1 / R.fps;
      let best = -Infinity;
      for (let i = 0; i < R.frames; i++) {
        const t = i * dt;
        audio.ingestFrame(frameAt(t));
        audio.update(dt);
        stack.composeTo(ctx, audio, cfg, t, dt, false);
        const n = i + 1;
        if (n >= R.pickFrom && ((n - R.pickFrom) % R.pickEvery === 0 || n === R.frames)) {
          const s = fullness(comp);
          if (s > best) {
            best = s;
            og.fillStyle = '#000';
            og.fillRect(0, 0, R.thumbW, R.thumbH);
            og.drawImage(comp, 0, 0, R.thumbW, R.thumbH);
          }
        }
        if (i % 4 === 3) await breathe();
      }
      return out.toDataURL('image/webp', R.quality);
    } finally {
      try { stack.dispose(); } catch (e) { /* zaten kapalı */ }
    }
  }

  // ---- Sıra ----
  function waiting(key) {
    return document.querySelector('[data-preview="' + key + '"]');
  }
  async function pump() {
    if (busy) return;
    busy = true;
    try {
      await load();
      while (queue.length) {
        const job = queue.shift();
        if (cache.has(job.key) || failed.has(job.key) || !waiting(job.key)) continue;
        let url = '';
        try { url = await render(job.kind, job.preset); } catch (e) { url = ''; console.warn('[preview-live]', job.key, e && e.message); }
        if (!url) { failed.add(job.key); continue; }
        save(job.key, url);
        paint(job.key);
        await breathe();
      }
    } finally {
      busy = false;
    }
  }
  function paint(key) {
    const url = cache.get(key);
    if (!url) return;
    for (const el of document.querySelectorAll('[data-preview="' + key + '"]')) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.decoding = 'async';
      el.replaceWith(img);
    }
  }

  /** Kutunun resmi: hazırsa resim; değilse fallback (desen) sıraya girer, çizilince yerini alır. */
  function art(kind, p, fallback) {
    if (!p || !p.id || (kind === 'md' && !p.source && !p.lazy)) return fallback;
    const key = keyOf(kind, p);
    const url = cache.get(key);
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.decoding = 'async';
      return img;
    }
    if (failed.has(key)) return fallback;
    fallback.setAttribute('data-preview', key);
    // Kaynağı yolda olan preset (tembel liste): kaynak gelince çizilir
    const job = { key, kind, preset: p };
    if (kind === 'md' && !p.source && window.api && window.api.milkdropPresetSource) {
      window.api.milkdropPresetSource(p.id).then((src) => {
        if (!src) return;
        job.preset = Object.assign({}, p, { source: src });
        const k2 = keyOf(kind, job.preset);
        if (k2 !== key) {
          fallback.setAttribute('data-preview', k2);
          job.key = k2;
        }
        queue.push(job);
        pump();
      }, () => {});
      return fallback;
    }
    queue.push(job);
    // Kutular sayfaya eklendikten sonra başla
    setTimeout(pump, 120);
    return fallback;
  }

  load().then(() => {
    // Depo okunmadan çizilen kutular varsa onları hemen boya
    for (const el of document.querySelectorAll('[data-preview]')) paint(el.getAttribute('data-preview'));
  });

  window.SVPreviewLive = Object.freeze({ art, keyOf, stats: () => ({ cached: cache.size, queued: queue.length, failed: failed.size, busy }) });
})();
