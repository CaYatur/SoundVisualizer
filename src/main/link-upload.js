/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TELEFONDAN BİLGİSAYARA DOSYA (PC bağlantısı B6, docs/PHONE-LINK.md "Files").

   Telefon dosyayı parça parça yollar: file.begin → file.chunk (sırayla) → file.end. Burada yalnız
   uygulamanın kendi geçici klasörüne yazılır; yol telefondan GELMEZ (ad yalnız görünen ad ve
   uzantı için, temizlenir). Bitince dosya türüne göre kitaplığa alınır (video, logo, söz,
   MilkDrop preseti) ya da dışa aktarmanın şarkısı olarak bekletilir; kitaplık kendi biçim ve
   boyut denetimini yine yapar. Kurallar:
     - tür ve uzantı izin listesi, tür başına boyut sınırı, aynı anda en çok 2 aktarım;
     - parçalar sırayla (`at` = alınan bayt), toplam bildirilen boyutu geçemez;
     - sonunda boyut ve SHA-256 tutmalı;
     - 2 dakika parça gelmeyen aktarım ve oturumu kapanan telefonun aktarımları silinir. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KINDS = Object.freeze({
  video: { ext: ['mp4', 'webm', 'mkv', 'mov', 'm4v'], max: 512 * 1024 * 1024 },
  logo: { ext: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'], max: 24 * 1024 * 1024 },
  lyrics: { ext: ['lrc', 'txt', 'srt', 'vtt'], max: 1024 * 1024 },
  milk: { ext: ['milk', 'milk2'], max: 1024 * 1024 },
  audio: { ext: ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'], max: 512 * 1024 * 1024 },
});
const CHUNK_MAX = 96 * 1024;
const IDLE_MS = 120000;
const MAX_ACTIVE = 2;

function err(code) { return Object.assign(new Error(code), { code }); }

/* Görünen ad: yol ayırıcısı ve denetim karakteri yok, en çok 120 karakter, uzantı korunur. */
function cleanName(name, ext) {
  let n = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\.{2,}/g, ' ');
  n = n.replace(/\s+/g, ' ').trim().replace(/^\.+/, '').trim();
  if (!n) n = 'telefon';
  if (!n.toLowerCase().endsWith('.' + ext)) n += '.' + ext;
  if (n.length > 120) n = n.slice(0, 120 - ext.length - 1) + '.' + ext;
  return n;
}

function createUploads(opts) {
  const o = Object.assign({ now: Date.now, randomBytes: crypto.randomBytes }, opts || {});
  const dir = o.dir;
  const live = new Map(); // id → { owner, kind, name, size, got, file, fd, hash, at }

  function ensureDir() { fs.mkdirSync(dir, { recursive: true }); }
  function remove(id) {
    const u = live.get(id);
    if (!u) return false;
    live.delete(id);
    try { if (u.fd != null) fs.closeSync(u.fd); } catch { /* */ }
    try { fs.unlinkSync(u.file); } catch { /* */ }
    return true;
  }
  function sweep() {
    const t = o.now();
    for (const [id, u] of live) if (t - u.at > IDLE_MS) remove(id);
  }

  function begin(owner, a) {
    sweep();
    const kind = a && typeof a.kind === 'string' ? a.kind : '';
    const spec = KINDS[kind];
    if (!spec) throw err('bad-kind');
    const ext = String((a.name || '').split('.').pop() || '').toLowerCase();
    if (spec.ext.indexOf(ext) < 0) throw err('bad-type');
    const size = a.size;
    if (!Number.isInteger(size) || size <= 0) throw err('bad-args');
    if (size > spec.max) throw err('too-big');
    let mine = 0;
    for (const u of live.values()) if (u.owner === owner) mine++;
    if (mine >= MAX_ACTIVE || live.size >= MAX_ACTIVE * 4) throw err('busy');
    ensureDir();
    const id = o.randomBytes(12).toString('hex');
    const file = path.join(dir, id + '.part');
    const fd = fs.openSync(file, 'wx');
    const use = a && a.use === 'timeline' ? 'timeline' : '';
    live.set(id, { owner, kind, name: cleanName(a.name, ext), ext, size, got: 0, file, fd, hash: crypto.createHash('sha256'), at: o.now(), use });
    return { id, chunk: CHUNK_MAX };
  }

  function chunk(owner, a) {
    const u = a && live.get(a.id);
    if (!u || u.owner !== owner) throw err('unknown-upload');
    if (a.at !== u.got) throw err('bad-offset');
    if (typeof a.data !== 'string' || !/^[A-Za-z0-9+/=]*$/.test(a.data)) throw err('bad-args');
    const buf = Buffer.from(a.data, 'base64');
    if (!buf.length || buf.length > CHUNK_MAX) throw err('bad-args');
    if (u.got + buf.length > u.size) { remove(a.id); throw err('too-big'); }
    fs.writeSync(u.fd, buf);
    u.hash.update(buf);
    u.got += buf.length;
    u.at = o.now();
    return { got: u.got };
  }

  /* Bitti: dosya doğrulanır ve kapatılır. Dönen `file` geçici dosya; çağıran kitaplığa alıp siler
     (take) ya da dışa aktarmanın şarkısı olarak tutar. */
  function end(owner, a) {
    const u = a && live.get(a.id);
    if (!u || u.owner !== owner) throw err('unknown-upload');
    const digest = u.hash.digest('hex');
    try { fs.closeSync(u.fd); } catch { /* */ }
    u.fd = null;
    if (u.got !== u.size || typeof a.sha256 !== 'string' || a.sha256.toLowerCase() !== digest) { remove(a.id); throw err('bad-hash'); }
    live.delete(a.id);
    const done = path.join(dir, a.id + '.' + u.ext);
    fs.renameSync(u.file, done);
    return { id: a.id, kind: u.kind, name: u.name, size: u.size, file: done, use: u.use || '' };
  }

  function cancel(owner, id) {
    const u = live.get(id);
    if (!u || u.owner !== owner) return false;
    return remove(id);
  }
  function dropOwner(owner) {
    for (const [id, u] of live) if (u.owner === owner) remove(id);
  }

  return { begin, chunk, end, cancel, dropOwner, sweep, active: () => live.size };
}

module.exports = { KINDS, CHUNK_MAX, IDLE_MS, cleanName, createUploads };
