/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* "PANELE DÖNMEK İÇİN ESC" notunun kararı.

   Tek ekranlı bir bilgisayarda "Görselleştirmeyi Aç" paneli tamamen örtüyor;
   nasıl çıkılacağını söyleyen tek ipucu panelin alt satırındaydı, yani artık
   görünmüyordu. Not yalnız çıkış penceresi panelle AYNI ekrandayken çıkar:
   projektörde ya da ikinci ekranda (panel görünürken) seyirci görmesin. ESC
   kilitliyken (Kaza Koruması) not var olmayan bir yolu söylerdi; otomasyon
   koşularında (öz test, ekran görüntüsü) da yok. Pencereler ayar değişince
   yeniden kurulabildiği için ekran başına en çok `everyMs`'de bir.

   Ayrı dosyada: main.js Electron olmadan yüklenemiyor, karar burada sınanıyor. */

function create(opts) {
  const o = opts || {};
  const everyMs = o.everyMs > 0 ? o.everyMs : 60000;
  const last = new Map();
  /* outId / panelId: ekran kimlikleri (screen.getDisplayMatching). Panel yoksa
     ya da ekranı bilinmiyorsa not yok: hangi durumda olduğumuzu bilmiyoruz. */
  function wanted(outId, panelId, now, flags) {
    const f = flags || {};
    if (f.automation || f.escLocked) return false;
    if (outId == null || panelId == null || String(outId) !== String(panelId)) return false;
    const key = String(outId);
    const t = Number(now) || 0;
    if (last.has(key) && t - last.get(key) < everyMs) return false;
    last.set(key, t);
    return true;
  }
  return { wanted };
}

module.exports = { create };
