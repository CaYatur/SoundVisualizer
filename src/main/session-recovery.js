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
     - Çöküş sonrası ayar dosyası okunamıyorsa en yeni sağlam kopya
       geri yüklenir; panel kullanıcıya bildirir. */
const fs = require('fs');
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

function create(opts) {
  const dir = opts.dir;
  const keep = Math.max(1, opts.keep || 5);
  const now = opts.now || (() => Date.now());
  let lastText = '';
  let timer = null;
  let crashed = null;

  function ensure() { try { fs.mkdirSync(dir, { recursive: true }); } catch { /* */ } }

  const api = {
    /* Açılış: önceki oturum düzgün kapanmadı mı? Sonra işareti yenile. */
    begin() {
      ensure();
      const mk = path.join(dir, MARKER);
      crashed = null;
      try {
        const prev = JSON.parse(fs.readFileSync(mk, 'utf-8'));
        crashed = { at: Number(prev.at) || 0, pid: Number(prev.pid) || 0 };
      } catch { /* işaret yok = temiz kapanış ya da ilk açılış */ }
      try { writeAtomic(mk, JSON.stringify({ pid: process.pid, at: now() })); } catch { /* */ }
      return crashed;
    },
    crashed() { return crashed; },
    snapshot(cfg) {
      if (!cfg || typeof cfg !== 'object') return false;
      let text;
      try { text = JSON.stringify(cfg); } catch { return false; }
      if (text === lastText) return false;
      ensure();
      const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
      try { writeAtomic(path.join(dir, PREFIX + stamp + '.json'), text); } catch { return false; }
      lastText = text;
      list(dir).slice(keep).forEach((f) => { try { fs.unlinkSync(path.join(dir, f)); } catch { /* */ } });
      return true;
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
    start(getCfg, intervalSec) {
      api.stop();
      const ms = Math.max(15, Math.min(3600, Number(intervalSec) || 120)) * 1000;
      timer = setInterval(() => { try { api.snapshot(getCfg()); } catch { /* */ } }, ms);
      if (timer.unref) timer.unref();
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
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

module.exports = { create, PREFIX, MARKER };
