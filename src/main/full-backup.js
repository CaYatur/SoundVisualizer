/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TAM YEDEK: ayarlar, sahneler ve sahnelerin kullandığı dosyalar tek arşivde.

   "Ayarları Yedekle" yalnız ayar dosyasını yazıyordu: kayıtlı sahneler ve
   renk şablonları dışarıda, videolar, logolar, presetler ve sözler hiç
   yoktu. Başka bir bilgisayarda açılan sahneler boş katmanlarla geliyordu.

   ARŞİV (.svbackup, ZIP):
     backup.json            — tür, biçim, sürüm, ayarların TAMAMI (sahneler ve
                              renk şablonları dahil), kitaplık kayıtları,
                              dosya listesi
     presets/<kimlik>.json  — kullanıcı presetleri (Studio, MilkDrop)
     libs/<kitaplık>/<dosya> — logo, video ve söz kitaplıklarının dosyaları
     textures/<ad>          — MilkDrop dokuları (yedeklilik paketiyle aynı seçim)
     media/<n>-<ad>         — kitaplık dışındaki sahne videoları
   Videolar isteğe bağlı (büyük olabilir); bırakılırsa kaç tanesinin
   bırakıldığı backup.json'da yazar.

   GERİ YÜKLEME eklemeli: yedekteki öğe aynı kimlikle yazılır (sahneler
   kimlikle başvuruyor), aynı kimlik yerelde varsa yedektekiyle değişir;
   yedekte olmayan yerel öğeler silinmez. Kitaplık dışı videolar
   `restored-media` klasörüne açılır ve sahnelerdeki yolları oraya eşlenir;
   özgün yol bu makinede varsa (aynı bilgisayar) dokunulmaz.

   Arşiv güvenilmez veri: adlar, kimlikler ve uzantılar yazılmadan önce
   denetlenir; hiçbir yol arşivden alınmaz. Electron'a bağlı değil:
   klasörler ve kitaplıklar parametre, testler gerçek dosyalarla koşuyor. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ZipWriter = require('./zip-writer');
const ZipReader = require('./zip-reader');
const { remapMedia } = require('./show-space');
const mediaUrl = require('../shared/media-url');

const TYPE = 'cayadev-visualizer-backup';
const FORMAT = 1;
const EXT = '.svbackup';
const LIB_KEYS = ['logos', 'media', 'lyrics'];
const MAX_JSON = 256 * 1024 * 1024;
const MAX_PRESET = 8 * 1024 * 1024;
const PRESET_BATCH = 500;

const safeId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id);
const plainName = (n) => typeof n === 'string' && n.length > 0 && n.length <= 200 && !/[\\/:\0]/.test(n) && n !== '.' && n !== '..';
// Arşiv içi ad: ASCII, kısa; özgün ad backup.json'da
function slug(name) {
  const ext = path.extname(String(name || '')).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
  const base = path.basename(String(name || ''), path.extname(String(name || ''))).toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'file';
  return base + ext;
}

async function statSize(file) {
  try { const st = await fs.promises.stat(file); return st.isFile() ? st.size : -1; } catch { return -1; }
}

/* ---------------------------------------------------------------- yazma --- */

/* Dışa aktarımın içeriği, yazmadan: panel boyutu önceden göstersin.
   src: { libraries: [{ key, dir, items }], textures: [{ name, file }],
          media: [ham yol], includeVideos } */
async function plan(src) {
  const s = src || {};
  const out = { libraries: {}, textures: [], media: [], bytes: 0, videoBytes: 0, videos: 0 };
  const norm = (f) => { const r = path.resolve(String(f)); return s.caseInsensitive ? r.toLowerCase() : r; };
  const libVideos = new Set();
  for (const lib of s.libraries || []) {
    if (LIB_KEYS.indexOf(lib.key) < 0) continue;
    const items = [];
    for (const it of lib.items || []) {
      if (!it || !safeId(it.id) || !plainName(it.file)) continue;
      // `src`: kitaplığın çözdüğü gerçek yol (sahne adresi bununla yazılmış)
      const file = typeof it.src === 'string' && it.src ? it.src : path.join(lib.dir, it.file);
      const size = await statSize(file);
      if (size < 0) continue;
      const video = lib.key === 'media';
      if (video) { out.videos++; out.videoBytes += size; libVideos.add(norm(file)); }
      if (video && !s.includeVideos) continue;
      items.push({ item: it, file, size });
      out.bytes += size;
    }
    out.libraries[lib.key] = { dir: lib.dir, items };
  }
  for (const t of s.textures || []) {
    if (!t || !plainName(t.name)) continue;
    const size = await statSize(t.file);
    if (size < 0) continue;
    out.textures.push({ name: t.name, file: t.file, size });
    out.bytes += size;
  }
  const seen = new Set();
  for (const raw of s.media || []) {
    if (typeof raw !== 'string' || !raw || seen.has(norm(raw))) continue;
    seen.add(norm(raw));
    // Kitaplıktaki video kitaplıkla gidiyor
    if (libVideos.has(norm(raw))) continue;
    const size = await statSize(raw);
    if (size < 0) continue;
    out.videos++;
    out.videoBytes += size;
    if (!s.includeVideos) continue;
    out.media.push({ ref: raw, file: raw, size });
    out.bytes += size;
  }
  return out;
}

