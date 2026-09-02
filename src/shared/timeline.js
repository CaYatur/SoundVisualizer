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
  const SNAP_MODES = ['off', 'bar', 'beat', 'half', 'quarter', 'frame'];

  /* Bir saniye değerini en yakın ızgara çizgisine oturt. `frame` kipi kare
     süresine yuvarlar; diğerleri tempo haritasını kullanır. */
  function snapSeconds(map, sec, mode, fps) {
    sec = num(sec, 0);
    if (!mode || mode === 'off') return sec;
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
  const CLIP_TYPES = ['scene', 'preset', 'video', 'image', 'shader', 'action'];

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
      speed: clamp(s.speed, 0.05, 20) || 1,
      type: CLIP_TYPES.indexOf(s.type) >= 0 ? s.type : 'scene',
      ref: typeof s.ref === 'string' ? s.ref : '',
      fade: Math.max(0, num(s.fade, 0)),
    };
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
      locked: !!s.locked,
    };
    if (kind === 'automation') {
      t.target = typeof s.target === 'string' ? s.target : '';
      t.min = num(s.min, 0);
      t.max = num(s.max, 1);
      t.keys = sortKeys(s.keys);
    } else {
      t.clips = (Array.isArray(s.clips) ? s.clips : []).map(makeClip).sort((a, b) => a.start - b.start);
    }
    return t;
  }

  function makeMarker(spec) {
    const s = spec || {};
    return {
      id: typeof s.id === 'string' && s.id ? s.id : newId('mk'),
      t: Math.max(0, num(s.t, 0)),
      name: typeof s.name === 'string' ? s.name : '',
    };
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
  function clipsAt(tl, t) {
    const out = [];
    for (const trk of tl.tracks) {
      if (trk.kind !== 'clip' || trk.muted) continue;
      for (const c of trk.clips) {
        if (t >= c.start - TL_EPS && t < clipEnd(c) - TL_EPS) out.push({ track: trk, clip: c, local: t - c.start });
      }
    }
    return out;
  }

  /* Otomasyonun o andaki değerleri: { 'dotted.path': değer }.
     Susturulmuş parça hiç yazmaz — canlı modülasyonun o hedefi sürmesine izin
     verir, sıfırlamaz. */
  function automationAt(tl, t) {
    const out = {};
    for (const trk of tl.tracks) {
      if (trk.kind !== 'automation' || trk.muted || !trk.target) continue;
      const norm = evalKeys(trk.keys, t);
      if (norm == null) continue;
      out[trk.target] = trk.min + (trk.max - trk.min) * clamp(norm, 0, 1);
    }
    return out;
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
      next = mod.setIn(next, path, values[path]);
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
    automationAt,
    applyAutomation,
    retimeToTempo,
    markerAfter,
    markerBefore,
    markersFromCues,
    Transport,
    CLIP_TYPES,
    newId,
    resetIds,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVTimeline = api;
})();
