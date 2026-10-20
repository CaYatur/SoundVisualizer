/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* YEDEĞE GEÇİŞ DENEMESİ (#547) — "denenmemiş yedek, yedek değildir".

   Gerçek uygulamanın iki kopyası, ayrı kullanıcı klasörleri ve ayrı
   portlarla açılır: biri birincil, biri yedek. Birincilde sahne
   değiştirilir, yedeğin aynı sahneye geldiği doğrulanır. Sonra birincil
   süreç (yalnız bu betiğin başlattığı süreç ağacı) öldürülür ve:
     - kendiliğinden kipte yedeğin eşik içinde yetkiyi aldığı,
     - doğru sahnede kaldığı,
     - elle kipte yetkiyi almadan "kayıp" dediği, elle alınca aldığı
   ölçülür. Kullanıcının ayarlarına dokunulmaz.

   Kullanım:  npm run failover   (çıkış kodu: geçmezse 1) */

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const Pkg = require('../src/main/show-package');

const ROOT = path.join(__dirname, '..');
const say = (s) => process.stdout.write(s + '\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

function launch(dir, cdpPort, extra) {
  const electronPath = require('electron');
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronPath, ['.', '--user-data-dir=' + dir, '--remote-debugging-port=' + cdpPort].concat(extra || []), {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    detached: process.platform !== 'win32', // POSIX: süreç grubu, ağaçla birlikte öldürülsün
  });
  child.log = '';
  const keep = (d) => { child.log = (child.log + d.toString()).slice(-20000); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  return child;
}

// Yalnız başlattığımız sürecin ağacı
function killTree(child) {
  if (!child || child.exitCode != null) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch { /* zaten kapandı */ }
}

/* CDP: yönetici sayfasında ifade değerlendirme */
async function adminPage(cdpPort, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json/list')).json();
      const page = list.find((p) => p.type === 'page' && /admin\/index\.html/.test(p.url));
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* henüz açılmadı */ }
    await wait(250);
  }
  throw new Error('admin page did not open on CDP ' + cdpPort);
}
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('cdp connect')); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  return {
    async eval(expr) {
      const i = ++id;
      const r = await new Promise((res) => { pending.set(i, res); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } })); });
      if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
      return r.result && r.result.result ? r.result.result.value : undefined;
    },
    close() { try { ws.close(); } catch { /* */ } },
  };
}
async function until(fn, timeoutMs, stepMs) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last && last.ok) return last; } catch (e) { last = { error: String(e.message || e) }; }
    await wait(stepMs || 100);
  }
  return Object.assign({ ok: false, timedOut: true }, last || {});
}

const STATUS = 'window.api.redundancyStatus()';
const SCENE = '(() => { const c = SVPanel.cfg(); return { vis: c.visualizer && c.visualizer.type, scene: c._activeSceneId || "", grad: (c.background && c.background.gradient && c.background.gradient.colors || []).join(",") }; })()';

