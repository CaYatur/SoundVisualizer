'use strict';
/* 3.1.5 öncesi sağlamlaştırma (12.10).

   - Yayın sunucusu yapılandırmayı gönderirken overlay ve kumanda
     jetonlarını da gönderiyordu: overlay bağlantısını bilen biri kumanda
     jetonunu okuyabiliyordu. Sayfalar jetonu adresten alıyor.
   - Pencereler uygulama dışına gidebiliyordu (bırakılan bağlantı, dosya);
     önyükleme köprüsü o sayfada da çalışırdı. target="_blank" bağlantı
     uygulamanın içinde çıplak bir pencere açıyordu (ölçüldü: OpenRGB
     bağlantısı).
   - Dışa aktarma IPC'si çıktı yolunu denetlemiyordu; MCP'nin kuralı
     (yerel, mutlak .mp4) artık ikisinde de.
   - MilkDrop ayrıştırıcısı fonksiyon adını düz nesnede arıyordu; miras
     adlar yalnız argüman sayısı denetimi sayesinde reddediliyordu (#560). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const url = require('url');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');
const Stream = require('../src/main/stream-server.js');
const Nav = require('../src/main/nav-guard.js');
const M = require('../src/shared/milkdrop.js');

test('yayın: yapılandırma ve yama jetonsuz gider, kaynak değişmez', () => {
  const cfg = {
    stream: { enabled: true, token: 'overlay-secret', remoteToken: 'remote-secret', port: 8722, lan: true },
    milkdrop: { textureDir: 'C:/Users/x/textures' },
    visualizer: { type: 'bars' },
  };
  const snap = JSON.stringify(cfg);
  const out = Stream.publicConfig(cfg);
  assert.strictEqual(out.stream.token, '');
  assert.strictEqual(out.stream.remoteToken, '');
  assert.strictEqual(out.stream.port, 8722);
  assert.match(out.milkdrop.textureDir, /^textures:[0-9a-f]{12}$/);
  assert.strictEqual(out.visualizer, cfg.visualizer);
  assert.strictEqual(JSON.stringify(cfg), snap, 'kaynak yazılmadı');
  assert.ok(!JSON.stringify(Stream.publicConfig({ stream: { token: 'a' } })).includes('"a"'), 'yama');
  assert.deepStrictEqual(Stream.publicConfig({ audio: {} }), { audio: {} });
  assert.strictEqual(Stream.publicConfig(null), null);
  const src = read('src/main/stream-server.js');
  assert.match(src, /type: 'config', config: publicConfig\(hooks\.getConfig\(\)\)/);
  assert.match(src, /obj\.type === 'config-patch'\) obj = Object\.assign\(\{\}, obj, \{ patch: publicConfig\(obj\.patch\) \}\)/);
  // Web sayfaları jetonu yapılandırmadan okumuyor
  for (const f of ['src/web/web-shim.js', 'src/web/remote.js']) {
    assert.ok(!/stream\.(token|remoteToken)/.test(read(f)), f);
  }
});

test('gezinme: yalnız uygulama klasörü', () => {
  const root = path.join(__dirname, '..', 'src');
  const page = url.pathToFileURL(path.join(root, 'admin', 'index.html')).href;
  assert.strictEqual(Nav.isAppPage(page, root), true);
  assert.strictEqual(Nav.isAppPage(page + '?x=1#y', root), true);
  assert.strictEqual(Nav.isAppPage(url.pathToFileURL(path.join(root, '..', 'README.md')).href, root), false);
  assert.strictEqual(Nav.isAppPage(url.pathToFileURL(root + '-evil/a.html').href, root), false, 'ön ek eşleşmesi değil');
  for (const bad of ['https://example.com/', 'http://127.0.0.1:8722/', 'data:text/html,x', 'javascript:alert(1)', '', null, 'not a url']) {
    assert.strictEqual(Nav.isAppPage(bad, root), false, String(bad));
  }
  assert.strictEqual(Nav.isAppPage('file:///C:/App/resources/app.asar/src/admin/index.html', 'c:\\App\\resources\\app.asar\\src', 'win32'), process.platform === 'win32', 'Windows büyük/küçük harf');
  assert.strictEqual(Nav.isWebLink('https://openrgb.org/'), true);
  assert.strictEqual(Nav.isWebLink('http://openrgb.org/'), false);
  assert.strictEqual(Nav.isWebLink('file:///C:/x.exe'), false);
});

test('gezinme kilidi: her pencereye kurulur, açılır pencere yok', () => {
  const app = new EventEmitter();
  const opened = [];
  const root = path.join(__dirname, '..', 'src');
  Nav.install(app, { openExternal: (u) => opened.push(u) }, root);
  const contents = new EventEmitter();
  let handler = null;
  contents.setWindowOpenHandler = (h) => { handler = h; };
  app.emit('web-contents-created', {}, contents);
  const nav = (target, ev) => {
    let stopped = false;
    contents.emit(ev || 'will-navigate', { preventDefault: () => { stopped = true; } }, target);
    return stopped;
  };
  assert.strictEqual(nav('https://example.com/'), true);
  assert.strictEqual(nav('file:///C:/Users/x/Downloads/a.html'), true);
  assert.strictEqual(nav('https://example.com/', 'will-redirect'), true);
  assert.strictEqual(nav(url.pathToFileURL(path.join(root, 'admin', 'index.html')).href), false);
  assert.deepStrictEqual(handler({ url: 'https://openrgb.org/' }), { action: 'deny' });
  assert.deepStrictEqual(handler({ url: 'file:///C:/x.exe' }), { action: 'deny' });
  assert.deepStrictEqual(opened, ['https://openrgb.org/']);
  assert.match(read('src/main/main.js'), /require\('\.\/nav-guard'\)\.install\(app, shell, path\.join\(__dirname, '\.\.'\)\);/);
});

test('dışa aktarma: çıktı yerel ve mutlak, uzantı biçimin kendisi; ses yolu mutlak', () => {
  const mcp = require('../src/shared/mcp.js');
  assert.strictEqual(mcp.badOutPath('C:/Videos/a.mp4', ['mp4']), '');
  for (const bad of ['tcp://10.0.0.1:9/a.mp4', 'pipe:1', 'a.mp4', 'C:/Users/x/AppData/Roaming/run.bat', '//server/share/a.mp4']) {
    assert.ok(mcp.badOutPath(bad, ['mp4']), bad);
  }
  const main = read('src/main/main.js');
  const body = main.slice(main.indexOf('async function startExportJob(opts)'), main.indexOf('async function startExportJob(opts)') + 1400);
  assert.match(body, /typeof audioPath !== 'string' \|\| !path\.isAbsolute\(audioPath\)/);
  // Uzantı serbest değil: seçilen biçimin tablodaki uzantısı (#521)
  assert.match(body, /require\('\.\.\/shared\/mcp'\)\.badOutPath\(outputPath, \[fmt\.ext\]\)/);
  assert.ok(main.indexOf('badOutPath(outputPath', main.indexOf('async function startExportJob')) < main.indexOf('spawn(ff, args', main.indexOf('async function startExportJob')), 'yol denetimi ffmpeg başlamadan');
  assert.ok(mcp.badOutPath('C:/Videos/a.mov', ['mp4']), 'başka biçimin uzantısı reddedilmeli');
});

test('MilkDrop: miras adlar fonksiyon değildir (#560)', () => {
  for (const name of Object.getOwnPropertyNames(Object.prototype)) {
    for (let n = 0; n <= 3; n++) {
      const args = Array.from({ length: n }, () => '1').join(',');
      for (const md2Funcs of [false, true]) {
        const r = M.compile('x = ' + name + '(' + args + ');', null, { md2Funcs });
        assert.ok(r.error, name + '(' + args + ') md2=' + md2Funcs);
      }
    }
  }
  assert.ok(!M.compile('x = sin(1);').error, 'gerçek fonksiyon derlenir');
});
