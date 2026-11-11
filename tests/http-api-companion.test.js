'use strict';
/* Belgeli HTTP API (/api/v1) ve Bitfocus Companion modülü. Donanım ya da
   Companion gerekmez: API gerçek MCP sunucusuna loopback HTTP ile, modül
   sahte @companion-module/base ile gerçek UDP üzerinden sınanır. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const dgram = require('dgram');
const Module = require('module');
const mcpServer = require('../src/main/mcp-server');
const restApi = require('../src/main/rest-api');
const mcp = require('../src/shared/mcp');
require('../src/shared/defaults.js');
const baseCfg = () => window.SV.defaultConfig();
const oscTree = require('../src/shared/osc-tree');
const oscServer = require('../src/main/osc-server');
const cOsc = require('../integrations/companion/src/osc');
const cAct = require('../integrations/companion/src/actions');

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

function req(port, method, p, opts) {
  const o = opts || {};
  return new Promise((resolve, reject) => {
    const headers = Object.assign({ Host: '127.0.0.1:' + port }, o.headers || {});
    if (o.token) headers.Authorization = 'Bearer ' + o.token;
    const body = o.body == null ? null : (typeof o.body === 'string' ? o.body : JSON.stringify(o.body));
    if (body) headers['Content-Type'] = 'application/json';
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const txt = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(txt); } catch (e) { json = null; }
        resolve({ status: res.statusCode, json, headers: res.headers });
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function withServer(mcpCfg, fn) {
  const cfg = baseCfg();
  cfg.mcp = Object.assign({}, cfg.mcp, mcpCfg);
  const port = await freePort();
  cfg.mcp.port = port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-rest-'));
  let current = cfg;
  const server = mcpServer.create({ userData: dir, getConfig: () => current, setConfig: (c) => { current = c; }, locale: () => 'en' });
  try {
    await server.start({ port });
    const ep = JSON.parse(fs.readFileSync(path.join(dir, 'mcp-endpoint.json'), 'utf8'));
    await fn({ port, token: ep.token, server, cfg: () => current });
  } finally {
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('HTTP API: varsayılan kapalı, açık değilken /api 404', async () => {
  assert.strictEqual(mcp.normalizeMcp({}).httpApi, false);
  assert.strictEqual(mcp.normalizeMcp({ httpApi: 'yes' }).httpApi, false);
  assert.strictEqual(baseCfg().mcp.httpApi, false);
  await withServer({ enabled: true, mode: 'read', httpApi: false }, async ({ port, token, server }) => {
    const r = await req(port, 'GET', '/api/v1/openapi.json');
    assert.strictEqual(r.status, 404);
    const t = await req(port, 'POST', '/api/v1/tools/sv_get_state', { token, body: {} });
    assert.strictEqual(t.status, 404);
    assert.strictEqual(server.status().apiToken, '');
    assert.strictEqual(server.status().apiUrl, '');
  });
});

test('HTTP API: OpenAPI belgesi her aracı yol olarak listeler', async () => {
  await withServer({ enabled: true, mode: 'read', httpApi: true }, async ({ port, server }) => {
    const r = await req(port, 'GET', '/api/v1/openapi.json');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.openapi, '3.0.3');
    assert.ok(r.json.components.securitySchemes.bearer);
    const names = mcp.tools('en', 'full').map((t) => t.name);
    for (const n of names) assert.ok(r.json.paths['/api/v1/tools/' + n] && r.json.paths['/api/v1/tools/' + n].post, n);
    assert.strictEqual(r.json.servers[0].url, 'http://127.0.0.1:' + port);
    assert.ok(/\/api\/v1\/openapi\.json$/.test(server.status().apiUrl));
    // Ayrıca saf üretici de aynı yolları verir
    const doc = restApi.openapi(mcp, { port: 1 });
    assert.strictEqual(Object.keys(doc.paths).length, names.length + 1);
  });
});

test('HTTP API: jeton, Host ve Origin denetimi', async () => {
  await withServer({ enabled: true, mode: 'read', httpApi: true }, async ({ port, token }) => {
    assert.strictEqual((await req(port, 'GET', '/api/v1/tools')).status, 401);
    assert.strictEqual((await req(port, 'GET', '/api/v1/tools', { token: 'x' + token })).status, 401);
    assert.strictEqual((await req(port, 'GET', '/api/v1/tools', { token, headers: { Host: 'evil.example:' + port } })).status, 403);
    assert.strictEqual((await req(port, 'GET', '/api/v1/tools', { token, headers: { Origin: 'http://evil.example' } })).status, 403);
    const ok = await req(port, 'GET', '/api/v1/tools', { token, headers: { Host: 'localhost:' + port } });
    assert.strictEqual(ok.status, 200);
    assert.ok(ok.json.tools.length > 50);
    assert.strictEqual((await req(port, 'GET', '/api/v1/tools/sv_get_state', { token })).status, 405);
    assert.strictEqual((await req(port, 'POST', '/api/v1/tools/sv_get_state', { token, body: '{bad' })).status, 400);
    assert.strictEqual((await req(port, 'POST', '/api/v1/tools/sv_get_state', { token, body: '[1]' })).status, 400);
    assert.strictEqual((await req(port, 'POST', '/api/v1/nope', { token })).status, 404);
    // CORS başlığı yollanmaz
    assert.strictEqual(ok.headers['access-control-allow-origin'], undefined);
    // /mcp eskisi gibi çalışır
    const rpc = await req(port, 'POST', '/mcp', { token, body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    assert.strictEqual(rpc.status, 200);
    assert.deepStrictEqual(rpc.json.result, {});
  });
});

test('HTTP API: araç çağrısı MCP izin kipine uyar', async () => {
  await withServer({ enabled: true, mode: 'read', httpApi: true }, async ({ port, token }) => {
    const read = await req(port, 'POST', '/api/v1/tools/sv_get_state', { token, body: {} });
    assert.strictEqual(read.status, 200, JSON.stringify(read.json));
    assert.notStrictEqual(read.json.ok, false);
    const write = await req(port, 'POST', '/api/v1/tools/sv_set_crossfade', { token, body: { value: 0.5 } });
    assert.strictEqual(write.status, 400);
    assert.strictEqual(write.json.ok, false);
    const unknown = await req(port, 'POST', '/api/v1/tools/sv_no_such_tool', { token, body: {} });
    assert.strictEqual(unknown.status, 400);
  });
  await withServer({ enabled: true, mode: 'apply', httpApi: true }, async ({ port, token, cfg }) => {
    const write = await req(port, 'POST', '/api/v1/tools/sv_set_crossfade', { token, body: { value: 0.25 } });
    assert.strictEqual(write.status, 200, JSON.stringify(write.json));
    assert.strictEqual(cfg().crossfade.value, 0.25);
  });
});

test('HTTP API: hostAllowed yalnız loopback adlarını ve kendi portunu kabul eder', () => {
  assert.ok(restApi.hostAllowed('127.0.0.1:5000', 5000));
  assert.ok(restApi.hostAllowed('LOCALHOST:5000', 5000));
  assert.ok(!restApi.hostAllowed('127.0.0.1:5001', 5000));
  assert.ok(!restApi.hostAllowed('192.168.1.2:5000', 5000));
  assert.ok(!restApi.hostAllowed('', 5000));
});

/* ---------------- Companion modülü ---------------- */

