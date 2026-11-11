/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Sayfada ve Worker'da AYNI kod (engine-parity.js). Dışa aktarımın kare döngüsünün kısa
   hali: aynı sahne, aynı ses, aynı rastgele dizi; her karenin baytları özetlenir. */
(function () {
  function seeded(seed) { // mulberry32, dışa aktarımla aynı
    let s = seed | 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(bytes) { // FNV-1a, 4 baytta bir değil her bayt
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  // Belirlenimli ses: kare zamanından
  function frameAudio(t) {
    const freq = new Uint8Array(1024);
    const time = new Uint8Array(2048);
    const beat = Math.pow(Math.max(0, 1 - ((t * 2) % 1) * 2.2), 2);
    for (let k = 0; k < 1024; k++) {
      const decay = Math.pow(1 - k / 1024, 2.6);
      const v = decay * (0.26 + 0.34 * beat) + 1.15 * beat * Math.exp(-Math.pow((k - 8) / 12, 2)) +
        0.5 * Math.exp(-Math.pow((k - 110 - 46 * Math.sin(t * 0.7)) / 26, 2));
      freq[k] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
    for (let i = 0; i < 2048; i++) {
      time[i] = Math.max(0, Math.min(255, Math.round(128 + 90 * beat * Math.sin(i * 0.09 + t * 9) + 30 * Math.sin(i * 0.017 + t * 2))));
    }
    return { freq, time, left: time, right: time, sampleRate: 44100 };
  }

  async function run(job) {
    window.SVMilkdropSync = true;
    Math.random = seeded(0x53564558);
    const os = job.platform || 'win32';
    window.SV_PLATFORM = { os, isWindows: os === 'win32', isMac: os === 'darwin', isLinux: os === 'linux' };
    const cfg = window.SV.deepMerge(window.SV.defaultConfig(), job.cfg || {});
    if (window.SVPresets && Array.isArray(job.presets)) window.SVPresets.setUser(job.presets);
    cfg.power = Object.assign({}, cfg.power, { renderScale: 1 });
    const W = job.width;
    const H = job.height;
    const comp = document.createElement('canvas');
    comp.width = W;
    comp.height = H;
    const ctx = comp.getContext('2d', { willReadFrequently: true });
    const audio = new window.SVAudio();
    audio.applyConfig(cfg.audio);
    const modulator = new window.SVModulation.Modulator();
    const stack = new window.SVLayers.LayerStack(null, {});
    let sprites = null;
    if (cfg.images && cfg.images.enabled && Array.isArray(cfg.images.items) && cfg.images.items.length) {
      sprites = new window.SVSprites();
      sprites.setItems(cfg.images.items);
      await sprites.whenReady();
      stack.setSprites(sprites);
    }
    stack.resize(W, H);
    stack.setConfig(cfg);
    let postfx = null;
    if (Array.isArray(cfg.postfx) && cfg.postfx.length && window.SVPostFX) {
      postfx = new window.SVPostFX.PostFX();
      postfx.setChain(cfg.postfx);
      postfx.resize(W, H);
      if (!postfx.hasWork()) postfx = null;
    }
    const settle = async () => {
      if (!stack.assetsPending || !stack.assetsPending()) return;
      await Promise.race([stack.whenAssetsSettled(), new Promise((r) => setTimeout(r, 20000))]);
    };
    await settle();
    // Dışa aktarım gibi: görseller ilk kareden önce. Beklenmezse yüklenme anı yarışa kalır.
    const urls = new Set();
    const L = window.SVLayers;
    for (const l of cfg.layers || []) {
      if (!l || l.kind !== 'logo' || l.enabled === false) continue;
      const lg = (l.settings && l.settings.logo) || cfg.logo;
      const own = lg && L.logoFileSrc(lg);
      if (own) urls.add(own);
    }
    if (cfg.logo && cfg.logo.enabled && L.logoFileSrc(cfg.logo)) urls.add(L.logoFileSrc(cfg.logo));
    await Promise.all(Array.from(urls).map((u) => {
      const img = stack._getImage(u);
      return img && img.decode ? img.decode().catch(() => null) : null;
    }));
    const hashes = [];
    const frames = [];
    const dt = 1 / job.fps;
    const t0 = performance.now();
    for (let i = 0; i < job.frames; i++) {
      const t = i / job.fps;
      audio.ingestFrame(frameAudio(t));
      audio.update(dt);
      modulator.update(cfg, audio, t, dt);
      const mcfg = modulator.apply(cfg, dt);
      if (postfx && modulator.touches('postfx')) postfx.setChain(mcfg.postfx || []);
      stack.composeTo(ctx, audio, mcfg, t, dt, (c) => stack._drawLogoToCanvas(c, mcfg, audio, t));
      if (postfx) {
        postfx.render(comp, audio, t, dt);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'copy';
        ctx.globalAlpha = 1;
        ctx.drawImage(postfx.canvas, 0, 0, W, H);
        ctx.globalCompositeOperation = 'source-over';
      }
      const px = ctx.getImageData(0, 0, W, H).data;
      hashes.push(hash(px));
      frames.push(px); // farkın büyüklüğü her karede ölçülür
      await settle();
    }
    const ms = performance.now() - t0;
    // Hangi motor kuruldu: fark çıkınca ilk bakılacak yer
    const built = stack.entries.map((e) => [e.layer.kind, e.layer.type, e.mode ? e.mode.constructor.name : (e.solid ? 'düz renk' : 'yok')].join('/'));
    if (postfx && postfx.dispose) postfx.dispose();
    if (stack.dispose) stack.dispose();
    return { hashes, ms, frames, built };
  }

  self.SVParity = { run };
  // Worker tarafı: iş gelince koşar, sonucu sayfaya yollar
  if (typeof WorkerGlobalScope !== 'undefined') {
    // Worker'ın konsolu CDP'ye düşmüyor: uyarı ve hatalar sonuca eklenir
    const logs = [];
    for (const level of ['warn', 'error']) {
      const raw = console[level].bind(console);
      console[level] = (...a) => { if (logs.length < 40) logs.push(level + ': ' + a.map(String).join(' ').slice(0, 300)); raw(...a); };
    }
    self.addEventListener('error', (e) => { if (logs.length < 40) logs.push('hata: ' + e.message + ' @' + e.filename + ':' + e.lineno); });
    self.addEventListener('unhandledrejection', (e) => { if (logs.length < 40) logs.push('reddedildi: ' + String(e.reason && e.reason.stack || e.reason).slice(0, 400)); });
    self.__parityLogs = logs;
    self.addEventListener('message', (e) => {
      const m = e.data;
      if (!m || m.__sv !== 'parity') return;
      logs.length = 0;
      run(m.job).then((r) => {
        r.logs = logs.slice();
        self.postMessage({ __sv: 'parity-done', r }, r.frames.map((f) => f.buffer));
      }, (err) => self.postMessage({ __sv: 'parity-done', error: String(err && err.stack ? err.stack : err) }));
    });
  }
})();
