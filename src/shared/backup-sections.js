/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* YEDEK BÖLÜMLERİ: telefonun verileri parça parça dışa ve içe aktarılır.

   Arşiv masaüstünün tam yedeğiyle aynı biçim (.svbackup, src/main/full-backup.js). Ayar
   dosyasının anahtarları bölümlere ayrılır; presetler, kitaplıklar ve dokular arşivde zaten
   ayrı. Telefon yedeği seçilen bölümleri backup.json'daki `sections` alanına yazar; masaüstü
   geri yüklemesi de bu modülle yalnız o bölümleri değiştirir (src/admin/admin.js). Saf modül:
   Node'da sınanıyor (tests/full-backup.test.js). */
(function () {
  const SECTIONS = ['settings', 'scenes', 'colors', 'timeline', 'presets', 'logos', 'lyrics', 'videos', 'textures'];
  // Ayar dosyasından gelen bölümler
  const CONFIG_SECTIONS = ['settings', 'scenes', 'colors', 'timeline'];

  const schema = () => (typeof window !== 'undefined' && window.SVSchema) || require('./schema.js');
  const SCENE_EXTRA = ['scenes', '_activeSceneId', 'nowplaying', 'dynamicTheme'];
  // Biçim anahtarları her parçayla gider: göç bunlara bakıyor
  const FORMAT_KEYS = ['docVersion', 'version', 'configVersion'];

  function sectionOf(key) {
    if (FORMAT_KEYS.indexOf(key) >= 0) return null;
    if (key === 'userPresets') return 'colors';
    if (key === 'timeline') return 'timeline';
    if (key === 'milkdropLibrary') return 'presets';
    if (SCENE_EXTRA.indexOf(key) >= 0 || schema().SCENE_KEYS.indexOf(key) >= 0) return 'scenes';
    return 'settings';
  }

  /** Ayarın seçilen bölümlere ait kopyası. */
  function pickSettings(cfg, sections) {
    const on = new Set(sections || []);
    const out = {};
    for (const k of Object.keys(cfg || {})) {
      const s = sectionOf(k);
      if (s === null || on.has(s)) out[k] = cfg[k];
    }
    return out;
  }

  /* Gelen ayar seçilen bölümler kadar yazılır; seçilmeyenler telefondaki gibi kalır. Tam bir
     yedeğin bütün ayar bölümleri seçildiyse ayar yedektekiyle değişir (önceki davranış). */
  function mergeSettings(current, incoming, sections, partial) {
    const on = new Set(sections || []);
    if (!partial && CONFIG_SECTIONS.every((s) => on.has(s)) && on.has('presets')) return incoming;
    const out = Object.assign({}, current);
    for (const k of Object.keys(incoming || {})) {
      const s = sectionOf(k);
      if (s !== null && on.has(s)) out[k] = incoming[k];
    }
    return out;
  }

  /** Yedekte hangi bölümler var: { bölüm: adet }. Ayar bölümlerinde adet 1 ya da sahne sayısı. */
  function available(settings, summary) {
    const c = settings || {};
    const m = summary || {};
    const has = (s) => Object.keys(c).some((k) => sectionOf(k) === s);
    const out = {};
    if (has('settings')) out.settings = 1;
    const scenes = Array.isArray(c.scenes) ? c.scenes.length : 0;
    if (scenes || has('scenes')) out.scenes = scenes || 1;
    if (Array.isArray(c.userPresets) && c.userPresets.length) out.colors = c.userPresets.length;
    if (c.timeline && typeof c.timeline === 'object') out.timeline = 1;
    for (const k of ['presets', 'logos', 'lyrics', 'videos', 'textures']) if (m[k] > 0) out[k] = m[k];
    return out;
  }

  /* Telefonun kendi tercihleri (yerel depo). Geçiş bayrakları taşınmaz; sahne resimleri sahnelerle gider. */
  const LOCAL_SKIP = /^sv-(theme-default|perf-default)/;
  const LOCAL_THUMB = /^sv-scene-thumb:/;
  const LOCAL_MAX = 8 * 1024 * 1024;
  function localFor(key, sections) {
    const on = new Set(sections || []);
    if (!/^sv-/.test(key) || LOCAL_SKIP.test(key)) return false;
    return LOCAL_THUMB.test(key) ? on.has('scenes') : on.has('settings');
  }
  function pickLocal(entries, sections) {
    const out = {};
    let size = 0;
    for (const [k, v] of entries) {
      if (!localFor(k, sections) || typeof v !== 'string') continue;
      size += k.length + v.length;
      if (size > LOCAL_MAX) break;
      out[k] = v;
    }
    return out;
  }

  const api = { SECTIONS, CONFIG_SECTIONS, sectionOf, pickSettings, mergeSettings, available, localFor, pickLocal };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVBackupSections = api;
})();
