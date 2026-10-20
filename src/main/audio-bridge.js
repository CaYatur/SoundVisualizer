/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* SES KÖPRÜSÜ (#813). Bir makinenin yakaladığı ses ağdaki başka makinelere
   gider; birincil ve yedek AYNI sinyali çözümler.

   Ağa giden şey yakalama yardımcısının kendi analiz karesi (audio-frame.js):
   tayf, 2048 örneklik mono/sol/sağ pencere ve örnekleme hızı. Görselleştirici
   bantları, vuruşu, BPM'i ve MilkDrop girdilerini bu kareden hesaplıyor; iki
   makine aynı kareyi alınca aynı sayıları buluyor. Dinlenebilir ses isteğe
   bağlı: alıcı isterse köprü ham PCM de yollar (tür 2; Opus değil, bkz. docs).

   Taşıma: TCP, uzunluk önekli paketler. Yedeklilik bağlantısından AYRI bir
   soket: saniyede ~70 kare kalp atışının önünü tıkamasın. Biçim belgesi:
   docs/audio-bridge.md. Her pakette sürüm var; tanımadığı sürümü alan
   bağlantıyı nedeniyle kapatır.

   Eşleşme: iki yönlü HMAC-SHA256 sınaması; parola ağa hiç çıkmaz. Parolasız
   (ya da kısa parolalı) köprü açılmaz.

   Keşif: UDP yayın işareti (beacon). mDNS yerine: Linux'ta avahi olmadan da,
   Windows'ta ve macOS'ta ek servis olmadan çalışıyor. İşaret parolayla
   imzalı; alıcı yalnız kendi parolasıyla eşleşen köprüleri listeler. */

const net = require('net');
const dgram = require('dgram');
const os = require('os');
const crypto = require('crypto');
const frameFormat = require('./audio-frame');

const WIRE_VERSION = 1;
const DEFAULT_PORT = 8741;
const BEACON_PORT = 8742;
const MIN_SECRET = 16;
const MAX_PACKET = 1 << 20; // 1 MB: kare 7 KB, meta (kapak resmiyle) sınırlı
const KIND = Object.freeze({ JSON: 0, FRAME: 1, PCM: 2 });
const FRAME_HEAD = 1 + 4 + 8; // sürüm, sıra, gönderenin saati (ms, float64)
const PCM_HEAD = FRAME_HEAD + 4 + 1; // + örnekleme hızı (u32), kanal (u8)
const PCM_MAX = 64 * 1024; // bir PCM paketinin en büyük ses yükü
const MAX_QUEUE = 256 * 1024; // yavaş alıcı: kuyruk bunu aşarsa kare atlanır
const HELLO_MS = 5000;
const RETRY_MS = [250, 500, 1000];

const DEFAULTS = Object.freeze({
  send: false, // bu makine yakaladığını köprüye verir
  only: false, // açılışta yalnız köprü kipi (görüntü çıkışı yok)
  receive: false, // ses girişi: ağ köprüsü
  port: DEFAULT_PORT,
  name: '',
  secret: '',
  host: '', // alıcı: elle adres; boşsa keşfedilen ilk köprü
  fallback: true, // köprü kesilince yerel girişe dön
  fallbackSource: '', // yedek giriş aygıtı (mikser split); boşsa olağan ses girişi
  play: false, // alıcı: köprünün dinlenebilir sesini bu makinede çal
  playVolume: 1, // 0..1
  playDevice: '', // çıkış aygıtının kimliği; boşsa sistemin varsayılanı
  playLatencyMs: 120, // titreme tamponu
  startHidden: false, // köprü kipi: durum penceresi açılışta açılmaz (--hidden)
});

function normalize(c) {
  const s = Object.assign({}, DEFAULTS, c && typeof c === 'object' ? c : {});
  s.send = s.send === true;
  s.only = s.only === true;
  s.receive = s.receive === true;
  s.fallback = s.fallback !== false;
  const p = Math.round(Number(s.port));
  s.port = p >= 1024 && p <= 65535 ? p : DEFAULT_PORT;
  s.name = String(s.name || '').trim().slice(0, 60);
  s.secret = String(s.secret || '').trim().slice(0, 200);
  s.host = String(s.host || '').trim().slice(0, 200);
  s.fallbackSource = typeof s.fallbackSource === 'string' ? s.fallbackSource.slice(0, 300) : '';
  s.play = s.play === true;
  s.startHidden = s.startHidden === true;
  const vol = Number(s.playVolume);
  s.playVolume = Number.isFinite(vol) ? Math.max(0, Math.min(1, vol)) : 1;
  s.playDevice = typeof s.playDevice === 'string' ? s.playDevice.slice(0, 300) : '';
  const lat = Math.round(Number(s.playLatencyMs));
  s.playLatencyMs = Number.isFinite(lat) ? Math.max(40, Math.min(1000, lat)) : 120;
  return s;
}

// Ayardaki eksik: '' | 'secret' (alıcıda adres boşsa keşif devrede, eksik değil)
function problem(c) {
  const s = normalize(c);
  if (!s.send && !s.receive && !s.only) return '';
  if (s.secret.length < MIN_SECRET) return 'secret';
  return '';
}

function newSecret() {
  return crypto.randomBytes(18).toString('base64').replace(/[+/=]/g, '').slice(0, 24);
}

function mac(secret, text) {
  return crypto.createHmac('sha256', String(secret)).update(String(text)).digest('hex');
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

/* ---- Paketler ------------------------------------------------------------
   [u32 BE uzunluk (tür + yük)][u8 tür][yük]
   tür 0: UTF-8 JSON, her nesnede `v` (biçim sürümü) ve `type`
   tür 1: kare — [u8 sürüm][u32 BE sıra][f64 BE gönderenin saati][7174 bayt]
   tür 2: PCM — [u8 sürüm][u32 BE sıra][f64 BE saat][u32 BE hız][u8 kanal][s16 LE]
          yalnız isteyen alıcıya ("auth"ta ya da sonra "audio" ile) gider;
          eski alıcı bu türü hiç almaz */
function packet(kind, payload) {
  const head = Buffer.alloc(5);
  head.writeUInt32BE(payload.length + 1, 0);
  head[4] = kind;
  return Buffer.concat([head, payload]);
}
function jsonPacket(obj) {
  return packet(KIND.JSON, Buffer.from(JSON.stringify(Object.assign({ v: WIRE_VERSION }, obj)), 'utf8'));
}
function framePacket(frameBytes, seq, t) {
  const p = Buffer.alloc(FRAME_HEAD + frameBytes.length);
  p[0] = WIRE_VERSION;
  p.writeUInt32BE(seq >>> 0, 1);
  p.writeDoubleBE(t, 5);
  frameBytes.copy(p, FRAME_HEAD);
  return packet(KIND.FRAME, p);
}
function pcmPacket(s16, seq, t, sampleRate, channels) {
  const p = Buffer.alloc(PCM_HEAD + s16.length);
  p[0] = WIRE_VERSION;
  p.writeUInt32BE(seq >>> 0, 1);
  p.writeDoubleBE(t, 5);
  p.writeUInt32BE(sampleRate >>> 0, 13);
  p[17] = channels;
  s16.copy(p, PCM_HEAD);
  return packet(KIND.PCM, p);
}
function readPcm(payload) {
  if (!payload || payload.length < PCM_HEAD) return { error: 'size' };
  if (payload[0] !== WIRE_VERSION) return { error: 'version', version: payload[0] };
  const sampleRate = payload.readUInt32BE(13);
  const channels = payload[17];
  const data = payload.subarray(PCM_HEAD);
  if (channels < 1 || channels > 2 || sampleRate < 8000 || sampleRate > 192000) return { error: 'format' };
  if (data.length > PCM_MAX || data.length % (2 * channels)) return { error: 'size' };
  return { seq: payload.readUInt32BE(1), t: payload.readDoubleBE(5), sampleRate, channels, data: Buffer.from(data) };
}
function readFrame(payload) {
  if (!payload || payload.length !== FRAME_HEAD + frameFormat.FRAME_BYTES) return { error: 'size' };
  if (payload[0] !== WIRE_VERSION) return { error: 'version', version: payload[0] };
  const body = payload.subarray(FRAME_HEAD);
  if (body[0] !== frameFormat.MARKER0 || body[1] !== frameFormat.MARKER1) return { error: 'marker' };
  return { seq: payload.readUInt32BE(1), t: payload.readDoubleBE(5), frame: frameFormat.parseFrame(body) };
}

/* Akıştan paket ayıklayıcı. Bozuk uzunlukta (0 ya da sınırdan büyük) hata
   verir; çağıran bağlantıyı kapatır — hizayı yeniden aramak yerine. */
function createParser(onPacket, onError) {
  let acc = Buffer.alloc(0);
  let dead = false;
  return function push(chunk) {
    if (dead) return;
    acc = acc.length ? Buffer.concat([acc, chunk]) : chunk;
    while (acc.length >= 4) {
      const len = acc.readUInt32BE(0);
      if (len < 1 || len > MAX_PACKET) { dead = true; if (onError) onError('length'); return; }
      if (acc.length < 4 + len) return;
      const kind = acc[4];
      const payload = acc.subarray(5, 4 + len);
      acc = acc.subarray(4 + len);
      try { onPacket(kind, payload); } catch (e) { dead = true; if (onError) onError('handler', e); return; }
    }
  };
}
function parseJson(payload) {
  try {
    const o = JSON.parse(payload.toString('utf8'));
    return o && typeof o === 'object' ? o : null;
  } catch { return null; }
}

/* Çalan parça bilgisi ağa giderken: kapak resmi büyükse atılır (alıcı adı,
   sanatçıyı ve süreyi yine alır). */
function slimMeta(st) {
  if (!st || typeof st !== 'object') return null;
  const out = {};
  for (const k of ['has', 'title', 'artist', 'album', 'duration', 'position', 'playing', 'app', 'updatedAt']) {
    if (st[k] !== undefined) out[k] = st[k];
  }
  if (typeof st.artwork === 'string' && st.artwork.length <= 256 * 1024) out.artwork = st.artwork;
  return out;
}

/* ---- Gönderen (köprü) ----------------------------------------------------
   Sunucu; her bağlantı önce sınanır, sonra kare alır. Yavaş alıcının
   kuyruğu büyürse o alıcıya kare atlanır (gecikme birikmesin), sayılır. */
function createSender(opts) {
  const o = Object.assign({ port: DEFAULT_PORT, host: '0.0.0.0', name: '', id: '', secret: '' }, opts || {});
  const clients = new Set();
  let server = null;
  let seq = 0;
  let pcmSeq = 0;
  let lastMeta = null;
  const authFails = [];
  const stats = { sent: 0, dropped: 0, clients: 0, listening: false, error: '' };
  const now = o.now || Date.now;

  function emit() { stats.clients = Array.from(clients).filter((c) => c.authed).length; if (o.onStatus) o.onStatus(status()); }
  function status() {
    const t = now();
    return Object.assign({
      port: o.port,
      listeners: Array.from(clients).filter((c) => c.authed && c.audio).length,
      peers: Array.from(clients).filter((c) => c.authed).map((c) => Object.assign({ addr: c.addr, dropped: c.dropped, audio: c.audio }, c.report || {})),
      authFails: authFails.filter((f) => t - f.at < 60000).map((f) => ({ addr: f.addr, agoMs: t - f.at })),
    }, stats);
  }

  function onConn(sock) {
    const c = { sock, authed: false, audio: false, nonce: crypto.randomBytes(16).toString('hex'), addr: (sock.remoteAddress || '').replace(/^::ffff:/, ''), dropped: 0 };
    clients.add(c);
    sock.setNoDelay(true);
    const t = setTimeout(() => { if (!c.authed) sock.destroy(); }, HELLO_MS);
    const send = (obj) => { if (!sock.destroyed) sock.write(jsonPacket(obj)); };
    const fail = (code) => { send({ type: 'error', code }); sock.end(); setTimeout(() => sock.destroy(), 200); };
    send({ type: 'hello', role: 'bridge', name: o.name, id: o.id, nonce: c.nonce });
    sock.on('data', createParser((kind, payload) => {
      if (kind !== KIND.JSON) return fail('kind');
      const m = parseJson(payload);
      if (!m) return fail('json');
      if (m.v !== WIRE_VERSION) return fail('version');
      if (!c.authed) {
        if (m.type !== 'auth' || !safeEqual(m.mac, mac(o.secret, 'sv-bridge|c|' + c.nonce))) {
          // Durum penceresi için: son eşleşmeyen denemeler (adres, an)
          authFails.unshift({ addr: c.addr, at: now() });
          authFails.length = Math.min(authFails.length, 8);
          emit();
          return fail('auth');
        }
        c.authed = true;
        c.audio = m.audio === true;
        clearTimeout(t);
        // Köprü de parolayı bildiğini gösterir: alıcının nonce'u
        send({ type: 'welcome', mac: mac(o.secret, 'sv-bridge|s|' + String(m.nonce || '')), t: now() });
        if (lastMeta) send({ type: 'meta', meta: lastMeta, t: now() });
        emit();
        return;
      }
      if (m.type === 'ping') {
        send({ type: 'pong', t0: m.t0, t1: now() });
        // Alıcının kendi ölçtüğü: ad, gidiş-dönüş, kare yaşı, kayıp
        if (m.r && typeof m.r === 'object') {
          const num = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
          c.report = { name: String(m.r.name || '').slice(0, 60), rttMs: num(m.r.rttMs), ageMs: num(m.r.ageMs), lost: num(m.r.lost) || 0, at: now() };
        }
      }
      else if (m.type === 'audio') { const was = c.audio; c.audio = m.on === true; if (was !== c.audio) emit(); }
    }, () => sock.destroy()));
    sock.on('error', () => {});
    sock.on('close', () => { clearTimeout(t); clients.delete(c); emit(); });
  }

  return {
    start() {
      if (server) return Promise.resolve(status());
      return new Promise((resolve) => {
        server = net.createServer(onConn);
        server.on('error', (e) => { stats.listening = false; stats.error = e && e.code ? e.code : 'error'; emit(); resolve(status()); });
        server.listen(o.port, o.host, () => { const a = server.address(); if (a && a.port) o.port = a.port; stats.listening = true; stats.error = ''; emit(); resolve(status()); });
      });
    },
    stop() {
      for (const c of clients) c.sock.destroy();
      clients.clear();
      const s = server;
      server = null;
      stats.listening = false;
      return new Promise((r) => (s ? s.close(() => r()) : r()));
    },
    frame(frame) {
      if (!clients.size) return;
      const bytes = Buffer.isBuffer(frame) ? frame : frameFormat.encodeFrame(frame);
      const pkt = framePacket(bytes, ++seq, now());
      for (const c of clients) {
        if (!c.authed || c.sock.destroyed) continue;
        if (c.sock.writableLength > MAX_QUEUE) { c.dropped++; stats.dropped++; continue; }
        c.sock.write(pkt);
        stats.sent++;
      }
    },
    /* Köprünün kendi çözümlemesi (bridge-analysis.js): bantlar, seviye,
       vuruş, BPM, başlangıç; `a.t` köprünün saati. Yavaş alıcıya atlanır. */
    analysis(a) {
      if (!clients.size || !a) return;
      const pkt = jsonPacket({ type: 'analysis', a });
      for (const c of clients) {
        if (!c.authed || c.sock.destroyed) continue;
        if (c.sock.writableLength > MAX_QUEUE) continue;
        c.sock.write(pkt);
      }
    },
    /* Dinlenebilir ses: s16 LE, kendi örnekleme hızında; yalnız isteyen
       alıcıya. Kuyruğu dolu alıcıya atlanır (gecikme birikmesin). */
    pcm(s16, sampleRate, channels) {
      if (!clients.size || !s16 || !s16.length) return;
      let pkt = null;
      for (const c of clients) {
        if (!c.authed || !c.audio || c.sock.destroyed) continue;
        if (c.sock.writableLength > MAX_QUEUE) { stats.pcmDropped = (stats.pcmDropped || 0) + 1; continue; }
        if (!pkt) pkt = pcmPacket(s16.length > PCM_MAX ? s16.subarray(0, PCM_MAX) : s16, ++pcmSeq, now(), sampleRate, channels || 2);
        c.sock.write(pkt);
      }
    },
    wantsAudio() { for (const c of clients) if (c.authed && c.audio && !c.sock.destroyed) return true; return false; },
    meta(st) {
      lastMeta = slimMeta(st);
      const pkt = jsonPacket({ type: 'meta', meta: lastMeta, t: now() });
      for (const c of clients) if (c.authed && !c.sock.destroyed) c.sock.write(pkt);
    },
    peerCount() { return Array.from(clients).filter((c) => c.authed).length; },
    status,
  };
}

/* ---- Saat farkı ----------------------------------------------------------
   NTP'nin tek yönlü biçimi: alıcı t0'da sorar, köprü t1'de yanıtlar, alıcı
   t3'te alır. fark = t1 - (t0 + t3) / 2 (köprünün saati - bizimki). Gidiş-
   dönüşü en kısa son örnek seçiliyor: ağ titremesi en az o örnekte. */
function createClock(size) {
  const n = size || 8;
  const samples = [];
  return {
    add(t0, t1, t3) {
      if (![t0, t1, t3].every(Number.isFinite) || t3 < t0) return null;
      samples.push({ rtt: t3 - t0, offset: t1 - (t0 + t3) / 2 });
      if (samples.length > n) samples.shift();
      return this.best();
    },
    best() {
      if (!samples.length) return null;
      return samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    },
    reset() { samples.length = 0; },
  };
}

/* ---- Alıcı ---------------------------------------------------------------
   Köprüye bağlanır, sınanır, kare ve meta alır. Koparsa 0,5-5 sn arayla
   yeniden dener. Durum: bağlantı, gidiş-dönüş, saat farkı, karenin yaşı. */
function createReceiver(opts) {
  const o = Object.assign({ host: '', port: DEFAULT_PORT, secret: '' }, opts || {});
  const now = o.now || Date.now;
  const clock = createClock(8);
  let sock = null;
  let stopped = true;
  let retry = 0;
  let retryTimer = null;
  let pingTimer = null;
  let lastKick = 0;
  let lastAttempt = 0;
  let candidates = o.host ? [o.host] : [];
  const st = { state: 'idle', host: o.host, port: o.port, name: '', id: '', rttMs: null, offsetMs: null, ageMs: null, frames: 0, lost: 0, error: '', lastSeq: 0, audio: o.audio === true, pcm: 0, pcmLost: 0, pcmRate: 0, lastPcmSeq: 0 };
  function emit() { if (o.onStatus) o.onStatus(Object.assign({}, st)); }

  function schedule() {
    if (stopped || retryTimer) return;
    /* Bekleme en çok 1 sn (#813, Linux'ta ölçüldü): eskiden 0,5-1-2-5 sn
       idi; 8 sn'lik bir kesintiden sonra yeniden açılan köprüye 4,8 sn sonra
       bağlanılıyordu. Bağlanma denemesi ucuz (yerel ağ, tek TCP). */
    const wait = RETRY_MS[Math.min(retry, RETRY_MS.length - 1)];
    retry++;
    retryTimer = setTimeout(() => { retryTimer = null; connect(); }, wait);
  }
  function cleanup() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    if (sock) { sock.removeAllListeners('close'); sock.destroy(); sock = null; }
  }
  function connect() {
    if (stopped) return;
    if (!o.host) { st.state = 'searching'; emit(); return; }
    cleanup();
    clock.reset();
    lastAttempt = now();
    st.state = 'connecting';
    st.error = '';
    emit();
    const myNonce = crypto.randomBytes(16).toString('hex');
    let authed = false;
    const s = net.connect({ host: o.host, port: o.port });
    sock = s;
    s.setNoDelay(true);
    const send = (obj) => { if (!s.destroyed) s.write(jsonPacket(obj)); };
    const helloTimer = setTimeout(() => { if (!authed) { st.error = 'timeout'; s.destroy(); } }, HELLO_MS);
    s.on('data', createParser((kind, payload) => {
      if (kind === KIND.PCM) {
        if (!authed) return s.destroy();
        const p = readPcm(payload);
        if (p.error) { st.error = 'pcm-' + p.error; return s.destroy(); }
        if (st.lastPcmSeq && p.seq > st.lastPcmSeq + 1) st.pcmLost += p.seq - st.lastPcmSeq - 1;
        st.lastPcmSeq = p.seq;
        st.pcm++;
        st.pcmRate = p.sampleRate;
        const b = clock.best();
        if (st.audio && o.onPcm) o.onPcm(p.data, { seq: p.seq, t: p.t, localT: b ? p.t - b.offset : null, sampleRate: p.sampleRate, channels: p.channels });
        return;
      }
      if (kind === KIND.FRAME) {
        if (!authed) return s.destroy();
        const f = readFrame(payload);
        if (f.error) { st.error = 'frame-' + f.error; return s.destroy(); }
        if (st.lastSeq && f.seq > st.lastSeq + 1) st.lost += f.seq - st.lastSeq - 1;
        st.lastSeq = f.seq;
        st.frames++;
        const b = clock.best();
        // Karenin yaşı: köprünün saatindeki anı bizim saate çevirip şimdiden çıkar
        const local = b ? f.t - b.offset : null;
        st.ageMs = local == null ? null : Math.max(0, now() - local);
        if (o.onFrame) o.onFrame(f.frame, { seq: f.seq, t: f.t, localT: local });
        return;
      }
      const m = parseJson(payload);
      if (!m) return s.destroy();
      if (m.v !== WIRE_VERSION) { st.error = 'version'; st.state = 'error'; emit(); return s.destroy(); }
      if (m.type === 'hello') {
        st.name = String(m.name || '').slice(0, 60);
        st.id = String(m.id || '').slice(0, 64);
        send({ type: 'auth', mac: mac(o.secret, 'sv-bridge|c|' + String(m.nonce || '')), nonce: myNonce, audio: st.audio });
      } else if (m.type === 'welcome') {
        // Köprü de parolayı bilmeli: yoksa sahte bir köprüye ses için bağlanmayız
        if (!safeEqual(m.mac, mac(o.secret, 'sv-bridge|s|' + myNonce))) { st.error = 'auth'; st.state = 'error'; emit(); return s.destroy(); }
        authed = true;
        retry = 0;
        clearTimeout(helloTimer);
        st.state = 'connected';
        emit();
        const ping = () => send({ type: 'ping', t0: now(), r: { name: o.name || '', rttMs: st.rttMs, ageMs: st.ageMs, lost: st.lost } });
        ping();
        pingTimer = setInterval(ping, 1000);
      } else if (m.type === 'pong') {
        const b = clock.add(Number(m.t0), Number(m.t1), now());
        if (b) { st.rttMs = Math.round(b.rtt * 10) / 10; st.offsetMs = Math.round(b.offset * 10) / 10; }
        emit();
      } else if (m.type === 'analysis') {
        if (!authed || !m.a || typeof m.a !== 'object') return;
        const b = clock.best();
        // Damga bizim saate: alıcı vuruşu kendi zamanında konumlayabilsin
        const a = Object.assign({}, m.a, { localT: b && Number.isFinite(m.a.t) ? m.a.t - b.offset : null });
        st.analysis = a;
        if (o.onAnalysis) o.onAnalysis(a);
      } else if (m.type === 'meta') {
        if (!authed) return;
        const b = clock.best();
        const meta = m.meta && typeof m.meta === 'object' ? Object.assign({}, m.meta, { bridgeT: Number.isFinite(m.t) ? m.t : null, localT: b && Number.isFinite(m.t) ? m.t - b.offset : null }) : null;
        if (o.onMeta) o.onMeta(meta);
      } else if (m.type === 'error') {
        st.error = String(m.code || 'error').slice(0, 20);
      }
    }, () => s.destroy()));
    s.on('error', (e) => { st.error = st.error || (e && e.code) || 'error'; });
    s.on('close', () => {
      clearTimeout(helloTimer);
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      if (sock === s) sock = null;
      if (st.state !== 'error' || st.error !== 'auth') st.state = stopped ? 'idle' : 'connecting';
      st.ageMs = null;
      /* Kurulamayan bağlantı: köprünün bir sonraki adresi denenir (ör. bu
         makineden ulaşılamayan bir sanal kart adresi). */
      if (!authed && candidates.length > 1) {
        const i = candidates.indexOf(o.host);
        const nextHost = candidates[(i + 1) % candidates.length];
        if (nextHost && nextHost !== o.host) { o.host = nextHost; st.host = nextHost; retry = 0; }
      }
      emit();
      // Parola tutmuyorsa yine denenir ama yavaş: ayar düzelince bağlanır
      schedule();
    });
  }

  return {
    start() { if (!stopped) return; stopped = false; retry = 0; connect(); },
    stop() {
      stopped = true;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      cleanup();
      st.state = 'idle';
      emit();
    },
    /* Keşifle bulunan ya da elle değişen adres. `alts`: aynı köprünün öbür
       adresleri (sıralı). Bağlıyken ve bağlı adres hâlâ köprünün adresiyse
       DOKUNULMAZ; adres yalnız bağlantı kurulamayınca değişir. */
    setTarget(host, port, alts) {
      const h = String(host || '');
      const p = Number(port) || o.port;
      const list = Array.isArray(alts) && alts.length ? alts.map(String) : (h ? [h] : []);
      if (st.state === 'connected' && p === o.port && list.indexOf(o.host) >= 0) { candidates = list; return; }
      candidates = list;
      if (h === o.host && p === o.port) return;
      o.host = h; o.port = p; st.host = h; st.port = p;
      if (!stopped) { cleanup(); retry = 0; if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } connect(); }
    },
    /* Köprünün işareti duyuldu: bağlı değilse bekleme beklenmeden hemen
       denenir. Süren bir deneme bozulmaz; en çok 300 ms'de bir. */
    kick() {
      if (stopped || st.state === 'connected' || !o.host) return false;
      if (sock && !sock.destroyed && st.state === 'connecting' && now() - lastAttempt < 1500) return false;
      if (now() - lastKick < 300) return false;
      lastKick = now();
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      connect();
      return true;
    },
    // Dinlenebilir sesi iste / bırak; bağlantı kopmaz
    setAudio(on) {
      const v = on === true;
      if (v === st.audio) return;
      st.audio = v;
      st.lastPcmSeq = 0;
      if (sock && !sock.destroyed && st.state === 'connected') sock.write(jsonPacket({ type: 'audio', on: v }));
      emit();
    },
    status() { return Object.assign({}, st); },
  };
}

