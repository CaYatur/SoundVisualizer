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
     (kendi preseti). Sahnede MilkDrop katmanı yoksa bir tane eklenir. Telefondaki .milk ve
     .milk2 dosyaları da eklenebilir (kurallar masaüstüyle aynı, store/MilkImport.kt).
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
  let section = 'templates';
  let tplGroup = '';
  let filter = 'all';
  let query = '';
  let shown = PAGE_SIZE;
  let target = null; // { layerId } katman ayarlarından gelindiyse
  let mdImporting = false;
  let mdImport = null; // { ok, r } ya da { ok: false, code }
  let imported = []; // son içe aktarmada eklenenlerin kimlikleri ("Yeni eklenen" süzgeci)

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

  /* ŞABLON VE MİLKDROP ÖNİZLEMELERİ: derlemeden önce çizilip APK'ya konuyor
     (android/tools/previews.js, web/previews/). Dizin bir kez okunuyor; resmi olmayan
     (kullanıcının eklediği) preset desenle kalıyor. */
  let previews = null;
  let previewsAsked = false;
  function loadPreviews() {
    if (previewsAsked) return;
    previewsAsked = true;
    fetch('../../previews/index.json').then((r) => (r.ok ? r.json() : null)).then((j) => {
      previews = j && typeof j === 'object' ? j : { tpl: {}, md: {} };
    }, () => { previews = { tpl: {}, md: {} }; });
  }
  // Sayfa açılırken okunur: Kitaplık ilk açıldığında hazır olsun
  loadPreviews();
  function previewSrc(kind, id) {
    loadPreviews();
    return previews && previews[kind] && previews[kind][id] ? '../../previews/' + kind + '/' + encodeURIComponent(id) + '.webp' : '';
  }
  /* Kutunun resmi: derlemede çizilen (yerleşik); yoksa telefonda çizilir (kullanıcının
     eklediği ya da yedekten gelen preset, src/mobile/preview-live.js), o sırada desen. */
  function presetArt(kind, p) {
    const src = previewSrc(kind, p.id);
    if (src) return h('img', { src, alt: '', loading: 'lazy', decoding: 'async' });
    const fb = art(p.id, p.name);
    return window.SVPreviewLive ? window.SVPreviewLive.art(kind, p, fb) : fb;
  }
  function mdArt(p) { return presetArt('md', p); }

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
        mdArt(p),
        h('div', { class: 'cap' }, [h('span', { text: p.name || p.id })]),
      ]),
      h('button', {
        class: 'star' + (fav ? ' on' : ''), 'aria-label': fav ? 'Favorilerden çıkar' : 'Favorilere ekle', 'aria-pressed': fav ? 'true' : 'false',
        onclick: () => toggleFav(p.id, ctx),
      }, [icon(fav ? 'star-fill' : 'star')]),
    ]);
  }

  /* Telefondaki .milk / .milk2 dosyaları (android-host presets.importMilk). Eklenenler
     "Yeni eklenen" süzgeciyle gösterilir: binlerce presetin arasında kaybolmasınlar. */
  function importMilk(ctx) {
    if (mdImporting || !A().presets) return;
    mdImporting = true;
    mdImport = null;
    ctx.refresh();
    A().presets.importMilk().then((r) => {
      mdImport = { ok: true, r };
      if (r.added) { imported = r.ids || []; filter = 'added'; query = ''; shown = PAGE_SIZE; }
    }, (e) => {
      const c = String((e && e.message) || e);
      mdImport = c === 'cancelled' ? null : { ok: false, code: c };
    }).then(() => { mdImporting = false; ctx.refresh(); });
  }
  function milkStatus() {
    if (mdImporting) return h('div', { class: 'banner info', role: 'status' }, [icon('download'), h('div', { class: 'grow-text', text: 'Presetler okunuyor…' })]);
    if (!mdImport) return null;
    if (!mdImport.ok) return h('div', { class: 'banner', role: 'alert' }, [icon('warning'), h('div', { class: 'grow-text', text: tr('Presetler eklenemedi.') + ' (' + mdImport.code + ')' })]);
    const r = mdImport.r;
    const parts = en()
      ? [r.added + (r.added === 1 ? ' preset added' : ' presets added')]
        .concat(r.duplicates ? [r.duplicates + ' already in the library'] : [], r.invalid ? [r.invalid + ' not a preset'] : [], r.skipped ? [r.skipped + ' skipped'] : [])
      : [r.added + ' preset eklendi']
        .concat(r.duplicates ? [r.duplicates + ' zaten kitaplıkta'] : [], r.invalid ? [r.invalid + ' preset değil'] : [], r.skipped ? [r.skipped + ' atlandı'] : []);
    return h('div', { class: 'banner info' + (r.added ? ' ok' : ''), role: 'status' }, [icon(r.added ? 'check-circle' : 'info'), h('div', { class: 'grow-text', text: parts.join(' · ') })]);
  }

  function renderMilkdrop(body, ctx) {
    const st = milkStatus();
    if (st) body.appendChild(st);
    const all = mdList();
    const favs = all.filter((p) => isFav(p.id));
    const rec = recent();
    const byId = new Map(all.map((p) => [p.id, p]));
    const search = h('input', { type: 'search', placeholder: 'Ad, yazar ya da #etiket', 'aria-label': 'Ad, yazar ya da #etiket', value: query });
    const grid = h('div', { class: 'grid2' });
    const more = h('div');
    const cur = currentId();
    const pick = () => {
      let list = filter === 'fav' ? favs : filter === 'recent' ? rec.map((id) => byId.get(id)).filter(Boolean)
        : filter === 'added' ? imported.map((id) => byId.get(id)).filter(Boolean) : all;
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
    if (filter === 'added' && !imported.length) filter = 'all';
    // Yeni eklenenler başta: kayan satırın sonunda kalınca seçili süzgeç görünmüyordu
    body.appendChild(h('div', { class: 'pills' }, (imported.length ? [pill('added', 'Yeni eklenen', imported.length, 'download')] : [])
      .concat([pill('all', 'Tümü', all.length), pill('fav', 'Favoriler', favs.length, 'star'), pill('recent', 'Son çalınan', null)])));
    if (target && target.layerId) {
      body.appendChild(h('div', { class: 'banner info' }, [icon('layers'), h('div', { class: 'grow-text' }, [
        h('span', { text: 'Seçilen preset yalnız bu katmana gider.' }), ' ',
        h('button', { class: 'link', onclick: () => { target = null; ctx.refresh(); } }, [h('span', { text: 'Ortak preset' })]),
      ])]));
    }
    body.appendChild(grid);
    body.appendChild(more);
    if (A().presets) {
      body.appendChild(h('div', { class: 'md-import' }, [
        h('div', { class: 'hint', text: 'Telefondaki .milk ve .milk2 dosyaları kitaplığa eklenir. Dokular bilgisayardan yedekle gelir.' }),
        h('button', { class: 'btn block', disabled: mdImporting ? true : null, onclick: () => importMilk(ctx) }, [icon('plus'), h('span', { text: '.milk dosyası ekle' })]),
      ]));
    }
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
          presetArt('sh', p),
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

  // ---- Sahneler (kayıt işleri src/mobile/shell-scene.js'te, masaüstünün biçiminde) ----
  function renderScenes(body, ctx) {
    const c = cfg();
    const SC = window.SVShellScene;
    const list = Array.isArray(c.scenes) ? c.scenes : [];
    const act = list.find((x) => x && x.id === c._activeSceneId) || null;
    const btns = [];
    if (act && SC) btns.push(h('button', { class: 'btn primary', onclick: () => { SC.update(act.id); ctx.refresh(); } }, [icon('save'), 'Sahneyi Güncelle']));
    btns.push(h('button', { class: 'btn' + (act ? '' : ' primary'), onclick: () => { if (SC) SC.askSaveNew().then((n) => { if (n) ctx.refresh(); }); } }, [icon('plus'), 'Yeni Sahne Olarak Kaydet']));
    body.appendChild(h('div', { class: 'btn-row' }, btns));
    if (!list.length) { body.appendChild(h('div', { class: 'empty', text: 'Kayıtlı sahne yok.' })); return; }
    body.appendChild(h('div', { class: 'hint', text: 'Dokununca sahne açılır. Ana ekrandaki sahne şeridinden de geçebilirsiniz.' }));
    const grid = h('div', { class: 'grid2' });
    for (const sc of list) {
      if (!sc) continue;
      const on = sc.id === c._activeSceneId;
      grid.appendChild(h('div', { class: 'tile' + (on ? ' sel' : '') }, [
        h('button', { class: 'tile-main', 'aria-pressed': on ? 'true' : 'false', 'aria-label': sc.name || '', onclick: () => { S.recallScene(sc.id); ctx.refresh(); } }, [
          S.sceneArt ? S.sceneArt(sc) : art(sc.id, sc.name),
          h('div', { class: 'cap' }, [h('span', { text: sc.name || '' })]),
        ]),
        h('button', {
          class: 'star', 'aria-label': 'Düzenle', title: 'Düzenle',
          onclick: () => sceneMenu(sc, ctx),
        }, [icon('pencil')]),
      ]));
    }
    body.appendChild(grid);
  }
  /* Sahnenin işleri: yeniden adlandır, şu anki görünümle güncelle, sil. */
  function sceneMenu(sc, ctx) {
    const SC = window.SVShellScene;
    if (!SC || !S.choose) return;
    S.choose(sc.name || '', [['rename', tr('Yeniden Adlandır')], ['update', tr('Mevcut görünümle güncelle')], ['delete', tr('Sil')]], '').then((v) => {
      if (v === 'rename') SC.askRename(sc).then((n) => { if (n) ctx.refresh(); });
      else if (v === 'update') { SC.update(sc.id); ctx.refresh(); }
      else if (v === 'delete') SC.askRemove(sc).then((ok) => { if (ok) ctx.refresh(); });
    });
  }

  // ---- Medya: masaüstü yedeğinden gelen logo ve video kitaplıkları ----
  /* Dokununca sahneye katman olarak eklenir (logo: kitaplık kimliğiyle, masaüstündeki gibi;
     video: telefondaki dosyanın adresiyle). Telefondan yeni video ya da görsel eklemek
     Katmanlar → Ekle → Medya'dan (galeriden seçilir, kopyalanmaz). */
  let mediaLibs = null;
  function loadMedia(ctx) {
    const Lb = A().libraries;
    if (!Lb) { mediaLibs = { logos: [], media: [] }; return; }
    Promise.all([Lb.list('logos').catch(() => []), Lb.list('media').catch(() => [])]).then(([logos, media]) => {
      mediaLibs = { logos: Array.isArray(logos) ? logos : [], media: Array.isArray(media) ? media : [] };
      ctx.refresh();
    });
  }
  function addLayer(made, ctx) {
    const c = cfg();
    A().config.patch({ layers: (Array.isArray(c.layers) ? c.layers : []).concat([made]) });
    if (ctx) ctx.refresh();
  }
  function renderMedia(body, ctx) {
    if (mediaLibs === null) { loadMedia(ctx); body.appendChild(h('div', { class: 'hint', text: 'Kitaplık okunuyor…' })); return; }
    const LF = window.SVLayerFactory;
    if (!mediaLibs.logos.length && !mediaLibs.media.length) {
      body.appendChild(h('div', { class: 'empty', text: 'Masaüstü yedeğinden gelen logo ve videolar burada görünür. Telefondan video ya da görsel eklemek için: Katmanlar → Ekle → Medya.' }));
      return;
    }
    body.appendChild(h('div', { class: 'hint', text: 'Dokununca sahneye katman olarak eklenir.' }));
    if (mediaLibs.logos.length) {
      body.appendChild(h('div', { class: 'section-label', text: 'Logolar' }));
      const grid = h('div', { class: 'grid2' });
      for (const it of mediaLibs.logos) {
        const ph = h('div', { class: 'ph' }, [icon('image')]);
        A().libraries.logo(it.id).then((r) => {
          if (!r || !r.b64) return;
          ph.replaceWith(h('img', { src: 'data:' + (r.mime || 'image/png') + ';base64,' + r.b64, alt: '', decoding: 'async', style: 'object-fit:contain;background:var(--card3)' }));
        }, () => {});
        grid.appendChild(h('div', { class: 'tile' }, [h('button', {
          class: 'tile-main', 'aria-label': it.name || '',
          onclick: () => {
            if (!LF) return;
            const made = LF.makeMedia('logo', {}, window.SV && window.SV.defaultConfig ? window.SV.defaultConfig() : {});
            made.name = it.name || made.name;
            made.settings.logo = Object.assign({}, made.settings.logo, { src: null, libraryId: it.id });
            addLayer(made, ctx);
          },
        }, [ph, h('div', { class: 'cap' }, [h('span', { text: it.name || '' })])])]));
      }
      body.appendChild(grid);
    }
    if (mediaLibs.media.length) {
      body.appendChild(h('div', { class: 'section-label', text: 'Videolar' }));
      const list = h('div', { class: 'card nav-card' });
      mediaLibs.media.forEach((it, i) => {
        if (i) list.appendChild(h('div', { class: 'divider flush' }));
        list.appendChild(h('button', {
          class: 'ctl-row nav-row',
          onclick: () => {
            if (!LF) return;
            const url = 'https://appassets.androidplatform.net/files/lib-media/' + encodeURIComponent(it.file || '');
            const made = LF.makeMedia('video', { url, name: it.name || it.file || '' }, window.SV && window.SV.defaultConfig ? window.SV.defaultConfig() : {});
            made.settings.media.libraryId = it.id || '';
            addLayer(made, ctx);
          },
        }, [icon('video'), h('div', { class: 'row-text' }, [h('div', { class: 'row-title small', text: it.name || it.file || '' })]), icon('plus')]));
      });
      body.appendChild(list);
    }
  }

  // ---- Şablonlar (src/shared/templates.js; masaüstünün hazır sahneleri) ----
  /* Kutunun resmi: şablonun en üstteki görselleştiricisi, yoksa arkaplanı. */
  function tplThumb(t) {
    const L = window.SVShellLayers;
    if (!L) return '';
    const p = t.patch || {};
    const list = Array.isArray(p.layers) ? p.layers : [];
    for (let i = list.length - 1; i >= 0; i--) {
      const l = list[i];
      if (l && l.kind === 'visualizer' && l.type && l.type !== 'text') { const k = L.thumbKey('visualizer', l.type); if (k) return k; }
    }
    if (p.visualizer && p.visualizer.type) { const k = L.thumbKey('visualizer', p.visualizer.type); if (k) return k; }
    for (let i = list.length - 1; i >= 0; i--) {
      const l = list[i];
      if (l && l.kind === 'background' && l.type) { const k = L.thumbKey('background', l.type); if (k) return k; }
    }
    return p.background && p.background.type ? L.thumbKey('background', p.background.type) : '';
  }
  let lastTemplate = '';
  /* Panelin applyTemplate'i (src/admin/template-panel.js): şablon sahne anahtarlarını
     değiştirir, kullanıcının kurulumu (ses, ekran, logo dosyası) korunur. */
  function applyTemplate(t, ctx) {
    const T = window.SVTemplates;
    const SV = window.SV;
    if (!T || !SV) return;
    const next = T.apply(JSON.parse(JSON.stringify(cfg())), t, { defaultConfig: SV.defaultConfig, deepMerge: SV.deepMerge, clone: SV.clone });
    if (next.layerStack && next.layerStack.enabled && window.SVLayers && window.SVLayers.syncStackState) window.SVLayers.syncStackState(next);
    next._activeSceneId = null;
    A().config.set(next);
    lastTemplate = t.id;
    if (ctx) ctx.refresh();
  }
  function renderTemplates(body, ctx) {
    const T = window.SVTemplates;
    if (!T) { body.appendChild(h('div', { class: 'empty', text: 'Sonuç yok.' })); return; }
    const groups = T.groups();
    if (!tplGroup || groups.indexOf(tplGroup) < 0) tplGroup = groups[0];
    body.appendChild(h('div', { class: 'hint', text: 'Bitmiş sahneler; dokununca uygulanır. Beğendiğinizi Sahneler bölümünden kaydedin.' }));
    body.appendChild(h('div', { class: 'pills' }, groups.map((g) => h('button', {
      class: 'pill' + (g === tplGroup ? ' on' : ''), 'aria-pressed': g === tplGroup ? 'true' : 'false', text: g,
      onclick: () => { tplGroup = g; ctx.refresh(); },
    }))));
    const grid = h('div', { class: 'grid2' });
    for (const t of T.TEMPLATES.filter((x) => x.group === tplGroup)) {
      // Şablonun kendi önizlemesi; yoksa en üstteki görselleştiricinin mod resmi
      const shot = previewSrc('tpl', t.id);
      const key = shot ? '' : tplThumb(t);
      const sel = t.id === lastTemplate;
      grid.appendChild(h('div', { class: 'tile' + (sel ? ' sel' : '') }, [
        h('button', { class: 'tile-main', 'aria-pressed': sel ? 'true' : 'false', 'aria-label': t.name, onclick: () => applyTemplate(t, ctx) }, [
          shot || key ? h('img', { src: shot || '../../assets/mode-thumbs/' + key + '.webp', alt: '', loading: 'lazy', decoding: 'async' }) : art(t.id, t.name),
          h('div', { class: 'cap' }, [h('span', { text: t.name })]),
        ]),
      ]));
    }
    body.appendChild(grid);
  }

  const SECTIONS = [['templates', 'Şablonlar'], ['milkdrop', 'MilkDrop'], ['shader', 'Shader'], ['scenes', 'Sahneler'], ['lyrics', 'Sözler'], ['media', 'Medya']];
  /* Taslakta tam ekran sayfaydı; preset ve şablon seçerken sonucu görmek için sahnenin
     üstü açık kalan uzun sayfa (dokununca değişen görüntü hemen izlenir). */
  let libCtx = null;
  function watchPcPresets() {
    if (watchPcPresets.done || !window.api || typeof window.api.onPresetsDelta !== 'function') return;
    watchPcPresets.done = true;
    window.api.onPresetsDelta(() => {
      if (libCtx && (section === 'milkdrop' || section === 'shader')) libCtx.refresh();
    });
  }
  const page = {
    size: 'tall',
    title: 'Kitaplık',
    actions(slot, ctx) {
      slot.appendChild(h('button', { class: 'btn', onclick: () => { if (window.SVShellSettings) window.SVShellSettings.startImport(ctx); } }, [icon('upload'), 'İçe aktar']));
    },
    render(body, ctx) {
      libCtx = ctx;
      watchPcPresets();
      // Beş bölüm dar ekrana parçalı seçimle sığmıyordu ("Templa…"): kayan sekmeler
      body.appendChild(window.SVShellUI.tabs(SECTIONS, section, (id) => { section = id; query = ''; shown = PAGE_SIZE; ctx.refresh(); }));
      if (window.SVShellSettings) { const st = window.SVShellSettings.importStatus(); if (st) body.appendChild(st); }
      if (section === 'templates') renderTemplates(body, ctx);
      else if (section === 'milkdrop') renderMilkdrop(body, ctx);
      else if (section === 'shader') renderShaders(body, ctx);
      else if (section === 'scenes') renderScenes(body, ctx);
      else if (section === 'lyrics' && window.SVShellLyrics) window.SVShellLyrics.render(body, ctx);
      else renderMedia(body, ctx);
    },
  };

  S.tab('library', page);
  window.SVShellLibrary = Object.freeze({
    /** Katman ayarlarından: seçilen preset bu katmana gitsin. */
    pickFor(layerId) { target = layerId ? { layerId } : null; section = 'milkdrop'; S.open('library'); },
    /** Şablonlar bölümüyle aç (boş sahne şeridindeki kutu). */
    templates() { section = 'templates'; S.open('library'); },
    /** Şablonu kimliğiyle uygular (zaman çizelgesinin şablon klipleri). */
    applyTemplate(id) { const T = window.SVTemplates; const t = T && T.TEMPLATES.find((x) => x.id === id); if (t) applyTemplate(t, null); },
    /** Presetin resmi (Katman Ekle → Studio). */
    presetArt: (kind, p) => presetArt(kind, p),
    /** Sözler bölümüyle aç (söz katmanının ayarlarından). */
    lyrics() { section = 'lyrics'; S.open('library'); },
  });
})();