async function scenario(name, takeover, opts) {
  const secret = require('crypto').randomBytes(18).toString('base64url');
  const streamPort = await freePort();
  const backupStream = await freePort();
  const cdpA = await freePort();
  const cdpB = await freePort();
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-failover-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-failover-b-'));
  const base = { autovj: { enabled: false }, lighting: { enabled: false }, updates: { auto: false } };
  fs.writeFileSync(path.join(dirA, 'settings.json'), JSON.stringify(Object.assign({}, base, {
    stream: { enabled: false, port: streamPort, lan: false },
    redundancy: { role: 'primary', secret, heartbeatMs: opts.beat },
  })));
  /* Yedeğin kendi gösterisi (#812): birincili izlemek onu ezmemeli;
     settings.json'da kalmalı, birincilinki yedeklilik klasörüne gitmeli. */
  fs.writeFileSync(path.join(dirB, 'settings.json'), JSON.stringify(Object.assign({}, base, {
    scenes: [{ id: 'backup-own', name: 'Backup Own', data: {} }],
    stream: { enabled: false, port: backupStream, lan: false },
    redundancy: { role: 'backup', host: '127.0.0.1', port: streamPort, secret, heartbeatMs: opts.beat, timeoutMs: opts.timeout, takeover, takeoverData: opts.local ? 'local' : 'primary' },
  })));
  if (opts.sync) {
    // Birincilde bir logo (yedekte yok): gösteri karşılaştırması bulmalı (#541)
    const lib = path.join(dirA, 'logo-library');
    fs.mkdirSync(lib, { recursive: true });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(path.join(lib, 'logo_rig.png'), png);
    /* Kitaplığın sınırına yakın bir GIF (24 MB sınır, 23 MB): tek bir
       ~31 MB'lık base64 çerçevesi. Yedeğin WebSocket'i kabul etmeli,
       gönderim sırasında kalp atışı eşiğin çok altında kalmalı. */
    const gif = Buffer.alloc(23 * 1024 * 1024, 7);
    gif.write('GIF89a', 0, 'latin1');
    fs.writeFileSync(path.join(lib, 'logo_big.gif'), gif);
    fs.writeFileSync(path.join(lib, 'manifest.json'), JSON.stringify({ items: [
      { id: 'logo_rig', name: 'Rig Logo', file: 'logo_rig.png', mime: 'image/png', kind: 'image', size: png.length, createdAt: 1 },
      { id: 'logo_big', name: 'Big GIF', file: 'logo_big.gif', mime: 'image/gif', kind: 'gif', size: gif.length, createdAt: 2 },
    ] }));
  }
  if (opts.pkg) {
    /* Gösteri paketi (#812): birincilde bir video dosyası (sahnede) ve bir
       preset; yedekte aynı kimlikli FARKLI bir preset — yerel olan kalmalı. */
    const media = path.join(dirA, 'rig-clip.mp4');
    fs.writeFileSync(media, require('crypto').randomBytes(700 * 1024));
    const cfgA = JSON.parse(fs.readFileSync(path.join(dirA, 'settings.json'), 'utf8'));
    cfgA.media = { enabled: true, source: 'file', file: media };
    fs.writeFileSync(path.join(dirA, 'settings.json'), JSON.stringify(cfgA));
    for (const [d, name] of [[dirA, 'Primary Version'], [dirB, 'Backup Version']]) {
      fs.mkdirSync(path.join(d, 'presets'), { recursive: true });
      fs.writeFileSync(path.join(d, 'presets', 'usr_conf.json'), JSON.stringify({ id: 'usr_conf', kind: 'visualizer', engine: 'shader', name, controls: [], shader: 'void mainImage(out vec4 o, in vec2 fc){ o = vec4(' + (d === dirA ? '1.0' : '0.5') + '); }' }));
    }
    fs.writeFileSync(path.join(dirA, 'presets', 'usr_only_primary.json'), JSON.stringify({ id: 'usr_only_primary', kind: 'visualizer', engine: 'shader', name: 'Only Primary', controls: [], shader: 'void mainImage(out vec4 o, in vec2 fc){ o = vec4(0.2); }' }));
  }
  const A = launch(dirA, cdpA);
  let A2 = null;
  const B = launch(dirB, cdpB);
  const res = { name, takeover, timeoutMs: opts.timeout, heartbeatMs: opts.beat };
  let pa = null;
  let pb = null;
  try {
    pa = await connect(await adminPage(cdpA, 30000));
    pb = await connect(await adminPage(cdpB, 30000));
    // Panel betikleri yüklenene kadar (CDP sayfası bundan önce görünebiliyor)
    for (const pg of [pa, pb]) await until(async () => ({ ok: await pg.eval('typeof window.SVPanel !== "undefined" && !!window.SVPanel.cfg') }), 20000, 100);
    const follow = await until(async () => { const s = await pb.eval(STATUS); return Object.assign({ ok: s && s.state === 'following' }, s); }, 20000);
    res.followed = !!follow.ok;
    if (!follow.ok) throw new Error('backup never followed: ' + JSON.stringify(follow));

    // Birincilde sahne değişir: görselleştirici türü, renkler, etkin sahne kimliği
    const want = await pa.eval(`(() => {
      const c = SVPanel.cfg();
      const ids = window.SVModeCatalog.ids('visualizer').filter((x) => x !== c.visualizer.type && x !== 'none' && x !== 'milkdrop');
      c.visualizer.type = ids[3] || ids[0];
      c.background.gradient.colors = ['#112233', '#445566', '#778899'];
      c._activeSceneId = 'failover-rig';
      SVPanel.apply();
      return { vis: c.visualizer.type, scene: c._activeSceneId, grad: c.background.gradient.colors.join(',') };
    })()`);
    const same = await until(async () => { const s = await pb.eval(SCENE); return Object.assign({ ok: s.vis === want.vis && s.scene === want.scene && s.grad === want.grad }, s); }, 5000);
    // Yalıtım (#812): kayıt birleştirmesi en geç 2 sn; sonra diskteki dosyalar
    await wait(2600);
    const diskB = JSON.parse(fs.readFileSync(path.join(dirB, 'settings.json'), 'utf8'));
    const primB = JSON.parse(fs.readFileSync(path.join(dirB, 'redundancy', 'primary-show.json'), 'utf8'));
    res.localKept = Array.isArray(diskB.scenes) && diskB.scenes.some((x) => x && x.id === 'backup-own') && diskB._activeSceneId !== 'failover-rig';
    res.primaryCopied = primB.show && primB.show._activeSceneId === 'failover-rig';
    if (!res.localKept || !res.primaryCopied) throw new Error('isolation: ' + JSON.stringify({ localKept: res.localKept, primaryCopied: res.primaryCopied }));
    if (opts.pkg) {
      await pb.eval('window.api.redundancyPkgRequest()');
      const offered = await until(async () => { const s = await pb.eval(STATUS); return { ok: s.pkg && s.pkg.state === 'offered', pkg: s.pkg }; }, 15000, 100);
      if (!offered.ok) throw new Error('package not offered: ' + JSON.stringify(offered.pkg));
      res.pkgMedia = offered.pkg.summary.media.n;
      const tp = Date.now();
      await pb.eval('window.api.redundancyPkgConfirm({ media: true })');
      const done = await until(async () => { const s = await pb.eval(STATUS); return { ok: s.pkg && s.pkg.state === 'done' && !!s.pkgResult, pkg: s.pkg, r: s.pkgResult }; }, 30000, 100);
      res.pkgMs = Date.now() - tp;
      if (!done.ok) throw new Error('package not done: ' + JSON.stringify(done));
      res.pkgConflicts = done.r.conflicts.map((c) => c.id);
      const has = await pb.eval(`(async () => { const l = await window.api.listPresets(); const c = l.find((x) => x.id === 'usr_conf'); return { only: !!l.find((x) => x.id === 'usr_only_primary'), conf: c && c.name }; })()`);
      // Kurulu videolar: manifestteki her video ve dosyası (içerik adresli depo)
      const pkgRootB = path.join(dirB, 'redundancy', 'package');
      const mediaFiles = () => { const man = Pkg.currentManifest(pkgRootB); return (man ? man.items : []).filter((it) => it.kind === 'media' && fs.existsSync(Pkg.currentFile(pkgRootB, it))).map((it) => it.name); };
      /* Yalnız birincilde olan preset pencerelere görünüyor (yalıtılmış katman)
         ama yedeğin kütüphanesine yazılmadı; operatör tek tek alıyor. */
      const onlyFile = path.join(dirB, 'presets', 'usr_only_primary.json');
      const isolatedIds = (done.r.isolated || []).map((c) => c.id);
      res.pkgIsolated = has.only && !fs.existsSync(onlyFile) && isolatedIds.indexOf('usr_only_primary') >= 0;
      const imp = await pb.eval(`window.api.redundancyUsePrimaryAsset({ kind: 'preset', id: 'usr_only_primary' })`);
      res.pkgImported = !!(imp && imp.ok) && fs.existsSync(onlyFile);
      res.pkgOk = res.pkgMedia === 1 && has.only && has.conf === 'Backup Version' && res.pkgConflicts.indexOf('usr_conf') >= 0 &&
        res.pkgIsolated && res.pkgImported && mediaFiles().length === 1;
      if (!res.pkgOk) throw new Error('package result: ' + JSON.stringify({ has, conflicts: res.pkgConflicts, isolated: isolatedIds, pkgIsolated: res.pkgIsolated, pkgImported: res.pkgImported, media: res.pkgMedia }));
      /* İkinci paket videosuz (#812, Windows'ta bulundu: önceki videolar
         silindi). Birincilde bir preset değişir; video kutusu işaretlenmeden
         kopyalanan paket önceki videoyu silmemeli. Videolar kutudan önce
         adı ve boyutuyla listelenmeli. */
      await pa.eval(`window.api.savePreset({ id: 'usr_only_primary', kind: 'visualizer', engine: 'shader', name: 'Only Primary 2', controls: [], shader: 'void mainImage(out vec4 o, in vec2 fc){ o = vec4(0.3); }' })`);
      await wait(300);
      await pb.eval('window.api.redundancyPkgRequest()');
      const off2 = await until(async () => { const s = await pb.eval(STATUS); return { ok: s.pkg && s.pkg.state === 'offered', pkg: s.pkg }; }, 15000, 100);
      if (!off2.ok) throw new Error('second package not offered: ' + JSON.stringify(off2.pkg));
      const mf = off2.pkg.mediaFiles || [];
      res.mediaListedBeforeTick = mf.length === 1 && mf[0].size === 700 * 1024 && mf[0].have === true && /rig-clip/.test(mf[0].name);
      /* Video OYNARKEN takas (#817 incelemesi): yedek kopyalanmış videoyu
         çiziyor gibi dosyayı açık tut. Windows'ta açık dosyanın klasörü
         taşınamıyor; eski takas burada "kopyalama durdu"da kalıyordu. */
      const manB = Pkg.currentManifest(pkgRootB);
      const vidItem = manB && manB.items.find((it) => it.kind === 'media');
      const vidPath = vidItem ? Pkg.currentFile(pkgRootB, vidItem) : '';
      const holder = vidPath ? fs.openSync(vidPath, 'r') : null;
      await pb.eval('window.api.redundancyPkgConfirm({ media: false })');
      const done2 = await until(async () => { const s = await pb.eval(STATUS); return { ok: s.pkg && (s.pkg.state === 'done' || s.pkg.state === 'error'), pkg: s.pkg, media: s.pkgMedia }; }, 30000, 100);
      if (holder != null) fs.closeSync(holder);
      const manB2 = Pkg.currentManifest(pkgRootB);
      const vidItem2 = manB2 && manB2.items.find((it) => it.kind === 'media');
      res.videoStayedPut = !!vidItem2 && Pkg.currentFile(pkgRootB, vidItem2) === vidPath;
      res.mediaKeptOnSecondPkg = !!done2.ok && done2.pkg.state === 'done' && res.videoStayedPut && mediaFiles().length === 1 &&
        Array.isArray(done2.media) && done2.media.length === 1 && done2.media[0].carried === true;
      if (!res.mediaListedBeforeTick || !res.mediaKeptOnSecondPkg) throw new Error('second package: ' + JSON.stringify({ mf, state: done2.pkg && done2.pkg.state, error: done2.pkg && done2.pkg.error, stayed: res.videoStayedPut, media: done2.media, files: mediaFiles() }));
      /* Aynı paket yeniden (#812, Linux'ta bulundu): her dosya öncekinden
         gelir, parça istenmez. Aktarım %100'de "transferring"de kalıyordu;
         doğrudan doğrulanıp bitmeli. */
      await pb.eval('window.api.redundancyPkgRequest()');
      const off3 = await until(async () => { const s = await pb.eval(STATUS); return { ok: s.pkg && s.pkg.state === 'offered', pkg: s.pkg }; }, 15000, 100);
      if (!off3.ok) throw new Error('third package not offered: ' + JSON.stringify(off3.pkg));
      await pb.eval('window.api.redundancyPkgConfirm({ media: true })');
      const done3 = await until(async () => { const s = await pb.eval(STATUS); return { ok: s.pkg && s.pkg.state === 'done', pkg: s.pkg }; }, 10000, 100);
      res.repullNothingMissing = !!done3.ok;
      if (!res.repullNothingMissing) throw new Error('re-pull with nothing missing did not finish: ' + JSON.stringify(done3.pkg && { state: done3.pkg.state, progress: done3.pkg.progress }));
    }
    if (opts.sync) {
      // Birincilde bir Studio preseti; karşılaştırma iki farkı bulmalı, ayar farkı olmamalı
      await pa.eval(`window.api.savePreset({ id: 'usr_rig_1', kind: 'visualizer', engine: 'shader', name: 'Rig Preset', controls: [], shader: 'void mainImage(out vec4 o, in vec2 fc){ o = vec4(1.0); }' })`);
      await pa.eval('window.api.redundancyCompare()');
      const diffd = await until(async () => {
        const s = await pa.eval(STATUS);
        const sh = s && s.show;
        const keys = sh ? sh.items.map((d) => d.key) : [];
        return Object.assign({ ok: !!sh && keys.indexOf('preset:usr_rig_1') >= 0 && keys.indexOf('logo:logo_rig') >= 0 && keys.indexOf('logo:logo_big') >= 0 }, { show: sh });
      }, 10000, 200);
      res.diffFound = !!diffd.ok;
      res.cfgDiffs = diffd.show ? diffd.show.items.filter((d) => d.kind === 'cfg').map((d) => d.id) : null;
      if (!diffd.ok) throw new Error('comparison did not report the preset and logo: ' + JSON.stringify(diffd.show));
      const gapBefore = (await pb.eval(STATUS)).maxGap;
      const tp = Date.now();
      const pushed = await pa.eval('window.api.redundancyPush()');
      res.pushed = pushed && pushed.sent;
      res.pushCallMs = Date.now() - tp;
      /* Yalıtılmış yedek (#812) gönderileni kütüphanesine yazmaz: videosuz
         paketi çeker, eksikler ayrı alanda kalır ve pencerelere görünür. */
      const WANT = ['usr_rig_1', 'logo_rig', 'logo_big'];
      const iso = await until(async () => {
        const s = await pb.eval(STATUS);
        const ids = s && s.pkgResult && s.pkgResult.isolated ? s.pkgResult.isolated.map((c) => c.id) : [];
        return { ok: s.pkg && s.pkg.state === 'done' && WANT.every((id) => ids.indexOf(id) >= 0), ids, pkg: s.pkg };
      }, 15000, 200);
      const libFile = path.join(dirB, 'presets', 'usr_rig_1.json');
      const seen = await pb.eval(`(async () => !!(await window.api.listPresets()).find((x) => x.id === 'usr_rig_1'))()`);
      res.pushIsolated = !!iso.ok && !fs.existsSync(libFile) && seen;
      if (!res.pushIsolated) throw new Error('push was not kept in the isolated area: ' + JSON.stringify({ iso, onDisk: fs.existsSync(libFile), seen }));
      // Operatör her öğeyi ayrı onaylar: üçü de kütüphaneye, sonra gösteriler aynı
      for (const id of WANT) {
        const kind = id.indexOf('logo_') === 0 ? 'logo' : 'preset';
        const r = await pb.eval(`window.api.redundancyUsePrimaryAsset(${JSON.stringify({ kind, id })})`);
        if (!r || !r.ok) throw new Error('import failed: ' + id);
      }
      await pa.eval('window.api.redundancyCompare()');
      const same = await until(async () => {
        const s = await pa.eval(STATUS);
        const sh = s && s.show;
        return { ok: !!sh && sh.differences === 0 && sh.hash === sh.peerHash, show: sh && { hash: sh.hash, peerHash: sh.peerHash, differences: sh.differences, items: sh.items } };
      }, 15000, 200);
      res.showMatches = !!same.ok;
      // Gönderim sırasındaki en uzun atış arası (öncekinden büyükse gönderimin payı)
      const gapAfter = (await pb.eval(STATUS)).maxGap;
      res.maxGapDuringPush = gapAfter > gapBefore ? gapAfter : null;
      res.syncMs = Date.now() - tp;
      if (!same.ok) throw new Error('show did not match after import: ' + JSON.stringify(same.show));
      const has = await pb.eval(`(async () => { const p = (await window.api.listPresets()).find((x) => x.id === 'usr_rig_1'); const ls = await window.api.logoLibList(); return { preset: !!p, logo: !!ls.find((x) => x.id === 'logo_rig') && !!ls.find((x) => x.id === 'logo_big') }; })()`);
      res.backupHasAssets = has.preset && has.logo && fs.existsSync(libFile);
    }
    if (opts.clock) {
      /* Gösteri saati (#544): birincilde zaman çizelgesi oynar; yedeğin
         paneli aynı zamanı göstermeli. Eşli örnek: her biri kendi okuma
         anını da verir, fark aynı ana çevrilir (aynı bilgisayar). */
      await pa.eval('window.SVTimelinePanel.seek(0); window.SVTimelinePanel.play(); true');
      await wait(800);
      const READ = '(() => ({ t: window.SVTimelinePanel.transport().time, playing: window.SVTimelinePanel.transport().playing, now: Date.now() }))()';
      const d = [];
      let playing = true;
      for (let i = 0; i < 40; i++) {
        const a = await pa.eval(READ);
        const b = await pb.eval(READ);
        playing = playing && a.playing && b.playing;
        d.push(Math.abs((b.t - (a.t + (b.now - a.now) / 1000)) * 1000));
        await wait(50);
      }
      d.sort((x, y) => x - y);
      res.clockPlaying = playing;
      res.clockMedianMs = Math.round(d[Math.floor(d.length / 2)] * 10) / 10;
      res.clockP95Ms = Math.round(d[Math.floor(d.length * 0.95)] * 10) / 10;
      res.offsetMs = (await pb.eval(STATUS)).offsetMs;
      await pa.eval('window.SVTimelinePanel.pause(); true');
    }
    const before = await pb.eval(STATUS);
    res.maxGapBeforeKill = before.maxGap;
    res.maxPrimaryGap = before.maxPrimaryGap;
    res.stateBeforeKill = before.state;
    res.sceneReplicated = !!same.ok;
    if (!same.ok) throw new Error('scene did not reach the backup: ' + JSON.stringify({ want, got: same }));

    // Birincili öldür
    const t0 = Date.now();
    killTree(A);
    if (takeover === 'auto') {
      const act = await until(async () => { const s = await pb.eval(STATUS); return Object.assign({ ok: s.state === 'active' }, s); }, opts.timeout * 4 + 3000, 25);
      res.takeoverMs = Date.now() - t0;
      res.takenBy = act.takenBy;
      res.tookOver = !!act.ok;
      if (opts.relaunch && act.ok) {
        /* Birincil aynı profille yeniden açılır (#543): yayındaki yedeğin
           ortak saati sıçramamalı, yetki de geri gitmemeli. */
        const epochBefore = act.sharedEpoch;
        A2 = launch(dirA, cdpA);
        const back = await until(async () => { const s = await pb.eval(STATUS); return Object.assign({ ok: !!s.connected && s.lastSeq >= 0 && Date.now() - t0 > 4000 }, s); }, 40000, 250);
        await wait(1500);
        const s2 = await pb.eval(STATUS);
        res.primaryBack = !!back.ok;
        res.epochKept = s2.sharedEpoch === epochBefore;
        res.stayedActive = s2.state === 'active';
      }
    } else {
      const lost = await until(async () => { const s = await pb.eval(STATUS); return Object.assign({ ok: s.state === 'lost' }, s); }, opts.timeout * 4 + 3000, 25);
      res.lostMs = Date.now() - t0;
      res.waitedForOperator = !!lost.ok;
      await wait(opts.timeout);
      res.stillWaiting = (await pb.eval(STATUS)).state === 'lost';
      const t1 = Date.now();
      const s = await pb.eval('window.api.redundancyTakeover()');
      res.manualMs = Date.now() - t1;
      res.tookOver = s.state === 'active' && s.takenBy === 'manual';
    }
    const after = await pb.eval(SCENE);
    if (opts.local) {
      /* Devralma yerel gösteriyle (#812): birincilin sahnesi değil, yedeğin
         kendi sahne listesi; rol kapatılınca da yerel gösteri yerinde. */
      const sc = await until(async () => ({ ok: await pb.eval('(() => { const c = SVPanel.cfg(); return c._activeSceneId !== "failover-rig" && (c.scenes || []).some((x) => x.id === "backup-own"); })()') }), 3000, 50);
      res.sceneKept = !!sc.ok;
      /* El ile bırakış, birincil hâlâ yok (#812, Windows'ta bulundu): yedek
         yetkiyi kendiliğinden geri almamalı (açılış payı 5 sn'yi aşan
         bekleme); operatör yeniden kurunca almalı. */
      const rel = await pb.eval('window.api.redundancyRelease()');
      await wait(Math.max(5000, opts.timeout * 2) + 2000);
      const held = await pb.eval(STATUS);
      res.releaseHeld = rel.state !== 'active' && held.state !== 'active' && held.autoHeld === true;
      const re = await pb.eval('window.api.redundancyRearm()');
      const back = await until(async () => { const s = await pb.eval(STATUS); return Object.assign({ ok: s.state === 'active' && s.takenBy === 'auto' }, s); }, 3000, 50);
      res.rearmTookOver = !!back.ok && re.autoHeld === false;
      await pb.eval('(() => { SVPanel.cfg().redundancy.role = "off"; SVPanel.apply(); return true; })()');
      await wait(2600);
      const disk = JSON.parse(fs.readFileSync(path.join(dirB, 'settings.json'), 'utf8'));
      res.restoredOnOff = disk.redundancy.role === 'off' && (disk.scenes || []).some((x) => x.id === 'backup-own') && disk._activeSceneId !== 'failover-rig' &&
        fs.readdirSync(path.join(dirB, 'redundancy')).some((f) => /^local-show\.restored-\d+\.json$/.test(f));
      // Arşivden geri yükleme (#812): şu anki gösteri önce arşivlenir, panel güncellenir
      const st0 = await pb.eval('window.api.redundancyStatus()');
      const arch = (st0.archives || [])[0];
      const rr = arch ? await pb.eval('window.api.redundancyRestoreArchive(' + JSON.stringify(arch.name) + ')') : null;
      await wait(2600);
      const disk2 = JSON.parse(fs.readFileSync(path.join(dirB, 'settings.json'), 'utf8'));
      const n2 = fs.readdirSync(path.join(dirB, 'redundancy')).filter((f) => /^local-show\.restored-\d+\.json$/.test(f)).length;
      res.archiveRestored = !!(rr && rr.ok && rr.backup) && n2 >= 2 && (disk2.scenes || []).some((x) => x.id === 'backup-own');
    } else {
      res.sceneKept = after.vis === want.vis && after.scene === want.scene && after.grad === want.grad;
    }
    if (opts.offSave) {
      /* Birincilin kopyası çizilirken rol kapatılır (#812, Linux'ta bulundu):
         yerel gösteri geri gelir; panelin kopyası da gelmeli. Sonra panelde
         bir düzenleme (tam yapılandırma gönderimi) settings.json'u
         birincilin sahneleriyle ezmemeli. */
      await pb.eval('(() => { SVPanel.cfg().redundancy.role = "off"; SVPanel.apply(); return true; })()');
      const PANEL_LOCAL = '(() => { const c = SVPanel.cfg(); return c._activeSceneId !== "failover-rig" && (c.scenes || []).some((x) => x.id === "backup-own"); })()';
      const pl = await until(async () => ({ ok: await pb.eval(PANEL_LOCAL) }), 4000, 50);
      res.panelLocalAfterOff = !!pl.ok;
      await pb.eval('(() => { const c = SVPanel.cfg(); c.master = Object.assign({}, c.master || {}, { brightness: 0.9 }); SVPanel.apply(); return true; })()');
      await wait(2600);
      const disk = JSON.parse(fs.readFileSync(path.join(dirB, 'settings.json'), 'utf8'));
      res.saveAfterOffKept = disk.redundancy.role === 'off' && (disk.scenes || []).some((x) => x.id === 'backup-own') && disk._activeSceneId !== 'failover-rig';
    }
    /* Süreç öldü: işletim sistemi bağlantıyı kapatır, yedek kısa payla
       (en az 300 ms, üç atış) karar verir. + son atıştan öldürmeye kadar
       en çok bir atış, bir denetim aralığı ve ölçüm payı (taskkill + CDP). */
    const limit = Math.min(opts.timeout, Math.max(300, opts.beat * 3)) + opts.beat + Math.max(25, opts.beat / 2) + 500;
    res.limitMs = limit;
    res.pass = res.followed && res.sceneReplicated && res.tookOver && res.sceneKept && res.localKept && res.primaryCopied &&
      (!opts.pkg || res.pkgOk) && (!opts.local || (res.restoredOnOff && res.releaseHeld && res.rearmTookOver && res.archiveRestored)) && (!opts.offSave || (res.panelLocalAfterOff && res.saveAfterOffKept)) &&
      (!opts.clock || (res.clockPlaying && res.clockP95Ms <= 20)) &&
      (!opts.relaunch || (res.primaryBack && res.epochKept && res.stayedActive)) &&
      (!opts.sync || (res.diffFound && res.pushIsolated && res.showMatches && res.backupHasAssets && res.cfgDiffs && res.cfgDiffs.length === 0
        && !(res.maxGapDuringPush > opts.timeout / 2))) &&
      (takeover === 'auto' ? res.takeoverMs <= limit : (res.waitedForOperator && res.stillWaiting && res.lostMs <= limit));
  } catch (e) {
    res.pass = false;
    res.error = String(e.message || e);
    res.logA = A.log.slice(-1500);
    res.logB = B.log.slice(-1500);
  } finally {
    if (pa) pa.close();
    if (pb) pb.close();
    killTree(A);
    killTree(A2);
    killTree(B);
    await wait(800);
    for (const d of [dirA, dirB]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* kilitli */ } }
  }
  return res;
}

