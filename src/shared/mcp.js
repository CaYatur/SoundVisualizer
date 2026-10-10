/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* MCP tool catalog, permission gates, and JSON-RPC handler.
   The Electron host calls into the running app. This file decides
   which write group a tool needs. Apply tools use what already exists.
   Edit tools create or change structure. Reads need only the master switch. */
(function () {
  const MODES = ['read', 'apply', 'write', 'full', 'everything'];
  const MODE_RANK = { read: 1, apply: 2, write: 3, full: 4, everything: 5 };
  const GROUP_MODE = {
    sceneApply: 'apply', effectApply: 'apply', presetApply: 'apply',
    sceneEdit: 'write', effectEdit: 'write', presetEdit: 'write',
    export: 'write', autovj: 'write',
    blackout: 'full', output: 'full', timeline: 'full',
    updates: 'everything', repairAudio: 'everything', streamToken: 'everything',
    controlBindings: 'everything',
  };
  const ALLOW_KEYS = MODES.slice();
  const GROUP_LABEL = {
    sceneApply: 'scene.apply', sceneEdit: 'scene.edit',
    effectApply: 'effect.apply', effectEdit: 'effect.edit',
    presetApply: 'preset.apply', presetEdit: 'preset.edit',
    output: 'output', export: 'export', blackout: 'blackout',
    autovj: 'autovj', timeline: 'timeline',
    updates: 'updates', repairAudio: 'repair-audio', streamToken: 'stream-token',
    controlBindings: 'control',
  };
  const DEFAULT_PORT = 38471;
  const DEFAULT_MCP = { enabled: false, mode: 'read', port: DEFAULT_PORT };
  const SCENE_KEYS = [
    'background', 'visualizer', 'layers', 'layerStack', 'layerGroups', 'crossfade',
    'geometry', 'postfx', 'logo', 'images', 'media', 'text', 'modulation',
    'transition', 'custom', 'milkdrop', 'feedback',
  ];
  const EFFECT_TYPES = [
    'bloom', 'chroma', 'glitch', 'grain', 'crt', 'pixelate', 'kaleido', 'mirror',
    'grade', 'vignette', 'trails', 'edge', 'zoomblur', 'ripple', 'posterize',
    'blur', 'radialblur', 'motionblur', 'tiltshift', 'dof', 'sharpen', 'emboss',
    'dither', 'halftone', 'ascii', 'hatch', 'paint', 'vhs', 'datamosh', 'slitscan',
    'lens', 'twirl', 'polar', 'gradientmap', 'levels', 'threshold', 'solarize',
    'godrays', 'badtv', 'starfilter',
  ];
  const LAYER_DEFAULTS = {
    id: null, name: '', enabled: true, kind: 'visualizer', type: 'bars', presetId: null,
    blend: 'normal', opacity: 1,
    transform: { scale: 1, rotate: 0, x: 0, y: 0, flipX: false, flipY: false },
    audio: { band: 'bass', opacity: 0, scale: 0, rotate: 0 },
    settings: {}, solo: false, muted: false, locked: false, group: '',
    mask: { type: 'none', x: 0.5, y: 0.5, w: 0.6, h: 0.6, angle: 0, feather: 0.1, invert: false, from: '' },
    postfx: [],
  };
  const PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18'];
  const TOOLS = [];

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function uid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function normalizePort(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 65535 || n === 8722) return DEFAULT_PORT;
    return n;
  }
  function normalizeMcp(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const mode = MODES.indexOf(src.mode) >= 0 ? src.mode : 'read';
    return { enabled: src.enabled === true, mode: mode, port: normalizePort(src.port) };
  }
  function mcpI18n() {
    if (mcpI18n.cached !== undefined) return mcpI18n.cached;
    mcpI18n.cached = null;
    try { if (typeof require === 'function') mcpI18n.cached = require('./i18n'); } catch (e) { mcpI18n.cached = null; }
    return mcpI18n.cached;
  }
  function text(key, locale) {
    const loc = locale === 'tr' ? 'tr' : 'en';
    const mod = mcpI18n();
    if (mod && typeof mod.mcpText === 'function') return mod.mcpText(key, loc);
    if (typeof window !== 'undefined' && window.SVI18n && window.SVI18n.mcpText) return window.SVI18n.mcpText(key, loc);
    return key;
  }
  function localeOf(ctx) {
    try {
      const v = ctx && ctx.locale ? ctx.locale() : null;
      if (v === 'tr' || v === 'en') return v;
    } catch (e) { /* ignore */ }
    if (typeof window !== 'undefined' && window.SVI18n && (window.SVI18n.locale === 'tr' || window.SVI18n.locale === 'en')) return window.SVI18n.locale;
    return 'en';
  }
  function minMode(group) {
    if (!group || group === 'routed') return 'read';
    if (group === 'mcp' || group === 'never') return null;
    return GROUP_MODE[group] || 'everything';
  }
  function modeAllows(mcp, group) {
    const need = minMode(group);
    if (!need || !mcp || mcp.enabled !== true) return false;
    return MODE_RANK[mcp.mode] >= MODE_RANK[need];
  }
  function modeWord(mode, locale) { return text('mcp.mode.' + mode + '.word', locale); }
  function modeBlockError(locale, need) {
    return text('mcp.err.mode', locale).replace('{mode}', modeWord(need, locale));
  }
  function configOf(ctx) {
    const c = ctx && ctx.getConfig ? ctx.getConfig() : null;
    return c && typeof c === 'object' ? c : {};
  }
  function revisionOf(ctx) {
    try { return ctx && ctx.revision ? ctx.revision() : 0; } catch (e) { return 0; }
  }
  /* Ayardaki gizli değerler: yayın ve kumanda jetonları. Okuma ve dosyaya
     yazma aynı yardımcıdan geçer; eskiden `sv_get_config` gizliyor,
     `sv_export_json` ham ayarı diske yazıyordu. */
  const SECRET_PATHS = [['stream', 'token'], ['stream', 'remoteToken']];
  function redactSecrets(cfg) {
    for (const p of SECRET_PATHS) {
      const sec = cfg && cfg[p[0]];
      if (sec && typeof sec === 'object' && sec[p[1]]) sec[p[1]] = '[redacted]';
    }
    return cfg;
  }
  /* Dosya yazan araçlar: uygulamanın kendi klasörlerine yazmaz, var olan
     bir dosyanın üstüne ancak `overwrite:true` ile yazar. Denetim ana
     süreçte (ctx.outPathGuard); burada yalnız çağrılır. */
  function outPathError(ctx, p, exts, overwrite) {
    const bad = badOutPath(p, exts);
    if (bad) return bad;
    if (ctx && ctx.outPathGuard) return ctx.outPathGuard(p, overwrite === true) || '';
    return '';
  }
  function denied(group) {
    return { ok: false, error: 'Permission denied: ' + (GROUP_LABEL[group] || group) + ' is off. Enable that switch on the MCP card under Control. Writes stay off until the matching group is allowed.' };
  }
  function fail(message) { return { ok: false, error: message }; }
  /* Dosya yazan araçların yolu. Ajan "yazma" kipinde bile yalnız kendi
     türünde bir dosya yazabilsin: .bat ya da başlangıç klasörüne betik
     bırakmak kod çalıştırmaya dönüşürdü. ffmpeg çıktıyı protokol olarak da
     okur (tcp://, pipe:); yerel ve mutlak bir dosya yolu şart. Ağ paylaşımı
     (\\sunucu) da dışarıda kalır. */
  function badOutPath(p, exts) {
    const s = typeof p === 'string' ? p : '';
    if (!s || s.length > 1024 || s.indexOf('\0') >= 0) return 'path is required.';
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(pipe|file|tcp|udp|rtmp|http|https|ftp):/i.test(s)) return 'path must be a local file path.';
    const winAbs = /^[A-Za-z]:[\\/]/.test(s);
    if (!winAbs && s.charAt(0) !== '/') return 'path must be absolute.';
    if (/^[\\/]{2}/.test(s)) return 'Network paths are not allowed.';
    const dot = s.lastIndexOf('.');
    const ext = dot > Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')) ? s.slice(dot + 1).toLowerCase() : '';
    if (exts.indexOf(ext) < 0) return 'path must end with .' + exts.join(' or .') + '.';
    return '';
  }
  /* Ayar yolu → izin grubu. Her üst düzey anahtar burada açıkça yazılı;
     yeni bir ayar eklenip buraya yazılmazsa en sıkı izni ister ve
     mcp-coverage testi düşer (#695). Bir yolun izni, kendisini ya da üst
     yolunu kapsayan en özel kuraldır; ALTINDA daha sıkı bir kural varsa o
     geçer. Eskiden yalnız "stream." gibi alt yollar korunuyordu: "write"
     kipindeki bir istemci `stream` nesnesinin tamamını yazıp yayın
     anahtarını değiştirebiliyor, `power` ile ESC kilidini kaldırabiliyordu. */
  const PATH_GROUPS = {
    mcp: 'mcp', version: 'never',
    updates: 'updates',
    stream: 'output', 'stream.token': 'streamToken', 'stream.remoteToken': 'streamToken',
    control: 'controlBindings',
    timeline: 'timeline', clipdeck: 'timeline',
    isBlackout: 'blackout', 'transition.blackoutType': 'blackout', 'transition.blackoutDuration': 'blackout',
    export: 'export', recording: 'export',
    display: 'output', mapping: 'output', textureShare: 'output', aspect: 'output', floating: 'output',
    power: 'output', lighting: 'output', openrgb: 'output', artnet: 'output',
    'audio.sources': 'output',
    'background.transparent': 'output', 'background.coverTaskbar': 'output', 'background.transparentKey': 'output',
    postfx: 'effectEdit', modulation: 'effectEdit',
    milkdrop: 'presetEdit', milkdropLibrary: 'presetEdit', milkdropControl: 'presetEdit',
    userPresets: 'presetEdit', custom: 'presetEdit', feedback: 'presetEdit',
    autovj: 'autovj',
    audio: 'sceneEdit', background: 'sceneEdit', visualizer: 'sceneEdit', logo: 'sceneEdit',
    images: 'sceneEdit', layers: 'sceneEdit', layerStack: 'sceneEdit', layerGroups: 'sceneEdit',
    crossfade: 'sceneEdit', text: 'sceneEdit', nowplaying: 'sceneEdit', transition: 'sceneEdit',
    geometry: 'sceneEdit', media: 'sceneEdit', scenes: 'sceneEdit', dynamicTheme: 'sceneEdit',
  };
  function groupRank(group) {
    const need = minMode(group);
    return need ? MODE_RANK[need] : 99;
  }
  function groupForPath(p) {
    const path = String(p || '');
    if (!path) return 'mcp';
    let base = null;
    let baseLen = -1;
    let strict = null;
    for (const key of Object.keys(PATH_GROUPS)) {
      const g = PATH_GROUPS[key];
      if (path === key || path.indexOf(key + '.') === 0) {
        if (key.length > baseLen) { base = g; baseLen = key.length; }
      } else if (key.indexOf(path + '.') === 0) {
        // Yolun altında daha sıkı bir kural: bütün nesneyi yazmak onu da yazar
        if (!strict || groupRank(g) > groupRank(strict)) strict = g;
      }
    }
    // Katman efektleri (layers.N.postfx) efekt düzenleme izniyle
    if (base === 'sceneEdit' && /(^|\.)postfx(\.|$)/.test(path)) base = 'effectEdit';
    if (!base) return 'everything';
    if (strict && groupRank(strict) > groupRank(base)) return strict;
    return base;
  }
  function unsafeKey(k) { return k === '__proto__' || k === 'prototype' || k === 'constructor'; }
  /* Dizi içinden geçen yol (layers.0.opacity) yalnız VAR OLAN bir öğeye
     yazar. Eskiden ara düğüm dizi olunca {} ile değiştiriliyordu:
     `layers.0.opacity` bütün katman listesini silip {"0":{…}} bırakıyordu,
     ayar dosyasına da öyle yazılıyordu. Sayı olmayan ya da listenin
     dışındaki bir sıra reddedilir; seyrek dizi oluşmaz. Sayı ya da metin
     olan bir değerin altına yazmak da onu nesneye çevirmez. */
  function setPath(obj, p, value) {
    const keys = String(p).split('.');
    if (keys.some(unsafeKey)) return fail('Refusing unsafe config path.');
    if (keys.some(function (k) { return !k; })) return fail('Config path has an empty segment.');
    let node = obj;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (Array.isArray(node) && !(/^(0|[1-9]\d*)$/.test(k) && Number(k) < node.length)) {
        return fail('"' + keys.slice(0, i).join('.') + '" is a list of ' + node.length + ' items; "' + k + '" is not an existing index.');
      }
      if (i === keys.length - 1) { node[k] = value; break; }
      if (node[k] === undefined || node[k] === null) node[k] = {};
      else if (typeof node[k] !== 'object') return fail('"' + keys.slice(0, i + 1).join('.') + '" is a ' + typeof node[k] + ', not an object.');
      node = node[k];
    }
    return { ok: true };
  }
  function getPath(obj, p) {
    return String(p).split('.').reduce(function (x, k) { return x == null ? x : x[k]; }, obj);
  }
  function mergeObj(base, patch) {
    const out = Object.assign({}, base || {});
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return out;
    for (const k of Object.keys(patch)) {
      if (unsafeKey(k)) continue;
      const v = patch[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = mergeObj(out[k], v);
      else out[k] = v;
    }
    return out;
  }
  /* Doğrulamalar. Aralıklar panelin kendi denetimleriyle aynı; uygulamanın
     yazdığı her değer geçer, yalnız panelin üretemeyeceği değerler
     reddedilir ya da panelin aralığına çekilir. Eskiden `x:"abc"`,
     `scale:-5`, `opacity:7`, `enabled:"yes"` olduğu gibi yazılıyordu;
     `publicLayer` NaN'ı 0 gösterdiği için hata da görünmüyordu. */
  const TRANSFORM_RANGE = { x: [-1, 1], y: [-1, 1], scale: [0.2, 3], rotate: [-180, 180] };
  const LAYER_FLAGS = ['enabled', 'solo', 'muted', 'locked'];
  function finite(v) { return typeof v === 'number' && isFinite(v); }
  function cleanTransform(src) {
    const out = {};
    for (const k of Object.keys(src || {})) {
      if (unsafeKey(k)) continue;
      const v = src[k];
      const range = TRANSFORM_RANGE[k];
      if (range) {
        if (!finite(v)) return { error: 'transform.' + k + ' must be a finite number.' };
        // Dönüş tam turlarda aynı görünür; 1e9° yerine eşdeğer açı
        const x = k === 'rotate' ? ((v + 180) % 360 + 360) % 360 - 180 : v;
        out[k] = Math.max(range[0], Math.min(range[1], x));
      } else if (k === 'flipX' || k === 'flipY') {
        if (typeof v !== 'boolean') return { error: 'transform.' + k + ' must be true or false.' };
        out[k] = v;
      } else return { error: 'Unknown transform key "' + k + '". Use x, y, scale, rotate, flipX, flipY.' };
    }
    return { value: out };
  }
  function layerFieldError(patch) {
    for (const k of LAYER_FLAGS) {
      if (patch[k] !== undefined && typeof patch[k] !== 'boolean') return k + ' must be true or false.';
    }
    if (patch.opacity !== undefined && !finite(patch.opacity)) return 'opacity must be a number from 0 to 1.';
    if (patch.name !== undefined && typeof patch.name !== 'string') return 'name must be a string.';
    if (patch.group !== undefined && patch.group !== null && typeof patch.group !== 'string') return 'group must be a string or null.';
    if (patch.presetId !== undefined && patch.presetId !== null && typeof patch.presetId !== 'string') return 'presetId must be a string or null.';
    return '';
  }
  /* Renkler panelin renk seçicisinin yazdığı biçimde (#rrggbb); #rgb
     açılır. Şablonlar panelde olduğu gibi beş renk. Eskiden
     ['red','#zzzzzz',5] kabul ediliyor, uygulanınca arkaplan siyah
     kalıyordu. */
  function hexColor(c) {
    if (typeof c !== 'string') return null;
    const s = c.trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
    return null;
  }
  function paletteColors(list) {
    if (!Array.isArray(list) || list.length < 2) return { error: 'colors must be a list of at least 2 hex colors (#rrggbb).' };
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const c = hexColor(list[i]);
      if (!c) return { error: 'colors[' + i + '] is not a hex color (#rrggbb): ' + JSON.stringify(list[i]) };
      out.push(c);
    }
    const five = out.slice(0, 5);
    while (five.length < 5) five.push(five[five.length - 1]);
    return { value: five };
  }
  /* Bölüm yamaları (metin, logo, medya, geometri) yalnız o bölümün
     bilinen anahtarlarını ve aynı türde değer yazar. Eskiden
     `geometry.shape` ya da `media.path` gibi var olmayan anahtarlar
     sessizce kaydediliyor, hiçbir şey olmuyordu. */
  function sectionPatchError(section, patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return 'patch must be an object.';
    const SV = defaultsApi();
    const base = SV && SV.defaultConfig ? SV.defaultConfig()[section] : null;
    if (!base || typeof base !== 'object') return '';
    const bad = [];
    for (const k of Object.keys(patch)) {
      if (unsafeKey(k)) return 'Refusing unsafe key.';
      if (!Object.prototype.hasOwnProperty.call(base, k)) { bad.push(k); continue; }
      const want = base[k];
      const v = patch[k];
      if (want === null || v === null) continue;
      const wt = Array.isArray(want) ? 'array' : typeof want;
      const vt = Array.isArray(v) ? 'array' : typeof v;
      if (wt !== vt) return section + '.' + k + ' must be a ' + wt + ', got ' + vt + '.';
      if (vt === 'number' && !isFinite(v)) return section + '.' + k + ' must be a finite number.';
    }
    if (bad.length) return 'Unknown ' + section + ' key(s): ' + bad.join(', ') + '. Known keys: ' + Object.keys(base).join(', ') + '.';
    return '';
  }
  /* Yazılan değerin türü var olan değerinkiyle aynı olmalı. Eskiden
     `{"path":"layers","value":"x"}` katman listesini metne çeviriyor,
     ayar dosyasına öyle yazılıyordu; katman araçları ".map is not a
     function" ile düşüyordu. `visualizer.sensitivity` için "abc" de
     geçiyordu. Yeni bir anahtar (var olan değer yok) ve null serbest. */
  function kindOf(v) {
    if (v === null) return 'null';
    return Array.isArray(v) ? 'array' : typeof v;
  }
  function valueTypeError(cfg, path, value) {
    let cur = getPath(cfg, path);
    const got = kindOf(value);
    /* Ayarda henüz olmayan alan varsayılandaki türe göre denetlenir;
       varsayılanda da yoksa yeni anahtardır, serbest. Eskiden alan yoksa
       denetim hiç yapılmıyordu (ör. eski bir katmanda `enabled:"yes"`). */
    if (cur === undefined) {
      const SV = defaultsApi();
      cur = SV && SV.defaultConfig ? getPath(SV.defaultConfig(), path) : undefined;
      if (cur === undefined) return '';
    }
    /* Değeri null olan alan (display.id, layerStack.enabled) tek değer
       alır; nesne ya da liste yalnız ekran haritasına yazılır. Eskiden
       `display.id = {a:1}` kabul ediliyordu. */
    if (cur === null) {
      if (got === 'object' && /^mapping\.outputs\.[^.]+$/.test(String(path))) return '';
      if (got === 'object' || got === 'array') return '"' + path + '" holds a single value (or null); refusing to replace it with ' + (got === 'array' ? 'an array' : 'an object') + '.';
      if (got === 'number' && !isFinite(value)) return '"' + path + '" must be a finite number.';
      return '';
    }
    const want = kindOf(cur);
    /* Uygulamanın kendisi tek değerli alanları boşaltıyor (display.id,
       layerStack.enabled null olabiliyor) ve ekran haritasını null'a
       çekiyor. Liste ya da nesne null yapılamaz: katman listesini silmenin
       başka bir yolu olurdu. */
    if (got === 'null' && (want === 'number' || want === 'string' || want === 'boolean' || /^mapping\.outputs\./.test(String(path)))) return '';
    const an = (w) => (/^[aeiou]/.test(w) ? 'an ' : 'a ') + w;
    if (want !== got) return '"' + path + '" holds ' + an(want) + '; refusing to replace it with ' + an(got) + '.';
    if (got === 'number' && !isFinite(value)) return '"' + path + '" must be a finite number.';
    return '';
  }

  /* Kilit, paneldeki gibi: kilitli katman silinmez, taşınmaz, ayarı,
     konumu ve efektleri değişmez; görünürlük, solo, sessiz ve kilidin
     kendisi değişebilir. Eskiden MCP kilide hiç bakmıyordu. Kilidi açan
     bir yama (`locked:false`) aynı çağrıda düzenleme de yapabilir. */
  const LOCK_FREE = ['enabled', 'solo', 'muted', 'locked'];
  function lockedError(layer) {
    return 'Layer "' + ((layer && (layer.name || layer.id)) || '?') + '" is locked. Unlock it first (sv_update_layer with patch {"locked": false}). Show, solo and mute still work while locked.';
  }
  function lockBlocksPatch(layer, patch) {
    if (!layer || !layer.locked || !patch) return false;
    if (patch.locked === false) return false;
    return Object.keys(patch).some(function (k) { return LOCK_FREE.indexOf(k) < 0; });
  }
  /* Ham yol yazımında kilit: layers.N.<alan> kilitli katmanın serbest
     olmayan alanına, layers.N'nin tamamına ya da kilitli katmanları
     değiştiren bir `layers` listesine yazılmaz. */
  function lockedPathError(cfg, path, value) {
    const keys = String(path).split('.');
    if (keys[0] !== 'layers') return '';
    const list = Array.isArray(cfg.layers) ? cfg.layers : [];
    if (keys.length === 1) {
      if (!Array.isArray(value)) return '';
      for (let i = 0; i < list.length; i++) {
        const l = list[i];
        if (l && l.locked && JSON.stringify(value[i]) !== JSON.stringify(l)) return lockedError(l);
      }
      return '';
    }
    const l = /^(0|[1-9]\d*)$/.test(keys[1]) ? list[Number(keys[1])] : null;
    if (!l || !l.locked) return '';
    if (keys.length === 3 && LOCK_FREE.indexOf(keys[2]) >= 0) return '';
    return lockedError(l);
  }
  /* Ham yolla katman yazımı katman araçlarının denetiminden geçer.
     Eskiden `layers.1.opacity = 7`, `layers.0.transform.scale = -5` ve
     `layers.0.enabled = "yes"` sv_patch_config ile olduğu gibi yazılıyordu;
     sv_update_layer aynılarını reddediyor ya da aralığa çekiyordu. Yazım
     bir kopyada yapılır, etkilenen her katman sv_update_layer'ın
     kurallarıyla denetlenir: bayraklar true/false, opaklık 0–1'e, dönüşüm
     panelin aralığına çekilir; tür ve harmanlama değiştiyse geçerli olmalı. */
  function checkLayer(layer, before) {
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) return { error: 'a layer must be an object.' };
    const bad = layerFieldError(layer);
    if (bad) return { error: bad };
    const out = Object.assign({}, layer);
    if (out.opacity !== undefined) out.opacity = Math.max(0, Math.min(1, out.opacity));
    if (out.transform !== undefined) {
      if (!out.transform || typeof out.transform !== 'object' || Array.isArray(out.transform)) return { error: 'transform must be an object.' };
      const t = cleanTransform(out.transform);
      if (t.error) return { error: t.error };
      out.transform = t.value;
    }
    const was = before || {};
    if (out.kind !== was.kind || out.type !== was.type) {
      const wrong = badLayer(out.kind, out.type);
      if (wrong) return { error: wrong };
    }
    if (out.blend !== was.blend) {
      const wrong = badBlend(out.blend);
      if (wrong) return { error: wrong };
    }
    return { value: out };
  }
  function patchLayers(cfg, path, value) {
    const keys = String(path).split('.');
    const list = Array.isArray(cfg.layers) ? cfg.layers : [];
    const copy = { layers: JSON.parse(JSON.stringify(list)) };
    const wrote = setPath(copy, path, value);
    if (wrote.ok === false) return wrote;
    if (!Array.isArray(copy.layers)) return fail('layers must be a list.');
    const byId = {};
    list.forEach(function (l) { if (l && l.id) byId[l.id] = l; });
    const idx = keys.length === 1 ? copy.layers.map(function (_, i) { return i; }) : [Number(keys[1])];
    for (const i of idx) {
      const next = copy.layers[i];
      const before = keys.length === 1 ? (next && byId[next.id]) : list[i];
      const r = checkLayer(next, before);
      if (r.error) return fail('layers.' + i + ': ' + r.error);
      copy.layers[i] = r.value;
    }
    cfg.layers = copy.layers;
    return { ok: true, value: getPath(copy, path) };
  }
  function summarize(v, depth) {
    if (depth == null) depth = 0;
    if (typeof v === 'string') {
      if (v.length > 240) return { truncated: true, length: v.length, head: v.slice(0, 80) };
      return v;
    }
    if (v == null || typeof v !== 'object') return v;
    if (depth > 4) return '[depth]';
    if (Array.isArray(v)) return v.slice(0, 40).map(function (item) { return summarize(item, depth + 1); });
    const out = {};
    for (const k of Object.keys(v)) {
      if (unsafeKey(k)) continue;
      out[k] = summarize(v[k], depth + 1);
    }
    return out;
  }
  function publicFx(fx, index) {
    fx = fx || {};
    return { index: index, id: fx.id || null, type: fx.type || '', enabled: fx.enabled !== false, params: fx.params || {} };
  }
  function publicLayer(layer, index) {
    const t = (layer && layer.transform) || {};
    return {
      index: index,
      id: layer && layer.id || null,
      name: layer && layer.name || '',
      kind: layer && layer.kind || '',
      type: layer && layer.type || '',
      enabled: !layer || layer.enabled !== false,
      opacity: layer ? layer.opacity : 1,
      blend: layer && layer.blend || 'normal',
      transform: {
        x: Number(t.x) || 0, y: Number(t.y) || 0,
        scale: t.scale == null ? 1 : t.scale, rotate: Number(t.rotate) || 0,
        flipX: !!t.flipX, flipY: !!t.flipY,
      },
      settings: summarize(layer && layer.settings),
      postfx: ((layer && layer.postfx) || []).map(publicFx),
      // Ham ayarda duran ama eskiden görünmeyen alanlar
      presetId: layer && layer.presetId || null,
      solo: !!(layer && layer.solo),
      muted: !!(layer && layer.muted),
      locked: !!(layer && layer.locked),
      group: layer && layer.group || null,
      audio: summarize(layer && layer.audio) || null,
      mask: summarize(layer && layer.mask) || null,
    };
  }
  function visualState(cfg, ctx) {
    cfg = cfg || {};
    const bg = cfg.background || {};
    const vis = cfg.visualizer || {};
    const md = cfg.milkdrop || {};
    return {
      revision: revisionOf(ctx),
      blackout: cfg.isBlackout === true,
      activeSceneId: cfg._activeSceneId || null,
      background: { type: bg.type || null, solidColor: bg.solidColor || null, transparent: !!bg.transparent, colors: (bg.gradient && bg.gradient.colors) || null },
      visualizer: { type: vis.type || null },
      layerStack: cfg.layerStack || null,
      layers: (Array.isArray(cfg.layers) ? cfg.layers : []).map(publicLayer),
      postfx: (Array.isArray(cfg.postfx) ? cfg.postfx : []).map(publicFx),
      milkdrop: { presetId: md.presetId || '', name: md.name || '' },
      crossfade: cfg.crossfade || null,
    };
  }
  function withConfig(ctx, mutator) {
    const cfg = clone(configOf(ctx)) || {};
    const result = mutator(cfg);
    if (result && result.ok === false) return result;
    if (ctx.setConfig) ctx.setConfig(cfg);
    const rev = ctx.noteWrite ? ctx.noteWrite() : revisionOf(ctx);
    return Object.assign({ ok: true, revision: rev }, result || {});
  }
  function findScene(cfg, args) {
    const list = Array.isArray(cfg.scenes) ? cfg.scenes : [];
    if (args && args.id) {
      const hit = list.find(function (s) { return s && s.id === args.id; });
      if (hit) return { list: list, scene: hit };
    }
    if (args && args.name) {
      const name = String(args.name).trim().toLowerCase();
      const hits = list.filter(function (s) { return s && String(s.name || '').trim().toLowerCase() === name; });
      if (hits.length === 1) return { list: list, scene: hits[0] };
      if (hits.length > 1) return { error: 'More than one scene is named "' + args.name + '". Pass id.' };
    }
    return { list: list, scene: null };
  }
  function applySceneData(cfg, data) {
    const prevBg = clone(cfg.background);
    for (const key of SCENE_KEYS) if (data && data[key] !== undefined) cfg[key] = clone(data[key]);
    if (cfg.background && prevBg) {
      cfg.background.transparent = !!prevBg.transparent;
      if (prevBg.transparentKey != null) cfg.background.transparentKey = prevBg.transparentKey;
      if (prevBg.coverTaskbar != null) cfg.background.coverTaskbar = !!prevBg.coverTaskbar;
    }
  }
  function snapshotScene(cfg) {
    const data = {};
    for (const key of SCENE_KEYS) if (cfg[key] !== undefined) data[key] = clone(cfg[key]);
    return data;
  }
  function layersApi() {
    if (typeof window !== 'undefined' && window.SVLayers && window.SVLayers.setStackEnabled) return window.SVLayers;
    try { return require('../visualizer/layers.js'); } catch (e) { return null; }
  }
  /* Mod kimlikleri uygulamanın kendi kataloğundan (mode-catalog.js) gelir;
     yeni bir mod eklenince MCP onu kendiliğinden tanır. Eskiden tür
     araçları her dizgeyi kabul ediyordu: yanlış bir kimlik ekranı boş
     bırakıyor ve istemci geçerli kimlikleri öğrenemiyordu (#695). */
  function catalogApi() {
    if (typeof window !== 'undefined' && window.SVModeCatalog && window.SVModeCatalog.ids) return window.SVModeCatalog;
    try { return require('./mode-catalog.js'); } catch (e) { return null; }
  }
  function modeIds(kind) {
    const C = catalogApi();
    return C && C.ids ? C.ids(kind) : null;
  }
  function badMode(kind, type) {
    const ids = modeIds(kind);
    if (!ids) return '';
    if (ids.indexOf(String(type)) >= 0) return '';
    return 'Unknown ' + kind + ' type "' + type + '". sv_list_modes lists the valid ids.';
  }
  function layerKinds() {
    const L = layersApi();
    return L && Array.isArray(L.KINDS) ? L.KINDS : null;
  }
  /* Katmanın türü, türünün kataloğunda olmalı: görselleştirici ve
     arkaplan katmanları mod kimliği taşır, diğerleri kendi türünü. */
  function layerTypeIds(kind) {
    const C = catalogApi();
    if (!C || !C.layerPairs) return null;
    return C.layerPairs(kind).map(function (p) { return p[0]; });
  }
  function badLayer(kind, type) {
    const kinds = layerKinds();
    if (kind != null && kinds && kinds.indexOf(String(kind)) < 0) {
      return 'Unknown layer kind "' + kind + '". Valid: ' + kinds.join(', ') + '.';
    }
    if (type == null) return '';
    const k = kind == null ? 'visualizer' : kind;
    if (k !== 'visualizer' && k !== 'background') return '';
    const ids = layerTypeIds(k);
    if (!ids || ids.indexOf(String(type)) >= 0) return '';
    return 'Unknown ' + k + ' layer type "' + type + '". sv_list_modes lists the valid ids.';
  }
  /* Panelin "Katman Ekle" düğmeleriyle aynı başlangıç: tür verilmezse
     türün ilk seçeneği; Şimdi Çalıyor kendi fabrikasından. */
  function layerStart(raw) {
    const kind = raw.kind == null ? 'visualizer' : raw.kind;
    const L = layersApi();
    if (kind === 'nowplaying' && L && L.makeNowPlayingLayer) {
      const base = L.makeNowPlayingLayer({ name: raw.name || 'Now Playing' });
      return Object.assign({}, base, raw, {
        kind: 'nowplaying', type: 'nowplaying',
        settings: mergeObj(base.settings, raw.settings || {}),
      });
    }
    if (raw.type != null) return raw;
    if (kind === 'visualizer' || kind === 'background') {
      const ids = layerTypeIds(kind);
      return Object.assign({}, raw, { type: ids && ids.length ? ids[0] : (kind === 'background' ? 'gradient' : 'bars') });
    }
    return Object.assign({}, raw, { type: 'back' });
  }
  function badBlend(blend) {
    if (blend == null) return '';
    const L = layersApi();
    const list = L && Array.isArray(L.BLEND_MODES) ? L.BLEND_MODES : null;
    if (!list || list.indexOf(String(blend)) >= 0) return '';
    return 'Unknown blend "' + blend + '". Valid: ' + list.join(', ') + '.';
  }
  function ensureLayers(cfg) {
    const L = layersApi();
    if (L && L.setStackEnabled) {
      if (!L.stackOn(cfg)) L.setStackEnabled(cfg, true);
      if (!Array.isArray(cfg.layers)) cfg.layers = [];
      return cfg.layers;
    }
    if (!Array.isArray(cfg.layers)) cfg.layers = [];
    if (!cfg.layerStack || typeof cfg.layerStack !== 'object') cfg.layerStack = { enabled: true };
    cfg.layerStack.enabled = true;
    return cfg.layers;
  }
  function normalizeFx(raw) {
    const src = raw || {};
    return {
      id: src.id || uid('fx_'),
      type: String(src.type || ''),
      enabled: src.enabled !== false,
      params: src.params && typeof src.params === 'object' ? clone(src.params) : {},
    };
  }
  function normalizeLayer(raw) {
    const src = raw || {};
    const out = Object.assign({}, LAYER_DEFAULTS, src);
    out.transform = Object.assign({}, LAYER_DEFAULTS.transform, src.transform || {});
    out.audio = Object.assign({}, LAYER_DEFAULTS.audio, src.audio || {});
    out.mask = Object.assign({}, LAYER_DEFAULTS.mask, src.mask || {});
    out.settings = src.settings && typeof src.settings === 'object' ? clone(src.settings) : {};
    out.postfx = Array.isArray(src.postfx) ? src.postfx.map(normalizeFx) : [];
    if (!out.id) out.id = uid('ly_');
    return out;
  }
  function findLayer(cfg, args) {
    const list = Array.isArray(cfg.layers) ? cfg.layers : [];
    const id = args && (args.id || args.layerId);
    if (id != null && id !== '') {
      const index = list.findIndex(function (l) { return l && l.id === id; });
      if (index >= 0) return { list: list, index: index, layer: list[index] };
    }
    if (args && args.index != null && list[Number(args.index)]) {
      const index = Number(args.index);
      return { list: list, index: index, layer: list[index] };
    }
    return null;
  }
  function findFx(list, args) {
    const arr = Array.isArray(list) ? list : [];
    if (args && args.effectId) {
      const index = arr.findIndex(function (fx) { return fx && fx.id === args.effectId; });
      if (index >= 0) return { index: index, fx: arr[index] };
    }
    if (args && args.effectIndex != null && arr[Number(args.effectIndex)]) {
      const index = Number(args.effectIndex);
      return { index: index, fx: arr[index] };
    }
    if (args && args.type) {
      const hits = [];
      arr.forEach(function (fx, index) { if (fx && fx.type === args.type) hits.push({ index: index, fx: fx }); });
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) return { error: 'Several ' + args.type + ' effects match. Pass effectId or effectIndex.' };
    }
    return null;
  }
  function defaultsApi() {
    if (typeof window !== 'undefined' && window.SV && window.SV.defaultConfig) return window.SV;
    const g = typeof global !== 'undefined' ? global : null;
    if (g && g.window && g.window.SV && g.window.SV.defaultConfig) return g.window.SV;
    try {
      if (g) {
        g.window = g.window || {};
        require('./defaults.js');
        return g.window.SV;
      }
    } catch (e) { /* optional */ }
    return null;
  }
  function templatesApi() {
    if (typeof window !== 'undefined' && window.SVTemplates) return window.SVTemplates;
    try { return require('./templates.js'); } catch (e) { return null; }
  }
  function presetRecords(ctx) {
    try { if (ctx.presets && ctx.presets.list) return ctx.presets.list() || []; } catch (e) { /* cold store */ }
    return [];
  }
  /* Araç parametreleri (inputSchema). Eskiden her araç yalnız
     `{type:'object'}` bildiriyordu; istemci `id` mi `name` mi `patch` mi
     verileceğini tahmin ediyordu ve `engine` gibi alanlar yanlış yazılıyordu
     (#695 dış gözden geçirme). Fazladan alan yine kabul edilir
     (additionalProperties); doğrulama aracın kendisinde. Her aracın okuduğu
     argüman burada yazılı olmalı: tests/external-review.test.js kaynağı
     tarayıp eksik olanı bulur. */
  function sp(type, description, extra) {
    return Object.assign({ type: type, description: description }, extra || {});
  }
  const ANY = function (description) { return { description: description }; };
  const LAYER_REF = {
    id: sp('string', 'Layer id from sv_list_layers.'),
    layerId: sp('string', 'Same as id.'),
    index: sp('integer', 'Layer index, used when id is not given.', { minimum: 0 }),
  };
  const SCENE_REF = {
    id: sp('string', 'Scene id from sv_list_scenes.'),
    name: sp('string', 'Scene name (exact, case-insensitive), used when id is not given.'),
  };
  const FX_REF = {
    effectId: sp('string', 'Effect id from sv_list_effects.'),
    effectIndex: sp('integer', 'Effect position on the chain, used when effectId is not given.', { minimum: 0 }),
    type: sp('string', 'Effect type, used when exactly one effect of that type is on the chain.'),
  };
  const PATCH = function (what) { return { patch: sp('object', 'Keys of ' + what + ' to change; other keys stay.') }; };
  const OVERWRITE = sp('boolean', 'Replace the file if it already exists. Default false.');
  const MAPPING_KEYS = {
    enabled: sp('boolean', 'Turn mapping on for this display.'),
    corners: ANY('Corner pin points.'), crop: ANY('Crop rectangle.'), edges: ANY('Edge blend settings.'),
    masks: ANY('Mask shapes.'), testPattern: ANY('Show the test pattern.'), mesh: ANY('Warp mesh.'), color: ANY('Color correction.'),
  };
  const SCHEMAS = {
    sv_get_scene: { props: SCENE_REF },
    sv_get_layer: { props: LAYER_REF },
    sv_get_config: { props: { path: sp('string', 'Dotted config path such as visualizer.sensitivity. Omit for the whole config.') } },
    sv_list_permissions: { props: { tool: sp('string', 'Tool name to check.'), name: sp('string', 'Same as tool.') } },
    mcp_permissions: { props: { tool: sp('string', 'Tool name to check.'), name: sp('string', 'Same as tool.') } },
    sv_apply_scene: { props: SCENE_REF },
    sv_set_visualizer_type: { props: { type: sp('string', 'Visualizer mode id from sv_list_modes.'), presetId: sp('string', 'Studio preset id when type is custom.') }, required: ['type'] },
    sv_set_background_type: { props: { type: sp('string', 'Background mode id from sv_list_modes.') }, required: ['type'] },
    sv_set_layer_enabled: { props: Object.assign({}, LAYER_REF, { enabled: sp('boolean', 'false hides the layer. Default true.') }) },
    sv_set_crossfade: { props: { value: sp('number', 'Crossfader position.', { minimum: 0, maximum: 1 }) }, required: ['value'] },
    sv_apply_template: { props: { id: sp('string', 'Template id.'), name: sp('string', 'Template name, used when id is not given.') } },
    sv_timeline_transport: { props: { action: sp('string', 'Transport action.', { enum: ['play', 'pause', 'stop', 'seek'] }), time: sp('number', 'Seconds, for seek.', { minimum: 0 }) }, required: ['action'] },
    sv_trigger_clip: { props: { row: sp('integer', 'Slot row from 0.', { minimum: 0 }), col: sp('integer', 'Slot column from 0.', { minimum: 0 }) }, required: ['row', 'col'] },
    sv_set_autovj: {
      props: {
        enabled: sp('boolean', 'Turn Auto VJ on or off.'),
        source: sp('string', 'What Auto VJ walks.', { enum: ['scenes', 'visualizers', 'palettes', 'all'] }),
        interval: sp('number', 'Steps between switches (bars or seconds).', { minimum: 1, maximum: 64 }),
        unit: sp('string', 'Interval unit.', { enum: ['bars', 'seconds'] }),
        order: sp('string', 'Switch order.', { enum: ['sequential', 'random'] }),
        bpmLock: sp('number', 'Fixed BPM; 0 follows the detected tempo.', { minimum: 0, maximum: 200 }),
        paletteSource: sp('string', 'Which palettes to use.', { enum: ['both', 'builtin', 'user'] }),
        visualizerTargets: sp('string', 'Which visualizer layers change.', { enum: ['all', 'first'] }),
      },
    },
    sv_create_scene: { props: { name: sp('string', 'Scene name. Default "Scene N".') } },
    sv_update_scene: { props: SCENE_REF },
    sv_rename_scene: { props: { id: sp('string', 'Scene id.'), name: sp('string', 'Current scene name, used when id is not given.'), newName: sp('string', 'New scene name.') } },
    sv_delete_scene: { props: SCENE_REF },
    sv_add_layer: {
      props: {
        kind: sp('string', 'Layer kind: background, visualizer, media, sprites, logo or nowplaying. Default visualizer.'),
        type: sp('string', 'Mode id for background and visualizer layers (sv_list_modes).'),
        name: sp('string', 'Layer name.'),
        settings: sp('object', 'Layer setting overrides.'),
        transform: sp('object', 'x and y (-1..1), scale (0.2..3), rotate (-180..180), flipX, flipY.'),
        opacity: sp('number', 'Opacity.', { minimum: 0, maximum: 1 }),
        blend: sp('string', 'Blend mode (sv_list_modes blendModes).'),
        layer: sp('object', 'A whole layer object; the fields above override it.'),
      },
    },
    sv_update_layer: {
      props: Object.assign({}, LAYER_REF, {
        patch: sp('object', 'Fields to change: name, kind, type, enabled, opacity (0..1), blend, solo, muted, locked, group, presetId, transform, settings, audio, mask.'),
      }),
      required: ['patch'],
    },
    sv_set_layer_position: {
      props: Object.assign({}, LAYER_REF, {
        x: sp('number', 'Horizontal offset, share of the canvas.', { minimum: -1, maximum: 1 }),
        y: sp('number', 'Vertical offset, share of the canvas.', { minimum: -1, maximum: 1 }),
        scale: sp('number', 'Scale.', { minimum: 0.2, maximum: 3 }),
        rotate: sp('number', 'Rotation in degrees.', { minimum: -180, maximum: 180 }),
        flipX: sp('boolean', 'Mirror horizontally.'),
        flipY: sp('boolean', 'Mirror vertically.'),
      }),
    },
    sv_set_layer_settings: { props: Object.assign({}, LAYER_REF, { settings: sp('object', 'Settings to merge.'), key: sp('string', 'One setting key, with value.'), value: ANY('Value for key.') }) },
    sv_remove_layer: { props: LAYER_REF },
    sv_reorder_layers: { props: { ids: sp('array', 'Layer ids in the new order; missing ones keep their order after these.', { items: { type: 'string' } }) }, required: ['ids'] },
    sv_set_text: { props: PATCH('the text overlay (sv_get_config path text)'), required: ['patch'] },
    sv_set_logo: { props: PATCH('the logo (sv_get_config path logo)'), required: ['patch'] },
    sv_set_media: { props: PATCH('the media layer (sv_get_config path media)'), required: ['patch'] },
    sv_set_geometry: { props: PATCH('geometry (sv_get_config path geometry)'), required: ['patch'] },
    sv_set_effect_enabled: { props: Object.assign({}, FX_REF, { enabled: sp('boolean', 'false turns the effect off. Default true.') }) },
    sv_set_effect_param: { props: Object.assign({}, FX_REF, { params: sp('object', 'Parameters to merge.') }), required: ['params'] },
    sv_set_layer_effect_enabled: { props: Object.assign({}, LAYER_REF, FX_REF, { enabled: sp('boolean', 'false turns the effect off. Default true.') }) },
    sv_set_layer_effect_param: { props: Object.assign({}, LAYER_REF, FX_REF, { params: sp('object', 'Parameters to merge.') }), required: ['params'] },
    sv_set_modulation_enabled: { props: { enabled: sp('boolean', 'false turns the matrix off. Default true.') } },
    sv_set_macro: { props: { index: sp('integer', 'Macro index from 0.', { minimum: 0 }), value: sp('number', 'Macro value.', { minimum: 0, maximum: 1 }) }, required: ['index', 'value'] },
    sv_add_effect: { props: { type: sp('string', 'Effect type.', { enum: EFFECT_TYPES.slice() }), params: sp('object', 'Effect parameters.'), enabled: sp('boolean', 'Default true.') }, required: ['type'] },
    sv_remove_effect: { props: FX_REF },
    sv_add_layer_effect: { props: Object.assign({}, LAYER_REF, { type: sp('string', 'Effect type.', { enum: EFFECT_TYPES.slice() }), params: sp('object', 'Effect parameters.'), enabled: sp('boolean', 'Default true.') }), required: ['type'] },
    sv_remove_layer_effect: { props: Object.assign({}, LAYER_REF, FX_REF) },
    sv_add_modulation_route: {
      props: {
        source: sp('string', 'Source id: bass, mid, treble, level, onset, band0..7, lfo1.., env1.., macro1..8, an* analysis values.'),
        target: sp('string', 'Existing numeric config path, e.g. visualizer.sensitivity or layers.0.opacity.'),
        mode: sp('string', 'How the value is applied.', { enum: ['set', 'add', 'mul'] }),
        curve: sp('string', 'Response curve, e.g. linear, exp, log, scurve.'),
        min: sp('number', 'Output at source 0.'), max: sp('number', 'Output at source 1.'),
        amount: sp('number', 'Depth.'), smooth: sp('number', 'Smoothing.'), steps: sp('number', 'Quantize steps; 0 is off.'),
        invert: sp('boolean', 'Invert the source.'), enabled: sp('boolean', 'Default true.'),
        route: sp('object', 'The whole route as one object, instead of the fields above.'),
      },
      required: ['source', 'target'],
    },
    sv_remove_modulation_route: { props: { id: sp('string', 'Route id.'), index: sp('integer', 'Route index, used when id is not given.', { minimum: 0 }) } },
    sv_load_preset: { props: { id: sp('string', 'Library preset id from sv_list_presets.') }, required: ['id'] },
    sv_apply_color_preset: { props: { id: sp('string', 'Color preset id.'), name: sp('string', 'Color preset name, used when id is not given.') } },
    sv_set_milkdrop_cycle: {
      props: {
        autoNext: sp('number', 'Seconds or bars between presets; 0 is off.', { minimum: 0 }),
        autoOrder: sp('string', 'sequential or random.'),
        autoFrom: sp('string', 'Which presets to cycle, e.g. all, favorites or a tag.'),
        autoTag: sp('string', 'Tag when autoFrom uses tags.'),
        autoNextUnit: sp('string', 'seconds or bars.'),
        autoNextBars: sp('number', 'Bars between presets when the unit is bars.', { minimum: 1 }),
        trackAdvance: sp('boolean', 'Next preset when the track changes.'),
        hardCut: sp('string', 'Hard cut mode; off disables it.'),
      },
    },
    sv_save_preset: {
      props: {
        id: sp('string', 'Preset id to overwrite; letters, digits, _ and -. Omit for a new preset.'),
        name: sp('string', 'Preset name.'),
        kind: sp('string', 'Preset kind. Default visualizer when shader is given, otherwise milkdrop.', { enum: ['visualizer', 'background', 'milkdrop'] }),
        engine: sp('string', 'Studio engine for visualizer and background kinds; glsl, shadertoy, isf and frag mean shader.', { enum: ['shader', 'variation'] }),
        shader: sp('string', 'GLSL code (engine shader).'),
        controls: sp('array', 'Shader uniforms: { name, label, type, min, max, step, default }.'),
        base: sp('string', 'Base mode id (engine variation).'),
        overrides: sp('object', 'Config parts the variation applies (engine variation).'),
        source: sp('string', 'MilkDrop preset text (kind milkdrop).'),
        description: sp('string', 'Description.'), author: sp('string', 'Author.'),
        tags: sp('array', 'Tags.', { items: { type: 'string' } }),
      },
    },
    sv_delete_preset: { props: { id: sp('string', 'Preset id.') }, required: ['id'] },
    sv_set_milkdrop_source: { props: { source: sp('string', 'MilkDrop preset text.'), name: sp('string', 'Shown name.'), presetId: sp('string', 'Library id this source belongs to.') }, required: ['source'] },
    sv_create_color_preset: { props: { name: sp('string', 'Preset name.'), colors: sp('array', '2 to 5 hex colors (#rrggbb); shorter lists repeat the last color. Omit to save the current gradient.', { items: { type: 'string' } }) } },
    sv_delete_color_preset: { props: { id: sp('string', 'Color preset id.') }, required: ['id'] },
    sv_open_output: { props: { displayIds: sp('array', 'Display ids from sv_list_displays.'), displayId: ANY('One display id.') } },
    sv_close_output: { props: { displayId: ANY('Display id; omit to close all.') } },
    sv_set_displays: { props: { ids: sp('array', 'Display ids from sv_list_displays.') }, required: ['ids'] },
    sv_set_stream: { props: PATCH('stream settings (tokens are ignored)'), required: ['patch'] },
    sv_set_texture_share: { props: PATCH('Spout/Syphon settings'), required: ['patch'] },
    sv_set_aspect: { props: PATCH('aspect settings'), required: ['patch'] },
    sv_set_floating: { props: PATCH('floating window preferences'), required: ['patch'] },
    sv_set_floating_open: { props: { open: sp('boolean', 'true opens, false closes.') }, required: ['open'] },
    sv_set_power: { props: PATCH('power settings: fpsCap, renderScale, keepAwake, hwVideoDecode'), required: ['patch'] },
    sv_set_lighting: { props: PATCH('Dynamic Lighting settings'), required: ['patch'] },
    sv_set_openrgb: { props: PATCH('OpenRGB settings'), required: ['patch'] },
    sv_set_artnet: { props: PATCH('Art-Net/DMX settings'), required: ['patch'] },
    sv_set_window_mode: { props: { transparent: sp('boolean', 'Transparent background.'), coverTaskbar: sp('boolean', 'Cover the taskbar.'), transparentKey: sp('string', 'Key color for transparency.') } },
    sv_start_export: {
      props: {
        audioPath: sp('string', 'Absolute path of the audio file.'),
        outputPath: sp('string', 'Absolute .mp4 path.'),
        resolution: sp('string', 'Video size. Default 1080p.', { enum: ['720p', '1080p', '1440p', '2160p'] }),
        fps: sp('integer', 'Frame rate. Default 60.', { enum: [30, 60] }),
        encoder: sp('string', 'Encoder. Default cpu.', { enum: ['cpu', 'gpu'] }),
        quality: sp('string', 'Quality.', { enum: ['visually-lossless', 'high', 'balanced'] }),
        speed: sp('string', 'Encoder speed. Default balanced.', { enum: ['fast', 'balanced', 'quality'] }),
        overwrite: OVERWRITE,
      },
      required: ['audioPath', 'outputPath'],
    },
    sv_export_json: { props: { path: sp('string', 'Absolute .json path.'), what: sp('string', 'config (default) or scenes. Stream tokens are never written.', { enum: ['config', 'scenes'] }), overwrite: OVERWRITE }, required: ['path'] },
    sv_save_snapshot: { props: { path: sp('string', 'Absolute .jpg or .jpeg path.'), overwrite: OVERWRITE }, required: ['path'] },
    sv_set_blackout: { props: { state: sp('string', 'Blackout state.', { enum: ['on', 'off', 'toggle'] }), on: sp('boolean', 'Same as state on/off.') } },
    sv_set_blackout_transition: { props: { type: sp('string', 'crossfade, cut or dissolve.'), duration: sp('number', 'Seconds.', { minimum: 0 }) } },
    sv_patch_config: { props: { path: sp('string', 'Dotted config path; list items by index (layers.0.opacity). The top key must exist.'), value: ANY('New value.') }, required: ['path', 'value'] },
    sv_set_audio_sources: { props: { sources: sp('array', 'Audio sources (sv_list_audio_sources shape).') }, required: ['sources'] },
    sv_set_mapping: { props: Object.assign({ displayId: ANY('Display id.'), id: ANY('Same as displayId.') }, MAPPING_KEYS) },
    sv_rotate_stream_token: { props: { which: sp('string', 'remote rotates the remote-control token; anything else the OBS/web token.', { enum: ['token', 'remote'] }) } },
  };
  // Tanıdığı hiçbir argüman verilmezse reddeden ayar araçları (bkz. callTool)
  const STRICT_ARGS = ['sv_set_autovj'];
  function schemaFor(name) {
    const s = SCHEMAS[name];
    const out = { type: 'object', properties: {}, additionalProperties: true };
    if (!s) return out;
    out.properties = s.props;
    if (s.required && s.required.length) out.required = s.required.slice();
    return out;
  }
  function tool(name, group, description, fn) {
    TOOLS.push({
      name: name, group: group, description: description, fn: fn,
      inputSchema: schemaFor(name),
    });
  }

  function audioState(cfg, ctx) {
    const live = (ctx.live && ctx.live()) || {};
    const auto = cfg.autovj || {};
    return {
      bpm: live.bpm || 0,
      bpmSource: live.bpm ? 'live' : (auto.bpmLock > 0 ? 'lock' : 'none'),
      bpmLock: auto.bpmLock || 0,
      confidence: live.confidence || 0,
      level: live.level || 0, bass: live.bass || 0, mid: live.mid || 0, treble: live.treble || 0,
      at: live.at || 0,
    };
  }


  function readSnapshot(ctx) {
    const cfg = configOf(ctx);
    const visual = visualState(cfg, ctx);
    const layers = visual.layers || [];
    const scenes = (Array.isArray(cfg.scenes) ? cfg.scenes : []).map(function (sc) {
      return { id: sc && sc.id || null, name: sc && sc.name || '', active: !!(sc && cfg._activeSceneId && sc.id === cfg._activeSceneId) };
    });
    const globalFx = Array.isArray(cfg.postfx) ? cfg.postfx.map(publicFx) : [];
    const showing = [];
    globalFx.forEach(function (fx) { if (fx.enabled) showing.push({ scope: 'global', type: fx.type, id: fx.id }); });
    layers.forEach(function (layer) {
      (layer.postfx || []).forEach(function (fx) {
        if (fx && fx.enabled !== false) showing.push({ scope: 'layer', layerId: layer.id, type: fx.type || '', id: fx.id || null });
      });
    });
    let displays = null;
    let nowPlaying = null;
    let output = null;
    try { displays = ctx.displays ? ctx.displays() : null; } catch (e) { displays = null; }
    try { nowPlaying = ctx.nowPlaying ? ctx.nowPlaying() : null; } catch (e2) { nowPlaying = null; }
    try { output = ctx.outputStatus ? ctx.outputStatus() : null; } catch (e3) { output = null; }
    const stream = cfg.stream ? { enabled: !!cfg.stream.enabled, port: cfg.stream.port || null, lan: !!cfg.stream.lan } : null;
    const texture = cfg.textureShare ? { enabled: !!cfg.textureShare.enabled, name: cfg.textureShare.name || '' } : null;
    const audioCfg = cfg.audio || {};
    return {
      ok: true,
      revision: revisionOf(ctx),
      permissions: normalizeMcp(cfg.mcp),
      visual: visual,
      activePreset: { milkdrop: visual.milkdrop, id: (cfg.milkdrop && cfg.milkdrop.presetId) || '' },
      scenes: scenes,
      layersOn: layers.filter(function (layer) { return layer.enabled !== false; }),
      effectsShowing: showing,
      displays: displays,
      displayConfig: cfg.display || null,
      audio: audioState(cfg, ctx),
      audioSources: audioCfg.sources || [],
      nowPlaying: nowPlaying,
      stack: { enabled: !!(cfg.layerStack && cfg.layerStack.enabled), layerStack: cfg.layerStack || null, layers: layers },
      stream: stream,
      textureShare: texture,
      output: output,
    };
  }
  tool('sv_get_state', null, 'Read the full show state: preset, effects, scenes, layers, displays, BPM, now playing, analysis, stack, stream, texture share, and audio. Read-only. Changes nothing.', function (args, ctx) {
    const snapState = readSnapshot(ctx);
    if (!ctx.analysis) return Object.assign(snapState, { analysis: null });
    return Promise.resolve(ctx.analysis()).then(function (r) {
      snapState.analysis = r && r.analysis ? r.analysis : (r && r.ok !== false ? r : null);
      return snapState;
    }, function () { snapState.analysis = null; return snapState; });
  });
  tool('sv_get_visual_state', null, 'Read live visual state: layer positions, settings, per-layer effects, global effects, active scene. Read-only.', function (args, ctx) {
    return Object.assign({ ok: true }, visualState(configOf(ctx), ctx));
  });
  tool('sv_get_preview', null, 'Read visual state plus a small JPEG of the live canvas when a window is open. Read-only. Use it between edits.', function (args, ctx) {
    const state = Object.assign({ ok: true }, visualState(configOf(ctx), ctx));
    if (!ctx.capturePreview) {
      state.preview = null;
      state.previewError = 'Live canvas capture is not available in this process.';
      return state;
    }
    return Promise.resolve().then(function () { return ctx.capturePreview(); }).then(function (img) {
      if (!img || img.error || !img.dataUrl) {
        state.preview = null;
        state.previewError = (img && img.error) || 'The preview canvas is not ready.';
        return state;
      }
      state.preview = img;
      return state;
    }).catch(function (e) {
      state.preview = null;
      state.previewError = String((e && e.message) || e);
      return state;
    });
  });
  tool('sv_get_audio', null, 'Read BPM and level/bass/mid/treble. Read-only.', function (args, ctx) {
    return Object.assign({ ok: true, revision: revisionOf(ctx) }, audioState(configOf(ctx), ctx));
  });
  tool('sv_get_now_playing', null, 'Read the current track. Read-only.', function (args, ctx) {
    let track = null;
    try { track = ctx.nowPlaying ? ctx.nowPlaying() : null; } catch (e) { track = null; }
    return { ok: true, nowPlaying: track || null };
  });
  tool('sv_list_scenes', null, 'List saved scenes. Read-only.', function (args, ctx) {
    return { ok: true, scenes: (configOf(ctx).scenes || []).map(function (s) { return { id: s.id, name: s.name, createdAt: s.createdAt || null }; }) };
  });
  tool('sv_get_scene', null, 'Read one saved scene. Read-only.', function (args, ctx) {
    const found = findScene(configOf(ctx), args);
    if (found.error) return fail(found.error);
    if (!found.scene) return fail('Scene not found.');
    return { ok: true, scene: { id: found.scene.id, name: found.scene.name, data: summarize(found.scene.data) } };
  });
  tool('sv_list_layers', null, 'List layers with position, settings, and effects. Read-only.', function (args, ctx) {
    return { ok: true, layers: (configOf(ctx).layers || []).map(publicLayer) };
  });
  tool('sv_get_layer', null, 'Read one layer. Read-only.', function (args, ctx) {
    const found = findLayer(configOf(ctx), args);
    if (!found) return fail('Layer not found.');
    return { ok: true, layer: publicLayer(found.layer, found.index) };
  });
  tool('sv_list_effects', null, 'List global and per-layer effects plus the built-in type catalog. Read-only.', function (args, ctx) {
    const cfg = configOf(ctx);
    return {
      ok: true,
      catalog: EFFECT_TYPES.slice(),
      global: (cfg.postfx || []).map(publicFx),
      layers: (cfg.layers || []).map(function (layer, index) {
        return { id: layer.id, index: index, postfx: (layer.postfx || []).map(publicFx) };
      }),
    };
  });
  tool('sv_list_modes', null, 'List every visualizer and background mode id, the layer kinds and blend modes. Read-only.', function () {
    const C = catalogApi();
    const L = layersApi();
    const rows = function (kind) {
      if (!C || !C.ids) return [];
      const layerIds = layerTypeIds(kind) || [];
      return C.ids(kind).map(function (id) {
        const m = C.get(kind, id) || {};
        return { id: id, label: m.label || id, group: m.group || '', layer: layerIds.indexOf(id) >= 0 };
      });
    };
    return {
      ok: true,
      visualizers: rows('visualizer'),
      backgrounds: rows('background'),
      layerKinds: (L && Array.isArray(L.KINDS)) ? L.KINDS.slice() : [],
      blendModes: (L && Array.isArray(L.BLEND_MODES)) ? L.BLEND_MODES.slice() : [],
      effects: EFFECT_TYPES.slice(),
    };
  });
  tool('sv_list_presets', null, 'List library presets and user color presets. Read-only.', function (args, ctx) {
    const cfg = configOf(ctx);
    return {
      ok: true,
      library: presetRecords(ctx).map(function (p) { return { id: p.id, name: p.name || '', kind: p.kind || '' }; }),
      colors: (cfg.userPresets || []).map(function (p) { return { id: p.id, name: p.name || '', colors: p.colors || [] }; }),
    };
  });
  tool('sv_list_displays', null, 'List displays. Read-only.', function (args, ctx) {
    let displays = [];
    try { displays = ctx.displays ? ctx.displays() : []; } catch (e) { displays = []; }
    return { ok: true, displays: displays || [] };
  });
  tool('sv_get_output_status', null, 'Read visualizer and stream status. Read-only. Stream tokens are not included.', function (args, ctx) {
    let status = null;
    try { status = ctx.outputStatus ? ctx.outputStatus() : null; } catch (e) { status = null; }
    const cfg = configOf(ctx);
    return {
      ok: true,
      status: status,
      display: cfg.display || null,
      displays: (function () { try { return ctx.displays ? ctx.displays() : null; } catch (e) { return null; } })(),
      stream: cfg.stream ? { enabled: !!cfg.stream.enabled, port: cfg.stream.port, lan: !!cfg.stream.lan } : null,
      textureShare: cfg.textureShare ? { enabled: !!cfg.textureShare.enabled, name: cfg.textureShare.name || '' } : null,
      audioSources: (cfg.audio && cfg.audio.sources) || [],
    };
  });
  tool('sv_get_config', null, 'Read config or one dotted path. Stream tokens are redacted. Read-only.', function (args, ctx) {
    const cfg = redactSecrets(clone(configOf(ctx)) || {});
    if (args && args.path) return { ok: true, path: args.path, value: summarize(getPath(cfg, args.path)) };
    return { ok: true, config: summarize(cfg) };
  });
  tool('sv_list_permissions', null, 'Report the current MCP mode and the minimum mode a tool needs. Do not change the mode yourself. Do not click the admin UI. Tell the user and stop.', function (args, ctx) {
    return permissionReport(args, ctx);
  });
  tool('sv_get_timeline', null, 'Read timeline data. Read-only.', function (args, ctx) {
    return { ok: true, timeline: summarize(configOf(ctx).timeline || null) };
  });
  tool('sv_get_clipdeck', null, 'Read clip deck slots. Read-only.', function (args, ctx) {
    return { ok: true, clipdeck: summarize(configOf(ctx).clipdeck || null) };
  });
  tool('sv_get_autovj', null, 'Read Auto VJ settings. Read-only.', function (args, ctx) {
    return { ok: true, autovj: configOf(ctx).autovj || null };
  });

  tool('sv_apply_scene', 'sceneApply', 'Switch to an existing scene by id or name. Does not create or edit scene contents.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      const found = findScene(cfg, args);
      if (found.error) return fail(found.error);
      if (!found.scene || !found.scene.data) return fail('Scene not found.');
      applySceneData(cfg, found.scene.data);
      cfg._activeSceneId = found.scene.id;
      return { sceneId: found.scene.id, name: found.scene.name, visual: visualState(cfg, ctx) };
    });
  });
  tool('sv_set_visualizer_type', 'sceneApply', 'Switch the visualizer to an existing mode id and show it on the live stack.', function (args, ctx) {
    if (!args || !args.type) return fail('type is required.');
    const wrong = badMode('visualizer', args.type);
    if (wrong) return fail(wrong);
    return withConfig(ctx, function (cfg) {
      const spec = { type: String(args.type) };
      if (args.presetId != null) spec.presetId = args.presetId;
      const L = layersApi();
      if (L && L.adoptVisualizer) L.adoptVisualizer(cfg, spec);
      else cfg.visualizer = Object.assign({}, cfg.visualizer, { type: spec.type });
      // Studio kimliği yalnız tür 'custom' iken anlamlı; eskiden bars için de eski kimlik dönüyordu
      return { type: cfg.visualizer.type, presetId: cfg.visualizer.type === 'custom' ? ((cfg.custom && cfg.custom.visualizerId) || null) : null };
    });
  });
  tool('sv_set_background_type', 'sceneApply', 'Switch the background to an existing mode id.', function (args, ctx) {
    if (!args || !args.type) return fail('type is required.');
    const wrong = badMode('background', args.type);
    if (wrong) return fail(wrong);
    return withConfig(ctx, function (cfg) {
      // Yığın açıkken ilk arkaplan katmanı (sv_set_visualizer_type ile aynı kural)
      const L = layersApi();
      if (L && L.adoptBackground) L.adoptBackground(cfg, { type: String(args.type) });
      else cfg.background = Object.assign({}, cfg.background, { type: String(args.type) });
      return { type: cfg.background.type };
    });
  });
  tool('sv_set_layer_enabled', 'sceneApply', 'Show or hide an existing layer and turn the layer stack on. Does not change layer contents.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      const found = findLayer(cfg, args);
      if (!found) return fail('Layer not found.');
      ensureLayers(cfg);
      found.layer.enabled = !(args && args.enabled === false);
      if (found.layer.enabled) {
        const L = layersApi();
        if (L && L.revealLayer) L.revealLayer(cfg, found.layer);
        else found.layer.muted = false;
      }
      return { layer: publicLayer(found.layer, found.index) };
    });
  });
  tool('sv_set_crossfade', 'sceneApply', 'Move the existing A/B crossfader (0..1).', function (args, ctx) {
    const value = Number(args && args.value);
    if (!isFinite(value)) return fail('value is required.');
    return withConfig(ctx, function (cfg) {
      cfg.crossfade = Object.assign({ enabled: true, value: 0 }, cfg.crossfade, { value: Math.max(0, Math.min(1, value)) });
      return { crossfade: cfg.crossfade };
    });
  });
  tool('sv_apply_template', 'sceneApply', 'Apply an existing built-in template by id.', function (args, ctx) {
    const T = templatesApi();
    const SV = defaultsApi();
    if (!T || !SV) return fail('Template library is not available.');
    const id = args && (args.id || args.name);
    const tpl = (T.TEMPLATES || []).find(function (t) { return t && (t.id === id || t.name === id); });
    if (!tpl) return fail('Template not found.');
    return withConfig(ctx, function (cfg) {
      const next = T.apply(clone(cfg), tpl, { defaultConfig: SV.defaultConfig, deepMerge: SV.deepMerge, clone: SV.clone });
      for (const k of Object.keys(cfg)) delete cfg[k];
      Object.assign(cfg, next);
      return { templateId: tpl.id, visual: visualState(cfg, ctx) };
    });
  });
  tool('sv_timeline_transport', 'timeline', 'Play, pause, stop, or seek the existing timeline via the admin transport.', function (args, ctx) {
    if (!ctx.timeline) return fail('Timeline transport is not available. Keep the admin window open.');
    return Promise.resolve(ctx.timeline(args && args.action, args && args.time)).then(function (r) {
      return r && r.ok === false ? r : Object.assign({ ok: true }, r || {});
    });
  });
  tool('sv_trigger_clip', 'sceneApply', 'Fire an existing clip-deck slot. Does not edit the grid.', function (args, ctx) {
    if (!ctx.launchClip) return fail('Clip deck is not available. Keep the admin window open.');
    const row = Number(args && args.row);
    const col = Number(args && args.col);
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) return fail('row and col must be whole numbers from 0.');
    return Promise.resolve(ctx.launchClip({ row: row, col: col })).then(function (r) {
      return r && r.ok === false ? r : Object.assign({ ok: true }, r || {});
    });
  });
  tool('sv_stop_clips', 'sceneApply', 'Stop every playing clip-deck slot. Does not edit the grid.', function (args, ctx) {
    if (!ctx.stopClips) return fail('Clip deck is not available. Keep the admin window open.');
    return Promise.resolve(ctx.stopClips()).then(function (r) {
      return r && r.ok === false ? r : Object.assign({ ok: true }, r || {});
    });
  });
  /* Otomatik VJ seçenekleri panelin sunduklarıyla aynı; aralık ve BPM
     kilidi panelin kaydırıcı aralığına çekilir. Eskiden `interval:-3`
     olduğu gibi yazılıyordu. */
  const AUTOVJ_ENUMS = {
    source: ['scenes', 'visualizers', 'palettes', 'all'],
    unit: ['bars', 'seconds'],
    order: ['sequential', 'random'],
    paletteSource: ['both', 'builtin', 'user'],
    visualizerTargets: ['all', 'first'],
  };
  const AUTOVJ_RANGES = { interval: [1, 64], bpmLock: [0, 200] };
  function autovjError(args) {
    if (args.enabled !== undefined && typeof args.enabled !== 'boolean') return 'enabled must be true or false.';
    for (const k of Object.keys(AUTOVJ_ENUMS)) {
      if (args[k] !== undefined && AUTOVJ_ENUMS[k].indexOf(args[k]) < 0) return k + ' must be one of: ' + AUTOVJ_ENUMS[k].join(', ') + '.';
    }
    for (const k of Object.keys(AUTOVJ_RANGES)) {
      if (args[k] !== undefined && !finite(args[k])) return k + ' must be a number.';
    }
    return '';
  }
  tool('sv_set_autovj', 'autovj', 'Turn Auto VJ on or off and choose how it walks existing scenes, modes, or palettes.', function (args, ctx) {
    const bad = autovjError(args || {});
    if (bad) return fail(bad);
    return withConfig(ctx, function (cfg) {
      const next = Object.assign({ enabled: false, source: 'visualizers', unit: 'bars', interval: 8, order: 'sequential', bpmLock: 0 }, cfg.autovj);
      ['enabled', 'source', 'interval', 'unit', 'order', 'bpmLock', 'paletteSource', 'visualizerTargets'].forEach(function (k) {
        if (args && args[k] !== undefined) next[k] = args[k];
      });
      Object.keys(AUTOVJ_RANGES).forEach(function (k) {
        const r = AUTOVJ_RANGES[k];
        if (args && args[k] !== undefined) next[k] = Math.round(Math.max(r[0], Math.min(r[1], args[k])));
      });
      cfg.autovj = next;
      return { autovj: next };
    });
  });

  tool('sv_create_scene', 'sceneEdit', 'Create a scene from the current visuals. Authoring.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      if (!Array.isArray(cfg.scenes)) cfg.scenes = [];
      const scene = { id: uid('sc_'), name: (args && args.name) || ('Scene ' + (cfg.scenes.length + 1)), createdAt: Date.now(), data: snapshotScene(cfg) };
      cfg.scenes.push(scene);
      cfg._activeSceneId = scene.id;
      return { scene: { id: scene.id, name: scene.name } };
    });
  });
  tool('sv_update_scene', 'sceneEdit', 'Overwrite an existing scene with the current visuals. Authoring.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      const found = findScene(cfg, args);
      if (found.error) return fail(found.error);
      if (!found.scene) return fail('Scene not found.');
      found.scene.data = snapshotScene(cfg);
      cfg._activeSceneId = found.scene.id;
      return { sceneId: found.scene.id };
    });
  });
  /* Yeni ad `newName`; sahne `id` ya da şimdiki adıyla (`name`) bulunur.
     Eskiden `name` hem arama hem yeni addı: yalnız id ile çalışıyordu.
     Eski çağrı biçimi (id + name) aynen çalışır. */
  tool('sv_rename_scene', 'sceneEdit', 'Rename a scene. Find it by id or by its current name, give the new name as newName. The old form id + name still works. Authoring.', function (args, ctx) {
    if (!args) return fail('newName is required.');
    const hasNew = args.newName != null && String(args.newName).trim() !== '';
    if (!hasNew && !(args.id && args.name)) return fail('newName is required. Find the scene by id or by its current name.');
    const next = String(hasNew ? args.newName : args.name).trim();
    if (!next) return fail('newName is required.');
    return withConfig(ctx, function (cfg) {
      const found = hasNew ? findScene(cfg, args) : findScene(cfg, { id: args.id });
      if (found.error) return fail(found.error);
      if (!found.scene) return fail('Scene not found.');
      found.scene.name = next;
      return { sceneId: found.scene.id, name: found.scene.name };
    });
  });
  tool('sv_delete_scene', 'sceneEdit', 'Delete a scene. Authoring.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      const found = findScene(cfg, args);
      if (!found.scene) return fail('Scene not found.');
      cfg.scenes = found.list.filter(function (s) { return s !== found.scene; });
      if (cfg._activeSceneId === found.scene.id) cfg._activeSceneId = null;
      return { deleted: found.scene.id };
    });
  });
  tool('sv_add_layer', 'sceneEdit', 'Add a layer and turn the layer stack on. Authoring.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      const list = ensureLayers(cfg);
      const raw = Object.assign({}, (args && args.layer) || {});
      if (args && args.kind) raw.kind = args.kind;
      if (args && args.type) raw.type = args.type;
      if (args && args.name) raw.name = args.name;
      if (args && args.settings) raw.settings = args.settings;
      if (args && args.transform) raw.transform = args.transform;
      if (args && args.opacity !== undefined) raw.opacity = args.opacity;
      if (args && args.blend !== undefined) raw.blend = args.blend;
      const kind = raw.kind == null ? 'visualizer' : raw.kind;
      const wrong = badLayer(kind, raw.type) || badBlend(raw.blend) || layerFieldError(raw);
      if (wrong) return fail(wrong);
      if (raw.transform !== undefined) {
        const t = cleanTransform(raw.transform);
        if (t.error) return fail(t.error);
        raw.transform = t.value;
      }
      if (raw.opacity !== undefined) raw.opacity = Math.max(0, Math.min(1, raw.opacity));
      const layer = normalizeLayer(layerStart(raw));
      list.push(layer);
      return { layer: publicLayer(layer, list.length - 1), visual: visualState(cfg, ctx) };
    });
  });
  tool('sv_update_layer', 'sceneEdit', 'Change layer name, type, opacity, blend, transform, or settings. Does not add effects. Authoring.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      const found = findLayer(cfg, args);
      if (!found) return fail('Layer not found.');
      const patch = Object.assign({}, (args && args.patch) || {});
      if (patch.postfx) return fail('Layer effects are changed with the effect tools, not sv_update_layer.');
      if (lockBlocksPatch(found.layer, patch)) return fail(lockedError(found.layer));
      const fieldBad = layerFieldError(patch);
      if (fieldBad) return fail(fieldBad);
      let transform = null;
      if (patch.transform !== undefined) {
        const t = cleanTransform(patch.transform);
        if (t.error) return fail(t.error);
        transform = t.value;
      }
      if (patch.kind !== undefined || patch.type !== undefined || patch.blend !== undefined) {
        const kind = patch.kind !== undefined ? patch.kind : found.layer.kind;
        const typeChanges = patch.type !== undefined || patch.kind !== undefined;
        const type = patch.type !== undefined ? patch.type : found.layer.type;
        const wrong = badLayer(kind, typeChanges ? type : null) || badBlend(patch.blend);
        if (wrong) return fail(wrong);
      }
      ['name', 'kind', 'type', 'enabled', 'opacity', 'blend', 'solo', 'muted', 'locked', 'group', 'presetId'].forEach(function (k) {
        if (patch[k] !== undefined) found.layer[k] = patch[k];
      });
      if (patch.opacity !== undefined) found.layer.opacity = Math.max(0, Math.min(1, patch.opacity));
      if (transform) found.layer.transform = mergeObj(found.layer.transform, transform);
      if (patch.settings) found.layer.settings = mergeObj(found.layer.settings, patch.settings);
      if (patch.audio) found.layer.audio = mergeObj(found.layer.audio, patch.audio);
      if (patch.mask) found.layer.mask = mergeObj(found.layer.mask, patch.mask);
      if (found.layer.enabled !== false && (patch.type !== undefined || patch.presetId !== undefined || patch.kind !== undefined)) {
        const L = layersApi();
        if (L && L.revealLayer) L.revealLayer(cfg, found.layer);
      }
      return { layer: publicLayer(found.layer, found.index), visual: visualState(cfg, ctx) };
    });
  });
  tool('sv_set_layer_position', 'sceneEdit', 'Set layer x, y, scale, and rotate. Authoring.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      const found = findLayer(cfg, args);
      if (!found) return fail('Layer not found.');
      if (found.layer.locked) return fail(lockedError(found.layer));
      const given = {};
      ['x', 'y', 'scale', 'rotate', 'flipX', 'flipY'].forEach(function (k) {
        if (args && args[k] !== undefined) given[k] = args[k];
      });
      const clean = cleanTransform(given);
      if (clean.error) return fail(clean.error);
      found.layer.transform = Object.assign({ scale: 1, rotate: 0, x: 0, y: 0, flipX: false, flipY: false }, found.layer.transform, clean.value);
      return { layer: publicLayer(found.layer, found.index), visual: visualState(cfg, ctx) };
    });
  });
  tool('sv_set_layer_settings', 'sceneEdit', 'Merge settings on an existing layer. Authoring.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      const found = findLayer(cfg, args);
      if (!found) return fail('Layer not found.');
      if (found.layer.locked) return fail(lockedError(found.layer));
      if (args && args.settings && typeof args.settings === 'object') found.layer.settings = mergeObj(found.layer.settings, args.settings);
      else if (args && args.key) {
        if (unsafeKey(args.key)) return fail('Refusing unsafe settings key.');
        const settings = Object.assign({}, found.layer.settings);
        settings[args.key] = args.value;
        found.layer.settings = settings;
      } else return fail('settings or key is required.');
      return { layer: publicLayer(found.layer, found.index) };
    });
  });
  tool('sv_remove_layer', 'sceneEdit', 'Remove a layer. Authoring.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      const found = findLayer(cfg, args);
      if (!found) return fail('Layer not found.');
      if (found.layer.locked) return fail(lockedError(found.layer));
      found.list.splice(found.index, 1);
      return { removed: found.layer.id, visual: visualState(cfg, ctx) };
    });
  });
  tool('sv_reorder_layers', 'sceneEdit', 'Reorder layers by id list. Authoring.', function (args, ctx) {
    const ids = args && args.ids;
    if (!Array.isArray(ids)) return fail('ids array is required.');
    return withConfig(ctx, function (cfg) {
      const list = Array.isArray(cfg.layers) ? cfg.layers : [];
      const map = {};
      list.forEach(function (layer) { if (layer && layer.id) map[layer.id] = layer; });
      const next = [];
      ids.forEach(function (id) { if (map[id]) { next.push(map[id]); delete map[id]; } });
      list.forEach(function (layer) { if (layer && layer.id && map[layer.id]) next.push(layer); });
      // Kilitli katman yerinden oynamaz (paneldeki oklar gibi)
      for (let i = 0; i < list.length; i++) {
        if (list[i] && list[i].locked && next[i] !== list[i]) return fail(lockedError(list[i]));
      }
      cfg.layers = next;
      return { layers: next.map(publicLayer) };
    });
  });
  tool('sv_set_text', 'sceneEdit', 'Edit the text overlay, including a lyrics or now-playing source. Authoring.', function (args, ctx) {
    const bad = sectionPatchError('text', (args && args.patch) || {});
    if (bad) return fail(bad);
    return withConfig(ctx, function (cfg) { cfg.text = mergeObj(cfg.text || {}, args.patch); return { text: summarize(cfg.text) }; });
  });
  tool('sv_set_logo', 'sceneEdit', 'Edit logo settings. Authoring.', function (args, ctx) {
    const bad = sectionPatchError('logo', (args && args.patch) || {});
    if (bad) return fail(bad);
    return withConfig(ctx, function (cfg) { cfg.logo = mergeObj(cfg.logo || {}, args.patch); return { logo: summarize(cfg.logo) }; });
  });
  tool('sv_set_media', 'sceneEdit', 'Edit media-layer settings. Authoring.', function (args, ctx) {
    const bad = sectionPatchError('media', (args && args.patch) || {});
    if (bad) return fail(bad);
    return withConfig(ctx, function (cfg) { cfg.media = mergeObj(cfg.media || {}, args.patch); return { media: summarize(cfg.media) }; });
  });
  tool('sv_set_geometry', 'sceneEdit', 'Edit geometry settings. Authoring.', function (args, ctx) {
    const bad = sectionPatchError('geometry', (args && args.patch) || {});
    if (bad) return fail(bad);
    return withConfig(ctx, function (cfg) { cfg.geometry = mergeObj(cfg.geometry || {}, args.patch); return { geometry: summarize(cfg.geometry) }; });
  });

  tool('sv_set_effect_enabled', 'effectApply', 'Enable or disable an effect already on the global chain.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      const found = findFx(cfg.postfx, args);
      if (!found || found.error) return fail((found && found.error) || 'Effect not found.');
      found.fx.enabled = !(args && args.enabled === false);
      return { effect: publicFx(found.fx, found.index) };
    });
  });
  tool('sv_set_effect_param', 'effectApply', 'Change parameters of a global effect that already exists.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      const found = findFx(cfg.postfx, args);
      if (!found || found.error) return fail((found && found.error) || 'Effect not found.');
      found.fx.params = mergeObj(found.fx.params, (args && args.params) || {});
      return { effect: publicFx(found.fx, found.index) };
    });
  });
  tool('sv_set_layer_effect_enabled', 'effectApply', 'Enable or disable an effect already on a layer.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      const layer = findLayer(cfg, args);
      if (!layer) return fail('Layer not found.');
      if (layer.layer.locked) return fail(lockedError(layer.layer));
      const found = findFx(layer.layer.postfx, args);
      if (!found || found.error) return fail((found && found.error) || 'Layer effect not found.');
      found.fx.enabled = !(args && args.enabled === false);
      return { layerId: layer.layer.id, effect: publicFx(found.fx, found.index) };
    });
  });
  tool('sv_set_layer_effect_param', 'effectApply', 'Change parameters of an effect already on a layer.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      const layer = findLayer(cfg, args);
      if (!layer) return fail('Layer not found.');
      if (layer.layer.locked) return fail(lockedError(layer.layer));
      const found = findFx(layer.layer.postfx, args);
      if (!found || found.error) return fail((found && found.error) || 'Layer effect not found.');
      found.fx.params = mergeObj(found.fx.params, (args && args.params) || {});
      return { layerId: layer.layer.id, effect: publicFx(found.fx, found.index), visual: visualState(cfg, ctx) };
    });
  });
  tool('sv_set_modulation_enabled', 'effectApply', 'Turn the modulation matrix on or off without editing routes.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      cfg.modulation = Object.assign({}, cfg.modulation, { enabled: !(args && args.enabled === false) });
      return { enabled: cfg.modulation.enabled };
    });
  });
  tool('sv_set_macro', 'effectApply', 'Set an existing macro fader.', function (args, ctx) {
    const index = Number(args && args.index);
    if (!isFinite(index)) return fail('index is required.');
    return withConfig(ctx, function (cfg) {
      const macros = cfg.modulation && cfg.modulation.macros;
      if (!macros || !macros[index]) return fail('Macro not found.');
      macros[index].value = Number(args.value) || 0;
      return { index: index, value: macros[index].value };
    });
  });
  /* Bilinmeyen efekt eskiden `knownType:false` ile yine ekleniyordu;
     zincirde hiçbir şey yapmayan bir halka kalıyordu. EFFECT_TYPES
     motorun listesiyle aynı (mcp-coverage testi). */
  function badEffect(type) {
    return EFFECT_TYPES.indexOf(type) < 0 ? 'Unknown effect type "' + type + '". Known types: ' + EFFECT_TYPES.join(', ') + '.' : '';
  }
  tool('sv_add_effect', 'effectEdit', 'Add an effect to the global chain. Authoring.', function (args, ctx) {
    if (!args || !args.type) return fail('type is required.');
    if (badEffect(args.type)) return fail(badEffect(args.type));
    return withConfig(ctx, function (cfg) {
      if (!Array.isArray(cfg.postfx)) cfg.postfx = [];
      const fx = normalizeFx({ type: args.type, params: args.params, enabled: args.enabled });
      cfg.postfx.push(fx);
      return { effect: publicFx(fx, cfg.postfx.length - 1), knownType: EFFECT_TYPES.indexOf(args.type) >= 0 };
    });
  });
  tool('sv_remove_effect', 'effectEdit', 'Remove a global effect. Authoring.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      const found = findFx(cfg.postfx, args);
      if (!found || found.error) return fail((found && found.error) || 'Effect not found.');
      cfg.postfx.splice(found.index, 1);
      return { removed: found.fx.id || found.index };
    });
  });
  tool('sv_add_layer_effect', 'effectEdit', 'Add an effect onto a specific layer. Authoring. Read state afterwards to continue.', function (args, ctx) {
    if (!args || !args.type) return fail('type is required.');
    if (badEffect(args.type)) return fail(badEffect(args.type));
    return withConfig(ctx, function (cfg) {
      const found = findLayer(cfg, args);
      if (!found) return fail('Layer not found.');
      if (found.layer.locked) return fail(lockedError(found.layer));
      if (!Array.isArray(found.layer.postfx)) found.layer.postfx = [];
      const fx = normalizeFx({ type: args.type, params: args.params, enabled: args.enabled });
      found.layer.postfx.push(fx);
      return { layerId: found.layer.id, effect: publicFx(fx, found.layer.postfx.length - 1), knownType: EFFECT_TYPES.indexOf(args.type) >= 0, visual: visualState(cfg, ctx) };
    });
  });
  tool('sv_remove_layer_effect', 'effectEdit', 'Remove an effect from a layer. Authoring.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      const layer = findLayer(cfg, args);
      if (!layer) return fail('Layer not found.');
      if (layer.layer.locked) return fail(lockedError(layer.layer));
      const found = findFx(layer.layer.postfx, args);
      if (!found || found.error) return fail((found && found.error) || 'Layer effect not found.');
      layer.layer.postfx.splice(found.index, 1);
      return { removed: found.fx.id || found.index, visual: visualState(cfg, ctx) };
    });
  });
  function milkdropLibraryApi() {
    if (typeof window !== 'undefined' && window.SVMilkdropLibrary && window.SVMilkdropLibrary.withTags) return window.SVMilkdropLibrary;
    try { return require('./milkdrop-library.js'); } catch (e) { return null; }
  }
  function modulationApi() {
    if (typeof window !== 'undefined' && window.SVModulation && window.SVModulation.catalog) return window.SVModulation;
    try { return require('./modulation.js'); } catch (e) { return null; }
  }
  /* Rota, panelin seçtirebileceği şeyle sınırlı: kaynak modülasyon
     kataloğunda, hedef var olan SAYISAL bir ayar. Eskiden `source:"zzz"`
     ve `target:"__proto__.x"` kabul ediliyor, hiçbir şey sürmeyen ölü bir
     rota kalıyordu. */
  function routeError(cfg, route) {
    const M = modulationApi();
    const target = String(route.target);
    if (target.split('.').some(function (k) { return !k || unsafeKey(k); })) return 'target is not a valid config path.';
    if (!M) return '';
    const sources = M.catalog(cfg).map(function (c) { return c.id; });
    if (sources.indexOf(route.source) < 0) return 'Unknown modulation source "' + route.source + '". Known sources: ' + sources.join(', ') + '.';
    const routed = M.routedPath ? M.routedPath(cfg, target) : target;
    const now = M.getIn(cfg, routed);
    if (typeof now !== 'number' || !isFinite(now)) return 'target must be an existing numeric setting (e.g. visualizer.sensitivity, layers.0.opacity); "' + target + '" is ' + (now === undefined ? 'missing' : typeof now) + '.';
    if (route.mode !== undefined && ['set', 'add', 'mul'].indexOf(route.mode) < 0) return 'mode must be set, add, or mul.';
    if (route.curve !== undefined && M.CURVE_IDS && M.CURVE_IDS.indexOf(route.curve) < 0) return 'curve must be one of: ' + M.CURVE_IDS.join(', ') + '.';
    for (const k of ['min', 'max', 'amount', 'smooth', 'steps']) {
      if (route[k] !== undefined && !finite(route[k])) return k + ' must be a number.';
    }
    return '';
  }
  tool('sv_add_modulation_route', 'effectEdit', 'Add a modulation route. Authoring.', function (args, ctx) {
    const route = (args && args.route) || args;
    if (!route || !route.source || !route.target) return fail('source and target are required.');
    const bad = routeError(configOf(ctx), route);
    if (bad) return fail(bad);
    return withConfig(ctx, function (cfg) {
      if (!cfg.modulation) cfg.modulation = { enabled: true, routes: [] };
      if (!Array.isArray(cfg.modulation.routes)) cfg.modulation.routes = [];
      const made = Object.assign({ id: uid('mod_') }, route);
      delete made.route;
      cfg.modulation.routes.push(made);
      return { route: made };
    });
  });
  tool('sv_remove_modulation_route', 'effectEdit', 'Remove a modulation route. Authoring.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      const routes = cfg.modulation && cfg.modulation.routes;
      if (!routes) return fail('No modulation routes.');
      const index = args && args.index != null ? Number(args.index) : routes.findIndex(function (r) { return r && r.id === args.id; });
      if (!routes[index]) return fail('Route not found.');
      const removed = routes.splice(index, 1)[0];
      return { removed: removed.id || index };
    });
  });

  tool('sv_load_preset', 'presetApply', 'Load an existing library preset into MilkDrop. Does not write a new preset file.', function (args, ctx) {
    if (!args || !args.id) return fail('id is required.');
    if (!ctx.presets || !ctx.presets.get) return fail('Preset store is not available.');
    const preset = ctx.presets.get(args.id);
    if (!preset) return fail('Preset not found: ' + args.id);
    return withConfig(ctx, function (cfg) {
      cfg.milkdrop = Object.assign({}, cfg.milkdrop, {
        presetId: preset.id,
        name: preset.name || '',
        source: typeof preset.source === 'string' ? preset.source : ((cfg.milkdrop && cfg.milkdrop.source) || ''),
      });
      return { presetId: preset.id, name: preset.name || '', kind: preset.kind || '' };
    });
  });
  tool('sv_apply_color_preset', 'presetApply', 'Apply an existing user or built-in color preset. Does not create one.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      const SV = defaultsApi();
      const builtin = (SV && SV.GRADIENT_PRESETS) || [];
      const users = cfg.userPresets || [];
      const id = args && args.id;
      const name = args && args.name ? String(args.name).toLowerCase() : '';
      const pal = users.concat(builtin).find(function (p) {
        if (!p || p.group) return false;
        if (id && p.id === id) return true;
        return name && String(p.name || '').toLowerCase() === name;
      });
      if (!pal || !Array.isArray(pal.colors)) return fail('Color preset not found.');
      const colors = paletteColors(pal.colors);
      if (colors.error) return fail('This color preset is damaged: ' + colors.error);
      cfg.background = cfg.background || {};
      cfg.background.gradient = Object.assign({}, cfg.background.gradient, { colors: colors.value });
      return { name: pal.name, colors: colors.value.slice() };
    });
  });
  tool('sv_set_milkdrop_cycle', 'presetApply', 'Change how the existing MilkDrop library advances. Does not write preset source.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      const next = Object.assign({}, cfg.milkdrop);
      ['autoNext', 'autoOrder', 'autoFrom', 'autoTag', 'autoNextUnit', 'autoNextBars', 'trackAdvance', 'hardCut'].forEach(function (k) {
        if (args && args[k] !== undefined) next[k] = args[k];
      });
      cfg.milkdrop = next;
      return { presetId: next.presetId || '', autoNext: next.autoNext, autoOrder: next.autoOrder };
    });
  });
  const PRESET_KINDS = ['visualizer', 'background', 'milkdrop'];
  const ENGINE_ALIASES = { shader: 'shader', glsl: 'shader', shadertoy: 'shader', isf: 'shader', frag: 'shader', fragment: 'shader', variation: 'variation' };
  tool('sv_save_preset', 'presetEdit', 'Write a preset file in the app preset store. Authoring.', function (args, ctx) {
    if (!ctx.presets || !ctx.presets.save) return fail('Preset store is not available.');
    const src = args || {};
    /* Tür verilmediyse shader metni Studio görselleştiricisidir. Eski
       varsayılan her kaydı MilkDrop sayıyordu; Studio listesi onu
       göstermiyordu. Açık tür her zaman kazanır. */
    let kind = src.kind;
    let engine = src.engine;
    const shaderText = typeof src.shader === 'string' ? src.shader.trim() : '';
    if (!kind) {
      if (shaderText) {
        kind = 'visualizer';
        if (!engine) engine = 'shader';
      } else kind = 'milkdrop';
    }
    /* Studio yalnız 'shader' ve 'variation' tanıyor. `engine:"glsl"` eskiden
       olduğu gibi kaydediliyor; Studio onu ne derliyor ne de varyasyon
       sayıyordu, öbür listeler hiç göstermiyordu. Yaygın adlar 'shader'a
       çevrilir, bilinmeyen reddedilir. */
    if (PRESET_KINDS.indexOf(kind) < 0) return fail('kind must be one of: ' + PRESET_KINDS.join(', ') + '.');
    if (kind === 'milkdrop') {
      if (engine != null && engine !== 'milkdrop') return fail('A milkdrop preset has engine "milkdrop".');
      engine = 'milkdrop';
    } else {
      const e = engine == null ? (shaderText ? 'shader' : '') : String(engine).toLowerCase();
      engine = ENGINE_ALIASES[e] || '';
      if (!engine) return fail('engine must be "shader" (GLSL code in shader) or "variation" (base + overrides).');
      if (engine === 'shader' && !shaderText) return fail('A shader preset needs GLSL code in shader.');
      if (engine === 'variation' && !src.base) return fail('A variation preset needs base (a mode id).');
    }
    /* Dosya adı kimlikten yalnız harf, rakam, _ ve - ile çıkıyor;
       `../../evil` dosyada `evil` olurken içerideki kimlik `../../evil`
       kalıyordu ve ikisi uyuşmuyordu. Kimlik baştan aynı biçime getirilir. */
    let id = src.id;
    if (id != null && id !== '') {
      id = String(id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
      if (!id) return fail('id must contain letters, digits, _ or -.');
    }
    const preset = {
      id: id || undefined,
      name: src.name || 'MCP preset',
      kind: kind,
      engine: engine,
      source: src.source || '',
      shader: src.shader,
      controls: src.controls,
      base: src.base,
      overrides: src.overrides,
      description: src.description,
      author: src.author,
      tags: src.tags,
    };
    const saved = ctx.presets.save(preset);
    if (!saved || saved.ok === false) return fail((saved && saved.error) || 'Could not save the preset.');
    const p = saved.preset || preset;
    const out = { ok: true, preset: { id: p.id, name: p.name || preset.name, kind: p.kind || preset.kind, engine: p.engine || '' } };
    /* MilkDrop etiketlerini panel dosyadan değil kitaplıktan
       (`milkdropLibrary.tags`) okuyor; eskiden yalnız dosyaya yazılıyor,
       "#dans" araması hiçbir şey bulmuyordu. */
    const ML = milkdropLibraryApi();
    if (kind === 'milkdrop' && src.tags !== undefined && p.id && ML && ML.withTags) {
      const r = withConfig(ctx, function (cfg) {
        const lib = Object.assign({}, cfg.milkdropLibrary);
        lib.tags = ML.withTags(lib, p.id, src.tags);
        cfg.milkdropLibrary = lib;
        return { tags: lib.tags[p.id] || [] };
      });
      if (r && r.ok !== false) out.preset.tags = r.tags;
    }
    return out;
  });
  tool('sv_delete_preset', 'presetEdit', 'Delete a preset file. Authoring.', function (args, ctx) {
    if (!args || !args.id) return fail('id is required.');
    if (!ctx.presets || !ctx.presets.remove) return fail('Preset store is not available.');
    if (ctx.presets.get && !ctx.presets.get(args.id)) return fail('Preset not found: ' + args.id);
    const r = ctx.presets.remove(args.id);
    if (r && r.ok === false) return fail('Could not delete the preset: ' + (r.error || 'unknown error'));
    return { ok: true, deleted: args.id };
  });
  tool('sv_set_milkdrop_source', 'presetEdit', 'Write MilkDrop source into the live config. Authoring. Loading an existing id is sv_load_preset.', function (args, ctx) {
    if (!args || typeof args.source !== 'string') return fail('source is required.');
    return withConfig(ctx, function (cfg) {
      cfg.milkdrop = Object.assign({}, cfg.milkdrop, {
        source: args.source,
        name: args.name != null ? args.name : ((cfg.milkdrop && cfg.milkdrop.name) || ''),
        presetId: args.presetId != null ? args.presetId : ((cfg.milkdrop && cfg.milkdrop.presetId) || ''),
      });
      return { name: cfg.milkdrop.name, presetId: cfg.milkdrop.presetId, sourceLength: args.source.length };
    });
  });
  tool('sv_create_color_preset', 'presetEdit', 'Save a user color preset. Authoring.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      const colors = (args && args.colors) || (cfg.background && cfg.background.gradient && cfg.background.gradient.colors);
      const clean = paletteColors(colors);
      if (clean.error) return fail(clean.error);
      if (!Array.isArray(cfg.userPresets)) cfg.userPresets = [];
      const preset = { id: uid('up_'), name: (args && args.name) ? String(args.name) : ('Palette ' + (cfg.userPresets.length + 1)), colors: clean.value };
      cfg.userPresets.push(preset);
      return { preset: preset };
    });
  });
  tool('sv_delete_color_preset', 'presetEdit', 'Delete a user color preset. Authoring.', function (args, ctx) {
    if (!args || !args.id) return fail('id is required.');
    return withConfig(ctx, function (cfg) {
      const before = (cfg.userPresets || []).length;
      cfg.userPresets = (cfg.userPresets || []).filter(function (p) { return p && p.id !== args.id; });
      if (cfg.userPresets.length === before) return fail('Color preset not found.');
      return { deleted: args.id };
    });
  });

  function outputPatch(ctx, key, patch) {
    return withConfig(ctx, function (cfg) {
      cfg[key] = mergeObj(cfg[key] || {}, patch || {});
      return { value: summarize(cfg[key]) };
    });
  }
  tool('sv_open_output', 'output', 'Open the visualizer on the selected displays.', function (args, ctx) {
    const cfg = clone(configOf(ctx)) || {};
    const current = (cfg.display && cfg.display.ids) || [];
    let ids = current;
    if (args && Array.isArray(args.displayIds)) ids = args.displayIds;
    else if (args && args.displayId != null) ids = [args.displayId];
    cfg.display = Object.assign({}, cfg.display, { ids: ids, id: ids[0] != null ? ids[0] : (cfg.display && cfg.display.id) });
    if (ctx.setConfig) ctx.setConfig(cfg);
    const rev = ctx.noteWrite ? ctx.noteWrite() : undefined;
    if (!ctx.openOutput) return { ok: true, revision: rev, display: cfg.display, opened: false };
    return Promise.resolve(ctx.openOutput(ids)).then(function (result) {
      return { ok: true, revision: rev, display: cfg.display, opened: true, result: result == null ? true : result };
    });
  });
  tool('sv_close_output', 'output', 'Close visualizer windows.', function (args, ctx) {
    if (!ctx.closeOutput) return fail('closeOutput is not available in this process.');
    return Promise.resolve(ctx.closeOutput(args && args.displayId)).then(function (result) {
      return { ok: true, closed: true, result: result == null ? true : result };
    });
  });
  tool('sv_set_displays', 'output', 'Choose displays without opening them.', function (args, ctx) {
    if (!args || !Array.isArray(args.ids)) return fail('ids array is required.');
    return withConfig(ctx, function (cfg) {
      cfg.display = Object.assign({}, cfg.display, { ids: args.ids, id: args.ids[0] != null ? args.ids[0] : null });
      return { display: cfg.display };
    });
  });
  tool('sv_set_stream', 'output', 'Change OBS/web stream settings. Token fields are ignored here.', function (args, ctx) {
    const patch = Object.assign({}, (args && args.patch) || {});
    const hadToken = Object.prototype.hasOwnProperty.call(patch, 'token') || Object.prototype.hasOwnProperty.call(patch, 'remoteToken');
    delete patch.token;
    delete patch.remoteToken;
    if (hadToken && !Object.keys(patch).length) return fail(text('mcp.err.token', localeOf(ctx)));
    const result = outputPatch(ctx, 'stream', patch);
    if (hadToken && result && result.ok !== false) result.tokenIgnored = true;
    return result;
  });
  tool('sv_set_texture_share', 'output', 'Change Spout/Syphon settings.', function (args, ctx) { return outputPatch(ctx, 'textureShare', args && args.patch); });
  tool('sv_set_aspect', 'output', 'Change aspect settings.', function (args, ctx) { return outputPatch(ctx, 'aspect', args && args.patch); });
  tool('sv_set_floating', 'output', 'Change floating window preferences.', function (args, ctx) { return outputPatch(ctx, 'floating', args && args.patch); });
  tool('sv_set_floating_open', 'output', 'Open or close the floating PiP window. Same window as the display-menu switch. Does not change opacity or click-through.', function (args, ctx) {
    if (!args || typeof args.open !== 'boolean') return fail('open boolean is required.');
    if (!ctx.setFloatingOpen) return fail(text('mcp.err.unavailable', localeOf(ctx)));
    return Promise.resolve(ctx.setFloatingOpen(args.open)).then(function (r) {
      if (r && r.ok === false) return r;
      return { ok: true, open: !!(r && r.open) };
    });
  });
  tool('sv_set_power', 'output', 'Change fps cap, render scale, whether the display stays awake (keepAwake) and whether video is decoded in hardware (hwVideoDecode, applies after a restart).', function (args, ctx) { return outputPatch(ctx, 'power', args && args.patch); });
  tool('sv_set_lighting', 'output', 'Change Windows Dynamic Lighting settings.', function (args, ctx) { return outputPatch(ctx, 'lighting', args && args.patch); });
  tool('sv_set_openrgb', 'output', 'Change OpenRGB settings.', function (args, ctx) { return outputPatch(ctx, 'openrgb', args && args.patch); });
  tool('sv_set_artnet', 'output', 'Change Art-Net/DMX settings.', function (args, ctx) { return outputPatch(ctx, 'artnet', args && args.patch); });
  tool('sv_set_window_mode', 'output', 'Set transparent background and taskbar cover.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      cfg.background = Object.assign({}, cfg.background);
      if (args && args.transparent != null) cfg.background.transparent = !!args.transparent;
      if (args && args.coverTaskbar != null) cfg.background.coverTaskbar = !!args.coverTaskbar;
      if (args && args.transparentKey != null) cfg.background.transparentKey = args.transparentKey;
      return { transparent: !!cfg.background.transparent, coverTaskbar: !!cfg.background.coverTaskbar };
    });
  });
  tool('sv_start_export', 'export', 'Start an offline video export. Requires audioPath and outputPath.', function (args, ctx) {
    if (!ctx.startExport) return fail('Export is not available in this process.');
    const outBad = outPathError(ctx, args && args.outputPath, ['mp4'], args && args.overwrite);
    if (outBad) return fail('outputPath: ' + outBad);
    return Promise.resolve(ctx.startExport(args || {})).then(function (r) { return r && r.ok === false ? r : Object.assign({ ok: true }, r || {}); });
  });
  tool('sv_cancel_export', 'export', 'Cancel the running offline export.', function (args, ctx) {
    if (!ctx.cancelExport) return fail('Export is not available in this process.');
    return Promise.resolve(ctx.cancelExport()).then(function (r) { return { ok: true, result: r == null ? true : r }; });
  });
  tool('sv_export_json', 'export', 'Write scenes or full config JSON to an explicit path. No save dialog.', function (args, ctx) {
    const jsonBad = outPathError(ctx, args && args.path, ['json'], args && args.overwrite);
    if (jsonBad) return fail(jsonBad);
    if (!ctx.writeText) return fail('File export is not available in this process.');
    const cfg = redactSecrets(clone(configOf(ctx)) || {});
    const body = args.what === 'scenes' ? { type: 'sv-scenes', version: 1, scenes: cfg.scenes || [] } : cfg;
    return Promise.resolve(ctx.writeText(args.path, JSON.stringify(body, null, 2))).then(function () {
      return { ok: true, path: args.path, what: args.what || 'config' };
    });
  });
  tool('sv_save_snapshot', 'export', 'Capture the live canvas to a file. Reading a preview without saving is sv_get_preview.', function (args, ctx) {
    /* Görüntü JPEG olarak geliyor; başka uzantı yanlış dosya üretirdi. */
    const shotBad = outPathError(ctx, args && args.path, ['jpg', 'jpeg'], args && args.overwrite);
    if (shotBad) return fail(shotBad);
    if (!ctx.capturePreview || !ctx.writeBinary) return fail('Snapshot capture is not available in this process.');
    return Promise.resolve(ctx.capturePreview()).then(function (img) {
      if (!img || img.error || !img.dataUrl) return fail((img && img.error) || 'The preview canvas is not ready.');
      const m = String(img.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
      if (!m) return fail('Canvas did not return a data URL.');
      return Promise.resolve(ctx.writeBinary(args.path, Buffer.from(m[2], 'base64'))).then(function () {
        return { ok: true, path: args.path, mime: m[1], width: img.width, height: img.height };
      });
    });
  });
  tool('sv_record_start', 'export', 'Start the admin live recorder.', function (args, ctx) {
    if (!ctx.recordStart) return fail('Live recording is not available. Keep the admin window open.');
    return Promise.resolve(ctx.recordStart()).then(function (r) { return r && r.ok === false ? r : Object.assign({ ok: true }, r || {}); });
  });
  tool('sv_record_stop', 'export', 'Stop the live recorder. The app then asks where to save, same as the Record card.', function (args, ctx) {
    if (!ctx.recordStop) return fail('Live recording is not available. Keep the admin window open.');
    return Promise.resolve(ctx.recordStop()).then(function (r) { return r && r.ok === false ? r : Object.assign({ ok: true }, r || {}); });
  });
  tool('sv_set_blackout', 'blackout', 'Black out or restore the show. state is on, off, or toggle. Scene data stays intact.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      const state = args && (args.state || (args.on === true ? 'on' : args.on === false ? 'off' : ''));
      let next;
      if (state === 'toggle') next = cfg.isBlackout !== true;
      else if (state === 'on') next = true;
      else if (state === 'off') next = false;
      else return fail('state must be on, off, or toggle.');
      cfg.isBlackout = next;
      return { blackout: next, visual: visualState(cfg, ctx) };
    });
  });
  tool('sv_set_blackout_transition', 'blackout', 'Set the blackout transition type and duration.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      cfg.transition = Object.assign({}, cfg.transition);
      if (args && args.type) cfg.transition.blackoutType = args.type;
      if (args && args.duration != null) cfg.transition.blackoutDuration = Number(args.duration);
      return { blackoutType: cfg.transition.blackoutType, blackoutDuration: cfg.transition.blackoutDuration };
    });
  });
  tool('sv_patch_config', 'routed', 'Set any other config path. Permission follows the path. Cannot change mcp permissions.', function (args, ctx) {
    if (!args || !args.path) return fail('path is required.');
    /* Bilinmeyen üst anahtar (ör. `MCP.mode`) eskiden yeni bir anahtar
       olarak ayar dosyasına yazılıyordu. Bilinen ya da ayarda zaten
       bulunan anahtarlar yazılabilir. */
    const top = String(args.path).split('.')[0];
    if (!Object.prototype.hasOwnProperty.call(PATH_GROUPS, top) && !Object.prototype.hasOwnProperty.call(configOf(ctx), top)) {
      return fail('Unknown config key "' + top + '". Read sv_get_config for the keys that exist.');
    }
    const group = groupForPath(args.path);
    if (group === 'mcp') return fail(text('mcp.err.mcp', localeOf(ctx)));
    const mcp = normalizeMcp(configOf(ctx).mcp);
    if (!mcp.enabled) return fail(text('mcp.err.disabled', localeOf(ctx)).replace('{mode}', modeWord(minMode(group) || 'everything', localeOf(ctx))));
    if (!modeAllows(mcp, group)) return fail(modeBlockError(localeOf(ctx), minMode(group) || 'everything'));
    return withConfig(ctx, function (cfg) {
      const bad = valueTypeError(cfg, args.path, args.value) || lockedPathError(cfg, args.path, args.value);
      if (bad) return fail(bad);
      if (top === 'layers') {
        const r = patchLayers(cfg, args.path, args.value);
        if (r.ok === false) return r;
        return { path: args.path, group: GROUP_LABEL[group] || group, value: r.value };
      }
      const wrote = setPath(cfg, args.path, args.value);
      if (wrote.ok === false) return wrote;
      return { path: args.path, group: GROUP_LABEL[group] || group };
    });
  });


  function permissionReport(args, ctx) {
    const loc = localeOf(ctx);
    const mcp = normalizeMcp(configOf(ctx).mcp);
    const modes = MODES.map(function (id) {
      return {
        id: id,
        label: text('mcp.mode.' + id + '.label', loc),
        unlocks: text('mcp.mode.' + id + '.unlocks', loc),
        active: mcp.enabled === true && id === mcp.mode,
      };
    });
    const name = args && (args.tool || args.name);
    let toolInfo = null;
    if (name) {
      let def = null;
      for (let i = 0; i < TOOLS.length; i++) if (TOOLS[i].name === name) def = TOOLS[i];
      if (!def) toolInfo = { name: String(name), known: false, minimumMode: null };
      else {
        const need = minMode(def.group) || 'read';
        toolInfo = {
          name: def.name,
          known: true,
          minimumMode: need,
          minimumModeLabel: modeWord(need, loc),
          allowed: !!(mcp.enabled && (def.group === 'routed' || modeAllows(mcp, def.group))),
        };
      }
    }
    return {
      ok: true,
      enabled: mcp.enabled,
      mode: mcp.mode,
      modeLabel: text('mcp.mode.' + mcp.mode + '.label', loc),
      modes: modes,
      tool: toolInfo,
      note: text('mcp.perm.handsOff', loc),
    };
  }
  tool('mcp_permissions', null, 'Report the current MCP mode and the minimum mode a tool needs. Do not change the mode yourself. Do not click the admin UI. Tell the user and stop.', function (args, ctx) {
    return permissionReport(args, ctx);
  });
  tool('sv_get_layer_stack', null, 'Read the active layer stack. Read-only.', function (args, ctx) {
    const cfg = configOf(ctx);
    return { ok: true, enabled: !!(cfg.layerStack && cfg.layerStack.enabled), layers: (cfg.layers || []).map(publicLayer) };
  });
  tool('sv_list_audio_sources', null, 'List configured audio input sources. Read-only.', function (args, ctx) {
    const audio = configOf(ctx).audio || {};
    return { ok: true, sources: audio.sources || [] };
  });
  tool('sv_get_analysis', null, 'Read live analysis metrics: key, chord, loudness, pitch, bands. Does not expose onset thresholds.', function (args, ctx) {
    if (!ctx.analysis) return { ok: true, analysis: null };
    return Promise.resolve(ctx.analysis()).then(function (r) {
      return r && r.ok === false ? r : { ok: true, analysis: r && r.analysis ? r.analysis : r };
    });
  });
  tool('sv_diagnose_audio', null, 'Read the audio capture diagnosis. Does not repair devices.', function (args, ctx) {
    if (!ctx.diagnoseAudio) return fail(text('mcp.err.unavailable', localeOf(ctx)));
    return Promise.resolve(ctx.diagnoseAudio()).then(function (diagnostic) {
      return { ok: true, diagnostic: diagnostic };
    });
  });
  tool('sv_set_audio_sources', 'output', 'Replace the audio input mix. Does not repair devices.', function (args, ctx) {
    if (!args || !Array.isArray(args.sources)) return fail('sources array is required.');
    return withConfig(ctx, function (cfg) {
      cfg.audio = Object.assign({}, cfg.audio, { sources: args.sources });
      return { count: args.sources.length };
    });
  });
  tool('sv_set_mapping', 'output', 'Set projection mapping for one display: enable, corners, crop, edge blend, masks. Does not open a new network bind.', function (args, ctx) {
    const id = args && (args.displayId || args.id);
    if (!id) return fail('displayId is required.');
    return withConfig(ctx, function (cfg) {
      cfg.mapping = Object.assign({ enabled: false, outputs: {} }, cfg.mapping);
      cfg.mapping.enabled = true;
      const prev = cfg.mapping.outputs[id] || {};
      const next = Object.assign({}, prev);
      ['enabled', 'corners', 'crop', 'edges', 'masks', 'testPattern', 'mesh', 'color'].forEach(function (k) {
        if (args[k] !== undefined) next[k] = args[k];
      });
      cfg.mapping.outputs[id] = next;
      return { displayId: id };
    });
  });
  tool('sv_repair_audio', 'repairAudio', 'Run audio repair. Requires Everything. Does not open a system dialog.', function (args, ctx) {
    if (!ctx.repairAudio) return fail(text('mcp.err.unavailable', localeOf(ctx)));
    return Promise.resolve(ctx.repairAudio()).then(function (r) {
      if (r && r.requiresManualAction) return fail(text('mcp.err.repairManual', localeOf(ctx)));
      return r && r.ok === false ? r : Object.assign({ ok: true }, r || {});
    });
  });
  tool('sv_rotate_stream_token', 'streamToken', 'Rotate the OBS or remote stream token. Requires Everything. Does not change the bind address.', function (args, ctx) {
    if (!ctx.newStreamToken) return fail(text('mcp.err.unavailable', localeOf(ctx)));
    const which = args && args.which === 'remote' ? 'remoteToken' : 'token';
    const token = ctx.newStreamToken();
    if (!token) return fail(text('mcp.err.unavailable', localeOf(ctx)));
    return withConfig(ctx, function (cfg) {
      cfg.stream = Object.assign({}, cfg.stream);
      cfg.stream[which] = token;
      return { which: which, rotated: true };
    });
  });
  tool('sv_updates_download', 'updates', 'Download an application update. Requires Everything.', function (args, ctx) {
    if (!ctx.downloadUpdate) return fail(text('mcp.err.unavailable', localeOf(ctx)));
    return Promise.resolve(ctx.downloadUpdate()).then(function (r) {
      return r && r.ok === false ? r : Object.assign({ ok: true }, r || {});
    });
  });
  tool('sv_updates_install', 'updates', 'Install a downloaded application update and restart. Requires Everything.', function (args, ctx) {
    if (!ctx.installUpdate) return fail(text('mcp.err.unavailable', localeOf(ctx)));
    return Promise.resolve(ctx.installUpdate()).then(function (r) {
      return r && r.ok === false ? r : Object.assign({ ok: true }, r || {});
    });
  });

  function callTool(name, args, ctx) {
    let toolDef = null;
    for (let i = 0; i < TOOLS.length; i++) if (TOOLS[i].name === name) toolDef = TOOLS[i];
    if (!toolDef) return fail('Unknown tool: ' + name);
    const mcp = normalizeMcp(configOf(ctx).mcp);
    const loc = localeOf(ctx);
    const need = minMode(toolDef.group) || 'read';
    if (!mcp.enabled) return fail(text('mcp.err.disabled', loc).replace('{mode}', modeWord(need, loc)));
    if (toolDef.group && toolDef.group !== 'routed' && !modeAllows(mcp, toolDef.group)) return fail(modeBlockError(loc, need));
    /* Aracın tanımadığı argümanlar yine kabul edilir (additionalProperties)
       ama yanıtta `ignored` olarak söylenir. Eskiden sv_set_autovj
       {patch:{...}} gibi bir çağrıyı hiçbir şey yazmadan ok:true ile
       geçiyordu. Tanıdığı hiçbir argüman yoksa ayar araçları reddeder. */
    const known = SCHEMAS[name] && SCHEMAS[name].props;
    const unknown = known && args && typeof args === 'object' && !Array.isArray(args)
      ? Object.keys(args).filter(function (k) { return !Object.prototype.hasOwnProperty.call(known, k); })
      : [];
    if (unknown.length && STRICT_ARGS.indexOf(name) >= 0 && unknown.length === Object.keys(args).length) {
      return fail('Unknown argument(s): ' + unknown.join(', ') + '. ' + name + ' takes: ' + Object.keys(known).join(', ') + '.');
    }
    const note = function (value) {
      const out = value || { ok: true };
      if (unknown.length && out && typeof out === 'object' && !Array.isArray(out)) out.ignored = unknown;
      return out;
    };
    try {
      const result = toolDef.fn(args || {}, ctx || {});
      if (result && typeof result.then === 'function') {
        return result.then(note, function (e) { return fail(String((e && e.message) || e)); });
      }
      return note(result);
    } catch (e) {
      return fail(String((e && e.message) || e));
    }
  }
  function publicTool(t, locale) {
    const loc = locale === 'tr' ? 'tr' : 'en';
    const key = 'mcp.tool.' + t.name;
    let body = text(key, loc);
    if (!body || body === key) body = t.description;
    const need = minMode(t.group) || 'read';
    const perm = !t.group ? text('mcp.perm.read', loc)
      : (t.group === 'routed' ? text('mcp.perm.routed', loc)
        : text('mcp.perm.needs', loc).replace('{mode}', modeWord(need, loc)));
    return { name: t.name, description: body + ' ' + perm, inputSchema: t.inputSchema };
  }
  /* Sunucu sürümü paketten okunur. Elle yazılmış '3.1.5-beta' yayından
     sonra da istemcilere beta diyordu (#695). */
  function appVersion() {
    if (appVersion.cached) return appVersion.cached;
    let v = '';
    try { if (typeof require === 'function') v = require('../../package.json').version; } catch (e) { v = ''; }
    appVersion.cached = typeof v === 'string' && v ? v : '0.0.0';
    return appVersion.cached;
  }
  function handleRpc(message, ctx) {
    const msg = message || {};
    if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return Promise.resolve({ jsonrpc: '2.0', id: msg.id == null ? null : msg.id, error: { code: -32600, message: 'Invalid Request' } });
    }
    if (msg.id == null && String(msg.method).indexOf('notifications/') === 0) return Promise.resolve(null);
    const id = msg.id;
    if (msg.method === 'initialize') {
      const requested = msg.params && msg.params.protocolVersion;
      const protocolVersion = PROTOCOLS.indexOf(requested) >= 0 ? requested : '2024-11-05';
      return Promise.resolve({
        jsonrpc: '2.0', id: id,
        result: { protocolVersion: protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'soundvisualizer', version: appVersion() } },
      });
    }
    if (msg.method === 'ping') return Promise.resolve({ jsonrpc: '2.0', id: id, result: {} });
    if (msg.method === 'tools/list') {
      const loc = localeOf(ctx);
      return Promise.resolve({ jsonrpc: '2.0', id: id, result: { tools: TOOLS.map(function (t) { return publicTool(t, loc); }) } });
    }
    if (msg.method === 'tools/call') {
      const params = msg.params || {};
      return Promise.resolve(callTool(params.name, params.arguments || {}, ctx)).then(function (out) {
        return { jsonrpc: '2.0', id: id, result: { content: [{ type: 'text', text: JSON.stringify(out) }], isError: !out || out.ok === false } };
      });
    }
    return Promise.resolve({ jsonrpc: '2.0', id: id, error: { code: -32601, message: 'Method not found: ' + msg.method } });
  }
  function cardModel(cfg) {
    const mcp = normalizeMcp(cfg && cfg.mcp);
    return {
      enabled: mcp.enabled,
      mode: mcp.mode,
      port: mcp.port,
      setupVisible: mcp.enabled === true,
      modes: MODES.slice(),
    };
  }
  function commandBundle(scriptPath, port) {
    const script = scriptPath || 'mcp-stdio.js';
    const args = [script];
    const httpPort = normalizePort(port);
    const url = 'http://127.0.0.1:' + httpPort + '/mcp';
    const json = JSON.stringify({ mcpServers: { soundvisualizer: { command: 'node', args: args } } }, null, 2);
    const tomlArg = String(script).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const toml = '[mcp_servers.soundvisualizer]\ncommand = "node"\nargs = ["' + tomlArg + '"]\nenabled = true\n';
    return { command: 'node', args: args, json: json, toml: toml, shell: 'node ' + JSON.stringify(script), script: script, port: httpPort, url: url };
  }

  function installPrompt(scriptPath, locale, port) {
    const bundle = commandBundle(scriptPath, port);
    const loc = locale === "tr" ? "tr" : "en";
    return text("mcp.setup.prompt", loc)
      .split("{command}").join(bundle.shell)
      .split("{port}").join(String(bundle.port))
      .split("{url}").join(bundle.url);
  }
  function hostPlatform(explicit) {
    if (explicit === 'win32' || explicit === 'darwin' || explicit === 'linux') return explicit;
    /* Panel SV_PLATFORM kullanır. Süreç önce bakılırsa testteki ya da
       gömülü Node'daki platform, açık olan işletim sistemini ezer. */
    try {
      if (typeof window !== 'undefined' && window.SV_PLATFORM) {
        if (window.SV_PLATFORM.isMac) return 'darwin';
        if (window.SV_PLATFORM.isLinux) return 'linux';
        if (window.SV_PLATFORM.isWindows) return 'win32';
      }
    } catch (e) { /* yok */ }
    if (typeof process !== 'undefined' && (process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux')) {
      return process.platform;
    }
    return 'linux';
  }
  function clientFileStep(id, platform) {
    const p = hostPlatform(platform);
    if (id === 'claude') {
      if (p === 'darwin') return 'macOS’ta ~/Library/Application Support/Claude/claude_desktop_config.json dosyasına mcpServers bloğunu ekleyin.';
      if (p === 'linux') return 'Linux’ta ~/.config/Claude/claude_desktop_config.json dosyasına mcpServers bloğunu ekleyin.';
      return 'Windows’ta %APPDATA%\\Claude\\claude_desktop_config.json dosyasına mcpServers bloğunu ekleyin.';
    }
    if (id === 'codex') {
      if (p === 'win32') return 'Tablo %USERPROFILE%\\.codex\\config.toml dosyasına eklenir. codex mcp add de aynı yere yazar.';
      return 'Tablo ~/.codex/config.toml dosyasına eklenir. codex mcp add de aynı yere yazar.';
    }
    if (id === 'cursor') {
      if (p === 'win32') return 'Proje için .cursor/mcp.json, genel için %USERPROFILE%\\.cursor\\mcp.json kullanın.';
      return 'Proje için .cursor/mcp.json, genel için ~/.cursor/mcp.json kullanın.';
    }
    return '';
  }
  function clients(scriptPath, port, platform) {
    const httpPort = normalizePort(port);
    const bundle = commandBundle(scriptPath, httpPort);
    const osName = hostPlatform(platform);
    return [
      { id: 'claude', title: 'Claude', platform: osName, steps: ['MCP açıkken bu uygulamayı açık tutun.', clientFileStep('claude', osName), 'Claude Desktop’u tamamen kapatıp yeniden açın.'], snippet: bundle.json },
      { id: 'codex', title: 'Codex', platform: osName, steps: ['MCP açıkken bu uygulamayı açık tutun.', clientFileStep('codex', osName), 'Yeni bir Codex oturumu açın.'], snippet: bundle.toml },
      { id: 'cursor', title: 'Cursor', platform: osName, steps: ['MCP açıkken bu uygulamayı açık tutun.', clientFileStep('cursor', osName), 'Cursor MCP listesini yenileyin.'], snippet: bundle.json },
      { id: 'grok', title: 'Grok', steps: ['Grok için yayınlanmış tek bir MCP ayar dosyası yok.', 'Stdio kabul eden istemcide aşağıdaki komutu kullanın.', 'mcpServers JSON’unu o istemcinin MCP listesine yapıştırın.'], snippet: bundle.shell + '\n\n' + bundle.json },
      { id: 'grok-bot', title: 'Grok Bot', steps: ['Grok Bot yerel bir mcp.json yolu yayınlamıyor.', 'Aynı stdio komutunu MCP sunucusu olarak ekleyin.', 'Aşağıdaki mcpServers bloğu geçerlidir. Ayrı bir protokol yok.'], snippet: bundle.shell + '\n\n' + bundle.json },
      { id: 'ollama', title: 'Ollama', steps: ['Ollama ayrı bir MCP protokolü değildir. Ücretsiz yerel model, aynı MCP sunucusuna bağlanan bir istemcidir.', 'Ollama’yı kurun, bir model çekin ve yerelde ollama serve çalışsın.', 'MCP konuşan istemcide modeli Ollama’ya yöneltin ve bu stdio sunucusunu ekleyin.', 'Aşağıdaki blok bu sunucudur.'], snippet: bundle.json },
    ];
  }
  const api = {
    ALLOW_KEYS: ALLOW_KEYS, DEFAULT_MCP: DEFAULT_MCP, GROUP_LABEL: GROUP_LABEL,
    SCENE_KEYS: SCENE_KEYS, EFFECT_TYPES: EFFECT_TYPES, PATH_GROUPS: PATH_GROUPS, GROUP_MODE: GROUP_MODE,
    LAYER_DEFAULTS: LAYER_DEFAULTS,
    normalizeMcp: normalizeMcp, groupForPath: groupForPath, visualState: visualState,
    cardModel: cardModel, commandBundle: commandBundle, clients: clients, installPrompt: installPrompt,
    hostPlatform: hostPlatform, clientFileStep: clientFileStep,
    tools: function (locale) { return TOOLS.map(function (t) { return publicTool(t, locale || 'en'); }); },
    MODES: MODES, DEFAULT_PORT: DEFAULT_PORT,
    callTool: callTool, handleRpc: handleRpc,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVMcp = api;
})();
