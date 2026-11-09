'use strict';
/* MIDI çıkışı (LED geri bildirimi) ve hazır denetleyici haritaları.
   Gerçek denetleyici yok: sahte MIDIOutput nesnesinin aldığı bayt dizisi
   denetlenir; haritalar şema hedefleriyle ve aygıt adlarıyla sınanır. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

global.window = global.window || {};
const FB = require('../src/shared/midi-feedback.js');
const CM = require('../src/shared/controller-maps.js');
const Schema = require('../src/shared/schema.js');
require('../src/shared/defaults.js');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

function fakeOutput(id, name) {
  return { id, name, sent: [], send(bytes) { this.sent.push(Array.from(bytes)); } };
}

test('varsayılan: geri bildirim kapalı, çıkış otomatik', () => {
  const d = global.window.SV.defaultConfig();
  assert.deepStrictEqual(d.control.midi.feedback, { enabled: false, outputId: 'auto', onVelocity: 127, offVelocity: 0 });
});

test('encode: CC değeri 0..127, nota açık/kapalı, kanal 0 → 1. kanal', () => {
  assert.deepStrictEqual(FB.encode({ kind: 'cc', channel: 3, cc: 7 }, 0.5), [0xb2, 7, 64]);
  assert.deepStrictEqual(FB.encode({ kind: 'cc', channel: 0, cc: 10 }, 2), [0xb0, 10, 127]);
  assert.deepStrictEqual(FB.encode({ kind: 'note', channel: 1, cc: 36 }, 1), [0x90, 36, 127]);
  assert.deepStrictEqual(FB.encode({ kind: 'note', channel: 1, cc: 36 }, 0.2), [0x90, 36, 0]);
  assert.deepStrictEqual(FB.encode({ kind: 'note', channel: 16, cc: 0 }, 1, { onVelocity: 5, offVelocity: 1 }), [0x9f, 0, 5]);
  assert.strictEqual(FB.encode({ kind: 'cc', channel: 1, cc: -1 }, 1), null, 'öğrenilmemiş eşleme yollanmaz');
});

test('gönderici: yalnız değişen değer gider; sahte MIDIOutput dizisi', () => {
  const out = fakeOutput('o1', 'X');
  const f = FB.create({ send: (b) => out.send(b) });
  const a = { kind: 'cc', channel: 1, cc: 1 };
  const b = { kind: 'note', channel: 1, cc: 40 };
  assert.strictEqual(f.update([{ map: a, value01: 0 }, { map: b, value01: 0 }]), 2);
  assert.strictEqual(f.update([{ map: a, value01: 0 }, { map: b, value01: 0 }]), 0, 'aynı değer tekrar gitmez');
  f.update([{ map: a, value01: 1 }, { map: b, value01: 1 }]);
  f.update([{ map: a, value01: 1 }, { map: b, value01: 0 }]);
  assert.deepStrictEqual(out.sent, [
    [0xb0, 1, 0], [0x90, 40, 0],
    [0xb0, 1, 127], [0x90, 40, 127],
    [0x90, 40, 0],
  ]);
  f.reset();
  assert.strictEqual(f.update([{ map: a, value01: 1 }]), 1, 'sıfırlanınca yeniden yollanır');
});

test('gönderici: denetleyiciden gelen değer geri yankılanmaz', () => {
  const out = fakeOutput('o1', 'X');
  const f = FB.create({ send: (b) => out.send(b) });
  const fader = { kind: 'cc', channel: 2, cc: 7 };
  f.noteIncoming('cc', 2, 7, 100);
  f.update([{ map: fader, value01: 100 / 127 }]);
  assert.deepStrictEqual(out.sent, [], 'motorlu fader elin altında kıpırdamaz');
  f.update([{ map: fader, value01: 0 }]);
  assert.deepStrictEqual(out.sent, [[0xb1, 7, 0]], 'değer başka yerden değişince gider');
});

test('gönderici: çıkış hata verirse çökmez ve sonra yeniden dener', () => {
  let fail = true;
  const sent = [];
  const f = FB.create({ send: (b) => { if (fail) throw new Error('closed'); sent.push(b); } });
  const m = { kind: 'cc', channel: 1, cc: 3 };
  assert.strictEqual(f.update([{ map: m, value01: 1 }]), 0);
  fail = false;
  assert.strictEqual(f.update([{ map: m, value01: 1 }]), 1);
  assert.strictEqual(sent.length, 1);
});

test('normalize: aralık, eşleme min/max, kovalı hedef ve boolean', () => {
  assert.strictEqual(FB.normalize({ min: 0, max: 2 }, null, 1), 0.5);
  assert.strictEqual(FB.normalize({ min: 0, max: 2 }, { min: 1, max: 2 }, 1.5), 0.5);
  assert.strictEqual(FB.normalize({ min: 0, max: 1 }, null, 5), 1);
  assert.strictEqual(FB.normalize({ steps: ['a', 'b', 'c'] }, null, 'c'), 1);
  assert.strictEqual(FB.normalize({ steps: ['a', 'b', 'c'] }, null, 'b'), 0.5);
  assert.strictEqual(FB.normalize({ min: 0, max: 1 }, null, true), 1);
  assert.strictEqual(FB.normalize({ min: 0, max: 1 }, null, 'x'), 0);
});

test('çıkış seçimi: otomatik = girişle aynı adlı; belirli kimlik yalnız o', () => {
  const outs = [fakeOutput('a', 'APC40 mkII'), fakeOutput('b', 'Launchpad Mini MK3'), fakeOutput('c', 'Other')];
  const ins = [{ id: 'i1', name: 'APC40 mkII' }, { id: 'i2', name: 'Launchpad Mini MK3' }];
  assert.deepStrictEqual(FB.pickOutputs(outs, ins, 'auto', 'all').map((o) => o.id), ['a', 'b']);
  assert.deepStrictEqual(FB.pickOutputs(outs, ins, 'auto', 'i2').map((o) => o.id), ['b']);
  assert.deepStrictEqual(FB.pickOutputs(outs, ins, 'c', 'i1').map((o) => o.id), ['c']);
  assert.deepStrictEqual(FB.pickOutputs(outs, [], 'auto', 'all'), []);
});

test('haritalar: aygıt adı eşleşmesi', () => {
  assert.strictEqual(CM.matchDevice('nanoKONTROL2 SLIDER/KNOB').id, 'nanokontrol2');
  assert.strictEqual(CM.matchDevice('APC40 mkII').id, 'apc40mk2');
  assert.strictEqual(CM.matchDevice('Launchpad Mini MK3 LPMiniMK3 MIDI').id, 'launchpad');
  assert.strictEqual(CM.matchDevice('Ableton Push 2 Live Port').id, 'push2');
  assert.strictEqual(CM.matchDevice('Arturia KeyStep'), null);
  assert.strictEqual(CM.matchDevice('APC40'), null, 'ilk nesil yanlış haritayı almaz');
  assert.strictEqual(CM.matchDevice('Launchpad Mini'), null, 'eski Launchpad yanlış haritayı almaz');
  assert.strictEqual(CM.matchDevice('Launchpad X').id, 'launchpad');
  assert.strictEqual(CM.matchDevice(''), null);
});

test('haritalar: her hedef gerçek bir kaydırıcı ya da eylem; kaynaklar tekil; numaralar geçerli', () => {
  // APC40 Mk2 Communications Protocol v1.2, s. 36: üst track düğümleri CC 0x30-0x37.
  assert.deepStrictEqual(CM.byId('apc40mk2').mappings.slice(8, 16).map((m) => [m.channel, m.cc]),
    Array.from({ length: 8 }, (_, i) => [1, 0x30 + i]));
  const sliders = new Set(Schema.SLIDERS.map((s) => s.path));
  const control = read('src/admin/control.js');
  for (const t of CM.TEMPLATES) {
    const seen = new Set();
    assert.ok(t.mappings.length >= 8, t.id);
    for (const m of t.mappings) {
      if (m.target.startsWith('action:')) {
        assert.ok(control.includes("{ action: '" + m.target.slice(7) + "'"), t.id + ': ' + m.target);
      } else {
        assert.ok(sliders.has(m.target), t.id + ': ' + m.target);
      }
      assert.ok(m.cc >= 0 && m.cc <= 127 && m.channel >= 1 && m.channel <= 16, t.id + ' ' + JSON.stringify(m));
      const k = m.kind + ':' + m.channel + ':' + m.cc;
      assert.ok(!seen.has(k), t.id + ' yinelenen kaynak ' + k);
      seen.add(k);
    }
  }
});

test('haritalar: şablon eşlemeye dönüşür; uygulama mevcut eşlemeyi ezmez', () => {
  const tpl = CM.byId('nanokontrol2');
  const maps = CM.toMappings(tpl, (i) => 'id' + i);
  assert.deepStrictEqual(maps[0], {
    id: 'id0', kind: 'cc', channel: 1, cc: 0, address: '/cayadev/1', index: -1, pad: -1,
    target: 'audio.sensitivity', min: null, max: null, preset: 'nanokontrol2',
  });
  const list = [
    { id: 'mine', kind: 'cc', channel: 1, cc: 0, target: 'logo.scale' }, // aynı kaynak
    { id: 'any', kind: 'cc', channel: 0, cc: 16, target: 'logo.scale' }, // her kanal: aynı numara
  ];
  const r = CM.apply(list, tpl, { idGen: (i) => 'n' + i });
  assert.strictEqual(r.skipped, 2);
  assert.strictEqual(r.added, tpl.mappings.length - 2);
  assert.strictEqual(list[0].target, 'logo.scale', 'kullanıcı eşlemesi korunur');
  const again = CM.apply(list, tpl);
  assert.strictEqual(again.added, 0, 'ikinci uygulama hiçbir şey eklemez');
  const none = CM.apply([], tpl, { known: () => false });
  assert.strictEqual(none.added, 0, 'bilinmeyen hedef eklenmez');
});

test('panel: gelen MIDI yankı süzgecine yazılır; geri bildirim kapalıyken yollanmaz; betikler yükleniyor', () => {
  const c = read('src/admin/control.js');
  assert.match(c, /sender\.noteIncoming/);
  assert.match(c, /if \(input && !presetSource\)/);
  assert.match(c, /if \(!cfg\.control\.midi\.enabled \|\| !f\.enabled\) \{ syncFeedback\(\); return; \}/);
  assert.match(c, /C\.apply\(list, tpl, \{ known: \(k\) => !!targetFor\(k\), deviceId:/);
  const html = read('src/admin/index.html');
  assert.ok(html.indexOf('../shared/midi-feedback.js') > 0 && html.indexOf('../shared/midi-feedback.js') < html.indexOf('src="control.js"'));
  assert.ok(html.indexOf('../shared/controller-maps.js') > 0 && html.indexOf('../shared/controller-maps.js') < html.indexOf('src="control.js"'));
});


test('panel: feedback timer is absent when disabled and released after turning MIDI off', () => {
  const vm = require('node:vm');
  const cfg = { control: { midi: { enabled: true, feedback: { enabled: false } } } };
  const timers = new Map();
  const window = { SVPanel: { cfg: () => cfg } };
  let next = 1;
  const context = vm.createContext({
    window, document: {}, navigator: {}, console,
    require: require('node:module').createRequire(require.resolve('../src/admin/control.js')),
    setInterval: (fn) => { const id = next++; timers.set(id, fn); return id; },
    clearInterval: (id) => timers.delete(id),
  });
  const source = read('src/admin/control.js').replace('  window.SVControl = {',
    '  window._feedbackTest = { syncFeedback, feedbackTick, setAccess: (v) => { midiAccess = v; } };\n  window.SVControl = {');
  vm.runInContext(source, context);
  const t = window._feedbackTest;
  t.setAccess({ outputs: new Map() });
  t.syncFeedback();
  assert.strictEqual(timers.size, 0);
  cfg.control.midi.feedback.enabled = true;
  t.syncFeedback();
  t.syncFeedback();
  assert.strictEqual(timers.size, 1);
  cfg.control.midi.enabled = false;
  t.feedbackTick();
  assert.strictEqual(timers.size, 0);
});


test('Push 2: relative encoder packets increment and decrement without absolute-value jumps', () => {
  const vm = require('node:vm');
  const map = { kind: 'cc', channel: 1, cc: 71, target: 'visualizer.glow', relative: 'twos-complement' };
  const cfg = { control: { midi: { enabled: true, mappings: [map] } }, visualizer: { glow: 0.5 } };
  const P = { cfg: () => cfg, get: () => cfg.visualizer.glow, set: (path, v) => { cfg.visualizer.glow = v; }, push() {} };
  const window = { SVPanel: P, SVMidiFeedback: FB };
  const context = vm.createContext({ window, document: { getElementById: () => null, querySelectorAll: () => [] }, console,
    require: require('node:module').createRequire(require.resolve('../src/admin/control.js')) });
  vm.runInContext(read('src/admin/control.js').replace('  window.SVControl = {', '  window._onMidiTest = onMidi;\n  window.SVControl = {'), context);
  window._onMidiTest({ data: [0xb0, 71, 1] });
  assert.ok(cfg.visualizer.glow > 0.5 && cfg.visualizer.glow < 0.6);
  window._onMidiTest({ data: [0xb0, 71, 127] });
  assert.ok(Math.abs(cfg.visualizer.glow - 0.5) < 1e-9);
  const maps = CM.toMappings(CM.byId('push2'));
  assert.strictEqual(maps.find((m) => m.cc === 71).relative, 'twos-complement');
  assert.ok(!CM.toMappings(CM.byId('nanokontrol2')).some((m) => m.relative));
});
