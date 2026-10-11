/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* OSC (Open Sound Control) ÇIKIŞI — UDP (#437).

   Görselleştiricinin ölçtüğünü başka yazılımlara yollar: Resolume,
   TouchDesigner, Max/MSP, ışık masaları. Uygulama böylece bir çözümleme
   kaynağı olur; OSC girişinin (osc-server.js) tersi.

   Adres ağacı README'de, türü ve aralığıyla. Önek varsayılan /cayadev.
   Seviye, bas, mid ve tiz TEK #bundle içinde gider: bir UDP kaybı bantları
   birbirinden koparamasın. Vuruş ve saat iletileri de bundle'dır ve OSC
   zaman etiketi taşır (ana bilgisayar saati). Böylece geç kalan bir paket
   hâlâ yerine oturtulabilir.

   GÜVENLİK: varsayılan kapalı. Hedef bu bilgisayarın açık OSC girişiyse
   gönderilmez. Her alan burada yeniden denetlenir. */

const dgram = require('dgram');
const dns = require('dns');
const net = require('net');
const os = require('os');

const DEFAULTS = {
  enabled: false,
  host: '127.0.0.1',
  port: 9001,
  rate: 30,
  prefix: '/cayadev',
  levels: true,
  hits: true,
  tempo: true,
  state: true,
  analysis: true,
  latencyMs: 0,
  extra: '',
};
const MAX_RATE = 30;
const BPM_STEP = 0.01; // bunun altındaki tempo oynaması gürültüdür
const HEARTBEAT_MS = 1000;
const STATE_REPEAT_MS = 5000;
const SILENCE_LEVEL = 0.008;
const SILENCE_HOLD_MS = 400;
const MAX_STRING = 200;
const MAX_TARGETS = 8;
const NTP_UNIX = 2208988800;
const LOOP = 'loop';
const STATE_KEYS = ['scene', 'visualizer', 'background', 'milkdrop/preset'];
const ANALYSIS_F = [
  'centroid', 'rolloff', 'flatness', 'crest', 'flux', 'spread',
  'loudness', 'peak', 'dynamics', 'harmonic', 'percussive', 'width',
];
/* Giriş ağacının kaydırıcıları. Çıkış bunları aynı yolda geri yollar. */
const CONTROL_PATHS = [
  { path: 'audio.sensitivity' },
  { path: 'audio.smoothing' },
  { path: 'audio.bassBoost' },
  { path: 'visualizer.sensitivity' },
  { path: 'visualizer.glow' },
  { path: 'visualizer.barCount', int: true },
  { path: 'visualizer.gap' },
  { path: 'visualizer.lineWidth' },
  { path: 'visualizer.thickness' },
  { path: 'visualizer.trailHeight' },
  { path: 'background.gradient.speed' },
  { path: 'background.gradient.audioReactivity' },
  { path: 'background.gradient.brightness' },
  { path: 'background.gradient.audioHue' },
  { path: 'background.gradient.vignette' },
  { path: 'logo.opacity' },
  { path: 'logo.scale' },
  { path: 'feedback.zoom' },
  { path: 'feedback.decay' },
  { path: 'feedback.warp' },
  { path: 'feedback.rotate' },
  { path: 'media.opacity' },
  { path: 'media.kaleido', int: true },
  { path: 'milkdrop.blendTime' },
  { path: 'milkdrop.autoNext', int: true },
  { path: 'milkdrop.autoNextRand', int: true },
  { path: 'milkdrop.hardCutThreshold' },
  { path: 'milkdrop.mesh' },
  { path: 'milkdrop.renderScale' },
];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const unit = (v) => (Number.isFinite(v) ? clamp(v, 0, 1) : 0);
const int32 = (v) => clamp(Math.round(Number(v) || 0), -2147483648, 2147483647);
const finite = (v) => (Number.isFinite(v) ? v : 0);

function readPath(obj, path) {
  let o = obj;
  for (const k of String(path || '').split('.')) {
    if (o == null) return undefined;
    o = o[k];
  }
  return o;
}

/* Girişin yazdığı kaydırıcıların şu anki değeri. Masa fader'ı bunu duyar. */
function controlValues(cfg) {
  const out = [];
  for (const s of CONTROL_PATHS) {
    const n = Number(readPath(cfg, s.path));
    if (!Number.isFinite(n)) continue;
    out.push({ path: s.path, int: !!s.int, value: s.int ? Math.round(n) : n });
  }
  return out;
}

// --------------------------------------------------------------- ayarlar
const HOSTNAME = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

function bareHost(h) {
  const s = typeof h === 'string' ? h.trim() : '';
  if (s.startsWith('[') && s.endsWith(']')) return s.slice(1, -1);
  return s;
}

/* IPv4, IPv6 (bölge kimliği yok) ya da çözülecek bir ana bilgisayar adı.
   "evil host" ve "a/b" kabul edilmez. */
function validHost(h) {
  const host = bareHost(h);
  if (!host || host.length > 253 || host.includes('%')) return false;
  if (net.isIPv4(host) || net.isIPv6(host)) return true;
  return HOSTNAME.test(host);
}

function parseTargetLine(line) {
  const s = String(line || '').trim();
  if (!s || s.startsWith('#')) return null;
  const bracket = s.match(/^\[([^\]]+)\]:(\d+)$/);
  const plain = bracket ? null : s.match(/^([^:\s]+):(\d+)$/);
  const m = bracket || plain;
  if (!m) return null;
  const port = Number(m[2]);
  if (!validHost(m[1]) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: bareHost(m[1]), port };
}

