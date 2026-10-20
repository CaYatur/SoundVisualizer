'use strict';
/* YEDEKLİLİK (#540–#547): durum makinesi, aktarılan anahtarlar, bağlantı
 * güvenliği ve bağlantılar. Gerçek iki makineli deneme `npm run failover`
 * (scripts/failover.js): birincil öldürülür, yedek eşik içinde ve doğru
 * sahnede yetkiyi alır.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const net = require('net');

const R = require('../src/main/redundancy.js');
const K = require('../src/shared/show-keys.js');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

test('ayarlar: rol, sınırlar; eşik en az üç atış; parola ve adres sorunu', () => {
  assert.strictEqual(R.normalize({ role: 'x' }).role, 'off');
  const n = R.normalize({ role: 'backup', heartbeatMs: 400, timeoutMs: 100, takeover: 'x', port: 80 });
  assert.strictEqual(n.timeoutMs, 1200, 'eşik en az 3 atış');
  assert.strictEqual(n.takeover, 'auto');
  assert.strictEqual(n.port, 1024);
  assert.strictEqual(R.problem({ role: 'off' }), '');
  assert.strictEqual(R.problem({ role: 'primary', secret: 'kısa' }), 'secret');
  assert.strictEqual(R.problem({ role: 'backup', secret: 'x'.repeat(16) }), 'host');
  assert.strictEqual(R.problem({ role: 'backup', secret: 'x'.repeat(16), host: '10.0.0.2' }), '');
});

test('yedek: atışla izler; bağlantı açıkken birincil meşgulse tam eşiği bekler', () => {
  const f = R.createFollower({ role: 'backup', heartbeatMs: 100, timeoutMs: 1500, takeover: 'auto' }, 0);
  f.connected();
  f.beat({ seq: 1, scene: 's1' }, 1000);
  assert.strictEqual(f.status.state, 'following');
  assert.strictEqual(f.status.scene, 's1');
  // Ölçüldü: birincil sahne değişiminde 0,2–0,7 sn duraklıyor — yetki alınmamalı
  assert.strictEqual(f.tick(1800), false);
  assert.strictEqual(f.status.state, 'following');
  assert.strictEqual(f.tick(2501), true);
  assert.strictEqual(f.status.state, 'active');
  assert.strictEqual(f.status.takenBy, 'auto');
});

test('yedek: bağlantı kapandıysa (süreç öldü) kısa payla, en az 300 ms', () => {
  const f = R.createFollower({ role: 'backup', heartbeatMs: 100, timeoutMs: 1500, takeover: 'auto' }, 0);
  f.connected();
  f.beat({ seq: 1 }, 1000);
  f.disconnected();
  assert.strictEqual(f.status.lossLimitMs, 300);
  assert.strictEqual(f.tick(1250), false, 'yeniden bağlanma payı');
  assert.strictEqual(f.tick(1301), true);
  assert.strictEqual(f.status.state, 'active');
  // Yeniden bağlanırsa (birincilin sunucusu yeniden başladı) yetki alınmaz
  const g = R.createFollower({ role: 'backup', heartbeatMs: 100, timeoutMs: 1500 }, 0);
  g.connected(); g.beat({}, 1000); g.disconnected();
  g.connected(); g.beat({}, 1200);
  assert.strictEqual(g.tick(1400), false);
  assert.strictEqual(g.status.state, 'following');
});

test('elle kipte kayıp der ve bekler; elle alınca alır; birincil dönse de bırakılana dek yetkide', () => {
  const f = R.createFollower({ role: 'backup', heartbeatMs: 100, timeoutMs: 1500, takeover: 'manual' }, 0);
  f.connected(); f.beat({}, 1000);
  assert.strictEqual(f.tick(2600), true);
  assert.strictEqual(f.status.state, 'lost');
  assert.strictEqual(f.tick(9000), false, 'kendiliğinden almaz');
  // Kayıpken atış dönerse izlemeye döner
  f.beat({}, 9100);
  assert.strictEqual(f.status.state, 'following');
  assert.strictEqual(f.takeover(9200), true);
  assert.strictEqual(f.status.takenBy, 'manual');
  f.beat({}, 9300);
  assert.strictEqual(f.status.state, 'active', 'birincil döndü: gidip gelme yok');
  assert.strictEqual(f.release(9400), true);
  assert.strictEqual(f.status.state, 'following');
  assert.strictEqual(f.follows(), true);
});

test('birincile hiç ulaşamayan yedek açılış payından sonra yetkiyi alır', () => {
  const f = R.createFollower({ role: 'backup', heartbeatMs: 250, timeoutMs: 1500, takeover: 'auto' }, 0);
  assert.strictEqual(f.tick(4900), false);
  assert.strictEqual(f.tick(5001), true);
  assert.strictEqual(f.status.state, 'active');
});

test('aktarılan anahtarlar: kurulum hiç gitmez; sahne listesi diğer kopyalarla aynı', () => {
  const cfg = { visualizer: { type: 'bars' }, audio: { device: 'x' }, display: { id: 2 }, stream: { port: 1 },
    lighting: { enabled: true }, redundancy: { role: 'primary', secret: 's' }, scenes: [{ id: 'a' }], _activeSceneId: 'a', mcp: { enabled: true } };
  const snap = R.snapshotMsg(cfg, 5);
  const all = Object.assign({}, snap.live, snap.show);
  ['audio', 'display', 'stream', 'lighting', 'redundancy', 'mcp'].forEach((k) => assert.strictEqual(all[k], undefined, k + ' aktarılmamalı'));
  assert.strictEqual(all.visualizer.type, 'bars');
  assert.strictEqual(all._activeSceneId, 'a');
  // Gelen ileti kurulumu değiştiremez
  const target = { audio: { device: 'mine' }, visualizer: { type: 'wave' } };
  const changed = R.applyIncoming(target, { type: 'patch', part: { audio: { device: 'theirs' }, visualizer: { type: 'bars' } } });
  assert.deepStrictEqual(changed, ['visualizer']);
  assert.strictEqual(target.audio.device, 'mine');
  assert.strictEqual(R.patchMsg(cfg, ['audio', 'stream'], 1), null, 'yalnız kurulum değiştiyse ileti yok');
  // SCENE listesi panel, kontrol, ana süreç ve MCP'dekiyle aynı
  const list = (src) => JSON.parse('[' + /SCENE_KEYS = \[([^\]]*)\]/.exec(src)[1].replace(/'/g, '"').replace(/,\s*$/, '') + ']');
  for (const f of ['src/admin/admin.js', 'src/admin/control.js', 'src/main/main.js', 'src/shared/mcp.js']) {
    assert.deepStrictEqual(list(read(f)), K.SCENE, f);
  }
});

/* Gerçek yayın sunucusu: yedek bağlantısı parolasız kabul edilmez; yayın
   katmanına giden iletiler yedeğe gitmez; yalnız yedek için açık sunucu
   yayın sayfası vermez. */
