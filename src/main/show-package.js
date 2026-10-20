/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* GÖSTERİ PAKETİ (#812): birincilden yedeğe sağlam kopya.

   Eskiden (#541) presetler ve logolar tek tek, bütün dosya tek iletide
   gidiyordu; video dosyaları hiç gitmiyordu ve yarıda kopan gönderim yarım
   bir kütüphane bırakabiliyordu. Şimdi:

   - MANİFEST: sürümlü (`format`), her dosyanın boyutu ve SHA-256'sı, paket
     özeti (`pkg`) bu listenin sıralı hâlinin SHA-256'sı. Birincilin dosya
     yolu manifeste girmez; yedek yalnız göreli, güvenli bir ad görür.
   - PARÇA: dosyalar CHUNK baytlık parçalarla, her parça kendi SHA-256'sıyla
     gelir. Bozuk parça yazılmaz, yeniden istenir.
   - SÜRDÜRME: alınan parçalar hazırlık klasörünün `state.json`'ında; bağlantı
     koparsa ya da uygulama yeniden açılırsa aynı paket kaldığı yerden sürer.
     Önceki kopyada aynı özetle duran dosya yeniden indirilmez.
   - DOĞRULAMA ve TAKAS: her dosyanın SHA-256'sı tutmadan hiçbir şey yerine
     geçmez. Takas iki adımlı: `current` → `old-*`, `next-*` → `current`.
     Windows'ta var olan bir klasörün üstüne rename yapılamıyor ve açık bir
     tutamaç (virüs tarayıcısı, Explorer önizlemesi) EPERM/EBUSY veriyor; bu
     yüzden tek adımlı üstüne yazma yok, her rename kısa aralıklarla yeniden
     deneniyor ve yarıda kalan takas geri alınıyor.

   Adlar: `<tür>/<kısa-ad>-<kimlik özeti><uzantı>`, küçük harf, en çok ~70
   karakter. Kimlik özeti büyük/küçük harf ayrımı olmayan dosya sistemlerinde
   (Windows, macOS varsayılanı) "A" ile "a"nın aynı dosyaya düşmesini önler;
   kısa ad Windows'un MAX_PATH sınırından uzak tutar. Ayırıcı her zaman "/",
   diske yazarken `path` ile çevrilir. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FORMAT = 1;
const CHUNK = 256 * 1024;
const KINDS = ['presets', 'logos', 'media'];
const MAX_ITEMS = 50000;
const MAX_FILE = 64 * 1024 * 1024 * 1024; // 64 GB: video dosyası için bile bol
const NAME_RE = /^(presets|logos|media)\/[a-z0-9][a-z0-9._-]{0,80}$/;

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

// Kimlikten güvenli, küçük harfli, kısa dosya adı (+ kimlik özeti)
function entryName(kind, id, ext) {
  if (KINDS.indexOf(kind) < 0) throw new Error('kind');
  const e = String(ext || '').toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
  const dot = e && e[0] !== '.' ? '.' + e : e;
  const slug = String(id || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item';
  return kind + '/' + slug + '-' + sha256(String(id)).slice(0, 10) + dot;
}

/* Akışla SHA-256: gigabaytlık video belleğe alınmaz, olay döngüsü kalp
   atışına arada bir döner (her okuma ayrı bir G/Ç turu). */
function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(file, { highWaterMark: 1024 * 1024 });
    s.on('data', (d) => h.update(d));
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
  });
}

function chunkCount(size) { return Math.max(1, Math.ceil(size / CHUNK)); }

function canonItems(items) {
  return items.map((it) => [it.path, it.kind, it.id, it.size, it.sha256].join('|')).sort().join('\n');
}

/* Birincil: manifesti kurar. `entries`: { kind, id, name, ext, size, sha256,
   ref? , src? }. `src` (birincildeki yol) manifeste girmez; gönderen kendi
   tablosunda tutar. `ref`, sahnenin başvurduğu değer (video için yol): yedek
   kendi kopyasını sahnede buna göre eşler. */
