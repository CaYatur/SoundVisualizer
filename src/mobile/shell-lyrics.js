/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* KİTAPLIK → SÖZLER (Faz 4). Masaüstündeki Söz Kütüphanesi (src/admin/lyrics-lib-ui.js) ve
   Otomatik Söz Bulma (src/admin/extras-panel.js lyricsLookup) telefonda:

   - Kitaplık: .lrc / .srt / .txt dosyaları telefondan eklenir ya da söz elle yazılır.
     Sanatçı ve parça adı içe aktarılırken etiketlerden ya da dosya adından tahmin edilir;
     söz katmanı çalan parçayı bu adlarla eşleştirir. Düzenle: ad, sanatçı, parça, metin.
   - Otomatik bulma: önce önbellek, sonra kullanıcının eklediği sağlayıcılar (LRCLIB hazır
     şablon, isteğe bağlı). Liste boşken ağa çıkılmaz. Bulunan söz kitaplığa yazılmaz;
     yalnız o parça çalarken listenin sonunda durur (masaüstündeki gibi).

   Kayıtlar uygulamada (store/LyricsLibrary.kt); ayar dosyasına yalnız lyricsLookup girer. */
(function () {
  if (typeof window === 'undefined' || !window.SVShell) return;
  const S = window.SVShell;
  const { h, icon } = S;
  const U = () => window.SVShellUI;
  const A = () => window.SVAndroid;
  const L = () => A() && A().lyrics;
  const cfg = () => (A() && A().config.get()) || {};
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
  const en = () => !!(window.SVI18n && window.SVI18n.locale === 'en');

  let items = null; // { id, name, artist, title, size }
  let status = null; // { text, warn }
  function load(ctx) {
    if (!L()) return;
    L().list().then((list) => { items = Array.isArray(list) ? list : []; if (ctx) ctx.refresh(); }, () => { items = []; if (ctx) ctx.refresh(); });
  }

  function importResult(r) {
    const a = r && Array.isArray(r.added) ? r.added.length : 0;
    const d = (r && r.duplicates) || 0;
    const f = (r && r.failed) || 0;
    const parts = en()
      ? [a + (a === 1 ? ' lyric added' : ' lyrics added')].concat(d ? [d + ' already in the library'] : [], f ? [f + ' could not be read'] : [])
      : [a + ' söz eklendi'].concat(d ? [d + ' zaten kitaplıkta'] : [], f ? [f + ' okunamadı'] : []);
    return { text: parts.join(' · '), warn: !a };
  }
  function doImport(ctx) {
    L().import().then((r) => { status = importResult(r); load(ctx); }, (e) => {
      if (String((e && e.message) || e) === 'cancelled') return;
      status = { text: tr('Sözler eklenemedi.'), warn: true };
      ctx.refresh();
    });
  }

  // ---- Düzenleme sayfası (yeni ya da var olan söz) ----
  function editPage(item) {
    let loaded = !item;
    const v = { name: item ? item.name : '', artist: item ? item.artist : '', title: item ? item.title : '', text: '' };
    return {
      size: 'full',
      title: item ? 'Sözü Düzenle' : 'Söz Ekle',
      render(body, ctx) {
        if (!loaded) {
          L().read(item.id).then((r) => { v.text = (r && r.text) || ''; loaded = true; ctx.refresh(); }, () => { loaded = true; ctx.refresh(); });
          body.appendChild(h('div', { class: 'hint', text: 'Söz okunuyor…' }));
          return;
        }
        const field = (label, key, ph) => U().text({ label, value: v[key] || '', placeholder: ph || '', onInput: (x) => { v[key] = x; } });
        body.appendChild(U().card([
          field('Ad', 'name'),
          field('Sanatçı', 'artist'),
          field('Parça', 'title'),
        ]));
        body.appendChild(h('div', { class: 'hint', text: 'Söz katmanı çalan parçayı sanatçı ve parça adıyla bu söze eşler.' }));
        const area = h('textarea', { class: 'field lyrics-text', 'aria-label': 'Söz', spellcheck: 'false', placeholder: '[00:12.00] İlk satır\n[00:15.50] İkinci satır' });
        area.value = v.text;
        area.addEventListener('input', () => { v.text = area.value; });
        body.appendChild(area);
        body.appendChild(h('div', { class: 'hint', text: 'Zamanlı söz için LRC ([dd:ss.cc] satır) ya da SRT; zamansız düz metin de olur.' }));
        const msg = h('div', { class: 'hint warn-text', hidden: true });
        body.appendChild(msg);
        const fail = (code) => { msg.hidden = false; msg.textContent = tr(code === 'SIZE' ? 'Söz boş ya da 1 MB\'tan büyük.' : code === 'DUPLICATE' ? 'Bu söz zaten kitaplıkta.' : 'Söz kaydedilemedi.'); };
        const btns = [h('button', {
          class: 'btn primary', onclick: () => {
            if (!v.text.trim()) { fail('SIZE'); return; }
            const done = (r) => { if (r && r.ok === false) { fail(r.error); return; } load(null); ctx.pop(); };
            if (item) L().update(item.id, { name: v.name, artist: v.artist, title: v.title, text: v.text }).then(done, () => fail(''));
            else L().add({ name: (v.name || [v.artist, v.title].filter(Boolean).join(' - ') || 'Söz').trim(), artist: v.artist, title: v.title, text: v.text }).then(done, () => fail(''));
          },
        }, [icon('save'), 'Kaydet'])];
        if (item) {
          btns.push(h('button', {
            class: 'btn danger', onclick: () => S.confirm(tr('Bu söz kitaplıktan silinsin mi?'), 'Sil', true).then((ok) => {
              if (!ok) return;
              L().remove(item.id).then(() => { load(null); ctx.pop(); });
            }),
          }, [icon('trash'), 'Sil']));
        }
        body.appendChild(h('div', { class: 'btn-row' }, btns));
      },
    };
  }

  // ---- Otomatik bulma ayarları (cfg.lyricsLookup) ----
  function lookupCfg() {
    const c = cfg();
    const def = window.SV && window.SV.defaultConfig ? window.SV.defaultConfig().lyricsLookup : {};
    const l = Object.assign({}, def, c.lyricsLookup || {});
    l.providers = Array.isArray(l.providers) ? l.providers.map((p) => Object.assign({}, p)) : [];
    return l;
  }
  function setLookup(fn, ctx) {
    const l = lookupCfg();
    fn(l);
    A().config.patch({ lyricsLookup: l });
    if (ctx) ctx.refresh();
  }
  function providerCard(p, i, ctx) {
    const set = (k, val, redraw) => setLookup((l) => { if (l.providers[i]) l.providers[i][k] = val; }, redraw ? ctx : null);
    const kids = [
      U().toggle({ label: p.name || tr('Sağlayıcı'), value: p.enabled !== false, onChange: (on) => set('enabled', on) }),
      U().text({ label: 'Ad', value: p.name || '', onChange: (x) => set('name', x.slice(0, 40), true) }),
      U().text({ label: 'Adres', value: p.url || '', placeholder: 'https://…?artist={artist}&title={title}', onChange: (x) => set('url', x.trim().slice(0, 500)) }),
      U().seg({ label: 'Biçim', options: [['json', 'JSON'], ['lrc', 'Ham LRC']], value: p.format === 'lrc' ? 'lrc' : 'json', onChange: (x) => set('format', x, true) }),
    ];
    if (p.format !== 'lrc') kids.push(U().text({ label: 'JSON yolu', value: p.path || '', placeholder: 'syncedLyrics', onChange: (x) => set('path', x.trim().slice(0, 200)) }));
    kids.push(h('button', { class: 'btn ghost', onclick: () => setLookup((l) => { l.providers.splice(i, 1); }, ctx) }, [icon('x'), 'Kaldır']));
    return U().card(kids);
  }
  function lookupPage() {
    return {
      size: 'full',
      title: 'Sözleri Otomatik Bul',
      render(body, ctx) {
        const l = lookupCfg();
        body.appendChild(U().card([
          U().toggle({ label: 'Sözleri Otomatik Bul', value: l.enabled === true, def: false, onChange: (v) => setLookup((x) => { x.enabled = !!v; }, ctx) }),
          U().toggle({ label: 'Yerel Önbellek', value: l.cache !== false, def: true, onChange: (v) => setLookup((x) => { x.cache = !!v; }) }),
          U().slider({ label: 'Sağlayıcı Zaman Aşımı (ms)', min: 1000, max: 15000, step: 500, value: l.timeoutMs || 4000, def: 4000, onChange: (v) => setLookup((x) => { x.timeoutMs = Math.round(v); }) }),
        ]));
        body.appendChild(h('div', { class: 'section-label', text: 'Sağlayıcılar' }));
        if (!l.providers.length) body.appendChild(h('div', { class: 'hint', text: 'Sağlayıcı yok: hiçbir ağ isteği yapılmaz.' }));
        l.providers.forEach((p, i) => body.appendChild(providerCard(p, i, ctx)));
        body.appendChild(h('div', { class: 'btn-row' }, [
          h('button', {
            class: 'btn', onclick: () => {
              const P = window.SVLyricsProviders;
              if (!P) return;
              setLookup((x) => {
                const r = P.addLrclibPreset(x.providers);
                x.providers = r.providers;
                if (!r.added) status = { text: tr('LRCLIB zaten listede.'), warn: false };
              }, ctx);
            },
          }, [icon('plus'), 'LRCLIB Ekle']),
          h('button', { class: 'btn', onclick: () => setLookup((x) => { x.providers.push({ enabled: true, name: '', url: 'https://example.com/api/get?artist={artist}&title={title}', format: 'json', path: 'syncedLyrics' }); }, ctx) }, [icon('plus'), 'Sağlayıcı Ekle']),
        ]));
        body.appendChild(h('button', { class: 'btn ghost block', onclick: () => L().clearCache().then(() => { status = { text: tr('Söz önbelleği temizlendi.'), warn: false }; ctx.pop(); }) }, [icon('trash'), 'Söz Önbelleğini Temizle']));
        body.appendChild(h('div', { class: 'hint', text: 'Sıra: önbellek → sağlayıcılar (yukarıdan aşağı). Adreste {artist}, {title}, {album} ve {duration} kullanılabilir. Sağlayıcı hatası çalmayı asla durdurmaz; sağlayıcı yoksa ağa çıkılmaz. LRCLIB hazır isteğe bağlı bir şablondur; zorunlu değildir.' }));
        if (!(A().lyrics.follows && A().lyrics.follows())) {
          body.appendChild(h('div', { class: 'banner info' }, [icon('info'), h('div', { class: 'grow-text', text: 'Arama yalnız sahnede çalan parçayı izleyen bir söz katmanı varken yapılır.' })]));
        }
      },
    };
  }

  // ---- Bölüm ----
  function render(body, ctx) {
    if (!L()) { body.appendChild(h('div', { class: 'empty', text: 'Sözler bu sürümde yok.' })); return; }
    if (items === null) load(ctx);
    body.appendChild(h('div', { class: 'btn-row' }, [
      h('button', { class: 'btn primary', onclick: () => doImport(ctx) }, [icon('folder-open'), 'Söz Dosyası Ekle']),
      h('button', { class: 'btn', onclick: () => ctx.push(editPage(null)) }, [icon('pencil'), 'Elle Yaz']),
    ]));
    if (status) body.appendChild(h('div', { class: 'banner' + (status.warn ? '' : ' info ok'), role: 'status' }, [icon(status.warn ? 'warning' : 'check-circle'), h('div', { class: 'grow-text', text: status.text })]));
    const L0 = lookupCfg();
    const auto = A().lyrics.auto ? A().lyrics.auto() : null;
    body.appendChild(h('div', { class: 'card nav-card' }, [h('button', { class: 'ctl-row nav-row', onclick: () => ctx.push(lookupPage()) }, [
      icon('sparkles'),
      h('div', { class: 'row-text' }, [
        h('div', { class: 'row-title small', text: 'Sözleri Otomatik Bul' }),
        h('div', { class: 'row-sub', text: L0.enabled ? (auto ? tr('Bulunan') + ': ' + [auto.artist, auto.title].filter(Boolean).join(' - ') : tr('Açık') + ' · ' + L0.providers.length + ' ' + tr('sağlayıcı')) : tr('Kapalı') }),
      ]),
      icon('chevron-right'),
    ])]));
    if (items === null) { body.appendChild(h('div', { class: 'hint', text: 'Söz okunuyor…' })); return; }
    if (!items.length) {
      body.appendChild(h('div', { class: 'empty', text: 'Kitaplıkta söz yok. Telefondaki .lrc, .srt ya da .txt dosyalarını ekleyin ya da sözü elle yazın.' }));
      return;
    }
    const list = h('div', { class: 'card nav-card' });
    items.forEach((it, i) => {
      if (i) list.appendChild(h('div', { class: 'divider flush' }));
      const sub = [it.artist, it.title].filter(Boolean).join(' - ');
      list.appendChild(h('button', { class: 'ctl-row nav-row', onclick: () => ctx.push(editPage(it)) }, [
        icon('text'),
        h('div', { class: 'row-text' }, [h('div', { class: 'row-title small', text: it.name || it.title || it.id }), sub ? h('div', { class: 'row-sub', text: sub }) : null]),
        icon('chevron-right'),
      ]));
    });
    body.appendChild(list);
  }

  // Kitaplık uygulamada değişince (başka ekrandan) liste yenilenir
  if (window.api && window.api.onLyricsLib) window.api.onLyricsLib(() => { items = null; });

  window.SVShellLyrics = Object.freeze({ render, editPage, lookupPage });
})();
