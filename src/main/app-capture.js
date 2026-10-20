/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Uygulama başına ses yakalama — yardımcı süreci bulur ve çalıştırır.
 *
 * Yakalamanın kendisi platforma göre ayrı bir yerde:
 *   win32   native/app-audio-helper (C#, WASAPI süreç loopback'i — COM
 *           üzerinden geliyor ve Node'dan çağrılamıyor)
 *   darwin  native/app-audio-helper-mac (Swift, ScreenCaptureKit)
 *   linux   pactl + parec (bkz. app-capture-linux.js); ayrı ikili yok
 * Üçü de aynı şeyi veriyor: 48 kHz stereo float32 ham PCM, stdout'tan.
 * Burada yalnızca "ikili nerede, hangi süreci hedefleyeceğiz, nasıl
 * başlatacağız" var.
 *
 * Kural kısmı ayrı ve saf tutuldu (src/shared/app-audio.js) ki
 * çalıştıramadığımız platformlar da sınanabilsin.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const appAudio = require('../shared/app-audio.js');

const EXE = process.platform === 'win32' ? 'app-audio-helper.exe' : 'app-audio-helper';

/* Linux modülü yalnız Linux'ta yükleniyor; öteki platformlarda pactl'yi
   arayan kod hiç çalışmasın. */
let _linux = null;
function linux() {
  if (!_linux) _linux = require('./app-capture-linux.js');
  return _linux;
}

/* Paketlenmiş uygulamada ikili resources/bin altında; geliştirmede derleme
   klasöründe. Sıra önemli: paketlenmiş yol önce gelmeli, yoksa geliştirme
   makinesinde eski bir derleme gölgeler. */
function helperPath() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return null;
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'bin', EXE));
  // __dirname paketlenmişken .../resources/app.asar.unpacked/src/main
  candidates.push(path.join(__dirname, '..', '..', '..', 'bin', EXE));
  if (process.platform === 'win32') {
    candidates.push(path.join(
      __dirname, '..', '..', 'native', 'app-audio-helper',
      'bin', 'Release', 'net8.0-windows10.0.19041.0', 'win-x64', 'publish', EXE
    ));
  } else {
    // scripts/prepare-app-audio-mac.js'in çıktısı
    candidates.push(path.join(__dirname, '..', '..', 'native', 'app-audio-helper-mac', 'build', EXE));
  }
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch { /* erişilemeyen yol */ }
  }
  return null;
}

/* macOS: Ekran Kaydı izni var mı? Yardımcı CGPreflightScreenCaptureAccess
   ile bakıyor — bu çağrı izin penceresi AÇMAZ. Pencere yalnızca kullanıcı
   isteyince (requestPermission) açılıyor; yoksa her açılışta, özelliği hiç
   kullanmayan herkese Ekran Kaydı sorulurdu. */
function macPermission(exe, flag) {
  try {
    const r = spawnSync(exe, [flag || '--check'], { encoding: 'utf-8', timeout: 5000 });
    if (r.status !== 0 || !r.stdout) return undefined;
    const j = JSON.parse(r.stdout.trim());
    return typeof j.permission === 'boolean' ? j.permission : undefined;
  } catch { return undefined; }
}

/* Özellik bu makinede kullanılabilir mi? Sebepler platforma göre değişiyor
   ve kullanıcıya hangisi olduğu söylenmeli: işletim sistemi eski mi,
   yardımcı mı yok, izin mi yok, araç mı eksik. */
function availability() {
  const plat = process.platform;
  let opts = {};
  if (plat === 'linux') opts = linux().probe();
  if (plat === 'darwin') {
    const exe = helperPath();
    opts = { helper: !!exe };
    if (exe) opts.permission = macPermission(exe, '--check');
  }
  const sup = appAudio.support(plat, os.release(), opts);
  if (!sup.supported) {
    const r = { available: false, code: sup.code, message: sup.message };
    if (sup.canRequest) r.canRequest = true;
    return r;
  }
  if (plat === 'win32' && !helperPath()) {
    return {
      available: false,
      code: 'NO_HELPER',
      message: 'Ses yakalama yardımcısı bulunamadı; bu paket .NET olmadan derlenmiş olabilir.',
    };
  }
  return { available: true, code: 'OK', message: '' };
}

/* macOS: izin penceresini aç (yalnız ilk seferde görünür; reddedildiyse
   macOS bir daha sormaz, kullanıcı Sistem Ayarları'ndan açmalı). Dönen
   değer izin şu an var mı. */
function requestPermission() {
  if (process.platform !== 'darwin') return { permission: true };
  const exe = helperPath();
  if (!exe) return { permission: false };
  return { permission: macPermission(exe, '--request') === true };
}