/* Ana süreçte ifade (--inspect): yetki senaryosu ölçer karesini burada
   üretir. Çıkışları yalnız görselleştirici penceresinin karesi sürüyor;
   kullanıcının ekranında pencere açmak yerine aynı işleyiciye (audio-meter)
   sentetik kare verilir — kapı tam o işleyicide. */
async function mainEval(inspectPort, expr, timeoutMs) {
  const end = Date.now() + (timeoutMs || 20000);
  let url = '';
  while (!url && Date.now() < end) {
    try { const l = await (await fetch('http://127.0.0.1:' + inspectPort + '/json/list')).json(); url = l[0] && l[0].webSocketDebuggerUrl; } catch { /* henüz yok */ }
    if (!url) await wait(200);
  }
  if (!url) throw new Error('main inspector did not open on ' + inspectPort);
  const c = await connect(url);
  try { return await c.eval(expr); } finally { c.close(); }
}
const METER = "(() => { const { ipcMain } = process.mainModule.require('electron'); if (global.__rigMeter) clearInterval(global.__rigMeter); global.__rigMeter = setInterval(() => ipcMain.emit('audio-meter', { sender: { id: -7 } }, { level: 0.6, bass: 0.7, mid: 0.4, treble: 0.3, backgroundColors: ['#ff0000', '#00ff00'] }), 33); return true; })()";

