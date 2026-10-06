/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Logo / görsel kitaplığı paneli. Logo kartı ve katman yığınındaki logo
   seçicisi aynı listeyi kullanır; katman kaydı (src / libraryId) değişmez,
   yalnız seçilen öğe uygulanır. */
(function () {
  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') n.className = v;
        else if (k === 'icon') { /* SVG aşağıda; öznitelik olarak kalırsa düğme boş ve renksiz kalır */ }
        else if (k === 'text') n.textContent = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k.indexOf('on') === 0 && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'style' && typeof v === 'string') n.setAttribute('style', v);
        else n.setAttribute(k, v === true ? '' : v);
      });
    }
    /* admin el() ile aynı: ikon currentColor çizgisi. icon="x" özniteliği
       SVG üretmiyordu; sil düğmesi koyu boş daire olarak kalıyordu. */
    if (attrs && attrs.icon && window.SVIcons) {
      const txt = n.textContent;
      n.insertBefore(window.SVIcons.el(attrs.icon, txt ? 'svi-lead' : ''), n.firstChild);
      n.setAttribute('data-icon', attrs.icon);
    }
    (kids || []).forEach((c) => { if (c) n.appendChild(c); });
    return n;
  }

  function tr(s) {
    return (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s) || s;
  }

  function srcFor(item) {
    if (!item || !item.id) return '';
    if (window.SVLogoRuntime) {
      const ready = window.SVLogoRuntime.urlFor(item.id);
      if (ready) return ready;
      window.SVLogoRuntime.warm(item.id);
    }
    return window.SVGif ? window.SVGif.libraryUrl(item.id) : ('sv-logo://lib/' + encodeURIComponent(item.id));
  }

  async function listItems() {
    if (!window.api || !window.api.logoLibList) return [];
    try { return (await window.api.logoLibList()) || []; } catch { return []; }
  }

  function mount(opts) {
    const o = opts || {};
    const onPick = o.onPick;
    const thumbTag = o.thumb === 'video' ? 'video' : 'img';
    const srcForItem = o.srcFor || srcFor;
    const listFn = o.list || listItems;
    const removeFn = o.remove;
    const importFn = o.import;
    let selectedId = o.selectedId || '';
    const wrap = el('div', { class: 'logo-lib' });
    const head = el('div', { class: 'logo-lib-head' }, [
      el('div', { class: 'lbl', text: o.title || tr('Kitaplık') }),
    ]);
    const search = el('input', {
      class: 'p-in logo-lib-search',
      type: 'search',
      placeholder: tr('Ara…'),
    });
    const grid = el('div', { class: 'logo-lib-grid' });
    const empty = el('div', { class: 'studio-note dim-hint', text: o.empty || tr('Henüz kitaplıkta görsel yok. Aşağıdan birden fazla resim veya GIF ekleyebilirsiniz.') });
    const toolbar = el('div', { class: 'up-toolbar' });
    const addBtn = el('button', {
      class: 'btn ghost small',
      type: 'button',
      icon: 'import', text: o.addLabel || tr('Kitaplığa Ekle'),
    });
    toolbar.appendChild(addBtn);
    wrap.appendChild(head);
    wrap.appendChild(search);
    wrap.appendChild(grid);
    wrap.appendChild(empty);
    wrap.appendChild(toolbar);

    let items = [];
    let q = '';
    let lastIds = '';

    function filtered() {
      const s = q.trim().toLowerCase();
      if (!s) return items;
      return items.filter((it) => String(it.name || '').toLowerCase().indexOf(s) >= 0);
    }

    function paint(force) {
      /* blobRefresh: runtime ısınınca thumb src'lerini protokolden blob'a çevir */
      if (thumbTag === 'img' && !paint._blobTimer) {
        paint._blobTimer = setInterval(() => {
          if (!window.SVLogoRuntime) return;
          let pending = 0;
          grid.querySelectorAll('.logo-lib-thumb').forEach((img) => {
            const card = img.closest('.logo-lib-cell');
            // id is not on img; re-filter list
          });
          const list = filtered();
          grid.querySelectorAll('.logo-lib-thumb').forEach((img, i) => {
            const it = list[i];
            if (!it) return;
            const ready = window.SVLogoRuntime.urlFor(it.id);
            if (ready && img.src !== ready) img.src = ready;
            else if (!ready) pending++;
          });
          if (pending === 0 && items.length) {
            clearInterval(paint._blobTimer);
            paint._blobTimer = null;
          }
        }, 120);
      }
      const list = filtered();
      const ids = list.map((it) => it.id).join('|');
      empty.style.display = items.length ? 'none' : 'block';
      grid.style.display = list.length ? 'grid' : 'none';
      if (!force && ids === lastIds && grid.childNodes.length === list.length) {
        grid.querySelectorAll('.logo-lib-card').forEach((card, i) => {
          card.classList.toggle('is-on', !!(list[i] && list[i].id === selectedId));
        });
        return;
      }
      lastIds = ids;
      grid.innerHTML = '';
      list.forEach((it) => {
        const thumbAttrs = { class: 'logo-lib-thumb', alt: it.name || '', src: srcForItem(it) };
        if (thumbTag === 'img') thumbAttrs.loading = 'lazy';
        else {
          thumbAttrs.muted = true;
          thumbAttrs.preload = 'metadata';
          thumbAttrs.playsinline = true;
        }
        const thumb = el(thumbTag, thumbAttrs);
        if (thumbTag === 'img') thumb.setAttribute('decoding', 'async');
        else {
          thumb.muted = true;
          thumb.preload = 'metadata';
        }
        const name = el('div', { class: 'logo-lib-name', text: it.name || it.id });
        const badge = it.kind === 'gif' ? el('span', { class: 'logo-lib-badge', text: 'GIF' }) : null;
        const del = el('button', {
          class: 'logo-lib-del',
          type: 'button',
          icon: 'x',
          title: tr('Sil'),
          'aria-label': tr('Sil'),
        });
        /* video düğmenin içinde etkileşimli içerik sayılır; kart div kalır. */
        const card = el(thumbTag === 'video' ? 'div' : 'button', {
          class: 'logo-lib-card' + (it.id === selectedId ? ' is-on' : ''),
          type: thumbTag === 'video' ? null : 'button',
          role: thumbTag === 'video' ? 'button' : null,
          tabindex: thumbTag === 'video' ? '0' : null,
        }, [thumb, badge, name].filter(Boolean));
        card.addEventListener('click', () => {
          selectedId = it.id;
          paint();
          if (onPick) onPick(it);
        });
        del.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const drop = removeFn || (window.api && window.api.logoLibRemove
            ? (id) => window.api.logoLibRemove(id) : null);
          if (!drop) return;
          let removed = false;
          try {
            const r = await drop(it.id);
            removed = !r || r.ok !== false;
          } catch { removed = false; }
          if (!removed) return;
          if (selectedId === it.id) selectedId = '';
          /* Seçili kart ile ekrandaki logo ayrı durabilir. Silinen kimlik
             sahnedeyse onu da bırak; seçili değil diye ölü kimlik kalmasın. */
          if (opts && opts.onRemove) opts.onRemove(it);
          await refresh();
        });
        const cell = el('div', { class: 'logo-lib-cell' }, [card, del]);
        grid.appendChild(cell);
      });
    }

    async function refresh() {
      items = await listFn();
      paint(true);
    }

    search.addEventListener('input', () => { q = search.value || ''; paint(); });
    addBtn.addEventListener('click', async () => {
      const pull = importFn || (window.api && window.api.logoLibImport
        ? () => window.api.logoLibImport() : null);
      if (!pull) return;
      const r = await pull();
      if (r && r.ok) await refresh();
    });

    refresh();
    return wrap;
  }

  function mountMedia(opts) {
    const o = opts || {};
    return mount({
      selectedId: o.selectedId || '',
      thumb: 'video',
      empty: tr('Henüz kitaplıkta video yok. Aşağıdan birden fazla video ekleyebilirsiniz.'),
      srcFor: (it) => (it && it.url) || '',
      list: async () => {
        if (!window.api || !window.api.mediaLibList) return [];
        try { return (await window.api.mediaLibList()) || []; } catch { return []; }
      },
      remove: (id) => window.api && window.api.mediaLibRemove ? window.api.mediaLibRemove(id) : null,
      import: () => window.api && window.api.mediaLibImport ? window.api.mediaLibImport() : null,
      onPick: o.onPick,
      onRemove: o.onRemove,
    });
  }

  /* Silinen video klasik kartta ya da herhangi bir katmanda duruyor olabilir. */
  function forget(cfg, it) {
    const id = it && it.id;
    if (!id || !cfg) return false;
    let hit = false;
    const wipe = (m) => {
      if (!m || m.libraryId !== id) return;
      m.libraryId = '';
      m.file = '';
      m.fileName = '';
      hit = true;
    };
    wipe(cfg.media);
    const layers = Array.isArray(cfg.layers) ? cfg.layers : [];
    for (let i = 0; i < layers.length; i++) {
      const s = layers[i] && layers[i].settings;
      if (s) wipe(s.media);
    }
    return hit;
  }

  window.SVLogoLibUi = { mount, srcFor, listItems };
  window.SVMediaLibUi = { mount: mountMedia, forget };
})();
