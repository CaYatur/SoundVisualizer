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

  // Geçmişe giren kısım: tempo ayrı bir ayar, geri almaya girmiyor
  function snapshot(tlCfg) {
    const c = tlCfg || {};
    return JSON.stringify({ tracks: c.tracks || [], markers: c.markers || [], loop: c.loop || null });
  }

  function restore(tlCfg, snap) {
    const s = JSON.parse(snap);
    tlCfg.tracks = s.tracks;
    tlCfg.markers = s.markers;
    if (s.loop) tlCfg.loop = s.loop;
    return tlCfg;
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
    return TYPE_COLORS[clip && clip.type] || TYPE_COLORS.scene;
  }

  const api = {
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
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVTimelineEdit = api;
})();
