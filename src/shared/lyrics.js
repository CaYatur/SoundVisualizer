'use strict';
/* Şarkı sözü zamanlaması — LRC ve SRT.

   İki biçim de zamanlanmış metin taşır ama farklı düşünürler. LRC bir
   SATIRIN ne zaman BAŞLADIĞINI söyler ve satır bir sonrakine kadar sürer;
   gelişmiş LRC ayrıca satır İÇİNDEKİ kelimelerin zamanını taşır, karaoke
   vurgusu buradan gelir. SRT ise her girdinin başlangıç VE bitişini verir,
   yani aralar açıkça boş kalabilir.

   Ayrıştırıcı ikisini de aynı iç yapıya indirger:

     { start, end, text, words: [{ t, text }] }

   Böylece oynatıcı tek bir arama yapar ve biçim farkı görünmez olur.

   Hoşgörülü olmak zorunda: gerçek dosyalarda BOM, CRLF, eksik milisaniye,
   fazladan boşluk, bozuk satır ve dosya sonunda çöp bulunur. Katı bir
   ayrıştırıcı kullanıcının elindeki dosyaların çoğunu reddederdi. */
(function () {
  const clean = (s) => String(s == null ? '' : s).replace(/^﻿/, '').replace(/\r\n?/g, '\n');

  /* LRC zaman etiketi: [mm:ss.xx] ya da [mm:ss:xx] ya da [mm:ss]
     Milisaniye iki ya da üç haneli olabilir; ikisi de görülüyor. */
  function lrcTime(mm, ss, frac) {
    const m = parseInt(mm, 10) || 0;
    const s = parseFloat(ss) || 0;
    let f = 0;
    if (frac != null && frac !== '') {
      const digits = String(frac).length;
      f = (parseInt(frac, 10) || 0) / Math.pow(10, digits);
    }
    return m * 60 + s + f;
  }

  function parseLRC(text) {
    const src = clean(text);
    const meta = {};
    const lines = [];
    const TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    const WORD = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;

    for (const raw of src.split('\n')) {
      const line = raw.trim();
      if (!line) continue;

      // Üst bilgi: [ti:...], [ar:...], [offset:...]
      const m = /^\[([a-zA-Z#]+):(.*)\]$/.exec(line);
      if (m && !/^\d+$/.test(m[1])) {
        meta[m[1].toLowerCase()] = m[2].trim();
        continue;
      }

      // Bir satırda birden çok zaman etiketi olabilir (aynı sözün tekrarı)
      TAG.lastIndex = 0;
      const stamps = [];
      let hit;
      let end = 0;
      while ((hit = TAG.exec(line))) {
        if (hit.index !== end) break; // etiketler yalnızca satır başında
        stamps.push(lrcTime(hit[1], hit[2], hit[3]));
        end = TAG.lastIndex;
      }
      if (!stamps.length) continue;

      const body = line.slice(end);
      // Gelişmiş LRC: satır içi kelime zamanları
      const words = [];
      WORD.lastIndex = 0;
      let last = 0;
      let wm;
      let plain = '';
      while ((wm = WORD.exec(body))) {
        const chunk = body.slice(last, wm.index);
        if (chunk) {
          if (words.length) words[words.length - 1].text += chunk;
          else plain += chunk;
        }
        words.push({ t: lrcTime(wm[1], wm[2], wm[3]), text: '' });
        last = WORD.lastIndex;
      }
      const tail = body.slice(last);
      if (words.length) words[words.length - 1].text += tail;
      else plain += tail;

      const full = (plain + words.map((w) => w.text).join('')).trim();
      for (const t of stamps) {
        lines.push({ start: t, end: 0, text: full, words: words.map((w) => ({ t: w.t, text: w.text })) });
      }
    }

    lines.sort((a, b) => a.start - b.start);
    // LRC bitiş taşımaz: her satır bir sonraki başlayana kadar sürer
    for (let i = 0; i < lines.length; i++) {
      lines[i].end = i + 1 < lines.length ? lines[i + 1].start : lines[i].start + 5;
    }
    const offset = parseFloat(meta.offset);
    if (isFinite(offset) && offset !== 0) {
      // LRC'de offset milisaniyedir ve İŞARETİ TERSTİR: pozitif offset
      // sözü erkene alır.
      const d = -offset / 1000;
      for (const l of lines) {
        l.start += d;
        l.end += d;
        for (const w of l.words) w.t += d;
      }
    }
    return { meta, lines, format: 'lrc' };
  }

  // SRT: sıra numarası / "00:00:01,000 --> 00:00:04,000" / metin satırları
  function parseSRT(text) {
    const src = clean(text);
    const lines = [];
    const RANGE = /(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})/;
    const blocks = src.split(/\n\s*\n/);
    for (const block of blocks) {
      const rows = block.split('\n').map((r) => r.trim()).filter(Boolean);
      if (!rows.length) continue;
      let i = 0;
      if (/^\d+$/.test(rows[0])) i = 1;
      const m = RANGE.exec(rows[i] || '');
      if (!m) continue;
      const toSec = (h, mm, ss, ms) =>
        (parseInt(h, 10) || 0) * 3600 + (parseInt(mm, 10) || 0) * 60 +
        (parseInt(ss, 10) || 0) + (parseInt(ms, 10) || 0) / Math.pow(10, String(ms).length);
      const start = toSec(m[1], m[2], m[3], m[4]);
      const end = toSec(m[5], m[6], m[7], m[8]);
      const body = rows.slice(i + 1).join(' ')
        // SRT'de sık görülen basit biçimlendirme etiketleri atılır
        .replace(/<[^>]*>/g, '')
        .replace(/\{[^}]*\}/g, '')
        .trim();
      if (!body) continue;
      lines.push({ start, end, text: body, words: [] });
    }
    lines.sort((a, b) => a.start - b.start);
    return { meta: {}, lines, format: 'srt' };
  }

  // Biçimi içerikten anla — dosya uzantısına güvenmek yerine
  function parse(text) {
    const src = clean(text);
    if (/-->/.test(src)) return parseSRT(src);
    if (/\[\d{1,3}:\d{1,2}/.test(src)) return parseLRC(src);
    // Zamansız düz metin: her satır bir söz, zamanlama yok
    const lines = src.split('\n').map((s) => s.trim()).filter(Boolean)
      .map((t, i) => ({ start: i * 3, end: i * 3 + 3, text: t, words: [] }));
    return { meta: {}, lines, format: 'plain' };
  }

  /* Zaman içinde arama.

     İkili arama kullanılır: bir sözü ekranda göstermek kare başına bir arama
     demek ve söz dosyaları birkaç yüz satır olabiliyor. Doğrusal tarama
     çalışırdı ama kare bütçesinden gereksiz yer alırdı.

     Dönüş: { index, line, progress, wordIndex } — hiçbiri yoksa index -1. */
  function at(doc, time, offset) {
    const lines = (doc && doc.lines) || [];
    if (!lines.length) return { index: -1, line: null, progress: 0, wordIndex: -1 };
    const t = time + (offset || 0);
    let lo = 0;
    let hi = lines.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (idx < 0) return { index: -1, line: null, progress: 0, wordIndex: -1 };
    const line = lines[idx];
    if (t > line.end) return { index: -1, line: null, progress: 0, wordIndex: -1 };
    const span = Math.max(1e-6, line.end - line.start);
    const progress = Math.max(0, Math.min(1, (t - line.start) / span));

    // Karaoke: hangi kelimeye kadar geldik
    let wordIndex = -1;
    if (line.words && line.words.length) {
      for (let i = 0; i < line.words.length; i++) {
        if (line.words[i].t <= t) wordIndex = i; else break;
      }
    }
    return { index: idx, line, progress, wordIndex };
  }

  // Tüm zamanlamayı kaydır (elle senkron düzeltmesi)
  function shift(doc, seconds) {
    if (!doc) return doc;
    for (const l of doc.lines) {
      l.start += seconds;
      l.end += seconds;
      for (const w of l.words) w.t += seconds;
    }
    return doc;
  }

  // Düzeltilmiş dosyayı geri yaz (LRC olarak)
  function toLRC(doc) {
    const pad = (n, w) => String(Math.floor(n)).padStart(w, '0');
    const stamp = (t) => {
      const s = Math.max(0, t);
      return '[' + pad(s / 60, 2) + ':' + pad(s % 60, 2) + '.' + pad((s % 1) * 100, 2) + ']';
    };
    const out = [];
    for (const k of Object.keys((doc && doc.meta) || {})) out.push('[' + k + ':' + doc.meta[k] + ']');
    for (const l of (doc && doc.lines) || []) out.push(stamp(l.start) + l.text);
    return out.join('\n');
  }

  const api = { parse, parseLRC, parseSRT, at, shift, toLRC };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVLyrics = api;
})();
