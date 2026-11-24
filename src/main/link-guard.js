/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TELEFONUN AYAR YAZIMININ BEKÇİSİ (B3, docs/PHONE-LINK.md §3.5). Saf: ağ, pencere, dosya yok.

   Telefon değiştirdiği ÜST DÜZEY anahtarları yollar ({ layers: [...], timeline: {...} }). Burada:
     - anahtar izin listesi, cihazın izin düzeyiyle (düzenleme / tam); bu makineye ait anahtarlar
       (jetonlar, bağlantı, MCP, yedeklilik, kontrol eşlemeleri, sahne listesinin kendisi) hiçbir
       düzeyde yazılamaz;
     - tür denetimi (dizi yerine metin gelmez), derinlik ve düğüm sınırı, sayılar sonlu;
     - DOSYA YOLU KURALI: telefon PC'ye yeni yol yazamaz. Yol gibi görünen her metin bu makinenin
       ayarında zaten bulunmalı (katmanı taşımak, kopyalamak serbest; yeni yol uydurmak değil).
       Aksi hâlde telefon PC'deki herhangi bir dosyayı yayın sunucusundan okutabilirdi;
     - masaüstüne özgü katmanlar (web sayfası, Spout/NDI/ekran/kamera girişi): telefon içini
       değiştiremez, yenisini ekleyemez (web adresi PC'de ve onayla girilir);
     - kilitli katman silinmez, yeri değişmez (kilidi açmak serbest: o da kullanıcının işi);
     - _activeSceneId yalnız var olan bir sahne;
     - kaydırıcı aralıkları şemadan (shared/schema.js), genişletilmiş üst sınırla sıkıştırılır.
   Sonuç temiz bir kopya; uygulamayı panel yapar (src/admin/link-live.js "patch"). */

const Schema = require('../shared/schema.js');

const EDIT_KEYS = Object.freeze(Schema.SCENE_KEYS.concat([
  'timeline', 'clipdeck', 'autovj', 'tempoSync', 'dynamicTheme', 'master', 'userPresets', 'nowplaying',
  'milkdropControl', '_activeSceneId',
]));
// Tam düzey: çıkışlar, ses kaynağı, ışık, güç, kayıt ve dışa aktarma ayarları
const FULL_KEYS = Object.freeze([
  'audio', 'display', 'floating', 'power', 'lighting', 'openrgb', 'artnet', 'sacn', 'wled', 'wledSync', 'oscOut',
  'textureShare', 'recording', 'export', 'screensaver', 'aspect', 'lyricsLookup', 'mapping',
]);
const SOURCE_KINDS = Object.freeze(['input', 'web']);
const MAX_KEYS = 64;
const MAX_DEPTH = 32;
const MAX_NODES = 200000;
const BAD_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

function fail(error, key, at) { return { ok: false, error, key: key || '', at: at || '' }; }

/* Yol gibi görünen metin: sürücü harfi, UNC, file: adresi, üst klasöre çıkış; adı yol diyen
   alanda (file/path/dir/folder/src) eğik çizgiyle başlayan mutlak yol. data:/blob:/http(s): değil. */
const ABS_RE = /^(?:[a-zA-Z]:[\\/]|\\\\|file:)/i;
const UP_RE = /(?:^|[\\/])\.\.(?:[\\/]|$)/;
const PATHY_KEY = /(?:file|path|dir|folder|src)$/i;
function pathLike(key, s) {
  if (typeof s !== 'string' || !s) return false;
  if (ABS_RE.test(s) || UP_RE.test(s)) return true;
  return s[0] === '/' && PATHY_KEY.test(String(key || '')) && s.indexOf('/', 1) > 0;
}
function knownPaths(cfg) {
  const out = new Set();
  const walk = (v, key, depth) => {
    if (depth > MAX_DEPTH || v == null) return;
    if (typeof v === 'string') { if (pathLike(key, v)) out.add(v); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, key, depth + 1); return; }
    if (typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], k, depth + 1);
  };
  walk(cfg, '', 0);
  return out;
}

const kindOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
function same(a, b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; } }
function extMax(row) { return Schema.extendedMax ? Schema.extendedMax(row) : row.max; }

/* (patch, current, level) → { ok, patch } | { ok:false, error, key, at }.
   error: 'bad-args' | 'not-allowed' | 'type' | 'too-big' | 'path' | 'needs-pc' | 'locked' | 'scene' */
