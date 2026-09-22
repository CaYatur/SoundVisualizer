'use strict';
/* Tarayıcı köprüsü: görselleştiricinin beklediği window.api yüzeyini
   WebSocket üzerinden sağlar.

   visualizer.js ana süreçle yalnızca dört noktadan konuşur — requestConfig,
   onConfig, onNativeAudio, sendAudioMeter (artı Studio için getPresets/
   onPresets). Bu dosya aynı dört yüzeyi WebSocket'e bağladığı için OBS'teki
   sayfa masaüstündeki pencereyle BİREBİR aynı kodu çalıştırır: ikinci bir
   render motoru yok, dolayısıyla iki çıktı asla birbirinden ayrışmaz. */
(function () {
  const params = new URLSearchParams(location.search);
  const token = params.get('token') || '';
  // Sayfa türü yoldan anlaşılır: kumanda sayfasının ikili ses karelerine
  // ihtiyacı yok ve 'overlay' sayılırsa ses yakalamayı boşuna ayakta tutar.
  const kind = params.get('kind') || (location.pathname.indexOf('/remote') === 0 ? 'remote' : 'overlay');
  // ?transparent=0 -> arkaplanı da göster (tam sahne olarak kullanmak için)
  const forceOpaque = params.get('transparent') === '0';
  const fpsOverride = parseInt(params.get('fps') || '', 10);
  const scaleOverride = parseFloat(params.get('scale') || '');

  const handlers = { config: [], audio: [], presets: [], status: [], nowPlaying: [], showClock: [], mdFollow: [], mdSprite: [] };
  let ws = null;
  let retry = 0;
  let firstConfig = null;
  let firstPresets = null;
  let resolveConfig;
  let resolvePresets;
  const configReady = new Promise((r) => { resolveConfig = r; });
  const presetsReady = new Promise((r) => { resolvePresets = r; });

  const freqBuf = new Uint8Array(1024);
  const timeBuf = new Uint8Array(2048);
  const leftBuf = new Uint8Array(2048);
  const rightBuf = new Uint8Array(2048);

  /* Sayfanın durumu (#565). Sayaçlar HER ZAMAN tutuluyor — ileti başına bir
     artırma; `?debug=1` ile açılan tanı kartı (overlay-diag.js) bunları
     okuyor. Bağlantı, yapılandırma ve ses ayrı ayrı sayılıyor, çünkü boş bir
     yayının sebebi hangisinin eksik olduğudur. */
  const status = {
    kind,
    status: 'connecting',
    attempts: 0,
    connectedAt: 0,
    lastCloseAt: 0,
    app: '',
    version: '',
    configs: 0,
    lastConfigAt: 0,
    audioFrames: 0,
    lastAudioAt: 0,
    sampleRate: 0,
    transparency: forceOpaque ? 'forced-opaque' : params.get('transparent') === '1' ? 'forced-transparent' : 'app',
    appTransparent: false,
    blackout: false,
  };
  window.SVOverlayStatus = status;

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const q = new URLSearchParams({ kind });
    if (token) q.set('token', token);
    return `${proto}//${location.host}/ws?${q.toString()}`;
  }

  /* Saydamlık yayın katmanında uygulama penceresiyle AYNI ayardır
     (`background.transparent` ve katmanlardaki karşılığı). Eski yol
     `stream.transparent` açıkken arkaplan türünü 'transparent' yapıp
     efektleri düşürüyor, yazıyı parlaklık-alfaya sokuyordu — pencere
     kapalı olsa bile OBS her zaman şeffaf çiziyordu.
     URL `?transparent=0` opak, `?transparent=1` şeffaf zorlar (kaynak
     bazında kaçış). Karartma sürerken şeffaflık yok. */
  function transform(cfg) {
    if (!cfg) return cfg;
    // Kumanda sayfası GERÇEK yapılandırmayı görmeli: saydamlık ve kare hızı
    // dönüşümleri yalnızca yayın katmanı içindir. Aksi halde telefonda
    // arkaplan türü 'transparent' görünür ve hiçbir sahne eşleşmez.
    if (kind !== 'overlay') return cfg;
    const c = JSON.parse(JSON.stringify(cfg));
    if (c.isBlackout) {
      /* karartma: şeffaflığa dokunma, siyah kalsın */
    } else if (forceOpaque) {
      c.background = Object.assign({}, c.background, { transparent: false });
      if (Array.isArray(c.layers)) {
        for (let i = 0; i < c.layers.length; i++) {
          const l = c.layers[i];
          if (l && l.settings && l.settings.background) {
            l.settings.background = Object.assign({}, l.settings.background, { transparent: false });
          }
        }
      }
    } else if (params.get('transparent') === '1') {
      c.background = Object.assign({}, c.background, { transparent: true });
    }
    c.power = Object.assign({}, c.power, {
      hideCursor: true,
      alwaysOnTop: false,
      pauseOnSilence: false,
      fpsCap: isFinite(fpsOverride) ? fpsOverride : (c.stream && c.stream.overlayFps) || 60,
      renderScale: isFinite(scaleOverride)
        ? Math.max(0.4, Math.min(1, scaleOverride))
        : Math.max(0.4, Math.min(1, (c.stream && c.stream.quality) || 1)),
    });
    // Tarayıcıda yerel dosya yolu okunamaz; video sunucudan akar.
    if (c.media && c.media.enabled && c.media.source === 'file') {
      c.media = Object.assign({}, c.media, { file: '/media-file' + (token ? '?token=' + encodeURIComponent(token) : '') });
    }
    return c;
  }

  function connect() {
    /* Yeniden denemeler durumu "bağlanıyor"a ÇEKMİYOR: sayfadaki "bağlantı
       yok" uyarısı (`data-sv-status`) her denemede bir an kaybolup gelirdi.
       Kart son bilinen durumu deneme sayısıyla birlikte gösteriyor. */
    status.attempts++;
    try { ws = new WebSocket(wsUrl()); } catch { scheduleRetry(); return; }
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      retry = 0;
      status.connectedAt = Date.now();
      setStatus('connected');
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') { onAudio(ev.data); return; }
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'hello') {
        status.app = String(msg.app || '');
        status.version = String(msg.version || '');
      } else if (msg.type === 'config') {
        status.configs++;
        status.lastConfigAt = Date.now();
        /* Dönüşümden ÖNCEKİ ayar: kart uygulamanın anahtarını gösteriyor,
           URL'nin zorladığını ayrıca yazıyor. */
        const raw = msg.config || {};
        status.appTransparent = !!(raw.background && raw.background.transparent);
        status.blackout = !!raw.isBlackout;
        const c = transform(msg.config);
        if (!firstConfig) { firstConfig = c; resolveConfig(c); }
        handlers.config.forEach((h) => h(c));
      } else if (msg.type === 'presets') {
        const list = msg.presets || [];
        if (!firstPresets) { firstPresets = list; resolvePresets(list); }
        handlers.presets.forEach((h) => h(list));
      } else if (msg.type === 'now-playing') {
        if (window.SVNowLive) window.SVNowLive.state = msg.state;
        else window.SVNowLive = { state: msg.state };
        handlers.nowPlaying.forEach((h) => h(msg.state));
      } else if (msg.type === 'show-clock') {
        handlers.showClock.forEach((h) => h(msg.anchor));
      } else if (msg.type === 'md-follow') {
        // Liderin MilkDrop seçimi (#585): web çıkışı hep izleyici
        handlers.mdFollow.forEach((h) => h(msg.follow || null));
      } else if (msg.type === 'md-sprite') {
        // MilkDrop sprite komutu (#577): her ekranla aynı sırayla
        handlers.mdSprite.forEach((h) => h(msg.cmd || null));
      } else if (msg.type === 'status') {
        handlers.status.forEach((h) => h(msg));
      }
    };

    ws.onerror = () => setStatus('error');
    ws.onclose = () => {
      status.lastCloseAt = Date.now();
      setStatus('closed');
      scheduleRetry();
    };
  }

  function scheduleRetry() {
    retry = Math.min(retry + 1, 10);
    setTimeout(connect, Math.min(5000, 250 * retry));
  }

  function onAudio(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 12) return;
    const dv = new DataView(buffer);
    const sampleRate = dv.getUint32(0, true);
    const fLen = dv.getUint32(4, true);
    const tLen = dv.getUint32(8, true);
    if (12 + fLen + tLen > buffer.byteLength) return;
    // Boyutlar motorun beklediğinden farklı gelirse kırp/doldur: sürüm
    // farkında sessizce bozulmak yerine çalışmaya devam etsin.
    const f = new Uint8Array(buffer, 12, fLen);
    const t = new Uint8Array(buffer, 12 + fLen, tLen);
    freqBuf.fill(0);
    timeBuf.fill(128);
    freqBuf.set(f.subarray(0, Math.min(f.length, freqBuf.length)));
    timeBuf.set(t.subarray(0, Math.min(t.length, timeBuf.length)));
    const frame = { freq: freqBuf, time: timeBuf, sampleRate };
    /* Sol ve sağ kanal (#566): sunucu onları mono dizinin ardına, aynı
       uzunlukta ekliyor. İleti taşımıyorsa kare mono kalıyor ve ses motoru
       iki kanalı mono diziden kuruyor. */
    if (12 + fLen + 3 * tLen <= buffer.byteLength) {
      const l = new Uint8Array(buffer, 12 + fLen + tLen, tLen);
      const r = new Uint8Array(buffer, 12 + fLen + 2 * tLen, tLen);
      leftBuf.fill(128);
      rightBuf.fill(128);
      leftBuf.set(l.subarray(0, Math.min(l.length, leftBuf.length)));
      rightBuf.set(r.subarray(0, Math.min(r.length, rightBuf.length)));
      frame.left = leftBuf;
      frame.right = rightBuf;
    }
    status.audioFrames++;
    status.lastAudioAt = Date.now();
    status.sampleRate = sampleRate;
    handlers.audio.forEach((h) => h(frame));
  }

  function setStatus(s) {
    status.status = s;
    document.documentElement.setAttribute('data-sv-status', s);
  }

  function send(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  window.api = {
    requestConfig: () => configReady,
    onConfig: (cb) => handlers.config.push(cb),
    onNativeAudio: (cb) => handlers.audio.push(cb),
    getPresets: () => presetsReady,
    onPresets: (cb) => handlers.presets.push(cb),
    onNowPlaying: (cb) => handlers.nowPlaying.push(cb),
    onShowClock: (cb) => handlers.showClock.push(cb),
    onMdFollow: (cb) => handlers.mdFollow.push(cb),
    onMdSprite: (cb) => handlers.mdSprite.push(cb),
    sendAudioMeter: () => {}, // tarayıcı tarafında ışık senkronu yok
    sendMessage: () => {},
    /* MilkDrop dokuları (#586): yayın sunucusundan. Tek doku bir URL olarak
       dönüyor ve motor onu doğrudan görsel kaynağı yapıyor — base64'e
       çevirip geri açmaya gerek yok; aynı köken, yani tuval kirlenmiyor.
       Jeton, medya dosyasında olduğu gibi adrese AÇIKÇA ekleniyor: çereze
       ya da Referer'e güvenilmiyor. */
    milkdropTextures: () => fetch('/milkdrop/textures' + (token ? '?token=' + encodeURIComponent(token) : ''), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { names: [] }))
      .catch(() => ({ names: [] })),
    milkdropTexture: (name) => Promise.resolve({
      name,
      url: '/milkdrop/texture?name=' + encodeURIComponent(String(name || ''))
        + (token ? '&token=' + encodeURIComponent(token) : ''),
    }),
    /* Sprite resmi (#577): yol değil, ana sürecin verdiği kimlik. */
    milkdropSpriteImage: (key) => Promise.resolve({
      key,
      url: '/milkdrop/sprite?key=' + encodeURIComponent(String(key || ''))
        + (token ? '&token=' + encodeURIComponent(token) : ''),
    }),
  };

  // Uzaktan kumanda sayfasının kullandığı ek yüzey
  window.SVRemote = {
    send,
    onConfig: (cb) => handlers.config.push(cb),
    onPresets: (cb) => handlers.presets.push(cb),
    onStatus: (cb) => handlers.status.push(cb),
    onNowPlaying: (cb) => handlers.nowPlaying.push(cb),
    ready: configReady,
    presetsReady,
    raw: () => firstConfig,
  };

  connect();
})();
