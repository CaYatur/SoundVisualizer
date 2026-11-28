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
   ikisi Android'le ilgisiz sebeplerle siyah kalabilir.

     node android/tools/probe.js import [--settings=<settings.json>] [--presets=<klasör>]
       Masaüstü tam yedeğini (.svbackup) içe aktarma ve kalıcılık. Uygulamanın verisini siler.

     node android/tools/probe.js player
       Uygulama içi çalar: tayf, "şimdi çalıyor", bildirim, eşzamanlama, atlama.

     node android/tools/probe.js lifecycle
       Döndürme, WebGL bağlam kaybı, bellek baskısı ve pil durumu.

     node android/tools/probe.js profile
       Ayar dosyaları: kayıt, arka plana geçişte yazım, çizim süreci çökünce
       son ayarla geri gelme. Uygulamanın verisini siler. */
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
      // Tam çözünürlük: ince çizgili sahneler (Minimal Line, Clean Wave) seyrek örneklemede kaçıyordu
      const lum = PNG.luma(D.screencap(), 1);
      const errors = page.logs.filter((l) => /^(error|exception|browser-error)/.test(l));
      const evicted = page.logs.filter((l) => /Too many active WebGL contexts/i.test(l)).length;
      const gl = await page.evaluate('window.__svHost.glContexts ? window.__svHost.glContexts() : null');
      // 1080 piksellik tek bir 2 piksel çizgi ekranın ~%0,08'i; tamamen siyah ekranda 0
      const black = lum.lit < 0.0003;
      const fail = errors.length > 0 || evicted > 0 || (black && t.cls === 'render');
      const r = { id: t.id, name: t.name, group: t.group, cls: t.cls, fps, luma: Math.round(lum.mean), lit: Math.round(lum.lit * 1000) / 1000, glActive: gl ? gl.active : null, evicted, errors, fail };
      results.push(r);
      console.log((fail ? 'HATA ' : 'tamam') + ' ' + String(fps).padStart(3) + ' fps  ışık ' + r.lit.toFixed(3) + '  gl ' + r.glActive + (evicted ? ' (TAŞTI)' : '') + '  [' + t.cls + '] ' + t.name + (errors.length ? '\n      ' + errors.slice(0, 3).join('\n      ') : ''));
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
  /* Çalışma zamanı izinleri sınama cihazında önceden verilir: `pm clear` (profile
     komutu) onları geri alıyor ve izin penceresinde bekleyip kalınıyordu. */
  for (const p of ['RECORD_AUDIO', 'POST_NOTIFICATIONS']) {
    try { D.adb(['shell', 'pm', 'grant', D.PKG, 'android.permission.' + p]); } catch { /* eski sürümde yok */ }
  }
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
    // Sessizlik algılama (PHASE0 R3): engelleyen uygulamada düzenleyiciye haber gider
    out.silenceEvents = await page.evaluate('window.__svHost.state.silenceEvents');
    await page.evaluate('window.__svHost.audioStop()');
  } finally { page.close(); }
  D.adb(['shell', 'am', 'force-stop', 'com.cayadev.visualizer.tonegen']);
  console.log(JSON.stringify(out, null, 1));
  const want = mode === 'deny' ? out.silent && out.silenceEvents >= 1 : out.heard && out.silenceEvents === 0;
  if (!want) process.exitCode = 1;
}

/* Dışa aktarım (0E6): değiştirilmemiş dışa aktarım sayfasında bir şablon
   kare kare çizilir, I420 kareler ikili kanaldan uygulamaya gider, MediaCodec
   H.264'e kodlar, MediaMuxer şarkıyı (AAC, yeniden kodlamadan) ekler. MP4
   bilgisayara çekilir ve ffmpeg ile kare sayısı, ses izi ve görüntü denetlenir.
   --song: AAC .m4a (uygulamanın medya klasörüne kopyalanır). */
