/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TELEFON BAĞLANTISI UÇTAN UCA, MASAÜSTÜ (docs/PHONE-LINK.md). Uygulamayı yalıtılmış profille
   açar (kullanıcının verisine dokunmaz, yalnız 127.0.0.1'i dinler), Node'dan sahte bir telefonla
   eşleşir ve her işlemin ETKİSİNİ paneldeki durumdan okur: yanıtın "ok" demesi yetmez.

     node scripts/link-probe.js            hepsi
     node scripts/link-probe.js --keep     sonunda uygulamayı açık bırak (CDP kapısı yazılır)

   Telefon tarafının aynısı Android'de android/tools/probe-pclink.js. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const Link = require('../src/main/phone-link.js');

const ROOT = path.join(__dirname, '..');
const KEEP = process.argv.includes('--keep');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (n, ok, d) => { if (!ok) bad++; console.log((ok ? 'OK   ' : 'FAIL ') + n + (d === undefined ? '' : '  ' + JSON.stringify(d).slice(0, 300))); };

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
function killTree(child) {
  if (!child || child.exitCode != null) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch { /* zaten kapandı */ }
}
async function cdp(port) {
  let url = null;
  for (let i = 0; i < 160 && !url; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      const page = list.find((p) => p.type === 'page' && /admin\/index\.html/.test(p.url));
      if (page) url = page.webSocketDebuggerUrl;
    } catch { /* açılıyor */ }
    if (!url) await wait(250);
  }
  if (!url) throw new Error('panel CDP üzerinde açılmadı');
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('cdp')); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  return {
    ev: async (expr) => {
      const i = ++id;
      const r = await new Promise((res) => { pending.set(i, res); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } })); });
      if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result && r.result.result ? r.result.result.value : undefined;
    },
    close: () => { try { ws.close(); } catch { /* */ } },
  };
}

/* Sahte telefon: kodla eşleşir (taahhüt → açıklama → bilgisayarda onay), sonra şifreli istek
   ve olay. Kotlin'deki PcLink.kt ile aynı adımlar. */
