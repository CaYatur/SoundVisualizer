'use strict';
/* 3.1.5 öncesi OSC gözden geçirmesi (12.10).

   Yalıtılmış kopyada ölçüldü:
   - OSCQuery ağacında /cayadev/visualizer (tür adı) yaprağı aynı adlı dalı
     eziyordu: 51 adresin 12'si (görselleştirici ve arkaplan kaydırıcıları)
     ağaçta yoktu, GET /cayadev/visualizer/glow 404 dönüyordu.
   - GET /constructor nesnenin mirasına çözülüyor, JSON'a çevrilemiyor ve
     Buffer.byteLength ana süreçte yakalanmamış hata atıyordu; istek
     yanıtsız kalıyordu. Sunucu 0.0.0.0'da: yerel ağdaki her makine erişir.
   - Her ayar gönderimi (kaydırıcı sürükleme, gelen her OSC iletisi) UDP
     soketlerini, OSCQuery sunucusunu ve mDNS duyurusunu baştan kuruyordu:
     durumdaki ileti sayacı hep 0'a dönüyordu.
   - Ana opaklığın siyah tülü şeffaf arkaplanda masaüstünü karartıyordu. */
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const Tree = require('../src/shared/osc-tree.js');
const Query = require('../src/main/osc-query.js');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');

global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;

function paths(node, out) {
  if (node.TYPE) out.push(node.FULL_PATH);
  for (const k of Object.keys(node.CONTENTS || {})) paths(node.CONTENTS[k], out);
  return out;
}

test('OSCQuery ağacı her yaprağı taşır; değerli düğüm dalını da tutar', () => {
  const cfg = SV.defaultConfig();
  cfg.layers = [{ name: 'Ön', opacity: 1 }];
  const root = Tree.queryTree(cfg, { live: { level: 0.5, bpm: 120, playing: true, track: 'x' } });
  const all = paths(root, []);
  assert.strictEqual(new Set(all).size, all.length);
  for (const s of Tree.SLIDERS) {
    const p = '/cayadev/' + s.path.replace(/\./g, '/');
    assert.ok(all.includes(p), p);
  }
  const vis = root.CONTENTS.cayadev.CONTENTS.visualizer;
  assert.strictEqual(vis.TYPE, 's', 'tür adı yaprağı');
  assert.strictEqual(vis.CONTENTS.glow.TYPE, 'f', 'kaydırıcı dalı');
  const bg = root.CONTENTS.cayadev.CONTENTS.background;
  assert.strictEqual(bg.TYPE, 's');
  assert.strictEqual(bg.CONTENTS.gradient.CONTENTS.brightness.TYPE, 'f');
  const glow = Tree.handleQuery('/cayadev/visualizer/glow', cfg, {});
  assert.deepStrictEqual(glow.VALUE, [cfg.visualizer.glow]);
});

test('miras adları düğüm değildir', () => {
  const cfg = SV.defaultConfig();
  for (const name of Object.getOwnPropertyNames(Object.prototype)) {
    for (const p of ['/' + name, '/cayadev/' + name, '/cayadev/show/' + name]) {
      assert.strictEqual(Tree.handleQuery(p, cfg, {}), null, p);
    }
  }
});

test('OSCQuery HTTP: miras adı 404 döner, sunucu çalışmaya devam eder', async () => {
  const port = 19000 + Math.floor(Math.random() * 10000);
  const st = await Query.start({ port, oscPort: 9000, ip: '127.0.0.1', getState: () => ({ cfg: SV.defaultConfig() }) });
  assert.strictEqual(st.running, true, st.error);
  const get = (p) => new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: st.port, path: p, timeout: 2000, agent: false }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout ' + p)); });
    req.on('error', reject);
  });
  try {
    assert.strictEqual(await get('/constructor'), 404);
    assert.strictEqual(await get('/cayadev/toString'), 404);
    assert.strictEqual(await get('/cayadev/visualizer/glow'), 200);
  } finally {
    await Query.stop();
  }
  const src = read('src/main/osc-query.js');
  assert.match(src, /if \(typeof json !== 'string'\) \{/);
});

test('ayar gönderimi OSC dinleyicisini yeniden kurmaz', () => {
  const main = read('src/main/main.js');
  const body = main.slice(main.indexOf('function syncOscServer(opts)'), main.indexOf('/* ---------------------------------------------------------------- calan parca'));
  assert.match(body, /const key = o\.port \+ ':' \+ o\.queryPort;/);
  assert.match(body, /if \(!force && oscInPending && oscInPending\.key === key\) return oscInPending\.promise;/);
  assert.match(body, /if \(!force && !oscInPending && key === oscInKey\) return Promise\.resolve\(oscInStatus\(\)\);/);
  // Kısa yol nesli artırmadan döner: süren dinleyicinin iletileri düşmez
  assert.ok(body.indexOf('const gen = ++oscInGen;\n  const job') > body.indexOf('key === oscInKey'));
  assert.match(main, /ipcMain\.handle\('osc:sync', \(\) => syncOscServer\(\{ force: true \}\)\);/);
  assert.match(main, /syncOscServer\(\);\n  syncArtnet\(\);/, 'applyIncomingConfig zorlamaz');
});

test('ana opaklık şeffaf arkaplanda saydamlaştırır, karartmaz', () => {
  const src = read('src/visualizer/visualizer.js');
  const fn = src.slice(src.indexOf('function applyMaster()'), src.indexOf('function applyBackgroundKey'));
  assert.match(fn, /window\.SVLayers\.seeThrough\(cfg\)/);
  assert.match(fn, /veil\.style\.opacity = see \? '0' : String\(1 - o\);/);
  assert.match(fn, /document\.body\.style\.opacity = see && o < 1 \? String\(o\) : '';/);
});

test('önizleme döngüsü çalışırken drawOnce ikinci kare çizmez', () => {
  const src = read('src/admin/preview.js');
  assert.match(src, /function drawOnce\(\) \{\n    if \(raf && !paused && !document\.hidden\) return;/);
});

test('OSC çıkış notu: seviyeler açık bir çıkıştan, İngilizcesiyle', () => {
  const note = 'Seviye, tayf ve vuruşları açık bir çıkış ölçer: ekran, yüzen pencere ya da Spout/Syphon. Yalnız panel açıkken saat ve gösteri durumu gider.';
  assert.ok(read('src/admin/control.js').includes(note));
  assert.ok(read('src/shared/i18n.js').includes("'" + note + "':"));
  assert.match(read('README.md'), /With only the control\npanel open, the clock and the show state still go out\./);
  assert.match(read('README.tr.md'), /Yalnız kontrol paneli açıkken saat ve gösteri durumu yine gider\./);
});
