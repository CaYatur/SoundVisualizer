/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Sahne geçişi paneli.

   Geçiş yalnızca SAHNE değiştiğinde çalışır: mod, arkaplan, Studio preset,
   palet ya da katman yapısı değiştiğinde. Bir kaydırıcıyı sürüklemek geçiş
   başlatmaz — başlatsaydı panel kullanılamaz hale gelirdi.

   Panelin sunduğu her şey kapatılabilir: en üstteki anahtar kapalıyken sahne
   değişimi eskisi gibi anında olur. */
(function () {
  const P = () => window.SVPanel;
  const SP = () => window.SVScenePanels;

  const EASE_LABELS = [
    ['linear', 'Doğrusal'],
    ['smooth', 'Yumuşak'],
    ['easeIn', 'Yavaş Başla'],
    ['easeOut', 'Yavaş Bitir'],
    ['easeInOut', 'Yavaş Başla ve Bitir'],
    ['snap', 'Ani'],
  ];

  const UNIT_LABELS = [['seconds', 'Saniye'], ['beats', 'Vuruş']];

  function panel() {
    const el = P().el;
    const cfg = P().cfg();
    const tr = cfg.transition || (cfg.transition = window.SV.defaultConfig().transition);
    const T = window.SVTransition;
    const rerender = () => P().apply();
    const nodes = [];

    nodes.push(SP().miniToggle('Geçişler Etkin', () => tr.enabled !== false, (v) => { tr.enabled = v; }, rerender));

    if (tr.enabled === false) {
      nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Geçişler kapalı: sahne değişimleri anında olur.' }));
      return el('div', { class: 'tr-panel' }, nodes);
    }

    if (!T) {
      nodes.push(el('div', { class: 'studio-note', text: 'Geçiş motoru yüklenemedi.' }));
      return el('div', { class: 'tr-panel' }, nodes);
    }

    // ------------------------------------------------------------- tür
    // 20 tür: düğme grubu yerine seçim kutusu, denetçide yer açılıyor
    const opts = T.TRANSITION_IDS.map((id) => [id, T.TRANSITIONS[id].label]);
    nodes.push(SP().miniSelect('Tür', opts, () => tr.type, (v) => { tr.type = v; }, rerender));

    // --------------------------------------------------------- süre / eğri
    nodes.push(SP().miniSelect('Süre Birimi', UNIT_LABELS, () => tr.unit || 'seconds', (v) => { tr.unit = v; }, rerender));
    if (tr.unit === 'beats') {
      nodes.push(SP().miniSlider('Süre', () => (tr.duration == null ? 2 : tr.duration), (v) => { tr.duration = v; }, {
        min: 0.25, max: 16, step: 0.25, fmt: (v) => (+v).toFixed(2) + ' vuruş',
      }));
      nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Vuruş cinsinden süre tempo motorundan okunur; geçiş müziğe oturur.' }));
    } else {
      nodes.push(SP().miniSlider('Süre', () => (tr.duration == null ? 0.7 : tr.duration), (v) => { tr.duration = v; }, {
        min: 0.05, max: 5, step: 0.05, fmt: (v) => (+v).toFixed(2) + ' sn',
      }));
    }
    nodes.push(SP().miniSelect('Hız Eğrisi', EASE_LABELS, () => tr.ease || 'smooth', (v) => { tr.ease = v; }));

    // ------------------------------------------------- türe özel parametreler
    const def = T.TRANSITIONS[tr.type];
    if (def && def.params && def.params.length) {
      tr.params = tr.params || {};
      const kids = [];
      for (const p of def.params) {
        if (tr.params[p.name] == null) tr.params[p.name] = p.default;
        if (p.step >= 1 && p.max - p.min <= 1) {
          // İki durumlu parametreler (ör. "dikey") anahtar olarak daha okunur
          kids.push(SP().miniToggle(p.label, () => !!tr.params[p.name], (v) => { tr.params[p.name] = v ? 1 : 0; }));
        } else {
          kids.push(SP().miniSlider(p.label, () => tr.params[p.name], (v) => { tr.params[p.name] = v; }, {
            min: p.min, max: p.max, step: p.step,
            fmt: (v) => (p.step >= 1 ? String(Math.round(v)) : (+v).toFixed(2)),
          }));
        }
      }
      nodes.push(el('div', { class: 'tr-params' }, kids));
    }

    // --------------------------------------------------- karartma geçişi
    const BLACKOUT_OPTS = [
      ['crossfade', 'Sönümleme (Yumuşak Karart)'],
      ['cut', 'Anında Kes (Animasyonsuz)'],
      ['dissolve', 'Erime'],
    ];
    nodes.push(el('div', { class: 'studio-subheading', text: 'Karartma (Blackout) Geçişi' }));
    nodes.push(SP().miniSelect('Karartma Animasyonu', BLACKOUT_OPTS, () => tr.blackoutType || 'crossfade', (v) => { tr.blackoutType = v; }, rerender));
    if ((tr.blackoutType || 'crossfade') !== 'cut') {
      nodes.push(SP().miniSlider('Karartma Süresi', () => (tr.blackoutDuration == null ? 0.4 : tr.blackoutDuration), (v) => { tr.blackoutDuration = v; }, {
        min: 0.05, max: 2, step: 0.05, fmt: (v) => (+v).toFixed(2) + ' sn',
      }));
    }

    // ------------------------------------------------------------- deneme
    /* Deneme yalnız paneldeki küçük önizlemede (#957): canlı çıkışa, kayda,
       NDI/Spout'a hiç gitmiyor; iki karşıt örnek sahne arasında oynuyor. */
    const PV = window.SVTransitionPreview;
    if (PV) {
      const stack = () => { const pr = window.SVPreview; return pr && pr.stack && pr.stack(); };
      const box = PV.create(() => P().cfg().transition || tr, { bpm: () => { const st = stack(); return (st && st.bpm) || 0; } });
      nodes.push(box);
      nodes.push(el('div', { class: 'row' }, [
        el('button', {
          class: 'btn', type: 'button', icon: 'play', text: 'Geçişi Dene',
          title: 'Geçişi ve karartmayı yalnız bu önizlemede oynatır; çıkış değişmez',
          onclick: () => box._play(),
        }),
      ]));
    }

    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'Geçiş yalnızca sahne değiştiğinde çalışır (mod, arkaplan, preset, palet ya da katman yapısı). Kaydırıcı oynatmak geçiş başlatmaz.',
    }));

    return el('div', { class: 'tr-panel' }, nodes);
  }

  window.SVTransitionPanel = { panel };
})();
