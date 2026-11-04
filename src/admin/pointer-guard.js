/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Sağ ve orta tuş kaydırıcılara dokunmasın (#957). Windows'ta katman
   satırına sağ tıklamak saydamlık kaydırıcısını tıklanan yere çekiyordu.
   Uygulama genelinde: yakalama aşamasında, sol olmayan tuşla basılan her
   kaydırıcıda (input[type=range] ve özel kaydırıcılar) varsayılan iş
   engelleniyor. Sağ tık menüsü (contextmenu) yine açılıyor. */
(function () {
  const SLIDER_SEL = 'input[type="range"], .sv-op, .sv-fader, [role="slider"]';
  function isSlider(t) {
    return !!(t && typeof t.closest === 'function' && t.closest(SLIDER_SEL));
  }
  function shouldBlock(e) {
    return !!e && e.button != null && e.button !== 0 && isSlider(e.target);
  }
  function guard(e) {
    if (shouldBlock(e)) e.preventDefault();
  }
  function install(doc) {
    if (!doc || typeof doc.addEventListener !== 'function') return false;
    ['pointerdown', 'mousedown', 'auxclick'].forEach((t) => doc.addEventListener(t, guard, true));
    return true;
  }
  const api = { SLIDER_SEL, isSlider, shouldBlock, guard, install };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.SVPointerGuard = api;
    if (typeof document !== 'undefined') install(document);
  }
})();