function targetsOf(o) {
  const list = [{ host: o.host, port: o.port }];
  const seen = new Set([o.host + ':' + o.port]);
  for (const line of String(o.extra || '').split(/\r?\n/)) {
    const t = parseTargetLine(line);
    if (!t) continue;
    const key = t.host + ':' + t.port;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(t);
    if (list.length >= MAX_TARGETS) break;
  }
  return list;
}

function normalize(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const host = bareHost(c.host);
  const port = Number(c.port);
  const rate = Number(c.rate);
  const prefix = typeof c.prefix === 'string' ? c.prefix.trim().replace(/\/+$/, '') : null;
  const latency = Number(c.latencyMs);
  return {
    enabled: c.enabled === true,
    host: validHost(host) ? host : DEFAULTS.host,
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULTS.port,
    rate: Number.isFinite(rate) ? clamp(Math.round(rate), 1, MAX_RATE) : DEFAULTS.rate,
    prefix: prefix !== null && /^(\/[A-Za-z0-9_-]{1,32}){0,4}$/.test(prefix) ? prefix : DEFAULTS.prefix,
    levels: c.levels !== false,
    hits: c.hits !== false,
    tempo: c.tempo !== false,
    state: c.state !== false,
    analysis: c.analysis !== false,
    latencyMs: Number.isFinite(latency) ? clamp(Math.round(latency), -2000, 2000) : DEFAULTS.latencyMs,
    extra: typeof c.extra === 'string' ? c.extra : DEFAULTS.extra,
  };
}

// ------------------------------------------------------------- kodlama
function oscString(s) {
  let str = String(s == null ? '' : s).replace(/\0/g, '');
  if (Buffer.byteLength(str, 'utf8') > MAX_STRING) {
    const chars = Array.from(str);
    while (chars.length && Buffer.byteLength(chars.join(''), 'utf8') > MAX_STRING) chars.pop();
    str = chars.join('');
  }
  const b = Buffer.from(str, 'utf8');
  const out = Buffer.alloc((Math.floor(b.length / 4) + 1) * 4);
  b.copy(out);
  return out;
}

