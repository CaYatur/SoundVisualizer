/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* DİNAMİK RENK TEMASI (masaüstündeki src/admin/admin.js applyResolvedTheme ve
   handleDynamicThemeTrackUpdate'in telefondaki karşılığı). Varsayılan kapalı.

   Parça değişince renkler ortak src/shared/adaptive-theme.js ile çözülür: albüm kapağından,
   rastgele armoniden, parça adından ya da hazır şablonlardan. Sahne ayarları → Renk Teması'ndan
   açılır. Kapak henüz gelmediyse 2,5 sn beklenir; bu sürede önceki renkler korunur. */
(function () {
  const clone = (v) => JSON.parse(JSON.stringify(v));

  /* Çözülen renklerin ayara yazılacak hâli. Saf işlev: android/js-tests/dynamic-theme.test.js
     masaüstündeki kurallarla sınıyor. Sabit renk ya da gökkuşağı seçili öğelere dokunmaz. */
  function patchFor(cfg, res, dt, setEffective) {
    if (!res || !Array.isArray(res.colors) || !res.colors.length) return null;
    const opt = dt || {};
    const colors = res.colors.slice(0, 5);
    const color = res.color || res.colors[2] || '#3aa6ff';
    const color2 = res.color2 || res.colors[4] || '#d24bff';
    const stack = !!(cfg.layerStack && cfg.layerStack.enabled && Array.isArray(cfg.layers));
    const next = {};
    if (stack) next.layers = clone(cfg.layers);
    if (opt.applyToBackground !== false && cfg.background && cfg.background.gradient) {
      next.background = clone(cfg.background);
      next.background.gradient.colors = colors.slice();
      if (stack) {
        for (const ly of next.layers) {
          if (!ly || ly.kind !== 'background') continue;
          ly.settings = ly.settings || {};
          const bg = ly.settings.background = ly.settings.background || {};
          if ((bg.colorMode || cfg.background.colorMode || 'theme') !== 'theme') continue;
          bg.colorMode = 'theme';
          bg.gradient = Object.assign({}, bg.gradient, { colors: colors.slice() });
        }
      }
    }
    if (opt.applyToVisualizer !== false && cfg.visualizer) {
      next.visualizer = clone(cfg.visualizer);
      const root = next.visualizer.colorMode || (next.visualizer.rainbow ? 'rainbow' : 'custom');
      if (root === 'theme') { next.visualizer.color = color; next.visualizer.color2 = color2; }
      if (stack) {
        for (const ly of next.layers) {
          if (!ly || ly.kind !== 'visualizer') continue;
          ly.settings = ly.settings || {};
          const vs = ly.settings.visualizer = ly.settings.visualizer || {};
          const mode = vs.colorMode || (vs.rainbow !== undefined ? (vs.rainbow ? 'rainbow' : 'custom') : (cfg.visualizer.colorMode || 'theme'));
          if (mode !== 'theme') continue;
          vs.color = color;
          vs.color2 = color2;
        }
        if (setEffective) setEffective(Object.assign({}, cfg, next), color, color2);
      }
    }
    if (res.nextCycleIdx !== undefined) next.dynamicTheme = Object.assign({}, cfg.dynamicTheme, { _cycleIdx: res.nextCycleIdx });
    return next;
  }

  /* Kapak okunamazsa ortak kod sessizce sabit bir palet döndürüyor: o uygulanmaz. */
  function isFallback(AT, res) {
    return !!(res && res.modeUsed === 'artwork' && AT.fallbackPalette
      && JSON.stringify(res.colors) === JSON.stringify(AT.fallbackPalette().colors));
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { patchFor, isFallback };
  if (typeof window === 'undefined' || !window.SVShell || !window.SVShellUI) return;

  const S = window.SVShell;
  const U = window.SVShellUI;
  const { h, icon, A } = S;
  const cfg = () => A().config.get() || {};
  const dtCfg = () => Object.assign({ enabled: false, mode: 'artworkOrRandom', applyToBackground: true, applyToVisualizer: true }, cfg().dynamicTheme);
  const AT = () => window.SV && window.SV.AdaptiveTheme;

  function apply(res) {
    const c = cfg();
    const setEffective = (draft, color, color2) => {
      const L = window.SVLayers;
      if (!L || !L.setEffective || !L.firstLayerIndex) return;
      const i = L.firstLayerIndex(draft, 'visualizer');
      const vs = i >= 0 && draft.layers[i] && draft.layers[i].settings && draft.layers[i].settings.visualizer;
      const mode = (vs && (vs.colorMode || (vs.rainbow !== undefined ? (vs.rainbow ? 'rainbow' : 'custom') : null))) || (draft.visualizer && draft.visualizer.colorMode) || 'theme';
      if (mode !== 'theme') return;
      L.setEffective(draft, 'visualizer.color', color);
      L.setEffective(draft, 'visualizer.color2', color2);
    };
    const patch = patchFor(c, res, dtCfg(), setEffective);
    if (patch) A().config.patch(patch);
    return !!patch;
  }
  function resolve(st, onDone) {
    const T = AT();
    if (!T) { if (onDone) onDone(false); return; }
    const presets = ((window.SV && window.SV.GRADIENT_PRESETS) || []).concat(cfg().userPresets || []);
    T.resolveDynamicTheme(st, dtCfg(), presets, (res) => {
      const ok = !!(res && res.colors) && !isFallback(T, res) && apply(res);
      if (onDone) onDone(ok);
    });
  }

  // ---- Parça izleme ----
  let lastTrack = '';
  let lastArt = '';
  let waitTimer = 0;
  function artKey(a) { return a.length > 256 ? a.length + ':' + a.slice(0, 40) + ':' + a.slice(-120) : a; }
  function onTrack(st) {
    const dt = dtCfg();
    if (!dt.enabled || !st || !st.has) return;
    const title = String(st.title || '').trim();
    // Parça geçişinde başlık bir an boş gelebilir: önceki renkler korunur
    if (!title) return;
    const track = title + '|' + String(st.artist || '').trim() + '|' + String(st.album || '').trim();
    const hasArt = typeof st.artwork === 'string' && st.artwork.length > 20;
    const art = hasArt ? artKey(st.artwork) : '';
    const usesArt = dt.mode === 'artwork' || dt.mode === 'artworkOrRandom';
    const changed = track !== lastTrack;
    if (!changed && !(hasArt && art !== lastArt)) return;
    if (changed) {
      lastTrack = track;
      lastArt = '';
      clearTimeout(waitTimer);
      if (usesArt && !hasArt) {
        waitTimer = setTimeout(() => { if (lastTrack === track && dtCfg().mode === 'artworkOrRandom') resolve(st); }, 2500);
        return;
      }
    } else if (!usesArt) return;
    clearTimeout(waitTimer);
    lastArt = art;
    resolve(st);
  }

  // ---- Sahne ayarları → Renk Teması ----
  const MODES = [
    ['artworkOrRandom', 'Albüm Kapağı (Yoksa Rastgele)'],
    ['artwork', 'Yalnızca Albüm Kapağı'],
    ['random', 'Rastgele Renk Teması (Stüdyo Üreticisi)'],
    ['energyMood', 'Parça Adı & Ruh Hali Analizi'],
    ['presetCycle', 'Hazır Şablon Döngüsü'],
    ['presetRandom', 'Hazır Şablon Rastgele'],
  ];
  const DESCS = {
    artworkOrRandom: 'Çalan şarkının albüm kapağı varsa renklerini çıkarıp miksler; kapak yoksa stüdyo armonisiyle rastgele bir renk teması üretir.',
    artwork: 'Yalnızca çalan şarkının albüm kapağındaki renkleri çıkarır ve miksler. Kapak yoksa mevcut renkleri korur.',
    random: 'Her şarkı değişiminde stüdyo renk teorisi ve armonik yayılımla (analogous, cyberpunk, sunset vb.) sıfırdan yepyeni 5 renkli bir palet üretir.',
    energyMood: 'Şarkı ve sanatçı adındaki anahtar kelimeleri ve duyguyu analiz ederek parçanın hissine özel renk paleti kurar.',
    presetCycle: 'Her yeni şarkıda uygulamadaki yerleşik hazır renk şablonlarını sırayla uygular.',
    presetRandom: 'Her yeni şarkıda yerleşik hazır renk şablonlarından rastgele birini seçip uygular.',
  };
  function panel(ctx) {
    const dt = dtCfg();
    const put = (o) => A().config.patch({ dynamicTheme: Object.assign(dtCfg(), o) });
    const kids = [U.toggle({
      label: 'Dinamik Renk Temasını Etkinleştir', value: !!dt.enabled,
      onChange: (v) => {
        put({ enabled: !!v });
        clearTimeout(waitTimer);
        lastTrack = '';
        lastArt = '';
        if (v) onTrack(A().nowPlaying.current());
        ctx.refresh();
      },
    })];
    if (dt.enabled) {
      const live = A().nowPlaying.current();
      kids.push(h('div', { class: 'hint', 'data-user-text': '', text: live && live.has ? [live.title, live.artist].filter(Boolean).join(' — ') : 'Müzik çaldığında renkler otomatik güncellenir.' }));
      kids.push(U.select({ label: 'Çalışma Modu', options: MODES, value: dt.mode, onChange: (v) => { put({ mode: v }); ctx.refresh(); } }));
      kids.push(h('div', { class: 'hint', text: DESCS[dt.mode] || '' }));
      kids.push(U.toggle({ label: 'Arkaplan 5 Noktalı Gradyan Paletine Uygula', value: dt.applyToBackground !== false, onChange: (v) => put({ applyToBackground: !!v }) }));
      kids.push(U.toggle({ label: 'Görselleştirici Ana ve İkincil Renklerine Uygula', value: dt.applyToVisualizer !== false, onChange: (v) => put({ applyToVisualizer: !!v }) }));
      kids.push(h('button', { class: 'btn block', onclick: () => resolve(A().nowPlaying.current(), () => ctx.refresh()) }, [icon('sparkles'), 'Şimdi Uygula']));
    }
    return U.card(kids);
  }

  function start() {
    if (!A() || !A().nowPlaying) return;
    A().nowPlaying.onChange(onTrack);
    A().config.ready().then(() => onTrack(A().nowPlaying.current()));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.SVShellDynamicTheme = Object.freeze({ panel, patchFor });
})();
