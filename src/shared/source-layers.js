/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* DIŞ KAYNAK KATMANLARI: Spout/Syphon girişi ve web sayfası.

   İki katman türü görüntüyü uygulamanın DIŞINDAN alır:
     - `input`: aynı makinedeki bir Spout (Windows) ya da Syphon (macOS)
       göndericisi. TouchDesigner, Resolume, OBS, bir kamera uygulaması.
     - `web`: bir web sayfası. Ana süreç sayfayı görünmez bir pencerede
       çizer; kareler katmana GPU dokusu olarak gelir.

   İkisinin de kaynağı ana süreçte BİR kez açılır ve her pencereye (ekranlar,
   panel önizlemesi, Spout çıkışı) aynı kare dağıtılır. Bu dosya saf
   yardımcıları tutar: ayarların sınırları, kaynak anahtarı, adres denetimi,
   yerel ağ sınıflandırması ve sığdırma hesabı. Ana süreç, panel, görselleştirici
   ve testler aynı kuralları buradan okur. */
(function () {
  const KINDS = ['input', 'web'];

  const INPUT_DEFAULTS = {
    sender: '', // göndericinin adı
    app: '', // macOS: Syphon sunucusunun uygulaması (aynı adlı iki sunucuyu ayırır)
    fit: 'contain',
    mirror: false,
    flip: false,
    hold: true, // kaynak kesilince son kare kalsın
    /* Göndericinin saydamlığı. Kapalıyken kare opak çizilir: birçok
       gönderici saydamlık kanalına anlamsız değer (çoğunlukla 0) yazıyor,
       görüntü hiç görünmüyordu. */
    alpha: false,
    // Konum ve boyut: kutunun merkezi ve karenin kaçta kaçı (düzen editörü)
    x: 0.5,
    y: 0.5,
    size: 1,
  };

  const WEB_DEFAULTS = {
    url: '',
    width: 1920,
    height: 1080,
    fps: 30,
    zoom: 1,
    transparent: true, // sayfanın kendi arkaplanı yoksa altı görünür
    css: '', // sayfaya eklenen CSS (ör. arkaplanı gizlemek)
    audio: false, // sayfanın sesi; açılırsa varsayılan çıkış aygıtından çalar
    reloadMin: 0, // dakikada bir yeniden yükle (0: hiç)
    fit: 'contain',
    mirror: false,
    x: 0.5,
    y: 0.5,
    size: 1,
  };

  const LIMITS = {
    width: [320, 3840],
    height: [240, 2160],
    fps: [1, 60],
    zoom: [0.25, 3],
    reloadMin: [0, 1440],
    css: 20000,
    url: 2048,
    sender: 256,
    size: [0.05, 1.5],
    maxWeb: 6, // aynı anda açık web sayfası
    maxInput: 8, // aynı anda bağlı gönderici
  };

  const FITS = ['contain', 'cover', 'stretch'];

  function num(v, def, lo, hi) {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.max(lo, Math.min(hi, n));
  }
  function str(v, max) {
    return typeof v === 'string' ? v.slice(0, max) : '';
  }

  const round4 = (v) => Math.round(v * 10000) / 10000;
  // Merkez kenardan biraz dışarı da çıkabilir (kısmen görünen kutu)
  function pos(v) { return round4(num(v, 0.5, -0.5, 1.5)); }
  function sizeOf(v) { return round4(num(v, 1, LIMITS.size[0], LIMITS.size[1])); }

  function normalizeInput(s) {
    const src = s && typeof s === 'object' ? s : {};
    return {
      sender: str(src.sender, LIMITS.sender).trim(),
      app: str(src.app, LIMITS.sender).trim(),
      fit: FITS.indexOf(src.fit) >= 0 ? src.fit : INPUT_DEFAULTS.fit,
      mirror: src.mirror === true,
      flip: src.flip === true,
      hold: src.hold !== false,
      alpha: src.alpha === true,
      x: pos(src.x),
      y: pos(src.y),
      size: sizeOf(src.size),
    };
  }

  function normalizeWeb(s) {
    const src = s && typeof s === 'object' ? s : {};
    return {
      url: str(src.url, LIMITS.url).trim(),
      width: Math.round(num(src.width, WEB_DEFAULTS.width, LIMITS.width[0], LIMITS.width[1])),
      height: Math.round(num(src.height, WEB_DEFAULTS.height, LIMITS.height[0], LIMITS.height[1])),
      fps: Math.round(num(src.fps, WEB_DEFAULTS.fps, LIMITS.fps[0], LIMITS.fps[1])),
      zoom: Math.round(num(src.zoom, WEB_DEFAULTS.zoom, LIMITS.zoom[0], LIMITS.zoom[1]) * 100) / 100,
      transparent: src.transparent !== false,
      css: str(src.css, LIMITS.css),
      audio: src.audio === true,
      reloadMin: Math.round(num(src.reloadMin, 0, LIMITS.reloadMin[0], LIMITS.reloadMin[1])),
      fit: FITS.indexOf(src.fit) >= 0 ? src.fit : WEB_DEFAULTS.fit,
      mirror: src.mirror === true,
      x: pos(src.x),
      y: pos(src.y),
      size: sizeOf(src.size),
    };
  }

  function settingsOf(layer) {
    if (!layer || typeof layer !== 'object') return null;
    const s = layer.settings || {};
    if (layer.kind === 'input') return normalizeInput(s.input);
    if (layer.kind === 'web') return normalizeWeb(s.web);
    return null;
  }

  /* Kaynağın anahtarı. Aynı göndericiyi gösteren iki katman TEK alıcıyı
     paylaşır; web sayfası ise katmana aittir (boyutu, CSS'i, kare hızı
     katmanın), iki katman aynı adresi açsa da iki sayfa olur. */
  function sourceKey(layer) {
    if (!layer || typeof layer !== 'object') return '';
    if (layer.kind === 'input') {
      const s = normalizeInput(layer.settings && layer.settings.input);
      if (!s.sender) return '';
      return 'in:' + encodeURIComponent(s.app) + '|' + encodeURIComponent(s.sender);
    }
    if (layer.kind === 'web') {
      return layer.id ? 'web:' + String(layer.id).slice(0, 120) : '';
    }
    return '';
  }

  /* ADRES DENETİMİ. Yalnız http ve https. Şemasız yazılan bir ad
     (`example.com/sayfa`) https sayılır. Adreste kullanıcı adı ve parola
     (`https://ad:parola@site`) reddedilir: ayar dosyasına ve yayın
     sayfasına düz metin olarak giderdi. */
  function checkUrl(raw) {
    let s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) return { ok: false, reason: 'EMPTY' };
    if (s.length > LIMITS.url) return { ok: false, reason: 'TOO_LONG' };
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
    let u;
    try { u = new URL(s); } catch { return { ok: false, reason: 'BAD_URL' }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'SCHEME' };
    if (!u.hostname) return { ok: false, reason: 'BAD_URL' };
    if (u.username || u.password) return { ok: false, reason: 'CREDENTIALS' };
    return { ok: true, url: u.href, origin: u.origin, host: u.hostname, local: hostClass(u.hostname) !== 'public' };
  }

  /* YEREL AĞ SINIFLANDIRMASI. Web katmanındaki bir sayfa bu makinenin ve
     yerel ağın servislerine (uygulamanın kendi uzaktan kumandası, MCP,
     OSCQuery, yönlendirici arayüzü) istek atmasın diye. Adres URL
     ayrıştırıcısından geçmiş olmalı: `http://2130706433/` ve
     `http://0x7f.1/` orada zaten `127.0.0.1` olur.
       'loopback'   127.0.0.0/8, ::1, localhost ve *.localhost
       'private'    10/8, 172.16/12, 192.168/16, 100.64/10 (CGNAT), fc00::/7
       'linklocal'  169.254/16, fe80::/10
       'unspecified' 0.0.0.0/8, ::
       'local-name' tek parçalı ad (`router`, `nas`) ve .local / .lan / .home.arpa
       'public'     geri kalan her şey */
  function hostClass(hostname) {
    let h = String(hostname || '').toLowerCase().trim();
    if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
    if (h.endsWith('.')) h = h.slice(0, -1);
    if (!h) return 'unspecified';
    if (h === 'localhost' || h.endsWith('.localhost')) return 'loopback';
    const v4 = parseV4(h);
    if (v4) return v4Class(v4);
    if (h.indexOf(':') >= 0) return v6Class(h);
    if (h.indexOf('.') < 0) return 'local-name';
    if (/\.(local|lan|home|internal|intranet|corp|home\.arpa)$/.test(h)) return 'local-name';
    return 'public';
  }

  function parseV4(h) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (!m) return null;
    const p = m.slice(1).map(Number);
    return p.every((x) => x >= 0 && x <= 255) ? p : null;
  }

  function v4Class(p) {
    const [a, b] = p;
    if (a === 127) return 'loopback';
    if (a === 0) return 'unspecified';
    if (a === 10) return 'private';
    if (a === 172 && b >= 16 && b <= 31) return 'private';
    if (a === 192 && b === 168) return 'private';
    if (a === 100 && b >= 64 && b <= 127) return 'private';
    if (a === 169 && b === 254) return 'linklocal';
    if (a >= 224) return 'private'; // çoklu yayın ve ayrılmış blok: web sayfasının işi yok
    return 'public';
  }

  function v6Class(h) {
    const zone = h.indexOf('%');
    if (zone >= 0) h = h.slice(0, zone);
    // IPv4 eşlemeli (::ffff:127.0.0.1 ya da ::ffff:7f00:1)
    const mapped = /^(?:0{0,4}:){0,5}:?ffff:(.+)$/.exec(h);
    if (mapped) {
      const tail = mapped[1];
      const dotted = parseV4(tail);
      if (dotted) return v4Class(dotted);
      const hx = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
      if (hx) {
        const hi = parseInt(hx[1], 16);
        const lo = parseInt(hx[2], 16);
        return v4Class([hi >> 8, hi & 255, lo >> 8, lo & 255]);
      }
    }
    const groups = expandV6(h);
    if (!groups) return 'public';
    if (groups.every((g) => g === 0)) return 'unspecified';
    if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return 'loopback';
    if ((groups[0] & 0xfe00) === 0xfc00) return 'private';
    if ((groups[0] & 0xffc0) === 0xfe80) return 'linklocal';
    if ((groups[0] & 0xff00) === 0xff00) return 'private';
    // IPv4 uyumlu eski biçim (::127.0.0.1) ve NAT64 (64:ff9b::/96)
    if (groups.slice(0, 6).every((g) => g === 0) || (groups[0] === 0x64 && groups[1] === 0xff9b)) {
      return v4Class([groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255]);
    }
    return 'public';
  }

  function expandV6(h) {
    let s = h;
    const dotted = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
    if (dotted) {
      const p = parseV4(dotted[1]);
      if (!p) return null;
      s = s.slice(0, -dotted[1].length) + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16);
    }
    const parts = s.split('::');
    if (parts.length > 2) return null;
    const head = parts[0] ? parts[0].split(':') : [];
    const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
    const fill = parts.length === 2 ? 8 - head.length - tail.length : 0;
    if (fill < 0 || (parts.length === 1 && head.length !== 8)) return null;
    const all = head.concat(new Array(fill).fill('0'), tail);
    if (all.length !== 8) return null;
    const out = all.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
    return out.some((g) => Number.isNaN(g)) ? null : out;
  }

  /* Bu karede çalışması gereken kaynaklar. Katman yığını kapalıysa hiçbiri.
     `active`: katman açık ve sessiz değil; kapalı ya da sessiz bir katmanın
     kaynağı AÇIK kalır ama kare üretmez — geri açılınca sayfa baştan
     yüklenmesin, gönderici yeniden aranmasın. */
  function wanted(cfg) {
    const out = [];
    if (!cfg || !Array.isArray(cfg.layers)) return out;
    const st = cfg.layerStack;
    const on = st && typeof st.enabled === 'boolean' ? st.enabled : cfg.layers.length > 0;
    if (!on) return out;
    const anySolo = cfg.layers.some((l) => l && l.solo === true && l.enabled !== false);
    const seen = new Set();
    let webCount = 0;
    let inputCount = 0;
    for (const l of cfg.layers) {
      if (!l || KINDS.indexOf(l.kind) < 0) continue;
      const key = sourceKey(l);
      if (!key) continue;
      const active = l.enabled !== false && l.muted !== true && (!anySolo || l.solo === true);
      if (seen.has(key)) {
        if (active) out.forEach((w) => { if (w.key === key) w.active = true; });
        continue;
      }
      if (l.kind === 'web' && ++webCount > LIMITS.maxWeb) continue;
      if (l.kind === 'input' && ++inputCount > LIMITS.maxInput) continue;
      seen.add(key);
      out.push({ key, kind: l.kind, layerId: l.id || '', spec: settingsOf(l), active });
    }
    return out;
  }

  /* Sığdırma: kaynağın W x H tuvaldeki dikdörtgeni. */
  function fitRect(fit, W, H, vw, vh) {
    if (!(vw > 0 && vh > 0 && W > 0 && H > 0)) return { dx: 0, dy: 0, dw: 0, dh: 0 };
    if (fit === 'stretch') return { dx: 0, dy: 0, dw: W, dh: H };
    const s = fit === 'cover' ? Math.max(W / vw, H / vh) : Math.min(W / vw, H / vh);
    const dw = vw * s;
    const dh = vh * s;
    return { dx: (W - dw) / 2, dy: (H - dh) / 2, dw, dh };
  }

  /* Katmanın kutusu ve içindeki görüntü. Kutu (x, y) merkezli, karenin
     `size` katı; görüntü kutuya `fit` ile oturur. Varsayılan (0,5 / 0,5 /
     1) bütün kare: önceki davranış. Dönen dikdörtgen piksel cinsinden. */
  function boxRect(spec, W, H, vw, vh) {
    const s = spec || {};
    const size = num(s.size, 1, LIMITS.size[0], LIMITS.size[1]);
    const bw = W * size;
    const bh = H * size;
    const r = fitRect(s.fit, bw, bh, vw, vh);
    const ox = num(s.x, 0.5, -0.5, 1.5) * W - bw / 2;
    const oy = num(s.y, 0.5, -0.5, 1.5) * H - bh / 2;
    return { dx: ox + r.dx, dy: oy + r.dy, dw: r.dw, dh: r.dh };
  }

  /* Gönderici listesinden bu uygulamanın kendi çıkışı ayrılır: kendi
     görüntüsünü giriş olarak almak bir geri besleme döngüsü kurar. Spout
     aynı ad yeniden kaydedilince sonuna `_1`, `_2` ekliyor (önceki kopya
     düzgün kapanmadıysa da); o adlar da bizim. */
  function isOwnSender(name, ownNames) {
    const n = String(name || '');
    return (ownNames || []).filter(Boolean).map(String).some((o) => {
      if (n === o) return true;
      const rest = n.slice(o.length + 1);
      return n.length > o.length + 1 && n.slice(0, o.length + 1) === o + '_' && /^\d+$/.test(rest);
    });
  }

  function splitSenders(list, ownNames) {
    const others = [];
    const mine = [];
    (Array.isArray(list) ? list : []).forEach((s) => {
      if (!s || typeof s.name !== 'string' || !s.name) return;
      const item = { name: s.name.slice(0, LIMITS.sender), app: typeof s.appName === 'string' ? s.appName.slice(0, LIMITS.sender) : '', uuid: typeof s.uuid === 'string' ? s.uuid : '' };
      (isOwnSender(item.name, ownNames) ? mine : others).push(item);
    });
    return { others, mine };
  }

  const api = {
    KINDS, INPUT_DEFAULTS, WEB_DEFAULTS, LIMITS, FITS,
    normalizeInput, normalizeWeb, settingsOf, sourceKey,
    checkUrl, hostClass, wanted, fitRect, boxRect, splitSenders, isOwnSender,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVSourceLayers = api;
})();