function encodeMessage(address, args) {
  let tags = ',';
  const parts = [];
  for (const a of Array.isArray(args) ? args : []) {
    const t = a && a[0];
    const v = a && a[1];
    if (t === 'f') {
      const b = Buffer.alloc(4);
      b.writeFloatBE(Number.isFinite(v) ? v : 0, 0);
      parts.push(b);
      tags += 'f';
    } else if (t === 'i') {
      const b = Buffer.alloc(4);
      b.writeInt32BE(int32(v), 0);
      parts.push(b);
      tags += 'i';
    } else if (t === 's') {
      parts.push(oscString(v));
      tags += 's';
    }
  }
  return Buffer.concat([oscString(address), oscString(tags)].concat(parts));
}

/* OSC zaman etiketi: 1900 tabanlı NTP, 32 bit saniye + 32 bit kesir.
   2036 taşması bu sürümün ömründe yok. Negatif saat 0'a çekilir. */
function ntpTimetag(ms) {
  const t = Number.isFinite(ms) ? ms : 0;
  const clamped = t < 0 ? 0 : t;
  const sec = Math.floor(clamped / 1000) + NTP_UNIX;
  const frac = Math.round((clamped % 1000) / 1000 * 0x100000000);
  const b = Buffer.alloc(8);
  b.writeUInt32BE(sec >>> 0, 0);
  b.writeUInt32BE((frac >= 0x100000000 ? 0xffffffff : frac) >>> 0, 4);
  return b;
}

function encodeBundle(messages, timeMs) {
  const parts = [oscString('#bundle'), ntpTimetag(timeMs)];
  for (const [address, args] of messages || []) {
    const m = encodeMessage(address, args);
    const size = Buffer.alloc(4);
    size.writeInt32BE(m.length, 0);
    parts.push(size, m);
  }
  return Buffer.concat(parts);
}

function asBundle(now, messages) {
  if (!messages || !messages.length) return null;
  return { bundle: true, time: Number.isFinite(now) ? now : 0, messages };
}

/* Pozitif gecikme saati geri alır (hoparlör geç kalıyorsa ışık bekler).
   Negatif gecikme saati öne alır. Vuruş numarası değişmez; yalnız faz kayar. */
function phaseShift(phase, bpm, latencyMs) {
  let p = Number(phase);
  if (!Number.isFinite(p)) return 0;
  p = ((p % 1) + 1) % 1;
  if (!latencyMs || !Number.isFinite(bpm) || bpm <= 0) return p;
  p -= latencyMs / (60000 / bpm);
  return ((p % 1) + 1) % 1;
}

// ----------------------------------------------------------------- plan
class Planner {
  constructor() { this.reset(); }

  reset() {
    this.levelsDue = -Infinity;
    this.clockDue = -Infinity;
    this.bpm = null;
    this.bpmAt = -Infinity;
    this.stateAt = -Infinity;
    this.state = {};
    for (const k of STATE_KEYS) this.state[k] = '';
    this.hitOpen = { kick: 0, snare: 0, hat: 0 };
    this.downbeat = false;
    this.transport = '';
    this.transportAt = -Infinity;
    this.timeline = null;
    this.timelineAt = -Infinity;
    this.silent = false;
    this.quietAt = -Infinity;
    this.colors = null;
    this.show = {};
    this.layerCount = 0;
    this.layerSig = null;
    this.deckSig = null;
  }

  frame(o, frame, ctx, now) {
    const out = [];
    const f = frame || {};
    const c = ctx || {};
    this._levels(out, o, f, now);
    this._hits(out, o, f.hits, now);
    this._clock(out, o, c, now);
    this._silence(out, o, f, now);
    this._state(out, o, f, c, now);
    return out;
  }

  /* Çizim karesinin gördüğü vuruş. Ölçer iletisine binmez. */
  hits(o, hits, now) {
    const out = [];
    this._hits(out, o, hits, now);
    return out;
  }

  /* Panelin tempo motoru: faz, çalma ve gösteri durumu. Sahne adlarını
     silmez; onlar ölçer bağlamından gelir. */
  clock(o, info, now) {
    const out = [];
    const i = info && typeof info === 'object' ? info : {};
    this._clock(out, o, i, now);
    if (i.show && typeof i.show === 'object') {
      const repeat = now - this.stateAt >= STATE_REPEAT_MS;
      if (repeat) this.stateAt = now;
      this._show(out, o, {}, i, now, repeat);
    }
    return out;
  }

