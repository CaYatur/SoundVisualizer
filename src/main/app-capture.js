/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Uygulama başına ses yakalama — yardımcı süreci bulur ve çalıştırır.
 *
 * Yakalamanın kendisi ayrı bir ikilide (bkz. native/app-audio-helper):
 * WASAPI'nin süreç loopback'i COM üzerinden geliyor ve Node'dan
 * çağrılamıyor. Burada yalnızca "ikili nerede, hangi süreci hedefleyeceğiz,
 * nasıl başlatacağız" var.
 *
 * Kural kısmı ayrı ve saf tutuldu (src/shared/app-audio.js) ki
 * çalıştıramadığımız platformlar da sınanabilsin.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const appAudio = require('../shared/app-audio.js');

const EXE = 'app-audio-helper.exe';

/* Paketlenmiş uygulamada ikili resources/bin altında; geliştirmede dotnet'in
   yayımladığı klasörde. Sıra önemli: paketlenmiş yol önce gelmeli, yoksa
   geliştirme makinesinde eski bir derleme gölgeler. */
function helperPath() {
  if (process.platform !== 'win32') return null;
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'bin', EXE));
  // __dirname paketlenmişken .../resources/app.asar.unpacked/src/main
  candidates.push(path.join(__dirname, '..', '..', '..', 'bin', EXE));
  candidates.push(path.join(
    __dirname, '..', '..', 'native', 'app-audio-helper',
    'bin', 'Release', 'net8.0-windows10.0.19041.0', 'win-x64', 'publish', EXE
  ));
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch { /* erişilemeyen yol */ }
  }
  return null;
}

/* Özellik bu makinede kullanılabilir mi? İki ayrı sebep var ve kullanıcıya
   hangisi olduğu söylenmeli: işletim sistemi desteklemiyor mu, yoksa
   yardımcı ikili mi yok (dotnet olmadan derlenmiş bir paket). */
function availability() {
  const sup = appAudio.support(process.platform, os.release(), linuxServers());
  if (!sup.supported) return { available: false, code: sup.code, message: sup.message };
  if (process.platform !== 'win32') {
    return {
      available: false,
      code: 'NOT_IMPLEMENTED',
      message: 'Uygulama başına ses yakalama şimdilik yalnızca Windows üzerinde çalışıyor.',
    };
  }
  if (!helperPath()) {
    return {
      available: false,
      code: 'NO_HELPER',
      message: 'Ses yakalama yardımcısı bulunamadı; bu paket .NET olmadan derlenmiş olabilir.',
    };
  }
  return { available: true, code: 'OK', message: '' };
}

/* Linux'ta hangi ses sunucusu var? Karar kuralı saf modülde, tespit burada. */
function linuxServers() {
  if (process.platform !== 'linux') return {};
  const has = (cmd) => {
    try {
      return spawnSync('sh', ['-c', 'command -v ' + cmd], { encoding: 'utf-8' }).status === 0;
    } catch { return false; }
  };
  return { pipewire: has('pw-cli'), pulse: has('pactl') };
}

/* Şu anda ses oturumu olan uygulamalar. Ham süreç listesi değil: kullanıcı
   yüzlerce arka plan süreci arasından seçmemeli. */
function list() {
  const exe = helperPath();
  if (!exe) return [];
  try {
    const r = spawnSync(exe, ['--list'], {
      encoding: 'utf-8', windowsHide: true, timeout: 5000,
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
  return appAudio.resolveTarget(app, list());
}

function spawnCapture(pid, mode) {
  const exe = helperPath();
  if (!exe || !(pid > 0)) return null;
  return spawn(exe, ['--capture', String(pid), mode === 'exclude' ? 'exclude' : 'include'], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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
  helperPath, availability, list, resolve, spawn: spawnCapture, linuxServers,
  createMeterStream, METER_SEND_MS, METER_STOP_GRACE_MS, METER_MAX_FAILURES,
};
