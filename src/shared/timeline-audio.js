/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ZAMAN ÇİZELGESİ SESİ (#1171, #1172, #1173) — saf model, DOM yok.

   Ses parçaları `timeline.audioTracks` dizisinde durur: eski sürümler bu anahtarı
   tanımaz ve yok sayar; `tracks` dizisi hiç değişmez (eski sürüm bilinmeyen parça
   türünü sahne parçasına çevirirdi).

   Gerçek zamanlı çalma (panel) ve dışa aktarma (ffmpeg karışımı) AYNI karışım
   tanımını kullanır: her kaynak için zaman aralığı ve kazanç noktaları listesi.
   İki taraf da noktalar arasında doğrusal ara değer alır; böylece duyulan ile
   dışa aktarılan aynı. Kaynak dosyaya hiç yazılmaz (yıkıcı olmayan düzenleme). */
(function () {
  const root = typeof window !== 'undefined' ? window : null;
  const MIN_DB = -60;
  const MAX_DB = 12;
  const CURVES = ['linear', 'equal', 'exp'];
  const FADE_STEPS = 16; // geçiş eğrisi bu kadar doğrusal parçayla örneklenir
  const MAX_POINTS = 160; // ffmpeg ifadesi sınırlı kalsın
  const EXTS = ['mp3', 'wav', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac'];

  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let seq = 0;
  const newId = (p) => p + '-' + Date.now().toString(36) + '-' + (seq++).toString(36);

  function dbToGain(db) {
    const d = num(db, 0);
    return d <= MIN_DB ? 0 : Math.pow(10, d / 20);
  }

  function makeClip(c) {
    const s = c && typeof c === 'object' ? c : {};
    const dur = Math.max(0.01, num(s.dur, 1));
    const fadeIn = clamp(num(s.fadeIn, 0), 0, dur);
    return {
      id: typeof s.id === 'string' && s.id ? s.id : newId('ac'),
      src: typeof s.src === 'string' ? s.src : '',
      name: typeof s.name === 'string' ? s.name.slice(0, 120) : '',
      start: Math.max(0, num(s.start, 0)),
      in: Math.max(0, num(s.in, 0)),
      dur,
      srcDur: num(s.srcDur, 0) > 0 ? num(s.srcDur, 0) : 0,
      gain: clamp(num(s.gain, 0), MIN_DB, MAX_DB),
      fadeIn,
      fadeOut: clamp(num(s.fadeOut, 0), 0, dur - fadeIn),
      curve: CURVES.indexOf(s.curve) >= 0 ? s.curve : 'linear',
      mute: s.mute === true,
      color: typeof s.color === 'string' ? s.color.slice(0, 32) : '',
    };
  }

  function makeDuck(d) {
    if (!d || typeof d !== 'object' || typeof d.key !== 'string' || !d.key) return null;
    return {
      key: d.key,
      threshold: clamp(num(d.threshold, 0.1), 0.001, 1),
      amount: clamp(num(d.amount, -12), MIN_DB, 0),
      attack: clamp(num(d.attack, 0.05), 0.001, 5),
      release: clamp(num(d.release, 0.4), 0.001, 10),
      hold: clamp(num(d.hold, 0.1), 0, 10),
    };
  }

  function makeTrack(t) {
    const s = t && typeof t === 'object' ? t : {};
    const clips = (Array.isArray(s.clips) ? s.clips : []).map(makeClip).sort((a, b) => a.start - b.start);
    const volume = (Array.isArray(s.volume) ? s.volume : [])
      .filter((p) => p && Number.isFinite(Number(p.t)))
      .map((p) => ({ t: Math.max(0, Number(p.t)), db: clamp(num(p.db, 0), MIN_DB, MAX_DB) }))
      .sort((a, b) => a.t - b.t);
    return {
      id: typeof s.id === 'string' && s.id ? s.id : newId('at'),
      name: typeof s.name === 'string' && s.name ? s.name.slice(0, 80) : 'Ses',
      gain: clamp(num(s.gain, 0), MIN_DB, MAX_DB),
      pan: clamp(num(s.pan, 0), -1, 1),
      mute: s.mute === true,
      solo: s.solo === true,
      clips,
      volume,
      duck: makeDuck(s.duck),
    };
  }

  function normalize(list) {
    return (Array.isArray(list) ? list : []).map(makeTrack);
  }

  // Sessiz/solo kuralı görsel parçalarla aynı: solo varsa yalnız solo parçalar
  function audibleTracks(tracks) {
    const ts = normalize(tracks);
    const solo = ts.some((t) => t.solo && !t.mute);
    return ts.filter((t) => !t.mute && (!solo || t.solo));
  }

  function hasAudio(tracks) {
    return audibleTracks(tracks).some((t) => t.clips.some((c) => !c.mute && c.src));
  }

  function shape(curve, x) {
    const v = clamp(x, 0, 1);
    if (curve === 'equal') return Math.sin(v * Math.PI / 2);
    if (curve === 'exp') return v * v;
    return v;
  }

  // Klibin kendi kazancı (geçişler dahil); localT klibin başından saniye
  function clipGainAt(clip, localT) {
    const c = clip;
    let g = dbToGain(c.gain);
    if (c.fadeIn > 0 && localT < c.fadeIn) g *= shape(c.curve, localT / c.fadeIn);
    const outAt = c.dur - c.fadeOut;
    if (c.fadeOut > 0 && localT > outAt) g *= shape(c.curve, (c.dur - localT) / c.fadeOut);
    return g;
  }

  // Parça ses otomasyonu (dB noktaları, doğrusal); nokta yoksa 0 dB
  function automationDbAt(points, t) {
    const p = points || [];
    if (!p.length) return 0;
    if (t <= p[0].t) return p[0].db;
    for (let i = 1; i < p.length; i++) {
      if (t <= p[i].t) {
        const a = p[i - 1];
        const b = p[i];
        const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
        return a.db + (b.db - a.db) * k;
      }
    }
    return p[p.length - 1].db;
  }

  /* KISMA (ducking). Anahtar zarfı (0..1 tepe değerleri, `rate` Hz) eşiği aşınca
     hedef `amount` dB'e `attack` sürede iner, `hold` boyunca kalır, `release` sürede
     döner. Tek kutuplu, belirlenimci: çalma ve dışa aktarma aynı eğriyi alır.
     Dönen dizi: her zarf örneği için kazanç çarpanı (doğrusal). */
  function duckCurve(env, rate, duck) {
    const d = makeDuck(duck);
    const n = env ? env.length : 0;
    const out = new Array(n);
    if (!d || !n || !(rate > 0)) { for (let i = 0; i < n; i++) out[i] = 1; return out; }
    const dt = 1 / rate;
    const low = dbToGain(d.amount);
    const aK = 1 - Math.exp(-dt / Math.max(d.attack / 3, dt / 10));
    const rK = 1 - Math.exp(-dt / Math.max(d.release / 3, dt / 10));
    let g = 1;
    let held = 0;
    for (let i = 0; i < n; i++) {
      const over = env[i] >= d.threshold;
      if (over) held = d.hold;
      else held = Math.max(0, held - dt);
      const target = over || held > 0 ? low : 1;
      g += (target - g) * (target < g ? aK : rK);
      out[i] = g;
    }
    return out;
  }

  // Bir parçanın verilen anda çalan klip zarfı (tepe değeri): kısma anahtarı için
  function trackEnvelope(track, peaksOf, rate, length) {
    const n = Math.max(0, Math.ceil(length * rate));
    const env = new Float32Array(n);
    if (!track || track.mute) return env;
    for (const c of track.clips) {
      if (c.mute) continue;
      const pk = peaksOf ? peaksOf(c.src) : null;
      if (!pk || !pk.data || !(pk.rate > 0)) continue;
      const i0 = Math.max(0, Math.floor(c.start * rate));
      const i1 = Math.min(n, Math.ceil((c.start + c.dur) * rate));
      for (let i = i0; i < i1; i++) {
        const local = i / rate - c.start;
        const j = Math.floor((c.in + local) * pk.rate);
        const v = j >= 0 && j < pk.data.length ? pk.data[j] * clipGainAt(c, local) : 0;
        if (v > env[i]) env[i] = v;
      }
    }
    return env;
  }

  /* Noktaları en çok `max` taneye indirir (ilk ve son korunur). */
  function thin(points, max) {
    if (points.length <= max) return points;
    const out = [];
    const step = (points.length - 1) / (max - 1);
    for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
    return out;
  }

  /* KARIŞIM TANIMI. opts: { from, to, peaksOf(src) -> {rate, data}, envRate }.
     Dönen: { duration, sources: [{ trackId, clipId, src, at, offset, dur, pan, points }] }
     at: karışımın başından saniye; offset: kaynak dosyada başlangıç; points: [[t, kazanç]]
     t kaynağın bu parçasının başından saniye. */
  function mixDescription(tracks, opts) {
    const o = opts || {};
    const all = normalize(tracks);
    const audible = audibleTracks(all);
    const from = Math.max(0, num(o.from, 0));
    let end = 0;
    for (const t of audible) for (const c of t.clips) end = Math.max(end, c.start + c.dur);
    const to = o.to != null && Number(o.to) > from ? Number(o.to) : end;
    const envRate = num(o.envRate, 50);
    const duckOf = new Map();
    for (const t of audible) {
      if (!t.duck) continue;
      const key = all.find((x) => x.id === t.duck.key && x.id !== t.id);
      if (!key) continue;
      const env = trackEnvelope(key, o.peaksOf, envRate, Math.max(end, to));
      duckOf.set(t.id, duckCurve(env, envRate, t.duck));
    }
    const sources = [];
    for (const t of audible) {
      const tg = dbToGain(t.gain);
      const duck = duckOf.get(t.id) || null;
      for (const c of t.clips) {
        if (c.mute || !c.src) continue;
        const s0 = Math.max(c.start, from);
        const s1 = Math.min(c.start + c.dur, to);
        if (s1 - s0 <= 1e-6) continue;
        // Örnek noktalar: sınırlar, geçiş eğrisi, otomasyon noktaları, kısma örnekleri
        const ts = new Set([s0, s1]);
        const addFade = (a, len) => { for (let k = 0; k <= FADE_STEPS; k++) ts.add(a + len * k / FADE_STEPS); };
        if (c.fadeIn > 0) addFade(c.start, c.fadeIn);
        if (c.fadeOut > 0) addFade(c.start + c.dur - c.fadeOut, c.fadeOut);
        // Otomasyon dB'de doğrusal: kazanç noktaları arası doğrusal olduğundan parça başına 8 ara örnek
        for (let k = 0; k < t.volume.length; k++) {
          ts.add(t.volume[k].t);
          const nx = t.volume[k + 1];
          if (nx && nx.t > t.volume[k].t && nx.db !== t.volume[k].db) {
            for (let q = 1; q < 8; q++) ts.add(t.volume[k].t + (nx.t - t.volume[k].t) * q / 8);
          }
        }
        if (duck) { for (let i = Math.floor(s0 * envRate); i <= Math.ceil(s1 * envRate); i += 2) ts.add(i / envRate); }
        const list = Array.from(ts).filter((x) => x >= s0 - 1e-9 && x <= s1 + 1e-9).sort((a, b) => a - b);
        let points = list.map((x) => {
          let g = tg * clipGainAt(c, x - c.start) * dbToGain(automationDbAt(t.volume, x));
          if (duck) { const i = Math.min(duck.length - 1, Math.max(0, Math.round(x * envRate))); g *= duck.length ? duck[i] : 1; }
          return [Math.round((x - s0) * 1e6) / 1e6, Math.round(g * 1e6) / 1e6];
        });
        points = thin(points, MAX_POINTS);
        sources.push({
          trackId: t.id, clipId: c.id, src: c.src,
          at: Math.round((s0 - from) * 1e6) / 1e6,
          offset: Math.round((c.in + (s0 - c.start)) * 1e6) / 1e6,
          dur: Math.round((s1 - s0) * 1e6) / 1e6,
          pan: t.pan,
          points,
        });
      }
    }
    return { duration: Math.max(0, to - from), sources };
  }

  // Noktalar arasında doğrusal kazanç (çalma bunu, ffmpeg ifadesi aynısını kullanır)
  function gainAtPoints(points, t) {
    const p = points || [];
    if (!p.length) return 1;
    if (t <= p[0][0]) return p[0][1];
    for (let i = 1; i < p.length; i++) {
      if (t <= p[i][0]) {
        const a = p[i - 1];
        const b = p[i];
        return b[0] > a[0] ? a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]) : b[1];
      }
    }
    return p[p.length - 1][1];
  }

  // Denge (pan): sol/sağ kazanç; ortada ikisi de 1 (çalma ve dışa aktarma aynı)
  function panGains(pan) {
    const p = clamp(num(pan, 0), -1, 1);
    return [p > 0 ? 1 - p : 1, p < 0 ? 1 + p : 1];
  }

  /* ffmpeg karışımı: her kaynak bir giriş; atrim + volume ifadesi + denge + gecikme,
     sonra amix (normalize=0: kazançlar olduğu gibi toplanır). */
  function ffmpegFilter(desc, inputIndexOf) {
    const parts = [];
    const labels = [];
    desc.sources.forEach((s, i) => {
      const idx = inputIndexOf(s.src);
      const expr = volumeExpr(s.points);
      const [l, r] = panGains(s.pan);
      const delay = Math.max(0, Math.round(s.at * 1000));
      parts.push('[' + idx + ':a]atrim=start=' + s.offset.toFixed(6) + ':duration=' + s.dur.toFixed(6) +
        ',asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo' +
        // Küçük kareler: kazanç kare başına hesaplanır, 64 örnek (~1,3 ms) gecikmeyi önler
        ',asetnsamples=n=64:p=0' +
        ",volume='" + expr + "':eval=frame" +
        (l !== 1 || r !== 1 ? ',pan=stereo|c0=' + l.toFixed(4) + '*c0|c1=' + r.toFixed(4) + '*c1' : '') +
        ',adelay=' + delay + '|' + delay + '[s' + i + ']');
      labels.push('[s' + i + ']');
    });
    if (!labels.length) return '';
    return parts.join(';') + ';' + labels.join('') + 'amix=inputs=' + labels.length + ':normalize=0:dropout_transition=0,apad,atrim=duration=' + desc.duration.toFixed(6) + '[mix]';
  }
  /* Düz toplam (iç içe if yerine): ffmpeg ifade ayrıştırıcısı derin iç içe geçmeyi
     reddeder. Her parça yalnız kendi [a, b) aralığında katkı verir. */
  function volumeExpr(points) {
    const p = points && points.length ? points : [[0, 1]];
    const f = (x) => (Math.round(x * 1e6) / 1e6).toString();
    const terms = ['lt(t,' + f(p[0][0]) + ')*' + f(p[0][1])];
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1];
      const b = p[i];
      if (!(b[0] > a[0])) continue;
      const dv = b[1] - a[1];
      terms.push('gte(t,' + f(a[0]) + ')*lt(t,' + f(b[0]) + ')*(' + f(a[1]) + (dv ? '+(' + f(dv) + ')*(t-' + f(a[0]) + ')/' + f(b[0] - a[0]) : '') + ')');
    }
    terms.push('gte(t,' + f(p[p.length - 1][0]) + ')*' + f(p[p.length - 1][1]));
    return terms.join('+');
  }

  // ---- Düzenleme (#1173): yeni nesne döner, kaynağa dokunmaz ----
  function splitClip(clip, t) {
    const c = makeClip(clip);
    const cut = t - c.start;
    if (cut <= 0.01 || cut >= c.dur - 0.01) return null;
    const a = makeClip(Object.assign({}, c, { dur: cut, fadeOut: 0 }));
    const b = makeClip(Object.assign({}, c, { id: newId('ac'), start: t, in: c.in + cut, dur: c.dur - cut, fadeIn: 0 }));
    a.fadeIn = Math.min(c.fadeIn, a.dur);
    b.fadeOut = Math.min(c.fadeOut, b.dur);
    return [a, b];
  }
  function canJoin(a, b) {
    if (!a || !b || a.src !== b.src) return false;
    return Math.abs(a.start + a.dur - b.start) < 0.002 && Math.abs(a.in + a.dur - b.in) < 0.002;
  }
  function joinClips(a, b) {
    if (!canJoin(a, b)) return null;
    return makeClip(Object.assign({}, a, { dur: a.dur + b.dur, fadeOut: b.fadeOut }));
  }
  // Sol kenar: başlangıç ve kaynak giriş noktası birlikte kayar (sağ kenar yerinde)
  function trimStart(clip, newStart) {
    const c = makeClip(clip);
    const endT = c.start + c.dur;
    let s = Math.min(newStart, endT - 0.05);
    s = Math.max(s, c.start - c.in); // kaynağın başından öteye gidilmez
    s = Math.max(0, s);
    const d = s - c.start;
    return makeClip(Object.assign({}, c, { start: s, in: c.in + d, dur: endT - s }));
  }
  function trimEnd(clip, newEnd) {
    const c = makeClip(clip);
    let e = Math.max(newEnd, c.start + 0.05);
    if (c.srcDur > 0) e = Math.min(e, c.start + (c.srcDur - c.in));
    return makeClip(Object.assign({}, c, { dur: e - c.start }));
  }
  function audioLength(tracks) {
    let end = 0;
    for (const t of normalize(tracks)) for (const c of t.clips) end = Math.max(end, c.start + c.dur);
    return end;
  }
  function isAudioFile(name) {
    const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return !!m && EXTS.indexOf(m[1].toLowerCase()) >= 0;
  }

  const api = {
    MIN_DB, MAX_DB, CURVES, EXTS, FADE_STEPS,
    dbToGain, makeClip, makeTrack, makeDuck, normalize, audibleTracks, hasAudio,
    shape, clipGainAt, automationDbAt, duckCurve, trackEnvelope, mixDescription, gainAtPoints,
    panGains, ffmpegFilter, volumeExpr, splitClip, canJoin, joinClips, trimStart, trimEnd,
    audioLength, isAudioFile, newId,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SVTimelineAudioCore = api;
})();
