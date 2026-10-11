'use strict';
/* OSC girişi (#734). Sabit ağaç, zaman etiketi, UTF-8, IPv6, birden çok
 * gönderen, bozuk paket ve OSCQuery. Öğrenme modu ağacın dışında durur. */
const test = require('node:test');
const assert = require('node:assert');
const dgram = require('dgram');
const http = require('http');
const fs = require('fs');
const path = require('path');
const Tree = require('../src/shared/osc-tree.js');
const Mdns = require('../src/shared/osc-mdns.js');
const Server = require('../src/main/osc-server.js');
const Out = require('../src/main/osc-out.js');
const Query = require('../src/main/osc-query.js');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const cfg = () => ({
  control: { osc: { prefix: '/cayadev' } },
  background: { type: 'solid', colorMode: 'theme', gradient: { brightness: 1 } },
  visualizer: { type: 'bars', barCount: 64 },
  transition: { type: 'cut' },
  autovj: { enabled: false },
  crossfade: { value: 0 },
  layers: [{ name: 'Ön', opacity: 1, enabled: true }, { name: 'Arka', opacity: 1, enabled: true }],
  scenes: [{ id: 's1', name: 'Şehir' }],
  _activeSceneId: 's1',
  milkdrop: { name: '' },
});
const ids = { visualizer: ['bars', 'wave'], background: ['solid', 'ink'], transition: ['cut', 'crossfade'] };

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

test('paket yapılandırmayı yazmadan planlar; iki ayar birlikte uygulanır', () => {
  const c = cfg();
  const snap = JSON.stringify(c);
  const plan = Tree.plan([
    { address: '/cayadev/show/brightness', args: [1.2] },
    { address: '/cayadev/layer/2/opacity', args: [0.25] },
    { address: '/cayadev/yok', args: [1] },
  ], c, ids);
  assert.strictEqual(JSON.stringify(c), snap);
  assert.deepStrictEqual(plan.consumed, [0, 1]);
  Tree.applySteps(c, plan.steps);
  assert.strictEqual(c.background.gradient.brightness, 1.2);
  assert.strictEqual(c.layers[1].opacity, 0.25);
});

test('sıra korunur, aralık kaydırıcıyla aynı, adım en yakına oturur', () => {
  const c = cfg();
  const plan = Tree.plan([
    { address: '/cayadev/show/blackout', args: [1] },
    { address: '/cayadev/show/brightness', args: [9] },
    { address: '/cayadev/visualizer/barCount', args: [20.4] },
    { address: '/cayadev/milkdrop/mesh', args: [50] },
    { address: '/cayadev/show/palette', args: ['rainbow'] },
    { address: '/cayadev/show/transition', args: ['crossfade'] },
    { address: '/cayadev/show/autovj', args: [true] },
    { address: '/cayadev/crossfade', args: [0.5] },
    { address: '/cayadev/show/opacity', args: [0.25] },
  ], c, ids);
  assert.strictEqual(plan.steps[0].op, 'blackout');
  assert.strictEqual(plan.steps[0].value, true);
  assert.strictEqual(plan.steps[1].value, 1.6);
  assert.strictEqual(plan.steps[2].value, 20);
  assert.strictEqual(plan.steps[3].value, 48);
  Tree.applySteps(c, plan.steps);
  assert.strictEqual(c.background.colorMode, 'rainbow');
  assert.strictEqual(c.transition.type, 'crossfade');
  assert.strictEqual(c.autovj.enabled, true);
  assert.strictEqual(c.crossfade.value, 0.5);
  assert.strictEqual(c.master, 0.25);
});

