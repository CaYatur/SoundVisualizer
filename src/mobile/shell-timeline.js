/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* DOKUNMATİK ZAMAN ÇİZELGESİ (Faz 5). Masaüstünün Zaman sayfasının telefondaki ilk hâli:
   bir şarkı üzerine sahne ve şablon klipleri dizilir, müzik videosu olarak dışa aktarılır.

   Veri masaüstünün biçiminde (cfg.timeline; src/shared/timeline.js makeTrack/makeClip):
   bilgisayara yedekle gidince Zaman sayfasında açılır. Düzenleme işlemleri ortak modülden
   (src/shared/timeline-edit.js: böl, çoğalt, geri al). Zaman saniye; cetvel tempo haritasından
   ölçü/vuruş (masaüstündeki kural). Kaydetme yalnız düzenleme BİTİNCE (sürüklerken değil).

   Canlı oynatma masaüstündeki gibi klip SINIRINDA: oynatma kafası yeni bir klibe girince o
   klibin sahnesi (ya da şablonu) uygulanır (src/admin/timeline-panel.js fireClip). Her karede
   bileşim gönderilmiyor. Saat uygulama içi çaların konumu; şarkı yoksa duvar saati.
   Dışa aktarma çizelgenin tam bileşimini kare kare çizer (geçişler dahil).

   Bu ilk sürümde yok (masaüstünde var): birden çok parça, otomasyon, işaretler, tempo
   değişimi, döngü, video/görsel klipleri. */
