/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ANDROID SUNUCUSU: motorun beklediği window.api yüzeyi (#1054).

   Masaüstünde bu yüzeyi önyükleme betiği (preload-visualizer.js), tarayıcıda
   web-shim.js sağlıyor. Android'de Kotlin kabuğu bu dosyayı sayfanın kendi
   betiklerinden ÖNCE çalıştırıyor; böylece masaüstündeki görselleştirici
   sayfası değişmeden açılıyor.

   Sözleşme docs/android/HOST.md'de: preload-visualizer.js'teki her yöntem
   burada TANIMLI. Android'de anlamı olmayanlar boş değer döndürür ya da hiç
   tetiklenmez; motor Android yüzünden `typeof` denetimi yapmak zorunda kalmaz.

   Yapılandırma uygulamanın profil klasöründen okunur ve oraya yazılır
   (src/mobile/profile-store.js, masaüstüyle aynı dosya düzeni). Uygulama
   kaynağı yokken ses demo sinyalinden (src/shared/demo-audio.js) kare
   biçiminde üretiliyor. Ölçüm araçları `window.__svHost` üzerinden yapılandırma
   gönderebiliyor (yalnız geliştirme sürümünde). */
(function () {
  if (typeof window === 'undefined' || window.api) return;
  const env = window.__SV_ANDROID || { debug: false, page: '' };

  // ---- Masaüstü kare biçimi (src/main/audio-frame.js) ----
  const FFT_SIZE = 2048;
  const BINS = FFT_SIZE / 2;

  function listeners() {
    const list = [];
    return {
      add(cb) { if (typeof cb === 'function') list.push(cb); },
      emit(v) {
        for (let i = 0; i < list.length; i++) {
          try { list[i](v); } catch (e) { console.error('[android-host]', e); }
        }
      },
      get size() { return list.length; },
    };
  }

  const ev = {
    config: listeners(), configPatch: listeners(), audio: listeners(), presets: listeners(),
    presetsDelta: listeners(), powerSource: listeners(), nowPlaying: listeners(), windowChrome: listeners(),
    showClock: listeners(), lyricsClock: listeners(), lyricsLib: listeners(), mdSprite: listeners(),
    texturesChanged: listeners(), mediaScrub: listeners(), exitHint: listeners(),
    silence: listeners(), audioStatus: listeners(), memory: listeners(), player: listeners(),
    insets: listeners(), back: listeners(), chrome: listeners(), meter: listeners(), lowPower: listeners(),
  };

  let config = null;
  let geometryLock = false;
  let onBattery = false;

  // ---- Kanal (docs/android/MESSAGES.md) ----
  const native = typeof window.SVNative === 'object' && window.SVNative ? window.SVNative : null;
  const state = { hello: null, textIn: 0, binaryIn: 0, badBinary: 0, audioFrames: 0, nativeFrames: 0, source: 'demo', audioStatus: null, flushEvents: 0, silent: false, silenceEvents: 0, memoryPressure: null };

  /* Uygulamadan gelen ses (src/mobile/audio-input.js): kare masaüstündekiyle
     aynı halka ve tayfla kurulur. Son gerçek kareden bu kadar süre sonra demo
     sinyale dönülür (masaüstü önizlemesinin REAL_FRAME_TIMEOUT değeri). */
  const REAL_FRAME_TIMEOUT = 700;
  let lastNativeAt = 0;
  let lastFrame = null;
  const M = window.SVMessages || null;
  /* Yakalama sürerken ~3 sn dijital sessizlik: çalan uygulama sesini paylaşmıyor
     olabilir (src/mobile/silence.js). Düzenleyici çıkış karışımı ya da mikrofon önerir. */
  const silence = window.SVSilence ? window.SVSilence.create() : null;
  const input = window.SVAudioInput ? window.SVAudioInput.create((frame) => {
    lastNativeAt = now();
    lastFrame = frame;
    state.nativeFrames++;
    state.audioFrames++;
    ev.audio.emit(frame);
    const s = silence && silence.push(frame, now());
    if (s) {
      state.silent = s === 'silent';
      if (state.silent) state.silenceEvents++;
      ev.silence.emit({ silent: state.silent, source: state.audioStatus && state.audioStatus.source });
    }
  }) : null;
  function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

  function onBinary(buf) {
    const h = M && M.readHeader(buf);
    if (!h || !input) { state.badBinary++; return; }
    if (h.type === M.TYPE_PCM) {
      const m = M.readPcm(buf);
      if (m) input.pushPcm(m); else state.badBinary++;
    } else if (h.type === M.TYPE_WAVE) {
      const m = M.readWave(buf);
      if (m) input.pushWave(m); else state.badBinary++;
    }
  }
  let nextId = 1;
  const pending = new Map();

  function send(obj) {
    if (!native) return false;
    try { native.postMessage(JSON.stringify(obj)); return true; } catch { return false; }
  }

  function request(op, args) {
    if (!native) return Promise.reject(new Error('native-missing'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ t: 'req', id, op, a: args || {} });
    });
  }

  if (native) {
    native.onmessage = (e) => {
      const d = e && e.data;
      if (typeof d === 'string') {
        state.textIn++;
        let m;
        try { m = JSON.parse(d); } catch { return; }
        if (m.t === 'hello') state.hello = m;
        else if (m.t === 'res' && pending.has(m.id)) {
          const p = pending.get(m.id);
          pending.delete(m.id);
          if (m.ok) p.resolve(m.v); else p.reject(new Error(m.err || 'error'));
        } else if (m.t === 'evt') onEvent(m.ev, m.v);
      } else if (d instanceof ArrayBuffer) {
        state.binaryIn++;
        onBinary(d);
      }
    };
    send({ t: 'hello', v: 1, page: env.page || '' });
  }

  let insets = { top: 0, right: 0, bottom: 0, left: 0 };
  let systemDark = null; // cihazın gece kipi (uygulamadan; WebView'in prefers-color-scheme'i izlemiyor)
  const systemDarkEv = listeners();
  function onEvent(name, v) {
    if (name === 'uiMode') {
      systemDark = !!(v && v.dark);
      systemDarkEv.emit(systemDark);
    } else if (name === 'insets') {
      // Çentik ve sistem çubukları (dp = CSS piksel)
      insets = Object.assign({ top: 0, right: 0, bottom: 0, left: 0 }, v);
      ev.insets.emit(insets);
    } else if (name === 'back') {
      // Kimse karşılamazsa uygulama arkaya alınır (Activity kapatılmaz)
      if (ev.back.size) ev.back.emit(v); else request('appToBack').catch(() => {});
    } else if (name === 'windowChrome') {
      /* PiP ve yüzen pencere: yalnız kabuk için. Motorun onWindowChrome'u masaüstündeki
         pencere çubuğunun ({ show }) işi, ona gönderilmez. */
      ev.chrome.emit(v);
    } else if (name === 'flush') {
      state.flushEvents++;
      profile.flush();
    } else if (name === 'powerSource') {
      onBattery = !!(v && v.onBattery);
      ev.powerSource.emit({ onBattery });
      emitLowPower();
    } else if (name === 'audioStatus') {
      state.audioStatus = v;
      // Kaynak değişti ya da durdu: sessizlik sayacı baştan
      if (silence) silence.reset();
      if (state.silent) { state.silent = false; ev.silence.emit({ silent: false, source: v && v.source }); }
      ev.audioStatus.emit(v);
    } else if (name === 'playerState') {
      onPlayerState(v);
    } else if (name === 'mediaSession') {
      onMediaSession(v);
    } else if (name === 'lyricsLib') {
      lyricsItems = Array.isArray(v && v.items) ? v.items : [];
      emitLyrics();
    } else if (name === 'memoryPressure') {
      /* Sistem bellek istiyor (onTrimMemory): bekleyen kayıt hemen yazılır, uygulama
         haber vermeden kapatılabilir. Düzenleyici isterse ağır katmanları uyarır. */
      state.memoryPressure = v;
      profile.flush();
      ev.memory.emit(v);
    } else if (name === 'exportAck' || name === 'exportError') {
      onExportEvent(name, v);
    }
  }

  /* ---- Uygulama içi çalar (PLAN 2.3) ----
     Çaların durumu masaüstündeki "şimdi çalıyor" biçimine çevrilir
     (src/main/media-session.js): şarkı bilgisi katmanı ve şarkı sözü saati
     masaüstündeki gibi çalışır. Konum saniye; `updated` konumun ölçüldüğü an,
     motor aradaki süreyi kendisi ekliyor. */
  let player = { has: false, playing: false, state: 'idle' };
  let nowPlaying = null;
  let playerNow = null; // uygulama içi çalar
  let systemNow = null; // başka uygulamalar (medya oturumu)
  function onPlayerState(v) {
    if (!v || typeof v !== 'object') return;
    player = v;
    ev.player.emit(v);
    const t = Date.now();
    playerNow = v.has ? {
      has: true,
      playing: !!v.playing,
      title: String(v.title || ''),
      artist: String(v.artist || ''),
      album: String(v.album || ''),
      artwork: String(v.artwork || ''),
      subtitle: '',
      app: 'SoundVisualizer',
      position: (Number(v.position) || 0) / 1000,
      duration: (Number(v.duration) || 0) / 1000,
      updated: t,
      received: t,
    } : { has: false, playing: false, title: '', artist: '', album: '', artwork: '', subtitle: '', app: '', position: 0, duration: 0, updated: 0, received: t };
    publishNow();
  }
  /* Başka uygulamalarda çalan parça (media/NowPlaying.kt, bildirim erişimiyle): masaüstündeki
     Windows medya oturumunun karşılığı. Uygulamanın kendi çaları çalıyorsa o kazanır;
     çalmıyorsa sistemde çalan parça. */
  function onMediaSession(v) {
    if (!v || typeof v !== 'object') return;
    systemNow = Object.assign({}, v, { received: Date.now() });
    publishNow();
  }
  function publishNow() {
    const p = playerNow;
    const sys = systemNow && systemNow.has ? systemNow : null;
    const next = p && p.has && (p.playing || !(sys && sys.playing)) ? p : (sys || p || nowPlaying);
    nowPlaying = next;
    ev.nowPlaying.emit(next);
    lookupLyrics(next);
  }

  /* ---- Şarkı sözleri (store/LyricsHub.kt; masaüstündeki lyrics-lib ve lyrics-lookup) ----
     Kitaplık uygulamada; motor metinli listeyi `onLyricsLib` ile alır ve çalan parçayla
     eşleştirir (src/shared/lyrics-sync.js). Otomatik bulunan söz listenin SONUNA eklenir:
     kullanıcının kitaplığındaki eşleşme önce gelir. Arama yalnız ayar açıksa ve sahnede
     parçayı izleyen bir söz katmanı varsa yapılır (masaüstündeki configFollowsLyrics). */
  let lyricsItems = null;
  let lyricsAuto = null;
  let lyricsSig = '';
  let lyricsCfgSig = '';
  function withAuto(items) {
    const out = Array.isArray(items) ? items.slice() : [];
    if (lyricsAuto && lyricsAuto.text) out.push(lyricsAuto);
    return out;
  }
  function emitLyrics() { ev.lyricsLib.emit(withAuto(lyricsItems || [])); }
  function followsLyrics(cfg) {
    if (!cfg) return false;
    const texts = [];
    if (cfg.text) texts.push(cfg.text);
    for (const l of Array.isArray(cfg.layers) ? cfg.layers : []) if (l && l.settings && l.settings.text) texts.push(l.settings.text);
    return texts.some((t) => t && (t.source || 'static') === 'lyrics' && t.lyricsFollow === true);
  }
  // Sahnede söz katmanı var mı (masaüstündeki configUsesLyrics; dışa aktarma işi)
  function usesLyrics(cfg) {
    if (!cfg) return false;
    const texts = [cfg.text].concat((Array.isArray(cfg.layers) ? cfg.layers : []).map((l) => l && l.settings && l.settings.text));
    return texts.some((t) => t && (t.source || 'static') === 'lyrics');
  }
  /* Uygulama içi çaların şarkısına gömülü söz (masaüstündeki "gömülü" adımı): yalnız etiket
     okunur (`playerHead`: uygulama dosyanın başındaki ID3 etiketini verir), ayrıştırma ortak
     modülde (src/shared/id3-lyrics.js). Bulunamazsa önbellek ve sağlayıcılar (uygulama). */
  function embeddedFromPlayer() {
    if (!native || !window.SVId3Lyrics) return resolved(null);
    return request('playerHead').then((r) => {
      if (!r || !r.b64) return null;
      const bin = atob(r.b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return window.SVId3Lyrics.embedded(u8, '');
    }, () => null);
  }
  function lookupLyrics(st) {
    const cfg = config;
    const L = cfg && cfg.lyricsLookup;
    const enabled = !!(L && L.enabled === true);
    const cs = enabled ? JSON.stringify(L) : '';
    if (cs !== lyricsCfgSig) {
      lyricsCfgSig = cs;
      lyricsSig = '';
      if (!enabled && lyricsAuto) { lyricsAuto = null; emitLyrics(); }
    }
    if (!enabled || !native || !followsLyrics(cfg) || !st || !st.has || !st.title) return;
    const meta = { title: st.title || '', artist: st.artist || '', album: st.album || '', duration: st.duration > 0 ? st.duration : 0 };
    const sig = meta.artist + '\u0001' + meta.title;
    if (sig === lyricsSig) return;
    lyricsSig = sig;
    // Önce gömülü (yalnız uygulama içi çalar: dosyası elimizde), sonra uygulamanın araması
    const fromPlayer = st === playerNow && L.embedded !== false;
    (fromPlayer ? embeddedFromPlayer() : resolved(null)).then((e) => (e ? { text: e.text, source: 'embedded' } : request('lyricsLookup', { config: L, meta }))).then((r) => {
      if (sig !== lyricsSig) return;
      const next = r && r.text ? { id: 'auto:' + sig, name: r.provider || r.source, artist: meta.artist, title: meta.title, text: r.text, auto: r.source } : null;
      if (!next && !lyricsAuto) return;
      lyricsAuto = next;
      emitLyrics();
    }, () => { /* söz yoksa oynatma sürer */ });
  }
  function lyricsSnapshot() {
    if (!native) return resolved([]);
    return request('lyricsLibSnapshot').then((items) => { lyricsItems = Array.isArray(items) ? items : []; return withAuto(lyricsItems); }, () => withAuto(lyricsItems || []));
  }

  // ---- Demo ses (0E) ----
  const demo = {
    freq: new Uint8Array(BINS),
    time: new Uint8Array(FFT_SIZE),
    left: new Uint8Array(FFT_SIZE),
    right: new Uint8Array(FFT_SIZE),
    sampleRate: 48000,
  };
  let demoTimer = 0;
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();

  function demoTick() {
    const D = window.SVDemoAudio;
    if (!D || !ev.audio.size || state.source !== 'demo') return;
    // Uygulamadan gerçek ses geliyorsa demo susar
    if (lastNativeAt && now() - lastNativeAt < REAL_FRAME_TIMEOUT) return;
    const t = (now() - t0) / 1000;
    D.spectrum(t, demo.freq);
    D.fill(Math.floor(t * D.SR), demo.time, demo.left, demo.right);
    demo.sampleRate = D.SR || 48000;
    state.audioFrames++;
    ev.audio.emit(demo);
  }

  function startDemo() {
    if (demoTimer || typeof setInterval !== 'function') return;
    demoTimer = setInterval(demoTick, 1000 / 60);
  }

  const resolved = (v) => Promise.resolve(v);
  const noop = () => {};

  /* ---- Ayar dosyaları (docs/android/HOST.md "Profile") ----
     Okuma bir kez, ilk requestConfig'te: v4 göçü sayfanın katman kodunu
     (window.SVLayers) istiyor ve bu betik ondan önce çalışıyor. Okuma hata
     verirse (disk, izin) kaydedici KAPALI kalır: varsayılan ayarlar
     kullanıcınınkilerin üstüne yazılmaz. */
  const P = window.SVProfileStore || null;
  const profile = {
    loaded: null,
    saver: null,
    state: { loaded: false, readError: null, broken: false, migrated: false, cleaned: [] },
    load() {
      if (this.loaded) return this.loaded;
      if (!native || !P) return (this.loaded = resolved(config));
      this.loaded = domReady().then(() => request('storeRead', { names: P.FILES })).then(async (texts) => {
        const r = P.load(texts, migrateConfig);
        if (r.broken) {
          // Çözülemeyen dosya ilk kayıttan önce kenara: kullanıcı elle kurtarabilsin
          await request('storeCopy', { from: P.MAIN, to: P.BROKEN, overwrite: true });
          this.state.broken = true;
        }
        if (r.migrated) {
          await request('storeCopy', { from: P.MAIN, to: P.V3_BACKUP, overwrite: false });
          this.state.migrated = true;
        }
        this.state.cleaned = r.cleaned || [];
        this.saver = P.createSaver({ write: (files) => request('storeWrite', { files }), seed: r.broken ? null : texts });
        this.state.loaded = true;
        if (r.cfg && !config) config = r.cfg;
        /* İlk açılış (dosya yok) ya da okunamayan dosya: masaüstündeki yeni kurulum gibi
           varsayılanlar ve katman yığını (admin.js effectiveDefaults). Yoksa sayfanın ayarı
           boş kalıyordu: motor kendi varsayılanıyla çiziyor, arayüz "0 katman" gösteriyor ve
           ilk düzenleme motora eksik bir ayar gönderebiliyordu. İlk değişiklikte yazılır. */
        if (!config && window.SV && typeof window.SV.defaultConfig === 'function') {
          config = window.SV.defaultConfig();
          if (window.SVLayers && typeof window.SVLayers.ensureStack === 'function') window.SVLayers.ensureStack(config);
          this.state.fresh = true;
        }
        syncAwake();
        return config;
      }, (e) => {
        this.state.readError = String((e && e.message) || e);
        return config;
      });
      return this.loaded;
    },
    save(cfg) { if (this.saver) this.saver.save(cfg); },
    flush() { return this.saver ? this.saver.flush() : resolved(); },
  };

  /* Sayfanın betikleri bitene kadar beklenir: v4 göçü katman kodunu istiyor ve
     sayfanın kendisinden önce gelen bir istek (ölçüm aracı) göçü atlatmasın. */
  function domReady() {
    if (typeof document === 'undefined' || document.readyState !== 'loading' || !document.addEventListener) return resolved();
    return new Promise((r) => document.addEventListener('DOMContentLoaded', () => r(), { once: true }));
  }

  /* MASAÜSTÜNE ÖZGÜ ÇIKIŞLAR motora kapalı gider. Telefonda ışık (Dynamic
     Lighting, OpenRGB, Art-Net, sACN, WLED) ve OSC çıkışı yok, ama bilgisayardan
     gelen ayarda açık olabilirler. Ölçüldü: ışık paleti MilkDrop'tan alınıyorsa
     motor saniyede ~30 kez GPU'dan piksel okuyor (gl.readPixels işlem hattını
     bekletiyor); emülatörde kare hızı 60'tan ~4'e düşüyor ve görüntü siyah
     kalıyordu, telefonda da boşa iş. Dosyadaki değer DEĞİŞMEZ: ayar bilgisayara
     geri götürülünce ışıklar yine açık. */
  const DESKTOP_OUTPUTS = ['lighting', 'openrgb', 'artnet', 'sacn', 'wled', 'oscOut'];
  /* TELEFON PERFORMANSI. Yalnız motorun gördüğü kopyada; kayıtlı ayar değişmez.
     - Çözünürlük sınırı (`power.maxRes`, varsayılan 720p): telefonun 1080x2400 ekranında her katman
       tam çözünürlükte 2,6 milyon piksel çiziyordu. Sınır kısa kenara göre, Çizim ölçeğiyle çarpılır.
     - Sayfa sahneyi tümüyle örtüyorsa görünmeyen kareler çizilmez (ölçerler akmaya devam etsin diye 12 fps). */
  const isEnginePage = String(env.page || '').indexOf('src/visualizer/') === 0;
  const MAX_RES = { 720: 720, 1080: 1080 };
  const COVERED_FPS = 12;
  let stageCovered = false;
  function phonePower(p) {
    const out = Object.assign({}, p);
    const limit = MAX_RES[p.maxRes == null ? 720 : p.maxRes];
    const dpr = window.devicePixelRatio || 1;
    const short = Math.min(window.screen.width, window.screen.height) * dpr;
    if (limit && short > limit) out.renderScale = Math.max(0.4, (Number(p.renderScale) || 1) * (limit / short));
    if (stageCovered) out.fpsCap = COVERED_FPS;
    return out;
  }
  function setStageCovered(on) {
    if (on === stageCovered) return;
    stageCovered = on;
    if (config && config.power) ev.configPatch.emit({ power: phonePower(config.power) });
  }
  function engineView(c) {
    if (!c || typeof c !== 'object') return c;
    let out = c;
    if (isEnginePage && c.power) out = Object.assign({}, c, { power: phonePower(c.power) });
    for (const k of DESKTOP_OUTPUTS) {
      const v = c[k];
      if (!v || typeof v !== 'object' || v.enabled !== true) continue;
      if (out === c) out = Object.assign({}, c);
      out[k] = Object.assign({}, v, { enabled: false });
    }
    return out;
  }

  /* İÇE AKTARMA (PLAN 2.2). Masaüstündeki tam yedeğin geri yüklemesiyle aynı sonuç:
     ayarlar ve sahneler yedektekiyle değişir, presetler eklenir (aynı kimlik varsa
     yedekteki geçerli). Önceki hâl *.before-import.json olarak kalır. Kitaplık
     dosyaları (logo, video, söz) ve dokular Faz 4'te; sayıları sonuçta döner. */
  /* Eklenenler motorun listesine fark olarak gider (sahne yeniden kurulmaz; kaynak
     seçilince istenir). Kuşak da taşınır: motor sonraki yoklamada listeyi baştan istemez. */
  async function importMilk() {
    if (!native) throw new Error('native-missing');
    const r = (await request('milkImport')) || {};
    const up = Array.isArray(r.upsert) ? r.upsert : [];
    if (up.length) ev.presetsDelta.emit({ upsert: up, remove: [], gen: Number(r.gen) || 0 });
    return { added: r.added || 0, duplicates: r.duplicates || 0, invalid: r.invalid || 0, skipped: r.skipped || 0, ids: up.map((p) => p.id) };
  }

  function usesCamera(c) {
    const list = c && Array.isArray(c.layers) ? c.layers : [];
    return list.some((l) => l && l.kind === 'media' && l.enabled !== false && l.settings && l.settings.media && l.settings.media.enabled !== false && l.settings.media.source === 'webcam');
  }

  async function importProfile(opts) {
    if (!native || !P) throw new Error('native-missing');
    await profile.load();
    // Ayarlar okunamadıysa kayıt kapalı: içe aktarılan hiçbir şey yazılmazdı
    if (profile.state.readError) throw new Error('store-read');
    const r = await request(opts.media ? 'importOpen' : 'importPick', opts.media ? { media: String(opts.media) } : {});
    let incoming;
    let summary = null;
    let committed = { presets: 0, textures: 0, skipped: 0 };
    if (r.kind === 'svbackup') {
      const b = P.readBackup(r.meta);
      if (b.error) { await request('importDiscard').catch(() => {}); throw new Error(b.error); }
      incoming = b.settings;
      summary = b.summary;
      committed = await request('importCommit', { ids: b.presetIds, textures: b.textures });
    } else {
      try { incoming = P.parseSettings(r.settings); } catch (e) { throw new Error('NOT_SETTINGS'); }
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw new Error('NOT_SETTINGS');
    }
    /* Masaüstü kitaplıklarından gelen videolar (store/LibraryRestore.kt): sahnelerdeki eski
       yollar telefondaki adrese eşlenir (masaüstündeki remapMedia; yedek çoğu kez Windows'tan,
       yol karşılaştırması büyük/küçük harf duyarsız). */
    const libs = committed.libraries || null;
    if (libs && libs.map && typeof libs.map === 'object' && Object.keys(libs.map).length) remapMedia(incoming, libs.map);
    // Önceki hâl kenara: bekleyen kayıt önce yazılır ki kopya son hâli taşısın
    await profile.flush();
    for (let i = 0; i < P.FILES.length; i++) await request('storeCopy', { from: P.FILES[i], to: P.BEFORE_IMPORT[i], overwrite: true });
    const loaded = P.load({ [P.MAIN]: JSON.stringify(incoming) }, migrateConfig);
    if (!loaded.cfg) throw new Error('NOT_SETTINGS');
    const cfg = adoptImported(loaded.cfg, committed.textures > 0);
    setConfig(cfg);
    await profile.flush();
    // Motor yeni presetleri görsün (onPresets: liste değişti, sahne yeniden kurulur)
    if (committed.presets) ev.presets.emit(await request('presetsList').catch(() => []));
    if (committed.textures) ev.texturesChanged.emit();
    // Sözler geldiyse motorun söz listesi yenilenir
    if (libs && libs.lyrics) lyricsSnapshot().then(() => emitLyrics(), () => {});
    return {
      kind: r.kind,
      summary,
      scenes: Array.isArray(cfg.scenes) ? cfg.scenes.length : 0,
      presets: committed.presets || 0,
      textures: committed.textures || 0,
      skipped: (committed.skipped || 0) + (r.skipped || 0),
      later: r.later || null,
      libraries: libs ? { logos: libs.logos || 0, lyrics: libs.lyrics || 0, videos: libs.videos || 0 } : null,
      migrated: !!loaded.migrated,
      // Ölçüm: arşivi okuma ve presetleri işleme süresi (uygulamada, ms)
      timing: { read: r.ms || 0, commit: committed.ms || 0 },
    };
  }

  /* src/main/show-space.js remapMedia: { source: 'file', file } olan her nesnede eski yol
     tabloda varsa yeni adres yazılır. sv-media:// adresi önce yola çevrilir. */
  function remapMedia(obj, map) {
    const table = new Map();
    for (const k of Object.keys(map)) table.set(String(k).toLowerCase(), map[k]);
    const U = window.SVMediaUrl;
    const seen = new Set();
    let n = 0;
    (function walk(v) {
      if (!v || typeof v !== 'object' || seen.has(v)) return;
      seen.add(v);
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v.source === 'file' && typeof v.file === 'string' && v.file) {
        const raw = U && U.fromMediaUrl ? U.fromMediaUrl(v.file) : v.file;
        const hit = table.get(String(raw).toLowerCase());
        if (hit) { v.file = hit; n++; }
      }
      for (const k of Object.keys(v)) walk(v[k]);
    })(obj);
    return n;
  }

  /* Paneldeki adoptImportedSettings'in sayfada yapılabilen kısmı: varsayılanlarla
     tamamlanır, katman yığını kurulur, resim öğeleri normalleştirilir. */
  function adoptImported(c, texturesAdded) {
    const S = window.SV;
    let out = S && S.deepMerge && S.defaultConfig ? S.deepMerge(S.defaultConfig(), c) : c;
    /* Başka makinenin doku klasörü burada yok (masaüstündeki restore da boşaltıyor);
       dokular uygulamanın klasöründe. Yeni dokular geldiyse motor listeyi yeniden
       istesin (paneldeki textureRev artışı). */
    if (out.milkdrop && typeof out.milkdrop.textureDir === 'string') out.milkdrop.textureDir = '';
    if (texturesAdded) {
      out.milkdropLibrary = out.milkdropLibrary && typeof out.milkdropLibrary === 'object' ? out.milkdropLibrary : {};
      const before = config && config.milkdropLibrary ? +config.milkdropLibrary.textureRev || 0 : 0;
      out.milkdropLibrary.textureRev = Math.max(+out.milkdropLibrary.textureRev || 0, before) + 1;
    }
    if (window.SVLayers && typeof window.SVLayers.ensureStack === 'function') window.SVLayers.ensureStack(out);
    if (S && S.normalizeImageItem && out.images && Array.isArray(out.images.items)) {
      out.images.items = out.images.items.map((it) => S.normalizeImageItem(it));
    }
    return out;
  }

  /* v4 göçü (src/shared/migrate-v4.js): masaüstünde ana süreç yapıyor. Katman
     kodu olmayan sayfada (dışa aktarım) yapılmaz; çevrilmemiş ayar yazılsa da
     docVersion eski kalır, sonraki açılışta çevrilir. */
  function migrateConfig(cfg) {
    const Mg = window.SVMigrateV4;
    if (!Mg || !window.SVLayers || !Mg.needsMigration(cfg)) return false;
    return Mg.migrate(cfg).changed;
  }

  /* Düzenleyicinin (Faz 3) kullanacağı yol: motor hemen uygular, dosya
     birleştirilmiş kayıtla yazılır. patch: kaydırıcı sürüklenirken yalnız
     değişen üst düzey anahtarlar (masaüstündeki config-patch). */
  function setConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return;
    config = cfg;
    ev.config.emit(engineView(cfg));
    profile.save(cfg);
    lookupLyrics(nowPlaying);
    emitLowPower();
    syncAwake();
  }
  /* Ekranı açık tut (masaüstündeki power.keepAwake, varsayılan açık): görselleştirici
     izlenirken telefon kararmasın. Dışa aktarım sayfasında her zaman açık. */
  let awake = null;
  function syncAwake() {
    const exporting = String(env.page || '').indexOf('src/exporter/') === 0;
    const on = exporting || !(config && config.power && config.power.keepAwake === false);
    if (on === awake || !native) return;
    awake = on;
    request('keepAwake', { on }).catch(() => { awake = null; });
  }
  /* Düşük güç kipi (src/shared/low-power.js): arayüz de cam bulanıklığını bırakır. */
  let lowPowerOn = null;
  function emitLowPower() {
    const L = window.SVLowPower;
    const on = !!(L && config && L.active(config, onBattery));
    if (on === lowPowerOn) return;
    lowPowerOn = on;
    ev.lowPower.emit(on);
  }
  function patchConfig(p) {
    if (!config || !p || typeof p !== 'object') return;
    config = Object.assign({}, config, p);
    ev.configPatch.emit(engineView(p));
    profile.save(config);
    if (p.power) syncAwake();
    if (p.lyricsLookup || p.layers || p.text) lookupLyrics(nowPlaying);
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    // Arka plana geçerken ve sayfa kapanırken bekleyen kayıt hemen yazılır
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') profile.flush(); });
  }
  if (typeof window.addEventListener === 'function') window.addEventListener('pagehide', () => { profile.flush(); });

  window.SVAndroid = Object.freeze({
    config: Object.freeze({
      get: () => config,
      set: setConfig,
      patch: patchConfig,
      flush: () => profile.flush(),
      ready: () => profile.load(),
    }),
    /* Çalan parça: uygulama içi çalar ya da (bildirim erişimiyle) başka uygulamalar. */
    nowPlaying: Object.freeze({
      current: () => nowPlaying,
      /** Yalnız başka uygulamalardan gelen (medya oturumu); kart ve sınama için. */
      system: () => systemNow,
      status: () => request('nowPlayingStatus'),
      openAccess: () => request('nowPlayingAccess'),
      onChange: (cb) => ev.nowPlaying.add(cb),
    }),
    /* Masaüstü yedeğinden gelen logo ve video kitaplıkları (Kitaplık → Medya). */
    libraries: Object.freeze({
      list: (key) => request('libraryList', { key }),
      logo: (id) => request('logoLibRead', { id }),
    }),
    /* Şarkı sözü kitaplığı ve otomatik bulma (Kitaplık → Sözler, Ayarlar). */
    lyrics: Object.freeze({
      list: () => request('lyricsLibList'),
      read: (id) => request('lyricsLibRead', { id }),
      import: () => request('lyricsLibImport'),
      add: (item) => request('lyricsLibAdd', item || {}),
      update: (id, patch) => request('lyricsLibUpdate', { id, patch }),
      remove: (id) => request('lyricsLibRemove', { id }),
      clearCache: () => request('lyricsCacheClear').then((r) => { lyricsSig = ''; if (lyricsAuto) { lyricsAuto = null; emitLyrics(); } lookupLyrics(nowPlaying); return r; }),
      auto: () => lyricsAuto,
      follows: () => followsLyrics(config),
    }),
    /* Ses kaynağı (HOST.md "Shell surface"): capture, mic, visualizer. */
    audio: Object.freeze({
      start: (source) => request('audioStart', { source }),
      stop: () => request('audioStop'),
      status: () => state.audioStatus,
      silent: () => state.silent,
      onStatus: (cb) => ev.audioStatus.add(cb),
      onSilence: (cb) => ev.silence.add(cb),
    }),
    /* Uygulama içi çalar: pick() Android'in dosya seçicisini açar; open(media)
       uygulamanın medya klasöründeki bir dosyayı açar. Durum `onState` ile gelir. */
    player: Object.freeze({
      pick: () => request('playerPick'),
      open: (media, play) => request('playerOpen', { media, play: !!play }),
      reopen: (uri, play) => request('playerOpen', { uri, play: !!play }),
      play: () => request('playerPlay'),
      pause: () => request('playerPause'),
      stop: () => request('playerStop'),
      seek: (ms) => request('playerSeek', { ms }),
      state: () => player,
      // Taze durum (önbellekteki `state()` yalnız olayla değişir; sürekli çalarken olay gelmez)
      refresh: () => request('playerPosition'),
      onState: (cb) => ev.player.add(cb),
    }),
    /* WebGL bağlam bütçesi: sayfa başına en çok GL_LIMIT etkin bağlam. */
    gl: () => glBudget(),
    /* Kabuk (src/mobile/shell.js): ekran kenarı boşlukları, geri tuşu, PiP/yüzen
       pencere durumu, seviye ölçer, düşük güç. */
    insets: () => Object.assign({}, insets),
    /** Sahne bir sayfanın altında tümüyle kaldı: motor kare hızını düşürür. */
    setStageCovered,
    /** Cihaz koyu kipte mi; uygulama henüz bildirmediyse null. */
    systemDark: () => systemDark,
    onSystemDark: (cb) => systemDarkEv.add(cb),
    onInsets: (cb) => ev.insets.add(cb),
    onBack: (cb) => ev.back.add(cb),
    onChrome: (cb) => ev.chrome.add(cb),
    onMeter: (cb) => ev.meter.add(cb),
    onLowPower: (cb) => { ev.lowPower.add(cb); if (lowPowerOn != null) cb(lowPowerOn); },
    app: Object.freeze({ toBackground: () => request('appToBack') }),
    /* Sistemin resim içinde resmi; w:h görüntünün oranı (1:2,39 … 2,39:1 arası). */
    pip: (w, h) => request('pipEnter', { w: w || 16, h: h || 9 }),
    /* Galeriden dosya: 'video' → { url, name, mime } (kopyalanmaz, akıtılır),
       'image' → { dataUrl, name, width, height } (uzun kenar en çok 1024 px). */
    media: Object.freeze({ pick: (kind) => request('mediaPick', { kind }) }),
    /* Dışa aktarma (Faz 5): iş uygulamaya, motor dışa aktarım sayfasına geçer.
       iş: { cfg, width, height, fps, durationSec (0 = şarkının tamamı), audioUri, outputName } */
    exportOpen: (job) => request('exportOpen', job),
    /** Seçilen şarkının adı, sanatçısı, albümü, süresi ve kapağı. */
    audioTags: (uri) => request('audioTags', { uri }),
    /* Dışa aktarma kodekleri: { avc: true, hevc } (cihazın kodlayıcıları) */
    exportCaps: () => (native ? request('exportCaps') : resolved({ avc: true, hevc: false })),
    floating: Object.freeze({
      // Sahnede açık kamera katmanı varsa uygulama kamera ön plan hizmetini kurar (CameraService)
      open: (o) => request('floatingOpen', Object.assign({ camera: usesCamera(config) }, o || {})),
      close: () => request('floatingClose'),
      set: (o) => request('floatingSet', o || {}),
      state: () => request('floatingState'),
    }),
    /* Bilgisayardan içe aktarma: masaüstünün tam yedeği (.svbackup) ya da settings.json.
       media verilirse uygulamanın medya klasöründeki dosya, yoksa Android'in dosya seçicisi. */
    importProfile: (opts) => importProfile(opts || {}),
    /* Telefondan MilkDrop presetleri (.milk, .milk2; Faz 4): Android'in dosya seçicisi,
       birden çok dosya. { added, duplicates, invalid, skipped }; vazgeçilirse 'cancelled'. */
    presets: Object.freeze({ importMilk: () => importMilk() }),
    onMemoryPressure: (cb) => ev.memory.add(cb),
    /* Zaman çizelgesinin gösteri saati çıpası (src/shared/showclock.js). Masaüstünde
       panel `sendShowClock` ile pencerelere yollar; burada motor aynı sayfada, olay
       doğrudan `api.onShowClock` dinleyicisine gider (src/mobile/shell-timeline.js). */
    showClock: (anchor) => ev.showClock.emit(anchor),
  });

  window.SV_PLATFORM = Object.freeze({ os: 'android', isWindows: false, isMac: false, isLinux: false, isAndroid: true });
  window.SV_DISPLAY_ID = null;
  window.SV_SHARED_EPOCH = null;
  window.SV_FLOATING = false;

  /* HOST.md'deki tablo, aynı sırayla. */
  window.api = {
    requestConfig: () => profile.load().then(() => engineView(config)),
    onConfig: (cb) => ev.config.add(cb),
    onConfigPatch: (cb) => ev.configPatch.add(cb),
    onShowClock: (cb) => ev.showClock.add(cb),
    onMomentaryFx: noop, // Android'de anlık efekt yok (D6)
    onMediaScrub: (cb) => ev.mediaScrub.add(cb),
    onTbar: noop, // T-bar yok (D6)
    onSharedClock: noop, // yedeklilik oturum saati yalnız masaüstünde
    getSharedClock: () => resolved(null),
    onLyricsClock: (cb) => ev.lyricsClock.add(cb),
    onNowPlaying: (cb) => ev.nowPlaying.add(cb),
    nowPlayingCurrent: () => resolved(nowPlaying),
    onNativeAudio: (cb) => { ev.audio.add(cb); startDemo(); },
    // Seviye ölçer: arayüzün üst bilgisindeki çubuklar (~30 Hz)
    sendAudioMeter: (m) => { if (ev.meter.size) ev.meter.emit(m); },
    sendOscHit: noop, // OSC yok
    sendMessage: noop,
    claimCamRelay: () => resolved(false), // kamera aktarımı yayın istemcileri içindir
    releaseCamRelay: noop,
    sendCamFrame: noop,
    sendCamStatus: noop,
    screenSources: () => resolved([]),
    /* Kullanıcı presetleri uygulamanın profil klasöründen (masaüstündeki presets
       klasörü). Liste MilkDrop kaynağını taşımaz; kaynak çizilecekken istenir. */
    getPresets: () => (native ? request('presetsList').catch(() => []) : resolved([])),
    milkdropPresetSource: (id) => (native ? request('presetsSource', { id: String(id || '') }).then((r) => (r && r.source) || '', () => '') : resolved('')),
    getPowerSource: () => resolved({ onBattery }),
    onPowerSource: (cb) => ev.powerSource.add(cb),
    onPresets: (cb) => ev.presets.add(cb),
    onPresetsDelta: (cb) => ev.presetsDelta.add(cb),
    presetsHead: () => (native ? request('presetsHead').catch(() => ({ gen: 0 })) : resolved({ gen: 0 })),
    presetsSince: (gen) => (native ? request('presetsSince', { gen: Number(gen) || 0 }).catch(() => null) : resolved(null)),
    /* MilkDrop dokuları uygulamanın doku klasöründen; yanıtlar masaüstündekiyle aynı
       biçimde: liste `{ dir, names }`, tek doku `{ name, dataUrl }`. */
    milkdropTextures: () => (native ? request('texturesList').catch(() => ({ dir: '', names: [] })) : resolved({ dir: '', names: [] })),
    milkdropTexture: (name) => (native ? request('textureRead', { name: String(name || '') }).catch(() => null) : resolved(null)),
    onMilkdropTexturesChanged: (cb) => ev.texturesChanged.add(cb),
    // Masaüstü yedeğinden gelen logo kitaplığı (store/LibraryRestore.kt)
    logoLibRead: (id) => (native ? request('logoLibRead', { id }).catch(() => null) : resolved(null)),
    lyricsLibSnapshot: () => lyricsSnapshot(),
    lyricsLibRead: (id) => (native ? request('lyricsLibRead', { id }) : resolved(null)),
    onLyricsLib: (cb) => ev.lyricsLib.add(cb),
    floatingClose: noop,
    floatingSnap: noop,
    floatingSize: noop,
    onWindowChrome: (cb) => ev.windowChrome.add(cb),
    onExitHint: (cb) => ev.exitHint.add(cb),
    setGeometryLock: (locked) => { geometryLock = !!locked; },
    getGeometryLock: () => resolved(geometryLock),
    onMdFollow: noop, // yedeklilik (#585)
    onMdSprite: (cb) => ev.mdSprite.add(cb),
    milkdropSpriteImage: () => resolved(null),
    milkdropSprite: () => resolved(null),
  };

  /* ---- Dışa aktarım (docs/android/HOST.md "Export surface") ----
     Dışa aktarım sayfası (src/exporter, değişmeden) window.exp'i masaüstünde
     önyükleme betiğinden alıyor. Burada kareler (I420) ikili kanaldan uygulamaya
     gidiyor; kodlayıcı ve MP4 uygulamada. Kare kodlayıcıya verilince gelen
     exportAck, masaüstündeki "ffmpeg.stdin yazıldı" bekleyişinin karşılığı. */
  const exportState = { job: null, id: 0, began: null, sent: 0, acked: 0, bytes: 0, progress: [0, 0], cancel: false, result: null, error: null, analysis: null, t0: 0 };
  const acks = new Map();
  const jobListeners = listeners();
  /* İş, dışa aktarım sayfasının son betiği (exporter.js) onJob'u kurmadan önce
     gelebilir: bekletilir ve dinleyici kurulunca teslim edilir (ölçüldü: aksi
     halde iş sessizce kayboluyordu). */
  let pendingJob = null;
  let frameSeq = 0;

  function onExportEvent(name, v) {
    const index = v && v.index;
    const w = acks.get(index);
    if (name === 'exportAck') exportState.acked++;
    else exportState.error = (v && v.msg) || 'encode';
    if (w) { acks.delete(index); w(name === 'exportAck'); }
  }

  if (String(env.page || '').indexOf('src/exporter/') === 0 && !window.exp) {
    window.exp = {
      onJob: (cb) => {
        jobListeners.add(cb);
        if (pendingJob) { const j = pendingJob; pendingJob = null; cb(j); }
      },
      ready: (totalFrames) => {
        const j = exportState.job || {};
        // Kodek ve bit hızı dışa aktarma sayfasının seçiminden (H.265 cihazda yoksa uygulama H.264'e döner)
        const opts = { width: j.width, height: j.height, fps: j.fps, total: totalFrames, audio: j.audioName || '', name: j.outputName || '', codec: j.codec === 'hevc' ? 'hevc' : 'avc' };
        if (j.bitrate > 0) opts.bitrate = Math.round(j.bitrate);
        exportState.began = request('exportBegin', opts).then((r) => { exportState.id = r.job; return r; }, (e) => { exportState.error = e.message; throw e; });
      },
      sendFrame: async (data, index) => {
        const began = await exportState.began;
        const j = exportState.job;
        const buf = M.videoFrame(frameSeq++, now(), began.job, index, j.width, j.height, data);
        exportState.sent++;
        exportState.bytes += buf.byteLength;
        const ok = new Promise((resolve) => acks.set(index, resolve));
        native.postMessage(buf);
        const fine = await ok;
        return { cancel: exportState.cancel || !fine };
      },
      progress: (done, total) => { exportState.progress = [done, total]; },
      finish: () => {
        request('exportEnd').then((r) => {
          exportState.result = Object.assign({ pageMs: Math.round(now() - exportState.t0), sentMB: Math.round(exportState.bytes / 1e5) / 10 }, r);
        }, (e) => { exportState.error = e.message; });
      },
      cancelled: () => { request('exportCancel').catch(() => {}); exportState.error = 'cancelled'; },
      error: (msg) => { request('exportCancel').catch(() => {}); exportState.error = String(msg); },
      analysis: (data) => { exportState.analysis = data ? Object.keys(data).length : 0; },
      cancelRequested: () => resolved(exportState.cancel),
    };

    /* ÜRÜN AKIŞI (Faz 5, android/.../export/ExportFlow.kt): sahne sayfası işi uygulamaya
       bıraktı, motor bu sayfaya geçti. İş alınır, şarkı medya klasöründen okunur ve
       dışa aktarım başlar. Ölçüm araçları (geliştirme) işi __svHost.runExport ile verir;
       uygulamada iş yoksa burada bir şey olmaz. */
    const startFromApp = async () => {
      const j = await request('exportJob').catch(() => null);
      if (!j || !j.audioUrl) return;
      let ab;
      try { ab = await (await fetch(j.audioUrl)).arrayBuffer(); } catch (e) { exportState.error = 'audio'; return; }
      /* "30 sn" seçilip şarkı daha kısaysa video şarkıyla biter (yoksa sonu sessiz kalıyordu,
         ölçüldü: 20 sn şarkıdan 30 sn video). */
      let want = Number(j.durationSec) > 0 ? Number(j.durationSec) : 0;
      if (want > 0 && typeof AudioContext === 'function') {
        try {
          const ctx = new AudioContext();
          const buf = await ctx.decodeAudioData(ab.slice(0));
          ctx.close();
          if (buf.duration > 0 && buf.duration < want) want = 0;
        } catch (e) { /* çözülemezse istenen süre kalır */ }
      }
      const job = {
        cfg: j.cfg || {}, width: j.width, height: j.height, fps: j.fps, pix: 'yuv420p',
        durationSec: want,
        audioBuffer: ab, audioName: j.audioName, outputName: j.outputName || '', platform: 'android',
        codec: j.codec === 'hevc' ? 'hevc' : 'avc', bitrate: Number(j.bitrate) || 0,
      };
      /* Seçilen şarkının adı ve kapağı (masaüstündeki job.track): Çalan Parça, söz ve logo
         katmanları videoda bunları çizer, ilerleme kare saatinden gelir (exporter.js). */
      const track = j.track && typeof j.track === 'object' ? j.track : { title: String(j.songName || '').replace(/\.[^.]+$/, '') };
      job.track = { title: track.title || '', artist: track.artist || '', album: track.album || '', artwork: track.artwork || '' };
      /* Otomatik söz (masaüstündeki sıra, #937): şarkıya gömülü söz (src/shared/id3-lyrics.js), yoksa
         önbellek ve sağlayıcılar. Bulunamaması dışa aktarmayı durdurmaz. */
      const L = job.cfg.lyricsLookup;
      if (L && L.enabled === true && usesLyrics(job.cfg)) {
        const meta = { title: job.track.title, artist: job.track.artist, album: job.track.album, duration: Number(track.duration) || 0 };
        try {
          const e = L.embedded !== false && window.SVId3Lyrics ? window.SVId3Lyrics.embedded(new Uint8Array(ab), '') : null;
          const r = e ? { text: e.text, source: 'embedded' } : await request('lyricsLookup', { config: L, meta });
          if (r && r.text) job.lyricsAuto = { text: r.text, source: r.source || '', provider: r.provider || '' };
        } catch (e) { /* söz yoksa dışa aktarma sürer */ }
      }
      // Çalan parçayı izleyen söz katmanı kitaplıktan eşleşir (masaüstündeki lyricsLibrary)
      if (followsLyrics(job.cfg)) {
        const items = await lyricsSnapshot();
        const a = job.lyricsAuto;
        job.lyricsLibrary = a ? items.concat([{ id: 'auto:export', name: a.provider || a.source, artist: job.track.artist, title: job.track.title, text: a.text, auto: a.source }]) : items;
      }
      Object.assign(exportState, { job, began: null, sent: 0, acked: 0, bytes: 0, cancel: false, result: null, error: null, t0: now(), song: j.songName || '' });
      if (jobListeners.size) jobListeners.emit(job);
      else pendingJob = job;
    };
    domReady().then(startFromApp);

    /* Dışa aktarma ekranının (src/mobile/export-ui.js) yüzü. */
    window.SVExport = Object.freeze({
      state: () => ({
        progress: exportState.progress.slice(), sent: exportState.sent, acked: exportState.acked, song: exportState.song || '',
        result: exportState.result, error: exportState.error, cancel: exportState.cancel, started: !!exportState.job, t0: exportState.t0,
        size: exportState.job ? { width: exportState.job.width, height: exportState.job.height, fps: exportState.job.fps } : null,
      }),
      cancel: () => { exportState.cancel = true; },
      save: (path) => request('exportSave', { path }),
      share: (uri) => request('exportShare', { uri }),
      close: () => request('exportClose'),
    });
  }

  /* WEBGL BAĞLAM SAYACI. Android WebView'de sayfa başına en çok 8 etkin bağlam
     var (ölçüldü, masaüstünde 16); dokuzuncu açılınca en eskisi kaybolur. Her GL
     katmanı kendi bağlamını açtığı için düzenleyici bir sahne sınıra yaklaşınca
     uyarır (PHASE0.md, R1): sayaç yayın sürümünde de açık.
       attached: belgede duran ve kaybolmamış bağlamlar (0E ölçümleri bununla);
       live: kaybolmamış ve hâlâ tutulan bütün bağlamlar — belgeden çıkarılmış
             tuval de sınıra sayılıyor (zaman çizelgesi katmanları ekran dışında). */
  const GL_LIMIT = 8;
  const gl = { created: 0, lost: 0, max: 0 };
  const glRefs = [];
  function glCount() {
    let attached = 0;
    let live = 0;
    for (let i = glRefs.length - 1; i >= 0; i--) {
      const c = glRefs[i].canvas.deref();
      const x = glRefs[i].ctx.deref();
      if (!c || !x) { glRefs.splice(i, 1); continue; }
      if (x.isContextLost()) continue;
      live++;
      if (c.isConnected) attached++;
    }
    return { attached, live };
  }
  function glActive() { return glCount().attached; }
  function glBudget() {
    const n = glCount();
    return { live: n.live, attached: n.attached, limit: GL_LIMIT, created: gl.created, lost: gl.lost };
  }
  if (typeof HTMLCanvasElement !== 'undefined') {
    const orig = HTMLCanvasElement.prototype.getContext;
    const seen = new WeakSet();
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      const c = orig.call(this, type, opts);
      if (c && (type === 'webgl' || type === 'webgl2') && !seen.has(c)) {
        seen.add(c);
        gl.created++;
        if (typeof WeakRef === 'function') glRefs.push({ canvas: new WeakRef(this), ctx: new WeakRef(c) });
        this.addEventListener('webglcontextlost', () => { gl.lost++; });
      }
      return c;
    };
  }

  /* Ölçüm araçlarının kancası (yalnız geliştirme sürümü). */
  if (env.debug) {
    window.__svHost = {
      state,
      request,
      /* Yalnız motora: ölçümün uyguladığı şablonlar kullanıcının ayarlarına yazılmaz. */
      pushConfig(c) { config = c; ev.config.emit(engineView(c)); },
      saveConfig: setConfig,
      flushConfig: () => profile.flush(),
      profileState() {
        const st = profile.saver ? Object.assign({}, profile.saver.stats) : null;
        return Object.assign({}, profile.state, { saver: st, pending: !!(profile.saver && profile.saver.pending()) });
      },
      /* Dışa aktarım işi (Faz 5'te düzenleyiciden gelecek; 0E'de ölçüm aracından). */
      runExport(job) {
        Object.assign(exportState, { job, began: null, sent: 0, acked: 0, bytes: 0, cancel: false, result: null, error: null, t0: now() });
        if (jobListeners.size) jobListeners.emit(job);
        else pendingJob = job;
      },
      exportState() { return Object.assign({}, exportState, { job: null, began: !!exportState.began }); },
      cancelExport() { exportState.cancel = true; },
      /* WebGL bağlamları: açılan, kaybolan, şu an etkin (kayıp olmayan) ve en çok. */
      glContexts() {
        const active = glActive();
        if (active > gl.max) gl.max = active;
        return Object.assign({ active }, gl);
      },
      patchConfig(p) { ev.configPatch.emit(engineView(p)); },
      savePatch: patchConfig,
      setAudioSource(name) { state.source = name; },
      audioStart(source) { return request('audioStart', { source }); },
      audioStop() { return request('audioStop'); },
      audioStats() { return input ? Object.assign({}, input.stats) : null; },
      playerStats() { return request('playerStats'); },
      /* Son gerçek karenin kopyası (ölçüm: tayftaki tepeler doğru yerde mi). */
      peekFrame() {
        if (!lastFrame) return null;
        return { freq: Array.from(lastFrame.freq), time: Array.from(lastFrame.time), sampleRate: lastFrame.sampleRate };
      },
    };
  }
})();
