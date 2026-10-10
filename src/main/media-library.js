/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Video kitaplığı. Logo kitaplığıyla aynı motor: dosya userData altına
   kopyalanır, ayar dosyasına yalnızca sv-media adresi ve kimlik yazılır.
   Tavan logodan yüksek; video seçici kopyalamadan da açmaya devam eder. */
const { createLibrary } = require('./logo-library');

/* Dosyanın başı bir video kabı mı? Eskiden yalnız uzantıya bakılıyordu:
   ".mp4" adlı bir metin dosyası "eklendi" deniyor, katmanda açılmıyordu.
   MP4/MOV/M4V ilk kutusu (ftyp; eski QuickTime'da moov, mdat, wide, free,
   skip), WebM/MKV EBML imzası, AVI RIFF....AVI. Uzantı kabla uyuşmasa da
   gerçek bir video kabul edilir; tarayıcı içerikten çözer. */
const ISO_BOXES = ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot'];
function isVideoHead(b) {
  if (!b || b.length < 8) return false;
  if (ISO_BOXES.indexOf(b.toString('latin1', 4, 8)) >= 0) return true;
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return true;
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'AVI ') return true;
  return false;
}

module.exports = createLibrary({
  sniff: isVideoHead,
  ext: ['.mp4', '.m4v', '.webm', '.mkv', '.mov', '.avi'],
  mime: {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
  },
  maxBytes: 512 * 1024 * 1024,
  idPrefix: 'vid',
  kindOf: () => 'video',
});
module.exports.isVideoHead = isVideoHead;