function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}
function openWs(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const msgs = [];
    ws.onmessage = (m) => { try { msgs.push(JSON.parse(m.data)); } catch { /* ikili */ } };
    ws.onopen = () => resolve({ ws, msgs, ok: true });
    ws.onerror = () => resolve({ ws, msgs, ok: false });
  });
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test('yayın sunucusu: yedek parolası şart, yedek izleyici sayılmaz, yayın iletisi almaz; yalnız-yedek sunucu sayfa vermez', { skip: typeof WebSocket === 'undefined' }, async () => {
  const S = require('../src/main/stream-server.js');
  const port = await freePort();
  const secret = 'p'.repeat(24);
  let opened = 0;
  let peerMsg = null;
  await S.start({ port, lan: false, peerOnly: true }, {
    getConfig: () => ({ redundancy: { secret } }),
    onPeerOpen: (c) => { opened++; S.sendJson(c, { type: 'hello' }); },
    onPeerMessage: (m) => { peerMsg = m; },
  });
  S.setPeerSecret(secret);
  try {
    const bad = await openWs('ws://127.0.0.1:' + port + '/ws?kind=peer&token=wrong');
    assert.strictEqual(bad.ok, false, 'yanlış parola reddedilir');
    const none = await openWs('ws://127.0.0.1:' + port + '/ws?kind=peer');
    assert.strictEqual(none.ok, false, 'parolasız reddedilir');
    const overlay = await openWs('ws://127.0.0.1:' + port + '/ws');
    assert.strictEqual(overlay.ok, false, 'yalnız-yedek sunucu yayın katmanı kabul etmez');
    const page = await fetch('http://127.0.0.1:' + port + '/overlay').then((r) => r.status);
    assert.strictEqual(page, 404);
    const peer = await openWs('ws://127.0.0.1:' + port + '/ws?kind=peer&token=' + secret);
    assert.strictEqual(peer.ok, true);
    await tick(100);
    assert.strictEqual(opened, 1);
    assert.strictEqual(S.peerCount(), 1);
    assert.strictEqual(S.clientCount(), 0, 'izleyici sayılmaz');
    S.broadcast({ type: 'config', config: { a: 1 } });
    S.sendPeers({ type: 'beat', seq: 1 });
    peer.ws.send(JSON.stringify({ type: 'peer-state', state: 'following' }));
    peer.ws.send(JSON.stringify({ type: 'set', path: 'visualizer.type', value: 'x' }));
    await tick(150);
    const types = peer.msgs.map((m) => m.type);
    assert.deepStrictEqual(types, ['hello', 'beat'], 'yayın iletisi yedeğe gitmez');
    assert.deepStrictEqual(peerMsg, { type: 'peer-state', state: 'following' }, 'yalnız durum iletisi');
    // Parola değişince bağlı yedek düşer
    S.setPeerSecret('q'.repeat(24));
    await tick(100);
    assert.strictEqual(S.peerCount(), 0);
    peer.ws.close();
  } finally {
    await S.stop();
  }
});

