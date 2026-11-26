/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ZAMAN ÇİZELGESİ SES BÖLÜMÜ (#1171, #1173) — yönetim paneli.

   Ses YALNIZ bu süreçte çalar: çıkış pencereleri ses çalmaz (birden çok ekranda
   yankı olmasın). Çalma, dışa aktarmayla aynı karışım tanımını kullanır
   (SVTimelineAudioCore.mixDescription): kazanç noktaları arasında doğrusal.

   Her klip bir HTMLAudioElement → kazanç → denge (sol/sağ) → parça ölçeri →
   ana kazanç → ana ölçer → çıkış aygıtı. Zaman çizelgesi saatine (çıpa) her
   turda bakılır; sapma 80 ms'yi geçerse konum düzeltilir. Kazanç değişimleri
   kısa rampayla (tık yok). Düzenleme yıkıcı değildir: kaynak dosyaya dokunulmaz. */
(function () {
  const A = () => window.SVTimelineAudioCore;
  const P = () => window.SVTimelinePanel;
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
  let LANE_H = 40; // görsel şerit yüksekliğiyle aynı (çizimde güncellenir)
  const TICK_MS = 40;
  const DRIFT = 0.08;
  const SINK_KEY = 'sv-tl-audio-sink';

  function el(tag, props, kids) {
    const e = document.createElement(tag);
    for (const k in props || {}) {
      const v = props[k];
      if (k === 'text') e.textContent = v;
      else if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids || []) if (c) e.appendChild(c);
    return e;
  }
  const color = (n) => (window.SVUiTheme ? window.SVUiTheme.color(n) : '');
  const alpha = (n, a) => (window.SVUiTheme ? window.SVUiTheme.alpha(n, a) : 'transparent');

  // ---------------- Model erişimi ----------------
  function tlc() {
    const p = P();
    try { return p && p.tlConfig ? p.tlConfig() : null; } catch { return null; }
  }
  function tracks() {
    const c = tlc();
    return c && Array.isArray(c.audioTracks) ? c.audioTracks : [];
  }
  /* Yazma: normalleştirilmiş kopya yapılandırmaya, geçmişe tek adım. */
  function write(list) {
    const c = tlc();
    if (!c) return;
    c.audioTracks = A().normalize(list);
    if (P() && P().commitAudio) P().commitAudio();
    sigCache = '';
    paint();
  }
  const clone = () => JSON.parse(JSON.stringify(tracks()));

  // ---------------- Tepe değerleri ----------------
  const peaks = new Map(); // src → { rate, data } | 'loading' | 'missing'
  function peaksOf(src) {
    const p = peaks.get(src);
    if (p && typeof p === 'object') return p;
    if (!p && window.api && window.api.timelineAudioPeaks) {
      peaks.set(src, 'loading');
      window.api.timelineAudioPeaks(src).then((r) => {
        peaks.set(src, r && r.data ? { rate: r.rate, data: r.data, dur: r.dur } : 'missing');
        sigCache = '';
        paint();
      }).catch(() => peaks.set(src, 'missing'));
    }
    return null;
  }

  // ---------------- Çalma motoru ----------------
  let ctx = null;
  let master = null;
  let masterMeter = null;
  const voices = new Map(); // clipId → { audio, gain, l, r, src, trackId, stopAt }
  const trackBus = new Map(); // trackId → { input, meter }
  const missing = new Set();
  let desc = null;
  let sigCache = '';
  let sinkNote = '';

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC({ latencyHint: 'interactive' });
    master = ctx.createGain();
    masterMeter = ctx.createAnalyser();
    masterMeter.fftSize = 512;
    master.connect(masterMeter);
    masterMeter.connect(ctx.destination);
    applySink(localStorage.getItem(SINK_KEY) || '');
    return ctx;
  }
  function applySink(id) {
    if (!ctx || typeof ctx.setSinkId !== 'function') return;
    ctx.setSinkId(id || '').then(() => { sinkNote = ''; }).catch(() => {
      // Aygıt çıkarıldı: varsayılana dön, bildir
      sinkNote = tr('Seçilen ses aygıtı bulunamadı; varsayılan aygıt kullanılıyor.');
      note(sinkNote);
      try { localStorage.removeItem(SINK_KEY); } catch {}
      ctx.setSinkId('').catch(() => {});
      paintHeads();
    });
  }
  function busOf(trackId) {
    let b = trackBus.get(trackId);
    if (b) return b;
    const input = ctx.createGain();
    const meter = ctx.createAnalyser();
    meter.fftSize = 512;
    input.connect(meter);
    input.connect(master);
    b = { input, meter, peak: 0, hold: 0, clip: false };
    trackBus.set(trackId, b);
    return b;
  }
  function voiceOf(s) {
    let v = voices.get(s.clipId);
    if (v && v.src === s.src) return v;
    if (v) dropVoice(s.clipId);
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    audio.src = s.src;
    audio.addEventListener('error', () => { missing.add(s.src); paint(); });
    const node = ctx.createMediaElementSource(audio);
    // Mono dosya da iki kanala açılır: denge iki tarafta aynı çalışsın
    const gain = ctx.createGain();
    gain.channelCount = 2;
    gain.channelCountMode = 'explicit';
    gain.channelInterpretation = 'speakers';
    gain.gain.value = 0;
    const split = ctx.createChannelSplitter(2);
    const l = ctx.createGain();
    const r = ctx.createGain();
    const merge = ctx.createChannelMerger(2);
    node.connect(gain);
    gain.connect(split);
    split.connect(l, 0);
    split.connect(r, 1);
    l.connect(merge, 0, 0);
    r.connect(merge, 0, 1);
    merge.connect(busOf(s.trackId).input);
    v = { audio, node, gain, l, r, merge, src: s.src, trackId: s.trackId, stopAt: 0 };
    voices.set(s.clipId, v);
    return v;
  }
  function dropVoice(id) {
    const v = voices.get(id);
    if (!v) return;
    try { v.audio.pause(); v.audio.removeAttribute('src'); v.audio.load(); } catch {}
    try { v.merge.disconnect(); v.node.disconnect(); } catch {}
    voices.delete(id);
  }

  function currentDesc() {
    const list = tracks();
    const sig = JSON.stringify(list);
    if (sig !== sigCache || !desc) {
      sigCache = sig;
      // Kısma anahtarı tepe değerlerini ister; yüklenince yeniden hesaplanır
      desc = A().mixDescription(list, { from: 0, peaksOf });
    }
    return desc;
  }

  /* Çalan Parça (#1171): en üstteki ses şeridinin çalan klibi ana sürece; yalnız
     klip, çalma durumu ya da (atlama sonrası) konum değişince. */
  let lastNow = null;
  function sendNow(list, t, playing) {
    if (!window.api || !window.api.timelineAudioNow) return;
    const hit = playing ? A().clipAt(list, t) : null;
    if (!hit) {
      if (lastNow) { lastNow = null; window.api.timelineAudioNow(null); }
      return;
    }
    const pos = hit.clip.in + hit.local;
    const expect = lastNow ? lastNow.pos + (performance.now() - lastNow.at) / 1000 : 0;
    if (lastNow && lastNow.id === hit.clip.id && Math.abs(expect - pos) < 0.5) return;
    lastNow = { id: hit.clip.id, pos, at: performance.now() };
    window.api.timelineAudioNow({ src: hit.clip.src, t: hit.local + hit.clip.start, clip: hit.clip, playing: true });
  }

  function tick() {
    const core = A();
    const p = P();
    if (!core || !p || !p.transport) return;
    const list = tracks();
    if (!list.length && !voices.size && !lastNow) return;
    let trn;
    try { trn = p.transport(); } catch { return; }
    const t = trn ? trn.time : 0;
    const playing = !!(trn && trn.playing);
    if (!playing && lastNow) sendNow(list, t, false);
    if (playing && !ensureCtx()) return;
    if (!ctx) return;
    if (playing && ctx.state === 'suspended') ctx.resume().catch(() => {});
    sendNow(list, t, playing);
    const d = currentDesc();
    const now = ctx.currentTime;
    const seen = new Set();
    for (const s of d.sources) {
      const local = t - s.at;
      const on = playing && local >= 0 && local < s.dur && !missing.has(s.src);
      if (!on) continue;
      seen.add(s.clipId);
      const v = voiceOf(s);
      v.stopAt = 0;
      const want = s.offset + local;
      if (v.audio.paused) {
        try { v.audio.currentTime = want; } catch {}
        v.audio.play().catch(() => {});
      } else if (Math.abs(v.audio.currentTime - want) > DRIFT) {
        try { v.audio.currentTime = want; } catch {}
      }
      const [gl, gr] = core.panGains(s.pan);
      v.gain.gain.setTargetAtTime(core.gainAtPoints(s.points, local), now, 0.012);
      v.l.gain.setTargetAtTime(gl, now, 0.012);
      v.r.gain.setTargetAtTime(gr, now, 0.012);
    }
    // Biten / duran klip: önce kazanç sıfıra (tık yok), sonra durdur
    for (const [id, v] of voices) {
      if (seen.has(id)) continue;
      if (!v.stopAt) { v.gain.gain.setTargetAtTime(0, now, 0.01); v.stopAt = performance.now() + 60; }
      else if (performance.now() > v.stopAt && !v.audio.paused) v.audio.pause();
      if (!d.sources.some((s) => s.clipId === id)) dropVoice(id);
    }
  }

  function levelOf(an) {
    if (!an) return 0;
    const buf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(buf);
    let m = 0;
    for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > m) m = a; }
    return m;
  }

  // ---------------- Arayüz ----------------
  /* Görsel parçalarla AYNI düzen (#1171 tasarım düzeltmesi): başlık sütunu
     çizelgeninkiyle aynı genişlik ve biçimde (ad, M, S), şerit yüksekliği aynı,
     zaman ekseni aynı. Ayarlar sağdaki Seçim panelinde; satır içinde kutu yok. */
  let root = null;
  let headsEl = null;
  let headCell = null;
  let canvas = null;
  let masterBar = null;
  let selTrack = '';
  let selClip = '';
  let drag = null;
  let sideShown = '';

  const laneH = () => { try { return Math.max(24, Number(P().laneH()) || 40); } catch { return 40; } };

  function icon(name) {
    const I = window.SVIcons;
    return I && I.el ? I.el(name, '') : null;
  }
  function iconBtn(name, title, fn, cls) {
    const b = el('button', { class: 'tl-tog ' + (cls || ''), type: 'button', title: tr(title), 'aria-label': tr(title) });
    const ic = icon(name);
    if (ic && typeof ic === 'object' && ic.nodeType) b.appendChild(ic); else if (typeof ic === 'string') b.innerHTML = ic; else b.textContent = '+';
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(e); });
    return b;
  }

  function section() {
    if (root) { setTimeout(paintAll); return root; }
    masterBar = el('span', { class: 'tla-meter master', title: tr('Ana çıkış seviyesi (kırmızı: kırpılma; sıfırlamak için tıklayın)') }, [el('i'), el('b')]);
    masterBar.addEventListener('click', () => { masterBar.classList.remove('clip'); });
    headCell = el('div', { class: 'tla-headcell' }, [
      el('span', { class: 'tla-title', text: tr('Ses') }),
      iconBtn('plus', 'Ses Ekle', addAudio, 'tla-add'),
      masterBar,
    ]);
    const sink = el('select', { class: 'tla-sink', title: tr('Ses çıkış aygıtı'), 'aria-label': tr('Ses çıkış aygıtı') });
    sink.addEventListener('focus', () => fillSinks(sink));
    sink.addEventListener('change', () => { try { localStorage.setItem(SINK_KEY, sink.value); } catch {} ensureCtx(); applySink(sink.value); });
    fillSinks(sink);
    const bar = el('div', { class: 'tla-bar' }, [headCell, el('div', { class: 'tla-barfill' }), sink]);
    headsEl = el('div', { class: 'tl-heads tla-heads' });
    canvas = el('canvas', { class: 'tla-canvas' });
    const body = el('div', { class: 'tla-body' }, [headsEl, el('div', { class: 'tla-canvas-wrap' }, [canvas])]);
    root = el('div', { class: 'tla', tabindex: '0', 'aria-label': tr('Zaman çizelgesi ses parçaları') }, [bar, body]);
    root.addEventListener('keydown', onKey);
    bindCanvas();
    setTimeout(paintAll);
    return root;
  }

  async function fillSinks(sel) {
    const cur = (() => { try { return localStorage.getItem(SINK_KEY) || ''; } catch { return ''; } })();
    let list = [];
    try { list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput'); } catch {}
    sel.textContent = '';
    sel.appendChild(el('option', { value: '', text: tr('Varsayılan çıkış') }));
    for (const d of list) if (d.deviceId && d.deviceId !== 'default') sel.appendChild(el('option', { value: d.deviceId, text: d.label || d.deviceId.slice(0, 8) }));
    sel.value = list.some((d) => d.deviceId === cur) ? cur : '';
  }

  async function addAudio() {
    if (!window.api || !window.api.pickTimelineAudio) return;
    const files = await window.api.pickTimelineAudio();
    if (!files || !files.length) return;
    const bad = files.filter((f) => f.error);
    const ok = files.filter((f) => !f.error);
    if (bad.length) note(tr('Desteklenmeyen ya da okunamayan dosya:') + ' ' + bad.map((f) => f.name).join(', '));
    if (!ok.length) return;
    const list = clone();
    let trk = list.find((x) => x.id === selTrack);
    if (!trk) { trk = A().makeTrack({ name: tr('Ses') + ' ' + (list.length + 1) }); list.push(trk); }
    let at = headTime();
    for (const f of ok) {
      trk.clips.push(A().makeClip({ src: f.url, name: f.name, start: at, dur: f.dur, srcDur: f.dur }));
      at += f.dur;
    }
    selTrack = trk.id;
    write(list);
  }
  function addTrack() {
    const list = clone();
    const t = A().makeTrack({ name: tr('Ses') + ' ' + (list.length + 1) });
    list.push(t);
    selTrack = t.id;
    selClip = '';
    write(list);
    showSide();
  }
  function headTime() {
    try { return Math.max(0, P().transport().time || 0); } catch { return 0; }
  }
  function findSel(list) {
    for (const t of list) { const i = t.clips.findIndex((c) => c.id === selClip); if (i >= 0) return { t, i }; }
    return null;
  }
  function splitAtHead() {
    const list = A().normalize(clone());
    const at = headTime();
    let done = false;
    for (const t of list) {
      if (selTrack && t.id !== selTrack) continue;
      for (let i = 0; i < t.clips.length; i++) {
        const c = t.clips[i];
        if (selClip && c.id !== selClip) continue;
        const parts = A().splitClip(c, at);
        if (parts) { t.clips.splice(i, 1, parts[0], parts[1]); i++; done = true; }
      }
    }
    if (done) write(list);
  }
  function joinSel() {
    const list = A().normalize(clone());
    const s = findSel(list);
    if (!s) return;
    const a = s.t.clips[s.i];
    const b = s.t.clips.find((c) => A().canJoin(a, c));
    const j = b && A().joinClips(a, b);
    if (!j) { note(tr('Birleştirilecek bitişik parça yok (aynı kaynak, aynı kesim noktası).')); return; }
    s.t.clips = s.t.clips.filter((c) => c.id !== a.id && c.id !== b.id).concat([j]);
    selClip = j.id;
    write(list);
  }
  function removeSel(ripple) {
    const list = A().normalize(clone());
    const s = findSel(list);
    if (!s) {
      // Seçili klip yoksa seçili şerit silinir
      const ti = list.findIndex((t) => t.id === selTrack);
      if (ti >= 0) { list.splice(ti, 1); selTrack = ''; write(list); clearSide(); }
      return;
    }
    const c = s.t.clips[s.i];
    s.t.clips.splice(s.i, 1);
    if (ripple) for (const o of s.t.clips) if (o.start >= c.start + c.dur - 1e-6) o.start = Math.max(0, o.start - c.dur);
    selClip = '';
    write(list);
    clearSide();
  }
  function nudge(dt) {
    const list = A().normalize(clone());
    const s = findSel(list);
    if (!s) return;
    s.t.clips[s.i].start = Math.max(0, s.t.clips[s.i].start + dt);
    write(list);
  }
  function onKey(e) {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    const k = e.key;
    let used = true;
    if (k === 's' || k === 'S') splitAtHead();
    else if (k === 'j' || k === 'J') joinSel();
    else if (k === 'Delete' || k === 'Backspace') removeSel(e.shiftKey);
    else if (k === 'ArrowLeft') nudge(e.shiftKey ? -1 : -1 / 30);
    else if (k === 'ArrowRight') nudge(e.shiftKey ? 1 : 1 / 30);
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }
  let noteTimer = 0;
  function note(msg) {
    if (window.SVPanel && typeof window.SVPanel.toast === 'function') { window.SVPanel.toast(msg, 'warn'); return; }
    if (!root) return;
    let n = root.querySelector('.tla-note');
    if (!n) { n = el('div', { class: 'tla-note', role: 'status' }); root.insertBefore(n, root.children[1]); }
    n.textContent = msg;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => n.remove(), 5000);
  }
  function menuAt(items, x, y) {
    const m = el('div', { class: 'sv-menu' }, items.map(([text, fn, off]) => el('button', { type: 'button', text: tr(text), disabled: off ? true : null, onclick: () => { m.remove(); fn(); } })));
    if (window.SVSceneShell && window.SVSceneShell.placeMenu) window.SVSceneShell.placeMenu(m, x, y);
    else { m.style.position = 'fixed'; m.style.left = x + 'px'; m.style.top = y + 'px'; document.body.appendChild(m); }
    const close = (ev) => { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('mousedown', close, true); } };
    setTimeout(() => document.addEventListener('mousedown', close, true));
  }

  // ---- Şerit başlıkları: görsel parçalarınkiyle aynı biçim ----
  function paintHeads() {
    if (!headsEl) return;
    const list = A().normalize(tracks());
    headsEl.textContent = '';
    const lh = laneH();
    if (!list.length) {
      headsEl.appendChild(el('div', { class: 'tla-empty', text: tr('Ses şeridi yok. Yeni Şerit → Ses Şeridi ya da + ile dosya ekleyin.') }));
      return;
    }
    list.forEach((t) => {
      const upd = (fn) => { const l = clone(); const x = l.find((q) => q.id === t.id); if (x) { fn(x); write(l); } };
      const name = el('input', { class: 'txt tl-trackname', type: 'text', value: t.name, title: t.name, 'aria-label': tr('Parça adı') });
      name.addEventListener('change', () => upd((x) => { x.name = name.value.trim() || x.name; }));
      const tog = (txt, title, key, cls) => {
        const b = el('button', { class: 'tl-tog ' + cls + (t[key] ? ' on' : ''), type: 'button', text: txt, title: tr(title), 'aria-pressed': t[key] ? 'true' : 'false' });
        b.addEventListener('click', (e) => { e.stopPropagation(); upd((x) => { x[key] = !x[key]; }); });
        return b;
      };
      const meter = el('span', { class: 'tla-meter', 'data-track': t.id, title: tr('Parça seviyesi') }, [el('i'), el('b')]);
      meter.addEventListener('click', (e) => { e.stopPropagation(); meter.classList.remove('clip'); });
      const head = el('div', { class: 'tl-head tla-head' + (t.id === selTrack && !selClip ? ' sel' : ''), style: 'height:' + lh + 'px' },
        [el('span', { class: 'tla-swatch', 'aria-hidden': 'true' }), name, meter, tog('M', 'Sustur', 'mute', 'm'), tog('S', 'Solo: yalnız solo parçalar çalar', 'solo', 's')]);
      head.addEventListener('mousedown', (e) => {
        if (e.target && e.target.closest && e.target.closest('input, button, select')) return;
        selTrack = t.id;
        selClip = '';
        showSide();
      });
      head.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        selTrack = t.id;
        selClip = '';
        menuAt([['Ses Dosyası Ekle', addAudio], ['Şeridi Sil', () => removeSel(false)]], e.clientX, e.clientY);
      });
      headsEl.appendChild(head);
    });
  }

  // ---- Sağdaki Seçim paneli: ses klibi ya da ses şeridi ayarları ----
  function clearSide() {
    sideShown = '';
    if (P() && P().refreshInspector) P().refreshInspector();
  }
  function showSide() {
    const p = P();
    if (!p || !p.showSide) return;
    const list = A().normalize(tracks());
    const s = findSel(list);
    const trk = list.find((t) => t.id === selTrack);
    if (!s && !trk) { clearSide(); return; }
    const row = (label, input) => (p.row ? p.row(label, input) : el('label', { class: 'tla-field' }, [el('span', { text: tr(label) }), input]));
    const num = (val, min, max, step, onChange) => {
      const i = el('input', { class: 'num tl-num', type: 'number', min: String(min), max: String(max), step: String(step) });
      i.value = String(Math.round(val * 1000) / 1000);
      i.addEventListener('change', () => { const v = Number(i.value); if (isFinite(v)) onChange(Math.max(min, Math.min(max, v))); });
      return i;
    };
    const box = el('div', { class: 'tl-inspector tla-side' });
    const btn = (text, title, fn, cls) => el('button', { class: 'btn small' + (cls ? ' ' + cls : ''), type: 'button', text: tr(text), title: tr(title), onclick: fn });
    if (s) {
      const c = s.t.clips[s.i];
      const edit = (fn) => { const l = A().normalize(clone()); const q = findSel(l); if (!q) return; q.t.clips[q.i] = A().makeClip(fn(q.t.clips[q.i]) || q.t.clips[q.i]); write(l); showSide(); };
      box.appendChild(el('div', { class: 'tl-insp-head', text: tr('Ses klibi') + ' · ' + (c.name || A().nowPlayingAt([{ clips: [c] }], c.start).title) }));
      const g = el('div', { class: 'tl-insp-grid' });
      g.appendChild(row('Başlangıç (sn)', num(c.start, 0, 1e6, 0.01, (v) => edit((x) => { x.start = v; }))));
      g.appendChild(row('Kaynak girişi (sn)', num(c.in, 0, 1e6, 0.01, (v) => edit((x) => A().trimStart(x, x.start + (v - x.in))))));
      g.appendChild(row('Süre (sn)', num(c.dur, 0.05, 1e6, 0.01, (v) => edit((x) => A().trimEnd(x, x.start + v)))));
      g.appendChild(row('Kazanç (dB)', num(c.gain, -60, 12, 0.5, (v) => edit((x) => { x.gain = v; }))));
      g.appendChild(row('Giriş geçişi (sn)', num(c.fadeIn, 0, 1e6, 0.05, (v) => edit((x) => { x.fadeIn = v; }))));
      g.appendChild(row('Çıkış geçişi (sn)', num(c.fadeOut, 0, 1e6, 0.05, (v) => edit((x) => { x.fadeOut = v; }))));
      const curve = el('select', {}, A().CURVES.map((k) => el('option', { value: k, text: tr({ linear: 'Doğrusal', equal: 'Eşit güç', exp: 'Üstel' }[k]) })));
      curve.value = c.curve;
      curve.addEventListener('change', () => edit((x) => { x.curve = curve.value; }));
      g.appendChild(row('Geçiş eğrisi', curve));
      const mute = el('input', { type: 'checkbox' });
      mute.checked = c.mute;
      mute.addEventListener('change', () => edit((x) => { x.mute = mute.checked; }));
      g.appendChild(row('Sessiz', mute));
      box.appendChild(g);
      box.appendChild(el('div', { class: 'tl-actions' }, [
        btn('Böl', 'Oynatma kafasında böl (S)', splitAtHead),
        btn('Birleştir', 'Seçili klibi aynı kaynaktan bitişik sonraki klibe ekle (J)', joinSel),
        btn('Sil', 'Seçili klibi sil (Delete; Shift+Delete boşluğu kapatır)', () => removeSel(false), 'danger'),
      ]));
      sideShown = 'clip:' + c.id;
    } else {
      const upd = (fn) => { const l = clone(); const x = l.find((q) => q.id === trk.id); if (x) { fn(x); write(l); showSide(); } };
      box.appendChild(el('div', { class: 'tl-insp-head', text: tr('Ses şeridi') + ' · ' + trk.name }));
      const g = el('div', { class: 'tl-insp-grid' });
      g.appendChild(row('Kazanç (dB)', num(trk.gain, -60, 12, 0.5, (v) => upd((x) => { x.gain = v; }))));
      g.appendChild(row('Denge (sol/sağ)', num(trk.pan, -1, 1, 0.05, (v) => upd((x) => { x.pan = v; }))));
      const duck = el('select', {});
      duck.appendChild(el('option', { value: '', text: tr('Kısma yok') }));
      for (const o of A().normalize(tracks())) if (o.id !== trk.id) duck.appendChild(el('option', { value: o.id, text: o.name }));
      duck.value = trk.duck ? trk.duck.key : '';
      duck.addEventListener('change', () => upd((x) => { x.duck = duck.value ? Object.assign({}, x.duck || {}, { key: duck.value }) : null; }));
      g.appendChild(row('Kısma: anahtar şerit', duck));
      if (trk.duck) g.appendChild(row('Kısma miktarı (dB)', num(trk.duck.amount, -60, 0, 1, (v) => upd((x) => { x.duck.amount = v; }))));
      box.appendChild(g);
      box.appendChild(el('div', { class: 'tl-actions' }, [
        btn('Ses Dosyası Ekle', 'Oynatma kafasına ses dosyası (MP3, WAV, FLAC, OGG, M4A, Opus)', addAudio),
        btn('Şeridi Sil', 'Ses şeridini ve kliplerini sil', () => removeSel(false), 'danger'),
      ]));
      sideShown = 'track:' + trk.id;
    }
    p.showSide(box);
    paint();
  }
  function paintInspector() { /* ayarlar sağdaki Seçim panelinde (showSide) */ }

  // ---- Tuval ----
  function geom() {
    const p = P();
    const tr0 = p && p.canvasRect ? p.canvasRect() : null;
    if (!canvas || !tr0 || !root || !root.isConnected) return null;
    return { left: tr0.left, width: tr0.width };
  }
  function xOf(t) { return P().xOf(t); }
  function tOf(x) { return P().tOf(x); }

  function paint() {
    if (!canvas || !root || !root.isConnected) return;
    const g = geom();
    LANE_H = laneH();
    const list = A().normalize(tracks());
    const h = Math.max(LANE_H, list.length * LANE_H);
    const wrap = canvas.parentElement;
    /* Başlık sütunu çizelgeninkiyle AYNI: tuvalin sol kenarı çizelge tuvalinin
       sol kenarına oturur (cetvel, ızgara ve oynatma kafası hizalı). */
    if (g && headsEl) {
      const off = Math.max(0, Math.round(g.left - headsEl.getBoundingClientRect().left));
      if (headsEl.style.width !== off + 'px') headsEl.style.width = off + 'px';
      if (headCell && headCell.style.width !== off + 'px') headCell.style.width = off + 'px';
    }
    const w = g ? Math.round(g.width) : (wrap ? wrap.clientWidth : 600);
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
    const c2 = canvas.getContext('2d');
    c2.setTransform(dpr, 0, 0, dpr, 0, 0);
    c2.clearRect(0, 0, w, h);
    const fg = (a) => alpha('--fg-rgb', a);
    const p = P();
    if (!p || !p.xOf) return;
    list.forEach((t, ti) => {
      const y0 = ti * LANE_H;
      c2.fillStyle = t.id === selTrack ? fg(0.06) : fg(ti % 2 ? 0.02 : 0.035);
      c2.fillRect(0, y0, w, LANE_H);
      c2.fillStyle = fg(0.12);
      c2.fillRect(0, y0 + LANE_H - 1, w, 1);
      for (const c of t.clips) {
        const x0 = xOf(c.start);
        const x1 = xOf(c.start + c.dur);
        if (x1 < 0 || x0 > w) continue;
        const sel = c.id === selClip;
        const gone = missing.has(c.src) || peaks.get(c.src) === 'missing';
        c2.fillStyle = gone ? alpha('--danger-rgb', 0.25) : alpha('--info-rgb', c.mute || t.mute ? 0.12 : 0.28);
        c2.fillRect(x0, y0 + 2, x1 - x0, LANE_H - 5);
        // Dalga biçimi (tepe değerleri; klip kazancı ve geçişlerle ölçekli)
        const pk = peaksOf(c.src);
        const mid = y0 + LANE_H / 2;
        if (pk && pk.data) {
          c2.fillStyle = fg(c.mute || t.mute ? 0.25 : 0.6);
          const from = Math.max(0, Math.floor(x0));
          const to = Math.min(w, Math.ceil(x1));
          for (let x = from; x < to; x++) {
            const ta = tOf(x) - c.start;
            const tb = tOf(x + 1) - c.start;
            const ia = Math.floor((c.in + ta) * pk.rate);
            const ib = Math.max(ia + 1, Math.floor((c.in + tb) * pk.rate));
            let m = 0;
            for (let i = Math.max(0, ia); i < Math.min(pk.data.length, ib); i++) if (pk.data[i] > m) m = pk.data[i];
            const gv = Math.min(1.5, m * A().clipGainAt(c, ta));
            const hh = gv * (LANE_H / 2 - 4);
            c2.fillRect(x, mid - hh, 1, Math.max(1, hh * 2));
          }
        } else {
          c2.fillStyle = fg(0.3);
          c2.font = '11px system-ui, sans-serif';
          c2.fillText(gone ? tr('Dosya bulunamadı') : tr('Yükleniyor…'), x0 + 6, mid + 4);
        }
        // Geçiş eğrileri ve tutamaçları
        c2.strokeStyle = color('--accent') || fg(0.8);
        c2.lineWidth = 1.5;
        c2.beginPath();
        for (let k = 0; k <= 24; k++) {
          const lt = (c.dur * k) / 24;
          const gg = A().clipGainAt(Object.assign({}, c, { gain: 0 }), lt);
          const yy = y0 + LANE_H - 4 - gg * (LANE_H - 8);
          if (k) c2.lineTo(xOf(c.start + lt), yy); else c2.moveTo(xOf(c.start + lt), yy);
        }
        c2.stroke();
        c2.fillStyle = color('--accent') || fg(0.8);
        c2.fillRect(xOf(c.start + c.fadeIn) - 4, y0 + 2, 8, 8);
        c2.fillRect(xOf(c.start + c.dur - c.fadeOut) - 4, y0 + 2, 8, 8);
        c2.fillStyle = fg(0.85);
        c2.font = '11px system-ui, sans-serif';
        c2.fillText((c.name || '').slice(0, 60), x0 + 12, y0 + 13);
        if (sel) { c2.strokeStyle = color('--text-strong') || fg(1); c2.lineWidth = 2; c2.strokeRect(x0 + 1, y0 + 3, x1 - x0 - 2, LANE_H - 7); }
      }
      // Ses otomasyonu: noktalar ve çizgi (+12 üstte, -60 altta)
      if (t.volume.length) {
        const yOf = (db) => y0 + 4 + ((12 - db) / 72) * (LANE_H - 8);
        c2.strokeStyle = alpha('--warn-rgb', 0.9) || fg(0.8);
        c2.lineWidth = 1.5;
        c2.beginPath();
        c2.moveTo(0, yOf(t.volume[0].db));
        for (const pt of t.volume) c2.lineTo(xOf(pt.t), yOf(pt.db));
        c2.lineTo(w, yOf(t.volume[t.volume.length - 1].db));
        c2.stroke();
        c2.fillStyle = alpha('--warn-rgb', 1) || fg(1);
        for (const pt of t.volume) c2.fillRect(xOf(pt.t) - 3, yOf(pt.db) - 3, 6, 6);
      }
    });
    // Oynatma kafası
    const hx = xOf(headTime());
    c2.fillStyle = color('--accent') || fg(1);
    c2.fillRect(Math.round(hx), 0, 1, h);
  }

  function meters() {
    if (!root || !root.isConnected) return;
    const set = (node, lvl, b) => {
      if (!node) return;
      const i = node.firstChild;
      const hold = node.lastChild;
      b.hold = lvl > b.hold ? lvl : Math.max(0, b.hold - 0.01);
      i.style.width = Math.min(100, lvl * 100) + '%';
      hold.style.left = Math.min(100, b.hold * 100) + '%';
      if (lvl >= 0.999) node.classList.add('clip'); // kırpılma: tıklanana dek kalır
    };
    if (masterMeter) set(masterBar, levelOf(masterMeter), masterHold);
    for (const [id, b] of trackBus) set(headsEl.querySelector('.tla-meter[data-track="' + id + '"]'), levelOf(b.meter), b);
  }
  const masterHold = { hold: 0 };

  function paintAll() { paintHeads(); paintInspector(); paint(); }

  // ---- Fare: taşı, kenardan kırp, geçiş tutamacı, ses noktası (Alt+tık) ----
  function hit(x, y) {
    LANE_H = laneH();
    const list = A().normalize(tracks());
    const ti = Math.floor(y / LANE_H);
    const t = list[ti];
    if (!t) return { ti };
    const ly = y - ti * LANE_H;
    const yOf = (db) => 4 + ((12 - db) / 72) * (LANE_H - 8);
    const vi = t.volume.findIndex((p) => Math.abs(xOf(p.t) - x) < 6 && Math.abs(yOf(p.db) - ly) < 6);
    if (vi >= 0) return { ti, t, kind: 'vol', vi };
    for (let i = t.clips.length - 1; i >= 0; i--) {
      const c = t.clips[i];
      const x0 = xOf(c.start);
      const x1 = xOf(c.start + c.dur);
      if (x < x0 - 4 || x > x1 + 4) continue;
      if (ly < 12 && Math.abs(x - xOf(c.start + c.fadeIn)) < 6) return { ti, t, c, kind: 'fadeIn' };
      if (ly < 12 && Math.abs(x - xOf(c.start + c.dur - c.fadeOut)) < 6) return { ti, t, c, kind: 'fadeOut' };
      if (Math.abs(x - x0) < 6) return { ti, t, c, kind: 'trimL' };
      if (Math.abs(x - x1) < 6) return { ti, t, c, kind: 'trimR' };
      if (x >= x0 && x <= x1) return { ti, t, c, kind: 'move' };
    }
    return { ti, t };
  }
  // Yakalama: diğer klip kenarları, oynatma kafası, işaretler (8 piksel)
  function snapT(tm, skipId) {
    const pts = [headTime()];
    for (const t of A().normalize(tracks())) for (const c of t.clips) if (c.id !== skipId) pts.push(c.start, c.start + c.dur);
    const c = tlc();
    for (const m of (c && c.markers) || []) if (m && Number.isFinite(m.t)) pts.push(m.t);
    let best = tm;
    let bd = 8;
    for (const p of pts) { const d = Math.abs(xOf(p) - xOf(tm)); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  function bindCanvas() {
    canvas.addEventListener('mousedown', (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const h = hit(x, y);
      root.focus({ preventScroll: true });
      if (h.t) selTrack = h.t.id;
      if (e.altKey && h.t && h.kind !== 'vol') {
        // Alt+tık: ses noktası ekle
        const list = clone();
        const tt = list.find((q) => q.id === h.t.id);
        const ly = y - h.ti * LANE_H;
        tt.volume = (tt.volume || []).concat([{ t: Math.max(0, tOf(x)), db: Math.round((12 - ((ly - 4) / (LANE_H - 8)) * 72) * 2) / 2 }]);
        write(list);
        return;
      }
      selClip = h.c ? h.c.id : (h.kind === 'vol' ? selClip : '');
      if (h.c || h.t) showSide(); else clearSide();
      if (!h.kind) return;
      drag = { h, x0: x, y0: y, orig: JSON.parse(JSON.stringify(tracks())), moved: false };
      e.preventDefault();
    });
    canvas.addEventListener('contextmenu', (e) => {
      const r = canvas.getBoundingClientRect();
      const h = hit(e.clientX - r.left, e.clientY - r.top);
      if (h.c) {
        e.preventDefault();
        selTrack = h.t.id;
        selClip = h.c.id;
        showSide();
        menuAt([['Böl', splitAtHead], ['Birleştir', joinSel], ['Sil', () => removeSel(false)], ['Sil ve boşluğu kapat', () => removeSel(true)]], e.clientX, e.clientY);
        return;
      }
      if (h.kind !== 'vol') return;
      e.preventDefault();
      const list = clone();
      const tt = list.find((q) => q.id === h.t.id);
      tt.volume.splice(h.vi, 1);
      write(list);
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) {
        if (!canvas.isConnected) return;
        const r = canvas.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
        const h = hit(e.clientX - r.left, e.clientY - r.top);
        canvas.style.cursor = h.kind === 'trimL' || h.kind === 'trimR' ? 'ew-resize' : h.kind === 'move' ? 'grab' : h.kind ? 'pointer' : 'default';
        return;
      }
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (Math.abs(x - drag.x0) < 2 && Math.abs(y - drag.y0) < 2 && !drag.moved) return;
      drag.moved = true;
      const dt = tOf(x) - tOf(drag.x0);
      const list = A().normalize(JSON.parse(JSON.stringify(drag.orig)));
      const ti = list.findIndex((q) => q.id === drag.h.t.id);
      const t = list[ti];
      if (drag.h.kind === 'vol') {
        const p = t.volume[drag.h.vi];
        const ly = y - ti * LANE_H;
        p.t = Math.max(0, p.t + dt);
        p.db = Math.max(-60, Math.min(12, Math.round((12 - ((ly - 4) / (LANE_H - 8)) * 72) * 2) / 2));
        t.volume.sort((a, b) => a.t - b.t);
      } else {
        const ci = t.clips.findIndex((q) => q.id === drag.h.c.id);
        let c = t.clips[ci];
        const k = drag.h.kind;
        if (k === 'move') {
          const s = snapT(Math.max(0, c.start + dt), c.id);
          const s2 = snapT(Math.max(0, c.start + c.dur + dt), c.id) - c.dur;
          c.start = Math.max(0, Math.abs(s - (c.start + dt)) <= Math.abs(s2 - (c.start + dt)) ? s : s2);
          // Dikey: başka ses parçasına taşı
          const nti = Math.max(0, Math.min(list.length - 1, Math.floor(y / LANE_H)));
          if (nti !== ti) { t.clips.splice(ci, 1); list[nti].clips.push(c); }
        } else if (k === 'trimL') c = A().trimStart(c, snapT(c.start + dt, c.id));
        else if (k === 'trimR') c = A().trimEnd(c, snapT(c.start + c.dur + dt, c.id));
        else if (k === 'fadeIn') c.fadeIn = Math.max(0, Math.min(c.dur - c.fadeOut, c.fadeIn + dt));
        else if (k === 'fadeOut') c.fadeOut = Math.max(0, Math.min(c.dur - c.fadeIn, c.fadeOut - dt));
        if (k !== 'move') t.clips[ci] = A().makeClip(c);
      }
      // Sürükleme sırasında yalnız görünüm; geçmişe bırakınca tek adım
      const cfgTl = tlc();
      if (cfgTl) cfgTl.audioTracks = A().normalize(list);
      paint();
    });
    window.addEventListener('mouseup', () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.moved) { write(tracks()); if (selClip) showSide(); }
    });
  }

  // ---- Döngüler ----
  setInterval(() => { try { tick(); } catch (e) { /* çalma hatası çizelgeyi durdurmaz */ } }, TICK_MS);
  /* Başlık ve denetçi yalnız yapı değişince yeniden kurulur (geri al, sekme,
     MCP); kullanıcı bir alana yazarken kurulmaz, odak kaybolmasın. */
  let headSig = '';
  function headsChanged() {
    const list = A().normalize(tracks());
    const sig = JSON.stringify([selTrack, selClip, sinkNote, list.map((t) => [t.id, t.name, t.mute, t.solo, t.gain, t.pan, t.duck, t.clips.length])])
      + JSON.stringify(list.map((t) => t.clips.find((c) => c.id === selClip) || 0));
    // Görsel bir öğe seçildi: ses seçimi kalkar (Seçim paneli tek bir şeyi gösterir)
    try {
      const vis = P() && P()._selection ? P()._selection() : null;
      if (vis && (selClip || sideShown)) { selClip = ''; selTrack = ''; sideShown = ''; }
    } catch { /* panel yok */ }
    // Seçili klip geri alma ile kalktı: panel kendi denetçisine döner
    if (selClip && !list.some((t) => t.clips.some((c) => c.id === selClip))) { selClip = ''; clearSide(); }
    if (sig === headSig) return;
    const a = document.activeElement;
    if (a && headsEl && headsEl.contains(a) && /INPUT|SELECT/.test(a.tagName)) return;
    headSig = sig;
    paintHeads();
  }
  function frame() {
    if (root && root.isConnected) { try { headsChanged(); paint(); meters(); } catch {} }
    requestAnimationFrame(frame);
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(frame);

  window.SVTimelineAudio = {
    section,
    // Öz test için
    _voices: () => Array.from(voices.entries()).map(([id, v]) => ({ id, paused: v.audio.paused, t: v.audio.currentTime, gain: v.gain.gain.value })),
    _tick: tick,
    _write: write,
    _select: (t, c) => { selTrack = t || ''; selClip = c || ''; if (selTrack || selClip) showSide(); else clearSide(); paintAll(); },
    _side: () => sideShown,
    _nowSent: () => lastNow,
    addTrack,
    addAudio,
    _key: onKey,
  };
})();
