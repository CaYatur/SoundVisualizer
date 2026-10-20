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
  function loadPrimary() {
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

  function summary() {
    const l = loadLocal();
    const p = loadPrimary();
    const count = (s) => (s && Array.isArray(s.scenes) ? s.scenes.length : 0);
    return {
      local: l ? { scenes: count(l.show), capturedAt: l.capturedAt || 0 } : null,
      primary: p ? { scenes: count(p.show), receivedAt: p.receivedAt || 0, version: p.version || '' } : null,
    };
  }

  return { dir, pkgRoot, localFile, primaryFile, loadLocal, loadPrimary, captureLocal, saveLocal, savePrimary, place, forDisk, restoreLocal, importScene, summary };
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

module.exports = { createShowSpace, remapMedia, FORMAT };
