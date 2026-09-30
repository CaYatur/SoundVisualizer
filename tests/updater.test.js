'use strict';
/* Güncelleme denetimi (#640): sürüm karşılaştırma, kurulum türü, dağıtım
 * dosyası seçimi ve denetim kararı. Ağ yok: GitHub yanıtı gerçek v3.1.4
 * sürümünden alınmış bir örnek (tests/fixtures/release-latest.json).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const U = require('../src/main/updater.js');

const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'release-latest.json'), 'utf8'));

test('sürüm karşılaştırma: v öneki, sayısal parçalar, ön sürüm kararlıdan küçük', () => {
  assert.strictEqual(U.compareVersions('v3.1.10', '3.1.9'), 1);
  assert.strictEqual(U.compareVersions('3.1.4', 'v3.1.4'), 0);
  assert.strictEqual(U.compareVersions('3.2.0-beta.1', '3.2.0'), -1);
  assert.strictEqual(U.compareVersions('3.2.0-beta.2', '3.2.0-beta.10'), -1);
  assert.strictEqual(U.compareVersions('4.0.0', '3.99.99'), 1);
  assert.strictEqual(U.compareVersions('çöp', '0.0.1'), -1, 'anlaşılmayan sürüm en küçük');
});

test('kurulum türü: paketlenmemiş geliştirme; Windows kurulum/taşınabilir; Linux AppImage/deb; macOS', () => {
  assert.strictEqual(U.installKind('win32', {}, false), 'dev');
  assert.strictEqual(U.installKind('win32', {}, true), 'nsis');
  assert.strictEqual(U.installKind('win32', { PORTABLE_EXECUTABLE_FILE: 'C:/x.exe' }, true), 'portable');
  assert.strictEqual(U.installKind('linux', { APPIMAGE: '/home/u/a.AppImage' }, true), 'appimage');
  assert.strictEqual(U.installKind('linux', {}, true), 'deb');
  assert.strictEqual(U.installKind('darwin', {}, true), 'mac');
});

test('gerçek sürümün dosyaları her tür için doğru seçiliyor; Intel Mac için dosya yok', () => {
  const rel = U.parseRelease(FIXTURE);
  const name = (k, arch) => (U.pickAsset(k, rel.assets, arch) || {}).name || null;
  assert.match(name('nsis'), /-windows-setup\.exe$/);
  assert.match(name('portable'), /-windows-portable\.exe$/);
  assert.match(name('appimage'), /-linux-x86_64\.AppImage$/);
  assert.match(name('deb'), /-linux-amd64\.deb$/);
  assert.match(name('mac', 'arm64'), /-macos-arm64\.dmg$/);
  assert.strictEqual(name('mac', 'x64'), null);
  assert.strictEqual(name('dev'), null);
  // Her dosyanın SHA-256 özeti var ve adresi github.com
  for (const a of rel.assets) {
    assert.match(a.digest, /^[0-9a-f]{64}$/, a.name);
    assert.match(a.url, /^https:\/\/github\.com\//, a.name);
  }
});

test('ayrıştırma: github.com dışı adres ve bozuk özet kabul edilmiyor', () => {
  const rel = U.parseRelease({
    tag_name: 'v9.0.0', html_url: 'http://evil.example/x',
    assets: [{ name: 'a-windows-setup.exe', browser_download_url: 'https://evil.example/a.exe', digest: 'sha256:xyz', size: 5 }],
  });
  assert.strictEqual(rel.url, U.RELEASES_PAGE);
  assert.strictEqual(rel.assets[0].url, '');
  assert.strictEqual(rel.assets[0].digest, '');
  assert.strictEqual(rel.version, '9.0.0');
});

function fetchOf(json) {
  const calls = [];
  const f = async (url, headers) => {
    calls.push({ url, headers });
    if (json instanceof Error) throw json;
    return json;
  };
  f.calls = calls;
  return f;
}

test('denetim: yeni sürüm var — dosya, notlar, kurulabilirlik; tek istek, kimliksiz', async () => {
  const fetchJson = fetchOf(FIXTURE);
  const s = await U.check({ current: '3.1.3', kind: 'nsis', arch: 'x64', fetchJson });
  assert.strictEqual(s.status, 'available');
  assert.strictEqual(s.latest, '3.1.4');
  assert.match(s.asset.name, /windows-setup/);
  assert.ok(s.notes.length > 0);
  assert.strictEqual(s.installable, true);
  assert.strictEqual(fetchJson.calls.length, 1);
  assert.strictEqual(fetchJson.calls[0].url, U.API_LATEST);
  assert.deepStrictEqual(Object.keys(fetchJson.calls[0].headers).sort(), ['Accept', 'User-Agent']);
  assert.strictEqual(fetchJson.calls[0].headers['User-Agent'], 'CAYADEV-Visualizer/3.1.3');
});

test('denetim: güncel, atlanan sürüm, yalnız haber verilen türler, ağ hatası', async () => {
  assert.strictEqual((await U.check({ current: '3.1.4', kind: 'nsis', fetchJson: fetchOf(FIXTURE) })).status, 'latest');
  assert.strictEqual((await U.check({ current: '3.2.0', kind: 'nsis', fetchJson: fetchOf(FIXTURE) })).status, 'latest', 'daha yeni yerel sürüm');
  const skipped = await U.check({ current: '3.1.0', kind: 'nsis', skipVersion: '3.1.4', fetchJson: fetchOf(FIXTURE) });
  assert.deepStrictEqual([skipped.status, skipped.skipped], ['available', true]);
  for (const kind of ['portable', 'deb', 'mac', 'dev']) {
    const s = await U.check({ current: '3.1.0', kind, arch: 'arm64', fetchJson: fetchOf(FIXTURE) });
    assert.strictEqual(s.installable, false, kind + ' yalnız haber verir');
  }
  const err = await U.check({ current: '3.1.0', kind: 'nsis', fetchJson: fetchOf(new Error('offline')) });
  assert.deepStrictEqual([err.status, err.error], ['error', 'offline']);
  const pre = await U.check({ current: '3.1.0', kind: 'nsis', fetchJson: fetchOf(Object.assign({}, FIXTURE, { prerelease: true })) });
  assert.strictEqual(pre.status, 'error', 'ön sürüm önerilmiyor');
});

// ------------------------------------------------------------------ ana süreç bağlantısı

test('ana süreç: otomatik denetim yalnız paketlenmiş gerçek kullanımda; adres arayüzden alınmıyor', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /const UPDATE_AUTO = app\.isPackaged && !SMOKE && !SHOTS;/);
  assert.match(main, /function scheduleUpdateChecks\(\) \{\s*if \(!UPDATE_AUTO\) return;/);
  assert.match(main, /function writeUpdateStore\(patch\) \{\s*if \(!UPDATE_AUTO\) return;/);
  // Açılan adres yalnız son denetimin GitHub adresi
  const open = main.slice(main.indexOf("ipcMain.handle('updates:open'"), main.indexOf("ipcMain.handle('updates:open'") + 600);
  assert.match(open, /\^https:\\\/\\\/github\\\.com\\\//);
  assert.doesNotMatch(open, /shell\.openExternal\(which\)/);
});

// ------------------------------------------------------------------ panel

function el(tag, props, kids) {
  const n = { tag, props: props || {}, kids: [], on: {}, attrs: {}, parent: null, isConnected: true };
  n.className = (props && props.class) || '';
  n.text = (props && props.text) || '';
  n.appendChild = (c) => { if (c) { c.parent = n; n.kids.push(c); } return c; };
  n.addEventListener = (ev, f) => { (n.on[ev] = n.on[ev] || []).push(f); };
  n.replaceWith = (m) => { n.isConnected = false; void m; };
  Object.defineProperty(n, 'textContent', { get: () => n.text, set: (v) => { n.text = v; } });
  Object.defineProperty(n, 'innerHTML', { get: () => '', set: () => { throw new Error('innerHTML kullanılmamalı'); } });
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}
const walk = (n, f) => { if (!n) return; f(n); (n.kids || []).forEach((k) => walk(k, f)); };

test('panel: sürüm notları yalnız metin; yeni sürüm bildirimi sürüm başına bir kez', async () => {
  global.window = global.window || {};
  const toasts = [];
  window.SVPanel = { el, row: (l, n) => el('div', { class: 'row' }, [el('label', { text: l }), n]), toast: (m) => toasts.push(m) };
  window.api = null;
  require('../src/admin/updates-panel.js');
  const UP = window.SVUpdatesPanel;
  const s = await U.check({ current: '3.1.0', kind: 'nsis', fetchJson: fetchOf(Object.assign({}, FIXTURE, { body: '<img src=x onerror=alert(1)> notlar' })) });
  UP._onStatus(s);
  UP._onStatus(s);
  assert.strictEqual(toasts.length, 1, 'aynı sürüm için tek bildirim');
  const root = UP.panel();
  let pre = null;
  walk(root, (n) => { if (n.tag === 'pre') pre = n; });
  assert.ok(pre, 'notlar gösteriliyor');
  assert.strictEqual(pre.text, '<img src=x onerror=alert(1)> notlar', 'HTML değil metin');
  const texts = [];
  walk(root, (n) => { if (n.tag === 'button') texts.push(n.text); });
  assert.deepStrictEqual(texts, ['↻ Şimdi Denetle', '⬇ İndir', 'Sürüm Sayfası', 'Bu Sürümü Atla']);
  // Yeni durum gelince açık kart YERİNDE yenileniyor (önce yeni kart kendi
  // yerine yazılıyordu ve ekrandaki kart eski durumda kalıyordu)
  UP._onStatus(Object.assign({}, s, { status: 'latest' }));
  assert.strictEqual(root.isConnected, false, 'eski kart değiştirildi');
});
