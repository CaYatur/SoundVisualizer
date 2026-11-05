/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Hazır söz sağlayıcı şablonları.
 *
 * Varsayılan liste boş kalır (bağımsızlık: yeni kurulum ağa çıkmaz).
 * Kullanıcı "LRCLIB Ekle" ile bu şablonu listeye ekler; zorunlu değildir. */
(function () {
  const LRCLIB_URL =
    'https://lrclib.net/api/get?artist_name={artist}&track_name={title}&album_name={album}&duration={duration}';

  const LRCLIB_PRESET = Object.freeze({
    enabled: true,
    name: 'LRCLIB',
    url: LRCLIB_URL,
    format: 'json',
    path: 'syncedLyrics',
  });

  function normName(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
  function normUrl(v) { return String(v == null ? '' : v).trim(); }

  /* Aynı ad (büyük/küçük harf duyarsız) veya aynı URL varsa tekrar ekleme. */
  function providerExists(providers, candidate) {
    const list = Array.isArray(providers) ? providers : [];
    const name = normName(candidate && candidate.name);
    const url = normUrl(candidate && candidate.url);
    return list.some((p) => {
      if (name && normName(p && p.name) === name) return true;
      if (url && normUrl(p && p.url) === url) return true;
      return false;
    });
  }

  /* Listeye LRCLIB şablonunu ekler. Dönüş: { added, providers }. */
  function addLrclibPreset(providers) {
    const list = Array.isArray(providers) ? providers : [];
    if (providerExists(list, LRCLIB_PRESET)) return { added: false, providers: list };
    list.push({
      enabled: LRCLIB_PRESET.enabled,
      name: LRCLIB_PRESET.name,
      url: LRCLIB_PRESET.url,
      format: LRCLIB_PRESET.format,
      path: LRCLIB_PRESET.path,
    });
    return { added: true, providers: list };
  }

  const api = {
    LRCLIB_PRESET,
    LRCLIB_URL,
    providerExists,
    addLrclibPreset,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVLyricsProviders = api;
})();
