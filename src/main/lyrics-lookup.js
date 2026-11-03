/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* OTOMATİK SÖZ BULMA (#937).

   Sıra:
     1. yan dosya  — sesle aynı klasörde aynı adlı .lrc / .srt
     2. gömülü     — ID3 USLT/SYLT, Vorbis LYRICS, MP4 ©lyr
     3. önbellek   — daha önce sağlayıcıdan gelen söz (uygulama verisinde .lrc)
     4. sağlayıcı  — kullanıcının TANIMLADIĞI adresler, sırayla, süre sınırlı

   Önbellek sağlayıcıdan ÖNCE bakılır: aynı parça için ağa ikinci kez
   çıkılmasın. Sağlayıcı listesi varsayılan BOŞTUR; liste boşken hiçbir ağ
   isteği yapılmaz. Hiçbir adım hata atmaz: söz bulunamaması oynatmayı ya da
   dışa aktarmayı durdurmaz, yalnız `null` döner.

   Electron'a dokunmaz: fs, fetch ve etiket okuyucu dışarıdan verilebilir;
   testler ağsız ve pencere açmadan koşar. */

const nodeFs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LYRIC_EXT = ['.lrc', '.srt'];
const MAX_BYTES = 1024 * 1024;
const MAX_PROVIDERS = 8;

// ---------------------------------------------------------------- ayarlar
function sanitizeConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const providers = (Array.isArray(c.providers) ? c.providers : []).slice(0, MAX_PROVIDERS)
    .filter((p) => p && typeof p.url === 'string' && /^https?:\/\//i.test(p.url.trim()))
    .map((p) => ({
      name: String(p.name || '').slice(0, 60),
      url: p.url.trim().slice(0, 1000),
      enabled: p.enabled !== false,
      format: p.format === 'json' ? 'json' : 'lrc',
      path: String(p.path || '').slice(0, 200),
    }));
  const t = Number(c.timeoutMs);
  return {
    enabled: c.enabled === true,
    sidecar: c.sidecar !== false,
    embedded: c.embedded !== false,
    cache: c.cache !== false,
    providers,
    timeoutMs: isFinite(t) && t >= 500 ? Math.min(20000, t) : 4000,
  };
}

// ---------------------------------------------------------------- şablon
/* {artist} {title} {album} {duration} yer tutucuları URL kodlanarak
   doldurulur; bilinmeyen yer tutucu boş kalır. */
function fillTemplate(url, meta) {
  const m = meta || {};
  const val = {
    artist: m.artist || '',
    title: m.title || '',
    album: m.album || '',
    duration: m.duration > 0 ? String(Math.round(m.duration)) : '',
  };
  return String(url).replace(/\{(\w+)\}/g, (all, k) => encodeURIComponent(val[k] != null ? val[k] : ''));
}

// "a.b.0.c" — JSON içinde nokta yolu; dizi sırası sayıyla
function pickPath(obj, p) {
  if (!p) return obj;
  let cur = obj;
  for (const k of String(p).split('.')) {
    if (cur == null) return undefined;
    cur = cur[/^\d+$/.test(k) && Array.isArray(cur) ? Number(k) : k];
  }
  return cur;
}

function looksLikeLyrics(text) {
  const s = String(text || '').trim();
  return s.length > 0 && s.length <= MAX_BYTES;
}
// Sağlayıcı 200 ile hata sayfası da dönebilir: biçimlendirme söz değildir, önbelleğe de girmez
function plausibleLyrics(text) {
  return looksLikeLyrics(text) && !/^\s*(?:<(?:!doctype|html|\?xml|head|body)\b|\{)/i.test(text);
}

// ---------------------------------------------------------------- yan dosya
function findSidecar(audioPath, fsx) {
  const f = fsx || nodeFs;
  if (!audioPath) return null;
  const dir = path.dirname(audioPath);
  const stem = path.basename(audioPath, path.extname(audioPath));
  let names;
  try { names = f.readdirSync(dir); } catch { return null; }
  // Büyük/küçük harf farkı (Şarkı.LRC) sayılmaz; .lrc .srt'nin önünde
  for (const ext of LYRIC_EXT) {
    const hit = names.find((n) => path.extname(n).toLowerCase() === ext
      && path.basename(n, path.extname(n)).toLowerCase() === stem.toLowerCase());
    if (!hit) continue;
    try {
      const file = path.join(dir, hit);
      if (f.statSync(file).size > MAX_BYTES) continue;
      const text = f.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
      if (looksLikeLyrics(text)) return { text, file };
    } catch { /* okunamayan yan dosya atlanır */ }
  }
  return null;
}

// ---------------------------------------------------------------- ID3v2
function syncsafe(b, i) {
  return ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);
}
function decodeText(buf, enc) {
  if (!buf || !buf.length) return '';
  if (enc === 1 || enc === 2) {
    let b = buf;
    let le = enc === 1;
    if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) { le = true; b = b.slice(2); }
    else if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) { le = false; b = b.slice(2); }
    if (!le) {
      const sw = Buffer.alloc(b.length - (b.length % 2));
      for (let i = 0; i + 1 < b.length; i += 2) { sw[i] = b[i + 1]; sw[i + 1] = b[i]; }
      b = sw;
    }
    return b.slice(0, b.length - (b.length % 2)).toString('utf16le');
  }
  if (enc === 3) return buf.toString('utf8');
  return buf.toString('latin1');
}
// Kodlamaya göre sonlandırıcıya kadar oku: { text, next }
function readTerminated(buf, pos, enc) {
  const wide = enc === 1 || enc === 2;
  let i = pos;
  if (wide) {
    while (i + 1 < buf.length && !(buf[i] === 0 && buf[i + 1] === 0)) i += 2;
    return { text: decodeText(buf.slice(pos, i), enc), next: Math.min(buf.length, i + 2) };
  }
  while (i < buf.length && buf[i] !== 0) i++;
  return { text: decodeText(buf.slice(pos, i), enc), next: Math.min(buf.length, i + 1) };
}

