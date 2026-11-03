/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TEK YÖNLÜ GÖÇ (#905). v4'te her sahne bir katman listesidir, klasik yol kalkıyor.
   Ayarlar ve kayıtlı sahneler bir kez çevrilir; ikinci kez çalışınca hiçbir şey
   değişmez. Çeviri ekranda görüneni korur: ölçüm `npm run golden -- --software`.

   Yığını kapalı olup içinde eski katman duran sahnede görünen klasik içeriktir,
   eski katmanlar silinmez, `layerStack.archivedLayers` altına kaldırılır.

   Dışa aktarım kuyruğu yalnız bellekte, diske yazılmıyor: çevrilecek bir şey yok. */
(function () {
  const DOC_VERSION = 4;
  const layers = () => (typeof window !== 'undefined' && window.SVLayers) || require('../visualizer/layers.js');

  function needsMigration(cfg) {
    return !!cfg && typeof cfg === 'object' && !(Number(cfg.docVersion) >= DOC_VERSION);
  }

  // Görüntü taşımayan sahne (`data: {}`) olduğu gibi kalır: uygulanınca varsayılana döner
  function hasPicture(data) {
    return !!data && typeof data === 'object'
      && (data.background !== undefined || data.visualizer !== undefined || data.layers !== undefined || data.layerStack !== undefined);
  }

  function migrateScene(data) {
    return hasPicture(data) ? layers().toStack(data) : { changed: false, archived: false };
  }

  /* cfg yerinde çevrilir. archived: eski katmanları kaldırılan sahnelerin adları. */
  function migrate(cfg) {
    const out = { changed: false, archived: [] };
    if (!needsMigration(cfg)) return out;
    const root = layers().toStack(cfg);
    if (root.archived) out.archived.push('');
    for (const s of Array.isArray(cfg.scenes) ? cfg.scenes : []) {
      if (s && migrateScene(s.data).archived) out.archived.push(String(s.name || s.id || ''));
    }
    cfg.docVersion = DOC_VERSION;
    out.changed = true;
    return out;
  }

  const api = { DOC_VERSION, needsMigration, migrate, migrateScene };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVMigrateV4 = api;
})();
