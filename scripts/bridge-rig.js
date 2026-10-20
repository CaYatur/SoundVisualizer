/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* SES KÖPRÜSÜ DENEMESİ (#813). Gerçek uygulamanın iki kopyası:
     köprü   `--bridge` (yalnız köprü kipi, ayrı ayar klasörü, görüntü yok)
     alıcı   olağan kip, "Ses girişi: Ağ köprüsü", adres BOŞ (keşifle bulur)
   Ölçülen: alıcının köprüyü bulup bağlanması, karelerin gelmesi, gidiş-dönüş,
   saat farkı, karenin yaşı; köprü öldürülünce yerel girişe dönüş, yeniden
   açılınca köprüye dönüş; köprü sürecinin bellek ve işlemci kullanımı.

   Sistem sesini yakalayabilmek için çalan bir çıkış aygıtı gerekir (Linux
   CI'da: pulseaudio null-sink + module-sine). Ses yoksa kare de gelmez ve
   deneme bunu açıkça söyler. Kullanıcının ayarlarına dokunulmaz.

   Kullanım:  npm run bridge-rig   (çıkış kodu: geçmezse 1) */

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


const STATUS = 'window.api.bridgeStatus()';

/* Köprü sürecinin ağacı: her sürecin türü, RSS'i ve SON ÜÇ SANİYEDEKİ işlemci
   kullanımı (ps'in yüzdesi süreç ömrünün ortalaması; açılışı da sayıyor).
   POSIX: ps; Windows'ta atlanır. RSS paylaşılan belleği her süreçte sayar,
   toplam üst sınırdır. */
function treeRows(pid) {
  const out = execFileSync('ps', ['-eo', 'pid=,ppid=,rss=,time=,args='], { encoding: 'utf8' });
  const rows = out.trim().split('\n').map((l) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(l);
    if (!m) return null;
    const t = m[4].split(/[-:]/).map(Number).reverse();
    const sec = (t[0] || 0) + (t[1] || 0) * 60 + (t[2] || 0) * 3600 + (t[3] || 0) * 86400;
    const type = (/--type=([\w-]+)/.exec(m[5]) || [])[1] || (/loopback-helper/.test(m[5]) ? 'capture-helper' : 'main');
    // Linux: /proc'tan 10 ms çözünürlüklü işlemci zamanı (ps `time` saniyelik)
    let cpu = sec;
    try {
      const f = fs.readFileSync('/proc/' + m[1] + '/stat', 'utf8').split(') ')[1].split(' ');
      cpu = (Number(f[11]) + Number(f[12])) / 100;
    } catch { /* macOS: ps değeri */ }
    return { pid: +m[1], ppid: +m[2], rss: +m[3], sec: cpu, type };
  }).filter(Boolean);
  const kids = new Set([pid]);
  let grew = true;
  while (grew) { grew = false; for (const r of rows) if (kids.has(r.ppid) && !kids.has(r.pid)) { kids.add(r.pid); grew = true; } }
  return rows.filter((r) => kids.has(r.pid));
}
async function steadyUsage(pid) {
  if (process.platform === 'win32') return null;
  try {
    const a = treeRows(pid);
    const t0 = Date.now();
    await wait(3000);
    const b = treeRows(pid);
    const secs = (Date.now() - t0) / 1000;
    const cpu = b.reduce((n, r) => n + r.sec, 0) - a.reduce((n, r) => n + r.sec, 0);
    return {
      cpuPct: Math.round((cpu / secs) * 1000) / 10, // bir çekirdeğin yüzdesi
      rssMb: Math.round(b.reduce((n, r) => n + r.rss, 0) / 1024),
      procs: b.map((r) => r.type + ':' + Math.round(r.rss / 1024) + 'MB'),
    };
  } catch { return null; }
}
// Eski özet (ömür ortalaması), karşılaştırma için
function treeUsage(pid) {
  if (process.platform === 'win32') return null;
  try {
    const out = execFileSync('ps', ['-eo', 'pid=,ppid=,rss=,pcpu='], { encoding: 'utf8' });
    const rows = out.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
    const kids = new Set([pid]);
    let grew = true;
    while (grew) { grew = false; for (const r of rows) if (kids.has(r[1]) && !kids.has(r[0])) { kids.add(r[0]); grew = true; } }
    let rss = 0, cpu = 0;
    for (const r of rows) if (kids.has(r[0])) { rss += r[2]; cpu += r[3]; }
    return { mb: Math.round(rss / 1024), cpu: Math.round(cpu * 10) / 10, procs: kids.size };
  } catch { return null; }
}

// Köprü kesilince yakalanacak ayrı aygıt (mikser split yerine); Linux'ta null-sink monitörü
const FALLBACK = process.env.SV_RIG_FALLBACK || 'Mixer Split (rig)';
async function scenario(name, bridgeOnly) {
  const secret = require('crypto').randomBytes(18).toString('base64url');
  const port = await freePort();
  const cdpA = await freePort();
  const cdpB = await freePort();
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-bridge-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-bridge-b-'));
  const base = { autovj: { enabled: false }, lighting: { enabled: false }, updates: { auto: false } };
  /* Yalnız köprü: --bridge ayarlarını <userData>/bridge altında tutar.
     Olağan kip: birincilin kendisi köprü ("sesini köprüye ver" açık). */
  const aDir = bridgeOnly ? path.join(dirA, 'bridge') : dirA;
  const ARGS = bridgeOnly ? ['--bridge'] : [];
  fs.mkdirSync(aDir, { recursive: true });
  fs.writeFileSync(path.join(aDir, 'settings.json'), JSON.stringify(Object.assign({}, base, { bridge: { send: !bridgeOnly, secret, port, name: 'Rig Bridge' } })));
  fs.writeFileSync(path.join(dirB, 'settings.json'), JSON.stringify(Object.assign({}, base, { bridge: { receive: true, secret, port, host: '', fallbackSource: FALLBACK } })));
  const res = { name, platform: process.platform };
  let A = launch(dirA, cdpA, ARGS);
  const B = launch(dirB, cdpB);
  let pb = null;
  try {
    pb = await connect(await adminPage(cdpB, 30000));
    const t0 = Date.now();
    const linked = await until(async () => { const s = await pb.eval(STATUS); return { ok: s.receiver && s.receiver.state === 'connected', s }; }, 20000, 100);
    res.discoveredMs = Date.now() - t0;
    res.linked = !!linked.ok;
    res.foundByBeacon = !!(linked.s && linked.s.found && linked.s.found.some((f) => f.paired && f.name === 'Rig Bridge'));
    if (!linked.ok) throw new Error('receiver did not connect: ' + JSON.stringify(linked.s || linked));
    const onBridge = await until(async () => { const s = await pb.eval(STATUS); return { ok: s.input && s.input.state === 'bridge', s }; }, 15000, 100);
    res.framesArrive = !!onBridge.ok;
    if (!onBridge.ok) throw new Error('no frames from the bridge (is any audio playing on the bridge machine?): ' + JSON.stringify(onBridge.s));
    // Ölçüm: 3 sn boyunca gecikme ve saat farkı
    const ages = [];
    let s = null;
    for (let i = 0; i < 30; i++) { s = await pb.eval(STATUS); if (s.receiver.ageMs != null) ages.push(s.receiver.ageMs); await wait(100); }
    ages.sort((a, b) => a - b);
    res.rttMs = s.receiver.rttMs;
    res.offsetMs = s.receiver.offsetMs;
    res.ageMedianMs = ages[Math.floor(ages.length / 2)];
    res.ageP95Ms = ages[Math.floor(ages.length * 0.95)];
    res.lostFrames = s.receiver.lost;
    // Köprünün çözümlemesi (bantlar, seviye, vuruş, BPM) köprünün saatiyle damgalı geliyor
    res.analysis = s.analysis;
    res.analysisArrives = !!(s.analysis && s.analysis.bands && s.analysis.ageMs != null && s.analysis.ageMs < 2000);
    res.bridgeSourceWhileLinked = JSON.stringify(s.localSources) !== JSON.stringify([FALLBACK]);
    res.bridgeUsage = await steadyUsage(A.pid);
    const pagesA = (await (await fetch('http://127.0.0.1:' + cdpA + '/json/list')).json()).filter((p) => p.type === 'page');
    // Yalnız köprüde hiç sayfa yok; olağan kipte panel açık ve görüntü çıkışı yine açılabilir
    res.bridgeHasNoWindow = bridgeOnly ? pagesA.length === 0 : pagesA.some((p) => /admin\/index\.html/.test(p.url));
    // Köprü düşer: yerel girişe dönüş
    killTree(A);
    const t1 = Date.now();
    const fell = await until(async () => { const x = await pb.eval(STATUS); return { ok: x.input && x.input.state === 'fallback', x }; }, 5000, 25);
    res.fallbackMs = Date.now() - t1;
    res.fellBack = !!fell.ok;
    res.fallbackDevice = fell.x && JSON.stringify(fell.x.localSources) === JSON.stringify([FALLBACK]);
    // Köprü geri gelir: kararlı olunca köprüye dönüş
    A = launch(dirA, cdpA, ARGS);
    const t2 = Date.now();
    const back = await until(async () => { const x = await pb.eval(STATUS); return { ok: x.input && x.input.state === 'bridge', x }; }, 30000, 100);
    res.recoverMs = Date.now() - t2;
    res.recovered = !!back.ok;
    res.pass = res.linked && res.foundByBeacon && res.framesArrive && res.bridgeHasNoWindow && res.fellBack && res.recovered &&
      res.analysisArrives && res.bridgeSourceWhileLinked && res.fallbackDevice;
  } catch (e) {
    res.pass = false;
    res.error = String(e && e.message || e);
    res.bridgeLog = A.log.slice(-1500);
  } finally {
    if (pb) pb.close();
    killTree(A);
    killTree(B);
    await wait(300);
    for (const d of [dirA, dirB]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* Windows: kilitli kalabilir */ } }
  }
  say((res.pass ? 'ok   ' : 'FAIL ') + name + ': ' + JSON.stringify(res));
  return res.pass;
}

(async () => {
  const a = await scenario('bridge-only mode (--bridge)', true);
  const b = await scenario('normal mode, the primary is the bridge', false);
  process.exitCode = a && b ? 0 : 1;
})();