test('sahne, görselleştirici, deste ve zaman çizelgesi çok argümanlıdır', () => {
  const c = cfg();
  const plan = Tree.plan([
    { address: '/cayadev/scene', args: ['Şehir'] },
    { address: '/cayadev/visualizer', args: ['wave'] },
    { address: '/cayadev/background', args: ['yok'] },
    { address: '/cayadev/deck/launch', args: [2, 3] },
    { address: '/cayadev/deck/active', args: ['2:3,4:1'] },
    { address: '/cayadev/timeline/playing', args: [0] },
    { address: '/cayadev/layer/9/opacity', args: [0.2] },
  ], c, ids);
  assert.strictEqual(plan.steps[0].name, 'Şehir');
  assert.strictEqual(plan.steps[1].id, 'wave');
  assert.strictEqual(plan.steps[2].op, 'deck');
  assert.deepStrictEqual(plan.steps[2], { kind: 'op', op: 'deck', row: 2, col: 3 });
  assert.strictEqual(plan.steps[3].op, 'deck-many');
  assert.strictEqual(plan.steps[4].mode, 'pause');
  assert.deepStrictEqual(plan.consumed, [0, 1, 3, 4, 5]);
});

test('bozuk tür ve yanlış önek ağaca girmez', () => {
  const c = cfg();
  const plan = Tree.plan([
    { address: '/cayadev/show/blackout', args: ['aç'] },
    { address: '/baska/show/blackout', args: [1] },
    { address: '/cayadev/deck/launch', args: [1] },
  ], c, ids);
  assert.deepStrictEqual(plan.consumed, []);
});

test('zaman etiketi: anlık ve geç hemen, otuz saniyeye kadar bekler', () => {
  assert.strictEqual(Tree.delayMs({ immediate: true, unixMs: null }, 1000), 0);
  assert.strictEqual(Tree.delayMs({ immediate: false, unixMs: 500 }, 1000), 0);
  assert.strictEqual(Tree.delayMs({ immediate: false, unixMs: 1500 }, 1000), 500);
  assert.strictEqual(Tree.delayMs({ immediate: false, unixMs: 1000 + 5000 }, 1000), 5000);
  assert.strictEqual(Tree.delayMs({ immediate: false, unixMs: 1000 + 30001 }, 1000), 0);
  assert.deepStrictEqual(Tree.readTimetag(0, 1), { immediate: true, unixMs: null });
});

test('UTF-8 ad ve bundle zaman etiketi geri çözülür; bozuk paket düşer', () => {
  const buf = Out.encodeMessage('/scene', [['s', 'Şehir']]);
  const one = [];
  Server.parsePacket(buf, one, 0);
  assert.strictEqual(one[0].args[0], 'Şehir');
  const when = Date.UTC(2026, 0, 1);
  const bundle = Out.encodeBundle([['/a', [['f', 0.5]]]], when);
  const many = [];
  const tag = Server.parsePacket(bundle, many, 0);
  assert.strictEqual(many[0].address, '/a');
  assert.ok(Math.abs(many[0].time.unixMs - when) <= 1);
  assert.ok(Math.abs(tag.unixMs - when) <= 1);
  const dropped = [];
  Server.parsePacket(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]), dropped, 0);
  assert.strictEqual(dropped.length, 0);
  Server.parsePacket(Buffer.alloc(0), dropped, 0);
  assert.strictEqual(dropped.length, 0);
});

test('OSCQuery tür, aralık ve güncel değeri verir', () => {
  const c = cfg();
  c.background.gradient.brightness = 1.4;
  const host = Tree.handleQuery('/?HOST_INFO', c, { oscPort: 9000, ip: '10.0.0.8' });
  assert.strictEqual(host.OSC_PORT, 9000);
  assert.strictEqual(host.OSC_TRANSPORT, 'UDP');
  const root = Tree.handleQuery('/', c, { live: { level: 0.2, bpm: 120, playing: true, track: 'Ada — North', blackout: true } });
  const bright = root.CONTENTS.cayadev.CONTENTS.show.CONTENTS.brightness;
  assert.strictEqual(bright.TYPE, 'f');
  assert.strictEqual(bright.ACCESS, 3);
  assert.deepStrictEqual(bright.VALUE, [1.4]);
  assert.strictEqual(bright.RANGE[0].MIN, 0.4);
  assert.strictEqual(bright.RANGE[0].MAX, 1.6);
  assert.strictEqual(root.CONTENTS.cayadev.CONTENTS.scene.VALUE[0], 'Şehir');
  assert.strictEqual(root.CONTENTS.cayadev.CONTENTS.level.ACCESS, 1);
  assert.strictEqual(root.CONTENTS.cayadev.CONTENTS.transport.VALUE[0], 'playing');
  assert.strictEqual(Tree.handleQuery('/yok', c, {}), null);
});