/* YETKİ SENARYOSU (#814). İki kopya da Art-Net'i aynı yerel UDP portuna
   yollar; burada her kaynağın (kaynak bağlantı noktası: iki kopya aynı
   adresten gönderiyor) paketleri sayılır. Ölçülen:
     1. İzlerken yalnız birincil gönderiyor (tek gönderici).
     2. Elle devralma: gönderici yedeğe geçer; birincil geri çekilir.
     3. Yetkideyken birincilde değişiklik; bırakınca yedek 1 sn içinde aynı.
     4. Korumalı geri verme: koşullar, sonra gönderici birincile döner.
     5. İki yönlü komut: yetkisiz makineden gönderilen komut öbüründe uygulanır.
     6. Çitli açılış: yedek yetkideyken yeniden açılan birincil hiç göndermez. */
async function authorityScenario(name, opts) {
  const dgram = require('dgram');
  const secret = require('crypto').randomBytes(18).toString('base64url');
  const streamPort = await freePort();
  const backupStream = await freePort();
  const cdpA = await freePort();
  const cdpB = await freePort();
  /* UDP portu işletim sisteminden (bağlama 0): TCP'den alınan boş numara
     Windows'un ayırdığı aralığa düşüp EACCES verebiliyor. */
  const sock = require('dgram').createSocket('udp4');
  await new Promise((r) => sock.bind(0, '127.0.0.1', r));
  const udpPort = sock.address().port;
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-auth-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-auth-b-'));
  const art = { enabled: true, host: '127.0.0.1', port: udpPort, universe: 3, fps: 30, fixtures: 2 };
  const base = { autovj: { enabled: false }, lighting: { enabled: false }, updates: { auto: false }, artnet: art };
  const red = { secret, heartbeatMs: opts.beat, timeoutMs: opts.timeout, artnetWitness: false, handbackAt: 'now' };
  fs.writeFileSync(path.join(dirA, 'settings.json'), JSON.stringify(Object.assign({}, base, {
    stream: { enabled: false, port: streamPort, lan: false }, redundancy: Object.assign({ role: 'primary' }, red),
  })));
  fs.writeFileSync(path.join(dirB, 'settings.json'), JSON.stringify(Object.assign({}, base, {
    scenes: [{ id: 'backup-own', name: 'Backup Own', data: {} }],
    stream: { enabled: false, port: backupStream, lan: false },
    redundancy: Object.assign({ role: 'backup', host: '127.0.0.1', port: streamPort, takeover: 'manual' }, red),
  })));
  // Kaynak bağlantı noktasına göre ArtDmx sayacı
  const hits = [];
  sock.on('message', (buf, rinfo) => { if (buf.toString('ascii', 0, 8) === 'Art-Net\0') hits.push({ at: Date.now(), src: rinfo.port, zero: buf.subarray(18).every((x) => x === 0) }); });
  const sources = (from, to) => Array.from(new Set(hits.filter((h) => h.at >= from && h.at <= (to || Date.now())).map((h) => h.src)));
  const res = { name, heartbeatMs: opts.beat, timeoutMs: opts.timeout };
  const inA = await freePort();
  const inB = await freePort();
  let A = launch(dirA, cdpA, ['--inspect=' + inA]);
  const B = launch(dirB, cdpB, ['--inspect=' + inB]);
  let pa = null;
  let pb = null;
  try {
    pa = await connect(await adminPage(cdpA, 30000));
    pb = await connect(await adminPage(cdpB, 30000));
    for (const pg of [pa, pb]) await until(async () => ({ ok: await pg.eval('typeof window.SVPanel !== "undefined" && !!window.SVPanel.cfg') }), 20000, 100);
    const follow = await until(async () => { const s = await pb.eval(STATUS); return Object.assign({ ok: s && s.state === 'following' && s.linkMode === 'hmac' }, s); }, 20000);
    res.followed = !!follow.ok;
    res.linkMode = follow.linkMode;
    if (!follow.ok) throw new Error('backup never followed over HMAC: ' + JSON.stringify({ state: follow.state, linkMode: follow.linkMode }));
    // Birincilin çiti kalksın, ölçer kareleri aksın
    await until(async () => { const s = await pa.eval(STATUS); return { ok: s.holder === 'self' && !s.fenced }; }, 5000, 50);
    await mainEval(inA, METER);
    await mainEval(inB, METER);
    await wait(1500);
    // 1. Tek gönderici
    const t1 = Date.now();
    await wait(1200);
    const s1 = sources(t1);
    res.sendersFollowing = s1.length;
    res.packetsFollowing = hits.filter((h) => h.at >= t1).length;
    if (s1.length !== 1) throw new Error('expected one Art-Net sender while following, got ' + JSON.stringify(s1) + ' (packets ' + res.packetsFollowing + ')');
    const srcA = s1[0];
    /* 1b. Çalışırken çıkış ayarı (#815 incelemesi): yedekte Art-Net "Her
       zaman" → iki gönderici; geri "Yalnız yetkiyle" → yine tek. Ayar
       bağlantıyı yeniden kurmamalı, kapı hemen değişmeli. */
    await pb.eval('(() => { const c = SVPanel.cfg(); c.redundancy.outputs = Object.assign({}, c.redundancy.outputs, { artnet: "always" }); SVPanel.apply(); return true; })()');
    const always = await until(async () => { const r = sources(Date.now() - 300); return { ok: r.length === 2, r }; }, 3000, 25);
    await pb.eval('(() => { const c = SVPanel.cfg(); c.redundancy.outputs = Object.assign({}, c.redundancy.outputs, { artnet: "authority" }); SVPanel.apply(); return true; })()');
    const backOne = await until(async () => { const r = sources(Date.now() - 300); return { ok: r.length === 1 && r[0] === srcA, r }; }, 3000, 25);
    const stillFollowing = (await pb.eval(STATUS)).state === 'following';
    res.runtimeModeSwitch = !!always.ok && !!backOne.ok && stillFollowing;
    // 2. Elle devralma: gönderici yedeğe geçer
    const t2 = Date.now();
    await pb.eval('window.api.redundancyTakeover()');
    const moved = await until(async () => {
      const recent = sources(Date.now() - 300);
      return { ok: recent.length === 1 && recent[0] !== srcA, recent };
    }, opts.timeout + 2000, 20);
    res.authorityMoveMs = Date.now() - t2;
    const srcB = moved.recent && moved.recent[0];
    const sa = await pa.eval(STATUS);
    const sb = await pb.eval(STATUS);
    res.primaryStepsBack = sa.holder === 'peer' && sb.holder === 'self' && sb.term > 0 && sa.peerBeat && sa.peerBeat.term === sb.term;
    // Çakışma: iki kaynağın da gönderdiği süre (en çok bir atış + bir kare)
    const both = hits.filter((h) => h.at >= t2 && h.at <= t2 + res.authorityMoveMs + 200);
    const lastA = Math.max(0, ...both.filter((h) => h.src === srcA).map((h) => h.at));
    const firstB = Math.min(Infinity, ...both.filter((h) => h.src === srcB).map((h) => h.at));
    res.overlapMs = Number.isFinite(firstB) && lastA ? Math.max(0, lastA - firstB) : 0;
    if (!moved.ok || !res.primaryStepsBack) throw new Error('authority did not move: ' + JSON.stringify({ moved, a: { holder: sa.holder, peerBeat: sa.peerBeat }, b: { holder: sb.holder, term: sb.term } }));
    // 5. İki yönlü komut: birincilden (yetkisiz) gönderilen komut yedekte uygulanır
    const ctl = await pa.eval("window.api.redundancyCtl({ action: 'tlPause' })");
    res.ctlForwarded = !!(ctl && ctl.ok && ctl.remote && ctl.applied === 'backup');
    // 3. Yetkideyken birincilde değişiklik; bırakınca yedek aynı
    const want = await pa.eval(`(() => { const c = SVPanel.cfg(); const ids = window.SVModeCatalog.ids('visualizer').filter((x) => x !== c.visualizer.type && x !== 'none' && x !== 'milkdrop'); c.visualizer.type = ids[5] || ids[0]; c._activeSceneId = 'auth-rig'; SVPanel.apply(); return { vis: c.visualizer.type, scene: c._activeSceneId }; })()`);
    await wait(400);
    const stale = await pb.eval(SCENE);
    res.backupKeptOwnWhileActive = stale.scene !== 'auth-rig';
    const tr = Date.now();
    await pb.eval('window.api.redundancyRelease()');
    const resync = await until(async () => { const s = await pb.eval(SCENE); return Object.assign({ ok: s.vis === want.vis && s.scene === want.scene }, s); }, 3000, 25);
    res.resyncMs = Date.now() - tr;
    res.resynced = !!resync.ok && res.resyncMs <= 1000;
    const back = await until(async () => { const r = sources(Date.now() - 300); return { ok: r.length === 1 && r[0] === srcA, r }; }, 3000, 20);
    res.releaseReturnsOutputs = !!back.ok;
    // 4. Korumalı geri verme
    await pb.eval('window.api.redundancyTakeover()');
    await until(async () => { const r = sources(Date.now() - 300); return { ok: r.length === 1 && r[0] === srcB }; }, 3000, 20);
    /* Gösteriler farklıyken reddedilmeli: birincile yalnız orada olan bir
       preset; karşılaştırma farkı bulunca geri verme "gösteriler aynı"
       koşulunu adıyla söyler. Preset silinince koşul yeniden tutar. */
    await pa.eval(`window.api.savePreset({ id: 'usr_hb_only', kind: 'visualizer', engine: 'shader', name: 'HB Only', controls: [], shader: 'void mainImage(out vec4 o, in vec2 fc){ o = vec4(0.1); }' })`);
    await pa.eval('window.api.redundancyCompare()');
    await until(async () => { const s = await pb.eval(STATUS); return { ok: s.compare && s.compare.differences > 0 }; }, 10000, 100);
    const early = await pb.eval("window.api.redundancyHandback('now')");
    res.handbackRefusedEarly = !!(early && !early.ok && Array.isArray(early.failed) && early.failed.indexOf('show-differs') >= 0);
    await pa.eval("window.api.deletePreset('usr_hb_only')");
    await pa.eval('window.api.redundancyCompare()');
    const ready = await until(async () => { const s = await pb.eval(STATUS); return { ok: Array.isArray(s.handbackFailed) && s.handbackFailed.length === 0, failed: s.handbackFailed }; }, 15000, 200);
    if (!ready.ok) throw new Error('hand-back preconditions never met: ' + JSON.stringify(ready.failed));
    const th = Date.now();
    const hb = await pb.eval("window.api.redundancyHandback('now')");
    const handed = await until(async () => { const r = sources(Date.now() - 250); const s = await pb.eval(STATUS); return { ok: r.length === 1 && r[0] === srcA && s.state === 'following', r, state: s.state }; }, 3000, 20);
    res.handbackMs = Date.now() - th;
    res.handback = !!(hb && hb.ok) && !!handed.ok;
    const ta = await pa.eval(STATUS);
    const tb = await pb.eval(STATUS);
    res.handbackTerm = ta.term === tb.term && ta.holder === 'self';
    // 6. Çitli açılış: yedek yetkide, birincil çöküp yeniden açılıyor
    await pb.eval('window.api.redundancyTakeover()');
    await until(async () => { const r = sources(Date.now() - 300); return { ok: r.length === 1 && r[0] === srcB }; }, 3000, 20);
    pa.close(); pa = null;
    killTree(A);
    await wait(500);
    const tf = Date.now();
    A = launch(dirA, cdpA, ['--inspect=' + inA]);
    pa = await connect(await adminPage(cdpA, 30000));
    await mainEval(inA, METER);
    await until(async () => ({ ok: await pa.eval('typeof window.SVPanel !== "undefined" && !!window.SVPanel.cfg') }), 20000, 100);
    await until(async () => { const s = await pa.eval(STATUS); return { ok: s.peers > 0 && s.peerBeat && s.peerBeat.state === 'active' }; }, 15000, 50);
    await wait(2500);
    const fs2 = sources(tf);
    const sa2 = await pa.eval(STATUS);
    res.fencedRestartSilent = fs2.length === 1 && fs2[0] === srcB && sa2.holder === 'peer';
    res.restartSenders = fs2;
    const pass = res.followed && res.runtimeModeSwitch && res.primaryStepsBack && res.authorityMoveMs <= opts.timeout + opts.beat + 500 && res.overlapMs <= opts.beat + 100 &&
      res.ctlForwarded && res.backupKeptOwnWhileActive && res.resynced && res.releaseReturnsOutputs &&
      res.handbackRefusedEarly && res.handback && res.handbackTerm && res.fencedRestartSilent;
    res.pass = !!pass;
  } catch (e) {
    res.pass = false;
    res.error = String(e.message || e);
    res.logA = A.log.slice(-1500);
    res.logB = B.log.slice(-1500);
  } finally {
    if (pa) pa.close();
    if (pb) pb.close();
    killTree(A);
    killTree(B);
    try { sock.close(); } catch { /* */ }
    await wait(800);
    for (const d of [dirA, dirB]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* kilitli */ } }
  }
  return res;
}

