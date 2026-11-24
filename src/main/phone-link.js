/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TELEFON BAĞLANTISI ÇEKİRDEĞİ (#1054, docs/PHONE-LINK.md). Saf: ağ, pencere ve dosya yok;
   saat, rastgelelik ve depo dışarıdan verilir. Yayın sunucusu (`/link`, kind=phone) her
   bağlantı için bir oturum açar, gelen iletiyi buraya verir, dönen iletileri yollar.

   Yerel ağ şifresiz HTTP; güvenlik uygulama katmanında:
   - Eşleşme ECDH P-256 ve HER İKİ YOLDA bilgisayarda onay: yeni cihaz ancak kullanıcı panelde
     onaylayınca kaydolur (ekranı yayınlanan ya da fotoğraflanan QR tek başına yetmez). QR yolunda
     telefon QR'daki tek kullanımlık sırla kendini, bilgisayar açık anahtarının parmak iziyle
     kendini kanıtlar. Kod yolunda Bluetooth'un sayı
     karşılaştırması: bilgisayar rastgele değerini önce taahhüt eder, telefon kendi değerini
     açıklar, sonra bilgisayar açıklar; iki ekranda aynı altı rakam çıkar ve kullanıcı
     bilgisayarda onaylar. Araya giren biri bir oturumda yalnız bir kez dener (milyonda bir).
   - Eşleşmeden cihaz anahtarı türer (HKDF). Her bağlantıda iki taraf yeni rastgele değer
     yollar, oturum anahtarları her yön için ayrı türetilir. İletiler AES-256-GCM, her yönün
     kendi sayacı nonce olur; sayaç geri giderse ileti atılır (yeniden oynatma).
   - Cihaz anahtarı yalnız iki uçta durur. Depoya yazmadan önce ana süreç onu işletim
     sisteminin korumasıyla (safeStorage) şifreler; burada düz Buffer'dır. */
const crypto = require('crypto');

const PROTOCOL = 1;
const CURVE = 'prime256v1';
const CODE_TTL_MS = 120000;
// Kod denemesi: adres başına beş yanlış o adresi bu pencere için kapatır; pencere ancak çok
// sayıda yanlıştan sonra yenilenir (ağdaki biri kullanıcının kodunu durmadan değiştiremesin)
const MAX_CODE_FAILS = 5;
const MAX_TOTAL_FAILS = 30;
const HANDSHAKE_MS = 15000;
const SAS_WAIT_MS = 90000;
const LEVELS = ['view', 'control', 'edit', 'full'];
const DEFAULT_LEVEL = 'full';
const MAX_NAME = 64;
const MAX_PLAIN = 8 * 1024 * 1024;

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function unb64u(s, maxLen) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s) || s.length > (maxLen || 4096)) return null;
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
const sha256 = (...parts) => { const h = crypto.createHash('sha256'); for (const p of parts) h.update(p); return h.digest(); };
const hmac = (key, ...parts) => { const h = crypto.createHmac('sha256', key); for (const p of parts) h.update(p); return h.digest(); };
const hkdf = (ikm, salt, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from(info), len || 32));
function eq(a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b) || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
const cleanName = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME);

/** Sıkıştırılmamış P-256 açık anahtarı mı (65 bayt, 0x04)? Eğri üstünde mi? */
function validPublicKey(buf) {
  if (!Buffer.isBuffer(buf) || buf.length !== 65 || buf[0] !== 0x04) return false;
  // convertKey noktayı çözer: eğri dışındaysa hata atar
  try { crypto.ECDH.convertKey(buf, CURVE, undefined, undefined, 'uncompressed'); return true; } catch { return false; }
}

