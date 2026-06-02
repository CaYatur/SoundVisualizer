'use strict';
/* Ana süreçte çalışır. loopback-helper.js'i SİSTEM node'u ile alt-süreç olarak
   çalıştırır (audify Electron ABI'sine değil node ABI'sine hazır olduğu için).
   - listDevices(): tüm ses aygıtlarını (çıkış + giriş/mikrofon) döndürür
   - startCapture(devices, onFrame, onStatus): bir veya birden fazla aygıtı yakalar */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Hata ayıklama günlüğü — SV_DEBUG=1 (stderr) veya SV_DEBUG_FILE (dosya) ile açılır.
// Env çağrı anında okunur (modül yüklenince değil) ki main.js sonradan ayarlayabilsin.
function dbg(...a) {
  if (!process.env.SV_DEBUG && !process.env.SV_DEBUG_FILE) return;
  const line = '[native-audio] ' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  console.error(line);
  if (process.env.SV_DEBUG_FILE) {
    try {
      fs.appendFileSync(process.env.SV_DEBUG_FILE, line + '\n');
    } catch {}
  }
}

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

  // 1) En güvenilir: işletim sistemine sor (gerçek PATH'i kullanır)
  try {
    const cmd = win ? 'where node' : 'command -v node';
    const found = execSync(cmd, { encoding: 'utf-8' })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)[0];
    if (found && fs.existsSync(found)) {
      _nodeCache = found;
      return found;
    }
  } catch {}

  const candidates = [];
  // 2) PATH üzerindeki dizinler
  const PATH = process.env.PATH || process.env.Path || '';
  PATH.split(path.delimiter).forEach((d) => {
    if (d) candidates.push(path.join(d, exe));
  });
  // 3) Yaygın kurulum konumları (PATH boşsa / GUI süreci için)
  const LOCALAPPDATA = process.env.LOCALAPPDATA || '';
  if (win) {
    candidates.push(
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
      path.join(LOCALAPPDATA, 'Programs', 'nodejs', 'node.exe'),
      path.join(process.env.APPDATA || '', 'npm', 'node.exe'),
      // sürüm yöneticileri: fnm, volta, scoop
      path.join(LOCALAPPDATA, 'Volta', 'bin', 'node.exe'),
      path.join(process.env.USERPROFILE || '', 'scoop', 'apps', 'nodejs', 'current', 'node.exe'),
      path.join(process.env.USERPROFILE || '', 'scoop', 'shims', 'node.exe')
    );
    // fnm: %LOCALAPPDATA%\fnm_multishells\<...>\node.exe — en yenisini tara
    try {
      const fnmRoot = path.join(LOCALAPPDATA, 'fnm', 'node-versions');
      if (fs.existsSync(fnmRoot)) {
        for (const v of fs.readdirSync(fnmRoot)) {
          candidates.push(path.join(fnmRoot, v, 'installation', 'node.exe'));
        }
      }
    } catch {}
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
  dbg('findNode: hiçbir aday bulunamadı, "node"a düşülüyor');
  _nodeCache = 'node'; // son çare: PATH'e güven
  return _nodeCache;
}

function listDevices() {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let child;
    const node = findNode();
    dbg('listDevices node=', node, 'HELPER=', HELPER, 'ROOT=', ROOT);
    dbg('HELPER exists?', fs.existsSync(HELPER), 'ROOT exists?', fs.existsSync(ROOT));
    try {
      child = spawn(node, [HELPER, '--list'], { cwd: ROOT, windowsHide: true });
    } catch (e) {
      dbg('spawn threw:', e.message);
      return resolve([]);
    }
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => {
      dbg('spawn error event:', e.message);
      resolve([]);
    });
    child.on('close', (code) => {
      dbg('list close code=', code, 'stdout.len=', out.length, 'stderr=', err.slice(0, 300));
      dbg('stdout head:', out.slice(0, 200));
      try {
        const parsed = JSON.parse(out);
        dbg('parsed device count=', Array.isArray(parsed) ? parsed.length : 'not-array');
        resolve(parsed);
      } catch (e) {
        dbg('JSON parse failed:', e.message);
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
  dbg('startCapture devices=', arr, 'node=', findNode());
  try {
    child = spawn(findNode(), [HELPER, '--capture', arg], { cwd: ROOT, windowsHide: true });
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
