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
  /* Metin sorma (window.prompt yerine; o da yerel pencere). Ad girme gibi kısa metinler.
     Promise<metin | null>; boş metin null. */
  function promptBox(title, value, okText) {
    return new Promise((resolve) => {
      const cancel = () => done(null);
      const done = (v) => {
        const i = dialogs.indexOf(cancel);
        if (i >= 0) dialogs.splice(i, 1);
        box.remove();
        resolve(v == null ? null : (String(v).trim() || null));
      };
      const input = h('input', { type: 'text', class: 'field', 'aria-label': title || '', maxlength: '80', value: value || '' });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value); });
      const box = h('div', { class: 'dialog-scrim live', role: 'presentation', onclick: (e) => { if (e.target === box) done(null); } }, [
        h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '' }, [
          title ? h('div', { class: 'dialog-text', text: title }) : null,
          input,
          h('div', { class: 'btn-row' }, [
            h('button', { class: 'btn ghost', text: 'Vazgeç', onclick: () => done(null) }),
            h('button', { class: 'btn primary', text: okText || 'Tamam', onclick: () => done(input.value) }),
          ]),
        ]),
      ]);
      dialogs.push(cancel);
      root.appendChild(box);
      input.focus();
      input.select();
    });
  }

  /* Seçenek listesi (açılır seçim kutusu yerine). WebView uygulama bağlamıyla kuruluyor
     (yüzen pencere için Activity dışında); bu yüzden <select> için Android seçicisi
     hiç açılmıyordu (ölçüldü: dokununca kutu odaklanıyor, pencere gelmiyor). Liste kabuğun
     içinde: geri tuşu ve dışına dokunma kapatır. Promise<seçilen değer | null>. */
  function chooseBox(title, options, value) {
    return new Promise((resolve) => {
      const cancel = () => done(null);
      const done = (v) => {
        const i = dialogs.indexOf(cancel);
        if (i >= 0) dialogs.splice(i, 1);
        box.remove();
        resolve(v);
      };
      let current = null;
      const items = (options || []).map(([v, t]) => {
        const on = String(v) === String(value);
        const b = h('button', { class: 'choice' + (on ? ' on' : ''), role: 'option', 'aria-selected': on ? 'true' : 'false', 'data-v': String(v), onclick: () => done(String(v)) }, [
          h('span', { class: 'grow-text', text: t }),
          on ? icon('check') : null,
        ]);
        if (on) current = b;
        return b;
      });
      const list = h('div', { class: 'choice-list', role: 'listbox', 'aria-label': title || '' }, items);
      const box = h('div', { class: 'dialog-scrim live', role: 'presentation', onclick: (e) => { if (e.target === box) done(null); } }, [
        h('div', { class: 'dialog choose', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '' }, [
          title ? h('div', { class: 'dialog-text', text: title }) : null,
          list,
        ]),
      ]);
      dialogs.push(cancel);
      root.appendChild(box);
      if (current) { current.scrollIntoView({ block: 'center' }); current.focus(); }
    });
  }
  /* Renk seçici (input type=color yerine; o da Android penceresini açamıyordu).
     Ton, doygunluk ve parlaklık kaydırıcıları, renk kodu ve hazır renkler (masaüstünün
     renk şablonlarından). Sürüklerken onLive canlı uygular; Vazgeç ilk rengi geri koyar.
     Promise<'#rrggbb' | null>. */
  const hexRe = /^#?([0-9a-f]{6})$/i;
  function hexToHsv(hex) {
    const m = hexRe.exec(String(hex || '').trim());
    const n = m ? parseInt(m[1], 16) : 0xffffff;
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
    let hh = 0;
    if (d) hh = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: (hh * 60 + 360) % 360, s: max ? d / max : 0, v: max };
  }
  function hsvToHex(c) {
    const f = (k) => { const x = (k + c.h / 60) % 6; return c.v - c.v * c.s * Math.max(0, Math.min(x, 4 - x, 1)); };
    return '#' + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
  }
  function quickColors() {
    const out = [];
    for (const p of (window.SV && window.SV.GRADIENT_PRESETS) || []) {
      for (const c of (p && p.colors) || []) {
        const k = String(c).toLowerCase();
        if (hexRe.test(k) && out.indexOf(k) < 0) out.push(k);
        if (out.length >= 24) return out;
      }
    }
    return out;
  }
  function colorBox(title, value, onLive) {
    return new Promise((resolve) => {
      const first = hexRe.test(String(value || '')) ? ('#' + hexRe.exec(value)[1]).toLowerCase() : '#ffffff';
      const c = hexToHsv(first);
      const cancel = () => done(null);
      const done = (v) => {
        const i = dialogs.indexOf(cancel);
        if (i >= 0) dialogs.splice(i, 1);
        box.remove();
        if (v == null && onLive && hsvToHex(c) !== first) onLive(first);
        resolve(v);
      };
      const preview = h('div', { class: 'color-preview', 'aria-hidden': 'true' });
      const code = h('input', { type: 'text', class: 'field mono', 'aria-label': 'Renk', maxlength: '7', spellcheck: 'false', autocapitalize: 'off' });
      const mk = (label, max, key, scale) => {
        const input = h('input', { type: 'range', min: '0', max: String(max), step: '1', 'aria-label': label });
        input.addEventListener('input', () => { c[key] = +input.value / scale; paint(true); });
        return { input, scale, key, row: h('div', { class: 'ctl-row col' }, [h('div', { class: 'ctl-label', text: label }), input]) };
      };
      const sliders = [mk('Renk Tonu', 360, 'h', 1), mk('Doygunluk', 100, 's', 100), mk('Parlaklık', 100, 'v', 100)];
      sliders[0].input.style.setProperty('--track', 'linear-gradient(90deg, ' + [0, 60, 120, 180, 240, 300, 360].map((x) => hsvToHex({ h: x % 360, s: 1, v: 1 })).join(', ') + ')');
      function paint(live, fromCode) {
        const hex = hsvToHex(c);
        preview.style.background = hex;
        if (!fromCode) code.value = hex;
        for (const s of sliders) {
          s.input.value = String(Math.round(c[s.key] * s.scale));
          s.input.style.setProperty('--p', (c[s.key] * s.scale / (+s.input.max) * 100) + '%');
        }
        // İzlerin renkleri seçilen renkten (CSS'te renk değeri yok, değişkenle)
        sliders[1].input.style.setProperty('--track', 'linear-gradient(90deg, ' + hsvToHex({ h: c.h, s: 0, v: c.v }) + ', ' + hsvToHex({ h: c.h, s: 1, v: c.v }) + ')');
        sliders[2].input.style.setProperty('--track', 'linear-gradient(90deg, ' + hsvToHex({ h: 0, s: 0, v: 0 }) + ', ' + hsvToHex({ h: c.h, s: c.s, v: 1 }) + ')');
        if (live && onLive) onLive(hex);
      }
      code.addEventListener('input', () => {
        if (!hexRe.test(code.value.trim())) return;
        Object.assign(c, hexToHsv(code.value));
        paint(true, true);
      });
      const swatches = quickColors().map((hex) => h('button', {
        class: 'qcolor', 'aria-label': hex, style: 'background:' + hex,
        onclick: () => { Object.assign(c, hexToHsv(hex)); paint(true); },
      }));
      const box = h('div', { class: 'dialog-scrim live', role: 'presentation', onclick: (e) => { if (e.target === box) done(null); } }, [
        h('div', { class: 'dialog color-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Renk' }, [
          title ? h('div', { class: 'dialog-text', text: title }) : null,
          h('div', { class: 'color-head' }, [preview, code]),
        ].concat(sliders.map((s) => s.row), swatches.length ? [
          h('div', { class: 'section-label', text: 'Hazır renkler' }),
          h('div', { class: 'qcolors' }, swatches),
        ] : [], [
          h('div', { class: 'btn-row' }, [
            h('button', { class: 'btn ghost', text: 'Vazgeç', onclick: () => done(null) }),
            h('button', { class: 'btn primary', text: 'Tamam', onclick: () => done(hsvToHex(c)) }),
          ]),
        ])),
      ]);
      paint(false);
      dialogs.push(cancel);
      root.appendChild(box);
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
    grabSceneThumb(sc.id);
  }
  /* SAHNENİN KÜÇÜK RESMİ (masaüstündeki grabSceneThumb, src/admin/admin.js): sahne açılınca,
     kaydedilince ya da güncellenince sahnenin kendi görüntüsünden 240x135 bir kare. Mod
     resmi sahnenin renklerini ve katmanlarını göstermiyordu (yanlış görünüyordu). Ayara
     girmiyor: tarayıcı deposunda, sahne başına ~10 KB. Geçiş sürerken iki sahnenin karışımı
     çekilmesin diye geçiş bitene dek beklenir; sahne değiştiyse çekilmez. Kare motorun çizdiği
     animasyon karesinde alınır (WebGL tuvalleri kareden sonra temizleniyor). */
  const SCENE_THUMB = 'sv-scene-thumb:';
  function sceneShot(id) {
    try { return localStorage.getItem(SCENE_THUMB + id) || ''; } catch (e) { return ''; }
  }
  /* now: kaydedilen/güncellenen görünüm zaten ekranda, beklemeden çekilir (kutu bir an bile
     mod resmini göstermesin); sahne açılınca geçiş bitene dek beklenir. */
  function grabSceneThumb(id, tries, now) {
    setTimeout(() => {
      const c = cfg();
      if (!c || c._activeSceneId !== id) return;
      const st = window.SVStage && window.SVStage.stack ? window.SVStage.stack() : null;
      if (st && st.trans) { if ((tries || 0) < 40) grabSceneThumb(id, (tries || 0) + 1); return; }
      requestAnimationFrame(() => {
        if ((cfg() || {})._activeSceneId !== id) return;
        const stage = document.getElementById('stage');
        const list = stage ? stage.querySelectorAll('canvas') : [];
        if (!list.length) return;
        const cv = document.createElement('canvas');
        cv.width = 240;
        cv.height = 135;
        const g = cv.getContext('2d');
        g.fillStyle = '#000';
        g.fillRect(0, 0, cv.width, cv.height);
        list.forEach((n) => {
          if (!n.width || !n.height || n.style.display === 'none') return;
          // Tuval sahnenin oranında değilse ortası (telefon dik tutulunca)
          const k = Math.min(n.width / 16, n.height / 9);
          const sw = 16 * k, sh = 9 * k;
          try { g.drawImage(n, (n.width - sw) / 2, (n.height - sh) / 2, sw, sh, 0, 0, cv.width, cv.height); } catch (e) { /* henüz çizilmedi */ }
        });
        try { localStorage.setItem(SCENE_THUMB + id, cv.toDataURL('image/webp', 0.7)); } catch (e) { /* depo dolu: mod resmi kalır */ }
        // Ekrandaki bütün kutular (şerit, Kitaplık → Sahneler) hemen yeni resme geçer: sayfa
        // yeniden çizilmeden mod resmi kalıyordu (telefonda görüldü)
        paintSceneThumbs(id);
      });
    }, tries ? 400 : (now ? 30 : 1400));
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
    const shot = sc && sc.id ? sceneShot(sc.id) : '';
    if (shot) return h('div', { class: 'art img', 'aria-hidden': 'true', 'data-scene': sc.id }, [h('img', { src: shot, alt: '', decoding: 'async' })]);
    const box = sceneArtFallback(sc);
    if (sc && sc.id) box.setAttribute('data-scene', sc.id);
    return box;
  }
  /* Sahnenin karesi alınınca o sahneyi gösteren her kutu yeni resme geçer. */
  function paintSceneThumbs(id) {
    if (!root) return;
    const shot = sceneShot(id);
    if (!shot) return;
    for (const el of root.querySelectorAll('[data-scene]')) {
      if (el.getAttribute('data-scene') !== id) continue;
      const fresh = h('div', { class: 'art img', 'aria-hidden': 'true', 'data-scene': id }, [h('img', { src: shot, alt: '', decoding: 'async' })]);
      // Kitaplık kutusunda .ph sınıfı da var (boyut kuralları)
      if (el.classList.contains('ph')) fresh.classList.add('ph');
      el.replaceWith(fresh);
    }
  }
  function sceneArtFallback(sc) {
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
    /* Yeni kurulumda liste ayarda yok, motor eski alanlardan sentezliyor (layers.js resolve):
       sayı çizilen listeden; yoksa "0 katman" yazıyordu. */
    const stackOn = !!(c && c.layerStack && c.layerStack.enabled);
    const drawn = c && Array.isArray(c.layers) && (c.layers.length || stackOn) ? c.layers
      : (c && window.SVLayers && window.SVLayers.synthesize ? window.SVLayers.synthesize(c) : []);
    const n = drawn.filter((l) => l && l.enabled !== false).length;
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
    // Dışa aktar (taslak 1): şu anki sahne bir şarkıyla videoya (src/mobile/shell-export.js)
    const exportBtn = h('button', {
      class: 'iconbtn plain', 'aria-label': 'Dışa Aktar', title: 'Dışa Aktar',
      onclick: () => { if (window.SVShellExport) openSheetWith(window.SVShellExport.page()); },
    }, [icon('export')]);
    // Başlığa dokununca sahne ayarları (ad, kaydet, renk teması; src/mobile/shell-scene.js)
    const sceneOpen = h('button', { class: 'grow scene-open', onclick: () => { if (window.SVShellScene) openSheetWith(window.SVShellScene.page()); } }, [sceneTitle, sceneSub]);
    const sceneCard = h('div', { class: 'scene-card glass live' }, [sceneOpen, vj, exportBtn]);
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
    choose: chooseBox,
    prompt: promptBox,
    /** Sahnenin küçük resmi: sahneden alınan kare; yoksa en üstteki görselleştiricinin mod resmi. */
    grabSceneThumb: (id, now) => grabSceneThumb(id, 0, !!now),
    sceneArt: (sc) => sceneArt(sc),
    pickColor: colorBox,
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
