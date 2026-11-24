/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* UZAK AYAR DEPOSU, SAF PARÇALAR (PC bağlantısı B3, docs/PHONE-LINK.md; PLAN §4.4).

   Hedef "PC" iken telefonun düzenleyicileri aynı `config.get / set / patch` yolunu kullanır;
   ana makine köprüsü (android-host.js) okumayı PC'nin ayar aynasından yapar, yazımı buradaki
   farkla PC'ye yollar. Kurallar:
     - Yalnız DEĞİŞEN üst düzey anahtarlar gider. Telefon PC ayarı üzerinde göç (migrate),
       ensureStack ya da varsayılan doldurma ÇALIŞTIRMAZ: tanımadığı alan PC'de olduğu gibi kalır.
     - Sahne listesi tümüyle gitmez (gerçek ayarda ~330 KB): eklenen, silinen, adı ya da verisi
       değişen sahne ayrı işlem; sıra yalnız liste aynıyken.
     - Sahne çağırma (sahne anahtarları + _activeSceneId) PC'de `scene.apply` olur: PC kendi
       geçişini ve küçük resmini kullanır.
     - Telefonun kendine ait anahtarları (arayüz teması) telefonda kalır; telefonun motoru kendi
       güç ve ses ayarıyla çizer. */
(function (root) {
  const SCENE_KEYS = ['background', 'visualizer', 'layers', 'layerStack', 'layerGroups', 'crossfade',
    'geometry', 'postfx', 'logo', 'images', 'media', 'text', 'modulation', 'transition', 'custom', 'milkdrop', 'feedback'];
  // Telefonda kalan (okuma da yazma da telefonun kendi ayarı)
  const LOCAL_KEYS = ['ui'];
  // Telefonun motoru PC'nin ayarını çizerken bunları telefonun kendisinden alır
  const ENGINE_LOCAL = ['power', 'audio'];

  const json = (v) => { try { return JSON.stringify(v === undefined ? null : v); } catch (e) { return ''; } };
  const pick = (o, keys) => {
    const out = {};
    for (const k of keys) if (o && o[k] !== undefined) out[k] = o[k];
    return out;
  };

  /** Düzenleyicilerin gördüğü ayar: PC'nin aynası + telefonun kendi anahtarları. */
  function view(pc, phone) {
    if (!pc) return phone;
    return Object.assign({}, pc, pick(phone, LOCAL_KEYS));
  }
  /** Telefonun motoruna giden: aynı görünüm, güç ve ses telefonun. */
  function engine(v, phone) {
    if (!v) return v;
    return Object.assign({}, v, pick(phone, ENGINE_LOCAL));
  }
  /** Motora giden yamadan telefonda kalan anahtarlar çıkarılır. */
  function enginePatch(p) {
    const out = {};
    for (const k of Object.keys(p || {})) if (ENGINE_LOCAL.indexOf(k) < 0 && LOCAL_KEYS.indexOf(k) < 0) out[k] = p[k];
    return out;
  }

  /* Sahne listesinin farkı → işlemler. Kimlikler telefonda üretilmiş olabilir; PC yeni
     sahneye kendi kimliğini verir, sonraki ayar olayıyla liste PC'ninkine döner. */
  function diffScenes(a, b) {
    const prev = Array.isArray(a) ? a : [];
    const next = Array.isArray(b) ? b : [];
    const byPrev = new Map(prev.filter((s) => s && s.id).map((s) => [s.id, s]));
    const byNext = new Map(next.filter((s) => s && s.id).map((s) => [s.id, s]));
    const ops = [];
    for (const s of prev) if (s && s.id && !byNext.has(s.id)) ops.push({ op: 'scene.delete', args: { id: s.id } });
    let added = 0;
    for (const s of next) {
      if (!s || !s.id) continue;
      const old = byPrev.get(s.id);
      if (!old) { added++; ops.push({ op: 'scene.create', args: { name: String(s.name || ''), data: s.data || null } }); continue; }
      if (String(old.name || '') !== String(s.name || '') && String(s.name || '').trim()) ops.push({ op: 'scene.rename', args: { id: s.id, name: String(s.name) } });
      if (json(old.data) !== json(s.data) && s.data) ops.push({ op: 'scene.save', args: { id: s.id, data: s.data } });
    }
    // Sıra: yalnız ekleme ve silme yoksa (PC'nin kimlikleriyle tam liste gerekir)
    if (!added && prev.length === next.length) {
      const pa = prev.map((s) => s && s.id).join('|');
      const pb = next.map((s) => s && s.id).join('|');
      if (pa !== pb) ops.push({ op: 'scene.reorder', args: { ids: next.map((s) => s.id) } });
    }
    return ops;
  }

  /* (şimdiki görünüm, düzenleyicinin yazdığı) → { patch, local, ops, apply }.
     patch: PC'ye config.patch; local: telefonda kalan; ops: sahne işlemleri; apply: çağrılan sahne. */
  function diff(cur, next) {
    const out = { patch: {}, local: {}, ops: [], apply: '' };
    if (!next || typeof next !== 'object') return out;
    const c = cur || {};
    for (const k of Object.keys(next)) {
      if (json(c[k]) === json(next[k])) continue;
      if (LOCAL_KEYS.indexOf(k) >= 0) { out.local[k] = next[k]; continue; }
      if (k === 'scenes') { out.ops = out.ops.concat(diffScenes(c.scenes, next.scenes)); continue; }
      out.patch[k] = next[k];
    }
    const id = next._activeSceneId;
    if (Object.prototype.hasOwnProperty.call(out.patch, '_activeSceneId') && typeof id === 'string' && id
      && (c.scenes || []).some((s) => s && s.id === id)) {
      // Sahne çağırma: PC sahneyi kendi uygular
      out.apply = id;
      delete out.patch._activeSceneId;
      const keys = (root && root.SVSchema && root.SVSchema.SCENE_KEYS) || SCENE_KEYS;
      for (const k of keys) delete out.patch[k];
    }
    return out;
  }

  /* PC'den gelen ayar olayı. Sürüm atlanırsa baştan çekilir. `writing`: telefonun son
     yarım saniyede yazdığı anahtarlar (anahtar → zaman); sürüklenen kaydırıcı PC'nin araya
     giren yanıtıyla zıplamasın, bırakınca PC'ninki geçerli olur. */
  function applyEvent(state, ev, now, holdMs) {
    if (!state || !state.cfg || !ev || typeof ev.rev !== 'number') return { refetch: true };
    if (ev.rev <= state.rev) return { stale: true };
    if (ev.rev !== state.rev + 1) return { refetch: true };
    const accepted = {};
    const cfg = Object.assign({}, state.cfg);
    const t = now || Date.now();
    for (const k of Object.keys(ev.patch || {})) {
      const w = state.writing && state.writing[k];
      if (w && t - w < (holdMs || 600)) continue;
      cfg[k] = ev.patch[k];
      accepted[k] = ev.patch[k];
    }
    return { cfg, rev: ev.rev, patch: accepted };
  }

  const api = { SCENE_KEYS, LOCAL_KEYS, ENGINE_LOCAL, view, engine, enginePatch, diff, diffScenes, applyEvent };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SVPcRemote = api;
})(typeof window !== 'undefined' ? window : null);