function phone(port) {
  const ws = new WebSocket('ws://127.0.0.1:' + port + '/link');
  ws.binaryType = 'arraybuffer';
  const texts = [];
  const textWaiters = [];
  const events = [];
  const pcmIn = [];
  const replies = new Map();
  let open = null;
  ws.onmessage = (m) => {
    if (typeof m.data === 'string') {
      const o = JSON.parse(m.data);
      const w = textWaiters.shift();
      if (w) w(o); else texts.push(o);
      return;
    }
    if (!open) return;
    const plain = open(Buffer.from(m.data));
    if (!plain) { events.push({ ev: 'undecryptable' }); return; }
    if (plain[0] !== 0x7b) { pcmIn.push(plain); return; } // PC'nin sesi (B5)
    const o = JSON.parse(plain.toString('utf8'));
    if (o.re != null && replies.has(o.re)) { replies.get(o.re)(o); replies.delete(o.re); } else if (o.ev) events.push(o);
  };
  const nextText = (ms) => new Promise((res, rej) => {
    if (texts.length) { res(texts.shift()); return; }
    const t = setTimeout(() => rej(new Error('yanıt yok')), ms || 5000);
    textWaiters.push((o) => { clearTimeout(t); res(o); });
  });
  let seal = null;
  let seq = 0;
  return {
    ready: new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); }),
    nextText,
    sendText: (o) => ws.send(JSON.stringify(o)),
    keys: (k) => { seal = Link.sealer(k.c2p, 'c2p'); open = Link.opener(k.p2c, 'p2c'); },
    ask: (op, args, ms) => new Promise((res) => {
      const id = 'q' + (++seq);
      const t = setTimeout(() => { replies.delete(id); res({ ok: false, error: 'timeout' }); }, ms || 5000);
      replies.set(id, (o) => { clearTimeout(t); res(o); });
      ws.send(seal(Buffer.from(JSON.stringify({ id, op, args: args || {} }))));
    }),
    sendRaw: (buf) => ws.send(seal(buf)),
    pcmIn,
    events,
    close: () => ws.close(),
  };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-link-probe-'));
  const streamPort = await freePort();
  const cdpPort = await freePort();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
    phoneLink: { enabled: true, discoverable: false },
    stream: { enabled: false, port: streamPort },
    // Dinlenebilir ses sınanırken hoparlörden ses çıkmasın: çalma penceresi paketleri yine sayar
    bridge: { playVolume: 0, playVolumeSet: true },
  }));
  const env = Object.assign({}, process.env, { SV_LISTEN_LOOPBACK: '1' });
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), ['.', '--user-data-dir=' + dir, '--remote-debugging-port=' + cdpPort], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32',
  });
  let log = '';
  child.stdout.on('data', (d) => { log = (log + d).slice(-8000); });
  child.stderr.on('data', (d) => { log = (log + d).slice(-8000); });
  let pc = null;
  let ph = null;
  try {
    pc = await cdp(cdpPort);
    for (let i = 0; i < 80 && !(await pc.ev('!!(window.SVPanel && window.SVLinkLive && window.api && window.api.phoneLinkStatus)')); i++) await wait(250);
    // Gösteri için iki hazır sahne
    await pc.ev('(async () => { await window.SVPanel.addStarterScenes(); return true; })()');
    await wait(600);
    const scenes = await pc.ev('window.SVPanel.scenes().map((s) => s.id)');
    check('sınama sahneleri', scenes.length >= 2, scenes.length);
    let st = null;
    for (let i = 0; i < 40; i++) { st = await pc.ev('window.api.phoneLinkStatus()'); if (st && st.running) break; await wait(250); }
    check('bağlantı açık', st && st.running, st && { running: st.running, error: st.error });
    st = await pc.ev('window.api.phoneLinkNewCode()');
    const code = st.pairing.code;

    // ---- Eşleşme
    ph = phone(st.port || streamPort);
    await ph.ready;
    const hello = await ph.nextText();
    check('karşılama', hello.t === 'hello' && hello.pairing === true, hello.t);
    const me = Link.newIdentity();
    ph.sendText({ t: 'pair', kind: 'code', v: 1, pub: Link.b64u(me.pub), name: 'Sınama Telefonu', model: 'probe', proof: Link.b64u(Link.hmac(Buffer.from(code), 'sv-link-code|', me.pub)) });
    const commit = await ph.nextText();
    const np = crypto.randomBytes(16);
    ph.sendText({ t: 'reveal', np: Link.b64u(np) });
    const rev = await ph.nextText();
    const pcPub = Link.unb64u(commit.pub);
    const nc = Link.unb64u(rev.nc);
    let pend = [];
    for (let i = 0; i < 20 && !pend.length; i++) { pend = (await pc.ev('window.api.phoneLinkStatus()')).pending; if (!pend.length) await wait(150); }
    check('bilgisayarda onay bekliyor, aynı sayı', pend.length === 1 && pend[0].digits === Link.sasDigits(me.pub, pcPub, np, nc));
    // Onay penceresi açılmış olmalı; panelin kendi düğmesiyle onayla
    const clicked = await pc.ev(`(() => { const b = [...document.querySelectorAll('.ask-panel button')].find((x) => x.textContent.trim() === window.SVI18n.t('Aynı, onayla')); if (!b) return false; b.click(); return true; })()`);
    check('onay penceresi açıldı ve onaylandı', clicked);
    const paired = await ph.nextText();
    check('eşleşti, tam erişim', paired.t === 'paired' && paired.level === 'full', paired);
    const devKey = Link.deviceKey(Link.sharedSecret(me, pcPub), me.pub, pcPub, np, nc);
    ph.keys(Link.sessionKeys(devKey, np, nc));

    // ---- Ayar aynası
    const cg = await ph.ask('config.get');
    const keys = cg.ok ? Object.keys(cg.result.config) : [];
    check('config.get: sahneler var, jeton/anahtar yok', cg.ok && Array.isArray(cg.result.config.scenes) && keys.indexOf('stream') < 0 && keys.indexOf('phoneLink') < 0 && keys.indexOf('mcp') < 0, { rev: cg.result && cg.result.rev, n: keys.length });
    const rev0 = cg.ok ? cg.result.rev : 0;

    const P = (expr) => pc.ev('(() => { const c = window.SVPanel.cfg(); return ' + expr + '; })()');
    const settle = async (expr, want, ms) => {
      let v;
      for (let i = 0; i < (ms || 3000) / 100; i++) { v = await P(expr); if (JSON.stringify(v) === JSON.stringify(want)) return v; await wait(100); }
      return v;
    };

    // ---- Sahne
    let r = await ph.ask('scene.apply', { id: scenes[1] });
    check('scene.apply yanıtı', r.ok, r);
    check('scene.apply: panelde etkin sahne', (await settle('window.SVPanel.activeSceneId()', scenes[1])) === scenes[1]);
    await wait(500);
    const cfgEv = ph.events.filter((e) => e.ev === 'config');
    check('ayar olayı: sürüm artıyor, etkin sahne geliyor', cfgEv.length > 0 && cfgEv[cfgEv.length - 1].rev > rev0 && cfgEv.some((e) => e.patch && e.patch._activeSceneId === scenes[1]), cfgEv.map((e) => [e.rev, Object.keys(e.patch)]).slice(-3));
    r = await ph.ask('scene.apply', { id: 'olmayan' });
    check('olmayan sahne reddedilir', r.ok === false && r.error === 'bad-args', r);

    // ---- Karartma (mutlak)
    r = await ph.ask('blackout', { on: true });
    check('karartma açık', r.ok && (await settle('window.SVPanel.isBlackedOut()', true)) === true, r);
    r = await ph.ask('blackout', { on: true });
    check('aynı istek tekrar: hâlâ açık (ters çevirmez)', r.ok && (await settle('window.SVPanel.isBlackedOut()', true)) === true);
    r = await ph.ask('blackout', { on: false });
    check('karartma kapalı', r.ok && (await settle('window.SVPanel.isBlackedOut()', false)) === false);

    // ---- Sıra ve AL
    r = await ph.ask('cue.set', { id: scenes[0] });
    check('sıradaki sahne', r.ok && (await settle('window.SVLiveShell.cue()', scenes[0])) === scenes[0], r);
    r = await ph.ask('tbar', { take: true });
    check('AL: sıradaki canlıya geçti', r.ok && (await settle('window.SVPanel.activeSceneId()', scenes[0])) === scenes[0], r);

    // ---- Anlık efekt ve kirası
    r = await ph.ask('momentary', { list: ['flash'] });
    check('anlık efekt basılı', r.ok && JSON.stringify(await P('window.SVLiveShell.heldList()')) === '["flash"]', r);
    await wait(2200);
    check('yenilenmeyen efekt kendiliğinden kalktı (kira)', JSON.stringify(await P('window.SVLiveShell.heldList()')) === '[]');
    r = await ph.ask('momentary', { list: ['ates'] });
    check('bilinmeyen efekt reddedilir', r.ok === false && r.error === 'bad-args', r);

    // ---- Makro, tempo, ana opaklık, Otomatik VJ
    r = await ph.ask('macro.set', { i: 0, v: 0.7 });
    check('makro 1 = 0,7', r.ok && (await settle('c.modulation.macros[0].value', 0.7)) === 0.7, r);
    r = await ph.ask('tempo.set', { bpm: 128 });
    check('tempo kilidi 128', r.ok && (await settle('c.autovj.bpmLock', 128)) === 128, r);
    r = await ph.ask('tempo.set', { bpm: 0 });
    check('tempo otomatik', r.ok && (await settle('c.autovj.bpmLock', 0)) === 0);
    r = await ph.ask('master.set', { v: 0.5 });
    check('ana opaklık 0,5', r.ok && (await settle('c.master', 0.5)) === 0.5, r);
    await ph.ask('master.set', { v: 1 });
    r = await ph.ask('autovj.toggle', { on: true });
    check('Otomatik VJ açık', r.ok && (await settle('!!c.autovj.enabled', true)) === true, r);
    await ph.ask('autovj.toggle', { on: false });
    check('Otomatik VJ kapalı', (await settle('!!c.autovj.enabled', false)) === false);

    // ---- Çizelge taşıması
    r = await ph.ask('timeline.transport', { action: 'play' });
    check('çizelge oynuyor', r.ok && r.result && r.result.playing === true, r);
    r = await ph.ask('timeline.transport', { action: 'stop' });
    check('çizelge durdu', r.ok && r.result && r.result.playing === false, r);

    // ---- Adlı eylem ve MilkDrop
    r = await ph.ask('run', { id: 'nextPalette' });
    check('adlı eylem', r.ok, r);
    r = await ph.ask('run', { id: 'redTakeover' });
    check('yedeklilik devri telefondan yok', r.ok === false, r);
    r = await ph.ask('milkdrop.nav', { dir: 'next' });
    check('MilkDrop gezintisi yanıt verir', r.ok === true || r.error === 'failed', r);

    // ---- Canlı özet
    await wait(800);
    const meter = ph.events.filter((e) => e.ev === 'meter');
    const live = ph.events.filter((e) => e.ev === 'live');
    check('ölçer olayı geliyor', meter.length > 0 && typeof meter[meter.length - 1].meter.level === 'number', meter.length);
    const last = live.length ? live[live.length - 1].show : null;
    // Renk şablonu ve MilkDrop değişince panel sahneyi "değişti" sayıp bırakabilir: panelin kendisiyle karşılaştır
    const activeNow = await P('window.SVPanel.activeSceneId() || ""');
    check('gösteri durumu: etkin sahne, T-bar, çizelge', !!last && last.active === activeNow && last.tbar && typeof last.tbar.rest === 'number' && last.timeline && last.timeline.playing === false && typeof last.deck === 'string', last);
    r = await ph.ask('live.get');
    check('live.get', r.ok && r.result.show && r.result.meter, r.ok);

    // ---- Düzenleme (B3): yama panelin kopyasına yazılır, panel gönderir
    const vis0 = await P('c.visualizer.type');
    const visNext = vis0 === 'wave' ? 'bars' : 'wave';
    r = await ph.ask('config.patch', { patch: { visualizer: Object.assign({}, cg.result.config.visualizer, { type: visNext }) } });
    check('config.patch: görselleştirici türü', r.ok && (await settle('c.visualizer.type', visNext)) === visNext, r);
    r = await ph.ask('config.patch', { patch: { master: 9 } });
    check('config.patch: aralık sıkıştırıldı', r.ok && (await settle('c.master', 1)) === 1, r);
    r = await ph.ask('config.patch', { patch: { media: Object.assign({}, cg.result.config.media, { file: 'C:\\Windows\\win.ini' }) } });
    check('config.patch: yeni dosya yolu reddedilir', r.ok === false && r.error === 'path' && r.detail === 'media', r);
    r = await ph.ask('config.patch', { patch: { stream: { lan: true } } });
    check('config.patch: yayın ayarı hiçbir düzeyde yazılamaz', r.ok === false && r.error === 'not-allowed' && r.detail === 'stream', r);
    const lay = await P('JSON.parse(JSON.stringify(c.layers))');
    if (lay.length) {
      lay[lay.length - 1].opacity = 0.42;
      r = await ph.ask('config.patch', { patch: { layers: lay }, final: false });
      check('config.patch: sürükleme (final:false) canlıya gider', r.ok && (await settle('c.layers[c.layers.length - 1].opacity', 0.42)) === 0.42, r);
    }
    // Sahne işlemleri
    const nScenes = (await P('window.SVPanel.scenes().length'));
    r = await ph.ask('scene.create', { name: 'Telefondan' });
    const made = r.ok ? r.result.id : '';
    check('scene.create: PC görünümünden yeni sahne', r.ok && (await P('window.SVPanel.scenes().length')) === nScenes + 1 && (await P('(window.SVPanel.scenes().find((s) => s.id === ' + JSON.stringify(made) + ') || {}).name')) === 'Telefondan', r);
    r = await ph.ask('scene.rename', { id: made, name: 'Yeni Ad' });
    check('scene.rename', r.ok && (await settle('(window.SVPanel.scenes().find((s) => s.id === ' + JSON.stringify(made) + ') || {}).name', 'Yeni Ad')) === 'Yeni Ad', r);
    const order = (await P('window.SVPanel.scenes().map((s) => s.id)')).reverse();
    r = await ph.ask('scene.reorder', { ids: order });
    check('scene.reorder', r.ok && JSON.stringify(await P('window.SVPanel.scenes().map((s) => s.id)')) === JSON.stringify(order), r);
    r = await ph.ask('scene.reorder', { ids: order.slice(1) });
    check('scene.reorder: eksik liste reddedilir', r.ok === false, r);
    r = await ph.ask('scene.create', { name: 'Yollu', data: { media: { file: 'D:\\x.mp4' } } });
    check('scene.create: sahne verisinde yeni yol reddedilir', r.ok === false && r.error === 'path', r);
    r = await ph.ask('scene.delete', { id: made });
    check('scene.delete', r.ok && (await P('window.SVPanel.scenes().length')) === nScenes, r);
    // Renk şablonu
    r = await ph.ask('palette.save', { name: 'Telefon Renkleri', colors: ['#ff0000', '#00ff00', '#0000ff'] });
    const pal = r.ok ? r.result.id : '';
    check('palette.save', r.ok && (await P('(c.userPresets || []).some((p) => p.id === ' + JSON.stringify(pal) + ' && p.colors.length === 5)')), r);
    r = await ph.ask('palette.save', { colors: ['kirmizi'] });
    check('palette.save: geçersiz renk', r.ok === false, r);
    r = await ph.ask('palette.delete', { id: pal });
    check('palette.delete', r.ok && !(await P('(c.userPresets || []).some((p) => p.id === ' + JSON.stringify(pal) + ')')), r);
    // Düzenleme düzeyi: çıkış/ses ayarı (tam) reddedilir
    await pc.ev('window.api.phoneLinkSetLevel(' + JSON.stringify(paired.device) + ', "edit")');
    r = await ph.ask('config.patch', { patch: { audio: cg.result.config.audio } });
    check('düzenleme düzeyinde ses kaynağı yazılamaz', r.ok === false && r.error === 'not-allowed' && r.detail === 'audio', r);
    await pc.ev('window.api.phoneLinkSetLevel(' + JSON.stringify(paired.device) + ', "full")');
    r = await ph.ask('config.patch', { patch: { audio: cg.result.config.audio } });
    check('tam düzeyde ses ayarı yazılır', r.ok, r);

    // ---- İzin düzeyi
    const dev = paired.device;
    await pc.ev('window.api.phoneLinkSetLevel(' + JSON.stringify(dev) + ', "view")');
    r = await ph.ask('blackout', { on: true });
    check('izle düzeyinde kumanda reddedilir', r.ok === false && r.error === 'not-allowed', r);
    check('karartma değişmedi', (await P('window.SVPanel.isBlackedOut()')) === false);
    r = await ph.ask('config.get');
    check('izle düzeyinde ayar okunur', r.ok);
    await pc.ev('window.api.phoneLinkSetLevel(' + JSON.stringify(dev) + ', "full")');

    // ---- Telefonun sesi (B4): PC'nin ses girişi olur, telefon susunca yerel girişe döner
    const LA = require('../src/main/link-audio.js');
    r = await ph.ask('audio.bridge', { on: true });
    check('audio.bridge açık, bu telefona bağlı', r.ok && r.result.enabled === true && r.result.device === dev, r);
    const aState = async () => (await pc.ev('window.api.phoneLinkStatus()')).audioIn || {};
    let seqA = 0;
    const sendTone = async (ms) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const s = new Int16Array(480 * 2);
        for (let i = 0; i < 480; i++) { const v = Math.round(Math.sin((2 * Math.PI * 1000 * (seqA * 480 + i)) / 48000) * 16000); s[i * 2] = v; s[i * 2 + 1] = v; }
        ph.sendRaw(LA.encode(seqA++, 48000, 2, s));
        await wait(10);
      }
    };
    await sendTone(1200);
    let as = await aState();
    check('PC girişi telefonda, kareler üretiliyor', as.state === 'bridge' && as.stats && as.stats.frames > 30 && as.stats.sampleRate === 48000, as);
    const label = await pc.ev(`(document.getElementById('audioState') || {}).textContent || ''`);
    check('panelde "Ses telefondan"', label.indexOf(await pc.ev(`window.SVI18n.t('Ses telefondan')`)) >= 0, label);
    // Parça bilgisi ve kapak da telefondan (giriş telefondayken)
    const art = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
    r = await ph.ask('nowplaying.set', { has: true, title: 'Telefon Şarkısı', artist: 'Telefon Sanatçısı', album: 'Albüm', duration: 200, position: 3, playing: true, artwork: art });
    check('nowplaying.set: giriş telefonda, gösteriliyor', r.ok && r.result.shown === true, r);
    await sendTone(300);
    const shown = await pc.ev('window.api.nowPlayingCurrent ? window.api.nowPlayingCurrent() : null');
    if (shown) check('PC\'nin çalan parçası telefonunki (kapak dahil)', shown.title === 'Telefon Şarkısı' && shown.artist === 'Telefon Sanatçısı' && shown.artwork === art, { title: shown.title, artist: shown.artist, art: !!shown.artwork });
    else console.log('NOTE panelden çalan parça okunamadı (nowPlayingCurrent yok)');
    // PC hoparlöründen de çal (ses düzeyi 0): ses köprüsünün çalma penceresi telefonun paketlerini alır
    await pc.ev('(() => { const c = window.SVPanel.cfg(); c.phoneLink.audioIn.play = true; window.SVPanel.push(true); return 1; })()');
    await wait(1500);
    await sendTone(1500);
    const pl = (await pc.ev('window.api.bridgeStatus()')).player;
    check('PC hoparlöründen çalma: pencere telefonun sesini alıyor', !!pl && pl.chunks > 10, pl);
    await pc.ev('(() => { const c = window.SVPanel.cfg(); c.phoneLink.audioIn.play = false; window.SVPanel.push(true); return 1; })()');
    await wait(1200);
    as = await aState();
    check('telefon susunca yerel girişe döndü', as.state === 'fallback', as.state);
    r = await ph.ask('audio.bridge', { on: false });
    check('audio.bridge kapalı', r.ok && (await aState()).state === 'off', r);

    // ---- PC'nin sesi telefona (B5) ve gerçek görüntü karesi
    r = await ph.ask('audio.watch', { on: true });
    check('audio.watch açık', r.ok && r.result.on === true, r);
    await wait(2500);
    const got = ph.pcmIn.map((b) => LA.decode(b)).filter(Boolean);
    if (got.length) check('PC sesi telefona geliyor (yakalama açık)', got.length > 20 && got[0].channels === 2, { n: got.length, rate: got[0].sampleRate });
    else console.log('NOTE PC sesi gelmedi: bu makinede yakalama yok ya da sessiz aygıt (' + JSON.stringify(r.result) + ')');
    r = await ph.ask('audio.watch', { on: false });
    const n0 = ph.pcmIn.length;
    await wait(600);
    check('audio.watch kapalı: ses durdu', r.ok && ph.pcmIn.length - n0 <= 3, ph.pcmIn.length - n0);
    r = await ph.ask('preview.get');
    if (r.ok) check('preview.get JPEG', /^\/9j\//.test(r.result.jpeg) && r.result.width > 0, { w: r.result.width, h: r.result.height, kb: Math.round(r.result.jpeg.length * 0.75 / 1024) });
    else check('preview.get: görüntü yoksa anlaşılır hata', r.error === 'no-preview', r);

    // ---- B6: çıkışlar, ses aygıtları, kitaplık, dosya gönderme, dışa aktarma, üst çubuk
    r = await ph.ask('output.list');
    check('output.list: ekranlar', r.ok && r.result.displays.length >= 1 && Array.isArray(r.result.open), r.ok && r.result.displays.length);
    r = await ph.ask('audio.sources');
    check('audio.sources: aygıt listesi', r.ok && Array.isArray(r.result.devices), r.ok && r.result.devices.length);
    r = await ph.ask('thumb.get', { kind: 'visualizer', type: 'bars' });
    check('thumb.get: mod küçük resmi', r.ok && r.result.data.length > 100, r.ok ? r.result.type : r);
    r = await ph.ask('export.start', { audio: 'yok' });
    check('export.start: şarkı gönderilmeden reddedilir', r.ok === false && r.error === 'no-song', r);
    r = await ph.ask('export.status');
    check('export.status', r.ok && r.result.running === false, r.ok);
    const upload = async (kind, name, buf) => {
      const b0 = await ph.ask('file.begin', { kind, name, size: buf.length });
      if (!b0.ok) return b0;
      for (let at = 0; at < buf.length; at += b0.result.chunk) {
        const c = await ph.ask('file.chunk', { id: b0.result.id, at, data: buf.subarray(at, at + b0.result.chunk).toString('base64') });
        if (!c.ok) return c;
      }
      return ph.ask('file.end', { id: b0.result.id, sha256: crypto.createHash('sha256').update(buf).digest('hex') });
    };
    const lrc = Buffer.from('[00:01.00]Telefondan gelen söz\n[00:04.00]İkinci satır\n', 'utf8');
    r = await upload('lyrics', 'telefon-sozu.lrc', lrc);
    check('dosya gönderme: söz kitaplığa eklendi', r.ok && r.result.kind === 'lyrics', r);
    r = await ph.ask('library.list', { kind: 'lyrics', q: 'telefon' });
    check('library.list: gönderilen söz listede', r.ok && r.result.total >= 1, r.ok && r.result.items);
    const milk = Buffer.from('[preset00]\nfRating=3\nzoom=1.01\nper_frame_1=wave_r = 0.5 + 0.5*sin(time);\n', 'utf8');
    r = await upload('milk', 'telefon preseti.milk', milk);
    check('dosya gönderme: MilkDrop preseti eklendi', r.ok && r.result.kind === 'milk', r);
    r = await upload('logo', 'kotu.exe', Buffer.from('MZ'));
    check('dosya gönderme: izinsiz uzantı reddedilir', r.ok === false && r.error === 'bad-type', r);
    r = await ph.ask('file.begin', { kind: 'video', name: 'buyuk.mp4', size: 2 * 1024 * 1024 * 1024 });
    check('dosya gönderme: çok büyük dosya reddedilir', r.ok === false && r.error === 'too-big', r);
    r = await ph.ask('milkdrop.load', { id: 'x"); alert(1); ("' });
    check('milkdrop.load: geçersiz kimlik reddedilir', r.ok === false && r.error === 'bad-args', r);
    const chipTxt = await pc.ev(`(() => { const b = document.getElementById('phoneChip'); return b && !b.hidden ? document.getElementById('phoneChipName').textContent : ''; })()`);
    check('üst çubukta "Telefon bağlı"', chipTxt.indexOf('Sınama Telefonu') >= 0, chipTxt);

    // ---- İki telefon (B7): ikisi de olayları alır, birinin boş efekt listesi ötekinin basılısını bırakmaz
    st = await pc.ev('window.api.phoneLinkNewCode()');
    const ph2 = phone(st.port || streamPort);
    await ph2.ready;
    await ph2.nextText();
    const me2 = Link.newIdentity();
    ph2.sendText({ t: 'pair', kind: 'code', v: 1, pub: Link.b64u(me2.pub), name: 'İkinci Telefon', model: 'probe2', proof: Link.b64u(Link.hmac(Buffer.from(st.pairing.code), 'sv-link-code|', me2.pub)) });
    const commit2 = await ph2.nextText();
    const np2 = crypto.randomBytes(16);
    ph2.sendText({ t: 'reveal', np: Link.b64u(np2) });
    const rev2 = await ph2.nextText();
    let ok2 = false;
    for (let i = 0; i < 20 && !ok2; i++) {
      await wait(150);
      ok2 = await pc.ev(`(() => { const b = [...document.querySelectorAll('.ask-panel button')].find((x) => x.textContent.trim() === window.SVI18n.t('Aynı, onayla')); if (!b) return false; b.click(); return true; })()`);
    }
    const paired2 = await ph2.nextText();
    check('ikinci telefon eşleşti', ok2 && paired2.t === 'paired', paired2.t);
    const pcPub2 = Link.unb64u(commit2.pub);
    ph2.keys(Link.sessionKeys(Link.deviceKey(Link.sharedSecret(me2, pcPub2), me2.pub, pcPub2, np2, Link.unb64u(rev2.nc)), np2, Link.unb64u(rev2.nc)));
    st = await pc.ev('window.api.phoneLinkStatus()');
    check('bilgisayarda iki telefon çevrimiçi', st.devices.filter((d) => d.online).length === 2, st.devices.map((d) => [d.name, d.online]));
    await ph2.ask('config.get');
    // Ayardaki etkin sahne (panelin vurgusu düzenlemeden sonra kalkar ama anahtar kalır)
    const activeNow2 = await P('c._activeSceneId || ""');
    const otherScene = scenes.find((id) => id !== activeNow2) || scenes[0];
    ph2.events.length = 0;
    r = await ph.ask('scene.apply', { id: otherScene });
    const seen2 = () => ph2.events.some((e) => e.ev === 'config' && e.patch && e.patch._activeSceneId === otherScene);
    for (let i = 0; i < 30 && !seen2(); i++) await wait(100);
    check('birinci telefonun sahnesi ikinciye ayar olayıyla geldi', r.ok && seen2(), { active: await P('c._activeSceneId'), want: otherScene, ev: ph2.events.filter((e) => e.ev === 'config').map((e) => [e.rev, Object.keys(e.patch).join(','), e.patch._activeSceneId]) });
    await ph.ask('momentary', { list: ['flash'] });
    await ph2.ask('momentary', { list: [] });
    check('ikinci telefonun boş listesi birincinin efektini bırakmadı', JSON.stringify(await P('window.SVLiveShell.heldList()')) === '["flash"]');
    await ph.ask('momentary', { list: [] });
    ph2.close();

    // ---- Anlık efekt kirası: yenilendikçe kalır, oturum kapanınca hemen kalkar
    const held = () => P('JSON.stringify(window.SVLiveShell.heldList())');
    const samples = [];
    for (let i = 0; i < 6; i++) {
      await ph.ask('momentary', { list: ['glitch'] });
      await wait(250);
      samples.push(await held());
      await wait(250);
      samples.push(await held());
    }
    check('kira yenilendikçe efekt kalıyor (3 sn)', samples.every((x) => x === '["glitch"]'), samples);
    ph.close();
    ph = null;
    let after = '';
    for (let i = 0; i < 10 && after !== '[]'; i++) { await wait(100); after = await held(); }
    check('telefon kopunca efekt hemen kalktı', after === '[]', after);
  } catch (e) {
    bad++;
    console.error('HATA', e && e.stack ? e.stack : e);
    console.error(log.slice(-3000));
  } finally {
    if (ph) ph.close();
    if (pc) pc.close();
    if (KEEP) console.log('Açık bırakıldı: CDP ' + cdpPort + ', profil ' + dir);
    else { killTree(child); await wait(500); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* kilitli kalabilir */ } }
  }
  console.log(bad ? 'SONUÇ: ' + bad + ' hata' : 'SONUÇ: hepsi geçti');
  process.exit(bad ? 1 : 0);
})();
