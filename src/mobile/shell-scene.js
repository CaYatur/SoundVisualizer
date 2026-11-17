/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* SAHNE AYARLARI VE KULLANICI SAHNELERİ (Faz 3.3).

   Masaüstünde katman seçili değilken denetçi sahnenin kendisini gösteriyor
   (src/admin/scene-shell.js paintInspector): ad, kaydet, renk teması, sahne geçişi,
   ana efektler, sahne ayarlarını sıfırla. Telefonda aynısı Katmanlar sekmesindeki
   sahne satırından açılıyor. Dinamik renk teması masaüstünde de yalnız Windows'ta,
   burada yok.

   Sahne kaydı masaüstüyle aynı biçimde (src/admin/admin.js saveScene/updateScene/
   renameScene): { id: 'sc_…', name, createdAt, data: SCENE_KEYS kopyası }. Ayar her
   zaman KOPYA üzerinde değişip patch ile gönderiliyor. */
(function () {
  if (typeof window === 'undefined' || !window.SVShell) return;
  const S = window.SVShell;
  const { h, icon } = S;
  const U = () => window.SVShellUI;
  const A = () => window.SVAndroid;
  const cfg = () => (A() && A().config.get()) || {};
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
  const en = () => !!(window.SVI18n && window.SVI18n.locale === 'en');
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const defaults = () => (window.SV && window.SV.defaultConfig ? window.SV.defaultConfig() : {});

  // ---- Sahneler ----
  function scenes() { const c = cfg(); return Array.isArray(c.scenes) ? c.scenes : []; }
  function active() { const c = cfg(); return scenes().find((s) => s && s.id === c._activeSceneId) || null; }
  function snapshot() {
    const c = cfg();
    const keys = window.SVSchema ? window.SVSchema.SCENE_KEYS : [];
    const data = {};
    for (const k of keys) if (c[k] !== undefined) data[k] = clone(c[k]);
    return data;
  }
  function nextName() { return (en() ? 'Scene ' : 'Sahne ') + (scenes().length + 1); }
  /** Şu anki görünümü yeni sahne olarak kaydeder; kimliği döner. */
  function saveNew(name) {
    const id = uid('sc_');
    A().config.patch({ scenes: scenes().concat([{ id, name: name || nextName(), createdAt: Date.now(), data: snapshot() }]), _activeSceneId: id });
    return id;
  }
  function update(id) {
    const list = scenes().map((s) => (s && s.id === id ? Object.assign({}, s, { data: snapshot(), updatedAt: Date.now() }) : s));
    A().config.patch({ scenes: list, _activeSceneId: id });
  }
  function rename(id, name) {
    const n = String(name || '').trim();
    if (!n) return;
    A().config.patch({ scenes: scenes().map((s) => (s && s.id === id ? Object.assign({}, s, { name: n }) : s)) });
  }
  function remove(id) {
    const c = cfg();
    const patch = { scenes: scenes().filter((s) => s && s.id !== id) };
    if (c._activeSceneId === id) patch._activeSceneId = null;
    A().config.patch(patch);
  }
  async function askSaveNew() {
    const name = await S.prompt(tr('Sahne adı'), tr(nextName()), tr('Kaydet'));
    if (name) saveNew(name);
    return name;
  }
  async function askRename(sc) {
    if (!sc) return null;
    const name = await S.prompt(tr('Sahne adı'), sc.name || '', tr('Kaydet'));
    if (name) rename(sc.id, name);
    return name;
  }
  function askRemove(sc) {
    if (!sc) return Promise.resolve(false);
    return S.confirm(tr('Sahne silinsin mi?'), 'Sil', true).then((ok) => { if (ok) remove(sc.id); return ok; });
  }

  // ---- Renk teması (background.gradient.colors, 5 nokta) ----
  const lower = (a) => (a || []).map((x) => String(x).toLowerCase()).join(',');
  function colorsNow() {
    const c = cfg();
    const g = c.background && c.background.gradient;
    const cols = (g && Array.isArray(g.colors) && g.colors.length) ? g.colors.slice(0, 5) : (defaults().background.gradient.colors || []).slice(0, 5);
    while (cols.length < 5) cols.push(cols[cols.length - 1] || '#000000');
    return cols;
  }
  function setColors(cols) {
    const c = cfg();
    const bg = clone(c.background || {});
    bg.gradient = Object.assign({}, bg.gradient, { colors: cols.slice() });
    A().config.patch({ background: bg });
  }
  function grad(cols) { return 'linear-gradient(90deg,' + (cols || []).join(',') + ')'; }
  function paletteTile(p, cur, onPick, extra) {
    const on = lower(p.colors) === cur;
    return h('div', { class: 'pal' + (on ? ' on' : '') }, [
      h('button', { class: 'pal-main', 'aria-pressed': on ? 'true' : 'false', 'aria-label': p.name || '', onclick: onPick }, [
        h('span', { class: 'pal-sw', style: 'background:' + grad(p.colors), 'aria-hidden': 'true' }),
        h('span', { class: 'pal-name', text: p.name || '' }),
      ]),
    ].concat(extra || []));
  }
  function colorSection(ctx) {
    const cols = colorsNow();
    const cur = lower(cols);
    const out = [];
    // Beş renk noktası: her biri renk seçicide
    out.push(U().card([h('div', { class: 'ctl-row col' }, [
      h('div', { class: 'ctl-label', text: 'Renkler (5 nokta)' }),
      h('div', { class: 'pal-dots' }, cols.map((col, i) => {
        const r = U().color({ label: tr('Renk') + ' ' + (i + 1), value: col, onInput: (v) => { const n = colorsNow(); n[i] = v; setColors(n); } });
        return r.input;
      })),
    ])]));
    // Hazır temalar (gruplu) ve kullanıcının şablonları
    const groups = [];
    for (const p of (window.SV && window.SV.GRADIENT_PRESETS) || []) {
      if (p.group || !groups.length) groups.push({ name: p.group || '', list: [] });
      groups[groups.length - 1].list.push(p);
    }
    out.push(h('div', { class: 'section-label', text: 'Hazır Şablonlar' }));
    for (const g of groups) {
      if (g.name) out.push(h('div', { class: 'sub-label', text: g.name }));
      out.push(h('div', { class: 'pal-grid' }, g.list.map((p) => paletteTile(p, cur, () => { setColors(p.colors); ctx.refresh(); }))));
    }
    const mine = Array.isArray(cfg().userPresets) ? cfg().userPresets : [];
    out.push(h('div', { class: 'section-label', text: 'Kendi Şablonlarım' }));
    if (mine.length) {
      out.push(h('div', { class: 'pal-grid' }, mine.map((p) => paletteTile(p, cur, () => { setColors(p.colors || []); ctx.refresh(); }, [
        h('button', {
          class: 'pal-x', 'aria-label': 'Sil', title: 'Sil',
          onclick: () => S.confirm(tr('Bu renk şablonu silinecek.'), 'Sil', true).then((ok) => {
            if (!ok) return;
            A().config.patch({ userPresets: (cfg().userPresets || []).filter((x) => x && x.id !== p.id) });
            ctx.refresh();
          }),
        }, [icon('trash')]),
      ]))));
    } else {
      out.push(h('div', { class: 'hint', text: 'Beğendiğiniz arkaplan renklerini kaydedin; tek tıkla geri yükleyin.' }));
    }
    out.push(h('button', {
      class: 'btn block', onclick: async () => {
        const list = Array.isArray(cfg().userPresets) ? cfg().userPresets : [];
        const name = await S.prompt(tr('Şablon adı'), (en() ? 'My preset ' : 'Şablonum ') + (list.length + 1), tr('Kaydet'));
        if (!name) return;
        A().config.patch({ userPresets: list.concat([{ id: uid('up_'), name, colors: colorsNow() }]) });
        ctx.refresh();
      },
    }, [icon('save'), 'Şu anki renkleri şablon olarak kaydet']));
    return out;
  }

  // ---- Sahne geçişi (src/admin/transition-panel.js) ----
  const EASE_LABELS = [['linear', 'Doğrusal'], ['smooth', 'Yumuşak'], ['easeIn', 'Yavaş Başla'], ['easeOut', 'Yavaş Bitir'], ['easeInOut', 'Yavaş Başla ve Bitir'], ['snap', 'Ani']];
  const UNIT_LABELS = [['seconds', 'Saniye'], ['beats', 'Vuruş']];
  const BLACKOUT_OPTS = [['crossfade', 'Sönümleme (Yumuşak Karart)'], ['cut', 'Anında Kes (Animasyonsuz)'], ['dissolve', 'Erime']];
  function transitionSection(ctx) {
    const T = window.SVTransition;
    const t = Object.assign({}, defaults().transition, cfg().transition || {});
    const set = (fn, redraw) => {
      const next = clone(Object.assign({}, defaults().transition, cfg().transition || {}));
      fn(next);
      A().config.patch({ transition: next });
      if (redraw) ctx.refresh();
    };
    const kids = [U().toggle({ label: 'Geçişler Etkin', value: t.enabled !== false, onChange: (v) => set((x) => { x.enabled = v; }, true) })];
    if (t.enabled === false) {
      kids.push(h('div', { class: 'hint', text: 'Geçişler kapalı: sahne değişimleri anında olur.' }));
      return [U().card(kids)];
    }
    if (!T) return [U().card(kids.concat([h('div', { class: 'hint', text: 'Geçiş motoru yüklenemedi.' })]))];
    kids.push(U().select({ label: 'Tür', options: T.TRANSITION_IDS.map((id) => [id, T.TRANSITIONS[id].label]), value: t.type, def: defaults().transition.type, onChange: (v) => set((x) => { x.type = v; }, true) }));
    kids.push(U().select({ label: 'Süre Birimi', options: UNIT_LABELS, value: t.unit || 'seconds', onChange: (v) => set((x) => { x.unit = v; }, true) }));
    if (t.unit === 'beats') {
      kids.push(U().slider({ label: 'Süre', min: 0.25, max: 16, step: 0.25, value: t.duration == null ? 2 : t.duration, def: 2, format: (v) => U().num(v, 2) + (en() ? ' beats' : ' vuruş'), onChange: (v) => set((x) => { x.duration = v; }) }));
    } else {
      kids.push(U().slider({ label: 'Süre', min: 0.05, max: 5, step: 0.05, value: t.duration == null ? 0.7 : t.duration, def: 0.7, format: (v) => U().num(v, 2) + (en() ? ' s' : ' sn'), onChange: (v) => set((x) => { x.duration = v; }) }));
    }
    kids.push(U().select({ label: 'Hız Eğrisi', options: EASE_LABELS, value: t.ease || 'smooth', def: 'smooth', onChange: (v) => set((x) => { x.ease = v; }) }));
    const def = T.TRANSITIONS[t.type];
    for (const p of (def && def.params) || []) {
      const v = t.params && t.params[p.name] != null ? t.params[p.name] : p.default;
      const put = (nv) => set((x) => { x.params = Object.assign({}, x.params, { [p.name]: nv }); });
      if (p.step >= 1 && p.max - p.min <= 1) kids.push(U().toggle({ label: p.label, value: !!v, onChange: (on) => put(on ? 1 : 0) }));
      else kids.push(U().slider({ label: p.label, min: p.min, max: p.max, step: p.step, value: v, def: p.default, onChange: put }));
    }
    kids.push(U().select({ label: 'Karartma Animasyonu', options: BLACKOUT_OPTS, value: t.blackoutType || 'crossfade', onChange: (v) => set((x) => { x.blackoutType = v; }, true) }));
    if ((t.blackoutType || 'crossfade') !== 'cut') {
      kids.push(U().slider({ label: 'Karartma Süresi', min: 0.05, max: 2, step: 0.05, value: t.blackoutDuration == null ? 0.4 : t.blackoutDuration, def: 0.4, format: (v) => U().num(v, 2) + (en() ? ' s' : ' sn'), onChange: (v) => set((x) => { x.blackoutDuration = v; }) }));
    }
    return [U().card(kids), h('div', { class: 'hint', text: 'Geçiş yalnızca sahne değiştiğinde çalışır (mod, arkaplan, preset, palet ya da katman yapısı). Kaydırıcı oynatmak geçiş başlatmaz.' })];
  }

  // ---- Ana efektler (cfg.postfx; katmanınkiyle aynı denetimler) ----
  function fxSection(ctx) {
    const L = window.SVShellLayers;
    if (!L || !L.fxControls) return [];
    const holder = { postfx: Array.isArray(cfg().postfx) ? cfg().postfx : [] };
    const set = (fn) => {
      const x = { postfx: clone(Array.isArray(cfg().postfx) ? cfg().postfx : []) };
      fn(x);
      A().config.patch({ postfx: x.postfx });
    };
    return L.fxControls(holder, set, () => ctx.refresh(), 'Sahnenin ana efekti yok. Buradaki efektler bütün katmanların toplamına uygulanır.');
  }

  // ---- Sıfırla: masaüstündeki "Sahne Ayarlarını Sıfırla"; katmanlar kalır ----
  const RESET_PATHS = [['background', 'gradient', 'colors'], ['transition'], ['postfx'], ['modulation'], ['geometry'], ['feedback']];
  function resetScene(ctx) {
    S.confirm(tr('Renkleri, geçişi, efektleri ve modülasyonu varsayılana döndürür; katmanlar kalır.'), tr('Sıfırla'), true).then((ok) => {
      if (!ok) return;
      const d = defaults();
      const c = cfg();
      const patch = {};
      for (const p of RESET_PATHS) {
        let dv = d;
        for (const k of p) dv = dv == null ? undefined : dv[k];
        if (dv === undefined) continue;
        if (p.length === 1) { patch[p[0]] = clone(dv); continue; }
        const top = patch[p[0]] || clone(c[p[0]] || {});
        let o = top;
        for (let i = 1; i < p.length - 1; i++) { o[p[i]] = Object.assign({}, o[p[i]]); o = o[p[i]]; }
        o[p[p.length - 1]] = clone(dv);
        patch[p[0]] = top;
      }
      A().config.patch(patch);
      ctx.refresh();
    });
  }

  // ---- Sayfa ----
  let tab = 'colors';
  function page() {
    return {
      size: 'full',
      title: 'Sahne ayarları',
      render(body, ctx) {
        const sc = active();
        const cols = colorsNow();
        body.appendChild(h('div', { class: 'card scene-head' }, [
          h('span', { class: 'scene-swatch lg', 'aria-hidden': 'true', style: 'background:linear-gradient(135deg,' + cols.join(',') + ')' }),
          h('div', { class: 'row-text' }, [
            h('div', { class: 'row-title', text: sc ? sc.name : 'Kaydedilmemiş görünüm' }),
            h('div', { class: 'row-sub', text: sc ? 'Kayıtlı sahne' : 'Kaydetmezseniz başka bir sahneye geçince kaybolur.' }),
          ]),
          sc ? h('button', { class: 'iconbtn plain', 'aria-label': 'Yeniden Adlandır', title: 'Yeniden Adlandır', onclick: () => askRename(sc).then((n) => { if (n) ctx.refresh(); }) }, [icon('pencil')]) : null,
        ]));
        const btns = [];
        if (sc) btns.push(h('button', { class: 'btn primary', onclick: () => { update(sc.id); ctx.refresh(); } }, [icon('save'), 'Sahneyi Güncelle']));
        btns.push(h('button', { class: 'btn' + (sc ? '' : ' primary'), onclick: () => askSaveNew().then((n) => { if (n) ctx.refresh(); }) }, [icon('plus'), 'Yeni Sahne Olarak Kaydet']));
        body.appendChild(h('div', { class: 'btn-row' }, btns));
        const pane = h('div', { class: 'edit-pane' });
        const show = (id) => {
          tab = id;
          pane.textContent = '';
          const kids = id === 'transition' ? transitionSection(ctx) : id === 'fx' ? fxSection(ctx) : colorSection(ctx);
          for (const k of kids) pane.appendChild(k);
        };
        body.appendChild(U().tabs([['colors', 'Renk Teması'], ['transition', 'Geçiş'], ['fx', 'Ana Efektler']], tab, show));
        body.appendChild(pane);
        show(tab);
        body.appendChild(h('button', { class: 'btn ghost block', onclick: () => resetScene(ctx) }, [icon('reset'), 'Sahne Ayarlarını Sıfırla']));
      },
    };
  }

  window.SVShellScene = Object.freeze({ page, saveNew, update, rename, remove, askSaveNew, askRename, askRemove, active });
})();
