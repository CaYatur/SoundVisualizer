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
  function denied(group) {
    return { ok: false, error: 'Permission denied: ' + (GROUP_LABEL[group] || group) + ' is off. Enable that switch on the MCP card under Control. Writes stay off until the matching group is allowed.' };
  }
  function fail(message) { return { ok: false, error: message }; }
  function groupForPath(p) {
    const path = String(p || '');
    if (!path || path === 'mcp' || path.indexOf('mcp.') === 0) return 'mcp';
    if (path === 'updates' || path.indexOf('updates.') === 0) return 'updates';
    if (path === 'stream.token' || path === 'stream.remoteToken') return 'streamToken';
    if (path === 'mapping' || path.indexOf('mapping.') === 0) return 'output';
    if (path === 'timeline' || path.indexOf('timeline.') === 0) return 'timeline';
    if (path === 'control' || path.indexOf('control.') === 0) return 'controlBindings';
    if (path === 'isBlackout' || path.indexOf('transition.blackout') === 0) return 'blackout';
    if (path.indexOf('export.') === 0 || path.indexOf('recording.') === 0) return 'export';
    if (path === 'background.transparent' || path === 'background.coverTaskbar' || path === 'background.transparentKey') return 'output';
    if (path.indexOf('display') === 0 || path.indexOf('stream.') === 0 || path.indexOf('textureShare.') === 0 ||
        path.indexOf('aspect.') === 0 || path.indexOf('floating.') === 0 || path.indexOf('power.') === 0 ||
        path.indexOf('lighting.') === 0 || path.indexOf('openrgb.') === 0 || path.indexOf('artnet.') === 0 ||
        path.indexOf('audio.sources') === 0) return 'output';
    if (path === 'postfx' || path.indexOf('postfx.') === 0 || path.indexOf('.postfx') >= 0 ||
        path === 'modulation' || path.indexOf('modulation.') === 0) return 'effectEdit';
    if (path.indexOf('milkdrop') === 0 || path.indexOf('userPresets') === 0 ||
        path.indexOf('custom.') === 0 || path.indexOf('feedback.') === 0) return 'presetEdit';
    return 'sceneEdit';
  }
  function unsafeKey(k) { return k === '__proto__' || k === 'prototype' || k === 'constructor'; }
  function setPath(obj, p, value) {
    const keys = String(p).split('.');
    if (keys.some(unsafeKey)) return fail('Refusing unsafe config path.');
    let node = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (typeof node[k] !== 'object' || node[k] === null || Array.isArray(node[k])) node[k] = {};
      node = node[k];
    }
    node[keys[keys.length - 1]] = value;
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
  function ensureLayers(cfg) {
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
  function tool(name, group, description, fn) {
    TOOLS.push({
      name: name, group: group, description: description, fn: fn,
      inputSchema: { type: 'object', additionalProperties: true },
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
      state.preview = img || null;
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
    const cfg = clone(configOf(ctx)) || {};
    if (cfg.stream) {
      if (cfg.stream.token) cfg.stream.token = '[redacted]';
      if (cfg.stream.remoteToken) cfg.stream.remoteToken = '[redacted]';
    }
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
  tool('sv_set_visualizer_type', 'sceneApply', 'Switch the classic visualizer to an existing mode id.', function (args, ctx) {
    if (!args || !args.type) return fail('type is required.');
    return withConfig(ctx, function (cfg) {
      cfg.visualizer = Object.assign({}, cfg.visualizer, { type: String(args.type) });
      return { type: cfg.visualizer.type };
    });
  });
  tool('sv_set_background_type', 'sceneApply', 'Switch the background to an existing mode id.', function (args, ctx) {
    if (!args || !args.type) return fail('type is required.');
    return withConfig(ctx, function (cfg) {
      cfg.background = Object.assign({}, cfg.background, { type: String(args.type) });
      return { type: cfg.background.type };
    });
  });
  tool('sv_set_layer_enabled', 'sceneApply', 'Show or hide an existing layer and turn the layer stack on. Does not change layer contents.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      const found = findLayer(cfg, args);
      if (!found) return fail('Layer not found.');
      ensureLayers(cfg);
      found.layer.enabled = !(args && args.enabled === false);
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
    return Promise.resolve(ctx.launchClip(args || {})).then(function (r) {
      return r && r.ok === false ? r : Object.assign({ ok: true }, r || {});
    });
  });
  tool('sv_stop_clips', 'sceneApply', 'Stop every playing clip-deck slot. Does not edit the grid.', function (args, ctx) {
    if (!ctx.stopClips) return fail('Clip deck is not available. Keep the admin window open.');
    return Promise.resolve(ctx.stopClips()).then(function (r) {
      return r && r.ok === false ? r : Object.assign({ ok: true }, r || {});
    });
  });
  tool('sv_set_autovj', 'autovj', 'Turn Auto VJ on or off and choose how it walks existing scenes, modes, or palettes.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      const next = Object.assign({ enabled: false, source: 'visualizers', unit: 'bars', interval: 8, order: 'sequential', bpmLock: 0 }, cfg.autovj);
      ['enabled', 'source', 'interval', 'unit', 'order', 'bpmLock', 'paletteSource', 'visualizerTargets'].forEach(function (k) {
        if (args && args[k] !== undefined) next[k] = args[k];
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
  tool('sv_rename_scene', 'sceneEdit', 'Rename a scene. Authoring.', function (args, ctx) {
    if (!args || !args.name) return fail('name is required.');
    return withConfig(ctx, function (cfg) {
      const found = findScene(cfg, args);
      if (!found.scene) return fail('Scene not found.');
      found.scene.name = String(args.name);
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
      const layer = normalizeLayer(raw);
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
      ['name', 'kind', 'type', 'enabled', 'opacity', 'blend', 'solo', 'muted', 'locked', 'group', 'presetId'].forEach(function (k) {
        if (patch[k] !== undefined) found.layer[k] = patch[k];
      });
      if (patch.transform) found.layer.transform = mergeObj(found.layer.transform, patch.transform);
      if (patch.settings) found.layer.settings = mergeObj(found.layer.settings, patch.settings);
      if (patch.audio) found.layer.audio = mergeObj(found.layer.audio, patch.audio);
      if (patch.mask) found.layer.mask = mergeObj(found.layer.mask, patch.mask);
      return { layer: publicLayer(found.layer, found.index), visual: visualState(cfg, ctx) };
    });
  });
  tool('sv_set_layer_position', 'sceneEdit', 'Set layer x, y, scale, and rotate. Authoring.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      const found = findLayer(cfg, args);
      if (!found) return fail('Layer not found.');
      const t = Object.assign({ scale: 1, rotate: 0, x: 0, y: 0, flipX: false, flipY: false }, found.layer.transform);
      ['x', 'y', 'scale', 'rotate', 'flipX', 'flipY'].forEach(function (k) {
        if (args && args[k] !== undefined) t[k] = args[k];
      });
      found.layer.transform = t;
      return { layer: publicLayer(found.layer, found.index), visual: visualState(cfg, ctx) };
    });
  });
  tool('sv_set_layer_settings', 'sceneEdit', 'Merge settings on an existing layer. Authoring.', function (args, ctx) {
    return withConfig(ctx, function (cfg) {
      const found = findLayer(cfg, args);
      if (!found) return fail('Layer not found.');
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
      cfg.layers = next;
      return { layers: next.map(publicLayer) };
    });
  });
  tool('sv_set_text', 'sceneEdit', 'Edit the text overlay, including a lyrics or now-playing source. Authoring.', function (args, ctx) {
    return withConfig(ctx, function (cfg) { cfg.text = mergeObj(cfg.text || {}, (args && args.patch) || {}); return { text: summarize(cfg.text) }; });
  });
  tool('sv_set_logo', 'sceneEdit', 'Edit logo settings. Authoring.', function (args, ctx) {
    return withConfig(ctx, function (cfg) { cfg.logo = mergeObj(cfg.logo || {}, (args && args.patch) || {}); return { logo: summarize(cfg.logo) }; });
  });
  tool('sv_set_media', 'sceneEdit', 'Edit media-layer settings. Authoring.', function (args, ctx) {
    return withConfig(ctx, function (cfg) { cfg.media = mergeObj(cfg.media || {}, (args && args.patch) || {}); return { media: summarize(cfg.media) }; });
  });
  tool('sv_set_geometry', 'sceneEdit', 'Edit geometry settings. Authoring.', function (args, ctx) {
    return withConfig(ctx, function (cfg) { cfg.geometry = mergeObj(cfg.geometry || {}, (args && args.patch) || {}); return { geometry: summarize(cfg.geometry) }; });
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
  tool('sv_add_effect', 'effectEdit', 'Add an effect to the global chain. Authoring.', function (args, ctx) {
    if (!args || !args.type) return fail('type is required.');
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
    return withConfig(ctx, function (cfg) {
      const found = findLayer(cfg, args);
      if (!found) return fail('Layer not found.');
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
      const found = findFx(layer.layer.postfx, args);
      if (!found || found.error) return fail((found && found.error) || 'Layer effect not found.');
      layer.layer.postfx.splice(found.index, 1);
      return { removed: found.fx.id || found.index, visual: visualState(cfg, ctx) };
    });
  });
  tool('sv_add_modulation_route', 'effectEdit', 'Add a modulation route. Authoring.', function (args, ctx) {
    const route = (args && args.route) || args;
    if (!route || !route.source || !route.target) return fail('source and target are required.');
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
      cfg.background = cfg.background || {};
      cfg.background.gradient = Object.assign({}, cfg.background.gradient, { colors: pal.colors.slice() });
      return { name: pal.name, colors: pal.colors.slice() };
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
  tool('sv_save_preset', 'presetEdit', 'Write a preset file in the app preset store. Authoring.', function (args, ctx) {
    if (!ctx.presets || !ctx.presets.save) return fail('Preset store is not available.');
    const preset = { id: args && args.id, name: (args && args.name) || 'MCP preset', kind: (args && args.kind) || 'milkdrop', source: (args && args.source) || '' };
    const saved = ctx.presets.save(preset);
    return { ok: true, preset: { id: (saved && saved.id) || preset.id, name: preset.name, kind: preset.kind } };
  });
  tool('sv_delete_preset', 'presetEdit', 'Delete a preset file. Authoring.', function (args, ctx) {
    if (!args || !args.id) return fail('id is required.');
    if (!ctx.presets || !ctx.presets.remove) return fail('Preset store is not available.');
    ctx.presets.remove(args.id);
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
      if (!Array.isArray(colors) || colors.length < 2) return fail('colors are required.');
      if (!Array.isArray(cfg.userPresets)) cfg.userPresets = [];
      const preset = { id: uid('up_'), name: (args && args.name) || ('Palette ' + (cfg.userPresets.length + 1)), colors: colors.slice() };
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
  tool('sv_set_power', 'output', 'Change fps cap and render scale.', function (args, ctx) { return outputPatch(ctx, 'power', args && args.patch); });
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
    return Promise.resolve(ctx.startExport(args || {})).then(function (r) { return r && r.ok === false ? r : Object.assign({ ok: true }, r || {}); });
  });
  tool('sv_cancel_export', 'export', 'Cancel the running offline export.', function (args, ctx) {
    if (!ctx.cancelExport) return fail('Export is not available in this process.');
    return Promise.resolve(ctx.cancelExport()).then(function (r) { return { ok: true, result: r == null ? true : r }; });
  });
  tool('sv_export_json', 'export', 'Write scenes or full config JSON to an explicit path. No save dialog.', function (args, ctx) {
    if (!args || !args.path) return fail('path is required.');
    if (!ctx.writeText) return fail('File export is not available in this process.');
    const cfg = configOf(ctx);
    const body = args.what === 'scenes' ? { type: 'sv-scenes', version: 1, scenes: cfg.scenes || [] } : cfg;
    return Promise.resolve(ctx.writeText(args.path, JSON.stringify(body, null, 2))).then(function () {
      return { ok: true, path: args.path, what: args.what || 'config' };
    });
  });
  tool('sv_save_snapshot', 'export', 'Capture the live canvas to a file. Reading a preview without saving is sv_get_preview.', function (args, ctx) {
    if (!args || !args.path) return fail('path is required.');
    if (!ctx.capturePreview || !ctx.writeBinary) return fail('Snapshot capture is not available in this process.');
    return Promise.resolve(ctx.capturePreview()).then(function (img) {
      if (!img || !img.dataUrl) return fail('No live canvas to capture.');
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
    const group = groupForPath(args.path);
    if (group === 'mcp') return fail(text('mcp.err.mcp', localeOf(ctx)));
    const mcp = normalizeMcp(configOf(ctx).mcp);
    if (!mcp.enabled) return fail(text('mcp.err.disabled', localeOf(ctx)).replace('{mode}', modeWord(minMode(group) || 'everything', localeOf(ctx))));
    if (!modeAllows(mcp, group)) return fail(modeBlockError(localeOf(ctx), minMode(group) || 'everything'));
    return withConfig(ctx, function (cfg) {
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
    try {
      const result = toolDef.fn(args || {}, ctx || {});
      if (result && typeof result.then === 'function') {
        return result.then(function (value) { return value || { ok: true }; }, function (e) { return fail(String((e && e.message) || e)); });
      }
      return result || { ok: true };
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
        result: { protocolVersion: protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'soundvisualizer', version: '3.1.5-beta' } },
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
  function clients(scriptPath, port) {
    const httpPort = normalizePort(port);
    const bundle = commandBundle(scriptPath, httpPort);
    return [
      { id: 'claude', title: 'Claude', steps: ['MCP açıkken bu uygulamayı açık tutun.', 'Windows’ta %APPDATA%\\Claude\\claude_desktop_config.json dosyasına mcpServers bloğunu ekleyin.', 'Claude Desktop’u tamamen kapatıp yeniden açın.'], snippet: bundle.json },
      { id: 'codex', title: 'Codex', steps: ['MCP açıkken bu uygulamayı açık tutun.', 'Tablo %USERPROFILE%\\.codex\\config.toml dosyasına eklenir. codex mcp add de aynı yere yazar.', 'Yeni bir Codex oturumu açın.'], snippet: bundle.toml },
      { id: 'cursor', title: 'Cursor', steps: ['MCP açıkken bu uygulamayı açık tutun.', 'Proje için .cursor/mcp.json, genel için %USERPROFILE%\\.cursor\\mcp.json kullanın.', 'Cursor MCP listesini yenileyin.'], snippet: bundle.json },
      { id: 'grok', title: 'Grok', steps: ['Grok için yayınlanmış tek bir MCP ayar dosyası yok.', 'Stdio kabul eden istemcide aşağıdaki komutu kullanın.', 'mcpServers JSON’unu o istemcinin MCP listesine yapıştırın.'], snippet: bundle.shell + '\n\n' + bundle.json },
      { id: 'grok-bot', title: 'Grok Bot', steps: ['Grok Bot yerel bir mcp.json yolu yayınlamıyor.', 'Aynı stdio komutunu MCP sunucusu olarak ekleyin.', 'Aşağıdaki mcpServers bloğu geçerlidir. Ayrı bir protokol yok.'], snippet: bundle.shell + '\n\n' + bundle.json },
      { id: 'ollama', title: 'Ollama', steps: ['Ollama ayrı bir MCP protokolü değildir. Ücretsiz yerel model, aynı MCP sunucusuna bağlanan bir istemcidir.', 'Ollama’yı kurun, bir model çekin ve yerelde ollama serve çalışsın.', 'MCP konuşan istemcide modeli Ollama’ya yöneltin ve bu stdio sunucusunu ekleyin.', 'Aşağıdaki blok bu sunucudur.'], snippet: bundle.json },
    ];
  }
  const api = {
    ALLOW_KEYS: ALLOW_KEYS, DEFAULT_MCP: DEFAULT_MCP, GROUP_LABEL: GROUP_LABEL,
    SCENE_KEYS: SCENE_KEYS, EFFECT_TYPES: EFFECT_TYPES,
    normalizeMcp: normalizeMcp, groupForPath: groupForPath, visualState: visualState,
    cardModel: cardModel, commandBundle: commandBundle, clients: clients, installPrompt: installPrompt,
    tools: function (locale) { return TOOLS.map(function (t) { return publicTool(t, locale || 'en'); }); },
    MODES: MODES, DEFAULT_PORT: DEFAULT_PORT,
    callTool: callTool, handleRpc: handleRpc,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVMcp = api;
})();
