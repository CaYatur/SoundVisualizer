'use strict';
/* OpenRGB istemcisinin uçtan uca testleri.
 *
 * Gerçek OpenRGB bu makinede kurulu değil, ama olması da şart değil: testler
 * protokolü konuşan gerçek bir TCP sunucusu açıyor ve istemci ona bağlanıyor.
 * Böylece donanıma giden son adım dışında HER ŞEY Windows'ta sınanabiliyor —
 * el sıkışma, sürüm pazarlığı, aygıt keşfi, renk paketleri, kopan bağlantı.
 *
 * "Ne gönderdiğimizi" tahmin etmiyoruz: sunucu telde ne gördüyse testler ona
 * bakıyor.
 */
const test = require('node:test');
const assert = require('node:assert');

const O = require('../src/main/openrgb.js');
const { createFakeServer, decodeLedPacket, CMD } = require('./helpers/openrgb-server.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LIGHTING = {
  enabled: true, mode: 'visualizer-sync', intensity: 0.9, brightness: 1,
  smoothing: 0.3, spread: 1, baseLevel: 0.1, colorSource: 'palette',
  color: '#ff0000', color2: '#0000ff', bandResponse: 'instant', layout: 'global',
  speed: 1, threshold: 0.5, hardness: 0.5, flashStrength: 0.5, paletteSource: 'palette',
};
const VISUAL = { visualizer: { color: '#00ff00', color2: '#ff00ff' }, background: { type: 'solid', solidColor: '#101010' } };
const FRAME = { level: 0.8, bass: 0.7, mid: 0.5, treble: 0.3, bars: [0.9, 0.5, 0.2] };

/* Her testten sonra istemci kapatılmalı: açık kalan bir soket ve yeniden
   bağlanma zamanlayıcısı sonraki testleri kirletir. */
async function withServer(opts, fn) {
  const fake = createFakeServer(opts);
  const port = await fake.listen();
  try {
    await fn(fake, port);
  } finally {
    await O.stop();
    await fake.close();
  }
}

test('bağlanır, kendini tanıtır ve aygıtları bulur', async () => {
  await withServer({
    devices: [{ name: 'Klavye', leds: 6 }, { name: 'Fare', leds: 2 }],
  }, async (fake, port) => {
    const st = await O.start({ enabled: true, host: '127.0.0.1', port });
    assert.strictEqual(st.connected, true, 'bağlanamadı: ' + st.error);
    assert.strictEqual(fake.clientName, O.CLIENT_NAME,
      'OpenRGB arayüzünde kimin sürdüğü görünmeli');
    assert.deepStrictEqual(st.devices.map((d) => d.name), ['Klavye', 'Fare']);
    assert.deepStrictEqual(st.devices.map((d) => d.leds), [6, 2]);
    assert.strictEqual(st.drivable, 2);
  });
});

test('sunucunun protokol sürümüne iner', async () => {
  await withServer({ protocol: 2 }, async (fake, port) => {
    const st = await O.start({ enabled: true, host: '127.0.0.1', port });
    assert.strictEqual(st.protocol, 2,
      'sunucudan yüksek sürümle konuşmak aygıt verisini yanlış çözer');
  });
});

test('sürümü hiç bildirmeyen eski sunucuyla da çalışır', async () => {
  /* Protokol 0 sunucuları bu komutu tanımaz ve CEVAP VERMEZ. Cevap beklemek
     bağlantıyı sonsuza kadar askıda bırakırdı. */
  await withServer({ protocol: 0, answerVersion: false }, async (fake, port) => {
    const st = await O.start({ enabled: true, host: '127.0.0.1', port });
    assert.strictEqual(st.connected, true, 'eski sunucuda bağlantı kurulamadı');
    assert.strictEqual(st.protocol, 0);
    assert.strictEqual(st.devices.length, 1);
  });
});

test('sürülebilir aygıtlar anlık renk moduna alınır', async () => {
  await withServer({
    devices: [{ name: 'Direkt', leds: 4, modes: ['Direct'] },
              { name: 'Sadece Efekt', leds: 4, modes: ['Rainbow', 'Breathing'] }],
  }, async (fake, port) => {
    const st = await O.start({ enabled: true, host: '127.0.0.1', port });
    await sleep(60);
    assert.strictEqual(st.drivable, 1, 'yalnız Direct modu olan sürülebilir');
    const calls = fake.customModeCalls().map((c) => c.device);
    assert.deepStrictEqual(calls, [0], 'yalnız sürülebilir aygıt moda alınmalı');
  });
});

