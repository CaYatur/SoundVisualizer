/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* YEDEKLİLİK (#540): birincil ve yedek makine.

   Birincil gösteriyi yürütür; yedek SICAK bekler: aynı sahneyi kendisi de
   çizer, ekranı hiç kararmaz. Birincil düşerse yedek yetkiyi alır — çizmeye
   başlamaz, zaten çiziyordur; kendi kararlarını vermeye başlar. Çıkışların
   hangisinin seyirciye gittiğini görüntü anahtarlayıcısı ya da operatör seçer.

   BAĞLANTI: birincilin yayın sunucusu (stream-server.js) `kind=peer`
   istemcisini kabul eder; her zaman ayrı bir eşleşme parolası ister (yayın
   katmanı jetonsuz da olsa). Yedek Node'un yerleşik WebSocket'iyle bağlanır;
   yeni bağımlılık yok.

   İLETİLER (birincil → yedek):
     hello    { version, role }
     snapshot { live, show, at }           — bağlanınca bütün görüntü ve gösteri
     patch    { part, at }                 — değişen anahtarlar
     beat     { seq, at, scene }           — kalp atışı
   (yedek → birincil):
     peer-state { state }                  — birincil operatörü yedeğin hâlini görsün

   Yedeğin hâli:
     off        — rol kapalı
     connecting — birincile ulaşılamıyor (henüz hiç atış yok)
     following  — atışlar geliyor, görüntü birincilden
     lost       — atış eşiği aşıldı, elle devralma bekleniyor
     active     — yedek yetkiyi aldı (kendiliğinden ya da elle)
   Devralma kendiliğinden ya da elle olur (önceden seçilir). Etkin yedek,
   birincil geri gelse de etkin kalır: operatör "Bırak" demeden yetki geri
   gitmez — gidip gelme (flapping) gösteriyi iki kez sarsar. */

const crypto = require('crypto');
const ShowKeys = require('../shared/show-keys');

const DEFAULTS = {
  role: 'off', host: '', port: 8722, secret: '',
  heartbeatMs: 250, timeoutMs: 1500, takeover: 'auto',
  // Devralmada çizilecek gösteri (#812): birincilin yalıtılmış kopyası ya da yerel gösteri
  takeoverData: 'primary',
  /* Çıkış yetkisi (#814): her çıkış 'authority' (yalnız yetkideki makine
     gönderir) ya da 'always'. Art-Net yetki gidince son kareyi tutar
     ('hold', ışıklar yanıp sönmez) ya da bir kez sıfır kare yollar ('zero'). */
  outputs: { artnet: 'authority', oscOut: 'authority', openrgb: 'authority', lighting: 'authority' },
  artnetOnLoss: 'hold',
  // Korumalı geri vermenin anı: 'now' | 'scene' | 'black'
  handbackAt: 'scene',
  // Art-Net tanığı: ağda başka bir kaynaktan aynı evrene gelen kareyi dinle
  artnetWitness: true,
  // Devralma ve iki yönetici alarmında ses (#815); canlı mekânda dinleti karışımına sızmasın: kapalı
  alarmSound: false,
  // İzleyen yedek birincilin tempo ızgarasını kullanır (#815): iki makine aynı vuruşta
  phaseLock: true,
};
const MIN_SECRET = 16;

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function normalize(c) {
  const s = Object.assign({}, DEFAULTS, c || {});
  if (['off', 'primary', 'backup'].indexOf(s.role) < 0) s.role = 'off';
  s.host = String(s.host || '').trim().slice(0, 253);
  s.port = clamp(Math.round(num(s.port, 8722)), 1024, 65535);
  s.secret = String(s.secret || '');
  s.heartbeatMs = clamp(Math.round(num(s.heartbeatMs, 250)), 50, 5000);
  // Eşik en az üç atış: tek kaybolan paket devralma yaptırmasın
  s.timeoutMs = clamp(Math.round(num(s.timeoutMs, 1500)), s.heartbeatMs * 3, 60000);
  if (s.takeover !== 'manual') s.takeover = 'auto';
  if (s.takeoverData !== 'local') s.takeoverData = 'primary';
  s.outputs = outputModes(s);
  if (s.artnetOnLoss !== 'zero') s.artnetOnLoss = 'hold';
  if (HANDBACK_AT.indexOf(s.handbackAt) < 0) s.handbackAt = 'scene';
  s.artnetWitness = s.artnetWitness !== false;
  s.alarmSound = s.alarmSound === true;
  s.phaseLock = s.phaseLock !== false;
  return s;
}

/* Bağlantıyı yeniden kurmayı gerektiren ayarların imzası. Devralma verisi
   (#812) yalnız devralma anında okunur: değiştirmek bağlantıyı koparmasın. */
function linkSig(c) {
  const s = normalize(c);
  // Bağlantıyı etkilemeyenler (#812, #814): değişince bağlantı kopmasın
  for (const k of ['takeoverData', 'outputs', 'artnetOnLoss', 'handbackAt', 'artnetWitness', 'alarmSound', 'phaseLock']) delete s[k];
  return JSON.stringify(s);
}

/* Yedeğin şu an çizdiği gösteri (#812). İzlerken (ve bağlantı beklerken)
   her zaman birincilin kopyası; yetkiyi alınca önceden seçilen ya da
   operatörün o an seçtiği. */
function showSource(state, cfg, override) {
  if (state !== 'active') return 'primary';
  if (override === 'local' || override === 'primary') return override;
  return normalize(cfg).takeoverData;
}

/* MilkDrop eşliği (#812): birincilin seçtiği kullanıcı presetinin içerik
   özeti (`hash`) yedekteki presetinkiyle karşılaştırılır. Yerleşik preset
   (özet yok) uygulamayla gelir; sürüm aynıysa aynıdır.
     ''          — eşit ya da denetlenemez
     'missing'   — birincilin preseti bu makinede yok: pencere eski presette kalır
     'different' — aynı kimlik, farklı içerik: aynı ad, farklı görüntü */
/* Birincilin MilkDrop seçimi bu makinenin pencerelerine giderken (#812):
   geçiş anı birincilin saatinden yerel saate çevrilir; pencere bunu
   `Date.now()` ile karşılaştırıyor. `at` alanı TAŞINMAZ: pencere mesajın
   geliş anını (`performance.now()`) o adla tutuyor ve 1,5 sn sonra izlemeyi
   bırakıyor — dışarıdan gelen bir `at` bu zamanlayıcıyı bozardı. */
function localFollow(follow, toLocal) {
  if (!follow || typeof follow !== 'object') return follow;
  const out = Object.assign({}, follow);
  delete out.at;
  delete out.hash;
  if (Number.isFinite(out.startedAt) && typeof toLocal === 'function') {
    const t = toLocal(out.startedAt);
    out.startedAt = Number.isFinite(t) ? t : null;
  } else {
    out.startedAt = null;
  }
  return out;
}

function mdParity(follow, localFp) {
  if (!follow || !follow.id || typeof follow.hash !== 'string' || !follow.hash) return '';
  if (!localFp) return 'missing';
  return localFp === follow.hash ? '' : 'different';
}

// Rol çalışabilir mi; değilse nedeni (arayüz ve sağlık denetimi gösterir)
function problem(c) {
  const s = normalize(c);
  if (s.role === 'off') return '';
  if (s.secret.length < MIN_SECRET) return 'secret';
  if (s.role === 'backup' && !s.host) return 'host';
  return '';
}

/* YEDEĞİN DURUM MAKİNESİ. Saat dışarıdan verilir (test sahte saatle sürer). */
function createFollower(cfg, now) {
  const s = normalize(cfg);
  const st = {
    state: 'connecting',
    connected: false,
    lastBeat: 0,
    lastSeq: -1,
    scene: '',
    since: now,
    takenAt: 0,
    takenBy: '',
    // En uzun atış arası (ms): eşiği ayarlamak için ölçü
    maxGap: 0,
    // Birincilin kendi ölçtüğü en uzun gönderim arası (ms)
    maxPrimaryGap: 0,
    /* SAAT FARKI (#544): yedeğin saati − birincilin saati (ms). Atış
       birincilde gönderilirken damgalanıyor (`at`); örnek = varış − at =
       fark + gecikme. Son 10 sn'nin EN KÜÇÜĞÜ: birincilin duraklaması
       örneği etkilemez (damga gönderimde), yedeğin duraklaması örneği
       büyütür ve en küçük onu eler. Düzeltme sıçramaz, atış başına en çok
       1 ms kayar: iki makineden birinin saati (NTP) oynarsa görüntü zıplamaz. */
    offsetMs: null,
    offsetSamples: 0,
    /* EL İLE BIRAKILDI, OTOMATİK BEKLİYOR (#812, Windows'ta bulundu).
       Birincil kapalıyken "Yetkiyi Bırak" denince kendiliğinden devralma
       aynı anda yeniden alıyordu. Bırakıştan sonra otomatik devralma,
       birincil yeniden canlı görülene (atış) ya da operatör yeniden
       kurana dek durur; el ile devralma her zaman çalışır. */
    autoHeld: false,
    /* İSTATİSTİK (panelin kutucukları): gelen atış, kaybolan atış (sıra
       boşluğu), birincilin yeniden başlaması. Atış aralığının p95'i ve
       titremesi `status`'ta son RING aralıktan hesaplanır. */
    beats: 0,
    missed: 0,
    /* KENDİLİĞİNDEN DEVRALMAYA VETO (#814): Art-Net tanığı birincilin hâlâ
       ışık sürdüğünü görüyorsa (ağ yalnız aramızda bölünmüş) ya da iki
       yönetici alarmı çalıyorsa otomatik devralma beklemede; elle her zaman. */
    veto: '',
  };
  const RING = 128;
  const gaps = new Float64Array(RING);
  let gapN = 0;
  function gapStats() {
    const n = Math.min(gapN, RING);
    if (!n) return { gapP95Ms: null, jitterMs: null };
    const a = Array.from(gaps.subarray(0, n)).sort((x, y) => x - y);
    const p95 = a[Math.min(n - 1, Math.floor(n * 0.95))];
    // Titreme: aralığın beklenen atış aralığından sapmasının p95'i
    const dev = a.map((g) => Math.abs(g - s.heartbeatMs)).sort((x, y) => x - y);
    return { gapP95Ms: Math.round(p95), jitterMs: Math.round(dev[Math.min(n - 1, Math.floor(n * 0.95))]) };
  }
  const samples = [];
  function noteOffset(at, t) {
    if (!Number.isFinite(at)) return;
    samples.push({ t, v: t - at });
    while (samples.length && t - samples[0].t > 10000) samples.shift();
    let best = Infinity;
    for (const x of samples) if (x.v < best) best = x.v;
    st.offsetSamples = samples.length;
    if (st.offsetMs == null) { st.offsetMs = best; return; }
    const d = best - st.offsetMs;
    st.offsetMs += d > 1 ? 1 : d < -1 ? -1 : d;
  }
  /* İki ayrı belirti. Bağlantı KAPANDIYSA süreç ölmüştür (işletim sistemi
     soketi hemen kapatır): kısa pay yeter. Bağlantı açık ama atış gecikiyorsa
     birincil yalnız meşgul olabilir — ölçüldü, ana iş parçacığı sahne
     değişiminde 0,2–0,7 sn duraklıyor: tam eşik beklenir. Güç kesintisi ya
     da kablo kopması bağlantıyı kapatmaz; o zaman da tam eşik. */
  function lossLimit() {
    return st.connected ? s.timeoutMs : Math.min(s.timeoutMs, Math.max(300, s.heartbeatMs * 3));
  }
  function set(next, t) {
    if (st.state === next) return false;
    st.state = next;
    st.since = t;
    return true;
  }
  return {
    get status() {
      return Object.assign({}, st, gapStats(), { takeover: s.takeover, heartbeatMs: s.heartbeatMs, timeoutMs: s.timeoutMs, lossLimitMs: lossLimit() });
    },
    connected() { st.connected = true; },
    disconnected() { st.connected = false; },
    // Atış geldi: etkin değilse izlemeye döner
    beat(msg, t) {
      if (st.lastBeat && st.state === 'following') {
        st.maxGap = Math.max(st.maxGap, t - st.lastBeat);
        gaps[gapN++ % RING] = t - st.lastBeat;
      }
      st.beats++;
      // Sıra boşluğu: arada kaybolan atış (birincil yeniden başlayınca sıra 0'dan)
      if (msg && Number.isFinite(msg.seq) && st.lastSeq >= 0 && msg.seq > st.lastSeq + 1) st.missed += msg.seq - st.lastSeq - 1;
      if (msg && Number.isFinite(msg.gap)) st.maxPrimaryGap = Math.max(st.maxPrimaryGap, msg.gap);
      if (msg) noteOffset(msg.at, t);
      st.lastBeat = t;
      if (msg && Number.isFinite(msg.seq)) st.lastSeq = msg.seq;
      if (msg && typeof msg.scene === 'string') st.scene = msg.scene;
      // Birincil canlı görüldü: el ile bırakıştan sonraki bekleme biter
      st.autoHeld = false;
      if (st.state === 'active') return false;
      return set('following', t);
    },
    /* Zaman ilerledi: eşik aşıldıysa kayıp; kendiliğindense devral.
       Birincile hiç ulaşamayan yedek (birincil kapalıyken açılan) sonsuza
       dek beklemesin: açılış payı (en az 5 sn, eşiğin iki katı) sonunda o
       da kayıp sayılır. */
    tick(t) {
      if (st.state === 'active' || st.state === 'lost') {
        if (st.state === 'lost' && s.takeover === 'auto' && !st.autoHeld && !st.veto) { st.takenAt = t; st.takenBy = 'auto'; return set('active', t); }
        return false;
      }
      if (st.state === 'connecting') {
        if (t - st.since <= Math.max(5000, s.timeoutMs * 2)) return false;
      } else if (t - st.lastBeat <= lossLimit()) {
        return false;
      }
      if (s.takeover === 'auto' && !st.autoHeld && !st.veto) { st.takenAt = t; st.takenBy = 'auto'; return set('active', t); }
      return set('lost', t);
    },
    takeover(t) { st.autoHeld = false; st.takenAt = t; st.takenBy = 'manual'; return set('active', t); },
    // Otomatik devralmaya veto: neden ('' kaldırır)
    setVeto(why) { st.veto = typeof why === 'string' ? why : ''; },
    // Operatör otomatik devralmayı yeniden kurar (birincil hâlâ yoksa sonraki tikte devralır)
    rearm() { if (!st.autoHeld) return false; st.autoHeld = false; return true; },
    release(t) {
      if (st.state !== 'active') return false;
      st.takenAt = 0;
      st.takenBy = '';
      if (s.takeover === 'auto') st.autoHeld = true;
      // Birincil hâlâ atıyorsa izlemeye, atmıyorsa bağlantı beklemeye
      return set(st.lastBeat && t - st.lastBeat <= s.timeoutMs ? 'following' : 'connecting', t);
    },
    // Birincilin zaman damgası (ms) bu makinenin saatinde; fark yoksa olduğu gibi
    toLocal(ms) { return Number.isFinite(ms) ? ms + (st.offsetMs || 0) : ms; },
    // Yedek birincilden gelen görüntüyü uygulamalı mı
    follows() { return st.state === 'following' || st.state === 'lost' || st.state === 'connecting'; },
  };
}

/* İleti üreticileri (birincil). Kurulum anahtarları hiç girmez. */
function snapshotMsg(cfg, at) {
  return { type: 'snapshot', live: ShowKeys.pick(cfg, ShowKeys.LIVE), show: ShowKeys.pick(cfg, ShowKeys.SHOW), at };
}
function patchMsg(cfg, keys, at) {
  const allow = new Set(ShowKeys.REPLICATED);
  const k = (keys || []).filter((x) => allow.has(x));
  if (!k.length) return null;
  // Silinen anahtar JSON'da kaybolur: ayrıca adıyla gider
  const removed = k.filter((x) => !cfg || cfg[x] === undefined);
  const msg = { type: 'patch', part: ShowKeys.pick(cfg, k), at };
  if (removed.length) msg.removed = removed;
  return msg;
}
function beatMsg(seq, cfg, at) {
  return { type: 'beat', seq, at, scene: (cfg && typeof cfg._activeSceneId === 'string') ? cfg._activeSceneId : '' };
}

/* Birincilden gelen iletiyi yedeğin yapılandırmasına uygular; değişen
   anahtarları döndürür. Yalnız izinli anahtarlar (show-keys REPLICATED). */
function applyIncoming(target, msg) {
  if (!msg || typeof msg !== 'object') return [];
  if (msg.type === 'snapshot') {
    // Anlık görüntüde olmayan aktarılan anahtar birincilde yok: yedekten de silinir
    const all = Object.assign({}, msg.live || {}, msg.show || {});
    const part = {};
    for (const k of ShowKeys.REPLICATED) part[k] = Object.prototype.hasOwnProperty.call(all, k) ? all[k] : undefined;
    return ShowKeys.apply(target, part);
  }
  if (msg.type === 'patch') {
    const part = Object.assign({}, msg.part || {});
    for (const k of Array.isArray(msg.removed) ? msg.removed : []) if (typeof k === 'string') part[k] = undefined;
    return ShowKeys.apply(target, part);
  }
  return [];
}

function peerUrl(c) {
  const s = normalize(c);
  const host = /:/.test(s.host) && !/^\[/.test(s.host) ? '[' + s.host + ']' : s.host;
  return 'ws://' + host + ':' + s.port + '/ws?kind=peer&token=' + encodeURIComponent(s.secret);
}

/* YEDEĞİN BAĞLANTISI. `WS` yerleşik WebSocket (Node 22+); test sahtesini
   verir. Kopunca artan aralıkla (0,1 → 5 sn) yeniden dener: ilk deneme
   kopma payından (300 ms) önce — birincilin sunucusu yeniden başladıysa
   yedek yetkiyi almadan geri bağlanır.

   EŞLEŞME (#814): `urls` sırayla denenir — önce HMAC sınaması, birincil
   eskiyse (sınama gelmeden kapanır) açık parolalı eski adres. Bir adres
   açılıp eşleşince ona bağlı kalınır. HMAC'te `onOpen` yalnız birincil
   parolayı bildiğini kanıtlayınca çağrılır; o ana dek gelen iletiler
   işlenmez. */
function createClient(opts) {
  const o = opts || {};
  const WS = o.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : null);
  const urls = Array.isArray(o.urls) && o.urls.length ? o.urls : [o.url];
  let ui = 0;
  let ws = null;
  let closed = false;
  let delay = 100;
  let timer = null;
  let mode = '';
  function schedule() {
    if (closed || timer) return;
    timer = setTimeout(() => { timer = null; open(); }, delay);
    delay = Math.min(5000, delay * 2);
  }
  function open() {
    if (closed || !WS) return;
    const url = urls[ui % urls.length];
    const hmac = /[?&]auth=hmac(&|$)/.test(url);
    let sock;
    try { sock = new WS(url); } catch (e) { ui++; schedule(); return; }
    ws = sock;
    let ready = false;
    const myNonce = crypto.randomBytes(16).toString('hex');
    const ok = () => { ready = true; delay = 100; mode = hmac ? 'hmac' : 'token'; if (o.onOpen) o.onOpen(); };
    sock.onopen = () => { if (!hmac) ok(); };
    sock.onmessage = (ev) => {
      let msg = null;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
      if (!msg || typeof msg.type !== 'string') return;
      if (!ready) {
        if (!hmac) return;
        if (msg.type === 'peer-challenge') {
          try { sock.send(JSON.stringify({ type: 'peer-auth', mac: peerMac(o.secret, 'c', msg.nonce), nonce: myNonce })); } catch { /* */ }
        } else if (msg.type === 'peer-welcome') {
          // Birincil de parolayı bilmeli: yoksa sahte bir birincile bağlanmayız
          if (typeof msg.mac === 'string' && msg.mac === peerMac(o.secret, 's', myNonce)) ok();
          else { try { sock.close(); } catch { /* */ } }
        }
        return;
      }
      if (o.onMessage) o.onMessage(msg);
    };
    sock.onclose = () => {
      if (ws === sock) ws = null;
      // Eşleşmeden kapandı: öteki adres (eski birincil ya da yeni) denenir
      if (!ready) ui++;
      if (ready && o.onClose) o.onClose();
      else if (!ready && o.onFail) o.onFail(url);
      schedule();
    };
    sock.onerror = () => { /* onclose ardından gelir */ };
  }
  open();
  return {
    send(obj) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch { /* kopuk */ } },
    get mode() { return mode; },
    close() {
      closed = true;
      if (timer) { clearTimeout(timer); timer = null; }
      try { if (ws) ws.close(); } catch { /* */ }
      ws = null;
    },
  };
}

