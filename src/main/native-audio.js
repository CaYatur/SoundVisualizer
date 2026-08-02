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

  // 1) Paketle birlikte gelen Node çalışma zamanı. Böylece hedef bilgisayarda
  // ayrıca Node.js kurulu olmasına gerek kalmaz.
  const bundledCandidates = [
    path.join(process.resourcesPath || '', 'runtime', exe),
    path.join(__dirname, '..', '..', 'build', 'runtime', exe),
  ];
  for (const candidate of bundledCandidates) {
    if (candidate && fs.existsSync(candidate)) {
      _nodeCache = candidate;
      return candidate;
    }
  }

  // 2) En güvenilir harici seçenek: işletim sistemine sor (gerçek PATH'i kullanır)
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

function classifyListError({ code, signal, stderr, spawnError, timedOut, node, helperExists }) {
  if (!helperExists) return { code: 'HELPER_MISSING', message: 'Audio helper files are missing from the installation.' };
  if (timedOut) return { code: 'DEVICE_ENUM_TIMEOUT', message: 'Audio device detection timed out.' };
  if (spawnError && /ENOENT/i.test(spawnError.code || spawnError.message)) {
    return { code: 'NODE_NOT_FOUND', message: 'Node.js could not be found. Install Node.js or repair its PATH configuration.' };
  }
  if (spawnError) return { code: 'PROCESS_START_FAILED', message: `The audio helper could not start: ${spawnError.message}` };
  if (/Cannot find module ['"].*audify/i.test(stderr)) {
    return { code: 'AUDIFY_MISSING', message: 'The native audio module is missing. Reinstall or repair the application.' };
  }
  if (/was compiled against a different Node\.js version|NODE_MODULE_VERSION|not a valid Win32 application/i.test(stderr)) {
    return { code: 'NATIVE_ABI_MISMATCH', message: 'The native audio module is incompatible with this Node.js version. Reinstall Node.js LTS and the application.' };
  }
  if (/access denied|eperm|eacces/i.test(stderr)) {
    return { code: 'ACCESS_DENIED', message: 'Windows denied access to the audio subsystem. Restart the application and check audio privacy/security settings.' };
  }
  if (code !== 0) return { code: 'HELPER_EXITED', message: `The audio helper exited unexpectedly (code ${code ?? 'unknown'}${signal ? `, signal ${signal}` : ''}).` };
  return { code: 'NO_DEVICES', message: 'No active audio devices were detected. Check Windows Sound settings and reconnect the device.' };
}

function listDevicesAttempt(timeoutMs = 6000) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let settled = false;
    let spawnError = null;
    const node = findNode();
    const helperExists = fs.existsSync(HELPER);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    if (!helperExists) {
      return resolve({ devices: [], ok: false, node, helper: HELPER, error: classifyListError({ helperExists }) });
    }

    let child;
    try {
      child = spawn(node, [HELPER, '--list'], { cwd: ROOT, windowsHide: true });
    } catch (e) {
      spawnError = e;
      return resolve({ devices: [], ok: false, node, helper: HELPER, error: classifyListError({ spawnError, node, helperExists }) });
    }

    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ devices: [], ok: false, node, helper: HELPER, stderr: err.trim(), error: classifyListError({ timedOut: true, node, helperExists }) });
    }, timeoutMs);

    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => { spawnError = e; });
    child.on('close', (code, signal) => {
      if (spawnError) {
        return finish({ devices: [], ok: false, node, helper: HELPER, stderr: err.trim(), error: classifyListError({ spawnError, node, helperExists }) });
      }
      let parsed;
      try { parsed = JSON.parse(out); } catch (e) {
        return finish({ devices: [], ok: false, node, helper: HELPER, stderr: err.trim(), error: { code: 'INVALID_HELPER_OUTPUT', message: `The audio helper returned invalid data: ${e.message}` } });
      }
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return finish({ devices: [], ok: false, node, helper: HELPER, stderr: err.trim(), error: classifyListError({ code, signal, stderr: err, node, helperExists }) });
      }
      finish({ devices: parsed, ok: true, node, helper: HELPER, stderr: err.trim(), error: null });
    });
  });
}

async function diagnoseAudio() {
  let result = await listDevicesAttempt();
  if (!result.ok) {
    _nodeCache = null;
    await new Promise((r) => setTimeout(r, 350));
    const retry = await listDevicesAttempt(8000);
    result = { ...retry, retried: true, firstError: result.error };
  }
  return result;
}

async function listDevices() {
  const result = await diagnoseAudio();
  return result.devices || [];
}

// Geriye dönük uyum takma adı
const listOutputDevices = listDevices;

let capChild = null;
let acc = Buffer.alloc(0);
let frameCb = null;
let captureGeneration = 0;

function startCapture(devices, onFrame, onStatus) {
  stopCapture();
  const generation = ++captureGeneration;
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
    if (generation !== captureGeneration || child !== capChild || !Buffer.isBuffer(chunk)) return;
    if (!Buffer.isBuffer(acc)) acc = Buffer.alloc(0);
    acc = acc.length ? Buffer.concat([acc, chunk]) : Buffer.from(chunk);
    parseFrames(generation);
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

function parseFrames(generation) {
  if (generation !== captureGeneration || !Buffer.isBuffer(acc)) return;
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
  captureGeneration++;
  const child = capChild;
  capChild = null;
  frameCb = null;
  acc = Buffer.alloc(0);

  if (child) {
    try { child.stdout?.removeAllListeners('data'); } catch {}
    try { child.stderr?.removeAllListeners('data'); } catch {}
    try { child.stdin?.end(); } catch {}
    try { child.kill(); } catch {}
  }
}

function resetNodeCache() { _nodeCache = null; }

module.exports = { listDevices, listOutputDevices, diagnoseAudio, resetNodeCache, startCapture, stopCapture };
