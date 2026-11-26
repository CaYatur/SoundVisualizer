/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TELEFON ↔ BİLGİSAYAR VİDEO BAŞVURUSU (docs/PHONE-LINK.md "Videos").

   Ayar iki makinede ortak ama dosya yolu ortak değil: PC'nin `sv-media://local/C%3A...`
   adresi telefonda, telefonun `https://appassets.androidplatform.net/...` adresi PC'de
   açılmaz. Eskiden iki taraf da birbirinin adresini olduğu gibi yazıyordu: seçim görünüyor,
   video çizilmiyordu. Ortak dil PC'nin video kitaplığının kimliği (`libraryId`):

     - Telefondan PC'ye: telefon videoyu file.* ile yollar (kitaplığa girer, kimlik döner) ve
       katmana `libraryId` ile kendi adresini yazar. `rewritePatch` o kimliği PC'nin kendi
       adresine çevirir; telefonun adresi PC'nin ayarına hiç girmez.
     - PC'den telefona: `media.fetch` kitaplık kimliğiyle (ya da ayarda zaten duran video
       adresiyle) dosyayı parça parça verir; telefon kendi kitaplığına yazar ve kendi
       adresiyle çizer.

   Kurallar: yalnız kitaplıktaki ya da şimdiki ayarda video olarak duran dosya okunur (yol
   telefondan GELMEZ), yalnız video uzantıları, en çok 512 MB, parça en çok 256 KB. */

const fs = require('fs');
const path = require('path');

const CHUNK_MAX = 256 * 1024;
const SIZE_MAX = 512 * 1024 * 1024;
const VIDEO_EXT = ['.mp4', '.m4v', '.webm', '.mkv', '.mov', '.avi'];
// Telefonun kendi motorunun adresleri (WebView varlık alanı, içerik sağlayıcı)
const PHONE_URL = /^(?:https:\/\/appassets\.androidplatform\.net\/|content:\/\/)/i;
const MAX_DEPTH = 40;

function err(code) { return Object.assign(new Error(code), { code }); }

/* Ayardaki video başvuruları: medya ayarının dosyası (source 'file') ve video klibinin
   kaynağı. Sahneler ve çizelge dahil bütün ağaç. */
function videoRefs(cfg) {
  const out = new Set();
  const walk = (v, depth) => {
    if (depth > MAX_DEPTH || v == null || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (typeof v.file === 'string' && v.file && (v.source === 'file' || v.fileName !== undefined)) out.add(v.file);
    if (v.type === 'video' && typeof v.ref === 'string' && v.ref) out.add(v.ref);
    for (const k of Object.keys(v)) walk(v[k], depth + 1);
  };
  walk(cfg, 0);
  return out;
}

function createLinkMedia(opts) {
  const o = opts || {};
  const library = o.library; // media-library.js
  const libDir = typeof o.libDir === 'function' ? o.libDir : () => o.libDir;
  const mediaUrl = o.mediaUrl; // src/shared/media-url.js
  const fsx = o.fs || fs;

  /* Kitaplık kimliği → { file, size, name } ya da null. */
  function libraryFile(id) {
    if (typeof id !== 'string' || !id || !library) return null;
    const info = library.fileInfo(libDir(), id);
    if (!info || !info.file) return null;
    return { file: info.file, size: info.size, name: info.name || path.basename(info.file), id };
  }

  /* Ayardaki video adresi → diskteki dosya. Yalnız sv-media adresi ya da mutlak yol. */
  function refFile(ref) {
    const s = String(ref || '');
    if (!s || PHONE_URL.test(s) || /^(?:https?|data|blob):/i.test(s)) return null;
    const p = mediaUrl && mediaUrl.fromMediaUrl ? mediaUrl.fromMediaUrl(s) : s;
    if (!p || !path.isAbsolute(p)) return null;
    return p;
  }

  /* media.fetch { id } | { file }, at → { id, name, size, at, data, done }.
     `file` yalnız şimdiki ayarda video olarak duran bir adres olabilir. */
  function fetch(args, cfg) {
    const a = args || {};
    let src = null;
    if (typeof a.id === 'string' && a.id) src = libraryFile(a.id);
    else if (typeof a.file === 'string' && a.file) {
      if (!videoRefs(cfg || {}).has(a.file)) throw err('not-allowed');
      const p = refFile(a.file);
      if (p) src = { file: p, name: path.basename(p), id: '' };
    } else throw err('bad-args');
    if (!src) throw err('no-file');
    if (VIDEO_EXT.indexOf(path.extname(src.file).toLowerCase()) < 0) throw err('type');
    let st;
    try { st = fsx.statSync(src.file); } catch { throw err('no-file'); }
    if (!st.isFile()) throw err('no-file');
    if (st.size <= 0 || st.size > SIZE_MAX) throw err('too-big');
    const at = Number.isInteger(a.at) && a.at >= 0 ? a.at : 0;
    if (at > st.size) throw err('bad-args');
    const len = Math.min(CHUNK_MAX, st.size - at);
    const buf = Buffer.alloc(len);
    let n = 0;
    if (len > 0) {
      const fd = fsx.openSync(src.file, 'r');
      try {
        while (n < len) {
          const k = fsx.readSync(fd, buf, n, len - n, at + n);
          if (k <= 0) break;
          n += k;
        }
      } finally { fsx.closeSync(fd); }
    }
    return {
      id: src.id || '',
      name: String(src.name || '').slice(0, 120),
      size: st.size,
      at,
      data: buf.subarray(0, n).toString('base64'),
      done: at + n >= st.size,
    };
  }

  /* Telefonun yazdığı yamada telefon adresli video → PC'nin kitaplık dosyası. Kimlik PC'nin
     kitaplığında yoksa başvuru olduğu gibi kalır (telefon önce dosyayı yollamalı). Yerinde
     değiştirmez; değişen yama ve çevrilen başvuru sayısı döner. */
  function rewritePatch(patch) {
    let changed = 0;
    const walk = (v, depth) => {
      if (depth > MAX_DEPTH || v == null || typeof v !== 'object') return v;
      if (Array.isArray(v)) {
        let out = null;
        v.forEach((x, i) => { const y = walk(x, depth + 1); if (y !== x) { if (!out) out = v.slice(); out[i] = y; } });
        return out || v;
      }
      let out = null;
      const put = (k, val) => { if (!out) out = Object.assign({}, v); out[k] = val; };
      for (const k of Object.keys(v)) {
        const y = walk(v[k], depth + 1);
        if (y !== v[k]) put(k, y);
      }
      const cur = out || v;
      const lib = typeof cur.libraryId === 'string' && cur.libraryId ? libraryFile(cur.libraryId) : null;
      if (lib && mediaUrl && mediaUrl.toMediaUrl) {
        if (typeof cur.file === 'string' && PHONE_URL.test(cur.file)) { put('file', mediaUrl.toMediaUrl(lib.file)); changed++; }
        if (cur.type === 'video' && typeof cur.ref === 'string' && PHONE_URL.test(cur.ref)) { put('ref', mediaUrl.toMediaUrl(lib.file)); changed++; }
      }
      return out || v;
    };
    const next = walk(patch, 0);
    return { patch: next, changed };
  }

  return { fetch, rewritePatch, videoRefs, refFile, libraryFile };
}

module.exports = { createLinkMedia, videoRefs, CHUNK_MAX, SIZE_MAX, PHONE_URL };
