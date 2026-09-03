'use strict';
/* Ayrı bir süreçte çalışır; onu uygulamanın kendi ikilisi node kipinde
   başlatır (ELECTRON_RUN_AS_NODE). Böylece üç platformda da ayrıca Node
   kurulması gerekmez. Ayrı süreç olmasının sebebi yalıtım: native ses geri
   çağrısında bir çökme tüm uygulamayı götürmesin.

   Sistem sesini veren aygıtı yakalar, FFT analizini hesaplar ve ikili kareler
   halinde stdout'a yazar. O aygıtın hangisi olduğu platforma göre değişir
   (bkz. src/shared/audio-devices.js). Varsayılan seçimde mikrofon ASLA
   yakalanmaz; mikrofon yalnızca kullanıcı adıyla seçerse kullanılır.

   Kullanım:
     node loopback-helper.js --list            -> JSON aygıt listesi (metin) yazar, çıkar
     node loopback-helper.js --capture <json>  -> ikili analiz kareleri akıtır
   <json> = {"device":"default" | "<aygıt adı>"}
*/

const { RtAudio, RtAudioApi, RtAudioFormat } = require('audify');

const FFT_SIZE = 2048;
const BINS = FFT_SIZE / 2; // 1024
const FRAME = 512; // callback başına örnek
const MARKER0 = 0xaa;
const MARKER1 = 0x55;
const MIN_DB = -90;
const MAX_DB = -18;

// İşletim sistemine göre ses arka ucu (Windows: WASAPI, macOS: CoreAudio, Linux: Pulse/ALSA)
function makeRt() {
  const plat = process.platform;
  try {
    if (plat === 'win32') return new RtAudio(RtAudioApi.WINDOWS_WASAPI);
    if (plat === 'darwin') return new RtAudio(RtAudioApi.MACOSX_CORE);
    if (plat === 'linux') {
      try {
        return new RtAudio(RtAudioApi.LINUX_PULSE);
      } catch {
        return new RtAudio(RtAudioApi.LINUX_ALSA);
      }
    }
  } catch {}
  return new RtAudio();
}

/* Hangi aygıtın sistem sesini verdiği platforma göre değişir; kural saf bir
   modülde tutulur ki çalıştıramadığımız platformlar da sınanabilsin. */
const devices = require('../shared/audio-devices.js');

// Hem çıkış (hoparlör -> loopback) hem giriş (mikrofon -> kayıt) aygıtları
function listAll(rt) {
  return devices.markLoopback(
    rt.getDevices().map((d) => {
      const isOut = d.outputChannels > 0;
      return {
        id: d.id,
        name: d.name,
        kind: isOut ? 'output' : 'input',
        channels: isOut ? d.outputChannels : d.inputChannels,
        isDefault: isOut ? !!d.isDefaultOutput : !!d.isDefaultInput,
        sampleRate: d.preferredSampleRate || 48000,
      };
    })
  );
}

// ---- Komut: liste ----
if (process.argv.includes('--list')) {
  try {
    const rt = makeRt();
    process.stdout.write(JSON.stringify(listAll(rt)));
  } catch (e) {
    process.stderr.write('LIST-FAIL ' + e.message);
    process.stdout.write('[]');
  }
  process.exit(0);
}

// ---- Komut: yakalama ----
const capIdx = process.argv.indexOf('--capture');
let opts = {};
if (capIdx >= 0 && process.argv[capIdx + 1]) {
  try {
    opts = JSON.parse(process.argv[capIdx + 1]);
  } catch {}
}

// Birden çok kaynak desteklenir. Geriye dönük uyum: tek "device" da kabul edilir.
let wanted = Array.isArray(opts.devices)
  ? opts.devices
  : opts.device
  ? [opts.device]
  : ['default'];
if (wanted.length === 0) wanted = ['default'];

const rtList = makeRt();
const all = listAll(rtList);

function resolveDevice(name) {
  if (name === 'default') return devices.pickDefault(all);
  return all.find((d) => d.name === name);
}

const resolved = [];
const seen = new Set();
for (const name of wanted) {
  const d = resolveDevice(name);
  if (d && !seen.has(d.id)) {
    seen.add(d.id);
    resolved.push(d);
  }
}
if (resolved.length === 0) {
  process.stderr.write('NO-DEVICE');
  process.exit(2);
}

/* Varsayılan istendi ama bu platformda sistem sesini veren bir aygıt yoksa,
   çalışmaya devam etmek yerine NEDENİNİ söyle. macOS'ta bu normaldir:
   CoreAudio loopback vermez, kullanıcının sanal bir aygıt kurması gerekir.
   Sessizce mikrofonu dinlemek, kullanıcının saatlerce yanlış kaynağı
   dinlemesi demek olurdu. */