function newIdentity(randomBytes) {
  const ecdh = crypto.createECDH(CURVE);
  if (randomBytes) ecdh.setPrivateKey(scalar(randomBytes));
  else ecdh.generateKeys();
  return { priv: ecdh.getPrivateKey(), pub: ecdh.getPublicKey() };
}
// Sınamada belirlenimli anahtar: 32 bayt, eğri mertebesinden küçük olsun diye ilk bit sıfır
function scalar(randomBytes) { const k = Buffer.from(randomBytes(32)); k[0] &= 0x7f; if (k.every((x) => x === 0)) k[31] = 1; return k; }

function sharedSecret(identity, otherPub) {
  const ecdh = crypto.createECDH(CURVE);
  ecdh.setPrivateKey(identity.priv);
  return ecdh.computeSecret(otherPub);
}

/** Bilgisayar açık anahtarının parmak izi: QR bunu taşır (16 bayt). */
function fingerprint(pub) { return sha256(Buffer.from('sv-link-fp'), pub).subarray(0, 16); }

/** İki ekranda gösterilen altı rakam. */
function sasDigits(devPub, pcPub, np, nc) {
  const h = sha256(Buffer.from('sv-link-sas'), devPub, pcPub, np, nc);
  return String(h.readUInt32BE(0) % 1000000).padStart(6, '0');
}

function deviceKey(shared, devPub, pcPub, np, nc) {
  return hkdf(shared, Buffer.concat([np, nc]), 'sv-link-device|' + b64u(sha256(devPub, pcPub)), 32);
}

/* Oturum anahtarları: her yönün ayrı anahtarı ve 4 baytlık yön öneki. */
function sessionKeys(devKey, np, nc) {
  const salt = Buffer.concat([np, nc]);
  return {
    c2p: hkdf(devKey, salt, 'sv-link-session|phone-to-pc', 32),
    p2c: hkdf(devKey, salt, 'sv-link-session|pc-to-phone', 32),
  };
}

/* Şifreli zarf: [8 bayt sayaç, büyük uçlu][şifreli metin][16 bayt etiket].
   Nonce = 4 bayt yön + 8 bayt sayaç. Ek veri: yön ve sayaç. */
const DIR = { c2p: Buffer.from('c2p\0'), p2c: Buffer.from('p2c\0') };
function sealer(key, dir) {
  let ctr = 0n;
  return (plain) => {
    ctr += 1n;
    const c = Buffer.alloc(8); c.writeBigUInt64BE(ctr);
    const iv = Buffer.concat([DIR[dir], c]);
    const ci = crypto.createCipheriv('aes-256-gcm', key, iv);
    ci.setAAD(iv);
    const body = Buffer.concat([ci.update(plain), ci.final()]);
    return Buffer.concat([c, body, ci.getAuthTag()]);
  };
}
function opener(key, dir) {
  let last = 0n;
  return (frame) => {
    if (!Buffer.isBuffer(frame) || frame.length < 8 + 16 || frame.length > MAX_PLAIN + 24) return null;
    const ctr = frame.readBigUInt64BE(0);
    if (ctr <= last) return null;
    const iv = Buffer.concat([DIR[dir], frame.subarray(0, 8)]);
    try {
      const de = crypto.createDecipheriv('aes-256-gcm', key, iv);
      de.setAAD(iv);
      de.setAuthTag(frame.subarray(frame.length - 16));
      const out = Buffer.concat([de.update(frame.subarray(8, frame.length - 16)), de.final()]);
      last = ctr;
      return out;
    } catch { return null; }
  };
}

/* ---------------------------------------------------------------------------------------------
   Bilgisayar tarafı: kimlik, eşleşme penceresi, cihazlar ve bağlantı oturumları.

   opts: { identity?, devices?, pcId?, pcName?, now(), randomBytes(n), onChange(devices),
           onEvent(ev) }
   Olaylar (onEvent): { type:'sas', conn, digits, name, model } — panel onay ister;
   { type:'paired', device }, { type:'session', conn, device }, { type:'closed', conn },
   { type:'code-burned' } — kod çok yanlış denendi, yenisi üretildi.
   ------------------------------------------------------------------------------------------- */
