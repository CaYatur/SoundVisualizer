/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Zaman çizelgesi DÜZENLEME İŞLEMLERİ (#636) — saf veri, saf aritmetik.
 *
 * Panel tuvali çiziyor ve fareyi dinliyor; bir klibi bölmek, çoğaltmak,
 * kaydırmak ya da geri almak burada. Ayrı olmalarının sebebi test: bu
 * işlemler DOM olmadan, tek tek sınanabiliyor ve bir gösteriyi bozan hata
 * çoğunlukla tam buralarda (kimlik çakışması, sıfır süreli parça, eski bir
 * anlık görüntünün yeni işin üstüne yazılması).
 */
(function () {
  function num(v, fallback) {
    v = Number(v);
    return isFinite(v) ? v : fallback;
  }

  function TL() {
    if (typeof window !== 'undefined' && window.SVTimeline) return window.SVTimeline;
    try {
      return require('./timeline.js');
    } catch (e) {
      return null;
    }
  }

  // ==========================================================================
  // Geri al / yinele
  //
  // Anlık görüntü bir METİN (parçalar, işaretler, döngü). Metin karşılaştırması
  // iki şeyi birden sağlıyor: aynı görüntü iki kez yığına girmiyor ve
  // yapılandırma DIŞARIDAN değiştiyse (sahne uygulandı, ayar dosyası yüklendi,
  // deste kaydı parça ekledi) `sync` bunu görüp geçmişi yeni bir tabanla
  // başlatıyor. Başlatmasaydı Ctrl+Z eski bir gösteriyi yeni işin üstüne
  // yapıştırırdı.
  // ==========================================================================
  function History(limit) {
    this.limit = Math.max(2, num(limit, 100) | 0);
    this.stack = [];
    this.idx = -1;
  }
  History.prototype.reset = function (snap) {
    this.stack = [snap];
    this.idx = 0;
  };
  History.prototype.current = function () {
    return this.idx >= 0 ? this.stack[this.idx] : null;
  };
  // Yapılandırma geçmişin başındakinden farklıysa yeni taban
  History.prototype.sync = function (snap) {
    if (this.idx < 0 || this.stack[this.idx] !== snap) this.reset(snap);
  };
  History.prototype.push = function (snap) {
    if (this.idx >= 0 && this.stack[this.idx] === snap) return false;
    this.stack = this.stack.slice(0, this.idx + 1);
    this.stack.push(snap);
    if (this.stack.length > this.limit) this.stack.splice(0, this.stack.length - this.limit);
    this.idx = this.stack.length - 1;
    return true;
  };
  History.prototype.canUndo = function () {
    return this.idx > 0;
  };
  History.prototype.canRedo = function () {
    return this.idx >= 0 && this.idx < this.stack.length - 1;
  };
  History.prototype.undo = function () {
    if (!this.canUndo()) return null;
    this.idx--;
    return this.stack[this.idx];
  };
  History.prototype.redo = function () {
    if (!this.canRedo()) return null;
    this.idx++;
    return this.stack[this.idx];
  };

  /* Geçmişe giren kısım. Tempo da giriyor: cetvelde düzenlendiği için
     düzenlemenin bir parçası (bir DAW'da da tempo değişimi geri alınıyor).
     Önce "ayrı bir ayar" diye girmiyordu; o zaman yalnız tek bir BPM vardı.
     Her tempo düzenlemesi de bu yüzden commit() üzerinden geçiyor: yoksa
     sonraki bir klip adımını geri almak BPM'i de sessizce geri alırdı. */
  function snapshot(tlCfg) {
    const c = tlCfg || {};
    return JSON.stringify({ tracks: c.tracks || [], markers: c.markers || [], loop: c.loop || null,
      tempo: Array.isArray(c.tempo) ? c.tempo : null });
  }

  function restore(tlCfg, snap) {
    const s = JSON.parse(snap);
    tlCfg.tracks = s.tracks;
    tlCfg.markers = s.markers;
    if (s.loop) tlCfg.loop = s.loop;
    if (Array.isArray(s.tempo)) tlCfg.tempo = s.tempo;
    return tlCfg;
  }

  // ==========================================================================
  // Tempo değişimleri (#636)
  //
  // Yapılandırmanın tempo listesi: [{ t, bpm, beatsPerBar }], sıralı, ilki
  // 0'da. Model (SVTimeline.makeTempoMap) birikimli vuruşları bu listeden
  // hesaplıyor; burada yalnız düz liste düzenleniyor. Hepsi YENİ bir liste
  // döndürüyor. İlk giriş hiç silinmiyor ve taşınmıyor: parçanın başındaki
  // tempo o.
  // ==========================================================================
  const TEMPO_GAP = 0.05; // iki tempo değişimi arasındaki en kısa süre (sn)

  function tempoList(map) {
    const src = Array.isArray(map) && map.length ? map : [{ t: 0, bpm: 120, beatsPerBar: 4 }];
    const out = src.map((e) => ({
      t: Math.max(0, Number(e.t) || 0),
      bpm: Math.max(1, Math.min(999, Number(e.bpm) || 120)),
      beatsPerBar: Math.max(1, Math.min(16, Math.round(Number(e.beatsPerBar) || 4))),
    })).sort((a, b) => a.t - b.t);
    out[0].t = 0;
    return out;
  }

  // t anında geçerli olan tempo girişinin sırası
  function tempoIndexAt(list, t) {
    let i = 0;
    for (let k = 1; k < list.length; k++) {
      if (list[k].t <= t + 1e-9) i = k;
      else break;
    }
    return i;
  }

  /* t'ye bir tempo değişimi. BPM verilmezse o andaki tempo (değişim çizgisi
     yerinde, sonra düzenlenir). Aynı yerde zaten varsa yenisi eklenmiyor. */
  function addTempoChange(map, t, bpm) {
    const list = tempoList(map);
    t = Math.max(0, Number(t) || 0);
    const at = tempoIndexAt(list, t);
    if (Math.abs(list[at].t - t) < TEMPO_GAP) return { list, index: at };
    const cur = list[at];
    const e = { t, bpm: bpm == null ? cur.bpm : Math.max(1, Math.min(999, Number(bpm) || cur.bpm)), beatsPerBar: cur.beatsPerBar };
    list.splice(at + 1, 0, e);
    return { list, index: at + 1 };
  }

  // Komşularının arasında kalacak şekilde taşı; ilk giriş yerinde
  function moveTempoChange(map, i, t) {
    const list = tempoList(map);
    if (!(i > 0 && i < list.length)) return list;
    const lo = list[i - 1].t + TEMPO_GAP;
    const hi = i + 1 < list.length ? list[i + 1].t - TEMPO_GAP : Infinity;
    list[i].t = Math.max(lo, Math.min(hi, Number(t) || 0));
    return list;
  }

  function removeTempoChange(map, i) {
    const list = tempoList(map);
    if (i > 0 && i < list.length) list.splice(i, 1);
    return list;
  }

  function setTempo(map, i, patch) {
    const list = tempoList(map);
    const e = list[i];
    if (!e) return list;
    if (patch && patch.bpm != null) e.bpm = Math.max(1, Math.min(999, Number(patch.bpm) || e.bpm));
    if (patch && patch.beatsPerBar != null) e.beatsPerBar = Math.max(1, Math.min(16, Math.round(Number(patch.beatsPerBar) || e.beatsPerBar)));
    return list;
  }

  // ==========================================================================
  // Klip işlemleri
  // ==========================================================================
  const MIN_DUR = 0.05;

  /* Klibi `t` anında ikiye böl. Sol parça yerinde kısalıyor, sağ parça yeni
     kimlikle dönüyor. Sağ parçanın kırpma başı ilerliyor: bir video klibi
     bölününce ikinci yarı kaldığı yerden sürmeli, baştan başlamamalı.
     Parçalardan biri en kısa süreden kısa kalacaksa bölünmüyor (null). */
  function splitClip(clip, t) {
    if (!clip) return null;
    t = num(t, NaN);
    const end = clip.start + clip.dur;
    if (!(t > clip.start + MIN_DUR - 1e-9) || !(t < end - MIN_DUR + 1e-9)) return null;
    const leftDur = t - clip.start;
    const right = TL().makeClip(Object.assign({}, clip, {
      id: undefined,
      start: t,
      dur: end - t,
      inPoint: num(clip.inPoint, 0) + leftDur * (num(clip.speed, 1) || 1),
    }));
    if (clip.color) right.color = clip.color;
    clip.dur = leftDur;
    return right;
  }

  /* Çoğalt: kopya aslının hemen ardına (Ableton'daki gibi). Kopya yeni
     kimlik alıyor; aynı kimlik iki klipte olsaydı seçim ve "son uygulanan
     klip" kaydı ikisini ayıramazdı. */
  function duplicateClip(clip) {
    const copy = TL().makeClip(Object.assign({}, clip, { id: undefined, start: clip.start + clip.dur }));
    if (clip.color) copy.color = clip.color;
    return copy;
  }

  // Panodan yapıştırma: verilen başlangıçta, yeni kimlikle
  function pasteClip(clip, at) {
    const copy = TL().makeClip(Object.assign({}, clip, { id: undefined, start: Math.max(0, num(at, 0)) }));
    if (clip.color) copy.color = clip.color;
    return copy;
  }

  function sortClips(track) {
    if (track && Array.isArray(track.clips)) track.clips.sort((a, b) => a.start - b.start);
    return track;
  }

  // ==========================================================================
  // Çoklu seçim (#636 TL-2)
  //
  // Seçim kimliklerle tutuluyor ({ trackId, clipId }); model her çizimde
  // yeniden kurulduğu için nesne tutmak bir sonraki çizimde bayatlardı.
  // ==========================================================================

  // Kutu seçimi: [t0, t1] aralığına değen, [i0, i1] şeritlerindeki klipler
  function clipsInRect(tl, t0, t1, i0, i1) {
    const a = Math.min(num(t0, 0), num(t1, 0));
    const b = Math.max(num(t0, 0), num(t1, 0));
    const lo = Math.max(0, Math.min(i0, i1));
    const hi = Math.max(i0, i1);
    const out = [];
    ((tl && tl.tracks) || []).forEach((trk, i) => {
      if (i < lo || i > hi || trk.kind !== 'clip') return;
      for (const c of trk.clips || []) {
        if (c.start < b && c.start + c.dur > a) out.push({ trackId: trk.id, clipId: c.id });
      }
    });
    return out;
  }

  /* Grup taşımada ortak kayma: hiçbir klip sıfırın soluna geçmesin. Tek
     tek sınırlamak grubun biçimini bozardı (baştaki klip dururken
     arkadakiler ona yığılırdı). */
  function groupDelta(starts, delta) {
    if (!starts.length) return 0;
    return Math.max(num(delta, 0), -Math.min.apply(null, starts));
  }

  /* Kopyalama: her klip grubun başına ve ilk şeridine göre konumuyla.
     `picked`: [{ trackIndex, clip }]. */
  function copyGroup(picked) {
    if (!picked || !picked.length) return null;
    const base = Math.min.apply(null, picked.map((p) => p.trackIndex));
    const t0 = Math.min.apply(null, picked.map((p) => p.clip.start));
    const t1 = Math.max.apply(null, picked.map((p) => p.clip.start + p.clip.dur));
    return {
      span: t1 - t0,
      items: picked.map((p) => ({ dTrack: p.trackIndex - base, dStart: p.clip.start - t0, clip: JSON.parse(JSON.stringify(p.clip)) })),
    };
  }

  /* Yapıştırma: grup `at` anına ve `baseIndex` şeridine. Göreli şerit bir
     klip parçası değilse (ya da yoksa) klip taban şeride düşüyor; kaybolmuyor.
     Dönen: [{ trackIndex, clip }] — yeni kimliklerle. */
  function pasteGroup(tl, board, at, baseIndex) {
    if (!board || !board.items) return [];
    const tracks = (tl && tl.tracks) || [];
    const okTrack = (i) => tracks[i] && tracks[i].kind === 'clip' && !tracks[i].locked;
    return board.items.map((it) => {
      const want = baseIndex + it.dTrack;
      return { trackIndex: okTrack(want) ? want : baseIndex, clip: pasteClip(it.clip, Math.max(0, num(at, 0)) + it.dStart) };
    });
  }

  // Grubu çoğalt: kopyalar grubun hemen ardına, aynı şeritlere
  function duplicateGroup(tl, picked) {
    const board = copyGroup(picked);
    if (!board) return [];
    const base = Math.min.apply(null, picked.map((p) => p.trackIndex));
    const t0 = Math.min.apply(null, picked.map((p) => p.clip.start));
    return pasteGroup(tl, board, t0 + board.span, base);
  }

  /* Izgaranın bir adımı (saniye): kaydırma okları bu kadar taşıyor.
     Yakalama kapalıyken 0,1 sn; "kare" kipinde bir kare. Adım o andaki
     tempodan: tempo haritası değişiyorsa ölçü uzunluğu da değişir. */
  function gridStep(tempo, mode, fps, at) {
    const T = TL();
    if (mode === 'frame') return 1 / Math.max(1, num(fps, 60));
    if (mode === 'off' || !T) return 0.1;
    const beat = { beat: 1, half: 0.5, quarter: 0.25 }[mode];
    const t = Math.max(0, num(at, 0));
    const b0 = T.secondsToBeats(tempo, t);
    if (beat) return Math.max(1e-3, T.beatsToSeconds(tempo, b0 + beat) - t);
    // Ölçü: o andaki segmentin ölçü uzunluğu
    const bpb = Math.max(1, num(T.secondsToBars(tempo, t).beatsPerBar, 4));
    return Math.max(1e-3, T.beatsToSeconds(tempo, b0 + bpb) - t);
  }

  /* Hepsini sığdır: çizelgenin tamamı görünür genişliğe, sağda biraz pay.
     Boş ya da çok kısa çizelge 8 saniyelik bir görünüm alıyor; sıfıra
     bölünüp sonsuz yakınlaşma olmasın. */
  function fitView(length, width, minZoom, maxZoom) {
    const span = Math.max(8, num(length, 0) * 1.05);
    const w = Math.max(50, num(width, 800));
    const z = Math.max(num(minZoom, 4), Math.min(num(maxZoom, 400), w / span));
    return { zoom: z, scroll: 0 };
  }

  // ==========================================================================
  // Renkler
  // ==========================================================================
  /* Tür başına varsayılan renk: tuvalde türler renginden ayırt edilsin.
     Klibin kendi rengi, yoksa parçanın rengi, yoksa bu. */
  const SCENE_TINTS = ['#a8843f', '#4f79ad', '#b0524f', '#7560b5', '#3f9272', '#a15a7e', '#5a8f9e', '#8a7a4f'];
  const TYPE_COLORS = {
    scene: '#4f8cff',
    preset: '#a970ff',
    palette: '#ffb020',
    video: '#28c76f',
    image: '#20c9d6',
    shader: '#ff5ca8',
    action: '#9aa0aa',
  };
  function clipColor(clip, track) {
    const ok = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
    if (clip && ok(clip.color)) return clip.color;
    if (track && ok(track.color)) return track.color;
    /* Sahne klipleri birbirinden ayrılsın: aynı sahne hep aynı ton. */
    if (clip && clip.type === 'scene' && clip.ref) {
      let h = 0;
      for (const ch of String(clip.ref)) h = (h * 31 + ch.charCodeAt(0)) | 0;
      return SCENE_TINTS[Math.abs(h) % SCENE_TINTS.length];
    }
    return TYPE_COLORS[clip && clip.type] || TYPE_COLORS.scene;
  }


  // --------------------------------------------------------------------------
  // NLE düzenleme yardımcıları (#957): parçalar arası taşıma, mıknatıslı
  // yakalama, otomasyon hedef bilgisi ve kayıt
  // --------------------------------------------------------------------------

  /* Klibi başka bir parçaya taşı. Yalnız klip parçaları uyumlu; otomasyon
     parçası klip almaz. Kilitli hedef reddediliyor. Hedef sıra parça
     sayısına eşitse (son parçanın altı) yeni bir klip parçası açılıyor;
     `makeTrack` verilmediyse açılamaz. Dönen: taşındığı parça ya da null. */
  function moveClipToTrack(tl, clip, toIndex, makeTrack) {
    if (!tl || !Array.isArray(tl.tracks) || !clip) return null;
    const from = tl.tracks.find((t) => t.kind === 'clip' && Array.isArray(t.clips) && t.clips.indexOf(clip) >= 0);
    if (!from || from.locked) return null;
    let to = tl.tracks[toIndex];
    if (!to) {
      if (toIndex !== tl.tracks.length || typeof makeTrack !== 'function') return null;
      to = makeTrack();
      if (!to) return null;
      tl.tracks.push(to);
    }
    if (to.kind !== 'clip' || to.locked) return null;
    if (to === from) return from;
    from.clips.splice(from.clips.indexOf(clip), 1);
    to.clips.push(clip);
    sortClips(to);
    return to;
  }

  /* Komşu klip parçası: `dir` -1 yukarı, +1 aşağı; araya giren otomasyon
     ve kilitli parçalar atlanıyor. Yoksa -1. */
  function adjacentClipTrack(tl, index, dir) {
    if (!tl || !Array.isArray(tl.tracks)) return -1;
    for (let i = index + dir; i >= 0 && i < tl.tracks.length; i += dir) {
      const t = tl.tracks[i];
      if (t.kind === 'clip' && !t.locked) return i;
    }
    return -1;
  }

  /* Mıknatıslı yakalama: `t` bir adayın `tol` saniye yakınındaysa ona
     oturur. Adaylar klip kenarları, işaretler, oynatma kafası. En yakın
     aday kazanıyor; hiçbiri yakın değilse null. */
  function magnetSnap(t, candidates, tol) {
    let best = null;
    let bd = tol;
    for (const c of candidates || []) {
      if (!isFinite(c)) continue;
      const d = Math.abs(c - t);
      if (d <= bd) { bd = d; best = c; }
    }
    return best;
  }

  // Bir parça dışındaki kliplerin kenarları, işaretler ve kafa
  function snapCandidates(tl, playhead, skipClips) {
    const out = [];
    const skip = skipClips || [];
    for (const trk of (tl && tl.tracks) || []) {
      if (trk.kind !== 'clip') continue;
      for (const c of trk.clips) {
        if (skip.indexOf(c) >= 0) continue;
        out.push(c.start, c.start + c.dur);
      }
    }
    for (const m of (tl && tl.markers) || []) out.push(m.t);
    if (isFinite(playhead)) out.push(playhead);
    return out;
  }

  /* Otomasyon hedefinin okunur bilgisi: katalogdaki ad, grup ve aralık.
     Katalogda yoksa yolun son parçası ad; aralık mevcut değerden. */
  function targetInfo(catalog, path, current) {
    const cat = Array.isArray(catalog) ? catalog : [];
    const hit = cat.find((c) => c.path === path);
    let min;
    let max;
    if (hit && hit.min != null && hit.max != null) { min = hit.min; max = hit.max; }
    else {
      const v = typeof current === 'number' && isFinite(current) ? current : 1;
      if (v >= 0 && v <= 1) { min = 0; max = 1; }
      else { const span = Math.max(1, Math.abs(v) * 2); min = v - span; max = v + span; }
    }
    const last = String(path || '').split('.').pop();
    return { path, label: hit ? hit.label : last, group: hit ? hit.group : '', min, max, known: !!hit };
  }

  // Aramada eşleşen hedefler: ad, grup ya da yol, büyük/küçük harf ve Türkçe i duyarsız
  function filterTargets(catalog, q) {
    const norm = (s) => String(s || '').toLocaleLowerCase('tr');
    const words = norm(q).split(/\s+/).filter(Boolean);
    return (catalog || []).filter((c) => {
      const hay = norm(c.group + ' ' + c.label + ' ' + c.path);
      return words.every((w) => hay.indexOf(w) >= 0);
    });
  }

  /* Kayıt: gerçek değeri 0..1'e çevirip anahtara yaz. Son anahtara `gap`
     saniyeden yakınsa onu güncelliyor; nokta yağmuru olmuyor. */
  function recordKey(trk, t, value, gap) {
    if (!trk || !Array.isArray(trk.keys)) return null;
    const span = trk.max - trk.min;
    const v = span ? Math.max(0, Math.min(1, (value - trk.min) / span)) : 0;
    const g = gap == null ? 0.1 : gap;
    const near = trk.keys.find((k) => Math.abs(k.t - t) < g);
    if (near) { near.v = v; return near; }
    const k = { t: Math.max(0, t), v, curve: 'linear' };
    trk.keys.push(k);
    trk.keys.sort((a, b) => a.t - b.t);
    return k;
  }

  // Birden çok şerit aynı hedefi sürüyorsa: sonuncusu kazanır, diğerleri uyarı alır
  function duplicateTargets(tl) {
    const seen = {};
    const dup = new Set();
    for (const t of (tl && tl.tracks) || []) {
      if (t.kind !== 'automation' || !t.target) continue;
      if (seen[t.target]) { dup.add(seen[t.target]); dup.add(t.id); }
      seen[t.target] = t.id;
    }
    return dup;
  }

  const api = {
    moveClipToTrack,
    adjacentClipTrack,
    magnetSnap,
    snapCandidates,
    targetInfo,
    filterTargets,
    recordKey,
    duplicateTargets,
    History,
    snapshot,
    restore,
    MIN_DUR,
    splitClip,
    duplicateClip,
    pasteClip,
    sortClips,
    clipsInRect,
    groupDelta,
    copyGroup,
    pasteGroup,
    duplicateGroup,
    gridStep,
    fitView,
    TYPE_COLORS,
    clipColor,
    TEMPO_GAP,
    tempoList,
    tempoIndexAt,
    addTempoChange,
    moveTempoChange,
    removeTempoChange,
    setTempo,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVTimelineEdit = api;
})();