function buildManifest(entries, meta) {
  const seen = new Set();
  const items = [];
  for (const e of entries || []) {
    if (!e || KINDS.indexOf(e.kind) < 0 || !e.id || !Number.isFinite(e.size) || !/^[0-9a-f]{64}$/.test(String(e.sha256))) continue;
    const p = entryName(e.kind, e.id, e.ext);
    if (seen.has(p)) continue;
    seen.add(p);
    const it = { path: p, kind: e.kind, id: String(e.id), name: String(e.name || e.id).slice(0, 200), size: e.size, sha256: e.sha256, chunks: chunkCount(e.size) };
    if (typeof e.ref === 'string' && e.ref) it.ref = e.ref.slice(0, 4096);
    items.push(it);
  }
  items.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const m = meta || {};
  return {
    format: FORMAT,
    pkg: sha256(FORMAT + '\n' + canonItems(items)),
    version: String(m.version || ''),
    createdAt: Number.isFinite(m.createdAt) ? m.createdAt : Date.now(),
    chunk: CHUNK,
    totalBytes: items.reduce((n, it) => n + it.size, 0),
    items,
  };
}

/* Yedek: gelen manifest güvenilmez veri. Biçim, adlar (dizin dışına çıkış,
   mutlak yol, ters bölü, büyük harf), boyutlar, parça sayısı ve paket özeti
   denetlenir. Hata yoksa ''. */
function validateManifest(m) {
  if (!m || typeof m !== 'object') return 'shape';
  if (m.format !== FORMAT) return 'format';
  if (m.chunk !== CHUNK) return 'chunk';
  if (!Array.isArray(m.items) || m.items.length > MAX_ITEMS) return 'items';
  const seen = new Set();
  for (const it of m.items) {
    if (!it || typeof it.path !== 'string' || !NAME_RE.test(it.path) || it.path.indexOf('..') >= 0) return 'path';
    if (seen.has(it.path)) return 'duplicate';
    seen.add(it.path);
    if (KINDS.indexOf(it.kind) < 0 || it.path.split('/')[0] !== it.kind) return 'kind';
    if (!Number.isInteger(it.size) || it.size < 0 || it.size > MAX_FILE) return 'size';
    if (!/^[0-9a-f]{64}$/.test(String(it.sha256))) return 'hash';
    if (it.chunks !== chunkCount(it.size)) return 'chunks';
  }
  if (m.pkg !== sha256(FORMAT + '\n' + canonItems(m.items))) return 'pkg';
  return '';
}

/* Birincil: bir parçayı okur. Dosya manifest kurulduktan sonra değiştiyse
   (boyut) 'changed'; yedek paketi baştan ister. */
async function readChunk(src, size, index) {
  const fh = await fs.promises.open(src, 'r');
  try {
    const st = await fh.stat();
    if (st.size !== size) return { error: 'changed' };
    const start = index * CHUNK;
    const len = Math.max(0, Math.min(CHUNK, size - start));
    if (index < 0 || (start >= size && size > 0) || (size === 0 && index !== 0)) return { error: 'range' };
    const buf = Buffer.alloc(len);
    if (len) await fh.read(buf, 0, len, start);
    return { buf, sha: sha256(buf) };
  } finally {
    await fh.close();
  }
}

/* Windows: rename/rm, başka bir süreç dosyayı kısa süre tuttuğunda EPERM,
   EBUSY ya da EACCES verir. Birkaç kez, artan aralıkla yeniden dener. */
const RETRY = ['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'];
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function retrySync(fn, opts) {
  const tries = (opts && opts.tries) || 6;
  let wait = (opts && opts.wait) || 20;
  for (let i = 0; ; i++) {
    try { return fn(); } catch (e) {
      if (i >= tries - 1 || RETRY.indexOf(e && e.code) < 0) throw e;
      sleepSync(wait);
      wait = Math.min(500, wait * 2);
    }
  }
}

/* JSON dosyasını yarım bırakmadan yazar: aynı klasörde geçici dosya, sonra
   rename (aynı birimde işletim sisteminin tek adımı). Satır sonu her zaman
   "\n"; okuma BOM ve "\r\n"i kaldırır. */
