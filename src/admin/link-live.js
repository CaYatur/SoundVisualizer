/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TELEFON BAĞLANTISININ PANELDEKİ UCU (B2, docs/PHONE-LINK.md). Ana süreç telefonun isteğini
   doğrular (src/main/link-live.js) ve buraya yalnız denetlenmiş veriyle gelir. Her işlem
   panelin KENDİ uygulamasını çağırır (sahne düğmesi, T-bar, anlık efekt düğmesi, makro
   kaydırıcısı, MilkDrop "sonraki", çizelge taşıması): telefon ayrı bir yazma yolu kurmaz,
   geri alma ve yedeklilik paneldeki gibi işler.

   snapshot(): telefonun Canlı sayfasının ayarda OLMAYAN canlı durumu (sıradaki sahne, T-bar,
   anlık efektler, çizelge kafası, MilkDrop'ta çalan preset). Ayarın kendisi config.get ile. */
(function () {
  const P = () => window.SVPanel;

  function cfg() { return P().cfg(); }
  // Adlı eylem: kısayol ve telefon kumandasıyla aynı yol (admin.js onRemoteAction)
  function runNamed(id) {
    const C = window.SVControl;
    if (!C || typeof C.runAction !== 'function') return false;
    if (C.runAction(id, cfg()) !== true) P().apply();
    return true;
  }

  async function run(op, args) {
    const a = args || {};
    const L = window.SVLiveShell;
    switch (op) {
      case 'osc': {
        const C = window.SVControl;
        if (!C || !C.osc) return { ok: false, error: 'unsupported' };
        C.osc({ messages: [a.message], source: 'remote' });
        return { ok: true };
      }
      case 'scene':
        if (!P().scenes().some((s) => s && s.id === a.id)) return { ok: false, error: 'bad-args' };
        P().applyScene(a.id);
        return { ok: true, active: P().activeSceneId() };
      case 'cue':
        if (!L || !L.setCue) return { ok: false, error: 'unsupported' };
        L.setCue(a.id || '');
        return { ok: true };
      case 'take':
        if (!L || !L.take) return { ok: false, error: 'unsupported' };
        L.take();
        return { ok: true, active: P().activeSceneId() };
      case 'momentary':
        if (!L || !L.setRemoteHeld) return { ok: false, error: 'unsupported' };
        L.setRemoteHeld(a.list || []);
        return { ok: true };
      case 'deckStopColumn': {
        const D = window.SVClipDeckPanel;
        if (!D || !D.stopColumn) return { ok: false, error: 'unsupported' };
        D.stopColumn(a.col);
        return { ok: true };
      }
      case 'macro': {
        const c = cfg();
        const m = c.modulation || (c.modulation = window.SV.defaultConfig().modulation);
        if (!Array.isArray(m.macros)) m.macros = [];
        const mc = m.macros[a.i] || (m.macros[a.i] = { name: '', value: 0 });
        mc.value = a.v;
        P().push(false);
        scheduleCommit();
        return { ok: true };
      }
      case 'tempo': {
        const c = cfg();
        c.autovj = c.autovj || {};
        c.autovj.bpmLock = a.bpm;
        P().push(true);
        P().rerender();
        return { ok: true, bpm: a.bpm };
      }
      case 'tap': {
        const A = window.SVAutoVJ;
        const bpm = A && A.tap ? Math.round(A.tap()) : 0;
        if (bpm > 0) {
          const c = cfg();
          c.autovj = c.autovj || {};
          c.autovj.bpmLock = bpm;
          P().push(true);
          P().rerender();
        }
        return { ok: true, bpm };
      }
      case 'milkdrop':
        return { ok: runNamed({ next: 'mdNext', prev: 'mdPrev', random: 'mdRandom' }[a.dir]) };
      case 'timeline': {
        const T = window.SVTimelinePanel;
        if (!T) return { ok: false, error: 'unsupported' };
        if (a.action === 'seek') {
          if (T.seek) T.seek(a.t);
        } else if (a.action === 'next' || a.action === 'prev') {
          runNamed(a.action === 'next' ? 'tlNextMarker' : 'tlPrevMarker');
        } else if (T[a.action]) {
          T[a.action]();
        }
        const tr = T.transport ? T.transport() : null;
        return { ok: true, playing: !!(tr && tr.playing), time: tr ? tr.time : 0 };
      }
      case 'run':
        return { ok: runNamed(a.id) };
      default:
        return { ok: false, error: 'unsupported' };
    }
  }

  /* Makro kaydırıcısı sürüklenirken saniyede onlarca yama gelir: her biri canlıya gider
     (push(false)), kesin kayıt bırakınca bir kez (panelin kaydırıcısı gibi). */
  let commitTimer = 0;
  function scheduleCommit() {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(() => { commitTimer = 0; P().push(true); }, 400);
  }

  function snapshot() {
    const L = window.SVLiveShell;
    const T = window.SVTimelinePanel;
    const M = window.SVMilkdropPanel;
    const c = cfg();
    let tl = null;
    try {
      const tr = T && T.transport ? T.transport() : null;
      if (tr) tl = { playing: !!tr.playing, time: Math.round((Number(tr.time) || 0) * 100) / 100 };
    } catch { tl = null; }
    let md = '';
    try {
      const id = M && M.liveId && c.milkdrop ? M.liveId(c.milkdrop) : '';
      const hit = id && M.presetById ? M.presetById(id) : null;
      md = hit && hit.name ? String(hit.name) : (c.milkdrop && c.milkdrop.name) || '';
    } catch { md = ''; }
    return {
      active: P().activeSceneId() || '',
      blackout: !!P().isBlackedOut(),
      cue: L && L.cue ? L.cue() : '',
      tbar: L && L.tbarState ? L.tbarState() : null,
      held: L && L.heldList ? L.heldList() : [],
      timeline: tl,
      milkdrop: md.slice(0, 120),
    };
  }

  window.SVLinkLive = { run, snapshot };
})();
