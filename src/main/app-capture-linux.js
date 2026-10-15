/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Linux'ta uygulama başına ses yakalama — pactl ve parec'i çalıştırır.
 *
 * Windows'ta yakalama ayrı bir ikilide (native/app-audio-helper). Burada
 * gerek yok: işi standart araçlar yapıyor ve hepsi zaten ayrı süreç. Bu
 * modül loopback-helper'ın İÇİNDE çalışıyor ve ona Windows yardımcısıyla
 * aynı yüzü gösteriyor: stdout'tan 48 kHz stereo float32 ham PCM akan,
 * stderr'e durum satırı yazan, kill() ile duran, 'exit' yayan bir nesne.
 * loopback-helper bu nesnenin ardında ne olduğunu bilmiyor.
 *
 * Bir uygulama birden çok akış açabiliyor (iki sekmede çalan tarayıcı) ve
 * akışlar yakalama sürerken gelip gidiyor (parça değişince yeniden açan
 * oynatıcılar). O yüzden hedef bir kez çözülüp bırakılmıyor: "pactl
 * subscribe" olaylarında ve seyrek bir yoklamayla akış listesi yeniden
 * okunuyor, her eşleşen akış için bir parec açılıyor, hepsi karıştırılıyor.
 *
 * Hedef kapanıp yeniden açılırsa oturum ölmüyor; ada göre yeniden bulunuyor.
 *
 * Saf kurallar: src/shared/app-audio-linux.js.
 */

const { spawn, spawnSync, execFile } = require('child_process');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const L = require('../shared/app-audio-linux.js');

const ENV = Object.assign({}, process.env, L.C_LOCALE_ENV);
/* AppImage'ın başlatıcısı (AppRun) kendi usr/lib'ini LD_LIBRARY_PATH'in başına
   ekliyor. Sistemin pactl/parec'i o yolu miras alıp paketteki kütüphaneyle
   yüklenmesin; bugün pakette pulse kütüphanesi yok ama bu tesadüf. */
if (process.env.APPDIR && ENV.LD_LIBRARY_PATH) {
  const appdir = process.env.APPDIR;
  ENV.LD_LIBRARY_PATH = ENV.LD_LIBRARY_PATH.split(':').filter((p) => p && !p.startsWith(appdir)).join(':');
  if (!ENV.LD_LIBRARY_PATH) delete ENV.LD_LIBRARY_PATH;
}
const RESCAN_MS = 2000;   // olay kaçarsa yedek yoklama
const TICK_MS = 10;       // karıştırıcı saati
const RESPAWN_MS = 1000;  // aynı akış için parec'i bu sıklıktan sık açma

function has(cmd) {
  try {
    return spawnSync('sh', ['-c', 'command -v "$0"', cmd], { encoding: 'utf-8', timeout: 2000 }).status === 0;
  } catch { return false; }
}

/* Özelliğin bu makinede çalışıp çalışmayacağını ölçer. Karar
   app-audio.support()'ta; burada yalnız ölçüm. */
function probe() {
  const t = { pactl: has('pactl'), parec: has('parec'), pipewire: has('pw-cli') || has('pipewire') };
  if (t.pactl) {
    try {
      t.server = spawnSync('pactl', ['info'], { env: ENV, timeout: 3000, stdio: 'ignore' }).status === 0;
    } catch { t.server = false; }
  }
  return t;
}

/* pactl 16'dan eski sürümlerde -f json yok. İlk başarısızlıkta metne düşülüyor
   ve bir daha denenmiyor — ama yalnız metin gerçekten çalıştıysa; sunucu
   kapalıyken JSON'u kalıcı olarak kapatmak yanlış olurdu. */
let jsonOk = null;

