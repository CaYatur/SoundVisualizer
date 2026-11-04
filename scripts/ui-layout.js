/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Yerleşim denetimi: panelin her sayfasında, bölümünde ve katman sekmesinde ölçüyor.
 *
 *   kenar      yazı ya da denetim kutusunun kenarına 7 pikselden yakın
 *   taşma      denetim kutusunun dışına çıkıyor
 *   çerçeve    eski tarz kenarlıklı düğme ya da giriş
 *   hiza       bir bölümdeki satırlar aynı sol kenarda başlamıyor
 *   sözcük     tek sözcük ortasından ikinci satıra bölünmüş
 *
 * Tasarım değişikliğinden sonra ve yeni bir kart eklerken çalıştırın:
 *   npm run ui-layout -- --settings=<settings.json> --presets=<klasör> [--size=1468x836] [--port=9792]
 *
 * Uyarının bir kısmı bilerek öyledir (kod düzenleyici, boş çizelge notu); bunlar IGNORE'da. Yeni bir
 * istisna eklemeden önce görüntüye bakın.
 */
const { sleep, startPanel } = require('./ui-lib');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const [W, H] = arg('size', '1468x836').split('x').map(Number);

const PROBE = `JSON.stringify((() => {
  const vis = (e) => { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const BOX = '.group, .sv-card, .card, .dock-block, .sv-module, .sv-pcard, .sv-menu, .nav-rail, .sv-secnav, .layer-pane';
  const IGNORE = '.sv-hud, .topbar, .sv-gal, .md-grid, .md-list, .sv-scenes, .preview-stage, .tl-heads, .tl-toolbar, .sv-pages, .code-editor, .md-imports-body, .sv-moment';
  const name = (e) => (e.textContent || e.value || e.placeholder || e.getAttribute('aria-label') || e.tagName).replace(/\\s+/g, ' ').trim().slice(0, 34);
  const out = { kenar: new Set(), 'taşma': new Set(), 'çerçeve': new Set(), 'sözcük': new Set(), hiza: new Set() };
  for (const e of document.querySelectorAll('button, select, input:not([type=checkbox]):not([type=range]):not([type=color]), textarea, label.lbl, .studio-note, .settings-io-note, .studio-status, small, h3, a')) {
    if (!vis(e) || e.closest(IGNORE)) continue;
    let box = e.parentElement && e.parentElement.closest(BOX);
    while (box) { const bs = getComputedStyle(box); if (bs.backgroundImage !== 'none' || (bs.backgroundColor !== 'rgba(0, 0, 0, 0)' && bs.backgroundColor !== 'transparent') || bs.boxShadow !== 'none') break; box = box.parentElement && box.parentElement.closest(BOX); }
    if (!box || !vis(box)) continue;
    const a = box.getBoundingClientRect();
    let r;
    if (['BUTTON', 'SELECT', 'INPUT', 'TEXTAREA'].includes(e.tagName)) r = e.getBoundingClientRect();
    else { const g = document.createRange(); g.selectNodeContents(e); r = g.getBoundingClientRect(); if (!r.width) r = e.getBoundingClientRect(); }
    const gl = r.left - a.left, gr = a.right - r.right;
    if (gl < -1 || gr < -1) { if (!e.closest('.layer-tabs, .sv-tabs, .tl-body')) out['taşma'].add(name(e)); }
    else if ((gl < 7 || gr < 7) && !box.matches('.sv-secnav, .sv-menu, .nav-rail') && !e.matches('button.group-label, .sv-secbtn, .sv-tree-item, .sv-tree-group, .sv-nav-reset, .sv-dest, .studio-item, .adv-summary')) out.kenar.add(name(e));
    if (['BUTTON', 'INPUT', 'SELECT'].includes(e.tagName)) { const s = getComputedStyle(e); if (parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle === 'solid' && !e.closest('.sv-grid')) out['çerçeve'].add(name(e)); }
  }
  for (const e of document.querySelectorAll('label.lbl, button, b, h3, small, .name')) {
    if (!vis(e) || e.children.length > 1 || e.closest('.sv-tree-item, ' + IGNORE)) continue;
    const t = (e.textContent || '').trim();
    if (!t || /\\s/.test(t) || t.length < 3) continue;
    const r = e.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(e).lineHeight) || 16;
    if (r.height > lh * 1.7 && getComputedStyle(e).whiteSpace !== 'nowrap') out['sözcük'].add(t.slice(0, 24));
  }
  // Hiza: bölümün doğrudan satırları (etiket, modül, not, tam genişlik düğme) aynı sol kenarda başlamalı
  for (const g of document.querySelectorAll('#sections .group, #svInspector .group')) {
    if (!vis(g) || g.parentElement.closest('.group')) continue;
    const a = g.getBoundingClientRect();
    const lefts = new Map();
    for (const e of g.querySelectorAll('.ctrl > label.lbl, .ctrl > .row > label.lbl, .sv-module, .studio-note, .sv-more, .studio-empty, .up-item, .source-item')) {
      if (!vis(e) || e.parentElement.closest('.sv-module, .up-item, .source-item, .gen-actions, .studio-save')) continue;
      const pad = parseFloat(getComputedStyle(e).paddingLeft) || 0;
      const k = Math.round(e.getBoundingClientRect().left + (e.matches('.studio-note') ? pad : 0) - a.left);
      if (!lefts.has(k)) lefts.set(k, name(e));
    }
    const keys = [...lefts.keys()].sort((x, y) => x - y);
    if (keys.length > 1 && keys[keys.length - 1] - keys[0] > 1) out.hiza.add(keys.map((k) => k + ':' + lefts.get(k)).join(' / ').slice(0, 120));
  }
  const res = {};
  for (const k of Object.keys(out)) if (out[k].size) res[k] = [...out[k]].slice(0, 8);
  if (document.documentElement.scrollWidth > innerWidth + 1) res.yatay = ['sayfa yana kayıyor'];
  return res;
})())`;

