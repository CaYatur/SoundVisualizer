/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* WEB KATMANININ GÜVENLİĞİ.

   Web katmanı kullanıcının yazdığı HERHANGİ bir sayfayı uygulamanın içinde
   açar. O sayfa güvenilmez kabul edilir; şunları yapamamalı:

   - Uygulamaya dokunmak. Sayfanın önyükleme betiği yok, Node yok, kum
     havuzunda, kendi oturumunda (`persist:sv-web`). Uygulamanın kendi
     protokolleri (sv-media, sv-logo, sv-thumb) yalnız varsayılan oturuma
     kayıtlı; bu oturumdan çağrılamaz.
   - Bu makinenin ve yerel ağın servislerine ulaşmak. Uygulamanın kendi
     sunucuları (yayın sayfası ve uzaktan kumanda, MCP, OSCQuery, ses
     köprüsü, yedeklilik) ve yerel adresler (127.0.0.1, 192.168.x.x,
     yönlendirici, NAS) engellenir. Kullanıcı yerel bir adresi KENDİSİ
     yazdıysa yalnız o köken açılır. Genel bir adın yerel bir adrese
     çözülmesi (DNS rebinding) de çözümlenen adresle denetlenir.
   - İzin almak. Kamera, mikrofon, konum, bildirim, pano, MIDI, USB/HID/seri
     aygıt, ekran paylaşımı, tam ekran: hepsi reddedilir, soru sorulmaz.
   - İz bırakmak. İndirme iptal edilir, yeni pencere açılmaz (dış tarayıcıda
     da), alert/confirm kutusu çıkmaz, sayfadan çıkışı engelleyen
     `beforeunload` sayılmaz, sertifika hatası geçilmez.
   - Gezinip başka bir şeye dönüşmek. Ana çerçeve ve iç çerçeveler yalnız
     http/https'e gidebilir; yerel adres kuralı orada da geçerli. */

const SL = require('../shared/source-layers.js');

const PARTITION = 'persist:sv-web';

/* İzin verilen ağ şemaları. data: ve blob: sayfanın kendi içi; webRequest
   bunları zaten görmez ama açıkça listede. */
const NET_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'data:', 'blob:']);

/* Kullanıcı aracısı: Electron ve uygulama adı çıkarılır. Bazı siteler
   tanımadıkları tarayıcıya boş sayfa ya da "desteklenmiyor" gösteriyor. */
