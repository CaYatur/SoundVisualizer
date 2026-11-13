/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* FAZ 0E ÖLÇÜM ARACI (docs/android/PLAN.md 0E4).

   Emülatörde ya da USB'li telefonda, uygulamanın geliştirme sürümü kuruluyken:

     node android/tools/probe.js caps
       WebGL yetenekleri ve sayfa başına WebGL bağlam sınırı (boş ölçüm sayfasında).

     node android/tools/probe.js templates [--only=<ad parçası>] [--wait=2500] [--out=<dosya.json>]
       83 yerleşik şablonun her birini değiştirilmemiş görselleştirici sayfasına
       uygular; hata, siyah ekran ve kare hızını yazar.

   Şablonlar önce sınıflanır: "çizmeli", "eksik varlık" (yerel dosya yolu, depoda
   olmayan dokular) ve "yalnız masaüstü" (Spout/Syphon girişi, web katmanı, ekran
   yakalama). Siyah ekran denetimi YALNIZ "çizmeli" grupta hata sayılır; öbür
   ikisi Android'le ilgisiz sebeplerle siyah kalabilir. */
const fs = require('node:fs');
const D = require('./lib/device');
const PNG = require('./lib/png');

const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = (k, d) => { const a = argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };

const CAPS = `(async () => {
  const out = { ua: navigator.userAgent, secure: isSecureContext, videoEncoder: typeof VideoEncoder, audioEncoder: typeof AudioEncoder,
    dpr: devicePixelRatio, screen: [screen.width, screen.height], cores: navigator.hardwareConcurrency, memory: navigator.deviceMemory || null };
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  if (!gl) return Object.assign(out, { webgl2: false });
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  out.webgl2 = true;
  out.renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  out.vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
  out.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  out.maxRenderbuffer = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
  out.maxDrawBuffers = gl.getParameter(gl.MAX_DRAW_BUFFERS);
  out.maxSamples = gl.getParameter(gl.MAX_SAMPLES);
  const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  out.fragmentHighp = hp ? hp.precision : 0;
  out.extensions = gl.getSupportedExtensions();
  // RGB10_A2 çerçeve tamponu (MilkDrop geri beslemesi bunu deniyor)
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB10_A2, 4, 4, 0, gl.RGBA, gl.UNSIGNED_INT_2_10_10_10_REV, null);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  out.rgb10a2Framebuffer = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.getExtension('WEBGL_lose_context') && gl.getExtension('WEBGL_lose_context').loseContext();
  // Bağlam sınırı: en eskisi kaybolana kadar yeni bağlam aç
  const made = [];
  out.contextLimit = null;
  for (let i = 0; i < 64; i++) {
    const k = document.createElement('canvas');
    k.width = k.height = 8;
    const g = k.getContext('webgl2');
    if (!g) { out.contextLimit = { nullAt: i }; break; }
    made.push(g);
    await new Promise((r) => setTimeout(r, 20));
    const lost = made.filter((x) => x.isContextLost()).length;
    if (lost) { out.contextLimit = { maxActive: made.length - lost, lostAfter: made.length }; break; }
  }
  if (!out.contextLimit) out.contextLimit = { maxActive: '>=64' };
  for (const g of made) { const e = g.getExtension('WEBGL_lose_context'); if (e && !g.isContextLost()) e.loseContext(); }
  if (typeof VideoEncoder !== 'undefined') {
    const enc = {};
    for (const [name, codec] of [['h264-high', 'avc1.640028'], ['h264-base', 'avc1.42E01F'], ['hevc', 'hvc1.1.6.L120.B0'], ['vp9', 'vp09.00.40.08'], ['av1', 'av01.0.08M.08']]) {
      for (const hw of ['prefer-hardware', 'prefer-software']) {
        try {
          const r = await VideoEncoder.isConfigSupported({ codec, width: 1920, height: 1080, bitrate: 12e6, framerate: 30, hardwareAcceleration: hw });
          enc[name + '/' + hw] = !!r.supported;
        } catch (e) { enc[name + '/' + hw] = 'error: ' + e.message; }
      }
    }
    out.videoEncoders = enc;
  }
  if (typeof AudioEncoder !== 'undefined') {
    const a = {};
    for (const [name, codec] of [['aac', 'mp4a.40.2'], ['opus', 'opus']]) {
      try { a[name] = !!(await AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 })).supported; }
      catch (e) { a[name] = 'error: ' + e.message; }
    }
    out.audioEncoders = a;
  }
  return out;
})()`;