function createHost(opts) {
  const o = opts || {};
  const now = o.now || Date.now;
  const rnd = o.randomBytes || ((n) => crypto.randomBytes(n));
  const emit = (ev) => { if (typeof o.onEvent === 'function') o.onEvent(ev); };
  const identity = o.identity && Buffer.isBuffer(o.identity.priv) ? o.identity : newIdentity(o.randomBytes ? rnd : null);
  const pcId = o.pcId || b64u(fingerprint(identity.pub)).slice(0, 12);
  let pcName = cleanName(o.pcName) || 'PC';
  // Cihaz: { id, name, model, key (Buffer), level, pairedAt, lastSeen }
  const devices = new Map();
  for (const d of Array.isArray(o.devices) ? o.devices : []) {
    if (d && typeof d.id === 'string' && Buffer.isBuffer(d.key) && d.key.length === 32) {
      devices.set(d.id, { id: d.id, name: cleanName(d.name) || 'Telefon', model: cleanName(d.model), key: d.key,
        level: LEVELS.indexOf(d.level) >= 0 ? d.level : DEFAULT_LEVEL, pairedAt: +d.pairedAt || 0, lastSeen: +d.lastSeen || 0 });
    }
  }
  const changed = () => { if (typeof o.onChange === 'function') o.onChange(listDevices(true)); };
  let pairing = null; // { code, secret, expiresAt, fails, byAddr }
  const conns = new Set();

  function listDevices(withKeys) {
    return Array.from(devices.values()).map((d) => {
      const out = { id: d.id, name: d.name, model: d.model, level: d.level, pairedAt: d.pairedAt, lastSeen: d.lastSeen,
        online: Array.from(conns).some((c) => c.device && c.device.id === d.id) };
      if (withKeys) out.key = d.key;
      return out;
    });
  }

  function newCode() {
    // Altı rakam, eşit dağılımlı
    let n;
    do { n = rnd(4).readUInt32BE(0); } while (n >= 4294000000);
    return String(n % 1000000).padStart(6, '0');
  }

  /** Eşleşme penceresini açar (ya da yeniler): kod ve QR sırrı. */
  function openPairing() {
    pairing = { code: newCode(), secret: Buffer.from(rnd(32)), expiresAt: now() + CODE_TTL_MS, fails: 0, byAddr: new Map() };
    return pairingInfo();
  }
  function closePairing() { pairing = null; }
  function pairingLive() {
    if (pairing && now() > pairing.expiresAt) pairing = null;
    return pairing;
  }
  function pairingInfo() {
    const p = pairingLive();
    return p ? { code: p.code, expiresAt: p.expiresAt } : null;
  }
  /** QR içeriği: svlink://1?... Adresler birden çok olabilir (birden çok ağ kartı). */
  function qrPayload(hosts, port) {
    const p = pairingLive();
    if (!p) return '';
    const q = [];
    for (const h of (hosts || []).slice(0, 4)) q.push('h=' + encodeURIComponent(h));
    q.push('p=' + (port | 0), 'id=' + pcId, 'f=' + b64u(fingerprint(identity.pub)), 's=' + b64u(p.secret), 'n=' + encodeURIComponent(pcName));
    return 'svlink://' + PROTOCOL + '?' + q.join('&');
  }
  const addrOf = (c) => String((c && c.meta && c.meta.address) || '?');
  function addrBlocked(c) {
    const p = pairingLive();
    return !!p && (p.byAddr.get(addrOf(c)) || 0) >= MAX_CODE_FAILS;
  }
  function burnFail(c) {
    const p = pairingLive();
    if (!p) return;
    p.fails += 1;
    p.byAddr.set(addrOf(c), (p.byAddr.get(addrOf(c)) || 0) + 1);
    if (p.fails >= MAX_TOTAL_FAILS) { openPairing(); emit({ type: 'code-burned' }); }
  }

  function hello() {
    return { t: 'hello', v: PROTOCOL, pc: { id: pcId, name: pcName, pub: b64u(identity.pub) }, pairing: !!pairingLive() };
  }

  /* Bir bağlantının durum makinesi. handle(text) → yollanacak metin iletileri;
     oturum kurulunca seal/open şifreli kareler içindir. */
  function connection(meta) {
    const c = {
      meta: meta || {}, stage: 'new', device: null, closed: false,
      startedAt: now(), seal: null, open: null, sas: null, pend: null,
    };
    conns.add(c);
    const fail = (code) => { c.stage = 'failed'; return [{ t: 'error', code }]; };

    c.handle = (text) => {
      if (c.closed || c.stage === 'failed') return [];
      if (c.stage !== 'session' && now() - c.startedAt > (c.stage === 'sas' ? HANDSHAKE_MS + SAS_WAIT_MS : HANDSHAKE_MS)) return fail('timeout');
      let m;
      try { m = JSON.parse(text); } catch { return fail('bad-message'); }
      if (!m || typeof m !== 'object' || typeof m.t !== 'string') return fail('bad-message');
      if (c.stage === 'session') return fail('expected-encrypted');
      if (m.v !== PROTOCOL && (m.t === 'pair' || m.t === 'resume')) return fail('protocol');

      // ---- Yeniden bağlanma: kayıtlı cihaz
      if (m.t === 'resume' && c.stage === 'new') {
        const d = devices.get(String(m.device || ''));
        const np = unb64u(m.np, 64);
        const proof = unb64u(m.proof, 64);
        if (!d || !np || np.length !== 16 || !proof) return fail('unknown-device');
        if (!eq(proof, hmac(d.key, 'sv-link-resume|phone|', np))) return fail('unknown-device');
        const nc = Buffer.from(rnd(16));
        startSession(d, np, nc);
        return [{ t: 'welcome', nc: b64u(nc), proof: b64u(hmac(d.key, 'sv-link-resume|pc|', np, nc)), level: d.level, pc: { id: pcId, name: pcName } }];
      }

      // ---- QR ile eşleşme: telefon QR sırrını bildiğini kanıtlar
      if (m.t === 'pair' && m.kind === 'qr' && c.stage === 'new') {
        const p = pairingLive();
        if (!p) return fail('pairing-closed');
        const devPub = unb64u(m.pub, 128);
        const np = unb64u(m.np, 64);
        const mac = unb64u(m.mac, 64);
        if (!validPublicKey(devPub) || !np || np.length !== 16 || !mac) return fail('bad-message');
        if (!eq(mac, hmac(p.secret, 'sv-link-qr|phone|', devPub, np))) return fail('bad-secret');
        const nc = Buffer.from(rnd(16));
        c.pend = { devPub, np, nc, name: m.name, model: m.model };
        c.stage = 'sas';
        const digits = sasDigits(devPub, identity.pub, np, nc);
        c.sas = digits;
        emit({ type: 'sas', conn: c, digits, name: cleanName(m.name) || 'Telefon', model: cleanName(m.model), via: 'qr' });
        // Telefon bilgisayarı şimdi doğrular; oturum ancak bilgisayardaki onaydan sonra
        return [{ t: 'pending', nc: b64u(nc), mac: b64u(hmac(p.secret, 'sv-link-qr|pc|', identity.pub, nc, devPub)),
          pc: { id: pcId, name: pcName, pub: b64u(identity.pub) } }];
      }

      // ---- Kod ile eşleşme, adım 1: telefon anahtarı + kodun kanıtı → bilgisayar taahhüdü
      if (m.t === 'pair' && m.kind === 'code' && c.stage === 'new') {
        const p = pairingLive();
        if (!p) return fail('pairing-closed');
        if (addrBlocked(c)) return fail('too-many');
        const devPub = unb64u(m.pub, 128);
        const proof = unb64u(m.proof, 64);
        if (!validPublicKey(devPub) || !proof) return fail('bad-message');
        if (!eq(proof, hmac(Buffer.from(p.code), 'sv-link-code|', devPub))) { burnFail(c); return fail('bad-code'); }
        const nc = Buffer.from(rnd(16));
        c.pend = { devPub, nc, name: m.name, model: m.model };
        c.stage = 'committed';
        return [{ t: 'commit', pub: b64u(identity.pub), commit: b64u(hmac(nc, 'sv-link-commit|', identity.pub, devPub)) }];
      }
      // Adım 2: telefon kendi rastgele değerini açıklar → bilgisayar açıklar, iki taraf sayıyı gösterir
      if (m.t === 'reveal' && c.stage === 'committed') {
        const np = unb64u(m.np, 64);
        if (!np || np.length !== 16) return fail('bad-message');
        c.pend.np = np;
        c.stage = 'sas';
        const digits = sasDigits(c.pend.devPub, identity.pub, np, c.pend.nc);
        c.sas = digits;
        emit({ type: 'sas', conn: c, digits, name: cleanName(c.pend.name) || 'Telefon', model: cleanName(c.pend.model) });
        return [{ t: 'reveal', nc: b64u(c.pend.nc) }];
      }
      return fail('bad-message');
    };

    function startSession(d, np, nc) {
      const k = sessionKeys(d.key, np, nc);
      c.seal = sealer(k.p2c, 'p2c');
      c.open = opener(k.c2p, 'c2p');
      c.device = d;
      c.stage = 'session';
      d.lastSeen = now();
      changed();
      emit({ type: 'session', conn: c, device: publicDevice(d) });
    }
    function enroll(devPub, np, nc, m) {
      const key = deviceKey(sharedSecret(identity, devPub), devPub, identity.pub, np, nc);
      const id = b64u(sha256(Buffer.from('sv-link-id'), devPub)).slice(0, 16);
      const d = { id, name: cleanName(m.name) || 'Telefon', model: cleanName(m.model), key, level: DEFAULT_LEVEL, pairedAt: now(), lastSeen: now() };
      devices.set(id, d);
      emit({ type: 'paired', device: publicDevice(d) });
      startSession(d, np, nc);
      return d;
    }

    /** Kullanıcı bilgisayarda sayıyı onayladı ya da reddetti. */
    c.confirm = (ok) => {
      if (c.stage !== 'sas' || c.closed) return [];
      if (!ok || now() - c.startedAt > HANDSHAKE_MS + SAS_WAIT_MS) { burnFail(c); return fail('rejected'); }
      const pd = c.pend;
      c.pend = null;
      const d = enroll(pd.devPub, pd.np, pd.nc, pd);
      pairing = null;
      return [{ t: 'paired', device: d.id, level: d.level, pc: { id: pcId, name: pcName } }];
    };
    c.encrypt = (obj) => (c.stage === 'session' ? c.seal(Buffer.from(JSON.stringify(obj))) : null);
    c.encryptBinary = (buf) => (c.stage === 'session' ? c.seal(buf) : null);
    /** Şifreli kare → nesne (JSON) ya da null. */
    c.decrypt = (frame) => {
      if (c.stage !== 'session') return null;
      const plain = c.open(frame);
      if (!plain) return null;
      try { return JSON.parse(plain.toString('utf8')); } catch { return null; }
    };
    c.close = () => {
      if (c.closed) return;
      c.closed = true;
      conns.delete(c);
      if (c.device) { c.device.lastSeen = now(); changed(); }
      emit({ type: 'closed', conn: c });
    };
    return c;
  }

  function publicDevice(d) {
    return { id: d.id, name: d.name, model: d.model, level: d.level, pairedAt: d.pairedAt, lastSeen: d.lastSeen };
  }
  /** Cihazı siler; açık bağlantısı kapanmalı (dönen bağlantılar). */
  function forget(id) {
    const d = devices.get(id);
    if (!d) return [];
    devices.delete(id);
    changed();
    return Array.from(conns).filter((c) => c.device && c.device.id === id);
  }
  function forgetAll() { const out = Array.from(conns).filter((c) => c.device); devices.clear(); changed(); return out; }
  function setLevel(id, level) {
    const d = devices.get(id);
    if (!d || LEVELS.indexOf(level) < 0) return false;
    d.level = level;
    changed();
    return true;
  }
  function rename(name) { pcName = cleanName(name) || pcName; }

  /** El sıkışma süresi doldu mu (bağlantı boşta beklese de)? Hizmet düzenli sorar. */
  function expired(c) {
    if (c.stage === 'session' || c.closed) return false;
    return now() - c.startedAt > (c.stage === 'sas' ? HANDSHAKE_MS + SAS_WAIT_MS : HANDSHAKE_MS);
  }

  return {
    identity, pcId, hello, expired, openPairing, closePairing, pairingInfo, qrPayload, connection,
    devices: () => listDevices(false), forget, forgetAll, setLevel, rename,
    connections: () => Array.from(conns),
  };
}

