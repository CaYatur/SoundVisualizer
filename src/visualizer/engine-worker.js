/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Motoru Worker'da açan başlatıcı (#905). Hangi betiklerin yükleneceğini sayfa söylüyor:
   liste sayfanın kendi <script> sırası, ikinci bir liste tutulmuyor (engine-bridge.js). */
importScripts('engine-env.js');

self.addEventListener('message', (e) => {
  const m = e.data;
  if (!m || m.__sv !== 'boot') return;
  const t0 = performance.now();
  try {
    self.__SV_LOCALE = m.locale;
    Object.assign(self, m.globals || {});
    importScripts(...m.scripts);
    self.postMessage({ __sv: 'booted', ms: performance.now() - t0 });
  } catch (err) {
    self.postMessage({ __sv: 'booted', error: String(err && err.stack ? err.stack : err) });
  }
});
