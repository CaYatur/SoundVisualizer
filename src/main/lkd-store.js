'use strict';
/* Pioneer / .lkd görsel kütüphanesinin dosya çözümü.
 *
 * milkdrop-textures.js ile aynı gerekçe: kapsam denetiminin testin
 * çalıştırabildiği tek yer burası (main.js Electron olmadan yüklenemez).
 * Renderer yalnızca bir kimlik (id) yollar; bu modül kimliği İZİN VERİLEN
 * köklerden birinin içindeki gerçek bir dosyaya çözer, dizin dışına
 * çıkışı reddeder ve baytları döndürür.
 *
 * İki yerleşik kök: uygulamayla gelen GIF'ler ve örnek .lkd dosyaları.
 * Bir de kullanıcının kendi .lkd klasörü (ayarlardan) — böylece kullanıcı
 * sonradan kendi animasyonlarını ekleyebilir. */
const fs = require('fs');
const path = require('path');

const EXT = ['.gif', '.lkd'];
const MIME = { '.gif': 'image/gif', '.lkd': 'application/octet-stream' };
const MAX_BYTES = 24 * 1024 * 1024;

// Uygulama kökünden yerleşik varlıklar: src/main -> ../../assets/lkd/pioneer
const BUILTIN_DIR = path.join(__dirname, '..', '..', 'assets', 'lkd', 'pioneer');
const SAMPLES_DIR = path.join(BUILTIN_DIR, 'samples');

function kindOf(name) {
  return path.extname(String(name || '')).toLowerCase() === '.lkd' ? 'lkd' : 'gif';
}
function isClip(name) {
  return EXT.indexOf(path.extname(String(name || '')).toLowerCase()) >= 0;
}
function mimeFor(name) {
  return MIME[path.extname(String(name || '')).toLowerCase()] || 'application/octet-stream';
}

/* Dosya adından okunabilir bir etiket üretir; manifest.json varsa oradaki
   etiket önceliklidir. "color_02_greatbarrierreef_clean" -> "Great Barrier
   Reef" gibi. */
function prettify(base) {
  let s = base.replace(/\.(gif|lkd)$/i, '');
  s = s.replace(/_(clean|glow)$/i, '');
  s = s.replace(/^(alt|color)_/i, '');
  s = s.replace(/^\d+_/, '');
  s = s.replace(/_/g, ' ').trim();
  return s.replace(/\b\w/g, (c) => c.toUpperCase()) || base;
}

function loadManifest() {
  try {
    const raw = fs.readFileSync(path.join(BUILTIN_DIR, 'manifest.json'), 'utf8');
    const j = JSON.parse(raw);
    return (j && j.clips) || {};
  } catch { return {}; }
}

// İzin verilen kök içindeki bir dosyayı güvenle çözer (yol kaçışına karşı).
function resolveWithin(root, name) {
  if (!root || typeof root !== 'string') return '';
  if (typeof name !== 'string' || !name || name === '.' || name === '..') return '';
  if (/[\\/]/.test(name) || /^[A-Za-z]:/.test(name)) return '';
  if (!isClip(name)) return '';
  const base = path.resolve(root);
  const file = path.resolve(base, name);
  const rel = path.relative(base, file);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return '';
  return file;
}

function listDir(dir, source) {
  const manifest = source === 'builtin' ? loadManifest() : {};
  let names = [];
  try { names = fs.readdirSync(dir).filter(isClip); } catch { return []; }
  return names.map((name) => {
    const m = manifest[name] || {};
    return {
      id: source + ':' + name,
      name: name,
      kind: kindOf(name),
      source: source,
      label: m.label || prettify(name),
      labelTr: m.labelTr || m.label || prettify(name),
      order: typeof m.order === 'number' ? m.order : 1000,
    };
  });
}

/* Yerleşik GIF + örnek .lkd + (varsa) kullanıcı klasörü. */
function listClips(userDir) {
  const out = listDir(BUILTIN_DIR, 'builtin').concat(listDir(SAMPLES_DIR, 'builtin'));
  if (userDir && typeof userDir === 'string') out.push.apply(out, listDir(userDir, 'user'));
  out.sort((a, b) => (a.order - b.order) || a.label.localeCompare(b.label));
  return out;
}

/* Kimlikten doğrulanmış dosya: `source:filename`. */
function resolveClip(id, userDir) {
  if (typeof id !== 'string') return null;
  const ix = id.indexOf(':');
  if (ix < 0) return null;
  const source = id.slice(0, ix);
  const name = id.slice(ix + 1);
  let file = '';
  if (source === 'builtin') {
    file = resolveWithin(BUILTIN_DIR, name) || resolveWithin(SAMPLES_DIR, name);
  } else if (source === 'user' && userDir) {
    file = resolveWithin(userDir, name);
  }
  if (!file) return null;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || !(st.size <= MAX_BYTES)) return null;
  } catch { return null; }
  return { id: id, file: file, kind: kindOf(name), mime: mimeFor(name) };
}

function readClip(id, userDir) {
  const c = resolveClip(id, userDir);
  if (!c) return null;
  try {
    return { id: c.id, kind: c.kind, mime: c.mime, b64: fs.readFileSync(c.file).toString('base64') };
  } catch { return null; }
}

module.exports = {
  BUILTIN_DIR, SAMPLES_DIR, EXT,
  kindOf, isClip, mimeFor, prettify,
  resolveWithin, listClips, resolveClip, readClip,
};
