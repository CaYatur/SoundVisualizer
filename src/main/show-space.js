/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* YALITILMIŞ GÖSTERİ ALANI (#812). Yedek, birincilden gelen görüntüyü ve
   gösteriyi KENDİ gösterisinin üstüne yazmaz.

   Eskiden (#540) birincilin sahnesi, kayıtlı sahneleri, Studio presetleri,
   zaman çizelgesi ve Clip Deck'i yedeğin `settings.json`'ına yazılıyordu:
   bir makineyi bir geceliğine yedek yapmak onun kendi gösterisini siliyordu.
   Şimdi yedeklilik klasöründe (userData/redundancy) iki ayrı dosya var:

     local-show.json    — bu makinenin KENDİ gösterisi (show-keys REPLICATED).
                          Yedek rolüne ilk geçişte ayarlardan alınır; yedek
                          rolü sürdükçe settings.json'a hep bu yazılır.
     primary-show.json  — birincilden gelen son kopya. Yedek yeniden açılırsa
                          (birincil kapalıyken bile) devralma bunu kullanır.
     package/           — gösteri paketi (show-package.js): birincilin
                          presetleri, logoları ve video dosyaları.

   Bellekteki yapılandırma (pencerelerin çizdiği) hangi gösteri SEÇİLİYSE
   onu taşır: izlerken birincilinki, yetkiyi yerel gösteriyle alınca yerel.
   Diske giden görünüm `forDisk` ile kurulur. Rol bırakılınca yerel gösteri
   olduğu gibi geri konur; dosya silinmez, `local-show.restored-*.json`
   adıyla kalır.

   GEÇİŞ: bu sürümden önce yedek olarak çalışmış bir makinenin
   settings.json'ında birincilin eski kopyası duruyor olabilir; hangisinin
   yerel olduğunu ayırt edecek bir iz yok. İlk açılışta ayarlarda ne varsa
   yerel gösteri o sayılır ve hiçbir şey silinmez. */
const fs = require('fs');
const path = require('path');
const ShowKeys = require('../shared/show-keys');
const Pkg = require('./show-package');

const FORMAT = 1;
const KEEP_ARCHIVES = 20;

function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

function createShowSpace(dir, opts) {
  const F = (opts && opts.fs) || fs;
  const localFile = path.join(dir, 'local-show.json');
  const primaryFile = path.join(dir, 'primary-show.json');
  const pkgRoot = path.join(dir, 'package');
  let local = null;
  let primary = null;

  function readShow(file) {
    const j = Pkg.readJson(file, F);
    if (!j || typeof j !== 'object' || !j.show || typeof j.show !== 'object') return null;
    return j;
  }

  function loadLocal() {
    if (!local) local = readShow(localFile);
    return local;
  }
  let primaryText = null; // son kopya, diske yazılmayı beklerken bellekte
  function loadPrimary() {
    if (!primary && primaryText) {
      try { primary = JSON.parse(primaryText); } catch { primary = null; }
    }
    if (!primary) primary = readShow(primaryFile);
    return primary;
  }

  /* Yedek rolüne geçiş: yerel gösteri yoksa ayarlardakinden alınır. Varsa
     (önceki oturumdan) dokunulmaz — ayarlarda o an birincilin kopyası
     olabilir. Yazıldıysa true. */
  function captureLocal(cfg) {
    if (loadLocal()) return false;
    local = { format: FORMAT, capturedAt: Date.now(), show: ShowKeys.pick(cfg, ShowKeys.REPLICATED) };
    Pkg.writeJsonAtomic(localFile, local, F);
    return true;
  }

  function saveLocal(show) {
    local = { format: FORMAT, capturedAt: (local && local.capturedAt) || Date.now(), updatedAt: Date.now(), show: clone(show) || {} };
    Pkg.writeJsonAtomic(localFile, local, F);
  }

  /* İZLERKEN OLAY DÖNGÜSÜ BEKLEMESİN (#812). Birincilin her değişikliğinde
     kopya yazılıyordu: iki kez JSON'a çevirme, bir kez geri ayrıştırma ve
     girintili, eşzamanlı bir dosya yazımı. Windows'ta virüs taraması her
     yeni dosyayı tutarken bu, kalp atışının ve karelerin işlendiği iş
     parçacığını durdurur. Burada çağıranın zaten ürettiği JSON metni
     kullanılır; dosya arka planda yazılır, üst üste gelen yazımlardan
     yalnız sonuncusu gider. Bellekteki kopya hemen günceldir. */
  let writing = null;
  let queued = null;
  function savePrimaryJson(showJson, meta) {
    const m = meta || {};
    primaryText = '{"format":' + FORMAT + ',"version":' + JSON.stringify(String(m.version || '')) +
      ',"receivedAt":' + Date.now() + ',"show":' + (showJson || '{}') + '}\n';
    primary = null;
    queued = primaryText;
    if (!writing) writing = drain();
    return writing;
  }
  async function drain() {
    const P = F.promises || fs.promises;
    try {
      while (queued != null) {
        const text = queued;
        queued = null;
        const tmp = primaryFile + '.' + process.pid + '.' + Date.now().toString(36) + '.tmp';
        try {
          await P.mkdir(path.dirname(primaryFile), { recursive: true });
          await P.writeFile(tmp, text, 'utf-8');
          // Windows: dosyayı başka biri kısa süre tutuyorsa yeniden dene
          for (let i = 0; ; i++) {
            try { await P.rename(tmp, primaryFile); break; } catch (e) {
              if (i >= 8 || !(e && (e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES'))) throw e;
              await new Promise((r) => setTimeout(r, 25 * (i + 1)));
            }
          }
        } catch (e) {
          try { await P.unlink(tmp); } catch { /* */ }
          if (opts && typeof opts.onError === 'function') opts.onError(e);
        }
      }
    } finally {
      writing = null;
    }
  }
  // Bekleyen yazım bitsin (kapanış, test)
  function flushPrimary() { return writing || Promise.resolve(); }

  function savePrimary(show, meta) {
    primary = Object.assign({ format: FORMAT }, meta || {}, { receivedAt: Date.now(), show: clone(show) || {} });
    Pkg.writeJsonAtomic(primaryFile, primary, F);
  }

  /* Gösteriyi yapılandırmaya yerleştirir: listede olmayan aktarılan anahtar
     silinir (gösterinin parçası değildi). Değişen anahtarları döndürür. */
  function place(cfg, show) {
    const part = {};
    for (const k of ShowKeys.REPLICATED) part[k] = Object.prototype.hasOwnProperty.call(show || {}, k) ? show[k] : undefined;
    return ShowKeys.apply(cfg, part);
  }

  // Diske gidecek yapılandırma: aktarılan anahtarlar yerel gösteriden
  function forDisk(cfg) {
    const l = loadLocal();
    if (!l || !cfg) return cfg;
    const out = Object.assign({}, cfg);
    place(out, l.show);
    return out;
  }

  /* Rol bırakıldı: yerel gösteri yapılandırmaya döner. Dosya silinmez,
     arşivlenir; bir sonraki yedek oturumu yerel gösteriyi yeniden alır. */
  function restoreLocal(cfg) {
    const l = loadLocal();
    if (!l) return null;
    const changed = place(cfg, l.show);
    try {
      Pkg.retrySync(() => F.renameSync(localFile, path.join(dir, 'local-show.restored-' + Date.now() + '.json')));
    } catch { /* yerinde kalır; sonraki yedek oturumu onu kullanır */ }
    local = null;
    pruneArchives();
    return changed;
  }

  /* Birincilin kayıtlı sahnesini yerel gösteriye ekler (operatör onayladı).
     Aynı kimlik yerelde varsa YENİ kimlik alır; yerel sahne değişmez. */
  function importScene(scene) {
    const l = loadLocal();
    if (!l || !scene || typeof scene !== 'object') return null;
    const show = clone(l.show) || {};
    const list = Array.isArray(show.scenes) ? show.scenes : [];
    const copy = clone(scene);
    const ids = new Set(list.map((s) => s && s.id));
    if (!copy.id || ids.has(copy.id)) {
      let n = 2;
      const base = String(copy.id || 'scene');
      while (ids.has(base + '-p' + n)) n++;
      copy.id = base + '-p' + n;
    }
    list.push(copy);
    show.scenes = list;
    saveLocal(show);
    return copy;
  }

  /* ARŞİVDEN GERİ YÜKLEME (#812). Rol her kapanışta yerel gösteriyi
     `local-show.restored-<zaman>.json` olarak arşivliyor; operatör
     bunlardan birini panelden onayla geri yükleyebilir. Ad katı biçimde
     denetlenir: klasör dışına ya da başka dosyaya çıkılamaz. */
  const ARCHIVE_RE = /^local-show\.restored-(\d{1,16})\.json$/;
  function listArchives() {
    let names = [];
    try { names = F.readdirSync(dir); } catch { return []; }
    const out = [];
    for (const name of names) {
      const m = ARCHIVE_RE.exec(name);
      if (!m) continue;
      let size = 0;
      try { size = F.statSync(path.join(dir, name)).size; } catch { continue; }
      out.push({ name, at: Number(m[1]), size });
    }
    return out.sort((a, b) => b.at - a.at);
  }
  function readArchive(name) {
    if (typeof name !== 'string' || !ARCHIVE_RE.test(name)) return null;
    const j = readShow(path.join(dir, name));
    if (!j) return null;
    const count = Array.isArray(j.show.scenes) ? j.show.scenes.length : 0;
    return { name, show: j.show, scenes: count, capturedAt: j.capturedAt || 0 };
  }
  // Geri yüklemeden önce o anki gösteri de arşivlenir: geri yükleme geri alınabilir
  function archiveShow(show) {
    let t = Date.now();
    while (F.existsSync(path.join(dir, 'local-show.restored-' + t + '.json'))) t++;
    const name = 'local-show.restored-' + t + '.json';
    F.mkdirSync(dir, { recursive: true });
    Pkg.writeJsonAtomic(path.join(dir, name), { format: FORMAT, capturedAt: Date.now(), show: clone(show) || {} }, F);
    pruneArchives();
    return name;
  }
  /* Arşivler sınırsız birikmesin: rol her kapanışta bir tane yazılıyor,
     prova haftalarında yüzlercesi olurdu. En yeni KEEP_ARCHIVES kalır. */
  function pruneArchives() {
    for (const a of listArchives().slice(KEEP_ARCHIVES)) {
      try { F.unlinkSync(path.join(dir, a.name)); } catch { /* sonra */ }
    }
  }

  function summary() {
    const l = loadLocal();
    const p = loadPrimary();
    const count = (s) => (s && Array.isArray(s.scenes) ? s.scenes.length : 0);
    return {
      local: l ? { scenes: count(l.show), capturedAt: l.capturedAt || 0 } : null,
      primary: p ? { scenes: count(p.show), receivedAt: p.receivedAt || 0, version: p.version || '' } : null,
    };
  }

  return { dir, pkgRoot, localFile, primaryFile, loadLocal, loadPrimary, captureLocal, saveLocal, savePrimary, place, forDisk, restoreLocal, importScene, summary, savePrimaryJson, flushPrimary, listArchives, readArchive, archiveShow, pruneArchives };
}

/* Video yollarını gösteri paketindeki kopyaya eşler. `map`: birincilin
   başvurduğu değer (yol ya da sv-media adresi, ham yola çevrilmiş) → bu
   makinedeki dosya. Yerinde değiştirir; değişen sayısını döndürür.
   Yalnız `{ source: 'file', file }` biçimindeki alanlar (export-media ile
   aynı kural); bulunduğu derinlik önemli değil (sahne, katman, kayıtlı
   sahne). */
function remapMedia(obj, map, opts) {
  const o = opts || {};
  const toRaw = o.toRaw || ((s) => s);
  const toRef = o.toRef || ((raw, orig) => raw);
  const exists = o.exists || ((p) => fs.existsSync(p));
  const norm = o.caseInsensitive ? (s) => String(s).toLowerCase() : (s) => String(s);
  const table = new Map();
  for (const [k, v] of Object.entries(map || {})) table.set(norm(k), v);
  if (!table.size) return 0;
  let n = 0;
  const seen = new Set();
  (function walk(v) {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v.source === 'file' && typeof v.file === 'string' && v.file) {
      const raw = toRaw(v.file);
      const local = table.get(norm(raw));
      // Dosya bu makinede aynı yerde varsa (elle kopyalanmış) olduğu gibi kalır
      if (local && !exists(raw)) { v.file = toRef(local, v.file); n++; }
    }
    for (const k of Object.keys(v)) walk(v[k]);
  })(obj);
  return n;
}

module.exports = { createShowSpace, remapMedia, FORMAT, KEEP_ARCHIVES };
