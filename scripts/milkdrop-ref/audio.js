/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
// İki motora aynı sesi vermek için ham dosya: kare başına 576 sol + 576 sağ
// işaretli 8 bit örnek (±128 birimi, MilkDrop'un fWaveform ölçeği).
// 44,1 kHz, 30 fps: her kare 1470 örnek ilerliyor, pencere en yeni 576 örnek.
// kind: silent | tone (bas + orta + tiz, 2 Hz vuruş zarfı)
const fs = require('fs');
function make(kind, frames) {
  const SR = 44100, HOP = SR / 30;
  const buf = Buffer.alloc(frames * 1152);
  if (kind === 'silent') return buf;
  const k2 = kind === 'tone2';
  const sample = (n, ch) => {
    const t = n / SR;
    const beat = Math.pow(Math.max(0, 1 - ((t * (k2 ? 2.37 : 2)) % 1) * 3), 2);
    const ph = ch ? 0.7 : 0;
    const v = (k2 ? 70 : 55) * beat * Math.sin(2 * Math.PI * (k2 ? 55 : 70) * t + ph) +
      28 * Math.sin(2 * Math.PI * 440 * t + ph * 2) * (0.5 + 0.5 * Math.sin(t * 1.3)) +
      18 * Math.sin(2 * Math.PI * 2600 * t + ph * 3) * (0.5 + 0.5 * Math.cos(t * 0.9));
    return Math.max(-127, Math.min(127, Math.round(v)));
  };
  for (let f = 0; f < frames; f++) {
    const end = Math.round((f + 1) * HOP);
    for (let i = 0; i < 576; i++) {
      const n = end - 576 + i;
      buf.writeInt8(sample(n, 0), f * 1152 + i);
      buf.writeInt8(sample(n, 1), f * 1152 + 576 + i);
    }
  }
  return buf;
}
module.exports = { make };
if (require.main === module) {
  const [kind = 'tone', frames = '120', out = 'audio-' + kind + '.i8'] = process.argv.slice(2);
  fs.writeFileSync(out, make(kind, +frames));
  console.log(out, +frames * 1152, 'bayt');
}