/* ---- Keşif ----------------------------------------------------------------
   Köprü saniyede bir UDP yayını yollar: 255.255.255.255 ve her IPv4
   arayüzünün yayın adresi (bazı yönlendiriciler genel yayını geçirmiyor).
   İşaret imzalı: mac = HMAC(parola, id|port|ts). Alıcı yalnız imzası tutan
   ve 30 sn'den taze olan işareti kabul eder; 5 sn duyulmayan köprü düşer. */
function broadcastAddresses(ifaces) {
  const out = new Set(['255.255.255.255']);
  const all = ifaces || os.networkInterfaces();
  for (const name of Object.keys(all || {})) {
    for (const a of all[name] || []) {
      if (!a || a.internal || (a.family !== 'IPv4' && a.family !== 4)) continue;
      const ip = String(a.address).split('.').map(Number);
      const mask = String(a.netmask || '').split('.').map(Number);
      if (ip.length !== 4 || mask.length !== 4 || ip.some((x) => !(x >= 0 && x <= 255)) || mask.some((x) => !(x >= 0 && x <= 255))) continue;
      out.add(ip.map((x, i) => (x | (~mask[i] & 255)) & 255).join('.'));
    }
  }
  return Array.from(out);
}

function beaconMessage(o, ts) {
  const body = { app: 'sv-bridge', v: WIRE_VERSION, id: String(o.id || ''), name: String(o.name || ''), port: o.port | 0, ts };
  body.mac = mac(o.secret, body.id + '|' + body.port + '|' + ts);
  return Buffer.from(JSON.stringify(body), 'utf8');
}
function verifyBeacon(buf, secret, now) {
  let m = null;
  try { m = JSON.parse(buf.toString('utf8')); } catch { return null; }
  if (!m || m.app !== 'sv-bridge' || typeof m.id !== 'string' || !m.id) return null;
  if (m.v !== WIRE_VERSION) return { id: m.id, name: String(m.name || ''), port: m.port | 0, paired: false, reason: 'version' };
  const fresh = Number.isFinite(m.ts) && Math.abs(now - m.ts) < 30000;
  const ok = fresh && safeEqual(m.mac, mac(secret, m.id + '|' + (m.port | 0) + '|' + m.ts));
  return { id: m.id, name: String(m.name || '').slice(0, 60), port: m.port | 0, paired: ok, reason: ok ? '' : fresh ? 'secret' : 'clock' };
}

