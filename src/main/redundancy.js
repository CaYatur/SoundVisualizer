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

const ShowKeys = require('../shared/show-keys');

const DEFAULTS = {
  role: 'off', host: '', port: 8722, secret: '',
  heartbeatMs: 250, timeoutMs: 1500, takeover: 'auto',
  // Devralmada çizilecek gösteri (#812): birincilin yalıtılmış kopyası ya da yerel gösteri
  takeoverData: 'primary',
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
  return s;
}

/* Bağlantıyı yeniden kurmayı gerektiren ayarların imzası. Devralma verisi
   (#812) yalnız devralma anında okunur: değiştirmek bağlantıyı koparmasın. */
function linkSig(c) {
  const s = normalize(c);
  delete s.takeoverData;
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
  };
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
      return Object.assign({}, st, { takeover: s.takeover, timeoutMs: s.timeoutMs, lossLimitMs: lossLimit() });
    },
    connected() { st.connected = true; },
    disconnected() { st.connected = false; },
    // Atış geldi: etkin değilse izlemeye döner
    beat(msg, t) {
      if (st.lastBeat && st.state === 'following') st.maxGap = Math.max(st.maxGap, t - st.lastBeat);
      if (msg && Number.isFinite(msg.gap)) st.maxPrimaryGap = Math.max(st.maxPrimaryGap, msg.gap);
      if (msg) noteOffset(msg.at, t);
      st.lastBeat = t;
      if (msg && Number.isFinite(msg.seq)) st.lastSeq = msg.seq;
      if (msg && typeof msg.scene === 'string') st.scene = msg.scene;
      if (st.state === 'active') return false;
      return set('following', t);
    },
    /* Zaman ilerledi: eşik aşıldıysa kayıp; kendiliğindense devral.
       Birincile hiç ulaşamayan yedek (birincil kapalıyken açılan) sonsuza
       dek beklemesin: açılış payı (en az 5 sn, eşiğin iki katı) sonunda o
       da kayıp sayılır. */
    tick(t) {
      if (st.state === 'active' || st.state === 'lost') {
        if (st.state === 'lost' && s.takeover === 'auto') { st.takenAt = t; st.takenBy = 'auto'; return set('active', t); }
        return false;
      }
      if (st.state === 'connecting') {
        if (t - st.since <= Math.max(5000, s.timeoutMs * 2)) return false;
      } else if (t - st.lastBeat <= lossLimit()) {
        return false;
      }
      if (s.takeover === 'auto') { st.takenAt = t; st.takenBy = 'auto'; return set('active', t); }
      return set('lost', t);
    },
    takeover(t) { st.takenAt = t; st.takenBy = 'manual'; return set('active', t); },
    release(t) {
      if (st.state !== 'active') return false;
      st.takenAt = 0;
      st.takenBy = '';
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
   yedek yetkiyi almadan geri bağlanır. */
function createClient(opts) {
  const o = opts || {};
  const WS = o.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : null);
  let ws = null;
  let closed = false;
  let delay = 100;
  let timer = null;
  function schedule() {
    if (closed || timer) return;
    timer = setTimeout(() => { timer = null; open(); }, delay);
    delay = Math.min(5000, delay * 2);
  }
  function open() {
    if (closed || !WS) return;
    let sock;
    try { sock = new WS(o.url); } catch (e) { schedule(); return; }
    ws = sock;
    sock.onopen = () => { delay = 100; if (o.onOpen) o.onOpen(); };
    sock.onmessage = (ev) => {
      let msg = null;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
      if (msg && typeof msg.type === 'string' && o.onMessage) o.onMessage(msg);
    };
    sock.onclose = () => { if (ws === sock) ws = null; if (o.onClose) o.onClose(); schedule(); };
    sock.onerror = () => { /* onclose ardından gelir */ };
  }
  open();
  return {
    send(obj) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch { /* kopuk */ } },
    close() {
      closed = true;
      if (timer) { clearTimeout(timer); timer = null; }
      try { if (ws) ws.close(); } catch { /* */ }
      ws = null;
    },
  };
}

module.exports = {
  DEFAULTS, MIN_SECRET, normalize, linkSig, showSource, localFollow, mdParity, problem, createFollower,
  snapshotMsg, patchMsg, beatMsg, applyIncoming, peerUrl, createClient,
};