(async () => {
  const s = await startPanel({ settings: arg('settings'), presets: arg('presets'), port: Number(arg('port', 9792)) });
  const { a } = s;
  await a.call('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await sleep(1500);
  const q = (x) => a.ev(x);
  let bad = 0;
  let n = 0;
  const check = async (label) => {
    await sleep(400);
    const r = JSON.parse(await q(PROBE));
    n++;
    if (Object.keys(r).length) { bad++; console.log(label, JSON.stringify(r)); }
  };
  for (const p of ['scene', 'live', 'time']) {
    await q(`window.SVPanel.setCategory(${JSON.stringify(p)}); 1`);
    await check(p);
  }
  await q("window.SVPanel.setCategory('scene'); 1");
  await q("window.SVSceneShell.select(''); 1");
  await check('sahne denetçisi');
  for (const t of ['vis', 'bg', 'templates', 'scenes', 'effects', 'modulation', 'groups', 'milkdrop']) {
    await q(`window.SVSceneShell.setShelf(${JSON.stringify(t)}); 1`);
    await check('raf ' + t);
  }
  for (const id of JSON.parse(await q('JSON.stringify((window.SVPanel.cfg().layers || []).map((l) => l.id))'))) {
    await q(`window.SVSceneShell.select(${JSON.stringify(id)}); 1`);
    const tabs = JSON.parse(await q("JSON.stringify([...document.querySelectorAll('.layer-tabs button')].map((b) => b.textContent))"));
    for (let i = 0; i < tabs.length; i++) {
      await q(`document.querySelectorAll('.layer-tabs button')[${i}].click(); 1`);
      await check('katman ' + id.slice(-4) + ' / ' + tabs[i]);
    }
  }
  await q("window.SVSceneShell.select(''); 1");
  for (const p of ['output', 'studio', 'audio', 'lighting', 'show', 'control', 'library', 'settings']) {
    await q(`window.SVPanel.setCategory(${JSON.stringify(p)}); 1`);
    await sleep(300);
    for (const sec of JSON.parse(await q(`JSON.stringify(window.SVPanel.sectionsOf(${JSON.stringify(p)}))`))) {
      await q(`window.SVPanel.setSection(${JSON.stringify(sec)}); 1`);
      await check(p + ' / ' + sec);
    }
  }
  console.log(`${n} durum, ${bad} sorunlu, panel hatası ${s.errors.length}`);
  if (s.errors.length) console.log(s.errors.slice(0, 3).join('\n').slice(0, 600));
  await s.stop();
  process.exit(bad || s.errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
