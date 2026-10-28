/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* PANELİN BOYUTU (erişilebilirlik).

   `ui.scale` panelin yazılarını ve denetimlerini birlikte büyütür. Ana
   süreç bunu panel ve köprü penceresinin yakınlaştırmasına uygular
   (`webContents.setZoomFactor`); düzen Chromium'un kendisinde ölçeklenir,
   tuval tıklamaları ve açılır menülerin konumu doğru kalır. Görselleştirici,
   dışa aktarma ve yayın pencereleri etkilenmez.

   Ctrl + / Ctrl − / Ctrl 0 (macOS'ta Cmd) bir sonraki adıma geçer; adımlar
   paneldeki seçenekle aynı. Elle yazılmış bir değer en yakın adıma oturur. */
(function () {
  const STEPS = [0.9, 1, 1.1, 1.25, 1.5];
  const DEFAULT = 1;

  function normalize(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT;
    let best = DEFAULT;
    STEPS.forEach((s) => { if (Math.abs(s - n) < Math.abs(best - n)) best = s; });
    return best;
  }

  // dir: +1 büyüt, -1 küçült, 0 varsayılana dön
  function step(v, dir) {
    if (dir === 0) return DEFAULT;
    const i = STEPS.indexOf(normalize(v));
    return STEPS[Math.max(0, Math.min(STEPS.length - 1, i + (dir > 0 ? 1 : -1)))];
  }

  /* Electron `before-input-event` girdisinden yön: +1, -1, 0 ya da null.
     `key` klavye düzenine göre gelir (Türkçe Q'da + kendi tuşunda), `code`
     sayısal tuş takımı ve ABD düzenindeki = tuşu için. */
  function zoomKey(input) {
    if (!input || input.type !== 'keyDown' || input.alt) return null;
    if (!(input.control || input.meta)) return null;
    const k = input.key;
    const c = input.code;
    if (k === '+' || k === '=' || c === 'NumpadAdd' || c === 'Equal') return 1;
    if (k === '-' || k === '_' || c === 'NumpadSubtract' || c === 'Minus') return -1;
    if (k === '0' || c === 'Numpad0' || c === 'Digit0') return 0;
    return null;
  }

  const api = { STEPS, DEFAULT, normalize, step, zoomKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVUiScale = api;
})();
