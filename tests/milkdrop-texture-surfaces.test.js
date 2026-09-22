'use strict';
/* MİLKDROP DOKULARI HER YÜZEYDE (#586).
 *
 * Doku klasörü seçiliyken dokular yalnız görselleştirici pencerelerinde
 * yükleniyordu:
 *   - panelin canlı önizlemesinde köprü LİSTEYİ veriyordu ama tek dokuyu
 *     veren çağrı yoktu; önizleme gürültü çiziyordu,
 *   - web çıkışının (OBS) dosya erişimi yok ve yayın sunucusunda doku
 *     yolu yoktu,
 *   - dışa aktarıcıda motorun kullandığı `window.api` köprüsü hiç yoktu.
 *
 * Buradaki testler yayın sunucusunu Node'da gerçek HTTP ve WebSocket ile,
 * motoru sahte bir GL ile çalıştırıyor. Köprüler (preload) Electron
 * olmadan yüklenemediği için onlar kaynaktan denetleniyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const vm = require('vm');

global.window = global.window || {};
const TEX = require('../src/main/milkdrop-textures.js');
const S = require('../src/main/stream-server.js');
const L = require('../src/visualizer/layers.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

// 1x1 PNG: sunucu içeriği doğrulamıyor ama gerçek bir görsel göndermek dürüst.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64');

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-md-tex-'));
  const dir = path.join(base, 'textures');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'clouds.png'), PNG);
  fs.writeFileSync(path.join(dir, 'notlar.txt'), 'görsel değil');
  // Klasörün DIŞINDA, adı geçerli bir görsel: kapsam denetimi bunu vermemeli.
  fs.writeFileSync(path.join(base, 'gizli.png'), PNG);
  return { base, dir };
}

// ------------------------------------------------ doku yardımcıları (ortak)

test('doku listesi: yalnız görsel dosyalar, klasör yoksa boş', () => {
  const { dir } = fixture();
  assert.deepStrictEqual(TEX.listTextures(dir).names, ['clouds.png']);
  assert.deepStrictEqual(TEX.listTextures(''), { dir: '', names: [] });
  const gone = TEX.listTextures(path.join(dir, 'yok'));
  assert.deepStrictEqual(gone.names, []);
  assert.strictEqual(gone.error, 'READ_FAILED');
});

test('doku dosyası: doğrulanmış yol, tür ve boyut; sınırın üstü ve dışarısı reddediliyor', () => {
  const { dir } = fixture();
  const t = TEX.textureFileInfo(dir, 'clouds.png', 1024);
  assert.strictEqual(t.file, path.join(dir, 'clouds.png'));
  assert.strictEqual(t.mime, 'image/png');
  assert.strictEqual(t.size, PNG.length);
  assert.strictEqual(TEX.textureFileInfo(dir, 'clouds.png', PNG.length - 1), null, 'boyut sınırı');
  assert.strictEqual(TEX.textureFileInfo(dir, '../gizli.png', 1024), null, 'klasör dışı');
  assert.strictEqual(TEX.textureFileInfo(dir, 'notlar.txt', 1024), null, 'görsel değil');
  assert.strictEqual(TEX.textureFileInfo(dir, 'yok.png', 1024), null, 'dosya yok');
  assert.strictEqual(TEX.textureFileInfo('', 'clouds.png', 1024), null, 'klasör seçilmemiş');
});

test('ana süreç: IPC ile yayın sunucusu AYNI iki yardımcıyı kullanıyor', () => {
  const main = strip(read('src/main/main.js'));
  // Kullanıcının klasörü ve içe aktarılan dokuların klasörü, bu sırayla (#574)
  assert.match(main, /function textureDirs\(\) \{\s*return \[textureDir\(\), managedTextureDir\(\)\];\s*\}/);
  assert.match(main, /function textureNames\(\) \{\s*return mdTex\.listTexturesIn\(textureDirs\(\)\);\s*\}/);
  assert.match(main, /function textureFile\(name\) \{\s*return mdTex\.textureFileInfoIn\(textureDirs\(\), name, TEX_MAX_BYTES\);\s*\}/);
  assert.match(main, /ipcMain\.handle\('milkdrop:textures', \(\) => textureNames\(\)\)/);
  assert.match(main, /ipcMain\.handle\('milkdrop:texture', \(e, name\) => \{\s*const t = textureFile\(name\);/);
  assert.match(main, /mdTextureNames: \(\) => textureNames\(\)\.names,/);
  assert.match(main, /mdTextureFile: \(name\) => textureFile\(name\),/);
});

// ------------------------------------------------------------ yayın sunucusu

function get(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        type: res.headers['content-type'] || '',
        body: Buffer.concat(chunks),
      }));
    }).on('error', reject);
  });
}

/* Ham WebSocket istemcisi: Node 20'de yerleşik WebSocket yok ve CI orada da
   koşuyor. Sunucudan gelen çerçeveler maskesiz; yalnız metin okunuyor. */