/* Arşivi yazar. src (plan'ınkilere ek): { appVersion, platform, settings,
   eachPreset(async fn) }. Yarıda kalırsa arşiv silinir.
   onProgress({ phase, done, total }) — bayt cinsinden. */
async function writeBackup(outFile, src, onProgress) {
  const s = src || {};
  const p = await plan(s);
  const tmp = outFile + '.part';
  const zw = ZipWriter.createWriter(tmp);
  let done = 0;
  const total = p.bytes;
  const tick = (phase) => { if (typeof onProgress === 'function') onProgress({ phase, done, total }); };
  const onBytes = (n) => { done += n; };
  const meta = {
    type: TYPE, format: FORMAT,
    appVersion: String(s.appVersion || ''), platform: String(s.platform || ''),
    createdAt: new Date().toISOString(),
    settings: s.settings || {},
    presets: [], libraries: {}, textures: [], media: [],
    videosLeftOut: s.includeVideos ? 0 : p.videos,
    videoBytesLeftOut: s.includeVideos ? 0 : p.videoBytes,
  };
  try {
    tick('presets');
    if (typeof s.eachPreset === 'function') {
      await s.eachPreset(async (preset) => {
        if (!preset || !safeId(preset.id) || preset.builtin) return;
        const name = 'presets/' + preset.id + '.json';
        if (meta.presets.indexOf(name) >= 0) return;
        zw.addBuffer(name, JSON.stringify(preset));
        meta.presets.push(name);
      });
    }
    for (const key of LIB_KEYS) {
      const lib = p.libraries[key];
      if (!lib) continue;
      meta.libraries[key] = { dir: lib.dir, items: [] };
      for (const one of lib.items) {
        tick(key);
        const name = 'libs/' + key + '/' + one.item.file;
        await zw.addFile(name, one.file, { onBytes });
        const rec = Object.assign({}, one.item, { ref: one.file, path: name });
        delete rec.src;
        meta.libraries[key].items.push(rec);
      }
    }
    for (const t of p.textures) {
      tick('textures');
      const name = 'textures/' + meta.textures.length + '-' + slug(t.name);
      await zw.addFile(name, t.file, { onBytes });
      meta.textures.push({ name: t.name, path: name, size: t.size });
    }
    for (const m of p.media) {
      tick('media');
      const name = 'media/' + meta.media.length + '-' + slug(path.basename(m.file));
      await zw.addFile(name, m.file, { onBytes });
      meta.media.push({ ref: m.ref, name: path.basename(m.file), path: name, size: m.size });
    }
    zw.addBuffer('backup.json', JSON.stringify(meta));
    zw.close();
    await fs.promises.rm(outFile, { force: true });
    await fs.promises.rename(tmp, outFile);
  } catch (err) {
    zw.abort();
    try { await fs.promises.rm(tmp, { force: true }); } catch { /* yok */ }
    throw err;
  }
  tick('done');
  return {
    presets: meta.presets.length,
    scenes: Array.isArray(meta.settings.scenes) ? meta.settings.scenes.length : 0,
    logos: meta.libraries.logos ? meta.libraries.logos.items.length : 0,
    lyrics: meta.libraries.lyrics ? meta.libraries.lyrics.items.length : 0,
    videos: (meta.libraries.media ? meta.libraries.media.items.length : 0) + meta.media.length,
    textures: meta.textures.length,
    videosLeftOut: meta.videosLeftOut,
    bytes: zw.size,
  };
}

/* ---------------------------------------------------------------- okuma --- */

class BackupError extends Error {
  constructor(code, detail) { super(code + (detail ? ': ' + detail : '')); this.code = code; }
}

