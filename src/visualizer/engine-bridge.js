/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Sayfa ile motor Worker'ı arasındaki köprü (#905).

   Worker'da olmayan iki şey sayfadan veriliyor: görsel çözme ve ana süreç çağrıları
   (window.api). Karşı ucu engine-env.js. Yalnız sayfada yüklenir. */
(function () {
  // Worker'a gitmeyen betikler: sayfaya ait olanlar ve arayüz ikonları
  const PAGE_ONLY = /\/(visualizer|exporter|yuv-readout|icons|engine-bridge)\.js(\?|$)/;

  // Sayfanın kendi <script> sırası: motorun yükleneceği tek liste
  function engineScripts(doc) {
    return Array.from(doc.scripts).map((s) => s.src).filter((src) => src && !PAGE_ONLY.test(src));
  }

  function decode(src) {
    const img = new Image();
    img.src = src;
    return img.decode().then(() => createImageBitmap(img));
  }

  function attach(worker) {
    worker.addEventListener('message', (e) => {
      const m = e.data;
      if (!m || !m.__sv) return;
      const answer = (ok, value, error, transfer) => worker.postMessage({ __sv: 'ret', id: m.id, ok, value, error }, transfer || []);
      if (m.__sv === 'image') {
        decode(m.src).then((bmp) => answer(true, bmp, null, [bmp]), (err) => answer(false, null, String(err)));
      } else if (m.__sv === 'call') {
        const fn = window.api && window.api[m.name];
        if (typeof fn !== 'function') { answer(false, null, 'api yok: ' + m.name); return; }
        Promise.resolve().then(() => fn.apply(window.api, m.args)).then((v) => answer(true, v), (err) => answer(false, null, String(err)));
      } else if (m.__sv === 'sub') {
        const fn = window.api && window.api[m.name];
        if (typeof fn === 'function') fn.call(window.api, (...args) => worker.postMessage({ __sv: 'ev', name: m.name, args }));
      }
    });
    if (window.api) worker.postMessage({ __sv: 'api', names: Object.keys(window.api) });
  }

  /* Motoru açar. Bitince Worker'ı döndürür; açılamazsa hatayı olduğu gibi bildirir. */
  function boot(opts) {
    const o = opts || {};
    const worker = new Worker(o.url || new URL('../visualizer/engine-worker.js', document.baseURI).href);
    attach(worker);
    return new Promise((resolve, reject) => {
      const onBooted = (e) => {
        const m = e.data;
        if (!m || m.__sv !== 'booted') return;
        worker.removeEventListener('message', onBooted);
        if (m.error) { worker.terminate(); reject(new Error(m.error)); return; }
        resolve({ worker, bootMs: m.ms });
      };
      worker.addEventListener('message', onBooted);
      worker.onerror = (err) => reject(new Error(err.message || 'Worker açılamadı'));
      worker.postMessage({
        __sv: 'boot',
        scripts: o.scripts || engineScripts(document),
        locale: window.SVI18n ? window.SVI18n.locale : 'en',
        globals: o.globals || {},
      });
    });
  }

  const api = { boot, attach, engineScripts, PAGE_ONLY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVEngineBridge = api;
})();
