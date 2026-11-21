/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
// mdref: BeatDrop kopyasına ölçüm yamaları (yalnız bu çalışma kopyasında; depo dışında)
//  1. DoTime: g_mdrefFps > 0 ise sabit adım (duvar saati yok) -> belirlenimci zaman
//  2. DrawAndDisplay: Present'ten önce kare yakalama kancası
const fs = require('fs');
const path = require('path');
const S = path.join(__dirname, 'src', 'vis_milk2');
function edit(rel, fn) {
  const p = path.join(S, rel);
  const raw = fs.readFileSync(p, 'latin1');
  const crlf = raw.includes('\r\n');
  const before = raw.replace(/\r\n/g, '\n');
  const after = fn(before);
  if (after === before) throw new Error('değişmedi: ' + rel);
  fs.writeFileSync(p, crlf ? after.replace(/\n/g, '\r\n') : after, 'latin1');
  console.log('ok', rel);
}
function must(s, a, b) {
  if (!s.includes(a)) throw new Error('yok: ' + a.slice(0, 80));
  return s.replace(a, b);
}
edit('pluginshell.cpp', (s) => {
  if (s.includes('g_mdrefFps')) return s + ' ';
  s = must(s, 'void CPluginShell::DoTime()\n{\n',
    'float g_mdrefFps = 0;\nvoid (*g_mdrefHook)(LPDIRECT3DDEVICE9) = 0;\n' +
    'void CPluginShell::DoTime()\n{\n' +
    '\tif (g_mdrefFps > 0)\n\t{\n\t\tif (m_frame==0) m_time = 0;\n\t\tm_fps = g_mdrefFps;\n\t\tm_time += 1.0f/m_fps;\n\t\treturn;\n\t}\n');
  s = must(s, '\telse\n\t\tm_lpDX->m_lpDevice->Present(NULL,NULL,NULL,NULL);\n',
    '\telse\n\t{\n\t\tif (g_mdrefHook) g_mdrefHook(m_lpDX->m_lpDevice);\n\t\tm_lpDX->m_lpDevice->Present(NULL,NULL,NULL,NULL);\n\t}\n');
  return s;
});
