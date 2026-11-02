/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* PENCERELERE GİDEN PRESET LİSTESİ (#574, #906). MilkDrop presetleri METİNSİZ
   gidiyor (`lazy`); metin, preset gerçekten çizilecek ya da düzenlenecekken
   kimliğiyle isteniyor.

   Ölçüldü (10.392 preset, aynı sahne): liste 128 MB ve her pencerede ayrı bir
   kopya. Toplam bellek 3.011 MB, kütüphane boşken 1.347 MB. V8'in dizgi
   tablosunu taraması her büyük çöp toplamayı 216-239 ms'ye çıkarıyordu: 11,5
   saniyede bir kare donması. Kütüphane boşken 100 ms üstü boşluk yok.

   Rastgele seçim her geçişte bütün presetlerin puanına bakıyor ve puan metnin
   içinde (`fRating`), o yüzden listede `fRating` olarak taşınıyor. Studio
   presetleri küçük ve sayfa onları hemen çiziyor; olduğu gibi gidiyor. */
const { fileRating } = require('./milkdrop-cycle.js');

function leanPreset(p) {
  if (!p || typeof p !== 'object' || p.kind !== 'milkdrop' || typeof p.source !== 'string') return p;
  const c = Object.assign({}, p, { lazy: true, fRating: fileRating(p.source) });
  delete c.source;
  return c;
}

function leanPresets(list) {
  return (Array.isArray(list) ? list : []).map(leanPreset);
}

module.exports = { leanPreset, leanPresets };
