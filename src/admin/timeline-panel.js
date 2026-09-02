'use strict';
/* Zaman çizelgesi paneli — taşıma, cetvel, klipler, otomasyon ve işaretler.
 *
 * NEDEN TUVAL: bir gösteride yüzlerce klip ve binlerce anahtar kare olabilir.
 * Her biri için DOM düğümü üretmek yakınlaştırmayı ve sürüklemeyi gözle
 * görülür biçimde ağırlaştırırdı; cetvel çizgilerini DOM'da çizmek ise ayrı
 * bir eziyet. Tuval tek geçişte çiziliyor.
 *
 * NEDEN PANELDE: yapılandırmanın tek sahibi bu panel. Oynatma kafası burada
 * yaşar, görselleştirici pencereleri yalnızca çıpayı alıp kendileri hesaplar
 * (bkz. shared/showclock.js). Sahne değişimleri de buradan yapılır — Otomatik
 * VJ ve MIDI eşlemeleriyle aynı yolu kullanır, böylece aynı ayar iki farklı
 * yerden yazılmaz.
 */
(function () {
  const P = () => window.SVPanel;
  const TL = () => window.SVTimeline;

  // Ölçüler
  const TRACK_H = 34;
  const RULER_H = 26;
  const HEAD_W = 0; // parça adları ayrı listede; tuval yalnızca zamanı çizer
  const MIN_ZOOM = 4; // saniye başına piksel
  const MAX_ZOOM = 400;

  // --------------------------------------------------------------------------
  // Kalıcı durum — panel yeniden çizilse de yaşamaya devam eder
  // --------------------------------------------------------------------------
  let transport = null;
  let raf = 0;
  let lastFrame = 0;
  let selection = null; // { trackIndex, clipIndex } | { trackIndex, keyIndex }
  let drag = null;
  let canvas = null;
  let ctx = null;
  let lastAnchorKey = '';
  /* Zaman çizelgesi klipleri sahne uygular; aynı klibi her karede yeniden
     uygulamak paneli kilitlerdi. Sütun başına en son uygulanan klip tutulur. */
  let lastAppliedClip = new Map();

  function tlCfg() {
    return P().cfg().timeline;
  }

  function tlModel() {
    /* Her çağrıda modeli yeniden kurmak, yapılandırmadaki ham veriyi
       normalleştirir (bozuk sayı, sırasız anahtar) ve panelin her yerinde
       aynı temiz yapıyı garanti eder. Maliyeti düşük: veri küçük. */
    return TL().makeTimeline(tlCfg());
  }

  function ensureTransport() {
    if (!transport) transport = new (TL().Transport)(tlModel());
    transport.tl = tlModel();
    return transport;
  }

  /* Panelin oynatma kafası da ÇIPADAN türetilir, döngüden değil.

     Sebebi: döngü kare hızına bağlı ve kare hızı güvenilir değil — pencere
     örtülebilir, sistem yavaşlayabilir, sekme arka plana düşebilir. Zaman
     döngüden taşınsaydı bu durumların hepsinde oynatma kafası geri kalırdı,
     üstelik görselleştirici pencereleri (kendi hesaplarını çıpadan yaptığı
     için) doğru zamanı göstermeye devam eder ve panel ile ekran ayrışırdı.

     Döngü artık yalnızca ATEŞLEME ve ÇİZİM için gerekli; zamanı taşımıyor.
     Çevrimdışı dışa aktarımın kare indeksli yolu bundan etkilenmez: orada
     Transport.advance() kullanılmaya devam ediyor. */
  let clockAnchor = null;

  function syncTransportFromAnchor() {
    const tr = ensureTransport();
    if (!clockAnchor || !window.SVShowClock) return tr;
    tr.time = window.SVShowClock.resolve(clockAnchor, Date.now());
    tr.playing = !!clockAnchor.playing;
    return tr;
  }

  /* Taşıma durumu değiştiğinde çıpayı YENİLE ve yolla. */
  function reanchor() {
    const tr = ensureTransport();
    if (window.SVShowClock) clockAnchor = window.SVShowClock.anchorFrom(tr, Date.now(), tr.tl.loop);
    pushAnchor(true);
  }

  /* Çıpayı yalnızca DEĞİŞTİĞİNDE yolla. Her karede yollamak IPC'yi boş yere
     doldururdu ve zaten gereksiz: pencereler çıpadan kendileri hesaplıyor. */
  function pushAnchor(force) {
    if (!window.api || !window.api.sendShowClock || !window.SVShowClock) return;
    const tr = ensureTransport();
    if (!clockAnchor) clockAnchor = window.SVShowClock.anchorFrom(tr, Date.now(), tr.tl.loop);
    const anchor = clockAnchor;
    const key = anchor.playing + '|' + anchor.time.toFixed(4) + '|' + anchor.rate +
      '|' + (anchor.loop ? anchor.loop.start + ',' + anchor.loop.end : '-');
    if (!force && key === lastAnchorKey) return;
    lastAnchorKey = key;
    window.api.sendShowClock(anchor);
  }

  // --------------------------------------------------------------------------
  // Klip uygulama — zaman çizelgesindeki sahne/şablon değişimleri
  // --------------------------------------------------------------------------
  function applyClipsAt(t) {
    const tl = ensureTransport().tl;
    const active = TL().clipsAt(tl, t);
    const seen = new Set();
    for (const entry of active) {
      const key = entry.track.id;
      seen.add(key);
      if (lastAppliedClip.get(key) === entry.clip.id) continue;
      lastAppliedClip.set(key, entry.clip.id);
      fireClip(entry.clip);
    }
    for (const key of Array.from(lastAppliedClip.keys())) {
      if (!seen.has(key)) lastAppliedClip.delete(key);
    }
  }

  /* Sahne uygulaması panelin KENDİ eylemini çağırır, kopyasını değil:
     applyScene karartma durumunu, etkin sahne kimliğini ve görsel
     normalleştirmesini de doğru işliyor. Otomatik VJ bu listeyi elle
     kopyaladığı için o üçünü kaçırıyor; aynı hatayı tekrarlamıyoruz.

     Klip destesiyle AYNI uygulama yolu kullanılır (SVClipDeckPanel.applyRef):
     iki ayrı kopya zamanla birbirinden ayrılırdı. */
  function fireClip(clip) {
    if (!clip.ref) return;
    const dp = window.SVClipDeckPanel;
    if (dp && dp.applyRef) dp.applyRef(clip.type, clip.ref);
  }

  // --------------------------------------------------------------------------
  // Döngü
  // --------------------------------------------------------------------------
  /* TEK DÖNGÜ, TEK SAAT. Klip destesi kendi döngüsünü çalıştırsaydı iki
     yüzey birbirinden kayar ve "aynı vuruşta" ateşlenen şeyler görünür
     biçimde ayrışırdı. Deste de buradan sürülür.

     Deste açıkken taşıma KENDİLİĞİNDEN çalışır: VJ için vuruş ızgarası her
     zaman akıyor olmalı, klip ateşlemek için önce Oynat’a basmak gerekmez.
     Zaman çizelgesi ise açıkça oynatılır. */
  function loop() {
    raf = requestAnimationFrame(loop);
    loopBody();
  }

  function loopBody() {
    const now = performance.now();
    lastFrame = now;

    const full = P() && P().cfg();
    if (!full) return;
    const tlOn = !!(full.timeline && full.timeline.enabled);
    const deckOn = !!(full.clipdeck && full.clipdeck.enabled);
    if (!tlOn && !deckOn) return;

    let tr = ensureTransport();
    if (deckOn && !tlOn && !(clockAnchor && clockAnchor.playing)) {
      tr.play();
      reanchor();
    }
    tr = syncTransportFromAnchor();
    if (tr.playing && tlOn) applyClipsAt(tr.time);
    if (deckOn && window.SVClipDeckPanel && window.SVClipDeckPanel.tick) {
      window.SVClipDeckPanel.tick(tr.time, tr.tl.tempo);
    }
    pushAnchor(false);
    if (tlOn) draw();
  }

  /* Döngü canlı mı? Örtülmüş bir pencerede bekleyen bir rAF geri çağrısı
     hiç ateşlenmeyebilir; "raf dolu" kontrolü tek başına yapılırsa döngü
     bir daha asla kurulamaz. Bu yüzden son tur zamanı da bakılır. */
  function start() {
    const stale = lastFrame && performance.now() - lastFrame > 2000;
    if (raf && !stale) return;
    if (raf) cancelAnimationFrame(raf);
    lastFrame = 0;
    raf = requestAnimationFrame(loop);
    /* rAF hiç ateşlenmezse (pencere tamamen gizli) yedek olarak bir
       zamanlayıcı: ateşleme gecikse de durmaz. */
    if (!fallbackTimer) {
      fallbackTimer = setInterval(() => {
        if (!lastFrame || performance.now() - lastFrame > 500) loopBody();
      }, 250);
    }
  }
  let fallbackTimer = 0;

  // --------------------------------------------------------------------------
  // Tuval çizimi
  // --------------------------------------------------------------------------
  function view() {
    const cfg = tlCfg();
    return { zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cfg.zoom || 60)), scroll: Math.max(0, cfg.scroll || 0) };
  }
  function xOf(t) {
    const v = view();
    return HEAD_W + (t - v.scroll) * v.zoom;
  }
  function tOf(x) {
    const v = view();
    return v.scroll + (x - HEAD_W) / v.zoom;
  }

  function css(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function draw() {
    if (!canvas || !ctx || !canvas.isConnected) return;
    const cfg = tlCfg();
    const tl = ensureTransport().tl;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = RULER_H + Math.max(1, tl.tracks.length) * TRACK_H;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.height = h + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const fg = css('--text', '#e8e8ec');
    const dim = css('--muted', '#8b8b96');
    const line = css('--line', '#2a2a33');
    const accent = css('--accent', '#e11d2a');

    // --- Izgara ve cetvel ---
    drawRuler(w, tl, fg, dim, line);

    // --- Döngü bölgesi ---
    if (tl.loop.enabled) {
      ctx.fillStyle = 'rgba(120,180,255,.10)';
      ctx.fillRect(xOf(tl.loop.start), RULER_H, (tl.loop.end - tl.loop.start) * view().zoom, h - RULER_H);
    }

    // --- Parçalar ---
    for (let i = 0; i < tl.tracks.length; i++) {
      const y = RULER_H + i * TRACK_H;
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + TRACK_H - 0.5);
      ctx.lineTo(w, y + TRACK_H - 0.5);
      ctx.stroke();
      const trk = tl.tracks[i];
      if (trk.kind === 'clip') drawClipTrack(trk, i, y, w, fg, dim);
      else drawAutomationTrack(trk, i, y, w, accent, dim);
    }

    // --- İşaretler ---
    for (const m of tl.markers) {
      const x = xOf(m.t);
      if (x < -2 || x > w + 2) continue;
      ctx.strokeStyle = '#f0b429';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
      ctx.stroke();
      if (m.name) {
        ctx.fillStyle = '#f0b429';
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillText(m.name, x + 3, RULER_H - 14);
      }
    }

    // --- Oynatma kafası ---
    const px = xOf(transport.time);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
  }

  /* Cetvel: yakınlaştırmaya göre ızgara sıklığı seçilir. Sabit bir aralık,
     uzaklaşınca çizgi gürültüsüne, yakınlaşınca boş alana dönüşürdü. */
  function drawRuler(w, tl, fg, dim, line) {
    const cfg = tlCfg();
    const v = view();
    ctx.fillStyle = 'rgba(255,255,255,.03)';
    ctx.fillRect(0, 0, w, RULER_H);

    const showBars = cfg.ruler !== 'time';
    const showTime = cfg.ruler !== 'bars';

    // Saniye ızgarası — etiketler arası en az 60 piksel
    const secSteps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    let step = secSteps[secSteps.length - 1];
    for (const s of secSteps) {
      if (s * v.zoom >= 60) {
        step = s;
        break;
      }
    }
    ctx.font = '10px system-ui, sans-serif';
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    const t0 = Math.floor(v.scroll / step) * step;
    for (let t = t0; xOf(t) < w + 1; t += step) {
      const x = Math.round(xOf(t)) + 0.5;
      if (x < -1) continue;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, RULER_H);
      ctx.stroke();
      if (showTime) {
        ctx.fillStyle = dim;
        ctx.fillText(fmtTime(t), x + 3, 11);
      }
      if (showBars) {
        const b = TL().secondsToBars(tl.tempo, t);
        ctx.fillStyle = fg;
        ctx.fillText(b.bar + '.' + b.beat, x + 3, showTime ? 22 : 14);
      }
    }
  }

  function fmtTime(t) {
    const sign = t < 0 ? '-' : '';
    t = Math.abs(t);
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return sign + m + ':' + (s < 10 ? '0' : '') + (s % 1 ? s.toFixed(2) : s.toFixed(0));
  }

  function drawClipTrack(trk, index, y, w, fg, dim) {
    for (let ci = 0; ci < trk.clips.length; ci++) {
      const c = trk.clips[ci];
      const x = xOf(c.start);
      const cw = Math.max(2, c.dur * view().zoom);
      if (x + cw < 0 || x > w) continue;
      const sel = selection && selection.trackIndex === index && selection.clipIndex === ci;
      ctx.fillStyle = trk.muted ? 'rgba(140,140,150,.25)' : sel ? 'rgba(225,29,42,.38)' : 'rgba(90,140,220,.30)';
      ctx.fillRect(x, y + 4, cw, TRACK_H - 10);
      ctx.strokeStyle = sel ? '#e11d2a' : 'rgba(255,255,255,.22)';
      ctx.lineWidth = sel ? 2 : 1;
      ctx.strokeRect(x + 0.5, y + 4.5, cw - 1, TRACK_H - 11);
      if (cw > 34) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 3, y + 4, cw - 6, TRACK_H - 10);
        ctx.clip();
        ctx.fillStyle = fg;
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillText(c.name || c.ref || c.type, x + 6, y + TRACK_H / 2 + 3);
        ctx.restore();
      }
    }
  }

  function drawAutomationTrack(trk, index, y, w, accent, dim) {
    const top = y + 5;
    const bot = y + TRACK_H - 6;
    const keys = trk.keys;
    if (!keys.length) {
      ctx.fillStyle = dim;
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillText(trk.target || '—', 6, y + TRACK_H / 2 + 3);
      return;
    }
    /* Eğri piksel piksel örneklenir: segment eğrisi doğrusal olmadığı için
       anahtarları düz çizgiyle birleştirmek yanlış şekil gösterirdi. */
    ctx.strokeStyle = trk.muted ? dim : accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let px = 0; px <= w; px += 2) {
      const v = TL().evalKeys(keys, tOf(px));
      const yy = bot - (bot - top) * Math.max(0, Math.min(1, v));
      if (px === 0) ctx.moveTo(px, yy);
      else ctx.lineTo(px, yy);
    }
    ctx.stroke();

    for (let ki = 0; ki < keys.length; ki++) {
      const k = keys[ki];
      const x = xOf(k.t);
      if (x < -6 || x > w + 6) continue;
      const yy = bot - (bot - top) * Math.max(0, Math.min(1, k.v));
      const sel = selection && selection.trackIndex === index && selection.keyIndex === ki;
      ctx.fillStyle = sel ? '#fff' : accent;
      ctx.beginPath();
      ctx.arc(x, yy, sel ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --------------------------------------------------------------------------
  // Vuruş testi ve sürükleme
  // --------------------------------------------------------------------------
  function hit(x, y) {
    const tl = ensureTransport().tl;
    if (y < RULER_H) return { kind: 'ruler' };
    const index = Math.floor((y - RULER_H) / TRACK_H);
    const trk = tl.tracks[index];
    if (!trk) return null;
    if (trk.kind === 'clip') {
      for (let ci = trk.clips.length - 1; ci >= 0; ci--) {
        const c = trk.clips[ci];
        const cx = xOf(c.start);
        const cw = c.dur * view().zoom;
        if (x < cx - 4 || x > cx + cw + 4) continue;
        /* Kenarlardan 6 piksellik şerit kırpma; ortası taşıma. Şeridi daha dar
           yapmak kırpmayı isabet edilemez hale getiriyordu. */
        const edge = Math.min(6, cw / 3);
        if (x <= cx + edge) return { kind: 'trimL', index, ci };
        if (x >= cx + cw - edge) return { kind: 'trimR', index, ci };
        return { kind: 'move', index, ci };
      }
      return { kind: 'track', index };
    }
    const top = RULER_H + index * TRACK_H + 5;
    const bot = RULER_H + (index + 1) * TRACK_H - 6;
    for (let ki = 0; ki < trk.keys.length; ki++) {
      const k = trk.keys[ki];
      const kx = xOf(k.t);
      const ky = bot - (bot - top) * Math.max(0, Math.min(1, k.v));
      if (Math.abs(x - kx) <= 6 && Math.abs(y - ky) <= 6) return { kind: 'key', index, ki };
    }
    return { kind: 'autotrack', index, top, bot };
  }

  function snap(t, suspend) {
    const cfg = tlCfg();
    if (suspend) return Math.max(0, t);
    return Math.max(0, TL().snapSeconds(ensureTransport().tl.tempo, t, cfg.snap, cfg.fps));
  }

  function commit() {
    /* Modelden yapılandırmaya geri yaz. Model her çizimde yeniden kurulduğu
       için kaynak veriyi güncellemeden hiçbir değişiklik kalıcı olmaz. */
    const tl = transport.tl;
    const cfg = tlCfg();
    cfg.tracks = tl.tracks;
    cfg.markers = tl.markers;
    cfg.loop = tl.loop;
    P().push(true);
  }

  function bindCanvas(cv) {
    canvas = cv;
    ctx = cv.getContext('2d');

    cv.addEventListener('mousedown', (e) => {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const h = hit(x, y);
      if (!h) return;
      if (h.kind === 'ruler') {
        // Cetvele tıklamak sürüklemedir: duraklatılmışken de sahne güncellenir
        transport.seek(snap(tOf(x), e.altKey));
        applyClipsAt(transport.time);
        reanchor();
        drag = { kind: 'scrub' };
        draw();
        return;
      }
      const tl = transport.tl;
      const trk = tl.tracks[h.index];
      if (trk && trk.locked) return;
      if (h.kind === 'move' || h.kind === 'trimL' || h.kind === 'trimR') {
        const c = trk.clips[h.ci];
        selection = { trackIndex: h.index, clipIndex: h.ci };
        drag = { kind: h.kind, index: h.index, ci: h.ci, t0: tOf(x), start0: c.start, dur0: c.dur };
      } else if (h.kind === 'key') {
        selection = { trackIndex: h.index, keyIndex: h.ki };
        drag = { kind: 'key', index: h.index, ki: h.ki, top: RULER_H + h.index * TRACK_H + 5, bot: RULER_H + (h.index + 1) * TRACK_H - 6 };
      } else if (h.kind === 'autotrack' && e.detail === 2) {
        // Çift tıklama otomasyon parçasına anahtar ekler
        const v = Math.max(0, Math.min(1, (h.bot - y) / (h.bot - h.top)));
        trk.keys = TL().sortKeys(trk.keys.concat([{ t: snap(tOf(x), e.altKey), v }]));
        commit();
      } else {
        selection = null;
      }
      draw();
    });

    window.addEventListener('mousemove', (e) => {
      if (!drag || !canvas || !canvas.isConnected) return;
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const tl = transport.tl;
      if (drag.kind === 'scrub') {
        transport.seek(snap(tOf(x), e.altKey));
        applyClipsAt(transport.time);
        reanchor();
      } else if (drag.kind === 'key') {
        const k = tl.tracks[drag.index].keys[drag.ki];
        k.t = snap(tOf(x), e.altKey);
        k.v = Math.max(0, Math.min(1, (drag.bot - y) / (drag.bot - drag.top)));
        tl.tracks[drag.index].keys = TL().sortKeys(tl.tracks[drag.index].keys);
      } else {
        const c = tl.tracks[drag.index].clips[drag.ci];
        const delta = tOf(x) - drag.t0;
        if (drag.kind === 'move') {
          c.start = snap(drag.start0 + delta, e.altKey);
        } else if (drag.kind === 'trimL') {
          const ns = snap(drag.start0 + delta, e.altKey);
          const end = drag.start0 + drag.dur0;
          c.start = Math.min(ns, end - 0.05);
          c.dur = end - c.start;
        } else {
          c.dur = Math.max(0.05, snap(drag.start0 + drag.dur0 + delta, e.altKey) - c.start);
        }
        tl.tracks[drag.index].clips.sort((a, b) => a.start - b.start);
      }
      draw();
    });

    window.addEventListener('mouseup', () => {
      if (!drag) return;
      const wasEdit = drag.kind !== 'scrub';
      drag = null;
      if (wasEdit) commit();
    });

    /* Tekerlek yakınlaştırır (Ctrl) ya da kaydırır. İmlecin altındaki an
       sabit kalacak şekilde yakınlaştırılır; aksi halde yakınlaştırma
       kullanıcının baktığı yeri kaçırır. */
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const cfg = tlCfg();
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left;
      if (e.ctrlKey || e.metaKey) {
        const anchorT = tOf(x);
        const nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view().zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        cfg.zoom = nz;
        cfg.scroll = Math.max(0, anchorT - (x - HEAD_W) / nz);
      } else {
        cfg.scroll = Math.max(0, view().scroll + (e.deltaY > 0 ? 1 : -1) * (40 / view().zoom));
      }
      draw();
    }, { passive: false });
  }

  /* Taşıma durumunu değiştiren TEK kapı. transport() nesnesini alıp
     doğrudan play() çağırmak çıpayı yenilemez; panel düğmeleri reanchor()
     çağırdığı için çalışır ama MIDI/OSC eşlemeleri ve başka her programlı
     çağıran sessizce kırılırdı: oynatma kafası yerinde kalır,
     görselleştiriciler eski çıpaya bakmaya devam ederdi. */
  function play() {
    ensureTransport().play();
    reanchor();
    start();
  }
  function pause() {
    syncTransportFromAnchor();
    ensureTransport().pause();
    reanchor();
  }
  function stop() {
    ensureTransport().stop();
    lastAppliedClip.clear();
    reanchor();
  }
  function seek(t) {
    ensureTransport().seek(t);
    reanchor();
  }

  const api = {
    panel,
    start,
    play,
    pause,
    stop,
    seek,
    transport: () => syncTransportFromAnchor(),
    /* Öz test ve dış denetim için: paneli açmadan taşımayı sürebilmek. */
    _draw: () => draw(),
  };

  if (typeof window !== 'undefined') window.SVTimelinePanel = api;

  // --------------------------------------------------------------------------
  // Panel arayüzü
  // --------------------------------------------------------------------------
  function panel() {
    const p = P();
    const el = p.el;
    const cfg = tlCfg();
    const tl = ensureTransport().tl;
    const host = el('div', { class: 'tl-panel' });

    // --- Açma anahtarı ---
    host.appendChild(
      p.row(
        'Zaman Çizelgesini Etkinleştir',
        (() => {
          const box = el('input', { type: 'checkbox' });
          box.checked = !!cfg.enabled;
          box.addEventListener('change', () => {
            cfg.enabled = box.checked;
            if (!box.checked) {
              ensureTransport().pause();
              reanchor();
            }
            p.apply();
          });
          return el('label', { class: 'switch' }, [box, el('span', { class: 'track' })]);
        })()
      )
    );

    if (!cfg.enabled) {
      host.appendChild(
        el('div', {
          class: 'ctrl settings-io-note',
          text: 'Zaman çizelgesi kapalı. Açtığınızda oynatma kafası tüm görselleştirici ekranlarını birlikte sürer.',
        })
      );
      return host;
    }

    // --- Taşıma ---
    const timeLabel = el('span', { class: 'tl-time', text: '0:00' });
    const barLabel = el('span', { class: 'tl-bars', text: '1.1' });

    const btn = (text, title, fn) => {
      const b = el('button', { class: 'btn tl-btn', type: 'button', text, title });
      b.addEventListener('click', fn);
      return b;
    };

    const transportRow = el('div', { class: 'tl-transport' }, [
      btn('▶', 'Oynat', () => {
        play();
      }),
      btn('⏸', 'Duraklat', () => {
        pause();
      }),
      btn('⏹', 'Durdur ve başa dön', () => {
        stop();
        draw();
      }),
      btn('⏮', 'Önceki işaret', () => {
        const m = TL().markerBefore(ensureTransport().tl, transport.time);
        transport.seek(m ? m.t : 0);
        reanchor();
        draw();
      }),
      btn('⏭', 'Sonraki işaret', () => {
        const m = TL().markerAfter(ensureTransport().tl, transport.time);
        if (m) transport.seek(m.t);
        reanchor();
        draw();
      }),
      timeLabel,
      barLabel,
    ]);
    host.appendChild(transportRow);

    /* Zaman göstergesini döngüden değil kendi zamanlayıcısından güncelle:
       çizim döngüsü yalnızca oynatırken çalışıyor ama sürüklerken de okunmalı. */
    const tick = setInterval(() => {
      if (!timeLabel.isConnected) {
        clearInterval(tick);
        return;
      }
      const tr = ensureTransport();
      timeLabel.textContent = fmtTime(tr.time);
      const b = tr.bars();
      barLabel.textContent = b.bar + '.' + b.beat;
    }, 100);

    // --- Tempo, yakalama, döngü ---
    const tempo0 = tl.tempo[0];
    host.appendChild(
      p.row(
        'Tempo (BPM)',
        numInput(tempo0.bpm, 1, 999, 0.1, (v) => {
          cfg.tempo = [{ t: 0, bpm: v, beatsPerBar: tempo0.beatsPerBar }];
          p.apply();
        })
      )
    );
    host.appendChild(
      p.row(
        'Ölçüdeki Vuruş',
        numInput(tempo0.beatsPerBar, 1, 16, 1, (v) => {
          cfg.tempo = [{ t: 0, bpm: tempo0.bpm, beatsPerBar: Math.round(v) }];
          p.apply();
        })
      )
    );
    host.appendChild(
      p.row(
        'Yakalama',
        select(
          [
            ['off', 'Kapalı'],
            ['bar', 'Ölçü'],
            ['beat', 'Vuruş'],
            ['half', 'Yarım Vuruş'],
            ['quarter', 'Çeyrek Vuruş'],
            ['frame', 'Kare'],
          ],
          cfg.snap,
          (v) => {
            cfg.snap = v;
            p.push(true);
          }
        )
      )
    );
    host.appendChild(
      el('div', {
        class: 'ctrl settings-io-note',
        text: 'Sürüklerken Alt tuşu yakalamayı geçici olarak kapatır. Tekerlek kaydırır, Ctrl+tekerlek yakınlaştırır.',
      })
    );
    host.appendChild(
      p.row(
        'Cetvel',
        select(
          [
            ['both', 'Süre ve Ölçü'],
            ['time', 'Yalnızca Süre'],
            ['bars', 'Yalnızca Ölçü'],
          ],
          cfg.ruler,
          (v) => {
            cfg.ruler = v;
            p.push(true);
            draw();
          }
        )
      )
    );

    // --- Döngü bölgesi ---
    const loopBox = el('input', { type: 'checkbox' });
    loopBox.checked = !!tl.loop.enabled;
    loopBox.addEventListener('change', () => {
      cfg.loop = Object.assign({}, cfg.loop, { enabled: loopBox.checked });
      p.apply();
      reanchor();
    });
    host.appendChild(p.row('Döngü Bölgesi', el('label', { class: 'switch' }, [loopBox, el('span', { class: 'track' })])));
    host.appendChild(
      el('div', { class: 'ctrl' }, [
        el('div', { class: 'row' }, [
          el('label', { class: 'lbl', text: 'Döngü Başı / Sonu' }),
          el('div', { class: 'tl-inline' }, [
            numInput(tl.loop.start, 0, 1e6, 0.01, (v) => {
              cfg.loop = Object.assign({}, cfg.loop, { start: v });
              p.apply();
              reanchor();
            }),
            numInput(tl.loop.end, 0, 1e6, 0.01, (v) => {
              cfg.loop = Object.assign({}, cfg.loop, { end: v });
              p.apply();
              reanchor();
            }),
            (() => {
              const b = el('button', { class: 'btn small', type: 'button', text: 'Kafadan Başlat' });
              b.addEventListener('click', () => {
                cfg.loop = Object.assign({}, cfg.loop, { start: ensureTransport().time });
                p.apply();
              });
              return b;
            })(),
          ]),
        ]),
      ])
    );

    // --- Tuval ---
    const cv = el('canvas', { class: 'tl-canvas' });
    host.appendChild(el('div', { class: 'tl-canvas-wrap' }, [cv]));
    /* bindCanvas bir sonraki karede: canvas henüz DOM'a girmediği için
       clientWidth 0 döner ve ilk çizim boş kalırdı. */
    requestAnimationFrame(() => {
      bindCanvas(cv);
      draw();
      start();
    });

    // --- Parça listesi ---
    host.appendChild(trackList());

    // --- Seçili öğe ---
    host.appendChild(inspector());

    // --- İşaretler ---
    host.appendChild(markerSection());

    return host;
  }

  function numInput(value, min, max, step, onChange) {
    const el = P().el;
    const i = el('input', { class: 'num tl-num', type: 'number', min: String(min), max: String(max), step: String(step) });
    i.value = String(Math.round(value * 1000) / 1000);
    i.addEventListener('change', () => {
      const v = Number(i.value);
      if (!isFinite(v)) {
        i.value = String(value);
        return;
      }
      onChange(Math.max(min, Math.min(max, v)));
    });
    return i;
  }

  function select(pairs, value, onChange) {
    const el = P().el;
    const s = el('select', { class: 'sel' });
    for (const [v, label] of pairs) {
      const o = el('option', { value: v, text: label });
      if (v === value) o.selected = true;
      s.appendChild(o);
    }
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }

  function trackList() {
    const p = P();
    const el = p.el;
    const cfg = tlCfg();
    const tl = ensureTransport().tl;
    const box = el('div', { class: 'tl-tracks' });

    tl.tracks.forEach((trk, i) => {
      const name = el('input', { class: 'txt tl-trackname', type: 'text', value: trk.name });
      name.addEventListener('change', () => {
        trk.name = name.value.trim() || trk.name;
        commit();
      });

      const mute = el('button', { class: 'btn small' + (trk.muted ? ' on' : ''), type: 'button', text: trk.muted ? 'Sessiz' : 'Açık', title: 'Sustur' });
      mute.addEventListener('click', () => {
        trk.muted = !trk.muted;
        commit();
        p.rerender();
      });

      const lock = el('button', { class: 'btn small' + (trk.locked ? ' on' : ''), type: 'button', text: trk.locked ? '🔒' : '🔓', title: 'Kilitle' });
      lock.addEventListener('click', () => {
        trk.locked = !trk.locked;
        commit();
        p.rerender();
      });

      const del = el('button', { class: 'btn small danger', type: 'button', text: '✕', title: 'Parçayı sil' });
      del.addEventListener('click', async () => {
        if (!(await p.confirm('Bu parça ve içindeki her şey silinecek.', { danger: true, okText: 'Sil' }))) return;
        tl.tracks.splice(i, 1);
        selection = null;
        commit();
        p.rerender();
      });

      const row = el('div', { class: 'tl-track-row' }, [
        el('span', { class: 'tl-kind', text: trk.kind === 'clip' ? 'Klip' : 'Otomasyon' }),
        name,
        mute,
        lock,
        del,
      ]);

      if (trk.kind === 'automation') {
        const target = el('input', { class: 'txt tl-target', type: 'text', value: trk.target, placeholder: 'ör. postfx.0.params.strength' });
        target.addEventListener('change', () => {
          trk.target = target.value.trim();
          commit();
        });
        row.appendChild(target);
        row.appendChild(
          numInput(trk.min, -1e6, 1e6, 0.01, (v) => {
            trk.min = v;
            commit();
          })
        );
        row.appendChild(
          numInput(trk.max, -1e6, 1e6, 0.01, (v) => {
            trk.max = v;
            commit();
          })
        );
      }
      box.appendChild(row);
    });

    const addClip = el('button', { class: 'btn', type: 'button', text: '＋ Klip Parçası' });
    addClip.addEventListener('click', () => {
      tl.tracks.push(TL().makeTrack({ kind: 'clip', name: 'Parça ' + (tl.tracks.length + 1) }));
      commit();
      p.rerender();
    });
    const addAuto = el('button', { class: 'btn', type: 'button', text: '＋ Otomasyon Parçası' });
    addAuto.addEventListener('click', () => {
      tl.tracks.push(TL().makeTrack({ kind: 'automation', name: 'Otomasyon ' + (tl.tracks.length + 1) }));
      commit();
      p.rerender();
    });
    box.appendChild(el('div', { class: 'tl-actions' }, [addClip, addAuto]));
    return box;
  }

  function inspector() {
    const p = P();
    const el = p.el;
    const tl = ensureTransport().tl;
    const box = el('div', { class: 'tl-inspector' });
    if (!selection) {
      box.appendChild(el('div', { class: 'ctrl settings-io-note', text: 'Bir klip ya da anahtar kare seçin.' }));
      return box;
    }
    const trk = tl.tracks[selection.trackIndex];
    if (!trk) return box;

    if (selection.clipIndex != null && trk.clips) {
      const c = trk.clips[selection.clipIndex];
      if (!c) return box;
      box.appendChild(p.row('Klip Adı', textInput(c.name, (v) => { c.name = v; commit(); })));
      box.appendChild(
        p.row('Tür', select(
          [['scene', 'Sahne'], ['preset', 'Şablon'], ['video', 'Video'], ['image', 'Görsel'], ['shader', 'Shader'], ['action', 'Eylem']],
          c.type,
          (v) => { c.type = v; commit(); }
        ))
      );
      box.appendChild(p.row('Kaynak Kimliği', textInput(c.ref, (v) => { c.ref = v; commit(); })));
      box.appendChild(p.row('Başlangıç (sn)', numInput(c.start, 0, 1e6, 0.01, (v) => { c.start = v; commit(); })));
      box.appendChild(p.row('Süre (sn)', numInput(c.dur, 0.05, 1e6, 0.01, (v) => { c.dur = v; commit(); })));
      box.appendChild(p.row('Kırpma Başı (sn)', numInput(c.inPoint, 0, 1e6, 0.01, (v) => { c.inPoint = v; commit(); })));
      box.appendChild(p.row('Hız', numInput(c.speed, 0.05, 20, 0.01, (v) => { c.speed = v; commit(); })));
      const del = el('button', { class: 'btn danger', type: 'button', text: 'Klibi Sil' });
      del.addEventListener('click', () => {
        trk.clips.splice(selection.clipIndex, 1);
        selection = null;
        commit();
        p.rerender();
      });
      const add = el('button', { class: 'btn', type: 'button', text: '＋ Kafada Yeni Klip' });
      add.addEventListener('click', () => {
        trk.clips.push(TL().makeClip({ start: ensureTransport().time, dur: 4 }));
        trk.clips.sort((a, b) => a.start - b.start);
        commit();
        p.rerender();
      });
      box.appendChild(el('div', { class: 'tl-actions' }, [add, del]));
      return box;
    }

    if (selection.keyIndex != null && trk.keys) {
      const k = trk.keys[selection.keyIndex];
      if (!k) return box;
      box.appendChild(p.row('Zaman (sn)', numInput(k.t, 0, 1e6, 0.01, (v) => { k.t = v; trk.keys = TL().sortKeys(trk.keys); commit(); })));
      box.appendChild(p.row('Değer (0..1)', numInput(k.v, 0, 1, 0.001, (v) => { k.v = v; commit(); })));
      const curves = (window.SVModulation && window.SVModulation.CURVE_IDS) || ['linear'];
      box.appendChild(
        p.row('Segment Eğrisi', select(curves.map((c) => [c, curveLabel(c)]), k.curve, (v) => { k.curve = v; commit(); }))
      );
      const del = el('button', { class: 'btn danger', type: 'button', text: 'Anahtarı Sil' });
      del.addEventListener('click', () => {
        trk.keys.splice(selection.keyIndex, 1);
        selection = null;
        commit();
        p.rerender();
      });
      box.appendChild(el('div', { class: 'tl-actions' }, [del]));
    }
    return box;
  }

  function curveLabel(id) {
    const map = {
      linear: 'Doğrusal', exp: 'Üstel', exp3: 'Üstel (küp)', log: 'Logaritmik',
      scurve: 'S Eğrisi', ease: 'Yumuşak', abs: 'Mutlak',
    };
    return map[id] || id;
  }

  function textInput(value, onChange) {
    const i = P().el('input', { class: 'txt', type: 'text', value: value || '' });
    i.addEventListener('change', () => onChange(i.value.trim()));
    return i;
  }

  function markerSection() {
    const p = P();
    const el = p.el;
    const tl = ensureTransport().tl;
    const box = el('div', { class: 'tl-markers' });

    tl.markers.forEach((m, i) => {
      const name = el('input', { class: 'txt', type: 'text', value: m.name, placeholder: 'İşaret adı' });
      name.addEventListener('change', () => {
        m.name = name.value.trim();
        commit();
      });
      const go = el('button', { class: 'btn small', type: 'button', text: '→', title: 'Bu işarete git' });
      go.addEventListener('click', () => {
        ensureTransport().seek(m.t);
        reanchor();
        draw();
      });
      const del = el('button', { class: 'btn small danger', type: 'button', text: '✕' });
      del.addEventListener('click', () => {
        tl.markers.splice(i, 1);
        commit();
        p.rerender();
      });
      box.appendChild(
        el('div', { class: 'tl-marker-row' }, [
          numInput(m.t, 0, 1e6, 0.01, (v) => {
            m.t = v;
            tl.markers.sort((a, b) => a.t - b.t);
            commit();
          }),
          name,
          go,
          del,
        ])
      );
    });

    const add = el('button', { class: 'btn', type: 'button', text: '＋ Kafada İşaret' });
    add.addEventListener('click', () => {
      tl.markers.push(TL().makeMarker({ t: ensureTransport().time, name: 'İşaret ' + (tl.markers.length + 1) }));
      tl.markers.sort((a, b) => a.t - b.t);
      commit();
      p.rerender();
    });

    /* Sözlerden işaret üretimi mevcut LRC/SRT ayrıştırıcısını kullanır; ikinci
       bir ayrıştırıcı zamanla birincisinden ayrılırdı. */
    const fromLyrics = el('button', { class: 'btn', type: 'button', text: 'Sözlerden İşaret Üret' });
    fromLyrics.addEventListener('click', () => {
      const cues = (p.cfg().text && p.cfg().text.lyrics && p.cfg().text.lyrics.cues) || [];
      if (!cues.length) {
        p.toast('Önce Metin bölümünden bir LRC ya da SRT dosyası yükleyin.', 'warn');
        return;
      }
      tl.markers = TL().markersFromCues(cues);
      commit();
      p.rerender();
      p.toast(tl.markers.length + ' işaret üretildi.', 'ok');
    });

    box.appendChild(el('div', { class: 'tl-actions' }, [add, fromLyrics]));
    return box;
  }
})();
