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
  /* `quiet`: seçim yazılır, çizimi çağıran yapar (yeni katman eklenince hemen ardından apply var). */
  function select(id, quiet) {
    sel = id || '';
    write(STORE.sel, sel);
    aimPicker();
    if (!quiet) paint();
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

  /* Sahnenin küçük resmi: üstteki MilkDrop katmanının presetinden, yoksa boş (renk özeti kalır). */
  function sceneThumb(sc) {
    const md = window.SVMilkdropPanel;
    const data = sc && sc.data;
    if (!data || !md || !md.thumbFor) return null;
    const list = Array.isArray(data.layers) ? data.layers : [];
    for (let i = list.length - 1; i >= 0; i--) {
      const l = list[i];
      if (!l || l.kind !== 'visualizer' || l.type !== 'milkdrop' || l.enabled === false) continue;
      const own = l.settings && l.settings.milkdrop;
      const src = own && own.independent ? own : (data.milkdrop || {});
      if (src.presetId) return { id: src.presetId, url: md.thumbFor(src) };
    }
    return null;
  }

  /* Satırın başlığı: türü değil ne olduğunu söylesin. "Görselleştirici / Galaksi" yerine "Galaksi". */
  function titleOf(l) {
    const custom = l.name && !DEFAULT_NAMES.has(l.name);
    if (custom) return tr(l.name);
    if (l.kind === 'visualizer' && l.type === 'milkdrop') return 'MilkDrop';
    if (l.kind === 'visualizer' || l.kind === 'background') return SP().layerSummary ? SP().layerSummary(l) : tr(l.name || l.kind);
    return tr(l.name || l.kind);
  }
  const DEFAULT_NAMES = new Set(['Görselleştirici', 'Arkaplan', 'Katman', 'Visualizer', 'Background', 'Layer']);

  function subOf(l) {
    const cfg = P().cfg();
    if (l.kind === 'visualizer' && l.type === 'milkdrop') {
      const own = l.settings && l.settings.milkdrop;
      const md = own && own.independent ? own : cfg.milkdrop;
      return (md && md.name) ? tr(md.name) : tr('MilkDrop');
    }
    if (l.kind === 'visualizer' || l.kind === 'background') {
      if (l.name && !DEFAULT_NAMES.has(l.name)) return SP().layerSummary ? SP().layerSummary(l) : (l.type || l.kind);
      const k = (SP().LAYER_KIND_LABELS || []).find(([id]) => id === l.kind);
      return k ? tr(k[1]) : tr(l.kind);
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
    const bar = el('span', { class: 'sv-op', title: tr('Saydamlık'), onclick: (e) => e.stopPropagation() }, [fill]);
    const show = () => {
      const v = l.opacity == null ? 1 : l.opacity;
      fill.style.width = Math.round(v * 100) + '%';
      bar.classList.toggle('set', v < 1);
    };
    show();
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
      el('span', { class: 'sv-nm' }, [el('b', { text: titleOf(l) }), el('span', { text: subOf(l) })]),
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

  /* Sahnenin rengi zemine yansıyor: önizlemenin 32x18'lik kopyası büyük bulanıklıkla, saniyede sekiz kez.
     Küçük tuvale GPU'da kopya, geri okuma yok. Önizleme duraklatılınca ya da yokken son renk kalıyor. */
  let ambientOn = false;
  let ambientAt = 0;
  let hudFrames = 0;
  let hudAt = 0;
  let hudBeat = 0;
  let hudBass = 0;
  /* Önizlemenin kendi bilgisi: çıkış kapalıyken de BPM, akor, seviye ve kare hızı görünsün. */
  function hudTick(now) {
    hudFrames++;
    const P0 = window.SVPreview;
    const lv = P0.getLevels ? P0.getLevels() : null;
    if (!lv) return;
    const pct = (v) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100) + '%';
    const L = document.getElementById('hudL');
    const B = document.getElementById('hudB');
    if (L) L.style.setProperty('--v', pct(lv.level));
    if (B) B.style.setProperty('--v', pct(lv.bass));
    if (hudFrames % 2 === 0) {
      const mix = document.getElementById('svMixer');
      if (mix) mix.style.setProperty('--lvl', (Math.min(1, Number(lv.level) || 0)).toFixed(3));
    }
    const bass = Number(lv.bass) || 0;
    if (bass > 0.6 && hudBass <= 0.6) {
      hudBeat = (hudBeat + 1) % 4;
      const dots = document.getElementById('hudBeat');
      if (dots) for (let i = 0; i < dots.children.length; i++) dots.children[i].classList.toggle('on', i === hudBeat);
    }
    hudBass = bass;
    if (now - hudAt < 500) return;
    const fps = Math.round((hudFrames * 1000) / Math.max(1, now - hudAt));
    hudAt = now;
    hudFrames = 0;
    const set = (id, t) => { const n = document.getElementById(id); if (n && n.textContent !== t) n.textContent = t; };
    set('hudFps', fps + ' fps');
    const tp = window.SVAutoVJ && window.SVAutoVJ.tempoOf ? window.SVAutoVJ.tempoOf() : null;
    set('hudBpm', tp && tp.bpm ? Math.round(tp.bpm) + ' BPM' : '');
    const eng = P0.audioEngine ? P0.audioEngine() : null;
    const an = eng && eng.analysis;
    const chord = an && an.chord && an.chord.confidence > 0.4 ? an.chord.name : '';
    set('hudKey', chord || '');
  }

  function ambientFrame(now) {
    hudTick(now);
    if (now - ambientAt < 125) return;
    ambientAt = now;
    const a = document.getElementById('svAmbient');
    const stage = document.getElementById('pvStage');
    if (!a || !stage) return;
    const list = stage.querySelectorAll('canvas');
    if (!list.length) return;
    const g = a.getContext('2d');
    g.clearRect(0, 0, a.width, a.height);
    list.forEach((c) => {
      if (!c.width || !c.height || c.style.display === 'none') return;
      try { g.drawImage(c, 0, 0, a.width, a.height); } catch { /* henüz çizilmedi */ }
    });
  }
  function paintAmbient() {
    const a = document.getElementById('svAmbient');
    if (!a) return;
    if (!ambientOn && window.SVPreview && window.SVPreview.onFrame) {
      ambientOn = true;
      const c = sceneColors();
      const g = a.getContext('2d');
      if (c.length > 1) {
        const f = g.createLinearGradient(0, 0, a.width, 0);
        c.forEach((col, i) => f.addColorStop(i / (c.length - 1), col));
        g.fillStyle = f;
        g.fillRect(0, 0, a.width, a.height);
      }
      window.SVPreview.onFrame(ambientFrame);
    }
    const t = window.SVUiTheme && window.SVUiTheme.current && window.SVUiTheme.current();
    a.style.opacity = t && t.scheme === 'light' ? '.18' : '';
  }

  /* Katman listesi yalnız gösterdiği şey değişince yeniden kuruluyor; ayar değiştirmek satırları
     kurmasın. Satırlar katman nesnesine bağlı: düzenleyici nesneyi yenilediyse imza aynı olsa da kuruluyor. */
  let notesWatched = null;
  let layersPainted = '';
  let layersBound = [];
  function layersSig() {
    const cfg = P().cfg();
    const x = cfg.crossfade;
    return JSON.stringify([
      sel, activeSceneName(), sceneColors(), x ? [x.enabled, x.value] : null,
      layers().map((l) => l && [l.id, l.kind, l.type, titleOf(l), subOf(l), l.enabled, !!l.muted, !!l.solo, !!l.locked, l.opacity, l.group]),
    ]);
  }

  function paintLayers(host) {
    const el = P().el;
    const list = layers();
    const sig = layersSig();
    if (sig === layersPainted && host.firstChild && list.length === layersBound.length && list.every((l, i) => l === layersBound[i])) return;
    layersPainted = sig;
    layersBound = list.slice();
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
  /* Ana efektler: sırası ve ayarları Efekt Zinciri rafında, burada açıp kapatmak. */
  function masterFx() {
    const el = P().el;
    const cfg = P().cfg();
    const FX = window.SVPostFX;
    const chain = Array.isArray(cfg.postfx) ? cfg.postfx : [];
    const on = chain.filter((f) => f && f.enabled !== false).length;
    return el('div', { class: 'card sv-masterfx', 'data-card': 'masterfx' }, [
      el('div', { class: 'card-head' }, [
        el('div', { class: 'ch-main' }, [el('h3', { text: tr('Ana Efektler') })]),
        el('div', { class: 'ch-actions' }, [el('span', { class: 'sv-mono', text: on + ' / ' + chain.length })]),
      ]),
      el('div', { class: 'group' }, chain.map((f) => {
        const def = FX && FX.EFFECTS && FX.EFFECTS[f.type];
        const inp = el('input', { type: 'checkbox', onchange: (e) => { f.enabled = e.target.checked; P().apply(); } });
        inp.checked = f.enabled !== false;
        return el('label', { class: 'sv-fxline' }, [el('span', { class: 'switch small' }, [inp, el('span', { class: 'track' })]), el('span', { text: tr(def ? def.label : f.type) })]);
      }).concat([
        el('button', { class: 'btn ghost small sv-fxadd', type: 'button', icon: 'plus', text: tr('Efekt Ekle'), onclick: () => setShelf('effects') }),
      ])),
    ]);
  }

  /* MilkDrop katmanının ilk sorusu: ne çalıyor? Büyük resim, ad, önceki ve sonraki preset. */
  function mdCard(l) {
    const el = P().el;
    const MP = window.SVMilkdropPanel;
    if (!MP || !MP.isOwnLayer) return null;
    const own = MP.isOwnLayer(l);
    const md = own ? l.settings.milkdrop : (P().cfg().milkdrop || {});
    const go = (dir) => { MP.pickFor(own ? l.id : ''); MP.act(dir); };
    const th = thumbOf(l);
    const nav = (dir, icon, title) => el('button', { class: 'sv-ib sm', type: 'button', icon, title: tr(title), 'aria-label': tr(title), onclick: () => go(dir) });
    return el('div', { class: 'sv-pcard' }, [
      th,
      el('div', { class: 'sv-pinfo' }, [
        el('b', { text: md.name ? tr(md.name) : tr('Yerleşik varsayılan') }),
        el('small', { text: tr(own ? 'Bu katmanın kendi preseti' : 'Ortak preset') }),
        el('div', { class: 'sv-pnav' }, [nav('Prev', 'chevron-left', 'Önceki preset'), nav('Next', 'chevron-right', 'Sonraki preset')]),
      ]),
    ]);
  }

  function paintInspector(host) {
    const el = P().el;
    const l = selected();
    const nodes = [];
    const body = el('div', { class: 'sv-cbody sv-insp' });
    if (!l) {
      const swatch = el('span', { class: 'sv-th' });
      const cols = sceneColors();
      if (cols.length > 1) swatch.style.background = 'linear-gradient(135deg,' + cols.join(',') + ')';
      nodes.push(el('div', { class: 'sv-ihead' }, [el('div', { class: 'sv-ititle' }, [
        swatch,
        el('span', { class: 'sv-names' }, [el('input', { value: activeSceneName(), readonly: 'readonly', 'aria-label': tr('Sahne') }), el('small', { text: tr('Sahne ayarları') })]),
        el('button', { class: 'sv-ib sm', type: 'button', icon: 'save', title: tr('Mevcut görünümü yeni sahne olarak kaydet'), 'aria-label': tr('Kaydet'), onclick: () => { P().saveScene(); paint(); } }),
      ])]));
      /* Sıra: renk, geçiş, efektler, gruplar. Palet ızgarası Kitaplık'ta; burada seçim kutusu. */
      for (const id of ['colorPresets', 'dynamicTheme', 'transition']) {
        const c = P().sectionCard(id, { compact: true });
        if (c) body.appendChild(c);
      }
      body.appendChild(masterFx());
      const grp = P().sectionCard('groups');
      if (grp) body.appendChild(grp);
      body.appendChild(SP().layersPanel({ scene: true }));
      // Eski sayfa başındaki "kategoriyi sıfırla": katman listesine dokunmuyor
      body.appendChild(el('button', {
        class: 'btn ghost small', type: 'button', icon: 'reset', text: 'Sahne Ayarlarını Sıfırla',
        title: tr('Renkleri, geçişi, efektleri ve modülasyonu varsayılana döndürür; katmanlar kalır.'),
        onclick: () => P().resetCategory('scene'),
      }));
    } else {
      nodes.push(el('div', { class: 'sv-ihead' }, [el('div', { class: 'sv-ititle' }, [
        thumbOf(l),
        el('span', { class: 'sv-names' }, [
          el('input', {
            value: titleOf(l), 'aria-label': tr('Katman adı'),
            onchange: (e) => { l.name = e.target.value.trim() || l.name; P().apply(); },
          }),
          el('small', { text: subOf(l) }),
        ]),
        el('button', {
          class: 'sv-ib sm', type: 'button', icon: 'x', title: tr('Kaldır'), 'aria-label': tr('Kaldır'), disabled: !!l.locked,
          onclick: () => { const list = layers(); const i = list.indexOf(l); if (i >= 0 && !l.locked) { list.splice(i, 1); sel = ''; write(STORE.sel, ''); P().apply(); } },
        }),
      ])]));
      const card = l.kind === 'visualizer' && l.type === 'milkdrop' ? mdCard(l) : null;
      if (card) body.appendChild(card);
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

  /* MilkDrop rafı 10.000 presetin etiketini sayıyor ve ızgarayı ölçüyor (apply başına 46 ms). Yalnız
     hedef katman ya da etkin preset değişince çiziliyor; raf içinden gelen değişiklik `invalidateShelf`
     ile bildiriliyor. Öteki sekmeler ucuz, onlarda karşılaştırma yok. */
  let shelfPainted = '';
  let shelfStale = true;
  function shelfSig() {
    if (shelfTab !== 'milkdrop' || !shelfOpen) return '';
    const l = layers().find((x) => x && x.id === sel);
    const own = l && l.settings && l.settings.milkdrop;
    const md = own || P().cfg().milkdrop || {};
    return JSON.stringify([query, sel, l ? l.type : '', l ? l.name : '', md.id || md.name || '', md.presetId || '']);
  }
  function invalidateShelf() { shelfStale = true; }

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
      lib && shelfTab !== 'milkdrop' && shelfTab !== 'scenes' && shelfTab !== 'templates' ? el('label', { class: 'sv-shelf-search' }, [
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

  function setShelf(id, filter) {
    shelfTab = id;
    if (filter !== undefined) query = filter;
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
  /* ÖNİZLEME ARAÇLARI. En-boy yalnız önizlemeyi değiştiriyor: dikey ya da kare çıktının nasıl duracağını
     görmek için; çıkış pencereleri kendi boyunda. Seçimler makinede kalıyor. */
  const ASPECTS = [['16:9', 16 / 9], ['9:16', 9 / 16], ['1:1', 1], ['4:3', 4 / 3], ['21:9', 21 / 9]];
  function setAspect(name) {
    const hit = ASPECTS.find((x) => x[0] === name) || ASPECTS[0];
    document.documentElement.style.setProperty('--sv-ar', String(hit[1]));
    write('sv-preview-aspect', hit[0]);
    const badge = document.querySelector('.preview-badge');
    if (badge) badge.textContent = hit[0];
  }
  function setSafe(on) {
    write('sv-preview-safe', on ? '1' : '0');
    document.querySelectorAll('.sv-safe').forEach((n) => { n.hidden = !on; });
    const b = document.getElementById('svSafeBtn');
    if (b) b.classList.toggle('on', on);
  }
  function previewTools() {
    const host = document.getElementById('previewTools');
    if (!host || host.dataset.built) return;
    host.dataset.built = '1';
    const el = P().el;
    const sel = el('select', {
      class: 'sv-hud-select', title: tr('Önizlemenin en-boy oranı'), 'aria-label': tr('Önizlemenin en-boy oranı'),
      onchange: (e) => setAspect(e.target.value),
    }, ASPECTS.map((x) => el('option', { value: x[0], text: x[0] })));
    sel.value = read('sv-preview-aspect') || '16:9';
    const safe = el('button', {
      id: 'svSafeBtn', class: 'icon-btn small', type: 'button', icon: 'target', title: tr('Güvenli alan'), 'aria-label': tr('Güvenli alan'),
      onclick: () => setSafe(read('sv-preview-safe') !== '1'),
    });
    const full = el('button', {
      class: 'icon-btn small', type: 'button', icon: 'fullscreen', title: tr('Tam ekran önizleme'), 'aria-label': tr('Tam ekran önizleme'),
      onclick: () => {
        if (document.fullscreenElement) { document.exitFullscreen(); return; }
        const f = document.getElementById('previewStage');
        if (f && f.parentElement && f.parentElement.requestFullscreen) f.parentElement.requestFullscreen();
      },
    });
    const pill = document.getElementById('previewSource');
    const pause = document.getElementById('previewToggle');
    const grid = document.getElementById('layoutEditBtn');
    host.replaceChildren(pill, sel, safe, grid, pause, full);
    setAspect(sel.value);
    setSafe(read('sv-preview-safe') === '1');
  }

  function placeStage(page) {
    previewTools();
    const stage = stageNode || (stageNode = document.getElementById('previewStage'));
    if (!stage) return;
    const scene = page === 'scene';
    const pgm = page === 'live' ? document.getElementById('svPgmFrame') : null;
    const out = (page === 'output' && !document.body.hasAttribute('data-wide')) || (page === 'studio' && document.body.hasAttribute('data-gen')) ? document.getElementById('svOutFrame') : null;
    const host = pgm || out || (scene ? document.getElementById('svFrame') : document.getElementById('dockStageHost'));
    if (host && stage.parentNode !== host) host.insertBefore(stage, host.firstChild);
    /* Güvenli alan çerçevesi önizlemenin üstünde, hangi sayfaya taşınırsa onunla. */
    if (!stage.querySelector('.sv-safe')) { const sf = P().el('div', { class: 'sv-safe' }); sf.hidden = read('sv-preview-safe') !== '1'; stage.appendChild(sf); }
    /* Araçlar önizlemenin üstünde: her sayfada aynı yerde. */
    const tools = document.getElementById('previewTools');
    if (tools && !document.getElementById('svStageTools')) {
      const hud = P().el('div', { id: 'svStageTools', class: 'sv-hud r' });
      stage.appendChild(hud);
      hud.appendChild(tools);
    }
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
    if (!notesWatched && window.MutationObserver) {
      /* Katman sekmeleri kendi içinde yeniden kuruluyor; paint'e uğramıyor. */
      notesWatched = new MutationObserver(() => P().clampNotes(b));
      notesWatched.observe(b, { childList: true, subtree: true });
    }
    P().clampNotes(b);
    paintLayers(a);
    const sig = shelfSig();
    if (shelfStale || !sig || sig !== shelfPainted || !c.querySelector('[data-shelf-body] .md-library')) {
      paintShelf(c);
      shelfPainted = sig;
      shelfStale = false;
    }
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

  window.SVSceneShell = { thumbReady, paint, placeStage, select, setShelf, selected, closeMenus, placeMenu, reveal, invalidateShelf, sceneThumb, thumbOf, titleOf };
})();