function cleanUserAgent(ua) {
  return String(ua || '')
    .split(' ')
    .filter((t) => !/^Electron\//i.test(t) && !/^(SoundVisualizer|CaYaDev|cayadev-[a-z-]+|sound-?visualizer)\//i.test(t))
    .join(' ');
}

/* Oturum nesnesi verilirse bölüm adı düşer: ikisi birlikte verilemez. */
function webPreferences(extra) {
  const out = Object.assign({
    partition: PARTITION,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    webviewTag: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    plugins: false,
    navigateOnDragDrop: false,
    spellcheck: false,
    disableDialogs: true,
    safeDialogs: true,
    enableWebSQL: false,
    devTools: false,
    backgroundThrottling: false,
    autoplayPolicy: 'no-user-gesture-required',
  }, extra || {});
  if (out.session) delete out.partition;
  return out;
}

/* Bir isteğin ya da gezinmenin kararı. `ctx`:
     allowedLocal: kullanıcının yazdığı yerel kökenler (Set)
     appPorts:     uygulamanın dinlediği portlar (Set<number>)
     resolved:     ad -> çözülen adresler (rebinding denetimi; yoksa atlanır)
   Dönen: { ok: true } ya da { ok: false, reason }. */
function decide(rawUrl, ctx) {
  let u;
  try { u = new URL(String(rawUrl || '')); } catch { return { ok: false, reason: 'BAD_URL' }; }
  if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return { ok: true };
  if (!NET_SCHEMES.has(u.protocol)) return { ok: false, reason: 'SCHEME' };
  const cls = SL.hostClass(u.hostname);
  const local = cls !== 'public';
  const port = Number(u.port) || (u.protocol === 'https:' || u.protocol === 'wss:' ? 443 : 80);
  const c = ctx || {};
  if (local) {
    if (c.appPorts && c.appPorts.has(port)) return { ok: false, reason: 'APP_PORT' };
    const httpOrigin = (u.protocol === 'wss:' ? 'https:' : u.protocol === 'ws:' ? 'http:' : u.protocol) + '//' + u.host;
    if (!(c.allowedLocal && c.allowedLocal.has(httpOrigin))) return { ok: false, reason: 'LOCAL' };
    return { ok: true };
  }
  const addrs = c.resolved && c.resolved.get(u.hostname.toLowerCase());
  if (addrs && addrs.some((a) => SL.hostClass(a) !== 'public')) {
    return { ok: false, reason: 'REBIND' };
  }
  return { ok: true };
}

/* Oturumu bir kez sertleştirir. `getCtx()` her istekte güncel kuralları
   verir (katmanlar değişince izinli yerel kökenler değişir). */
function hardenSession(ses, getCtx, onBlocked) {
  if (!ses || ses.__svHardened) return ses;
  ses.__svHardened = true;

  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  if (typeof ses.setDevicePermissionHandler === 'function') ses.setDevicePermissionHandler(() => false);
  if (typeof ses.setDisplayMediaRequestHandler === 'function') {
    // Boş yanıt isteği reddeder
    ses.setDisplayMediaRequestHandler((_req, cb) => { try { cb({}); } catch { /* reddedildi */ } });
  }
  if (typeof ses.setBluetoothPairingHandler === 'function') {
    ses.setBluetoothPairingHandler((_d, cb) => cb({ confirmed: false }));
  }
  ['select-hid-device', 'select-serial-port', 'select-usb-device'].forEach((ev) => {
    ses.on(ev, (e, _details, cb) => {
      e.preventDefault();
      try { cb(ev === 'select-usb-device' ? undefined : ''); } catch { /* seçim yok */ }
    });
  });
  ses.on('will-download', (e, item) => {
    e.preventDefault();
    try { item.cancel(); } catch { /* zaten bitti */ }
    if (onBlocked) onBlocked({ reason: 'DOWNLOAD', url: safeUrl(item && item.getURL && item.getURL()) });
  });
  try { ses.setSpellCheckerEnabled(false); } catch { /* yazım denetimi yok */ }
  try { ses.setUserAgent(cleanUserAgent(ses.getUserAgent())); } catch { /* varsayılan kalır */ }

  /* Rebinding denetimi için çözümleme önbelleği. resolveHost Chromium'un
     kendi çözücüsü; aynı ad sayfanın isteğinde de aynı yanıtı verir. */
  const cache = new Map();
  const TTL = 30000;
  function lookup(host) {
    const h = host.toLowerCase();
    const hit = cache.get(h);
    if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.addrs);
    if (typeof ses.resolveHost !== 'function') return Promise.resolve(null);
    return ses.resolveHost(h).then((r) => {
      const addrs = ((r && r.endpoints) || []).map((ep) => String(ep.address || '')).filter(Boolean);
      cache.set(h, { at: Date.now(), addrs });
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      return addrs;
    }).catch(() => null);
  }

  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, cb) => {
    const ctx = getCtx();
    let first = decide(details.url, ctx);
    if (!first.ok) {
      if (onBlocked) onBlocked({ reason: first.reason, url: safeUrl(details.url), webContentsId: details.webContentsId });
      cb({ cancel: true });
      return;
    }
    let u;
    try { u = new URL(details.url); } catch { cb({ cancel: true }); return; }
    if (!/^(https?|wss?):$/.test(u.protocol) || SL.hostClass(u.hostname) !== 'public') { cb({}); return; }
    lookup(u.hostname).then((addrs) => {
      if (addrs) {
        const resolved = new Map([[u.hostname.toLowerCase(), addrs]]);
        first = decide(details.url, Object.assign({}, ctx, { resolved }));
      }
      if (!first.ok && onBlocked) onBlocked({ reason: first.reason, url: safeUrl(details.url), webContentsId: details.webContentsId });
      cb(first.ok ? {} : { cancel: true });
    });
  });
  return ses;
}