/* ---------------------------------------------------------------------------------------------
   İzin tablosu (docs/PHONE-LINK.md §İzinler). İşlem adları bağlantı protokolündeki `op`'lar;
   bilinmeyen işlem reddedilir. 'never' hiçbir düzeyde yok: PC'de keyfi dosya yolu, jetonlar ve
   bağlantının kendi güvenlik ayarları.
   ------------------------------------------------------------------------------------------- */
const OPS = {
  // izle
  'state.get': 'view', 'preview.get': 'view', 'library.list': 'view', 'thumb.get': 'view',
  // kumanda
  'scene.apply': 'control', 'blackout': 'control', 'tbar': 'control', 'momentary': 'control', 'deck.trigger': 'control',
  'deck.stop': 'control', 'macro.set': 'control', 'tempo.tap': 'control', 'tempo.set': 'control', 'autovj.toggle': 'control',
  'milkdrop.nav': 'control', 'timeline.transport': 'control', 'run': 'control',
  // düzenleme
  'config.patch': 'edit', 'scene.save': 'edit', 'scene.create': 'edit', 'scene.rename': 'edit', 'scene.delete': 'edit',
  'scene.reorder': 'edit', 'preset.save': 'edit', 'preset.delete': 'edit', 'palette.save': 'edit', 'palette.delete': 'edit',
  // tam
  'output.open': 'full', 'output.close': 'full', 'output.set': 'full', 'audio.sources': 'full', 'export.start': 'full',
  'export.cancel': 'full', 'record.start': 'full', 'record.stop': 'full', 'lighting.set': 'full', 'power.set': 'full',
  'file.upload': 'full', 'web.url': 'full', 'updates': 'full', 'audio.repair': 'full', 'control.bindings': 'full',
  'redundancy': 'full', 'audio.bridge': 'full',
};
// Tam düzeyde de bilgisayarda bir kez onay penceresi isteyenler
const CONFIRM_OPS = new Set(['updates', 'audio.repair', 'control.bindings', 'redundancy', 'web.url']);

function allowed(level, op) {
  const need = Object.prototype.hasOwnProperty.call(OPS, op) ? OPS[op] : null;
  if (!need) return false;
  return LEVELS.indexOf(level) >= LEVELS.indexOf(need);
}

module.exports = {
  PROTOCOL, LEVELS, DEFAULT_LEVEL, CODE_TTL_MS, MAX_CODE_FAILS, MAX_TOTAL_FAILS, HANDSHAKE_MS, SAS_WAIT_MS, OPS, CONFIRM_OPS,
  createHost, allowed, needsConfirm: (op) => CONFIRM_OPS.has(op),
  // Telefon tarafının (ve sınamanın) kullandığı yapı taşları
  newIdentity, sharedSecret, fingerprint, sasDigits, deviceKey, sessionKeys, sealer, opener, hmac, sha256, b64u, unb64u, validPublicKey,
};
