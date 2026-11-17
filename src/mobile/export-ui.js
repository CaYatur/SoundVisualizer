/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* DIŞA AKTARMA EKRANI (docs/android/PLAN.md Faz 5): dışa aktarım sayfasının üstünde.

   Motor bu sayfadayken çizilen kareler ekranda görünüyor (önizleme); altta ilerleme kartı:
   şarkı, boyut, yüzde, kalan süre, Vazgeç. Bitince dosya galeriye kaydedilir (uygulama,
   MediaStore), Paylaş ve Bitti çıkar; Bitti sahneye döner. Geri tuşu işi sürerken
   vazgeçmeyi sorar. Kabuğun stilleri ve temaları kullanılır (src/mobile/shell.css). */
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const env = window.__SV_ANDROID || {};
  if (String(env.page || '').indexOf('src/exporter/') !== 0) return;
  const A = () => window.SVAndroid;
  const X = () => window.SVExport;
  const en = () => !!(window.SVI18n && window.SVI18n.locale === 'en');

  function h(tag, attrs, kids) {
    const n = document.createElement(tag);
    for (const k of Object.keys(attrs || {})) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(kids || [])) if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return n;
  }
  const icon = (name) => (window.SVIcons && window.SVIcons.has(name) ? window.SVIcons.el(name) : h('span'));
  const clock = (s) => { const m = Math.floor(s / 60); const r = Math.max(0, Math.round(s - m * 60)); return m + ':' + String(r).padStart(2, '0'); };

  let root = null;
  let refs = {};
  let phase = 'run'; // run → saving → done | failed
  let saved = null;
  let confirmOpen = false;

  function build() {
    /* Dışa aktarım sayfasında viewport yok: 1280 px'lik tuvaller düzen alanını büyütüyor,
       kart görünen alanın altında kalıyordu (ölçüldü: kartın üstü 2624 px). Birleştirme
       tuvali yalnız CSS ile ekrana sığdırılıyor (çizim tamponu ve okunan kareler aynı);
       katman tuvalleri saklı. */
    document.head.appendChild(h('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no' }));
    document.documentElement.classList.add('sv-export-page');
    document.head.appendChild(h('link', { rel: 'stylesheet', href: '../mobile/shell.css' }));
    refs.title = h('h2', { text: 'Dışa aktarılıyor' });
    refs.sub = h('div', { class: 'row-sub' });
    refs.bar = h('b', { style: 'width:0%' });
    refs.pct = h('div', { class: 'mono export-pct', text: '%0' });
    refs.eta = h('div', { class: 'row-sub' });
    refs.msg = h('div', { class: 'hint' });
    refs.actions = h('div', { class: 'btn-row' });
    const card = h('section', { class: 'export-card glass live', role: 'status', 'aria-live': 'polite' }, [
      h('div', { class: 'export-head' }, [h('div', { class: 'grow-col' }, [refs.title, refs.sub]), refs.pct]),
      h('div', { class: 'opbar export-bar', 'aria-hidden': 'true' }, [refs.bar]),
      refs.eta,
      refs.msg,
      refs.actions,
    ]);
    root = h('div', { id: 'sv-shell' }, [card]);
    document.body.appendChild(root);
    paintActions();
  }

  function setActions(list) {
    refs.actions.textContent = '';
    for (const b of list) refs.actions.appendChild(b);
  }
  function paintActions() {
    if (phase === 'run') setActions([h('button', { class: 'btn danger', onclick: askCancel }, [icon('x'), 'Vazgeç'])]);
    else if (phase === 'done') {
      setActions([
        h('button', { class: 'btn primary', onclick: () => X().share(saved.uri).catch(() => {}) }, [icon('share'), 'Paylaş']),
        h('button', { class: 'btn', onclick: () => X().close() }, [icon('check'), 'Bitti']),
      ]);
    } else if (phase === 'failed') setActions([h('button', { class: 'btn', onclick: () => X().close() }, [icon('chevron-left'), 'Sahneye dön'])]);
    else setActions([]);
  }

  function askCancel() {
    if (confirmOpen || phase !== 'run') return;
    confirmOpen = true;
    const done = (yes) => { box.remove(); confirmOpen = false; if (yes) { X().cancel(); refs.msg.textContent = 'Vazgeçiliyor…'; } };
    const box = h('div', { class: 'dialog-scrim live', onclick: (e) => { if (e.target === box) done(false); } }, [
      h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true' }, [
        h('div', { class: 'dialog-text', text: 'Dışa aktarma durdurulsun mu? Yarım dosya silinir.' }),
        h('div', { class: 'btn-row' }, [h('button', { class: 'btn ghost', text: 'Sürdür', onclick: () => done(false) }), h('button', { class: 'btn danger', text: 'Durdur', onclick: () => done(true) })]),
      ]),
    ]);
    root.appendChild(box);
  }

  function tick() {
    const s = X() && X().state();
    if (!s) return;
    if (s.size && !refs.sub.dataset.v) {
      const t = (s.song ? s.song + ' · ' : '') + s.size.width + '×' + s.size.height + ' · ' + s.size.fps + ' fps';
      refs.sub.dataset.v = '1';
      refs.sub.textContent = t;
    }
    if (phase === 'run') {
      const [done, total] = s.progress;
      const p = total > 0 ? Math.min(1, done / total) : 0;
      refs.bar.style.width = (p * 100).toFixed(1) + '%';
      refs.pct.textContent = en() ? Math.round(p * 100) + '%' : '%' + Math.round(p * 100);
      if (done > 5 && total > 0 && s.t0) {
        const el = (performance.now() - s.t0) / 1000;
        const left = (el / done) * (total - done);
        refs.eta.textContent = (en() ? 'About ' + clock(left) + ' left · ' : 'Kalan yaklaşık ' + clock(left) + ' · ') + done + ' / ' + total;
      }
      if (s.error) {
        if (s.error === 'cancelled' || s.cancel) { X().close(); return; }
        phase = 'failed';
        refs.title.textContent = 'Dışa aktarılamadı';
        refs.msg.textContent = String(s.error);
        paintActions();
      } else if (s.result && s.result.path) {
        phase = 'saving';
        refs.title.textContent = 'Galeriye kaydediliyor…';
        refs.bar.style.width = '100%';
        paintActions();
        X().save(s.result.path).then((r) => {
          saved = r;
          phase = 'done';
          refs.title.textContent = 'Galeriye kaydedildi';
          refs.eta.textContent = 'Filmler / SoundVisualizer';
          refs.msg.textContent = r.name || '';
          paintActions();
        }, (e) => {
          phase = 'failed';
          refs.title.textContent = 'Kaydedilemedi';
          refs.msg.textContent = String((e && e.message) || e);
          paintActions();
        });
      }
    }
  }

  function setInsets(v) {
    if (!root || !v) return;
    for (const k of ['top', 'right', 'bottom', 'left']) root.style.setProperty('--inset-' + k, (Number(v[k]) || 0) + 'px');
  }
  function start() {
    if (!A() || !X()) return;
    build();
    setInsets(A().insets());
    A().onInsets(setInsets);
    // Bu sayfa simge dosyasını yüklemiyor: düğme simgeleri için
    if (!window.SVIcons) {
      const s = h('script', { src: '../shared/icons.js' });
      s.addEventListener('load', paintActions);
      document.head.appendChild(s);
    }
    // Tema: sahne sayfasıyla aynı ayar
    A().config.ready().then(() => {
      const T = window.SVUiThemes;
      const c = A().config.get();
      if (T && c) T.apply(document, T.normalizeId(c.ui && c.ui.theme), window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : true, false);
    });
    A().onBack(() => { if (phase === 'run') askCancel(); else if (phase !== 'saving') X().close(); });
    setInterval(tick, 300);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