test('mDNS cevabı OSCQuery hizmetini ve portu taşır', () => {
  const name = Mdns.encodeName('_oscjson._tcp.local');
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x1234, 0);
  header.writeUInt16BE(1, 4);
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(12, 0);
  tail.writeUInt16BE(1, 2);
  const query = Buffer.concat([header, name, tail]);
  const reply = Mdns.answer(query, { port: 9010, ip: '10.0.0.8' });
  assert.strictEqual(reply.readUInt16BE(0), 0x1234);
  assert.ok(reply.readUInt16BE(2) & 0x8000);
  assert.ok(reply.includes(Buffer.from([0x23, 0x32])));
  assert.strictEqual(Mdns.answer(Buffer.from([0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 97, 0, 0, 1, 0, 1]), {}), null);
});

test('gerçek UDP: IPv4, IPv6 ve ikinci gönderen aynı porta ulaşır', async () => {
  const port = 18000 + Math.floor(Math.random() * 20000);
  const got = [];
  try {
    const st = await Server.start({ port }, (packet) => got.push(packet));
    assert.strictEqual(st.running, true, JSON.stringify(st));
    assert.strictEqual(st.ipv6, true, JSON.stringify(st));
    const a = Out.encodeMessage('/cayadev/show/blackout', [['i', 1]]);
    const b = Out.encodeMessage('/cayadev/crossfade', [['f', 0.25]]);
    await new Promise((resolve, reject) => {
      const s = dgram.createSocket('udp4');
      s.send(a, port, '127.0.0.1', (err) => { s.close(); err ? reject(err) : resolve(); });
    });
    await new Promise((resolve, reject) => {
      const s = dgram.createSocket('udp6');
      s.send(b, port, '::1', (err) => { s.close(); err ? reject(err) : resolve(); });
    });
    await new Promise((resolve, reject) => {
      const s = dgram.createSocket('udp4');
      s.send(a, port, '127.0.0.1', (err) => { s.close(); err ? reject(err) : resolve(); });
    });
    for (let i = 0; i < 40 && got.length < 3; i++) await wait(25);
    const names = got.map((p) => p.messages[0] && p.messages[0].address);
    assert.strictEqual(names.filter((n) => n === '/cayadev/show/blackout').length, 2, names.join(','));
    assert.ok(names.includes('/cayadev/crossfade'), names.join(','));
  } finally {
    await Server.stop();
  }
});

