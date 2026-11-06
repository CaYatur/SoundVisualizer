/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Zaman çizelgesi — YALITILMIŞ bileşim (Timeline kullan modu).
 *
 * Eski yol klip uygulamak için canlı yapılandırmayı DEĞİŞTİRİYORDU:
 * Görselleştirici klibi ilk görselleştirici katmanının türünü yazıyor,
 * palet kullanıcının gradyanını eziyordu. Geri sarınca eski hâl dönmüyordu.
 *
 * Burada her etkin görsel klip [başlangıç, bitiş) aralığında KENDİ geçici
 * katmanlarına sahip. Sonuç saf bir işlev: (elle ayar, çizelge, t) → çıkış
 * yapılandırması. Elle ayar, kayıtlı sahne ve şablon hiç değişmez. Canlı
 * çıkış (visualizer), panel önizlemesi ve dışa aktarım aynı işlevi çağırır.
 *
 * Kurallar:
 *  - Etkin görsel klip yoksa (boşluk / bitiş sonrası) çıkış SİYAH.
 *  - Parça sırası: listede üstteki parça önde. Alttan üste birikir.
 *  - Sahne/Şablon: kaynağın tüm katmanları + efektleri yalnız aralığında.
 *    Genel alanlar (efekt zinciri, geometri, geçiş, modülasyon…) en üstteki
 *    sahne/şablon klibinden gelir.
 *  - Görselleştirici/Video/Görsel/Shader: kendi ayrı katmanı.
 *  - Renk şablonu: kalıcı olmayan zamanlı değiştirici; görsel katmanlar
 *    kurulduktan sonra parça sırasıyla uygulanır (üstteki kazanır).
 *  - Eylem: görsel değil; bileşime girmez (kenar tetikleme panelde).
 *  - Klip yerel kopyası (clip.local.data) varsa kaynak yerine o kullanılır.
 */
