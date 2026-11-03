/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* OTURUM / ÇÖKME KURTARMA.

   settings.json yalnızca kaydedilen son hâli tutuyor; yazım sırasında
   güç kesilirse ya da dosya bozulursa ayarlar varsayılana dönüyordu.
   Burada:
     - Çalışırken belli aralıkla (varsayılan 120 sn) yapılandırmanın
       anlık kopyası recovery/ klasörüne yazılır (geçici dosya + yeniden
       adlandırma; yarım dosya kalmaz). Değişmediyse yazılmaz, son 5 tutulur.
     - Açılışta "çalışıyor" işareti bırakılır, düzgün kapanışta silinir.
       İşaret duruyorsa önceki oturum çöktü demektir.
     - Çöküş sonrası ayar dosyası bozuksa en yeni sağlam kopya geri
       yüklenir; panel kullanıcıya bildirir. Dosya YOKSA yüklenmez: silmek
       ayarı sıfırlamanın olağan yolu, kopya çökmeye yol açan ayarı da taşıyabilir.
     - Zamanlayıcı ayar kaydedildiyse kopya alır ve dosyaya eşzamansız yazar:
       ana süreçten ses kareleri geçiyor (#621). */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const PREFIX = 'session-';
const MARKER = 'running.json';

function list(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.startsWith(PREFIX) && f.endsWith('.json')).sort().reverse();
  } catch { return []; }
}

function writeAtomic(file, text) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, text, 'utf-8');
  fs.renameSync(tmp, file);
}

// Çöküş + okunamayan AMA var olan dosya + önceki oturumda kurtarma açık
function shouldRestore(crashed, fileBytes, usable) {
  return !!crashed && crashed.enabled !== false && !!fileBytes && !usable;
}

function create(opts) {
  const dir = opts.dir;
  const keep = Math.max(1, opts.keep || 5);
  const now = opts.now || (() => Date.now());
  let lastText = '';
  let timer = null;
  let timerMs = 0;
  let crashed = null;
  let dirty = true;
  let writing = false;
  let enabled = true;

  function ensure() { try { fs.mkdirSync(dir, { recursive: true }); } catch { /* */ } }
  const stamped = () => path.join(dir, PREFIX + new Date(now()).toISOString().replace(/[:.]/g, '-') + '.json');
  // Yazılacak metin; değişmediyse null
  function serialize(cfg) {
    if (!cfg || typeof cfg !== 'object') return null;
    let text;
    try { text = JSON.stringify(cfg); } catch { return null; }
    return text === lastText ? null : text;
  }
  function writeMarker() {
    try { writeAtomic(path.join(dir, MARKER), JSON.stringify({ pid: process.pid, at: now(), enabled })); } catch { /* */ }
  }

  const api = {
    /* Açılış: önceki oturum düzgün kapanmadı mı? Sonra işareti yenile. */
    begin() {
      ensure();
      const mk = path.join(dir, MARKER);
      crashed = null;
      try {
        const prev = JSON.parse(fs.readFileSync(mk, 'utf-8'));
        crashed = { at: Number(prev.at) || 0, pid: Number(prev.pid) || 0, enabled: prev.enabled !== false };
        enabled = crashed.enabled;
      } catch { /* işaret yok = temiz kapanış ya da ilk açılış */ }
      writeMarker();
      return crashed;
    },
    crashed() { return crashed; },
    // Ayar kaydedildi: bir sonraki aralıkta kopya alınır
    touch() { dirty = true; },
    /* Kurtarma kapalıysa işarete yazılır: ayar dosyası bozulunca bu bilgi
       ondan okunamaz. */
    setEnabled(on) {
      const v = on !== false;
      if (v === enabled) return;
      enabled = v;
      writeMarker();
    },
    // Kapanışta: süreç bitmeden yazılmış olmalı
    snapshot(cfg) {
      const text = serialize(cfg);
      if (text == null) return false;
      ensure();
      try { writeAtomic(stamped(), text); } catch { return false; }
      lastText = text;
      list(dir).slice(keep).forEach((f) => { try { fs.unlinkSync(path.join(dir, f)); } catch { /* */ } });
      return true;
    },
    // Çalışırken: ana süreci dosya işlemiyle bekletmez
    async snapshotAsync(cfg) {
      if (writing) { dirty = true; return false; }
      const text = serialize(cfg);
      if (text == null) return false;
      writing = true;
      try {
        await fsp.mkdir(dir, { recursive: true });
        const file = stamped();
        const tmp = file + '.' + process.pid + '.tmp';
        await fsp.writeFile(tmp, text, 'utf-8');
        await fsp.rename(tmp, file);
        lastText = text;
        await Promise.all(list(dir).slice(keep).map((f) => fsp.unlink(path.join(dir, f)).catch(() => {})));
        return true;
      } catch {
        return false;
      } finally {
        writing = false;
      }
    },
    // En yeni ayrıştırılabilen kopya: { file, config } ya da null
    latest() {
      for (const f of list(dir)) {
        try {
          const cfg = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
          if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) return { file: f, config: cfg };
        } catch { /* bozuksa bir öncekine */ }
      }
      return null;
    },
    /* Her ayar gönderiminde çağrılıyor: aynı aralıkla yeniden kurulmaz, yoksa
       aralıktan sık gelen gönderimler zamanlayıcıyı hiç işletmezdi. */
    start(getCfg, intervalSec) {
      const ms = Math.max(15, Math.min(3600, Number(intervalSec) || 120)) * 1000;
      if (timer && ms === timerMs) return;
      api.stop();
      timerMs = ms;
      timer = setInterval(() => {
        if (!dirty) return;
        dirty = false;
        try { api.snapshotAsync(getCfg()); } catch { /* */ }
      }, ms);
      if (timer.unref) timer.unref();
    },
    stop() { if (timer) clearInterval(timer); timer = null; timerMs = 0; },
    // Düzgün kapanış: son kopya + işareti sil
    end(cfg) {
      api.stop();
      if (cfg) api.snapshot(cfg);
      try { fs.unlinkSync(path.join(dir, MARKER)); } catch { /* */ }
    },
    files() { return list(dir); },
  };
  return api;
}

module.exports = { create, shouldRestore, PREFIX, MARKER };
