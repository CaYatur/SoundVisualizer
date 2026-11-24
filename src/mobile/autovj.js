/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TELEFONDA OTOMATİK VJ VE TEMPO (docs/android/PLAN.md Faz 3.5).

   Masaüstünde Otomatik VJ panelin döngüsünde çalışıyor (src/admin/autovj.js); telefonda
   panel yok, ayarın `autovj.enabled`'ı tek başına hiçbir şeyi değiştirmiyordu. Burada
   aynı iş, aynı parçalarla:
   - Kurallar ortak modülden (src/shared/autovj.js: plan, normalize, katman seçimi).
   - Tempo ortak motordan (src/shared/tempo.js), motorun KENDİ ses nesnesiyle beslenir:
     sayfanın betikleri `new SVAudio()` ile tek bir ses motoru kuruyor; kurulduğu an
     yakalanıyor (motor dosyalarına dokunmadan; onlar mod küçük resimlerinin anahtarına
     giriyor).
   - Değişim ayarın KOPYASINA uygulanıp `config.set` ile gönderilir (motor ile arayüz aynı
     sayfada, asıl nesne yerinde değiştirilmez). Sahne değişimi kabuğun sahne çağırma
     yoluyla (SVShell.recallScene).

   Masaüstünün yedeklilik (izleme, ızgara), OSC/MQTT tempo yayını ve durum satırı burada yok. */