test('çıkışın UDP paketi girişte aynı adresi uygular', async () => {
  const port = 20000 + Math.floor(Math.random() * 10000);
  const got = [];
  const o = Out.normalize({ enabled: true, host: '127.0.0.1', port, prefix: '/cayadev' });
  const show = {
    blackout: false, palette: 'theme', brightness: 1, transition: 'cut', autovj: false, track: '',
    opacity: 0.5, crossfade: 0.75,
    controls: [{ path: 'audio.sensitivity', value: 1.25 }],
  };
  const sock = dgram.createSocket('udp4');
  try {
    const st = await Out.start(o, { enabled: false });
    assert.strictEqual(st.running, true, JSON.stringify(st));
    await new Promise((resolve) => sock.bind(port, '127.0.0.1', resolve));
    sock.on('message', (buf) => {
      const list = [];
      Server.parsePacket(buf, list, 0);
      got.push(...list);
    });
    assert.ok(new Out.Planner().frame(o, {}, { show }, Date.now()).length > 0);
    Out.clock(o, { show, playing: false, bpm: 120, phase: 0 });
    for (let i = 0; i < 40 && !got.some((m) => m.address === '/cayadev/show/opacity'); i++) await wait(25);
    const opacity = got.find((m) => m.address === '/cayadev/show/opacity');
    const sens = got.find((m) => m.address === '/cayadev/audio/sensitivity');
    assert.ok(opacity, got.map((m) => m.address).join(','));
    assert.ok(Math.abs(opacity.args[0] - 0.5) < 1e-4);
    assert.ok(sens && Math.abs(sens.args[0] - 1.25) < 1e-4);
    const step = Tree.plan(got, cfg()).steps.find((s) => s.path === 'master');
    assert.ok(step && Math.abs(step.value - 0.5) < 1e-4);
  } finally {
    try { sock.close(); } catch { /* kapalı */ }
    await Out.stop();
  }
});

test('OSCQuery HTTP güncel değeri döner', async () => {
  const port = 19000 + Math.floor(Math.random() * 10000);
  const st = await Query.start({
    port,
    oscPort: 9000,
    ip: '127.0.0.1',
    getState: () => ({ cfg: cfg(), live: { level: 0.5 } }),
  });
  assert.strictEqual(st.running, true, st.error);
  assert.strictEqual(st.port, port);
  assert.strictEqual(st.moved, false);
  assert.ok(st.mdns || st.mdnsAnnounce, JSON.stringify(st));
  const body = await new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:' + st.port + '/?HOST_INFO', (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
  const json = JSON.parse(body);
  assert.strictEqual(json.OSC_PORT, 9000);
  assert.strictEqual(json.NAME, 'SoundVisualizer');
  await Query.stop();
});

