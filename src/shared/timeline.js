/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Zaman çizelgesi — saf veri ve saf aritmetik.
 *
 * Burada DOM yok, çizim yok, zamanlayıcı yok. Sebebi tek: bu dosya
 * `npm test` içinde Node altında GPU'suz koşabilsin. Çizim tarafı değerleri
 * yalnızca okur.
 *
 * ZAMANIN TEK KAYNAĞI SANİYEDİR.
 * Bir klibin yeri hem saniye hem ölçü olarak SAKLANSAYDI ikisi er ya da geç
 * birbirini tutmazdı; tempo değişince hangisinin doğru olduğu belirsizleşirdi.
 * Bu yüzden saniye saklanır, ölçü/vuruş tempo haritasından TÜRETİLİR. Görüntü
 * birimini değiştirmek hiçbir veriyi yeniden yazmaz.
 *
 * Müzikal malzemeyi tempo değişiminde yerinde tutmak isteyen kullanıcı için
 * ayrı bir işlem var: `retimeToTempo()`. Bu açık bir dönüşümdür, sessiz bir
 * yan etki değil.
 */
(function () {
  const TL_EPS = 1e-9;

  function clamp(v, lo, hi) {
    v = Number(v);
    if (!isFinite(v)) return lo;
    return v < lo ? lo : v > hi ? hi : v;
  }

  function num(v, fallback) {
    v = Number(v);
    return isFinite(v) ? v : fallback;
  }

  let idCounter = 0;
  /* Kimlikler deterministik: aynı sırayla üretilen çizelge iki koşuda aynı
     kimlikleri alır, böylece çevrimdışı dışa aktarım tekrarlanabilir kalır. */
  function newId(prefix) {
    idCounter += 1;
    return (prefix || 'id') + '_' + idCounter;
  }
  function resetIds(n) {
    idCounter = num(n, 0);
  }

  // ==========================================================================
  // Tempo haritası
  //
  // Bir liste: [{ t: saniye, bpm, beatsPerBar }]. İlk giriş her zaman t=0'da
  // başlar. Segmentler arası dönüşüm birikimlidir; tek bir sabit BPM ile
  // çarpmak tempo değişiminden sonraki her şeyi kaydırırdı.
  // ==========================================================================
  function makeTempoMap(entries) {
    let list = Array.isArray(entries) ? entries.slice() : [];
    list = list
      .map((e) => ({
        t: Math.max(0, num(e && e.t, 0)),
        bpm: clamp(e && e.bpm, 1, 999),
        beatsPerBar: Math.max(1, Math.round(num(e && e.beatsPerBar, 4))),
      }))
      .sort((a, b) => a.t - b.t);

    // Aynı ana iki tempo düşerse sonuncusu geçerlidir
    const out = [];
    for (const e of list) {
      if (out.length && Math.abs(out[out.length - 1].t - e.t) < TL_EPS) out[out.length - 1] = e;
      else out.push(e);
    }
    if (!out.length || out[0].t > TL_EPS) {
      out.unshift({ t: 0, bpm: out.length ? out[0].bpm : 120, beatsPerBar: out.length ? out[0].beatsPerBar : 4 });
    }
    out[0].t = 0;

    // Her segmentin başlangıcındaki birikimli vuruş sayısını önceden hesapla
    let beats = 0;
    for (let i = 0; i < out.length; i++) {
      out[i].beat0 = beats;
      if (i + 1 < out.length) beats += ((out[i + 1].t - out[i].t) * out[i].bpm) / 60;
    }
    return out;
  }

  function segmentAtTime(map, sec) {
    let i = 0;
    for (let k = 1; k < map.length; k++) {
      if (map[k].t <= sec + TL_EPS) i = k;
      else break;
    }
    return map[i];
  }

  function segmentAtBeat(map, beat) {
    let i = 0;
    for (let k = 1; k < map.length; k++) {
      if (map[k].beat0 <= beat + TL_EPS) i = k;
      else break;
    }
    return map[i];
  }

  function secondsToBeats(map, sec) {
    sec = num(sec, 0);
    const s = segmentAtTime(map, sec);
    return s.beat0 + ((sec - s.t) * s.bpm) / 60;
  }

  function beatsToSeconds(map, beat) {
    beat = num(beat, 0);
    const s = segmentAtBeat(map, beat);
    return s.t + ((beat - s.beat0) * 60) / s.bpm;
  }

  /* Ölçü/vuruş okunuşu. bar ve beat 1 tabanlıdır (müzisyenler böyle sayar),
     tick ise vuruşun 0..1 arası kesridir. */
  function secondsToBars(map, sec) {
    const beat = secondsToBeats(map, sec);
    const s = segmentAtBeat(map, beat);
    const rel = beat - s.beat0;
    const bar = Math.floor(rel / s.beatsPerBar);
    const inBar = rel - bar * s.beatsPerBar;
    const barBase = barsBeforeSegment(map, s);
    return {
      bar: barBase + bar + 1,
      beat: Math.floor(inBar) + 1,
      tick: inBar - Math.floor(inBar),
      beatsPerBar: s.beatsPerBar,
    };
  }

  function barsBeforeSegment(map, seg) {
    let bars = 0;
    for (const s of map) {
      if (s === seg) break;
      const next = map[map.indexOf(s) + 1];
      const beats = (next ? next.beat0 : s.beat0) - s.beat0;
      bars += beats / s.beatsPerBar;
    }
    return Math.round(bars * 1e6) / 1e6;
  }

  function barsToSeconds(map, bar, beat) {
    const targetBar = Math.max(0, num(bar, 1) - 1);
    const targetBeat = Math.max(0, num(beat, 1) - 1);
    let bars = 0;
    let seg = map[0];
    for (let i = 0; i < map.length; i++) {
      const s = map[i];
      const next = map[i + 1];
      const segBars = next ? (next.beat0 - s.beat0) / s.beatsPerBar : Infinity;
      if (targetBar < bars + segBars - TL_EPS || !next) {
        seg = s;
        break;
      }
      bars += segBars;
    }
    const beatsIn = (targetBar - bars) * seg.beatsPerBar + targetBeat;
    return beatsToSeconds(map, seg.beat0 + beatsIn);
  }

  // ==========================================================================
  // Yakalama (snap)
  // ==========================================================================
  const SNAP_MODES = ['off', 'bar', 'beat', 'half', 'quarter', '1s', '0.5s', 'frame'];

  /* Bir saniye değerini en yakın ızgara çizgisine oturt. `frame` kipi kare
     süresine yuvarlar; diğerleri tempo haritasını kullanır. */
  function snapSeconds(map, sec, mode, fps) {
    sec = num(sec, 0);
    if (!mode || mode === 'off') return sec;
    /* Sabit saniye adımları tempodan bağımsız: ölçü varsayılanı 2 sn
       (120 BPM 4/4) olduğu için 1 sn / 0,5 sn burada ayrıca sunulur. */
    if (mode === '1s') return Math.max(0, Math.round(sec));
    if (mode === '0.5s') return Math.max(0, Math.round(sec * 2) / 2);
    if (mode === 'frame') {
      const f = Math.max(1, num(fps, 60));
      return Math.round(sec * f) / f;
    }
    const beat = secondsToBeats(map, sec);
    const seg = segmentAtBeat(map, beat);
    let div;
    if (mode === 'bar') div = seg.beatsPerBar;
    else if (mode === 'beat') div = 1;
    else if (mode === 'half') div = 0.5;
    else if (mode === 'quarter') div = 0.25;
    else return sec;
    return beatsToSeconds(map, Math.round(beat / div) * div);
  }

  // ==========================================================================
  // Otomasyon eğrisi
  //
  // Anahtar kareler zamana göre sıralı tutulur. Değerlendirme YALNIZCA t'ye
  // bağlıdır: oynatma kafasının oraya nasıl geldiği (ileri, geri, atlayarak)
  // sonucu değiştirmez. Çevrimdışı dışa aktarımın kare-kare aynı çıkması buna
  // dayanır.
  // ==========================================================================
  function sortKeys(keys) {
    return (Array.isArray(keys) ? keys.slice() : [])
      .map((k) => ({
        t: Math.max(0, num(k && k.t, 0)),
        v: num(k && k.v, 0),
        curve: typeof (k && k.curve) === 'string' ? k.curve : 'linear',
      }))
      .sort((a, b) => a.t - b.t);
  }

  /* Eğri seti modülasyon motorundan gelir; aynı isimli eğri iki yerde de aynı
     hissetsin diye kopyalanmaz, ödünç alınır. Modülasyon yüklenmemişse (saf
     birim testi) doğrusal davranılır. */
  function curveFn(name) {
    // Tut (#957): değer bir sonraki noktaya kadar sabit kalır, o anda sıçrar
    if (name === 'hold') return () => 0;
    const mod =
      (typeof window !== 'undefined' && window.SVModulation) ||
      (typeof module !== 'undefined' && module.exports && tryRequireModulation());
    const set = mod && mod.CURVES;
    if (set && set[name]) return set[name];
    return (v) => v;
  }

  let _modCache;
  function tryRequireModulation() {
    if (_modCache !== undefined) return _modCache;
    try {
      _modCache = require('./modulation.js');
    } catch (e) {
      _modCache = null;
    }
    return _modCache;
  }

  function evalKeys(keys, t) {
    const ks = Array.isArray(keys) ? keys : [];
    if (!ks.length) return null;
    t = num(t, 0);
    if (t <= ks[0].t) return ks[0].v;
    const last = ks[ks.length - 1];
    if (t >= last.t) return last.v;

    let i = 0;
    for (let k = 1; k < ks.length; k++) {
      if (ks[k].t <= t) i = k;
      else break;
    }
    const a = ks[i];
    const b = ks[i + 1];
    if (!b) return a.v;
    const span = b.t - a.t;
    if (span <= TL_EPS) return b.v;
    /* Eğri, SEGMENTİN BAŞINDAKİ anahtardan alınır: kullanıcı bir anahtarın
       eğrisini değiştirdiğinde ondan SONRAKİ geçişin şekli değişir, ki
       düzenleyicide beklenen davranış budur. */
    const shaped = curveFn(a.curve)(clamp((t - a.t) / span, 0, 1));
    return a.v + (b.v - a.v) * shaped;
  }

  // ==========================================================================
  // Klip ve parça
  // ==========================================================================
  const CLIP_TYPES = ['scene', 'preset', 'palette', 'visualizer', 'video', 'image', 'shader', 'action'];

  function makeClip(spec) {
    const s = spec || {};
    const dur = Math.max(0.001, num(s.dur, 4));
    return {
      id: typeof s.id === 'string' && s.id ? s.id : newId('clip'),
      name: typeof s.name === 'string' ? s.name : '',
      start: Math.max(0, num(s.start, 0)),
      dur,
      /* Kaynağın kendi içindeki kırpma. inPoint klibin kaynağın neresinden
         başlayacağı, outPoint nerede biteceği. Videolar için anlamlı; sahne
         ve şablonlarda yok sayılır. */
      inPoint: Math.max(0, num(s.inPoint, 0)),
      outPoint: s.outPoint == null ? null : Math.max(0, num(s.outPoint, 0)),
      /* Hız verilmemişse 1. Önce `clamp(undefined)` alt sınırı (0,05)
         döndürüyordu ve `|| 1` hiç devreye girmiyordu: hızı yazılmamış her
         klip yirmide bir hızdaydı (#636'da denetçide görüldü). */
      speed: s.speed == null || s.speed === '' ? 1 : clamp(s.speed, 0.05, 20),
      type: CLIP_TYPES.indexOf(s.type) >= 0 ? s.type : 'scene',
      ref: typeof s.ref === 'string' ? s.ref : '',
      /* Video, görsel ve shader klibinin hedefi (katman ya da ana yüzey):
         klip destesinin yuvalarıyla aynı biçim (#637 CD-3). Boşsa ya da
         hedef silinmişse ilk uygun hedef. */
      target: typeof s.target === 'string' ? s.target.slice(0, 120) : '',
      fade: Math.max(0, num(s.fade, 0)),
      /* Klibin KENDİ geçişi (#957): tür ve yumuşatma; boşsa sahnenin
         varsayılanı. Yalnız bu klipte saklanıyor, sahnenin geçişine
         dokunmuyor: aynı sahnenin iki klibi farklı geçebilir. */
      transType: typeof s.transType === 'string' ? s.transType.slice(0, 40) : '',
      transEase: typeof s.transEase === 'string' ? s.transEase.slice(0, 40) : '',
      /* Kullanıcının verdiği renk (#636); boşsa parçanın rengi, o da yoksa
         türün rengi kullanılıyor (shared/timeline-edit.js clipColor). Model
         her çizimde yeniden kurulduğu için burada TAŞINMAZSA ilk çizimde
         sessizce silinirdi. */
      color: hexColor(s.color),
      // Parça opaklığı (#957): bu parçanın sahnesi alttakilerin üstüne bu oranla biner
      opacity: Math.max(0, Math.min(1, s.opacity == null ? 1 : num(s.opacity, 1))),
      // Klip giriş/çıkış solması (#957, sn): opaklık 0'dan çıkar, sonda 0'a iner
      fadeIn: Math.max(0, num(s.fadeIn, 0)),
      fadeOut: Math.max(0, num(s.fadeOut, 0)),
      /* Klibe özel yerel kopya (Timeline kullan modu): Sahne panelinden bu
         klip düzenlenince kaynağın kopyası burada tutulur. Kaynak sahne
         değişmez. Model her çizimde yeniden kurulduğu için TAŞINMALI. */
      local: s.local && typeof s.local === 'object' && s.local.data && typeof s.local.data === 'object'
        ? { from: s.local.from && typeof s.local.from === 'object' ? { type: String(s.local.from.type || ''), ref: String(s.local.from.ref || '') } : null, data: s.local.data }
        : undefined,
    };
  }

  function hexColor(v) {
    return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '';
  }

  function clipEnd(clip) {
    return clip.start + clip.dur;
  }

  function makeTrack(spec) {
    const s = spec || {};
    const kind = s.kind === 'automation' ? 'automation' : 'clip';
    const t = {
      id: typeof s.id === 'string' && s.id ? s.id : newId('trk'),
      name: typeof s.name === 'string' ? s.name : kind === 'automation' ? 'Otomasyon' : 'Parça',
      kind,
      muted: !!s.muted,
      /* Solo (#636): bir parça solo ise yalnız solo parçalar çalıyor.
         Değerlendirme modelin kendisinde (clipsAt/automationAt): pencereler
         ve çevrimdışı dışa aktarım da buradan okuyor, panel içinde yapılsa
         dışa aktarım canlıdan farklı çıkardı. */
      solo: !!s.solo,
      locked: !!s.locked,
      color: hexColor(s.color),
    };
    if (kind === 'automation') {
      t.target = typeof s.target === 'string' ? s.target : '';
      t.min = num(s.min, 0);
      t.max = num(s.max, 1);
      t.keys = sortKeys(s.keys);
    } else {
      t.clips = (Array.isArray(s.clips) ? s.clips : []).map(makeClip).sort((a, b) => a.start - b.start);
      // Parça opaklığı (#957): sahnesi alttakilerin üstüne bu oranla biner
      const op = Number(s.opacity);
      t.opacity = Number.isFinite(op) ? Math.max(0, Math.min(1, op)) : 1;
    }
    return t;
  }

  function makeMarker(spec) {
    const s = spec || {};
    const m = {
      id: typeof s.id === 'string' && s.id ? s.id : newId('mk'),
      t: Math.max(0, num(s.t, 0)),
      name: typeof s.name === 'string' ? s.name : '',
    };
    /* Cue (bekleme) işareti: canlı oynatma burada durur, GO ile sürer.
       Alan yalnız açıkken yazılır; eski işaretler ve kayıtlar aynen kalır. */
    if (s.hold === true) m.hold = true;
    return m;
  }

  /* Cue listesi: t'den SONRAKİ ilk bekleme işareti. Tam cue üzerindeyken
     (GO ile sürerken) aynı cue yeniden yakalanmasın diye kesin büyük. */
  function holdAfter(markers, t) {
    if (!Array.isArray(markers)) return null;
    let best = null;
    for (const m of markers) {
      if (!m || m.hold !== true || !(m.t > t + 1e-6)) continue;
      if (!best || m.t < best.t) best = m;
    }
    return best;
  }

  // ==========================================================================
  // Çizelge
  // ==========================================================================
  function makeTimeline(spec) {
    const s = spec || {};
    const tl = {
      tempo: makeTempoMap(s.tempo && s.tempo.length ? s.tempo : [{ t: 0, bpm: num(s.bpm, 120), beatsPerBar: 4 }]),
      tracks: (Array.isArray(s.tracks) ? s.tracks : []).map(makeTrack),
      markers: (Array.isArray(s.markers) ? s.markers : []).map(makeMarker).sort((a, b) => a.t - b.t),
      loop: {
        enabled: !!(s.loop && s.loop.enabled),
        start: Math.max(0, num(s.loop && s.loop.start, 0)),
        end: Math.max(0, num(s.loop && s.loop.end, 0)),
      },
      snap: SNAP_MODES.indexOf(s.snap) >= 0 ? s.snap : 'bar',
      fps: Math.max(1, num(s.fps, 60)),
    };
    if (tl.loop.end <= tl.loop.start) tl.loop.enabled = false;
    uniqueIds(tl);
    return tl;
  }

  /* KİMLİKLER TEKİL (#957). Sayaç her oturumda sıfırdan başlıyordu: yüklenen çizelgede
     clip_1 varken yeni eklenen klip de clip_1 alıyordu. Seçim ve otomasyon hedefi kimlikle
     tutulduğundan tek tık birden çok klibi seçiyor, hedef listesinde aynı klip iki kez
     görünüyordu. Yüklemede sayaç en büyük sonekin üstüne çekiliyor, yinelenen kimlik
     (ilki yerinde kalarak) yenisini alıyor. */
  function uniqueIds(tl) {
    const all = [];
    for (const trk of tl.tracks) {
      all.push(trk);
      for (const c of trk.clips || []) all.push(c);
    }
    for (const m of tl.markers) all.push(m);
    for (const o of all) {
      const m = /_(\d+)$/.exec(o.id || '');
      if (m && Number(m[1]) > idCounter) idCounter = Number(m[1]);
    }
    const seen = new Set();
    for (const trk of tl.tracks) {
      if (seen.has(trk.id)) trk.id = newId('trk');
      seen.add(trk.id);
      for (const c of trk.clips || []) {
        if (seen.has(c.id)) c.id = newId('clip');
        seen.add(c.id);
      }
    }
    for (const mk of tl.markers) {
      if (seen.has(mk.id)) mk.id = newId('mk');
      seen.add(mk.id);
    }
    return tl;
  }

  /* Çizelgenin toplam uzunluğu: en geç biten klip, en geç işaret ve döngü
     sonundan hangisi büyükse o. Boş çizelge 0 döner, Infinity değil. */
  function timelineLength(tl) {
    let end = 0;
    for (const trk of tl.tracks) {
      if (trk.kind === 'clip') {
        for (const c of trk.clips) end = Math.max(end, clipEnd(c));
      } else {
        for (const k of trk.keys) end = Math.max(end, k.t);
      }
    }
    for (const m of tl.markers) end = Math.max(end, m.t);
    if (tl.loop.enabled) end = Math.max(end, tl.loop.end);
    return end;
  }

  /* Belirli bir anda hangi klipler etkin? Sıra parça sırasıdır: üstteki parça
     önce döner, çizim tarafı istiflemeyi buna göre yapar. */
  /* Parça çalıyor mu: susturulmuş parça hiç çalmıyor (solo olsa da);
     herhangi bir parça solo ise solo olmayanlar da susuyor. */
  function anySolo(tl) {
    for (const trk of tl.tracks) if (trk.solo) return true;
    return false;
  }
  function audible(trk, solo) {
    return !trk.muted && (!solo || !!trk.solo);
  }

  function clipsAt(tl, t) {
    const out = [];
    const solo = anySolo(tl);
    for (const trk of tl.tracks) {
      if (trk.kind !== 'clip' || !audible(trk, solo)) continue;
      for (const c of trk.clips) {
        if (t >= c.start - TL_EPS && t < clipEnd(c) - TL_EPS) out.push({ track: trk, clip: c, local: t - c.start });
      }
    }
    return out;
  }

  /* Her parçadan EN FAZLA bir etkin klip: üst üste binen kliplerde en geç
     başlayan kazanır (eşitlikte listede sonra gelen). clipsAt ikisini de
     döndürüyordu; panel parça başına son klibi tuttuğu için iki klip her
     karede sırayla yeniden ateşleniyor ve sahne kare başına iki kez
     uygulanıyordu. */
  function activeClipsAt(tl, t) {
    const best = new Map();
    for (const e of clipsAt(tl, t)) {
      const cur = best.get(e.track);
      if (!cur || e.clip.start >= cur.clip.start) best.set(e.track, e);
    }
    return Array.from(best.values());
  }

  /* Geçiş ilerlemesi zamanın SAF işlevi (#957). Önceden klip geçişi oynatma
     klibe girince bir kez tetiklenen bir animasyondu: oynatıcı geçişin ortasına
     park edilince o kare görünmüyor, süre/tür değişince ancak baştan oynatınca
     yansıyordu. Artık ilerleme = (t - klip başı) / süre, yumuşatmayla; aynı t
     her zaman aynı kareyi verir. fallbackDur: klibin kendi süresi yoksa (0)
     sahnenin genel geçiş süresi. ease: (x) => y; verilmezse doğrusal. */
  function transitionProgress(clip, t, fallbackDur, ease) {
    if (!clip) return null;
    const dur = clip.fade > 0 ? clip.fade : Math.max(0, Number(fallbackDur) || 0);
    if (!(dur > 0) || clip.transType === 'cut') return null;
    const raw = (t - clip.start) / dur;
    if (raw < 0 || raw >= 1) return null;
    const f = typeof ease === 'function' ? ease : null;
    return { raw, p: f ? f(raw) : raw, dur, local: t - clip.start };
  }

  /* t anında geçiş penceresinde olan sahne/şablon klibi (parça başına etkin
     olan). Klibin kendi geçişi olmasa da genel süreyle pencere açılır. */
  function transitionAt(tl, t, fallbackDur, ease) {
    if (!tl || !Array.isArray(tl.tracks)) return null;
    // Geçiş öndeki (en üst parçadaki) sahnenin geçişi
    for (const e of sceneStack(tl, t).slice(0, 1)) {
      const c = e.clip;
      const pr = transitionProgress(c, t, fallbackDur, ease);
      if (pr) return Object.assign({ track: e.track, clip: c }, pr);
    }
    return null;
  }

  /* İşaret vuruş testi (#957): bayrağın tamamı (etiket kapsülü + 4 px pay),
     cetvel boyunca dikey çizginin ±4 px'i. Önceden yalnız bayrağın ilk 12
     px'i ve 14 px'lik bir bant tutuyordu; işaret seçmek çok zordu. Üst üste
     binen işaretlerde sağdaki (sonra çizilen, üstte görünen) kazanır.
     o: { xOf(t), widthOf(m), rulerH, pad } */
  function markerHit(markers, x, y, o) {
    if (!Array.isArray(markers) || !o || typeof o.xOf !== 'function') return null;
    const rh = o.rulerH || 0;
    if (y < 0 || y >= rh) return null;
    const pad = o.pad == null ? 4 : o.pad;
    for (let i = markers.length - 1; i >= 0; i--) {
      const m = markers[i];
      const mx = o.xOf(m.t);
      const w = typeof o.widthOf === 'function' ? Math.max(8, o.widthOf(m) || 0) : 8;
      const inPill = y >= rh - 19 - pad && x >= mx - pad && x <= mx + w + pad;
      const onLine = y >= rh - 19 - pad && Math.abs(x - mx) <= 4;
      if (inPill || onLine) return m;
    }
    return null;
  }

  /* Bitişik işarete atlama: dir -1 önceki, +1 sonraki (t'ye göre) */
  function markerStep(markers, t, dir) {
    if (!Array.isArray(markers) || !markers.length) return null;
    const list = markers.slice().sort((a, b) => a.t - b.t);
    if (dir > 0) return list.find((m) => m.t > t + 1e-6) || null;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].t < t - 1e-6) return list[i];
    return null;
  }

  /* Üst üste binen sahne klipleri (#957): katman listesindeki gibi BİLEŞİM.
     Önceden her parçanın klibi sırayla uygulanıyor, sonuncusu (en ALTTAKİ
     parça) sahneyi ezip kazanıyordu. Artık en üstteki parçanın sahnesi önde,
     alttakiler arkada katman olarak çalışmaya devam ediyor. Susturulan parça
     atlanır, solo varsa yalnız solo parçalar (activeClipsAt süzüyor).
     sceneStack: etkin sahne/şablon klipleri, EN ÜSTTEKİ parça önce. */
  function isSceneClip(c) { return !!c && (c.type === 'scene' || c.type === 'preset'); }
  function sceneStack(tl, t) {
    return activeClipsAt(tl, t).filter((e) => isSceneClip(e.clip));
  }

  /* Aynı parçada bu klipten önce biten (giden) klip: geçişin "nereden"i */
  function clipBefore(trk, clip) {
    let best = null;
    for (const c of (trk && trk.clips) || []) {
      if (c === clip || c.id === clip.id) continue;
      if (c.start < clip.start && (!best || c.start > best.start)) best = c;
    }
    return best;
  }

  /* Otomasyonun o andaki değerleri: { 'dotted.path': değer }.
     Susturulmuş parça hiç yazmaz — canlı modülasyonun o hedefi sürmesine izin
     verir, sıfırlamaz. */
  function automationAt(tl, t) {
    const out = {};
    const solo = anySolo(tl);
    for (const trk of tl.tracks) {
      if (trk.kind !== 'automation' || !audible(trk, solo) || !trk.target) continue;
      // Çizelgenin kendi hedefleri (parça/klip opaklığı) yapılandırmaya yazılmaz
      if (isTimelineTarget(trk.target)) continue;
      const norm = evalKeys(trk.keys, t);
      if (norm == null) continue;
      out[trk.target] = trk.min + (trk.max - trk.min) * clamp(norm, 0, 1);
    }
    return out;
  }

  /* Çizelge içi otomasyon hedefleri (#957): 'tl.track.<id>.opacity' ve
     'tl.clip.<id>.opacity'. Yapılandırmada karşılıkları yok; bileşim
     (entryOpacity) onları doğrudan okur. */
  function isTimelineTarget(path) {
    return typeof path === 'string' && /^tl\.(track|clip)\./.test(path);
  }
  function timelineTargetAt(tl, path, t) {
    const solo = anySolo(tl);
    for (const trk of tl.tracks) {
      if (trk.kind !== 'automation' || trk.target !== path || !audible(trk, solo)) continue;
      const norm = evalKeys(trk.keys, t);
      if (norm == null) continue;
      return clamp(trk.min + (trk.max - trk.min) * clamp(norm, 0, 1), 0, 1);
    }
    return null;
  }
  /* Bir klibin t anındaki etkin opaklığı: parça × klip (otomasyon varsa o
     değer sabitin yerine geçer) × giriş/çıkış solması. */
  function entryOpacity(tl, track, clip, t) {
    const ta = timelineTargetAt(tl, 'tl.track.' + track.id + '.opacity', t);
    const ca = timelineTargetAt(tl, 'tl.clip.' + clip.id + '.opacity', t);
    let op = (ta != null ? ta : track.opacity == null ? 1 : track.opacity) * (ca != null ? ca : clip.opacity == null ? 1 : clip.opacity);
    const local = t - clip.start;
    if (clip.fadeIn > 0 && local < clip.fadeIn) op *= clamp(local / clip.fadeIn, 0, 1);
    const left = clip.start + clip.dur - t;
    if (clip.fadeOut > 0 && left < clip.fadeOut) op *= clamp(left / clip.fadeOut, 0, 1);
    return clamp(op, 0, 1);
  }

  /* Tempo değiştiğinde müzikal konumları korumak İSTEYEN kullanıcı için açık
     dönüşüm: her zaman değeri eski haritada vuruşa çevrilir, yeni haritada
     saniyeye geri döndürülür. Çağrılmadıkça hiçbir şey kıpırdamaz. */
  function retimeToTempo(tl, newTempoEntries) {
    const oldMap = tl.tempo;
    const newMap = makeTempoMap(newTempoEntries);
    const conv = (sec) => beatsToSeconds(newMap, secondsToBeats(oldMap, sec));
    for (const trk of tl.tracks) {
      if (trk.kind === 'clip') {
        for (const c of trk.clips) {
          const end = conv(clipEnd(c));
          c.start = conv(c.start);
          c.dur = Math.max(0.001, end - c.start);
        }
        trk.clips.sort((a, b) => a.start - b.start);
      } else {
        for (const k of trk.keys) k.t = conv(k.t);
        trk.keys.sort((a, b) => a.t - b.t);
      }
    }
    for (const m of tl.markers) m.t = conv(m.t);
    tl.loop.start = conv(tl.loop.start);
    tl.loop.end = conv(tl.loop.end);
    tl.tempo = newMap;
    return tl;
  }

  // ==========================================================================
  // Taşıma (transport) — çizelgenin ve klip destesinin TEK saati
  //
  // Duvar saatini kendi okumaz: her karede dışarıdan `dt` alır. Çevrimdışı
  // dışa aktarım bu sayede kare indeksinden ilerleyebilir ve aynı gösteri iki
  // kez işlendiğinde aynı kareleri üretir.
  // ==========================================================================
  function Transport(tl) {
    this.tl = tl || makeTimeline({});
    this.time = 0;
    this.playing = false;
    this.rate = 1;
  }

  Transport.prototype.play = function () {
    this.playing = true;
    return this;
  };
  Transport.prototype.pause = function () {
    this.playing = false;
    return this;
  };
  Transport.prototype.stop = function () {
    this.playing = false;
    this.time = 0;
    return this;
  };
  /* Sürükleme (scrub): duraklatılmışken de sahneyi anında günceller, çünkü
     zaman değeri değişir ve okuyan taraf her karede buradan okur. */
  Transport.prototype.seek = function (t) {
    this.time = Math.max(0, num(t, 0));
    return this;
  };
  Transport.prototype.seekBar = function (bar, beat) {
    return this.seek(barsToSeconds(this.tl.tempo, bar, beat));
  };

  Transport.prototype.advance = function (dt) {
    if (!this.playing) return this.time;
    dt = num(dt, 0) * (num(this.rate, 1) || 1);
    let t = this.time + dt;
    const loop = this.tl.loop;
    if (loop.enabled && loop.end > loop.start) {
      const span = loop.end - loop.start;
      if (t >= loop.end) {
        /* Modülo ile geri sar: tek bir karede döngü boyundan fazla ilerlense
           bile (kare atlaması) doğru yere düşer, döngü başına saplanmaz. */
        t = loop.start + ((t - loop.start) % span);
      } else if (t < loop.start) {
        t = loop.end - ((loop.start - t) % span);
      }
    }
    this.time = Math.max(0, t);
    return this.time;
  };

  Transport.prototype.bars = function () {
    return secondsToBars(this.tl.tempo, this.time);
  };
  Transport.prototype.state = function () {
    return { time: this.time, playing: this.playing, bars: this.bars() };
  };

  // ==========================================================================
  // İşaretler
  // ==========================================================================
  function markerAfter(tl, t) {
    for (const m of tl.markers) if (m.t > t + 1e-4) return m;
    return null;
  }
  function markerBefore(tl, t) {
    let out = null;
    for (const m of tl.markers) {
      if (m.t < t - 1e-4) out = m;
      else break;
    }
    return out;
  }

  /* LRC/SRT sözlerinden ya da bir cue listesinden işaret üret. Ayrıştırma
     zaten var olan lyrics modülüne bırakılır: iki ayrı ayrıştırıcı zamanla
     birbirinden ayrılırdı. */
  function markersFromCues(cues) {
    return (Array.isArray(cues) ? cues : [])
      .map((c) => makeMarker({ t: c && (c.t != null ? c.t : c.time), name: (c && (c.text || c.name)) || '' }))
      .sort((a, b) => a.t - b.t);
  }

  // ==========================================================================

  /* Dışa aktarım / çevrimdışı oynatma kafası haritası.
     Döngü AÇIK: Transport ile aynı — loop.start..end aralığına sar.
     Döngü KAPALI: bitişten sonra SON DURUMDA kal (son klip/sahne karesi).
     Canlı çıkış ve dışa aktarım aynı kuralı kullanır. */
  function wrapPlayhead(tl, t) {
    return evalPlayhead(tl, t);
  }

  /* Son sahne/şablon klibinin bittiği an (saniye). Boşsa 0. */
  /* Son sahne/önayar klibinin bitişi — döngü kapalıyken "son durum" bunun
     bir epsilon öncesi. Sahne yoksa 0 (sıkıştırma yok; otomasyon zaten
     son anahtarı tutar). */
  function lastContentEnd(tl) {
    if (!tl || !tl.tracks) return 0;
    let end = 0;
    for (const trk of tl.tracks) {
      if (!trk || trk.kind !== 'clip' || !trk.clips) continue;
      for (const c of trk.clips) {
        if (isSceneClip(c)) end = Math.max(end, clipEnd(c));
      }
    }
    return end;
  }

  function evalPlayhead(tl, t) {
    const x = Math.max(0, Number(t) || 0);
    if (!tl) return x;
    const loop = tl.loop;
    if (loop && loop.enabled) {
      const start = Number(loop.start) || 0;
      const end = Number(loop.end) || 0;
      if (!(end > start)) return x;
      const span = end - start;
      if (x >= end) return start + ((x - start) % span);
      if (x < start) {
        const back = (start - x) % span;
        return end - (back === 0 ? span : back);
      }
      return x;
    }
    /* Döngü kapalı: içerik bittikten sonra son karede kal.
       Tam bitiş anında clipsAt boş döner (t < end); bir epsilon geri çek. */
    const contentEnd = lastContentEnd(tl);
    if (contentEnd > 0 && x >= contentEnd - TL_EPS) {
      return Math.max(0, contentEnd - TL_EPS * 2);
    }
    return x;
  }

  function tryRequireSchema() {
    try { return require('./schema.js'); } catch { return null; }
  }
  function tryRequireDefaults() {
    try { return require('./defaults.js'); } catch { return null; }
  }
  function svClone(v) {
    const SV = (typeof window !== 'undefined' && window.SV) || tryRequireDefaults();
    if (SV && typeof SV.clone === 'function') return SV.clone(v);
    return JSON.parse(JSON.stringify(v));
  }
  function sceneKeyList() {
    const S = (typeof window !== 'undefined' && window.SVSchema) || tryRequireSchema();
    return (S && S.SCENE_KEYS) || [];
  }

  /* cfg.scenes içinden bir sahnenin SCENE_KEYS görünümünü üretir. */
  function materializeScene(cfg, sceneId) {
    if (!cfg || !sceneId) return null;
    const scenes = Array.isArray(cfg.scenes) ? cfg.scenes : [];
    const sc = scenes.find((x) => x && x.id === sceneId);
    if (!sc || !sc.data) return null;
    const def = ((typeof window !== 'undefined' && window.SV && window.SV.DEFAULT_CONFIG)
      || (tryRequireDefaults() && tryRequireDefaults().DEFAULT_CONFIG) || {});
    const out = {};
    for (const k of sceneKeyList()) {
      const src = sc.data[k] !== undefined ? sc.data[k] : def[k];
      if (src === undefined) continue;
      out[k] = svClone(src);
    }
    return out;
  }

  /* t anındaki sahne yığınını + otomasyonu cfg kopyasına uygular.
     Canlı panel applyClipsAt / applyScene ile aynı bileşim (#957).
     Dışa aktarım kare kare bunu çağırır; gösteri saati kullanılmaz.
     Döngü kapalıyken t içerik sonunu aşarsa son durumda kalır. */
  /* Dışa aktarım / çevrimdışı: t anındaki palet ve görselleştirici klipleri.
     Canlı applyClipsAt ile aynı kazanan kuralları (palet: son parça;
     görselleştirici: son uygun). Eylem ve medya burada YOK — yan etki / dosya. */
  function applyDeclarativeClips(cfg, tl, t) {
    if (!cfg || !tl) return { cfg: cfg, applied: false };
    const active = activeClipsAt(tl, t);
    let pal = null;
    let vis = null;
    for (const e of active) {
      if (!e || !e.clip || isSceneClip(e.clip)) continue;
      if (e.clip.type === 'palette' && e.clip.ref) pal = e.clip;
      else if (e.clip.type === 'visualizer' && e.clip.ref) vis = e.clip;
    }
    if (!pal && !vis) return { cfg: cfg, applied: false };
    let next = svClone(cfg);
    let applied = false;
    if (pal) {
      const SV = (typeof window !== 'undefined' && window.SV) || tryRequireDefaults();
      const built = (SV && SV.GRADIENT_PRESETS) || [];
      const user = (cfg.userPresets || []);
      const hit = built.concat(user).find((g) => g && g.name === pal.ref);
      if (hit && Array.isArray(hit.colors)) {
        next.background = next.background || {};
        next.background.gradient = Object.assign({}, next.background.gradient || {}, { colors: hit.colors.slice() });
        applied = true;
      }
    }
    if (vis) {
      const skip = (l) => !l || l.kind !== 'visualizer' || l.locked || l.enabled === false
        || l.type === 'text' || l.type === 'nowplaying';
      const layers = Array.isArray(next.layers) ? next.layers : null;
      const target = layers && layers.find((l) => !skip(l));
      if (target) { target.type = vis.ref; applied = true; }
      else if (next.visualizer) { next.visualizer.type = vis.ref; applied = true; }
    }
    return { cfg: next, applied: applied };
  }

  function applyTimelineAt(cfg, tl, t) {
    const out = { cfg: cfg, t: Math.max(0, Number(t) || 0), applied: false };
    if (!cfg || !tl) return out;
    const wt = evalPlayhead(tl, out.t);
    out.t = wt;
    const stack = sceneStack(tl, wt);
    let next = cfg;
    if (stack.length && stack[0].clip && stack[0].clip.ref && isSceneClip(stack[0].clip)) {
      const topMat = materializeScene(cfg, stack[0].clip.ref);
      if (topMat) {
        next = Object.assign(svClone(cfg), topMat);
        const under = stack.slice(1).reverse().filter((e) => e.clip && e.clip.type === 'scene' && e.clip.ref);
        const back = [];
        for (const e of under) {
          const mat = materializeScene(cfg, e.clip.ref);
          const layers = mat && Array.isArray(mat.layers) ? mat.layers : [];
          const op = entryOpacity(tl, e.track, e.clip, wt);
          for (const l of layers) {
            if (!l || l.tlUnder) continue;
            const c = svClone(l);
            c.id = String(c.id || 'ly') + '@' + (e.track && e.track.id || 'trk');
            c.opacity = (c.opacity == null ? 1 : c.opacity) * op;
            c.locked = true;
            c.tlUnder = true;
            back.push(c);
          }
        }
        const topOp = entryOpacity(tl, stack[0].track, stack[0].clip, wt);
        let layers = Array.isArray(next.layers) ? next.layers.filter((l) => l && !l.tlUnder) : [];
        if (topOp < 1) {
          layers = layers.map((l) => {
            const c = svClone(l);
            c.opacity = (c.opacity == null ? 1 : c.opacity) * topOp;
            return c;
          });
        }
        next.layers = back.concat(layers);
        out.applied = true;
      }
    }
    const decl = applyDeclarativeClips(next, tl, wt);
    next = decl.cfg;
    if (decl.applied) out.applied = true;
    const auto = applyAutomation(next, tl, wt);
    out.cfg = auto.cfg;
    return out;
  }


  /* Zaman çizelgesi bankası: birden çok çizelge, silmeden pasifleştirme.
     Çalışan belge cfg.timeline alanlarında kalır (panel / makeTimeline aynı);
     diğerleri cfg.timeline.bank[] içinde saklanır. */

  const TIMELINE_CONTENT_KEYS = ['tempo', 'tracks', 'markers', 'loop', 'snap', 'fps'];

  function timelineContentKeys() {
    return TIMELINE_CONTENT_KEYS.slice();
  }

  function snapshotTimeline(cfgTl) {
    const s = cfgTl || {};
    const snap = {
      id: typeof s.id === 'string' && s.id ? s.id : newId('tl'),
      name: typeof s.name === 'string' && s.name ? s.name : 'A',
      itemEnabled: s.itemEnabled !== false,
    };
    for (const k of TIMELINE_CONTENT_KEYS) {
      if (s[k] !== undefined) snap[k] = svClone(s[k]);
    }
    /* Normalize through makeTimeline so bank entries stay clean. */
    const norm = makeTimeline(snap);
    snap.tempo = norm.tempo;
    snap.tracks = norm.tracks;
    snap.markers = norm.markers;
    snap.loop = norm.loop;
    snap.snap = norm.snap;
    snap.fps = norm.fps;
    return snap;
  }

  function applyTimelineSnapshot(cfgTl, snap) {
    if (!cfgTl || !snap) return cfgTl;
    cfgTl.id = snap.id;
    cfgTl.name = snap.name;
    cfgTl.itemEnabled = snap.itemEnabled !== false;
    const norm = makeTimeline(snap);
    cfgTl.tempo = TE_tempoList(norm.tempo);
    cfgTl.tracks = norm.tracks;
    cfgTl.markers = norm.markers;
    cfgTl.loop = norm.loop;
    cfgTl.snap = norm.snap;
    cfgTl.fps = norm.fps;
    return cfgTl;
  }

  /* Tempo may be cumulative map from makeTimeline; store flat list like the panel. */
  function TE_tempoList(tempo) {
    if (Array.isArray(tempo) && tempo.length && tempo[0] && tempo[0].beat0 == null && tempo[0].bpm != null) {
      return tempo.map((e) => ({ t: e.t, bpm: e.bpm, beatsPerBar: e.beatsPerBar }));
    }
    /* Cumulative map → flat */
    const list = [];
    const arr = Array.isArray(tempo) ? tempo : [];
    for (const e of arr) {
      if (!e) continue;
      list.push({ t: e.t, bpm: e.bpm, beatsPerBar: e.beatsPerBar });
    }
    return list.length ? list : [{ t: 0, bpm: 120, beatsPerBar: 4 }];
  }

  function ensureTimelineBank(cfgTl) {
    const tl = cfgTl || {};
    if (!Array.isArray(tl.bank)) tl.bank = [];
    if (typeof tl.id !== 'string' || !tl.id) tl.id = newId('tl');
    if (typeof tl.name !== 'string' || !tl.name) tl.name = 'A';
    if (tl.itemEnabled === undefined) tl.itemEnabled = true;
    /* Sekme sırası: seçim sırayı değiştirmesin (etkin sekme başa atlamasın).
       Eski kayıtlarda yok: etkin + banka sırasıyla bir kez kurulur; silinenler
       düşer, bilinmeyenler sona eklenir. */
    const ids = [tl.id].concat(tl.bank.filter((b) => b && b.id).map((b) => b.id));
    const known = new Set(ids);
    const prev = Array.isArray(tl.order) ? tl.order : [];
    const order = [];
    for (const id of prev) if (known.has(id) && !order.includes(id)) order.push(id);
    for (const id of ids) if (!order.includes(id)) order.push(id);
    tl.order = order;
    return tl;
  }

  /* Sürükle-bırak: sekmeyi hedef konuma taşı (tek açık sıralama yolu). */
  function moveTimeline(cfgTl, id, toIndex) {
    const tl = ensureTimelineBank(cfgTl);
    const from = tl.order.indexOf(id);
    if (from < 0) return tl;
    tl.order.splice(from, 1);
    const to = Math.max(0, Math.min(tl.order.length, Math.round(Number(toIndex) || 0)));
    tl.order.splice(to, 0, id);
    return tl;
  }

  function listTimelineBank(cfgTl) {
    const tl = ensureTimelineBank(cfgTl);
    const cur = snapshotTimeline(tl);
    const others = tl.bank.map((b) => snapshotTimeline(b));
    /* Kayıtlı sekme sırası (etkin olan başa alınmaz). */
    const byId = new Map();
    byId.set(cur.id, cur);
    for (const b of others) if (!byId.has(b.id)) byId.set(b.id, b);
    return tl.order.filter((id) => byId.has(id)).map((id) => byId.get(id));
  }

  function stashCurrentIntoBank(cfgTl) {
    const tl = ensureTimelineBank(cfgTl);
    const cur = snapshotTimeline(tl);
    const i = tl.bank.findIndex((b) => b && b.id === cur.id);
    if (i >= 0) tl.bank[i] = cur;
    else tl.bank.push(cur);
    return cur;
  }

  function switchTimeline(cfgTl, id) {
    const tl = ensureTimelineBank(cfgTl);
    if (!id || id === tl.id) return tl;
    stashCurrentIntoBank(tl);
    const hit = tl.bank.find((b) => b && b.id === id);
    if (!hit) return tl;
    applyTimelineSnapshot(tl, hit);
    tl.bank = tl.bank.filter((b) => b && b.id !== id);
    return tl;
  }

  function nextTimelineName(existing) {
    const names = new Set((existing || []).map((x) => x && x.name).filter(Boolean));
    let k = existing ? existing.length : 0;
    let name = String.fromCharCode(65 + (k % 26));
    while (names.has(name) && k < 200) {
      k += 1;
      name = String.fromCharCode(65 + (k % 26)) + (k >= 26 ? String(Math.floor(k / 26)) : '');
    }
    return name;
  }

  function addTimeline(cfgTl, spec) {
    const tl = ensureTimelineBank(cfgTl);
    stashCurrentIntoBank(tl);
    const all = listTimelineBank(tl);
    const ids = new Set(all.map((x) => x.id));
    let n = all.length;
    let id = 'tl' + n;
    while (ids.has(id)) id = 'tl' + (++n);
    const name = (spec && spec.name) || nextTimelineName(all);
    const blank = makeTimeline(spec || {});
    applyTimelineSnapshot(tl, {
      id,
      name,
      itemEnabled: true,
      tempo: TE_tempoList(blank.tempo),
      tracks: blank.tracks,
      markers: blank.markers,
      loop: blank.loop,
      snap: blank.snap,
      fps: blank.fps,
    });
    /* Current is the new one; bank keeps the previous (and others). */
    tl.order = (tl.order || []).filter((x) => x !== id).concat(id);
    return ensureTimelineBank(tl);
  }

  function setTimelineItemEnabled(cfgTl, id, on) {
    const tl = ensureTimelineBank(cfgTl);
    const want = !!on;
    if (!id || id === tl.id) {
      tl.itemEnabled = want;
      return tl;
    }
    const hit = tl.bank.find((b) => b && b.id === id);
    if (hit) hit.itemEnabled = want;
    return tl;
  }

  function removeTimeline(cfgTl, id) {
    const tl = ensureTimelineBank(cfgTl);
    if (!id) return tl;
    if (id === tl.id) {
      /* Delete active: promote first bank item or reset to blank. */
      if (tl.bank.length) {
        /* Sıradaki komşu sekme etkin olsun; sıra korunur. */
        const pos = tl.order.indexOf(id);
        const rest = tl.order.filter((x) => x !== id);
        const wantId = rest[Math.min(Math.max(pos, 0), rest.length - 1)];
        const i = Math.max(0, tl.bank.findIndex((b) => b && b.id === wantId));
        const next = tl.bank.splice(i, 1)[0];
        tl.order = rest;
        applyTimelineSnapshot(tl, next);
      } else {
        const blank = makeTimeline({});
        applyTimelineSnapshot(tl, {
          id: newId('tl'),
          name: 'A',
          itemEnabled: true,
          tempo: TE_tempoList(blank.tempo),
          tracks: blank.tracks,
          markers: blank.markers,
          loop: blank.loop,
          snap: blank.snap,
          fps: blank.fps,
        });
      }
      return tl;
    }
    tl.bank = tl.bank.filter((b) => b && b.id !== id);
    return tl;
  }

  // Otomasyonun yapılandırmaya uygulanması
  //
  // Sıra ÖNEMLİ ve bilinçli: önce otomasyon TABANI yazar, sonra canlı
  // modülasyon onun üstüne biner. Çizilmiş bir eğri değeri belirler, ona
  // atanmış bir LFO da o değerin etrafında salınır — ses masalarında ve
  // ses yazılımlarında beklenen davranış budur. Ters sıra, çizilen eğriyi
  // görünmez kılardı.
  //
  // Yazma modülasyonun setIn’iyle yapılır: kopyala-yaz, yani kullanıcının
  // kayıtlı ayarına DOKUNULMAZ, yalnızca o karenin kopyası değişir.
  // ==========================================================================
  function modOf() {
    if (typeof window !== 'undefined' && window.SVModulation) return window.SVModulation;
    return tryRequireModulation();
  }

  /* Dönüş: { cfg, applied, missing }.
     `missing`, yapılandırmada KARŞILIĞI OLMAYAN hedeflerin listesi. setIn
     var olmayan bir yola sessizce yazmaz; bu sessizlik bildirilmezse
     kullanıcı "otomasyon çalışmıyor" der ve sebebini kimse bulamaz. */
  function applyAutomation(cfg, tl, t) {
    const out = { cfg, applied: 0, missing: null };
    if (!cfg || !tl || !tl.tracks || !tl.tracks.length) return out;
    const mod = modOf();
    if (!mod || !mod.setIn || !mod.getIn) return out;

    const values = automationAt(tl, t);
    const paths = Object.keys(values);
    if (!paths.length) return out;

    let next = cfg;
    for (const path of paths) {
      if (mod.getIn(next, path) === undefined) {
        (out.missing || (out.missing = [])).push(path);
        continue;
      }
      // Yığın açıkken ilk canlı katmanın kendi değeri (bkz. modulation.js routedPath)
      const target = mod.routedPath ? mod.routedPath(next, path) : path;
      next = mod.setIn(next, target, values[path]);
      out.applied++;
    }
    out.cfg = next;
    return out;
  }

  const api = {
    makeTempoMap,
    secondsToBeats,
    beatsToSeconds,
    secondsToBars,
    barsToSeconds,
    snapSeconds,
    SNAP_MODES,
    sortKeys,
    evalKeys,
    makeClip,
    clipEnd,
    makeTrack,
    makeMarker,
    makeTimeline,
    timelineLength,
    clipsAt,
    activeClipsAt,
    transitionProgress,
    transitionAt,
    clipBefore,
    markerHit,
    markerStep,
    holdAfter,
    sceneStack,
    isSceneClip,
    automationAt,
    isTimelineTarget,
    timelineTargetAt,
    entryOpacity,
    audible,
    anySolo,
    applyAutomation,
    wrapPlayhead,
    evalPlayhead,
    lastContentEnd,
    materializeScene,
    applyTimelineAt,
    applyDeclarativeClips,
    timelineContentKeys,
    snapshotTimeline,
    applyTimelineSnapshot,
    ensureTimelineBank,
    listTimelineBank,
    switchTimeline,
    moveTimeline,
    addTimeline,
    setTimelineItemEnabled,
    removeTimeline,
    retimeToTempo,
    markerAfter,
    markerBefore,
    markersFromCues,
    Transport,
    CLIP_TYPES,
    newId,
    uniqueIds,
    resetIds,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVTimeline = api;
})();
