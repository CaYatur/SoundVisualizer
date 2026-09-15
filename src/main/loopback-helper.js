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

/* Karenin yerleşimi ve kaynak tamponları ana süreçle ORTAK (bkz.
   audio-frame.js): biri değişip öbürü değişmeseydi kareler kayardı. */
const frameFormat = require('./audio-frame.js');
const { FFT_SIZE, BINS, OFFSET } = frameFormat;
const FRAME = 512; // callback başına örnek
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
let requested = Array.isArray(opts.devices)
  ? opts.devices
  : opts.device
  ? [opts.device]
  : ['default'];
if (requested.length === 0) requested = ['default'];

/* Kaynak listesi hem aygıt adı (metin) hem uygulama hedefi (nesne)
   taşıyabiliyor. İkisi aynı karışıma yazıyor, o yüzden burada yalnızca
   ayrıştırılıyorlar. (bkz. src/shared/app-audio.js) */
const appAudio = require('../shared/app-audio.js');
const appCapture = require('./app-capture.js');
const split = appAudio.splitSources(requested);
let wanted = split.devices;
const wantedApps = split.apps;
/* Yalnızca uygulama seçildiyse hiçbir aygıt açılmamalı. Aksi halde
   varsayılan çıkış da karışıma girer ve kullanıcı "yalnızca şu uygulama"
   dediği halde sistemin tamamını duyar. */
if (wanted.length === 0 && wantedApps.length === 0) wanted = ['default'];

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
if (resolved.length === 0 && wantedApps.length === 0) {
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
/* Karışım: mono ve iki kanal. Tayf mono karışımdan hesaplanıyor — eskisi
   gibi; iki kanal yalnız zaman baytları olarak karenin sonuna ekleniyor. */
const mixed = new frameFormat.SourceRings();
const hann = new Float32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
const re = new Float32Array(FFT_SIZE);
const im = new Float32Array(FFT_SIZE);

// Çıkış karesi: işaret, örnekleme hızı, tayf, mono, sol, sağ (audio-frame.js)
const outBuf = Buffer.allocUnsafe(frameFormat.FRAME_BYTES);
outBuf[0] = frameFormat.MARKER0;
outBuf[1] = frameFormat.MARKER1;

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
  const ring = mixed.mono;
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
    outBuf[OFFSET.freq + i] = (v * 255) | 0;
  }
  // zaman baytları (128 merkez): mono, sonra iki kanal
  frameFormat.writeTime(outBuf, OFFSET.time, mixed.mono);
  frameFormat.writeTime(outBuf, OFFSET.left, mixed.left);
  frameFormat.writeTime(outBuf, OFFSET.right, mixed.right);
  const ok = process.stdout.write(outBuf);
  return ok;
}

let backpressure = false;
process.stdout.on('drain', () => (backpressure = false));
process.stdout.on('error', () => process.exit(0));

const instances = [];
const sources = []; // her kaynak için ayrı tamponlar: mono + iki kanal
const started = [];
let startedSr = 48000;

function makeCallback(src, nCh) {
  return (pcm) => {
    const f = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
    src.pushFloat32(f, nCh);
  };
}

// Seçilen her aygıt için ayrı akış aç (çıkış -> loopback, giriş -> mikrofon kaydı)
for (const d of resolved) {
  try {
    const inst = makeRt();
    const nCh = Math.min(2, d.channels) || 2;
    const src = new frameFormat.SourceRings();
    inst.openStream(
      null,
      { deviceId: d.id, nChannels: nCh, firstChannel: 0 },
      RtAudioFormat.RTAUDIO_FLOAT32,
      d.sampleRate,
      FRAME,
      'cap' + d.id,
      makeCallback(src, nCh),
      null
    );
    inst.start();
    instances.push(inst);
    sources.push(src);
    started.push(d.name);
    startedSr = d.sampleRate || startedSr;
  } catch (e) {
    process.stderr.write('DEV-FAIL ' + d.name + ' ' + e.message + '\n');
  }
}

/* ---------------------------------------------- uygulama başına yakalama

   Aygıt akışlarıyla aynı karışıma yazar: her uygulama kendi tamponlarını
   alır ve aşağıdaki zamanlayıcı hepsini birlikte karıştırır. Böylece
   "yalnızca Spotify" da, "Spotify + mikrofon" da aynı yolla çalışıyor.

   PCM ayrı bir süreçten geliyor (bkz. native/app-audio-helper): WASAPI'nin
   süreç loopback'i COM üzerinden ve Node'dan çağrılamıyor. */
const appProcs = [];
/* Her uygulama kaynağı için tamponlar AYRILIR, süreç sonradan bağlansa bile
   karışımdaki yeri sabit kalsın diye. */
const appSources = wantedApps.map(() => {
  const s = new frameFormat.SourceRings();
  sources.push(s);
  return s;
});