  beat(o, info, now) {
    if (!o.tempo || !info || typeof info !== 'object') return [];
    const n = clamp(int32(info.beatsPerBar) || 4, 1, 64);
    const b = int32(info.beat);
    if (b < 1 || b > n) return [];
    const p = o.prefix;
    const messages = [[p + '/tempo/beat', [['i', b], ['i', n]]]];
    if (b === 1) {
      messages.push([p + '/tempo/downbeat', [['f', 1]]]);
      this.downbeat = true;
    }
    const item = asBundle(now, messages);
    return item ? [item] : [];
  }

  _due(now, slot, period) {
    if (now < this[slot]) return false;
    this[slot] = (this[slot] < now - period ? now : this[slot]) + period;
    return true;
  }

  _levels(out, o, f, now) {
    const want = o.levels || o.analysis;
    if (!want || !this._due(now, 'levelsDue', 1000 / o.rate)) return;
    const p = o.prefix;
    const messages = [];
    if (o.levels) {
      for (const k of ['level', 'bass', 'mid', 'treble']) messages.push([p + '/' + k, [['f', unit(f[k])]]]);
    }
    if (o.analysis && f.analysis && typeof f.analysis === 'object') {
      const a = f.analysis;
      for (const k of ANALYSIS_F) messages.push([p + '/analysis/' + k, [['f', unit(a[k])]]]);
      messages.push([p + '/analysis/correlation', [['f', clamp(finite(a.correlation), -1, 1)]]]);
      messages.push([p + '/analysis/pitch', [['f', finite(a.pitchHz)]]]);
      messages.push([p + '/analysis/pitch/note', [['s', a.pitchNote || '']]]);
      messages.push([p + '/analysis/pitch/confidence', [['f', unit(a.pitchConfidence)]]]);
      messages.push([p + '/analysis/key', [['s', a.key || '']]]);
      messages.push([p + '/analysis/key/confidence', [['f', unit(a.keyConfidence)]]]);
      messages.push([p + '/analysis/chord', [['s', a.chord || '']]]);
      messages.push([p + '/analysis/chord/confidence', [['f', unit(a.chordConfidence)]]]);
    }
    if (o.analysis && Array.isArray(f.spectrum) && f.spectrum.length) {
      const bands = f.spectrum.slice(0, 32).map((v) => ['f', unit(v)]);
      messages.push([p + '/spectrum', bands]);
    }
    const item = asBundle(now, messages);
    if (item) out.push(item);
  }

  _hits(out, o, hits, now) {
    if (!o.hits || !hits || typeof hits !== 'object') return;
    const p = o.prefix;
    const messages = [];
    for (const k of ['kick', 'snare', 'hat']) {
      const v = unit(hits[k]);
      if (v > 0) {
        messages.push([p + '/hit/' + k, [['f', v]]]);
        this.hitOpen[k] = v;
      } else if (this.hitOpen[k] > 0) {
        messages.push([p + '/hit/' + k, [['f', 0]]]);
        this.hitOpen[k] = 0;
      }
    }
    const item = asBundle(now, messages);
    if (item) out.push(item);
  }