function createBeacon(opts) {
  const o = Object.assign({ beaconPort: BEACON_PORT, intervalMs: 1000 }, opts || {});
  let sock = null;
  let timer = null;
  return {
    start() {
      if (sock) return;
      sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('error', () => {});
      sock.bind(0, () => {
        try { sock.setBroadcast(true); } catch { /* */ }
        const tick = () => {
          if (!sock) return;
          const msg = beaconMessage(o, Date.now());
          for (const addr of broadcastAddresses()) sock.send(msg, o.beaconPort, addr, () => {});
        };
        tick();
        timer = setInterval(tick, o.intervalMs);
        if (timer.unref) timer.unref();
      });
    },
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
      if (sock) { try { sock.close(); } catch { /* */ } sock = null; }
    },
  };
}

/* Yerel ağ kartlarının IPv4 alt ağları; bir adres bunlardan biriyle aynı
   alt ağdaysa doğrudan ulaşılabilir sayılır (yönlendirici gerekmez). */
function localSubnets(ifaces) {
  const out = [];
  const all = ifaces || os.networkInterfaces();
  for (const name of Object.keys(all || {})) {
    for (const a of all[name] || []) {
      if (!a || a.internal || (a.family !== 'IPv4' && a.family !== 4) || !a.netmask) continue;
      out.push({ addr: ipNum(a.address), mask: ipNum(a.netmask) });
    }
  }
  return out;
}
function ipNum(ip) {
  const p = String(ip || '').split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !(x >= 0 && x <= 255))) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
