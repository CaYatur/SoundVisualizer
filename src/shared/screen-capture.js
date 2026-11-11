/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Ekran kaynağı — hangi ortamın yakalayabileceği.

   Saf modül: ana süreç gerçek ortamı verir, testler sahte ortam verir.
   Burada yakalama yok; izin reddi yakalama anında `permission` olur.

   win32 ve darwin aynı masaüstü yakalama yolunu kullanır. darwin'de
   işletim sistemi ekran kaydını reddedebilir; o ret burada "destek yok"
   değildir, yakalama başarısız olunca ayrıca bildirilir.

   linux yalnız bir X11 ekranı varken: DISPLAY dolu ya da oturum türü x11.
   DISPLAY'siz bir Wayland oturumu desteklenmez; çalışıyormuş gibi
   davranılmaz. Başka bir platform da desteklenmez.
 */
(function () {
  function filled(v) {
    return v != null && String(v).trim() !== '';
  }

  /* { platform, display, session, wayland } -> { ok, reason? }
     reason: 'wayland' | 'platform' | 'permission' */
  function support(env) {
    const e = env || {};
    const platform = e.platform;
    if (platform === 'win32' || platform === 'darwin') return { ok: true };
    if (platform !== 'linux') return { ok: false, reason: 'platform' };
    const session = e.session == null ? '' : String(e.session).trim().toLowerCase();
    if (filled(e.display) || session === 'x11') return { ok: true };
    return { ok: false, reason: 'wayland' };
  }

  function faultText(reason) {
    if (reason === 'wayland') {
      return 'Bu oturum Wayland ve X11 ekranı yok. Ekran yakalama yalnız X11 ekranında çalışır.';
    }
    if (reason === 'permission') {
      return 'Ekran kaydı izni verilmedi. Sistem ayarlarından izin verin.';
    }
    return 'Bu ortamda ekran yakalama çalışmıyor.';
  }

  const api = { support, faultText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVScreenCapture = api;
})();
