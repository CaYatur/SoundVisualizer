'use strict';
/* Studio preset deposu (ana süreç).

   Presetler userData/presets/ altında her biri kendi dosyasında tutulur —
   ayar dosyasında DEĞİL. Sebep: settings.json her yapılandırma gönderiminde
   (yani her kaydırıcı hareketinde) baştan yazılıyor; shader kaynağını oraya
   koymak dosyayı gereksiz büyütür ve her sürüklemede kilobaytlarca metni
   yeniden diske yazardı.

   Dosya adı preset kimliğinden türetilir ve dizin dışına çıkamaz. */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const MAX_PRESET_BYTES = 512 * 1024; // tek preset üst sınırı (shader metni)

function dir() {
  const d = path.join(app.getPath('userData'), 'presets');
  try { fs.mkdirSync(d, { recursive: true }); } catch { /* zaten var */ }
  return d;
}

// Kimlikten güvenli dosya adı: yalnızca harf/rakam/alt çizgi/tire.
// Dışarıdan gelen bir kimliğin ".." ile dizin dışına çıkmasını engeller.
function safeName(id) {
  const s = String(id || '').replace(/[^A-Za-z0-9_-]/g, '');
  return s ? s.slice(0, 80) : null;
}

function fileFor(id) {
  const n = safeName(id);
  return n ? path.join(dir(), n + '.json') : null;
}

function list() {
  let names = [];
  try { names = fs.readdirSync(dir()).filter((f) => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const n of names) {
    try {
      const raw = fs.readFileSync(path.join(dir(), n), 'utf-8');
      const p = JSON.parse(raw);
      if (p && p.id) out.push(p);
    } catch { /* bozuk dosyayı atla */ }
  }
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return out;
}

function save(preset) {
  if (!preset || typeof preset !== 'object') return { ok: false, error: 'INVALID' };
  const p = Object.assign({}, preset);
  p.builtin = false;
  if (!p.id) p.id = 'usr_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 65536).toString(36);
  p.updatedAt = Date.now();
  if (!p.createdAt) p.createdAt = p.updatedAt;
  const file = fileFor(p.id);
  if (!file) return { ok: false, error: 'BAD_ID' };
  const json = JSON.stringify(p, null, 2);
  if (Buffer.byteLength(json, 'utf-8') > MAX_PRESET_BYTES) {
    return { ok: false, error: 'TOO_LARGE' };
  }
  try {
    fs.writeFileSync(file, json, 'utf-8');
    return { ok: true, preset: p };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function remove(id) {
  const file = fileFor(id);
  if (!file) return { ok: false, error: 'BAD_ID' };
  try {
    fs.unlinkSync(file);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Birden çok preseti tek seferde ekler (paket içe aktarımı)
function saveMany(presets) {
  const saved = [];
  for (const p of presets || []) {
    const r = save(p);
    if (r.ok) saved.push(r.preset);
  }
  return saved;
}

module.exports = { list, save, saveMany, remove, dir };
