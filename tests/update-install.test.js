'use strict';
/* Güncellemeyi indir, doğrula, kur (#640, 2. adım). Ağ ve disk sahte:
 * yönlendirme kuralları, boyut sınırı, SHA-256 doğrulaması ve kurulum
 * komutları gerçek bir indirme olmadan sınanıyor. */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { Readable, Writable } = require('stream');
const I = require('../src/main/update-install.js');

const DATA = Buffer.from('CAYADEV-Visualizer yeni sürüm içeriği '.repeat(4000));
const SHA = crypto.createHash('sha256').update(DATA).digest('hex');

function memFs() {
  const files = {};
  return {
    files,
    createWriteStream(p) {
      const parts = [];
      const w = new Writable({ write(c, e, cb) { parts.push(Buffer.from(c)); cb(); } });
      w.on('finish', () => { files[p] = Buffer.concat(parts); });
      return w;
    },
    async rename(a, b) { if (!files[a]) throw new Error('yok ' + a); files[b] = files[a]; delete files[a]; },
    async unlink(p) { if (!files[p]) throw new Error('yok'); delete files[p]; },
    async chmod(p, mode) { files[p + ':mode'] = mode; },
  };
}
// Sahte ağ: adres -> yanıt
function net(routes) {
  const seen = [];
  const request = async (url) => {
    seen.push(url);
    const r = routes[url];
    if (!r) return { status: 404, headers: {}, body: Readable.from([]) };
    if (r.redirect) return { status: 302, headers: { location: r.redirect }, body: Readable.from([]) };
    return { status: 200, headers: {}, body: Readable.from(chunks(r.data || DATA)) };
  };
  request.seen = seen;
  return request;
}
function chunks(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i += 16384) out.push(buf.subarray(i, i + 16384));
  return out;
}
const GH = 'https://github.com/CaYatur/SoundVisualizer/releases/download/v9.9.9/x-windows-setup.exe';
const CDN = 'https://release-assets.githubusercontent.com/abc?sig=1';

test('izinli adresler: yalnız https ve GitHub alan adları', () => {
  assert.ok(I.allowedUrl(GH));
  assert.ok(I.allowedUrl(CDN));
  assert.ok(!I.allowedUrl('http://github.com/x'));
  assert.ok(!I.allowedUrl('https://github.com.evil.example/x'));
  assert.ok(!I.allowedUrl('https://evilgithubusercontent.com/x'));
  assert.ok(!I.allowedUrl('çöp'));
});

test('indirme: GitHub CDN yönlendirmesi izleniyor, özet tutunca .part yerine konuyor', async () => {
  const fsx = memFs();
  const request = net({ [GH]: { redirect: CDN }, [CDN]: {} });
  const progress = [];
  const r = await I.download({ url: GH, size: DATA.length, digest: SHA, dest: '/t/x.exe', request, fsx, onProgress: (p) => progress.push(p) });
  assert.strictEqual(r.sha256, SHA);
  assert.ok(fsx.files['/t/x.exe'].equals(DATA));
  assert.strictEqual(fsx.files['/t/x.exe.part'], undefined);
  assert.deepStrictEqual(request.seen, [GH, CDN]);
  assert.strictEqual(progress[progress.length - 1], 1);
});

test('indirme: yanlış özet reddediliyor ve hiçbir dosya kalmıyor', async () => {
  const fsx = memFs();
  const bad = Buffer.from(DATA);
  bad[100] ^= 1;
  await assert.rejects(I.download({ url: GH, size: DATA.length, digest: SHA, dest: '/t/x.exe', request: net({ [GH]: { data: bad } }), fsx }), /sha256 mismatch/);
  assert.deepStrictEqual(Object.keys(fsx.files), []);
});

test('indirme: bildirilenden büyük dosya kesiliyor; eksik dosya reddediliyor', async () => {
  let fsx = memFs();
  await assert.rejects(I.download({ url: GH, size: DATA.length - 10, digest: SHA, dest: '/t/x.exe', request: net({ [GH]: {} }), fsx }), /larger/);
  assert.deepStrictEqual(Object.keys(fsx.files), []);
  fsx = memFs();
  await assert.rejects(I.download({ url: GH, size: DATA.length + 10, digest: SHA, dest: '/t/x.exe', request: net({ [GH]: {} }), fsx }), /size mismatch/);
  assert.deepStrictEqual(Object.keys(fsx.files), []);
  fsx = memFs();
  const gzip = async () => ({ status: 200, headers: { 'content-encoding': 'gzip' }, body: Readable.from(chunks(DATA)) });
  await assert.rejects(I.download({ url: GH, size: DATA.length, digest: SHA, dest: '/t/x.exe', request: gzip, fsx }), /compressed body refused/);
  assert.deepStrictEqual(Object.keys(fsx.files), [], 'sıkıştırılmış gövde diske yazılmaz');
  assert.strictEqual(I.refusedEncoding({}), '');
  assert.strictEqual(I.refusedEncoding({ 'content-encoding': 'identity' }), '');
  assert.match(I.refusedEncoding({ get: (n) => (n === 'content-encoding' ? 'br' : '') }), /br/);
});

