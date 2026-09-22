'use strict';
/* Studio preset deposu (ana süreç).

   Presetler userData/presets/ altında her biri kendi dosyasında tutulur —
   ayar dosyasında DEĞİL. Sebep: settings.json her yapılandırma gönderiminde
   (yani her kaydırıcı hareketinde) baştan yazılıyor; shader kaynağını oraya
   koymak dosyayı gereksiz büyütür ve her sürüklemede kilobaytlarca metni
   yeniden diske yazardı.

   Dosya adı preset kimliğinden türetilir ve dizin dışına çıkamaz.

   ÖNBELLEK (#574). Önceden her `list()` klasördeki bütün dosyaları okuyup
   ayrıştırıyordu ve her kayıt `list()` çağırıyordu. Ölçüldü (10.347 MilkDrop
   preseti, 116 MB): `list()` 3,8 sn, tek bir kaydın turu ana süreci ~2,4 sn
   kilitliyordu. Şimdi dosyalar bir kez okunuyor — açılışta arka planda
   (`warm`) — ve kayıt ile silme önbelleği yerinde güncelliyor. `list()` her
   çağrıda klasörün yalnız ADLARINA bakıyor (10 bin adda milisaniyeler): elle
   eklenen ya da silinen dosya yine görünüyor. Elle DEĞİŞTİRİLEN bir dosya
   uygulama yeniden açılınca görünüyor. */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const MAX_PRESET_BYTES = 512 * 1024; // tek preset üst sınırı (shader metni)
const WRITE_BATCH = 50; // toplu kayıtta aynı anda yazılan dosya

