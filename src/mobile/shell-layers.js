/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* KATMANLAR SEKMESİ (docs/android/PLAN.md Faz 3.3; onaylı taslaklar 2, 3, 4).

   Üç sayfa: katman listesi → katman ayarları → katman ekle.

   - Liste görüntüdeki sırayla: en üstteki satır en öndeki katman (dizide sonuncu).
     Satırın tutamağından sürükleyerek sıralanır; erişilebilir yol ayarlar sayfasındaki
     Yukarı/Aşağı düğmeleri. Göz düğmesi katmanı açıp kapatır (`enabled`).
   - Ayarlar masaüstünün katman düzenleyicisinin karşılığı: karışım, görünürlük,
     Kaynak (mod ve modun ayarları), Dönüşüm, Ses tepkisi, Efektler (katman zinciri,
     src/visualizer/postfx.js'in tanımlarından).
   - Yeni katman masaüstündeki gibi kurulur (src/shared/layer-factory.js).
   - Kilitli katman düzenlenmez ve silinmez; solo ve sessiz satırda yazılır.

   AYAR YAZMA: motor ile arayüz AYNI sayfada, `config.get()` motorun da tuttuğu nesne.
   Masaüstünde panel ile motor arasında IPC kopyalıyordu; burada kopya bizde: katman
   kopyalanır, yeni dizi kurulur, `patch({ layers })` ile gönderilir. Asıl nesne hiç
   yerinde değiştirilmez. Kendi yamamızdan gelen olay sayfayı yeniden kurmaz (sürüklenen
   kaydırıcı ölmesin); başka yerden gelen değişiklik (Otomatik VJ, sahne çağırma)
   listeyi yeniler, düzenlenen katman yok olduysa listeye dönülür. */
(function () {
  if (typeof window === 'undefined' || !window.SVShell || !window.SVShellUI) return;
  const S = window.SVShell;
  const U = window.SVShellUI;
  const { h, icon, A } = S;
  const LY = () => window.SVLayers;
  const LF = () => window.SVLayerFactory;
  const MC = () => window.SVModeCatalog;
  const FX = () => window.SVPostFX;
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
  const cfg = () => (A() && A().config.get()) || {};

  // ---- Küçük resimler (derlemede çıkarılan dizin: android/tools/thumb-index.js) ----
  const THUMB_DIR = '../../assets/mode-thumbs/';
  let thumbs = null;
  const thumbsReady = fetch(THUMB_DIR + 'index.json').then((r) => (r.ok ? r.json() : null)).then((j) => { thumbs = j; }, () => { thumbs = null; });
  function thumbKey(kind, type) {
    if (!thumbs) return '';
    if (kind === 'visualizer') return (thumbs.vis && thumbs.vis[type]) || '';
    if (kind === 'background') return (thumbs.bg && thumbs.bg[type]) || '';
    return '';
  }
  const KIND_ICONS = { media: 'video', sprites: 'sparkles', logo: 'image', nowplaying: 'music', input: 'monitor', web: 'globe' };
  function thumbOf(l, cls) {
    const own = l.kind === 'sprites' ? ((l.settings && l.settings.images && l.settings.images.items) || [])[0]
      : l.kind === 'logo' ? (l.settings && l.settings.logo) : null;
    const src = own && typeof own.src === 'string' && own.src.indexOf('data:image/') === 0 ? own.src : '';
    if (src) return h('img', { class: cls || 'thumb', src, alt: '', decoding: 'async' });
    const key = thumbKey(l.kind, l.type);
    if (key) return h('img', { class: cls || 'thumb', src: THUMB_DIR + key + '.webp', alt: '', loading: 'lazy', decoding: 'async' });
    const name = l.kind === 'visualizer' && l.type === 'text' ? 'text' : (KIND_ICONS[l.kind] || (l.kind === 'background' ? 'background' : 'bars'));
    return h('div', { class: (cls || 'thumb') + ' icon', 'aria-hidden': 'true' }, [icon(name)]);
  }

  // ---- Adlar ----
  const KIND_LABELS = {
    background: 'Arkaplan', visualizer: 'Görselleştirici', media: 'Medya', sprites: 'Görsel Nesneler',
    logo: 'Logo', nowplaying: 'Çalan Parça', input: 'Giriş', web: 'Web Sayfası',
  };
  function typeLabel(l) {
    if (l.kind === 'visualizer' || l.kind === 'background') {
      const m = MC() && MC().get(l.kind, l.type);
      if (m) return m.label;
    }
    return KIND_LABELS[l.kind] || String(l.type || l.kind || '');
  }
  function layerName(l) { return l.name || typeLabel(l); }
  function blendLabel(b) {
    const hit = LF().BLEND_LABELS.find(([v]) => v === b);
    return hit ? hit[1] : String(b || 'normal');
  }

  // ---- Okuma / yazma ----
  function layers() {
    const c = cfg();
    return Array.isArray(c.layers) ? c.layers : [];
  }
  /* Masaüstünde panel her gönderimde yığını kuruyor (admin.js push → ensureStack);
     eski biçimli ayarda liste boşken motor katmanları sentezliyor. Sayfa açılınca
     aynısı bir kez, kopya üzerinde yapılır. */
  function ensureStack() {
    const c = cfg();
    if (!c || !LY() || (c.layerStack && c.layerStack.enabled === true)) return;
    const next = JSON.parse(JSON.stringify(c));
    LY().ensureStack(next);
    own(() => A().config.set(next));
  }
  let selfDepth = 0;
  function own(fn) { selfDepth++; try { fn(); } finally { selfDepth--; } }
  function commit(list) { own(() => A().config.patch({ layers: list })); }
  /* Katmanın kopyasını değiştirip yazar; değişen katmanı döndürür. */
  function updateLayer(id, fn) {
    const list = layers().slice();
    const i = list.findIndex((l) => l && l.id === id);
    if (i < 0) return null;
    const next = JSON.parse(JSON.stringify(list[i]));
    fn(next);
    list[i] = next;
    commit(list);
    return next;
  }
  const findLayer = (id) => layers().find((l) => l && l.id === id) || null;
  const visibleNow = (l, list) => {
    const solo = list.some((x) => x && x.solo);
    return l.enabled !== false && !l.muted && (!solo || l.solo);
  };

  // =====================================================================
  // LİSTE
  // =====================================================================
  const listPage = {
    title: 'Katmanlar',
    actions(slot, ctx) {
      slot.appendChild(h('button', { class: 'btn primary', onclick: () => ctx.push(addPage()) }, [icon('plus'), 'Ekle']));
    },
    render(body, ctx) {
      ensureStack();
      renderList(body, ctx);
    },
    onConfig(ctx) { if (!selfDepth) ctx.refresh(); },
  };

  function sceneRow() {
    const c = cfg();
    const sc = (Array.isArray(c.scenes) ? c.scenes : []).find((s) => s && s.id === c._activeSceneId);
    const n = layers().length;
    return h('div', { class: 'row card2 scene-row' }, [
      h('div', { class: 'row-text' }, [
        h('div', { class: 'row-title', text: sc ? sc.name : 'Sahne' }),
        h('div', { class: 'row-sub', text: S.countLabel(n) }),
      ]),
    ]);
  }

  function renderList(body, ctx) {
    const list = layers();
    body.appendChild(sceneRow());
    if (!list.length) {
      body.appendChild(h('div', { class: 'empty', text: 'Katman listesi boş. Listeyi oluşturursanız sahne arkaplan ve görselleştirici katmanlarıyla yeniden başlar, üzerine yenilerini ekleyebilirsiniz.' }));
      body.appendChild(h('button', {
        class: 'btn block', onclick: () => {
          const next = JSON.parse(JSON.stringify(cfg()));
          LY().rebuildStack(next);
          own(() => A().config.set(next));
          ctx.refresh();
        },
      }, [icon('layers'), 'Katman Listesini Oluştur']));
      return;
    }
    const box = h('div', { class: 'layer-list', role: 'list', 'aria-label': 'Katmanlar' });
    for (let i = list.length - 1; i >= 0; i--) {
      const l = list[i];
      if (l) box.appendChild(layerRow(l, list, ctx));
    }
    body.appendChild(box);
    body.appendChild(h('div', { class: 'hint', text: 'Sıralamak için sürükleyin; en üstteki katman önde görünür. Katmana dokununca ayarları açılır.' }));
  }

  function layerRow(l, list, ctx) {
    const on = l.enabled !== false;
    const shown = visibleNow(l, list);
    const op = l.opacity == null ? 1 : l.opacity;
    const sub = [h('span', { text: typeLabel(l) })];
    if (l.blend && l.blend !== 'normal') sub.push(' · ', h('span', { text: blendLabel(l.blend) }));
    if (op < 1) sub.push(' · ', h('span', { text: '%' + Math.round(op * 100) }));
    for (const [k, t] of [['solo', 'Solo'], ['muted', 'Sessiz'], ['locked', 'Kilitli']]) if (l[k]) sub.push(' · ', h('span', { class: 'flag', text: t }));
    const main = h('button', { class: 'row-main', 'aria-label': layerName(l), onclick: () => ctx.push(editPage(l.id)) }, [
      thumbOf(l),
      h('div', { class: 'row-text' }, [
        h('div', { class: 'row-title', text: layerName(l) }),
        h('div', { class: 'row-sub' }, sub),
        h('div', { class: 'opbar', 'aria-hidden': 'true' }, [h('b', { style: 'width:' + Math.round(op * 100) + '%' })]),
      ]),
    ]);
    const eye = h('button', {
      class: 'iconbtn' + (on ? '' : ' off'), 'aria-label': on ? 'Gizle' : 'Göster', 'aria-pressed': on ? 'false' : 'true',
      disabled: l.locked ? true : null,
      onclick: () => updateLayer(l.id, (x) => { x.enabled = !(x.enabled !== false); }) && ctx.refresh(),
    }, [icon(on ? 'eye' : 'eye-off')]);
    const grip = h('span', { class: 'grip', 'aria-hidden': 'true' }, [icon('grip')]);
    const row = h('div', { class: 'row' + (shown ? '' : ' dim'), role: 'listitem', 'data-id': l.id }, [main, eye, grip]);
    dragHandle(grip, row, ctx);
    return row;
  }

  /* Tutamaçtan sürükleme. Satır parmakla birlikte kayar; bırakınca yeni yer satır
     yüksekliğine göre hesaplanır. touch-action: none ve pointer capture olmadan
     tarayıcı dikey kaydırmayı alıp pointercancel gönderiyor. */
  function dragHandle(grip, row, ctx) {
    grip.addEventListener('pointerdown', (e) => {
      const box = row.parentNode;
      if (!box) return;
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const rows = Array.from(box.children);
      const from = rows.indexOf(row);
      const pitch = rows.length > 1 ? rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top : row.getBoundingClientRect().height;
      const y0 = e.clientY;
      let to = from;
      row.classList.add('dragging');
      const move = (ev) => {
        const dy = ev.clientY - y0;
        row.style.transform = 'translateY(' + dy + 'px)';
        to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / Math.max(1, pitch))));
        rows.forEach((r, k) => {
          if (r === row) return;
          let shift = 0;
          if (from < to && k > from && k <= to) shift = -pitch;
          if (from > to && k < from && k >= to) shift = pitch;
          r.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
        });
      };
      const end = (ev) => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', end);
        grip.removeEventListener('pointercancel', end);
        rows.forEach((r) => { r.style.transform = ''; });
        row.classList.remove('dragging');
        if (ev.type === 'pointercancel' || to === from) return;
        // Görüntü sırası dizinin tersi
        const list = layers().slice();
        const n = list.length;
        const a = n - 1 - from;
        const b = n - 1 - to;
        const [it] = list.splice(a, 1);
        list.splice(b, 0, it);
        commit(list);
        ctx.refresh();
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', end);
      grip.addEventListener('pointercancel', end);
    });
  }

  // =====================================================================
  // KATMAN AYARLARI
  // =====================================================================
  let editTab = 'source';
  function editPage(id) {
    return {
      size: 'tall',
      title: () => { const l = findLayer(id); return l ? layerName(l) : 'Katman'; },
      subtitle: () => { const l = findLayer(id); return l ? typeLabel(l) : ''; },
      lead(slot) { const l = findLayer(id); if (l) slot.appendChild(thumbOf(l, 'thumb sm')); },
      actions(slot, ctx) {
        const l = findLayer(id);
        if (!l) return;
        slot.appendChild(h('button', {
          class: 'iconbtn plain', 'aria-label': 'Çoğalt', title: 'Çoğalt', disabled: l.locked ? true : null,
          onclick: () => {
            const list = layers().slice();
            const i = list.findIndex((x) => x && x.id === id);
            if (i < 0) return;
            const made = LF().duplicate(list[i]);
            list.splice(i + 1, 0, made);
            commit(list);
            ctx.pop();
            ctx.push(editPage(made.id));
          },
        }, [icon('copy')]));
        slot.appendChild(h('button', {
          class: 'iconbtn plain', 'aria-label': 'Sil', title: 'Sil', disabled: l.locked ? true : null,
          onclick: () => {
            S.confirm('Katman silinsin mi?', 'Sil', true).then((ok) => {
              if (!ok) return;
              commit(layers().filter((x) => !x || x.id !== id));
              ctx.pop();
            });
          },
        }, [icon('trash')]));
      },
      render(body, ctx) {
        const l = findLayer(id);
        if (!l) { ctx.pop(); return; }
        renderEdit(body, ctx, l);
      },
      onConfig(ctx) {
        if (selfDepth) return;
        if (!findLayer(id)) ctx.pop(); else ctx.refresh();
      },
    };
  }

  function renderEdit(body, ctx, l) {
    const id = l.id;
    const set = (fn) => updateLayer(id, fn);
    if (l.locked) {
      body.appendChild(h('div', { class: 'banner info' }, [icon('lock'), h('div', { text: 'Bu katman kilitli. Kilidi masaüstündeki panelden açabilirsiniz.' })]));
      return;
    }
    body.appendChild(U.card([
      U.select({ label: 'Karışım', options: LF().BLEND_LABELS, value: l.blend || 'normal', onChange: (v) => set((x) => { x.blend = v; }) }),
      U.slider({ label: 'Görünürlük', min: 0, max: 1, step: 0.01, percent: true, value: l.opacity == null ? 1 : l.opacity, onInput: (v) => set((x) => { x.opacity = v; }) }),
    ]));
    const pane = h('div', { class: 'edit-pane' });
    const show = (tab) => {
      editTab = tab;
      pane.textContent = '';
      const cur = findLayer(id);
      if (!cur) return;
      const kids = tab === 'transform' ? transformControls(cur, set)
        : tab === 'audio' ? audioControls(cur, set)
          : tab === 'fx' ? fxControls(cur, set, () => show('fx'))
            : sourceControls(cur, set, ctx, () => show('source'));
      for (const k of kids) pane.appendChild(k);
    };
    body.appendChild(U.tabs([['source', 'Kaynak'], ['transform', 'Dönüşüm'], ['audio', 'Ses tepkisi'], ['fx', 'Efektler']], editTab, show));
    body.appendChild(pane);
    show(editTab);
    // Sıra: erişilebilir yol (sürükleme yalnız dokunmayla)
    const list = layers();
    const i = list.findIndex((x) => x && x.id === id);
    const move = (d) => {
      const arr = layers().slice();
      const k = arr.findIndex((x) => x && x.id === id);
      const j = k + d;
      if (k < 0 || j < 0 || j >= arr.length) return;
      [arr[k], arr[j]] = [arr[j], arr[k]];
      commit(arr);
      ctx.refresh();
    };
    body.appendChild(h('div', { class: 'btn-row' }, [
      h('button', { class: 'btn', disabled: i >= list.length - 1 ? true : null, onclick: () => move(1) }, [icon('arrow-up'), 'Öne Al']),
      h('button', { class: 'btn', disabled: i <= 0 ? true : null, onclick: () => move(-1) }, [icon('arrow-down'), 'Arkaya Al']),
    ]));
  }

  // ---- Kaynak: mod ve modun ayarları ----
  function defaults() { return (window.SV && window.SV.defaultConfig) ? window.SV.defaultConfig() : {}; }
  /* Taslaktaki gibi tek kart: en üstte mod, altında modun ayarları. */
  function sourceControls(l, set, ctx) {
    const c = cfg();
    const def = defaults();
    if (l.kind === 'media' || l.kind === 'sprites' || l.kind === 'logo') return [U.card(mediaControls(l, set, ctx, def))];
    if (l.kind !== 'visualizer' && l.kind !== 'background') {
      return [h('div', { class: 'hint', text: 'Bu katman türünün ayarları masaüstündeki panelde. Karışım, görünürlük, dönüşüm, ses tepkisi ve efektler burada da çalışır.' })];
    }
    const mode = U.select({
      label: 'Mod', options: MC().layerPairs(l.kind), value: l.type,
      onChange: (v) => {
        set((x) => {
          x.type = v;
          if (x.kind === 'visualizer' && v !== 'milkdrop' && x.settings && x.settings.milkdrop) delete x.settings.milkdrop;
        });
        ctx.refresh();
      },
    });
    const parts = l.kind === 'visualizer' ? visualizerControls(l, set, c, def) : backgroundControls(l, set, c, def);
    return [U.card([mode].concat(parts))];
  }

  /* Galeriden gelen katmanlar: dosya ve en çok kullanılan ayarlar (masaüstündeki adlarla). */
  function filePick(kind, onFile) {
    return A().media.pick(kind).then(onFile, (e) => {
      const code = String((e && e.message) || e);
      if (code !== 'cancelled') S.confirm(tr('Dosya açılamadı.') + ' (' + code + ')', 'Tamam');
    });
  }
  function fileRow(label, name, preview, onChange) {
    return U.row(label, [
      preview || null,
      h('div', { class: 'row-text' }, [h('div', { class: 'row-title small', text: name || '—' })]),
      h('button', { class: 'btn', onclick: onChange }, [h('span', { text: 'Değiştir' })]),
    ]);
  }
  function mediaControls(l, set, ctx, def) {
    const out = [];
    if (l.kind === 'media') {
      const m = Object.assign({}, def.media, l.settings && l.settings.media);
      const setM = (k, v) => set((x) => { x.settings = x.settings || {}; x.settings.media = Object.assign({}, x.settings.media, { [k]: v }); });
      if ((m.source || 'webcam') !== 'file') out.push(h('div', { class: 'hint', text: 'Kamera ve ekran kaynağı telefonda yok; bir video seçin.' }));
      out.push(fileRow('Video', m.source === 'file' ? m.fileName : '', null, () => filePick('video', (f) => {
        set((x) => { x.settings = x.settings || {}; x.settings.media = Object.assign({}, x.settings.media, { enabled: true, source: 'file', file: f.url, fileName: f.name || '', libraryId: '' }); });
        ctx.refresh();
      })));
      out.push(U.select({ label: 'Sığdırma', options: [['cover', 'Kapla'], ['contain', 'Sığdır'], ['stretch', 'Ger']], value: m.fit || 'cover', onChange: (v) => setM('fit', v) }));
      out.push(U.slider({ label: 'Hız', min: 0.25, max: 2, step: 0.05, value: m.speed == null ? 1 : m.speed, format: (v) => U.num(v, 2) + '×', onInput: (v) => setM('speed', v) }));
      out.push(U.toggle({ label: 'Döngüde Oynat', value: m.loop !== false, onChange: (v) => setM('loop', v) }));
      out.push(U.toggle({ label: 'Aynala', value: !!m.mirror, onChange: (v) => setM('mirror', v) }));
      return out;
    }
    if (l.kind === 'sprites') {
      const items = (l.settings && l.settings.images && l.settings.images.items) || [];
      const it = Object.assign({}, items[0] || {});
      const setI = (k, v) => set((x) => {
        x.settings = x.settings || {};
        const imgs = Object.assign({ enabled: true }, x.settings.images);
        const list = (imgs.items || []).slice();
        list[0] = Object.assign({}, list[0], { [k]: v });
        imgs.items = list;
        x.settings.images = imgs;
      });
      out.push(fileRow('Görsel', it.name || '', it.src ? h('img', { class: 'thumb xs', src: it.src, alt: '' }) : null, () => filePick('image', (f) => {
        setI('src', f.dataUrl);
        setI('name', f.name || 'Görsel');
        ctx.refresh();
      })));
      out.push(U.slider({ label: 'Sayı', min: 1, max: 60, step: 1, value: it.count == null ? 14 : it.count, onInput: (v) => setI('count', Math.round(v)) }));
      out.push(U.slider({ label: 'Boyut', min: 0.02, max: 0.4, step: 0.01, percent: true, value: it.size == null ? 0.07 : it.size, onInput: (v) => setI('size', v) }));
      out.push(U.select({ label: 'Hareket', options: LF().SPRITE_MOTIONS, value: it.motion || 'float', onChange: (v) => setI('motion', v) }));
      out.push(U.seg({ label: 'Konum', options: [['front', 'Önde'], ['back', 'Arkada']], value: l.type === 'front' ? 'front' : 'back', onChange: (v) => set((x) => { x.type = v; }) }));
      return out;
    }
    const lg = Object.assign({}, def.logo, l.settings && l.settings.logo);
    const setL = (k, v) => set((x) => { x.settings = x.settings || {}; x.settings.logo = Object.assign({}, x.settings.logo, { [k]: v }); });
    out.push(fileRow('Resim', '', lg.src && String(lg.src).indexOf('data:') === 0 ? h('img', { class: 'thumb xs', src: lg.src, alt: '' }) : null, () => filePick('image', (f) => {
      set((x) => { x.settings = x.settings || {}; x.settings.logo = Object.assign({}, x.settings.logo, { enabled: true, source: 'manual', src: f.dataUrl, libraryId: '' }); });
      ctx.refresh();
    })));
    out.push(U.slider({ label: 'Boyut', min: 0.05, max: 0.9, step: 0.01, percent: true, value: lg.scale == null ? 0.22 : lg.scale, onInput: (v) => setL('scale', v) }));
    out.push(U.slider({ label: 'Yatay Konum', min: 0, max: 1, step: 0.01, percent: true, value: lg.x == null ? 0.5 : lg.x, onInput: (v) => setL('x', v) }));
    out.push(U.slider({ label: 'Dikey Konum', min: 0, max: 1, step: 0.01, percent: true, value: lg.y == null ? 0.5 : lg.y, onInput: (v) => setL('y', v) }));
    out.push(U.slider({ label: 'Nabız', min: 0, max: 1, step: 0.01, percent: true, value: lg.pulse == null ? 0.3 : lg.pulse, onInput: (v) => setL('pulse', v) }));
    return out;
  }

  function visualizerControls(l, set, c, def) {
    const out = [];
    const vs = (l.settings && l.settings.visualizer) || {};
    const scene = Object.assign({}, def.visualizer || {}, c.visualizer || {});
    const fact = def.visualizer || {};
    const getV = (k, fb) => (vs[k] != null ? vs[k] : (scene[k] != null ? scene[k] : fb));
    const fd = (k, fb) => (fact[k] != null ? fact[k] : fb);
    const setV = (k, v) => set((x) => { x.settings = x.settings || {}; x.settings.visualizer = Object.assign({}, x.settings.visualizer, { [k]: v }); });
    const sens = (fb) => U.slider({ label: 'Hassasiyet', min: 0.2, max: 3, step: 0.05, value: getV('sensitivity', fd('sensitivity', fb)), onInput: (v) => setV('sensitivity', v) });

    if (l.type === 'text') {
      const t = (l.settings && l.settings.text) || {};
      const setT = (k, v) => set((x) => { x.settings = x.settings || {}; x.settings.text = Object.assign({}, x.settings.text, { [k]: v }); });
      const kids = [];
      if ((t.source || 'static') === 'static') kids.push(U.text({ label: 'Metin', value: t.content || '', onInput: (v) => setT('content', v) }));
      else kids.push(h('div', { class: 'hint', text: t.source === 'lyrics' ? 'Şarkı sözü dosyası kitaplıkla birlikte gelecek (Faz 4).' : 'Çalan parçanın adı.' }));
      kids.push(U.slider({ label: 'Yazı Boyutu', min: 0.02, max: 0.3, step: 0.005, percent: true, value: t.size == null ? 0.09 : t.size, onInput: (v) => setT('size', v) }));
      kids.push(U.slider({ label: 'Dikey Konum', min: 0, max: 1, step: 0.01, percent: true, value: t.y == null ? 0.5 : t.y, onInput: (v) => setT('y', v) }));
      kids.push(U.color({ label: 'Metin Rengi', value: t.color || '#ffffff', onChange: (v) => setT('color', v) }));
      return kids;
    }
    if (l.type === 'milkdrop') {
      const md = (l.settings && l.settings.milkdrop) || {};
      const name = md.independent ? md.name : (c.milkdrop && c.milkdrop.name);
      return [
        U.row('Preset', [h('div', { class: 'row-text' }, [h('div', { class: 'row-title', text: name || 'Yerleşik varsayılan' })])]),
        h('button', {
          class: 'btn',
          onclick: () => (window.SVShellLibrary ? window.SVShellLibrary.pickFor(md.independent ? l.id : null) : S.open('library')),
        }, [icon('library'), 'Kitaplıktan Seç']),
        sens(1),
      ];
    }
    if (MC().is('visualizer', l.type, 'engine') || l.type === 'custom') {
      return [sens(1), h('div', { class: 'hint', text: 'Renk ve biçim bu motorun kendi ayarlarından gelir.' })];
    }
    const mode = vs.colorMode || (vs.rainbow !== undefined ? (vs.rainbow ? 'rainbow' : 'custom') : (scene.colorMode || (scene.rainbow ? 'rainbow' : 'custom')));
    const kids = [
      U.seg({
        label: 'Renk Modu', options: [['custom', 'Sabit Renk'], ['theme', 'Renk Teması'], ['rainbow', 'Gökkuşağı']], value: mode,
        onChange: (m) => { set((x) => { x.settings = x.settings || {}; x.settings.visualizer = Object.assign({}, x.settings.visualizer, { colorMode: m, rainbow: m === 'rainbow' }); }); },
      }),
    ];
    if (mode === 'custom') {
      kids.push(U.color({ label: 'Renk', value: getV('color', '#ff2d3a'), onChange: (v) => setV('color', v) }));
      if (MC().is('visualizer', l.type, 'color2')) kids.push(U.color({ label: 'İkincil Renk', value: getV('color2', '#3aa6ff'), onChange: (v) => setV('color2', v) }));
    }
    kids.push(sens(1));
    if (l.type !== 'spectrogram') kids.push(U.slider({ label: 'Parlama', min: 0, max: 1, step: 0.02, percent: true, value: getV('glow', fd('glow', 0.2)), onInput: (v) => setV('glow', v) }));
    if (MC().is('visualizer', l.type, 'bands')) kids.push(U.slider({ label: 'Bar Sayısı', min: 16, max: 160, step: 1, value: getV('barCount', fd('barCount', 64)), onInput: (v) => setV('barCount', Math.round(v)) }));
    if (MC().is('visualizer', l.type, 'gap')) kids.push(U.slider({ label: 'Bar Boşluğu', min: 0, max: 0.8, step: 0.02, percent: true, value: getV('gap', fd('gap', 0.3)), onInput: (v) => setV('gap', v) }));
    if (MC().is('visualizer', l.type, 'wave')) kids.push(U.slider({ label: 'Çizgi Kalınlığı', min: 1, max: 12, step: 0.5, value: getV('lineWidth', fd('lineWidth', 3)), onInput: (v) => setV('lineWidth', v) }));
    if (MC().is('visualizer', l.type, 'thick')) kids.push(U.slider({ label: 'Genlik', min: 0.1, max: 1, step: 0.02, percent: true, value: getV('thickness', fd('thickness', 0.42)), onInput: (v) => setV('thickness', v) }));
    if (['bars', 'wave', 'radialWave'].indexOf(l.type) >= 0) kids.push(U.toggle({ label: 'Ayna', value: !!getV('mirror', false), onChange: (v) => setV('mirror', v) }));
    if (l.type === 'bars') kids.push(U.toggle({ label: 'Tepe Noktaları', value: getV('cap', true) !== false, onChange: (v) => setV('cap', v) }));
    return kids;
  }

  function backgroundControls(l, set, c, def) {
    const bgS = (l.settings && l.settings.background) || {};
    const scene = Object.assign({}, def.background || {}, c.background || {});
    const kids = [];
    const setBg = (fn) => set((x) => { x.settings = x.settings || {}; x.settings.background = JSON.parse(JSON.stringify(x.settings.background || {})); fn(x.settings.background); });
    if (l.type === 'solid') {
      kids.push(U.color({ label: 'Renk', value: bgS.solidColor || scene.solidColor || '#000000', onChange: (v) => setBg((b) => { b.solidColor = v; }) }));
    } else if (l.type === 'gradient') {
      const g = Object.assign({}, scene.gradient || {}, bgS.gradient || {});
      const G = [['speed', 'Akış Hızı', 0, 2, 0.02, false], ['audioReactivity', 'Ses Tepkisi', 0, 2, 0.02, false], ['brightness', 'Parlaklık', 0.4, 1.6, 0.02, false], ['audioHue', 'Renk Kayması', 0, 1, 0.01, true], ['vignette', 'Vinyet', 0, 1, 0.01, true]];
      for (const [k, t, mn, mx, st, pc] of G) {
        kids.push(U.slider({ label: t, min: mn, max: mx, step: st, percent: pc, value: g[k] == null ? mn : g[k], onInput: (v) => setBg((b) => { b.gradient = Object.assign({}, b.gradient, { [k]: v }); }) }));
      }
    }
    for (const [k, t, mn, mx, st, pc] of MC().settingsOf('background', l.type)) {
      const own = bgS[l.type] || {};
      const base = (scene[l.type] || {});
      const v = own[k] != null ? own[k] : (base[k] != null ? base[k] : mn);
      kids.push(U.slider({ label: t, min: mn, max: mx, step: st, percent: !!pc, value: v, onInput: (nv) => setBg((b) => { b[l.type] = Object.assign({}, b[l.type], { [k]: nv }); }) }));
    }
    if (!kids.length) kids.push(h('div', { class: 'hint', text: 'Bu arkaplanın ayarı yok.' }));
    return kids;
  }

  // ---- Dönüşüm ----
  function transformControls(l, set) {
    const t = Object.assign({ scale: 1, rotate: 0, x: 0, y: 0, flipX: false, flipY: false }, l.transform);
    const setT = (k, v) => set((x) => { x.transform = Object.assign({}, x.transform, { [k]: v }); });
    return [U.card([
      U.slider({ label: 'Boyut', min: 0.1, max: 3, step: 0.01, percent: true, value: t.scale, onInput: (v) => setT('scale', v) }),
      U.slider({ label: 'Döndürme', min: -180, max: 180, step: 1, value: t.rotate, format: (v) => Math.round(v) + '°', onInput: (v) => setT('rotate', v) }),
      U.slider({ label: 'Yatay Konum', min: -1, max: 1, step: 0.01, percent: true, value: t.x, onInput: (v) => setT('x', v) }),
      U.slider({ label: 'Dikey Konum', min: -1, max: 1, step: 0.01, percent: true, value: t.y, onInput: (v) => setT('y', v) }),
      U.toggle({ label: 'Yatay Çevir', value: !!t.flipX, onChange: (v) => setT('flipX', v) }),
      U.toggle({ label: 'Dikey Çevir', value: !!t.flipY, onChange: (v) => setT('flipY', v) }),
    ])];
  }

  // ---- Ses tepkisi ----
  function audioControls(l, set) {
    const a = Object.assign({ band: 'bass', opacity: 0, scale: 0, rotate: 0 }, l.audio);
    const setA = (k, v) => set((x) => { x.audio = Object.assign({}, x.audio, { [k]: v }); });
    return [U.card([
      U.seg({ label: 'Bant', options: LF().BAND_LABELS, value: a.band, onChange: (v) => setA('band', v) }),
      U.slider({ label: 'Saydamlık', min: 0, max: 1, step: 0.02, percent: true, value: a.opacity, onInput: (v) => setA('opacity', v) }),
      U.slider({ label: 'Ölçek', min: 0, max: 1, step: 0.02, percent: true, value: a.scale, onInput: (v) => setA('scale', v) }),
      U.slider({ label: 'Döndürme', min: 0, max: 1, step: 0.02, percent: true, value: a.rotate, onInput: (v) => setA('rotate', v) }),
    ]), h('div', { class: 'hint', text: 'Seçilen bant katmanın saydamlığını, ölçeğini ve dönüşünü sürer.' })];
  }

  // ---- Efektler (katmanın kendi zinciri) ----
  function fxControls(l, set, redraw) {
    const F = FX();
    const out = [];
    const chain = Array.isArray(l.postfx) ? l.postfx : [];
    if (!F) return [h('div', { class: 'hint', text: 'Efektler yüklenemedi.' })];
    chain.forEach((f, fi) => {
      const d = F.EFFECTS[f.type];
      const setF = (fn) => set((x) => { x.postfx = JSON.parse(JSON.stringify(x.postfx || [])); if (x.postfx[fi]) fn(x.postfx[fi]); });
      const kids = [h('div', { class: 'ctl-row' }, [
        h('div', { class: 'row-title fx-title', text: d ? d.label : f.type }),
        h('div', { class: 'spacer' }),
        h('button', { class: 'toggle', role: 'switch', 'aria-label': d ? d.label : f.type, 'aria-checked': f.enabled !== false ? 'true' : 'false', onclick: (e) => { const on = e.currentTarget.getAttribute('aria-checked') !== 'true'; e.currentTarget.setAttribute('aria-checked', on ? 'true' : 'false'); setF((x) => { x.enabled = on; }); } }),
        h('button', { class: 'iconbtn', 'aria-label': 'Kaldır', title: 'Kaldır', onclick: () => { set((x) => { x.postfx = (x.postfx || []).filter((_, k) => k !== fi); }); redraw(); } }, [icon('x')]),
      ])];
      for (const p of (d && d.params) || []) {
        const v = f.params && f.params[p.name] != null ? f.params[p.name] : p.default;
        kids.push(U.slider({ label: p.label, min: p.min, max: p.max, step: p.step, value: v, onInput: (nv) => setF((x) => { x.params = Object.assign({}, x.params, { [p.name]: nv }); }) }));
      }
      if (d && d.lutFile) kids.push(h('div', { class: 'hint', text: 'LUT dosyası seçimi kitaplıkla birlikte gelecek (Faz 4).' }));
      out.push(U.card(kids));
    });
    if (!chain.length) out.push(h('div', { class: 'hint', text: 'Bu katmanın efekti yok. Eklenen efektler yalnız bu katmana uygulanır.' }));
    const ids = F.EFFECT_IDS.filter((k) => !F.EFFECTS[k].lutFile);
    out.push(U.card([U.select({
      label: 'Efekt Ekle', options: [['', '—']].concat(ids.map((k) => [k, F.EFFECTS[k].label])), value: '',
      onChange: (v) => { if (!v) return; set((x) => { x.postfx = (x.postfx || []).concat([F.defaultChainEntry(v)]); }); redraw(); },
    })]));
    return out;
  }

  // =====================================================================
  // KATMAN EKLE
  // =====================================================================
  const CATS = [
    ['visualizer', 'Görselleştirici'], ['background', 'Arkaplan'], ['milkdrop', 'MilkDrop'], ['media', 'Medya'], ['text', 'Metin'],
  ];
  let addCat = 'visualizer';
  function addPage() {
    let query = '';
    let pick = null;
    const fold = (s) => (window.SVText ? window.SVText.fold(s) : String(s).toLowerCase());
    return {
      size: 'full',
      title: 'Katman Ekle',
      render(body, ctx) {
        const search = h('input', { type: 'search', placeholder: 'Modlarda ara', 'aria-label': 'Modlarda ara', value: query });
        const pills = h('div', { class: 'pills', role: 'tablist' });
        const banner = h('div');
        const grid = h('div', { class: 'grid2' });
        const addBtn = h('button', { class: 'btn primary block' });
        const items = () => {
          if (addCat === 'visualizer' || addCat === 'background') {
            return MC().layerPairs(addCat).filter(([id]) => !(addCat === 'visualizer' && (id === 'milkdrop' || id === 'text' || id === 'custom')))
              .map(([id, label]) => ({ what: { kind: addCat, type: id }, label, l: { kind: addCat, type: id } }));
          }
          if (addCat === 'milkdrop') return [{ what: { kind: 'milkdrop' }, label: 'MilkDrop', l: { kind: 'visualizer', type: 'milkdrop' } }];
          if (addCat === 'text') {
            return LF().TEXT_ADD_PRESETS.map((p, i) => ({ what: { kind: 'text', preset: i }, label: p.label, l: { kind: 'visualizer', type: 'text' } }))
              .concat([{ what: { kind: 'nowplaying' }, label: 'Çalan Parça', l: { kind: 'nowplaying', type: 'nowplaying' } }]);
          }
          if (addCat === 'media') {
            // Galeriden seçilir; ekle düğmesi önce Android'in seçicisini açar
            return [
              { what: { media: 'video' }, label: 'Video', l: { kind: 'media' }, icon: 'video' },
              { what: { media: 'image' }, label: 'Görsel Nesneler', l: { kind: 'sprites' }, icon: 'sparkles' },
              { what: { media: 'logo' }, label: 'Logo', l: { kind: 'logo' }, icon: 'image' },
            ];
          }
          return [];
        };
        /* "Barlar katmanını ekle" / "Add Bars layer": sözcük sırası dile göre */
        const paintFoot = () => {
          addBtn.textContent = '';
          addBtn.disabled = !pick;
          addBtn.appendChild(icon('plus'));
          const en = !!(window.SVI18n && window.SVI18n.locale === 'en');
          const name = pick ? tr(pick.label) : '';
          addBtn.appendChild(h('span', { text: !pick ? tr('Katman Ekle') : en ? 'Add ' + name + ' layer' : name + ' katmanını ekle' }));
        };
        const paintGrid = () => {
          grid.textContent = '';
          const q = fold(query);
          const list = items().filter((it) => !q || fold(tr(it.label)).indexOf(q) >= 0 || fold(it.label).indexOf(q) >= 0);
          if (!list.length) grid.appendChild(h('div', { class: 'empty span2', text: 'Sonuç yok.' }));
          for (const it of list) {
            const sel = pick && pick.label === it.label && pick.what.kind === it.what.kind && pick.what.media === it.what.media;
            grid.appendChild(h('button', {
              class: 'tile' + (sel ? ' sel' : ''), 'aria-pressed': sel ? 'true' : 'false',
              onclick: () => { pick = it; paintGrid(); paintFoot(); },
              ondblclick: () => { pick = it; doAdd(); },
            }, [
              thumbKey(it.l.kind, it.l.type) ? h('img', { src: THUMB_DIR + thumbKey(it.l.kind, it.l.type) + '.webp', alt: '', loading: 'lazy', decoding: 'async' })
                : h('div', { class: 'ph', 'aria-hidden': 'true' }, [icon(it.icon || (it.l.type === 'text' ? 'text' : it.l.kind === 'nowplaying' ? 'music' : it.l.type === 'milkdrop' ? 'drop' : 'background'))]),
              h('div', { class: 'cap' }, [h('span', { text: it.label })]),
            ]));
          }
        };
        const paintPills = () => {
          pills.textContent = '';
          for (const [id, t] of CATS) {
            pills.appendChild(h('button', {
              class: 'pill' + (id === addCat ? ' on' : ''), role: 'tab', 'aria-selected': id === addCat ? 'true' : 'false', text: t,
              onclick: () => { addCat = id; pick = items()[0] || null; paintPills(); paintGrid(); paintFoot(); },
            }));
          }
        };
        /* GPU bağlam bütçesi (SVAndroid.gl(), sınır 8): sınıra yakınsa WebGL kullanan bir
           katman daha en eski bağlamı karartabilir. */
        const paintBanner = () => {
          banner.textContent = '';
          const g = A().gl ? A().gl() : null;
          if (!g || !(g.limit > 0) || g.live < g.limit - 1) return;
          banner.appendChild(h('div', { class: 'banner', role: 'status' }, [
            icon('warning'),
            h('div', {}, [
              h('b', {}, [h('span', { text: 'Sahne sınıra yakın:' }), ' ' + g.live + ' / ' + g.limit + ' ', h('span', { text: 'GPU bağlamı.' })]),
              ' ', h('span', { text: 'WebGL kullanan bir katman daha eklenirse en eski katman kararabilir. Gizli katmanları silmek yer açar.' }),
            ]),
          ]));
        };
        const doAdd = async () => {
          if (!pick) return;
          if (pick.what.media) {
            // Galeriden dosya; vazgeçilirse sayfa yerinde kalır
            let file;
            try { file = await A().media.pick(pick.what.media === 'video' ? 'video' : 'image'); } catch (e) {
              const code = String((e && e.message) || e);
              if (code !== 'cancelled') S.confirm(tr('Dosya açılamadı.') + ' (' + code + ')', 'Tamam');
              return;
            }
            const made = LF().makeMedia(pick.what.media, file);
            own(() => A().config.patch({ layers: layers().concat([made]) }));
            ctx.pop();
            ctx.push(editPage(made.id));
            return;
          }
          const next = layers().slice();
          const c = JSON.parse(JSON.stringify(cfg()));
          let made;
          try { made = LF().make(pick.what, c); } catch (e) { console.error('[shell-layers]', e); return; }
          next.push(made);
          // MilkDrop'ta ortak preset boşsa üretici sahnenin milkdrop'una yazıyor
          const patch = { layers: next };
          if (pick.what.kind === 'milkdrop' && JSON.stringify(c.milkdrop) !== JSON.stringify(cfg().milkdrop)) patch.milkdrop = c.milkdrop;
          own(() => A().config.patch(patch));
          ctx.pop();
          ctx.push(editPage(made.id));
        };
        addBtn.addEventListener('click', doAdd);
        // Taslaktaki gibi ilk mod seçili gelir; tek dokunuşla eklenir
        if (!pick) pick = items()[0] || null;
        search.addEventListener('input', () => { query = search.value; paintGrid(); });
        body.appendChild(h('label', { class: 'search' }, [icon('search'), search]));
        body.appendChild(pills);
        body.appendChild(banner);
        body.appendChild(grid);
        // Alt düğme sayfanın gövdesinin dışında, hep görünür
        ctx.foot.appendChild(addBtn);
        paintPills(); paintBanner(); paintGrid(); paintFoot();
        thumbsReady.then(() => { if (grid.isConnected) paintGrid(); });
      },
    };
  }

  S.tab('layers', listPage);
  window.SVShellLayers = Object.freeze({ thumbKey, thumbsReady: () => thumbsReady, typeLabel });
})();