(function () {
  if (typeof window === 'undefined') return;
  const env = window.__SV_ANDROID || {};
  if (String(env.page || '').indexOf('src/visualizer/') !== 0) return;

  // ---- Motorun ses nesnesi: SVAudio kurulduğu an ----
  let engineAudio = null;
  try {
    let Real;
    Object.defineProperty(window, 'SVAudio', {
      configurable: true,
      enumerable: true,
      get() { return Real; },
      set(C) {
        Real = typeof C === 'function'
          // Yalnız ilk kurulan: motorun kendisi. Sonrakiler (telefonda çizilen önizlemeler,
          // src/mobile/preview-live.js) motorun ses nesnesinin yerine geçmesin.
          ? new Proxy(C, { construct(t, args, nt) { const o = Reflect.construct(t, args, nt); if (!engineAudio) engineAudio = o; return o; } })
          : C;
      },
    });
  } catch (e) { /* tanımlanamadıysa tempo ve Otomatik VJ çalışmaz; motor etkilenmez */ }

  const R = () => window.SVAutoVJRules;
  const A = () => window.SVAndroid;
  const T = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);

  let tempo = null;
  let lastSwitch = 0;
  let barsSince = 0;
  let lastT = 0;
  let rules = null;
  let lastResult = null;
  let lastFailure = null;
  let switchCount = 0;
  const beatListeners = [];

  function ctxOf(cfg) {
    const a = R().normalize(cfg.autovj);
    return {
      scenes: cfg.scenes || [],
      builtinPalettes: (window.SV && window.SV.GRADIENT_PRESETS) || [],
      userPalettes: cfg.userPresets || [],
      paletteSource: a.paletteSource,
      studioPresets: window.SVPresets && window.SVPresets.all ? window.SVPresets.all() : [],
    };
  }

  // ---- Değişimi uygula (src/admin/autovj.js'teki karşılıkları) ----
  function applyVisualizer(cfg, items, targets) {
    const layers = R().visualizerLayers(cfg.layers);
    if (layers.length) {
      const hit = targets === 'first' ? layers.slice(0, 1) : layers;
      hit.forEach((l, i) => { l.type = items[i % items.length].id; });
      return true;
    }
    if ((cfg.layers || []).some((l) => l && l.kind === 'visualizer' && l.locked)) return false;
    if (cfg.visualizer) { cfg.visualizer.type = items[0].id; return true; }
    return false;
  }
  function applyBackground(cfg, item) {
    if (!item || !item.id) return false;
    const preset = item.presetId || null;
    const type = preset ? 'custom' : item.id;
    const layers = R().backgroundLayers(cfg.layers);
    if (layers.length) {
      layers.forEach((l) => { l.type = type; l.presetId = preset; });
      return true;
    }
    if ((cfg.layers || []).some((l) => l && l.kind === 'background' && (l.locked || R().isTransparentBackground(l)))) return false;
    if (!cfg.background || cfg.background.transparent || cfg.background.type === 'transparent') return false;
    cfg.background.type = type;
    if (preset) cfg.custom = Object.assign({}, cfg.custom, { backgroundId: preset });
    return true;
  }
  function applyPalette(cfg, item) {
    const colors = (item && item.colors) || null;
    if (!colors || !colors.length) return false;
    let touched = false;
    if (cfg.background && cfg.background.gradient) {
      cfg.background.gradient.colors = colors.slice();
      touched = true;
    }
    if (cfg.visualizer) {
      cfg.visualizer.color = colors[0];
      if (colors.length > 1) cfg.visualizer.color2 = colors[colors.length - 1];
      const L = window.SVLayers;
      if (L && L.setEffective) {
        L.setEffective(cfg, 'visualizer.color', cfg.visualizer.color);
        L.setEffective(cfg, 'visualizer.color2', cfg.visualizer.color2);
      }
      touched = true;
    }
    return touched;
  }

  const KIND_LABELS = { scenes: 'Sahne', visualizers: 'Görselleştirici', palettes: 'Renk Şablonu', backgrounds: 'Arkaplan', custom: 'Özel' };
  function stepLabel(step) {
    const MC = window.SVModeCatalog;
    if (step.kind === 'visualizers') return step.items.map((x) => T(MC ? MC.label('visualizer', x.id) : x.id)).join(' + ');
    return T((step.item && (step.item.label || step.item.name)) || '');
  }

  /* Bir değişim. Dönüş: { ok, kind, label } ya da { ok:false, code, kind } */
  function applySwitch() {
    const S = A();
    // Hedef PC iken değişimi PC'nin kendi Otomatik VJ'si yapar; telefon PC'nin ayarına yazmaz
    if (S && S.target && S.target.get().target === 'pc') return { ok: false, code: 'PC' };
    const cfg0 = S && S.config.get();
    if (!cfg0 || !R()) return { ok: false, code: 'NOCFG' };
    const a = R().normalize(cfg0.autovj);
    const layerCount = a.visualizerTargets === 'first' ? 1 : Math.max(1, R().visualizerLayers(cfg0.layers).length);
    const res = R().plan(cfg0.autovj, ctxOf(cfg0), rules, layerCount);
    if (!res.ok) {
      lastFailure = { code: res.code, kind: res.kind };
      lastResult = null;
      return res;
    }
    rules = res.state;
    const steps = res.steps || [res];
    let next = null;
    const hit = [];
    for (const step of steps) {
      if (step.kind === 'scenes') {
        // Sahne bütün sahne anahtarlarını değiştirir: bekleyen kopya önce yazılır
        if (next) { S.config.set(next); next = null; }
        if (window.SVShell && window.SVShell.recallScene && window.SVShell.recallScene(step.item.id)) hit.push(step);
        continue;
      }
      if (!next) next = JSON.parse(JSON.stringify(S.config.get()));
      const ok = step.kind === 'visualizers' ? applyVisualizer(next, step.items, a.visualizerTargets)
        : step.kind === 'palettes' ? applyPalette(next, step.item)
          : step.kind === 'backgrounds' ? applyBackground(next, step.item) : false;
      if (ok) hit.push(step);
    }
    if (next && hit.some((s) => s.kind !== 'scenes')) S.config.set(next);
    if (!hit.length) {
      lastFailure = { code: 'EMPTY', kind: res.kind };
      lastResult = null;
      return { ok: false, code: 'EMPTY', kind: res.kind };
    }
    lastFailure = null;
    switchCount++;
    lastResult = { kind: res.steps ? 'custom' : res.kind, label: hit.map(stepLabel).join(' · ') };
    return { ok: true, kind: lastResult.kind, label: lastResult.label };
  }

  // ---- Döngü ----
  function loop() {
    requestAnimationFrame(loop);
    const S = A();
    if (!engineAudio || !S || !window.SVTempo || !R()) return;
    const cfg = S.config.get();
    if (!cfg) return;
    const now = performance.now() / 1000;
    const dt = lastT ? Math.min(0.1, Math.max(0.001, now - lastT)) : 1 / 60;
    lastT = now;
    if (!tempo) { tempo = new window.SVTempo.Tempo(); lastSwitch = now; }
    const a = R().normalize(cfg.autovj);
    tempo.beatsPerBar = a.beatsPerBar;
    if (a.bpmLock > 0) tempo.setLock(a.bpmLock);
    else if (tempo.locked) tempo.setLock(0);
    const fired = tempo.update(engineAudio, now, dt);
    if (fired) {
      if (tempo.barPosition === 0) barsSince++;
      for (const cb of beatListeners) { try { cb(tempo); } catch (e) { console.error('[autovj]', e); } }
    }
    // Kapalıyken sayaç birikmez: açılınca ilk değişim bir aralık sonra
    if (!a.enabled) { lastSwitch = now; barsSince = 0; return; }
    let due;
    if (a.unit === 'seconds') due = now - lastSwitch >= a.interval;
    else {
      due = barsSince >= a.interval;
      // Tempo bulunamıyorsa ölçü sayılamaz; zamana düşülür
      if (!tempo.bpm && now - lastSwitch > Math.max(4, a.interval * 2)) due = true;
    }
    if (!due) return;
    // Ölçü kipinde geçiş vuruşa hizalanır
    if (a.unit === 'bars' && tempo.bpm && !tempo.justFired()) return;
    lastSwitch = now;
    barsSince = 0;
    applySwitch();
  }
  requestAnimationFrame(loop);

  window.SVMobileVJ = Object.freeze({
    /** Tempo: { bpm, confidence, energy, phase, locked } (motor hazır değilse bpm 0). */
    tempo: () => (tempo ? { bpm: tempo.bpm || 0, confidence: tempo.confidence || 0, energy: tempo.energy || 0, phase: tempo.phase || 0, locked: tempo.locked || 0 } : { bpm: 0, confidence: 0, energy: 0, phase: 0, locked: 0 }),
    tap() { if (tempo) tempo.tap(performance.now() / 1000); },
    onBeat(cb) { if (typeof cb === 'function') beatListeners.push(cb); },
    /** Şimdi değiştir (düğme). Zamanlayıcı baştan. */
    switchNow() { lastSwitch = performance.now() / 1000; barsSince = 0; return applySwitch(); },
    restart() { lastSwitch = performance.now() / 1000; barsSince = 0; },
    status: () => ({ lastResult, lastFailure, switchCount }),
    /** Motorun ses nesnesi (seviye çubukları için getBars). */
    audio: () => engineAudio,
  });
})();