function listStreamsSync() {
  if (jsonOk !== false) {
    try {
      const r = spawnSync('pactl', ['-f', 'json', 'list', 'sink-inputs'], {
        encoding: 'utf-8', env: ENV, timeout: 3000,
      });
      if (r.status === 0) {
        const j = L.parseSinkInputsJson(r.stdout);
        if (j) { jsonOk = true; return j; }
      }
    } catch { /* aşağıda metin */ }
  }
  try {
    const r = spawnSync('pactl', ['list', 'sink-inputs'], { encoding: 'utf-8', env: ENV, timeout: 3000 });
    if (r.status !== 0) return [];
    if (jsonOk === null) jsonOk = false;
    return L.parseSinkInputsText(r.stdout);
  } catch { return []; }
}

/* Yakalama sürerken loopback-helper'ın olay döngüsü kare yayınlıyor;
   eşzamanlı pactl onu her taramada durdururdu. */
function listStreamsAsync(cb) {
  const text = () => execFile('pactl', ['list', 'sink-inputs'], { env: ENV, timeout: 3000 }, (e2, out2) => {
    if (e2) { cb(e2, []); return; }
    if (jsonOk === null) jsonOk = false;
    cb(null, L.parseSinkInputsText(out2));
  });
  if (jsonOk === false) { text(); return; }
  execFile('pactl', ['-f', 'json', 'list', 'sink-inputs'], { env: ENV, timeout: 3000 }, (e, out) => {
    const j = e ? null : L.parseSinkInputsJson(out);
    if (j) { jsonOk = true; cb(null, j); return; }
    text();
  });
}

/* Ses çalan uygulamalar — Windows yardımcısının --list çıktısıyla aynı biçim. */
function list() {
  return L.toProcesses(listStreamsSync());
}

/* Bir yakalama oturumu açar. `target` = {pid, match}; `mode` include|exclude.
   Dönen nesne bir alt süreç gibi davranır (bkz. dosya başı). */
