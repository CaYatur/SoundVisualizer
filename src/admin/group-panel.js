'use strict';
/* Katman grupları ve A/B çapraz geçişi.

   Bir sahne on katmana çıktığında tek tek fader sürmek işe yaramaz;
   "arkaplan katmanları" ile "ön katmanlar" birlikte kısılmak istenir. Grup
   adı katmanın kendisinde tutulur, fader burada.

   "A" ve "B" grupları özel: aralarındaki fader klasik VJ çapraz geçişi
   olarak davranır ve eşit güç eğrisi kullanır — doğrusal karışımda geçişin
   ortasında toplam parlaklık düşer ve görüntü sönükleşir. */
(function () {
  const P = () => window.SVPanel;
  const SP = () => window.SVScenePanels;

  // Sahnede geçen grup adlarını topla
  function usedGroups(cfg) {
    const out = [];
    for (const l of (Array.isArray(cfg.layers) ? cfg.layers : [])) {
      const g = l && l.group;
      if (g && out.indexOf(g) < 0) out.push(g);
    }
    for (const g of Object.keys(cfg.layerGroups || {})) if (out.indexOf(g) < 0) out.push(g);
    return out.sort();
  }

  function panel() {
    const el = P().el;
    const cfg = P().cfg();
    cfg.layerGroups = cfg.layerGroups || {};
    cfg.crossfade = cfg.crossfade || window.SV.defaultConfig().crossfade;
    const rerender = () => P().apply();
    const nodes = [];

    // ------------------------------------------------------- A/B fader
    const x = cfg.crossfade;
    const hasA = (cfg.layers || []).some((l) => l && l.group === 'A');
    const hasB = (cfg.layers || []).some((l) => l && l.group === 'B');

    nodes.push(SP().miniToggle('A/B Çapraz Geçiş Etkin', () => x.enabled !== false, (v) => { x.enabled = v; }, rerender));
    if (x.enabled !== false) {
      const val = el('span', { class: 'xf-val', text: label(x.value) });
      const slider = el('input', {
        type: 'range', min: 0, max: 1, step: 0.005, value: x.value == null ? 0 : x.value,
        class: 'xf-slider',
        oninput: (e) => {
          x.value = parseFloat(e.target.value);
          val.textContent = label(x.value);
          P().push(false);
        },
      });
      nodes.push(el('div', { class: 'ctrl xf-box' }, [
        el('div', { class: 'row' }, [
          el('span', { class: 'xf-tag' + (hasA ? '' : ' dim'), text: 'A' }),
          val,
          el('span', { class: 'xf-tag' + (hasB ? '' : ' dim'), text: 'B' }),
        ]),
        slider,
        el('div', { class: 'row' }, [
          el('button', { class: 'btn ghost tiny', type: 'button', text: '◀ A', onclick: () => { x.value = 0; rerender(); } }),
          el('button', { class: 'btn ghost tiny', type: 'button', text: 'Orta', onclick: () => { x.value = 0.5; rerender(); } }),
          el('button', { class: 'btn ghost tiny', type: 'button', text: 'B ▶', onclick: () => { x.value = 1; rerender(); } }),
        ]),
      ]));
      if (!hasA && !hasB) {
        nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Fader "A" ve "B" gruplarına atanmış katmanları karşılıklı kısar. Katman kartındaki Grup ve Fader bölümünden bir katmana A ya da B yazın.' }));
      }
    }

    // ------------------------------------------------------- grup faderları
    const groups = usedGroups(cfg);
    if (!groups.length) {
      nodes.push(el('div', { class: 'studio-note', text: 'Henüz grup yok. Katman kartındaki Grup ve Fader bölümünden bir grup adı yazın.' }));
      return el('div', { class: 'grp-panel' }, nodes);
    }

    for (const name of groups) {
      const g = cfg.layerGroups[name] || (cfg.layerGroups[name] = { opacity: 1, muted: false });
      const count = (cfg.layers || []).filter((l) => l && l.group === name).length;
      nodes.push(el('div', { class: 'grp-item' }, [
        el('div', { class: 'row' }, [
          el('span', { class: 'item-title', text: name }),
          el('span', { class: 'grp-count', text: count + ' katman' }),
          el('button', {
            class: 'btn ghost tiny' + (g.muted ? ' on mute' : ''),
            type: 'button', text: 'M', title: 'Grubu sustur',
            onclick: () => { g.muted = !g.muted; rerender(); },
          }),
        ]),
        SP().miniSlider('Fader', () => (g.opacity == null ? 1 : g.opacity), (v) => { g.opacity = v; }, {
          min: 0, max: 1, step: 0.005, percent: true,
        }),
      ]));
    }

    nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Grup faderı katman saydamlığıyla çarpılır; katmanın kendi ayarı korunur.' }));
    return el('div', { class: 'grp-panel' }, nodes);
  }

  function label(v) {
    const k = Math.round((v == null ? 0 : v) * 100);
    return k === 0 ? 'A' : k === 100 ? 'B' : k + '%';
  }

  window.SVGroupPanel = { panel };
})();
