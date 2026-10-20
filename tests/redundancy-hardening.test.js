'use strict';
/* YEDEKLİLİK SAĞLAMLAŞTIRMA (#815): vuruş/faz eşlemesi, yayın sayfasının
 * yedek adresi, durum bandı ve alarm, kopyalanmış videoları kaldırma ve
 * OSC'nin ölçer dışı yollarının da yetki kapısından geçmesi.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const { Tempo } = require('../src/shared/tempo');
const MAIN = read('src/main/main.js');

// Sessiz ses: akı vuruşu üretmez; ızgara vuruşları yalnız dış ızgaradan
const silent = { ready: true, getBars: (n) => new Float32Array(n) };

test('tempo: dış ızgarayı izlerken vuruşlar ızgaranın kenarında, ölçüdeki yer birincilinki', () => {
  const t = new Tempo();
  t.update(silent, 0, 1 / 60);
  t.follow({ bpm: 120, beatAt: 0.25, bar: 2, beatsPerBar: 4, confidence: 0.9 }, 0.3, 10);
  const fires = [];
  for (let i = 1; i <= 180; i++) { const now = 0.3 + i / 60; if (t.update(silent, now, 1 / 60)) fires.push([Math.round(now * 1000), t.barPosition]); }
  // 120 BPM: 0,5 sn; ızgara 0,25 + k·0,5 → ilk kenar 0,75
  assert.ok(fires.length >= 5);
  for (const [ms] of fires) assert.ok(((ms - 250) % 500 + 500) % 500 < 20, 'vuruş ızgarada: ' + ms);
  assert.strictEqual(fires[0][1], 3, 'bar 2 + 1 vuruş');
  assert.strictEqual(fires[1][1], 0, 'ölçü başı birincilinkiyle aynı');
  assert.strictEqual(t.bpm, 120);
  assert.ok(t.following(3.2));
  // Yenilenmezse kendi algısına döner
  t.update(silent, 30, 1 / 60);
  assert.strictEqual(t.following(30), false);
  assert.strictEqual(t.ext, null);
});

/* Faz aktarımı: birincilin ızgarası duvar saatiyle (beatAt) gider; yedek
   kendi saatine çevirir. Bir makinede saat farkı ~0, iletim gecikmesi
   0–15 ms rastgele: ızgara gecikmeden etkilenmez (zaman damgalı), hata
   yalnız çeviri ve kare kuantizasyonu. p95 20 ms altında olmalı. */
test('faz: duvar saatli ızgara iletim gecikmesinden bağımsız, p95 < 20 ms', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const bpm = 128;
  const period = 60 / bpm;
  const primaryBeat0 = 1000.123; // birincilin duvar saatiyle ilk vuruş (sn)
  const backup = new Tempo();
  const errs = [];
  let lastMsg = -1;
  for (let i = 0; i < 60 * 30; i++) {
    const wall = 1000 + i / 60; // iki makinenin duvar saati (aynı makine)
    // Birincil saniyede ~4 kez ızgarayı yollar; gecikme 0-15 ms
    if (wall - lastMsg > 0.25) {
      lastMsg = wall;
      const k = Math.floor((wall - primaryBeat0) / period);
      const beatAt = primaryBeat0 + k * period;
      const arrive = wall + rnd() * 0.015;
      // Yedek varışta çevirir: performance saatinin başlangıcı farklı (−900 sn)
      backup.follow({ bpm, beatAt: beatAt - 900, bar: k % 4, beatsPerBar: 4 }, arrive - 900, 1.5);
    }
    if (backup.update(silent, wall - 900, 1 / 60)) {
      const k = Math.round((wall - primaryBeat0) / period);
      errs.push(Math.abs(wall - (primaryBeat0 + k * period)) * 1000);
    }
  }
  errs.sort((a, b) => a - b);
  const p95 = errs[Math.floor(errs.length * 0.95)];
  assert.ok(errs.length > 50, 'vuruş sayısı ' + errs.length);
  assert.ok(p95 < 20, 'p95 ' + p95.toFixed(1) + ' ms');
});

