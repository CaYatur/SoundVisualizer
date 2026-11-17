/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* GÖRÜNTÜLEME SAYFASI (docs/android/PLAN.md Faz 3.4; onaylı taslak 7).

   Üst bilgideki pencere düğmesi açar. Üç büyük düğme: tam ekran, sistemin resim içinde
   resmi, yüzen pencere. Altında yüzen pencerenin ayarları: görünürlük, dokunuş geçirme
   (Android 12+: açıkken görünürlük sistemin sınırında, bugün %80), oranı koru, konumu
   kilitle, boyut. Ayarlar bu cihaza ait (yerel depo); masaüstü profiline yazılmaz.
   Pencere açıkken değişiklik hemen uygulanır. */
(function () {
  if (typeof window === 'undefined' || !window.SVShell || !window.SVShellUI) return;
  const S = window.SVShell;
  const U = window.SVShellUI;
  const { h, icon, A } = S;

  const KEY = 'sv-floating';
  const DEF = { opacity: 0.8, clickThrough: false, keepAspect: true, locked: false, size: 'medium' };
  const SIZES = { small: 0.45, medium: 0.6, large: 0.85 };
  function load() {
    try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return Object.assign({}, DEF); }
  }
  function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* depo yok */ } }
  let prefs = load();
  let maxPass = 0.8;
  let showing = false;
  let lastError = '';

  /* Pencere boyu ekranın kısa kenarına göre, 16:9 */
  function sizePx(size) {
    const d = window.devicePixelRatio || 1;
    const short = Math.min(screen.width, screen.height) * d;
    const w = Math.round(short * (SIZES[size] || SIZES.medium));
    return { width: w, height: Math.round(w * 9 / 16) };
  }
  function apply(patch) {
    prefs = Object.assign({}, prefs, patch);
    save(prefs);
    if (!showing) return;
    const o = { opacity: prefs.opacity, clickThrough: prefs.clickThrough, keepAspect: prefs.keepAspect, locked: prefs.locked };
    if (patch.size) Object.assign(o, sizePx(prefs.size));
    A().floating.set(o).catch(() => {});
  }
  function refreshState(ctx) {
    A().floating.state().then((st) => {
      if (!st) return;
      maxPass = st.maxPassThroughOpacity || 1;
      if (st.showing !== showing) { showing = !!st.showing; if (ctx) ctx.refresh(); }
    }, () => {});
  }

  function bigButton(label, name, onclick, primary) {
    return h('button', { class: 'card big' + (primary ? ' primary' : ''), onclick }, [icon(name), h('span', { text: label })]);
  }

  const page = {
    size: 'tall',
    title: 'Görüntüleme',
    render(body, ctx) {
      refreshState(ctx);
      body.appendChild(h('div', { class: 'grid3' }, [
        bigButton('Tam ekran', 'fullscreen', () => S.fullscreen(true)),
        bigButton('Resim içinde resim', 'monitor', () => { A().pip(16, 9).catch(() => {}); }),
        bigButton('Yüzen pencere', 'window', () => {
          lastError = '';
          A().floating.open(Object.assign({ opacity: prefs.opacity, clickThrough: prefs.clickThrough }, sizePx(prefs.size)))
            .then(() => A().floating.set({ keepAspect: prefs.keepAspect, locked: prefs.locked }), (e) => { lastError = String((e && e.message) || e); ctx.refresh(); });
        }, true),
      ]));
      body.appendChild(h('div', { class: 'section-label', text: 'Yüzen pencere' }));
      const capped = prefs.clickThrough && maxPass < 1;
      const op = U.slider({
        label: 'Görünürlük', min: 0.2, max: 1, step: 0.05, percent: true, value: capped ? Math.min(prefs.opacity, maxPass) : prefs.opacity,
        onInput: (v) => apply({ opacity: v }),
      });
      const through = h('div', { class: 'ctl-row' }, [
        h('div', { class: 'row-text' }, [
          h('div', { class: 'row-title small', text: 'Dokunuşları geçir' }),
          h('div', { class: 'row-sub', text: 'Açıkken görünürlük en çok %80 (Android 12+)' }),
        ]),
        h('button', {
          class: 'toggle', role: 'switch', 'aria-label': 'Dokunuşları geçir', 'aria-checked': prefs.clickThrough ? 'true' : 'false',
          onclick: () => { apply({ clickThrough: !prefs.clickThrough }); ctx.refresh(); },
        }),
      ]);
      body.appendChild(U.card([
        op,
        through,
        U.toggle({ label: 'Oranı koru', value: prefs.keepAspect, onChange: (v) => apply({ keepAspect: v }) }),
        U.toggle({ label: 'Konumu kilitle', value: prefs.locked, onChange: (v) => apply({ locked: v }) }),
        U.seg({ label: 'Boyut', options: [['small', 'Küçük'], ['medium', 'Orta boy'], ['large', 'Büyük']], value: prefs.size, onChange: (v) => apply({ size: v }) }),
      ]));
      const needPerm = lastError === 'overlay-permission';
      body.appendChild(h('div', { class: 'banner info' + (needPerm ? ' warn' : '') }, [
        icon('info'),
        h('div', { class: 'grow-text' }, [
          h('span', { text: 'Yüzen pencere için “Diğer uygulamaların üzerinde göster” izni gerekir. Xiaomi telefonlarda ayrıca “Arka planda açılır pencere” izni.' }),
          needPerm ? h('div', { class: 'row-sub', text: 'İzin ekranı açıldı; izni verip yeniden deneyin.' }) : null,
        ]),
      ]));
    },
  };

  window.SVShellDisplay = Object.freeze({ page: () => page, prefs: () => Object.assign({}, prefs) });
})();