test('indirme: GitHub dışına yönlendirme, düz http, yönlendirme döngüsü ve özetsiz dosya reddediliyor', async () => {
  const fsx = memFs();
  await assert.rejects(I.download({ url: GH, size: 1, digest: SHA, dest: '/t/x', request: net({ [GH]: { redirect: 'https://evil.example/x' } }), fsx }), /refused host/);
  await assert.rejects(I.download({ url: 'http://github.com/x', size: 1, digest: SHA, dest: '/t/x', request: net({}), fsx }), /refused host/);
  const loop = net({ [GH]: { redirect: CDN }, [CDN]: { redirect: GH } });
  await assert.rejects(I.download({ url: GH, size: 1, digest: SHA, dest: '/t/x', request: loop, fsx }), /too many redirects/);
  assert.strictEqual(loop.seen.length, I.MAX_REDIRECTS + 1);
  await assert.rejects(I.download({ url: GH, size: 1, digest: '', dest: '/t/x', request: net({ [GH]: {} }), fsx }), /digest/);
  assert.deepStrictEqual(Object.keys(fsx.files), []);
});

test('kurulum: başlatılamayan kurucu hata döner, başlayan kurucu onaylanır', async () => {
  const { EventEmitter } = require('events');
  const failed = new EventEmitter();
  failed.unref = () => {};
  I.runInstaller('C:/t/x.exe', false, () => failed);
  const pending = I.whenInstallerStarted(failed, 1000);
  failed.emit('error', new Error('spawn EACCES'));
  const denied = await pending;
  assert.strictEqual(denied.ok, false);
  assert.match(denied.error, /EACCES/);
  const started = new EventEmitter();
  const ok = I.whenInstallerStarted(started, 1000);
  started.emit('spawn');
  assert.deepStrictEqual(await ok, { ok: true });
  const quiet = new EventEmitter();
  const timed = await I.whenInstallerStarted(quiet, 20);
  assert.strictEqual(timed.ok, false);
  const early = new EventEmitter();
  early.spawnError = new Error('spawn ENOENT');
  const already = await I.whenInstallerStarted(early, 1000);
  assert.match(already.error, /ENOENT/);
});

test('kurulum: NSIS bayrakları ve bağımsız süreç; AppImage aynı klasöre inip yerine taşınıyor', async () => {
  assert.deepStrictEqual(I.installerArgs(false), ['--updated']);
  assert.deepStrictEqual(I.installerArgs(true), ['/S', '--updated']);
  const calls = [];
  let unref = 0;
  I.runInstaller('C:/t/x.exe', true, (f, args, opts) => { calls.push([f, args, opts]); return { unref() { unref++; } }; });
  assert.deepStrictEqual(calls, [['C:/t/x.exe', ['/S', '--updated'], { detached: true, stdio: 'ignore' }]]);
  assert.strictEqual(unref, 1);
  const tmp = I.appImageTemp('/home/u/Apps/CAYADEV.AppImage', 'CAYADEV-Visualizer-9.9.9-linux-x86_64.AppImage');
  assert.strictEqual(tmp.replace(/\\/g, '/'), '/home/u/Apps/.CAYADEV-Visualizer-9.9.9-linux-x86_64.AppImage.new');
  const fsx = memFs();
  fsx.files[tmp] = DATA;
  await I.replaceAppImage(tmp, '/home/u/Apps/CAYADEV.AppImage', fsx);
  assert.strictEqual(fsx.files[tmp + ':mode'], 0o755);
  assert.ok(fsx.files['/home/u/Apps/CAYADEV.AppImage'].equals(DATA));
});

// ------------------------------------------------------------------ ana süreç ve panel

