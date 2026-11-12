/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ARAMA ANAHTARI. Uygulamadaki her arama kutusu metni bununla karşılaştırır.

   Neden gerekli: panel Türkçe yerelde `toLocaleLowerCase('tr')` kullanıyordu; bu "MIDI"yi
   "mıdı", "GIF"i "gıf" yapıyor ve "midi" yazan kullanıcı hiçbir şey bulamıyordu. Yerelsiz
   `toLowerCase()` ise "İ"yi "i" + birleşik nokta yapıyor, "istanbul" onu bulamıyor.

   fold(s): büyük/küçük harf, Türkçe I/ı/İ/i ve aksan farkı yok ("sarki sozu" = "Şarkı Sözü",
   "midi" = "MIDI"), boşluklar tek boşluk. Görünen metin değişmez; yalnız eşleştirme bununla.

   match(hay, q): q'nun hay içinde geçtiği yer ya da -1; ikisi de fold edilir.
   wordStart(hay, idx): eşleşme bir sözcüğün başında mı ("ndi", "Kendi" içinde değil). */
(function () {
  // Birleşik işaretler (aksan); kaçış yerine koddan kuruluyor
  const MARKS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
  const DOTLESS = new RegExp(String.fromCharCode(0x131), 'g');

  function fold(s) {
    return String(s == null ? '' : s)
      .normalize('NFD')
      .replace(MARKS, '')
      .toLowerCase()
      .replace(DOTLESS, 'i')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function match(hay, q) {
    const f = fold(q);
    if (!f) return 0;
    return fold(hay).indexOf(f);
  }

  // Harf ya da rakam olmayan her şey sözcük ayırır
  const WORD = /[a-z0-9]/;
  function wordStart(folded, idx) {
    return idx <= 0 || !WORD.test(folded.charAt(idx - 1));
  }

  /* Sözcük başına bakan arama: önce sözcük başındaki eşleşme, yoksa herhangi biri.
     Dönen: { at, start } ya da null. `folded` ve `q` fold edilmiş olmalı. */
  function find(folded, q) {
    if (!q) return null;
    let first = -1;
    let i = folded.indexOf(q);
    while (i >= 0) {
      if (wordStart(folded, i)) return { at: i, start: true };
      if (first < 0) first = i;
      i = folded.indexOf(q, i + 1);
    }
    return first < 0 ? null : { at: first, start: false };
  }

  const api = { fold, match, wordStart, find };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVText = api;
})();