/* Geriye dönük: Linux'ta hangi ses sunucusu araçları var. */
function linuxServers() {
  if (process.platform !== 'linux') return {};
  return linux().probe();
}

/* Şu anda ses oturumu olan uygulamalar. Ham süreç listesi değil: kullanıcı
   yüzlerce arka plan süreci arasından seçmemeli. */
function list() {
  if (process.platform === 'linux') {
    // Kendi akışlarımız (önizleme, sistem karışımı yakalayıcısı) hedef olamaz
    try { return appAudio.withoutSelf(linux().list(), process.execPath); } catch { return []; }
  }
  const exe = helperPath();
  if (!exe) return [];
  try {
    const r = spawnSync(exe, ['--list'], {
      encoding: 'utf-8', windowsHide: true, timeout: 10000,
    });
    if (r.status !== 0 || !r.stdout) return [];
    const parsed = JSON.parse(r.stdout.trim() || '[]');
    return appAudio.withoutSelf(Array.isArray(parsed) ? parsed : [], process.execPath);
  } catch {
    return [];
  }
}

/* Kaydedilmiş hedefi o anki süreçler arasında bulur. Kimlik her açılışta
   değiştiği için eşleşme ADA göre yapılıyor (bkz. app-audio.resolveTarget). */
function resolve(app) {
  return appAudio.resolveTarget(app, list(), process.platform);
}

/* Yakalamayı başlatır. `name` hedefin eşleşme adı: Linux'ta oturum akışları
   ada göre seçiyor (bir uygulamanın birden çok süreci ve akışı olabiliyor);
   Windows ve macOS yardımcıları süreç kimliğiyle çalışıyor. */