/* Askıya alma: Windows'ta NtSuspendProcess (PowerShell), POSIX'te
   SIGSTOP/SIGCONT. Yalnız başlattığımız ana süreç: ana iş parçacığı durur,
   soket açık kalır (askıda kalan birincil). */
function suspend(child, on) {
  if (process.platform === 'win32') {
    const fn = on ? 'NtSuspendProcess' : 'NtResumeProcess';
    const ps = 'Add-Type -Name N -Namespace W -MemberDefinition \'[DllImport("ntdll.dll")] public static extern int ' + fn + '(IntPtr h);\'; ' +
      '$p = [System.Diagnostics.Process]::GetProcessById(' + child.pid + '); [W.N]::' + fn + '($p.Handle) | Out-Null';
    execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
  } else {
    process.kill(child.pid, on ? 'SIGSTOP' : 'SIGCONT');
  }
}

/* TCP aracısı: yedek birincile bunun üzerinden bağlanır. `cut(true)` iki
   yönde de okumayı durdurur — soket AÇIK kalır, atışlar gelmez (kablo
   kopması ya da yalnız aradaki bağlantının düşmesi gibi). `cut(false)`
   sürdürür; arada biriken veri TCP'de bekler ve sonra gelir. */
function tcpProxy(target) {
  const pairs = new Set();
  let cutOn = false;
  const server = net.createServer((a) => {
    const b = net.connect(target, '127.0.0.1');
    const pair = { a, b };
    pairs.add(pair);
    a.pipe(b); b.pipe(a);
    if (cutOn) { a.pause(); b.pause(); a.unpipe(b); b.unpipe(a); }
    const end = () => { pairs.delete(pair); a.destroy(); b.destroy(); };
    a.on('error', end); b.on('error', end); a.on('close', end); b.on('close', end);
  });
  return {
    listen: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port))),
    cut(on) {
      cutOn = on;
      for (const { a, b } of pairs) {
        if (on) { a.unpipe(b); b.unpipe(a); a.pause(); b.pause(); } else { a.pipe(b); b.pipe(a); a.resume(); b.resume(); }
      }
    },
    close() { for (const { a, b } of pairs) { a.destroy(); b.destroy(); } server.close(); },
  };
}