if (wanted.length === 1 && wanted[0] === 'default') {
  const advice = devices.loopbackAdvice(all);
  if (advice) process.stderr.write('NO-LOOPBACK ' + advice.code + ' ' + advice.message + '\n');
}

// FFT hazırlığı
const ring = new Float32Array(FFT_SIZE); // karışım (mix) tampon
const hann = new Float32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
const re = new Float32Array(FFT_SIZE);
const im = new Float32Array(FFT_SIZE);

// Çıkış karesi: marker(2) + sampleRate(4) + freq(1024) + time(2048)
const FRAME_BYTES = 2 + 4 + BINS + FFT_SIZE;
const outBuf = Buffer.allocUnsafe(FRAME_BYTES);
outBuf[0] = MARKER0;
outBuf[1] = MARKER1;

function fft() {
  const n = FFT_SIZE;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const vr = re[b] * cr - im[b] * ci;
        const vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi;
        re[a] += vr; im[a] += vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function emit() {
  // pencereleme + FFT girişi
  for (let i = 0; i < FFT_SIZE; i++) {
    re[i] = ring[i] * hann[i];
    im[i] = 0;
  }
  fft();

  // frekans baytları (0..255), dB ölçekli
  const range = MAX_DB - MIN_DB;
  for (let i = 0; i < BINS; i++) {
    const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / (FFT_SIZE / 4);
    let db = 20 * Math.log10(mag + 1e-9);
    let v = (db - MIN_DB) / range;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    outBuf[6 + i] = (v * 255) | 0;
  }
  // zaman baytları (128 merkez)
  const tOff = 6 + BINS;
  for (let i = 0; i < FFT_SIZE; i++) {
    let s = ring[i];
    s = s < -1 ? -1 : s > 1 ? 1 : s;
    outBuf[tOff + i] = (128 + s * 127) | 0;
  }
  const ok = process.stdout.write(outBuf);
  return ok;
}

let backpressure = false;
process.stdout.on('drain', () => (backpressure = false));
process.stdout.on('error', () => process.exit(0));

const instances = [];
const rings = []; // her aygıt için ayrı mono tampon
const started = [];
let startedSr = 48000;

function makeCallback(ringR, nCh) {
  return (pcm) => {
    const f = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
    const samples = (f.length / nCh) | 0;
    ringR.copyWithin(0, samples);
    let w = FFT_SIZE - samples;
    if (w < 0) w = 0;
    for (let i = 0, idx = 0; i < samples; i++, idx += nCh) {
      let m = f[idx];
      if (nCh > 1) m = (f[idx] + f[idx + 1]) * 0.5;
      if (w + i < FFT_SIZE) ringR[w + i] = m;
    }
  };
}

// Seçilen her aygıt için ayrı akış aç (çıkış -> loopback, giriş -> mikrofon kaydı)
for (const d of resolved) {
  try {
    const inst = makeRt();
    const nCh = Math.min(2, d.channels) || 2;
    const ringR = new Float32Array(FFT_SIZE);
    inst.openStream(
      null,
      { deviceId: d.id, nChannels: nCh, firstChannel: 0 },
      RtAudioFormat.RTAUDIO_FLOAT32,
      d.sampleRate,
      FRAME,
      'cap' + d.id,
      makeCallback(ringR, nCh),
      null
    );
    inst.start();
    instances.push(inst);
    rings.push(ringR);
    started.push(d.name);
    startedSr = d.sampleRate || startedSr;
  } catch (e) {
    process.stderr.write('DEV-FAIL ' + d.name + ' ' + e.message + '\n');
  }
}

if (instances.length === 0) {
  process.stderr.write('START-FAIL hicbir aygit acilamadi');
  process.exit(3);
}

outBuf.writeUInt32LE(startedSr, 2);
process.stderr.write('CAPTURE-START ' + started.join(' + ') + '\n');

// Kaynakları karıştır + yayınla (~70 Hz)
const norm = 1 / Math.sqrt(instances.length);
const timer = setInterval(() => {
  if (backpressure) return;
  const count = rings.length;
  for (let i = 0; i < FFT_SIZE; i++) {
    let s = 0;
    for (let r = 0; r < count; r++) s += rings[r][i];
    ring[i] = s * norm;
  }
  const ok = emit();
  if (!ok) backpressure = true;
}, 14);

// Ebeveyn ölünce/STDIN kapanınca çık
process.stdin.on('end', cleanup);
process.stdin.on('close', cleanup);
process.stdin.resume();
function cleanup() {
  clearInterval(timer);
  for (const inst of instances) {
    try { inst.stop(); inst.closeStream(); } catch {}
  }
  process.exit(0);
}
