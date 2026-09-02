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
    const opts = T.TRANSITION_IDS.map((id) => ({ value: id, label: T.TRANSITIONS[id].label }));
    nodes.push(P().segment('Tür', 'transition.type', opts, { rebuild: true }));

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

    // ------------------------------------------------------------- deneme
    nodes.push(el('div', { class: 'row' }, [
      el('button', {
        class: 'btn', type: 'button', text: '▶ Geçişi Dene',
        title: 'Sahneyi kendisiyle değiştirerek geçişi bir kez oynatır',
        onclick: () => {
          /* Sahneyi gerçekten değiştirmeden geçişi tetiklemek için katman
             yığınına doğrudan söylüyoruz. Kullanıcının seçtiği ayarları
             görmenin en hızlı yolu bu; sahneyi bozmadan çalışır. */
          const prev = window.SVPreview;
          const stack = prev && prev.stack && prev.stack();
          if (!stack) { P().toast('Önizleme hazır değil.'); return; }
          const cfg = P().cfg();
          stack.beginTransition(window.SV.clone(cfg), {
            type: tr.type,
            duration: window.SVTransition.durationSeconds(cfg, stack.bpm || 0),
            opts: tr.params || {},
            ease: tr.ease,
          });
          stack.setConfig(cfg);
        },
      }),
    ]));

    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'Geçiş yalnızca sahne değiştiğinde çalışır (mod, arkaplan, preset, palet ya da katman yapısı). Kaydırıcı oynatmak geçiş başlatmaz.',
    }));

    return el('div', { class: 'tr-panel' }, nodes);
  }

  window.SVTransitionPanel = { panel };
})();