function writeJsonAtomic(file, obj, fsi) {
  const F = fsi || fs;
  const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  F.mkdirSync(path.dirname(file), { recursive: true });
  F.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
  try {
    retrySync(() => F.renameSync(tmp, file));
  } catch (e) {
    try { F.unlinkSync(tmp); } catch { /* */ }
    throw e;
  }
}
function readJson(file, fsi) {
  const F = fsi || fs;
  try {
    let t = F.readFileSync(file, 'utf-8');
    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function rmrf(p, fsi) {
  const F = fsi || fs;
  try { retrySync(() => F.rmSync(p, { recursive: true, force: true })); } catch { /* sonraki temizlikte */ }
}

/* YEDEK: paketin alıcısı. `root` yedeklilik klasöründeki paket alanı:
     root/current/          — son doğrulanmış kopya (+ manifest.json)
     root/staging/<pkg>/    — inen paket (+ state.json: alınan parçalar)
   Aynı paket için yeniden kurulursa state.json'dan sürer. */
function createReceiver(opts) {
  const o = opts || {};
  const F = o.fs || fs;
  const root = o.root;
  const m = o.manifest;
  const bad = validateManifest(m);
  if (bad) throw new Error('manifest:' + bad);
  const stageRoot = path.join(root, 'staging');
  const stage = path.join(stageRoot, m.pkg.slice(0, 16));
  const stateFile = path.join(stage, 'state.json');
  const filesDir = path.join(stage, 'files');
  const wanted = new Set((o.only || m.items.map((it) => it.path)));
  const items = m.items.filter((it) => wanted.has(it.path));
  const byPath = new Map(items.map((it) => [it.path, it]));

  // Başka paketlerin yarım hazırlıkları: yalnız bu uygulamanın geçici verisi
  try {
    for (const d of F.readdirSync(stageRoot)) if (d !== m.pkg.slice(0, 16)) rmrf(path.join(stageRoot, d), F);
  } catch { /* yok */ }
  F.mkdirSync(filesDir, { recursive: true });

  const prev = readJson(stateFile, F);
  const have = new Map(); // path -> Set(parça)
  if (prev && prev.pkg === m.pkg && prev.have && typeof prev.have === 'object') {
    for (const [p, list] of Object.entries(prev.have)) {
      const it = byPath.get(p);
      if (!it || !Array.isArray(list)) continue;
      // Dosya yoksa ya da kısaysa kayıt geçersiz: o dosya baştan
      let ok = false;
      try { ok = F.statSync(diskPath(p)).size === it.size; } catch { ok = false; }
      if (ok) have.set(p, new Set(list.filter((c) => Number.isInteger(c) && c >= 0 && c < it.chunks)));
    }
  }

  function diskPath(p) { return path.join(filesDir, ...p.split('/')); }
  let dirty = 0;
  function saveState(force) {
    if (!force && ++dirty < 8) return;
    dirty = 0;
    const out = {};
    for (const [p, s] of have) out[p] = Array.from(s);
    writeJsonAtomic(stateFile, { pkg: m.pkg, have: out }, F);
  }

  function ensureFile(it) {
    const d = diskPath(it.path);
    F.mkdirSync(path.dirname(d), { recursive: true });
    let size = -1;
    try { size = F.statSync(d).size; } catch { /* yok */ }
    if (size !== it.size) {
      const fd = F.openSync(d, 'w');
      try { F.ftruncateSync(fd, it.size); } finally { F.closeSync(fd); }
      have.set(it.path, new Set());
    }
    if (!have.has(it.path)) have.set(it.path, new Set());
    return d;
  }

  /* Önceki doğrulanmış kopyada aynı ad ve aynı SHA-256 ile duran dosya
     kopyalanır, ağdan inmez. */
  function prefill() {
    const cur = readJson(path.join(root, 'current', 'manifest.json'), F);
    if (!cur || !Array.isArray(cur.items)) return 0;
    let n = 0;
    for (const old of cur.items) {
      const it = byPath.get(old && old.path);
      if (!it || old.sha256 !== it.sha256 || old.size !== it.size) continue;
      const s = have.get(it.path);
      if (s && s.size === it.chunks) continue;
      try {
        const d = diskPath(it.path);
        F.mkdirSync(path.dirname(d), { recursive: true });
        // Sabit bağ: gigabaytlık video kopyalanmaz, disk iki kat dolmaz
        linkOrCopy(path.join(root, 'current', ...it.path.split('/')), d, F);
        have.set(it.path, new Set(Array.from({ length: it.chunks }, (_, i) => i)));
        n++;
      } catch { /* inecek */ }
    }
    if (n) saveState(true);
    return n;
  }

  function missing(limit) {
    const out = [];
    const max = limit || Infinity;
    for (const it of items) {
      const s = have.get(it.path);
      for (let c = 0; c < it.chunks; c++) {
        if (s && s.has(c)) continue;
        out.push({ path: it.path, c });
        if (out.length >= max) return out;
      }
    }
    return out;
  }

  // Bir parça: özet tutmazsa yazılmaz
  function accept(p, c, buf, sha) {
    const it = byPath.get(p);
    if (!it) return 'unknown';
    if (!Number.isInteger(c) || c < 0 || c >= it.chunks) return 'range';
    if (!Buffer.isBuffer(buf)) return 'data';
    const expectLen = Math.max(0, Math.min(CHUNK, it.size - c * CHUNK));
    if (buf.length !== expectLen) return 'length';
    if (sha256(buf) !== sha) return 'checksum';
    const d = ensureFile(it);
    const fd = F.openSync(d, 'r+');
    try { if (buf.length) F.writeSync(fd, buf, 0, buf.length, c * CHUNK); } finally { F.closeSync(fd); }
    have.get(it.path).add(c);
    saveState(false);
    return '';
  }

  function progress() {
    let bytes = 0;
    let files = 0;
    for (const it of items) {
      const s = have.get(it.path);
      const n = s ? s.size : 0;
      if (n === it.chunks) files++;
      bytes += Math.min(it.size, n * CHUNK);
    }
    return { bytes, total: items.reduce((x, it) => x + it.size, 0), files, of: items.length };
  }

  // Bütün dosyaların SHA-256'sı; tutmayanın parça kaydı silinir (yeniden iner)
  async function verify() {
    saveState(true);
    const errors = [];
    for (const it of items) {
      let h = '';
      try { h = it.size === 0 ? sha256(Buffer.alloc(0)) : await hashFile(diskPath(it.path)); } catch { h = ''; }
      if (h !== it.sha256) { errors.push(it.path); have.set(it.path, new Set()); }
    }
    if (errors.length) saveState(true);
    return errors;
  }

  /* Doğrulanmış paketi yerine koyar. Sıra:
       staging/<pkg>/files → next-<pkg>   (manifest.json yazılır)
       current            → old-<zaman>   (varsa)
       next-<pkg>         → current
       old-<zaman>        silinir (olmazsa bir sonraki takasta)
     İkinci ya da üçüncü adım düşerse eski kopya geri konur. */
  function commit() {
    const next = path.join(root, 'next-' + m.pkg.slice(0, 16));
    const cur = path.join(root, 'current');
    const old = path.join(root, 'old-' + Date.now());
    rmrf(next, F);
    // Boş dosyalar (0 bayt) hiç parça almamış olabilir
    for (const it of items) ensureFile(it);
    retrySync(() => F.renameSync(filesDir, next));
    const keptItems = items.map((it) => Object.assign({}, it));
    /* ÖNCEKİ VİDEOLAR KALIR (#812, Windows'ta bulundu). "Videoları da
       kopyala" işaretlenmeden inen paket current'ı değiştiriyor ve önceki
       pakette kopyalanmış videoları (2,8 GB) siliyordu. Artık eski kopyadaki,
       yeni pakette olmayan her doğrulanmış video yeni kopyaya taşınır (sabit
       bağ; olmazsa kopya) ve manifestte kalır. Video yalnız operatör açıkça
       kaldırınca gider. Aynı yolda yeni paketin dosyası varsa o geçerli. */
    const curMan = readJson(path.join(cur, 'manifest.json'), F);
    const newPaths = new Set(items.map((it) => it.path));
    const carried = [];
    if (curMan && Array.isArray(curMan.items)) {
      for (const it of curMan.items) {
        if (!it || it.kind !== 'media' || newPaths.has(it.path) || typeof it.path !== 'string') continue;
        const src = path.join(cur, ...it.path.split('/'));
        const dst = path.join(next, ...it.path.split('/'));
        let st = null;
        try { st = F.statSync(src); } catch { continue; }
        if (!st || st.size !== it.size) continue;
        try {
          F.mkdirSync(path.dirname(dst), { recursive: true });
          linkOrCopy(src, dst, F);
          keptItems.push(Object.assign({}, it, { carried: true }));
          carried.push(it.path);
        } catch (e) {
          // Taşınamadıysa takas YAPILMAZ: eski kopya ve videoları yerinde kalır
          rmrf(next, F);
          throw Object.assign(new Error('carry:' + it.path + ': ' + (e && e.message)), { code: 'CARRY' });
        }
      }
    }
    writeJsonAtomic(path.join(next, 'manifest.json'), Object.assign({}, m, { items: keptItems, installedAt: Date.now() }), F);
    let moved = false;
    try {
      if (F.existsSync(cur)) { retrySync(() => F.renameSync(cur, old)); moved = true; }
      retrySync(() => F.renameSync(next, cur));
    } catch (e) {
      if (moved && !F.existsSync(cur)) { try { retrySync(() => F.renameSync(old, cur)); } catch { /* */ } }
      throw e;
    }
    rmrf(old, F);
    rmrf(stage, F);
    // Eski takasların kalıntıları
    try { for (const d of F.readdirSync(root)) if (/^old-\d+$/.test(d)) rmrf(path.join(root, d), F); } catch { /* */ }
    return cur;
  }

  function cancel() { saveState(true); }

  return { pkg: m.pkg, items, prefill, missing, accept, progress, verify, commit, cancel, stage };
}

// Son doğrulanmış kopyanın manifesti (yoksa null)
function currentManifest(root, fsi) {
  return readJson(path.join(root, 'current', 'manifest.json'), fsi);
}
function currentFile(root, p) { return path.join(root, 'current', ...String(p).split('/')); }

/* Aynı birimde sabit bağ (NTFS, ext4, APFS); desteklemeyen dosya
   sisteminde (FAT32/exFAT) ya da bağ reddedilince kopya. */
function linkOrCopy(src, dst, F) {
  const fsi = F || fs;
  try { fsi.unlinkSync(dst); } catch { /* yok */ }
  try { fsi.linkSync(src, dst); return 'link'; } catch { /* kopyaya düş */ }
  fsi.copyFileSync(src, dst);
  return 'copy';
}

/* YEDEK: aktarımın durum makinesi (ağ ve dosya işi dışarıda).
     idle → offered (manifest geldi, operatör listeyi görüyor)
          → transferring (onaylandı) → verifying → done | error
   Video dosyaları (`media`) yalnız operatör ayrıca onaylarsa istenir. */
function createPull(opts) {
  const o = opts || {};
  const window = o.window || 4;
  let st = { state: 'idle', error: '', manifest: null, media: false, inflight: 0, startedAt: 0, bytesAt: [], speed: 0 };
  let rx = null;
  const sent = new Set();
  function summary(m) {
    const by = { presets: { n: 0, bytes: 0 }, logos: { n: 0, bytes: 0 }, media: { n: 0, bytes: 0 } };
    for (const it of m.items) { by[it.kind].n++; by[it.kind].bytes += it.size; }
    return by;
  }
  let haveCache = { pkg: '', set: null };
  function mediaList(m) {
    if (haveCache.pkg !== m.pkg) {
      const cur = o.root ? readJson(path.join(o.root, 'current', 'manifest.json'), o.fs || fs) : null;
      const set = new Set();
      if (cur && Array.isArray(cur.items)) for (const it of cur.items) if (it && it.kind === 'media') set.add(it.path + '|' + it.sha256);
      haveCache = { pkg: m.pkg, set };
    }
    return m.items.filter((it) => it.kind === 'media').slice(0, 100)
      .map((it) => ({ name: it.name, size: it.size, have: haveCache.set.has(it.path + '|' + it.sha256) }));
  }
  /* EKSİK YOKSA HEMEN DOĞRULAMAYA (#812, Linux'ta bulundu). Yeniden
     çekilen paketin her dosyası öncekinden geldiyse (prefill) istek
     çıkmıyordu; doğrulama yalnız parça gelince (chunk) başladığı için
     aktarım %100'de, "transferring" durumunda sonsuza dek kalıyordu.
     Onay ve sürdürme de burada bitişi görüyor; çağıran `finish()`'i çalıştırır. */
  function settle(requests) {
    if (rx && st.state === 'transferring' && !requests.length && st.inflight === 0 && !rx.missing(1).length) st.state = 'verifying';
    return requests;
  }
  function next() {
    if (!rx || st.state !== 'transferring') return [];
    const want = rx.missing(window * 4).filter((r) => !sent.has(r.path + '#' + r.c));
    const out = [];
    for (const r of want) {
      if (st.inflight >= window) break;
      sent.add(r.path + '#' + r.c);
      st.inflight++;
      out.push(r);
    }
    return out;
  }
  return {
    get status() {
      const p = rx ? rx.progress() : null;
      return {
        state: st.state, error: st.error, media: st.media,
        pkg: st.manifest ? st.manifest.pkg : '',
        summary: st.manifest ? summary(st.manifest) : null,
        files: st.manifest ? st.manifest.items.filter((it) => st.media || it.kind !== 'media').slice(0, 200).map((it) => ({ kind: it.kind, name: it.name, size: it.size })) : [],
        /* Videolar kutu işaretlenmeden de listelenir (#812): operatör neyi ve
           ne kadarını kopyalayacağını görsün. `have`: bu makinede aynı özetle
           zaten var (yeniden inmez). */
        mediaFiles: st.manifest ? mediaList(st.manifest) : [],
        progress: p, speed: st.speed,
      };
    },
    offer(manifest) {
      const bad = validateManifest(manifest);
      if (bad) { st = Object.assign(st, { state: 'error', error: 'manifest:' + bad }); return false; }
      st = { state: 'offered', error: '', manifest, media: false, inflight: 0, startedAt: 0, bytesAt: [], speed: 0 };
      haveCache = { pkg: '', set: null };
      rx = null;
      sent.clear();
      return true;
    },
    // Operatör onayladı; `media` ayrıca onaylanmadıysa video dosyaları dışarıda
    confirm(choice, makeReceiver) {
      if (st.state !== 'offered' && st.state !== 'error') return [];
      if (!st.manifest) return [];
      st.media = !!(choice && choice.media);
      const only = st.manifest.items.filter((it) => st.media || it.kind !== 'media').map((it) => it.path);
      rx = makeReceiver(st.manifest, only);
      rx.prefill();
      st.state = 'transferring';
      st.error = '';
      st.inflight = 0;
      st.startedAt = Date.now();
      sent.clear();
      return settle(next());
    },
    // Parça geldi. Dönen: yeni istekler; bitti mi?
    chunk(msg, t) {
      if (st.state !== 'transferring' || !rx || !msg) return { requests: [] };
      st.inflight = Math.max(0, st.inflight - 1);
      const key = msg.path + '#' + msg.c;
      sent.delete(key);
      let err = '';
      try {
        err = rx.accept(msg.path, msg.c, Buffer.from(String(msg.b64 || ''), 'base64'), msg.sha);
      } catch (e) { err = (e && e.code) || 'write'; }
      if (err && err !== 'checksum' && err !== 'length') { st.state = 'error'; st.error = err; return { requests: [] }; }
      const now = Number.isFinite(t) ? t : Date.now();
      const bytes = rx.progress().bytes;
      st.bytesAt.push([now, bytes]);
      while (st.bytesAt.length > 2 && now - st.bytesAt[0][0] > 3000) st.bytesAt.shift();
      const [t0, b0] = st.bytesAt[0];
      st.speed = now > t0 ? Math.round((bytes - b0) / ((now - t0) / 1000)) : 0;
      const requests = next();
      const done = !requests.length && st.inflight === 0 && !rx.missing(1).length;
      if (done) st.state = 'verifying';
      return { requests, done, retried: !!err };
    },
    // Birincil parçayı veremedi (dosya değişti, okunamadı)
    fail(code) { st.state = 'error'; st.error = String(code || 'error').slice(0, 40); st.inflight = 0; if (rx) rx.cancel(); },
    // Bağlantı koptu: kaldığı yerden sürmek için yeniden onay gerekmez
    resume() {
      if (st.state !== 'transferring' && !(st.state === 'error' && rx)) return [];
      st.state = 'transferring'; st.error = ''; st.inflight = 0; sent.clear();
      return settle(next());
    },
    async finish() {
      if (st.state !== 'verifying' || !rx) return false;
      const errors = await rx.verify();
      if (errors.length) {
        // Tutmayan dosyalar yeniden iner
        st.state = 'transferring';
        st.error = '';
        return { retry: next() };
      }
      try { rx.commit(); } catch (e) { st.state = 'error'; st.error = (e && e.code) || 'commit'; return false; }
      st.state = 'done';
      return true;
    },
    cancel() { if (rx) rx.cancel(); st.state = 'idle'; st.inflight = 0; sent.clear(); rx = null; },
  };
}

module.exports = {
  linkOrCopy,
  FORMAT, CHUNK, KINDS, sha256, entryName, hashFile, chunkCount, buildManifest, validateManifest,
  readChunk, retrySync, writeJsonAtomic, readJson, rmrf, createReceiver, currentManifest, currentFile, createPull,
};
