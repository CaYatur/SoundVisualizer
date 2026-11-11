/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* AYAR DEPOLARI (#905). Gerçek bir ayarın 650 KB'ının 627 KB'ı sahneler ve MilkDrop
   kütüphanesi, geri kalanı 23 KB. Tek dosyadayken her kayıt hepsini yeniden yazıyordu.
   Artık settings.json ayarları, scenes.json sahneleri, library.json kütüphaneyi tutuyor;
   bellekteki yapılandırma yine tek nesne, ayrım yalnız diskte.

   Değişmeyen parça ne metne çevrilir ne yazılır: aynı nesne geldiyse önceki metin
   kullanılır. Panel değişmeyen parçayı göndermediği için nesne gerçekten aynı kalıyor.

   Eski biçim: settings.json'da dolu sahne ya da kütüphane varsa o kullanılır (v3 dosyası
   ya da v3.1.7'de değiştirilmiş dosya). v3.1.7 parçaları görmediği için boş sahne listesi
   yazabilir; boş liste parçayı ezmez. */
const fs = require('fs');
const path = require('path');

const PARTS = [
  { key: 'scenes', file: 'scenes.json' },
  { key: 'milkdropLibrary', file: 'library.json' },
];

// Boş liste ve sıfır değerli kütüphane "dolu" sayılmaz
function filled(v) {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === 'object') return Object.values(v).some(filled);
  return !!v;
}

function parseText(buf) {
  return JSON.parse(Buffer.from(buf).toString('utf8').replace(/^﻿/, ''));
}

function create(dir, opts) {
  const F = (opts && opts.fs) || fs;
  const fileOf = (name) => path.join(dir, name);
  const mainFile = fileOf('settings.json');
  const cache = new Map(); // parça anahtarı -> { ref, text }
  const written = new Map(); // dosya -> son yazılan metin

  /* Okunan ayara parçaları ekler. Bozuk parça yok sayılır, kayıpsız yedek kullanıcıda.
     snap verilirse parçalar oradan: bekçi yapılandırmanın okunduğu içeriği öğrenmeli,
     yoksa bu kopyanın hiç görmediği bir içeriği "bizimki" sanır. */
  function merge(cfg, snap) {
    if (!cfg || typeof cfg !== 'object') return cfg;
    for (const p of PARTS) {
      if (filled(cfg[p.key])) continue;
      let part;
      try {
        part = parseText(snap ? snap[p.file] : F.readFileSync(fileOf(p.file)));
      } catch (e) {
        continue;
      }
      if (part !== undefined) cfg[p.key] = part;
    }
    return cfg;
  }

  /* Yapılandırma -> dosya başına metin. Parça yoksa o dosya listede yok: eksik bir
     yapılandırma diskteki sahneleri silmesin. */
  function serialize(cfg) {
    const rest = Object.assign({}, cfg);
    const out = {};
    for (const p of PARTS) {
      const value = rest[p.key];
      delete rest[p.key];
      if (value === undefined) continue;
      const c = cache.get(p.key);
      if (c && c.ref === value) {
        out[p.file] = c.text;
      } else {
        const text = JSON.stringify(value);
        cache.set(p.key, { ref: value, text });
        out[p.file] = text;
      }
    }
    out['settings.json'] = JSON.stringify(rest, null, 2);
    return out;
  }

  /* Parçalar önce: arada kapanırsa settings.json eski parçaları hâlâ taşıyor olur.
     wrote(dosya adı, metin): bekçi yeni içeriği bilsin. Aynı metin yeniden yazılmaz;
     ours(dosya adı) false dönerse dosyayı başkası değiştirmiş demektir, yine yazılır. */
  function write(texts, wrote, ours) {
    const names = Object.keys(texts).sort((a, b) => (a === 'settings.json') - (b === 'settings.json'));
    for (const name of names) {
      const file = fileOf(name);
      if (written.get(name) === texts[name] && F.existsSync(file) && (!ours || ours(name))) continue;
      F.writeFileSync(file, texts[name], 'utf-8');
      written.set(name, texts[name]);
      if (wrote) wrote(name, texts[name]);
    }
  }

  const files = () => ['settings.json'].concat(PARTS.map((p) => p.file));

  // Dosyaların o anki içeriği; öz test kapanışta aynen geri yazıyor
  function snapshot() {
    const snap = {};
    for (const name of files()) {
      try { snap[name] = F.readFileSync(fileOf(name)); } catch (e) { snap[name] = null; }
    }
    return snap;
  }
  function restore(snap) {
    for (const name of Object.keys(snap)) {
      const file = fileOf(name);
      if (snap[name] != null) F.writeFileSync(file, snap[name]);
      else if (name !== 'settings.json' && F.existsSync(file)) F.unlinkSync(file);
    }
  }

  return { mainFile, fileOf, files, merge, serialize, write, snapshot, restore };
}

module.exports = { PARTS, filled, create };