/* ===========================================================================
   YETKİ, DÖNEM VE ÇİT (#814). Eskiden yetki yalnız kimin karar verdiğini
   değiştiriyordu: Art-Net, OSC çıkışı ve OpenRGB iki makinede de
   gönderiyordu, birincil yedeğin yetkiyi aldığını görse de geri
   çekilmiyordu. Burada saf kararlar; ağ ve çıkışlar main.js'te.
   =========================================================================== */
/* Kimin yetkisi var: 'self' | 'peer' | 'unknown'.
     rol kapalı          → self (yedeklilik yokken davranış aynı)
     birincil, çitli     → unknown (yeniden açılan birincil yedeğin
                           durumunu görmeden çıkış sürmez)
     birincil            → peer, yedek DAHA YENİ dönemle yetkideyse; yoksa self
     yedek, yetkide      → self; değilse peer */
function authority(o) {
  const s = o || {};
  if (s.role !== 'primary' && s.role !== 'backup') return 'self';
  if (s.role === 'primary') {
    if (s.fenced) return 'unknown';
    if (s.peerState === 'active' && (Number(s.peerTerm) || 0) > (Number(s.term) || 0)) return 'peer';
    return 'self';
  }
  return s.state === 'active' ? 'self' : 'peer';
}

/* Çıkış kapısı: çıkışın ayarı 'always' ise her zaman; 'authority' ise
   yalnız yetki bu makinedeyse. Bilinmeyen çıkış (görüntü, Spout, yayın)
   kapıdan geçmez: görüntü anahtarlayıcısı seçer. */