  _clock(out, o, c, now) {
    if (!o.tempo) return;
    const p = o.prefix;
    const messages = [];
    if (Number.isFinite(c.bpm) && c.bpm > 0) {
      if (this.bpm === null || Math.abs(c.bpm - this.bpm) >= BPM_STEP || now - this.bpmAt >= HEARTBEAT_MS) {
        this.bpm = c.bpm;
        this.bpmAt = now;
        messages.push([p + '/tempo/bpm', [['f', c.bpm]]]);
        messages.push([p + '/tempo/confidence', [['f', unit(c.confidence)]]]);
      }
    }
    const phaseDue = Number.isFinite(c.phase) && this._due(now, 'clockDue', 1000 / o.rate);
    if (phaseDue) {
      const phase = phaseShift(c.phase, c.bpm || this.bpm, o.latencyMs);
      const n = clamp(int32(c.beatsPerBar) || 4, 1, 64);
      const b = int32(c.beat);
      const bar = b >= 1 && b <= n ? ((b - 1) + phase) / n : phase / n;
      messages.push([p + '/tempo/beat/phase', [['f', phase]]]);
      messages.push([p + '/tempo/bar/phase', [['f', bar]]]);
    }
    if (this.downbeat) {
      messages.push([p + '/tempo/downbeat', [['f', 0]]]);
      this.downbeat = false;
    }
    if (typeof c.playing === 'boolean') {
      const s = c.playing ? 'playing' : 'stopped';
      if (s !== this.transport || now - this.transportAt >= HEARTBEAT_MS) {
        this.transport = s;
        this.transportAt = now;
        messages.push([p + '/transport', [['s', s]]]);
      }
    }
    if (c.show && typeof c.show.timeline === 'boolean') {
      const on = c.show.timeline ? 1 : 0;
      if (on !== this.timeline || now - this.timelineAt >= HEARTBEAT_MS) {
        this.timeline = on;
        this.timelineAt = now;
        messages.push([p + '/timeline/playing', [['i', on]]]);
      }
    }
    const item = asBundle(now, messages);
    if (item) out.push(item);
  }

  _silence(out, o, f, now) {
    if (!o.levels || !Number.isFinite(f.level)) return;
    const p = o.prefix;
    if (unit(f.level) < SILENCE_LEVEL) {
      if (this.quietAt < 0) this.quietAt = now;
      if (!this.silent && now - this.quietAt >= SILENCE_HOLD_MS) {
        this.silent = true;
        out.push([p + '/silence', [['i', 1]]]);
      }
    } else if (this.silent || this.quietAt >= 0) {
      const was = this.silent;
      this.silent = false;
      this.quietAt = -Infinity;
      if (was) out.push([p + '/silence', [['i', 0]]]);
    }
  }

  _state(out, o, f, c, now) {
    if (!o.state) return;
    const repeat = now - this.stateAt >= STATE_REPEAT_MS;
    if (repeat) this.stateAt = now;
    this._names(out, o, f, c, now, repeat);
    this._colors(out, o, f, c, now, repeat);
    this._show(out, o, f, c, now, repeat);
  }

  _names(out, o, f, c, now, repeat) {
    const p = o.prefix;
    const md = f.mdPreset && typeof f.mdPreset === 'object' ? f.mdPreset.name : '';
    const cur = {
      scene: c.scene,
      visualizer: c.visualizer,
      background: c.background,
      'milkdrop/preset': md,
    };
    const messages = [];
    for (const k of STATE_KEYS) {
      if (typeof cur[k] !== 'string') continue;
      const v = cur[k];
      // Boş preset de beş saniyede bir yinelenir: geç açılan alıcı "yok"u duyar.
      if (v !== this.state[k] || repeat) {
        this.state[k] = v;
        messages.push([p + '/' + k, [['s', v]]]);
      }
    }
    const item = asBundle(now, messages);
    if (item) out.push(item);
  }

  _colors(out, o, f, c, now, repeat) {
    const fromFrame = Array.isArray(f.backgroundColors) ? f.backgroundColors : null;
    const fromCfg = Array.isArray(c.colors) ? c.colors : null;
    const colors = (fromFrame && fromFrame.length ? fromFrame : fromCfg) || [];
    const sig = colors.slice(0, 8).map((x) => (typeof x === 'string' ? x : '')).join('|');
    if (this.colors === null && !sig) { this.colors = ''; return; }
    if (sig === this.colors && !(repeat && sig)) return;
    this.colors = sig;
    const p = o.prefix;
    const messages = [];
    const n = Math.min(8, colors.length);
    for (let i = 0; i < n; i++) messages.push([p + '/background/color/' + (i + 1), [['s', String(colors[i] || '')]]]);
    if (!n && this.colors === '') messages.push([p + '/background/color/1', [['s', '']]]);
    const item = asBundle(now, messages);
    if (item) out.push(item);
  }