test('ayarlar ve bağlantı: öğrenme durur, öz test ağı açmaz', () => {
  const o = Tree.normalizeSettings({ enabled: true, port: 0, queryPort: 0, prefix: 'bozuk' });
  assert.strictEqual(o.port, 9000);
  assert.strictEqual(o.queryPort, 17801);
  assert.strictEqual(Tree.DEFAULT_QUERY_PORT, 17801);
  assert.strictEqual(o.prefix, '/cayadev');
  const kept = Tree.normalizeSettings({ queryPort: 9020, prefix: '/vj' });
  assert.strictEqual(kept.queryPort, 9020);
  assert.strictEqual(kept.prefix, '/vj');
  const main = read('src/main/main.js');
  assert.match(main, /oscTree\.delayMs\(packet && packet\.time/);
  assert.match(main, /if \(!o\.enabled \|\| HW_OFF\)/);
  assert.match(main, /oscQuery\.start\(/);
  assert.match(main, /oscQuery\.stop\(\)/);
  assert.match(main, /currentConfig\.control\.osc\.queryPort = q\.port;\r?\n\s*saveSettings\(currentConfig\)/);
  const panel = read('src/admin/control.js');
  assert.match(panel, /tree\.plan\(messages, cfg\)/);
  assert.match(panel, /applyLearned\(cfg, messages\[i\]\)/);
  assert.match(panel, /learning\.surface === 'osc'/);
  assert.match(panel, /toggleBlackout\(\{ quiet: true \}\)/);
  assert.match(panel, /applyScene\(sc\.id, \{ quiet: true \}\)/);
  assert.match(panel, /presetByName/);
  assert.match(panel, /Ana Opaklık/);
  const paths = new Set(Out.CONTROL_PATHS.map((s) => s.path));
  for (const s of Tree.SLIDERS) assert.ok(paths.has(s.path), s.path);
  assert.match(read('src/admin/index.html'), /shared\/osc-tree\.js/);
  assert.match(read('README.md'), /17801/);
  assert.match(read('README.tr.md'), /17801/);
  assert.match(read('src/admin/admin.js'), /title: 'OSC Girişi'/);
  assert.match(panel, /OSC Girişi Etkin/);
  assert.match(read('src/shared/i18n.js'), /'OSC Girişi': 'OSC Input'/);
  const lan = Query.chooseLanIPv4({
    'VirtualBox Host-Only Network': [{ family: 'IPv4', internal: false, address: '192.168.56.1' }],
    'Wi-Fi': [{ family: 'IPv4', internal: false, address: '192.168.1.180' }],
  });
  assert.strictEqual(lan, '192.168.1.180');
  const numbered = Query.chooseLanIPv4({
    'VirtualBox Host-Only Network': [{ family: 4, internal: false, address: '192.168.56.1' }],
    Ethernet: [{ family: 4, internal: false, address: '192.168.1.50' }],
  });
  assert.strictEqual(numbered, '192.168.1.50');
  const linux = Query.chooseLanIPv4({
    docker0: [{ family: 'IPv4', internal: false, address: '172.17.0.1' }],
    veth12ab: [{ family: 'IPv4', internal: false, address: '172.17.0.2' }],
    wlp3s0: [{ family: 'IPv4', internal: false, address: '192.168.1.20' }],
  });
  assert.strictEqual(linux, '192.168.1.20');
  const mac = Query.chooseLanIPv4({
    utun0: [{ family: 'IPv4', internal: false, address: '10.0.0.2' }],
    bridge100: [{ family: 'IPv4', internal: false, address: '192.168.64.1' }],
    en0: [{ family: 'IPv4', internal: false, address: '192.168.1.8' }],
  });
  assert.strictEqual(mac, '192.168.1.8');
  assert.strictEqual(Query.chooseLanIPv4({
    OpenVPN: [{ family: 'IPv4', internal: false, address: '10.8.0.2' }],
    enp0s3: [{ family: 'IPv4', internal: false, address: '192.168.1.9' }],
  }), '192.168.1.9');
  assert.strictEqual(Query.chooseLanIPv4({}), '127.0.0.1');
  const jumped = Query.queryCandidates(9010);
  assert.strictEqual(jumped[0], 9010);
  assert.ok(jumped.includes(17801));
  for (const reserved of [9000, 9001, 5353, 38471]) {
    assert.ok(!Query.queryCandidates(reserved).includes(reserved), String(reserved));
  }
  assert.match(read('src/main/osc-query.js'), /o\.ip \|\| lanIPv4\(\)/);
});

test('OSCQuery localhost başkasına aitse boş porta geçer', async () => {
  const dummy = http.createServer((req, res) => {
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('nope');
  });
  const taken = await new Promise((resolve) => {
    dummy.listen(0, '127.0.0.1', () => resolve(dummy.address().port));
  });
  try {
    const st = await Query.start({
      port: taken,
      oscPort: 9000,
      ip: '127.0.0.1',
      getState: () => ({ cfg: cfg() }),
    });
    assert.strictEqual(st.running, true, JSON.stringify(st));
    assert.notStrictEqual(st.port, taken);
    assert.strictEqual(st.moved, true);
    const body = await new Promise((resolve, reject) => {
      http.get('http://127.0.0.1:' + st.port + '/?HOST_INFO', (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }).on('error', reject);
    });
    assert.strictEqual(JSON.parse(body).NAME, 'SoundVisualizer');
    const blocked = await new Promise((resolve, reject) => {
      http.get('http://127.0.0.1:' + taken + '/?HOST_INFO', (res) => {
        resolve(res.statusCode);
        res.resume();
      }).on('error', reject);
    });
    assert.strictEqual(blocked, 426);
  } finally {
    await Query.stop();
    await new Promise((resolve) => dummy.close(() => resolve()));
  }
});