function openBackup(file) {
  let zr;
  try { zr = ZipReader.open(file); } catch (err) { throw new BackupError('NOT_BACKUP', err && err.code); }
  try {
    const byName = new Map();
    for (const e of zr.entries) if (!e.dir) byName.set(e.name, e);
    const head = byName.get('backup.json');
    if (!head) throw new BackupError('NOT_BACKUP');
    let meta;
    try { meta = JSON.parse(zr.read(head, MAX_JSON).toString('utf8')); } catch { throw new BackupError('NOT_BACKUP', 'json'); }
    if (!meta || meta.type !== TYPE) throw new BackupError('NOT_BACKUP');
    if (meta.format !== FORMAT) throw new BackupError('FORMAT', String(meta.format));
    if (!meta.settings || typeof meta.settings !== 'object' || Array.isArray(meta.settings)) throw new BackupError('NOT_BACKUP', 'settings');
    return { zr, byName, meta };
  } catch (err) {
    zr.close();
    throw err;
  }
}

function summary(meta, byName) {
  const libs = meta.libraries && typeof meta.libraries === 'object' ? meta.libraries : {};
  const n = (k) => (libs[k] && Array.isArray(libs[k].items) ? libs[k].items.length : 0);
  const media = Array.isArray(meta.media) ? meta.media : [];
  const videoBytes = media.reduce((a, m) => a + (Number(m && m.size) || 0), 0)
    + (libs.media && Array.isArray(libs.media.items) ? libs.media.items.reduce((a, it) => {
      const e = it && byName.get(it.path);
      return a + (e ? e.size : 0);
    }, 0) : 0);
  return {
    appVersion: String(meta.appVersion || ''),
    platform: String(meta.platform || ''),
    createdAt: String(meta.createdAt || ''),
    scenes: Array.isArray(meta.settings.scenes) ? meta.settings.scenes.length : 0,
    colorPresets: Array.isArray(meta.settings.userPresets) ? meta.settings.userPresets.length : 0,
    presets: Array.isArray(meta.presets) ? meta.presets.length : 0,
    logos: n('logos'),
    lyrics: n('lyrics'),
    videos: n('media') + media.length,
    videoBytes,
    textures: Array.isArray(meta.textures) ? meta.textures.length : 0,
    videosLeftOut: Number(meta.videosLeftOut) || 0,
  };
}

/* Arşivi açıp ne geri yükleneceğini söyler; hiçbir şey yazmaz. */
function inspect(file) {
  const b = openBackup(file);
  try {
    return summary(b.meta, b.byName);
  } finally {
    b.zr.close();
  }
}

// Kitaplığın manifestine öğeyi yazar (aynı kimlik değişir), önbelleği boşaltır
function upsertManifest(dir, items, lib) {
  const file = path.join(dir, 'manifest.json');
  let man;
  try { man = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { man = { items: [] }; }
  const list = Array.isArray(man.items) ? man.items : [];
  const ids = new Set(items.map((it) => it.id));
  const next = items.concat(list.filter((x) => !(x && ids.has(x.id))));
  fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ items: next }, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  if (lib && typeof lib.invalidateCache === 'function') lib.invalidateCache(dir);
}

// Var olan aynı boyutlu dosya yeniden yazılmaz (oynayan video kilitli olabilir)
async function extract(b, entry, dest, onBytes) {
  const have = await statSize(dest);
  if (have === entry.size) { onBytes(entry.size); return false; }
  const tmp = dest + '.restore-' + crypto.randomBytes(3).toString('hex');
  await b.zr.copyTo(entry, tmp, undefined, onBytes);
  try {
    await fs.promises.rename(tmp, dest);
  } catch (err) {
    await fs.promises.rm(tmp, { force: true });
    throw err;
  }
  return true;
}

/* Geri yükler. dst: {
     savePresets(async list) — presetleri kimlikleriyle yazar,
     libraries: { logos|media|lyrics: { dir, lib: { invalidateCache, isFile } } },
     textureDir, restoredMediaDir, caseInsensitive, exists(yol) }
   Dönen: { settings (videolar bu makineye eşlenmiş), counts }. */