  _show(out, o, f, c, now, repeat) {
    if (!o.state) return;
    const show = c.show && typeof c.show === 'object' ? c.show : null;
    if (!show) return;
    const p = o.prefix;
    const messages = [];
    const put = (key, address, args) => {
      const sig = JSON.stringify(args);
      if (this.show[key] === sig && !repeat) return;
      this.show[key] = sig;
      messages.push([address, args]);
    };
    if (typeof show.blackout === 'boolean') put('blackout', p + '/show/blackout', [['i', show.blackout ? 1 : 0]]);
    if (typeof show.palette === 'string') put('palette', p + '/show/palette', [['s', show.palette]]);
    if (Number.isFinite(show.brightness)) put('brightness', p + '/show/brightness', [['f', show.brightness]]);
    if (typeof show.transition === 'string') put('transition', p + '/show/transition', [['s', show.transition]]);
    if (typeof show.autovj === 'boolean') put('autovj', p + '/show/autovj', [['i', show.autovj ? 1 : 0]]);
    if (typeof show.track === 'string') put('track', p + '/show/track', [['s', show.track]]);
    if (Array.isArray(show.layers)) {
      const layers = show.layers.slice(0, 32).map((l) => ({
        name: l && typeof l.name === 'string' ? l.name : '',
        opacity: l && Number.isFinite(Number(l.opacity)) ? unit(Number(l.opacity)) : 1,
        enabled: !(l && l.enabled === false),
      }));
      const sig = JSON.stringify(layers);
      if (sig !== this.layerSig || repeat) {
        this.layerSig = sig;
        messages.push([p + '/layer/count', [['i', layers.length]]]);
        for (let i = 0; i < layers.length; i++) {
          const n = i + 1;
          messages.push([p + '/layer/' + n + '/name', [['s', layers[i].name]]]);
          messages.push([p + '/layer/' + n + '/opacity', [['f', layers[i].opacity]]]);
          messages.push([p + '/layer/' + n + '/enabled', [['i', layers[i].enabled ? 1 : 0]]]);
        }
        for (let i = layers.length; i < this.layerCount; i++) {
          const n = i + 1;
          messages.push([p + '/layer/' + n + '/opacity', [['f', 0]]]);
          messages.push([p + '/layer/' + n + '/enabled', [['i', 0]]]);
        }
        this.layerCount = layers.length;
      }
    }
    if (show.deck && typeof show.deck === 'object') {
      const row = int32(show.deck.row);
      const col = int32(show.deck.col);
      const active = typeof show.deck.active === 'string' ? show.deck.active : '';
      const sig = row + ':' + col + ':' + active;
      if (sig !== this.deckSig || repeat) {
        this.deckSig = sig;
        messages.push([p + '/deck/row', [['i', row]]]);
        messages.push([p + '/deck/col', [['i', col]]]);
        messages.push([p + '/deck/active', [['s', active]]]);
      }
    }
    if (Number.isFinite(show.opacity)) put('opacity', p + '/show/opacity', [['f', clamp(show.opacity, 0, 1)]]);
    if (Number.isFinite(show.crossfade)) put('crossfade', p + '/crossfade', [['f', clamp(show.crossfade, 0, 1)]]);
    if (Array.isArray(show.controls)) {
      for (const c of show.controls) {
        if (!c || typeof c.path !== 'string' || !Number.isFinite(Number(c.value))) continue;
        const addr = p + '/' + c.path.replace(/\./g, '/');
        if (c.int) put('c:' + c.path, addr, [['i', int32(c.value)]]);
        else put('c:' + c.path, addr, [['f', Number(c.value)]]);
      }
    }
    const item = asBundle(now, messages);
    if (item) out.push(item);
  }
}

