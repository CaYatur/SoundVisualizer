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
 *
 * DÜZENLEYİCİ (#636). Önce ~90 piksellik bir tuval, üstünde bir yığın form
 * satırıydı; parça listesi tuvalden ayrı bir bloktu. Artık bir DAW'daki
 * düzen: üstte tek satır araç çubuğu, ortada parça başlıkları ile şeritler
 * yan yana ve boyu ayarlanabilir bir düzenleme alanı, altta seçili öğenin
 * denetçisi; seyrek değişen ayarlar katlanmış bir bölümde. Düzenleme
 * işlemleri (böl, çoğalt, geri al) shared/timeline-edit.js'te, sınanıyor.
 */
(function () {
  const P = () => window.SVPanel;
  const TL = () => window.SVTimeline;
  const TE = () => window.SVTimelineEdit;
  const tt = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);

  // Ölçüler
  const TRACK_H = 40;
  const RULER_H = 38; // üstte ölçü ve süre, altta işaret bayrakları
  const HEAD_W = 0; // parça başlıkları tuvalin solunda ayrı bir sütun; tuval yalnız zamanı çiziyor
  const MIN_ZOOM = 4; // saniye başına piksel
  const MAX_ZOOM = 400;
  const BODY_H = 280; // düzenleme alanının varsayılan boyu

  // --------------------------------------------------------------------------
  // Kalıcı durum — panel yeniden çizilse de yaşamaya devam eder
  // --------------------------------------------------------------------------
  let transport = null;
  let raf = 0;
  let lastFrame = 0;
  /* Seçim KİMLİKLE tutuluyor (#636): geri alma, sıralama ve silme sıraları
     değiştiriyor; sırayla tutulan seçim başka bir klibi gösterirdi.
     { kind: 'clip', trackId, clipId } | { kind: 'key', trackId, keyIndex }
     | { kind: 'track', trackId } */
  let selection = null;
  let drag = null;
  let canvas = null;
  let ctx = null;
  let lastAnchorKey = '';
  let clipboard = null;
  let hist = null; // geri al / yinele (shared/timeline-edit.js History)
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

  /* Model YALNIZCA gerektiğinde yeniden kurulur.

     Önceden her çağrıda kuruluyordu ve döngü bunu her karede çağırıyor.
     Sonuç: panel çizilirken yakalanan model nesnesi, kullanıcı bir düğmeye
     bastığı anda çoktan atılmış oluyordu. Yeni parça eski nesneye
     ekleniyor, commit() ise taze nesneyi yapılandırmaya yazıyordu — yani
     "＋ Klip Parçası" hiçbir şey yapmıyor, üstelik hata da vermiyordu.

     Artık yeniden kurma iki yerde tetikleniyor: panel her çizildiğinde
     (yapılandırma dışarıdan değişmiş olabilir) ve yapılandırma yazıldıktan
     sonra. Aradaki düzenlemeler tek ve yaşayan bir nesne üzerinde. */
  let modelDirty = true;

  function invalidateModel() {
    modelDirty = true;
  }

  function ensureTransport() {
    if (!transport) {
      transport = new (TL().Transport)(tlModel());
      modelDirty = false;
    } else if (modelDirty) {
      transport.tl = tlModel();
      modelDirty = false;
    }
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
    /* Oynatma kafasını görüş alanında tut. Yapılandırmada bu ayar vardı
       ama hiç uygulanmamıştı: oynatınca kafa sağdan çıkıp kayboluyor ve
       çizelge donmuş gibi görünüyordu. */
    if (tr.playing && tlOn && full.timeline.followPlayhead !== false && canvas && canvas.clientWidth) {
      const v = view();
      const span = canvas.clientWidth / v.zoom;
      if (tr.time < v.scroll || tr.time > v.scroll + span * 0.85) {
        full.timeline.scroll = Math.max(0, tr.time - span * 0.15);
      }
    }
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
  // Seçim yardımcıları
  // --------------------------------------------------------------------------
  function trackById(id) {
    const tl = ensureTransport().tl;
    return tl.tracks.find((t) => t.id === id) || null;
  }
  function trackIndex(id) {
    return ensureTransport().tl.tracks.findIndex((t) => t.id === id);
  }
  function selTrack() {
    return selection ? trackById(selection.trackId) : null;
  }
  function selClip() {
    if (!selection || selection.kind !== 'clip') return null;
    const trk = selTrack();
    return trk && trk.clips ? trk.clips.find((c) => c.id === selection.clipId) || null : null;
  }

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

  function rgba(hex, a) {
    const n = parseInt(String(hex).slice(1), 16) || 0;
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function draw() {
    if (!canvas || !ctx || !canvas.isConnected) return;
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
    const solo = TL().anySolo ? TL().anySolo(tl) : false;

    // --- Şerit zeminleri: tek ve çift şerit ayrı tonda, seçili parça belirgin ---
    for (let i = 0; i < tl.tracks.length; i++) {
      const y = RULER_H + i * TRACK_H;
      const trk = tl.tracks[i];
      const picked = selection && selection.trackId === trk.id;
      ctx.fillStyle = picked ? 'rgba(255,255,255,.05)' : i % 2 ? 'rgba(255,255,255,.018)' : 'rgba(0,0,0,0)';
      ctx.fillRect(0, y, w, TRACK_H);
    }

    // --- Izgara ve cetvel ---
    drawRuler(w, h, tl, fg, dim, line);

    // --- Döngü bölgesi: cetvelde belirgin bant, şeritlerde hafif örtü ---
    if (tl.loop.enabled) {
      const lx = xOf(tl.loop.start);
      const lw = (tl.loop.end - tl.loop.start) * view().zoom;
      ctx.fillStyle = 'rgba(120,180,255,.08)';
      ctx.fillRect(lx, RULER_H, lw, h - RULER_H);
      ctx.fillStyle = 'rgba(120,180,255,.55)';
      ctx.fillRect(lx, 0, lw, 4);
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
      const live = TL().audible ? TL().audible(trk, solo) : !trk.muted;
      if (trk.kind === 'clip') drawClipTrack(trk, y, w, fg, live);
      else drawAutomationTrack(trk, i, y, w, accent, dim, live);
    }

    // --- İşaretler: cetvelde bayrak, şeritlerde ince çizgi ---
    ctx.font = '10px system-ui, sans-serif';
    for (const m of tl.markers) {
      const x = xOf(m.t);
      if (x < -2 || x > w + 2) continue;
      ctx.strokeStyle = 'rgba(240,180,41,.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, RULER_H);
      ctx.lineTo(Math.round(x) + 0.5, h);
      ctx.stroke();
      // Bayrak cetvelin alt bandında: ölçü ve süre yazılarının altında
      ctx.fillStyle = '#f0b429';
      ctx.beginPath();
      ctx.moveTo(x, RULER_H - 11);
      ctx.lineTo(x + 7, RULER_H - 7);
      ctx.lineTo(x, RULER_H - 3);
      ctx.closePath();
      ctx.fill();
      if (m.name) ctx.fillText(m.name, x + 9, RULER_H - 3);
    }

    // --- Oynatma kafası: çizgi ve cetvelde üçgen ---
    const px = xOf(transport.time);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, RULER_H - 2);
    ctx.lineTo(px, h);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(px - 6, RULER_H - 10);
    ctx.lineTo(px + 6, RULER_H - 10);
    ctx.lineTo(px, RULER_H - 2);
    ctx.closePath();
    ctx.fill();
  }

  /* Cetvel: yakınlaştırmaya göre ızgara sıklığı seçilir. Sabit bir aralık,
     uzaklaşınca çizgi gürültüsüne, yakınlaşınca boş alana dönüşürdü.
     Ölçü çizgileri şeritlere de iniyor: klibi ölçüye göre yerleştirmek
     gözle yapılabilsin. */
  function drawRuler(w, h, tl, fg, dim, line) {
    const cfg = tlCfg();
    const v = view();
    ctx.fillStyle = 'rgba(255,255,255,.04)';
    ctx.fillRect(0, 0, w, RULER_H);

    const showBars = cfg.ruler !== 'time';
    const showTime = cfg.ruler !== 'bars';

    // Ölçü ızgarası şeritlerde: etiketlerden bağımsız, ölçü başına bir çizgi
    const b0 = TL().secondsToBars(tl.tempo, v.scroll);
    const barSec = TL().barsToSeconds(tl.tempo, b0.bar + 1, 1) - TL().barsToSeconds(tl.tempo, b0.bar, 1);
    if (barSec * v.zoom >= 14) {
      ctx.strokeStyle = 'rgba(255,255,255,.05)';
      ctx.lineWidth = 1;
      for (let bar = b0.bar; ; bar++) {
        const x = Math.round(xOf(TL().barsToSeconds(tl.tempo, bar, 1))) + 0.5;
        if (x > w + 1) break;
        if (x < 0) continue;
        ctx.beginPath();
        ctx.moveTo(x, RULER_H);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
    }

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
      ctx.moveTo(x, RULER_H - 8);
      ctx.lineTo(x, RULER_H);
      ctx.stroke();
      if (showBars) {
        const b = TL().secondsToBars(tl.tempo, t);
        ctx.fillStyle = fg;
        ctx.fillText(b.bar + '.' + b.beat, x + 3, 12);
      }
      if (showTime) {
        ctx.fillStyle = dim;
        ctx.fillText(fmtTime(t), x + 3, showBars ? 23 : 12);
      }
    }
    ctx.strokeStyle = line;
    ctx.beginPath();
    ctx.moveTo(0, RULER_H - 0.5);
    ctx.lineTo(w, RULER_H - 0.5);
    ctx.stroke();
  }

  function fmtTime(t) {
    const sign = t < 0 ? '-' : '';
    t = Math.abs(t);
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return sign + m + ':' + (s < 10 ? '0' : '') + (s % 1 ? s.toFixed(2) : s.toFixed(0));
  }

  // Saat göstergesi: her zaman iki ondalık, genişlik oynamasın
  function fmtClock(t) {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  }

  const TYPE_LABELS = {
    scene: 'Sahne', preset: 'Şablon', palette: 'Renk Şablonu', video: 'Video', image: 'Görsel', shader: 'Shader', action: 'Eylem',
  };
  const TYPE_ICONS = { scene: '🎬', preset: '✨', palette: '🎨', video: '🎞', image: '🖼', shader: '🌀', action: '⚡' };

  // Klibin tuvaldeki etiketi: adı, yoksa kaynağının okunur adı (sahne kimliği değil)
  function clipLabel(c) {
    if (c.name) return c.name;
    if (c.ref) {
      if (c.type === 'scene') {
        const sc = (P().cfg().scenes || []).find((s) => s && s.id === c.ref);
        if (sc) return sc.name || sc.id;
      }
      if (c.type === 'preset' && window.SVTemplates) {
        const tp = window.SVTemplates.TEMPLATES.find((x) => x.id === c.ref);
        if (tp) return tt(tp.name);
      }
      return c.ref;
    }
    return tt(TYPE_LABELS[c.type] || c.type) + ' · ' + tt('kaynak yok');
  }

  function drawClipTrack(trk, y, w, fg, live) {
    for (const c of trk.clips) {
      const x = xOf(c.start);
      const cw = Math.max(3, c.dur * view().zoom);
      if (x + cw < 0 || x > w) continue;
      const sel = selection && selection.kind === 'clip' && selection.clipId === c.id;
      const col = TE().clipColor(c, trk);
      const top = y + 4;
      const hh = TRACK_H - 8;
      ctx.globalAlpha = live ? 1 : 0.35;
      ctx.fillStyle = rgba(col, sel ? 0.62 : 0.4);
      ctx.fillRect(x, top, cw, hh);
      ctx.fillStyle = col;
      ctx.fillRect(x, top, cw, 3);
      // Kaynağı seçilmemiş klip çizgili: ateşlendiğinde hiçbir şey olmayacak
      if (!c.ref) {
        ctx.strokeStyle = 'rgba(255,255,255,.18)';
        ctx.lineWidth = 1;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, top, cw, hh);
        ctx.clip();
        for (let k = -hh; k < cw; k += 8) {
          ctx.beginPath();
          ctx.moveTo(x + k, top + hh);
          ctx.lineTo(x + k + hh, top);
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.strokeStyle = sel ? '#ffffff' : rgba(col, 0.9);
      ctx.lineWidth = sel ? 2 : 1;
      ctx.strokeRect(x + 0.5, top + 0.5, cw - 1, hh - 1);
      if (cw > 26) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 3, top, cw - 6, hh);
        ctx.clip();
        ctx.fillStyle = fg;
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.fillText((TYPE_ICONS[c.type] || '') + ' ' + clipLabel(c), x + 6, top + 16);
        if (cw > 80) {
          ctx.font = '10px system-ui, sans-serif';
          ctx.fillStyle = 'rgba(255,255,255,.6)';
          ctx.fillText(fmtTime(c.dur) + (c.fade > 0 ? ' · ⤳ ' + c.fade.toFixed(2) : ''), x + 6, top + hh - 5);
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawAutomationTrack(trk, index, y, w, accent, dim, live) {
    const top = y + 6;
    const bot = y + TRACK_H - 6;
    const keys = trk.keys;
    const col = trk.color || accent;
    ctx.fillStyle = dim;
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText(trk.target || tt('hedef seçilmedi'), 6, y + 13);
    if (!keys.length) return;
    /* Eğri piksel piksel örneklenir: segment eğrisi doğrusal olmadığı için
       anahtarları düz çizgiyle birleştirmek yanlış şekil gösterirdi. */
    ctx.globalAlpha = live ? 1 : 0.35;
    ctx.strokeStyle = col;
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
      const sel = selection && selection.kind === 'key' && selection.trackId === trk.id && selection.keyIndex === ki;
      ctx.fillStyle = sel ? '#fff' : col;
      ctx.beginPath();
      ctx.arc(x, yy, sel ? 4.5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // --------------------------------------------------------------------------
  // Vuruş testi ve sürükleme
  // --------------------------------------------------------------------------
  function hit(x, y) {
    const tl = ensureTransport().tl;
    if (y < RULER_H) return { kind: 'ruler' };
    const index = Math.floor((y - RULER_H) / TRACK_H);
    const trk = tl.tracks[index];
    if (!trk) return { kind: 'none' };
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
    const top = RULER_H + index * TRACK_H + 6;
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

  // --------------------------------------------------------------------------
  // Yazma ve geçmiş
  // --------------------------------------------------------------------------
  function history_() {
    if (!hist) hist = new (TE().History)(100);
    return hist;
  }

  /* Modelden yapılandırmaya geri yaz. Yazdıktan sonra model ile
     yapılandırma aynı; yeniden kurmaya gerek yok ve kurmak, üzerinde
     çalışılan nesneyi kullanıcının elinden alırdı. Her yazım geçmişe bir
     adım ekliyor (aynıysa eklemiyor). */
  function commit() {
    const tl = ensureTransport().tl;
    const cfg = tlCfg();
    cfg.tracks = tl.tracks;
    cfg.markers = tl.markers;
    cfg.loop = tl.loop;
    modelDirty = false;
    history_().push(TE().snapshot(cfg));
    P().push(true);
    refreshToolbar();
  }

  function undo() {
    const s = history_().undo();
    if (s == null) return;
    TE().restore(tlCfg(), s);
    invalidateModel();
    P().push(true);
    refreshAll();
  }

  function redo() {
    const s = history_().redo();
    if (s == null) return;
    TE().restore(tlCfg(), s);
    invalidateModel();
    P().push(true);
    refreshAll();
  }

  /* Düzenleme sonrası yenileme: başlıklar, denetçi, işaret listesi,
     araç çubuğu ve tuval YERİNDE yenileniyor. Bütün paneli yeniden kurmak
     düzenleyicinin odağını düşürüyordu — ölçüldü: Ctrl+D'den sonra gelen
     S, Del ve Ctrl+Z hiçbir yere gitmiyordu. */
  function refreshAll() {
    if (selection && !selTrack()) selection = null;
    refreshHeads();
    refreshInspector();
    refreshMore();
    draw();
  }

  // --------------------------------------------------------------------------
  // Düzenleme eylemleri — araç çubuğu, denetçi ve kısayollar aynı yoldan
  // --------------------------------------------------------------------------
  function addClipAt(trk, at) {
    const c = TL().makeClip({ start: at, dur: TE().gridStep(ensureTransport().tl.tempo, 'bar', 60, at) * 2 });
    trk.clips.push(c);
    TE().sortClips(trk);
    selection = { kind: 'clip', trackId: trk.id, clipId: c.id };
    commit();
    return c;
  }

  // Klip eklenecek parça: seçili klip parçası, yoksa ilk klip parçası, yoksa yeni biri
  function targetClipTrack() {
    const tl = ensureTransport().tl;
    const s = selTrack();
    if (s && s.kind === 'clip') return s;
    let t = tl.tracks.find((x) => x.kind === 'clip');
    if (!t) {
      t = TL().makeTrack({ kind: 'clip', name: tt('Parça') + ' ' + (tl.tracks.length + 1) });
      tl.tracks.push(t);
    }
    return t;
  }

  function deleteSelection() {
    const trk = selTrack();
    if (!trk || trk.locked) return false;
    if (selection.kind === 'clip') {
      const i = trk.clips.findIndex((c) => c.id === selection.clipId);
      if (i < 0) return false;
      trk.clips.splice(i, 1);
    } else if (selection.kind === 'key') {
      if (!trk.keys[selection.keyIndex]) return false;
      trk.keys.splice(selection.keyIndex, 1);
    } else {
      return false;
    }
    selection = null;
    commit();
    return true;
  }

  function duplicateSelection() {
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

  // Oynatma kafasında böl: seçili klip, yoksa seçili parçada kafanın altındaki klip
  function splitAtPlayhead() {
    const trk = selTrack();
    if (!trk || trk.kind !== 'clip' || trk.locked) return false;
    const t = ensureTransport().time;
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
    const c = selClip();
    if (!c) return false;
    clipboard = JSON.parse(JSON.stringify(c));
    return true;
  }

  function pasteAtPlayhead() {
    if (!clipboard) return false;
    const trk = targetClipTrack();
    if (trk.locked) return false;
    const copy = TE().pasteClip(clipboard, snap(ensureTransport().time, false));
    trk.clips.push(copy);
    TE().sortClips(trk);
    selection = { kind: 'clip', trackId: trk.id, clipId: copy.id };
    commit();
    return true;
  }

  // Seçili klibi bir ızgara adımı kaydır; seçim yoksa oynatma kafasını
  function nudge(dir, fine) {
    const tl = ensureTransport().tl;
    const cfg = tlCfg();
    const c = selClip();
    const at = c ? c.start : ensureTransport().time;
    const step = fine ? 1 / Math.max(1, cfg.fps || 60) : TE().gridStep(tl.tempo, cfg.snap, cfg.fps, dir < 0 ? Math.max(0, at - 1e-6) : at);
    if (c) {
      const trk = selTrack();
      if (trk.locked) return false;
      c.start = Math.max(0, c.start + dir * step);
      TE().sortClips(trk);
      commit();
    } else {
      seek(Math.max(0, ensureTransport().time + dir * step));
      applyClipsAt(transport.time);
    }
    draw();
    return true;
  }

  function zoomBy(f, anchorX) {
    const cfg = tlCfg();
    const w = canvas && canvas.clientWidth ? canvas.clientWidth : 800;
    // Varsayılan çıpa: görünürse oynatma kafası, değilse ortası
    let x = anchorX;
    if (x == null) {
      const px = xOf(ensureTransport().time);
      x = px >= 0 && px <= w ? px : w / 2;
    }
    const anchorT = tOf(x);
    const nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view().zoom * f));
    cfg.zoom = nz;
    cfg.scroll = Math.max(0, anchorT - (x - HEAD_W) / nz);
    draw();
  }

  function fitAll() {
    const cfg = tlCfg();
    const w = canvas && canvas.clientWidth ? canvas.clientWidth : 800;
    const v = TE().fitView(TL().timelineLength(ensureTransport().tl), w, MIN_ZOOM, MAX_ZOOM);
    cfg.zoom = v.zoom;
    cfg.scroll = v.scroll;
    draw();
  }

  /* Döngü düğmesi: geçerli bir bölge varsa açıp kapatıyor. Yoksa seçili
     klibin aralığını, o da yoksa kafadan başlayan dört ölçüyü bölge
     yapıp açıyor. Önce yalnız sayı kutuları vardı ve son < baş olduğunda
     döngü sessizce çalışmıyordu. */
  function toggleLoop() {
    const tl = ensureTransport().tl;
    if (!(tl.loop.end > tl.loop.start)) {
      const c = selClip();
      const s = c ? c.start : snap(ensureTransport().time, false);
      const e = c ? c.start + c.dur : s + TE().gridStep(tl.tempo, 'bar', 60, s) * 4;
      tl.loop = { enabled: true, start: s, end: e };
    } else {
      tl.loop = Object.assign({}, tl.loop, { enabled: !tl.loop.enabled });
    }
    commit();
    reanchor();
    draw();
  }

  function addMarkerAtPlayhead() {
    const tl = ensureTransport().tl;
    tl.markers.push(TL().makeMarker({ t: ensureTransport().time, name: tt('İşaret') + ' ' + (tl.markers.length + 1) }));
    tl.markers.sort((a, b) => a.t - b.t);
    commit();
  }

  function togglePlay() {
    if (syncTransportFromAnchor().playing) pause();
    else play();
    refreshToolbar();
  }

  function bindCanvas(cv) {
    canvas = cv;
    ctx = cv.getContext('2d');

    cv.addEventListener('mousedown', (e) => {
      if (e.button != null && e.button !== 0) return;
      // Kısayollar düzenleyici odaktayken çalışıyor: tuvale tıklamak odaklıyor
      const ed = cv.closest ? cv.closest('.tl-editor') : null;
      if (ed && ed.focus) ed.focus({ preventScroll: true });
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const h = hit(x, y);
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
      const before = JSON.stringify(selection);
      /* Sürüklenen öğe NESNESİYLE tutuluyor, sırasıyla değil (#636). Her
         harekette liste yeniden sıralanıyor; sıra tutulduğunda bir klip
         komşusunun ötesine geçince sürükleme komşuya atlıyor ve iki klip
         aynı yere yığılıyordu — ölçüldü: 2 sn'deki A, 5 sn'deki B'nin
         ötesine çekilince ikisi de 8 sn'de kaldı. */
      if (h.kind === 'move' || h.kind === 'trimL' || h.kind === 'trimR') {
        const c = trk.clips[h.ci];
        selection = { kind: 'clip', trackId: trk.id, clipId: c.id };
        // Kilitli parçada seçilebiliyor ama taşınamıyor
        drag = trk.locked ? { kind: 'select' } : { kind: h.kind, trackId: trk.id, clip: c, t0: tOf(x), start0: c.start, dur0: c.dur };
      } else if (h.kind === 'key') {
        selection = { kind: 'key', trackId: trk.id, keyIndex: h.ki };
        drag = trk.locked ? { kind: 'select' } : { kind: 'key', trackId: trk.id, key: trk.keys[h.ki], top: RULER_H + h.index * TRACK_H + 6, bot: RULER_H + (h.index + 1) * TRACK_H - 6 };
      } else if (h.kind === 'track' && e.detail === 2 && !trk.locked) {
        /* Boş bir yere çift tıklamak klip ekler — otomasyon parçasında
           anahtar kare için zaten böyleydi, klip parçasında yoktu. */
        addClipAt(trk, snap(tOf(x), e.altKey));
        P().rerender();
        return;
      } else if (h.kind === 'autotrack' && e.detail === 2 && !trk.locked) {
        // Çift tıklama otomasyon parçasına anahtar ekler
        const v = Math.max(0, Math.min(1, (h.bot - y) / (h.bot - h.top)));
        const k = { t: snap(tOf(x), e.altKey), v, curve: 'linear' };
        trk.keys.push(k);
        trk.keys.sort((a, b) => a.t - b.t);
        selection = { kind: 'key', trackId: trk.id, keyIndex: trk.keys.indexOf(k) };
        commit();
        refreshInspector();
      } else if (trk) {
        // Boş şeride tıklamak parçayı seçiyor: yapıştırma ve bölme oraya
        selection = { kind: 'track', trackId: trk.id };
      } else {
        selection = null;
      }
      // Denetçi seçimi göstermeli: seçim değiştiyse yalnız denetçi yenileniyor
      if (JSON.stringify(selection) !== before) {
        refreshInspector();
        refreshHeads();
      }
      draw();
    });

    /* Tekerlek yakınlaştırır (Ctrl) ya da kaydırır. İmlecin altındaki an
       sabit kalacak şekilde yakınlaştırılır; aksi halde yakınlaştırma
       kullanıcının baktığı yeri kaçırır. Shift ya da yatay tekerlek
       zamanda kaydırıyor; düz tekerlek sayfayı (şerit çoksa alanı)
       kaydırsın diye bırakılıyor. */
    cv.addEventListener('wheel', (e) => {
      const cfg = tlCfg();
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, x);
        return;
      }
      const dx = e.shiftKey ? e.deltaY : e.deltaX;
      if (!dx) return;
      e.preventDefault();
      cfg.scroll = Math.max(0, view().scroll + dx / view().zoom);
      draw();
    }, { passive: false });

    bindWindowOnce();
  }

  /* Pencere dinleyicileri BİR KEZ (#636). Panel her çizildiğinde tuval
     yeniden bağlanıyor; bunlar her seferinde eklendiğinde birikiyordu —
     ölçüldü: on yeniden çizimde 1'den 11'e. Tutucular modül durumunu
     (tuval, taşıma, sürükleme) okuyor, yani tek kopya hepsine yetiyor. */
  let windowBound = false;

  function bindWindowOnce() {
    if (windowBound) return;
    windowBound = true;

    window.addEventListener('mousemove', (e) => {
      if (!drag || !canvas || !canvas.isConnected) return;
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (drag.kind === 'scrub') {
        transport.seek(snap(tOf(x), e.altKey));
        applyClipsAt(transport.time);
        reanchor();
      } else if (drag.kind === 'key') {
        const trk = trackById(drag.trackId);
        const k = drag.key;
        if (!trk || !trk.keys || trk.keys.indexOf(k) < 0) { drag = null; return; }
        k.t = snap(tOf(x), e.altKey);
        k.v = Math.max(0, Math.min(1, (drag.bot - y) / (drag.bot - drag.top)));
        /* Yerinde sıralama: `sortKeys` yeni nesneler kuruyor ve sürüklenen
           anahtarın kimliği kayboluyordu. */
        trk.keys.sort((a, b) => a.t - b.t);
        if (selection && selection.kind === 'key') selection.keyIndex = trk.keys.indexOf(k);
        drag.moved = true;
      } else if (drag.clip) {
        const trk = trackById(drag.trackId);
        const c = drag.clip;
        if (!trk || !trk.clips || trk.clips.indexOf(c) < 0) { drag = null; return; }
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
        TE().sortClips(trk);
        drag.moved = true;
      }
      draw();
    });

    window.addEventListener('mouseup', () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.kind === 'scrub' || d.kind === 'select') return;
      // Yalnız tıklanıp bırakılan klip değişmedi: geçmişe adım eklenmiyor (commit aynıysa eklemiyor)
      commit();
      /* Denetçi seçili öğeyi göstermeli. Önce yalnız tuval yeniden
         çiziliyordu: klibe tıklamak onu seçiyor ama denetçi "Bir klip
         seçin" demeye devam ediyordu. */
      refreshInspector();
    });
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

  // --------------------------------------------------------------------------
  // Klavye (#636). Yalnız düzenleyici odaktayken ve bir metin alanına
  // yazılmıyorken: denetçide ad yazarken Boşluk oynatmamalı, Sil klibi
  // silmemeli. Genel kısayollar (Ctrl+K arama, Esc) dokunulmadan kalıyor.
  // --------------------------------------------------------------------------
  const SHORTCUTS = [
    ['Boşluk', 'Oynat / duraklat'],
    ['Home / End', 'Başa / sona'],
    ['← →', 'Seçili klibi ya da kafayı bir ızgara adımı kaydır (Alt: bir kare)'],
    ['Ctrl+Z / Ctrl+Y', 'Geri al / yinele'],
    ['Ctrl+D', 'Çoğalt'],
    ['S', 'Oynatma kafasında böl'],
    ['Ctrl+C / Ctrl+V', 'Kopyala / kafaya yapıştır'],
    ['Del', 'Sil'],
    ['+ / − / 0', 'Yakınlaştır / uzaklaştır / hepsini sığdır'],
    ['M', 'Kafada işaret'],
    ['L', 'Döngü aç / kapat'],
  ];

  function onEditorKey(e) {
    const tg = e.target;
    const tag = tg && tg.tagName ? tg.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || (tg && tg.isContentEditable)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    let done = true;
    if (k === ' ' || k === 'Spacebar') togglePlay();
    else if (k === 'Home') { seek(0); applyClipsAt(0); draw(); }
    else if (k === 'End') { seek(TL().timelineLength(ensureTransport().tl)); draw(); }
    else if (mod && (k === 'z' || k === 'Z') && !e.shiftKey) undo();
    else if (mod && ((k === 'z' || k === 'Z') && e.shiftKey || k === 'y' || k === 'Y')) redo();
    else if (mod && (k === 'd' || k === 'D')) { if (duplicateSelection()) refreshAll(); }
    else if (mod && (k === 'c' || k === 'C')) copySelection();
    else if (mod && (k === 'v' || k === 'V')) { if (pasteAtPlayhead()) refreshAll(); }
    else if (!mod && (k === 's' || k === 'S')) { if (splitAtPlayhead()) refreshAll(); }
    else if (k === 'Delete' || k === 'Backspace') { if (deleteSelection()) refreshAll(); }
    else if (k === 'ArrowLeft' || k === 'ArrowRight') { nudge(k === 'ArrowLeft' ? -1 : 1, e.altKey); refreshInspector(); }
    else if (!mod && (k === '+' || k === '=')) zoomBy(1.25);
    else if (!mod && (k === '-' || k === '_')) zoomBy(1 / 1.25);
    else if (!mod && k === '0') fitAll();
    else if (!mod && (k === 'm' || k === 'M')) { addMarkerAtPlayhead(); refreshAll(); }
    else if (!mod && (k === 'l' || k === 'L')) { toggleLoop(); refreshToolbar(); }
    else done = false;
    if (done) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  const api = {
    panel,
    start,
    play,
    pause,
    stop,
    seek,
    transport: () => syncTransportFromAnchor(),
    anchor: () => clockAnchor || (window.SVShowClock ? window.SVShowClock.anchorFrom(syncTransportFromAnchor(), Date.now(), syncTransportFromAnchor().tl && syncTransportFromAnchor().tl.loop) : null),
    /* Öz test ve dış denetim için: paneli açmadan taşımayı sürebilmek. */
    _draw: () => draw(),
    // Düzenleme eylemleri (MIDI/OSC ve testler aynı yoldan)
    undo,
    redo,
    split: splitAtPlayhead,
    duplicate: duplicateSelection,
    remove: deleteSelection,
    fit: fitAll,
    toggleLoop,
    _select: (s) => { selection = s; },
    _selection: () => selection,
    _key: onEditorKey,
  };

  if (typeof window !== 'undefined') window.SVTimelinePanel = api;

  // --------------------------------------------------------------------------
  // Panel arayüzü
  // --------------------------------------------------------------------------
  let toolbarRefs = null;
  let headsBox = null;
  let inspectorBox = null;
  let moreBox = null;

  function refreshMore() {
    if (!moreBox || !moreBox.isConnected) return;
    const next = moreSettings();
    moreBox.replaceWith(next);
    moreBox = next;
  }

  function panel() {
    const p = P();
    const el = p.el;
    const cfg = tlCfg();
    /* Panel yeniden çizilirken yapılandırma dışarıdan değişmiş olabilir
       (sahne uygulandı, ayar dosyası yüklendi). Modeli tazele; geçmiş de
       yapılandırmayla uyuşmuyorsa yeni bir tabanla başlıyor. */
    invalidateModel();
    const tl = ensureTransport().tl;
    history_().sync(TE().snapshot(cfg));
    if (selection && !selTrack()) selection = null;
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

    /* Otomatik VJ de sahne değiştiriyor; ikisi aynı anda açıkken sahneyi
       birbirlerinin elinden alırlar. */
    const av = p.cfg().autovj;
    if (av && av.enabled && (av.source === 'scenes' || av.source === 'all')) {
      host.appendChild(
        el('div', {
          class: 'ctrl settings-io-note warn',
          text: 'Otomatik VJ de sahne değiştiriyor. İkisi aynı anda açıkken sahneyi birbirlerinin elinden alır; birini kapatmanız ya da Otomatik VJ kaynağını Renk Şablonları yapmanız daha öngörülebilir olur.',
        })
      );
    }

    host.appendChild(toolbar());

    // --- Düzenleyici: başlıklar + tuval, boyu ayarlanabilir ---
    const cv = el('canvas', { class: 'tl-canvas' });
    headsBox = heads();
    const body = el('div', { class: 'tl-body' }, [headsBox, el('div', { class: 'tl-canvas-wrap' }, [cv])]);
    /* Boy: kullanıcı tutamaktan ayarladıysa o; yoksa parçalara göre (en az
       üç şerit, en çok varsayılan) — iki parçalı bir çizelgenin altında boş
       bir alan kalmasın. */
    const fit = RULER_H + Math.max(3, tl.tracks.length) * TRACK_H + 14;
    body.style.height = Math.max(120, Math.min(1200, Number(cfg.editorHeight) || Math.min(BODY_H + 140, fit))) + 'px';
    // Kullanıcının verdiği boy saklanıyor (tarayıcının boyut tutamağı)
    if (typeof ResizeObserver === 'function') {
      let last = 0;
      const ro = new ResizeObserver(() => {
        if (!body.isConnected) { ro.disconnect(); return; }
        const hh = Math.round(body.getBoundingClientRect().height);
        if (!last) { last = hh; return; }
        if (Math.abs(hh - last) > 2) { last = hh; cfg.editorHeight = hh; draw(); }
      });
      ro.observe(body);
    }
    const editor = el('div', { class: 'tl-editor', tabindex: '0', 'aria-label': 'Zaman çizelgesi düzenleyicisi' }, [body]);
    editor.addEventListener('keydown', onEditorKey);
    host.appendChild(editor);
    /* bindCanvas panel yerleştikten sonra: canvas henüz DOM'a girmediği
       için clientWidth 0 döner ve ilk çizim boş kalırdı. Zamanlayıcıyla,
       requestAnimationFrame ile değil: arka plandaki pencere kare almıyor,
       tuval hiç bağlanmıyor ve fare olayları eski (sökülmüş) tuvale
       bakıyordu (#636). */
    setTimeout(() => {
      bindCanvas(cv);
      draw();
      start();
    });

    /* Boş çizelgede ne yapılacağını SÖYLE. Önce yalnızca boş bir cetvel
       görünüyordu ve kullanıcı orada tıkanıyordu. */
    if (!tl.tracks.length) {
      host.appendChild(
        el('div', {
          class: 'ctrl settings-io-note',
          text: '1) “＋ Klip Parçası” ekleyin. 2) Şeride çift tıklayın ya da “＋ Kafada Klip” ile oynatma kafasına klip koyun. 3) Klibe tıklayıp hangi sahneyi çalacağını seçin.',
        })
      );
    } else if (tl.tracks.some((t) => t.kind === 'clip' && !t.clips.length)) {
      host.appendChild(
        el('div', {
          class: 'ctrl settings-io-note',
          text: 'Parça boş. Şeride çift tıklayın ya da “＋ Kafada Klip” ile oynatma kafasına klip koyun; sonra klibe tıklayıp sahnesini seçin.',
        })
      );
    }

    // --- Eklemeler ---
    const addBtn = (text, title, fn) => {
      const b = el('button', { class: 'btn small', type: 'button', text, title });
      b.addEventListener('click', fn);
      return b;
    };
    host.appendChild(
      el('div', { class: 'tl-actions' }, [
        addBtn('＋ Klip Parçası', 'Sahne, şablon ya da renk klipleri için bir parça', () => {
          const t = TL().makeTrack({ kind: 'clip', name: tt('Parça') + ' ' + (tl.tracks.length + 1) });
          tl.tracks.push(t);
          selection = { kind: 'track', trackId: t.id };
          commit();
          p.rerender();
        }),
        addBtn('＋ Otomasyon Parçası', 'Bir ayarı zamana yayan eğri', () => {
          const t = TL().makeTrack({ kind: 'automation', name: tt('Otomasyon') + ' ' + (tl.tracks.length + 1) });
          tl.tracks.push(t);
          selection = { kind: 'track', trackId: t.id };
          commit();
          p.rerender();
        }),
        addBtn('＋ Kafada Klip', 'Oynatma kafasının bulunduğu yere, seçili (ya da ilk) klip parçasına', () => {
          const trk = targetClipTrack();
          if (trk.locked) {
            p.toast('Parça kilitli.', 'warn');
            return;
          }
          addClipAt(trk, snap(ensureTransport().time, false));
          p.rerender();
        }),
        addBtn('＋ Kafada İşaret', 'Oynatma kafasına adlandırılmış bir işaret (M)', () => {
          addMarkerAtPlayhead();
          p.rerender();
        }),
      ])
    );

    // --- Seçili öğe ---
    inspectorBox = inspector();
    host.appendChild(inspectorBox);

    // --- Seyrek değişen ayarlar ---
    moreBox = moreSettings();
    host.appendChild(moreBox);

    return host;
  }

  // --------------------------------------------------------------------------
  // Araç çubuğu
  // --------------------------------------------------------------------------
  function toolbar() {
    const p = P();
    const el = p.el;
    const cfg = tlCfg();
    const tl = ensureTransport().tl;
    const btn = (text, title, fn, cls) => {
      const b = el('button', { class: 'btn tl-btn' + (cls ? ' ' + cls : ''), type: 'button', text, title });
      b.addEventListener('click', fn);
      return b;
    };
    const group = (kids, cls) => el('div', { class: 'tl-group' + (cls ? ' ' + cls : '') }, kids);

    const playBtn = btn('▶', 'Oynat / duraklat (Boşluk)', () => togglePlay(), 'tl-play');
    const timeLabel = el('span', { class: 'tl-time', text: fmtClock(0) });
    const barLabel = el('span', { class: 'tl-bars', text: '1.1' });
    const loopBtn = btn('🔁', 'Döngü (L). Bölge yoksa seçili klibin aralığı ya da kafadan dört ölçü', () => { toggleLoop(); refreshToolbar(); });
    const followBtn = btn('⇥', 'Oynatırken kafayı takip et', () => {
      cfg.followPlayhead = cfg.followPlayhead === false;
      p.push(true);
      refreshToolbar();
    });
    const undoBtn = btn('↶', 'Geri al (Ctrl+Z)', () => undo());
    const redoBtn = btn('↷', 'Yinele (Ctrl+Y)', () => redo());

    const bar = el('div', { class: 'tl-toolbar' }, [
      group([
        btn('⏮', 'Önceki işaret', () => {
          const m = TL().markerBefore(ensureTransport().tl, transport.time);
          seek(m ? m.t : 0);
          applyClipsAt(transport.time);
          draw();
        }),
        btn('⏹', 'Durdur ve başa dön', () => { stop(); draw(); refreshToolbar(); }),
        playBtn,
        btn('⏭', 'Sonraki işaret', () => {
          const m = TL().markerAfter(ensureTransport().tl, transport.time);
          if (m) seek(m.t);
          applyClipsAt(transport.time);
          draw();
        }),
      ]),
      el('div', { class: 'tl-clock', title: 'Süre · ölçü.vuruş' }, [timeLabel, barLabel]),
      group([
        el('span', { class: 'tl-lbl', text: 'BPM' }),
        numInput(tl.tempo[0].bpm, 1, 999, 0.1, (v) => {
          cfg.tempo = [{ t: 0, bpm: v, beatsPerBar: tl.tempo[0].beatsPerBar }];
          p.apply();
        }, 'tl-num-sm'),
        el('span', { class: 'tl-lbl', text: '/' }),
        numInput(tl.tempo[0].beatsPerBar, 1, 16, 1, (v) => {
          cfg.tempo = [{ t: 0, bpm: tl.tempo[0].bpm, beatsPerBar: Math.round(v) }];
          p.apply();
        }, 'tl-num-xs'),
      ]),
      group([
        el('span', { class: 'tl-lbl', text: '🧲', title: 'Yakalama. Sürüklerken Alt tuşu yakalamayı geçici olarak kapatır' }),
        select(
          [['off', 'Kapalı'], ['bar', 'Ölçü'], ['beat', 'Vuruş'], ['half', 'Yarım Vuruş'], ['quarter', 'Çeyrek Vuruş'], ['frame', 'Kare']],
          cfg.snap,
          (v) => { cfg.snap = v; p.push(true); }
        ),
      ]),
      group([loopBtn, followBtn]),
      group([
        btn('−', 'Uzaklaştır (−)', () => zoomBy(1 / 1.25)),
        btn('+', 'Yakınlaştır (+)', () => zoomBy(1.25)),
        btn('⤢', 'Hepsini sığdır (0)', () => fitAll()),
      ]),
      group([undoBtn, redoBtn]),
    ]);

    toolbarRefs = { playBtn, loopBtn, followBtn, undoBtn, redoBtn, timeLabel, barLabel };
    refreshToolbar();

    /* Saat ve oynat düğmesi kendi zamanlayıcısından: çizim döngüsü yalnız
       oynatırken çalışıyor ama sürüklerken de okunmalı. */
    const tick = setInterval(() => {
      if (!timeLabel.isConnected) {
        clearInterval(tick);
        return;
      }
      const tr = syncTransportFromAnchor();
      timeLabel.textContent = fmtClock(tr.time);
      const b = tr.bars();
      barLabel.textContent = b.bar + '.' + b.beat;
      const want = tr.playing ? '⏸' : '▶';
      if (playBtn.textContent !== want) {
        playBtn.textContent = want;
        playBtn.classList.toggle('on', tr.playing);
      }
    }, 100);
    return bar;
  }

  function refreshToolbar() {
    const r = toolbarRefs;
    if (!r || !r.playBtn.isConnected) return;
    const tl = ensureTransport().tl;
    const cfg = tlCfg();
    const on = (b, v) => { if (b.classList) b.classList.toggle('on', !!v); };
    on(r.loopBtn, tl.loop.enabled);
    on(r.followBtn, cfg.followPlayhead !== false);
    r.undoBtn.disabled = !history_().canUndo();
    r.redoBtn.disabled = !history_().canRedo();
  }

  // --------------------------------------------------------------------------
  // Parça başlıkları — şeritlerle aynı hizada
  // --------------------------------------------------------------------------
  function heads() {
    const p = P();
    const el = p.el;
    const tl = ensureTransport().tl;
    const box = el('div', { class: 'tl-heads' });
    box.appendChild(el('div', { class: 'tl-head-ruler', text: tl.tracks.length ? tt('Parçalar') : '' }));
    tl.tracks.forEach((trk) => {
      const picked = selection && selection.trackId === trk.id;
      const color = el('input', { class: 'tl-swatch', type: 'color', title: 'Parça rengi', value: trk.color || (trk.kind === 'clip' ? '#4f8cff' : '#e11d2a') });
      color.addEventListener('change', () => { trk.color = color.value; commit(); draw(); });
      const name = el('input', { class: 'txt tl-trackname', type: 'text', value: trk.name, title: trk.name });
      name.addEventListener('change', () => {
        trk.name = name.value.trim() || trk.name;
        commit();
        refreshInspector();
      });
      const tog = (text, title, key, cls) => {
        const b = el('button', { class: 'tl-tog ' + cls + (trk[key] ? ' on' : ''), type: 'button', text, title, 'aria-pressed': trk[key] ? 'true' : 'false' });
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          trk[key] = !trk[key];
          commit();
          refreshHeads();
          draw();
        });
        return b;
      };
      const head = el('div', { class: 'tl-head' + (picked ? ' sel' : '') + (trk.kind === 'automation' ? ' auto' : '') }, [
        color,
        el('span', { class: 'tl-kind', text: trk.kind === 'clip' ? '🎬' : '〰', title: trk.kind === 'clip' ? 'Klip parçası' : 'Otomasyon parçası' }),
        name,
        tog('M', 'Sustur', 'muted', 'm'),
        tog('S', 'Solo: yalnız solo parçalar çalar', 'solo', 's'),
        tog('🔒', 'Kilitle: taşınamaz, silinemez', 'locked', 'l'),
      ]);
      head.style.height = TRACK_H + 'px';
      // Başlığın boş yerine tıklamak parçayı seçiyor (denetçide parça ayarları)
      head.addEventListener('mousedown', (e) => {
        const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'button') return;
        selection = { kind: 'track', trackId: trk.id };
        refreshHeads();
        refreshInspector();
        draw();
      });
      box.appendChild(head);
    });
    return box;
  }

  function refreshHeads() {
    if (!headsBox || !headsBox.isConnected) return;
    const next = heads();
    headsBox.replaceWith(next);
    headsBox = next;
  }

  function numInput(value, min, max, step, onChange, cls) {
    const el = P().el;
    const i = el('input', { class: 'num tl-num' + (cls ? ' ' + cls : ''), type: 'number', min: String(min), max: String(max), step: String(step) });
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

  // --------------------------------------------------------------------------
  // Denetçi — seçili klip, anahtar kare ya da parça
  // --------------------------------------------------------------------------
  /* Yalnız denetçi kutusu yenileniyor: bütün paneli çizmek tuvali de
     yeniden kurar, bir çift tıklamanın ikinci tıklaması da yeni tuvale
     düşerdi. */
  function refreshInspector() {
    refreshToolbar();
    if (!inspectorBox || !inspectorBox.isConnected) return;
    const next = inspector();
    inspectorBox.replaceWith(next);
    inspectorBox = next;
  }

  function inspector() {
    const p = P();
    const el = p.el;
    const box = el('div', { class: 'tl-inspector' });
    const trk = selTrack();
    if (!selection || !trk) {
      box.appendChild(el('div', { class: 'ctrl settings-io-note', text: 'Bir klip, anahtar kare ya da parça seçin. Kısayollar için düzenleyiciye tıklayın.' }));
      box.appendChild(shortcutHelp());
      return box;
    }
    const grid = el('div', { class: 'tl-insp-grid' });
    box.appendChild(grid);
    const act = (text, title, fn, cls) => {
      const b = el('button', { class: 'btn small' + (cls ? ' ' + cls : ''), type: 'button', text, title });
      b.addEventListener('click', fn);
      return b;
    };

    if (selection.kind === 'clip') {
      const c = selClip();
      if (!c) return box;
      box.insertBefore(el('div', { class: 'tl-insp-head', text: (TYPE_ICONS[c.type] || '') + ' ' + clipLabel(c) }), grid);
      grid.appendChild(p.row('Klip Adı', textInput(c.name, (v) => { c.name = v; commit(); draw(); })));
      grid.appendChild(
        p.row('Tür', select(
          [['scene', 'Sahne'], ['preset', 'Şablon'], ['palette', 'Renk Şablonu'], ['video', 'Video'], ['image', 'Görsel'], ['shader', 'Shader'], ['action', 'Eylem']],
          c.type,
          /* Tür değişince kaynak listesi de değişir; yeniden çiz. Eski
             kaynağı temizle, yoksa sahne kimliği şablon alanında kalır. */
          (v) => { c.type = v; c.ref = ''; commit(); refreshInspector(); draw(); }
        ))
      );
      grid.appendChild(p.row('Kaynak', refPicker(c.type, c.ref, (v) => { c.ref = v; commit(); refreshInspector(); draw(); })));
      grid.appendChild(p.row('Başlangıç (sn)', numInput(c.start, 0, 1e6, 0.01, (v) => { c.start = v; TE().sortClips(trk); commit(); draw(); })));
      grid.appendChild(p.row('Süre (sn)', numInput(c.dur, 0.05, 1e6, 0.01, (v) => { c.dur = v; commit(); draw(); })));
      grid.appendChild(p.row('Geçiş (sn)', numInput(c.fade, 0, 30, 0.05, (v) => { c.fade = v; commit(); draw(); })));
      grid.appendChild(p.row('Kırpma Başı (sn)', numInput(c.inPoint, 0, 1e6, 0.01, (v) => { c.inPoint = v; commit(); })));
      grid.appendChild(p.row('Hız', numInput(c.speed, 0.05, 20, 0.01, (v) => { c.speed = v; commit(); })));
      const col = el('input', { class: 'tl-swatch big', type: 'color', value: TE().clipColor(c, trk) });
      col.addEventListener('change', () => { c.color = col.value; commit(); draw(); });
      const colReset = act('↺', 'Rengi parçadan / türden al', () => { c.color = ''; commit(); refreshInspector(); draw(); });
      grid.appendChild(p.row('Renk', el('div', { class: 'tl-inline' }, [col, colReset])));
      if (c.type !== 'scene' && c.type !== 'preset' && c.type !== 'palette') {
        box.appendChild(el('div', {
          class: 'ctrl settings-io-note',
          text: 'Bu tür kaydedilir, ama henüz oynatıldığında uygulanmaz: bir katmanı hedeflemesi gerekiyor ve hedef söylenmeden uygulamak o katmandaki içeriğin üzerine yazardı. Sahne, Şablon ve Renk Şablonu türleri çalışıyor.',
        }));
      }
      box.appendChild(el('div', { class: 'tl-actions' }, [
        act('✂ Böl', 'Oynatma kafasında böl (S)', () => { if (!splitAtPlayhead()) p.toast('Oynatma kafası bu klibin içinde değil.', 'warn'); else refreshAll(); }),
        act('⧉ Çoğalt', 'Hemen ardına bir kopya (Ctrl+D)', () => { if (duplicateSelection()) refreshAll(); }),
        act('⎘ Kopyala', 'Panoya (Ctrl+C); Ctrl+V kafaya yapıştırır', () => { copySelection(); p.toast('Klip kopyalandı. Ctrl+V oynatma kafasına yapıştırır.', 'ok'); }),
        act('🗑 Sil', 'Sil (Del)', () => { if (deleteSelection()) refreshAll(); }, 'danger'),
      ]));
      return box;
    }

    if (selection.kind === 'key' && trk.keys) {
      const k = trk.keys[selection.keyIndex];
      if (!k) return box;
      box.insertBefore(el('div', { class: 'tl-insp-head', text: '〰 ' + trk.name + ' · ' + tt('anahtar') + ' ' + (selection.keyIndex + 1) }), grid);
      grid.appendChild(p.row('Zaman (sn)', numInput(k.t, 0, 1e6, 0.01, (v) => {
        k.t = v;
        trk.keys.sort((a, b) => a.t - b.t);
        selection.keyIndex = trk.keys.indexOf(k);
        commit();
        draw();
      })));
      grid.appendChild(p.row('Değer (0..1)', numInput(k.v, 0, 1, 0.001, (v) => { k.v = v; commit(); draw(); })));
      const curves = (window.SVModulation && window.SVModulation.CURVE_IDS) || ['linear'];
      grid.appendChild(p.row('Segment Eğrisi', select(curves.map((cv) => [cv, curveLabel(cv)]), k.curve, (v) => { k.curve = v; commit(); draw(); })));
      box.appendChild(el('div', { class: 'tl-actions' }, [
        act('🗑 Anahtarı Sil', 'Sil (Del)', () => { if (deleteSelection()) refreshAll(); }, 'danger'),
      ]));
      return box;
    }

    // Parça
    box.insertBefore(el('div', { class: 'tl-insp-head', text: (trk.kind === 'clip' ? '🎬 ' : '〰 ') + trk.name }), grid);
    grid.appendChild(p.row('Parçanın Adı', textInput(trk.name, (v) => { trk.name = v || trk.name; commit(); refreshHeads(); })));
    if (trk.kind === 'automation') {
      const target = el('input', { class: 'txt', type: 'text', value: trk.target, placeholder: 'ör. postfx.0.params.strength' });
      target.addEventListener('change', () => { trk.target = target.value.trim(); commit(); draw(); });
      grid.appendChild(p.row('Hedef Ayar', target));
      grid.appendChild(p.row('En Az', numInput(trk.min, -1e6, 1e6, 0.01, (v) => { trk.min = v; commit(); })));
      grid.appendChild(p.row('En Çok', numInput(trk.max, -1e6, 1e6, 0.01, (v) => { trk.max = v; commit(); })));
    }
    const i = trackIndex(trk.id);
    const move = (d) => {
      const tl = ensureTransport().tl;
      const j = i + d;
      if (j < 0 || j >= tl.tracks.length) return;
      const [t] = tl.tracks.splice(i, 1);
      tl.tracks.splice(j, 0, t);
      commit();
      p.rerender();
    };
    box.appendChild(el('div', { class: 'tl-actions' }, [
      act('↑ Yukarı', 'Parçayı yukarı taşı', () => move(-1)),
      act('↓ Aşağı', 'Parçayı aşağı taşı', () => move(1)),
      trk.kind === 'clip' ? act('＋ Kafada Klip', 'Bu parçaya, oynatma kafasına', () => {
        if (trk.locked) { p.toast('Parça kilitli.', 'warn'); return; }
        addClipAt(trk, snap(ensureTransport().time, false));
        p.rerender();
      }) : null,
      act('🗑 Parçayı Sil', 'Parça ve içindeki her şey', async () => {
        if (!(await p.confirm('Bu parça ve içindeki her şey silinecek.', { danger: true, okText: 'Sil' }))) return;
        const tl = ensureTransport().tl;
        const at = tl.tracks.findIndex((t) => t.id === trk.id);
        if (at >= 0) tl.tracks.splice(at, 1);
        selection = null;
        commit();
        p.rerender();
      }, 'danger'),
    ]));
    return box;
  }

  function shortcutHelp() {
    const el = P().el;
    const box = el('details', { class: 'tl-keys' });
    box.appendChild(el('summary', { text: 'Klavye kısayolları' }));
    const list = el('div', { class: 'tl-keys-list' });
    for (const [k, d] of SHORTCUTS) {
      list.appendChild(el('kbd', { text: k }));
      list.appendChild(el('span', { text: d }));
    }
    box.appendChild(list);
    return box;
  }

  function curveLabel(id) {
    const map = {
      linear: 'Doğrusal', exp: 'Üstel', exp3: 'Üstel (küp)', log: 'Logaritmik',
      scurve: 'S Eğrisi', ease: 'Yumuşak', abs: 'Mutlak',
    };
    return map[id] || id;
  }

  // --------------------------------------------------------------------------
  // Kaynak seçici
  //
  // Kullanıcının sahne kimliğini ezberlemesini beklemek kullanılabilir değildi.
  // Var olanlar listelenir; hiç yoksa panel bunu SÖYLER, boş bir açılır liste
  // bırakmaz — boş liste "bozuk" gibi görünüyor.
  // --------------------------------------------------------------------------
  function refOptions(type) {
    const cfg = P().cfg();
    if (type === 'scene') {
      return (cfg.scenes || []).map((sc) => [sc.id, sc.name || sc.id]);
    }
    if (type === 'preset') {
      const T = window.SVTemplates;
      if (!T) return [];
      return T.TEMPLATES.map((t) => [t.id, (t.group ? t.group + ' · ' : '') + t.name]);
    }
    if (type === 'palette') {
      const built = (window.SV.GRADIENT_PRESETS || []).map((g) => [g.name, g.name]);
      const user = (cfg.userPresets || []).map((g) => [g.name, g.name]);
      return built.concat(user);
    }
    return null; // bu tür için seçilebilir bir liste yok
  }

  function emptyHint(type) {
    if (type === 'scene') return 'Henüz kayıtlı sahne yok. Sahne bölümünden bir sahne kaydedin.';
    if (type === 'palette') return 'Henüz renk şablonu yok.';
    return 'Bu tür için seçilebilir bir kaynak yok.';
  }

  function refPicker(type, value, onChange) {
    const el = P().el;
    const opts = refOptions(type);
    if (opts === null) {
      /* Video/görsel/shader dosya yolu ister; liste üretilemez. */
      const i = el('input', { class: 'txt', type: 'text', value: value || '', placeholder: 'dosya yolu ya da kimlik' });
      i.addEventListener('change', () => onChange(i.value.trim()));
      return i;
    }
    if (!opts.length) {
      return el('div', { class: 'ctrl settings-io-note', text: emptyHint(type) });
    }
    const sel = el('select', { class: 'sel' });
    sel.appendChild(el('option', { value: '', text: '— seçin —' }));
    for (const [v, label] of opts) {
      const o = el('option', { value: v, text: label });
      if (v === value) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  function textInput(value, onChange) {
    const i = P().el('input', { class: 'txt', type: 'text', value: value || '' });
    i.addEventListener('change', () => onChange(i.value.trim()));
    return i;
  }

  // --------------------------------------------------------------------------
  // Diğer ayarlar — katlanmış: cetvel, döngü sınırları, işaretler
  // --------------------------------------------------------------------------
  let moreOpen = false;

  function moreSettings() {
    const p = P();
    const el = p.el;
    const cfg = tlCfg();
    const tl = ensureTransport().tl;
    const box = el('details', { class: 'tl-more' });
    if (moreOpen) box.setAttribute('open', '');
    box.addEventListener('toggle', () => { moreOpen = !!box.open; });
    box.appendChild(el('summary', { text: 'Döngü, işaretler ve cetvel' }));

    box.appendChild(
      p.row('Cetvel', select(
        [['both', 'Süre ve Ölçü'], ['time', 'Yalnızca Süre'], ['bars', 'Yalnızca Ölçü']],
        cfg.ruler,
        (v) => { cfg.ruler = v; p.push(true); draw(); }
      ))
    );

    // --- Döngü bölgesi ---
    if (tl.loop.enabled && !(tl.loop.end > tl.loop.start)) {
      box.appendChild(el('div', {
        class: 'ctrl settings-io-note warn',
        text: 'Döngü sonu başından büyük olmadığı için döngü çalışmıyor. “Sonu Kafaya Al” ile bir bitiş belirleyin.',
      }));
    }
    const setLoop = (patch) => {
      tl.loop = Object.assign({}, tl.loop, patch);
      commit();
      reanchor();
      p.rerender();
    };
    box.appendChild(
      el('div', { class: 'ctrl' }, [
        el('div', { class: 'row' }, [
          el('label', { class: 'lbl', text: 'Döngü Başı / Sonu' }),
          el('div', { class: 'tl-inline' }, [
            numInput(tl.loop.start, 0, 1e6, 0.01, (v) => setLoop({ start: v })),
            numInput(tl.loop.end, 0, 1e6, 0.01, (v) => setLoop({ end: v })),
            (() => {
              const b = el('button', { class: 'btn small', type: 'button', text: 'Başı Kafaya Al' });
              b.addEventListener('click', () => setLoop({ start: ensureTransport().time }));
              return b;
            })(),
            /* Sonu da düğmeyle alınabilmeli: son<baş olduğunda döngü
               SESSİZCE kapanıyor ve kullanıcı neden çalışmadığını
               anlamıyordu. */
            (() => {
              const b = el('button', { class: 'btn small', type: 'button', text: 'Sonu Kafaya Al' });
              b.addEventListener('click', () => setLoop({ end: ensureTransport().time }));
              return b;
            })(),
          ]),
        ]),
      ])
    );

    // --- İşaretler ---
    const marks = el('div', { class: 'tl-markers' });
    tl.markers.forEach((m, i) => {
      const name = el('input', { class: 'txt', type: 'text', value: m.name, placeholder: 'İşaret adı' });
      name.addEventListener('change', () => {
        m.name = name.value.trim();
        commit();
        draw();
      });
      const go = el('button', { class: 'btn small', type: 'button', text: '→', title: 'Bu işarete git' });
      go.addEventListener('click', () => {
        seek(m.t);
        applyClipsAt(transport.time);
        draw();
      });
      const del = el('button', { class: 'btn small danger', type: 'button', text: '✕', title: 'İşareti sil' });
      del.addEventListener('click', () => {
        tl.markers.splice(i, 1);
        commit();
        p.rerender();
      });
      marks.appendChild(
        el('div', { class: 'tl-marker-row' }, [
          numInput(m.t, 0, 1e6, 0.01, (v) => {
            m.t = v;
            tl.markers.sort((a, b) => a.t - b.t);
            commit();
            p.rerender();
          }),
          name,
          go,
          del,
        ])
      );
    });

    /* Sözlerden işaret üretimi mevcut LRC/SRT ayrıştırıcısını kullanır; ikinci
       bir ayrıştırıcı zamanla birincisinden ayrılırdı. */
    const fromLyrics = el('button', { class: 'btn small', type: 'button', text: 'Sözlerden İşaret Üret' });
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
    marks.appendChild(el('div', { class: 'tl-actions' }, [fromLyrics]));
    box.appendChild(marks);
    return box;
  }
})();
