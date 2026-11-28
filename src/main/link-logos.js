/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Telefona giden logo baytları. Ayar aynası yalnız kitaplık kimliğini taşır;
   telefon yerelde o kimliği bulamazsa `logo.get` ile buradan okur. Kimlik,
   açık gösterinin başvurduğu bir logo değilse bayt gitmez. Dosya burada
   okunmaz: ana süreç `lookup` verir. */

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_LINK_BYTES = 8 * 1024 * 1024;

function addId(set, id) {
  if (typeof id === 'string' && ID_RE.test(id)) set.add(id);
}

function addLogo(set, lg) {
  if (!lg || typeof lg !== 'object') return;
  addId(set, lg.libraryId);
  const items = lg.swap && Array.isArray(lg.swap.items) ? lg.swap.items : null;
  if (!items) return;
  for (let i = 0; i < items.length; i++) addId(set, items[i]);
}

function walkScene(set, scene) {
  if (!scene || typeof scene !== 'object') return;
  addLogo(set, scene.logo);
  const layers = Array.isArray(scene.layers) ? scene.layers : [];
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (!layer || typeof layer !== 'object') continue;
    const settings = layer.settings;
    if (settings && typeof settings === 'object') addLogo(set, settings.logo);
  }
}

function collectLogoIds(cfg) {
  const set = new Set();
  if (!cfg || typeof cfg !== 'object') return set;
  walkScene(set, cfg);
  const scenes = Array.isArray(cfg.scenes) ? cfg.scenes : [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (scene && scene.data) walkScene(set, scene.data);
  }
  const tracks = cfg.timeline && Array.isArray(cfg.timeline.tracks) ? cfg.timeline.tracks : [];
  for (let t = 0; t < tracks.length; t++) {
    const clips = tracks[t] && Array.isArray(tracks[t].clips) ? tracks[t].clips : [];
    for (let c = 0; c < clips.length; c++) {
      const clip = clips[c];
      if (clip && clip.type === 'logo') addId(set, clip.ref);
      if (clip && clip.local && clip.local.data) walkScene(set, clip.local.data);
    }
  }
  return set;
}

/* lookup(id) -> { id, mime, b64, size } ya da null. size üst sınırın
   üstündeyse b64 gerekmez. */
function serveLogo(cfg, id, lookup) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return { error: 'bad-args' };
  if (!collectLogoIds(cfg).has(id)) return { error: 'missing' };
  const rec = typeof lookup === 'function' ? lookup(id) : null;
  if (!rec || typeof rec !== 'object') return { error: 'missing' };
  if (Number(rec.size) > MAX_LINK_BYTES) return { error: 'too-big' };
  if (typeof rec.b64 !== 'string' || !rec.b64) return { error: 'missing' };
  return {
    id: typeof rec.id === 'string' && rec.id ? rec.id : id,
    mime: typeof rec.mime === 'string' ? rec.mime : '',
    b64: rec.b64,
  };
}

module.exports = { ID_RE, MAX_LINK_BYTES, collectLogoIds, serveLogo };