test('bağlantılar: ana süreç, panel, kontrol eylemleri, Otomatik VJ, MCP ve yayın sayfası', () => {
  const main = read('src/main/main.js');
  assert.match(main, /syncRedundancy\(\);\n\s*redundancyPush\(patchKeys\);/);
  assert.match(main, /syncRedundancy\(\); \/\/ birincilse yayın sunucusunu da açar/);
  assert.match(main, /if \(red\.role === 'primary'\) streamServer\.sendPeers\(\{ type: 'md-follow', follow \}\);/);
  assert.match(main, /setImmediate\(\(\) => \{ if \(red\.follower && red\.follower\.tick\(Date\.now\(\)\)\) onFollowerChanged\(\); \}\);/);
  assert.match(main, /applyIncomingConfig\(next, \{ patchKeys: changed, fromPrimary: true \}\);/);
  assert.match(main, /const peerOnly = !s\.enabled;/, 'yalnız-yedek sunucuda jeton üretilmez');
  assert.match(read('src/main/preload-admin.js'), /redundancyTakeover: \(\) => ipcRenderer\.invoke\('redundancy:takeover'\)/);
  const ctl = read('src/admin/control.js');
  assert.match(ctl, /\{ action: 'redTakeover', label: 'Yedeklilik · Yetkiyi Al' \}/);
  assert.match(ctl, /\{ action: 'redRelease', label: 'Yedeklilik · Yetkiyi Bırak' \}/);
  assert.match(read('src/admin/autovj.js'), /if \(window\.SVRedundancyPanel && window\.SVRedundancyPanel\.following\(\)\) return;/);
  assert.match(read('src/shared/mcp.js'), /redundancy: 'never',/);
  assert.match(read('src/shared/mcp.js'), /\['redundancy', 'secret'\]/);
  assert.match(read('src/main/stream-server.js'), /rd && typeof rd === 'object' && rd\.secret/, 'parola web istemcisine gitmez');
  assert.match(read('src/admin/index.html'), /<script src="redundancy-panel\.js"><\/script>/);
  assert.match(read('package.json'), /"failover": "node scripts\/failover\.js"/);
  const i18n = read('src/shared/i18n.js');
  ['Yetkiyi Al', 'Yetkiyi Bırak', 'Eşleşme Parolası', 'Birincili izliyor', 'Yedeklilik · Yetkiyi Al'].forEach((k) => assert.ok(i18n.includes("'" + k + "':"), k));
});