test('ana süreç: geliştirme kopyası indirmiyor; kurulum kullanıcı isteğiyle, sessiz kurulum yalnız otomatik kipte', () => {
  const fs = require('fs');
  const path = require('path');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  const dl = main.slice(main.indexOf('async function downloadUpdate()'), main.indexOf("ipcMain.handle('updates:download'"));
  assert.match(dl, /if \(!app\.isPackaged\) throw/);
  assert.match(dl, /s\.installable/);
  assert.match(dl, /fs\.constants\.W_OK/, 'AppImage klasörü yazılabilir mi');
  const pending = main.slice(main.indexOf('function silentInstallPending'), main.indexOf('function armSilentInstall'));
  assert.match(pending, /UPDATE_AUTO && updateMode\(\) === 'auto' && UPDATE_KIND === 'nsis'/);
  const arm = main.slice(main.indexOf('function armSilentInstall'), main.indexOf("ipcMain.handle('get-displays'"));
  assert.match(arm, /whenInstallerStarted\(child\)/);
  assert.match(arm, /if \(r && r\.ok\) updateReadyFile = null/);
  assert.match(arm, /showErrorBox/);
  assert.match(arm, /forceQuitApp = true;\s*app\.quit\(\)/);
  const bq = main.slice(main.indexOf("app.on('before-quit'"), main.indexOf("app.on('window-all-closed'"));
  assert.match(bq, /armSilentInstall\(e\)/);
  assert.match(bq, /shutdownCleanup\(\)/);
  const firstQuit = main.indexOf("app.on('will-quit'");
  const quitHandlers = main.slice(firstQuit, main.indexOf('const SETTINGS_PATH'));
  assert.doesNotMatch(quitHandlers, /runInstaller/, 'erken will-quit kurucu başlatmaz');
  assert.match(main, /app\.relaunch\(\{ execPath: process\.env\.APPIMAGE/, 'yeniden açılış yeni AppImage dosyasından');
  const inst = main.slice(main.indexOf('function installUpdateNow'), main.indexOf('function autoUpdateAfterCheck'));
  assert.match(inst, /whenInstallerStarted\(child\)[\s\S]{0,220}if \(!r \|\| !r\.ok\) return[\s\S]{0,280}app\.quit\(\)/);
  const req = main.slice(main.indexOf('function updateRequest'), main.indexOf('async function downloadUpdate'));
  assert.match(req, /net\.request\(/);
  assert.match(req, /redirect:\s*'manual'/);
  assert.match(req, /credentials:\s*'omit'/);
  assert.match(req, /setHeader\('Accept-Encoding', 'identity'\)/);
  assert.match(req, /on\('redirect'/);
  assert.doesNotMatch(req, /followRedirect\(/);
  assert.doesNotMatch(req, /https\.get\(/);
  assert.match(req, /proxy authentication required/);
  const fetchFn = main.slice(main.indexOf('async function fetchJsonHttps'), main.indexOf('async function runUpdateCheck'));
  assert.match(fetchFn, /updater\.rateLimitError\(res\.status, res\.headers, body\)/);
  const run = main.slice(main.indexOf('async function runUpdateCheck'), main.indexOf('function scheduleUpdateChecks'));
  assert.match(run, /const previous = updateState;/);
  assert.match(run, /updater\.applyCheckResult\(previous, res,/);
  assert.match(run, /if \(!\(updateState\.status === 'available' && updateState\.checkError\)\) autoUpdateAfterCheck\(updateState\);/);
});

function el(tag, props, kids) {
  const n = { tag, props: props || {}, kids: [], on: {}, parent: null, isConnected: true };
  n.className = (props && props.class) || '';
  n.text = (props && props.text) || '';
  n.appendChild = (c) => { if (c) { c.parent = n; n.kids.push(c); } return c; };
  n.addEventListener = (ev, f) => { (n.on[ev] = n.on[ev] || []).push(f); };
  n.replaceWith = () => { n.isConnected = false; };
  Object.defineProperty(n, 'textContent', { get: () => n.text, set: (v) => { n.text = v; } });
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}
const walk = (n, f) => { if (!n) return; f(n); (n.kids || []).forEach((k) => walk(k, f)); };

test('panel: kurulabilir türde "İndir ve Kur"; hazırken "Kur ve Yeniden Başlat"; indirme hatası görünür', () => {
  global.window = global.window || {};
  window.SVPanel = { el, row: (l, n) => el('div', { class: 'row' }, [el('label', { text: l }), n]), toast() {} };
  const calls = [];
  window.api = { updatesDownload: async () => { calls.push('dl'); return {}; }, updatesOpen: (w) => calls.push('open:' + w) };
  require('../src/admin/updates-panel.js');
  const UP = window.SVUpdatesPanel;
  const buttons = () => { const b = []; walk(UP.panel(), (n) => { if (n.tag === 'button') b.push(n.text); }); return b; };
  const asset = { name: 'x-windows-setup.exe', size: 5, url: 'https://github.com/x', digest: 'a'.repeat(64) };
  UP._onStatus({ status: 'available', latest: '9.9.9', current: '3.1.4', kind: 'nsis', installable: true, auto: true, asset, notes: '' });
  assert.ok(buttons().includes('İndir ve Kur'));
  UP._onStatus({ status: 'available', latest: '9.9.9', current: '3.1.4', kind: 'portable', installable: false, auto: true, asset, notes: '' });
  assert.ok(buttons().includes('İndir') && !buttons().includes('İndir ve Kur'), 'taşınabilir: tarayıcıda');
  UP._onStatus({ status: 'available', latest: '9.9.9', current: '3.1.4', kind: 'nsis', installable: true, auto: false, asset, notes: '' });
  assert.ok(!buttons().includes('İndir ve Kur'), 'geliştirme kopyası indirmiyor');
  UP._onStatus({ status: 'ready', latest: '9.9.9', current: '3.1.4', kind: 'nsis', installable: true, auto: true, asset });
  assert.ok(buttons().includes('Kur ve Yeniden Başlat'));
  UP._onStatus({ status: 'installed', latest: '9.9.9', current: '3.1.4', kind: 'appimage', installable: true, auto: true, asset });
  assert.ok(buttons().includes('Yeniden Başlat'));
  UP._onStatus({ status: 'available', latest: '9.9.9', current: '3.1.4', kind: 'nsis', installable: true, auto: true, asset, downloadError: 'sha256 mismatch' });
  let warn = null;
  walk(UP.panel(), (n) => { if (/İndirme başarısız: sha256 mismatch/.test(n.text)) warn = n; });
  assert.ok(warn, 'hata görünür');
});