(function () {
  if (typeof window === 'undefined' || !window.SVShell) return;
  const S = window.SVShell;
  const { h, icon } = S;
  const U = () => window.SVShellUI;
  const A = () => window.SVAndroid;
  const TL = () => window.SVTimeline;
  const TE = () => window.SVTimelineEdit;
  const cfg = () => (A() && A().config.get()) || {};
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
  const en = () => !!(window.SVI18n && window.SVI18n.locale === 'en');

  const RULER_H = 28;
  const TRACK_H = 64;
  const MIN_SEC = 30;
  const state = { head: 0, sel: '', zoom: 24, playing: false, wallStart: 0, wallHead: 0, fired: '' };
  const hist = () => (state.hist || (state.hist = TE() ? new (TE().History)(100) : null));

  // ---- Model ----
  function model() {
    const c = cfg();
    const tl = TL().makeTimeline(c.timeline || {});
    if (!tl.tracks.some((t) => t.kind === 'clip')) tl.tracks.push(TL().makeTrack({ kind: 'clip', name: 'Sahneler' }));
    return tl;
  }
  function track(tl) { return tl.tracks.find((t) => t.kind === 'clip'); }
  function clips() { const t = track(model()); return t ? t.clips : []; }
  /* Kaydet: masaüstünün alanları korunur, yalnız parçalar ve tempo yazılır. */
  function save(tl, push) {
    const c = cfg();
    const next = Object.assign({}, c.timeline || {}, { tracks: JSON.parse(JSON.stringify(tl.tracks)), tempo: tl.tempo, snap: tl.snap });
    A().config.patch({ timeline: next });
    const H = hist();
    if (H && push !== false && TE()) H.push(TE().snapshot(next));
  }
  function syncHistory() {
    const H = hist();
    if (H && TE()) H.sync(TE().snapshot(cfg().timeline || {}));
  }
  function length(tl) {
    const end = Math.max(0, ...track(tl).clips.map((c) => c.start + c.dur));
    return Math.max(MIN_SEC, end + 8, songSec() + 2);
  }
  function bpm(tl) { return (tl.tempo[0] && tl.tempo[0].bpm) || 120; }
  function snap(tl, sec) { return Math.max(0, TL().snapSeconds(tl.tempo, sec, tl.snap || 'bar', tl.fps)); }
  function barSec(tl) { return TL().barsToSeconds(tl.tempo, 2, 1) - TL().barsToSeconds(tl.tempo, 1, 1); }

  // ---- Kaynaklar (sahne / şablon) ----
  function sourceName(c) {
    if (c.type === 'scene') { const sc = (cfg().scenes || []).find((x) => x && x.id === c.ref); return sc ? sc.name : tr('Silinmiş sahne'); }
    const T = window.SVTemplates;
    const t = T && T.TEMPLATES.find((x) => x.id === c.ref);
    return t ? tr(t.name) : c.ref;
  }
  function applyClip(c) {
    if (!c) return;
    if (c.type === 'scene') { S.recallScene(c.ref); return; }
    if (c.type === 'preset' && window.SVShellLibrary && window.SVShellLibrary.applyTemplate) window.SVShellLibrary.applyTemplate(c.ref);
  }
  function activeAt(tl, t) {
    const list = track(tl).clips;
    let hit = null;
    for (const c of list) if (t >= c.start && t < c.start + c.dur) hit = c;
    return hit;
  }

  // ---- Saat: uygulama içi çalar ya da duvar saati ----
  let pState = null;
  let pAt = 0;
  function player() { return A().player && A().player.state ? A().player.state() : null; }
  function songSec() { const p = player(); return p && p.has && p.duration ? p.duration / 1000 : 0; }
  function now() {
    const p = pState;
    if (p && p.has) return (p.position + (p.playing ? performance.now() - pAt : 0)) / 1000;
    return state.playing ? state.wallHead + (performance.now() - state.wallStart) / 1000 : state.head;
  }
  function onPlayer(v) { pState = v; pAt = performance.now(); }
  function seek(t, tl) {
    state.head = Math.max(0, t);
    const p = player();
    if (p && p.has) A().player.seek(Math.round(state.head * 1000)).catch(() => {});
    if (pState) { pState = Object.assign({}, pState, { position: state.head * 1000 }); pAt = performance.now(); }
    state.wallHead = state.head;
    state.wallStart = performance.now();
    const c = activeAt(tl || model(), state.head);
    state.fired = c ? c.id : '';
    applyClip(c);
  }
  let raf = 0;
  function loop() {
    raf = 0;
    if (!state.playing) return;
    raf = requestAnimationFrame(loop);
    const t = now();
    state.head = t;
    const tl = model();
    const c = activeAt(tl, t);
    const id = c ? c.id : '';
    if (id !== state.fired) { state.fired = id; applyClip(c); }
    paintHead();
    if (t > length(tl) + 1) stop();
  }
  function play() {
    const p = player();
    state.playing = true;
    state.wallHead = state.head;
    state.wallStart = performance.now();
    state.fired = '';
    if (p && p.has) A().player.play().catch(() => {});
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function stop() {
    state.playing = false;
    state.head = now();
    const p = player();
    if (p && p.has && p.playing) A().player.pause().catch(() => {});
  }

  // ---- Çizim ----
  let refs = null;
  function fmt(sec) {
    const s = Math.max(0, sec);
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1).replace('.', en() ? '.' : ',');
  }
  function paintHead() {
    if (!refs || !refs.head || !refs.head.isConnected) return;
    refs.head.style.transform = 'translateX(' + Math.round(state.head * state.zoom) + 'px)';
    refs.time.textContent = fmt(state.head) + (songSec() ? ' / ' + fmt(songSec()) : '');
    if (state.playing && refs.scroll) {
      const x = state.head * state.zoom;
      const sc = refs.scroll;
      if (x < sc.scrollLeft + 40 || x > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = Math.max(0, x - sc.clientWidth / 3);
    }
  }

  /* Klip: gövdesi taşınır, kenar tutamaçları süreyi değiştirir. Sürüklerken yalnız görünüm
     değişir; bırakınca kaydedilir (geçmişe bir adım). */
  function clipEl(tl, c, ctx) {
    const on = c.id === state.sel;
    const el = h('div', { class: 'tl-clip' + (on ? ' on' : ''), 'data-id': c.id, role: 'button', 'aria-pressed': on ? 'true' : 'false', 'aria-label': sourceName(c) }, [
      h('span', { class: 'tl-handle l', 'aria-hidden': 'true' }),
      h('span', { class: 'tl-name', text: sourceName(c) }),
      h('span', { class: 'tl-handle r', 'aria-hidden': 'true' }),
    ]);
    const place = (start, dur) => { el.style.left = Math.round(start * state.zoom) + 'px'; el.style.width = Math.max(8, Math.round(dur * state.zoom)) + 'px'; };
    place(c.start, c.dur);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const mode = e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'move';
      const x0 = e.clientX;
      const s0 = c.start;
      const d0 = c.dur;
      let moved = false;
      let ns = s0;
      let nd = d0;
      el.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const dx = (ev.clientX - x0) / state.zoom;
        if (Math.abs(ev.clientX - x0) > 4) moved = true;
        if (!moved) return;
        const min = Math.max(0.25, barSec(tl) / 4);
        if (mode === 'move') { ns = snap(tl, s0 + dx); nd = d0; }
        else if (mode === 'l') { const end = s0 + d0; ns = Math.min(end - min, snap(tl, s0 + dx)); nd = end - ns; }
        else { ns = s0; nd = Math.max(min, snap(tl, s0 + d0 + dx) - s0); }
        place(ns, nd);
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        if (!moved) { state.sel = c.id; ctx.refresh(); return; }
        const m = model();
        const cc = track(m).clips.find((x) => x.id === c.id);
        if (!cc) return;
        cc.start = ns;
        cc.dur = nd;
        TE().sortClips ? TE().sortClips(track(m)) : track(m).clips.sort((a, b) => a.start - b.start);
        state.sel = c.id;
        save(m);
        ctx.refresh();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    return el;
  }

  function lane(tl, ctx) {
    const len = length(tl);
    const W = Math.ceil(len * state.zoom);
    const ruler = h('div', { class: 'tl-ruler', style: 'width:' + W + 'px' });
    // Ölçü çizgileri: yakınlaştırmaya göre her ölçü ya da birkaç ölçüde bir sayı
    const bar = barSec(tl);
    const every = Math.max(1, Math.ceil(40 / Math.max(1, bar * state.zoom)));
    for (let i = 0, t = 0; t <= len; i++, t = TL().barsToSeconds(tl.tempo, i + 1, 1)) {
      const tick = h('span', { class: 'tl-tick' + (i % every === 0 ? ' major' : ''), style: 'left:' + Math.round(t * state.zoom) + 'px' }, i % every === 0 ? [String(i + 1)] : []);
      ruler.appendChild(tick);
      if (i > 2000) break;
    }
    ruler.addEventListener('pointerdown', (e) => {
      const r = ruler.getBoundingClientRect();
      seek(snap(tl, (e.clientX - r.left) / state.zoom), tl);
      paintHead();
    });
    const row = h('div', { class: 'tl-track', style: 'width:' + W + 'px' });
    for (const c of track(tl).clips) row.appendChild(clipEl(tl, c, ctx));
    if (!track(tl).clips.length) row.appendChild(h('div', { class: 'tl-empty', text: tr('Klip yok: oynatma kafasına Ekle ile sahne ya da şablon koyun.') }));
    const head = h('div', { class: 'tl-head', 'aria-hidden': 'true' });
    const inner = h('div', { class: 'tl-inner', style: 'width:' + W + 'px' }, [ruler, row, head]);
    const scroll = h('div', { class: 'tl-scroll' }, [inner]);
    refs.head = head;
    refs.scroll = scroll;
    return scroll;
  }

  // ---- Eylemler ----
  function addAtHead(ctx) {
    const scenes = (cfg().scenes || []).filter(Boolean);
    const T = window.SVTemplates;
    const opts = scenes.map((s) => ['scene:' + s.id, (en() ? 'Scene: ' : 'Sahne: ') + (s.name || s.id)])
      .concat(T ? T.TEMPLATES.map((t) => ['preset:' + t.id, (en() ? 'Template: ' : 'Şablon: ') + tr(t.name)]) : []);
    S.choose(tr('Klip ekle'), opts, '').then((v) => {
      if (!v) return;
      const i = v.indexOf(':');
      const m = model();
      const start = snap(m, state.head);
      const dur = barSec(m) * 4;
      // Sonraki klibe çarpmasın: ardındaki klibe kadar
      const next = track(m).clips.filter((c) => c.start > start + 1e-6).sort((a, b) => a.start - b.start)[0];
      const c = TL().makeClip({ type: v.slice(0, i), ref: v.slice(i + 1), start, dur: next ? Math.max(barSec(m) / 4, Math.min(dur, next.start - start)) : dur });
      track(m).clips.push(c);
      track(m).clips.sort((a, b) => a.start - b.start);
      state.sel = c.id;
      save(m);
      state.fired = '';
      seek(state.head, m);
      ctx.refresh();
    });
  }
  function withSel(fn, ctx) {
    const m = model();
    const t = track(m);
    const c = t.clips.find((x) => x.id === state.sel);
    if (!c) return;
    fn(m, t, c);
    t.clips.sort((a, b) => a.start - b.start);
    save(m);
    ctx.refresh();
  }
  function step(dir, ctx) {
    const H = hist();
    if (!H || !TE()) return;
    const snapTxt = dir < 0 ? H.undo() : H.redo();
    if (!snapTxt) return;
    const next = Object.assign({}, cfg().timeline || {});
    TE().restore(next, snapTxt);
    A().config.patch({ timeline: next });
    ctx.refresh();
  }

  // ---- Sayfa ----
  function page() {
    return {
      size: 'full',
      title: 'Zaman Çizelgesi',
      render(body, ctx) {
        if (!TL() || !TE()) { body.appendChild(h('div', { class: 'empty', text: 'Zaman çizelgesi bu sürümde yok.' })); return; }
        refs = {};
        syncHistory();
        const tl = model();
        const p = player();
        // Şarkı
        body.appendChild(h('div', { class: 'card np-card row-card' }, [
          h('div', { class: 'np-art ph' }, [icon('music')]),
          h('div', { class: 'row-text' }, [
            h('div', { class: 'row-title', text: p && p.has ? (p.title || p.name || '') : tr('Şarkı seçilmedi') }),
            h('div', { class: 'row-sub', text: p && p.has ? tr('Uygulama içi çalar') : tr('Şarkı olmadan saat ekranın saatiyle akar.') }),
          ]),
          h('button', { class: 'btn', onclick: () => A().player.pick().then(() => ctx.refresh(), () => {}) }, [icon('folder-open'), p && p.has ? 'Değiştir' : 'Seç']),
        ]));
        // Taşıma
        refs.time = h('span', { class: 'mono tl-time' });
        body.appendChild(h('div', { class: 'tl-transport' }, [
          h('button', { class: 'iconbtn plain', 'aria-label': 'Başa', title: 'Başa', onclick: () => { seek(0, tl); paintHead(); if (refs.scroll) refs.scroll.scrollLeft = 0; } }, [icon('prev')]),
          h('button', { class: 'iconbtn', 'aria-label': state.playing ? 'Duraklat' : 'Oynat', onclick: () => { if (state.playing) stop(); else play(); ctx.refresh(); } }, [icon(state.playing ? 'pause' : 'play')]),
          refs.time,
          h('div', { class: 'spacer' }),
          h('button', { class: 'iconbtn plain', 'aria-label': 'Uzaklaştır', title: 'Uzaklaştır', onclick: () => { state.zoom = Math.max(4, state.zoom / 1.5); ctx.refresh(); } }, [icon('minus')]),
          h('button', { class: 'iconbtn plain', 'aria-label': 'Yakınlaştır', title: 'Yakınlaştır', onclick: () => { state.zoom = Math.min(160, state.zoom * 1.5); ctx.refresh(); } }, [icon('plus')]),
        ]));
        body.appendChild(lane(tl, ctx));
        paintHead();
        // Düzenleme
        const sel = track(tl).clips.find((x) => x.id === state.sel) || null;
        const H = hist();
        body.appendChild(h('div', { class: 'btn-row tl-tools' }, [
          h('button', { class: 'btn primary', onclick: () => addAtHead(ctx) }, [icon('plus'), 'Ekle']),
          h('button', { class: 'btn', disabled: sel ? null : true, onclick: () => withSel((m, t, c) => { const r = TE().splitClip(c, snap(m, state.head)); if (r) { t.clips.push(r); state.sel = r.id; } }, ctx) }, [icon('cut'), 'Böl']),
          h('button', { class: 'btn', disabled: sel ? null : true, onclick: () => withSel((m, t, c) => { const d = TE().duplicateClip(c); t.clips.push(d); state.sel = d.id; }, ctx) }, [icon('copy'), 'Çoğalt']),
          h('button', { class: 'btn', disabled: sel ? null : true, onclick: () => withSel((m, t, c) => { t.clips.splice(t.clips.indexOf(c), 1); state.sel = ''; }, ctx) }, [icon('trash'), 'Sil']),
          h('button', { class: 'iconbtn plain', 'aria-label': 'Geri Al', title: 'Geri Al', disabled: H && H.canUndo() ? null : true, onclick: () => step(-1, ctx) }, [icon('undo')]),
          h('button', { class: 'iconbtn plain', 'aria-label': 'Yinele', title: 'Yinele', disabled: H && H.canRedo() ? null : true, onclick: () => step(1, ctx) }, [icon('redo')]),
        ]));
        if (sel) {
          body.appendChild(h('div', { class: 'hint' }, [h('b', { text: sourceName(sel) }), ' · ' + fmt(sel.start) + ' → ' + fmt(sel.start + sel.dur)]));
        }
        // Tempo ve hizalama
        body.appendChild(U().card([
          U().slider({ label: 'Tempo (BPM)', min: 40, max: 220, step: 1, value: bpm(tl), def: 120, onChange: (v) => { const m = model(); m.tempo = TL().makeTempoMap([{ t: 0, bpm: Math.round(v), beatsPerBar: m.tempo[0].beatsPerBar || 4 }]); save(m); ctx.refresh(); } }),
          h('button', {
            class: 'btn', onclick: () => {
              const V = window.SVMobileVJ;
              const b = V && V.tempo ? Math.round(V.tempo().bpm) : 0;
              if (!b) return;
              const m = model();
              m.tempo = TL().makeTempoMap([{ t: 0, bpm: b, beatsPerBar: m.tempo[0].beatsPerBar || 4 }]);
              save(m);
              ctx.refresh();
            },
          }, [icon('music'), 'Tempoyu sesten al']),
          U().seg({ label: 'Hizala', options: [['bar', 'Ölçü'], ['beat', 'Vuruş'], ['off', 'Kapalı']], value: tl.snap === 'beat' || tl.snap === 'off' ? tl.snap : 'bar', def: 'bar', onChange: (v) => { const m = model(); m.snap = v; save(m, false); } }),
        ]));
        body.appendChild(h('div', { class: 'hint', text: 'Oynatma kafası bir klibe girince o klibin sahnesi uygulanır. Dışa aktarırken "Zaman çizelgesiyle" seçilirse video bu çizelgeyle, geçişleriyle birlikte çizilir. Bilgisayardaki Zaman sayfasında da açılır.' }));
      },
      onConfig(ctx) { /* Oynatırken sahne uygulamaları sayfayı baştan çizmesin */ if (!state.playing) ctx.refresh(); },
    };
  }

  if (A() && A().player && A().player.onState) A().player.onState(onPlayer);

  window.SVShellTimeline = Object.freeze({
    page,
    /** Dışa aktarma için: çizelgede klip var mı, kimliği. */
    info: () => { const c = cfg(); const tl = c.timeline || {}; return { id: tl.id || 'tl1', clips: clips().length }; },
    /** Probe ve sınama: oynatma kafası, uygulanan klip. */
    _state: () => ({ head: state.head, playing: state.playing, fired: state.fired, sel: state.sel }),
    _seek: (t) => seek(t),
  });
})();
