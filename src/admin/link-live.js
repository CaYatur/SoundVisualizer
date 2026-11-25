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
      case 'tbar':
        if (!L || !L.tbarTo) return { ok: false, error: 'unsupported' };
        L.tbarTo(a.v, a.down ? 'move' : 'up');
        return { ok: true, tbar: L.tbarState ? L.tbarState() : null };
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

      /* DÜZENLEME (B3). Yama ana süreçte bekçiden geçti (src/main/link-guard.js); burada panelin
         KENDİ kopyasına yazılır ve panelin gönderim yolu kullanılır: panel tek yazar kalır,
         telefonun değişikliğini eski kopyasıyla ezmez, geri alma ve yedeklilik aynı işler. */
      case 'patch': {
        const c = cfg();
        const patch = a.patch || {};
        const keys = Object.keys(patch);
        // Ekran seçimi ve etkin sahne panelde ayrı durum tutuyor: dış ayar gibi benimsenir
        if (keys.indexOf('display') >= 0 || keys.indexOf('_activeSceneId') >= 0) {
          P()._acceptExternalConfig(Object.assign({}, c, patch));
          P().push(true);
          return { ok: true };
        }
        /* Telefon çizelgenin TAMAMINI yollar (ayna, persistent). Oturum alanları
           (manualBaseline / editTarget) aynada yoktur. Nesneyi olduğu gibi
           atamak, seçili klibin kopyasını ana sahne diye kaydeder. PC'deki
           "Timeline kullan" anahtarı modeChanged/clear ile elle ayarı ayırır;
           uzaktan aç/kapa aynı yolu kullanır ve sahne anahtarlarını yazmaz. */
        let keepManual = false;
        if (patch.timeline && typeof patch.timeline === 'object' && !Array.isArray(patch.timeline)) {
          keepManual = applyRemoteTimeline(c, patch.timeline);
        }
        const sceneKeys = (window.SVSchema && window.SVSchema.SCENE_KEYS) || [];
        for (const k of keys) {
          if (k === 'timeline') continue;
          if (keepManual && sceneKeys.indexOf(k) >= 0) continue;
          c[k] = patch[k];
        }
        if (a.final) { P().push(true); noteEdit(); } else { P().push(false); scheduleCommit(); }
        renderSoon();
        return { ok: true };
      }
      case 'sceneCreate': {
        const list = P().scenes();
        if (a.data) {
          list.push({ id: a.id, name: a.name, createdAt: Date.now(), data: a.data });
          P().push(true);
          P().renderScenes();
          return { ok: true, id: a.id };
        }
        // Verisiz: PC'deki o anki görünüm (panelin "Sahne Kaydet"i)
        const before = new Set(list.map((s) => s.id));
        P().saveScene();
        const made = P().scenes().find((s) => !before.has(s.id));
        if (made && a.name) P().renameScene(made.id, a.name);
        return { ok: !!made, id: made ? made.id : '' };
      }
      case 'sceneSave': {
        const sc = P().scenes().find((s) => s && s.id === a.id);
        if (!sc) return { ok: false, error: 'bad-args' };
        if (a.data) { sc.data = a.data; P().push(true); P().renderScenes(); } else P().updateScene(a.id);
        return { ok: true };
      }
      case 'sceneRename':
        if (!P().scenes().some((s) => s && s.id === a.id)) return { ok: false, error: 'bad-args' };
        P().renameScene(a.id, a.name);
        return { ok: true };
      case 'sceneDelete': {
        const c = cfg();
        const list = P().scenes();
        if (!list.some((s) => s && s.id === a.id)) return { ok: false, error: 'bad-args' };
        c.scenes = list.filter((s) => s.id !== a.id);
        if (c._activeSceneId === a.id) P()._acceptExternalConfig(Object.assign({}, c, { _activeSceneId: null }));
        P().push(true);
        P().renderScenes();
        return { ok: true };
      }
      case 'sceneReorder': {
        const c = cfg();
        const list = P().scenes();
        const by = new Map(list.map((s) => [s.id, s]));
        if (a.ids.length !== list.length || a.ids.some((id) => !by.has(id)) || new Set(a.ids).size !== list.length) return { ok: false, error: 'bad-args' };
        c.scenes = a.ids.map((id) => by.get(id));
        P().push(true);
        P().renderScenes();
        return { ok: true };
      }
      case 'paletteSave': {
        const c = cfg();
        if (!Array.isArray(c.userPresets)) c.userPresets = [];
        const colors = a.colors || ((c.background && c.background.gradient && c.background.gradient.colors) || []).slice(0, 5);
        // Panelin "Şablonum" kaydı gibi beş renk: kısa liste son rengi tekrarlar
        if (!colors.length) return { ok: false, error: 'bad-args' };
        while (colors.length < 5) colors.push(colors[colors.length - 1]);
        c.userPresets.push({ id: a.id, name: a.name, colors });
        P().push(true);
        renderSoon();
        return { ok: true, id: a.id };
      }
      case 'paletteDelete': {
        const c = cfg();
        const list = Array.isArray(c.userPresets) ? c.userPresets : [];
        if (!list.some((p) => p && p.id === a.id)) return { ok: false, error: 'bad-args' };
        c.userPresets = list.filter((p) => p.id !== a.id);
        P().push(true);
        renderSoon();
        return { ok: true };
      }
      default:
        return { ok: false, error: 'unsupported' };
    }
  }

  function sceneKeyList() {
    return (window.SVSchema && window.SVSchema.SCENE_KEYS) || [];
  }
  function snapManual(c) {
    const tl = c.timeline;
    const src = tl && tl.manualBaseline ? tl.manualBaseline : c;
    const o = {};
    for (const k of sceneKeyList()) if (src[k] !== undefined) o[k] = JSON.parse(JSON.stringify(src[k]));
    return o;
  }
  function loadManual(c, data) {
    for (const k of sceneKeyList()) {
      if (!data || data[k] === undefined) delete c[k];
      else c[k] = JSON.parse(JSON.stringify(data[k]));
    }
  }
  /* Telefon timeline yaması. Açılış elle sahnenin anlık kopyasını alır
     (modeChanged); kapanış klibi kaydedip elle sahneyi geri koyar (clear).
     Arada gelen içerik yazımı açık oturumun tabanını düşürmez. */
  function applyRemoteTimeline(c, incoming) {
    const prev = (c.timeline && typeof c.timeline === 'object' && !Array.isArray(c.timeline)) ? c.timeline : {};
    const wasOn = prev.useTimeline === true;
    const willOn = incoming.useTimeline === true;
    const T = window.SVTimelineTarget;
    const manual = snapManual(c);
    const keepBase = prev.manualBaseline;
    const keepEdit = prev.editTarget;
    if (wasOn && !willOn && T && T.clear) T.clear();
    const merged = Object.assign({}, prev, incoming);
    const stay = wasOn && willOn;
    if (stay && keepBase && !Object.prototype.hasOwnProperty.call(incoming, 'manualBaseline')) {
      merged.manualBaseline = keepBase;
      if (keepEdit && !Object.prototype.hasOwnProperty.call(incoming, 'editTarget')) merged.editTarget = keepEdit;
    } else if (!stay) {
      if (!Object.prototype.hasOwnProperty.call(incoming, 'manualBaseline')) delete merged.manualBaseline;
      if (!Object.prototype.hasOwnProperty.call(incoming, 'editTarget')) delete merged.editTarget;
    }
    c.timeline = merged;
    const flipped = wasOn !== willOn;
    if (flipped) loadManual(c, manual);
    if (!wasOn && willOn && T && T.modeChanged) T.modeChanged(true);
    else if (wasOn && !willOn && T && T.modeChanged) T.modeChanged(false);
    return flipped;
  }

  /* Makro kaydırıcısı sürüklenirken saniyede onlarca yama gelir: her biri canlıya gider
     (push(false)), kesin kayıt bırakınca bir kez (panelin kaydırıcısı gibi). */
  let commitTimer = 0;
  /* "Telefondan yapılan değişiklikleri bildir" (Telefon Bağlantısı kartı, varsayılan açık):
     telefonun kesin yazımında köşede kısa bildirim, en çok 6 saniyede bir. */
  let noteAt = 0;
  function noteEdit() {
    const c = cfg();
    if (c.phoneLink && c.phoneLink.notify === false) return;
    const t = Date.now();
    if (t - noteAt < 6000) return;
    noteAt = t;
    const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
    P().toast(tr('Telefon ayarları değiştirdi.'), 'ok');
  }
  // Telefon sürüklerken panel saniyede en çok ~4 kez yeniden çizilir; bırakınca bir kez daha
  let renderTimer = 0;
  function renderSoon() {
    if (renderTimer) return;
    renderTimer = setTimeout(() => { renderTimer = 0; P().rerender(); }, 250);
  }
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
    // Klip destesinde çalan hücreler ("satır:sütun", OSC saatiyle aynı biçim; autovj.js)
    let deck = '';
    try {
      const D = window.SVClipDeckPanel;
      const eng = D && D.engine ? D.engine() : null;
      const slots = eng && eng.activeSlots ? eng.activeSlots() : null;
      if (slots) deck = slots.filter((s) => s.slot).map((s) => s.slot.row + ':' + s.slot.col).join(',');
    } catch { deck = ''; }
    return {
      deck,
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
