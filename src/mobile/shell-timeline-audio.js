/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TELEFONDA ÇİZELGE SES ŞERİTLERİ (#1172, Android).

   Masaüstündeki ses şeritlerinin (src/admin/timeline-audio.js) telefon karşılığı; model ortak
   (src/shared/timeline-audio.js, SVTimelineAudioCore): klipler, kazanç, geçişler, sessiz/solo
   kuralı ve karışım tanımı (mixDescription) masaüstüyle aynı, yalnız çalma ve çizim burada.

   - Ses dosyası telefondan seçilir (belge seçici); uygulama onu medya klasörüne kopyalar ve
     sayfa `/files/<ad>` adresinden okur (timelineAudioImport). Klibin kaynağı bu adres.
   - Dalga biçimi Web Audio ile çözülen sesten (saniyede 100 tepe).
   - Çalma çizelgenin saatini izler: oynarken kaynaklar AudioContext'e kurulur, kafa 120 ms'den
     çok kayarsa (atlama, döngü sarması, düzenleme) yeniden kurulur. PC hedefinde çalmaz.
   - Dışa aktarma karışımı OfflineAudioContext ile (44,1 kHz stereo WAV), medya klasörüne
     parça parça yazılır (mediaAppend); uygulama onu videonun sesi olarak kullanır.
   - Bilgisayardan gelen projelerde kaynak bilgisayardaki bir yoldur (telefonda yok): bu klipler
     "bulunamadı" görünür ve her biri için "Yeniden bağla" çıkar; seçilen dosya aynı kaynağı
     kullanan bütün kliplere bağlanır. Dışa aktarma bunlar yüzünden düşmez, önce bağlanmalarını ister. */
(function () {
  if (typeof window === 'undefined') return;
  const TA = () => window.SVTimelineAudioCore;
  const A = () => window.SVAndroid;
  const T = () => window.SVShellTimeline;
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
  const ROW_H = 44;
  const PEAK_RATE = 100;
  const MIX_RATE = 44100;
  const MIX_NAME = 'tla-mix-export.wav';
  const SLOP = 8;
  const EDGE = 16;

  // ==========================================================================
  // Kaynaklar: çözülen ses, dalga biçimi, ulaşılabilirlik
  // ==========================================================================
  const bufs = new Map(); // src → { state: 'loading'|'ok'|'missing', buf, peaks, p }
  const subs = new Set();
  function changed() { for (const f of subs) { try { f(); } catch (e) { /* dinleyici hatası */ } } }
  let ac = null;
  function actx() {
    if (!ac) { const C = window.AudioContext || window.webkitAudioContext; ac = C ? new C() : null; }
    return ac;
  }
  /* Telefonda yalnız uygulamanın medya klasörü okunur; bilgisayar yolu (C:\…, /Users/…) ulaşılamaz */
  const reachable = (src) => typeof src === 'string' && src.indexOf('/files/') === 0 && src.indexOf('..') < 0;
  function decode(ab) {
    const c = actx();
    if (!c) return Promise.reject(new Error('no-audio'));
    return new Promise((res, rej) => { const p = c.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
  }
  function peaksOf(buf) {
    const n = Math.max(1, Math.ceil(buf.duration * PEAK_RATE));
    const data = new Float32Array(n);
    const block = buf.sampleRate / PEAK_RATE;
    const step = Math.max(1, Math.floor(block / 48));
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        let m = data[i];
        const a = Math.floor(i * block);
        const b = Math.min(d.length, Math.floor((i + 1) * block));
        for (let j = a; j < b; j += step) { const v = d[j] < 0 ? -d[j] : d[j]; if (v > m) m = v; }
        data[i] = m;
      }
    }
    return { rate: PEAK_RATE, data };
  }
  function load(src) {
    let e = bufs.get(src);
    if (e) return e.p;
    e = { state: 'loading', buf: null, peaks: null, p: null };
    bufs.set(src, e);
    const got = reachable(src)
      ? fetch(src).then((r) => { if (!r.ok) throw new Error('http ' + r.status); return r.arrayBuffer(); }).then(decode)
      : Promise.reject(new Error('unreachable'));
    e.p = got.then((buf) => { e.buf = buf; e.peaks = peaksOf(buf); e.state = 'ok'; changed(); return buf; },
      () => { e.state = 'missing'; changed(); return null; });
    return e.p;
  }
  function status(src) { if (!bufs.has(src)) load(src); return bufs.get(src).state; }
  const peaksFor = (src) => { const e = bufs.get(src); return e && e.peaks ? e.peaks : null; };
  const listOf = (tracks) => (TA() ? TA().normalize(tracks) : []);
  /* Bulunamayan kaynaklar (kaynak başına bir satır; o kaynağı kullanan klip sayısı ve adı) */
  function missing(tracks) {
    const out = new Map();
    for (const t of listOf(tracks)) for (const c of t.clips) {
      if (!c.src || status(c.src) !== 'missing') continue;
      const m = out.get(c.src) || { src: c.src, name: c.name || baseName(c.src), clips: 0 };
      m.clips++;
      out.set(c.src, m);
    }
    return Array.from(out.values());
  }
  /* Bütün kaynaklar yüklenince (ya da bulunamayınca) çözülür */
  function check(tracks) {
    const srcs = new Set();
    for (const t of listOf(tracks)) for (const c of t.clips) if (c.src) srcs.add(c.src);
    return Promise.all(Array.from(srcs).map(load)).then(() => missing(tracks));
  }
  function baseName(p) { return String(p || '').split(/[\\/]/).pop() || String(p || ''); }

  /* Telefondan ses dosyası: seçilir, medya klasörüne kopyalanır, çözülür. Döner: { src, name, srcDur } */
  function importAudio() {
    return A().media.pick('audio').then((r) => A().timelineAudio.import(r.uri)).then((f) => {
      bufs.delete(f.url);
      return load(f.url).then((buf) => {
        if (!buf) throw new Error(tr('Ses dosyası çözülemedi.'));
        return { src: f.url, name: String(f.name || baseName(f.url)), srcDur: buf.duration };
      });
    });
  }
  /* Yeniden bağla: seçilen dosya `src`'yi kullanan bütün kliplere */
  function relink(src) {
    return importAudio().then((f) => {
      T().writeAudio((list) => {
        for (const t of list) for (const c of t.clips) {
          if (c.src !== src) continue;
          c.src = f.src;
          if (f.srcDur > 0) c.srcDur = f.srcDur;
          if (!c.name) c.name = f.name;
        }
      });
      return f;
    });
  }

  // ==========================================================================
  // Çalma: mixDescription'daki kaynaklar Web Audio'ya (canlı ve çevrimdışı aynı)
  // ==========================================================================
  function schedule(c, buf, s, at0) {
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    // Tek kanallı ses iki kanala açılır (denge sol/sağ kazançla)
    g.channelCount = 2;
    g.channelCountMode = 'explicit';
    g.channelInterpretation = 'speakers';
    const when = at0 + s.at;
    const pts = s.points || [];
    g.gain.setValueAtTime(pts.length ? pts[0][1] : 1, when);
    for (const p of pts) g.gain.linearRampToValueAtTime(p[1], when + p[0]);
    src.connect(g);
    let out = g;
    if (s.pan) {
      // Masaüstündeki panGains (ffmpeg'deki pan süzgeciyle aynı doğrusal kural)
      const lr = TA().panGains(s.pan);
      const sp = c.createChannelSplitter(2);
      const mg = c.createChannelMerger(2);
      const gl = c.createGain();
      const gr = c.createGain();
      gl.gain.value = lr[0];
      gr.gain.value = lr[1];
      g.connect(sp);
      sp.connect(gl, 0);
      sp.connect(gr, 1);
      gl.connect(mg, 0, 0);
      gr.connect(mg, 0, 1);
      out = mg;
    }
    out.connect(c.destination);
    src.start(Math.max(when, c.currentTime || 0), s.offset, s.dur);
    return src;
  }

  const live = { nodes: [], key: null, t: 0, at: 0, loaded: -1 };
  function liveStop() {
    for (const n of live.nodes) { try { n.stop(); } catch (e) { /* bitmiş */ } try { n.disconnect(); } catch (e) { /* bağsız */ } }
    live.nodes = [];
    live.key = null;
  }
  function liveStart(tracks, t, key) {
    liveStop();
    const c = actx();
    if (!c || !TA()) return;
    if (c.state === 'suspended' && c.resume) c.resume();
    const at0 = c.currentTime + 0.05;
    const d = TA().mixDescription(tracks, { from: t, peaksOf: peaksFor });
    for (const s of d.sources) {
      const e = bufs.get(s.src);
      if (!e || !e.buf) { load(s.src); continue; }
      live.nodes.push(schedule(c, e.buf, s, at0));
    }
    live.key = key;
    live.t = t;
    live.at = at0;
  }
  let loaded = 0; // yüklenen kaynak sayısı değişince canlı çalma yeniden kurulur
  subs.add(() => { loaded++; });
  function liveTick() {
    const tl = T();
    const st = tl && tl.audioState ? tl.audioState() : null;
    if (!st || !st.playing || st.pc || !st.tracks || !st.tracks.length || preview.on) { if (live.key !== null) liveStop(); return; }
    const key = st.ref;
    const c = actx();
    const exp = live.key !== null && c ? live.t + (c.currentTime - live.at) : -1;
    if (live.key === null || key !== live.key || live.loaded !== loaded || Math.abs(exp - st.time) > 0.12) {
      liveStart(st.tracks, st.time, key);
      live.loaded = loaded;
    }
  }
  if (typeof setInterval === 'function') setInterval(liveTick, 100);

  // ==========================================================================
  // Karışım: çevrimdışı çizim, WAV ve medya klasörüne yazma
  // ==========================================================================
  /* opts: { from, to }. Bulunamayan kaynak varsa hata (missing: [src]) */
  function renderMix(tracks, opts) {
    const o = opts || {};
    const d = TA().mixDescription(tracks, { from: o.from || 0, to: o.to, peaksOf: peaksFor });
    const srcs = Array.from(new Set(d.sources.map((s) => s.src)));
    return Promise.all(srcs.map(load)).then(() => {
      const miss = srcs.filter((s) => !(bufs.get(s) || {}).buf);
      if (miss.length) { const e = new Error('missing'); e.missing = miss; throw e; }
      const C = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!C) throw new Error('no-offline-audio');
      const oc = new C(2, Math.max(1, Math.ceil(d.duration * MIX_RATE)), MIX_RATE);
      for (const s of d.sources) schedule(oc, bufs.get(s.src).buf, s, 0);
      return oc.startRendering();
    });
  }
  /* 16 bit PCM WAV (kanal sayısı ve örnek hızı tampondan) */
  function encodeWav(buf) {
    const ch = Math.max(1, buf.numberOfChannels);
    const n = buf.length;
    const out = new Uint8Array(44 + n * ch * 2);
    const v = new DataView(out.buffer);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * ch * 2, true);
    const data = [];
    for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
    let o = 44;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < ch; c++) {
        const s = Math.max(-1, Math.min(1, data[c][i]));
        v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        o += 2;
      }
    }
    return out;
  }
  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  /* WAV medya klasörüne (köprü iletisi sınırlı: 768 KB'lık parçalar). Döner: dosya adı */
  function writeMix(bytes, name) {
    const file = name || MIX_NAME;
    const CH = 768 * 1024;
    let p = Promise.resolve();
    for (let i = 0; i < Math.max(1, bytes.length); i += CH) {
      const part = bytes.subarray(i, i + CH);
      const first = i === 0;
      p = p.then(() => A().timelineAudio.write(file, b64(part), first));
    }
    return p.then(() => file);
  }

  /* Karışımı dinle (dışa aktarma sayfası): çevrimdışı karışım çalınır; ikinci dokunuş durdurur */
  const preview = { on: false, node: null, busy: false };
  function previewStop() {
    if (preview.node) { try { preview.node.stop(); } catch (e) { /* bitmiş */ } }
    preview.node = null;
    preview.on = false;
    changed();
  }
  function previewToggle(tracks, opts) {
    if (preview.on || preview.busy) { previewStop(); return Promise.resolve(false); }
    preview.busy = true;
    changed();
    return renderMix(tracks, opts).then((buf) => {
      preview.busy = false;
      const c = actx();
      if (c.state === 'suspended' && c.resume) c.resume();
      const n = c.createBufferSource();
      n.buffer = buf;
      n.connect(c.destination);
      n.onended = () => { if (preview.node === n) previewStop(); };
      liveStop();
      n.start();
      preview.node = n;
      preview.on = true;
      changed();
      return true;
    }, (e) => { preview.busy = false; changed(); throw e; });
  }

  // ==========================================================================
  // Şerit: çizelgenin altında ses parçaları (dokunmayla seç, taşı, kırp)
  // ==========================================================================
  function strip(host, api) {
    const S = window.SVShell;
    const U = window.SVShellUI;
    const { h, icon } = S;
    const heads = h('div', { class: 'tl-aheads' });
    const canvas = h('canvas', { class: 'tl-acanvas' });
    const canHost = h('div', { class: 'tl-acanvas-host' }, [canvas]);
    const rows = h('div', { class: 'tl-arows' }, [heads, canHost]);
    const bar = h('div', { class: 'tl-abar' });
    const lost = h('div', { class: 'tl-amissing' });
    const panel = h('div', { class: 'tl-apanel' });
    host.replaceChildren(rows, lost, bar, panel);
    const g = canvas.getContext('2d');
    let sel = null; // { kind: 'clip'|'track', trackId, clipId }
    let drag = null;
    let sig = '';
    let colors = null;
    let w = 0;
    const tracks = () => listOf(api.tracks());
    const lane = () => api.lane();
    const x = (t) => (lane() ? lane().xOf(t) : t * 24);
    const zoom = () => (lane() ? lane().zoom() : 24);

    function readColors() {
      const cs = getComputedStyle(host);
      const v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
      colors = { bg: v('--card', '#1b1b1f'), line: v('--line', '#333'), clip: v('--accent', '#6c8cff'), text: v('--text', '#fff'), dim: v('--muted', '#999'), danger: v('--danger', '#e5484d') };
    }
    function size() {
      const list = tracks();
      const hgt = Math.max(1, list.length) * ROW_H;
      const dpr = window.devicePixelRatio || 1;
      w = canHost.clientWidth || 300;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hgt * dpr);
      canvas.style.height = hgt + 'px';
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function findClip(list, s) {
      if (!s) return null;
      const t = list.find((k) => k.id === s.trackId);
      const c = t && s.clipId ? t.clips.find((k) => k.id === s.clipId) : null;
      return { t, c };
    }
    function paint() {
      if (!canvas.isConnected) return;
      if (!colors) readColors();
      const list = tracks();
      const s = JSON.stringify(list.map((t) => [t.id, t.name, t.mute, t.solo, t.locked])) + '|' + (api.wide() ? 1 : 0);
      if (s !== sig) { sig = s; paintHeads(list); }
      if (canvas.width !== Math.round((canHost.clientWidth || 300) * (window.devicePixelRatio || 1)) || canvas.style.height !== Math.max(1, list.length) * ROW_H + 'px') size();
      g.clearRect(0, 0, w, Math.max(1, list.length) * ROW_H);
      const audible = new Set(TA().audibleTracks(list).map((t) => t.id));
      list.forEach((t, ti) => {
        const y = ti * ROW_H;
        g.fillStyle = colors.bg;
        g.fillRect(0, y, w, ROW_H);
        g.strokeStyle = colors.line;
        g.beginPath(); g.moveTo(0, y + ROW_H - 0.5); g.lineTo(w, y + ROW_H - 0.5); g.stroke();
        for (const c0 of t.clips) {
          const c = drag && drag.moved && drag.clipId === c0.id ? drag.preview : c0;
          const x0 = x(c.start);
          const x1 = x(c.start + c.dur);
          if (x1 < 0 || x0 > w) continue;
          const st = api.pc() ? 'ok' : c.src ? status(c.src) : 'missing';
          const dim = !audible.has(t.id) || c.mute;
          g.globalAlpha = dim ? 0.4 : 1;
          g.fillStyle = st === 'missing' ? colors.danger : colors.clip;
          g.globalAlpha *= 0.35;
          g.fillRect(x0, y + 3, Math.max(2, x1 - x0), ROW_H - 6);
          g.globalAlpha = dim ? 0.4 : 1;
          // Dalga biçimi (kırpılmış kaynak aralığı, klip kazancı ve geçişlerle)
          const pk = peaksFor(c.src);
          if (pk) {
            g.fillStyle = colors.text;
            const mid = y + ROW_H / 2;
            const a = Math.max(0, Math.floor(x0));
            const b = Math.min(w, Math.ceil(x1));
            for (let px = a; px < b; px += 2) {
              const local = (px - x0) / zoom();
              const j = Math.floor((c.in + local) * pk.rate);
              const v = j >= 0 && j < pk.data.length ? Math.min(1, pk.data[j] * TA().clipGainAt(c, local)) : 0;
              const hh = Math.max(0.5, v * (ROW_H / 2 - 6));
              g.fillRect(px, mid - hh, 1.5, hh * 2);
            }
          }
          // Geçişler
          g.strokeStyle = colors.text;
          g.beginPath();
          if (c.fadeIn > 0) { g.moveTo(x0, y + ROW_H - 4); g.lineTo(x(c.start + c.fadeIn), y + 4); }
          if (c.fadeOut > 0) { g.moveTo(x(c.start + c.dur - c.fadeOut), y + 4); g.lineTo(x1, y + ROW_H - 4); }
          g.stroke();
          g.fillStyle = st === 'missing' ? colors.danger : colors.text;
          g.font = '11px sans-serif';
          const label = (st === 'missing' ? '! ' : '') + (c.name || baseName(c.src));
          g.save(); g.beginPath(); g.rect(x0, y, Math.max(0, x1 - x0), ROW_H); g.clip();
          g.fillText(label, Math.max(x0, 0) + 4, y + 14);
          g.restore();
          const isSel = sel && sel.kind === 'clip' && sel.clipId === c.id;
          if (isSel) { g.strokeStyle = colors.text; g.lineWidth = 2; g.strokeRect(x0 + 1, y + 2, Math.max(2, x1 - x0) - 2, ROW_H - 4); g.lineWidth = 1; }
          g.globalAlpha = 1;
        }
        if (sel && sel.kind === 'track' && sel.trackId === t.id) { g.strokeStyle = colors.clip; g.lineWidth = 2; g.strokeRect(1, y + 1, w - 2, ROW_H - 2); g.lineWidth = 1; }
      });
      // Oynatma kafası (çizelgeyle aynı x)
      const hx = x(api.head());
      g.fillStyle = colors.danger;
      g.fillRect(Math.round(hx) - 1, 0, 2, Math.max(1, list.length) * ROW_H);
      paintMissing(list);
    }
    let raf = 0;
    function draw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); }

    function paintHeads(list) {
      heads.textContent = '';
      for (const t of list) {
        const mk = (k, label) => h('button', {
          class: 'tl-amini' + (t[k] ? ' on' : ''), 'aria-pressed': String(!!t[k]), 'aria-label': tr(label === 'M' ? 'Sessiz' : 'Solo'), title: tr(label === 'M' ? 'Sessiz' : 'Solo'),
          onclick: () => api.write((l) => { const x2 = l.find((k2) => k2.id === t.id); if (x2) x2[k] = !x2[k]; }),
        }, [h('span', { text: label })]);
        heads.appendChild(h('div', { class: 'tl-ahead' + (sel && sel.trackId === t.id && sel.kind === 'track' ? ' sel' : '') }, [
          h('button', { class: 'tl-aname', 'data-user-text': '', text: t.name, onclick: () => select({ kind: 'track', trackId: t.id }) }),
          mk('mute', 'M'), mk('solo', 'S'),
        ]));
      }
      if (!list.length) heads.appendChild(h('div', { class: 'tl-ahead empty' }));
      paintBar(list);
    }
    function paintBar(list) {
      bar.textContent = '';
      // PC hedefi: çizelge bilgisayarın; ses dosyaları orada (yalnız görüntülenir)
      if (api.pc()) { bar.appendChild(h('span', { class: 'row-sub', text: 'Ses şeritleri bilgisayarda düzenlenir ve çalar.' })); return; }
      bar.appendChild(h('button', { class: 'btn small', onclick: addAudio }, [icon('music'), h('span', { text: 'Ses ekle' })]));
      bar.appendChild(h('button', { class: 'btn small plain', onclick: () => api.write((l) => { l.push(TA().makeTrack({ name: tr('Ses') + ' ' + (l.length + 1) })); }) }, [icon('plus'), h('span', { text: 'Ses şeridi' })]));
      if (!list.length) bar.appendChild(h('span', { class: 'row-sub', text: 'Çizelgeye müzik ya da efekt ekleyin; dışa aktarmada karıştırılır.' }));
    }
    let lostSig = '';
    function paintMissing(list) {
      const m = api.pc() ? [] : missing(list);
      const s = m.map((k) => k.src + k.clips).join('|');
      if (s === lostSig) return;
      lostSig = s;
      lost.textContent = '';
      for (const k of m) {
        lost.appendChild(h('div', { class: 'banner warn tl-alost' }, [
          icon('warning'),
          h('div', { class: 'grow-text' }, [h('div', { 'data-user-text': '', text: k.name }), h('div', { class: 'row-sub', text: tr('Ses dosyası bu telefonda bulunamadı') + ' · ' + k.clips + ' ' + tr('klip') })]),
          h('button', { class: 'btn small', onclick: () => relink(k.src).catch(fail) }, [h('span', { text: 'Yeniden bağla' })]),
        ]));
      }
    }
    function fail(e) {
      const c = String((e && e.message) || e);
      if (c !== 'cancelled' && S.toast) S.toast(tr('Ses eklenemedi.') + ' (' + c + ')');
    }
    function addAudio() {
      importAudio().then((f) => {
        const at = Math.max(0, api.head());
        let pick = null;
        api.write((l) => {
          let t = sel && l.find((k) => k.id === sel.trackId && !k.locked);
          // Seçili şerit yoksa kafada boş olan ilk şerit, o da yoksa yeni şerit
          if (!t) t = l.find((k) => !k.locked && !k.clips.some((c) => c.start < at + f.srcDur && c.start + c.dur > at));
          if (!t) { t = TA().makeTrack({ name: tr('Ses') + ' ' + (l.length + 1) }); l.push(t); }
          const c = TA().makeClip({ src: f.src, name: f.name, start: at, dur: f.srcDur, srcDur: f.srcDur });
          t.clips.push(c);
          t.clips.sort((a, b) => a.start - b.start);
          pick = { kind: 'clip', trackId: t.id, clipId: c.id };
        });
        if (pick) select(pick);
      }).catch(fail);
    }

    function select(s) { sel = s; sig = ''; paintPanel(); draw(); }
    function paintPanel() {
      panel.textContent = '';
      const list = tracks();
      const f = findClip(list, sel);
      if (!f || !f.t || (sel.kind === 'clip' && !f.c) || api.pc()) { panel.hidden = true; return; }
      panel.hidden = false;
      const up = (fn) => api.write((l) => { const g2 = findClip(l, sel); if (g2 && g2.t) fn(g2.t, g2.c); });
      const close = h('button', { class: 'iconbtn plain', 'aria-label': tr('Kapat'), title: tr('Kapat'), onclick: () => select(null) }, [icon('x')]);
      if (sel.kind === 'clip') {
        const c = f.c;
        const st = status(c.src);
        panel.append(
          h('div', { class: 'tl-apanel-head' }, [h('div', { class: 'row-title small grow-text', 'data-user-text': '', text: c.name || baseName(c.src) }), close]),
          U.slider({ label: 'Kazanç (dB)', min: -24, max: 12, step: 0.5, value: c.gain, def: 0, onChange: (v) => up((t, k) => { k.gain = v; }) }),
          U.slider({ label: 'Giriş geçişi (sn)', min: 0, max: Math.max(0.1, Math.min(10, c.dur)), step: 0.1, value: c.fadeIn, def: 0, onChange: (v) => up((t, k) => { k.fadeIn = Math.min(v, k.dur - k.fadeOut); }) }),
          U.slider({ label: 'Çıkış geçişi (sn)', min: 0, max: Math.max(0.1, Math.min(10, c.dur)), step: 0.1, value: c.fadeOut, def: 0, onChange: (v) => up((t, k) => { k.fadeOut = Math.min(v, k.dur - k.fadeIn); }) }),
          U.toggle({ label: 'Klibi sustur', value: c.mute, onChange: (v) => up((t, k) => { k.mute = !!v; }) }),
          h('div', { class: 'btn-row' }, [
            h('button', { class: 'btn small', onclick: () => splitAtHead() }, [h('span', { text: 'Kafada böl' })]),
            st === 'missing' ? h('button', { class: 'btn small', onclick: () => relink(c.src).catch(fail) }, [h('span', { text: 'Yeniden bağla' })]) : null,
            h('button', { class: 'btn small danger', onclick: () => { up((t, k) => { t.clips = t.clips.filter((x2) => x2.id !== k.id); }); select(null); } }, [h('span', { text: 'Sil' })]),
          ]),
        );
      } else {
        const t = f.t;
        panel.append(
          h('div', { class: 'tl-apanel-head' }, [h('div', { class: 'row-title small grow-text', 'data-user-text': '', text: t.name }), close]),
          U.slider({ label: 'Ses düzeyi (dB)', min: -24, max: 12, step: 0.5, value: t.gain, def: 0, onChange: (v) => up((k) => { k.gain = v; }) }),
          U.slider({ label: 'Denge', min: -1, max: 1, step: 0.05, value: t.pan, def: 0, onChange: (v) => up((k) => { k.pan = v; }) }),
          U.toggle({ label: 'Sessiz', value: t.mute, onChange: (v) => up((k) => { k.mute = !!v; }) }),
          U.toggle({ label: 'Solo', value: t.solo, onChange: (v) => up((k) => { k.solo = !!v; }) }),
          h('div', { class: 'btn-row' }, [
            h('button', { class: 'btn small danger', onclick: () => { api.write((l) => { const i = l.findIndex((k) => k.id === t.id); if (i >= 0) l.splice(i, 1); }); select(null); } }, [h('span', { text: 'Şeridi sil' })]),
          ]),
        );
      }
    }
    function splitAtHead() {
      const at = api.head();
      api.write((l) => {
        const f = findClip(l, sel);
        if (!f || !f.c || f.t.locked) return;
        const parts = TA().splitClip(f.c, at);
        if (!parts) return;
        const i = f.t.clips.findIndex((k) => k.id === f.c.id);
        f.t.clips.splice(i, 1, parts[0], parts[1]);
      });
    }

    // Dokunma: dokun seç, sürükle taşı, seçili klibin kenarından kırp; boş yere dokunmak kafayı taşır
    function pos(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function hit(p) {
      const list = tracks();
      const ti = Math.floor(p.y / ROW_H);
      const t = list[ti];
      if (!t) return null;
      for (let i = t.clips.length - 1; i >= 0; i--) {
        const c = t.clips[i];
        const x0 = x(c.start);
        const x1 = x(c.start + c.dur);
        const selNow = sel && sel.kind === 'clip' && sel.clipId === c.id;
        const pad = selNow ? EDGE / 2 : 0;
        if (p.x >= x0 - pad && p.x <= x1 + pad) {
          let edge = '';
          if (selNow && Math.abs(p.x - x0) <= EDGE) edge = 'l';
          else if (selNow && Math.abs(p.x - x1) <= EDGE) edge = 'r';
          return { t, c, edge };
        }
      }
      return { t, c: null, edge: '' };
    }
    canvas.addEventListener('pointerdown', (e) => {
      const p = pos(e);
      const ht = hit(p);
      drag = { id: e.pointerId, p0: p, ht, moved: false, clipId: ht && ht.c ? ht.c.id : null, preview: null };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* eski WebView */ }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const p = pos(e);
      const dx = p.x - drag.p0.x;
      if (!drag.moved) {
        if (Math.abs(dx) < SLOP) return;
        if (!drag.ht || !drag.ht.c || drag.ht.t.locked || api.pc() || Math.abs(p.y - drag.p0.y) > Math.abs(dx)) { drag = null; return; }
        drag.moved = true;
        if (!(sel && sel.clipId === drag.ht.c.id)) { sel = { kind: 'clip', trackId: drag.ht.t.id, clipId: drag.ht.c.id }; paintPanel(); }
      }
      const c = drag.ht.c;
      const dt = dx / zoom();
      if (drag.ht.edge === 'l') drag.preview = TA().trimStart(c, c.start + dt);
      else if (drag.ht.edge === 'r') drag.preview = TA().trimEnd(c, c.start + c.dur + dt);
      else {
        let s = Math.max(0, c.start + dt);
        // Kafaya mıknatıs (10 px)
        const hd = api.head();
        if (Math.abs(x(s) - x(hd)) < 10) s = hd;
        else if (Math.abs(x(s + c.dur) - x(hd)) < 10) s = Math.max(0, hd - c.dur);
        drag.preview = TA().makeClip(Object.assign({}, c, { start: s }));
      }
      draw();
    });
    const end = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const d = drag;
      drag = null;
      if (d.moved && d.preview) {
        api.write((l) => {
          const t = l.find((k) => k.id === d.ht.t.id);
          if (!t) return;
          const i = t.clips.findIndex((k) => k.id === d.clipId);
          if (i >= 0) t.clips[i] = d.preview;
          t.clips.sort((a, b) => a.start - b.start);
        });
        return;
      }
      if (e.type === 'pointercancel') { draw(); return; }
      if (d.ht && d.ht.c) select({ kind: 'clip', trackId: d.ht.t.id, clipId: d.ht.c.id });
      else if (d.ht) { select({ kind: 'track', trackId: d.ht.t.id }); api.seek(Math.max(0, lane() ? lane().tOf(d.p0.x) : d.p0.x / zoom())); }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    const onAny = () => { sig = ''; draw(); if (sel) paintPanel(); };
    subs.add(onAny);
    let ro = null;
    if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => { size(); draw(); }); ro.observe(canHost); }
    size();
    paintHeads(tracks());
    paintPanel();
    draw();
    return {
      draw,
      /* Model dışarıdan değişti (geri al, içe aktarma): seçim geçersizse kalkar */
      refresh() { const f = findClip(tracks(), sel); if (sel && (!f || !f.t || (sel.kind === 'clip' && !f.c))) sel = null; sig = ''; paintPanel(); draw(); },
      themeChanged() { colors = null; draw(); },
      selection: () => sel,
      destroy() { subs.delete(onAny); if (ro) ro.disconnect(); host.textContent = ''; },
      _hit: hit,
    };
  }

  window.SVShellTimelineAudio = Object.freeze({
    ROW_H, MIX_NAME, MIX_RATE,
    load, status, missing, check, reachable, importAudio, relink,
    renderMix, encodeWav, writeMix,
    preview: previewToggle, previewStop, previewing: () => ({ on: preview.on, busy: preview.busy }),
    onChange: (f) => { subs.add(f); return () => subs.delete(f); },
    strip,
    _live: () => ({ nodes: live.nodes.length, key: live.key !== null, t: live.t }),
    _tick: liveTick,
  });
})();
