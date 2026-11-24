/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
// mdref: #750 hareket vektörü düzeltmesi, MDREF_MVFIX=1 ortam değişkeniyle açılır.
// Kapalıyken özgün BeatDrop 53d83ee davranışı birebir. Düzeltme, issue #750'deki
// yamanın aynısı: ağ satırı 1-fy'den okunuyor, çizilen konum değişmiyor.
const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'src', 'vis_milk2', 'milkdropfs.cpp');
const raw = fs.readFileSync(p, 'latin1');
const crlf = raw.includes('\r\n');
let s = raw.replace(/\r\n/g, '\n');
if (s.includes('MDREF_MVFIX')) { console.log('zaten yamalı'); process.exit(0); }
function must(a, b) {
  if (!s.includes(a)) throw new Error('yok: ' + a.slice(0, 80));
  s = s.replace(a, b);
}
must('\t\t\t\t\t\t\tfloat fx2, fy2;\n\t\t\t\t\t\t\tReversePropagatePoint(fx, fy, &fx2, &fy2);',
  '\t\t\t\t\t\t\tfloat fx2, fy2;\n' +
  '\t\t\t\t\t\t\tstatic int s_mvfix = -1; if (s_mvfix < 0) s_mvfix = getenv("MDREF_MVFIX") ? 1 : 0;\n' +
  '\t\t\t\t\t\t\tfloat fys = s_mvfix ? 1.0f - fy : fy;\n' +
  '\t\t\t\t\t\t\tReversePropagatePoint(fx, fys, &fx2, &fy2);');
must('\t\t\t\t\t\t\t\tfloat dy = (fy2 - fy);', '\t\t\t\t\t\t\t\tfloat dy = (fy2 - fys);');
must('\t\t\t\t\t\t\t\t\tdx = min_len;\n\t\t\t\t\t\t\t\t\tdy = min_len;',
  '\t\t\t\t\t\t\t\t\tdx = min_len;\n\t\t\t\t\t\t\t\t\tdy = s_mvfix ? -min_len : min_len;');
must('\t\t\t\t\t\t\t\tfy2 = fy + dy;', '\t\t\t\t\t\t\t\tfy2 = fys + dy;');
must('\t\t\t\t\t\t\tv[n].y = fy * 2.0f - 1.0f;', '\t\t\t\t\t\t\tv[n].y = s_mvfix ? -(fys * 2.0f - 1.0f) : fy * 2.0f - 1.0f;');
must('\t\t\t\t\t\t\tv[n+1].y = fy2 * 2.0f - 1.0f;', '\t\t\t\t\t\t\tv[n+1].y = s_mvfix ? -(fy2 * 2.0f - 1.0f) : fy2 * 2.0f - 1.0f;');
fs.writeFileSync(p, crlf ? s.replace(/\n/g, '\r\n') : s, 'latin1');
console.log('ok');