function check(patch, current, level) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return fail('bad-args');
  const keys = Object.keys(patch);
  if (!keys.length || keys.length > MAX_KEYS) return fail('bad-args');
  const cur = current || {};
  const full = level === 'full';
  let paths = null;
  const out = {};
  for (const k of keys) {
    if (BAD_NAMES.has(k)) return fail('bad-args', k);
    const allowed = EDIT_KEYS.indexOf(k) >= 0 || (full && FULL_KEYS.indexOf(k) >= 0);
    if (!allowed) return fail('not-allowed', k);
    const v = patch[k];
    if (v === undefined) return fail('type', k);
    const was = cur[k];
    if (was !== undefined && was !== null && v !== null && kindOf(was) !== kindOf(v)) return fail('type', k);
    // Yapı ve yol
    let nodes = 0;
    let bad = null;
    const walk = (x, key, depth, at) => {
      if (bad) return;
      if (++nodes > MAX_NODES || depth > MAX_DEPTH) { bad = fail('too-big', k, at); return; }
      if (typeof x === 'number') { if (!Number.isFinite(x)) bad = fail('type', k, at); return; }
      if (typeof x === 'string') {
        if (pathLike(key, x)) {
          if (!paths) paths = knownPaths(cur);
          if (!paths.has(x)) bad = fail('path', k, at);
        }
        return;
      }
      if (x === null || typeof x === 'boolean') return;
      if (Array.isArray(x)) { x.forEach((y, i) => walk(y, key, depth + 1, at + '.' + i)); return; }
      if (typeof x === 'object') {
        for (const kk of Object.keys(x)) {
          if (BAD_NAMES.has(kk)) { bad = fail('bad-args', k, at + '.' + kk); return; }
          walk(x[kk], kk, depth + 1, at + '.' + kk);
        }
        return;
      }
      bad = fail('type', k, at);
    };
    walk(v, k, 0, k);
    if (bad) return bad;
    out[k] = JSON.parse(JSON.stringify(v));
  }

  if (Array.isArray(out.layers)) {
    const r = checkLayers(out.layers, Array.isArray(cur.layers) ? cur.layers : []);
    if (r) return r;
  }
  if (Object.prototype.hasOwnProperty.call(out, '_activeSceneId')) {
    const id = out._activeSceneId;
    if (!(id === null || id === '' || (typeof id === 'string' && (cur.scenes || []).some((s) => s && s.id === id)))) return fail('scene', '_activeSceneId');
  }
  clampRanges(out);
  return { ok: true, patch: out };
}

function checkLayers(next, prev) {
  const byId = new Map(prev.filter((l) => l && l.id).map((l) => [l.id, l]));
  /* Masaüstüne özgü katman (web sayfası, Spout/NDI/ekran/kamera girişi) telefondan SİLİNEMEZ:
     telefonun onu tanımayan bir düzenleyicisi katmanı listeden düşürse PC'nin kurulumu sessizce
     giderdi. Açma/kapama, saydamlık ve sıra serbest; silmek PC'de. */
  const nextIds = new Set(next.filter((l) => l && l.id).map((l) => l.id));
  for (const old of prev) {
    if (old && old.id && SOURCE_KINDS.indexOf(old.kind) >= 0 && !nextIds.has(old.id)) return fail('needs-pc', 'layers', old.kind);
  }
  // Masaüstüne özgü katmanlar: içleri telefondan değişmez, yenisi eklenmez, silinmez (yukarıda)
  for (const l of next) {
    if (!l || typeof l !== 'object') return fail('type', 'layers');
    if (SOURCE_KINDS.indexOf(l.kind) < 0) continue;
    const old = l.id ? byId.get(l.id) : null;
    if (!old || old.kind !== l.kind) return fail('needs-pc', 'layers', l.kind);
    if (!same(old.settings, l.settings) || !same(old.source, l.source)) return fail('needs-pc', 'layers', l.kind);
  }
  /* Kilitli katman silinmez ve öbür ESKİ katmanlara göre yeri değişmez (paneldeki kural: kilitli
     katman taşınmaz, komşusu üstünden geçmez). Yeni katman eklemek sırayı bozmuş sayılmaz;
     kilidi açılan katman serbest. */
  const keptIds = next.map((l) => l && l.id).filter((id) => id && byId.has(id));
  const kept = new Set(keptIds);
  const prevIds = prev.map((l) => l && l.id).filter((id) => id && kept.has(id));
  for (const old of prev) {
    if (!old || !old.locked || !old.id) continue;
    const now = next.find((l) => l && l.id === old.id);
    if (now && now.locked === false) continue;
    if (!now) return fail('locked', 'layers');
    if (keptIds.indexOf(old.id) !== prevIds.indexOf(old.id)) return fail('locked', 'layers');
  }
  return null;
}

/* Kaydırıcı aralıkları: şemadaki yol ('visualizer.barHeight') ve katmanın kendi ayarı
   ('layers.2.settings.visualizer.barHeight' → aynı satır). */
function clampRanges(out) {
  const visit = (x, path) => {
    if (typeof x === 'number') return null;
    if (!x || typeof x !== 'object') return null;
    for (const k of Object.keys(x)) {
      const p = path ? path + '.' + k : k;
      const v = x[k];
      if (typeof v === 'number') {
        const m = /^layers\.\d+\.settings\.(.+)$/.exec(p);
        const row = Schema.rangeFor(m ? m[1] : p);
        if (row) {
          let y = Math.min(extMax(row), Math.max(row.min, v));
          if (row.int) y = Math.round(y);
          x[k] = y;
        }
      } else if (v && typeof v === 'object') {
        visit(v, p);
      }
    }
    return null;
  };
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (typeof v === 'number') {
      const row = Schema.rangeFor(k);
      if (row) out[k] = Math.min(extMax(row), Math.max(row.min, v));
    } else if (v && typeof v === 'object') {
      visit(v, k);
    }
  }
}

/* Sahne verisi (scene.create / scene.save): sahneye ait anahtarlar, aynı kurallarla. */
function checkSceneData(data, current) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('bad-args');
  const pick = {};
  for (const k of Object.keys(data)) {
    if (Schema.SCENE_KEYS.indexOf(k) < 0) return fail('not-allowed', k);
    pick[k] = data[k];
  }
  if (!Object.keys(pick).length) return fail('bad-args');
  return check(pick, current, 'edit');
}

module.exports = { EDIT_KEYS, FULL_KEYS, SOURCE_KINDS, check, checkSceneData, pathLike, knownPaths };