async function restore(file, dst, onProgress) {
  const d = dst || {};
  const b = openBackup(file);
  const exists = d.exists || ((p) => fs.existsSync(p));
  const counts = { presets: 0, logos: 0, media: 0, lyrics: 0, textures: 0, videos: 0, skipped: 0 };
  let done = 0;
  let total = 0;
  for (const e of b.byName.values()) if (!/^presets\//.test(e.name) && e.name !== 'backup.json') total += e.size;
  const onBytes = (n) => { done += n; };
  const tick = (phase) => { if (typeof onProgress === 'function') onProgress({ phase, done, total }); };
  const map = {};
  try {
    const meta = b.meta;
    // Presetler: parça parça, kimliği denetlenerek
    tick('presets');
    let batch = [];
    const flush = async () => {
      if (!batch.length) return;
      const saved = typeof d.savePresets === 'function' ? await d.savePresets(batch) : [];
      counts.presets += Array.isArray(saved) ? saved.length : 0;
      batch = [];
    };
    for (const name of Array.isArray(meta.presets) ? meta.presets : []) {
      const m = /^presets\/([A-Za-z0-9_-]{1,80})\.json$/.exec(String(name));
      const e = m && b.byName.get(name);
      if (!e) { counts.skipped++; continue; }
      let p = null;
      try { p = JSON.parse(b.zr.read(e, MAX_PRESET).toString('utf8')); } catch { p = null; }
      if (!p || typeof p !== 'object' || p.id !== m[1]) { counts.skipped++; continue; }
      delete p.builtin;
      batch.push(p);
      if (batch.length >= PRESET_BATCH) await flush();
    }
    await flush();
    // Kitaplıklar: aynı kimlik, aynı dosya adı
    const libs = meta.libraries && typeof meta.libraries === 'object' ? meta.libraries : {};
    for (const key of LIB_KEYS) {
      const target = d.libraries && d.libraries[key];
      const src = libs[key];
      if (!target || !src || !Array.isArray(src.items)) continue;
      const kept = [];
      for (const it of src.items) {
        tick(key);
        const okName = it && safeId(it.id) && plainName(it.file) && (!target.lib || !target.lib.isFile || target.lib.isFile(it.file));
        const e = okName && b.byName.get('libs/' + key + '/' + it.file);
        if (!e || it.path !== e.name) { counts.skipped++; continue; }
        fs.mkdirSync(target.dir, { recursive: true });
        const dest = path.join(target.dir, it.file);
        await extract(b, e, dest, onBytes);
        const item = Object.assign({}, it);
        delete item.ref; delete item.path;
        kept.push(item);
        if (typeof it.ref === 'string' && it.ref) map[it.ref] = dest;
      }
      if (kept.length) upsertManifest(target.dir, kept, target.lib);
      counts[key] += kept.length;
      if (key === 'media') counts.videos += kept.length;
    }
    // Dokular: uygulamanın doku klasörüne özgün adıyla
    for (const t of Array.isArray(meta.textures) ? meta.textures : []) {
      tick('textures');
      const e = t && plainName(t.name) && /\.(jpe?g|png|gif|bmp|webp)$/i.test(t.name) && b.byName.get(t.path);
      if (!e || !d.textureDir) { counts.skipped++; continue; }
      fs.mkdirSync(d.textureDir, { recursive: true });
      await extract(b, e, path.join(d.textureDir, t.name), onBytes);
      counts.textures++;
    }
    // Kitaplık dışı videolar
    for (const m of Array.isArray(meta.media) ? meta.media : []) {
      tick('media');
      const e = m && typeof m.ref === 'string' && m.ref && b.byName.get(m.path);
      if (!e || !d.restoredMediaDir || !/^media\/\d+-[a-z0-9._-]+$/.test(String(m.path))) { counts.skipped++; continue; }
      fs.mkdirSync(d.restoredMediaDir, { recursive: true });
      const nice = plainName(m.name) ? m.name : path.basename(m.path);
      const dest = path.join(d.restoredMediaDir, String(m.path).slice(6).split('-')[0] + '-' + nice);
      await extract(b, e, dest, onBytes);
      map[m.ref] = dest;
      counts.videos++;
    }
    tick('settings');
    const settings = JSON.parse(JSON.stringify(meta.settings));
    remapMedia(settings, map, {
      toRaw: (v) => mediaUrl.fromMediaUrl(v),
      toRef: (local, orig) => (String(orig).startsWith(mediaUrl.PREFIX) ? mediaUrl.toMediaUrl(local) : local),
      caseInsensitive: !!d.caseInsensitive,
      exists,
    });
    // Başka makinenin doku klasörü burada yoksa boşalt; dokular uygulamanın klasöründe
    const md = settings.milkdrop;
    if (md && typeof md.textureDir === 'string' && md.textureDir && !exists(md.textureDir)) md.textureDir = '';
    tick('done');
    return { settings, counts, summary: summary(meta, b.byName) };
  } finally {
    b.zr.close();
  }
}

module.exports = { TYPE, FORMAT, EXT, LIB_KEYS, plan, writeBackup, inspect, restore, BackupError, slug };
