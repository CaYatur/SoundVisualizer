/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ÖNİZLEME / PROGRAM TASLAĞI (#1167, #1168, #1169) — saf mantık, DOM yok.
 *
 * Önizleme modu açıkken paneller her zamanki gibi `cfg`'yi düzenler; `cfg` artık
 * TASLAK'tır. Çıkışlara, ana sürece (aygıt, ses kaynağı, ağ, haritalama dahil) ve
 * ayar dosyasına giden yapılandırma ise PROGRAM kopyasıdır: "Sahneye Gönder"e kadar
 * değişmez. Taslak yapılandırmanın TAMAMINI kapsar (kullanıcı kararı).
 *
 * İstisna: kitaplık anahtarları (kayıtlı sahneler, kullanıcı şablonları, MilkDrop
 * kitaplığı) gösteri durumu değil; önizlemede kaydedilen sahne canlıda hemen
 * çağrılabilsin diye iki taraf arasında paylaşılır (SHARED_KEYS).
 *
 * Mod kapalıyken bu modül hiçbir şeye dokunmaz: `persistent(x)` aynı nesneyi döndürür.
 * Panel `cfg` nesnesine referansla bağlı olduğu için yer değiştirme yerinde yapılır
 * (replaceInPlace), timeline-target.js ile aynı yaklaşım. */
(function () {
  const root = typeof window !== 'undefined' ? window : null;
  const SHARED_KEYS = ['scenes', 'userPresets', 'milkdropLibrary'];
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  /* `dst` nesnesinin anahtarlarını `src`'ninkilerle değiştir (referans korunur). */
  function replaceInPlace(dst, src) {
    for (const k of Object.keys(dst)) if (!Object.prototype.hasOwnProperty.call(src, k)) delete dst[k];
    for (const k of Object.keys(src)) dst[k] = clone(src[k]);
    return dst;
  }

  /* Geçiş seçimi → yalnız bu gönderim için kullanılacak `transition` alanı.
     'scene': taslağın kendi geçişi; 'cut': kesme; 'fade': süreli çapraz geçiş. */
  function transitionFor(mode, base, seconds) {
    const b = base && typeof base === 'object' ? base : {};
    if (mode === 'cut') return Object.assign({}, b, { enabled: true, type: 'cut', duration: 0, unit: 'seconds' });
    if (mode === 'fade') {
      const d = Math.max(0.05, Math.min(10, Number(seconds) || 1));
      return Object.assign({}, b, { enabled: true, type: 'crossfade', duration: d, unit: 'seconds', ease: b.ease || 'smooth' });
    }
    return clone(b);
  }

  function create() {
    let program = null; // etkinken Program yapılandırmasının kopyası
    let suspended = 0; // withProgram içinde: persistent() cfg'nin kendisini döndürür
    let prevProgram = null; // "son gönderimi geri al" için
    let frozen = false;
    let muted = false;

    const api = {
      SHARED_KEYS,
      active: () => !!program && suspended === 0,
      armed: () => !!program,
      /* Önizlemeye gir: Program, girildiği andaki yapılandırmadır. */
      begin(current) {
        if (program) return false;
        program = clone(current);
        prevProgram = null;
        return true;
      },
      /* Çık: Program kopyası geri verilir (çağıran cfg'ye yerinde yazar). */
      end() {
        const p = program;
        program = null;
        suspended = 0;
        prevProgram = null;
        return p;
      },
      program: () => program,
      /* Çıkışa gidecek yapılandırma. Mod kapalıyken `cfg`'nin KENDİSİ (davranış aynı). */
      persistent(cfg) {
        return program && suspended === 0 ? program : cfg;
      },
      /* Kitaplık anahtarlarını taslaktan Program'a taşı; değiştiyse true. */
      syncShared(draft) {
        if (!program || !draft) return false;
        let changed = false;
        for (const k of SHARED_KEYS) {
          if (JSON.stringify(draft[k]) === JSON.stringify(program[k])) continue;
          if (draft[k] === undefined) delete program[k];
          else program[k] = clone(draft[k]);
          changed = true;
        }
        return changed;
      },
      /* Dışarıdan (MCP, telefon, yedek) gelen yapılandırma Program'ı hedefler. */
      adoptProgram(incoming) {
        if (!program || !incoming) return false;
        program = clone(incoming);
        return true;
      },
      /* Program üzerinde çalış: `cfg` geçici olarak Program olur, iş bitince
         Program'ın yeni hâli saklanır ve taslak geri konur. Mod kapalıysa fn doğrudan. */
      withProgram(cfg, fn) {
        if (!program || suspended) return fn();
        const draft = clone(cfg);
        replaceInPlace(cfg, program);
        suspended++;
        try {
          return fn();
        } finally {
          suspended--;
          program = clone(cfg);
          replaceInPlace(cfg, draft);
        }
      },
      /* Sahneye Gönder: taslağın tamamı Program olur. Önceki Program geri alma için tutulur. */
      take(draftView) {
        if (!program) return null;
        prevProgram = program;
        program = clone(draftView);
        return program;
      },
      canRevert: () => !!(program && prevProgram),
      revert() {
        if (!program || !prevProgram) return null;
        program = prevProgram;
        prevProgram = null;
        return program;
      },
      // Çıkış güvenliği: anlık, yapılandırmaya yazılmaz
      frozen: () => frozen,
      muted: () => muted,
      setFrozen(v) { frozen = !!v; return frozen; },
      setMuted(v) { muted = !!v; return muted; },
    };
    return api;
  }

  const mod = { create, replaceInPlace, transitionFor, SHARED_KEYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.SVProgramDraftCore = mod;
})();
