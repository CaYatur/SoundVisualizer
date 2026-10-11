/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Sabit OSC giriş ağacı (#734).

   Çıkışın kullandığı önek ve adresler. Masa, öğrenme moduna gerek kalmadan
   aynı yolu yazar. Öğrenme modu bu ağacın tutmadığı adreslerde durur.

   Değerler kaydırıcının kendi aralığındadır (0..1'e sıkıştırılmaz). Aralık
   OSCQuery RANGE ile aynıdır. Bir paket içindeki adımlar, paket sırasıyla
   uygulanmak üzere döner; bu modül yapılandırmayı kendisi yazmaz.

   Zaman etiketi: anlık (NTP 1) ve geçmiş etiket hemen. Gelecek etiket en
   çok 2 saniye bekler. Daha uzağı da hemen uygulanır; masa saat sapması
   gösteriyi askıda bırakmasın. */
(function () {

const DEFAULT_PREFIX = '/cayadev';
const MAX_WAIT_MS = 2000;
const NTP_UNIX = 2208988800;

/* Aralıklar panel kaydırıcılarıyla aynı (control.js TARGETS). */
const SLIDERS = [
  { path: 'audio.sensitivity', min: 0.2, max: 4 },
  { path: 'audio.smoothing', min: 0, max: 0.95 },
  { path: 'audio.bassBoost', min: 1, max: 4 },
  { path: 'visualizer.sensitivity', min: 0.3, max: 3 },
  { path: 'visualizer.glow', min: 0, max: 1 },
  { path: 'visualizer.barCount', min: 16, max: 160, int: true },
  { path: 'visualizer.gap', min: 0, max: 0.8 },
  { path: 'visualizer.lineWidth', min: 1, max: 12 },
  { path: 'visualizer.thickness', min: 0.1, max: 1 },
  { path: 'visualizer.trailHeight', min: 0.4, max: 3 },
  { path: 'background.gradient.speed', min: 0, max: 2 },
  { path: 'background.gradient.audioReactivity', min: 0, max: 2 },
  { path: 'background.gradient.brightness', min: 0.4, max: 1.6 },
  { path: 'background.gradient.audioHue', min: 0, max: 1 },
  { path: 'background.gradient.vignette', min: 0, max: 1 },
  { path: 'logo.opacity', min: 0, max: 1 },
  { path: 'logo.scale', min: 0.05, max: 0.6 },
  { path: 'feedback.zoom', min: 0.94, max: 1.08 },
  { path: 'feedback.decay', min: 0.7, max: 0.999 },
  { path: 'feedback.warp', min: 0, max: 2 },
  { path: 'feedback.rotate', min: -1, max: 1 },
  { path: 'media.opacity', min: 0, max: 1 },
  { path: 'media.kaleido', min: 0, max: 12, int: true },
  { path: 'milkdrop.blendTime', min: 0, max: 5 },
  { path: 'milkdrop.autoNext', min: 0, max: 120, int: true },
  { path: 'milkdrop.autoNextRand', min: 0, max: 30, int: true },
  { path: 'milkdrop.hardCutThreshold', min: 1, max: 6 },
  { path: 'milkdrop.mesh', steps: [24, 32, 48, 64, 96, 128] },
  { path: 'milkdrop.renderScale', steps: [0.75, 1, 1.5, 2] },
];

const PALETTES = ['theme', 'solid', 'rainbow'];
const PREFIX_RE = /^(\/[A-Za-z0-9_-]{1,32}){1,4}$/;

function catalogs() {
  try {
    const mode = (typeof window !== 'undefined' && window.SVModeCatalog)
      ? window.SVModeCatalog
      : require('./mode-catalog.js');
    const tr = (typeof window !== 'undefined' && window.SVTransition)
      ? window.SVTransition
      : require('./transition.js');
    return {
      visualizer: mode.ids('visualizer'),
      background: mode.ids('background'),
      transition: tr.TRANSITION_IDS.slice(),
    };
  } catch {
    return null;
  }
}

function prefixOf(cfg) {
  const osc = cfg && cfg.control && cfg.control.osc;
  const raw = (osc && typeof osc.prefix === 'string' && osc.prefix)
    || (cfg && cfg.oscOut && typeof cfg.oscOut.prefix === 'string' && cfg.oscOut.prefix)
    || DEFAULT_PREFIX;
  const p = String(raw).replace(/\/+$/, '');
  return PREFIX_RE.test(p) ? p : DEFAULT_PREFIX;
}

function normalizeSettings(osc) {
  const o = osc && typeof osc === 'object' ? osc : {};
  let port = o.port | 0;
  if (port < 1 || port > 65535) port = 9000;
  let queryPort = o.queryPort | 0;
  if (queryPort < 1 || queryPort > 65535) queryPort = 9010;
  const prefix = prefixOf({ control: { osc: { prefix: o.prefix } }, oscOut: {} });
  return {
    enabled: o.enabled === true,
    port,
    queryPort,
    prefix,
    mappings: Array.isArray(o.mappings) ? o.mappings : [],
  };
}

function partsOf(address, prefix) {
  if (typeof address !== 'string' || address.length > 256) return null;
  const pre = prefix || DEFAULT_PREFIX;
  if (address === pre) return [];
  if (!address.startsWith(pre + '/')) return null;
  const rest = address.slice(pre.length + 1);
  if (!rest || rest.includes('//')) return null;
  return rest.split('/');
}

function finite(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function snapSteps(n, steps) {
  let best = steps[0];
  let dist = Math.abs(n - best);
  for (let i = 1; i < steps.length; i++) {
    const d = Math.abs(n - steps[i]);
    if (d < dist) { best = steps[i]; dist = d; }
  }
  return best;
}

function sliderValue(slider, arg) {
  const n = finite(arg);
  if (n == null) return null;
  if (Array.isArray(slider.steps) && slider.steps.length) return snapSteps(n, slider.steps);
  let v = clamp(n, slider.min, slider.max);
  if (slider.int) v = Math.round(v);
  return v;
}

function asBool(arg) {
  if (typeof arg === 'boolean') return arg;
  if (arg === 'T') return true;
  if (arg === 'F') return false;
  const n = finite(arg);
  if (n == null) return null;
  return n >= 0.5;
}

function asInt(arg) {
  const n = finite(arg);
  if (n == null) return null;
  return Math.round(n);
}

function asString(arg) {
  if (typeof arg !== 'string') return null;
  const s = arg.trim();
  if (!s || s.length > 200) return null;
  return s;
}

function knownId(kind, id, opt) {
  if (opt && Array.isArray(opt[kind])) return opt[kind].indexOf(id) >= 0;
  const c = catalogs();
  if (!c || !c[kind]) return false;
  return c[kind].indexOf(id) >= 0;
}

function getPath(obj, path) {
  let o = obj;
  for (const k of path.split('.')) {
    if (o == null) return undefined;
    o = o[k];
  }
  return o;
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
}

/* Bir OSC paketi. cfg yazılmaz. steps paket sırasını korur. */
function plan(messages, cfg, opt) {
  const prefix = prefixOf(cfg);
  const steps = [];
  const consumed = [];
  const list = Array.isArray(messages) ? messages : [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (!m || typeof m.address !== 'string') continue;
    const parts = partsOf(m.address, prefix);
    if (!parts || !parts.length) continue;
    const step = match(parts, Array.isArray(m.args) ? m.args : [], cfg, opt || {});
    if (!step) continue;
    consumed.push(i);
    steps.push(step);
  }
  return { steps, consumed };
}

function match(parts, args, cfg, opt) {
  const key = parts.join('/');
  if (key === 'show/blackout') {
    const v = asBool(args[0]);
    if (v == null) return null;
    return { kind: 'op', op: 'blackout', value: v };
  }
  if (key === 'show/palette') {
    const s = asString(args[0]);
    if (!s || PALETTES.indexOf(s) < 0) return null;
    return { kind: 'set', path: 'background.colorMode', value: s };
  }
  if (key === 'show/brightness') {
    const slider = SLIDERS.find((x) => x.path === 'background.gradient.brightness');
    const v = sliderValue(slider, args[0]);
    if (v == null) return null;
    return { kind: 'set', path: slider.path, value: v };
  }
  if (key === 'show/transition') {
    const s = asString(args[0]);
    if (!s || !knownId('transition', s, opt)) return null;
    return { kind: 'set', path: 'transition.type', value: s };
  }
  if (key === 'show/autovj') {
    const v = asBool(args[0]);
    if (v == null) return null;
    return { kind: 'set', path: 'autovj.enabled', value: v };
  }
  if (key === 'crossfade') {
    const n = finite(args[0]);
    if (n == null) return null;
    return { kind: 'set', path: 'crossfade.value', value: clamp(n, 0, 1) };
  }
  if (key === 'scene') {
    const s = asString(args[0]);
    if (!s) return null;
    return { kind: 'op', op: 'scene', name: s };
  }
  if (key === 'visualizer' && parts.length === 1) {
    const s = asString(args[0]);
    if (!s || !knownId('visualizer', s, opt)) return null;
    return { kind: 'op', op: 'visualizer', id: s };
  }
  if (key === 'background' && parts.length === 1) {
    const s = asString(args[0]);
    if (!s || !knownId('background', s, opt)) return null;
    return { kind: 'op', op: 'background', id: s };
  }
  if (key === 'milkdrop/preset') {
    const s = asString(args[0]);
    if (!s) return null;
    return { kind: 'op', op: 'milkdrop', name: s };
  }
  if (parts[0] === 'layer' && parts.length === 3) {
    const n = Number(parts[1]);
    if (!Number.isInteger(n) || n < 1 || n > 32) return null;
    const layers = cfg && Array.isArray(cfg.layers) ? cfg.layers : [];
    if (!layers[n - 1]) return null;
    if (parts[2] === 'opacity') {
      const v = finite(args[0]);
      if (v == null) return null;
      return { kind: 'set', path: 'layers.' + (n - 1) + '.opacity', value: clamp(v, 0, 1) };
    }
    if (parts[2] === 'enabled') {
      const v = asBool(args[0]);
      if (v == null) return null;
      return { kind: 'set', path: 'layers.' + (n - 1) + '.enabled', value: v };
    }
    return null;
  }
  if (key === 'deck/launch') {
    const row = asInt(args[0]);
    const col = asInt(args[1]);
    if (row == null || col == null || row < 0 || col < 0 || row > 64 || col > 64) return null;
    return { kind: 'op', op: 'deck', row, col };
  }
  if (key === 'deck/active') {
    const s = typeof args[0] === 'string' ? args[0].trim() : null;
    if (s == null) return null;
    if (!s) return { kind: 'op', op: 'deck-stop' };
    const cells = [];
    for (const bit of s.split(',')) {
      const pair = bit.trim().split(':');
      if (pair.length !== 2) return null;
      const row = asInt(Number(pair[0]));
      const col = asInt(Number(pair[1]));
      if (row == null || col == null || row < 0 || col < 0) return null;
      cells.push({ row, col });
    }
    if (!cells.length) return null;
    return { kind: 'op', op: 'deck-many', cells };
  }
  if (key === 'deck/stop') {
    const v = asBool(args[0]);
    if (!v) return null;
    return { kind: 'op', op: 'deck-stop' };
  }
  if (key === 'timeline/playing') {
    const v = asBool(args[0]);
    if (v == null) return null;
    return { kind: 'op', op: 'timeline', mode: v ? 'play' : 'pause' };
  }
  if (key === 'timeline/stop') {
    const v = asBool(args[0]);
    if (!v) return null;
    return { kind: 'op', op: 'timeline', mode: 'stop' };
  }
  const slider = SLIDERS.find((x) => x.path === parts.join('.'));
  if (!slider) return null;
  const v = sliderValue(slider, args[0]);
  if (v == null) return null;
  return { kind: 'set', path: slider.path, value: v };
}

function applySteps(cfg, steps) {
  for (const s of steps || []) {
    if (s && s.kind === 'set') setPath(cfg, s.path, s.value);
  }
  return cfg;
}

function delayMs(time, nowMs) {
  if (!time || time.immediate) return 0;
  if (!Number.isFinite(time.unixMs) || !Number.isFinite(nowMs)) return 0;
  const d = time.unixMs - nowMs;
  if (d <= 0 || d > MAX_WAIT_MS) return 0;
  return Math.round(d);
}

function readTimetag(sec, frac) {
  if ((sec >>> 0) === 0 && (frac >>> 0) === 1) return { immediate: true, unixMs: null };
  const unixMs = ((sec >>> 0) - NTP_UNIX) * 1000 + Math.round((frac >>> 0) / 0x100000000 * 1000);
  return { immediate: false, unixMs };
}

/* --- OSCQuery --- */

function sliderRange(slider) {
  if (Array.isArray(slider.steps) && slider.steps.length) return [{ VALS: slider.steps.slice() }];
  return [{ MIN: slider.min, MAX: slider.max }];
}

function leaf(path, type, access, value, range, description) {
  const node = { FULL_PATH: path, ACCESS: access, TYPE: type, DESCRIPTION: description };
  if (range) node.RANGE = range;
  if (value !== undefined) node.VALUE = [value];
  return node;
}

function sceneName(cfg) {
  const id = cfg && cfg._activeSceneId;
  const list = cfg && Array.isArray(cfg.scenes) ? cfg.scenes : [];
  const hit = list.find((s) => s && s.id === id);
  return hit && hit.name ? hit.name : '';
}

function leaves(cfg, opt) {
  const pre = prefixOf(cfg);
  const live = (opt && opt.live) || {};
  const out = [];
  const add = (rel, node) => out.push(node);
  for (const s of SLIDERS) {
    const rel = s.path.replace(/\./g, '/');
    const cur = getPath(cfg, s.path);
    add(rel, leaf(pre + '/' + rel, s.int ? 'i' : 'f', 3, cur === undefined ? undefined : cur, sliderRange(s), s.path));
  }
  add('show/blackout', leaf(pre + '/show/blackout', 'i', 3, live.blackout ? 1 : 0, [{ MIN: 0, MAX: 1 }], 'Blackout'));
  add('show/palette', leaf(pre + '/show/palette', 's', 3, getPath(cfg, 'background.colorMode') || 'theme', null, 'theme, solid or rainbow'));
  const bright = SLIDERS.find((s) => s.path === 'background.gradient.brightness');
  add('show/brightness', leaf(pre + '/show/brightness', 'f', 3, getPath(cfg, bright.path), sliderRange(bright), 'Background brightness'));
  add('show/transition', leaf(pre + '/show/transition', 's', 3, getPath(cfg, 'transition.type') || '', null, 'Transition id'));
  add('show/autovj', leaf(pre + '/show/autovj', 'i', 3, cfg && cfg.autovj && cfg.autovj.enabled ? 1 : 0, [{ MIN: 0, MAX: 1 }], 'Auto VJ'));
  add('crossfade', leaf(pre + '/crossfade', 'f', 3, cfg && cfg.crossfade && Number.isFinite(cfg.crossfade.value) ? cfg.crossfade.value : 0, [{ MIN: 0, MAX: 1 }], 'A/B crossfader'));
  add('scene', leaf(pre + '/scene', 's', 3, sceneName(cfg), null, 'Scene name, UTF-8'));
  add('visualizer', leaf(pre + '/visualizer', 's', 3, getPath(cfg, 'visualizer.type') || '', null, 'Visualizer id'));
  add('background', leaf(pre + '/background', 's', 3, getPath(cfg, 'background.type') || '', null, 'Background id'));
  add('milkdrop/preset', leaf(pre + '/milkdrop/preset', 's', 3, getPath(cfg, 'milkdrop.name') || '', null, 'MilkDrop preset name, UTF-8'));
  const layers = cfg && Array.isArray(cfg.layers) ? cfg.layers : [];
  for (let i = 0; i < Math.min(32, layers.length); i++) {
    const n = i + 1;
    const layer = layers[i] || {};
    add('layer/' + n + '/opacity', leaf(pre + '/layer/' + n + '/opacity', 'f', 3, Number.isFinite(Number(layer.opacity)) ? Number(layer.opacity) : 1, [{ MIN: 0, MAX: 1 }], 'Layer opacity'));
    add('layer/' + n + '/enabled', leaf(pre + '/layer/' + n + '/enabled', 'i', 3, layer.enabled === false ? 0 : 1, [{ MIN: 0, MAX: 1 }], 'Layer enabled'));
  }
  add('deck/launch', leaf(pre + '/deck/launch', 'ii', 2, undefined, [{ MIN: 0, MAX: 64 }, { MIN: 0, MAX: 64 }], 'Launch clip row and column'));
  add('deck/active', leaf(pre + '/deck/active', 's', 3, live.deck || '', null, 'Playing cells, row:col'));
  add('deck/stop', leaf(pre + '/deck/stop', 'i', 2, undefined, [{ MIN: 0, MAX: 1 }], 'Stop the deck'));
  add('timeline/playing', leaf(pre + '/timeline/playing', 'i', 3, live.timeline ? 1 : 0, [{ MIN: 0, MAX: 1 }], 'Timeline play or pause'));
  add('timeline/stop', leaf(pre + '/timeline/stop', 'i', 2, undefined, [{ MIN: 0, MAX: 1 }], 'Stop the timeline'));
  if (Number.isFinite(live.level)) add('level', leaf(pre + '/level', 'f', 1, live.level, [{ MIN: 0, MAX: 1 }], 'Level'));
  if (Number.isFinite(live.bpm)) add('tempo/bpm', leaf(pre + '/tempo/bpm', 'f', 1, live.bpm, null, 'BPM'));
  if (typeof live.playing === 'boolean') {
    add('transport', leaf(pre + '/transport', 's', 1, live.playing ? 'playing' : 'stopped', null, 'Preview audio'));
  }
  if (typeof live.track === 'string') add('show/track', leaf(pre + '/show/track', 's', 1, live.track, null, 'Current track, UTF-8'));
  return out;
}

function queryTree(cfg, opt) {
  const root = { FULL_PATH: '/', ACCESS: 0, CONTENTS: {} };
  for (const node of leaves(cfg || {}, opt)) {
    const rel = node.FULL_PATH.split('/').filter(Boolean);
    let at = root;
    let acc = '';
    for (let i = 0; i < rel.length; i++) {
      acc += '/' + rel[i];
      at.CONTENTS = at.CONTENTS || {};
      const last = i === rel.length - 1;
      if (last) at.CONTENTS[rel[i]] = node;
      else if (!at.CONTENTS[rel[i]] || at.CONTENTS[rel[i]].ACCESS !== 0) {
        at.CONTENTS[rel[i]] = { FULL_PATH: acc, ACCESS: 0, CONTENTS: {} };
      }
      at = at.CONTENTS[rel[i]];
    }
  }
  return root;
}

function nodeAt(root, urlPath) {
  if (!urlPath || urlPath === '/') return root;
  const parts = urlPath.split('/').filter(Boolean);
  let node = root;
  for (const p of parts) {
    if (!node || !node.CONTENTS || !node.CONTENTS[p]) return null;
    node = node.CONTENTS[p];
  }
  return node;
}

function hostInfo(opt) {
  return {
    NAME: 'SoundVisualizer',
    EXTENSIONS: { TYPE: true, ACCESS: true, RANGE: true, VALUE: true, CLIPMODE: false },
    OSC_IP: (opt && opt.ip) || '0.0.0.0',
    OSC_PORT: (opt && opt.oscPort) || 9000,
    OSC_TRANSPORT: 'UDP',
  };
}

function handleQuery(url, cfg, opt) {
  let path = '/';
  let host = false;
  try {
    const u = new URL(url, 'http://127.0.0.1');
    path = decodeURIComponent(u.pathname || '/');
    host = u.searchParams.has('HOST_INFO');
  } catch {
    return null;
  }
  if (host) return hostInfo(opt);
  const node = nodeAt(queryTree(cfg, opt), path);
  return node;
}

const api = {
  DEFAULT_PREFIX, MAX_WAIT_MS, SLIDERS, PALETTES,
  prefixOf, normalizeSettings, plan, applySteps, setPath, getPath,
  delayMs, readTimetag, queryTree, handleQuery, hostInfo,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.SVOscTree = api;
})();
