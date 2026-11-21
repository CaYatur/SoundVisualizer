/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
// mdref: MDREF_ERRLOG=<dosya> verilirse MilkDrop'un dumpmsg iletileri (shader derleme hataları dahil)
// o dosyaya eklenir. Verilmezse özgün davranış (yayın derlemesinde dumpmsg hiçbir şey yazmıyor).
// CaYaDev preset paketi tanısı için (2026-10-21). latin1 okuyup yazar: kaynakta UTF-8 olmayan baytlar var.
const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'src', 'vis_milk2', 'plugin.cpp');
const raw = fs.readFileSync(p, 'latin1');
if (raw.includes('MDREF_ERRLOG')) { console.log('zaten yamalı'); process.exit(0); }
const crlf = raw.includes('\r\n');
let s = raw.replace(/\r\n/g, '\n');
const a = 'void CPlugin::dumpmsg(wchar_t *s)\n{\n';
if (!s.includes(a)) throw new Error('dumpmsg bulunamadı');
s = s.replace(a, a +
  '    {\n' +
  '        static FILE* f = NULL;\n' +
  '        static bool tried = false;\n' +
  '        if (!tried) { tried = true; const char* e = getenv("MDREF_ERRLOG"); if (e && e[0]) f = fopen(e, "a"); }\n' +
  '        if (f) { fwprintf(f, L"%s\\n", s); fflush(f); }\n' +
  '    }\n');
fs.writeFileSync(p, crlf ? s.replace(/\n/g, '\r\n') : s, 'latin1');
console.log('ok plugin.cpp');
