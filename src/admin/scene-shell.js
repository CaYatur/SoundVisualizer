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
  const STORE = { sel: 'sv-sel-layer', shelf: 'sv-shelf-tab', open: 'sv-shelf-open', card: 'sv-shelf-card' };
  const read = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* depo yok */ } };

  let sel = read(STORE.sel, '');
  let shelfTab = read(STORE.shelf, 'milkdrop');
  let shelfOpen = read(STORE.open, '1') !== '0';
  let query = '';
  /* KART BOYU (#957): alt kitaplık rafının bütün sekmelerindeki kart ızgaraları için tek
     ayar. Değer en küçük kart genişliği (px); ızgara `auto-fill, minmax(boy, 1fr)` ile
     satırı eşit doldurur. Ctrl+tekerlek de değiştirir. */
  const CARD_MIN = 96;
  const CARD_MAX = 320;
  const clampCard = (v) => Math.max(CARD_MIN, Math.min(CARD_MAX, Math.round(Number(v) || 146)));
  let cardSize = clampCard(read(STORE.card, '146'));
  function applyCardSize(host) {
    const box = host || document.getElementById('svShelf');
    if (box) box.style.setProperty('--sv-card', cardSize + 'px');
  }
  function setCardSize(v, host) {
    const n = clampCard(v);
    if (n === cardSize) return;
    cardSize = n;
    write(STORE.card, String(n));
    applyCardSize(host);
    const r = (host || document).querySelector('.sv-card-size input');
    if (r && Number(r.value) !== n) r.value = String(n);
    // Pencereli ızgaralar sütun sayısını yeniden ölçsün
    window.dispatchEvent(new CustomEvent('sv-cardsize', { detail: n }));
  }
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
  /* Katman işlemleri kimlikle çalışır: elde tutulan nesne eskimiş olsa da (düzenleyici yenilediyse)
     işlem listedeki güncel katmana uygulanır. Satır düğmeleri, denetçi ve sağ tık menüsü bunları paylaşır. */
  const byId = (id) => layers().find((x) => x && x.id === id) || null;
  const act = {
    rename(id, name) {
      const l = byId(id);
      const v = String(name == null ? '' : name).trim();
      if (!l || !v) return false;
      l.name = v;
      P().apply();
      return true;
    },
    remove(id) {
      const list = layers();
      const i = list.findIndex((x) => x && x.id === id);
      /* tlUnder kilitli olsa da silinebilir: çizelge alt bileşimi kalıntısı
         kullanıcının "tüm katmanları kaldır" isteğini engellemesin. */
      if (i < 0) return false;
      if (list[i].locked && !list[i].tlUnder) return false;
      list.splice(i, 1);
      if (sel === id) { sel = ''; write(STORE.sel, ''); }
      P().apply();
      return true;
    },
    duplicate(id) {
      const list = layers();
      const i = list.findIndex((x) => x && x.id === id);
      if (i < 0) return null;
      const copy = JSON.parse(JSON.stringify(list[i]));
      copy.id = null;
      copy.name = (list[i].name || list[i].kind) + ' (' + tr('kopya') + ')';
      copy.solo = false;
      copy.locked = false;
      const made = window.SVLayers.normalizeLayer(copy);
      list.splice(i + 1, 0, made);
      select(made.id, true);
      P().apply();
      return made.id;
    },
    // dir: +1 öne (listede yukarı), -1 arkaya
    move(id, dir) {
      const list = layers();
      const i = list.findIndex((x) => x && x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return false;
      const [m] = list.splice(i, 1);
      list.splice(j, 0, m);
      P().apply();
      return true;
    },
    flag(id, key) {
      const l = byId(id);
      if (!l) return false;
      if (key === 'enabled') l.enabled = l.enabled === false;
      else l[key] = !l[key];
      P().apply();
      return true;
    },
  };

  /* `quiet`: seçim yazılır, çizimi çağıran yapar (yeni katman eklenince hemen ardından apply var). */
  function select(id, quiet) {
    const next = id || '';
    /* Farklı katman/sahne seçilince denetçi kaydırması eski içeriğe ait kalmasın.
       Canlı kutuyu da sıfırla: paintInspector yeniden çizmeden önce scrollTop
       okuyor; yalnız scrollOf yazmak eski değere geri basardı. */
    if (next !== sel) {
      scrollOf.inspector = 0;
      const q = typeof document !== 'undefined' && document && typeof document.querySelector === 'function'
        ? document.querySelector('#svInspector .sv-insp') : null;
      if (q) q.scrollTop = 0;
    }
    sel = next;
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
      /* Yalnız sol tuş (#957): sağ tık satırın menüsünü açarken saydamlığı
         da tıklanan yere çekiyordu. Olay satıra gidiyor, menü açılıyor. */
      if (e.button != null && e.button !== 0) return;
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
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(l.id); }
        // Klavyeyle bağlam menüsü: Shift+F10 ya da Menü tuşu
        else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); openLayerMenu(l.id, row); }
      },
      oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); openLayerMenu(l.id, row, e.clientX, e.clientY); },
    }, [
      thumbOf(l),
      el('span', { class: 'sv-nm' }, [el('b', { text: titleOf(l) }), el('span', { text: subOf(l) })]),
      el('span', { class: 'sv-lt-acts' }, [
        toggle('solo', !!l.solo, 'S', null, 'Solo: yalnızca solo katmanlar çizilir', () => act.flag(l.id, 'solo')),
        toggle('mute', !!l.muted, 'M', null, 'Sessiz: katmanı ayarlarını kaybetmeden gizler', () => act.flag(l.id, 'muted')),
        toggle('lock', !!l.locked, '', 'lock', 'Kilit: kazara düzenlemeyi engeller', () => act.flag(l.id, 'locked')),
        toggle('vis', l.enabled === false, '', l.enabled === false ? 'eye-off' : 'eye', 'Katmanı aç/kapat', () => act.flag(l.id, 'enabled')),
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
      // Menü bir öğeyle kapandıysa dinleyiciler de gider; yoksa bir sonraki
      // Esc (ör. satır içi ad kutusunun) burada yutuluyordu (#957).
      const off = (e) => { if (!menu.isConnected || !menu.contains(e.target)) close(); };
      const esc = (e) => { if (!menu.isConnected) { close(); return; } if (e.key === 'Escape') { e.stopPropagation(); close(); } };
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

  /* Satır içi yeniden adlandırma: dolu ve seçili; Enter kaydeder, Esc ya
     da boş ad vazgeçer. Kaydetme act.rename üzerinden (kalıcı yol). */
  function startRename(id) {
    const l = byId(id);
    if (!l) return null;
    const find = () => [...document.querySelectorAll('.sv-lt')].find((r) => r.getAttribute('data-id') === id);
    if (sel !== id) select(id);
    const row = find();
    const b = row && row.querySelector('.sv-nm b');
    if (!b) return null;
    const inp = P().el('input', { class: 'txt sv-rename', type: 'text', value: titleOf(l), 'aria-label': tr('Katman adı') });
    const initial = inp.value; // değişmeyen ad kaydedilmez (çevrilmiş ad kalıcı ada yazılmasın)
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (row) row.classList.remove('sv-renaming');
      // Ad değişmese de düzenleyici HER durumda kapanır (#957): önceden
      // değişmeyen adda yeniden çizim olmuyor ve kutu açık kalıyordu.
      const ok = !!(save && inp.value !== initial && act.rename(id, inp.value));
      if (inp.isConnected) {
        if (ok) { const cur = byId(id); if (cur) b.textContent = titleOf(cur); }
        inp.replaceWith(b);
      }
      if (row && row.isConnected) row.draggable = !(byId(id) || {}).locked;
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    ['click', 'pointerdown', 'mousedown'].forEach((t) => inp.addEventListener(t, (e) => e.stopPropagation()));
    inp.addEventListener('blur', () => finish(true));
    b.replaceWith(inp);
    // Düzenlerken S / M / kilit / göz ve opaklık çubuğu gizlenir, kutu satırı doldurur (#957)
    if (row) { row.draggable = false; row.classList.add('sv-renaming'); }
    inp.focus();
    inp.select();
    return inp;
  }

  /* Katman satırının sağ tık menüsü. Satırdaki düğmelerle aynı işlemler (act). */
  function openLayerMenu(id, row, x, y) {
    const el = P().el;
    const l = byId(id);
    if (!l) return null;
    const list = layers();
    const i = list.indexOf(l);
    const item = (icon, text, fn, opts) => el('button', {
      type: 'button', role: 'menuitem', icon, text: tr(text), 'data-act': (opts && opts.key) || '',
      disabled: !!(opts && opts.disabled),
      onclick: () => { menu.remove(); fn(); if ((!opts || opts.key !== 'rename') && row && row.isConnected) row.focus(); },
    });
    /* Önce denetçideki ada odaklanıyordu; ardından satıra geri odaklanmak
       onu hemen bırakıyordu ve hiçbir şey olmuyordu (#957). Artık satırın
       içinde düzenleyici açılıyor. */
    const rename = () => startRename(id);
    const menu = el('div', { class: 'sv-menu sv-layer-menu', role: 'menu', 'aria-label': tr('Katman') }, [
      el('div', { class: 'sv-mh', text: titleOf(l) }),
      item('pencil', 'Yeniden Adlandır', rename, { key: 'rename' }),
      item('copy', 'Çoğalt', () => act.duplicate(id), { key: 'duplicate' }),
      item(l.enabled === false ? 'eye' : 'eye-off', l.enabled === false ? 'Göster' : 'Gizle', () => act.flag(id, 'enabled'), { key: 'visible' }),
      item('sparkle', l.solo ? 'Soloyu Kapat' : 'Solo', () => act.flag(id, 'solo'), { key: 'solo' }),
      item(l.muted ? 'speaker' : 'mute', l.muted ? 'Sesi Aç' : 'Sessiz', () => act.flag(id, 'muted'), { key: 'mute' }),
      item('lock', l.locked ? 'Kilidi Aç' : 'Kilitle', () => act.flag(id, 'locked'), { key: 'lock' }),
      el('hr'),
      item('arrow-up', 'Öne Taşı', () => act.move(id, 1), { key: 'up', disabled: i >= list.length - 1 }),
      item('arrow-down', 'Arkaya Taşı', () => act.move(id, -1), { key: 'down', disabled: i <= 0 }),
      el('hr'),
      item('trash', 'Kaldır', () => act.remove(id), { key: 'remove', disabled: !!l.locked }),
    ]);
    menu.addEventListener('keydown', (e) => {
      const items = [...menu.querySelectorAll('button:not([disabled])')];
      const k = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(k + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(k - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
      else if (e.key === 'Tab') { e.preventDefault(); menu.remove(); if (row) row.focus(); }
    });
    if (x == null && row) { const r = row.getBoundingClientRect(); x = r.left + 24; y = r.bottom - 4; }
    placeMenu(menu, x || 0, y || 0);
    // Esc ile kapanınca odak satıra dönsün
    menu.addEventListener('keydown', (e) => { if (e.key === 'Escape' && row) setTimeout(() => row.isConnected && row.focus(), 0); });
    const first = menu.querySelector('button:not([disabled])');
    if (first) first.focus();
    return menu;
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
    // Kilitli katmanın preseti kartın ◀ ▶ düğmesiyle de değişmiyor
    const go = (dir) => {
      if (l.locked) { if (P().toast) P().toast(tr(lockText('locked')), 'warn'); return; }
      MP.pickFor(own ? l.id : '');
      MP.act(dir);
    };
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
            onchange: (e) => { if (!act.rename(l.id, e.target.value)) e.target.value = titleOf(byId(l.id) || l); },
          }),
          el('small', { text: subOf(l) }),
        ]),
        el('button', {
          class: 'sv-ib sm', type: 'button', icon: 'x', title: tr('Kaldır'), 'aria-label': tr('Kaldır'), disabled: !!l.locked,
          onclick: () => act.remove(l.id),
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
    /* Yeniden çizimde odak kaybı kaydırmayı başa çekmesin (#sections ile aynı fikir).
       MilkDrop Rastgele/Kilitle gibi yerinde güncellemeler P().apply → paintInspector
       yolundan geçiyor; absolute scrollTop + çift rAF ile korunuyor. */
    const prevBody = host.querySelector('.sv-insp');
    if (prevBody) scrollOf.inspector = prevBody.scrollTop;
    const ae = document.activeElement;
    if (ae && prevBody && prevBody.contains(ae)) {
      try {
      if (host.tabIndex < 0) host.tabIndex = -1;
      host.focus({ preventScroll: true });
    } catch (e) { /* odak verilemez */ }
    }
    const want = scrollOf.inspector;
    host.replaceChildren(...nodes);
    const applyInspScroll = () => {
      if (!body.isConnected) return;
      const max = Math.max(0, body.scrollHeight - body.clientHeight);
      const next = Math.min(want, max);
      if (body.scrollTop !== next) body.scrollTop = next;
      scrollOf.inspector = body.scrollTop;
    };
    applyInspScroll();
    requestAnimationFrame(() => requestAnimationFrame(applyInspScroll));
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
        const th = el('span', { class: 'sv-th', icon: kind === 'bg' ? 'image' : 'bars' });
        const btn = el('button', {
          class: 'sv-gi nothumb' + (l && l.kind === want && l.type === it.id ? ' cur' : ''), type: 'button', 'data-cur': it.id,
          onclick: () => applyMode(want, it.id, it.label),
        }, [th, el('b', { text: it.label })]);
        btn.dataset.thumb = kind + ':' + it.id;
        if (it.id !== 'none') setModeThumb(btn, modeThumbUrls.get(kind + ':' + it.id));
        box.appendChild(btn);
      }
    }
    requestModeThumbs(box);
    return box;
  }

  /* GÖRSEL / ZEMİN KÜÇÜK RESİMLERİ (#957). Ana süreç önce uygulamayla gelen
     resmi veriyor; yoksa gizli pencerede tek tek çiziyor (kuyruk ve seyreklik
     MilkDrop küçük resimleriyle ortak). İstek boşta (requestIdleCallback)
     gidiyor: galeri açılırken panel takılmasın. url '' = çizilemedi, simge kalıyor. */
  const modeThumbUrls = new Map();
  let modeThumbBound = false;
  function setModeThumb(btn, url) {
    if (!url || btn.dataset.thumbUrl === url) return;
    btn.dataset.thumbUrl = url;
    const th = btn.querySelector('.sv-th');
    if (!th) return;
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'lazy';
    img.onload = () => btn.classList.remove('nothumb');
    img.onerror = () => img.remove();
    img.src = url;
    th.appendChild(img);
  }
  function requestModeThumbs(box) {
    const api = window.api;
    if (!api || typeof api.modeThumbs !== 'function') return;
    if (!modeThumbBound && typeof api.onModeThumb === 'function') {
      modeThumbBound = true;
      api.onModeThumb((t) => {
        if (!t || typeof t.id !== 'string') return;
        modeThumbUrls.set(t.id, t.url || '');
        document.querySelectorAll('.sv-gi[data-thumb]').forEach((b) => { if (b.dataset.thumb === t.id) setModeThumb(b, t.url); });
      });
    }
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 200));
    idle(() => {
      if (!box.isConnected) return;
      const items = [];
      box.querySelectorAll('.sv-gi[data-thumb]').forEach((b) => {
        const id = b.dataset.thumb;
        if (modeThumbUrls.has(id) || /:none$/.test(id)) return;
        const i = id.indexOf(':');
        items.push({ id, kind: id.slice(0, i), type: id.slice(i + 1) });
      });
      if (!items.length) return;
      api.modeThumbs(items).then((r) => {
        const ready = (r && r.ready) || {};
        for (const id of Object.keys(ready)) {
          modeThumbUrls.set(id, ready[id]);
          box.querySelectorAll('.sv-gi[data-thumb]').forEach((b) => { if (b.dataset.thumb === id) setModeThumb(b, ready[id]); });
        }
      }, () => {});
    }, { timeout: 1500 });
  }

  /* MOD HEDEFİ. Eskiden seçili katman bu türden değilse (ör. arkaplan seçiliyken Görsel rafı) mod
     sessizce en üstteki görselleştirici katmanına gidiyordu; kullanıcı seçtiği katmanın değiştiğini
     sanıyordu. Artık kural layers.js `modeTarget`: yalnız seçili katman. Türü uymuyorsa ya da
     kilitliyse hiçbir şey yazılmaz (raf zaten kilitli görünür, bu ikinci emniyet). Hiç katman seçili
     değilse yeni katman eklenir. Eski davranış Ayarlar > `ui.modeTargetAuto`. */
  function autoTarget() {
    return window.SVLayers.modeTargetAuto(P().cfg());
  }
  function applyMode(want, id, label) {
    const list = layers();
    const cur = selected();
    const r = window.SVLayers.modeTarget(P().cfg(), { kind: want, layerId: cur ? cur.id : '' });
    if (r.error) {
      if (P().toast) P().toast(tr(lockText(r.error === 'LOCKED' ? 'locked' : 'kind', want)), 'warn');
      paint();
      return false;
    }
    let l = r.layer;
    if (!l) {
      l = window.SVLayers.normalizeLayer({ kind: want, type: id, name: label });
      if (want === 'background') list.unshift(l); else list.push(l);
    }
    window.SVLayers.setLayerMode(P().cfg(), l, { type: id });
    sel = l.id;
    write(STORE.sel, sel);
    P().apply();
    return true;
  }

  /* RAF KİLİDİ. Seçili katmana uymayan raf görünür kalıyor (ne olduğu görülsün) ama içerik
     etkisiz (`inert`), üstünde neden ve çıkış yolu yazıyor. Eski davranış ayarı açıksa kilit yok. */
  const OVERLAY_VIS = { text: 1, nowplaying: 1 };
  function shelfLock() {
    if (shelfTab !== 'vis' && shelfTab !== 'bg' && shelfTab !== 'milkdrop') return null;
    const l = selected();
    if (!l || autoTarget()) return null;
    if (shelfTab === 'milkdrop') {
      if (l.kind === 'visualizer' && l.type === 'milkdrop') return l.locked ? { why: 'locked', want: 'milkdrop', layer: l } : null;
      return { why: l.kind === 'visualizer' && !OVERLAY_VIS[l.type] && !l.locked ? 'convert' : 'kind', want: 'milkdrop', layer: l };
    }
    const want = shelfTab === 'bg' ? 'background' : 'visualizer';
    if (l.kind !== want) return { why: 'kind', want, layer: l };
    if (l.locked) return { why: 'locked', want, layer: l };
    return null;
  }
  function lockText(why, want) {
    if (why === 'locked') return 'Seçili katman kilitli; önce kilidini açın.';
    if (want === 'background') return 'Zemin modları yalnız arkaplan katmanına uygulanır.';
    if (want === 'milkdrop') return 'MilkDrop presetleri yalnız MilkDrop katmanına uygulanır.';
    return 'Görsel modları yalnız görselleştirici katmanına uygulanır.';
  }
  // Seçili katmanın kendi rafı (kilitli rafta "Uygun rafa geç")
  function shelfFor(l) {
    if (!l) return '';
    if (l.kind === 'background') return 'bg';
    if (l.kind === 'visualizer') return l.type === 'milkdrop' ? 'milkdrop' : 'vis';
    return '';
  }
  const lockName = (l) => tr('Seçili katman bu rafa uymuyor') + ': ' + tr(l.name || l.kind);
  function lockOverlay(lock) {
    const el = P().el;
    const l = lock.layer;
    const go = shelfFor(l);
    const btns = [];
    if (lock.why === 'convert') {
      btns.push(el('button', {
        class: 'btn primary small', type: 'button', text: tr("Katmanı MilkDrop'a çevir"),
        onclick: () => {
          // Kart seçim değişince yeniden kurulmuyor: o anda seçili katman
          const x = selected();
          if (!x || x.locked) return;
          window.SVLayers.setLayerMode(P().cfg(), x, { type: 'milkdrop' });
          P().apply();
        },
      }));
    }
    if (go && go !== shelfTab && lock.why !== 'locked') {
      btns.push(el('button', { class: 'btn small', type: 'button', text: tr('Uygun rafa geç'), onclick: () => setShelf(shelfFor(selected()) || go) }));
    }
    btns.push(el('button', { class: 'btn small', type: 'button', text: tr('Seçimi kaldır'), onclick: () => select('') }));
    return el('div', { class: 'sv-shelf-lock', role: 'note', 'data-shelf-lock': lock.why }, [
      el('span', { icon: 'lock' }),
      el('div', { class: 'sv-shelf-lock-text' }, [
        el('strong', { class: 'sv-shelf-lock-name', text: lockName(l) }),
        el('span', { text: tr(lockText(lock.why === 'locked' ? 'locked' : 'kind', lock.want)) }),
      ]),
      el('div', { class: 'sv-shelf-lock-actions' }, btns),
    ]);
  }

  /* KİLİT YERİNDE (#905). Hedef satırı dışındaki içerik kilit kabına taşınıyor (yeniden
     kurulmuyor), üstüne neden ve çıkış yolu. Kilit kalkınca içerik kaptan geri çıkıyor. Kart
     yalnız kilidin kendisi (neden, katman, raf) değişince değişiyor. */
  function applyLock(body, lock) {
    if (!body || !body.querySelector) return;
    const key = lock ? [shelfTab, lock.why, lock.want, lock.layer.id, lock.layer.name || ''].join('') : '';
    if ((body._svLockKey || '') === key) return;
    body._svLockKey = key;
    const old = body.querySelector(':scope > .sv-shelf-lock');
    if (old) old.remove();
    let wrap = body.querySelector(':scope > .sv-shelf-locked');
    if (!lock) {
      if (wrap) wrap.replaceWith(...Array.from(wrap.childNodes));
      return;
    }
    if (!wrap) {
      const line = body.querySelector(':scope > .sv-target');
      const content = Array.from(body.children).filter((n) => n !== line);
      if (!content.length) return;
      wrap = P().el('div', { class: 'sv-shelf-locked', 'aria-disabled': 'true' }, content);
      wrap.inert = true;
      if (typeof wrap.setAttribute === 'function') wrap.setAttribute('inert', '');
      body.appendChild(wrap);
    }
    body.insertBefore(lockOverlay(lock), wrap);
  }

  /* Sahne rafı: yan raftaki listenin kendisi. Kaydetme, yeniden adlandırma, sıralama, silme ve
     içe/dışa aktarma iki kez yazılmasın. */
  let scenesNode = null;
  function sceneShelf() {
    if (!scenesNode) scenesNode = document.getElementById('dockScenes');
    /* Tam yeniden kurulum kaydırmayı sıfırlar. Liste zaten doluysa yalnız
       seçim göstergesini güncelle; ilk yerleşimde tam kur. */
    if (scenesNode && P().renderScenes) {
      const list = scenesNode.querySelector('#sceneList');
      const full = !list || !list.querySelector('.scene-item');
      setTimeout(() => P().renderScenes(full ? undefined : { selectionOnly: true }), 0);
    }
    return scenesNode;
  }

  function targetLine() {
    // Kilitli rafta hedef yok; nedeni kilit kartı söylüyor
    if (shelfLock()) return '';
    const l = selected();
    if (shelfTab === 'milkdrop') {
      const own = l && l.kind === 'visualizer' && l.type === 'milkdrop';
      return own && window.SVMilkdropPanel.isOwnLayer(l) ? tr('Şuna uygulanır:') + ' ' + tr(l.name || 'MilkDrop') : tr('Ortak MilkDrop presetine uygulanır');
    }
    if (shelfTab === 'vis' || shelfTab === 'bg') {
      if (l && autoTarget()) {
        // Eski davranış: uymayan seçimde mod en üstteki uygun katmana gider
        const r = window.SVLayers.modeTarget(P().cfg(), { kind: shelfTab === 'bg' ? 'background' : 'visualizer', layerId: l.id });
        if (r.layer) return tr('Şuna uygulanır:') + ' ' + tr(r.layer.name || r.layer.kind);
        return tr('Yeni katman olarak eklenir');
      }
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
    /* Boş imza her paint()'te rafı söküyordu: Sahne sekmesinde #sceneList
       kaydırması sahne uygulanınca başa sıçrıyordu. Sekme/sorgu imzası
       aynıysa raf yerinde kalsın; MilkDrop'ta preset değişince yenilensin. */
    if (!shelfOpen) return 'closed:' + shelfTab;
    /* Kilit imzada DEĞİL (#905): kilit kartı ve kilit kabı applyLock ile yerinde takılıp
       çıkarılıyor, kitaplık içeriği yeniden kurulmuyor. Eskiden imzada kilitli katmanın kimliği
       ve adı vardı: MilkDrop rafı açıkken MilkDrop olmayan katmanlar arasında her seçim rafı
       baştan kuruyordu (ölçüldü: 38 seçimde 727 ms, seçim başına ~19 ms ve bir zorunlu
       yerleşim). */
    const lockSig = '';
    /* Seçili katman ve türü imzada değil: vurgu ve hedef satırı syncShelf ile yerinde
       güncelleniyor (raf yeniden kurulmuyor, kaydırma kaybolmuyor). Kilit kartı yapıyı
       değiştirdiği için imzada. */
    if (shelfTab === 'vis' || shelfTab === 'bg') {
      return shelfTab + '|' + String(query || '') + '|' + lockSig + '|' + (autoTarget() ? 'a' : 's');
    }
    if (shelfTab !== 'milkdrop') return shelfTab + '|' + String(query || '');
    /* MilkDrop: etkin preset ve seçili katman da imzada değil (vurgu syncShelf ile).
       Rafın düğmeleri yapılandırma nesnesini tutuyor; dışarıdan yeni yapılandırma
       gelince (MCP, telefon) nesne değişiyor, o zaman raf yeniden kuruluyor. */
    return JSON.stringify([query, lockSig, cfgSerial()]);
  }
  function invalidateShelf() { shelfStale = true; }
  // Yapılandırma nesnesinin kimliği (sayaç): aynı nesne aynı sayı
  const cfgIds = new WeakMap();
  let cfgSeq = 0;
  function cfgSerial() {
    const c = P().cfg();
    if (!c || typeof c !== 'object') return 0;
    if (!cfgIds.has(c)) cfgIds.set(c, ++cfgSeq);
    return cfgIds.get(c);
  }

  /* RAF VURGUSU. Her raf "şu an hangisi" sorusunu kendi durumundan cevaplıyor; kartlar
     yalnız oluşturulurken işaretleniyordu. Katmanın türü listeden, denetçiden, MCP'den ya da
     geri almayla değişince imza aynı kaldığı için raf yeniden kurulmuyor ve eski kart vurgulu
     kalıyordu (Şarkı Sözü katmanı Kroma Çemberi'ydi, rafta Osiloskop seçili görünüyordu).
     Artık her çizimden sonra tek bir yerden, yerinde eşitleniyor: sınıf değişiyor, düğüm ve
     kaydırma yerinde kalıyor. Her raf: öğe seçicisi, anahtar özniteliği, sınıf ve geçerli
     anahtarlar. */
  const SHELF_CURRENT = {
    vis: { sel: '.sv-gi[data-cur]', attr: 'data-cur', cls: 'cur', now: () => modeNow('visualizer') },
    bg: { sel: '.sv-gi[data-cur]', attr: 'data-cur', cls: 'cur', now: () => modeNow('background') },
    milkdrop: {
      sel: '.md-cell[data-id], .md-item[data-id]', attr: 'data-id', cls: 'active',
      now: () => {
        const MP = window.SVMilkdropPanel;
        const id = MP && MP.currentPick ? MP.currentPick(P().cfg()) : '';
        return id ? [id] : [];
      },
    },
    templates: {
      sel: '.tpl-card[data-cur]', attr: 'data-cur', cls: 'active',
      now: () => {
        const T = window.SVTemplatePanel;
        const id = T && T.current ? T.current() : '';
        return id ? [id] : [];
      },
    },
    scenes: {
      sel: '.scene-item[data-scene-id]', attr: 'data-scene-id', cls: 'active',
      now: () => {
        const id = P().activeSceneId ? P().activeSceneId() : null;
        return id ? [id] : [];
      },
    },
  };
  function modeNow(kind) {
    const l = selected();
    return l && l.kind === kind ? [l.type] : [];
  }
  function syncShelf(root) {
    const host = root || (typeof document !== 'undefined' ? document.getElementById('svShelf') : null);
    const spec = SHELF_CURRENT[shelfTab];
    if (!host || !spec || !host.querySelectorAll) return 0;
    const want = new Set(spec.now());
    let changed = 0;
    host.querySelectorAll(spec.sel).forEach((n) => {
      const on = want.has(n.getAttribute(spec.attr));
      if (n.classList.contains(spec.cls) !== on) { n.classList.toggle(spec.cls, on); changed++; }
    });
    // Hedef satırı da seçime bağlı ("Şuna uygulanır: …"); metin yerinde
    const line = host.querySelector('.sv-target');
    if (line) {
      const text = targetLine();
      if (text && line.textContent !== text) line.textContent = text;
    }
    // Kilit kartı ve kabı seçime bağlı: yerinde takılıp çıkarılıyor (testte kaynak tek başına)
    if (typeof applyLock === 'function') applyLock(host.querySelector('[data-shelf-body]'), shelfLock());
    return changed;
  }
  /* Raf kartı boş kaldı mı? Sahne dışı bir sayfaya geçince render() #svShelf'i
     boşaltıyor, placeStage da sahne listesini yan rafa geri taşıyor. İmza
     aynı kaldığı için dönüşte raf yeniden çizilmiyor, kart boş görünüyordu
     (görselleştirici kapatılınca/sayfa değişince "bazen gidiyor"). */
  function shelfEmpty(c) {
    const body = c.querySelector('[data-shelf-body]');
    if (!body) return true;
    if (!shelfOpen) return false;
    if (!body.childElementCount) return true;
    return shelfTab === 'scenes' && !!scenesNode && !body.contains(scenesNode);
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
      lib && shelfTab !== 'milkdrop' && shelfTab !== 'scenes' && shelfTab !== 'templates' ? el('label', { class: 'sv-shelf-search' }, [
        el('span', { icon: 'search' }),
        el('input', { placeholder: tr('Ara'), value: query, 'aria-label': tr('Kitaplıkta ara'), oninput: (e) => { query = e.target.value; paintShelfBody(host); } }),
      ]) : el('span', { class: 'sv-grow' }),
      lib ? el('label', { class: 'sv-card-size', title: tr('Kart boyu (Ctrl + tekerlek)') }, [
        el('span', { icon: 'grid' }),
        el('input', {
          type: 'range', min: String(CARD_MIN), max: String(CARD_MAX), step: '2', value: String(cardSize), 'aria-label': tr('Kart boyu'),
          oninput: (e) => setCardSize(e.target.value, host),
        }),
      ]) : null,
      el('button', {
        class: 'sv-ib sm', type: 'button', icon: shelfOpen ? 'chevron-down' : 'chevron-up',
        title: tr(shelfOpen ? 'Rafı kapat, sahneyi büyüt' : 'Rafı aç'), 'aria-label': tr(shelfOpen ? 'Rafı kapat, sahneyi büyüt' : 'Rafı aç'),
        onclick: () => { shelfOpen = !shelfOpen; write(STORE.open, shelfOpen ? '1' : '0'); paint(); },
      }),
    ]);
    const body = el('div', { class: 'sv-cbody' + (shelfTab === 'milkdrop' ? ' sv-fill' : ''), 'data-shelf-body': '1' });
    host.replaceChildren(head, body);
    applyCardSize(host);
    if (!host.dataset.svCardWheel) {
      host.dataset.svCardWheel = '1';
      host.addEventListener('wheel', (e) => {
        if (!e.ctrlKey || !isLib(shelfTab)) return;
        e.preventDefault();
        setCardSize(cardSize + (e.deltaY < 0 ? 12 : -12), host);
      }, { passive: false });
    }
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
    body._svLockKey = '';
    applyLock(body, shelfLock());
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
    /* Düzen editörü açıkken sahne ONUN penceresinde. Sayfa arkada yeniden çizilince (geri al,
       dışarıdan gelen ayar) sahne buraya geri çekiliyordu: editör simsiyah kalıyor, kapanınca
       da sahne yanlış yere dönüyordu. Editör kapanırken sayfayı kendisi yeniden çizdirir. */
    if (window.SVLayoutEditor && window.SVLayoutEditor.isOpen()) return;
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
    /* !sig kaldırıldı: boş imza her sahne değişiminde rafı yıkıyordu.
       MilkDrop için .md-library yoksa (ilk kurulum) yine boya. */
    const mdMissing = shelfTab === 'milkdrop' && shelfOpen && !c.querySelector('[data-shelf-body] .md-library');
    if (shelfStale || sig !== shelfPainted || mdMissing || shelfEmpty(c)) {
      paintShelf(c);
      shelfPainted = sig;
      shelfStale = false;
    }
    syncShelf(c);
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

  window.SVSceneShell = { shelfLock, applyMode, syncShelf, thumbReady, paint, placeStage, select, setShelf, selected, closeMenus, placeMenu, openLayerMenu, startRename, layerAct: act, reveal, invalidateShelf, sceneThumb, thumbOf, titleOf };
})();
