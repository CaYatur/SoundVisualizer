/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* GÖMÜLÜ SÖZ (ID3v2 USLT/SYLT) — ortamdan bağımsız (Uint8Array, TextDecoder).

   Masaüstünün otomatik söz bulmasındaki ayrıştırıcının (src/main/lyrics-lookup.js
   parseId3Lyrics, syltToLrc, findEmbedded) aynı kuralları; orada Node `Buffer` kullanıldığı için
   tarayıcıda (Android'in motor sayfası) yüklenemiyordu. Aynı girdiye aynı çıktıyı verdiği
   android/js-tests/id3-lyrics.test.js'te masaüstünün işleviyle karşılaştırılarak sınanıyor.

   Yalnız v2.3/v2.4 (v2.2 çok eski ve sözü pratikte taşımıyor). Zamanlı söz (SYLT, milisaniye)
   düz sözün (USLT) önünde; SYLT LRC'ye çevrilir, satır içi heceler <mm:ss.xx> damgalı. */
(function () {
  const MAX_BYTES = 1024 * 1024;

  function syncsafe(b, i) {
    return ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);
  }
  function u32(b, i) { return ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]; }
  function latin1(b, from, to) {
    let s = '';
    for (let i = from; i < to; i++) s += String.fromCharCode(b[i]);
    return s;
  }
  function decodeText(buf, enc) {
    if (!buf || !buf.length) return '';
    if (enc === 1 || enc === 2) {
      let b = buf;
      let le = enc === 1;
      if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) { le = true; b = b.subarray(2); }
      else if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) { le = false; b = b.subarray(2); }
      const even = b.subarray(0, b.length - (b.length % 2));
      return new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(even);
    }
    if (enc === 3) return new TextDecoder('utf-8').decode(buf);
    return latin1(buf, 0, buf.length);
  }
  // Kodlamaya göre sonlandırıcıya kadar oku: { text, next }
  function readTerminated(buf, pos, enc) {
    const wide = enc === 1 || enc === 2;
    let i = pos;
    if (wide) {
      while (i + 1 < buf.length && !(buf[i] === 0 && buf[i + 1] === 0)) i += 2;
      return { text: decodeText(buf.subarray(pos, i), enc), next: Math.min(buf.length, i + 2) };
    }
    while (i < buf.length && buf[i] !== 0) i++;
    return { text: decodeText(buf.subarray(pos, i), enc), next: Math.min(buf.length, i + 1) };
  }

  function lrcStamp(sec) {
    const cs = Math.round(Math.max(0, sec) * 100);
    const pad = (n, w) => String(Math.floor(n)).padStart(w, '0');
    return '[' + pad(cs / 6000, 2) + ':' + pad((cs / 100) % 60, 2) + '.' + pad(cs % 100, 2) + ']';
  }

  /* SYLT: zaman biçimi 2 = milisaniye; 1 = MPEG karesi (kare süresi bilinmediği için atlanır).
     Girdinin başındaki satır sonu o girdiden, sonundaki bir sonrakinden yeni satır başlatır;
     öbürleri aynı satıra hece olarak eklenir. Hiç satır sonu yoksa her girdi bir satırdır. */
  function syltToLrc(body) {
    if (!body || body.length < 6) return '';
    const enc = body[0];
    const fmt = body[4];
    if (fmt !== 2) return '';
    let pos = 6;
    pos = readTerminated(body, pos, enc).next; // içerik tanımı
    const items = [];
    while (pos < body.length) {
      const r = readTerminated(body, pos, enc);
      pos = r.next;
      if (pos + 4 > body.length) break;
      const ms = u32(body, pos);
      pos += 4;
      items.push({ t: ms / 1000, text: r.text });
    }
    if (!items.length) return '';
    const lines = [];
    let cur = null;
    let breakNext = false;
    const noBreaks = !items.some((it) => /[\r\n]/.test(it.text));
    for (const it of items) {
      const txt = it.text.replace(/\r/g, '');
      const starts = noBreaks || breakNext || /^\n/.test(txt) || !cur;
      breakNext = /\n$/.test(txt);
      const clean = txt.replace(/\n/g, '');
      if (starts) { cur = { t: it.t, words: [] }; lines.push(cur); }
      cur.words.push({ t: it.t, text: clean });
    }
    const inner = (s) => s.slice(1, -1);
    return lines.map((l) => {
      if (l.words.length < 2) return lrcStamp(l.t) + l.words.map((w) => w.text).join('').trim();
      return lrcStamp(l.t) + l.words.map((w) => '<' + inner(lrcStamp(w.t)) + '>' + w.text).join('');
    }).join('\n');
  }

  /* Dosya başındaki ID3v2 etiketinden { synced, unsynced }. */
  function parseId3Lyrics(input) {
    const out = { synced: '', unsynced: '' };
    const buf = input instanceof Uint8Array ? input : input ? new Uint8Array(input) : null;
    if (!buf || buf.length < 10 || latin1(buf, 0, 3) !== 'ID3') return out;
    const ver = buf[3];
    if (ver !== 3 && ver !== 4) return out;
    const flags = buf[5];
    const size = syncsafe(buf, 6);
    const end = Math.min(buf.length, 10 + size);
    let pos = 10;
    if (flags & 0x40) pos += ver === 4 ? syncsafe(buf, 10) : u32(buf, 10) + 4;
    while (pos + 10 <= end) {
      const id = latin1(buf, pos, pos + 4);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const fsz = ver === 4 ? syncsafe(buf, pos + 4) : u32(buf, pos + 4);
      const body = buf.subarray(pos + 10, Math.min(end, pos + 10 + fsz));
      pos += 10 + fsz;
      if (fsz <= 0) continue;
      try {
        if (id === 'USLT' && !out.unsynced && body.length > 4) {
          const enc = body[0];
          const desc = readTerminated(body, 4, enc);
          out.unsynced = decodeText(body.subarray(desc.next), enc).replace(/\u0000+$/, '').trim();
        } else if (id === 'SYLT' && !out.synced) {
          out.synced = syltToLrc(body);
        }
      } catch (e) { /* bozuk çerçeve atlanır */ }
    }
    return out;
  }

  /* ID3 etiketinin dosyadaki toplam boyu (başlık dahil); etiket yoksa 0. Uygulama yalnız bu
     kadar baytı okur (şarkının tamamını değil). */
  function tagSize(head) {
    const b = head instanceof Uint8Array ? head : new Uint8Array(head || []);
    if (b.length < 10 || latin1(b, 0, 3) !== 'ID3') return 0;
    return 10 + syncsafe(b, 6);
  }

  function looksLikeLyrics(text) {
    const s = String(text || '').trim();
    return s.length > 0 && s.length <= MAX_BYTES;
  }
  /* Masaüstündeki findEmbedded: önce zamanlı (SYLT ya da etiketteki LRC/SRT), yoksa düz. */
  function embedded(input, tagLyrics) {
    const id3 = parseId3Lyrics(input);
    const fromTags = typeof tagLyrics === 'string' ? tagLyrics.trim() : '';
    const timed = (s) => /\[\d{1,3}:\d{1,2}/.test(s) || /-->/.test(s);
    const pool = [id3.synced, fromTags, id3.unsynced].filter(looksLikeLyrics);
    const best = pool.find(timed) || pool[0];
    return best ? { text: best } : null;
  }

  const api = { parseId3Lyrics, syltToLrc, embedded, tagSize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVId3Lyrics = api;
})();