test('ana süreç: ızgara atışta, yedekte birincilin saatinden çevrilip panele; OSC yolları kapıdan', () => {
  assert.match(MAIN, /if \(tl && \(red\.seq & 1\) === 0 && now - tl\.at < 1000\) beat\.tempo = tl;/);
  assert.match(MAIN, /bpm, beatAt: red\.follower\.toLocal\(t\.beatAt\),/);
  assert.match(MAIN, /if \(red\.follower\.follows\(\)\) notifyAdmin\('redundancy-tempo', redAuth\.tempoRemote\);/);
  for (const ch of ["ipcMain.on('tempo:beat'", "ipcMain.on('tempo:clock'", "ipcMain.on('osc-hit'"]) {
    const i = MAIN.indexOf(ch);
    assert.ok(MAIN.slice(i, i + 400).includes('if (!redAuth.gates.oscOut) return;'), ch);
  }
  // Bildirim: devralma, iki yönetici, birincil geri çekildi; sessiz (ses panelde, isteğe bağlı)
  assert.match(MAIN, /new Notification\(\{ title: 'CAYADEV Visualizer · ' \+ title, body, silent: true \}\)/);
  assert.match(MAIN, /if \(st\.state === 'active' && !red\.wasActive\) redNotify\('takeover'\);/);
  const av = read('src/admin/autovj.js');
  assert.match(av, /reportGrid\(tempo, now\);/);
  assert.match(av, /if \(lock\) tempo\.follow\(/);
});

test('yedek adres: ayrıştırma, sayfaya enjeksiyon, yapılandırmadan gizleme, MCP gizli', () => {
  const S = require('../src/main/stream-server.js');
  const list = S.parseFallbacks('http://192.168.1.21:8722/overlay?token=abc,\nftp://x https://b.local:9000/ a b c d e');
  assert.deepStrictEqual(list.map((x) => x.ws), ['ws://192.168.1.21:8722/ws', 'wss://b.local:9000/ws']);
  assert.strictEqual(list[0].token, 'abc');
  assert.strictEqual(S.publicConfig({ stream: { token: 't', fallbackUrls: 'http://x/?token=secret' } }).stream.fallbackUrls, '', 'öbür makinenin jetonu gitmez');
  assert.match(read('src/shared/mcp.js'), /\['stream', 'fallbackUrls'\]/);
  const shim = read('src/web/web-shim.js');
  assert.match(shim, /if \(endpoints\.length > 1 && \+\+failsHere >= 2\)/);
  assert.match(shim, /cur = \(cur \+ 1\) % endpoints\.length;/);
  assert.match(shim, /p\.onopen = \(\) => \{/);
});

function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

test('yayın sunucusu: yedek adresin kökeni kabul, bilinmeyen köken red; sayfa adresleri taşıyor', { skip: typeof WebSocket === 'undefined' }, async () => {
  const S = require('../src/main/stream-server.js');
  const port = await freePort();
  const cfg = { stream: { enabled: true, port, fallbackUrls: 'http://10.0.0.9:8722/overlay?token=zz' } };
  await S.start({ port, lan: false, enabled: true }, { getConfig: () => cfg, getLocale: () => 'en', getPresets: () => [] });
  try {
    const html = await (await fetch('http://127.0.0.1:' + port + '/overlay')).text();
    assert.match(html, /window\.__SV_FALLBACK=\[\{"ws":"ws:\/\/10\.0\.0\.9:8722\/ws","http":"http:\/\/10\.0\.0\.9:8722","token":"zz"\}\];/);
    assert.strictEqual(S.originAllowed('http://10.0.0.9:8722', '127.0.0.1:' + port), true, 'öbür makinenin sayfası');
    assert.strictEqual(S.originAllowed('http://evil.example:8722', '127.0.0.1:' + port), false);
  } finally {
    await S.stop();
  }
});

test('kopyalanmış videoları kaldır: manifest videosuz, dosyalar silinir, preset kalır', async () => {
  const Pkg = require('../src/main/show-package.js');
  const crypto = require('crypto');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-rmv-'));
  const vid = crypto.randomBytes(Pkg.CHUNK + 10);
  const pre = Buffer.from('{"id":"p"}');
  const E = [
    { kind: 'media', id: 'C:\\v.mp4', name: 'v.mp4', ext: '.mp4', size: vid.length, sha256: Pkg.sha256(vid), bytes: vid, ref: 'C:\\v.mp4' },
    { kind: 'presets', id: 'p', name: 'p', ext: '.json', size: pre.length, sha256: Pkg.sha256(pre), bytes: pre },
  ];
  const m = Pkg.buildManifest(E);
  const by = new Map(E.map((e) => [Pkg.entryName(e.kind, e.id, e.ext), e]));
  const rx = Pkg.createReceiver({ root, manifest: m });
  for (const r of rx.missing()) { const b = by.get(r.path).bytes.subarray(r.c * Pkg.CHUNK, (r.c + 1) * Pkg.CHUNK); rx.accept(r.path, r.c, b, Pkg.sha256(b)); }
  await rx.verify();
  await rx.commit();
  const vItem = Pkg.currentManifest(root).items.find((it) => it.kind === 'media');
  const vFile = Pkg.currentFile(root, vItem);
  assert.ok(fs.existsSync(vFile));
  const r = Pkg.removeMedia(root);
  assert.deepStrictEqual({ ok: r.ok, removed: r.removed, freed: r.freed, locked: r.locked }, { ok: true, removed: 1, freed: vid.length, locked: 0 });
  assert.ok(!fs.existsSync(vFile), 'video silindi');
  const man = Pkg.currentManifest(root);
  assert.ok(!man.items.some((it) => it.kind === 'media'));
  const p = man.items.find((it) => it.kind === 'presets');
  assert.strictEqual(fs.readFileSync(Pkg.currentFile(root, p), 'utf8'), '{"id":"p"}', 'preset kalır');
  assert.deepStrictEqual(Pkg.removeMedia(root), { ok: true, removed: 0, freed: 0, locked: 0 });
  // Videosuz yeniden çekme takılmaz: aynı paket videosuz yeniden kurulur
  const only = m.items.filter((it) => it.kind !== 'media').map((it) => it.path);
  const rx2 = Pkg.createReceiver({ root, manifest: m, only });
  rx2.prefill();
  assert.deepStrictEqual(rx2.missing(), []);
  assert.deepStrictEqual(await rx2.verify(), []);
  await rx2.commit();
  assert.ok(!Pkg.currentManifest(root).items.some((it) => it.kind === 'media'));
});

// Durum bandı: panel betiği sahte ortamda (redundancy-panel.test.js deseni)
function loadPanel(cfg) {
  const el = (tag, attrs, kids) => ({ tag, attrs: attrs || {}, children: (kids || []).filter(Boolean), classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild(c) { this.children.push(c); return c; } });
  const ctx = { console, JSON, Date, document: { querySelector: () => null }, window: { SVPanel: { el, cfg: () => cfg, row: (l, c) => el('div', {}, [c]), push() {}, rerender() {} }, api: {} } };
  vm.createContext(ctx);
  vm.runInContext(read('src/admin/redundancy-panel.js'), ctx);
  return ctx.window.SVRedundancyPanel;
}

test('durum bandı: renk durumdan; alarm devralmada, iki yöneticide, birincil geri çekilince', () => {
  const P = loadPanel({ redundancy: { role: 'backup' } });
  assert.strictEqual(P._bannerTone({ role: 'backup', state: 'following' }), 'ok');
  assert.strictEqual(P._bannerTone({ role: 'backup', state: 'following', autoHeld: true }), 'warn');
  assert.strictEqual(P._bannerTone({ role: 'backup', state: 'lost' }), 'warn');
  assert.strictEqual(P._bannerTone({ role: 'backup', state: 'active' }), 'err');
  assert.strictEqual(P._bannerTone({ role: 'primary', serverRunning: true, peers: 1, holder: 'self' }), 'ok');
  assert.strictEqual(P._bannerTone({ role: 'primary', serverRunning: true, peers: 1, holder: 'peer' }), 'warn');
  assert.strictEqual(P._bannerTone({ role: 'primary', serverRunning: true, peers: 1, split: 'term' }), 'err');
  assert.strictEqual(P._noteAlarm({ role: 'backup', state: 'active' }, { role: 'backup', state: 'following' }).kind, 'takeover');
  assert.strictEqual(P._noteAlarm({ role: 'backup', state: 'active', split: 'term' }, { role: 'backup', state: 'active' }).kind, 'split');
  assert.strictEqual(P._noteAlarm({ role: 'primary', holder: 'peer' }, { role: 'primary', holder: 'self' }).kind, 'stepped');
  assert.strictEqual(P._noteAlarm({ role: 'backup', state: 'following' }, { role: 'backup', state: 'following' }), null);
  // Ses varsayılan kapalı (canlı mekânda karışıma sızmasın)
  assert.strictEqual(require('../src/main/redundancy').normalize({}).alarmSound, false);
  assert.match(read('src/admin/index.html'), /<div id="redBanner" class="red-banner hidden" role="status" aria-live="polite"><\/div>/);
  assert.match(read('src/admin/admin.css'), /@media \(prefers-reduced-motion: reduce\) \{ \.red-banner\.alarm \{ animation: none; \} \}/);
});

/* Köprü sesi ortak saate kilitli (#815): aynı köprüyü dinleyen iki alıcı
   farklı ağ gecikmesiyle parça alsa da aynı parçayı aynı bağlam anında
   (kendi saatlerinde) çalar. */
test('köprü sesi: iki alıcı farklı gecikmeyle aynı parçayı aynı anda çalar', () => {
  const core = require('../src/bridge-audio/player-core.js');
  const a = core.createScheduler({ latency: 0.12 });
  const b = core.createScheduler({ latency: 0.12 });
  const dur = 0.02;
  let seed = 3;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const diffs = [];
  for (let i = 0; i < 200; i++) {
    const stamp = 10 + i * dur; // köprünün damgası, iki alıcının saatinde aynı (saatler eşli)
    const arriveA = stamp + 0.002 + rnd() * 0.03;
    const arriveB = stamp + 0.010 + rnd() * 0.05;
    const atA = a.placeAt(arriveA, dur, stamp + 0.12);
    const atB = b.placeAt(arriveB, dur, stamp + 0.12);
    if (atA != null && atB != null) diffs.push(Math.abs(atA - atB) * 1000);
  }
  diffs.sort((x, y) => x - y);
  assert.ok(diffs.length > 190, 'parçaların hepsi çalındı: ' + diffs.length);
  assert.ok(diffs[diffs.length - 1] < 5, 'en büyük fark ' + diffs[diffs.length - 1] + ' ms');
  // Geç gelen parça atılır, hiza bozulmaz
  const c = core.createScheduler({ latency: 0.05 });
  assert.strictEqual(c.placeAt(1.0, dur, 0.9), null);
  assert.ok(c.status().late >= 1);
  assert.match(read('src/bridge-audio/player.js'), /sched\.placeAt\(ctx\.currentTime, dur, ctxTimeFor\(m\.localT \+ latencyMs\)\)/);
});

// #815 incelemesi: bağlantıyı kurdurmayan ayarlar çalışırken de uygulanır; devralmada Otomatik VJ hemen geçmez
test('çalışırken: çıkış yetkisi ve tanık bağlantıyı kurmadan uygulanıyor; yetki dönünce Otomatik VJ sayaçtan başlıyor', () => {
  const R = require('../src/main/redundancy');
  assert.deepStrictEqual(R.SOFT_KEYS.slice().sort(), ['alarmSound', 'artnetOnLoss', 'artnetWitness', 'handbackAt', 'outputs', 'phaseLock', 'takeoverData']);
  for (const k of R.SOFT_KEYS) assert.strictEqual(R.linkSig({ role: 'backup', [k]: 'x' }), R.linkSig({ role: 'backup' }), k);
  const fn = MAIN.slice(MAIN.indexOf('function syncRedundancy() {'), MAIN.indexOf('const wasIsolated = red.isolated;', MAIN.indexOf('function syncRedundancy() {')));
  assert.match(fn, /for \(const k of redundancy\.SOFT_KEYS\) red\.cfg\[k\] = c\[k\];/);
  assert.match(fn, /\{ updateAuthority\(\); syncWitness\(\); notifyRedundancySoon\(\); \}/);
  assert.match(read('src/admin/autovj.js'), /if \(held\) \{ barsSince = 0; lastSwitch = now; return; \}/);
  // Durumdaki disk okumaları önbellekte
  assert.match(MAIN, /if \(key !== archivesCache\.key\) archivesCache = /);
  assert.match(MAIN, /if \(mt === pkgMediaCache\.mt\) return pkgMediaCache\.list;/);
});

/* OBS yedeği canlılığı (#815 incelemesi, ölçüldü). Kablo çekilince ya da
   birincil donunca soket kapanmaz; sayfa sonsuza dek bekliyordu. Sunucu
   yarım saniyede bir `tick` yollar, sayfa 1,5 sn sessizlikte ucu bırakır
   (kapanış el sıkışmasını beklemeden) ve sıradaki uca geçer. Ölçüm:
   askıdaki birincilde 2,2 sn, öldürülende 2,1 sn. */
test('yedek adres: sunucu canlılık iletisi, sessiz uç beklemeden bırakılıyor', () => {
  const S = read('src/main/stream-server.js');
  assert.match(S, /for \(const c of clients\) if \(c\.kind !== 'peer'\) sendJson\(c, \{ type: 'tick', serverNow: now \}\);\n  \}, 500\);/);
  assert.match(S, /startTick\(\);\n          resolve\(status\(\)\);/);
  assert.match(S, /function stop\(\) \{\n  stopTick\(\);/);
  const W = read('src/web/web-shim.js');
  assert.match(W, /sock\.onopen = null; sock\.onmessage = null; sock\.onerror = null; sock\.onclose = null;/);
  assert.match(W, /if \(ws && ws\.readyState === 1 && lastMsgAt && Date\.now\(\) - lastMsgAt > 1500\)/);
  assert.match(W, /connectTimer = setTimeout\(\(\) => \{ if \(me\.readyState === 0\) abandon\(me\); \}, 1500\);/);
  assert.match(W, /lastMsgAt = Date\.now\(\);\n      if \(typeof ev\.data !== 'string'\)/);
});