const GATED = ['artnet', 'oscOut', 'openrgb', 'lighting'];
function outputModes(c) {
  const src = (c && c.outputs && typeof c.outputs === 'object') ? c.outputs : {};
  const out = {};
  for (const k of GATED) out[k] = src[k] === 'always' ? 'always' : 'authority';
  return out;
}
function gates(holder, c) {
  const m = outputModes(c);
  const out = {};
  for (const k of GATED) out[k] = m[k] === 'always' || holder === 'self';
  return out;
}

/* Dönem (term): her devralmada artan tamsayı; diskte, yeniden açılışta da
   küçülmez. Parola değişirse sıfırlanır: eski bir kopyadan dönen term.json
   yeni bir eşleşmede seçimleri hep kaybettirmesin. */
function secretTag(secret) { return crypto.createHash('sha256').update(String(secret || '')).digest('hex').slice(0, 16); }
function createTermStore(file, opts) {
  const fs = (opts && opts.fs) || require('fs');
  const path = require('path');
  let term = 0;
  let tag = '';
  function load(secret) {
    tag = secretTag(secret);
    term = 0;
    try {
      let t = fs.readFileSync(file, 'utf8');
      if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
      const j = JSON.parse(t);
      if (j && j.tag === tag && Number.isInteger(j.term) && j.term >= 0) term = j.term;
    } catch { /* yok ya da bozuk: 0 */ }
    return term;
  }
  function save() {
    const tmp = file + '.' + process.pid + '.tmp';
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify({ term, tag, at: Date.now() }) + '\n');
      fs.renameSync(tmp, file);
    } catch { try { fs.unlinkSync(tmp); } catch { /* */ } }
  }
  return {
    load,
    get term() { return term; },
    // Görülen dönem: daha büyükse benimsenir (küçülmez)
    see(t) { const n = Number(t); if (Number.isInteger(n) && n > term) { term = n; save(); return true; } return false; },
    // Devralma: görülenlerin en büyüğünden bir fazlası
    bump(seen) { const n = Math.max(term, Number(seen) || 0) + 1; term = n; save(); return n; },
  };
}

