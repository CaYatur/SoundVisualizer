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
  fs.writeFileSync(path.join(dirB, 'settings.json'), JSON.stringify(Object.assign({}, base, {
    stream: { enabled: false, port: backupStream, lan: false },
    redundancy: { role: 'backup', host: '127.0.0.1', port: streamPort, secret, heartbeatMs: opts.beat, timeoutMs: opts.timeout, takeover },
  })));
  const A = launch(dirA, cdpA);
  const B = launch(dirB, cdpB);
  const res = { name, takeover, timeoutMs: opts.timeout, heartbeatMs: opts.beat };
  let pa = null;
  let pb = null;
  try {
    pa = await connect(await adminPage(cdpA, 30000));
    pb = await connect(await adminPage(cdpB, 30000));
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
    res.sceneKept = after.vis === want.vis && after.scene === want.scene && after.grad === want.grad;
    /* Süreç öldü: işletim sistemi bağlantıyı kapatır, yedek kısa payla
       (en az 300 ms, üç atış) karar verir. + son atıştan öldürmeye kadar
       en çok bir atış, bir denetim aralığı ve ölçüm payı (taskkill + CDP). */
    const limit = Math.min(opts.timeout, Math.max(300, opts.beat * 3)) + opts.beat + Math.max(25, opts.beat / 2) + 500;
    res.limitMs = limit;
    res.pass = res.followed && res.sceneReplicated && res.tookOver && res.sceneKept &&
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
    killTree(B);
    await wait(800);
    for (const d of [dirA, dirB]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* kilitli */ } }
  }
  return res;
}

(async () => {
  const runs = [
    // Varsayılan eşik (1,5 sn): birincil sahne değişiminde 0,2–0,7 sn duraklıyor
    await scenario('auto takeover', 'auto', { beat: 100, timeout: 1500 }),
    await scenario('manual takeover', 'manual', { beat: 100, timeout: 1500 }),
  ];
  for (const r of runs) {
    say((r.pass ? 'ok   ' : 'FAIL ') + r.name + ': ' + JSON.stringify(Object.assign({}, r, { logA: undefined, logB: undefined })));
    if (!r.pass && (r.logA || r.logB)) say('  primary log: ' + (r.logA || '').replace(/\s+/g, ' ').slice(-600) + '\n  backup log: ' + (r.logB || '').replace(/\s+/g, ' ').slice(-600));
  }
  process.exit(runs.every((r) => r.pass) ? 0 : 1);
})().catch((e) => { say('failover: ' + (e && e.stack || e)); process.exit(2); });
