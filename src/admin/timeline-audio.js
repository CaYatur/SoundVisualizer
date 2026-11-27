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
    // Kilitlenen şeridin klipleri seçimden düşer (başlık, menü, denetçi aynı yol)
    dropLocked(c.audioTracks);
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
  /* PREMIERE TARZI SES ŞERİTLERİ (A1, A2 …). Görsel parçalarla AYNI düzen:
     başlık sütunu çizelgeninkiyle aynı genişlik ve yazı biçiminde, şerit
     yüksekliği ve ayraç aynı, zaman ekseni aynı. Başlıkta ad, kilit, M, S ve
     küçük ses düzeyi (dB); klip ayarları sağdaki Seçim panelinde.

     Kilit: şeritteki klipler seçilmez, taşınmaz, kırpılmaz, silinmez (görsel
     parçalardaki kilit gibi). Klipler görsel klipler gibi yuvarlak, çerçeveli
     bloklar: üstte dosya adı şeridi, içinde dalga biçimi. Giriş/çıkış solması
     yalnız solma aralığında, gerçek eğrisiyle çizilir (eski çizim eğriyi
     klibin tamamına 24 noktayla yayıyordu: uzun klipte solma olduğundan çok
     daha uzun, "ileride" görünüyordu; tam klip solmasında da çapraz çizgi). */
  let root = null;
  let headsEl = null;
  let headCell = null;
  let canvas = null;
  let masterBar = null;
  let sinkEl = null;
  let selTrack = '';
  let selClip = '';
  let drag = null;
  let sideShown = '';
  let hover = { clip: '', kind: '' };
  const AUDIO_COL = '#2f9e74'; // ses klibinin varsayılan rengi (içerik rengi, temadan bağımsız)

  const laneH = () => { try { return Math.max(24, Number(P().laneH()) || 40); } catch { return 40; } };
  const touch = () => window.SVTimelineTouch || null;
  const tolPx = (px) => (touch() ? touch().tol(px) : px);
  const laneLabel = (i) => 'A' + (i + 1);
  const fmtDb = (db) => (db <= A().MIN_DB ? '-∞' : (db > 0 ? '+' : '') + (Math.round(db * 10) / 10)) + ' dB';

  /* Kaydırıcı dolgusu (--p): ilk çizimde ve her değer değişiminde; panelin genel
     dinleyicisi yalnız kullanıcı sürükleyince boyuyordu, ilk görünüşte dolgu yoktu. */
  function volFill(r) {
    const min = Number(r.min);
    const max = Number(r.max);
    const v = Number(r.value);
    const p = max > min && isFinite(v) ? Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100)) : 0;
    if (r.style && r.style.setProperty) r.style.setProperty('--p', (Math.round(p * 100) / 100) + '%');
    return p;
  }
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
      iconBtn('plus', 'Ses Şeridi Ekle', () => addTrack(), 'tla-add'),
      iconBtn('music', 'Ses Dosyası Ekle', () => addAudio(), 'tla-add'),
    ]);
    // Çıkış aygıtı ve ana ölçer şerit denetçisinde (çubukta yüzen öğe yok)
    const sink = el('select', { class: 'tla-sink', title: tr('Ses çıkış aygıtı'), 'aria-label': tr('Ses çıkış aygıtı') });
    sinkEl = sink;
    sink.addEventListener('focus', () => fillSinks(sink));
    sink.addEventListener('change', () => { try { localStorage.setItem(SINK_KEY, sink.value); } catch {} ensureCtx(); applySink(sink.value); });
    fillSinks(sink);
    const bar = el('div', { class: 'tla-bar' }, [headCell, el('div', { class: 'tla-barfill' })]);
    headsEl = el('div', { class: 'tl-heads tla-heads' });
    canvas = el('canvas', { class: 'tla-canvas' });
    const body = el('div', { class: 'tla-body' }, [headsEl, el('div', { class: 'tla-canvas-wrap' }, [canvas])]);
    splitEl = el('div', { class: 'tla-split', role: 'separator', 'aria-orientation': 'horizontal', title: tr('Sürükleyin: görsel ve ses alanının boyu; çift tık sıfırlar') });
    root = el('div', { class: 'tla', tabindex: '0', 'aria-label': tr('Zaman çizelgesi ses parçaları') }, [splitEl, bar, body]);
    bindSplit();
    bindCanvas();
    setTimeout(paintAll);
    return root;
  }

  /* ---- Görsel / ses bölücüsü ----
     Zaman sayfasında ve tam pencerede düzenleyici kalan boyu alır, ses bölümü
     altta. Bölücü sürüklenince ses bölümünün payı (ikisinin toplamına oran)
     değişir ve bu makinede saklanır; çift tık (dokunmatikte çift dokunma)
     varsayılana döner. İki alan da en az bir şerit gösterir; taşan alan kendi
     içinde kayar. Diğer yerleşimlerde düzenleyicinin kendi boy tutamağı var. */
  const SPLIT_KEY = 'sv-tl-audio-split';
  const SPLIT_MIN_V = 96; // cetvel + bir görsel parça
  let splitEl = null;
  let splitRatio = readSplit();
  let splitSig = '';
  function readSplit() {
    try { const v = Number(localStorage.getItem(SPLIT_KEY)); return v > 0 && v < 1 ? v : null; } catch { return null; }
  }
  function splitMode() {
    const host = root && root.parentNode;
    if (!host || !host.classList) return false;
    if (host.classList.contains('tl-full')) return true;
    const b = typeof document !== 'undefined' ? document.body : null;
    return !!(b && b.getAttribute && b.getAttribute('data-page') === 'time');
  }
  function editorOf() {
    const host = root && root.parentNode;
    if (!host || !host.children) return null;
    return Array.prototype.find.call(host.children, (n) => n.classList && n.classList.contains('tl-editor')) || null;
  }
  const splitMinA = () => (splitEl ? splitEl.offsetHeight || 8 : 8) + 26 + laneH();
  // Saf sınır: ses bölümünün boyu, iki alanın en küçük boyları korunarak
  function clampSplit(h, avail, minA, minV) {
    const hi = Math.max(minA, avail - minV);
    return Math.round(Math.max(minA, Math.min(hi, h)));
  }
  function applySplit(force) {
    if (!root) return;
    const ed = editorOf();
    if (!splitMode() || !ed) {
      if (root.style.height) { root.style.height = ''; root.style.maxHeight = ''; }
      splitSig = '';
      return;
    }
    const avail = ed.offsetHeight + root.offsetHeight;
    const nv = (() => { const c = tlc(); return c && Array.isArray(c.tracks) ? c.tracks.length : 0; })();
    const sig = avail + ':' + splitRatio + ':' + laneH() + ':' + nv;
    if (!force && sig === splitSig) return;
    splitSig = sig;
    /* Varsayılan (oran yok): görsel alan parçalarına yetecek kadar, kalan ses
       alanına — iki parçalı bir çizelgenin altında boş bir kutu kalmasın. */
    const want = splitRatio == null ? avail - (38 + Math.max(1, nv) * laneH() + 14) : splitRatio * avail;
    const h = clampSplit(want, avail, splitMinA(), SPLIT_MIN_V);
    root.style.height = h + 'px';
    root.style.maxHeight = 'none';
    splitEl.setAttribute('aria-valuenow', String(Math.round((h / Math.max(1, avail)) * 100)));
  }
  function resetSplit() {
    splitRatio = null;
    try { localStorage.removeItem(SPLIT_KEY); } catch { /* depolama yok */ }
    applySplit(true);
    paintAll();
  }
  function bindSplit() {
    let drag = null;
    let lastTap = 0;
    splitEl.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      const ed = editorOf();
      if (!ed || !splitMode()) return;
      e.preventDefault();
      try { splitEl.setPointerCapture(e.pointerId); } catch { /* yakalanamadı */ }
      drag = { y: e.clientY, h: root.offsetHeight, avail: ed.offsetHeight + root.offsetHeight, moved: false, id: e.pointerId };
      splitEl.classList.add('on');
    });
    splitEl.addEventListener('pointermove', (e) => {
      if (!drag || (drag.id != null && e.pointerId !== drag.id)) return;
      const dy = e.clientY - drag.y;
      if (Math.abs(dy) > 2) drag.moved = true;
      if (!drag.moved) return;
      const h = clampSplit(drag.h - dy, drag.avail, splitMinA(), SPLIT_MIN_V);
      splitRatio = h / drag.avail;
      applySplit(true);
      paintAll();
    });
    const end = (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      splitEl.classList.remove('on');
      try { splitEl.releasePointerCapture(e.pointerId); } catch { /* bırakıldı */ }
      if (d.moved) { try { localStorage.setItem(SPLIT_KEY, String(Math.round(splitRatio * 1000) / 1000)); } catch { /* depolama yok */ } return; }
      // Dokunmatikte çift dokunma da sıfırlar (dblclick fareden gelir)
      if (e.pointerType === 'touch') {
        const now = Date.now();
        if (now - lastTap < 350) { lastTap = 0; resetSplit(); } else lastTap = now;
      }
    };
    splitEl.addEventListener('pointerup', end);
    splitEl.addEventListener('pointercancel', end);
    splitEl.addEventListener('dblclick', (e) => { e.preventDefault(); resetSplit(); });
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

  const isLocked = (list, id) => { const t = list.find((q) => q.id === id); return !!(t && t.locked); };
  function lockedNote() { note(tr('Şerit kilitli; önce kilidi açın.')); }

  /* Ses dosyası ekle: seçili (kilitsiz) şeride, yoksa yeni şeride; `at` verilmezse kafaya. */
  async function addAudio(at, trackId) {
    if (!window.api || !window.api.pickTimelineAudio) return;
    const files = await window.api.pickTimelineAudio();
    if (!files || !files.length) return;
    const bad = files.filter((f) => f.error);
    const ok = files.filter((f) => !f.error);
    if (bad.length) note(tr('Desteklenmeyen ya da okunamayan dosya:') + ' ' + bad.map((f) => f.name).join(', '));
    if (!ok.length) return;
    const list = clone();
    let trk = list.find((x) => x.id === (trackId || selTrack) && !x.locked);
    if (!trk) { trk = A().makeTrack({ name: tr('Ses') + ' ' + (list.length + 1) }); list.push(trk); }
    let t0 = Number.isFinite(at) ? Math.max(0, at) : headTime();
    for (const f of ok) {
      trk.clips.push(A().makeClip({ src: f.url, name: f.name, start: t0, dur: f.dur, srcDur: f.dur }));
      t0 += f.dur;
    }
    selTrack = trk.id;
    write(list);
  }
  function addTrack() {
    const list = clone();
    const t = A().makeTrack({ name: tr('Ses') + ' ' + (list.length + 1) });
    list.push(t);
    selTrack = t.id;
    setSel([]);
    write(list);
    showSide();
    return t.id;
  }
  /* Ses şeridini sil (kilitliyse silinmez). id yoksa seçili şerit. */
  function removeTrack(id) {
    const list = clone();
    const ti = list.findIndex((t) => t.id === (id || selTrack));
    if (ti < 0) return false;
    if (list[ti].locked) { lockedNote(); return false; }
    const gone = list[ti];
    list.splice(ti, 1);
    if (selTrack === gone.id) selTrack = '';
    if (gone.clips.some((c) => c.id === selClip || selIds.indexOf(c.id) >= 0)) setSel([]);
    write(list);
    clearSide();
    return true;
  }
  function toggleLock(id) {
    const list = clone();
    const t = list.find((q) => q.id === (id || selTrack));
    if (!t) return;
    t.locked = !t.locked;
    // Kilitlenen şeritte seçili klip kalmaz (seçilemez)
    write(list);
    if (sideShown) showSide();
  }
  function headTime() {
    try { return Math.max(0, P().transport().time || 0); } catch { return 0; }
  }
  function findSel(list) {
    for (const t of list) { const i = t.clips.findIndex((c) => c.id === selClip); if (i >= 0) return { t, i }; }
    return null;
  }
  /* ---- Seçim modeli: görsel kliplerle aynı kurallar ----
     selIds: seçili ses klipleri (Ctrl/Shift+tık ekler/çıkarır), selClip: birincil
     (denetçide gösterilen). Görsel bir öğe seçilince ses seçimi kalkar, ses seçilince
     görsel seçim kalkar (Seçim paneli tek bir şeyi gösterir). Düzenlemeler AYNI geri
     al geçmişine tek adım olarak yazılır (commitAudio). */
  let selIds = [];
  /* Kilitlenen şeridin seçili klipleri seçimden düşer; diğerleri kalır. Seçim
     tümüyle kalkarsa o şerit seçili kalır (kilidi açmak için). */
  function dropLocked(list) {
    if (!selIds.length && !selClip) return false;
    const lockedIds = new Set();
    let lane = '';
    for (const t of list) if (t.locked) for (const c of t.clips) if (c.id === selClip || selIds.indexOf(c.id) >= 0) { lockedIds.add(c.id); lane = lane || t.id; }
    if (!lockedIds.size) return false;
    const keep = selIds.filter((id) => !lockedIds.has(id));
    setSel(keep, lockedIds.has(selClip) ? '' : selClip);
    if (!selClip) { selTrack = lane; showSide(); } else showSide();
    return true;
  }
  function setSel(ids, primary) {
    selIds = Array.from(new Set(ids || []));
    selClip = primary && selIds.indexOf(primary) >= 0 ? primary : (selIds[selIds.length - 1] || '');
  }
  const picked = () => (selIds.length ? selIds.slice() : (selClip ? [selClip] : []));
  // Saf işlemin sonucunu yaz; değişmediyse geçmişe adım eklenmez
  function applyOp(r, changed) {
    if (!r || !changed) return false;
    write(r.tracks);
    if (r.ids) setSel(r.ids, r.ids[0]);
    if (selClip) showSide(); else if (!selTrack) clearSide(); else showSide();
    return true;
  }
  function lockedHit() {
    const list = A().normalize(tracks());
    const want = new Set(picked());
    return list.some((t) => t.locked && t.clips.some((c) => want.has(c.id)));
  }
  function splitAtHead() {
    const at = headTime();
    // Seçim yoksa seçili şeridin (ya da bütün şeritlerin) kafadaki klipleri
    let ids = picked();
    if (!ids.length && selTrack) ids = (A().normalize(tracks()).find((t) => t.id === selTrack) || { clips: [] }).clips.map((c) => c.id);
    const r = A().splitClips(tracks(), ids, at);
    if (!r.split && lockedHit()) lockedNote();
    return applyOp(r, r.split > 0);
  }
  function joinSel() {
    const list = A().normalize(clone());
    const s = findSel(list);
    if (!s) return false;
    if (s.t.locked) { lockedNote(); return false; }
    const a = s.t.clips[s.i];
    const b = s.t.clips.find((c) => A().canJoin(a, c));
    const j = b && A().joinClips(a, b);
    if (!j) { note(tr('Birleştirilecek bitişik parça yok (aynı kaynak, aynı kesim noktası).')); return false; }
    s.t.clips = s.t.clips.filter((c) => c.id !== a.id && c.id !== b.id).concat([j]);
    return applyOp({ tracks: list, ids: [j.id] }, true);
  }
  function removeSel(ripple) {
    const ids = picked();
    if (!ids.length) {
      // Seçili klip yoksa seçili şerit silinir
      if (selTrack) return removeTrack(selTrack);
      return false;
    }
    if (lockedHit()) { lockedNote(); return false; }
    const r = A().removeClips(tracks(), ids, ripple);
    if (!r.removed) return false;
    write(r.tracks);
    setSel([]);
    clearSide();
    return true;
  }
  function resetFades() {
    const list = A().normalize(clone());
    const s = findSel(list);
    if (!s) return false;
    if (s.t.locked) { lockedNote(); return false; }
    s.t.clips[s.i] = A().makeClip(Object.assign({}, s.t.clips[s.i], { fadeIn: 0, fadeOut: 0 }));
    write(list);
    showSide();
    return true;
  }
  /* ←/→ kaydırma görsel kliplerle aynı adımla: ızgara adımı; Alt bir kare; Shift bir ölçü. */
  function nudge(dir, fine, bar) {
    const ids = picked();
    if (!ids.length) return false;
    if (lockedHit()) { lockedNote(); return false; }
    const list = A().normalize(tracks());
    const first = list.flatMap((t) => t.clips).filter((c) => ids.indexOf(c.id) >= 0).sort((a, b) => a.start - b.start)[0];
    const p = P();
    const step = p && p.stepAt ? p.stepAt(first ? first.start : 0, dir, !!fine, !!bar) : (fine ? 1 / 30 : 0.5);
    const r = A().nudgeClips(tracks(), ids, dir * step);
    return applyOp(r, r.moved > 0);
  }
  // Pano: görsel kliplerinkinden ayrı; Ctrl+V en son kopyalananı yapıştırır (panel karar verir)
  let board = null;
  let boardStamp = 0;
  function copySel() {
    const b = A().copyClips(tracks(), picked());
    if (!b) return false;
    board = b;
    boardStamp = Date.now() + (performance.now() % 1) * 1e-3;
    return true;
  }
  function cutSel() { return copySel() && removeSel(false); }
  function pasteAt() {
    if (!board) return false;
    const list = A().normalize(tracks());
    let lane = list.findIndex((t) => t.id === selTrack);
    if (lane < 0) lane = 0;
    const r = A().pasteClips(tracks(), board, headTime(), lane, tr('Ses'));
    if (r.locked) { lockedNote(); return false; }
    if (!r.pasted) return false;
    selTrack = A().normalize(r.tracks)[lane].id;
    return applyOp(r, true);
  }
  function duplicateSel() {
    if (lockedHit()) { lockedNote(); return false; }
    const r = A().duplicateClips(tracks(), picked());
    return applyOp(r, r.duplicated > 0);
  }
  function selectAll() {
    const ids = A().allClipIds(tracks());
    if (!ids.length) return false;
    setSel(ids, ids[0]);
    showSide();
    paintAll();
    return true;
  }
  function moveLane(dir) {
    const ids = picked();
    if (!ids.length) return false;
    if (lockedHit()) { lockedNote(); return false; }
    const r = A().moveClipsLane(tracks(), ids, dir);
    if (!r.moved) return false;
    const list = A().normalize(r.tracks);
    const t = list.find((q) => q.clips.some((c) => c.id === r.ids[0]));
    if (t) selTrack = t.id;
    return applyOp(r, true);
  }
  function clearSel() {
    const had = !!(selIds.length || selClip || selTrack);
    setSel([]);
    selTrack = '';
    clearSide();
    paintAll();
    return had;
  }
  // Ses tarafı seçim taşıyor mu (kısayollar buraya gider)
  function active() {
    // Görsel bir öğe seçiliyse (tıklama ile aynı karede bile) kısayollar görsele gider
    try { if (P() && P()._selection && P()._selection()) return false; } catch { /* panel yok */ }
    return !!(selIds.length || selClip || (selTrack && sideShown));
  }
  /* Kısayollar: zaman çizelgesinin TEK klavye kapısından (timeline-panel onEditorKey)
     çağrılır; ses seçimi etkinken düzenleme kısayolları ses kliplerine uygulanır.
     Geri al / yinele, oynat, yakınlaştırma … panelde kalır (aynı geçmiş). Döner: işlendi mi. */
  function key(e) {
    if (!active()) return false;
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName || '')) return false;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const low = typeof k === 'string' && k.length === 1 ? k.toLowerCase() : k;
    if (k === 'Delete' || k === 'Backspace') { removeSel(e.shiftKey); return true; }
    if (mod && low === 'c') { copySel(); return true; }
    if (mod && low === 'x') { cutSel(); return true; }
    if (mod && low === 'd') { duplicateSel(); return true; }
    if (mod && low === 'a') { selectAll(); return true; }
    if ((!mod && low === 's') || (mod && low === 'k')) { splitAtHead(); return true; }
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && !mod && picked().length) { nudge(k === 'ArrowLeft' ? -1 : 1, e.altKey && !e.shiftKey, e.shiftKey && !e.altKey); return true; }
    if ((k === 'ArrowUp' || k === 'ArrowDown') && !mod && picked().length) { moveLane(k === 'ArrowUp' ? -1 : 1); return true; }
    if (k === 'Escape') return clearSel();
    return false;
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
    const m = el('div', { class: 'sv-menu tla-menu' }, items.filter(Boolean).map(([text, fn, off]) => el('button', { type: 'button', text: tr(text), disabled: off ? true : null, onclick: () => { m.remove(); fn(); } })));
    if (window.SVSceneShell && window.SVSceneShell.placeMenu) window.SVSceneShell.placeMenu(m, x, y);
    else { m.style.position = 'fixed'; m.style.left = x + 'px'; m.style.top = y + 'px'; document.body.appendChild(m); }
    const close = (ev) => { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('pointerdown', close, true); document.removeEventListener('mousedown', close, true); } };
    setTimeout(() => { document.addEventListener('pointerdown', close, true); document.addEventListener('mousedown', close, true); });
  }
  // Şerit menüsü: başlıkta ve şeridin boş yerinde aynı
  function laneMenu(t, at, x, y) {
    if (t) { selTrack = t.id; setSel([]); showSide(); }
    menuAt([
      ['Ses Dosyası Ekle', () => addAudio(at, t ? t.id : ''), t && t.locked],
      ['Ses Şeridi Ekle', () => addTrack()],
      t ? [t.locked ? 'Kilidi Aç' : 'Kilitle', () => toggleLock(t.id)] : null,
      t ? ['Şeridi Sil', () => removeTrack(t.id), t.locked] : null,
    ], x, y);
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
    list.forEach((t, i) => {
      const upd = (fn) => { const l = clone(); const x = l.find((q) => q.id === t.id); if (x) { fn(x); write(l); } };
      const name = el('input', { class: 'txt tl-trackname', type: 'text', value: t.name, title: t.name, 'aria-label': tr('Parça adı') });
      name.addEventListener('change', () => upd((x) => { x.name = name.value.trim() || x.name; }));
      const tog = (txt, title, key, cls, ico) => {
        const b = el('button', { class: 'tl-tog ' + cls + (t[key] ? ' on' : ''), type: 'button', title: tr(title), 'aria-label': tr(title), 'aria-pressed': t[key] ? 'true' : 'false' });
        const ic = ico ? icon(ico) : null;
        if (ic && ic.nodeType) b.appendChild(ic); else b.textContent = txt;
        b.addEventListener('click', (e) => { e.stopPropagation(); if (key === 'locked') toggleLock(t.id); else upd((x) => { x[key] = !x[key]; }); });
        return b;
      };
      /* Şerit ses düzeyi: küçük kaydırıcı (dB ipucu). Sürüklerken yalnız çalma
         güncellenir, bırakınca geçmişe tek adım; çift tık 0 dB. */
      const vol = el('input', { class: 'tla-vol', type: 'range', min: String(A().MIN_DB), max: String(A().MAX_DB), step: '0.5', value: String(t.gain), title: tr('Şerit ses düzeyi') + ': ' + fmtDb(t.gain), 'aria-label': tr('Şerit ses düzeyi') });
      volFill(vol);
      const live = () => {
        const v = Number(vol.value);
        volFill(vol);
        vol.title = tr('Şerit ses düzeyi') + ': ' + fmtDb(v);
        const c = tlc();
        const x = c && Array.isArray(c.audioTracks) ? c.audioTracks.find((q) => q.id === t.id) : null;
        if (x) { x.gain = v; sigCache = ''; }
      };
      vol.addEventListener('input', live);
      vol.addEventListener('change', () => upd((x) => { x.gain = Number(vol.value); }));
      vol.addEventListener('dblclick', () => { vol.value = '0'; volFill(vol); upd((x) => { x.gain = 0; }); });
      const meter = el('span', { class: 'tla-meter', 'data-track': t.id, title: tr('Parça seviyesi') }, [el('i'), el('b')]);
      meter.addEventListener('click', (e) => { e.stopPropagation(); meter.classList.remove('clip'); });
      const head = el('div', { class: 'tl-head tla-head' + (t.id === selTrack && !selClip ? ' sel' : '') + (t.locked ? ' locked' : ''), style: 'height:' + lh + 'px' },
        [el('span', { class: 'tla-badge', text: laneLabel(i), 'aria-hidden': 'true' }), name, el('span', { class: 'tla-mix' }, [vol, meter]),
          tog('M', 'Sustur', 'mute', 'm'), tog('S', 'Solo: yalnız solo parçalar çalar', 'solo', 's'), tog('L', 'Kilitle: klipler seçilmez, taşınmaz, kırpılmaz, silinmez', 'locked', 'l', 'lock')]);
      head.addEventListener('mousedown', (e) => {
        if (e.target && e.target.closest && e.target.closest('input, button, select')) return;
        selTrack = t.id;
        setSel([]);
        showSide();
        paintAll();
      });
      head.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        laneMenu(t, headTime(), e.clientX, e.clientY);
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
      const edit = (fn) => { const l = A().normalize(clone()); const q = findSel(l); if (!q) return; if (q.t.locked) { lockedNote(); showSide(); return; } q.t.clips[q.i] = A().makeClip(fn(q.t.clips[q.i]) || q.t.clips[q.i]); write(l); showSide(); };
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
        btn('Birleştir', 'Seçili klibi aynı kaynaktan bitişik sonraki klibe ekle', joinSel),
        btn('Solmaları Sıfırla', 'Giriş ve çıkış solmasını kaldır', resetFades),
        btn('Sil', 'Seçili klibi sil (Delete; Shift+Delete boşluğu kapatır)', () => removeSel(false), 'danger'),
      ]));
      sideShown = 'clip:' + c.id;
    } else {
      const upd = (fn) => { const l = clone(); const x = l.find((q) => q.id === trk.id); if (x) { fn(x); write(l); showSide(); } };
      box.appendChild(el('div', { class: 'tl-insp-head', text: tr('Ses şeridi') + ' · ' + laneLabel(list.indexOf(trk)) + ' · ' + trk.name }));
      const g = el('div', { class: 'tl-insp-grid' });
      g.appendChild(row('Kazanç (dB)', num(trk.gain, -60, 12, 0.5, (v) => upd((x) => { x.gain = v; }))));
      g.appendChild(row('Denge (sol/sağ)', num(trk.pan, -1, 1, 0.05, (v) => upd((x) => { x.pan = v; }))));
      const lock = el('input', { type: 'checkbox' });
      lock.checked = trk.locked;
      lock.addEventListener('change', () => toggleLock(trk.id));
      g.appendChild(row('Kilitli', lock));
      const duck = el('select', {});
      duck.appendChild(el('option', { value: '', text: tr('Kısma yok') }));
      for (const o of A().normalize(tracks())) if (o.id !== trk.id) duck.appendChild(el('option', { value: o.id, text: o.name }));
      duck.value = trk.duck ? trk.duck.key : '';
      duck.addEventListener('change', () => upd((x) => { x.duck = duck.value ? Object.assign({}, x.duck || {}, { key: duck.value }) : null; }));
      g.appendChild(row('Kısma: anahtar şerit', duck));
      if (trk.duck) g.appendChild(row('Kısma miktarı (dB)', num(trk.duck.amount, -60, 0, 1, (v) => upd((x) => { x.duck.amount = v; }))));
      // Bütün ses bölümü için: çıkış aygıtı ve ana çıkış ölçeri
      if (sinkEl) g.appendChild(row('Ses çıkış aygıtı', sinkEl));
      if (masterBar) g.appendChild(row('Ana çıkış', masterBar));
      box.appendChild(g);
      box.appendChild(el('div', { class: 'tl-actions' }, [
        btn('Ses Dosyası Ekle', 'Oynatma kafasına ses dosyası (MP3, WAV, FLAC, OGG, M4A, Opus)', () => addAudio()),
        btn('Şeridi Sil', 'Ses şeridini ve kliplerini sil', () => removeTrack(trk.id), 'danger'),
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
  function rgbOf(hex) {
    const n = parseInt(String(hex || AUDIO_COL).replace('#', '').slice(0, 6), 16);
    return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [47, 158, 116];
  }
  const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  function rrect(c2, x, y, w, h, r) {
    c2.beginPath();
    if (c2.roundRect) c2.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
    else c2.rect(x, y, w, h);
  }
  // Klip kutusu ölçüleri: üst şerit (ad) ve dalga alanı
  function box(y0) {
    const top = y0 + 3;
    const hh = LANE_H - 6;
    const strip = hh >= 30 ? Math.min(16, Math.round(hh * 0.34)) : 0;
    return { top, hh, strip, wTop: top + strip, wBot: top + hh - 1 };
  }
  // Solma eğrisi yalnız solma aralığında, gerçek eğrisiyle (çekirdekteki fadeCurve)
  const fadePoints = (c, which, n) => A().fadeCurve(c, which, n);

  function drawClip(c2, c, t, y0, w, ghost) {
    const x0 = xOf(c.start);
    const x1 = xOf(c.start + c.dur);
    if (x1 < 0 || x0 > w) return;
    const cw = Math.max(3, x1 - x0);
    const b = box(y0);
    const sel = c.id === selClip || selIds.indexOf(c.id) >= 0;
    const gone = missing.has(c.src) || peaks.get(c.src) === 'missing';
    const col = gone ? [220, 70, 70] : rgbOf(c.color || AUDIO_COL);
    const dim = c.mute || t.mute;
    c2.save();
    c2.globalAlpha = ghost ? 0.55 : dim ? 0.5 : t.locked ? 0.75 : 1;
    // Gövde ve üst ad şeridi
    rrect(c2, x0, b.top, cw, b.hh, 6);
    c2.fillStyle = rgba(col, 0.55);
    c2.fill();
    c2.save();
    rrect(c2, x0, b.top, cw, b.hh, 6);
    c2.clip();
    if (b.strip) { c2.fillStyle = rgba(col, 0.9); c2.fillRect(x0, b.top, cw, b.strip); }
    // Dalga biçimi (tepe değerleri; klip kazancıyla ölçekli, solma ayrıca çizilir)
    const pk = peaksOf(c.src);
    const mid = (b.wTop + b.wBot) / 2;
    const amp = Math.max(2, (b.wBot - b.wTop) / 2 - 1);
    const onMedia = alpha('--on-media-rgb', 0.88); // dalga: orta tonlu klip renginde her temada okunur (içerik rengi)
    if (pk && pk.data) {
      c2.fillStyle = gone ? rgba(col, 0.8) : onMedia;
      const from = Math.max(0, Math.floor(x0));
      const to = Math.min(w, Math.ceil(x1));
      const g = Math.min(1.5, A().dbToGain(c.gain));
      for (let x = from; x < to; x++) {
        const ta = tOf(x) - c.start;
        const tb = tOf(x + 1) - c.start;
        const ia = Math.floor((c.in + ta) * pk.rate);
        const ib = Math.max(ia + 1, Math.floor((c.in + tb) * pk.rate));
        let m = 0;
        for (let i = Math.max(0, ia); i < Math.min(pk.data.length, ib); i++) if (pk.data[i] > m) m = pk.data[i];
        const hh = Math.min(1, m * g) * amp;
        c2.fillRect(x, mid - hh, 1, Math.max(1, hh * 2));
      }
    } else {
      c2.fillStyle = fg(0.55);
      c2.font = '11px system-ui, sans-serif';
      c2.fillText(gone ? tr('Dosya bulunamadı') : tr('Yükleniyor…'), x0 + 6, mid + 4);
    }
    // Solmalar: yalnız aralığında, eğrinin üstü karartılır
    for (const which of ['in', 'out']) {
      const pts = fadePoints(c, which);
      if (!pts.length) continue;
      const yOfG = (g) => b.wBot - g * (b.wBot - b.wTop);
      c2.beginPath();
      c2.moveTo(xOf(pts[0][0]), b.wTop);
      for (const [tt, g] of pts) c2.lineTo(xOf(tt), yOfG(g));
      c2.lineTo(xOf(pts[pts.length - 1][0]), b.wTop);
      c2.closePath();
      c2.fillStyle = alpha('--shadow-rgb', 0.32);
      c2.fill();
      c2.beginPath();
      pts.forEach(([tt, g], i) => { if (i) c2.lineTo(xOf(tt), yOfG(g)); else c2.moveTo(xOf(tt), yOfG(g)); });
      c2.strokeStyle = onMedia;
      c2.lineWidth = 1.25;
      c2.stroke();
    }
    // Ad (ve 0 dışı kazanç) üst şeritte; şerit yoksa dalganın üstünde
    if (cw > 24) {
      c2.fillStyle = alpha('--on-media-rgb', 1);
      c2.font = '600 11px system-ui, sans-serif';
      c2.textBaseline = 'middle';
      const label = (c.name || '').slice(0, 80) + (c.gain ? '  ' + fmtDb(c.gain) : '') + (c.mute ? '  · ' + tr('Sessiz') : '');
      c2.fillText(label, x0 + 7, b.strip ? b.top + b.strip / 2 + 0.5 : b.top + 8);
      c2.textBaseline = 'alphabetic';
    }
    c2.restore();
    // Çerçeve; seçili: kalın açık çerçeve; sürüklenen: kesikli
    rrect(c2, x0 + 0.5, b.top + 0.5, cw - 1, b.hh - 1, 6);
    c2.strokeStyle = sel ? ((color('--text-strong') || alpha('--on-media-rgb', 1))) : rgba(col, 0.95);
    c2.lineWidth = sel ? 2 : 1;
    if (ghost) c2.setLineDash([4, 3]);
    c2.stroke();
    c2.setLineDash([]);
    // Kırpma kenarı vurgusu (üstüne gelince)
    if (hover.clip === c.id && (hover.kind === 'trimL' || hover.kind === 'trimR')) {
      c2.fillStyle = (color('--text-strong') || alpha('--on-media-rgb', 1));
      const ex = hover.kind === 'trimL' ? x0 + 1 : x1 - 4;
      c2.fillRect(ex, b.top + 2, 3, b.hh - 4);
    }
    // Solma tutamaçları: seçili, üstünde ya da solma varken (sıfırdayken köşede)
    const showH = !t.locked && cw > 18 && (sel || hover.clip === c.id || c.fadeIn > 0 || c.fadeOut > 0);
    if (showH) {
      const hs = touch() && touch().coarse() ? 10 : 7;
      const hy = b.wTop;
      for (const [hx, on] of [[xOf(c.start + c.fadeIn), sel || hover.clip === c.id || c.fadeIn > 0], [xOf(c.start + c.dur - c.fadeOut), sel || hover.clip === c.id || c.fadeOut > 0]]) {
        if (!on) continue;
        const cx = Math.max(x0 + hs / 2, Math.min(x1 - hs / 2, hx));
        c2.fillStyle = (color('--text-strong') || alpha('--on-media-rgb', 1));
        c2.strokeStyle = alpha('--shadow-rgb', 0.6);
        c2.lineWidth = 1;
        c2.fillRect(cx - hs / 2, hy - hs / 2, hs, hs);
        c2.strokeRect(cx - hs / 2 + 0.5, hy - hs / 2 + 0.5, hs - 1, hs - 1);
      }
    }
    c2.restore();
  }
  function fg(a) { return alpha('--fg-rgb', a); }

  function paint() {
    if (!canvas || !root || !root.isConnected) return;
    const g = geom();
    LANE_H = laneH();
    const list = A().normalize(tracks());
    const extra = drag && drag.newLane ? 1 : 0; // aşağı sürüklenince yeni şerit önizlemesi
    const h = Math.max(LANE_H, (list.length + extra) * LANE_H);
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
    const p = P();
    if (!p || !p.xOf) return;
    let ghost = null;
    // Görsel parçalarla aynı ölçü ızgarası (aynı x; cetvel ve kafa hizalı)
    const gx = p.barLines ? p.barLines(w) : [];
    if (gx.length) {
      c2.strokeStyle = fg(0.05);
      c2.lineWidth = 1;
      c2.beginPath();
      for (const x of gx) { c2.moveTo(x, 0); c2.lineTo(x, h); }
      c2.stroke();
    }
    list.forEach((t, ti) => {
      const y0 = ti * LANE_H;
      // Görsel parçalarla aynı: yalnız seçili şerit hafifçe belirgin
      if (t.id === selTrack && !selClip) { c2.fillStyle = fg(0.045); c2.fillRect(0, y0, w, LANE_H); }
      // Kilitli şerit: ince çapraz tarama
      if (t.locked) {
        c2.save();
        c2.beginPath(); c2.rect(0, y0, w, LANE_H); c2.clip();
        c2.strokeStyle = fg(0.06);
        c2.lineWidth = 1;
        for (let k = -LANE_H; k < w; k += 10) { c2.beginPath(); c2.moveTo(k, y0 + LANE_H); c2.lineTo(k + LANE_H, y0); c2.stroke(); }
        c2.restore();
      }
      c2.fillStyle = fg(0.06);
      c2.fillRect(0, y0 + LANE_H - 1, w, 1);
      for (const c of t.clips) {
        if (drag && drag.moved && drag.h.kind === 'move' && drag.h.c && c.id === drag.h.c.id) { ghost = { c, t, ti }; continue; }
        drawClip(c2, c, t, y0, w, false);
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
    if (extra) {
      const y0 = list.length * LANE_H;
      c2.strokeStyle = alpha('--accent-rgb', 0.6) || fg(0.5);
      c2.setLineDash([5, 4]);
      c2.strokeRect(0.5, y0 + 0.5, w - 1, LANE_H - 1);
      c2.setLineDash([]);
      c2.fillStyle = fg(0.5);
      c2.font = '11px system-ui, sans-serif';
      c2.fillText(tr('Yeni ses şeridi'), 8, y0 + LANE_H / 2 + 4);
    }
    // Sürüklenen klip en üstte, hedef şeritte
    if (ghost) drawClip(c2, ghost.c, ghost.t, (drag.newLane ? list.length : ghost.ti) * LANE_H, w, true);
    // Yakalama çizgisi
    if (drag && drag.snapAt != null) {
      c2.fillStyle = color('--accent') || fg(1);
      c2.fillRect(Math.round(xOf(drag.snapAt)), 0, 1, h);
    }
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
      hold.style.opacity = b.hold > 0.005 ? '1' : '0'; // sessizken uçta çizgi kalmasın
      if (lvl >= 0.999) node.classList.add('clip'); // kırpılma: tıklanana dek kalır
    };
    if (masterMeter) set(masterBar, levelOf(masterMeter), masterHold);
    for (const [id, b] of trackBus) set(headsEl.querySelector('.tla-meter[data-track="' + id + '"]'), levelOf(b.meter), b);
  }
  const masterHold = { hold: 0 };

  function paintAll() { paintHeads(); paintInspector(); paint(); }

  // ---- Fare / dokunma: taşı, kenardan kırp, solma tutamacı, ses noktası (Alt+tık) ----
  /* İsabet sırası: ses noktası → solma tutamacı (yalnız tutamacın kutusunda;
     önce sol üst köşedeki tutamaç kırpma ve taşımayı yutuyordu, tıklayıp
     sürüklemek kazara tüm klibe solma veriyordu) → kenar (kırp) → gövde (taşı).
     Kilitli şeritte klip isabeti yok: yalnız şerit seçilir. */
  function hit(x, y) {
    LANE_H = laneH();
    const list = A().normalize(tracks());
    const ti = Math.floor(y / LANE_H);
    const t = list[ti];
    if (!t) return { ti, below: ti >= list.length };
    if (t.locked) return { ti, t, locked: true };
    const ly = y - ti * LANE_H;
    const yOf = (db) => 4 + ((12 - db) / 72) * (LANE_H - 8);
    const vt = tolPx(6);
    const vi = t.volume.findIndex((p) => Math.abs(xOf(p.t) - x) < vt && Math.abs(yOf(p.db) - ly) < vt);
    if (vi >= 0) return { ti, t, kind: 'vol', vi };
    const b = box(0);
    const ht = tolPx(6);
    const edgeTol = tolPx(7);
    for (let i = t.clips.length - 1; i >= 0; i--) {
      const c = t.clips[i];
      const x0 = xOf(c.start);
      const x1 = xOf(c.start + c.dur);
      if (x < x0 - 2 || x > x1 + 2 || ly < b.top - 2 || ly > b.top + b.hh + 2) continue;
      const handles = c.id === selClip || hover.clip === c.id || c.fadeIn > 0 || c.fadeOut > 0;
      if (handles && x1 - x0 > 18 && Math.abs(ly - b.wTop) <= ht) {
        const hi = Math.max(x0, Math.min(x1, xOf(c.start + c.fadeIn)));
        const ho = Math.max(x0, Math.min(x1, xOf(c.start + c.dur - c.fadeOut)));
        const di = Math.abs(x - hi);
        const dout = Math.abs(x - ho);
        if (Math.min(di, dout) <= ht) return { ti, t, c, kind: dout < di || (dout === di && x > (x0 + x1) / 2) ? 'fadeOut' : 'fadeIn' };
      }
      const edge = Math.min(edgeTol, (x1 - x0) / 3);
      if (x <= x0 + edge) return { ti, t, c, kind: 'trimL' };
      if (x >= x1 - edge) return { ti, t, c, kind: 'trimR' };
      return { ti, t, c, kind: 'move' };
    }
    return { ti, t };
  }
  /* Yakalama: diğer ses klibi kenarları, görsel klip kenarları, oynatma kafası,
     işaretler (8 piksel; parmakta 12). Döner: { t, at } — at: oturduğu nokta ya da null. */
  function snapInfo(tm, skipId) {
    const pts = [headTime()];
    for (const t of A().normalize(tracks())) for (const c of t.clips) if (c.id !== skipId) pts.push(c.start, c.start + c.dur);
    const c = tlc();
    for (const m of (c && c.markers) || []) if (m && Number.isFinite(m.t)) pts.push(m.t);
    for (const trk of (c && c.tracks) || []) for (const v of (trk && trk.clips) || []) if (v && Number.isFinite(v.start) && Number.isFinite(v.dur)) pts.push(v.start, v.start + v.dur);
    let best = null;
    let bd = touch() && touch().coarse() ? 12 : 8;
    for (const p of pts) { const d = Math.abs(xOf(p) - xOf(tm)); if (d < bd) { bd = d; best = p; } }
    return { t: best == null ? tm : best, at: best };
  }
  function snapT(tm, skipId) { return snapInfo(tm, skipId).t; }
  function bindCanvas() {
    canvas.addEventListener('mousedown', (e) => {
      if (e.button != null && e.button !== 0) return;
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const h = hit(x, y);
      root.focus({ preventScroll: true });
      if (h.t) selTrack = h.t.id;
      if (h.locked) { setSel([]); showSide(); paintHeads(); return; }
      if (e.altKey && h.t && h.kind !== 'vol') {
        // Alt+tık: ses noktası ekle
        const list = clone();
        const tt = list.find((q) => q.id === h.t.id);
        const ly = y - h.ti * LANE_H;
        tt.volume = (tt.volume || []).concat([{ t: Math.max(0, tOf(x)), db: Math.round((12 - ((ly - 4) / (LANE_H - 8)) * 72) * 2) / 2 }]);
        write(list);
        return;
      }
      // Boş şeride çift tık: o noktaya ses dosyası
      if (!h.kind && h.t && e.detail === 2) { addAudio(snapT(Math.max(0, tOf(x))), h.t.id); return; }
      // Ctrl/Shift+tık: seçime ekle ya da çıkar, taşıma yok (görsel kliplerdeki gibi)
      if (h.c && (e.ctrlKey || e.metaKey || e.shiftKey)) {
        const has = selIds.indexOf(h.c.id) >= 0;
        setSel(has ? selIds.filter((id) => id !== h.c.id) : selIds.concat([h.c.id]), has ? '' : h.c.id);
        if (selClip || selTrack) showSide(); else clearSide();
        paintAll();
        return;
      }
      // Seçili gruba tıklamak grubu korur (grup taşıma); başka klip tek seçim
      const group = h.c && h.kind === 'move' && selIds.length > 1 && selIds.indexOf(h.c.id) >= 0;
      if (h.c) { if (!group) setSel([h.c.id], h.c.id); else selClip = h.c.id; } else if (h.kind !== 'vol') setSel([]);
      if (h.c || h.t) showSide(); else clearSide();
      if (!h.kind) { paintHeads(); return; }
      drag = { h, x0: x, y0: y, orig: JSON.parse(JSON.stringify(tracks())), moved: false, snapAt: null, newLane: false, group };
      e.preventDefault();
    });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const h = hit(e.clientX - r.left, e.clientY - r.top);
      const at = Math.max(0, tOf(e.clientX - r.left));
      if (h.c) {
        selTrack = h.t.id;
        if (selIds.indexOf(h.c.id) < 0) setSel([h.c.id], h.c.id); else selClip = h.c.id;
        showSide();
        menuAt([['Böl', splitAtHead], ['Birleştir', joinSel], ['Solmaları Sıfırla', resetFades, !(h.c.fadeIn > 0 || h.c.fadeOut > 0)], ['Sil', () => removeSel(false)], ['Sil ve boşluğu kapat', () => removeSel(true)]], e.clientX, e.clientY);
        return;
      }
      if (h.kind === 'vol') {
        const list = clone();
        const tt = list.find((q) => q.id === h.t.id);
        tt.volume.splice(h.vi, 1);
        write(list);
        return;
      }
      laneMenu(h.t || null, at, e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) {
        if (!canvas.isConnected) return;
        const r = canvas.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
          if (hover.clip) { hover = { clip: '', kind: '' }; paint(); }
          return;
        }
        const h = hit(e.clientX - r.left, e.clientY - r.top);
        canvas.style.cursor = h.kind === 'trimL' || h.kind === 'trimR' || h.kind === 'fadeIn' || h.kind === 'fadeOut' ? 'ew-resize' : h.kind === 'move' ? 'grab' : h.kind ? 'pointer' : h.locked ? 'not-allowed' : 'default';
        canvas.title = h.locked ? tr('Şerit kilitli; önce kilidi açın.') : h.kind === 'fadeIn' ? tr('Giriş geçişi') : h.kind === 'fadeOut' ? tr('Çıkış geçişi') : '';
        const nh = { clip: h.c ? h.c.id : '', kind: h.kind || '' };
        if (nh.clip !== hover.clip || nh.kind !== hover.kind) { hover = nh; paint(); }
        return;
      }
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (Math.abs(x - drag.x0) < 3 && Math.abs(y - drag.y0) < 3 && !drag.moved) return;
      drag.moved = true;
      const dt = tOf(x) - tOf(drag.x0);
      const list = A().normalize(JSON.parse(JSON.stringify(drag.orig)));
      const ti = list.findIndex((q) => q.id === drag.h.t.id);
      const t = list[ti];
      if (!t) return;
      drag.snapAt = null;
      drag.newLane = false;
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
        const free = e.altKey; // Alt: yakalama yok
        if (k === 'move' && drag.group) {
          // Grup: birincil yakalamaya göre, hepsi aynı kayma; hiçbiri sıfırın soluna geçmez
          const raw = Math.max(0, c.start + dt);
          const a = free ? { t: raw, at: null } : snapInfo(raw, c.id);
          drag.snapAt = a.at;
          const r = A().nudgeClips(drag.orig, selIds, a.t - c.start);
          const cfgTl = tlc();
          if (cfgTl) cfgTl.audioTracks = r.tracks;
          paint();
          return;
        } else if (k === 'move') {
          const raw = Math.max(0, c.start + dt);
          const a = free ? { t: raw, at: null } : snapInfo(raw, c.id);
          const b2 = free ? { t: raw + c.dur, at: null } : snapInfo(raw + c.dur, c.id);
          const useA = a.at != null && (b2.at == null || Math.abs(a.t - raw) <= Math.abs(b2.t - c.dur - raw));
          c.start = Math.max(0, useA ? a.t : b2.at != null ? b2.t - c.dur : raw);
          drag.snapAt = useA ? a.at : b2.at;
          // Dikey: başka (kilitsiz) ses şeridine; son şeridin altı yeni şerit
          const row = Math.floor(y / LANE_H);
          if (row >= list.length) drag.newLane = true;
          else if (row >= 0 && row !== ti && !list[row].locked) { t.clips.splice(ci, 1); list[row].clips.push(c); }
        } else if (k === 'trimL') {
          const s = free ? { t: c.start + dt, at: null } : snapInfo(c.start + dt, c.id);
          c = A().trimStart(c, s.t);
          drag.snapAt = s.at;
        } else if (k === 'trimR') {
          const s = free ? { t: c.start + c.dur + dt, at: null } : snapInfo(c.start + c.dur + dt, c.id);
          c = A().trimEnd(c, s.t);
          drag.snapAt = s.at;
        } else if (k === 'fadeIn') c.fadeIn = Math.max(0, Math.min(c.dur - c.fadeOut, c.fadeIn + dt));
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
      if (!d.moved) { paint(); return; }
      let list = tracks();
      if (d.newLane && d.h.kind === 'move' && d.h.c) {
        // Son şeridin altına bırakıldı: yeni şerit, klip oraya
        list = A().normalize(JSON.parse(JSON.stringify(list)));
        let c = null;
        for (const t of list) { const i = t.clips.findIndex((q) => q.id === d.h.c.id); if (i >= 0) { c = t.clips.splice(i, 1)[0]; break; } }
        if (c) { const nt = A().makeTrack({ name: tr('Ses') + ' ' + (list.length + 1), clips: [c] }); list.push(nt); selTrack = nt.id; }
      }
      write(list);
      if (selClip) showSide();
    });
    // Dokunma: parmakla sürükle/kırp/taşı, boş şeritte kaydır, iki parmakla yakınlaştır, uzun basış menü
    if (touch()) {
      touch().bind(canvas, {
        grab: (x, y) => !!hit(x, y).kind,
        pan: (dx, dy) => {
          const p = P();
          if (dx && p && p.scrollBy) p.scrollBy(dx);
          if (dy) touch().scrollY(canvas, dy);
        },
        zoom: (f, x) => { const p = P(); if (p && p.zoomAt) p.zoomAt(f, x); },
      });
    }
  }

  // ---- Döngüler ----
  const tickTimer = setInterval(() => { try { tick(); } catch (e) { /* çalma hatası çizelgeyi durdurmaz */ } }, TICK_MS);
  // Node testlerinde süreç bu zamanlayıcı yüzünden açık kalmasın (tarayıcıda sayı döner)
  if (tickTimer && typeof tickTimer.unref === 'function') tickTimer.unref();
  /* Başlık ve denetçi yalnız yapı değişince yeniden kurulur (geri al, sekme,
     MCP); kullanıcı bir alana yazarken kurulmaz, odak kaybolmasın. */
  let headSig = '';
  function headsChanged() {
    const list = A().normalize(tracks());
    const sig = JSON.stringify([selTrack, selClip, selIds.length, sinkNote, list.map((t) => [t.id, t.name, t.mute, t.solo, t.locked, t.gain, t.pan, t.duck, t.clips.length])])
      + JSON.stringify(list.map((t) => t.clips.find((c) => c.id === selClip) || 0));
    // Görsel bir öğe seçildi: ses seçimi kalkar (Seçim paneli tek bir şeyi gösterir)
    try {
      const vis = P() && P()._selection ? P()._selection() : null;
      if (vis && (selClip || selIds.length || sideShown)) { setSel([]); selTrack = ''; sideShown = ''; }
    } catch { /* panel yok */ }
    // Seçili klip geri alma ile kalktı: panel kendi denetçisine döner
    // Kilitli şeridin klipleri seçimde kalmaz (geri al, denetçi ya da başlık kilidi)
    dropLocked(list);
    if (selIds.length || selClip) {
      const live = new Set(list.flatMap((t) => t.clips.map((c) => c.id)));
      const keep = selIds.filter((id) => live.has(id));
      if (keep.length !== selIds.length || (selClip && !live.has(selClip))) { setSel(keep, live.has(selClip) ? selClip : ''); if (!selClip) clearSide(); }
    }
    if (sig === headSig) return;
    const a = document.activeElement;
    if (a && headsEl && headsEl.contains(a) && /INPUT|SELECT/.test(a.tagName)) return;
    headSig = sig;
    paintHeads();
  }
  function frame() {
    if (root && root.isConnected) { try { headsChanged(); paint(); meters(); applySplit(); } catch {} }
    requestAnimationFrame(frame);
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(frame);

  window.SVTimelineAudio = {
    section,
    // Öz test için
    _voices: () => Array.from(voices.entries()).map(([id, v]) => ({ id, paused: v.audio.paused, t: v.audio.currentTime, gain: v.gain.gain.value })),
    _tick: tick,
    _write: write,
    _select: (t, c) => { selTrack = t || ''; setSel(c ? [].concat(c) : [], Array.isArray(c) ? c[0] : c); if (selTrack || selClip) showSide(); else clearSide(); paintAll(); },
    _side: () => sideShown,
    _nowSent: () => lastNow,
    addTrack,
    addAudio,
    removeTrack,
    toggleLock,
    selectedTrack: () => selTrack,
    _hit: (x, y) => { const h = hit(x, y); return { kind: h.kind || '', locked: !!h.locked, clip: h.c ? h.c.id : '', track: h.t ? h.t.id : '' }; },
    _fadePoints: fadePoints,
    _volFill: volFill,
    _clampSplit: clampSplit,
    _split: () => splitRatio,
    resetSplit,
    _key: key,
    _sel: () => selIds.slice(),
    key,
    active,
    clipStamp: () => (board ? boardStamp : 0),
    paste: pasteAt,
    clearSelection: clearSel,
  };
})();