function wsConnect(port, query) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: '/ws?' + query,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
        'Sec-WebSocket-Version': '13',
      },
    });
    req.on('upgrade', (res, socket, head) => {
      const msgs = [];
      const waiters = [];
      let buf = head;
      const pump = () => {
        for (;;) {
          if (buf.length < 2) return;
          const op = buf[0] & 0x0f;
          let len = buf[1] & 0x7f;
          let off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (buf.length < off + len) return;
          const payload = buf.subarray(off, off + len);
          buf = buf.subarray(off + len);
          if (op === 1) msgs.push(JSON.parse(payload.toString('utf8')));
          while (waiters.length) waiters.shift()();
        }
      };
      socket.on('data', (d) => { buf = Buffer.concat([buf, d]); pump(); });
      pump();
      const next = async (type) => {
        for (;;) {
          const i = msgs.findIndex((m) => m.type === type);
          if (i >= 0) return msgs.splice(i, 1)[0];
          await new Promise((r) => waiters.push(r));
        }
      };
      resolve({ socket, next });
    });
    req.on('response', (res) => reject(new Error('yükseltme yok: ' + res.statusCode)));
    req.on('error', reject);
    req.end();
  });
}

async function startServer(dir) {
  const hooks = {
    getConfig: () => ({ milkdrop: { textureDir: dir, presetId: 'x' }, stream: {} }),
    mdTextureNames: () => TEX.listTextures(dir).names,
    mdTextureFile: (name) => TEX.textureFileInfo(dir, name, 8 * 1024 * 1024),
  };
  for (let i = 0; i < 20; i++) {
    const port = 20000 + Math.floor(Math.random() * 30000);
    const st = await S.start({ enabled: true, port, requireToken: true, token: 'ovl', remoteToken: 'rmt' }, hooks);
    if (st.running) return port;
  }
  throw new Error('boş port bulunamadı');
}

test('yayın sunucusu: doku uç noktaları jetonun arkasında, adla çalışıyor, klasörden çıkmıyor', { timeout: 15000 }, async () => {
  const { dir } = fixture();
  const port = await startServer(dir);
  try {
    // Jetonsuz: medya dosyası gibi reddediliyor.
    assert.strictEqual((await get(port, '/milkdrop/textures')).status, 401);
    assert.strictEqual((await get(port, '/milkdrop/texture?name=clouds.png')).status, 401);

    const list = await get(port, '/milkdrop/textures?token=ovl');
    assert.strictEqual(list.status, 200);
    assert.match(list.type, /^application\/json/);
    const names = JSON.parse(list.body.toString('utf8'));
    assert.deepStrictEqual(names, { names: ['clouds.png'] });
    assert.ok(!list.body.toString('utf8').includes(dir), 'yanıt klasörün yolunu içermemeli');

    const one = await get(port, '/milkdrop/texture?name=clouds.png&token=ovl');
    assert.strictEqual(one.status, 200);
    assert.strictEqual(one.type, 'image/png');
    assert.ok(one.body.equals(PNG), 'dosyanın baytları birebir gelmeli');

    // Kapsam: klasör dışı, görsel olmayan ve olmayan dosya aynı cevabı alıyor.
    for (const bad of ['../gizli.png', '..%2Fgizli.png', '..%5Cgizli.png', 'notlar.txt', 'yok.png', '']) {
      const r = await get(port, '/milkdrop/texture?name=' + bad + '&token=ovl');
      assert.strictEqual(r.status, 404, bad + ' verilmemeli');
    }
  } finally {
    await S.stop();
  }
});

