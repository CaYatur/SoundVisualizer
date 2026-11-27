/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ZAMAN ÇİZELGESİ KLİBİNİN SÖZÜ (#1213 ek kapsam) — saf kurallar.

   Çalan Parça (#1202) zaman çizelgesinde en üstteki duyulur ses klibini
   izliyor; söz katmanı da aynısını izler. Klibin dosyası bilindiği için
   yan dosya (.lrc/.srt) ve gömülü söz HER ZAMAN aranır (yerel, ağ yok);
   önbellek ve çevrimiçi sağlayıcılar yalnız Otomatik Söz Bul açıksa.
   Bulunan söz, klibin Çalan Parça başlığı/sanatçısıyla kitaplığın BAŞINA
   konur: o dosyaya özel söz, aynı adlı başka bir kitaplık sözünden önce.
   Konum klibin yerel zamanı (çizelge zamanı - klip başı + giriş noktası),
   nowPlayingAt'in `position` alanı; canlıda ve dışa aktarmada aynı. */
(function () {
  const PREFIX = 'timeline:';

  /* Arama ayarı: açıksa kullanıcınınki aynen; kapalıysa yalnız yerel
     (yan dosya, gömülü), kullanıcı bunları ayrıca kapattıysa o da geçerli. */
  function lookupConfig(userCfg) {
    const c = userCfg && typeof userCfg === 'object' ? userCfg : {};
    if (c.enabled === true) return c;
    return {
      enabled: true,
      sidecar: c.sidecar !== false,
      embedded: c.embedded !== false,
      cache: false,
      providers: [],
    };
  }

  /* Çalan Parça durumundan (nowPlayingAt) ve arama sonucundan kitaplık öğesi. */
  function itemFor(np, res) {
    if (!np || !np.src || !res || !res.text) return null;
    return {
      id: PREFIX + String(np.src),
      name: String(np.title || ''),
      title: String(np.title || ''),
      artist: String(np.artist || ''),
      text: String(res.text),
      auto: res.source || 'timeline',
      timeline: true,
    };
  }

  /* Çizelge sözleri başta; aynı kimlik ikinci kez girmez. */
  function mergeLibrary(timelineItems, items) {
    const out = [];
    const seen = new Set();
    for (const it of [].concat(timelineItems || [], items || [])) {
      if (!it || !it.text) continue;
      const id = String(it.id || '');
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      out.push(it);
    }
    return out;
  }

  /* Canlı parça bir çizelge klibi mi (nowPlayingAt `clipId` taşır)? */
  function isTimelineLive(live) {
    return !!(live && live.has && live.clipId);
  }

  const api = { PREFIX, lookupConfig, itemFor, mergeLibrary, isTimelineLive };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVTimelineLyrics = api;
})();
