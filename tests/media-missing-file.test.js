'use strict';
/* Dosyası olmayan video katmanı "dosya bulunamadı" der, HEVC çaresini değil.

   sv-media işleyicisi olmayan dosyaya 404 döner; Chromium bunu da
   MEDIA_ERR_SRC_NOT_SUPPORTED (kod 4) olarak bildiriyor. Önizleme bu yüzden
   "Bu video biçimi oynatılamıyor... Donanım Video Çözme" yazıyordu ve
   kullanıcı çözücü ayarıyla uğraşıyordu. Katman artık kaynağın bir baytını
   isteyip yanıtın durum koduna bakıyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const FILE = 'sv-media://local/C%3A%5CKayip%20Klasor%5Ckonser-giris.mp4';
const HEVC = "Bu video biçimi oynatılamıyor. HEVC/H.265 ise Ayarlar → Uygulama → Donanım Video Çözme'yi açıp uygulamayı yeniden başlatın.";

function loadMedia(fetchImpl, protocol) {
  const videos = [];
  const el = (tag) => {
    const v = {
      tag, muted: false, error: null, onerror: null,
      removeAttribute() {}, load() {}, pause() {}, getContext: () => ({}),
      play() { return new Promise((resolve, reject) => { v._reject = reject; }); },
    };
    if (tag === 'video') videos.push(v);
    return v;
  };
  const calls = [];
  const ctx = {
    document: { createElement: el },
    location: { protocol: protocol || 'file:', search: protocol === 'http:' ? '?token=t1' : '' },
    navigator: {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    URLSearchParams,
    Promise,
    fetch: (url, opts) => { calls.push({ url, opts }); return fetchImpl(url, opts); },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('src/visualizer/modes/media.js'), ctx);
  return { ctx, videos, calls };
}

const flush = () => new Promise((r) => setImmediate(r));

async function failWith(status, fault, protocol) {
  const env = loadMedia(() => Promise.resolve({ status, body: { cancel() {} } }), protocol);
  const published = [];
  env.ctx.SVMediaStatus = (p) => published.push(p);
  const m = new env.ctx.SVMedia();
  m.apply({ enabled: true, source: 'file', file: FILE, loop: true });
  const v = env.videos[0];
  v.error = fault;
  v.onerror();
  v._reject(Object.assign(new Error('no supported source'), { name: 'NotSupportedError' }));
  assert.strictEqual(m.error, null, 'yanıt gelmeden çözücü çaresi gösterilmemeli');
  await flush();
  await flush();
  return { m, env, published };
}

test('olmayan dosya: kod 4 gelse de "Video dosyası bulunamadı: <ad>"', async () => {
  const { m, env, published } = await failWith(404, { code: 4, message: 'MEDIA_ELEMENT_ERROR: Format error' });
  assert.strictEqual(m.error, 'Video dosyası bulunamadı: konser-giris.mp4');
  assert.strictEqual(m.ready, false);
  assert.strictEqual(env.calls.length, 1, 'onerror ve play() reddi tek yoklama yapmalı');
  assert.strictEqual(env.calls[0].url, FILE, 'videonun açtığı adres yoklanır');
  assert.strictEqual(env.calls[0].opts.headers.Range, 'bytes=0-0', 'dosyanın tamamı istenmez');
  assert.strictEqual(published[published.length - 1].error, 'Video dosyası bulunamadı: konser-giris.mp4');
});

test('dosya var ama çözülemiyor: HEVC çaresi kalıyor', async () => {
  const { m } = await failWith(206, { code: 4, message: 'DEMUXER_ERROR_COULD_NOT_OPEN' });
  assert.strictEqual(m.error, HEVC);
});

test('yalnız 404 "yok" sayılır; 403/415/500 ve ağ hatası eski iletiyi verir', async () => {
  for (const status of [403, 415, 500]) {
    const { m } = await failWith(status, { code: 4 });
    assert.strictEqual(m.error, HEVC, 'durum ' + status);
  }
  const env = loadMedia(() => Promise.reject(new TypeError('Failed to fetch')));
  const m = new env.ctx.SVMedia();
  m.apply({ enabled: true, source: 'file', file: FILE });
  env.videos[0].error = { code: 4 };
  env.videos[0].onerror();
  await flush();
  await flush();
  assert.strictEqual(m.error, HEVC);
});

test('yayın sayfasında /media-file adresi yoklanır', async () => {
  const { m, env } = await failWith(404, { code: 4 }, 'http:');
  assert.match(env.calls[0].url, /^\/media-file\?v=sv-media.*&token=t1$/);
  assert.strictEqual(m.error, 'Video dosyası bulunamadı: konser-giris.mp4');
});

test('kapatıp açınca aynı anahtar yeniden yoklanır', async () => {
  const { m, env } = await failWith(404, { code: 4 });
  m.apply({ enabled: false, source: 'file', file: FILE, loop: true });
  m.apply({ enabled: true, source: 'file', file: FILE, loop: true });
  const v = env.videos[0];
  v.error = { code: 4 };
  v.onerror();
  await flush();
  await flush();
  assert.strictEqual(env.calls.length, 2);
  assert.strictEqual(m.error, 'Video dosyası bulunamadı: konser-giris.mp4');
});

test('ağ hatası (kod 2) yoklama yapmadan eski iletiyi verir', () => {
  const env = loadMedia(() => { throw new Error('çağrılmamalı'); });
  const m = new env.ctx.SVMedia();
  m.apply({ enabled: true, source: 'file', file: FILE });
  env.videos[0].error = { code: 2, message: 'ağ' };
  env.videos[0].onerror();
  assert.strictEqual(m.error, 'Video açılamadı: ağ');
  assert.strictEqual(env.calls.length, 0);
});

test('dosya adı her adres biçiminden çıkarılıyor', () => {
  const { ctx } = loadMedia(() => Promise.resolve({ status: 404 }));
  const name = ctx.SVMissingVideo;
  assert.strictEqual(name(FILE), 'Video dosyası bulunamadı: konser-giris.mp4');
  assert.strictEqual(name('/media-file?v=' + encodeURIComponent(FILE) + '&token=x'), 'Video dosyası bulunamadı: konser-giris.mp4');
  assert.strictEqual(name('/home/u/klip.webm'), 'Video dosyası bulunamadı: klip.webm');
  assert.strictEqual(name(''), 'Video dosyası bulunamadı.');
});

/* Sayfa CSP'si sv-media'ya fetch izni vermezse yoklama sessizce düşer ve
   eski ileti geri gelir; vm testi bunu göremez. */
test('medya katmanını yükleyen sayfalar sv-media\'ya bağlanabiliyor', () => {
  for (const page of ['src/admin/index.html', 'src/visualizer/index.html', 'src/exporter/index.html']) {
    const html = read(page);
    assert.ok(html.includes('modes/media.js'), page + ' medya katmanını yüklemiyor');
    const csp = /connect-src ([^;]+);/.exec(html);
    assert.ok(csp, page + ': connect-src yok');
    assert.ok(csp[1].split(/\s+/).includes('sv-media:'), page + ': connect-src sv-media: içermiyor');
  }
});

test('ana süreç olmayan dosyaya 404 döner', () => {
  const { serveMediaFile } = require('../src/main/media-file.js');
  const res = serveMediaFile(path.join(ROOT, 'yok', 'konser-giris.mp4'), 'bytes=0-0');
  assert.strictEqual(res.status, 404);
  const S = read('src/main/stream-server.js');
  assert.match(S, /try \{ stat = fs\.statSync\(local\); \} catch \{ res\.writeHead\(404\)/, 'yayın sunucusu da 404 dönmeli');
});
