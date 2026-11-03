/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Yayın notlarının denetimi. Dosyalar eksiksiz yüklense de insan indirme
   tablosundan indiriyor: v3.1.7'de preset paketi yüklüydü, tabloda satırı yoktu.
   Metindeki `@ad` da masum değil: GitHub o kişiyi yayında Contributors altında
   gösteriyor ve bildirim gönderiyor; v3.1.7'de sorunu bildiren kişi böyle
   katkıcı göründü. */

function notesProblems(body, files) {
  const text = String(body || '');
  const out = [];
  for (const f of files) {
    if (f.endsWith('.zsync')) continue; // AppImageUpdate kendi buluyor, insan indirmez
    if (!text.includes('/' + f + ')')) out.push('indirme bağlantısı yok: ' + f);
  }
  // Kod içindekiler anma sayılmaz: GitHub onları kişiye bağlamıyor
  const plain = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const m of plain.matchAll(/(^|[^\w/.@-])@([A-Za-z0-9][A-Za-z0-9-]*)/gm)) {
    out.push('kişi anılmış: @' + m[2]);
  }
  return out;
}

module.exports = { notesProblems };
