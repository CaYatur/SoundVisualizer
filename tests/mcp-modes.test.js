'use strict';
/* MCP mode gates and setup prompt. Calls the handlers directly.
   No model process and no Claude, Codex, Cursor, or Ollama client. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mcp = require('../src/shared/mcp');
const mcpServer = require('../src/main/mcp-server');

function ctx(mode, locale, extra) {
  const cfg = {
    mcp: { enabled: true, mode: mode },
    scenes: [{ id: 's1', name: 'One', data: { background: { type: 'solid' } } }],
    autovj: {},
    stream: {},
  };
  return Object.assign({
    locale: function () { return locale || 'en'; },
    getConfig: function () { return cfg; },
    setConfig: function (next) {
      Object.keys(cfg).forEach(function (k) { delete cfg[k]; });
      Object.assign(cfg, next);
    },
    timeline: function () { return { ok: true, playing: false, time: 0 }; },
    newStreamToken: function () { return 'tok'; },
  }, extra || {});
}

function call(name, mode, locale, args) {
  return Promise.resolve(mcp.callTool(name, args || {}, ctx(mode, locale)));
}

test('default card is off and collapsed on read', function () {
  const model = mcp.cardModel({});
  assert.strictEqual(model.enabled, false);
  assert.strictEqual(model.mode, 'read');
  assert.strictEqual(model.setupVisible, false);
  assert.deepStrictEqual(model.modes, ['read', 'apply', 'write', 'full', 'everything']);
});

test('each mode allows its representative tool and denies it below', async function () {
  const cases = [
    ['read', 'sv_get_state', {}, null],
    ['apply', 'sv_apply_scene', { id: 's1' }, 'read'],
    ['write', 'sv_set_autovj', { enabled: true }, 'apply'],
    ['full', 'sv_timeline_transport', { action: 'stop' }, 'write'],
    ['everything', 'sv_rotate_stream_token', {}, 'full'],
  ];
  for (const row of cases) {
    const allowed = await call(row[1], row[0], 'en', row[2]);
    assert.strictEqual(allowed.ok, true, row[0] + ' should allow ' + row[1] + ' ' + JSON.stringify(allowed));
    if (row[3]) {
      const denied = await call(row[1], row[3], 'en', row[2]);
      assert.strictEqual(denied.ok, false, row[3] + ' should deny ' + row[1]);
    }
  }
});

test('blocked calls name the minimum mode in Turkish and English', async function () {
  const pairs = [
    ['sv_apply_scene', { id: 's1' }, 'read', 'uygula', 'apply'],
    ['sv_set_autovj', { enabled: true }, 'apply', 'yaz', 'write'],
    ['sv_timeline_transport', { action: 'stop' }, 'write', 'tam', 'full'],
    ['sv_rotate_stream_token', {}, 'full', 'her şey', 'everything'],
  ];
  for (const row of pairs) {
    const tr = await call(row[0], row[2], 'tr', row[1]);
    const en = await call(row[0], row[2], 'en', row[1]);
    assert.match(tr.error, new RegExp('«' + row[3] + '»'));
    assert.match(tr.error, /Modu sen değiştirme/);
    assert.match(tr.error, /Yönetici panelini tıklama/);
    assert.match(tr.error, /Kullanıcıya söyle/);
    assert.match(en.error, new RegExp('«' + row[4] + '»'));
    assert.match(en.error, /Do not change the mode/);
    assert.match(en.error, /Do not click the admin UI/);
    assert.match(en.error, /Tell the user and stop/);
    assert.doesNotMatch(tr.error, /modunu «/);
    assert.doesNotMatch(en.error, /Switch MCP mode/);
  }
});

test('tools/list descriptions follow ui-language', async function () {
  const tr = await mcp.handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, ctx('read', 'tr'));
  const en = await mcp.handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctx('read', 'en'));
  function desc(list, name) {
    const tool = list.result.tools.find(function (t) { return t.name === name; });
    return tool.description;
  }
  const a = desc(tr, 'sv_get_state');
  const b = desc(en, 'sv_get_state');
  assert.notStrictEqual(a, b);
  assert.match(a, /okur/);
  assert.match(b, /Read show state/);
  assert.match(desc(tr, 'sv_set_autovj'), /Otomatik VJ/);
  assert.match(desc(en, 'sv_set_autovj'), /Auto VJ/);
  assert.match(desc(tr, 'mcp_permissions'), /Modu sen değiştirme/);
  assert.match(desc(en, 'mcp_permissions'), /Do not change the mode/);
  assert.doesNotMatch(desc(en, 'mcp_permissions'), /Switch MCP mode/);
});

test('mcp_permissions reports the current mode and the mode a tool needs', async function () {
  const report = await call('mcp_permissions', 'read', 'tr', { tool: 'sv_timeline_transport' });
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.enabled, true);
  assert.strictEqual(report.mode, 'read');
  assert.strictEqual(report.modeLabel, 'Okuma');
  assert.strictEqual(report.tool.name, 'sv_timeline_transport');
  assert.strictEqual(report.tool.minimumMode, 'full');
  assert.strictEqual(report.tool.minimumModeLabel, 'tam');
  assert.strictEqual(report.tool.allowed, false);
  assert.match(report.note, /Modu sen değiştirme/);
  assert.match(report.note, /tıklama/);
  assert.ok(report.modes.length === 5);
  const enPerm = await call('mcp_permissions', 'read', 'en', { tool: 'sv_timeline_transport' });
  assert.match(enPerm.note, /Do not change the mode/);
  assert.match(enPerm.note, /Do not click the admin UI/);
  assert.doesNotMatch(enPerm.note, /Switch MCP mode/);
  const same = await mcp.callTool('mcp_permissions', { tool: 'sv_set_autovj' }, ctx('write', 'en'));
  assert.strictEqual(same.mode, 'write');
  assert.strictEqual(same.tool.minimumMode, 'write');
  assert.strictEqual(same.tool.allowed, true);
});


test('setup prompt is one text, names the configured port, and skips clients', function () {
  const script = 'D:/SoundVisualizer/src/main/mcp-stdio.js';
  const command = mcp.commandBundle(script, 38471).shell;
  const tr = mcp.installPrompt(script, 'tr', 38471);
  const en = mcp.installPrompt(script, 'en', 38471);
  const custom = mcp.installPrompt(script, 'en', 39001);
  assert.notStrictEqual(tr, en);
  assert.ok(tr.includes(command));
  assert.ok(en.includes(command));
  assert.ok(tr.includes('38471'));
  assert.ok(en.includes('http://127.0.0.1:38471/mcp'));
  assert.ok(custom.includes('http://127.0.0.1:39001/mcp'));
  assert.match(tr, /SoundVisualizer/);
  assert.match(en, /SoundVisualizer/);
  assert.match(tr, /tools\/list/);
  assert.match(en, /tools\/list/);
  assert.match(en, /this computer only/);
  assert.match(tr, /yalnız bu bilgisayar/);
  assert.doesNotMatch(en, /loopback/i);
  assert.doesNotMatch(tr, /geri döngü/);
  assert.doesNotMatch(tr, /Claude|Codex|Cursor|Grok|APPDATA|USERPROFILE/);
  assert.doesNotMatch(en, /Claude|Codex|Cursor|Grok|APPDATA|USERPROFILE/);
  assert.doesNotMatch(tr, /ollama/i);
  assert.doesNotMatch(en, /ollama/i);
  assert.doesNotMatch(tr, /İzin kipini/);
  assert.doesNotMatch(en, /permission mode/i);
  const ids = mcp.clients(script, 38471).map(function (c) { return c.id; });
  assert.deepStrictEqual(ids, ['claude', 'codex', 'cursor', 'grok', 'grok-bot', 'ollama']);
});

test('read mode returns full state and still cannot write', async function () {
  const state = await call('sv_get_state', 'read', 'en');
  assert.strictEqual(state.ok, true);
  assert.ok(state.activePreset);
  assert.ok(Array.isArray(state.effectsShowing));
  assert.ok(Array.isArray(state.scenes));
  assert.ok(Array.isArray(state.layersOn));
  assert.ok(state.audio && 'bpm' in state.audio);
  assert.ok('nowPlaying' in state);
  assert.ok('analysis' in state);
  assert.ok(state.stack);
  assert.ok('stream' in state);
  assert.ok('textureShare' in state);
  assert.ok('displays' in state);
  const denied = await call('sv_apply_scene', 'read', 'en', { id: 's1' });
  assert.strictEqual(denied.ok, false);
});

test('floating window open and close call the existing handler and stop below full', async function () {
  const denied = await mcp.callTool('sv_set_floating_open', { open: true }, ctx('read', 'tr'));
  assert.strictEqual(denied.ok, false);
  assert.match(denied.error, /«tam»/);
  assert.match(denied.error, /Modu sen değiştirme/);
  assert.match(denied.error, /Kullanıcıya söyle/);
  let seen = null;
  const opened = await mcp.callTool('sv_set_floating_open', { open: true }, ctx('full', 'en', {
    setFloatingOpen: function (open) { seen = open; return { open: open }; },
  }));
  assert.strictEqual(opened.ok, true);
  assert.strictEqual(opened.open, true);
  assert.strictEqual(seen, true);
  const closed = await mcp.callTool('sv_set_floating_open', { open: false }, ctx('full', 'en', {
    setFloatingOpen: function (open) { seen = open; return { open: open }; },
  }));
  assert.strictEqual(closed.ok, true);
  assert.strictEqual(closed.open, false);
  assert.strictEqual(seen, false);
  const trList = await mcp.handleRpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, ctx('read', 'tr'));
  const enList = await mcp.handleRpc({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, ctx('read', 'en'));
  function desc(list) {
    return list.result.tools.find(function (t) { return t.name === 'sv_set_floating_open'; }).description;
  }
  assert.match(desc(trList), /Yüzen pencereyi/);
  assert.match(desc(enList), /floating PiP window/);
});

test('stop all clips calls the deck stop and is denied in read mode', async function () {
  const denied = await mcp.callTool('sv_stop_clips', {}, ctx('read', 'en'));
  assert.strictEqual(denied.ok, false);
  assert.match(denied.error, /Do not change the mode/);
  assert.match(denied.error, /«apply»/);
  let called = 0;
  const stopped = await mcp.callTool('sv_stop_clips', {}, ctx('apply', 'tr', {
    stopClips: function () { called += 1; return { ok: true }; },
  }));
  assert.strictEqual(stopped.ok, true);
  assert.strictEqual(called, 1);
});

test('HTTP stays on 38471 and does not hop when that port is busy', async function () {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-mcp-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-mcp-b-'));
  const cfg = { mcp: { enabled: true, mode: 'read', port: 38471 } };
  const a = mcpServer.create({ userData: dirA, getConfig: function () { return cfg; } });
  const b = mcpServer.create({ userData: dirB, getConfig: function () { return cfg; } });
  try {
    const first = await a.start();
    assert.strictEqual(first.running, true);
    assert.strictEqual(first.port, 38471);
    assert.strictEqual(first.host, '127.0.0.1');
    const second = await b.start();
    assert.strictEqual(second.portBusy, true);
    assert.strictEqual(second.running, false);
    assert.strictEqual(second.port, 0);
  } finally {
    await a.stop();
    await b.stop();
  }
});