/* SAĞLAMLAŞTIRMA SENARYOLARI (#815). Yetki senaryosunun düzeni (Art-Net
   kaynak başına sayılır), yedek otomatik devralır, bağlantı bir aracıdan:
     a. ağ kesintisi (soket açık): yedek tam eşikte devralır; kesinti
        sürerken iki makine de gönderir (birbirini göremez — belgelendi);
        bağlantı gelince birincil yeni dönemi görüp geri çekilir, alarm yok.
     b. askıda birincil (süreç durdurulur): yedek eşikte devralır; birincil
        sürdürülünce geri çekilir.
     f. iki makine de yeniden açılır: dönem diskte kalır, küçülmez; yedek
        izler, birincil çitten çıkıp tek gönderici olur.
     p. öteki makinenin önizlemesi açıkken (yedekte gerçek bir pencere) en
        uzun atış aralığı eşiğin altında kalır. */
async function hardeningScenario(name, opts) {
  const dgram = require('dgram');
  const secret = require('crypto').randomBytes(18).toString('base64url');
  const streamPort = await freePort();
  const backupStream = await freePort();
  const cdpA = await freePort();
  const cdpB = await freePort();
  /* UDP portu işletim sisteminden (bağlama 0): TCP'den alınan boş numara
     Windows'un ayırdığı aralığa düşüp EACCES verebiliyor. */
  const sock = require('dgram').createSocket('udp4');
  await new Promise((r) => sock.bind(0, '127.0.0.1', r));
  const udpPort = sock.address().port;
  const inA = await freePort();
  const inB = await freePort();
  const proxy = tcpProxy(streamPort);
  const proxyPort = await proxy.listen();
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-hard-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-hard-b-'));
  const art = { enabled: true, host: '127.0.0.1', port: udpPort, universe: 3, fps: 30, fixtures: 2 };
  const base = { autovj: { enabled: false }, lighting: { enabled: false }, updates: { auto: false }, artnet: art };
  const red = { secret, heartbeatMs: opts.beat, timeoutMs: opts.timeout, artnetWitness: false };
  fs.writeFileSync(path.join(dirA, 'settings.json'), JSON.stringify(Object.assign({}, base, {
    stream: { enabled: false, port: streamPort, lan: false }, redundancy: Object.assign({ role: 'primary' }, red),
  })));
  fs.writeFileSync(path.join(dirB, 'settings.json'), JSON.stringify(Object.assign({}, base, {
    stream: { enabled: false, port: backupStream, lan: false },
    redundancy: Object.assign({ role: 'backup', host: '127.0.0.1', port: proxyPort, takeover: 'auto' }, red),
  })));
  const hits = [];
  sock.on('message', (buf, rinfo) => { if (buf.toString('ascii', 0, 8) === 'Art-Net\0') hits.push({ at: Date.now(), src: rinfo.port }); });
  const sources = (from, to) => Array.from(new Set(hits.filter((h) => h.at >= from && h.at <= (to || Date.now())).map((h) => h.src)));
  const res = { name, heartbeatMs: opts.beat, timeoutMs: opts.timeout };
  let A = null;
  let B = null;
  let pa = null;
  let pb = null;
  async function start(which) {
    if (which === 'A') {
      A = launch(dirA, cdpA, ['--inspect=' + inA]);
      pa = await connect(await adminPage(cdpA, 30000));
      await until(async () => ({ ok: await pa.eval('typeof window.SVPanel !== "undefined" && !!window.SVPanel.cfg') }), 20000, 100);
      await mainEval(inA, METER);
    } else {
      B = launch(dirB, cdpB, ['--inspect=' + inB]);
      pb = await connect(await adminPage(cdpB, 30000));
      await until(async () => ({ ok: await pb.eval('typeof window.SVPanel !== "undefined" && !!window.SVPanel.cfg') }), 20000, 100);
      await mainEval(inB, METER);
    }
  }
  const single = async (want, ms) => until(async () => { const r = sources(Date.now() - 300); return { ok: r.length === 1 && (!want || r[0] === want), r }; }, ms || 4000, 25);
  try {
    await start('A');
    await start('B');
    const follow = await until(async () => { const s = await pb.eval(STATUS); return { ok: s.state === 'following' && s.linkMode === 'hmac' }; }, 20000);
    if (!follow.ok) throw new Error('backup never followed');
    await wait(1500);
    const one = await single();
    if (!one.ok) throw new Error('expected one sender: ' + JSON.stringify(one.r));
    const srcA = one.r[0];

    // a. Ağ kesintisi, soket açık
    const ta = Date.now();
    proxy.cut(true);
    const act = await until(async () => { const s = await pb.eval(STATUS); return { ok: s.state === 'active', s }; }, opts.timeout * 3 + 3000, 25);
    res.cutTakeoverMs = Date.now() - ta;
    const both = await until(async () => { const r = sources(Date.now() - 400); return { ok: r.length === 2, r }; }, 4000, 50);
    res.cutBothSend = !!both.ok; // beklenen: birbirini göremiyorlar
    const srcB = (both.r || []).find((x) => x !== srcA);
    const tr = Date.now();
    proxy.cut(false);
    const back = await single(srcB, 5000);
    res.cutRecoverMs = Date.now() - tr;
    const sa = await pa.eval(STATUS);
    res.cutNoAlarm = !sa.split && sa.holder === 'peer';
    res.cutOk = !!act.ok && res.cutTakeoverMs <= opts.timeout + 1200 && !!back.ok && res.cutRecoverMs <= 3000 && res.cutNoAlarm;
    // Birincile geri: bırak, otomatik devralma birincil görülünce kurulur
    await pb.eval('window.api.redundancyRelease()');
    await single(srcA, 4000);

    // b. Askıda birincil
    await wait(800);
    const tb = Date.now();
    suspend(A, true);
    const actB = await until(async () => { const s = await pb.eval(STATUS); return { ok: s.state === 'active' }; }, opts.timeout * 3 + 3000, 25);
    res.hungTakeoverMs = Date.now() - tb;
    suspend(A, false);
    const back2 = await single(srcB, 6000);
    const sa2 = await pa.eval(STATUS);
    res.hungOk = !!actB.ok && res.hungTakeoverMs <= opts.timeout + 1200 && !!back2.ok && sa2.holder === 'peer' && !sa2.split;
    await pb.eval('window.api.redundancyRelease()');
    await single(srcA, 4000);

    // p. Önizleme açıkken atış aralığı (yedekte gerçek pencere: en küçük ekran)
    if (!opts.noWindow) {
      const disp = await pb.eval('(async () => { const d = await window.api.getDisplays(); const s = d.slice().sort((x, y) => (x.bounds.width * x.bounds.height) - (y.bounds.width * y.bounds.height)); return s[0] && s[0].id; })()');
      await pb.eval('window.api.openVisualizer(' + JSON.stringify(disp) + ')');
      await wait(2500);
      const gap0 = (await pb.eval(STATUS)).maxGap;
      await pa.eval('window.api.redundancyMonitor(true)');
      const frames = await until(async () => ({ ok: !!(await pa.eval('window.api.redundancyMonitor(true)')) }), 6000, 250);
      res.previewFrames = !!frames.ok;
      let maxPeerAge = 0;
      for (let i = 0; i < 20; i++) { const s = await pa.eval(STATUS); if (s.peerBeat) maxPeerAge = Math.max(maxPeerAge, s.peerBeat.ageMs); await wait(200); }
      const sb = await pb.eval(STATUS);
      res.previewMaxGap = sb.maxGap;
      res.previewGapBefore = gap0;
      res.previewMaxPeerBeatAge = maxPeerAge;
      await pa.eval('window.api.redundancyMonitor(false)');
      await pb.eval('window.api.closeVisualizer()');
      res.previewOk = res.previewFrames && sb.maxGap < opts.timeout && maxPeerAge < opts.timeout;
    } else {
      res.previewOk = true;
    }

    // f. İki makine de yeniden açılır: dönem diskte
    const termBefore = (await pb.eval(STATUS)).term;
    pa.close(); pb.close(); pa = null; pb = null;
    killTree(A); killTree(B);
    await wait(1200);
    const tf = Date.now();
    await start('A');
    await start('B');
    const f2 = await until(async () => { const s = await pb.eval(STATUS); return { ok: s.state === 'following', s }; }, 20000);
    const one2 = await single(null, 6000);
    const sA = await pa.eval(STATUS);
    const sB = await pb.eval(STATUS);
    const termFile = JSON.parse(fs.readFileSync(path.join(dirB, 'redundancy', 'term.json'), 'utf8'));
    res.restartTerm = { before: termBefore, a: sA.term, b: sB.term, file: termFile.term };
    res.restartOk = !!f2.ok && !!one2.ok && sB.term >= termBefore && termFile.term >= termBefore && sA.holder === 'self' && !sA.fenced && Date.now() - tf < 60000;
    res.pass = !!(res.cutOk && res.hungOk && res.previewOk && res.restartOk);
  } catch (e) {
    res.pass = false;
    res.error = String(e.message || e);
    res.logA = A ? A.log.slice(-1500) : '';
    res.logB = B ? B.log.slice(-1500) : '';
  } finally {
    if (pa) pa.close();
    if (pb) pb.close();
    try { if (A) suspend(A, false); } catch { /* */ }
    killTree(A);
    killTree(B);
    proxy.close();
    try { sock.close(); } catch { /* */ }
    await wait(800);
    for (const d of [dirA, dirB]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* kilitli */ } }
  }
  return res;
}