function cfgWithLayers() {
  const c = baseCfg();
  if (!Array.isArray(c.layers) || !c.layers.length) c.layers = [{ id: 'a', enabled: true, opacity: 1 }, { id: 'b', enabled: true, opacity: 1 }];
  return c;
}

function sampleOptions(a) {
  const o = {};
  for (const opt of a.options) o[opt.id] = opt.default;
  if (o.name === '') o.name = 'Test';
  return o;
}

test('Companion: OSC kodlayıcı uygulamanın ayrıştırıcısıyla bire bir', () => {
  const buf = cOsc.encode('/cayadev/deck/launch', [{ type: 'i', value: 2 }, { type: 'f', value: 0.5 }, { type: 's', value: 'Sahne ğüş' }, { type: 'T' }]);
  const out = [];
  oscServer.parsePacket(buf, out);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].address, '/cayadev/deck/launch');
  assert.deepStrictEqual(out[0].args, [2, 0.5, 'Sahne ğüş', true]);
  assert.deepStrictEqual(cOsc.decode(buf), [{ address: '/cayadev/deck/launch', args: [2, 0.5, 'Sahne ğüş', true] }]);
  assert.deepStrictEqual(cOsc.decode(Buffer.from([1, 2, 3])), []);
});

test('Companion: her eylem uygulamanın OSC ağacında bir adıma dönüşür', () => {
  const cfg = cfgWithLayers();
  for (const [id, a] of Object.entries(cAct.ACTIONS)) {
    const msgs = cAct.messages(id, sampleOptions(a), '/cayadev', {});
    assert.ok(msgs.length > 0, id);
    // Kablodan geçir: kodla → uygulamanın ayrıştırıcısı → osc-tree.plan
    const parsed = [];
    for (const m of msgs) oscServer.parsePacket(cOsc.encode(m.address, m.args), parsed);
    const plan = oscTree.plan(parsed, cfg, {});
    assert.strictEqual(plan.steps.length, msgs.length, id + ' → ' + JSON.stringify(parsed));
  }
  // Özel önek ve geçersiz önek
  assert.strictEqual(cAct.messages('deck_stop', {}, '/stage', {})[0].address, '/stage/deck/stop');
  assert.strictEqual(cAct.messages('deck_stop', {}, 'bad prefix', {})[0].address, '/cayadev/deck/stop');
  // toggle durumu kullanır
  assert.strictEqual(cAct.messages('blackout', { state: 'toggle' }, '', { blackout: true })[0].args[0].value, 0);
  assert.strictEqual(cAct.messages('blackout', { state: 'toggle' }, '', { blackout: false })[0].args[0].value, 1);
  // raw yol temizlenir
  assert.deepStrictEqual(cAct.messages('raw', { path: '../x y', value: 1 }, '', {}), []);
});

