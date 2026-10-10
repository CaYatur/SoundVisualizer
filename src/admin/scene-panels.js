/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Sahne motorlarının panelleri: Katmanlar, Efekt Zinciri ve 3B Geometri.

   Üçü de aynı desende: yapılandırmadaki listeyi/nesneyi doğrudan düzenler ve
   push() ile canlı yayar. Kontroller SVPanel yardımcılarıyla üretildiği için
   görünüm diğer kartlarla aynı kalır. */
(function () {
  const P = () => window.SVPanel;

  if (!window.__svMediaIpc && window.api && window.api.onVisualizerMessage) {
    window.__svMediaIpc = true;
    window.api.onVisualizerMessage((msg) => {
      if (!msg || msg.type !== 'media-status' || typeof window.SVMediaStatus !== 'function') return;
      window.SVMediaStatus(msg);
    });
  }

  /* Tek ayar sıfırlama: admin appendGrouped / lighting-general ile aynı
     data-path + ctrl-reset. Yalnız kategori düzeyi kontroller (yığın anahtarı,
     şeffaf arkaplan vb.); katman kartlarının içi HARİÇ — orada her alanın
     ayrı reseti yok. Bölüm/kategori sıfırlaması layers kökünü fabrika
     varsayılanına (boş dizi) döndürür: kullanıcı katmanları kalkar,
     sevkiyat varsayılan yığını gelir (Layers’a özgü). */
  function attachPath(ctrl, path) {
    const el = P().el;
    ctrl.setAttribute('data-path', path);
    if (P().isModified && P().isModified(path)) ctrl.classList.add('modified');
    const lbl = ctrl.querySelector && ctrl.querySelector('label.lbl');
    if (lbl && P().resetPath && P().defaultAt && P().defaultAt(path) !== undefined) {
      lbl.appendChild(el('button', {
        class: 'ctrl-reset',
        type: 'button',
        icon: 'reset',
        title: 'Bu ayarı varsayılana döndür',
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          P().resetPath(path);
        },
      }));
    }
    return ctrl;
  }


  /* Katman içi tek ayar sıfırlama: config yolu yok (layers[] varsayılan boş),
     bu yüzden açık varsayılan değerle çalışır. Kategori düzeyi attachPath’ten
     ayrı; yığın anahtarı buna dahil DEĞİL. */
  function attachDefault(ctrl, get, set, defVal) {
    if (!ctrl || defVal === undefined) return ctrl;
    const el = P().el;
    const same = (a, b) => {
      if (a === b) return true;
      if (typeof a === 'object' || typeof b === 'object') {
        try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
      }
      return false;
    };
    /* push() → refreshModifiedMarks() runs this callback. Layer-internal
       controls have no data-path, so the modified class is refreshed only
       here — including while a slider is dragged — so the per-control
       reset appears immediately after a change. */
    const syncModified = () => {
      const mod = !same(get(), defVal);
      if (ctrl.classList && typeof ctrl.classList.toggle === 'function') {
        ctrl.classList.toggle('modified', mod);
      } else if (mod) {
        ctrl.classList.add('modified');
      }
    };
    ctrl.setAttribute('data-sv-local-def', '1');
    ctrl._svSyncModified = syncModified;
    syncModified();
    const lbl = ctrl.querySelector && ctrl.querySelector('label.lbl');
    if (!lbl) return ctrl;
    if (lbl.querySelector && lbl.querySelector('.ctrl-reset')) return ctrl;
    const title = (window.SVI18n && window.SVI18n.t)
      ? window.SVI18n.t('Bu ayarı varsayılana döndür')
      : 'Bu ayarı varsayılana döndür';
    lbl.appendChild(el('button', {
      class: 'ctrl-reset',
      type: 'button',
      icon: 'reset',
      title,
      onclick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        const v = (defVal !== null && typeof defVal === 'object')
          ? JSON.parse(JSON.stringify(defVal))
          : defVal;
        set(v);
        /* push, düğmeyi gizleyip odağı düşürür ve kaydırmayı başa alır.
           Konum, düğme hâlâ odaktayken okunur; kayıt ondan sonra gider. */
        if (P().rerender) P().rerender();
        else if (P().apply) P().apply();
        P().push(true);
      },
    }));
    return ctrl;
  }

  /* Kilitli katman yerinden oynamaz; komşusu da onun üstünden geçemez
     (yer değiştirmek onu da taşırdı). */
  function moveItem(list, i, dir) {
    const j = i + dir;
    if (j < 0 || j >= list.length) return false;
    if ((list[i] && list[i].locked) || (list[j] && list[j].locked)) return false;
    const t = list[i];
    list[i] = list[j];
    list[j] = t;
    return true;
  }

  /* Sıra/sil düğmelerinden oluşan başlık çubuğu.

     `reverse`, listenin ekranda ters sırada gösterildiği yerler içindir
     (katmanlar). Orada "yukarı", dizide GERİYE değil İLERİYE gitmek demektir;
     bayrak olmadan oklar kullanıcının gördüğünün tersine çalışırdı. */
  function itemHeader(list, i, title, onChange, extra, reverse) {
    const el = P().el;
    const up = reverse ? 1 : -1;
    const kids = [
      el('button', {
        class: 'btn ghost tiny', type: 'button', icon: 'chevron-up', title: 'Yukarı taşı',
        onclick: () => { if (moveItem(list, i, up)) onChange(); },
      }),
      el('button', {
        class: 'btn ghost tiny', type: 'button', icon: 'chevron-down', title: 'Aşağı taşı',
        onclick: () => { if (moveItem(list, i, -up)) onChange(); },
      }),
      el('span', { class: 'item-title', text: title }),
    ];
    if (extra) kids.push(extra);
    kids.push(
      el('button', {
        class: 'btn ghost tiny danger', type: 'button', icon: 'x', title: 'Kaldır',
        onclick: () => { list.splice(i, 1); onChange(); },
      })
    );
    return el('div', { class: 'item-head' }, kids);
  }

  // Küçük etiketli kaydırıcı (katman/efekt kartlarının içinde)
  function miniSlider(label, get, set, opts) {
    const el = P().el;
    const o = opts || {};
    const fmt = o.fmt || ((v) => (o.percent ? Math.round(v * 100) + '%' : (+v).toFixed(2)));
    const val = el('span', { class: 'val', text: fmt(get()) });
    const input = el('input', {
      type: 'range',
      min: o.min == null ? 0 : o.min,
      max: o.max == null ? 1 : o.max,
      step: o.step == null ? 0.01 : o.step,
      value: get(),
      oninput: (e) => {
        const v = parseFloat(e.target.value);
        set(v);
        val.textContent = fmt(v);
        P().push(false);
      },
    });
    const ctrl = el('div', { class: 'ctrl', 'data-anchor': String(label).slice(0, 80) }, [
      el('div', { class: 'row' }, [el('label', { class: 'lbl', text: label }), val]),
      input,
    ]);
    return o.def !== undefined ? attachDefault(ctrl, get, set, o.def) : ctrl;
  }

  function miniSelect(label, options, get, set, onAfter, def) {
    const el = P().el;
    const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
    const sel = el('select', {
      class: 'p-in',
      onchange: (e) => { set(e.target.value); P().push(true); if (onAfter) onAfter(); },
    });
    for (const [v, t] of options) {
      const o = el('option', { value: v, text: tr(t) });
      if (String(get()) === String(v)) o.selected = true;
      sel.appendChild(o);
    }
    const ctrl = P().row(tr(label), sel);
    if (ctrl && ctrl.setAttribute) ctrl.setAttribute('data-anchor', String(label).slice(0, 80));
    return def !== undefined ? attachDefault(ctrl, get, (v) => { set(v); }, def) : ctrl;
  }

  function miniSegment(label, options, get, set, onAfter, def) {
    const el = P().el;
    const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
    const cur = get();
    const seg = el('div', { class: 'segment' });
    for (const [v, t] of options) {
      const b = el('button', {
        type: 'button',
        class: cur === v ? 'active' : '',
        text: tr(t),
        onclick: () => {
          set(v);
          P().push(true);
          if (onAfter) onAfter();
        },
      });
      seg.appendChild(b);
    }
    const ctrl = el('div', { class: 'ctrl', 'data-anchor': String(label).slice(0, 80) }, [
      el('label', { class: 'lbl', text: tr(label) }),
      seg,
    ]);
    return def !== undefined ? attachDefault(ctrl, get, (v) => { set(v); }, def) : ctrl;
  }

  function isWindowsPlatform() {
    if (typeof window !== 'undefined' && window.SV_PLATFORM && typeof window.SV_PLATFORM.isWindows === 'boolean') {
      return window.SV_PLATFORM.isWindows;
    }
    if (typeof process !== 'undefined' && process.platform) {
      return process.platform === 'win32';
    }
    return false;
  }

  /* "3:24" veya saniye. macOS/Linux medya oturumu okumaz; süre bu değerdir. */
  function parseClock(text) {
    const s = String(text == null ? '' : text).trim();
    if (!s) return 0;
    if (/^\d+(\.\d+)?$/.test(s)) return Math.max(0, Number(s));
    const p = s.split(':').map((x) => Number(String(x).trim()));
    if (p.some((n) => !Number.isFinite(n) || n < 0) || p.length < 2 || p.length > 3) return 0;
    if (p.length === 2) return p[0] * 60 + p[1];
    return p[0] * 3600 + p[1] * 60 + p[2];
  }
  function formatClock(sec) {
    sec = Math.round(Number(sec) || 0);
    if (sec <= 0) return '';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const two = (n) => (n < 10 ? '0' + n : String(n));
    return h > 0 ? h + ':' + two(m) + ':' + two(s) : m + ':' + two(s);
  }

  function miniToggle(label, get, set, onAfter, opts) {
    const el = P().el;
    const disabled = !!(opts && opts.disabled);
    const inp = el('input', {
      type: 'checkbox',
      disabled,
      onchange: (e) => {
        if (disabled) return;
        set(e.target.checked);
        P().push(true);
        if (onAfter) onAfter();
      },
    });
    inp.checked = !disabled && !!get();
    const switchEl = el('label', {
      class: 'switch small' + (disabled ? ' disabled' : ''),
      title: (opts && opts.title) || '',
    }, [inp, el('span', { class: 'track' })]);
    if (disabled && switchEl && switchEl.style) {
      switchEl.style.cursor = 'not-allowed';
      switchEl.style.opacity = '0.45';
      switchEl.style.pointerEvents = 'none';
    }
    let labelEl = label;
    if (opts && opts.badge) {
      labelEl = el('span', {}, [
        label + ' ',
        el('span', { class: 'pill', text: opts.badge }),
      ]);
    }
    const ctrl = P().row(labelEl, switchEl);
    if (typeof label === 'string' && ctrl && ctrl.setAttribute) ctrl.setAttribute('data-anchor', label.slice(0, 80));
    return (opts && opts.def !== undefined)
      ? attachDefault(ctrl, get, (v) => { set(!!v); }, opts.def)
      : ctrl;
  }

  function miniColor(label, get, set, def) {
    const el = P().el;
    const inp = el('input', {
      type: 'color',
      value: get() || '#ff0055',
      oninput: (e) => { set(e.target.value); P().push(false); },
    });
    const ctrl = P().row(label, inp);
    if (ctrl && ctrl.setAttribute && label != null) ctrl.setAttribute('data-anchor', String(label).slice(0, 80));
    return def !== undefined ? attachDefault(ctrl, get, set, def) : ctrl;
  }

  const foldStates = {};

  // Katlanır bölüm (dönüşüm / ses gibi ikincil ayarlar için)
  function foldable(title, buildKids, key) {
    const k = key || title;
    const el = P().el;
    const body = el('div', { class: 'fold-body' });
    let open = !!foldStates[k];
    /* Ok ayrı bir öğe ve CSS'le döndürülüyor (.fold-head.open); yazı
       kendi metin düğümünde kalıyor, çeviri onu tam metin eşliyor. */
    const head = el('button', {
      class: 'fold-head' + (open ? ' open' : ''), type: 'button', 'data-anchor': title,
      onclick: () => {
        const root = (typeof document !== 'undefined' && document.getElementById)
          ? document.getElementById('sections') : null;
        const before = (root && head.getBoundingClientRect) ? head.getBoundingClientRect().top : null;
        open = !open;
        foldStates[k] = open;
        head.classList.toggle('open', open);
        body.classList.toggle('open', open);
        if (open && !body.childElementCount) buildKids().forEach((n) => n && body.appendChild(n));
        keepViewport(root, head, before);
      },
    }, [el('span', { class: 'fold-caret', icon: 'caret-right' }), el('span', { text: title })]);
    if (open) {
      body.classList.add('open');
      buildKids().forEach((n) => n && body.appendChild(n));
    }
    return el('div', { class: 'fold' }, [head, body]);
  }

  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);

  // ==========================================================================
  // KATMAN SATIRI (#622)
  // ==========================================================================
  const layerKey = (l, i) => String((l && l.id) || ('i' + i));

  /* Hangi katmanların açık olduğu. Sahneye değil bu makinedeki panele ait
     bir görünüm tercihi: ayar dosyasına yazılırsa her açıp kapatma bir
     yapılandırma gönderimi ve sahne değişikliği olurdu. */
  let openLayers = null;
  function layerOpenState() {
    if (openLayers) return openLayers;
    openLayers = new Set();
    try {
      const saved = JSON.parse(localStorage.getItem('sv-layers-open') || '[]');
      if (Array.isArray(saved)) saved.forEach((k) => openLayers.add(String(k)));
    } catch { /* depolama yoksa hepsi kapalı başlar */ }
    return openLayers;
  }
  function saveLayerOpen(set) {
    try { localStorage.setItem('sv-layers-open', JSON.stringify([...set].slice(-64))); } catch { /* yok say */ }
  }

  const LAYER_ICONS = { background: 'background', visualizer: 'bars', text: 'text', media: 'film', sprites: 'sparkles', logo: 'tag', nowplaying: 'music' };

  /* Katman başlığı: sıra okları, tür simgesi, ad ve özet, bayraklar, aç/kapa
     ve kaldır. Liste ekranda ters sırada: "yukarı" dizide İLERİ demek (bkz.
     itemHeader). Ad ve özet tıklanınca da açılıyor — küçük bir oku
     hedeflemek zorunda kalınmasın. */
  function layerHead(list, i, l, name, summary, flags, open, toggle, onChange) {
    const el = P().el;
    const icon = LAYER_ICONS[(l.kind === 'visualizer' && l.type === 'text') ? 'text' : (l.kind === 'visualizer' && l.type === 'nowplaying') ? 'nowplaying' : l.kind] || 'grid';
    return el('div', { class: 'layer-head' + (open ? ' open' : '') }, [
      el('div', { class: 'layer-ord' }, [
        /* Komşu kilitliyse ok da kapalı: eskiden etkin görünüyor, basınca
           hiçbir şey olmuyordu. İpucu nedenini söylüyor. */
        el('button', {
          class: 'btn ghost tiny', type: 'button', icon: 'chevron-up',
          title: l.locked ? 'Kilitli' : (list[i + 1] && list[i + 1].locked ? 'Üstteki katman kilitli' : 'Yukarı taşı'),
          disabled: !!l.locked || !!(list[i + 1] && list[i + 1].locked),
          onclick: () => { if (moveItem(list, i, 1)) onChange(); },
        }),
        el('button', {
          class: 'btn ghost tiny', type: 'button', icon: 'chevron-down',
          title: l.locked ? 'Kilitli' : (list[i - 1] && list[i - 1].locked ? 'Alttaki katman kilitli' : 'Aşağı taşı'),
          disabled: !!l.locked || !!(list[i - 1] && list[i - 1].locked),
          onclick: () => { if (moveItem(list, i, -1)) onChange(); },
        }),
      ]),
      el('span', { class: 'layer-ico', icon }),
      el('button', {
        class: 'layer-name', type: 'button', title: open ? tr('Ayarları gizle') : tr('Ayarları göster'),
        'aria-expanded': open ? 'true' : 'false',
        onclick: toggle,
      }, [
        el('b', { text: name }),
        summary ? el('small', { text: summary }) : null,
      ]),
      flags,
      el('button', {
        class: 'btn ghost tiny layer-caret', type: 'button', icon: open ? 'caret-down' : 'caret-right',
        title: open ? tr('Ayarları gizle') : tr('Ayarları göster'),
        disabled: !!l.locked,
        onclick: toggle,
      }),
      /* Kilit "kazara düzenlemeyi engeller" diyor; kaldırma ve taşıma da
         düzenleme. Eskiden kilitliyken de onaysız siliniyordu. */
      el('button', {
        class: 'btn ghost tiny layer-del', type: 'button', icon: 'x', title: l.locked ? 'Kilitli' : 'Kaldır',
        disabled: !!l.locked,
        onclick: () => { if (l.locked) return; list.splice(i, 1); onChange(); },
      }),
    ]);
  }

  /* Katmanın alt bölümleri sekme şeridi: aynı anda biri açık. Eskiden beş
     katlanır başlık alt alta diziliyordu ve kartın dibinde kayboluyordu.
     Açık sekme panel yeniden çizilince korunuyor (foldStates). */
  /* Sekme ya da katlanır başlık açılıp kapanınca şerit ekranda yerinde
     kalır. Kart kendi sütununda büyür; öbür sütunlar oynamaz (#695). */
  function keepViewport(root, box, before) {
    if (before == null || !root || !box || !box.getBoundingClientRect) return;
    const d = box.getBoundingClientRect().top - before;
    if (d > 0.5 || d < -0.5) root.scrollTop += d;
  }

  function layerTabs(key, tabs) {
    const el = P().el;
    const pane = el('div', { class: 'layer-pane' });
    const bar = el('div', { class: 'layer-tabs', role: 'tablist' });
    const show = (k) => {
      const root = (typeof document !== 'undefined' && document.getElementById)
        ? document.getElementById('sections') : null;
      const before = (root && bar.getBoundingClientRect) ? bar.getBoundingClientRect().top : null;
      pane.innerHTML = '';
      const t = tabs.find((x) => x.key === k);
      if (t) t.build().forEach((n) => n && pane.appendChild(n));
      pane.classList.toggle('open', !!t);
      [...bar.children].forEach((b) => {
        const on = b.getAttribute('data-k') === k;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      keepViewport(root, bar, before);
    };
    tabs.forEach((t) => bar.appendChild(el('button', {
      type: 'button', class: 'layer-tab', role: 'tab', 'data-k': t.key, 'data-anchor': t.label, text: t.label,
      onclick: () => {
        const now = foldStates[key + '_tab'] === t.key ? '' : t.key;
        foldStates[key + '_tab'] = now;
        show(now);
      },
    })));
    show(foldStates[key + '_tab'] || '');
    return [bar, pane];
  }

  // ==========================================================================
  // KATMANLAR
  // ==========================================================================
  const LAYER_KIND_LABELS = [
    ['background', 'Arkaplan'],
    ['visualizer', 'Görselleştirici'],
    ['media', 'Medya'],
    ['sprites', 'Görsel Nesneler'],
    ['logo', 'Logo'],
    ['nowplaying', 'Çalan Parça'],
  ];

  /* Metin bir kind değil; görselleştirici türünün alt tipi. Ayrı düğmeler
     olmadan yalnızca şablon uygulayınca ya da türü sonradan değiştirince
     eklenebiliyordu. */
  const TEXT_ADD_PRESETS = [
    { label: 'Metin', spec: { name: 'Metin', source: 'static' } },
    { label: 'Şarkı Sözü', spec: { name: 'Şarkı Sözü', source: 'lyrics' } },
    {
      label: 'Sanatçı Adı',
      spec: {
        name: 'Sanatçı Adı', source: 'now', field: 'artist',
        content: 'SANATÇI ADI', placeholder: true, size: 0.032, weight: 500, y: 0.83,
      },
    },
  ];

  const BLEND_LABELS = [
    ['normal', 'Normal'], ['add', 'Toplama'], ['screen', 'Ekran'], ['multiply', 'Çarpma'],
    ['overlay', 'Kaplama'], ['darken', 'Koyulaştır'], ['lighten', 'Açıklaştır'],
    ['color-dodge', 'Renk Soldurma'], ['color-burn', 'Renk Yakma'],
    ['hard-light', 'Sert Işık'], ['soft-light', 'Yumuşak Işık'],
    ['difference', 'Fark'], ['exclusion', 'Dışlama'],
    ['hue', 'Renk Tonu'], ['saturation', 'Doygunluk'], ['color', 'Renk'], ['luminosity', 'Parlaklık'],
  ];

  const BAND_LABELS = [['bass', 'Bas'], ['mid', 'Orta'], ['treble', 'Tiz'], ['level', 'Genel']];

  const MASK_LABELS = [
    ['none', 'Yok'], ['rect', 'Dikdörtgen'], ['ellipse', 'Elips'],
    ['linear', 'Doğrusal Gradyan'], ['radial', 'Işınsal Gradyan'], ['layer', 'Başka Katman'],
  ];

  /* Katman panosu. Sahneler arasında katman taşımanın yolu bu; oturum
     boyunca bellekte durur, ayar dosyasına yazılmaz. */
  let clipboard = null;

  // Mod listeleri tek kaynaktan (shared/mode-catalog.js, #638)
  const MC = () => window.SVModeCatalog || require('../shared/mode-catalog.js');

  // Katman türüne göre seçilebilir mod listesi
  function typeOptionsFor(kind) {
    if (kind === 'background') return MC().layerPairs('background');
    if (kind === 'visualizer') return MC().layerPairs('visualizer');
    if (kind === 'sprites') return [['back', 'Arka Katman'], ['front', 'Ön Katman']];
    if (kind === 'nowplaying') return [];
    return [];
  }

  function pickImage(cb) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      // Açılamayan dosya (ör. .png adlı metin) katmana yazılmaz
      reader.onload = async () => {
        if (P().imageOk && !(await P().imageOk(reader.result))) return;
        cb(reader.result, file.name);
      };
      reader.readAsDataURL(file);
    });
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 1000);
  }

  function pickVideoFile(cb) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      cb(url, file.name);
    });
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 1000);
  }

  const NP_FONT_LABELS = [
    ['', 'Metin Katmanıyla Aynı'],
    ['system-ui, -apple-system, Segoe UI, Roboto, sans-serif', 'Sistem'],
    ['Georgia, "Times New Roman", serif', 'Serif'],
    ['ui-monospace, "Cascadia Code", Consolas, monospace', 'Tek Aralıklı'],
    ['Impact, "Arial Black", sans-serif', 'Ağır Başlık'],
    ['"Trebuchet MS", "Segoe UI", sans-serif', 'Yuvarlak'],
  ];
  const TEXT_FONT_LABELS = NP_FONT_LABELS.slice(1);
  const NP_ANIM_LABELS = [
    ['none', 'Yok'], ['fade', 'Belirme'], ['slideUp', 'Yukarı Kayma'],
    ['slideLeft', 'Yana Kayma'], ['scale', 'Büyüme'],
    ['typewriter', 'Daktilo'], ['wipe', 'Perde'],
  ];
  const TEXT_ANIM_LABELS = NP_ANIM_LABELS.slice(0, 5);
  const ALIGN_LABELS = [['left', 'Sola'], ['center', 'Ortaya'], ['right', 'Sağa']];

  /* Çalan Parça kartı katman yığını açıkken gizlenir. Motor
     l.settings.nowplaying alanını kök ayarın üstüne yazar. Yatay ve dikey
     konum Dönüşüm sekmesindedir; burada ikinci bir konum kaydırıcısı yok.
     Geçen süre ve çubuk yalnız Windows medya oturumunda. macOS/Linux
     süreyi elle yazar. */
  function nowplayingBag(l, cfg) {
    l.settings = l.settings || {};
    const np = (l.settings.nowplaying = l.settings.nowplaying || {});
    const root = cfg.nowplaying || {};
    const get = (k, fb) => (np[k] !== undefined ? np[k] : (root[k] !== undefined ? root[k] : fb));
    const set = (k, val) => { np[k] = val; };
    const win = isWindowsPlatform();
    if (!win && get('source', 'manual') === 'system') set('source', 'manual');
    const fromSystem = win && get('source', 'system') === 'system';
    const showOf = () => Object.assign({}, root.show || {}, np.show || {});
    const setShow = (key, v) => { np.show = Object.assign({}, showOf(), { [key]: v }); };
    const style = (window.SVNowPlaying && window.SVNowPlaying.styleOf)
      ? window.SVNowPlaying.styleOf(get('style', 'modern'))
      : { weight: 600, outline: 0, shadow: 0.55, uppercase: false, barHeight: 0.005, barSegments: 0, barBackOpacity: 0.22 };
    const manual = () => {
      np.manual = Object.assign({ title: '', artist: '', album: '', duration: 0 }, root.manual, np.manual);
      return np.manual;
    };
    return { np, get, set, win, fromSystem, showOf, setShow, style, manual };
  }

  function nowplayingLayerControls(l, cfg, rerender) {
    const el = P().el;
    const b = nowplayingBag(l, cfg);
    const out = [];
    if (b.win) {
      out.push(miniSelect('Kaynak', [['system', 'Sistemden Oku'], ['manual', 'Elle Yaz']],
        () => b.get('source', 'system'), (v) => b.set('source', v), rerender));
    }
    if (!b.fromSystem) {
      const textRow = (label, key, placeholder) => P().row(label, el('input', {
        class: 'p-in', type: 'text', value: b.manual()[key] || '',
        placeholder: placeholder || '',
        oninput: (e) => { b.manual()[key] = e.target.value; P().push(false); },
      }));
      out.push(textRow('Parça Adı', 'title'));
      out.push(textRow('Sanatçı', 'artist'));
      out.push(textRow('Albüm', 'album'));
      out.push(P().row('Süre', el('input', {
        class: 'p-in', type: 'text', value: formatClock(b.manual().duration),
        placeholder: '3:24',
        oninput: (e) => { b.manual().duration = parseClock(e.target.value); P().push(false); },
      })));
    }
    out.push(miniSelect('Ne Zaman', [['always', 'Sürekli Görünsün'], ['onChange', 'Parça Değişince']],
      () => b.get('mode', 'always'), (v) => b.set('mode', v), rerender));
    if (b.get('mode', 'always') === 'onChange') {
      const sp = (window.SVNowPlaying && window.SVNowPlaying.speedOf)
        ? window.SVNowPlaying.speedOf(b.get('speed', 'normal'))
        : { anim: 0.5, hold: 4 };
      out.push(miniSelect('Hız', [['fast', 'Hızlı'], ['normal', 'Normal'], ['slow', 'Yavaş']],
        () => b.get('speed', 'normal'), (v) => {
          b.set('speed', v);
          b.np.animDuration = null;
          b.np.holdSeconds = null;
        }, rerender));
      out.push(miniSlider('Ekranda Kalma', () => (b.get('holdSeconds', null) == null ? sp.hold : b.get('holdSeconds')),
        (v) => b.set('holdSeconds', v), { min: 0.5, max: 20, step: 0.5, fmt: (v) => (+v).toFixed(1) + ' sn', def: sp.hold }));
    }
    out.push(miniSelect('Hizalama', ALIGN_LABELS, () => b.get('align', 'center'), (v) => b.set('align', v), null, 'center'));
    out.push(miniSlider('Dikey Konum', () => (b.get('y', 0.86) == null ? 0.86 : b.get('y', 0.86)),
      (v) => b.set('y', v), { min: 0, max: 1, step: 0.005, percent: true, def: 0.86 }));
    out.push(miniSelect('Dikey Hiza', [['top', 'Üst'], ['middle', 'Orta'], ['bottom', 'Alt']],
      () => b.get('vAlign', 'middle'), (v) => b.set('vAlign', v), null, 'middle'));
    out.push(miniSlider('Boyut', () => (b.get('size', 0.042) == null ? 0.042 : b.get('size', 0.042)),
      (v) => b.set('size', v), { min: 0.015, max: 0.16, step: 0.002, fmt: (v) => (v * 100).toFixed(1) + '%', def: 0.042 }));
    return out;
  }

  function nowplayingTypeKids(l, cfg, rerender) {
    const el = P().el;
    const b = nowplayingBag(l, cfg);
    const showToggle = (key, label, def) => miniToggle(label,
      () => (b.showOf()[key] === undefined ? def : !!b.showOf()[key]),
      (v) => b.setShow(key, v), rerender);
    const out = [
      showToggle('title', 'Parça Adı', true),
      showToggle('artist', 'Sanatçı', true),
      showToggle('album', 'Albüm', false),
    ];
    if (b.fromSystem) {
      out.push(showToggle('appName', 'Oynatıcı Adı', false));
      out.push(showToggle('elapsed', 'Geçen Süre', true));
      out.push(showToggle('remaining', 'Kalan Süre', false));
      out.push(showToggle('total', 'Toplam Süre', true));
      out.push(showToggle('bar', 'İlerleme Çubuğu', true));
    }
    out.push(miniToggle('Parça ve Sanatçı Tek Satırda', () => !!b.get('oneLine', false), (v) => b.set('oneLine', v), rerender));
    if (b.get('oneLine', false)) {
      out.push(P().row('Ayırıcı', el('input', {
        class: 'p-in', type: 'text', value: b.get('separator', ' — '),
        oninput: (e) => { b.set('separator', e.target.value); P().push(false); },
      })));
    }
    if (b.fromSystem) {
      out.push(P().row('Süre Ayırıcı', el('input', {
        class: 'p-in', type: 'text', value: b.get('timeSeparator', ' / '),
        oninput: (e) => { b.set('timeSeparator', e.target.value); P().push(false); },
      })));
    }
    out.push(miniSelect('Kalıp', [['modern', 'Modern'], ['og', 'OG (Klasik)']],
      () => b.get('style', 'modern'), (v) => {
        b.set('style', v);
        b.np.weight = null; b.np.outline = null; b.np.shadow = null;
        b.np.uppercase = null; b.np.barHeight = null; b.np.barSegments = null;
        b.np.barRadius = null; b.np.barBackOpacity = null;
      }, rerender));
    out.push(miniSelect('Yazı Tipi', NP_FONT_LABELS, () => b.get('font', ''), (v) => b.set('font', v)));
    out.push(miniSlider('Kalınlık', () => (b.get('weight', null) == null ? b.style.weight : b.get('weight')),
      (v) => b.set('weight', Math.round(v / 100) * 100),
      { min: 100, max: 900, step: 100, fmt: (v) => String(Math.round(v / 100) * 100), def: b.style.weight }));
    out.push(miniToggle('Büyük Harf', () => (b.get('uppercase', null) == null ? !!b.style.uppercase : !!b.get('uppercase')),
      (v) => b.set('uppercase', v), null, { def: !!b.style.uppercase }));
    out.push(miniSlider('Satır Aralığı', () => (b.get('lineGap', 0.32) == null ? 0.32 : b.get('lineGap', 0.32)),
      (v) => b.set('lineGap', v), { min: 0, max: 1.2, step: 0.02, def: 0.32 }));
    out.push(miniSlider('Yazı Saydamlığı', () => (b.get('opacity', 1) == null ? 1 : b.get('opacity', 1)),
      (v) => b.set('opacity', v), { min: 0, max: 1, step: 0.01, percent: true, def: 1 }));
    out.push(miniSlider('Kontur', () => (b.get('outline', null) == null ? b.style.outline : b.get('outline')),
      (v) => b.set('outline', v), { min: 0, max: 1, step: 0.02, def: b.style.outline }));
    out.push(miniSlider('Gölge', () => (b.get('shadow', null) == null ? b.style.shadow : b.get('shadow')),
      (v) => b.set('shadow', v), { min: 0, max: 1, step: 0.02, def: b.style.shadow }));
    out.push(miniSlider('En Fazla Genişlik', () => (b.get('maxWidth', 0.8) == null ? 0.8 : b.get('maxWidth', 0.8)),
      (v) => b.set('maxWidth', v), { min: 0.2, max: 1, step: 0.01, percent: true, def: 0.8 }));
    out.push(miniToggle('Uzun Adları Kaydır', () => b.get('scrollLongTitles', true) !== false,
      (v) => b.set('scrollLongTitles', v), rerender, { def: true }));
    if (b.get('scrollLongTitles', true) !== false) {
      out.push(miniSlider('Kaydırma Hızı', () => (b.get('scrollSpeed', 1) == null ? 1 : b.get('scrollSpeed', 1)),
        (v) => b.set('scrollSpeed', v), { min: 0.25, max: 4, step: 0.05, fmt: (v) => (+v).toFixed(2) + '×', def: 1 }));
    }
    if (b.fromSystem && b.showOf().bar !== false) {
      out.push(miniSlider('Genişlik', () => (b.get('barWidth', 0.42) == null ? 0.42 : b.get('barWidth', 0.42)),
        (v) => b.set('barWidth', v), { min: 0.05, max: 1, step: 0.01, percent: true, def: 0.42 }));
      out.push(miniSlider('Çubuk Kalınlığı', () => (b.get('barHeight', null) == null ? b.style.barHeight : b.get('barHeight')),
        (v) => b.set('barHeight', v), { min: 0.001, max: 0.04, step: 0.001, fmt: (v) => (v * 100).toFixed(1) + '%', def: b.style.barHeight }));
      out.push(miniSlider('Bölme Sayısı', () => (b.get('barSegments', null) == null ? b.style.barSegments : b.get('barSegments')),
        (v) => b.set('barSegments', Math.round(v)),
        { min: 0, max: 80, step: 1, fmt: (v) => (v < 1 ? 'kesintisiz' : Math.round(v) + ' bölme'), def: b.style.barSegments }));
      out.push(miniSlider('Yazıyla Arası', () => (b.get('barGap', 0.5) == null ? 0.5 : b.get('barGap', 0.5)),
        (v) => b.set('barGap', v), { min: 0, max: 2, step: 0.05, def: 0.5 }));
      out.push(miniSlider('Zemin Koyuluğu', () => (b.get('barBackOpacity', null) == null ? b.style.barBackOpacity : b.get('barBackOpacity')),
        (v) => b.set('barBackOpacity', v), { min: 0, max: 1, step: 0.02, percent: true, def: b.style.barBackOpacity }));
    }
    return out;
  }

  function nowplayingMotionKids(l, cfg) {
    const b = nowplayingBag(l, cfg);
    const spAnim = (window.SVNowPlaying && window.SVNowPlaying.speedOf)
      ? window.SVNowPlaying.speedOf(b.get('speed', 'normal'))
      : { anim: 0.5 };
    return [
      miniSelect('Giriş', NP_ANIM_LABELS, () => b.get('animation', 'slideUp'), (v) => b.set('animation', v)),
      miniSlider('Giriş Süresi', () => (b.get('animDuration', null) == null ? spAnim.anim : b.get('animDuration')),
        (v) => b.set('animDuration', v), { min: 0.05, max: 3, step: 0.05, fmt: (v) => (+v).toFixed(2) + ' sn', def: spAnim.anim }),
    ];
  }

  function nowplayingAudioKids(l, cfg) {
    const b = nowplayingBag(l, cfg);
    return [
      miniSlider('Bas Nabzı', () => (b.get('audioScale', 0.04) == null ? 0.04 : b.get('audioScale', 0.04)),
        (v) => b.set('audioScale', v), { min: 0, max: 0.4, step: 0.01, def: 0.04 }),
    ];
  }

  /* Metin kartı da yığın açıkken gizlenir. Konum Dönüşüm sekmesinde,
     nabız Sese Tepki sekmesinde, giriş Hareket sekmesindedir. */
  function textTypeKids(txt) {
    const weightDef = txt.source === 'now' ? 800 : 700;
    return [
      miniSelect('Yazı Tipi', TEXT_FONT_LABELS, () => txt.font || TEXT_FONT_LABELS[0][0], (v) => { txt.font = v; }, null, TEXT_FONT_LABELS[0][0]),
      miniSlider('Kalınlık', () => (txt.weight == null ? weightDef : txt.weight), (v) => { txt.weight = Math.round(v / 100) * 100; },
        { min: 100, max: 900, step: 100, fmt: (v) => String(Math.round(v / 100) * 100), def: weightDef }),
      miniSlider('Yazı Saydamlığı', () => (txt.opacity == null ? 1 : txt.opacity), (v) => { txt.opacity = v; },
        { min: 0, max: 1, step: 0.01, percent: true, def: 1 }),
      miniSlider('Kontur', () => (txt.outline == null ? 0 : txt.outline), (v) => { txt.outline = v; },
        { min: 0, max: 1, step: 0.02, def: 0 }),
      miniSlider('Gölge', () => (txt.shadow == null ? 0 : txt.shadow), (v) => { txt.shadow = v; },
        { min: 0, max: 1, step: 0.02, def: 0 }),
    ];
  }

  function textMotionKids(txt) {
    return [
      miniSelect('Giriş', TEXT_ANIM_LABELS, () => txt.animation || 'fade', (v) => { txt.animation = v; }, null, 'fade'),
      miniSlider('Giriş Süresi', () => (txt.animDuration == null ? 0.45 : txt.animDuration),
        (v) => { txt.animDuration = v; }, { min: 0.05, max: 2, step: 0.05, fmt: (v) => (+v).toFixed(2) + ' sn', def: 0.45 }),
    ];
  }

  function textAudioKids(txt, rerender) {
    const pulseDef = txt.source === 'now' ? 0 : 0.12;
    const out = [
      miniSlider('Bas Nabzı', () => (txt.audioScale == null ? pulseDef : txt.audioScale),
        (v) => { txt.audioScale = v; }, { min: 0, max: 0.6, step: 0.01, def: pulseDef }),
      miniSlider('Titreşim', () => txt.audioJitter || 0, (v) => { txt.audioJitter = v; },
        { min: 0, max: 1, step: 0.02, def: 0 }),
      miniToggle('Harf Harf Tepki', () => !!txt.perCharacter, (v) => { txt.perCharacter = v; }, rerender, { def: false }),
    ];
    if (txt.perCharacter) {
      out.push(miniSlider('Harf Yükselmesi', () => (txt.audioLift == null ? 0.25 : txt.audioLift),
        (v) => { txt.audioLift = v; }, { min: 0, max: 1, step: 0.02, def: 0.25 }));
    }
    return out;
  }

  /* Kamera adları izin verilene kadar boş gelebilir. Liste katman kartında
     tutulur; yığın açıkken klasik medya kartı görünmez. */
  let mediaCameras = null;
  function refreshMediaCameras() {
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
    if (!md || !md.enumerateDevices) {
      mediaCameras = [];
      return Promise.resolve();
    }
    return md.enumerateDevices().then((all) => {
      mediaCameras = (all || []).filter((d) => d && d.kind === 'videoinput').map((d) => ({
        id: d.deviceId,
        label: d.label || '',
      }));
    }).catch(() => { mediaCameras = []; });
  }

  /* Bir katmanın kendi kaynağına ait ayarlar.

     Her katman eklenen modun (Barlar, Dalga, Çember, Gradyan vb.) kendine
     has ayarlarını l.settings içinde benzersiz ve bağımsız olarak tutar. */
  function layerOwnSettings(l, rerender) {
    const el = P().el;
    const cfg = P().cfg();
    const def = (window.SV && window.SV.defaultConfig) ? window.SV.defaultConfig() : {};
    const out = [];

    if (l.kind === 'media') {
      l.settings = l.settings || {};
      const defMedia = def.media || { source: 'webcam', fit: 'cover', loop: true, mirror: false };
      const m = (l.settings.media = l.settings.media || (l.id === 'ly_media' && cfg.media ? Object.assign({}, cfg.media, { enabled: true }) : Object.assign({}, defMedia, { enabled: true })));
      out.push(miniSelect('Medya Kaynağı', [['webcam', 'Web Kamerası'], ['file', 'Video Dosyası']],
        () => m.source || 'webcam', (v) => { m.source = v; }, rerender));

      if ((m.source || 'webcam') !== 'file') {
        const opts = [['', 'Varsayılan kamera']];
        (mediaCameras || []).forEach((c, i) => {
          if (c && c.id) opts.push([c.id, c.label || ('Kamera ' + (i + 1))]);
        });
        if (m.deviceId && !opts.some((o) => o[0] === m.deviceId)) opts.push([m.deviceId, 'Kayıtlı kamera']);
        out.push(miniSelect('Kamera', opts, () => m.deviceId || '', (v) => {
          m.deviceId = v;
          const cam = (mediaCameras || []).find((c) => c && c.id === v);
          m.deviceLabel = v ? ((cam && cam.label) || '') : '';
          m.enabled = true;
        }, rerender, ''));
        if (m.deviceId && !m.deviceLabel) {
          const known = (mediaCameras || []).find((c) => c && c.id === m.deviceId && c.label);
          if (known) {
            m.deviceLabel = known.label;
            P().push(true);
          }
        }
        const fault = window.SVMediaWarning ? window.SVMediaWarning(m.deviceId || '') : '';
        if (fault) out.push(el('div', { class: 'studio-note media-fault', text: fault }));
        out.push(el('div', { class: 'row' }, [
          el('button', {
            class: 'btn ghost small', type: 'button', icon: 'refresh', text: 'Kameraları Yenile',
            onclick: async () => { await refreshMediaCameras(); rerender(); },
          }),
        ]));
        out.push(el('div', {
          class: 'studio-note dim-hint',
          text: 'Bu katmanın kamerasıdır. İkinci bir medya katmanı başka bir kamerayı aynı anda açar. OBS yayın katmanı kamerayı tarayıcıdan açmaz; görüntü bu uygulamadan gider. Adlar, kameraya izin verilince dolar.',
        }));
        if (mediaCameras == null) {
          mediaCameras = [];
          refreshMediaCameras().then(() => rerender());
        }
      }
      if ((m.source || 'webcam') === 'file') {
        // Seçili dosyanın adı ve küçük bir ön izlemesi
        const info = el('div', { class: 'row' }, [
          el('label', { class: 'lbl', text: 'Dosya' }),
          el('span', { class: 'dim-hint', text: m.file ? (m.fileName || 'seçildi') : 'seçilmedi' }),
        ]);
        out.push(el('div', { class: 'ctrl' }, [info]));
        if (m.file) {
          const prev = el('video', { class: 'layer-preview', muted: true, loop: true, autoplay: true, playsinline: true });
          prev.muted = true;
          prev.src = m.file;
          prev.play().catch(() => { /* ön izleme oynatılamazsa satır yine de dursun */ });
          out.push(prev);
        }
        out.push(el('div', { class: 'row' }, [
          el('button', {
            class: 'btn small', type: 'button', icon: 'film', text: m.file ? 'Videoyu Değiştir' : 'Video Seç',
            onclick: async () => {
              if (window.api && window.api.pickVideo) {
                const r = await window.api.pickVideo();
                if (!r) return;
                m.file = r.url;
                m.fileName = r.name;
                m.libraryId = '';
                m.enabled = true;
                P().push(true);
                rerender();
              } else {
                pickVideoFile((url, name) => {
                  m.file = url;
                  m.fileName = name;
                  m.libraryId = '';
                  m.enabled = true;
                  P().push(true);
                  rerender();
                });
              }
            },
          }),
          m.file ? el('button', {
            class: 'btn ghost small danger', type: 'button', text: 'Kaldır',
            onclick: () => {
              m.file = '';
              m.fileName = '';
              m.libraryId = '';
              P().push(true);
              rerender();
            },
          }) : null,
        ].filter(Boolean)));
        if (window.SVMediaLibUi) {
          out.push(window.SVMediaLibUi.mount({
            selectedId: m.libraryId || '',
            onPick: (it) => {
              if (!it || !it.url) return;
              m.source = 'file';
              m.file = it.url;
              m.fileName = it.name || '';
              m.libraryId = it.id || '';
              m.enabled = true;
              P().push(true);
              rerender();
            },
            onRemove: (it) => {
              if (!window.SVMediaLibUi.forget(P().cfg(), it)) return;
              P().push(true);
              rerender();
            },
          }));
        }
        out.push(miniToggle('Döngüde Oynat', () => m.loop !== false, (v) => { m.loop = v; }));
      }
      out.push(miniSelect('Sığdırma', [['cover', 'Kapla'], ['contain', 'Sığdır'], ['stretch', 'Ger']],
        () => m.fit || 'cover', (v) => { m.fit = v; }));
      out.push(miniToggle('Aynala', () => !!m.mirror, (v) => { m.mirror = v; }));
      if (!m.enabled) {
        out.push(el('div', { class: 'studio-note dim-hint', text: 'Medya kapalı. Kaynak seçilince açılır.' }));
      }
      return out;
    }

    if (l.kind === 'logo') {
      l.settings = l.settings || {};
      const defLogo = def.logo || { scale: 0.22, pulse: 0.3, opacity: 1, glow: 0, x: 0.5, y: 0.5 };
      const baseLogo = (cfg.logo && (cfg.logo.src || cfg.logo.x !== undefined || cfg.logo.y !== undefined)) ? cfg.logo : defLogo;
      const lg = (l.settings.logo = l.settings.logo || Object.assign({ enabled: true, src: (cfg.logo && cfg.logo.src) || '' }, baseLogo, { enabled: true }));
      if (cfg.logo && cfg.logo.src && !lg.src) lg.src = cfg.logo.src;
      if (lg.x === undefined) lg.x = (cfg.logo && cfg.logo.x !== undefined) ? cfg.logo.x : 0.5;
      if (lg.y === undefined) lg.y = (cfg.logo && cfg.logo.y !== undefined) ? cfg.logo.y : 0.5;
      if (lg.scale === undefined) lg.scale = (cfg.logo && cfg.logo.scale !== undefined) ? cfg.logo.scale : 0.22;
      const getL = (k, fallback) => lg[k] !== undefined ? lg[k] : (defLogo[k] !== undefined ? defLogo[k] : fallback);
      const setL = (k, val) => {
        lg[k] = val;
      };

      const logoWin = isWindowsPlatform();
      if (!logoWin) lg.source = 'manual';
      if (logoWin) {
        out.push(miniSelect('Resim Kaynağı', [
          ['auto', 'Otomatik (Şarkı resmi varsa göster, yoksa özel)'],
          ['manual', 'Özel Resim (Yalnızca seçilen dosya)'],
          ['track', 'Sadece Çalan Şarkı Resmi'],
        ], () => lg.source || 'auto', (v) => {
          lg.source = v;
          P().push(true);
          rerender();
        }, undefined, 'auto'));
      }

      const mode = logoWin ? (lg.source || 'auto') : 'manual';
      if (mode === 'track') {
        const live = (window.SVNowLive && window.SVNowLive.state && window.SVNowLive.state.has) ? window.SVNowLive.state : null;
        out.push(el('div', {
          class: 'studio-note dim-hint',
          text: 'Yalnızca çalan şarkının albüm kapağı/resmi gösterilir. Şarkı sözü / çalan parça sistemi aktifken şarkı çalınca otomatik devreye girer.',
        }));
        if (live && live.artwork) {
          out.push(el('img', { class: 'layer-preview', src: live.artwork, alt: 'Çalan Şarkı Kapağı' }));
        }
      } else {
        const info = el('div', { class: 'row' }, [
          el('label', { class: 'lbl', text: 'Özel Logo Görseli' }),
          el('span', { class: 'dim-hint', text: lg.src ? 'seçildi' : 'seçilmedi' }),
        ]);
        out.push(el('div', { class: 'ctrl' }, [info]));
        const previewSrc = lg.src || (lg.libraryId && window.SVGif && window.SVGif.libraryUrl(lg.libraryId));
        if (previewSrc) out.push(el('img', { class: 'layer-preview', src: previewSrc, alt: '' }));
        out.push(el('div', { class: 'row' }, [
          el('button', {
            class: 'btn small', type: 'button', icon: 'image', text: lg.src ? 'Logoyu Değiştir' : 'Logo Seç',
            onclick: () => {
              pickImage((dataUrl, fileName) => {
                lg.src = dataUrl;
                lg.libraryId = '';
                lg.kind = (fileName && /\.gif$/i.test(fileName)) || /^data:image\/gif/i.test(dataUrl) ? 'gif' : 'image';
                lg.enabled = true;
                P().push(true);
                rerender();
              });
            },
          }),
          lg.src || lg.libraryId ? el('button', {
            class: 'btn ghost small danger', type: 'button', text: 'Kaldır',
            onclick: () => {
              lg.src = '';
              lg.libraryId = '';
              lg.kind = '';
              P().push(true);
              rerender();
            },
          }) : null,
        ].filter(Boolean)));
        if (mode === 'auto') {
          out.push(el('div', {
            class: 'studio-note dim-hint',
            text: 'Otomatik mod: Çalan şarkının kapağı varsa gösterilir; parça çalmıyorsa veya kapağı yoksa bu özel resim gösterilir.',
          }));
        }
      }
      out.push(miniSlider('Yatay Konum (X)', () => getL('x', 0.5), (v) => setL('x', v), { min: 0, max: 1, step: 0.01, percent: true, def: 0.5}));
      out.push(miniSlider('Dikey Konum (Y)', () => getL('y', 0.5), (v) => setL('y', v), { min: 0, max: 1, step: 0.01, percent: true, def: 0.5}));
      out.push(el('div', { class: 'row', style: 'margin-bottom: 6px;' }, [
        el('button', {
          class: 'btn ghost tiny', type: 'button', icon: 'target', text: 'Otomatik Ortala (50%)',
          onclick: () => {
            lg.x = 0.5;
            lg.y = 0.5;
            P().push(true);
            rerender();
          },
        }),
      ]));
      out.push(miniSlider('Boyut', () => getL('scale', 0.22), (v) => setL('scale', v), { min: 0.05, max: 0.9, step: 0.01, percent: true, def: 0.22}));
      out.push(miniSlider('Nabız', () => getL('pulse', 0.3), (v) => setL('pulse', v), { min: 0, max: 1, step: 0.01, percent: true, def: 0.3}));
      out.push(miniSlider('Parlama (Glow)', () => getL('glow', 0), (v) => setL('glow', v), { min: 0, max: 1, step: 0.02, percent: true, def: 0}));
      out.push(miniSlider('Köşe / Oval', () => getL('cornerRadius', 0), (v) => setL('cornerRadius', v), { min: 0, max: 0.5, step: 0.01, percent: true, def: 0}));
      out.push(miniSlider('Saydamlık', () => getL('opacity', 1), (v) => setL('opacity', v), { min: 0, max: 1, step: 0.02, percent: true, def: 1}));
      const gifOn = (lg.kind === 'gif') || (window.SVGif && window.SVGif.isAnimatedLogo && window.SVGif.isAnimatedLogo(lg, lg.src));
      if (gifOn) {
        out.push(miniSlider('Oynatma Hızı', () => getL('speed', 1), (v) => setL('speed', v), { min: 0.1, max: 3, step: 0.01, def: 1}));
        out.push(miniSelect('Döngü', [['loop', 'Tekrar'], ['pingpong', 'Gidiş-Dönüş'], ['once', 'Bir Kez']],
          () => lg.loop || 'loop', (v) => { lg.loop = v; }, undefined, 'loop'));
        out.push(miniToggle('Ters Oynat', () => !!lg.reverse, (v) => { lg.reverse = v; }));
        out.push(miniToggle('Kenar Yumuşatma', () => lg.smooth !== false, (v) => { lg.smooth = v; }));
        out.push(miniSlider('Parlaklık', () => getL('brightness', 1), (v) => setL('brightness', v), { min: 0.2, max: 2, step: 0.01, def: 1}));
        out.push(miniSlider('Renk Kayması', () => getL('hue', 0), (v) => setL('hue', v), { min: 0, max: 1, step: 0.01, percent: true, def: 0}));
        out.push(miniSlider('Doygunluk', () => getL('saturate', 1), (v) => setL('saturate', v), { min: 0, max: 2, step: 0.01, def: 1}));
        out.push(miniSelect('Karışım', [['normal', 'Normal'], ['screen', 'Ekran'], ['add', 'Ekle']],
          () => lg.blend || 'normal', (v) => { lg.blend = v; }, undefined, 'normal'));
        out.push(miniSelect('Ses Bandı', [['bass', 'Bas'], ['mid', 'Orta'], ['treble', 'Tiz'], ['level', 'Seviye']],
          () => lg.audioBand || 'bass', (v) => { lg.audioBand = v; }, undefined, 'bass'));
        out.push(miniSlider('Ses → Hız', () => getL('audioSpeed', 0), (v) => setL('audioSpeed', v), { min: 0, max: 1, step: 0.01, percent: true, def: 0}));
        out.push(miniSlider('Ses → Parlaklık', () => getL('audioBrightness', 0), (v) => setL('audioBrightness', v), { min: 0, max: 1, step: 0.01, percent: true, def: 0}));
        out.push(miniSlider('Ses → Saydamlık', () => getL('audioOpacity', 0), (v) => setL('audioOpacity', v), { min: 0, max: 1, step: 0.01, percent: true, def: 0}));
        out.push(miniSlider('Ritim Parlaması', () => getL('beatFlash', 0), (v) => setL('beatFlash', v), { min: 0, max: 1, step: 0.01, percent: true, def: 0}));
        out.push(miniSlider('Ses → Renk', () => getL('audioHue', 0), (v) => setL('audioHue', v), { min: 0, max: 1, step: 0.01, percent: true, def: 0}));
      }
      if ((lg.source || 'auto') !== 'track' && window.SVLogoLibUi) {
        out.push(window.SVLogoLibUi.mount({
          selectedId: lg.libraryId || '',
          onPick: (it) => {
            const wasGif = (lg.kind === 'gif');
            lg.libraryId = it.id;
            lg.src = '';
            lg.kind = it.kind || '';
            lg.enabled = true;
            if (window.SVLogoRuntime && window.SVLogoRuntime.warm) window.SVLogoRuntime.warm(it.id);
            P().push(true);
            rerender();
          },
          onRemove: (it) => {
            if (lg.libraryId !== it.id) return;
            lg.libraryId = '';
            if (!lg.src) lg.kind = '';
            P().push(true);
            rerender();
          },
        }));
      }
      return out;
    }

    if (l.kind === 'sprites') {
      l.settings = l.settings || {};
      const imgs = (l.settings.images = l.settings.images || {
        enabled: true,
        items: (l.id && l.id.startsWith('ly_spr') && cfg.images && Array.isArray(cfg.images.items) && cfg.images.items.length)
          ? JSON.parse(JSON.stringify(cfg.images.items))
          : [],
      });
      if (!Array.isArray(imgs.items)) imgs.items = [];
      const items = imgs.items;

      const imgList = el('div', { class: 'ctrl' });
      if (!items.length) {
        imgList.appendChild(el('div', { class: 'studio-note dim-hint', text: 'Henüz görsel nesne eklenmedi. Aşağıdaki düğmeyle bir görsel seçin.' }));
      }
      items.forEach((it, idx) => {
        const thumb = it.src ? el('img', { class: 'layer-preview', src: it.src, style: 'max-height: 48px; width: auto;' }) : null;
        const nameInput = el('input', {
          class: 'p-in', type: 'text', value: it.name || ('Görsel ' + (idx + 1)),
          onchange: (e) => { it.name = e.target.value.trim() || 'Görsel'; P().push(true); },
        });
        const repBtn = el('button', {
          class: 'btn ghost tiny', type: 'button', icon: 'image', text: 'Değiştir',
          onclick: () => {
            pickImage((dataUrl) => {
              it.src = dataUrl;
              P().push(true);
              rerender();
            });
          },
        });
        const delBtn = el('button', {
          class: 'btn ghost tiny danger', type: 'button', icon: 'trash', text: 'Sil',
          onclick: () => {
            imgs.items.splice(idx, 1);
            P().push(true);
            rerender();
          },
        });
        imgList.appendChild(el('div', { class: 'img-head', style: 'margin-bottom: 6px;' }, [
          thumb,
          el('div', { class: 'img-headmain' }, [nameInput, el('div', { class: 'up-actions' }, [repBtn, delBtn])]),
        ]));
        imgList.appendChild(miniSlider('Köşe / Oval (' + (it.name || ('#' + (idx + 1))) + ')', () => (it.cornerRadius == null ? 0 : it.cornerRadius), (v) => { it.cornerRadius = v; }, { min: 0, max: 0.5, step: 0.01, percent: true, def: 0}));
      });
      out.push(imgList);

      out.push(el('button', {
        class: 'btn small', type: 'button', icon: 'plus', text: 'Görsel Ekle',
        onclick: () => {
          pickImage((dataUrl, fileName) => {
            imgs.items.push(window.SV.imageItem({ src: dataUrl, name: fileName || ('Görsel ' + (imgs.items.length + 1)) }));
            imgs.enabled = true;
            P().push(true);
            rerender();
          });
        },
      }));
      return out;
    }

    if (l.kind === 'visualizer' && l.type === 'text') {
      l.settings = l.settings || {};
      const defText = def.text || {
        source: 'static', content: '', size: 0.08, align: 'center', nowSource: 'system',
      };
      const txt = (l.settings.text = l.settings.text || (l.id === 'ly_text' && cfg.text
        ? Object.assign({}, defText, JSON.parse(JSON.stringify(cfg.text)), { enabled: true })
        : Object.assign({}, defText, { enabled: true })));
      txt.enabled = true;
      const src = txt.source || 'static';

      out.push(miniSelect('Metin Kaynağı', [['static', 'Sabit Metin'], ['now', 'Çalan Parça'], ['lyrics', 'Şarkı Sözü (LRC / SRT)']],
        () => src, (v) => { txt.source = v; }, rerender));

      if (src === 'static') {
        const area = el('textarea', {
          class: 'p-in txt-area', rows: 2, value: txt.content || '',
          oninput: (e) => {
            txt.content = e.target.value;
            P().push(false);
          },
        });
        out.push(el('div', { class: 'ctrl' }, [el('label', { class: 'lbl', text: 'Yazı Metni' }), area]));
        out.push(miniToggle('Kayan Yazı', () => !!txt.marquee, (v) => { txt.marquee = v; }, rerender, { def: false }));
        if (txt.marquee) {
          out.push(miniSlider('Kayma Hızı', () => txt.marqueeSpeed || 0.12, (v) => { txt.marqueeSpeed = v; }, { min: 0.02, max: 0.6, step: 0.01, def: 0.12 }));
        }
      } else if (src === 'now') {
        const isWin = isWindowsPlatform();
        if (!isWin && (txt.nowSource || 'system') === 'system') txt.nowSource = 'manual';
        const isAuto = isWin && (txt.nowSource || 'system') === 'system';

        out.push(miniSelect('Gösterilen Alan', [
          ['title', 'Parça Adı'],
          ['artist', 'Sanatçı Adı'],
          ['both', 'Parça ve Sanatçı'],
        ], () => txt.field || 'both', (v) => { txt.field = v; }, rerender));

        if (isWin && isAuto && window.api && window.api.nowPlayingSubscribe) {
          window.api.nowPlayingSubscribe(true);
        }
        if (isWin) out.push(miniToggle('Sistemden Otomatik Doldur', () => isAuto, (v) => {
          txt.nowSource = v ? 'system' : 'manual';
          if (v && window.api && window.api.nowPlayingSubscribe) {
            window.api.nowPlayingSubscribe(true);
          }
        }, rerender));

          if (isWin) out.push(miniToggle('Şarkı Resmini Göster', () => txt.showArtwork !== false, (v) => {
            txt.showArtwork = v;
            P().push(true);
          }, rerender));

          if (isAuto) {
            const live = (window.SVNowLive && window.SVNowLive.state && window.SVNowLive.state.has)
              ? window.SVNowLive.state : null;
            const statusText = live
              ? ([live.title, live.artist].filter(Boolean).join(' — ') || '(adsız)')
              : 'Şu anda sistemde çalan parça yok (yedek kullanılır)';
            const statusClass = live ? 'txt-info np-status ok' : 'txt-info np-status';
            out.push(P().row('Canlı Medya', el('span', { class: statusClass, icon: live ? (live.playing ? 'play' : 'pause') : '', text: statusText })));

            out.push(el('div', { class: 'row' }, [
              el('button', {
                class: 'btn small ghost',
                type: 'button',
                icon: 'import', text: 'Çalan Şarkıyı Alanlara Doldur',
                title: 'Çalan parçanın adını ve sanatçısını aşağıdaki yedek kutularına aktarır.',
                onclick: () => {
                  const cur = (window.SVNowLive && window.SVNowLive.state && window.SVNowLive.state.has)
                    ? window.SVNowLive.state : null;
                  if (!cur || (!cur.title && !cur.artist)) {
                    P().toast('Sistemde çalan aktif parça bulunamadı.');
                    return;
                  }
                  txt.nowPlaying = txt.nowPlaying || {};
                  if (cur.title) txt.nowPlaying.title = cur.title;
                  if (cur.artist) txt.nowPlaying.artist = cur.artist;
                  if (cur.artwork) txt.nowPlaying.artwork = cur.artwork;
                  P().push(true);
                  rerender();
                  P().toast('Çalan parça bilgileri yedek alanlara aktarıldı.');
                },
              }),
            ]));

            out.push(el('div', {
              class: 'studio-note dim-hint',
              text: 'Sistem medya oturumundan (Spotify, YouTube vb.) çalan parça otomatik okunur. Çalmadığında aşağıdaki yedek bilgiler gösterilir.',
            }));
          } else {
            const cur = (window.SVNowLive && window.SVNowLive.state && window.SVNowLive.state.has)
              ? window.SVNowLive.state : null;
            if (cur && (cur.title || cur.artist)) {
              out.push(el('div', { class: 'row' }, [
                el('button', {
                  class: 'btn small ghost',
                  type: 'button',
                  icon: 'import', text: 'Çalan Şarkıyı Doldur (' + ([cur.title, cur.artist].filter(Boolean).join(' — ')) + ')',
                  onclick: () => {
                    txt.nowPlaying = txt.nowPlaying || {};
                    if (cur.title) txt.nowPlaying.title = cur.title;
                    if (cur.artist) txt.nowPlaying.artist = cur.artist;
                    if (cur.artwork) txt.nowPlaying.artwork = cur.artwork;
                    P().push(true);
                    rerender();
                    P().toast('Şarkı bilgileri alanlara yazıldı.');
                  },
                }),
              ]));
            }
          }

        const titleLabel = isAuto ? 'Yedek Parça Adı' : 'Parça Adı';
        const artistLabel = isAuto ? 'Yedek Sanatçı' : 'Sanatçı';
        const titleVal = txt.field === 'title' ? (txt.content || '') : ((txt.nowPlaying && txt.nowPlaying.title) || (txt.content || ''));
        const artistVal = txt.field === 'artist' ? (txt.content || '') : ((txt.nowPlaying && txt.nowPlaying.artist) || '');

        if (txt.field === 'title') {
          out.push(P().row(titleLabel, el('input', {
            class: 'p-in', type: 'text', value: titleVal,
            placeholder: isAuto ? 'Sistemde şarkı yokken gösterilecek başlık' : 'Örn: Şarkı Adı',
            oninput: (e) => {
              txt.content = e.target.value;
              txt.nowPlaying = txt.nowPlaying || {};
              txt.nowPlaying.title = e.target.value;
              P().push(false);
            },
          })));
        } else if (txt.field === 'artist') {
          out.push(P().row(artistLabel, el('input', {
            class: 'p-in', type: 'text', value: artistVal,
            placeholder: isAuto ? 'Sistemde şarkı yokken gösterilecek sanatçı' : 'Örn: Sanatçı Adı',
            oninput: (e) => {
              txt.content = e.target.value;
              txt.nowPlaying = txt.nowPlaying || {};
              txt.nowPlaying.artist = e.target.value;
              P().push(false);
            },
          })));
        } else {
          out.push(P().row(titleLabel, el('input', {
            class: 'p-in', type: 'text', value: titleVal,
            placeholder: isAuto ? 'Sistemde şarkı yokken gösterilecek başlık' : 'Örn: Şarkı Adı',
            oninput: (e) => {
              txt.nowPlaying = txt.nowPlaying || {};
              txt.nowPlaying.title = e.target.value;
              P().push(false);
            },
          })));
          out.push(P().row(artistLabel, el('input', {
            class: 'p-in', type: 'text', value: artistVal,
            placeholder: isAuto ? 'Sistemde şarkı yokken gösterilecek sanatçı' : 'Örn: Sanatçı Adı',
            oninput: (e) => {
              txt.nowPlaying = txt.nowPlaying || {};
              txt.nowPlaying.artist = e.target.value;
              P().push(false);
            },
          })));
        }
      } else {
        const doc = txt.lyricsSource && window.SVLyrics ? window.SVLyrics.parse(txt.lyricsSource) : null;
        const info = doc
          ? doc.lines.length + ' satır · ' + doc.format.toUpperCase()
          : 'yüklü dosya yok';
        out.push(P().row('Dosya', el('span', { class: 'txt-info', text: (txt.lyricsName || '') + ' ' + info })));
        out.push(el('div', { class: 'row' }, [
          el('button', {
            class: 'btn small', type: 'button', icon: 'folder-open', text: 'Söz Dosyası Yükle',
            onclick: async () => {
              if (!window.api || !window.api.importShaderText) { P().toast('İçe aktarma kullanılamıyor.'); return; }
              const r = await window.api.importShaderText();
              if (!r || !r.ok) return;
              txt.lyricsSource = r.text;
              txt.lyricsName = r.name || '';
              P().push(true);
              const d = window.SVLyrics ? window.SVLyrics.parse(r.text) : null;
              rerender();
              P().toast(d ? (d.lines.length + ' satır okundu') : 'Yüklendi.');
            },
          }),
          el('button', {
            class: 'btn ghost small', type: 'button', text: 'Temizle',
            onclick: () => {
              txt.lyricsSource = '';
              txt.lyricsName = '';
              P().push(true);
              rerender();
            },
          }),
        ]));
        if (txt.lyricsFollow !== true && window.SVLyricsClock && window.SVLyricsClock.controls) {
          out.push(window.SVLyricsClock.controls({ el }));
        }
        if (isWindowsPlatform() && window.SVLyricsLibUi && window.SVLyricsLibUi.block) {
          const extra = window.SVLyricsLibUi.block({ txt, rerender });
          for (let i = 0; i < extra.length; i++) out.push(extra[i]);
        }
        out.push(miniSlider('Senkron Kayması', () => txt.offset || 0, (v) => { txt.offset = v; }, {
          min: -10, max: 10, step: 0.05, fmt: (v) => (v > 0 ? '+' : '') + (+v).toFixed(2) + ' sn', def: 0,
        }));
        out.push(miniToggle('Karaoke Vurgusu', () => txt.karaoke !== false, (v) => { txt.karaoke = v; }, rerender, { def: true }));
      }

      /* Kip bu yazının kendisinde durur. Sahne görselleştiricisine yazmak
         diğer metin katmanlarının da aynı kipe geçmesine yol açıyordu. */
      const getTxtMode = () => txt.colorMode
        || (txt.useCustomColor ? 'custom' : null)
        || (cfg.visualizer && cfg.visualizer.colorMode)
        || 'theme';
      const setTxtMode = (m) => {
        txt.colorMode = m;
        txt.useCustomColor = (m === 'custom');
      };
      out.push(miniSegment('Renk Modu', [
        ['custom', 'Sabit Renk'],
        ['theme', 'Renk Teması'],
        ['rainbow', 'Gökkuşağı'],
      ], getTxtMode, setTxtMode, rerender));
      if (getTxtMode() === 'custom') {
        out.push(miniColor('Metin Rengi', () => txt.color || '#ffffff', (v) => { txt.color = v; }, '#ffffff'));
        /* Vurgu yalnız şarkı sözünde söylenen kelimeyi boyar. Sabit yazı ve
           çalan parça bu rengi çizmez; orada göstermek kullanılmayan bir ayar bırakıyordu. */
        if (src === 'lyrics' && txt.karaoke !== false) {
          out.push(miniColor('Vurgu Rengi', () => txt.colorHighlight || '#ffd23f', (v) => { txt.colorHighlight = v; }, '#ffd23f'));
          out.push(el('div', { class: 'studio-note dim-hint',
            text: 'Söylenen kısmı boyar. Sabit yazı ve çalan parça bu rengi kullanmaz.' }));
        }
      }
      const sizeDef = src === 'lyrics' ? 0.07 : src === 'now' ? 0.06 : 0.09;
      const alignDef = src === 'now' ? 'left' : 'center';
      out.push(miniSlider('Yazı Boyutu', () => txt.size == null ? sizeDef : txt.size, (v) => { txt.size = v; },
        { min: 0.01, max: 0.3, step: 0.005, def: sizeDef }));
      out.push(miniSelect('Hizalama', ALIGN_LABELS, () => txt.align || alignDef, (v) => { txt.align = v; }, null, alignDef));
      const yDef = src === 'lyrics' ? 0.82 : src === 'now' ? 0.78 : 0.5;
      out.push(miniSlider('Dikey Konum', () => (txt.y == null ? yDef : txt.y), (v) => { txt.y = v; },
        { min: 0, max: 1, step: 0.005, percent: true, def: yDef }));
      out.push(miniSelect('Dikey Hiza', [['top', 'Üst'], ['middle', 'Orta'], ['bottom', 'Alt']],
        () => txt.vAlign || 'middle', (v) => { txt.vAlign = v; }, null, 'middle'));
      out.push(miniSlider('En Fazla Genişlik', () => (txt.maxWidth == null ? 0.9 : txt.maxWidth), (v) => { txt.maxWidth = v; },
        { min: 0.2, max: 1, step: 0.01, percent: true, def: 0.9 }));
      out.push(miniToggle('Uzun Yazıyı Kaydır', () => txt.scrollOverflow !== false, (v) => { txt.scrollOverflow = v; }, rerender, { def: true }));
      if (txt.scrollOverflow !== false && !txt.marquee) {
        out.push(miniSlider('Kaydırma Hızı', () => (txt.scrollSpeed == null ? 1 : txt.scrollSpeed), (v) => { txt.scrollSpeed = v; },
          { min: 0.25, max: 4, step: 0.05, fmt: (v) => (+v).toFixed(2) + '×', def: 1 }));
      }
      out.push(el('div', { class: 'studio-note dim-hint',
        text: 'Yazı ekrana ya da bu genişliğe sığmazsa kutu ekranın içinde kalır ve yazı ileri geri kayar. Kayan yazı açıkken o döngü kullanılır.' }));
      return out;
    }

    if (l.kind === 'nowplaying' || (l.kind === 'visualizer' && l.type !== 'none' && l.type !== 'custom')) {
      l.settings = l.settings || {};
      /* Katman yazmamışsa motor sahnenin görselleştirici ayarını kullanıyor
         (layers.js layerConfig: cfg.visualizer + katman). Panel fabrika
         değerini gösterince ekranda gökkuşağı çizilirken burada "Renk
         Teması" yazıyordu (#695). Gösterilen değer çizilenle aynı olsun;
         sıfırlama yine fabrika değerine döner. */
      const defVis = Object.assign({}, def.visualizer || {}, cfg.visualizer || {});
      const vs = (l.settings.visualizer = l.settings.visualizer || {});
      if (l.kind === 'nowplaying') l.type = 'nowplaying';
      const getV = (k, fallback) => vs[k] !== undefined ? vs[k] : (defVis[k] !== undefined ? defVis[k] : fallback);
      const setV = (k, val) => { vs[k] = val; };

      // Renk Modu: Sabit Renk · Renk Teması · Gökkuşağı
      const getColorMode = () => {
        if (vs.colorMode) return vs.colorMode;
        if (vs.rainbow !== undefined) return vs.rainbow ? 'rainbow' : 'custom';
        if (defVis.colorMode) return defVis.colorMode;
        return defVis.rainbow ? 'rainbow' : 'custom';
      };

      const setColorMode = (m) => {
        vs.colorMode = m;
        vs.rainbow = (m === 'rainbow');
      };

      out.push(miniSegment('Renk Modu', [
        ['custom', 'Sabit Renk'],
        ['theme', 'Renk Teması'],
        ['rainbow', 'Gökkuşağı'],
      ], getColorMode, (m) => {
        setColorMode(m);
        if (l.type === 'nowplaying') {
          const np = (l.settings.nowplaying = l.settings.nowplaying || {});
          np.colorMode = m;
          np.useCustomColor = (m === 'custom');
        }
      }, rerender));

      if (getColorMode() === 'custom') {
        if (l.type === 'nowplaying') {
          const np = (l.settings.nowplaying = l.settings.nowplaying || {});
          const getNp = (k, fb) => np[k] !== undefined ? np[k] : ((cfg.nowplaying && cfg.nowplaying[k]) || fb);
          const setNp = (k, val) => { np[k] = val; };
          out.push(miniColor('Parça Adı', () => getNp('color', '#ffffff'), (v) => setNp('color', v)));
          out.push(miniColor('İkincil Yazı', () => getNp('colorDim', '#c8c8d0'), (v) => setNp('colorDim', v)));
          if (isWindowsPlatform() && ((cfg.nowplaying && cfg.nowplaying.source) || 'system') === 'system') {
            out.push(miniColor('Çubuk', () => getNp('colorBar', '#3aa6ff'), (v) => setNp('colorBar', v)));
          }
        } else if (l.type === 'text') {
          /* text layers use settings.text; color controls live in the text block above when type===text.
             This branch is for non-text types only — text returns earlier. */
        } else {
          out.push(miniColor('Renk', () => getV('color', '#ff2d3a'), (v) => setV('color', v)));
          if (MC().is('visualizer', l.type, 'color2')) {
            out.push(miniColor('İkincil Renk', () => getV('color2', '#3aa6ff'), (v) => setV('color2', v)));
          }
        }
      }

      // Album cover overlay for Now Playing layers (default off).
      // Layer stack hides the dedicated Now Playing card (notStack), so expose here.
      if (l.type === 'nowplaying') {
        out.push.apply(out, nowplayingLayerControls(l, cfg, rerender));
        const npCover = (l.settings.nowplaying = l.settings.nowplaying || {});
        const getCover = (k, fb) => {
          if (npCover[k] !== undefined) return npCover[k];
          if (cfg.nowplaying && cfg.nowplaying[k] !== undefined) return cfg.nowplaying[k];
          return fb;
        };
        const setCover = (k, val) => { npCover[k] = val; };
        out.push(miniToggle('Kapağı Göster', () => !!getCover('coverOverlay', false), (v) => {
          setCover('coverOverlay', !!v);
        }, rerender));
        if (getCover('coverOverlay', false)) {
          const coverWin = isWindowsPlatform();
          if (!coverWin) setCover('coverSource', 'manual');
          out.push(el('div', { class: 'studio-note dim-hint',
            text: 'Çalan parçanın albüm kapağını yazının yanına veya üstüne yerleştirir. Boyut ekranın kısa kenarına göredir. Kapak yoksa bindirme çizilmez. Varsayılan kapalıdır.' }));
          if (coverWin) {
            out.push(miniSelect('Kapak Kaynağı', [
              ['auto', 'Otomatik (Sistem)'],
              ['manual', 'Elle Yükle'],
            ], () => getCover('coverSource', 'auto'), (v) => setCover('coverSource', v), rerender));
            out.push(el('div', { class: 'studio-note dim-hint',
              text: (getCover('coverSource', 'auto') === 'manual')
                ? 'Elle yüklenen resim yazının yanında gösterilir.'
                : 'Windows’ta kapak çalan parçadan otomatik gelir. İsterseniz kendi resminizi de yükleyebilirsiniz; otomatik kapak yoksa o resim kullanılır.' }));
          } else {
            out.push(el('div', { class: 'studio-note dim-hint',
              text: 'Bu platformda albüm kapağı otomatik okunamaz. Gösterilecek resmi elle yükleyin.' }));
          }
          const artNow = () => {
            const m = npCover.manual || (cfg.nowplaying && cfg.nowplaying.manual) || {};
            return m.artwork || '';
          };
          const setArt = (url) => {
            npCover.manual = Object.assign({}, npCover.manual, { artwork: url || '' });
          };
          if (artNow()) out.push(el('img', { class: 'layer-preview', src: artNow(), alt: 'Kapak Görseli' }));
          out.push(el('div', { class: 'row' }, [
            el('button', {
              class: 'btn small', type: 'button', icon: 'image',
              text: artNow() ? 'Kapağı Değiştir' : 'Kapak Seç',
              onclick: () => {
                pickImage((dataUrl) => { setArt(dataUrl); P().push(true); rerender(); });
              },
            }),
            artNow() ? el('button', {
              class: 'btn ghost small danger', type: 'button', text: 'Kapağı Kaldır',
              onclick: () => { setArt(''); P().push(true); rerender(); },
            }) : null,
          ].filter(Boolean)));
          out.push(miniSlider('Kapak Boyutu', () => getCover('coverSize', 0.14), (v) => setCover('coverSize', v),
            { min: 0.05, max: 0.5, step: 0.01, percent: true, def: 0.14}));
          out.push(miniSlider('Yazı Aralığı', () => getCover('coverGap', 0.35), (v) => setCover('coverGap', v),
            { min: 0, max: 1, step: 0.02, percent: true, def: 0.35}));
          out.push(miniSlider('Köşe / Oval', () => getCover('coverRadius', 0.14), (v) => setCover('coverRadius', v),
            { min: 0, max: 0.5, step: 0.01, percent: true, def: 0.14}));
          out.push(miniSelect('Kapak Sığdırma', [
            ['natural', 'Doğal oran'],
            ['square', 'Kareye ger'],
            ['cover', 'Kareye kapla'],
            ['contain', 'Kareye sığdır'],
          ], () => getCover('coverFit', 'natural'), (v) => setCover('coverFit', v)));
          out.push(miniSelect('Kapak Konumu', [
            ['auto', 'Otomatik (Üstte)'],
            ['left', 'Solda'],
            ['right', 'Sağda'],
            ['top', 'Üstte'],
          ], () => getCover('coverSide', 'auto'), (v) => setCover('coverSide', v)));
          out.push(miniSlider('Kapak Bas Nabzı', () => getCover('coverAudioScale', 0), (v) => setCover('coverAudioScale', v),
            { min: 0, max: 0.4, step: 0.01, def: 0}));
        }
      }

      out.push(miniSlider('Hassasiyet', () => getV('sensitivity', 1), (v) => setV('sensitivity', v), { min: 0.2, max: 3, step: 0.05, def: 1}));
      if (l.type !== 'spectrogram') {
        out.push(miniSlider('Parlama (Glow)', () => getV('glow', 0.2), (v) => setV('glow', v), { min: 0, max: 1, step: 0.02, percent: true, def: 0.2}));
      }

      // Bar / Band ayarları
      if (MC().is('visualizer', l.type, 'bands')) {
        out.push(miniSlider('Bar Sayısı', () => getV('barCount', 64), (v) => setV('barCount', v), { min: 16, max: 160, step: 1, def: 64}));
      }
      if (MC().is('visualizer', l.type, 'gap')) {
        out.push(miniSlider('Bar Boşluğu', () => getV('gap', 0.3), (v) => setV('gap', v), { min: 0, max: 0.8, step: 0.02, percent: true, def: 0.3}));
      }
      if (['bars', 'wave', 'radialWave'].includes(l.type)) {
        out.push(miniToggle('Ayna (Simetri)', () => !!getV('mirror', false), (v) => setV('mirror', v)));
      }

      if (l.type === 'bars') {
        out.push(miniSelect('Yerleşim', [['bottom', 'Alt'], ['center', 'Orta'], ['full', 'Tam']], () => getV('position', 'bottom'), (v) => setV('position', v)));
        out.push(miniSlider('Bar Genişliği', () => getV('barSpan', 1), (v) => setV('barSpan', v), { min: 0.1, max: 1, step: 0.01, percent: true, def: 1}));
        out.push(miniSlider('Yatay Konum', () => getV('barCenterX', 0.5), (v) => setV('barCenterX', v), { min: 0, max: 1, step: 0.01, percent: true, def: 0.5}));
        out.push(miniSlider('Bar Yüksekliği', () => getV('barHeight', 0.9), (v) => setV('barHeight', v), { min: 0.05, max: 1, step: 0.01, percent: true, def: 0.9}));
        out.push(miniSlider('Taban Çizgisi', () => getV('baseline', 1), (v) => setV('baseline', v), { min: 0, max: 1, step: 0.01, percent: true, def: 1}));
      }

      // Tek mod kartıyla aynı koşullar (katalog bayrakları, #638)
      if (MC().is('visualizer', l.type, 'wave')) {
        out.push(miniSlider('Çizgi Kalınlığı', () => getV('lineWidth', 2), (v) => setV('lineWidth', v), { min: 1, max: 12, step: 0.5, def: 2}));
      }
      if (MC().is('visualizer', l.type, 'thick')) {
        out.push(miniSlider('Genlik / Dolgu', () => getV('thickness', 0.5), (v) => setV('thickness', v), { min: 0.1, max: 1, step: 0.02, percent: true, def: 0.5}));
      }

      return out;
    }

    if (l.kind === 'background') {
      l.settings = l.settings || {};
      const defBg = def.background || {};
      const bg = (l.settings.background = l.settings.background || {});
      const getB = (k, fallback) => bg[k] !== undefined ? bg[k] : (defBg[k] !== undefined ? defBg[k] : fallback);
      const setB = (k, val) => { bg[k] = val; };

      /* Yığın açıkken Arkaplan kartı gizli; şeffaflık burada açılır.
         Kök `background.transparent` pencere / yayın / Spout için de gerekir. */
      out.push(miniToggle('Şeffaf Arkaplan', () => !!getB('transparent', false), (v) => {
        setB('transparent', v);
        const list = cfg.layers || [];
        const any = list.some((x) => x && x.kind === 'background' && x.enabled !== false
          && x.settings && x.settings.background && x.settings.background.transparent);
        cfg.background = cfg.background || {};
        cfg.background.transparent = any;
      }, rerender));
      if (getB('transparent', false)) {
        out.push(el('div', { class: 'studio-note dim-hint', text: 'Şeffaf arkaplan bu katmanın koyu yerlerini saydamlar. Görselleştirici penceresi, yayın ve Spout aynı ayarı paylaşır; açık pencereler bu anahtarla yeniden kurulur.' }));
        out.push(miniToggle('Tam Ekran (Görev Çubuğu Dahil)', () => !!(cfg.background && cfg.background.coverTaskbar), (v) => {
          cfg.background = cfg.background || {};
          cfg.background.coverTaskbar = !!v;
        }, rerender));
        if (l.type !== 'solid') {
          out.push(miniSlider('Saydamlık Eşiği', () => {
            const v = getB('transparentKey', cfg.background && cfg.background.transparentKey);
            return v == null ? 0.2 : v;
          }, (v) => {
            setB('transparentKey', v);
            cfg.background = cfg.background || {};
            cfg.background.transparentKey = v;
          }, { min: 0, max: 1, step: 0.01, percent: true, def: 0.2 }));
        }
      }

      const bgSolid = () => (bg.solidColor != null ? bg.solidColor
        : (cfg.background && cfg.background.solidColor) || '#0a0a12');
      if (l.type === 'solid') {
        out.push(miniColor('Düz Renk', bgSolid, (v) => setB('solidColor', v), '#0a0a12'));
        return out;
      }

      /* Same colorMode path as the main Background card (SV.resolveBackgroundColors).
         Kip ve düz renk bu katmanda kalır; sahne alanına yazmak diğer
         arkaplan katmanlarını da aynı kipe çekiyordu. */
      const getBgColorMode = () => (bg.colorMode != null ? bg.colorMode
        : (cfg.background && cfg.background.colorMode) || 'theme');
      const setBgColorMode = (m) => { setB('colorMode', m); };
      out.push(miniSegment('Renk Modu', [
        ['solid', 'Düz Renk'],
        ['theme', 'Renk Teması'],
        ['rainbow', 'Gökkuşağı'],
      ], getBgColorMode, setBgColorMode, rerender));
      if (getBgColorMode() === 'solid') {
        out.push(miniColor('Düz Renk', bgSolid, (v) => setB('solidColor', v), '#0a0a12'));
      }

      if (l.type === 'gradient') {
        const gr = (bg.gradient = bg.gradient || {});
        const defGr = defBg.gradient || {};
        const sceneGr = (cfg.background && cfg.background.gradient) || {};
        /* Katman yazmamışsa ekrandaki sahne değeri görünür. Sıfırlama
           fabrika varsayılanına döner ve yalnız bu katmana yazılır. */
        const getGr = (k) => (gr[k] !== undefined ? gr[k]
          : (sceneGr[k] !== undefined ? sceneGr[k] : defGr[k]));
        const setGr = (k, val) => { gr[k] = val; };
        const sl = (label, key, opts) => {
          out.push(miniSlider(label, () => getGr(key), (v) => setGr(key, v), Object.assign({ def: defGr[key] }, opts)));
        };
        const heading = (text) => out.push(el('div', { class: 'group-label', text }));

        out.push(miniSelect('Stil', [
          ['soft', 'Yumuşak (Parlamasız)'],
          ['plasma', 'Plazma (Parlamalı)'],
        ], () => getGr('style'), (v) => setGr('style', v), undefined, defGr.style));
        sl('Akış Hızı', 'speed', { min: 0, max: 2, step: 0.02 });
        sl('Ses Tepkisi', 'audioReactivity', { min: 0, max: 2, step: 0.02 });

        heading('Hareket');
        sl('Tek Yönlü Kayma', 'drift', { min: 0, max: 1, step: 0.01, percent: true });
        sl('Gezinme Alanı', 'wander', { min: 0, max: 2, step: 0.02 });
        sl('Dolanma Miktarı', 'orbit', { min: 0, max: 2, step: 0.02 });
        sl('İç Dönüş (Swirl)', 'swirl', { min: 0, max: 2, step: 0.02 });
        sl('Bozulma (Akışkanlık)', 'warp', { min: 0, max: 2, step: 0.02 });

        heading('Görünüm');
        sl('Ölçek (Yoğunluk)', 'scale', { min: 0.4, max: 3, step: 0.05 });
        sl('Parlaklık (Temel)', 'brightness', { min: 0.4, max: 1.6, step: 0.02 });
        out.push(miniToggle('Hat Çizgilerini Gizle', () => getGr('hideLines') !== false, (v) => setGr('hideLines', v), undefined, { def: defGr.hideLines !== false }));
        sl('Gren', 'grain', { min: 0, max: 0.2, step: 0.005, fmt: (v) => (+v).toFixed(3) });
        sl('Vinyet', 'vignette', { min: 0, max: 1, step: 0.02, percent: true });

        heading('Sese Tepki');
        sl('Ses Patlaması (Parlaklık)', 'audioBrightness', { min: 0, max: 2, step: 0.02 });
        sl('Ses ile Renk Kayması', 'audioHue', { min: 0, max: 1, step: 0.02, percent: true });
        return out;
      }

      /* Tek mod kartıyla aynı liste (katalog, #638). Buradaki eski kopyada
         Yıldız Alanı'nın üç ayarı motorun okumadığı anahtarlara yazıyordu. */
      const own = MC().settingsOf('background', l.type);
      if (own.length) {
        const modeObj = (bg[l.type] = bg[l.type] || {});
        const defModeObj = defBg[l.type] || {};
        /* Katman yazmamışsa motor sahnedeki değeri çiziyor (layerConfig:
           cfg.background + katman); gösterilen değer de o olsun. Sıfırlama
           fabrika değerine döner (#695). */
        const sceneModeObj = (cfg.background && cfg.background[l.type]) || {};
        own.forEach(([key, label, min, max, step, percent]) => {
          const curVal = () => modeObj[key] !== undefined ? modeObj[key]
            : (sceneModeObj[key] !== undefined ? sceneModeObj[key]
              : (defModeObj[key] !== undefined ? defModeObj[key] : min));
          const fallback = defModeObj[key] !== undefined ? defModeObj[key] : min;
          out.push(miniSlider(label, curVal, (v) => { modeObj[key] = v; }, { min, max, step, percent, def: fallback }));
        });
        return out;
      }

      return out;
    }

    return out;
  }

  function layersPanel() {
    const el = P().el;
    const cfg = P().cfg();
    const nodes = [];
    const list = Array.isArray(cfg.layers) ? cfg.layers : (cfg.layers = []);
    const rerender = () => P().apply();

    /* Yığın anahtarı.

       Kapalıyken katman listesi silinmez, yalnızca kullanılmaz: sahne
       Arkaplan ve Görselleştirici kartlarından sürülür. Böylece yalın
       deneyimle katmanlı deneyim arasında ayar kaybetmeden gidip gelinir. */
    /* Bayrak yoksa (null) anlamı stackOn'daki gibi okunur, cfg'ye
       yazılmaz. Çizim sırasında false yazmak yeni kurulumda bile Katmanlar
       kartına "1 değişiklik" rozeti ve sıfırlama düğmesi çıkarıyordu. */
    const on = (window.SVLayers && window.SVLayers.stackOn)
      ? window.SVLayers.stackOn(cfg)
      : !!(cfg.layerStack && typeof cfg.layerStack.enabled === 'boolean' ? cfg.layerStack.enabled : list.length);
    const stackSwitch = el('input', {
      type: 'checkbox',
      onchange: (e) => {
        if (window.SVLayers && window.SVLayers.setStackEnabled) {
          window.SVLayers.setStackEnabled(cfg, e.target.checked);
        } else {
          cfg.layerStack = cfg.layerStack || {};
          cfg.layerStack.enabled = e.target.checked;
          if (e.target.checked && !list.length) cfg.layers = window.SVLayers.synthesize(cfg);
        }
        P().push(true);
        rerender();
      },
    });
    stackSwitch.checked = on;
    /* Master mode switch — must not look like Transparent / Cover Taskbar
       toggles below. Built with el() so the class sticks in the panel test mock
       (classList.add alone is a no-op there). CTA styling alone was not enough. */
    nodes.push(el('div', { class: 'ctrl layer-stack-toggle' }, [
      el('div', { class: 'row' }, [
        el('label', { class: 'lbl', text: 'Katman Yığınını Kullan' }),
        el('label', { class: 'switch' }, [stackSwitch, el('span', { class: 'track' })]),
      ]),
    ]));

    /* K1: when layer stack hides the Background card, surface the same
       WebGL→solid info notice here (non-blocking). */
    if (window.SVLayers
        && typeof window.SVLayers.isGradientWebGLFallback === 'function'
        && window.SVLayers.isGradientWebGLFallback()) {
      const note = el('div', {
        class: 'studio-note dim-hint',
        text: 'WebGL yok / desteklenmiyor: gradyan düz renge düştü',
      });
      note.setAttribute('data-sv-webgl-fallback-note', '1');
      nodes.push(note);
    }

    if (on) {
      /* Arkaplan kartı yığın açıkken gizli; şeffaflık burada, listenin
         en üstünde tek bir anahtar. Pencere / yayın / Spout aynı ayarı
         kullanır ve tüm arkaplan katmanlarına işlenir. */
      const transparent = el('input', {
        type: 'checkbox',
        onchange: (e) => {
          const v = e.target.checked;
          cfg.background = cfg.background || {};
          cfg.background.transparent = v;
          (cfg.layers || []).forEach((ly) => {
            if (ly && ly.kind === 'background') {
              ly.settings = ly.settings || {};
              ly.settings.background = Object.assign({}, ly.settings.background || {}, { transparent: v });
            }
          });
          P().push(true);
          rerender();
        },
      });
      transparent.checked = !!(cfg.background && cfg.background.transparent);
      nodes.push(attachPath(P().row('Şeffaf Arkaplan', el('label', { class: 'switch' }, [transparent, el('span', { class: 'track' })])), 'background.transparent'));
      if (transparent.checked) {
        nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Görselleştirici penceresi, yayın katmanı ve Spout/Syphon aynı anahtarı kullanır. Açık bir görselleştirici varsa pencereler bu ayara göre yeniden kurulur.' }));
        const cover = el('input', {
          type: 'checkbox',
          onchange: (e) => {
            cfg.background = cfg.background || {};
            cfg.background.coverTaskbar = !!e.target.checked;
            P().push(true);
            rerender();
          },
        });
        cover.checked = !!(cfg.background && cfg.background.coverTaskbar);
        nodes.push(attachPath(P().row('Tam Ekran (Görev Çubuğu Dahil)', el('label', { class: 'switch' }, [cover, el('span', { class: 'track' })])), 'background.coverTaskbar'));
        nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Kapalıyken görselleştirici Windows görev çubuğunun dışında kalır (çalışma alanı). Açıkken tüm ekranı — görev çubuğu dahil — kaplar. Yalnızca şeffaf arkaplanda gerekir; opak tam ekran zaten görev çubuğunu örter. Canlı uygulanır; pencere yeniden kurulmaz.' }));
        if (!cfg.background || cfg.background.type !== 'solid') {
          nodes.push(attachPath(miniSlider('Saydamlık Eşiği', () => {
            const v = cfg.background && cfg.background.transparentKey;
            return v == null ? 0.2 : v;
          }, (v) => {
            cfg.background = cfg.background || {};
            cfg.background.transparentKey = v;
            (cfg.layers || []).forEach((ly) => {
              if (ly && ly.kind === 'background') {
                ly.settings = ly.settings || {};
                ly.settings.background = Object.assign({}, ly.settings.background || {}, { transparentKey: v });
              }
            });
          }, { min: 0, max: 1, step: 0.01, percent: true }), 'background.transparentKey'));
        }
      }
    }

    if (!on) {
      nodes.push(
        el('div', { class: 'studio-note', text: list.length
          ? 'Katman yığını kapalı. Sahne Arkaplan ve Görselleştirici kartlarından sürülüyor. Katman listeniz duruyor; anahtarı açtığınızda aynı düzenle geri gelir.'
          : 'Katman yığını kapalı. Sahne Arkaplan ve Görselleştirici kartlarından sürülüyor. Anahtarı açarsanız aynı görünüm katman listesi olarak açılır ve üzerine yenilerini ekleyebilirsiniz.' })
      );
      return el('div', {}, nodes);
    }

    if (!list.length) {
      // Katman listesi boşken sahne eski alanlardan sentezlenir. Kullanıcı
      // düzenlemek isterse o sentezi somutlaştırıyoruz — böylece mevcut
      // görünümünü kaybetmeden katmanlara geçiyor.
      nodes.push(
        el('div', { class: 'studio-note', text: 'Sahne şu anda Arkaplan ve Görselleştirici kartlarından sürülüyor. Katmanlara geçerseniz aynı görünüm katman listesi olarak açılır ve üzerine yenilerini ekleyebilirsiniz.' })
      );
      nodes.push(
        el('button', {
          class: 'btn primary layers-cta', type: 'button', icon: 'layers', text: 'Katmanlara Geç',
          onclick: () => {
            if (window.SVLayers && window.SVLayers.setStackEnabled) {
              window.SVLayers.setStackEnabled(cfg, true);
            } else {
              cfg.layers = window.SVLayers.synthesize(cfg);
              cfg.layerStack = cfg.layerStack || {};
              cfg.layerStack.enabled = true;
            }
            rerender();
          },
        })
      );
      return el('div', {}, nodes);
    }

    /* KATMANLAR KAPALI GELİYOR (#622). Her katman bütün ayarlarıyla açık
       duruyordu: altı katmanlı gerçek bir sahnede kart 4.356 piksel boyundaydı
       ve Sahne kategorisindeki diğer kartlara ancak ekranın dört katı
       kaydırılarak ulaşılıyordu. Artık başlık satırı tür, kaynak, karışım ve
       saydamlığı özetliyor; ayarlar tıklanınca açılıyor ve açık olanlar
       hatırlanıyor (bu makinede, ayar dosyasında değil). */
    const openSet = layerOpenState();
    // Yeni eklenen katman açık gelsin: kullanıcı onu ayarlamak için ekledi
    const openNew = (ly) => { openSet.add(layerKey(ly, list.length - 1)); saveLayerOpen(openSet); };
    const keys = list.map((ly, j) => layerKey(ly, j));
    const allOpen = keys.length > 0 && keys.every((k) => openSet.has(k));
    nodes.push(el('div', { class: 'layer-toolbar' }, [
      el('span', { class: 'dim-hint', text: 'Liste çizim sırasının tersinde: en üstteki katman görüntüde de en üstte.' }),
      el('button', {
        class: 'btn ghost tiny', type: 'button',
        text: allOpen ? 'Tümünü Kapat' : 'Tümünü Aç',
        onclick: () => {
          keys.forEach((k) => { if (allOpen) openSet.delete(k); else openSet.add(k); });
          saveLayerOpen(openSet);
          rerender();
        },
      }),
    ]));

    for (let i = list.length - 1; i >= 0; i--) {
      const raw = list[i];
      const l = (list[i] = window.SVLayers.normalizeLayer(raw));
      const typeOpts = typeOptionsFor(l.kind);
      const typeLabel = (typeOpts.find(([v]) => v === l.type) || [null, l.type])[1];
      const kindLabel = LAYER_KIND_LABELS.find(([k]) => k === l.kind)[1];
      const key = layerKey(l, i);
      const open = openSet.has(key) && !l.locked;

      const enable = el('input', {
        type: 'checkbox',
        onchange: (e) => { l.enabled = e.target.checked; rerender(); },
      });
      enable.checked = l.enabled !== false;

      /* Solo / sessiz / kilit üçlüsü.

         Üçü de bir kompozitörde beklenen ama farklı işler yapan davranışlar:
         solo diğerlerini geri alınabilir biçimde susturur, sessiz katmanı
         ayarlarını kaybetmeden gizler, kilit kazara düzenlemeyi engeller. */
      const flagBtn = (fkey, label, title, cls, icon) => el('button', {
        class: 'btn ghost tiny flagbtn' + (l[fkey] ? ' on ' + cls : ''),
        type: 'button', text: icon ? '' : label, icon, title,
        onclick: () => { l[fkey] = !l[fkey]; rerender(); },
      });
      const flags = el('span', { class: 'layer-flags' }, [
        flagBtn('solo', 'S', 'Solo — yalnızca solo katmanlar çizilir', 'solo'),
        flagBtn('muted', 'M', 'Sessiz — katmanı ayarlarını kaybetmeden gizler', 'mute'),
        flagBtn('locked', '', 'Kilit — kazara düzenlemeyi engeller', 'lock', 'lock'),
        el('label', { class: 'switch small', title: 'Katmanı aç/kapat' }, [enable, el('span', { class: 'track' })]),
      ]);

      // Başlıktaki özet: ne çiziliyor ve nasıl biniyor
      const bits = [];
      if (l.name && l.name !== kindLabel) bits.push(tr(kindLabel));
      if (typeOpts.length && typeLabel && tr(typeLabel) !== tr(l.name || kindLabel)) bits.push(tr(typeLabel));
      if (l.kind !== 'logo') {
        if (l.blend && l.blend !== 'normal') {
          const b = BLEND_LABELS.find(([v]) => v === l.blend);
          bits.push(tr(b ? b[1] : l.blend));
        }
        if (typeof l.opacity === 'number' && l.opacity < 0.995) bits.push('%' + Math.round(l.opacity * 100));
      }
      const toggle = () => {
        if (l.locked) return;
        if (openSet.has(key)) openSet.delete(key); else openSet.add(key);
        saveLayerOpen(openSet);
        rerender();
      };
      const kids = [layerHead(list, i, l, tr(l.name || kindLabel), bits.join(' · '), flags, open, toggle, rerender)];

      if (l.locked) {
        kids.push(el('div', { class: 'layer-body locked' }, [
          el('div', { class: 'studio-note dim-hint', text: 'Katman kilitli. Düzenlemek için kilidi açın.' }),
        ]));
        nodes.push(el('div', { class: 'stack-item layer locked', 'data-id': l.id }, kids));
        continue;
      }
      if (!open) {
        nodes.push(el('div', { class: 'stack-item layer', 'data-id': l.id }, kids));
        continue;
      }

      const body = [];
      if (typeOpts.length) {
        body.push(miniSelect('Kaynak', typeOpts, () => l.type, (v) => { l.type = v; }, rerender));
      }
      if (l.type === 'custom') {
        const presets = window.SVPresets
          .byKind(l.kind === 'background' ? 'background' : 'visualizer')
          .filter((p) => p.engine === 'shader')
          .map((p) => [p.id, p.name]);
        /* Katmanın preseti silinmişse katman hiçbir şey çizmiyor; eskiden
           seçici sessizce listenin ilkini gösteriyordu. */
        if (l.presetId && !presets.some((p) => p[0] === l.presetId)) {
          body.push(el('div', { class: 'studio-note media-fault', text: 'Bu katmanın Studio preseti silinmiş; katman boş çiziliyor. Listeden başka bir preset seçin.' }));
        }
        if (presets.length) {
          body.push(miniSelect('Studio Preseti', presets, () => l.presetId || presets[0][0], (v) => { l.presetId = v; }));
        } else {
          body.push(el('div', { class: 'studio-note', text: 'Henüz Studio preseti yok.' }));
        }
      }

      /* Katmanın kendi ayarları.

         Medya ve logo katmanları eskiden yalnızca bir satır başlıktan
         ibaretti; ayarları başka kartlarda duruyordu ve katmana bakan
         kullanıcı neyin çizildiğini göremiyordu. Artık kaynak buradan
         seçiliyor, seçili dosyanın adı ve küçük bir ön izlemesi burada
         görünüyor. */
      body.push.apply(body, layerOwnSettings(l, rerender));

      if (l.kind !== 'logo') {
        body.push(miniSelect('Karışım', BLEND_LABELS, () => l.blend, (v) => { l.blend = v; }, undefined, 'normal'));
        body.push(miniSlider('Saydamlık', () => l.opacity, (v) => { l.opacity = v; }, { min: 0, max: 1, step: 0.01, percent: true, def: 1}));
      }

      const tabs = [
        {
          key: 'transform', label: 'Dönüşüm',
          build: () => {
            const transKids = [
              miniSlider('Ölçek', () => l.transform.scale, (v) => { l.transform.scale = v; }, { min: 0.2, max: 3, step: 0.01, def: 1 }),
              miniSlider('Dönüş', () => l.transform.rotate, (v) => { l.transform.rotate = v; }, { min: -180, max: 180, step: 1, fmt: (v) => Math.round(v) + '°', def: 0 }),
            ];
            if (l.kind !== 'logo') {
              transKids.push(
                miniSlider('Yatay Konum', () => l.transform.x, (v) => { l.transform.x = v; }, { min: -1, max: 1, step: 0.005, percent: true, def: 0 }),
                miniSlider('Dikey Konum', () => l.transform.y, (v) => { l.transform.y = v; }, { min: -1, max: 1, step: 0.005, percent: true, def: 0 })

              );
            }
            transKids.push(
              miniToggle('Yatay Aynala', () => l.transform.flipX, (v) => { l.transform.flipX = v; }, null, { def: false }),
              miniToggle('Dikey Aynala', () => l.transform.flipY, (v) => { l.transform.flipY = v; }, null, { def: false })
            );
            return transKids;
          },
        },
        {
          key: 'audio', label: 'Sese Tepki',
          build: () => [
            miniSelect('Bant', BAND_LABELS, () => l.audio.band, (v) => { l.audio.band = v; }),
            miniSlider('Ses → Saydamlık', () => l.audio.opacity, (v) => { l.audio.opacity = v; }, { min: 0, max: 1, step: 0.02, percent: true, def: 0 }),
            miniSlider('Ses → Ölçek', () => l.audio.scale, (v) => { l.audio.scale = v; }, { min: 0, max: 1, step: 0.02, percent: true, def: 0 }),
            miniSlider('Ses → Dönüş', () => l.audio.rotate, (v) => { l.audio.rotate = v; }, { min: 0, max: 1, step: 0.02, percent: true, def: 0 }),
          ],
        },
        {
          key: 'mask', label: 'Maske',
          build: () => {
            l.mask = l.mask || { type: 'none' };
            const m = l.mask;
            const out = [miniSelect('Şekil', MASK_LABELS, () => m.type || 'none', (v) => { m.type = v; }, rerender)];
            if (m.type && m.type !== 'none') {
              if (m.type === 'layer') {
                const others = list.filter((x, j) => j !== i && x.id).map((x) => [x.id, x.name || x.kind]);
                out.push(others.length
                  ? miniSelect('Kaynak Katman', others, () => m.from || others[0][0], (v) => { m.from = v; })
                  : el('div', { class: 'studio-note', text: 'Maske için başka katman yok.' }));
              } else {
                out.push(miniSlider('Yatay', () => (m.x == null ? 0.5 : m.x), (v) => { m.x = v; }, { min: -0.2, max: 1.2, step: 0.005, percent: true, def: 0.5 }));
                out.push(miniSlider('Dikey', () => (m.y == null ? 0.5 : m.y), (v) => { m.y = v; }, { min: -0.2, max: 1.2, step: 0.005, percent: true, def: 0.5 }));
                out.push(miniSlider('Genişlik', () => (m.w == null ? 0.6 : m.w), (v) => { m.w = v; }, { min: 0.02, max: 2, step: 0.01, percent: true, def: 0.6 }));
                out.push(miniSlider('Yükseklik', () => (m.h == null ? 0.6 : m.h), (v) => { m.h = v; }, { min: 0.02, max: 2, step: 0.01, percent: true, def: 0.6 }));
                if (m.type === 'linear') {
                  out.push(miniSlider('Açı', () => m.angle || 0, (v) => { m.angle = v; }, { min: 0, max: 1, step: 0.005, def: 0 }));
                }
              }
              out.push(miniSlider('Yumuşaklık', () => (m.feather == null ? 0.1 : m.feather), (v) => { m.feather = v; }, { min: 0, max: 1, step: 0.01, percent: true, def: 0.1 }));
              out.push(miniToggle('Tersine Çevir', () => !!m.invert, (v) => { m.invert = v; }));
            }
            out.push(el('div', { class: 'studio-note dim-hint', text: 'Maske katmanın kendi tuvaline uygulanır; dönüşümle birlikte hareket etmez ve karışım modundan bağımsızdır. Shader tabanlı katmanlarda (Studio, gradyan) 2B maske uygulanamaz.' }));
            return out;
          },
        },
        {
          key: 'fx', label: 'Katman Efektleri',
          build: () => {
            l.postfx = Array.isArray(l.postfx) ? l.postfx : [];
            const FX = window.SVPostFX;
            const out = [];
            l.postfx.forEach((f, fi) => {
              const def = FX && FX.EFFECTS[f.type];
              out.push(el('div', { class: 'row layer-fx-head' }, [
                el('span', { class: 'lbl', text: (fi + 1) + '. ' + (def ? def.label : f.type) }),
                el('button', {
                  class: 'btn ghost tiny danger', type: 'button', icon: 'x',
                  onclick: () => { l.postfx.splice(fi, 1); rerender(); },
                }),
              ]));
              if (def) {
                for (const p of def.params || []) {
                  f.params = f.params || {};
                  if (f.params[p.name] == null) f.params[p.name] = p.default;
                  out.push(miniSlider(p.label, () => f.params[p.name], (v) => { f.params[p.name] = v; }, {
                    min: p.min, max: p.max, step: p.step, def: p.default,
                  }));
                }
              }
            });
            const sel = el('select', { class: 'p-in' });
            sel.appendChild(el('option', { value: '', text: '— efekt ekle —' }));
            if (FX) FX.EFFECT_IDS.forEach((id) => sel.appendChild(el('option', { value: id, text: FX.EFFECTS[id].label })));
            sel.onchange = (ev) => {
              const id = ev.target.value;
              if (!id) return;
              l.postfx.push(FX.defaultChainEntry(id));
              rerender();
            };
            out.push(P().row('Ekle', sel));
            out.push(el('div', { class: 'studio-note dim-hint', text: 'Bu zincir yalnızca bu katmana uygulanır; sahnenin geneline uygulanan Efekt Zinciri kartından bağımsızdır.' }));
            return out;
          },
        },
        {
          key: 'group', label: 'Grup ve Fader',
          build: () => [
            P().row('Grup', el('input', {
              class: 'p-in', type: 'text', value: l.group || '', placeholder: 'grup adı (boş = gruplanmamış)',
              oninput: (ev) => { l.group = ev.target.value; P().push(false); },
            })),
            miniSelect('Fader Eğrisi', [['linear', 'Doğrusal'], ['exp', 'Üstel'], ['log', 'Logaritmik']],
              () => l.opacityCurve || 'linear', (v) => { l.opacityCurve = v; }),
            el('div', { class: 'studio-note dim-hint', text: 'Aynı gruptaki katmanlar Katman Grupları kartındaki tek fader ile birlikte kısılır. Doğrusal bir fader görsel olarak doğrusal davranmaz; üstel eğri gerçek bir kısma hissi verir.' }),
          ],
        },
      ];
      if (l.kind === 'nowplaying' || (l.kind === 'visualizer' && l.type === 'nowplaying')) {
        const cfgNp = P().cfg();
        tabs.splice(1, 0,
          { key: 'type', label: 'Yazı', build: () => nowplayingTypeKids(l, cfgNp, rerender) },
          { key: 'motion', label: 'Hareket', build: () => nowplayingMotionKids(l, cfgNp) });
        const audioNp = tabs.find((t) => t.key === 'audio');
        const prevNp = audioNp.build;
        audioNp.build = () => prevNp().concat(nowplayingAudioKids(l, cfgNp));
      } else if (l.kind === 'visualizer' && l.type === 'text' && l.settings && l.settings.text) {
        const txt = l.settings.text;
        tabs.splice(1, 0,
          { key: 'type', label: 'Yazı', build: () => textTypeKids(txt) },
          { key: 'motion', label: 'Hareket', build: () => textMotionKids(txt) });
        /* Kütüphane kendi katlanır başlığını taşımasın; Yazı ile aynı şeritte dursun. */
        if ((txt.source || 'static') === 'lyrics' && isWindowsPlatform()
          && window.SVLyricsLibUi && window.SVLyricsLibUi.library) {
          tabs.splice(2, 0, {
            key: 'lyricslib', label: 'Söz Kütüphanesi',
            build: () => window.SVLyricsLibUi.library({ txt, rerender }),
          });
        }
        const audioTx = tabs.find((t) => t.key === 'audio');
        const prevTx = audioTx.build;
        audioTx.build = () => prevTx().concat(textAudioKids(txt, rerender));
      }
      body.push.apply(body, layerTabs(key, tabs));

      // ---- Kopyala / çoğalt ----
      body.push(el('div', { class: 'layer-foot' }, [
        el('button', {
          class: 'btn ghost tiny', type: 'button', icon: 'copy', text: 'Çoğalt',
          onclick: () => {
            const copy = JSON.parse(JSON.stringify(l));
            copy.id = null;
            copy.name = (l.name || l.kind) + ' (kopya)';
            copy.solo = false;
            const made = window.SVLayers.normalizeLayer(copy);
            list.splice(i + 1, 0, made);
            openSet.add(layerKey(made, i + 1));
            saveLayerOpen(openSet);
            rerender();
          },
        }),
        el('button', {
          class: 'btn ghost tiny', type: 'button', icon: 'copy', text: 'Kopyala',
          title: 'Katmanı panoya al; başka bir sahnede yapıştırılabilir',
          onclick: () => {
            clipboard = JSON.parse(JSON.stringify(l));
            P().toast('Katman kopyalandı.');
          },
        }),
      ]));

      kids.push(el('div', { class: 'layer-body' }, body));
      nodes.push(el('div', { class: 'stack-item layer open', 'data-id': l.id }, kids));
    }

    // Ekleme menüsü
    const addRow = el('div', { class: 'add-row' });
    LAYER_KIND_LABELS.forEach(([kind, label]) => {
      addRow.appendChild(
        el('button', {
          class: 'btn ghost small', type: 'button', icon: 'plus', text: label,
          onclick: () => {
            let made;
            if (kind === 'nowplaying' && window.SVLayers.makeNowPlayingLayer) {
              made = window.SVLayers.makeNowPlayingLayer({ name: label });
            } else {
              const opts = typeOptionsFor(kind);
              made = window.SVLayers.normalizeLayer({
                kind,
                name: label,
                type: opts.length ? opts[0][0] : 'back',
              });
            }
            list.push(made);
            openNew(made);
            rerender();
          },
        })
      );
    });
    TEXT_ADD_PRESETS.forEach((preset) => {
      addRow.appendChild(
        el('button', {
          class: 'btn ghost small', type: 'button', icon: 'plus', text: preset.label,
          onclick: () => {
            const layer = window.SVLayers.makeTextLayer
              ? window.SVLayers.makeTextLayer(preset.spec)
              : window.SVLayers.normalizeLayer({
                name: preset.spec.name,
                kind: 'visualizer',
                type: 'text',
                settings: {
                  text: Object.assign({ enabled: true }, preset.spec, { name: undefined }),
                },
              });
            list.push(layer);
            openNew(layer);
            rerender();
          },
        })
      );
    });
    if (clipboard) {
      addRow.appendChild(el('button', {
        class: 'btn ghost small', type: 'button', icon: 'paste', text: 'Yapıştır',
        onclick: () => {
          const copy = JSON.parse(JSON.stringify(clipboard));
          copy.id = null;
          copy.solo = false;
          const made = window.SVLayers.normalizeLayer(copy);
          list.push(made);
          openNew(made);
          rerender();
        },
      }));
    }
    nodes.push(addRow);

    nodes.push(
      el('button', {
        class: 'btn ghost small', type: 'button', icon: 'reset', text: 'Katmanları Sıfırla',
        title: 'Katman listesini boşaltır; sahne yeniden Arkaplan/Görselleştirici kartlarından sürülür',
        onclick: async () => {
          if (!(await P().confirm('Katman listesi boşaltılacak. Sahne yeniden Arkaplan ve Görselleştirici kartlarından sürülecek.', { danger: true, okText: 'Sıfırla' }))) return;
          cfg.layers = [];
          rerender();
        },
      })
    );

    return el('div', { class: 'layer-panel' }, nodes);
  }

  // ==========================================================================
  // EFEKT ZİNCİRİ
  // ==========================================================================
  function effectsPanel() {
    const el = P().el;
    const cfg = P().cfg();
    const FX = window.SVPostFX;
    const nodes = [];
    const list = Array.isArray(cfg.postfx) ? cfg.postfx : (cfg.postfx = []);
    const rerender = () => P().apply();

    if (!list.length) {
      nodes.push(el('div', { class: 'studio-note', text: 'Zincir boşken sahne doğrudan kompozit edilir; hiçbir ek maliyet yoktur. Efekt eklediğinizde sahne tek yüzeye birleştirilip GPU\'da işlenir ve efektler dışa aktarımda da aynı sırayla uygulanır.' }));
    }

    list.forEach((fx, i) => {
      const def = FX.EFFECTS[fx.type];
      if (!def) return;
      fx.params = fx.params || {};
      fx.audio = fx.audio || {};

      const enable = el('input', {
        type: 'checkbox',
        onchange: (e) => { fx.enabled = e.target.checked; rerender(); },
      });
      enable.checked = fx.enabled !== false;
      const enableBox = el('label', { class: 'switch small', title: 'Efekti aç/kapat' }, [enable, el('span', { class: 'track' })]);

      const kids = [itemHeader(list, i, (i + 1) + '. ' + def.label, rerender, enableBox)];

      for (const p of def.params) {
        if (fx.params[p.name] == null) fx.params[p.name] = p.default;
        kids.push(
          miniSlider(p.label, () => fx.params[p.name], (v) => { fx.params[p.name] = v; }, {
            min: p.min, max: p.max, step: p.step, def: p.default,
            fmt: (v) => (p.step >= 1 ? String(Math.round(v)) : (+v).toFixed(3)),
          })
        );
      }

      if (def.audio && def.audio.length) {
        kids.push(
          foldable('Sese Bağla', () => {
            const out = [miniSelect('Bant', BAND_LABELS, () => fx.audioBand || 'bass', (v) => { fx.audioBand = v; })];
            for (const name of def.audio) {
              const p = def.params.find((x) => x.name === name);
              if (!p) continue;
              out.push(
                miniSlider(p.label + ' ← ses', () => fx.audio[name] || 0, (v) => { fx.audio[name] = v; }, {
                  min: 0, max: 1, step: 0.02, percent: true, def: 0,
                })
              );
            }
            return out;
          })
        );
      }

      nodes.push(el('div', { class: 'stack-item' }, kids));
    });

    const addSel = el('select', {
      class: 'p-in',
      onchange: (e) => {
        if (!e.target.value) return;
        list.push(FX.defaultChainEntry(e.target.value));
        rerender();
      },
    });
    addSel.appendChild(el('option', { value: '', text: '+ Efekt ekle…' }));
    FX.EFFECT_IDS.forEach((id) => addSel.appendChild(el('option', { value: id, text: FX.EFFECTS[id].label })));
    nodes.push(P().row('Yeni Efekt', addSel));

    return el('div', { class: 'fx-panel' }, nodes);
  }

  // ==========================================================================
  // 3B GEOMETRİ
  // ==========================================================================
  const FAMILY_LABELS = [
    ['surface', 'Yüzey'],
    ['curve3d', 'Uzay Eğrisi'],
    ['curve2d', 'Düzlem Eğrisi'],
    ['attractor', 'Çekici'],
    ['solid', 'Katı'],
  ];
  const RENDER_LABELS = [['surface', 'Yüzey'], ['wireframe', 'Tel Kafes'], ['points', 'Nokta']];
  const DEFORM_LABELS = [['normal', 'Normal Yönünde'], ['radial', 'Işınsal'], ['vertical', 'Dikey'], ['collapse', 'Çökme']];
  const COLOR_LABELS = [['palette', 'Palet'], ['depth', 'Derinlik'], ['normal', 'Normal'], ['spectrum', 'Spektrum']];

  function geometryPanel() {
    const el = P().el;
    const cfg = P().cfg();
    const g = cfg.geometry;
    const nodes = [];
    const rerender = () => P().apply();

    nodes.push(
      P().segment('Aile', 'geometry.family', FAMILY_LABELS.map(([v, l]) => ({ value: v, label: l })), { rebuild: true })
    );

    /* Katalog iki kaynaktan geliyor: parametrik formüller ve katı geometri
       ailesi. Panel ikisi arasında ayrım yapmaz. */
    const full = window.SVFormulas.catalog()
      .concat(window.SVSolids ? window.SVSolids.catalog() : []);
    const cat = full.filter((e) => e.family === g.family);
    if (!cat.length) return el('div', { class: 'studio-note', text: 'Bu ailede formül yok.' });
    if (!cat.some((e) => e.key === g.formula)) {
      g.formula = cat[0].key;
      g.params = {};
    }
    nodes.push(
      miniSelect('Formül', cat.map((e) => [e.key, e.label]), () => g.formula, (v) => { g.formula = v; g.params = {}; }, rerender)
    );

    const active = cat.find((e) => e.key === g.formula);
    if (g.family === 'solid') {
      nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Katı geometri ağı bir kez kurulup GPU\'da kalır; sese bağlı bozulma vertex shader\'da yapılır. Nokta bulutu üreten şekillerde (IFS) çizim kipi otomatik olarak nokta olur.' }));
    }
    if (active) {
      // Formülün kendi parametreleri — tanımdan otomatik üretilir
      if (active.params.length) {
        g.params = g.params || {};
        for (const p of active.params) {
          if (g.params[p.name] == null) g.params[p.name] = p.default;
          nodes.push(
            miniSlider(p.label, () => g.params[p.name], (v) => { g.params[p.name] = v; }, {
              min: p.min, max: p.max, step: p.step, def: p.default,
              fmt: (v) => (p.step >= 1 ? String(Math.round(v)) : (+v).toFixed(3)),
            })
          );
        }
      }
    }

    nodes.push(P().segment('Çizim', 'geometry.render', RENDER_LABELS.map(([v, l]) => ({ value: v, label: l }))));
    nodes.push(P().slider('Çözünürlük', 'geometry.resolution', { min: 8, max: 200, step: 1, fmt: (v) => String(Math.round(v)) }));
    nodes.push(P().slider('Sese Bağlı Bozulma', 'geometry.deform', { min: 0, max: 1.5, step: 0.01 }));
    nodes.push(miniSelect('Bozulma Kipi', DEFORM_LABELS, () => g.deformMode, (v) => { g.deformMode = v; }));
    nodes.push(miniSelect('Renklendirme', COLOR_LABELS, () => g.colorMode, (v) => { g.colorMode = v; }));

    nodes.push(
      foldable('Kamera ve Görünüm', () => [
        P().slider('Dönüş Hızı', 'geometry.spin', { min: -2, max: 2, step: 0.01 }),
        P().slider('Eğim', 'geometry.tilt', { min: -1.5, max: 1.5, step: 0.01 }),
        P().slider('Yakınlaşma', 'geometry.zoom', { min: 0.2, max: 3, step: 0.02 }),
        P().slider('Bas → Kamera', 'geometry.cameraAudio', { min: 0, max: 1, step: 0.01, percent: true }),
        P().slider('Nokta Boyutu', 'geometry.pointSize', { min: 1, max: 12, step: 0.5 }),
        P().slider('Saydamlık', 'geometry.alpha', { min: 0.05, max: 1, step: 0.01, percent: true }),
      ])
    );

    if (g.family === 'attractor') {
      nodes.push(
        foldable('Çekici Ayarları', () => [
          P().slider('Nokta Sayısı', 'geometry.attractorPoints', { min: 1000, max: 200000, step: 1000, fmt: (v) => Math.round(v / 1000) + 'k' }),
          P().slider('İntegrasyon Adımı', 'geometry.attractorStep', { min: 0.0005, max: 0.02, step: 0.0005, fmt: (v) => (+v).toFixed(4) }),
        ])
      );
    }

    return el('div', { class: 'geo-panel' }, nodes);
  }

  // ==========================================================================
  // ART-NET / DMX
  // ==========================================================================
  const ARTNET_MODES = [
    ['palette', 'Sahne Paleti'],
    ['bands', 'Frekans Bantları'],
    ['spectrum', 'Kayan Spektrum'],
    ['single', 'Tek Renk'],
  ];

  let artnetState = { running: false, error: null, packets: 0 };
  let artnetWatch = false;

  function artnetPanel() {
    const el = P().el;
    const cfg = P().cfg();
    const a = cfg.artnet;
    const nodes = [];

    if (!artnetWatch) {
      artnetWatch = true;
      window.api.onArtnetStatus((s) => { artnetState = s; });
      window.api.artnetStatus().then((s) => { artnetState = s; }).catch(() => {});
    }

    const enable = el('input', {
      type: 'checkbox',
      onchange: async (e) => {
        a.enabled = e.target.checked;
        P().push(true);
        artnetState = await window.api.artnetSync();
        P().rerender();
      },
    });
    enable.checked = !!a.enabled;
    nodes.push(P().row('Art-Net Çıkışı', el('label', { class: 'switch' }, [enable, el('span', { class: 'track' })])));

    // Durum: parçalar ayrı düğümlerde (sayı içeren birleşik metin çevrilemez)
    const st = el('div', { class: 'studio-status ' + (artnetState.running ? 'ok' : artnetState.error ? 'err' : '') });
    if (artnetState.running) {
      st.appendChild(el('span', { icon: 'check' }));
      st.appendChild(el('span', { text: 'Yayında' }));
      st.appendChild(el('span', { class: 'st-sep', text: ' · ' }));
      st.appendChild(el('span', { text: 'Evren' }));
      st.appendChild(el('span', { class: 'st-num', text: ' ' + artnetState.universe }));
      st.appendChild(el('span', { class: 'st-sep', text: ' · ' }));
      st.appendChild(el('span', { class: 'st-num', text: String(artnetState.packets || 0) + ' ' }));
      st.appendChild(el('span', { text: 'paket' }));
    } else if (artnetState.error) {
      st.appendChild(el('span', { icon: 'x', text: artnetState.error }));
    } else {
      st.appendChild(el('span', { text: 'Kapalı' }));
    }
    nodes.push(st);

    if (a.enabled) {
      nodes.push(
        P().row(
          'Hedef Adres',
          el('input', {
            class: 'p-in wide', type: 'text', value: a.host,
            onchange: async (e) => {
              a.host = (e.target.value || '255.255.255.255').trim().slice(0, 64);
              P().push(true);
              artnetState = await window.api.artnetSync();
            },
          })
        )
      );
      nodes.push(P().slider('Evren (Universe)', 'artnet.universe', { min: 0, max: 32, step: 1, fmt: (v) => String(Math.round(v)) }));
      nodes.push(P().slider('Başlangıç Kanalı', 'artnet.startChannel', { min: 1, max: 512, step: 1, fmt: (v) => String(Math.round(v)) }));
      nodes.push(P().slider('Aygıt Sayısı', 'artnet.fixtures', { min: 1, max: 64, step: 1, fmt: (v) => String(Math.round(v)) }));
      nodes.push(
        P().segment('Aygıt Kanalları', 'artnet.channelsPerFixture', [
          { value: 3, label: 'RGB' },
          { value: 4, label: 'RGBW' },
        ])
      );
      nodes.push(miniSelect('Renk Kaynağı', ARTNET_MODES, () => a.mode, (v) => { a.mode = v; }, () => P().rerender()));
      if (a.mode === 'single') nodes.push(P().color('Renk', 'artnet.color'));
      nodes.push(P().slider('Parlaklık', 'artnet.brightness', { min: 0, max: 1, step: 0.02, percent: true, noExtend: true }));
      nodes.push(P().slider('Gönderim Hızı', 'artnet.fps', { min: 1, max: 44, step: 1, fmt: (v) => Math.round(v) + ' Hz' }));
      nodes.push(
        el('div', { class: 'studio-note dim-hint', text: 'Varsayılan hedef yayın adresidir; ağdaki tüm Art-Net düğümleri paketi alır. Tek bir arayüze göndermek isterseniz onun IP adresini yazın. DMX 44 Hz üstünü zaten taşımaz, bu yüzden gönderim hızı orada sınırlıdır.' })
      );
    } else {
      nodes.push(
        el('div', { class: 'studio-note', text: 'Sahne renklerini standart DMX protokolüyle (Art-Net) ışık konsollarına, DMX arayüzlerine ve QLC+ gibi yazılımlara yollar. Windows Dynamic Lighting\'in yerine geçmez; o tüketici aygıtlarını, bu sahne ışıklarını sürer.' })
      );
    }

    return el('div', { class: 'artnet-panel' }, nodes);
  }

  window.SVScenePanels = {
    layersPanel, effectsPanel, geometryPanel, artnetPanel,
    // Ortak satır üreticileri — diğer paneller de aynı görünümü kullansın
    miniSlider, miniSelect, miniSegment, miniToggle, foldable, itemHeader, moveItem,
    isWindows: isWindowsPlatform, parseClock, formatClock,
  };
})();
