/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Çalan parça — işletim sisteminin medya oturumunu ekrana taşır.
 *
 * SORUN: Windows'un medya oturumu (SMTC) konumu SÜREKLİ saymaz. Ölçtük:
 * altı ardışık yoklamada `position` beş kez 91.209 olarak sabit kaldı, sonra
 * bir anda 100.874'e sıçradı. Yani kaynak, konumu yalnızca ara sıra günceller
 * ve yanına o güncellemenin ZAMAN DAMGASINI koyar. Gelen sayıyı olduğu gibi
 * yazsaydık süre ekranda donar, sonra on saniye ileri zıplardı.
 *
 * ÇÖZÜM: gelen her örnek bir ÇIPA'dır ({ position, updated }). O andaki konum
 * çıpadan kapalı formülle hesaplanır: position + (now - updated). Gerçek
 * veriyle doğrulandı — 91.2096 + 9.665 sn = 100.875, kaynağın bir sonraki
 * örnekte bildirdiği 100.874 ile örtüşüyor. Bu, gösteri saatinin
 * (bkz. src/shared/showclock.js) aynı deseni; orada olduğu gibi burada da
 * periyodik mesaja gerek kalmıyor ve pencereler arasında kayma olmuyor.
 *
 * Bu dosya SAF tutuldu: ne IPC ne çizim bilir, yalnızca aritmetik ve metin.
 * Böylece Node'da saat enjekte edilerek sınanabiliyor
 * (bkz. tests/nowplaying.test.js).
 */
