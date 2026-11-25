'use strict';
/* Telefon bağlantısının canlı denetimi (src/main/link-live.js) ve hizmetin ortak kapısı:
 * her işlemin doğrulanıp sabit OSC ağacına ya da panelin tek girişine çevrilmesi, mutlak
 * değerler, aralık sıkıştırma, bilinmeyen sahne/eylem/efektin reddi, telefona giden ayardan
 * bu makineye ait anahtarların çıkarılması; anahtarlar çözülemezse deponun EZİLMEMESİ. */
const test = require('node:test');
const assert = require('node:assert');
const LL = require('../src/main/link-live.js');
const tree = require('../src/shared/osc-tree.js');
const RC = require('../src/main/remote-commands.js');
const { createService } = require('../src/main/phone-link-service.js');

const cfg = {
  scenes: [{ id: 'sc_1', name: 'Gece' }, { id: 'sc_2', name: 'Tünel' }],
  layers: [{ kind: 'background', type: 'gradient' }, { kind: 'visualizer', type: 'bars' }],
  autovj: { enabled: false },
};
const plan = (op, args) => LL.plan(op, args, cfg, tree, RC.ACTIONS);
const rejects = (op, args) => assert.throws(() => plan(op, args), (e) => e.code === 'bad-args', op + ' ' + JSON.stringify(args));

test('Canlı denetim: ağacın kapsadığı işler OSC iletisine, mutlak ve sıkıştırılmış', () => {
  assert.deepStrictEqual(plan('blackout', { on: true }), { kind: 'osc', message: { address: '/cayadev/show/blackout', args: [1] } });
  assert.deepStrictEqual(plan('blackout', { on: false }).message.args, [0]);
  rejects('blackout', {}); // "değiştir" yok: yeniden denenen istek ters çevirmesin
  rejects('blackout', { on: 'yes' });
  assert.deepStrictEqual(plan('tbar', { v: 1.7 }).message, { address: '/cayadev/show/tbar', args: [1] });
  assert.deepStrictEqual(plan('tbar', { v: 0.4, down: true }), { kind: 'panel', op: 'tbar', args: { v: 0.4, down: true } });
  assert.deepStrictEqual(plan('tbar', { v: 1, down: false }).args, { v: 1, down: false });
  assert.deepStrictEqual(plan('tbar', { take: true }), { kind: 'panel', op: 'take', args: {} });
  rejects('tbar', { v: NaN });
  assert.deepStrictEqual(plan('master.set', { v: -2 }).message.args, [0]);
  assert.deepStrictEqual(plan('mixer.set', { layer: 2, opacity: 0.4 }).message, { address: '/cayadev/layer/2/opacity', args: [0.4] });
  assert.deepStrictEqual(plan('mixer.set', { layer: 1, enabled: false }).message, { address: '/cayadev/layer/1/enabled', args: [0] });
  rejects('mixer.set', { layer: 3, opacity: 1 }); // olmayan katman: ağaç tutmaz
  rejects('mixer.set', { layer: 0, opacity: 1 });
  assert.deepStrictEqual(plan('deck.trigger', { row: 1, col: 2 }).message, { address: '/cayadev/deck/launch', args: [1, 2] });
  rejects('deck.trigger', { row: -1, col: 0 });
  rejects('deck.trigger', { row: 1.5, col: 0 });
  assert.deepStrictEqual(plan('deck.stop', {}).message, { address: '/cayadev/deck/stop', args: [1] });
  assert.deepStrictEqual(plan('deck.stop', { col: 3 }), { kind: 'panel', op: 'deckStopColumn', args: { col: 3 } });
  assert.deepStrictEqual(plan('autovj.toggle', { on: true }).message, { address: '/cayadev/show/autovj', args: [1] });
  // Uygulamanın kendi öneki kullanılır
  const pre = LL.plan('blackout', { on: true }, Object.assign({ control: { osc: { prefix: '/sahne' } } }, cfg), tree, RC.ACTIONS);
  assert.strictEqual(pre.message.address, '/sahne/show/blackout');
});

