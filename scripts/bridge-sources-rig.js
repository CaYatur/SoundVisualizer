/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
// Node 20'de genel WebSocket yok: aynı betik Electron'un Node'uyla yeniden çalışır
if (typeof WebSocket === 'undefined' && !process.env.ELECTRON_RUN_AS_NODE) {
  const r = require('child_process').spawnSync(require('electron'), [__filename].concat(process.argv.slice(2)), { stdio: 'inherit', env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }) });
  process.exit(r.status == null ? 1 : r.status);
}
/* SES KÖPRÜSÜ, BİRDEN ÇOK KAYNAK (#813). Köprü uygulamanın Ses Kaynakları
   sistemini kullanıyor: aynı seçici, aynı yakalama yardımcısı, aynı karışım.
   Bu deneme iki yapay kaynakla (PulseAudio null-sink + module-sine, 440 Hz ve
   1000 Hz) ve bir de olmayan aygıtla:
     1) yardımcı: iki kaynağın karışımının tayfında İKİ ton da var; tek kaynakta
        yalnız biri. Olmayan aygıt SRC satırıyla "missing" bildiriliyor,
        ötekiler çalışıyor.
     2) uçtan uca: --bridge üç kaynakla açılır, alıcı köprü girişine geçer;
        köprünün durumunda eksik kaynak görünür; kaynak listesi CANLI
        değiştirilince alıcı bağlantısı kopmaz.
   Linux ve pactl gerekir (CI sınıfı kutu); yoksa nedenini söyleyip çıkar.
   Kullanım:  npm run bridge-sources-rig   (çıkış kodu: geçmezse 1) */

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const F = require('../src/main/audio-frame.js');

const ROOT = path.join(__dirname, '..');
const say = (s) => process.stdout.write(s + '\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SRC_A = process.env.SV_RIG_SRC_A || 'Monitor of Null Output';
const SRC_B = process.env.SV_RIG_SRC_B || 'Monitor of RigTwo';
const MISSING = 'Missing Device (rig)';
const electron = () => require('electron');

function pactl(args) { return execFileSync('pactl', args, { encoding: 'utf8' }).trim(); }
const loaded = [];
function setupSinks() {
  const mods = pactl(['list', 'short', 'modules']);
  if (!/module-null-sink\s+sink_name=rig\b/.test(mods)) {
    loaded.push(pactl(['load-module', 'module-null-sink', 'sink_name=rig']));
    loaded.push(pactl(['load-module', 'module-sine', 'sink=rig', 'frequency=440']));
  }
  if (!/sink_name=rig2\b/.test(mods)) {
    loaded.push(pactl(['load-module', 'module-null-sink', 'sink_name=rig2', 'sink_properties=device.description=RigTwo']));
    loaded.push(pactl(['load-module', 'module-sine', 'sink=rig2', 'frequency=1000']));
  }
}
function teardownSinks() { for (const m of loaded.reverse()) { try { pactl(['unload-module', m]); } catch { /* */ } } }

// 1) Yardımcının karışımı: kareleri topla, tayfta tepeleri bul
function captureSpectrum(sources, ms) {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' });
    const child = spawn(electron(), [path.join(ROOT, 'src/main/loopback-helper.js'), '--capture', JSON.stringify({ devices: sources })], { cwd: ROOT, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let acc = Buffer.alloc(0);
    const sum = new Float64Array(F.BINS);
    let n = 0, sr = 0;
    const src = [];
    let err = '';
    child.stdout.on('data', (c) => {
      acc = F.splitHelperStream(Buffer.concat([acc, c]), (fr) => {
        sr = fr.sampleRate;
        if (++n > 20) for (let i = 0; i < F.BINS; i++) sum[i] += fr.freq[i];
      });
    });
    child.stderr.on('data', (d) => {
      err += d.toString();
      for (const ln of d.toString().split(/\r?\n/)) { const m = /^SRC (\{.*\})/.exec(ln.trim()); if (m) { try { src.push(JSON.parse(m[1])); } catch { /* */ } } }
    });
    setTimeout(() => {
      try { child.stdin.end(); child.kill(); } catch { /* */ }
      const bin = (hz) => Math.round(hz / ((sr || 44100) / F.FFT_SIZE));
      const avg = (i) => (n > 20 ? sum[i] / (n - 20) : 0);
      const peak = (hz) => { const b = bin(hz); return Math.max(avg(b - 1), avg(b), avg(b + 1)); };
      // Taban: iki tondan uzak bir bölge
      let floor = 0; for (let i = bin(2500); i < bin(3500); i++) floor = Math.max(floor, avg(i));
      resolve({ frames: n, sr, a440: Math.round(peak(440)), a1000: Math.round(peak(1000)), floor: Math.round(floor), src, err: err.slice(-400) });
    }, ms);
  });
}

// 2) Uçtan uca: CDP ile iki gerçek kopya
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer(); s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
function launch(dir, cdp, extra) {
  const env = Object.assign({}, process.env); delete env.ELECTRON_RUN_AS_NODE;
  const c = spawn(electron(), ['.', '--user-data-dir=' + dir, '--remote-debugging-port=' + cdp].concat(extra || []), { cwd: ROOT, env, stdio: 'ignore', detached: true });
  return c;
}
function kill(c) { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* */ } }
async function page(cdp, re, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const p = (await (await fetch('http://127.0.0.1:' + cdp + '/json/list')).json()).find((x) => x.type === 'page' && re.test(x.url)); if (p) return p.webSocketDebuggerUrl; } catch { /* */ }
    await wait(250);
  }
  throw new Error('page ' + re + ' did not open');
}
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('cdp')); });
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  return {
    eval: async (e) => { const i = ++id; const r = await new Promise((res) => { pend.set(i, res); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: e, awaitPromise: true, returnByValue: true } })); }); return r.result && r.result.result ? r.result.result.value : undefined; },
    close: () => { try { ws.close(); } catch { /* */ } },
  };
}
async function until(fn, ms) { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await fn(); if (last && last.ok) return last; } catch (e) { last = { error: String(e) }; } await wait(150); } return Object.assign({ ok: false }, last || {}); }

