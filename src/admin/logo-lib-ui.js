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
        else if (k === 'text') n.textContent = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k.indexOf('on') === 0 && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'style' && typeof v === 'string') n.setAttribute('style', v);
        else n.setAttribute(k, v === true ? '' : v);
      });
    }
    (kids || []).forEach((c) => { if (c) n.appendChild(c); });
    return n;
  }

  function tr(s) {
    return (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s) || s;
  }

  function srcFor(item) {
    if (!item || !item.id) return '';
    return window.SVGif ? window.SVGif.libraryUrl(item.id) : ('sv-logo://lib/' + encodeURIComponent(item.id));
  }

  async function listItems() {
    if (!window.api || !window.api.logoLibList) return [];
    try { return (await window.api.logoLibList()) || []; } catch { return []; }
  }

  function mount(opts) {
    const onPick = opts && opts.onPick;
    const selectedId = (opts && opts.selectedId) || '';
    const wrap = el('div', { class: 'logo-lib' });
    const head = el('div', { class: 'logo-lib-head' }, [
      el('div', { class: 'lbl', text: tr('Kitaplık') }),
    ]);
    const search = el('input', {
      class: 'p-in logo-lib-search',
      type: 'search',
      placeholder: tr('Ara…'),
    });
    const grid = el('div', { class: 'logo-lib-grid' });
    const empty = el('div', { class: 'studio-note dim-hint', text: tr('Henüz kitaplıkta görsel yok. Aşağıdan birden fazla resim veya GIF ekleyebilirsiniz.') });
    const toolbar = el('div', { class: 'up-toolbar' });
    const addBtn = el('button', {
      class: 'btn ghost small',
      type: 'button',
      text: tr('📥 Kitaplığa Ekle'),
    });
    toolbar.appendChild(addBtn);
    wrap.appendChild(head);
    wrap.appendChild(search);
    wrap.appendChild(grid);
    wrap.appendChild(empty);
    wrap.appendChild(toolbar);

    let items = [];
    let q = '';

    function filtered() {
      const s = q.trim().toLowerCase();
      if (!s) return items;
      return items.filter((it) => String(it.name || '').toLowerCase().indexOf(s) >= 0);
    }

    function paint() {
      const list = filtered();
      grid.innerHTML = '';
      empty.style.display = items.length ? 'none' : 'block';
      grid.style.display = list.length ? 'grid' : 'none';
      list.forEach((it) => {
        const thumb = el('img', { class: 'logo-lib-thumb', alt: it.name || '', src: srcFor(it) });
        const name = el('div', { class: 'logo-lib-name', text: it.name || it.id });
        const badge = it.kind === 'gif' ? el('span', { class: 'logo-lib-badge', text: 'GIF' }) : null;
        const del = el('button', {
          class: 'logo-lib-del',
          type: 'button',
          text: '✕',
          title: tr('Sil'),
        });
        const card = el('button', {
          class: 'logo-lib-card' + (it.id === selectedId ? ' is-on' : ''),
          type: 'button',
        }, [thumb, badge, name].filter(Boolean));
        card.addEventListener('click', (e) => {
          if (e.target === del) return;
          if (onPick) onPick(it);
        });
        del.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!window.api || !window.api.logoLibRemove) return;
          await window.api.logoLibRemove(it.id);
          await refresh();
        });
        const cell = el('div', { class: 'logo-lib-cell' }, [card, del]);
        grid.appendChild(cell);
      });
    }

    async function refresh() {
      items = await listItems();
      paint();
    }

    search.addEventListener('input', () => { q = search.value || ''; paint(); });
    addBtn.addEventListener('click', async () => {
      if (!window.api || !window.api.logoLibImport) return;
      const r = await window.api.logoLibImport();
      if (r && r.ok) await refresh();
    });

    refresh();
    return wrap;
  }

  window.SVLogoLibUi = { mount, srcFor, listItems };
})();
