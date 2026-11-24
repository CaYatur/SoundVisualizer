/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TELEFONUN SESİ → BİLGİSAYARIN SES GİRİŞİ (PC bağlantısı B4, docs/PHONE-LINK.md "Phone audio").

   Telefon ham PCM yollar (şifreli oturumun ikili iletisi); kare burada, canlı yakalama
   yardımcısıyla AYNI hesapla kurulur (src/shared/audio-spectrum.js: Hann, radix-2 FFT, dB
   baytları; src/main/audio-frame.js yerleşimi). Böylece telefonun sesine görüntü, ışık, OSC ve
   MilkDrop bilgisayarın yerel girişindeki gibi tepki verir; tempo ve vuruşu bilgisayarın kendi
   çözümlemesi bulur.

   Neden analiz karesi değil ham ses (plan §4.7 a/b): bir kare 7174 bayt, saniyede 60 kare
   ~430 KB/s; 48 kHz stereo 16 bit PCM ~192 KB/s. Ham ses hem yarı boyda hem de bilgisayarın
   çözümlemesini aynı tutuyor.

   Paket (şifreli zarfın içi, JSON iletilerden ilk baytla ayrılır — JSON '{' ile başlar):
     [u8 0x01 tür][u8 sürüm 1][u32 BE sıra][u32 BE örnekleme hızı][u8 kanal 1|2][s16 LE örnekler] */

const S = require('../shared/audio-spectrum.js');
const F = require('./audio-frame.js');

const KIND_PCM = 0x01;
const VERSION = 1;
const HEAD = 1 + 1 + 4 + 4 + 1;
const MAX_SAMPLES = 8192; // paket başına (kanal başına örnek)
const RATES = [8000, 11025, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000];

/* Şifresi çözülmüş paket → { seq, sampleRate, channels, samples (Int16Array kopya) } ya da null. */
function decode(buf) {
  if (!buf || buf.length < HEAD || buf[0] !== KIND_PCM || buf[1] !== VERSION) return null;
  const seq = buf.readUInt32BE(2);
  const sampleRate = buf.readUInt32BE(6);
  const channels = buf[10];
  if (RATES.indexOf(sampleRate) < 0 || (channels !== 1 && channels !== 2)) return null;
  const bytes = buf.length - HEAD;
  if (bytes % (2 * channels) !== 0) return null;
  const frames = bytes / (2 * channels);
  if (!frames || frames > MAX_SAMPLES) return null;
  const samples = new Int16Array(frames * channels);
  for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(HEAD + i * 2);
  return { seq, sampleRate, channels, samples };
}

/* Sınama ve telefonun eşi için (Kotlin PcLink aynı yerleşimi yazar). */
function encode(seq, sampleRate, channels, samples) {
  const buf = Buffer.alloc(HEAD + samples.length * 2);
  buf[0] = KIND_PCM;
  buf[1] = VERSION;
  buf.writeUInt32BE(seq >>> 0, 2);
  buf.writeUInt32BE(sampleRate >>> 0, 6);
  buf[10] = channels;
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], HEAD + i * 2);
  return buf;
}

/* PCM → kare. Kare ses ZAMANINA göre çıkar (saniyede `fps`, örnek sayısından): ağ paketleri
   öbek öbek gelse de görüntü sesin hızında ilerler. Sıra atlarsa (kayıp) sayılır. */
function createFramer(opts) {
  const o = Object.assign({ fps: 60, onFrame: () => {} }, opts || {});
  const sp = S.create();
  const rings = new S.SourceRings();
  const out = Buffer.alloc(F.FRAME_BYTES);
  out[0] = F.MARKER0;
  out[1] = F.MARKER1;
  let acc = 0;
  let rate = 0;
  let lastSeq = null;
  const stats = { packets: 0, lost: 0, frames: 0, samples: 0 };

  function emit() {
    out.writeUInt32LE(rate >>> 0, F.OFFSET.sampleRate);
    sp.spectrum(rings.mono, out, F.OFFSET.freq);
    S.timeBytes(rings.mono, out, F.OFFSET.time);
    S.timeBytes(rings.left, out, F.OFFSET.left);
    S.timeBytes(rings.right, out, F.OFFSET.right);
    stats.frames++;
    o.onFrame(F.parseFrame(out));
  }

  function push(p) {
    if (!p) return;
    stats.packets++;
    if (lastSeq != null) {
      const gap = (p.seq - lastSeq - 1) >>> 0;
      if (gap < 1000) stats.lost += gap; // büyük sıçrama: telefon yeniden başladı
    }
    lastSeq = p.seq;
    if (p.sampleRate !== rate) { rate = p.sampleRate; acc = 0; rings.reset(); }
    const ch = p.channels;
    const n = p.samples.length / ch;
    stats.samples += n;
    const hop = Math.max(1, Math.round(rate / o.fps));
    const f = new Float32Array(p.samples.length);
    for (let i = 0; i < f.length; i++) f[i] = p.samples[i] / 32768;
    let pos = 0;
    while (pos < n) {
      const take = Math.min(n - pos, hop - acc);
      rings.pushFloat32(f.subarray(pos * ch, (pos + take) * ch), ch);
      pos += take;
      acc += take;
      if (acc >= hop) { acc = 0; emit(); }
    }
  }

  return { push, stats: () => Object.assign({ sampleRate: rate }, stats), reset: () => { rings.reset(); acc = 0; lastSeq = null; } };
}

/* TELEFONDA ÇALAN PARÇA (nowplaying.set). Telefonun sesi bilgisayarın girişiyken parça bilgisi
   ve kapak da telefondan gelir (ses köprüsündeki gibi, #813): şarkı bilgisi katmanı, sözler,
   OBS sayfası ve OSC aynı parçayı görür. Biçim bilgisayarın "şimdi çalıyor"u
   (src/main/media-session.js). Kapak yalnız parça değişince gelir (yoksa öncekisi kalır);
   yalnız JPEG/PNG/WebP veri adresi, en çok 192 KB. Konum ve süre saniye. */
const ART_MAX = 192 * 1024;
const ART_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
function cleanMeta(a, prev, now) {
  const o = a && typeof a === 'object' ? a : {};
  const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) : '');
  const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0);
  if (o.has !== true) return { has: false, playing: false, title: '', artist: '', album: '', artwork: '', app: '', subtitle: '', position: 0, duration: 0, updated: 0, received: now };
  const title = str(o.title, 300);
  const artist = str(o.artist, 300);
  let artwork = '';
  if (typeof o.artwork === 'string') {
    if (o.artwork && (o.artwork.length > ART_MAX || !ART_RE.test(o.artwork))) return null;
    artwork = o.artwork;
  } else if (prev && prev.has && prev.title === title && prev.artist === artist) {
    artwork = prev.artwork || ''; // aynı parça: kapak yeniden yollanmaz
  }
  return {
    has: true, playing: o.playing === true, title, artist, album: str(o.album, 300), artwork,
    subtitle: '', app: str(o.app, 80) || 'Telefon',
    position: num(o.position, 24 * 3600), duration: num(o.duration, 24 * 3600), updated: now, received: now,
  };
}

module.exports = { KIND_PCM, VERSION, HEAD, MAX_SAMPLES, ART_MAX, decode, encode, createFramer, cleanMeta };