// --------------------------------------------------------- geri besleme
function ipKey(addr) {
  return String(addr || '').split('%')[0].toLowerCase();
}

function isLocalAddress(addr) {
  if (typeof addr !== 'string' || !addr) return false;
  const key = ipKey(addr);
  if (key === 'localhost' || key === '0.0.0.0' || key === '255.255.255.255' || key === '::' || key === '::1') return true;
  if (/^127\./.test(key)) return true;
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const a of ifs[name] || []) {
      if (!a) continue;
      const family = a.family === 4 || a.family === 'IPv4' ? 4 : (a.family === 6 || a.family === 'IPv6' ? 6 : 0);
      if (family === 4) {
        if (a.address === addr) return true;
        if (a.netmask && net.isIPv4(a.address) && net.isIPv4(a.netmask)) {
          const ip = a.address.split('.').map(Number);
          const mask = a.netmask.split('.').map(Number);
          if (ip.map((x, i) => (x | (~mask[i] & 255))).join('.') === addr) return true;
        }
      } else if (family === 6 && ipKey(a.address) === key) return true;
    }
  }
  return false;
}

function loopError(o, address, oscIn) {
  if (!oscIn || oscIn.enabled !== true || Number(oscIn.port) !== o.port) return null;
  return isLocalAddress(address || o.host) ? LOOP : null;
}

// ---------------------------------------------------------------- soket
let sockets = [];
let live = [];
let started = '';
let startGen = 0;
const planner = new Planner();
let state = { running: false, host: '', address: '', port: 0, targets: 0, packets: 0, lastSend: 0, error: null };
let holdTimer = null;

function familyOf(address) {
  return net.isIPv6(address) ? 6 : 4;
}

function resolveHost(host) {
  if (net.isIPv4(host)) return Promise.resolve({ address: host, family: 4 });
  if (net.isIPv6(host)) return Promise.resolve({ address: host, family: 6 });
  if (host === 'localhost') return Promise.resolve({ address: '127.0.0.1', family: 4 });
  return new Promise((resolve, reject) => {
    dns.lookup(host, { verbatim: true }, (err, address) => (err ? reject(err) : resolve({ address, family: familyOf(address) })));
  });
}

function openSocket(family) {
  return new Promise((resolve) => {
    const s = dgram.createSocket({ type: family === 6 ? 'udp6' : 'udp4' });
    const fail = (err) => {
      state.error = (err && (err.code || err.message)) || 'socket';
      try { s.close(); } catch { /* zaten kapalı */ }
      resolve(null);
    };
    s.once('error', fail);
    s.bind(() => {
      s.removeListener('error', fail);
      s.on('error', (err) => { state.error = err.code || err.message; });
      if (family === 4) { try { s.setBroadcast(true); } catch { /* yayın yoksa tek adrese devam */ } }
      resolve(s);
    });
  });
}

function closeSockets() {
  const list = sockets;
  sockets = [];
  live = [];
  for (const s of list) {
    try { s.close(); } catch { /* zaten kapalı */ }
  }
}

