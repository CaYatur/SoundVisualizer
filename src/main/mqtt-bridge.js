/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* MQTT / Home Assistant köprüsü: saf eşleme (ağ yok).

   Durum <taban>/state/<ad> konularına gider (retain). Home Assistant
   keşfi açıksa <önek>/<bileşen>/<düğüm>/<ad>/config yayınlanır.
   Komutlar (<taban>/set/<ad>) yalnız allowControl açıkken dinlenir ve
   sabit OSC ağacının mesajlarına çevrilir; uygulama onları OSC girişiyle
   aynı yoldan uygular (osc-tree.plan), ayrı bir yazma yolu yok. */

const TOPIC_RE = /^[A-Za-z0-9_\-/]{1,64}$/;

function clean(s, def) {
  const v = String(s == null ? '' : s).trim().replace(/^\/+|\/+$/g, '');
  return TOPIC_RE.test(v) && v.indexOf('//') < 0 ? v : def;
}

function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const port = Number(r.port);
  return {
    enabled: r.enabled === true,
    host: typeof r.host === 'string' ? r.host.trim().slice(0, 255) : '',
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 1883,
    tls: r.tls === true,
    username: typeof r.username === 'string' ? r.username.slice(0, 128) : '',
    password: typeof r.password === 'string' ? r.password.slice(0, 256) : '',
    baseTopic: clean(r.baseTopic, 'soundvisualizer'),
    discovery: r.discovery !== false,
    discoveryPrefix: clean(r.discoveryPrefix, 'homeassistant'),
    allowControl: r.allowControl === true,
  };
}

/* Yayınlanan durum: değerler metin (HA şablonsuz okusun). */
function stateOf(ctx) {
  const c = ctx || {};
  const s = c.show || {};
  const bpm = Number(c.bpm);
  return {
    blackout: s.blackout ? 'ON' : 'OFF',
    autovj: s.autovj ? 'ON' : 'OFF',
    bpm: Number.isFinite(bpm) && bpm > 0 ? String(Math.round(bpm * 10) / 10) : '0',
    track: String(s.track || '').slice(0, 255),
    scene: String(c.scene || '').slice(0, 255),
    visualizer: String(c.visualizer || ''),
    opacity: String(Math.round((Number.isFinite(Number(s.opacity)) ? Number(s.opacity) : 1) * 100) / 100),
  };
}

/* Önceki duruma göre değişenler: [{topic, payload, retain}] */
function stateMessages(prev, next, cfg) {
  const base = normalize(cfg).baseTopic;
  const out = [];
  for (const k of Object.keys(next)) {
    if (!prev || prev[k] !== next[k]) out.push({ topic: base + '/state/' + k, payload: next[k], retain: true });
  }
  return out;
}

function nodeIdOf(id) {
  const s = String(id || 'sv').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
  return s || 'sv';
}

/* Home Assistant MQTT keşfi. allowControl kapalıyken anahtarlar
   binary_sensor olarak gider ve komut konusu yayınlanmaz. Öbür türün eski
   kaydı boş retain mesajıyla silinir. */
function discoveryMessages(cfg, opts) {
  const c = normalize(cfg);
  const o = opts || {};
  const node = nodeIdOf(o.nodeId);
  const base = c.baseTopic;
  const pre = c.discoveryPrefix;
  const device = {
    identifiers: ['soundvisualizer_' + node],
    name: o.name || 'SoundVisualizer',
    manufacturer: 'CaYaDev',
    model: 'SoundVisualizer',
    sw_version: o.version || '',
  };
  const common = (key, name) => ({
    name,
    unique_id: 'soundvisualizer_' + node + '_' + key,
    state_topic: base + '/state/' + key,
    availability_topic: base + '/status',
    device,
  });
  const out = [];
  const put = (comp, key, payload) => out.push({ topic: pre + '/' + comp + '/' + node + '/' + key + '/config', payload: payload == null ? '' : JSON.stringify(payload), retain: true });
  const ctl = c.allowControl && c.discovery;
  for (const [key, name, icon] of [['blackout', 'Blackout', 'mdi:lightbulb-off'], ['autovj', 'Auto VJ', 'mdi:auto-mode']]) {
    if (!c.discovery) { put('switch', key, null); put('binary_sensor', key, null); continue; }
    const p = Object.assign(common(key, name), { payload_on: 'ON', payload_off: 'OFF', icon });
    if (ctl) { put('switch', key, Object.assign(p, { command_topic: base + '/set/' + key })); put('binary_sensor', key, null); }
    else { put('binary_sensor', key, p); put('switch', key, null); }
  }
  for (const [key, name, extra] of [
    ['bpm', 'Tempo', { unit_of_measurement: 'BPM', state_class: 'measurement', icon: 'mdi:metronome' }],
    ['track', 'Now playing', { icon: 'mdi:music' }],
    ['visualizer', 'Visualizer mode', { icon: 'mdi:waveform' }],
  ]) put('sensor', key, c.discovery ? Object.assign(common(key, name), extra) : null);
  // Sahne ve opaklık: kontrol açıkken yazılabilir, değilse sensör
  if (ctl) {
    put('text', 'scene', Object.assign(common('scene', 'Scene'), { command_topic: base + '/set/scene', icon: 'mdi:movie-open', max: 255 }));
    put('number', 'opacity', Object.assign(common('opacity', 'Master opacity'), { command_topic: base + '/set/opacity', min: 0, max: 1, step: 0.01, mode: 'slider' }));
    put('sensor', 'scene', null);
    put('sensor', 'opacity', null);
  } else {
    put('sensor', 'scene', c.discovery ? Object.assign(common('scene', 'Scene'), { icon: 'mdi:movie-open' }) : null);
    put('sensor', 'opacity', c.discovery ? common('opacity', 'Master opacity') : null);
    put('text', 'scene', null);
    put('number', 'opacity', null);
  }
  return out;
}

function commandTopics(cfg) {
  const c = normalize(cfg);
  if (!c.allowControl) return [];
  return [c.baseTopic + '/set/+'];
}

function onOff(payload) {
  const s = String(payload).trim().toUpperCase();
  if (s === 'ON' || s === '1' || s === 'TRUE') return 1;
  if (s === 'OFF' || s === '0' || s === 'FALSE') return 0;
  return null;
}

/* Gelen komut → OSC ağacı mesajları ([] = yok say). */
function commandToOsc(topic, payload, cfg, oscPrefix) {
  const c = normalize(cfg);
  if (!c.allowControl) return [];
  const head = c.baseTopic + '/set/';
  if (typeof topic !== 'string' || topic.indexOf(head) !== 0) return [];
  const key = topic.slice(head.length);
  const pre = oscPrefix || '/cayadev';
  const text = String(payload == null ? '' : payload).slice(0, 255);
  if (key === 'blackout' || key === 'autovj') {
    const v = onOff(text);
    return v == null ? [] : [{ address: pre + '/show/' + key, args: [v] }];
  }
  if (key === 'scene' || key === 'visualizer' || key === 'background') {
    const s = text.trim();
    return s ? [{ address: pre + '/' + key, args: [s] }] : [];
  }
  if (key === 'opacity') {
    const n = Number(text);
    return Number.isFinite(n) ? [{ address: pre + '/show/opacity', args: [Math.max(0, Math.min(1, n))] }] : [];
  }
  return [];
}

module.exports = { normalize, stateOf, stateMessages, discoveryMessages, commandTopics, commandToOsc, nodeIdOf };