/* Sayfada: şablon listesi ve her birinin sınıfı. */
const LIST = `(() => {
  const T = window.SVTemplates, S = window.SV;
  const env = { defaultConfig: S.defaultConfig, deepMerge: S.deepMerge, clone: S.clone };
  return T.TEMPLATES.map((t) => {
    const cfg = T.apply(S.clone(S.defaultConfig()), t, env);
    const j = JSON.stringify(cfg);
    let cls = 'render';
    if (/"kind":"(input|web)"/.test(j) || /"source":"screen"/.test(j)) cls = 'desktop-only';
    else if (/"source":"(file|camera)"/.test(j) && /"enabled":true/.test(j)) cls = 'missing-asset';
    return { id: t.id, name: t.name, group: t.group, cls };
  });
})()`;

const APPLY = (id) => `(() => {
  const T = window.SVTemplates, S = window.SV;
  const t = T.TEMPLATES.find((x) => x.id === ${JSON.stringify(id)});
  const next = T.apply(S.clone(S.defaultConfig()), t, { defaultConfig: S.defaultConfig, deepMerge: S.deepMerge, clone: S.clone });
  if (next.layerStack && next.layerStack.enabled && window.SVLayers.syncStackState) window.SVLayers.syncStackState(next);
  next.transition = Object.assign({}, next.transition, { enabled: false });
  window.__svHost.pushConfig(next);
  return true;
})()`;

const FPS = `new Promise((r) => { let n = 0; const t0 = performance.now(); (function f() { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(f); else r(Math.round(n / ((performance.now() - t0) / 1000))); })(); })`;

async function caps() {
  const pid = await D.launch('src/mobile/probe.html');
  const page = await D.connect(pid);
  try {
    const out = await page.evaluate(CAPS);
    out.android = { release: D.adb(['shell', 'getprop', 'ro.build.version.release']), sdk: D.adb(['shell', 'getprop', 'ro.build.version.sdk']), model: D.adb(['shell', 'getprop', 'ro.product.model']) };
    console.log(JSON.stringify(out, null, 1));
    if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(out, null, 1));
  } finally { page.close(); }
}

async function templates() {
  const pid = await D.launch();
  const page = await D.connect(pid);
  const wait = +arg('wait', 2500);
  const only = (arg('only', '') || '').toLowerCase();
  const results = [];
  try {
    for (let i = 0; i < 50 && !(await page.evaluate('!!(window.SVTemplates && window.SVLayers && window.__svHost)')); i++) await D.sleep(200);
    const list = (await page.evaluate(LIST)).filter((t) => !only || (t.id + ' ' + t.name).toLowerCase().includes(only));
    console.log(list.length + ' şablon');
    for (const t of list) {
      page.logs.length = 0;
      await page.evaluate(APPLY(t.id));
      await D.sleep(wait);
      const fps = await page.evaluate(FPS);
      const lum = PNG.luma(await page.screenshot(0.125));
      const errors = page.logs.filter((l) => /^(error|exception)/.test(l));
      const black = lum.lit < 0.01;
      const fail = errors.length > 0 || (black && t.cls === 'render');
      const r = { id: t.id, name: t.name, group: t.group, cls: t.cls, fps, luma: Math.round(lum.mean), lit: Math.round(lum.lit * 1000) / 1000, errors, fail };
      results.push(r);
      console.log((fail ? 'HATA ' : 'tamam') + ' ' + String(fps).padStart(3) + ' fps  ışık ' + r.lit.toFixed(3) + '  [' + t.cls + '] ' + t.name + (errors.length ? '\n      ' + errors.slice(0, 3).join('\n      ') : ''));
    }
  } finally { page.close(); }
  const sum = { total: results.length, fail: results.filter((r) => r.fail).length, byClass: {} };
  for (const r of results) sum.byClass[r.cls] = (sum.byClass[r.cls] || 0) + 1;
  console.log(JSON.stringify(sum));
  if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify({ when: new Date().toISOString(), summary: sum, results }, null, 1));
  if (sum.fail) process.exitCode = 1;
}

