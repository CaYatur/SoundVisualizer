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
    link: listeners(), linkEvent: listeners(), target: listeners(), pcShot: listeners(), pcUpload: listeners(), pcExport: listeners(), pcLive: listeners(), pcMeter: listeners(), pcError: listeners(), pcUpdates: listeners(), update: listeners(),
    config: listeners(), configPatch: listeners(), audio: listeners(), presets: listeners(),
    presetsDelta: listeners(), powerSource: listeners(), nowPlaying: listeners(), windowChrome: listeners(),
    showClock: listeners(), momentaryFx: listeners(), lyricsClock: listeners(), lyricsLib: listeners(), mdSprite: listeners(),
    texturesChanged: listeners(), mediaScrub: listeners(), exitHint: listeners(), tbar: listeners(),
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
  /* PC'den gelen PCM görüntüyü sürer ama yerel yakalama durumu "demo" kalıyordu. */
  let pcAudioUntil = 0;
  let pcAudioTimer = 0;
  function notePcPcm() {
    const fresh = pcAudioUntil > now();
    pcAudioUntil = now() + REAL_FRAME_TIMEOUT;
    /* Demo saati `state.source === 'demo'` iken de kare basıyor. PC sesi
       gelirken kaynak adı değişmezse demo, gerçek karelerin üstüne biner. */
    state.source = 'pc';
    if (!fresh) ev.audioStatus.emit({ source: 'pc', state: 'running' });
    clearTimeout(pcAudioTimer);
    pcAudioTimer = setTimeout(() => {
      if (pcAudioUntil > now()) return;
      if (state.source === 'pc') state.source = 'demo';
      ev.audioStatus.emit(state.audioStatus || { source: '', state: 'stopped' });
    }, REAL_FRAME_TIMEOUT + 40);
  }
  function pcAudioLive() { return pcAudioUntil > now(); }

  function onBinary(buf) {
    const h = M && M.readHeader(buf);
    if (!h || !input) { state.badBinary++; return; }
    if (h.type === M.TYPE_PCM) {
      const m = M.readPcm(buf);
      if (m) { input.pushPcm(m); if (m.source === 'pc') notePcPcm(); } else state.badBinary++;
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
  let appUpdate = null; // son bilinen yeni sürüm durumu (update/AppUpdate.kt)
  let systemDark = null; // cihazın gece kipi (uygulamadan; WebView'in prefers-color-scheme'i izlemiyor)
  const systemDarkEv = listeners();
  function onEvent(name, v) {
    if (name === 'backupProgress') {
      backupProgress.emit(v);
    } else if (name === 'uiMode') {
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
    } else if (name === 'linkState') {
      // PC bağlantısı (link/PcLink.kt): durum, kayıtlı ve ağda bulunan bilgisayarlar
      ev.link.emit(v);
    } else if (name === 'linkEvent') {
      ev.linkEvent.emit(v);
    } else if (name === 'updateState') {
      // Telefon uygulamasının yeni sürüm denetimi bitti (update/AppUpdate.kt)
      appUpdate = v || null;
      ev.update.emit(appUpdate);
    } else if (name === 'linkUpload') {
      // PC'ye dosya gönderiminin ilerlemesi (link/LinkUpload.kt)
      onUploadDone(v);
      ev.pcUpload.emit(v);
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
    if (!pcSongOn()) { ev.nowPlaying.emit(next); lookupLyrics(next); }
    if (typeof pcNowPlaying === 'function') pcNowPlaying(next);
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
  /* PC'nin bu parçaya bulduğu söz. Telefon kendi parçasını yollarken PC kitaplığı
     önce gelir; PC'de yoksa telefonun kitaplığı ve otomatik araması kalır. */
  let pcOwn = { items: [], title: '', artist: '' };
  function shownLyrics() {
    const LP = window.SVLinkPhone;
    if (!LP) return pcSongOn() ? [] : withAuto(lyricsItems || []);
    const pcItems = pcSongOn() && pcSong ? pcSong.items : pcOwn.items;
    return LP.lyricChoice({
      followPc: pcSongOn(),
      connected: pc.state === 'connected',
      audioSend,
      track: nowPlaying,
      pcTitle: pcSongOn() && pcSong && pcSong.np ? pcSong.np.title : pcOwn.title,
      pcArtist: pcSongOn() && pcSong && pcSong.np ? pcSong.np.artist : pcOwn.artist,
      pcItems,
      phoneItems: lyricsItems || [],
      phoneAuto: lyricsAuto,
    }).items;
  }
  function emitLyrics() { if (!pcSongOn()) ev.lyricsLib.emit(shownLyrics()); }
  function rememberPcLyrics(m) {
    if (!audioSend || pc.state !== 'connected' || !m || !m.np) return;
    pcOwn = { items: Array.isArray(m.items) ? m.items : [], title: m.np.title || '', artist: m.np.artist || '' };
    if (!pcSongOn()) ev.lyricsLib.emit(shownLyrics());
  }
  /* PC'NİN PARÇASI VE SÖZLERİ (PC bağlantısı): telefon PC'nin sahnesini çizerken söz katmanı ve
     Şimdi Çalıyor PC'de çalanı gösterir (PC'nin 'song' olayı / song.get). Telefonun kendi parçası
     o sırada saklanır; "Bu telefon"a dönünce geri gelir. */
  let pcSong = null;
  let pcSongNp = null;
  /* PC'nin parçası: hedef PC iken, ya da telefon PC'nin sesini kullanırken.
     "PC'ye gönder" açıkken telefonun kendi parçası kalır. wantsPcSong aşağıda kurulur. */
  let wantsPcSong = () => false;
  function pcSongOn() { try { return !!(wantsPcSong() && pcSong); } catch (e) { return false; } }
  /* SAAT FARKI: PC'nin damgaları (parça konumu, söz ve gösteri çıpası) PC'nin saatiyle. Telefonun
     saati ileri ya da geri olabilir; sözler o kadar önde ya da geride gidiyordu. Her iletideki
     `at` (PC'nin o anki saati) ile fark ölçülür, damgalar telefonun saatine çevrilir. Ağ gecikmesi
     farkı yalnız büyütür: en küçük ölçüm en doğrusu, eskiyenler yavaşça bırakılır. */
  let pcSkew = null;
  function noteSkew(at) {
    const a = Number(at);
    if (!(a > 0)) return;
    const d = Date.now() - a;
    pcSkew = pcSkew == null || d < pcSkew || Math.abs(d - pcSkew) > 2000 ? d : pcSkew + (d - pcSkew) * 0.05;
  }
  function toPhoneTime(o, keys) {
    if (!o || typeof o !== 'object' || !pcSkew) return o;
    const r = Object.assign({}, o);
    for (const k of keys) if (Number(r[k]) > 0) r[k] = Number(r[k]) + pcSkew;
    return r;
  }
  function syncLagMs(fromSong) {
    if (!pcIn.lossless || pcIn.syncDelay === false || audioSend) return 0;
    const n = Number(fromSong ? pc.watchDelayMs : pc.audioDelayMs) || 0;
    return n > 0 ? Math.min(2500, n) : 0;
  }
  function lagClock(clock, ms) {
    if (!clock || !ms) return clock;
    const o = Object.assign({}, clock);
    /* Çıpa `time + (now - epoch)`. İkisini birden kaydırmak gecikmeyi siler.
       Yalnız süre geri alınır; epoch duyulduğu an olarak kalır. */
    if (Number(o.time) > 0) o.time = Math.max(0, Number(o.time) - ms / 1000);
    return o;
  }
  function applyPcSong(s) {
    if (!wantsPcSong()) return;
    pcSong = s && typeof s === 'object' ? s : null;
    if (pcSong) {
      noteSkew(pcSong.at);
      pc.watchDelayMs = Math.max(0, Math.min(2500, Math.round(Number(pcSong.audioDelayMs) || 0)));
    }
    if (!pcSongOn()) return;
    const np = pcSong.np;
    const prevNp = pcSongNp;
    pcSongNp = np ? toPhoneTime(Object.assign({ has: !!np.title }, np, { received: Date.now() }), ['updated']) : { has: false, playing: false, title: '', artist: '', album: '', artwork: '', position: 0, duration: 0, received: Date.now() };
    /* Konum tazelenirken kapak yeniden gelmez. Boş kapak, aynı parçanın
       elimizdeki kapağını silmesin. */
    if (pcSongNp && pcSongNp.has && !pcSongNp.artwork && prevNp && prevNp.artwork && prevNp.title === pcSongNp.title && prevNp.artist === pcSongNp.artist) pcSongNp.artwork = prevNp.artwork;
    const lag = syncLagMs(true);
    if (lag && pcSongNp && pcSongNp.playing) {
      /* updated yerinde kalır: o anda duyulan konum, PC'nin konumundan `lag` kadar geridedir. */
      pcSongNp.position = Math.max(0, (Number(pcSongNp.position) || 0) - lag / 1000);
    }
    ev.nowPlaying.emit(pcSongNp);
    ev.lyricsLib.emit(shownLyrics());
    ev.lyricsClock.emit(lagClock(toPhoneTime(pcSong.clock, ['epoch']), lag) || null);
  }
  function restoreOwnSong() {
    pcSongNp = null;
    if (nowPlaying) ev.nowPlaying.emit(nowPlaying);
    ev.lyricsLib.emit(shownLyrics());
    ev.lyricsClock.emit(null);
  }
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
    let shown = cfg;
    try { shown = viewCfg() || cfg; } catch (e) { shown = cfg; }
    const phoneL = cfg && cfg.lyricsLookup;
    const shownL = shown && shown.lyricsLookup;
    /* Telefonun kendi söz ayarı yedek. Kapalıysa ekrandaki (PC) sahnenin ayarı. */
    const L = phoneL && phoneL.enabled === true ? phoneL : (shownL && shownL.enabled === true ? shownL : phoneL);
    const enabled = !!(L && L.enabled === true);
    const cs = enabled ? JSON.stringify(L) : '';
    if (cs !== lyricsCfgSig) {
      lyricsCfgSig = cs;
      lyricsSig = '';
      if (!enabled && lyricsAuto) { lyricsAuto = null; emitLyrics(); }
    }
    const follow = followsLyrics(shown) || followsLyrics(cfg);
    if (!enabled || !native || !follow || !st || !st.has || !st.title) return;
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
  /* DENETİM ÖNCELİĞİ (PC bağlantısı): hedef PC iken bir sayfa açıksa telefonun sahnesi yalnız
     arka plandaki önizleme; çizim 15 fps ile sınırlanır. Ölçüldü (emülatör, motor grafikte
     tıkanmışken ~16 fps): sayfa ile uygulama arası gidiş-dönüş p50 157 ms → 50 ms; Canlı
     sekmesinin düğmeleri ve kaydırıcıları bu yolu kullanıyor. Sayfa kapanınca normal hız. */
  const CONTROL_FPS = 15;
  let stageCovered = false;
  let controlFocus = false;
  function phonePower(p) {
    const out = Object.assign({}, p);
    const limit = MAX_RES[p.maxRes == null ? 720 : p.maxRes];
    const dpr = window.devicePixelRatio || 1;
    const short = Math.min(window.screen.width, window.screen.height) * dpr;
    if (limit && short > limit) out.renderScale = Math.max(0.4, (Number(p.renderScale) || 1) * (limit / short));
    if (stageCovered) out.fpsCap = COVERED_FPS;
    else if (controlFocus) out.fpsCap = out.fpsCap > 0 ? Math.min(out.fpsCap, CONTROL_FPS) : CONTROL_FPS;
    return out;
  }
  let sheetOpen = false;
  function setControlFocus(on) {
    if (on === controlFocus) return;
    controlFocus = on;
    if (config && config.power) ev.configPatch.emit({ power: phonePower(config.power) });
  }
  function setSheetOpen(on) {
    sheetOpen = !!on;
    setControlFocus(sheetOpen && !!(typeof pc !== 'undefined' && pc.on));
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

  /* İçe aktarma iki adım: dosya okunur (openImport), kullanıcı bölümleri seçer (applyImport).
     Dosya okunduğunda telefondaki hiçbir şey değişmemiştir. */
  let openedImport = null;
  async function openImport(opts) {
    if (!native || !P) throw new Error('native-missing');
    await profile.load();
    // Ayarlar okunamadıysa kayıt kapalı: içe aktarılan hiçbir şey yazılmazdı
    if (profile.state.readError) throw new Error('store-read');
    const r = await request(opts.media ? 'importOpen' : 'importPick', opts.media ? { media: String(opts.media) } : {});
    const B = window.SVBackupSections;
    if (r.kind === 'svbackup') {
      const b = P.readBackup(r.meta);
      if (b.error) { await request('importDiscard').catch(() => {}); throw new Error(b.error); }
      let extra = {};
      try { const m = JSON.parse(r.meta); extra = { phone: m.phone, partial: Array.isArray(m.sections) && m.sections.length < B.SECTIONS.length }; } catch (e) { /* readBackup doğruladı */ }
      openedImport = { r, b, incoming: b.settings, summary: b.summary, phone: extra.phone, partial: !!extra.partial };
    } else {
      let incoming;
      try { incoming = P.parseSettings(r.settings); } catch (e) { throw new Error('NOT_SETTINGS'); }
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw new Error('NOT_SETTINGS');
      openedImport = { r, b: null, incoming, summary: null, phone: null, partial: false };
    }
    return { kind: r.kind, summary: openedImport.summary, available: B.available(openedImport.incoming, openedImport.summary || {}) };
  }
  function discardImport() {
    if (!openedImport) return resolved(null);
    openedImport = null;
    return request('importDiscard').catch(() => null);
  }
  /* sections: seçilen bölümler; verilmezse yedekteki her şey (önceki davranış). */
  async function applyImport(sections) {
    const open = openedImport;
    if (!open) throw new Error('no-import');
    openedImport = null;
    const B = window.SVBackupSections;
    const all = !sections;
    const on = new Set(all ? B.SECTIONS : sections);
    const { r, b, summary } = open;
    let incoming = open.incoming;
    let committed = { presets: 0, textures: 0, skipped: 0 };
    if (b) {
      committed = await request('importCommit', {
        ids: on.has('presets') ? b.presetIds : [], textures: on.has('textures') ? b.textures : [],
        libs: ['logos', 'lyrics', 'videos'].filter((k) => on.has(k)).map((k) => (k === 'videos' ? 'media' : k)),
      });
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
    // Seçilmeyen bölümler telefondaki gibi kalır (göç edilmiş hâlleriyle birleşir)
    const cfg = adoptImported(all ? loaded.cfg : B.mergeSettings(config, loaded.cfg, Array.from(on), open.partial), committed.textures > 0);
    // Telefon yedeğindeki yerel tercihler (Dışa Aktar seçimleri, dil, sahne resimleri)
    const local = open.phone && open.phone.local;
    if (local && typeof local === 'object') {
      for (const k of Object.keys(local)) {
        if (B.localFor(k, Array.from(on)) && typeof local[k] === 'string') { try { localStorage.setItem(k, local[k]); } catch (e) { /* depo dolu */ } }
      }
    }
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
  async function importProfile(opts) {
    await openImport(opts);
    return applyImport(null);
  }

  /* DIŞA AKTARMA (store/BackupWriter.kt). Sahnelerdeki kitaplık dışı videolar adresleriyle gider. */
  function videoRefs(c) {
    const out = new Set();
    const seen = new Set();
    (function walk(v) {
      if (!v || typeof v !== 'object' || seen.has(v)) return;
      seen.add(v);
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v.source === 'file' && typeof v.file === 'string' && v.file) out.add(v.file);
      for (const k of Object.keys(v)) walk(v[k]);
    })(c);
    return Array.from(out);
  }
  const backupProgress = listeners();
  async function exportBackup(sections, opts) {
    if (!native || !P) throw new Error('native-missing');
    await profile.load();
    await profile.flush();
    const B = window.SVBackupSections;
    const rows = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); rows.push([k, localStorage.getItem(k)]); } } catch (e) { /* depo yok */ }
    const stamp = new Date().toISOString().slice(0, 10);
    return request('backupExport', Object.assign({
      sections, name: 'soundvisualizer-telefon-yedek-' + stamp + '.svbackup',
      settings: JSON.stringify(B.pickSettings(config, sections)), local: JSON.stringify(B.pickLocal(rows, sections)),
      refs: sections.indexOf('videos') >= 0 ? videoRefs(config) : [],
    }, opts || {}));
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

  /* ---- HEDEF: BU TELEFON YA DA PC (PC bağlantısı B2/B3, src/mobile/pc-remote.js) ----
     PC hedefindeyken düzenleyiciler aynı config.get/set/patch yolunu kullanır: okuma PC'nin ayar
     aynasından, yazım değişen anahtarlarla PC'ye. Telefonun kendi ayarına ve profiline dokunulmaz
     (yalnız arayüz teması telefonda kalır). Bağlantı koparsa telefon kendi kipine döner; seçim
     hatırlanır, bağlanınca yeniden PC'ye geçer. */
  const PR = () => window.SVPcRemote;
  const TARGET_KEY = 'sv-link-target';
  const pc = {
    on: false, wanted: false, cfg: null, rev: 0, writing: {}, name: '', state: 'idle', rtt: 0, standby: false,
    live: null, meter: null, drag: null, dragTimer: 0, finalTimer: 0, queue: Promise.resolve(), ping: 0, loading: false,
  };
  try { pc.wanted = localStorage.getItem(TARGET_KEY) === 'pc'; } catch (e) { pc.wanted = false; }
  const viewCfg = () => (pc.on && pc.cfg && PR() ? PR().view(pc.cfg, config) : config);
  const engineOf = (c) => engineView(pc.on && PR() ? localMedia(PR().engine(c, config)) : c);
  const pcEnginePatch = (p) => engineView(localMedia(PR().enginePatch(p)));
  /* PC'NİN VİDEOLARI (docs/PHONE-LINK.md "Videos"). PC'nin ayarındaki video adresi telefonda
     açılmaz; motora giden kopyada telefonun adresine çevrilir (pc-remote.js localizeMedia).
     Karşılık: telefonun kitaplığında aynı kimlik, telefondan PC'ye yollanmış video ya da
     uygulamanın `media.fetch` ile indirdiği kopya (link/LinkDownload.kt). Sahne listesindeki
     videolar çizilmez, indirilmez. */
  const MEDIA_ORIGIN = 'https://appassets.androidplatform.net/files/lib-media/';
  const pcMedia = { byId: {}, byRef: {}, loaded: false, busy: false, again: false, failed: {} };
  const uploadWait = new Map(); // gönderim anahtarı → { resolve, reject, url }
  function localMedia(v) { return PR() && PR().localizeMedia ? PR().localizeMedia(v, pcMedia) : v; }
  async function syncPcMedia() {
    if (!pc.on || !pc.cfg || !native || !PR() || !PR().missingMedia) return;
    if (pcMedia.busy) { pcMedia.again = true; return; }
    pcMedia.busy = true;
    try {
      if (!pcMedia.loaded) {
        pcMedia.loaded = true;
        const list = await request('libraryList', { key: 'media' }).catch(() => null);
        for (const it of Array.isArray(list) ? list : []) {
          if (it && it.id && it.file && !pcMedia.byId[it.id]) pcMedia.byId[it.id] = MEDIA_ORIGIN + encodeURIComponent(it.file);
        }
      }
      do {
        pcMedia.again = false;
        const drawn = Object.assign({}, pc.cfg, { scenes: null });
        const want = PR().missingMedia(drawn, pcMedia).filter((m) => !pcMedia.failed[m.id || m.file]);
        for (const m of want) {
          if (!pc.on) return;
          let r = null;
          try { r = await request('linkMediaFetch', { id: m.id, file: m.file }); } catch (e) { pcMedia.failed[m.id || m.file] = String((e && e.message) || 'failed'); }
          if (!r || !r.url) continue;
          if (m.id) pcMedia.byId[m.id] = r.url; else pcMedia.byRef[m.file] = r.url;
          if (pc.on) ev.config.emit(engineOf(viewCfg()));
        }
      } while (pcMedia.again && pc.on);
    } finally { pcMedia.busy = false; }
  }
  /* Telefonda seçilen video PC'ye: kitaplığa girer, kimliği döner. Katman telefonun adresi ve
     bu kimlikle yazılır; PC adresi kendi dosyasına çevirir (src/main/link-media.js). */
  function sendVideo(f) {
    if (!f || !f.uri) return Promise.reject(new Error('no-uri'));
    return request('linkUpload', { uri: f.uri, name: f.name || '', kind: 'video' }).then((r) => new Promise((resolve, reject) => {
      if (!r || !r.key) { reject(new Error('failed')); return; }
      uploadWait.set(r.key, { resolve, reject, url: f.url || '' });
    }));
  }
  function onUploadDone(u) {
    const w = u && uploadWait.get(u.key);
    if (!w || (u.state !== 'done' && u.state !== 'error' && u.state !== 'cancelled')) return;
    uploadWait.delete(u.key);
    const id = u.state === 'done' && u.result && u.result.id;
    if (!id) { w.reject(new Error(u.error || u.state)); return; }
    if (w.url) pcMedia.byId[id] = w.url;
    w.resolve(String(id));
  }
  function pcAsk(op, args) {
    const t0 = Date.now();
    return request('linkRequest', { op, args: args || {} }).then((r) => {
      pc.rtt = Date.now() - t0;
      const out = r || { ok: false, error: 'failed' };
      if (out.ok === false && op !== 'state.get') ev.pcError.emit({ op, error: out.error || 'failed', detail: out.detail || '' });
      return out;
    }, (e) => {
      const out = { ok: false, error: String((e && e.message) || 'failed') };
      ev.pcError.emit({ op, error: out.error, detail: '' });
      return out;
    });
  }
  function emitTarget() { ev.target.emit(targetInfo()); }
  function targetInfo() {
    return {
      target: pc.on ? 'pc' : 'phone', wanted: pc.wanted, name: pc.name, state: pc.state, rtt: pc.rtt, standby: pc.standby, loading: pc.loading,
      audioSend, preview: previewMode, usePcAudio, playPc, pcGain, audioIn: pcIn, level: pc.level || '', readOnly: readOnly(), undo: undoStack.length, error: pc.error || '',
    };
  }
  async function pcLoad() {
    pc.loading = true;
    emitTarget();
    const r = await pcAsk('config.get');
    pc.loading = false;
    if (!r.ok || !r.result || !r.result.config) { emitTarget(); return false; }
    pc.cfg = r.result.config;
    pc.srv = Object.assign({}, pc.cfg);
    pc.rev = Number(r.result.rev) || 0;
    pc.writing = {};
    pc.deferred = {};
    const st = await pcAsk('state.get');
    pc.standby = !!(st.ok && st.result && st.result.standby);
    /* SÜRÜM KİLİDİ (plan §3.4): PC'nin ayar biçimi telefonun bildiğinden yeniyse düzenleme kapalı,
       izleme ve canlı denetim açık. Eski telefon yeni PC ayarını bozmasın. */
    const mine = window.SV && window.SV.defaultConfig ? Number(window.SV.defaultConfig().docVersion) || 0 : 0;
    pc.docNewer = !!(st.ok && st.result && mine && Number(st.result.docVersion) > mine);
    const lv = await pcAsk('live.get');
    if (lv.ok && lv.result) { pc.live = lv.result.show || null; pc.meter = lv.result.meter || null; }
    return true;
  }
  async function setTarget(t) {
    const want = t === 'pc';
    pc.wanted = want;
    try { localStorage.setItem(TARGET_KEY, want ? 'pc' : 'phone'); } catch (e) { /* depo yok */ }
    if (!want) { leavePc(); return targetInfo(); }
    if (pc.state !== 'connected') { emitTarget(); return targetInfo(); }
    if (!(await pcLoad())) return targetInfo();
    pc.on = true;
    ev.config.emit(engineOf(viewCfg()));
    pcMedia.failed = {};
    syncPcMedia();
    pcAsk('song.get').then((r) => { if (r && r.ok && pc.on) { applyPcSong(r.result); if (r.result && r.result.show !== undefined) applyPcShow(r.result.show, r.result.at); } });
    schedulePcPresets();
    pcHeld = '';
    paintPcHeld();
    setControlFocus(sheetOpen);
    syncAudio();
    emitTarget();
    clearInterval(pc.ping);
    // Gecikme göstergesi ve yedek rolü: beş saniyede bir kısa özet
    pc.ping = setInterval(() => {
      if (!pc.on) return;
      pcAsk('state.get').then((r) => { if (r.ok && r.result) { pc.standby = !!r.result.standby; emitTarget(); } });
    }, 5000);
    return targetInfo();
  }
  function leavePc() {
    const was = pc.on;
    flushDrag(true);
    pc.on = false;
    setControlFocus(false);
    clearInterval(pc.ping);
    if (was) ev.config.emit(engineView(config));
    if (was) {
      // Telefonun kendi kipinde PC'nin basılı efektleri ve parçası kalmaz
      pcHeld = '';
      ev.momentaryFx.emit([]);
      ev.showClock.emit(ownShow);
      if (pcSong) { pcSong = null; songArmed = false; restoreOwnSong(); }
    }
    syncAudio();
    emitTarget();
  }
  function onLinkState(v) {
    const st = (v && v.state) || 'idle';
    pc.state = st;
    pc.error = (v && v.error) || '';
    if (v && v.pc && typeof v.pc === 'object') {
      if (v.pc.id) pc.id = String(v.pc.id);
      if (v.pc.name) pc.name = String(v.pc.name);
    }
    if (v && Number.isFinite(Number(v.audioDelayMs))) pc.audioDelayMs = Math.max(0, Math.min(2500, Math.round(Number(v.audioDelayMs))));
    const was = pc.lastState;
    pc.lastState = st;
    pc.level = (v && v.level) || pc.level || '';
    if (st !== 'connected' && pc.on) leavePc(); // PC'ye ulaşılamıyor: telefonun kendi kipi
    else if (st === 'connected' && pc.wanted && !pc.on) setTarget('pc');
    else emitTarget();
    // Bağlanınca "PC'ye gönder" kaldığı yerden; kopunca bilgisayarın sesi beklenmez
    if (st !== was && (st === 'connected' || was === 'connected')) {
      if (st !== 'connected') { watching = false; clearPcPresets(); }
      else schedulePcPresets();
      syncAudio();
    }
  }
  const evLog = []; // son ayar olayları (tanılama: sürüm ve anahtarlar)
  /* PC'de basılı anlık efektler (Canlı özeti `held`) telefonun çizdiği PC sahnesinde de görünür.
     Yalnız değişince motora gider. */
  /* Gösteri saati (zaman çizelgesi): PC hedefindeyken PC'nin çıpası; dönünce telefonunki. */
  let ownShow = null;
  function applyPcShow(anchor, at) {
    if (at) noteSkew(at);
    if (!pc.on) return;
    ev.showClock.emit(lagClock(toPhoneTime(anchor, ['epoch']), syncLagMs(true)) || null);
  }
  let pcHeld = '';
  function paintPcHeld() {
    if (!pc.on) return;
    const list = pc.live && Array.isArray(pc.live.held) ? pc.live.held.map(String) : [];
    const key = list.join(',');
    if (key === pcHeld) return;
    pcHeld = key;
    ev.momentaryFx.emit(list);
  }
  function onLinkEvent(m) {
    if (!m || !m.ev) return;
    if (m.ev === 'config') {
      evLog.push([m.rev, Object.keys(m.patch || {}).join(','), pc.rev]);
      if (evLog.length > 20) evLog.shift();
      if (!pc.cfg || !PR()) return;
      if (m.delta && typeof m.delta === 'object') {
        /* Büyük anahtarın farkı (PC json-delta): tabanı PC'nin bir önceki değeri. Uygulanamazsa
           (taban yok ya da sıra kaçtı) ayar baştan çekilir. */
        const J = window.SVJsonDelta;
        const patch = Object.assign({}, m.patch || {});
        for (const k of Object.keys(m.delta)) {
          const v = J && pc.srv && m.rev === pc.rev + 1 ? J.apply(pc.srv[k], m.delta[k]) : null;
          if (v == null) { pcLoad().then((ok) => { if (ok && pc.on) { ev.config.emit(engineOf(viewCfg())); syncPcMedia(); } }); return; }
          patch[k] = v;
        }
        m = Object.assign({}, m, { patch });
      }
      if (pc.srv && m.rev === pc.rev + 1) for (const k of Object.keys(m.patch || {})) pc.srv[k] = m.patch[k];
      const r = PR().applyEvent(pc, m, Date.now(), 600);
      if (r.refetch) { pcLoad().then((ok) => { if (ok && pc.on) { ev.config.emit(engineOf(viewCfg())); syncPcMedia(); } }); return; }
      if (r.stale) return;
      pc.cfg = r.cfg;
      pc.rev = r.rev;
      if (pc.on && Object.keys(r.patch).length) { ev.configPatch.emit(pcEnginePatch(r.patch)); syncPcMedia(); }
      if (pc.deferred) for (const k of r.superseded || []) delete pc.deferred[k];
      if (Object.keys(r.deferred).length) {
        pc.deferred = Object.assign(pc.deferred || {}, r.deferred);
        scheduleSettle();
      }
    } else if (m.ev === 'live') {
      pc.live = m.show || null;
      ev.pcLive.emit(pc.live);
      paintPcHeld();
    } else if (m.ev === 'song') {
      if (wantsPcSong()) applyPcSong(m);
      else rememberPcLyrics(m);
      if (m.show !== undefined) applyPcShow(m.show, m.at);
    } else if (m.ev === 'presets') {
      schedulePcPresets();
    } else if (m.ev === 'clock') {
      applyPcShow(m.anchor, m.at);
    } else if (m.ev === 'meter') {
      pc.meter = m.meter || null;
      ev.pcMeter.emit(pc.meter);
    } else if (m.ev === 'export') {
      ev.pcExport.emit(m.p || null);
    } else if (m.ev === 'updates') {
      // Bilgisayarın güncelleme durumu (salt okunur; kurulum PC'de)
      ev.pcUpdates.emit(m.state || null);
    }
  }
  /* ---- SES VE ÖNİZLEME (B4/B5) ----
     "PC'ye gönder": telefonun sesi (çalar, yakalama, mikrofon) bilgisayarın ses girişi olur; çalan
     parça ve kapak da gider. Önizleme (hedef PC iken): "akıcı" telefon PC'nin ayarını kendi
     motoruyla PC'nin sesiyle çizer; "gerçek" PC'nin gösterdiği kare (JPEG, saniyede ~4);
     "kapalı" PC'nin ayarı telefonun kendi sesiyle. Telefonun sesi PC'ye giderken akıcı kip
     telefonun kendi sesini kullanır (aynı ses; döngü olmasın). */
  const AUDIO_KEY = 'sv-link-audio';
  const PREVIEW_KEY = 'sv-link-preview';
  let audioSend = false;
  let previewMode = 'smooth';
  try { audioSend = localStorage.getItem(AUDIO_KEY) === '1'; } catch (e) { /* */ }
  try { const v = localStorage.getItem(PREVIEW_KEY); if (v === 'image' || v === 'off' || v === 'smooth') previewMode = v; } catch (e) { /* */ }
  let watching = false;
  let usePcAudio = false;
  try { usePcAudio = localStorage.getItem('sv-link-pc-audio') === '1'; } catch (e) { /* */ }
  let playPc = false;
  try { playPc = localStorage.getItem('sv-link-pc-play') === '1'; } catch (e) { /* */ }
  let pcIn = { known: false, enabled: false, play: false, fallback: true, delayMs: 0, gain: 1, lossless: false, syncDelay: true, state: '', name: '' };
  let songArmed = false;
  wantsPcSong = () => pc.state === 'connected' && !audioSend && (pc.on || usePcAudio || playPc);
  let pcGain = 1;
  try { const g = Number(localStorage.getItem('sv-link-pc-gain')); if (Number.isFinite(g)) pcGain = Math.max(0, Math.min(2, Math.round(g * 100) / 100)); } catch (e) { /* */ }
  let pcPresetSig = '';
  let pcPresetIds = [];
  let presetPullTimer = 0;
  let presetPullBusy = false;
  let presetPullAgain = false;
  function schedulePcPresets() {
    if (pc.state !== 'connected') return;
    clearTimeout(presetPullTimer);
    presetPullTimer = setTimeout(() => { presetPullTimer = 0; pullPcPresets(); }, 200);
  }
  function applyPcPresetList(items) {
    const S = window.SVPresets;
    if (!S || typeof S.setSession !== 'function') return;
    const sig = items.map((p) => String(p.id) + ':' + (p.updatedAt || 0) + ':' + String((p && (p.shader || p.source)) || '').length).join('\n');
    if (sig === pcPresetSig) return;
    pcPresetSig = sig;
    const prev = pcPresetIds;
    S.setSession(items);
    pcPresetIds = items.map((p) => String(p.id));
    const drop = prev.filter((id) => pcPresetIds.indexOf(id) < 0);
    ev.presetsDelta.emit({ upsert: items, remove: drop, gen: Date.now() });
  }
  function clearPcPresets() {
    clearTimeout(presetPullTimer);
    presetPullTimer = 0;
    pcPresetSig = '';
    const drop = pcPresetIds;
    pcPresetIds = [];
    const S = window.SVPresets;
    if (S && typeof S.setSession === 'function') S.setSession([]);
    if (drop.length) ev.presetsDelta.emit({ upsert: [], remove: drop, gen: Date.now() });
  }
  function pullPcPresets() {
    if (pc.state !== 'connected') return;
    if (presetPullBusy) { presetPullAgain = true; return; }
    presetPullBusy = true;
    pcAsk('presets.user', {}).then((r) => {
      presetPullBusy = false;
      if (pc.state !== 'connected') { clearPcPresets(); return; }
      const items = r && r.ok && r.result && Array.isArray(r.result.items) ? r.result.items : [];
      applyPcPresetList(items);
      if (presetPullAgain) { presetPullAgain = false; pullPcPresets(); }
    }, () => { presetPullBusy = false; });
  }
  function takeAudioIn(ai) {
    if (!ai || typeof ai !== 'object') return;
    const delay = Number(ai.delayMs);
    pcIn = {
      known: true,
      enabled: !!ai.enabled,
      play: ai.play === true,
      fallback: ai.fallback !== false,
      delayMs: Number.isFinite(delay) ? Math.max(0, Math.min(500, Math.round(delay))) : 0,
      gain: window.SVLinkPhone ? window.SVLinkPhone.clampGain(ai.gain == null ? 1 : ai.gain) : 1,
      lossless: ai.lossless === true,
      syncDelay: ai.syncDelay !== false,
      state: typeof ai.state === 'string' ? ai.state : '',
      name: typeof ai.name === 'string' ? ai.name : '',
    };
    request('linkAudioMode', { lossless: pcIn.lossless }).catch(() => {});
    if (Number.isFinite(Number(ai.audioDelayMs))) {
      const n = Math.max(0, Math.min(2500, Math.round(Number(ai.audioDelayMs))));
      if (n !== pc.watchDelayMs) {
        pc.watchDelayMs = n;
        if (pcSong) pcSong.audioDelayMs = n;
        if (wantsPcSong() && pcSong) applyPcSong(pcSong);
      }
    }
  }
  let shotTimer = 0;
  let shotBusy = false;
  function syncAudio() {
    const on = pc.state === 'connected';
    request('linkAudioSend', { on: on && audioSend }).catch(() => {});
    request('linkAudioGain', { gain: pcGain }).catch(() => {});
    if (on && audioSend) {
      const args = { on: true };
      if (pcIn.known) { args.play = pcIn.play; args.fallback = pcIn.fallback; args.delayMs = pcIn.delayMs; args.gain = pcIn.gain; args.lossless = pcIn.lossless; args.syncDelay = pcIn.syncDelay; }
      pcAsk('audio.bridge', args).then((r) => { if (r && r.ok && r.result) { takeAudioIn(r.result); emitTarget(); } pcNowPlaying(nowPlaying, true); });
    }
    /* Gönderim kapalıyken görüntü PC'nin sesini kullanır. Ekran görüntüsü
       önizlemesi motoru örtüyor; orada ham ses gerekmez. */
    const watch = !audioSend && pc.state === 'connected' && !(pc.on && previewMode !== 'smooth');
    if (watch !== watching) {
      watching = watch;
      request('linkAudioWatch', { on: watch }).catch(() => {});
      if (pc.state === 'connected') pcAsk('audio.watch', { on: watch });
    }
    request('linkAudioPlay', { on: !!(playPc && watch) }).catch(() => {});
    const follow = wantsPcSong();
    if (follow && !songArmed) {
      songArmed = true;
      pcAsk('song.get').then((r) => { if (r && r.ok && wantsPcSong()) applyPcSong(r.result); });
    } else if (!follow && songArmed) {
      songArmed = false;
      if (pcSong) { pcSong = null; restoreOwnSong(); }
    }
    clearInterval(shotTimer);
    shotTimer = 0;
    if (pc.on && previewMode === 'image') shotTimer = setInterval(pcShot, 250);
    else ev.pcShot.emit(null);
  }
  function pcShot() {
    if (shotBusy || !pc.on || document.visibilityState === 'hidden') return;
    shotBusy = true;
    pcAsk('preview.get').then((r) => {
      shotBusy = false;
      if (r && r.ok && r.result && r.result.jpeg && pc.on && previewMode === 'image') ev.pcShot.emit({ src: 'data:image/jpeg;base64,' + r.result.jpeg, width: r.result.width, height: r.result.height });
    });
  }
  /* PC'deki "Telefonun Sesini Ses Girişi Yap" anahtarı ile bu anahtar aynı şeyi söyler:
     bağlıyken PC'nin durumu beş saniyede bir okunur (state.get audioIn); PC'de açılınca telefon
     göndermeye başlar, kapanınca ya da başka telefon seçilince durur. */
  function followPcAudioIn(ai) {
    if (!ai || typeof ai !== 'object' || pc.state !== 'connected') return;
    takeAudioIn(ai);
    const want = ai.mine === true;
    if (want === audioSend || Date.now() - audioLocalAt < 8000) return; // telefondaki değişiklik PC'ye henüz yazılıyor
    audioSend = want;
    try { localStorage.setItem(AUDIO_KEY, audioSend ? '1' : '0'); } catch (e) { /* */ }
    syncAudio();
    emitTarget();
  }
  // Sınama ortamında (vm) zamanlayıcı yok: yalnız gerçek sayfada
  if (typeof setInterval === 'function') setInterval(() => {
    if (pc.state !== 'connected' || document.visibilityState === 'hidden' && !audioSend) return;
    pcAsk('state.get').then((r) => { if (r && r.ok && r.result) followPcAudioIn(r.result.audioIn); }, () => {});
  }, 5000);
  let audioLocalAt = 0;
  async function setAudioSend(on) {
    audioLocalAt = Date.now();
    audioSend = !!on;
    try { localStorage.setItem(AUDIO_KEY, audioSend ? '1' : '0'); } catch (e) { /* */ }
    if (!audioSend && pc.state === 'connected') await pcAsk('audio.bridge', { on: false });
    syncAudio();
    emitTarget();
    return targetInfo();
  }
  async function setAudioIn(patch) {
    audioLocalAt = Date.now();
    const args = Object.assign({ on: true, play: !!pcIn.play, fallback: pcIn.fallback !== false, delayMs: pcIn.delayMs || 0, gain: pcIn.gain == null ? 1 : pcIn.gain, lossless: !!pcIn.lossless, syncDelay: pcIn.syncDelay !== false }, patch || {});
    const r = await pcAsk('audio.bridge', args);
    if (r && r.ok && r.result) takeAudioIn(r.result);
    emitTarget();
    return targetInfo();
  }
  function setPreview(mode) {
    previewMode = mode === 'image' || mode === 'off' ? mode : 'smooth';
    try { localStorage.setItem(PREVIEW_KEY, previewMode); } catch (e) { /* */ }
    syncAudio();
    emitTarget();
    return targetInfo();
  }
  /* Çalan parça → PC (yalnız "PC'ye gönder" açıkken). Kapak küçülene kadar
     "gitti" sayılmaz; aksi halde bir sonraki parçaya kadar boş kalıyordu.
     Konum çalarken iki saniyede bir tazelenir: tek çıpa iki saati kaydırıyordu. */
  let npSent = { key: '', at: 0, playing: null, artKey: '' };
  function pcNowPlaying(np, force) {
    if (!audioSend || pc.state !== 'connected' || !np) return;
    const key = np.has ? np.title + '|' + np.artist + '|' + np.album : '';
    const now = Date.now();
    const needArt = !!(np.has && np.artwork && npSent.artKey !== key);
    if (!force && !needArt && key === npSent.key && np.playing === npSent.playing && now - npSent.at < 2000) return;
    const send = (art) => {
      const lag = pcIn.lossless && pcIn.syncDelay !== false ? (Number(pc.audioDelayMs) || 0) : 0;
      const age = np.playing && Number(np.updated) > 0 ? Math.max(0, Date.now() - Number(np.updated)) / 1000 : 0;
      const livePos = (Number(np.position) || 0) + age;
      const args = { has: !!np.has, title: np.title || '', artist: np.artist || '', album: np.album || '', position: Math.max(0, livePos - (np.playing ? lag / 1000 : 0)), duration: Number(np.duration) || 0, playing: !!np.playing, app: np.app || '' };
      if (art) args.artwork = art;
      npSent = { key, at: Date.now(), playing: np.playing, artKey: art ? key : (key === npSent.key ? npSent.artKey : '') };
      pcAsk('nowplaying.set', args).then((r) => { if (art && !(r && r.ok)) npSent.artKey = ''; }, () => { if (art) npSent.artKey = ''; });
    };
    const ship = () => {
      if (needArt) shrinkArt(np.artwork).then(send, () => { npSent.at = 0; });
      else send(null);
    };
    if (pcIn.lossless && pcIn.syncDelay !== false) {
      request('linkStatus').then((v) => {
        if (v && Number.isFinite(Number(v.audioDelayMs))) pc.audioDelayMs = Math.max(0, Math.min(2500, Math.round(Number(v.audioDelayMs))));
      }, () => {}).then(ship);
      return;
    }
    ship();
  }
  if (typeof setInterval === 'function') setInterval(() => {
    if (audioSend && nowPlaying && nowPlaying.playing) pcNowPlaying(nowPlaying);
  }, 2000);
  function shrinkArt(src) {
    return new Promise((resolve, reject) => {
      if (typeof Image === 'undefined' || typeof document === 'undefined' || !document.createElement) { reject(new Error('no-canvas')); return; }
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 512 / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * k));
        cv.height = Math.max(1, Math.round(img.height * k));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        let out = cv.toDataURL('image/jpeg', 0.8);
        if (out.length > 190 * 1024) out = cv.toDataURL('image/jpeg', 0.5);
        if (out.length > 190 * 1024) { reject(new Error('too-big')); return; }
        resolve(out);
      };
      img.onerror = () => reject(new Error('bad-image'));
      img.src = src;
    });
  }

  // Telefonun yazımı sürerken gelen PC değerleri: yazım durunca uygulanır
  let settleTimer = 0;
  function scheduleSettle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = 0;
      if (!pc.cfg || !PR()) return;
      const r = PR().settle(pc, Date.now(), 600);
      pc.cfg = r.cfg;
      pc.deferred = r.deferred;
      if (pc.on && Object.keys(r.patch).length) { ev.configPatch.emit(pcEnginePatch(r.patch)); syncPcMedia(); }
      if (Object.keys(r.deferred).length) scheduleSettle();
    }, 650);
  }
  ev.link.add(onLinkState);
  ev.linkEvent.add(onLinkEvent);
  /* Açılışta durum: uygulama kayıtlı bilgisayara sayfa kurulmadan bağlanmış olabilir (olay
     kaçmış olur). Kabuk hedefi ilk sorduğunda bir kez okunur. */
  function syncLink() {
    if (pc.synced || !native) return;
    pc.synced = true;
    request('linkStatus').then(onLinkState).catch(() => { pc.synced = false; });
  }

  /* Yazım: sürüklerken (patch) saniyede en çok ~16 ara yama, son dokunuştan 350 ms sonra
     kesin yazım (final). Sahne işlemleri sırayla. */
  /* Düzenleme kapalı mı: PC'nin ayarı daha yeni biçimde ya da cihazın düzeyi düzenlemenin altında
     (izle/kumanda). O zaman yazım yollanmaz; düzenleyici PC'nin değerine geri çizilir ve bir kez
     söylenir. Eskiden kumanda düzeyinde kaydırıcı sürüklemek saniyede ~16 reddedilen yama ve her
     biri için bildirim demekti. */
  function readOnly() {
    if (pc.docNewer) return 'doc-newer';
    const lv = pc.level || '';
    return lv && lv !== 'edit' && lv !== 'full' ? 'not-allowed' : '';
  }
  let roNoted = 0;
  /* GERİ AL (plan §4.4): telefonun son 20 kesin yazımının ters yaması. */
  const undoStack = [];
  function pushUndo(prev) {
    undoStack.push(prev);
    if (undoStack.length > 20) undoStack.shift();
    emitTarget();
  }
  function undoLast() {
    const prev = undoStack.pop();
    emitTarget();
    if (!prev || !pc.on || readOnly()) return false;
    pc.cfg = Object.assign({}, pc.cfg, prev);
    ev.config.emit(engineOf(viewCfg()));
    serial('config.patch', { patch: prev, final: true });
    return true;
  }
  function pcWrite(next, final) {
    const d = PR().diff(viewCfg(), next);
    if (Object.keys(d.local).length) patchConfig(d.local); // tema telefonun: kilitliyken de
    const ro = readOnly();
    if (ro && (Object.keys(d.patch).length || d.ops.length || d.apply)) {
      const t = Date.now();
      if (t - roNoted > 4000) { roNoted = t; ev.pcError.emit({ op: 'config.patch', error: ro, detail: '' }); }
      // Sahne çağırmak kumanda işi: kilitliyken de olur
      if (d.apply) serial('scene.apply', { id: d.apply });
      ev.config.emit(engineOf(viewCfg()));
      return;
    }
    if (final && Object.keys(d.patch).length) {
      const prev = {};
      for (const k of Object.keys(d.patch)) prev[k] = pc.cfg[k] === undefined ? null : JSON.parse(JSON.stringify(pc.cfg[k]));
      pushUndo(prev);
    }
    const keys = Object.keys(d.patch);
    if (keys.length) {
      const t = Date.now();
      for (const k of keys) pc.writing[k] = t;
      pc.cfg = Object.assign({}, pc.cfg, d.patch);
      ev.configPatch.emit(pcEnginePatch(d.patch));
      syncPcMedia();
      pc.drag = Object.assign(pc.drag || {}, d.patch);
      if (final) flushDrag(true);
      else {
        if (!pc.dragTimer) pc.dragTimer = setTimeout(() => { pc.dragTimer = 0; flushDrag(false); }, 60);
        clearTimeout(pc.finalTimer);
        pc.finalTimer = setTimeout(() => flushDrag(true), 350);
      }
    }
    if (d.apply) serial('scene.apply', { id: d.apply });
    for (const o of d.ops) serial(o.op, o.args);
  }
  let dragSent = {};
  function flushDrag(final) {
    if (final) { clearTimeout(pc.finalTimer); pc.finalTimer = 0; clearTimeout(pc.dragTimer); pc.dragTimer = 0; }
    const p = pc.drag;
    if (final) {
      // Kesin yazım: sürükleme boyunca değişen bütün anahtarların son hâli
      const all = Object.assign({}, dragSent, p || {});
      dragSent = {};
      pc.drag = null;
      if (!Object.keys(all).length) return;
      const out = {};
      for (const k of Object.keys(all)) out[k] = pc.cfg[k];
      serial('config.patch', { patch: out, final: true });
      return;
    }
    if (!p) return;
    pc.drag = null;
    Object.assign(dragSent, p);
    sendPatch({ patch: p, final: false });
  }
  function serial(op, args) {
    pc.queue = pc.queue.then(() => (op === 'config.patch' ? sendPatch(args) : pcAsk(op, args))).catch(() => {});
    return pc.queue;
  }
  /* AYAR YAZIMI: büyük zaman çizelgesi bütün olarak değil, PC'nin son onayladığı değerden farkla
     gider (timeline.apply, json-delta.js). PC uygulayamazsa ('stale', eski PC'de 'unknown-op')
     bütün değer gider. Bir klibi kaydırmak 550 KB yerine birkaç yüz bayt; büyük çizelge bağlantı
     sınırına takılmaz. */
  const DELTA_MIN = 32 * 1024;
  function sendPatch(args) {
    const J = window.SVJsonDelta;
    const p = args && args.patch;
    if (!J || !p || p.timeline === undefined || !pc.srv || pc.srv.timeline == null) return pcAsk('config.patch', args);
    const whole = J.size(p.timeline);
    if (whole < DELTA_MIN) return pcAsk('config.patch', args);
    const ops = J.diff(pc.srv.timeline, p.timeline);
    if (!ops || J.size(ops) * 2 >= whole) return pcAsk('config.patch', args);
    const rest = Object.assign({}, p);
    delete rest.timeline;
    const first = Object.keys(rest).length ? pcAsk('config.patch', Object.assign({}, args, { patch: rest })) : Promise.resolve({ ok: true });
    return first.then(() => (ops.length ? pcAsk('timeline.apply', { ops, final: args.final !== false }) : { ok: true })).then((r) => {
      if (r && r.ok) return r;
      return pcAsk('config.patch', Object.assign({}, args, { patch: { timeline: p.timeline } }));
    });
  }

  window.SVAndroid = Object.freeze({
    config: Object.freeze({
      get: () => viewCfg(),
      set: (c) => (pc.on ? pcWrite(c, true) : setConfig(c)),
      patch: (p) => (pc.on ? pcWrite(Object.assign({}, viewCfg(), p), false) : patchConfig(p)),
      flush: () => { if (pc.on) flushDrag(true); return profile.flush(); },
      ready: () => profile.load(),
      /** Telefonun kendi ayarı (hedef PC iken de): tema, güç ve ses seçimi gibi telefona ait şeyler */
      local: () => config,
    }),
    /* Hedef: 'phone' ya da 'pc' (PC bağlantısı). Canlı sayfası PC'nin canlı özetini okur ve
       kumanda işlemlerini doğrudan yollar (docs/PHONE-LINK.md "Operations"). */
    target: Object.freeze({
      get: () => { syncLink(); return targetInfo(); },
      set: (t) => setTarget(t),
      onChange: (cb) => ev.target.add(cb),
    }),
    pc: Object.freeze({
      request: (op, args) => pcAsk(op, args),
      live: () => pc.live,
      meter: () => pc.meter,
      onLive: (cb) => ev.pcLive.add(cb),
      onMeter: (cb) => ev.pcMeter.add(cb),
      onError: (cb) => ev.pcError.add(cb),
      /** Basılı anlık efektler (Canlı sekmesi). Kira uygulamada yenilenir; basılıyken saniyede bir çağrılmalı. */
      hold: (list) => request('linkHeld', { list: Array.isArray(list) ? list : [] }),
      /** "PC'ye gönder": telefonun sesi ve çalan parçası bilgisayarın girişi (tam düzey) */
      audioSend: (on) => setAudioSend(on),
      /** Önizleme kipi: 'smooth' | 'image' | 'off' */
      preview: (mode) => setPreview(mode),
      /** "Gerçek görüntü" karesi: { src, width, height } ya da null */
      onShot: (cb) => ev.pcShot.add(cb),
      /** Telefonun kendi çizimi PC'nin T-bar karışımını izlesin (arm / move / end / cancel). */
      tbarLocal: (m) => { if (m && m.phase) ev.tbar.emit(m); },
      /** Hedef "Bu telefon"ken telefonun sahnesi PC'nin sesiyle sürülsün mü */
      usePcAudio: (on) => { usePcAudio = !!on; try { localStorage.setItem('sv-link-pc-audio', usePcAudio ? '1' : '0'); } catch (e) { /* */ } syncAudio(); emitTarget(); return targetInfo(); },
      /** PC'de çalan sesi telefonun hoparlöründen de çal. Gönderim açıkken kapalı kalır. */
      playPcAudio: (on) => { playPc = !!on; try { localStorage.setItem('sv-link-pc-play', playPc ? '1' : '0'); } catch (e) { /* */ } syncAudio(); emitTarget(); return targetInfo(); },
      playPcGain: (v) => {
        pcGain = window.SVLinkPhone ? window.SVLinkPhone.clampGain(v) : 1;
        try { localStorage.setItem('sv-link-pc-gain', String(pcGain)); } catch (e) { /* */ }
        request('linkAudioGain', { gain: pcGain }).catch(() => {});
        emitTarget();
        return targetInfo();
      },
      /** PC'deki telefon sesi ayarları: hoparlör, yedek giriş, görüntü gecikmesi. */
      audioIn: (patch) => setAudioIn(patch),
      /** Telefonun son PC değişikliğini geri al (en çok 20) */
      undo: () => undoLast(),
      /** PC'ye dosya: önce seçici (kind: video | logo | lyrics | milk | audio), sonra gönderim */
      pick: (kind) => request('linkPick', { kind }),
      upload: (file, kind) => request('linkUpload', { uri: file.uri, name: file.name || '', kind }),
      /** Telefonda seçilen videoyu PC'nin kitaplığına yollar; bitince PC'deki kimlik (katmanın `libraryId`'si). */
      sendVideo: (file) => sendVideo(file),
      cancelUpload: (key) => request('linkUploadCancel', { key }),
      onUpload: (cb) => ev.pcUpload.add(cb),
      onExport: (cb) => ev.pcExport.add(cb),
      /** Bilgisayarın güncelleme durumu (değişince `updates` olayıyla da gelir) */
      onUpdates: (cb) => ev.pcUpdates.add(cb),
      /** Telefonun KENDİ ayarına yazar (hedef PC iken de; ör. PC'deki sahneyi telefona kopyalamak) */
      copyToPhone: (c) => { if (!c || typeof c !== 'object') return; config = c; profile.save(c); if (!pc.on) ev.config.emit(engineView(c)); },
      /** Tanılama (sınama betikleri): aynanın sürümü, bekleyen ve yazılan anahtarlar, son olaylar */
      debug: () => ({ rev: pc.rev, deferred: Object.keys(pc.deferred || {}), writing: pc.writing, events: evLog.slice(), on: pc.on }),
    }),
    /* Çalan parça: uygulama içi çalar ya da (bildirim erişimiyle) başka uygulamalar. */
    /* PC bağlantısı (docs/PHONE-LINK.md). Ağ, şifreleme ve anahtarlar uygulamada; sayfa yalnız
       durumu görür ve istek yollar. */
    link: Object.freeze({
      status: () => request('linkStatus'),
      pairQr: (qr) => request('linkPairQr', { qr }),
      pairCode: (host, port, code) => request('linkPairCode', { host, port, code }),
      connect: (pc) => request('linkConnect', { pc }),
      disconnect: () => request('linkDisconnect'),
      cancel: () => request('linkDisconnect'),
      forget: (pc) => request('linkForget', { pc }),
      setAuto: (pc, on) => request('linkAuto', { pc, on: !!on }),
      request: (op, args) => request('linkRequest', { op, args: args || {} }),
      discover: (on) => request('linkDiscover', { on: !!on }),
      qrFrame: (w, h, data) => request('linkQrFrame', { w, h, data }),
      onState: (cb) => ev.link.add(cb),
      onEvent: (cb) => ev.linkEvent.add(cb),
    }),
    nowPlaying: Object.freeze({
      current: () => (pcSongOn() && pcSongNp ? pcSongNp : nowPlaying),
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
      status: () => (pcAudioLive() ? { source: 'pc', state: 'running' } : state.audioStatus),
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
    /** Kabukta bir sayfa açık mı (denetim önceliği, yalnız hedef PC iken etkili) */
    setSheetOpen,
    /** Cihaz koyu kipte mi; uygulama henüz bildirmediyse null. */
    systemDark: () => systemDark,
    onSystemDark: (cb) => systemDarkEv.add(cb),
    onInsets: (cb) => ev.insets.add(cb),
    onBack: (cb) => ev.back.add(cb),
    onChrome: (cb) => ev.chrome.add(cb),
    onMeter: (cb) => ev.meter.add(cb),
    onLowPower: (cb) => { ev.lowPower.add(cb); if (lowPowerOn != null) cb(lowPowerOn); },
    app: Object.freeze({ toBackground: () => request('appToBack') }),
    /* Yeni sürüm uyarısı (PLAN K13): denetim uygulamada, sayfa adres vermez. Uygulama kendini
       kurmaz; open() sürüm sayfasını tarayıcıda açar. Durum: { status: idle|available|latest|
       none|error, current, latest?, name?, notes?, url?, skipped?, error?, mode, checkedAt, checking } */
    updates: Object.freeze({
      state: () => (native ? request('updateState').then((v) => { appUpdate = v || appUpdate; return appUpdate; }) : resolved(null)),
      last: () => appUpdate,
      /** Kendiliğinden denetim (zamanı geldiyse; kip kapalıysa ağa çıkmaz) */
      auto: () => (native ? request('updateCheck', { manual: false }) : resolved(null)),
      check: () => request('updateCheck', { manual: true }),
      setMode: (mode) => request('updateMode', { mode: mode === 'off' ? 'off' : 'notify' }),
      skip: () => request('updateSkip'),
      /** Bu sürümün bildirimi gösterildi (sürüm başına bir kez; uygulamada kalıcı) */
      told: (version) => request('updateTold', { version: String(version || '') }),
      open: () => request('updateOpen'),
      onChange: (cb) => ev.update.add(cb),
    }),
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
    /* Bölüm bölüm yedek: dışa aktarma ve seçerek geri yükleme (src/mobile/shell-backup.js). */
    backup: Object.freeze({
      plan: () => request('backupPlan', { refs: videoRefs(config || {}) }),
      exportTo: (sections, opts) => exportBackup(sections, opts),
      onProgress: (cb) => backupProgress.add(cb),
      open: (opts) => openImport(opts || {}),
      apply: (sections) => applyImport(sections),
      discard: () => discardImport(),
    }),
    /* Telefondan MilkDrop presetleri (.milk, .milk2; Faz 4): Android'in dosya seçicisi,
       birden çok dosya. { added, duplicates, invalid, skipped }; vazgeçilirse 'cancelled'. */
    presets: Object.freeze({ importMilk: () => importMilk() }),
    onMemoryPressure: (cb) => ev.memory.add(cb),
    /* Zaman çizelgesinin gösteri saati çıpası (src/shared/showclock.js). Masaüstünde
       panel `sendShowClock` ile pencerelere yollar; burada motor aynı sayfada, olay
       doğrudan `api.onShowClock` dinleyicisine gider (src/mobile/shell-timeline.js). */
    // Telefonun kendi gösteri saati; PC hedefindeyken motor PC'nin saatini izler (applyPcShow)
    showClock: (anchor) => { ownShow = anchor || null; if (!pc.on) ev.showClock.emit(anchor); },
  });

  window.SV_PLATFORM = Object.freeze({ os: 'android', isWindows: false, isMac: false, isLinux: false, isAndroid: true });
  window.SV_DISPLAY_ID = null;
  window.SV_SHARED_EPOCH = null;
  window.SV_FLOATING = false;

  /* HOST.md'deki tablo, aynı sırayla. */
  window.api = {
    requestConfig: () => profile.load().then(() => engineOf(viewCfg())),
    onConfig: (cb) => ev.config.add(cb),
    onConfigPatch: (cb) => ev.configPatch.add(cb),
    onShowClock: (cb) => ev.showClock.add(cb),
    // Telefonun kendi kipinde anlık efekt yok (D6); PC hedefindeyken PC'de basılı olanlar (paintPcHeld)
    onMomentaryFx: (cb) => ev.momentaryFx.add(cb),
    onMediaScrub: (cb) => ev.mediaScrub.add(cb),
    onTbar: (cb) => ev.tbar.add(cb),
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
    /* Masaüstü yedeğinden gelen logo kitaplığı (store/LibraryRestore.kt).
       PC hedefindeyken kimlik PC kitaplığındadır; yerelde bayt yoksa
       bağlantıdan istenir. Ayarın içine data URL yazılmaz. */
    logoLibRead: (id) => {
      const local = native ? request('logoLibRead', { id }).catch(() => null) : resolved(null);
      return Promise.resolve(local).then((rec) => {
        if (rec && rec.b64) return rec;
        if (!pc.on) return rec || null;
        return pcAsk('logo.get', { id }).then((r) => (r && r.ok && r.result && r.result.b64 ? r.result : (rec || null)));
      });
    },
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
