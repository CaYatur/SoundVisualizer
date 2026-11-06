/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Gerçek panelde: Şablon klibi (0-10 sn) + başka parçada Görselleştirici/Palet
   klibi (1.5 sn'den). Oynat → klibe gir → Durdur (başa dön) → klibin öncesinde
   şablonun kendi görselleştiricisi/paleti geri gelmeli. Anında Uygula açık ve
   kapalı. Kullanım: xvfb-run -a node scripts/ui-tl-vis-rewind.js */
const { sleep, startPanel } = require('./ui-lib');

(async () => {
  const s = await startPanel({ port: 9841, lang: 'en-US' });
  const q = (x) => s.a.ev(x);
  const fails = [];
  const log = [];
  try {
    await sleep(1200);
    await q("window.SVPanel.setCategory('time'); 1");
    await sleep(1000);
    const setup = (live) => q(`(() => {
      const P = window.SVPanel, cfg = P.cfg(), T = window.SVTemplates;
      const tpl = T.TEMPLATES.find((t) => { const c = T.apply(window.SV.clone(cfg), t, { defaultConfig: window.SV.defaultConfig, deepMerge: window.SV.deepMerge, clone: window.SV.clone }); return (c.layers || []).some((l) => l.kind === 'visualizer' && l.type !== 'bars' && l.type !== 'text' && l.type !== 'nowplaying' && !l.locked && l.enabled !== false); });
      const pal = (window.SV.GRADIENT_PRESETS || [])[1];
      const tl = cfg.timeline;
      tl.enabled = true; tl.applyEditsImmediately = ${live}; tl.loop = false;
      tl.tracks = [
        { id: 'tv', kind: 'clip', name: 'V', clips: [{ id: 'cv', type: 'visualizer', ref: 'bars', name: '', start: 1.5, dur: 3 }] },
        { id: 'tp', kind: 'clip', name: 'P', clips: [{ id: 'cp', type: 'palette', ref: pal.name, name: '', start: 1.5, dur: 3 }] },
        { id: 'ts', kind: 'clip', name: 'S', clips: [{ id: 'cs', type: 'preset', ref: tpl.id, name: '', start: 0, dur: 10 }] },
      ];
      P.apply(); P.rerender && P.rerender();
      return tpl.id + ' / ' + pal.name;
    })()`);
    const state = () => q(`JSON.stringify((() => { const c = window.SVPanel.cfg();
      const l = (c.layers || []).find((l) => l && l.kind === 'visualizer' && !l.locked && l.enabled !== false && l.type !== 'text' && l.type !== 'nowplaying');
      return { vis: l ? l.type : (c.visualizer && c.visualizer.type), pal: JSON.stringify(c.background.gradient.colors) }; })())`).then(JSON.parse);
    const at = (t) => q(`window.SVTimelinePanel._applyAt(${t}); 1`);
    const stopBtn = () => q(`(() => { const b = [...document.querySelectorAll('.tl-toolbar button')].find((x) => /Stop|Durdur/.test(x.title || x.getAttribute('aria-label') || '')); if (!b) throw new Error('stop yok'); b.click(); return 1; })()`);
    for (const live of [true, false]) {
      const what = await setup(live);
      await sleep(600);
      await q("window.SVTimelinePanel._applyAt && (window.SVTimelinePanel._applyAt(0)); 1");
      await at(0.0); await sleep(300);
      const base = await state();
      const ref = base.vis === 'bars' ? 'dots' : 'bars';
      await q(`(() => { const tl = window.SVPanel.cfg().timeline; tl.tracks[0].clips[0].ref = '${ref}'; window.SVPanel.apply(); return 1; })()`);
      // oynatma: kareler halinde klibe gir
      for (let t = 0.05; t <= 2.2; t += 0.1) await at(+t.toFixed(2));
      await sleep(300);
      const inside = await state();
      await stopBtn(); await sleep(400);
      const afterStop = await state();
      // başa dönüp yeniden oynatma
      for (let t = 0; t <= 1.2; t += 0.1) await at(+t.toFixed(2));
      await sleep(300);
      const replay = await state();
      // tekrar giriş: sınırda uygulanmalı
      for (let t = 1.3; t <= 1.7; t += 0.1) await at(+t.toFixed(2));
      await sleep(300);
      const reenter = await state();
      // Çıkış (klip sonu 4.5): taban geri
      for (let t = 4.4; t <= 5.0; t += 0.1) await at(+t.toFixed(2));
      await sleep(300);
      const exit = await state();
      const row = { live, what, base, inside, afterStop, replay, reenter, exit };
      log.push(row);
      const tag = live ? 'ON' : 'OFF';
      if (inside.vis !== ref || inside.pal === base.pal) fails.push(tag + ': klip içinde uygulanmadı');
      if (live && (afterStop.vis !== base.vis || afterStop.pal !== base.pal)) fails.push(tag + ': durdur+başa dön tabanı geri yüklemedi');
      if (!live && (afterStop.vis !== inside.vis)) fails.push('OFF: durmuş çizelge çıktıya dokundu');
      if (replay.vis !== base.vis || replay.pal !== base.pal) fails.push(tag + ': yeniden oynatmada klipten önce eski görselleştirici/palet kaldı');
      if (reenter.vis !== ref || reenter.pal !== inside.pal) fails.push(tag + ': sınırda yeniden girişte uygulanmadı');
      if (exit.vis !== base.vis || exit.pal !== base.pal) fails.push(tag + ': klip bitince taban geri gelmedi');
    }
  } catch (e) { fails.push(String(e && e.stack || e)); }
  await s.stop();
  console.log(JSON.stringify(log, null, 1));
  if (fails.length) { console.error('FAIL\n' + fails.join('\n')); process.exit(1); }
  console.log('ui-tl-vis-rewind: OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
