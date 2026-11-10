'use strict';
/* Uzaktan kumanda (#443): komut doğrulaması, canlı özet ve sayfanın sözleşmesi.
   Canlı davranış (gerçek sayfa, gerçek panel) elle doğrulandı; burada kurallar korunuyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

global.window = global.window || {};
const RC = require('../src/main/remote-commands.js');
const tree = require('../src/shared/osc-tree.js');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const cfg = () => ({
  layers: [{ id: 'a', opacity: 1, enabled: true }, { id: 'b', opacity: 0.5, enabled: true }],
  control: { osc: { enabled: false } },
});

test('sabit ağaç komutu: önek eklenir, yalnız ağacın tanıdığı adres geçer', () => {
  const ok = RC.oscMessage({ path: 'show/opacity', args: [0.4] }, cfg(), tree);
  assert.deepStrictEqual(ok, { address: '/cayadev/show/opacity', args: [0.4] });
  assert.ok(RC.oscMessage({ path: 'layer/2/enabled', args: [0] }, cfg(), tree));
  assert.ok(RC.oscMessage({ path: 'crossfade', args: [1] }, cfg(), tree));
  assert.ok(RC.oscMessage({ path: 'show/autovj', args: [1] }, cfg(), tree));
  // Olmayan katman, bilinmeyen adres, yanlış tür
  assert.strictEqual(RC.oscMessage({ path: 'layer/9/enabled', args: [0] }, cfg(), tree), null);
  assert.strictEqual(RC.oscMessage({ path: 'stream/token', args: ['x'] }, cfg(), tree), null);
  assert.strictEqual(RC.oscMessage({ path: 'show/opacity', args: ['yarım'] }, cfg(), tree), null);
  assert.strictEqual(RC.oscMessage({ path: 'show/opacity', args: [] }, cfg(), tree), null);
});

test('sabit ağaç komutu: bozuk yol ve bozuk değer atılır', () => {
  for (const p of ['', '/show/opacity', 'show//opacity', '../show/opacity', 'show/opacity/', 'a/b/c/d/e', 'show opacity', '__proto__/x', 'x'.repeat(80)]) {
    assert.strictEqual(RC.oscMessage({ path: p, args: [1] }, cfg(), tree), null, JSON.stringify(p));
  }
  assert.strictEqual(RC.oscMessage({ path: 'show/opacity', args: [NaN] }, cfg(), tree), null);
  assert.strictEqual(RC.oscMessage({ path: 'show/opacity', args: [Infinity] }, cfg(), tree), null);
  assert.strictEqual(RC.oscMessage({ path: 'show/opacity', args: [{ a: 1 }] }, cfg(), tree), null);
  assert.strictEqual(RC.oscMessage({ path: 'scene', args: ['x'.repeat(256)] }, cfg(), tree), null);
  assert.strictEqual(RC.oscMessage({ path: 'show/opacity', args: [1, 2, 3, 4, 5] }, cfg(), tree), null);
  assert.strictEqual(RC.oscMessage(null, cfg(), tree), null);
  assert.strictEqual(RC.oscMessage({ path: 5, args: [1] }, cfg(), tree), null);
  // Aralık dışı değer atılmaz: ağaç uygularken sıkıştırır (panel aynı planı koşar)
  const big = RC.oscMessage({ path: 'show/opacity', args: [7] }, cfg(), tree);
  assert.ok(big);
  assert.strictEqual(tree.plan([big], cfg()).steps[0].value, 1);
  // Kullanıcının kendi öneki
  const own = RC.oscMessage({ path: 'crossfade', args: [0.5] }, Object.assign(cfg(), { control: { osc: { prefix: '/sahne' } } }), tree);
  assert.strictEqual(own.address, '/sahne/crossfade');
});

test('adlı eylem: yalnız kısa listedekiler; yedeklilik ve deste yuvası yok', () => {
  for (const id of ['nextScene', 'tlPlay', 'tlPause', 'tlStop', 'mdNext', 'mdPrev', 'mdRandom', 'deckStopAll']) assert.ok(RC.actionAllowed(id), id);
  for (const id of ['redTakeover', 'redRelease', 'deckSlot:a:0:0', 'mdSprite:1', 'blackout', '', null, 7, 'constructor', '__proto__']) assert.ok(!RC.actionAllowed(id), String(id));
  assert.ok(Object.isFrozen(RC.ACTIONS));
  // Listedeki her eylem panelde gerçekten var (control.js runActionManual)
  const control = read('src/admin/control.js');
  const md = read('src/admin/milkdrop-panel.js');
  for (const id of RC.ACTIONS) {
    if (id.indexOf('md') === 0) assert.ok(md.includes("name === '" + id.slice(2) + "'"), id);
    else assert.ok(control.includes("'" + id + "'"), id);
  }
});

test('canlı özet: seviye sıkıştırılır, eski ölçüm sıfır sayılır', () => {
  const now = 100000;
  const s = RC.liveState({ bpm: 127.94, show: { timeline: true, blackout: false } }, { level: 0.5, bass: 1.7, mid: -1, treble: 0.333, at: now - 100 }, now);
  assert.deepStrictEqual(s, { level: 0.5, bass: 1, mid: 0, treble: 0.33, bpm: 127.9, timeline: true, blackout: false });
  const old = RC.liveState({ bpm: 0, show: {} }, { level: 0.9, bass: 0.9, mid: 0.9, treble: 0.9, at: now - 5000 }, now);
  assert.deepStrictEqual(old, { level: 0, bass: 0, mid: 0, treble: 0, bpm: 0, timeline: false, blackout: false });
  assert.deepStrictEqual(RC.liveState(null, null, now), { level: 0, bass: 0, mid: 0, treble: 0, bpm: 0, timeline: false, blackout: false });
});

test('ana süreç: komutlar doğrulayıcıdan geçer, panele OSC ağacı iletisi olarak gider', () => {
  const main = read('src/main/main.js');
  assert.match(main, /const m = remoteCommands\.oscMessage\(msg, currentConfig, oscTree\);\n    if \(m\) notifyAdmin\('osc-message', \{ messages: \[m\], source: 'remote' \}\);/);
  assert.match(main, /if \(remoteCommands\.actionAllowed\(msg\.id\)\) notifyAdmin\('remote-action', msg\.id\);/);
  // Yalnız kumanda istemcisi komut gönderir (yayın katmanı asla)
  assert.match(main, /if \(client && client\.kind !== 'remote'\) return;/);
  // Canlı özet yalnız kumanda bağlıyken ve değişince
  assert.match(main, /streamServer\.remoteCount\(\) < 1\) \{ remoteLiveSent = ''; return; \}/);
  assert.match(main, /if \(key === remoteLiveSent\) return;/);
  assert.match(main, /streamServer\.broadcast\(\{ type: 'live', state \}, 'remote'\);/);
  // Durum OSC çıkışı kapalıyken de not edilir (MQTT ve kumanda buradan okur); çıkış kapısı yerinde
  const clock = main.slice(main.indexOf("ipcMain.on('tempo:clock'"));
  assert.ok(clock.indexOf('noteOscLive(info);') < clock.indexOf('if (!redAuth.gates.oscOut) return;'));
  const av = read('src/admin/autovj.js');
  assert.match(av, /const liveWanted = oscOn \|\| !!\(cfg\.mqtt && cfg\.mqtt\.enabled\) \|\| !!\(cfg\.stream && cfg\.stream\.enabled && cfg\.stream\.remote !== false\);/);
});

test('panel: kumandanın iletisi OSC girişi kapalıyken de uygulanır, öğrenilmiş eşlemeleri sürmez', () => {
  const control = read('src/admin/control.js');
  assert.match(control, /const fromRemote = !!\(msg && msg\.source === 'remote'\);/);
  assert.match(control, /if \(consumed\.has\(i\) \|\| !messages\[i\] \|\| fromRemote\) continue;/);
  const admin = read('src/admin/admin.js');
  assert.match(admin, /if \(C\.runAction\(action, cfg\) !== true\) applyAll\(\);/);
});

test('yayın sunucusu: mod resmi tür adıyla istenir, yol istekte ve yanıtta yok', () => {
  const srv = read('src/main/stream-server.js');
  assert.match(srv, /if \(p === '\/mode-thumb'\) \{ serveModeThumb\(res, url\.searchParams\.get\('kind'\) \|\| '', url\.searchParams\.get\('type'\) \|\| ''\); return; \}/);
  // Jeton denetiminin ARKASINDA: yol, alt kaynak denetiminden sonra
  assert.ok(srv.indexOf("if (p === '/mode-thumb')") > srv.indexOf('if (!subresourceOk)'));
  assert.match(srv, /'\.webp': 'image\/webp',\n  '\.woff2': 'font\/woff2',/);
  const main = read('src/main/main.js');
  assert.match(main, /if \(modeThumbsLib\.KINDS\.indexOf\(kind\) < 0 \|\| typeof type !== 'string' \|\| !\/\^\[A-Za-z0-9_-\]\{1,48\}\$\/\.test\(type\)\) return null;/);
});

test('sayfa: panelin tema tablosu, tek komut yolu, dokunma hedefleri', () => {
  const html = read('src/web/remote.html');
  const js = read('src/web/remote.js');
  const css = read('src/web/remote.css');
  // Tema tablosu köprüden önce yüklenir; sayfa rengi panelin seçiminden
  assert.ok(html.indexOf('/app/shared/ui-themes.js') > 0 && html.indexOf('/app/shared/ui-themes.js') < html.indexOf('/app/web/remote.js'));
  assert.match(js, /T\.apply\(document, T\.normalizeId\(c && c\.ui && c\.ui\.theme\)/);
  assert.match(html, /<link rel="manifest" href="\/app\/web\/remote-manifest\.json" \/>/);
  JSON.parse(read('src/web/remote-manifest.json'));
  // Sayfa yapılandırmayı yazmaz; her şey send() üzerinden
  assert.doesNotMatch(js, /stream\.(token|remoteToken)/);
  assert.match(js, /send\('osc', \{ path, args: Array\.prototype\.slice\.call\(arguments, 1\) \}\);/);
  assert.match(js, /send\('run', \{ id \}\);/);
  // Kaydırıcı kare başına en çok bir ileti yollar ve parmak üstündeyken geri çekilmez
  assert.match(js, /frame = requestAnimationFrame\(\(\) => \{/);
  assert.match(js, /if \(v == null \|\| s\.el\.dataset\.hold\) continue;/);
  // Renk yalnız değişkenlerden: :root dışındaki satırlarda ham renk yok
  const body = css.slice(css.indexOf('@font-face'));
  const raw = body.split('\n').filter((l) => /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/.test(l));
  assert.deepStrictEqual(raw, []);
  // Dokunma hedefleri: düğme 46, simge düğmesi 46, gezinme 52, anahtar 32 px yüksek
  assert.match(css, /\.btn \{[^}]*min-height: 46px;/);
  assert.match(css, /\.ib \{[^}]*width: 46px; height: 46px;/);
  assert.match(css, /\.nav button \{[^}]*min-height: 52px;/);
  const i18n = read('src/shared/i18n.js');
  ["'Çalan parça yok': 'Nothing is playing'", "'A / B Geçişi': 'A / B Crossfade'", "'Sahne ara': 'Search scenes'", "'Katmanı göster': 'Show layer'"]
    .forEach((k) => assert.ok(i18n.includes(k), k));
});
