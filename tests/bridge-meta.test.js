'use strict';
/* SES KÖPRÜSÜ, ÇALAN PARÇA (#813). Bütün alanlar isteğe bağlı: kaynak ne
   veriyorsa o gider (macOS/Linux'ta oturum okunmuyor, kapaksız parça, canlı
   yayında süre yok). Kapak parça başına bir kez, kimliğiyle; alıcı onu
   parçaya geri takar. Damgalar alıcının saatine çevrilir. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const B = require('../src/main/audio-bridge.js');

const SECRET = 'bridge-secret-0123456789';
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const until = async (fn, ms) => { const end = Date.now() + (ms || 3000); while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 15)); } return false; };
const COVER_A = 'data:image/jpeg;base64,' + Buffer.alloc(4000, 1).toString('base64');
const COVER_B = 'data:image/jpeg;base64,' + Buffer.alloc(5000, 2).toString('base64');

test('parça: eksik ve yanlış türdeki alanlar pakete girmiyor', () => {
  assert.deepStrictEqual(B.slimMeta({}), { has: false });
  assert.strictEqual(B.slimMeta(null), null);
  const m = B.slimMeta({ has: true, title: 'Parça', artist: '', album: 7, duration: NaN, position: -3, playing: 'yes', app: 'Spotify', updated: 1000, artwork: COVER_A, extra: 'x' });
  assert.deepStrictEqual(m, { has: true, title: 'Parça', app: 'Spotify', updated: 1000 });
  // has verilmezse başlıktan ya da sanatçıdan
  assert.strictEqual(B.slimMeta({ artist: 'A' }).has, true);
  assert.ok(B.slimMeta({ title: 'x'.repeat(5000) }).title.length <= 512);
});

test('kapak: yalnız resim veri URL’si, sınır içinde; aynı resim aynı kimlik', () => {
  assert.ok(B.artworkOk(COVER_A));
  assert.ok(!B.artworkOk('https://example.com/a.jpg'));
  assert.ok(!B.artworkOk('file:///tmp/a.jpg'));
  assert.ok(!B.artworkOk('data:text/html;base64,PGgxPg=='));
  assert.ok(!B.artworkOk('data:image/jpeg;base64,' + 'A'.repeat(B.MAX_ARTWORK)));
  assert.ok(!B.artworkOk(42));
  assert.strictEqual(B.artworkId(COVER_A), B.artworkId(COVER_A));
  assert.notStrictEqual(B.artworkId(COVER_A), B.artworkId(COVER_B));
  assert.strictEqual(B.artworkId(''), '');
});

test('TCP: kapak parça başına bir kez; konum güncellemesi kapağı yinelemiyor; kapaksız parça da geçiyor', async () => {
  const sender = B.createSender({ port: 0, host: '127.0.0.1', secret: SECRET, name: 'Köprü', id: 'm1' });
  const st = await sender.start();
  const metas = [];
  const rx = B.createReceiver({ host: '127.0.0.1', port: st.port, secret: SECRET, onMeta: (m) => metas.push(m) });
  rx.start();
  try {
    await until(() => sender.peerCount() === 1);
    const track = { has: true, title: 'Bir', artist: 'Sanatçı', album: 'Albüm', duration: 200, position: 10, playing: true, updated: Date.now(), received: Date.now(), artwork: COVER_A };
    sender.meta(track);
    for (let i = 0; i < 3; i++) sender.meta(Object.assign({}, track, { position: 11 + i }));
    await until(() => metas.length >= 4 && metas[metas.length - 1].position === 13);
    const last = metas[metas.length - 1];
    assert.strictEqual(last.artwork, COVER_A, 'kapak parçaya geri takıldı');
    assert.strictEqual(last.album, 'Albüm');
    assert.strictEqual(last.duration, 200);
    assert.strictEqual(last.playing, true);
    assert.ok(Math.abs(last.received - track.received) < 200, 'damga alıcının saatinde');
    assert.strictEqual(sender.status().artworkSent, 1, 'kapak bir kez gitti');
    // Yeni parça: yeni kapak bir kez daha
    sender.meta(Object.assign({}, track, { title: 'İki', artwork: COVER_B }));
    await until(() => metas[metas.length - 1].title === 'İki');
    assert.strictEqual(metas[metas.length - 1].artwork, COVER_B);
    assert.strictEqual(sender.status().artworkSent, 2);
    // macOS/Linux gibi: yalnız başlık, kapak yok, süre yok
    sender.meta({ has: true, title: 'Yalnız Başlık' });
    await until(() => metas[metas.length - 1].title === 'Yalnız Başlık');
    const bare = metas[metas.length - 1];
    assert.ok(!('artwork' in bare) && !('artist' in bare) && !('duration' in bare), JSON.stringify(bare));
    // Oturum yok (has:false): çökmeden geçer
    sender.meta({ has: false });
    await until(() => metas[metas.length - 1].has === false);
    assert.strictEqual(metas[metas.length - 1].has, false);
    assert.strictEqual(sender.status().artworkSent, 2);
  } finally { rx.stop(); await sender.stop(); }
});

test('TCP: sonradan bağlanan alıcı kapağı parçadan önce alıyor', async () => {
  const sender = B.createSender({ port: 0, host: '127.0.0.1', secret: SECRET, name: 'Köprü', id: 'm2' });
  const st = await sender.start();
  sender.meta({ has: true, title: 'Önceden', artwork: COVER_A });
  let meta = null;
  const rx = B.createReceiver({ host: '127.0.0.1', port: st.port, secret: SECRET, onMeta: (m) => { meta = m; } });
  rx.start();
  try {
    await until(() => meta && meta.title === 'Önceden');
    assert.strictEqual(meta.artwork, COVER_A);
  } finally { rx.stop(); await sender.stop(); }
});

test('ana süreç: kapak küçültülüyor; parça bilgisi okunamayan sistemde açık not', () => {
  const M = read('src/main/main.js');
  assert.match(M, /const k = Math\.min\(1, 512 \/ Math\.max\(width \|\| 1, height \|\| 1\)\);/);
  assert.match(M, /out = 'data:image\/jpeg;base64,' \+ img\.toJPEG\(85\)\.toString\('base64'\);\n\s+if \(!audioBridge\.artworkOk\(out\)\) out = '';/);
  assert.match(M, /if \(bridge\.sender\) bridge\.sender\.meta\(bridgeMetaOut\(st\)\);/);
  // Alıcı köprü girişindeyken çıkışlara (katmanlar, şarkı sözü) köprünün parçası gider
  assert.match(M, /if \(m && bridge\.input && bridge\.input\.useBridge\) forwardBridgeMeta\(m\);/);
  assert.match(M, /nowPlayingInfo: \{ supported: !!mediaSession\.supported,/);
  const S = read('src/bridge-status/status.js');
  assert.match(S, /info\.supported === false \? 'Çalan parça bilgisi bu sistemde okunamıyor \(yalnız Windows: SMTC\)\./);
  assert.ok(read('src/shared/i18n.js').includes("'Çalan parça bilgisi bu sistemde okunamıyor (yalnız Windows: SMTC). Köprü parça bilgisi göndermez; ses ve çözümleme etkilenmez.':"));
});
