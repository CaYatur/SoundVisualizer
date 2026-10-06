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

module.exports = createLibrary({
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
