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
    out.first = await page.evaluate('window.api.requestConfig().then((c) => ({ cfg: c, st: window.__svHost.profileState() }))');
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
  const ok = out.first.cfg === null && out.first.st.loaded && out.saved.saver && out.saved.saver.writes >= 1
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
  const file = path.join(dir, 'probe.svbackup');
  await FB.writeBackup(file, { appVersion: '4.0.0', platform: 'win32', settings, eachPreset, textures: [{ name: 'noise.png', file: tex }] });
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
  const ok = !r.error && r.kind === 'svbackup' && (presetDir ? r.presets > 2 : r.presets === 2) && r.textures === 1 && o.textures.join() === 'noise.png' && o.texture.startsWith('data:image/png;base64,') && o.texTraversal === null && o.textureRev >= 1 && want
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
      storedTheme: window.SVUiThemes.normalizeId((window.SVAndroid.config.get().ui || {}).theme) })`);
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
  out.wideOk = !!(m.nav && m.vw >= 840 && m.nav.w <= 96 && m.nav.r <= m.hud.l && m.nav.r <= m.scenes.l && m.card === 'none' && m.small.length === 0
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
  try {
    for (let i = 0; i < 50 && !(await ev('!!(window.SVShell && window.SVShell.state().ready)')); i++) await D.sleep(200);
    await D.sleep(1200);
    await ev('window.__probeOrig = JSON.parse(JSON.stringify(window.SVAndroid.config.get())); 1');
    // Bilinen başlangıç: arkaplan (gradyan) ve görselleştirici (barlar), yığın açık
    await ev(`(() => { const L = window.SVLayers; const c = JSON.parse(JSON.stringify(window.SVAndroid.config.get()));
      c.layers = [L.normalizeLayer({ kind: 'background', type: 'gradient', name: '' }), L.normalizeLayer({ kind: 'visualizer', type: 'bars', name: '' })];
      c.layerStack = Object.assign({}, c.layerStack, { enabled: true }); window.SVAndroid.config.set(c); return 1; })()`);
    await D.sleep(1200);
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
    await D.sleep(600);
    const hidden = PNG.luma(shot('2-hidden'), 4, STAGE).mean;
    out.eye = { config: (await layersNow())[0].enabled === false, before: Math.round(before), after: Math.round(hidden) };
    await tap(`#sv-shell .layer-list .row[data-id="${bgId}"] .iconbtn`);
    await D.sleep(600);
    out.eye.back = (await layersNow())[0].enabled === true;
    // Ayarlar: görünürlük 0,2 → sahne kararmalı (yerel range'e input olayı)
    await tap(`#sv-shell .layer-list .row[data-id="${bgId}"] .row-main`);
    out.editDepth = await ev('window.SVShell.state().depth');
    await ev(`(() => { const r = document.querySelector('#sv-shell .sheet-body input[type=range]'); r.value = '0.2'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
    await D.sleep(800);
    const dim = PNG.luma(shot('3-edit'), 4, STAGE).mean;
    out.opacity = { config: (await layersNow())[0].opacity, after: Math.round(dim) };
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
      await tap('#sv-shell .pills .pill:nth-child(3)');
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
    && out.eye.config && out.eye.back && out.eye.after < out.eye.before * 0.6
    && out.editDepth === 2 && Math.abs(out.opacity.config - 0.2) < 0.01 && out.opacity.after < out.eye.before * 0.75 && !out.editSmall.length
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
    await tapSel('#sv-shell .sheet-body > .btn.block', 800);
    out.library.saved = await ev('(window.SVAndroid.config.get().scenes || []).length') === n0 + 1;
    shot('4-scenes');
    await tapSel('#sv-shell .grid2 .tile:last-child .star', 600);
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
    // Bilgi: kapalıyken ekranı tutan pencere (uzun akışta hâlâ MainActivity görülüyor; PR'da açık)
    out.settings.awake.off = !flag();
    out.settings.awake.hold = (/mHoldScreenWindow=[^\n]*/.exec(D.adb(['shell', 'dumpsys', 'window'])) || [''])[0].trim();
    out.settings.awake.activities = D.adb(['shell', 'dumpsys', 'activity', 'activities']).split(/\r?\n/).filter((l) => /ActivityRecord\{[^}]*MainActivity/.test(l) && /Hist|\* /.test(l)).map((l) => l.trim().slice(0, 90));
    out.settings.awake.toggle = await ev("(() => { const b = Array.from(document.querySelectorAll('#sv-shell [role=switch]')).find((x) => /Ekranı açık tut|Keep the screen on/.test(x.getAttribute('aria-label'))); return b && b.getAttribute('aria-checked'); })()");
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
    && clean(out.display.check) && out.display.floating.showing && Math.abs(out.display.floating.width - out.display.expectW) <= 2
    && out.settings.swatches === 8 && clean(out.settings.check) && out.settings.theme.cfg === 'light' && out.settings.theme.page === 'light'
    && out.settings.fpsCap === 30 && out.settings.awake.before && out.settings.awake.toggle === 'false' && out.settings.awake.on && /About|Hakkında/.test(out.settings.about) && clean(out.settings.aboutCheck) && !out.logs.length;
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
    if (uiTap(/^(Show roots|Kökleri göster)$/)) { await D.sleep(900); uiTap(/^(Downloads|İndirilenler)$/); }
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
    await ev("document.querySelector('#sv-shell .scene-card .iconbtn').click(); 1");
    await D.sleep(800);
    out.page = await ev("(document.querySelector('#sv-shell .sheet h2') || {}).textContent || ''");
    await ev("Array.from(document.querySelectorAll('#sv-shell .sheet-body .btn')).find((b) => /Seç|Choose/.test(b.textContent)).click(); 1");
    out.songPicked = await pickInDocumentsUi('sv-test-song.m4a');
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
    const q = D.adb(['shell', 'content', 'query', '--uri', 'content://media/external/video/media', '--projection', '_display_name:relative_path:duration:width:height']);
    out.gallery = q.split(/\r?\n/).filter((l) => /SoundVisualizer/.test(l)).slice(-1)[0] || '';
    // Bitti → sahne
    await ev("Array.from(document.querySelectorAll('#sv-shell .export-card .btn')).find((b) => /Bitti|Done/.test(b.textContent)).click(); 1");
    let back = false;
    for (let i = 0; i < 30 && !back; i++) { await D.sleep(500); try { back = await ev("!!(window.SVShell && (window.__SV_ANDROID || {}).page === 'src/visualizer/index.html')"); } catch (e) { back = false; } }
    out.backToScene = back;
    out.logs = page.logs.filter((l) => /exception|error/i.test(l)).slice(0, 5);
  } finally { page.close(); }
  console.log(JSON.stringify(out, null, 1));
  const ok = out.page && out.songPicked && /sv-test-song/.test(out.song) && out.export && !out.export.error && out.export.page === 'src/exporter/index.html'
    && out.export.result && out.export.result.frames === 600 && /Movies\/SoundVisualizer/.test(out.gallery) && /width=1280/.test(out.gallery) && out.backToScene;
  if (!ok) process.exitCode = 1;
}

const cmds = { caps, templates, audio, export: exportCmd, floating, profile: profileCmd, lifecycle: lifecycleCmd, player: playerCmd, import: importCmd, shell: shellCmd, layers: layersCmd, pages: pagesCmd, media: mediaCmd, exportui: exportUiCmd };
if (!cmds[cmd]) {
  console.error('kullanım: node android/tools/probe.js caps|templates [--only=] [--wait=] [--out=]');
  process.exit(2);
}
cmds[cmd]().catch((e) => { console.error(e.message || e); process.exit(1); });