test('yalnız kendi efektlerini oynatan aygıta renk gönderilmez', async () => {
  await withServer({
    devices: [{ name: 'Sadece Efekt', leds: 8, modes: ['Rainbow'] }],
  }, async (fake, port) => {
    await O.start({ enabled: true, host: '127.0.0.1', port });
    O.send({ enabled: true, fps: 60 }, LIGHTING, FRAME, VISUAL);
    await sleep(60);
    assert.strictEqual(fake.ledPackets().length, 0,
      'sürülemeyen aygıta paket yollamak sessizce hiçbir şey yapmaz');
  });
});

test('renk paketi aygıtın LED sayısı kadar renk taşır', async () => {
  await withServer({
    devices: [{ name: 'Şerit', leds: 12 }, { name: 'Fare', leds: 3 }],
  }, async (fake, port) => {
    await O.start({ enabled: true, host: '127.0.0.1', port });
    O.send({ enabled: true, fps: 60 }, LIGHTING, FRAME, VISUAL);
    await sleep(80);
    const pkts = fake.ledPackets();
    assert.strictEqual(pkts.length, 2, 'her aygıta bir paket');
    assert.strictEqual(decodeLedPacket(pkts[0].body).length, 12);
    assert.strictEqual(decodeLedPacket(pkts[1].body).length, 3);
    assert.strictEqual(pkts[0].device, 0);
    assert.strictEqual(pkts[1].device, 1);
  });
});

test('gönderilen renkler siyah değil ve ses ile değişiyor', async () => {
  await withServer({ devices: [{ name: 'Şerit', leds: 5 }] }, async (fake, port) => {
    await O.start({ enabled: true, host: '127.0.0.1', port });
    O.send({ enabled: true, fps: 60 }, LIGHTING, { level: 0.9, bass: 0.9, mid: 0.8, treble: 0.7, bars: [1, 1, 1] }, VISUAL);
    await sleep(40);
    O.send({ enabled: true, fps: 60 }, LIGHTING, { level: 0.05, bass: 0.02, mid: 0.02, treble: 0.01, bars: [0, 0, 0] }, VISUAL);
    await sleep(60);
    const pkts = fake.ledPackets();
    assert.ok(pkts.length >= 2, 'iki kare de gitmeliydi, gelen: ' + pkts.length);
    const loud = decodeLedPacket(pkts[0].body);
    const quiet = decodeLedPacket(pkts[pkts.length - 1].body);
    const sum = (c) => c.reduce((a, x) => a + x.r + x.g + x.b, 0);
    assert.ok(sum(loud) > 0, 'yüksek seste ışıklar sönük olmamalı');
    assert.ok(sum(loud) > sum(quiet), 'sessizlikte daha karanlık olmalı');
  });
});

test('parlaklık ayarı gerçekten kısıyor', async () => {
  await withServer({ devices: [{ name: 'Şerit', leds: 4 }] }, async (fake, port) => {
    await O.start({ enabled: true, host: '127.0.0.1', port });
    O.send({ enabled: true, fps: 60, brightness: 1 }, LIGHTING, FRAME, VISUAL);
    await sleep(40);
    O.send({ enabled: true, fps: 60, brightness: 0.25 }, LIGHTING, FRAME, VISUAL);
    await sleep(60);
    const pkts = fake.ledPackets();
    const sum = (b) => decodeLedPacket(b).reduce((a, x) => a + x.r + x.g + x.b, 0);
    assert.ok(sum(pkts[0].body) > sum(pkts[pkts.length - 1].body) * 1.5,
      'parlaklık 0.25 belirgin şekilde daha karanlık olmalı');
  });
});

