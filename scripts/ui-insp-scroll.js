/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Denetçi kaydırması: MilkDrop Rastgele / Kilitle tıklanınca sv-insp
   scrollTop yerinde kalır; başka katmana geçince sıfırlanır.
   Kullanım: xvfb-run -a node scripts/ui-insp-scroll.js */
const { sleep, startPanel } = require('./ui-lib');

(async () => {
  const s = await startPanel({ port: 9811, lang: 'en-US' });
  const { a } = s;
  const q = (x) => a.ev(x);
  const fails = [];
  try {
    await sleep(1200);
    await q("window.SVPanel.setCategory('scene'); 1");
    await sleep(800);
    // MilkDrop katmanı seç
    const picked = await q(`(() => {
      const cfg = window.SVPanel.cfg();
      const layers = cfg.layers || (cfg.layers = []);
      let l = layers.find((x) => x && x.kind === 'visualizer' && x.type === 'milkdrop');
      if (!l) {
        if (!window.SVLayers || !window.SVLayers.normalizeLayer) return 'no-SVLayers';
        l = window.SVLayers.normalizeLayer({ kind: 'visualizer', type: 'milkdrop', name: 'MilkDrop' });
        layers.push(l);
        window.SVPanel.apply();
      }
      window.SVSceneShell.select(l.id); return l.id;
    })()`);
    if (!picked) { fails.push('milkdrop katmanı yok'); throw new Error('no layer'); }
    await sleep(1000);
    // Denetçiyi aşağı kaydır
    const before = JSON.parse(await q(`JSON.stringify((() => {
      const b = document.querySelector('#svInspector .sv-insp');
      if (!b) return { ok: false };
      b.scrollTop = Math.min(b.scrollHeight - b.clientHeight, 420);
      b.dispatchEvent(new Event('scroll'));
      return { ok: true, st: b.scrollTop, h: b.scrollHeight };
    })())`));
    if (!before.ok || before.st < 40) fails.push('kaydırma hazırlanamadı: ' + JSON.stringify(before));
    // Kilitle
    await q(`(() => { const b = [...document.querySelectorAll('#svInspector button')].find((x) => /Lock|Kilitle|Kilitli/.test(x.textContent||'')); if (!b) throw new Error('lock yok'); b.click(); return 1; })()`);
    await sleep(900);
    const afterLock = JSON.parse(await q(`JSON.stringify((() => {
      const b = document.querySelector('#svInspector .sv-insp');
      return { st: b ? b.scrollTop : -1 };
    })())`));
    if (Math.abs(afterLock.st - before.st) > 8) fails.push(`Kilitle kaydırma ${before.st} -> ${afterLock.st}`);
    // Rastgele
    await q(`(() => { const b = [...document.querySelectorAll('#svInspector button')].find((x) => /Random|Rastgele/.test(x.textContent||'')); if (!b) throw new Error('random yok'); b.click(); return 1; })()`);
    await sleep(1200);
    const afterRand = JSON.parse(await q(`JSON.stringify((() => {
      const b = document.querySelector('#svInspector .sv-insp');
      return { st: b ? b.scrollTop : -1 };
    })())`));
    if (Math.abs(afterRand.st - before.st) > 24) fails.push(`Rastgele kaydırma ${before.st} -> ${afterRand.st}`);
    // Başka seçim: sahne ayarları — kaydırma sıfırlanmalı
    await q("window.SVSceneShell.select(''); 1");
    await sleep(700);
    const afterSel = JSON.parse(await q(`JSON.stringify((() => {
      const b = document.querySelector('#svInspector .sv-insp');
      return { st: b ? b.scrollTop : -1 };
    })())`));
    if (afterSel.st > 8) fails.push('farklı seçimde kaydırma sıfırlanmadı: ' + afterSel.st);
  } catch (e) { fails.push(String(e && e.message || e)); }
  await s.stop();
  if (fails.length) { console.error('FAIL\n' + fails.join('\n')); process.exit(1); }
  console.log('ui-insp-scroll: OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