let root = null; // test kancası: `setDir`
function dir() {
  const d = root || path.join(app.getPath('userData'), 'presets');
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

/* Sıra: son değişen önce, eşitlikte kimlik. Sayfalardaki liste
   (shared/presets.js `compare`) aynı kuralla sıralanıyor; değişiklik yayını
   uygulanınca iki taraf aynı sırada kalıyor. */
function compare(a, b) {
  const d = (Number(b && b.updatedAt) || 0) - (Number(a && a.updatedAt) || 0);
  if (d) return d;
  const x = String(a && a.id);
  const y = String(b && b.id);
  return x < y ? -1 : x > y ? 1 : 0;
}

let byFile = null; // dosya adı → preset
let sorted = null; // sıralı liste; değişince null
let warming = null;
/* Arka plan okuması sürerken silinenler: okuma, silmeden ÖNCE aldığı ad
   listesinden bir önbellek kuruyor ve silineni geri getirebilirdi. */
const droppedWhileWarming = new Set();

function names() {
  try { return fs.readdirSync(dir()).filter((f) => f.endsWith('.json')); } catch { return []; }
}

function parse(raw) {
  try {
    const p = JSON.parse(raw);
    return p && typeof p === 'object' && p.id ? p : null;
  } catch { return null; } // bozuk dosya atlanıyor
}

function readOne(name) {
  try { return parse(fs.readFileSync(path.join(dir(), name), 'utf-8')); } catch { return null; }
}

function ensure() {
  if (byFile) return;
  const map = new Map();
  for (const n of names()) {
    const p = readOne(n);
    if (p) map.set(n, p);
  }
  byFile = map;
  sorted = null;
}

/* Açılışta arka planda okuma: ilk `presets:list` isteği binlerce dosyayı
   eşzamanlı okuyup ana süreci tutmasın. Bu arada eşzamanlı bir `ensure()`
   (ör. açılışta bir kayıt) yüklemeyi bitirdiyse onunki kalıyor. */
function warm() {
  if (byFile) return Promise.resolve();
  if (warming) return warming;
  warming = (async () => {
    const map = new Map();
    const ns = names();
    const d = dir();
    for (let i = 0; i < ns.length; i += 64) {
      await Promise.all(ns.slice(i, i + 64).map(async (n) => {
        try {
          const p = parse(await fs.promises.readFile(path.join(d, n), 'utf-8'));
          if (p) map.set(n, p);
        } catch { /* okunamayan dosya atlanıyor */ }
      }));
    }
    for (const n of droppedWhileWarming) map.delete(n);
    droppedWhileWarming.clear();
    if (!byFile) { byFile = map; sorted = null; }
  })();
  return warming;
}

// Klasörle eşitle: yeni adlar okunuyor, kaybolanlar düşüyor
function rescan() {
  const now = names();
  const seen = new Set(now);
  let changed = false;
  for (const n of now) {
    if (byFile.has(n)) continue;
    const p = readOne(n);
    if (p) { byFile.set(n, p); changed = true; }
  }
  for (const n of Array.from(byFile.keys())) {
    if (!seen.has(n)) { byFile.delete(n); changed = true; }
  }
  if (changed) sorted = null;
}

function list() {
  ensure();
  rescan();
  if (!sorted) sorted = Array.from(byFile.values()).sort(compare);
  return sorted.slice();
}

/* Tek preset. Önbellekte yoksa dosyasına bakılıyor: arka plan okuması
   sürerken kaydedilen preset okumanın ad listesinde yok, `list()` onu
   klasör eşitlemesiyle buluyor, `get()` de dosyadan. */
function get(id) {
  const n = safeName(id);
  if (!n) return null;
  ensure();
  const name = n + '.json';
  let p = byFile.get(name) || null;
  if (!p && fs.existsSync(path.join(dir(), name))) {
    p = readOne(name);
    if (p) { byFile.set(name, p); sorted = null; }
  }
  return p;
}

/* Kaydın hazırlığı: doğrulama, kimlik ve zaman damgası. `stamp` verilirse
   o (toplu kayıtta paketin kendi sırası korunsun diye), yoksa şimdi. */
function prepare(preset, stamp) {
  if (!preset || typeof preset !== 'object') return { ok: false, error: 'INVALID' };
  const p = Object.assign({}, preset);
  p.builtin = false;
  if (!p.id) p.id = 'usr_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 65536).toString(36);
  p.updatedAt = typeof stamp === 'number' ? stamp : Date.now();
  if (!p.createdAt) p.createdAt = p.updatedAt;
  const file = fileFor(p.id);
  if (!file) return { ok: false, error: 'BAD_ID' };
  const json = JSON.stringify(p, null, 2);
  if (Buffer.byteLength(json, 'utf-8') > MAX_PRESET_BYTES) {
    return { ok: false, error: 'TOO_LARGE' };
  }
  return { ok: true, p, file, json };
}

function remember(file, p) {
  if (!byFile) return; // henüz okunmadı: dosya ilk okumada gelecek
  byFile.set(path.basename(file), p);
  sorted = null;
}

function save(preset) {
  const r = prepare(preset);
  if (!r.ok) return r;
  try {
    fs.writeFileSync(r.file, r.json, 'utf-8');
    remember(r.file, r.p);
    return { ok: true, preset: r.p };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function remove(id) {
  const file = fileFor(id);
  if (!file) return { ok: false, error: 'BAD_ID' };
  try {
    fs.unlinkSync(file);
    if (byFile) { byFile.delete(path.basename(file)); sorted = null; } else if (warming) droppedWhileWarming.add(path.basename(file));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Birden çok preseti tek seferde ekler (eşzamanlı; küçük listeler için)
function saveMany(presets) {
  const saved = [];
  for (const p of presets || []) {
    const r = save(p);
    if (r.ok) saved.push(r.preset);
  }
  return saved;
}

/* BÜYÜK İÇE AKTARIM (#574). Dosyalar parça parça ve aralarda beklenerek
   yazılıyor; ana süreç o arada başka işlere (ses, ışık, IPC) dönebiliyor.
   Ölçüldü: 10.347 preset eşzamanlı yazımla ana süreci 7,3 sn tutuyordu.
   Sıra paketin kendi sırası: ilk preset en yeni damgayı alıyor ve listede
   önce geliyor. `onProgress(bitti, toplam)` her parçadan sonra. */
async function saveManyAsync(presets, onProgress) {
  const all = Array.isArray(presets) ? presets : [];
  const saved = [];
  const base = Date.now();
  for (let i = 0; i < all.length; i += WRITE_BATCH) {
    const part = all.slice(i, i + WRITE_BATCH);
    const rs = await Promise.all(part.map(async (preset, k) => {
      const r = prepare(preset, base - (i + k));
      if (!r.ok) return null;
      try {
        await fs.promises.writeFile(r.file, r.json, 'utf-8');
        remember(r.file, r.p);
        return r.p;
      } catch { return null; }
    }));
    for (const p of rs) if (p) saved.push(p);
    if (typeof onProgress === 'function') onProgress(Math.min(all.length, i + WRITE_BATCH), all.length);
    await new Promise((res) => setImmediate(res));
  }
  return saved;
}

// Test kancası: depoyu başka bir klasöre yönelt ve önbelleği boşalt
function setDir(d) {
  root = d || null;
  byFile = null;
  sorted = null;
  warming = null;
  droppedWhileWarming.clear();
}

module.exports = { list, get, save, saveMany, saveManyAsync, remove, dir, warm, compare, setDir };