test('aygıt seçimi listedekilerle sınırlı', async () => {
  await withServer({
    devices: [{ name: 'Klavye', leds: 4 }, { name: 'Fare', leds: 4 }, { name: 'Şerit', leds: 4 }],
  }, async (fake, port) => {
    await O.start({ enabled: true, host: '127.0.0.1', port });
    O.send({ enabled: true, fps: 60, devices: ['Fare'] }, LIGHTING, FRAME, VISUAL);
    await sleep(80);
    const pkts = fake.ledPackets();
    assert.strictEqual(pkts.length, 1);
    assert.strictEqual(pkts[0].device, 1, 'yalnız Fare sürülmeli');
  });
});

test('fps sınırı kareleri kısıyor', async () => {
  await withServer({ devices: [{ name: 'Şerit', leds: 4 }] }, async (fake, port) => {
    await O.start({ enabled: true, host: '127.0.0.1', port });
    for (let i = 0; i < 20; i++) O.send({ enabled: true, fps: 5 }, LIGHTING, FRAME, VISUAL);
    await sleep(80);
    assert.strictEqual(fake.ledPackets().length, 1,
      'saniyede 5 kare istenirken 20 paket gitmemeli');
  });
});

test('kapalıyken hiçbir şey gönderilmez', async () => {
  await withServer({ devices: [{ name: 'Şerit', leds: 4 }] }, async (fake, port) => {
    await O.start({ enabled: true, host: '127.0.0.1', port });
    O.send({ enabled: false, fps: 60 }, LIGHTING, FRAME, VISUAL);
    await sleep(60);
    assert.strictEqual(fake.ledPackets().length, 0);
  });
});

test('statik modda ışık sürülmez', async () => {
  /* Dinamik olmayan modlar sesi izlemez; kare göndermek anlamsız trafik. */
  await withServer({ devices: [{ name: 'Şerit', leds: 4 }] }, async (fake, port) => {
    await O.start({ enabled: true, host: '127.0.0.1', port });
    O.send({ enabled: true, fps: 60 }, Object.assign({}, LIGHTING, { mode: 'single-color' }), FRAME, VISUAL);
    await sleep(60);
    assert.strictEqual(fake.ledPackets().length, 0);
  });
});

test('sunucu yokken çökmez, hata bildirir', async () => {
  /* Kullanıcı OpenRGB'yi açmamış olabilir. Bu bir arıza değil, beklenen bir
     durum — ama sessizce yutulmamalı. */
  const st = await O.start({ enabled: true, host: '127.0.0.1', port: 6 });
  assert.strictEqual(st.connected, false);
  assert.ok(st.error, 'hata bildirilmeli');
  O.send({ enabled: true, fps: 60 }, LIGHTING, FRAME, VISUAL); // atmamalı
  await O.stop();
});

test('aygıt listesi değişince yeniden taranır', async () => {
  await withServer({ devices: [{ name: 'Klavye', leds: 4 }] }, async (fake, port) => {
    await O.start({ enabled: true, host: '127.0.0.1', port });
    const before = fake.received.filter((r) => r.command === CMD.REQUEST_CONTROLLER_COUNT).length;
    fake.announceDeviceChange();
    await sleep(150);
    const after = fake.received.filter((r) => r.command === CMD.REQUEST_CONTROLLER_COUNT).length;
    assert.ok(after > before, 'sunucu değişikliği bildirince yeniden taranmalı');
  });
});

test('bağlantı koparsa durum düşer ve renk gönderilmez', async () => {
  await withServer({ devices: [{ name: 'Şerit', leds: 4 }] }, async (fake, port) => {
    await O.start({ enabled: true, host: '127.0.0.1', port });
    assert.strictEqual(O.status().connected, true);
    fake.dropClients();
    await sleep(120);
    assert.strictEqual(O.status().connected, false, 'kopan bağlantı bağlı görünmemeli');
    assert.strictEqual(O.status().devices.length, 0, 'aygıt listesi temizlenmeli');
    O.send({ enabled: true, fps: 60 }, LIGHTING, FRAME, VISUAL); // atmamalı
  });
});

test('stop her şeyi bırakır', async () => {
  await withServer({ devices: [{ name: 'Şerit', leds: 4 }] }, async (fake, port) => {
    await O.start({ enabled: true, host: '127.0.0.1', port });
    const st = await O.stop();
    assert.strictEqual(st.running, false);
    assert.strictEqual(st.connected, false);
    assert.strictEqual(st.devices.length, 0);
  });
});
