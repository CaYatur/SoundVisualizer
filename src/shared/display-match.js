/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Kayıtlı ekran seçimini bağlı ekranlara oturtur.

   Electron'un ekran kimliği kalıcı değil: Windows, ekran yeniden takılınca,
   sürücü güncellenince ya da bağlantı noktası değişince başka bir sayı
   veriyor. Yalnız kimliğe bakınca kayıtlı seçim boşalıyor ve
   "Görselleştirmeyi Aç" sessizce hiçbir şey yapmıyordu.

   Seçimle birlikte her ekranın izi de saklanır (konum, boyut, birincil mi).
   Kimlik bulunamazsa ekran bu izle yeniden aranır:
     1. aynı konum ve boyut,
     2. aynı boyut ve aynı birincillik, tek aday varsa,
     3. aynı boyut, tek aday varsa.
   Hiçbiri tutmazsa ve kayıtta bir seçim vardıysa birincil ekran seçilir;
   kullanıcı bir ekranda açmak istiyordu. Kayıt hiç yoksa (ilk açılış) yine
   birincil ekran. Varsayılan yapılandırmada liste boş geldiği için "bilerek
   boş" ayrı bir bayrakla (chosen) tutulur: kullanıcı kutulara dokunduysa
   ve hepsini kaldırdıysa boş liste boş kalır. */
(function () {
  function printOf(d) {
    const b = (d && d.bounds) || {};
    const s = (d && d.size) || b;
    return {
      x: Number(b.x) || 0, y: Number(b.y) || 0,
      w: Number(s.width) || 0, h: Number(s.height) || 0,
      primary: !!(d && d.isPrimary),
    };
  }

  function savedIds(saved) {
    if (!saved || typeof saved !== 'object') return null;
    if (Array.isArray(saved.ids)) {
      if (saved.ids.length) return saved.ids.map(Number);
      // Eski kayıtta liste boş ama tek kimlik dolu olabilir
      return saved.id != null ? [Number(saved.id)] : [];
    }
    if (saved.id != null) return [Number(saved.id)];
    return null;
  }

  function primaryOf(displays) {
    return displays.find((d) => d && d.isPrimary) || displays[0] || null;
  }

  function matchPrint(p, displays, taken) {
    if (!p) return null;
    const free = displays.filter((d) => d && taken.indexOf(d.id) < 0);
    const same = (d) => { const q = printOf(d); return q.w === p.w && q.h === p.h; };
    const exact = free.find((d) => { const q = printOf(d); return same(d) && q.x === p.x && q.y === p.y; });
    if (exact) return exact;
    const sized = free.filter(same);
    const prim = sized.filter((d) => printOf(d).primary === !!p.primary);
    if (prim.length === 1) return prim[0];
    if (sized.length === 1) return sized[0];
    return null;
  }

  /* { ids, changed } — changed: kayıttakinden farklı bir liste çıktı,
     çağıran yapılandırmayı güncellemeli. */
  function resolve(saved, displays) {
    const list = Array.isArray(displays) ? displays.filter(Boolean) : [];
    const want = savedIds(saved);
    const prim = primaryOf(list);
    const deliberate = !!(saved && saved.chosen === true);
    if (want === null || (!want.length && !deliberate)) return { ids: prim ? [prim.id] : [], changed: !!prim };
    if (!want.length) return { ids: [], changed: false };
    const prints = saved && saved.prints && typeof saved.prints === 'object' ? saved.prints : {};
    const out = [];
    for (const id of want) {
      if (list.some((d) => d.id === id)) {
        if (out.indexOf(id) < 0) out.push(id);
        continue;
      }
      const hit = matchPrint(prints[String(id)], list, out);
      if (hit && out.indexOf(hit.id) < 0) out.push(hit.id);
    }
    if (!out.length && prim) out.push(prim.id);
    const changed = out.length !== want.length || out.some((id, i) => id !== want[i]);
    return { ids: out, changed };
  }

  /* Seçili ekranların izi, kimlik anahtarıyla. */
  function prints(ids, displays) {
    const out = {};
    (ids || []).forEach((id) => {
      const d = (displays || []).find((x) => x && x.id === id);
      if (d) out[String(id)] = printOf(d);
    });
    return out;
  }

  const api = { resolve, prints, printOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVDisplayMatch = api;
})();