/* İKİ YÖNETİCİ (split brain). Yetkideki yedek, birincilden "yetki bende"
   diyen ve dönemi en az kendisininki kadar olan bir atış alırsa iki makine
   de karar veriyordur: ağ bölünmüş ve geri gelmiş, ya da birincil yedeği
   hiç görmeden yeniden açılmış. Yedek bir daha kendiliğinden devralmaz,
   iki makinede de alarm çalar; operatör birinde bırakır ya da geri verir. */
function splitBrain(o) {
  const s = o || {};
  if (s.role !== 'backup' || s.state !== 'active') return false;
  return s.beatHolder === 'self' && (Number(s.beatTerm) || 0) >= (Number(s.term) || 0);
}

/* KORUMALI GERİ VERME (handback). Her koşul ayrı adla döner: panel listeler,
   hangisi tutmuyorsa onu söyler. */
const HANDBACK_MIN_ALIVE_MS = 5000;
const HANDBACK_MIN_SAMPLES = 20;
function handbackCheck(o) {
  const s = o || {};
  const failed = [];
  if (s.role !== 'backup' || s.state !== 'active') failed.push('not-active');
  if (!(Number(s.aliveMs) >= HANDBACK_MIN_ALIVE_MS)) failed.push('primary-alive');
  if (s.differences == null) failed.push('show-unknown');
  else if (Number(s.differences) !== 0) failed.push('show-differs');
  if (!(Number(s.offsetSamples) >= HANDBACK_MIN_SAMPLES)) failed.push('clock');
  if (!s.primaryVersion || s.primaryVersion !== s.version) failed.push('version');
  return failed;
}
// Geçiş anı: hemen, sonraki sahne değişimi ya da karartma
const HANDBACK_AT = ['now', 'scene', 'black'];
function handbackDue(at, prev, now) {
  if (at === 'now') return true;
  if (at === 'scene') return !!(prev && now && prev.scene !== now.scene);
  if (at === 'black') return !!(now && now.black);
  return false;
}