/* Seçilen uygulamayı yakalamaya bağlar. Bağlanamazsa (uygulama henüz açık
   değil) sessiz kalır ve aşağıdaki zamanlayıcı yeniden dener.

   Yeniden deneme şart: kullanıcı "Spotify'ı dinle" deyip Spotify'ı sonra
   açıyor. Tek seferlik bir denemede yakalama ölür ve uygulama açıldığında
   kendiliğinden gelmezdi; kullanıcı da sebebini göremezdi. */
function attachApp(app, index) {
  if (appProcs[index]) return true;
  let target;
  try {
    target = appCapture.resolve(app);
  } catch (e) {
    process.stderr.write('APP-FAIL ' + app.match + ' ' + e.message + '\n');
    return false;
  }
  if (!target) return false;

  const child = appCapture.spawn(target.pid, app.mode);
  if (!child) return false;
  appProcs[index] = child;
  const src = appSources[index];

  /* stdout ham float32 stereo akıtıyor. Parçalar kare sınırına düşmek zorunda
     değil, o yüzden artan baytlar bir sonraki parçaya taşınıyor; taşımasaydık
     kanallar kayar ve ses bozulurdu. */
  let carry = Buffer.alloc(0);
  child.stdout.on('data', (chunk) => {
    const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    const frames = Math.floor(buf.length / 8); // 2 kanal x float32
    if (frames > 0) {
      const usable = frames * 8;
      src.pushStereoLE(buf, frames);
      carry = Buffer.from(buf.subarray(usable));
    } else {
      carry = Buffer.from(buf);
    }
    if (carry.length > 65536) carry = Buffer.alloc(0); // bozuk akışta şişmesin
  });
  child.stderr.on('data', (d) => {
    const t = String(d).trim();
    if (t) process.stderr.write(t + '\n');
  });
  child.on('error', (e) => process.stderr.write('APP-SPAWN-FAIL ' + e.message + '\n'));
  /* Hedef uygulama kapanırsa yardımcı da biter. Tamponu sıfırlayıp yeniden
     denemeye bırakıyoruz; kullanıcı uygulamayı yeniden açtığında bağlanır. */
  child.on('exit', () => {
    if (appProcs[index] === child) {
      appProcs[index] = null;
      src.reset();
      process.stderr.write('APP-DETACHED ' + app.match + '\n');
    }
  });

  process.stderr.write('APP-ATTACHED ' + app.match + ' pid=' + target.pid
    + ' (' + target.matched + ')\n');
  return true;
}

wantedApps.forEach((app, i) => {
  appProcs[i] = null;
  if (!attachApp(app, i)) {
    process.stderr.write('APP-NOT-RUNNING ' + app.match + '\n');
  }
  started.push(app.label || app.match);
});

/* Bağlanamamış uygulamalar için düşük sıklıkta yeniden deneme. Süreç listesi
   almak ucuz değil, o yüzden yalnızca eksik varken ve seyrek çalışıyor. */
const retryTimer = wantedApps.length ? setInterval(() => {
  for (let i = 0; i < wantedApps.length; i++) {
    if (!appProcs[i]) attachApp(wantedApps[i], i);
  }
}, 3000) : null;
if (retryTimer && retryTimer.unref) retryTimer.unref();

/* Yardımcı süreçler bizimle birlikte ölmeli; yoksa görselleştirici
   kapandıktan sonra arka planda ses yakalamaya devam ederler. */
function killApps() {
  if (retryTimer) clearInterval(retryTimer);
  for (const c of appProcs) {
    if (!c) continue;
    try { c.kill(); } catch { /* zaten öldü */ }
  }
}
process.on('exit', killApps);
process.on('SIGTERM', () => { killApps(); process.exit(0); });

/* Uygulama seçilmişse henüz bağlanmamış olsa bile çıkmıyoruz: yeniden
   deneme zamanlayıcısı uygulama açılınca bağlayacak. */
if (instances.length === 0 && wantedApps.length === 0) {
  process.stderr.write('START-FAIL hicbir kaynak acilamadi');
  process.exit(3);
}

outBuf.writeUInt32LE(startedSr, OFFSET.sampleRate);
process.stderr.write('CAPTURE-START ' + started.join(' + ') + '\n');

// Kaynakları karıştır + yayınla (~70 Hz)
/* Normalleştirme KARIŞTIRILAN kaynak sayısına göre olmalı, açılan aygıt
   sayısına göre değil. Uygulama yakalama geldiğinde bunlar ayrıştı: yalnızca
   bir uygulama seçilince aygıt sayısı sıfır oluyordu ve 1/sqrt(0) = Infinity
   karışımı NaN'a düşürüyordu — kareler akmaya devam ediyor ama hepsi sıfır
   çıkıyordu, yani sessiz bir görselleştirici ve görünür bir hata yok. */
const norm = 1 / Math.sqrt(Math.max(1, sources.length));
const timer = setInterval(() => {
  if (backpressure) return;
  frameFormat.mixSources(mixed, sources, norm);
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
