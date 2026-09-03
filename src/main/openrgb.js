'use strict';
/* OpenRGB istemcisi — üç platformda RGB.
 *
 * OpenRGB ayrı çalışan bir sunucu; kullanıcı onu kurar ve içinde bir SDK
 * sunucusu açar (Settings > General > Enable SDK Server, varsayılan 6742).
 * Biz yalnızca ona bağlanırız. Bu yüzden burada sürücü, yönetici hakkı ya da
 * platforma özgü tek satır kod yok — Windows'ta da macOS'ta da Linux'ta da
 * aynı şey çalışır.
 *
 * Windows'ta bu Dynamic Lighting'in YERİNE GEÇMEZ, yanına eklenir: LampArray
 * yalnız Windows'un tanıdığı aygıtları sürer, OpenRGB çok daha fazlasını.
 * İkisi birlikte de kullanılabilir.
 *
 * Renkler src/shared/lighting-render.js ile hesaplanır — Dynamic Lighting ile
 * AYNI kod. Ayrı bir uygulama olsaydı aynı sahne iki tür aygıtta iki farklı
 * renk yakardı.
 *
 * Tasarım kuralı: ses yolunu ASLA bekletme. Bağlantı kurulmamışsa, sunucu
 * yavaşsa ya da yazma tamponu dolmuşsa kare sessizce atlanır. Görselleştirici
 * bir ışık sunucusu yüzünden takılmamalı.
 */

const net = require('net');
const P = require('../shared/openrgb-protocol.js');
const { createRenderer, DYNAMIC_MODES } = require('../shared/lighting-render.js');

const renderer = createRenderer();
const DEFAULT_PORT = 6742;
const CLIENT_NAME = 'CAYADEV Visualizer';

/* Sunucu protokol sürümünü bildirmezse eskidir ve 0 varsayılır. Beklemenin
   bir sınırı olmalı: cevap hiç gelmeyebilir. */
const VERSION_TIMEOUT_MS = 700;
const CONNECT_TIMEOUT_MS = 4000;
/* Yeniden bağlanma: sunucu kapalıyken saniyede bir denemek hem anlamsız hem
   günlükleri doldurur. Artan aralık, üst sınırla. */
const RETRY_MS = [1000, 2000, 5000, 10000, 30000];

let socket = null;
let buffer = Buffer.alloc(0);
let controllers = [];
let protocol = 0;
let retryIndex = 0;
let retryTimer = null;
let lastSendAt = 0;
let wantConnected = false;
let pending = [];

let state = {
  running: false,
  connected: false,
  error: null,
  host: '',
  port: DEFAULT_PORT,
  protocol: 0,
  devices: [],
  drivable: 0,
  packets: 0,
};

function snapshot() {
  return Object.assign({}, state, { devices: state.devices.slice() });
}

function setState(patch) {
  state = Object.assign({}, state, patch);
}

// ---------------------------------------------------------------- çerçeveleme

/* TCP bir akış; bir okuma yarım paket de üç paket de getirebilir. Başlığın
   bildirdiği boy gelmeden çözümlemeye kalkmak, aygıt listesini bozar. */
function consume(chunk) {
  buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
  for (;;) {
    const head = P.parseHeader(buffer);
    if (!head) {
      /* Başlık yoksa ya veri kısa ya da akış bozulmuş. Bozulmuşsa tamponu
         boşaltmak, sonsuza kadar çöp biriktirmekten iyidir. */
      if (buffer.length >= P.HEADER_SIZE) buffer = Buffer.alloc(0);
      return;
    }
    if (buffer.length < P.HEADER_SIZE + head.size) return;
    const body = buffer.subarray(P.HEADER_SIZE, P.HEADER_SIZE + head.size);
    buffer = buffer.subarray(P.HEADER_SIZE + head.size);
    handle(head, Buffer.from(body));
  }
}

function handle(head, body) {
  const waiter = pending.find((w) => w.command === head.commandId);
  if (waiter) {
    pending = pending.filter((w) => w !== waiter);
    clearTimeout(waiter.timer);
    waiter.resolve({ head, body });
    return;
  }
  /* Aygıt listesi değiştiğinde sunucu kendiliğinden haber verir. */
  if (head.commandId === P.CMD.DEVICE_LIST_UPDATED) enumerate().catch(() => {});
}

