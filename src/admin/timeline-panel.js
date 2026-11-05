/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
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
  /* Şerit yüksekliği kullanıcının ayarı (timeline.laneHeight, 28..120).
     Önce sabit 40'tı; tam pencerede editörün yüksekliği büyüyordu ama
     şeritler aynı kalıyor, boşluk altta birikiyordu. Her çizimde ve panel
     kurulurken ayardan okunuyor (syncLaneH). */
  let TRACK_H = 40;
  const LANE_MIN = 28;
  const LANE_MAX = 120;
  const RULER_H = 38; // üstte ölçü ve süre, altta işaret bayrakları
  const LOOP_BAND = 5; // cetvelin üstünde döngü ayracının bandı (tutma yüksekliği biraz fazlası)
  const TEMPO_TAG_W = 34; // cetveldeki ♩ etiketinin tutulabilir genişliği
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
  // İşaret kapsül genişlikleri (çizimde ölçülür, vuruş testi okur) ve üzerindeki işaret
  const markerW = new Map();
  let hoverMarkerId = '';
  // Hedef seçicide üzerine gelinen klip (#957): tuvalde vurgulanıyor
  let hoverClipId = '';
  let canvas = null;
  let ctx = null;
  let lastAnchorKey = '';
  let clipboard = null;
  let hist = null; // geri al / yinele (shared/timeline-edit.js History)
  /* Çoklu seçim (#636 TL-2): birden fazla klip seçiliyken birincil dahil
     hepsi, kimlikle. Tek klipte boş; birincil her zaman `selection`da. */
  let multi = [];
  /* Otomasyon kaydı (#957): kaydı kollanmış şeritler → son örneklenen
     elle değer. Oynarken hedef ayar elle (kaydırıcı, MIDI, oyun kolu)
     değiştikçe kafaya anahtar yazılıyor; duraklatınca tek adım geçmişe. */
  const recording = new Map();
  let recordDirty = false;
  let dupTargets = new Set();
  let catCache = null;
  // Tam pencere düzenleyici açık mı (panel yeniden çizilse de sürüyor)
  let fullWin = false;
  /* Düzenleyici klavye odağındaydı. Oynarken klip sahne uyguluyor, panel
     yeniden çiziliyor ve odak BODY'ye düşüyordu — ölçüldü: bir klip
     sınırından sonra Boşluk artık duraklatmıyordu. */
  let editorFocus = false;
  let hostEl = null;
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
  /* Sarma/park (#957): oynatıcı bir klibin geçiş penceresine ATLARSA (sürekli
     oynatma değil) giden klip önce geçişsiz uygulanır, sonra bu klip yeniden
     ateşlenir; gösterici ilerlemeyi gösteri saatinden aldığı için o anın
     ara karesi çizilir. Klip zaten uygulanmış olsa da (pencereden çıkıp geri
     dönülünce) aynısı yapılır. */
  let lastClipT = null;
  const inWinBefore = new Map(); // parça -> önceki karede geçiş penceresinde olan klip
  function inTransWindow(clip, t) {
    if (!clip || (clip.type !== 'scene' && clip.type !== 'preset')) return false;
    const dur = clip.fade > 0 ? clip.fade : 0.7;
    return clip.transType !== 'cut' && t >= clip.start && t < clip.start + dur;
  }
  /* Sahne bileşimi (#957): aynı anda birden çok parçada sahne klibi varsa en
     üstteki parçanın sahnesi önde uygulanır, alttakilerin katmanları onun
     ARKASINA (parça sırasıyla, parça opaklığıyla) eklenir. Önceden her parça
     sırayla ateşleniyor ve son ateşlenen, yani en ALTTAKİ parça sahneyi
     ezip kazanıyordu. Alttaki sahneler arkada çalışmaya devam ettiği için
     üstteki klip bitince hemen görünürler. */
  let lastSceneSig = '';
  /* Canlı düzenleme tutuşu: kullanıcı Sahne/Şablon/MilkDrop/katmanla
     elle seçim yapınca, oynatma kafası AYNI klipte kaldığı sürece
     çizelge o klibi yeniden ateşlemesin. Aksi halde opaklık imzası
     her adımda değişip fireClip eski sahneyi geri yüklüyor; önizleme
     anında yeni seçimi gösterirken açık çıkış bir geride kalıyor.
     Kafa boşluğa veya BAŞKA bir sahne klibine geçince tutuş kalkar. */
  let liveHoldHead = null; // 'trackId:clipId' veya tutuş yoksa null
  function sceneHeadOf(sig) {
    if (!sig) return '';
    return sig.split('|')[0].replace(/:[^:]*$/, '');
  }
  function noteLiveEdit() {
    const tr = ensureTransport();
    const tl = tr && tr.tl;
    if (!tl || !TL().activeClipsAt) { liveHoldHead = null; return; }
    const t = tr.time;
    const active = TL().activeClipsAt(tl, t);
    const isScene = TL().isSceneClip || ((c) => c.type === 'scene' || c.type === 'preset');
    const scenes = active.filter((e) => isScene(e.clip));
    if (!scenes.length) { liveHoldHead = null; lastSceneSig = ''; return; }
    const sig = scenes.map((e) => e.track.id + ':' + e.clip.id + ':0').join('|');
    liveHoldHead = sceneHeadOf(sig);
    // Mevcut imzayı yut: tutuş varken opaklık adımı yeniden ateşlemesin
    lastSceneSig = scenes.map((e) => e.track.id + ':' + e.clip.id + ':' + opOf(e)).join('|');
  }
  function underOf(stack) {
    // stack: en üst önce; arka katmanlar en alttan üste doğru
    return stack.slice(1).reverse().filter((e) => e.clip.type === 'scene' && e.clip.ref)
      .map((e) => ({ id: e.clip.ref, opacity: opOf(e), track: e.track.id }));
  }
  /* Etkin opaklık (#957): parça × klip × otomasyon × giriş/çıkış solması.
     Önce yalnız ALTTAKİ parçaların parça opaklığı okunuyordu; üstteki
     klibin opaklığı hiç uygulanmadığı için alttaki katman görünmüyordu. */
  let opT = 0;
  function opOf(e) {
    const T = TL();
    const raw = T.entryOpacity ? T.entryOpacity(ensureTransport().tl, e.track, e.clip, opT) : (e.track.opacity == null ? 1 : e.track.opacity);
    // İmza değişimini sınırlamak için 1/100 adım
    return Math.round(raw * 100) / 100;
  }
  function applyClipsAt(t) {
    const tl = ensureTransport().tl;
    opT = t;
    const active = TL().activeClipsAt ? TL().activeClipsAt(tl, t) : TL().clipsAt(tl, t);
    const isScene = TL().isSceneClip || ((c) => c.type === 'scene' || c.type === 'preset');
    const scenes = active.filter((e) => isScene(e.clip));
    const jumped = lastClipT == null || t < lastClipT - 1e-3 || t - lastClipT > 0.25;
    lastClipT = t;
    const seen = new Set();
    // Medya, palet, eylem: parça başına bağımsız
    for (const entry of active) {
      if (isScene(entry.clip)) continue;
      const key = entry.track.id;
      seen.add(key);
      if (lastAppliedClip.get(key) === entry.clip.id) continue;
      lastAppliedClip.set(key, entry.clip.id);
      fireClip(entry.clip);
    }
    for (const key of Array.from(lastAppliedClip.keys())) {
      if (!seen.has(key)) lastAppliedClip.delete(key);
    }
    if (!scenes.length) { lastSceneSig = ''; liveHoldHead = null; inWinBefore.clear(); return; }
    const top = scenes[0];
    const under = underOf(scenes);
    // Üstteki klibin opaklığı da imzada ve gönderimde (topOpacity)
    const topOp = opOf(top);
    if (topOp < 1 || under.length) under.topOpacity = topOp;
    const sig = scenes.map((e) => e.track.id + ':' + e.clip.id + ':' + opOf(e)).join('|');
    const key = top.track.id;
    const win = inTransWindow(top.clip, t);
    const was = inWinBefore.get(key) === top.clip.id;
    inWinBefore.clear();
    if (win) inWinBefore.set(key, top.clip.id);
    // Yalnız opaklık değiştiyse öndeki sahne aynı sayılır (geçişsiz güncelleme)
    const head = sceneHeadOf(sig);
    const topChanged = sceneHeadOf(lastSceneSig) !== head;
    /* Elle yapılan seçim: aynı klipte kaldıkça sahne yeniden uygulanmaz.
       Kafa başka klibe geçince tutuş düşer ve yeni klip normal ateşlenir. */
    if (liveHoldHead != null) {
      if (head === liveHoldHead) {
        lastSceneSig = sig;
        return;
      }
      liveHoldHead = null;
    }
    // Geçiş penceresine DIŞARIDAN atlandıysa (sarma/park) giden sahne önce kesmeyle
    if (jumped && win && !was && TL().clipBefore) {
      const prev = TL().clipBefore(top.track, top.clip);
      const dp = window.SVClipDeckPanel;
      if (prev && prev.ref && dp && dp.applyFaded) dp.applyFaded(prev.type, prev.ref, 0, prev.target, { light: true, transType: 'cut', under });
      lastSceneSig = sig;
      fireClip(top.clip, under);
      return;
    }
    if (sig === lastSceneSig) return;
    lastSceneSig = sig;
    // Öndeki sahne aynı, yalnız arkadakiler değişti: geçişsiz güncelle
    fireClip(top.clip, under, !topChanged);
  }

  /* Sahne uygulaması panelin KENDİ eylemini çağırır, kopyasını değil:
     applyScene karartma durumunu, etkin sahne kimliğini ve görsel
     normalleştirmesini de doğru işliyor. Otomatik VJ bu listeyi elle
     kopyaladığı için o üçünü kaçırıyor; aynı hatayı tekrarlamıyoruz.

     Klip destesiyle AYNI uygulama yolu kullanılır (SVClipDeckPanel.applyRef):
     iki ayrı kopya zamanla birbirinden ayrılırdı. */
  /* Klibin geçiş süresi (fade) UYGULANIYOR. Önce yalnız denetçide
     yazılıp tuvalde gösteriliyordu; ateşleme onu hiç okumuyordu ve her
     klip genel geçiş ayarıyla değişiyordu. 0 = genel ayar (Geçiş kartı),
     > 0 = bu klibin süresi, destenin yuvalarıyla aynı yoldan. */
  function fireClip(clip, under, cut) {
    if (!clip.ref) return;
    const extra = under && (under.length || under.topOpacity != null) ? { under } : {};
    const dp = window.SVClipDeckPanel;
    if (!dp) return;
    // Hedef medya klipleri için (#637 CD-3 ile aynı biçim); diğer türler yok sayıyor
    // light: Zaman sayfası baştan kurulmasın (çizelge bir an kayboluyordu)
    /* Klibin kendi geçişi (#957): süre, tür, yumuşatma; boş olan sahnenin
       varsayılanı. Sahnenin kaydına yazılmıyor. */
    if (cut && dp.applyFaded) { dp.applyFaded(clip.type, clip.ref, 0, clip.target, Object.assign({ light: true, transType: 'cut' }, extra)); return; }
    const own = clip.fade > 0 || clip.transType || clip.transEase;
    if (own && dp.applyFaded) dp.applyFaded(clip.type, clip.ref, clip.fade, clip.target, Object.assign({ light: true, transType: clip.transType || '', transEase: clip.transEase || '' }, extra));
    else if (dp.applyRef) dp.applyRef(clip.type, clip.ref, clip.target, Object.assign({ light: true }, extra));
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
    const tlOn = !!(full.timeline && full.timeline.enabled && full.timeline.itemEnabled !== false);
    const deckOn = !!(full.clipdeck && full.clipdeck.enabled);
    if (!tlOn && !deckOn) return;

    let tr = ensureTransport();
    if (deckOn && !tlOn && !(clockAnchor && clockAnchor.playing)) {
      tr.play();
      reanchor();
    }
    tr = syncTransportFromAnchor();
    /* Yetki yedekteyse (#814) birincil karar vermez: taşıma akar, klipler
       ve deste uygulanmaz; yetki geri gelince kaldığı yerden. */
    const held = !!(window.SVRedundancyPanel && window.SVRedundancyPanel.steppedBack && window.SVRedundancyPanel.steppedBack());
    if (tr.playing && tlOn && !held) applyClipsAt(tr.time);
    if (recording.size && tr.playing && tlOn) recordTick(tr.time);
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
    if (deckOn && !held && window.SVClipDeckPanel && window.SVClipDeckPanel.tick) {
      window.SVClipDeckPanel.tick(tr.time, tr.tl.tempo);
    }
    pushAnchor(false);
    /* Kare başına tuvalin tamamı ÇİZİLMİYOR: parçalar zamana bağlı değil.
       Oynatma kafası ayrı bir katmanda, yalnız transform ile kayıyor.
       Tuval yalnız görünüm (kaydırma, yakınlaştırma, boyut) değişince. */
    if (tlOn) {
      if (viewKey() !== lastViewKey) draw();
      else placeHead();
    }
  }

  let lastViewKey = '';
  function viewKey() {
    const v = view();
    return v.zoom + '|' + v.scroll + '|' + (canvas ? canvas.clientWidth : 0);
  }

  /* Oynatma kafası katmanı: DOM'da kalıcı bir öğe, yalnız transform
     değişiyor (yerleşim yeniden hesaplanmıyor). */
  let headEl = null;
  let headX = NaN;
  function placeHead() {
    if (!headEl || !canvas || !headEl.isConnected) return;
    const x = Math.round((xOf(transport ? transport.time : 0)) * 2) / 2;
    if (x === headX) return;
    headX = x;
    perf.heads++;
    headEl.style.transform = 'translate3d(' + x + 'px,0,0)';
    headEl.style.visibility = x < HEAD_W - 6 || x > canvas.clientWidth + 6 ? 'hidden' : '';
  }
  const perf = { draws: 0, heads: 0 };

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

  // Seçili klipler (çoklu ya da tek): [{ trk, clip, trackIndex }]; bayat kimlikler düşer
  function pickedClips() {
    const refs = multi.length > 1 ? multi : selection && selection.kind === 'clip' ? [selection] : [];
    const out = [];
    for (const r of refs) {
      const trk = trackById(r.trackId);
      const clip = trk && trk.clips ? trk.clips.find((c) => c.id === r.clipId) : null;
      if (clip) out.push({ trk, clip, trackIndex: trackIndex(trk.id) });
    }
    return out;
  }
  function isPicked(c, trk) {
    if (multi.length > 1) return multi.some((m) => m.clipId === c.id && (!trk || m.trackId === trk.id));
    return !!(selection && selection.kind === 'clip' && selection.clipId === c.id);
  }
  // Ctrl/Shift+tık: klibi seçime ekle ya da çıkar; son eklenen birincil olur
  function toggleMulti(trk, c) {
    if (multi.length <= 1) multi = selection && selection.kind === 'clip' ? [{ trackId: selection.trackId, clipId: selection.clipId }] : [];
    const i = multi.findIndex((m) => m.clipId === c.id && m.trackId === trk.id);
    if (i >= 0) multi.splice(i, 1);
    else multi.push({ trackId: trk.id, clipId: c.id });
    const last = multi[multi.length - 1];
    selection = last ? { kind: 'clip', trackId: last.trackId, clipId: last.clipId } : { kind: 'track', trackId: trk.id };
    if (multi.length <= 1) multi = [];
  }
  function setMulti(refs) {
    multi = refs.length > 1 ? refs.slice() : [];
    const last = refs[refs.length - 1];
    if (last) selection = { kind: 'clip', trackId: last.trackId, clipId: last.clipId };
  }

  // --------------------------------------------------------------------------
  // Otomasyon hedefleri (#957): okunur ad, birim aralığı ve kayıt
  // --------------------------------------------------------------------------
  /* Hedef kataloğu: modülasyonun kataloğu (görselleştirici, arka plan,
     efektler, katmanlar) ve şemanın kaydırıcıları. Önce hedef serbest bir
     metin kutusuydu ("ör. postfx.0.params.strength") ve ne yazılacağı
     bilinmiyordu. Çizim başına bir kez kuruluyor. */
  function targetCatalog() {
    if (catCache) return catCache;
    const cfg = P() && P().cfg ? P().cfg() : null;
    const out = [];
    const MP = window.SVModulationPanel;
    if (cfg && MP && MP.targetCatalog) {
      try { out.push(...MP.targetCatalog(cfg)); } catch { /* katalog kurulamadı: şema yeter */ }
    }
    const S = window.SVSchema;
    for (const r of (S && S.SLIDERS) || []) {
      if (!out.some((o) => o.path === r.path)) out.push({ path: r.path, label: tt(r.label || r.path), group: tt('Ayarlar'), min: r.min, max: r.max });
    }
    // Çizelgenin kendi hedefleri (#957): parça ve klip opaklığı
    /* Ham kimlik yerine okunur ad (#957): "Klip Opaklığı: Sahne 3 — Parça 1 · 0:02–0:06".
       Parçaya göre alt başlık, klip rengi ve sahne/parça adıyla arama için `keys`. */
    const tl = transport && transport.tl;
    ((tl && tl.tracks) || []).forEach((trk, ti) => {
      if (trk.kind !== 'clip') return;
      const tname = trk.name || (tt('Parça') + ' ' + (ti + 1));
      out.push({ path: 'tl.track.' + trk.id + '.opacity', label: tt('Parça Opaklığı') + ': ' + tname, group: tt('Zaman Çizelgesi'), sub: tname, min: 0, max: 1 });
      for (const c of [...trk.clips].sort((a, b) => a.start - b.start)) {
        const name = clipLabel(c);
        out.push({
          path: 'tl.clip.' + c.id + '.opacity',
          label: tt('Klip Opaklığı') + ': ' + name + ' — ' + tname + ' · ' + fmtTime(c.start) + '–' + fmtTime(c.start + c.dur),
          group: tt('Zaman Çizelgesi'), sub: tname, clipId: c.id, color: TE().clipColor(c, trk), keys: name + ' ' + tname + ' ' + (c.ref || ''), min: 0, max: 1,
        });
      }
    });
    // Aynı yol bir kez (yinelenen kimlik ya da iki kaynaktan gelen hedef)
    const seen = new Set();
    catCache = out.filter((o) => (seen.has(o.path) ? false : (seen.add(o.path), true)));
    return catCache;
  }
  function getInCfg(path) {
    // Çizelge içi hedef (#957): değeri parça/klip alanında
    if (TL().isTimelineTarget && TL().isTimelineTarget(path)) {
      const m = /^tl\.(track|clip)\.(.+)\.opacity$/.exec(path);
      const tl = ensureTransport().tl;
      for (const trk of tl.tracks) {
        if (m && m[1] === 'track' && trk.id === m[2]) return trk.opacity == null ? 1 : trk.opacity;
        if (m && m[1] === 'clip' && trk.clips) { const c = trk.clips.find((x) => x.id === m[2]); if (c) return c.opacity == null ? 1 : c.opacity; }
      }
      return undefined;
    }
    const M = window.SVModulation;
    const cfg = P() && P().cfg ? P().cfg() : null;
    if (!cfg || !path) return undefined;
    if (M && M.getIn) return M.getIn(cfg, path);
    return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), cfg);
  }
  function targetMeta(trk) {
    const info = TE().targetInfo(targetCatalog(), trk.target, getInCfg(trk.target));
    info.missing = !!trk.target && getInCfg(trk.target) === undefined;
    return info;
  }
  function fmtNum(v) {
    if (!isFinite(v)) return '–';
    const a = Math.abs(v);
    return String(Math.round(v * (a >= 100 ? 1 : a >= 10 ? 10 : 100)) / (a >= 100 ? 1 : a >= 10 ? 10 : 100));
  }
  // Hedefi ata: aralık katalogdan, ad varsayılansa hedefin adı; çıkış bağlanıyor
  function setTarget(trk, path) {
    const info = TE().targetInfo(targetCatalog(), path, getInCfg(path));
    const auto = !trk.name || /^(Otomasyon|Automation) \d+$/.test(trk.name) || trk.autoNamed;
    trk.target = path;
    trk.min = info.min;
    trk.max = info.max;
    if (auto) { trk.name = info.label; trk.autoNamed = true; }
    commit();
    linkOutput();
  }
  /* Hedefi kaldır (#957): seçilen hedef geri alınamıyordu. Noktalar kalır,
     yalnız bağlantı çözülür; kayıt da durur. */
  function clearTarget(trk) {
    if (!trk || trk.kind !== 'automation' || !trk.target) return false;
    recording.delete(trk.id);
    trk.target = '';
    if (trk.autoNamed) trk.name = tt('Otomasyon') + ' ' + (trackIndex(trk.id) + 1);
    commit();
    linkOutput();
    refreshHeads(); refreshInspector(); draw();
    return true;
  }
  /* Öğren (#957): R'ye hedefsiz basınca önceden HİÇBİR ŞEY olmuyordu. Artık
     parça "öğreniyor" durumuna geçer (kırmızı, yanıp söner) ve uygulamada
     oynatılan ilk sayısal ayar (data-path taşıyan denetim) hedef olur; ardından
     kayıt kendiliğinden kurulur. Esc ya da ikinci basış vazgeçer. */
  let learning = null; // { id, off }
  function stopLearn() {
    if (!learning) return;
    learning.off();
    learning = null;
    refreshHeads(); draw();
  }
  function startLearn(trk) {
    stopLearn();
    /* Hangi ayarın oynatıldığını denetimin yolundan (data-path) ya da,
       katman denetimleri gibi yolu olmayanlarda, hedef kataloğundaki
       değerlerin önceki/sonraki farkından bul. */
    const leaves = () => {
      const out = new Map();
      const walk = (o, pre, d) => {
        if (d > 8 || o == null) return;
        if (typeof o === 'number') { out.set(pre, o); return; }
        if (typeof o !== 'object') return;
        for (const k of Object.keys(o)) {
          if (!pre && (k === 'timeline' || k === 'scenes' || k === 'presets')) continue;
          walk(o[k], pre ? pre + '.' + k : k, d + 1);
        }
      };
      walk(P().cfg ? P().cfg() : null, '', 0);
      return out;
    };
    let before = leaves();
    const learnFrom = (path) => {
      const tk = trackById(learning && learning.id);
      stopLearn();
      if (!tk) return;
      setTarget(tk, path);
      recording.set(tk.id, getInCfg(path));
      if (P().toast) P().toast(tt('Hedef öğrenildi') + ': ' + (targetMeta(tk).label || path), 'ok');
      refreshHeads(); refreshInspector(); draw();
    };
    const onInput = (e) => {
      const t = e.target;
      if (!t || !t.closest || t.closest('.tl-panel, .tl-target-menu')) return;
      const host = t.closest('[data-path]');
      const direct = host && host.getAttribute('data-path');
      if (direct && typeof getInCfg(direct) === 'number') { learnFrom(direct); return; }
      // Yapılandırma denetimin kendi dinleyicisinde güncellenir: bir tur bekle
      setTimeout(() => {
        if (!learning) return;
        const now = leaves();
        let hit = '';
        for (const [k, v] of now) if (before.has(k) && before.get(k) !== v) { hit = k; break; }
        if (hit) learnFrom(hit);
        else before = now;
      }, 0);
    };
    const onKey = (e) => { if (e.key === 'Escape') stopLearn(); };
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onInput, true);
    document.addEventListener('keydown', onKey, true);
    learning = { id: trk.id, off: () => { document.removeEventListener('input', onInput, true); document.removeEventListener('change', onInput, true); document.removeEventListener('keydown', onKey, true); } };
    if (P().toast) P().toast(tt('Öğren: uygulamada bir ayarı oynatın (Esc vazgeçer)'), 'info');
    refreshHeads(); draw();
  }
  function isLearning(trk) { return !!(learning && trk && learning.id === trk.id); }
  // Kayıt aç/kapat; hedef yoksa öğrenmeye geçer
  function toggleRecord(trk) {
    if (!trk || trk.kind !== 'automation') return false;
    if (isLearning(trk)) { stopLearn(); return true; }
    if (!trk.target) { startLearn(trk); return true; }
    if (recording.has(trk.id)) {
      recording.delete(trk.id);
      if (recordDirty) { recordDirty = false; commit(); }
    } else {
      recording.set(trk.id, getInCfg(trk.target));
      linkOutput();
    }
    refreshHeads();
    draw();
    return true;
  }
  function recordTick(t) {
    for (const [id, last] of recording) {
      const trk = trackById(id);
      if (!trk || !trk.target) { recording.delete(id); continue; }
      const v = getInCfg(trk.target);
      if (typeof v !== 'number' || v === last) continue;
      recording.set(id, v);
      TE().recordKey(trk, t, v, 0.08);
      recordDirty = true;
      /* Kaydı yapılandırmaya da yaz (#957): panel yeniden çizilince model
         yapılandırmadan kurulur; yazılmamış noktalar o anda kayboluyordu
         (R "hiçbir şey yapmıyor" gibi görünüyordu). Kalıcı kayıt durunca. */
      const ct = (tlCfg().tracks || []).find((x) => x && x.id === id);
      if (ct) ct.keys = trk.keys.map((k) => Object.assign({}, k));
    }
    if (recordDirty) draw();
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

  /* Renkler arayüz temasından (#770). Tuval CSS'i görmez; tema değişince
     yeniden çizilir (aşağıda onChange). */
  function css(name) {
    return window.SVUiTheme ? window.SVUiTheme.color(name) : '';
  }
  function tint(name, a) {
    return window.SVUiTheme ? window.SVUiTheme.alpha(name, a) : 'transparent';
  }

  const UI_FONT = "'Geist', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif";
  // Rengi siyaha doğru koyulaştır: klibin alt tonu
  function shade(hex, k) {
    const n = parseInt(String(hex).slice(1), 16) || 0;
    return 'rgb(' + Math.round(((n >> 16) & 255) * k) + ',' + Math.round(((n >> 8) & 255) * k) + ',' + Math.round((n & 255) * k) + ')';
  }

  function rgba(hex, a) {
    const n = parseInt(String(hex).slice(1), 16) || 0;
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function syncLaneH() {
    const v = Math.round(Number(tlCfg().laneHeight));
    TRACK_H = v >= LANE_MIN && v <= LANE_MAX ? v : 40;
  }

  // Şerit yüksekliğini adım adım değiştir; paneli yeniden kuruyor (başlıklar da boy alıyor)
  function laneBy(d) {
    syncLaneH();
    const nv = Math.max(LANE_MIN, Math.min(LANE_MAX, TRACK_H + d));
    if (nv === TRACK_H) return;
    tlCfg().laneHeight = nv;
    TRACK_H = nv;
    P().push(false);
    P().rerender();
  }

  function draw() {
    if (!canvas || !ctx || !canvas.isConnected) return;
    syncLaneH();
    const tl = ensureTransport().tl;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    // Dikey sürüklemede bir boş satır daha: yeni parçaya bırakma yeri
    const extra = drag && drag.kind === 'move' && drag.newTrack ? 1 : 0;
    const h = RULER_H + Math.max(1, tl.tracks.length + extra) * TRACK_H;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.height = h + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    catCache = null;
    dupTargets = TE().duplicateTargets(tl);

    const fg = css('--text');
    const dim = css('--muted');
    const line = css('--line');
    const accent = css('--accent');
    const strong = css('--text-strong');
    const solo = TL().anySolo ? TL().anySolo(tl) : false;

    // --- Şerit zeminleri: yalnız seçili parça belirgin ---
    for (let i = 0; i < tl.tracks.length; i++) {
      const y = RULER_H + i * TRACK_H;
      const trk = tl.tracks[i];
      if (selection && selection.trackId === trk.id) {
        ctx.fillStyle = tint('--fg-rgb', 0.045);
        ctx.fillRect(0, y, w, TRACK_H);
      }
    }

    // --- Izgara ve cetvel ---
    drawRuler(w, h, tl, fg, dim, line);

    // --- Döngü bölgesi: cetvelde belirgin bant, şeritlerde hafif örtü ---
    /* Döngü ayracı (#636 TL-2): cetvelin üst bandında, kapalıyken de soluk
       görünüyor ki sürüklenip açılabilsin. Kenarlardan boyu, ortasından
       yeri değişiyor. */
    if (tl.loop.end > tl.loop.start) {
      const lx = xOf(tl.loop.start);
      const lw = (tl.loop.end - tl.loop.start) * view().zoom;
      const on = tl.loop.enabled;
      if (on) {
        ctx.fillStyle = tint('--info-rgb', 0.08);
        ctx.fillRect(lx, RULER_H, lw, h - RULER_H);
      }
      ctx.fillStyle = tint('--info-rgb', on ? 0.55 : 0.2);
      ctx.fillRect(lx, 0, lw, LOOP_BAND);
      ctx.fillStyle = tint('--info-rgb', on ? 0.95 : 0.4);
      ctx.fillRect(lx - 1, 0, 3, LOOP_BAND + 3);
      ctx.fillRect(lx + lw - 2, 0, 3, LOOP_BAND + 3);
    }

    // --- Parçalar ---
    for (let i = 0; i < tl.tracks.length; i++) {
      const y = RULER_H + i * TRACK_H;
      ctx.strokeStyle = tint('--fg-rgb', 0.05);
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

    // --- İşaretler: cetvelin alt bandında etiket, şeritlerde ince çizgi ---
    ctx.font = '500 11px ' + UI_FONT;
    for (const m of tl.markers) {
      const x = xOf(m.t);
      if (x < -2 || x > w + 2) continue;
      ctx.strokeStyle = tint('--fg-rgb', 0.14);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, RULER_H);
      ctx.lineTo(Math.round(x) + 0.5, h);
      ctx.stroke();
      const label = m.name || '';
      const lw = label ? ctx.measureText(label).width + 12 : 8;
      markerW.set(m.id, lw);
      const msel = selection && selection.kind === 'marker' && selection.markerId === m.id;
      const mhov = !msel && hoverMarkerId === m.id;
      if (msel || mhov) {
        // Seçili/üstündeki işaretin çizgisi şeritlerde de belirgin
        ctx.strokeStyle = msel ? css('--accent') || strong : tint('--fg-rgb', 0.35);
        ctx.lineWidth = msel ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, RULER_H);
        ctx.lineTo(Math.round(x) + 0.5, h);
        ctx.stroke();
      }
      ctx.fillStyle = msel ? css('--accent') || tint('--fg-rgb', 0.4) : tint('--fg-rgb', mhov ? 0.26 : 0.12);
      ctx.beginPath();
      ctx.roundRect(x, RULER_H - 17, lw, 15, 5);
      ctx.fill();
      if (msel) {
        ctx.strokeStyle = strong;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (label) {
        ctx.fillStyle = msel ? css('--on-accent') || strong : fg;
        ctx.fillText(label, x + 6, RULER_H - 5.5);
      }
    }

    /* --- Tempo değişimleri: cetvelin alt bandında camgöbeği ♩ etiketi. İlk
       giriş (parçanın başındaki tempo) başlıktaki BPM alanında. Ölçüdeki
       vuruş değiştiyse etikette o da yazıyor. */
    const tsel = selection && selection.kind === 'tempo' ? selection.index : -1;
    for (let i = 1; i < tl.tempo.length; i++) {
      const e = tl.tempo[i];
      const x = xOf(e.t);
      if (x < -TEMPO_TAG_W || x > w + 2) continue;
      const on = i === tsel;
      ctx.strokeStyle = on ? strong : tint('--tempo', 0.85);
      ctx.lineWidth = on ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, RULER_H - 14);
      ctx.lineTo(Math.round(x) + 0.5, h);
      ctx.stroke();
      ctx.fillStyle = on ? strong : css('--tempo');
      const sig = e.beatsPerBar !== tl.tempo[i - 1].beatsPerBar ? ' ' + e.beatsPerBar + '/4' : '';
      ctx.fillText('♩' + (Math.round(e.bpm * 10) / 10) + sig, x + 3, RULER_H - 5);
    }
    ctx.lineWidth = 1;

    // Oynatma kafası ayrı katmanda (placeHead); tuval her karede çizilmiyor
    lastViewKey = viewKey();
    perf.draws++;
    headX = NaN;
    placeHead();

    // --- Son parçanın altına bırakma: yeni parça açılacak yer ---
    if (drag && drag.kind === 'move' && drag.newTrack) {
      ctx.strokeStyle = tint('--fg-rgb', 0.5);
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(0.5, RULER_H + tl.tracks.length * TRACK_H + 0.5, w - 1, TRACK_H - 1);
      ctx.setLineDash([]);
      ctx.fillStyle = dim;
      ctx.font = '500 11px ' + UI_FONT;
      ctx.fillText(tt('Bırak: yeni parça'), 8, RULER_H + tl.tracks.length * TRACK_H + TRACK_H / 2 + 4);
    }

    // --- Kutu seçimi ---
    if (drag && drag.kind === 'marquee' && drag.moved) {
      const x0 = Math.min(drag.x0, drag.x1);
      const y0 = Math.min(drag.y0, drag.y1);
      ctx.fillStyle = tint('--fg-rgb', 0.06);
      ctx.fillRect(x0, y0, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
      ctx.strokeStyle = tint('--fg-rgb', 0.55);
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
      ctx.setLineDash([]);
    }
  }

  /* Cetvel: yakınlaştırmaya göre ızgara sıklığı seçilir. Sabit bir aralık,
     uzaklaşınca çizgi gürültüsüne, yakınlaşınca boş alana dönüşürdü.
     Ölçü çizgileri şeritlere de iniyor: klibi ölçüye göre yerleştirmek
     gözle yapılabilsin. */
  function drawRuler(w, h, tl, fg, dim, line) {
    const cfg = tlCfg();
    const v = view();

    const showBars = cfg.ruler !== 'time';
    const showTime = cfg.ruler !== 'bars';

    // Ölçü ızgarası şeritlerde: etiketlerden bağımsız, ölçü başına bir çizgi
    const b0 = TL().secondsToBars(tl.tempo, v.scroll);
    const barSec = TL().barsToSeconds(tl.tempo, b0.bar + 1, 1) - TL().barsToSeconds(tl.tempo, b0.bar, 1);
    if (barSec * v.zoom >= 14) {
      ctx.strokeStyle = tint('--fg-rgb', 0.05);
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

    /* Etiketler döngü bandının ALTINDA (y 17): önce y 12'deydi ve döngü
       ayracı etiketlerin üstüne biniyordu. Ölçü gösterilirken çentikler
       ölçü çizgilerinde: şeritlerdeki ızgarayla aynı yerde (önce saniye
       çentiğine ölçü.vuruş yazılıyordu ve ızgara ile cetvel kayıktı). */
    const LABEL_Y = 17;
    ctx.font = '500 11px ' + UI_FONT;
    ctx.strokeStyle = tint('--fg-rgb', 0.1);
    ctx.lineWidth = 1;
    const minLabel = showBars && showTime ? 84 : 56;
    if (showBars) {
      let stride = 1;
      while (barSec * stride * v.zoom < minLabel && stride < 4096) stride *= 2;
      const first = Math.max(1, Math.floor((b0.bar - 1) / stride) * stride + 1);
      for (let bar = first; ; bar += stride) {
        const t = TL().barsToSeconds(tl.tempo, bar, 1);
        const x = Math.round(xOf(t)) + 0.5;
        if (x > w + 1) break;
        if (x < -100) continue;
        ctx.beginPath();
        ctx.moveTo(x, LOOP_BAND + 2);
        ctx.lineTo(x, RULER_H);
        ctx.stroke();
        ctx.fillStyle = dim;
        ctx.fillText(String(bar), x + 5, LABEL_Y);
        if (showTime) {
          ctx.fillStyle = tint('--fg-rgb', 0.32);
          ctx.fillText(fmtTime(t), x + 5 + Math.max(14, ctx.measureText(String(bar)).width + 6), LABEL_Y);
        }
      }
    } else {
      // Saniye ızgarası — etiketler arası en az 56 piksel
      const secSteps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
      let step = secSteps[secSteps.length - 1];
      for (const st of secSteps) {
        if (st * v.zoom >= minLabel) { step = st; break; }
      }
      const t0 = Math.floor(v.scroll / step) * step;
      for (let t = t0; xOf(t) < w + 1; t += step) {
        const x = Math.round(xOf(t)) + 0.5;
        if (x < -1) continue;
        ctx.beginPath();
        ctx.moveTo(x, LOOP_BAND + 2);
        ctx.lineTo(x, RULER_H);
        ctx.stroke();
        ctx.fillStyle = tint('--fg-rgb', 0.45);
        ctx.fillText(fmtTime(t), x + 5, LABEL_Y);
      }
    }
    ctx.strokeStyle = tint('--fg-rgb', 0.08);
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
  const TYPE_ICONS = { scene: 'clapper', preset: 'sparkles', palette: 'palette', video: 'film', image: 'image', shader: 'code', action: 'bolt' };

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
      /* Medya ve eylem kliplerinin adı destedeki gibi: görselin kaynağı bir
         veri adresi, tuvale yazılacak bir ad değil. */
      const dp = window.SVClipDeckPanel;
      if (dp && dp.slotLabel && (c.type === 'video' || c.type === 'image' || c.type === 'shader' || c.type === 'action')) {
        return dp.slotLabel({ type: c.type, ref: c.ref, name: '' });
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
      const sel = isPicked(c, trk);
      const col = TE().clipColor(c, trk);
      const top = y + 3;
      const hh = TRACK_H - 6;
      ctx.globalAlpha = live ? 1 : 0.35;
      // Düz yüzey ve üstte ince ışık: taslaktaki gibi canlı, okunur
      const face = ctx.createLinearGradient(0, top, 0, top + hh);
      face.addColorStop(0, col);
      face.addColorStop(1, shade(col, 0.82));
      ctx.fillStyle = face;
      ctx.beginPath();
      ctx.roundRect(x, top, cw, hh, 7);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, top, cw, hh, 7);
      ctx.clip();
      ctx.fillStyle = tint('--on-media-rgb', 0.18);
      ctx.fillRect(x, top, cw, 1);
      ctx.restore();
      /* Geçiş (fade) rampası ve tutamacı (#636 TL-2): klibin sol üstünden
         sürüklenerek ayarlanıyor. Rampanın solu kararık: geçiş o sürede
         tamamlanıyor. */
      const fw = Math.min(cw, (c.fade || 0) * view().zoom);
      if (fw > 1) {
        ctx.fillStyle = tint('--shadow-rgb', 0.28);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x + fw, top);
        ctx.lineTo(x, top + hh);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = tint('--fg-rgb', 0.55);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, top + hh);
        ctx.lineTo(x + fw, top);
        ctx.stroke();
      }
      if ((sel || fw > 1) && cw > 14) {
        ctx.fillStyle = sel ? css('--text-strong') : tint('--fg-rgb', 0.7);
        ctx.fillRect(x + fw - 3, top - 1, 6, 6);
      }
      // Kaynağı seçilmemiş klip çizgili: ateşlendiğinde hiçbir şey olmayacak
      if (!c.ref) {
        ctx.strokeStyle = tint('--fg-rgb', 0.18);
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
      if (!sel && hoverClipId === c.id) {
        ctx.strokeStyle = css('--accent');
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.roundRect(x + 1, top + 1, cw - 2, hh - 2, 6);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (sel) {
        ctx.strokeStyle = css('--text-strong');
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(x + 1, top + 1, cw - 2, hh - 2, 6);
        ctx.stroke();
      }
      if (cw > 26) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 3, top, cw - 6, hh);
        ctx.clip();
        const onClip = 'rgb(' + css('--on-media-rgb') + ')';
        ctx.fillStyle = onClip;
        ctx.font = '550 12px ' + UI_FONT;
        ctx.textBaseline = 'middle';
        const tall = hh >= 40 && cw > 80;
        ctx.fillText(clipLabel(c), x + 8, tall ? top + 14 : top + hh / 2 + 0.5);
        if (tall) {
          ctx.font = '500 11px ' + UI_FONT;
          ctx.fillStyle = tint('--on-media-rgb', 0.7);
          ctx.fillText(fmtTime(c.dur) + (c.fade > 0 ? ' · ' + tt('geçiş') + ' ' + c.fade.toFixed(2) : '') + (c.transType ? ' · ' + tt(transLabel(c)) : ''), x + 8, top + hh - 11);
        }
        ctx.textBaseline = 'alphabetic';
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawAutomationTrack(trk, index, y, w, accent, dim, live) {
    const top = y + 7;
    const bot = y + TRACK_H - 5;
    const keys = trk.keys;
    const col = trk.color || css('--cue-armed') || accent;
    ctx.fillStyle = dim;
    ctx.font = '500 11px ' + UI_FONT;
    /* Şeridin solunda hedefin okunur adı ve aralığı; hedef yoksa ya da
       yapılandırmada bulunamıyorsa bunu açıkça söyle (önce yalnız konsola
       uyarı düşüyordu). Boşsa ne yapılacağı yazıyor. */
    const info = targetMeta(trk);
    let tag;
    if (!trk.target) tag = tt('Hedef seçilmedi — başlıktaki arama düğmesi ya da sağ tık › Hedef Seç');
    else if (info.missing) tag = '! ' + tt('Hedef bulunamadı') + ': ' + trk.target;
    else tag = (info.group ? info.group + ' · ' : '') + info.label + '  [' + fmtNum(trk.min) + '…' + fmtNum(trk.max) + ']' + (dupTargets.has(trk.id) ? '  ! ' + tt('başka şerit de bu hedefi sürüyor') : '');
    ctx.fillText(tag, 8, y + 15);
    if (trk.target && !keys.length) {
      ctx.fillStyle = tint('--fg-rgb', 0.3);
      ctx.fillText(tt('Çift tıkla: nokta ekle · sürükle: taşı · sağ tık: eğri / sil'), 8, y + 29);
    }
    if (recording.has(trk.id)) {
      ctx.fillStyle = css('--danger');
      ctx.beginPath();
      ctx.arc(w - 12, y + 11, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!keys.length) return;
    /* Eğri piksel piksel örneklenir: segment eğrisi doğrusal olmadığı için
       anahtarları düz çizgiyle birleştirmek yanlış şekil gösterirdi. */
    ctx.globalAlpha = live ? 1 : 0.35;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let px = 0; px <= w; px += 2) {
      const v = TL().evalKeys(keys, tOf(px));
      const yy = bot - (bot - top) * Math.max(0, Math.min(1, v));
      if (px === 0) ctx.moveTo(px, yy);
      else ctx.lineTo(px, yy);
    }
    ctx.stroke();
    // Eğrinin altı hafif dolu: şeridin değeri uzaktan okunsun
    ctx.lineTo(w, bot + 5);
    ctx.lineTo(0, bot + 5);
    ctx.closePath();
    ctx.fillStyle = rgba(col, 0.1);
    ctx.fill();

    for (let ki = 0; ki < keys.length; ki++) {
      const k = keys[ki];
      const x = xOf(k.t);
      if (x < -6 || x > w + 6) continue;
      const yy = bot - (bot - top) * Math.max(0, Math.min(1, k.v));
      const sel = selection && selection.kind === 'key' && selection.trackId === trk.id && selection.keyIndex === ki;
      ctx.fillStyle = sel ? css('--text-strong') : col;
      ctx.strokeStyle = css('--card');
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, yy, sel ? 5.5 : 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Kafadaki gerçek değer: şeridin sağında okunur
    const nv = TL().evalKeys(keys, ensureTransport().time);
    if (nv != null) {
      const real = trk.min + (trk.max - trk.min) * Math.max(0, Math.min(1, nv));
      ctx.font = '600 11px ' + UI_FONT;
      const txt = '= ' + fmtNum(real);
      const tw = ctx.measureText(txt).width;
      ctx.fillStyle = css('--card');
      ctx.fillRect(w - tw - 26, y + 4, tw + 8, 15);
      ctx.fillStyle = col;
      ctx.fillText(txt, w - tw - 22, y + 15);
    }
    ctx.globalAlpha = 1;
  }

  // --------------------------------------------------------------------------
  // Vuruş testi ve sürükleme
  // --------------------------------------------------------------------------
  function hit(x, y) {
    const tl = ensureTransport().tl;
    if (y < RULER_H) {
      // İşaretler cetvel kaydırma ve döngü sürüklemesinden ÖNCE (#957): kapsülün
      // tamamı + pay ve cetvel boyunca çizginin ±4 px'i
      const mk = TL().markerHit(tl.markers, x, y, { xOf, widthOf: (m) => markerW.get(m.id) || 8, rulerH: RULER_H });
      if (mk) return { kind: 'marker', marker: mk };
      if (y >= RULER_H - 14) {
        // Tempo etiketleri de bu bantta; işaret bayrağı önce
        for (let ti = tl.tempo.length - 1; ti >= 1; ti--) {
          const tx = xOf(tl.tempo[ti].t);
          if (x >= tx - 3 && x <= tx + TEMPO_TAG_W) return { kind: 'tempo', index: ti };
        }
      }
      // Döngü ayracı üst bantta: kenarlar boy, ortası yer
      if (y <= LOOP_BAND + 4 && tl.loop.end > tl.loop.start) {
        const lx0 = xOf(tl.loop.start);
        const lx1 = xOf(tl.loop.end);
        if (Math.abs(x - lx0) <= 6) return { kind: 'loopL' };
        if (Math.abs(x - lx1) <= 6) return { kind: 'loopR' };
        if (x > lx0 && x < lx1) return { kind: 'loopMove' };
      }
      return { kind: 'ruler' };
    }
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
        // Geçiş tutamacı sol üst köşede, rampanın ucunda; kırpmadan önce bakılıyor
        const top = RULER_H + index * TRACK_H + 4;
        const fx = cx + Math.min(cw, (c.fade || 0) * view().zoom);
        if (cw > 14 && y <= top + 8 && x >= fx - 4 && x <= fx + 6) return { kind: 'fade', index, ci };
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

  /* Yakalama: önce mıknatıs (klip kenarları, işaretler, kafa; 8 piksel
     içinde), sonra ızgara. Yakalama kapalıyken (ızgara 'off') mıknatıs da
     kapalı; Alt her ikisini askıya alıyor. */
  const MAGNET_PX = 8;
  function snap(t, suspend, skip) {
    const cfg = tlCfg();
    if (suspend) return Math.max(0, t);
    if (cfg.snap && cfg.snap !== 'off') {
      const m = TE().magnetSnap(t, TE().snapCandidates(ensureTransport().tl, ensureTransport().time, skip), MAGNET_PX / view().zoom);
      if (m != null) return Math.max(0, m);
    }
    return Math.max(0, TL().snapSeconds(ensureTransport().tl.tempo, t, cfg.snap, cfg.fps));
  }
  // Taşınan klip: baş ya da son kenarı mıknatısa oturabiliyor
  function snapMove(start, dur, suspend, skip) {
    const cfg = tlCfg();
    if (suspend) return Math.max(0, start);
    if (cfg.snap && cfg.snap !== 'off') {
      const cand = TE().snapCandidates(ensureTransport().tl, ensureTransport().time, skip);
      const tol = MAGNET_PX / view().zoom;
      const a = TE().magnetSnap(start, cand, tol);
      const b = TE().magnetSnap(start + dur, cand, tol);
      if (a != null && (b == null || Math.abs(a - start) <= Math.abs(b - start - dur))) return Math.max(0, a);
      if (b != null) return Math.max(0, b - dur);
    }
    return snap(start, false, skip);
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
    // Tempo da düzenlemenin parçası (cetvelde değişimler, #636): düz liste
    cfg.tempo = TE().tempoList(tl.tempo);
    modelDirty = false;
    history_().push(TE().snapshot(cfg));
    P().push(true);
    refreshToolbar();
  }

  // --------------------------------------------------------------------------
  // Tempo değişimleri (#636): cetvelde ♩ etiketleri
  // --------------------------------------------------------------------------
  /* Tempo listesini modele yazar ve geçmişe bir adım ekler. Liste düz
     (TE.tempoList); model birikimli vuruşları kendisi hesaplıyor. */
  function applyTempo(list, selectIndex) {
    const tl = ensureTransport().tl;
    tl.tempo = TL().makeTempoMap(list);
    if (selectIndex != null) {
      selection = { kind: 'tempo', index: selectIndex };
      multi = [];
    }
    commit();
    refreshInspector();
    draw();
  }

  // Oynatma kafasında geçerli tempo girişinin sırası
  function tempoAtHead() {
    const tr = ensureTransport();
    return TE().tempoIndexAt(TE().tempoList(tr.tl.tempo), tr.time);
  }

  function addTempoAtHead() {
    const tr = ensureTransport();
    const r = TE().addTempoChange(tr.tl.tempo, snap(tr.time, false));
    applyTempo(r.list, r.index);
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
    if (selection && selection.kind !== 'tempo' && selection.kind !== 'marker' && !selTrack()) selection = null;
    if (selection && selection.kind === 'marker' && !selMarker()) selection = null;
    // Geri alma ya da silme sonrası artık olmayan klipler çoklu seçimden düşüyor
    if (multi.length > 1) {
      multi = pickedClips().map((p) => ({ trackId: p.trk.id, clipId: p.clip.id }));
      if (multi.length <= 1) multi = [];
    }
    refreshHeads();
    refreshInspector();
    refreshMore();
    draw();
  }

  // --------------------------------------------------------------------------
  // Düzenleme eylemleri — araç çubuğu, denetçi ve kısayollar aynı yoldan
  // --------------------------------------------------------------------------
  /* Öncelik notu (#957 denetim): çalan otomasyon elle, MIDI ve oyun kolu
     değerinin ÜSTÜNE yazar; modülatörler en son, onun üstüne eklenir. */
  const PRECEDENCE = 'Oynarken otomasyon bu ayarın elle, MIDI ya da oyun kolu değerini geçersiz kılar; modülatörler onun üstüne uygulanır. Atla (bypass) ile kapatılır.';

  /* Aranabilir hedef seçici: modülasyon kataloğu ve ayar kaydırıcıları.
     Önce serbest metindi; kimse yolu bilmiyordu. */
  function openTargetPicker(trk, x, y) {
    const p = P();
    const el = p.el;
    const cat = targetCatalog();
    const m = el('div', { class: 'sv-menu tl-target-menu', role: 'menu' });
    const q = el('input', { class: 'txt', type: 'search', placeholder: tt('Ayar ara…'), 'aria-label': tt('Ayar ara') });
    const list = el('div', { class: 'tl-target-list' });
    const hover = (id) => { if (hoverClipId !== id) { hoverClipId = id; draw(); } };
    const fill = () => {
      const hits = TE().filterTargets(cat, q.value).slice(0, 80);
      // Grup ve parça başlıkları (#957): Zaman Çizelgesi › Parça 1 › klipleri
      const rows = [];
      let lastHead = '';
      for (const it of hits) {
        const head = it.group + (it.sub ? ' › ' + it.sub : '');
        if (head !== lastHead) { rows.push(el('div', { class: 'tl-target-head', text: head })); lastHead = head; }
        const b = el('button', {
          type: 'button', class: 'tl-target-row' + (it.path === trk.target ? ' on' : ''), title: it.path + ' [' + fmtNum(it.min) + '…' + fmtNum(it.max) + ']',
          // Seçili hedefe yeniden tıklamak onu kaldırır (#957)
          onclick: () => { hover(''); m.remove(); if (it.path === trk.target) clearTarget(trk); else { setTarget(trk, it.path); refreshHeads(); refreshInspector(); draw(); } },
        }, [
          it.color ? el('span', { class: 'tl-target-sw', style: 'background:' + it.color }) : null,
          el('span', { class: 'tl-target-lbl', text: it.label }),
        ]);
        if (it.clipId) {
          b.dataset.clip = it.clipId;
          b.addEventListener('mouseenter', () => hover(it.clipId));
          b.addEventListener('mouseleave', () => hover(''));
        }
        rows.push(b);
      }
      list.replaceChildren(...(rows.length ? rows : [el('div', { class: 'tl-target-empty', text: tt('Eşleşen ayar yok') })]));
      if (trk.target) list.insertBefore(el('button', { type: 'button', class: 'tl-target-clear', icon: 'x', text: tt('Hedefi Kaldır'),
        onclick: () => { m.remove(); clearTarget(trk); } }), list.firstChild);
    };
    q.addEventListener('input', fill);
    // Menü kapanınca vurgu kalmasın
    new MutationObserver((_, ob) => { if (!m.isConnected) { ob.disconnect(); hover(''); } }).observe(document.body, { childList: true, subtree: false });
    m.append(q, list);
    fill();
    if (window.SVSceneShell && window.SVSceneShell.placeMenu) window.SVSceneShell.placeMenu(m, x, y);
    if (q.focus) q.focus();
    return m;
  }

  /* Sağ tık menüsü (#957): tıklanan öğeye göre. Tuval koordinatı (x, y),
     ekran koordinatı (cx, cy). Öğeler [ad, kısayol, iş, kapalı?]. */
  function contextMenuAt(x, y, cx, cy) {
    const p = P();
    const el = p.el;
    const tl = ensureTransport().tl;
    const h = hit(x, y);
    const at = Math.max(0, tOf(x));
    const items = [];
    const add = (text, key, fn, off) => items.push([text, key, fn, off]);
    const sep = () => items.push(null);
    const rr = () => { refreshHeads(); refreshInspector(); draw(); };
    const trk = h.index != null ? tl.tracks[h.index] : null;
    if (h.kind === 'marker') {
      const mk = h.marker;
      selection = { kind: 'marker', markerId: mk.id };
      add('İşarete git', '', () => { seek(mk.t); applyClipsAt(ensureTransport().time); draw(); });
      add('Yeniden adlandır', '', () => { refreshInspector(); const n = typeof document.querySelector === 'function' && document.querySelector('.tl-marker-name'); if (n && n.focus) n.focus(); });
      add('Sil', 'Del', () => deleteSelection());
    } else if (h.kind === 'ruler' || h.kind === 'tempo' || h.kind.indexOf('loop') === 0) {
      add('Buraya işaret', 'M', () => { addMarkerAtPlayhead(at); rr(); refreshMore(); });
      add('Döngü başı burası', 'I', () => setLoopEdge('in', at));
      add('Döngü sonu burası', 'O', () => setLoopEdge('out', at));
      add(tl.loop.enabled ? 'Döngüyü kapat' : 'Döngüyü aç', 'Shift+L', () => { tl.loop.enabled = !tl.loop.enabled; commit(); reanchor(); refreshMore(); draw(); });
      add('Kafayı buraya al', '', () => { seek(at); applyClipsAt(ensureTransport().time); draw(); });
    } else if ((h.kind === 'move' || h.kind === 'trimL' || h.kind === 'trimR' || h.kind === 'fade') && trk) {
      const c = trk.clips[h.ci];
      if (!isPicked(c, trk)) multi = [];
      selection = { kind: 'clip', trackId: trk.id, clipId: c.id };
      const lk = trk.locked;
      add('Kes', 'Ctrl+X', () => cutSelection(), lk);
      add('Kopyala', 'Ctrl+C', () => copySelection());
      add('Yapıştır', 'Ctrl+V', () => pasteAtPlayhead(), lk);
      add('Çoğalt', 'Ctrl+D', () => duplicateSelection(), lk);
      add('Kafada böl', 'S', () => splitAtPlayhead(), lk);
      sep();
      if (c.type === 'scene') {
        add('Geçiş türü: ' + (c.transType ? transLabel(c) : 'sahne varsayılanı') + ' …', '', () => {
          subMenu(transTypePairs(), c.transType || '', (v) => { c.transType = v; commit(); rr(); }, cx, cy);
        }, lk);
        add('Geçiş eğrisi: ' + ((transEasePairs().find((q) => q[0] === (c.transEase || '')) || ['', ''])[1]) + ' …', '', () => {
          subMenu(transEasePairs(), c.transEase || '', (v) => { c.transEase = v; commit(); rr(); }, cx, cy);
        }, lk);
        add('Geçiş süresi…', '', () => { refreshInspector(); }, lk);
        add('Geçişi sahneye bırak', '', () => { c.transType = ''; c.transEase = ''; c.fade = 0; commit(); rr(); }, lk || !(c.transType || c.transEase || c.fade));
        sep();
      }
      add('Üst parçaya taşı', 'Alt+↑', () => moveSelectionTrack(-1), lk);
      add('Alt parçaya taşı', 'Alt+↓', () => moveSelectionTrack(1), lk);
      add('Rengi parçadan al', '', () => { c.color = ''; commit(); draw(); }, !c.color);
      sep();
      add('Sil', 'Del', () => deleteSelection(), lk);
    } else if (h.kind === 'key' && trk) {
      selection = { kind: 'key', trackId: trk.id, keyIndex: h.ki };
      const k = trk.keys[h.ki];
      keyCurves().map((id) => [id, curveLabel(id)]).forEach(([id, lb]) => add((k.curve === id ? '• ' : '') + 'Eğri: ' + lb, '', () => { k.curve = id; commit(); draw(); }, trk.locked));
      sep();
      add('Noktayı sil', 'Del', () => deleteSelection(), trk.locked);
    } else if (h.kind === 'autotrack' && trk) {
      add('Buraya nokta ekle', 'Çift tık', () => {
        const v = Math.max(0, Math.min(1, (h.bot - y) / (h.bot - h.top)));
        trk.keys.push({ t: snap(at, false), v, curve: 'linear' });
        trk.keys.sort((a, b) => a.t - b.t);
        commit(); linkOutput(); draw();
      }, trk.locked);
      add('Hedef seç…', '', () => openTargetPicker(trk, cx, cy));
      add('Hedefi Kaldır', '', () => clearTarget(trk), !trk.target);
      add(recording.has(trk.id) ? 'Kaydı durdur' : isLearning(trk) ? 'Öğrenmeyi bırak' : trk.target ? 'Kaydet' : 'Öğren', 'R', () => { toggleRecord(trk); rr(); });
      add('Noktaları temizle', '', () => { trk.keys = []; commit(); draw(); }, trk.locked || !trk.keys.length);
    } else if (h.kind === 'track' && trk) {
      add('Buraya klip ekle', 'Çift tık', () => { addClipAt(trk, snap(at, false)); P().rerender(); }, trk.locked);
      add('Yapıştır', 'Ctrl+V', () => { seek(at); pasteAtPlayhead(); }, trk.locked);
      add('Buraya işaret', 'M', () => { addMarkerAtPlayhead(at); rr(); refreshMore(); });
    } else {
      add('Kısayollar', '?', () => showShortcuts());
    }
    if (trk) { sep(); trackMenuItems(trk, add); }
    return openMenu(items, cx, cy);
  }
  // Parça başlığının (ve şerit menüsünün) parça öğeleri
  function trackMenuItems(trk, add) {
    const tl = ensureTransport().tl;
    const i = tl.tracks.indexOf(trk);
    add(trk.muted ? 'Sesi aç (M kapalı)' : 'Sustur', '', () => { trk.muted = !trk.muted; commit(); linkOutput(); refreshHeads(); draw(); });
    if (trk.kind === 'clip') add(trk.solo ? 'Soloyu kaldır' : 'Solo', '', () => { trk.solo = !trk.solo; commit(); refreshHeads(); draw(); });
    add(trk.locked ? 'Kilidi aç' : 'Kilitle', '', () => { trk.locked = !trk.locked; commit(); refreshHeads(); draw(); });
    // Parça opaklığı (#957): bu parçanın sahnesi alttakilerin üstünde bu oranla
    if (trk.kind === 'clip') {
      const opNow = Math.round((trk.opacity == null ? 1 : trk.opacity) * 100);
      add('Parça opaklığı…', '%' + opNow, () => {
        subMenu([['1', '%100'], ['0.75', '%75'], ['0.5', '%50'], ['0.25', '%25']], String(trk.opacity == null ? 1 : trk.opacity),
          (v) => { trk.opacity = Number(v); commit(); applyClipsAt(ensureTransport().time); refreshHeads(); draw(); }, lastMenuXY[0], lastMenuXY[1]);
      });
    }
    add('Parçayı yukarı', '', () => { const [t] = tl.tracks.splice(i, 1); tl.tracks.splice(i - 1, 0, t); commit(); P().rerender(); }, i <= 0);
    add('Parçayı aşağı', '', () => { const [t] = tl.tracks.splice(i, 1); tl.tracks.splice(i + 1, 0, t); commit(); P().rerender(); }, i >= tl.tracks.length - 1);
    add('Parçayı sil…', '', async () => {
      if (!(await P().confirm('Bu parça ve içindeki her şey silinecek.', { danger: true, okText: 'Sil' }))) return;
      const at = tl.tracks.indexOf(trk);
      if (at >= 0) tl.tracks.splice(at, 1);
      selection = null; commit(); P().rerender();
    });
  }
  let lastMenuXY = [0, 0];
  function openMenu(items, cx, cy) {
    lastMenuXY = [cx, cy];
    const el = P().el;
    const m = el('div', { class: 'sv-menu tl-ctx', role: 'menu' });
    items.forEach((it) => {
      if (!it) { if (m.children && m.children.length) m.appendChild(el('div', { class: 'sv-menu-sep', role: 'separator' })); return; }
      const [text, key, fn, off] = it;
      const b = el('button', { type: 'button', role: 'menuitem', onclick: () => { m.remove(); fn(); } }, [
        el('span', { text: tt(text) }), key ? el('kbd', { text: key }) : null,
      ].filter(Boolean));
      if (off) b.disabled = true;
      m.appendChild(b);
    });
    m._items = items.filter(Boolean).map((q) => q[0]);
    m._run = (label) => { const q = items.find((z) => z && z[0].indexOf(label) === 0); if (q && !q[3]) { m.remove(); q[2](); return true; } return false; };
    refreshInspector();
    draw();
    if (window.SVSceneShell && window.SVSceneShell.placeMenu) window.SVSceneShell.placeMenu(m, cx, cy);
    return m;
  }
  function subMenu(pairs, cur, onPick, cx, cy) {
    return openMenu(pairs.map(([v, lb]) => [(v === cur ? '• ' : '') + lb, '', () => onPick(v)]), cx, cy);
  }

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

  function selMarker() {
    if (!selection || selection.kind !== 'marker') return null;
    return ensureTransport().tl.markers.find((m) => m.id === selection.markerId) || null;
  }

  function deleteSelection() {
    if (selection && selection.kind === 'marker') {
      const tl = ensureTransport().tl;
      const i = tl.markers.findIndex((m) => m.id === selection.markerId);
      if (i < 0) return false;
      tl.markers.splice(i, 1);
      selection = null;
      commit();
      refreshMore();
      return true;
    }
    // Tempo değişimi: ilk giriş (parçanın başındaki tempo) silinmiyor
    if (selection && selection.kind === 'tempo') {
      if (!(selection.index > 0)) return false;
      const list = TE().removeTempoChange(ensureTransport().tl.tempo, selection.index);
      selection = null;
      applyTempo(list);
      return true;
    }
    if (multi.length > 1) {
      // Kilitli parçalardaki klipler yerinde kalıyor
      const gone = pickedClips().filter((p) => !p.trk.locked);
      if (!gone.length) return false;
      for (const p of gone) p.trk.clips.splice(p.trk.clips.indexOf(p.clip), 1);
      multi = [];
      selection = null;
      commit();
      return true;
    }
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

  // Yapıştırılan/çoğaltılan grubu şeritlerine koy ve yeni grubu seç
  function placeGroup(placed) {
    const tl = ensureTransport().tl;
    const refs = [];
    const touched = new Set();
    for (const p of placed) {
      const trk = tl.tracks[p.trackIndex];
      if (!trk || trk.kind !== 'clip' || trk.locked) continue;
      trk.clips.push(p.clip);
      touched.add(trk);
      refs.push({ trackId: trk.id, clipId: p.clip.id });
    }
    touched.forEach((t) => TE().sortClips(t));
    if (!refs.length) return false;
    setMulti(refs);
    commit();
    return true;
  }

  function duplicateSelection() {
    if (multi.length > 1) {
      const picked = pickedClips().filter((p) => !p.trk.locked);
      return picked.length ? placeGroup(TE().duplicateGroup(ensureTransport().tl, picked)) : false;
    }
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
    if (multi.length > 1) {
      clipboard = { group: TE().copyGroup(pickedClips()) };
      return !!clipboard.group;
    }
    const c = selClip();
    if (!c) return false;
    clipboard = JSON.parse(JSON.stringify(c));
    return true;
  }

  function pasteAtPlayhead() {
    if (!clipboard) return false;
    if (clipboard.group) {
      // Grup kafaya; ilk şerit seçili (ya da ilk) klip parçası, göreli şeritler korunuyor
      const base = trackIndex(targetClipTrack().id);
      return placeGroup(TE().pasteGroup(ensureTransport().tl, clipboard.group, snap(ensureTransport().time, false), base));
    }
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
    if (multi.length > 1) {
      const picked = pickedClips().filter((p) => !p.trk.locked);
      if (!picked.length) return false;
      const d = TE().groupDelta(picked.map((p) => p.clip.start), dir * step);
      const touched = new Set();
      for (const p of picked) {
        p.clip.start += d;
        touched.add(p.trk);
      }
      touched.forEach((t) => TE().sortClips(t));
      commit();
      draw();
      return true;
    }
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

  /* Seçili klip(ler)i komşu klip parçasına taşı (↑/↓). Grupta her klip
     aynı sayıda klip parçası kayıyor; biri sığmıyorsa hiçbiri. */
  function moveSelectionTrack(dir) {
    const tl = ensureTransport().tl;
    const picked = pickedClips().filter((q) => !q.trk.locked);
    if (!picked.length) return false;
    const plan = [];
    for (const q of picked) {
      const j = TE().adjacentClipTrack(tl, q.trackIndex, dir);
      if (j < 0) return false;
      plan.push([q, j]);
    }
    const refs = [];
    for (const [q, j] of plan) {
      const to = TE().moveClipToTrack(tl, q.clip, j);
      if (to) refs.push({ trackId: to.id, clipId: q.clip.id });
    }
    if (!refs.length) return false;
    if (refs.length > 1) setMulti(refs);
    else selection = { kind: 'clip', trackId: refs[0].trackId, clipId: refs[0].clipId };
    commit();
    return true;
  }

  function cutSelection() {
    if (!copySelection()) return false;
    return deleteSelection();
  }

  // Döngü girişi / çıkışı kafada (I / O)
  function setLoopEdge(which, at) {
    const tl = ensureTransport().tl;
    const t = at == null ? ensureTransport().time : at;
    const lp = Object.assign({}, tl.loop);
    if (which === 'in') {
      lp.start = Math.max(0, t);
      if (!(lp.end > lp.start)) lp.end = lp.start + TE().gridStep(tl.tempo, 'bar', 60, lp.start) * 4;
    } else {
      lp.end = Math.max(0.05, t);
      if (!(lp.end > lp.start)) lp.start = Math.max(0, lp.end - TE().gridStep(tl.tempo, 'bar', 60, 0) * 4);
    }
    lp.enabled = true;
    tl.loop = lp;
    commit();
    reanchor();
    refreshToolbar();
    draw();
    return true;
  }

  /* J/K/L: geri, dur, ileri. Tekrar basınca hız katlanıyor (1, 2, 4).
     K hızı 1'e döndürüp duraklatıyor. */
  function shuttle(dir) {
    const tr = syncTransportFromAnchor();
    if (dir === 0) {
      tr.rate = 1;
      pause();
      refreshToolbar();
      return true;
    }
    linkOutput();
    const r = tr.playing ? tr.rate || 1 : 0;
    let nr;
    if (dir > 0) nr = r > 0 ? Math.min(4, r * 2) : 1;
    else nr = r < 0 ? Math.max(-4, r * 2) : -1;
    tr.rate = nr;
    play();
    refreshToolbar();
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

  function addMarkerAtPlayhead(at) {
    const tl = ensureTransport().tl;
    const m = TL().makeMarker({ t: at == null ? ensureTransport().time : at, name: tt('İşaret') + ' ' + (tl.markers.length + 1) });
    tl.markers.push(m);
    tl.markers.sort((a, b) => a.t - b.t);
    selection = { kind: 'marker', markerId: m.id };
    multi = [];
    commit();
    return m;
  }

  function selectAllClips() {
    const refs = [];
    for (const trk of ensureTransport().tl.tracks) {
      if (trk.kind === 'clip') for (const c of trk.clips) refs.push({ trackId: trk.id, clipId: c.id });
    }
    if (!refs.length) return false;
    setMulti(refs);
    return true;
  }

  /* Tam pencere düzenleyici (#636 TL-2): panel ekranı kaplıyor, düzenleme
     alanı pencerenin boyunu alıyor. Uzun bir gösteriyi 280 piksellik bir
     şeritte düzenlemek zordu. Esc ya da aynı düğme kapatıyor. */
  function setFull(v) {
    fullWin = !!v;
    if (hostEl && hostEl.classList) hostEl.classList.toggle('tl-full', fullWin);
    if (typeof document !== 'undefined' && document.body && document.body.classList) document.body.classList.toggle('tl-full-open', fullWin);
    refreshToolbar();
    const ed = hostEl && hostEl.querySelector ? hostEl.querySelector('.tl-editor') : null;
    if (ed && ed.focus) ed.focus({ preventScroll: true });
    setTimeout(draw);
  }

  // Sahne listesinden: oynatma kafasına sahne klibi
  function addSceneAtHead(id) {
    const trk = targetClipTrack();
    if (trk.locked) { P().toast('Parça kilitli.', 'warn'); return; }
    const c = addClipAt(trk, snap(ensureTransport().time, false));
    c.type = 'scene';
    c.ref = id;
    commit();
    linkOutput();
    P().rerender();
  }

  /* Çizelge çıkışı sürüyor mu: `timeline.enabled`. Anahtar yerine kullanımla açılıyor. */
  function linkOutput() {
    const cfg = tlCfg();
    if (cfg.enabled) return;
    cfg.enabled = true;
    P().apply();
    start();
  }
  function unlinkOutput() {
    const cfg = tlCfg();
    cfg.enabled = false;
    ensureTransport().pause();
    reanchor();
    P().apply();
  }

  function togglePlay() {
    linkOutput();
    const tr = syncTransportFromAnchor();
    if (tr.playing) pause();
    else { tr.rate = 1; play(); }
    refreshToolbar();
  }

  /* Sürükleme isteği bekletiliyor; sonraki karede en son konum uygulanır. */
  let scrubWant = null;
  let scrubRaf = 0;
  function scrubTo(t, free) {
    scrubWant = free ? Math.max(0, t) : snap(t, false);
    if (!scrubRaf) scrubRaf = requestAnimationFrame(flushScrub);
  }
  function flushScrub() {
    if (scrubRaf) cancelAnimationFrame(scrubRaf);
    scrubRaf = 0;
    if (scrubWant == null) return;
    const t = scrubWant;
    scrubWant = null;
    transport.seek(t);
    applyClipsAt(transport.time);
    reanchor();
    placeHead();
  }

  function bindCanvas(cv) {
    canvas = cv;
    ctx = cv.getContext('2d');
    /* İşaretçi yakalama: sürükleme pencere dışına çıksa da kopmuyor */
    cv.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && cv.setPointerCapture) { try { cv.setPointerCapture(e.pointerId); } catch { /* yok say */ } }
    });

    // İşaretin üstüne gelince vurgu ve el imleci (#957)
    cv.addEventListener('mousemove', (e) => {
      if (drag) return;
      const r = cv.getBoundingClientRect();
      const h = hit(e.clientX - r.left, e.clientY - r.top);
      const id = h.kind === 'marker' ? h.marker.id : '';
      cv.style.cursor = id ? 'grab' : '';
      if (id !== hoverMarkerId) { hoverMarkerId = id; draw(); }
    });
    cv.addEventListener('mouseleave', () => { if (hoverMarkerId) { hoverMarkerId = ''; cv.style.cursor = ''; draw(); } });
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      contextMenuAt(e.clientX - r.left, e.clientY - r.top, e.clientX, e.clientY);
    });
    cv.addEventListener('mousedown', (e) => {
      if (e.button != null && e.button !== 0) return;
      // Kısayollar düzenleyici odaktayken çalışıyor: tuvale tıklamak odaklıyor
      const ed = cv.closest ? cv.closest('.tl-editor') : null;
      if (ed && ed.focus) ed.focus({ preventScroll: true });
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const h = hit(x, y);
      const tl0 = transport.tl;
      if (h.kind === 'loopL' || h.kind === 'loopR' || h.kind === 'loopMove') {
        drag = { kind: h.kind, t0: tOf(x), s0: tl0.loop.start, e0: tl0.loop.end };
        return;
      }
      if (h.kind === 'marker') {
        // Tık: işarete git; sürükleme: işareti taşı (bırakınca karar veriliyor)
        selection = { kind: 'marker', markerId: h.marker.id };
        multi = [];
        drag = { kind: 'marker', marker: h.marker, t0: tOf(x), mt0: h.marker.t, x0: x };
        refreshInspector();
        draw();
        return;
      }
      if (h.kind === 'tempo') {
        // Tık: seç (denetçide BPM ve ölçü); sürükleme: taşı
        selection = { kind: 'tempo', index: h.index };
        multi = [];
        const base = TE().tempoList(tl0.tempo);
        drag = { kind: 'tempo', index: h.index, t0: tOf(x), tt0: tl0.tempo[h.index].t, x0: x, base,
          grid: TL().makeTempoMap(TE().removeTempoChange(base, h.index)) };
        refreshInspector();
        draw();
        return;
      }
      if (h.kind === 'ruler' && e.shiftKey) {
        // Shift+sürükleme cetvelde yeni bir döngü bölgesi çiziyor
        drag = { kind: 'loopNew', t0: snap(tOf(x), e.altKey) };
        return;
      }
      if (h.kind === 'ruler') {
        // Cetvele tıklamak sürüklemedir: duraklatılmışken de sahne güncellenir
        drag = { kind: 'scrub' };
        scrubTo(tOf(x), e.altKey);
        flushScrub();
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
      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      if ((h.kind === 'move' || h.kind === 'trimL' || h.kind === 'trimR' || h.kind === 'fade') && additive) {
        // Ctrl/Shift+tık: seçime ekle ya da çıkar, taşıma yok
        toggleMulti(trk, trk.clips[h.ci]);
        drag = { kind: 'select' };
      } else if (h.kind === 'fade') {
        const c = trk.clips[h.ci];
        if (!isPicked(c, trk)) multi = [];
        selection = { kind: 'clip', trackId: trk.id, clipId: c.id };
        drag = trk.locked ? { kind: 'select' } : { kind: 'fade', trackId: trk.id, clip: c };
      } else if (h.kind === 'move' || h.kind === 'trimL' || h.kind === 'trimR') {
        const c = trk.clips[h.ci];
        // Seçili bir gruba tıklamak grubu korur (grup taşıma); başka klibe tıklamak tek seçim
        if (!isPicked(c, trk) || h.kind !== 'move') multi = [];
        selection = { kind: 'clip', trackId: trk.id, clipId: c.id };
        /* Grup taşıma: birincil klip yakalamaya göre kayar, diğerleri aynı
           miktarda. Kilitli parçadaki klipler yerinde kalıyor. */
        const group = h.kind === 'move' && multi.length > 1
          ? pickedClips().filter((p) => !p.trk.locked).map((p) => ({ trackId: p.trk.id, clip: p.clip, start0: p.clip.start }))
          : null;
        // Kilitli parçada seçilebiliyor ama taşınamıyor
        drag = trk.locked ? { kind: 'select' } : { kind: h.kind, trackId: trk.id, clip: c, t0: tOf(x), start0: c.start, dur0: c.dur, group };
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
        /* Boş şeride tıklamak parçayı seçiyor: yapıştırma ve bölme oraya.
           Klip şeridinde sürüklemek kutu seçimi başlatıyor (Ctrl/Shift ile
           var olan seçime ekliyor). */
        const keep = additive ? pickedClips().map((p) => ({ trackId: p.trk.id, clipId: p.clip.id })) : [];
        if (!additive) multi = [];
        selection = { kind: 'track', trackId: trk.id };
        if (h.kind === 'track') drag = { kind: 'marquee', x0: x, y0: y, x1: x, y1: y, keep };
      } else {
        multi = [];
        selection = null;
      }
      if (h.kind === 'key') multi = [];
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
      const tl = transport.tl;
      if (drag.kind === 'scrub') {
        /* Sürükleme kare başına bir kez işleniyor: fare olayı kareden sık
           geliyor ve her biri çıpayı IPC ile yolluyordu. Shift ya da Alt
           yakalamayı kapatır; o zaman konum kare altı hassasiyette. */
        scrubTo(tOf(x), e.altKey || e.shiftKey);
        return;
      } else if (drag.kind === 'loopL' || drag.kind === 'loopR' || drag.kind === 'loopMove') {
        const len = drag.e0 - drag.s0;
        if (drag.kind === 'loopL') {
          tl.loop.start = Math.max(0, Math.min(snap(tOf(x), e.altKey), tl.loop.end - 0.05));
        } else if (drag.kind === 'loopR') {
          tl.loop.end = Math.max(snap(tOf(x), e.altKey), tl.loop.start + 0.05);
        } else {
          const ns = Math.max(0, snap(drag.s0 + tOf(x) - drag.t0, e.altKey));
          tl.loop.start = ns;
          tl.loop.end = ns + len;
        }
        drag.moved = true;
      } else if (drag.kind === 'loopNew') {
        const a = snap(tOf(x), e.altKey);
        if (Math.abs(a - drag.t0) > 0.01) {
          tl.loop = { enabled: true, start: Math.max(0, Math.min(a, drag.t0)), end: Math.max(a, drag.t0) };
          drag.moved = true;
        }
      } else if (drag.kind === 'marker') {
        // Küçük titreme tıklamayı sürüklemeye çevirmesin
        if (!drag.moved && Math.abs(x - drag.x0) < 3) return;
        drag.marker.t = snap(drag.mt0 + tOf(x) - drag.t0, e.altKey);
        drag.moved = true;
      } else if (drag.kind === 'tempo') {
        if (!drag.moved && Math.abs(x - drag.x0) < 3) return;
        /* Yakalama ızgarası, sürüklenen değişim OLMADAN kurulan haritadan:
           değişim kendinden önceki tempo'nun ölçü çizgisine oturuyor. Kendi
           haritasıyla yakalasaydı ızgara her adımda onunla kayardı (uygulamada
           10 yerine 10,67'ye oturdu). Komşularının arasında kalıyor. */
        const raw = Math.max(0, drag.tt0 + tOf(x) - drag.t0);
        const c = tlCfg();
        const t = e.altKey ? raw : TL().snapSeconds(drag.grid, raw, c.snap, c.fps);
        tl.tempo = TL().makeTempoMap(TE().moveTempoChange(drag.base, drag.index, t));
        drag.moved = true;
      } else if (drag.kind === 'marquee') {
        drag.x1 = x;
        drag.y1 = y;
        if (Math.abs(x - drag.x0) + Math.abs(y - drag.y0) > 4) drag.moved = true;
      } else if (drag.kind === 'fade') {
        const trk = trackById(drag.trackId);
        const c = drag.clip;
        if (!trk || !trk.clips || trk.clips.indexOf(c) < 0) { drag = null; return; }
        c.fade = Math.round(Math.max(0, Math.min(c.dur, tOf(x) - c.start)) * 100) / 100;
        drag.moved = true;
      } else if (drag.kind === 'move' && drag.group) {
        // Grup: birincil yakalamaya göre, hepsi aynı kayma; hiçbiri sıfırın soluna geçmez
        const want = snap(drag.start0 + tOf(x) - drag.t0, e.altKey) - drag.start0;
        const d = TE().groupDelta(drag.group.map((g) => g.start0), want);
        const touched = new Set();
        for (const g of drag.group) {
          g.clip.start = g.start0 + d;
          touched.add(g.trackId);
        }
        touched.forEach((id) => TE().sortClips(trackById(id)));
        drag.moved = true;
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
          c.start = snapMove(drag.start0 + delta, c.dur, e.altKey, [c]);
          /* Dikey taşıma (#957): imlecin satırı hedef parça; son satırın
             altı bırakınca yeni parça. Yalnız klip parçaları, kilitli değil. */
          const row = Math.floor((y - RULER_H) / TRACK_H);
          const cur = transport.tl.tracks.indexOf(trk);
          drag.newTrack = row >= transport.tl.tracks.length;
          if (!drag.newTrack && row >= 0 && row !== cur) {
            const to = TE().moveClipToTrack(transport.tl, c, row);
            if (to) { drag.trackId = to.id; selection = { kind: 'clip', trackId: to.id, clipId: c.id }; }
          }
        } else if (drag.kind === 'trimL') {
          const ns = snap(drag.start0 + delta, e.altKey, [c]);
          const end = drag.start0 + drag.dur0;
          c.start = Math.min(ns, end - 0.05);
          c.dur = end - c.start;
        } else {
          c.dur = Math.max(0.05, snap(drag.start0 + drag.dur0 + delta, e.altKey, [c]) - c.start);
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
      if (d.kind === 'scrub') { flushScrub(); return; }
      if (d.kind === 'select') {
        refreshInspector();
        draw();
        return;
      }
      if (d.kind === 'marquee') {
        if (d.moved && canvas) {
          const i0 = Math.floor((Math.min(d.y0, d.y1) - RULER_H) / TRACK_H);
          const i1 = Math.floor((Math.max(d.y0, d.y1) - RULER_H) / TRACK_H);
          const found = TE().clipsInRect(transport.tl, tOf(Math.min(d.x0, d.x1)), tOf(Math.max(d.x0, d.x1)), i0, i1);
          const refs = d.keep.slice();
          for (const f of found) if (!refs.some((r) => r.clipId === f.clipId && r.trackId === f.trackId)) refs.push(f);
          if (refs.length) setMulti(refs);
          refreshInspector();
          refreshHeads();
        }
        draw();
        return;
      }
      if (d.kind === 'tempo') {
        if (d.moved) commit();
        refreshInspector();
        draw();
        return;
      }
      if (d.kind === 'move' && d.newTrack && d.clip) {
        const to = TE().moveClipToTrack(transport.tl, d.clip, transport.tl.tracks.length,
          () => TL().makeTrack({ kind: 'clip', name: tt('Parça') + ' ' + (transport.tl.tracks.length + 1) }));
        if (to) selection = { kind: 'clip', trackId: to.id, clipId: d.clip.id };
        refreshHeads();
      }
      if (d.kind === 'marker') {
        if (!d.moved) {
          // Tıklama: işarete git
          seek(d.marker.t);
          applyClipsAt(transport.time);
          draw();
          return;
        }
        transport.tl.markers.sort((a, b) => a.t - b.t);
      }
      if ((d.kind === 'loopL' || d.kind === 'loopR' || d.kind === 'loopMove' || d.kind === 'loopNew') && !d.moved) return;
      // Yalnız tıklanıp bırakılan klip değişmedi: geçmişe adım eklenmiyor (commit aynıysa eklemiyor)
      commit();
      if (d.kind.indexOf('loop') === 0) {
        reanchor();
        refreshMore();
      }
      if (d.kind === 'marker') refreshMore();
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
    // Kayıt duraklatınca tek adım olarak geçmişe
    if (recordDirty) { recordDirty = false; commit(); }
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
  /* Yedek makine birincili izlerken (#544): taşıma birincilin çıpasından
     (ana süreç bu makinenin saatine çevirdi). Geri yollanmaz — çıpa zaten
     ana süreçte ve pencerelerde. Yetkiyi alınca taşıma kaldığı yerden sürer. */
  function followAnchor(a) {
    if (!a || typeof a !== 'object' || !window.SVShowClock) return;
    clockAnchor = a;
    lastAnchorKey = a.playing + '|' + Number(a.time || 0).toFixed(4) + '|' + a.rate +
      '|' + (a.loop ? a.loop.start + ',' + a.loop.end : '-');
    syncTransportFromAnchor();
    if (a.playing) start();
  }

  // --------------------------------------------------------------------------
  // Klavye (#636). Yalnız düzenleyici odaktayken ve bir metin alanına
  // yazılmıyorken: denetçide ad yazarken Boşluk oynatmamalı, Sil klibi
  // silmemeli. Genel kısayollar (Ctrl+K arama, Esc) dokunulmadan kalıyor.
  // --------------------------------------------------------------------------
  /* Kısayollar (#957): Premiere/Resolve düzeninde. Zaman sayfasında
     düzenleyici odakta olmasa da çalışıyor (belge düzeyinde dinleniyor),
     ama bir metin alanına, seçime ya da açık bir menüye yazılırken asla.
     Bağlam menülerindeki ipuçları da bu tablodan. */
  const SHORTCUTS = [
    ['Boşluk', 'Oynat / duraklat'],
    ['J / K / L', 'Geri oynat / dur / ileri oynat (tekrar: 2×, 4×)'],
    ['Home / End', 'Başa / sona'],
    ['← →', 'Seçili klibi ya da kafayı bir ızgara adımı kaydır (Shift: bir ölçü, Alt: bir kare)'],
    ['↑ ↓', 'Seçili klibi üst / alt klip parçasına taşı'],
    ['Del / Backspace', 'Seçili klibi, anahtarı ya da işareti sil'],
    ['Ctrl+X / C / V', 'Kes / kopyala / kafaya yapıştır'],
    ['Ctrl+D', 'Çoğalt'],
    ['S / Ctrl+K', 'Oynatma kafasında böl'],
    ['Ctrl+Z / Ctrl+Y', 'Geri al / yinele'],
    ['M', 'Kafada işaret'],
    ['I / O', 'Döngü girişi / çıkışı kafada'],
    ['Shift+L', 'Döngü aç / kapat'],
    ['+ / −', 'Yakınlaştır / uzaklaştır'],
    ['Shift+Z / 0', 'Hepsini sığdır'],
    ['Ctrl+A / Esc', 'Tüm klipleri seç / seçimi bırak'],
    ['R', 'Seçili otomasyon şeridinde kaydı aç / kapat'],
    ['F', 'Tam pencere aç / kapat'],
    ['?', 'Bu listeyi göster'],
    ['Ctrl/Shift+tık', 'Klibi seçime ekle / çıkar'],
    ['Boş şeritte sürükle', 'Kutu seçimi'],
    ['Klibi yukarı / aşağı sürükle', 'Başka parçaya taşı; en alta bırakmak yeni parça açar'],
    ['Alt+sürükle', 'Yakalamayı askıya al'],
    ['Ctrl+tekerlek / tekerlek', 'İmleçte yakınlaştır / zamanda kaydır (Shift: dikey)'],
    ['Shift+cetvelde sürükle', 'Döngü bölgesi çiz'],
    ['Klibin sol üst köşesi', 'Geçiş süresini sürükle'],
    ['Sağ tık', 'Klip, şerit, parça başlığı, cetvel ve işaret menüleri'],
  ];
  // Menülerde gösterilen ipuçları
  const HINT = {
    cut: 'Ctrl+X', copy: 'Ctrl+C', paste: 'Ctrl+V', dup: 'Ctrl+D', split: 'S', del: 'Del',
    marker: 'M', loopIn: 'I', loopOut: 'O', loop: 'Shift+L', up: '↑', down: '↓', rec: 'R',
  };

  function isTyping(tg) {
    const tag = tg && tg.tagName ? tg.tagName.toLowerCase() : '';
    return tag === 'input' || tag === 'textarea' || tag === 'select' || !!(tg && tg.isContentEditable);
  }

  /* Bitişik işarete atla ve seç (#957): Alt+←/→, işaret seçiliyken Tab */
  function jumpMarker(dir) {
    const tr = ensureTransport();
    const cur = selection && selection.kind === 'marker' ? selMarker() : null;
    const m = TL().markerStep(tr.tl.markers, cur ? cur.t : tr.time, dir);
    if (!m) return false;
    selection = { kind: 'marker', markerId: m.id };
    multi = [];
    seek(m.t);
    applyClipsAt(ensureTransport().time);
    refreshInspector();
    draw();
    return true;
  }

  function onEditorKey(e) {
    const tg = e.target;
    if (isTyping(tg)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const low = typeof k === 'string' && k.length === 1 ? k.toLowerCase() : k;
    let done = true;
    if (k === ' ' || k === 'Spacebar') togglePlay();
    else if (!mod && low === 'j') shuttle(-1);
    else if (!mod && low === 'k') shuttle(0);
    else if (!mod && low === 'l' && !e.shiftKey) shuttle(1);
    else if (!mod && low === 'l' && e.shiftKey) { toggleLoop(); refreshToolbar(); }
    else if (k === 'Home') { seek(0); applyClipsAt(0); draw(); }
    else if (k === 'End') { seek(TL().timelineLength(ensureTransport().tl)); draw(); }
    else if (mod && low === 'z' && !e.shiftKey) undo();
    else if (mod && ((low === 'z' && e.shiftKey) || low === 'y')) redo();
    else if (mod && low === 'd') { if (duplicateSelection()) refreshAll(); }
    else if (mod && low === 'c') copySelection();
    else if (mod && low === 'x') { if (cutSelection()) refreshAll(); }
    else if (mod && low === 'v') { if (pasteAtPlayhead()) refreshAll(); }
    else if ((!mod && low === 's') || (mod && low === 'k')) { if (splitAtPlayhead()) refreshAll(); }
    else if (k === 'Delete' || k === 'Backspace') { if (deleteSelection()) refreshAll(); }
    else if ((k === 'ArrowLeft' || k === 'ArrowRight') && e.altKey && !e.shiftKey && !mod && (!selection || selection.kind === 'marker')) jumpMarker(k === 'ArrowLeft' ? -1 : 1);
    // İşaret seçiliyken Tab / Shift+Tab sıradaki işarete geçer
    else if (k === 'Tab' && !mod && selection && selection.kind === 'marker') { if (!jumpMarker(e.shiftKey ? -1 : 1)) done = false; }
    else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const dir = k === 'ArrowLeft' ? -1 : 1;
      if (e.shiftKey && !e.altKey) nudgeBar(dir);
      else nudge(dir, e.altKey);
      refreshInspector();
    }
    else if ((k === 'ArrowUp' || k === 'ArrowDown') && !mod) { if (moveSelectionTrack(k === 'ArrowUp' ? -1 : 1)) refreshAll(); }
    else if (!mod && (k === '+' || k === '=')) zoomBy(1.25);
    else if (!mod && (k === '-' || k === '_')) zoomBy(1 / 1.25);
    else if (!mod && (k === '0' || (low === 'z' && e.shiftKey))) fitAll();
    else if (!mod && low === 'm') { addMarkerAtPlayhead(); refreshAll(); }
    else if (!mod && low === 'i') setLoopEdge('in');
    else if (!mod && low === 'o') setLoopEdge('out');
    else if (!mod && low === 'r') { const t = selTrack(); if (!toggleRecord(t)) done = false; }
    else if (mod && low === 'a') { if (selectAllClips()) refreshAll(); }
    else if (!mod && low === 'f') setFull(!fullWin);
    else if (!mod && k === '?') showShortcuts();
    // Esc: önce tam pencere, sonra seçim; ikisi de yoksa genel Esc'e bırakılıyor
    else if (k === 'Escape' && fullWin) setFull(false);
    else if (k === 'Escape' && (selection || multi.length)) { selection = null; multi = []; refreshAll(); }
    else done = false;
    if (done) {
      e.preventDefault();
      e.stopPropagation();
    }
    return done;
  }

  // Bir ölçü kaydır (Shift+←/→)
  function nudgeBar(dir) {
    const cfg = tlCfg();
    const was = cfg.snap;
    cfg.snap = 'bar';
    try { return nudge(dir, false); } finally { cfg.snap = was; }
  }

  /* Belge düzeyi: Zaman sayfasındayken (ya da tam pencerede) kısayollar
     düzenleyici odakta olmasa da çalışsın. Önce yalnız düzenleyici
     odaktayken çalışıyordu; denetçiye tıklayınca Boşluk ölüyordu. Yakalama
     evresinde: genel Ctrl+K (arama) Zaman sayfasında bölmeye gidiyor.
     Açık bir menü ya da pencere varken dokunulmuyor. */
  function onDocKey(e) {
    if (typeof document === 'undefined' || !document.body) return;
    const onTime = (document.body.getAttribute && document.body.getAttribute('data-page') === 'time') || fullWin;
    if (!onTime || !canvas || !canvas.isConnected) return;
    if (isTyping(e.target)) return;
    if (document.querySelector && document.querySelector('.sv-menu, .sv-modal, dialog[open], .tl-keys-dlg')) {
      if (!(e.key === 'Escape' && document.querySelector('.tl-keys-dlg'))) return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) return;
    // Odaktaki bir düğmede Boşluk/Enter düğmenin kendisi
    const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : '';
    if ((tag === 'button' || tag === 'summary') && (e.key === ' ' || e.key === 'Enter')) return;
    onEditorKey(e);
  }
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('keydown', onDocKey, true);

  // ? : kısayol listesi pencerede
  function showShortcuts() {
    const p = P();
    if (!p || typeof document === 'undefined' || !document.body || !document.body.appendChild) return;
    const old = document.querySelector && document.querySelector('.tl-keys-dlg');
    if (old) { old.remove(); return; }
    const el = p.el;
    const close = () => { dlg.remove(); document.removeEventListener('keydown', onEsc, true); };
    const onEsc = (e) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); e.stopPropagation(); close(); } };
    const list = el('div', { class: 'tl-keys-list' });
    for (const [k, d] of SHORTCUTS) {
      list.appendChild(el('kbd', { text: k }));
      list.appendChild(el('span', { text: d }));
    }
    const dlg = el('div', { class: 'tl-keys-dlg', role: 'dialog', 'aria-label': tt('Klavye kısayolları') }, [
      el('div', { class: 'tl-keys-card' }, [
        el('div', { class: 'tl-keys-head' }, [
          el('h3', { text: 'Klavye kısayolları' }),
          el('button', { class: 'btn small', type: 'button', icon: 'x', title: 'Kapat (Esc)', onclick: close }),
        ]),
        list,
        el('div', { class: 'ctrl settings-io-note', text: 'Kısayollar Zaman sayfasında, bir yazı alanında değilken çalışır.' }),
      ]),
    ]);
    dlg.addEventListener('mousedown', (e) => { if (e.target === dlg) close(); });
    document.addEventListener('keydown', onEsc, true);
    document.body.appendChild(dlg);
  }

  const api = {
    panel,
    start,
    play,
    pause,
    stop,
    seek,
    followAnchor,
    transport: () => syncTransportFromAnchor(),
    anchor: () => clockAnchor || (window.SVShowClock ? window.SVShowClock.anchorFrom(syncTransportFromAnchor(), Date.now(), syncTransportFromAnchor().tl && syncTransportFromAnchor().tl.loop) : null),
    /* Öz test ve dış denetim için: paneli açmadan taşımayı sürebilmek. */
    _draw: () => draw(),
    // Test: sahne bileşimini t anında uygula (#957 opaklık piksel denemesi)
    _applyAt: (t) => applyClipsAt(t),
    noteLiveEdit,
    _liveHoldHead: () => liveHoldHead,
    // Başarım denetimi: tuval çizimi ve kafa kaydırma sayıları
    _perf: () => ({ draws: perf.draws, heads: perf.heads }),
    // Düzenleme eylemleri (MIDI/OSC ve testler aynı yoldan)
    undo,
    redo,
    split: splitAtPlayhead,
    duplicate: duplicateSelection,
    remove: deleteSelection,
    fit: fitAll,
    toggleLoop,
    addSceneAtHead,
    selectAll: selectAllClips,
    full: (v) => setFull(v == null ? !fullWin : v),
    _select: (s) => { selection = s; multi = []; },
    _selection: () => selection,
    _picked: () => pickedClips().map((q) => q.trk.id + '/' + q.clip.id),
    // Test: klibin ortası ekran koordinatında (gerçek fare tıklaması için)
    _clipPoint: (ti, ci) => {
      const trk = ensureTransport().tl.tracks[ti];
      const c = trk && trk.clips[ci];
      if (!c || !canvas) return null;
      const r = canvas.getBoundingClientRect();
      return { x: r.left + xOf(c.start + c.dur / 2), y: r.top + RULER_H + ti * TRACK_H + TRACK_H / 2 };
    },
    _hoverClip: () => hoverClipId,
    _multi: () => multi.slice(),
    _full: () => fullWin,
    _clipLabel: clipLabel,
    _refOptions: refOptions,
    _key: onEditorKey,
    _docKey: onDocKey,
    _menu: (x, y) => contextMenuAt(x, y, x, y),
    _targetPicker: (trk) => openTargetPicker(trk, 0, 0),
    _clipTransSpec: (c) => clipTransSpec(c),
    // Otomasyonla sürülen yollar (atlanmamış, hedefi ve noktası olan şeritler)
    automatedPaths: () => {
      const cfg = tlCfg();
      const out = new Set();
      if (!cfg || cfg.enabled === false || !transport) return out;
      transport.tl.tracks.forEach((t) => { if (t.kind === 'automation' && !t.muted && t.target && t.keys && t.keys.length) out.add(t.target); });
      return out;
    },
    _moveTrack: moveSelectionTrack,
    _setTarget: (id, path) => { const t = trackById(id); if (t) setTarget(t, path); },
    _record: (id) => toggleRecord(trackById(id)),
    _recording: () => Array.from(recording.keys()),
    _learning: () => (learning ? learning.id : ''),
    _recordTick: (t) => recordTick(t),
    _catalog: () => { catCache = null; return targetCatalog(); },
    shortcuts: () => SHORTCUTS.slice(),
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
    syncLaneH();
    const tl = ensureTransport().tl;
    history_().sync(TE().snapshot(cfg));
    if (selection && !selTrack()) selection = null;
    const host = el('div', { class: 'tl-panel' + (fullWin ? ' tl-full' : '') });
    hostEl = host;

    /* Etkinleştirme anahtarı yok: çizelge açılır açılmaz düzenleniyor. İlk parça eklenince ya da Oynat'a
       basılınca çıkışa bağlanıyor (`linkOutput`); araç çubuğundaki bağ düğmesi durumu gösterip ayırıyor. */

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

    host.appendChild(timelineTabs());
    const toolbarEl = toolbar();
    host.appendChild(toolbarEl);

    // --- Düzenleyici: başlıklar + tuval, boyu ayarlanabilir ---
    const cv = el('canvas', { class: 'tl-canvas' });
    headsBox = heads();
    headEl = el('div', { class: 'tl-playhead', 'aria-hidden': 'true' });
    headX = NaN;
    const body = el('div', { class: 'tl-body' }, [headsBox, el('div', { class: 'tl-canvas-wrap' }, [cv, headEl])]);
    // Zaman sayfasında boy sayfadan geliyor: kullanıcının boyu olarak saklanmıyor
    const pageFit = () => !!document.body && typeof document.body.getAttribute === 'function' && document.body.getAttribute('data-page') === 'time';
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
        // Tam pencerede boy pencereden geliyor; kullanıcının boyu olarak saklanmamalı
        if (fullWin || pageFit()) { last = 0; draw(); return; }
        const hh = Math.round(body.getBoundingClientRect().height);
        if (!last) { last = hh; return; }
        if (Math.abs(hh - last) > 2) { last = hh; cfg.editorHeight = hh; draw(); }
      });
      ro.observe(body);
    }
    const editor = el('div', { class: 'tl-editor', tabindex: '0', 'aria-label': 'Zaman çizelgesi düzenleyicisi' }, [body]);
    editor.addEventListener('keydown', onEditorKey);
    editor.addEventListener('focus', () => { editorFocus = true; });
    // Yeniden çizimde sökülen düzenleyicinin kaybı odak kaybı sayılmıyor
    editor.addEventListener('blur', () => setTimeout(() => { if (editor.isConnected) editorFocus = false; }, 0));
    host.appendChild(editor);
    if (editorFocus) setTimeout(() => { if (editor.isConnected && editor.focus) editor.focus({ preventScroll: true }); }, 0);
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
          text: '1) “Yeni Şerit” menüsünden “Klip Parçası” ekleyin. 2) Şeride çift tıklayın ya da aynı menüden “Kafada Klip” ile oynatma kafasına klip koyun. 3) Klibe tıklayıp hangi sahneyi çalacağını seçin.',
        })
      );
    } else if (tl.tracks.some((t) => t.kind === 'clip' && !t.clips.length)) {
      host.appendChild(
        el('div', {
          class: 'ctrl settings-io-note',
          text: 'Parça boş. Şeride çift tıklayın ya da “Yeni Şerit” menüsünden “Kafada Klip” ile oynatma kafasına klip koyun; sonra klibe tıklayıp sahnesini seçin.',
        })
      );
    }

    // --- Eklemeler ---
    const addBtn = (text, title, fn) => {
      const [ico, txt] = Array.isArray(text) ? text : ['', text];
      const b = el('button', { class: 'btn small', type: 'button', icon: ico, text: txt, title });
      b.addEventListener('click', fn);
      return b;
    };
    /* Parça ve klip eklemek tek düğmede: araç çubuğu kalabalıklaşmıyor. */
    const addMenu = [
      ['clapper', 'Klip Parçası', 'Sahne, şablon ya da renk klipleri için bir parça', () => {
        const t = TL().makeTrack({ kind: 'clip', name: tt('Parça') + ' ' + (tl.tracks.length + 1) });
        tl.tracks.push(t);
        selection = { kind: 'track', trackId: t.id };
        commit();
        linkOutput();
        p.rerender();
      }],
      ['wave', 'Otomasyon Parçası', 'Bir ayarı zamana yayan eğri', () => {
        const t = TL().makeTrack({ kind: 'automation', name: tt('Otomasyon') + ' ' + (tl.tracks.length + 1) });
        tl.tracks.push(t);
        selection = { kind: 'track', trackId: t.id };
        commit();
        p.rerender();
      }],
      ['plus', 'Kafada Klip', 'Oynatma kafasının bulunduğu yere, seçili (ya da ilk) klip parçasına', () => {
        const trk = targetClipTrack();
        if (trk.locked) {
          p.toast('Parça kilitli.', 'warn');
          return;
        }
        addClipAt(trk, snap(ensureTransport().time, false));
        p.rerender();
      }],
      ['plus', 'Kafada İşaret', 'Oynatma kafasına adlandırılmış bir işaret (M)', () => {
        addMarkerAtPlayhead();
        p.rerender();
      }],
    ];
    toolbarEl.appendChild(el('button', {
      class: 'btn small tl-add', type: 'button', icon: 'plus', text: 'Yeni Şerit', 'aria-haspopup': 'menu',
      onclick: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const m = el('div', { class: 'sv-menu' }, addMenu.map(([ico, text, title, fn]) => el('button', {
          type: 'button', icon: ico, text, title, onclick: () => { m.remove(); fn(); },
        })));
        window.SVSceneShell.placeMenu(m, r.right - 216, r.bottom + 6);
      },
    }));

    // --- Seçili öğe ---
    inspectorBox = inspector();
    const side = typeof document.getElementById === 'function' ? document.getElementById('svTimeSide') : null;
    const inPage = side && document.body.getAttribute('data-page') === 'time' && !fullWin;
    if (inPage) side.replaceChildren(el('div', { class: 'dock-head' }, [el('h3', { text: tt('Seçim') })]), inspectorBox);
    else host.appendChild(inspectorBox);

    // --- Seyrek değişen ayarlar ---
    moreBox = moreSettings();
    if (inPage) side.appendChild(moreBox);
    else host.appendChild(moreBox);

    return host;
  }


  /* Birden çok zaman çizelgesi sekmeleri: oluştur, seç, pasifleştir (silmeden). */
  function timelineTabs() {
    const p = P();
    const el = p.el;
    const cfg = tlCfg();
    TL().ensureTimelineBank(cfg);
    const bar = el('div', { class: 'tl-tabs' });
    const items = TL().listTimelineBank(cfg);
    for (const it of items) {
      const isOn = it.id === cfg.id;
      const passive = it.itemEnabled === false;
      const b = el('button', {
        class: 'tl-tab' + (isOn ? ' on' : '') + (passive ? ' passive' : ''),
        type: 'button',
        text: it.name || it.id,
        title: passive
          ? (it.name || it.id) + ' — pasif (çıkışa/dışa aktarıma uygulanmaz). Sağ tık: menü'
          : (it.name || it.id) + '. Sağ tık: yeniden adlandır / pasifleştir / sil',
      });
      b.addEventListener('click', () => {
        if (it.id === cfg.id) return;
        commit(); /* mevcut belgeyi kaydet */
        TL().switchTimeline(cfg, it.id);
        transport = null;
        lastAppliedClip = new Map();
        lastSceneSig = '';
        liveHoldHead = null;
        selection = null;
        multi = [];
        invalidateModel();
        hist = null;
        p.push(true);
        p.rerender();
      });
      b.addEventListener('contextmenu', (e) => {
        if (e.preventDefault) e.preventDefault();
        const m = el('div', { class: 'sv-menu' });
        const add = (text, fn, danger) => {
          const x = el('button', { type: 'button', text, class: danger ? 'danger' : '', onclick: () => { m.remove(); fn(); } });
          m.appendChild(x);
        };
        add('Yeniden adlandır', () => {
          const name = window.prompt(tt('Çizelge adı'), it.name || '');
          if (name == null) return;
          const n = String(name).trim();
          if (!n) return;
          if (it.id === cfg.id) cfg.name = n;
          else {
            const hit = (cfg.bank || []).find((b) => b && b.id === it.id);
            if (hit) hit.name = n;
          }
          p.push(true);
          p.rerender();
        });
        add(passive ? 'Etkinleştir' : 'Pasifleştir (silme)', () => {
          TL().setTimelineItemEnabled(cfg, it.id, passive);
          p.push(true);
          p.rerender();
        });
        if (items.length > 1) {
          add('Sil', () => {
            if (!window.confirm(tt('Bu zaman çizelgesi silinsin mi?'))) return;
            TL().removeTimeline(cfg, it.id);
            transport = null;
            lastAppliedClip = new Map();
            selection = null;
            multi = [];
            invalidateModel();
            hist = null;
            p.push(true);
            p.rerender();
          }, true);
        }
        window.SVSceneShell.placeMenu(m, e.clientX, e.clientY);
      });
      bar.appendChild(b);
    }
    const add = el('button', { class: 'tl-tab add', type: 'button', icon: 'plus', title: 'Yeni zaman çizelgesi' });
    add.addEventListener('click', () => {
      commit();
      TL().addTimeline(cfg);
      transport = null;
      lastAppliedClip = new Map();
      lastSceneSig = '';
      liveHoldHead = null;
      selection = null;
      multi = [];
      invalidateModel();
      hist = null;
      p.push(true);
      p.rerender();
    });
    bar.appendChild(add);
    return bar;
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
      const [ico, txt] = Array.isArray(text) ? text : ['', text];
      const b = el('button', { class: 'btn tl-btn' + (cls ? ' ' + cls : ''), type: 'button', icon: ico, text: txt, title });
      b._ico = ico;
      b.addEventListener('click', fn);
      return b;
    };
    const group = (kids, cls) => el('div', { class: 'tl-group' + (cls ? ' ' + cls : '') }, kids);

    const playBtn = btn(['play'], 'Oynat / duraklat (Boşluk)', () => togglePlay(), 'tl-play');
    const timeLabel = el('span', { class: 'tl-time', text: fmtClock(0) });
    const barLabel = el('span', { class: 'tl-bars', text: '1.1' });
    const loopBtn = btn(['loop'], 'Döngü (L). Bölge yoksa seçili klibin aralığı ya da kafadan dört ölçü', () => { toggleLoop(); refreshToolbar(); });
    const followBtn = btn(['follow'], 'Oynatırken kafayı takip et', () => {
      cfg.followPlayhead = cfg.followPlayhead === false;
      p.push(true);
      refreshToolbar();
    });
    /* Çıkışa bağ: çizelge sahneleri sürüyor mu, tek bakışta. */
    const linkBtn = btn(['broadcast', cfg.enabled ? 'Çıkışa Bağlı' : 'Çıkışa Bağla'],
      cfg.enabled ? 'Çizelge çıkıştaki sahneleri sürüyor. Ayırmak için basın.' : 'Oynatma kafası tüm görselleştirici ekranlarını birlikte sürsün.',
      () => { if (tlCfg().enabled) unlinkOutput(); else linkOutput(); },
      'tl-link' + (cfg.enabled ? ' on' : ''));
    const undoBtn = btn(['undo'], 'Geri al (Ctrl+Z)', () => undo());
    const fullBtn = btn(['fullscreen'], 'Tam pencere (F). Esc ile kapanır', () => setFull(!fullWin));
    const redoBtn = btn(['redo'], 'Yinele (Ctrl+Y)', () => redo());
    const head0 = TE().tempoList(tl.tempo)[tempoAtHead()];
    const bpmIn = numInput(head0.bpm, 1, 999, 0.1, (v) => {
      applyTempo(TE().setTempo(ensureTransport().tl.tempo, tempoAtHead(), { bpm: v }));
    }, 'tl-num-sm');
    const bpbIn = numInput(head0.beatsPerBar, 1, 16, 1, (v) => {
      applyTempo(TE().setTempo(ensureTransport().tl.tempo, tempoAtHead(), { beatsPerBar: v }));
    }, 'tl-num-xs');

    const bar = el('div', { class: 'tl-toolbar' }, [
      group([
        btn(['prev'], 'Önceki işaret', () => {
          const m = TL().markerBefore(ensureTransport().tl, transport.time);
          seek(m ? m.t : 0);
          applyClipsAt(transport.time);
          draw();
        }),
        btn(['stop'], 'Durdur ve başa dön', () => { stop(); draw(); refreshToolbar(); }),
        playBtn,
        btn(['next'], 'Sonraki işaret', () => {
          const m = TL().markerAfter(ensureTransport().tl, transport.time);
          if (m) seek(m.t);
          applyClipsAt(transport.time);
          draw();
        }),
      ]),
      el('div', { class: 'tl-clock', title: 'Süre · ölçü.vuruş' }, [timeLabel, barLabel]),
      linkBtn,
      /* Oynatma kafasındaki tempo. Önce hep ilk girişi düzenliyor ve bütün
         listeyi tek girişle değiştiriyordu: bir gösteri dosyasından gelen
         tempo değişimleri sessizce siliniyordu. Değişimler cetvelde (♩). */
      group([
        el('span', { class: 'tl-lbl', text: 'BPM', title: 'Oynatma kafasındaki tempo. Tempo değişimleri cetvelde (♩)' }),
        // Araç çubuğunda etiketler ayrı öğe: denetimlerin kendi adı (#777)
        (bpmIn.setAttribute('aria-label', 'Oynatma kafasındaki tempo (BPM)'), bpmIn),
        el('span', { class: 'tl-lbl', text: '/' }),
        (bpbIn.setAttribute('aria-label', 'Ölçüdeki vuruş sayısı'), bpbIn),
        btn(['plus', '♩'], 'Oynatma kafasına tempo değişimi', () => addTempoAtHead()),
      ]),
      group([
        el('span', { class: 'tl-lbl', icon: 'magnet', title: 'Yakalama. Sürüklerken Alt tuşu yakalamayı geçici olarak kapatır' }),
        (() => {
          const s = select(
            [['off', 'Kapalı'], ['bar', 'Ölçü'], ['beat', 'Vuruş'], ['half', 'Yarım Vuruş'], ['quarter', 'Çeyrek Vuruş'], ['frame', 'Kare']],
            cfg.snap,
            (v) => { cfg.snap = v; p.push(true); }
          );
          s.setAttribute('aria-label', 'Yakalama');
          return s;
        })(),
      ]),
      group([loopBtn, followBtn]),
      group([
        btn('−', 'Uzaklaştır (−)', () => zoomBy(1 / 1.25)),
        btn('+', 'Yakınlaştır (+)', () => zoomBy(1.25)),
        btn(['fit'], 'Hepsini sığdır (0)', () => fitAll()),
        btn(['lanes-less'], 'Şeritleri alçalt', () => laneBy(-8)),
        btn(['lanes-more'], 'Şeritleri yükselt (tam pencerede yer açar)', () => laneBy(8)),
        fullBtn,
      ]),
      group([undoBtn, redoBtn]),
    ]);

    toolbarRefs = { playBtn, loopBtn, followBtn, undoBtn, redoBtn, fullBtn, timeLabel, barLabel, bpmIn, bpbIn };
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
      showHeadTempo();
      const want = tr.playing ? 'pause' : 'play';
      if (playBtn._ico !== want) {
        playBtn._ico = want;
        if (window.SVIcons && playBtn.nodeType === 1) window.SVIcons.set(playBtn, want, '');
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
    on(r.fullBtn, fullWin);
    r.undoBtn.disabled = !history_().canUndo();
    r.redoBtn.disabled = !history_().canRedo();
    showHeadTempo();
  }

  /* Başlıktaki BPM kafadaki tempoyu gösteriyor: kafa bir tempo değişimini
     geçince değer de değişiyor. Kullanıcı alana yazarken dokunulmuyor. */
  function showHeadTempo() {
    const r = toolbarRefs;
    if (!r || !r.bpmIn) return;
    const e = TE().tempoList(ensureTransport().tl.tempo)[tempoAtHead()];
    const busy = (n) => typeof document !== 'undefined' && document.activeElement === n;
    const bpm = String(Math.round(e.bpm * 1000) / 1000);
    const bpb = String(e.beatsPerBar);
    if (!busy(r.bpmIn) && r.bpmIn.value !== bpm) r.bpmIn.value = bpm;
    if (!busy(r.bpbIn) && r.bpbIn.value !== bpb) r.bpbIn.value = bpb;
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
        const [ico, txt] = Array.isArray(text) ? text : ['', text];
        const b = el('button', { class: 'tl-tog ' + cls + (trk[key] ? ' on' : ''), type: 'button', icon: ico, text: txt, title, 'aria-pressed': trk[key] ? 'true' : 'false' });
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          trk[key] = !trk[key];
          commit();
          refreshHeads();
          draw();
        });
        return b;
      };
      const head = el('div', { class: 'tl-head' + (picked ? ' sel' : '') + (trk.kind === 'automation' ? ' auto' : ''),
        // Üst üste binen sahneler (#957): üstteki parça önde, alttakiler arkada çalışır
        title: trk.kind === 'clip' ? tt('Üstteki parça önde görünür; alttaki parçaların sahneleri arkasında çalışmaya devam eder. Susturulan parça atlanır, solo varsa yalnız solo parçalar.') : '' }, [
        color,
        name,
        tog('M', 'Sustur', 'muted', 'm'),
        tog('S', 'Solo: yalnız solo parçalar çalar', 'solo', 's'),
        tog(['lock'], 'Kilitle: taşınamaz, silinemez', 'locked', 'l'),
        trk.kind === 'automation' ? el('button', { class: 'tl-tog pick', type: 'button', icon: 'search', title: tt('Hedef seç') + ' — ' + tt(PRECEDENCE),
          onclick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); openTargetPicker(trk, r.left, r.bottom + 4); } }) : null,
        trk.kind === 'automation' ? el('button', { class: 'tl-tog rec' + (recording.has(trk.id) ? ' on' : '') + (isLearning(trk) ? ' learn' : ''), type: 'button', text: 'R', 'aria-pressed': recording.has(trk.id) || isLearning(trk) ? 'true' : 'false',
          title: trk.target ? tt('Kaydet: oynarken ayarın elle değişimini noktalara yazar') : tt('Öğren: basın, sonra uygulamada bir ayarı oynatın; o ayar hedef olur'),
          onclick: (e) => { e.stopPropagation(); toggleRecord(trk); refreshHeads(); draw(); } }) : null,
      ].filter(Boolean));
      head.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        selection = { kind: 'track', trackId: trk.id };
        const items = [];
        trackMenuItems(trk, (text, key, fn, off) => items.push([text, key, fn, off]));
        if (trk.kind === 'automation') items.unshift(['Hedef seç…', '', () => openTargetPicker(trk, e.clientX, e.clientY)], ['Hedefi Kaldır', '', () => clearTarget(trk), !trk.target]);
        else items.unshift(['Kafada klip ekle', '', () => { addClipAt(trk, snap(ensureTransport().time, false)); P().rerender(); }, trk.locked]);
        openMenu(items, e.clientX, e.clientY);
      });
      head.style.height = TRACK_H + 'px';
      // Başlığın boş yerine tıklamak parçayı seçiyor (denetçide parça ayarları)
      head.addEventListener('mousedown', (e) => {
        // Düğmenin içindeki simgeye (svg) basınca da düğme sayılır: yoksa başlık
        // yeniden kurulup düğme tıklamadan önce siliniyordu (#957, hedef seçici açılmıyordu)
        if (e.target && e.target.closest && e.target.closest('input, button, select')) return;
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

  /* Klip geçişinin seçenekleri Geçiş kartıyla AYNI listeden (SVTransition);
     ilk seçenek sahnenin varsayılanı. */
  const EASE_LABELS = { linear: 'Doğrusal', smooth: 'Yumuşak', easeIn: 'Yavaş Başla', easeOut: 'Yavaş Bitir', easeInOut: 'Yavaş Başla ve Bitir', snap: 'Ani' };
  function transTypePairs() {
    const T = window.SVTransition;
    const out = [['', 'Sahne varsayılanını kullan']];
    if (T && T.TRANSITIONS) T.TRANSITION_IDS.forEach((id) => out.push([id, (T.TRANSITIONS[id] && T.TRANSITIONS[id].label) || id]));
    return out;
  }
  function transEasePairs() {
    const T = window.SVTransition;
    const ids = (T && T.EASING_IDS) || Object.keys(EASE_LABELS);
    return [['', 'Sahne varsayılanını kullan']].concat(ids.map((id) => [id, EASE_LABELS[id] || id]));
  }
  /* Klibin etkin geçişi: sahnenin kaydındaki geçiş (yoksa genel ayar),
     üstüne klibin tür/süre/eğrisi. Kopya; hiçbir kayda yazılmıyor. */
  function clipTransSpec(c) {
    const cfg = P().cfg() || {};
    const sc = (Array.isArray(cfg.scenes) ? cfg.scenes : []).find((x) => x && x.id === c.ref);
    const base = Object.assign({}, (window.SV && window.SV.defaultConfig ? window.SV.defaultConfig().transition : {}),
      cfg.transition || {}, (sc && sc.data && sc.data.transition) || {});
    if (c.transType === 'cut') base.type = 'cut';
    else if (c.transType) base.type = c.transType;
    if (c.fade > 0) { base.duration = c.fade; base.unit = 'seconds'; }
    if (c.transEase) base.ease = c.transEase;
    return base;
  }
  function transLabel(c) {
    if (!c.transType) return '';
    const hit = transTypePairs().find((q) => q[0] === c.transType);
    return hit ? hit[1] : c.transType;
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
    // İşaret (#957): ad, zaman, sil
    const mk = selMarker();
    if (mk) {
      box.appendChild(el('div', { class: 'tl-insp-head', text: tt('İşaret') + ' · ' + fmtTime(mk.t) }));
      const mg = el('div', { class: 'tl-insp-grid' });
      box.appendChild(mg);
      const nm = el('input', { class: 'tl-marker-name', type: 'text', value: mk.name || '', 'aria-label': tt('İşaret Adı') });
      nm.addEventListener('change', () => { mk.name = nm.value.slice(0, 60); commit(); draw(); refreshMore(); });
      mg.appendChild(p.row('Ad', nm));
      mg.appendChild(p.row('Zaman (sn)', numInput(mk.t, 0, 1e6, 0.01, (v) => { mk.t = v; ensureTransport().tl.markers.sort((a, b) => a.t - b.t); commit(); draw(); })));
      const mb = (ico, txt, title, fn, cls) => { const b = el('button', { class: 'btn small' + (cls ? ' ' + cls : ''), type: 'button', icon: ico, text: txt, title }); b.addEventListener('click', fn); return b; };
      box.appendChild(el('div', { class: 'tl-actions' }, [
        mb('play', 'Git', 'Oynatma kafasını işarete al', () => { seek(mk.t); applyClipsAt(ensureTransport().time); draw(); }),
        mb('trash', 'Sil', 'İşareti sil (Del)', () => deleteSelection(), 'danger'),
      ]));
      return box;
    }
    // Tempo değişimi (#636): cetveldeki ♩ etiketi
    if (selection && selection.kind === 'tempo') {
      const list = TE().tempoList(ensureTransport().tl.tempo);
      const i = selection.index;
      const e = list[i];
      if (e && i > 0) {
        const tact = (text, title, fn, cls) => {
          const [ico, txt] = Array.isArray(text) ? text : ['', text];
          const b = el('button', { class: 'btn small' + (cls ? ' ' + cls : ''), type: 'button', icon: ico, text: txt, title });
          b.addEventListener('click', fn);
          return b;
        };
        box.appendChild(el('div', { class: 'tl-insp-head', text: '♩ ' + tt('Tempo değişimi') + ' · ' + fmtTime(e.t) }));
        const tg = el('div', { class: 'tl-insp-grid' });
        box.appendChild(tg);
        tg.appendChild(p.row('Zaman (sn)', numInput(e.t, 0, 1e6, 0.01, (v) => applyTempo(TE().moveTempoChange(list, i, v), i))));
        tg.appendChild(p.row('BPM', numInput(e.bpm, 1, 999, 0.1, (v) => applyTempo(TE().setTempo(list, i, { bpm: v }), i))));
        tg.appendChild(p.row('Ölçüdeki Vuruş', numInput(e.beatsPerBar, 1, 16, 1, (v) => applyTempo(TE().setTempo(list, i, { beatsPerBar: v }), i))));
        box.appendChild(el('div', { class: 'ctrl settings-io-note', text: 'Bu andan sonraki ölçüler bu tempoyla sayılır. Etiketi cetvelde sürükleyerek de taşıyabilirsiniz.' }));
        box.appendChild(el('div', { class: 'tl-actions' }, [
          tact(['play', 'Git'], 'Oynatma kafasını buraya al', () => { seek(e.t); applyClipsAt(ensureTransport().time); draw(); }),
          tact(['trash', 'Sil'], 'Tempo değişimini sil (Del)', () => { deleteSelection(); }, 'danger'),
        ]));
        return box;
      }
      selection = null;
    }
    const trk = selTrack();
    if (!selection || !trk) {
      box.appendChild(el('div', { class: 'ctrl settings-io-note', text: 'Bir klip, anahtar kare ya da parça seçin. Kısayollar için düzenleyiciye tıklayın.' }));
      box.appendChild(shortcutHelp());
      return box;
    }
    const grid = el('div', { class: 'tl-insp-grid' });
    box.appendChild(grid);
    const act = (text, title, fn, cls) => {
      const [ico, txt] = Array.isArray(text) ? text : ['', text];
      const b = el('button', { class: 'btn small' + (cls ? ' ' + cls : ''), type: 'button', icon: ico, text: txt, title });
      b.addEventListener('click', fn);
      return b;
    };

    /* Çoklu seçim: sayı, ortak eylemler ve hepsine birden renk/geçiş.
       Tek tek alanlar (ad, kaynak, başlangıç) grupta anlamsız. */
    if (multi.length > 1) {
      const picked = pickedClips();
      box.insertBefore(el('div', { class: 'tl-insp-head', text: picked.length + ' ' + tt('klip seçili') }), grid);
      const col = el('input', { class: 'tl-swatch big', type: 'color', value: TE().clipColor(picked[0].clip, picked[0].trk) });
      col.addEventListener('change', () => { picked.forEach((q) => { if (!q.trk.locked) q.clip.color = col.value; }); commit(); draw(); });
      grid.appendChild(p.row('Renk (hepsi)', col));
      grid.appendChild(p.row('Geçiş (sn, hepsi)', numInput(picked[0].clip.fade, 0, 30, 0.05, (v) => { picked.forEach((q) => { if (!q.trk.locked) q.clip.fade = Math.min(v, q.clip.dur); }); commit(); draw(); })));
      box.appendChild(el('div', { class: 'tl-actions' }, [
        act(['copy', 'Çoğalt'], 'Grubu hemen ardına çoğalt (Ctrl+D)', () => { if (duplicateSelection()) refreshAll(); }),
        act(['copy', 'Kopyala'], 'Grubu panoya al (Ctrl+C); Ctrl+V kafaya yapıştırır', () => copySelection()),
        act(['x', 'Seçimi Bırak'], 'Tek seçime dön', () => { multi = []; refreshAll(); }),
        act(['trash', 'Sil'], 'Seçili klipleri sil (Del)', () => { if (deleteSelection()) refreshAll(); }, 'danger'),
      ]));
      return box;
    }

    if (selection.kind === 'clip') {
      const c = selClip();
      if (!c) return box;
      box.insertBefore(el('div', { class: 'tl-insp-head', icon: TYPE_ICONS[c.type], text: clipLabel(c) }), grid);
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
      const dp = window.SVClipDeckPanel;
      const media = c.type === 'video' || c.type === 'image' || c.type === 'shader';
      if (media && dp && dp.mediaPicker && dp.targetOptions) {
        /* Medya klibi destenin yuvasıyla AYNI seçiciyi ve hedef listesini
           kullanıyor: iki kopya zamanla ayrışırdı. */
        const tNow = dp.resolveTarget(c.type, c.target);
        const save = (patch) => { Object.assign(c, patch); commit(); refreshInspector(); draw(); };
        grid.appendChild(p.row('Kaynak', dp.mediaPicker(c, tNow, save)));
        const tOpts = dp.targetOptions(c.type);
        if (tOpts.length) grid.appendChild(p.row('Hedef', select(tOpts, tNow, (v) => save({ target: v }))));
      } else {
        grid.appendChild(p.row('Kaynak', refPicker(c.type, c.ref, (v) => { c.ref = v; commit(); refreshInspector(); draw(); })));
      }
      grid.appendChild(p.row('Başlangıç (sn)', numInput(c.start, 0, 1e6, 0.01, (v) => { c.start = v; TE().sortClips(trk); commit(); draw(); })));
      grid.appendChild(p.row('Süre (sn)', numInput(c.dur, 0.05, 1e6, 0.01, (v) => { c.dur = v; commit(); draw(); })));
      // 0 = Geçiş kartındaki genel ayar; klibin sol üst köşesinden de sürüklenir
      grid.appendChild(p.row('Geçiş (sn, 0 = genel)', numInput(c.fade, 0, 30, 0.05, (v) => { c.fade = v; commit(); draw(); })));
      if (c.type === 'scene') {
        // Klibin kendi geçişi: yalnız bu klipte, sahnenin geçişi değişmiyor
        grid.appendChild(p.row('Geçiş Türü', select(transTypePairs(), c.transType || '', (v) => { c.transType = v; commit(); draw(); })));
        grid.appendChild(p.row('Geçiş Eğrisi', select(transEasePairs(), c.transEase || '', (v) => { c.transEase = v; commit(); draw(); })));
        // Klibin geçişini paneldeki küçük önizlemede göster (çıkışa gitmez)
        if (window.SVTransitionPreview) grid.appendChild(p.row('Önizleme', window.SVTransitionPreview.create(() => clipTransSpec(c))));
      }
      const reapply = () => { commit(); applyClipsAt(ensureTransport().time); draw(); };
      grid.appendChild(p.row('Opaklık (0..1)', numInput(c.opacity == null ? 1 : c.opacity, 0, 1, 0.01, (v) => { c.opacity = v; reapply(); })));
      grid.appendChild(p.row('Giriş Solması (sn)', numInput(c.fadeIn || 0, 0, 1e4, 0.05, (v) => { c.fadeIn = v; reapply(); })));
      grid.appendChild(p.row('Çıkış Solması (sn)', numInput(c.fadeOut || 0, 0, 1e4, 0.05, (v) => { c.fadeOut = v; reapply(); })));
      grid.appendChild(p.row('Kırpma Başı (sn)', numInput(c.inPoint, 0, 1e6, 0.01, (v) => { c.inPoint = v; commit(); })));
      grid.appendChild(p.row('Hız', numInput(c.speed, 0.05, 20, 0.01, (v) => { c.speed = v; commit(); })));
      const col = el('input', { class: 'tl-swatch big', type: 'color', value: TE().clipColor(c, trk) });
      col.addEventListener('change', () => { c.color = col.value; commit(); draw(); });
      const colReset = act(['reset'], 'Rengi parçadan / türden al', () => { c.color = ''; commit(); refreshInspector(); draw(); });
      grid.appendChild(p.row('Renk', el('div', { class: 'tl-inline' }, [col, colReset])));
      if (media && dp && dp.targetOptions && !dp.targetOptions(c.type).length) {
        box.appendChild(el('div', {
          class: 'ctrl settings-io-note warn',
          text: c.type === 'image'
            ? 'Görsel klibi bir görsel nesnenin resmini değiştirir; henüz nesne yok. Sahne sayfasında Katman Ekle menüsünden Görsel Nesneler ekleyin.'
            : 'Bu tür için uygun hedef yok.',
        }));
      } else if (c.type === 'action') {
        box.appendChild(el('div', { class: 'ctrl settings-io-note', text: 'Eylem, MIDI ve OSC eşlemelerindeki eylemin aynısını çalıştırır. Geçiş ayarları eylemde kullanılmaz.' }));
      }
      box.appendChild(el('div', { class: 'tl-actions' }, [
        act(['scissors', 'Böl'], 'Oynatma kafasında böl (S)', () => { if (!splitAtPlayhead()) p.toast('Oynatma kafası bu klibin içinde değil.', 'warn'); else refreshAll(); }),
        act(['copy', 'Çoğalt'], 'Hemen ardına bir kopya (Ctrl+D)', () => { if (duplicateSelection()) refreshAll(); }),
        act(['copy', 'Kopyala'], 'Panoya (Ctrl+C); Ctrl+V kafaya yapıştırır', () => { copySelection(); p.toast('Klip kopyalandı. Ctrl+V oynatma kafasına yapıştırır.', 'ok'); }),
        act(['trash', 'Sil'], 'Sil (Del)', () => { if (deleteSelection()) refreshAll(); }, 'danger'),
      ]));
      return box;
    }

    if (selection.kind === 'key' && trk.keys) {
      const k = trk.keys[selection.keyIndex];
      if (!k) return box;
      box.insertBefore(el('div', { class: 'tl-insp-head', icon: 'wave', text: trk.name + ' · ' + tt('anahtar') + ' ' + (selection.keyIndex + 1) }), grid);
      grid.appendChild(p.row('Zaman (sn)', numInput(k.t, 0, 1e6, 0.01, (v) => {
        k.t = v;
        trk.keys.sort((a, b) => a.t - b.t);
        selection.keyIndex = trk.keys.indexOf(k);
        commit();
        draw();
      })));
      grid.appendChild(p.row('Değer (0..1)', numInput(k.v, 0, 1, 0.001, (v) => { k.v = v; commit(); draw(); })));
      const curves = keyCurves();
      grid.appendChild(p.row('Segment Eğrisi', select(curves.map((cv) => [cv, curveLabel(cv)]), k.curve, (v) => { k.curve = v; commit(); draw(); })));
      box.appendChild(el('div', { class: 'tl-actions' }, [
        act(['trash', 'Anahtarı Sil'], 'Sil (Del)', () => { if (deleteSelection()) refreshAll(); }, 'danger'),
      ]));
      return box;
    }

    // Parça
    box.insertBefore(el('div', { class: 'tl-insp-head', icon: trk.kind === 'clip' ? 'clapper' : 'wave', text: trk.name }), grid);
    grid.appendChild(p.row('Parçanın Adı', textInput(trk.name, (v) => { trk.name = v || trk.name; commit(); refreshHeads(); })));
    if (trk.kind === 'automation') {
      // Hedef: aranabilir seçici; elle yol yazmak "Gelişmiş" altında
      const meta = targetMeta(trk);
      const pick = el('button', { class: 'btn small tl-target-pick', type: 'button', icon: 'search',
        text: trk.target ? (meta.missing ? '! ' + trk.target : meta.group + ' · ' + meta.label) : tt('Hedef seç…'),
        title: tt('Otomasyonun süreceği ayarı ara ve seç') });
      pick.addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); openTargetPicker(trk, r.left, r.bottom + 4); });
      // Hedef çipinde × ile kaldırma (#957)
      const clr = trk.target ? el('button', { class: 'icon-btn small tl-target-x', type: 'button', icon: 'x', title: tt('Hedefi Kaldır'), 'aria-label': tt('Hedefi Kaldır'),
        onclick: () => clearTarget(trk) }) : null;
      grid.appendChild(p.row('Hedef Ayar', clr ? el('div', { class: 'tl-inline' }, [pick, clr]) : pick));
      const target = el('input', { class: 'txt', type: 'text', value: trk.target, placeholder: 'ör. postfx.0.params.strength' });
      target.addEventListener('change', () => { setTarget(trk, target.value.trim()); refreshInspector(); draw(); });
      grid.appendChild(p.row('Yol (gelişmiş)', target));
      grid.appendChild(p.row('En Az', numInput(trk.min, -1e6, 1e6, 0.01, (v) => { trk.min = v; commit(); })));
      grid.appendChild(p.row('En Çok', numInput(trk.max, -1e6, 1e6, 0.01, (v) => { trk.max = v; commit(); })));
      box.appendChild(el('div', { class: 'ctrl settings-io-note', text: PRECEDENCE }));
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
    // Uçtaki parçanın o yöndeki düğmesi kapalı: eskiden basınca bir şey olmuyordu
    const edge = (b, d) => {
      const n = ensureTransport().tl.tracks.length;
      if (i + d < 0 || i + d >= n) { b.disabled = true; b.title = d < 0 ? 'Zaten en üstte' : 'Zaten en altta'; }
      return b;
    };
    box.appendChild(el('div', { class: 'tl-actions' }, [
      edge(act(['arrow-up', 'Yukarı'], 'Parçayı yukarı taşı', () => move(-1)), -1),
      edge(act(['arrow-down', 'Aşağı'], 'Parçayı aşağı taşı', () => move(1)), 1),
      trk.kind === 'clip' ? act(['plus', 'Kafada Klip'], 'Bu parçaya, oynatma kafasına', () => {
        if (trk.locked) { p.toast('Parça kilitli.', 'warn'); return; }
        addClipAt(trk, snap(ensureTransport().time, false));
        p.rerender();
      }) : null,
      act(['trash', 'Parçayı Sil'], 'Parça ve içindeki her şey', async () => {
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

  // Nokta eğrileri: modülasyonun eğrileri + 'Tut' (anlık sıçrama, #957)
  function keyCurves() {
    return ((window.SVModulation && window.SVModulation.CURVE_IDS) || ['linear']).concat(['hold']);
  }
  function curveLabel(id) {
    const map = {
      linear: 'Doğrusal', exp: 'Üstel', exp3: 'Üstel (küp)', log: 'Logaritmik',
      scurve: 'S Eğrisi', ease: 'Yumuşak', abs: 'Mutlak', hold: 'Tut (anlık)',
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
    // Eylemler destenin listesinden (MIDI/OSC eylemleri, deste eylemleri hariç)
    if (type === 'action') {
      const dp = window.SVClipDeckPanel;
      return dp && dp.refOptions ? dp.refOptions('action') : [];
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
      const del = el('button', { class: 'btn small danger', type: 'button', icon: 'x', title: 'İşareti sil' });
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
        p.toast('Önce bir Metin katmanında kaynağı Şarkı Sözü yapıp LRC ya da SRT dosyası yükleyin.', 'warn');
        return;
      }
      tl.markers = TL().markersFromCues(cues);
      commit();
      p.rerender();
      p.toast(tl.markers.length + ' işaret üretildi.', 'ok');
    });
    /* YouTube bölüm listesi (#837): işaretçiler "0:00 Başlangıç" satırları
       olarak panoya. Süre zaman çizelgesinin uzunluğu; YouTube'un kuralı
       tutmuyorsa liste yine kopyalanıyor, uyarı nedenini söylüyor. */
    const ytChapters = el('button', { class: 'btn small', type: 'button', text: 'YouTube Bölümlerini Kopyala',
      title: 'İşaretçileri video açıklamasına yapıştırılacak bölüm listesi olarak kopyalar' });
    ytChapters.addEventListener('click', () => {
      const FX = window.SVExportFormats;
      if (!FX || !tl.markers.length) {
        p.toast('Önce zaman çizelgesine işaret ekleyin.', 'warn');
        return;
      }
      // Satırlar videonun diliyle değil arayüzün diliyle; 'Bölüm' sözlükte başka anlamda kayıtlı
      const en = window.SVI18n && window.SVI18n.locale === 'en';
      const r = FX.youtubeChapters(tl.markers, TL().timelineLength(tl),
        en ? { first: 'Start', chapter: 'Chapter' } : { first: 'Başlangıç', chapter: 'Bölüm' });
      const ok = window.api && typeof window.api.copyToClipboard === 'function' && window.api.copyToClipboard(r.text);
      if (!ok) {
        p.toast('Pano kullanılamadı.', 'warn');
        return;
      }
      if (r.problems.indexOf('FEW') >= 0) p.toast('Kopyalandı; YouTube en az üç bölüm istiyor.', 'warn');
      else if (r.problems.indexOf('SHORT') >= 0) p.toast('Kopyalandı; YouTube her bölümün en az 10 saniye sürmesini istiyor.', 'warn');
      else p.toast(r.rows.length + ' bölüm kopyalandı.', 'ok');
    });
    marks.appendChild(el('div', { class: 'tl-actions' }, [fromLyrics, ytChapters]));
    box.appendChild(marks);
    return box;
  }

  // Tema değişince tuval yeni renklerle (#770)
  if (window.SVUiTheme) window.SVUiTheme.onChange(() => draw());
})();