/* Sistem sesi / mikrofon / Visualizer: sınama yardımcısı (android/tonegen)
   110 Hz (sol) ve 3500 Hz (sağ) çalar; yakalanan karenin tayfında bu iki tepe
   aranır. `--mode=deny` yardımcıyı yakalamayı ENGELLEYEN bir uygulama gibi
   çaldırır: o zaman sessizlik beklenir. Sistem sesinde Android'in onay
   penceresindeki "Başlat" düğmesine (android:id/button1) dokunulur. */
const TONE = 'com.cayadev.visualizer.tonegen/.ToneActivity';

function tapConsent() {
  for (let i = 0; i < 25; i++) {
    try {
      D.adb(['shell', 'uiautomator', 'dump', '/sdcard/sv-ui.xml']);
      const xml = D.adb(['shell', 'cat', '/sdcard/sv-ui.xml']);
      const m = /resource-id="android:id\/button1"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(xml);
      if (m) {
        D.adb(['shell', 'input', 'tap', String((+m[1] + +m[3]) >> 1), String((+m[2] + +m[4]) >> 1)]);
        return true;
      }
    } catch { /* pencere henüz yok */ }
    execSleep(400);
  }
  return false;
}
function execSleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function peaks(freq) {
  const sorted = freq.slice(2, 1000).sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  const max = (a, b) => Math.max(...freq.slice(a, b));
  // 48 kHz / 2048 = 23,4 Hz/kutu: 110 Hz ≈ 4,7. kutu, 3500 Hz ≈ 149. kutu
  const avg = (a, b) => Math.round(freq.slice(a, b).reduce((x, y) => x + y, 0) / (b - a));
  return { median, low: max(3, 7), high: max(146, 153), level: Math.max(...freq), mid: avg(300, 400), near: [avg(10, 20), avg(170, 200)] };
}

async function audio() {
  const source = arg('source', 'capture');
  const mode = arg('mode', 'allow');
  const seconds = +arg('seconds', 12);
  const pid = await D.launch();
  const page = await D.connect(pid);
  const out = { source, mode };
  try {
    for (let i = 0; i < 50 && !(await page.evaluate('!!(window.__svHost && window.__svHost.state.hello)')); i++) await D.sleep(200);
    // --mode=none: hiçbir şey çalmaz (taban gürültüsü ölçümü)
    if (mode !== 'none') D.adb(['shell', 'am', 'start', '-n', TONE, '-e', 'mode', mode, '-e', 'seconds', String(seconds + 15)]);
    await D.sleep(1200);
    D.adb(['shell', 'am', 'start', '-n', D.PKG + '/.MainActivity']);
    await D.sleep(800);
    const started = page.evaluate(`window.__svHost.audioStart(${JSON.stringify(source)}).then((v) => ({ ok: true, v }), (e) => ({ ok: false, err: e.message }))`);
    // İzin penceresi (ilk kez) ve sistem sesi onayı
    if (source === 'capture') out.consentTapped = tapConsent();
    out.start = await started;
    await D.sleep(seconds * 1000);
    out.stats = await page.evaluate('window.__svHost.audioStats()');
    out.state = await page.evaluate('({ native: window.__svHost.state.nativeFrames, bad: window.__svHost.state.badBinary, status: window.__svHost.state.audioStatus })');
    const f = await page.evaluate('window.__svHost.peekFrame()');
    out.spectrum = f ? peaks(f.freq) : null;
    out.fps = out.stats ? Math.round(out.stats.frames / seconds) : 0;
    const sp = out.spectrum;
    out.heard = !!(sp && sp.low > sp.median + 60 && sp.high > sp.median + 60);
    out.silent = !sp || sp.level < 30;
    await page.evaluate('window.__svHost.audioStop()');
  } finally { page.close(); }
  D.adb(['shell', 'am', 'force-stop', 'com.cayadev.visualizer.tonegen']);
  console.log(JSON.stringify(out, null, 1));
  const want = mode === 'deny' ? out.silent : out.heard;
  if (!want) process.exitCode = 1;
}

const cmds = { caps, templates, audio };
if (!cmds[cmd]) {
  console.error('kullanım: node android/tools/probe.js caps|templates [--only=] [--wait=] [--out=]');
  process.exit(2);
}
cmds[cmd]().catch((e) => { console.error(e.message || e); process.exit(1); });