/* Bir web katmanı sayfasının (görünmez ya da etkileşim penceresi) kendi
   olayları. `allowPopups`: yalnız etkileşim penceresinde, oturum açma
   pencereleri için; çocuk pencere de aynı kurallarla açılır. */
function guardContents(wc, getCtx, opts) {
  const o = opts || {};
  const nav = (e, target) => {
    const d = decide(target, getCtx());
    if (!d.ok || !/^https?:/i.test(String(target))) {
      e.preventDefault();
      if (o.onBlocked) o.onBlocked({ reason: d.ok ? 'SCHEME' : d.reason, url: safeUrl(target) });
    }
  };
  wc.on('will-navigate', nav);
  wc.on('will-redirect', nav);
  wc.on('will-frame-navigate', (e) => {
    const target = e && e.url;
    const d = decide(target, getCtx());
    const okScheme = /^(https?|about|data|blob):/i.test(String(target || ''));
    if (!d.ok || !okScheme) {
      e.preventDefault();
      if (o.onBlocked) o.onBlocked({ reason: d.ok ? 'SCHEME' : d.reason, url: safeUrl(target) });
    }
  });
  wc.on('will-prevent-unload', (e) => e.preventDefault());
  /* WebRTC adres adayları süzgeçten (webRequest) geçmeyen UDP ile çıkıyor
     ve sayfaya makinenin yerel IP'sini verebiliyordu. Yalnız varsayılan
     genel arayüz kullanılır. */
  if (typeof wc.setWebRTCIPHandlingPolicy === 'function') {
    try { wc.setWebRTCIPHandlingPolicy('default_public_interface_only'); } catch { /* eski sürüm */ }
  }
  wc.on('select-bluetooth-device', (e, _list, cb) => { e.preventDefault(); try { cb(''); } catch { /* seçim yok */ } });
  wc.setWindowOpenHandler(({ url }) => {
    if (o.allowPopups && /^https?:/i.test(String(url)) && decide(url, getCtx()).ok) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 640, height: 760, autoHideMenuBar: true,
          webPreferences: webPreferences(),
        },
      };
    }
    if (o.onBlocked) o.onBlocked({ reason: 'POPUP', url: safeUrl(url) });
    return { action: 'deny' };
  });
  if (o.allowPopups) {
    wc.on('did-create-window', (child) => {
      try { child.setMenuBarVisibility(false); } catch { /* menü yok */ }
      guardContents(child.webContents, getCtx, o);
    });
  }
  return wc;
}

/* Günlüğe ve panele adresin yalnız kökeni gider: yol ve sorgu dizesinde
   jeton ya da kişisel bilgi olabilir. */
function safeUrl(raw) {
  try {
    const u = new URL(String(raw || ''));
    return /^(https?|wss?):$/.test(u.protocol) ? u.origin : u.protocol;
  } catch {
    return '';
  }
}

/* Uygulama düzeyindeki olaylar. İstemci sertifikası: Electron, olay
   işlenmezse sistemdeki İLK sertifikayı kendiliğinden gönderiyor; web
   katmanındaki bir sayfa böylece kullanıcının kimliğini alabilirdi. Web
   katmanına hiçbir sertifika verilmez; uygulamanın kendi sayfalarına
   dokunulmaz. */
function guardApp(app, isWebContents) {
  app.on('select-client-certificate', (e, wc, _url, _list, cb) => {
    if (!isWebContents(wc)) return;
    e.preventDefault();
    try { cb(); } catch { /* seçim yok */ }
  });
  app.on('login', (e, wc, _details, _auth, cb) => {
    // HTTP kimlik doğrulaması sorulmaz; sayfa kendi formunu kullanmalı
    if (!isWebContents(wc)) return;
    e.preventDefault();
    try { cb(); } catch { /* iptal */ }
  });
}

module.exports = { PARTITION, cleanUserAgent, webPreferences, decide, hardenSession, guardContents, guardApp, safeUrl };
