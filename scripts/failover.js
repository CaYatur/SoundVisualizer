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

function launch(dir, cdpPort) {
  const electronPath = require('electron');
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronPath, ['.', '--user-data-dir=' + dir, '--remote-debugging-port=' + cdpPort], {
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
      const mediaDir = path.join(dirB, 'redundancy', 'package', 'current', 'media');
      /* Yalnız birincilde olan preset pencerelere görünüyor (yalıtılmış katman)
         ama yedeğin kütüphanesine yazılmadı; operatör tek tek alıyor. */
      const onlyFile = path.join(dirB, 'presets', 'usr_only_primary.json');
      const isolatedIds = (done.r.isolated || []).map((c) => c.id);
      res.pkgIsolated = has.only && !fs.existsSync(onlyFile) && isolatedIds.indexOf('usr_only_primary') >= 0;
      const imp = await pb.eval(`window.api.redundancyUsePrimaryAsset({ kind: 'preset', id: 'usr_only_primary' })`);
      res.pkgImported = !!(imp && imp.ok) && fs.existsSync(onlyFile);
      res.pkgOk = res.pkgMedia === 1 && has.only && has.conf === 'Backup Version' && res.pkgConflicts.indexOf('usr_conf') >= 0 &&
        res.pkgIsolated && res.pkgImported && fs.existsSync(mediaDir) && fs.readdirSync(mediaDir).length === 1;
      if (!res.pkgOk) throw new Error('package result: ' + JSON.stringify({ has, conflicts: res.pkgConflicts, isolated: isolatedIds, pkgIsolated: res.pkgIsolated, pkgImported: res.pkgImported, media: res.pkgMedia }));
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
      await pb.eval('(() => { SVPanel.cfg().redundancy.role = "off"; SVPanel.apply(); return true; })()');
      await wait(2600);
      const disk = JSON.parse(fs.readFileSync(path.join(dirB, 'settings.json'), 'utf8'));
      res.restoredOnOff = disk.redundancy.role === 'off' && (disk.scenes || []).some((x) => x.id === 'backup-own') && disk._activeSceneId !== 'failover-rig' &&
        fs.readdirSync(path.join(dirB, 'redundancy')).some((f) => /^local-show\.restored-\d+\.json$/.test(f));
    } else {
      res.sceneKept = after.vis === want.vis && after.scene === want.scene && after.grad === want.grad;
    }
    /* Süreç öldü: işletim sistemi bağlantıyı kapatır, yedek kısa payla
       (en az 300 ms, üç atış) karar verir. + son atıştan öldürmeye kadar
       en çok bir atış, bir denetim aralığı ve ölçüm payı (taskkill + CDP). */
    const limit = Math.min(opts.timeout, Math.max(300, opts.beat * 3)) + opts.beat + Math.max(25, opts.beat / 2) + 500;
    res.limitMs = limit;
    res.pass = res.followed && res.sceneReplicated && res.tookOver && res.sceneKept && res.localKept && res.primaryCopied &&
      (!opts.pkg || res.pkgOk) && (!opts.local || res.restoredOnOff) &&
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

(async () => {
  const runs = [
    // Varsayılan eşik (1,5 sn): birincil sahne değişiminde 0,2–0,7 sn duraklıyor
    await scenario('auto takeover + show sync', 'auto', { beat: 100, timeout: 1500, sync: true, clock: true, relaunch: true }),
    await scenario('manual takeover + show package', 'manual', { beat: 100, timeout: 1500, pkg: true }),
    await scenario('auto takeover with the local show, then role off', 'auto', { beat: 100, timeout: 1500, local: true }),
  ];
  for (const r of runs) {
    say((r.pass ? 'ok   ' : 'FAIL ') + r.name + ': ' + JSON.stringify(Object.assign({}, r, { logA: undefined, logB: undefined })));
    if (!r.pass && (r.logA || r.logB)) say('  primary log: ' + (r.logA || '').replace(/\s+/g, ' ').slice(-600) + '\n  backup log: ' + (r.logB || '').replace(/\s+/g, ' ').slice(-600));
  }
  process.exit(runs.every((r) => r.pass) ? 0 : 1);
})().catch((e) => { say('failover: ' + (e && e.stack || e)); process.exit(2); });