(function () {
  function num(v, fallback) {
    v = Number(v);
    return isFinite(v) ? v : fallback;
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // Oturum yokken kullanılan boş durum
  const EMPTY = {
    has: false, playing: false, title: '', artist: '', album: '', app: '',
    position: 0, duration: 0, updated: 0, received: 0,
  };

  /* Parça kimliği.
     Yalnızca başlığa bakmak yetmez: canlı yayınlarda başlık parça
     değişmeden değişir, bazı uygulamalar da iki parça arasında bir kare
     boyunca alanları boşaltır. Başlık + sanatçı + süre üçlüsü bu iki
     durumu da eliyor. */
  function trackKey(st) {
    if (!st || !st.has) return '';
    const t = (st.title || '').trim();
    const a = (st.artist || '').trim();
    if (!t && !a) return '';
    // Süre saniyeye yuvarlanır; kaynak ondalıkta oynayabiliyor
    return t + '\u0000' + a + '\u0000' + Math.round(num(st.duration, 0));
  }

  const isSameTrack = (a, b) => trackKey(a) === trackKey(b) && trackKey(a) !== '';

  /* Çıpanın damgası her zaman güvenilir değil: bazı kaynaklar sıfır, bazıları
     gelecekte bir zaman veriyor. Böyle durumda örneğin BİZE ULAŞTIĞI an
     çıpa kabul edilir — en fazla bir yoklama aralığı kadar yanılır. */
  function anchorMs(st, nowMs) {
    const up = num(st.updated, 0);
    const rec = num(st.received, 0) || nowMs;
    if (!(up > 0)) return rec;
    if (up > nowMs + 5000) return rec;        // gelecekten gelen damga
    if (nowMs - up > 3600000) return rec;     // bir saatten eski damga
    return up;
  }

  /* O andaki konum (saniye). Duruyorsa çıpanın konumu; çalıyorsa çıpadan bu
     yana geçen gerçek süre kadar ileri. */
  function positionAt(st, nowMs) {
    if (!st || !st.has) return 0;
    const base = Math.max(0, num(st.position, 0));
    if (!st.playing) return base;
    const dt = (num(nowMs, 0) - anchorMs(st, num(nowMs, 0))) / 1000;
    const p = base + Math.max(0, dt);
    const dur = num(st.duration, 0);
    // Süre biliniyorsa sonunu aşma; bilinmiyorsa (canlı yayın) serbest say
    return dur > 0 ? Math.min(p, dur) : p;
  }

  /* Çizim için türetilmiş tam durum. */
  function resolve(st, nowMs) {
    const s = st || EMPTY;
    const dur = Math.max(0, num(s.duration, 0));
    const pos = positionAt(s, nowMs);
    return {
      has: !!s.has,
      playing: !!s.playing,
      title: s.title || '',
      artist: s.artist || '',
      album: s.album || '',
      app: s.app || '',
      position: pos,
      duration: dur,
      remaining: dur > 0 ? Math.max(0, dur - pos) : 0,
      progress: dur > 0 ? clamp(pos / dur, 0, 1) : 0,
      live: s.has && dur <= 0, // süresi bilinmeyen kaynak (canlı yayın)
    };
  }

  /* "3:24", bir saati geçince "1:02:05". Eksi değerler başında işaretle. */
  function fmtTime(sec) {
    let v = num(sec, 0);
    const neg = v < 0;
    if (neg) v = -v;
    v = Math.floor(v);
    const h = Math.floor(v / 3600);
    const m = Math.floor((v % 3600) / 60);
    const s = v % 60;
    const two = (n) => (n < 10 ? '0' + n : String(n));
    const body = h > 0 ? h + ':' + two(m) + ':' + two(s) : m + ':' + two(s);
    return (neg ? '-' : '') + body;
  }

  /* Hız kademeleri. Kullanıcı "hızlı/yavaş" seçer; süreler buradan gelir.
     Ayrı ayrı sayı girmek zorunda kalmasın diye. */
  const SPEEDS = {
    fast:   { anim: 0.28, hold: 2.5 },
    normal: { anim: 0.50, hold: 4.0 },
    slow:   { anim: 0.90, hold: 7.0 },
  };
  const speedOf = (name) => SPEEDS[name] || SPEEDS.normal;

  /* Görünüm kalıpları. Tek bir çizici var; kalıp yalnızca varsayılan
     DEĞERLERİ değiştiriyor, ayrı bir kod yolu açmıyor. Kullanıcı istediği
     tek tek ayarı yine de ezebiliyor. */
  const STYLES = {
    // İnce, kontursuz, yumuşak gölgeli, geniş harf aralıklı
    modern: {
      weight: 600, outline: 0, shadow: 0.55, uppercase: false,
      letterSpacing: 0.04, barHeight: 0.005, barRadius: true,
      barSegments: 0, barBackOpacity: 0.22, dimOpacity: 0.72,
    },
    // Winamp/MilkDrop dönemi: kalın, sert siyah kontur, bölmeli çubuk
    og: {
      weight: 800, outline: 0.35, shadow: 0.25, uppercase: true,
      letterSpacing: 0.02, barHeight: 0.011, barRadius: false,
      barSegments: 40, barBackOpacity: 0.35, dimOpacity: 0.85,
    },
  };
  const styleOf = (name) => STYLES[name] || STYLES.modern;

  /* Görünürlük zarfı.
     'always' — hep görünür.
     'onChange' — parça değişince belirir, bir süre durur, sonra söner.
     Kullanıcının istediği buydu: sabit yazı yerine yalnızca sıradaki
     şarkıya geçince canlandırmalı görünen bir bilgi. */
  function envelope(ageSec, opts) {
    const o = opts || {};
    if (o.mode !== 'onChange') return { alpha: 1, phase: 'in', k: 1 };
    const sp = speedOf(o.speed);
    const anim = Math.max(0.05, num(o.animDuration, sp.anim));
    const hold = Math.max(0, num(o.holdSeconds, sp.hold));
    const age = Math.max(0, num(ageSec, 0));
    if (age < anim) return { alpha: age / anim, phase: 'in', k: age / anim };
    if (age < anim + hold) return { alpha: 1, phase: 'hold', k: 1 };
    const out = age - anim - hold;
    if (out < anim) return { alpha: 1 - out / anim, phase: 'out', k: 1 };
    return { alpha: 0, phase: 'done', k: 1 };
  }

  /* Çizilecek metin parçaları. Hangi alanın görüneceğine buradaki bayraklar
     karar verir — kullanıcı yalnızca şarkı adını ya da yalnızca dakikayı
     gösterebilsin diye her alan tek tek açılıp kapanıyor. */
  /* BÜYÜK HARF parçanın diline göre (#536). Her zaman Türkçe kural
     İngilizce bir başlıkta "Mind"ı "MİND" yapıyordu; her zaman genel kural
     Türkçe "istanbul"u "ISTANBUL" yapardı. Türkçeye özgü harf varsa Türkçe,
     yoksa genel kural. */
  const TR_CHARS = /[çğıöşüÇĞİÖŞÜ]/;
  function upper(s) {
    const t = String(s);
    return TR_CHARS.test(t) ? t.toLocaleUpperCase('tr') : t.toUpperCase();
  }

  function compose(state, cfg) {
    const c = cfg || {};
    const show = c.show || {};
    const on = (k, def) => (show[k] === undefined ? !!def : !!show[k]);
    const st = state || resolve(EMPTY, 0);
    const up = (s) => (c.uppercase ? upper(s) : String(s));

    const title = on('title', true) && st.title ? up(st.title) : '';
    const artist = on('artist', true) && st.artist ? up(st.artist) : '';
    const album = on('album', false) && st.album ? up(st.album) : '';
    const app = on('appName', false) && st.app ? up(prettyApp(st.app)) : '';

    const parts = [];
    if (on('elapsed', true)) parts.push(fmtTime(st.position));
    if (on('remaining', false)) parts.push('-' + fmtTime(st.remaining));
    if (on('total', true) && !st.live) parts.push(fmtTime(st.duration));
    const sep = c.timeSeparator === undefined ? ' / ' : String(c.timeSeparator);

    return {
      title, artist, album, app,
      time: parts.join(sep),
      elapsed: fmtTime(st.position),
      remaining: '-' + fmtTime(st.remaining),
      total: fmtTime(st.duration),
      progress: st.progress,
      showBar: on('bar', true) && !st.live,
      hasText: !!(title || artist || album || app),
      hasTime: parts.length > 0,
    };
  }

  /* Kaynak uygulamanın kimliği ham geliyor:
     "music.youtube.com-5929F88E_vezhnr0wkvrcy!App". Ekranda göstermeye
     değecek kısmı ayıklıyoruz. */
  function prettyApp(id) {
    let s = String(id || '');
    s = s.split('!')[0];          // "!App" ekini at
    s = s.replace(/_[a-z0-9]+$/i, ''); // yayıncı karması
    s = s.replace(/-[0-9A-F]{8}$/i, '');
    s = s.replace(/\.exe$/i, '');
    return s;
  }

  /* Gelen örnekleri izleyip parça değişimini bildirir.
     Boş kare koruması: kaynak iki parça arasında alanları bir an boşaltırsa
     ya da oturumu kısa süreliğine kaybederse, hemen "parça bitti" demeyip
     son bilineni `graceMs` kadar tutuyoruz. Aksi halde her geçişte sahte bir
     canlandırma tetiklenirdi. */
  class Tracker {
    constructor(opts) {
      const o = opts || {};
      this.graceMs = num(o.graceMs, 1500);
      this.state = EMPTY;
      this.key = '';
      this.changedAt = 0;
      this.blankSince = 0;
    }

    /* Yeni örneği işler. Dönen: { state, changed } */
    update(sample, nowMs) {
      const now = num(nowMs, 0);
      const st = sample || EMPTY;
      const key = trackKey(st);

      if (!key) {
        // Boş örnek: hemen silme, önce hoşgörü süresini bekle
        if (!this.key) return { state: this.state, changed: false };
        if (!this.blankSince) this.blankSince = now;
        if (now - this.blankSince < this.graceMs) {
          return { state: this.state, changed: false };
        }
        this.state = EMPTY;
        this.key = '';
        this.blankSince = 0;
        return { state: this.state, changed: false };
      }

      this.blankSince = 0;
      const changed = key !== this.key;
      if (changed) {
        this.key = key;
        this.changedAt = now;
      }
      this.state = st;
      return { state: st, changed };
    }

    /* Son parça değişiminden bu yana geçen saniye. */
    ageAt(nowMs) {
      if (!this.key) return Infinity;
      return Math.max(0, (num(nowMs, 0) - this.changedAt) / 1000);
    }
  }

  const api = {
    EMPTY, clamp, num,
    trackKey, isSameTrack, anchorMs,
    positionAt, resolve,
    fmtTime, prettyApp,
    SPEEDS, speedOf, STYLES, styleOf,
    envelope, compose, upper, Tracker,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.SVNowPlaying = api;
    /* Ana süreçten gelen son örnek burada durur. Katmanlar her kare buradan
       okur; IPC'yi tek bir yer dinlesin diye global tutuluyor. */
    window.SVNowLive = window.SVNowLive || { state: null };
  }
})();
