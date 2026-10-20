/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* YAPILANDIRMANIN BÖLÜMLERİ: sahne, gösteri, kurulum (#540).

   Yedek makine (yedeklilik) birincinin GÖRÜNTÜSÜNÜ ve GÖSTERİSİNİ alır,
   KURULUMUNU asla: ses aygıtı, ekranlar, bağlantı noktaları, ışıklar,
   haritalama, dışa aktarım ve MCP her makinenin kendisine ait. Yanlış bir
   anahtar yedeğin ekranını, ses aygıtını ya da ağ ayarını bozardı; bu yüzden
   liste açık ve tek yerde.

   SCENE — kaydedilen sahnenin anahtarları (admin.js, control.js, main.js ve
   mcp.js'teki SCENE_KEYS ile aynı; test eşitliği denetliyor).
   LIVE — o an ekrandaki görüntü: sahne + ana parlaklık, çalan parça kartı,
   dinamik tema, karartma ve etkin sahne kimliği.
   SHOW — gösterinin geri kalanı: kayıtlı sahneler, Studio presetleri, zaman
   çizelgesi, Clip Deck, Otomatik VJ ve MilkDrop kütüphanesinin puan/etiketleri.
   Geri kalan her şey KURULUM sayılır ve aktarılmaz. */
(function () {
  const SCENE = [
    'background', 'visualizer', 'layers', 'layerStack', 'layerGroups', 'crossfade',
    'geometry', 'postfx', 'logo', 'images', 'media', 'text', 'modulation',
    'transition', 'custom', 'milkdrop', 'feedback',
  ];
  const LIVE = SCENE.concat(['master', 'nowplaying', 'dynamicTheme', 'isBlackout', '_activeSceneId']);
  const SHOW = ['scenes', 'userPresets', 'timeline', 'clipdeck', 'autovj', 'milkdropLibrary'];
  const REPLICATED = LIVE.concat(SHOW);

  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  // Yalnız verilen anahtarlar, derin kopya; yoksa alan yok
  function pick(cfg, keys) {
    const out = {};
    if (!cfg || typeof cfg !== 'object') return out;
    for (const k of keys) if (cfg[k] !== undefined) out[k] = clone(cfg[k]);
    return out;
  }

  /* Gelen parçayı hedefe yazar: yalnız izinli anahtarlar, kurulum hiç
     değişmez. Değişen anahtarları döndürür. */
  function apply(target, part, keys) {
    const allow = new Set(keys || REPLICATED);
    const changed = [];
    if (!target || !part || typeof part !== 'object') return changed;
    for (const k of Object.keys(part)) {
      if (!allow.has(k)) continue;
      const v = clone(part[k]);
      if (v === undefined && !Object.prototype.hasOwnProperty.call(target, k)) continue;
      if (JSON.stringify(target[k]) === JSON.stringify(v)) continue;
      if (v === undefined) delete target[k]; else target[k] = v;
      changed.push(k);
    }
    return changed;
  }

  const api = { SCENE, LIVE, SHOW, REPLICATED, pick, apply };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVShowKeys = api;
})();
