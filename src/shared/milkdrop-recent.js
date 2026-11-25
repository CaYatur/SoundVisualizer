/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* MilkDrop kitaplığı: SON KULLANILAN (#445).
 *
 * `milkdropLibrary.used`: preset kimliği → kitaplıktan elle seçildiği an (ms). Yalnız
 * kullanıcının seçimi yazılıyor; otomatik geçiş her presette ayarları yeniden yazmasın.
 * En yeni MAX_USED kayıt tutuluyor. Alan yoksa (eski ayar) boş sayılıyor ve liste eskisi
 * gibi görünüyor.
 *
 * Yalnız panel yüklüyor: motor sayfaları (ve mod resimlerinin anahtarı) bu dosyayı görmüyor.
 */
(function () {
  const MAX_USED = 200;

  function usedOf(lib) {
    const u = lib && lib.used;
    return u && typeof u === 'object' && !Array.isArray(u) ? u : {};
  }

  function withUsed(lib, id, now) {
    const next = Object.assign({}, usedOf(lib));
    if (!id) return next;
    next[id] = Number(now) || Date.now();
    const keys = Object.keys(next).filter((k) => Number.isFinite(Number(next[k])));
    if (keys.length <= MAX_USED) return next;
    keys.sort((a, b) => next[b] - next[a]);
    const keep = {};
    for (const k of keys.slice(0, MAX_USED)) keep[k] = next[k];
    return keep;
  }

  /* Silinen presetin kaydı */
  function without(lib, id) {
    const next = Object.assign({}, usedOf(lib));
    delete next[id];
    return next;
  }

  /* Listenin sırası. 'list' (varsayılan): olduğu gibi. 'recent': kullanılanlar en yeniden
     eskiye önde, hiç kullanılmamışlar ardından kendi sıralarıyla. Liste değiştirilmiyor. */
  function sortList(list, mode, lib) {
    const arr = Array.isArray(list) ? list.slice() : [];
    if (mode !== 'recent') return arr;
    const u = usedOf(lib);
    const at = (p) => { const v = Number(p && u[p.id]); return Number.isFinite(v) ? v : 0; };
    return arr.map((p, i) => [p, i]).sort((a, b) => (at(b[0]) - at(a[0])) || (a[1] - b[1])).map((x) => x[0]);
  }

  const api = { MAX_USED, usedOf, withUsed, without, sortList };
  if (typeof window !== 'undefined') window.SVMilkdropRecent = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
