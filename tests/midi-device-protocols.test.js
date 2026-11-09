'use strict';
/* Üretici belgelerinden BAĞIMSIZ beklenen tablolar ve çift yönlü Web MIDI
   aygıtları. Belgeler/sayfa numaraları docs/midi-controllers.md içinde.
   Bu testler USB sürücüsünü ya da gerçek aygıt yazılımını taklit ettiklerini
   kanıtlamaz; yalnız belgelenmiş protokol sözleşmesini sınar. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { createRequire } = require('node:module');
global.window = global.window || {};
require('../src/shared/defaults.js');
const CM = require('../src/shared/controller-maps.js');
const FB = require('../src/shared/midi-feedback.js');
const Schema = require('../src/shared/schema.js');
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const sources = (kind, channel, nums) => nums.map((n) => [kind, channel, n]);
const CC = (nums) => sources('cc', 1, nums);
const NN = (nums) => sources('note', 1, nums);
const ints = (first, n) => range(n, (i) => first + i);
const VENDORS = [
  {
    id: 'nanokontrol2', model: 'korg', on: 127,
    names: [
      ['nanoKONTROL2', 'nanoKONTROL2'],
      ['nanoKONTROL2 SLIDER/KNOB', 'nanoKONTROL2 CTRL'],
      ['nanoKONTROL2:nanoKONTROL2 MIDI 1 24:0', 'nanoKONTROL2:nanoKONTROL2 MIDI 1 24:0'],
    ],
    // Korg: özellikle ayarlanmış CC sahnesi; fabrika ataması iddiası YOK.
    sources: CC([...ints(0, 8), ...ints(16, 8), ...ints(32, 8), 41, 42, 61, 62, 58, 59]),
    leds: CC([...ints(32, 8), 41, 42]),
  },
  {
    id: 'apc40mk2', model: 'apc', on: 5,
    names: [['APC40 mkII', 'APC40 mkII'], ['APC40 mkII', 'APC40 mkII'], ['APC40 mkII 28:0', 'APC40 mkII 28:0']],
    sources: [...range(8, (i) => ['cc', i + 1, 7]), ...CC(ints(48, 8)), ...NN(ints(32, 8)),
      ...CC([14]), ...NN([82, 83, 84, 85, 86, 81, 91])],
    leds: [...CC(ints(48, 8)), ...NN([...ints(32, 8), 82, 83, 84, 85, 86, 91])],
    mode: [0xf0, 0x47, 0x7f, 0x29, 0x60, 0, 4, 0x42, 4, 0, 0, 0xf7],
  },
  ...[
    ['mini', 'LPMiniMK3', 'Launchpad Mini MK3', 0x0d, 2],
    ['x', 'LPX', 'Launchpad X', 0x0c, 2],
    ['pro', 'LPProMK3', 'Launchpad Pro MK3', 0x0e, 1],
  ].map(([model, usb, name, code, port]) => ({
    id: 'launchpad', model, on: 5,
    names: [
      [port === 1 ? usb : `MIDIIN${port} (${usb})`, port === 1 ? usb : `MIDIOUT${port} (${usb})`],
      [`${usb} MIDI In`, `${usb} MIDI Out`],
      [`${name} 32:${port - 1}`, `${name} 32:${port - 1}`],
    ],
    sources: [...NN(ints(11, 8)), ...CC(ints(91, 8))],
    leds: [...NN(ints(11, 8)), ...CC(ints(91, 8))],
    mode: [0xf0, 0, 0x20, 0x29, 2, code, 0x0e, 1, 0xf7],
  })),
  {
    id: 'push2', model: 'push', on: 126,
    names: [
      ['MIDIIN2 (Ableton Push 2) 3', 'MIDIOUT2 (Ableton Push 2) 3'],
      ['Ableton Push 2 User Port', 'Ableton Push 2 User Port'],
      ['Ableton Push 2 36:1', 'Ableton Push 2 36:1'],
    ],
    sources: [...CC(ints(71, 8)), ...NN(ints(36, 8)), ...CC([85])],
    leds: [...NN(ints(36, 8)), ...CC([85])],
    mode: [0xf0, 0, 0x21, 0x1d, 1, 1, 0x0a, 1, 0xf7],
  },
];
// Pro birinci portu numarasızsa rolü açıkça MIDI etiketiyle sunulur.
VENDORS.find((v) => v.model === 'pro').names[0] = ['LPProMK3 MIDI', 'LPProMK3 MIDI'];
const key = (m) => m.join(':');
const bytesOf = ([kind, channel, num], raw, release) => [(kind === 'cc' ? 0xb0 : release ? 0x80 : 0x90) | (channel - 1), num, raw];
const srcOf = (m) => [m.kind, m.channel, m.cc];

function harness(vendor, os = 0, opts = {}) {
  const cfg = global.window.SV.defaultConfig();
  const maps = CM.toMappings(CM.byId(vendor.id));
  Object.assign(cfg.control.midi, { enabled: opts.enabled !== false, deviceId: 'in', mappings: maps,
    feedback: { enabled: opts.feedback !== false, outputId: 'auto', onVelocity: 127, offVelocity: 0 } });
  let clock = 1000;
  let mode = !vendor.mode;
  let blackout = false;
  let turns = 0;
  const calls = [];
  const sent = [];
  const leds = new Map();
  const requests = [];
  const input = { id: 'in', name: vendor.names[os][0], state: 'connected', onmidimessage: null };
  const output = { id: 'out', name: vendor.names[os][1], state: 'connected', send(data) {
    const b = Array.from(data); sent.push(b);
    if (b[0] === 0xf0) {
      assert.ok(vendor.mode, 'bu model için kip komutu belgelenmedi');
      const expected = [...vendor.mode];
      const at = vendor.model === 'apc' ? 7 : expected.length - 2;
      const restoring = b[at] === (vendor.model === 'apc' ? 0x40 : 0);
      if (restoring) expected[at] = vendor.model === 'apc' ? 0x40 : 0;
      assert.deepEqual(b, expected, 'SysEx baytları üretici sözleşmesiyle aynı');
      mode = !restoring;
      if (vendor.model === 'push') emit(b); // Set MIDI Mode onayı iki porta da gider
      return;
    }
    if (!mode) return; // Yanlış kipte normal MIDI yok sayılır.
    if (vendor.model === 'apc' && b[0] === 0xb0 && b[1] >= 0x38 && b[1] <= 0x3f) {
      assert.equal(b[2], 1); return;
    }
    const source = [b[0] >> 4 === 9 ? 'note' : 'cc', (b[0] & 15) + 1, b[1]];
    assert.ok(vendor.leds.some((s) => key(s) === key(source)), 'belgelenmiş LED değil: ' + b);
    leds.set(key(source), b[2]);
    if (opts.echo !== false) emit(b);
  } };
  const access = { inputs: new Map([['in', input]]), outputs: new Map([['out', output]]), sysexEnabled: false };
  const get = (p) => p.split('.').reduce((o, k) => o && o[k], cfg);
  const set = (p, val) => { const parts = p.split('.'); const last = parts.pop(); parts.reduce((o, k) => o[k], cfg)[last] = val; };
  const transport = { playing: false, time: 0, tl: cfg.timeline };
  const timers = new Set();
  const window = { SV: global.window.SV, SVPanel: {
    cfg: () => cfg, get, set, push() {}, rerender() {}, toast() {},
    isBlackedOut: () => blackout, toggleBlackout: () => { blackout = !blackout; turns++; },
  }, SVControllerMaps: CM, SVMidiFeedback: { ...FB, create: (o) => FB.create({ ...o, now: () => clock }) },
  SVMilkdropPanel: { act(a) { if (a === 'Lock') cfg.milkdropControl.locked = !cfg.milkdropControl.locked; } },
  SVTimeline: require('../src/shared/timeline.js'),
  SVTimelinePanel: { transport: () => transport, play: () => { transport.playing = true; }, pause: () => { transport.playing = false; }, stop: () => { transport.playing = false; transport.time = 0; }, seek: (t) => { transport.time = t; } },
  _calls: calls };
  const context = vm.createContext({
    window, console, document: { getElementById: () => null, querySelectorAll: () => [] },
    navigator: { requestMIDIAccess: async (o) => { requests.push(o); if (o.sysex && opts.denySysex) throw Error('denied'); access.sysexEnabled = !!o.sysex; return access; } },
    require: createRequire(require.resolve('../src/admin/control.js')),
    Date: { now: () => clock }, performance: { now: () => clock },
    setInterval: (fn) => { timers.add(fn); return fn; }, clearInterval: (fn) => timers.delete(fn),
  });
  let source = fs.readFileSync(require.resolve('../src/admin/control.js'), 'utf8');
  source = source.replace('  window.SVControl = {', '  window._midi = { initMidi, bindMidiInputs, feedbackTick, syncFeedback, prepareController };\n  window.SVControl = {');
  source = source.replace('  function applyMappingManual(map, value01) {', '  function applyMappingManual(map, value01) { window._calls.push([map.kind, map.channel, map.cc, value01]);');
  vm.runInContext(source, context);
  function emit(b) { if (input.onmidimessage) input.onmidimessage({ data: Uint8Array.from(b), currentTarget: input }); }
  function press(source, raw, release) { clock += 200; if (mode) emit(bytesOf(source, raw, release)); }
  return { cfg, get, maps, calls, sent, leds, requests, input, output, access, timers, t: window._midi, emit, press,
    blackout: () => blackout, resetBlackout: () => { blackout = false; }, turns: () => turns, mode: () => mode };
}

for (const v of VENDORS) for (const [os, label] of ['Windows', 'macOS', 'Linux'].entries()) {
  test(`${v.model}/${label}: documented input -> action/value -> LED -> suppressed feedback echo`, async () => {
    assert.deepEqual(CM.byId(v.id).mappings.map(srcOf), v.sources);
    const h = harness(v, os);
    await h.t.initMidi();
    assert.equal(h.requests[0].sysex, false, 'başlangıç SysEx izni istemez');
    assert.equal(h.sent.length, 0, 'başlangıç kip değiştirmez');
    if (v.mode) {
      assert.equal(await h.t.prepareController(v.id, false), true);
      assert.equal(h.mode(), true);
    }
    h.t.feedbackTick();
    for (const source of v.sources) {
      const map = h.maps.find((m) => key(srcOf(m)) === key(source));
      const numeric = !map.target.startsWith('action:');
      const def = numeric && Schema.SLIDERS.find((s) => s.path === map.target);
      const before = numeric ? FB.normalize(def, map, h.get(map.target)) : 0;
      h.press(source, map.relative ? 1 : 127);
      assert.ok(h.calls.some((c) => c.slice(0, 3).join(':') === key(source)), 'denetim hedefe ulaştı: ' + source);
      if (numeric) {
        const after = FB.normalize(def, map, h.get(map.target));
        assert.ok(Math.abs(after - (map.relative ? Math.min(1, before + 1 / 127) : 1)) < 1e-6, 'değer doğru aralığa uygulandı');
      }
      h.press(source, map.relative ? 127 : 0, source[0] === 'note');
      if (numeric && !map.relative) assert.equal(FB.normalize(def, map, h.get(map.target)), 0);
    }
    const b = h.maps.find((m) => m.target === 'action:blackout');
    h.resetBlackout();
    const before = h.turns();
    h.press(srcOf(b), 127);
    h.t.feedbackTick();
    assert.equal(h.turns(), before + 1, 'LED yankısı karartmayı yeniden değiştirmez');
    assert.equal(h.blackout(), true);
    assert.equal(h.leds.get(key(srcOf(b))), v.on, 'modelin belgeli açık rengi');
    const count = h.sent.length;
    h.t.feedbackTick();
    assert.equal(h.sent.length, count, 'aynı LED her taramada tekrar gitmez');
    h.press(srcOf(b), 0, b.kind === 'note');
    h.press(srcOf(b), 127);
    h.t.feedbackTick();
    assert.equal(h.blackout(), false);
    assert.equal(h.leds.get(key(srcOf(b))), 0, 'LED söner');
    // Nota bırakma hızı APC'de 127 olabilir; yalnız bırakmadır, yeni vuruş değil.
    if (b.kind === 'note') { const n = h.turns(); h.press(srcOf(b), 127, true); assert.equal(h.turns(), n); }
    if (v.mode) {
      await h.t.prepareController(v.id, true);
      assert.equal(h.mode(), false);
    }
  });
}

test('unused/disabled MIDI stays inert; no timer, output or mode changes', async () => {
  const h = harness(VENDORS[5], 0, { enabled: false, feedback: false });
  await h.t.initMidi(); h.t.syncFeedback(); h.t.feedbackTick();
  assert.equal(h.timers.size, 0); assert.deepEqual(h.sent, []);
  assert.equal(await h.t.prepareController('push2', false), false);
  assert.deepEqual(h.sent, []); assert.equal(h.requests.length, 1);
});

test('denied SysEx permission keeps input working and sends no mode command', async () => {
  const h = harness(VENDORS.find((v) => v.model === 'push'), 0, { denySysex: true });
  await h.t.initMidi();
  assert.equal(await h.t.prepareController('push2', false), false);
  assert.deepEqual(h.sent, []);
  assert.equal(typeof h.input.onmidimessage, 'function');
});

test('DAW, Live, DIN, ambiguous and other-model ports cannot take a template or mode command', () => {
  for (const name of ['Ableton Push 2 Live Port', 'Ableton Push 2 36:0', 'Ableton Push 2', 'MIDIIN1 (Ableton Push 2)']) {
    assert.equal(CM.acceptsPort('push2', name), false); assert.deepEqual(CM.modeMessages('push2', name), []);
  }
  for (const name of ['LPMiniMK3 DAW In', 'Launchpad X 32:0', 'LPProMK3 DIN', 'Launchpad X', 'MIDIIN3 (LPProMK3)']) {
    assert.equal(CM.acceptsPort('launchpad', name), false); assert.deepEqual(CM.modeMessages('launchpad', name), []);
  }
  assert.equal(CM.matchDevice('Ableton Push 20'), null);
  assert.equal(CM.matchDevice('APC40'), null);
  assert.deepEqual(CM.modeMessages('apc40mk2', 'Other'), []);
});

test('Korg CC setup is explicit, configurable and never written by SysEx', () => {
  assert.match(CM.byId('nanokontrol2').name, /CC setup/);
  assert.deepEqual(CM.modeMessages('nanokontrol2', 'nanoKONTROL2'), []);
  assert.equal(CM.feedbackMap({ preset: 'nanokontrol2', kind: 'cc', channel: 1, cc: 0 }), null);
  assert.equal(CM.feedbackMap({ preset: 'nanokontrol2', kind: 'cc', channel: 1, cc: 58 }), null);
});

test('Push encoder signed deltas and CC buttons use different output protocols', () => {
  const tpl = CM.byId('push2');
  for (const m of tpl.mappings.slice(0, 8)) { assert.equal(m.relative, 'twos-complement'); assert.equal(CM.feedbackMap(m), null); }
  assert.deepEqual(FB.encode(CM.feedbackMap({ ...tpl.mappings.at(-1), preset: 'push2' }), 1), [0xb0, 85, 127]);
});

test('automatic pairing preserves instance suffix and never crosses identical-model devices', () => {
  assert.equal(CM.paired('MIDIIN2 (Ableton Push 2) 1', 'MIDIOUT2 (Ableton Push 2) 2'), false);
  assert.equal(CM.paired('MIDIIN2 (Ableton Push 2) 1', 'MIDIOUT2 (Ableton Push 2) 1'), true);
  assert.deepEqual(FB.pickOutputs([{ id: 'out', name: 'APC40 mkII', state: 'disconnected' }], [{ id: 'in', name: 'APC40 mkII' }], 'auto', 'in'), []);
});

test('maps stay per-device; other model output receives no preset bytes; hotplug resends state', async () => {
  const h = harness(VENDORS[1]);
  await h.t.initMidi(); await h.t.prepareController('apc40mk2', false); h.t.feedbackTick();
  const count = h.sent.length;
  h.access.onstatechange(); h.t.feedbackTick(); assert.ok(h.sent.length > count);
  let wrong = 0;
  h.access.outputs.set('wrong', { id: 'wrong', name: 'Ableton Push 2 User Port', send() { wrong++; } });
  h.cfg.control.midi.feedback.outputId = 'wrong'; h.t.feedbackTick(); assert.equal(wrong, 0);
  const tpl = CM.byId('apc40mk2'); const list = []; CM.apply(list, tpl, { deviceId: 'only-me' });
  assert.ok(list.every((m) => m.deviceId === 'only-me'));
  const b = h.maps.find((m) => m.target === 'action:blackout'); b.deviceId = 'other';
  h.press(srcOf(b), 127); assert.equal(h.turns(), 0);
});

test('echo protection expires and a failed send never poisons the next attempt', () => {
  let now = 1; let fail = false;
  const sender = FB.create({ now: () => now, send() { if (fail) throw Error('closed'); } });
  const map = { kind: 'note', channel: 1, cc: 36 };
  sender.update([{ map, value01: 1 }]); assert.equal(sender.isEcho([0x90, 36, 127]), true);
  assert.equal(sender.isEcho([0x90, 36, 127]), false, 'tek yankı tüketilir');
  sender.reset(); sender.update([{ map, value01: 1 }]); now += 101;
  assert.equal(sender.isEcho([0x90, 36, 127]), false);
  fail = true; sender.update([{ map, value01: 0 }]); assert.equal(sender.isEcho([0x90, 36, 0]), false);
});


test('two controller models receive only their own template feedback', async () => {
  const h = harness(VENDORS[1]);
  await h.t.initMidi(); await h.t.prepareController('apc40mk2', false);
  const sent = [];
  h.access.inputs.set('push-in', { id: 'push-in', name: 'Ableton Push 2 User Port' });
  h.access.outputs.set('push-out', { id: 'push-out', name: 'Ableton Push 2 User Port', send: (bytes) => sent.push([...bytes]) });
  h.cfg.control.midi.deviceId = 'all';
  h.cfg.control.midi.mappings.push(...CM.toMappings(CM.byId('push2')));
  h.access.onstatechange(); h.t.feedbackTick();
  assert.equal(sent.length, 9);
  assert.ok(sent.every(([status, num]) => (status === 0x90 && num >= 36 && num <= 43) || (status === 0xb0 && num === 85)));
  h.cfg.control.midi.enabled = false;
  const count = h.sent.length; h.t.feedbackTick();
  assert.equal(h.timers.size, 0); assert.equal(h.sent.length, count);
});
