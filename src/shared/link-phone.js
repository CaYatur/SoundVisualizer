/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TELEFON BAĞLANTISININ ORTAK KARARLARI.

   PC'deki kullanıcının sonradan yüklediği MilkDrop ve Studio presetleri
   telefona gider (yerleşik paket gitmez). Köprü sesi 0–2 kazanır
   (1 = şimdiki düzey). Telefonda açılan parçanın sözü önce PC'nin
   kitaplığından gelir; PC'de yoksa telefonun kendi kitaplığı kalır. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SVLinkPhone = api;
})(typeof window !== 'undefined' ? window : global, function () {
  const MAX_ONE = 512 * 1024;
  const MAX_TOTAL = 6 * 1024 * 1024;
  const MAX_N = 300;

  function clampGain(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 1;
    return Math.max(0, Math.min(2, Math.round(n * 100) / 100));
  }

  /* Int16 örnekleri yerinde yükseltir. 1 ise diziye dokunmaz. */
  function scalePcm16(samples, gain) {
    const g = clampGain(gain);
    if (!samples || g === 1) return samples;
    for (let i = 0; i < samples.length; i++) {
      let v = samples[i] * g;
      if (v > 32767) v = 32767;
      else if (v < -32768) v = -32768;
      samples[i] = v;
    }
    return samples;
  }

  function activePresetIds(cfg) {
    const ids = [];
    const add = (id) => { if (id) ids.push(String(id)); };
    if (!cfg || typeof cfg !== 'object') return ids;
    if (cfg.custom) { add(cfg.custom.visualizerId); add(cfg.custom.backgroundId); }
    if (cfg.milkdrop) add(cfg.milkdrop.presetId);
    const layers = Array.isArray(cfg.layers) ? cfg.layers : [];
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      if (!l) continue;
      add(l.presetId);
      if (l.settings && l.settings.milkdrop) add(l.settings.milkdrop.presetId);
    }
    return ids;
  }

  function bodyOf(p) {
    if (!p) return '';
    if (p.kind === 'milkdrop') return typeof p.source === 'string' ? p.source : '';
    if (p.kind === 'visualizer' || p.kind === 'background') return typeof p.shader === 'string' ? p.shader : '';
    return '';
  }

  /* Kullanıcının deposundaki presetler. Yerleşikler ve gövdesi olmayanlar
     düşer. Açık sahnedekiler kota dolsa da listenin başında kalır. */
  function packUserPresets(list, getById, activeIds) {
    const wanted = new Set((Array.isArray(activeIds) ? activeIds : []).filter(Boolean).map(String));
    const ordered = [];
    const seen = new Set();
    const pushId = (id) => {
      const s = id == null ? '' : String(id);
      if (!s || seen.has(s)) return;
      seen.add(s);
      ordered.push(s);
    };
    wanted.forEach(pushId);
    const rows = Array.isArray(list) ? list : [];
    for (let i = 0; i < rows.length; i++) if (rows[i] && rows[i].id) pushId(rows[i].id);
    const byId = new Map();
    for (let i = 0; i < rows.length; i++) if (rows[i] && rows[i].id) byId.set(String(rows[i].id), rows[i]);
    const out = [];
    let total = 0;
    for (let i = 0; i < ordered.length && out.length < MAX_N; i++) {
      const id = ordered[i];
      let full = byId.get(id) || null;
      const need = !full || (full.kind === 'milkdrop' && typeof full.source !== 'string') ||
        ((full.kind === 'visualizer' || full.kind === 'background') && typeof full.shader !== 'string');
      if (need && typeof getById === 'function') full = getById(id) || full;
      if (!full || full.builtin) continue;
      if (full.kind !== 'milkdrop' && full.kind !== 'visualizer' && full.kind !== 'background') continue;
      const body = bodyOf(full);
      if (!body || body.length > MAX_ONE) continue;
      if (total + body.length > MAX_TOTAL && !wanted.has(id)) continue;
      total += body.length;
      out.push(Object.assign({}, full, { fromPc: true }));
    }
    return out;
  }

  function fold(s) {
    return String(s || '').trim().toLocaleLowerCase('tr');
  }
  function hasText(it) { return !!(it && it.text); }

  /* followPc: telefon PC'nin parçasını izliyor, PC'nin söz listesi çizilir.
     Bağlıyken telefon kendi parçasını PC'ye yolluyorsa ve PC o parça için
     söz bulduysa o liste kazanır. Yoksa telefonun kitaplığı ve otomatik
     bulduğu söz kalır. */
  function lyricChoice(o) {
    const opt = o || {};
    const track = opt.track;
    if (opt.followPc) {
      return { source: 'pc', items: (Array.isArray(opt.pcItems) ? opt.pcItems : []).filter(hasText) };
    }
    const title = track && track.has ? fold(track.title) : '';
    const artist = track ? fold(track.artist) : '';
    const pcTitle = fold(opt.pcTitle);
    const pcArtist = fold(opt.pcArtist);
    const same = !!(opt.connected && opt.audioSend && title && pcTitle === title && (!artist || !pcArtist || artist === pcArtist));
    const pcItems = same ? (Array.isArray(opt.pcItems) ? opt.pcItems : []).filter(hasText) : [];
    if (pcItems.length) return { source: 'pc-library', items: pcItems };
    const items = Array.isArray(opt.phoneItems) ? opt.phoneItems.filter(Boolean) : [];
    if (opt.phoneAuto && opt.phoneAuto.text) items.push(opt.phoneAuto);
    return { source: 'phone', items };
  }

  return { clampGain, scalePcm16, activePresetIds, packUserPresets, lyricChoice, MAX_ONE, MAX_TOTAL, MAX_N };
});