/* İKİ YÖNLÜ KOMUT (ctl). Yalnız bu eylemler; gösteri komutlarını yalnız
   yetkideki makine uygular, öteki ileterek "gönderildi" der. Yedeklilik
   komutları her zaman yedeğe gider (yetki yedekte değişir). */
const CTL_SHOW = ['nextVisualizer', 'prevVisualizer', 'nextBackground', 'nextScene', 'sceneGo', 'blackout',
  'tlPlay', 'tlPause', 'tlStop', 'tlNextMarker', 'tlPrevMarker', 'deckStopAll', 'mdNext', 'mdPrev', 'mdRandom', 'mdCut'];
const CTL_RED = ['redTakeover', 'redRelease', 'redRearm', 'redHandback', 'redPkgRequest'];
function ctlKind(action) {
  if (CTL_SHOW.indexOf(action) >= 0) return 'show';
  if (CTL_RED.indexOf(action) >= 0) return 'red';
  return '';
}
/* Aynı komut iki kez uygulanmasın (yeniden bağlanmada yinelenen ileti):
   son 256 kimlik akılda. */
function createCtlDedupe(size) {
  const n = size || 256;
  const seen = new Set();
  const order = [];
  return function fresh(id) {
    const k = String(id || '');
    if (!k || seen.has(k)) return false;
    seen.add(k);
    order.push(k);
    if (order.length > n) seen.delete(order.shift());
    return true;
  };
}

