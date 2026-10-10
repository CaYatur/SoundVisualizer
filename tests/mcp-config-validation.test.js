'use strict';
/* sv_patch_config validation for the control and nowplaying sections:
   OSC port follows the admin panel rule, Now Playing anchor is limited to
   the values the renderer supports. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;
const mcp = require('../src/shared/mcp.js');

function ctx(platform) {
  const cfg = Object.assign(SV.defaultConfig(), { mcp: { enabled: true, mode: 'everything' } });
  return {
    cfg, platform, locale: () => 'en',
    getConfig: () => cfg,
    setConfig: (next) => { Object.keys(cfg).forEach((k) => { delete cfg[k]; }); Object.assign(cfg, next); },
    noteWrite: () => 1, revision: () => 1,
  };
}
const patch = (c, p, v) => Promise.resolve(mcp.callTool('sv_patch_config', { path: p, value: v }, c));

test('control.osc.port: out-of-range values are rejected on every platform', async () => {
  for (const plat of ['win32', 'linux', 'darwin']) {
    for (const bad of [0, 99999, 65536, -1, 9000.5, '9000', null, true]) {
      const c = ctx(plat);
      const r = await patch(c, 'control.osc.port', bad);
      assert.strictEqual(r.ok, false, plat + ' ' + JSON.stringify(bad));
      if (typeof bad === 'number') assert.match(JSON.stringify(r), /control\.osc\.port must be an integer/);
      assert.strictEqual(c.cfg.control.osc.port, 9000);
    }
  }
});

test('control.osc.port: privileged ports only on Windows, like the panel', async () => {
  const win = ctx('win32');
  assert.strictEqual((await patch(win, 'control.osc.port', 80)).ok, true);
  assert.strictEqual(win.cfg.control.osc.port, 80);
  assert.strictEqual((await patch(win, 'control.osc.port', 1)).ok, true);
  for (const plat of ['linux', 'darwin']) {
    const c = ctx(plat);
    const r = await patch(c, 'control.osc.port', 80);
    assert.strictEqual(r.ok, false);
    assert.match(JSON.stringify(r), /between 1024 and 65535/);
    assert.strictEqual((await patch(c, 'control.osc.port', 1024)).ok, true);
    assert.strictEqual((await patch(c, 'control.osc.port', 65535)).ok, true);
    assert.strictEqual(c.cfg.control.osc.port, 65535);
  }
  assert.strictEqual(mcp.oscPortMin('win32'), 1);
  assert.strictEqual(mcp.oscPortMin('linux'), 1024);
  assert.strictEqual(mcp.oscPortError(9000, 'linux'), '');
});

test('control: whole-object patch is validated too', async () => {
  const c = ctx('linux');
  assert.strictEqual((await patch(c, 'control.osc', { enabled: true, port: 80, mappings: [] })).ok, false);
  assert.strictEqual((await patch(c, 'control', { midi: c.cfg.control.midi, osc: { enabled: false, port: 99999, mappings: [] } })).ok, false);
  assert.strictEqual(c.cfg.control.osc.port, 9000);
  assert.strictEqual((await patch(c, 'control.osc', { enabled: true, port: 9100, mappings: [] })).ok, true);
  assert.strictEqual(c.cfg.control.osc.port, 9100);
  assert.strictEqual(c.cfg.control.osc.enabled, true);
});

test('control: enabled flags, deviceId, mappings and host are type-checked', async () => {
  const c = ctx('linux');
  for (const [p, v] of [
    ['control.osc.enabled', 'yes'], ['control.midi.enabled', 1], ['control.midi.enabled', null],
    ['control.midi.deviceId', 5], ['control.midi.deviceId', ''],
    ['control.osc.mappings', 'x'], ['control.midi.mappings', [1]],
    ['control.osc.host', 7], ['control.osc.host', ''], ['control.bogus', 1],
  ]) {
    const r = await patch(c, p, v);
    assert.strictEqual(r.ok, false, p + '=' + JSON.stringify(v));
  }
  for (const [p, v] of [
    ['control.osc.enabled', true], ['control.midi.enabled', true], ['control.midi.deviceId', 'all'],
    ['control.midi.deviceId', 'input-1'], ['control.osc.host', '127.0.0.1'],
    ['control.osc.mappings', [{ id: 'm1', address: '/a', target: 'postfx' }]],
  ]) {
    const r = await patch(c, p, v);
    assert.strictEqual(r.ok, true, p + '=' + JSON.stringify(v) + ' ' + JSON.stringify(r));
  }
  assert.strictEqual(c.cfg.control.midi.deviceId, 'input-1');
});

test('nowplaying.anchor: only renderer-supported anchors are accepted', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/visualizer/modes/nowplaying.js'), 'utf8');
  assert.ok(src.indexOf("c.anchor === 'group'") >= 0, 'renderer still handles the group anchor');
  assert.deepStrictEqual(mcp.NOWPLAYING_ANCHORS, ['text', 'group']);
  const c = ctx('linux');
  for (const bad of ['zzz', '', 'GROUP', 1, null]) {
    const r = await patch(c, 'nowplaying.anchor', bad);
    assert.strictEqual(r.ok, false, JSON.stringify(bad));
    if (typeof bad === 'string') assert.match(JSON.stringify(r), /nowplaying\.anchor must be one of: text, group/);
    assert.strictEqual(c.cfg.nowplaying.anchor, 'text');
  }
  assert.strictEqual((await patch(c, 'nowplaying.anchor', 'group')).ok, true);
  assert.strictEqual(c.cfg.nowplaying.anchor, 'group');
  assert.strictEqual((await patch(c, 'nowplaying.anchor', 'text')).ok, true);
  // Other nowplaying fields keep working
  assert.strictEqual((await patch(c, 'nowplaying.coverSize', 0.2)).ok, true);
  assert.strictEqual(c.cfg.nowplaying.coverSize, 0.2);
});
