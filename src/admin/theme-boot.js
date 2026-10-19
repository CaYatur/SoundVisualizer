/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ARAYÜZ TEMASINI UYGULA (#770).

   <head> içinde, gövde çizilmeden önce çalışır: ana süreç seçili temayı
   adresin `uiTheme` sorgusuyla verir, böylece aydınlık bir tema koyu bir
   karenin ardından gelmez. Ayarlar yüklenince admin.js `SVUiTheme.set`
   ile ayardaki değeri uygular; adres de güncellenir ki dil değişikliğinin
   yeniden yüklemesi eski temayla açılmasın.

   "Cihaz varsayılanı" işletim sisteminin tercihini `prefers-color-scheme`
   ile okur ve değişince canlı izler. `nativeTheme.themeSource`
   değiştirilmez: o, görselleştirici dahil her pencerenin tercihini
   değiştirirdi.

   Tuvale çizen paneller (zaman çizelgesi, eşleme) rengi buradan alır ve
   `onChange` ile yeniden çizer. */
(() => {
  const T = window.SVUiThemes;
  if (!T) return;
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const listeners = new Set();
  let choice = T.DEFAULT_CHOICE;
  let theme = null;

  function prefersDark() {
    return mq ? mq.matches : true;
  }

  function rememberInUrl() {
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get('uiTheme') === choice) return;
      u.searchParams.set('uiTheme', choice);
      window.history.replaceState(window.history.state, '', u.toString());
    } catch { /* file: adresinde geçmiş yazılamıyorsa ilk çizim yine ayardan */ }
  }

  function set(id) {
    choice = T.normalizeId(id);
    const prev = theme ? theme.id : null;
    theme = T.apply(document, choice, prefersDark());
    rememberInUrl();
    if (prev !== null && prev !== theme.id) {
      listeners.forEach((fn) => { try { fn(theme); } catch (e) { console.error('[theme]', e); } });
    }
    return theme;
  }

  // Değişkenin değeri: '#rrggbb' ya da 'rgba(...)'
  function color(name) {
    const t = theme || T.resolve(choice, prefersDark());
    return t.tokens[name];
  }

  // Değişkeni saydamlıkla: kanal ('255 255 255') ya da renk değişkeni
  function alpha(name, a) {
    const c = T.parseColor(color(name));
    if (!c) return 'transparent';
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  if (mq) {
    const onScheme = () => { if (choice === T.SYSTEM_ID) set(choice); };
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onScheme);
    else if (typeof mq.addListener === 'function') mq.addListener(onScheme);
  }

  let initial = null;
  try { initial = new URLSearchParams(window.location.search).get('uiTheme'); } catch { initial = null; }
  set(initial || T.DEFAULT_CHOICE);

  window.SVUiTheme = {
    set,
    choice: () => choice,
    current: () => theme,
    color,
    alpha,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();