test('yayın sunucusu: web istemcisine doku klasörünün YOLU değil özeti gidiyor', { timeout: 15000 }, async () => {
  const { dir } = fixture();
  const port = await startServer(dir);
  let ws = null;
  try {
    ws = await wsConnect(port, 'kind=overlay&token=ovl');
    // Açılıştaki yapılandırma
    const first = await ws.next('config');
    const tag = first.config.milkdrop.textureDir;
    assert.match(tag, /^textures:[0-9a-f]{12}$/);
    assert.ok(!JSON.stringify(first).includes(dir), 'yol sayfaya gitmemeli');
    assert.strictEqual(first.config.milkdrop.presetId, 'x', 'geri kalan ayar olduğu gibi');

    // Sonraki yayınlar da süzülüyor; klasör değişince özet de değişiyor.
    const other = path.join(dir, '..', 'baska');
    S.broadcast({ type: 'config', config: { milkdrop: { textureDir: other } } });
    const second = await ws.next('config');
    assert.match(second.config.milkdrop.textureDir, /^textures:[0-9a-f]{12}$/);
    assert.notStrictEqual(second.config.milkdrop.textureDir, tag);
    assert.ok(!JSON.stringify(second).includes('baska'));
  } finally {
    if (ws) ws.socket.destroy();
    await S.stop();
  }
});

test('yapılandırma özeti: yol yoksa dokunulmuyor, girdi değişmiyor, aynı yol aynı özet', () => {
  const cfg = { milkdrop: { textureDir: 'D:\\dokular', blendTime: 2 }, other: 1 };
  const out = S.publicConfig(cfg);
  assert.strictEqual(cfg.milkdrop.textureDir, 'D:\\dokular', 'girdi değişmemeli');
  assert.strictEqual(out.other, 1);
  assert.strictEqual(out.milkdrop.blendTime, 2);
  assert.strictEqual(out.milkdrop.textureDir, S.publicConfig(cfg).milkdrop.textureDir);
  const none = { milkdrop: { textureDir: '' } };
  assert.strictEqual(S.publicConfig(none), none);
  assert.strictEqual(S.publicConfig(null), null);
  assert.deepStrictEqual(S.publicConfig({ a: 1 }), { a: 1 });
});

// ------------------------------------------------------------- web köprüsü

function loadShim(search) {
  const fetched = [];
  class FakeWS {
    constructor() { this.readyState = 0; }
    send() {}
    close() {}
  }
  const win = {
    location: { search, pathname: '/', protocol: 'http:', host: 'localhost:1' },
    URLSearchParams,
    WebSocket: FakeWS,
    document: { documentElement: { setAttribute() {} } },
    setTimeout: () => 0,
    Date,
    fetch: (url) => {
      fetched.push(url);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ names: ['clouds.png'] }) });
    },
  };
  win.window = win;
  vm.runInContext(read('src/web/web-shim.js'), vm.createContext(win), { filename: 'web-shim.js' });
  return { win, fetched };
}

test('web köprüsü: doku listesi ve tek doku sunucudan, jeton adreste', async () => {
  const { win, fetched } = loadShim('?token=t%26k');
  const list = await win.api.milkdropTextures();
  assert.deepStrictEqual(Array.from(list.names), ['clouds.png']);
  assert.deepStrictEqual(fetched, ['/milkdrop/textures?token=t%26k']);
  const one = await win.api.milkdropTexture('bulut ağı.png');
  assert.strictEqual(one.url, '/milkdrop/texture?name=bulut%20a%C4%9F%C4%B1.png&token=t%26k');

  const open = loadShim('');
  await open.win.api.milkdropTextures();
  assert.deepStrictEqual(open.fetched, ['/milkdrop/textures']);
  assert.strictEqual((await open.win.api.milkdropTexture('clouds.png')).url, '/milkdrop/texture?name=clouds.png');
});

// ------------------------------------------------------------------ köprüler

test('köprüler: önizleme ve dışa aktarıcı da tek dokuyu isteyebiliyor', () => {
  const admin = strip(read('src/main/preload-admin.js'));
  assert.match(admin, /milkdropTextures: \(\) => ipcRenderer\.invoke\('milkdrop:textures'\)/);
  assert.match(admin, /milkdropTexture: \(name\) => ipcRenderer\.invoke\('milkdrop:texture', name\)/);

  const exp = strip(read('src/main/preload-exporter.js'));
  const api = exp.match(/exposeInMainWorld\('api', \{([\s\S]*?)\}\);/);
  assert.ok(api, 'dışa aktarıcı window.api açmalı');
  assert.match(api[1], /milkdropTextures: \(\) => ipcRenderer\.invoke\('milkdrop:textures'\)/);
  assert.match(api[1], /milkdropTexture: \(name\) => ipcRenderer\.invoke\('milkdrop:texture', name\)/);

  const vis = strip(read('src/main/preload-visualizer.js'));
  assert.match(vis, /milkdropTexture: \(name\) => ipcRenderer\.invoke\('milkdrop:texture', name\)/);
});

