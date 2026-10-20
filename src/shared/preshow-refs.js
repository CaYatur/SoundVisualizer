/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* SAHNENİN BAŞVURDUĞU DOSYALAR (#545): kullanıcı presetleri, logo kitaplığı
   öğeleri ve video dosyaları — HER BİRİ NEREDE geçtiğiyle.

   Gösteri öncesi denetim yalnız kimlik listesi veriyordu ("usr_vis_… eksik");
   hangi sahnede, hangi katmanda olduğu ve ne yapılacağı yazmıyordu. Burada
   toplama (`collect`) ile değiştirme (`replace`) AYNI alanları gezer: panelin
   "nerede" dediği yer, düzeltmenin dokunduğu yerle hep aynı.

   Alanlar (çizicinin okuduğu yerler, layers.js):
     preset — custom.visualizerId, custom.backgroundId, layers[i].presetId
              (yalnız usr_: yerleşikler koddan gelir)
     logo   — logo.libraryId, logo.swap.items[k]; katmanın settings.logo'su
     video  — media.file (katman yığını kapalıyken, media.enabled);
              yığında kind 'media' katmanın settings.media.file'ı
   Kapsam: canlı sahne (scene: null) ve kayıtlı sahneler (scene: { index, name }). */
(function () {
  function stackOn(c) {
    const s = c && c.layerStack;
    if (s && typeof s.enabled === 'boolean') return s.enabled;
    return !!(c && Array.isArray(c.layers) && c.layers.length);
  }
  const isUserPreset = (x) => typeof x === 'string' && /^usr_/.test(x);
  const isStr = (x) => typeof x === 'string' && x !== '';
  /* Video yuvası medya panelinin yazdığı gibi yazılır (media-panel.js):
     file = adres, fileName = ad, libraryId boş (kitaplık öğesi değil). */
  function setMedia(m, v) {
    m.file = v || '';
    let name = '';
    try { name = v ? decodeURIComponent(String(v).split(/[\\/]/).pop().split('?')[0]) : ''; } catch { name = ''; }
    m.fileName = name;
    m.libraryId = '';
  }

  /* Bir sahnenin (canlı ya da kayıtlı) bütün başvuru yuvaları. Her yuva
     okunabilir (`get`) ve yazılabilir (`set`, null = başvuruyu kaldır). */
  function slots(c) {
    const out = [];
    if (!c || typeof c !== 'object') return out;
    const cu = c.custom;
    if (cu && typeof cu === 'object') {
      for (const f of ['visualizerId', 'backgroundId']) {
        if (isUserPreset(cu[f])) out.push({ kind: 'preset', id: cu[f], layer: null, field: 'custom.' + f, set: (v) => { cu[f] = v; } });
      }
    }
    const logoSlots = (lg, layer, base) => {
      if (!lg || typeof lg !== 'object') return;
      if (isStr(lg.libraryId)) out.push({ kind: 'logo', id: lg.libraryId, layer, field: base + '.libraryId', set: (v) => { lg.libraryId = v; } });
      const items = lg.swap && Array.isArray(lg.swap.items) ? lg.swap.items : null;
      if (items) {
        items.forEach((x, k) => {
          if (isStr(x)) out.push({ kind: 'logo', id: x, layer, field: base + '.swap', set: (v) => { items[k] = v; } });
        });
      }
    };
    logoSlots(c.logo, null, 'logo');
    const on = stackOn(c);
    if (!on && c.media && c.media.enabled && c.media.source === 'file' && isStr(c.media.file)) {
      const m = c.media;
      out.push({ kind: 'media', id: m.file, layer: null, field: 'media.file', set: (v) => setMedia(m, v) });
    }
    (Array.isArray(c.layers) ? c.layers : []).forEach((l, i) => {
      if (!l || typeof l !== 'object') return;
      const layer = { index: i, name: typeof l.name === 'string' ? l.name : '', kind: l.kind || '' };
      if (isUserPreset(l.presetId)) out.push({ kind: 'preset', id: l.presetId, layer, field: 'presetId', set: (v) => { l.presetId = v; } });
      const st = l.settings && typeof l.settings === 'object' ? l.settings : null;
      if (st) logoSlots(st.logo, layer, 'settings.logo');
      /* Video: yalnız çizilen katman — export-media.mediaFiles ile aynı
         koşul (kapalı ya da susturulmuş katmanın dosyası yokken sorun yok). */
      if (on && l.kind === 'media' && l.enabled !== false && !l.muted) {
        const own = st && st.media && typeof st.media === 'object' ? st.media : null;
        const merged = Object.assign({}, c.media || {}, own || {});
        if (merged.source === 'file' && isStr(merged.file)) {
          out.push({
            kind: 'media', id: merged.file, layer, field: own && isStr(own.file) ? 'settings.media.file' : 'media.file',
            set: (v) => {
              if (own && isStr(own.file)) setMedia(own, v);
              else if (c.media) setMedia(c.media, v);
            },
          });
        }
      }
    });
    return out;
  }

  function scopes(cfg) {
    const out = [{ scene: null, data: cfg }];
    (cfg && Array.isArray(cfg.scenes) ? cfg.scenes : []).forEach((sc, i) => {
      if (sc && sc.data) out.push({ scene: { index: i, name: typeof sc.name === 'string' ? sc.name : '' }, data: sc.data });
    });
    return out;
  }

  /* Başvurular, öğe başına bir kayıt:
     [{ kind, id, where: [{ scene, layer, field }] }]
     Sıra: önce canlı sahnede geçenler, sonra kayıtlı sahnelerdekiler. */
  function collect(cfg) {
    const map = new Map();
    for (const sc of scopes(cfg)) {
      for (const s of slots(sc.data)) {
        const key = s.kind + '\u0000' + s.id;
        let r = map.get(key);
        if (!r) { r = { kind: s.kind, id: s.id, where: [] }; map.set(key, r); }
        r.where.push({ scene: sc.scene, layer: s.layer, field: s.field });
      }
    }
    return Array.from(map.values());
  }

  const live = (ref) => ref.where.some((w) => !w.scene);

  /* Başvuruyu her yerde değiştir; `to` null ise kaldır (logo değişim
     listesinden de çıkar). Dönen: değişen yuva sayısı. Yerinde yazar. */
  function replace(cfg, kind, from, to) {
    let n = 0;
    for (const sc of scopes(cfg)) {
      for (const s of slots(sc.data)) {
        if (s.kind !== kind || s.id !== from) continue;
        s.set(to == null ? null : to);
        n++;
      }
      // Kaldırılan logo değişim listesinde boşluk bırakmasın
      if (kind === 'logo' && to == null) {
        const clean = (lg) => { if (lg && lg.swap && Array.isArray(lg.swap.items)) lg.swap.items = lg.swap.items.filter((x) => x != null); };
        clean(sc.data && sc.data.logo);
        (sc.data && Array.isArray(sc.data.layers) ? sc.data.layers : []).forEach((l) => clean(l && l.settings && l.settings.logo));
      }
    }
    return n;
  }

  const api = { collect, replace, live, stackOn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVPreshowRefs = api;
})();
