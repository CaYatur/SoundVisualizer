'use strict';
/* Ana sürümü farklı iki makine eşleşmez (#905). Canlı denendi, iki yön de:
   4.x yedek 3.x birincile bağlandı: anlık görüntü uygulanmadı, yetki alınmadı.
   3.x yedek 4.x birincile bağlandı: gösteri gitmedi, yedek izlemede kaldı. Bağlantı kesilseydi
   eski yedek kendiliğinden yetki alıyordu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const R = require('../src/main/redundancy.js');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('ana sürüm: farklıysa uyumsuz, aynıysa ya da bilinmiyorsa değil', () => {
  assert.strictEqual(R.majorOf('v4.0.0-beta.1'), 4);
  assert.strictEqual(R.majorOf('3.1.7'), 3);
  assert.strictEqual(R.majorOf(''), null);
  assert.strictEqual(R.majorOf(null), null);
  assert.strictEqual(R.majorMismatch('3.1.7', '4.0.0'), true);
  assert.strictEqual(R.majorMismatch('4.0.0', '4.2.1'), false);
  assert.strictEqual(R.majorMismatch('3.1.6', '3.1.7'), false);
  assert.strictEqual(R.majorMismatch('', '4.0.0'), false, 'sürüm bilinmiyor');
  assert.strictEqual(R.majorMismatch(undefined, '4.0.0'), false);
});

test('yedek hello ile keser, birincil peer-info ile keser; ikisi de durumda görünür', () => {
  const main = read('src/main/main.js');
  const onMsg = main.slice(main.indexOf('function onPrimaryMessage'), main.indexOf('if (msg.type === \'show-clock\')'));
  assert.ok(onMsg.indexOf('refusePrimaryMajor') < onMsg.indexOf('red.primaryStart = msg.start'), 'önce ana sürüm');
  const refuse = main.slice(main.indexOf('function refusePrimaryMajor'), main.indexOf('function refusePeerMajor'));
  assert.match(refuse, /red\.follower = null/, 'kayıp sayıp yetki almasın');
  assert.match(refuse, /red\.tickTimer = null/);
  assert.match(main, /refusePeerMajor\(client, msg\.version\)/);
  const peer = main.slice(main.indexOf('function refusePeerMajor'), main.indexOf('function redundancyStatus'));
  assert.match(peer, /client\.peerRefused = true/);
  assert.doesNotMatch(peer, /dropClient/, 'kesilirse eski yedek yetki alıyor');
  const open = main.slice(main.indexOf('function onPeerOpen'), main.indexOf('function finishPeerOpen'));
  assert.doesNotMatch(open, /sendPeerSnapshot/, 'anlık görüntü sürümü bekliyor');
  const server = read('src/main/stream-server.js');
  assert.match(server, /!c\.peerRefused \|\| obj\.type === 'beat'/);
  assert.match(main, /problem: red\.versionMismatch \? 'version'/);
  const panel = read('src/admin/redundancy-panel.js');
  const i18n = read('src/shared/i18n.js');
  for (const t of ['Birincil farklı ana sürümde, eşleşme yapılmadı. İki makineye aynı ana sürümü kurup uygulamayı yeniden açın.',
    'Yedek farklı ana sürümde, bağlantı kesildi. İki makineye aynı ana sürümü kurup uygulamayı yeniden açın.']) {
    assert.ok(panel.includes(t), t);
    assert.ok(i18n.includes("'" + t + "':"), t);
  }
});
