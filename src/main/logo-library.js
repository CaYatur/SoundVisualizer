/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Logo / görsel kitaplığı.

   Ayar dosyasına dataURL yazılmaz: her içe aktarma userData altındaki
   bir klasöre kopyalanır, kimlikle okunur. settings.json her kaydırıcı
   hareketinde yeniden yazıldığı için GIF baytlarını oraya koymak hem
   dosyayı şişirir hem de diske gereksiz yazardı.

   Aynı motor video kitaplığını da kurar (createLibrary). Görsel
   dışa aktarımları eski adlarıyla durur.

   Kapsam denetimi milkdrop-textures.js ile aynı gerekçeyle burada:
   main.js Electron olmadan yüklenemez; test bu dosyayı çalıştırır. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createLibrary(spec) {
  const EXT = spec.ext;
  const MIME = spec.mime;
  const MAX_BYTES = spec.maxBytes;
  const idPrefix = spec.idPrefix || 'item';
  const kindOfName = spec.kindOf || (() => 'file');

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

  function isFile(name) {
    return EXT.indexOf(path.extname(String(name || '')).toLowerCase()) >= 0;
  }
  function mimeFor(name) {
    return MIME[path.extname(String(name || '')).toLowerCase()] || '';
  }
  function kindOf(name) {
    return kindOfName(name);
  }
  function safeId(id) {
    const s = String(id || '').replace(/[^A-Za-z0-9_-]/g, '');
    return s ? s.slice(0, 80) : '';
  }
  function newId() {
    return idPrefix + '_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
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
    if (!isFile(it.file)) return null;
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

  function sameFile(a, b) {
    if (!a || !b) return false;
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  }

  /* Seçili sahne kaydı olmasa da kitaplık kopyası oynatılabilsin.
     Kökün dışındaki ya da manifestte olmayan yol açılmaz. */
  function ownsPath(dir, absPath) {
    if (!dir || !absPath) return false;
    let want;
    try { want = fs.realpathSync(path.resolve(String(absPath))); } catch { return false; }
    const items = loadManifest(dir).items;
    for (let i = 0; i < items.length; i++) {
      const r = resolveId(dir, items[i] && items[i].id);
      if (r && sameFile(r.file, want)) return true;
    }
    return false;
  }

  function list(dir) {
    if (!dir) return [];
    return loadManifest(dir).items.filter((x) => x && x.id).map(publicItem);
  }

  /* Aynı dosya ikinci kez seçilince yeniden kopyalanıyordu; video
     kitaplığında bu her seferinde yüzlerce MB demek (#695). Boyut aynıysa
     baştan ve sondan 1 MB'lık parmak izi karşılaştırılır; bütün dosya
     okunmaz. Eski kayıtların izi ilk karşılaştırmada hesaplanır. */
  const FP_BYTES = 1024 * 1024;
  function fingerprint(file, size) {
    let fd;
    try { fd = fs.openSync(file, 'r'); } catch { return ''; }
    try {
      const h = crypto.createHash('sha1');
      const n = Math.min(FP_BYTES, size);
      const head = Buffer.alloc(n);
      fs.readSync(fd, head, 0, n, 0);
      h.update(head);
      if (size > FP_BYTES) {
        const m = Math.min(FP_BYTES, size - FP_BYTES);
        const tail = Buffer.alloc(m);
        fs.readSync(fd, tail, 0, m, size - m);
        h.update(tail);
      }
      h.update(String(size));
      return h.digest('hex');
    } catch {
      return '';
    } finally {
      try { fs.closeSync(fd); } catch { /* kapalı */ }
    }
  }

  function findDuplicate(dir, srcPath, size) {
    let mine = null;
    for (const it of loadManifest(dir).items) {
      if (!it || it.size !== size) continue;
      const r = resolveId(dir, it.id);
      if (!r) continue;
      if (mine === null) mine = fingerprint(srcPath, size);
      if (!mine) return null;
      if ((it.fp || fingerprint(r.file, r.size)) === mine) return it;
    }
    return null;
  }

  function prepare(dir, srcPath, originalName) {
    if (!dir || typeof dir !== 'string') return { ok: false, error: 'DIR' };
    if (!srcPath || typeof srcPath !== 'string') return { ok: false, error: 'READ' };
    const name = originalName || path.basename(srcPath);
    const ext = path.extname(name).toLowerCase();
    if (EXT.indexOf(ext) < 0) return { ok: false, error: 'TYPE' };
    let st;
    try { st = fs.statSync(srcPath); } catch { return { ok: false, error: 'READ' }; }
    if (!st.isFile() || st.size <= 0 || st.size > MAX_BYTES) return { ok: false, error: 'SIZE' };
    if (spec.sniff && !spec.sniff(readHead(srcPath))) return { ok: false, error: 'TYPE' };
    const dup = findDuplicate(dir, srcPath, st.size);
    if (dup) return { ok: false, error: 'DUPLICATE', item: publicItem(dup) };
    ensureDir(dir);
    const id = newId();
    const fileName = id + ext;
    return {
      ok: true,
      ext,
      st,
      name,
      id,
      fileName,
      dest: path.join(dir, fileName),
    };
  }

  function commit(dir, prep) {
    const item = {
      id: prep.id,
      name: path.basename(prep.name, prep.ext) || prep.id,
      file: prep.fileName,
      mime: MIME[prep.ext],
      kind: kindOf(prep.fileName),
      size: prep.st.size,
      fp: fingerprint(prep.dest, prep.st.size),
      createdAt: Date.now(),
    };
    const man = loadManifest(dir);
    man.items.unshift(item);
    saveManifest(dir, man);
    return { ok: true, item: publicItem(item) };
  }

  function importFile(dir, srcPath, originalName) {
    const prep = prepare(dir, srcPath, originalName);
    if (!prep.ok) return prep;
    try { fs.copyFileSync(srcPath, prep.dest); } catch (e) {
      return { ok: false, error: e.message || 'COPY' };
    }
    return commit(dir, prep);
  }

  async function importFileAsync(dir, srcPath, originalName) {
    const prep = prepare(dir, srcPath, originalName);
    if (!prep.ok) return prep;
    try { await fs.promises.copyFile(srcPath, prep.dest); } catch (e) {
      return { ok: false, error: e.message || 'COPY' };
    }
    return commit(dir, prep);
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

  return {
    EXT, MIME, MAX_BYTES,
    isFile, mimeFor, kindOf, safeId,
    list, importFile, importFileAsync, remove, read, resolveId, fileInfo, readBytes, ownsPath,
    loadManifest, publicItem, invalidateCache,
  };
}

function readHead(file) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(16);
    const n = fs.readSync(fd, buf, 0, 16, 0);
    return buf.subarray(0, n);
  } catch {
    return Buffer.alloc(0);
  } finally {
    if (fd != null) try { fs.closeSync(fd); } catch { /* kapalı */ }
  }
}

/* Resim kitaplığı dosyanın BAŞINA da bakar. Eskiden yalnız uzantıya
   bakılıyordu: `.png` adlı bir metin dosyası eklenip boş logo veriyordu.
   Uzantıyla tür uyuşmasa da (ör. .png adlı JPEG) gerçek bir resim kabul
   edilir; tarayıcı içerikten çözer. */
function isImageHead(b) {
  if (!b || b.length < 4) return false;
  const at = (i, s) => b.length >= i + s.length && b.toString('latin1', i, i + s.length) === s;
  if (b[0] === 0x89 && at(1, 'PNG')) return true;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
  if (at(0, 'GIF87a') || at(0, 'GIF89a')) return true;
  if (at(0, 'RIFF') && at(8, 'WEBP')) return true;
  if (at(0, 'BM')) return true;
  return false;
}

const images = createLibrary({
  sniff: isImageHead,
  ext: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'],
  mime: {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  },
  maxBytes: 24 * 1024 * 1024,
  idPrefix: 'img',
  kindOf: (name) => (path.extname(String(name || '')).toLowerCase() === '.gif' ? 'gif' : 'image'),
});

module.exports = Object.assign({}, images, {
  createLibrary,
  isImageHead,
  isImageFile: images.isFile,
});