(function () {
  const LOCAL_SEP = '~';

  function tryReq(p) { try { return require(p); } catch (e) { return null; } }
  function W(name) { return typeof window !== 'undefined' ? window[name] : undefined; }
  function TL() { return W('SVTimeline') || tryReq('./timeline.js'); }
  function SV() { return W('SV') || tryReq('./defaults.js'); }
  function LY() { return W('SVLayers') || tryReq('../visualizer/layers.js'); }
  function TP() { return W('SVTemplates') || tryReq('./templates.js'); }
  function SCH() { return W('SVSchema') || tryReq('./schema.js'); }

  function clone(v) {
    if (v === undefined) return undefined;
    const sv = SV();
    if (sv && typeof sv.clone === 'function') return sv.clone(v);
    return JSON.parse(JSON.stringify(v));
  }
  function sceneKeys() {
    const s = SCH();
    return (s && s.SCENE_KEYS) || ['background', 'visualizer', 'layers', 'layerStack', 'layerGroups', 'crossfade',
      'geometry', 'postfx', 'logo', 'images', 'media', 'text', 'modulation', 'transition', 'custom', 'milkdrop', 'feedback'];
  }
  function defaults() {
    const sv = SV();
    if (!sv) return {};
    if (sv.DEFAULT_CONFIG) return sv.DEFAULT_CONFIG;
    if (typeof sv.defaultConfig === 'function') return sv.defaultConfig();
    return {};
  }
  function normLayer(l) {
    const ly = LY();
    return ly && ly.normalizeLayer ? ly.normalizeLayer(l) : Object.assign({ enabled: true, opacity: 1, settings: {} }, l);
  }

  const VISUAL_TYPES = { scene: 1, preset: 1, visualizer: 1, video: 1, image: 1, shader: 1 };
  function isVisual(c) { return !!c && !!VISUAL_TYPES[c.type]; }

  /* Sahne anahtarlarının siyah tabanı: varsayılanlar, yığın açık, katman yok. */
  function blackScene() {
    const def = defaults();
    const out = {};
    for (const k of sceneKeys()) if (def[k] !== undefined) out[k] = clone(def[k]);
    out.layers = [];
    out.layerStack = Object.assign({}, out.layerStack, { enabled: true });
    delete out.layerStack.classicBackup;
    delete out.layerStack.archivedLayers;
    out.postfx = [];
    out.layerGroups = Array.isArray(out.layerGroups) ? [] : out.layerGroups;
    if (out.background) out.background = Object.assign({}, out.background, { type: 'solid', solidColor: '#000000' });
    if (out.visualizer) out.visualizer = Object.assign({}, out.visualizer, { type: 'none' });
    for (const k of ['images', 'media', 'logo', 'text']) if (out[k] && typeof out[k] === 'object') out[k] = Object.assign({}, out[k], { enabled: false });
    return out;
  }

  /* Klibin kaynak sahne verisi (SCENE_KEYS görünümü). Yerel kopya önce. */
  function sourceData(cfg, clip) {
    if (!clip) return null;
    if (clip.local && clip.local.data && typeof clip.local.data === 'object') return materializeData(clip.local.data);
    if (clip.type === 'scene') {
      const sc = (Array.isArray(cfg.scenes) ? cfg.scenes : []).find((x) => x && x.id === clip.ref);
      return sc && sc.data ? materializeData(sc.data) : null;
    }
    if (clip.type === 'preset') {
      const T = TP();
      const sv = SV();
      if (!T || !sv) return null;
      const tpl = (T.TEMPLATES || []).find((x) => x && x.id === clip.ref);
      if (!tpl) return null;
      const base = {};
      for (const k of Object.keys(cfg)) if (k !== 'scenes' && k !== 'timeline') base[k] = cfg[k];
      const next = T.apply(base, tpl, {
        defaultConfig: sv.defaultConfig || (() => clone(defaults())),
        deepMerge: sv.deepMerge, clone: clone,
      });
      const out = {};
      for (const k of sceneKeys()) if (next[k] !== undefined) out[k] = clone(next[k]);
      return out;
    }
    return null;
  }
  function materializeData(data) {
    const def = defaults();
    const out = {};
    for (const k of sceneKeys()) {
      const v = data[k] !== undefined ? data[k] : def[k];
      if (v !== undefined) out[k] = clone(v);
    }
    return out;
  }

  /* Sahne verisinin katman listesi: yığın açıksa katmanlar, değilse klasik
     alanlardan sentez (renderer ile aynı kural). */
  function layersOf(data) {
    if (!data) return [];
    const stackOn = data.layerStack && data.layerStack.enabled === true;
    if ((stackOn || (Array.isArray(data.layers) && data.layers.length)) && Array.isArray(data.layers)) return data.layers.slice();
    const ly = LY();
    if (ly && ly.synthesize) return ly.synthesize(clone(data));
    return [];
  }

  /* Katman kimliği klip örneğine özgü: aynı kaynaktan iki klip çakışmasın. */
  function instId(clip, id) { return 'tl' + LOCAL_SEP + clip.id + LOCAL_SEP + String(id || 'ly'); }

  function emitLayers(clip, layers, op) {
    const map = {};
    for (const l of layers) if (l && l.id) map[l.id] = instId(clip, l.id);
    const out = [];
    for (const l of layers) {
      if (!l) continue;
      const c = normLayer(clone(l));
      c.id = instId(clip, l.id);
      if (c.mask && c.mask.from && map[c.mask.from]) c.mask = Object.assign({}, c.mask, { from: map[c.mask.from] });
      c.opacity = (c.opacity == null ? 1 : c.opacity) * op;
      c.tlClip = clip.id;
      out.push(c);
    }
    return out;
  }

  function mediaLayer(clip) {
    const base = { id: 'media', name: clip.name || clip.ref, enabled: true };
    if (clip.type === 'visualizer') return Object.assign(base, { kind: 'visualizer', type: clip.ref });
    if (clip.type === 'shader') return Object.assign(base, { kind: 'visualizer', type: 'custom', presetId: clip.ref });
    if (clip.type === 'video') return Object.assign(base, { kind: 'media', settings: { media: { enabled: true, source: 'file', file: clip.ref, fit: 'cover', loop: true } } });
    if (clip.type === 'image') return Object.assign(base, { kind: 'media', settings: { media: { enabled: true, source: 'file', file: clip.ref, fit: 'cover' } } });
    return null;
  }

  function paletteColors(cfg, ref) {
    const sv = SV();
    const list = ((sv && sv.GRADIENT_PRESETS) || []).concat(cfg.userPresets || []);
    const hit = list.find((g) => g && g.name === ref);
    return hit && Array.isArray(hit.colors) ? hit.colors.slice() : null;
  }

  function applyPalette(scene, colors) {
    scene.background = Object.assign({}, scene.background);
    scene.background.gradient = Object.assign({}, scene.background.gradient, { colors: colors.slice() });
    for (const l of scene.layers) {
      if (l && l.kind === 'background') {
        l.settings = Object.assign({}, l.settings);
        const bg = Object.assign({}, l.settings.background || {});
        bg.gradient = Object.assign({}, bg.gradient, { colors: colors.slice() });
        l.settings.background = bg;
      }
    }
  }

  /* Etkin girdiler, ALTTAN ÜSTE (çizim sırası). Parça listesinde üstteki önde. */
  function entriesBottomUp(tl, t) {
    const T = TL();
    const act = T.activeClipsAt(tl, t);
    const order = new Map(tl.tracks.map((trk, i) => [trk.id, i]));
    return act.slice().sort((a, b) => order.get(b.track.id) - order.get(a.track.id));
  }

  /* Ana işlev. tl: makeTimeline çıktısı. Döner: { cfg, active, black }. */
  function composeAt(cfg, tl, t, opts) {
    const T = TL();
    const o = opts || {};
    const tt = Math.max(0, Number(t) || 0);
    /* Döngü varsa sarılır. Döngü YOKSA son kareye tutunulmaz (evalPlayhead
       bunu yapıyor): içerik bitince çıkış siyah. */
    const wt = tl && tl.loop && tl.loop.enabled && T.evalPlayhead ? T.evalPlayhead(tl, tt) : tt;
    const out = {};
    for (const k of Object.keys(cfg || {})) out[k] = cfg[k];
    const scene = blackScene();
    const entries = entriesBottomUp(tl, wt);
    let top = null; // en üstteki sahne/şablon verisi
    const palettes = [];
    const ids = [];
    for (const e of entries) {
      const c = e.clip;
      if (!c || !c.ref && !(c.local && c.local.data)) continue;
      if (c.type === 'palette') { palettes.push(c); continue; }
      if (!isVisual(c)) continue;
      const op = T.entryOpacity(tl, e.track, c, wt);
      if (c.type === 'scene' || c.type === 'preset') {
        const data = sourceData(cfg, c);
        if (!data) continue; // kaynak yok: katkı yok (siyah kalabilir)
        top = data;
        scene.layers = scene.layers.concat(emitLayers(c, layersOf(data), op));
        ids.push(c.id);
      } else {
        const ml = c.local && c.local.data ? layersOf(materializeData(c.local.data)) : [mediaLayer(c)];
        scene.layers = scene.layers.concat(emitLayers(c, ml.filter(Boolean), op));
        ids.push(c.id);
      }
    }
    if (top) {
      for (const k of sceneKeys()) {
        if (k === 'layers' || k === 'layerStack') continue;
        if (top[k] !== undefined) scene[k] = clone(top[k]);
      }
      /* Klasik alanlar artık katman olarak bileşimde; renderer onları
         ikinci kez çizmesin. */
      for (const k of ['images', 'media', 'logo', 'text']) if (scene[k] && typeof scene[k] === 'object') scene[k] = Object.assign({}, scene[k], { enabled: false });
    }
    if (scene.layers.length) for (const p of palettes) {
      const cols = paletteColors(cfg, p.ref);
      if (cols) applyPalette(scene, cols);
    }
    for (const k of Object.keys(scene)) out[k] = scene[k];
    let res = out;
    if (o.automation !== false && T.applyAutomation) res = T.applyAutomation(out, tl, wt).cfg;
    return { cfg: res, t: wt, active: ids, black: !scene.layers.length };
  }

  /* Klip yerel kopyası — Sahne paneli bu klibi düzenlerken. Kaynak bir kez
     kopyalanır; sonraki düzenlemeler yalnız bu kopyaya gider. */
  function ensureLocal(cfg, clip) {
    if (!clip) return null;
    if (clip.local && clip.local.data) return clip.local;
    let data = null;
    if (clip.type === 'scene') {
      // Ham sahne verisi: varsayılanlarla şişirilmez, bileşimde tamamlanır
      const sc = (Array.isArray(cfg.scenes) ? cfg.scenes : []).find((x) => x && x.id === clip.ref);
      data = sc && sc.data ? clone(sc.data) : null;
    } else if (clip.type === 'preset') data = sourceData(cfg, clip);
    else {
      const ml = mediaLayer(clip);
      if (!ml) return null;
      data = { layers: [normLayer(ml)], layerStack: { enabled: true } };
    }
    if (!data) return null;
    data.layerStack = Object.assign({}, data.layerStack, { enabled: true });
    data.layers = layersOf(data).map((l) => normLayer(clone(l)));
    clip.local = { from: { type: clip.type, ref: clip.ref }, data };
    return clip.local;
  }

  /* Klip çoğaltılınca yerel kopya derin kopyalanır, katman kimlikleri
     yenilenir: iki örnek birbirini etkilemez. */
  function cloneLocalFor(clip) {
    if (!clip || !clip.local) return;
    clip.local = clone(clip.local);
    const ly = LY();
    const layers = clip.local.data && Array.isArray(clip.local.data.layers) ? clip.local.data.layers : [];
    const map = {};
    for (const l of layers) {
      const nid = ly && ly.newLayerId ? ly.newLayerId() : 'ly_' + Math.random().toString(36).slice(2);
      map[l.id] = nid;
      l.id = nid;
    }
    for (const l of layers) if (l.mask && map[l.mask.from]) l.mask.from = map[l.mask.from];
  }

  /* Tür/kaynak değişince yerel kopya artık başka kaynağa ait: düşer. */
  function dropStaleLocal(clip) {
    if (!clip || !clip.local || !clip.local.from) return false;
    if (clip.local.from.type === clip.type && clip.local.from.ref === clip.ref) return false;
    delete clip.local;
    return true;
  }

  /* Bir anda bir klibin çıkışa katkı verip vermediği (seçim ≠ çıkış). */
  function clipActiveAt(tl, clipId, t) {
    const T = TL();
    return T.activeClipsAt(tl, t).some((e) => e.clip.id === clipId);
  }

  const api = { composeAt, ensureLocal, cloneLocalFor, dropStaleLocal, clipActiveAt, blackScene, instId, isVisual };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVTimelineCompose = api;
})();
