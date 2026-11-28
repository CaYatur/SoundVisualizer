/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Windows söz takibi.

   Elle yüklenen dosya duruyor: ekran açılınca duvar saatiyle akar.
   Takip açıksa ve bu makine Windows ise saat, sistem medya oturumunun
   konumudur (src/shared/nowplaying.js positionAt). Sarma yeni çıpayı
   getirir, duraklama konumu dondurur.

   Kütüphane metni ayar dosyasında durmaz. Eşleme burada saf bir
   fonksiyondur; dosyayı ana süreç okur. Ağdan söz çekilmez. */
(function () {
  const TITLE_NOISE = /\b(official|video|videos|lyrics|lyric|audio|remastered|remaster|hd|4k|mv|visualiser|visualizer|deluxe|edition|explicit|radio|edit|version|topic|nightcore|slowed|reverb|extended)\b/g;
  const LINE_NOISE = /\b(official|video|videos|lyrics|lyric|audio|remastered|remaster|hd|4k|mv|visualiser|visualizer|deluxe|edition|explicit|radio|edit|version|topic|nightcore|slowed|reverb|extended|live)\b/g;
  const FOLD = {
    ı: 'i', İ: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g', ü: 'u', Ü: 'u',
    ö: 'o', Ö: 'o', ç: 'c', Ç: 'c', â: 'a', Â: 'a', î: 'i', Î: 'i', û: 'u', Û: 'u',
  };

  function lyricsApi() {
    if (typeof window !== 'undefined' && window.SVLyrics) return window.SVLyrics;
    if (typeof require === 'function') {
      try { return require('./lyrics.js'); } catch (e) { return null; }
    }
    return null;
  }

  function clockApi() {
    if (typeof window !== 'undefined' && window.SVNowPlaying && window.SVNowPlaying.positionAt) {
      return window.SVNowPlaying;
    }
    if (typeof require === 'function') {
      try { return require('./nowplaying.js'); } catch (e) { return null; }
    }
    return null;
  }

  function normalize(value) {
    const folded = String(value == null ? '' : value).replace(/[ışğüöçİŞĞÜÖÇâîûÂÎÛ]/g, (ch) => FOLD[ch] || ch);
    return folded
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^the /, '');
  }

  function scrub(value, noise) {
    return normalize(value).replace(noise, ' ').replace(/\s+/g, ' ').trim();
  }

  function bigrams(s) {
    const m = new Map();
    if (!s) return m;
    if (s.length < 2) { m.set(s, 1); return m; }
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  }

  function dice(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const A = bigrams(a);
    const B = bigrams(b);
    let na = 0;
    let nb = 0;
    let inter = 0;
    for (const v of A.values()) na += v;
    for (const v of B.values()) nb += v;
    for (const [k, v] of A) {
      if (B.has(k)) inter += Math.min(v, B.get(k));
    }
    if (!na || !nb) return 0;
    return (2 * inter) / (na + nb);
  }

  function contains(a, b) {
    if (!a || !b) return false;
    const short = a.length <= b.length ? a : b;
    const long = a.length <= b.length ? b : a;
    return short.length >= 4 && long.indexOf(short) >= 0;
  }

  /* "ile", virgül, feat ve benzeri bağlaçlar ad değil. Sıra ve yazım
     farkı ad ad bakılır; bütün dizenin tek parça olması gerekmez. */
  const ARTIST_JOIN = new Set(['ile', 've', 'and', 'feat', 'ft', 'featuring', 'vs', 'versus', 'with', 'und', 'et', 'plus']);

  function artistTokens(s) {
    return String(s || '').split(' ').filter((t) => t.length >= 2 && !ARTIST_JOIN.has(t));
  }

  function editDistance(a, b) {
    const m = a.length;
    const n = b.length;
    if (!m) return n;
    if (!n) return m;
    if (Math.abs(m - n) > 2) return 3;
    const row = new Array(n + 1);
    for (let j = 0; j <= n; j++) row[j] = j;
    for (let i = 1; i <= m; i++) {
      let prev = row[0];
      row[0] = i;
      for (let j = 1; j <= n; j++) {
        const cur = row[j];
        const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
        prev = cur;
      }
    }
    return row[n];
  }

  function nameClose(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const d = dice(a, b);
    if (d >= 0.72 || contains(a, b)) return Math.max(d, 0.72);
    const lim = Math.max(a.length, b.length) >= 8 ? 2 : 1;
    if (Math.min(a.length, b.length) >= 4 && editDistance(a, b) <= lim) return Math.max(d, 0.72);
    return 0;
  }

  /* Kısa taraftaki her ad, uzun tarafta bir ada oturur. Sıra önemsiz.
     Boş sanatçı çağıranda zaten serbest. */
  function artistClose(a, b) {
    if (!a || !b) return true;
    if (a === b || dice(a, b) >= 0.55 || contains(a, b)) return true;
    const A = artistTokens(a);
    const B = artistTokens(b);
    if (!A.length || !B.length) return false;
    const short = A.length <= B.length ? A : B;
    const long = A.length <= B.length ? B : A;
    const used = new Set();
    for (let s = 0; s < short.length; s++) {
      let best = 0;
      let bi = -1;
      for (let i = 0; i < long.length; i++) {
        if (used.has(i)) continue;
        const sc = nameClose(short[s], long[i]);
        if (sc > best) { best = sc; bi = i; }
      }
      if (bi < 0) return false;
      used.add(bi);
    }
    return true;
  }

  function exactOk(qTitle, qArtist, title, artist) {
    if (!qTitle || qTitle !== title) return false;
    if (!qArtist || !artist) return true;
    return qArtist === artist;
  }

  /* Eşleme her karede, her metin katmanında ve her ekranda çağrılıyor
     (modes/text.js). Kitaplık dizisi yalnız kitaplık değişince yenisiyle
     değişiyor; parça ve kip aynıysa sonuç aynıdır. Önceki sonuç bu üçlüyle
     saklanır; aksi halde bütün kitaplık her karede baştan normalize
     ediliyordu (#695). */
  let lastMatch = null;
  function matchTrack(query, items, mode) {
    const title = query && query.title;
    const artist = query && query.artist;
    const m = lastMatch;
    if (m && m.items === items && m.title === title && m.artist === artist && m.mode === mode) return m.out;
    const out = matchTrackNow(query, items, mode);
    lastMatch = { items, title, artist, mode, out };
    return out;
  }

  /* En yüksek skor kazanır. Tam eşleme her zaman kısmi eşlemenin önündedir.
     Eşit skorda listedeki ilk öğe kalır; sıra oynamasın. */
  function matchTrackNow(query, items, mode) {
    const qTitle = normalize(query && query.title);
    const qArtist = normalize(query && query.artist);
    if (!qTitle) return null;
    const partial = mode === 'partial';
    const qSoft = partial ? scrub(query.title, TITLE_NOISE) : qTitle;
    const list = Array.isArray(items) ? items : [];
    let best = null;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (!it) continue;
      const title = normalize(it.title);
      const artist = normalize(it.artist);
      if (!title) continue;
      let score = 0;
      let how = '';
      if (exactOk(qTitle, qArtist, title, artist)) {
        score = 3;
        how = 'exact';
      } else if (partial) {
        const soft = scrub(it.title, TITLE_NOISE);
        const titleHit = (qSoft && soft && (dice(qSoft, soft) >= 0.72 || contains(qSoft, soft)));
        let artistHit = true;
        if (qArtist && artist) artistHit = artistClose(qArtist, artist);
        if (titleHit && artistHit) {
          score = dice(qSoft, soft);
          how = 'partial';
        }
      }
      if (!how) continue;
      if (!best || score > best.score) best = { item: it, score, how, index: i };
    }
    return best;
  }

  function systemLyrics(raw, live) {
    const text = String(raw == null ? '' : raw).replace(/^\uFEFF/, '').trim();
    if (!text || text.length > 512 * 1024) return null;
    const api = lyricsApi();
    if (api && api.parse) {
      const doc = api.parse(text);
      if (doc && (doc.format === 'lrc' || doc.format === 'srt') && doc.lines && doc.lines.length >= 2) {
        return { kind: 'timed', text };
      }
    }
    if (text.length < 2 || text.length > 180 || /\n/.test(text)) return null;
    if (/^https?:/i.test(text) || /\.(mp3|mp4|mkv|flac|wav|lrc|srt|txt)$/i.test(text)) return null;
    const meta = live || {};
    const plain = normalize(text);
    const soft = scrub(text, LINE_NOISE);
    if (!soft) return null;
    const bags = [meta.title, meta.artist, meta.album,
      (meta.artist || '') + ' ' + (meta.title || ''),
      (meta.title || '') + ' ' + (meta.artist || '')];
    for (const bag of bags) {
      const n = normalize(bag);
      if (!n) continue;
      if (n === plain || n === soft) return null;
    }
    return { kind: 'line', text };
  }

  function mediaTime(live, nowMs, positionAt) {
    if (typeof positionAt === 'function') return positionAt(live, nowMs);
    const np = clockApi();
    if (np && np.positionAt) return np.positionAt(live, nowMs);
    return 0;
  }

  /* null: takip yok. Çağıran duvar saatine ve elle yüklenen dosyaya döner.
     time sayıysa medya konumu. time null ve source manual: duvar saati.
     Eşleşen kütüphane dosyası sistem oturumundan önce gelir.
     O yoksa zamanlı oynatıcı sözü, o da yoksa zamansız satır.
     line: zamansız oynatıcı satırı, karaoke yok.
     source none: çalan parçanın sözü yok, elle yüklenen dosya çalmaz. */
  function playback(opts) {
    const o = opts || {};
    const live = o.live;
    /* Zaman çizelgesi klibi (#1213): dosya uygulamanın içinde çalıyor,
       oturum izlemeye (yalnız Windows) gerek yok; her platformda izlenir.
       Takip kapalıyken de elle yüklenmiş söz yoksa klibin sözü çalar;
       elle yüklenmiş söz varsa o korunur (takip açılmadıkça). */
    const timelineClip = !!(live && live.has && live.clipId);
    if (timelineClip) {
      if (!o.follow && o.manualText) return null;
    } else if (!o.windows || !o.follow) return null;
    const hasLive = !!(live && live.has && (live.title || live.artist));
    if (!hasLive) {
      return { source: 'manual', text: o.manualText || '', time: null, line: false };
    }
    const nowMs = o.nowMs == null ? Date.now() : o.nowMs;
    const hit = matchTrack(
      { title: live.title, artist: live.artist },
      o.library || [],
      o.match || 'exact'
    );
    if (hit && hit.item) {
      return {
        source: 'library',
        text: hit.item.text || '',
        time: mediaTime(live, nowMs, o.positionAt),
        line: false,
        how: hit.how,
        item: { id: hit.item.id, title: hit.item.title, artist: hit.item.artist },
      };
    }
    // Takipsiz çizelge klibinin sözü yok: eski yol (elle/otomatik söz) sürer
    if (timelineClip && !o.follow) return null;
    const sys = systemLyrics(live.subtitle, live);
    if (sys && sys.kind === 'timed') {
      return { source: 'system', text: sys.text, time: mediaTime(live, nowMs, o.positionAt), line: false };
    }
    if (sys && sys.kind === 'line') {
      return { source: 'system-line', text: sys.text, time: null, line: true };
    }
    return { source: 'none', text: '', time: null, line: false };
  }

  function guessMeta(text, filename) {
    let artist = '';
    let title = '';
    const api = lyricsApi();
    if (api && api.parse) {
      const doc = api.parse(text || '');
      const meta = (doc && doc.meta) || {};
      artist = meta.ar || meta.artist || '';
      title = meta.ti || meta.title || '';
    }
    const base = String(filename || '').replace(/\.[^.]+$/, '').trim();
    const parts = base.split(/\s+[-–—]\s+/);
    if (!artist && parts.length >= 2) artist = parts[0].trim();
    if (!title) title = (parts.length >= 2 ? parts.slice(1).join(' - ') : base).trim();
    return { artist: String(artist).slice(0, 200), title: String(title).slice(0, 200) };
  }

  /* Metnin yalnız uzunluğu yetmez: düzenleyicide aynı uzunlukta bir zaman
     düzeltmesi ([00:12.34] → [00:12.35]) ekranlara hiç ulaşmıyordu (#695).
     Yalnız kitaplık değişince hesaplanır. */
  function textSig(s) {
    const str = String(s || '');
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return str.length + ':' + h;
  }

  function librarySig(items) {
    const list = Array.isArray(items) ? items : [];
    let sig = String(list.length);
    for (let i = 0; i < list.length; i++) {
      const it = list[i] || {};
      sig += '\n' + (it.id || '') + '\0' + (it.artist || '') + '\0' + (it.title || '') + '\0' + textSig(it.text);
    }
    return sig;
  }

  function installLibrary(api, onItems) {
    if (typeof window === 'undefined') return;
    window.SVLyricsLib = window.SVLyricsLib || { items: [], sig: '' };
    const apply = (items) => {
      const next = Array.isArray(items) ? items : [];
      const sig = librarySig(next);
      if (sig === window.SVLyricsLib.sig) return;
      window.SVLyricsLib.sig = sig;
      window.SVLyricsLib.items = next;
      if (typeof onItems === 'function') onItems(next);
    };
    if (api && typeof api.onLyricsLib === 'function' && !window.SVLyricsLib.bound) {
      window.SVLyricsLib.bound = true;
      api.onLyricsLib(apply);
    }
    if (api && typeof api.lyricsLibSnapshot === 'function') {
      Promise.resolve(api.lyricsLibSnapshot()).then(apply).catch(() => {});
    }
  }

  /* Sağlayıcı araması: başlık oturmalı. Sanatçıdaki bağlaç, yıl ve tekrarlanan
     başlık adı sayılmaz. Daha çok sanatçı adı örtüşen satır kazanır
     ("Athena ve smle Moment 2022" → "Athena, smie"). */
  const YEAR_TOK = /^(19|20)\d{2}$/;
  function queryArtistTokens(artist, title) {
    const titleSet = new Set(artistTokens(normalize(title)));
    return artistTokens(normalize(artist)).filter((t) => !titleSet.has(t) && !YEAR_TOK.test(t));
  }
  function tokenCover(need, artist) {
    const B = artistTokens(normalize(artist));
    if (!need.length || !B.length) return 0;
    const used = new Set();
    let n = 0;
    for (let s = 0; s < need.length; s++) {
      let best = 0;
      let bi = -1;
      for (let i = 0; i < B.length; i++) {
        if (used.has(i)) continue;
        const sc = nameClose(need[s], B[i]);
        if (sc > best) { best = sc; bi = i; }
      }
      if (bi < 0) continue;
      used.add(bi);
      n++;
    }
    return n / need.length;
  }
  function pickProviderHit(query, rows) {
    const qTitle = normalize(query && query.title);
    if (!qTitle || !Array.isArray(rows)) return '';
    const qSoft = scrub(query.title, TITLE_NOISE);
    const need = queryArtistTokens(query && query.artist, query && query.title);
    const qDur = Number(query && query.duration) || 0;
    let best = null;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const rawTitle = row.trackName || row.title || '';
      const title = normalize(rawTitle);
      const soft = scrub(rawTitle, TITLE_NOISE);
      if (!title) continue;
      const titleHit = title === qTitle || (qSoft && soft && (dice(qSoft, soft) >= 0.72 || contains(qSoft, soft)));
      if (!titleHit) continue;
      let cover = 1;
      if (need.length) {
        cover = tokenCover(need, row.artistName || row.artist || '');
        if (!(cover > 0)) continue;
      }
      const synced = String(row.syncedLyrics || '').trim();
      const plain = String(row.plainLyrics || row.lyrics || '').trim();
      const text = synced || plain;
      if (!text) continue;
      const dur = Number(row.duration) || 0;
      let score = cover * 10 + dice(qSoft || qTitle, soft || title);
      if (synced) score += 0.4;
      if (qDur > 0 && dur > 0) {
        const d = Math.abs(qDur - dur);
        if (d <= 3) score += 0.6;
        else if (d <= 8) score += 0.2;
        else score -= 0.4;
      }
      if (!best || score > best.score) best = { score, text };
    }
    return best ? best.text : '';
  }

  const api = {
    normalize, dice, matchTrack, systemLyrics, playback, guessMeta, installLibrary, librarySig, pickProviderHit,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVLyricsSync = api;
})();
