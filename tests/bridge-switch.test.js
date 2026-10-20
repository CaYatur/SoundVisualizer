'use strict';
/* Köprü kaynak değiştirirken alıcı yedeğe dönüp geri gelmemeli (#813). */
const test = require('node:test');
const assert = require('node:assert');
const { createInputSwitch } = require('../src/main/bridge-input.js');
const B = require('../src/main/audio-bridge.js');

test('giriş: köprü "kaynak değişiyor" deyince kısa boşlukta yedeğe dönülmez', () => {
  const s = createInputSwitch({ lossMs: 600, firstMs: 300 });
  for (let t = 0; t <= 400; t += 14) s.frame(t);
  assert.strictEqual(s.state, 'bridge');
  s.hold(400, 3000);
  // 1,5 sn kare yok (yardımcı yeniden kuruluyor)
  for (let t = 400; t < 1900; t += 100) assert.strictEqual(s.tick(t), false);
  assert.strictEqual(s.state, 'bridge');
  assert.strictEqual(s.status(1000).holding, true);
  s.frame(1900);
  assert.strictEqual(s.state, 'bridge');
  assert.strictEqual(s.status(1900).switches, 1, 'tek geçiş: ilk bağlanış');
  // Hoşgörü bitti ve köprü gerçekten sustu: lossMs sonra yedek
  for (let t = 3400; t < 3400 + 600; t += 100) s.tick(t);
  assert.strictEqual(s.state, 'bridge');
  s.tick(4100);
  assert.strictEqual(s.state, 'fallback');
  // Hoşgörü en çok 5 sn
  const s2 = createInputSwitch({});
  s2.hold(0, 60000);
  assert.strictEqual(s2.status(5001).holding, false);
});

test('TCP: kaynak değişimi alıcıya bildiriliyor', async () => {
  const SECRET = 'bridge-secret-0123456789';
  const sender = B.createSender({ port: 0, host: '127.0.0.1', secret: SECRET, name: 'K', id: 's1' });
  const st = await sender.start();
  let got = null;
  const rx = B.createReceiver({ host: '127.0.0.1', port: st.port, secret: SECRET, onSwitching: (ms) => { got = ms; } });
  rx.start();
  try {
    const end = Date.now() + 3000;
    while (sender.peerCount() !== 1 && Date.now() < end) await new Promise((r) => setTimeout(r, 15));
    sender.switching(99999);
    while (got == null && Date.now() < end) await new Promise((r) => setTimeout(r, 15));
    assert.strictEqual(got, 5000, 'en çok 5 sn');
  } finally { rx.stop(); await sender.stop(); }
});
