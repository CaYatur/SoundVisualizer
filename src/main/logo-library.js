'use strict';
/* Logo / görsel kitaplığı.

   Ayar dosyasına dataURL yazılmaz: her içe aktarma userData altındaki
   bir klasöre kopyalanır, kimlikle okunur. settings.json her kaydırıcı
   hareketinde yeniden yazıldığı için GIF baytlarını oraya koymak hem
   dosyayı şişirir hem de diske gereksiz yazardı.

   Kapsam denetimi milkdrop-textures.js ile aynı gerekçeyle burada:
   main.js Electron olmadan yüklenemez; test bu dosyayı çalıştırır. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};
const MAX_BYTES = 24 * 1024 * 1024;

/* resolveId her sv-logo isteginde senkron disk I/O yapiyordu. */
const resolveCache = new Map();
const bytesCache = new Map();

function cacheKey(dir, id) {
  return String(dir || '') + '\0' + String(id || '');
}

function invalidateCache(dir) {
  const prefix = String(dir || '') + '\0';
  for (const k of [...resolveCache.keys()]) {
    if (k.startsWith(prefix)) resolveCache.delete(k);
  }
  for (const k of [...bytesCache.keys()]) {
    if (k.startsWith(prefix)) bytesCache.delete(k);
  }
}


function isImageFile(name) {
  return EXT.indexOf(path.extname(String(name || '')).toLowerCase()) >= 0;
}
function mimeFor(name) {
  return MIME[path.extname(String(name || '')).toLowerCase()] || '';
}
function kindOf(name) {
  return path.extname(String(name || '')).toLowerCase() === '.gif' ? 'gif' : 'image';
}
function safeId(id) {
  const s = String(id || '').replace(/[^A-Za-z0-9_-]/g, '');
  return s ? s.slice(0, 80) : '';
}
function newId() {
  return 'img_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

function ensureDir(dir) {
  if (!dir || typeof dir !== 'string') return '';
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* zaten var */ }
  return dir;
}

function manifestPath(dir) {
  return path.join(dir, 'manifest.json');
}

function loadManifest(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(manifestPath(dir), 'utf8'));
    return { items: Array.isArray(j.items) ? j.items : [] };
  } catch {
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
    name: it.name,
    kind: it.kind,
    mime: it.mime,
    size: it.size,
    createdAt: it.createdAt,
  };
}

/* Kimliği izin verilen kökteki gerçek bir dosyaya çözer. Sembolik bağ
   kök dışına çıkıyorsa reddedilir (yalnızca sözcüksel `..` denetimi yetmez). */
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
  if (!isImageFile(it.file)) return null;
  let realRoot;
  let realFile;
  try {
    realRoot = fs.realpathSync(path.resolve(dir));
    const candidate = path.resolve(realRoot, path.basename(it.file));
    if (!fs.existsSync(candidate)) return null;
    realFile = fs.realpathSync(candidate);
  } catch {
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
  } catch {
    return null;
  }
}

function list(dir) {
  if (!dir) return [];
  return loadManifest(dir).items.filter((x) => x && x.id).map(publicItem);
}

function importFile(dir, srcPath, originalName) {
  if (!dir || typeof dir !== 'string') return { ok: false, error: 'DIR' };
  if (!srcPath || typeof srcPath !== 'string') return { ok: false, error: 'READ' };
  const name = originalName || path.basename(srcPath);
  const ext = path.extname(name).toLowerCase();
  if (EXT.indexOf(ext) < 0) return { ok: false, error: 'TYPE' };
  let st;
  try { st = fs.statSync(srcPath); } catch { return { ok: false, error: 'READ' }; }
  if (!st.isFile() || st.size <= 0 || st.size > MAX_BYTES) return { ok: false, error: 'SIZE' };
  ensureDir(dir);
  const id = newId();
  const fileName = id + ext;
  const dest = path.join(dir, fileName);
  try { fs.copyFileSync(srcPath, dest); } catch (e) {
    return { ok: false, error: e.message || 'COPY' };
  }
  const item = {
    id,
    name: path.basename(name, ext) || id,
    file: fileName,
    mime: MIME[ext],
    kind: kindOf(fileName),
    size: st.size,
    createdAt: Date.now(),
  };
  const man = loadManifest(dir);
  man.items.unshift(item);
  saveManifest(dir, man);
  return { ok: true, item: publicItem(item) };
}

function remove(dir, id) {
  const resolved = resolveId(dir, id);
  const man = loadManifest(dir);
  man.items = man.items.filter((x) => x && x.id !== id);
  saveManifest(dir, man);
  if (resolved) {
    try { fs.unlinkSync(resolved.file); } catch { /* yok */ }
  }
  return { ok: true };
}

function read(dir, id) {
  const r = resolveId(dir, id);
  if (!r) return null;
  try {
    return {
      id: r.item.id,
      name: r.item.name,
      kind: r.item.kind,
      mime: r.item.mime,
      b64: fs.readFileSync(r.file).toString('base64'),
    };
  } catch {
    return null;
  }
}

function fileInfo(dir, id) {
  const r = resolveId(dir, id);
  if (!r) return null;
  return { file: r.file, mime: r.item.mime, size: r.size, kind: r.item.kind, name: r.item.name };
}

async function readBytes(dir, id) {
  const info = fileInfo(dir, id);
  if (!info || !info.file) return null;
  const key = cacheKey(dir, safeId(id));
  const hit = bytesCache.get(key);
  if (hit && hit.file === info.file && hit.size === info.size) return hit;
  const buf = await fs.promises.readFile(info.file);
  const entry = { file: info.file, size: info.size, mime: info.mime, buf };
  bytesCache.set(key, entry);
  return entry;
}

module.exports = {
  EXT, MIME, MAX_BYTES,
  isImageFile, mimeFor, kindOf, safeId,
  list, importFile, remove, read, resolveId, fileInfo, readBytes,
  loadManifest, publicItem, invalidateCache,
};
