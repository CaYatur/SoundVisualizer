'use strict';
/* Ana süreçte çalışır. loopback-helper.js'i SİSTEM node'u ile alt-süreç olarak
   çalıştırır (audify Electron ABI'sine değil node ABI'sine hazır olduğu için).
   - listDevices(): tüm ses aygıtlarını (çıkış + giriş/mikrofon) döndürür
   - startCapture(devices, onFrame, onStatus): bir veya birden fazla aygıtı yakalar */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Paketlenmiş (asar) uygulamada helper ve audify, app.asar.unpacked altında bulunur.
// Harici "node" süreci asar içini okuyamaz; bu yüzden çözülmüş (unpacked) yolu kullan.
function unpacked(p) {
  return p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
}

const HELPER = unpacked(path.join(__dirname, 'loopback-helper.js'));
// ROOT'u HELPER'dan türet (yukarıdaki gibi "app.asar" ile biten yolda replace eşleşmez)
const ROOT = path.join(path.dirname(HELPER), '..', '..');
const FRAME_BYTES = 2 + 4 + 1024 + 2048; // marker + sr + freq + time = 3078

// Sistem node yürütülebilirini bul (paketlenmiş uygulamada PATH güvenilir olmayabilir)
let _nodeCache = null;
function findNode() {
  if (_nodeCache) return _nodeCache;
  const win = process.platform === 'win32';
  const exe = win ? 'node.exe' : 'node';
  const candidates = [];
  // PATH üzerindeki dizinler
  const PATH = process.env.PATH || process.env.Path || '';
  PATH.split(path.delimiter).forEach((d) => {
    if (d) candidates.push(path.join(d, exe));
  });
  // Yaygın kurulum konumları
  if (win) {
    candidates.push(
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'),
      path.join(process.env.APPDATA || '', 'npm', 'node.exe')
    );
  } else {
    candidates.push(
      '/usr/local/bin/node',
      '/opt/homebrew/bin/node',
      '/usr/bin/node',
      path.join(process.env.HOME || '', '.nvm', 'current', 'bin', 'node')
    );
  }
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) {
        _nodeCache = c;
        return c;
      }
    } catch {}
  }
  _nodeCache = 'node'; // son çare: PATH'e güven
  return _nodeCache;
}

function listDevices() {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(findNode(), [HELPER, '--list'], { cwd: ROOT });
    } catch {
      return resolve([]);
    }
    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('error', () => resolve([]));
    child.on('close', () => {
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve([]);
      }
    });
  });
}

// Geriye dönük uyum takma adı
const listOutputDevices = listDevices;

let capChild = null;
let acc = null;
let frameCb = null;

function startCapture(devices, onFrame, onStatus) {
  stopCapture();
  frameCb = onFrame;
  acc = Buffer.alloc(0);

  // Geriye dönük uyum: tek string veya dizi kabul edilir
  const arr = Array.isArray(devices) ? devices : [devices || 'default'];
  const arg = JSON.stringify({ devices: arr });
  let child;
  try {
    child = spawn(findNode(), [HELPER, '--capture', arg], { cwd: ROOT });
  } catch (e) {
    if (onStatus) onStatus({ type: 'error', message: 'node başlatılamadı: ' + e.message });
    return;
  }
  capChild = child;

  child.stdout.on('data', (chunk) => {
    acc = acc.length ? Buffer.concat([acc, chunk]) : chunk;
    parseFrames();
  });

  child.stderr.on('data', (d) => {
    const s = d.toString().trim();
    if (!s) return;
    if (s.includes('CAPTURE-START')) {
      const name = s.replace(/^CAPTURE-START\s*/, '').split(' sr=')[0];
      if (onStatus) onStatus({ type: 'started', device: name });
    } else if (s.includes('START-FAIL') || s.includes('NO-OUTPUT')) {
      if (onStatus) onStatus({ type: 'error', message: s });
    } else {
      console.log('[loopback] ' + s);
    }
  });

  child.on('error', (e) => {
    if (onStatus) onStatus({ type: 'error', message: 'node bulunamadı / çalıştırılamadı (' + e.message + ')' });
  });
  child.on('exit', (code) => {
    if (child === capChild) capChild = null;
  });
}

function parseFrames() {
  while (acc.length >= FRAME_BYTES) {
    if (acc[0] !== 0xaa || acc[1] !== 0x55) {
      // yeniden hizala
      let k = 1;
      while (k < acc.length - 1 && !(acc[k] === 0xaa && acc[k + 1] === 0x55)) k++;
      acc = acc.subarray(k);
      if (acc.length < FRAME_BYTES) return;
    }
    const frame = acc.subarray(0, FRAME_BYTES);
    const sampleRate = frame.readUInt32LE(2);
    const freq = Uint8Array.prototype.slice.call(frame, 6, 6 + 1024);
    const time = Uint8Array.prototype.slice.call(frame, 6 + 1024, 6 + 1024 + 2048);
    acc = acc.subarray(FRAME_BYTES);
    if (frameCb) frameCb({ freq, time, sampleRate });
  }
}

function stopCapture() {
  if (capChild) {
    try {
      capChild.stdin.end();
    } catch {}
    try {
      capChild.kill();
    } catch {}
    capChild = null;
  }
  acc = null;
  frameCb = null;
}

module.exports = { listDevices, listOutputDevices, startCapture, stopCapture };
