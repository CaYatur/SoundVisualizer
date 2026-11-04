/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ARAYÜZ DENETİMİ (#905). Paneldeki her sayfayı, rafı, katman türünü ve denetçi sekmesini iki dilde
   gezer. Öz test sayfaları tarıyor ama katman türlerine tek tek girmiyor; çevrilmemiş metin en çok
   orada kalıyor.

   Raporlar:
     tr-in-en   İngilizce arayüzde Türkçe metin (hata)
     same       İki dilde aynı kalan metin: özel ad olabilir, gözle bakılır
     clipped    Kutusuna sığmayan etiket ya da düğme (hata)
     errors     Konsol hatası (hata)

   Kullanım:
     npm run ui-audit
     npm run ui-audit -- --settings=<settings.json> --presets=<klasör> --out=<rapor.json>
   Çıkış kodu hata varsa 1. */
const fs = require('fs');
const { sleep, startPanel } = require('./ui-lib');

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const PORT = +arg('port', 9762);

const PAGES = ['live', 'time', 'studio', 'output', 'audio', 'lighting', 'show', 'control', 'library', 'settings'];
const SHELF = ['milkdrop', 'vis', 'bg', 'templates', 'scenes', 'effects', 'modulation', 'groups'];

/* Sayfada çalışır. Kullanıcı verisi taşıyan yerler (preset ve sahne adları, kod alanları) dışarıda. */
const SCAN = String.raw`(() => {
  const SKIP = 'script,style,textarea,code,pre,.md-grid,.md-list,.md-item,.sv-lt,.cm-editor,.studio-sidebar,[data-noi18n]';
  const seen = new Map();
  const add = (t, el) => {
    t = t.replace(/\s+/g, ' ').trim();
    if (!/\p{L}{2}/u.test(t)) return;
    if (!seen.has(t)) seen.set(t, el.closest('[data-card]') ? el.closest('[data-card]').getAttribute('data-card') : '');
  };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const p = w.currentNode.parentElement;
    if (!p || p.closest(SKIP) || !p.getClientRects().length) continue;
    add(w.currentNode.nodeValue, p);
  }
  document.querySelectorAll('[title],[placeholder],[aria-label]').forEach((el) => {
    if (el.closest(SKIP) || !el.getClientRects().length) return;
    for (const a of ['title', 'placeholder', 'aria-label']) if (el.getAttribute(a)) add(el.getAttribute(a), el);
  });
  document.querySelectorAll('option').forEach((o) => {
    if (o.closest(SKIP)) return;
    const s = o.closest('select');
    if (s && s.getClientRects().length && o.textContent) add(o.textContent, s);
  });
  const clipped = [];
  document.querySelectorAll('label.lbl, button, .sv-names small, .group-label, .card h2, .card h3').forEach((el) => {
    if (el.closest(SKIP) || !el.getClientRects().length || el.children.length > 1) return;
    if (getComputedStyle(el).overflow === 'visible') return;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) clipped.push(el.textContent.replace(/\s+/g, ' ').trim());
  });
  return JSON.stringify({ texts: [...seen.keys()], clipped });
})()`;

async function walk(s, locale) {
  const { a } = s;
  const q = (e) => a.ev(e);
  const texts = new Map();
  const clipped = new Map();
  const visited = [];
  const scan = async (where) => {
    await q('new Promise((r) => { document.querySelectorAll(".sv-content details").forEach((d) => { d.open = true; }); requestAnimationFrame(() => setTimeout(r, 30)); })');
    const r = JSON.parse(await q(SCAN));
    for (const t of r.texts) if (!texts.has(t)) texts.set(t, where);
    for (const t of r.clipped) if (!clipped.has(t)) clipped.set(t, where);
    visited.push(where);
  };

  await q(`localStorage.setItem('sv-language', ${JSON.stringify(locale)}); localStorage.setItem('sv-advanced', '1'); localStorage.setItem('sv-simple', '0'); location.reload(); 1`);
  await sleep(1500);
  await s.ready();
  await a.call('Emulation.setDeviceMetricsOverride', { width: 1484, height: 901, deviceScaleFactor: 1, mobile: false });
  await sleep(1200);

  for (const id of PAGES) {
    await q(`window.SVPanel.setCategory(${JSON.stringify(id)}); 1`);
    await sleep(350);
    await scan('sayfa:' + id);
    const secs = JSON.parse(await q('JSON.stringify([...document.querySelectorAll("#svSecNav button")].map((b) => b.getAttribute("data-sec")))'));
    for (const sec of secs) {
      await q(`window.SVPanel.setSection(${JSON.stringify(sec)}); 1`);
      await sleep(250);
      await scan('bölüm:' + sec);
    }
    if (id === 'live') {
      await q("window.SVLiveShell.setLower('deck'); 1");
      await sleep(250);
      await scan('canlı:deste');
      await q("window.SVLiveShell.setLower('scenes'); 1");
    }
  }

  await q("window.SVPanel.setCategory('scene'); 1");
  await sleep(400);
  await q("window.SVSceneShell.select(''); 1");
  await sleep(200);
  await scan('sahne:genel');
  for (const tab of SHELF) {
    await q(`window.SVSceneShell.setShelf(${JSON.stringify(tab)}); 1`);
    await sleep(350);
    await scan('raf:' + tab);
  }

  // Ekleme menüsündeki her tür, her sekme
  const addCount = await q(`window.SVScenePanels.layersPanel({ add: true }).querySelectorAll('button').length`);
  for (let i = 0; i < addCount; i++) {
    const added = await q(`(() => {
      const r = window.SVScenePanels.layersPanel({ add: true });
      const b = r.querySelectorAll('button')[${i}];
      if (!b || /Yapıştır|Paste/.test(b.textContent)) return null;
      b.click();
      const s = window.SVSceneShell.selected();
      return s ? s.kind + '/' + s.type : null;
    })()`);
    if (!added) continue;
    await sleep(300);
    const tabCount = await q('document.querySelectorAll("#svInspector .layer-tab").length');
    for (let t = 0; t < tabCount; t++) {
      await q(`document.querySelectorAll('#svInspector .layer-tab')[${t}].click(); 1`);
      await sleep(120);
      await scan('katman:' + added + ':' + t);
    }
    // Aynı türün her kaynağı (görselleştirici ve arkaplan modları)
    await q("document.querySelector('#svInspector .layer-tab').click(); 1");
    await sleep(120);
    const types = JSON.parse(await q(`(() => {
      const s = [...document.querySelectorAll('#svInspector .ctrl')].find((c) => c.querySelector('select') && /^(Kaynak|Source)$/.test(((c.querySelector("label") || {}).textContent || "").trim()));
      return JSON.stringify(s ? [...s.querySelector('select').options].map((o) => o.value) : []);
    })()`));
    if (types.length > 1) {
      for (const type of types) {
        await q(`(() => { const l = window.SVSceneShell.selected(); l.type = ${JSON.stringify(type)}; window.SVPanel.apply(); return 1; })()`);
        await sleep(130);
        await scan('kaynak:' + added.split('/')[0] + '/' + type);
      }
    }
    // Eklenen katman kalkıyor: bir sonraki tur temiz başlasın
    await q('(() => { const c = window.SVPanel.cfg(); c.layers.pop(); window.SVSceneShell.select(""); window.SVPanel.apply(); return 1; })()');
    await sleep(200);
  }
  // Aracın kendi sınaması: bu iki öğe bulunmazsa "0 hata" bir şey demek değil
  await q(`(() => { const d = document.createElement('div'); d.id = 'svAuditProbe'; d.style.cssText = 'position:fixed;left:0;top:0;z-index:99999'; d.innerHTML = '<span>Sınama şimdi</span><button style="width:20px;overflow:hidden;white-space:nowrap">Uzun bir sınama düğmesi</button>'; document.body.appendChild(d); return 1; })()`);
  const probe = JSON.parse(await q(SCAN));
  await q("document.getElementById('svAuditProbe').remove(); 1");
  if (!probe.texts.includes('Sınama şimdi') || !probe.clipped.includes('Uzun bir sınama düğmesi')) throw new Error('tarama kendi sınamasını geçemedi');
  return { texts, clipped, visited };
}

async function main() {
  const s = await startPanel({ settings: arg('settings'), presets: arg('presets'), port: PORT });
  const en = await walk(s, 'en');
  const enErrors = s.errors.splice(0);
  const tr = await walk(s, 'tr');
  const trErrors = s.errors.splice(0);
  const t = (x) => s.a.ev(`window.SVI18n.t(${JSON.stringify(x)})`);
  await s.a.ev("localStorage.setItem('sv-language', 'en'); location.reload(); 1");
  await sleep(1500);
  await s.ready();

  const LETTERS = /[ğĞşŞıİ]/;
  const trInEn = [];
  for (const [text, where] of en.texts) {
    if (LETTERS.test(text) || (tr.texts.has(text) && await t(text) !== text)) trInEn.push({ text, where });
  }
  const same = [...en.texts.keys()].filter((x) => tr.texts.has(x) && /\p{L}{3}/u.test(x) && !LETTERS.test(x)).sort().map((text) => ({ text, where: en.texts.get(text) }));
  const clipped = [...en.clipped].concat([...tr.clipped]).map(([text, where]) => ({ text, where }));
  await s.stop();

  const report = { visited: en.visited, trInEn, clipped, errors: enErrors.concat(trErrors), same };
  if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(report, null, 1));
  console.log('Gezilen durum: İngilizce ' + en.visited.length + ', Türkçe ' + tr.visited.length);
  console.log('\nİngilizce arayüzde Türkçe (' + trInEn.length + ')');
  trInEn.forEach((x) => console.log('  ' + x.text.slice(0, 110) + '  [' + x.where + ']'));
  console.log('\nKesik metin (' + clipped.length + ')');
  clipped.forEach((x) => console.log('  ' + x.text.slice(0, 80) + '  [' + x.where + ']'));
  console.log('\nKonsol hatası (' + report.errors.length + ')');
  report.errors.slice(0, 12).forEach((x) => console.log('  ' + x.slice(0, 200)));
  console.log('\nİki dilde aynı (' + same.length + '): ' + (arg('out') ? 'rapora bakın' : same.slice(0, 60).map((x) => x.text).join(' | ')));
  process.exit(trInEn.length || clipped.length || report.errors.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
