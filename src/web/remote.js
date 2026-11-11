/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* UZAKTAN KUMANDA (#443).

   Beş sayfa: Canlı (çıkış, karartma, ana opaklık, sahne, A/B, zaman çizelgesi), Sahneler,
   Katmanlar, Görsel (modlar, renkler, Studio presetleri) ve Ses.

   KOMUTLAR dört tür, hepsi ana süreçte doğrulanır (main.js applyRemoteCommand):
     scene / set   — eskiden beri: sahne kimliği ve dar bir izinli yol listesi;
     osc           — SABİT DENETİM AĞACI (shared/osc-tree.js). OSC, MQTT ve Companion ile aynı
                     adresler ve aynı aralıklar: ana opaklık, A/B, otomatik VJ, katman opaklığı…
                     Kumanda için ayrı bir yazma yolu yok; ağaç neyi kabul ediyorsa o;
     run           — panelin adlandırılmış eylemleri (sonraki preset, çizelgeyi oynat…), kısa
                     bir izinli listeden.
   Sayfa yapılandırmayı yazmaz; gönderir ve uygulamadan dönen ayarı gösterir. İleride telefon
   uygulaması ve sahne/sunum araçları aynı iletileri kullanır.

   DURUM iki yoldan gelir: yapılandırma (config / config-patch) ve saniyede birkaç kez gelen
   canlı özet (`live`: seviye, tempo, çizelge, karartma). */
(function () {
  const R = window.SVRemote;
  const $ = (id) => document.getElementById(id);
  const tr = (s) => (window.SVI18n && typeof window.SVI18n.t === 'function' ? window.SVI18n.t(s) : s);
  // Düğme ikonları masaüstüyle aynı setten (#665)
  if (window.SVIcons) window.SVIcons.hydrate(document);
  let cfg = null;
  let presets = [];
  let live = {};
  let selectedSceneId = null;

  /* Mod listeleri masaüstüyle aynı kaynaktan (shared/mode-catalog.js, #638);
     buradaki kopya on beşten fazla modu hiç göstermiyordu. */
  const MC = window.SVModeCatalog;
  const VIS_MODES = MC.VISUALIZERS.map((m) => [m.id, m.label]);
  const BG_MODES = MC.BACKGROUNDS.map((m) => [m.id, m.label]);

  /* Yerleşik renk şablonları masaüstüyle AYNI kaynaktan (shared/defaults.js)
     okunur; burada ikinci bir kopya tutmak, şablon eklendiğinde telefonun
     listesinin sessizce eskimesi demekti. */
  const BUILTIN_PALETTES = ((window.SV && window.SV.GRADIENT_PRESETS) || []).map((p) => [p.name, p.colors]);

  function h(tag, props, kids) {
    const e = document.createElement(tag);
    for (const k in (props || {})) {
      const v = props[k];
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'icon') { if (window.SVIcons) e.appendChild(window.SVIcons.el(v)); }
      else if (k.indexOf('on') === 0 && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    (kids || []).forEach((c) => c && e.appendChild(c));
    return e;
  }

  // --------------------------------------------------------------------------
  // Gönderim
  // --------------------------------------------------------------------------
  function send(action, payload) {
    R.send(Object.assign({ type: 'command', action }, payload || {}));
  }
  function setPath(path, value) {
    send('set', { path, value });
  }
  // Sabit denetim ağacı: adres önek olmadan (show/opacity, layer/2/enabled…)
  function tree(path) {
    send('osc', { path, args: Array.prototype.slice.call(arguments, 1) });
  }
  function run(id) {
    send('run', { id });
  }
  function getPath(o, p) {
    return p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  }
  /* Parmak saniyede yüzlerce olay üretir; ileti kare başına en çok bir kez gider. */
  const queued = new Map();
  let frame = 0;
  function later(key, fn) {
    queued.set(key, fn);
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const list = Array.from(queued.values());
      queued.clear();
      list.forEach((f) => f());
    });
  }

  // --------------------------------------------------------------------------
  // Kitaplık listeleri — hepsi aynı "sıra" mantığını paylaşır
  // --------------------------------------------------------------------------
  function scenes() {
    return (cfg && cfg.scenes) || [];
  }
  function palettes() {
    return BUILTIN_PALETTES.concat(((cfg && cfg.userPresets) || []).map((p) => [p.name || 'Şablonum', p.colors]));
  }
  function studioPresets() {
    // Yalnızca shader presetleri: varyasyonlar sahne olarak zaten uygulanabiliyor
    return presets.filter((p) => p && p.engine === 'shader');
  }
  function currentColors() {
    return (cfg && cfg.background && cfg.background.gradient && cfg.background.gradient.colors) || [];
  }
  function sameColors(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (String(a[i]).toLowerCase() !== String(b[i]).toLowerCase()) return false;
    }
    return true;
  }
  function activePaletteIndex() {
    return palettes().findIndex(([, colors]) => sameColors(colors, currentColors()));
  }

  /* Sahnenin şu an uygulanmış olup olmadığı: sahne verisi arkaplan türü,
     görselleştirici türü ve renkleri saklar. Üçü de tutuyorsa o sahnedeyiz. */
  function sceneMatches(s) {
    const d = (s && s.data) || {};
    if (!cfg) return false;
    if (d.layerStack && d.layerStack.enabled) {
      if (!cfg.layerStack || !cfg.layerStack.enabled) return false;
      const dl = Array.isArray(d.layers) ? d.layers : [];
      const cl = Array.isArray(cfg.layers) ? cfg.layers : [];
      if (dl.length !== cl.length) return false;
      return dl.every((l, i) => l.kind === cl[i].kind && l.type === cl[i].type && l.enabled === cl[i].enabled);
    }
    if (!d.background || !d.visualizer) return false;
    if (d.background.type !== cfg.background.type) return false;
    if (d.visualizer.type !== cfg.visualizer.type) return false;
    const sc = d.background.gradient && d.background.gradient.colors;
    return !sc || sameColors(sc, currentColors());
  }
  function activeSceneIndex() {
    if (selectedSceneId) {
      const idx = scenes().findIndex((s) => s.id === selectedSceneId);
      if (idx !== -1) return idx;
    }
    if (cfg && cfg._activeSceneId) {
      const idx = scenes().findIndex((s) => s.id === cfg._activeSceneId);
      if (idx !== -1) return idx;
    }
    return scenes().findIndex(sceneMatches);
  }

  /* Ekranda görünen tür ve değer. Yığın açıkken klasik `visualizer.type`
     bilerek 'none'; kumanda onu okuyunca hiçbir modu işaretlemiyordu.
     Kural layers.js'te tek yerde (currentType / effectivePath). */
  function shownType(c, section) {
    const L = window.SVLayers;
    if (L && L.currentType) return L.currentType(c, section);
    return c && c[section] ? c[section].type : null;
  }
  function shownValue(c, path) {
    const L = window.SVLayers;
    return getPath(c, L && L.effectivePath ? L.effectivePath(c, path) : path);
  }
  function activeStudioIndex() {
    if (!cfg) return -1;
    const id = shownType(cfg, 'visualizer') === 'custom' ? cfg.custom && cfg.custom.visualizerId
      : shownType(cfg, 'background') === 'custom' ? cfg.custom && cfg.custom.backgroundId
        : null;
    return id ? studioPresets().findIndex((p) => p.id === id) : -1;
  }

  // --------------------------------------------------------------------------
  // Uygulama eylemleri
  // --------------------------------------------------------------------------
  function applyScene(i) {
    const list = scenes();
    if (!list.length) return;
    const s = list[((i % list.length) + list.length) % list.length];
    selectedSceneId = s.id;
    if (cfg) cfg._activeSceneId = s.id;
    renderScenes();
    send('scene', { id: s.id });
  }
  function applyStudio(i) {
    const list = studioPresets();
    if (!list.length) return;
    const p = list[((i % list.length) + list.length) % list.length];
    if (p.kind === 'background') {
      setPath('custom.backgroundId', p.id);
      setPath('background.type', 'custom');
    } else {
      setPath('custom.visualizerId', p.id);
      setPath('visualizer.type', 'custom');
    }
  }
  /* ◀ ▶ düğmeleri: seçili öğeden bir sonrakine/öncekine geç. Hiçbiri seçili değilken
     ▶ listenin başından, ◀ sonundan başlar — aradan rastgele bir yere atlamak yerine. */
  function step(index, dir, len) {
    if (index < 0) return dir > 0 ? 0 : len - 1;
    return index + dir;
  }
  document.querySelectorAll('[data-step]').forEach((btn) => {
    const [what, dirStr] = btn.dataset.step.split(':');
    const dir = parseInt(dirStr, 10);
    btn.addEventListener('click', () => {
      if (what === 'scene') applyScene(step(activeSceneIndex(), dir, scenes().length));
    });
  });
  document.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', () => run(b.dataset.run)));
  document.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => send(b.dataset.action)));

  // --------------------------------------------------------------------------
  // Sayfalar
  // --------------------------------------------------------------------------
  const PAGES = ['Live', 'Scenes', 'Layers', 'Look', 'Audio'];
  function remember(key, v) { try { localStorage.setItem('sv-remote-' + key, v); } catch (e) { /* özel pencere */ } }
  function recall(key, def) { try { return localStorage.getItem('sv-remote-' + key) || def; } catch (e) { return def; } }
  function setPage(name) {
    const page = PAGES.indexOf(name) >= 0 ? name : 'Live';
    PAGES.forEach((p) => {
      $('page' + p).classList.toggle('on', p === page);
      const b = $('nav' + p);
      b.classList.toggle('on', p === page);
      if (p === page) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    remember('page', page);
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.nav [data-page]').forEach((b) => b.addEventListener('click', () => setPage(b.dataset.page)));

  let look = recall('look', 'vis');
  function setLook(name) {
    look = ['vis', 'bg', 'pal', 'studio'].indexOf(name) >= 0 ? name : 'vis';
    if (look === 'studio' && !studioPresets().length) look = 'vis';
    document.querySelectorAll('#lookTabs [data-look]').forEach((b) => {
      const on = b.dataset.look === look;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('[data-look-body]').forEach((n) => { n.hidden = n.dataset.lookBody !== look; });
    remember('look', look);
    filterLook();
  }
  document.querySelectorAll('#lookTabs [data-look]').forEach((b) => b.addEventListener('click', () => setLook(b.dataset.look)));

  // Arama: görünen adın (çevrilmiş) içinde, büyük-küçük harf ayırmadan
  function matches(node, q) {
    return !q || (node.textContent || '').toLocaleLowerCase().indexOf(q) >= 0;
  }
  function filterLook() {
    const q = $('lookSearch').value.trim().toLocaleLowerCase();
    document.querySelectorAll('[data-look-body]:not([hidden]) > *').forEach((n) => { n.hidden = !matches(n, q); });
  }
  $('lookSearch').addEventListener('input', filterLook);
  $('sceneSearch').addEventListener('input', () => renderScenes());

  // --------------------------------------------------------------------------
  // Çizim
  // --------------------------------------------------------------------------
  function gradient(colors) {
    const c = (Array.isArray(colors) ? colors : []).filter((x) => typeof x === 'string' && x);
    if (!c.length) return '';
    return 'linear-gradient(135deg, ' + (c.length === 1 ? c[0] + ', ' + c[0] : c.join(', ')) + ')';
  }
  // Sahnenin renkleri: arkaplan geçişi; yığında ilk renkli katman
  function sceneColors(s) {
    const d = (s && s.data) || {};
    const own = d.background && d.background.gradient && d.background.gradient.colors;
    if (Array.isArray(own) && own.length) return own;
    for (const l of (Array.isArray(d.layers) ? d.layers : [])) {
      const st = l && l.settings;
      const c = st && ((st.background && st.background.gradient && st.background.gradient.colors) || (st.visualizer && st.visualizer.colors));
      if (Array.isArray(c) && c.length) return c;
    }
    return [];
  }

  /* Mod küçük resmi uygulamanın ürettiği dosyadan (ana süreç anahtarı kendisi hesaplar);
     gelmezse karo düz zeminde, adıyla kalır. */
  function modeTile(kind, value, label, path) {
    // 'none' ve düz renk çizilmiyor: resimleri yok
    const img = value === 'none' || value === 'solid' ? null
      : h('img', { alt: '', loading: 'lazy', decoding: 'async', src: '/mode-thumb?kind=' + kind + '&type=' + encodeURIComponent(value) });
    if (img) img.addEventListener('error', () => img.remove());
    const b = h('button', { class: 'tile', type: 'button' }, [h('span', { class: 'pic' }, [img]), h('span', { class: 'nm', text: label })]);
    b.dataset.value = value;
    b.addEventListener('click', () => setPath(path, value));
    return b;
  }
  function buildGrid(host, items, path, kind) {
    host.textContent = '';
    for (const [value, label] of items) host.appendChild(modeTile(kind, value, label, path));
  }
  function markActive(host, value) {
    host.querySelectorAll('button').forEach((b) => {
      const on = b.dataset.value === value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function renderScenes() {
    const host = $('scenes');
    const list = scenes();
    const active = activeSceneIndex();
    const count = $('sceneCount');
    count.textContent = '';
    if (list.length) { count.appendChild(document.createTextNode(list.length + ' ')); count.appendChild(h('span', { text: 'kayıtlı' })); }
    const now = $('sceneNow');
    now.textContent = active >= 0 ? (list[active].name || '') : '—';
    const sub = $('sceneSub');
    sub.textContent = '';
    if (!list.length) sub.appendChild(h('span', { text: 'sahne yok' }));
    else sub.textContent = active >= 0 ? (active + 1) + ' / ' + list.length : String(list.length);

    const q = $('sceneSearch').value.trim().toLocaleLowerCase();
    host.textContent = '';
    $('scenesEmpty').hidden = list.length > 0;
    list.forEach((s, i) => {
      const name = s.name || '';
      if (q && name.toLocaleLowerCase().indexOf(q) < 0) return;
      const pic = h('span', { class: 'pic' });
      const g = gradient(sceneColors(s));
      if (g) pic.style.backgroundImage = g;
      const b = h('button', { class: 'tile' + (i === active ? ' on' : ''), type: 'button', 'aria-pressed': i === active ? 'true' : 'false' }, [
        pic, h('span', { class: 'no', text: String(i + 1), 'aria-hidden': 'true' }),
        name ? h('span', { class: 'nm', text: name, 'data-user-text': true }) : h('span', { class: 'nm', text: 'Sahne' }),
      ]);
      b.addEventListener('click', () => applyScene(i));
      host.appendChild(b);
    });
  }

  function renderPalettes() {
    const host = $('palettes');
    const list = palettes();
    const active = activePaletteIndex();
    host.textContent = '';
    list.forEach(([name, colors], i) => {
      const pic = h('span', { class: 'pic' });
      pic.style.backgroundImage = gradient(colors);
      const b = h('button', { class: 'tile pal' + (i === active ? ' on' : ''), type: 'button', title: name, 'aria-pressed': i === active ? 'true' : 'false' }, [pic, h('span', { class: 'nm', text: name })]);
      b.addEventListener('click', () => setPath('background.gradient.colors', colors));
      host.appendChild(b);
    });
  }

  function renderStudio() {
    const list = studioPresets();
    $('lookStudioTab').hidden = list.length === 0;
    const host = $('studioPresets');
    host.textContent = '';
    const active = activeStudioIndex();
    list.forEach((p, i) => {
      const b = h('button', { class: 'item' + (i === active ? ' on' : ''), type: 'button', 'aria-pressed': i === active ? 'true' : 'false' }, [
        h('b', { text: p.name, 'data-user-text': true }),
        h('small', { text: p.kind === 'background' ? 'Arkaplan' : 'Görselleştirici' }),
      ]);
      b.addEventListener('click', () => applyStudio(i));
      host.appendChild(b);
    });
    if (look === 'studio' && !list.length) setLook('vis');
  }

  // Katmanlar: yapı değişince liste yeniden kurulur, değerler yerinde yenilenir (sürüklenen kaydırıcı kopmasın)
  const LAYER_ICONS = { background: 'background', visualizer: 'bars', logo: 'image', nowplaying: 'music', input: 'video', web: 'globe', media: 'film' };
  let layerSig = '';
  let layerRows = [];
  function layerLabel(l) {
    if (l.kind === 'visualizer' || l.kind === 'background') {
      const label = MC.label ? MC.label(l.kind, l.type) : '';
      return label || l.type || '';
    }
    return '';
  }
  function renderLayers() {
    const host = $('layers');
    const on = !!(cfg && cfg.layerStack && cfg.layerStack.enabled && Array.isArray(cfg.layers) && cfg.layers.length);
    const list = on ? cfg.layers : [];
    $('layersEmpty').hidden = list.length > 0;
    $('layerCount').textContent = list.length ? String(list.length) : '';
    const sig = list.map((l) => [l.id, l.kind, l.type, l.name].join(':')).join('|');
    if (sig !== layerSig) {
      layerSig = sig;
      host.textContent = '';
      layerRows = [];
      // Öndeki katman listede üstte (paneldeki sıra); adres katmanın yığındaki sırası
      for (let i = list.length - 1; i >= 0; i--) {
        const l = list[i];
        const n = i + 1;
        const sw = h('input', { type: 'checkbox', 'aria-label': 'Katmanı göster' });
        const range = h('input', { type: 'range', min: '0', max: '1', step: '0.01', 'aria-label': 'Opaklık' });
        const out = h('output');
        const mode = layerLabel(l);
        const row = h('div', { class: 'layer' }, [
          h('div', { class: 'layer-h' }, [
            h('span', { class: 'layer-i', icon: LAYER_ICONS[l.kind] || 'layers', 'aria-hidden': 'true' }),
            h('div', { class: 'layer-n' }, [
              l.name ? h('b', { text: l.name, 'data-user-text': true }) : h('b', { text: mode || 'Katman' }),
              l.name && mode ? h('small', { text: mode }) : null,
            ]),
            out,
            h('label', { class: 'sw' }, [sw, h('i')]),
          ]),
          range,
        ]);
        sw.addEventListener('change', () => { row.classList.toggle('off', !sw.checked); tree('layer/' + n + '/enabled', sw.checked ? 1 : 0); });
        hold(range);
        range.addEventListener('input', () => {
          const v = +range.value;
          out.textContent = Math.round(v * 100) + '%';
          paint(range);
          later('layer' + n, () => tree('layer/' + n + '/opacity', v));
        });
        host.appendChild(row);
        layerRows.push({ i, row, sw, range, out });
      }
    }
    for (const r of layerRows) {
      const l = list[r.i];
      if (!l) continue;
      const enabled = l.enabled !== false;
      r.sw.checked = enabled;
      r.row.classList.toggle('off', !enabled);
      const v = Number.isFinite(Number(l.opacity)) ? Number(l.opacity) : 1;
      if (!r.range.dataset.hold) { r.range.value = String(v); paint(r.range); r.out.textContent = Math.round(v * 100) + '%'; }
    }
  }

  // --------------------------------------------------------------------------
  // Kaydırıcılar
  // --------------------------------------------------------------------------
  // İzin dolgusu: tarayıcıda izin parçası için özellik yok, yüzde değişkende
  function paint(r) {
    const min = Number(r.min) || 0;
    const max = r.max === '' ? 100 : Number(r.max);
    r.style.setProperty('--p', (max > min ? ((Number(r.value) - min) / (max - min)) * 100 : 0) + '%');
  }
  /* Parmak kaydırıcıdayken uygulamadan dönen (bir kare eski) değer kaydırıcıyı geri çekmesin. */
  function hold(r) {
    const on = () => { r.dataset.hold = '1'; };
    const off = () => { setTimeout(() => { delete r.dataset.hold; }, 250); };
    r.addEventListener('pointerdown', on);
    r.addEventListener('pointerup', off);
    r.addEventListener('pointercancel', off);
    r.addEventListener('change', off);
  }
  function bindSlider(id, outId, fmt, read, write) {
    const el = $(id);
    const out = $(outId);
    hold(el);
    el.addEventListener('input', () => {
      const v = +el.value;
      out.textContent = fmt(v);
      paint(el);
      later(id, () => write(v));
    });
    return { el, out, fmt, read };
  }
  const pct = (v) => Math.round(v * 100) + '%';
  const sliders = [
    bindSlider('sens', 'vSens', (v) => v.toFixed(2), (c) => shownValue(c, 'audio.sensitivity'), (v) => setPath('audio.sensitivity', v)),
    bindSlider('smooth', 'vSmooth', pct, (c) => shownValue(c, 'audio.smoothing'), (v) => setPath('audio.smoothing', v)),
    bindSlider('bass', 'vBass', (v) => v.toFixed(2), (c) => shownValue(c, 'audio.bassBoost'), (v) => setPath('audio.bassBoost', v)),
    bindSlider('glow', 'vGlow', pct, (c) => shownValue(c, 'visualizer.glow'), (v) => setPath('visualizer.glow', v)),
    bindSlider('master', 'vMaster', pct, (c) => (Number.isFinite(Number(c.master)) ? Number(c.master) : 1), (v) => tree('show/opacity', v)),
    bindSlider('xfade', 'vXf', (v) => (v <= 0.005 ? 'A' : v >= 0.995 ? 'B' : Math.round(v * 100) + '%'),
      (c) => (c.crossfade && Number.isFinite(Number(c.crossfade.value)) ? Number(c.crossfade.value) : 0), (v) => tree('crossfade', v)),
  ];
  $('autovj').addEventListener('change', (e) => tree('show/autovj', e.target.checked ? 1 : 0));

  /* Karartma: yayında "panik" düğmesi — sahneyi kapatmadan karartır. Karartmanın tek
     uygulaması panelde, geri yükleme durumu da orada; düğmenin görünümü gelen
     yapılandırmadan okunuyor (bkz. syncFromConfig). */
  $('blackoutBtn').addEventListener('click', () => {
    if (!cfg) return;
    send('blackout');
  });
  $('tlPlay').addEventListener('click', () => run(live.timeline ? 'tlPause' : 'tlPlay'));

  // --------------------------------------------------------------------------
  // Durum senkronu
  // --------------------------------------------------------------------------
  // Panelin arayüz teması: aynı tablo, aynı seçim (cihaz varsayılanı burada da cihazı izler)
  function applyTheme(c) {
    const T = window.SVUiThemes;
    if (!T || !T.apply) return;
    const mq = (q) => (typeof window.matchMedia === 'function' ? window.matchMedia(q).matches : false);
    try {
      T.apply(document, T.normalizeId(c && c.ui && c.ui.theme), mq('(prefers-color-scheme: dark)') || typeof window.matchMedia !== 'function', mq('(prefers-contrast: more), (forced-colors: active)'));
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      if (bg) $('themeColor').setAttribute('content', bg);
    } catch (e) { /* tema tablosu yoksa ilk çizimin renkleri kalır */ }
  }

  function setBlackout(on) {
    const b = $('blackoutBtn');
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    document.documentElement.toggleAttribute('data-blackout', on);
  }

  function syncFromConfig(c) {
    cfg = c;
    if (c && c._activeSceneId) {
      selectedSceneId = c._activeSceneId;
    }
    applyTheme(c);
    // Karartma durumu paneldedir; düğme onu yansıtır
    setBlackout(c.isBlackout === true);
    markActive($('visModes'), shownType(c, 'visualizer'));
    markActive($('bgModes'), shownType(c, 'background'));
    renderScenes();
    renderPalettes();
    renderStudio();
    renderLayers();
    for (const s of sliders) {
      const v = s.read(c);
      if (v == null || s.el.dataset.hold) continue;
      s.el.value = v;
      paint(s.el);
      s.out.textContent = s.fmt(+v);
    }
    $('autovj').checked = !!(c.autovj && c.autovj.enabled);
    // Sayfanın arkasındaki ışık sahnenin renklerinden
    const cols = currentColors();
    const amb = $('ambient');
    if (cols[0]) amb.style.setProperty('--amb-a', cols[0]); else amb.style.removeProperty('--amb-a');
    if (cols[1] || cols[0]) amb.style.setProperty('--amb-b', cols[1] || cols[0]); else amb.style.removeProperty('--amb-b');
    // MilkDrop çizerken preset adımlayıcısı
    const md = shownType(c, 'visualizer') === 'milkdrop';
    $('mdCard').hidden = !md;
    if (md) $('mdNow').textContent = (c.milkdrop && c.milkdrop.name) || '—';
    // "Bağlı" ve mod adı ayrı düğümlerde: birleşik metin çevrilemezdi
    const st = $('statusText');
    st.textContent = '';
    st.appendChild(h('span', { text: 'Bağlı' }));
    const shown = shownType(c, 'visualizer');
    const label = VIS_MODES.find(([v]) => v === shown);
    const mode = $('modeNow');
    mode.textContent = '';
    mode.appendChild(h('span', { text: label ? label[1] : (shown || '') }));
    filterLook();
  }

  function updateNowPlaying(st) {
    const has = !!(st && st.has && st.title);
    $('nowTitle').textContent = has ? st.title : '—';
    const sub = $('nowSub');
    sub.textContent = '';
    if (has) sub.textContent = [st.artist, st.album].filter(Boolean).join(' · ') || (st.app ? st.app.replace(/\.exe$/i, '') : '');
    else sub.appendChild(h('span', { text: 'Çalan parça yok' }));
    const art = $('nowArt');
    const showArt = has && !!st.artwork;
    if (showArt) art.src = st.artwork; else art.removeAttribute('src');
    art.hidden = !showArt;
    $('nowArtNone').hidden = showArt;
  }

  function updateLive(s) {
    live = s || {};
    const bar = (id, v) => { $(id).style.width = Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100) + '%'; };
    bar('mBass', live.bass);
    bar('mMid', live.mid);
    bar('mTreble', live.treble);
    const bpm = Number(live.bpm);
    $('bpmBox').hidden = !(bpm > 0);
    if (bpm > 0) $('bpmVal').textContent = String(Math.round(bpm));
    const playing = live.timeline === true;
    const b = $('tlPlay');
    if (b.dataset.playing !== String(playing)) {
      b.dataset.playing = String(playing);
      b.textContent = '';
      if (window.SVIcons) b.appendChild(window.SVIcons.el(playing ? 'pause' : 'play'));
      b.appendChild(h('span', { text: playing ? 'Duraklat' : 'Oynat' }));
      b.classList.toggle('on', playing);
      const st = $('tlState');
      st.textContent = '';
      if (playing) st.appendChild(h('span', { text: 'oynuyor' }));
    }
    if (typeof live.blackout === 'boolean' && cfg) setBlackout(live.blackout);
  }

  buildGrid($('visModes'), VIS_MODES, 'visualizer.type', 'vis');
  buildGrid($('bgModes'), BG_MODES, 'background.type', 'bg');
  document.querySelectorAll('input[type=range]').forEach(paint);
  setPage(recall('page', 'Live'));
  setLook(look);
  updateNowPlaying(null);

  if (R && typeof R.onNowPlaying === 'function') {
    R.onNowPlaying((st) => updateNowPlaying(st));
  }
  if (R && typeof R.onLive === 'function') R.onLive(updateLive);

  R.ready.then(syncFromConfig);
  R.onConfig(syncFromConfig);
  R.presetsReady.then((list) => { presets = list || []; renderStudio(); });
  R.onPresets((list) => { presets = list || []; renderStudio(); });
})();
