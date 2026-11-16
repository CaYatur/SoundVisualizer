/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* AYAR DOSYALARININ BİÇİMİ, Android (docs/android/PLAN.md 2.2).

   Masaüstündeki düzenin aynısı (src/main/settings-store.js): settings.json
   ayarları, scenes.json sahneleri, library.json MilkDrop kütüphanesini tutar;
   bellekteki yapılandırma yine tek nesne. Böylece bilgisayardan alınan
   dosyalar olduğu gibi açılır, telefonda yazılanlar da bilgisayarda.

   Okuma sırası masaüstüyle aynı: çöz (BOM ayıkla, eski `audio.source`'u
   çevir), parçaları ekle, v4 göçü, artık `postfx` anahtarlarını at. Göç
   çağıranın işi (window.SVMigrateV4 sayfanın katman kodunu istiyor, bu dosya
   ondan önce yükleniyor). android/js-tests/profile-store.test.js her adımı
   masaüstündeki karşılığıyla aynı girdide karşılaştırıyor.

   Kayıt birleştiriliyor (masaüstü #621/#695): kaydırıcı sürüklenirken her
   değişiklik dosyaya gitmez; son değişiklikten 300 ms sonra, ama ilk
   bekleyenden en geç 2 sn sonra yazılır. Değişmeyen parça ne metne çevrilir
   ne kanaldan geçer: 600 KB'lık bir sahne listesi her kaydırıcı hareketinde
   uygulamaya taşınmaz. */
(function () {
  const PARTS = [
    { key: 'scenes', file: 'scenes.json' },
    { key: 'milkdropLibrary', file: 'library.json' },
  ];
  const MAIN = 'settings.json';
  const FILES = [MAIN].concat(PARTS.map((p) => p.file));
  const V3_BACKUP = 'settings.v3-backup.json';
  const BROKEN = 'settings.broken.json';
  // İçe aktarmadan önceki hâl (ProfileNames.kt BEFORE_IMPORT)
  const BEFORE_IMPORT = FILES.map((n) => n.replace('.json', '.before-import.json'));

  /* MASAÜSTÜ TAM YEDEĞİ (src/main/full-backup.js openBackup): tür, biçim ve ayar
     nesnesi aynı kurallarla denetlenir. */
  const BACKUP_TYPE = 'cayadev-visualizer-backup';
  const BACKUP_FORMAT = 1;
  const PRESET_ENTRY = /^presets\/([A-Za-z0-9_-]{1,80})\.json$/;
  const TEXTURE_ENTRY = /^textures\/\d{1,6}-[a-z0-9_.-]{1,60}$/;
  const TEXTURE_EXT = /\.(jpe?g|png|gif|bmp|webp)$/i;
  // full-backup.js plainName + portableName
  const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
  function portableName(n) {
    const plain = typeof n === 'string' && n.length > 0 && n.length <= 200 && !/[\\/:\0]/.test(n) && n !== '.' && n !== '..';
    return plain && !/[<>"|?*\u0000-\u001f]/.test(n) && !/[. ]$/.test(n) && !RESERVED.test(n);
  }
  const SAVE_DELAY_MS = 300;
  const SAVE_MAX_WAIT_MS = 2000;

  // Boş liste ve sıfır değerli kütüphane "dolu" sayılmaz (settings-store.js filled)
  function filled(v) {
    if (Array.isArray(v)) return v.length > 0;
    if (v && typeof v === 'object') return Object.values(v).some(filled);
    return !!v;
  }

  const stripBom = (t) => String(t).replace(/^﻿/, '');

  /* settings.json (SettingsGuard.parse): Not Defteri'nde kaydedilen dosyanın
     BOM'u JSON.parse'ı patlatmasın; v3 öncesi tek kaynak listeye çevrilir. */
  function parseSettings(text) {
    const s = JSON.parse(stripBom(text));
    if (s && s.audio && s.audio.source && !s.audio.sources) s.audio.sources = [s.audio.source];
    return s;
  }

  /* Ayara parçaları ekler. Bozuk ya da olmayan parça yok sayılır; settings.json'da
     dolu sahne ya da kütüphane varsa (v3 dosyası) o kullanılır. */
  function merge(cfg, texts) {
    if (!cfg || typeof cfg !== 'object') return cfg;
    for (const p of PARTS) {
      if (filled(cfg[p.key])) continue;
      const t = texts && texts[p.file];
      if (t == null) continue;
      let part;
      try { part = JSON.parse(stripBom(t)); } catch (e) { continue; }
      if (part !== undefined) cfg[p.key] = part;
    }
    return cfg;
  }

  /* MCP'nin eski sürümlerinin bıraktığı, hiç çizilmeyen layers[].settings.postfx
     (#768, src/shared/mcp.js dropStrayLayerPostfx). Atılan katman kimlikleri döner. */
  function dropStrayLayerPostfx(cfg) {
    const cleaned = [];
    (Array.isArray(cfg && cfg.layers) ? cfg.layers : []).forEach((l) => {
      if (l && l.settings && typeof l.settings === 'object' && Object.prototype.hasOwnProperty.call(l.settings, 'postfx')) {
        delete l.settings.postfx;
        cleaned.push(l.id || null);
      }
    });
    return cleaned;
  }

  /* Okunan dosyalardan yapılandırma. texts: ad → metin (yoksa null).
     migrate(cfg): v4 göçü (çağıran verir). Dönen:
       { cfg: null, broken: false }  — settings.json yok (ilk açılış)
       { cfg: null, broken: true }   — settings.json bozuk: dosya ÜSTÜNE YAZILMADAN önce kopyalanmalı
       { cfg, migrated, cleaned } */
  function load(texts, migrate) {
    const main = texts && texts[MAIN];
    if (main == null) return { cfg: null, broken: false };
    let cfg;
    try { cfg = parseSettings(main); } catch (e) { return { cfg: null, broken: true }; }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { cfg: null, broken: true };
    merge(cfg, texts);
    const migrated = typeof migrate === 'function' ? !!migrate(cfg) : false;
    const cleaned = dropStrayLayerPostfx(cfg);
    return { cfg, migrated, cleaned };
  }

  /* backup.json metni → { settings, presetIds, summary } ya da { error }. summary
     masaüstündeki inspect() ile aynı alanlar (arşiv içi boyut gerektiren videoBytes hariç).
     error: NOT_BACKUP (bu bir tam yedek değil) | FORMAT (daha yeni bir sürümün yedeği). */
  function readBackup(text) {
    let meta;
    try { meta = JSON.parse(stripBom(text)); } catch (e) { return { error: 'NOT_BACKUP' }; }
    if (!meta || meta.type !== BACKUP_TYPE) return { error: 'NOT_BACKUP' };
    if (meta.format !== BACKUP_FORMAT) return { error: 'FORMAT' };
    if (!meta.settings || typeof meta.settings !== 'object' || Array.isArray(meta.settings)) return { error: 'NOT_BACKUP' };
    const ids = [];
    for (const name of Array.isArray(meta.presets) ? meta.presets : []) {
      const m = PRESET_ENTRY.exec(String(name));
      if (m && ids.indexOf(m[1]) < 0) ids.push(m[1]);
    }
    /* Dokular (full-backup.js restore): özgün ad her sistemde yazılabilir ve görsel
       uzantılı olmalı, arşiv içi yol masaüstünün `textures/<sıra>-<slug>` biçiminde. */
    const textures = [];
    for (const t of Array.isArray(meta.textures) ? meta.textures : []) {
      if (!t || !portableName(t.name) || !TEXTURE_EXT.test(t.name) || !TEXTURE_ENTRY.test(String(t.path))) continue;
      textures.push({ name: t.name, path: t.path });
    }
    const libs = meta.libraries && typeof meta.libraries === 'object' ? meta.libraries : {};
    const n = (k) => (libs[k] && Array.isArray(libs[k].items) ? libs[k].items.length : 0);
    return {
      settings: meta.settings,
      presetIds: ids,
      textures,
      summary: {
        appVersion: String(meta.appVersion || ''),
        platform: String(meta.platform || ''),
        createdAt: String(meta.createdAt || ''),
        scenes: Array.isArray(meta.settings.scenes) ? meta.settings.scenes.length : 0,
        colorPresets: Array.isArray(meta.settings.userPresets) ? meta.settings.userPresets.length : 0,
        presets: Array.isArray(meta.presets) ? meta.presets.length : 0,
        logos: n('logos'),
        lyrics: n('lyrics'),
        videos: n('media') + (Array.isArray(meta.media) ? meta.media.length : 0),
        textures: Array.isArray(meta.textures) ? meta.textures.length : 0,
        videosLeftOut: Number(meta.videosLeftOut) || 0,
      },
    };
  }

  /* Kaydedici. write(files): ad → metin; Promise döner (uygulamaya yazdırır).
     seed: okunan dosyaların metni — aynı metin yeniden yazılmaz. */
  function createSaver(opts) {
    const o = opts || {};
    const write = o.write;
    const delay = o.delay != null ? o.delay : SAVE_DELAY_MS;
    const maxWait = o.maxWait != null ? o.maxWait : SAVE_MAX_WAIT_MS;
    const clock = o.now || (() => Date.now());
    const setT = o.setTimeout || ((f, ms) => setTimeout(f, ms));
    const clearT = o.clearTimeout || ((t) => clearTimeout(t));
    const cache = new Map(); // parça anahtarı -> { ref, text }
    const last = new Map(); // dosya -> son yazılan (ya da okunan) metin
    if (o.seed) for (const n of FILES) if (typeof o.seed[n] === 'string') last.set(n, o.seed[n]);
    let queued = null;
    let timer = null;
    let firstAt = 0;
    let writing = Promise.resolve();
    const stats = { saves: 0, writes: 0, files: 0, bytes: 0, skipped: 0, errors: 0 };

    /* Yapılandırma → dosya başına metin (settings-store.js serialize). Parça yoksa
       o dosya listede yok: eksik bir yapılandırma diskteki sahneleri silmesin. */
    function serialize(cfg) {
      const rest = Object.assign({}, cfg);
      const out = {};
      for (const p of PARTS) {
        const value = rest[p.key];
        delete rest[p.key];
        if (value === undefined) continue;
        const c = cache.get(p.key);
        if (c && c.ref === value) out[p.file] = c.text;
        else {
          const text = JSON.stringify(value);
          cache.set(p.key, { ref: value, text });
          out[p.file] = text;
        }
      }
      out[MAIN] = JSON.stringify(rest, null, 2);
      return out;
    }

    function flush() {
      const cfg = queued;
      if (timer) clearT(timer);
      timer = null;
      queued = null;
      if (!cfg) return writing;
      const texts = serialize(cfg);
      const files = {};
      let n = 0;
      for (const name of Object.keys(texts)) {
        if (last.get(name) === texts[name]) { stats.skipped++; continue; }
        files[name] = texts[name];
        n++;
      }
      if (!n) return writing;
      /* Yazılmış sayılır; yazım başarısız olursa unutulur ve bir sonraki kayıt
         o dosyaları yeniden yazar. Yazımlar sırayla: eskisi yenisinin üstüne düşmez. */
      for (const name of Object.keys(files)) last.set(name, files[name]);
      writing = writing.then(() => write(files)).then(() => {
        for (const name of Object.keys(files)) stats.bytes += files[name].length;
        stats.writes++;
        stats.files += n;
      }, (e) => {
        for (const name of Object.keys(files)) if (last.get(name) === files[name]) last.delete(name);
        stats.errors++;
        stats.lastError = String((e && e.message) || e);
      });
      return writing;
    }

    function save(cfg) {
      if (!cfg || typeof cfg !== 'object') return;
      stats.saves++;
      queued = cfg;
      const now = clock();
      if (timer) clearT(timer);
      else firstAt = now;
      const wait = Math.max(0, Math.min(delay, firstAt + maxWait - now));
      timer = setT(flush, wait);
    }

    return { save, flush, serialize, pending: () => !!queued, stats };
  }

  const api = { PARTS, FILES, MAIN, V3_BACKUP, BROKEN, BEFORE_IMPORT, BACKUP_TYPE, BACKUP_FORMAT, SAVE_DELAY_MS, SAVE_MAX_WAIT_MS, filled, parseSettings, merge, dropStrayLayerPostfx, load, readBackup, portableName, createSaver };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVProfileStore = api;
})();