async function exportCmd() {
  const path = require('node:path');
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const song = arg('song');
  if (!song) throw new Error('--song=<.m4a> gerekli');
  const tpl = arg('template', 'fireworks');
  const width = +arg('width', 1280), height = +arg('height', 720), fps = +arg('fps', 30), seconds = +arg('seconds', 10);
  const name = path.basename(song);
  D.adb(['push', song, '/data/local/tmp/' + name]);
  // adb shell bağımsız değişkenleri tek satırda birleştiriyor: komut tek dizgi olmalı
  D.adb(['shell', `run-as ${D.PKG} sh -c 'mkdir -p files/media && cp /data/local/tmp/${name} files/media/${name}'`]);
  const pid = await D.launch('src/exporter/index.html');
  const page = await D.connect(pid);
  let st;
  try {
    for (let i = 0; i < 50 && !(await page.evaluate('!!(window.__svHost && window.exp && window.SVTemplates && window.SV)')); i++) await D.sleep(200);
    await page.evaluate(`(async () => {
      const T = window.SVTemplates, S = window.SV;
      const t = T.TEMPLATES.find((x) => x.id === ${JSON.stringify(tpl)} || x.name.toLowerCase() === ${JSON.stringify(tpl)});
      const cfg = T.apply(S.clone(S.defaultConfig()), t, { defaultConfig: S.defaultConfig, deepMerge: S.deepMerge, clone: S.clone });
      const audioBuffer = await (await fetch('/files/${name}')).arrayBuffer();
      window.__svHost.runExport({ cfg, width: ${width}, height: ${height}, fps: ${fps}, pix: 'yuv420p', durationSec: ${seconds},
        audioBuffer, audioName: ${JSON.stringify(name)}, outputName: 'probe-export.mp4', platform: 'android', profile: true });
      return true;
    })()`);
    const t0 = Date.now();
    for (;;) {
      st = await page.evaluate('window.__svHost.exportState()');
      if (st.result || st.error) break;
      if (Date.now() - t0 > 600000) throw new Error('zaman aşımı');
      await D.sleep(1000);
    }
  } finally { page.close(); }
  const out = { template: tpl, size: width + 'x' + height, fps, seconds, sent: st.sent, acked: st.acked, error: st.error, result: st.result };
  if (st.result) {
    const local = path.join(os.tmpdir(), 'sv-probe-export.mp4');
    D.adb(['pull', st.result.path, local]);
    const FF = require(path.join(__dirname, '..', '..', 'node_modules', 'ffmpeg-static'));
    let info = '';
    try { execFileSync(FF, ['-hide_banner', '-i', local], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { info = String(e.stderr || ''); }
    out.streams = info.split('\n').filter((l) => /Stream #|Duration/.test(l)).map((l) => l.trim());
    const count = execFileSync(FF, ['-hide_banner', '-v', 'error', '-i', local, '-map', '0:v:0', '-f', 'null', '-', '-progress', 'pipe:1'], { encoding: 'utf8' });
    const frames = /frame=(\d+)/g; let m, last = 0; while ((m = frames.exec(count))) last = +m[1];
    out.decodedFrames = last;
    const png = execFileSync(FF, ['-hide_banner', '-v', 'error', '-ss', String(seconds / 2), '-i', local, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], { maxBuffer: 64 * 1024 * 1024 });
    out.midFrameLit = Math.round(PNG.luma(png, 4).lit * 1000) / 1000;
    out.realtimeFactor = Math.round((seconds * 1000 / st.result.totalMs) * 100) / 100;
    out.local = local;
  }
  console.log(JSON.stringify(out, null, 1));
  if (!st.result || out.decodedFrames !== Math.ceil(seconds * fps)) process.exitCode = 1;
}

/* Yüzen pencere ve PiP (0E7). Asıl sınav: yüzen pencere açıkken sistemin
   Activity'yi kapatması. "Etkinlikleri tutma" (always_finish_activities) açılır,
   motor yüzen pencereye taşınıp uygulama arkaya alınır: Activity kapanır, motor
   (aynı WebView, aynı sayfa) çizmeye devam etmeli ve WebGL bağlamı kaybolmamalı.
   Uygulama yeniden açılınca aynı motor tam ekrana dönmeli. Sonra sistem PiP'i. */
async function floating() {
  const out = {};
  const RAF = '(() => { if (!window.__raf) { window.__raf = { n: 0 }; (function f() { window.__raf.n++; requestAnimationFrame(f); })(); } return window.__raf.n; })()';
  const snap = async (page) => page.evaluate('({ marker: window.__marker, raf: ' + RAF + ', gl: window.__svHost.glContexts(), audio: window.__svHost.state.audioFrames })');
  /* dumpsys görev kaydında Activity'nin adı kapandıktan sonra da duruyor; doğru bilgi
     uygulamada: EngineHost.activity (floatingState.activity). */
  const activityAlive = async (page) => (await page.evaluate('window.__svHost.request("floatingState")')).activity;
  D.adb(['shell', 'appops', 'set', D.PKG, 'SYSTEM_ALERT_WINDOW', 'allow']);
  D.adb(['shell', 'settings', 'put', 'global', 'always_finish_activities', '1']);
  try {
    const pid = await D.launch();
    const page = await D.connect(pid);
    try {
      for (let i = 0; i < 50 && !(await page.evaluate('!!(window.__svHost && window.__svHost.state.hello)')); i++) await D.sleep(200);
      await page.evaluate('window.__marker = Math.random(); 1');
      await D.sleep(1500);
      out.full = await snap(page);
      out.open = await page.evaluate('window.__svHost.request("floatingOpen", { width: 540, height: 304 })');
      await D.sleep(2500);
      // Sistemin arka plandaki Activity'yi kapatması (adb'den yazılan "Etkinlikleri tutma" bu
      // emülatörde etkili olmadı): aynı onDestroy yolu, geliştirme isteğiyle
      out.finish = await page.evaluate('window.__svHost.request("debugFinishActivity")');
      await D.sleep(1500);
      out.activityAfterOpen = await activityAlive(page);
      const a = await snap(page);
      await D.sleep(2000);
      const b = await snap(page);
      out.floating = { sameEngine: b.marker === out.full.marker, rafPerSec: Math.round((b.raf - a.raf) / 2), audioPerSec: Math.round((b.audio - a.audio) / 2), glLost: b.gl.lost - out.full.gl.lost, glActive: b.gl.active };
      out.floatLit = Math.round(PNG.luma(D.screencap(), 4).lit * 1000) / 1000;
      // Uygulamaya dön: aynı motor tam ekrana geçmeli
      D.adb(['shell', 'am', 'start', '-n', D.PKG + '/.MainActivity']);
      await D.sleep(2500);
      const c = await snap(page);
      await D.sleep(2000);
      const d = await snap(page);
      out.back = { sameEngine: d.marker === out.full.marker, rafPerSec: Math.round((d.raf - c.raf) / 2), glLost: d.gl.lost - out.full.gl.lost, floatingShowing: (await page.evaluate('window.__svHost.request("floatingState")')).showing, activity: await activityAlive(page) };
      // Sistem PiP'i
      D.adb(['shell', 'settings', 'put', 'global', 'always_finish_activities', '0']);
      out.pip = await page.evaluate('window.__svHost.request("pipEnter", { w: 16, h: 9 })');
      await D.sleep(2500);
      const e = await snap(page);
      await D.sleep(2000);
      const g = await snap(page);
      out.pipRun = { rafPerSec: Math.round((g.raf - e.raf) / 2), audioPerSec: Math.round((g.audio - e.audio) / 2), glLost: g.gl.lost - out.full.gl.lost, pinned: /mWindowingMode=pinned|windowingMode=pinned/.test(D.adb(['shell', 'dumpsys', 'activity', 'activities'])) };
      out.pipLit = Math.round(PNG.luma(D.screencap(), 4).lit * 1000) / 1000;
    } finally { page.close(); }
  } finally {
    D.adb(['shell', 'settings', 'put', 'global', 'always_finish_activities', '0']);
  }
  console.log(JSON.stringify(out, null, 1));
  const ok = out.floating.sameEngine && out.floating.rafPerSec > 20 && out.floating.glLost === 0 && !out.activityAfterOpen
    && out.back.sameEngine && out.back.rafPerSec > 20 && !out.back.floatingShowing && out.pipRun.rafPerSec > 10;
  if (!ok) process.exitCode = 1;
}

/* AYAR DOSYALARI (PLAN 2.2, 2.4). Kayıt profil klasörüne masaüstü düzeninde
   gidiyor mu; uygulama arka plana geçince bekleyen kayıt hemen yazılıyor mu;
   WebView'in çizim süreci çökünce sayfa son kaydedilen ayarla geri geliyor mu.
   Uygulamanın verisi baştan silinir: yalnız sınama cihazında koşun. */
async function profileCmd() {
  const out = {};
  // Kopan CDP bağlantısında bekleyen söz olay döngüsünü boşaltır: yarım sonucu yine yaz
  const partial = () => { if (!out.done) { console.log(JSON.stringify(out, null, 1)); console.error('yarım kaldı'); process.exitCode = 1; } };
  process.on('exit', partial);
  const cat = (n) => { try { return D.adb(['shell', 'run-as ' + D.PKG + ' cat files/profile/' + n]); } catch { return null; } };
  const ready = async (page) => { for (let i = 0; i < 50 && !(await page.evaluate('!!(window.__svHost && window.__svHost.state.hello)')); i++) await D.sleep(200); };
  D.adb(['shell', 'pm', 'clear', D.PKG]);
  const pid = await D.launch();
  let page = await D.connect(pid);
  const marker = 'p' + Date.now();
  try {
    await ready(page);
    // İlk açılış masaüstünün yeni kurulumu gibi: varsayılanlar ve katman yığını; dosya ilk değişiklikte yazılır
    out.first = await page.evaluate('window.api.requestConfig().then((c) => ({ cfg: c ? { layers: (c.layers || []).length, stack: !!(c.layerStack && c.layerStack.enabled), hasVis: !!c.visualizer } : null, st: window.__svHost.profileState() }))');
    // Klasör henüz yoksa ls hata verir: dosya da yok demektir
    out.firstFiles = (() => { try { return D.adb(['shell', 'run-as', D.PKG, 'ls', 'files/profile']); } catch (e) { return ''; } })().split(/\s+/).filter(Boolean);
    // Masaüstündeki gibi tam bir yapılandırma ve bir sahne
    out.saved = await page.evaluate(`(async () => {
      const c = window.SV.deepMerge(window.SV.defaultConfig(), {});
      c.probeMarker = ${JSON.stringify(marker)};
      c.scenes = [{ id: 'probe', name: 'Probe', data: {} }];
      window.__svHost.saveConfig(c);
      await window.__svHost.flushConfig();
      return window.__svHost.profileState();
    })()`);
    const settings = cat('settings.json');
    out.files = {
      settingsMarker: !!settings && JSON.parse(settings).probeMarker === marker,
      settingsHasScenes: !!settings && 'scenes' in JSON.parse(settings),
      scenes: cat('scenes.json'),
    };
    // Bekleyen kayıt + ana ekran: Activity.onPause → "flush"
    out.pendingBeforeHome = await page.evaluate(`(window.__svHost.savePatch({ probeHome: ${JSON.stringify(marker)} }), window.__svHost.profileState().pending)`);
    D.adb(['shell', 'input', 'keyevent', 'KEYCODE_HOME']);
    await D.sleep(1200);
    out.afterHome = await page.evaluate('({ flushEvents: window.__svHost.state.flushEvents, st: window.__svHost.profileState() })');
    out.files.homeMarker = (JSON.parse(cat('settings.json') || '{}').probeHome) === marker;
    D.adb(['shell', 'am', 'start', '-n', D.PKG + '/.MainActivity']);
    await D.sleep(1500);
    // Çizim süreci çöker: uygulama yaşamalı, sayfa yeniden kurulmalı, ayar diskten gelmeli
    await page.evaluate('window.__crashMarker = 1; 1');
    // Yanıt beklenmez: çöken sayfa yanıt vermiyor, bağlantı kopuyor
    const deadId = page.id;
    page.call('Page.crash').catch(() => {});
    await D.sleep(500);
    page.close();
    await D.sleep(3000);
    out.crash = { appPidSame: D.pidOf() === pid };
    page = await D.connect(pid, deadId);
    await ready(page);
    out.crash.after = await page.evaluate(`window.api.requestConfig().then((c) => ({
      newPage: !window.__crashMarker,
      marker: c && c.probeMarker, home: c && c.probeHome, scenes: c && Array.isArray(c.scenes) ? c.scenes.length : null,
      st: window.__svHost.profileState() }))`);
  } finally { page.close(); }
  out.done = true;
  process.off('exit', partial);
  console.log(JSON.stringify(out, null, 1));
  const a = out.crash.after || {};
  const ok = out.first.cfg && out.first.cfg.layers === 2 && out.first.cfg.stack && out.first.cfg.hasVis && out.first.st.fresh === true
    && out.firstFiles.indexOf('settings.json') < 0 && out.first.st.loaded && out.saved.saver && out.saved.saver.writes >= 1
    && out.files.settingsMarker && !out.files.settingsHasScenes && /"probe"/.test(out.files.scenes || '')
    && out.pendingBeforeHome && out.afterHome.flushEvents >= 1 && out.files.homeMarker
    && out.crash.appPidSame && a.newPage && a.marker === marker && a.home === marker && a.scenes === 1;
  if (!ok) process.exitCode = 1;
}

/* YAŞAM DÖNGÜSÜ (PLAN 2.4). Döndürmede motor yeniden kurulmuyor mu (aynı sayfa,
   kaybolan bağlam yok); WebGL bağlamı düşürülünce sahne kendini kuruyor mu (#594);
   bellek baskısı ve pil durumu sayfaya geliyor mu. Ekran yönü ve pil durumu iş
   bitince — hata olsa da — geri alınır. */
async function lifecycleCmd() {
  const out = {};
  const lit = () => Math.round(PNG.luma(D.screencap(), 4).lit * 1000) / 1000;
  const pid = await D.launch();
  const page = await D.connect(pid);
  try {
    for (let i = 0; i < 50 && !(await page.evaluate('!!(window.__svHost && window.__svHost.state.hello)')); i++) await D.sleep(200);
    await page.evaluate('window.__marker = 1; 1');
    await D.sleep(2500);
    const snap = async () => page.evaluate('({ size: [innerWidth, innerHeight], same: window.__marker === 1, gl: window.__svHost.glContexts() })');
    out.before = await snap();
    out.before.lit = lit();
    // Döndürme: Activity yeniden kurulmaz (configChanges), sayfa yalnız boyut değiştirir
    try {
      D.adb(['shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0']);
      D.adb(['shell', 'settings', 'put', 'system', 'user_rotation', '1']);
      await D.sleep(3000);
      out.rotated = await snap();
      out.rotated.lit = lit();
      out.rotated.samePid = D.pidOf() === pid;
    } finally {
      D.adb(['shell', 'settings', 'put', 'system', 'user_rotation', '0']);
    }
    await D.sleep(2500);
    out.back = await snap();
    // Bağlam kaybı: belgede duran her WebGL tuvali düşürülür; motor yeniden kurmalı
    out.loss = await page.evaluate(`(() => {
      let n = 0;
      for (const c of document.querySelectorAll('canvas')) {
        const g = c.getContext('webgl2') || c.getContext('webgl');
        const x = g && g.getExtension('WEBGL_lose_context');
        if (x && !g.isContextLost()) { x.loseContext(); n++; }
      }
      return { dropped: n, gl: window.__svHost.glContexts() };
    })()`);
    await D.sleep(5000);
    out.revived = await page.evaluate('window.__svHost.glContexts()');
    out.revived.lit = lit();
    // Bellek baskısı (onTrimMemory → memoryPressure → kayıt)
    D.adb(['shell', 'am', 'send-trim-memory', D.PKG, 'RUNNING_CRITICAL']);
    await D.sleep(1000);
    out.memory = await page.evaluate('window.__svHost.state.memoryPressure');
    if (!out.memory) {
      D.adb(['shell', 'am', 'send-trim-memory', D.PKG, 'HIDDEN']);
      await D.sleep(1000);
      out.memory = await page.evaluate('window.__svHost.state.memoryPressure');
    }
    // Pil: şarj kablosu çıkarılmış gibi
    try {
      out.power0 = await page.evaluate('window.api.getPowerSource()');
      D.adb(['shell', 'dumpsys', 'battery', 'unplug']);
      await D.sleep(1500);
      out.power1 = await page.evaluate('window.api.getPowerSource()');
    } finally {
      D.adb(['shell', 'dumpsys', 'battery', 'reset']);
    }
    await D.sleep(1500);
    out.power2 = await page.evaluate('window.api.getPowerSource()');
    out.budget = await page.evaluate('window.SVAndroid.gl()');
    out.logs = page.logs.filter((l) => /exception|error/i.test(l)).slice(0, 5);
  } finally { page.close(); }
  console.log(JSON.stringify(out, null, 1));
  const r = out.rotated;
  const ok = r.same && r.samePid && r.size[0] > r.size[1] && r.gl.lost === out.before.gl.lost && r.lit > 0.05
    && out.back.same && out.back.size[0] < out.back.size[1]
    && out.loss.dropped >= 1 && out.revived.created > out.loss.gl.created && out.revived.lit > 0.05
    && !!out.memory && out.power0.onBattery === false && out.power1.onBattery === true && out.power2.onBattery === false;
  if (!ok) process.exitCode = 1;
}

/* UYGULAMA İÇİ ÇALAR (PLAN 2.3). ffmpeg ile 20 sn'lik bir deneme şarkısı üretilir
   (solda 110 Hz, sağda 3500 Hz; başlık ve sanatçı etiketli) ve uygulamanın medya
   klasörüne konur. Çalınca tayfta iki tepe, "şimdi çalıyor"da etiketler, medya
   bildirimi ve oynatma konumuna göre bırakılan ses (gecikme) denetlenir; sonra
   duraklatma, ileri sarma ve "tek kaynak" (mikrofon başlayınca çalar durur). */
async function playerCmd() {
  const path = require('node:path');
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const FF = require(path.join(__dirname, '..', '..', 'node_modules', 'ffmpeg-static'));
  const name = 'sv-probe-tone.m4a';
  const local = path.join(os.tmpdir(), name);
  execFileSync(FF, ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=110:duration=20:sample_rate=48000',
    '-f', 'lavfi', '-i', 'sine=frequency=3500:duration=20:sample_rate=48000', '-filter_complex', '[0][1]amerge=inputs=2',
    '-ac', '2', '-c:a', 'aac', '-b:a', '160k', '-metadata', 'title=Probe Tone', '-metadata', 'artist=CaYaDev', local]);
  D.adb(['push', local, '/data/local/tmp/' + name]);
  D.adb(['shell', `run-as ${D.PKG} sh -c 'mkdir -p files/media && cp /data/local/tmp/${name} files/media/${name}'`]);
  for (const p of ['RECORD_AUDIO', 'POST_NOTIFICATIONS']) {
    try { D.adb(['shell', 'pm', 'grant', D.PKG, 'android.permission.' + p]); } catch { /* eski sürüm */ }
  }
  const out = {};
  const pid = await D.launch();
  const page = await D.connect(pid);
  try {
    for (let i = 0; i < 50 && !(await page.evaluate('!!(window.__svHost && window.__svHost.state.hello)')); i++) await D.sleep(200);
    out.open = await page.evaluate(`window.SVAndroid.player.open(${JSON.stringify(name)}, true).then((v) => ({ ok: true, title: v.title }), (e) => ({ ok: false, err: e.message }))`);
    await D.sleep(2000);
    const a = await page.evaluate('window.__svHost.state.nativeFrames');
    await D.sleep(4000);
    const b = await page.evaluate('window.__svHost.state.nativeFrames');
    out.fps = Math.round((b - a) / 4);
    const f = await page.evaluate('window.__svHost.peekFrame()');
    out.spectrum = f ? peaks(f.freq) : null;
    const sp = out.spectrum;
    out.heard = !!(sp && sp.low > sp.median + 60 && sp.high > sp.median + 60);
    out.nowPlaying = await page.evaluate('window.api.nowPlayingCurrent().then((n) => n && { has: n.has, playing: n.playing, title: n.title, artist: n.artist, position: Math.round(n.position), duration: Math.round(n.duration) })');
    out.status = await page.evaluate('window.__svHost.state.audioStatus');
    out.stats = await page.evaluate('window.__svHost.playerStats()');
    /* Medya bildirimi: çalar servisi ön planda, türü mediaPlayback (0x2) ve
       bildirimi sistemde kayıtlı. */
    const svc = D.adb(['shell', 'dumpsys', 'activity', 'services', D.PKG]);
    const fg = /PlayerService[\s\S]*?isForeground=true foregroundId=(\d+) types=0x0*2\b/.exec(svc);
    out.notification = !!fg && D.adb(['shell', 'dumpsys', 'notification', '--noredact']).includes(`key=0|${D.PKG}|${fg[1]}|`);
    // Duraklat: kareler durur
    await page.evaluate('window.SVAndroid.player.pause()');
    await D.sleep(800);
    const c = await page.evaluate('window.__svHost.state.nativeFrames');
    await D.sleep(1500);
    out.pausedFrames = (await page.evaluate('window.__svHost.state.nativeFrames')) - c;
    // İleri sar ve çal: konum 15 sn civarı
    await page.evaluate('window.SVAndroid.player.seek(15000)');
    await page.evaluate('window.SVAndroid.player.play()');
    await D.sleep(1500);
    out.afterSeek = await page.evaluate('window.__svHost.request("playerState").then((s) => ({ playing: s.playing, position: s.position }))');
    out.seekStats = await page.evaluate('window.__svHost.playerStats()');
    // Tek kaynak: mikrofon başlayınca çalar duraklar
    out.mic = await page.evaluate('window.SVAndroid.audio.start("mic").then((v) => v.source, (e) => "err:" + e.message)');
    await D.sleep(1200);
    out.afterMic = await page.evaluate('window.__svHost.request("playerState").then((s) => s.playing)');
    await page.evaluate('window.SVAndroid.audio.stop()');
    await page.evaluate('window.SVAndroid.player.stop()');
  } finally { page.close(); }
  console.log(JSON.stringify(out, null, 1));
  const ok = out.open.ok && out.heard && out.fps >= 80 && out.nowPlaying && out.nowPlaying.title === 'Probe Tone' && out.nowPlaying.artist === 'CaYaDev'
    && out.nowPlaying.duration === 20 && out.status && out.status.source === 'player' && Math.abs(out.stats.lagMs) <= 25
    && out.pausedFrames === 0 && out.afterSeek.playing && out.afterSeek.position >= 15000 && out.afterSeek.position < 18000
    && out.mic === 'mic' && out.afterMic === false && out.notification;
  if (!ok) process.exitCode = 1;
}

/* İÇE AKTARMA (PLAN 2.2). Masaüstünün GERÇEK yedek yazıcısıyla (src/main/full-backup.js)
   bir .svbackup üretilir: ayarlar, iki sahne, bir MilkDrop ve bir Studio preseti, bir
   doku. Uygulamanın medya klasörüne konur ve içe aktarılır; sonra uygulama yeniden
   açılınca ayar ve presetlerin kalıcı olduğu denetlenir. --settings=<settings.json>
   verilirse ayar olarak o dosya (yanındaki scenes.json ve library.json ile) kullanılır.
   Uygulamanın verisini siler. */
async function importCmd() {
  const path = require('node:path');
  const os = require('node:os');
  const FB = require(path.join(__dirname, '..', '..', 'src', 'main', 'full-backup.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-probe-import-'));
  const given = arg('settings');
  let settings;
  if (given) {
    const PS = require(path.join(__dirname, '..', '..', 'src', 'mobile', 'profile-store.js'));
    const texts = {};
    for (const n of PS.FILES) { try { texts[n] = fs.readFileSync(path.join(path.dirname(given), n), 'utf8'); } catch { texts[n] = null; } }
    texts['settings.json'] = fs.readFileSync(given, 'utf8');
    settings = PS.load(texts).cfg;
  } else {
    settings = { docVersion: 4, ui: { theme: 'neon' }, probeImport: 'yes', scenes: [{ id: 'sc_a', name: 'Bir', data: {} }, { id: 'sc_b', name: 'İki', data: {} }] };
  }
  const tex = path.join(dir, 'noise.png');
  fs.writeFileSync(tex, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const presets = [
    { id: 'ps_probe_md', kind: 'milkdrop', name: 'Probe MD', source: '[preset00]\nfRating=4.000000\nzoom=1.01\n', updatedAt: 2 },
    { id: 'ps_probe_sh', kind: 'shader', name: 'Probe Shader', code: 'void main(){}', updatedAt: 1 },
  ];
  /* --presets=<klasör>: masaüstünün preset klasörü (yalnız okunur) da yedeğe girer;
     gerçek ölçekte süre ölçümü için. */
  const presetDir = arg('presets');
  const eachPreset = async (fn) => {
    for (const p of presets) await fn(p);
    if (!presetDir) return;
    for (const n of fs.readdirSync(presetDir)) {
      if (!n.endsWith('.json')) continue;
      let p = null;
      try { p = JSON.parse(fs.readFileSync(path.join(presetDir, n), 'utf8')); } catch { continue; }
      await fn(p);
    }
  };
  /* Kitaplıklar (Faz 4): söz, logo ve video; sahnede kitaplıktaki videoyu oynatan bir
     medya katmanı. Telefonda video yeni adrese eşlenmeli, söz kitaplığa, logo motora gelmeli. */
  const libDir = (k) => { const d = path.join(dir, 'lib-' + k); fs.mkdirSync(d, { recursive: true }); return d; };
  const lyrDir = libDir('lyrics');
  fs.writeFileSync(path.join(lyrDir, 'lyr_probe.lrc'), '[00:01.00]Probe satırı');
  const logoDir = libDir('logos');
  fs.writeFileSync(path.join(logoDir, 'img_probe.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const vidDir = libDir('media');
  fs.writeFileSync(path.join(vidDir, 'vid_probe.mp4'), Buffer.alloc(2048, 7));
  const MU = require(path.join(__dirname, '..', '..', 'src', 'shared', 'media-url.js'));
  if (!given) {
    settings.layers = [{ id: 'ly_vid', kind: 'media', name: 'Klip', settings: { media: { enabled: true, source: 'file', file: MU.toMediaUrl(path.join(vidDir, 'vid_probe.mp4')), libraryId: 'vid_probe' } } }];
  }
  const libraries = [
    { key: 'lyrics', dir: lyrDir, items: [{ id: 'lyr_probe', file: 'lyr_probe.lrc', name: 'CaYaDev - Probe', artist: 'CaYaDev', title: 'Probe', size: 22 }] },
    { key: 'logos', dir: logoDir, items: [{ id: 'img_probe', file: 'img_probe.png', name: 'Probe Logo', mime: 'image/png', kind: 'image' }] },
    { key: 'media', dir: vidDir, items: [{ id: 'vid_probe', file: 'vid_probe.mp4', name: 'Probe Video', mime: 'video/mp4', kind: 'video' }] },
  ];
  const file = path.join(dir, 'probe.svbackup');
  await FB.writeBackup(file, { appVersion: '4.0.0', platform: 'win32', settings, eachPreset, textures: [{ name: 'noise.png', file: tex }], libraries, includeVideos: true });
  const name = 'probe.svbackup';
  D.adb(['shell', 'pm', 'clear', D.PKG]);
  D.adb(['push', file, '/data/local/tmp/' + name]);
  D.adb(['shell', `run-as ${D.PKG} sh -c 'mkdir -p files/media && cp /data/local/tmp/${name} files/media/${name}'`]);
  D.adb(['shell', 'rm', '/data/local/tmp/' + name]);
  const out = { backupMB: Math.round(fs.statSync(file).size / 1e5) / 10 };
  fs.rmSync(dir, { recursive: true, force: true });
  const ready = async (page) => { for (let i = 0; i < 50 && !(await page.evaluate('!!(window.__svHost && window.__svHost.state.hello)')); i++) await D.sleep(200); };
  let pid = await D.launch();
  let page = await D.connect(pid);
  try {
    await ready(page);
    // Önce kullanıcının "telefondaki" ayarı: içe aktarma bunu kenara almalı
    await page.evaluate(`(async () => { await window.api.requestConfig(); window.__svHost.saveConfig({ ui: { theme: 'cayadev' }, phoneOnly: true, scenes: [{ id: 'phone' }] }); await window.__svHost.flushConfig(); return 1; })()`);
    out.result = await page.evaluate(`(async () => {
      const t = performance.now();
      const r = await window.SVAndroid.importProfile({ media: ${JSON.stringify(name)} }).then((v) => v, (e) => ({ error: e.message }));
      r.ms = Math.round(performance.now() - t);
      return r;
    })()`);
    out.applied = await page.evaluate('(() => { const c = window.SVAndroid.config.get(); return { theme: c.ui && c.ui.theme, scenes: (c.scenes || []).length, phoneOnly: !!c.phoneOnly }; })()');
    out.libs = await page.evaluate(`(async () => {
      const c = window.SVAndroid.config.get();
      const vid = (c.layers || []).find((l) => l && l.id === 'ly_vid');
      const lyr = await window.SVAndroid.lyrics.list();
      const logo = await window.api.logoLibRead('img_probe');
      const logos = await window.SVAndroid.libraries.list('logos');
      const media = await window.SVAndroid.libraries.list('media');
      return { video: vid && vid.settings.media.file, lyrics: lyr.map((x) => x.id + ':' + x.artist), logo: logo && logo.mime, logoB64: logo && logo.b64 && logo.b64.length,
        logos: logos.map((x) => x.id), media: media.map((x) => x.id), engineLyrics: ((window.SVLyricsLib || {}).items || []).length };
    })()`);
    const ls = D.adb(['shell', `run-as ${D.PKG} ls files/profile files/profile/presets`]);
    out.files = ls.split(/\s+/).filter((x) => /\.json$/.test(x)).sort();
  } finally { page.close(); }
  // Yeniden aç: ayar ve presetler kalıcı mı, motor presetleri görüyor mu
  pid = await D.launch();
  page = await D.connect(pid);
  try {
    await ready(page);
    out.reopen = await page.evaluate(`(async () => {
      const c = await window.api.requestConfig();
      const t = performance.now();
      const list = await window.api.getPresets();
      const listMs = Math.round(performance.now() - t);
      const md = list.find((p) => p.id === 'ps_probe_md');
      const src = await window.api.milkdropPresetSource('ps_probe_md');
      return { theme: c && c.ui && c.ui.theme, scenes: c && c.scenes ? c.scenes.length : 0,
        count: list.length, listMs, listKB: Math.round(JSON.stringify(list).length / 1024),
        presets: list.length > 50 ? list.slice(0, 2).map((p) => p.id) : list.map((p) => p.id),
        mdLazy: md && md.lazy, mdRating: md && md.fRating, mdHasSource: md ? 'source' in md : null, source: src.slice(0, 20),
        head: await window.api.presetsHead(), traversal: await window.api.milkdropPresetSource('../settings'),
        textures: (await window.api.milkdropTextures()).names, texture: ((await window.api.milkdropTexture('noise.png')) || {}).dataUrl || '',
        texTraversal: await window.api.milkdropTexture('../profile/settings.json'), textureRev: (c.milkdropLibrary || {}).textureRev || 0 };
    })()`);
  } finally { page.close(); }
  console.log(JSON.stringify(out, null, 1));
  const r = out.result || {};
  const o = out.reopen || {};
  const want = given ? true : (out.applied.theme === 'neon' && out.applied.scenes === 2 && !out.applied.phoneOnly && o.theme === 'neon' && o.scenes === 2);
  const L = out.libs || {};
  const libsOk = given ? true : (L.video === 'https://appassets.androidplatform.net/files/lib-media/vid_probe.mp4' && L.lyrics.join() === 'lyr_probe:CaYaDev'
    && L.logo === 'image/png' && L.logoB64 > 0 && L.logos.join() === 'img_probe' && L.media.join() === 'vid_probe'
    && r.libraries && r.libraries.lyrics === 1 && r.libraries.logos === 1 && r.libraries.videos === 1);
  const ok = libsOk && !r.error && r.kind === 'svbackup' && (presetDir ? r.presets > 2 : r.presets === 2) && r.textures === 1 && o.textures.join() === 'noise.png' && o.texture.startsWith('data:image/png;base64,') && o.texTraversal === null && o.textureRev >= 1 && want
    && out.files.includes('settings.before-import.json') && out.files.includes('scenes.before-import.json')
    && (presetDir ? o.count >= r.presets - r.skipped : o.presets.join() === 'ps_probe_md,ps_probe_sh') && o.mdLazy === true && o.mdRating === 4 && o.mdHasSource === false
    && o.source.startsWith('[preset00]') && o.traversal === '';
  if (!ok) process.exitCode = 1;
}

/* MOBİL ARAYÜZ KABUĞU (Faz 3.2). Kabuk kuruluyor mu; her düğme en az 48 dp mi;
   sekmeler açılıyor mu; geri tuşu önce sayfayı kapatıp sonra uygulamayı arkaya
   alıyor mu (süreç ve motor yaşıyor); tema, tam ekran, yüzen pencere ve kenar
   boşlukları. Ekran görüntüleri --shots=<klasör> verilirse oraya yazılır. */
async function shellCmd() {
  const path = require('node:path');
  const shots = arg('shots');
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const shot = (name) => { if (shots) fs.writeFileSync(path.join(shots, name + '.png'), D.screencap()); };
  const out = {};
  D.adb(['shell', 'appops', 'set', D.PKG, 'SYSTEM_ALERT_WINDOW', 'allow']);
  const pid = await D.launch();
  const page = await D.connect(pid);
  try {
    for (let i = 0; i < 50 && !(await page.evaluate('!!(window.SVShell && document.getElementById("sv-shell"))')); i++) await D.sleep(200);
    await D.sleep(1500);
    const small = `(() => Array.from(document.querySelectorAll('#sv-shell button, #sv-shell a')).filter((b) => b.offsetParent !== null)
      .map((b) => { const r = b.getBoundingClientRect(); return { t: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((x) => x.w < 48 || x.h < 48))()`;
    out.main = await page.evaluate(`({ shell: !!document.getElementById('sv-shell'), buttons: document.querySelectorAll('#sv-shell button').length,
      small: ${small}, insetTop: getComputedStyle(document.getElementById('sv-shell')).getPropertyValue('--inset-top').trim(),
      font: getComputedStyle(document.querySelector('#sv-shell .nav button')).fontFamily, theme: document.documentElement.getAttribute('data-ui-theme'),
      storedTheme: window.SVUiThemes.resolve((window.SVAndroid.config.get().ui || {}).theme, window.SVAndroid.systemDark() !== false).id })`);
    shot('1-main');
    // Ölçümün değiştirdiği ayar sonda geri yazılır (tema, etkin sahne, Otomatik VJ)
    await page.evaluate('window.__probeOrig = JSON.parse(JSON.stringify(window.SVAndroid.config.get())); 1');
    const tapEl = async (sel) => {
      const p = await page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect();
        return [Math.round((r.left + r.width / 2) * devicePixelRatio), Math.round((r.top + r.height / 2) * devicePixelRatio)]; })()`);
      if (p) D.adb(['shell', 'input', 'tap', String(p[0]), String(p[1])]);
      return !!p;
    };
    // Sahne çağırma: ikinci sahne kartına dokunulur. Sahneye ait olmayan anahtarlar aynı kalmalı.
    const nonScene = `((c) => JSON.stringify(Object.keys(c).filter((k) => k !== '_activeSceneId' && window.SVSchema.SCENE_KEYS.indexOf(k) < 0).sort().map((k) => [k, c[k]])))`;
    await page.evaluate(`(() => { const c = window.SVAndroid.config.get();
      if (!Array.isArray(c.scenes) || c.scenes.length < 2) window.SVAndroid.config.patch({ scenes: [{ id: 'sc_a', name: 'Bir', data: {} }, { id: 'sc_b', name: 'İki', data: {} }] });
      window.__probeKeys = ${nonScene}(window.SVAndroid.config.get()); return 1; })()`);
    await D.sleep(400);
    const want = await page.evaluate('(() => { const s = window.SVAndroid.config.get().scenes[1]; return { id: s.id, name: (window.SVI18n ? window.SVI18n.t(s.name) : s.name) }; })()');
    out.sceneTapped = await tapEl('#sv-shell .scenes .scene:nth-child(2)');
    await D.sleep(800);
    await page.evaluate('window.SVAndroid.config.flush()');
    out.scene = await page.evaluate(`(() => { const c = window.SVAndroid.config.get(); const t = document.querySelectorAll('#sv-shell .scenes .scene')[1];
      return { active: c._activeSceneId, on: t.classList.contains('on'), pressed: t.getAttribute('aria-pressed'),
        title: document.querySelector('#sv-shell .scene-card .title').textContent, othersKept: ${nonScene}(c) === window.__probeKeys }; })()`);
    const stored = JSON.parse(D.adb(['shell', 'run-as', D.PKG, 'cat', 'files/profile/settings.json']).replace(/^﻿/, ''));
    out.scene.saved = stored._activeSceneId;
    out.scene.want = want;
    // Otomatik VJ: dokununca açılır, yine dokununca kapanır
    const vjOf = "(() => { const c = window.SVAndroid.config.get(); return { on: !!(c.autovj && c.autovj.enabled), pill: document.querySelector('#sv-shell .scene-card .pill').classList.contains('on') }; })()";
    const vj0 = await page.evaluate(vjOf);
    await tapEl('#sv-shell .scene-card .pill');
    await D.sleep(600);
    const vj1 = await page.evaluate(vjOf);
    await tapEl('#sv-shell .scene-card .pill');
    await D.sleep(600);
    const vj2 = await page.evaluate(vjOf);
    out.autoVj = { flips: vj1.on === !vj0.on && vj1.pill === vj1.on, back: vj2.on === vj0.on && vj2.pill === vj2.on };
    await page.evaluate('window.SVAndroid.config.set(window.__probeOrig); 1');
    await D.sleep(400);
    out.tabs = {};
    for (const t of ['layers', 'library', 'audio', 'settings']) {
      await page.evaluate(`window.SVShell.open(${JSON.stringify(t)})`);
      await D.sleep(500);
      out.tabs[t] = await page.evaluate(`({ sheet: window.SVShell.state().sheet, title: (document.querySelector('#sv-shell .sheet h2') || {}).textContent, small: ${small} })`);
      shot('2-' + t);
    }
    // Geri tuşu: önce sayfa kapanır
    D.adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
    await D.sleep(600);
    out.backCloses = await page.evaluate('!window.SVShell.state().sheet');
    // Kökte: uygulama arkaya alınır, süreç ve motor yaşar
    await page.evaluate('window.__marker = 7; 1');
    D.adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
    await D.sleep(1200);
    const top = D.adb(['shell', 'dumpsys', 'activity', 'activities']).split(/\r?\n/).find((l) => /topResumedActivity|mResumedActivity/.test(l)) || '';
    out.backToBackground = { foreground: top.includes(D.PKG), samePid: D.pidOf() === pid };
    D.adb(['shell', 'am', 'start', '-n', D.PKG + '/.MainActivity']);
    await D.sleep(1500);
    out.sameEngine = await page.evaluate('window.__marker === 7');
    // Tema: ayarın ui.theme'i
    await page.evaluate(`(() => { const c = window.SVAndroid.config.get() || {}; window.SVAndroid.config.patch({ ui: Object.assign({}, c.ui, { theme: 'light' }) }); return 1; })()`);
    await D.sleep(400);
    out.lightTheme = await page.evaluate("({ theme: document.documentElement.getAttribute('data-ui-theme'), bg: getComputedStyle(document.querySelector('#sv-shell .nav')).backgroundColor })");
    shot('3-light');
    await page.evaluate('window.SVAndroid.config.patch({ ui: window.__probeOrig.ui }); 1');
    await D.sleep(300);
    out.themeRestored = await page.evaluate("document.documentElement.getAttribute('data-ui-theme')") === out.main.storedTheme;
    /* Cam bulanıklığının bedeli: motorun ölçtüğü kare hızı (ölçer iletisinin fps'i)
       kabuk açıkken, sayfa açıkken, tam ekranda (kabuk yok) ve düz yüzeyle. Emülatörde
       ana makinenin GPU'su çiziyor; sayılar telefonu değil farkı gösterir. */
    // Dinleyici çıkarılamıyor; ölçüm bitince boşta kalır
    const fpsOf = () => page.evaluate(`new Promise((res) => { const v = []; let done = false; setTimeout(() => { window.SVAndroid.onMeter((m) => { if (!done && m && m.fps) v.push(m.fps); });
      setTimeout(() => { done = true; res(v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : null); }, 3000); }, 1000); })`);
    out.fps = { shell: await fpsOf() };
    await page.evaluate("window.SVShell.open('layers')");
    out.fps.sheet = await fpsOf();
    await page.evaluate('window.SVShell.close()');
    await page.evaluate("document.getElementById('sv-shell').classList.add('flat')");
    out.fps.flat = await fpsOf();
    await page.evaluate("document.getElementById('sv-shell').classList.remove('flat')");
    // Tam ekran: kabuk gizlenir, dokununca geri gelir
    await page.evaluate("document.querySelector('#sv-shell [aria-label=\"Tam ekran\"], #sv-shell [aria-label=\"Full screen\"]').click()");
    await D.sleep(400);
    out.fullscreenHidden = await page.evaluate("getComputedStyle(document.getElementById('sv-shell')).display === 'none'");
    shot('4-fullscreen');
    out.fps.fullscreen = await fpsOf();
    D.adb(['shell', 'input', 'tap', '540', '1200']);
    await D.sleep(500);
    out.tapRestores = await page.evaluate("getComputedStyle(document.getElementById('sv-shell')).display !== 'none'");
    // Yüzen pencere: kabuk gizlenir, kapanınca geri gelir
    out.floatingOpen = await page.evaluate("window.SVAndroid.floating.open({ width: 540, height: 304 }).then(() => true, (e) => e.message)");
    await D.sleep(1500);
    out.floatingHidden = await page.evaluate("getComputedStyle(document.getElementById('sv-shell')).display === 'none'");
    await page.evaluate('window.SVAndroid.floating.close()');
    await D.sleep(1500);
    out.floatingRestored = await page.evaluate("getComputedStyle(document.getElementById('sv-shell')).display !== 'none'");
    /* Geniş düzen (840 dp ve üstü): telefon yatayda. Sol ray, sağ panel; üst bilgi ve
       sahne şeridi ikisinin arasında kalmalı, hiçbir şey ekran dışına taşmamalı. */
    const rot = ['accelerometer_rotation', 'user_rotation'].map((k) => D.adb(['shell', 'settings', 'get', 'system', k]).trim());
    try {
      D.adb(['shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0']);
      D.adb(['shell', 'settings', 'put', 'system', 'user_rotation', '1']);
      await D.sleep(2500);
      const rects = `(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width) }; };
        const st = getComputedStyle(document.getElementById('sv-shell'));
        return { vw: innerWidth, vh: innerHeight, nav: r('#sv-shell .nav'), hud: r('#sv-shell .hud'), scenes: r('#sv-shell .scenes'), sheet: r('#sv-shell .sheet'),
          card: getComputedStyle(document.querySelector('#sv-shell .scene-card')).display, insets: ['left', 'right', 'top', 'bottom'].map((k) => st.getPropertyValue('--inset-' + k).trim()), small: ${small} }; })()`;
      out.wide = { main: await page.evaluate(rects) };
      shot('5-wide');
      await page.evaluate("window.SVShell.open('layers')");
      await D.sleep(500);
      out.wide.sheet = await page.evaluate(rects);
      shot('6-wide-sheet');
      /* Daha küçük yatay telefon (740 x 360 dp): sayfanın görüntü alanı DevTools ile
         daraltılır (`wm density` WebView'in görüntü alanını değiştirmiyor, ölçüldü).
         Panel daralır, üst bilgideki kaynak adı kısalır; düğmeler 48 dp'nin altına inmez. */
      await page.call('Emulation.setDeviceMetricsOverride', { width: 740, height: 360, deviceScaleFactor: 0, mobile: true });
      await D.sleep(800);
      out.wide.narrow = await page.evaluate(rects);
      shot('7-wide-narrow-sheet');
      await page.evaluate('window.SVShell.close()');
    } finally {
      await page.call('Emulation.clearDeviceMetricsOverride').catch(() => {});
      D.adb(['shell', 'settings', 'put', 'system', 'user_rotation', /^\d+$/.test(rot[1]) ? rot[1] : '0']);
      D.adb(['shell', 'settings', 'put', 'system', 'accelerometer_rotation', /^\d+$/.test(rot[0]) ? rot[0] : '1']);
      await D.sleep(1500);
    }
    out.logs = page.logs.filter((l) => /exception|error/i.test(l)).slice(0, 5);
  } finally { page.close(); }
  const w = out.wide || {};
  const m = w.main || {};
  const s = w.sheet || {};
  const n = w.narrow || {};
  // Panel kapalıyken üst bilgi sağa kadar uzanır; açıkken şerit görünür kalır ve panele değmez
  const fits = (x) => !!(x && x.sheet && x.nav && x.nav.r <= x.hud.l && x.sheet.r <= x.vw && x.hud.r <= x.sheet.l && x.scenes.w > 0 && x.scenes.r <= x.sheet.l
    && x.nav.t >= 0 && x.nav.b <= x.vh && x.small.length === 0);
  out.wideOk = !!(m.nav && m.vw >= 840 && m.nav.w <= 96 && m.nav.r <= m.hud.l && m.nav.r <= m.scenes.l && m.card === 'flex' && m.small.length === 0
    && m.hud.r > (s.hud || {}).r && fits(s) && s.sheet.w === 400 && fits(n) && n.vw < 840 && n.sheet.w < 400);
  console.log(JSON.stringify(out, null, 1));
  const tabsOk = Object.values(out.tabs).every((t) => t.sheet && t.small.length === 0);
  const ok = out.main.shell && out.main.small.length === 0 && parseFloat(out.main.insetTop) > 0 && /Geist/.test(out.main.font) && tabsOk
    && out.backCloses && !out.backToBackground.foreground && out.backToBackground.samePid && out.sameEngine
    && out.lightTheme.theme === 'light' && out.fullscreenHidden && out.tapRestores && out.floatingHidden && out.floatingRestored
    && out.main.theme === out.main.storedTheme && out.themeRestored
    && out.sceneTapped && out.scene.active === out.scene.want.id && out.scene.on && out.scene.pressed === 'true' && out.scene.title === out.scene.want.name
    && out.scene.othersKept && out.scene.saved === out.scene.want.id && out.autoVj.flips && out.autoVj.back && out.wideOk;
  if (!ok) process.exitCode = 1;
}

/* KATMANLAR SEKMESİ (Faz 3.3). Liste ayardaki katmanları görüntü sırasıyla gösteriyor
   mu, küçük resimler geliyor mu; göz ve görünürlük motorun çizdiğini değiştiriyor mu
   (ayar değil, ekrandaki parlaklık ölçülüyor); katman ekleme masaüstü gibi kuruyor mu
   (ikinci MilkDrop kendi presetini alır); tutamaçtan sürükleme diziyi değiştiriyor mu;
   silme onay istiyor mu; geri tuşu sayfaları sırayla kapatıyor mu. Her düğme 48 dp,
   İngilizce arayüzde Türkçe metin kalmamalı. Ayar sonda geri yazılır. */
async function layersCmd() {
  const path = require('node:path');
  const shots = arg('shots');
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const shot = (name) => { const b = D.screencap(); if (shots) fs.writeFileSync(path.join(shots, name + '.png'), b); return b; };
  // Sahnenin sayfanın üstünde kalan kısmı (sayfa ekranın üçte ikisini kaplıyor)
  const STAGE = { y0: 0.14, y1: 0.3 };
  const out = {};
  const pid = await D.launch();
  const page = await D.connect(pid);
  const ev = (js) => page.evaluate(js);
  const small = `(() => Array.from(document.querySelectorAll('#sv-shell button, #sv-shell a, #sv-shell input, #sv-shell select, #sv-shell .grip, #sv-shell [role=switch]'))
    .filter((b) => b.offsetParent !== null && b.getClientRects().length)
    .map((b) => { const r = b.getBoundingClientRect(); return { t: (b.getAttribute('aria-label') || b.textContent || b.className || '').trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((x) => x.w < 47.5 || x.h < 47.5))()`;
  const tap = async (sel) => {
    const p = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect();
      return [Math.round((r.left + r.width / 2) * devicePixelRatio), Math.round((r.top + r.height / 2) * devicePixelRatio)]; })()`);
    if (p) D.adb(['shell', 'input', 'tap', String(p[0]), String(p[1])]);
    await D.sleep(700);
    return !!p;
  };
  const layersNow = () => ev('(window.SVAndroid.config.get().layers || []).map((l) => ({ id: l.id, kind: l.kind, type: l.type, enabled: l.enabled !== false, opacity: l.opacity == null ? 1 : l.opacity, md: l.settings && l.settings.milkdrop || null }))');
  /* Motor sahne değişiminde geçiş yapıyor (varsayılan 0,7 sn); emülatör yük altındayken
     kare süresi uzadığı için geçiş duvar saatinde 2 sn'yi geçebiliyor (ölçüldü: 1,3 sn'de
     hâlâ eski kare, 2,5 sn'de yeni). Parlaklık beklenen yöne geçene dek, en çok 6 sn bekle. */
  const settle = async (name, done, region = STAGE) => {
    const t0 = Date.now();
    let v = 0;
    for (;;) {
      await D.sleep(400);
      const b = D.screencap();
      v = PNG.luma(b, 4, region).mean;
      if (done(v) || Date.now() - t0 > 6000) { if (name && shots) fs.writeFileSync(path.join(shots, name + '.png'), b); return v; }
    }
  };
  try {
    for (let i = 0; i < 50 && !(await ev('!!(window.SVShell && window.SVShell.state().ready)')); i++) await D.sleep(200);
    await D.sleep(1200);
    await ev('window.__probeOrig = JSON.parse(JSON.stringify(window.SVAndroid.config.get())); 1');
    // Bilinen başlangıç: arkaplan (gradyan) ve görselleştirici (barlar), yığın açık
    await ev(`(() => { const L = window.SVLayers; const c = JSON.parse(JSON.stringify(window.SVAndroid.config.get()));
      c.layers = [L.normalizeLayer({ kind: 'background', type: 'gradient', name: '' }), L.normalizeLayer({ kind: 'visualizer', type: 'bars', name: '' })];
      c.layerStack = Object.assign({}, c.layerStack, { enabled: true });
      // Arkaplan katmanı gizlenince motor sahnenin arkaplanını çiziyor; ölçüm siyah zeminle
      c.background = Object.assign({}, c.background, { type: 'solid', solidColor: '#000000' });
      // Sahne efektleri yok: önceki bir şablonun bloom'u %20'lik katmanı yine beyaza boğuyordu (ölçüldü)
      c.postfx = [];
      window.SVAndroid.config.set(c); return 1; })()`);
    // Katmanların ilk karesi hazırlansın (yeni açılan uygulamada daha uzun sürüyor)
    await D.sleep(2000);
    await ev("window.SVShell.open('layers'); 1");
    await D.sleep(1200);
    out.list = await ev(`({ rows: Array.from(document.querySelectorAll('#sv-shell .layer-list .row')).map((r) => r.dataset.id),
      thumbs: Array.from(document.querySelectorAll('#sv-shell .layer-list img')).map((i) => i.naturalWidth), small: ${small} })`);
    const l0 = await layersNow();
    out.listOrder = out.list.rows.join() === l0.map((l) => l.id).reverse().join();
    shot('1-list');
    // Göz: arkaplanı gizle → sahne kararmalı
    const before = PNG.luma(D.screencap(), 4, STAGE).mean;
    const bgId = l0[0].id;
    await tap(`#sv-shell .layer-list .row[data-id="${bgId}"] .iconbtn`);
    const hidden = await settle('2-hidden', (v) => v < before * 0.6);
    out.eye = { config: (await layersNow())[0].enabled === false, before: Math.round(before), after: Math.round(hidden) };
    await tap(`#sv-shell .layer-list .row[data-id="${bgId}"] .iconbtn`);
    out.eye.back = (await layersNow())[0].enabled === true;
    out.eye.restored = Math.round(await settle(null, (v) => v > before * 0.85));
    // Ayarlar: görünürlük 0,2 → sahne kararmalı (yerel range'e input olayı)
    await tap(`#sv-shell .layer-list .row[data-id="${bgId}"] .row-main`);
    out.editDepth = await ev('window.SVShell.state().depth');
    /* Ayar sayfası listeden uzun: şerit sayfanın üstünde biter (açık temada beyaz sayfa
       ölçüme karışıyordu, ölçüldü: sahne %20'de 206 → 40 iken şerit ortalaması 137) */
    const top = await ev("document.querySelector('#sv-shell .sheet').getBoundingClientRect().top / innerHeight");
    const EDIT = { y0: STAGE.y0, y1: Math.min(STAGE.y1, top - 0.02) };
    const ref = PNG.luma(D.screencap(), 4, EDIT).mean;
    await ev(`(() => { const r = document.querySelector('#sv-shell .sheet-body input[type=range]'); r.value = '0.2'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
    const dim = await settle('3-edit', (v) => v < ref * 0.4, EDIT);
    out.opacity = { config: (await layersNow())[0].opacity, ref: Math.round(ref), after: Math.round(dim), band: [EDIT.y0, +EDIT.y1.toFixed(3)] };
    out.editSmall = await ev(small);
    for (let t = 1; t < 4; t++) {
      await ev(`document.querySelectorAll('#sv-shell .tabs button')[${t}].click(); 1`);
      await D.sleep(300);
      const s = await ev(small);
      if (s.length) out.editSmall = out.editSmall.concat(s);
    }
    await ev(`(() => { const r = document.querySelector('#sv-shell .sheet-body input[type=range]'); r.value = '1'; r.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
    // Geri: ayarlar → liste
    D.adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
    await D.sleep(700);
    out.backToList = await ev('window.SVShell.state().depth') === 1;
    // Ekle: Barlar (ilk mod seçili gelir) → katman en üstte, ayarları açık
    await tap('#sv-shell .sheet-actions .btn');
    await D.sleep(800);
    out.addSmall = await ev(small);
    out.addThumbs = await ev("Array.from(document.querySelectorAll('#sv-shell .grid2 img')).slice(0, 6).map((i) => i.naturalWidth)");
    shot('4-add');
    await tap('#sv-shell .sheet-foot .btn');
    await D.sleep(800);
    const l1 = await layersNow();
    out.added = { count: l1.length, top: l1[l1.length - 1].type, depth: await ev('window.SVShell.state().depth') };
    // MilkDrop iki kez: ikincisi kendi presetini alır (masaüstündeki gibi)
    for (let k = 0; k < 2; k++) {
      await ev('window.SVShell.back(); 1');
      await D.sleep(400);
      await tap('#sv-shell .sheet-actions .btn');
      await tap('#sv-shell .pills .pill:nth-child(4)');
      await tap('#sv-shell .sheet-foot .btn');
      await D.sleep(600);
    }
    const l2 = await layersNow();
    const mds = l2.filter((l) => l.type === 'milkdrop');
    out.milkdrop = { count: mds.length, secondIndependent: !!(mds[1] && mds[1].md && mds[1].md.independent) };
    shot('5-milkdrop');
    await ev('window.SVShell.back(); 1');
    await D.sleep(700);
    // Sürükle: en üstteki satırı bir satır aşağı
    const g = await ev(`(() => { const rows = document.querySelectorAll('#sv-shell .layer-list .row'); const a = rows[0].querySelector('.grip').getBoundingClientRect(); const b = rows[1].getBoundingClientRect();
      const d = devicePixelRatio; return [Math.round((a.left + a.width / 2) * d), Math.round((a.top + a.height / 2) * d), Math.round((b.top - rows[0].getBoundingClientRect().top) * d)]; })()`);
    const topBefore = (await layersNow()).slice(-1)[0].id;
    D.adb(['shell', 'input', 'swipe', String(g[0]), String(g[1]), String(g[0]), String(g[1] + g[2] + 10), '800']);
    await D.sleep(1000);
    const l3 = await layersNow();
    out.drag = { moved: l3[l3.length - 2].id === topBefore && l3[l3.length - 1].id !== topBefore };
    shot('6-dragged');
    // Sil: onay penceresi, sonra bir eksik
    const n4 = l3.length;
    await tap('#sv-shell .layer-list .row:first-child .row-main');
    await tap('#sv-shell .sheet-actions [aria-label="Sil"], #sv-shell .sheet-actions [aria-label="Delete"]');
    out.confirmShown = await ev("!!document.querySelector('#sv-shell .dialog')");
    shot('7-confirm');
    await tap('#sv-shell .dialog .btn.danger');
    out.deleted = (await layersNow()).length === n4 - 1 && await ev('window.SVShell.state().depth') === 1;
    // İngilizce arayüzde Türkçe metin (katman ve sahne adları dışında)
    out.turkish = await ev(`(() => { const t = document.getElementById('sv-shell').innerText.split(/\\n+/);
      const c = window.SVAndroid.config.get(); const own = new Set([].concat((c.scenes || []).map((x) => x && x.name), (c.layers || []).map((x) => x && x.name)).filter(Boolean));
      return t.filter((s) => /[çğıöşüÇĞİÖŞÜ]/.test(s) && !own.has(s.trim())); })()`);
    out.lang = await ev('window.SVI18n && window.SVI18n.locale');
    out.logs = page.logs.filter((l) => /exception|error/i.test(l)).slice(0, 5);
  } finally {
    try { await ev('window.SVShell.close(); window.SVAndroid.config.set(window.__probeOrig); 1'); } catch (e) { /* sayfa gitti */ }
    page.close();
  }
  console.log(JSON.stringify(out, null, 1));
  const ok = out.listOrder && out.list.thumbs.length === 2 && out.list.thumbs.every((w) => w > 0) && !out.list.small.length
    && out.eye.config && out.eye.back && out.eye.after < out.eye.before * 0.6 && out.eye.restored > out.eye.before * 0.85
    && out.editDepth === 2 && Math.abs(out.opacity.config - 0.2) < 0.01 && out.opacity.after < out.opacity.ref * 0.4 && !out.editSmall.length
    && out.backToList && !out.addSmall.length && out.addThumbs.every((w) => w > 0)
    && out.added.top === 'bars' && out.added.depth === 2 && out.milkdrop.count === 2 && out.milkdrop.secondIndependent
    && out.drag.moved && out.confirmShown && out.deleted && (out.lang !== 'en' || !out.turkish.length);
  if (!ok) process.exitCode = 1;
}

/* SES, KİTAPLIK, GÖRÜNTÜLEME, AYARLAR (Faz 3.4–3.6). Her sayfa açılıyor, 48 dp ve
   İngilizce arayüzde Türkçe metin denetleniyor; düğmeler gerçekten iş yapıyor mu:
   mikrofon kaynağı açılıp kapanıyor, tempo bulunuyor, Otomatik VJ görselleştiriciyi
   değiştiriyor, preset seçimi ortak MilkDrop'a gidiyor (katman yoksa ekleniyor), favori
   ve sahne kaydı ayara yazılıyor, yüzen pencere seçilen boyutla açılıyor, tema ve kare
   sınırı değişiyor. Ayar sonda geri yazılır. */
async function pagesCmd() {
  const path = require('node:path');
  const shots = arg('shots');
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const shot = (name) => { const b = D.screencap(); if (shots) fs.writeFileSync(path.join(shots, name + '.png'), b); return b; };
  const out = {};
  D.adb(['shell', 'appops', 'set', D.PKG, 'SYSTEM_ALERT_WINDOW', 'allow']);
  D.adb(['shell', 'pm', 'grant', D.PKG, 'android.permission.RECORD_AUDIO']);
  const pid = await D.launch();
  const page = await D.connect(pid);
  const ev = (js) => page.evaluate(js);
  const check = `(() => { const el = document.getElementById('sv-shell');
    const small = Array.from(el.querySelectorAll('button, a, input, select, [role=switch]')).filter((b) => b.offsetParent !== null && b.getClientRects().length)
      .map((b) => { const r = b.getBoundingClientRect(); return { t: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((x) => x.w < 47.5 || x.h < 47.5);
    const sheet = el.querySelector('.sheet');
    const c = window.SVAndroid.config.get();
    const own = new Set([].concat((c.scenes || []).map((x) => x && x.name), (c.layers || []).map((x) => x && x.name)).filter(Boolean));
    // Sahne/katman adları, kutulardaki baş harfler ve dil seçicideki "Türkçe" kendi dilinde kalır
    const turkish = (sheet ? sheet.innerText : '').split(/\\n+/).map((s) => s.replace(/\\u200B/g, '').trim())
      .filter((s) => s.length > 2 && /[çğıöşüÇĞİÖŞÜ]/.test(s) && s !== 'Türkçe' && !own.has(s));
    return { small, turkish }; })()`;
  const tapSel = async (sel, wait) => {
    const p = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect();
      return [Math.round((r.left + r.width / 2) * devicePixelRatio), Math.round((r.top + r.height / 2) * devicePixelRatio)]; })()`);
    if (p) D.adb(['shell', 'input', 'tap', String(p[0]), String(p[1])]);
    await D.sleep(wait || 700);
    return !!p;
  };
  try {
    for (let i = 0; i < 50 && !(await ev('!!(window.SVShell && window.SVShell.state().ready)')); i++) await D.sleep(200);
    await D.sleep(1500);
    await ev('window.__probeOrig = JSON.parse(JSON.stringify(window.SVAndroid.config.get())); 1');
    // ---- Ses ----
    await ev("window.SVShell.open('audio'); 1");
    await D.sleep(800);
    const bars = [];
    for (let k = 0; k < 4; k++) { bars.push(await ev("Array.from(document.querySelectorAll('#sv-shell .bigmeter i')).map((i) => parseFloat(i.style.height) || 0).join()")); await D.sleep(250); }
    out.audio = { sources: await ev("document.querySelectorAll('#sv-shell .source').length"), moving: new Set(bars).size > 1, check: await ev(check) };
    shot('1-audio');
    await tapSel('#sv-shell .source[data-source="mic"]', 2500);
    out.audio.mic = await ev("({ st: window.SVAndroid.audio.status(), on: document.querySelector('#sv-shell .source[data-source=\"mic\"]').getAttribute('aria-checked') })");
    await tapSel('#sv-shell .sheet-body .btn.ghost', 1500);
    out.audio.stopped = await ev('(window.SVAndroid.audio.status() || {}).state');
    for (let i = 0; i < 20 && !(await ev('window.SVMobileVJ.tempo().bpm > 0')); i++) await D.sleep(500);
    out.audio.bpm = Math.round(await ev('window.SVMobileVJ.tempo().bpm'));
    // Otomatik VJ: aç, şimdi değiştir → görselleştirici değişir, kapat
    const visBefore = await ev("(window.SVAndroid.config.get().layers || []).filter((l) => l.kind === 'visualizer' && l.type !== 'text').map((l) => l.type).join()");
    await tapSel('#sv-shell .tempo-card [role=switch]', 900);
    out.vj = { enabled: await ev('!!(window.SVAndroid.config.get().autovj || {}).enabled'), hud: await ev("document.querySelector('#sv-shell .scene-card .pill').classList.contains('on')") };
    // Sıralı kipte ilk seçim şu anki tür olabilir: iki kez
    await tapSel('#sv-shell .tempo-card .btn', 900);
    await tapSel('#sv-shell .tempo-card .btn', 900);
    out.vj.changed =await ev("(window.SVAndroid.config.get().layers || []).filter((l) => l.kind === 'visualizer' && l.type !== 'text').map((l) => l.type).join()") !== visBefore;
    out.vj.status = await ev('window.SVMobileVJ.status()');
    shot('2-autovj');
    await tapSel('#sv-shell .tempo-card [role=switch]', 700);
    out.vj.off = !(await ev('!!(window.SVAndroid.config.get().autovj || {}).enabled'));
    // ---- Kitaplık ----
    await ev("(() => { const c = window.SVAndroid.config.get(); window.SVAndroid.config.patch({ layers: (c.layers || []).filter((l) => !(l.kind === 'visualizer' && l.type === 'milkdrop')) }); return 1; })()");
    await ev("window.SVShell.open('library'); 1");
    await D.sleep(900);
    // İlk bölüm Şablonlar: ikinci kutuya dokununca şablonun katmanları sahneye gelir
    const tplWant = await ev("(() => { const T = window.SVTemplates; const t = T.TEMPLATES.filter((x) => x.group === T.groups()[0])[1]; return t.id; })()");
    await tapSel('#sv-shell .grid2 .tile:nth-child(2) .tile-main', 1500);
    out.templates = { applied: await ev("document.querySelector('#sv-shell .grid2 .tile:nth-child(2)').classList.contains('sel')"), want: tplWant, check: await ev(check) };
    shot('3-templates');
    await tapSel('#sv-shell .tabs button:nth-child(2)', 900);
    out.library = { tiles: await ev("document.querySelectorAll('#sv-shell .grid2 .tile').length"), check: await ev(check) };
    shot('3-library');
    const firstId = await ev("window.SVPresets.all().filter((p) => p.kind === 'milkdrop')[0].id");
    await tapSel('#sv-shell .grid2 .tile:first-child .tile-main', 1500);
    out.library.picked = await ev(`(() => { const c = window.SVAndroid.config.get(); return { id: c.milkdrop && c.milkdrop.presetId, src: !!(c.milkdrop && c.milkdrop.source), layer: (c.layers || []).some((l) => l.type === 'milkdrop') }; })()`);
    out.library.pickedOk = out.library.picked.id === firstId && out.library.picked.src && out.library.picked.layer;
    // Önceki bir koşudan açık kalmış olabilir: yıldızın durumu değişmeli
    const favBefore = await ev(`!!((window.SVAndroid.config.get().milkdropLibrary || {}).favorites || {})[${JSON.stringify(firstId)}]`);
    await tapSel('#sv-shell .grid2 .tile:first-child .star', 700);
    out.library.fav = (await ev(`!!((window.SVAndroid.config.get().milkdropLibrary || {}).favorites || {})[${JSON.stringify(firstId)}]`)) !== favBefore;
    await ev(`(() => { const i = document.querySelector('#sv-shell .search input'); i.value = 'aurora'; i.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
    await D.sleep(400);
    out.library.search = await ev("document.querySelectorAll('#sv-shell .grid2 .tile').length");
    await tapSel('#sv-shell .tabs button:nth-child(4)', 700);
    const n0 = await ev('(window.SVAndroid.config.get().scenes || []).length');
    // Yeni Sahne Olarak Kaydet (sıranın son düğmesi) → ad sorulur → Kaydet
    await tapSel('#sv-shell .sheet-body > .btn-row .btn:last-child', 800);
    await tapSel('#sv-shell .dialog .btn.primary', 800);
    out.library.saved = await ev('(window.SVAndroid.config.get().scenes || []).length') === n0 + 1;
    shot('4-scenes');
    // Sahnenin menüsü → Sil → onay
    await tapSel('#sv-shell .grid2 .tile:last-child .star', 600);
    await tapSel('#sv-shell .choice[data-v=delete]', 600);
    await tapSel('#sv-shell .dialog .btn.danger', 700);
    out.library.deleted = await ev('(window.SVAndroid.config.get().scenes || []).length') === n0;
    out.library.scenesCheck = await ev(check);
    // ---- Görüntüleme ----
    await ev('window.SVShell.close(); 1');
    await tapSel('#sv-shell .hud .iconbtn', 900);
    out.display = { open: await ev("(document.querySelector('#sv-shell .sheet h2') || {}).textContent || ''"), check: await ev(check) };
    shot('5-display');
    await tapSel('#sv-shell .seg button:nth-child(3)', 400);
    await tapSel('#sv-shell .card.big.primary', 2000);
    const fs0 = await ev('window.SVAndroid.floating.state()');
    out.display.floating = { showing: fs0.showing, width: fs0.bounds && fs0.bounds[2] };
    // Ekranı açık tut yüzen pencerede de (pencere bayrağı; kök görünümünkü pencereye geçmiyordu)
    out.display.floating.hold = /mHoldScreenWindow=Window\{[^}]* u0 com\.cayadev\.visualizer\}/.test(D.adb(['shell', 'dumpsys', 'window']));
    await ev('window.SVAndroid.floating.close()');
    await D.sleep(1500);
    out.display.expectW = await ev("Math.round(Math.min(screen.width, screen.height) * devicePixelRatio * 0.85)");
    // ---- Ayarlar ----
    await ev("window.SVShell.open('settings'); 1");
    await D.sleep(800);
    out.settings = { swatches: await ev("document.querySelectorAll('#sv-shell .sw').length"), check: await ev(check) };
    shot('6-settings');
    await tapSel('#sv-shell .sw:nth-child(4)', 700);
    out.settings.theme = await ev("({ cfg: (window.SVAndroid.config.get().ui || {}).theme, page: document.documentElement.getAttribute('data-ui-theme') })");
    shot('7-settings-light');
    // Ekranı açık tut: pencere bayrağı ayarı izler (varsayılan açık)
    // Ekranı açık tutan pencere (güç yöneticisinin gördüğü; pencere bayrağı değil)
    const flag = () => (/mHoldScreenWindow=Window\{[^}]*/.exec(D.adb(['shell', 'dumpsys', 'window'])) || [''])[0].indexOf(D.PKG) >= 0;
    out.settings.awake = { before: flag() };
    const setAwake = (on) => ev(`(() => { const c = window.SVAndroid.config.get(); window.SVAndroid.config.patch({ power: Object.assign({}, c.power, { keepAwake: ${on} }) }); return 1; })()`);
    await setAwake(false);
    await D.sleep(800);
    // Kapalıyken ekranı hiçbir pencere tutmamalı (Chromium WebView'in bayrağını açıyordu; WebShell süzüyor)
    out.settings.awake.off = !flag();
    out.settings.awake.hold = (/mHoldScreenWindow=[^\n]*/.exec(D.adb(['shell', 'dumpsys', 'window'])) || [''])[0].trim();
    out.settings.awake.activities = D.adb(['shell', 'dumpsys', 'activity', 'activities']).split(/\r?\n/).filter((l) => /ActivityRecord\{[^}]*MainActivity/.test(l) && /Hist|\* /.test(l)).map((l) => l.trim().slice(0, 90));
    out.settings.awake.toggle = await ev("(() => { const b = Array.from(document.querySelectorAll('#sv-shell [role=switch]')).find((x) => /Ekranı açık tut|Keep the screen on/.test(x.getAttribute('aria-label'))); return b && b.getAttribute('aria-checked'); })()");
    // Uygulama arkaya alınıp yeniden açılınca da kapalı kalmalı (Chromium o an yeniden açıyordu)
    D.adb(['shell', 'input', 'keyevent', 'KEYCODE_HOME']);
    await D.sleep(1200);
    D.adb(['shell', 'am', 'start', '-n', D.PKG + '/.MainActivity']);
    await D.sleep(2500);
    out.settings.awake.offAfterResume = !flag();
    await setAwake(true);
    await D.sleep(800);
    out.settings.awake.on = flag();
    // İlk parçalı seçim dil (dokunmak sayfayı yeniden yükler); kare sınırı etiketinden
    await tapSel('#sv-shell .seg[aria-label="Kare sınırı"] button:first-child, #sv-shell .seg[aria-label="Frame limit"] button:first-child', 600);
    out.settings.fpsCap = await ev('(window.SVAndroid.config.get().power || {}).fpsCap');
    await tapSel('#sv-shell .nav-card .nav-row:last-child', 700);
    out.settings.about = await ev("(document.querySelector('#sv-shell .sheet h2') || {}).textContent || ''");
    out.settings.aboutCheck = await ev(check);
    shot('8-about');
    out.lang = await ev('window.SVI18n && window.SVI18n.locale');
    out.logs = page.logs.filter((l) => /exception|error/i.test(l)).slice(0, 5);
  } finally {
    try { await ev('window.SVShell.close(); window.SVAndroid.config.set(window.__probeOrig); window.SVAndroid.audio.stop(); 1'); } catch (e) { /* sayfa gitti */ }
    page.close();
  }
  console.log(JSON.stringify(out, null, 1));
  const clean = (c) => c && !c.small.length && (out.lang !== 'en' || !c.turkish.length);
  const ok = out.audio.sources === 4 && out.audio.moving && clean(out.audio.check) && out.audio.mic.st && out.audio.mic.st.source === 'mic' && out.audio.mic.on === 'true'
    && out.audio.stopped !== 'running' && out.audio.bpm >= 60 && out.vj.enabled && out.vj.hud && out.vj.changed && out.vj.off
    && out.templates.applied && clean(out.templates.check) && out.library.tiles > 0 && clean(out.library.check) && out.library.pickedOk && out.library.fav && out.library.search >= 1 && out.library.saved && out.library.deleted && clean(out.library.scenesCheck)
    && clean(out.display.check) && out.display.floating.showing && out.display.floating.hold && Math.abs(out.display.floating.width - out.display.expectW) <= 2
    && out.settings.swatches === 8 && clean(out.settings.check) && out.settings.theme.cfg === 'light' && out.settings.theme.page === 'light'
    && out.settings.fpsCap === 30 && out.settings.awake.before && out.settings.awake.off && out.settings.awake.offAfterResume && out.settings.awake.toggle === 'false' && out.settings.awake.on && /About|Hakkında/.test(out.settings.about) && clean(out.settings.aboutCheck) && !out.logs.length;
  if (!ok) process.exitCode = 1;
}

/* Android'in belge seçicisinde (DocumentsUI) bir öğeye dokunur: ekran ağacı uiautomator ile
   alınır, metni ya da açıklaması desene uyan ilk düğümün ortasına dokunulur. */
function uiTap(re) {
  let xml = '';
  try { xml = D.adb(['exec-out', 'uiautomator', 'dump', '/dev/tty'], { timeout: 20000 }); } catch (e) { console.error('[uiTap] döküm alınamadı: ' + e.message); return false; }
  // Her düğümün metni ve açıklaması ayrı okunur (çoğunda biri boş)
  for (const m of xml.matchAll(/<node ([^>]*)>/g)) {
    const attr = (k) => { const r = new RegExp(k + '="([^"]*)"').exec(m[1]); return r ? r[1] : ''; };
    if (!re.test(attr('text')) && !re.test(attr('content-desc'))) continue;
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attr('bounds'));
    if (!b) continue;
    D.adb(['shell', 'input', 'tap', String((+b[1] + +b[3]) >> 1), String((+b[2] + +b[4]) >> 1)]);
    return true;
  }
  return false;
}
async function pickInDocumentsUi(name) {
  for (let i = 0; i < 12; i++) {
    await D.sleep(900);
    // Satır açıklaması "ad, boyut, saat" biçiminde
    if (uiTap(new RegExp('^' + name.replace(/\./g, '\\.') + '(,|$)'))) return true;
    // Dosya görünmüyorsa kök listesinden İndirilenler
    // "Kökleri göster" her ekranda var; İndirilenler'e yalnız ilk denemede gidilir. Sonra
    // ızgara ada göre sıralıysa dosya ekranın altında kalabilir: aşağı kaydırılır.
    let xml = '';
    try { xml = D.adb(['exec-out', 'uiautomator', 'dump', '/dev/tty'], { timeout: 20000 }); } catch (e) { continue; }
    if (!/text="(Files in Downloads|İndirilenler'deki dosyalar)"/.test(xml)) {
      if (uiTap(/^(Show roots|Kökleri göster)$/)) { await D.sleep(900); uiTap(/^(Downloads|İndirilenler)$/); }
    } else D.adb(['shell', 'input', 'swipe', '540', '1900', '540', '900', '300']);
  }
  return false;
}

/* GALERİDEN KATMANLAR (Faz 4). Test dosyaları önce İndirilenler'e konur:
     adb push sv-test-clip.mp4 /sdcard/Download/   (640x360, 4 sn)
     adb push sv-test-star.png /sdcard/Download/   (512x512, saydam)
   Katman Ekle → Medya → Video / Görsel Nesneler / Logo; belge seçicide dosyaya dokunulur.
   Video kopyalanmadan /content/ yolundan akmalı ve motorun video öğesi yüklenmeli; görsel
   dataURL olarak ayara girmeli (en çok 1024 px). */
async function mediaCmd() {
  const out = {};
  const pid = await D.launch();
  const page = await D.connect(pid);
  const ev = (js) => page.evaluate(js);
  const last = () => ev("(() => { const l = (window.SVAndroid.config.get().layers || []).slice(-1)[0] || {}; return { kind: l.kind, s: JSON.stringify(l.settings || {}).slice(0, 400) }; })()");
  const add = async (n) => {
    await ev("window.SVShell.open('layers'); 1");
    await D.sleep(700);
    await ev("document.querySelector('#sv-shell .sheet-actions .btn').click(); 1");
    await D.sleep(700);
    await ev("document.querySelectorAll('#sv-shell .pills .pill')[3].click(); 1");
    await D.sleep(400);
    await ev(`document.querySelectorAll('#sv-shell .grid2 .tile')[${n}].click(); document.querySelector('#sv-shell .sheet-foot .btn').click(); 1`);
  };
  try {
    for (let i = 0; i < 50 && !(await ev('!!(window.SVShell && window.SVShell.state().ready)')); i++) await D.sleep(200);
    await D.sleep(1200);
    await ev('window.__probeOrig = JSON.parse(JSON.stringify(window.SVAndroid.config.get())); 1');
    console.error('[media] video');
    await add(0);
    out.videoPicked = await pickInDocumentsUi('sv-test-clip.mp4');
    await D.sleep(3500);
    out.video = await last();
    /* Motorun video öğesi DOM'da değil: adres doğrudan istenir. İzin alınmamış bir içerik
       adresi (kişiler sağlayıcısı) bu yoldan okunamamalı. */
    out.videoFetch = await ev(`(async () => { const l = window.SVAndroid.config.get().layers.slice(-1)[0]; const u = l.settings.media.file;
      const r = await fetch(u); const b = await r.arrayBuffer();
      const bad = 'https://appassets.androidplatform.net/content/' + btoa('content://com.android.contacts/contacts').replace(/=+$/, '').split('+').join('-').split('/').join('_');
      const denied = await fetch(bad).then((x) => x.status, () => 'blocked');
      return { status: r.status, type: r.headers.get('content-type'), bytes: b.byteLength, denied }; })()`);
    out.editOpen = await ev("(document.querySelector('#sv-shell .sheet h2') || {}).textContent || ''");
    await ev('window.SVShell.close(); 1');
    if (arg('shots')) fs.writeFileSync(require('node:path').join(arg('shots'), 'media-video.png'), D.screencap());
    console.error('[media] görsel', JSON.stringify(out.video));
    await add(1);
    out.imagePicked = await pickInDocumentsUi('sv-test-star.png');
    await D.sleep(2500);
    out.image = await last();
    await ev('window.SVShell.close(); 1');
    console.error('[media] logo', JSON.stringify(out.image).slice(0, 80));
    await add(2);
    out.logoPicked = await pickInDocumentsUi('sv-test-star.png');
    await D.sleep(2500);
    out.logo = await last();
    out.listThumbs = await (async () => { await ev("window.SVShell.close(); window.SVShell.open('layers'); 1"); await D.sleep(700);
      return ev("Array.from(document.querySelectorAll('#sv-shell .layer-list img')).map((i) => i.src.slice(0, 22))"); })();
    if (arg('shots')) fs.writeFileSync(require('node:path').join(arg('shots'), 'media-list.png'), D.screencap());
    out.logs = page.logs.filter((l) => /exception|error/i.test(l)).slice(0, 5);
  } finally {
    try { await ev('window.SVShell.close(); window.SVAndroid.config.set(window.__probeOrig); 1'); } catch (e) { /* sayfa gitti */ }
    page.close();
  }
  console.log(JSON.stringify(out, null, 1));
  const vf = out.videoFetch || {};
  const ok = out.videoPicked && out.video.kind === 'media' && out.video.s.indexOf('/content/') >= 0 && vf.status === 200 && vf.type === 'video/mp4' && vf.bytes === 404641
    && (vf.denied === 'blocked' || vf.denied >= 400)
    && out.imagePicked && out.image.kind === 'sprites' && out.image.s.indexOf('data:image/png;base64') >= 0
    && out.logoPicked && out.logo.kind === 'logo' && out.logo.s.indexOf('data:image/png;base64') >= 0
    && out.listThumbs.filter((s) => s.indexOf('data:image/png') === 0).length === 2;
  if (!ok) process.exitCode = 1;
}

/* TELEFONDAN .milk (Faz 4). Dosyalar bu komut yazar ve İndirilenler'e koyar: iki preset
   (.milk ve .milk2, içerikleri her koşuda damgalı ki önceki koşunun tekrarı sayılmasın),
   preset olmayan bir .milk ve bir .txt. Kitaplık başlığındaki "İçe aktar" → belge
   seçicide uzun basışla çoklu seçim → "Seç". Beklenen: 2 eklendi, 1 preset değil, 1 atlandı;
   "Yeni eklenen" süzgecinde iki kutu; motorun listesinde ikisi; kaynak dosyayla aynı (latin1
   "é" dahil). Aynı dosya yeniden seçilince eklenmez, tekrar sayılır. */
function uiPress(re, long) {
  let xml = '';
  try { xml = D.adb(['exec-out', 'uiautomator', 'dump', '/dev/tty'], { timeout: 20000 }); } catch (e) { return false; }
  for (const m of xml.matchAll(/<node ([^>]*)>/g)) {
    const attr = (k) => { const r = new RegExp(k + '="([^"]*)"').exec(m[1]); return r ? r[1] : ''; };
    if (!re.test(attr('text')) && !re.test(attr('content-desc'))) continue;
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attr('bounds'));
    if (!b) continue;
    const x = String((+b[1] + +b[3]) >> 1);
    const y = String((+b[2] + +b[4]) >> 1);
    D.adb(['shell', 'input', long ? 'swipe' : 'tap'].concat(long ? [x, y, x, y, '900'] : [x, y]));
    return true;
  }
  return false;
}
async function milkCmd() {
  const os = require('node:os');
  const path = require('node:path');
  const out = {};
  const shots = arg('shots');
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const shot = (n) => { if (shots) fs.writeFileSync(path.join(shots, n + '.png'), D.screencap()); };
  const stamp = Date.now().toString(36);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-milk-'));
  const files = {
    'sv-probe-a.milk': Buffer.from('[preset00]\nfRating=3.000000\nzoom=1.010000\n// ' + stamp + '\nper_frame_1=wave_r = 0.5 + 0.5*sin(time);\n', 'utf8'),
    // Windows'un 8 bitlik kodlamasıyla "é": UTF-8 değil, latin1 okunmalı
    'sv-probe-b.milk2': Buffer.concat([Buffer.from('[preset00]\nfRating=2.000000\n// caf'), Buffer.from([0xe9]), Buffer.from(' ' + stamp + '\nrot=0.020000\n')]),
    'sv-probe-bad.milk': Buffer.from('bu bir preset değil ' + stamp + '\n', 'utf8'),
    'sv-probe-note.txt': Buffer.from('zoom=1\n', 'utf8'),
  };
  D.adb(['shell', 'rm', '-f', '/sdcard/Download/sv-probe-*']);
  for (const [n, b] of Object.entries(files)) { fs.writeFileSync(path.join(tmp, n), b); D.adb(['push', path.join(tmp, n), '/sdcard/Download/' + n]); }
  fs.rmSync(tmp, { recursive: true, force: true });
  const pid = await D.launch();
  const page = await D.connect(pid);
  const ev = (js) => page.evaluate(js);
  const pick = async (names) => {
    for (let i = 0; i < 12; i++) {
      await D.sleep(900);
      if (uiPress(new RegExp('^' + names[0].replace(/\./g, '\\.') + '(,|$)'), true)) break;
      if (uiPress(/^(Show roots|Kökleri göster)$/)) { await D.sleep(900); uiPress(/^(Downloads|İndirilenler)$/); }
    }
    for (const n of names.slice(1)) { await D.sleep(600); uiPress(new RegExp('^' + n.replace(/\./g, '\\.') + '(,|$)')); }
    await D.sleep(700);
    return uiPress(/^(Select|Seç|SELECT|SEÇ|Open|Aç)$/);
  };
  const status = () => ev("(() => { const b = document.querySelector('#sv-shell .sheet-body .banner'); return b ? b.innerText.trim() : ''; })()");
  try {
    for (let i = 0; i < 50 && !(await ev('!!(window.SVShell && window.SVShell.state().ready)')); i++) await D.sleep(200);
    await D.sleep(1200);
    const before = await ev("window.SVPresets.all().filter((p) => p.kind === 'milkdrop').length");
    await ev('window.SVShellLibrary.pickFor(null); 1');
    await D.sleep(900);
    out.button = await ev("(() => { const b = document.querySelector('#sv-shell .sheet-actions .btn'); if (!b) return false; b.click(); return true; })()");
    out.picked = await pick(['sv-probe-a.milk', 'sv-probe-b.milk2', 'sv-probe-bad.milk', 'sv-probe-note.txt']);
    for (let i = 0; i < 30 && (i === 0 || /okunuyor|Reading/i.test(await status())); i++) await D.sleep(500);
    out.status = await status();
    out.list = await ev(`(() => { const on = document.querySelector('#sv-shell .pills .pill.on'); return { pill: on ? on.innerText.trim() : '', tiles: Array.from(document.querySelectorAll('#sv-shell .grid2 .tile-main')).map((t) => t.getAttribute('aria-label')) }; })()`);
    const all = await ev("window.SVPresets.all().filter((p) => p.kind === 'milkdrop').map((p) => ({ id: p.id, name: p.name }))");
    out.engine = { before, after: all.length };
    const mine = all.filter((p) => /^sv-probe-/.test(p.name));
    out.sources = {};
    for (const p of mine) {
      const src = await ev(`window.api.milkdropPresetSource(${JSON.stringify(p.id)})`);
      if (src.indexOf(stamp) >= 0) out.sources[p.name] = { id: p.id, ok: src === files[p.name + (p.name.endsWith('-b') ? '.milk2' : '.milk')].toString(p.name.endsWith('-b') ? 'latin1' : 'utf8') };
    }
    shot('milk-added');
    // Aynı dosya yeniden: eklenmez, tekrar sayılır
    await ev("document.querySelector('#sv-shell .sheet-actions .btn').click(); 1");
    out.repicked = await pick(['sv-probe-a.milk']);
    for (let i = 0; i < 30 && (i === 0 || /okunuyor|Reading/i.test(await status())); i++) await D.sleep(500);
    out.again = { status: await status(), count: await ev("window.SVPresets.all().filter((p) => p.kind === 'milkdrop').length") };
    out.lang = await ev('window.SVI18n && window.SVI18n.locale');
    out.logs = page.logs.filter((l) => /exception|error/i.test(l)).slice(0, 5);
  } finally {
    try { await ev('window.SVShell.close(); 1'); } catch (e) { /* sayfa gitti */ }
    page.close();
  }
  console.log(JSON.stringify(out, null, 1));
  const en = out.lang === 'en';
  const ok = out.button && out.picked && out.engine.after === out.engine.before + 2
    && (en ? /^2 presets added · 1 not a preset · 1 skipped$/ : /^2 preset eklendi · 1 preset değil · 1 atlandı$/).test(out.status)
    && /Just added|Yeni eklenen/.test(out.list.pill) && out.list.tiles.length === 2
    && out.sources['sv-probe-a'] && out.sources['sv-probe-a'].ok && out.sources['sv-probe-b'] && out.sources['sv-probe-b'].ok
    && out.repicked && out.again.count === out.engine.after && (en ? /^0 presets added · 1 already in the library$/ : /^0 preset eklendi · 1 zaten kitaplıkta$/).test(out.again.status)
    && !out.logs.length;
  if (!ok) process.exitCode = 1;
}

/* KAMERA KATMANI (Faz 4). Uygulamanın kamera izni önce geri alınır; Katmanlar → Ekle →
   Medya → Kamera. Motor kamerayı açarken WebView izin ister, Android'in izin penceresi açılır,
   "uygulamayı kullanırken" seçilir; kamera hazır olmalı (motorun bildirimi, hata yok) ve sahne
   değişmeli. Emülatörün arka kamerası (emulated) kullanılır. Sonda katman silinir. */
async function cameraCmd() {
  const path = require('node:path');
  const shots = arg('shots');
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const shot = (n) => { if (shots) fs.writeFileSync(path.join(shots, n + '.png'), D.screencap()); };
  const out = {};
  try { D.adb(['shell', 'pm', 'revoke', D.PKG, 'android.permission.CAMERA']); } catch (e) { /* zaten yok */ }
  try { D.adb(['shell', 'pm', 'clear-permission-flags', D.PKG, 'android.permission.CAMERA', 'user-set', 'user-fixed']); } catch (e) { /* eski sürüm */ }
  const pid = await D.launch();
  const page = await D.connect(pid);
  const ev = (js) => page.evaluate(js);
  try {
    for (let i = 0; i < 50 && !(await ev('!!(window.SVShell && window.SVShell.state().ready)')); i++) await D.sleep(200);
    await D.sleep(1200);
    await ev('window.__probeOrig = JSON.parse(JSON.stringify(window.SVAndroid.config.get())); 1');
    await ev("window.SVShell.open('layers'); 1");
    await D.sleep(700);
    await ev("document.querySelector('#sv-shell .sheet-actions .btn').click(); 1");
    await D.sleep(700);
    // Medya bölümü, Kamera kutusu, alttaki ekle düğmesi
    out.tile = await ev(`(() => { const p = Array.from(document.querySelectorAll('#sv-shell .pills .pill')).find((b) => /Medya|Media/.test(b.textContent)); if (!p) return 'no-pill'; p.click(); return 1; })()`);
    await D.sleep(600);
    out.tile = await ev(`(() => { const t = Array.from(document.querySelectorAll('#sv-shell .grid2 button, #sv-shell .grid2 .tile-main')).find((b) => /^(Kamera|Camera)$/.test((b.getAttribute('aria-label') || b.textContent || '').trim())); if (!t) return false; t.click(); return true; })()`);
    await D.sleep(400);
    await ev("document.querySelector('#sv-shell .sheet-foot .btn').click(); 1");
    // Android'in izin penceresi: önce reddedilir → uyarı ve "Yeniden Dene"; sonra izin verilir
    out.denied = false;
    for (let i = 0; i < 12 && !out.denied; i++) {
      await D.sleep(800);
      out.denied = uiPress(/^(Don.t allow|İzin verme)$/i);
    }
    for (let i = 0; i < 20 && !(await ev("!!document.querySelector('#sv-shell .sheet-body .banner[role=alert]')")); i++) await D.sleep(500);
    out.deniedBanner = await ev("(() => { const b = document.querySelector('#sv-shell .sheet-body .banner[role=alert]'); return b ? b.innerText.replace(/\\s+/g, ' ').trim() : ''; })()");
    shot('camera-denied');
    await ev("(() => { const b = document.querySelector('#sv-shell .sheet-body .banner[role=alert] .btn'); if (b) b.click(); return !!b; })()");
    out.dialog = false;
    for (let i = 0; i < 12 && !out.dialog; i++) {
      await D.sleep(800);
      out.dialog = uiPress(/^(While using the app|Uygulamayı kullanırken|Only this time|Yalnızca bu sefer)$/i);
    }
    // Motorun kamera kaynağı (katman yığınının medya havuzu) ve kabuğun gösterdiği uyarı
    const camState = () => ev(`(() => { const s = window.SVStage && window.SVStage.stack(); const pool = s && s._mediaPool ? [...s._mediaPool.values()] : [];
      const m = pool.find((x) => x._source === 'webcam'); return { found: !!m, ready: !!(m && m.ready), width: m && m.video ? m.video.videoWidth : 0, error: m ? (m.error || '') : '', warning: window.SVShellLayers.cameraWarning('') }; })()`);
    let st = {};
    for (let i = 0; i < 30; i++) {
      await D.sleep(500);
      st = await camState();
      if (st.ready || st.error) break;
    }
    out.status = st;
    out.banner = await ev("!!document.querySelector('#sv-shell .sheet-body .banner[role=alert]')");
    out.granted = /granted=true/.test((/android\.permission\.CAMERA: granted=\w+/.exec(D.adb(['shell', 'dumpsys', 'package', D.PKG])) || [''])[0]);
    out.layer = await ev("(() => { const l = (window.SVAndroid.config.get().layers || []).slice(-1)[0] || {}; const m = (l.settings || {}).media || {}; return { kind: l.kind, source: m.source, deviceId: m.deviceId }; })()");
    out.page = await ev("(() => { const rows = Array.from(document.querySelectorAll('#sv-shell .sheet-body .row')).map((r) => r.innerText.replace(/\\s+/g, ' ').trim()); return { depth: window.SVShell.state().depth, rows: rows.slice(0, 4) }; })()");
    shot('camera-on');
    // Kamera değiştir: emülatörde tek kamera var, aynı kalır ama ad gelir (izinden sonra kimlik dolu)
    const cams = await ev("navigator.mediaDevices.enumerateDevices().then((l) => l.filter((d) => d.kind === 'videoinput').map((d) => ({ id: !!d.deviceId, label: d.label })))");
    out.cameras = cams;
    out.logs = page.logs.filter((l) => /exception|error/i.test(l) && !/favicon/.test(l)).slice(0, 5);
  } finally {
    try { await ev('window.SVShell.close(); window.SVAndroid.config.set(window.__probeOrig); 1'); } catch (e) { /* sayfa gitti */ }
    page.close();
  }
  console.log(JSON.stringify(out, null, 1));
  const ok = out.tile === true && out.denied && /(permission|izni)/i.test(out.deniedBanner) && /(Retry|Yeniden Dene)/.test(out.deniedBanner) && out.dialog && out.granted && out.layer.kind === 'media' && out.layer.source === 'webcam'
    && out.status.ready && out.status.width > 0 && !out.status.error && !out.status.warning && !out.banner && out.cameras.length >= 1 && out.cameras.every((c) => c.id) && !out.logs.length;
  if (!ok) process.exitCode = 1;
}

/* DIŞA AKTARMA EKRANI (Faz 5). Şarkı önce İndirilenler'e konur:
     adb push sv-test-song.m4a /sdcard/Download/   (AAC, 20 sn)
   Sahne kartındaki düğme → Dışa Aktar sayfası → şarkı belge seçiciden → 720p 30 fps, 30 sn
   (şarkı 20 sn: tamamı) → motor dışa aktarım sayfasına geçer, ilerleme kartı görünür → dosya
   galeriye (MediaStore, Movies/SoundVisualizer) kaydedilir → Bitti → sahneye dönülür.
   Galerideki dosyanın süresi ve boyutu ffprobe yerine MediaStore'dan okunur. */
async function exportUiCmd() {
  const path = require('node:path');
  const shots = arg('shots');
  const shot = (n) => { if (shots) fs.writeFileSync(path.join(shots, n + '.png'), D.screencap()); };
  const out = {};
  const pid = await D.launch();
  const page = await D.connect(pid);
  const ev = (js) => page.evaluate(js);
  try {
    for (let i = 0; i < 50 && !(await ev('!!(window.SVShell && window.SVShell.state().ready)')); i++) await D.sleep(200);
    await D.sleep(1500);
    // Kodek ve kalite (--codec=avc|hevc, --quality=low|mid|high): sayfanın yerel tercihine yazılır
    out.caps = await ev('window.SVAndroid.exportCaps()');
    const want = out.want = { codec: arg('codec') || 'avc', quality: arg('quality') || 'mid' };
    await ev(`(() => { let p = {}; try { p = JSON.parse(localStorage.getItem('sv-export') || '{}'); } catch (e) { p = {}; } Object.assign(p, ${JSON.stringify(want)}, { v: 2 }); localStorage.setItem('sv-export', JSON.stringify(p)); return 1; })()`);
    await ev(`document.querySelector('#sv-shell .scene-card [aria-label="Dışa Aktar"], #sv-shell .scene-card [aria-label="Export"]').click(); 1`);
    await D.sleep(800);
    out.page = await ev("(document.querySelector('#sv-shell .sheet h2') || {}).textContent || ''");
    await ev("Array.from(document.querySelectorAll('#sv-shell .sheet-body .btn')).find((b) => /Seç|Choose/.test(b.textContent)).click(); 1");
    // --song=sv-test-song.mp3: AAC olmayan şarkı (AudioPrep çevirir); varsayılan m4a
    const songFile = arg('song') || 'sv-test-song.m4a';
    out.songFile = songFile;
    out.songPicked = await pickInDocumentsUi(songFile);
    await D.sleep(1500);
    out.song = await ev("(document.querySelector('#sv-shell .sheet-body .row-title') || {}).textContent || ''");
    shot('export-1-sheet');
    const t0 = Date.now();
    await ev("document.querySelector('#sv-shell .sheet-foot .btn').click(); 1");
    // Motor dışa aktarım sayfasına geçer; aynı DevTools hedefi yeni sayfayı yükler
    let st = null;
    for (let i = 0; i < 600; i++) {
      await D.sleep(1000);
      try {
        st = await ev("window.SVExport ? Object.assign(window.SVExport.state(), { page: (window.__SV_ANDROID || {}).page, title: (document.querySelector('#sv-shell .export-card h2') || {}).textContent }) : null");
      } catch (e) { st = null; }
      if (st && i === 8) shot('export-2-running');
      if (st && (/Galeriye kaydedildi|Saved to the gallery/.test(st.title || '') || st.error)) break;
    }
    out.export = st && { page: st.page, title: st.title, progress: st.progress, result: st.result && { bytes: st.result.bytes, frames: st.result.frames }, error: st.error, seconds: Math.round((Date.now() - t0) / 1000) };
    shot('export-3-done');
    // Galeride mi
    const q = D.adb(['shell', 'content', 'query', '--uri', 'content://media/external/video/media', '--projection', '_display_name:relative_path:duration:width:height:date_added', '--sort', 'date_added']);
    out.gallery = q.split(/\r?\n/).filter((l) => /SoundVisualizer/.test(l)).slice(-1)[0] || '';
    // Videoda ses izi var mı: galerideki dosya bilgisayara alınıp ffprobe ile bakılır
    const mp4 = (/_display_name=([^,]+\.mp4)/.exec(out.gallery) || [])[1];
    if (mp4) {
      const local = path.join(require('node:os').tmpdir(), 'sv-export-check.mp4');
      try {
        D.adb(['pull', '/sdcard/Movies/SoundVisualizer/' + mp4, local], { timeout: 60000 });
        const pr = require('node:child_process').execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,duration,bit_rate', '-of', 'json', local], { encoding: 'utf8' });
        const st = JSON.parse(pr).streams;
        out.streams = st.map((x) => x.codec_type + ':' + x.codec_name + ':' + Math.round(+x.duration || 0));
        const v = st.find((x) => x.codec_type === 'video');
        out.videoKbps = v ? Math.round((+v.bit_rate || 0) / 1000) : 0;
      } catch (e) { out.streams = ['probe-failed: ' + String(e.message).split('\n')[0]]; }
      fs.rmSync(local, { force: true });
    }
    // Bitti → sahne
    await ev("Array.from(document.querySelectorAll('#sv-shell .export-card .btn')).find((b) => /Bitti|Done/.test(b.textContent)).click(); 1");
    let back = false;
    for (let i = 0; i < 30 && !back; i++) { await D.sleep(500); try { back = await ev("!!(window.SVShell && (window.__SV_ANDROID || {}).page === 'src/visualizer/index.html')"); } catch (e) { back = false; } }
    out.backToScene = back;
    out.logs = page.logs.filter((l) => /exception|error/i.test(l)).slice(0, 5);
  } finally { page.close(); }
  console.log(JSON.stringify(out, null, 1));
  const ok = out.page && out.songPicked && out.song.indexOf(out.songFile.replace(/\.[^.]+$/, '')) >= 0 && out.export && !out.export.error && out.export.page === 'src/exporter/index.html'
    && out.export.result && out.export.result.frames > 0 && out.export.result.frames === out.export.progress[1] && /Movies\/SoundVisualizer/.test(out.gallery) && /width=1280/.test(out.gallery) && out.backToScene
    // Videoda AAC ses izi olmalı (şarkı MP3 olsa da)
    && Array.isArray(out.streams) && out.streams.some((x) => /^audio:aac:/.test(x)) && out.streams.some((x) => /^video:/.test(x))
    // İstenen kodek (H.265 yalnız cihazda varsa; yoksa H.264'e düşer)
    && out.streams.some((x) => x.indexOf('video:' + (out.want && out.want.codec === 'hevc' && out.caps && out.caps.hevc ? 'hevc' : 'h264') + ':') === 0);
  if (!ok) process.exitCode = 1;
}

/* SEÇİM KUTUSU VE RENK SEÇİCİ, GERÇEK DOKUNUŞLA. Yerel <select> ve input type=color
   uygulama bağlamlı WebView'de Android'in penceresini açamıyordu; değer JS ile yazıldığı
   için öbür yoklamalar bunu görmedi. Burada adb ile dokunulur: liste açılmalı, seçilen
   değer ayara yazılmalı, geri tuşu listeyi kapatmalı; renk seçici açılmalı, hazır renk ve
   Tamam değeri vermeli. */
async function pickersCmd() {
  const out = {};
  const pid = await D.launch();
  const page = await D.connect(pid);
  const ev = (js) => page.evaluate(js);
  const tapAt = async (sel) => {
    const p = await ev(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); if (!s) return null; s.scrollIntoView({ block: 'center' }); const b = s.getBoundingClientRect(); return [Math.round((b.left + b.width / 2) * devicePixelRatio), Math.round((b.top + b.height / 2) * devicePixelRatio)]; })()`);
    if (!p) return false;
    await D.sleep(300);
    D.adb(['shell', 'input', 'tap', String(p[0]), String(p[1])]);
    await D.sleep(900);
    return true;
  };
  try {
    for (let i = 0; i < 50 && !(await ev('!!(window.SVShell && window.SVShell.state().ready)')); i++) await D.sleep(200);
    await D.sleep(800);
    const vj0 = await ev('JSON.stringify(window.SVAndroid.config.get().autovj || {})');
    await ev("window.SVAndroid.config.patch({ autovj: Object.assign({}, window.SVAndroid.config.get().autovj, { enabled: true, source: 'visualizers' }) }); 1");
    await ev("document.querySelector('#sv-shell nav [data-tab=audio]').click(); 1");
    await D.sleep(1200);
    await tapAt('#sv-shell .sheet .select-btn');
    out.choices = await ev("document.querySelectorAll('#sv-shell .choice').length");
    await tapAt('#sv-shell .choice[data-v=scenes]');
    out.source = await ev('window.SVAndroid.config.get().autovj.source');
    await tapAt('#sv-shell .sheet .select-btn');
    D.adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
    await D.sleep(800);
    out.back = await ev("({ dialog: !!document.querySelector('#sv-shell .dialog-scrim'), sheet: window.SVShell.state().sheet })");
    await ev(`window.SVAndroid.config.patch({ autovj: ${vj0} }); window.SVShell.close(); 1`);
    await D.sleep(500);
    await ev("(() => { window.__pk = []; const r = window.SVShellUI.color({ label: 'Renk', value: '#ff2d3a', onChange: (v) => window.__pk.push(v) }); const d = document.createElement('div'); d.id = 'pk'; d.className = 'live'; d.style.cssText = 'position:absolute;left:20px;right:20px;top:300px;z-index:4'; d.appendChild(r); document.querySelector('#sv-shell').appendChild(d); })(); 1");
    await tapAt('#pk .swatch');
    out.colorOpen = await ev("!!document.querySelector('#sv-shell .color-dialog')");
    const want = await ev("document.querySelectorAll('#sv-shell .qcolor')[3] ? document.querySelectorAll('#sv-shell .qcolor')[3].getAttribute('aria-label') : ''");
    await tapAt('#sv-shell .qcolor:nth-child(4)');
    await tapAt('#sv-shell .color-dialog .btn.primary');
    out.color = await ev("({ got: window.__pk.slice(-1)[0] || '', open: !!document.querySelector('#sv-shell .color-dialog') })");
    out.color.want = want;
    await ev("document.getElementById('pk').remove(); 1");
    out.logs = page.logs.filter((l) => /exception|error/i.test(l)).slice(0, 5);
  } finally {
    page.close();
  }
  console.log(JSON.stringify(out, null, 1));
  const ok = out.choices === 5 && out.source === 'scenes' && !out.back.dialog && out.back.sheet
    && out.colorOpen && out.color.want && out.color.got === out.color.want && !out.color.open && !out.logs.length;
  if (!ok) process.exitCode = 1;
}

/* ÇALAN PARÇA (media/NowPlaying.kt). Bildirim erişimi adb ile verilir; emülatörde oturum
   açılmadan çalan başka bir uygulama olmadığı için, yalnız geliştirme sürümündeki
   `debugNowPlayingSelf` ile uygulamanın kendi çaları "başka uygulama" sayılır. Medya
   oturumundan ad, sanatçı, süre ve ilerleyen konum gelmeli; Ses sekmesindeki kart parçayı
   göstermeli. Sonda erişim geri alınır. */
async function nowPlayingCmd() {
  const path = require('node:path');
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const FF = require(path.join(__dirname, '..', '..', 'node_modules', 'ffmpeg-static'));
  const name = 'sv-probe-np.m4a';
  const local = path.join(os.tmpdir(), name);
  execFileSync(FF, ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=30:sample_rate=48000',
    '-ac', '2', '-c:a', 'aac', '-b:a', '128k', '-metadata', 'title=Probe Session', '-metadata', 'artist=CaYaDev', '-metadata', 'album=Probe Album', local]);
  D.adb(['push', local, '/data/local/tmp/' + name]);
  D.adb(['shell', `run-as ${D.PKG} sh -c 'mkdir -p files/media && cp /data/local/tmp/${name} files/media/${name}'`]);
  const comp = D.PKG + '/' + D.PKG + '.media.NowPlayingService';
  const out = {};
  // Önce erişimsiz: kart erişim istemeli
  D.adb(['shell', 'cmd', 'notification', 'disallow_listener', comp]);
  let pid = await D.launch();
  let page = await D.connect(pid);
  const ev = (js) => page.evaluate(js);
  try {
    for (let i = 0; i < 50 && !(await ev('!!(window.SVShell && window.SVShell.state().ready)')); i++) await D.sleep(200);
    out.before = await ev('window.SVAndroid.nowPlaying.status()');
    await ev("document.querySelector('#sv-shell nav [data-tab=audio]').click(); 1");
    await D.sleep(1200);
    out.askCard = await ev("!!Array.from(document.querySelectorAll('#sv-shell .np-card .btn')).find((b) => /Erişim ver|Grant access/.test(b.textContent))");
  } finally { page.close(); }
  D.adb(['shell', 'cmd', 'notification', 'allow_listener', comp]);
  pid = await D.launch();
  page = await D.connect(pid);
  try {
    for (let i = 0; i < 50 && !(await ev('!!(window.SVShell && window.SVShell.state().ready)')); i++) await D.sleep(200);
    out.after = await ev('window.SVAndroid.nowPlaying.status().then((r) => r.enabled)');
    await ev("window.__svHost.request('debugNowPlayingSelf', { on: true })");
    out.open = await ev(`window.SVAndroid.player.open(${JSON.stringify(name)}, true).then((v) => ({ ok: true, title: v.title }), (e) => ({ ok: false, err: e.message }))`);
    await D.sleep(2500);
    const a = await ev('window.SVAndroid.nowPlaying.system()');
    await D.sleep(3000);
    const b = await ev('window.SVAndroid.nowPlaying.system()');
    const posAt = (s) => s.position + (s.playing ? (Date.now() - s.updated) / 1000 : 0);
    out.session = a && { has: a.has, playing: a.playing, title: a.title, artist: a.artist, album: a.album, app: a.app, duration: Math.round(a.duration) };
    out.moved = !!(a && b && b.playing && b.position + 0.5 >= a.position);
    await ev("document.querySelector('#sv-shell nav [data-tab=audio]').click(); 1");
    await D.sleep(1200);
    out.card = await ev("(document.querySelector('#sv-shell .np-card .row-title') || {}).textContent || ''");
    await ev('window.SVAndroid.player.pause()');
    await D.sleep(1500);
    const c = await ev('window.SVAndroid.nowPlaying.system()');
    out.paused = c && c.playing === false;
    await ev("window.__svHost.request('debugNowPlayingSelf', { on: false })");
    void posAt;
    out.logs = page.logs.filter((l) => /exception|error/i.test(l)).slice(0, 5);
  } finally {
    try { await ev('window.SVShell.close(); window.SVAndroid.player.stop && window.SVAndroid.player.stop(); 1'); } catch (e) { /* sayfa gitti */ }
    page.close();
    D.adb(['shell', 'cmd', 'notification', 'disallow_listener', comp]);
  }
  console.log(JSON.stringify(out, null, 1));
  const ok = out.before && out.before.enabled === false && out.askCard && out.after === true && out.open.ok
    && out.session && out.session.has && out.session.playing && out.session.title === 'Probe Session' && out.session.artist === 'CaYaDev' && out.session.duration === 30
    && out.moved && out.card === 'Probe Session' && out.paused && !out.logs.length;
  if (!ok) process.exitCode = 1;
}

/* GÖMÜLÜ SÖZ (masaüstündeki otomatik söz bulmanın "gömülü" adımı). Şarkı önce İndirilenler'e:
     adb push sv-test-lyrics.mp3 /sdcard/Download/   (ID3v2.4: SYLT milisaniye + USLT)
   Otomatik söz açık, sahnede çalan parçayı izleyen söz katmanı; şarkı uygulama içi çalarda
   açılınca motorun söz listesine "gömülü" kaynaklı otomatik söz gelmeli (zamanlı olan, SYLT).
   Ayrıştırma ortak modülde (src/shared/id3-lyrics.js), uygulama yalnız etiketi okur. */
async function embeddedCmd() {
  const out = {};
  const pid = await D.launch();
  const page = await D.connect(pid);
  const ev = (js) => page.evaluate(js);
  let keep = null;
  try {
    for (let i = 0; i < 50 && !(await ev('!!(window.SVShell && window.SVShell.state().ready)')); i++) await D.sleep(200);
    await D.sleep(800);
    keep = await ev('JSON.stringify({ layers: window.SVAndroid.config.get().layers || [], lyricsLookup: window.SVAndroid.config.get().lyricsLookup || null })');
    await ev(`(() => { const c = window.SVAndroid.config.get(); const made = window.SVLayers.makeTextLayer({ source: 'lyrics', lyricsFollow: true, content: '' }); window.SVAndroid.config.patch({ layers: (c.layers || []).concat([made]), lyricsLookup: Object.assign({}, c.lyricsLookup, { enabled: true, embedded: true, providers: [] }) }); return 1; })()`);
    await D.sleep(400);
    await ev('window.SVAndroid.player.pick().catch(() => {}); 1');
    out.picked = await pickInDocumentsUi('sv-test-lyrics.mp3');
    for (let i = 0; i < 30 && !(await ev('!!(window.SVAndroid.player.state() || {}).has')); i++) await D.sleep(300);
    await ev('window.SVAndroid.player.play(); 1');
    let item = null;
    for (let i = 0; i < 30 && !item; i++) {
      await D.sleep(400);
      item = await ev("((window.SVLyricsLib && window.SVLyricsLib.items) || []).find((x) => x && x.auto) || null");
    }
    out.item = item && { auto: item.auto, title: item.title, artist: item.artist, text: String(item.text || '').slice(0, 80) };
    out.player = await ev('(() => { const p = window.SVAndroid.player.state(); return { title: p.title, artist: p.artist }; })()');
    out.logs = page.logs.filter((l) => /exception/i.test(l)).slice(0, 5);
  } finally {
    try { await ev(`window.SVAndroid.player.pause(); (() => { const k = ${keep || '{}'}; window.SVAndroid.config.patch({ layers: k.layers || [], lyricsLookup: k.lyricsLookup || undefined }); return 1; })()`); } catch (e) { /* sayfa gitti */ }
    page.close();
  }
  console.log(JSON.stringify(out, null, 1));
  const ok = out.picked && out.item && out.item.auto === 'embedded' && /^\[00:00\.50\]Gömülü söz bir/.test(out.item.text) && !out.logs.length;
  if (!ok) process.exitCode = 1;
}

/* ŞARKI SÖZLERİ (store/LyricsLibrary.kt, src/mobile/shell-lyrics.js). Söz dosyası belge
   seçiciyle eklenir; sanatçı ve parça adı dosya adından çıkmalı ("CaYaDev - Probe Lyrics").
   Motor kitaplığı almalı; aynı adlı parça uygulama içi çalarda çalarken söz katmanının
   eşleşmesi kitaplıktan ve saati parçanın konumundan olmalı. Sonda kayıtlar silinir. */
async function lyricsCmd() {
  const path = require('node:path');
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const FF = require(path.join(__dirname, '..', '..', 'node_modules', 'ffmpeg-static'));
  const stamp = Date.now().toString(36);
  const lrcName = 'CaYaDev - Probe Lyrics.lrc';
  const lrc = '[00:00.50]Birinci satır ' + stamp + '\n[00:02.00]İkinci satır\n[00:04.00]Üçüncü satır\n[00:30.00]Son\n';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-lyr-'));
  fs.writeFileSync(path.join(tmp, lrcName), lrc);
  D.adb(['shell', 'rm', '-f', '/sdcard/Download/' + lrcName.replace(/ /g, '\\ ')]);
  D.adb(['push', path.join(tmp, lrcName), '/sdcard/Download/' + lrcName]);
  const song = 'sv-probe-lyr.m4a';
  execFileSync(FF, ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=30:sample_rate=48000',
    '-ac', '2', '-c:a', 'aac', '-b:a', '128k', '-metadata', 'title=Probe Lyrics', '-metadata', 'artist=CaYaDev', path.join(tmp, song)]);
  D.adb(['push', path.join(tmp, song), '/data/local/tmp/' + song]);
  D.adb(['shell', `run-as ${D.PKG} sh -c 'mkdir -p files/media && cp /data/local/tmp/${song} files/media/${song}'`]);
  fs.rmSync(tmp, { recursive: true, force: true });
  const out = {};
  const pid = await D.launch();
  const page = await D.connect(pid);
  const ev = (js) => page.evaluate(js);
  let layers0 = null;
  try {
    for (let i = 0; i < 50 && !(await ev('!!(window.SVShell && window.SVShell.state().ready)')); i++) await D.sleep(200);
    await D.sleep(800);
    layers0 = await ev('JSON.stringify(window.SVAndroid.config.get().layers || [])');
    const n0 = await ev('window.SVAndroid.lyrics.list().then((l) => l.length)');
    // Kitaplık → Sözler → Söz Dosyası Ekle
    await ev("window.SVShellLibrary.lyrics(); 1");
    await D.sleep(1200);
    await ev("Array.from(document.querySelectorAll('#sv-shell .sheet-body .btn')).find((b) => /Söz Dosyası Ekle|Add Lyrics Files/.test(b.textContent)).click(); 1");
    let picked = false;
    for (let i = 0; i < 12 && !picked; i++) {
      await D.sleep(900);
      picked = uiPress(/^CaYaDev - Probe Lyrics\.lrc(,|$)/, true);
      if (!picked && uiPress(/^(Show roots|Kökleri göster)$/)) { await D.sleep(900); uiPress(/^(Downloads|İndirilenler)$/); }
    }
    await D.sleep(700);
    out.picked = picked && uiPress(/^(Select|Seç|SELECT|SEÇ|Open|Aç)$/);
    for (let i = 0; i < 20; i++) { await D.sleep(500); if (await ev("!!document.querySelector('#sv-shell .sheet-body .banner')")) break; }
    out.status = await ev("(document.querySelector('#sv-shell .sheet-body .banner') || {}).innerText || ''");
    const list = await ev('window.SVAndroid.lyrics.list()');
    out.count = list.length - n0;
    const mine = list.find((x) => x.artist === 'CaYaDev' && x.title === 'Probe Lyrics');
    out.guessed = !!mine;
    await D.sleep(600);
    out.engine = await ev(`(window.SVLyricsLib && window.SVLyricsLib.items || []).some((x) => x.text && x.text.indexOf(${JSON.stringify(stamp)}) >= 0)`);
    // Söz katmanı (çalan parçayı izler) ve aynı adlı parça
    await ev(`(() => { const c = window.SVAndroid.config.get(); const L = window.SVLayerFactory || null; const made = window.SVLayers.makeTextLayer({ source: 'lyrics', lyricsFollow: true, content: '' }); window.SVAndroid.config.patch({ layers: (c.layers || []).concat([made]) }); return 1; })()`);
    out.open = await ev(`window.SVAndroid.player.open(${JSON.stringify(song)}, true).then((v) => ({ ok: true }), (e) => ({ ok: false, err: e.message }))`);
    await D.sleep(3500);
    out.playback = await ev(`(() => { const S = window.SVLyricsSync; const live = window.SVNowLive && window.SVNowLive.state; const r = S.playback({ windows: true, follow: true, match: 'exact', library: window.SVLyricsLib.items, live, nowMs: Date.now() }); return r && { source: r.source, time: r.time == null ? null : Math.round(r.time * 10) / 10, item: r.item && r.item.title, live: live && live.title }; })()`);
    out.follows = await ev('window.SVAndroid.lyrics.follows()');
    // Temizlik: eklenen söz silinir
    if (mine) await ev(`window.SVAndroid.lyrics.remove(${JSON.stringify(mine.id)})`);
    out.after = await ev('window.SVAndroid.lyrics.list().then((l) => l.length)') - n0;
    out.logs = page.logs.filter((l) => /exception|error/i.test(l)).slice(0, 5);
  } finally {
    try { await ev(`window.SVAndroid.player.pause(); window.SVAndroid.config.patch({ layers: ${layers0 || '[]'} }); window.SVShell.close(); 1`); } catch (e) { /* sayfa gitti */ }
    page.close();
  }
  console.log(JSON.stringify(out, null, 1));
  const ok = out.picked && out.count === 1 && out.guessed && out.engine && out.open.ok && out.follows
    && out.playback && out.playback.source === 'library' && out.playback.item === 'Probe Lyrics' && out.playback.time > 1 && out.after === 0 && !out.logs.length;
  if (!ok) process.exitCode = 1;
}

/* YÜZEN PENCEREDE KAMERA (media/CameraService.kt). Kamera katmanı açıkken yüzen pencere
   açılır; uygulama arkadayken kamera yeniden açılır (retry damgası). Kamera ön plan hizmeti
   çalışmalı ve kamera kare vermeli (zaman ilerlemeli). Ölçüldü: hizmet olmadan yeniden
   açılan kamera hiç kare vermiyor (zaman 0'da kalıyor). Pencere kapanınca hizmet durmalı. */
async function floatCamCmd() {
  D.adb(['shell', 'pm', 'grant', D.PKG, 'android.permission.CAMERA']);
  D.adb(['shell', 'appops', 'set', D.PKG, 'SYSTEM_ALERT_WINDOW', 'allow']);
  const out = {};
  const pid = await D.launch();
  const page = await D.connect(pid);
  const ev = (js) => page.evaluate(js);
  let layers0 = '[]';
  try {
    for (let i = 0; i < 50 && !(await ev('!!(window.SVShell && window.SVShell.state().ready)')); i++) await D.sleep(200);
    await D.sleep(800);
    layers0 = await ev('JSON.stringify(window.SVAndroid.config.get().layers || [])');
    await ev("(() => { const c = window.SVAndroid.config.get(); const made = window.SVLayerFactory.makeMedia('camera', {}, window.SV.defaultConfig()); made.id = 'ly_camprobe'; window.SVAndroid.config.patch({ layers: (c.layers || []).concat([made]) }); return 1; })()");
    const cam = "(() => { const st = window.SVStage.stack(); const pool = st && st._mediaPool ? [...st._mediaPool.values()] : []; const m = pool.find((x) => x._source === 'webcam'); return m ? { ready: !!m.ready, w: m.video ? m.video.videoWidth : 0, t: m.video ? m.video.currentTime : 0, err: m.error || '' } : null; })()";
    for (let i = 0; i < 30; i++) { await D.sleep(500); out.before = await ev(cam); if (out.before && (out.before.ready || out.before.err)) break; }
    out.open = await ev("window.SVAndroid.floating.open().then(() => 'ok', (e) => e.message)");
    await D.sleep(3000);
    out.service = /CameraService/.test(D.adb(['shell', 'dumpsys', 'activity', 'services', D.PKG]));
    // Uygulama arkadayken kamera yeniden açılır
    await ev("(() => { const c = window.SVAndroid.config.get(); const l = (c.layers || []).map((x) => x.id === 'ly_camprobe' ? Object.assign({}, x, { settings: Object.assign({}, x.settings, { media: Object.assign({}, x.settings.media, { retry: Date.now() }) }) }) : x); window.SVAndroid.config.patch({ layers: l }); return 1; })()");
    await D.sleep(5000);
    const a = await ev(cam);
    await D.sleep(2000);
    const b = await ev(cam);
    out.reopened = { w: a && a.w, advanced: !!(a && b && b.t > a.t + 1) };
    await ev('window.SVAndroid.floating.close()');
    await D.sleep(2500);
    out.serviceAfter = /CameraService/.test(D.adb(['shell', 'dumpsys', 'activity', 'services', D.PKG]));
    out.logs = page.logs.filter((l) => /exception/i.test(l)).slice(0, 5);
  } finally {
    try { await ev('window.SVAndroid.config.patch({ layers: ' + layers0 + ' }); 1'); } catch (e) { /* sayfa gitti */ }
    page.close();
  }
  console.log(JSON.stringify(out, null, 1));
  const ok = out.before && out.before.ready && out.open === 'ok' && out.service && out.reopened.w > 0 && out.reopened.advanced && !out.serviceAfter && !out.logs.length;
  if (!ok) process.exitCode = 1;
}

/* ZAMAN ÇİZELGESİ (docs/android/TIMELINE.tr.md). Gerçek dokunuşla: seç, sürükle (ölçüye hizalı),
   dikeyde başka parçaya taşı, sağ kenardan kırp, iki parmakla yakınlaştır (CDP dokunma olayı;
   adb tek parmak), boşta uzun bas (bağlam menüsü), geri al; "Timeline kullan" açılınca motor
   oynatma kafasındaki bileşimi kendisi çizer (SVShowDebug.time/composed), oynatınca kafa
   ilerler; çift dokunuş denetçiyi açar; dışa aktarma "Zaman çizelgesiyle" videoyu çizelgeden
   çizer (iki anın karesi belirgin farklı). Çizelge tuvalde: konumlar _layout()'tan. */
async function timelineCmd() {
  const path = require('node:path');
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const FF = require(path.join(__dirname, '..', '..', 'node_modules', 'ffmpeg-static'));
  const out = {};
  const pid = await D.launch();
  const page = await D.connect(pid);
  const ev = (js) => page.evaluate(js);
  let keep = null;
  try {
    for (let i = 0; i < 50 && !(await ev('!!(window.SVShell && window.SVShell.state().ready)')); i++) await D.sleep(200);
    await D.sleep(800);
    keep = await ev('JSON.stringify({ scenes: window.SVAndroid.config.get().scenes || [], timeline: window.SVAndroid.config.get().timeline || null })');
    // İki şablondan iki sahne; iki klip parçası (ikincisi boş) ve bir otomasyon parçası
    await ev(`(() => {
      const T = window.SVTemplates; const SV = window.SV; const keys = window.SVSchema.SCENE_KEYS;
      const mk = (id, tid) => { const next = T.apply(JSON.parse(JSON.stringify(window.SVAndroid.config.get())), T.TEMPLATES.find((x) => x.id === tid), { defaultConfig: SV.defaultConfig, deepMerge: SV.deepMerge, clone: SV.clone }); const data = {}; for (const k of keys) if (next[k] !== undefined) data[k] = next[k]; return { id, name: id, data }; };
      const scenes = [mk('sc_tl_a', 'amb-aurora'), mk('sc_tl_b', 'club-laser')];
      const TL = window.SVTimeline;
      const t1 = TL.makeTrack({ id: 'trk_a', kind: 'clip', name: 'Sahneler', clips: [TL.makeClip({ id: 'clip_tl_a', type: 'scene', ref: 'sc_tl_a', start: 0, dur: 4 }), TL.makeClip({ id: 'clip_tl_b', type: 'scene', ref: 'sc_tl_b', start: 4, dur: 4 })] });
      const t2 = TL.makeTrack({ id: 'trk_b', kind: 'clip', name: 'İkinci' });
      const t3 = TL.makeTrack({ id: 'trk_c', kind: 'automation', name: 'Opaklık', target: 'master', min: 0, max: 1, keys: [{ t: 0, v: 1 }, { t: 8, v: 1 }] });
      const tl = { id: 'tl1', name: 'Probe', tempo: [{ t: 0, bpm: 120, beatsPerBar: 4 }], tracks: [t1, t2, t3], markers: [], loop: { enabled: false, start: 0, end: 0 }, snap: 'bar', useTimeline: false, enabled: false };
      window.SVAndroid.config.patch({ scenes, timeline: tl });
      return 1;
    })()`);
    await ev("document.querySelector('#sv-shell .scene-card [aria-label=\"Zaman Çizelgesi\"], #sv-shell .scene-card [aria-label=\"Timeline\"]').click(); 1");
    await D.sleep(1500);
    const dpr = await ev('devicePixelRatio');
    const lay = () => ev('window.SVShellTimeline._layout()');
    const st = () => ev('window.SVShellTimeline._state()');
    const tlc = () => ev('JSON.parse(JSON.stringify(window.SVAndroid.config.get().timeline))');
    const clipOf = (tl, id) => { for (const t of tl.tracks) for (const c of t.clips || []) if (c.id === id) return Object.assign({ track: t.id }, c); return null; };
    const px = (v) => String(Math.round(v * dpr));
    const tap = async (x, y) => { D.adb(['shell', 'input', 'tap', px(x), px(y)]); await D.sleep(500); };
    const swipe = async (x0, y0, x1, y1, ms) => { D.adb(['shell', 'input', 'swipe', px(x0), px(y0), px(x1), px(y1), String(ms || 700)]); await D.sleep(900); };
    let L = await lay();
    out.clips = L.clips.length;
    out.rows = L.rows.length;
    const barPx = L.zoom * 2; // 120 BPM, 4/4: ölçü 2 sn
    const B = () => L.clips.find((c) => c.id === 'clip_tl_b');
    // Seç
    await tap(B().x + B().w / 2, B().y + B().h / 2);
    out.selected = ((await st()).sel || {}).clipId;
    // Sürükle: yaklaşık 1,3 ölçü sağa → ölçüye hizalı
    await swipe(B().x + B().w / 2, B().y + B().h / 2, B().x + B().w / 2 + barPx * 1.3, B().y + B().h / 2, 800);
    let c = clipOf(await tlc(), 'clip_tl_b');
    out.moved = c && c.start;
    // Dikeyde ikinci parçaya
    L = await lay();
    const row2 = L.rows.find((r) => r.id === 'trk_b');
    await swipe(B().x + B().w / 2, B().y + B().h / 2, B().x + B().w / 2, row2.y + row2.h / 2, 800);
    c = clipOf(await tlc(), 'clip_tl_b');
    out.track = c && c.track;
    // Sağ kenardan kırp: tutamaç klibin dışında (14 px), bir ölçü uzat
    L = await lay();
    await swipe(B().x + B().w + 7, B().y + B().h / 2, B().x + B().w + 7 + barPx, B().y + B().h / 2, 800);
    c = clipOf(await tlc(), 'clip_tl_b');
    out.dur = c && c.dur;
    // Geri al: kırpma geri gelir
    await ev("(() => { const b = document.querySelector('#sv-shell .sheet-actions [aria-label=\"Geri Al\"], #sv-shell .sheet-actions [aria-label=\"Undo\"]'); b.click(); return 1; })()");
    await D.sleep(500);
    c = clipOf(await tlc(), 'clip_tl_b');
    out.undoDur = c && c.dur;
    // İki parmakla yakınlaştır (CDP dokunma): parmaklar 60 px → 180 px
    L = await lay();
    const z0 = L.zoom;
    const cy = L.rows[0].y + L.rows[0].h / 2;
    const cx = L.ruler.x + L.ruler.w / 2;
    const touch = (type, pts) => page.call('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i + 1 })) });
    await touch('touchStart', [[cx - 30, cy], [cx + 30, cy]]);
    for (let k = 1; k <= 6; k++) { await touch('touchMove', [[cx - 30 - k * 10, cy], [cx + 30 + k * 10, cy]]); await D.sleep(30); }
    await touch('touchEnd', []);
    await D.sleep(400);
    out.zoom = [z0, (await lay()).zoom];
    // Boşta uzun bas: bağlam menüsü (otomasyon şeridinde klip yok)
    L = await lay();
    const r3 = L.rows.find((r) => r.id === 'trk_c');
    D.adb(['shell', 'input', 'swipe', px(L.ruler.x + 40), px(r3.y + r3.h - 8), px(L.ruler.x + 40), px(r3.y + r3.h - 8), '900']);
    await D.sleep(700);
    out.menu = await ev("Array.from(document.querySelectorAll('#sv-shell .dialog-scrim .choice')).map((b) => b.textContent).slice(0, 4)");
    await ev("(() => { const s = document.querySelector('#sv-shell .dialog-scrim'); if (s) s.click(); return 1; })()");
    await D.sleep(500);
    // Timeline kullan: motor bileşimi çizer
    await ev("document.querySelector('#sv-shell .tl-use').click(); 1");
    await D.sleep(500);
    out.mode = (await st()).mode;
    // Yakınlaştırmadan sonra görünüm kaydı: hepsini sığdır (araç çubuğu)
    // (klip seçiliyken araç çubuğunda klip işlemleri var; sığdırma şeridin kendi işlevi)
    await ev("window.SVShellTimeline._core.lane().fit(); 1");
    await D.sleep(400);
    L = await lay();
    const rulerAt = async (sec) => { await tap(L.ruler.x + sec * L.zoom - (L.sx || 0) + 2, L.ruler.y + 18); await D.sleep(700); return ev('({ t: Math.round(window.SVShowDebug.time * 100) / 100, composed: window.SVShowDebug.composed })'); };
    // Cetvel masaüstündeki gibi ızgaraya oturur (ölçü = 2 sn): 2. saniye klip A'nın içinde
    out.at1 = await rulerAt(2);
    const cb = clipOf(await tlc(), 'clip_tl_b');
    out.atB = await rulerAt(cb.start + 0.5);
    // Oynat 2 sn: kafa ve motorun saati ilerler
    await ev("document.querySelector('#sv-shell .tl-play').click(); 1");
    await D.sleep(2000);
    out.playing = await st();
    out.engineT = await ev('window.SVShowDebug.time');
    await ev("document.querySelector('#sv-shell .tl-play').click(); 1");
    await D.sleep(300);
    // Çift dokunuş: denetçi (dar ekranda ayrı sayfa)
    // adb'nin iki dokunuşu arası çift dokunuş süresini aşıyor: tarayıcının dokunma olayıyla
    L = await lay();
    const A0 = L.clips.find((x) => x.id === 'clip_tl_a');
    // Dört olay beklemeden art arda (CDP gidiş-dönüşü tek tek ~300 ms)
    const pt = [[A0.x + 20, A0.y + A0.h / 2]];
    await Promise.all([touch('touchStart', pt), touch('touchEnd', []), touch('touchStart', pt), touch('touchEnd', [])]);
    await D.sleep(900);
    out.inspector = await ev("(document.querySelector('#sv-shell .tl-insp-head') || {}).textContent || ''");
    out.depth = await ev('window.SVShell.state().depth');
    // İşaret, cue/GO, tempo değişimi, döngü (araç çubuğu, seçim yokken) ve sözlerden işaret
    await ev('window.SVShell.back(); window.SVShellTimeline._core.clearSelection(); window.SVShellTimeline._seek(3); 1');
    await D.sleep(500);
    const chipTap = async (re) => { await ev(`(() => { const b = Array.from(document.querySelectorAll('#sv-shell .tl-chip')).find((x) => ${re}.test(x.getAttribute('aria-label') || '')); if (!b) throw new Error('çip yok: ' + ${JSON.stringify(String(re))}); b.click(); return 1; })()`); await D.sleep(400); };
    await chipTap('/^(İşaret|Marker)$/');
    await ev("(() => { const C = window.SVShellTimeline._core; const m = C.selMarker(); m.hold = true; C.commit(); C.clearSelection(); return 1; })()");
    await D.sleep(300);
    await ev('window.SVShellTimeline._seek(0); 1');
    await D.sleep(300);
    out.go = await ev("(() => { const g = document.querySelector('#sv-shell .tl-go'); return !!(g && !g.parentNode.hidden); })()");
    // Kafa 0'dayken tempo değişimi ilk girişle birleşir (masaüstüyle aynı): 4. saniyeye
    await ev('window.SVShellTimeline._seek(4); 1');
    await D.sleep(300);
    await chipTap('/Tempo/');
    await ev('window.SVShellTimeline._core.clearSelection(); 1');
    await D.sleep(300);
    await chipTap('/^(Döngü|Loop)$/');
    out.marks = await ev(`(() => { const t = window.SVAndroid.config.get().timeline; return { markers: (t.markers || []).length, hold: (t.markers || []).some((m) => m.hold), tempo: (t.tempo || []).length, loop: !!(t.loop && t.loop.enabled && t.loop.end > t.loop.start) }; })()`);
    // Sözlerden işaret: söz katmanının ipuçları (masaüstündeki markersFromCues)
    out.lyricMarks = await ev(`(() => { const tl = window.SVShellTimeline._core.model(); tl.markers = window.SVTimeline.markersFromCues([{ t: 1, text: 'Bir' }, { t: 5, text: 'İki' }, { t: 9, text: 'Üç' }]); window.SVShellTimeline._core.commit(); return window.SVAndroid.config.get().timeline.markers.map((m) => m.name).join(','); })()`);
    // Otomasyon öğren: hedefsiz parça; çizelge kapanır, bir ayar değişince hedef olur ve geri açılır
    await ev(`(() => { const C = window.SVShellTimeline._core; const tl = C.model(); tl.tracks.push(window.SVTimeline.makeTrack({ id: 'trk_learn', kind: 'automation', name: 'Otomasyon 4' })); C.commit(); C.startLearn(C.trackById('trk_learn')); return 1; })()`);
    await D.sleep(400);
    out.learnClosed = !(await ev('window.SVShell.state().sheet'));
    const m0 = await ev('window.SVAndroid.config.get().master');
    await ev(`window.SVAndroid.config.patch({ master: ${typeof m0 === 'number' && m0 < 0.5 ? 0.8 : 0.3} }); 1`);
    await D.sleep(1200);
    out.learn = await ev("(() => { const t = window.SVAndroid.config.get().timeline.tracks.find((x) => x.id === 'trk_learn'); return { target: t && t.target, sheet: window.SVShell.state().sheet, head: (document.querySelector('#sv-shell .tl-insp-head') || {}).textContent || '' }; })()");
    // Kaydet: öğrenince kayıt kurulu (masaüstündeki gibi); oynarken elle değişim noktalara yazılır, duraklatınca kalıcı
    await ev(`(() => { const C = window.SVShellTimeline._core; const t = C.trackById('trk_learn'); if (!C.isRecording(t)) C.toggleRecord(t); return 1; })()`);
    await ev('window.SVShellTimeline._seek(0); window.SVShell.back(); 1');
    await D.sleep(600);
    await ev("(() => { const b = document.querySelector('#sv-shell .tl-play'); if (b) b.click(); return 1; })()");
    for (const v of [0.2, 0.5, 0.9, 0.4]) { await D.sleep(450); await ev(`window.SVAndroid.config.patch({ master: ${v} }); 1`); }
    await D.sleep(400);
    await ev("(() => { const b = document.querySelector('#sv-shell .tl-play'); if (b) b.click(); return 1; })()");
    await D.sleep(500);
    out.recorded = await ev("(() => { const t = window.SVAndroid.config.get().timeline.tracks.find((x) => x.id === 'trk_learn'); return t ? t.keys.length : 0; })()");
    await ev(`(() => { const C = window.SVShellTimeline._core; const t = C.trackById('trk_learn'); if (C.isRecording(t)) C.toggleRecord(t); window.SVAndroid.config.patch({ master: ${typeof m0 === 'number' ? m0 : 1} }); return 1; })()`);
    // Uygulama içi çalar: şarkı yüklenince taşıma ona bağlı (oynat, çalar tarafından duraklat, döngüde başa sar)
    await ev('window.SVAndroid.player.pick().catch(() => {}); 1');
    out.playerPicked = await pickInDocumentsUi('sv-test-song.mp3');
    for (let i = 0; i < 20 && !(await ev('!!(window.SVAndroid.player.state() || {}).has')); i++) await D.sleep(300);
    await D.sleep(800);
    await ev("(() => { const C = window.SVShellTimeline._core; C.model().loop = { enabled: false, start: 0, end: 0 }; C.commit(); window.SVShellTimeline._seek(0); return 1; })()");
    await D.sleep(500);
    await ev("document.querySelector('#sv-shell .tl-play').click(); 1");
    await D.sleep(3500); // çizelge önce şarkının başlamasını bekler
    // Şarkının konumu yanıttaki okunma anından (at) kafanın okunduğu ana getirilir (yanıt geç gelebiliyor)
    out.sync = await ev("window.__svHost.request('playerState').then((p) => { const s = window.SVShellTimeline._state(); return { head: s.head, playing: s.playing, engine: window.SVShowDebug.time, player: ((p.position || 0) + (p.playing && p.at ? Date.now() - p.at : 0)) / 1000, pPlaying: p.playing }; })");
    await ev('window.SVAndroid.player.pause(); 1');
    await D.sleep(1000);
    out.extPause = await ev('window.SVShellTimeline._state().playing');
    /* Döngü denetimi Timeline kullan KAPALIYKEN: açıkken SwiftShader'da her sahne klibi başlarken sayfa
       1,5–3 sn donuyor (motor işi; o sırada hiçbir tık çalışmıyor, şarkı döngü sonunu aşıyor). Bu çizelge
       mantığını değil motorun emülatördeki başarımını ölçer (Faz 6); kip dışa aktarmadan önce geri açılır. */
    out.modeForLoop = await ev('(() => { window.SVShellTimeline._core.unlinkOutput(); return window.SVShellTimeline._state().mode; })()');
    await ev("(() => { const C = window.SVShellTimeline._core; C.model().loop = { enabled: true, start: 0, end: 2 }; C.commit(); window.SVShellTimeline._seek(0); return 1; })()");
    await D.sleep(500);
    await ev("document.querySelector('#sv-shell .tl-play').click(); 1");
    await D.sleep(2500);
    // Tek an yerine 10 örnek (emülatör ~1 sn takılabiliyor): şarkı sarmalı, döngü sonunu çok aşmamalı, kafayla birlikte olmalı
    out.loopSync = await ev(`(async () => {
      const r = [];
      for (let i = 0; i < 10; i++) {
        const p = await window.__svHost.request('playerState');
        const s = window.SVShellTimeline._state();
        const pos = ((p.position || 0) + (p.playing && p.at ? Date.now() - p.at : 0)) / 1000;
        r.push({ head: +s.head.toFixed(3), wait: !!s.waiting, player: +pos.toFixed(3), raw: (p.position || 0) / 1000 });
        await new Promise((ok) => setTimeout(ok, 400));
      }
      return r;
    })()`);
    await ev("(() => { const b = document.querySelector('#sv-shell .tl-play'); if (window.SVShellTimeline._state().playing && b) b.click(); const C = window.SVShellTimeline._core; C.model().loop = { enabled: false, start: 0, end: 0 }; C.commit(); return 1; })()");
    await D.sleep(500);
    await ev('window.SVShellTimeline._core.linkOutput(); 1');
    await D.sleep(500);
    out.modeBeforeExport = (await st()).mode;
    // Dışa aktarma "Timeline kullan" AÇIKKEN (klip eklemek kipi kendiliğinden açar): düğme açık → çizelge, kapalı → elle sahne
    const exportOnce = async (withTl) => {
      await ev('window.SVShell.close(); 1');
      await D.sleep(500);
      await ev("document.querySelector('#sv-shell .scene-card [aria-label=\"Dışa Aktar\"], #sv-shell .scene-card [aria-label=\"Export\"]').click(); 1");
      await D.sleep(900);
      await ev("Array.from(document.querySelectorAll('#sv-shell .sheet-body .btn')).find((b) => /Seç|Choose|Değiştir|Change/.test(b.textContent)).click(); 1");
      const picked = await pickInDocumentsUi('sv-test-song.m4a');
      await D.sleep(1500);
      const toggle = await ev(`(() => { const t = Array.from(document.querySelectorAll('#sv-shell .sheet-body button[role=switch]')).find((b) => /Zaman çizelgesiyle|With the timeline/.test(b.getAttribute('aria-label') || '')); if (!t) return false; if ((t.getAttribute('aria-checked') === 'true') !== ${withTl}) t.click(); return true; })()`);
      await ev("document.querySelector('#sv-shell .sheet-foot .btn').click(); 1");
      let ex = null;
      for (let i = 0; i < 400; i++) {
        await D.sleep(1000);
        try { ex = await ev("window.SVExport ? Object.assign(window.SVExport.state(), { title: (document.querySelector('#sv-shell .export-card h2') || {}).textContent, msg: (document.querySelector('#sv-shell .export-card .hint') || {}).textContent }) : null"); } catch (e) { ex = null; }
        // Kaydedildi ya da kaydedilemedi/dışa aktarılamadı: beklemeye gerek yok
        if (ex && (/Galeriye kaydedildi|Saved to the gallery|Kaydedilemedi|Could not save|Dışa aktarılamadı|Could not export/.test(ex.title || '') || ex.error)) break;
      }
      const saved = !!(ex && /Galeriye kaydedildi|Saved to the gallery/.test(ex.title || ''));
      const r = { picked, toggle, saved, export: ex && { title: ex.title, msg: ex.msg, error: ex.error, frames: ex.result && ex.result.frames } };
      const q = D.adb(['shell', 'content', 'query', '--uri', 'content://media/external/video/media', '--projection', '_display_name:relative_path:duration:date_added', '--sort', 'date_added']);
      const row = q.split(/\r?\n/).filter((l) => /SoundVisualizer/.test(l)).slice(-1)[0] || '';
      const mp4 = (/_display_name=([^,]+\.mp4)/.exec(row) || [])[1];
      // Yalnız bu işin kaydettiği dosya ölçülür (kaydedilemediyse galerideki eski dosya değil)
      if (saved && mp4) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-tl-'));
        const local = path.join(dir, 'tl.mp4');
        D.adb(['pull', '/sdcard/Movies/SoundVisualizer/' + mp4, local], { timeout: 60000 });
        const mean = (sec) => {
          const raw = execFileSync(FF, ['-v', 'error', '-ss', String(sec), '-i', local, '-frames:v', '1', '-vf', 'scale=32:18', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 20 });
          let r0 = 0, g0 = 0, b0 = 0;
          for (let i = 0; i < raw.length; i += 3) { r0 += raw[i]; g0 += raw[i + 1]; b0 += raw[i + 2]; }
          const n = raw.length / 3;
          return [Math.round(r0 / n), Math.round(g0 / n), Math.round(b0 / n)];
        };
        r.file = mp4;
        r.frameA = mean(2);
        r.frameB = mean(cb.start + 1.5);
        r.diff = Math.abs(r.frameA[0] - r.frameB[0]) + Math.abs(r.frameA[1] - r.frameB[1]) + Math.abs(r.frameA[2] - r.frameB[2]);
        fs.rmSync(dir, { recursive: true, force: true });
      }
      try { await ev("Array.from(document.querySelectorAll('#sv-shell .export-card .btn')).find((b) => /Bitti|Done|Sahneye dön|Back to the scene/.test(b.textContent)).click(); 1"); } catch (e) { /* yok */ }
      let back = false;
      for (let i = 0; i < 30 && !back; i++) { await D.sleep(500); try { back = await ev("!!(window.SVShell && (window.__SV_ANDROID || {}).page === 'src/visualizer/index.html')"); } catch (e) { back = false; } }
      for (let i = 0; i < 30 && !(await ev('!!(window.SVShell && window.SVShell.state().ready)').catch(() => false)); i++) await D.sleep(300);
      await D.sleep(800);
      return r;
    };
    out.exportTl = await exportOnce(true);
    out.exportManual = await exportOnce(false);
    out.logs = page.logs.filter((l) => /exception/i.test(l)).slice(0, 5);
  } catch (e) {
    // Yarım sonuçlar ve sayfanın nerede olduğu yazılsın (hangi adımda düştüğü görünsün)
    out.error = String((e && e.message) || e);
    try { out.where = await ev("location.href + ' ' + ((window.__SV_ANDROID || {}).page || '') + ' shell=' + !!window.SVShell"); } catch (e2) { out.where = 'yok'; }
    out.logs = page.logs.slice(-12);
  } finally {
    try { if (keep) await ev(`(() => { const k = ${keep}; window.SVAndroid.config.patch({ scenes: k.scenes, timeline: k.timeline || undefined, _activeSceneId: null }); return 1; })()`); } catch (e) { /* sayfa gitti */ }
    page.close();
  }
  console.log(JSON.stringify(out, null, 1));
  const near = (a, b, d) => Math.abs(a - b) <= d;
  /* Döngü 0–2 sn: şarkı geri sarmış olmalı; döngü dışında kalmamalı (sayfa ~1 sn takılırken sonu biraz
     aşabilir: en çok 3,1 sn, art arda iki örnekte dışarıda değil); kafa döngüde kalmalı; 10 örneğin en
     az 7'sinde kafa ile şarkı (döngüde) 0,5 sn içinde */
  const loopOk = (r) => {
    if (!Array.isArray(r) || r.length < 10) return false;
    const wrapped = r.some((x, i) => i > 0 && x.raw < r[i - 1].raw - 1);
    const agree = r.filter((x) => { const d = Math.abs(x.head - x.player) % 2; return Math.min(d, 2 - d) <= 0.5; }).length;
    const stayedOut = r.some((x, i) => i > 0 && x.raw > 2.1 && r[i - 1].raw > 2.1);
    return wrapped && !stayedOut && Math.max(...r.map((x) => x.raw)) < 3.1 && r.every((x) => x.head < 2.05) && agree >= 7;
  };
  const lit = (f) => !!f && f[0] + f[1] + f[2] > 15;
  const eT = out.exportTl || {};
  const eM = out.exportManual || {};
  const even = (v) => Math.abs(v / 2 - Math.round(v / 2)) < 1e-6;
  const has = (a, id) => !!(a && Array.isArray(a.composed) && a.composed.indexOf(id) >= 0);
  const checks = {
    layout: out.clips === 2 && out.rows === 3,
    select: out.selected === 'clip_tl_b',
    move: out.moved > 4 && even(out.moved),
    track: out.track === 'trk_b',
    trim: out.dur > 4 && even(out.dur) && out.undoDur === 4,
    pinch: out.zoom && out.zoom[1] > out.zoom[0] * 1.5,
    menu: out.menu && out.menu.length > 0,
    mode: out.mode === true && Math.abs(out.at1.t - 2) < 0.3 && has(out.at1, 'clip_tl_a') && has(out.atB, 'clip_tl_b'),
    play: out.playing && out.playing.head > out.atB.t + 1 && out.engineT > out.atB.t + 1,
    inspector: out.depth === 2 && out.inspector.length > 0,
    markers: out.go && out.marks && out.marks.markers === 1 && out.marks.hold && out.marks.tempo === 2 && out.marks.loop && out.lyricMarks === 'Bir,İki,Üç',
    learn: out.learnClosed && out.learn && out.learn.target === 'master' && out.learn.sheet,
    record: out.recorded >= 3,
    // Çalar: taşıma, motorun saati ve şarkının konumu birlikte (emülatörde ses yük altında gerçek zamanın %64–110u akıyor: 0,5 sn pay); çalar durunca çizelge durur; döngü şarkıyı da sarar
    player: out.playerPicked && out.sync && out.sync.playing && out.sync.pPlaying && out.sync.head > 1.5 && near(out.sync.head, out.sync.player, 0.5) && out.sync.engine > 1 && out.sync.engine <= out.sync.head + 0.1,
    extPause: out.extPause === false,
    loopSync: out.modeForLoop === false && loopOk(out.loopSync),
    // Kip açıkken dışa aktarma: düğme açık → iki an farklı sahne; kapalı → elle sahne (siyah değil, sahne değişmiyor)
    exportTl: out.modeBeforeExport === true && eT.picked && eT.toggle && eT.saved && eT.export && !eT.export.error && lit(eT.frameA) && eT.diff > 30,
    exportManual: eM.picked && eM.toggle && eM.saved && eM.export && !eM.export.error && lit(eM.frameA) && lit(eM.frameB) && !!eT.frameB && (Math.abs(eM.frameB[0] - eT.frameB[0]) + Math.abs(eM.frameB[1] - eT.frameB[1]) + Math.abs(eM.frameB[2] - eT.frameB[2])) > 30,
    logs: !out.logs.length,
  };
  console.log('checks', JSON.stringify(checks));
  if (Object.values(checks).some((v) => !v)) process.exitCode = 1;
}

const cmds = { embedded: embeddedCmd, timeline: timelineCmd,floatcam: floatCamCmd,lyrics: lyricsCmd, nowplaying: nowPlayingCmd, pickers: pickersCmd, caps, templates, audio, export: exportCmd, floating, profile: profileCmd, lifecycle: lifecycleCmd, player: playerCmd, import: importCmd, shell: shellCmd, layers: layersCmd, pages: pagesCmd, media: mediaCmd, exportui: exportUiCmd, milk: milkCmd, camera: cameraCmd };
if (!cmds[cmd]) {
  console.error('kullanım: node android/tools/probe.js caps|templates [--only=] [--wait=] [--out=]');
  process.exit(2);
}
cmds[cmd]().catch((e) => { console.error(e.message || e); process.exit(1); });