function sameSubnet(ip, subnets) {
  const n = ipNum(ip);
  if (n == null) return false;
  return subnets.some((s) => s.addr != null && s.mask != null && ((n & s.mask) >>> 0) === ((s.addr & s.mask) >>> 0));
}
/* Aynı köprünün işareti birden çok adresten gelebilir (#813, Windows'ta
   görüldü: vEthernet / Hyper-V / VPN kartları; saniyede dört adres). Sıra:
   yerel bir kartla aynı alt ağda olan önce, sonra ilk duyulan. Sıra
   kararlı: adres her işarette değişmiyor. */
function rankHosts(hosts, subnets) {
  return hosts.slice().sort((a, b) => {
    const sa = sameSubnet(a.host, subnets) ? 0 : 1;
    const sb = sameSubnet(b.host, subnets) ? 0 : 1;
    return sa - sb || a.first - b.first;
  }).map((h) => h.host);
}

function createDiscovery(opts) {
  const o = Object.assign({ beaconPort: BEACON_PORT, secret: '', expireMs: 5000 }, opts || {});
  const seen = new Map();
  let sock = null;
  let sweep = null;
  const st = { listening: false, error: '' };
  let subnetCache = null;
  let subnetAt = 0;
  function subnets() {
    if (o.subnets) return o.subnets;
    if (!subnetCache || Date.now() - subnetAt > 10000) { subnetCache = localSubnets(); subnetAt = Date.now(); }
    return subnetCache;
  }
  function list() {
    return Array.from(seen.values()).sort((a, b) => (b.paired - a.paired) || a.name.localeCompare(b.name))
      .map((e) => { const { hostsSeen, ...rest } = e; return rest; });
  }
  function changed() { if (o.onChange) o.onChange(list(), Object.assign({}, st)); }
  return {
    start() {
      if (sock) return;
      sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('error', (e) => { st.listening = false; st.error = (e && e.code) || 'error'; changed(); });
      sock.on('message', (buf, rinfo) => {
        if (buf.length > 2048) return;
        const b = verifyBeacon(buf, o.secret, Date.now());
        if (!b || (o.selfId && b.id === o.selfId)) return;
        const prev = seen.get(b.id);
        const t = Date.now();
        /* Köprü kimliğine göre TEK kayıt; adresler kaydın içinde. Adres
           değişince eskiden "değişti" bildiriliyor ve alıcı her saniye
           yeniden bağlanıyordu. */
        const hosts = prev ? prev.hostsSeen.filter((h) => t - h.at <= o.expireMs) : [];
        const known = hosts.find((h) => h.host === rinfo.address);
        if (known) known.at = t; else hosts.push({ host: rinfo.address, first: t, at: t });
        const ranked = rankHosts(hosts, subnets());
        const entry = Object.assign(b, { host: ranked[0], hosts: ranked, hostsSeen: hosts, at: t });
        seen.set(b.id, entry);
        if (!prev || prev.host !== entry.host || prev.paired !== entry.paired || prev.port !== entry.port || prev.name !== entry.name || prev.hosts.length !== ranked.length) changed();
        // Her işaret: köprü yeniden açıldıysa alıcı beklemeden bağlansın
        if (o.onBeacon) o.onBeacon(entry);
      });
      sock.bind(o.beaconPort, () => { st.listening = true; st.error = ''; changed(); });
      sweep = setInterval(() => {
        const now = Date.now();
        let gone = false;
        for (const [id, e] of seen) if (now - e.at > o.expireMs) { seen.delete(id); gone = true; }
        if (gone) changed();
      }, 1000);
      if (sweep.unref) sweep.unref();
    },
    stop() {
      if (sweep) { clearInterval(sweep); sweep = null; }
      if (sock) { try { sock.close(); } catch { /* */ } sock = null; }
      seen.clear();
      st.listening = false;
    },
    list,
    status() { return Object.assign({}, st); },
  };
}