function spawnCapture(pid, mode, name) {
  const m = mode === 'exclude' ? 'exclude' : 'include';
  /* Linux oturumu hedefi ADLA seçiyor; hariç tutmada hedef o an çalmıyor
     olabilir (kimlik 0), yine de geri kalan her şey yakalanmalı. */
  if (process.platform === 'linux') {
    if (!(pid > 0) && !name) return null;
    return linux().startCapture({ pid: pid > 0 ? pid : 0, match: name || '' }, m);
  }
  if (!(pid > 0)) return null;
  const exe = helperPath();
  if (!exe) return null;
  return spawn(exe, ['--capture', String(pid), m], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/* Bağlı bir uygulama yakalamasının bekçi kararı (#813), saf:
     'pid-gone'   hedef süreç yok (uygulama kapandı)
     'restarted'  ~2 sn veri yok ve uygulama artık başka bir pid'de
     'gone'       ~2 sn veri yok ve uygulama listede de yok
     'ok'         sürüyor (susmuş olabilir; aynı pid'e dokunulmaz)
   Uygulama listesi pahalı (Windows'ta yardımcı süreç): yalnız veri kesikken
   ve en çok 3 sn'de bir sorulur. */
const STALE_MS = 2000;
const STALE_CHECK_MS = 3000;
function staleVerdict(w, now, alive, resolvePid) {
  if (!w) return 'ok';
  if (!alive) return 'pid-gone';
  if (now - w.lastData < STALE_MS || now - w.attachedAt < STALE_MS) return 'ok';
  if (now - (w.lastCheck || 0) < STALE_CHECK_MS) return 'ok';
  const p = Number(resolvePid()) || 0;
  if (p === w.pid) return 'ok';
  return p ? 'restarted' : 'gone';
}

// ------------------------------------------------------ canlı seviye (#516)

/* Seçicideki canlı ölçerler için yardımcının `--meters` akışı.

   Akış YALNIZ seçici görünürken açık: ana süreç `setWanted(true)` deyince
   yardımcı başlar, `false` deyince stdin kapatılır ve yardımcı kendisi
   çıkar (çıkmazsa kısa bir süre sonra öldürülür). Panel kapalıyken arka
   planda hiçbir şey çalışmıyor.

   Yardımcı ≈16 Hz yazıyor; panele en fazla METER_SEND_MS'de bir, en son
   satır gidiyor (aradakiler bayat, atılır). Uygulama başına birleştirme
   burada yapılıyor ki IPC yükü süreç sayısıyla büyümesin.

   Yardımcı ölürse sınırlı sayıda yeniden denenir; `--meters` bilmeyen eski
   bir ikili (BAD-ARGS, çıkış kodu 2) ya da hiç ikili yoksa hemen vazgeçilir
   ve panele `{ available: false }` gider — panel o zaman ölçerleri gizler,
   eski simge davranışı kalır. */
const METER_INTERVAL_MS = 60;
const METER_SEND_MS = 66;
const METER_STOP_GRACE_MS = 1500;
const METER_RETRY_MS = 2000;
const METER_MAX_FAILURES = 3;
const METER_HEALTHY_MS = 10000; // bu kadar yaşayan yardımcının ölümü sayaçı sıfırlar
const EXIT_BAD_ARGS = 2;

function createMeterStream(opts) {
  const o = opts || {};
  const spawnFn = o.spawn || spawn;
  const findExe = o.helperPath || helperPath;
  const send = typeof o.send === 'function' ? o.send : () => {};
  const setT = o.setTimeout || setTimeout;
  const clearT = o.clearTimeout || clearTimeout;
  const now = o.now || Date.now;
  const selfName = o.selfName === undefined ? process.execPath : o.selfName;

  let wanted = false;
  let child = null;
  let carry = '';
  let startedAt = 0;
  let failures = 0;
  let gaveUp = false;
  let latest = null;
  let lastSent = -Infinity;
  let sendTimer = null;
  let retryTimer = null;

  function flush() {
    sendTimer = null;
    if (!latest || !wanted) return;
    const levels = latest;
    latest = null;
    lastSent = now();
    send({ available: true, levels });
  }

  function queue(levels) {
    latest = levels;
    if (sendTimer) return;
    const wait = Math.max(0, METER_SEND_MS - (now() - lastSent));
    sendTimer = setT(flush, wait);
  }

  function giveUp() {
    gaveUp = true;
    send({ available: false });
  }

  function onData(chunk) {
    const r = appAudio.splitMeterChunk(carry, chunk.toString('utf8'));
    carry = r.carry;
    // Yalnız en son geçerli satır önemli; öncekiler zaten bayat
    for (let i = r.lines.length - 1; i >= 0; i--) {
      const rows = appAudio.parseMeterLine(r.lines[i]);
      if (rows) { queue(appAudio.meterLevels(appAudio.withoutSelf(rows, selfName))); return; }
    }
  }

  function onExit(c, code) {
    if (child !== c) return; // durdurulmuş eski çocuk
    child = null;
    if (!wanted) return;
    if (code === EXIT_BAD_ARGS) { giveUp(); return; }
    if (now() - startedAt >= METER_HEALTHY_MS) failures = 0;
    failures++;
    if (failures >= METER_MAX_FAILURES) { giveUp(); return; }
    retryTimer = setT(() => { retryTimer = null; start(); }, METER_RETRY_MS);
  }

  function start() {
    if (child || !wanted || gaveUp) return;
    const exe = findExe();
    if (!exe) { giveUp(); return; }
    let c = null;
    try {
      c = spawnFn(exe, ['--meters', String(METER_INTERVAL_MS)], {
        windowsHide: true,
        // stdin BORU olmalı: yardımcı onun kapanmasını çıkış işareti sayıyor
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch { c = null; }
    if (!c) { giveUp(); return; }
    child = c;
    carry = '';
    startedAt = now();
    let ended = false;
    const end = (code) => {
      if (ended) return;
      ended = true;
      onExit(c, code);
    };
    if (c.stdout) c.stdout.on('data', (b) => { if (child === c) onData(b); });
    // stderr okunmazsa boru dolar ve yardımcı yazarken takılır
    if (c.stderr) c.stderr.on('data', () => {});
    if (c.stdin) c.stdin.on('error', () => {}); // yardımcı önce öldüyse EPIPE
    c.on('error', () => end(-1));
    c.on('exit', (code) => end(code));
  }

  function stopChild() {
    const c = child;
    child = null;
    if (!c) return;
    try { if (c.stdin) c.stdin.end(); } catch { /* boru zaten kapalı */ }
    const killer = setT(() => { try { c.kill(); } catch { /* zaten çıktı */ } }, METER_STOP_GRACE_MS);
    if (killer && typeof killer.unref === 'function') killer.unref();
    c.on('exit', () => clearT(killer));
  }

  function setWanted(on) {
    const next = !!on;
    if (next === wanted) {
      if (next && gaveUp) send({ available: false });
      return;
    }
    wanted = next;
    if (wanted) {
      if (gaveUp) { send({ available: false }); return; }
      failures = 0;
      start();
      return;
    }
    if (retryTimer) { clearT(retryTimer); retryTimer = null; }
    if (sendTimer) { clearT(sendTimer); sendTimer = null; }
    latest = null;
    stopChild();
  }

  return {
    setWanted,
    stop: () => setWanted(false),
    running: () => !!child,
    wanted: () => wanted,
  };
}

module.exports = {
  helperPath, availability, list, resolve, spawn: spawnCapture, linuxServers, staleVerdict, STALE_MS,
  createMeterStream, METER_SEND_MS, METER_STOP_GRACE_MS, METER_MAX_FAILURES,
  requestPermission,
};
