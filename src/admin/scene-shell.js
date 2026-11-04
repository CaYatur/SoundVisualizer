/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* SAHNE SAYFASI (#905). Solda katmanlar, ortada görüntü ve raf, sağda seçili öğenin denetçisi.

   Bu dosya yeni ayar tanımlamıyor: denetçi katman düzenleyicisini (scene-panels.js
   `layersPanel({ only })`) ve motor kartlarını (admin.js `sectionCard`) olduğu gibi çiziyor.
   Ayarın tek tanımı değişmesin, arama ve varsayılana dönme aynı kalsın diye. */
(function () {
  const P = () => window.SVPanel;
  const SP = () => window.SVScenePanels;
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
  const STORE = { sel: 'sv-sel-layer', shelf: 'sv-shelf-tab', open: 'sv-shelf-open' };
  const read = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* depo yok */ } };

  let sel = read(STORE.sel, '');
  let shelfTab = read(STORE.shelf, 'milkdrop');
  let shelfOpen = read(STORE.open, '1') !== '0';
  let query = '';
  const scrollOf = { layers: 0, inspector: 0, shelf: 0 };

  /* Kitaplık sekmeleri ve araçlar. `section` varsa kartın kendisi rafa çiziliyor. */
  const LIB_TABS = [
    { id: 'milkdrop', label: 'MilkDrop' },
    { id: 'vis', label: 'Görsel' },
    { id: 'bg', label: 'Zemin' },
    { id: 'templates', label: 'Şablon', section: 'templates' },
    { id: 'scenes', label: 'Sahne' },
  ];
  const TOOL_TABS = [
    { id: 'effects', label: 'Efekt Zinciri', section: 'effects' },
    { id: 'modulation', label: 'Modülasyon', section: 'modulation' },
    { id: 'groups', label: 'Gruplar', section: 'groups' },
  ];
  const isLib = (id) => LIB_TABS.some((t) => t.id === id);

  const KIND_ICON = { background: 'image', visualizer: 'bars', media: 'film', sprites: 'sparkle', logo: 'star', nowplaying: 'music', input: 'broadcast', web: 'globe' };
  const ENGINE_SECTION = { milkdrop: 'milkdrop', geometry: 'geometry', feedback: 'feedbackengine' };

  function layers() {
    const cfg = P().cfg();
    return Array.isArray(cfg.layers) ? cfg.layers : (cfg.layers = []);
  }
  function selected() {
    return layers().find((l) => l && l.id === sel) || null;
  }
  function select(id) {
    sel = id || '';
    write(STORE.sel, sel);
    aimPicker();
    paint();
  }
  // Kitaplıktan seçilen preset seçili katmana: kendi preseti olan katman, yoksa ortak
  function aimPicker() {
    const MP = window.SVMilkdropPanel;
    if (!MP || !MP.pickFor) return;
    const l = selected();
    MP.pickFor(l && MP.isOwnLayer(l) ? l.id : '');
  }

  // Küçük resim: MilkDrop'ta o an seçili presetin karesi, ötekilerde tür simgesi
  function thumbOf(l) {
    const el = P().el;
    const box = el('span', { class: 'sv-th' });
    const md = window.SVMilkdropPanel;
    if (l.kind === 'visualizer' && l.type === 'milkdrop' && md && md.thumbFor) {
      const own = l.settings && l.settings.milkdrop;
      const cfg = P().cfg();
      const src = own && own.independent ? own : (cfg.milkdrop || {});
      const url = md.thumbFor(src);
      if (src.presetId) box.setAttribute('data-thumb-for', src.presetId);
      if (url) { box.appendChild(el('img', { src: url, alt: '', loading: 'lazy', onerror: (e) => { e.target.remove(); } })); return box; }
    }
    box.appendChild(el('span', { icon: KIND_ICON[l.kind] || 'layers' }));
    return box;
  }

  function subOf(l) {
    const cfg = P().cfg();
    if (l.kind === 'visualizer' && l.type === 'milkdrop') {
      const own = l.settings && l.settings.milkdrop;
      const md = own && own.independent ? own : cfg.milkdrop;
      return (md && md.name) ? tr(md.name) : tr('MilkDrop');
    }
    return SP().layerSummary ? SP().layerSummary(l) : (l.type || l.kind);
  }

  function toggle(cls, on, text, icon, title, click) {
    return P().el('button', {
      class: 'sv-tgl ' + cls + (on ? ' act' : ''), type: 'button', text: icon ? '' : text, icon: icon || undefined,
      title: tr(title), 'aria-label': tr(title), 'aria-pressed': on ? 'true' : 'false',
      onclick: (e) => { e.stopPropagation(); click(); },
    });
  }

  function opacityBar(l) {
    const el = P().el;
    const fill = el('i');
    const show = () => { fill.style.width = Math.round((l.opacity == null ? 1 : l.opacity) * 100) + '%'; };
    show();
    const bar = el('span', { class: 'sv-op', title: tr('Saydamlık'), onclick: (e) => e.stopPropagation() }, [fill]);
    bar.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      bar.setPointerCapture(e.pointerId);
      const set = (ev) => {
        const r = bar.getBoundingClientRect();
        l.opacity = Math.max(0, Math.min(1, (ev.clientX - r.left) / Math.max(1, r.width)));
        show();
        P().push(false);
      };
      const end = () => { bar.removeEventListener('pointermove', set); bar.removeEventListener('pointerup', end); P().push(true); };
      bar.addEventListener('pointermove', set);
      bar.addEventListener('pointerup', end);
      set(e);
    });
    return bar;
  }

  function layerRow(l, i) {
    const el = P().el;
    const list = layers();
    const row = el('div', {
      class: 'sv-lt' + (l.id === sel ? ' sel' : '') + (l.enabled === false || l.muted ? ' off' : ''),
      'data-id': l.id, draggable: l.locked ? 'false' : 'true', role: 'button', tabindex: '0',
      onclick: () => select(l.id),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(l.id); } },
    }, [
      thumbOf(l),
      el('span', { class: 'sv-nm' }, [el('b', { text: tr(l.name || l.kind) }), el('span', { text: subOf(l) })]),
      el('span', { class: 'sv-lt-acts' }, [
        toggle('solo', !!l.solo, 'S', null, 'Solo: yalnızca solo katmanlar çizilir', () => { l.solo = !l.solo; P().apply(); }),
        toggle('mute', !!l.muted, 'M', null, 'Sessiz: katmanı ayarlarını kaybetmeden gizler', () => { l.muted = !l.muted; P().apply(); }),
        toggle('lock', !!l.locked, '', 'lock', 'Kilit: kazara düzenlemeyi engeller', () => { l.locked = !l.locked; P().apply(); }),
        toggle('vis', l.enabled === false, '', l.enabled === false ? 'eye-off' : 'eye', 'Katmanı aç/kapat', () => { l.enabled = l.enabled === false; P().apply(); }),
      ]),
      l.kind === 'logo' ? null : opacityBar(l),
    ]);
    row.addEventListener('dragstart', (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/sv-layer', String(i)); row.classList.add('dragging'); });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      const r = row.getBoundingClientRect();
      const above = e.clientY < r.top + r.height / 2;
      row.classList.toggle('dropb', above);
      row.classList.toggle('dropa', !above);
    });
    row.addEventListener('dragleave', () => { row.classList.remove('dropb', 'dropa'); });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const above = row.classList.contains('dropb');
      row.classList.remove('dropb', 'dropa');
      const from = Number(e.dataTransfer.getData('text/sv-layer'));
      if (!Number.isInteger(from) || from === i) return;
      const moved = list.splice(from, 1)[0];
      if (!moved) return;
      // Liste ekranda ters sırada: üstte görünen dizide sonda
      let to = list.indexOf(l);
      if (above) to += 1;
      list.splice(to, 0, moved);
      P().apply();
    });
    return row;
  }

  function closeMenus() {
    document.querySelectorAll('.sv-menu').forEach((m) => m.remove());
  }
  function placeMenu(menu, x, y) {
    closeMenus();
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
    setTimeout(() => {
      const close = () => { menu.remove(); document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', esc, true); };
      const off = (e) => { if (!menu.contains(e.target)) close(); };
      const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
      document.addEventListener('pointerdown', off, true);
      document.addEventListener('keydown', esc, true);
    }, 0);
  }

  function openAdd(e) {
    const el = P().el;
    const r = e.currentTarget.getBoundingClientRect();
    const addRow = SP().layersPanel({ add: true });
    const menu = el('div', { class: 'sv-menu sv-add' }, [el('div', { class: 'sv-mh', text: tr('Katman Ekle') }), addRow]);
    addRow.addEventListener('click', (ev) => { if (ev.target.closest('button')) menu.remove(); });
    placeMenu(menu, r.left, r.bottom + 6);
  }

  function sceneColors() {
    const cfg = P().cfg();
    const R = window.SV && window.SV.resolveBackgroundColors;
    return (R ? R(cfg) : ((cfg.background && cfg.background.gradient && cfg.background.gradient.colors) || [])).slice(0, 5);
  }

  function activeSceneName() {
    const cfg = P().cfg();
    const id = cfg._activeSceneId;
    const hit = id && (cfg.scenes || []).find((s) => s && s.id === id);
    return hit ? hit.name : tr('Sahne');
  }

  // A/B çapraz geçişi: yalnız A ya da B grubunda katman varken
  function crossfader() {
    const el = P().el;
    const cfg = P().cfg();
    const x = cfg.crossfade;
    if (!x || x.enabled === false) return null;
    if (!(cfg.layers || []).some((l) => l && (l.group === 'A' || l.group === 'B'))) return null;
    return el('div', { class: 'sv-xf' }, [
      el('span', { text: 'A' }),
      el('input', {
        type: 'range', min: 0, max: 1, step: 0.005, value: x.value == null ? 0 : x.value, 'aria-label': tr('A/B Çapraz Geçiş'),
        oninput: (e) => { x.value = parseFloat(e.target.value); P().push(false); },
        onchange: () => P().push(true),
      }),
      el('span', { text: 'B' }),
    ]);
  }

  /* Sahnenin renkleri zemine yansıyor. Karelerden örnek alınmıyor: paletten, yalnız çizimde. */
  function paintAmbient() {
    const a = document.getElementById('svAmbient');
    if (!a) return;
    const c = sceneColors();
    if (c.length < 2) { a.style.background = 'none'; return; }
    a.style.background = 'radial-gradient(900px 520px at 22% 8%, ' + c[Math.min(2, c.length - 1)] + ', transparent 70%),'
      + 'radial-gradient(900px 520px at 82% 12%, ' + c[c.length - 1] + ', transparent 70%)';
  }

  function paintLayers(host) {
    const el = P().el;
    const list = layers();
    const box = el('div', { class: 'sv-cbody' });
    box.appendChild(el('div', {
      class: 'sv-scene-tile' + (sel ? '' : ' sel'), role: 'button', tabindex: '0',
      onclick: () => select(''),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(''); } },
    }, [
      el('b', { text: activeSceneName() }),
      el('span', { class: 'sv-dots' }, sceneColors().map((c) => { const d = el('i'); d.style.background = c; return d; })),
    ]));
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]) box.appendChild(layerRow(list[i], i));
    }
    box.appendChild(el('div', { class: 'sv-hint', text: tr('Sıralamak için sürükleyin. Üstteki katman önde görünür.') }));
    const nodes = [
      el('div', { class: 'sv-chead' }, [
        el('h3', { class: 'sv-grow', text: tr('Katmanlar') }),
        el('button', { class: 'btn small', type: 'button', icon: 'plus', text: tr('Ekle'), onclick: openAdd }),
      ]),
      box,
    ];
    const xf = crossfader();
    if (xf) nodes.push(xf);
    host.replaceChildren(...nodes.filter(Boolean));
    box.scrollTop = scrollOf.layers;
    box.addEventListener('scroll', () => { scrollOf.layers = box.scrollTop; });
  }

  // Denetçi: seçili katman ya da sahnenin kendisi
  function paintInspector(host) {
    const el = P().el;
    const l = selected();
    const nodes = [];
    const body = el('div', { class: 'sv-cbody sv-insp' });
    if (!l) {
      nodes.push(el('div', { class: 'sv-ihead' }, [el('div', { class: 'sv-ititle' }, [
        el('span', { class: 'sv-th', icon: 'layers' }),
        el('span', { class: 'sv-names' }, [el('input', { value: activeSceneName(), readonly: 'readonly', 'aria-label': tr('Sahne') }), el('small', { text: tr('Sahne ayarları') })]),
      ])]));
      body.appendChild(SP().layersPanel({ scene: true }));
      for (const id of ['colorPresets', 'dynamicTheme', 'transition']) {
        const c = P().sectionCard(id);
        if (c) body.appendChild(c);
      }
    } else {
      nodes.push(el('div', { class: 'sv-ihead' }, [el('div', { class: 'sv-ititle' }, [
        thumbOf(l),
        el('span', { class: 'sv-names' }, [
          el('input', {
            value: tr(l.name || l.kind), 'aria-label': tr('Katman adı'),
            onchange: (e) => { l.name = e.target.value.trim() || l.name; P().apply(); },
          }),
          el('small', { text: subOf(l) }),
        ]),
        el('button', {
          class: 'sv-ib sm', type: 'button', icon: 'x', title: tr('Kaldır'), 'aria-label': tr('Kaldır'), disabled: !!l.locked,
          onclick: () => { const list = layers(); const i = list.indexOf(l); if (i >= 0 && !l.locked) { list.splice(i, 1); sel = ''; write(STORE.sel, ''); P().apply(); } },
        }),
      ])]));
      body.appendChild(SP().layersPanel({ only: l.id }));
      const sec = l.kind === 'visualizer' && ENGINE_SECTION[l.type];
      if (sec) {
        const c = P().sectionCard(sec, { part: 'control' });
        if (c) body.appendChild(c);
      }
    }
    nodes.push(body);
    host.replaceChildren(...nodes);
    body.scrollTop = scrollOf.inspector;
    body.addEventListener('scroll', () => { scrollOf.inspector = body.scrollTop; });
  }

  // Raf: modlar katalogdan, tıklayınca seçili katmana ya da yeni katmana
  function modeGallery(kind) {
    const el = P().el;
    const MC = window.SVModeCatalog;
    const q = query.toLocaleLowerCase();
    const entries = (kind === 'bg' ? MC.BACKGROUNDS : MC.VISUALIZERS) || [];
    const groups = new Map();
    entries.forEach((m) => {
      const label = tr(m.label || m.id);
      if (q && label.toLocaleLowerCase().indexOf(q) < 0) return;
      const g = tr(m.group || '');
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push({ id: m.id, label });
    });
    const l = selected();
    const want = kind === 'bg' ? 'background' : 'visualizer';
    const box = el('div', { class: 'sv-gal' });
    for (const [g, items] of groups) {
      if (g) box.appendChild(el('div', { class: 'sv-gh', text: g }));
      for (const it of items) {
        box.appendChild(el('button', {
          class: 'sv-gi nothumb' + (l && l.kind === want && l.type === it.id ? ' cur' : ''), type: 'button',
          onclick: () => applyMode(want, it.id, it.label),
        }, [el('span', { class: 'sv-th', icon: kind === 'bg' ? 'image' : 'bars' }), el('b', { text: it.label })]));
      }
    }
    return box;
  }

  /* Seçili katman bu türdense onun modu değişiyor; değilse o türün ilk katmanı. Hiç yoksa yeni
     katman: kullanıcı "şunu göster" dedi, bir şey olmadan kalmasın. */
  function applyMode(want, id, label) {
    const list = layers();
    let l = selected();
    if (!l || l.kind !== want || l.locked) l = list.slice().reverse().find((x) => x && x.kind === want && !x.locked);
    if (!l) {
      l = window.SVLayers.normalizeLayer({ kind: want, type: id, name: label });
      if (want === 'background') list.unshift(l); else list.push(l);
    }
    l.type = id;
    if (l.settings && l.settings[want]) l.settings[want].type = id;
    sel = l.id;
    write(STORE.sel, sel);
    P().apply();
  }

  /* Sahne rafı: yan raftaki listenin kendisi. Kaydetme, yeniden adlandırma, sıralama, silme ve
     içe/dışa aktarma iki kez yazılmasın. */
  let scenesNode = null;
  function sceneShelf() {
    if (!scenesNode) scenesNode = document.getElementById('dockScenes');
    if (scenesNode && P().renderScenes) setTimeout(() => P().renderScenes(), 0);
    return scenesNode;
  }

  function targetLine() {
    const l = selected();
    if (shelfTab === 'milkdrop') {
      const own = l && l.kind === 'visualizer' && l.type === 'milkdrop';
      return own && window.SVMilkdropPanel.isOwnLayer(l) ? tr('Şuna uygulanır:') + ' ' + tr(l.name || 'MilkDrop') : tr('Ortak MilkDrop presetine uygulanır');
    }
    if (shelfTab === 'vis' || shelfTab === 'bg') {
      return l ? tr('Şuna uygulanır:') + ' ' + tr(l.name || l.kind) : tr('Yeni katman olarak eklenir');
    }
    return '';
  }

  function paintShelf(host) {
    const el = P().el;
    const lib = isLib(shelfTab);
    const tabs = lib ? LIB_TABS : TOOL_TABS;
    const head = el('div', { class: 'sv-chead' }, [
      el('div', { class: 'sv-shelf-mode sv-adv' }, [
        el('button', { class: lib ? 'on' : '', type: 'button', icon: 'library', title: tr('Kitaplık'), 'aria-label': tr('Kitaplık'), onclick: () => setShelf(LIB_TABS[0].id) }),
        el('button', { class: lib ? '' : 'on', type: 'button', icon: 'sliders', title: tr('Araçlar'), 'aria-label': tr('Araçlar'), onclick: () => setShelf(TOOL_TABS[0].id) }),
      ]),
      el('div', { class: 'sv-tabs', role: 'tablist' }, tabs.map((t) => el('button', {
        class: t.id === shelfTab ? 'on' : '', type: 'button', role: 'tab', text: tr(t.label), onclick: () => setShelf(t.id),
      }))),
      lib && shelfTab !== 'milkdrop' && shelfTab !== 'scenes' ? el('label', { class: 'sv-shelf-search' }, [
        el('span', { icon: 'search' }),
        el('input', { placeholder: tr('Ara'), value: query, 'aria-label': tr('Kitaplıkta ara'), oninput: (e) => { query = e.target.value; paintShelfBody(host); } }),
      ]) : el('span', { class: 'sv-grow' }),
      el('button', {
        class: 'sv-ib sm', type: 'button', icon: shelfOpen ? 'chevron-down' : 'chevron-up',
        title: tr(shelfOpen ? 'Rafı kapat, sahneyi büyüt' : 'Rafı aç'), 'aria-label': tr(shelfOpen ? 'Rafı kapat, sahneyi büyüt' : 'Rafı aç'),
        onclick: () => { shelfOpen = !shelfOpen; write(STORE.open, shelfOpen ? '1' : '0'); paint(); },
      }),
    ]);
    const body = el('div', { class: 'sv-cbody' + (shelfTab === 'milkdrop' ? ' sv-fill' : ''), 'data-shelf-body': '1' });
    host.replaceChildren(head, body);
    paintShelfBody(host);
    const c = document.getElementById('svCenter');
    if (c) c.classList.toggle('tall', !shelfOpen);
  }

  function paintShelfBody(host) {
    const body = host.querySelector('[data-shelf-body]');
    if (!body || !shelfOpen) { if (body) body.replaceChildren(); return; }
    const el = P().el;
    const kids = [];
    const line = targetLine();
    if (line) kids.push(el('div', { class: 'sv-target', text: line }));
    const tab = LIB_TABS.concat(TOOL_TABS).find((t) => t.id === shelfTab) || LIB_TABS[0];
    if (tab.section) {
      const c = P().sectionCard(tab.section);
      if (c) kids.push(c);
    } else if (tab.id === 'milkdrop') {
      const c = P().sectionCard('milkdrop', { part: 'library', always: true, filter: query });
      if (c) kids.push(c);
    } else if (tab.id === 'vis' || tab.id === 'bg') {
      kids.push(modeGallery(tab.id));
    } else if (tab.id === 'scenes') {
      kids.push(sceneShelf());
    }
    body.replaceChildren(...kids);
    body.scrollTop = scrollOf.shelf;
    body.onscroll = () => { scrollOf.shelf = body.scrollTop; };
  }

  function setShelf(id) {
    shelfTab = id;
    write(STORE.shelf, id);
    if (!shelfOpen) { shelfOpen = true; write(STORE.open, '1'); }
    scrollOf.shelf = 0;
    paint();
  }

  /* Arama sonucundan gelen kart: Sahne sayfasında yeri raf ya da denetçi. */
  function reveal(sectionId) {
    const tab = LIB_TABS.concat(TOOL_TABS).find((t) => t.section === sectionId);
    if (tab) { shelfTab = tab.id; shelfOpen = true; write(STORE.shelf, tab.id); write(STORE.open, '1'); return; }
    const engine = Object.keys(ENGINE_SECTION).find((k) => ENGINE_SECTION[k] === sectionId);
    if (engine) {
      const l = layers().find((x) => x && x.kind === 'visualizer' && x.type === engine);
      if (l) { sel = l.id; write(STORE.sel, sel); }
      return;
    }
    if (sectionId === 'colorPresets' || sectionId === 'dynamicTheme' || sectionId === 'transition') { sel = ''; write(STORE.sel, ''); }
  }

  // Önizleme bu sayfada ortada; öteki sayfalarda yan rafta. Aynı düğüm taşınıyor, motor yeniden kurulmuyor.
  /* Düğüm elde tutuluyor: Canlı sayfası monitörünü yeniden kurarken eski kap gidiyor, önizleme
     onunla belgeden düşer ve id ile bir daha bulunamazdı. */
  let stageNode = null;
  function placeStage(page) {
    const stage = stageNode || (stageNode = document.getElementById('previewStage'));
    if (!stage) return;
    const scene = page === 'scene';
    const pgm = page === 'live' ? document.getElementById('svPgmFrame') : null;
    const host = pgm || (scene ? document.getElementById('svFrame') : document.getElementById('dockStageHost'));
    if (host && stage.parentNode !== host) host.insertBefore(stage, host.firstChild);
    const tools = document.getElementById('previewTools');
    const toolHost = scene ? document.getElementById('svHudTools') : document.getElementById('dockStageTools');
    if (tools && toolHost && tools.parentNode !== toolHost) toolHost.appendChild(tools);
    // Sahne listesi rafta kaldıysa yan rafa dönsün
    if (!scene && scenesNode && !document.getElementById('dockScenes')) {
      const dock = document.getElementById('dock');
      if (dock) dock.appendChild(scenesNode);
    }
  }

  function paint() {
    aimPicker();
    paintAmbient();
    const a = document.getElementById('svLayers');
    const b = document.getElementById('svInspector');
    const c = document.getElementById('svShelf');
    if (!a || !b || !c) return;
    const f = document.activeElement;
    const keepInput = f && f.closest && f.closest('.sv-shelf-search') ? f.selectionStart : null;
    // Düzenleyici katmanı normalleştirip listeye yeniden yazıyor: satırlar o nesneye bağlansın
    paintInspector(b);
    paintLayers(a);
    paintShelf(c);
    if (keepInput !== null) {
      const inp = c.querySelector('.sv-shelf-search input');
      if (inp) { inp.focus(); inp.setSelectionRange(keepInput, keepInput); }
    }
  }

  // Küçük resim sonradan çizildi: bekleyen kutulara yerleştir
  function thumbReady(id, url) {
    document.querySelectorAll('[data-thumb-for]').forEach((box) => {
      if (box.getAttribute('data-thumb-for') !== id || box.querySelector('img')) return;
      box.replaceChildren(P().el('img', { src: url, alt: '' }));
    });
  }

  window.SVSceneShell = { thumbReady, paint, placeStage, select, setShelf, selected, closeMenus, placeMenu, reveal };
})();