test('Canlı denetim: panel işleri yalnız bilinen kimlik, efekt, eylem ve aralıkla', () => {
  assert.deepStrictEqual(plan('scene.apply', { id: 'sc_2' }), { kind: 'panel', op: 'scene', args: { id: 'sc_2' } });
  rejects('scene.apply', { id: 'sc_9' });
  rejects('scene.apply', { id: 'x"); alert(1); ("' });
  assert.deepStrictEqual(plan('cue.set', { id: '' }).args, { id: '' });
  assert.deepStrictEqual(plan('cue.set', { id: 'sc_1' }).args, { id: 'sc_1' });
  rejects('cue.set', { id: 'yok' });
  assert.deepStrictEqual(plan('momentary', { list: ['flash', 'strobe', 'flash'] }).args, { list: ['flash', 'strobe'] });
  assert.deepStrictEqual(plan('momentary', { list: [] }).args, { list: [] });
  rejects('momentary', { list: ['ates'] });
  rejects('momentary', { list: 'flash' });
  assert.deepStrictEqual(plan('macro.set', { i: 7, v: 3 }).args, { i: 7, v: 1 });
  rejects('macro.set', { i: 8, v: 0.5 });
  assert.deepStrictEqual(plan('tempo.set', { bpm: 0 }).args, { bpm: 0 });
  assert.deepStrictEqual(plan('tempo.set', { bpm: 127.6 }).args, { bpm: 128 });
  assert.deepStrictEqual(plan('tempo.set', { bpm: 900 }).args, { bpm: LL.BPM_MAX });
  assert.deepStrictEqual(plan('tempo.set', { bpm: 3 }).args, { bpm: LL.BPM_MIN });
  rejects('tempo.set', { bpm: -1 });
  assert.deepStrictEqual(plan('milkdrop.nav', { dir: 'random' }).args, { dir: 'random' });
  rejects('milkdrop.nav', { dir: 'Lock' });
  assert.deepStrictEqual(plan('timeline.transport', { action: 'play' }).args, { action: 'play' });
  assert.deepStrictEqual(plan('timeline.transport', { action: 'seek', t: 12.5 }).args, { action: 'seek', t: 12.5 });
  rejects('timeline.transport', { action: 'seek', t: -1 });
  rejects('timeline.transport', { action: 'record' });
  assert.deepStrictEqual(plan('run', { id: 'mdNext' }).args, { id: 'mdNext' });
  rejects('run', { id: 'redTakeover' }); // yedeklilik devri telefondan değil
  rejects('config.patch', {});
});

test('Telefona giden ayar: jetonlar, köprü sırrı, MQTT parolası ve bağlantı anahtarları çıkarılır', () => {
  const full = { layers: [], scenes: [], stream: { token: 't' }, mcp: { token: 'm' }, phoneLink: { enabled: true }, bridge: { secret: 's' },
    mqtt: { password: 'p' }, redundancy: { secret: 'r' }, updates: {}, timeline: { tracks: [] } };
  const pub = LL.publicConfig(full);
  assert.deepStrictEqual(Object.keys(pub).sort(), ['layers', 'scenes', 'timeline']);
  for (const k of ['stream', 'mcp', 'phoneLink', 'bridge', 'mqtt', 'redundancy']) assert.ok(LL.PRIVATE_KEYS.indexOf(k) >= 0, k);
});

test('Anahtarlar çözülemezse depo EZİLMEZ; yeniden kurmak kullanıcının işi', () => {
  const saved = { v: 1, identity: { priv: 'e:bozuk', pub: Buffer.alloc(65, 4).toString('base64') }, devices: [{ id: 'd1', name: 'Redmi', level: 'full', key: 'e:bozuk' }] };
  let writes = 0;
  let stored = saved;
  const svc = createService({
    stream: { dropClient() {}, linkSendText() {}, linkSendBinary() {} },
    store: { read: () => stored, write: (o) => { writes++; stored = o; } },
    protect: { seal: (b) => 'e:' + Buffer.from(b).toString('base64'), unseal: () => { throw new Error('safeStorage yok'); } },
  });
  svc.setEnabled(true);
  const st = svc.status();
  assert.strictEqual(st.keysError, true);
  assert.strictEqual(writes, 0, 'dosyaya dokunulmadı');
  assert.strictEqual(stored, saved);
  assert.strictEqual(svc.newCode().pairing, null, 'okunamayan kimlikle eşleşme açılmaz');
  assert.strictEqual(writes, 0);
  // Kullanıcı "Anahtarları Yeniden Kur" dedi: yeni kimlik, boş liste
  svc.forgetAll();
  assert.strictEqual(writes, 1);
  assert.strictEqual(svc.status().keysError, false);
  assert.deepStrictEqual(stored.devices, []);
  assert.ok(stored.identity.priv.startsWith('e:'));
});