// -------------------------------------------------------------------- motor

const ENGINE = path.join(ROOT, 'src', 'visualizer', 'modes', 'milkdrop.js');

function loadEngine(api) {
  const images = [];
  class FakeImage {
    constructor() { this.naturalWidth = 0; this.naturalHeight = 0; images.push(this); }
    set src(v) {
      this._src = v;
      setImmediate(() => {
        if (/bozuk/.test(v)) { if (this.onerror) this.onerror(); return; }
        this.naturalWidth = 8;
        this.naturalHeight = 4;
        if (this.onload) this.onload();
      });
    }
    get src() { return this._src; }
  }
  const canvas = () => ({ width: 320, height: 240, getContext: (k) => (k === '2d' ? {} : null), addEventListener() {} });
  const ctx = { window: { api }, document: { createElement: canvas }, console, Image: FakeImage };
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ENGINE, 'utf-8'), ctx, { filename: ENGINE });
  let n = 0;
  const gl = new Proxy({}, {
    get(_, k) {
      if (k === 'createTexture') return () => ({ id: ++n });
      if (k === 'getExtension') return () => null;
      return () => undefined;
    },
  });
  const m = new ctx.window.SVModes.milkdrop(canvas());
  m.gl = gl;
  return { m, images };
}

const CFG = { milkdrop: { textureDir: 'textures:abc' } };

test('motor: web çıkışının adresi de doku kaynağı; bekleyen istekler sayılıyor', async () => {
  const { m, images } = loadEngine({
    milkdropTextures: () => Promise.resolve({ names: ['clouds.png'] }),
    milkdropTexture: (name) => Promise.resolve({ name, url: '/milkdrop/texture?name=' + name }),
  });
  m._ensureTextureLib(CFG);
  assert.strictEqual(m.texturesPending(), 1, 'liste isteği sayılmalı');
  await m.whenTexturesSettled();
  assert.strictEqual(m.texturesPending(), 0);

  assert.strictEqual(m._userTexture('sampler_clouds'), null, 'ilk karede hazır değil');
  assert.strictEqual(m.texturesPending(), 1);
  await m.whenTexturesSettled();
  assert.strictEqual(images[images.length - 1].src, '/milkdrop/texture?name=clouds.png');
  const t = m._userTexture('sampler_clouds');
  assert.ok(t && t.tex, 'doku yerleşmeli');
  assert.deepStrictEqual([t.w, t.h], [8, 4]);
  assert.strictEqual(m.texturesPending(), 0);
});

/* Liste gelmeden ad çözülemiyor. Eskiden o karede "dosya yok" yazılıp bir
   SONRAKİ karede yeniden isteniyordu; dışa aktarımın ilk iki karesi bu
   yüzden gürültüydü. Şimdi istek liste gelir gelmez gidiyor ve bekleyen,
   dosya yerleşene kadar bekliyor. */
test('motor: liste beklenirken istenen doku liste gelir gelmez isteniyor', async () => {
  let listRelease = null;
  let asked = 0;
  const { m } = loadEngine({
    milkdropTextures: () => new Promise((r) => { listRelease = () => r({ names: ['clouds.png'] }); }),
    milkdropTexture: (name) => { asked++; return Promise.resolve({ name, url: '/t/' + name }); },
  });
  m._ensureTextureLib(CFG);
  assert.strictEqual(m._userTexture('sampler_clouds'), null);
  assert.strictEqual(asked, 0, 'liste gelmeden dosya istenemez');
  const settled = m.whenTexturesSettled();
  listRelease();
  await settled;
  assert.strictEqual(asked, 1);
  assert.ok(m.userTex.clouds && m.userTex.clouds.tex, 'bekleme dosya yerleşmeden bitmemeli');
});

test('motor: uygulama içi data: adresi eskisi gibi çalışıyor', async () => {
  const { m, images } = loadEngine({
    milkdropTextures: () => Promise.resolve({ names: ['clouds.png'] }),
    milkdropTexture: (name) => Promise.resolve({ name, dataUrl: 'data:image/png;base64,AAAA' }),
  });
  m._ensureTextureLib(CFG);
  await m.whenTexturesSettled();
  m._userTexture('sampler_clouds');
  await m.whenTexturesSettled();
  assert.strictEqual(images[images.length - 1].src, 'data:image/png;base64,AAAA');
  assert.ok(m._userTexture('sampler_clouds').tex);
});