function lrcStamp(sec) {
  const cs = Math.round(Math.max(0, sec) * 100);
  const pad = (n, w) => String(Math.floor(n)).padStart(w, '0');
  return '[' + pad(cs / 6000, 2) + ':' + pad((cs / 100) % 60, 2) + '.' + pad(cs % 100, 2) + ']';
}

/* SYLT: zamanlı söz. Zaman biçimi 2 = milisaniye; 1 = MPEG karesi (sesin
   kare süresi bilinmediği için atlanır). Girdinin başındaki satır sonu o
   girdiden, sonundaki bir sonrakinden yeni satır başlatır; öbürleri aynı
   satıra hece olarak eklenir. Etikette hiç satır sonu yoksa her girdi bir
   satırdır: çoğu araç satır satır böyle yazıyor. */
function syltToLrc(body) {
  if (!body || body.length < 6) return '';
  const enc = body[0];
  const fmt = body[4];
  if (fmt !== 2) return '';
  let pos = 6;
  pos = readTerminated(body, pos, enc).next; // içerik tanımı
  const items = [];
  while (pos < body.length) {
    const r = readTerminated(body, pos, enc);
    pos = r.next;
    if (pos + 4 > body.length) break;
    const ms = body.readUInt32BE(pos);
    pos += 4;
    items.push({ t: ms / 1000, text: r.text });
  }
  if (!items.length) return '';
  const lines = [];
  let cur = null;
  let breakNext = false;
  const noBreaks = !items.some((it) => /[\r\n]/.test(it.text));
  for (const it of items) {
    const txt = it.text.replace(/\r/g, '');
    const starts = noBreaks || breakNext || /^\n/.test(txt) || !cur;
    breakNext = /\n$/.test(txt);
    const clean = txt.replace(/\n/g, '');
    if (starts) { cur = { t: it.t, words: [] }; lines.push(cur); }
    cur.words.push({ t: it.t, text: clean });
  }
  const pad = (s) => s.slice(1, -1);
  return lines.map((l) => {
    if (l.words.length < 2) return lrcStamp(l.t) + l.words.map((w) => w.text).join('').trim();
    return lrcStamp(l.t) + l.words.map((w) => '<' + pad(lrcStamp(w.t)) + '>' + w.text).join('');
  }).join('\n');
}