/* EŞLEŞME: HMAC sınaması (#814). Parola URL'de açık gidiyordu
   (?token=...). Artık birincil bir sınama (nonce) yollar, yedek
   HMAC(parola, 'sv-peer|c|' + nonce) ile yanıtlar ve kendi sınamasını
   ekler; birincil de HMAC(parola, 'sv-peer|s|' + yedeğin nonce'u) ile
   kendini kanıtlar. Parola ağa hiç çıkmaz, sahte bir birincile de
   bağlanılmaz. Eski sürümle eşleşme için `token=` bir sürüm daha kabul
   edilir; gösteri öncesi denetim uyarır. */
function peerMac(secret, side, nonce) {
  return crypto.createHmac('sha256', String(secret || '')).update('sv-peer|' + side + '|' + String(nonce || '')).digest('hex');
}
function peerUrlHmac(c) {
  const s = normalize(c);
  const host = /:/.test(s.host) && !/^\[/.test(s.host) ? '[' + s.host + ']' : s.host;
  return 'ws://' + host + ':' + s.port + '/ws?kind=peer&auth=hmac';
}

module.exports = {
  DEFAULTS, MIN_SECRET, normalize, linkSig, showSource, localFollow, mdParity, problem, createFollower,
  snapshotMsg, patchMsg, beatMsg, applyIncoming, peerUrl, peerUrlHmac, createClient,
  authority, GATED, outputModes, gates, secretTag, createTermStore, splitBrain,
  HANDBACK_MIN_ALIVE_MS, HANDBACK_MIN_SAMPLES, HANDBACK_AT, handbackCheck, handbackDue,
  CTL_SHOW, CTL_RED, ctlKind, createCtlDedupe, peerMac,
};