function request(command, packet, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!socket || socket.destroyed) return reject(new Error('bağlantı yok'));
    const w = { command, resolve, timer: null };
    w.timer = setTimeout(() => {
      pending = pending.filter((x) => x !== w);
      reject(new Error('yanıt gelmedi (komut ' + command + ')'));
    }, timeoutMs || CONNECT_TIMEOUT_MS);
    pending.push(w);
    socket.write(packet);
  });
}

// ---------------------------------------------------------------- keşif

async function negotiate() {
  socket.write(P.encodeClientName(CLIENT_NAME));
  try {
    const r = await request(P.CMD.REQUEST_PROTOCOL_VERSION, P.encodeProtocolRequest(P.CLIENT_PROTOCOL), VERSION_TIMEOUT_MS);
    const server = r.body.length >= 4 ? r.body.readUInt32LE(0) : 0;
    protocol = Math.min(P.CLIENT_PROTOCOL, server);
  } catch {
    /* Protokol 0 sunucuları bu komutu hiç tanımaz ve cevap vermez. Bu bir
       arıza değil, eski sürüm demektir. */
    protocol = 0;
  }
}

async function enumerate() {
  const countReply = await request(P.CMD.REQUEST_CONTROLLER_COUNT, P.encodeControllerCount());
  const count = countReply.body.length >= 4 ? countReply.body.readUInt32LE(0) : 0;
  const list = [];
  for (let i = 0; i < count; i++) {
    let reply;
    try {
      reply = await request(P.CMD.REQUEST_CONTROLLER_DATA, P.encodeControllerData(i, protocol));
    } catch {
      continue;
    }
    try {
      const c = P.parseControllerData(reply.body, protocol);
      c.index = i;
      c.drivable = P.canDrive(c);
      list.push(c);
    } catch {
      /* Tek bir aygıtın tanımı çözülemezse diğerleri yine sürülebilir.
         Hepsini birden kaybetmek daha kötü olurdu. */
    }
  }
  controllers = list;
  setState({
    devices: list.map((c) => ({
      index: c.index,
      name: c.name,
      type: c.typeName,
      leds: c.ledCount,
      drivable: c.drivable,
    })),
    drivable: list.filter((c) => c.drivable).length,
  });
  /* Sürülebilir aygıtları anlık renk kabul eden moda al. */
  for (const c of controllers) {
    if (c.drivable) {
      try { socket.write(P.encodeCustomMode(c.index)); } catch {}
    }
  }
  return list;
}

// ---------------------------------------------------------------- bağlantı

function cleanup() {
  for (const w of pending) clearTimeout(w.timer);
  pending = [];
  buffer = Buffer.alloc(0);
  controllers = [];
  if (socket) {
    socket.removeAllListeners();
    try { socket.destroy(); } catch {}
  }
  socket = null;
}

function scheduleRetry(cfg) {
  if (!wantConnected || retryTimer) return;
  const wait = RETRY_MS[Math.min(retryIndex, RETRY_MS.length - 1)];
  retryIndex++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (wantConnected) connect(cfg).catch(() => {});
  }, wait);
  if (retryTimer.unref) retryTimer.unref();
}

function connect(cfg) {
  cleanup();
  const host = cfg.host || '127.0.0.1';
  const port = Number(cfg.port) || DEFAULT_PORT;
  setState({ host, port, connected: false, error: null });

  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host, port });
    socket = s;
    s.setNoDelay(true);
    const failed = (err) => {
      if (socket !== s) return;
      setState({ connected: false, error: err.message, devices: [], drivable: 0 });
      cleanup();
      scheduleRetry(cfg);
      reject(err);
    };
    s.setTimeout(CONNECT_TIMEOUT_MS, () => failed(new Error('bağlantı zaman aşımı')));
    s.on('error', failed);
    s.on('close', () => {
      if (socket !== s) return;
      setState({ connected: false, devices: [], drivable: 0 });
      cleanup();
      scheduleRetry(cfg);
    });
    s.on('data', (d) => consume(d));
    s.on('connect', async () => {
      s.setTimeout(0);
      retryIndex = 0;
      try {
        await negotiate();
        await enumerate();
        setState({ connected: true, protocol, error: null });
        resolve(snapshot());
      } catch (e) {
        failed(e);
      }
    });
  });
}

// ---------------------------------------------------------------- dışa açık

async function start(cfg) {
  const c = cfg || {};
  wantConnected = true;
  retryIndex = 0;
  setState({ running: true });
  try {
    await connect(c);
  } catch {
    /* Bağlanamamak bir hata değil: kullanıcı OpenRGB'yi henüz açmamış
       olabilir. Yeniden deneme zamanlayıcısı zaten kuruldu. */
  }
  return snapshot();
}