async function endToEnd() {
  const secret = require('crypto').randomBytes(18).toString('base64url');
  const port = await freePort(); const cdpA = await freePort(); const cdpB = await freePort();
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-src-a-')); const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-src-b-'));
  const base = { autovj: { enabled: false }, lighting: { enabled: false }, updates: { auto: false } };
  fs.mkdirSync(path.join(dirA, 'bridge'), { recursive: true });
  // Köprünün kaynak listesi kendi klasöründe: <userData>/bridge/settings.json
  fs.writeFileSync(path.join(dirA, 'bridge', 'settings.json'), JSON.stringify(Object.assign({}, base, { audio: { sources: [SRC_A, SRC_B, MISSING] }, bridge: { secret, port, name: 'Rig Bridge' } })));
  fs.writeFileSync(path.join(dirB, 'settings.json'), JSON.stringify(Object.assign({}, base, { bridge: { receive: true, secret, port, host: '' } })));
  const A = launch(dirA, cdpA, ['--bridge', '--bridge-multi']); const B = launch(dirB, cdpB);
  const res = {};
  let pa = null, pb = null;
  try {
    pb = await connect(await page(cdpB, /admin\/index\.html/, 30000));
    pa = await connect(await page(cdpA, /bridge-status\/index\.html/, 30000));
    const on = await until(async () => { const s = await pb.eval('window.api.bridgeStatus()'); return { ok: s.input && s.input.state === 'bridge', s }; }, 20000);
    res.receiverOnBridge = !!on.ok;
    const st = await until(async () => { const s = await pa.eval('window.bridgeWin.status()'); return { ok: s.sourceStates && s.sourceStates[MISSING] && s.sourceStates[MISSING].state === 'missing', s }; }, 8000);
    res.missingReported = !!st.ok;
    res.wanted = st.s && st.s.wantedSources;
    res.capturing = !!(st.s && st.s.capturing);
    // Panelin kaynak kartı ve durum penceresinin kartı aynı parça
    res.sharedPicker = await pa.eval("!!(window.SVAudioSources && document.querySelectorAll('.bs-src .source-item input[type=checkbox]').length >= 3)");
    // Canlı değişiklik: alıcı kopmamalı
    const before = await pb.eval('window.api.bridgeStatus()');
    const conn0 = before.receiver && before.receiver.connects;
    await pa.eval(`window.bridgeWin.setSources(${JSON.stringify([SRC_B])})`);
    await wait(2500);
    const after = await pb.eval('window.api.bridgeStatus()');
    const sa = await pa.eval('window.bridgeWin.status()');
    res.liveSwitchKeptLink = after.receiver && after.receiver.state === 'connected' && after.input.state === 'bridge' && (conn0 == null || after.receiver.connects === conn0);
    // Kaynak değişirken alıcı yedeğe dönüp geri gelmedi (köprü haber veriyor)
    res.noFallbackFlip = !!(before.input && after.input && after.input.switches === before.input.switches);
    res.inputSwitches = [before.input && before.input.switches, after.input && after.input.switches];
    res.switchedTo = sa.wantedSources;
    res.missingCleared = !(sa.sourceStates && sa.sourceStates[MISSING]);
    const saved = JSON.parse(fs.readFileSync(path.join(dirA, 'bridge', 'settings.json'), 'utf8'));
    res.persistedInBridgeFolder = JSON.stringify(saved.audio && saved.audio.sources) === JSON.stringify([SRC_B]);
    res.pass = res.noFallbackFlip && res.receiverOnBridge && res.missingReported && res.capturing && res.sharedPicker && res.liveSwitchKeptLink && res.missingCleared && res.persistedInBridgeFolder;
  } catch (e) { res.pass = false; res.error = String(e.message || e); }
  finally {
    if (pa) pa.close(); if (pb) pb.close(); kill(A); kill(B); await wait(300);
    for (const d of [dirA, dirB]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
  }
  return res;
}

