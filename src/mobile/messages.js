/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* İKİLİ İLETİ BİÇİMİ, sayfa tarafı (docs/android/MESSAGES.md). Uygulama
   tarafındaki karşılığı android/…/bridge/Messages.kt; iki taraf aynı sabitleri
   kullanır ve android/js-tests/fixtures üzerinden çapraz denetlenir.
   Hepsi küçük uçlu. */
(function () {
  const VERSION = 1;
  const HEADER_BYTES = 16;
  const TYPE_PCM = 0x01;
  const TYPE_WAVE = 0x02;
  const TYPE_VIDEO_CHUNK = 0x10;
  const TYPE_VIDEO_CONFIG = 0x11;
  const PCM_HEADER_BYTES = 8;
  const WAVE_HEADER_BYTES = 8;
  const FORMAT_S16 = 1;
  const FORMAT_F32 = 2;
  const SOURCES = { 1: 'player', 2: 'capture', 3: 'mic' };

  /** Başlık; sihirli bayt, sürüm ya da uzunluk tutmazsa null. */
  function readHeader(buf) {
    if (!(buf instanceof ArrayBuffer) || buf.byteLength < HEADER_BYTES) return null;
    const v = new DataView(buf);
    if (v.getUint8(0) !== 0x53 || v.getUint8(1) !== 0x56 || v.getUint8(2) !== VERSION) return null;
    return { type: v.getUint8(3), seq: v.getUint32(4, true), time: v.getFloat64(8, true) };
  }

  function writeHeader(v, type, seq, time) {
    v.setUint8(0, 0x53);
    v.setUint8(1, 0x56);
    v.setUint8(2, VERSION);
    v.setUint8(3, type);
    v.setUint32(4, seq >>> 0, true);
    v.setFloat64(8, time, true);
  }

  /** PCM iletisi: örnekler ArrayBuffer üstünde görünüm (kopya yok). */
  function readPcm(buf) {
    const h = readHeader(buf);
    if (!h || h.type !== TYPE_PCM || buf.byteLength < HEADER_BYTES + PCM_HEADER_BYTES) return null;
    const v = new DataView(buf);
    const at = HEADER_BYTES + PCM_HEADER_BYTES;
    const format = v.getUint8(21);
    const bytes = buf.byteLength - at;
    let samples = null;
    if (format === FORMAT_S16) samples = new Int16Array(buf, at, bytes >> 1);
    else if (format === FORMAT_F32) samples = new Float32Array(buf, at, bytes >> 2);
    else return null;
    return {
      seq: h.seq,
      time: h.time,
      sampleRate: v.getUint32(16, true),
      channels: v.getUint8(20),
      format,
      source: SOURCES[v.getUint8(22)] || 'unknown',
      samples,
    };
  }

  /** WAVE iletisi (Visualizer yedeği): 128 merkezli 8 bit dalga. */
  function readWave(buf) {
    const h = readHeader(buf);
    if (!h || h.type !== TYPE_WAVE || buf.byteLength < HEADER_BYTES + WAVE_HEADER_BYTES) return null;
    const v = new DataView(buf);
    const n = v.getUint16(20, true);
    const at = HEADER_BYTES + WAVE_HEADER_BYTES;
    if (buf.byteLength < at + n) return null;
    return { seq: h.seq, time: h.time, sampleRate: v.getUint32(16, true), wave: new Uint8Array(buf, at, n) };
  }

  /** PCM iletisi yazar (testler ve çapraz denetim için; uygulama da aynı yerleşimi kurar). */
  function pcmS16(seq, time, sampleRate, channels, source, samples) {
    const buf = new ArrayBuffer(HEADER_BYTES + PCM_HEADER_BYTES + samples.length * 2);
    const v = new DataView(buf);
    writeHeader(v, TYPE_PCM, seq, time);
    v.setUint32(16, sampleRate, true);
    v.setUint8(20, channels);
    v.setUint8(21, FORMAT_S16);
    v.setUint8(22, source);
    v.setUint8(23, 0);
    for (let i = 0; i < samples.length; i++) v.setInt16(HEADER_BYTES + PCM_HEADER_BYTES + i * 2, samples[i], true);
    return buf;
  }

  const api = {
    VERSION, HEADER_BYTES, TYPE_PCM, TYPE_WAVE, TYPE_VIDEO_CHUNK, TYPE_VIDEO_CONFIG,
    PCM_HEADER_BYTES, WAVE_HEADER_BYTES, FORMAT_S16, FORMAT_F32, SOURCES,
    readHeader, writeHeader, readPcm, readWave, pcmS16,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVMessages = api;
})();
