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
     giren yanıtıyla zıplamasın. O sırada gelen değer ATILMAZ, `deferred`e girer: süre dolunca
     (settle) uygulanır. Eskiden atılıyordu; telefonun yazımından hemen sonra PC'de yapılan
     değişiklik telefona hiç gelmiyordu (emülatörde ölçüldü). */
  function applyEvent(state, ev, now, holdMs) {
    if (!state || !state.cfg || !ev || typeof ev.rev !== 'number') return { refetch: true };
    if (ev.rev <= state.rev) return { stale: true };
    if (ev.rev !== state.rev + 1) return { refetch: true };
    const accepted = {};
    const deferred = {};
    const cfg = Object.assign({}, state.cfg);
    const t = now || Date.now();
    for (const k of Object.keys(ev.patch || {})) {
      const w = state.writing && state.writing[k];
      if (w && t - w < (holdMs || 600)) { deferred[k] = ev.patch[k]; continue; }
      cfg[k] = ev.patch[k];
      accepted[k] = ev.patch[k];
    }
    /* Doğrudan kabul edilen anahtarın bekletilen eski değeri artık geçersiz: yoksa süre dolunca
       eski değer yenisinin üstüne yazılırdı (emülatörde ölçüldü: 0,6 bekletildi, 0,35 kabul
       edildi, ekranda 0,6 kaldı). */
    const superseded = Object.keys(accepted).filter((k) => state.deferred && Object.prototype.hasOwnProperty.call(state.deferred, k));
    return { cfg, rev: ev.rev, patch: accepted, deferred, superseded };
  }
  /* Bekletilen PC değerleri: yazım süresi dolan anahtar PC'nin son değerini alır. */
  function settle(state, now, holdMs) {
    const out = {};
    const cfg = Object.assign({}, state.cfg);
    const t = now || Date.now();
    const left = {};
    for (const k of Object.keys(state.deferred || {})) {
      const w = state.writing && state.writing[k];
      if (w && t - w < (holdMs || 600)) { left[k] = state.deferred[k]; continue; }
      cfg[k] = state.deferred[k];
      out[k] = state.deferred[k];
    }
    return { cfg, patch: out, deferred: left };
  }

  /* PC'NİN VİDEOLARI TELEFONDA (docs/PHONE-LINK.md "Videos"). PC'nin ayarındaki video adresi
     (`sv-media://local/C%3A...`) telefonda açılmaz: telefonun motoru seçimi görür, videoyu
     çizemezdi. Motora giden kopyada her video başvurusu telefonun kendi adresine çevrilir:
     önce PC kitaplık kimliği (`libraryId`), yoksa adresin kendisi. Telefonun karşılığı
     yoksa başvuru `missingMedia` listesine girer; uygulama dosyayı `media.fetch` ile
     indirir. Düzenleyicinin gördüğü ve PC'ye yazılan ayara dokunulmaz. */
  const PHONE_URL = /^(?:https:\/\/appassets\.androidplatform\.net\/|content:\/\/)/i;
  const MEDIA_DEPTH = 40;
  // Video başvurusu: medya ayarının dosyası ya da çizelgedeki video klibinin kaynağı
  function mediaRef(o) {
    if (typeof o.file === 'string' && o.file && (o.source === 'file' || o.fileName !== undefined)) return { key: 'file', ref: o.file };
    if (o.type === 'video' && typeof o.ref === 'string' && o.ref) return { key: 'ref', ref: o.ref };
    return null;
  }
  function walkMedia(v, fn, depth) {
    if (depth > MEDIA_DEPTH || v == null || typeof v !== 'object') return v;
    if (Array.isArray(v)) {
      let out = null;
      v.forEach((x, i) => { const y = walkMedia(x, fn, depth + 1); if (y !== x) { if (!out) out = v.slice(); out[i] = y; } });
      return out || v;
    }
    let out = null;
    for (const k of Object.keys(v)) {
      const y = walkMedia(v[k], fn, depth + 1);
      if (y !== v[k]) { if (!out) out = Object.assign({}, v); out[k] = y; }
    }
    const cur = out || v;
    const m = mediaRef(cur);
    if (!m || PHONE_URL.test(m.ref)) return cur;
    const next = fn(m.ref, typeof cur.libraryId === 'string' ? cur.libraryId : '');
    if (!next || next === m.ref) return cur;
    return Object.assign({}, cur, { [m.key]: next });
  }
  /** Motora giden kopyada PC adresleri telefonun adresine (local: { byId, byRef }). Yerinde değiştirmez. */
  function localizeMedia(v, local) {
    const L = local || {};
    const byId = L.byId || {};
    const byRef = L.byRef || {};
    return walkMedia(v, (ref, id) => (id && byId[id]) || byRef[ref] || '', 0);
  }
  /** Telefonda karşılığı olmayan PC videoları: [{ id, file }] (tekrarsız). */
  function missingMedia(v, local) {
    const L = local || {};
    const byId = L.byId || {};
    const byRef = L.byRef || {};
    const out = [];
    const seen = {};
    walkMedia(v, (ref, id) => {
      if ((id && byId[id]) || byRef[ref]) return '';
      const k = id ? 'id:' + id : 'ref:' + ref;
      if (!seen[k]) { seen[k] = true; out.push(id ? { id, file: ref } : { id: '', file: ref }); }
      return '';
    }, 0);
    return out;
  }

  const api = { SCENE_KEYS, LOCAL_KEYS, ENGINE_LOCAL, view, engine, enginePatch, diff, diffScenes, applyEvent, settle, localizeMedia, missingMedia };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SVPcRemote = api;
})(typeof window !== 'undefined' ? window : null);