test('Companion: modül sahte base ile UDP üzerinden OSC yollar ve geri bildirimi okur', async () => {
  const calls = { vars: {}, checked: [], status: [] };
  let Klass = null;
  const fake = {
    InstanceBase: class {
      setActionDefinitions(d) { this._actions = d; }
      setFeedbackDefinitions(d) { this._feedbacks = d; }
      setVariableDefinitions(d) { this._vars = d; }
      setPresetDefinitions(d) { this._presets = d; }
      setVariableValues(v) { Object.assign(calls.vars, v); }
      checkFeedbacks(...ids) { calls.checked.push(...ids); }
      updateStatus(s, m) { calls.status.push([s, m]); }
    },
    InstanceStatus: { Ok: 'ok', BadConfig: 'bad_config', UnknownError: 'unknown_error' },
    runEntrypoint: (k) => { Klass = k; },
    combineRgb: (r, g, b) => (r << 16) | (g << 8) | b,
  };
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === '@companion-module/base') return fake;
    return origLoad.apply(this, arguments);
  };
  const entry = require.resolve('../integrations/companion/src/main.js');
  try { delete require.cache[entry]; require(entry); } finally { Module._load = origLoad; }
  assert.ok(Klass);

  const sv = dgram.createSocket('udp4');
  await new Promise((r) => sv.bind(0, '127.0.0.1', r));
  const fbPort = await new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    s.bind(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
  const inst = new Klass();
  await inst.init({ host: '127.0.0.1', port: sv.address().port, prefix: '/cayadev', feedbackPort: fbPort });
  try {
    assert.ok(inst._actions.blackout && inst._actions.deck_launch && inst._presets.blackout);
    assert.strictEqual(calls.status[calls.status.length - 1][0], 'ok');
    const got = new Promise((resolve) => sv.once('message', (b) => resolve(b)));
    inst._actions.deck_launch.callback({ options: { row: 1, col: 3 } });
    const out = [];
    oscServer.parsePacket(await got, out);
    assert.deepStrictEqual(out[0], Object.assign({}, out[0], { address: '/cayadev/deck/launch', args: [1, 3] }));

    // Uygulamanın OSC çıkışı gibi blackout=1 ve bpm yolla
    const tx = dgram.createSocket('udp4');
    const seen = new Promise((resolve) => {
      const t = setInterval(() => { if (calls.vars.bpm === 128 && calls.vars.blackout === 'on') { clearInterval(t); resolve(); } }, 5);
    });
    tx.send(cOsc.encode('/cayadev/show/blackout', [{ type: 'i', value: 1 }]), fbPort, '127.0.0.1');
    tx.send(cOsc.encode('/cayadev/tempo/bpm', [{ type: 'f', value: 128 }]), fbPort, '127.0.0.1');
    await seen;
    tx.close();
    assert.ok(calls.checked.includes('blackout'));
    assert.strictEqual(inst._feedbacks.blackout.callback(), true);
    // toggle artık kapatır
    const got2 = new Promise((resolve) => sv.once('message', (b) => resolve(b)));
    inst._actions.blackout.callback({ options: { state: 'toggle' } });
    const out2 = [];
    oscServer.parsePacket(await got2, out2);
    assert.strictEqual(out2[0].address, '/cayadev/show/blackout');
    assert.deepStrictEqual(out2[0].args, [0]);
  } finally {
    await inst.destroy();
    sv.close();
  }
});

test('Companion: manifest geçerli ve giriş dosyası var', () => {
  const dir = path.join(__dirname, '..', 'integrations', 'companion');
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'companion', 'manifest.json'), 'utf8'));
  assert.strictEqual(man.runtime.api, 'nodejs-ipc');
  assert.ok(fs.existsSync(path.join(dir, 'companion', man.runtime.entrypoint)));
  assert.ok(fs.existsSync(path.join(dir, 'companion', 'HELP.md')));
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies['@companion-module/base']);
  // Uygulama paketine girmez
  const root = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(!root.build.files.some((f) => /integrations/.test(f)));
});


test('HTTP API: disabling the API or rotating the token cancels a request still receiving its body', async () => {
  const { EventEmitter } = require('node:events');
  for (const mode of ['disable', 'rotate']) {
    let enabled = true, token = 'fixture', called = 0, status = 0;
    const req = new EventEmitter();
    Object.assign(req, { url: '/api/v1/tools/sv_set_crossfade', method: 'POST', headers: { host: '127.0.0.1:5000', authorization: 'Bearer fixture' } });
    const res = { writeHead: (code) => { status = code; }, end() {} };
    restApi.handle(req, res, { enabled: () => enabled, token: () => token, port: () => 5000,
      mcp: { callTool: () => { called++; return { ok: true }; } }, ctx: () => ({}) });
    req.emit('data', Buffer.from('{"value":'));
    if (mode === 'disable') enabled = false; else token = 'new-fixture';
    req.emit('data', Buffer.from('0.5}'));
    req.emit('end');
    await Promise.resolve();
    assert.strictEqual(status, mode === 'disable' ? 404 : 401);
    assert.strictEqual(called, 0);
  }
});