function startCapture(target, mode) {
  const ex = mode === 'exclude' ? 'exclude' : 'include';
  const tgt = { pid: Number(target && target.pid) || 0, match: String((target && target.match) || '') };
  const session = new EventEmitter();
  session.stdout = new PassThrough();
  session.stderr = new PassThrough();
  session.pid = 0;
  session.killed = false;

  const mixer = new L.PcmMixer();
  const recs = new Map();       // akış dizini -> parec süreci
  const lastSpawn = new Map();  // akış dizini -> son açılış zamanı
  let sub = null;
  let scanning = false;
  let rescanAgain = false;
  let debounce = null;
  let started = false;
  let stopped = false;
  let lastCount = -1;
  let lastScanMs = 0;

  const log = (s) => { if (!stopped) session.stderr.write(s + '\n'); };

  function openStream(index) {
    const now = Date.now();
    const wait = RESPAWN_MS - (now - (lastSpawn.get(index) || 0));
    /* Az önce açılıp ölen akışı hemen yeniden açma (döngüye girmesin), ama
       bırakma da: süre dolunca yeniden tara. Bırakılsaydı akış bir sonraki
       2 sn'lik yoklamaya kadar sessiz kalırdı. */
    if (wait > 0) { schedule(wait + 10); return; }
    lastSpawn.set(index, now);
    const opened = now;
    let child;
    try {
      child = spawn('parec', L.parecArgs(index), { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      log('APP-STREAM-FAIL #' + index + ' ' + e.message);
      return;
    }
    recs.set(index, child);
    mixer.add(index);
    let first = true;
    child.stdout.on('data', (d) => {
      // Başlangıç gecikmesi ölçülebilsin (WSLg'de 0,7-1 sn ölçüldü)
      if (first) { first = false; log('APP-STREAM-DATA #' + index + ' after=' + (Date.now() - opened) + 'ms'); }
      mixer.push(index, d);
    });
    child.stderr.on('data', (d) => {
      const t = String(d).trim();
      // Akış bittiğinde "Stream error: Entity killed" normal; gürültü yapmasın
      if (t && !/Entity killed/i.test(t)) log('APP-STREAM-ERR #' + index + ' ' + t);
    });
    child.on('error', (e) => log('APP-STREAM-FAIL #' + index + ' ' + e.message));
    child.on('exit', (code, signal) => {
      if (recs.get(index) === child) {
        log('APP-STREAM-EXIT #' + index + ' code=' + code + (signal ? ' signal=' + signal : '')
          + ' after=' + (Date.now() - opened) + 'ms');
        recs.delete(index);
        mixer.remove(index);
        schedule(50);
      }
    });
  }

  function closeStream(index) {
    const c = recs.get(index);
    recs.delete(index);
    mixer.remove(index);
    if (c) { try { c.kill(); } catch { /* zaten kapandı */ } }
  }

  function apply(streams) {
    const want = new Set(L.selectStreams(streams, tgt, ex));
    for (const idx of Array.from(recs.keys())) if (!want.has(idx)) closeStream(idx);
    for (const idx of want) if (!recs.has(idx)) openStream(idx);
    if (want.size !== lastCount) {
      lastCount = want.size;
      log('APP-STREAMS ' + want.size + ' [' + Array.from(want).join(',') + '] scan=' + lastScanMs + 'ms');
    }
  }

  function rescan() {
    if (stopped) return;
    if (scanning) { rescanAgain = true; return; }
    scanning = true;
    const scanStart = Date.now();
    listStreamsAsync((err, streams) => {
      scanning = false;
      if (stopped) return;
      lastScanMs = Date.now() - scanStart;
      if (!err) apply(streams);
      if (!started) {
        started = true;
        log('APP-CAPTURE-START pid=' + tgt.pid + ' match=' + tgt.match + ' mode=' + ex
          + ' sr=' + L.SAMPLE_RATE + ' ch=' + L.CHANNELS + ' backend=pulse');
      }
      ensureSubscribe();
      if (rescanAgain) { rescanAgain = false; schedule(20); }
    });
  }

  function schedule(ms) {
    if (stopped || debounce) return;
    debounce = setTimeout(() => { debounce = null; rescan(); }, ms);
  }

  /* Akış gelip gidince anında haber al. Ses sunucusu yeniden başlarsa
     pactl subscribe ölür; yedek yoklama onu yeniden açar. */
  function ensureSubscribe() {
    if (sub || stopped) return;
    try {
      sub = spawn('pactl', ['subscribe'], { env: ENV, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { sub = null; return; }
    let carry = '';
    sub.stdout.on('data', (d) => {
      const lines = (carry + String(d)).split('\n');
      carry = lines.pop();
      for (const line of lines) {
        const ev = L.parseSubscribeLine(line);
        if (ev && ev.facility === 'sink-input' && ev.event !== 'change') schedule(30);
      }
    });
    const me = sub;
    sub.on('error', () => { if (sub === me) sub = null; });
    sub.on('exit', () => { if (sub === me) sub = null; });
  }

  /* Karıştırıcı saati: geçen süre kadar kare yayınla. Olay döngüsü bir an
     tıkanırsa birikeni bir kerede kusmak yerine en fazla 100 ms yetiştir. */
  const t0 = process.hrtime.bigint();
  let emitted = 0;
  const tick = setInterval(() => {
    if (stopped) return;
    const elapsed = Number(process.hrtime.bigint() - t0) / 1e9;
    const due = Math.floor(elapsed * L.SAMPLE_RATE);
    let owed = due - emitted;
    if (owed > L.SAMPLE_RATE / 10) {
      emitted = due - L.SAMPLE_RATE / 10;
      owed = L.SAMPLE_RATE / 10;
    }
    if (owed <= 0) return;
    emitted += owed;
    session.stdout.write(mixer.pull(owed));
  }, TICK_MS);
  const poll = setInterval(rescan, RESCAN_MS);

  session.kill = () => {
    if (stopped) return true;
    stopped = true;
    session.killed = true;
    clearInterval(tick);
    clearInterval(poll);
    if (debounce) clearTimeout(debounce);
    for (const idx of Array.from(recs.keys())) closeStream(idx);
    if (sub) { try { sub.kill(); } catch { /* yok */ } sub = null; }
    setImmediate(() => {
      session.stdout.end();
      session.stderr.end();
      session.emit('exit', 0, null);
    });
    return true;
  };

  rescan();
  return session;
}

module.exports = { probe, list, listStreamsSync, startCapture };
