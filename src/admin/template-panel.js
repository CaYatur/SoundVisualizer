'use strict';
/* Hazır şablon galerisi.

   Uygulamayı ilk açan biri 47 mod, 31 arkaplan, 40 efekt ve 98 formülle
   karşılaşıyor; bu bir başlangıç noktası değil. Galeri, kullanıma ve türe
   göre gruplanmış bitmiş sahneler sunar.

   Bir şablonu denemek kullanıcının kurulumunu bozmaz: ses aygıtı, ekran
   seçimi, yayın ve aydınlatma ayarları korunur. Bu, şablon motorunun
   güvencesi ve tests/templates.test.js'te ölçülüyor. */
(function () {
  const P = () => window.SVPanel;

  let group = null;
  let search = '';
  let lastApplied = '';

  function panel() {
    const el = P().el;
    const T = window.SVTemplates;
    const nodes = [];
    if (!T) return el('div', { class: 'studio-note', text: 'Şablon kitaplığı yüklenemedi.' });

    const groups = T.groups();
    if (!group || groups.indexOf(group) < 0) group = groups[0];

    // Grup sekmeleri
    const tabs = el('div', { class: 'tpl-tabs' });
    tabs.appendChild(el('button', {
      class: 'btn ghost tiny' + (group === '*' ? ' active' : ''),
      type: 'button', text: 'Tümü',
      onclick: () => { group = '*'; P().rerender(); },
    }));
    for (const g of groups) {
      tabs.appendChild(el('button', {
        class: 'btn ghost tiny' + (group === g ? ' active' : ''),
        type: 'button', text: g,
        onclick: () => { group = g; P().rerender(); },
      }));
    }
    nodes.push(tabs);

    nodes.push(P().row('Ara', el('input', {
      class: 'p-in', type: 'search', value: search, placeholder: 'şablon adı ya da açıklaması',
      oninput: (e) => { search = e.target.value; P().rerender(); },
    })));

    const q = search.trim().toLowerCase();
    const list = T.TEMPLATES.filter((t) => {
      if (group !== '*' && t.group !== group) return false;
      if (!q) return true;
      return (t.name + ' ' + t.desc + ' ' + t.group).toLowerCase().includes(q);
    });

    const grid = el('div', { class: 'tpl-grid' });
    for (const t of list) {
      grid.appendChild(el('button', {
        class: 'tpl-card' + (lastApplied === t.id ? ' active' : ''),
        type: 'button',
        onclick: () => applyTemplate(t),
      }, [
        el('span', { class: 'tpl-swatch', style: swatch(t) }),
        el('span', { class: 'tpl-name', text: t.name }),
        el('span', { class: 'tpl-desc', text: t.desc }),
        el('span', { class: 'tpl-group', text: t.group }),
      ]));
    }
    if (!list.length) {
      grid.appendChild(el('div', { class: 'studio-note', text: 'Aramaya uyan şablon yok.' }));
    }
    nodes.push(grid);

    nodes.push(el('div', {
      class: 'studio-note dim-hint',
      text: 'Şablon yalnızca sahneyi değiştirir: arkaplan, görselleştirici, palet, efekt zinciri, modülasyon ve geçiş. Ses aygıtı, ekran seçimi, yayın ve aydınlatma ayarlarınız olduğu gibi kalır.',
    }));

    return el('div', { class: 'tpl-panel' }, nodes);
  }

  // Kart önizlemesi: şablonun paletinden bir şerit
  function swatch(t) {
    const cols = (t.patch.background && t.patch.background.gradient && t.patch.background.gradient.colors) ||
      ['#333', '#777'];
    const stops = cols.map((c, i) => c + ' ' + Math.round((i / cols.length) * 100) + '% ' +
      Math.round(((i + 1) / cols.length) * 100) + '%').join(', ');
    return 'background: linear-gradient(90deg, ' + stops + ')';
  }

  function applyTemplate(t) {
    const T = window.SVTemplates;
    const cur = P().cfg();
    const next = T.apply(cur, t, {
      defaultConfig: window.SV.defaultConfig,
      deepMerge: window.SV.deepMerge,
      clone: window.SV.clone,
    });
    /* Yapılandırma nesnesi panelin her yerinde referansla tutuluyor; yerine
       yenisini koymak yerine İÇERİĞİNİ değiştiriyoruz, yoksa açık paneller
       eski nesneye bakmaya devam ederdi. */
    for (const k of Object.keys(cur)) delete cur[k];
    Object.assign(cur, next);
    lastApplied = t.id;
    P().apply();
    P().toast('"' + t.name + '" uygulandı.');
  }

  window.SVTemplatePanel = { panel };
})();