function stop() {
  wantConnected = false;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  cleanup();
  /* Hız sınırlayıcıyı da sıfırla: yeniden başlatıldığında ilk kare hemen
     gitmeli, bir önceki oturumun saatine takılmamalı. */
  lastSendAt = 0;
  normalizedSource = null;
  normalizedLighting = null;
  setState({ running: false, connected: false, devices: [], drivable: 0, error: null });
  return Promise.resolve(snapshot());
}

/* Hangi aygıtlar sürülecek: liste boşsa hepsi. */
function selected(cfg) {
  const want = Array.isArray(cfg.devices) ? cfg.devices.filter(Boolean) : [];
  const drivable = controllers.filter((c) => c.drivable);
  if (!want.length) return drivable;
  return drivable.filter((c) => want.indexOf(c.name) >= 0);
}

/* Bir ses karesini ışığa çevirir. Ses yolundan çağrılır: hiçbir koşulda
   atmaz ve hiçbir koşulda beklemez. */
/* Işık ayarını normalleştirilmiş halde tutar.
   Çağıran HAM yapılandırmayı verir: Dynamic Lighting kendi setConfig'inde
   normalleştirdiği için bu adım orada görünmez, burada atlanırsa eksik
   alanlar sıfıra düşer ve bütün aygıtlar donuk gri yanar. Kare başına
   yeniden hesaplamamak için nesne kimliğine göre önbelleklenir. */
let normalizedSource = null;
let normalizedLighting = null;

function normalize(lighting) {
  if (lighting === normalizedSource) return normalizedLighting;
  normalizedSource = lighting;
  normalizedLighting = renderer.normalizeLighting(lighting);
  return normalizedLighting;
}

function send(cfg, rawLighting, frame, visualConfig) {
  if (!cfg || !cfg.enabled || !state.connected || !socket || socket.destroyed) return;
  if (!rawLighting) return;
  const lighting = normalize(rawLighting);
  if (!DYNAMIC_MODES.has(lighting.mode)) return;

  const now = Date.now();
  const interval = 1000 / Math.max(1, Math.min(60, Number(cfg.fps) || 30));
  if (now - lastSendAt < interval) return;

  const devices = selected(cfg);
  if (!devices.length) return;

  /* Yazma tamponu birikmişse kare ATLA. Aksi halde yavaş bir sunucu
     belleği şişirir ve ışıklar sesin gerisinde kalır. */
  if (socket.writableLength > 64 * 1024) return;
  lastSendAt = now;

  const st = renderer.updateAnimation(frame, lighting, visualConfig, now);
  const bars = Array.isArray(frame && frame.bars) && frame.bars.length
    ? frame.bars.map((v) => renderer.clamp(v))
    : [st.bands.bass, st.bands.mid, st.bands.treble];

  const totalLeds = devices.reduce((sum, c) => sum + Math.max(1, c.ledCount), 0);
  const gain = renderer.clamp(cfg.brightness === undefined ? 1 : cfg.brightness);
  let globalIndex = 0;

  for (let d = 0; d < devices.length; d++) {
    const c = devices[d];
    const count = Math.max(1, c.ledCount);
    const colors = new Array(count);
    for (let i = 0; i < count; i++) {
      const position = renderer.layoutPosition(
        lighting, d, i, { lampCount: count }, globalIndex, totalLeds, devices.length
      );
      const hex = renderer.renderPixel(lighting.mode, position, bars, lighting, visualConfig, st);
      colors[i] = renderer.scaleHex(hex, gain);
      globalIndex++;
    }
    try {
      socket.write(P.encodeUpdateLeds(c.index, colors));
    } catch {
      /* Yazma başarısızsa bağlantı zaten kapanıyordur; close olayı
         yeniden bağlanmayı kuracak. */
      return;
    }
  }
  setState({ packets: state.packets + devices.length });
}

function status() {
  return snapshot();
}

/* Aygıtları yeniden tara — kullanıcı OpenRGB'de bir şey değiştirdiğinde. */
async function rescan() {
  if (!state.connected) return snapshot();
  try {
    await enumerate();
  } catch (e) {
    setState({ error: e.message });
  }
  return snapshot();
}

module.exports = {
  start,
  stop,
  send,
  status,
  rescan,
  DEFAULT_PORT,
  CLIENT_NAME,
  /* Testler için: iç durumu sıfırlamadan bakabilmek. */
  __controllers: () => controllers,
};
