/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Şarkı sözü zamanlaması — LRC ve SRT.

   İki biçim de zamanlanmış metin taşır ama farklı düşünürler. LRC bir
   SATIRIN ne zaman BAŞLADIĞINI söyler ve satır bir sonrakine kadar sürer;
   gelişmiş LRC ayrıca satır İÇİNDEKİ kelimelerin zamanını taşır, karaoke
   vurgusu buradan gelir. SRT ise her girdinin başlangıç VE bitişini verir,
   yani aralar açıkça boş kalabilir.

   Ayrıştırıcı ikisini de aynı iç yapıya indirger:

     { start, end, text, words: [{ t, end, text }] }

  Kelime süresi (#938): her kelimenin bir BİTİŞİ var. Gelişmiş LRC'de (A2)
  metinsiz bir `<mm:ss.xx>` etiketi önceki kelimenin bittiği an demektir —
  uzatılan hece böyle yazılır. Bitiş etiketi yoksa kelime bir sonrakine (son
  kelime satır sonuna) kadar sürer; eski dosyalar aynen eskisi gibi görünür.

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

  /* Bitişi yazılmamış kelimeler bir sonrakine, son kelime satır sonuna
     kadar sürer. Açık bitiş, bir sonraki kelimeden sonraya taşamaz. */
  function fillWordEnds(line) {
    const ws = line.words || [];
    for (let i = 0; i < ws.length; i++) {
      const next = i + 1 < ws.length ? ws[i + 1].t : line.end;
      if (ws[i].end == null || !(ws[i].end > ws[i].t)) ws[i].end = Math.max(ws[i].t, next);
      else if (ws[i].end > next && i + 1 < ws.length) ws[i].end = next;
    }
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

      /* Metinsiz (ya da yalnız boşluk) kelime bir BİTİŞ etiketidir: önceki
         kelimenin süresini kapatır. Boşluğu kaybetmemek için metni öncekine
         eklenir. Satır başındaki metinsiz etiket yine kelime sayılır (eski
         davranış). */
      const kept = [];
      for (const w of words) {
        const prev = kept[kept.length - 1];
        if (prev && !w.text.trim()) {
          if (prev.end == null && w.t >= prev.t) prev.end = w.t;
          prev.text += w.text;
          continue;
        }
        kept.push(w);
      }
      const full = (plain + kept.map((w) => w.text).join('')).trim();
      for (const t of stamps) {
        lines.push({ start: t, end: 0, text: full, words: kept.map((w) => (w.end != null ? { t: w.t, end: w.end, text: w.text } : { t: w.t, text: w.text })) });
      }
    }

    lines.sort((a, b) => a.start - b.start);
    // LRC bitiş taşımaz: her satır bir sonraki başlayana kadar sürer
    for (let i = 0; i < lines.length; i++) {
      lines[i].end = i + 1 < lines.length ? lines[i + 1].start : lines[i].start + 5;
      fillWordEnds(lines[i]);
    }
    const offset = parseFloat(meta.offset);
    if (isFinite(offset) && offset !== 0) {
      // LRC'de offset milisaniyedir ve İŞARETİ TERSTİR: pozitif offset
      // sözü erkene alır.
      const d = -offset / 1000;
      for (const l of lines) {
        l.start += d;
        l.end += d;
        for (const w of l.words) { w.t += d; w.end += d; }
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

     Dönüş: { index, line, progress, wordIndex, wordProgress } — hiçbiri
     yoksa index -1. wordProgress etkin kelimenin süresi içindeki konum
     (0..1); kelime bitişi geçtiyse 1. */
  function at(doc, time, offset) {
    const lines = (doc && doc.lines) || [];
    if (!lines.length) return { index: -1, line: null, progress: 0, wordIndex: -1, wordProgress: 0 };
    const t = time + (offset || 0);
    let lo = 0;
    let hi = lines.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (idx < 0) return { index: -1, line: null, progress: 0, wordIndex: -1, wordProgress: 0 };
    const line = lines[idx];
    if (t > line.end) return { index: -1, line: null, progress: 0, wordIndex: -1, wordProgress: 0 };
    const span = Math.max(1e-6, line.end - line.start);
    const progress = Math.max(0, Math.min(1, (t - line.start) / span));

    // Karaoke: hangi kelimeye kadar geldik
    let wordIndex = -1;
    if (line.words && line.words.length) {
      for (let i = 0; i < line.words.length; i++) {
        if (line.words[i].t <= t) wordIndex = i; else break;
      }
    }
    let wordProgress = 0;
    if (wordIndex >= 0) {
      const w = line.words[wordIndex];
      const wEnd = w.end > w.t ? w.end : (wordIndex + 1 < line.words.length ? line.words[wordIndex + 1].t : line.end);
      wordProgress = wEnd > w.t ? Math.max(0, Math.min(1, (t - w.t) / (wEnd - w.t))) : 1;
    }
    return { index: idx, line, progress, wordIndex, wordProgress };
  }

  // Tüm zamanlamayı kaydır (elle senkron düzeltmesi)
  function shift(doc, seconds) {
    if (!doc) return doc;
    for (const l of doc.lines) {
      l.start += seconds;
      l.end += seconds;
      for (const w of l.words) { w.t += seconds; if (w.end != null) w.end += seconds; }
    }
    return doc;
  }

  // Düzeltilmiş dosyayı geri yaz (LRC olarak)
  function toLRC(doc) {
    const pad = (n, w) => String(Math.floor(n)).padStart(w, '0');
    const stamp = (t) => {
      const cs = Math.round(Math.max(0, t) * 100);
      return '[' + pad(cs / 6000, 2) + ':' + pad((cs / 100) % 60, 2) + '.' + pad(cs % 100, 2) + ']';
    };
    const out = [];
    for (const k of Object.keys((doc && doc.meta) || {})) {
      if (k !== 'offset') out.push('[' + k + ':' + doc.meta[k] + ']');
    }
    for (const l of (doc && doc.lines) || []) out.push(stamp(l.start) + l.text);
    return out.join('\n');
  }

  /* ZAMANLAMA DÜZENLEYİCİSİ YARDIMCILARI (#414, #938). Metin üzerinde
     çalışırlar: kullanıcının yazdığı biçim, yorum ve üst bilgi korunur. */
  function fmtStamp(t) {
    const cs = Math.round(Math.max(0, t) * 100);
    const pad = (n, w) => String(Math.floor(n)).padStart(w, '0');
    return pad(cs / 6000, 2) + ':' + pad((cs / 100) % 60, 2) + '.' + pad(cs % 100, 2);
  }
  // Seçili satır aralığındaki ([a, b], 0 tabanlı) bütün [..] ve <..> etiketlerini kaydır
  function nudgeText(text, fromLine, toLine, seconds) {
    const rows = clean(text).split('\n');
    const a = Math.max(0, fromLine | 0);
    const b = Math.min(rows.length - 1, toLine == null ? rows.length - 1 : toLine | 0);
    const RE = /([[<])(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?([\]>])/g;
    for (let i = a; i <= b; i++) {
      rows[i] = rows[i].replace(RE, (all, o, mm, ss, fr, c) => {
        if ((o === '[') !== (c === ']')) return all;
        return o + fmtStamp(lrcTime(mm, ss, fr) + seconds) + c;
      });
    }
    return rows.join('\n');
  }
  // [a, b] satırlarının (0 tabanlı) metindeki başlangıç ve bitiş konumu
  function lineSpan(text, a, b) {
    const rows = String(text == null ? '' : text).split('\n');
    const start = rows.slice(0, a).reduce((n, r) => n + r.length + 1, 0);
    return [start, start + rows.slice(a, b + 1).join('\n').length];
  }
  /* İmlecin olduğu yere kelime etiketi koy: dokun-zamanla (tap). Kelime
     sonuna konan etiket o kelimenin BİTİŞİ olur (uzatılan hece). Dönüş:
     { text, caret } */
  function stampAt(text, caret, seconds) {
    const s = String(text == null ? '' : text);
    const c = Math.max(0, Math.min(s.length, caret | 0));
    const tag = '<' + fmtStamp(seconds) + '>';
    return { text: s.slice(0, c) + tag + s.slice(c), caret: c + tag.length };
  }


  /* Uzatılan hece görseli (#938): ses analizi YOK. Süre yalnızca LRC
     zaman damgalarından gelir. Eşik aşılınca tutulan sesli progress ile
     çoğalır — "love" → "loooove", "yar" → "yaaar". */
  const HELD_VOWELS = /[aeıioöuüâîûAEIİOÖUÜÂÎÛ]/;
  const HELD_TRAIL = /[\s.,!?;:'"…)\]\}»”’\-…]/;
  function heldVowelIndex(core) {
    /* İngilizce sessiz e: love/come → o/o uzar (loooove). Yoksa son sesli. */
    const silentE = /([aeıioöuüâîûAEIİOÖUÜÂÎÛ])([^aeıioöuüâîûAEIİOÖUÜÂÎÛ]+)e$/i.exec(core);
    if (silentE) return silentE.index;
    for (let i = core.length - 1; i >= 0; i--) {
      if (HELD_VOWELS.test(core[i])) return i;
    }
    return -1;
  }
  function stretchHeldVowel(text, durationSec, progress, opts) {
    const raw = String(text == null ? '' : text);
    const dur = Math.max(0, Number(durationSec) || 0);
    const p = Math.max(0, Math.min(1, Number(progress) || 0));
    const o = opts || {};
    const minD = o.minDuration == null ? 0.6 : Number(o.minDuration);
    const amt = o.amount == null ? 0.25 : Number(o.amount);
    const maxExtra = o.maxExtra == null ? 8 : Math.max(0, o.maxExtra | 0);
    if (!(dur >= minD) || p <= 0 || !(amt > 0) || maxExtra <= 0 || !raw) return raw;

    let end = raw.length - 1;
    while (end >= 0 && HELD_TRAIL.test(raw[end])) end--;
    if (end < 0) return raw;
    const core = raw.slice(0, end + 1);
    const vowelIdx = heldVowelIndex(core);
    if (vowelIdx < 0) return raw;

    /* ~0.45 sn eşik üstü = bir ekstra sesli; miktar kaydırıcısı çoğaltır.
       2 sn tutulmuş "love" ≈ loooove. progress 0→1 ile harfler zamanla belirir. */
    const past = dur - minD;
    const per = Math.max(0.25, 0.55 - Math.min(1, amt) * 0.25);
    const target = Math.min(maxExtra, Math.max(1, Math.round(past / per + amt * 2)));
    const n = Math.max(0, Math.min(maxExtra, Math.round(target * p)));
    if (n <= 0) return raw;
    const ch = raw[vowelIdx];
    return raw.slice(0, vowelIdx + 1) + ch.repeat(n) + raw.slice(vowelIdx + 1);
  }

  const api = { parse, parseLRC, parseSRT, at, shift, toLRC, nudgeText, stampAt, fmtStamp, lineSpan, stretchHeldVowel, fillWordEnds };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVLyrics = api;
})();
