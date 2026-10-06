/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
(function () {
/* Son gelen değeri tutar.
 *
 * Electron, dinleyici kurulmadan gönderilen ipcRenderer mesajını atar.
 * Görselleştirici çalan parçayı ancak yapılandırmayı istedikten sonra
 * dinliyor; ana süreç ise pencere yüklenir yüklenmez yolluyor. Müzik
 * zaten çalıyorsa o ilk örnek düşüyor ve sonraki yoklamalar aynı parçayı
 * fark saymıyor. Duraklatıp devam etmek yeni bir fark olduğu için
 * oynatıcı ancak o zaman çıkıyor.
 *
 * Aynı anda tek abone var; yenisi eskisinin yerine geçer. */
function createLateEvent() {
  let listener = null;
  let seen = false;
  let value;
  return {
    push(next) {
      seen = true;
      value = next;
      if (listener) listener(next);
    },
    subscribe(cb) {
      listener = typeof cb === 'function' ? cb : null;
      if (seen && listener) listener(value);
    },
    seen() { return seen; },
  };
}

/* Abone olduktan sonra ana süreçteki güncel örneği al.
   Bu arada canlı bir mesaj geldiyse onu ezme: o daha yeni olabilir. */
async function catchUp(live, api) {
  let seen = false;
  if (api && typeof api.onNowPlaying === 'function') {
    api.onNowPlaying((st) => {
      seen = true;
      if (live) live.state = st;
    });
  }
  if (api && typeof api.nowPlayingCurrent === 'function') {
    try {
      const cur = await api.nowPlayingCurrent();
      if (!seen && cur && cur.has && live) live.state = cur;
    } catch { /* oturum yok */ }
  }
}

const api = { createLateEvent, catchUp };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.SVLateEvent = api;
})();
