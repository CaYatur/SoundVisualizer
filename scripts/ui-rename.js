/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
// Katman adının satır içi düzenlenmesini GERÇEK Electron girişiyle sınar (#957):
// sağ tık menüsü, Türkçe metin/IME, Enter, Esc, dışarı tıklama; ad değişmeden de kapanmalı.
// Kullanım: xvfb-run -a node scripts/ui-rename.js [--as-windows]
const { sleep, startPanel } = require('./ui-lib');
(async () => {
  const s = await startPanel({ port: 9795, asWindows: process.argv.includes('--as-windows') });
  const { a } = s; await sleep(1500);
  const q = (x) => a.ev(x);
  const key = async (k, code, vk, text) => { await a.call('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text }); await a.call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); };
  const click = async (x, y, button) => { for (const type of ['mousePressed', 'mouseReleased']) await a.call('Input.dispatchMouseEvent', { type, x, y, button, clickCount: 1, buttons: button === 'right' ? 2 : 1 }); };
  const start = async () => { await q("window.SVPanel.setCategory('scene'); 1"); await sleep(400); 
    const rc = JSON.parse(await q("JSON.stringify((()=>{const r=document.querySelector('.sv-lt[data-id=ly_vis]').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})())"));
    await click(rc[0], rc[1], 'right'); await sleep(300);
    const mc = JSON.parse(await q("JSON.stringify((()=>{const r=document.querySelector('.sv-layer-menu [data-act=rename]').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})())"));
    await click(mc[0], mc[1], 'left'); await sleep(400);
    return JSON.parse(await q("JSON.stringify({inp:!!document.querySelector('.sv-rename'),focus:document.activeElement&&document.activeElement.className, ren:!!document.querySelector('.sv-renaming')})")); };
  const name = () => q("window.SVPanel.cfg().layers.find(l=>l.id==='ly_vis').name");
  const res = {};
  res.start1 = await start();
  await q("document.querySelector('.sv-rename').select(); 1");
  await a.call('Input.insertText', { text: 'Çubuk Şğİ' });
  await a.call('Input.imeSetComposition', { text: 'ö', selectionStart: 1, selectionEnd: 1 }).catch(() => {});
  await a.call('Input.insertText', { text: 'ö' });
  await key('Enter', 'Enter', 13, '\r'); await sleep(500);
  res.enter = await name(); res.inpAfterEnter = await q("!!document.querySelector('.sv-rename')");
  res.start2 = await start(); await a.call('Input.insertText', { text: 'XXX' }); await key('Escape', 'Escape', 27); await sleep(400);
  res.esc = await name(); res.inpAfterEsc = await q("!!document.querySelector('.sv-rename')");
  res.start3 = await start(); await q("document.querySelector('.sv-rename').select(); 1"); await a.call('Input.insertText', { text: 'Bulanık' });
  await click(700, 400, 'left'); await sleep(500);
  res.blur = await name(); res.inpAfterBlur = await q("!!document.querySelector('.sv-rename')");
  // Ad değişmeden Enter / dışarı tıklama
  res.start4 = await start(); await key('Enter', 'Enter', 13, '\r'); await sleep(300);
  res.sameEnter = await q("!!document.querySelector('.sv-rename')");
  res.start5 = await start(); await click(700, 400, 'left'); await sleep(300);
  res.sameBlur = await q("!!document.querySelector('.sv-rename')");
  res.start6 = await start(); await key('Escape', 'Escape', 27); await sleep(300);
  res.sameEsc = await q("!!document.querySelector('.sv-rename')"); res.finalName = await name();
  const ok = res.enter === "Çubuk Şğİö" && !res.inpAfterEnter && res.esc === "Çubuk Şğİö" && !res.inpAfterEsc && res.blur === "Bulanık" && !res.inpAfterBlur && !res.sameEnter && !res.sameBlur && !res.sameEsc && res.finalName === "Bulanık" && !s.errors.length;
  console.log(JSON.stringify(res), ok ? "tamam" : "HATA");
  await s.stop(); process.exit(ok ? 0 : 1);
  await s.stop(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