/* Dosya başındaki ID3v2 etiketinden { synced, unsynced } — yalnız
   v2.3/v2.4 (v2.2 çok eski ve sözü pratikte taşımıyor). */
function parseId3Lyrics(buf) {
  const out = { synced: '', unsynced: '' };
  if (!buf || buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return out;
  const ver = buf[3];
  if (ver !== 3 && ver !== 4) return out;
  const flags = buf[5];
  const size = syncsafe(buf, 6);
  const end = Math.min(buf.length, 10 + size);
  let pos = 10;
  if (flags & 0x40) pos += ver === 4 ? syncsafe(buf, 10) : buf.readUInt32BE(10) + 4;
  while (pos + 10 <= end) {
    const id = buf.toString('latin1', pos, pos + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const fsz = ver === 4 ? syncsafe(buf, pos + 4) : buf.readUInt32BE(pos + 4);
    const body = buf.slice(pos + 10, Math.min(end, pos + 10 + fsz));
    pos += 10 + fsz;
    if (fsz <= 0) continue;
    try {
      if (id === 'USLT' && !out.unsynced && body.length > 4) {
        const enc = body[0];
        const desc = readTerminated(body, 4, enc);
        out.unsynced = decodeText(body.slice(desc.next), enc).replace(/\u0000+$/, '').trim();
      } else if (id === 'SYLT' && !out.synced) {
        out.synced = syltToLrc(body);
      }
    } catch { /* bozuk çerçeve atlanır */ }
  }
  return out;
}

function readHead(file, fsx, bytes) {
  const f = fsx || nodeFs;
  let fd = null;
  try {
    fd = f.openSync(file, 'r');
    const head = Buffer.alloc(10);
    if (f.readSync(fd, head, 0, 10, 0) < 10 || head.toString('latin1', 0, 3) !== 'ID3') return null;
    const want = Math.min(bytes || 4 * 1024 * 1024, 10 + syncsafe(head, 6));
    const buf = Buffer.alloc(want);
    const n = f.readSync(fd, buf, 0, want, 0);
    return buf.slice(0, n);
  } catch {
    return null;
  } finally {
    if (fd != null) try { f.closeSync(fd); } catch { /* yok */ }
  }
}

/* Gömülü söz: önce ID3 (SYLT zamanlı olduğu için USLT'nin önünde), sonra
   ffmpeg'in okuduğu Vorbis/MP4 etiketi (`tags.lyrics`). Zamanlı olan, düz
   metne tercih edilir. */
function findEmbedded(audioPath, tags, fsx) {
  const id3 = audioPath ? parseId3Lyrics(readHead(audioPath, fsx)) : { synced: '', unsynced: '' };
  const fromTags = tags && typeof tags.lyrics === 'string' ? tags.lyrics.trim() : '';
  const timed = (s) => /\[\d{1,3}:\d{1,2}/.test(s) || /-->/.test(s);
  const pool = [id3.synced, fromTags, id3.unsynced].filter(looksLikeLyrics);
  const best = pool.find(timed) || pool[0];
  return best ? { text: best } : null;
}

// ---------------------------------------------------------------- önbellek
function cacheKey(meta) {
  const m = meta || {};
  const norm = (s) => String(s || '').trim().toLowerCase();
  if (!norm(m.title)) return '';
  return crypto.createHash('sha1').update([norm(m.artist), norm(m.title), norm(m.album)].join('\u0001')).digest('hex').slice(0, 24);
}
function readCache(dir, meta, fsx) {
  const f = fsx || nodeFs;
  const k = cacheKey(meta);
  if (!dir || !k) return null;
  try {
    const text = f.readFileSync(path.join(dir, k + '.lrc'), 'utf8');
    return looksLikeLyrics(text) ? { text } : null;
  } catch { return null; }
}
function writeCache(dir, meta, text, fsx) {
  const f = fsx || nodeFs;
  const k = cacheKey(meta);
  if (!dir || !k || !looksLikeLyrics(text)) return false;
  try {
    f.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, k + '.lrc');
    f.writeFileSync(file + '.tmp', text, 'utf8');
    f.renameSync(file + '.tmp', file);
    return true;
  } catch { return false; }
}

// Yalnız önbellek dosyaları silinir (anahtar biçimi: cacheKey)
function clearCache(dir, fsx) {
  const f = fsx || nodeFs;
  let names;
  try { names = f.readdirSync(dir); } catch { return 0; }
  let n = 0;
  for (const name of names) {
    if (!/^[0-9a-f]{24}\.lrc$/.test(name)) continue;
    try { f.unlinkSync(path.join(dir, name)); n++; } catch { /* */ }
  }
  return n;
}

// ---------------------------------------------------------------- sağlayıcı
async function fetchProvider(p, meta, opts) {
  const fetchFn = opts.fetch || (typeof fetch === 'function' ? fetch : null);
  if (!fetchFn) return null;
  const url = fillTemplate(p.url, meta);
  if (!/^https?:\/\//i.test(url)) return null;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => { if (ctrl) ctrl.abort(); resolve(null); }, opts.timeoutMs); });
  const work = (async () => {
    const res = await fetchFn(url, { signal: ctrl ? ctrl.signal : undefined, headers: { Accept: p.format === 'json' ? 'application/json' : 'text/plain' } });
    if (!res || !res.ok) return null;
    const body = await res.text();
    if (!body || body.length > MAX_BYTES) return null;
    if (p.format === 'json') {
      const v = pickPath(JSON.parse(body), p.path);
      return typeof v === 'string' && plausibleLyrics(v) ? v : null;
    }
    return plausibleLyrics(body) ? body : null;
  })().catch(() => null);
  try { return await Promise.race([work, timeout]); } finally { clearTimeout(timer); }
}

/* Ana giriş. opts: { audioPath, meta:{artist,title,album,duration}, tags,
   config, cacheDir, fs, fetch }. Dönüş: { text, source, provider? } | null */
async function lookup(opts) {
  const o = opts || {};
  const cfg = sanitizeConfig(o.config);
  if (!cfg.enabled) return null;
  const fsx = o.fs || nodeFs;
  const meta = o.meta || {};
  try {
    if (cfg.sidecar && o.audioPath) {
      const s = findSidecar(o.audioPath, fsx);
      if (s) return { text: s.text, source: 'sidecar' };
    }
    if (cfg.embedded && (o.audioPath || o.tags)) {
      const e = findEmbedded(o.audioPath, o.tags, fsx);
      if (e) return { text: e.text, source: 'embedded' };
    }
    if (cfg.cache) {
      const c = readCache(o.cacheDir, meta, fsx);
      if (c) return { text: c.text, source: 'cache' };
    }
    if (!meta.title) return null;
    for (const p of cfg.providers) {
      if (!p.enabled) continue;
      const text = await fetchProvider(p, meta, { fetch: o.fetch, timeoutMs: cfg.timeoutMs });
      if (text) {
        if (cfg.cache) writeCache(o.cacheDir, meta, text, fsx);
        return { text, source: 'provider', provider: p.name || p.url };
      }
    }
  } catch { /* söz bulunamadı; oynatma etkilenmez */ }
  return null;
}

module.exports = {
  sanitizeConfig, fillTemplate, pickPath, findSidecar, parseId3Lyrics, syltToLrc,
  findEmbedded, cacheKey, readCache, writeCache, clearCache, fetchProvider, lookup,
};