function start(cfg, oscIn) {
  const o = normalize(cfg);
  if (!o.enabled) return stop().then(status);
  const wanted = targetsOf(o);
  const key = wanted.map((t) => t.host + ':' + t.port).join('|');
  if (sockets.length && state.running && started === key) {
    live.forEach((t) => { t.loop = loopError({ port: t.port }, t.address, oscIn) === LOOP; });
    const usable = live.filter((t) => !t.loop);
    state.error = usable.length ? null : LOOP;
    state.targets = live.length;
    return Promise.resolve(status());
  }
  const gen = ++startGen;
  return stop({ keepGen: true }).then(() => {
    if (gen !== startGen) return status();
    return Promise.all(wanted.map((t) => resolveHost(t.host).then((r) => Object.assign({}, t, r)).catch((err) => ({ error: err }))))
      .then((resolved) => {
        if (gen !== startGen) return status();
        const ok = resolved.filter((t) => t.address);
        if (!ok.length) {
          const err = resolved[0] && resolved[0].error;
          state = { running: false, host: o.host, address: '', port: o.port, targets: 0, packets: 0, lastSend: 0, error: (err && (err.code || err.message)) || 'resolve' };
          return status();
        }
        const families = [...new Set(ok.map((t) => t.family))];
        return Promise.all(families.map((f) => openSocket(f).then((s) => [f, s]))).then((pairs) => {
          if (gen !== startGen) {
            for (const [, s] of pairs) if (s) { try { s.close(); } catch { /* kapanan deneme */ } }
            return status();
          }
          sockets = pairs.filter(([, s]) => s).map(([, s]) => s);
          const byFamily = {};
          pairs.forEach(([f, s]) => { if (s) byFamily[f] = s; });
          live = ok.filter((t) => byFamily[t.family]).map((t) => ({
            address: t.address,
            port: t.port,
            family: t.family,
            socket: byFamily[t.family],
            loop: loopError({ port: t.port }, t.address, oscIn) === LOOP,
          }));
          started = key;
          planner.reset();
          const usable = live.filter((t) => !t.loop);
          const first = live[0];
          state = {
            running: true,
            host: o.host,
            address: first ? first.address : '',
            port: o.port,
            targets: live.length,
            packets: 0,
            lastSend: 0,
            error: usable.length ? null : LOOP,
          };
          return status();
        });
      });
  });
}

function stop(opts) {
  if (!opts || !opts.keepGen) startGen++;
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  state.running = false;
  started = '';
  closeSockets();
  return Promise.resolve();
}

function datagram(item) {
  if (item && item.bundle) return encodeBundle(item.messages, item.time);
  if (Array.isArray(item)) return encodeMessage(item[0], item[1]);
  return null;
}

function emitNow(items) {
  const targets = live.filter((t) => !t.loop && t.socket);
  if (!targets.length) return 0;
  let n = 0;
  for (const item of items) {
    const buf = datagram(item);
    if (!buf) continue;
    for (const t of targets) {
      try {
        t.socket.send(buf, t.port, t.address, (err) => {
          if (err) state.error = err.code || err.message;
          else {
            state.packets++;
            state.lastSend = Date.now();
          }
        });
        n++;
      } catch (err) {
        state.error = err.message;
      }
    }
  }
  return n;
}

function emit(o, items) {
  if (!items.length) return 0;
  const delay = Math.max(0, o.latencyMs || 0);
  if (!delay) return emitNow(items);
  holdTimer = setTimeout(() => {
    holdTimer = null;
    if (state.running) emitNow(items);
  }, delay);
  return items.length * Math.max(1, live.filter((t) => !t.loop).length);
}

function ready(cfg) {
  if (!sockets.length || !state.running || state.error === LOOP) return null;
  const o = normalize(cfg);
  return o.enabled ? o : null;
}

function send(cfg, frame, ctx) {
  const o = ready(cfg);
  return o ? emit(o, planner.frame(o, frame, ctx, Date.now())) : 0;
}

function beat(cfg, info) {
  const o = ready(cfg);
  return o ? emit(o, planner.beat(o, info, Date.now())) : 0;
}

function hit(cfg, hits) {
  const o = ready(cfg);
  return o ? emit(o, planner.hits(o, hits, Date.now())) : 0;
}

function clock(cfg, info) {
  const o = ready(cfg);
  const when = info && Number.isFinite(info.hostTime) ? info.hostTime : Date.now();
  return o ? emit(o, planner.clock(o, info, when)) : 0;
}

function status() {
  return Object.assign({}, state);
}

module.exports = {
  start, stop, send, beat, hit, clock, status,
  normalize, encodeMessage, encodeBundle, oscString, ntpTimetag, phaseShift,
  Planner, isLocalAddress, loopError, targetsOf, validHost, controlValues, CONTROL_PATHS,
  DEFAULTS, LOOP, NTP_UNIX,
};
