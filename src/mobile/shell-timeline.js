/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ZAMAN ÇİZELGESİ — telefon ve tablet (masaüstünün Zaman sayfasıyla eşlik:
   docs/android/TIMELINE.tr.md).

   ORTAK KOD. Veri, düzenleme ve çıkış masaüstüyle aynı modüllerden:
   - model, tempo haritası, işaretler, döngü, çizelge bankası: src/shared/timeline.js
   - böl, çoğalt, grup kopyala/yapıştır, parça değiştir, tempo işlemleri, geri al:
     src/shared/timeline-edit.js
   - "Timeline kullan" bileşimi ve dışa aktarma işi: src/shared/timeline-compose.js
   - gösteri saati çıpası: src/shared/showclock.js
   Burada yalnız dokunmatik yüzey ve masaüstü panelindeki küçük yapıştırıcılar (seçim,
   kayıt, taşıma) var; aynı adlarla (commit, reanchor, linkOutput …) ki karşılaştırılabilsin.

   ÇIKIŞ masaüstündeki gibi: "Timeline kullan" açıkken motor oynatma kafasındaki bileşimi her
   karede kendisi çizer (src/visualizer/visualizer.js → SVTimelineCompose.live; geçiş, opaklık,
   solma, otomasyon, video klipleri dahil). Kapalıyken çizelge elle ayara hiç dokunmaz. Kafa,
   masaüstünün panelindeki gibi bir çıpayla (SVShowClock) motora gider; telefonda motor aynı
   sayfada, çıpa SVAndroid.showClock ile iletilir.

   Telefona özel tek ek: uygulama içi çalarda şarkı varsa taşıma ona bağlanır (oynat/duraklat/
   konum şarkıyla birlikte; döngü sarınca şarkı da başa sarar, cue'da şarkı da durur).

   DÜZEN: altta yerleşik panel (src/mobile/shell.css data-size="dock"): sahne üstte görünür
   kalır. Dar ekranda parça başlıkları ince, denetçi ayrı sayfa; genişte (tablet) başlıklarda
   ad + M/S/kilit, denetçi sağda. Şerit tuvalde: src/mobile/shell-timeline-lane.js. Denetçi ve
   ayarlar: src/mobile/shell-timeline-forms.js. */
(function () {
  if (typeof window === 'undefined' || !window.SVShell) return;
  const S = window.SVShell;
  const { h, icon } = S;
  const A = () => window.SVAndroid;
  const TL = () => window.SVTimeline;
  const TE = () => window.SVTimelineEdit;
  const SC = () => window.SVShowClock;
  const LANE = () => window.SVTimelineLane;
  const FORMS = () => window.SVTimelineForms;
  const cfg = () => (A() && A().config.get()) || {};
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
  const en = () => !!(window.SVI18n && window.SVI18n.locale === 'en');
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const shellRoot = () => document.getElementById('sv-shell') || document.body;

  const MAGNET_PX = 10;
  const TYPE_LABELS = { scene: 'Sahne', preset: 'Şablon', palette: 'Renk Şablonu', visualizer: 'Görselleştirici', video: 'Video', image: 'Görsel', shader: 'Shader', action: 'Eylem' };
  const TYPE_ICONS = { scene: 'image', preset: 'sparkles', palette: 'palette', visualizer: 'bars', video: 'film', image: 'image', shader: 'code', action: 'bolt' };
  const PREF_KEY = 'sv-tl-dock';
  const prefs = (() => { try { return Object.assign({ tall: false }, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); } catch (e) { return { tall: false }; } })();
  const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* özel pencere */ } };

  // ==========================================================================
  // Model ve kayıt (masaüstü: tlCfg, ensureTransport, commit, history_)
  // ==========================================================================
  let transport = null;
  let modelDirty = true;
  let selfWrite = 0;
  let hist = null;
  /* Model yalnız çizelge verisi DIŞARIDAN değişince yeniden kurulur (içe aktarma, yedek,
     geri al). Ayarın başka alanları değişince (kaydırıcı, Otomatik VJ) cfg.timeline aynı nesne
     kalır; her değişimde kurmak sürmekte olan sürüklemeyi ve kaydedilen noktaları siliyordu. */
  let knownTl;
  function tlCfg() { return cfg().timeline || {}; }
  function ensureTransport() {
    if (transport && cfg().timeline !== knownTl) modelDirty = true;
    if (!transport) { transport = new (TL().Transport)(TL().makeTimeline(tlCfg())); modelDirty = false; knownTl = cfg().timeline; }
    else if (modelDirty) { transport.tl = TL().makeTimeline(tlCfg()); modelDirty = false; knownTl = cfg().timeline; }
    return transport;
  }
  const model = () => ensureTransport().tl;
  function history() { if (!hist) hist = new (TE().History)(100); return hist; }
  /* Yapılandırmaya yaz: masaüstünün alanları (banka, ad, useTimeline, manualBaseline, …)
     korunur, yalnız değişen alanlar yazılır. Kendi yazımımız modeli yeniden kurdurmaz. */
  function writeTl(mut) {
    const next = clone(tlCfg());
    mut(next);
    selfWrite++;
    try { A().config.patch({ timeline: next }); } finally { selfWrite--; }
    // Kendi yazımımız: model zaten bu içerikte (yeniden kurulmaz)
    knownTl = cfg().timeline;
    return next;
  }
  function commit() {
    const tl = model();
    writeTl((c) => {
      c.tracks = clone(tl.tracks);
      c.markers = clone(tl.markers);
      c.loop = clone(tl.loop);
      c.tempo = TE().tempoList(tl.tempo);
    });
    history().push(TE().snapshot(tlCfg()));
    reanchor();
    ui.changed();
  }
  function invalidate() { modelDirty = true; }
  function undo() { step(-1); }
  function redo() { step(1); }
  function step(dir) {
    const s = dir < 0 ? history().undo() : history().redo();
    if (s == null) return;
    writeTl((c) => TE().restore(c, s));
    invalidate();
    reanchor();
    ui.changed(true);
  }

  // ==========================================================================
  // Gösteri saati ve taşıma (masaüstü: reanchor, play, pause, stop, seek, go)
  // ==========================================================================
  let anchor = null;
  let lastAnchorKey = '';
  function syncTransportFromAnchor() {
    const t = ensureTransport();
    if (anchor && SC()) { t.time = SC().resolve(anchor, Date.now()); t.playing = !!anchor.playing; }
    return t;
  }
  function headTime() { return syncTransportFromAnchor().time; }
  function reanchor(force) {
    if (!SC() || !A() || !A().showClock) return;
    const t = ensureTransport();
    const hold = TL().holdAfter ? TL().holdAfter(t.tl.markers, t.time) : null;
    anchor = SC().anchorFrom(t, Date.now(), t.tl.loop, hold ? hold.t : null);
    const key = anchor.playing + '|' + anchor.time.toFixed(4) + '|' + anchor.rate + '|' + (anchor.loop ? anchor.loop.start + ',' + anchor.loop.end : '-') + '|' + (anchor.hold != null ? anchor.hold : '-');
    if (!force && key === lastAnchorKey) return;
    lastAnchorKey = key;
    A().showClock(anchor);
  }
  const player = () => (A() && A().player && A().player.state ? A().player.state() : null);
  const hasSong = () => { const p = player(); return !!(p && p.has); };
  function songSec() { const p = player(); return p && p.has && p.duration ? p.duration / 1000 : 0; }
  let pState = null;
  let pAt = 0;
  function playerPos() { return pState ? (pState.position + (pState.playing ? performance.now() - pAt : 0)) / 1000 : 0; }
  function play() {
    const t = ensureTransport();
    t.rate = 1;
    t.play();
    reanchor();
    if (hasSong()) { A().player.seek(Math.round(t.time * 1000)).catch(() => {}); A().player.play().catch(() => {}); }
    tick();
    ui.transport();
  }
  function pause() {
    syncTransportFromAnchor();
    ensureTransport().pause();
    reanchor();
    flushRecord();
    const p = player();
    if (p && p.has && p.playing) A().player.pause().catch(() => {});
    ui.transport();
  }
  function stop() {
    syncTransportFromAnchor();
    ensureTransport().stop();
    reanchor();
    flushRecord();
    const p = player();
    if (p && p.has) { if (p.playing) A().player.pause().catch(() => {}); A().player.seek(0).catch(() => {}); }
    ui.transport();
  }
  function seek(t) {
    syncTransportFromAnchor();
    ensureTransport().seek(Math.max(0, t));
    reanchor();
    if (hasSong()) A().player.seek(Math.round(ensureTransport().time * 1000)).catch(() => {});
    ui.transport();
  }
  function togglePlay() { if (syncTransportFromAnchor().playing) pause(); else play(); }
  function nextCue() {
    const t = ensureTransport();
    const list = t.tl.markers || [];
    if (!list.some((m) => m.hold === true)) return null;
    return TL().holdAfter(list, t.time - (t.playing ? 0 : 1e-6)) || null;
  }
  // GO: bekleyen cue'dan sürer; oynarken sıradaki işarete atlar
  function go() {
    const t = syncTransportFromAnchor();
    if (!t.playing) { play(); return; }
    const m = TL().markerStep(t.tl.markers, t.time, 1);
    if (m) seek(m.t);
  }
  function jumpMarker(dir) {
    const t = syncTransportFromAnchor();
    const m = dir < 0 ? TL().markerBefore(t.tl, t.time) : TL().markerAfter(t.tl, t.time);
    if (dir < 0) seek(m ? m.t : 0);
    else if (m) seek(m.t);
  }
  /* Arka plan tıkı: sayfa kapalıyken de gösteri sürer. Cue'da durur, döngü sarınca şarkı
     da sarar, şarkıyla kayma 80 ms'yi geçerse çıpa şarkıya çekilir. */
  let tickTimer = 0;
  function tick() {
    if (tickTimer) return;
    tickTimer = setInterval(() => {
      const t = syncTransportFromAnchor();
      if (!t.playing) { clearInterval(tickTimer); tickTimer = 0; flushRecord(); ui.transport(); return; }
      if (recording.size) recordTick(t.time);
      if (anchor && anchor.hold != null && t.time >= anchor.hold - 1e-6) {
        t.time = anchor.hold;
        t.pause();
        reanchor();
        const p = player();
        if (p && p.has && p.playing) A().player.pause().catch(() => {});
        ui.transport();
        return;
      }
      if (hasSong() && pState && pState.playing) {
        const lp = t.tl.loop;
        const pos = playerPos();
        if (lp && lp.enabled && lp.end > lp.start && pos >= lp.end - 0.02) {
          A().player.seek(Math.round(lp.start * 1000)).catch(() => {});
          pAt = performance.now();
          pState = Object.assign({}, pState, { position: lp.start * 1000 });
        } else if (Math.abs(pos - t.time) > 0.08) {
          t.time = pos;
          reanchor(true);
        }
      }
    }, 100);
  }
  function onPlayer(v) {
    pState = v;
    pAt = performance.now();
    if (!v || !v.has) return;
    // Şarkı dışarıdan durdurulursa (bildirim, kulaklık) çizelge de durur
    const t = syncTransportFromAnchor();
    if (t.playing && !v.playing && !v.buffering) { t.time = v.position / 1000; t.pause(); reanchor(); ui.transport(); }
  }

  // "Timeline kullan" (masaüstü: linkOutput / unlinkOutput)
  const modeOn = () => !!(window.SVTimelineCompose && window.SVTimelineCompose.modeOn(cfg()));
  function linkOutput() {
    const c = tlCfg();
    if (c.useTimeline === true && c.enabled) return;
    syncTransportFromAnchor();
    writeTl((x) => { x.useTimeline = true; x.enabled = true; });
    reanchor(true);
    ui.transport();
    if (S.refreshChrome) S.refreshChrome();
  }
  function unlinkOutput() {
    syncTransportFromAnchor();
    ensureTransport().pause();
    writeTl((x) => { x.useTimeline = false; x.enabled = false; });
    reanchor(true);
    ui.transport();
    if (S.refreshChrome) S.refreshChrome();
  }

  // ==========================================================================
  // Seçim (masaüstü: selection, multi, pickedClips, toggleMulti)
  // ==========================================================================
  let selection = null;
  let multi = [];
  let pickMode = false;
  let clipboard = null;
  const trackById = (id) => model().tracks.find((t) => t.id === id) || null;
  const trackIndex = (id) => model().tracks.findIndex((t) => t.id === id);
  function selTrack() { return selection && selection.trackId ? trackById(selection.trackId) : null; }
  function selClip() {
    const t = selTrack();
    return selection && selection.kind === 'clip' && t && t.clips ? t.clips.find((c) => c.id === selection.clipId) || null : null;
  }
  function selMarker() { return selection && selection.kind === 'marker' ? model().markers.find((m) => m.id === selection.markerId) || null : null; }
  function pickedClips() {
    const refs = multi.length > 1 ? multi : selection && selection.kind === 'clip' ? [selection] : [];
    const out = [];
    for (const r of refs) {
      const trk = trackById(r.trackId);
      const clip = trk && trk.clips ? trk.clips.find((c) => c.id === r.clipId) : null;
      if (clip) out.push({ trk, clip, trackIndex: trackIndex(trk.id) });
    }
    return out;
  }
  function setSelection(s) { selection = s; if (!s || s.kind !== 'clip') multi = []; ui.selection(); }
  function setMulti(refs) {
    multi = refs.length > 1 ? refs.slice() : [];
    const last = refs[refs.length - 1];
    selection = last ? { kind: 'clip', trackId: last.trackId, clipId: last.clipId } : null;
    ui.selection();
  }
  function toggleMulti(trk, c) {
    if (multi.length <= 1) multi = selection && selection.kind === 'clip' ? [{ trackId: selection.trackId, clipId: selection.clipId }] : [];
    const i = multi.findIndex((m) => m.clipId === c.id && m.trackId === trk.id);
    if (i >= 0) multi.splice(i, 1);
    else multi.push({ trackId: trk.id, clipId: c.id });
    const last = multi[multi.length - 1];
    selection = last ? { kind: 'clip', trackId: last.trackId, clipId: last.clipId } : { kind: 'track', trackId: trk.id };
    if (multi.length <= 1) multi = [];
    ui.selection();
  }
  function setPickMode(on) {
    pickMode = !!on;
    if (!pickMode && multi.length <= 1) multi = [];
    ui.selection();
  }

  // ==========================================================================
  // Yakalama (masaüstü: snap, snapMove; mıknatıs MAGNET_PX)
  // ==========================================================================
  function snap(t, skip) {
    const c = tlCfg();
    const mode = c.snap || 'bar';
    const zoom = ui.zoom();
    if (mode !== 'off') {
      const m = TE().magnetSnap(t, TE().snapCandidates(model(), ensureTransport().time, skip), MAGNET_PX / zoom);
      if (m != null) return Math.max(0, m);
    }
    return Math.max(0, TL().snapSeconds(model().tempo, t, mode, c.fps));
  }
  function snapMove(start, dur, skip) {
    const c = tlCfg();
    if ((c.snap || 'bar') !== 'off') {
      const cand = TE().snapCandidates(model(), ensureTransport().time, skip);
      const tol = MAGNET_PX / ui.zoom();
      const a = TE().magnetSnap(start, cand, tol);
      const b = TE().magnetSnap(start + dur, cand, tol);
      if (a != null && (b == null || Math.abs(a - start) <= Math.abs(b - start - dur))) return Math.max(0, a);
      if (b != null) return Math.max(0, b - dur);
    }
    return snap(start, skip);
  }
  // Cetvelde kafa: ızgaraya oturur ama mıknatıs yok (kaydırırken takılmasın)
  function snapFree(t) {
    const c = tlCfg();
    return Math.max(0, TL().snapSeconds(model().tempo, t, c.snap || 'bar', c.fps));
  }

  // ==========================================================================
  // Düzenleme işlemleri (masaüstüyle aynı adlar)
  // ==========================================================================
  function targetClipTrack() {
    const tl = model();
    const s = selTrack();
    if (s && s.kind === 'clip') return s;
    let t = tl.tracks.find((x) => x.kind === 'clip');
    if (!t) { t = TL().makeTrack({ kind: 'clip', name: tr('Parça') + ' ' + (tl.tracks.length + 1) }); tl.tracks.push(t); }
    return t;
  }
  function addClipAt(trk, at, spec) {
    const c = TL().makeClip(Object.assign({ start: at, dur: TE().gridStep(model().tempo, 'bar', 60, at) * 2 }, spec || {}));
    trk.clips.push(c);
    TE().sortClips(trk);
    selection = { kind: 'clip', trackId: trk.id, clipId: c.id };
    multi = [];
    commit();
    return c;
  }
  function addTrack(kind) {
    const tl = model();
    const t = TL().makeTrack({ kind, name: tr(kind === 'automation' ? 'Otomasyon' : 'Parça') + ' ' + (tl.tracks.length + 1) });
    tl.tracks.push(t);
    selection = { kind: 'track', trackId: t.id };
    multi = [];
    commit();
    // Masaüstünde klip parçası eklemek çıkışı çizelgeye bağlar
    if (kind === 'clip') linkOutput();
    return t;
  }
  function deleteSelection() {
    const tl = model();
    if (selection && selection.kind === 'marker') {
      const i = tl.markers.findIndex((m) => m.id === selection.markerId);
      if (i < 0) return false;
      tl.markers.splice(i, 1);
      selection = null;
      commit();
      return true;
    }
    if (selection && selection.kind === 'tempo') {
      if (!(selection.index > 0)) return false;
      const list = TE().removeTempoChange(tl.tempo, selection.index);
      selection = null;
      applyTempo(list);
      return true;
    }
    if (multi.length > 1) {
      const gone = pickedClips().filter((p) => !p.trk.locked);
      if (!gone.length) return false;
      for (const p of gone) p.trk.clips.splice(p.trk.clips.indexOf(p.clip), 1);
      multi = [];
      selection = null;
      commit();
      return true;
    }
    const trk = selTrack();
    if (!trk || trk.locked || !selection) return false;
    if (selection.kind === 'clip') {
      const i = trk.clips.findIndex((c) => c.id === selection.clipId);
      if (i < 0) return false;
      trk.clips.splice(i, 1);
    } else if (selection.kind === 'key') {
      if (!trk.keys[selection.keyIndex]) return false;
      trk.keys.splice(selection.keyIndex, 1);
    } else return false;
    selection = { kind: 'track', trackId: trk.id };
    commit();
    return true;
  }
  function placeGroup(placed) {
    const tl = model();
    const refs = [];
    const touched = new Set();
    for (const p of placed) {
      const trk = tl.tracks[p.trackIndex];
      if (!trk || trk.kind !== 'clip' || trk.locked) continue;
      trk.clips.push(p.clip);
      touched.add(trk);
      refs.push({ trackId: trk.id, clipId: p.clip.id });
    }
    touched.forEach((t) => TE().sortClips(t));
    if (!refs.length) return false;
    multi = refs.length > 1 ? refs : [];
    selection = { kind: 'clip', trackId: refs[refs.length - 1].trackId, clipId: refs[refs.length - 1].clipId };
    commit();
    return true;
  }
  function duplicateSelection() {
    if (multi.length > 1) {
      const picked = pickedClips().filter((p) => !p.trk.locked);
      return picked.length ? placeGroup(TE().duplicateGroup(model(), picked)) : false;
    }
    const trk = selTrack();
    const c = selClip();
    if (!trk || !c || trk.locked) return false;
    const copy = TE().duplicateClip(c);
    trk.clips.push(copy);
    TE().sortClips(trk);
    selection = { kind: 'clip', trackId: trk.id, clipId: copy.id };
    commit();
    return true;
  }
  function splitAtPlayhead() {
    const trk = selTrack();
    if (!trk || trk.kind !== 'clip' || trk.locked) return false;
    const t = headTime();
    const c = selClip() || trk.clips.find((x) => t > x.start && t < x.start + x.dur);
    const right = c ? TE().splitClip(c, t) : null;
    if (!right) return false;
    trk.clips.push(right);
    TE().sortClips(trk);
    selection = { kind: 'clip', trackId: trk.id, clipId: right.id };
    commit();
    return true;
  }
  function copySelection() {
    if (multi.length > 1) { clipboard = { group: TE().copyGroup(pickedClips(), model()) }; return !!clipboard.group; }
    const c = selClip();
    if (!c) return false;
    clipboard = clone(c);
    return true;
  }
  function cutSelection() { return copySelection() && deleteSelection(); }
  function pasteAtPlayhead() {
    if (!clipboard) return false;
    if (clipboard.group) {
      const base = trackIndex(targetClipTrack().id);
      return placeGroup(TE().pasteGroup(model(), clipboard.group, snap(headTime()), base));
    }
    const trk = targetClipTrack();
    if (trk.locked) return false;
    const copy = TE().pasteClip(clipboard, snap(headTime()));
    trk.clips.push(copy);
    TE().sortClips(trk);
    selection = { kind: 'clip', trackId: trk.id, clipId: copy.id };
    commit();
    return true;
  }
  function moveSelectionTrack(dir) {
    const tl = model();
    const picked = pickedClips().filter((q) => !q.trk.locked);
    if (!picked.length) return false;
    const plan = [];
    for (const q of picked) {
      const j = TE().adjacentClipTrack(tl, q.trackIndex, dir);
      if (j < 0) return false;
      plan.push([q, j]);
    }
    const refs = [];
    for (const [q, j] of plan) { const to = TE().moveClipToTrack(tl, q.clip, j); if (to) refs.push({ trackId: to.id, clipId: q.clip.id }); }
    if (!refs.length) return false;
    multi = refs.length > 1 ? refs : [];
    selection = { kind: 'clip', trackId: refs[refs.length - 1].trackId, clipId: refs[refs.length - 1].clipId };
    commit();
    return true;
  }
  // Izgaranın bir adımı (masaüstünde ok tuşları)
  function nudge(dir) {
    const tl = model();
    const c0 = tlCfg();
    const c = selClip();
    const at = c ? c.start : headTime();
    const stepSec = TE().gridStep(tl.tempo, c0.snap || 'bar', c0.fps, dir < 0 ? Math.max(0, at - 1e-6) : at);
    if (multi.length > 1) {
      const picked = pickedClips().filter((p) => !p.trk.locked);
      if (!picked.length) return false;
      const d = TE().groupDelta(picked.map((p) => p.clip.start), dir * stepSec);
      const touched = new Set();
      for (const p of picked) { p.clip.start += d; touched.add(p.trk); }
      touched.forEach((t) => TE().sortClips(t));
      commit();
      return true;
    }
    if (c) {
      const trk = selTrack();
      if (trk.locked) return false;
      c.start = Math.max(0, c.start + dir * stepSec);
      TE().sortClips(trk);
      commit();
      return true;
    }
    seek(Math.max(0, headTime() + dir * stepSec));
    return true;
  }
  function selectAllClips() {
    const refs = [];
    for (const t of model().tracks) if (t.kind === 'clip') for (const c of t.clips) refs.push({ trackId: t.id, clipId: c.id });
    if (refs.length) { pickMode = true; setMulti(refs); }
  }
  // İşaretler, döngü, tempo
  function addMarkerAtPlayhead(at) {
    const tl = model();
    const m = TL().makeMarker({ t: at == null ? headTime() : at, name: tr('İşaret') + ' ' + (tl.markers.length + 1) });
    tl.markers.push(m);
    tl.markers.sort((a, b) => a.t - b.t);
    selection = { kind: 'marker', markerId: m.id };
    multi = [];
    commit();
    return m;
  }
  function toggleLoop() {
    const tl = model();
    if (!(tl.loop.end > tl.loop.start)) {
      const c = selClip();
      const s = c ? c.start : snap(headTime());
      const e = c ? c.start + c.dur : s + TE().gridStep(tl.tempo, 'bar', 60, s) * 4;
      tl.loop = { enabled: true, start: s, end: e };
    } else tl.loop = Object.assign({}, tl.loop, { enabled: !tl.loop.enabled });
    commit();
  }
  function setLoopEdge(which, at) {
    const tl = model();
    const lp = Object.assign({}, tl.loop);
    lp[which] = Math.max(0, at);
    if (!(lp.end > lp.start)) lp.enabled = false;
    else if (which === 'end' || which === 'start') lp.enabled = lp.enabled || lp.end > lp.start;
    tl.loop = lp;
    commit();
  }
  function applyTempo(list, selectIndex) {
    model().tempo = TL().makeTempoMap(list);
    if (selectIndex != null) { selection = { kind: 'tempo', index: selectIndex }; multi = []; }
    commit();
  }
  function tempoAtHead() { return TE().tempoIndexAt(TE().tempoList(model().tempo), headTime()); }
  function addTempoAtHead() {
    const r = TE().addTempoChange(model().tempo, snap(headTime()), null);
    applyTempo(r.list, r.index);
  }
  // Tempo etiketini sürüklerken: liste yerinde değişir, bırakınca bir kez kaydedilir
  function setTempoList(list, index, done) {
    if (list) model().tempo = TL().makeTempoMap(list);
    selection = { kind: 'tempo', index };
    if (done) commit();
  }
  function addKey(trk, t, v) {
    if (!trk || trk.locked || trk.kind !== 'automation') return;
    trk.keys.push({ t, v, curve: 'linear' });
    trk.keys.sort((a, b) => a.t - b.t);
    selection = { kind: 'key', trackId: trk.id, keyIndex: trk.keys.findIndex((k) => k.t === t && k.v === v) };
    commit();
  }

  // ---- Otomasyon öğren / kaydet (masaüstü: startLearn, toggleRecord, recordTick) ----
  /* Öğren: çizelge kapanır, kullanıcı uygulamada bir ayarı oynatır; değişen ilk sayısal
     yaprak (masaüstündeki gibi önce/sonra farkı) parçanın hedefi olur ve çizelge o parçanın
     ayarlarıyla geri açılır. Kaydet: oynarken hedef ayarın elle değişimi noktalara yazılır
     (TE.recordKey, 0,08 sn aralık); duraklatınca tek adım geçmişe. */
  const getInCfg = (path) => String(path || '').split('.').reduce((o, k) => (o == null ? undefined : o[k]), cfg());
  function leaves() {
    const out = new Map();
    const walk = (o, pre, d) => {
      if (d > 8 || o == null) return;
      if (typeof o === 'number') { out.set(pre, o); return; }
      if (typeof o !== 'object') return;
      for (const k of Object.keys(o)) {
        if (!pre && (k === 'timeline' || k === 'scenes' || k === 'presets' || k === 'userPresets')) continue;
        walk(o[k], pre ? pre + '.' + k : k, d + 1);
      }
    };
    walk(cfg(), '', 0);
    return out;
  }
  let learning = null;
  function startLearn(trk) {
    stopLearn();
    learning = { id: trk.id, before: leaves(), timer: 0 };
    if (ui.ctx) ui.ctx.close();
    if (S.refreshChrome) S.refreshChrome();
  }
  function stopLearn() { if (learning) clearTimeout(learning.timer); learning = null; }
  function onConfigPatch(p) {
    if (!learning || !p || selfWrite) return;
    clearTimeout(learning.timer);
    // Kaydırıcı bırakılınca (son değişimden yarım saniye sonra) karar verilir
    learning.timer = setTimeout(() => {
      if (!learning) return;
      const now = leaves();
      let hit = '';
      for (const [k, v] of now) if (learning.before.has(k) && learning.before.get(k) !== v) { hit = k; break; }
      if (!hit) return;
      const id = learning.id;
      stopLearn();
      invalidate();
      const trk = trackById(id);
      if (!trk) return;
      const meta = (FORMS() ? FORMS().targetCatalog(core) : []).find((x) => x.path === hit) || {};
      trk.target = hit;
      if (isFinite(meta.min) && isFinite(meta.max)) { trk.min = meta.min; trk.max = meta.max; }
      if (!trk.name || /^(Otomasyon|Automation)\s*\d*$/.test(trk.name)) trk.name = tr(meta.label || hit);
      selection = { kind: 'track', trackId: id };
      multi = [];
      recording.set(id, getInCfg(hit));
      commit();
      S.openPage(page());
      openInspector();
    }, 500);
  }
  const recording = new Map();
  let recordDirty = false;
  function toggleRecord(trk) {
    if (!trk || trk.kind !== 'automation') return false;
    if (learning && learning.id === trk.id) { stopLearn(); return true; }
    if (!trk.target) { startLearn(trk); return true; }
    if (recording.has(trk.id)) {
      recording.delete(trk.id);
      if (recordDirty) { recordDirty = false; commit(); }
    } else {
      recording.set(trk.id, getInCfg(trk.target));
      linkOutput();
    }
    ui.heads();
    return true;
  }
  function recordTick(t) {
    for (const [id, last] of recording) {
      const trk = trackById(id);
      if (!trk || !trk.target) { recording.delete(id); continue; }
      const v = getInCfg(trk.target);
      if (typeof v !== 'number' || v === last) continue;
      recording.set(id, v);
      TE().recordKey(trk, t, v, 0.08);
      recordDirty = true;
    }
    if (recordDirty && ui.lane) ui.lane.draw();
  }
  function flushRecord() { if (recordDirty) { recordDirty = false; commit(); } }

  // ---- Çizelge bankası (masaüstündeki sekmeler) ----
  function bankList() { return TL().listTimelineBank(clone(tlCfg())); }
  function bankWrite(fn) {
    pause();
    writeTl((c) => { TL().ensureTimelineBank(c); fn(c); });
    selection = null;
    multi = [];
    hist = null;
    invalidate();
    reanchor(true);
    history().push(TE().snapshot(tlCfg()));
    ui.changed(true);
  }
  const bank = {
    list: bankList,
    current: () => { const c = tlCfg(); return { id: c.id || '', name: c.name || 'A', itemEnabled: c.itemEnabled !== false }; },
    switchTo: (id) => bankWrite((c) => TL().switchTimeline(c, id)),
    add: () => bankWrite((c) => TL().addTimeline(c)),
    rename: (id, name) => bankWrite((c) => { if (id === c.id) c.name = name; else { const hit = (c.bank || []).find((b) => b && b.id === id); if (hit) hit.name = name; } }),
    setEnabled: (id, on) => bankWrite((c) => TL().setTimelineItemEnabled(c, id, on)),
    remove: (id) => bankWrite((c) => TL().removeTimeline(c, id)),
    move: (id, to) => bankWrite((c) => TL().moveTimeline(c, id, to)),
  };

  // ==========================================================================
  // Etiketler (masaüstü: clipSourceLabel, clipLabel)
  // ==========================================================================
  function clipSourceLabel(c) {
    if (!c.ref) return '';
    if (c.type === 'scene') { const sc = (cfg().scenes || []).find((s) => s && s.id === c.ref); return sc ? tr(sc.name || sc.id) : tr('Silinmiş sahne'); }
    if (c.type === 'preset' && window.SVTemplates) { const tp = window.SVTemplates.TEMPLATES.find((x) => x.id === c.ref); return tp ? tr(tp.name) : c.ref; }
    if (c.type === 'palette') return tr(c.ref);
    if (c.type === 'visualizer') { const MC = window.SVModeCatalog; const hit = MC && MC.VISUALIZERS && MC.VISUALIZERS.find((m) => m.id === c.ref); return hit ? tr(hit.label || hit.id) : c.ref; }
    if (c.type === 'video') return c.name || decodeURIComponent(String(c.ref).split('/').pop() || '');
    if (c.type === 'image') return c.name || tr('Görsel');
    if (c.type === 'shader') { const P = window.SVPresets; const p = P && P.get ? P.get(c.ref) : null; return (p && p.name) || c.ref; }
    if (c.type === 'action') { const hit = actionOptions().find((o) => o[0] === c.ref); return hit ? hit[1] : c.ref; }
    return c.ref;
  }
  function clipLabel(c) { return c.name || clipSourceLabel(c) || tr(TYPE_LABELS[c.type] || c.type) + ' · ' + tr('Boş klip'); }
  const typeLabel = (t) => tr(TYPE_LABELS[t] || t);
  /* Eylem klipleri: masaüstünün MIDI/OSC eylem listesinden telefonda karşılığı olanlar
     (src/admin/control.js eylemleri; çalışan karşılıkları burada). */
  function actionOptions() {
    return [
      ['blackout', tr('Karartma')], ['nextScene', tr('Sonraki Sahne')], ['nextVisualizer', tr('Sonraki Görselleştirici')],
      ['prevVisualizer', tr('Önceki Görselleştirici')], ['nextPalette', tr('Sonraki Renk Şablonu')], ['nextBackground', tr('Sonraki Arkaplan')],
      ['tlPause', tr('Zaman Çizelgesi: Duraklat')], ['tlStop', tr('Zaman Çizelgesi: Durdur')],
      ['tlNextMarker', tr('Zaman Çizelgesi: Sonraki İşaret')], ['tlPrevMarker', tr('Zaman Çizelgesi: Önceki İşaret')],
    ];
  }

  // ==========================================================================
  // Arayüz
  // ==========================================================================
  const ui = {
    refs: null,
    lane: null,
    ctx: null,
    zoom: () => (ui.lane ? ui.lane.zoom() : 24),
    changed(structural) { if (!ui.refs) return; if (structural && ui.ctx) { ui.ctx.refresh(); return; } ui.selection(); ui.heads(); ui.transport(); },
    selection() { if (!ui.refs) return; ui.toolbar(); ui.heads(); ui.inspector(); if (ui.lane) ui.lane.draw(); },
    transport() {},
    heads() {},
    toolbar() {},
    inspector() {},
  };
  const laneH = () => { const v = Number(tlCfg().laneHeight); return Math.max(40, Math.min(120, v > 0 ? v : (ui.refs && ui.refs.wide ? 64 : 52))); };
  function length(tl) {
    const end = TL().timelineLength(tl);
    return Math.max(30, end + 8, songSec() + 2);
  }
  function fmt(sec) {
    const s = Math.max(0, sec);
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1).replace('.', en() ? '.' : ',');
  }

  /* Bağlam menüsü (masaüstünde sağ tık): uzun basınca. */
  function contextMenu(info) {
    const tl = model();
    const items = [];
    const t = snap(info.t);
    if (info.clip && info.trk) {
      items.push(['inspect', 'Klip ayarları'], ['split', 'Kafada böl'], ['dup', 'Çoğalt'], ['copy', 'Kopyala'], ['cut', 'Kes'], ['del', 'Sil']);
      if (TE().adjacentClipTrack(tl, trackIndex(info.trk.id), -1) >= 0) items.push(['up', 'Üst parçaya taşı']);
      if (TE().adjacentClipTrack(tl, trackIndex(info.trk.id), 1) >= 0) items.push(['down', 'Alt parçaya taşı']);
      if (info.clip.color) items.push(['color0', 'Rengi parçadan al']);
    } else if (info.trk && info.trk.kind === 'automation') {
      if (info.key != null) items.push(['keydel', 'Noktayı sil']);
      items.push(['addkey', 'Buraya nokta ekle']);
      if (info.trk.keys.length) items.push(['keysclear', 'Noktaları temizle']);
    } else if (info.trk && info.trk.kind === 'clip') {
      items.push(['addclip', 'Buraya klip ekle']);
      if (clipboard) items.push(['paste', 'Yapıştır']);
    }
    items.push(['head', 'Kafayı buraya al'], ['marker', 'Buraya işaret'], ['loopA', 'Döngü başı burası'], ['loopB', 'Döngü sonu burası']);
    if (info.trk) items.push(['track', 'Parça ayarları']);
    if (info.clip) setSelection({ kind: 'clip', trackId: info.trk.id, clipId: info.clip.id });
    S.choose(info.clip ? clipLabel(info.clip) : fmt(t), items.map(([k, l]) => [k, tr(l)]), '').then((v) => {
      if (!v) return;
      const trk = info.trk ? trackById(info.trk.id) : null;
      switch (v) {
        case 'inspect': openInspector(); break;
        case 'split': splitAtPlayhead(); break;
        case 'dup': duplicateSelection(); break;
        case 'copy': copySelection(); break;
        case 'cut': cutSelection(); break;
        case 'del': deleteSelection(); break;
        case 'up': moveSelectionTrack(-1); break;
        case 'down': moveSelectionTrack(1); break;
        case 'color0': { const c = selClip(); if (c) { c.color = ''; commit(); } break; }
        case 'addkey': if (trk) addKey(trk, t, 0.5); break;
        case 'keydel': if (trk && trk.keys[info.key]) { trk.keys.splice(info.key, 1); selection = { kind: 'track', trackId: trk.id }; commit(); } break;
        case 'keysclear': if (trk) { trk.keys = []; commit(); } break;
        case 'addclip': if (trk) addClipFlow(trk, t); break;
        case 'paste': seek(t); pasteAtPlayhead(); break;
        case 'head': seek(t); break;
        case 'marker': addMarkerAtPlayhead(t); break;
        case 'loopA': setLoopEdge('start', t); break;
        case 'loopB': setLoopEdge('end', t); break;
        case 'track': if (trk) { setSelection({ kind: 'track', trackId: trk.id }); openInspector(); } break;
        default: break;
      }
    });
  }

  /* Klip ekleme: tür, sonra kaynak (masaüstünde boş klip + denetçi; dokunmatikte iki adım
     daha kısa). Kaynak seçimi formlardaki aynı listeden. */
  function addClipFlow(trk0, at) {
    const trk = trk0 || targetClipTrack();
    if (trk.locked) { S.confirm(tr('Parça kilitli.'), tr('Tamam')); return; }
    const types = ['scene', 'preset', 'palette', 'visualizer', 'video', 'image', 'shader', 'action'];
    S.choose(tr('Klip türü'), types.map((t) => [t, typeLabel(t)]), '').then((type) => {
      if (!type) return;
      FORMS().pickSource(core, type, null).then((src) => {
        if (!src) return;
        const t = at == null ? snap(headTime()) : at;
        addClipAt(trackById(trk.id) || targetClipTrack(), t, Object.assign({ type }, src));
        if (!modeOn() && type !== 'action') linkOutput();
      });
    });
  }

  function openInspector() {
    if (!ui.ctx) return;
    if (ui.refs && ui.refs.wide) { ui.inspector(); return; }
    ui.ctx.push(FORMS().page(core, 'selection'));
  }
  function openSettings() { if (ui.ctx) ui.ctx.push(FORMS().page(core, 'settings')); }

  // ---- Sayfa ----
  function bankMenu() {
    const list = bankList();
    const cur = bank.current();
    const opts = list.map((it) => ['go:' + it.id, (it.id === cur.id ? '● ' : '') + (it.name || it.id) + (it.itemEnabled === false ? ' (' + tr('pasif') + ')' : '')]);
    opts.push(['add', '＋ ' + tr('Yeni zaman çizelgesi')], ['rename', tr('Yeniden adlandır')], ['toggle', cur.itemEnabled ? tr('Pasifleştir (silme)') : tr('Etkinleştir')]);
    if (list.length > 1) opts.push(['left', tr('Sola taşı')], ['right', tr('Sağa taşı')]);
    opts.push(['del', tr('Sil')]);
    S.choose(tr('Zaman çizelgeleri'), opts, 'go:' + cur.id).then((v) => {
      if (!v) return;
      if (v.indexOf('go:') === 0) { const id = v.slice(3); if (id !== cur.id) bank.switchTo(id); return; }
      if (v === 'add') bank.add();
      else if (v === 'rename') S.prompt(tr('Çizelge adı'), cur.name).then((n) => { if (n && n.trim()) bank.rename(cur.id, n.trim()); });
      else if (v === 'toggle') bank.setEnabled(cur.id, !cur.itemEnabled);
      else if (v === 'left' || v === 'right') { const i = list.findIndex((x) => x.id === cur.id); bank.move(cur.id, Math.max(0, i + (v === 'left' ? -1 : 1))); }
      else if (v === 'del') S.confirm(tr('Bu zaman çizelgesi silinsin mi?'), tr('Sil'), true).then((ok) => { if (ok) bank.remove(cur.id); });
    });
  }

  function chip(ic, label, on, opts) {
    const o = opts || {};
    return h('button', {
      class: 'btn tl-chip' + (o.primary ? ' primary' : '') + (o.on ? ' on' : '') + (o.danger ? ' danger' : ''),
      disabled: o.disabled ? true : null, 'aria-pressed': o.on != null ? String(!!o.on) : null, 'aria-label': tr(label),
      onclick: on,
    }, [icon(ic), h('span', { text: label })]);
  }
  const SNAP_PAIRS = [['off', 'Kapalı'], ['bar', 'Ölçü'], ['beat', 'Vuruş'], ['half', 'Yarım Vuruş'], ['quarter', 'Çeyrek Vuruş'], ['1s', '1 saniye'], ['0.5s', '0,5 saniye'], ['frame', 'Kare']];
  function snapMenu() {
    S.choose(tr('Yakalama'), SNAP_PAIRS.map(([k, l]) => [k, tr(l)]), tlCfg().snap || 'bar').then((v) => {
      if (!v) return;
      writeTl((c) => { c.snap = v; });
      invalidate();
      ui.toolbar();
    });
  }
  function addMenu() {
    S.choose(tr('Ekle'), [['clip', tr('Kafada klip')], ['ctrack', tr('Klip parçası')], ['atrack', tr('Otomasyon parçası')], ['marker', tr('Kafada işaret')], ['tempo', tr('Kafada tempo değişimi')]], '').then((v) => {
      if (v === 'clip') addClipFlow(null, null);
      else if (v === 'ctrack') addTrack('clip');
      else if (v === 'atrack') { addTrack('automation'); openInspector(); }
      else if (v === 'marker') addMarkerAtPlayhead();
      else if (v === 'tempo') addTempoAtHead();
    });
  }

  function page() {
    return {
      size: 'dock',
      title: 'Zaman Çizelgesi',
      lead(slot) {
        const cur = bank.current();
        slot.appendChild(h('button', { class: 'tl-bank', 'aria-label': tr('Zaman çizelgeleri') + ': ' + cur.name, onclick: bankMenu }, [
          icon('timeline'), h('span', { class: 'tl-bank-name', text: cur.name + (cur.itemEnabled ? '' : ' · ' + tr('pasif')) }), icon('caret-down'),
        ]));
      },
      actions(slot, ctx) {
        const H = history();
        slot.appendChild(h('button', { class: 'iconbtn plain', 'aria-label': 'Geri Al', title: 'Geri Al', disabled: H.canUndo() ? null : true, onclick: undo }, [icon('undo')]));
        slot.appendChild(h('button', { class: 'iconbtn plain', 'aria-label': 'Yinele', title: 'Yinele', disabled: H.canRedo() ? null : true, onclick: redo }, [icon('redo')]));
        slot.appendChild(h('button', { class: 'iconbtn plain', 'aria-label': 'Çizelge ayarları', title: 'Çizelge ayarları', onclick: openSettings }, [icon('gear')]));
        slot.appendChild(h('button', { class: 'iconbtn plain', 'aria-label': 'Kapat', title: 'Kapat', onclick: () => ctx.close() }, [icon('x')]));
      },
      render(body, ctx) {
        if (!TL() || !TE() || !LANE() || !FORMS()) { body.appendChild(h('div', { class: 'empty', text: 'Zaman çizelgesi bu sürümde yok.' })); return; }
        renderDock(body, ctx);
      },
      onConfig(ctx) {
        if (selfWrite) return;
        // Çizelge dışarıdan değiştiyse model yeniden kurulur (ensureTransport); sahne adları için yeniden çiz
        if (cfg().timeline !== knownTl && ui.lane) { ui.heads(); ui.lane.draw(); ui.transport(); }
        else if (ui.lane) ui.lane.draw();
      },
    };
  }

  function renderDock(body, ctx) {
    if (ui.lane) ui.lane.destroy();
    ui.ctx = ctx;
    if (!hist) history().sync(TE().snapshot(tlCfg()));
    body.classList.add('tl-dock');
    const refs = ui.refs = { wide: false };
    // Taşıma
    refs.play = h('button', { class: 'iconbtn tl-play', onclick: togglePlay }, [icon('play')]);
    refs.time = h('div', { class: 'tl-clock' }, [h('span', { class: 'mono tl-time' }), h('span', { class: 'mono tl-bars' })]);
    refs.go = h('button', { class: 'btn tl-go', onclick: go }, [icon('play'), h('span', { text: 'GO' })]);
    refs.cue = h('span', { class: 'tl-cue' });
    refs.useBtn = h('button', { class: 'pill tl-use', role: 'switch', onclick: () => (modeOn() ? unlinkOutput() : linkOutput()) }, [icon('broadcast'), h('span', { text: tr('Timeline kullan') })]);
    refs.prev = h('button', { class: 'iconbtn plain tl-wideonly', 'aria-label': tr('Önceki işaret'), title: tr('Önceki işaret'), onclick: () => jumpMarker(-1) }, [icon('prev')]);
    refs.next = h('button', { class: 'iconbtn plain tl-wideonly', 'aria-label': tr('Sonraki işaret'), title: tr('Sonraki işaret'), onclick: () => jumpMarker(1) }, [icon('next')]);
    refs.size = h('button', { class: 'iconbtn plain', 'aria-label': tr(prefs.tall ? 'Sahneyi büyüt' : 'Çizelgeyi büyüt'), title: tr(prefs.tall ? 'Sahneyi büyüt' : 'Çizelgeyi büyüt'), onclick: () => { prefs.tall = !prefs.tall; savePrefs(); shellRoot().classList.toggle('tl-tall', prefs.tall); refs.size.replaceChildren(icon(prefs.tall ? 'chevron-down' : 'chevron-up')); } }, [icon(prefs.tall ? 'chevron-down' : 'chevron-up')]);
    shellRoot().classList.toggle('tl-tall', prefs.tall);
    const transportRow = h('div', { class: 'tl-transport' }, [
      h('button', { class: 'iconbtn plain', 'aria-label': tr('Durdur ve başa dön'), title: tr('Durdur ve başa dön'), onclick: stop }, [icon('stop')]),
      refs.prev, refs.play, refs.next, refs.time, h('div', { class: 'tl-cues' }, [refs.go, refs.cue]), h('div', { class: 'spacer' }), refs.useBtn, refs.size,
    ]);
    // Düzenleme alanı: başlıklar + şerit (+ genişte denetçi)
    refs.headsList = h('div', { class: 'tl-heads-list' });
    refs.heads = h('div', { class: 'tl-heads' }, [h('div', { class: 'tl-heads-ruler' }), h('div', { class: 'tl-heads-clip' }, [refs.headsList])]);
    refs.laneHost = h('div', { class: 'tl-lane' });
    refs.side = h('div', { class: 'tl-side' });
    refs.editor = h('div', { class: 'tl-editor' }, [refs.heads, refs.laneHost, refs.side]);
    refs.toolbar = h('div', { class: 'tl-toolbar', role: 'toolbar', 'aria-label': tr('Zaman çizelgesi araçları') });
    body.append(transportRow, refs.editor, refs.toolbar);

    ui.lane = LANE().create(refs.laneHost, laneApi);
    // Genişlik: tablette başlıklar geniş, denetçi yanda
    const measure = () => {
      const w = body.getBoundingClientRect().width;
      const wide = w >= 900;
      const midW = w >= 560;
      body.classList.toggle('mid', midW);
      if (wide !== refs.wide) { refs.wide = wide; body.classList.toggle('wide', wide); ui.heads(); ui.inspector(); ui.lane.draw(); }
    };
    if (typeof ResizeObserver === 'function') { refs.ro = new ResizeObserver(measure); refs.ro.observe(body); }
    requestAnimationFrame(measure);

    ui.transport = paintTransport;
    ui.heads = paintHeads;
    ui.toolbar = paintToolbar;
    ui.inspector = paintSide;
    paintTransport();
    paintHeads();
    paintToolbar();
    // Oynatırken kafayı takip eden çizim döngüsü (sayfa açıkken)
    const loop = () => {
      // Sayfa yeniden çizildiyse bu döngü biter; yeni çizimin referanslarına dokunmaz
      if (!refs.laneHost.isConnected) { if (ui.refs === refs) { ui.refs = null; ui.lane = null; } return; }
      const t = syncTransportFromAnchor();
      if (t.playing) {
        if (tlCfg().followPlayhead !== false) ui.lane.follow(t.time);
        ui.lane.draw();
        paintClock();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  function paintClock() {
    const refs = ui.refs;
    if (!refs) return;
    const t = syncTransportFromAnchor();
    const b = TL().secondsToBars(t.tl.tempo, t.time);
    const bpm = TE().tempoList(t.tl.tempo)[tempoAtHead()];
    refs.time.firstChild.textContent = fmt(t.time) + (songSec() ? ' / ' + fmt(songSec()) : '');
    refs.time.lastChild.textContent = b.bar + '.' + b.beat + ' · ' + Math.round(bpm.bpm) + ' BPM';
    const nc = nextCue();
    refs.go.parentNode.hidden = !(t.tl.markers || []).some((m) => m.hold === true);
    refs.cue.textContent = nc ? tr('Sıradaki') + ': ' + (nc.name || fmt(nc.t)) : tr('Son cue');
  }
  function paintTransport() {
    const refs = ui.refs;
    if (!refs) return;
    const t = syncTransportFromAnchor();
    refs.play.replaceChildren(icon(t.playing ? 'pause' : 'play'));
    refs.play.setAttribute('aria-label', tr(t.playing ? 'Duraklat' : 'Oynat'));
    const on = modeOn();
    refs.useBtn.classList.toggle('on', on);
    refs.useBtn.setAttribute('aria-checked', String(on));
    paintClock();
    if (ui.lane) ui.lane.draw();
    // Başlıktaki geri al/yinele
    if (ui.ctx && ui.ctx.top && ui.ctx.top.size === 'dock' && ui.ctx.depth() === 1) {
      const slot = document.querySelector('#sv-shell .sheet-actions');
      if (slot) {
        const [u, r] = slot.querySelectorAll('.iconbtn');
        if (u) u.disabled = !history().canUndo();
        if (r) r.disabled = !history().canRedo();
      }
    }
  }
  function paintHeads() {
    const refs = ui.refs;
    if (!refs) return;
    const tl = model();
    const lh = laneH();
    refs.headsList.textContent = '';
    tl.tracks.forEach((trk) => {
      const on = selection && selection.trackId === trk.id;
      const col = trk.color || (trk.kind === 'clip' ? '' : '');
      const tog = (letter, key, label) => h('button', {
        class: 'tl-tog ' + key + (trk[key] ? ' on' : ''), 'aria-pressed': String(!!trk[key]), 'aria-label': tr(label) + ': ' + (trk.name || ''),
        onclick: (e) => { e.stopPropagation(); trk[key] = !trk[key]; commit(); },
      }, letter === 'lock' ? [icon(trk.locked ? 'lock' : 'unlock')] : [letter]);
      const head = h('div', {
        class: 'tl-headrow' + (on ? ' on' : '') + (trk.muted ? ' muted' : ''), style: 'height:' + lh + 'px',
        role: 'button', tabindex: '0', 'aria-label': (trk.name || '') + ' — ' + tr(trk.kind === 'clip' ? 'Klip parçası' : 'Otomasyon parçası'),
        onclick: () => { setSelection({ kind: 'track', trackId: trk.id }); openInspector(); },
      }, [
        // Parçanın rengi kullanıcının verisi (klip rengi gibi): satır içi
        h('span', { class: 'tl-headcol', style: col ? 'background:' + col : null }),
        icon(trk.kind === 'clip' ? 'clapper' : 'wave'),
        h('span', { class: 'tl-headname', text: trk.name || '' }),
        h('span', { class: 'tl-headstate', text: (recording.has(trk.id) ? '● ' : '') + (trk.muted ? 'M' : '') + (trk.solo ? 'S' : '') + (trk.locked ? '🔒' : '') }),
        refs.wide ? h('div', { class: 'tl-togs' }, [tog('M', 'muted', 'Sustur'), tog('S', 'solo', 'Solo'), tog('lock', 'locked', 'Kilitle')]) : null,
      ]);
      refs.headsList.appendChild(head);
    });
    refs.headsList.appendChild(h('button', { class: 'tl-headrow add', style: 'height:' + lh + 'px', 'aria-label': tr('Parça ekle'), onclick: () => S.choose(tr('Parça ekle'), [['clip', tr('Klip parçası')], ['automation', tr('Otomasyon parçası')]], '').then((v) => { if (v) { addTrack(v); if (v === 'automation') openInspector(); } }) }, [icon('plus'), h('span', { class: 'tl-headname', text: tr('Parça') })]));
    syncHeads();
  }
  function syncHeads() { if (ui.refs && ui.lane) ui.refs.headsList.style.transform = 'translateY(' + -ui.lane.scrollY() + 'px)'; }

  function paintToolbar() {
    const refs = ui.refs;
    if (!refs) return;
    const bar = refs.toolbar;
    bar.textContent = '';
    const tl = model();
    const add = (...xs) => xs.forEach((x) => x && bar.appendChild(x));
    const snapLabel = tr((SNAP_PAIRS.find((p) => p[0] === (tlCfg().snap || 'bar')) || SNAP_PAIRS[1])[1]);
    const picked = pickedClips();
    if (multi.length > 1) {
      add(h('span', { class: 'tl-count', text: multi.length + ' ' + tr('klip seçili') }),
        chip('sliders', 'Düzenle', openInspector),
        chip('copy', 'Çoğalt', () => duplicateSelection()),
        chip('copy', 'Kopyala', () => copySelection()),
        chip('scissors', 'Kes', () => cutSelection()),
        chip('arrow-up', 'Üst parça', () => moveSelectionTrack(-1)),
        chip('arrow-down', 'Alt parça', () => moveSelectionTrack(1)),
        chip('chevron-left', 'Geri', () => nudge(-1)),
        chip('chevron-right', 'İleri', () => nudge(1)),
        chip('trash', 'Sil', () => deleteSelection(), { danger: true }),
        chip('x', 'Seçimi bırak', () => { multi = []; setPickMode(false); }));
      return;
    }
    const c = selClip();
    if (c) {
      const locked = selTrack() && selTrack().locked;
      add(chip('sliders', 'Düzenle', openInspector, { primary: true }),
        chip('cut', 'Böl', () => splitAtPlayhead(), { disabled: locked }),
        chip('copy', 'Çoğalt', () => duplicateSelection(), { disabled: locked }),
        chip('copy', 'Kopyala', () => copySelection()),
        chip('scissors', 'Kes', () => cutSelection(), { disabled: locked }),
        chip('arrow-up', 'Üst parça', () => moveSelectionTrack(-1), { disabled: locked }),
        chip('arrow-down', 'Alt parça', () => moveSelectionTrack(1), { disabled: locked }),
        chip('chevron-left', 'Geri', () => nudge(-1), { disabled: locked }),
        chip('chevron-right', 'İleri', () => nudge(1), { disabled: locked }),
        chip('trash', 'Sil', () => deleteSelection(), { danger: true, disabled: locked }),
        chip('grid', 'Çoklu seç', () => setPickMode(!pickMode), { on: pickMode }));
      return;
    }
    if (selection && selection.kind === 'key') {
      add(chip('sliders', 'Düzenle', openInspector, { primary: true }), chip('trash', 'Noktayı sil', () => deleteSelection(), { danger: true }), chip('x', 'Bırak', () => setSelection(null)));
      return;
    }
    if (selection && selection.kind === 'marker') {
      const m = selMarker();
      add(chip('sliders', 'Düzenle', openInspector, { primary: true }),
        m ? chip('play', 'Git', () => seek(m.t)) : null,
        m ? chip('pause', 'Cue: burada bekle', () => { m.hold = !m.hold; if (!m.hold) delete m.hold; commit(); }, { on: !!(m && m.hold) }) : null,
        chip('trash', 'Sil', () => deleteSelection(), { danger: true }), chip('x', 'Bırak', () => setSelection(null)));
      return;
    }
    if (selection && selection.kind === 'tempo') {
      add(chip('sliders', 'Düzenle', openInspector, { primary: true }), chip('play', 'Git', () => seek(TE().tempoList(tl.tempo)[selection.index].t)),
        chip('trash', 'Sil', () => deleteSelection(), { danger: true, disabled: !(selection.index > 0) }), chip('x', 'Bırak', () => setSelection(null)));
      return;
    }
    // Seçim yok ya da parça seçili
    add(chip('plus', 'Klip', () => addClipFlow(selTrack() && selTrack().kind === 'clip' ? selTrack() : null, null), { primary: true }),
      chip('plus', 'Ekle', addMenu),
      clipboard ? chip('paste', 'Yapıştır', () => pasteAtPlayhead()) : null,
      chip('pin', 'İşaret', () => addMarkerAtPlayhead()),
      chip('prev', 'Önceki işaret', () => jumpMarker(-1)),
      chip('next', 'Sonraki işaret', () => jumpMarker(1)),
      chip('metronome', '♩ Tempo', () => addTempoAtHead()),
      chip('loop', 'Döngü', () => toggleLoop(), { on: tl.loop.enabled && tl.loop.end > tl.loop.start }),
      chip('magnet', snapLabel, snapMenu),
      chip('grid', 'Çoklu seç', () => setPickMode(!pickMode), { on: pickMode }),
      chip('fit', 'Hepsini sığdır', () => ui.lane && ui.lane.fit()),
      chip('minus', 'Uzaklaştır', () => ui.lane && ui.lane.setZoom(ui.lane.zoom() / 1.4)),
      chip('plus', 'Yakınlaştır', () => ui.lane && ui.lane.setZoom(ui.lane.zoom() * 1.4)),
      selTrack() ? chip('sliders', 'Parça', openInspector) : null);
  }
  function paintSide() {
    const refs = ui.refs;
    if (!refs) return;
    refs.side.textContent = '';
    if (!refs.wide) return;
    FORMS().render(refs.side, core, 'selection', { inline: true });
  }

  // Şeridin çekirdekle konuştuğu yüzey (src/mobile/shell-timeline-lane.js)
  const laneApi = {
    tr,
    model,
    length,
    laneH,
    head: () => headTime(),
    rulerMode: () => tlCfg().ruler || 'both',
    labelOf: clipLabel,
    typeLabel,
    pickMode: () => pickMode,
    selClipId: () => (selection && selection.kind === 'clip' ? selection.clipId : ''),
    selTrackId: () => (selection ? selection.trackId || '' : ''),
    selKey: () => (selection && selection.kind === 'key' ? selection : null),
    selMarkerId: () => (selection && selection.kind === 'marker' ? selection.markerId : ''),
    selTempo: () => (selection && selection.kind === 'tempo' ? selection.index : -1),
    isTrackSelected: (trk) => !!(selection && selection.kind === 'track' && selection.trackId === trk.id),
    isSelectedClip: (trk, c) => !!(selection && selection.kind === 'clip' && selection.clipId === c.id && selection.trackId === trk.id),
    isSelectedKey: (trk, ki) => !!(selection && selection.kind === 'key' && selection.trackId === trk.id && selection.keyIndex === ki),
    isPicked: (c) => multi.some((m) => m.clipId === c.id),
    pickedClips,
    selectClip: (trk, c, quiet) => { selection = { kind: 'clip', trackId: trk.id, clipId: c.id }; if (!multi.some((m) => m.clipId === c.id)) multi = []; if (!quiet) ui.selection(); },
    selectKey: (trk, ki) => setSelection({ kind: 'key', trackId: trk.id, keyIndex: ki }),
    selectMarker: (m) => setSelection({ kind: 'marker', markerId: m.id }),
    selectTempo: (i) => setSelection({ kind: 'tempo', index: i }),
    keyMoved: (trk, ki) => { selection = { kind: 'key', trackId: trk.id, keyIndex: ki }; },
    clearSelection: (trk) => setSelection(trk ? { kind: 'track', trackId: trk.id } : null),
    toggleMulti,
    pickRect: (found) => { const refs = multi.slice(); for (const f of found) if (!refs.some((r) => r.clipId === f.clipId)) refs.push(f); if (refs.length) setMulti(refs); },
    inspect: openInspector,
    menu: contextMenu,
    addKey,
    addClipAt: (trk, t) => addClipFlow(trk, t),
    snap,
    snapMove,
    snapFree,
    setTempoList,
    scrub: (t, done) => { if (done) seek(t); else { syncTransportFromAnchor(); ensureTransport().seek(t); reanchor(); paintClock(); } },
    changed: () => commit(),
    zoomed: () => {},
    painted: syncHeads,
  };

  // Formların (src/mobile/shell-timeline-forms.js) kullandığı çekirdek
  const core = {
    tr, en, fmt, cfg, tlCfg, model, commit, writeTl, invalidate, history,
    selection: () => selection, setSelection, selTrack, selClip, selMarker, pickedClips, multi: () => multi.slice(),
    trackById, trackIndex, headTime, seek, snap, applyTempo, tempoAtHead, addTempoAtHead, setLoopEdge, toggleLoop,
    deleteSelection, duplicateSelection, splitAtPlayhead, copySelection, moveSelectionTrack, addKey,
    clipLabel, clipSourceLabel, typeLabel, TYPE_LABELS, TYPE_ICONS, actionOptions, SNAP_PAIRS,
    modeOn, linkOutput, unlinkOutput, refresh: () => ui.changed(true), redraw: () => { ui.heads(); ui.toolbar(); if (ui.lane) ui.lane.draw(); },
    laneH, lane: () => ui.lane, wide: () => !!(ui.refs && ui.refs.wide), openInspector,
    clearSelection: () => setSelection(null), multiClear: () => { multi = []; setPickMode(false); },
    toggleRecord, startLearn, stopLearn,
    isRecording: (trk) => recording.has(trk.id), isLearning: (trk) => !!(learning && learning.id === trk.id),
  };

  /* Eylem kliplerinin telefondaki karşılıkları. Masaüstünde Timeline kullan açıkken oynatma
     kafası eylem klibine girince bir kez çalışır (fireActionsAt); burada da aynı kural. */
  let lastActionT = null;
  const lastAction = new Map();
  function runAction(ref) {
    const L = window.SVLayers;
    const MC = window.SVModeCatalog;
    const c = clone(cfg());
    const cycle = (kind, d) => {
      const list = MC && MC.cycleIds ? MC.cycleIds(kind) : [];
      if (!list.length || !L || !L.currentType) return;
      const cur = L.currentType(c, kind);
      const next = list[(list.indexOf(cur) + d + list.length) % list.length];
      if (kind === 'visualizer') L.adoptVisualizer(c, { type: next });
      else L.adoptBackground(c, { type: next });
      A().config.patch({ layers: c.layers, visualizer: c.visualizer, background: c.background });
    };
    switch (ref) {
      case 'blackout': A().config.patch({ isBlackout: !cfg().isBlackout }); break;
      case 'nextScene': {
        const list = (cfg().scenes || []).filter(Boolean);
        if (!list.length) break;
        runAction.scene = ((runAction.scene || 0) + 1) % list.length;
        S.recallScene(list[runAction.scene].id);
        break;
      }
      case 'nextVisualizer': cycle('visualizer', 1); break;
      case 'prevVisualizer': cycle('visualizer', -1); break;
      case 'nextBackground': cycle('background', 1); break;
      case 'nextPalette': {
        const list = ((window.SV && window.SV.GRADIENT_PRESETS) || []).concat(cfg().userPresets || []);
        if (!list.length) break;
        runAction.pal = ((runAction.pal || 0) + 1) % list.length;
        const bg = Object.assign({}, c.background, { gradient: Object.assign({}, c.background && c.background.gradient, { colors: list[runAction.pal].colors.slice() }) });
        A().config.patch({ background: bg });
        break;
      }
      case 'tlPause': pause(); break;
      case 'tlStop': stop(); break;
      case 'tlNextMarker': jumpMarker(1); break;
      case 'tlPrevMarker': jumpMarker(-1); break;
      default: break;
    }
  }
  setInterval(() => {
    if (!transport || !modeOn()) { lastActionT = null; return; }
    const t = syncTransportFromAnchor();
    const jumped = lastActionT == null || t.time < lastActionT - 1e-3 || t.time - lastActionT > 0.25;
    lastActionT = t.time;
    const next = new Map();
    for (const e of TL().activeClipsAt(t.tl, t.time)) {
      if (e.clip.type !== 'action') continue;
      next.set(e.track.id, e.clip.id);
      if (!t.playing || jumped) continue;
      if (lastAction.get(e.track.id) === e.clip.id) continue;
      runAction(e.clip.ref);
    }
    lastAction.clear();
    next.forEach((v, k) => lastAction.set(k, v));
  }, 50);

  if (A() && A().player && A().player.onState) A().player.onState(onPlayer);
  // Otomasyon öğrenme: uygulamadaki ayar değişimleri
  if (window.api && window.api.onConfigPatch) window.api.onConfigPatch(onConfigPatch);
  // Tema değişince tuval yeni renklerle
  if (window.SVUiTheme && window.SVUiTheme.onChange) window.SVUiTheme.onChange(() => { if (ui.lane) ui.lane.themeChanged(); });

  /* Dışa aktarma: etkin çizelge ve içindeki klip sayısı (bütün klip parçaları). */
  function info() {
    const c = tlCfg();
    const tl = TL().makeTimeline(c);
    let clips = 0;
    for (const t of tl.tracks) if (t.kind === 'clip') clips += t.clips.length;
    return { id: c.id || '', clips, enabled: c.itemEnabled !== false, name: c.name || '' };
  }

  window.SVShellTimeline = Object.freeze({
    page,
    info,
    modeOn,
    unlinkOutput,
    /** Probe ve sınama */
    _state: () => { const t = syncTransportFromAnchor(); return { head: t.time, playing: t.playing, sel: selection, multi: multi.slice(), pick: pickMode, mode: modeOn(), anchor, wide: !!(ui.refs && ui.refs.wide) }; },
    _seek: (t) => seek(t),
    _layout: () => (ui.lane ? ui.lane.layout() : null),
    _core: core,
  });
})();