test('motor: başarısız her istek sayaçtan BİR KEZ düşüyor', async () => {
  for (const reply of [
    () => Promise.resolve(null),
    () => Promise.resolve({ name: 'x' }),
    () => Promise.reject(new Error('ipc')),
    (name) => Promise.resolve({ name, url: '/bozuk/' + name }),
  ]) {
    const { m } = loadEngine({
      milkdropTextures: () => Promise.resolve({ names: ['clouds.png', 'worms.jpg'] }),
      milkdropTexture: reply,
    });
    m._ensureTextureLib(CFG);
    await m.whenTexturesSettled();
    m._userTexture('sampler_clouds');
    m._userTexture('sampler_worms');
    assert.strictEqual(m.texturesPending(), 2);
    await m.whenTexturesSettled();
    assert.strictEqual(m.texturesPending(), 0);
    assert.strictEqual(m._userTexture('sampler_clouds'), null, 'gürültüde kalmalı');
  }
  // Liste isteği başarısız olsa da düşüyor.
  const { m } = loadEngine({ milkdropTextures: () => Promise.reject(new Error('ipc')), milkdropTexture: () => null });
  m._ensureTextureLib(CFG);
  await m.whenTexturesSettled();
  assert.strictEqual(m.texturesPending(), 0);
});

test('motor: atılırken bekleyen serbest kalıyor, geç gelen doku yerleşmiyor', async () => {
  let release = null;
  const { m } = loadEngine({
    milkdropTextures: () => Promise.resolve({ names: ['clouds.png'] }),
    milkdropTexture: (name) => new Promise((r) => { release = () => r({ name, url: '/t/' + name }); }),
  });
  m._ensureTextureLib(CFG);
  await m.whenTexturesSettled();
  m._userTexture('sampler_clouds');
  const waiting = m.whenTexturesSettled();
  m.dispose();
  await waiting;
  assert.strictEqual(m.texturesPending(), 0);
  release();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(m.texturesPending(), 0, 'sayaç eksiye düşmemeli');
});

// ------------------------------------------------------ yığın ve dışa aktarıcı

test('yığın: bekleyen dokular geçişteki giden sahne dahil toplanıyor', async () => {
  const mode = (n) => {
    let done = null;
    return {
      n,
      texturesPending: () => n,
      whenTexturesSettled: () => new Promise((r) => { done = r; }),
      finish: () => done && done(),
    };
  };
  const a = mode(2);
  const b = mode(1);
  const fake = {
    entries: [{ mode: a }, { mode: null }, { mode: {} }],
    trans: { stack: { entries: [{ mode: b }] } },
  };
  fake._assetModes = L.LayerStack.prototype._assetModes;
  assert.strictEqual(L.LayerStack.prototype.assetsPending.call(fake), 3);
  let settled = false;
  const w = L.LayerStack.prototype.whenAssetsSettled.call(fake).then(() => { settled = true; });
  a.finish();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(settled, false, 'giden sahnenin dokusu da beklenmeli');
  b.finish();
  await w;
  assert.strictEqual(settled, true);
});

test('dışa aktarıcı: her kareden sonra dokular bekleniyor, süre dolarsa iş açıkça duruyor', () => {
  const exp = strip(read('src/exporter/exporter.js'));
  const loop = exp.match(/for \(let i = 0; i < totalFrames && !cancelled; i\+\+\) \{([\s\S]*?)\n    \}/);
  assert.ok(loop, 'kare döngüsü bulunamadı');
  assert.match(loop[1], /if \(!\(await settleAssets\(\)\)\) \{\s*window\.exp\.error\(ASSET_LATE\);\s*return;\s*\}/);
  assert.match(exp, /Promise\.race\(\[stack\.whenAssetsSettled\(\)\.then\(\(\) => true\), late\]\)/);
  assert.doesNotMatch(exp, /assetWait = false/, 'süre dolunca sessizce devam etmemeli');

  const msg = read('src/exporter/exporter.js').match(/const ASSET_LATE = '([^']+)';/);
  assert.ok(msg);
  const sec = read('src/exporter/exporter.js').match(/const ASSET_WAIT_MS = (\d+);/);
  assert.ok(msg[1].includes(String(Number(sec[1]) / 1000) + ' saniyede'), 'iletideki süre sabitle aynı olmalı');
  assert.ok(read('src/shared/i18n.js').includes("'" + msg[1] + "': "), 'iletinin İngilizcesi olmalı');
});
