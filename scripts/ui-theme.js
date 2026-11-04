/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
// Başlıktaki tema menüsünden seçilen tema Ayarlar açılınca geri dönmemeli (#957).
// Gerçek tıklamalar; ayar (cfg.ui.theme) ile uygulanan tema aynı olmalı.
// Kullanım: xvfb-run -a node scripts/ui-theme.js [--as-windows]
const { sleep, startPanel } = require('./ui-lib');
(async () => {
  const s = await startPanel({ port: 9797, asWindows: process.argv.includes('--as-windows') });
  const { a } = s; await sleep(1500);
  const q = (x) => a.ev(x);
  const J = async (x) => JSON.parse(await q('JSON.stringify((()=>{' + x + '})())'));
  const click = async (sel) => {
    const c = await J("const e=document.querySelector(" + JSON.stringify(sel) + ");if(!e)return null;const r=e.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]");
    if (!c) throw new Error('yok: ' + sel);
    for (const type of ['mousePressed', 'mouseReleased']) await a.call('Input.dispatchMouseEvent', { type, x: c[0], y: c[1], button: 'left', clickCount: 1, buttons: 1 });
    await sleep(400);
  };
  const state = () => J("return {choice:window.SVUiTheme.choice(), cfg:(window.SVPanel.cfg().ui||{}).theme, attr:document.documentElement.getAttribute('data-ui-theme')||document.documentElement.className}");
  const res = {};
  await q("window.SVPanel.setCategory('scene'); 1"); await sleep(400);
  const out = [];
  for (const id of ['sepia', 'midnight', 'light']) {
    await click('#themeBtn');
    await click('.sv-menu [data-theme="' + id + '"]');
    const before = await state();
    await q("window.SVPanel.setCategory('settings'); 1"); await sleep(700);
    const after = await state();
    const card = await q("(document.querySelector('.ui-theme-opt.active, [data-theme].active')||{}).dataset ? document.querySelector('.ui-theme-opt.active, [data-theme].active').dataset.theme : ''");
    await q("window.SVPanel.setCategory('scene'); 1"); await sleep(400);
    out.push({ id, before, after, card, ok: before.choice === id && after.choice === id && after.cfg === id && card === id });
  }
  // Ayarlar sayfasındaki karttan seçim de başlığa yansır
  await q("window.SVPanel.setCategory('settings'); 1"); await sleep(600);
  await click('[data-theme="neon"]');
  await q("window.SVPanel.setCategory('scene'); 1"); await sleep(400);
  await click('#themeBtn');
  res.menuOn = await q("(document.querySelector('.sv-menu [data-theme].on')||{}).dataset ? document.querySelector('.sv-menu [data-theme].on').dataset.theme : ''");
  res.out = out;
  // Cihaz varsayılanı işletim sistemini izler: koyu → Karanlık, açık → Aydınlık
  res.sys = {};
  for (const sch of ['dark', 'light']) {
    await a.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: sch }] }); await sleep(400);
    await q("window.SVPanel.setCategory('settings'); 1"); await sleep(600);
    await click('.ui-theme-opt[data-theme="system"]'); await sleep(300);
    res.sys[sch] = await J("const p=document.querySelector('.ui-theme-opt[data-theme=system] [data-resolved]');return {cur:window.SVUiTheme.current().id, card:p&&p.getAttribute('data-resolved'), note:(document.querySelector('.ui-theme-grid').parentElement.querySelector('.studio-note')||{}).textContent}");
  }
  const ok = out.every((o) => o.ok) && res.menuOn === 'neon' && res.sys.dark.cur === 'dark' && res.sys.dark.card === 'dark' && res.sys.light.cur === 'light' && res.sys.light.card === 'light' && !s.errors.length;
  console.log(JSON.stringify(res), s.errors.slice(0, 3), ok ? 'tamam' : 'HATA');
  await s.stop(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