// `--report=<dosya>`: sonuçlar JSON olarak (iki bilgisayarlı koşu belgeye yapıştırılsın)
function writeReport(runs) {
  const arg = process.argv.find((a) => a.startsWith('--report'));
  if (!arg) return;
  const file = arg.indexOf('=') > 0 ? arg.slice(arg.indexOf('=') + 1) : path.join(process.cwd(), 'failover-report.json');
  const out = { at: new Date().toISOString(), platform: process.platform, arch: process.arch, node: process.version, version: require(path.join(ROOT, 'package.json')).version,
    runs: runs.map((r) => Object.assign({}, r, { logA: undefined, logB: undefined })) };
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  say('report: ' + file);
}

(async () => {
  const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
  if (only === 'hardening') {
    const r = await hardeningScenario('network cut, hung primary, preview, double restart', { beat: 100, timeout: 1500, noWindow: process.argv.includes('--no-window') });
    say((r.pass ? 'ok   ' : 'FAIL ') + r.name + ': ' + JSON.stringify(Object.assign({}, r, { logA: undefined, logB: undefined })));
    if (!r.pass) say('  primary log: ' + (r.logA || '').replace(/\s+/g, ' ').slice(-800) + '\n  backup log: ' + (r.logB || '').replace(/\s+/g, ' ').slice(-800));
    writeReport([r]);
    process.exit(r.pass ? 0 : 1);
  }
  if (only === 'authority') {
    const r = await authorityScenario('output authority, hand-back, fenced restart', { beat: 100, timeout: 1500 });
    say((r.pass ? 'ok   ' : 'FAIL ') + r.name + ': ' + JSON.stringify(Object.assign({}, r, { logA: undefined, logB: undefined })));
    if (!r.pass) say('  primary log: ' + (r.logA || '').replace(/\s+/g, ' ').slice(-800) + '\n  backup log: ' + (r.logB || '').replace(/\s+/g, ' ').slice(-800));
    process.exit(r.pass ? 0 : 1);
  }
  const runs = [
    // Varsayılan eşik (1,5 sn): birincil sahne değişiminde 0,2–0,7 sn duraklıyor
    await scenario('auto takeover + show sync', 'auto', { beat: 100, timeout: 1500, sync: true, clock: true, relaunch: true }),
    await scenario('manual takeover + show package', 'manual', { beat: 100, timeout: 1500, pkg: true, offSave: true }),
    await scenario('auto takeover with the local show, then role off', 'auto', { beat: 100, timeout: 1500, local: true }),
    // Çıkış yetkisi, geri verme, çitli açılış (#814)
    await authorityScenario('output authority, hand-back, fenced restart', { beat: 100, timeout: 1500 }),
    // Ağ kesintisi, askıda birincil, önizleme, iki makine yeniden açılış (#815)
    await hardeningScenario('network cut, hung primary, preview, double restart', { beat: 100, timeout: 1500, noWindow: process.argv.includes('--no-window') }),
  ];
  for (const r of runs) {
    say((r.pass ? 'ok   ' : 'FAIL ') + r.name + ': ' + JSON.stringify(Object.assign({}, r, { logA: undefined, logB: undefined })));
    if (!r.pass && (r.logA || r.logB)) say('  primary log: ' + (r.logA || '').replace(/\s+/g, ' ').slice(-600) + '\n  backup log: ' + (r.logB || '').replace(/\s+/g, ' ').slice(-600));
  }
  writeReport(runs);
  process.exit(runs.every((r) => r.pass) ? 0 : 1);
})().catch((e) => { say('failover: ' + (e && e.stack || e)); process.exit(2); });
