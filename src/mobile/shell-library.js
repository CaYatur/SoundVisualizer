/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* KİTAPLIK SEKMESİ (docs/android/PLAN.md Faz 3; onaylı taslak 6).

   Tam ekran sayfa; dört bölüm:
   - MilkDrop: yerleşik paket ve bilgisayardan aktarılan presetler. Arama ad, yazar ve
     #etiket üzerinden (Türkçe harf farkı yok). Tümü / Favoriler / Son çalınan. Yıldız
     masaüstüyle aynı yere yazar (`milkdropLibrary.favorites`). Dokunulan preset ortak
     MilkDrop'a gider; katman ayarlarından "Kitaplıktan Seç" ile gelindiyse o katmana
     (kendi preseti). Sahnede MilkDrop katmanı yoksa bir tane eklenir.
     Aktarılan presetlerin listesi kaynaksız (10 binden fazla olabiliyor); kaynak
     seçilince istenir (window.api.milkdropPresetSource).
   - Shader: Studio presetleri. Arkaplan shader'ı arkaplan katmanlarına uygulanır
     (Otomatik VJ'nin yaptığı gibi), görselleştirici shader'ı yeni katman olarak eklenir.
   - Sahneler: kayıtlı sahneler; dokununca çağrılır. Şu anki görüntü yeni sahne olarak
     kaydedilebilir.
   - Medya: telefonun kitaplığıyla birlikte gelecek (Faz 4).

   Telefonda MilkDrop küçük resmi çizilmiyor (masaüstünde çizim sırası ayrı bir pencerede);
   kutu presetin kimliğinden türeyen, temanın vurgusuyla bir desen gösterir. */
(function () {
  if (typeof window === 'undefined' || !window.SVShell || !window.SVShellUI) return;
  const S = window.SVShell;
  const { h, icon, A } = S;
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
  const en = () => !!(window.SVI18n && window.SVI18n.locale === 'en');
  const cfg = () => (A() && A().config.get()) || {};
  const P = () => window.SVPresets;
  const ML = () => window.SVMilkdropLibrary;
  const LF = () => window.SVLayerFactory;
  const fold = (s) => (window.SVText ? window.SVText.fold(s) : String(s || '').toLowerCase());

  const PAGE_SIZE = 60;
  const RECENT_KEY = 'sv-md-recent';
  let section = 'milkdrop';
  let filter = 'all';
  let query = '';
  let shown = PAGE_SIZE;
  let target = null; // { layerId } katman ayarlarından gelindiyse

  function recent() {
    try { const a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function pushRecent(id) {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify([id].concat(recent().filter((x) => x !== id)).slice(0, 40))); } catch (e) { /* depo yok */ }
  }

  // ---- Kutunun deseni: kimlikten açı ve ton payı (renk temadan) ----
  function hash(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
  function art(id, name) {
    const v = hash(String(id));
    const ang = v % 360;
    const a = 0.25 + ((v >>> 9) % 50) / 100;
    const b = 0.1 + ((v >>> 17) % 30) / 100;
    return h('div', {
      class: 'ph art', 'aria-hidden': 'true',
      style: 'background:radial-gradient(circle at ' + (20 + (v % 60)) + '% ' + (20 + ((v >>> 5) % 60)) + '%, rgb(var(--accent-rgb) / ' + a.toFixed(2) + '), transparent 60%),'
        + 'linear-gradient(' + ang + 'deg, var(--card3), rgb(var(--accent-rgb) / ' + b.toFixed(2) + '))',
    }, [h('span', { class: 'art-initial', text: String(tr(name || '?')).trim().charAt(0).toUpperCase() })]);
  }

  // ---- MilkDrop ----
  function mdList() {
    const p = P();
    return p ? p.all().filter((x) => x && x.kind === 'milkdrop') : [];
  }
  function lib() { return cfg().milkdropLibrary || {}; }
  function isFav(id) { return !!(ML() && ML().isFavorite(lib(), id)); }
  function currentId() {
    const c = cfg();
    if (target && target.layerId) {
      const l = (c.layers || []).find((x) => x && x.id === target.layerId);
      return l && l.settings && l.settings.milkdrop ? l.settings.milkdrop.presetId : '';
    }
    return (c.milkdrop && c.milkdrop.presetId) || '';
  }
  function matches(p, q) {
    if (!q) return true;
    if (q.charAt(0) === '#') {
      const t = fold(q.slice(1));
      const tags = (p.tags || []).concat(ML() ? ML().tagsOf(lib(), p.id) : []);
      return tags.some((x) => fold(x).indexOf(t) >= 0);
    }
    const f = fold(q);
    // Ekranda görünen (çevrilmiş) adda da: yerleşik presetlerin adı Türkçe
    return fold(p.name).indexOf(f) >= 0 || fold(tr(p.name || '')).indexOf(f) >= 0 || fold(p.author).indexOf(f) >= 0;
  }

  async function applyMd(p, ctx) {
    let src = typeof p.source === 'string' && p.source ? p.source : '';
    if (!src && window.api && window.api.milkdropPresetSource) src = await window.api.milkdropPresetSource(p.id);
    if (!src) { S.confirm(tr('Preset okunamadı.'), 'Tamam'); return; }
    const c = cfg();
    const layers = Array.isArray(c.layers) ? c.layers.slice() : [];
    const patch = {};
    if (target && target.layerId && layers.some((l) => l && l.id === target.layerId)) {
      const i = layers.findIndex((l) => l && l.id === target.layerId);
      const l = JSON.parse(JSON.stringify(layers[i]));
      l.settings = l.settings || {};
      l.settings.milkdrop = Object.assign({}, l.settings.milkdrop, { independent: true, presetId: p.id, name: p.name || '', source: src });
      layers[i] = l;
      patch.layers = layers;
    } else {
      patch.milkdrop = Object.assign({}, c.milkdrop, { presetId: p.id, name: p.name || '', source: src });
      // Sahnede MilkDrop çizen katman yoksa en üste bir tane
      const has = layers.some((l) => l && l.kind === 'visualizer' && l.type === 'milkdrop' && l.enabled !== false && !(l.settings && l.settings.milkdrop && l.settings.milkdrop.independent));
      if (!has && LF()) {
        const clone = JSON.parse(JSON.stringify(c));
        clone.milkdrop = patch.milkdrop;
        layers.push(LF().make({ kind: 'milkdrop' }, clone));
        patch.layers = layers;
      }
    }
    A().config.patch(patch);
    pushRecent(p.id);
    if (ctx) ctx.refresh();
  }
  function toggleFav(id, ctx) {
    const L = lib();
    A().config.patch({ milkdropLibrary: Object.assign({}, L, { favorites: ML().withFavorite(L, id, !isFav(id)) }) });
    if (ctx) ctx.refresh();
  }

  function mdTile(p, cur, ctx) {
    const fav = isFav(p.id);
    const sel = p.id === cur;
    return h('div', { class: 'tile' + (sel ? ' sel' : '') }, [
      h('button', { class: 'tile-main', 'aria-pressed': sel ? 'true' : 'false', 'aria-label': p.name, onclick: () => applyMd(p, ctx) }, [
        art(p.id, p.name),
        h('div', { class: 'cap' }, [h('span', { text: p.name || p.id })]),
      ]),
      h('button', {
        class: 'star' + (fav ? ' on' : ''), 'aria-label': fav ? 'Favorilerden çıkar' : 'Favorilere ekle', 'aria-pressed': fav ? 'true' : 'false',
        onclick: () => toggleFav(p.id, ctx),
      }, [icon(fav ? 'star-fill' : 'star')]),
    ]);
  }

  function renderMilkdrop(body, ctx) {
    const all = mdList();
    const favs = all.filter((p) => isFav(p.id));
    const rec = recent();
    const byId = new Map(all.map((p) => [p.id, p]));
    const search = h('input', { type: 'search', placeholder: 'Ad, yazar ya da #etiket', 'aria-label': 'Ad, yazar ya da #etiket', value: query });
    const grid = h('div', { class: 'grid2' });
    const more = h('div');
    const cur = currentId();
    const pick = () => {
      let list = filter === 'fav' ? favs : filter === 'recent' ? rec.map((id) => byId.get(id)).filter(Boolean) : all;
      list = list.filter((p) => matches(p, query));
      grid.textContent = '';
      more.textContent = '';
      if (!list.length) {
        grid.appendChild(h('div', { class: 'empty span2', text: filter === 'fav' ? 'Henüz favori yok. Bir presetin yıldızına dokunun.' : filter === 'recent' ? 'Henüz preset çalınmadı.' : 'Sonuç yok.' }));
        return;
      }
      for (const p of list.slice(0, shown)) grid.appendChild(mdTile(p, cur, ctx));
      if (list.length > shown) {
        more.appendChild(h('button', { class: 'btn block', onclick: () => { shown += PAGE_SIZE; pick(); } }, [
          h('span', { text: 'Daha fazla göster' }), ' (' + (list.length - shown) + ')',
        ]));
      }
    };
    search.addEventListener('input', () => { query = search.value; shown = PAGE_SIZE; pick(); });
    body.appendChild(h('label', { class: 'search' }, [icon('search'), search]));
    const pill = (id, label, n, ic) => h('button', {
      class: 'pill' + (filter === id ? ' on' : ''), 'aria-pressed': filter === id ? 'true' : 'false',
      onclick: () => { filter = id; shown = PAGE_SIZE; ctx.refresh(); },
    }, [ic ? icon(ic) : null, h('span', { text: label }), n == null ? null : ' ' + n]);
    body.appendChild(h('div', { class: 'pills' }, [pill('all', 'Tümü', all.length), pill('fav', 'Favoriler', favs.length, 'star'), pill('recent', 'Son çalınan', null)]));
    if (target && target.layerId) {
      body.appendChild(h('div', { class: 'banner info' }, [icon('layers'), h('div', { class: 'grow-text' }, [
        h('span', { text: 'Seçilen preset yalnız bu katmana gider.' }), ' ',
        h('button', { class: 'link', onclick: () => { target = null; ctx.refresh(); } }, [h('span', { text: 'Ortak preset' })]),
      ])]));
    }
    body.appendChild(grid);
    body.appendChild(more);
    pick();
  }

  // ---- Shader (Studio) ----
  function renderShaders(body, ctx) {
    const list = P() ? P().all().filter((p) => p && p.kind !== 'milkdrop' && (p.kind === 'background' || p.kind === 'visualizer')) : [];
    if (!list.length) { body.appendChild(h('div', { class: 'empty', text: 'Shader preseti yok.' })); return; }
    const c = cfg();
    const bgIds = new Set((c.layers || []).filter((l) => l && l.kind === 'background' && l.type === 'custom').map((l) => l.presetId));
    const grid = h('div', { class: 'grid2' });
    for (const p of list) {
      const sel = bgIds.has(p.id);
      grid.appendChild(h('div', { class: 'tile' + (sel ? ' sel' : '') }, [
        h('button', { class: 'tile-main', 'aria-label': p.name, onclick: () => { applyShader(p); ctx.refresh(); } }, [
          art(p.id, p.name),
          h('div', { class: 'cap' }, [h('span', { text: p.name }), h('span', { class: 'kind', text: p.kind === 'background' ? 'Arkaplan' : 'Görselleştirici' })]),
        ]),
      ]));
    }
    body.appendChild(grid);
  }
  function applyShader(p) {
    const c = cfg();
    const layers = (Array.isArray(c.layers) ? c.layers : []).map((l) => l);
    if (p.kind === 'background') {
      let hit = false;
      const next = layers.map((l) => {
        if (!l || l.kind !== 'background' || l.locked) return l;
        hit = true;
        return Object.assign({}, l, { type: 'custom', presetId: p.id });
      });
      if (!hit && window.SVLayers) next.unshift(window.SVLayers.normalizeLayer({ kind: 'background', type: 'custom', presetId: p.id, name: '' }));
      A().config.patch({ layers: next });
      return;
    }
    if (window.SVLayers) {
      const made = window.SVLayers.normalizeLayer({ kind: 'visualizer', type: 'custom', presetId: p.id, name: p.name || '' });
      A().config.patch({ layers: layers.concat([made]) });
    }
  }

  // ---- Sahneler ----
  function renderScenes(body, ctx) {
    const c = cfg();
    const list = Array.isArray(c.scenes) ? c.scenes : [];
    body.appendChild(h('button', { class: 'btn block', onclick: () => saveScene(ctx) }, [icon('save'), 'Şu Anki Görüntüyü Sahne Olarak Kaydet']));
    if (!list.length) { body.appendChild(h('div', { class: 'empty', text: 'Kayıtlı sahne yok.' })); return; }
    const grid = h('div', { class: 'grid2' });
    for (const sc of list) {
      if (!sc) continue;
      const on = sc.id === c._activeSceneId;
      grid.appendChild(h('div', { class: 'tile' + (on ? ' sel' : '') }, [
        h('button', { class: 'tile-main', 'aria-pressed': on ? 'true' : 'false', 'aria-label': sc.name || '', onclick: () => { S.recallScene(sc.id); ctx.refresh(); } }, [
          art(sc.id, sc.name),
          h('div', { class: 'cap' }, [h('span', { text: sc.name || '' })]),
        ]),
        h('button', {
          class: 'star', 'aria-label': 'Sil', title: 'Sil',
          onclick: () => S.confirm(tr('Sahne silinsin mi?'), 'Sil', true).then((ok) => {
            if (!ok) return;
            const cc = cfg();
            const patch = { scenes: (cc.scenes || []).filter((x) => x && x.id !== sc.id) };
            if (cc._activeSceneId === sc.id) patch._activeSceneId = null;
            A().config.patch(patch);
            ctx.refresh();
          }),
        }, [icon('trash')]),
      ]));
    }
    body.appendChild(grid);
  }
  /* Sahne: sahneye ait anahtarların kopyası (SVSchema.SCENE_KEYS), masaüstündeki biçim. */
  function saveScene(ctx) {
    const c = cfg();
    const keys = window.SVSchema ? window.SVSchema.SCENE_KEYS : [];
    const data = {};
    for (const k of keys) if (c[k] !== undefined) data[k] = JSON.parse(JSON.stringify(c[k]));
    const list = Array.isArray(c.scenes) ? c.scenes : [];
    const name = (en() ? 'Scene ' : 'Sahne ') + (list.length + 1);
    const id = 'sc_' + Date.now().toString(36) + Math.floor(Math.random() * 0xffff).toString(36);
    A().config.patch({ scenes: list.concat([{ id, name, data, createdAt: Date.now() }]), _activeSceneId: id });
    ctx.refresh();
  }

  const SECTIONS = [['milkdrop', 'MilkDrop'], ['shader', 'Shader'], ['scenes', 'Sahneler'], ['media', 'Medya']];
  const page = {
    size: 'screen',
    title: 'Kitaplık',
    actions(slot, ctx) {
      slot.appendChild(h('button', { class: 'btn', onclick: () => { if (window.SVShellSettings) window.SVShellSettings.startImport(ctx); } }, [icon('upload'), 'İçe aktar']));
    },
    render(body, ctx) {
      const seg = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Kitaplık' }, SECTIONS.map(([id, t]) => h('button', {
        class: id === section ? 'on' : '', role: 'tab', 'aria-selected': id === section ? 'true' : 'false', text: t,
        onclick: () => { section = id; query = ''; shown = PAGE_SIZE; ctx.refresh(); },
      })));
      body.appendChild(seg);
      if (window.SVShellSettings) { const st = window.SVShellSettings.importStatus(); if (st) body.appendChild(st); }
      if (section === 'milkdrop') renderMilkdrop(body, ctx);
      else if (section === 'shader') renderShaders(body, ctx);
      else if (section === 'scenes') renderScenes(body, ctx);
      else body.appendChild(h('div', { class: 'empty', text: 'Videolar, resimler, logolar ve şarkı sözleri telefonun kitaplığıyla birlikte gelecek (Faz 4). Masaüstünden aktarılan sahnelerdeki bu dosyalar o zamana kadar eksik görünür.' }));
    },
  };

  S.tab('library', page);
  window.SVShellLibrary = Object.freeze({
    /** Katman ayarlarından: seçilen preset bu katmana gitsin. */
    pickFor(layerId) { target = layerId ? { layerId } : null; section = 'milkdrop'; S.open('library'); },
  });
})();
