/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* GÖSTERİ ENVANTERİ (#541): iki makine aynı gösteriyi mi çalıştırıyor, ve
   bunu kanıtlayabiliyor mu.

   Envanter "anahtar → parmak izi" listesi:
     app:version         — uygulama sürümü (yerleşik presetler koddan gelir)
     cfg:<anahtar>       — aktarılan her yapılandırma anahtarı (show-keys)
     preset:<kimlik>     — kullanıcı presetleri (Studio ve MilkDrop); zaman
                           damgası sayılmaz, içerik sayılır
     logo:<kimlik>       — logo kitaplığı öğesi (boyut + baş/son özeti)
     media:<yol>         — sahnenin video dosyası (boyut + baş/son özeti)
   Gösteri özeti bu listenin sıralı hâlinin SHA-256'sı. Yol değil İÇERİK
   karşılaştırılır: logo ve preset kimlikle, video yol + içerikle (sahne
   yolla başvuruyor).

   Fark listesi birincilin gözünden: yedekte eksik, farklı ya da fazla.
   Presetler ve logolar birincilden gönderilebilir; video dosyaları
   gönderilmez (gigabaytlar kalp atışıyla aynı bağlantıyı tıkardı),
   elle kopyalanır. */
const crypto = require('crypto');
const fs = require('fs');
const ShowKeys = require('../shared/show-keys');

const SAMPLE = 1024 * 1024;

function sha(s) { return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16); }

// Anahtar sırasından bağımsız JSON (aynı içerik aynı özet)
function canon(v) {
  if (v === undefined) return 'u';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}

// Preset içeriği: kayıt zamanları ve yerleşik bayrağı dışarıda
function presetFp(p) {
  if (!p || typeof p !== 'object') return '';
  const c = Object.assign({}, p);
  delete c.updatedAt; delete c.createdAt; delete c.builtin;
  return sha(canon(c));
}

// Büyük dosya: boyut + baştan ve sondan 1 MB (gigabaytı okumadan)
function fileFp(file) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return ''; }
  try {
    const size = fs.fstatSync(fd).size;
    const h = crypto.createHash('sha256');
    h.update(String(size) + ':');
    const n = Math.min(SAMPLE, size);
    const head = Buffer.alloc(n);
    fs.readSync(fd, head, 0, n, 0);
    h.update(head);
    if (size > SAMPLE) {
      const m = Math.min(SAMPLE, size - SAMPLE);
      const tail = Buffer.alloc(m);
      fs.readSync(fd, tail, 0, m, size - m);
      h.update(tail);
    }
    return h.digest('hex').slice(0, 16);
  } catch {
    return '';
  } finally {
    try { fs.closeSync(fd); } catch { /* */ }
  }
}

/* Envanteri kurar. Girdi düz veri: yapılandırma, kullanıcı presetleri,
   logo kitaplığı öğeleri ({ id, size, fp }), video dosyalarının parmak
   izleri ({ yol: fp }). */
function build(input) {
  const o = input || {};
  const items = {};
  items['app:version'] = String(o.version || '');
  const cfg = o.cfg || {};
  for (const k of ShowKeys.REPLICATED) items['cfg:' + k] = sha(canon(cfg[k]));
  // Preset ya da önceden hesaplanmış { id, fp } (büyük kütüphanede önbellek)
  for (const p of o.presets || []) {
    if (!p || !p.id || p.builtin) continue;
    items['preset:' + p.id] = typeof p.fp === 'string' && !p.kind ? p.fp : presetFp(p);
  }
  for (const it of o.logos || []) {
    if (!it || !it.id) continue;
    items['logo:' + it.id] = sha(String(it.size || 0) + ':' + String(it.fp || ''));
  }
  for (const [p, fp] of Object.entries(o.media || {})) items['media:' + p] = fp || 'missing';
  return { items, hash: hashOf(items) };
}

function hashOf(items) {
  const lines = Object.keys(items || {}).sort().map((k) => k + '=' + items[k]);
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

/* Birincile göre fark. `kind` anahtarın öneki; gönderilebilir olanlar
   preset ve logo (birincilde var, yedekte yok ya da farklı). */
function diff(primary, backup) {
  const a = (primary && primary.items) || {};
  const b = (backup && backup.items) || {};
  const out = [];
  for (const k of Object.keys(a).sort()) {
    const kind = k.slice(0, k.indexOf(':'));
    const id = k.slice(k.indexOf(':') + 1);
    if (!(k in b)) out.push({ key: k, kind, id, status: 'missing', pushable: kind === 'preset' || kind === 'logo' });
    else if (a[k] !== b[k]) {
      const missingFile = kind === 'media' && b[k] === 'missing';
      out.push({ key: k, kind, id, status: missingFile ? 'missing' : 'different', pushable: kind === 'preset' || kind === 'logo' });
    }
  }
  for (const k of Object.keys(b).sort()) {
    if (k in a) continue;
    const kind = k.slice(0, k.indexOf(':'));
    // Yedekte fazla preset/logo gösteriyi bozmaz; bilgi olarak
    out.push({ key: k, kind, id: k.slice(k.indexOf(':') + 1), status: 'extra', pushable: false });
  }
  return out;
}

/* Envanter iletisi parçaları: yedekten birincile giden ileti 256 KB'ı
   geçemez (stream-server MAX_MESSAGE). */
function chunks(items, size) {
  const keys = Object.keys(items || {});
  const n = Math.max(1, size || 2000);
  const out = [];
  for (let i = 0; i < keys.length; i += n) {
    const part = {};
    for (const k of keys.slice(i, i + n)) part[k] = items[k];
    out.push(part);
  }
  return out.length ? out : [{}];
}

module.exports = { canon, presetFp, fileFp, build, hashOf, diff, chunks, sha };
