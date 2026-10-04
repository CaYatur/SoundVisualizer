'use strict';
/* Söz kütüphanesi.

   Ayar dosyasına LRC yazılmaz: settings.json her kaydırıcıda yeniden
   yazılır. Metin userData/lyrics-library altında durur, sahnede yalnız
   takip bayrağı kalır. Kapsam denetimi logo kitaplığıyla aynı gerekçeyle
   burada: main.js Electron olmadan yüklenemez; test bu dosyayı çalıştırır. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXT = ['.lrc', '.srt', '.txt'];
const MAX_BYTES = 1024 * 1024;

const resolveCache = new Map();

function cacheKey(dir, id) {
  return String(dir || '') + '\0' + String(id || '');
}

function invalidateCache(dir) {
  const prefix = String(dir || '') + '\0';
  for (const k of [...resolveCache.keys()]) {
    if (k.startsWith(prefix)) resolveCache.delete(k);
  }
}

function isLyricFile(name) {
  return EXT.indexOf(path.extname(String(name || '')).toLowerCase()) >= 0;
}

function safeId(id) {
  const s = String(id || '').replace(/[^A-Za-z0-9_-]/g, '');
  return s ? s.slice(0, 80) : '';
}

function newId() {
  return 'lyr_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

function ensureDir(dir) {
  if (!dir || typeof dir !== 'string') return '';
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* zaten var */ }
  return dir;
}

function manifestPath(dir) {
  return path.join(dir, 'manifest.json');
}

function loadManifest(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(manifestPath(dir), 'utf8'));
    return { items: Array.isArray(j.items) ? j.items : [] };
  } catch (e) {
    return { items: [] };
  }
}

function saveManifest(dir, man) {
  ensureDir(dir);
  fs.writeFileSync(manifestPath(dir), JSON.stringify({ items: man.items || [] }, null, 2), 'utf8');
  invalidateCache(dir);
}

function publicItem(it) {
  return {
    id: it.id,
    name: it.name || '',
    artist: it.artist || '',
    title: it.title || '',
    size: it.size || 0,
    createdAt: it.createdAt || 0,
  };
}

function resolveId(dir, id) {
  if (!dir || typeof dir !== 'string') return null;
  const sid = safeId(id);
  if (!sid) return null;
  const key = cacheKey(dir, sid);
  if (resolveCache.has(key)) return resolveCache.get(key);
  const man = loadManifest(dir);
  const it = man.items.find((x) => x && x.id === sid);
  if (!it || typeof it.file !== 'string' || !it.file) return null;
  if (/[\\/]/.test(it.file) || it.file === '.' || it.file === '..') return null;
  if (!isLyricFile(it.file)) return null;
  let realRoot;
  let realFile;
  try {
    realRoot = fs.realpathSync(path.resolve(dir));
    const candidate = path.resolve(realRoot, path.basename(it.file));
    if (!fs.existsSync(candidate)) return null;
    realFile = fs.realpathSync(candidate);
  } catch (e) {
    return null;
  }
  const rel = path.relative(realRoot, realFile);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  try {
    const st = fs.statSync(realFile);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    const resolved = { item: it, file: realFile, size: st.size };
    resolveCache.set(key, resolved);
    return resolved;
  } catch (e) {
    return null;
  }
}

function list(dir) {
  if (!dir) return [];
  return loadManifest(dir).items.filter((x) => x && x.id).map(publicItem);
}

function readText(file) {
  let text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  if (text.indexOf('\0') >= 0) return null;
  return text;
}

function importFile(dir, srcPath, originalName, meta) {
  if (!dir || typeof dir !== 'string') return { ok: false, error: 'DIR' };
  if (!srcPath || typeof srcPath !== 'string') return { ok: false, error: 'READ' };
  const name = originalName || path.basename(srcPath);
  const ext = path.extname(name).toLowerCase();
  if (EXT.indexOf(ext) < 0) return { ok: false, error: 'TYPE' };
  let st;
  try { st = fs.statSync(srcPath); } catch (e) { return { ok: false, error: 'READ' }; }
  if (!st.isFile() || st.size <= 0 || st.size > MAX_BYTES) return { ok: false, error: 'SIZE' };
  ensureDir(dir);
  const id = newId();
  const fileName = id + ext;
  const dest = path.join(dir, fileName);
  try { fs.copyFileSync(srcPath, dest); } catch (e) {
    return { ok: false, error: e.message || 'COPY' };
  }
  const text = readText(dest);
  if (text == null) {
    try { fs.unlinkSync(dest); } catch (e) { /* yok */ }
    return { ok: false, error: 'TYPE' };
  }
  const extra = meta || {};
  const item = {
    id,
    name: path.basename(name, ext) || id,
    file: fileName,
    artist: String(extra.artist || '').slice(0, 200),
    title: String(extra.title || '').slice(0, 200),
    size: st.size,
    createdAt: Date.now(),
  };
  const man = loadManifest(dir);
  man.items.unshift(item);
  saveManifest(dir, man);
  return { ok: true, item: publicItem(item) };
}

function update(dir, id, patch) {
  const sid = safeId(id);
  if (!sid) return { ok: false, error: 'MISSING' };
  const man = loadManifest(dir);
  const it = man.items.find((x) => x && x.id === sid);
  if (!it) return { ok: false, error: 'MISSING' };
  const p = patch || {};
  if (p.artist != null) it.artist = String(p.artist).slice(0, 200);
  if (p.title != null) it.title = String(p.title).slice(0, 200);
  if (p.text != null) {
    let body = String(p.text);
    if (body.charCodeAt(0) === 0xFEFF) body = body.slice(1);
    if (body.indexOf('\0') >= 0) return { ok: false, error: 'TYPE' };
    const bytes = Buffer.byteLength(body, 'utf8');
    if (bytes <= 0 || bytes > MAX_BYTES) return { ok: false, error: 'SIZE' };
    const resolved = resolveId(dir, sid);
    if (!resolved) return { ok: false, error: 'MISSING' };
    try { fs.writeFileSync(resolved.file, body, 'utf8'); }
    catch (e) { return { ok: false, error: e.message || 'WRITE' }; }
    it.size = bytes;
    invalidateCache(dir);
  }
  saveManifest(dir, man);
  return { ok: true, item: publicItem(it) };
}

function remove(dir, id) {
  const resolved = resolveId(dir, id);
  const man = loadManifest(dir);
  const sid = safeId(id);
  man.items = man.items.filter((x) => x && x.id !== sid);
  saveManifest(dir, man);
  if (resolved) {
    try { fs.unlinkSync(resolved.file); } catch (e) { /* yok */ }
  }
  return { ok: true };
}

function read(dir, id) {
  const r = resolveId(dir, id);
  if (!r) return null;
  try {
    const text = readText(r.file);
    if (text == null) return null;
    return {
      id: r.item.id,
      name: r.item.name || '',
      artist: r.item.artist || '',
      title: r.item.title || '',
      text,
    };
  } catch (e) {
    return null;
  }
}

function snapshot(dir) {
  if (!dir) return [];
  const out = [];
  for (const it of loadManifest(dir).items) {
    if (!it || !it.id) continue;
    const one = read(dir, it.id);
    if (!one) continue;
    out.push(one);
  }
  return out;
}

module.exports = {
  EXT, MAX_BYTES,
  isLyricFile, safeId,
  list, importFile, update, remove, read, snapshot, resolveId,
  loadManifest, publicItem, invalidateCache,
};