(async () => {
  if (process.platform !== 'linux') { say('skip: this rig needs Linux with PulseAudio/PipeWire (pactl)'); return; }
  try { pactl(['info']); } catch { say('skip: pactl is not available'); return; }
  let ok = true;
  try {
    setupSinks();
    await wait(500);
    const one = await captureSpectrum([SRC_A], 2500);
    const two = await captureSpectrum([SRC_A, SRC_B, MISSING], 2500);
    const r1 = { frames: one.frames, a440: one.a440, a1000: one.a1000, floor: one.floor };
    const r2 = { frames: two.frames, a440: two.a440, a1000: two.a1000, floor: two.floor, src: two.src };
    const pass1 = one.frames > 50 && one.a440 > one.floor + 40 && one.a1000 < one.floor + 25;
    const pass2 = two.frames > 50 && two.a440 > two.floor + 40 && two.a1000 > two.floor + 40 && two.src.some((s) => s.key === MISSING && s.state === 'missing');
    say((pass1 ? 'ok   ' : 'FAIL ') + 'one source (440 Hz only): ' + JSON.stringify(r1));
    say((pass2 ? 'ok   ' : 'FAIL ') + 'two sources + a missing one (440 and 1000 Hz, missing reported): ' + JSON.stringify(r2));
    if (!pass1 || !pass2) { ok = false; if (!pass2) say(two.err); }
    const e2e = await endToEnd();
    say((e2e.pass ? 'ok   ' : 'FAIL ') + 'bridge with the Audio Sources list, live change: ' + JSON.stringify(e2e));
    if (!e2e.pass) ok = false;
  } finally { teardownSinks(); }
  process.exitCode = ok ? 0 : 1;
})();