/* Durum penceresinin gönderdiği kaynak listesi (#813): uygulamanın Ses
   Kaynakları seçicisinin biçimi (audio.sources). Aygıt adları ve uygulama
   hedefleri karışık; yinelenen atılır, en çok 16; boşsa varsayılan çıkış
   (tek kaynak, eskisi gibi). */
function sanitizeSources(list) {
  const AA = require('../shared/app-audio.js');
  const next = [];
  const seen = new Set();
  for (const x of Array.isArray(list) ? list.slice(0, 16) : []) {
    let v = null;
    if (typeof x === 'string' && x.trim()) v = x.slice(0, 300);
    else if (x && typeof x === 'object') v = AA.normalizeApp(Object.assign({}, x, { kind: 'app' }));
    if (v == null) continue;
    const k = typeof v === 'string' ? v : 'app:' + AA.baseName(v.match);
    if (seen.has(k)) continue;
    seen.add(k);
    next.push(v);
  }
  return next.length ? next : ['default'];
}

module.exports = {
  WIRE_VERSION, DEFAULT_PORT, BEACON_PORT, MIN_SECRET, MAX_PACKET, KIND, FRAME_HEAD, DEFAULTS, RETRY_MS,
  normalize, sanitizeSources, problem, newSecret, mac, localSubnets, sameSubnet, rankHosts,
  packet, jsonPacket, framePacket, readFrame, pcmPacket, readPcm, PCM_HEAD, PCM_MAX, createParser, slimMeta,
  createSender, createReceiver, createClock,
  broadcastAddresses, beaconMessage, verifyBeacon, createBeacon, createDiscovery,
};
