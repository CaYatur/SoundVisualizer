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
 *   düğme      düğmenin yazısı ya da simgesi kendi kenarına 6 pikselden yakın
 *   yapışık    yan yana iki düğmenin arasında boşluk yok
 *   yalnız     alt satıra tek başına düşen simge düğmesi
 *   sıkışık    etiket birden çok satıra bölünmüş ama yanında 40 pikselden fazla boş yer var
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
  const out = { kenar: new Set(), 'taşma': new Set(), 'çerçeve': new Set(), 'sözcük': new Set(), hiza: new Set(), 'düğme': new Set(), 'yapışık': new Set(), 'yalnız': new Set(), 'sıkışık': new Set(), 'ikon-yazı': new Set(), 'iç kenar': new Set() };
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
  // Sıkışık: etiket sarıyor ama satırda sağında boş yer kalıyor (sola yaslanıp sağı kullanmıyor)
  for (const e of document.querySelectorAll('label.lbl')) {
    if (!vis(e) || e.closest(IGNORE)) continue;
    const lh = parseFloat(getComputedStyle(e).lineHeight) || 16;
    const r = e.getBoundingClientRect();
    if (r.height < lh * 1.7) continue;
    const g = document.createRange(); g.selectNodeContents(e);
    const right = Math.max(...[...g.getClientRects()].map((x) => x.right));
    const host = e.closest('.ctrl') || e.parentElement;
    let limit = (e.parentElement.closest(BOX) || host).getBoundingClientRect().right;
    for (const o of host.querySelectorAll('*')) {
      if (e.contains(o) || o.contains(e) || !vis(o)) continue;
      const b = o.getBoundingClientRect();
      if (b.left >= r.right - 1 && Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top) > 4) limit = Math.min(limit, b.left);
    }
    if (limit - right >= 40 && limit - r.right >= 40) out['sıkışık'].add(name(e));
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
  // Stüdyo yan sütunu: başlık, etiket, not ve düğmeler aynı sol kenarda başlamalı
  for (const col of document.querySelectorAll('.studio-side-col')) {
    if (!vis(col)) continue;
    const lefts = new Map();
    for (const e of col.querySelectorAll('.studio-group, .studio-save label.lbl, .sp-main > :first-child, .studio-note, .studio-actions > :first-child')) {
      if (!vis(e)) continue;
      const g = document.createRange(); g.selectNodeContents(e);
      const k = Math.round((e.matches('.btn') ? e.getBoundingClientRect() : g.getBoundingClientRect()).left);
      if (!lefts.has(k)) lefts.set(k, name(e));
    }
    const keys = [...lefts.keys()].sort((x, y) => x - y);
    if (keys.length > 1 && keys[keys.length - 1] - keys[0] > 1) out.hiza.add(keys.map((k) => k + ':' + lefts.get(k)).join(' / ').slice(0, 120));
  }
  // Düğmeler: içerik kendi kenarına dayanmasın, komşular birbirine yapışmasın
  const BAND = '.segment, .seg, .sv-tabs, .sv-pages, .layer-tabs, .sv-grid, .md-grid, .md-list, .sv-scenes, .sv-gal, .tl-heads, .sv-tree, .sv-secnav, .nav-rail, .sv-menu';
  const rows = new Map();
  for (const e of document.querySelectorAll('button, a.btn')) {
    if (!vis(e) || e.closest('.sv-hud, .preview-stage, .code-editor') || e.closest(BAND)) continue;
    const a = e.getBoundingClientRect();
    if ((e.textContent || '').trim() && a.width > 44 && !e.matches('.sv-more, .sv-dest, .studio-item, .adv-summary, button.group-label, .sv-secbtn, .up-item, .sv-nav-reset')) {
      const g = document.createRange(); g.selectNodeContents(e);
      const r = g.getBoundingClientRect();
      if (r.width && (r.left - a.left < 6 || a.right - r.right < 6)) out['düğme'].add(name(e));
    }
    if (!rows.has(e.parentElement)) rows.set(e.parentElement, []);
    rows.get(e.parentElement).push([e, a]);
  }
  for (const list of rows.values()) {
    list.sort((x, y) => x[1].left - y[1].left);
    for (let i = 1; i < list.length; i++) {
      const [pe, pa] = list[i - 1];
      const [e, b] = list[i];
      const gap = b.left - pa.right;
      if (gap >= 0 && gap < 3 && Math.min(pa.bottom, b.bottom) - Math.max(pa.top, b.top) > 8) out['yapışık'].add(name(pe) + ' + ' + name(e));
    }
  }
  for (const p of new Set([...document.querySelectorAll('.icon-btn')].map((e) => e.parentElement))) {
    const kids = [...p.children].filter(vis);
    if (kids.length < 3 || !kids[kids.length - 1].matches('.icon-btn')) continue;
    if (kids[kids.length - 2].getBoundingClientRect().bottom <= kids[kids.length - 1].getBoundingClientRect().top) out['yalnız'].add(name(kids[kids.length - 1]));
  }
  // İkon yazının üstüne biniyor mu (#957): etiket içindeki düğme/ikon ile etiket metni
  for (const lbl of document.querySelectorAll('.ctrl label.lbl')) {
    const t = lbl.querySelector(':scope > .lbl-t');
    if (!t || !vis(lbl)) continue;
    const g = document.createRange(); g.selectNodeContents(t);
    const tr = g.getBoundingClientRect(); const tb = t.getBoundingClientRect();
    const right = Math.min(tr.right, tb.right);
    for (const ic of lbl.querySelectorAll(':scope > button, :scope > .svi')) {
      if (!vis(ic)) continue;
      const r = ic.getBoundingClientRect();
      if (r.left < right - 0.5 && r.right > tr.left && Math.min(r.bottom, tr.bottom) - Math.max(r.top, tr.top) > 2) out['ikon-yazı'].add(name(lbl));
    }
  }
  // Aynı bölmedeki bloklar aynı iç kenarda mı (#957): kitaplık gibi kenara yapışan bölüm
  for (const pane of document.querySelectorAll('.sv-insp .layer-pane.open')) {
    if (!vis(pane)) continue;
    const pl = pane.getBoundingClientRect().left;
    const lefts = [];
    for (const k of pane.children) {
      if (!vis(k)) continue;
      const s = getComputedStyle(k);
      const first = [...k.querySelectorAll('*')].find((x) => vis(x) && x.children.length === 0 && (x.textContent || '').trim()) || k;
      const g = document.createRange(); g.selectNodeContents(first);
      const L = (first === k ? k.getBoundingClientRect().left + parseFloat(s.paddingLeft) : first.getBoundingClientRect().left) - pl;
      lefts.push([Math.round(L), k]);
    }
    if (lefts.length < 3) continue;
    const cnt = {}; lefts.forEach(([L]) => { cnt[L] = (cnt[L] || 0) + 1; });
    const mode = +Object.keys(cnt).sort((x, y) => cnt[y] - cnt[x])[0];
    for (const [L, k] of lefts) if (L < mode - 3) out['iç kenar'].add(name(k) + ' ' + L + '<' + mode);
  }
  const res = {};
  for (const k of Object.keys(out)) if (out[k].size) res[k] = [...out[k]].slice(0, 8);
  if (document.documentElement.scrollWidth > innerWidth + 1) res.yatay = ['sayfa yana kayıyor'];
  return res;
})())`;

(async () => {
  const s = await startPanel({ settings: arg('settings'), presets: arg('presets'), port: Number(arg('port', 9792)), asWindows: process.argv.includes('--as-windows') });
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
  // Üst çubuk çakışması (#957): 1024-1920 genişlik x çıkış açık/kapalı x Basit açık/kapalı
  const HEAD = `JSON.stringify((() => {
    const bar = document.querySelector('.topbar');
    if (window.SVTopbarFit) window.SVTopbarFit.fit(bar);
    const vis = (e) => { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const items = [...bar.querySelectorAll('.sv-top-left > *, .sv-pages > button, .sv-tools > *:not(.display-controls), .display-controls > *:not(.display-field):not(.status), .display-field > :not(.display-menu)')].filter(vis);
    const nm = (e) => e.id || e.className || e.tagName;
    const hit = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      if (items[i].contains(items[j]) || items[j].contains(items[i])) continue;
      const A = items[i].getBoundingClientRect(), B = items[j].getBoundingClientRect();
      if (Math.min(A.right, B.right) - Math.max(A.left, B.left) > 0.5 && Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top) > 0.5) hit.push(nm(items[i]) + ' x ' + nm(items[j]));
    }
    const br = bar.getBoundingClientRect();
    for (const e of items) { const r = e.getBoundingClientRect(); if (r.left < br.left - 0.5 || r.right > br.right + 0.5) hit.push(nm(e) + ' dışarı taşıyor'); }
    return { hit: hit.slice(0, 6), fit: bar.getAttribute('data-fit') };
  })())`;
  await q("window.SVPanel.setCategory('scene'); 1");
  const openTxt = JSON.parse(await q("JSON.stringify(document.getElementById('openBtn').textContent)"));
  for (const simple of [false, true]) {
    await q(`(() => { const on = document.body.classList.contains('sv-simple-on'); const t = document.querySelector('.sv-simple input'); if (on !== ${simple} && t) t.click(); return 1; })()`);
    for (const out of [false, true]) {
      await q(`(() => { const c = document.getElementById('closeBtn'), o = document.getElementById('openBtn'); c.disabled = ${!out}; o.lastChild.textContent = ${out} ? 'Ekranları Uygula' : ${JSON.stringify(openTxt)}; return 1; })()`);
      for (let w = 1024; w <= 1920; w += 64) {
        await a.call('Emulation.setDeviceMetricsOverride', { width: w, height: H, deviceScaleFactor: 1, mobile: false });
        await sleep(120);
        const r = JSON.parse(await q(HEAD));
        n++;
        if (r.hit.length) { bad++; console.log('üst çubuk', w, out ? 'çıkış açık' : 'çıkış kapalı', simple ? 'basit' : 'tam', 'düzey ' + r.fit, JSON.stringify(r.hit)); }
      }
    }
  }
  await q(`(() => { const c = document.getElementById('closeBtn'), o = document.getElementById('openBtn'); c.disabled = true; o.lastChild.textContent = ${JSON.stringify(openTxt)}; return 1; })()`);
  await a.call('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  console.log(`${n} durum, ${bad} sorunlu, panel hatası ${s.errors.length}`);
  if (s.errors.length) console.log(s.errors.slice(0, 3).join('\n').slice(0, 600));
  await s.stop();
  process.exit(bad || s.errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
