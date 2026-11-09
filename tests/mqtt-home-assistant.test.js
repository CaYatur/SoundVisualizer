'use strict';
/* MQTT / Home Assistant. Gerçek aracı gerekmez: testin içindeki küçük
   sahte aracı (mqtt-lite'ın kendi paket ayrıştırıcısıyla) loopback TCP'de
   dinler. Komutların uygulamadaki karşılığı gerçek osc-tree.plan ile
   denetlenir. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const fs = require('fs');
const path = require('path');
const M = require('../src/main/mqtt-lite');
const B = require('../src/main/mqtt-bridge');
const oscTree = require('../src/shared/osc-tree');
const mcp = require('../src/shared/mcp');
require('../src/shared/defaults.js');
const baseCfg = () => window.SV.defaultConfig();

function fakeBroker(opts) {
  const o = opts || {};
  const seen = { connects: [], publishes: [], subscribes: [], disconnects: 0 };
  const clients = new Set();
  const server = net.createServer((sock) => {
    clients.add(sock);
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      const r = M.parse(buf);
      buf = r.rest;
      for (const p of r.packets) {
        if (p.type === M.T.CONNECT) {
          seen.connects.push(p);
          const rc = o.password && p.password !== o.password ? 4 : 0;
          sock.write(M.packet(M.T.CONNACK, 0, Buffer.from([0, rc])));
        } else if (p.type === M.T.PUBLISH) {
          seen.publishes.push({ topic: p.topic, payload: p.payload.toString('utf8'), retain: p.retain });
        } else if (p.type === M.T.SUBSCRIBE) {
          seen.subscribes.push(...p.topics);
          const b = Buffer.alloc(2 + p.topics.length);
          b.writeUInt16BE(p.id);
          sock.write(M.packet(M.T.SUBACK, 0, b));
        } else if (p.type === M.T.PINGREQ) {
          sock.write(M.packet(M.T.PINGRESP, 0, Buffer.alloc(0)));
        } else if (p.type === M.T.DISCONNECT) {
          seen.disconnects++;
        }
      }
    });
    sock.on('close', () => clients.delete(sock));
    sock.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port,
    seen,
    send: (topic, payload, retain) => { for (const c of clients) c.write(M.publish(topic, payload, retain)); },
    close: () => new Promise((r) => { for (const c of clients) c.destroy(); server.close(() => r()); }),
  })));
}

const until = (fn, ms) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const t = setInterval(() => {
    if (fn()) { clearInterval(t); resolve(); } else if (Date.now() - t0 > (ms || 2000)) { clearInterval(t); reject(new Error('timeout')); }
  }, 5);
});

test('MQTT: paket kodlama ve ayrıştırma tur atar (değişken uzunluk dahil)', () => {
  assert.deepStrictEqual([...M.varInt(0)], [0]);
  assert.deepStrictEqual([...M.varInt(127)], [127]);
  assert.deepStrictEqual([...M.varInt(128)], [0x80, 1]);
  assert.deepStrictEqual([...M.varInt(16383)], [0xff, 0x7f]);
  const big = 'x'.repeat(300);
  const buf = Buffer.concat([
    M.connect({ clientId: 'c1', username: 'u', password: 'p', keepalive: 15, will: { topic: 'a/status', payload: 'offline', retain: true } }),
    M.publish('a/b', big, true),
    M.subscribe(7, ['a/set/+']),
  ]);
  // Parça parça gelse de aynı paketler çıkar
  const r1 = M.parse(buf.subarray(0, 20));
  const r2 = M.parse(Buffer.concat([r1.rest, buf.subarray(20)]));
  const all = r1.packets.concat(r2.packets);
  assert.strictEqual(all.length, 3);
  assert.strictEqual(all[0].clientId, 'c1');
  assert.strictEqual(all[0].username, 'u');
  assert.strictEqual(all[0].password, 'p');
  assert.strictEqual(all[0].keepalive, 15);
  assert.deepStrictEqual(all[0].will, { topic: 'a/status', payload: 'offline', retain: true });
  assert.strictEqual(all[1].topic, 'a/b');
  assert.strictEqual(all[1].payload.toString(), big);
  assert.strictEqual(all[1].retain, true);
  assert.deepStrictEqual(all[2].topics, ['a/set/+']);
  assert.ok(M.parse(Buffer.from([0x30, 0xff, 0xff, 0xff, 0xff, 0x01])).error);
});

test('MQTT: ayarlar varsayılan kapalı, komut dinleme kapalı, parola gizli', () => {
  const d = baseCfg().mqtt;
  assert.strictEqual(d.enabled, false);
  assert.strictEqual(d.allowControl, false);
  assert.strictEqual(d.host, '');
  const n = B.normalize({ baseTopic: '../x y', discoveryPrefix: '', port: 99999 });
  assert.strictEqual(n.baseTopic, 'soundvisualizer');
  assert.strictEqual(n.discoveryPrefix, 'homeassistant');
  assert.strictEqual(n.port, 1883);
  assert.deepStrictEqual(B.commandTopics(d), []);
  // MCP: okunurken parola gizlenir, mqtt.* yazılamaz
  assert.strictEqual(mcp.PATH_GROUPS.mqtt, 'never');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'mcp.js'), 'utf8');
  assert.ok(src.includes("['mqtt', 'password']"));
  // Web istemcisine giden yapılandırmada parola yok
  const ss = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'stream-server.js'), 'utf8');
  assert.ok(/mqtt: Object\.assign\(\{\}, mq, \{ password: '' \}\)/.test(ss));
  // Yedekliliğe aktarılmaz
  assert.ok(require('../src/shared/show-keys.js').REPLICATED.indexOf('mqtt') < 0);
});

test('MQTT: durum yalnız değişince yayınlanır', () => {
  const cfg = { baseTopic: 'sv' };
  const ctx = { bpm: 127.94, scene: 'Giriş', visualizer: 'bars', show: { blackout: true, autovj: false, track: 'A — B', opacity: 0.5 } };
  const s1 = B.stateOf(ctx);
  assert.deepStrictEqual(s1, { blackout: 'ON', autovj: 'OFF', bpm: '127.9', track: 'A — B', scene: 'Giriş', visualizer: 'bars', opacity: '0.5' });
  const first = B.stateMessages(null, s1, cfg);
  assert.strictEqual(first.length, 7);
  assert.ok(first.every((m) => m.retain && m.topic.startsWith('sv/state/')));
  const s2 = Object.assign({}, s1, { blackout: 'OFF' });
  assert.deepStrictEqual(B.stateMessages(s1, s2, cfg), [{ topic: 'sv/state/blackout', payload: 'OFF', retain: true }]);
});

test('MQTT: Home Assistant keşfi; kontrol kapalıyken komut konusu yok', () => {
  const ro = B.discoveryMessages({ baseTopic: 'sv', discovery: true, allowControl: false }, { nodeId: 'Stage-PC', version: '4.0.0' });
  const live = ro.filter((m) => m.payload);
  assert.ok(live.every((m) => !JSON.parse(m.payload).command_topic));
  const bo = live.find((m) => m.topic === 'homeassistant/binary_sensor/stage_pc/blackout/config');
  assert.ok(bo);
  const p = JSON.parse(bo.payload);
  assert.strictEqual(p.state_topic, 'sv/state/blackout');
  assert.strictEqual(p.availability_topic, 'sv/status');
  assert.strictEqual(p.unique_id, 'soundvisualizer_stage_pc_blackout');
  assert.strictEqual(p.device.sw_version, '4.0.0');
  // Öbür türün eski kaydı silinir
  assert.ok(ro.find((m) => m.topic === 'homeassistant/switch/stage_pc/blackout/config' && m.payload === ''));
  const rw = B.discoveryMessages({ baseTopic: 'sv', discovery: true, allowControl: true }, { nodeId: 'x' });
  const sw = rw.find((m) => m.topic === 'homeassistant/switch/x/blackout/config');
  assert.strictEqual(JSON.parse(sw.payload).command_topic, 'sv/set/blackout');
  assert.ok(rw.find((m) => m.topic === 'homeassistant/number/x/opacity/config' && m.payload));
  assert.ok(rw.find((m) => m.topic === 'homeassistant/text/x/scene/config' && m.payload));
  // Keşif kapalı: yalnız silme mesajları
  const off = B.discoveryMessages({ discovery: false, allowControl: true }, { nodeId: 'x' });
  assert.ok(off.length && off.every((m) => m.payload === ''));
});

test('MQTT: komutlar OSC ağacında adıma dönüşür; kontrol kapalıyken yok sayılır', () => {
  const cfg = baseCfg();
  const pre = oscTree.prefixOf(cfg);
  const on = { baseTopic: 'sv', allowControl: true };
  assert.deepStrictEqual(B.commandToOsc('sv/set/blackout', 'ON', { baseTopic: 'sv' }, pre), []);
  assert.deepStrictEqual(B.commandToOsc('other/set/blackout', 'ON', on, pre), []);
  assert.deepStrictEqual(B.commandToOsc('sv/set/blackout', 'maybe', on, pre), []);
  assert.deepStrictEqual(B.commandToOsc('sv/set/unknown', '1', on, pre), []);
  const cases = [
    ['sv/set/blackout', 'ON', { kind: 'op', op: 'blackout', value: true }],
    ['sv/set/autovj', 'off', { kind: 'set', path: 'autovj.enabled', value: false }],
    ['sv/set/scene', 'Giriş', { kind: 'op', op: 'scene', name: 'Giriş' }],
    ['sv/set/visualizer', 'bars', { kind: 'op', op: 'visualizer', id: 'bars' }],
    ['sv/set/opacity', '1.7', { kind: 'set', path: 'master', value: 1 }],
  ];
  for (const [topic, payload, step] of cases) {
    const msgs = B.commandToOsc(topic, payload, on, pre);
    const plan = oscTree.plan(msgs, cfg, {});
    assert.deepStrictEqual(plan.steps, [step], topic);
  }
});

test('MQTT: istemci gerçek TCP üzerinde bağlanır, yayınlar, abone olur, komut alır', async () => {
  const br = await fakeBroker({ password: 'pw' });
  const got = [];
  const cl = M.createClient({ host: '127.0.0.1', port: br.port, clientId: 't1', username: 'u', password: 'pw', keepalive: 5, will: { topic: 'sv/status', payload: 'offline', retain: true } });
  let connects = 0;
  cl.on('connect', () => { connects++; cl.publish('sv/status', 'online', true); cl.subscribe(['sv/set/+']); });
  cl.on('message', (t, p, r) => got.push([t, p, r]));
  try {
    cl.start();
    await until(() => connects === 1 && br.seen.subscribes.length === 1);
    assert.deepStrictEqual(br.seen.connects[0].will, { topic: 'sv/status', payload: 'offline', retain: true });
    assert.deepStrictEqual(br.seen.publishes[0], { topic: 'sv/status', payload: 'online', retain: true });
    br.send('sv/set/blackout', 'ON', false);
    await until(() => got.length === 1);
    assert.deepStrictEqual(got[0], ['sv/set/blackout', 'ON', false]);
    assert.strictEqual(cl.status().connected, true);
  } finally {
    await cl.stop([{ topic: 'sv/status', payload: 'offline', retain: true }]);
  }
  await until(() => br.seen.disconnects === 1);
  assert.deepStrictEqual(br.seen.publishes[br.seen.publishes.length - 1], { topic: 'sv/status', payload: 'offline', retain: true });
  await br.close();
});

test('MQTT: yanlış parola reddedilir, aracı yokken yeniden dener, sonra bağlanır', async () => {
  const br = await fakeBroker({ password: 'right' });
  const errors = [];
  const bad = M.createClient({ host: '127.0.0.1', port: br.port, username: 'u', password: 'wrong', reconnectMin: 50, reconnectMax: 50 });
  bad.on('error', (e) => errors.push(e));
  bad.start();
  await until(() => errors.some((e) => /bad username or password/.test(e)));
  assert.strictEqual(bad.status().connected, false);
  await bad.stop();
  await br.close();

  // Kapalı port: hata, sonra aracı açılınca kendiliğinden bağlanır
  const port = br.port;
  const cl = M.createClient({ host: '127.0.0.1', port, reconnectMin: 50, reconnectMax: 100 });
  let ok = false;
  cl.on('connect', () => { ok = true; });
  cl.start();
  await new Promise((r) => setTimeout(r, 120));
  assert.strictEqual(ok, false);
  const srv = net.createServer((s) => {
    s.on('data', (d) => { if (M.parse(d).packets.some((p) => p.type === M.T.CONNECT)) s.write(M.packet(M.T.CONNACK, 0, Buffer.from([0, 0]))); });
    s.on('error', () => {});
  });
  await new Promise((r) => srv.listen(port, '127.0.0.1', r));
  try {
    await until(() => ok, 3000);
  } finally {
    await cl.stop();
    await new Promise((r) => srv.close(() => r()));
  }
});

test('MQTT: ana süreç bağlantısı kapalıyken hiçbir şey açmaz ve HW_OFF altında kapalı', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.ok(/if \(!c\.enabled \|\| !c\.host \|\| HW_OFF\)/.test(main));
  // Saklanan (retain) komut bağlanınca uygulanmaz
  assert.ok(/if \(retained \|\| mqttRun\.client !== cl\) return;/.test(main));
  assert.ok(/notifyAdmin\('osc-message', \{ messages, source: 'mqtt' \}\)/.test(main));
  const ctl = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'control.js'), 'utf8');
  assert.ok(ctl.includes("if (!cfg.control.osc.enabled && !fromMqtt) return;"));
});


test('MQTT main sync: overlapping enables create one client and disable cancels pending startup', async () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../src/main/main.js'), 'utf8');
  const code = source.slice(source.indexOf('const mqttRun = {'), source.indexOf("ipcMain.handle('mqtt:status'"));
  let created = 0;
  const timers = new Set();
  const context = vm.createContext({ currentConfig: { mqtt: { enabled: true, host: '127.0.0.1' } }, HW_OFF: false,
    mqttBridge: B, require, process: { pid: 1 }, app: { getVersion: () => 'test' }, notifyAdmin() {}, oscOutContext: () => ({}),
    setInterval: (fn) => { timers.add(fn); return fn; }, clearInterval: (fn) => timers.delete(fn),
    mqttLite: { createClient: () => { created++; return { on() {}, start() {}, stop: async () => {}, status: () => ({ connected: false }) }; } } });
  vm.runInContext(code, context);
  const first = context.syncMqtt();
  context.currentConfig.mqtt.enabled = false;
  await Promise.all([first, context.syncMqtt()]);
  assert.strictEqual(created, 0);
  context.currentConfig.mqtt.enabled = true;
  await Promise.all([context.syncMqtt(), context.syncMqtt()]);
  assert.strictEqual(created, 1);
  assert.strictEqual(timers.size, 1);
  await context.stopMqtt();
  assert.strictEqual(timers.size, 0);
});
