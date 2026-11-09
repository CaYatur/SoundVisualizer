/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Companion eylemleri → OSC mesajları. Adresler SoundVisualizer'ın sabit
   OSC ağacıyla (src/shared/osc-tree.js) birebir aynıdır; depo testleri her
   eylemin uygulamada bir adıma dönüştüğünü doğrular. Companion'a bağımlı
   değildir, düz Node ile test edilir. */

const DEFAULT_PREFIX = '/cayadev';
const PREFIX_RE = /^(\/[A-Za-z0-9_-]{1,32}){1,4}$/;

function prefixOf(p) {
  const s = String(p || '').replace(/\/+$/, '');
  return PREFIX_RE.test(s) ? s : DEFAULT_PREFIX;
}

const num = (id, label, def, min, max, step) => ({ type: 'number', id, label, default: def, min, max, step: step || 0.01 });
const txt = (id, label, def) => ({ type: 'textinput', id, label, default: def || '' });
const onOff = (id, label) => ({
  type: 'dropdown', id, label, default: 'on',
  choices: [{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }, { id: 'toggle', label: 'Toggle' }],
});

/* state: modülün son bildiği durum (geri bildirimden), "toggle" için. */
function boolOf(v, current) {
  if (v === 'toggle') return !current;
  return v !== 'off';
}

const ACTIONS = {
  blackout: {
    name: 'Blackout',
    options: [onOff('state', 'State')],
    build: (o, st) => [['/show/blackout', [{ type: 'i', value: boolOf(o.state, st.blackout) ? 1 : 0 }]]],
  },
  autovj: {
    name: 'Auto VJ',
    options: [onOff('state', 'State')],
    build: (o, st) => [['/show/autovj', [{ type: 'i', value: boolOf(o.state, st.autovj) ? 1 : 0 }]]],
  },
  scene: {
    name: 'Recall scene',
    options: [txt('name', 'Scene name', 'Scene 1')],
    build: (o) => (o.name ? [['/scene', [{ type: 's', value: String(o.name) }]]] : []),
  },
  visualizer: {
    name: 'Set visualizer mode',
    options: [txt('id', 'Mode id', 'bars')],
    build: (o) => (o.id ? [['/visualizer', [{ type: 's', value: String(o.id) }]]] : []),
  },
  background: {
    name: 'Set background mode',
    options: [txt('id', 'Background id', 'gradient')],
    build: (o) => (o.id ? [['/background', [{ type: 's', value: String(o.id) }]]] : []),
  },
  opacity: {
    name: 'Master opacity',
    options: [num('value', 'Opacity (0..1)', 1, 0, 1)],
    build: (o) => [['/show/opacity', [{ type: 'f', value: Number(o.value) }]]],
  },
  crossfade: {
    name: 'Crossfader',
    options: [num('value', 'Position (0..1)', 0, 0, 1)],
    build: (o) => [['/crossfade', [{ type: 'f', value: Number(o.value) }]]],
  },
  palette: {
    name: 'Palette',
    options: [{ type: 'dropdown', id: 'value', label: 'Palette', default: 'theme', choices: [{ id: 'theme', label: 'Theme' }, { id: 'solid', label: 'Solid' }, { id: 'rainbow', label: 'Rainbow' }] }],
    build: (o) => [['/show/palette', [{ type: 's', value: String(o.value || 'theme') }]]],
  },
  layer_opacity: {
    name: 'Layer opacity',
    options: [num('layer', 'Layer (1..32)', 1, 1, 32, 1), num('value', 'Opacity (0..1)', 1, 0, 1)],
    build: (o) => [['/layer/' + Math.round(Number(o.layer) || 1) + '/opacity', [{ type: 'f', value: Number(o.value) }]]],
  },
  layer_enabled: {
    name: 'Layer on/off',
    options: [num('layer', 'Layer (1..32)', 1, 1, 32, 1), onOff('state', 'State')],
    build: (o, st) => {
      const n = Math.round(Number(o.layer) || 1);
      const cur = st.layers && st.layers[n];
      return [['/layer/' + n + '/enabled', [{ type: 'i', value: boolOf(o.state, cur) ? 1 : 0 }]]];
    },
  },
  deck_launch: {
    name: 'Launch clip (deck)',
    options: [num('row', 'Row (from 0)', 0, 0, 64, 1), num('col', 'Column (from 0)', 0, 0, 64, 1)],
    build: (o) => [['/deck/launch', [{ type: 'i', value: Math.round(Number(o.row) || 0) }, { type: 'i', value: Math.round(Number(o.col) || 0) }]]],
  },
  deck_stop: {
    name: 'Stop clips (deck)',
    options: [],
    build: () => [['/deck/stop', [{ type: 'i', value: 1 }]]],
  },
  timeline_play: {
    name: 'Timeline play/pause',
    options: [{ type: 'dropdown', id: 'state', label: 'State', default: 'play', choices: [{ id: 'play', label: 'Play' }, { id: 'pause', label: 'Pause' }] }],
    build: (o) => [['/timeline/playing', [{ type: 'i', value: o.state === 'pause' ? 0 : 1 }]]],
  },
  timeline_stop: {
    name: 'Timeline stop',
    options: [],
    build: () => [['/timeline/stop', [{ type: 'i', value: 1 }]]],
  },
  milkdrop_preset: {
    name: 'MilkDrop preset',
    options: [txt('name', 'Preset name', '')],
    build: (o) => (o.name ? [['/milkdrop/preset', [{ type: 's', value: String(o.name) }]]] : []),
  },
  raw: {
    name: 'Custom slider path (float)',
    options: [txt('path', 'Slider path after prefix, e.g. audio/sensitivity', 'audio/sensitivity'), num('value', 'Value', 1, -100000, 100000)],
    build: (o) => {
      const p = String(o.path || '').replace(/^\/+/, '').replace(/\./g, '/');
      if (!/^[A-Za-z0-9_/]{1,128}$/.test(p)) return [];
      return [['/' + p, [{ type: 'f', value: Number(o.value) }]]];
    },
  },
};

/* Eylem → [{address, args}] (önek eklenmiş). */
function messages(actionId, options, prefix, state) {
  const a = ACTIONS[actionId];
  if (!a) return [];
  const pre = prefixOf(prefix);
  return a.build(options || {}, state || {}).map(([addr, args]) => ({ address: pre + addr, args }));
}

/* SoundVisualizer'ın OSC çıkışından gelen mesajla durum güncellenir.
   Değişen değişken adlarını döner. */
function applyFeedback(state, msg, prefix) {
  const pre = prefixOf(prefix);
  if (!msg || typeof msg.address !== 'string' || msg.address.indexOf(pre + '/') !== 0) return [];
  const key = msg.address.slice(pre.length + 1);
  const v = msg.args && msg.args[0];
  const set = (k, val) => { if (state[k] === val) return []; state[k] = val; return [k]; };
  if (key === 'show/blackout') return set('blackout', !!Number(v));
  if (key === 'show/autovj') return set('autovj', !!Number(v));
  if (key === 'show/track' && typeof v === 'string') return set('track', v);
  if (key === 'show/opacity' && Number.isFinite(Number(v))) return set('opacity', Math.round(Number(v) * 100) / 100);
  if (key === 'tempo/bpm' && Number.isFinite(Number(v))) return set('bpm', Math.round(Number(v) * 10) / 10);
  return [];
}

module.exports = { DEFAULT_PREFIX, ACTIONS, prefixOf, messages, applyFeedback };
