/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* MOBİL ARAYÜZ KABUĞU (docs/android/PLAN.md Faz 3.2, onaylı taslaklar 1, 11, 13).

   Ayrı bir sayfa yok: arayüz, masaüstündeki görselleştirici sayfasının ÜSTÜNE
   kurulur (D2: tek motor). Sahne motorun kendi tuvali; kabuk yalnız üst bilgiyi,
   sahne kartını, sahne şeridini, alt gezinmeyi ve alttan açılan sayfaları çizer.

   - Metinler Türkçe yazılır; src/shared/i18n.js sayfadaki metni kendiliğinden
     çeviriyor (İngilizce karşılıkları orada).
   - Renkler temadan (src/shared/ui-themes.js, ayarın `ui.theme`'i; masaüstündeki anahtar).
   - Tam ekranda, sistem PiP'inde ve yüzen pencerede kabuk gizlenir.
   - Geri tuşu önce açık sayfayı kapatır, sonra tam ekrandan çıkar; en son
     uygulamayı arkaya alır (motor ve ses sürer; Activity kapatılmaz).
   - Ekran kenarı boşlukları (çentik, sistem çubukları) uygulamadan gelir.

   Sekmelerin içeriği sonraki adımlarda `SVShell.tab(id, render)` ile eklenir. */
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const env = window.__SV_ANDROID || {};
  if (String(env.page || '').indexOf('src/visualizer/') !== 0) return;

  const SOURCE_NAMES = {
    capture: 'Sistem sesi', mic: 'Mikrofon', visualizer: 'Çıkış karışımı', player: 'Çalar',
  };
  const TABS = [
    { id: 'scene', icon: 'image', label: 'Sahne' },
    { id: 'layers', icon: 'layers', label: 'Katmanlar' },
    { id: 'library', icon: 'library', label: 'Kitaplık' },
    { id: 'audio', icon: 'speaker', label: 'Ses' },
    { id: 'settings', icon: 'gear', label: 'Ayarlar' },
  ];
  const renderers = {};

  /* ready: ayar yüklenene kadar kabuk gizli. Yoksa açılışta bir an varsayılan tema
     ve boş sahne şeridi görünürdü (neon kullanan biri önce CaYaDev'i görüyordu). */
  const state = { tab: 'scene', ready: false, fullscreen: false, pip: false, floating: false, level: 0, source: null };
  let root = null;
  let refs = {};

  function h(tag, attrs, kids) {
    const n = document.createElement(tag);
    for (const k of Object.keys(attrs || {})) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(kids || [])) if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return n;
  }
  function icon(name) {
    const I = window.SVIcons;
    return I && I.has(name) ? I.el(name) : h('span', { class: 'svi' });
  }

  const A = () => window.SVAndroid;
  const cfg = () => (A() && A().config.get()) || null;

  // ---- Tema ----
  const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function applyTheme() {
    const T = window.SVUiThemes;
    if (!T) return;
    const c = cfg();
    if (!c) return; // ayar gelmeden tema seçilmez (:root zaten CaYaDev)
    const id = T.normalizeId(c.ui && c.ui.theme);
    T.apply(document, id, darkQuery ? darkQuery.matches : true, false);
  }

  // ---- Görünürlük ----
  function updateVisibility() {
    if (!root) return;
    root.classList.toggle('hidden', !state.ready || state.fullscreen || state.pip || state.floating);
  }
  function setFullscreen(on) {
    state.fullscreen = !!on;
    if (on) closeSheet();
    updateVisibility();
  }

  // ---- Sayfalar ----
  /* Bir sekmenin içeriği bir sayfa YIĞINI: kök sayfa (ör. katman listesi) ve onun
     üstüne açılanlar (katman ayarları, katman ekle). Geri tuşu önce üstteki sayfayı
     kapatır. Sayfa: { title, render(body, ctx), actions?(slot, ctx), onConfig?(ctx) }.
     onConfig: ayar başka yerden değişti (Otomatik VJ, sahne çağırma); sayfa
     kendini yenileyip yenilemeyeceğine kendisi karar verir. */
  let stack = [];
  const ctx = {
    get foot() { return refs.sheetParts ? refs.sheetParts.foot : null; },
    close: () => closeSheet(),
    push: (page) => { stack.push(page); showPage(); },
    pop: () => { if (stack.length > 1) { stack.pop(); showPage(); } },
    refresh: () => showPage(),
    depth: () => stack.length,
    get top() { return stack[stack.length - 1] || null; },
  };
  function pageOf(id) {
    const tab = TABS.find((t) => t.id === id);
    const r = renderers[id];
    if (typeof r === 'function') return { title: tab.label, render: r };
    if (r && typeof r === 'object') return Object.assign({ title: tab.label }, r);
    return { title: tab.label, render: (body) => body.appendChild(h('div', { class: 'hint', text: 'Bu bölüm henüz hazır değil.' })) };
  }
  function openTab(id) {
    state.tab = id;
    for (const b of refs.navButtons) {
      const on = b.dataset.tab === id;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
    if (id === 'scene') { closeSheet(); return; }
    openSheetWith(pageOf(id));
  }
  /* Sayfayı yeni bir alttan açılan sayfada açar (sekme ya da sekme dışı sayfa). */
  function openSheetWith(page) {
    const label = typeof page.title === 'function' ? page.title() : page.title;
    const backBtn = h('button', { class: 'iconbtn plain', 'aria-label': 'Geri', title: 'Geri', onclick: () => ctx.pop() }, [icon('chevron-left')]);
    const lead = h('div', { class: 'sheet-lead' });
    const title = h('h2');
    const sub = h('div', { class: 'sheet-sub' });
    const actions = h('div', { class: 'sheet-actions' });
    const body = h('div', { class: 'sheet-body' });
    const foot = h('div', { class: 'sheet-foot' });
    const sheet = h('section', { class: 'sheet live', 'aria-label': label }, [
      h('div', { class: 'grabber' }),
      h('div', { class: 'sheet-head' }, [backBtn, lead, h('div', { class: 'sheet-titles' }, [title, sub]), actions]),
      body,
      foot,
    ]);
    if (refs.sheet) refs.sheet.remove();
    refs.sheet = sheet;
    refs.sheetParts = { backBtn, lead, title, sub, actions, body, foot };
    root.insertBefore(sheet, refs.nav);
    stack = [page];
    showPage();
    root.classList.add('has-sheet');
  }
  function showPage() {
    const p = refs.sheetParts;
    const page = stack[stack.length - 1];
    if (!p || !page) return;
    const keep = page === shown ? p.body.scrollTop : 0;
    shown = page;
    // Sayfa boyu (taslak 2/3/4): liste alttan üçte iki, ayarlar daha uzun, ekleme tam boy
    refs.sheet.dataset.size = page.size || 'normal';
    root.classList.toggle('sheet-full', page.size === 'full' || page.size === 'screen');
    p.backBtn.hidden = stack.length < 2;
    p.title.textContent = typeof page.title === 'function' ? page.title() : page.title;
    const sub = page.subtitle ? (typeof page.subtitle === 'function' ? page.subtitle() : page.subtitle) : '';
    p.sub.textContent = sub || '';
    p.sub.hidden = !sub;
    for (const k of ['lead', 'actions', 'body', 'foot']) p[k].textContent = '';
    if (page.lead) page.lead(p.lead, ctx);
    p.lead.hidden = !p.lead.firstChild;
    if (page.actions) page.actions(p.actions, ctx);
    page.render(p.body, ctx);
    p.foot.hidden = !p.foot.firstChild;
    // Aynı sayfa yeniden çizildiyse kaydırma yeri korunur (düğmeye basınca başa atlamasın)
    p.body.scrollTop = keep;
  }
  let shown = null;

  /* Onay penceresi. WebView'in yerel confirm'ü sayfayı (motoru da) bekletiyordu;
     bu, kabuğun içinde. Promise<boolean>. */
  function confirmBox(text, okText, danger) {
    return new Promise((resolve) => {
      const cancel = () => done(false);
      const done = (v) => {
        const i = dialogs.indexOf(cancel);
        if (i >= 0) dialogs.splice(i, 1);
        box.remove();
        resolve(v);
      };
      const ok = h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), text: okText || 'Tamam', onclick: () => done(true) });
      const box = h('div', { class: 'dialog-scrim live', role: 'presentation', onclick: (e) => { if (e.target === box) done(false); } }, [
        h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': text }, [
          h('div', { class: 'dialog-text', text }),
          h('div', { class: 'btn-row' }, [h('button', { class: 'btn ghost', text: 'Vazgeç', onclick: () => done(false) }), ok]),
        ]),
      ]);
      dialogs.push(cancel);
      root.appendChild(box);
      ok.focus();
    });
  }
  const dialogs = [];
  function closeDialog() {
    const open = root && root.querySelector('.dialog-scrim');
    if (!open) return false;
    const f = dialogs.pop();
    if (f) f(); else open.remove();
    return true;
  }
  function closeSheet() {
    if (refs.sheet) { refs.sheet.remove(); refs.sheet = null; refs.sheetParts = null; }
    stack = [];
    if (root) root.classList.remove('has-sheet', 'sheet-full');
    if (refs.navButtons && state.tab !== 'scene') {
      state.tab = 'scene';
      for (const b of refs.navButtons) b.classList.toggle('on', b.dataset.tab === 'scene');
    }
  }

  /* Geri tuşu: true dönerse kabuk karşıladı. */
  function back() {
    if (closeDialog()) return true;
    if (refs.sheet && stack.length > 1) { ctx.pop(); return true; }
    if (refs.sheet) { closeSheet(); return true; }
    if (state.fullscreen) { setFullscreen(false); return true; }
    return false;
  }

  // ---- Sahne ----
  function scenes() {
    const c = cfg();
    return c && Array.isArray(c.scenes) ? c.scenes : [];
  }
  function activeScene() {
    const c = cfg();
    const id = c && c._activeSceneId;
    return scenes().find((s) => s && s.id === id) || null;
  }
  /* Sahneyi çağırır (panelin timeline-target.js loadScene'i): sahneye ait
     anahtarlar sahnedekiyle, sahnede olmayanlar varsayılanla. */
  function recallScene(sc) {
    const c = cfg();
    const S = window.SVSchema;
    if (!c || !sc || !S) return;
    const def = window.SV && window.SV.defaultConfig ? window.SV.defaultConfig() : {};
    const next = Object.assign({}, c);
    const data = sc.data || {};
    for (const k of S.SCENE_KEYS) {
      const v = data[k] !== undefined ? data[k] : def[k];
      if (v === undefined) delete next[k];
      else next[k] = JSON.parse(JSON.stringify(v));
    }
    next._activeSceneId = sc.id;
    A().config.set(next);
  }
  /* "3 katman" / "3 layers": sayı metnin içinde, sözlük çeviremez; dil burada seçilir. */
  function countLabel(n) {
    const en = !!(window.SVI18n && window.SVI18n.locale === 'en');
    return en ? n + (n === 1 ? ' layer' : ' layers') : n + ' katman';
  }
  /* Çizilen ortak MilkDrop presetinin adı: otomatik geçişin seçimi (ölçer iletisi), yoksa
     ayardaki seçim, o da yoksa preset deposundaki adı. */
  let liveMd = '';
  function mdName(c) {
    if (liveMd) return liveMd;
    const m = c.milkdrop || {};
    if (m.name) return m.name;
    const P = window.SVPresets;
    const p = P && P.get ? P.get(m.presetId || '') : null;
    return (p && p.name) || '';
  }
  /* Sahne kutusunun resmi: sahnenin en üstteki görselleştiricisinin (yoksa arkaplanının)
     mod küçük resmi; ikisi de yoksa adının baş harfleri. */
  function sceneArt(sc) {
    const L = window.SVShellLayers;
    const list = sc && sc.data && Array.isArray(sc.data.layers) ? sc.data.layers : [];
    let key = '';
    if (L) {
      for (let i = list.length - 1; i >= 0 && !key; i--) {
        const l = list[i];
        if (l && l.kind === 'visualizer' && l.type !== 'text' && l.enabled !== false) key = L.thumbKey('visualizer', l.type);
      }
      for (let i = list.length - 1; i >= 0 && !key; i--) {
        const l = list[i];
        if (l && l.kind === 'background' && l.enabled !== false) key = L.thumbKey('background', l.type);
      }
    }
    if (key) return h('div', { class: 'art img', 'aria-hidden': 'true' }, [h('img', { src: '../../assets/mode-thumbs/' + key + '.webp', alt: '', decoding: 'async' })]);
    return h('div', { class: 'art', 'aria-hidden': 'true', text: initials(sc.name) });
  }
  function initials(name) {
    const w = String(name || '?').trim().split(/\s+/).filter(Boolean);
    return ((w[0] || '?')[0] + (w[1] ? w[1][0] : '')).toUpperCase();
  }
  function renderScenes() {
    const list = scenes();
    const act = activeScene();
    refs.scenes.textContent = '';
    // İlk kurulumda sahne yok: hazır şablonlara götüren kutu
    if (!list.length && window.SVShellLibrary) {
      refs.scenes.appendChild(h('button', { class: 'scene glass live start', onclick: () => window.SVShellLibrary.templates() }, [
        h('div', { class: 'art', 'aria-hidden': 'true' }, [icon('sparkles')]),
        h('div', { class: 'cap', text: 'Şablonlar' }),
      ]));
    }
    for (const sc of list) {
      const on = act && act.id === sc.id;
      refs.scenes.appendChild(h('button', {
        class: 'scene glass live' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false',
        onclick: () => recallScene(sc),
      }, [sceneArt(sc), h('div', { class: 'cap', text: sc.name || '' })]));
    }
    const c = cfg();
    refs.sceneTitle.textContent = act ? act.name : 'Sahne';
    const n = c && Array.isArray(c.layers) ? c.layers.filter((l) => l && l.enabled !== false).length : 0;
    /* "5 katman · MilkDrop: Aurora" (taslak 1): çizilen ortak MilkDrop presetinin adı */
    refs.sceneSub.textContent = '';
    refs.sceneSub.appendChild(document.createTextNode(countLabel(n)));
    const md = c && Array.isArray(c.layers) && c.layers.some((l) => l && l.kind === 'visualizer' && l.type === 'milkdrop' && l.enabled !== false)
      ? mdName(c) : '';
    if (md) refs.sceneSub.append(' · MilkDrop: ', h('span', { text: md }));
    const vj = !!(c && c.autovj && c.autovj.enabled);
    refs.vj.classList.toggle('on', vj);
    refs.vj.setAttribute('aria-pressed', vj ? 'true' : 'false');
  }
  function toggleVj() {
    const c = cfg();
    if (!c) return;
    const vj = Object.assign({}, c.autovj, { enabled: !(c.autovj && c.autovj.enabled) });
    A().config.patch({ autovj: vj });
    renderScenes();
  }

  // ---- Üst bilgi ----
  function renderSource() {
    const st = A() && A().audio.status();
    const running = st && st.state === 'running' ? st.source : null;
    state.source = running;
    refs.sourceLabel.textContent = running ? (SOURCE_NAMES[running] || running) : 'Demo ses';
    refs.sourceDot.classList.toggle('on', !!running);
  }
  /* Seviye algısal ölçekte (karekök): müzik çoğunlukla 0,05–0,15 arasında,
     doğrusal ölçekte çubuklar kıpırdamıyordu (demo seste ölçüldü). */
  function renderMeter(level) {
    const bars = refs.meterBars;
    const v = Math.sqrt(Math.max(0, Math.min(1, level || 0)));
    for (let i = 0; i < bars.length; i++) {
      const k = (i + 1) / bars.length;
      const px = Math.round(2 + 14 * Math.min(1, v * 1.6 * (1.1 - k * 0.2))) + 'px';
      if (bars[i].style.height !== px) bars[i].style.height = px;
    }
  }

  // ---- Kurulum ----
  function build() {
    const meterBars = [h('i'), h('i'), h('i', { class: 'm' }), h('i', { class: 'h' })];
    const sourceDot = h('span', { class: 'dot', 'aria-hidden': 'true' });
    const sourceLabel = h('span', { class: 'label', text: 'Demo ses' });
    // Tempo çipi (taslak 1): telefonun tempo motorundan; tempo bulunmadıysa gizli
    const bpmValue = h('span');
    const bpmChip = h('div', { class: 'chip glass mono bpm-chip', hidden: true }, [bpmValue, h('span', { class: 'dim', text: 'BPM' })]);
    const hud = h('div', { class: 'hud' }, [
      h('button', { class: 'chip glass live', onclick: () => openTab('audio') }, [sourceDot, sourceLabel, h('span', { class: 'meter', 'aria-hidden': 'true' }, meterBars)]),
      bpmChip,
      h('div', { class: 'spacer' }),
      h('button', {
        class: 'iconbtn glass live', 'aria-label': 'Görüntüleme', title: 'Görüntüleme',
        onclick: () => (window.SVShellDisplay ? openSheetWith(window.SVShellDisplay.page()) : A().floating.open()),
      }, [icon('window')]),
      h('button', { class: 'iconbtn glass live', 'aria-label': 'Tam ekran', title: 'Tam ekran', onclick: () => setFullscreen(true) }, [icon('fullscreen')]),
    ]);
    const sceneTitle = h('div', { class: 'title' });
    const sceneSub = h('div', { class: 'sub' });
    const vj = h('button', { class: 'pill', onclick: toggleVj }, [icon('dice'), 'Otomatik VJ']);
    const sceneCard = h('div', { class: 'scene-card glass live' }, [h('div', { class: 'grow' }, [sceneTitle, sceneSub]), vj]);
    const scenesStrip = h('div', { class: 'scenes live', role: 'group', 'aria-label': 'Sahneler' });
    const navButtons = TABS.map((t) => h('button', {
      'data-tab': t.id, class: t.id === state.tab ? 'on' : '', onclick: () => (state.tab === t.id && t.id !== 'scene' ? closeSheet() : openTab(t.id)),
    }, [icon(t.icon), t.label]));
    const nav = h('nav', { class: 'nav glass live', 'aria-label': 'Ana gezinme' }, navButtons);
    root = h('div', { id: 'sv-shell' }, [hud, sceneCard, scenesStrip, nav]);
    refs = { meterBars, sourceDot, sourceLabel, bpmChip, bpmValue, sceneTitle, sceneSub, vj, sceneCard, scenes: scenesStrip, nav, navButtons, sheet: null };
    document.body.appendChild(root);
  }

  function setInsets(v) {
    if (!root || !v) return;
    for (const k of ['top', 'right', 'bottom', 'left']) root.style.setProperty('--inset-' + k, (Number(v[k]) || 0) + 'px');
  }

  function start() {
    const S = A();
    if (!S || document.getElementById('sv-shell')) return;
    document.head.appendChild(h('link', { rel: 'stylesheet', href: '../mobile/shell.css' }));
    build();
    updateVisibility();
    applyTheme();
    if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', applyTheme);
    setInsets(S.insets());
    S.onInsets(setInsets);
    S.onChrome((v) => {
      if (v && 'pip' in v) state.pip = !!v.pip;
      if (v && 'floating' in v) state.floating = !!v.floating;
      updateVisibility();
    });
    S.onBack(() => { if (!back()) S.app.toBackground(); });
    S.onLowPower((on) => root.classList.toggle('flat', !!on));
    S.audio.onStatus(renderSource);
    S.onMeter((m) => {
      renderMeter(m && m.level);
      const n = (m && m.mdPreset && m.mdPreset.name) || '';
      if (n !== liveMd) { liveMd = n; if (state.ready) renderScenes(); }
    });
    const changed = () => {
      applyTheme(); renderScenes();
      const top = ctx.top;
      if (top && top.onConfig) top.onConfig(ctx);
    };
    window.api.onConfig(changed);
    window.api.onConfigPatch(changed);
    // Tam ekrandayken sahneye dokunmak arayüzü geri getirir
    document.addEventListener('pointerup', () => { if (state.fullscreen) setFullscreen(false); }, true);
    // Tempo çipi saniyede dört kez; arayüz gizliyken yazılmaz
    setInterval(() => {
      if (!root || root.classList.contains('hidden') || !window.SVMobileVJ) return;
      const b = Math.round(window.SVMobileVJ.tempo().bpm || 0);
      refs.bpmChip.hidden = !b;
      const t = String(b);
      if (b && refs.bpmValue.textContent !== t) refs.bpmValue.textContent = t;
    }, 250);
    // Sahne kutularının resimleri küçük resim dizini gelince
    if (window.SVShellLayers) window.SVShellLayers.thumbsReady().then(() => { if (state.ready) renderScenes(); });
    S.config.ready().then(() => {
      applyTheme(); renderScenes(); renderSource();
      state.ready = true;
      updateVisibility();
    });
  }

  window.SVShell = Object.freeze({
    /** Bir sekmenin kök sayfası: render(body, ctx) işlevi ya da { title, render, actions, onConfig }. */
    tab(id, page) { renderers[id] = page; if (state.tab === id && refs.sheet) openTab(id); },
    open: (id) => openTab(id),
    close: closeSheet,
    back,
    state: () => Object.assign({}, state, { sheet: !!refs.sheet, depth: stack.length }),
    /** Ortak yardımcılar: sekme dosyaları aynı DOM ve simge yolunu kullansın. */
    h,
    icon,
    A,
    confirm: confirmBox,
    countLabel,
    /** Kayıtlı sahneyi kimliğiyle çağırır (Otomatik VJ, Kitaplık). true: bulundu. */
    recallScene(id) {
      const sc = scenes().find((s) => s && String(s.id) === String(id));
      if (!sc) return false;
      recallScene(sc);
      return true;
    },
    /** Sekme dışı bir sayfa açar (ör. Görüntüleme): alt gezinmede Sahne seçili kalır. */
    openPage(page) { openSheetWith(page); },
    fullscreen: (on) => setFullscreen(on),
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
