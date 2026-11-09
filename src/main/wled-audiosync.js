/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* WLED ses senkronu (UDP Audio Sync, v2 paketi) yayını.

   SoundReactive WLED / WLED-MM aygıtları "Audio Sync: Receive" kipinde bu
   paketi dinler ve kendi mikrofonu yerine bizim analizimizle oynar. Varsayılan
   hedef WLED'in multicast adresi 239.0.0.1:11988.

   44 baytlık paket, küçük endian (ESP32):
     0  "00002\0"         başlık (6)
     6  basınç / boşluk   (2)  — 0
     8  sampleRaw  float  ham seviye (0..255)
    12  sampleSmth float  yumuşatılmış seviye (0..255)
    16  samplePeak uint8  vuruş anı 1
    17  frameCounter      kare sayacı
    18  fftResult[16]     16 bant (0..255)
    34  zeroCrossings u16 — 0
    36  FFT_Magnitude float
    40  FFT_MajorPeak float baskın frekans (Hz) */

const { createSender } = require('./udp-sender');

const SYNC_PORT = 11988;
const SYNC_HOST = '239.0.0.1';
const PACKET_SIZE = 44;
const HEADER = Buffer.from('00002\0', 'ascii');

const sender = createSender('wledSync');
const state = { smooth: 0, bassAvg: 0, lastPeak: 0, frame: 0 };

function finite(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function unit(v) { return Math.max(0, Math.min(1, finite(v))); }

/* 16 bant: görselleştiricinin logaritmik 16 bandı varsa o (30 Hz..16 kHz),
   yoksa bas/orta/tiz düzeyinden kaba bir dağılım. */
function bands16(frame) {
  const f = frame || {};
  if (Array.isArray(f.spectrum) && f.spectrum.length >= 16) return f.spectrum.slice(0, 16).map(unit);
  const b = unit(f.bass);
  const m = unit(f.mid);
  const t = unit(f.treble);
  const out = [];
  for (let i = 0; i < 16; i++) out.push(i < 5 ? b : i < 11 ? m : t);
  return out;
}

// Bant merkez frekansı (görselleştiricinin oscSpectrum ölçeğiyle aynı)
function bandHz(i) {
  const l0 = Math.log(30);
  const l1 = Math.log(16000);
  return Math.exp(l0 + (l1 - l0) * ((i + 0.5) / 16));
}

/* Paket kurar. `st` verilmezse modül durumu (yumuşatma, vuruş) kullanılır;
   testler kendi durumunu verir. `now` ms. */
function buildPacket(frame, st, now) {
  const s = st || state;
  const t = now == null ? Date.now() : now;
  const f = frame || {};
  const level = unit(f.level);
  const bass = unit(f.bass);
  s.smooth = s.smooth * 0.7 + level * 0.3;
  // Basit vuruş: bas, ortalamasının belirgin üstüne çıkınca (en az 120 ms arayla)
  let peak = 0;
  if (bass > 0.25 && bass > s.bassAvg * 1.35 && t - s.lastPeak > 120) { peak = 1; s.lastPeak = t; }
  s.bassAvg = s.bassAvg * 0.9 + bass * 0.1;
  s.frame = (s.frame + 1) & 0xff;

  const bands = bands16(f);
  let maxI = 0;
  for (let i = 1; i < 16; i++) if (bands[i] > bands[maxI]) maxI = i;
  const pitch = f.analysis && finite(f.analysis.pitchHz) > 0 ? finite(f.analysis.pitchHz) : bandHz(maxI);

  const p = Buffer.alloc(PACKET_SIZE);
  HEADER.copy(p, 0);
  p.writeFloatLE(level * 255, 8);
  p.writeFloatLE(s.smooth * 255, 12);
  p.writeUInt8(peak, 16);
  p.writeUInt8(s.frame, 17);
  for (let i = 0; i < 16; i++) p[18 + i] = Math.round(bands[i] * 255);
  p.writeUInt16LE(0, 34);
  p.writeFloatLE(bands[maxI] * 4096, 36);
  p.writeFloatLE(pitch, 40);
  return p;
}

function parsePacket(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < PACKET_SIZE) return null;
  if (!buf.subarray(0, 6).equals(HEADER)) return null;
  return {
    sampleRaw: buf.readFloatLE(8),
    sampleSmth: buf.readFloatLE(12),
    samplePeak: buf[16],
    frameCounter: buf[17],
    fft: Array.from(buf.subarray(18, 34)),
    magnitude: buf.readFloatLE(36),
    majorPeak: buf.readFloatLE(40),
  };
}

function host(cfg) { return String((cfg && cfg.host) || '').trim() || SYNC_HOST; }

function start(cfg) {
  const c = cfg || {};
  if (!c.enabled) return stop().then(() => status());
  return sender.start({ host: host(c), multicastTtl: 1 }).then(() => status());
}

function stop() { return sender.stop(); }

function send(cfg, frame) {
  if (!cfg || !cfg.enabled || !sender.running()) return false;
  if (!sender.due(cfg.fps, 60)) return false;
  return sender.send(buildPacket(frame), cfg.port | 0 || SYNC_PORT, host(cfg));
}

function status() { return sender.status(); }

module.exports = { start, stop, send, status, buildPacket, parsePacket, bands16, SYNC_PORT, SYNC_HOST, PACKET_SIZE };
