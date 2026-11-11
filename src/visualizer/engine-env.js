/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* MOTORUN WORKER ORTAMI (#905).

   Motor sayfaya çok az bağlı: tuval oluşturma, birkaç görsel yükleme ve `window`
   üzerinden birbirini bulan modüller. Bunların Worker'daki karşılığı burada; motor
   kodu sayfada ve Worker'da aynı kalıyor, dışa aktarım da aynı kodu çiziyor.

   Yalnız Worker'da yüklenir. Bilinçli olarak küçük: tanımadığı bir öğe istenince
   hata veriyor ki sayfaya yeni bir bağımlılık sessizce geçmesin. */
(function () {
  const g = self;
  g.window = g;

  /* Sayfaya istek. Görseller ve ana süreç çağrıları sayfadan geçiyor: <img> çözücüsü
     ve önyükleme köprüsü yalnız orada var (engine-bridge.js). */
  const pending = new Map();
  let seq = 0;
  function request(kind, payload) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      g.postMessage(Object.assign({ __sv: kind, id }, payload));
    });
  }

  const listeners = new Map();
  function installApi(names) {
    const api = {};
    for (const name of names) {
      // onConfig(cb) gibi abonelikler: geri çağrı burada kalır, olay sayfadan gelir
      if (/^on[A-Z]/.test(name)) {
        api[name] = (cb) => {
          if (!listeners.has(name)) {
            listeners.set(name, []);
            g.postMessage({ __sv: 'sub', name });
          }
          listeners.get(name).push(cb);
        };
      } else {
        api[name] = (...args) => request('call', { name, args });
      }
    }
    g.api = api;
  }

  g.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || !m.__sv) return;
    if (m.__sv === 'ret') {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.value);
      else p.reject(new Error(m.error || 'sayfa isteği başarısız'));
    } else if (m.__sv === 'ev') {
      for (const cb of listeners.get(m.name) || []) cb(...m.args);
    } else if (m.__sv === 'api') {
      installApi(m.names);
    }
  });

  g.document = {
    createElement(tag) {
      if (String(tag).toLowerCase() === 'canvas') return new OffscreenCanvas(300, 150);
      throw new Error('Worker ortamında bu öğe yok: ' + tag);
    },
    querySelector() { return null; },
  };

  /* Görsel: sayfada çözülür, kopyasız gelir. Dönen nesne bir tuval, çünkü drawImage ve
     texImage2D'ye verilebilmesi gerekiyor. bitmaprenderer bağlamı görüntüyü olduğu gibi
     taşıyor; 2B bağlama çizmek saydam piksellerde yuvarlama farkı üretirdi. */
  g.Image = function Image() {
    const c = new OffscreenCanvas(1, 1);
    let src = '';
    let settled = null;
    c.complete = false;
    c.naturalWidth = 0;
    c.naturalHeight = 0;
    c.onload = null;
    c.onerror = null;
    c.crossOrigin = null;
    Object.defineProperty(c, 'src', {
      get: () => src,
      set(v) {
        src = String(v);
        c.complete = false;
        settled = request('image', { src }).then((bmp) => {
          c.width = bmp.width;
          c.height = bmp.height;
          c.naturalWidth = bmp.width;
          c.naturalHeight = bmp.height;
          c.getContext('bitmaprenderer').transferFromImageBitmap(bmp);
          c.complete = true;
          if (c.onload) c.onload({ target: c });
        }, (err) => {
          c.complete = true;
          if (c.onerror) c.onerror(err);
          throw err;
        });
        settled.catch(() => { /* onerror'a iletildi; decode() çağıran kendi görür */ });
      },
    });
    c.decode = () => settled || Promise.reject(new Error('görsel adresi yok'));
    return c;
  };
})();
