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

  const handlers = { config: [], audio: [], presets: [], status: [] };
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

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const q = new URLSearchParams({ kind });
    if (token) q.set('token', token);
    return `${proto}//${location.host}/ws?${q.toString()}`;
  }

  /* Saydamlık: OBS'te sadece görselleştiriciyi üst katman olarak isteyen
     kullanıcı için arkaplan katmanları kapatılır. Bunu visualizer.js'e
     dokunmadan yapmanın temiz yolu, yapılandırmayı ona vermeden önce
     dönüştürmek: bilinmeyen bir arkaplan türü + 'transparent' düz renk,
     mevcut kodda hem WebGL hem 2D arkaplanı kapatıp gövdeyi saydam bırakır. */
  function transform(cfg) {
    if (!cfg) return cfg;
    // Kumanda sayfası GERÇEK yapılandırmayı görmeli: saydamlık ve kare hızı
    // dönüşümleri yalnızca yayın katmanı içindir. Aksi halde telefonda
    // arkaplan türü 'transparent' görünür ve hiçbir sahne eşleşmez.
    if (kind !== 'overlay') return cfg;
    const c = JSON.parse(JSON.stringify(cfg));
    const wantsTransparent = !forceOpaque && !!(c.stream && c.stream.transparent);
    if (wantsTransparent) {
      c.background = Object.assign({}, c.background, { type: 'transparent', solidColor: 'transparent' });
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
    try { ws = new WebSocket(wsUrl()); } catch { scheduleRetry(); return; }
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      retry = 0;
      setStatus('connected');
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') { onAudio(ev.data); return; }
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'config') {
        const c = transform(msg.config);
        if (!firstConfig) { firstConfig = c; resolveConfig(c); }
        handlers.config.forEach((h) => h(c));
      } else if (msg.type === 'presets') {
        const list = msg.presets || [];
        if (!firstPresets) { firstPresets = list; resolvePresets(list); }
        handlers.presets.forEach((h) => h(list));
      } else if (msg.type === 'status') {
        handlers.status.forEach((h) => h(msg));
      }
    };

    ws.onerror = () => setStatus('error');
    ws.onclose = () => { setStatus('closed'); scheduleRetry(); };
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
    handlers.audio.forEach((h) => h(frame));
  }

  function setStatus(s) {
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
    sendAudioMeter: () => {}, // tarayıcı tarafında ışık senkronu yok
    sendMessage: () => {},
  };

  // Uzaktan kumanda sayfasının kullandığı ek yüzey
  window.SVRemote = {
    send,
    onConfig: (cb) => handlers.config.push(cb),
    onPresets: (cb) => handlers.presets.push(cb),
    onStatus: (cb) => handlers.status.push(cb),
    ready: configReady,
    presetsReady,
    raw: () => firstConfig,
  };

  connect();
})();
